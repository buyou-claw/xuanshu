/**
 * 票 11 · 合参数据面与命令解析（契约 §1；S9 §2.1）。
 *
 * 这一条盯的是「两个实现者共享的接口面」：方法名逐字（`bestof.run/state/adopt/cancel`）、
 * 请求体原样透传、命令三名字等价 + `//` 不算命令 + 命令名到第一个空白为界。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { BESTOF_ENDPOINTS, createBestofApi } from '../../packages/xuanshu-client/src/client/bestof-api.ts'
import { BESTOF_COMMAND_NAMES, parseBestofCommand } from '../../packages/xuanshu-client/src/client/bestof-model.ts'
import { installRpcFetch, restoreRpcFetch } from './lib/rpc-fetch.mjs'

// 数据面是同源 fetch（`POST /api/xuanshu`），桩装在 fetch 上；漏还原会污染后面的文件。
afterEach(restoreRpcFetch)

/** 记录型假数据面（记录项形状见 `lib/rpc-fetch.mjs` 文件头）。 */
function fakeCtx(value = { ok: true }) {
  const rpc = installRpcFetch({ value })
  return { calls: rpc.calls, ctx: {} }
}

describe('票 11 / 票 28 · 方法名逐字对齐契约', () => {
  it('六个方法名就是契约表格那一列的原文（cancel 是批准过的 additive 方法；estimate / routes.list 是票 28 的加性面）', () => {
    expect(BESTOF_ENDPOINTS).toEqual({
      run: 'bestof.run',
      state: 'bestof.state',
      adopt: 'bestof.adopt',
      cancel: 'bestof.cancel',
      estimate: 'bestof.estimate',
      routes: 'routes.list',
    })
  })

  it('每个方法都走 /xuanshu 通道，且请求体原样透传', async () => {
    const { calls, ctx } = fakeCtx({ runId: 'bestof-1' })
    const api = createBestofApi(ctx)

    await api.run({ sessionId: 'session-xs-consult-x', question: '问一句', angles: ['classic', 'cautious'] })
    await api.state({ runId: 'bestof-1' })
    await api.adopt({ runId: 'bestof-1', decision: 'adopt', adoptedId: 'c2' })
    await api.cancel({ runId: 'bestof-1' })
    await api.estimate({ sessionId: 'session-xs-consult-x', question: '问一句', routes: [{ provider: 'deepseek' }] })
    await api.listRoutes()

    expect(calls.map((call) => [call.channel, call.endpoint])).toEqual([
      ['/xuanshu', 'bestof.run'],
      ['/xuanshu', 'bestof.state'],
      ['/xuanshu', 'bestof.adopt'],
      ['/xuanshu', 'bestof.cancel'],
      ['/xuanshu', 'bestof.estimate'],
      ['/xuanshu', 'routes.list'],
    ])
    expect(calls[0].payload).toEqual({ sessionId: 'session-xs-consult-x', question: '问一句', angles: ['classic', 'cautious'] })
    expect(calls[2].payload).toEqual({ runId: 'bestof-1', decision: 'adopt', adoptedId: 'c2' })
    expect(calls[4].payload).toEqual({ sessionId: 'session-xs-consult-x', question: '问一句', routes: [{ provider: 'deepseek' }] })
    expect(calls[5].payload).toEqual({})
  })

  it('取消信号透传（轮询过期回包靠它）', async () => {
    const { calls, ctx } = fakeCtx()
    const controller = new AbortController()
    await createBestofApi(ctx).state({ runId: 'bestof-1' }, controller.signal)
    expect(calls[0].signal).toBe(controller.signal)
  })

  it('RPC 失败时抛出（由调用方决定降级：浮层错误条 / 本地停止）', async () => {
    installRpcFetch({ error: { message: '未知玄枢操作：bestof.cancel' } })
    await expect(createBestofApi({}).cancel({ runId: 'bestof-1' })).rejects.toThrow('未知玄枢操作')
  })
})

describe('票 11 · `/多模型` 命令解析（S9 §2.1 / §5 步骤 1）', () => {
  it('三个名字等价：多模型（主）/ 合参 / bestof', () => {
    expect(BESTOF_COMMAND_NAMES).toEqual(['多模型', '合参', 'bestof'])
    for (const name of BESTOF_COMMAND_NAMES) {
      expect(parseBestofCommand(`/${name} 这次转岗该不该去`)).toEqual({ matched: true, question: '这次转岗该不该去' })
    }
  })

  it('命令名到第一个空白为界；问题里的空格原样保留', () => {
    expect(parseBestofCommand('/多模型    多  空格   问题')).toEqual({ matched: true, question: '多  空格   问题' })
    expect(parseBestofCommand('/多模型')).toEqual({ matched: true, question: '' })
  })

  it('`//` 开头不算命令；别的命令不归它管', () => {
    expect(parseBestofCommand('//多模型 这不是命令')).toEqual({ matched: false, question: '' })
    expect(parseBestofCommand('/别的命令 x')).toEqual({ matched: false, question: '' })
    expect(parseBestofCommand('多模型 没有斜杠')).toEqual({ matched: false, question: '' })
    expect(parseBestofCommand('')).toEqual({ matched: false, question: '' })
  })
})
