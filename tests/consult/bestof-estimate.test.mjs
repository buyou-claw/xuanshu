/**
 * 票 28 · 跑前估算（`bestof.estimate`）：N 路 × model × 输入规模 + `price:'unknown'`。
 *
 * 硬线：
 *   ① **纯只读**：estimate 期间不写盘、不调 `llm.stream`（不许偷偷试跑）；
 *   ② `inputTokens` 是**估算**，且与真跑时喂进候选的文本同源（同一份装配 / 同一个 prompt 构造函数）；
 *   ③ 钉版没有价表：`price` 恒为 `'unknown'`，绝不编金额；
 *   ④ `bestof.run(routes)` 在 `confirm !== true` 时拒绝，并把这份 estimate 一起带回来。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { buildCandidatePrompt } from '../../packages/xuanshu-host/lib/consult/bestof-run.mjs'
import { createBestOfMethods } from '../../packages/xuanshu-host/lib/consult/bestof.mjs'
import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { fakeAgentDefaultModel, fakeAgents, makeHost, makeSandbox } from './lib/sandbox.mjs'
import { fakeLlm } from './lib/bestof-llm.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

const QUESTION = '这次转岗的时机怎么样？'
const PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] },
  { id: 'pi-ai', name: 'Pi AI', models: [{ id: 'pi-chat', name: 'Pi Chat' }] },
]

async function scene() {
  const sandbox = makeSandbox('bestof-estimate')
  roots.push(sandbox)
  const agents = fakeAgents()
  const llm = fakeLlm([
    { text: '第一份正文。' },
    { text: '第二份正文。' },
    { tool: { name: 'submit_judgement', arguments: JSON.stringify({ judgement: { best: 'c1', ranking: ['c1', 'c2'] } }) } },
  ], { providers: PROVIDERS })
  const host = makeHost({
    services: {
      agents: agents.service,
      agentPresets: { resolve: async () => ({ id: 'standard' }), mount: async () => ({}) },
      agentDefaultModel: fakeAgentDefaultModel().service,
      llm: llm.service,
    },
  })
  const consult = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
  const { session } = await consult['consult.create']({ pus: ['软件开发'] })
  const bestof = createBestOfMethods(host.ctx, { dataDir: sandbox.dataDir })
  return { sandbox, host, llm, bestof, session }
}

async function runToEnd(bestof, payload) {
  const started = await bestof['bestof.run'](payload)
  let state = started
  for (let index = 0; index < 300 && state.finished !== true; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
    state = await bestof['bestof.state']({ runId: started.runId })
  }
  return state
}

describe('bestof.estimate · 形状与只读', () => {
  it('返回 {routes:[{provider,model,modelName}], inputTokens, price:"unknown"}，不落盘、不试跑', async () => {
    const { bestof, session, llm, sandbox } = await scene()
    const estimate = await bestof['bestof.estimate']({
      sessionId: session.sessionId,
      question: QUESTION,
      routes: [{ provider: 'pi-ai' }, { provider: 'deepseek', model: 'deepseek-reasoner' }],
    })

    expect(Object.keys(estimate).sort()).toEqual(['inputTokens', 'price', 'routes'])
    expect(estimate.price).toBe('unknown')
    expect(estimate.routes).toEqual([
      { provider: 'pi-ai', model: 'pi-chat', modelName: 'Pi Chat' },
      { provider: 'deepseek', model: 'deepseek-reasoner', modelName: null },
    ])
    expect(Number.isInteger(estimate.inputTokens)).toBe(true)
    expect(estimate.inputTokens).toBeGreaterThan(0)

    // 只读：没有跑模型、没有落合参记录。
    expect(llm.calls).toHaveLength(0)
    expect(sandbox.exists('consult', `${session.sessionId}.bestof.json`)).toBe(false)
  })

  it('inputTokens 与真跑时喂进候选的文本同源（同一个 buildCandidatePrompt）', async () => {
    const { bestof, session, llm } = await scene()
    const routes = [{ provider: 'deepseek' }, { provider: 'pi-ai' }]
    const estimate = await bestof['bestof.estimate']({ sessionId: session.sessionId, question: QUESTION, routes })
    await runToEnd(bestof, { sessionId: session.sessionId, question: QUESTION, routes, confirm: true })

    const candidate = llm.calls.find((call) => call.system?.includes('本候选视角'))
    const prompt = candidate.messages[0].content.map((block) => block.text).join('\n')
    // estimate 的换算口径就是「字数 ÷ 1.5 向上取整」（与挂载预算同一个保守口径）。
    expect(estimate.inputTokens).toBe(Math.ceil(prompt.length / 1.5))
  })

  it('buildCandidatePrompt 是候选 prompt 的唯一构造点（材料 + 历史 + 问题）', () => {
    expect(buildCandidatePrompt({ question: '问', context: '材料', history: '历史' }))
      .toBe('材料\n\n历史\n\n【本次合参的问题】\n问')
    expect(buildCandidatePrompt({ question: '问', context: '', history: '' })).toBe('问')
  })

  it('路由不可解析（1 路 / 未知 provider）→ estimate 也当场可读失败', async () => {
    const { bestof, session, llm } = await scene()
    const generic = llm.service.listModels
    llm.service.listModels = async (provider) => {
      if (provider === 'nope') throw new Error('未知 provider')
      return generic(provider)
    }
    await expect(bestof['bestof.estimate']({ sessionId: session.sessionId, question: QUESTION, routes: [{ provider: 'deepseek' }] }))
      .rejects.toThrow(/至少两路|2–4|2-4/u)
    await expect(bestof['bestof.estimate']({
      sessionId: session.sessionId,
      question: QUESTION,
      routes: [{ provider: 'nope' }, { provider: 'pi-ai' }],
    })).rejects.toThrow(/取不到 provider nope/u)
  })
})

describe('bestof.run · 无确认不跑（needs-confirmation 带 estimate）', () => {
  it('routes 未确认 → 拒绝，错误里带着同一份 estimate，且什么都没跑', async () => {
    const { bestof, session, llm, sandbox } = await scene()
    const routes = [{ provider: 'deepseek' }, { provider: 'pi-ai' }]
    const error = await bestof['bestof.run']({ sessionId: session.sessionId, question: QUESTION, routes })
      .then(() => null, (caught) => caught)

    expect(error.xuanshuCode).toBe('needs-confirmation')
    expect(error.details.estimate.price).toBe('unknown')
    expect(error.details.estimate.routes.map((route) => route.provider)).toEqual(['deepseek', 'pi-ai'])
    expect(llm.calls).toHaveLength(0)
    expect(sandbox.exists('consult', `${session.sessionId}.bestof.json`)).toBe(false)
  })

  it('confirm === true 才开跑（estimate 照常先算一次；同一份 routes）', async () => {
    const { bestof, session, llm } = await scene()
    const routes = [{ provider: 'deepseek' }, { provider: 'pi-ai' }]
    const estimate = await bestof['bestof.estimate']({ sessionId: session.sessionId, question: QUESTION, routes })
    const state = await runToEnd(bestof, { sessionId: session.sessionId, question: QUESTION, routes, confirm: true })

    expect(state.finished).toBe(true)
    expect(state.candidates.map((candidate) => candidate.provider)).toEqual(['deepseek', 'pi-ai'])
    expect(llm.calls.filter((call) => call.system?.includes('本候选视角'))).toHaveLength(2)
    // estimate 与真跑用的是同一份路由解析（不是两套回落）。
    expect(estimate.routes.map((route) => [route.provider, route.model])).toEqual([['deepseek', 'deepseek-chat'], ['pi-ai', 'pi-chat']])
  })

  it('legacy 路径（不传 routes）保持原样：不需要 confirm', async () => {
    const { bestof, session } = await scene()
    const state = await runToEnd(bestof, { sessionId: session.sessionId, question: QUESTION })
    expect(state.candidates).toHaveLength(2)
    expect(state.candidates.every((candidate) => candidate.provider === 'deepseek')).toBe(true)
  })
})
