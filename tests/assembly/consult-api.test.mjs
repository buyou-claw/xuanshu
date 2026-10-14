/**
 * 票 10 · 问事数据面（`/xuanshu` 通道上 `consult.*` 六个方法；冻结契约 §2）。
 *
 * 为什么这条断言台值得单独存在：方法名与请求形状是**两个实现者共享的接口面**
 * （客户端半 / 宿主半），写错一个字符的症状是运行期「方法不存在」，
 * 而两组测试各测各的假 ctx 都发现不了 —— 只有逐字比对契约表格才能。
 */
import { describe, expect, it } from 'vitest'

import { CONSULT_ENDPOINTS, createConsultApi } from '../../packages/xuanshu-client/src/client/consult-api.ts'

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

describe('票 10 · 问事数据面的方法名逐字对齐契约 §2', () => {
  it('六个方法名就是契约表格那一列的原文', () => {
    expect(CONSULT_ENDPOINTS).toEqual({
      create: 'consult.create',
      send: 'consult.send',
      list: 'consult.list',
      read: 'consult.read',
      rename: 'consult.rename',
      defaults: 'consult.defaults',
    })
  })

  it('每个方法都走 /xuanshu 通道，且请求体原样透传', async () => {
    const { calls, ctx } = fakeCtx({ session: { sessionId: 'session-xs-consult-x' } })
    const api = createConsultApi(ctx)

    await api.create({ pus: ['ziwei-biji'] })
    await api.send({ sessionId: 'session-xs-consult-x', text: '帮我看转岗时机' })
    await api.list()
    await api.read({ sessionId: 'session-xs-consult-x' })
    await api.rename({ sessionId: 'session-xs-consult-x', title: '转岗时机' })
    await api.defaults()

    expect(calls.map((call) => [call[0], call[1]])).toEqual([
      ['/xuanshu', 'consult.create'],
      ['/xuanshu', 'consult.send'],
      ['/xuanshu', 'consult.list'],
      ['/xuanshu', 'consult.read'],
      ['/xuanshu', 'consult.rename'],
      ['/xuanshu', 'consult.defaults'],
    ])
    expect(calls[0][2]).toEqual({ pus: ['ziwei-biji'] })
    expect(calls[1][2]).toEqual({ sessionId: 'session-xs-consult-x', text: '帮我看转岗时机' })
    expect(calls[3][2]).toEqual({ sessionId: 'session-xs-consult-x' })
    expect(calls[4][2]).toEqual({ sessionId: 'session-xs-consult-x', title: '转岗时机' })
  })

  it('create 的 pus 可省（不勾任何可选谱 = 空手问一句），省掉时不下发这个键', async () => {
    const { calls, ctx } = fakeCtx()
    await createConsultApi(ctx).create()
    expect(calls[0][2]).toEqual({})
  })

  it('请求序号 / 取消信号透传（列表与阅读器的过期回包要靠它）', async () => {
    const { calls, ctx } = fakeCtx()
    const controller = new AbortController()
    await createConsultApi(ctx).list(controller.signal)
    expect(calls[0][3]).toBe(controller.signal)
  })

  it('RPC 失败时抛出（由调用方决定降级：门厅错误条 / 阅读器错误态）', async () => {
    const ctx = { connection: { rpc: { async call() { return { ok: false, error: { message: '会话清单读不到' } } } } } }
    await expect(createConsultApi(ctx).list()).rejects.toThrow('会话清单读不到')
  })

  it('客户端**不造 sessionId**：id 一律来自 create 的返回（形状断言防回归）', async () => {
    const { ctx } = fakeCtx({ session: { sessionId: 'session-xs-consult-1a2b3c4d', title: '未命名问事', createdAt: '2026-10-15T00:00:00.000Z', pus: [], mounts: [], turns: 0 } })
    const answer = await createConsultApi(ctx).create()
    expect(answer.session.sessionId).toBe('session-xs-consult-1a2b3c4d')
    // 数据面里没有任何生成 id 的函数：客户端只搬运宿主给的 id。
    expect(Object.keys(await import('../../packages/xuanshu-client/src/client/consult-api.ts')).sort()).toEqual([
      'CONSULT_ENDPOINTS',
      'createConsultApi',
    ])
  })
})
