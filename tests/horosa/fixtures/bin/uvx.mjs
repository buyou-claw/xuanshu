#!/usr/bin/env node
/**
 * tests/horosa/fixtures/bin/uvx.mjs — **假 uvx**（P7/P8 的替身可执行文件）。
 *
 * 由 `XUANSHU_UVX_BIN` 注入。被测实现（`packages/xuanshu-host/lib/horosa/serve.mjs`）会以
 *   `<XUANSHU_UVX_BIN> --from <wheel> horosa-skill serve --host 127.0.0.1 --port <port>`
 * 调它（Windows 上 `.mjs` 由 `process.execPath` 直跑，`uvx.cmd` 走 cmd，见同目录 `uvx.cmd`）。
 *
 * 它只做两件事，都是**断言台要观察的外部事实**：
 *   ① **记账**：每次被调用都往 `$XUANSHU_FAKE_UVX_LOG`（jsonl）追加一行 ——
 *      argv 原样 + 解析出的 wheel/cmd/host/port + 四个契约 env（HOROSA_RUNTIME_ROOT /
 *      HOROSA_SKILL_DATA_DIR / HOROSA_SKILL_HOST / HOROSA_SKILL_PORT）。
 *      P7/P8 用「台账里有几行」断言「该 spawn 时恰好一次、不该 spawn 时零次」——
 *      这是**进程外**证据，不是读实现的内部状态。
 *   ② `serve` 时真起一个 MCP HTTP 服务器并**一直活着**（被 kill 才退出），
 *      形状与真机/独立 fixture 同款（initialize 带 `mcp-session-id`、tools/list 120 条、
 *      tools/call 的信封在 `result.content[0].text`）。
 *
 * 安全护栏（照票 05）：**拒绝绑真实 8765**（那是真 horosa 的端口，断言台绝不许占它）；
 * 非回环 host 也拒绝。端口一律由被测实现从空闲端口传进来。
 *
 * 旋钮：
 *   XUANSHU_FAKE_UVX_LOG    台账路径（必需；缺省不记账 —— 但那时 P7 会因「零次调用」红）
 *   XUANSHU_FAKE_UVX_MODE   '' | exit-immediately | no-session
 *                             exit-immediately = 一启动就退（起不来那种：startHorosaServe 必须 ok:false）
 *                             no-session       = initialize 不回 mcp-session-id（握手不成立）
 *
 * 零网络：只绑 127.0.0.1。零真实 uv：这里没有一行 `uvx` 可执行逻辑。
 */

import { randomBytes } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENVELOPES = join(HERE, '..', 'envelopes')
const LOG = process.env.XUANSHU_FAKE_UVX_LOG
const MODE = process.env.XUANSHU_FAKE_UVX_MODE || ''

function record(extra = {}) {
  if (!LOG) return
  const line = {
    ts: Date.now(),
    pid: process.pid,
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    env: {
      HOROSA_RUNTIME_ROOT: process.env.HOROSA_RUNTIME_ROOT ?? null,
      HOROSA_SKILL_DATA_DIR: process.env.HOROSA_SKILL_DATA_DIR ?? null,
      HOROSA_SKILL_HOST: process.env.HOROSA_SKILL_HOST ?? null,
      HOROSA_SKILL_PORT: process.env.HOROSA_SKILL_PORT ?? null,
    },
    ...extra,
  }
  try {
    appendFileSync(LOG, `${JSON.stringify(line)}\n`)
  } catch (error) {
    process.stderr.write(`fake uvx: 记账失败 ${error.message}\n`)
  }
}

function envelope(name) {
  return JSON.parse(readFileSync(join(ENVELOPES, `${name}.json`), 'utf8'))
}

function callEnvelope(args = {}) {
  const confirmed = args.agent_confirmed_settings === true || args.defaults_accepted === true
  if (!confirmed) return envelope('bazi-gate')
  if (args.timeAlg === 1) return envelope('bazi-ok-clock')
  if (args.timeAlg === 3) return envelope('bazi-ok-meansolar')
  return envelope('bazi-ok-default')
}

function tools() {
  const list = [{ name: 'horosa_cn_bazi_birth', title: '八字命盘', description: '生成八字命盘。', inputSchema: { type: 'object', properties: {}, required: [] } }]
  for (let index = 1; index < 120; index += 1) {
    list.push({ name: `horosa_fixture_tool_${String(index).padStart(3, '0')}`, title: `占位工具 ${index}`, description: '填充到真机的 120 条。', inputSchema: { type: 'object', properties: {} } })
  }
  return list
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--version') || argv.includes('-V')) {
    record({ kind: 'version' })
    process.stdout.write('uv 0.12.10\n')
    return 0
  }

  // `[--from <wheel>] horosa-skill <cmd> [...opts]`
  const skillAt = argv.findIndex((token) => /horosa[-_]skill$/.test(token))
  const before = skillAt === -1 ? argv : argv.slice(0, skillAt)
  const after = skillAt === -1 ? argv : argv.slice(skillAt + 1)
  const fromIndex = before.indexOf('--from')
  const wheel = fromIndex === -1 ? null : before[fromIndex + 1] ?? null
  const cmd = after[0]
  const rest = after.slice(1)
  const opt = (name) => {
    const index = rest.indexOf(name)
    return index === -1 ? undefined : rest[index + 1]
  }

  const parsed = {
    kind: cmd === 'serve' ? 'serve' : `cmd:${cmd ?? '(none)'}`,
    wheel,
    cmd: cmd ?? null,
    host: opt('--host') ?? null,
    port: opt('--port') === undefined ? null : Number(opt('--port')),
  }

  if (MODE === 'exit-immediately') {
    record({ ...parsed, died: true })
    process.stderr.write('fake uvx: 故意立刻退出（XUANSHU_FAKE_UVX_MODE=exit-immediately）\n')
    return 8
  }

  if (cmd !== 'serve') {
    record(parsed)
    process.stdout.write(`${JSON.stringify({ ok: true, fake_uvx: true, command: after })}\n`)
    return 0
  }

  const port = parsed.port
  const host = parsed.host ?? '127.0.0.1'
  if (port === 8765) {
    record({ ...parsed, kind: 'serve-refused' })
    process.stderr.write('fake uvx: 拒绝绑真实 horosa 端口 8765\n')
    return 9
  }
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    record({ ...parsed, kind: 'serve-refused' })
    process.stderr.write(`fake uvx: 拒绝绑非回环 host ${host}\n`)
    return 9
  }

  const VERSION = (() => {
    try {
      return JSON.parse(readFileSync(join(HERE, '..', '..', '..', '..', 'scripts', 'setup', 'horosa-pin.json'), 'utf8')).version
    } catch {
      return '0.0.0'
    }
  })()
  const sessionId = randomBytes(16).toString('hex')
  const sessionHeaders = MODE === 'no-session' ? {} : { 'mcp-session-id': sessionId }

  const server = http.createServer((req, res) => {
    const url = String(req.url ?? '')
    if (!url.startsWith('/mcp')) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found\n')
      return
    }
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
      if (typeof method === 'string' && method.startsWith('notifications/')) {
        res.writeHead(202, { 'content-type': 'application/json', ...sessionHeaders })
        res.end()
        return
      }
      const reply = (result) => {
        const payload = { jsonrpc: '2.0', id: message?.id ?? null, result }
        if (wantsSse) {
          res.writeHead(200, { ...sessionHeaders, 'content-type': 'text/event-stream' })
          res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)
        } else {
          res.writeHead(200, { ...sessionHeaders, 'content-type': 'application/json' })
          res.end(JSON.stringify(payload))
        }
      }
      if (method === 'initialize') {
        reply({ protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'horosa-skill', version: VERSION } })
        return
      }
      if (method === 'tools/list') {
        reply({ tools: tools() })
        return
      }
      if (method === 'tools/call') {
        const args = message.params?.arguments ?? {}
        reply({ content: [{ type: 'text', text: JSON.stringify(callEnvelope(args)) }], isError: false })
        return
      }
      reply({})
    })
  })

  server.on('error', (error) => {
    record({ ...parsed, kind: 'serve-error', error: error.message })
    process.stderr.write(`fake uvx serve: ${error.message}\n`)
    process.exit(1)
  })

  server.listen(port, host, () => {
    record({ ...parsed, kind: 'serve', listening: true, actualPort: server.address().port })
    process.stderr.write(`fake uvx: Horosa Skill MCP 正在 http://${host}:${server.address().port}/mcp 监听（fixture）\n`)
  })

  const shutdown = () => {
    server.closeAllConnections?.()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 300).unref()
  }
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, shutdown)
  setTimeout(shutdown, 180_000).unref()
  return undefined // 一直活着，直到被 kill
}

const code = main()
if (code !== undefined) process.exit(code)
