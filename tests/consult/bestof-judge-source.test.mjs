/**
 * 票 28 · 判官路由必须**不在候选 provider 集合**里；没有可选时如实降级 `same-source`。
 *
 * 抓的正是「冒充异源」：
 *   ① 候选 deepseek + pi-ai、本机还有 glm → 判官用 glm（`judge.source='cross-source'`）；
 *   ② 候选只有 deepseek（legacy 两视角）、本机还有 pi-ai → 判官用 pi-ai；
 *   ③ 本机只有注册的一家 / 候选已经覆盖所有注册家 → `judge.mode='same-source'`，
 *      文案说清「没有异源判官」，**不发起第三次调用**，排序回落完成顺序；
 *   ④ 判官失败/降级的 `source` 也照样写（不许只在成功路径写「判官是谁」）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createBestOfMethods } from '../../packages/xuanshu-host/lib/consult/bestof.mjs'
import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { fakeAgentDefaultModel, fakeAgents, makeHost, makeSandbox } from './lib/sandbox.mjs'
import { fakeLlm } from './lib/bestof-llm.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

const QUESTION = '这次转岗的时机怎么样？'
const THREE = [
  { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] },
  { id: 'pi-ai', name: 'Pi AI', models: [{ id: 'pi-chat', name: 'Pi Chat' }] },
  { id: 'glm', name: 'GLM', models: [{ id: 'glm-4', name: 'GLM-4' }] },
]

const JUDGE_TOOL = {
  tool: { name: 'submit_judgement', arguments: JSON.stringify({ judgement: { best: 'c1', ranking: ['c1', 'c2'] } }) },
}

async function scene({ providers = THREE, plans } = {}) {
  const sandbox = makeSandbox('bestof-judge-source')
  roots.push(sandbox)
  const agents = fakeAgents()
  const llm = fakeLlm(plans ?? [{ text: '第一份正文。' }, { text: '第二份正文。' }, JUDGE_TOOL], { providers })
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

const judgeCalls = (llm) => llm.calls.filter((call) => call.system?.includes('多 AI 合参的判官'))

describe('judge 路由 · 不在候选 provider 集合里', () => {
  it('候选 deepseek + pi-ai → 判官用第三家 glm（cross-source，判官路由写进记录）', async () => {
    const { bestof, llm, session } = await scene({
      plans: [{ text: '甲。' }, { text: '乙。' }, JUDGE_TOOL],
    })
    const state = await runToEnd(bestof, {
      sessionId: session.sessionId,
      question: QUESTION,
      routes: [{ provider: 'deepseek' }, { provider: 'pi-ai' }],
      confirm: true,
    })

    expect(state.judge.mode).toBe('tool')
    expect(state.judge.source).toBe('cross-source')
    expect(state.judge.provider).toBe('glm')
    expect(state.judge.model).toBe('glm-4')
    expect(judgeCalls(llm).map((call) => call.provider)).toEqual(['glm'])
  })

  it('legacy 两视角（候选只有 deepseek）→ 判官用另一家 pi-ai', async () => {
    const { bestof, llm, session } = await scene()
    const state = await runToEnd(bestof, { sessionId: session.sessionId, question: QUESTION })
    expect(state.judge.source).toBe('cross-source')
    expect(judgeCalls(llm).map((call) => call.provider)).toEqual(['pi-ai'])
  })

  it('只有一家已注册 / 候选覆盖所有家 → same-source：不冒充异源、不发起判官调用、排序回落完成顺序', async () => {
    const onlyOne = await scene({
      providers: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }],
    })
    const state = await runToEnd(onlyOne.bestof, { sessionId: onlyOne.session.sessionId, question: QUESTION })

    expect(state.judge.mode).toBe('same-source')
    expect(state.judge.source).toBe('same-source')
    expect(state.judge.error).toMatch(/同源|没有.*另一家|没有异源/u)
    expect(state.judge.ranking).toEqual(['c1', 'c2'])
    expect(state.judge.provider).toBeUndefined()
    // 两路候选，没有第三次（判官）调用 —— 不拿同源模型假装异源判官。
    expect(onlyOne.llm.calls).toHaveLength(2)

    // 候选覆盖所有已注册家（deepseek + pi-ai）时同样降级。
    const covered = await scene({
      providers: THREE.slice(0, 2),
      plans: [{ text: '甲。' }, { text: '乙。' }],
    })
    const coveredState = await runToEnd(covered.bestof, {
      sessionId: covered.session.sessionId,
      question: QUESTION,
      routes: [{ provider: 'deepseek' }, { provider: 'pi-ai' }],
      confirm: true,
    })
    expect(coveredState.judge.mode).toBe('same-source')
    expect(coveredState.judge.error).toMatch(/没有异源|同源/u)
    expect(covered.llm.calls).toHaveLength(2)
  })

  it('判官失败时也写 source（不许只在成功路径写「判官是谁」）', async () => {
    const { bestof, session } = await scene({
      plans: [{ text: '甲。' }, { text: '乙。' }, { text: '', finish: { kind: 'error', failure: { code: 'RATE_LIMIT' } } }],
    })
    const state = await runToEnd(bestof, { sessionId: session.sessionId, question: QUESTION })
    expect(state.judge.mode).toBe('failed')
    expect(state.judge.source).toBe('cross-source')
    expect(state.judge.provider).toBe('pi-ai')
    expect(state.judge.error).toMatch(/判官调用失败/u)
  })

  it('判官调用本身抛错 → mode=failed（不是 tool）、带原因、排序回落完成顺序', async () => {
    // 剧本按调用次序：c1 / c2 正常返回，第 3 次（判官）直接抛 —— 走 `collectJudge` 的 catch 路径。
    const throwOnJudge = (options, index) => {
      if (index === 2) throw new Error('adapter 连接被断开')
      return { text: index === 0 ? '甲。' : '乙。' }
    }
    const { bestof, session } = await scene({ plans: throwOnJudge })
    const state = await runToEnd(bestof, { sessionId: session.sessionId, question: QUESTION })

    // `mode` 记的是「这次判定是怎么来的」：一次抛错的调用没走过工具判定，不能报 'tool'。
    expect(state.judge.mode).toBe('failed')
    expect(state.judge.source).toBe('cross-source')
    expect(state.judge.provider).toBe('pi-ai')
    expect(state.judge.error).toMatch(/判官调用失败/u)
    expect(state.judge.error).toMatch(/adapter 连接被断开/u)
    expect(state.judge.ranking).toEqual(['c1', 'c2'])
    expect(state.judge.adoptedId).toBe('c1')
  })
})
