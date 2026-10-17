/**
 * packages/xuanshu-shell/lib/notify-server.mjs — 壳侧回环通知端点（冻结契约 §2）。
 *
 * 这是壳与宿主之间**唯一**的 IPC。实现纪律：
 *   - **只绑 `127.0.0.1`**，端口 `0`（OS 分配），实际端口由壳写进状态文件；
 *   - **纯 `node:http`**（零第三方依赖），展示层通过注入的 `showNotification(payload, {onClick})`
 *     适配器接进来 —— 测试里用假适配器，真机上是 Electron `Notification`；
 *   - **delivered 的语义 = 「构造并 show() 没抛」**（契约 §2 原文）。没弹出来时 **HTTP 仍是 200**，
 *     只把 `delivered:false` + 可读 `reason` 如实带回；绝不把「没推成」显示成「推过了」；
 *   - **点击回调交给调用方**：本模块只把 `onClick` 接到系统通知上，**不**决定点完停在哪一屏。
 *     壳的接线（`main.mjs` → `main-flow.mjs::createNotificationClickHandler`）负责
 *     「唤出窗口 + 把页面带到 overview（`#xuanshu-overview`）」；`target` 原样交给调用方，
 *     `consult` 没有深链时同样落到 overview（契约 §2 的 `target` 是**建议**，不假装点了哪条进哪页）。
 *
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

import { NOTIFY_HOST, NOTIFY_PATH } from './contract.mjs'
import { normalizeNotifyPayload, validateNotifyPayload } from './notify-payload.mjs'

/** 请求体上限：一条通知只有标题与可选短句，64KB 已经宽松到不可能误伤正常载荷。 */
export const MAX_BODY_BYTES = 64 * 1024

/** 允许的失败理由（契约 §2；未知理由一律折成 `failed`，不把壳的内部词表漏给宿主）。 */
const FAILURE_REASONS = new Set(['unsupported', 'permission-denied', 'failed'])

/** 空值兜底成对象。 */
function objectOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/** `authorization: Bearer <token>` 是否匹配（定长比较，避免 token 逐字符泄露时序）。 */
function tokenMatches(header, token) {
  if (typeof header !== 'string' || typeof token !== 'string' || token === '') return false
  const match = /^Bearer\s+(.+)$/iu.exec(header.trim())
  if (match === null) return false
  const given = Buffer.from(match[1], 'utf8')
  const expected = Buffer.from(token, 'utf8')
  if (given.length !== expected.length) return false
  return timingSafeEqual(given, expected)
}

/** 发一份 JSON 响应（只发一次）。 */
function respond(res, status, body) {
  if (res.headersSent === true) return
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    // 端点只服务本机宿主：禁缓存、禁嗅探。
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(text)
}

/**
 * 建一台通知端点（**还没监听**；`listen()` 之后才有 url）。
 *
 * @param {{token: string, showNotification: (payload: object, options: {onClick: () => void}) => object,
 *          onNotificationClick?: (payload: object) => void,
 *          capabilities?: {notification?: boolean, clickToWindow?: boolean},
 *          host?: string, port?: number, logger?: {warn?: Function}}} options
 */
export function createNotifyServer({
  token, showNotification, onNotificationClick = () => {},
  capabilities = { notification: true, clickToWindow: true },
  host = NOTIFY_HOST, port = 0, logger = console,
} = {}) {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('createNotifyServer needs a non-empty token（壳必须生成随机 token 再写状态文件）')
  }
  if (typeof showNotification !== 'function') {
    throw new Error('createNotifyServer needs a showNotification adapter')
  }
  if (typeof onNotificationClick !== 'function') {
    throw new Error('createNotifyServer needs onNotificationClick to be a function')
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`通知端点只允许监听回环（127.0.0.1 / localhost），拿到 ${JSON.stringify(host)}`)
  }

  const normalizedCapabilities = {
    notification: objectOf(capabilities).notification === true,
    clickToWindow: objectOf(capabilities).clickToWindow === true,
  }

  const server = createServer((req, res) => {
    /** 请求路径（只认 `/v1/notify`，别的 404）。 */
    let pathname
    try {
      pathname = new URL(req.url ?? '/', `http://${host}`).pathname
    } catch {
      pathname = '/'
    }
    if (pathname !== NOTIFY_PATH) {
      respond(res, 404, { ok: false, error: { code: 'not-found' } })
      req.resume()
      return
    }
    if (req.method !== 'POST') {
      respond(res, 405, { ok: false, error: { code: 'method-not-allowed' } })
      req.resume()
      return
    }
    // 鉴权先于读 body：token 不对的连接不值得为它缓冲 64KB。
    if (!tokenMatches(req.headers.authorization, token)) {
      respond(res, 401, { ok: false, error: { code: 'unauthorized' } })
      req.resume()
      return
    }

    /** @type {Buffer[]} */
    const chunks = []
    let received = 0
    let tooLarge = false
    let finished = false

    const finish = (status, body) => {
      if (finished) return
      finished = true
      respond(res, status, body)
    }

    req.on('data', (chunk) => {
      if (finished) return
      received += chunk.length
      if (received > MAX_BODY_BYTES) {
        tooLarge = true
        finish(400, {
          ok: false,
          error: { code: 'invalid-payload', message: `请求体超过 ${MAX_BODY_BYTES} 字节` },
        })
        // 把剩下的读完再丢：直接 destroy 会让客户端收到 ECONNRESET 而不是这份 400。
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', () => {
      /* 客户端断开：没有响应可发，吞掉即可（服务不能因为一条坏请求倒掉） */
    })
    req.on('end', () => {
      if (finished || tooLarge) return
      const text = Buffer.concat(chunks).toString('utf8')
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        finish(400, { ok: false, error: { code: 'invalid-payload', message: '请求体不是合法 JSON' } })
        return
      }
      const validation = validateNotifyPayload(parsed)
      if (!validation.ok) {
        finish(400, { ok: false, error: { code: 'invalid-payload', message: validation.reason } })
        return
      }

      const payload = normalizeNotifyPayload(parsed)
      let result
      try {
        result = showNotification(payload, { onClick: () => click(payload) })
      } catch (error) {
        // 适配器抛异常：通知没弹成，但**请求本身是合法的** —— 200 + delivered:false（契约 §2）。
        finish(200, {
          ok: true,
          delivered: false,
          reason: 'failed',
          detail: `展示通知时抛了异常：${String(error?.message ?? error)}`,
        })
        return
      }

      const outcome = objectOf(result)
      if (outcome.shown === true) {
        finish(200, { ok: true, delivered: true })
        return
      }
      const reason = FAILURE_REASONS.has(outcome.reason) ? outcome.reason : 'failed'
      const response = { ok: true, delivered: false, reason }
      if (typeof outcome.detail === 'string' && outcome.detail !== '') response.detail = outcome.detail
      finish(200, response)
    })
  })

  let listening = false
  let currentUrl

  /** 点击回调：只唤出窗口（调用方决定是否按 target 做点什么）。异常不许带倒端点。 */
  function click(payload) {
    try {
      const outcome = onNotificationClick(payload)
      if (outcome !== null && typeof outcome === 'object' && typeof outcome.catch === 'function') {
        outcome.catch((error) => logger?.warn?.(`[shell] 点击通知后唤出窗口失败：${String(error?.message ?? error)}`))
      }
    } catch (error) {
      logger?.warn?.(`[shell] 点击通知后唤出窗口失败：${String(error?.message ?? error)}`)
    }
  }

  return {
    token,
    capabilities: normalizedCapabilities,
    get url() {
      return currentUrl
    },
    /** 监听之后的真实地址（测试与 runbook 排障用）。 */
    get address() {
      const address = server.address()
      return address !== null && typeof address === 'object' ? address : undefined
    },
    /**
     * 开始监听（默认 OS 分配端口）。返回实际 url。
     * @returns {Promise<{url: string, port: number}>}
     */
    listen() {
      if (listening) throw new Error('notify server already listening')
      return new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening)
          reject(error)
        }
        const onListening = () => {
          server.off('error', onError)
          listening = true
          const address = server.address()
          const actualPort = typeof address === 'object' && address !== null ? address.port : port
          currentUrl = `http://${host}:${actualPort}`
          resolve({ url: currentUrl, port: actualPort })
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, host)
      })
    },
    /** 关闭端点（幂等）。 */
    close() {
      if (!listening) return Promise.resolve()
      listening = false
      currentUrl = undefined
      return new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
    },
  }
}
