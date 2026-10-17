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
import { assistantEvent, fakeSessionQuery, makeHost, makeSandbox, seedPu, userEvent } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

const QUESTION = '这次转岗的时机怎么样？'

/** 两路候选的剧本（经典 / 审慎），judge 成功调用工具。 */
const CANDIDATE_TEXTS = ['经典派：先看大方向。', '审慎派：先核对前提。']

/**
 * 起一套宿主：consult（建会话）+ bestof（本票）+ 假 llm。
 * @param {object} options `judgePlan` 覆盖 judge 那一次调用的剧本；`now` 注入候选耗时用的时钟；
 *        `pus` / `digao` 用来验「候选看到的是这场问事的上下文」（下面那条哨兵用例）
 */
async function scene({ judgePlan, plans, price, now, pus = [], digao = false, pu, sessionQuery } = {}) {
  const sandbox = makeSandbox('bestof')
  roots.push(sandbox)
  if (digao) sandbox.write('digao.md', '# 底稿\nDIGAO_SENTINEL\n')
  // 谱要在**读它之前**落盘：候选的材料与边界的上下文都是「那一刻现读」的，晚一步就只能读到「读不出来」。
  if (pu !== undefined) seedPu(sandbox, pu)
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
      ...(sessionQuery === undefined ? {} : { sessionQuery: sessionQuery.service }),
    },
  })
  const consult = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
  const { session } = await consult['consult.create']({ pus })
  const bestof = createBestOfMethods(host.ctx, { dataDir: sandbox.dataDir, prices: price, now })
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
      // ② **候选带上这场问事的上下文**（底座谱 + 底稿 + 勾选谱 + 挂载，与首轮注入同一份装配）：
      //    候选流不走会话历史，不带这一段的话「结合我的信息」这类问题在合参里答不出来 ——
      //    评审的探针实测过一次（候选只拿到一句裸问题）。
      expect(call.messages).toHaveLength(1)
      const prompt = call.messages[0].content.map((block) => block.text).join('\n')
      expect(prompt).toContain('【来源：底座谱】')
      expect(prompt).toContain('【来源：底稿】')
      expect(prompt).toContain('【本次合参的问题】')
      expect(prompt).toContain(QUESTION)
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

  it('**候选看到的是这场问事的上下文**：底座谱 / 底稿 / 勾选谱都进了候选的提示（评审发现的那一处）', async () => {
    const { bestof, llm, session } = await scene({
      pus: ['软件开发'],
      digao: true,
      pu: { name: '软件开发', level: 'base', description: '手上的项目。', summary: 'PU_SUMMARY_SENTINEL' },
    })

    await runToEnd(bestof, { sessionId: session.sessionId, question: '结合我的信息建议怎么做？' })

    const candidateCalls = llm.calls.filter((call) => call.system?.includes('本候选视角'))
    expect(candidateCalls).toHaveLength(2)
    for (const call of candidateCalls) {
      const prompt = call.messages[0].content.map((block) => block.text).join('\n')
      // 三个哨兵各来自一个来源：底座谱（没起盘 → 写明「底座未立」也算带上了这一段）、
      // 底稿全文、勾选谱的概览 / summary。
      expect(prompt).toContain('【来源：底座谱】')
      expect(prompt).toContain('DIGAO_SENTINEL')
      expect(prompt).toContain('【来源：谱 软件开发】')
      expect(prompt).toContain('PU_SUMMARY_SENTINEL')
    }
    // judge 仍然**不带**上下文（H4：判官只看问题与候选）——候选带了不等于判官也带。
    const judgeCall = llm.calls.at(-1)
    expect(JSON.stringify(judgeCall.messages)).not.toContain('PU_SUMMARY_SENTINEL')
    expect(JSON.stringify(judgeCall.messages)).not.toContain('DIGAO_SENTINEL')
  })

  it('候选带上**会话文本历史**（含被采用的合参稿）；判官与合并槽不带（评审 R5）', async () => {
    // 评审的场景：第二轮说「沿用刚才已经采用的那份方案」——候选必须能取到上一轮的问答与采用稿。
    const query = fakeSessionQuery()
    const { bestof, llm, session } = await scene({ sessionQuery: query })
    query.events[session.sessionId] = [
      userEvent(1, { id: 'm-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '第一轮：预算怎么定？' }] }),
      assistantEvent(2, 'ANSWER_SENTINEL：先按 3000/月 试算。'),
      // 被采用的那一份合参稿（ADR-0010 第 5 条：历史只带采用稿；落选候选根本不在日志里）。
      userEvent(3, { id: 'm-3', role: 'user', source: { kind: 'xuanshu-bestof-adopted' }, content: [{ type: 'text', text: 'ADOPTED_SENTINEL：方案 A，3000/月。' }] }),
      // 我们注入过的资料不该再进历史（它已经作为「材料」单独给了候选）。
      userEvent(4, { id: 'm-4', role: 'user', source: { kind: 'xuanshu-consult' }, content: [{ type: 'text', text: 'MATERIAL_SENTINEL' }] }),
    ]

    await runToEnd(bestof, { sessionId: session.sessionId, question: '沿用刚才采用的方案，下一步做什么？' })

    const candidateCalls = llm.calls.filter((call) => call.system?.includes('本候选视角'))
    expect(candidateCalls).toHaveLength(2)
    for (const call of candidateCalls) {
      const prompt = call.messages[0].content.map((block) => block.text).join('\n')
      expect(prompt).toContain('【这场问事的历史】')
      expect(prompt).toContain('用户：第一轮：预算怎么定？')
      expect(prompt).toContain('助手：ANSWER_SENTINEL：先按 3000/月 试算。')
      expect(prompt).toContain('已采用的合参稿：ADOPTED_SENTINEL：方案 A，3000/月。')
      expect(prompt, '注入的资料不该重复进历史').not.toContain('MATERIAL_SENTINEL')
      // 历史排在材料之后、问题之前（同一份 user 消息里的顺序也是被验的东西）。
      expect(prompt.indexOf('【这场问事的历史】')).toBeGreaterThan(prompt.indexOf('【来源：底座谱】'))
      expect(prompt.indexOf('【这场问事的历史】')).toBeLessThan(prompt.indexOf('【本次合参的问题】'))
    }
    // 判官 / 合并槽继续遵守各自的边界：不带历史（也不带材料）。
    const judgeCall = llm.calls.at(-1)
    expect(JSON.stringify(judgeCall.messages)).not.toContain('【这场问事的历史】')
    expect(JSON.stringify(judgeCall.messages)).not.toContain('ADOPTED_SENTINEL')
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

  it('两路 usage 各自记着（打桩值，不当实测值）+ 耗时由**注入时钟**确定', async () => {
    // 原来的断言是 `elapsedMs >= 0` —— `Date.now()` 差恒非负，**永远不会红**，等于没断言。
    // 改成：注入一个每次读数 +250ms 的计数时钟，耗时就变成可算的确定值。
    // 调用次序是确定的：`record.candidates.map(async …)` 同步发起两路 → 两次 `now()` 记起点，
    // 两次记终点（哪一路先结束都不影响「终点晚于两个起点」这个事实）→ 两路各读到 2 个刻度。
    const STEP = 250
    let clock = 0
    const readings = []
    const now = () => { clock += STEP; readings.push(clock); return clock }

    const { bestof, session } = await scene({ now })
    const { state } = await runToEnd(bestof, { sessionId: session.sessionId, question: QUESTION })

    expect(state.candidates[0].usage).toEqual(STUB_USAGE)
    expect(state.candidates[1].usage).toEqual({ inputTokens: 800, outputTokens: 400, totalTokens: 1200 })

    // 耗时的**确定性**期望值：2 个 STEP（值写死，不由被测实现反推 —— 否则又是恒真断言）。
    expect(state.candidates[0].elapsedMs).toBe(2 * STEP)
    expect(state.candidates[1].elapsedMs).toBe(2 * STEP)
    // 并且确实是从注入的时钟读的（真钟不可能正好落在这个刻度序列上）。
    expect(readings.length).toBeGreaterThanOrEqual(4)
    expect(readings.every((value) => value % STEP === 0)).toBe(true)
  })
})
