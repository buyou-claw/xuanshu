/**
 * tests/setup/lib/release-server.mjs — 断言台唯一的「网络」：**本地回环计数 server**。
 *
 * 为什么必须单独一个进程（照抄 tests/isolation/lib/fixture-server.mjs 的教训）：
 *   断言台用 `spawnSync` 跑被测 CLI，而 `spawnSync` **阻塞父进程的事件循环**。要是这个 server 长在
 *   测试进程里，被测 CLI 发起下载的那一瞬间它根本不会被调度 —— 于是每条「零请求」断言都会**假绿**
 *   （0 次请求的成因不是「实现没下载」，而是「server 从未被调度」）。所以：独立进程，父进程想怎么
 *   阻塞都行。
 *
 * 用法：
 *   node tests/setup/lib/release-server.mjs --state <dir> [--routes <routes.json>]
 *   stdout 第一行：{"kind":"release-server","port":12345}\n   然后一直服务到 SIGTERM。
 *
 * routes.json 形状（键 = URL 里的**子串**，最长匹配优先；`default` 兜底）：
 *   {
 *     "horosa_skill-0.40.1-py3-none-any.whl": { "file": "<abs>", "range": true, "breakAfterBytes": 1048576, "breakTimes": 1 },
 *     "default": { "status": 404 }
 *   }
 *
 * 记账（两条都留，互为对照）：
 *   - 内存计数 + `GET /__stats` → {"count":N,"requests":[...]}（父进程在被测 CLI 跑完后读它）；
 *   - 每次请求追加一行 JSON 到 `<state>/requests.jsonl`（server 崩了也留证据）。
 *   `POST /__reset` 清空计数（用于「先制造一次断连、再把计数清零」的场景）。
 *
 * 仅使用 Node 内置模块；只绑 127.0.0.1；默认 `listen(0)` 让 OS 分配端口。
 */

import { createWriteStream, readFileSync } from 'node:fs'
import http from 'node:http'
import { join } from 'node:path'

const HOST = '127.0.0.1'

function parseArgs(argv) {
  const opts = { state: undefined, routes: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--state') opts.state = argv[++i]
    else if (argv[i] === '--routes') opts.routes = argv[++i]
  }
  if (!opts.state) throw new Error('--state is required')
  return opts
}

const { state, routes } = parseArgs(process.argv.slice(2))
const routeTable = routes ? JSON.parse(readFileSync(routes, 'utf8')) : { default: { status: 404 } }
const logStream = createWriteStream(join(state, 'requests.jsonl'), { flags: 'a' })
const responseStream = createWriteStream(join(state, 'responses.jsonl'), { flags: 'a' })

/** 最长子串匹配（`default` 兜底）。 */
function pickRoute(urlPath) {
  let best
  for (const [key, value] of Object.entries(routeTable)) {
    if (key === 'default') continue
    if (urlPath.includes(key) && (best === undefined || key.length > best.key.length)) best = { key, value }
  }
  if (best) return best.value
  return routeTable.default ?? { status: 404 }
}

const requests = []
const responses = []
let counter = 0

/** `Range: bytes=<start>-` 的解析（只支持契约里会用到的那一种形态）。 */
function parseRange(header) {
  if (!header) return undefined
  const match = /^bytes=(\d+)-(\d*)$/.exec(String(header).trim())
  if (!match) return undefined
  const start = Number(match[1])
  const end = match[2] === '' ? undefined : Number(match[2])
  return { start, end }
}

const server = http.createServer((req, res) => {
  const urlPath = String(req.url ?? '')
  const url = new URL(urlPath, `http://${HOST}`)

  // ── 记账端点（不属于被测实现会打的路径；不打进 requests 计数）
  if (url.pathname === '/__stats') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ count: counter, requests, responses }))
    return
  }
  if (url.pathname === '/__reset') {
    counter = 0
    requests.length = 0
    responses.length = 0
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  counter += 1
  const range = parseRange(req.headers.range)
  const record = { n: counter, method: req.method, url: urlPath, range: req.headers.range ?? null, ts: Date.now() }
  requests.push(record)
  logStream.write(`${JSON.stringify(record)}\n`)

  // 响应结果单独记一行（请求行的字段在响应前就写死了；「到底发了多少 / 有没有断」只有响应完才知道）。
  // 断言台失败时要能一眼回答「是 server 没给够，还是实现没读」。
  const outcome = (extra) => {
    const line = { n: record.n, url: urlPath, range: record.range, ...extra, ts: Date.now() }
    responses.push(line)
    responseStream.write(`${JSON.stringify(line)}\n`)
  }

  const route = pickRoute(urlPath)

  if (route.status && !route.file) {
    res.writeHead(route.status, { 'content-type': 'text/plain' })
    res.end(`fixture: ${route.status}\n`)
    outcome({ status: route.status, sent: 0, kind: 'status' })
    return
  }

  let body
  try {
    body = readFileSync(route.file)
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end(`fixture cannot read ${route.file}: ${error.message}\n`)
    outcome({ status: 500, sent: 0, kind: 'read-error' })
    return
  }

  const rangeEnabled = route.range !== false
  const start = rangeEnabled && range ? Math.min(range.start, body.length) : 0
  const end = rangeEnabled && range?.end !== undefined ? Math.min(range.end, body.length - 1) : body.length - 1
  const slice = body.subarray(start, end + 1)
  const partial = start > 0 || end < body.length - 1
  const status = partial && rangeEnabled ? 206 : 200

  const headers = {
    'content-type': 'application/octet-stream',
    'content-length': String(slice.length),
    'accept-ranges': rangeEnabled ? 'bytes' : 'none',
  }
  if (partial && rangeEnabled) {
    headers['content-range'] = `bytes ${start}-${end}/${body.length}`
  }
  res.writeHead(status, headers)

  // 「先给半个文件后断连」：只在前 breakTimes 次命中该路由时发生。
  const breakAfter = Number(route.breakAfterBytes ?? 0)
  const breakTimes = Number(route.breakTimes ?? 0)
  if (breakAfter > 0 && breakTimes > 0) {
    route.breakTimes = breakTimes - 1
    const sent = Math.min(breakAfter, slice.length)
    res.end(slice.subarray(0, sent), () => outcome({ status, sent, kind: 'break' }))
    return
  }

  res.end(slice, () => outcome({ status, sent: slice.length, kind: 'full' }))
})

server.on('error', (error) => {
  process.stderr.write(`release-server: ${error.message}\n`)
  process.exit(1)
})

server.listen(0, HOST, () => {
  process.stdout.write(`${JSON.stringify({ kind: 'release-server', port: server.address().port })}\n`)
})

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    try {
      server.closeAllConnections?.()
    } catch {
      /* 老 node 没有这个方法 */
    }
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500).unref()
  })
}
