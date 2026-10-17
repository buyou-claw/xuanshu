/**
 * packages/xuanshu-host/lib/wansheng/service.mjs — 晚省的四个 RPC（#25 契约 §1）。
 *
 * | 方法 | 请求 | 回答 |
 * |---|---|---|
 * | `wansheng.status` | `{date?}` | `{date, exists}` + (ready 时) `facts` / `generatedAt` / `zone` / `missed` + `schedule?` |
 * | `wansheng.read`   | `{date?}` | `{date, exists, record?}` / `reason?` |
 * | `wansheng.generate` | `{date?, manual?}` | `{ok, date, record? , reason?}`，成功后落一行触达账（人点 = skipped） |
 * | `wansheng.setTime` | `{time}` | `{schedule:{time,timeZone}}`；改 schedule + 同步设置文件 |
 *
 * 加性纪律（与 `rikke/service.mjs:16-18` 同款）：**拿不到就省略键**，
 * 不写 false / 0 冒充已知（`unread` 在账本读不到时整键不出现）。
 */

import { resolveDataDir } from '../bazi/service.mjs'
import { readTraffic } from '../notify/traffic.mjs'
import { syncTouchTimeSettings } from '../notify/settings.mjs'
import { DEFAULT_TIME_ZONE, WANSHENG_TASK_TITLE, findDailyTask, normalizeDailyTime, scheduleSummary, updateDailyTime } from '../rikke/daily-tasks.mjs'
import { zoneFor } from '../rikke/generate.mjs'
import { dateInZone, isDate } from '../rikke/store.mjs'
import { generateWansheng } from './generate.mjs'
import { readWansheng } from './store.mjs'
import { deliverWanshengTouch } from './touch.mjs'

/** 请求对象兜底（非对象一律当空请求）。 */
function requestOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * 建 `wansheng.*` 方法组（契约 §1）。
 * @param {object} ctx cordis 宿主上下文
 * @param {{dataDir?: string, now?: () => Date, env?: Record<string, string|undefined>}} [config]
 *        `now` 只为断言台留；`env` 是壳的运行时状态文件来源（生产 `process.env`）
 */
export function createWanshengMethods(ctx, config = {}) {
  const dataDir = resolveDataDir(ctx, config)
  const now = typeof config.now === 'function' ? config.now : () => new Date()
  const env = config.env

  /** 底座时区（只影响「今天是哪一天」；与日课同一份判据）。 */
  const baseZone = () => zoneFor(dataDir, DEFAULT_TIME_ZONE)

  return {
    /** 晚省卡取数：今天有没有晚省 + 当天事实 + 计划时刻 + 触达状态。**只读**，不生成。 */
    'wansheng.status': async (request) => {
      const source = requestOf(request)
      const zone = baseZone()
      const at = now()
      const date = isDate(source.date) ? source.date : dateInZone(zone, at)
      const read = readWansheng(dataDir, date)

      const out = { date, exists: read.state !== 'empty' }
      if (read.state === 'ready') {
        out.facts = read.record.facts
        if (typeof read.record.generatedAt === 'string') out.generatedAt = read.record.generatedAt
        if (typeof read.record.zone === 'string') out.zone = read.record.zone
        // 补生成的产物标「补」：这是已知值（false 也是有意义的事实）。
        out.missed = read.record.missed === true
      }
      if (read.state === 'error') out.reason = read.reason

      // 触达账的加性读面：只数**晚省**的条目（日课那条不混进来）。
      const ledger = readTraffic(dataDir)
      if (ledger.exists) {
        const mine = ledger.entries.filter((entry) => entry.kind === 'wansheng')
        out.unread = mine.filter((entry) => entry.notify.status === 'delivered' && entry.read !== true).length
        const latest = mine[0]
        if (latest !== undefined) {
          out.notify = {
            status: latest.notify.status,
            at: latest.at,
            ...(latest.notify.reason === null ? {} : { reason: latest.notify.reason }),
          }
        }
      }

      const summary = scheduleSummary(await findDailyTask(ctx, WANSHENG_TASK_TITLE))
      if (summary !== null) out.schedule = summary
      return out
    },

    /**
     * 读某天的晚省产物（界面要显示事实）。
     * 拿不到 → `{date, exists:false}`；产物坏了 → 带 `reason`（**不假装有内容**）。
     */
    'wansheng.read': async (request) => {
      const source = requestOf(request)
      const zone = baseZone()
      const date = isDate(source.date) ? source.date : dateInZone(zone, now())
      const read = readWansheng(dataDir, date)
      const out = { date, exists: read.state !== 'empty' }
      if (read.state === 'ready') out.record = read.record
      if (read.state === 'error') out.reason = read.reason
      return out
    },

    /**
     * 生成（或重新生成）某天的晚省。**人点 [立即生成] 走它**（`manual` 缺省 true）。
     * 确定性事实链（不调模型）；生成成功才落触达账（人点 = skipped，不发系统通知）。
     */
    'wansheng.generate': async (request) => {
      const source = requestOf(request)
      const at = now()
      const zone = baseZone()
      const date = isDate(source.date) ? source.date : dateInZone(zone, at)
      const manual = source.manual !== false
      const generated = await generateWansheng({ ctx, dataDir, zone, date, at, missed: false })
      if (generated.ok) {
        await deliverWanshengTouch({ dataDir, date: generated.date, at, manual, env })
      }
      return generated
    },

    /**
     * 改晚省的每日时刻：schedule 是**实际生效**的权威（改完下次到点即生效），
     * 设置文件是「下次安装 / 界面显示」的期望值 —— 两边一起写。失败**抛**（写操作不许静默）。
     */
    'wansheng.setTime': async (request) => {
      const source = requestOf(request)
      if (normalizeDailyTime(source.time) === null) {
        throw new Error(`时间格式不对（${JSON.stringify(source.time)}）：要 HH:mm。`)
      }
      const updated = await updateDailyTime({ ctx, title: WANSHENG_TASK_TITLE, time: source.time })
      if (!updated.ok) throw new Error(updated.reason)
      syncTouchTimeSettings(dataDir, 'wanshengTime', updated.schedule.time)
      return { schedule: { time: updated.schedule.time, timeZone: updated.schedule.timeZone } }
    },
  }
}
