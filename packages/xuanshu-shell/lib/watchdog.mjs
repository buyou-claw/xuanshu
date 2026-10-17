/**
 * packages/xuanshu-shell/lib/watchdog.mjs — 壳被硬杀时收掉 DSH 子进程的**独立进程**。
 *
 * 为什么需要它（诚实说明边界）：壳正常退出走 `before-quit → supervisor.stop()`；壳进程内的
 * `process.on('exit')` 只能兜住「还能跑 JS」的异常。任务管理器结束进程 / 断电 / 被 SIGKILL 时，
 * 壳里**没有任何代码有机会运行** —— 那时唯一还在跑的是这个独立 node 进程：
 *   - 它盯壳的 pid：壳没了 → 给 DSH 子进程发 SIGTERM，超时还在就 SIGKILL，然后自己退出；
 *   - 子进程先没了 → 它自己也退出（不常驻一个空转进程）。
 *
 * 已知限制（写进 runbook，不许含糊）：
 *   - 看门狗自己也可能被一并杀掉（例如按进程树结束）；它只是把「硬杀壳」这一类的漏网概率降到很低；
 *   - Windows 上 `process.kill(pid, 0)` 对已退出但句柄仍被持有的 pid 可能短暂返回「活着」；
 *   - pid 复用：看门狗只对**记录的 childPid** 发信号，且只在「它是活的」时发；极端情况下可能误伤
 *     一个复用了该 pid 的无关进程（窗口极小；DSH 子进程与壳同时在跑，pid 不会在被杀前后立刻复用）。
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** 默认心跳：1s 看一次（够快，也不至于让空闲看门狗占 CPU）。 */
export const DEFAULT_INTERVAL_MS = 1000

/** 默认升级窗口：SIGTERM 后 3s 还在才 SIGKILL。 */
export const DEFAULT_KILL_AFTER_MS = 3000

/** 默认存活判据：`kill(pid, 0)`；EPERM = 进程存在但没权限 → 仍算活着。 */
export function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** 默认发信号。 */
export function defaultKill(pid, signal) {
  process.kill(pid, signal)
}

/**
 * 看门狗状态机（纯逻辑 + 注入的计时器 / 存活判据 / 发信号）。
 *
 * @param {{isAlive?: (pid: number) => boolean, kill?: (pid: number, signal: string) => void,
 *          timers?: {setTimeout: Function, clearTimeout: Function},
 *          intervalMs?: number, killAfterMs?: number, onExit?: () => void,
 *          logger?: {warn?: Function}}} options
 */
export function createWatchdog({
  isAlive = defaultIsAlive, kill = defaultKill,
  timers = { setTimeout, clearTimeout },
  intervalMs = DEFAULT_INTERVAL_MS, killAfterMs = DEFAULT_KILL_AFTER_MS,
  onExit = () => {}, logger = console,
} = {}) {
  let parentPid
  let childPid
  let heartbeat
  let escalation
  let finished = false

  function clearTimers() {
    if (heartbeat !== undefined) {
      timers.clearTimeout(heartbeat)
      heartbeat = undefined
    }
    if (escalation !== undefined) {
      timers.clearTimeout(escalation)
      escalation = undefined
    }
  }

  function finish() {
    if (finished) return
    finished = true
    clearTimers()
    try {
      onExit()
    } catch (error) {
      logger?.warn?.(`[watchdog] onExit 抛了异常（已兜住）：${String(error?.message ?? error)}`)
    }
  }

  function scheduleHeartbeat() {
    if (finished) return
    heartbeat = timers.setTimeout(tick, intervalMs)
  }

  /** 父进程没了：先 SIGTERM，超时还在才 SIGKILL，然后退出。 */
  function terminateChild() {
    try {
      if (isAlive(childPid)) kill(childPid, 'SIGTERM')
    } catch (error) {
      logger?.warn?.(`[watchdog] SIGTERM 子进程 ${childPid} 失败：${String(error?.message ?? error)}`)
    }
    escalation = timers.setTimeout(() => {
      escalation = undefined
      try {
        if (isAlive(childPid)) kill(childPid, 'SIGKILL')
      } catch (error) {
        logger?.warn?.(`[watchdog] SIGKILL 子进程 ${childPid} 失败：${String(error?.message ?? error)}`)
      }
      finish()
    }, killAfterMs)
  }

  function tick() {
    heartbeat = undefined
    if (finished) return
    // 子进程已经没了：看门狗没事可做，退出（不再心跳）。
    if (!isAlive(childPid)) {
      finish()
      return
    }
    // 父（壳）没了：收掉子进程。
    if (!isAlive(parentPid)) {
      terminateChild()
      return
    }
    scheduleHeartbeat()
  }

  return {
    /**
     * @param {{parentPid: number, childPid: number}} pids
     */
    start({ parentPid: parent, childPid: child } = {}) {
      if (!Number.isInteger(parent) || parent <= 0) throw new Error(`watchdog needs parentPid (got ${JSON.stringify(parent)})`)
      if (!Number.isInteger(child) || child <= 0) throw new Error(`watchdog needs childPid (got ${JSON.stringify(child)})`)
      if (parent === child) throw new Error('watchdog parentPid and childPid must not be the same pid')
      parentPid = parent
      childPid = child
      finished = false
      clearTimers()
      scheduleHeartbeat()
    },
    stop() {
      finished = true
      clearTimers()
    },
    /** 测试 / 排障用。 */
    get pids() {
      return { parentPid, childPid }
    },
  }
}

/**
 * 把看门狗拉起成一个**独立 node 进程**（detached + ignore + unref）。
 *
 * 为什么用 `node` 而不是 `process.execPath`：Electron 的 execPath 是 electron.exe；
 * 要跑纯 node 脚本得靠 `ELECTRON_RUN_AS_NODE=1`（这里显式带上，开发/打包都不必改代码）。
 * `node` 本身也是 DSH 子进程的前提（契约 §0），所以这条依赖不是新增的。
 *
 * @param {{spawn: Function, nodeBin?: string, scriptPath: string, parentPid?: number,
 *          logger?: {warn?: Function}, env?: Record<string, string|undefined>}} options
 */
export function createWatchdogProcess({
  spawn, nodeBin = 'node', scriptPath, parentPid = process.pid,
  logger = console, env = process.env,
} = {}) {
  if (typeof spawn !== 'function') throw new Error('createWatchdogProcess needs a spawn function')
  if (typeof scriptPath !== 'string' || scriptPath === '') throw new Error('createWatchdogProcess needs scriptPath')
  let child

  return {
    start({ childPid } = {}) {
      if (child !== undefined) return child
      try {
        child = spawn(nodeBin, [
          scriptPath,
          '--parent-pid', String(parentPid),
          '--child-pid', String(childPid),
        ], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
        })
        child?.unref?.()
        return child
      } catch (error) {
        child = undefined
        logger?.warn?.(`[shell] 起看门狗进程失败（壳照常跑，只是少了崩溃兜底）：${String(error?.message ?? error)}`)
        return undefined
      }
    },
    stop() {
      if (child === undefined) return
      const target = child
      child = undefined
      try {
        target.kill('SIGTERM')
      } catch (error) {
        if (error?.code !== 'ESRCH') {
          logger?.warn?.(`[shell] 收看门狗失败（已兜住）：${String(error?.message ?? error)}`)
        }
      }
    },
  }
}

/* ───────────────────────────── CLI（独立进程入口） ───────────────────────────── */

/** 解析 `--parent-pid` / `--child-pid` / 可选的两个毫秒开关。 */
export function parseWatchdogArgs(argv) {
  const options = { parentPid: undefined, childPid: undefined, intervalMs: DEFAULT_INTERVAL_MS, killAfterMs: DEFAULT_KILL_AFTER_MS }
  const number = (flag, raw) => {
    const value = Number(raw)
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} needs a positive integer (got ${JSON.stringify(raw)})`)
    return value
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--parent-pid') options.parentPid = number(arg, argv[++index])
    else if (arg === '--child-pid') options.childPid = number(arg, argv[++index])
    else if (arg === '--interval-ms') options.intervalMs = number(arg, argv[++index])
    else if (arg === '--kill-after-ms') options.killAfterMs = number(arg, argv[++index])
    else if (arg === '-h' || arg === '--help') options.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

const invokedDirectly = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()

if (invokedDirectly) {
  try {
    const options = parseWatchdogArgs(process.argv.slice(2))
    if (options.help === true) {
      process.stdout.write('usage: node watchdog.mjs --parent-pid <pid> --child-pid <pid> [--interval-ms n] [--kill-after-ms n]\n')
    } else if (options.parentPid === undefined || options.childPid === undefined) {
      process.stderr.write('watchdog: --parent-pid and --child-pid are required\n')
      process.exitCode = 1
    } else {
      const watchdog = createWatchdog({
        intervalMs: options.intervalMs,
        killAfterMs: options.killAfterMs,
        onExit: () => process.exit(0),
      })
      watchdog.start({ parentPid: options.parentPid, childPid: options.childPid })
    }
  } catch (error) {
    process.stderr.write(`watchdog: ${String(error?.message ?? error)}\n`)
    process.exitCode = 1
  }
}
