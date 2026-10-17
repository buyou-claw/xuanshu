/**
 * packages/xuanshu-host/lib/horosa/serve.mjs
 *
 * 宿主托管的 horosa serve 生命周期（票 06 契约 §3.1 冻结签名 + §3.2 R3/R4/R5/R6）：
 *   startHorosaServe({ wheel, uvxBin, runtimeRoot, dataDir, host, port, logFile, timeoutMs, env })
 *     -> { ok, started, pid, verdict, evidence, detail }   // 已在跑 → started:false 且 pid:null
 *   stopHorosaServe({ pid, timeoutMs, sync }) -> { ok, evidence, detail }
 *   ownsServe(pid) -> boolean                              // 只认自己起的
 *
 * 起 serve 的命令（契约 §3.2 R3）：
 *   <uvxBin> --from <wheel> horosa-skill serve --host 127.0.0.1 --port <port>
 * 子进程 env 追加四个上游认的变量：`HOROSA_RUNTIME_ROOT` / `HOROSA_SKILL_DATA_DIR` /
 * `HOROSA_SKILL_HOST` / `HOROSA_SKILL_PORT`（与命令行保持一致）。
 *
 * 四条硬约束（都能在测试里被外部观察到）：
 *   R3 日志落 **fd**（`<dataDir>/serve.log`）：不给子进程留管道 —— 父进程退出/被丢下时，
 *      断掉的 stdout 管道会让 Python logging 撞 BrokenPipe 把 serve 打挂（票 05 踩过的坑）。
 *   R4 端口四态（**复用 ticket 04 的词表**，由 P1 parity 钉住）：`free` → 起；
 *      `horosa-ready` → 复用（不新起第二个实例）；`occupied-foreign` / `probe-failed` → **拒绝启动**。
 *      「无法判定 ≠ 被占」，两态都 fail-closed；**绝不 kill 不是自己起的进程**
 *      （上游明令 `:9999`/`:8899` 是用户桌面版星阙的端口，永不触碰）。
 *   R5 只停自己起的：本模块在**本进程内**维护 spawn 登记表（pid → entry），`stopHorosaServe`
 *      对表外 pid 一律 `ok:false` 拒绝（哪怕调用方明确要求）。收进程树 Windows 用
 *      `taskkill /PID <pid> /T /F`（uvx → uv → python 三层，只有 /T 收得全）；POSIX 进程组
 *      SIGTERM → SIGKILL。
 *   R6 回环门：`host` 不是回环字面量 → `code:'non-loopback-host'`，不 spawn；
 *      spawn 的 `--host` **恒为 127.0.0.1**。
 *
 * 「就绪」的判据是 **MCP 握手**（契约 §3.3）：四态探针说 `horosa-ready` **且**
 * `mcpInitialize` 200 + 响应头 `mcp-session-id`（票 05 口径，不看四柱）。
 *
 * Windows spawn 的三种形状（照抄 `scripts/horosa/serve-lifecycle.mjs::buildSpawnPlan`，
 * 裸名多做一步 PATH 解析 —— 实测 `spawn('uvx')` 只命中 PATH 上的 `uvx.exe`，命中不了
 * `uvx.cmd`（EINVAL）/`uvx.mjs`（EFTYPE），而本地断言台的假 uvx 正是这两种形状）：
 *   ① `.mjs`/`.cjs`/`.js` → `spawn(process.execPath, [bin, ...args])`；
 *   ② `.cmd`/`.bat` → `cmd /d /s /c "<line>"` + `windowsVerbatimArguments: true`（自己管引号）；
 *   ③ 其余 → 直起（裸名先按 PATH + PATHEXT 解析成绝对路径）。
 *
 * 只用 Node 内置模块；**绝不抛**（一切失败折算成 `{ ok:false, ... }`）。
 */

import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { HOROSA_DEFAULT_HOST, HOROSA_DEFAULT_PORT, HOROSA_MCP_PATH, HOROSA_SERVE_LOG_FILENAME } from './constants.mjs'
import { checkHorosaEndpoint, mcpInitialize } from './guard.mjs'
import { loopbackHost } from './paths.mjs'

/** 起 serve 的默认预算：首启 runtime（Java + chart + Node）冷启动可以到几分钟。 */
const DEFAULT_START_TIMEOUT_MS = 180_000
/** stop 的默认预算：taskkill /T /F 或 SIGTERM→SIGKILL 都在这个窗内收口。 */
const DEFAULT_STOP_TIMEOUT_MS = 20_000
/** 就绪轮询间隔。 */
const POLL_INTERVAL_MS = 700
/** 每轮四态探针的预算（守卫自带超时，取小值让轮询有节奏）。 */
const PROBE_BUDGET_MS = 2000
/** 每轮 MCP 握手（initialize → notifications/initialized）的预算。 */
const HANDSHAKE_BUDGET_MS = 4000
/** evidence 里的日志尾巴上限（证据 ≤2KB/项）。 */
const LOG_TAIL_LIMIT = 1024

/**
 * 本进程 spawn 过的 serve 登记表（**唯一**的 kill 授权来源）。
 * 条目即使已退出也保留：`stopHorosaServe` 靠它区分「我起的、已经死了」（ok:true）与
 * 「不是我的」（ok:false 拒绝）。
 */
const OURS = new Map()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)))
}

/** 把任意异常折算成一行可读文本。 */
function errorMessage(error) {
  if (error === null || error === undefined) return 'unknown error'
  if (typeof error === 'string') return error
  return error.message || error.code || String(error)
}

/** 截断（evidence 只放小体积关键字段）。 */
function truncate(value, limit = 2048) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  return text.length > limit ? `${text.slice(0, limit)}…(${text.length - limit} more)` : text
}

/**
 * 解码子进程输出字节：先按 utf8 解，出现替换字符再试 gbk（Windows 中文控制台是 cp936）。
 * 与 `scripts/horosa/shared.mjs::decodeConsole` 同口径（日志尾巴是给人看的，不值得为它引依赖）。
 */
function decodeConsole(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])
  const utf8 = bytes.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    const gbk = new TextDecoder('gbk').decode(bytes)
    if (!gbk.includes('\uFFFD')) return gbk
  } catch {
    /* 该 ICU 没有 gbk：退回 utf8 结果 */
  }
  return utf8
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
function readTail(file, limit = LOG_TAIL_LIMIT) {
  if (!file) return ''
  let fd
  try {
    fd = openSync(file, 'r')
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

/* ------------------------------------------------------------------ *
 * spawn 计划（Windows 三种形状）
 * ------------------------------------------------------------------ */

/** 逐元素给 Windows 命令行加引号（`cmd /c` 那一条路径用）。 */
function quoteWindowsArg(value) {
  const text = String(value)
  if (text.length > 0 && !/[\s"&|<>^()%!]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * 裸名（不含路径分隔符）在 Windows 上的候选扩展名：`''` + `PATHEXT` + `.mjs/.js/.cjs`。
 * 为什么往 PATHEXT 之外再试脚本扩展：本地断言台的假 uvx 是 `uvx.mjs`/`uvx.cmd` 形状，
 * 而 libuv 只认可执行映像（实测裸 `uvx` 命中不了 `.cmd`/`.mjs`）。真机 `uvx.exe` 走 PATHEXT。
 */
function windowsCandidates(bin, env) {
  const pathext = String((env && (env.PATHEXT || env.Pathext)) || '.COM;.EXE;.BAT;.CMD')
  const exts = pathext
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean)
  return ['', ...exts, '.MJS', '.JS', '.CJS'].map((ext) => `${bin}${ext}`)
}

/** 裸名解析：按 PATH 逐目录 × 候选扩展名找第一个存在的**文件**；找不到就原样返回（让 spawn 报真错误）。 */
function resolveBinPath(bin, env, platform) {
  const raw = String(bin ?? '')
  if (raw === '') return raw
  if (raw.includes('/') || raw.includes('\\')) return raw
  if (platform !== 'win32') return raw // POSIX：exec 自己按 PATH + shebang 解析
  const dirs = String((env && (env.PATH || env.Path)) || '')
    .split(';')
    .map((dir) => dir.trim())
    .filter(Boolean)
  for (const dir of dirs) {
    for (const candidate of windowsCandidates(raw, env)) {
      const file = join(dir, candidate)
      try {
        if (existsSync(file) && statSync(file).isFile()) return file
      } catch {
        /* 权限/竞态：试下一个候选 */
      }
    }
  }
  return raw
}

/** 拼 spawn 计划（形状见文件头三种情形）。 */
function buildSpawnPlan(bin, args, env) {
  const resolved = resolveBinPath(bin, env, process.platform)
  if (/\.(mjs|cjs|js)$/i.test(resolved)) {
    return { command: process.execPath, args: [resolved, ...args], verbatim: false, resolved }
  }
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    const comspec = (env && (env.ComSpec || env.COMSPEC)) || 'cmd.exe'
    const line = [resolved, ...args].map(quoteWindowsArg).join(' ')
    return { command: comspec, args: ['/d', '/s', '/c', `"${line}"`], verbatim: true, resolved }
  }
  return { command: resolved, args, verbatim: false, resolved }
}

/* ------------------------------------------------------------------ *
 * 收进程树
 * ------------------------------------------------------------------ */

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

/** 停掉登记表里的一份（内部用；startHorosaServe 的失败清理路径）。 */
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

/* ------------------------------------------------------------------ *
 * 冻结接口
 * ------------------------------------------------------------------ */

/**
 * 起 horosa serve（端口上已经有 horosa MCP 就复用）。**绝不抛**。
 *
 * **`verdict` 的语义（口径冻结；T3 的 P7 就是按它写的）**：`verdict` = 「**进门那一刻**的四态裁决」，
 * 即「这次调用凭什么做决定」，**不是**起完之后端口的回升状态：
 *   - 成功**新起**：`'free'`（进门那一刻端口空着，所以才起了一份）；**起完之后**的状态在
 *     `evidence.verdict`（= `'horosa-ready'`），握手细节在 `evidence.handshake`。
 *   - **复用**：`'horosa-ready'`（进门那一刻端口上已有 horosa MCP 在答，`started:false`、`pid:null`）。
 *   - **拒绝**：`'occupied-foreign'` / `'probe-failed'`（配合 `evidence.hint`）；
 *     非回环配置连探都不探：`'non-loopback-host'`（同时带顶层 `code:'non-loopback-host'`）。
 * 「就绪」的判据是 **MCP 握手**（`initialize` 200 且带回响应头 `mcp-session-id`），不是「进程起来了」。
 *
 * @param {object} [options]
 * @param {string} [options.wheel]        已校验的 wheel 路径（`uvx --from <wheel>`）
 * @param {string} [options.uvxBin]       uvx 可执行文件（缺省 `uvx.exe`(win32) / `uvx`；`XUANSHU_UVX_BIN` 由 plan 层注入）
 * @param {string} [options.runtimeRoot]  `HOROSA_RUNTIME_ROOT`
 * @param {string} [options.dataDir]      `HOROSA_SKILL_DATA_DIR`（logFile 默认落在它下面）
 * @param {string} [options.host]         只收回环字面量（R6）
 * @param {number} [options.port]         缺省 = `constants.mjs` 的 `HOROSA_DEFAULT_PORT`（唯一来源）
 * @param {string} [options.logFile]      serve 日志落点，默认 `<dataDir>/serve.log`
 * @param {number} [options.timeoutMs]    等到「MCP 真答」的总预算，默认 180000
 * @param {object} [options.env]          追加/覆盖给子进程的环境变量
 * @returns {Promise<{ok:boolean,started:boolean,pid:number|null,verdict:string,evidence:object,detail:string}>}
 */
export async function startHorosaServe({ wheel, uvxBin, runtimeRoot, dataDir, host, port, logFile, timeoutMs, env } = {}) {
  const numericPort = Number(port ?? HOROSA_DEFAULT_PORT)
  const budget = Math.max(1, Number(timeoutMs) || DEFAULT_START_TIMEOUT_MS)
  const extraEnv = env && typeof env === 'object' ? env : {}
  const url = `http://${HOROSA_DEFAULT_HOST}:${numericPort}${HOROSA_MCP_PATH}`

  /* ---------- 门 0：回环（R6） ---------- */
  const configuredHost = host === undefined || host === null || host === '' ? HOROSA_DEFAULT_HOST : String(host)
  if (loopbackHost(configuredHost) === null) {
    return {
      ok: false,
      started: false,
      pid: null,
      verdict: 'non-loopback-host',
      code: 'non-loopback-host',
      evidence: { reason: 'non-loopback-host', configuredHost, url, port: numericPort },
      detail: `host=${configuredHost} 不是回环字面量：拒绝起 serve（契约 R6「非回环不暴露」）。`,
    }
  }

  /* ---------- 门 1：端口合法性 ---------- */
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    return {
      ok: false,
      started: false,
      pid: null,
      verdict: 'probe-failed',
      evidence: { reason: 'invalid-port', port: Number(port), url },
      detail: `端口非法（${String(port)}）：起 serve 前就停手。`,
    }
  }

  /* ---------- 门 2：端口四态（R4；复用同一套词表） ---------- */
  const first = await checkHorosaEndpoint({ host: HOROSA_DEFAULT_HOST, port: numericPort, path: HOROSA_MCP_PATH, timeoutMs: Math.min(PROBE_BUDGET_MS, budget) })

  if (first.verdict === 'horosa-ready') {
    return {
      ok: true,
      started: false,
      pid: null,
      verdict: first.verdict,
      evidence: { reason: 'already-running', verdict: first.verdict, url, port: numericPort, sessionId: first.sessionId, logTail: truncate(readTail(logFile || (dataDir ? join(dataDir, HOROSA_SERVE_LOG_FILENAME) : null)), LOG_TAIL_LIMIT) },
      detail: `${url} 上已经有 horosa MCP 在答（${first.detail}）：复用，不新起第二个实例。`,
    }
  }
  if (first.verdict === 'occupied-foreign') {
    return {
      ok: false,
      started: false,
      pid: null,
      verdict: first.verdict,
      evidence: { reason: 'occupied-foreign', verdict: first.verdict, port: numericPort, url, guardDetail: truncate(first.detail, 500), hint: first.hint ?? null },
      detail: `拒绝启动：${truncate(first.detail, 300)} —— 绝不 kill 不是自己起的进程，也不去改环境。`,
    }
  }
  if (first.verdict === 'probe-failed') {
    return {
      ok: false,
      started: false,
      pid: null,
      verdict: first.verdict,
      evidence: { reason: 'probe-failed', verdict: first.verdict, port: numericPort, url, guardDetail: truncate(first.detail, 500), hint: first.hint ?? null },
      detail: `拒绝启动（fail-closed）：${truncate(first.detail, 300)} —— 无法判定 ≠ 被占，但状态未知时不起第二个实例。`,
    }
  }

  /* ---------- 门 3：命令能拼出来 ---------- */
  if (typeof wheel !== 'string' || wheel.trim() === '') {
    return {
      ok: false,
      started: false,
      pid: null,
      verdict: first.verdict,
      evidence: { reason: 'missing-wheel', verdict: first.verdict, port: numericPort, url },
      detail: '缺 wheel 路径：`uvx --from <wheel>` 拼不出命令（离线场景用 config.wheel / `XUANSHU_HOROSA_WHEEL` 指定已校验的本地 wheel）。',
    }
  }

  const bin = String(uvxBin || extraEnv.XUANSHU_UVX_BIN || process.env.XUANSHU_UVX_BIN || (process.platform === 'win32' ? 'uvx.exe' : 'uvx'))
  const args = ['--from', wheel, 'horosa-skill', 'serve', '--host', HOROSA_DEFAULT_HOST, '--port', String(numericPort)]
  const command = `${bin} ${args.join(' ')}`
  const target = logFile || (dataDir ? join(dataDir, HOROSA_SERVE_LOG_FILENAME) : null)

  const childEnv = { ...process.env, ...extraEnv }
  if (runtimeRoot) childEnv.HOROSA_RUNTIME_ROOT = String(runtimeRoot)
  if (dataDir) childEnv.HOROSA_SKILL_DATA_DIR = String(dataDir)
  childEnv.HOROSA_SKILL_HOST = HOROSA_DEFAULT_HOST
  childEnv.HOROSA_SKILL_PORT = String(numericPort)

  /* ---------- 门 4：日志落点（fd，不给子进程留管道） ---------- */
  let logFd
  let logError
  if (target) {
    try {
      mkdirSync(dirname(target), { recursive: true })
      logFd = openSync(target, 'a')
    } catch (error) {
      logError = `打不开日志文件（${errorMessage(error)}）：${target}`
    }
  }

  /* ---------- 起进程 ---------- */
  const plan = buildSpawnPlan(bin, args, childEnv)
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
      verdict: first.verdict,
      evidence: { reason: 'spawn-failed', command, resolvedBin: plan.resolved, url, port: numericPort, error: errorMessage(error), spawnedPid: null, cleanedUp: true },
      detail: `spawn 失败（${errorMessage(error)}）："${command}" 起不来（uvx 缺失时可用 XUANSHU_UVX_BIN 覆盖）。`,
    }
  }
  if (logFd !== undefined) {
    // 子进程已经拿到这份 fd（继承的 dup），父进程这份可以关掉：dispose 后子进程仍能写日志。
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
    host: HOROSA_DEFAULT_HOST,
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

  /**
   * 起 serve 的失败返回（**已经 spawn 出进程**的那几条路径）。
   *
   * `cleanedUp` 是给调用方的**收尾契约**：`true` = 这一轮起的进程已经被收干净（或本来就没起来），
   * `false` = **pid 还活着**（清理没成功：taskkill 起不来/超时、进程赖着不退…）。
   * 后者必须把 pid 带出去（顶层 `pid` + `evidence.spawnedPid`），调用方要把它落进状态，
   * 否则 dispose 再也收不到它 —— 8765 上留一个我们自己起的孤儿（R5 的漏水口）。
   */
  const failure = (reason, detail, extra = {}) => ({
    ok: false,
    started: true,
    pid: entry.pid,
    verdict: extra.lastVerdict ?? first.verdict,
    evidence: {
      reason,
      command,
      resolvedBin: plan.resolved,
      url,
      port: numericPort,
      logFile: target ?? null,
      logError,
      elapsedMs: Date.now() - startedAt,
      exit: exited,
      logTail: truncate(readTail(target), LOG_TAIL_LIMIT),
      spawnedPid: entry.pid,
      cleanedUp: extra.cleanedUp === true,
      ...extra,
    },
    detail,
  })

  /* ---------- 等就绪：ENOENT（uvx 不在 PATH）在 spawn 之后几个 tick 才报上来 ---------- */
  const lateError = await Promise.race([spawnFailed, sleep(120).then(() => null)])
  if (lateError) {
    return {
      ok: false,
      started: false,
      pid: null,
      verdict: first.verdict,
      evidence: {
        reason: 'spawn-failed',
        command,
        resolvedBin: plan.resolved,
        url,
        port: numericPort,
        error: errorMessage(lateError),
        logFile: target ?? null,
        logError,
        spawnedPid: null,
        cleanedUp: true, // 进程根本没起来：没有要收的东西
      },
      detail: `spawn 失败（${errorMessage(lateError)}）："${command}" 起不来（uvx 缺失时可用 XUANSHU_UVX_BIN 覆盖）。`,
    }
  }

  /* ---------- 等就绪：四态探针 + MCP 握手（契约 §3.3 的判据） ---------- */
  const deadline = startedAt + budget
  let lastVerdict = first.verdict
  for (;;) {
    if (exited) {
      const stopped = await stopOurEntry(entry, Math.min(DEFAULT_STOP_TIMEOUT_MS, 5000))
      return failure(
        'child-exited',
        `serve 进程提前退出了（exit code ${exited.code ?? '-'}${exited.signal ? `, signal ${exited.signal}` : ''}）：见日志 ${target ?? '(未落盘)'}${stopped ? '' : '（未能确认已停）'}。`,
        { cleanedUp: stopped, lastVerdict },
      )
    }
    if (spawnError) return failure('spawn-failed', `spawn 失败（${errorMessage(spawnError)}）。`, { cleanedUp: false, lastVerdict })

    const health = await checkHorosaEndpoint({ host: HOROSA_DEFAULT_HOST, port: numericPort, path: HOROSA_MCP_PATH, timeoutMs: PROBE_BUDGET_MS })
    lastVerdict = health.verdict
    if (health.verdict === 'horosa-ready') {
      const handshake = await mcpInitialize({ host: HOROSA_DEFAULT_HOST, port: numericPort, path: HOROSA_MCP_PATH, timeoutMs: HANDSHAKE_BUDGET_MS })
      if (handshake.ok) {
        return {
          ok: true,
          started: true,
          pid: entry.pid,
          // 成功态的 `verdict` 是**进门那一探**的裁决（`free` —— 因此才起了一份新的），
          // 不是起完之后的 `horosa-ready`：调用方拿它就能回答「这次是起了还是复用了」。
          // 起完之后的端口状态在 `evidence.verdict` 里（= horosa-ready）。
          verdict: first.verdict,
          evidence: {
            reason: 'started',
            verdict: health.verdict,
            url,
            port: numericPort,
            pid: entry.pid,
            readyMs: Date.now() - startedAt,
            command,
            resolvedBin: plan.resolved,
            logFile: target ?? null,
            logError,
            sessionId: handshake.sessionId,
            serverInfo: handshake.serverInfo,
            handshake: { ok: handshake.ok, status: handshake.status, sessionId: handshake.sessionId, serverInfo: handshake.serverInfo },
            logTail: truncate(readTail(target), LOG_TAIL_LIMIT),
          },
          detail: `serve 已就绪（${url}，pid ${entry.pid}，耗时 ${Date.now() - startedAt}ms）：${truncate(health.detail, 200)} MCP 握手成立（mcp-session-id=${handshake.sessionId ?? '?'}）。`,
        }
      }
      // 端口像 horosa 但握手不成立：记着继续轮询（冷启动期可能还没完全起来），不在这里判死。
      lastVerdict = 'horosa-ready'
    }
    if (health.verdict === 'occupied-foreign') {
      const stopped = await stopOurEntry(entry, Math.min(DEFAULT_STOP_TIMEOUT_MS, 5000))
      return failure('occupied-foreign', `启动期间 ${url} 被非 horosa 的进程占了：放弃启动（已尝试停掉自己起的那份：${stopped ? '已停' : '未停'}）。`, { cleanedUp: stopped, guardDetail: truncate(health.detail, 400), lastVerdict })
    }
    if (Date.now() >= deadline) {
      const stopped = await stopOurEntry(entry, Math.min(DEFAULT_STOP_TIMEOUT_MS, 5000))
      return failure(
        'start-timeout',
        `serve 在 ${budget}ms 内没有就绪（最后一次判定 ${lastVerdict}）：已尝试停掉自己起的那份（${stopped ? '已停' : '未停'}）。冷启动慢时把 config.startupWaitMs 调大。`,
        { cleanedUp: stopped },
      )
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

/**
 * 停掉**本模块起过的** horosa serve。绝不抛；也绝不碰不是自己起的 pid（R5）。
 *
 * `sync: true` 走同步收口（spawnSync/kill，不回探端口）：给 cordis dispose 用 ——
 * dispose 路径上不能等一个 20 秒的网络回探，而「进程树已经收到 kill」这个事实已经足够。
 *
 * @returns {Promise<{ok:boolean,evidence:object,detail:string}>}
 */
export async function stopHorosaServe({ pid, timeoutMs = DEFAULT_STOP_TIMEOUT_MS, sync = false } = {}) {
  const numericPid = Number(pid)
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    return { ok: true, evidence: { pid: pid ?? null, skipped: true, reason: 'no-pid' }, detail: '没有要停的 serve pid（复用既有实例或没起过）：no-op。' }
  }

  const entry = OURS.get(numericPid)
  if (!entry) {
    return {
      ok: false,
      evidence: { pid: numericPid, refused: true, reason: 'not-ours', known: [...OURS.keys()] },
      detail: `pid ${numericPid} 不是本模块起的 serve —— 拒绝 kill（只停自己起的进程；用户桌面版星阙的端口碰都不碰）。`,
    }
  }

  const startedAt = Date.now()

  /* ---------- 同步收口（dispose 用） ---------- */
  if (sync === true) {
    let ok
    let signal
    let output = ''
    if (process.platform === 'win32') {
      signal = 'taskkill /PID /T /F'
      try {
        const result = spawnSync('taskkill', ['/PID', String(numericPid), '/T', '/F'], { windowsHide: true, encoding: 'buffer' })
        output = decodeConsole(result.stdout ?? Buffer.alloc(0)) + decodeConsole(result.stderr ?? Buffer.alloc(0))
        ok = result.status === 0
      } catch (error) {
        ok = false
        output = errorMessage(error)
      }
    } else {
      signal = 'SIGTERM'
      const errors = signalTree(entry, 'SIGTERM')
      ok = errors.length === 0
      output = errors.join('; ')
    }
    entry.stopped = true
    return {
      ok,
      evidence: { pid: numericPid, sync: true, signal, port: entry.port, logFile: entry.logFile, elapsedMs: Date.now() - startedAt, output: truncate(output, 400) },
      detail: ok
        ? `已同步停掉自己起的 serve（pid ${numericPid}，端口 ${entry.port}，${signal}）。`
        : `同步停 pid ${numericPid} 时有问题：${truncate(output, 200) || '未确认'}（dispose 不等回探，下次启动前会再探一次端口）。`,
    }
  }

  /* ---------- 异步收口 ---------- */
  if (!isAlive(numericPid)) {
    entry.stopped = true
    // 早退也必须看端口：**父进程先退出、孙进程继续占着端口**是真实存在的形状
    // （uvx.exe 收工后 python serve 仍在监听）——只看 pid 就会报一个假的「已停干净」。
    let portVerdict
    let portStillServing = false
    if (entry.port) {
      const probe = await checkHorosaEndpoint({ host: HOROSA_DEFAULT_HOST, port: entry.port, path: HOROSA_MCP_PATH, timeoutMs: 1500 })
      portVerdict = probe.verdict
      portStillServing = probe.verdict === 'horosa-ready'
    }
    return {
      ok: !portStillServing,
      evidence: { pid: numericPid, killed: false, alreadyExited: true, port: entry.port, portVerdict, portStillServing, logFile: entry.logFile, elapsedMs: Date.now() - startedAt },
      detail: portStillServing
        ? `pid ${numericPid} 已经不在，但端口 ${entry.port} 上**还有** horosa 在答（${portVerdict}）：多半是它留下的孙进程（父进程先退了，进程树根没了就收不动）—— 用 \`netstat -ano | findstr :${entry.port}\` 认领 PID 后人工收掉。`
        : `pid ${numericPid}（本模块起的 serve，端口 ${entry.port}）已经不在跑了：无需 kill。`,
    }
  }

  const budget = Math.max(1000, Number(timeoutMs) || DEFAULT_STOP_TIMEOUT_MS)
  const errors = []
  let forced = false

  if (process.platform === 'win32') {
    const killed = await taskkillTree(numericPid, budget)
    forced = true
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

  // 「停掉了」不能只看 pid 消失：uvx → uv → python 三层里父进程死了孙进程仍可能占着端口。
  // 收尾再探一次端口（复用同一套四态）：还答 MCP 就是没停干净 —— 不让这个函数说谎。
  let portVerdict
  let portStillServing = false
  if (gone && entry.port) {
    const probe = await checkHorosaEndpoint({ host: HOROSA_DEFAULT_HOST, port: entry.port, path: HOROSA_MCP_PATH, timeoutMs: 1500 })
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
        ? `pid ${numericPid} 已经退出，但端口 ${entry.port} 上**还有** horosa MCP 在答（${portVerdict}）：多半是自己起的 serve 留下了孙进程（或端口被别人接管），需要人工确认。`
        : `已停掉自己起的 serve（pid ${numericPid}，端口 ${entry.port}，${process.platform === 'win32' ? 'taskkill /T /F 收树' : forced ? 'SIGTERM 超时后 SIGKILL' : 'SIGTERM'}；收尾复探：${portVerdict ?? '未探'}）。`,
  }
}

/**
 * 这个 pid 是不是**本模块起过、且还没被停掉**的（登记表里有 + 还没收过就算）。
 *
 * 为什么停过之后要返回 false：pid 会被 OS 回收，下一次它可能属于**别人的**进程；
 * 如果 `ownsServe` 还认这个号，`stopHorosaServe` 就会对着一个新进程动手 —— R5 最重的那条底线。
 * （条目本身留在登记表里，好让 `stopHorosaServe` 能区分「我的、已经死了」与「不是我的」。）
 * @returns {boolean}
 */
export function ownsServe(pid) {
  const numericPid = Number(pid)
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false
  const entry = OURS.get(numericPid)
  if (!entry) return false
  return entry.stopped !== true
}

/**
 * 本模块起过、**还没收掉**的全部 pid（登记表的授权视图）。
 *
 * 给收尾路径兜底用：`startHorosaServe` 失败时如果清理没成功（`evidence.cleanedUp === false`），
 * 调用方即使**忘了**把 pid 落进自己的状态，这里也还认得它 —— `stop()`/`dispose()` 取
 * 「自己的状态 ∪ 本函数」的并集就不会留孤儿（R5）。返回值升序、去重、只含正整数。
 * @returns {number[]}
 */
export function ownedServePids() {
  const pids = new Set()
  for (const [pid, entry] of OURS.entries()) {
    if (entry && entry.stopped !== true && Number.isInteger(pid) && pid > 0) pids.add(pid)
  }
  return [...pids].sort((a, b) => a - b)
}
