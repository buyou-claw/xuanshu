/**
 * 票 15 · 沉淀数据面（`/xuanshu` 通道上 `sediment.*` 三个方法的客户端面；冻结契约 §3）。
 *
 * 为什么这条断言台值得单独存在：方法名与请求形状是**两个实现者共享的接口面**
 * （客户端半 / 宿主半），写错一个字符的症状是运行期「导出汇总」永远失败，
 * 而两组测试各测各的假 ctx 都发现不了 —— 只有逐字比对契约表格才能。
 *
 * 另有一条本票特有的硬断言：**`confirmed: true` 只能由人点确认那条路下发**。
 * `commit` 的签名把 `confirmed` 写死成字面量 `true`（不是调用方传进来的开关），
 * 于是「AI 静默写谱」在数据面上没有入口 —— 这一条与 `sediment-controller` 的结构断言互为印证。
 */
import { describe, expect, it } from 'vitest'

import { SEDIMENT_ENDPOINTS, createSedimentApi } from '../../packages/xuanshu-client/src/client/sediment-api.ts'

/** 记录型假连接：只记 `(channel, method, payload, signal)`，返回调用方指定的值。 */
function fakeCtx(value = { ok: true }) {
  const calls = []
  return {
    calls,
    ctx: {
      connection: {
        rpc: {
          async call(...args) {
            calls.push(args)
            return { ok: true, value }
          },
        },
      },
    },
  }
}

describe('票 15 · 沉淀数据面的方法名逐字对齐契约 §3', () => {
  it('三个方法名就是契约表格那一列的原文', () => {
    expect(SEDIMENT_ENDPOINTS).toEqual({
      draft: 'sediment.draft',
      commit: 'sediment.commit',
      discard: 'sediment.discard',
    })
  })

  it('每个方法都走 /xuanshu 通道，且请求体原样透传', async () => {
    const { calls, ctx } = fakeCtx({ draftId: 'd1' })
    const api = createSedimentApi(ctx)

    await api.draft({ sessionId: 'session-xs-consult-x' })
    await api.draft({ sessionId: 'session-xs-consult-x', targetSlug: 'shiye' })
    await api.commit({ draftId: 'd1' })
    await api.discard({ draftId: 'd1' })

    expect(calls.map((call) => [call[0], call[1]])).toEqual([
      ['/xuanshu', 'sediment.draft'],
      ['/xuanshu', 'sediment.draft'],
      ['/xuanshu', 'sediment.commit'],
      ['/xuanshu', 'sediment.discard'],
    ])
    expect(calls[0][2]).toEqual({ sessionId: 'session-xs-consult-x' })
    expect(calls[1][2]).toEqual({ sessionId: 'session-xs-consult-x', targetSlug: 'shiye' })
    expect(calls[3][2]).toEqual({ draftId: 'd1' })
  })

  it('commit **总是**下发 confirmed: true（确认是这个人点的，不是调用方传进来的开关）', async () => {
    const { calls, ctx } = fakeCtx({ pu: { slug: 'shiye', name: '事业与行业' } })
    await createSedimentApi(ctx).commit({ draftId: 'd1' })
    expect(calls[0][2]).toEqual({ draftId: 'd1', confirmed: true })
  })

  it('目标谱现状走既有 `pu.read`（读面单源）：不新开方法，也不改谱', async () => {
    const { calls, ctx } = fakeCtx({ slug: 'shiye', name: '事业与行业', body: '旧正文', updatedAt: '2026-10-15T00:00:00.000Z' })
    const pu = await createSedimentApi(ctx).readTarget('shiye')
    expect(calls[0][0]).toBe('/xuanshu')
    expect(calls[0][1]).toBe('pu.read')
    expect(calls[0][2]).toEqual({ slug: 'shiye' })
    expect(pu.body).toBe('旧正文')
  })

  it('取消信号透传（导出汇总可能等一整轮对话）', async () => {
    const { calls, ctx } = fakeCtx()
    const controller = new AbortController()
    await createSedimentApi(ctx).draft({ sessionId: 'session-xs-consult-x' }, controller.signal)
    expect(calls[0][3]).toBe(controller.signal)
  })

  it('RPC 失败时抛出（由调用方落进卡片的 error 态，不静默）', async () => {
    const ctx = { connection: { rpc: { async call() { return { ok: false, error: { message: '需要人工确认后才写谱' } } } } } }
    await expect(createSedimentApi(ctx).commit({ draftId: 'd1' })).rejects.toThrow('需要人工确认后才写谱')
  })

  it('数据面里没有别的方法：不新增端点、不藏写入开关', async () => {
    const module = await import('../../packages/xuanshu-client/src/client/sediment-api.ts')
    expect(Object.keys(module).sort()).toEqual(['SEDIMENT_ENDPOINTS', 'createSedimentApi'])
  })
})
