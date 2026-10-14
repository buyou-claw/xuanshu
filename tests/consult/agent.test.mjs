/**
 * 票 10 · 会话是怎么接上 agent 的（契约 §4 的 `setup?`；Lead 2026-10-15 裁定补入契约）
 *
 * **为什么不能只给 `{sessionId, meta:{cwd}}`**（两条硬证据）：
 *   ① `dsh-agent-loop/lib/index.js:1185`：第一轮请求前没有 provider/model 直接抛
 *      `has no provider/model` —— 裸 create 既没有 `agentOptions` 也没有 waterfall 来源；
 *   ② `standard` preset 声明的工具行只在 preset **挂载出来的 scope** 里激活
 *      （`dsh-web-app/presets/standard.patch.yml` + `dsh-web-app/cordis.patch.yml:558` 的
 *      preset 面 gate 注释）—— 不 mount 就没有「DSH 全套工具能力」，票 10 验收第 3 条不成立。
 *
 * 所以这里照着第一方先例钉住三件事：resolve 缺省 preset（web 层 `default: standard`）→
 * `meta.agentPreset`（**真语义**，ADR-0009 禁的是拿它当自由标签）→ `agentOptions` 取
 * `agentDefaultModel.currentSelection()` → `setup` 里 `agentPresets.mount(agentCtx, id)`。
 * 另一条同样重要：**发问前的门** —— 两个服务缺一个，`consult.send` 必须可读地失败，
 * 不许回一个 `accepted:true` 然后什么都不发生（Lead 2026-10-15 的追加要求）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { consultAgentCapability, defaultModelSelection } from '../../packages/xuanshu-host/lib/consult/agent.mjs'
import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { consultRoot } from '../../packages/xuanshu-host/lib/consult/store.mjs'
import {
  fakeAgentDefaultModel,
  fakeAgentPresets,
  fakeAgents,
  fakeSessionQuery,
  makeHost,
  makeSandbox,
} from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

const SELECTION = { provider: 'deepseek', model: 'deepseek-chat' }

/** 起一套方法 + 沙箱并开一个会话；`presets` / `model` 为 false 时模拟「profile 缺这两行」。 */
async function scene({ presets = true, model = true } = {}) {
  const sandbox = makeSandbox('agent')
  roots.push(sandbox)
  const agents = fakeAgents()
  const query = fakeSessionQuery()
  const registry = fakeAgentPresets()
  const defaultModel = fakeAgentDefaultModel(SELECTION)
  const services = { agents: agents.service, sessionQuery: query.service }
  if (presets) services.agentPresets = registry.service
  if (model) services.agentDefaultModel = defaultModel.service
  const host = makeHost({ services })
  const api = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
  const { session } = await api['consult.create']({ pus: [] })
  /** 清空记录器：让「建这个会话」那一次的调用与后续断言分开看。 */
  const reset = () => {
    registry.resolved.length = 0
    registry.mounted.length = 0
    agents.created.length = 0
    agents.resumed.length = 0
    agents.setups.length = 0
  }
  /** 模拟进程重启：另起一个 service 实例（手上没有会话句柄），共享同一批假服务与 dataDir。 */
  const restart = () => createConsultMethods(makeHost({ services }).ctx, { dataDir: sandbox.dataDir })
  return { sandbox, host, api, agents, query, registry, session, reset, restart }
}

describe('组合口径：preset + 模型选择（与 dsh-webhook / session-controller 同款）', () => {
  it('create 带 meta.agentPreset、agentOptions 与 setup；setup 里 mount 的是缺省 preset', async () => {
    const { agents, registry, sandbox, session } = await scene()

    const options = agents.created[0]
    expect(options.sessionId).toBe(session.sessionId)
    // meta 的两个键都用真语义：cwd 是归属（ADR-0009 第 2 条），agentPreset 是 preset 身份。
    expect(options.meta).toEqual({ cwd: consultRoot(sandbox.dataDir), agentPreset: 'standard' })
    expect(options.agentOptions).toEqual(SELECTION)
    expect(typeof options.setup).toBe('function')

    // 假工厂会像真工厂一样在发布前 await setup：mount 必须发生在 agent 自己的 scope 上。
    expect(registry.resolved).toEqual([undefined]) // resolve() 不带参数 = 取 registry 默认
    expect(registry.mounted).toEqual([{ agentCtx: { kind: 'agent-ctx', sessionId: session.sessionId }, id: 'standard' }])
    expect(agents.setups.map((entry) => entry.sessionId)).toContain(session.sessionId)
  })

  it('推理档位（reasoningEffort）有就带上，没有就不编', async () => {
    const sandbox = makeSandbox('agent-effort')
    roots.push(sandbox)
    const agents = fakeAgents()
    const host = makeHost({
      services: {
        agents: agents.service,
        agentPresets: fakeAgentPresets().service,
        agentDefaultModel: fakeAgentDefaultModel({ ...SELECTION, reasoningEffort: 'high' }).service,
      },
    })
    const api = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
    await api['consult.create']({})
    expect(agents.created[0].agentOptions).toEqual({ ...SELECTION, reasoningEffort: 'high' })
  })

  it('profile 缺 preset / 模型行：照旧建得出来，但只是裸 create（软降级，不抛）', async () => {
    const { api, agents } = await scene({ presets: false, model: false })
    await api['consult.create']({})
    const options = agents.created[0]
    expect(Object.keys(options).sort()).toEqual(['meta', 'sessionId'])
    expect(options.meta).toEqual({ cwd: expect.any(String) })
  })

  it('模型选择不完整（服务给了半个）→ 当没有：不编一个假 provider 出来', () => {
    const half = makeHost({ services: { agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek' }) } } })
    expect(defaultModelSelection(half.ctx)).toBeUndefined()
    const none = makeHost({ services: { agentDefaultModel: { currentSelection: () => undefined } } })
    expect(defaultModelSelection(none.ctx)).toBeUndefined()
  })
})

describe('resume：认回会话自己存的 preset', () => {
  it('按会话 header 里的 agentPreset 组合，并 mount 同一个', async () => {
    const { agents, registry, session, query, reset, restart } = await scene()
    query.headers[session.sessionId] = { agentPreset: 'minimal' }
    agents.live.clear() // 上一次进程建的 agent 随进程一起没了
    reset() // 建会话那一次不算，这里只看 resume 的组合
    const api2 = restart()

    await api2['consult.send']({ sessionId: session.sessionId, text: '继续这次问事' })

    expect(registry.resolved).toEqual(['minimal'])
    expect(registry.mounted).toEqual([{ agentCtx: { kind: 'agent-ctx', sessionId: session.sessionId }, id: 'minimal' }])
    const options = agents.resumed[0]
    expect(options.resumeSessionId).toBe(session.sessionId)
    expect(options.agentOptions).toEqual(SELECTION)
    expect(typeof options.setup).toBe('function')
  })

  it('会话存的 preset 已经不在名册里：退回缺省，而不是让这次问事彻底打不开', async () => {
    const { agents, registry, session, query, reset, restart } = await scene()
    query.headers[session.sessionId] = { agentPreset: '已被删掉的名册项' }
    // 存的那个 preset 已经不在名册里：resolve(它) 抛，resolve() 仍然给缺省。
    const requested = []
    registry.service.resolve = async (id) => {
      requested.push(id)
      if (id !== undefined) throw new Error(`unknown preset ${id}`)
      return { id: 'standard' }
    }
    agents.live.clear()
    reset()
    const api2 = restart()

    await api2['consult.send']({ sessionId: session.sessionId, text: '继续这次问事' })
    expect(requested).toEqual(['已被删掉的名册项', undefined])
    expect(registry.mounted).toEqual([{ agentCtx: { kind: 'agent-ctx', sessionId: session.sessionId }, id: 'standard' }])
  })
})

describe('发问前的门：缺服务时不许回一个假的 accepted:true', () => {
  it('缺 agentPresets / agentDefaultModel：send 可读地失败，且不注入、不 followup、不落账', async () => {
    const { api, agents, sandbox, session } = await scene({ presets: false, model: false })
    const before = sandbox.read('consult', 'sessions', `${session.sessionId}.json`)

    const failure = await api['consult.send']({ sessionId: session.sessionId, text: '帮我看时机' }).catch((error) => error)
    expect(failure).toBeInstanceOf(Error)
    // 说清缺哪个服务 + 给一条修复路径（Lead 裁定的要求）。
    expect(failure.message).toMatch(/agentPresets/u)
    expect(failure.message).toMatch(/agentDefaultModel/u)
    expect(failure.message).toMatch(/dump-config|xuanshu-report/u)

    expect(agents.live.get(session.sessionId).calls).toEqual([])
    expect(sandbox.read('consult', 'sessions', `${session.sessionId}.json`)).toBe(before) // turns 仍是 0
  })

  it('只缺一个也拦（preset 在、模型不在）', async () => {
    const { api, session } = await scene({ model: false })
    await expect(api['consult.send']({ sessionId: session.sessionId, text: '问一句' })).rejects.toThrow(/agentDefaultModel/u)
  })

  it('两个服务都在：能力门通过，正常发出去', async () => {
    const { api, agents, session } = await scene()
    const response = await api['consult.send']({ sessionId: session.sessionId, text: '问一句' })
    expect(response).toEqual({ accepted: true })
    expect(agents.live.get(session.sessionId).calls.map((call) => call.kind)).toEqual(['inject', 'followup'])
  })

  it('consultAgentCapability 的形状：ok/missing/detail', () => {
    const ok = makeHost({ services: { agentPresets: fakeAgentPresets().service, agentDefaultModel: fakeAgentDefaultModel().service } })
    expect(consultAgentCapability(ok.ctx)).toEqual({ ok: true, missing: [], detail: '' })
    const broken = consultAgentCapability(makeHost().ctx)
    expect(broken.ok).toBe(false)
    expect(broken.missing).toEqual(['agentPresets', 'agentDefaultModel'])
    expect(broken.detail).toMatch(/跑不了一轮/u)
  })
})
