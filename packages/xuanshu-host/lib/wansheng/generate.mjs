/**
 * packages/xuanshu-host/lib/wansheng/generate.mjs — 晚省的**生成链**（#25 契约 §1）。
 *
 * 两个调用方，产物必须**同一份**（与 `rikke/generate.mjs` 同一条纪律，别复制第二份）：
 *   1. 到点（`rikke/delivery.mjs` 在 `agent/pre-step` 上认领）→ `manual:false`；
 *   2. 人点 [立即生成]（`wansheng.generate`）/ 补课（`rikke/missed.mjs`）→ `missed` 视现场。
 *
 * **不调任何模型**：晚省的内容就是事实（今天几场问事、哪些项目有活动、底稿/日课/事记何时动过）。
 * 模型写不出可核对的事实，让它写只会把「事实」变成「一段话」。
 *
 * 失败口径与日课一致：`{ok:false, date, reason}` 交给调用方（人点那条把 reason 给界面，
 * 定时那条只记日志、下一次投递再试）。写盘走原子写（`store.mjs`）。
 */

import { collectWanshengFacts } from './facts.mjs'
import { buildWanshengRecord, writeWansheng } from './store.mjs'

/**
 * 生成（或重新生成）某一天的晚省。
 *
 * @param {{ctx: object, dataDir: string, date: string, zone: string, at?: Date, missed?: boolean}} input
 *        `at`：这一次生成的时刻（`generatedAt` 的唯一来源；一次生成只读一次钟）
 *        `missed`：补生成（产物带 `missed:true`，界面标「补」）
 * @returns {Promise<{ok: true, date: string, record: object}|{ok: false, date: string, reason: string}>}
 */
export async function generateWansheng({ ctx, dataDir, date, zone, at = new Date(), missed = false }) {
  let collected
  try {
    collected = await collectWanshengFacts({ ctx, dataDir, date, zone })
  } catch (error) {
    // `collectWanshengFacts` 自己已经按来源兜底；这里是最后一道（不许把「晚省生成」变成异常）。
    return { ok: false, date, reason: `晚省事实采集失败：${String(error?.message ?? error)}` }
  }

  const record = buildWanshengRecord({
    date,
    zone,
    at,
    facts: collected.facts,
    notes: collected.notes,
    missed,
  })
  try {
    writeWansheng(dataDir, record)
  } catch (error) {
    return { ok: false, date, reason: `晚省写盘失败：${String(error?.message ?? error)}` }
  }
  return { ok: true, date, record }
}
