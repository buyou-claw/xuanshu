/**
 * packages/xuanshu-host/lib/bazi/timezone.mjs — 坐标 → IANA zone → 含 DST 的 UTC 偏移（票 08 契约 §4）。
 *
 * 两条腿，都是**离线**的（向导要能断网用，契约 §0 验收 1）：
 *   ① 坐标 → IANA zone：`tz-lookup`（本包运行时依赖；上游 `astrostudyui/src/utils/timezone.js`
 *      同款方案）。它的时间zone 数据是**它自己的**：升级 tz-lookup 可能让同一坐标落到另一个 zone，
 *      所以 package.json 里钉的是精确版本 `6.1.25`，不是 `^`。
 *      （许可证：包内 package.json 写的是 **CC0-1.0**，不是契约 §4 笔下的 MIT；CC0 比 MIT 更宽松，
 *      对 AGPL-3.0-only 的玄枢没有额外约束。）
 *   ② zone + 本地日期 → 偏移：`Intl.DateTimeFormat`（Node 24 自带完整 ICU，含 1918 年以来的
 *      历史 DST 规则）。**绝不硬编码任何偏移**——「中国 = +08:00」会把 1986–1991 出生的人
 *      整体算错一小时，而真太阳时与四柱都建在这个偏移上。
 *
 * 判据出处（上游 `astrostudyui/src/utils/timezone.js::offsetForZoneAtDate` / `isDstActiveAt`）：
 *   - 取「当日正午的 UTC 瞬间」当锚点读 `timeZoneName: 'longOffset'`，避开 DST 切换那一刻的歧义；
 *   - `dst` 用**同年 1 月 15 日与 7 月 15 日的偏移对比**得出（更大的那个 = 夏令时），
 *     与当前偏移比较；南北半球都成立（悉尼一月是夏令时）。
 *
 * 本模块**不抛**：任何异常都折算成 `null`（契约 §4：界面必须能落回手改时区）。
 */

import tzlookup from 'tz-lookup'

import { UNKNOWN_TIMEZONE } from './constants.mjs'

/** 表单/JSON 两种形态都要认：数字，或数字字符串（空白串/对象/null 一律算「没给」）。 */
function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value.trim())
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}

/**
 * 坐标可用性（契约 §4）。三条拒绝理由都要拦：
 *   - 非有限数 / 缺一个（`lat` 或 `lon`）；
 *   - 越界（纬度 ±90、经度 ±180）；
 *   - **(0,0)**：几内亚湾海面，tz-lookup 会给 `Etc/GMT` —— 拿它当出生地时区是编造，视图必须落回手改。
 * @returns `{lat, lon}`（数字）或 null
 */
export function usableCoordinate(lat, lon) {
  const la = toFiniteNumber(lat)
  const lo = toFiniteNumber(lon)
  if (la === null || lo === null) return null
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null
  if (la === 0 && lo === 0) return null
  return { lat: la, lon: lo }
}

/**
 * 坐标 → IANA zone 名（`tz-lookup`）。坐标不可用或 lookup 抛错 → null。
 * @returns {string|null}
 */
export function zoneAt(lat, lon) {
  const point = usableCoordinate(lat, lon)
  if (point === null) return null
  try {
    const zone = tzlookup(point.lat, point.lon)
    return typeof zone === 'string' && zone !== '' ? zone : null
  } catch {
    /* tz-lookup 对域外/坏坐标会抛：一律当「算不出」，不往上炸 */
    return null
  }
}

/** `'YYYY-MM-DD'` → `{year, month, day}`；格式不对或月份/日越界 → null。 */
function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  // 用 UTC 回环校验（2 月 30 日这种会被 Date 归一成 3 月，回读就对不上）。
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  return { year, month, day }
}

/** `'HH:mm'` / `'HH:mm:ss'` → `{hour, minute}`；缺省或非法 → 正午（本地日内的中性锚点）。 */
function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? '').trim())
  if (!match) return { hour: 12, minute: 0 }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return { hour: 12, minute: 0 }
  return { hour, minute }
}

/** `Intl.DateTimeFormat` 的构造很贵 —— 同一 zone 复用一份（轮询/批量搜索时差一个数量级）。 */
const formatters = new Map()

function formatterFor(zone) {
  let format = formatters.get(zone)
  if (format === undefined) {
    try {
      format = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    } catch {
      format = null // 不是合法 IANA 名（ICU 认不出）：缓存成 null，别再试
    }
    formatters.set(zone, format)
  }
  return format
}

/** `GMT+09:00` / `GMT-04:00` / `GMT` → 分钟数；解析不出 → null。 */
function parseLongOffset(text) {
  const match = /GMT\s*([+-])(\d{1,2})(?::?(\d{2}))?/.exec(String(text ?? ''))
  if (!match) return /GMT/i.test(String(text ?? '')) ? 0 : null
  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? '0')
  if (hours > 23 || minutes > 59) return null
  return sign * (hours * 60 + minutes)
}

/**
 * 某个 **UTC 瞬间**上该 zone 的偏移（分钟）。zone 名非法 → null。
 * @param {string} zone
 * @param {number} epochMs UTC 瞬间
 */
export function offsetMinutesAtInstant(zone, epochMs) {
  const format = formatterFor(zone)
  if (format === null) return null
  try {
    const parts = format.formatToParts(new Date(epochMs))
    const name = parts.find((part) => part.type === 'timeZoneName')
    return parseLongOffset(name?.value)
  } catch {
    return null
  }
}

/**
 * 本地日期（可带时刻）→ 该 zone 当天的偏移（分钟）。
 *
 * 两趟迭代：`Date.UTC(...)` 得到的是「把这些字段当 UTC」的瞬间，与真正的本地瞬间差着一个偏移；
 * 用第一趟算出的偏移把瞬间挪回去，再读一次偏移即为正确值（DST 切换当天也收敛，因为两趟都在同一侧）。
 * @returns {number|null} 分钟；日期非法 / zone 认不出 → null
 */
export function offsetMinutesAt(zone, date, time) {
  const day = parseDate(date)
  if (day === null || typeof zone !== 'string' || zone === '') return null
  const { hour, minute } = parseTime(time)
  const naive = Date.UTC(day.year, day.month - 1, day.day, hour, minute)
  const first = offsetMinutesAtInstant(zone, naive)
  if (first === null) return null
  const second = offsetMinutesAtInstant(zone, naive - first * 60_000)
  return second ?? first
}

/**
 * 当天是不是夏令时（契约 §2 `dst`）。
 *
 * 判据（上游同款）：当年 1 月 15 日与 7 月 15 日的偏移里**更大**的那个 = 夏令时偏移；
 * 当天偏移等于它 → `true`。南北半球都对（悉尼 2024-01-15 是 +11:00 = 大者 → true）。
 * 这是**启发式**：它问的是「这一天在不在该年的夏令时段」，对「年内换过基准偏移」的少数时区
 * （如 2026 年永久废除夏令时的 Alberta）只保证与 ICU 的当日偏移一致，不保证语义精确。
 * @returns {boolean|null}
 */
export function isDstAt(zone, date) {
  const day = parseDate(date)
  if (day === null) return null
  const current = offsetMinutesAt(zone, date)
  if (current === null) return null
  const year = String(day.year).padStart(4, '0')
  const january = offsetMinutesAt(zone, `${year}-01-15`)
  const july = offsetMinutesAt(zone, `${year}-07-15`)
  if (january === null || july === null) return null
  if (january === july) return false // 该年没有夏令时（或全年同一偏移）
  return current === Math.max(january, july)
}

/**
 * `bazi.timezone` 的实现（契约 §2 的返回形状）。
 *
 * 三种「算不出」分得很清楚，界面据此决定怎么落回手改：
 *   - 坐标无效 → 三项全 null（不是出生地，别猜）；
 *   - 坐标有效但日期缺失/非法 → `zone` 照给，`offsetMinutes`/`dst` 为 null（先把地方定下来，
 *     日期由用户补；S3 的「出生地 → 时区」这一步本来就可能先于日期填完）。
 *
 * @param {{lat?: number|string, lon?: number|string, date?: string, time?: string}} request
 * @returns {{zone: string|null, offsetMinutes: number|null, dst: boolean|null}}
 */
export function resolveTimezone(request) {
  const source = request && typeof request === 'object' && !Array.isArray(request) ? request : {}
  const zone = zoneAt(source.lat, source.lon)
  if (zone === null) return { ...UNKNOWN_TIMEZONE }
  const offsetMinutes = offsetMinutesAt(zone, source.date, source.time)
  if (offsetMinutes === null) return { zone, offsetMinutes: null, dst: null }
  return { zone, offsetMinutes, dst: isDstAt(zone, source.date) }
}
