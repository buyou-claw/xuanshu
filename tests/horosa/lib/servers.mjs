/**
 * tests/horosa/lib/servers.mjs — 假服务器 / 端口 / HTTP 的胶水（断言台侧）。
 *
 * 三条纪律（与票 04/05 同）：
 *   ① 对照组服务器一律**独立进程**（`fake-mcp-server.mjs`）：`spawnSync` 会阻塞测试进程的事件循环，
 *      长在测试进程里的 server 在被测实现探测那一刻不会被调度 → 所有「有 HTTP 响应」的现场会假绿。
 *   ② 端口一律 `127.0.0.1` + 内核分配（`listen(0)`）：绝不写死 8765（那是真 horosa 的端口）。
 *   ③ 这里**不 import 被测实现**：探活用自己的最简 HTTP，判据归被测实现与 `scripts/isolation`。
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'

import { childEnv } from './env.mjs'
import { FAKE_MCP_SERVER } from './paths.mjs'

/** 找一个空闲端口（先 listen(0) 拿内核分配，再关掉）。 */
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

/** 一次性 HTTP 请求（测试侧探活用，不参与判据）。 */
export function httpRequest(url, { method = 'GET', headers = {}, body, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers, timeout: timeoutMs }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }))
    })
    request.on('timeout', () => { request.destroy(new Error(`HTTP 超时（${timeoutMs}ms）：${url}`)) })
    request.on('error', reject)
    if (body !== undefined) request.write(typeof body === 'string' ? body : JSON.stringify(body))
    request.end()
  })
}

/** 进程是否还活着（`kill(pid, 0)` —— 只探活，不发信号）。 */
export function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 起一份独立的假 MCP / 假占用者（`fake-mcp-server.mjs`）。
 *
 * 端口：缺省 `listen(0)` 由内核分配（`announcement.port` 是真端口）——**绝不写死端口**，
 * 也不要跨用例复用同一个端口（TIME_WAIT 会把下一次绑定拖住）。
 *
 * @param {{mode?: string, port?: number, env?: Record<string,string>}} options
 * @returns {Promise<{mode:string, host:string, port:number, pid:number, url:string, stderrText:()=>string, alive:()=>boolean, stop:()=>Promise<void>}>}
 */
export async function startFakeMcp({ mode = 'mcp', port = 0, env = {} } = {}) {
  const child = spawn(process.execPath, [FAKE_MCP_SERVER, '--mode', mode, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv(env),
  })
  const stderr = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => stderr.push(chunk))

  const announcement = await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error(`fake-mcp-server(${mode}) 10s 内没报端口\n${stderr.join('')}`)), 10_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      if (!buffer.includes('\n')) return
      clearTimeout(timer)
      try {
        resolve(JSON.parse(buffer.split(/\r?\n/)[0]))
      } catch (error) {
        reject(error)
      }
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`fake-mcp-server(${mode}) 提前退出（code=${code}）\n${stderr.join('')}`))
    })
  })

  return {
    mode,
    host: announcement.host,
    port: announcement.port,
    pid: announcement.pid,
    url: `http://${announcement.host}:${announcement.port}/mcp`,
    stderrText: () => stderr.join(''),
    alive: () => isAlive(announcement.pid),
    async stop() {
      if (!isAlive(announcement.pid)) return
      child.kill()
      await new Promise((resolve) => setTimeout(resolve, 200))
      if (isAlive(announcement.pid)) child.kill('SIGKILL')
    },
    child,
  }
}

/**
 * 直接对一个 MCP 端点做一次 initialize（测试侧的独立探活）。
 *
 * 为什么要它：P7 断言「`startHorosaServe` 起的那个端口真的在答 MCP」时，不能让**被测实现**的
 * `waitReady` 既当被验对象又当判据来源 —— 这里用一份自己的最小客户端复判（判据 = 200 + mcp-session-id，
 * 与票 05 口径一致）。
 */
export async function probeMcpInitialize(url, { timeoutMs = 5000, sessionId } = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json' }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const response = await httpRequest(url, {
    method: 'POST',
    headers,
    timeoutMs,
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'tests/horosa', version: '1' } },
    },
  })
  const sessionHeader = response.headers['mcp-session-id']
  return { ok: response.status === 200, status: response.status, sessionId: sessionHeader, headers: response.headers, text: response.text }
}

/**
 * 轮询到某端口答出 MCP（判据 = initialize 200，可选要求 mcp-session-id）。
 *
 * 失败信息必须**自带现场**（Lead 2026-10-13 的要求）：端口号、等了多久、试了几次、最后一次的错误、
 * 以及调用方给的替身输出尾巴（`tail()`）。只写一句「127.0.0.1:2205 超时」等于让人去猜
 * 是哪个替身没起来 —— 端口是内核分配的，那个数字在别的机器上根本对不上。
 *
 * @param {number} port
 * @param {{timeoutMs?: number, requireSession?: boolean, path?: string, describe?: string, tail?: () => string}} [options]
 */
export async function waitMcpReady(port, { timeoutMs = 20_000, requireSession = false, path = '/mcp', describe = 'serve', tail } = {}) {
  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs
  let attempts = 0
  let last = { status: undefined, detail: 'never tried' }
  for (;;) {
    attempts += 1
    try {
      const probe = await probeMcpInitialize(`http://127.0.0.1:${port}${path}`, { timeoutMs: 1500 })
      last = probe
      if (probe.ok && (!requireSession || Boolean(probe.sessionId))) return probe
      if (probe.ok) last = { ...probe, detail: 'initialize 成功但响应头没有 mcp-session-id（握手不成立）' }
    } catch (error) {
      last = { status: undefined, detail: error?.message ?? String(error) }
    }
    if (Date.now() >= deadline) {
      const tailText = typeof tail === 'function' ? String(tail() ?? '') : ''
      throw new Error(
        [
          `等 ${describe} 在 127.0.0.1:${port}${path} 答出 MCP 超时：${timeoutMs}ms 内试了 ${attempts} 次。`,
          `最后一次：${JSON.stringify(last).slice(0, 400)}`,
          tailText === '' ? '（调用方没给替身输出尾巴）' : `--- 替身输出尾巴 ---\n${tailText.slice(-1500)}`,
        ].join('\n'),
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}
