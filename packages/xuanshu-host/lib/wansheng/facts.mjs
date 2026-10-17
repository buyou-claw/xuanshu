/**
 * packages/xuanshu-host/lib/wansheng/facts.mjs — 晚省的**确定性事实**采集（#25 契约 §1）。
 *
 * 晚省的全部内容就是这几条事实：今天几场问事、哪些项目有活动、底稿/日课何时生成、事记何时更新。
 * **不调任何模型**（测试断言 fake llm 调用数 === 0）：模型写不出「今天发生了什么」，
 * 让它写只会把可核对的事实变成不可核对的话。
 *
 * 数据来源与判据（契约 §1；工作流补足 Spec 002:127 的并列来源）：
 *   - **问事**：`<dataDir>/consult/sessions/*.json`（`consult.list` 的同一份旁挂清单，会话级）——
 *     `createdAt` **或** `lastTurnAt` 落在当天就算「今天有活动」（昨天开、今天还在问的场次不该漏）；
 *   - **项目（工作区）**：`ctx.workspaceRegistry.list()` + 会话 header 与 `sessionListMetadata` 投影，
 *     活动时刻 = `max(header.createdAt, metadata.lastPromptAt)`（与 DSH 侧栏同口径）；
 *     投影拿不到时读会话日志，仍拿不到则按未知处理，不能静默漏报续问过的项目；
 *   - **工作流**：`workflow/*.json` 清单（与工作区并列），会话活动与创建/导出时间取最新；
 *   - **底稿 / 日课**：纯文件读（`digao.json` 的 `generatedAt`、`rikke/<date>.json` 的 `generatedAt`）；
 *   - **事记**：`shiji.jsonl` 里最大的 `lastActiveAt`（只读时间，不展开条目）。
 *
 * **拿不到就省略键**（契约 §1 与 `rikke.status` 同纪律）：
 *   - 工作区/会话服务不在场、事记文件不存在、底稿/日课还没生成 → 对应键整键不出现；
 *   - 每一种省略都在 `notes` 里写下理由（「未知」不是「没有」）。
 */

import { basename } from 'node:path'

import { isUserPromptEvent, readSessionProjection, sessionHeadersOf } from '../consult/session-activity.mjs'
import { createConsultStore } from '../consult/store.mjs'
import { readDigaoMeta } from '../digao/store.mjs'
import { readShijiEntries } from '../shiji/store.mjs'
import { dateInZone, readRikke } from '../rikke/store.mjs'
import { listWorkflows } from '../workflow/store.mjs'

/** 单次晚省里最多列多少场问事（事实清单，不是全量导出；超出的仍计入 count）。 */
export const CONSULT_ITEM_LIMIT = 20

/** 非空字符串。 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 时间值（ISO 字符串 / epoch 毫秒）→ 毫秒；认不出 → null。 */
function toMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** 某个时区里的「哪一天」（毫秒输入）。 */
function dayOf(zone, ms) {
  return Number.isFinite(ms) ? dateInZone(zone, new Date(ms)) : null
}

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : ctx?.[name]
  } catch {
    return undefined
  }
}

/**
 * 问事这一路：旁挂清单里 `createdAt` / `lastTurnAt` 落在当天的场次。
 * @returns {{value: object|null, note: string|null}} `value:null` = 拿不到（省键）
 */
function collectConsultSessions({ dataDir, date, zone }) {
  let manifests
  try {
    manifests = createConsultStore(dataDir).list()
  } catch (error) {
    return { value: null, note: `问事清单读不出来（${String(error?.message ?? error)}）：今天几场问事这一项按「未知」处理。` }
  }
  const items = []
  let count = 0
  for (const manifest of manifests) {
    const createdAtMs = toMs(manifest.createdAt)
    const lastTurnMs = toMs(manifest.lastTurnAt)
    const activeToday = dayOf(zone, createdAtMs) === date || dayOf(zone, lastTurnMs) === date
    if (!activeToday) continue
    count += 1
    if (items.length >= CONSULT_ITEM_LIMIT) continue
    items.push({
      sessionId: manifest.sessionId,
      title: manifest.title,
      ...(lastTurnMs === null ? {} : { lastTurnAt: new Date(lastTurnMs).toISOString() }),
    })
  }
  return { value: { count, items }, note: null }
}

/**
 * 会话的活动时间：header 只带 createdAt，lastPromptAt 属于 sessionListMetadata 投影。
 * 钉版证据：dsh-session/lib/types/types.d.ts:58–100（SessionHeader 闭集）；
 * dsh-api-session-controller/lib/index.js:1809,2041（只数人的提问，活动取二者最大值）。
 * 投影明确 null = 没有提问；缺键 / 服务缺席 / 缓存抛错才回落读日志（与事记扫描同口径）。
 *
 * 「投影缓存 → 日志回落」的**零件**与 `shiji/scan.mjs` 共用（`consult/session-activity.mjs`），
 * 但**策略**两边有意不同：这里拿不到就抛（调用方省略整个事实键），事记那边记 note 继续。
 * 差异表见 `tests/wansheng/session-activity-parity.test.mjs`。
 *
 * @returns {Promise<number|null>} null = 该会话已不存在；核不了时抛给采集面省略整键。
 */
async function sessionActivity(header, query, cache) {
  let promptMs = null
  let known = false
  const projection = readSessionProjection(cache, header, ['sessionListMetadata'])
  if (projection.available) {
    const metadata = projection.values?.sessionListMetadata
    if (metadata?.lastPromptAt === null) known = true
    else if (metadata?.lastPromptAt !== undefined) {
      promptMs = toMs(metadata.lastPromptAt)
      known = promptMs !== null
    }
  }
  if (!known) {
    if (typeof query.readSession !== 'function') throw new Error('投影缺席且 readSession 服务不可得')
    let snapshot
    try {
      snapshot = await query.readSession(header.id)
    } catch (error) {
      if (error?.code === 'SESSION_QUERY_SESSION_NOT_FOUND') return null
      throw error
    }
    if (!Array.isArray(snapshot?.events)) throw new Error('会话日志没有可核对的 events 数组')
    for (const event of snapshot.events) {
      if (!isUserPromptEvent(event)) continue
      const at = toMs(event.time)
      if (at === null) throw new Error('用户提问缺少有效时间')
      if (promptMs === null || at > promptMs) promptMs = at
    }
  }
  const activeMs = Math.max(toMs(header.createdAt) ?? -Infinity, promptMs ?? -Infinity)
  if (!Number.isFinite(activeMs)) throw new Error('会话没有可核对的创建或提问时间')
  return activeMs
}

/** 工作区与工作流共用一次会话清单和同一份活动判据，按需读取；同会话不重复读日志。 */
function createActivityReader(ctx) {
  const query = softGet(ctx, 'sessionQuery')
  const cache = softGet(ctx, 'sessionProjectionCache')
  let headersPromise
  const activities = new Map()
  const loadHeaders = async () => {
    if (typeof query?.listSessions !== 'function') throw new Error('sessionQuery 服务不可得：会话 header 读不出')
    const records = await query.listSessions()
    if (!Array.isArray(records)) throw new Error('会话清单不是数组')
    return sessionHeadersOf(records, text)
  }
  return async (sessionId) => {
    const id = text(sessionId)
    if (id === '') throw new Error('没有可核对的会话 id')
    headersPromise ??= loadHeaders()
    const header = (await headersPromise).get(id)
    if (header === undefined) return null
    if (!activities.has(id)) activities.set(id, sessionActivity(header, query, cache))
    return activities.get(id)
  }
}

/** 活动最新的排前面；同刻按 id 排序，保证文件可重复核对。 */
function byActivity(left, right) {
  return left.lastActiveAt === right.lastActiveAt
    ? (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    : left.lastActiveAt < right.lastActiveAt ? 1 : -1
}

/**
 * 项目这一路：工作区里「今天有活动」的那些（会话创建与最后一次人的提问时间取最大值）。
 * @returns {Promise<{value: object[]|null, note: string|null}>} `value:null` = 核不了（省键）
 */
async function collectActiveWorkspaces({ ctx, date, zone, readActivity }) {
  const registry = softGet(ctx, 'workspaceRegistry')
  if (typeof registry?.list !== 'function') {
    return { value: null, note: 'workspaceRegistry 服务不可得：哪些项目有活动这一项按「未知」处理（不伪造）。' }
  }
  let workspaces
  try {
    workspaces = registry.list()
  } catch (error) {
    return { value: null, note: `工作区清单读不出来（${String(error?.message ?? error)}）：项目活动这一项按「未知」处理。` }
  }
  if (!Array.isArray(workspaces)) {
    return { value: null, note: '工作区清单不是数组：项目活动这一项按「未知」处理。' }
  }

  const out = []
  for (const workspace of workspaces) {
    if (workspace === null || typeof workspace !== 'object') continue
    const id = text(workspace.id)
    if (id === '') continue
    const title = text(workspace.title) || (text(workspace.path) === '' ? '工作区' : basename(text(workspace.path)))
    const sessionIds = [...new Set(Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [])]
    let sessionCount = 0
    let lastActiveMs = null
    for (const sessionId of sessionIds) {
      let activeMs
      try {
        activeMs = await readActivity(sessionId)
      } catch (error) {
        return { value: null, note: `会话活动核不了（${sessionId}，${String(error?.message ?? error)}）：项目活动这一项按「未知」处理。` }
      }
      if (activeMs === null) continue
      if (dayOf(zone, activeMs) !== date) continue
      sessionCount += 1
      if (lastActiveMs === null || activeMs > lastActiveMs) lastActiveMs = activeMs
    }
    if (lastActiveMs === null) continue
    out.push({ id, title, sessionCount, lastActiveAt: new Date(lastActiveMs).toISOString() })
  }
  out.sort(byActivity)
  return { value: out, note: null }
}

/** 工作流这一路：一工作流一会话；创建或导出也是可核对的活动，不必等下一次提问。 */
async function collectActiveWorkflows({ dataDir, date, zone, readActivity }) {
  let records
  try {
    records = listWorkflows(dataDir, { strict: true })
  } catch (error) {
    return { value: null, note: `工作流清单读不出来（${String(error?.message ?? error)}）：工作流活动这一项按「未知」处理。` }
  }
  const out = []
  for (const record of records) {
    const sessionId = text(record.sessionId)
    const id = text(record.id) || sessionId
    const title = text(record.name) || text(record.seed).split(/\r?\n/u)[0] || '工作流'
    let sessionMs
    try {
      sessionMs = await readActivity(sessionId)
    } catch (error) {
      return { value: null, note: `工作流「${title}」的会话活动核不了（${sessionId}，${String(error?.message ?? error)}）：工作流活动这一项按「未知」处理。` }
    }
    const activeMs = Math.max(toMs(record.createdAt) ?? -Infinity, toMs(record.exportedAt) ?? -Infinity, sessionMs ?? -Infinity)
    if (!Number.isFinite(activeMs) || dayOf(zone, activeMs) !== date) continue
    out.push({
      id, title,
      sessionCount: sessionMs !== null && dayOf(zone, sessionMs) === date ? 1 : 0,
      lastActiveAt: new Date(activeMs).toISOString(),
    })
  }
  return { value: out.sort(byActivity), note: null }
}

/** 底稿这一路：`digao.json` 的 `generatedAt`（没有就省键）。 */
function collectDigao(dataDir) {
  const meta = readDigaoMeta(dataDir)
  const generatedAt = text(meta?.generatedAt)
  return generatedAt === '' ? undefined : { generatedAt }
}

/** 日课这一路：当天产物的 `generatedAt`（没有就省键；坏产物不当成有）。 */
function collectRikke(dataDir, date) {
  const read = readRikke(dataDir, date)
  if (read.state !== 'ready') return undefined
  const generatedAt = text(read.record?.generatedAt)
  return generatedAt === '' ? undefined : { generatedAt }
}

/**
 * 事记这一路：账本里最大的 `lastActiveAt`（文件不存在 / 没有条目 → 省键）。
 *
 * 读失败（EISDIR / EACCES / 坏行…）**不许空 `catch {}` 吞掉**（复核 (c)①）：省略键是「拿不到」，
 * 但用户必须能看到为什么 —— 原因回给调用方写进 `notes`（晚省整体仍可用，只少这一路事实）。
 *
 * @returns {{value: object|undefined, note: string|null}}
 */
function collectShiji(dataDir) {
  let entries
  try {
    entries = readShijiEntries(dataDir).entries
  } catch (error) {
    return { value: undefined, note: `事记读不出来（${String(error?.message ?? error)}）：本轮不展示事记活动。` }
  }
  let latest = null
  for (const entry of entries) {
    const ms = toMs(entry?.lastActiveAt)
    if (ms === null) continue
    if (latest === null || ms > latest) latest = ms
  }
  return { value: latest === null ? undefined : { updatedAt: new Date(latest).toISOString() }, note: null }
}

/**
 * 采集晚省的全部事实（本地数据源，异步读取会话证据；不联网、不调模型）。
 *
 * @param {{ctx: object, dataDir: string, date: string, zone: string}} input
 *        `zone`：底座时区（决定「今天」是哪一天）
 * @returns {Promise<{facts: object, notes: string[]}>} 拿不到的键整键不出现，理由进 `notes`
 */
export async function collectWanshengFacts({ ctx, dataDir, date, zone }) {
  const notes = []
  const facts = {}

  const consult = collectConsultSessions({ dataDir, date, zone })
  if (consult.note !== null) notes.push(consult.note)
  if (consult.value !== null) facts.consultSessions = consult.value

  const readActivity = createActivityReader(ctx)
  const workspaces = await collectActiveWorkspaces({ ctx, date, zone, readActivity })
  if (workspaces.note !== null) notes.push(workspaces.note)
  if (workspaces.value !== null) facts.activeWorkspaces = workspaces.value
  const workflows = await collectActiveWorkflows({ dataDir, date, zone, readActivity })
  if (workflows.note !== null) notes.push(workflows.note)
  if (workflows.value !== null) facts.activeWorkflows = workflows.value

  const digao = collectDigao(dataDir)
  if (digao !== undefined) facts.digao = digao
  const rikke = collectRikke(dataDir, date)
  if (rikke !== undefined) facts.rikke = rikke
  const shiji = collectShiji(dataDir)
  if (shiji.note !== null) notes.push(shiji.note)
  if (shiji.value !== undefined) facts.shiji = shiji.value

  return { facts, notes }
}
