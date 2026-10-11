/**
 * scripts/isolation/horosa-guard.mjs
 *
 * 票 04「开发期双实例隔离」的两道门 —— 第二道：horosa 8765 单占用守卫。
 *
 * 判据/签名出处：`.scratch/assembly-foundation/notes/isolation-contract.md` §4.3（冻结接口）
 *   裁决出处：同文件 §5.1（Lead 评审定论）—— R4（ok 口径）、R5（超时改判）、R7（header 归一化复用）、
 *             R9（verdictResult 工厂）。
 *   checkHorosaPort({ port = 8765, path = '/mcp', timeoutMs = 1500 })
 *     -> { ok, verdict, port, url, evidence, detail, hint? }
 *
 * 四态状态机（唯一实现，别在别处再判一遍）：
 *   free             —— 127.0.0.1:port 没人 LISTEN（ECONNREFUSED；正常：实例先起，horosa 由票 05/06 托管）
 *   horosa-ready     —— 真的拿到了 HTTP 响应，且形态像 MCP 端点（下面三条判据任一成立）
 *   occupied-foreign —— **真的拿到了 HTTP 响应**，但形态不像 MCP（fail-fast 的唯一判据）
 *   probe-failed     —— 探针无法判定：DNS/EACCES/参数…，或「有人 LISTEN 但预算内零 HTTP 响应」。
 *                       ok:false（§5.1 R4 fail-closed），但**不代表被占** —— 调用方按 §4.5 把它记成
 *                       unknown、**不改退出码**（只有 occupied-foreign 才让 doctor 退 3）。
 *
 * §5.1 R5（行为改变，别改回去）：以前「有人 LISTEN 但 HTTP 零响应」判 occupied-foreign，
 * 但那一格的真值是**无法判定**：慢应答的 horosa（冷启动/机器在忙）会被冤枉成「被别的进程占了」，
 * 制造假红。现在这一格判 probe-failed，detail 写明无法判定，`evidence` 保留 isPortBusy 的事实
 * （`listening: true`，additive 字段）与 `error`，同时给 hint 让人先复探再认领 PID。
 * occupied-foreign 只留给「真的拿到了 HTTP 响应、但形态不像 MCP」——那才是可下结论的占用。
 *
 * 「像 horosa MCP」三条判据（契约 §4.3，证据逐条写进 evidence）：
 *   1. 响应头有 `mcp-session-id`（streamable-http 建会话后必带）；或
 *   2. `content-type` 含 application/json 或 text/event-stream，且 body 是 JSON
 *      且含 `jsonrpc` / `error` / `result` 任一字段（SSE 会先剥 `data:` 行再解析）；或
 *   3. `status === 405` 且响应头 `allow` 含 `POST`（streamable-http 端点对 GET 的典型答复）。
 *   其余**有 status 的**响应（200 + text/html、404、纯文本…）一律 occupied-foreign。
 *
 * ok 的定义（§5.1 R4 裁决 = fail-closed，唯一口径）：
 *   ok = verdict ∈ {free, horosa-ready} —— 只有这两态算「这道门放行」。
 *   probe-failed 时 ok:false：探针坏了/答不出来时必须 fail-closed，否则会静默放行一个状态未知的 8765；
 *   调用方（startup.mjs）另读 verdict 记 unknown，且**不**把 probe-failed 当隔离失败。
 *
 * 有界时间：整个 check（TCP 探测 + HTTP 探测）共享 `timeoutMs` 预算，函数必然在
 * timeoutMs + 少量开销内返回；两级探针各自显式销毁 socket，不留悬挂句柄。
 *
 * 端口可覆盖的事实（写进 hint，方便占用时换端口而不是去杀进程）：
 *   horosa serve 的端口默认取 `HOROSA_SKILL_PORT`，缺省 8765，host 取 `HOROSA_SKILL_HOST`，
 *   缺省 127.0.0.1（见 docs/research/horosa-skill-source.md §66/§67）；
 *   玄枢实例侧对应 `XUANSHU_HOROSA_PORT`（契约 §4.1 ENV.horosaPort），解析优先级见 §5.1 R6。
 *
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

import { pathToFileURL } from 'node:url'
import { DEFAULT_HOROSA_PORT } from './defaults.mjs'
import { isPortBusy, httpGet, normalizeHeaders } from './port-probe.mjs'

/** 只探本机回环：与 horosa serve 的默认绑定一致（非回环绑定无 token 会拒启，本就不该出现）。 */
const HOST = '127.0.0.1'
/**
 * 默认端口只有一处定义（`defaults.mjs` 的 `DEFAULT_HOROSA_PORT`）。
 * 复审（§5.1 R8 精神）：这里原先自己写了一份 `8765` 字面量，理由是"避免模块装载顺序耦合"——
 * 但 `defaults.mjs` 是纯数据模块（不 import 任何东西），ESM 下没有这个问题；两份默认值只会漂移。
 */
const DEFAULT_PORT = DEFAULT_HOROSA_PORT
const DEFAULT_PATH = '/mcp'
const BODY_HEAD_EVIDENCE_LIMIT = 200

/* ------------------------------------------------------------------ *
 * §5.1 R9：唯一的返回形状工厂
 * 六个分支曾经各写一份 { ok, verdict, port, url, evidence, detail, hint }，形状靠人眼保持一致；
 * 抽成工厂后字段只写一次，ok 必由 verdict 推导，hint 的必填性（fail 时必有）也在这里兜住。
 * ------------------------------------------------------------------ */

/** fail 时兜底 hint：调用点万一漏传，也不许产出「fail 却没有 hint」的结果。 */
function fallbackFailHint(port) {
  return [
    `# 复探一格: node scripts/isolation/horosa-guard.mjs --port ${port}`,
    `# 换端口再探: PowerShell $env:HOROSA_SKILL_PORT='${port + 101}'; bash: export HOROSA_SKILL_PORT=${port + 101}`,
  ].join('\n')
}

function verdictResult({ verdict, port, url, evidence = {}, detail, hint }) {
  const ok = verdict === 'free' || verdict === 'horosa-ready' // §5.1 R4：fail-closed，唯一口径
  const result = { ok, verdict, port, url, evidence, detail }
  if (ok) {
    // 通过态没有「怎么办」可言；缺省不带这个键（契约 §4.3 标的是 hint?）。
    if (hint) result.hint = hint
  } else {
    result.hint = hint || fallbackFailHint(port)
  }
  return result
}

/**
 * body 是否是「JSON-RPC 形状」。
 * 返回命中的字段名（如 'jsonrpc+result'）作为证据；不命中返回 undefined。
 */
function jsonRpcShape(body, contentType) {
  if (typeof body !== 'string' || body.length === 0) return undefined
  const ct = String(contentType || '').toLowerCase()
  const isJsonLike = ct.includes('application/json') || ct.includes('text/event-stream')
  if (!isJsonLike) return undefined

  const candidates = [body.trim()]
  if (ct.includes('text/event-stream')) {
    // SSE 的真实载荷在 `data:` 行里；契约说「body 是 JSON」，这里按它的语义把 data 行剥出来。
    for (const line of body.split(/\r?\n/)) {
      const matched = /^data:\s*(.*)$/.exec(line)
      if (matched && matched[1].trim().startsWith('{')) candidates.push(matched[1].trim())
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (!parsed || typeof parsed !== 'object') continue
      const hit = ['jsonrpc', 'error', 'result'].filter((key) => key in parsed)
      if (hit.length) return hit.join('+')
    } catch {
      /* 不是 JSON：试下一个候选 */
    }
  }
  return undefined
}

/** occupied-foreign（已确认拿到 HTTP 响应但不像 MCP）的处置命令。 */
function occupiedHint(port, path) {
  return [
    `# 查占用者（Windows）: netstat -ano | findstr :${port}   然后  taskkill /PID <PID> /F`,
    `# 查占用者（macOS/Linux）: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    `# 或者换 horosa 的端口（horosa serve 认 HOROSA_SKILL_PORT，缺省 ${port}）:`,
    `#   PowerShell: $env:HOROSA_SKILL_PORT='${port + 101}'; bash: export HOROSA_SKILL_PORT=${port + 101}`,
    `# 玄枢实例侧同步换端口: $env:XUANSHU_HOROSA_PORT='${port + 101}'，再重跑 node scripts/isolation/startup.mjs --mode doctor`,
    `# 不占端口的路子: horosa serve --transport stdio`,
    `# 复探一格: node scripts/isolation/horosa-guard.mjs --port ${port} --path ${path}`,
  ].join('\n')
}

/**
 * §5.1 R5：有人 LISTEN 但零 HTTP 响应 —— 无法判定，不是「被占」。
 * hint 与 occupiedHint 不同：先复探（可能只是慢），再认领 PID/换端口，绝不直接叫用户杀进程。
 */
function unresponsiveHint(port, path) {
  return [
    `# 先复探一次（可能只是慢：冷启动/机器忙），第二次仍无响应再处理:`,
    `#   node scripts/isolation/horosa-guard.mjs --port ${port} --path ${path} --timeout 5000`,
    `# 认领这个端口上的 PID（不要盲杀，先看清是谁）:`,
    `#   Windows: netstat -ano | findstr :${port}    macOS/Linux: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    `# 确认是陌生进程后，换端口跑 horosa（horosa serve 认 HOROSA_SKILL_PORT，缺省 ${port}）:`,
    `#   PowerShell: $env:HOROSA_SKILL_PORT='${port + 101}'; bash: export HOROSA_SKILL_PORT=${port + 101}`,
    `# 玄枢实例侧同步: $env:XUANSHU_HOROSA_PORT='${port + 101}'，再重跑 node scripts/isolation/startup.mjs --mode doctor`,
    `# 不占端口的路子: horosa serve --transport stdio`,
  ].join('\n')
}

/** 探针自身出错（DNS/EACCES/参数）时的处置命令。 */
function probeFailedHint(port, path) {
  return [
    `# 探针连 127.0.0.1:${port} 都失败时，先确认是不是被安全软件/防火墙拦了本机回环，或端口号非法。`,
    `# 快速对照: node scripts/isolation/horosa-guard.mjs --port ${port} --path ${path}`,
    `# 换一个已知空闲端口复探（可覆盖端口）: PowerShell $env:HOROSA_SKILL_PORT='${port + 101}'`,
  ].join('\n')
}

/**
 * 8765 单占用守卫：给出四态之一 + 证据 + 人读结论 + 处置建议。
 * 绝不抛异常（探针层已折算成返回值，这里再兜一层同步错误）。
 */
export async function checkHorosaPort({ port = DEFAULT_PORT, path = DEFAULT_PATH, timeoutMs = 1500 } = {}) {
  const numericPort = Number(port)
  const url = `http://${HOST}:${numericPort}${path}`
  const budget = Math.max(1, Number(timeoutMs) || 1500)

  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    return verdictResult({
      verdict: 'probe-failed',
      port: numericPort,
      url,
      evidence: { error: `invalid port: ${String(port)}` },
      detail: `端口号非法（${String(port)}），无法探测。`,
      hint: `# 传 1..65535 的端口，例如: node scripts/isolation/horosa-guard.mjs --port 8765`,
    })
  }

  // 总预算 = timeoutMs：TCP 探测与 HTTP 探测共享同一个 deadline，
  // 保证整个 check 不会变成 2×timeoutMs（宁可在预算内给出「无法判定」，也不超时悬挂）。
  const deadline = Date.now() + budget
  const remaining = () => Math.max(1, deadline - Date.now())

  let busy = false
  let res = { reachable: false, error: 'unknown error' }
  try {
    busy = await isPortBusy(numericPort, HOST, remaining())
    res = await httpGet(numericPort, path, { host: HOST, timeoutMs: remaining() })
  } catch (err) {
    res = { reachable: false, error: err && err.message ? err.message : String(err) }
  }

  const headers = normalizeHeaders(res.headers) // §5.1 R7：复用 port-probe 的唯一一份归一化
  const evidence = {}
  if (res.status !== undefined) evidence.status = res.status
  if (res.contentType !== undefined) evidence.contentType = res.contentType
  if (headers['mcp-session-id'] !== undefined) evidence.mcpSessionId = headers['mcp-session-id']
  if (typeof res.body === 'string' && res.body.length > 0) {
    evidence.bodyHead = res.body.slice(0, BODY_HEAD_EVIDENCE_LIMIT)
  }
  if (res.error !== undefined) evidence.error = res.error
  // §5.1 R5：把 isPortBusy 的事实也写进证据，让「无法判定」这一格自带「它知道什么、不知道什么」。
  if (busy || res.connected === true) evidence.listening = true

  /* ---------------- 真的拿到了 HTTP 响应：按三条判据裁决 ---------------- */
  if (res.status !== undefined) {
    const sessionId = headers['mcp-session-id']
    const allow = headers.allow || ''
    const shape = jsonRpcShape(res.body, res.contentType)

    if (sessionId !== undefined && sessionId !== '') {
      return verdictResult({
        verdict: 'horosa-ready',
        port: numericPort,
        url,
        evidence,
        detail: `${url} 上有 horosa MCP 在答（判据：响应头 mcp-session-id=${sessionId}）。`,
      })
    }
    if (res.status === 405 && /\bpost\b/i.test(allow)) {
      return verdictResult({
        verdict: 'horosa-ready',
        port: numericPort,
        url,
        evidence,
        detail: `${url} 上有 horosa MCP 在答（判据：405 + allow: ${allow}，streamable-http 端点对 GET 的典型答复）。`,
      })
    }
    if (shape !== undefined) {
      return verdictResult({
        verdict: 'horosa-ready',
        port: numericPort,
        url,
        evidence,
        detail: `${url} 上有 horosa MCP 在答（判据：${res.contentType} + JSON-RPC body 含 ${shape}）。`,
      })
    }

    // 拿到响应了，且三条判据都不成立 —— 这才是可以下结论的「被别的进程占了」。
    return verdictResult({
      verdict: 'occupied-foreign',
      port: numericPort,
      url,
      evidence,
      detail:
        `${url} 被非 horosa 的进程占用：HTTP ${res.status}` +
        `${res.contentType ? ` + content-type ${res.contentType}` : ''}，` +
        `不符合 MCP 端点三条判据中的任何一条。启动前必须腾出 ${numericPort}，或换端口。`,
      hint: occupiedHint(numericPort, path),
    })
  }

  /* ---------------- 没有 HTTP 响应：区分「空着」与「无法判定」 ---------------- */
  const error = String(res.error || '')
  if (error === 'ECONNREFUSED') {
    // 端口空着：TCP 握手被 RST，这是唯一能确定「没人 LISTEN」的证据。
    return verdictResult({
      verdict: 'free',
      port: numericPort,
      url,
      evidence,
      detail: `${HOST}:${numericPort} 无人 LISTEN（ECONNREFUSED）：正常，实例先起，horosa 由票 05/06 托管。`,
    })
  }

  if (busy || res.connected === true) {
    // §5.1 R5：TCP 连上了（或 isPortBusy 说有人在听）但一个响应头都没等到。
    // 真值是「无法判定」：可能是慢应答的 horosa，也可能是只 accept 不应答的陌生进程。
    // 判 occupied-foreign 会在慢 horosa 上制造假红，所以判 probe-failed（ok:false，但不是隔离失败）。
    return verdictResult({
      verdict: 'probe-failed',
      port: numericPort,
      url,
      evidence,
      detail:
        `${HOST}:${numericPort} 有人 LISTEN，但在 ${budget}ms 内没有给出任何 HTTP 响应` +
        `（GET ${path} ${res.timedOut ? '超时' : `错误 ${error}`}）：**无法判定**是不是 horosa` +
        `（也可能是慢应答的 horosa：冷启动/机器忙）。这不等于端口被占，也不等于通过 —— 请复探或人工确认。`,
      hint: unresponsiveHint(numericPort, path),
    })
  }

  return verdictResult({
    verdict: 'probe-failed',
    port: numericPort,
    url,
    evidence,
    detail:
      `探针无法判定 ${HOST}:${numericPort} 的状态（网络错误：${error || 'unknown'}）。` +
      `这**不算**端口被占，但也不算通过 —— 请人工确认后再启动。`,
    hint: probeFailedHint(numericPort, path),
  })
}

/* ------------------------------------------------------------------ *
 * CLI（便利入口，不属于冻结 API）：node scripts/isolation/horosa-guard.mjs [--port N] [--path P] [--timeout MS]
 * 退出码沿用契约 §4.1 的 EXIT 与 §4.5/R4/R5 的语义：只有 occupied-foreign 算隔离失败 → 3；
 * free / horosa-ready / probe-failed 都退 0（probe-failed 是 unknown，不改退出码；此时 ok:false
 * 只表示「这道门没放行」，按 JSON 里的 verdict/detail 处置）。
 * ------------------------------------------------------------------ */
function runCli(argv) {
  const opts = { port: DEFAULT_PORT, path: DEFAULT_PATH, timeoutMs: 1500 }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--port') opts.port = Number(argv[++i])
    else if (arg === '--path') opts.path = String(argv[++i])
    else if (arg === '--timeout') opts.timeoutMs = Number(argv[++i])
    else {
      console.error(`horosa-guard: 未知参数 ${arg}`)
      console.error('用法: node scripts/isolation/horosa-guard.mjs [--port 8765] [--path /mcp] [--timeout 1500]')
      process.exitCode = 1
      return
    }
  }
  checkHorosaPort(opts).then((result) => {
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.verdict === 'occupied-foreign' ? 3 : 0
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2))
}
