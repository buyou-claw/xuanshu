#!/usr/bin/env node
/**
 * tests/horosa/fixtures/bin/fake-mcp-server.mjs — **独立进程**的假 MCP / 假占用者服务器。
 *
 * 为什么必须独立成进程（票 04/05 都踩过）：断言台里跑被测实现时，任何一处 `spawnSync`/同步等待
 * 都会阻塞测试进程的事件循环 —— 长在测试进程里的对照组那一瞬间不会被调度，
 * 于是「有 HTTP 响应」的现场会退化成一件事（TCP 连得上、HTTP 无响应 → 无法判定），
 * `horosa-ready` / `occupied-foreign` 两态**根本没被验过，测试却全绿**。
 * 独立进程还能让「被探的服务」在 P7 的 `stopHorosaServe(别人的 pid)` 用例里被当成「别人的进程」。
 *
 * 用法：
 *   node fake-mcp-server.mjs --mode <mcp|mcp-session-id|json-rpc|foreign-html|not-found|bare-tcp> [--port 0]
 *   stdout 第一行：{"host":"127.0.0.1","port":<真实端口>,"mode":"...","pid":<pid>}
 *   收到 SIGTERM/SIGINT 就退出（断言台用它收尾）。
 *
 * 各模式回放的形状（P1 的四态 / P7 的复用态都对着它们）：
 *   mcp            —— 真 streamable-http 形状：`GET /mcp` → 405 + `allow: POST`；
 *                     `POST /mcp` initialize → 200 + `mcp-session-id`（32 hex）+ JSON-RPC result
 *                     （`serverInfo.version` = pin 版本）；`notifications/*` → 202 空体；
 *                     `tools/list` → **120** 条（含 `horosa_cn_bazi_birth`）；
 *                     `tools/call` → 信封在 `result.content[0].text`（真机同款），
 *                     信封本体**直接读 `fixtures/envelopes/*.json`**（不在这里抄第二份）。
 *   mcp-session-id —— `GET /mcp` → 200 + `content-type: application/json` + `mcp-session-id` 头（判据 1）
 *   json-rpc       —— `GET /mcp` → 200 + application/json + `{"jsonrpc":..,"result":{}}`（判据 2）
 *   foreign-html   —— `GET /mcp` → 200 + text/html（`occupied-foreign`）
 *   not-found      —— `GET /mcp` → 404 + text/plain（**路径不对就不算 horosa**，仍 occupied-foreign）
 *   bare-tcp       —— 只 accept、永不应答（`probe-failed`：无法判定 ≠ 被占）
 *
 * 零网络：只绑 `127.0.0.1`（非回环直接拒绝启动）；端口缺省 0 = 内核分配。
 */

import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENVELOPES = join(HERE, '..', 'envelopes')

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const MODE = arg('--mode', 'mcp')
const PORT = Number(arg('--port', '0'))
const HOST = '127.0.0.1'

if (arg('--host', HOST) !== HOST) {
  process.stderr.write(`fake-mcp-server: 只允许绑回环（收到 ${arg('--host', HOST)}）\n`)
  process.exit(9)
}

/** pin 版本（`serverInfo.version` 的判据来自仓内 pin，不写第二个字面量）。 */
function pinnedVersion() {
  try {
    return JSON.parse(readFileSync(join(HERE, '..', '..', '..', '..', 'scripts', 'setup', 'horosa-pin.json'), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

function envelope(name) {
  return JSON.parse(readFileSync(join(ENVELOPES, `${name}.json`), 'utf8'))
}

/** 120 条工具：1 条八字 + 119 条填充（§5 要求 tools/list 回 120 条）。 */
function tools() {
  const list = [
    {
      name: 'horosa_cn_bazi_birth',
      title: '八字命盘',
      description: '生成八字命盘（四柱 / 大运 / 神煞 / 五行力量 / 格局）。',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          time: { type: 'string' },
          zone: { type: 'string' },
          lat: { type: 'string' },
          lon: { type: 'string' },
          gender: { type: 'string' },
          timeAlg: { type: 'integer' },
          agent_confirmed_settings: { type: 'boolean' },
          clarification_notes: { type: 'string' },
        },
        required: [],
      },
    },
  ]
  for (let index = 1; index < 120; index += 1) {
    list.push({
      name: `horosa_fixture_tool_${String(index).padStart(3, '0')}`,
      title: `占位工具 ${index}`,
      description: 'tools/list 的**条数**判据用的填充项（真机 120 条）。',
      inputSchema: { type: 'object', properties: {} },
    })
  }
  return list
}

/** `tools/call` 的信封选择：与真机 §0.1/§0.2 同判据（闸 → gate；timeAlg → 对应档）。 */
function callEnvelope(args = {}) {
  const confirmed = args.agent_confirmed_settings === true || args.defaults_accepted === true
  if (!confirmed) return envelope('bazi-gate')
  const missing = ['date', 'time', 'zone', 'lat', 'lon'].filter((key) => args[key] === undefined || args[key] === null || args[key] === '')
  if (missing.length > 0) return envelope('bazi-error')
  if (args.timeAlg === 1) return envelope('bazi-ok-clock')
  if (args.timeAlg === 3) return envelope('bazi-ok-meansolar')
  return envelope('bazi-ok-default')
}

function serveHttp() {
  const VERSION = pinnedVersion()
  const sessionId = randomBytes(16).toString('hex')
  const server = http.createServer((req, res) => {
    const url = String(req.url ?? '')
    if (!url.startsWith('/mcp')) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found\n')
      return
    }
    if (MODE === 'mcp-session-id' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': sessionId })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, result: { serverInfo: { name: 'horosa-skill', version: VERSION } } }))
      return
    }
    if (MODE === 'json-rpc' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, result: { ok: true } }))
      return
    }
    if (MODE === 'foreign-html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><head><title>someone else</title></head><body>not an MCP endpoint</body></html>\n')
      return
    }
    if (MODE === 'not-found') {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('no such route\n')
      return
    }
    // 真机：streamable-http 端点对 GET 的典型答复（票 04 守卫的判据 3）。
    if (req.method === 'GET') {
      res.writeHead(405, { allow: 'POST', 'content-type': 'text/plain' })
      res.end('Method Not Allowed\n')
      return
    }

    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      let message
      try {
        message = JSON.parse(body)
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }))
        return
      }
      const wantsSse = String(req.headers.accept ?? '').includes('text/event-stream')
      const method = message?.method
      const headers = { 'mcp-session-id': sessionId }
      if (typeof method === 'string' && method.startsWith('notifications/')) {
        res.writeHead(202, { 'content-type': 'application/json', ...headers })
        res.end()
        return
      }
      const reply = (result) => {
        const payload = { jsonrpc: '2.0', id: message?.id ?? null, result }
        if (wantsSse) {
          res.writeHead(200, { ...headers, 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
          res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)
        } else {
          res.writeHead(200, { ...headers, 'content-type': 'application/json' })
          res.end(JSON.stringify(payload))
        }
      }
      if (method === 'initialize') {
        reply({
          protocolVersion: '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'horosa-skill', version: VERSION },
        })
        return
      }
      if (method === 'tools/list') {
        reply({ tools: tools() })
        return
      }
      if (method === 'tools/call') {
        const name = message.params?.name
        const args = message.params?.arguments ?? {}
        if (name !== 'horosa_cn_bazi_birth') {
          reply({ content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'fixture.unknown_tool', tool: name }) }], isError: false })
          return
        }
        reply({ content: [{ type: 'text', text: JSON.stringify(callEnvelope(args)) }], isError: false })
        return
      }
      if (method === 'ping') {
        reply({})
        return
      }
      res.writeHead(200, { ...headers, 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message?.id ?? null, result: {} }))
    })
  })
  return server
}

function announce(port) {
  const payload = { host: HOST, port, mode: MODE, pid: process.pid, fingerprint: createHash('sha1').update(`${MODE}:${port}`).digest('hex').slice(0, 8) }
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

if (MODE === 'bare-tcp') {
  // 只 accept、永不应答：守卫必须判 `probe-failed`（「有人 LISTEN 但零 HTTP 响应」= 无法判定）。
  const server = net.createServer((socket) => {
    socket.on('error', () => {})
    // 故意不 write、不 end：让对面的 HTTP 预算耗尽。
  })
  server.listen(PORT, HOST, () => announce(server.address().port))
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
} else {
  const server = serveHttp()
  server.on('error', (error) => {
    process.stderr.write(`fake-mcp-server: ${error.message}\n`)
    process.exit(1)
  })
  server.listen(PORT, HOST, () => announce(server.address().port))
  const stop = () => {
    server.closeAllConnections?.()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 300).unref()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  // 兜底：别留孤儿（断言台失败时也不会污染下一轮）。
  setTimeout(stop, 300_000).unref()
}
