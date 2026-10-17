/**
 * P2（复核 #24）· 通知点击落到 overview（客户端半边）。
 *
 * 票面验收原文：「点通知窗口出现并停在 overview」。壳把页面带到 `#xuanshu-overview`，
 * 前端**没有路由**，所以这里是最小的一条桥：
 *   - 页面加载时（`start()` 立即检查一次）与 `hashchange` 时都看 hash；
 *   - 命中 → `ctx.layout.selectPanel('overview')` → 清掉 hash（刷新不再重复触发）；
 *   - 不命中 → 什么都不做（绝不能把用户从别的面板拽走）。
 *
 * 环境：**不需要 DOM**。`location` 用注入的假件（`addEventListener` / `hash`），
 * 与 `ai-model.ts` 的 focus 监听同一个「纯处理 + 注册/释放」范式。
 */
import { describe, expect, it } from 'vitest'

import {
  OVERVIEW_HASH,
  createOverviewHashBridge,
  isOverviewHash,
  installOverviewHashBridge,
} from '../../packages/xuanshu-client/src/client/overview-hash.ts'

/** 最小 location 假件：记录监听器、能手动触发、`hash` 可写。 */
function fakeLocation(hash = '') {
  const listeners = new Map()
  return {
    hash,
    addEventListener(type, listener) {
      listeners.set(type, listener)
    },
    removeEventListener(type) {
      listeners.delete(type)
    },
    fire(type) {
      listeners.get(type)?.()
    },
    listenerCount() {
      return listeners.size
    },
  }
}

describe('P2 · hash 桥：命中就切 overview 并清 hash', () => {
  it('hash 名与壳侧同名（`#xuanshu-overview`）', () => {
    expect(OVERVIEW_HASH).toBe('xuanshu-overview')
    expect(isOverviewHash('#xuanshu-overview')).toBe(true)
    expect(isOverviewHash('#xuanshu-overview/')).toBe(false)
    expect(isOverviewHash('')).toBe(false)
    expect(isOverviewHash('#other')).toBe(false)
  })

  it('页面已经带着 hash 加载 → start() 立即切 overview 并清掉 hash', () => {
    const location = fakeLocation('#xuanshu-overview')
    const selected = []
    const bridge = createOverviewHashBridge({ location, selectPanel: (id) => selected.push(id) })
    bridge.start()
    expect(selected).toEqual(['overview'])
    expect(location.hash).toBe('')
  })

  it('之后收到 hashchange → 同样切 overview 并清 hash（只注册一个监听器）', () => {
    const location = fakeLocation('')
    const selected = []
    const bridge = createOverviewHashBridge({ location, selectPanel: (id) => selected.push(id) })
    bridge.start()
    expect(selected).toEqual([])
    expect(location.listenerCount()).toBe(1)
    location.hash = '#xuanshu-overview'
    location.fire('hashchange')
    expect(selected).toEqual(['overview'])
    expect(location.hash).toBe('')
  })

  it('不是 overview 的 hash → 不切面板、不清 hash（不抢用户的导航）', () => {
    const location = fakeLocation('#something-else')
    const selected = []
    createOverviewHashBridge({ location, selectPanel: (id) => selected.push(id) }).start()
    expect(selected).toEqual([])
    expect(location.hash).toBe('#something-else')
  })

  it('stop() 之后不再响应（插件卸载 / 面板重注册时不重复切）', () => {
    const location = fakeLocation('')
    const selected = []
    const bridge = createOverviewHashBridge({ location, selectPanel: (id) => selected.push(id) })
    bridge.start()
    bridge.stop()
    expect(location.listenerCount()).toBe(0)
    location.hash = '#xuanshu-overview'
    location.fire('hashchange')
    expect(selected).toEqual([])
  })
})

describe('P2 · 安装入口：没有 window 的 Node 环境安全返回（客户端测试与 SSR）', () => {
  it('不传 window 且当前环境没有 window → 返回 undefined，不抛', () => {
    expect(typeof globalThis.window).toBe('undefined')
    const ctx = { layout: { selectPanel() {} } }
    expect(() => installOverviewHashBridge(ctx)).not.toThrow()
    expect(installOverviewHashBridge(ctx)).toBeUndefined()
  })

  it('注入 window 假件 → 安装立即检查 + 返回可释放函数', () => {
    const location = fakeLocation('#xuanshu-overview')
    const selected = []
    const dispose = installOverviewHashBridge({ layout: { selectPanel: (id) => selected.push(id) } }, { window: { location } })
    expect(selected).toEqual(['overview'])
    expect(location.hash).toBe('')
    expect(typeof dispose).toBe('function')
    dispose()
    expect(location.listenerCount()).toBe(0)
  })
})
