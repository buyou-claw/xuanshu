#!/usr/bin/env node
/**
 * tests/setup/fixtures/bin/uvx.mjs — **假 uvx**（断言台的替身可执行文件）。
 *
 * 由 `XUANSHU_UVX_BIN` 注入；被测实现会以
 *   `<XUANSHU_UVX_BIN> --from <wheel绝对路径> horosa-skill <cmd> [...opts]`
 * 调用它（Windows 上 `.mjs` 走 `spawn(process.execPath, [bin, ...args])`，契约 §10 / Lead 冻结的调用约定）。
 *
 * 它回放的是**真实形状**，不是编出来的形状 —— 每个 JSON 都对着 Lead 的真机捕获
 * （`.scratch/assembly-foundation/captures/setup-{doctor-before,doctor-after,runtime-status}.json`
 * 与 `setup-e2e-groundtruth.md`）：
 *
 *   doctor          → 纯 JSON；**装好但服务没起时 `ok` 仍是 `false`**（真机实测！）
 *                     版本门只认 `installed === true && runtime_payload_version === <pin version>`
 *   install         → 纯 JSON（含 runtime_payload_version / derived_from / services）并翻转「已装」状态
 *   runtime status  → 纯 JSON（含 ports / endpoints / summary）
 *   serve           → 真起一个本地 MCP HTTP（streamable-http：initialize 回 `text/event-stream` +
 *                     `mcp-session-id` 头、notifications 回 202 空体、tools/list 含 `horosa_cn_bazi_birth`、
 *                     tools/call 的**信封在 `content[0].text` 里**）—— 与真机 §4 表格逐行同形
 *   --version       → `uv 0.12.10`（preflight 的环境门要它）
 *
 * 零网络、零真实安装、零真实 `~/.dsh`/`C:\horosa`：状态只写在 `$XUANSHU_FAKE_UVX_STATE` 下。
 *
 * 记账：每次调用追加一行 JSON 到 `$XUANSHU_FAKE_UVX_STATE/calls.jsonl`（argv + cwd + 关键 env），
 * 断言台据此判「第二次没有再装」这类事实。
 *
 * 环境变量：
 *   XUANSHU_FAKE_UVX_STATE    状态目录（必需；缺省用 os.tmpdir()/xuanshu-fake-uvx）
 *   XUANSHU_FAKE_UVX_VERSION  回放的版本（缺省 0.40.1）
 *   XUANSHU_FAKE_UVX_MODE     '' | fail-install | wrong-version
 *                                fail-install  = install 返回非 0（第 7 条的 exit 4）
 *                                wrong-version = 装完 doctor 回一个**不等于 pin** 的版本（同版本硬门，exit 4）
 *
 * ⚠️ 版本默认值**从仓内 `scripts/setup/horosa-pin.json` 派生**（可用 `XUANSHU_FAKE_UVX_VERSION` 覆盖）：
 *   C3 断言的「期望版本」由探针直接读仓内 pin 得到（不认 `XUANSHU_SETUP_PIN`），所以 fixture 必须回放
 *   **仓内 pin 的版本**；若跟着测试自己的 pin 写死别的值（比如 9.9.9），C3 会判「version ≠ 期望」而红 ——
 *   那是 fixture 造错了，不是实现错了。升级 pin 时这里不用改。
 */

import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 仓内 pin（本文件在 `<repo>/tests/setup/fixtures/bin/` 下）。 */
function pinnedVersion() {
  try {
    const pin = JSON.parse(readFileSync(resolve(HERE, '..', '..', '..', '..', 'scripts', 'setup', 'horosa-pin.json'), 'utf8'))
    return typeof pin.version === 'string' && pin.version !== '' ? pin.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const STATE = process.env.XUANSHU_FAKE_UVX_STATE || join(tmpdir(), 'xuanshu-fake-uvx')
const VERSION = process.env.XUANSHU_FAKE_UVX_VERSION || pinnedVersion()
const MODE = process.env.XUANSHU_FAKE_UVX_MODE || ''
/** `wrong-version` 模式回放的「错的版本」：只要求 ≠ pin 版本即可。 */
const WRONG_VERSION = VERSION === '0.39.9' ? '0.39.8' : '0.39.9'
mkdirSync(STATE, { recursive: true })

const INSTALLED_FILE = join(STATE, 'installed.json')
const SERVE_FILE = join(STATE, 'serve.json')
const CALLS_FILE = join(STATE, 'calls.jsonl')

// ── 固定四柱（合法 2 字干支；与契约 §5 的固定测试出生数据一致） ─────────────────────────────
const FOUR_COLUMNS = { year: { ganzi: '己巳' }, month: { ganzi: '丁丑' }, day: { ganzi: '甲子' }, hour: { ganzi: '庚午' } }

const FAKE_TOOLS = [
  baziTool(),
  { name: 'horosa_export_registry', description: '列出导出注册表', inputSchema: { type: 'object', properties: {} } },
  { name: 'horosa_export_parse', description: '解析导出文本', inputSchema: { type: 'object', properties: {} } },
  { name: 'horosa_knowledge_registry', description: '知识域注册表', inputSchema: { type: 'object', properties: {} } },
  { name: 'horosa_knowledge_read', description: '读取知识域', inputSchema: { type: 'object', properties: {} } },
  { name: 'horosa_cn_qimen', description: '奇门', inputSchema: { type: 'object', properties: {} } },
  { name: 'horosa_cn_taiyi', description: '太乙', inputSchema: { type: 'object', properties: {} } },
  { name: 'horosa_cn_jinkou', description: '金口诀', inputSchema: { type: 'object', properties: {} } },
  { name: 'horosa_cn_tongshefa', description: '通神法', inputSchema: { type: 'object', properties: {} } },
  { name: 'horosa_cn_liureng', description: '大六壬', inputSchema: { type: 'object', properties: {} } },
  { name: 'horosa_western_chart', description: '西占命盘', inputSchema: { type: 'object', properties: {} } },
  { name: 'horosa_technique_report', description: '技法报告', inputSchema: { type: 'object', properties: {} } },
]

function baziTool() {
  return {
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
        agent_confirmed_settings: { type: 'boolean' },
        clarification_notes: { type: 'string' },
      },
      required: [],
    },
  }
}

function baziEnvelope(args) {
  const missing = ['date', 'time', 'zone', 'lat', 'lon'].filter((key) => args?.[key] === undefined || args?.[key] === null || args?.[key] === '')
  if (missing.length > 0) {
    return { ok: false, tool: 'bazi_birth', version: VERSION, code: 'invalid_payload', message: `fixture: missing ${missing.join(',')}`, data: null }
  }
  if (args.agent_confirmed_settings !== true) {
    // 真机上这是 agent_guidance.required 澄清闸；C3 必须带确认字段才放行。
    return { ok: false, tool: 'bazi_birth', version: VERSION, code: 'agent_guidance.required', message: 'fixture: agent_confirmed_settings must be true', data: null }
  }
  if (args.timeAlg !== undefined) {
    // 契约 §5：C3 的固定调用**不传** timeAlg（缺省 0 = 真太阳时）。传了就是口径漂了。
    return { ok: false, tool: 'bazi_birth', version: VERSION, code: 'fixture.unexpected_timeAlg', message: `fixture: timeAlg must not be sent (got ${JSON.stringify(args.timeAlg)})`, data: null }
  }
  return {
    ok: true,
    tool: 'bazi_birth',
    version: VERSION,
    input_normalized: { date: args.date, time: args.time, zone: args.zone, gpsLat: 31.233333, gpsLon: 121.483333, gender: args.gender ?? '1' },
    data: {
      bazi: { fourColumns: FOUR_COLUMNS, nongli: { year: 1990 }, wuxingStat: {}, gejuYongShen: {}, source: 'fixture' },
      gender: args.gender ?? '1',
      compute_sources: ['fixture'],
      snapshot_text: 'fixture snapshot',
      export_snapshot: { export_text: '', export_format: { sections: [] } },
      technique_card: { technique: 'bazi_birth', version: VERSION },
    },
    summary: ['工具 `bazi_birth` 已返回结构化结果。', 'fixture'],
    warnings: [],
    trace_id: 'fixture-trace',
    group_id: 'fixture-group',
    error: null,
    code: null,
    message: null,
    details: null,
  }
}

function recordCall(extra = {}) {
  const line = {
    ts: Date.now(),
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    runtimeRoot: process.env.HOROSA_RUNTIME_ROOT ?? null,
    dataDir: process.env.HOROSA_SKILL_DATA_DIR ?? null,
    ...extra,
  }
  appendFileSync(CALLS_FILE, `${JSON.stringify(line)}\n`)
}

function readInstalled() {
  try {
    return JSON.parse(readFileSync(INSTALLED_FILE, 'utf8'))
  } catch {
    return undefined
  }
}

function installedVersion() {
  const state = readInstalled()
  if (!state) return null
  return MODE === 'wrong-version' ? WRONG_VERSION : state.version
}

function emitJson(value) {
  process.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`)
}

/** doctor 回放：装好但服务没起时 `ok === false`（真机实测）。 */
function doctorReport() {
  const version = installedVersion()
  const runtimeRoot = process.env.HOROSA_RUNTIME_ROOT ?? null
  if (version === null) {
    return {
      ok: false,
      installed: false,
      status: 'not_installed',
      runtime_root: runtimeRoot,
      runtime_payload_version: null,
      manifest_version: null,
      issues: ['missing:manifest', 'services:not_running'],
      user_summary: 'The Horosa runtime is not installed yet.',
      endpoints: [],
    }
  }
  return {
    ok: false,
    installed: true,
    status: 'needs_attention',
    runtime_root: runtimeRoot,
    runtime_payload_version: version,
    manifest_version: version,
    freshness: { installed_version: version, export_registry_version: { installed: 15, expected: 15, outdated: false } },
    issues: ['services:not_running'],
    user_summary: 'The runtime files are installed, but the local Horosa services are not running yet.',
    endpoints: [
      { label: 'java_backend', url: 'http://127.0.0.1:9999/common/time', reachable: false },
      { label: 'python_chart', url: 'http://127.0.0.1:8899', reachable: false },
    ],
  }
}

function serveState() {
  try {
    const state = JSON.parse(readFileSync(SERVE_FILE, 'utf8'))
    try {
      process.kill(state.pid, 0)
      return state
    } catch {
      return undefined
    }
  } catch {
    return undefined
  }
}

function startServe(argv, rest) {
  const opt = (name) => {
    const index = rest.indexOf(name)
    if (index === -1) return undefined
    return rest[index + 1]
  }
  const port = Number(opt('--port') ?? process.env.HOROSA_SKILL_PORT ?? process.env.XUANSHU_HOROSA_PORT ?? 8765)
  const host = opt('--host') ?? process.env.HOROSA_SKILL_HOST ?? '127.0.0.1'
  if (port === 8765) {
    // 安全护栏：8765 是真实 horosa 的端口，断言台绝不允许绑它。
    recordCall({ kind: 'serve-refused', port })
    process.stderr.write('fake uvx: refusing to bind the real horosa port 8765\n')
    process.exit(9)
  }
  const sessionId = randomBytes(16).toString('hex')

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
        res.writeHead(202, { 'content-type': 'application/json', 'mcp-session-id': sessionId })
        res.end()
        return
      }
      const reply = (result) => {
        const payload = { jsonrpc: '2.0', id: message?.id ?? null, result }
        if (wantsSse) {
          res.writeHead(200, { 'mcp-session-id': sessionId, 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
          res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)
        } else {
          res.writeHead(200, { 'mcp-session-id': sessionId, 'content-type': 'application/json' })
          res.end(JSON.stringify(payload))
        }
      }
      if (method === 'initialize') {
        reply({ protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'horosa-skill', version: VERSION } })
        return
      }
      if (method === 'tools/list') {
        reply({ tools: FAKE_TOOLS })
        return
      }
      if (method === 'tools/call') {
        const name = message.params?.name
        const args = message.params?.arguments ?? {}
        if (name !== 'horosa_cn_bazi_birth') {
          reply({ content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'fixture.unknown_tool', tool: name }) }], isError: false })
          return
        }
        recordCall({ kind: 'tools-call', tool: name, args })
        // 真机形状：信封被 JSON.stringify 塞进 result.content[0].text，**不在** structuredContent 里。
        reply({ content: [{ type: 'text', text: JSON.stringify(baziEnvelope(args)) }], isError: false })
        return
      }
      reply({}) // 其它方法（ping 等）：空 result，别把客户端卡住
    })
  })

  server.on('error', (error) => {
    process.stderr.write(`fake uvx serve: ${error.message}\n`)
    process.exit(1)
  })

  server.listen(port, host, () => {
    writeFileSync(SERVE_FILE, `${JSON.stringify({ pid: process.pid, port, host, at: Date.now() })}\n`)
    recordCall({ kind: 'serve', port, host, argv })
    // 真机这一行在 stdout；我们走 stderr —— 断言台不看 serve 的 stdout，只看端口探针。
    process.stderr.write(`fake uvx: Horosa Skill MCP 正在 http://${host}:${port}/mcp 监听（fixture，12 个技法工具）\n`)
  })

  const shutdown = () => {
    try {
      server.closeAllConnections?.()
    } catch {
      /* 老 node */
    }
    rmSync(SERVE_FILE, { force: true })
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 300).unref()
  }
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, shutdown)
  // 兜底：无论如何别留下孤儿进程（断言台失败时也不会污染下一轮）。
  setTimeout(shutdown, 180_000).unref()
}

function main() {
  const argv = process.argv.slice(2)

  if (argv.includes('--version') || argv.includes('-V')) {
    recordCall({ kind: 'version' })
    process.stdout.write('uv 0.12.10\n')
    return 0
  }

  // `[--from <wheel>] horosa-skill <cmd> ...`
  const skillAt = argv.findIndex((token) => /horosa[-_]skill$/.test(token))
  const before = skillAt === -1 ? argv : argv.slice(0, skillAt)
  const after = skillAt === -1 ? argv : argv.slice(skillAt + 1)
  const fromIndex = before.indexOf('--from')
  const wheel = fromIndex === -1 ? undefined : before[fromIndex + 1]
  const cmd = after[0]
  const rest = after.slice(1)
  const opt = (name) => {
    const index = rest.indexOf(name)
    return index === -1 ? undefined : rest[index + 1]
  }

  if (wheel !== undefined && !existsSync(wheel)) {
    recordCall({ kind: 'bad-wheel', wheel })
    process.stderr.write(`fake uvx: --from path does not exist: ${wheel}\n`)
    return 1
  }

  if (cmd === 'doctor') {
    recordCall({ kind: 'doctor', installed: installedVersion() !== null })
    emitJson(doctorReport())
    return 0
  }

  if (cmd === 'install') {
    const inline = rest.find((token) => token.startsWith('--archive='))
    const archive = inline ? inline.slice('--archive='.length) : opt('--archive')
    if (MODE === 'fail-install') {
      recordCall({ kind: 'install', archive, failed: true })
      process.stderr.write(`${JSON.stringify({ ok: false, code: 'runtime.install_failed', message: 'fixture: install refused' })}\n`)
      return 1
    }
    if (!archive || !existsSync(archive)) {
      recordCall({ kind: 'install', archive, missing: true })
      process.stderr.write(`${JSON.stringify({ ok: false, code: 'runtime.archive_missing', message: `fixture: archive not found: ${archive}` })}\n`)
      return 2
    }
    writeFileSync(INSTALLED_FILE, `${JSON.stringify({ version: VERSION, archive, at: Date.now() }, undefined, 2)}\n`)
    recordCall({ kind: 'install', archive, force: rest.includes('--force') })
    emitJson({
      ok: true,
      installed: true,
      runtime_root: process.env.HOROSA_RUNTIME_ROOT ?? null,
      runtime_layout_version: 1,
      runtime_payload_version: VERSION,
      export_registry_version: 15,
      derived_from: { platform: 'darwin-arm64', version: VERSION },
      services: { backend_url: 'http://127.0.0.1:9999', chart_url: 'http://127.0.0.1:8899' },
      archive,
      force: rest.includes('--force'),
    })
    return 0
  }

  if (cmd === 'runtime') {
    const sub = rest[0]
    const state = serveState()
    if (sub === 'status') {
      const version = installedVersion()
      recordCall({ kind: 'runtime-status', running: Boolean(state) })
      emitJson({
        ok: true,
        installed: version !== null,
        mode: 'managed',
        runtime_root: process.env.HOROSA_RUNTIME_ROOT ?? null,
        runtime_version: version,
        platform: `${process.platform}-${process.arch}`,
        ports: { backend: 9999, chart: 8899, source: 'default' },
        endpoints: [],
        registry_status: state ? 'running' : null,
        launcher: state ? { pid: state.pid, log: null, started_at: null } : null,
        clients: {},
        start_lock: null,
        summary: state ? '全部服务在跑（fixture）。' : '没有服务在跑 —— 运行 `horosa-skill runtime start`。',
      })
      return 0
    }
    if (sub === 'stop') {
      if (state) {
        try {
          process.kill(state.pid)
        } catch {
          /* 已经死了 */
        }
        rmSync(SERVE_FILE, { force: true })
      }
      recordCall({ kind: 'runtime-stop', pid: state?.pid ?? null })
      emitJson({ ok: true, stopped: Boolean(state), pid: state?.pid ?? null })
      return 0
    }
    recordCall({ kind: `runtime-${sub}` })
    emitJson({ ok: true, action: sub, pid: state?.pid ?? null })
    return 0
  }

  if (cmd === 'tool' && rest[0] === 'list') {
    recordCall({ kind: 'tool-list' })
    emitJson(FAKE_TOOLS.map((tool) => ({ name: tool.name.replace(/^horosa_/, ''), mcp_name: tool.name, execution: 'local' })))
    return 0
  }

  if (cmd === 'serve') {
    startServe(argv, rest)
    return undefined // 一直活着，直到被 SIGTERM
  }

  recordCall({ kind: 'unknown', cmd })
  emitJson({ ok: true, fake_uvx: true, command: after })
  return 0
}

const code = main()
if (code !== undefined) process.exit(code)
