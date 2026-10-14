/**
 * 票 10 · `consult.create`（契约 §1/§2，ADR-0009 第 1/2/4 条）
 *
 * 开会话这一步把三条分类载体一次钉死：**自铸 id 前缀**、**共用 cwd**、**旁挂清单**。
 * 断言只打方法返回值、假 agents 收到的参数、沙箱里真落了什么盘。
 *
 * 抓的真实缺陷/风险：
 *   ① **用 `ctx.sessions.create()` 代替 `ctx.agents.create()`**：前者只造日志对象、不接 agent、
 *      不挂 preset —— 会话建了但跑不起来，而且**不报错**（`dsh-api-session-controller/lib/index.js:449-458`）。
 *      所以假 `ctx.sessions` 的任何一次调用都会抛，测试台还会单独断言它零调用。
 *   ② **往 `meta` 里塞 `xuanshu` 标签**：rc.2 静默丢弃（`dsh-session/lib/index.js:1697-1710`），
 *      「写下去没报错、读回来 undefined」是最危险的偏差。这里逐键比对 meta = `{cwd}`。
 *   ③ **把会话挂进 workspace**：产品约束是「问事与工作区并列、不属于任何工作区」（C6）——
 *      假 workspaceRegistry 零调用就是它的机器判据。
 *   ④ **忘了 mkdir cwd**：`session-controller.create()` 会 `mkdir -p`，而 `ctx.agents.create()`
 *      这条路上没人做（`:445-448` 那段在 controller 里）→ 真机上会话建不出来。
 *   ⑤ **旁挂清单写失败却把会话留下**：一个跑得起来但列表里看不见的会话，比报错更难查；
 *      create 失败必须把刚建的 agent 回滚掉。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { consultRoot, isConsultSessionId } from '../../packages/xuanshu-host/lib/consult/store.mjs'
import {
  fakeAgentDefaultModel,
  fakeAgentPresets,
  fakeAgents,
  fakeSessionStore,
  fakeWorkspaceRegistry,
  makeHost,
  makeSandbox,
} from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 起一套方法 + 沙箱 + 三个「必须/不许被碰」的假服务。 */
function scene() {
  const sandbox = makeSandbox('create')
  roots.push(sandbox)
  const agents = fakeAgents()
  const sessions = fakeSessionStore()
  const workspaces = fakeWorkspaceRegistry()
  const host = makeHost({
    services: {
      agents: agents.service,
      sessions: sessions.service,
      workspaceRegistry: workspaces.service,
      // 生产形态的两个服务（preset 名册 + 默认模型）：会话能不能跑一轮全看它们（见 agent.test.mjs）。
      agentPresets: fakeAgentPresets().service,
      agentDefaultModel: fakeAgentDefaultModel().service,
    },
  })
  const api = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
  return { sandbox, agents, sessions, workspaces, host, api }
}

const SUMMARY_KEYS = ['createdAt', 'mounts', 'pus', 'sessionId', 'title', 'turns']

describe('consult.create · 会话身份与归属（契约 §1）', () => {
  it('新建会话：id 前缀 session-xs-consult-、cwd = <dataDir>/consult、返回 ConsultSummary', async () => {
    const { sandbox, agents, api } = scene()
    const { session } = await api['consult.create']({ pus: ['紫微笔记'] })

    expect(session.sessionId.startsWith('session-xs-consult-')).toBe(true)
    expect(isConsultSessionId(session.sessionId)).toBe(true)
    expect(Object.keys(session).sort()).toEqual(SUMMARY_KEYS)
    expect(session).toMatchObject({ title: '未命名问事', pus: ['紫微笔记'], mounts: [], turns: 0 })
    expect(Number.isNaN(Date.parse(session.createdAt))).toBe(false)

    // ① 只能走 ctx.agents.create；meta 逐键是 `{cwd, agentPreset}`：
    //    `cwd` 是归属（ADR-0009 第 2 条），`agentPreset` 是**真语义**的 preset 身份
    //    （不写它，进程重启后 resume 认不回同一个 preset）；**没有别的键** ——
    //    rc.2 的 meta 是闭集 7 字段且逐字段挑，多塞的键静默丢弃（ADR-0009 第 6 条）。
    //    组合口径的完整断言在 agent.test.mjs。
    expect(agents.created).toHaveLength(1)
    expect(agents.created[0].meta).toEqual({ cwd: consultRoot(sandbox.dataDir), agentPreset: 'standard' })

    // ② cwd 目录真的建出来了（agents.create 这条路上没人替我们 mkdir）。
    expect(sandbox.exists('consult')).toBe(true)
  })

  it('不碰 ctx.sessions、不碰 workspaceRegistry（「与工作区并列、不属于任何工作区」）', async () => {
    const { sessions, workspaces, api } = scene()
    await api['consult.create']({})
    expect(sessions.calls, 'ctx.sessions 是纯日志对象，造不出能跑的会话').toEqual([])
    expect(workspaces.calls, '问事会话不许挂进任何工作区（ADR-0009 第 3 条）').toEqual([])
  })

  it('两次开会话拿到两个不同的 id', async () => {
    const { api } = scene()
    const first = await api['consult.create']({})
    const second = await api['consult.create']({})
    expect(first.session.sessionId).not.toBe(second.session.sessionId)
  })
})

describe('consult.create · 旁挂清单（契约 §1 冻结字段）', () => {
  it('落 <dataDir>/consult/sessions/<sessionId>.json：schema/kind/title/mounts/turns 全对', async () => {
    const { sandbox, api } = scene()
    const { session } = await api['consult.create']({ pus: ['紫微笔记', '紫微笔记', '软件开发'] })

    const file = `consult/sessions/${session.sessionId}.json`
    expect(sandbox.files()).toContain(file)
    const manifest = sandbox.json('consult', 'sessions', `${session.sessionId}.json`)
    expect(manifest).toEqual({
      schema: 'xuanshu/consult@1',
      sessionId: session.sessionId,
      kind: 'consult',
      createdAt: session.createdAt,
      title: '未命名问事',
      // 去重且保序：界面上的勾选顺序就是注入顺序。
      pus: ['紫微笔记', '软件开发'],
      mounts: [],
      turns: 0,
    })
  })

  it('pus 缺省 = 空数组（空手也能问一句），且 not 记进旁挂清单的恒定项', async () => {
    const { sandbox, api } = scene()
    const { session } = await api['consult.create']()
    expect(session.pus).toEqual([])
    expect(sandbox.json('consult', 'sessions', `${session.sessionId}.json`).pus).toEqual([])
  })

  it('pus 形状不对（非数组 / 混进非字符串 / 底座 _base）：抛错，且一次会话都不建、一个字节都不落', async () => {
    const cases = [
      ['pus 是字符串', { pus: '紫微笔记' }],
      ['pus 混进数字', { pus: ['紫微笔记', 3] }],
      ['pus 空 slug', { pus: ['  '] }],
      ['pus 拿底座当可选谱', { pus: ['_base'] }],
      ['pus 不是规范 slug', { pus: ['Zi Wei'] }],
    ]
    for (const [label, request] of cases) {
      const { sandbox, agents, api } = scene()
      await expect(api['consult.create'](request), label).rejects.toThrow()
      expect(agents.created, `${label} 却建了会话`).toEqual([])
      expect(sandbox.files(), `${label} 却落了盘`).toEqual([])
    }
  })

  it('旁挂清单写不进去：把刚建的会话回滚掉（不留「跑得起来但列表里看不见」的会话）', async () => {
    const { sandbox, agents, api } = scene()
    // 在 sessions 该在的位置放一个**同名文件**：mkdirSync 必然失败，create 走到写盘那一步就炸。
    sandbox.write('consult/sessions', 'not a directory\n')

    await expect(api['consult.create']({})).rejects.toThrow(/旁挂|记录/u)
    expect(agents.created).toHaveLength(1)
    expect(agents.disposed, '会话没回滚：它跑得起来，但 consult.list 里永远看不见它').toEqual([agents.created[0].sessionId])
  })
})
