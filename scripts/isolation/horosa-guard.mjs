/**
 * scripts/isolation/horosa-guard.mjs
 *
 * 票 04「开发期双实例隔离」的两道门 —— 第二道：horosa 8765 单占用守卫。
 *
 * 判据/签名出处：`.scratch/assembly-foundation/notes/isolation-contract.md` §4.3（冻结接口）
 *   checkHorosaPort({ port = 8765, path = '/mcp', timeoutMs = 1500 })
 *     -> { ok, verdict, port, url, evidence, detail, hint? }
 *
 * 四态状态机（唯一实现，别在别处再判一遍）：
 *   free             —— 127.0.0.1:port 没人 LISTEN（正常：实例先起，horosa 由票 05/06 托管）
 *   horosa-ready     —— 有人在答，且响应形态像 MCP 端点（下面三条判据任一成立）
 *   occupied-foreign —— 有人 LISTEN 但不是 horosa（fail-fast 的唯一判据）
 *   probe-failed     —— 探针自身无法判定（DNS/超时/EACCES…），**不是**「被占」，但也不算通过
 *
 * 「像 horosa MCP」三条判据（契约 §4.3，证据逐条写进 evidence）：
 *   1. 响应头有 `mcp-session-id`（streamable-http 建会话后必带）；或
 *   2. `content-type` 含 application/json 或 text/event-stream，且 body 是 JSON
 *      且含 `jsonrpc` / `error` / `result` 任一字段（SSE 会先剥 `data:` 行再解析）；或
 *   3. `status === 405` 且响应头 `allow` 含 `POST`（streamable-http 端点对 GET 的典型答复）。
 *   其余有 status 的响应（200 + text/html、404、纯文本…）一律 occupied-foreign。
 *
 * ok 的定义（有意与 §4.3 注释里的写法不同，见交付汇报「未决问题」）：
 *   ok = verdict ∈ {free, horosa-ready} —— 只有这两态算「这道门放行」。
 *   probe-failed 时 ok:false：探针坏了必须 fail-closed，否则一个坏探针会静默放行一个被占的 8765。
 *
 * 有界时间：整个 check（TCP 探测 + HTTP 探测）共享 `timeoutMs` 预算，函数必然在
 * timeoutMs + 少量开销内返回；两级探针各自显式销毁 socket，不留悬挂句柄。
 *
 * 端口可覆盖的事实（写进 hint，方便占用时换端口而不是去杀进程）：
 *   horosa serve 的端口默认取 `HOROSA_SKILL_PORT`，缺省 8765，host 取 `HOROSA_SKILL_HOST`，
 *   缺省 127.0.0.1（见 docs/research/horosa-skill-source.md §66/§67）；
 *   玄枢实例侧对应 `XUANSHU_HOROSA_PORT`（契约 §4.1 ENV.horosaPort）。
 *
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

import { pathToFileURL } from 'node:url'
import { isPortBusy, httpGet } from './port-probe.mjs'

/** 只探本机回环：与 horosa serve 的默认绑定一致（非回环绑定无 token 会拒启，本就不该出现）。 */
const HOST = '127.0.0.1'
/** 与 defaults.mjs 的 DEFAULT_HOROSA_PORT 对齐；此处写字面量以避免模块装载顺序耦合。 */
const DEFAULT_PORT = 8765
const DEFAULT_PATH = '/mcp'
const BODY_HEAD_EVIDENCE_LIMIT = 200

/** 键统一小写：Node 本来就小写，但探测结果可能被中间层改写。 */
function lowerHeaders(headers) {
  const out = {}
  if (!headers || typeof headers !== 'object') return out
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue
    out[String(key).toLowerCase()] = String(value)
  }
  return out
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

/** 占用时的排查/换端口命令（Windows 优先，因为本仓开发机是 Windows）。 */
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

  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    return {
      ok: false,
      verdict: 'probe-failed',
      port: numericPort,
      url,
      evidence: { error: `invalid port: ${String(port)}` },
      detail: `端口号非法（${String(port)}），无法探测。`,
      hint: `# 传 1..65535 的端口，例如: node scripts/isolation/horosa-guard.mjs --port 8765`,
    }
  }

  // 总预算 = timeoutMs：TCP 探测与 HTTP 探测共享同一个 deadline，
  // 保证整个 check 不会变成 2×timeoutMs（宁可在预算内给出「无法判定」，也不超时悬挂）。
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 1500)
  const remaining = () => Math.max(1, deadline - Date.now())

  let busy = false
  let res = { reachable: false, error: 'unknown error' }
  try {
    busy = await isPortBusy(numericPort, HOST, remaining())
    res = await httpGet(numericPort, path, { host: HOST, timeoutMs: remaining() })
  } catch (err) {
    res = { reachable: false, error: err && err.message ? err.message : String(err) }
  }

  const headers = lowerHeaders(res.headers)
  const evidence = {}
  if (res.status !== undefined) evidence.status = res.status
  if (res.contentType !== undefined) evidence.contentType = res.contentType
  if (headers['mcp-session-id'] !== undefined) evidence.mcpSessionId = headers['mcp-session-id']
  if (typeof res.body === 'string' && res.body.length > 0) {
    evidence.bodyHead = res.body.slice(0, BODY_HEAD_EVIDENCE_LIMIT)
  }
  if (res.error !== undefined) evidence.error = res.error

  /* ---------------- 有 HTTP 响应：按三条判据裁决 ---------------- */
  if (res.status !== undefined) {
    const sessionId = headers['mcp-session-id']
    const allow = headers.allow || ''
    const shape = jsonRpcShape(res.body, res.contentType)

    if (sessionId !== undefined && sessionId !== '') {
      return {
        ok: true,
        verdict: 'horosa-ready',
        port: numericPort,
        url,
        evidence,
        detail: `${url} 上有 horosa MCP 在答（判据：响应头 mcp-session-id=${sessionId}）。`,
      }
    }
    if (res.status === 405 && /\bpost\b/i.test(allow)) {
      return {
        ok: true,
        verdict: 'horosa-ready',
        port: numericPort,
        url,
        evidence,
        detail: `${url} 上有 horosa MCP 在答（判据：405 + allow: ${allow}，streamable-http 端点对 GET 的典型答复）。`,
      }
    }
    if (shape !== undefined) {
      return {
        ok: true,
        verdict: 'horosa-ready',
        port: numericPort,
        url,
        evidence,
        detail: `${url} 上有 horosa MCP 在答（判据：${res.contentType} + JSON-RPC body 含 ${shape}）。`,
      }
    }

    return {
      ok: false,
      verdict: 'occupied-foreign',
      port: numericPort,
      url,
      evidence,
      detail:
        `${url} 被非 horosa 的进程占用：HTTP ${res.status}` +
        `${res.contentType ? ` + content-type ${res.contentType}` : ''}，` +
        `不符合 MCP 端点三条判据中的任何一条。启动前必须腾出 ${numericPort}，或换端口。`,
      hint: occupiedHint(numericPort, path),
    }
  }

  /* ---------------- 无 HTTP 响应：区分「空着」「裸 TCP 被占」「探针坏了」 ---------------- */
  const error = String(res.error || '')
  const refused = error === 'ECONNREFUSED'
  if (refused) {
    return {
      ok: true,
      verdict: 'free',
      port: numericPort,
      url,
      evidence,
      detail: `${HOST}:${numericPort} 无人 LISTEN（ECONNREFUSED）：正常，实例先起，horosa 由票 05/06 托管。`,
    }
  }

  if (busy || res.connected === true) {
    // 典型场景：纯 TCP 服务只 accept 不应答，或 HTTP 服务挂死不回响应头。
    return {
      ok: false,
      verdict: 'occupied-foreign',
      port: numericPort,
      url,
      evidence,
      detail:
        `${HOST}:${numericPort} 上有人 LISTEN，但在预算内没有给出任何 HTTP 响应` +
        `（${res.timedOut ? `GET ${path} 超时` : `错误 ${error}`}）：` +
        `只 accept 不应答的裸 TCP 服务，或已挂死的 HTTP 服务。不是 horosa MCP，也不是空闲端口。`,
      hint: occupiedHint(numericPort, path),
    }
  }

  return {
    ok: false,
    verdict: 'probe-failed',
    port: numericPort,
    url,
    evidence,
    detail:
      `探针无法判定 ${HOST}:${numericPort} 的状态（网络错误：${error || 'unknown'}）。` +
      `这**不算**端口被占，但也不算通过 —— 请人工确认后再启动。`,
    hint: probeFailedHint(numericPort, path),
  }
}

/* ------------------------------------------------------------------ *
 * CLI（便利入口，不属于冻结 API）：node scripts/isolation/horosa-guard.mjs [--port N] [--path P] [--timeout MS]
 * 退出码沿用契约 §4.1 的 EXIT：0 通过 / 1 用法错 / 3 隔离失败。
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
    process.exitCode = result.ok ? 0 : 3
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2))
}
