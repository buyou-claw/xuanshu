/**
 * 票 29 · 「接上 AI」的数据面：**只有一个只读方法**，且方法名逐字复用票 28 的 `routes.list`。
 *
 * 为什么这条值得单测：`configured` 的来源只能是那张冻结清单。方法名写错 → 旧宿主 / 新宿主
 * 都回「未知玄枢操作」，而界面会把「检测坏了」误报成「没配」——这正是票面要避免的编造。
 */

import { describe, expect, it } from 'vitest'

import { BESTOF_ENDPOINTS } from '../../packages/xuanshu-client/src/client/bestof-api.ts'
import { createAiApi } from '../../packages/xuanshu-client/src/client/ai-api.ts'

/** 记录型连接上下文：只记 `(channel, endpoint, payload)`。 */
function recordingContext(value = { schema: 'xuanshu/routes@1', ok: true, default: null, providers: [], configurable: [], failures: [] }) {
  const calls = []
  return {
    calls,
    ctx: {
      connection: {
        rpc: {
          async call(channel, endpoint, payload, signal) {
            calls.push({ channel, endpoint, payload, signal })
            return { ok: true, value }
          },
        },
      },
    },
  }
}

describe('票 29 · AI 数据面', () => {
  it('routes() 走同一条 /xuanshu 通道，方法名就是 routes.list，载荷固定为空对象', async () => {
    const { ctx, calls } = recordingContext()
    const api = createAiApi(ctx)
    const answer = await api.routes()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ channel: '/xuanshu', endpoint: 'routes.list', payload: {} })
    expect(calls[0].endpoint).toBe(BESTOF_ENDPOINTS.routes)
    expect(answer.schema).toBe('xuanshu/routes@1')
  })

  it('只有一个方法：写 provider 配置 / 写密钥在数据面上不存在（只读检测）', () => {
    const { ctx } = recordingContext()
    expect(Object.keys(createAiApi(ctx))).toEqual(['routes'])
  })

  it('RPC 失败原样抛出（由控制器降级成「未知」，不在这里吞成「没配」）', async () => {
    const ctx = {
      connection: { rpc: { async call() { return { ok: false, error: { message: '未知玄枢操作：routes.list' } } } } },
    }
    await expect(createAiApi(ctx).routes()).rejects.toThrow('未知玄枢操作：routes.list')
  })
})
