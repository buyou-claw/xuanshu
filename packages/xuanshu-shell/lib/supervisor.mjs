/**
 * packages/xuanshu-shell/lib/supervisor.mjs — 看护 DSH 子进程（ADR-0014 四件事之一）。
 *
 * 状态机（UI / 托盘读的就是它，**不许静默死亡**）：
 *
 *   starting ──认出 URL──▶ ready ──异常退出──▶ restarting ──退避到点──▶ starting
 *      │                      │                    │
 *      └──spawn 失败──────────┴────────────────────┴──▶ failed
 *
 * 停止语义（验收里最贵的一条）：
 *   `stop()` = 先 `SIGTERM` → 等 `stopTimeoutMs` → 还在才 `SIGKILL`。停止期间子进程退出**不排重试**，
 *   否则「退出壳」会顺手拉起一个没人管的孤儿进程。
 *
 * 崩溃兜底：看护对象是子进程；壳自己被硬杀（Task Manager / 断电）时，本进程里的任何清理代码都
 * 没有机会运行 —— 这个真空由注入的 `watchdog`（`lib/watchdog.mjs`）补：它是独立进程，盯壳的 pid，
 * 壳没了就把子进程收掉。`watchdog` 缺省为 null（测试里不需要真起进程），真机由 `main.mjs` 传。
 *
 * 全部依赖注入（`spawn` / `timers` / `watchdog` / `onState`），所以本模块可以在没有真实进程的
 * 机器上单测（ADR-0014:28）。
 *
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

import { buildChildEnv, buildDshInvocation } from './dsh-entry.mjs'
import { createLineScanner, parseReadyUrlLine } from './ready-url.mjs'
import { DEFAULT_PROFILE, DEFAULT_WEB_PORT } from './contract.mjs'

/** 重试节奏默认值：0.5s → 1s → 2s → … 封顶 30s，连续失败 5 次后放弃。 */
export const DEFAULT_RESTART = Object.freeze({ baseMs: 500, maxMs: 30_000, maxAttempts: 5 })

/** 停止时等 SIGTERM 生效的上限；超时才 SIGKILL（契约 §0：force-kill only after timeout）。 */
export const DEFAULT_STOP_TIMEOUT_MS = 5000

/** 空对象兜底。 */
function objectOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/** 有界指数退避：第 1 次 baseMs，第 2 次 2×base，… 封顶 maxMs。 */
export function restartDelay(attempt, { baseMs, maxMs }) {
  const base = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : DEFAULT_RESTART.baseMs
  const cap = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : DEFAULT_RESTART.maxMs
  const exponent = Math.max(0, Math.min(30, Number(attempt) - 1))
  return Math.min(base * (2 ** exponent), cap)
}

/** 一个可外部 resolve 的 promise（stop() 等子进程真退出才回）。 */
function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/**
 * @param {{spawn: Function, entry: object, home: string, profile?: string, port?: number,
 *          nodeBin?: string, baseEnv?: Record<string, string|undefined>, shellPid?: number,
 *          timers?: {setTimeout: Function, clearTimeout: Function},
 *          restart?: {baseMs?: number, maxMs?: number, maxAttempts?: number},
 *          stopTimeoutMs?: number,
 *          onState?: (state: object) => void,
 *          logger?: {debug?: Function, warn?: Function, info?: Function},
 *          watchdog?: {start: Function, stop: Function}|null,
 *          cwd?: string}} options
 */
export function createSupervisor({
  spawn, entry, home, profile = DEFAULT_PROFILE, port = DEFAULT_WEB_PORT, nodeBin,
  baseEnv = {}, shellPid = process.pid,
  timers = { setTimeout, clearTimeout },
  restart = {}, stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
  onState = () => {}, logger = console, watchdog = null, cwd = home,
} = {}) {
  if (typeof spawn !== 'function') throw new Error('createSupervisor needs a spawn function')
  if (typeof home !== 'string' || home === '') throw new Error('createSupervisor needs home')
  if (entry === undefined || entry === null || entry.ok !== true) {
    throw new Error(`createSupervisor needs a resolved DSH entry (got ${JSON.stringify(entry?.reason ?? entry)})`)
  }

  const policy = { ...DEFAULT_RESTART, ...objectOf(restart) }
  const invocation = buildDshInvocation({ entry, profile, port, nodeBin: nodeBin ?? baseEnv?.XUANSHU_NODE_BIN })
  const childEnv = buildChildEnv({ home, shellPid, baseEnv })
  const notifyCap = Number.isInteger(policy.maxAttempts) && policy.maxAttempts > 0
    ? policy.maxAttempts
    : DEFAULT_RESTART.maxAttempts

  /** @type {import('node:child_process').ChildProcess|null} */
  let currentChild = null
  let currentPid
  let scanner = createLineScanner()
  let restartTimer
  let stopTimer
  let stopping = false
  let escalated = false
  let stopDeferred = null
  /** 当前子进程的退出是否已处理（防止 exit 与 error 双触发重复排重试）。 */
  let exitHandled = true
  let state = snapshot({ phase: 'stopped', attempt: 0 })

  function snapshot(patch) {
    const base = {
      phase: 'stopped',
      attempt: 0,
      childPid: undefined,
      url: undefined,
      lastExit: undefined,
      nextRetryMs: undefined,
      detail: undefined,
    }
    const next = { ...base, ...patch }
    // 丢掉 undefined 的键：UI 判空比判 undefined 更容易写错。
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
    return next
  }

  function emit(patch) {
    state = snapshot({ ...state, ...patch })
    try {
      onState(state)
    } catch (error) {
      logger?.warn?.(`[shell] 状态回调抛了异常（已兜住）：${String(error?.message ?? error)}`)
    }
  }

  function clearRestartTimer() {
    if (restartTimer !== undefined) {
      timers.clearTimeout(restartTimer)
      restartTimer = undefined
    }
  }

  function stopWatchdog() {
    try {
      watchdog?.stop()
    } catch (error) {
      logger?.warn?.(`[shell] 收看门狗失败（已兜住）：${String(error?.message ?? error)}`)
    }
  }

  function startWatchdog(childPid) {
    try {
      watchdog?.start({ childPid })
    } catch (error) {
      logger?.warn?.(`[shell] 起看门狗失败（已兜住）：${String(error?.message ?? error)}`)
    }
  }

  /**
   * 启动子进程（首次 / 重试共用）。
   */
  function start() {
    if (stopping) throw new Error('supervisor is stopping; refusing to start the child again')
    if (state.phase === 'starting' || state.phase === 'ready') {
      throw new Error(`supervisor already running (phase=${state.phase}); refusing to start a second child on port ${port}`)
    }
    clearRestartTimer()
    escalated = false
    scanner = createLineScanner()

    let child
    try {
      child = spawn(invocation.command, invocation.args, {
        cwd: cwd ?? home,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        ...(invocation.windowsVerbatimArguments === true ? { windowsVerbatimArguments: true } : {}),
      })
    } catch (error) {
      emit({ phase: 'failed', childPid: undefined, detail: `起不来子进程：${String(error?.message ?? error)}` })
      throw error
    }

    currentChild = child
    currentPid = child.pid
    exitHandled = false
    emit({ phase: 'starting', childPid: child.pid, url: undefined, nextRetryMs: undefined, detail: undefined })
    startWatchdog(child.pid)

    child.stdout?.on('data', (chunk) => {
      for (const line of scanner.push(chunk)) {
        if (state.phase !== 'starting') return
        const url = parseReadyUrlLine(line)
        if (url !== null) {
          // 就绪后把重试计数归零：长期运行中的偶发崩溃不该消耗掉启动期的重试预算。
          emit({ phase: 'ready', url, attempt: 0, lastExit: undefined, nextRetryMs: undefined, detail: undefined })
          return
        }
        if (String(line).trim() !== '') logger?.debug?.(`[dsh] ${String(line).slice(0, 300)}`)
      }
    })
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text !== '') logger?.debug?.(`[dsh:stderr] ${text.slice(0, 300)}`)
    })

    child.once('error', (error) => {
      if (exitHandled || child !== currentChild) return
      exitHandled = true
      // 命令找不到这类错误重试也没用：如实 failed，别把「环境缺 node」伪装成「服务正在恢复」。
      stopWatchdog()
      currentChild = null
      clearRestartTimer()
      emit({
        phase: 'failed',
        childPid: undefined,
        url: undefined,
        detail: `子进程起不来：${String(error?.message ?? error)}`,
      })
    })

    child.once('exit', (code, signal) => {
      if (exitHandled || child !== currentChild) return
      exitHandled = true
      stopWatchdog()
      currentChild = null
      if (stopping) {
        finishStop({ code, signal })
        return
      }
      const lastExit = { code: code ?? null, signal: signal ?? null }
      logger?.warn?.(`[shell] DSH 子进程退出（code=${String(code)} signal=${String(signal)}），准备重拉`)
      scheduleRestart(lastExit)
    })
  }

  /** 按有界退避排下一次启动；连续失败达到 maxAttempts → failed。 */
  function scheduleRestart(lastExit) {
    const nextAttempt = state.attempt + 1
    if (nextAttempt >= notifyCap) {
      emit({
        phase: 'failed',
        attempt: nextAttempt,
        childPid: undefined,
        url: undefined,
        lastExit,
        nextRetryMs: undefined,
        detail: `连续 ${nextAttempt} 次启动失败，已停止重拉：code=${String(lastExit.code)} signal=${String(lastExit.signal)}`,
      })
      return
    }
    const delay = restartDelay(nextAttempt, policy)
    emit({ phase: 'restarting', attempt: nextAttempt, childPid: undefined, url: undefined, lastExit, nextRetryMs: delay, detail: undefined })
    restartTimer = timers.setTimeout(() => {
      restartTimer = undefined
      if (stopping) return
      try {
        start()
      } catch (error) {
        emit({ phase: 'failed', detail: `重拉失败：${String(error?.message ?? error)}` })
      }
    }, delay)
  }

  /** 停止完成（子进程已退出 / 本来就没有）。 */
  function finishStop({ forced = escalated } = {}) {
    if (stopTimer !== undefined) {
      timers.clearTimeout(stopTimer)
      stopTimer = undefined
    }
    clearRestartTimer()
    stopWatchdog()
    currentChild = null
    currentPid = undefined
    stopping = false
    escalated = false
    emit({ phase: 'stopped', childPid: undefined, url: undefined, nextRetryMs: undefined, lastExit: undefined, detail: undefined })
    const pending = stopDeferred
    stopDeferred = null
    if (pending !== null) pending.resolve({ stopped: true, drained: false, forced })
  }

  /**
   * 停止子进程：SIGTERM → 等 stopTimeoutMs → 还在才 SIGKILL。
   * @returns {Promise<{stopped: true, drained: boolean, forced: boolean}>}
   */
  function stop() {
    if (stopDeferred !== null) return stopDeferred.promise
    stopping = true

    const child = currentChild
    if (child === null) {
      // 没有子进程：正在等重试 / 已失败 / 已停止 —— 取消计时器即可。
      finishStop({ forced: false })
      return Promise.resolve({ stopped: true, drained: true, forced: false })
    }

    stopDeferred = deferred()
    const { promise } = stopDeferred
    // 先挂超时升级，再发 SIGTERM：kill 是同步的，子进程可能在 kill 返回前就 emit exit。
    stopTimer = timers.setTimeout(() => {
      stopTimer = undefined
      if (currentChild !== child) return
      escalated = true
      logger?.warn?.(`[shell] 子进程 ${child.pid} 在 ${stopTimeoutMs}ms 内没退出，SIGKILL`)
      try {
        child.kill('SIGKILL')
      } catch (error) {
        logger?.warn?.(`[shell] SIGKILL 失败（已兜住）：${String(error?.message ?? error)}`)
      }
    }, stopTimeoutMs)

    try {
      child.kill('SIGTERM')
    } catch (error) {
      logger?.warn?.(`[shell] SIGTERM 失败（已兜住）：${String(error?.message ?? error)}`)
    }
    if (child.exited === true && currentChild === child) {
      // 替身 / 已退出的进程不会替我们发 exit 事件：直接收尾。
      finishStop({ forced: false })
    }
    return promise
  }

  /**
   * 同步兜底（只在 `process.on('exit')` / 未捕获异常这类**没有 await 机会**的地方用）：
   * 发 SIGTERM、停看门狗、取消重试；不等子进程真退出。
   */
  function killNow() {
    stopping = true
    clearRestartTimer()
    const child = currentChild
    currentChild = null
    currentPid = undefined
    stopWatchdog()
    try {
      child?.kill?.('SIGTERM')
    } catch (error) {
      logger?.warn?.(`[shell] 退出兜底 SIGTERM 失败（已兜住）：${String(error?.message ?? error)}`)
    }
    emit({ phase: 'stopped', childPid: undefined, url: undefined, detail: '壳正在退出（同步兜底）' })
  }

  return {
    start,
    stop,
    killNow,
    getState: () => state,
    /** 排障用：这次要跑的命令行（不含 env 里的敏感值）。 */
    getInvocation: () => ({ ...invocation, env: { ...childEnv } }),
    /** 当前子进程 pid（没有则 undefined）。 */
    get childPid() {
      return currentPid
    },
  }
}
