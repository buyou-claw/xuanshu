/**
 * tests/isolation/lib/web-boot.mjs — 「web bundle 真的起得来」的**独立进程**探针（票 07 新增）。
 *
 * 为什么是独立进程而不是直接长在测试里：测试用 `spawnSync` 抓子进程输出（utf8，见
 * `lib/verifier.mjs` 的注释），而 `spawnSync` 会**阻塞测试进程的事件循环** —— web 服务端要真答
 * HTTP，探针必须跑在自己的进程里，否则会出现「服务端起来了但没被调度 → 探针超时」的假红。
 *
 * 它证的是票 07 装配级验收里那条最容易作假的事实：`@deepseek-ai/dsh-web-app` 进 `dsh.profile.bundles`
 * 之后，**真 CLI 能起 web 并且把带 `__DSH_BOOT__` 注入标记的 HTML 发出来**（不是「包在 node_modules
 * 里躺着」）。包在被声明/probe 到之前，票 04 的 `--mode web` 必然 exit 2，这条路径从没被真跑过。
 *
 * 用法（只被 tests/isolation/resolve.test.mjs 调用）：
 *   node tests/isolation/lib/web-boot.mjs --home <dsh-home> --profile xuanshu [--port <n>]
 * stdout 上一行 `##XUANSHU-WEB-BOOT## {json}`；退出码 0 = 真拿到了 HTML（断言细节由调用方做）。
 *
 * 端口：默认 `listen(0)` 让 OS 挑空闲端口（绝不占 19388/19387）；`--port` 只给手工复现用。
 * 隔离：`DSH_HOME` 由调用方给出，探针**只**写那个 home（web 启动会重写 `<profile>/cordis.yml`、
 * 写 `storages/`），绝不碰真实 `~/.dsh`。
 */
import { spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const MARKER = '##XUANSHU-WEB-BOOT##'

function parseArgs(argv) {
  const opts = { home: undefined, profile: 'xuanshu', port: undefined, cwd: undefined, timeoutMs: 90_000 }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--home') opts.home = argv[++i]
    else if (arg === '--profile') opts.profile = argv[++i]
    else if (arg === '--port') opts.port = Number(argv[++i])
    else if (arg === '--cwd') opts.cwd = argv[++i]
    else if (arg === '--timeout-ms') opts.timeoutMs = Number(argv[++i])
    else throw new Error(`web-boot: unknown argument ${arg}`)
  }
  if (!opts.home) throw new Error('web-boot: --home is required')
  opts.home = resolve(opts.home)
  if (opts.cwd === undefined) throw new Error('web-boot: --cwd is required（web 的工作目录；别从 home 猜仓库根）')
  opts.cwd = resolve(opts.cwd)
  return opts
}

/** OS 挑一个空闲端口（起一个一次性 server 读端口再关掉）——不与 desktop 19387 / xuanshu 19388 抢。 */
function reserveFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer((_req, res) => res.end(''))
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

function httpGet(target, cookie) {
  return new Promise((resolveGet) => {
    const req = request(target, { headers: cookie === undefined ? {} : { cookie } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolveGet({ status: res.statusCode, headers: res.headers, body }))
    })
    req.setTimeout(5000, () => req.destroy(new Error('timeout')))
    req.on('error', (error) => resolveGet({ error: error?.message ?? String(error) }))
    req.end()
  })
}

const report = (payload) => {
  process.stdout.write(`\n${MARKER} ${JSON.stringify(payload)}\n`)
}

const result = {
  ok: false,
  home: undefined,
  profile: undefined,
  binJs: undefined,
  port: undefined,
  url: undefined,
  handshake: undefined,
  page: undefined,
  hasBootMarker: false,
  childExitCode: undefined,
  stderrTail: undefined,
  error: undefined,
  notes: [],
}

let child
try {
  const opts = parseArgs(process.argv.slice(2))
  result.home = opts.home
  result.profile = opts.profile
  const profileDir = join(opts.home, 'profiles', opts.profile)
  const binJs = join(profileDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  result.binJs = binJs
  if (!existsSync(binJs)) throw new Error(`web-boot: no DSH CLI at ${binJs}（先 node scripts/install-profile.mjs --home "${opts.home}"）`)

  const port = Number.isFinite(opts.port) ? opts.port : await reserveFreePort()
  result.port = port

  // 命令形态是 `dsh web --port <n> --no-open`（**不是** `--profile xuanshu web`）：
  // `dsh <name>` 那条捷径把 `web` 展开成 `--profile web`，而 `--profile <name> web`
  // 会让根解析器把 `web` 当多余的位置参数（实测 `error: too many arguments`）。见本票报告。
  child = spawn(process.execPath, [binJs, '--profile', opts.profile, '--port', String(port), '--no-open'], {
    cwd: opts.cwd,
    env: { ...process.env, DSH_HOME: opts.home, DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const exited = new Promise((resolveExit) => child.once('exit', (code) => resolveExit(code)))

  // `dsh web` 在标准输出打一行 `dsh web: http://127.0.0.1:<port>/?token=<token>`；等它出现。
  const deadline = Date.now() + opts.timeoutMs
  while (Date.now() < deadline) {
    await sleep(500)
    result.url = new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=[A-Za-z0-9_-]+`).exec(stdout)?.[0]
    if (result.url !== undefined || child.exitCode !== null) break
  }
  if (result.url === undefined) {
    const code = child.exitCode ?? (child.kill(), await exited)
    throw new Error(`web-boot: CLI 没在 ${opts.timeoutMs}ms 内打出 token URL（exit=${code}；stderr: ${stderr.trim().slice(-400)}）`)
  }

  // 信任握手：`GET /?token=…` 回 303 + `set-cookie: dsh-auth-*`（SameSite=Strict、HttpOnly），
  // 拿这枚 cookie 再 `GET /` 才是那份 HTML。少了 cookie 只有 401/303，这正是「真起」与「端口有人在听」的区别。
  const token = /token=([A-Za-z0-9_-]+)/.exec(result.url)[1]
  const handshake = await httpGet(`http://127.0.0.1:${port}/?token=${token}`)
  const jar = (handshake.headers?.['set-cookie'] ?? []).map((cookie) => cookie.split(';')[0]).join('; ')
  result.handshake = { status: handshake.status, location: handshake.headers?.location, cookies: jar === '' ? 0 : jar.split('; ').length }
  if (jar === '') result.notes.push('token 握手没有发出会话 cookie：请求会停在 401/303，拿不到 HTML')

  const page = await httpGet(`http://127.0.0.1:${port}/`, jar)
  result.page = {
    status: page.status,
    contentType: page.headers?.['content-type'],
    bytes: typeof page.body === 'string' ? page.body.length : 0,
    head: typeof page.body === 'string' ? page.body.slice(0, 160).replace(/\s+/g, ' ') : undefined,
    error: page.error,
  }
  result.hasBootMarker = typeof page.body === 'string' && page.body.includes('__DSH_BOOT__')
  result.ok = page.status === 200 && result.hasBootMarker

  const code = child.exitCode
  if (code === null) child.kill()
  result.childExitCode = code ?? (await Promise.race([exited, sleep(3000).then(() => 'killed')]))
  result.stderrTail = stderr.trim().slice(-500)
  report(result)
  process.exitCode = result.ok ? 0 : 1
} catch (error) {
  try { child?.kill() } catch { /* 已经退出了 */ }
  result.error = error?.stack ?? String(error)
  report(result)
  process.exitCode = 1
}
