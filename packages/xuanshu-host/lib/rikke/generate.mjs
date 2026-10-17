/**
 * packages/xuanshu-host/lib/rikke/generate.mjs — 日课的**可执行生成链**（全仓唯一一份）。
 *
 * 为什么把这段从 `service.mjs` 里抽出来单独放：它有两个调用方，而两者必须产出**同一份**产物 ——
 *   1. `rikke.generate`：人点 [立即生成]（`manual: true`）；
 *   2. 定时任务到点：`delivery.mjs` 在 `agent/pre-step` 上跑（`manual: false`）。
 *
 * 定时那条原来只往会话里投一句话、**没有任何执行者**（复核 Spec 1：`daily-tasks.mjs:142` 裸建 agent），
 * 产物一个字节都不落 —— 日课卡永远是空的。`service.mjs` 当初就写下了这个约定
 * （「将来定时路径复用同一份代码时显式传 `manual:false`」），这里把「同一份代码」变成真的。
 *
 * **不复制第二份**：产物有 schema `xuanshu/rikke@1` 与 `content.{yi,ji,liuri}` 三键契约，
 * 两份实现迟早漂移（本仓库已有先例：`pruneStale` 在 6 个沙箱里各抄一份，最后两处判据写反）。
 *
 * 链条（契约 §2）：底座快照（票 08）→ 本地 horosa 的 `horosa_cn_huangli`（带当前时刻的整数小时）
 * → 组装记录 → 原子写 `<dataDir>/rikke/<YYYY-MM-DD>.json`。**不联网**；**确定性骨架是本函数的全部
 * 写盘前提**。
 *
 * #24 的两段式（`docs/specs/002-reside-and-use.md:126`）：骨架写完**之后**才调 AI 段
 * （`ai-note.mjs`），并把结果作为**加性字段** `ai` 重写进同一份产物。顺序是刻意的：
 *   - 先落骨架 → 即使 AI 段卡住 / 抛了 / provider 挂了，今天的日课**已经在盘上**；
 *   - `ai` 三态 `{mode:'ok',text} | {mode:'off'} | {mode:'failed',reason}` 写进产物，
 *     界面据此显示「AI 建议 / 已关闭 / 失败 + 原因」，三者在读面上分得开。
 * `readRikke()` 的完整度判据**只认** `content.{yi,ji,liuri}`，不因 `ai` 缺失/坏形状变红。
 *
 * 失败一律**如实回报**（`{ok:false, date, reason}`），由调用方决定怎么给人看：
 * 人点的路直接把 reason 回给界面，定时那条路只记日志（下一次投递再试）。
 */

import { readSnapshot } from '../bazi/snapshot.mjs'
import { composeAiNote } from './ai-note.mjs'
import { callHuangli } from './huangli.mjs'
import { readRikkeSettings } from './settings.mjs'
import { RIKKE_SCHEMA, hourInZone, writeRikke } from './store.mjs'

/**
 * 底座里登记的时区（快照读不出就用调用方给的兜底；它只影响「今天是哪一天」与黄历的小时）。
 *
 * 放在这里而不是 `service.mjs`：定时那条路（`delivery.mjs`）也要它，而 `service.mjs` 反过来
 * 要 import 本模块 —— 放这儿是为了不制造 import 环。两处共用**同一份**判据。
 *
 * @param {string} dataDir
 * @param {string} fallback 快照不可得时的时区（装配期已经是契约缺省或底座里的那一份）
 */
export function zoneFor(dataDir, fallback) {
  const read = readSnapshot(dataDir)
  const zone = read.state === 'ready' ? read.snapshot?.birth?.zone : null
  if (typeof zone === 'string' && zone !== '') return zone
  return typeof fallback === 'string' && fallback !== '' ? fallback : 'UTC'
}

/** 这一天的日课产物记录（两条路写的就是它，唯一区别是 `manual`；#25 补课再加 `missed`）。 */
export function buildRikkeRecord({ date, zone, content, huangli, manual, generatedAt, missed = false }) {
  return {
    schema: RIKKE_SCHEMA,
    date,
    generatedAt,
    zone,
    content: { yi: content.yi, ji: content.ji, liuri: content.liuri },
    huangli: { ok: huangli.ok === true, version: huangli.version ?? null, tool: huangli.tool ?? null },
    manual,
    // #25：**加性**字段，只在补生成时出现（`false` 不写，保持 #24 的产物形状一字不变）。
    ...(missed === true ? { missed: true } : {}),
  }
}

/**
 * 跑一次生成链（**唯一一份实现**）。
 *
 * @param {{ctx: object, dataDir: string, date: string, zone: string, manual: boolean, at?: Date,
 *          withNote?: boolean, missed?: boolean, hour?: number}} input
 *        `at` 是**这一次生成的时间基准**：日期由调用方算好、`generatedAt` 由它取 —— 一次生成只读一次钟。
 *        `withNote:false` 只为断言台保留「只要确定性骨架」的那条路（缺省 = 连 AI 段一起做）。
 *        `missed:true` = 补生成（#25）：产物带 `missed:true`，AI 段**不调模型**，只写
 *        `{mode:'off', reason:'补生成不做 AI 段'}`（契约 §3）；`hour` 是黄历的整数小时（补课用计划时刻）。
 * @returns {Promise<{ok: true, date: string, content: object, ai?: object}|{ok: false, date: string, reason: string}>}
 */
export async function generateRikke({
  ctx, dataDir, date, zone, manual, at = new Date(), withNote = true, missed = false, hour,
}) {
  // 底座没立 → 可读失败（不静默）：日课的「哪一天 / 哪个时区 / 流日」全来自它。
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

  const called = await callHuangli({
    ctx,
    date,
    // 补课那份用**计划时刻**的时辰（不是补生成的时刻）：产物说的是那一天的事。
    hour: Number.isInteger(hour) ? hour : hourInZone(zone, at),
  })
  if (!called.ok) return { ok: false, date, reason: called.reason }

  const record = buildRikkeRecord({
    date,
    zone,
    content: called.content,
    huangli: { ok: true, version: called.version, tool: called.tool },
    manual,
    generatedAt: at.toISOString(),
    missed,
  })
  try {
    writeRikke(dataDir, record)
  } catch (error) {
    return { ok: false, date, reason: `日课写盘失败：${String(error?.message ?? error)}` }
  }

  // 骨架已经落盘。AI 段从这里开始，**任何结果都不改变 `ok:true`**（关闭 / 失败只影响 `ai` 字段）。
  let ai
  if (missed === true) {
    // #25 契约 §3：补生成**不调模型**（否则开机补 7 天就是 7 次调用），但三态要写清楚「为什么没有」。
    ai = { mode: 'off', reason: '补生成不做 AI 段' }
    try {
      writeRikke(dataDir, { ...record, ai })
    } catch (error) {
      ai = { mode: 'failed', reason: `补课 AI 段写盘失败（骨架已落盘）：${String(error?.message ?? error)}` }
    }
  } else if (withNote !== false) {
    try {
      const settings = readRikkeSettings(dataDir)
      ai = await composeAiNote({ ctx, dataDir, date, content: record.content, enabled: settings.aiEnabled })
    } catch (error) {
      ai = { mode: 'failed', reason: `AI 段跑的时候抛了异常（已兜住）：${String(error?.message ?? error)}` }
    }
    try {
      writeRikke(dataDir, { ...record, ai })
    } catch (error) {
      // 第二次写失败：盘上仍是**完整可读的骨架**（只是没有 ai 键）。如实把理由带出去，不假装写成。
      ai = { mode: 'failed', reason: `AI 段写盘失败（骨架已落盘）：${String(error?.message ?? error)}` }
    }
  }
  return { ok: true, date, content: record.content, ...(ai === undefined ? {} : { ai }) }
}
