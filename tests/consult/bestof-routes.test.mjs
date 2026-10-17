/**
 * 票 28 · 合参入参 `routes: {provider, model}[]`（2–4 路，按 `provider::model` 去重）。
 *
 * 三条必须能红的判据：
 *   ① **3 路不同 provider 真跑出 3 张候选**（旧实现只有两个视角，结构上做不出 3 路）；
 *   ② 去重：同一个 `{provider,model}` 不给它跑两遍；去重后不足两路 → 当场拒绝；
 *   ③ 缺 model 才回落该家第一个模型；显式 model 原样使用。
 * 另外：`routes` 路径必须先确认（`confirm === true`），否则回 `needs-confirmation` + estimate。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createBestOfMethods, resolveRoutes } from '../../packages/xuanshu-host/lib/consult/bestof.mjs'
import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { fakeAgentDefaultModel, fakeAgents, makeHost, makeSandbox } from './lib/sandbox.mjs'
import { fakeLlm } from './lib/bestof-llm.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

const QUESTION = '这次转岗的时机怎么样？'
const THREE_PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] },
  { id: 'pi-ai', name: 'Pi AI', models: [{ id: 'pi-chat', name: 'Pi Chat' }] },
  { id: 'glm', name: 'GLM', models: [{ id: 'glm-4', name: 'GLM-4' }] },
]

async function scene({ providers = THREE_PROVIDERS, plans } = {}) {
  const sandbox = makeSandbox('bestof-routes')
  roots.push(sandbox)
  const agents = fakeAgents()
  const llm = fakeLlm(plans ?? [{ text: '甲。' }, { text: '乙。' }, { text: '丙。' }, { tool: { name: 'submit_judgement', arguments: JSON.stringify({ judgement: { best: 'c1', ranking: ['c1', 'c2', 'c3'] } }) } }], { providers })
  const host = makeHost({
    services: {
      agents: agents.service,
      agentPresets: { resolve: async () => ({ id: 'standard' }), mount: async () => ({}) },
      agentDefaultModel: fakeAgentDefaultModel().service,
      llm: llm.service,
    },
  })
  const consult = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
  const { session } = await consult['consult.create']({ pus: [] })
  const bestof = createBestOfMethods(host.ctx, { dataDir: sandbox.dataDir })
  return { sandbox, host, llm, consult, bestof, session }
}

async function runToEnd(bestof, payload) {
  const started = await bestof['bestof.run'](payload)
  let state = started
  for (let index = 0; index < 300 && state.finished !== true; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
    state = await bestof['bestof.state']({ runId: started.runId })
  }
  return { started, state }
}

const candidateCalls = (llm) => llm.calls.filter((call) => call.system?.includes('本候选视角'))

describe('resolveRoutes · 2–4 路、去重、缺 model 回落', () => {
  it('3 路不同 provider：候选数由 routes.length 决定（不是 angles），缺 model 才回落第一个模型', async () => {
    const { bestof, llm, session } = await scene()
    const routes = [{ provider: 'deepseek' }, { provider: 'pi-ai' }, { provider: 'glm' }]
    const { state } = await runToEnd(bestof, { sessionId: session.sessionId, question: QUESTION, routes, confirm: true })

    expect(state.candidates).toHaveLength(3)
    expect(state.candidates.map((candidate) => candidate.provider)).toEqual(['deepseek', 'pi-ai', 'glm'])
    expect(state.candidates.map((candidate) => candidate.model)).toEqual(['deepseek-chat', 'pi-chat', 'glm-4'])
    expect(state.candidates.map((candidate) => candidate.angle)).toEqual(['classic', 'cautious', 'classic'])
    expect(candidateCalls(llm).map((call) => call.provider)).toEqual(['deepseek', 'pi-ai', 'glm'])
    // 每一路都真的请求了模型（不是把同一份答案发三遍）。
    expect(candidateCalls(llm)).toHaveLength(3)
  })

  it('显式 model 原样使用（catalog 只是建议，不在请求前改写）', async () => {
    const { bestof, llm, session } = await scene()
    const { state } = await runToEnd(bestof, {
      sessionId: session.sessionId,
      question: QUESTION,
      routes: [{ provider: 'deepseek', model: 'deepseek-reasoner' }, { provider: 'pi-ai', model: 'pi-chat' }],
      confirm: true,
    })
    expect(state.candidates.map((candidate) => candidate.model)).toEqual(['deepseek-reasoner', 'pi-chat'])
    expect(candidateCalls(llm).map((call) => call.model)).toEqual(['deepseek-reasoner', 'pi-chat'])
  })

  it('按 provider::model 去重：同一路给两遍只跑一次；去重后不足两路 → 可读拒绝', async () => {
    const { bestof, llm, session } = await scene()
    const deduped = await runToEnd(bestof, {
      sessionId: session.sessionId,
      question: QUESTION,
      routes: [{ provider: 'deepseek' }, { provider: 'deepseek' }, { provider: 'pi-ai' }],
      confirm: true,
    })
    expect(deduped.state.candidates).toHaveLength(2)
    expect(deduped.state.candidates.map((candidate) => candidate.provider)).toEqual(['deepseek', 'pi-ai'])
    expect(candidateCalls(llm)).toHaveLength(2)

    await expect(bestof['bestof.run']({
      sessionId: session.sessionId,
      question: QUESTION,
      routes: [{ provider: 'deepseek' }, { provider: 'deepseek' }],
      confirm: true,
    })).rejects.toThrow(/至少两路|去重/u)
  })

  it('数量闸：1 路 / 5 路 / 空数组 / 非数组都当场拒绝', async () => {
    const { bestof, session } = await scene()
    for (const [routes, pattern] of [
      [[{ provider: 'deepseek' }], /至少两路|2–4|2-4/u],
      [[{ provider: 'deepseek' }, { provider: 'pi-ai' }, { provider: 'glm' }, { provider: 'gpt' }, { provider: 'qwen' }], /最多四路|2–4|2-4/u],
      [[], /至少两路|2–4|2-4/u],
      ['deepseek', /数组/u],
    ]) {
      await expect(bestof['bestof.run']({ sessionId: session.sessionId, question: QUESTION, routes, confirm: true })).rejects.toThrow(pattern)
    }
  })

  it('未知 provider（且没给 model）→ 可读失败，不是静默丢一路', async () => {
    const { bestof, session, llm } = await scene()
    // 只有真 catalog 会拒未知 provider；假 llm 默认给任意 provider 造一个模型（legacy 用例需要），
    // 这里把未知 provider 的失败形态显式造出来。
    const generic = llm.service.listModels
    llm.service.listModels = async (provider) => {
      if (provider === 'nope') throw new Error('未知 provider')
      return generic(provider)
    }
    await expect(resolveRoutes({ get: () => ({ listModels: async () => { throw new Error('未知 provider') } }) }, {
      routes: [{ provider: 'nope' }, { provider: 'pi-ai' }],
    })).rejects.toThrow(/取不到 provider nope 的模型列表/u)
    await expect(bestof['bestof.run']({
      sessionId: session.sessionId,
      question: QUESTION,
      routes: [{ provider: 'nope' }, { provider: 'pi-ai' }],
      confirm: true,
    })).rejects.toThrow(/取不到 provider nope/u)
  })

  it('routes 与显式 angles 数量对不上 → 拒绝（不许静默丢候选）', async () => {
    const { bestof, session } = await scene()
    await expect(bestof['bestof.run']({
      sessionId: session.sessionId,
      question: QUESTION,
      routes: [{ provider: 'deepseek' }, { provider: 'pi-ai' }, { provider: 'glm' }],
      angles: ['classic', 'cautious'],
      confirm: true,
    })).rejects.toThrow(/angles|视角/u)
  })

  it('routes 路径必须先确认：没有 confirm === true → needs-confirmation + estimate，且不落盘、不开跑', async () => {
    const { bestof, session, sandbox, llm } = await scene()
    const error = await bestof['bestof.run']({
      sessionId: session.sessionId,
      question: QUESTION,
      routes: [{ provider: 'deepseek' }, { provider: 'pi-ai' }],
    }).then(() => null, (caught) => caught)

    expect(error).not.toBeNull()
    expect(error.xuanshuCode).toBe('needs-confirmation')
    expect(error.message).toMatch(/needs-confirmation|确认/u)
    expect(error.details.estimate.price).toBe('unknown')
    expect(error.details.estimate.routes.map((route) => [route.provider, route.model])).toEqual([['deepseek', 'deepseek-chat'], ['pi-ai', 'pi-chat']])
    expect(llm.calls).toHaveLength(0)
    expect(sandbox.exists('consult', `${session.sessionId}.bestof.json`)).toBe(false)
  })
})
