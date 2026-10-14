/**
 * 票 10 · 装配接线（契约 §2：六个方法进**同一条** `/xuanshu` 通道）
 *
 * 这条用例走的是**真** `installRpc`（`lib/rpc.mjs`，票 09/14 共用、本票不改）与**真** `apply()`
 * （`lib/index.js` 的总装配），只有宿主 ctx 是替身 —— 要验的正是「接线有没有接上」：
 * 通道路径、六个方法名逐字可调、与 `pu.*` / `cang.*` / `bazi.*` 的合并（不是互相覆盖）、
 * 以及数据目录同源（旁挂清单落在 `config.dataDir` 下）。
 *
 * 抓的真实缺陷/风险：
 *   ① **方法名写错一个字母**：客户端按 `consult.defaults` 调、宿主注册 `consult.default`，
 *      症状是界面上「勾选谱区空的」而没有任何报错。这里逐名打一遍通道。
 *   ② **`...createConsultMethods()` 合并时被后面的展开覆盖**（或漏了展开）：`pu.list` 还在、
 *      `consult.*` 全丢 —— 只有「九个方法都在」这一条断言能挡住。
 *   ③ **数据目录各写一处**：装配报告写 A、旁挂清单落 B 是最难查的错位；这里断言旁挂清单
 *      就落在 `config.dataDir/consult/sessions/` 下，且传给 agents 的 cwd 同源。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { apply } from '../../packages/xuanshu-host/lib/index.js'
import {
  envelope,
  fakeAgentDefaultModel,
  fakeAgentPresets,
  fakeAgents,
  fakeHorosa,
  fakeSessionQuery,
  makeHost,
  makeSandbox,
} from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 跑一次总装配，返回通道上的一条路由（宿主 ctx 是替身）。 */
function assemble() {
  const sandbox = makeSandbox('wiring')
  roots.push(sandbox)
  const agents = fakeAgents()
  const query = fakeSessionQuery()
  const fake = fakeHorosa(envelope('bazi-ok-default'))
  const presets = fakeAgentPresets()
  const defaultModel = fakeAgentDefaultModel()
  const host = makeHost({
    wired: true,
    services: {
      agents: agents.service,
      sessionQuery: query.service,
      xuanshuHorosa: fake.service,
      // 生产形态：preset 名册 + 默认模型（会话跑得了一轮的前提，见 agent.test.mjs）。
      agentPresets: presets.service,
      agentDefaultModel: defaultModel.service,
    },
  })
  // autoStart:false：本用例不验 serve 生命周期（票 06 的事），只验接线。
  apply(host.ctx, { dataDir: sandbox.dataDir, autoStart: false })
  expect(host.routes, '总装配没有注册 /xuanshu 通道').toHaveLength(1)
  return { sandbox, host, agents, query, presets, route: host.routes[0] }
}

/** 通过 `/xuanshu` 通道调一个方法（rpc.mjs 的返回信封：`{ok, value}` / `{ok:false, error}`）。 */
function call(route, method, payload = {}) {
  return route.handler(method, payload, new AbortController().signal)
}

const CONTRACT_METHODS = ['consult.create', 'consult.send', 'consult.list', 'consult.read', 'consult.rename', 'consult.defaults']

describe('票 10 · 六个方法挂在同一条 /xuanshu 通道上（契约 §2）', () => {
  it('通道路径 = /xuanshu；六个方法名逐字可调，且与 pu.* / cang.* / bazi.* 合并而不是互相覆盖', async () => {
    const { route, sandbox } = assemble()
    expect(route.path).toBe('/xuanshu')

    // 先建一个会话，后面的 send / read / rename 才有对象。
    const created = await call(route, 'consult.create', { pus: [] })
    expect(created.ok, JSON.stringify(created)).toBe(true)
    const sessionId = created.value.session.sessionId

    const calls = [
      ['consult.list', {}],
      ['consult.read', { sessionId }],
      ['consult.rename', { sessionId, title: '通道用例' }],
      ['consult.defaults', {}],
      ['consult.send', { sessionId, text: '通道里问一句' }],
    ]
    for (const [method, payload] of calls) {
      const response = await call(route, method, payload)
      expect(response.ok, `${method} 没挂上通道：${JSON.stringify(response)}`).toBe(true)
    }

    // 合并（不是覆盖）：票 08 / 09 / 14 的方法仍在。
    for (const method of ['pu.list', 'cang.list', 'bazi.basePu']) {
      const response = await call(route, method, {})
      expect(response.ok, `${method} 被 consult.* 挤掉了：${JSON.stringify(response)}`).toBe(true)
    }

    // 名字写错就该是「未知玄枢操作」，而不是静默成功。
    const typo = await call(route, 'consult.default', {})
    expect(typo.ok).toBe(false)
    expect(typo.error.message).toMatch(/未知玄枢操作/u)

    // 数据目录同源：旁挂清单落在 config.dataDir 下。
    expect(sandbox.exists('consult', 'sessions', `${sessionId}.json`)).toBe(true)
  })

  it('create 走的是 ctx.agents.create，cwd = <dataDir>/consult（数据目录只此一处）', async () => {
    const { route, agents, presets, sandbox } = assemble()
    const created = await call(route, 'consult.create', { pus: [] })
    const sessionId = created.value.session.sessionId

    expect(agents.created[0].sessionId).toBe(sessionId)
    expect(agents.created[0].meta).toEqual({ cwd: sandbox.path('consult'), agentPreset: 'standard' })
    // preset 是通过 setup 挂进 agent scope 的（工具能力来自这里）。
    expect(presets.mounted).toEqual([{ agentCtx: { kind: 'agent-ctx', sessionId }, id: 'standard' }])
  })

  it('六个方法全在那儿（方法面不许少一个）', async () => {
    const { route } = assemble()
    for (const method of CONTRACT_METHODS) {
      const response = await call(route, method, method.startsWith('consult.') && method !== 'consult.create' && method !== 'consult.defaults' && method !== 'consult.list' ? { sessionId: 'session-xs-consult-none' } : {})
      // 方法存在就够了：语义错误走 {ok:false, error}，未知方法走「未知玄枢操作」——两者要分得开。
      if (response.ok === false) expect(response.error.message).not.toMatch(/未知玄枢操作/u)
    }
  })
})
