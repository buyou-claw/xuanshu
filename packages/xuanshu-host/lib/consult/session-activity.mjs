/**
 * packages/xuanshu-host/lib/consult/session-activity.mjs — 会话活动判据的**中立零件**（复核 A1）。
 *
 * 有两个消费方各自需要「这场会话最后一次人的活动是什么」：
 *   - `wansheng/facts.mjs`（晚省事实：项目 / 工作流今天有没有活动）；
 *   - `shiji/scan.mjs`（事记依据：哪些场次有人在说话 + 标题 / 问句素材）。
 * 从前两处各写一份「投影缓存 → 日志回落」的链。精读后确认**策略层语义不同**（错误纪律、活动口径、
 * 缓存答问口径、附带产物都不同，见 `tests/wansheng/session-activity-parity.test.mjs` 的差异表），
 * 硬抽成一份会改掉一边的语义 —— 所以这里只抽**与策略无关**的三件共用零件，策略留在各自调用点：
 *
 *   1. `isUserPromptEvent()`：什么算「人在会话里说的那一句」（注入的上下文 / 采用稿 / 定时提醒都不算）；
 *   2. `readSessionProjection()`：读一次投影缓存，把「缓存缺席 / 抛错」折算成回执
 *      （**谁**决定静默回落还是记 `notes`，是调用方的事）；
 *   3. `sessionHeadersOf()`：`listSessions()` 记录 → `id → header`（id 归一化由调用方给，保持各自口径）。
 *
 * 本模块是叶子：零 import，不会把会话 / agent 面拖进任何一条链。
 */

/**
 * 「人在会话里说的那一句」的判据（投影日志与 `readSession` 的事件同形）。
 *
 * 玄枢注入的上下文（`xuanshu-consult`）与采用稿（`xuanshu-bestof-adopted`）不是「人说的话」；
 * 定时提醒（`source.kind === 'schedule'`）也不是。
 */
export function isUserPromptEvent(event) {
  return event?.type === 'user/message' && event?.data?.source?.kind === 'user'
}

/**
 * 读一次投影缓存（缓存只是**捷径**，不是权威）。
 *
 * @param {{cachedSnapshot?: Function}} cache - `ctx.sessionProjectionCache`（可能缺席）
 * @param {object} header - 会话 header
 * @param {string[]} keys - 要取哪些投影（如 `['title','sessionListMetadata']`）
 * @returns {{available: boolean, values: object|undefined, error?: unknown}}
 *          `available:false` = 缓存服务没有这个能力（调用方应回落读日志）；
 *          `error` 有值 = 这一次缓存抛了（调用方决定静默还是记 `notes`，两者语义不同，别在零件里定）。
 */
export function readSessionProjection(cache, header, keys) {
  if (typeof cache?.cachedSnapshot !== 'function') return { available: false, values: undefined }
  try {
    const snapshot = cache.cachedSnapshot(header, keys)
    return { available: true, values: snapshot?.values }
  } catch (error) {
    return { available: true, values: undefined, error }
  }
}

/**
 * `listSessions()` 的记录 → `id → header`。
 *
 * 记录清单的**有效性**（是不是数组、读失败怎么办）仍由调用方判断：晚省把非数组当错误（省略事实），
 * 事记当「这一路核不了」（记 note 后按缓存/日志继续）。这里只做归一。
 *
 * @param {unknown} records - `listSessions()` 的返回
 * @param {(id: string) => string} [normalizeId] - id 归一化（晚省 trim、事记原样；两份口径不同）
 * @returns {Map<string, object>}
 */
export function sessionHeadersOf(records, normalizeId = (id) => id) {
  const headers = new Map()
  for (const record of Array.isArray(records) ? records : []) {
    const id = record?.header?.id
    if (typeof id !== 'string') continue
    const normalized = normalizeId(id)
    if (normalized === '') continue
    headers.set(normalized, record.header)
  }
  return headers
}
