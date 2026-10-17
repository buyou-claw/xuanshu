/**
 * packages/xuanshu-host/lib/wansheng/touch.mjs — 晚省这一次「触达」的**内容**（#25 契约 §3）。
 *
 * 与日课同一条纪律（实现共用 `../notify/touch.mjs`）：
 *   - 载荷：`kind='wansheng'`、`title='今天要不要过一遍'`、`target='consult'`（点开进问事）；
 *     默认 `body=''`（锁屏不露内容），设置里打开 `notifySummary` 才带一句**不含私事**的泛化短句；
 *   - 人点 [立即生成] 不发系统通知（账里 `skipped`，理由可读）；
 *   - 补课（`missed:true`）**不推送**，账行 `skipped`，界面用产物的 `missed` 标「补」。
 */

import { randomUUID } from 'node:crypto'

import { NOTIFY_SCHEMA } from '../notify/contract.mjs'
import { artifactPathOf, deliverTouch } from '../notify/touch.mjs'
import { WANSHENG_DIR } from './store.mjs'

/** 通知标题（契约 §3 定值：「今天要不要过一遍」）。 */
export const WANSHENG_NOTIFY_TITLE = '今天要不要过一遍'

/** 打开摘要后的那一句（泛化、不含私事：不列具体场次 / 项目名）。 */
export const WANSHENG_NOTIFY_SUMMARY = '今天的晚省已经备好，回玄枢看看今天都做了什么。'

/** 通知点击后停哪一屏（契约 §2：`target` 只是建议，壳做不到深链时只唤出窗口）。 */
export const WANSHENG_NOTIFY_TARGET = 'consult'

const NOTIFY_ID_PREFIX = 'notify-'

/** 产物在 dataDir 里的相对路径（账行 `artifactPath`）。 */
export function wanshengArtifactPath(date) {
  return artifactPathOf(WANSHENG_DIR, date)
}

/**
 * 组一条晚省通知（契约 §2 的载荷）。
 * @param {{notifySummary?: boolean, now?: Date, id?: string}} input
 * @returns {object}
 */
export function buildWanshengNotify({ notifySummary = false, now = new Date(), id } = {}) {
  return {
    schema: NOTIFY_SCHEMA,
    id: typeof id === 'string' && id !== '' ? id : `${NOTIFY_ID_PREFIX}${randomUUID()}`,
    kind: 'wansheng',
    title: WANSHENG_NOTIFY_TITLE,
    body: notifySummary === true ? WANSHENG_NOTIFY_SUMMARY : '',
    silent: false,
    target: WANSHENG_NOTIFY_TARGET,
    createdAt: now.toISOString(),
  }
}

/**
 * 记一次晚省触达（通知 + 账）。**永不抛**。
 * @param {{dataDir: string, date: string, at?: Date, manual?: boolean, missed?: boolean,
 *          occurrenceAt?: string|null, env?: Record<string, string|undefined>}} input
 * @returns {Promise<{notify: {status: string, reason: string|null}, entry: object|null,
 *                    ledgerError: string|null}>}
 */
export async function deliverWanshengTouch({
  dataDir, date, at = new Date(), manual = false, missed = false, occurrenceAt, env,
} = {}) {
  return deliverTouch({
    kind: 'wansheng',
    buildPayload: ({ notifySummary, now }) => buildWanshengNotify({ notifySummary, now }),
    dataDir,
    date,
    at,
    manual,
    missed,
    occurrenceAt,
    env,
  })
}
