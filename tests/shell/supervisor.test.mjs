/**
 * #23 · 看护子进程（Supervisor）：命令 / 环境 / 就绪 / 重试 / 停止顺序。
 *
 * 这一组全部跑在**子进程替身**上（`fake-spawn.mjs`）：不装 profile、不起真 DSH、不占 19388。
 * 钉住的是验收里最贵的那几条：
 *   - 命令与 env 逐字照契约 §0（端口 19388、`--no-open`、四个 env 变量）；
 *   - 从 stdout 认出认证 URL 才进入 ready；认不出就**如实停在「服务未就绪」**；
 *   - 子进程异常退出 → 有界退避重拉，且**把状态报给 UI/托盘**（不静默死亡）；
 *   - 达到重试上限 → failed（不再无限重拉）；
 *   - `stop()`：先 SIGTERM 等它自己走，**超时才 SIGKILL**；停止期间退出不触发重拉；
 *   - 退出/停止时看门狗（如果装了）一起收掉。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

import { createSupervisor } from '../../packages/xuanshu-shell/lib/supervisor.mjs'
import { createFakeSpawn } from './lib/fake-spawn.mjs'
import { createFakeTimers } from './lib/fake-timers.mjs'

const HOME = 'C:/fake-home/.xuanshu'
const BIN = join(HOME, 'profiles', 'xuanshu', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const READY_LINE = 'dsh web: http://127.0.0.1:19388/?token=tok_abcdef123456 (LAN: http://192.168.1.9:19388/?token=tok_abcdef123456)'
const READY_URL = 'http://127.0.0.1:19388/?token=tok_abcdef123456'

/** 收集状态变化（看护每变一次就报一次，UI/托盘靠它）。 */
function recorder() {
  const states = []
  return { states, onState: (state) => states.push(state), phases: () => states.map((state) => state.phase) }
}

function scene({ restart, stopTimeoutMs = 5000, watchdog = null } = {}) {
  const spawn = createFakeSpawn()
  const timers = createFakeTimers()
  const log = recorder()
  const supervisor = createSupervisor({
    spawn,
    entry: { ok: true, source: 'profile', binJs: BIN },
    home: HOME,
    profile: 'xuanshu',
    port: 19388,
    nodeBin: 'node',
    baseEnv: { PATH: 'C:/Windows', KEEP_ME: 'yes' },
    shellPid: 4242,
    timers,
    restart: restart ?? { baseMs: 100, maxMs: 1000, maxAttempts: 3 },
    stopTimeoutMs,
    onState: log.onState,
    logger: { warn: vi.fn(), debug: vi.fn() },
    watchdog,
  })
  return { spawn, timers, supervisor, ...log }
}

/** 让链式 promise / microtask 落地（事件都是同步触发的，这一步只是把 then 排完）。 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const openScenes = []
afterEach(() => {
  for (const scene of openScenes.splice(0)) {
    try {
      scene.supervisor.stop()
    } catch {
      /* 已停 */
    }
  }
})
function track(sceneValue) {
  openScenes.push(sceneValue)
  return sceneValue
}

describe('#23 · 启动：命令 / 环境 / 初始状态', () => {
  it('spawn(node, [bin.js, --profile xuanshu --port 19388 --no-open]) + 契约 §0 的四个 env', () => {
    const { spawn, supervisor, states } = track(scene())
    supervisor.start()

    expect(spawn.calls).toHaveLength(1)
    const [call] = spawn.calls
    expect(call.command).toBe('node')
    expect(call.args).toEqual([BIN, '--profile', 'xuanshu', '--port', '19388', '--no-open'])
    expect(call.options.cwd).toBe(HOME)
    expect(call.options.windowsHide).toBe(true)
    expect(call.options.env).toMatchObject({
      DSH_HOME: HOME,
      XUANSHU_DSH_HOME: HOME,
      XUANSHU_SHELL_NOTIFY_STATE: join(HOME, 'xuanshu', 'runtime', 'shell-notify.json'),
      XUANSHU_SHELL_PID: '4242',
      KEEP_ME: 'yes',
    })
    expect(states[0]).toMatchObject({ phase: 'starting', childPid: call.child.pid, attempt: 0 })
    expect(supervisor.getState().phase).toBe('starting')
    // 「还没有 URL」在状态里就是**没有这个键**（UI 判空不会把 undefined 当成地址）。
    expect(supervisor.getState().url).toBeUndefined()
  })

  it('XUANSHU_NODE_BIN 覆盖 node（壳不把 Electron 当 node）', () => {
    const spawn = createFakeSpawn()
    const timers = createFakeTimers()
    const supervisor = createSupervisor({
      spawn, entry: { ok: true, source: 'profile', binJs: BIN }, home: HOME, profile: 'xuanshu', port: 19388,
      baseEnv: { XUANSHU_NODE_BIN: 'C:/node/node.exe' }, shellPid: 1, timers, onState: () => {},
    })
    track({ supervisor, spawn, timers })
    supervisor.start()
    expect(spawn.calls[0].command).toBe('C:/node/node.exe')
  })

  it('已在运行 / 正在启动时再 start() → 抛（不允许两个子进程抢 19388）', () => {
    const { supervisor } = track(scene())
    supervisor.start()
    expect(() => supervisor.start()).toThrow(/already/u)
  })
})

describe('#23 · 就绪：只认 DSH 亲口打的 URL 行', () => {
  it('stdout 出现 `dsh web: <url>` → ready + url；URL 被拆成两个 chunk 也能认出', () => {
    const { spawn, supervisor, states } = track(scene())
    supervisor.start()
    spawn.calls[0].child.emitStdout('booting...\n')
    expect(supervisor.getState().phase).toBe('starting')

    spawn.calls[0].child.emitStdout(READY_LINE.slice(0, 40))
    spawn.calls[0].child.emitStdout(`${READY_LINE.slice(40)}\n`)
    expect(supervisor.getState()).toMatchObject({ phase: 'ready', url: READY_URL })
    expect(states[states.length - 1]).toMatchObject({ phase: 'ready', url: READY_URL })
  })

  it('只有「服务未就绪」这一类日志时绝不进入 ready（不猜地址）', () => {
    const { spawn, supervisor } = track(scene())
    supervisor.start()
    spawn.calls[0].child.emitStdout('dsh web: opening the default browser; pass --no-open to disable\n')
    spawn.calls[0].child.emitStdout('web-app: could not open the default browser because nope\n')
    expect(supervisor.getState().phase).toBe('starting')
    expect(supervisor.getState().url).toBeUndefined()
  })

  it('第二次打 URL（重启 / 重连）不覆盖已就绪的地址', () => {
    const { spawn, supervisor } = track(scene())
    supervisor.start()
    spawn.calls[0].child.emitStdout(`${READY_LINE}\n`)
    spawn.calls[0].child.emitStdout('dsh web: http://127.0.0.1:19388/?token=other\n')
    expect(supervisor.getState().url).toBe(READY_URL)
  })
})

describe('#23 · 异常退出：有界退避 + 如实报状态（不静默死亡）', () => {
  it('启动阶段退出 → restarting（带 lastExit 与下次等待），到时重新 spawn', () => {
    const { spawn, timers, supervisor, states } = track(scene())
    supervisor.start()
    const first = spawn.calls[0].child
    first.emitExit(1, null)

    const restarting = states[states.length - 1]
    expect(restarting).toMatchObject({
      phase: 'restarting',
      attempt: 1,
      lastExit: { code: 1, signal: null },
      nextRetryMs: 100,
    })
    expect(timers.pending()).toEqual([100])

    timers.runNext()
    expect(spawn.calls).toHaveLength(2)
    expect(spawn.calls[1].args).toEqual(spawn.calls[0].args)
    expect(supervisor.getState()).toMatchObject({ phase: 'starting', attempt: 1 })
  })

  it('有界退避：100 → 200 → 400，到 maxAttempts 后 failed 且不再重拉', () => {
    const { spawn, timers, supervisor, states } = track(scene({
      restart: { baseMs: 100, maxMs: 1000, maxAttempts: 4 },
    }))
    supervisor.start()

    spawn.calls[0].child.emitExit(1)
    expect(timers.pending()).toEqual([100])
    timers.runNext()

    spawn.calls[1].child.emitExit(1)
    expect(timers.pending()).toEqual([200])
    timers.runNext()

    spawn.calls[2].child.emitExit(1)
    expect(timers.pending()).toEqual([400])
    timers.runNext()

    spawn.calls[3].child.emitExit(1)
    expect(timers.pending()).toEqual([])
    expect(states[states.length - 1]).toMatchObject({ phase: 'failed', attempt: 4 })
    expect(spawn.calls).toHaveLength(4)

    // failed 之后不再有计时器 / 不再 spawn。
    expect(timers.count()).toBe(0)
    expect(spawn.calls).toHaveLength(4)
  })

  it('就绪过的实例再退出：重试计数归零（长期运行偶发崩溃不消耗重试预算）', async () => {
    const { spawn, timers, supervisor } = track(scene())
    supervisor.start()
    spawn.calls[0].child.emitStdout(`${READY_LINE}\n`)
    spawn.calls[0].child.emitExit(1)

    const restarting = supervisor.getState()
    expect(restarting).toMatchObject({ phase: 'restarting', attempt: 1, nextRetryMs: 100 })

    timers.runNext()
    spawn.calls[1].child.emitStdout(`${READY_LINE}\n`)
    expect(supervisor.getState().attempt).toBe(0)
    spawn.calls[1].child.emitExit(1)
    // 计数已归零 → 下一次仍是「第 1 次」，等待 baseMs 而不是 200。
    expect(supervisor.getState()).toMatchObject({ phase: 'restarting', attempt: 1, nextRetryMs: 100 })
  })

  it('spawn 直接失败（命令不存在）→ failed，不做无意义的重拉', () => {
    const { spawn, timers, supervisor, states } = track(scene())
    supervisor.start()
    spawn.calls[0].child.emitError(Object.assign(new Error('spawn node ENOENT'), { code: 'ENOENT' }))

    expect(states[states.length - 1]).toMatchObject({ phase: 'failed' })
    expect(String(states[states.length - 1].detail)).toMatch(/ENOENT/u)
    expect(timers.count()).toBe(0)
  })

  it('重启后再次就绪（恢复路径完整）', () => {
    const { spawn, timers, supervisor } = track(scene())
    supervisor.start()
    spawn.calls[0].child.emitExit(1)
    timers.runNext()
    spawn.calls[1].child.emitStdout(`${READY_LINE}\n`)
    expect(supervisor.getState()).toMatchObject({ phase: 'ready', url: READY_URL })
  })
})

describe('#23 · stop()：先 SIGTERM，超时才 SIGKILL，停止期间不重拉', () => {
  it('子进程配合 → 只发 SIGTERM，状态 stopped，没有重拉计时器', async () => {
    const { spawn, timers, supervisor, states } = track(scene())
    supervisor.start()
    spawn.calls[0].child.emitStdout(`${READY_LINE}\n`)

    const stopping = supervisor.stop()
    // 退出前 SIGTERM 已发，SIGKILL 没发。
    expect(spawn.calls[0].child.kills).toEqual(['SIGTERM'])
    await stopping

    expect(spawn.calls[0].child.kills).toEqual(['SIGTERM'])
    expect(states[states.length - 1]).toMatchObject({ phase: 'stopped' })
    expect(timers.count()).toBe(0)
    expect(spawn.calls).toHaveLength(1)
  })

  it('子进程不配合 → 等 stopTimeout 后 SIGKILL（升级顺序可断言）', async () => {
    const { spawn, timers, supervisor } = track(scene({ stopTimeoutMs: 5000 }))
    spawn.autoExitOnKill = false
    supervisor.start()
    const child = spawn.calls[0].child

    const stopping = supervisor.stop()
    expect(child.kills).toEqual(['SIGTERM'])
    expect(timers.pending()).toEqual([5000])

    timers.runNext() // 超时到点 → SIGKILL
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL'])
    child.emitExit(null, 'SIGKILL')

    await expect(stopping).resolves.toMatchObject({ forced: true })
    expect(supervisor.getState().phase).toBe('stopped')
  })

  it('停止期间子进程退出 → 不排重拉（否则退壳又拉起一个孤儿）', async () => {
    const { spawn, timers, supervisor, phases } = track(scene())
    supervisor.start()
    const child = spawn.calls[0].child
    const stopping = supervisor.stop()
    expect(child.kills).toEqual(['SIGTERM'])
    await stopping

    expect(phases()).not.toContain('restarting')
    expect(timers.count()).toBe(0)
  })

  it('正在等重试时 stop() → 取消计时器，不 spawn 下一个', async () => {
    const { spawn, timers, supervisor } = track(scene())
    supervisor.start()
    spawn.calls[0].child.emitExit(1)
    expect(timers.count()).toBe(1)

    await supervisor.stop()
    expect(timers.count()).toBe(0)
    expect(spawn.calls).toHaveLength(1)
    expect(supervisor.getState().phase).toBe('stopped')
  })

  it('stop() 幂等；未启动时 stop() 直接 stopped', async () => {
    const { supervisor, spawn, timers } = track(scene())
    await expect(supervisor.stop()).resolves.toMatchObject({ drained: true })
    expect(spawn.calls).toHaveLength(0)
    expect(timers.count()).toBe(0)

    supervisor.start()
    const child = spawn.calls[0].child
    const first = supervisor.stop()
    const second = supervisor.stop()
    child.emitExit(0, 'SIGTERM')
    await Promise.all([first, second])
    expect(supervisor.getState().phase).toBe('stopped')
  })

  it('killNow()：同步兜底只发 SIGTERM、取消重试、收看门狗（不等待退出）', () => {
    const watchdog = { start: vi.fn(), stop: vi.fn() }
    const { spawn, timers, supervisor, states } = track(scene({ watchdog }))
    supervisor.start()
    const child = spawn.calls[0].child
    spawn.autoExitOnKill = false // 同步兜底不等它

    supervisor.killNow()
    expect(child.kills).toEqual(['SIGTERM'])
    expect(timers.count()).toBe(0)
    expect(watchdog.stop).toHaveBeenCalled()
    expect(states[states.length - 1]).toMatchObject({ phase: 'stopped' })
    expect(supervisor.childPid).toBeUndefined()
  })

  it('退出后若又有 stdout 到达，不把状态从 stopped 翻回 ready', async () => {
    const { spawn, supervisor } = track(scene())
    supervisor.start()
    const child = spawn.calls[0].child
    await supervisor.stop()
    child.emitStdout(`${READY_LINE}\n`)
    expect(supervisor.getState().phase).toBe('stopped')
    expect(supervisor.getState().url).toBeUndefined()
  })
})

describe('#23 · 看门狗联动：壳被硬杀时子进程不留守的机制钩子', () => {
  it('子进程起来后启动看门狗；子进程退出 / stop() 时收掉看门狗', async () => {
    const watchdog = { start: vi.fn(), stop: vi.fn() }
    const { spawn, supervisor } = track(scene({ watchdog }))
    supervisor.start()
    expect(watchdog.start).toHaveBeenCalledWith({ childPid: spawn.calls[0].child.pid })

    // 子进程意外退出 → 收掉看门狗（它盯的是这个 pid）。
    spawn.calls[0].child.emitExit(1)
    expect(watchdog.stop).toHaveBeenCalledTimes(1)

    spawn.calls[0].child.emitExit(1) // 重复退出事件不重复收
    expect(watchdog.stop).toHaveBeenCalledTimes(1)

    // 重启后看门狗重新盯新 pid。
    supervisor.stop()
    expect(watchdog.stop).toHaveBeenCalled()
  })
})
