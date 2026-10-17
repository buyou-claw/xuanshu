/**
 * packages/xuanshu-host/lib/rikke/service.mjs — 日课三个 RPC（票 13 契约 §2 + Lead 2026-10-15 的加性修订）。
 *
 * 文件契约：`<dataDir>/rikke/<YYYY-MM-DD>.json`（schema `xuanshu/rikke@1`）。
 * 「今天是否已生成」**只看这个文件**（schedule 只记 lastDelivery，没有打卡语义）。
 *
 * 内容来源（契约 §2）：
 *   - **底座**：票 08 的 `bazi/snapshot.json`（底座没立 → `rikke.generate` 给**可读失败**，不静默）；
 *   - **黄历**：本地 horosa 的 `horosa_cn_huangli`（只走 `xuanshuHorosa.callTool`）；
 *   - **时间基准**：底座里登记的时区 + 本机时钟（`Intl`）。**不联网、不调 LLM**。
 *
 * **生成链只有一份**：`generate.mjs` 的 `generateRikke()`。`rikke.generate`（人点，`manual:true`）
 * 与定时到点（`delivery.mjs`，`manual:false`）走的是同一段代码 —— 这个约定在本文件原来那句
 * 「将来定时路径复用同一份代码时显式传 manual:false」里就写下了，2026-10-16 兑现（复核 Spec 1）。
 *
 * 契约修订（Lead 2026-10-15，纯加性）：`rikke.status` 回传 `generatedAt` / `zone` /
 * `huangli:{ok,version,tool}` / `schedule:{time,timeZone,id}`，**拿不到就省略该键**（不写 null、不写空串）——
 * 与票 08 快照的 `place` 同款：「空值比没有值更容易被界面当成填过了」。
 *
 * #24 再加两处（同样纯加性）：
 *   - `rikke.status` 回 `ai`（三态，见 `ai-note.mjs`）与 `unread` / `notify`（触达账读面）；
 *   - `rikke.settings.get/set`：AI 段开关（`<dataDir>/rikke-settings.json`）。
 */

import { normalizeAiNote } from './ai-note.mjs'
import { DEFAULT_TIME_ZONE, RIKKE_TASK_TITLE, findDailyTask, scheduleSummary, updateDailyTime } from './daily-tasks.mjs'
import { generateRikke, zoneFor } from './generate.mjs'
import { readRikkeSettings, writeRikkeSettings } from './settings.mjs'
import { dateInZone, isDate, readRikke } from './store.mjs'
import { deliverRikkeTouch } from './touch.mjs'
import { readTraffic } from '../notify/traffic.mjs'
import { resolveDataDir } from '../bazi/service.mjs'

/** 请求对象兜底（非对象一律当空请求）。 */
function requestOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * 底座里登记的时区（快照读不出就用缺省；它只影响「今天是哪一天」）。
 *
 * 判据的唯一实现在 `generate.mjs` 的 `zoneFor()`：定时那条路（`delivery.mjs`）也要它，
 * 两处各写一份就会漂移（本仓库吃过六份复制的亏）。
 */
export function baseZone(dataDir) {
  return zoneFor(dataDir, DEFAULT_TIME_ZONE)
}

/**
 * 建 `rikke.*` 方法组（契约 §2）。
 * @param {object} ctx cordis 宿主上下文
 * @param {{dataDir?: string, now?: () => Date}} [config] `now` 只为断言台留（定时/日界测试）
 */
export function createRikkeMethods(ctx, config = {}) {
  const dataDir = resolveDataDir(ctx, config)
  const now = typeof config.now === 'function' ? config.now : () => new Date()
  // #24：壳的运行时状态文件从哪读。缺省 = `{}`（= 没有壳）——断言台不被机器 env 污染；
  // 生产由 `lib/index.js` 显式传 `process.env`。
  const env = config.env

  /** 目标日期：请求给了就用（校验格式），没给就是时区里的今天；`at` 只为「一次生成只读一次钟」。 */
  const pickDate = (source, zone, at = now()) => (isDate(source.date) ? source.date : dateInZone(zone, at))

  return {
    /**
     * 日课卡取数（票 07 的 `XsRikkeCard`）：存在 → `content` 三键 + 生成时间 + 时区 + 黄历来源 + 定时；
     * 不存在 → `{ date, exists:false }`。**只读**，不生成。
     */
    'rikke.status': async (request) => {
      const source = requestOf(request)
      const zone = baseZone(dataDir)
      const date = pickDate(source, zone)
      const read = readRikke(dataDir, date)

      const out = { date, exists: read.state !== 'empty' }
      if (read.state === 'ready') {
        out.content = read.record.content
        if (typeof read.record.generatedAt === 'string') out.generatedAt = read.record.generatedAt
        if (typeof read.record.zone === 'string') out.zone = read.record.zone
        if (read.record.huangli && typeof read.record.huangli === 'object') out.huangli = read.record.huangli
        // #24：AI 段三态（坏形状不冒充成功；旧产物没有这个键就整键省略）。
        const ai = normalizeAiNote(read.record.ai)
        if (ai !== undefined) out.ai = ai
      }
      if (read.state === 'error') out.reason = read.reason

      // #24：触达账的加性读面。**拿不到就省略键**（账文件不存在 ≠ 未读 0 —— 界面不该因此显示一个数）。
      const ledger = readTraffic(dataDir)
      if (ledger.exists) {
        out.unread = ledger.unread
        const latest = ledger.entries[0]
        if (latest !== undefined) {
          out.notify = {
            status: latest.notify.status,
            at: latest.at,
            ...(latest.notify.reason === null ? {} : { reason: latest.notify.reason }),
          }
        }
      }

      const summary = scheduleSummary(await findDailyTask(ctx, RIKKE_TASK_TITLE))
      if (summary !== null) out.schedule = summary
      return out
    },

    /**
     * 生成当日日课（人点 [立即生成] 走它）。**失败一律给可读理由，不静默**：
     * 底座未立 / horosa 没调通 / 写盘失败，三种都回 `{ok:false, date, reason}`。
     *
     * 实现只剩「算时区与日期」+ 调那一份共用链（`generate.mjs`）：**定时到点那条路走的是同一份代码**
     * （`delivery.mjs`，`manual:false`），这样两条路产出的产物形状不会各漂各的。
     */
    'rikke.generate': async (request) => {
      const source = requestOf(request)
      const at = now()
      const zone = baseZone(dataDir)
      const date = pickDate(source, zone, at)
      // `manual` 区分「人点出来的这一份」与「定时产出的那一份」：本方法只被人点调用，所以缺省 true。
      const manual = source.manual !== false
      const generated = await generateRikke({ ctx, dataDir, zone, date, manual, at })
      if (generated.ok) {
        // #24：人点生成**不发系统通知**（界面自己会显示结果），但账里要留一行 skipped ——
        // 「今天有没有触达过」是 #25 补课判据的一部分，人点那份也得在账上。
        await deliverRikkeTouch({ dataDir, date: generated.date, at, manual, env })
      }
      return generated
    },

    /**
     * 改日课的每日时刻（契约 §2：走 `ctx.schedule.update` 的 **compare-and-update**）。
     * 失败**抛**（RPC 层折成 `{ok:false, error}`）：这是写操作，静默吞掉会让用户以为改成了。
     */
    'rikke.setTime': async (request) => {
      const source = requestOf(request)
      const updated = await updateDailyTime({ ctx, title: RIKKE_TASK_TITLE, time: source.time })
      if (!updated.ok) throw new Error(updated.reason)
      return { schedule: { time: updated.schedule.time, timeZone: updated.schedule.timeZone } }
    },

    /** #24：AI 段开关（`rikke-settings.json`；缺失 = 默认开）。 */
    'rikke.settings.get': async () => readRikkeSettings(dataDir),

    /**
     * #24：改 AI 段开关。缺键 / 非 boolean → **抛**（写操作不许静默）。
     * 只影响**下一次**生成：今天已经写好的那份产物不会被人点一下就改写（改产物必须有明确的生成动作）。
     */
    'rikke.settings.set': async (request) => {
      const source = requestOf(request)
      if (!Object.hasOwn(source, 'aiEnabled')) throw new Error('rikke.settings.set 要 aiEnabled（#24 的设置面只有这一项）')
      return writeRikkeSettings(dataDir, { aiEnabled: source.aiEnabled })
    },
  }
}
