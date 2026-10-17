/**
 * 装配报告 · 关闭现场判据（`isShuttingDown`）的单元用例（#22 之后的装配回归修复）。
 *
 * 这条判据解决的真实现场：`dsh --profile xuanshu --help`（无 LLM 的启动路径）里
 * `headless-startup` 行解析 `--help` 后立即请求退出；玄枢插件行在树里排最后，于是
 * 它的 `apply()` 可能在 dispose 已经开始之后才跑（实测 root `fiber.state=UNLOADING=5`，
 * `profileContext` 已随树拆除）。那不是装配失败，报告要如实写 `profile.teardown=true`；
 * 而**非关闭现场**缺 `profileContext` 仍然必须判失败（不收宽）。
 *
 * 会红的对照：把 `isShuttingDown` 改成恒 `false` → 第一条红；改成恒 `true` → 第二条红。
 * （清单门只拦「用例变少 / 新失败」，本条新增不违规。）
 */
import { describe, expect, it } from 'vitest'

import { isShuttingDown } from '../../packages/xuanshu-host/lib/index.js'

/** 造一个只带 `fiber.state` 的最小 ctx。 */
const ctxWith = (state, { rootState } = {}) => {
  const ctx = { fiber: { state } }
  if (rootState !== undefined) ctx.root = { fiber: { state: rootState } }
  return ctx
}

describe('装配报告 · 关闭现场判据（FiberState：ACTIVE=2 / DISPOSED=4 / UNLOADING=5）', () => {
  it('root UNLOADING / DISPOSED 才算关闭（dsh --help 的真实现场是 root=5、本行 ctx=1）', () => {
    expect(isShuttingDown(ctxWith(1, { rootState: 5 }))).toBe(true)
    expect(isShuttingDown(ctxWith(1, { rootState: 4 }))).toBe(true)
  })

  it('root ACTIVE / LOADING / PENDING 都不是关闭（不能把正常启动报成 teardown）', () => {
    for (const rootState of [0, 1, 2, 3]) {
      expect(isShuttingDown(ctxWith(1, { rootState })), `rootState=${rootState}`).toBe(false)
    }
  })

  it('没有 root 时退看本行 fiber；形状不对一律 false（软取，不抛）', () => {
    expect(isShuttingDown(ctxWith(5))).toBe(true)
    expect(isShuttingDown(ctxWith(2))).toBe(false)
    expect(isShuttingDown(undefined)).toBe(false)
    expect(isShuttingDown({})).toBe(false)
    expect(isShuttingDown({ fiber: { state: 'x' } })).toBe(false)
  })
})
