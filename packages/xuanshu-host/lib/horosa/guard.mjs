/**
 * packages/xuanshu-host/lib/horosa/guard.mjs
 *
 * 宿主侧的 **MCP 客户端 + 端口四态守卫**（票 06 契约 §3.1 冻结签名）：
 *   mcpInitialize({ host, port, path, timeoutMs })          -> { ok, status, sessionId, serverInfo, evidence, detail }
 *   mcpToolsList({ host, port, path, timeoutMs })           -> { ok, status, sessionId, tools, serverInfo, evidence, detail }
 *   mcpCallTool({ name, args, host, port, path, timeoutMs })-> { ok, envelope, from, evidence, detail }
 *   checkHorosaEndpoint({ host, port, path, timeoutMs })
 *     -> { ok, verdict, host, port, url, sessionId, evidence, detail, hint }
 *
 * 为什么这里**另写一份**（不 import `scripts/horosa/mcp-client.mjs` 与 `scripts/isolation/**`）：
 * 宿主插件是从 `<profile>/node_modules/xuanshu-host` 加载的分发物，运行环境里没有仓库目录
 * （copy 模式 / 别人的机器上根本没有 `scripts/`）。这份债由票 06 的两条测试钉住：
 *   - **P1 四态 parity**：本文件的 `checkHorosaEndpoint` 与票 04 的 `checkHorosaPort`
 *     在同样三个现场（空闲端口 / 非 MCP 的 HTTP 服务 / 带 `mcp-session-id` 的假 MCP）给**同一个
 *     verdict 字符串**（词表 `free`/`horosa-ready`/`occupied-foreign`/`probe-failed` 逐字相同）；
 *   - **P10 e2e**：真实端点上（默认端口，见 `constants.mjs`）四组断言全绿。
 *
 * 真实的传输形状（实测捕获 `captures/setup-e2e-groundtruth.md` §4、`gt06-*`；本文件按它写，不按规范猜）：
 *   1. `initialize` → 200 + `content-type: text/event-stream` + 响应头 **`mcp-session-id`（必须有）**，
 *      载荷在 SSE 的 `data:` 行里，`result.serverInfo.version === '0.40.1'`；
 *   2. `notifications/initialized`（通知，无 id）→ **202 + 空 body**（空体是**正常**的，不是错误）；
 *   3. `tools/list` → 200，`result.tools`（实测 120 条）；
 *   4. `tools/call` → `result.content[0].text` 是被 `JSON.stringify` 过的信封（`structuredContent` 仅兼容）；
 *   5. **SSE 拿到应答即早停**（`AbortController`/`destroy` 收流）：streamable-http 的会话流可能一直挂着
 *      不结束，等它关流 = 每次都撞超时，会造出「真连能过、探针超时」的假红。
 *
 * 四态状态机（与票 04 `checkHorosaPort` 逐字同语义；`probe-failed` = **无法判定**，不是「被占」）：
 *   三条「像 horosa MCP」判据（任一成立即 `horosa-ready`，证据写进 evidence）：
 *     ① 响应头有非空 `mcp-session-id`；② `status===405` 且 `allow` 含 `POST`；
 *     ③ `content-type` 是 json/sse 且 body（SSE 先剥 `data:` 行）解析出含 `jsonrpc`/`error`/`result` 的对象。
 *   其余**有 status 的**响应一律 `occupied-foreign`（那才是可下结论的占用）；
 *   没有 HTTP 响应时：`ECONNREFUSED` → `free`；有人 LISTEN 却零响应 → `probe-failed`（fail-closed）；
 *   探针自身出错（非法端口/网络错误）→ `probe-failed`。
 *
 * 只探回环（契约 §2.3：非回环不暴露）：非回环 host 一律折算到 `127.0.0.1` 再探 —— 非回环门
 * 在 `resolveHorosaPlan` / `startHorosaServe`（code `non-loopback-host`），不在这一层。
 *
 * 只用 Node 内置模块（`node:http` / `node:net`），零第三方依赖；**绝不抛**。
 */

import http from 'node:http'
import net from 'node:net'

import { HOROSA_DEFAULT_HOST, HOROSA_DEFAULT_PORT, HOROSA_MCP_PATH } from './constants.mjs'
import { loopbackHost } from './paths.mjs'

/** MCP 交互的默认总预算（tools/list 在 120 条时约 500KB）。 */
const DEFAULT_TIMEOUT_MS = 20_000
/** 四态探针的默认预算（与票 04 守卫缺省一致：TCP + HTTP 共享这一个预算）。 */
const DEFAULT_PROBE_TIMEOUT_MS = 1500
/** MCP 规范版本：与真机握手成功的那一次一致。 */
const PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'xuanshu-host', version: '0.1.0' }
const USER_AGENT = 'xuanshu-host-horosa/1'
/** evidence 里的 body 只留头部（证据 ≤2KB/项）。 */
const BODY_HEAD_LIMIT = 400
/** 四态探针只取 body 前若干字节（MCP 响应可能很大，判定只需看到 JSON-RPC 形状）。 */
const PROBE_BODY_LIMIT = 2048
/** 单次响应体读入上限：tools/list ≈ 500KB、八字信封 ≈ 200KB；8MB 是「绝不 OOM、又不误伤」的量级。 */
const MAX_BODY_CHARS = 8 * 1024 * 1024

let rpcCounter = 0
function nextId() {
  rpcCounter += 1
  return rpcCounter
}

/** 把任意异常折算成可分类的字符串（优先 errno code）。 */
function errCode(error) {
  if (error === null || error === undefined) return 'unknown error'
  if (typeof error === 'string') return error
  return error.code || error.message || String(error)
}

/** 截断成单行证据（换行剁平，免得 evidence 撑爆日志）。 */
function truncate(value, limit = BODY_HEAD_LIMIT) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** JSON 解析（失败返回 undefined，绝不抛）。 */
function tryJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * 归一化 HTTP 响应头：键小写、值字符串（同头多次出现时 `join(', ')`，与票 04 `normalizeHeaders` 同口径
 * ——`allow` 的 `/\bpost\b/i` 判定依赖这个分隔语义）。
 */
function normalizeHeaders(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue
    out[String(key).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return out
}

/** SSE 体里所有 `data:` 行的载荷（规范允许 `data:` 后不跟空格，所以空格可有可无）。 */
function ssePayloads(text) {
  const out = []
  for (const line of String(text).split(/\r?\n/)) {
    const matched = /^data:\s?(.*)$/.exec(line)
    if (!matched) continue
    const payload = matched[1].trim()
    if (payload) out.push(payload)
  }
  return out
}

/**
 * 从响应体文本里抽 JSON-RPC 消息。SSE 声明的体只读 `data:` 行；真有实现会把 JSON 直接放体里
 * （或反之），所以两种都试 —— 多试一个候选不会让判定变松，只有真能 `JSON.parse` 成对象的才算消息。
 */
function extractMessages(text, contentType) {
  const candidates = []
  const ct = String(contentType ?? '').toLowerCase()
  if (ct.includes('text/event-stream')) candidates.push(...ssePayloads(text))
  const trimmed = String(text ?? '').trim()
  if (trimmed) candidates.push(trimmed)

  const messages = []
  for (const candidate of candidates) {
    const parsed = tryJsonParse(candidate)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) messages.push(parsed)
  }
  return messages
}

/** 本流的早停判据：SSE 里已经出现了这次请求的应答。 */
function hasReply(text, expectReply) {
  for (const payload of ssePayloads(text)) {
    const parsed = tryJsonParse(payload)
    if (!parsed || typeof parsed !== 'object') continue
    if (expectReply.id !== undefined && parsed.id === expectReply.id) return true
    if (expectReply.id === undefined && ('result' in parsed || 'error' in parsed)) return true
  }
  return false
}

/** 从消息数组里挑这次请求的应答：先按 id 精确匹配，再退一步取第一条带 result/error 的。 */
function pickReply(messages, id) {
  const list = Array.isArray(messages) ? messages : []
  return list.find((message) => message && message.id === id) ?? list.find((message) => message && ('result' in message || 'error' in message)) ?? null
}

/** JSON-RPC error → 一行可读文本。 */
function rpcErrorText(error) {
  if (!error || typeof error !== 'object') return 'unknown error'
  return `JSON-RPC error ${error.code === undefined ? '?' : String(error.code)}: ${truncate(error.message ?? '', 300)}`
}

function buildUrl(host, port, path) {
  const suffix = typeof path === 'string' && path.length > 0 ? path : HOROSA_MCP_PATH
  return `http://${host}:${port}${suffix.startsWith('/') ? suffix : `/${suffix}`}`
}

/** 端口合法性（非法一律不发起请求）。 */
function validPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

/** 探针/客户端只连回环：非回环 host 折算到 127.0.0.1（对 `0.0.0.0` 这类「含回环的绑定」也是对的）。 */
function probeHostOf(host) {
  return loopbackHost(host) || HOROSA_DEFAULT_HOST
}

/* ------------------------------------------------------------------ *
 * 底层探针：isPortBusy / httpGetProbe
 * （与 scripts/isolation/port-probe.mjs 同语义的另一份实现；口径由 P1 parity 钉住）
 * ------------------------------------------------------------------ */

/** 「本机回环上有人 LISTEN 吗」：TCP connect 成功 = true；ECONNREFUSED/超时/异常 = false。 */
function isPortBusy(port, host, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    let socket = null
    let timer = null

    const settle = (busy) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try {
        socket?.destroy()
      } catch {
        /* 销毁失败不影响判定 */
      }
      resolve(busy)
    }

    try {
      socket = net.connect({ port, host })
    } catch {
      settle(false)
      return
    }
    timer = setTimeout(() => settle(false), Math.max(1, timeoutMs))
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
    socket.once('timeout', () => settle(false))
  })
}

/**
 * 一次 GET，产出足够裁决的证据。
 * 超时的两种语义要分开（票 04 §5.1 R5 的核心）：
 *   - 已经拿到响应头 → 是「streamable-http 的 SSE 一直挂着」，body 被截断不算失败；
 *   - 一个响应头都没等到 → `connected:true, timedOut:true`（有人 LISTEN 但不讲 HTTP）→ 调用方判 probe-failed。
 */
function httpGetProbe(port, path, host, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    let settled = false
    let req = null
    let res = null
    let timer = null
    let connected = false
    let truncated = false
    let bytes = 0
    const chunks = []

    const bodySoFar = () => (chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined)

    const settle = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try {
        res?.destroy()
      } catch {
        /* ignore */
      }
      try {
        req?.destroy()
      } catch {
        /* ignore */
      }
      resolve({ ...result, elapsedMs: Date.now() - startedAt })
    }

    const withResponse = (extra) => ({
      reachable: true,
      connected: true,
      status: res?.statusCode,
      contentType: res?.headers?.['content-type'],
      headers: normalizeHeaders(res?.headers),
      body: bodySoFar(),
      truncated,
      ...extra,
    })

    timer = setTimeout(() => {
      if (res) settle(withResponse({ timedOut: true }))
      else settle({ reachable: false, connected, timedOut: true, error: 'ETIMEDOUT' })
    }, Math.max(1, timeoutMs))

    try {
      req = http.request(
        {
          host,
          port,
          path,
          method: 'GET',
          agent: false, // 一次性 agent，不留 keep-alive 连接池（否则 vitest 跑完不退出）
          headers: { accept: 'application/json, text/event-stream', 'user-agent': USER_AGENT },
        },
        (response) => {
          res = response
          response.on('data', (chunk) => {
            if (bytes >= PROBE_BODY_LIMIT) {
              truncated = true
              return
            }
            chunks.push(chunk)
            bytes += chunk.length
          })
          response.on('end', () => settle(withResponse({})))
          response.on('aborted', () => settle(withResponse({ error: 'ECONNRESET' })))
          response.on('error', (error) => settle(withResponse({ error: errCode(error) })))
        },
      )
    } catch (error) {
      settle({ reachable: false, connected: false, error: errCode(error) })
      return
    }

    req.on('socket', (socket) => {
      socket.once('connect', () => {
        connected = true
      })
    })
    req.on('error', (error) => settle({ reachable: false, connected, error: errCode(error) }))
    req.end()
  })
}

/* ------------------------------------------------------------------ *
 * JSON-RPC over streamable-http
 * ------------------------------------------------------------------ */

/**
 * 一次 JSON-RPC POST。**绝不抛**。
 * `ok` 只表示「传输层成功且（要求应答时）读到了 JSON-RPC 消息」；JSON-RPC 的 `error` 字段留给调用方判。
 */
function postJsonRpc({ url, host, port, path, label, body, sessionId, timeoutMs, expectReply }) {
  const startedAt = Date.now()
  const budget = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
  const payload = JSON.stringify(body)
  const out = {
    ok: false,
    label,
    status: undefined,
    contentType: undefined,
    sessionId: sessionId ?? null,
    headers: {},
    messages: [],
    bodyHead: '',
    truncated: false,
    error: undefined,
    timedOut: false,
    elapsedMs: 0,
  }

  return new Promise((resolve) => {
    let settled = false
    let req = null
    let res = null
    let timer = null
    let text = ''
    let readError

    const finish = () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      // 早停：把流收掉（SSE 会一直挂着不结束，不收就是每次撞超时）。
      try {
        res?.destroy()
      } catch {
        /* ignore */
      }
      try {
        req?.destroy()
      } catch {
        /* ignore */
      }
      out.elapsedMs = Date.now() - startedAt
      out.bodyHead = truncate(text, BODY_HEAD_LIMIT)
      out.messages = extractMessages(text, out.contentType)

      const httpOk = typeof out.status === 'number' && out.status >= 200 && out.status < 300
      out.ok = httpOk
      if (!httpOk) {
        out.error = out.status === undefined ? out.error ?? 'no-response' : `HTTP ${out.status}`
      } else if (expectReply && out.messages.length === 0) {
        out.ok = false
        out.error = text.trim() ? 'body-not-json-rpc' : 'empty-body'
      }
      if (readError && out.ok && out.messages.length === 0) {
        // 读流报错且没读到任何消息：这才是真失败（读到消息的早停/超时不算）。
        out.ok = false
        out.error = readError
      }
      resolve(out)
    }

    const fail = (error, timedOut) => {
      if (settled) return
      out.error = error
      out.timedOut = timedOut === true
      finish()
    }

    timer = setTimeout(() => fail(`timeout after ${budget}ms`, true), budget)

    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'user-agent': USER_AGENT,
      'content-length': Buffer.byteLength(payload),
    }
    if (sessionId) headers['mcp-session-id'] = sessionId

    try {
      req = http.request({ host, port, path, method: 'POST', agent: false, headers }, (response) => {
        res = response
        out.status = response.statusCode
        const normalized = normalizeHeaders(response.headers)
        out.headers = normalized
        out.contentType = normalized['content-type']
        if (normalized['mcp-session-id']) out.sessionId = normalized['mcp-session-id']

        const isSse = String(out.contentType ?? '').toLowerCase().includes('text/event-stream')
        response.setEncoding('utf8') // 跨 chunk 的 UTF-8 由 Node 负责拼，不自己 decode
        response.on('data', (chunk) => {
          text += chunk
          if (text.length > MAX_BODY_CHARS) {
            out.truncated = true
            finish()
            return
          }
          // 通知（expectReply === false）不需要 body：拿到第一批字节就收流（202 空体走 'end'）。
          if (expectReply === false) {
            finish()
            return
          }
          if (isSse && expectReply && hasReply(text, expectReply)) finish()
        })
        response.on('end', () => finish())
        response.on('aborted', () => {
          readError = 'ECONNRESET'
          finish()
        })
        response.on('error', (error) => {
          readError = errCode(error)
          finish()
        })
      })
    } catch (error) {
      fail(errCode(error), false)
      return
    }

    req.on('error', (error) => fail(errCode(error), false))
    req.write(payload)
    req.end()
  })
}

/* ------------------------------------------------------------------ *
 * 冻结接口
 * ------------------------------------------------------------------ */

/**
 * MCP `initialize` + `notifications/initialized`。
 * `ok === true` ⇔ HTTP 2xx **且** 拿到 JSON-RPC 应答 **且** `!reply.error` **且** 响应头带回
 * 非空 `mcp-session-id`（票 05 口径：没有会话 id 就没有「MCP 真的建了会话」这回事）。
 * @returns {Promise<{ok:boolean,status:number|undefined,sessionId:string|null,serverInfo:object|null,evidence:object,detail:string}>}
 */
export async function mcpInitialize({ host = HOROSA_DEFAULT_HOST, port = HOROSA_DEFAULT_PORT, path = HOROSA_MCP_PATH, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const targetHost = probeHostOf(host)
  const numericPort = Number(port)
  const url = buildUrl(targetHost, numericPort, path)
  if (!validPort(numericPort)) {
    return {
      ok: false,
      status: undefined,
      sessionId: null,
      serverInfo: null,
      evidence: { url, port: Number(port), error: `invalid port: ${String(port)}` },
      detail: `端口非法（${String(port)}）：MCP 端点只能在 1..65535 上。`,
    }
  }

  const initId = nextId()
  const init = await postJsonRpc({
    url,
    host: targetHost,
    port: numericPort,
    path,
    label: 'initialize',
    sessionId: null,
    timeoutMs,
    expectReply: { id: initId },
    body: { jsonrpc: '2.0', id: initId, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO } },
  })

  const reply = pickReply(init.messages, initId)
  const evidence = {
    url,
    status: init.status,
    contentType: init.contentType,
    sessionId: init.sessionId,
    sessionIdPresent: Boolean(init.sessionId),
    serverInfo: null,
    protocolVersion: null,
    initialized: false,
    initializedStatus: undefined,
    elapsedMs: init.elapsedMs,
    bodyHead: init.bodyHead,
  }

  if (!init.ok || !reply) {
    evidence.step = 'initialize'
    evidence.error = init.error ?? 'no-jsonrpc-reply'
    return {
      ok: false,
      status: init.status,
      sessionId: init.sessionId,
      serverInfo: null,
      evidence,
      detail: `${url} 的 MCP initialize 失败：${evidence.error}（HTTP ${init.status ?? '-'}${init.contentType ? `，${init.contentType}` : ''}）。`,
    }
  }
  if (reply.error) {
    evidence.step = 'initialize'
    evidence.error = 'jsonrpc-error'
    return {
      ok: false,
      status: init.status,
      sessionId: init.sessionId,
      serverInfo: null,
      evidence,
      detail: `${url} 的 MCP initialize 被拒：${rpcErrorText(reply.error)}。`,
    }
  }

  const result = reply.result && typeof reply.result === 'object' ? reply.result : {}
  // 只留 {name, version}：真机的 serverInfo 还带图标 data-URI 一类的富字段，照抄进 evidence 会把它撑爆。
  const rawInfo = result.serverInfo && typeof result.serverInfo === 'object' ? result.serverInfo : null
  const serverInfo = rawInfo ? { name: rawInfo.name ?? null, version: rawInfo.version ?? null } : null
  evidence.serverInfo = serverInfo
  evidence.protocolVersion = result.protocolVersion ?? null

  if (!init.sessionId) {
    evidence.step = 'initialize'
    evidence.error = 'no-session-id'
    return {
      ok: false,
      status: init.status,
      sessionId: null,
      serverInfo,
      evidence,
      detail:
        `${url} 的 MCP initialize 没有带回响应头 mcp-session-id（HTTP ${init.status ?? '-'}${init.contentType ? `，${init.contentType}` : ''}）`
        + '：按「握手未成立」处理（没有会话 id，后续 tools/list 只是碰运气）。',
    }
  }

  // 通知无 id；真机答 202 + 空 body，这是**正常**的（实测）。失败不单独判死（多造一道门只会造假红）。
  const note = await postJsonRpc({
    url,
    host: targetHost,
    port: numericPort,
    path,
    label: 'notifications/initialized',
    sessionId: init.sessionId,
    timeoutMs,
    expectReply: false,
    body: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
  })
  evidence.initializedStatus = note.status
  evidence.initialized = note.ok === true
  if (!note.ok) evidence.initializedError = note.error ?? `HTTP ${note.status}`

  return {
    ok: true,
    status: init.status,
    sessionId: init.sessionId,
    serverInfo,
    evidence,
    detail: `MCP initialize 成功（serverInfo=${serverInfo ? `${serverInfo.name ?? '?'} ${serverInfo.version ?? '?'}` : '?'}，mcp-session-id=${init.sessionId}）。`,
  }
}

/**
 * `tools/list`：`ok === true` ⇔ 握手成立 **且** 工具名数组非空。
 * @returns {Promise<{ok:boolean,status:number|undefined,sessionId:string|null,tools:string[],serverInfo:object|null,evidence:object,detail:string}>}
 */
export async function mcpToolsList({ host = HOROSA_DEFAULT_HOST, port = HOROSA_DEFAULT_PORT, path = HOROSA_MCP_PATH, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const startedAt = Date.now()
  const targetHost = probeHostOf(host)
  const numericPort = Number(port)
  const url = buildUrl(targetHost, numericPort, path)
  if (!validPort(numericPort)) {
    return {
      ok: false,
      status: undefined,
      sessionId: null,
      tools: [],
      serverInfo: null,
      evidence: { url, port: Number(port), error: `invalid port: ${String(port)}` },
      detail: `端口非法（${String(port)}）：MCP 端点只能在 1..65535 上。`,
    }
  }

  const budget = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
  const handshaked = await mcpInitialize({ host: targetHost, port: numericPort, path, timeoutMs: Math.max(1000, Math.floor(budget * 0.6)) })
  if (!handshaked.ok) {
    return {
      ok: false,
      status: handshaked.status,
      sessionId: handshaked.sessionId,
      tools: [],
      serverInfo: handshaked.serverInfo,
      evidence: handshaked.evidence,
      detail: handshaked.detail,
    }
  }

  const listId = nextId()
  const listed = await postJsonRpc({
    url,
    host: targetHost,
    port: numericPort,
    path,
    label: 'tools/list',
    sessionId: handshaked.sessionId,
    timeoutMs: Math.max(1000, budget - (Date.now() - startedAt)),
    expectReply: { id: listId },
    body: { jsonrpc: '2.0', id: listId, method: 'tools/list', params: {} },
  })

  const reply = pickReply(listed.messages, listId)
  const evidence = { ...handshaked.evidence, status: listed.status, contentType: listed.contentType, elapsedMs: Date.now() - startedAt }

  if (!listed.ok || !reply) {
    evidence.error = listed.error ?? 'no-jsonrpc-reply'
    return { ok: false, status: listed.status, sessionId: handshaked.sessionId, tools: [], serverInfo: handshaked.serverInfo, evidence, detail: `${url} 的 tools/list 失败：${evidence.error}（HTTP ${listed.status ?? '-'}）。` }
  }
  if (reply.error) {
    evidence.error = 'jsonrpc-error'
    return { ok: false, status: listed.status, sessionId: handshaked.sessionId, tools: [], serverInfo: handshaked.serverInfo, evidence, detail: `${url} 的 tools/list 被拒：${rpcErrorText(reply.error)}。` }
  }

  const rawTools = reply.result && typeof reply.result === 'object' && Array.isArray(reply.result.tools) ? reply.result.tools : []
  const tools = rawTools.map((tool) => (tool && typeof tool === 'object' ? tool.name : undefined)).filter((name) => typeof name === 'string' && name.length > 0)
  evidence.toolCount = tools.length
  evidence.toolsHead = tools.slice(0, 8)

  if (tools.length === 0) {
    return {
      ok: false,
      status: listed.status,
      sessionId: handshaked.sessionId,
      tools,
      serverInfo: handshaked.serverInfo,
      evidence,
      detail: `${url} 的 tools/list 返回 0 个工具（不合规：horosa serve 应当回 110 技法 + 10 门面）。`,
    }
  }

  const note = evidence.initialized ? '' : `（注意：notifications/initialized 返回 ${evidence.initializedStatus ?? '-'}，${evidence.initializedError ?? '未确认'}）`
  return {
    ok: true,
    status: listed.status,
    sessionId: handshaked.sessionId,
    tools,
    serverInfo: handshaked.serverInfo,
    evidence,
    detail: `${handshaked.detail} tools/list 返回 ${tools.length} 个工具${note}。`,
  }
}

/** 从 `tools/call` 的 result 里取信封：`content[].text`（JSON 字符串）优先，`structuredContent` 仅兼容。 */
function extractEnvelope(result) {
  if (!result || typeof result !== 'object') return { envelope: null, from: null }

  const content = Array.isArray(result.content) ? result.content : []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    if (part.type !== 'text' || typeof part.text !== 'string') continue
    const parsed = tryJsonParse(part.text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { envelope: parsed, from: 'content.text' }
  }

  const structured = result.structuredContent
  if (structured && typeof structured === 'object' && !Array.isArray(structured)) return { envelope: structured, from: 'structuredContent' }
  if ('ok' in result || 'error' in result) return { envelope: result, from: 'result' }
  return { envelope: null, from: null }
}

/**
 * 调一个 MCP 工具并返回信封。
 * `ok` = 传输成功且拿到信封（`envelope.ok` 是**工具层**结论，两者都要看）。
 * @returns {Promise<{ok:boolean,envelope:object|null,from:string|null,evidence:object,detail:string}>}
 */
export async function mcpCallTool({ name, args, host = HOROSA_DEFAULT_HOST, port = HOROSA_DEFAULT_PORT, path = HOROSA_MCP_PATH, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const startedAt = Date.now()
  const targetHost = probeHostOf(host)
  const numericPort = Number(port)
  const url = buildUrl(targetHost, numericPort, path)

  if (typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, envelope: null, from: null, evidence: { url, error: 'missing tool name' }, detail: 'mcpCallTool 需要一个非空的 name（MCP 工具名，如 horosa_cn_bazi_birth）。' }
  }
  if (!validPort(numericPort)) {
    return { ok: false, envelope: null, from: null, evidence: { url, port: Number(port), error: `invalid port: ${String(port)}` }, detail: `端口非法（${String(port)}）：MCP 端点只能在 1..65535 上。` }
  }

  const budget = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
  const handshaked = await mcpInitialize({ host: targetHost, port: numericPort, path, timeoutMs: Math.max(1000, Math.floor(budget * 0.6)) })
  if (!handshaked.ok) {
    return { ok: false, envelope: null, from: null, evidence: handshaked.evidence, detail: handshaked.detail }
  }

  const callId = nextId()
  const called = await postJsonRpc({
    url,
    host: targetHost,
    port: numericPort,
    path,
    label: `tools/call ${name}`,
    sessionId: handshaked.sessionId,
    timeoutMs: Math.max(1000, budget - (Date.now() - startedAt)),
    expectReply: { id: callId },
    body: { jsonrpc: '2.0', id: callId, method: 'tools/call', params: { name, arguments: args && typeof args === 'object' ? args : {} } },
  })

  const reply = pickReply(called.messages, callId)
  const evidence = {
    ...handshaked.evidence,
    tool: name,
    status: called.status,
    contentType: called.contentType,
    callBodyHead: called.bodyHead,
    elapsedMs: Date.now() - startedAt,
  }

  if (!called.ok || !reply) {
    evidence.error = called.error ?? 'no-jsonrpc-reply'
    return { ok: false, envelope: null, from: null, evidence, detail: `${url} 的 tools/call ${name} 失败：${evidence.error}（HTTP ${called.status ?? '-'}）。` }
  }
  if (reply.error) {
    evidence.error = 'jsonrpc-error'
    return { ok: false, envelope: null, from: null, evidence, detail: `${url} 的 tools/call ${name} 被拒：${rpcErrorText(reply.error)}。` }
  }

  const result = reply.result && typeof reply.result === 'object' ? reply.result : null
  if (!result) {
    evidence.error = 'empty-result'
    return { ok: false, envelope: null, from: null, evidence, detail: `${url} 的 tools/call ${name} 的 result 不是对象。` }
  }

  const isError = result.isError === true
  const extracted = extractEnvelope(result)
  evidence.isError = isError
  evidence.envelopeFrom = extracted.from
  evidence.envelopeKeys = extracted.envelope ? Object.keys(extracted.envelope).slice(0, 24) : null
  evidence.envelopeOk = extracted.envelope ? extracted.envelope.ok === true : null
  evidence.envelopeTool = extracted.envelope ? extracted.envelope.tool ?? null : null
  evidence.envelopeVersion = extracted.envelope ? extracted.envelope.version ?? null : null

  if (!extracted.envelope) {
    return {
      ok: false,
      envelope: null,
      from: null,
      evidence,
      detail: `${url} 的 tools/call ${name} 没带回信封${isError ? `（result.isError=true，result=${truncate(JSON.stringify(result), 300)}）` : '（content[].text 不是 JSON，也没有 structuredContent）'}。`,
    }
  }

  return {
    ok: true,
    envelope: extracted.envelope,
    from: extracted.from,
    evidence,
    detail: `tools/call ${name} 拿到信封（来自 ${extracted.from}：ok=${extracted.envelope.ok === true}、tool=${extracted.envelope.tool ?? '?'}、version=${extracted.envelope.version ?? '?'}${isError ? '；注意 result.isError=true' : ''}）。`,
  }
}

/* ------------------------------------------------------------------ *
 * 端口四态守卫
 * ------------------------------------------------------------------ */

/** body 是否是「JSON-RPC 形状」；返回命中的字段名（如 `jsonrpc+result`）作为证据。 */
function jsonRpcShape(body, contentType) {
  if (typeof body !== 'string' || body.length === 0) return undefined
  const ct = String(contentType || '').toLowerCase()
  if (!ct.includes('application/json') && !ct.includes('text/event-stream')) return undefined

  const candidates = [body.trim()]
  if (ct.includes('text/event-stream')) {
    for (const line of body.split(/\r?\n/)) {
      const matched = /^data:\s*(.*)$/.exec(line)
      if (matched && matched[1].trim().startsWith('{')) candidates.push(matched[1].trim())
    }
  }

  for (const candidate of candidates) {
    const parsed = tryJsonParse(candidate)
    if (!parsed || typeof parsed !== 'object') continue
    const hit = ['jsonrpc', 'error', 'result'].filter((key) => key in parsed)
    if (hit.length) return hit.join('+')
  }
  return undefined
}

/** 失败态的处置建议（宿主侧口径：先看状态文件与日志，再查占用者；绝不叫用户盲杀进程）。 */
function occupiedHint(port, path) {
  return [
    `# 查占用者（Windows）: netstat -ano | findstr :${port}   然后 taskkill /PID <PID> /F（先确认是你自己的进程）`,
    `# 查占用者（macOS/Linux）: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    `# 或者换端口：改补丁行 config.port 与 profile/cordis.patch.yml 的 URL 端口（两处必须一致）`,
    `# 不占端口的路子: horosa serve --transport stdio`,
    `# 复探（宿主侧）: node -e "import('./packages/xuanshu-host/lib/horosa/guard.mjs').then(m=>m.checkHorosaEndpoint({port:${port},path:'${path}'}).then(r=>console.log(r.verdict,r.detail)))"`,
  ].join('\n')
}

/** 有人 LISTEN 但零 HTTP 响应：**无法判定**（不是被占；慢应答的 horosa 也会这样）。 */
function unresponsiveHint(port, path) {
  return [
    '# 先复探一次（可能只是慢：冷启动/机器忙），第二次仍无响应再处理:',
    `#   node -e "import('./packages/xuanshu-host/lib/horosa/guard.mjs').then(m=>m.checkHorosaEndpoint({port:${port},path:'${path}',timeoutMs:5000}).then(r=>console.log(r.verdict,r.detail)))"`,
    `# 认领 PID（不要盲杀，先看清是谁）: Windows netstat -ano | findstr :${port} / macOS·Linux lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    '# 状态文件里有上一次的 verdict 与 hint：<dataDir>/horosa-status.json；serve 日志：<dataDir>/serve.log',
  ].join('\n')
}

/** 探针自身出错的处置建议。 */
function probeFailedHint(port, path) {
  return [
    `# 探针连回环都失败时，先确认端口号合法、本机回环没被安全软件拦。`,
    `# 快速对照: node -e "import('./packages/xuanshu-host/lib/horosa/guard.mjs').then(m=>m.checkHorosaEndpoint({port:${port},path:'${path}'}).then(r=>console.log(JSON.stringify(r.evidence))))"`,
    '# 完整排障见 docs/runbook/horosa.md。',
  ].join('\n')
}

/** 唯一的返回形状工厂：`ok` 只由 verdict 推导；失败态必有 hint。 */
function verdictResult({ verdict, host, port, url, sessionId = null, evidence = {}, detail, hint }) {
  const ok = verdict === 'free' || verdict === 'horosa-ready'
  const result = { ok, verdict, host, port, url, sessionId, evidence, detail }
  result.hint = ok ? hint ?? null : hint || probeFailedHint(port, HOROSA_MCP_PATH)
  return result
}

/**
 * 端口四态裁决（词表与票 04 逐字一致；P1 会拿同一个现场比两边的 verdict）。
 *
 * `ok` 的定义（fail-closed）：`ok = verdict ∈ {free, horosa-ready}` —— 只有这两态算「这道门放行」。
 * `probe-failed` 时 ok:false，但**不代表被占**（调用方按 unknown 处置，绝不据此 kill 任何进程）。
 *
 * @returns {Promise<{ok:boolean,verdict:'free'|'horosa-ready'|'occupied-foreign'|'probe-failed',host:string,port:number,url:string,sessionId:string|null,evidence:object,detail:string,hint:string|null}>}
 */
export async function checkHorosaEndpoint({ host = HOROSA_DEFAULT_HOST, port = HOROSA_DEFAULT_PORT, path = HOROSA_MCP_PATH, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
  const targetHost = probeHostOf(host)
  const numericPort = Number(port)
  const url = buildUrl(targetHost, numericPort, path)
  const budget = Math.max(1, Number(timeoutMs) || DEFAULT_PROBE_TIMEOUT_MS)

  if (!validPort(numericPort)) {
    return verdictResult({
      verdict: 'probe-failed',
      host: targetHost,
      port: numericPort,
      url,
      evidence: { error: `invalid port: ${String(port)}` },
      detail: `端口号非法（${String(port)}），无法探测。`,
      hint: `# 传 1..65535 的端口，例如 config.port: ${HOROSA_DEFAULT_PORT}`,
    })
  }

  // 总预算 = timeoutMs：TCP 探测与 HTTP 探测共享同一个 deadline（整个 check 不会变成 2×timeoutMs）。
  const deadline = Date.now() + budget
  const remaining = () => Math.max(1, deadline - Date.now())

  let busy = false
  let res = { reachable: false, error: 'unknown error' }
  try {
    busy = await isPortBusy(numericPort, targetHost, remaining())
    res = await httpGetProbe(numericPort, path, targetHost, remaining())
  } catch (error) {
    res = { reachable: false, error: errCode(error) }
  }

  const headers = normalizeHeaders(res.headers)
  const evidence = {}
  if (res.status !== undefined) evidence.status = res.status
  if (res.contentType !== undefined) evidence.contentType = res.contentType
  if (headers['mcp-session-id'] !== undefined) evidence.mcpSessionId = headers['mcp-session-id']
  if (typeof res.body === 'string' && res.body.length > 0) evidence.bodyHead = truncate(res.body, 200)
  if (res.error !== undefined) evidence.error = res.error
  if (busy || res.connected === true) evidence.listening = true

  /* ---------------- 真的拿到了 HTTP 响应：按三条判据裁决 ---------------- */
  if (res.status !== undefined) {
    const sessionId = headers['mcp-session-id']
    const allow = headers.allow || ''
    const shape = jsonRpcShape(res.body, res.contentType)

    if (sessionId !== undefined && sessionId !== '') {
      return verdictResult({
        verdict: 'horosa-ready',
        host: targetHost,
        port: numericPort,
        url,
        sessionId,
        evidence,
        detail: `${url} 上有 horosa MCP 在答（判据：响应头 mcp-session-id=${sessionId}）。`,
      })
    }
    if (res.status === 405 && /\bpost\b/i.test(allow)) {
      return verdictResult({
        verdict: 'horosa-ready',
        host: targetHost,
        port: numericPort,
        url,
        evidence,
        detail: `${url} 上有 horosa MCP 在答（判据：405 + allow: ${allow}，streamable-http 端点对 GET 的典型答复）。`,
      })
    }
    if (shape !== undefined) {
      return verdictResult({
        verdict: 'horosa-ready',
        host: targetHost,
        port: numericPort,
        url,
        evidence,
        detail: `${url} 上有 horosa MCP 在答（判据：${res.contentType} + JSON-RPC body 含 ${shape}）。`,
      })
    }

    return verdictResult({
      verdict: 'occupied-foreign',
      host: targetHost,
      port: numericPort,
      url,
      evidence,
      detail:
        `${url} 被非 horosa 的进程占用：HTTP ${res.status}` +
        `${res.contentType ? ` + content-type ${res.contentType}` : ''}，不符合 MCP 端点三条判据中的任何一条。`,
      hint: occupiedHint(numericPort, path),
    })
  }

  /* ---------------- 没有 HTTP 响应：区分「空着」与「无法判定」 ---------------- */
  const error = String(res.error || '')
  if (error === 'ECONNREFUSED') {
    return verdictResult({
      verdict: 'free',
      host: targetHost,
      port: numericPort,
      url,
      evidence,
      detail: `${targetHost}:${numericPort} 无人 LISTEN（ECONNREFUSED）：正常，宿主会自己起 serve。`,
    })
  }

  if (busy || res.connected === true) {
    return verdictResult({
      verdict: 'probe-failed',
      host: targetHost,
      port: numericPort,
      url,
      evidence,
      detail:
        `${targetHost}:${numericPort} 有人 LISTEN，但在 ${budget}ms 内没有给出任何 HTTP 响应`
        + `（${res.timedOut ? '超时' : `错误 ${error}`}）：**无法判定**是不是 horosa（也可能是慢应答的 horosa）。`
        + '这不等于端口被占，也不等于通过 —— 请复探或人工确认。',
      hint: unresponsiveHint(numericPort, path),
    })
  }

  return verdictResult({
    verdict: 'probe-failed',
    host: targetHost,
    port: numericPort,
    url,
    evidence,
    detail: `探针无法判定 ${targetHost}:${numericPort} 的状态（网络错误：${error || 'unknown'}）。这**不算**端口被占，但也不算通过。`,
    hint: probeFailedHint(numericPort, path),
  })
}
