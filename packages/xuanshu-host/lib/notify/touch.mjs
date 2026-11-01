/**
 * packages/xuanshu-host/lib/notify/touch.mjs — 一次「触达」的宿主半（通知 + 一行账）的**共用实现**。
 *
 * #24 先把这段写在 `rikke/touch.mjs` 里（日课一条链路）；#25 的晚省与补课是同一件事的另外几个现场，
 * 两处各抄一份必然漂移（本仓库为「同一判据抄六份」付过代价）。所以把「发不发、怎么落账」收在这里，
 * `rikke/touch.mjs` 与 `wansheng/touch.mjs` 只保留**各自的载荷内容**（标题 / target / 摘要句）。
 *
 * 四条语义（冻结契约 §2/§3/§4，逐条不许混）：
 *   1. **补课不推送**：`missed:true` → 账行 `skipped` + 理由「补生成：不补推送（界面标「补」）」。
 *      理由：开机瞬间连弹 N 条历史通知是噪音，界面用产物的 `missed` 标「补」就够了；
 *   2. **人点不发**：`manual:true` → `skipped` + 可读理由（界面自己会显示结果）；
 *   3. **没有壳 ≠ 故障**：`no-shell` / `state-missing` → `skipped`；`state-invalid` 与「壳没弹成」→ `failed`；
 *   4. **永不抛**：任何一步抛了都折成 `{status:'failed', reason}`；账写不进去只回 `ledgerError`。
 */

import { resolveNotifyTarget } from './target.mjs'
import { postNotify } from './send.mjs'
import { readShellSettings } from './settings.mjs'
import { appendTraffic, buildTrafficEntry } from './traffic.mjs'

/** 补课的账行理由（#25 契约 §3 逐字）。 */
export const MISSED_NOTIFY_REASON = '补生成：不补推送（界面标「补」）'

/** 人点生成的账行理由（#24 契约 §3 逐字）。 */
export const MANUAL_NOTIFY_REASON = '人点生成：不发系统通知（界面自己会显示结果）'

/** 产物在 dataDir 里的相对路径（账行 `artifactPath`）：`rikke/<date>.json` / `wansheng/<date>.json`。 */
export function artifactPathOf(kind, date) {
  return `${kind}/${date}.json`
}

/**
 * 判这次该不该发、发的结果（**永不抛**）。
 * @param {{dataDir: string, moment: Date, manual: boolean, missed: boolean, env: object|undefined, buildPayload: Function}} input
 */
async function attemptNotify({ dataDir, moment, manual, missed, env, buildPayload }) {
  if (missed === true) return { status: 'skipped', reason: MISSED_NOTIFY_REASON }
  if (manual === true) return { status: 'skipped', reason: MANUAL_NOTIFY_REASON }

  const target = resolveNotifyTarget({ env })
  if (!target.ok) {
    // `state-invalid` = 有东西自称是壳但这份状态文件不能用 → 这是**失败**，不是「没装壳」。
    if (target.reason === 'state-invalid') {
      return { status: 'failed', reason: `桌面应用的通知端点不可用（state-invalid）：${target.detail ?? '状态文件不合契约'}` }
    }
    return {
      status: 'skipped',
      reason: target.reason === 'state-missing'
        ? '桌面应用没有在运行（状态文件不存在）：不发系统通知'
        : '没有桌面应用（浏览器模式）：不发系统通知',
    }
  }

  const notifySummary = readShellSettings(dataDir).notifySummary === true
  const payload = buildPayload({ notifySummary, now: moment })
  const sent = await postNotify(payload, { env })
  if (sent.ok === true && sent.delivered === true) return { status: 'delivered', reason: null }
  if (sent.ok === true) return { status: 'failed', reason: `桌面应用没有弹出通知：${sent.reason}` }
  return { status: 'failed', reason: `通知没送到：${sent.reason}` }
}

/**
 * 记一次触达（通知 + 账）。**永不抛**。
 *
 * @param {{kind: 'rikke'|'wansheng', buildPayload: Function, dataDir: string, date: string,
 *          at?: Date, manual?: boolean, missed?: boolean, env?: object,
 *          occurrenceAt?: string|null}} input
 *        `buildPayload({notifySummary, now})` 只造载荷；发不发由本模块判。
 *        `occurrenceAt`：这一投递属于哪个计划时刻（补课/迟到时用它，缺省 = 投递时刻）。
 * @returns {Promise<{notify: {status: string, reason: string|null}, entry: object|null,
 *                    ledgerError: string|null}>}
 */
export async function deliverTouch({
  kind, buildPayload, dataDir, date, at = new Date(), manual = false, missed = false, env, occurrenceAt,
}) {
  const moment = at instanceof Date ? at : new Date(at)
  let notify
  try {
    notify = await attemptNotify({ dataDir, moment, manual, missed, env, buildPayload })
  } catch (error) {
    // 这一层兜的是「上面任何一步抛了」：通知失败绝不能变成「今天没有日课/晚省」。
    notify = { status: 'failed', reason: `通知流程抛了异常（已兜住）：${String(error?.message ?? error)}` }
  }

  let entry = null
  let ledgerError = null
  try {
    entry = appendTraffic(dataDir, buildTrafficEntry({
      kind,
      date,
      occurrenceAt: typeof occurrenceAt === 'string' && occurrenceAt !== '' ? occurrenceAt : moment.toISOString(),
      generated: true,
      artifactPath: artifactPathOf(kind, date),
      notify,
      at: moment.toISOString(),
      missed: missed === true,
    }))
  } catch (error) {
    // 账写不进去也不许影响产物 / 生成链（调用方只记日志）。
    ledgerError = `触达账写不进去：${String(error?.message ?? error)}`
  }
  return { notify, entry, ledgerError }
}
