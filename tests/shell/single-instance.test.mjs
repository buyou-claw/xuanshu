/**
 * #23 · 单实例锁：重复启动只唤出已有窗口（验收原话）。
 *
 * Electron 的语义是「第二个进程拿不到锁 → 它自己退出，并把 `second-instance` 事件送给第一个进程」。
 * 所以这里用假 `app` 断言两条分支：
 *   - 第一个进程：注册 second-instance → 唤出已有窗口；**启动一次子进程**；
 *   - 第二个进程：不启动任何东西，调用 `app.quit()`。
 */
import { describe, expect, it, vi } from 'vitest'

import { bootstrapSingleInstance } from '../../packages/xuanshu-shell/lib/single-instance.mjs'

/** 假 app：`requestSingleInstanceLock` 与事件注册。 */
function fakeApp({ lock = true } = {}) {
  const listeners = new Map()
  return {
    requestSingleInstanceLock: vi.fn(() => lock),
    on: vi.fn((event, callback) => {
      listeners.set(event, callback)
    }),
    emit(event) {
      listeners.get(event)?.()
    },
    quit: vi.fn(),
    listeners,
  }
}

describe('#23 · bootstrapSingleInstance', () => {
  it('第一个进程：启动壳；收到 second-instance → 唤出已有窗口（不重复启动）', () => {
    const app = fakeApp({ lock: true })
    const start = vi.fn()
    const showExisting = vi.fn()
    const result = bootstrapSingleInstance({ app, start, showExisting })

    expect(result).toEqual({ first: true, started: true })
    expect(start).toHaveBeenCalledTimes(1)
    expect(app.on).toHaveBeenCalledWith('second-instance', expect.any(Function))

    app.emit('second-instance')
    expect(showExisting).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('第二个进程：不启动子进程、不建窗口，直接 quit', () => {
    const app = fakeApp({ lock: false })
    const start = vi.fn()
    const showExisting = vi.fn()
    const result = bootstrapSingleInstance({ app, start, showExisting })

    expect(result).toEqual({ first: false, started: false })
    expect(start).not.toHaveBeenCalled()
    expect(showExisting).not.toHaveBeenCalled()
    expect(app.quit).toHaveBeenCalledTimes(1)
    expect(app.on).not.toHaveBeenCalled()
  })

  it('重复启动不会让第二个进程变成「展示方」：唤出已有窗口只能由第一个进程做', () => {
    // 第二个进程自己调 showExisting 是无意义的（它没有窗口可展示；Electron 也不允许跨进程直接 show）。
    const app = fakeApp({ lock: false })
    bootstrapSingleInstance({ app, start: () => {}, showExisting: () => { throw new Error('should not be called') } })
    expect(app.quit).toHaveBeenCalled()
  })

  it('start 抛异常时向上抛（壳启动失败不能被吞成「已在运行」）', () => {
    const app = fakeApp({ lock: true })
    expect(() => bootstrapSingleInstance({
      app,
      start: () => {
        throw new Error('home rejected')
      },
      showExisting: () => {},
    })).toThrow(/home rejected/u)
  })
})
