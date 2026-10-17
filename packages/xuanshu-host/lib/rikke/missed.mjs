/**
 * packages/xuanshu-host/lib/rikke/missed.mjs — 补课：把「错过的日课 / 晚省」在下次打开时补上（#25 契约 §3）。
 *
 * 为什么不能只靠 `ctx.schedule`：停机后 recurring 只补**最近一次**漏掉的 occurrence
 * （`dsh-schedule/lib/index.js:1893` 的 CREATE_DESCRIPTION 原文 + `:661-673`）——连漏 3 天只投 1 次。
 * 所以「哪几天缺」必须由**玄枢自己的产物 + 触达账**判：
 *
 *   判据（契约 §3 逐字）：某天 `D` 的产物缺失 **且** 账里没有该 `kind+date` 的生成行 → 判为错过。
 *   窗口：`D < 今天`、最多回看 7 天。
 *   起点：该 kind 的**最早证据日**（产物或账行的最小 date）之后 —— 之前的日期没有「错过」的证据，
 *   补它等于凭空造历史（首次安装时 schedule 的第一个 occurrence 本来就在明天）。
 *   该 kind 既无产物也无任何账行（= 从未运行过）→ 不补。
 *
 * 纪律：
 *   - **幂等**：账里已有该 `kind+date` 行 → 不再生成（同一天不补两次）；
 *   - **补生成不推送**：账行 `notify:{status:'skipped', reason:'补生成：不补推送（界面标「补」）'}`；
 *     界面用产物的 `missed` 标「补」；
 *   - **补生成不调模型**：日课 AI 段写 `{mode:'off', reason:'补生成不做 AI 段'}`；
 *   - **永不把失败写成成功**：某天生成失败只进 `errors`（不落账），下一次结算再试；
 *   - **永不抛**：结算跑在装配链路与到点链路上，抛了会拖挂别的东西。
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { readTouchTimes } from '../notify/settings.mjs'
import { MISSED_NOTIFY_REASON } from '../notify/touch.mjs'
import { readTraffic } from '../notify/traffic.mjs'
import { generateWansheng } from '../wansheng/generate.mjs'
import { deliverWanshengTouch } from '../wansheng/touch.mjs'
import { WANSHENG_DIR } from '../wansheng/store.mjs'
import { generateRikke, zoneFor } from './generate.mjs'
import { dayAtZoneTime } from './occurrence.mjs'
import { deliverRikkeTouch } from './touch.mjs'
import { RIKKE_DIR, dateInZone, isDate } from './store.mjs'

/** 最多回看几天（契约 §3 定值）。 */
export const MISSED_LOOKBACK_DAYS = 7

/** kind → 产物目录（账行 `artifactPath` 也由它派生）。 */
const ARTIFACT_DIRS = Object.freeze({ rikke: RIKKE_DIR, wansheng: WANSHENG_DIR })

/** kind → 计划时刻在共享设置里的键。 */
const TIME_KEYS = Object.freeze({ rikke: 'rikkeTime', wansheng: 'wanshengTime' })

/**
 * `YYYY-MM-DD` 前后挪几天（纯 UTC 日历运算；不涉及时区）。
 * @param {string} date
 * @param {number} days 正数往后
 */
export function shiftDate(date, days) {
  if (!isDate(date)) throw new Error(`日期非法：${JSON.stringify(date)}`)
  const [year, month, day] = date.split('-').map(Number)
  const moved = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000)
  return moved.toISOString().slice(0, 10)
}

/**
 * 某个 kind 在 `<dataDir>/<dir>/` 下已有的产物日期。
 * @returns {Set<string>}
 */
export function artifactDates(dataDir, kind) {
  const dir = join(dataDir, ARTIFACT_DIRS[kind])
  if (!existsSync(dir)) return new Set()
  const out = new Set()
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const date = entry.name.slice(0, -'.json'.length)
    if (isDate(date)) out.add(date)
  }
  return out
}

/**
 * 算出该补哪几天（纯函数：账与产物都是入参）。
 *
 * @param {{dataDir: string, kind: 'rikke'|'wansheng', today: string, entries: object[],
 *          lookback?: number}} input
 * @returns {string[]} 升序的日期列表
 */
export function planMissedDates({ dataDir, kind, today, entries, lookback = MISSED_LOOKBACK_DAYS }) {
  const artifacts = artifactDates(dataDir, kind)
  const ledgerDates = new Set()
  for (const entry of entries) {
    if (entry?.kind !== kind || !isDate(entry.date)) continue
    ledgerDates.add(entry.date)
  }
  const evidence = [...artifacts, ...ledgerDates].filter((date) => date < today).sort()
  // 从未运行过：没有「错过」的证据，不补。
  if (evidence.length === 0) return []
  const first = evidence[0]

  const planned = []
  for (let offset = 1; offset <= lookback; offset += 1) {
    const date = shiftDate(today, -offset)
    if (date <= first) continue // 起点之前没有「错过」的证据
    if (artifacts.has(date)) continue // 产物在 = 没漏
    if (ledgerDates.has(date)) continue // 账里有 = 已经投过（幂等的唯一权威）
    planned.push(date)
  }
  return planned.sort()
}

/** 一条补课账行的理由（契约 §3 逐字；单一来源在 `notify/touch.mjs`）。 */
export const MISSED_SKIP_REASON = MISSED_NOTIFY_REASON

/**
 * 结算「缺失的触达」：启动时（装配链路里，异步不阻塞 apply）与每次到点之后各跑一次。
 *
 * @param {{ctx: object, dataDir: string, zone?: string, timeZone?: string,
 *          now?: () => Date, env?: Record<string, string|undefined>}} input
 *        `zone` 底座时区（缺省由 `zoneFor(dataDir, timeZone)` 算）；`now` 只为断言台留
 * @returns {Promise<{ok: true, days: {kind: string, date: string}[], notes: string[], errors: string[]}>}
 *          **永不抛**
 */
export async function settleMissedTouches({ ctx, dataDir, zone, timeZone, now, env }) {
  const result = { ok: true, days: [], notes: [], errors: [] }
  try {
    const at = typeof now === 'function' ? now() : new Date()
    const resolvedZone = typeof zone === 'string' && zone !== '' ? zone : zoneFor(dataDir, timeZone)
    const today = dateInZone(resolvedZone, at)
    const settings = readTouchTimes(dataDir)
    const ledger = readTraffic(dataDir)

    for (const kind of ['rikke', 'wansheng']) {
      const dates = planMissedDates({ dataDir, kind, today, entries: ledger.entries })
      if (dates.length === 0) continue
      for (const date of dates) {
        const generated = kind === 'rikke'
          ? await generateRikke({
            ctx,
            dataDir,
            date,
            zone: resolvedZone,
            manual: false,
            at,
            missed: true,
            hour: Number(settings[TIME_KEYS[kind]].split(':')[0]),
          })
          : await generateWansheng({ ctx, dataDir, date, zone: resolvedZone, at, missed: true })
        if (generated.ok !== true) {
          result.errors.push(`${kind} ${date} 补生成失败：${generated.reason}`)
          continue
        }

        // 账行 occurrenceAt = 那天的**计划时刻**（本地时区里算回 UTC），不是补的时刻。
        const occurrence = dayAtZoneTime(resolvedZone, date, settings[TIME_KEYS[kind]])
        const touch = kind === 'rikke'
          ? await deliverRikkeTouch({
            dataDir, date, at, manual: false, missed: true, occurrenceAt: occurrence?.toISOString(), env,
          })
          : await deliverWanshengTouch({
            dataDir, date, at, manual: false, missed: true, occurrenceAt: occurrence?.toISOString(), env,
          })
        if (touch.ledgerError !== null) result.notes.push(`${kind} ${date} 的补课账没记上：${touch.ledgerError}`)
        result.days.push({ kind, date })
      }
    }
  } catch (error) {
    // 结算失败只记一笔：它跑在装配与到点链路上，不许把别的东西拖挂。
    result.ok = false
    result.errors.push(`补课结算抛了异常（已兜住）：${String(error?.message ?? error)}`)
  }
  return result
}
