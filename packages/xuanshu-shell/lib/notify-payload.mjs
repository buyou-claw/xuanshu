/**
 * packages/xuanshu-shell/lib/notify-payload.mjs — 壳侧**收到通知时的载荷校验**（冻结契约 §2）。
 *
 * 与宿主 `packages/xuanshu-host/lib/notify/send.mjs::validateNotify` 是**同一套判据**：
 * 壳是收端，宿主是发端；任何一侧松一点，另一侧的测试仍然是绿的，真机上才会表现为
 * 「宿主以为发了、壳拒收」或「壳收下了一个不该弹的形状」。对拍见
 * `tests/shell/contract-parity.test.mjs`（同一组夹具两边同判）。
 *
 * 纪律（契约 §2）：
 *   - 多余字段**忽略、不报错**；
 *   - `title` 裁掉两端空白后 1..120；`body` 0..200；`silent` boolean；`id` 非空；`createdAt` 可解析；
 *   - `kind` / `target` 是封闭枚举。
 */

import { BODY_LIMIT, NOTIFY_KINDS, NOTIFY_SCHEMA, NOTIFY_TARGETS, TITLE_LIMIT } from './contract.mjs'

/** 空值兜底成对象（`null` / 数组都不当对象用）。 */
function objectOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * 校验一条通知载荷。
 *
 * @param {unknown} payload
 * @returns {{ok: true}|{ok: false, reason: string}} `reason` 是给人读的中文短句
 */
export function validateNotifyPayload(payload) {
  const value = objectOf(payload)
  if (value.schema !== NOTIFY_SCHEMA) {
    return { ok: false, reason: `载荷不合契约：schema 必须是 ${NOTIFY_SCHEMA}，拿到 ${JSON.stringify(value.schema)}` }
  }
  if (typeof value.id !== 'string' || value.id.trim() === '') {
    return { ok: false, reason: '载荷不合契约：id 必须是非空字符串' }
  }
  if (!NOTIFY_KINDS.includes(value.kind)) {
    return { ok: false, reason: `载荷不合契约：kind 只能是 ${NOTIFY_KINDS.join(' / ')}，拿到 ${JSON.stringify(value.kind)}` }
  }
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  if (title === '' || title.length > TITLE_LIMIT) {
    return { ok: false, reason: `载荷不合契约：title 必须 1..${TITLE_LIMIT} 字` }
  }
  if (value.body !== undefined) {
    if (typeof value.body !== 'string' || value.body.length > BODY_LIMIT) {
      return { ok: false, reason: `载荷不合契约：body 必须 0..${BODY_LIMIT} 字（给的是 ${typeof value.body}）` }
    }
  }
  if (value.silent !== undefined && typeof value.silent !== 'boolean') {
    return { ok: false, reason: '载荷不合契约：silent 必须是 boolean' }
  }
  if (!NOTIFY_TARGETS.includes(value.target)) {
    return { ok: false, reason: `载荷不合契约：target 只能是 ${NOTIFY_TARGETS.join(' / ')}，拿到 ${JSON.stringify(value.target)}` }
  }
  if (typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) {
    return { ok: false, reason: '载荷不合契约：createdAt 必须是 ISO 时间字符串' }
  }
  return { ok: true }
}

/**
 * 把一条合法载荷**归一**成壳内部使用的形状（丢多余字段、补默认值）。
 *
 * 为什么补 `body` / `silent` 的默认值：`Notification` 构造器对 `undefined` 与 `''` 的处理不同，
 * 归一后展示层与测试都不必各自再写一遍默认值。
 *
 * @param {object} payload 已经过 `validateNotifyPayload`
 * @returns {{schema: string, id: string, kind: string, title: string, body: string, silent: boolean,
 *            target: string, createdAt: string}}
 */
export function normalizeNotifyPayload(payload) {
  const value = objectOf(payload)
  return {
    schema: value.schema,
    id: value.id,
    kind: value.kind,
    title: String(value.title).trim(),
    body: typeof value.body === 'string' ? value.body : '',
    silent: value.silent === true,
    target: value.target,
    createdAt: value.createdAt,
  }
}
