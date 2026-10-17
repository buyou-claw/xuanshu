/**
 * packages/xuanshu-host/lib/notify/traffic.mjs — 触达账 `<dataDir>/traffic.jsonl`（冻结契约 §4）。
 *
 * 为什么是 append-only JSONL：这行账同时是「补课不重复投递 / 同一天不补两次」（#25）的唯一权威。
 * 若拿 `schedule.lastDelivery` 当账，它只记「进过 inbox」，不记通知成没成 —— 于是「推失败了」
 * 会被界面读成「推过了」（ADR-0014:26 明确不允许）。
 *
 * 三条纪律：
 *   - **一次投递尝试 = 一行**；坏行（写了一半 / 手改坏）**跳过**，不让整份账变成不可读；
 *   - `read` 是唯一的可变字段（`markRead` 只改它），其余字段写入即冻结；
 *   - 「未读」判据 = `notify.status==='delivered' && read!==true` 的条数（**不另存计数**）。
 *     `skipped`（人点生成 / 没有壳）与 `failed` 都不算未读 —— 未读的语义是「推到了但你没看」。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

import { writeAtomic } from '../atomic.mjs'
import { NOTIFY_KINDS, NOTIFY_STATUSES, TRAFFIC_SCHEMA } from './contract.mjs'

// schema 的唯一来源在 `contract.mjs`；账本再导出同一绑定（读面 / 测试 / #25 都从一处取）。
export { TRAFFIC_SCHEMA }

/** 账文件名（契约 §4 定值）。 */
export const TRAFFIC_FILE = 'traffic.jsonl'

/** `<dataDir>/traffic.jsonl`。 */
export function trafficFile(dataDir) {
  return join(dataDir, TRAFFIC_FILE)
}

/** `YYYY-MM-DD`（与日课产物同日历口径）。 */
function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
}

/** ISO 时间串判定（写入前的形状门；读面不重判，坏行跳过）。 */
function isIsoTime(value) {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value))
}

/** 一行账的结构（读取时用：不认的行跳过）。 */
export function isTrafficRow(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.schema !== TRAFFIC_SCHEMA) return false
  if (typeof value.id !== 'string' || value.id === '') return false
  if (!NOTIFY_KINDS.includes(value.kind)) return false
  if (!isIsoTime(value.at)) return false
  if (value.notify === null || typeof value.notify !== 'object') return false
  return NOTIFY_STATUSES.includes(value.notify.status)
}

/**
 * 组装一行账（**写入前的唯一形状门**）。
 *
 * @param {{kind: string, date: string, occurrenceAt?: string, generated?: boolean, artifactPath?: string|null,
 *          notify: {status: string, reason?: string|null}, read?: boolean, missed?: boolean,
 *          at?: string, id?: string}} input
 * @returns {object}
 */
export function buildTrafficEntry(input = {}) {
  const {
    kind, date, occurrenceAt, generated = true, artifactPath = null, notify, read = false, missed = false,
    at = new Date().toISOString(), id,
  } = input
  if (!NOTIFY_KINDS.includes(kind)) {
    throw new Error(`触达账的 kind 不认识：${JSON.stringify(kind)}（只认 ${NOTIFY_KINDS.join(' / ')}）`)
  }
  if (!isDate(date)) throw new Error(`触达账的 date 非法：${JSON.stringify(date)}（要 YYYY-MM-DD）`)
  if (!isIsoTime(at)) throw new Error(`触达账的 at 非法：${JSON.stringify(at)}`)
  if (occurrenceAt !== undefined && !isIsoTime(occurrenceAt)) {
    throw new Error(`触达账的 occurrenceAt 非法：${JSON.stringify(occurrenceAt)}`)
  }
  const status = notify?.status
  if (!NOTIFY_STATUSES.includes(status)) {
    throw new Error(`触达账的 notify.status 不认识：${JSON.stringify(status)}（只认 ${NOTIFY_STATUSES.join(' / ')}）`)
  }
  const reason = typeof notify?.reason === 'string' && notify.reason !== '' ? notify.reason : null
  if (status !== 'delivered' && reason === null) {
    // 「没成」必须说得出理由：一行只有 status 的 failed/skipped 会让界面无话可说。
    throw new Error(`触达账的 notify.status=${status} 必须带可读的 reason`)
  }
  return {
    schema: TRAFFIC_SCHEMA,
    id: typeof id === 'string' && id !== '' ? id : `traffic-${randomUUID()}`,
    at,
    kind,
    date,
    occurrenceAt: occurrenceAt ?? at,
    generated: generated === true,
    artifactPath: typeof artifactPath === 'string' ? artifactPath : null,
    notify: { status, reason },
    read: read === true,
    missed: missed === true,
  }
}

/**
 * 追加一行（append-only；目录按需建）。
 * @param {string} dataDir
 * @param {object} entry 已由 `buildTrafficEntry` 组装的账行
 * @returns {object} 写进去的那一行
 */
export function appendTraffic(dataDir, entry) {
  if (!isTrafficRow(entry)) throw new Error('要追加的触达账行不合契约（schema / id / kind / at / notify.status 缺一不可）')
  mkdirSync(dirname(trafficFile(dataDir)), { recursive: true })
  appendFileSync(trafficFile(dataDir), `${JSON.stringify(entry)}\n`, 'utf8')
  return entry
}

/**
 * 读账（最新在前；坏行跳过）。
 *
 * 读面是**三态**，因为「文件不存在」与「文件在但读不出来」是两件事：
 *   - `state:'missing'`    → 没投过 = 合法空账，`unread: 0` 是真话；
 *   - `state:'unreadable'` → 账在但读失败 = **未知**，`unread: null`（调用方据此省略键，
 *                            绝不写 0 冒充「都读过了」——ADR-0014:26 点名的那类静默失效）；
 *   - `state:'ok'`         → 读到了，`unread` 是实数。
 * `exists` 保留旧语义：只有**可读**的账才是 true（`rikke.status` / `wansheng.status` 据此省略 unread）。
 *
 * @param {string} dataDir
 * @param {{limit?: number}} [options] `limit` 只截 `entries`，`unread` 仍按全账算（界面 badge 不能用被截的页算）
 * @returns {{state: 'missing'|'unreadable'|'ok', entries: object[], unread: number|null, exists: boolean,
 *            lastFailure?: {at: string, kind: string, reason: string|null}}}
 */
export function readTraffic(dataDir, { limit } = {}) {
  const file = trafficFile(dataDir)
  if (!existsSync(file)) return { state: 'missing', entries: [], unread: 0, exists: false }

  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    // 账读不出来 = 未知，不是空账；`unread: null` 让调用方省略键（不写 0 冒充「都读过了」）。
    return { state: 'unreadable', entries: [], unread: null, exists: false }
  }

  const rows = []
  for (const line of text.split(/\r?\n/u)) {
    if (line.trim() === '') continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!isTrafficRow(parsed)) continue
    rows.push(parsed)
  }
  rows.reverse() // 文件是 append 顺序（旧在前），读面要求最新在前

  const unread = rows.filter((row) => row.notify.status === 'delivered' && row.read !== true).length
  const failed = rows.find((row) => row.notify.status === 'failed')
  const out = {
    state: 'ok',
    entries: Number.isInteger(limit) && limit >= 0 ? rows.slice(0, limit) : rows,
    unread,
    exists: true,
  }
  if (failed !== undefined) out.lastFailure = { at: failed.at, kind: failed.kind, reason: failed.notify.reason ?? null }
  return out
}

/**
 * 把若干条账标成已读（**只改 `read`**）。
 *
 * 为什么必须逐行重写而不是追加一条「已读」事件：契约 §4 说 `read` 是行上的字段，
 * 读面也只认它。重写时**坏行与不认识的行走原样**（逐字保留），否则一次「标已读」会把证据洗掉。
 *
 * @param {string} dataDir
 * @param {string[]} ids
 * @returns {{ok: true, updated: number}}
 */
export function markTrafficRead(dataDir, ids) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw new Error('traffic.markRead 的 ids 必须是字符串数组')
  }
  const file = trafficFile(dataDir)
  if (!existsSync(file)) return { ok: true, updated: 0 }
  const wanted = new Set(ids.filter((id) => id !== ''))
  if (wanted.size === 0) return { ok: true, updated: 0 }

  const original = readFileSync(file, 'utf8')
  let updated = 0
  const next = original.split(/\r?\n/u).map((line) => {
    if (line.trim() === '') return line
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      return line // 坏行逐字保留
    }
    if (!isTrafficRow(parsed)) return line
    if (!wanted.has(parsed.id) || parsed.read === true) return line
    updated += 1
    return JSON.stringify({ ...parsed, read: true })
  })
  if (updated > 0) writeAtomic(file, next.join('\n'))
  return { ok: true, updated }
}
