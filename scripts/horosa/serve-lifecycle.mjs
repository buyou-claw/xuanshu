/**
 * scripts/horosa/serve-lifecycle.mjs
 *
 * 票 05 自检 C2 的 serve 生命周期（队友 B）。冻结接口（契约 §9，名字/签名/返回形状不许改）：
 *   startServe({ wheel, runtimeRoot, dataDir, host, port, timeoutMs, logFile, env })
 *     -> { ok, started, pid, evidence, detail }     // 已在跑则 started:false 且 pid:null
 *   stopServe({ pid, runtimeRoot, dataDir, timeoutMs })
 *     -> { ok, evidence, detail }                   // 只停自己起的 pid；pid 为空即 no-op
 *
 * 起 serve 的命令（契约 §0 一手事实 + `captures/horosa-cli/serve-help.txt`）：
 *   uvx --from <wheel> horosa-skill serve --host 127.0.0.1 --port <port>
 * 带 `HOROSA_RUNTIME_ROOT` / `HOROSA_SKILL_DATA_DIR`（+ HOROSA_SKILL_HOST/PORT 保持一致），
 * `uvx` 可被 `XUANSHU_UVX_BIN` 覆盖（契约 §10，测试注入点）。
 *
 * 端口判定**复用**票 04 的 `scripts/isolation/horosa-guard.mjs::checkHorosaPort`（四态），
 * 本文件不另写一份端口判定（§9 第三条）。因此：
 *   free             → 起 serve，等到 `horosa-ready` 才算 ok（`timeoutMs` 是冷启动预算）
 *   horosa-ready     → 复用，不新起（started:false、pid:null）
 *   occupied-foreign → 拒绝启动（绝不 kill 别人的进程，`evidence.reason='occupied-foreign'`）
 *   probe-failed     → fail-closed 拒绝启动（状态未知时不起第二个实例）
 *
 * 「只停自己起的进程」是怎么做到的（唯一授权来源）：
 *   本模块在 **本进程内** 维护一张 spawn 登记表（pid → 条目）。`stopServe` 只对登记表里的 pid
 *   动手；不在表里的 pid 一律 `ok:false` 拒绝（哪怕调用方明确要求）。**没有**任何按名字/按端口
 *   找进程再杀的路径 —— 上游明令 `:9999`/`:8899` 是用户桌面版星阙的端口，永不 kill、永不测试。
 *   真机 serve 由别人起的（例如 Lead 手工起的那份）：`startServe` 只会复用，`stopServe` 只会拒绝。
 *
 * 日志（契约 §5）：子进程 stdio 直接落到 `logFile`（默认 `<dataDir>/serve.log`）——
 * 用 fd 而不是管道，父进程退出/被 keep-serve 场景丢下时不会给子进程留下断掉的 stdout 管道
 * （Python logging 撞 BrokenPipe 会真的把 serve 打挂）。evidence 里的 `logTail` 是从文件尾部现读的。
 *
 * 本模块**不往 stdout 打印**；一切失败折算成 `{ ok:false, ... }`，绝不抛。
 */

import { spawn } from 'node:child_process'
import { closeSync, fstatSync, mkdirSync, openSync, readSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { DEFAULT_HOROSA_PORT, HOROSA_MCP_PATH } from '../isolation/defaults.mjs'
import { checkHorosaPort } from '../isolation/horosa-guard.mjs'
import { debug, decodeConsole, errorMessage, sleep, truncate } from './shared.mjs'

const DEFAULT_HOST = '127.0.0.1'
/** 起 serve 的默认预算：首启 runtime（Java + chart + Node）冷启动可以到几分钟（契约 §2 `--selfcheck-timeout`）。 */
const DEFAULT_START_TIMEOUT_MS = 180_000
/** stop 的默认预算：taskkill /T /F 或 SIGTERM→SIGKILL 都在这个窗内收口。 */
const DEFAULT_STOP_TIMEOUT_MS = 20_000
/** 就绪轮询间隔。 */
const POLL_INTERVAL_MS = 700
/** 每轮探针的预算（守卫四态自带超时，取小值让轮询有节奏）。 */
const PROBE_BUDGET_MS = 2000
/** evidence 里的日志尾巴上限（契约 §7：证据只放小体积关键字段）。 */
const LOG_TAIL_LIMIT = 1024

/**
 * 本进程 spawn 过的 serve 登记表。条目即使已退出也**保留**：
 * `stopServe` 靠它区分「我起的、已经死了」（ok:true, alreadyExited）与「不是我的」（ok:false, 拒绝）。
 */
const OURS = new Map()

function portOf(port) {
  return Number(port)
}

function urlOf(host, port) {
  return `http://${host}:${port}${HOROSA_MCP_PATH}`
}

/** `process.kill(pid, 0)` 探活：EPERM 表示存在但不属于我 → 仍然算「活着」。 */
function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error && error.code === 'EPERM'
  }
}

async function waitGone(pid, timeoutMs) {
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 1)
  for (;;) {
    if (!isAlive(pid)) return true
    if (Date.now() >= deadline) return !isAlive(pid)
    await sleep(100)
  }
}

/** 读文件尾部若干字节（日志诊断用）。读不到就返回空串。 */
function readTail(path, limit = LOG_TAIL_LIMIT) {
  if (!path) return ''
  let fd
  try {
    fd = openSync(path, 'r')
    const { size } = fstatSync(fd)
    const start = Math.max(0, Number(size) - limit)
    const length = Number(size) - start
    if (length <= 0) return ''
    const buffer = Buffer.alloc(length)
    const read = readSync(fd, buffer, 0, length, start)
    return decodeConsole(buffer.subarray(0, read))
  } catch {
    return ''
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        /* 关不掉无所谓 */
      }
    }
  }
}

/** 逐元素给 Windows 命令行加引号（`cmd /c` 那一条路径用）。 */
function quoteWindowsArg(value) {
  const text = String(value)
  if (text.length > 0 && !/[\s"&|<>^()%!]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * 拼 spawn 计划。`XUANSHU_UVX_BIN`（契约 §10 的测试注入点）可以指向三种东西：
 *   ① 真可执行文件（`uvx` / `uvx.exe`）→ 直接 spawn；
 *   ② `.mjs`/`.js`/`.cjs` 脚本 → `spawn(process.execPath, [bin, ...args])`
 *      （断言台的假 uvx 就是这个形状：`XUANSHU_UVX_BIN=tests/setup/fixtures/bin/uvx.mjs`；
 *       Windows 上脚本不是可执行映像，不这样起会直接 ENOENT/EINVAL）；
 *   ③ `.cmd`/`.bat` 外壳 → `cmd /d /s /c "…"`，且要用 `windowsVerbatimArguments` 自己管引号
 *      （同一份语义见 Node 自己 shell:true 的实现）。
 */
function buildSpawnPlan(bin, args) {
  if (/\.(mjs|cjs|js)$/i.test(bin)) {
    return { command: process.execPath, args: [bin, ...args], verbatim: false }
  }
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe'
    const line = [bin, ...args].map(quoteWindowsArg).join(' ')
    return { command: comspec, args: ['/d', '/s', '/c', `"${line}"`], verbatim: true }
  }
  return { command: bin, args, verbatim: false }
}

/** Windows 收进程树：`taskkill /PID <pid> /T /F`（uvx → uv → python 三层，只有 /T 收得全）。 */
function taskkillTree(pid, timeoutMs) {
  return new Promise((resolve) => {
    const chunks = []
    let child
    try {
      child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      resolve({ ok: false, code: undefined, output: '', detail: `taskkill 起不来：${errorMessage(error)}` })
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {
        /* 杀不掉就算了：调用方还有 waitGone 兜底 */
      }
      resolve({ ok: false, code: undefined, output: decodeConsole(Buffer.concat(chunks)), detail: `taskkill 超时（${timeoutMs}ms）` })
    }, Math.max(1000, Number(timeoutMs) || DEFAULT_STOP_TIMEOUT_MS))

    const finish = (code, detail) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: code === 0, code, output: decodeConsole(Buffer.concat(chunks)), detail })
    }
    child.stdout?.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.stderr?.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.once('error', (error) => finish(-1, `taskkill 执行失败：${errorMessage(error)}`))
    child.once('close', (code) => finish(code ?? -1, `taskkill 退出码 ${code}`))
  })
}

/** POSIX 发信号：detached 起的子进程自成进程组（pgid == pid），组杀才能把 uv → python 一起收掉。 */
function signalTree(entry, signal) {
  const errors = []
  if (entry && entry.detached) {
    try {
      process.kill(-entry.pid, signal)
      return errors
    } catch (error) {
      if (error && error.code === 'ESRCH') return errors // 组已经没了
      errors.push(`kill(-${entry.pid}, ${signal}) 失败：${errorMessage(error)}`)
    }
  }
  try {
    if (entry && entry.child && typeof entry.child.kill === 'function') entry.child.kill(signal)
    else process.kill(entry.pid, signal)
  } catch (error) {
    if (!error || error.code !== 'ESRCH') errors.push(`kill(${entry.pid}, ${signal}) 失败：${errorMessage(error)}`)
  }
  return errors
}

/**
 * 起 horosa serve（若端口上已经有 horosa MCP 则复用）。绝不抛。
 *
 * @param {object} options
 * @param {string} [options.wheel]        已校验的 wheel 路径（`uvx --from <wheel>`）
 * @param {string} [options.runtimeRoot]  HOROSA_RUNTIME_ROOT
 * @param {string} [options.dataDir]      HOROSA_SKILL_DATA_DIR（logFile 默认落在它下面）
 * @param {string} [options.host]         默认 127.0.0.1
 * @param {number} [options.port]         默认 8765（定值唯一来源 = scripts/isolation/defaults.mjs）
 * @param {number} [options.timeoutMs]    等到 horosa-ready 的总预算，默认 180000
 * @param {string} [options.logFile]      serve 日志落点，默认 `<dataDir>/serve.log`
 * @param {object} [options.env]          追加/覆盖给子进程的环境变量
 * @returns {Promise<{ok:boolean, started:boolean, pid:number|null, evidence:object, detail:string}>}
 */
export async function startServe({
  wheel,
  runtimeRoot,
  dataDir,
  host = DEFAULT_HOST,
  port = DEFAULT_HOROSA_PORT,
  timeoutMs = DEFAULT_START_TIMEOUT_MS,
  logFile,
  env,
} = {}) {
  const numericPort = portOf(port)
  const budget = Math.max(1, Number(timeoutMs) || DEFAULT_START_TIMEOUT_MS)
  const url = urlOf(host, numericPort)

  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    return {
      ok: false,
      started: false,
      pid: null,
      evidence: { reason: 'invalid-port', port: Number(port), url },
      detail: `端口非法（${String(port)}）：起 serve 前就停手。`,
    }
  }

  /* ---------- 门 1：端口四态（复用票 04，不另写判定） ---------- */
  const first = await checkHorosaPort({ port: numericPort, path: HOROSA_MCP_PATH, timeoutMs: Math.min(PROBE_BUDGET_MS, budget) })
  debug('serve', `起 serve 前端口判定：${first.verdict}`)

  if (first.verdict === 'horosa-ready') {
    return {
      ok: true,
      started: false,
      pid: null,
      evidence: { reason: 'already-running', verdict: first.verdict, url, port: numericPort, logTail: readTail(logFile) },
      detail: `${url} 上已经有 horosa MCP 在答（${first.detail}）：复用，不新起第二个实例。`,
    }
  }
  if (first.verdict === 'occupied-foreign') {
    return {
      ok: false,
      started: false,
      pid: null,
      evidence: { reason: 'occupied-foreign', verdict: first.verdict, port: numericPort, url, guardDetail: truncate(first.detail, 500), hint: first.hint ?? null },
      detail: `拒绝启动：${truncate(first.detail, 300)} —— 绝不 kill 不是自己起的进程，也不去改环境。`,
    }
  }
  if (first.verdict === 'probe-failed') {
    return {
      ok: false,
      started: false,
      pid: null,
      evidence: { reason: 'probe-failed', verdict: first.verdict, port: numericPort, url, guardDetail: truncate(first.detail, 500), hint: first.hint ?? null },
      detail: `拒绝启动（fail-closed）：${truncate(first.detail, 300)} —— 状态未知时不起第二个实例。`,
    }
  }

  /* ---------- 门 2：拼命令 ---------- */
  if (typeof wheel !== 'string' || wheel.trim().length === 0) {
    return {
      ok: false,
      started: false,
      pid: null,
      evidence: { reason: 'missing-wheel', verdict: first.verdict, port: numericPort, url },
      detail: 'startServe 缺 wheel 路径：`uvx --from <wheel>` 拼不出命令（离线场景请用 --wheel 指定已校验的本地 wheel）。',
    }
  }

  const bin = (env && env.XUANSHU_UVX_BIN) || process.env.XUANSHU_UVX_BIN || 'uvx'
  const args = ['--from', wheel, 'horosa-skill', 'serve', '--host', host, '--port', String(numericPort)]
  const command = [bin, ...args].join(' ')
  const target = logFile || (dataDir ? join(dataDir, 'serve.log') : null)

  const childEnv = { ...process.env, ...(env && typeof env === 'object' ? env : {}) }
  if (runtimeRoot) childEnv.HOROSA_RUNTIME_ROOT = String(runtimeRoot)
  if (dataDir) childEnv.HOROSA_SKILL_DATA_DIR = String(dataDir)
  childEnv.HOROSA_SKILL_HOST = String(host)
  childEnv.HOROSA_SKILL_PORT = String(numericPort)

  /* ---------- 门 3：日志落点（日志直接落文件，不给子进程留管道） ---------- */
  let logFd
  let logError
  if (target) {
    try {
      mkdirSync(dirname(target), { recursive: true })
      logFd = openSync(target, 'a')
    } catch (error) {
      logError = `打不开日志文件（${errorMessage(error)}）：${target}`
      debug('serve', logError)
    }
  }

  /* ---------- 起进程 ---------- */
  const plan = buildSpawnPlan(bin, args)
  let child
  try {
    child = spawn(plan.command, plan.args, {
      env: childEnv,
      windowsHide: true,
      // POSIX 上自成进程组：stop 时组杀才能把 uv → python 一并收掉（Windows 由 taskkill /T 负责）。
      detached: process.platform !== 'win32',
      windowsVerbatimArguments: plan.verbatim,
      stdio: logFd === undefined ? ['ignore', 'ignore', 'ignore'] : ['ignore', logFd, logFd],
    })
  } catch (error) {
    if (logFd !== undefined) {
      try {
        closeSync(logFd)
      } catch {
        /* ignore */
      }
    }
    return {
      ok: false,
      started: false,
      pid: null,
      evidence: { reason: 'spawn-failed', command, url, port: numericPort, error: errorMessage(error) },
      detail: `spawn 失败（${errorMessage(error)}）：\"${command}\" 起不来（uvx 缺失时可用 XUANSHU_UVX_BIN 覆盖）。`,
    }
  }
  if (logFd !== undefined) {
    // 子进程已经拿到这份 fd（继承的 dup），父进程这份可以关掉：keep-serve 场景下父进程退出不影响子进程写日志。
    try {
      closeSync(logFd)
    } catch {
      /* ignore */
    }
  }

  const startedAt = Date.now()
  const entry = {
    pid: child.pid ?? null,
    port: numericPort,
    host,
    startedAt,
    wheel,
    logFile: target ?? null,
    command,
    detached: process.platform !== 'win32',
    child,
    stopped: false,
  }
  if (entry.pid) OURS.set(entry.pid, entry)

  let spawnError
  const spawnFailed = new Promise((resolve) => {
    child.once('error', (error) => {
      spawnError = error
      resolve(error)
    })
  })
  let exited = null
  child.once('exit', (code, signal) => {
    exited = { code, signal: signal ?? null, at: Date.now() }
  })

  const failure = (reason, detail, extra = {}) => ({
    ok: false,
    started: true,
    pid: entry.pid,
    evidence: { reason, command, url, port: numericPort, logFile: target ?? null, logError, elapsedMs: Date.now() - startedAt, exit: exited, logTail: truncate(readTail(target), LOG_TAIL_LIMIT), ...extra },
    detail,
  })

  /* ---------- 等就绪（冷启动预算） ---------- */
  const deadline = startedAt + budget
  // ENOENT（uvx 不在 PATH）在 spawn 之后的几个 tick 才报上来：给它一个短窗，早失败比等满预算好。
  const lateError = await Promise.race([spawnFailed, sleep(120).then(() => null)])
  if (lateError) {
    return {
      ok: false,
      started: false,
      pid: null,
      evidence: { reason: 'spawn-failed', command, url, port: numericPort, error: errorMessage(lateError), logFile: target ?? null, logError },
      detail: `spawn 失败（${errorMessage(lateError)}）：\"${command}\" 起不来（uvx 缺失时可用 XUANSHU_UVX_BIN 覆盖）。`,
    }
  }

  let lastVerdict = first.verdict
  for (;;) {
    if (exited) {
      const stopped = await stopOurEntry(entry, Math.min(DEFAULT_STOP_TIMEOUT_MS, 5000))
      return failure(
        'child-exited',
        `serve 进程提前退出了（exit code ${exited.code ?? '-'}${exited.signal ? `, signal ${exited.signal}` : ''}）：见日志 ${target ?? '(未落盘)'}${stopped ? '' : '（未能确认已停）'}。`,
        { cleanedUp: stopped },
      )
    }
    if (spawnError) return failure('spawn-failed', `spawn 失败（${errorMessage(spawnError)}）。`, { cleanedUp: false })

    const health = await checkHorosaPort({ port: numericPort, path: HOROSA_MCP_PATH, timeoutMs: PROBE_BUDGET_MS })
    lastVerdict = health.verdict
    if (health.verdict === 'horosa-ready') {
      return {
        ok: true,
        started: true,
        pid: entry.pid,
        evidence: { reason: 'started', verdict: health.verdict, url, port: numericPort, pid: entry.pid, readyMs: Date.now() - startedAt, command, logFile: target ?? null, logError, logTail: truncate(readTail(target), LOG_TAIL_LIMIT) },
        detail: `serve 已就绪（${url}，pid ${entry.pid}，耗时 ${Date.now() - startedAt}ms）：${truncate(health.detail, 200)}。`,
      }
    }
    if (health.verdict === 'occupied-foreign') {
      const stopped = await stopOurEntry(entry, Math.min(DEFAULT_STOP_TIMEOUT_MS, 5000))
      return failure('occupied-foreign', `启动期间 ${url} 被非 horosa 的进程占了：放弃启动（已尝试停掉自己起的那份：${stopped ? '已停' : '未停'}）。`, { cleanedUp: stopped, guardDetail: truncate(health.detail, 400) })
    }
    if (Date.now() >= deadline) {
      const stopped = await stopOurEntry(entry, Math.min(DEFAULT_STOP_TIMEOUT_MS, 5000))
      return failure(
        'start-timeout',
        `serve 在 ${budget}ms 内没有就绪（最后一次判定 ${lastVerdict}）：已尝试停掉自己起的那份（${stopped ? '已停' : '未停'}）。冷启动预算可用 --selfcheck-timeout 放大。`,
        { cleanedUp: stopped, lastVerdict },
      )
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

/** 停掉登记表里的一份（内部用；startServe 的失败清理路径）。 */
async function stopOurEntry(entry, timeoutMs) {
  if (!entry || !entry.pid) return false
  if (!isAlive(entry.pid)) {
    entry.stopped = true
    return true
  }
  if (process.platform === 'win32') {
    const killed = await taskkillTree(entry.pid, timeoutMs)
    const gone = await waitGone(entry.pid, 2000)
    entry.stopped = gone
    debug('serve', `清理自己起的 serve pid=${entry.pid}：taskkill ${killed.ok ? 'ok' : `fail(${killed.detail})`}，gone=${gone}`)
    return gone
  }
  signalTree(entry, 'SIGTERM')
  let gone = await waitGone(entry.pid, 3000)
  if (!gone) {
    signalTree(entry, 'SIGKILL')
    gone = await waitGone(entry.pid, 2000)
  }
  entry.stopped = gone
  return gone
}

/**
 * 停掉**本模块起过的** horosa serve。绝不抛；也绝不碰不是自己起的 pid。
 * @returns {Promise<{ok:boolean, evidence:object, detail:string}>}
 */
export async function stopServe({ pid, runtimeRoot, dataDir, timeoutMs = DEFAULT_STOP_TIMEOUT_MS } = {}) {
  const numericPid = Number(pid)
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    return {
      ok: true,
      evidence: { pid: pid ?? null, skipped: true, reason: 'no-pid' },
      detail: '没有要停的 serve pid（复用既有实例或没起过）：no-op。',
    }
  }

  const entry = OURS.get(numericPid)
  if (!entry) {
    return {
      ok: false,
      evidence: { pid: numericPid, refused: true, reason: 'not-ours', known: [...OURS.keys()] },
      detail: `pid ${numericPid} 不是本模块起的 serve —— 拒绝 kill（只停自己起的进程；用户桌面版星阙的 9999/8899 碰都不碰）。`,
    }
  }

  const startedAt = Date.now()
  if (!isAlive(numericPid)) {
    entry.stopped = true
    return {
      ok: true,
      evidence: { pid: numericPid, killed: false, alreadyExited: true, port: entry.port, logFile: entry.logFile, elapsedMs: Date.now() - startedAt },
      detail: `pid ${numericPid}（本模块起的 serve，端口 ${entry.port}）已经不在跑了：无需 kill。`,
    }
  }

  const budget = Math.max(1000, Number(timeoutMs) || DEFAULT_STOP_TIMEOUT_MS)
  const errors = []
  let forced = false

  if (process.platform === 'win32') {
    const killed = await taskkillTree(numericPid, budget)
    forced = true
    if (killed.output) debug('serve', `taskkill 输出：${killed.output}`)
    if (!killed.ok) errors.push(killed.detail)
  } else {
    errors.push(...signalTree(entry, 'SIGTERM'))
    const gone = await waitGone(numericPid, Math.min(3000, budget))
    if (!gone) {
      forced = true
      errors.push(...signalTree(entry, 'SIGKILL'))
    }
  }

  const gone = await waitGone(numericPid, budget)
  entry.stopped = gone

  // 「停掉了」不能只看 pid 消失：uvx → uv → python 三层里，父进程死了孙进程仍可能占着端口。
  // 收尾再探一次端口（复用票 04 守卫）：还答 MCP 就是没停干净 —— 不让这个函数说谎。
  let portVerdict
  let portStillServing = false
  if (gone && entry.port) {
    const probe = await checkHorosaPort({ port: entry.port, path: HOROSA_MCP_PATH, timeoutMs: 1500 })
    portVerdict = probe.verdict
    portStillServing = probe.verdict === 'horosa-ready'
  }

  return {
    ok: gone && !portStillServing,
    evidence: {
      pid: numericPid,
      killed: gone,
      force: forced,
      signal: process.platform === 'win32' ? 'taskkill /PID /T /F' : forced ? 'SIGKILL' : 'SIGTERM',
      port: entry.port,
      portVerdict,
      portStillServing,
      logFile: entry.logFile,
      elapsedMs: Date.now() - startedAt,
      error: errors.length ? truncate(errors.join('; '), 400) : undefined,
    },
    detail: !gone
      ? `pid ${numericPid} 在 ${budget}ms 内没有退出：${errors.length ? truncate(errors.join('; '), 200) : '原因未知'}（需要人工看一眼）。`
      : portStillServing
        ? `pid ${numericPid} 已经退出，但 ${entry.port} 上**还有** horosa MCP 在答（${portVerdict}）：多半是自己起的 serve 留下了孙进程（或端口被别人接管了），需要人工确认。`
        : `已停掉自己起的 serve（pid ${numericPid}，端口 ${entry.port}，${process.platform === 'win32' ? 'taskkill /T /F 收树' : forced ? 'SIGTERM 超时后 SIGKILL' : 'SIGTERM'}；收尾复探：${portVerdict ?? '未探'}）。`,
  }
}
