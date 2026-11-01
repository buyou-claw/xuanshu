/**
 * `ai.probe` —— 「试一下 AI 到底能不能用」的单测。
 *
 * 为什么这个功能值得单独测：整条链路（DSH 模型页 + 玄枢 AI 状态）平时都只看**配置清单**，
 * 这一处是唯一**真发请求**的地方。它要是坏了，用户又回到「界面说配置齐了、真用却 401」的老路，
 * 而且这次连个能试的按钮都没有了。
 *
 * 判据全打外部可观察物：
 *   ① 没有 `ctx.llm` → `{ok:false}` 且 `reason` 说人话（不抛异常 —— 这个方法的作用就是如实报告）；
 *   ② 路由可用 → `{ok:true, reply, route, ms}`，`reply` 是模型原文；
 *   ③ 流里报错 → `{ok:false, reason}` 带原始原因；
 *   ④ 没有可用路由 → `{ok:false, reason}` 说明缺什么；
 *   ⑤ `reply` 截断到 120 字（探测不需要把长篇大论搬回界面）。
 *
 * 零网络、零真实 LLM：`ctx.llm` 全是桩。
 */
import { describe, expect, it } from 'vitest'

import { createAiProbeMethods } from '../../packages/xuanshu-host/lib/llm/probe.mjs'

/** 造一个只认 `llm` 的宿主 ctx（`getService` 走 `ctx.get(name, false)`）。 */
function ctxWith(llm) {
  return { get: (name) => (name === 'llm' ? llm : undefined) }
}

/** 造一个能跑通的最小 llm 桩。 */
function llmOk(text) {
  return {
    listProviders: () => [{ id: 'deepseek-official' }],
    listModels: async () => [{ id: 'deepseek-flash' }],
    stream: async function* stream() {
      yield { type: 'text-delta', index: 0, text }
    },
  }
}

describe('ai.probe · 真发一次最小请求', () => {
  it('没有 ctx.llm：不抛，reason 直说「宿主没装 LLM 服务」', async () => {
    const methods = createAiProbeMethods({ get: () => undefined })
    const result = await methods['ai.probe']()

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('ctx.llm')
    expect(typeof result.ms).toBe('number')
  })

  it('路由可用：ok=true，带回原文与路由', async () => {
    const methods = createAiProbeMethods(ctxWith(llmOk('连通正常')))
    const result = await methods['ai.probe']()

    expect(result.ok).toBe(true)
    expect(result.reply).toBe('连通正常')
    expect(result.route).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' })
    expect(result.ms).toBeGreaterThanOrEqual(0)
  })

  it('流里报错：ok=false，reason 带原始原因（不是笼统的「不可用」）', async () => {
    const llm = {
      listProviders: () => [{ id: 'deepseek-official' }],
      listModels: async () => [{ id: 'deepseek-flash' }],
      stream: async function* stream() {
        yield { type: 'error', error: { message: '401: Invalid credential', code: 'AUTH' } }
      },
    }
    const methods = createAiProbeMethods(ctxWith(llm))
    const result = await methods['ai.probe']()

    expect(result.ok).toBe(false)
    expect(String(result.reason)).toContain('401')
  })

  it('一条路由都没有：ok=false，reason 说明缺的是什么', async () => {
    const methods = createAiProbeMethods(ctxWith({
      listProviders: () => [],
      listModels: async () => [],
      stream: async function* stream() { /* 不会被调用 */ },
    }))
    const result = await methods['ai.probe']()

    expect(result.ok).toBe(false)
    expect(String(result.reason)).toContain('没有可用的 provider/model 路由')
  })

  it('流正常结束但一个字都没返回：算没通（假 key 就是这样悄无声息地"成功"）', async () => {
    // 实测：把 key 换成 sk-deadbeef-… 后，provider 不抛错、也不吐 error 块，只是什么都不给。
    // 那时若判 ok，探测按钮会报「通了 … 回的是「（空）」」—— 比不报更误导。
    const llm = {
      listProviders: () => [{ id: 'deepseek-official' }],
      listModels: async () => [{ id: 'deepseek-flash' }],
      stream: async function* stream() { /* 什么都不吐 */ },
    }
    const methods = createAiProbeMethods(ctxWith(llm))
    const result = await methods['ai.probe']()

    expect(result.ok).toBe(false)
    expect(String(result.reason)).toContain('一个字都没有返回')
  })

  it('回得很长时截断到 120 字（探测不需要把长篇搬回界面）', async () => {
    const long = '很'.repeat(400)
    const methods = createAiProbeMethods(ctxWith(llmOk(long)))
    const result = await methods['ai.probe']()

    expect(result.ok).toBe(true)
    expect(String(result.reply).length).toBe(120)
  })
})
