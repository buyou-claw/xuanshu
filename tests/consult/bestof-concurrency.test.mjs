/**
 * 票 28 · 并发上限 4 + 每路独立 abort / 超时（单路失败不拖累其它路）。
 *
 * 抓的正是侦察笔记里的「信号语义冲突」：`execute()` 原来拿**本轮** signal 判每一路，
 * 一路超时会把全部候选标成 `stopped`。这里钉住两件事：
 *   ① 同时进入 `stream()` 的候选 ≤ 4（5 路也最多 4 路在飞）；
 *   ② 某一路超时只让**那一路**失败，其余照常 `done`；`bestof.cancel` 仍然让全部 `stopped`。
 */
import { afterEach, describe, expect, it } from 'vitest'

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

async function scene({ plans, routeTimeoutMs, maxConcurrency } = {}) {
  const sandbox = makeSandbox('bestof-concurrency')
  roots.push(sandbox)
  const agents = fakeAgents()
  const llm = fakeLlm(plans ?? [{ text: '第一份。' }, { text: '第二份。' }], { providers: PROVIDERS })
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
  const bestof = createBestOfMethods(host.ctx, {
    dataDir: sandbox.dataDir,
    ...(routeTimeoutMs === undefined ? {} : { routeTimeoutMs }),
    ...(maxConcurrency === undefined ? {} : { maxConcurrency }),
  })
  return { sandbox, host, llm, bestof, session }
}

async function runToEnd(bestof, payload) {
  const started = await bestof['bestof.run'](payload)
  let state = started
  for (let index = 0; index < 400 && state.finished !== true; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
    state = await bestof['bestof.state']({ runId: started.runId })
  }
  return { started, state }
}

describe('并发上限', () => {
  it('5 路候选：同一时刻进入 stream 的最多 4 路', async () => {
    const { bestof, session, llm } = await scene()
    let inFlight = 0
    let peak = 0
    const original = llm.service.stream
    llm.service.stream = (options) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      const inner = original(options)
      return (async function* () {
        try {
          for await (const chunk of inner) yield chunk
        } finally {
          inFlight -= 1
        }
      })()
    }

    const profileIds = ['p1', 'p2', 'p3', 'p4', 'p5']
    const { state } = await runToEnd(bestof, { sessionId: session.sessionId, question: QUESTION, profileIds })
    expect(state.candidates).toHaveLength(5)
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBe(4)
  })
})

describe('每路超时：只失败那一路', () => {
  it('慢的一路超时 → 标 error（写明超时），快的一路照常 done；判官因只剩一份而跳过', async () => {
    const { bestof, session, llm } = await scene({
      routeTimeoutMs: 25,
      plans: [{ text: '快的一份。' }, { text: '慢的一份。', delay: 200 }],
    })
    const { state } = await runToEnd(bestof, {
      sessionId: session.sessionId,
      question: QUESTION,
      routes: [{ provider: 'deepseek' }, { provider: 'pi-ai' }],
      confirm: true,
    })

    expect(state.candidates[0].status).toBe('done')
    expect(state.candidates[0].text).toBe('快的一份。')
    expect(state.candidates[1].status).toBe('error')
    expect(state.candidates[1].error).toMatch(/超时/u)
    // 单路失败不是「本轮被停」：不跑判官，但排序仍按可用的一份。
    expect(state.judge.mode).toBe('skipped')
    expect(state.finished).toBe(true)

    // 每路拿到的 signal 是各自独立的：超时那一路被 abort，另一路没有。
    const candidateCalls = llm.calls.filter((call) => call.system?.includes('本候选视角'))
    expect(candidateCalls).toHaveLength(2)
    expect(candidateCalls[1].signal.aborted).toBe(true)
    expect(candidateCalls[0].signal.aborted).toBe(false)
  })

  it('本轮 cancel 仍让全部 stopped（不能把「这一路超时」错当成本轮停止）', async () => {
    const { bestof, session } = await scene({
      routeTimeoutMs: 10_000,
      plans: [{ text: '先产出。', hold: 300, pieces: 1 }, { text: '更慢。', delay: 400 }],
    })
    const started = await bestof['bestof.run']({
      sessionId: session.sessionId,
      question: QUESTION,
      routes: [{ provider: 'deepseek' }, { provider: 'pi-ai' }],
      confirm: true,
    })
    await new Promise((resolve) => setTimeout(resolve, 60))
    const { bestOf } = await bestof['bestof.cancel']({ runId: started.runId })
    expect(bestOf.finished).toBe(true)
    expect(bestOf.candidates.map((candidate) => candidate.status)).toEqual(['stopped', 'stopped'])
    expect(bestOf.candidates[0].text).toBe('先产出。')
    expect(bestOf.judge.mode).toBe('skipped')
  })

  it('超时的那一路没有产出也收尾（不挂住整轮）：全部超时也会 finished', async () => {
    const { bestof, session } = await scene({
      routeTimeoutMs: 10,
      plans: [{ text: '慢甲。', delay: 200 }, { text: '慢乙。', delay: 200 }],
    })
    const { state } = await runToEnd(bestof, {
      sessionId: session.sessionId,
      question: QUESTION,
      routes: [{ provider: 'deepseek' }, { provider: 'pi-ai' }],
      confirm: true,
    })
    expect(state.candidates.map((candidate) => candidate.status)).toEqual(['error', 'error'])
    expect(state.candidates.every((candidate) => /超时/u.test(candidate.error))).toBe(true)
    expect(state.judge.mode).toBe('skipped')
    expect(state.finished).toBe(true)
  })
})
