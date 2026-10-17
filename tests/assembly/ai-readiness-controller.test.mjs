/**
 * 票 29 · 「接上 AI」的只读轮询控制器（无 React，可在 Node 里用假定时器驱动）。
 *
 * 票面验收要的三件事都在这里证：
 *   1. **无需重启**：门禁可见且未接上时按间隔重取 `routes.list`，配好后**立刻停**；
 *   2. **窗口聚焦 / 手动重试**也能触发一次重取（人在设置里配完，切回来就该亮）；
 *   3. **只读**：整个生命周期只调 `api.routes()` —— 一个写方法都不许出现。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { AI_POLL_MS, createAiReadinessController } from '../../packages/xuanshu-client/src/client/ai-model.ts'

/** 一份「已接上」的 routes.list 回答（形状见票 28）。 */
const readyCatalog = () => ({
  schema: 'xuanshu/routes@1',
  ok: true,
  default: { provider: 'deepseek-official', model: 'deepseek-chat' },
  providers: [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      registered: true,
      keyConfigured: true,
      isDefault: true,
      modelsKnown: true,
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', isDefault: true }],
    },
  ],
  configurable: [],
  failures: [],
})

/** 一份「真没配」的回答：provider 在、key 明确没配。 */
const missingCatalog = () => {
  const value = readyCatalog()
  value.providers[0].keyConfigured = false
  return value
}

/** 记录型假数据面：只有 `routes` 一个方法（写方法根本没有，误调会立刻炸）。 */
function fakeApi(handler) {
  const calls = []
  return {
    api: {
      routes: (signal) => {
        calls.push({ signal })
        return handler(calls.length)
      },
    },
    calls,
  }
}

/** 可手动解析的 promise（用来制造乱序回包）。 */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 记录监听器的假 window（只实现 focus 需要的两个方法）。 */
function fakeFocus() {
  const listeners = new Map()
  return {
    addEventListener(type, listener) {
      const rows = listeners.get(type) ?? []
      rows.push(listener)
      listeners.set(type, rows)
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((row) => row !== listener))
    },
    emit(type) {
      for (const listener of listeners.get(type) ?? []) listener({ type })
    },
    count(type) {
      return (listeners.get(type) ?? []).length
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('票 29 · AI 轮询控制器 · 取数与只读纪律', () => {
  it('refresh 只调 routes.list，并把回答投影成状态面（没有任何写方法）', async () => {
    const { api, calls } = fakeApi(async () => readyCatalog())
    const controller = createAiReadinessController({ api, now: () => '2026-10-17T00:00:00.000Z' })
    expect(controller.snapshot().readiness).toBeUndefined()

    await controller.refresh()

    expect(calls).toHaveLength(1)
    // 数据面只有这一个方法：写配置 / 写密钥在结构上就不存在（票面验收第 4 条）。
    expect(Object.keys(api)).toEqual(['routes'])
    const snapshot = controller.snapshot()
    expect(snapshot.checking).toBe(false)
    expect(snapshot.readiness.configured).toBe(true)
    expect(snapshot.readiness.checkedAt).toBe('2026-10-17T00:00:00.000Z')
  })

  it('RPC 抛错 → configured "unknown" + detail 带原文；不冒充未配置', async () => {
    const { api } = fakeApi(async () => {
      throw new Error('未知玄枢操作：routes.list')
    })
    const controller = createAiReadinessController({ api })
    await controller.refresh()
    const readiness = controller.snapshot().readiness
    expect(readiness.configured).toBe('unknown')
    expect(readiness.reason.code).toBe('unavailable')
    expect(readiness.detail).toContain('未知玄枢操作：routes.list')
  })

  it('乱序回包：先发后到的旧答案不许覆盖新答案', async () => {
    const first = deferred()
    const second = deferred()
    const { api } = fakeApi((index) => (index === 1 ? first.promise : second.promise))
    const controller = createAiReadinessController({ api })

    const a = controller.refresh()
    const b = controller.refresh()
    second.resolve(missingCatalog())
    await b
    first.resolve(readyCatalog())
    await a

    // 最新一次请求（第 2 次）才是权威：它说没配，就不能被更早的「已接上」覆盖。
    expect(controller.snapshot().readiness.configured).toBe(false)
  })
})

describe('票 29 · AI 轮询控制器 · 无需重启（间隔 / 聚焦 / 重试）', () => {
  it('未接上时按 AI_POLL_MS 轮询；配好后立刻停（不再发请求）', async () => {
    vi.useFakeTimers()
    let answer = missingCatalog()
    const { api, calls } = fakeApi(async () => answer)
    const controller = createAiReadinessController({ api })
    const release = controller.start()
    await controller.refresh()
    expect(calls).toHaveLength(1)
    expect(controller.snapshot().readiness.configured).toBe(false)

    // 第一轮：还没配 → 继续问。
    await vi.advanceTimersByTimeAsync(AI_POLL_MS)
    expect(calls).toHaveLength(2)

    // 用户去「设置 → 模型」配好了：下一次轮询就该看见，并且**自己停下来**。
    answer = readyCatalog()
    await vi.advanceTimersByTimeAsync(AI_POLL_MS)
    expect(calls).toHaveLength(3)
    expect(controller.snapshot().readiness.configured).toBe(true)

    await vi.advanceTimersByTimeAsync(AI_POLL_MS * 3)
    expect(calls, '配好后不许继续轮询').toHaveLength(3)
    release()
  })

  it('窗口聚焦触发一次重取（人在设置里改完切回来，门禁不用重启就更新）', async () => {
    vi.useFakeTimers()
    let answer = missingCatalog()
    const { api, calls } = fakeApi(async () => answer)
    const focus = fakeFocus()
    const controller = createAiReadinessController({ api, focus })
    const release = controller.start()
    await controller.refresh()
    expect(calls).toHaveLength(1)

    answer = readyCatalog()
    focus.emit('focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(2)
    expect(controller.snapshot().readiness.configured).toBe(true)

    focus.emit('focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(calls, '聚焦重取不等于恢复轮询').toHaveLength(3)
    release()
  })

  it('手动重试：即使已经接上也能再查一次；结果不改变「配好后不轮询」的纪律', async () => {
    vi.useFakeTimers()
    let answer = readyCatalog()
    const { api, calls } = fakeApi(async () => answer)
    const controller = createAiReadinessController({ api })
    const release = controller.start()
    await controller.refresh()
    expect(controller.snapshot().readiness.configured).toBe(true)
    expect(calls).toHaveLength(1)

    answer = missingCatalog()
    await controller.refresh()
    expect(calls).toHaveLength(2)
    expect(controller.snapshot().readiness.configured).toBe(false)
    // 重试发现又没配了 → 轮询恢复（门禁得继续看）。
    await vi.advanceTimersByTimeAsync(AI_POLL_MS)
    expect(calls).toHaveLength(3)
    release()
  })

  it('release / dispose 之后既不定时也不听 focus（组件卸载不留后台请求）', async () => {
    vi.useFakeTimers()
    const { api, calls } = fakeApi(async () => missingCatalog())
    const focus = fakeFocus()
    const controller = createAiReadinessController({ api, focus })
    const release = controller.start()
    await controller.refresh()
    expect(focus.count('focus')).toBe(1)

    release()
    await vi.advanceTimersByTimeAsync(AI_POLL_MS * 4)
    expect(calls).toHaveLength(1)
    expect(focus.count('focus')).toBe(0)

    const release2 = controller.start()
    await controller.refresh()
    expect(focus.count('focus')).toBe(1)
    controller.dispose()
    release2()
    await vi.advanceTimersByTimeAsync(AI_POLL_MS * 4)
    expect(calls).toHaveLength(2)
  })

  it('start 是引用计数的：两个消费者共用一个控制器，先退出的不打断后一个的轮询', async () => {
    vi.useFakeTimers()
    const { api, calls } = fakeApi(async () => missingCatalog())
    const controller = createAiReadinessController({ api })
    const releaseA = controller.start()
    const releaseB = controller.start()
    await controller.refresh()
    expect(calls).toHaveLength(1)

    releaseA()
    await vi.advanceTimersByTimeAsync(AI_POLL_MS)
    expect(calls, 'B 还在看，轮询不许停').toHaveLength(2)

    releaseB()
    await vi.advanceTimersByTimeAsync(AI_POLL_MS * 3)
    expect(calls, '没有消费者了就不许再请求').toHaveLength(2)
  })
})
