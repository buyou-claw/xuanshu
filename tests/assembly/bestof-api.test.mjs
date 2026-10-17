/**
 * 票 11 · 合参数据面与命令解析（契约 §1；S9 §2.1）。
 *
 * 这一条盯的是「两个实现者共享的接口面」：方法名逐字（`bestof.run/state/adopt/cancel`）、
 * 请求体原样透传、命令三名字等价 + `//` 不算命令 + 命令名到第一个空白为界。
 */
import { describe, expect, it } from 'vitest'

import { BESTOF_ENDPOINTS, createBestofApi } from '../../packages/xuanshu-client/src/client/bestof-api.ts'
import { BESTOF_COMMAND_NAMES, parseBestofCommand } from '../../packages/xuanshu-client/src/client/bestof-model.ts'

/** 记录型假连接。 */
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

describe('票 11 · 方法名逐字对齐契约 §1', () => {
  it('四个方法名就是契约表格那一列的原文（cancel 是批准过的 additive 方法）', () => {
    expect(BESTOF_ENDPOINTS).toEqual({
      run: 'bestof.run',
      state: 'bestof.state',
      adopt: 'bestof.adopt',
      cancel: 'bestof.cancel',
    })
  })

  it('每个方法都走 /xuanshu 通道，且请求体原样透传', async () => {
    const { calls, ctx } = fakeCtx({ runId: 'bestof-1' })
    const api = createBestofApi(ctx)

    await api.run({ sessionId: 'session-xs-consult-x', question: '问一句', angles: ['classic', 'cautious'] })
    await api.state({ runId: 'bestof-1' })
    await api.adopt({ runId: 'bestof-1', decision: 'adopt', adoptedId: 'c2' })
    await api.cancel({ runId: 'bestof-1' })

    expect(calls.map((call) => [call[0], call[1]])).toEqual([
      ['/xuanshu', 'bestof.run'],
      ['/xuanshu', 'bestof.state'],
      ['/xuanshu', 'bestof.adopt'],
      ['/xuanshu', 'bestof.cancel'],
    ])
    expect(calls[0][2]).toEqual({ sessionId: 'session-xs-consult-x', question: '问一句', angles: ['classic', 'cautious'] })
    expect(calls[2][2]).toEqual({ runId: 'bestof-1', decision: 'adopt', adoptedId: 'c2' })
  })

  it('取消信号透传（轮询过期回包靠它）', async () => {
    const { calls, ctx } = fakeCtx()
    const controller = new AbortController()
    await createBestofApi(ctx).state({ runId: 'bestof-1' }, controller.signal)
    expect(calls[0][3]).toBe(controller.signal)
  })

  it('RPC 失败时抛出（由调用方决定降级：浮层错误条 / 本地停止）', async () => {
    const ctx = { connection: { rpc: { async call() { return { ok: false, error: { message: '未知玄枢操作：bestof.cancel' } } } } } }
    await expect(createBestofApi(ctx).cancel({ runId: 'bestof-1' })).rejects.toThrow('未知玄枢操作')
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
