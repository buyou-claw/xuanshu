/**
 * tests/isolation/lib/fixture-server.mjs — I4 对照组的**独立进程**实现。
 *
 * 为什么不能像第一版那样在测试进程里 `http.createServer()`：
 *   测试用 `spawnSync` 跑验收台（这是硬要求：抓子进程输出必须 utf8，别用 PowerShell 重定向），
 *   而 `spawnSync` **会阻塞父进程的事件循环**。对照组服务端要是长在父进程里，它在验收台探测的
 *   那一瞬间根本不会被调度 —— 于是所有「有 HTTP 响应」的对照组都会退化成一件事：
 *   TCP 连得上（内核 backlog 就 ACK 了）、HTTP 没响应 → 一律判 occupied-foreign。
 *   那样测试会「看起来通过」，但 horosa-ready 这两态实际上从没被验过（假绿）。
 *
 * 所以：对照组独自一个进程，父进程想怎么阻塞都行。
 *
 * 用法（父进程只读第一行 JSON 拿端口）：
 *   node tests/isolation/lib/fixture-server.mjs --kind <kind> [--port 0]
 *   stdout: {"kind":"...","port":12345}\n   然后一直服务，直到被 SIGTERM。
 *
 * kind 一览（每个都对应契约 §4.3 的一条判据 / 一条反例）：
 *   foreign-html        200 + text/html（典型「别的进程占了 8765」）→ occupied-foreign
 *   json-rpc            200 + application/json + JSON-RPC body      → horosa-ready（判据 2）
 *   mcp-session-id      带 mcp-session-id 响应头                    → horosa-ready（判据 1）
 *   method-not-allowed  405 + allow: POST                           → horosa-ready（判据 3）
 *   not-found-on-mcp    /mcp 是 404，其它路径才有 JSON              → occupied-foreign（路径不对）
 *   bare-tcp            只 accept 不应答（连 HTTP 都不讲）          → occupied-foreign
 *
 * 仅使用 Node 内置模块。绝不绑固定端口（默认 `listen(0)` 让 OS 分配）。
 */

import http from 'node:http'
import net from 'node:net'

const HOST = '127.0.0.1'

const handlers = {
  'foreign-html': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<html><head><title>别的服务</title></head><body>不是 MCP 端点</body></html>')
  },
  'json-rpc': (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }))
  },
  'mcp-session-id': (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session-1' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }))
  },
  'method-not-allowed': (_req, res) => {
    res.writeHead(405, { allow: 'POST', 'content-type': 'text/plain' })
    res.end('Method Not Allowed')
  },
  'not-found-on-mcp': (req, res) => {
    if (String(req.url).startsWith('/mcp')) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('no such endpoint')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', result: {} }))
  },
}

function parseArgs(argv) {
  const opts = { kind: undefined, port: 0 }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--kind') opts.kind = argv[++i]
    else if (argv[i] === '--port') opts.port = Number(argv[++i])
  }
  if (opts.kind === undefined) throw new Error(`--kind is required (one of ${[...Object.keys(handlers), 'bare-tcp'].join('|')})`)
  return opts
}

const { kind, port } = parseArgs(process.argv.slice(2))

const server = kind === 'bare-tcp'
  // 只 accept、永远不应答：连 HTTP 都不讲的那种占端口方式。
  ? net.createServer(() => { /* 故意什么都不做 */ })
  : http.createServer(handlers[kind] ?? (() => { throw new Error(`unknown kind: ${kind}`) }))

server.on('error', (error) => {
  process.stderr.write(`fixture-server: ${error.message}\n`)
  process.exit(1)
})

server.listen(port, HOST, () => {
  process.stdout.write(`${JSON.stringify({ kind, port: server.address().port })}\n`)
})

// 父进程 kill 我们即可；顺手把挂着的连接掐掉，别让父进程的 close 等超时。
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    try {
      server.closeAllConnections?.()
    } catch {
      /* node:net 没有这个方法 */
    }
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500).unref()
  })
}
