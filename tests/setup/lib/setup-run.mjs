/**
 * tests/setup/lib/setup-run.mjs — 断言台与「被测 CLI / 本地计数 server」之间的全部胶水。
 *
 * 三条纪律：
 *   ① 跑被测 CLI 一律 `spawnSync` + `encoding:'utf8'`：Windows 控制台是 cp936，**必须收字节再按 UTF-8 解**
 *      （契约 §6：不许用 PowerShell 重定向抓输出）。
 *   ② 计数 server 是**独立进程**（`spawn`，不是 in-process）：`spawnSync` 会阻塞父进程事件循环，
 *      server 长在父进程里的话每条「零请求」断言都会假绿。见 release-server.mjs 顶部说明。
 *   ③ 环境变量走 `childEnv()`（受管变量先删再设），绝不继承开发机上真实的 `DSH_HOME`/`HOROSA_*`。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'

import { childEnv } from './env.mjs'
import { FAKE_UVX, RELEASE_SERVER, REPO_ROOT, SETUP_CLI } from './paths.mjs'

/** 跑一次被测 CLI。 */
export function runSetup(args, { env = {}, timeoutMs = 120_000, cwd = REPO_ROOT } = {}) {
  const run = spawnSync(process.execPath, [SETUP_CLI, ...args], {
    cwd,
    env: childEnv(env),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  })
  const stdout = run.stdout ?? ''
  let json
  if (stdout.trim() !== '') {
    try {
      json = JSON.parse(stdout)
    } catch {
      json = undefined
    }
  }
  return {
    status: run.status,
    signal: run.signal,
    json,
    stdout,
    stderr: run.stderr ?? '',
    error: run.error?.message,
    /** 失败时打这段（命令 + 两个流），比 `expect(...).toBe(...)` 的裸数字好读一个数量级。 */
    raw() {
      return [
        `$ node scripts/setup.mjs ${args.join(' ')}`,
        `exit=${run.status}${run.signal ? ` signal=${run.signal}` : ''}${run.error ? ` error=${run.error.message}` : ''}`,
        '--- stdout ---',
        stdout.slice(0, 4000),
        '--- stderr ---',
        (run.stderr ?? '').slice(0, 4000),
      ].join('\n')
    },
  }
}

/** 读报告（契约 §7：`<dsh-home>/xuanshu/setup-report.json`）。 */
export function readReport(home) {
  const path = join(home, 'xuanshu', 'setup-report.json')
  if (!existsSync(path)) return { path, report: undefined }
  return { path, report: JSON.parse(readFileSync(path, 'utf8')) }
}

/** 读假 uvx 的调用台账（每行一个 JSON）。 */
export function readCalls(state, file = 'calls.jsonl') {
  const path = join(state, file)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

/**
 * 起一份**假 horosa serve**（独立进程，不由被测实现托管）。
 *
 * 为什么需要它：C2 的两条分流用例（A1「守卫判 probe-failed」/ A2「不带 mcp-session-id」）的前提是
 * **端口上已经有一个 listener**。让被测实现自己去起，就等于把「被测行为」当成「环境前提」，
 * 断言从根上就测不到了（而且 A1 的硬规矩之一恰恰是「绝不 spawn」）。
 *
 * 就绪判据用一次 **POST** `initialize` 探活（不是 GET）：GET 只来自票 04 的四态守卫，
 * 而 A1 的 fixture 按「前 N 次 GET 慢应答」计数 —— 探活用 GET 会把那次慢应答提前消耗掉。
 *
 * @returns {Promise<{port:number, url:string, stop:()=>Promise<void>}>}
 */
export async function startFakeHorosa({ state, env = {}, port, timeoutMs = 10_000 }) {
  const child = spawn(
    process.execPath,
    [FAKE_UVX, 'horosa-skill', 'serve', '--host', '127.0.0.1', '--port', String(port)],
    { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv({ XUANSHU_FAKE_UVX_STATE: state, ...env }) },
  )
  const stderr = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => stderr.push(chunk))

  const url = `http://127.0.0.1:${port}/mcp`
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture-ready', version: '1' } } }),
      })
      if (response.status === 200) {
        await response.arrayBuffer()
        break
      }
    } catch (error) {
      if (Date.now() >= deadline) throw new Error(`假 horosa 没在 ${timeoutMs}ms 内起来：${error?.message ?? error}\n${stderr.join('')}`)
    }
    if (Date.now() >= deadline) throw new Error(`假 horosa 没在 ${timeoutMs}ms 内起来（端口 ${port}）\n${stderr.join('')}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return {
    port,
    url,
    /** 停掉这份**测试自己起的**进程（被测实现在这几条用例里不许碰它）。 */
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.kill()
      await new Promise((resolve) => setTimeout(resolve, 200))
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    },
    stderrText: () => stderr.join(''),
  }
}

/** 找一个空闲端口（先 listen(0) 拿 OS 分配，再关掉）。给 C2 的 `--horosa-port` 用。 */
export async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/**
 * 起本地计数 server（独立进程）。返回 { port, releaseBase, url, stats(), count(), requests(), responses(), reset(), stop() }。
 * @param {{state: string, routes?: Record<string, object>}} opts
 */
export async function startReleaseServer({ state, routes }) {
  const args = [RELEASE_SERVER, '--state', state]
  if (routes) {
    const routesPath = join(state, 'routes.json')
    mkdirSync(state, { recursive: true })
    writeFileSync(routesPath, `${JSON.stringify(routes, undefined, 2)}\n`)
    args.push('--routes', routesPath)
  }
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv() })
  const stderr = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => stderr.push(chunk))

  const port = await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error(`release-server did not report a port in 10s\n${stderr.join('')}`)), 10_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const line = buffer.split(/\r?\n/)[0]
      if (buffer.includes('\n')) {
        clearTimeout(timer)
        try {
          resolve(JSON.parse(line).port)
        } catch (error) {
          reject(error)
        }
      }
    })
    child.on('error', reject)
    child.on('exit', (code) => reject(new Error(`release-server exited early (code=${code})\n${stderr.join('')}`)))
  })

  const url = (path) => `http://127.0.0.1:${port}${path}`
  return {
    port,
    releaseBase: `http://127.0.0.1:${port}/releases/download/v0.40.1`,
    url,
    async stats() {
      return await (await fetch(url('/__stats'))).json()
    },
    async count() {
      return (await (await fetch(url('/__stats'))).json()).count
    },
    async reset() {
      await fetch(url('/__reset'), { method: 'POST' })
    },
    async requests() {
      return (await (await fetch(url('/__stats'))).json()).requests
    },
    /** 响应侧台账（status / sent / kind）：判「服务端到底给够了没有」时看它。 */
    async responses() {
      return (await (await fetch(url('/__stats'))).json()).responses
    },
    stop() {
      try {
        child.kill()
      } catch {
        /* 已经死了 */
      }
    },
    stderrText: () => stderr.join(''),
  }
}
