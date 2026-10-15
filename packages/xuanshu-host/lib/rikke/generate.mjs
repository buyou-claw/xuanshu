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
 * → 组装记录 → 原子写 `<dataDir>/rikke/<YYYY-MM-DD>.json`。**不联网、不调 LLM**。
 *
 * 失败一律**如实回报**（`{ok:false, date, reason}`），由调用方决定怎么给人看：
 * 人点的路直接把 reason 回给界面，定时那条路只记日志（下一次投递再试）。
 */

import { readSnapshot } from '../bazi/snapshot.mjs'
import { callHuangli } from './huangli.mjs'
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

/** 这一天的日课产物记录（两条路写的就是它，唯一区别是 `manual`）。 */
export function buildRikkeRecord({ date, zone, content, huangli, manual, generatedAt }) {
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
 * 跑一次生成链（**唯一一份实现**）。
 *
 * @param {{ctx: object, dataDir: string, date: string, zone: string, manual: boolean, at?: Date}} input
 *        `at` 是**这一次生成的时间基准**：日期由它算（调用方算好 `date`）、黄历的小时与
 *        `generatedAt` 都由它取 —— 一次生成只读一次钟，免得「日期按 07:30、小时按 07:31」。
 * @returns {Promise<{ok: true, date: string, content: object}|{ok: false, date: string, reason: string}>}
 */
export async function generateRikke({ ctx, dataDir, date, zone, manual, at = new Date() }) {
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

  const called = await callHuangli({ ctx, date, hour: hourInZone(zone, at) })
  if (!called.ok) return { ok: false, date, reason: called.reason }

  const record = buildRikkeRecord({
    date,
    zone,
    content: called.content,
    huangli: { ok: true, version: called.version, tool: called.tool },
    manual,
    generatedAt: at.toISOString(),
  })
  try {
    writeRikke(dataDir, record)
  } catch (error) {
    return { ok: false, date, reason: `日课写盘失败：${String(error?.message ?? error)}` }
  }
  return { ok: true, date, content: record.content }
}
