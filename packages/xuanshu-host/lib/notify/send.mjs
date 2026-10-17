/**
 * packages/xuanshu-host/lib/notify/send.mjs — 宿主 → 壳的**唯一**一条通知（冻结契约 §2 / §3）。
 *
 * 为什么是 `node:http` 而不是全局 `fetch`：同仓先例是 `lib/horosa/guard.mjs:392`（零第三方依赖、
 * 连的是本机端口），而这里要的正是「短超时 + 单项请求 + 绝不重试」——`fetch` 的默认行为（keep-alive
 * 连接池、内部重试语义、AbortSignal 的组合）都比这一个 POST 多。
 *
 * 三条纪律（ADR-0014:26「不允许把「没推成」显示成「推过了」」）：
 *   1. **永不抛**：连接拒绝 / 超时 / 非 JSON / 非 200 —— 一律折算成 `{ok:false, reason}`；
 *   2. **不重试、不自旋**：重试留给下一次定时投递（日课每天有一次），当场重试只会把「壳没起来」
 *      变成一串连接风暴；
 *   3. **不猜地址**：URL 由 `resolveNotifyTarget` 从状态文件读，且**再校验一次回环**
 *      （状态文件可写，写坏了不能把私事发去外网）。
 *
 * 返回语义：
 *   - `{ok:true, delivered:true}`：壳说 `Notification` 构造并 `show()` 没抛（契约 §2 的 delivered 语义）；
 *   - `{ok:true, delivered:false, reason}`：壳在，但没弹成（未授权 / 平台不支持）——**这也算「如实说了」**；
 *   - `{ok:false, reason}`：没送到（没有壳 / 连不上 / 超时 / 壳拒收 / 响应不可解析）。
 */

import { request } from 'node:http'

import { NOTIFY_KINDS, NOTIFY_SCHEMA, NOTIFY_TARGETS } from './contract.mjs'
import { parseLoopbackOrigin, resolveNotifyTarget } from './target.mjs'

// schema 与取值域的唯一来源在 `contract.mjs`；这里再导出同一份绑定（形状只有一个定义处）。
export { NOTIFY_KINDS, NOTIFY_SCHEMA, NOTIFY_TARGETS }

/** 壳侧端点的路径（契约 §2 定值）。 */
export const NOTIFY_PATH = '/v1/notify'

/** 默认超时（契约 §3：1–2s；通知不许把到点那条链拖住）。 */
export const NOTIFY_TIMEOUT_MS = 2000

/** title / body 的字符上限（契约 §2 定值）。 */
const TITLE_LIMIT = 120
const BODY_LIMIT = 200

/** 空值兜底成对象（`null` / 数组都不当对象用）。 */
function objectOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * 校验一条通知载荷（契约 §2 的字段集合与取值域）。
 *
 * 宿主自己发的载荷也要过这道门：它是两侧夹测的**公共断言**，而「本地拒发一条形状坏的通知」
 * 比「发出去再被壳拒」更容易定位。
 *
 * @param {unknown} payload
 * @returns {{ok: true}|{ok: false, reason: string}}
 */
export function validateNotify(payload) {
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

/** 壳 4xx 响应里的可读错误（`{ok:false,error:{code,message}}`，契约 §2）。 */
function errorTextOf(body, fallback) {
  const error = objectOf(objectOf(body).error)
  const code = typeof error.code === 'string' ? error.code : ''
  const message = typeof error.message === 'string' ? error.message : ''
  if (code !== '' && message !== '') return `${code}：${message}`
  if (code !== '') return code
  if (message !== '') return message
  return fallback
}

/**
 * 发一条通知（**永不抛**、不重试、2s 超时）。
 *
 * @param {object} payload 契约 §2 的载荷
 * @param {{timeoutMs?: number, env?: Record<string, string|undefined>}} [options]
 *        `timeoutMs` 默认 2000；`env` 默认 `process.env`（断言台显式注入，绝不读机器现场）。
 * @returns {Promise<{ok: true, delivered: boolean, reason?: string}|{ok: false, reason: string}>}
 */
export async function postNotify(payload, options = {}) {
  const { timeoutMs = NOTIFY_TIMEOUT_MS, env = process.env } = options
  const validation = validateNotify(payload)
  if (!validation.ok) return { ok: false, reason: validation.reason }

  const target = resolveNotifyTarget({ env })
  if (!target.ok) return { ok: false, reason: target.reason }

  // 再校验一次回环：状态文件是可写文件，发送前必须确认它没被换成外网地址（契约 §3 原文）。
  const origin = parseLoopbackOrigin(target.url)
  if (origin === null) return { ok: false, reason: 'state-invalid' }

  const body = JSON.stringify(payload)
  return await new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    let req
    try {
      req = request({
        host: origin.host,
        port: origin.port,
        path: NOTIFY_PATH,
        method: 'POST',
        // 一次性请求：不复用连接（同 `horosa/guard.mjs:392` 的 `agent:false`）。
        agent: false,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          authorization: `Bearer ${target.token}`,
        },
      }, (res) => {
        const chunks = []
        res.setEncoding('utf8')
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = chunks.join('')
          let parsed = null
          try {
            parsed = JSON.parse(text)
          } catch {
            parsed = null
          }
          const status = Number(res.statusCode ?? 0)
          if (status !== 200) {
            finish({ ok: false, reason: `壳回了 HTTP ${status}（${errorTextOf(parsed, text.slice(0, 120) || '没有正文')}）` })
            return
          }
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            finish({ ok: false, reason: `壳的响应不是 JSON，无法确认送达：${text.slice(0, 120)}` })
            return
          }
          if (parsed.ok !== true) {
            finish({ ok: false, reason: `壳拒收了这条通知（${errorTextOf(parsed, '没有给理由')}）` })
            return
          }
          if (parsed.delivered === true) {
            finish({ ok: true, delivered: true })
            return
          }
          // 壳在、也听懂了，但没弹成：**如实带回**（契约 §2 的 delivered:false 语义）。
          finish({
            ok: true,
            delivered: false,
            reason: typeof parsed.reason === 'string' && parsed.reason.trim() !== '' ? parsed.reason : '壳没有弹出通知（未给理由）',
          })
        })
      })
      req.setTimeout(timeoutMs, () => {
        finish({ ok: false, reason: `等壳的响应超时（${timeoutMs}ms）` })
        req.destroy()
      })
      req.on('error', (error) => {
        const code = typeof error?.code === 'string' ? error.code : String(error?.message ?? error)
        finish({ ok: false, reason: `连不上壳的通知端点（${code}）` })
      })
      req.end(body)
    } catch (error) {
      // 同步抛（URL/端口组合在极端情况下）：兜住，绝不让通知把生成链带下来。
      finish({ ok: false, reason: `发送通知时抛了异常（已兜住）：${String(error?.message ?? error)}` })
    }
  })
}
