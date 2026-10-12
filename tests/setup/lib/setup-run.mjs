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
import { RELEASE_SERVER, REPO_ROOT, SETUP_CLI } from './paths.mjs'

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
