/**
 * packages/xuanshu-host/lib/wansheng/facts.mjs — 晚省的**确定性事实**采集（#25 契约 §1）。
 *
 * 晚省的全部内容就是这几条事实：今天几场问事、哪些项目有活动、底稿/日课何时生成、事记何时更新。
 * **不调任何模型**（测试断言 fake llm 调用数 === 0）：模型写不出「今天发生了什么」，
 * 让它写只会把可核对的事实变成不可核对的话。
 *
 * 四条数据来源与判据（逐字照契约 §1）：
 *   - **问事**：`<dataDir>/consult/sessions/*.json`（`consult.list` 的同一份旁挂清单，会话级）——
 *     `createdAt` **或** `lastTurnAt` 落在当天就算「今天有活动」（昨天开、今天还在问的场次不该漏）；
 *   - **项目（工作区）**：`ctx.workspaceRegistry.list()` + `ctx.sessionQuery.listSessions()` 的 header，
 *     活动时刻 = `max(createdAt, lastPromptAt)`（与 DSH 侧栏同口径；事记扫描的既有判据）；
 *   - **底稿 / 日课**：纯文件读（`digao.json` 的 `generatedAt`、`rikke/<date>.json` 的 `generatedAt`）；
 *   - **事记**：`shiji.jsonl` 里最大的 `lastActiveAt`（只读时间，不展开条目）。
 *
 * **拿不到就省略键**（契约 §1 与 `rikke.status` 同纪律）：
 *   - 工作区/会话服务不在场、事记文件不存在、底稿/日课还没生成 → 对应键整键不出现；
 *   - 每一种省略都在 `notes` 里写下理由（「未知」不是「没有」）。
 */

import { basename } from 'node:path'

import { createConsultStore } from '../consult/store.mjs'
import { readDigaoMeta } from '../digao/store.mjs'
import { readShijiEntries } from '../shiji/store.mjs'
import { dateInZone, readRikke } from '../rikke/store.mjs'

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
 * 项目这一路：工作区里「今天有活动」的那些（会话 header 的 max(createdAt,lastPromptAt)）。
 * @returns {Promise<{value: object[]|null, note: string|null}>} `value:null` = 核不了（省键）
 */
async function collectActiveWorkspaces({ ctx, date, zone }) {
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

  const query = softGet(ctx, 'sessionQuery')
  if (typeof query?.listSessions !== 'function') {
    return { value: null, note: 'sessionQuery 服务不可得：会话 header 读不出，项目活动这一项按「未知」处理。' }
  }
  let records
  try {
    records = await query.listSessions()
  } catch (error) {
    return { value: null, note: `会话清单读不出来（${String(error?.message ?? error)}）：项目活动这一项按「未知」处理。` }
  }
  const headers = new Map()
  for (const record of Array.isArray(records) ? records : []) {
    const id = text(record?.header?.id)
    if (id !== '') headers.set(id, record.header)
  }

  const out = []
  for (const workspace of workspaces) {
    if (workspace === null || typeof workspace !== 'object') continue
    const id = text(workspace.id)
    if (id === '') continue
    const title = text(workspace.title) || (text(workspace.path) === '' ? '工作区' : basename(text(workspace.path)))
    const sessionIds = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
    let sessionCount = 0
    let lastActiveMs = null
    for (const sessionId of sessionIds) {
      const header = headers.get(text(sessionId))
      if (header === undefined) continue
      const createdMs = toMs(header.createdAt)
      const promptMs = toMs(header.lastPromptAt)
      const activeMs = Math.max(createdMs ?? -Infinity, promptMs ?? -Infinity)
      if (!Number.isFinite(activeMs)) continue
      if (dayOf(zone, activeMs) !== date) continue
      sessionCount += 1
      if (lastActiveMs === null || activeMs > lastActiveMs) lastActiveMs = activeMs
    }
    if (lastActiveMs === null) continue
    out.push({ id, title, sessionCount, lastActiveAt: new Date(lastActiveMs).toISOString() })
  }
  out.sort((left, right) => (left.lastActiveAt === right.lastActiveAt
    ? (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    : left.lastActiveAt < right.lastActiveAt ? 1 : -1))
  return { value: out, note: null }
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

/** 事记这一路：账本里最大的 `lastActiveAt`（文件不存在 / 没有条目 → 省键）。 */
function collectShiji(dataDir) {
  let entries
  try {
    entries = readShijiEntries(dataDir).entries
  } catch {
    return undefined
  }
  let latest = null
  for (const entry of entries) {
    const ms = toMs(entry?.lastActiveAt)
    if (ms === null) continue
    if (latest === null || ms > latest) latest = ms
  }
  return latest === null ? undefined : { updatedAt: new Date(latest).toISOString() }
}

/**
 * 采集晚省的全部事实（**同步数据源 + 一个 async 会话清单**；不联网、不调模型）。
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

  const workspaces = await collectActiveWorkspaces({ ctx, date, zone })
  if (workspaces.note !== null) notes.push(workspaces.note)
  if (workspaces.value !== null) facts.activeWorkspaces = workspaces.value

  const digao = collectDigao(dataDir)
  if (digao !== undefined) facts.digao = digao
  const rikke = collectRikke(dataDir, date)
  if (rikke !== undefined) facts.rikke = rikke
  const shiji = collectShiji(dataDir)
  if (shiji !== undefined) facts.shiji = shiji

  return { facts, notes }
}
