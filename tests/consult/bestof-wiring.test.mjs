/**
 * 票 11 · 装配接线（契约 §1：三个 `bestof.*` 方法进**同一条** `/xuanshu` 通道）。
 *
 * 走**真** `installRpc` + **真** `apply()`（宿主 ctx 是替身），验的是「接线有没有接上」：
 * 通道路径、三个方法名逐字可调、与 `consult.*` / `pu.*` / `cang.*` / `bazi.*` 的合并
 * （不是互相覆盖）、以及记录落在 `config.dataDir` 下的同一个 consult 目录里。
 *
 * 抓的真实缺陷/风险：
 *   ① **方法名写错一个字母**：客户端按 `bestof.run` 调、宿主注册 `bestOf.run`，
 *      症状是界面上「点了没反应」而没有任何报错；
 *   ② **`...createBestOfMethods()` 被后面的展开覆盖**（或漏了展开）：`consult.*` 还在、`bestof.*` 全丢；
 *   ③ **数据目录各写一处**：记录落 A、装配报告写 B。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { apply } from '../../packages/xuanshu-host/lib/index.js'
import { fakeAgentDefaultModel, fakeAgents, makeHost, makeSandbox } from './lib/sandbox.mjs'
import { fakeLlm } from './lib/bestof-llm.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

const QUESTION = '通道里的合参问题？'
const PLAN = [
  { text: '第一份。' },
  { text: '第二份。' },
  { tool: { name: 'submit_judgement', arguments: JSON.stringify({ judgement: { best: 'c1', ranking: ['c1', 'c2'] } }) } },
]

/** 跑一次总装配，返回通道上的一条路由。 */
function assemble() {
  const sandbox = makeSandbox('bestof-wiring')
  roots.push(sandbox)
  const agents = fakeAgents()
  const llm = fakeLlm(PLAN)
  const host = makeHost({
    wired: true,
    services: {
      agents: agents.service,
      agentPresets: { resolve: async () => ({ id: 'standard' }), mount: async () => ({}) },
      agentDefaultModel: fakeAgentDefaultModel().service,
      llm: llm.service,
    },
  })
  apply(host.ctx, { dataDir: sandbox.dataDir, autoStart: false })
  expect(host.routes, '总装配没有注册 /xuanshu 通道').toHaveLength(1)
  return { sandbox, host, agents, llm, route: host.routes[0] }
}

/** 通过 `/xuanshu` 通道调一个方法。 */
function call(route, method, payload = {}) {
  return route.handler(method, payload, new AbortController().signal)
}

const CONTRACT_METHODS = ['bestof.run', 'bestof.state', 'bestof.adopt']

describe('票 11 · 三个方法挂在同一条 /xuanshu 通道上（契约 §1）', () => {
  it('三个方法逐字可调，且与 consult.* / pu.* / cang.* / bazi.* 合并而不是互相覆盖', async () => {
    const { route, sandbox, agents } = assemble()
    expect(route.path).toBe('/xuanshu')

    const created = await call(route, 'consult.create', { pus: [] })
    expect(created.ok, JSON.stringify(created)).toBe(true)
    const sessionId = created.value.session.sessionId

    const started = await call(route, 'bestof.run', { sessionId, question: QUESTION })
    expect(started.ok, `bestof.run 没挂上通道：${JSON.stringify(started)}`).toBe(true)
    const runId = started.value.runId
    expect(started.value.candidates).toHaveLength(2)

    let state = started.value
    for (let index = 0; index < 300 && state.finished !== true; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
      state = (await call(route, 'bestof.state', { runId })).value
    }
    expect(state.finished).toBe(true)

    const adopted = await call(route, 'bestof.adopt', { runId, decision: 'adopt', adoptedId: 'c1' })
    expect(adopted.ok).toBe(true)
    expect(adopted.value.bestOf.adoptedId).toBe('c1')

    // task-14：走**真** `apply()` + 真 `installRpc` 的这条路上，采用稿同样投进会话
    // （假 agent 的 `followup` 记账就是「日志里多了那一条」的判据）。
    expect(adopted.value.delivery?.ok, JSON.stringify(adopted.value.delivery)).toBe(true)
    const delivered = [...agents.live.values()].flatMap((agent) => agent.calls).filter((entry) => entry.kind === 'followup')
    expect(delivered).toHaveLength(1)
    expect(delivered[0].message.source).toEqual({ kind: 'xuanshu-bestof-adopted' })
    expect(delivered[0].message.content[0].text).toContain('第一份。')
    expect(JSON.stringify(delivered)).not.toContain('第二份。') // 落选候选没被投进去

    // 合并（不是覆盖）：票 08 / 09 / 10 / 14 的方法仍在。
    for (const method of ['pu.list', 'cang.list', 'bazi.basePu', 'consult.defaults']) {
      const response = await call(route, method, {})
      expect(response.ok, `${method} 被 bestof.* 挤掉了：${JSON.stringify(response)}`).toBe(true)
    }
    // 名字写错就该是「未知玄枢操作」。
    const typo = await call(route, 'bestOf.run', {})
    expect(typo.ok).toBe(false)
    expect(typo.error.message).toMatch(/未知玄枢操作/u)

    // 数据目录同源：记录落在 <dataDir>/consult/<sessionId>.bestof.json。
    expect(sandbox.exists('consult', `${sessionId}.bestof.json`)).toBe(true)
  })

  it('方法面齐全（少一个也要能看出来）', async () => {
    const { route } = assemble()
    for (const method of CONTRACT_METHODS) {
      const response = await call(route, method, method === 'bestof.state' || method === 'bestof.adopt' ? { runId: 'bestof-x' } : {})
      expect(response.ok).toBe(false)
      expect(response.error.message, `${method} 像是没挂上`).not.toMatch(/未知玄枢操作/u)
    }
  })
})
