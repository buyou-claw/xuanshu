#!/usr/bin/env node
/**
 * `scripts/experience/instance-lifecycle.mjs` —— **一次执行里的实例起停序列**（Spec 04 · 票 #80）。
 *
 * 票 #80 要验的是「跨进程持久化」：记录一轮问事 → 停掉实例但保留 home → 起同一个 home 的新实例 →
 * 从历史入口找回。它和「切走再回来」不是一回事：切走是同一进程内的界面切换，重启是进程没了。
 *
 * 这一层只做**编排**，不碰浏览器、不碰进程表：
 *   - 起实例、停实例、端口是否已关、时钟，全部由调用方注入（runner 注入真的，测试注入替身）；
 *   - 它只负责「谁先谁后」与「每一次 boot 留下什么事实」——**先停后起**、同一 home、
 *     两个端口、两份起止时间与时长；
 *   - 它**不**按端口或进程号杀进程、不删 home：停实例只能走 `startIsolatedInstance`
 *     返回的 `stop()`（票 #80 硬约束「用 runner 的实例生命周期，不要手工 kill 端口」）。
 *
 * 为什么要单独一个模块：重启编排是本票唯一新增的时序逻辑，把它做成注入式纯编排之后，
 * 「先停后起 / 同 home / 两次 boot 分开记 / 停一次不再停」这些不变量可以在**零浏览器**的用例里钉死；
 * 否则这些结论只能靠真跑一次、看日志里两句「起实例」来相信。
 *
 * 仅使用 Node 内置能力（实际上一个 import 都不需要）。ESM。
 */

/**
 * 等端口关闭的轮询预算（20 × 250ms ≈ 5s）。
 * 旧进程退出是异步的，只 sleep 一次会把「还没死」当成「已关」；这是实现常量，不是调用方开关——
 * 可注入的只有 `wait`（测试用它把时间压成零）。
 */
const PORT_CLOSE_ATTEMPTS = 20
const PORT_CLOSE_INTERVAL_MS = 250

/**
 * 造一条「实例起停序列」。
 *
 * @param {{
 *   repoRoot: string,
 *   home: string,
 *   homeLabel?: string,
 *   keepHome?: boolean,
 *   log?: (line: string) => void,
 *   start: (input: {repoRoot: string, home: string, keepHome: boolean, log: (line: string) => void}) => Promise<object>,
 *   checkClosed: (port: number) => Promise<boolean>,
 *   now?: () => string,
 *   wait?: (ms: number) => Promise<void>,
 * }} input
 * @returns {{
 *   boots: object[],
 *   current: () => object|null,
 *   boot: () => object|null,
 *   start: () => Promise<{url: string, port: number, boot: object}>,
 *   restart: () => Promise<{url: string, port: number, boot: object, previousPort: number|null, previousPortClosed: boolean}>,
 *   stopCurrent: () => Promise<{portClosed: boolean, stopped: boolean}>,
 * }}
 */
export function createBootSequence({
  repoRoot,
  home,
  homeLabel = home,
  keepHome = true,
  log = () => {},
  start,
  checkClosed,
  now = () => new Date().toISOString(),
  wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms)),
} = {}) {
  if (typeof start !== 'function') throw new Error('createBootSequence: 需要注入 start（起实例）')
  if (typeof checkClosed !== 'function') throw new Error('createBootSequence: 需要注入 checkClosed（端口是否已关）')
  if (typeof home !== 'string' || home.trim() === '') throw new Error('createBootSequence: home 必须是非空路径')

  /** 每一次实例启动的事实（顺序即启动顺序；`run.mjs` 把它交给场景写 `restart-boots.json`）。 */
  const boots = []
  let current = null
  let currentBoot = null

  /** 一次 boot 的初始记录：端口 / home / 开始时间；停止后由 `stopCurrent()` 补齐后三项。 */
  function bootRecord(target, index, startedAt) {
    return {
      boot: index,
      port: target.port,
      home: homeLabel,
      keepHome: target.keepHome === undefined ? keepHome === true : target.keepHome === true,
      startedAt,
      stoppedAt: null,
      durationMs: null,
      portClosed: null,
    }
  }

  /** 起一次实例并把它记成第 N 次 boot。 */
  async function startBoot() {
    const startedAt = now()
    const target = await start({ repoRoot, home, keepHome: keepHome === true, log })
    if (target === null || typeof target !== 'object' || typeof target.port !== 'number') {
      throw new Error('createBootSequence: start 没有返回带 port 的实例（拿不到端口就无法证明是新进程）')
    }
    current = target
    currentBoot = bootRecord(target, boots.length + 1, startedAt)
    boots.push(currentBoot)
    log(`起实例：第 ${currentBoot.boot} 次 boot，port=${currentBoot.port}，home=${homeLabel}`)
    return { url: target.url, port: target.port, boot: currentBoot }
  }

  /** 等端口真的不可连（旧进程退出是异步的；只 sleep 一次会把「还没死」当成「已关」）。 */
  async function waitForClosed(port) {
    for (let attempt = 0; attempt < PORT_CLOSE_ATTEMPTS; attempt += 1) {
      if (await checkClosed(port)) return true
      if (attempt < PORT_CLOSE_ATTEMPTS - 1) await wait(PORT_CLOSE_INTERVAL_MS)
    }
    return false
  }

  /**
   * 停掉当前实例（**保留 home** 由 `keepHome` 决定，在 `start()` 时就已交给实例）。
   * 幂等：已经停过的实例不会再 stop 一次，也不会重写它的停止时间/时长。
   */
  async function stopCurrent() {
    if (current === null || currentBoot === null) return { portClosed: true, stopped: false }
    if (currentBoot.stoppedAt !== null) return { portClosed: currentBoot.portClosed === true, stopped: false }
    try {
      await current.stop()
    } catch (error) {
      // 停不下来不覆盖主结论：端口检查会如实说「还连得上」，判定据此记 blocked。
      log(`停实例失败（boot ${currentBoot.boot}）：${error?.message ?? error}`)
    }
    currentBoot.stoppedAt = now()
    const elapsed = Date.parse(currentBoot.stoppedAt) - Date.parse(currentBoot.startedAt)
    currentBoot.durationMs = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null
    currentBoot.portClosed = await waitForClosed(current.port)
    log(`停实例：第 ${currentBoot.boot} 次 boot，port=${currentBoot.port}，端口已关=${currentBoot.portClosed}`)
    return { portClosed: currentBoot.portClosed === true, stopped: true }
  }

  /**
   * 停旧进程 → 起新进程（同一个 home）。
   * 返回 `previousPortClosed`：**必须先关旧端口再起新实例**，否则「新进程」的说法没有证据。
   */
  async function restart() {
    if (currentBoot === null) throw new Error('没有可重启的实例：先 start() 一次')
    const previous = currentBoot
    const stopped = await stopCurrent()
    const next = await startBoot()
    return {
      ...next,
      previousPort: previous.port,
      previousPortClosed: stopped.portClosed === true,
    }
  }

  return {
    boots,
    current: () => current,
    boot: () => currentBoot,
    start: startBoot,
    restart,
    stopCurrent,
  }
}
