/**
 * packages/xuanshu-host/lib/shiji/ledger.mjs —— 事记账本的**唯一写入口**（票 05 / #26 契约 §1）。
 *
 * 从「扫描到的依据」到「一行一条事记」只有这一条路：
 *   `scanAndUpdateShiji()`：采集依据 → 逐条 upsert → 冻结消失的源头 → 整文件原子重写。
 *
 * 四条不变量（契约 §1 原文）：
 *   1. **一项目一条**：`id = shiji-<sha256(source\0refId) 前 16 位>`，重扫只更新不追加；
 *   2. **依据指纹不变 → 0 次摘要 LLM**：只更新 `lastActiveAt` / `name` / `basis`；
 *      变了（文档增删改、会话集合变）才重算一次摘要；
 *   3. **源头消失 → `frozenAt` 并保留**（不删、不重算）；重新出现 → 清 `frozenAt` 并更新；
 *   4. **删除 = 墓碑**：`excludedAt` 之后自动扫描**永不重建**同 `source+refId`；恢复只能是显式 RPC。
 *
 * 人工「存成今天的事记」（`source:'session'`）走 `recordSessionShiji()`：自动扫描**永不动**它
 * （不冻结、不覆盖），同 `refId` 再写一次是更新。
 *
 * 本模块依赖 `shiji/{store,scan,summary}` 与 node 内置；**不 import `digao/**` / `rikke/**` /
 * `workflow/service.mjs`**，所以 `digao/generate.mjs → shiji/ledger.mjs` 这条反向依赖是单向、安全的。
 */

import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

import { collectShijiEvidence } from './scan.mjs'
import {
  SHIJI_SCHEMA, readShijiEntries, readShijiSettings, shijiId, writeShijiEntries,
} from './store.mjs'
import { summarizeShijiEvidence } from './summary.mjs'

/** 同一账本的扫描按受理顺序完成；手动操作仍同步落盘，由提交前的合并保留。 */
const pendingScans = new Map()

/** 条目的唯一键（与 id 同源；tombstone / freeze 都按它判）。 */
export function shijiKey(source, refId) {
  return `${source}\u0000${refId}`
}

/**
 * 依据集合的指纹（契约 §1 定值）：
 * `sha256(JSON.stringify({sessions: sortedSessionIds, docs: sorted([relPath,size,mtimeMs])}))`。
 *
 * 为什么用「路径 + 字节数 + mtime」而不是内容散列：事记只读说明文档、单份 ≤4000 字，
 * 改一个字几乎必然改 mtime（且通常改 size）；把全文再散列一遍是重复成本。
 */
export function evidenceFingerprint({ sessions = [], docs = [] } = {}) {
  const sessionIds = [...new Set((Array.isArray(sessions) ? sessions : []).map((id) => String(id)))].sort()
  const docTuples = (Array.isArray(docs) ? docs : [])
    .map((doc) => [String(doc?.relPath ?? ''), Number(doc?.size ?? 0), Number(doc?.mtimeMs ?? 0)])
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
  return createHash('sha256').update(JSON.stringify({ sessions: sessionIds, docs: docTuples })).digest('hex')
}

/** 按 `lastActiveAt` 倒序（同刻按 firstSeenAt 倒序，再按 id 兜底 —— 稳定）。 */
function byLastActiveDesc(left, right) {
  if (left.lastActiveAt !== right.lastActiveAt) return left.lastActiveAt < right.lastActiveAt ? 1 : -1
  if (left.firstSeenAt !== right.firstSeenAt) return left.firstSeenAt < right.firstSeenAt ? 1 : -1
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

/**
 * 列事记（`shiji.list` 的读面）。
 * @param {{includeDeleted?: boolean}} [options] 默认不含墓碑（墓碑只用于审计）
 * @returns {{entries: object[], notes?: string[]}}
 */
export function listShiji(dataDir, { includeDeleted = false } = {}) {
  const { entries, notes } = readShijiEntries(dataDir)
  const visible = includeDeleted ? entries : entries.filter((entry) => entry.excludedAt === null)
  const out = { entries: [...visible].sort(byLastActiveDesc) }
  if (notes.length > 0) out.notes = notes
  return out
}

/** 按 id 找一条（内部用；找不到 null）。 */
function findEntry(entries, id) {
  return entries.find((entry) => entry.id === id) ?? null
}

/** 写回一份条目列表（把「找索引 → 替换」的重复收在一处）。 */
function replaceEntry(entries, target, next) {
  const index = entries.findIndex((entry) => entry.id === target.id)
  if (index < 0) throw new Error(`事记条目不在账本里：${target.id}`)
  entries[index] = next
  return entries
}

/**
 * 删除 = 写墓碑（条目保留在文件里；此后自动扫描永不重建）。
 * @returns {{ok: true, entry: object} | {ok: false, error: {code: string, message: string}}}
 */
export function removeShijiEntry(dataDir, { id, now = new Date() } = {}) {
  const entries = readShijiEntries(dataDir).entries
  const target = findEntry(entries, id)
  if (target === null) return { ok: false, error: { code: 'not-found', message: `事记不存在：${id}。` } }
  if (target.excludedAt !== null) return { ok: true, entry: target } // 已是墓碑：幂等
  const next = { ...target, excludedAt: now.toISOString() }
  replaceEntry(entries, target, next)
  writeShijiEntries(dataDir, entries)
  return { ok: true, entry: next }
}

/**
 * 恢复 = 显式清墓碑（下一次扫描按在场源头重新出现；本轮不伪造内容）。
 * @returns {{ok: true, entry: object} | {ok: false, error: {code: string, message: string}}}
 */
export function restoreShijiEntry(dataDir, { id } = {}) {
  const entries = readShijiEntries(dataDir).entries
  const target = findEntry(entries, id)
  if (target === null) return { ok: false, error: { code: 'not-found', message: `事记不存在：${id}。` } }
  if (target.excludedAt === null) return { ok: true, entry: target } // 没删过：幂等
  const next = { ...target, excludedAt: null }
  replaceEntry(entries, target, next)
  writeShijiEntries(dataDir, entries)
  return { ok: true, entry: next }
}

/**
 * 人工「存成今天的事记」（契约 §2）：`source:'session'`、`manual:true`、同 refId 更新不新增。
 *
 * 自动扫描永不动这一类条目（不冻结、不覆盖）—— 它是人的一次显式落笔。
 * 摘要由调用方（`shiji.fromSession`）先生成；这里只负责写对形状。
 */
export function recordSessionShiji(dataDir, {
  sessionId, name, summary, summaryMode = 'llm', now = new Date(),
} = {}) {
  const refId = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (refId === '') return { ok: false, error: { code: 'invalid-session', message: '会话 id 不能为空。' } }
  if (typeof summary !== 'string' || summary.trim() === '') {
    return { ok: false, error: { code: 'summary-unavailable', message: '没有可写入的事记摘要（不写空条目）。' } }
  }
  const writtenAt = now.toISOString()
  const entries = readShijiEntries(dataDir).entries
  const existing = entries.find((entry) => entry.source === 'session' && entry.refId === refId) ?? null
  const id = existing?.id ?? shijiId('session', refId)
  const fingerprint = evidenceFingerprint({ sessions: [refId], docs: [] })
  const next = {
    schema: SHIJI_SCHEMA,
    id,
    source: 'session',
    refId,
    name: typeof name === 'string' && name.trim() !== '' ? name.trim() : '今天的问事',
    summary: summary.trim(),
    summaryMode: summaryMode === 'skeleton' ? 'skeleton' : 'llm',
    firstSeenAt: existing?.firstSeenAt ?? writtenAt,
    lastActiveAt: writtenAt,
    basis: { sessions: 1, docs: 0 },
    fingerprint,
    manual: true,
    frozenAt: null,
    // 人再次显式保存 = 明确要这一条：清掉墓碑（与「恢复」同义）。
    excludedAt: null,
  }
  if (existing === null) entries.push(next)
  else replaceEntry(entries, existing, next)
  writeShijiEntries(dataDir, entries)
  return { ok: true, entry: next }
}

/** 新条目的完整形状（字段顺序照契约 §1；标题/摘要都是已算好的）。 */
function buildEntry(item, { summary, fingerprint, nowIso }) {
  return {
    schema: SHIJI_SCHEMA,
    id: shijiId(item.source, item.refId),
    source: item.source,
    refId: item.refId,
    name: item.name,
    summary: summary.text,
    summaryMode: summary.mode,
    firstSeenAt: nowIso,
    lastActiveAt: item.lastActiveAt,
    basis: { sessions: item.basis?.sessions ?? 0, docs: item.basis?.docs ?? 0 },
    fingerprint,
    manual: false,
    frozenAt: null,
    excludedAt: null,
  }
}

/**
 * 扫描 + 更新账本（**先写 `shiji.jsonl`，再让底稿渲染** —— 由 `digao/generate.mjs` 调用）。
 *
 * @param {{ctx?: object, dataDir: string, dshHome?: string, now?: Date}} input
 * @returns {Promise<{entries: object[], notes: string[], scannedAt: string}>}
 */
export async function scanAndUpdateShiji(input = {}) {
  const absolute = resolve(input.dataDir)
  const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute
  const previous = pendingScans.get(key) ?? Promise.resolve()
  const pending = previous.catch(() => {}).then(() => updateScannedShiji(input))
  pendingScans.set(key, pending)
  try {
    return await pending
  } finally {
    if (pendingScans.get(key) === pending) pendingScans.delete(key)
  }
}

/**
 * 摘要等待期间人仍可删除、恢复或保存。只替换从扫描开始到现在未被别人改动的旧条目，
 * 其余以刚读回的最新账本为准；新的人工条目与墓碑因此不会被旧快照覆盖。
 * 读最新值到原子写之间没有 await，同一宿主内的同步写操作不会插进提交窗口。
 */
function mergeScannedEntries(initial, scanned, latest) {
  const keyOf = (entry) => shijiKey(entry.source, entry.refId)
  const initialByKey = new Map(initial.map((entry) => [keyOf(entry), entry]))
  const scannedByKey = new Map(scanned.map((entry) => [keyOf(entry), entry]))
  const latestKeys = new Set(latest.map(keyOf))
  const merged = latest.map((entry) => {
    const key = keyOf(entry)
    const before = initialByKey.get(key)
    if (before === undefined || JSON.stringify(before) !== JSON.stringify(entry)) return entry
    return scannedByKey.get(key) ?? entry
  })
  for (const entry of scanned) {
    const key = keyOf(entry)
    if (!latestKeys.has(key) && !initialByKey.has(key)) merged.push(entry)
  }
  return merged
}

/** 一次扫描本身；只有 scanAndUpdateShiji 的逐账本队列调用它。 */
async function updateScannedShiji({ ctx, dataDir, dshHome, now = new Date() }) {
  const scannedAt = now.toISOString()
  const read = readShijiEntries(dataDir)
  const notes = [...read.notes]
  const settings = readShijiSettings(dataDir)
  const evidence = await collectShijiEvidence({ ctx, dataDir, dshHome, excludedDirs: settings.excludedDirs, now })
  notes.push(...evidence.notes)

  const entries = read.entries.map((entry) => ({ ...entry }))
  const byKey = new Map(entries.map((entry) => [shijiKey(entry.source, entry.refId), entry]))
  const seen = new Set()

  for (const item of evidence.items) {
    const key = shijiKey(item.source, item.refId)
    seen.add(key)
    const current = byKey.get(key)
    // 墓碑优先：自动扫描永不重建（恢复只能是显式 RPC）。
    if (current !== undefined && current.excludedAt !== null) continue
    const fingerprint = evidenceFingerprint(item)

    if (current === undefined) {
      const summary = await summarizeShijiEvidence(ctx, item)
      if (summary.reason !== null) notes.push(`事记「${item.name}」摘要降级为 skeleton：${summary.reason}`)
      const entry = buildEntry(item, { summary, fingerprint, nowIso: scannedAt })
      entries.push(entry)
      byKey.set(key, entry)
      continue
    }

    const next = {
      ...current,
      name: item.name,
      lastActiveAt: item.lastActiveAt,
      basis: { sessions: item.basis?.sessions ?? 0, docs: item.basis?.docs ?? 0 },
      fingerprint,
      frozenAt: null,
    }
    // **只有指纹变了才重算摘要**（契约 §1 的成本口径）。
    if (current.fingerprint !== fingerprint) {
      const summary = await summarizeShijiEvidence(ctx, item)
      next.summary = summary.text
      next.summaryMode = summary.mode
      if (summary.reason !== null) notes.push(`事记「${item.name}」摘要降级为 skeleton：${summary.reason}`)
    }
    replaceEntry(entries, current, next)
    byKey.set(key, next)
  }

  // 源头消失：写冻结并保留（只写一次；人工条目永不冻结）。
  //
  // ⚠️ 「服务缺席」不等于「源头消失」（仓库纪律：核不了 ≠ 没有）。扫描会给出 `routes`：
  // 某一路整个核不了时**这一轮不冻结任何该路条目** —— 否则一次服务抖动会把所有工作区事记
  // 误标成「已消失」，而它们其实还在。
  for (const entry of entries) {
    if (entry.source === 'session' || entry.excludedAt !== null) continue
    if (seen.has(shijiKey(entry.source, entry.refId))) continue
    const routeAvailable = entry.source === 'workspace' ? evidence.routes?.workspace !== false : evidence.routes?.workflow !== false
    if (!routeAvailable) continue
    if (entry.frozenAt === null) entry.frozenAt = scannedAt
  }

  // 不能拿开始扫描时的整账快照直接盖回去：中间跨过会话读取与若干次模型调用。
  // 最新账本读失败时直接终止（store 只把 ENOENT 当空账），不冒险重建墓碑。
  const latest = readShijiEntries(dataDir)
  const merged = mergeScannedEntries(read.entries, entries, latest.entries)
  for (const note of latest.notes) if (!notes.includes(note)) notes.push(note)
  writeShijiEntries(dataDir, merged)
  return { entries: [...merged].sort(byLastActiveDesc), notes, scannedAt }
}
