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
 * 契约修订（Lead 2026-10-15，纯加性）：`rikke.status` 回传 `generatedAt` / `zone` /
 * `huangli:{ok,version,tool}` / `schedule:{time,timeZone,id}`，**拿不到就省略该键**（不写 null、不写空串）——
 * 与票 08 快照的 `place` 同款：「空值比没有值更容易被界面当成填过了」。
 */

import { DEFAULT_TIME_ZONE, RIKKE_TASK_TITLE, findDailyTask, scheduleSummary, updateDailyTime } from './daily-tasks.mjs'
import { callHuangli } from './huangli.mjs'
import { RIKKE_SCHEMA, dateInZone, hourInZone, isDate, readRikke, writeRikke } from './store.mjs'
import { resolveDataDir } from '../bazi/service.mjs'
import { readSnapshot } from '../bazi/snapshot.mjs'

/** 请求对象兜底（非对象一律当空请求）。 */
function requestOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/** 底座里登记的时区（快照读不出就用缺省；它只影响「今天是哪一天」）。 */
export function baseZone(dataDir) {
  const read = readSnapshot(dataDir)
  const zone = read.state === 'ready' ? read.snapshot?.birth?.zone : null
  return typeof zone === 'string' && zone !== '' ? zone : DEFAULT_TIME_ZONE
}

/** 这一天的日课产物记录（`rikke.generate` 写的就是它）。 */
export function buildRikkeRecord({ date, zone, content, huangli, manual, generatedAt = new Date().toISOString() }) {
  return {
    schema: RIKKE_SCHEMA,
    date,
    generatedAt,
    zone,
    content: { yi: content.yi, ji: content.ji, liuri: content.liuri },
    huangli: { ok: huangli.ok === true, version: huangli.version ?? null, tool: huangli.tool ?? null },
    manual,
  }
}

/**
 * 建 `rikke.*` 方法组（契约 §2）。
 * @param {object} ctx cordis 宿主上下文
 * @param {{dataDir?: string, now?: () => Date}} [config] `now` 只为断言台留（定时/日界测试）
 */
export function createRikkeMethods(ctx, config = {}) {
  const dataDir = resolveDataDir(ctx, config)
  const now = typeof config.now === 'function' ? config.now : () => new Date()

  /** 目标日期：请求给了就用（校验格式），没给就是时区里的今天。 */
  const pickDate = (source, zone) => (isDate(source.date) ? source.date : dateInZone(zone, now()))

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
      }
      if (read.state === 'error') out.reason = read.reason

      const summary = scheduleSummary(await findDailyTask(ctx, RIKKE_TASK_TITLE))
      if (summary !== null) out.schedule = summary
      return out
    },

    /**
     * 生成当日日课（人点 [立即生成] 走它）。**失败一律给可读理由，不静默**：
     * 底座未立 / horosa 没调通 / 写盘失败，三种都回 `{ok:false, date, reason}`。
     */
    'rikke.generate': async (request) => {
      const source = requestOf(request)
      const zone = baseZone(dataDir)
      const date = pickDate(source, zone)

      const snapshot = readSnapshot(dataDir)
      if (snapshot.state !== 'ready') {
        return {
          ok: false,
          date,
          reason: snapshot.state === 'empty'
            ? '底座未立：还没有出过盘。先完成出生信息（八字冷启动向导 / `bazi.cast`），日课要读底座与时间基准。'
            : `底座快照读不出来：${snapshot.reason}`,
        }
      }

      const called = await callHuangli({ ctx, date, hour: hourInZone(zone, now()) })
      if (!called.ok) return { ok: false, date, reason: called.reason }

      const record = buildRikkeRecord({
        date,
        zone,
        content: called.content,
        huangli: { ok: true, version: called.version, tool: called.tool },
        // `manual` 区分「人点出来的这一份」与「定时产出的那一份」：本方法只被人点调用，
        // 所以缺省 true；将来定时路径复用同一份代码时显式传 `manual:false`。
        manual: source.manual !== false,
        generatedAt: now().toISOString(),
      })
      try {
        writeRikke(dataDir, record)
      } catch (error) {
        return { ok: false, date, reason: `日课写盘失败：${String(error?.message ?? error)}` }
      }
      return { ok: true, date, content: record.content }
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
  }
}
