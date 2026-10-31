/**
 * 票 29 · 「接上 AI」的数据面：**只有一个只读方法**，且方法名逐字复用票 28 的 `routes.list`。
 *
 * 为什么这条值得单测：`configured` 的来源只能是那张冻结清单。方法名写错 → 旧宿主 / 新宿主
 * 都回「未知玄枢操作」，而界面会把「检测坏了」误报成「没配」——这正是票面要避免的编造。
 */

import { afterEach, describe, expect, it } from 'vitest'

import { BESTOF_ENDPOINTS } from '../../packages/xuanshu-client/src/client/bestof-api.ts'
import { createAiApi } from '../../packages/xuanshu-client/src/client/ai-api.ts'
import { installRpcFetch, restoreRpcFetch } from './lib/rpc-fetch.mjs'

// 数据面是同源 fetch（`POST /api/xuanshu`），桩装在 fetch 上；漏还原会污染后面的文件。
afterEach(restoreRpcFetch)

/** 记录型数据面：只记 `(channel, endpoint, payload, signal)`，返回调用方指定的值。 */
function recordingContext(value = { schema: 'xuanshu/routes@1', ok: true, default: null, providers: [], configurable: [], failures: [] }) {
  const rpc = installRpcFetch({ value })
  return { calls: rpc.calls, ctx: {} }
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
    installRpcFetch({ error: { message: '未知玄枢操作：routes.list' } })
    await expect(createAiApi({}).routes()).rejects.toThrow('未知玄枢操作：routes.list')
  })
})
