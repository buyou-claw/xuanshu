/**
 * packages/xuanshu-host/lib/rikke/touch.mjs — 日课这一次「触达」的宿主半（冻结契约 §2/§3/§4）。
 *
 * 一次触达 = 一条系统通知 + 一行触达账：
 *   - **通知**：`postNotify()` 发到壳的回环端点；`manual:true`（人点 [立即生成]）**不发**系统通知
 *     —— 界面自己会显示结果，再弹一次系统通知就是噪音；
 *   - **账**：无论推没推成，都追加一行 `traffic.jsonl`（`delivered|failed|skipped`，理由可读）。
 *
 * 三条纪律：
 *   1. **通知绝不阻塞生成**：本模块所有失败都折成 `{status:'failed', reason}`，调用方（`delivery.mjs`
 *      与 `rikke.generate`）拿到的是数据，不是异常；账写不进去也只是 `ledgerError`；
 *   2. **notify.status 的三态语义不许混**：`skipped` = 明确不推（人点 / 没有壳），
 *      `failed` = 有壳但推失败（连不上 / 没授权 / 状态文件坏了），`delivered` = 壳说弹成功了；
 *   3. **内容默认泛化**：`title='今日日课已生成'`、`body=''`；只有设置里打开 `notifySummary`
 *      才带一句泛化短句 —— 且**不含宜忌 / 流日 / AI 段的任何具体内容**（锁屏可见）。
 */

import { randomUUID } from 'node:crypto'

import { NOTIFY_SCHEMA } from '../notify/contract.mjs'
import { postNotify } from '../notify/send.mjs'
import { readShellSettings } from '../notify/settings.mjs'
import { appendTraffic, buildTrafficEntry } from '../notify/traffic.mjs'
import { resolveNotifyTarget } from '../notify/target.mjs'
import { RIKKE_DIR } from './store.mjs'

/** 通知标题（契约 §3 定值）。 */
export const RIKKE_NOTIFY_TITLE = '今日日课已生成'

/** 打开摘要后的那一句（泛化、不含私事；由宿主生成，壳不加工）。 */
export const RIKKE_NOTIFY_SUMMARY = '今天的日课已经生成，回玄枢看看今天要注意什么。'

/** 通知的 id 前缀（契约 §2：`notify-<uuid>`）。 */
const NOTIFY_ID_PREFIX = 'notify-'

/** 产物在 dataDir 里的相对路径（账行里的 `artifactPath`）。 */
export function rikkeArtifactPath(date) {
  return `${RIKKE_DIR}/${date}.json`
}

/**
 * 组一条日课通知（契约 §2 的载荷）。
 *
 * @param {{date: string, notifySummary?: boolean, now?: Date, id?: string}} input
 * @returns {object}
 */
export function buildRikkeNotify({ date, notifySummary = false, now = new Date(), id } = {}) {
  return {
    schema: NOTIFY_SCHEMA,
    id: typeof id === 'string' && id !== '' ? id : `${NOTIFY_ID_PREFIX}${randomUUID()}`,
    kind: 'rikke',
    title: RIKKE_NOTIFY_TITLE,
    // 默认**不露内容**：锁屏上只看到「今日日课已生成」。
    body: notifySummary === true ? RIKKE_NOTIFY_SUMMARY : '',
    silent: false,
    target: 'overview',
    createdAt: now.toISOString(),
  }
}

/** 判一次触达该不该发、发的结果（**永不抛**）。 */
async function attemptNotify({ dataDir, date, moment, manual, env }) {
  if (manual === true) {
    return { status: 'skipped', reason: '人点生成：不发系统通知（界面自己会显示结果）' }
  }

  const target = resolveNotifyTarget({ env })
  if (!target.ok) {
    // `state-invalid` = 有东西自称是壳但这份状态文件不能用 → 这是**失败**，不是「没装壳」。
    if (target.reason === 'state-invalid') {
      return { status: 'failed', reason: `桌面壳的通知端点不可用（state-invalid）：${target.detail ?? '状态文件不合契约'}` }
    }
    return {
      status: 'skipped',
      reason: target.reason === 'state-missing'
        ? '桌面壳没有在运行（状态文件不存在）：不发系统通知'
        : '没有桌面壳（浏览器模式）：不发系统通知',
    }
  }

  const notifySummary = readShellSettings(dataDir).notifySummary === true
  const payload = buildRikkeNotify({ date, notifySummary, now: moment })
  const sent = await postNotify(payload, { env })
  if (sent.ok === true && sent.delivered === true) return { status: 'delivered', reason: null }
  if (sent.ok === true) return { status: 'failed', reason: `桌面壳没有弹出通知：${sent.reason}` }
  return { status: 'failed', reason: `通知没送到：${sent.reason}` }
}

/**
 * 记一次日课触达（通知 + 账）。**永不抛**。
 *
 * @param {{dataDir: string, date: string, at?: Date, manual?: boolean, env?: Record<string, string|undefined>}} input
 *        `env` 缺省 = `{}`（= 拿不到壳环境）；生产调用方显式传 `process.env`
 * @returns {Promise<{notify: {status: string, reason: string|null}, entry: object|null,
 *                    ledgerError: string|null}>}
 */
export async function deliverRikkeTouch({ dataDir, date, at = new Date(), manual = false, env } = {}) {
  const moment = at instanceof Date ? at : new Date(at)
  let notify
  try {
    notify = await attemptNotify({ dataDir, date, moment, manual, env })
  } catch (error) {
    // 这一层兜的是「上面任何一步抛了」：通知失败绝不能变成「今天没有日课」。
    notify = { status: 'failed', reason: `通知流程抛了异常（已兜住）：${String(error?.message ?? error)}` }
  }

  let entry = null
  let ledgerError = null
  try {
    entry = appendTraffic(dataDir, buildTrafficEntry({
      kind: 'rikke',
      date,
      occurrenceAt: moment.toISOString(),
      generated: true,
      artifactPath: rikkeArtifactPath(date),
      notify,
      at: moment.toISOString(),
    }))
  } catch (error) {
    // 账写不进去也不许影响产物 / 生成链（调用方只记日志）。
    ledgerError = `触达账写不进去：${String(error?.message ?? error)}`
  }
  return { notify, entry, ledgerError }
}
