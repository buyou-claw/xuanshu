/**
 * packages/xuanshu-host/lib/rikke/touch.mjs — 日课这一次「触达」的**内容**（冻结契约 §2/§3）。
 *
 * 「发不发、怎么落账」的共用实现搬到了 `../notify/touch.mjs`（#25 的晚省/补课是同一件事的另外几个现场，
 * 抄第二份必然漂移）。本文件只留日课特有的两件事：
 *   - 载荷内容：`title='今日日课已生成'`、`target='overview'`，摘要打开后带一句**不含私事**的泛化短句；
 *   - 产物路径：`rikke/<date>.json`。
 *
 * #25 的加性字段：`missed`（补生成 → 账行 `skipped`，不推送）与 `occurrenceAt`（这一投递属于哪个计划时刻）。
 */

import { randomUUID } from 'node:crypto'

import { NOTIFY_SCHEMA } from '../notify/contract.mjs'
import { artifactPathOf, deliverTouch } from '../notify/touch.mjs'
import { RIKKE_DIR } from './store.mjs'

/** 通知标题（契约 §3 定值）。 */
export const RIKKE_NOTIFY_TITLE = '今日日课已生成'

/** 打开摘要后的那一句（泛化、不含私事；由宿主生成，壳不加工）。 */
export const RIKKE_NOTIFY_SUMMARY = '今天的日课已经生成，回玄枢看看今天要注意什么。'

/** 通知的 id 前缀（契约 §2：`notify-<uuid>`）。 */
const NOTIFY_ID_PREFIX = 'notify-'

/** 产物在 dataDir 里的相对路径（账行里的 `artifactPath`）。 */
export function rikkeArtifactPath(date) {
  return artifactPathOf(RIKKE_DIR, date)
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

/**
 * 记一次日课触达（通知 + 账）。**永不抛**。
 *
 * @param {{dataDir: string, date: string, at?: Date, manual?: boolean, missed?: boolean,
 *          occurrenceAt?: string|null, env?: Record<string, string|undefined>}} input
 *        `env` 缺省 = `undefined`（= 拿不到壳环境）；生产调用方显式传 `process.env`
 * @returns {Promise<{notify: {status: string, reason: string|null}, entry: object|null,
 *                    ledgerError: string|null}>}
 */
export async function deliverRikkeTouch({
  dataDir, date, at = new Date(), manual = false, missed = false, occurrenceAt, env,
} = {}) {
  return deliverTouch({
    kind: 'rikke',
    buildPayload: ({ notifySummary, now }) => buildRikkeNotify({ date, notifySummary, now }),
    dataDir,
    date,
    at,
    manual,
    missed,
    occurrenceAt,
    env,
  })
}
