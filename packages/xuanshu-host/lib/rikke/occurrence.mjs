/**
 * packages/xuanshu-host/lib/rikke/occurrence.mjs — 到点消息里的「这一次是替哪个时刻投的」。
 *
 * 为什么必须从消息正文解析（而不是回读 `ctx.schedule` 的 `lastDelivery`）：
 *   - `lastDelivery` 的 commit 发生在 `sessions.flush()` **之后**（`dsh-schedule/lib/index.js:1596-1602`
 *     先 followup→flush，`:1611-1626` 才 commit）——在 `pre-step` 里读到的可能还是上一轮的值；
 *   - 消息正文里的 `reminders_json[0].occurrence_at` 是**这一次投递自带的**，没有竞态。
 *
 * 这条解析还修掉一个真 bug：旧实现用**投递时刻**算日期（`dateInZone(zone, moment)`）。进程在
 * 10-16 06:00 起来补 10-15 07:30 那一次时，旧实现会给「明天」写一份日课，而 10-15 那份永远不生成。
 *
 * 形状出处（本机实装 0.2.0-rc.2，只读核对）：
 *   - 批量：`[SCHEDULE REMINDER BATCH]\n…\nreminders_json: [{…,"occurrence_at":…}]`（`index.js:1407-1418`）；
 *   - 单条：`[SCHEDULE REMINDER]\n…\noccurrence_at: …`（`index.js:1393-1401`）。
 *
 * 纪律：**永不抛**；解析不出 → `{at:null, source:'fallback', note}`，调用方退回投递时刻并如实记一笔。
 */

import { zoneOffsetMinutes } from '../bazi/timezone.mjs'

/** 迟到多久算「补」（契约 §3：投递迟于 occurrence 超过 30 分钟 → 产物与账行都标 missed）。 */
export const MISSED_LATE_MS = 30 * 60 * 1000

/** 一条消息的正文（content 可能是数组分片，也可能是纯字符串 —— 两种都认）。 */
function messageText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
}

/** 解析一个时间串；认不出 → null。 */
function parseInstant(value) {
  const text = typeof value === 'string' ? value.trim().replace(/^"(.*)"$/u, '$1') : ''
  if (text === '') return null
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? new Date(ms) : null
}

/**
 * 从 `reminders_json` 里取第一条的 `occurrence_at`。
 * @param {string} text 消息正文
 * @returns {Date|null}
 */
function fromRemindersJson(text) {
  // 数组在真机正文里是一整行；`reminder_prompt` 里可能带 `]`，所以先截到行尾再 JSON.parse，
  // 失败就按「带引号的 occurrence_at」兜底（宁可退回投递时刻，也不猜一个日期）。
  const match = /reminders_json:\s*(\[[^\n]*\])/u.exec(text)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1])
    const first = Array.isArray(parsed) ? parsed[0] : null
    return parseInstant(first?.occurrence_at)
  } catch {
    return null
  }
}

/** 单条 framing 的裸 `occurrence_at: <ISO>`。 */
function fromOccurrenceLine(text) {
  const match = /occurrence_at:\s*"?([^"\n]+)"?/u.exec(text)
  return match ? parseInstant(match[1]) : null
}

/**
 * 解析「这一次投递属于哪个计划时刻」。
 *
 * @param {unknown} messages loop 交给 `pre-step` 的 claimed 消息
 * @returns {{at: Date|null, source: 'reminders_json'|'occurrence_at'|'fallback', note: string|null}}
 *          `at:null` = 解析不出（调用方退回投递时刻，`note` 里写明为什么）
 */
export function parseScheduleOccurrence(messages) {
  const texts = (Array.isArray(messages) ? messages : []).map(messageText).filter((text) => text !== '')
  for (const text of texts) {
    const at = fromRemindersJson(text)
    if (at !== null) return { at, source: 'reminders_json', note: null }
  }
  for (const text of texts) {
    const at = fromOccurrenceLine(text)
    if (at !== null) return { at, source: 'occurrence_at', note: null }
  }
  return {
    at: null,
    source: 'fallback',
    note: '到点消息里没有可解析的 occurrence_at：日期退回投递时刻（这一投如果迟到了，无法从消息判断它替哪一天投）。',
  }
}

/**
 * 这次投递是不是「补」：迟于计划时刻超过 30 分钟（同一天迟到也算补，契约 §3）。
 * @param {Date|null} occurrenceAt
 * @param {Date} moment 投递时刻
 */
export function isLateDelivery(occurrenceAt, moment) {
  if (!(occurrenceAt instanceof Date) || !(moment instanceof Date)) return false
  return moment.getTime() - occurrenceAt.getTime() > MISSED_LATE_MS
}

/**
 * 某个时区里的「某天 HH:mm」对应的 UTC 瞬间（补课的账行 `occurrenceAt` 用它）。
 *
 * 复用票 08 的 `zoneOffsetMinutes`（含 DST 与固定偏移串两种写法）—— 不自己硬编码 +08:00。
 * @param {string} zone IANA 名或固定偏移串
 * @param {string} date `YYYY-MM-DD`（当地日期）
 * @param {string} time `HH:mm`
 * @returns {Date|null} 算不出 → null
 */
export function dayAtZoneTime(zone, date, time) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(date ?? '').trim())
  const timeMatch = /^(\d{1,2}):(\d{2})/u.exec(String(time ?? '').trim())
  if (!dateMatch || !timeMatch) return null
  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  const offset = zoneOffsetMinutes(zone, date, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
  if (offset === null) return null
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offset * 60_000)
}
