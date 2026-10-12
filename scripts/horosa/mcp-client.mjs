/**
 * scripts/horosa/mcp-client.mjs
 *
 * 票 05「一条命令装好玄枢」自检 C2/C3 的 MCP 客户端（队友 B）。
 *
 * 冻interface（契约 `.scratch/assembly-foundation/notes/setup-contract.md` §9，**名字/签名/返回形状不许改**）：
 *   mcpToolsList({ host = '127.0.0.1', port = 8765, path = '/mcp', timeoutMs = 20000 })
 *     -> { ok, status, tools: string[], serverInfo: {name,version}|null, evidence, detail }
 *   mcpCallTool({ name, args, host, port, path, timeoutMs })
 *     -> { ok, envelope: object|null, evidence, detail }
 *
 * 传输：**streamable-http**（只用 Node 内置 fetch，不引第三方）——
 *   POST http://<host>:<port>/mcp，`content-type: application/json`、
 *   `accept: application/json, text/event-stream`；
 *   顺序 = initialize → notifications/initialized → tools/list | tools/call；
 *   initialize 的响应头 `mcp-session-id` 必须在后续请求里原样回带。
 *
 * 真实响应形状（Lead 2026-10-12 真机实测，捕获 `.scratch/assembly-foundation/captures/setup-mcp-probe.json`，
 * 全文 `.scratch/assembly-foundation/captures/setup-e2e-groundtruth.md` §4）——本文件按它写，不按规范猜：
 *   1. `initialize` → 200 + `content-type: text/event-stream` + 响应头 `mcp-session-id`（32 hex），
 *      **载荷在 SSE 的 `data:` 行里**，`result.serverInfo.version === "0.40.1"`；
 *   2. `notifications/initialized`（通知，无 id）→ **202 + 空 body**（`content-type: application/json`）
 *      —— 空体是**正常**的，不能当错误；
 *   3. `tools/list` → 200，`result.tools.length === 120`（110 技法 + 10 门面）；
 *   4. `tools/call` → `result = { content:[{type:'text', text:"<JSON.stringify 过的信封>"}], isError:false }`
 *      —— **信封不在 `structuredContent` 里**，必须 `JSON.parse(content[0].text)`。
 *   两种形态（JSON 体 / SSE `data:` 行）都解析，且 SSE 拿到应答即早停流（streamable-http 的会话流
 *   可能一直挂着不结束 —— 等它关流 = 每次都撞超时，那会造出「真连能过、探针超时」的假红）。
 *
 * `ok` 的语义（**传输层**，唯一的定义处）：
 *   `mcpToolsList().ok === true` ⇔ MCP 握手成功 + `tools/list` 回了非空的工具名数组；
 *   `mcpCallTool().ok === true`  ⇔ 传输成功且**拿到了信封**（`envelope.ok` 是**工具层**结论，另看
 *   `envelope.ok` / `evidence.envelopeOk`，C3 的判据在 `probe.mjs::checkBaziTool`，不在这一层）。
 *   两者都**不抛**：一切失败折算成 `{ ok:false, ... , detail }`（§9 末条）。
 *
 * 本模块**不往 stdout 打印**（`XUANSHU_HOROSA_DEBUG=1` 时才往 stderr 写调试行）。
 */

import { DEFAULT_HOROSA_PORT, HOROSA_MCP_PATH } from '../isolation/defaults.mjs'
import { debug, errorMessage, headersToObject, truncate, tryJsonParse } from './shared.mjs'

/** 只连本机回环：horosa serve 默认就绑 127.0.0.1（契约 §0）。 */
const DEFAULT_HOST = '127.0.0.1'
/** 契约 §9 的签名默认值；端口定值只有 `scripts/isolation/defaults.mjs` 一处。 */
const DEFAULT_TIMEOUT_MS = 20_000
/** MCP 规范版本：与真机握手成功的那一次一致（Lead 实测用的就是它）。 */
const PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'xuanshu-setup', version: '0.1.0' }
const USER_AGENT = 'xuanshu-horosa-probe/1'
/** body 证据只留头部（契约 §7：证据 ≤2KB/项）。 */
const BODY_HEAD_LIMIT = 400
/** 单次响应体读入上限：tools/list ≈ 500KB、八字信封 ≈ 200KB；8MB 是「绝不 OOM、又不误伤」的量级。 */
const MAX_BODY_CHARS = 8 * 1024 * 1024

let rpcCounter = 0
function nextId() {
  rpcCounter += 1
  return rpcCounter
}

function buildUrl(host, port, path) {
  const suffix = typeof path === 'string' && path.length > 0 ? path : HOROSA_MCP_PATH
  return `http://${host}:${port}${suffix.startsWith('/') ? suffix : `/${suffix}`}`
}

function invalidPort(port, url) {
  return {
    ok: false,
    status: undefined,
    tools: [],
    serverInfo: null,
    evidence: { url, port: Number(port), error: `invalid port: ${String(port)}` },
    detail: `端口非法（${String(port)}）：MCP 端点只能在 1..65535 上。`,
  }
}

/* ------------------------------------------------------------------ *
 * 响应体 → JSON-RPC 消息
 * ------------------------------------------------------------------ */

/** SSE 体里所有 `data:` 行的载荷（规范允许 `data:` 后直接跟内容，所以空格可有可无）。 */
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
 * 从响应体文本里抽 JSON-RPC 消息。
 * SSE 声明的体只读 `data:` 行；但真有实现会把 JSON 直接放体里（或反之），所以两种都试，
 * 多试一个候选不会让判定变松 —— 只有真能 `JSON.parse` 成对象的才算消息。
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

/** 从消息数组里挑出这次请求的应答：先按 id 精确匹配，再退一步取第一条带 result/error 的。 */
function pickReply(messages, id) {
  const list = Array.isArray(messages) ? messages : []
  const byId = list.find((message) => message && message.id === id)
  if (byId) return byId
  return list.find((message) => message && ('result' in message || 'error' in message)) ?? null
}

/** JSON-RPC error → 一行可读文本。 */
function rpcErrorText(error) {
  if (!error || typeof error !== 'object') return 'unknown error'
  const code = error.code === undefined ? '?' : String(error.code)
  return `JSON-RPC error ${code}: ${truncate(error.message ?? '', 300)}`
}

/**
 * 读响应体：JSON 一次性读完；SSE 边读边找应答，找到就早停并 cancel 掉流。
 * 超时（AbortController 触发）与连接中断都折算成「已读到的部分」，不抛。
 */
async function readBody(res, expectReply) {
  const contentType = String(res.headers.get('content-type') ?? '').toLowerCase()
  const isSse = contentType.includes('text/event-stream')
  if (!res.body || typeof res.body.getReader !== 'function') {
    // 老运行时 / 空体：退回一次性读取。
    try {
      return { text: await res.text(), truncated: false }
    } catch (error) {
      return { text: '', truncated: false, error: errorMessage(error) }
    }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let text = ''
  let truncated = false
  let readError
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (text.length > MAX_BODY_CHARS) {
        truncated = true
        break
      }
      if (isSse && expectReply && hasReply(text, expectReply)) break
    }
  } catch (error) {
    // 读流中途超时/被服务端掐断：已读到的字节仍然可用（SSE 往往已经拿到完整应答）。
    readError = errorMessage(error)
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* 流已结束/已取消：无所谓 */
    }
  }
  text += decoder.decode()
  return { text, truncated, error: readError }
}

/**
 * 一次 JSON-RPC POST。**绝不抛**。
 * 返回 `{ ok, status, contentType, sessionId, headers, messages, bodyHead, error, timedOut, elapsedMs }`，
 * 其中 `ok` 只表示「传输层成功且（要求应答时）读到了 JSON-RPC 消息」——JSON-RPC 的 `error` 字段
 * 留给调用方判（这里不替它下结论）。
 */
async function postJsonRpc({ url, label, body, sessionId, token, timeoutMs, expectReply }) {
  const startedAt = Date.now()
  const budget = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), budget)

  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'user-agent': USER_AGENT,
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  if (token) headers.authorization = `Bearer ${token}`

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

  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
    out.status = res.status
    out.headers = headersToObject(res.headers)
    out.contentType = out.headers['content-type']
    if (out.headers['mcp-session-id']) out.sessionId = out.headers['mcp-session-id']

    const read = await readBody(res, expectReply)
    out.bodyHead = truncate(read.text, BODY_HEAD_LIMIT)
    out.truncated = read.truncated === true

    out.messages = extractMessages(read.text, out.contentType)
    const httpOk = res.status >= 200 && res.status < 300
    out.ok = httpOk
    if (!httpOk) {
      out.error = `HTTP ${res.status}`
    } else if (expectReply && out.messages.length === 0) {
      out.ok = false
      out.error = read.text.trim() ? 'body-not-json-rpc' : 'empty-body'
    }
    if (read.error && out.ok && out.messages.length === 0) {
      // 读流报错且没读到任何消息：这才是真失败（读到消息的早停/超时不算）。
      out.ok = false
      out.error = read.error
    }
  } catch (error) {
    const name = error && error.name ? String(error.name) : ''
    out.timedOut = name === 'AbortError' || name === 'TimeoutError'
    out.error = out.timedOut ? `timeout after ${budget}ms` : errorMessage(error)
    out.ok = false
  } finally {
    clearTimeout(timer)
    out.elapsedMs = Date.now() - startedAt
  }

  debug('mcp', `${label} -> status=${out.status ?? '-'} ok=${out.ok} ms=${out.elapsedMs}${out.error ? ` error=${out.error}` : ''}`)
  return out
}

/* ------------------------------------------------------------------ *
 * 握手：initialize → notifications/initialized
 * ------------------------------------------------------------------ */

async function handshake({ url, token, timeoutMs }) {
  const initId = nextId()
  const init = await postJsonRpc({
    url,
    label: 'initialize',
    sessionId: null,
    token,
    timeoutMs,
    expectReply: { id: initId },
    body: {
      jsonrpc: '2.0',
      id: initId,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
    },
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
      sessionId: init.sessionId,
      serverInfo: null,
      protocolVersion: null,
      evidence,
      detail: `${url} 的 MCP initialize 失败：${evidence.error}（HTTP ${init.status ?? '-'}${init.contentType ? `，${init.contentType}` : ''}）。`,
    }
  }
  if (reply.error) {
    evidence.step = 'initialize'
    evidence.error = 'jsonrpc-error'
    return {
      ok: false,
      sessionId: init.sessionId,
      serverInfo: null,
      protocolVersion: null,
      evidence,
      detail: `${url} 的 MCP initialize 被拒：${rpcErrorText(reply.error)}。`,
    }
  }

  const result = reply.result && typeof reply.result === 'object' ? reply.result : {}
  // 只留 {name, version}：契约 §9 的形状就是这两个字段，真机的 serverInfo 还带 icons/websiteUrl
  // （一坨 SVG data-URI），照抄进报告会把 evidence 撑爆（契约 §7：证据 ≤2KB/项）。
  const rawInfo = result.serverInfo && typeof result.serverInfo === 'object' ? result.serverInfo : null
  const serverInfo = rawInfo ? { name: rawInfo.name ?? null, version: rawInfo.version ?? null } : null
  evidence.serverInfo = serverInfo
  evidence.protocolVersion = result.protocolVersion ?? null

  // 通知无 id；真机答 202 + 空 body，这是**正常**的（实测）。
  const note = await postJsonRpc({
    url,
    label: 'notifications/initialized',
    sessionId: init.sessionId,
    token,
    timeoutMs,
    expectReply: false,
    body: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
  })
  evidence.initializedStatus = note.status
  // 通知失败**不**单独判死：契约 §5 的 C2 判据是 initialize + tools/list，多造一道门只会造假红。
  // 记进 evidence，最后写进 detail，让人看得见。
  evidence.initialized = note.ok === true
  if (!note.ok) evidence.initializedError = note.error ?? `HTTP ${note.status}`

  return {
    ok: true,
    sessionId: init.sessionId,
    serverInfo,
    protocolVersion: result.protocolVersion ?? null,
    evidence,
    detail: `MCP initialize 成功（serverInfo=${serverInfo ? `${serverInfo.name ?? '?'} ${serverInfo.version ?? '?'}` : '?'}${
      init.sessionId ? `，mcp-session-id=${init.sessionId}` : '，无 mcp-session-id 响应头'
    }）。`,
  }
}

/* ------------------------------------------------------------------ *
 * 冻结接口
 * ------------------------------------------------------------------ */

/**
 * 列出 MCP 工具名（C2 用；C3 的「含 horosa_cn_bazi_birth」再据此判）。
 * @returns {Promise<{ok:boolean,status:number|undefined,tools:string[],serverInfo:object|null,evidence:object,detail:string}>}
 */
export async function mcpToolsList({
  host = DEFAULT_HOST,
  port = DEFAULT_HOROSA_PORT,
  path = HOROSA_MCP_PATH,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  token,
} = {}) {
  const startedAt = Date.now()
  const numericPort = Number(port)
  const url = buildUrl(host, numericPort, path)
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) return invalidPort(port, url)

  const budget = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
  const handshakeBudget = Math.max(1000, Math.floor(budget * 0.6))
  const handshaked = await handshake({ url, token, timeoutMs: handshakeBudget })
  if (!handshaked.ok) {
    return { ok: false, status: handshaked.evidence.status, tools: [], serverInfo: handshaked.serverInfo, evidence: handshaked.evidence, detail: handshaked.detail }
  }

  const listId = nextId()
  const listed = await postJsonRpc({
    url,
    label: 'tools/list',
    sessionId: handshaked.sessionId,
    token,
    timeoutMs: Math.max(1000, budget - (Date.now() - startedAt)),
    expectReply: { id: listId },
    body: { jsonrpc: '2.0', id: listId, method: 'tools/list', params: {} },
  })

  const reply = pickReply(listed.messages, listId)
  const evidence = { ...handshaked.evidence, status: listed.status, contentType: listed.contentType, elapsedMs: Date.now() - startedAt }

  if (!listed.ok || !reply) {
    evidence.error = listed.error ?? 'no-jsonrpc-reply'
    return {
      ok: false,
      status: listed.status,
      tools: [],
      serverInfo: handshaked.serverInfo,
      evidence,
      detail: `${url} 的 tools/list 失败：${evidence.error}（HTTP ${listed.status ?? '-'}）。`,
    }
  }
  if (reply.error) {
    evidence.error = 'jsonrpc-error'
    return {
      ok: false,
      status: listed.status,
      tools: [],
      serverInfo: handshaked.serverInfo,
      evidence,
      detail: `${url} 的 tools/list 被拒：${rpcErrorText(reply.error)}。`,
    }
  }

  const rawTools = reply.result && typeof reply.result === 'object' && Array.isArray(reply.result.tools) ? reply.result.tools : []
  const tools = rawTools.map((tool) => (tool && typeof tool === 'object' ? tool.name : undefined)).filter((name) => typeof name === 'string' && name.length > 0)
  evidence.toolCount = tools.length
  evidence.toolsHead = tools.slice(0, 8)

  if (tools.length === 0) {
    return {
      ok: false,
      status: listed.status,
      tools,
      serverInfo: handshaked.serverInfo,
      evidence,
      detail: `${url} 的 tools/list 返回 0 个工具（不合规：horosa serve 应当回 110 技法 + 10 门面）。`,
    }
  }

  const note = handshaked.evidence.initialized ? '' : `（注意：notifications/initialized 返回 ${handshaked.evidence.initializedStatus ?? '-'}，${handshaked.evidence.initializedError ?? '未确认'}）`
  return {
    ok: true,
    status: listed.status,
    tools,
    serverInfo: handshaked.serverInfo,
    evidence,
    detail: `${handshaked.detail} tools/list 返回 ${tools.length} 个工具${note}。`,
  }
}

/**
 * 调一个 MCP 工具，返回信封（C3 用）。
 * `ok` = 传输成功且拿到信封；`envelope.ok` 是工具层结论（两者都要看，C3 的完整判据在 probe.mjs）。
 * @returns {Promise<{ok:boolean,envelope:object|null,evidence:object,detail:string}>}
 */
export async function mcpCallTool({
  name,
  args,
  host = DEFAULT_HOST,
  port = DEFAULT_HOROSA_PORT,
  path = HOROSA_MCP_PATH,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  token,
} = {}) {
  const startedAt = Date.now()
  const numericPort = Number(port)
  const url = buildUrl(host, numericPort, path)

  if (typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, envelope: null, evidence: { url, error: 'missing tool name' }, detail: 'mcpCallTool 需要一个非空的 name（MCP 工具名，如 horosa_cn_bazi_birth）。' }
  }
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    const bad = invalidPort(port, url)
    return { ok: false, envelope: null, evidence: bad.evidence, detail: bad.detail }
  }

  const budget = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
  const handshaked = await handshake({ url, token, timeoutMs: Math.max(1000, Math.floor(budget * 0.6)) })
  if (!handshaked.ok) {
    return { ok: false, envelope: null, evidence: handshaked.evidence, detail: handshaked.detail }
  }

  const callId = nextId()
  const called = await postJsonRpc({
    url,
    label: `tools/call ${name}`,
    sessionId: handshaked.sessionId,
    token,
    timeoutMs: Math.max(1000, budget - (Date.now() - startedAt)),
    expectReply: { id: callId },
    body: {
      jsonrpc: '2.0',
      id: callId,
      method: 'tools/call',
      params: { name, arguments: args && typeof args === 'object' ? args : {} },
    },
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
    return { ok: false, envelope: null, evidence, detail: `${url} 的 tools/call ${name} 失败：${evidence.error}（HTTP ${called.status ?? '-'}）。` }
  }
  if (reply.error) {
    evidence.error = 'jsonrpc-error'
    return { ok: false, envelope: null, evidence, detail: `${url} 的 tools/call ${name} 被拒：${rpcErrorText(reply.error)}。` }
  }

  const result = reply.result && typeof reply.result === 'object' ? reply.result : null
  if (!result) {
    evidence.error = 'empty-result'
    return { ok: false, envelope: null, evidence, detail: `${url} 的 tools/call ${name} 的 result 不是对象。` }
  }

  const isError = result.isError === true
  const extracted = extractEnvelope(result)
  evidence.isError = isError
  evidence.envelopeFrom = extracted.from
  evidence.envelopeKeys = extracted.envelope ? Object.keys(extracted.envelope).slice(0, 24) : null
  evidence.envelopeOk = extracted.envelope ? extracted.envelope.ok === true : null
  evidence.envelopeTool = extracted.envelope && typeof extracted.envelope === 'object' ? (extracted.envelope.tool ?? null) : null
  evidence.envelopeVersion = extracted.envelope && typeof extracted.envelope === 'object' ? (extracted.envelope.version ?? null) : null

  if (!extracted.envelope) {
    return {
      ok: false,
      envelope: null,
      evidence,
      detail: `${url} 的 tools/call ${name} 没带回信封${isError ? `（result.isError=true，result=${truncate(JSON.stringify(result), 300)}）` : '（content[].text 不是 JSON，也没有 structuredContent）'}。`,
    }
  }

  const envelope = extracted.envelope
  return {
    ok: true,
    envelope,
    evidence,
    detail: `tools/call ${name} 拿到信封（来自 ${extracted.from}：ok=${envelope.ok === true}、tool=${envelope.tool ?? '?'}、version=${envelope.version ?? '?'}${isError ? '；注意 result.isError=true' : ''}）。`,
  }
}

/**
 * 从 `tools/call` 的 result 里取信封。
 * 真机形状 = `{ content:[{type:'text', text:"<JSON 字符串>"}], isError }`（实测）；
 * `structuredContent` 与「result 自己就是信封」两种也认（不同 SDK 版本/配置下会出现）。
 */
function extractEnvelope(result) {
  if (!result || typeof result !== 'object') return { envelope: null, from: null }

  const structured = result.structuredContent
  if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
    return { envelope: structured, from: 'structuredContent' }
  }

  const content = Array.isArray(result.content) ? result.content : []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    if (part.type !== 'text' || typeof part.text !== 'string') continue
    const parsed = tryJsonParse(part.text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { envelope: parsed, from: 'content.text' }
  }

  if ('ok' in result || 'error' in result) return { envelope: result, from: 'result' }
  return { envelope: null, from: null }
}
