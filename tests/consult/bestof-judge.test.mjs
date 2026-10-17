/**
 * 票 11 · judge 的三条负路径 + prompt-json 降级（ADR-0010，契约 §1）。
 *
 * ADR-0010 把「回落」写成**规格的一部分**，所以三条负路径必须有断言，否则这条规格等于没测：
 *   ① 模型**没调工具**；② 工具的 `arguments` **不是合法 JSON**；③ 合法 JSON 但**不合 schema**。
 * 三条都必须：`judge.error` 说明原因、`ranking` 回落**完成顺序**、`adoptedId` 停在判官视角的
 * 第一位、**绝不自动采用**（`record.adoptedId` 仍是 null —— C9「拍板在人」）。
 *
 * 另有一条降级：模型不能调工具、但正文里给了 JSON → `judge.mode = 'prompt-json'`
 * （ADR-0010 的降级路径与它的可观察事实）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createBestOfMethods } from '../../packages/xuanshu-host/lib/consult/bestof.mjs'
import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { fakeAgentDefaultModel, fakeAgents, makeHost, makeSandbox } from './lib/sandbox.mjs'
import { fakeLlm } from './lib/bestof-llm.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

const QUESTION = '这次转岗的时机怎么样？'

/** 两路候选：`firstDelay` 让「完成顺序」可控（默认 c1 先完成）。 */
function candidatePlans({ firstDelay = 0, secondDelay = 0 } = {}) {
  return [
    { text: '第一份正文。', delay: firstDelay },
    { text: '第二份正文。', delay: secondDelay },
  ]
}

async function scene({ judgePlan, plans = candidatePlans() } = {}) {
  const sandbox = makeSandbox('bestof-judge')
  roots.push(sandbox)
  const agents = fakeAgents()
  const llm = fakeLlm([...plans, judgePlan ?? {}])
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

async function runToEnd(bestof, sessionId) {
  const started = await bestof['bestof.run']({ sessionId, question: QUESTION })
  let state = started
  for (let index = 0; index < 200 && state.finished !== true; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
    state = await bestof['bestof.state']({ runId: started.runId })
  }
  return state
}

/** 落盘的记录（判官这一轮的全量账）。 */
const recordOf = (sandbox, sessionId) => sandbox.json('consult', `${sessionId}.bestof.json`)

describe('judge 负路径 · 回落完成顺序第一份（ADR-0010 第 2 条）', () => {
  it('① 没调工具（正文也没有 JSON）→ error 说明、ranking 回落、不自动采用', async () => {
    const { bestof, session, sandbox } = await scene({ judgePlan: { text: '我觉得第一份更好一些。' } })
    const state = await runToEnd(bestof, session.sessionId)

    // 来源如实：**没有来源就报没有来源**（这条断言原来写的是 'tool' —— 它记录的是一次
    // 没发生过的工具调用；ADR-0010 说 mode 记的是这次判定到底怎么来的）。
    expect(state.judge.mode).toBe('failed')
    expect(state.judge.error).toMatch(/没有调用 submit_judgement/u)
    expect(state.judge.error).toMatch(/没有来源/u)
    expect(state.judge.ranking).toEqual(['c1', 'c2'])
    expect(state.judge.adoptedId).toBe('c1')
    // C9：判官不给结论 ≠ 系统替人拍板。
    expect(recordOf(sandbox, session.sessionId).adoptedId).toBeNull()
  })

  it('② arguments 不是合法 JSON → error 指向 JSON 解析，ranking 仍回落', async () => {
    const { bestof, session } = await scene({
      judgePlan: { tool: { name: 'submit_judgement', arguments: '{ judgement: not-json' } },
    })
    const state = await runToEnd(bestof, session.sessionId)

    expect(state.judge.mode).toBe('tool')
    expect(state.judge.error).toMatch(/不是合法 JSON/u)
    expect(state.judge.ranking).toEqual(['c1', 'c2'])
    expect(state.judge.reasons).toBeUndefined()
  })

  it('③ 合法 JSON 但不合 schema（best 指向未知候选）→ error 指向字段校验', async () => {
    const { bestof, session } = await scene({
      judgePlan: {
        tool: { name: 'submit_judgement', arguments: JSON.stringify({ judgement: { best: 'c9', ranking: ['c1', 'c2'] } }) },
      },
    })
    const state = await runToEnd(bestof, session.sessionId)

    expect(state.judge.mode).toBe('tool')
    expect(state.judge.error).toMatch(/judgement\.best/u)
    expect(state.judge.ranking).toEqual(['c1', 'c2'])
  })

  it('③b ranking 里有重复 / 为空 → 同样回落（schema 是逐字段校验，不是只看 best）', async () => {
    const duplicated = await scene({
      judgePlan: {
        tool: { name: 'submit_judgement', arguments: JSON.stringify({ judgement: { best: 'c1', ranking: ['c1', 'c1'] } }) },
      },
    })
    const first = await runToEnd(duplicated.bestof, duplicated.session.sessionId)
    expect(first.judge.error).toMatch(/重复/u)

    const empty = await scene({
      judgePlan: { tool: { name: 'submit_judgement', arguments: JSON.stringify({ judgement: { best: 'c1', ranking: [] } }) } },
    })
    const second = await runToEnd(empty.bestof, empty.session.sessionId)
    expect(second.judge.error).toMatch(/非空数组/u)
  })

  it('回落按**完成顺序**：第二路先写完 → 它排第一（不是路由顺序）', async () => {
    const { bestof, session } = await scene({
      plans: candidatePlans({ firstDelay: 30 }),
      judgePlan: { text: '没有工具也没有 JSON。' },
    })
    const state = await runToEnd(bestof, session.sessionId)

    expect(state.judge.ranking).toEqual(['c2', 'c1'])
    expect(state.judge.adoptedId).toBe('c2')
    // 来源如实（ADR-0010：`mode` 记的是这次判定**到底怎么来的**）：既没调工具、正文也没有 JSON
    // → 不能报 'tool'（那是说一件没发生的事），报 'failed' 并说明「没有来源」。
    expect(state.judge.mode).toBe('failed')
    expect(state.judge.error).toMatch(/没有来源/u)
  })
})

describe('judge 降级路径 · prompt-json（ADR-0010 的退路被显式登记）', () => {
  it('没调工具但正文给了 JSON → mode=prompt-json，排序生效且没有 error', async () => {
    const { bestof, session } = await scene({
      judgePlan: { text: '```json\n{"judgement":{"best":"c2","ranking":["c2","c1"],"reasons":{"c2":"更审慎"}}}\n```' },
    })
    const state = await runToEnd(bestof, session.sessionId)

    expect(state.judge.mode).toBe('prompt-json')
    expect(state.judge.error).toBeUndefined()
    expect(state.judge.adoptedId).toBe('c2')
    expect(state.judge.ranking).toEqual(['c2', 'c1'])
    expect(state.judge.reasons).toEqual({ c2: '更审慎' })
  })

  it('降级路径的 JSON 不合 schema → 一样回落（降级不等于放松校验）', async () => {
    const { bestof, session } = await scene({
      judgePlan: { text: '{"judgement":{"best":"c1","ranking":["c1","c9"]}}' },
    })
    const state = await runToEnd(bestof, session.sessionId)
    expect(state.judge.mode).toBe('prompt-json')
    expect(state.judge.error).toMatch(/未知候选/u)
    expect(state.judge.ranking).toEqual(['c1', 'c2'])
  })
})

describe('judge 调用本身失败 / 只有一份候选', () => {
  it('judge 那一路 error finish → error 记「判官调用失败」，排序仍回落', async () => {
    const { bestof, session } = await scene({
      judgePlan: { text: '', finish: { kind: 'error', failure: { code: 'RATE_LIMIT' } } },
    })
    const state = await runToEnd(bestof, session.sessionId)

    expect(state.judge.error).toMatch(/判官调用失败/u)
    expect(state.judge.error).toMatch(/RATE_LIMIT/u)
    expect(state.judge.ranking).toEqual(['c1', 'c2'])
  })

  it('只有一份候选可用 → 不跑判官（judge.skipped），也不替人采用', async () => {
    const { bestof, session, llm } = await scene({
      plans: [{ text: '唯一一份。' }, { text: '', finish: { kind: 'error', failure: { code: 'NO_ADAPTER' } } }],
    })
    const state = await runToEnd(bestof, session.sessionId)

    expect(state.judge.skipped).toBe(true)
    expect(state.judge.mode).toBe('skipped')
    expect(state.judge.ranking).toEqual(['c1'])
    expect(state.candidates.map((candidate) => candidate.status)).toEqual(['done', 'error'])
    expect(state.candidates[1].error).toMatch(/NO_ADAPTER/u)
    // 只调了两路候选，没有第三次（judge）调用。
    expect(llm.calls).toHaveLength(2)
  })

  it('两路都失败 → 记录仍落盘、judge 说明「没有可拍板的东西」', async () => {
    const { bestof, session, sandbox } = await scene({
      plans: [
        { text: '', finish: { kind: 'error', failure: { code: 'AUTH' } } },
        { text: '', finish: { kind: 'error', failure: { code: 'AUTH' } } },
      ],
    })
    const state = await runToEnd(bestof, session.sessionId)

    expect(state.candidates.map((candidate) => candidate.status)).toEqual(['error', 'error'])
    expect(state.judge.mode).toBe('skipped')
    expect(state.judge.error).toMatch(/没有可拍板/u)
    expect(recordOf(sandbox, session.sessionId).finishedAt).toBeDefined()
  })
})
