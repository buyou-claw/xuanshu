/**
 * 票 11 · `bestof.run` 的 2 路并行 + judge 工具调用成功路径（契约 §1，ADR-0010）。
 *
 * 断言只打**外部可观察**的四样东西：RPC 返回值、沙箱里真落的记录文件、
 * 发给 `ctx.llm.stream()` 的入参、以及 judge 的判定结果。
 *
 * 抓的真实缺陷/风险：
 *   ① **候选流带了工具**：票面与 S9 §9 C10/D23 明写候选**不带工具**（候选只回答、不执行动作）→
 *      逐字断言两路候选的 `GenerateOptions.tools` 是空的；
 *   ② **judge 的成功判据被放松成「有文本就行」**：ADR-0010 的成功判据是
 *      「`tool/call` 出现 **且** 参数校验通过」，两条缺一不可；
 *   ③ **视角没注入**：两路必须各带自己的【本候选视角】directive，否则「2 路」只是同一份答案发两遍；
 *   ④ **记录没落盘 / 形状不对**：`<dataDir>/consult/<sessionId>.bestof.json` + schema `xuanshu/bestof@1`。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createBestOfMethods } from '../../packages/xuanshu-host/lib/consult/bestof.mjs'
import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { fakeAgentDefaultModel, fakeAgents } from './lib/sandbox.mjs'
import { fakeLlm, STUB_USAGE } from './lib/bestof-llm.mjs'
import { makeHost, makeSandbox } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

const QUESTION = '这次转岗的时机怎么样？'

/** 两路候选的剧本（经典 / 审慎），judge 成功调用工具。 */
const CANDIDATE_TEXTS = ['经典派：先看大方向。', '审慎派：先核对前提。']

/**
 * 起一套宿主：consult（建会话）+ bestof（本票）+ 假 llm。
 * @param {object} options `judgePlan` 覆盖 judge 那一次调用的剧本
 */
async function scene({ judgePlan, plans, price } = {}) {
  const sandbox = makeSandbox('bestof')
  roots.push(sandbox)
  const agents = fakeAgents()
  const llm = fakeLlm(
    plans ?? [
      { text: CANDIDATE_TEXTS[0], usage: STUB_USAGE },
      { text: CANDIDATE_TEXTS[1], usage: { inputTokens: 800, outputTokens: 400, totalTokens: 1200 } },
      judgePlan ?? {
        text: '按依据充分度排序。',
        tool: {
          name: 'submit_judgement',
          arguments: JSON.stringify({ judgement: { best: 'c1', ranking: ['c1', 'c2'], reasons: { c1: '依据更充分', c2: '结论偏保守' } } }),
        },
        usage: { inputTokens: 500, outputTokens: 100, totalTokens: 600 },
      },
    ],
  )
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
  const bestof = createBestOfMethods(host.ctx, { dataDir: sandbox.dataDir, prices: price })
  return { sandbox, host, llm, consult, bestof, session }
}

/** 等一次 run 结束（本票的 run 是**后台跑**、界面靠 `bestof.state` 轮询）。 */
async function runToEnd(bestof, payload) {
  const started = await bestof['bestof.run'](payload)
  let state = started
  for (let index = 0; index < 200 && state.finished !== true; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
    state = await bestof['bestof.state']({ runId: started.runId })
  }
  return { started, state }
}

describe('bestof.run · 2 路并行（票面「首版 2 路并列流式，不带工具」）', () => {
  it('起两路 stream（各带自己的视角 directive、都不带工具），并给出两份候选正文', async () => {
    const { bestof, llm, session } = await scene()
    const { started, state } = await runToEnd(bestof, { sessionId: session.sessionId, question: QUESTION })

    expect(started.runId).toBe(state.runId)
    expect(state.finished).toBe(true)
    expect(state.candidates).toHaveLength(2)
    expect(state.candidates.map((candidate) => candidate.text)).toEqual(CANDIDATE_TEXTS)
    expect(state.candidates.map((candidate) => candidate.status)).toEqual(['done', 'done'])
    expect(state.candidates.map((candidate) => candidate.id)).toEqual(['c1', 'c2'])

    // ① 候选流不带工具（C10 / D23：「候选只回答、不执行动作」）。
    const candidateCalls = llm.calls.filter((call) => call.system?.includes('本候选视角'))
    expect(candidateCalls).toHaveLength(2)
    for (const call of candidateCalls) {
      expect(call.tools ?? [], '候选流带了工具：候选能动手是产品明令禁止的').toEqual([])
      expect(call.provider).toBe('deepseek')
      expect(call.model).toBe('deepseek-chat')
      expect(call.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: QUESTION }] }])
    }
    // ③ 两路视角必须不同（否则「2 路」只是同一份答案发两遍）。
    const [first, second] = candidateCalls.map((call) => call.system)
    expect(first).toContain('【本候选视角】')
    expect(second).toContain('【本候选视角】')
    expect(first).not.toBe(second)
  })

  it('judge 走单字段工具 submit_judgement：命中工具 + 参数校验通过 = 成功（ADR-0010 的两条判据）', async () => {
    const { bestof, llm, session } = await scene()
    const { state } = await runToEnd(bestof, { sessionId: session.sessionId, question: QUESTION })

    expect(state.judge.mode).toBe('tool')
    expect(state.judge.error).toBeUndefined()
    expect(state.judge.ranking).toEqual(['c1', 'c2'])
    expect(state.judge.adoptedId).toBe('c1')
    expect(state.judge.reasons).toEqual({ c1: '依据更充分', c2: '结论偏保守' })
    expect(state.judge.usage).toEqual({ inputTokens: 500, outputTokens: 100, totalTokens: 600 })

    // judge 那次调用带工具、且工具名与参数 schema 是我们的冻结面。
    const judgeCall = llm.calls.at(-1)
    expect(judgeCall.tools?.map((tool) => tool.name)).toEqual(['submit_judgement'])
    const schema = judgeCall.tools[0].parameters
    expect(schema.required).toEqual(['judgement'])
    expect(Object.keys(schema.properties)).toEqual(['judgement'])
    // H4：判官只看问题与候选，不带挂载 / 谱的正文。
    expect(JSON.stringify(judgeCall.messages)).not.toContain('【来源：')
  })

  it('记录落 <dataDir>/consult/<sessionId>.bestof.json（schema xuanshu/bestof@1）', async () => {
    const { bestof, session, sandbox } = await scene()
    const { state } = await runToEnd(bestof, { sessionId: session.sessionId, question: QUESTION })

    const file = `consult/${session.sessionId}.bestof.json`
    expect(sandbox.files()).toContain(file)
    const record = sandbox.json('consult', `${session.sessionId}.bestof.json`)
    expect(record.schema).toBe('xuanshu/bestof@1')
    expect(record.runId).toBe(state.runId)
    expect(record.sessionId).toBe(session.sessionId)
    expect(record.question).toBe(QUESTION)
    expect(record.candidates.map((candidate) => candidate.id)).toEqual(['c1', 'c2'])
    expect(record.candidates.map((candidate) => candidate.angle)).toEqual(['classic', 'cautious'])
    expect(record.judge.ranking).toEqual(['c1', 'c2'])
    // 采用是**人**的动作：AI 跑完不等于采用。
    expect(record.adoptedId).toBeNull()
    expect(record.rejected).toBe(false)
  })

  it('两路 usage 各自记着（打桩值，不当实测值）', async () => {
    const { bestof, session } = await scene()
    const { state } = await runToEnd(bestof, { sessionId: session.sessionId, question: QUESTION })
    expect(state.candidates[0].usage).toEqual(STUB_USAGE)
    expect(state.candidates[1].usage).toEqual({ inputTokens: 800, outputTokens: 400, totalTokens: 1200 })
    expect(state.candidates[0].elapsedMs).toBeGreaterThanOrEqual(0)
  })
})
