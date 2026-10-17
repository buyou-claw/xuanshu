/**
 * #23 · 壳被硬杀时的兜底：看门狗（「壳异常退出时子进程不留守」）。
 *
 * 诚实的边界：壳**正常退出**靠 `before-quit → supervisor.stop()`；壳进程内的 `process.on('exit')`
 * 只能兜住可捕获的异常。真正收不到任何清理机会的情形（任务管理器结束进程、断电）必须靠一个
 * **独立进程**：它盯壳的 pid，壳没了就把 DSH 子进程收掉。这里测的是那个独立进程的判据与升级顺序
 * （假 `isAlive` / `kill` / 计时器），真起进程的部分由 `createWatchdogProcess` 单独测 spawn 参数。
 *
 * 不测「真的杀掉自己」——那种测试会把测试进程带走。
 */
import { describe, expect, it, vi } from 'vitest'

import { createWatchdog, createWatchdogProcess } from '../../packages/xuanshu-shell/lib/watchdog.mjs'
import { createFakeSpawn } from './lib/fake-spawn.mjs'
import { createFakeTimers } from './lib/fake-timers.mjs'

/** 一个可手动切换存活状态的 pid 表。 */
function fakeProcesses(alive) {
  const state = new Map(alive.map((pid) => [pid, true]))
  return {
    isAlive: (pid) => state.get(pid) === true,
    kill: vi.fn((pid, signal) => {
      state.set(pid, false)
      return true
    }),
    die(pid) {
      state.set(pid, false)
    },
  }
}

describe('#23 · createWatchdog：父进程活着就等，父进程没了就收掉子进程', () => {
  it('父与子都活着 → 只排下一次心跳，不杀任何东西', () => {
    const processes = fakeProcesses([100, 200])
    const timers = createFakeTimers()
    const watchdog = createWatchdog({
      isAlive: processes.isAlive, kill: processes.kill, timers, intervalMs: 1000,
    })
    watchdog.start({ parentPid: 100, childPid: 200 })

    expect(timers.pending()).toEqual([1000])
    timers.runNext()
    expect(processes.kill).not.toHaveBeenCalled()
    expect(timers.pending()).toEqual([1000])
    watchdog.stop()
    expect(timers.count()).toBe(0)
  })

  it('子进程先没了 → 看门狗自己退出，不再心跳（不常驻一个空转进程）', () => {
    const processes = fakeProcesses([100, 200])
    const timers = createFakeTimers()
    const onExit = vi.fn()
    const watchdog = createWatchdog({
      isAlive: processes.isAlive, kill: processes.kill, timers, intervalMs: 1000, onExit,
    })
    watchdog.start({ parentPid: 100, childPid: 200 })
    processes.die(200)
    timers.runNext()

    expect(processes.kill).not.toHaveBeenCalled()
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(timers.count()).toBe(0)
  })

  it('父进程死了 → 对子进程 SIGTERM，超时还在才 SIGKILL，然后退出', () => {
    const timers = createFakeTimers()
    const onExit = vi.fn()
    // 父进程被硬杀；但子进程对 SIGTERM 不配合 —— 这里用「不置死」的实现来验证升级路径。
    const aliveState = new Map([[200, true]])
    const terminateCalls = []
    const stubborn = createWatchdog({
      isAlive: (pid) => (pid === 100 ? false : aliveState.get(pid) === true),
      kill: (pid, signal) => {
        terminateCalls.push(signal)
        if (signal === 'SIGKILL') aliveState.set(pid, false)
        return true
      },
      timers,
      intervalMs: 1000,
      killAfterMs: 3000,
      onExit,
    })
    stubborn.start({ parentPid: 100, childPid: 200 })
    timers.runNext() // 心跳：发现父死了 → SIGTERM
    expect(terminateCalls).toEqual(['SIGTERM'])
    expect(timers.pending()).toContain(3000)

    timers.runNext() // 升级计时器到点 → SIGKILL
    expect(terminateCalls).toEqual(['SIGTERM', 'SIGKILL'])
    expect(onExit).toHaveBeenCalled()
  })

  it('父进程死了、子进程也已经退出 → 不 kill（pid 可能已被复用，宁可不动）', () => {
    const processes = fakeProcesses([100]) // 子进程 200 不在表里 = 已死
    const timers = createFakeTimers()
    const watchdog = createWatchdog({
      isAlive: processes.isAlive, kill: processes.kill, timers, intervalMs: 1000,
    })
    watchdog.start({ parentPid: 100, childPid: 200 })
    processes.die(100)
    timers.runNext()
    expect(processes.kill).not.toHaveBeenCalled()
    expect(timers.count()).toBe(0)
  })

  it('参数校验：缺 pid / 同一个 pid 不许启动（不能把自己当子进程收掉）', () => {
    const isAlive = () => true
    const kill = () => true
    const timers = createFakeTimers()
    expect(() => createWatchdog({ isAlive, kill, timers }).start({ parentPid: 1 })).toThrow(/childPid/u)
    expect(() => createWatchdog({ isAlive, kill, timers }).start({ childPid: 2 })).toThrow(/parentPid/u)
    expect(() => createWatchdog({ isAlive, kill, timers }).start({ parentPid: 7, childPid: 7 })).toThrow(/same/u)
  })
})

describe('#23 · createWatchdogProcess：独立 node 进程的拉起参数', () => {
  it('start 用 node 起 watchdog 脚本（detached + ignore + ELECTRON_RUN_AS_NODE），stop 收掉', () => {
    const spawn = createFakeSpawn()
    const watchdog = createWatchdogProcess({
      spawn,
      nodeBin: 'C:/node/node.exe',
      scriptPath: 'C:/app/lib/watchdog.mjs',
      parentPid: 999,
    })
    const child = { unref: vi.fn() }
    spawn.calls // 还没有
    const handle = watchdog.start({ childPid: 200 })
    expect(spawn.calls).toHaveLength(1)
    const [call] = spawn.calls
    expect(call.command).toBe('C:/node/node.exe')
    expect(call.args).toEqual([
      'C:/app/lib/watchdog.mjs', '--parent-pid', '999', '--child-pid', '200',
    ])
    expect(call.options).toMatchObject({
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }),
    })
    void child
    void handle

    watchdog.stop()
    expect(spawn.calls[0].child.kills).toEqual(['SIGTERM'])
  })

  it('起不来（spawn 抛）→ 不抛给调用方，返回 undefined（壳照常跑，只是少了兜底）', () => {
    const spawn = vi.fn(() => {
      throw new Error('spawn node ENOENT')
    })
    const watchdog = createWatchdogProcess({
      spawn, nodeBin: 'node', scriptPath: 'C:/app/lib/watchdog.mjs', parentPid: 1,
    })
    expect(() => watchdog.start({ childPid: 2 })).not.toThrow()
    expect(watchdog.start({ childPid: 2 })).toBeUndefined()
    expect(() => watchdog.stop()).not.toThrow()
  })
})
