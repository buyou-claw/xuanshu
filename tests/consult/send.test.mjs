/**
 * 票 10 · `consult.send`（契约 §2/§3/§4）
 *
 * 三件事在这里一次验完：
 *   ① **首轮注入**：底座谱（票 08 的 `bazi.basePu`）+ 底稿（`<dataDir>/digao.md` 全文）
 *      + 勾选谱的 manifest 概览 / summary / 文件路径；每段带【来源：…】标记；
 *      **非勾选谱一个字符都不出现**；正文不灌，让 AI 自己按路径去读（票面第 3 条）。
 *      注入发生在 **`consult.create` 那一刻**（第一问可能从原生 composer 来，见 create.test.mjs）；
 *      `consult.send` 只在「create 没灌成 / 会话是别的进程建的」时补，并且负责挂载变更的增量。
 *   ② **注入只发生一次**：会话历史里之后都在，再次问事不重复灌。
 *   ③ **等一轮结束看 `turn/end`**：假 agent 的 `whenIdle()` 直接抛（证据
 *      `dsh-agent/lib/types/runtime-types.d.ts:164`），所以任何「用 whenIdle 判结束」的写法都会在这里红。
 *
 * 抓的真实缺陷/风险：
 *   ① **把可选谱正文整篇灌进上下文**：票面要的是「AI 自己完成加载谱资料」，灌全文等于替它读了，
 *      还把上下文预算吃光；判据是「注入文本含路径、不含正文」。
 *   ② **没勾的谱也进上下文**：勾选区就失去意义了，用户会以为「勾不勾都一样」。
 *   ③ **每轮都重灌**：上下文重复膨胀，且历史里出现同一份底座谱的多个副本。
 *   ④ **`turns` 记账与注入判据脱节**：注入判据用的是旁挂清单里的 `turns`（跨进程仍然成立），
 *      而不是内存里的一个布尔。
 *   ⑤ **发问打错会话**：`consult.send` 只接受 `session-xs-consult-` 前缀 ——
 *      一条打到工作区会话上的 send 是「问事面驱动了别人的会话」。
 */
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import {
  envelope,
  fakeAgentDefaultModel,
  fakeAgentPresets,
  fakeAgents,
  fakeHorosa,
  fakeSessionQuery,
  fakeSessionStore,
  fakeWorkspaceRegistry,
  makeHost,
  makeSandbox,
  seedBasePu,
  seedPu,
  userEvent,
} from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 断言台里落好的两个谱（一个 optional、一个 base 级，用来验「勾了才进去」）。 */
const ZIWEI = { name: '紫微笔记', level: 'optional', description: '紫微斗数的读书笔记。', summary: '紫微：十四主星与四化的笔记。' }
const RUANJIAN = { name: '软件开发', level: 'base', description: '手上的软件项目与排期。', summary: '软件开发：项目、排期与复盘。' }
const DIGAO_TEXT = '# 底稿\n底稿正文第一行：最近在做的事。\n底稿正文第二行：手上有的谱。\n'
const QUESTION = '帮我看这次转岗的时机'

/** 起一套方法 + 沙箱；`pus` 是这次会话勾选的谱。 */
async function scene({ pus = ['紫微笔记'], digao = true, basePu = true, sessionQuery } = {}) {
  const sandbox = makeSandbox('send')
  roots.push(sandbox)
  const fake = fakeHorosa(envelope('bazi-ok-default'))
  const agents = fakeAgents()
  const sessions = fakeSessionStore()
  const workspaces = fakeWorkspaceRegistry()
  const host = makeHost({
    services: {
      xuanshuHorosa: fake.service,
      agents: agents.service,
      sessions: sessions.service,
      workspaceRegistry: workspaces.service,
      // 发问前的门要的那两个服务（缺了 send 会可读地拒绝，见 agent.test.mjs）。
      agentPresets: fakeAgentPresets().service,
      agentDefaultModel: fakeAgentDefaultModel().service,
      ...(sessionQuery === undefined ? {} : { sessionQuery: sessionQuery.service }),
    },
  })
  if (basePu) await seedBasePu(sandbox, host.ctx)
  seedPu(sandbox, ZIWEI)
  seedPu(sandbox, RUANJIAN)
  if (digao) sandbox.write('digao.md', DIGAO_TEXT)
  const api = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
  const { session } = await api['consult.create']({ pus })
  return { sandbox, host, api, session, agents, sessions, workspaces }
}

/** 取某个会话的假 agent（send 之后才有调用记录）。 */
const callsOf = (agents, sessionId) => agents.live.get(sessionId).calls

describe('consult.send · 只受理与记账（上下文不在这里注入）', () => {
  it('一次 send = 一条 followup：它自己不注入任何东西（注入在 agent/pre-step 边界，见 boundary.test.mjs）', async () => {
    // 为什么判据敢这么硬：那条「inject 排在 followup 之前」的路**会丢** ——
    // dispose 会把排队待消费的消息取消掉，而原生 composer 根本不走这里。
    // 上下文改由发问边界在每一轮第一步现算（评审 R2/R3/R4），send 只剩受理与记账。
    const { api, agents, session } = await scene()
    const response = await api['consult.send']({ sessionId: session.sessionId, text: QUESTION, requestId: 'r-1' })

    expect(response).toEqual({ accepted: true })
    const calls = callsOf(agents, session.sessionId)
    expect(calls.map((call) => call.kind)).toEqual(['followup'])
    const question = calls[0].message
    expect(question.source.kind).toBe('user')
    expect(question.content).toEqual([{ type: 'text', text: QUESTION }])
  })
})

describe('consult.send · 记账（turns / 标题 / 会话内串行）', () => {
  it('第二问：普通用户消息；turns 与标题按首问落账', async () => {
    const { api, agents, session, sandbox } = await scene()
    await api['consult.send']({ sessionId: session.sessionId, text: QUESTION })
    await api['consult.send']({ sessionId: session.sessionId, text: '那如果不去呢' })

    const calls = callsOf(agents, session.sessionId)
    expect(calls.map((call) => call.kind)).toEqual(['followup', 'followup'])
    expect(calls[1].message.source.kind).toBe('user')
    expect(calls[1].message.content).toEqual([{ type: 'text', text: '那如果不去呢' }])

    const manifest = sandbox.json('consult', 'sessions', `${session.sessionId}.json`)
    expect(manifest.turns).toBe(2)
    expect(manifest.title).toBe(QUESTION.slice(0, 40))
  })

  it('标题只由**首问**决定；改名之后不再被下一问覆盖', async () => {
    const { api, session, sandbox } = await scene()
    await api['consult.send']({ sessionId: session.sessionId, text: QUESTION })
    await api['consult.rename']({ sessionId: session.sessionId, title: '转岗时机' })
    await api['consult.send']({ sessionId: session.sessionId, text: '那如果不去呢' })
    expect(sandbox.json('consult', 'sessions', `${session.sessionId}.json`).title).toBe('转岗时机')
  })

  it('同一会话两问并发：turns 不丢更新（send 按会话串行）', async () => {
    const { api, agents, session, sandbox } = await scene()
    await Promise.all([
      api['consult.send']({ sessionId: session.sessionId, text: '第一问' }),
      api['consult.send']({ sessionId: session.sessionId, text: '第二问' }),
    ])

    const calls = callsOf(agents, session.sessionId)
    expect(calls.filter((call) => call.kind === 'followup')).toHaveLength(2)
    expect(sandbox.json('consult', 'sessions', `${session.sessionId}.json`).turns).toBe(2)
  })
})


describe('consult.send · 等一轮结束看 turn/end（不是 whenIdle）', () => {
  it('turn/end 到账即记 lastTurnAt，并当场退订（不留监听器）', async () => {
    const { api, host, session, sandbox } = await scene()
    await api['consult.send']({ sessionId: session.sessionId, text: QUESTION })

    // 发问只是「受理」：此刻轮次还没结束，lastTurnAt 不该有值。
    expect(sandbox.json('consult', 'sessions', `${session.sessionId}.json`).lastTurnAt).toBeUndefined()
    expect(host.listenerCount('session/event')).toBe(1)

    host.emit('session/event', { id: session.sessionId }, { type: 'turn/end', seq: 9, time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const manifest = sandbox.json('consult', 'sessions', `${session.sessionId}.json`)
    expect(Number.isNaN(Date.parse(manifest.lastTurnAt))).toBe(false)
    expect(host.listenerCount('session/event'), '轮结束就该退订，不然每次问事都漏一个监听器').toBe(0)
  })

  it('别的会话的 turn/end、以及本会话的其他事件，都不算这一轮的结束', async () => {
    const { api, host, session, sandbox } = await scene()
    await api['consult.send']({ sessionId: session.sessionId, text: QUESTION })

    host.emit('session/event', { id: 'session-xs-consult-somebody-else' }, { type: 'turn/end', seq: 1, time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } })
    host.emit('session/event', { id: session.sessionId }, { type: 'assistant/message', seq: 2, time: Date.now(), data: {} })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sandbox.json('consult', 'sessions', `${session.sessionId}.json`).lastTurnAt).toBeUndefined()
    expect(host.listenerCount('session/event')).toBe(1)

    host.emit('session/event', { id: session.sessionId }, { type: 'turn/end', seq: 3, time: Date.now(), data: { turn: 1, reason: { kind: 'error', error: { code: 'X', message: 'boom' } } } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    // 出错也是「这一轮结束了」：历史列表要能看出「上一次问完是什么时候」。
    expect(typeof sandbox.json('consult', 'sessions', `${session.sessionId}.json`).lastTurnAt).toBe('string')
  })
})

describe('consult.send · 原生 composer 那条路（轮次账）', () => {
  it('原生 composer 说的第一句也算一轮：turns / 标题按**会话日志**核对（那条路不经过 consult.send）', async () => {
    const query = fakeSessionQuery()
    const { api, agents, session, sandbox } = await scene({ sessionQuery: query })
    // 用户从原生 composer 说了第一句：会话日志里有这条 `user/message`（`source.kind = 'user'`），
    // 而旁挂清单的 `turns` 仍是 0 —— 票 15 的 sediment 据此拒绝，历史列表也看不出「已经问过一轮」。
    query.events[session.sessionId] = [
      userEvent(1, { id: 'm-native-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '原生输入的首问' }] }),
    ]

    await api['consult.send']({ sessionId: session.sessionId, text: '接着问一句' })

    const manifest = sandbox.json('consult', 'sessions', `${session.sessionId}.json`)
    // 原生那一句 + 这一句 = 2 轮；标题取**首问**（原生那一句），不许被这一句顶掉。
    expect(manifest.turns).toBe(2)
    expect(manifest.title).toBe('原生输入的首问')
    // 这一问照旧只有一条 followup：上下文归发问边界，send 不掺一手。
    expect(callsOf(agents, session.sessionId).map((call) => call.kind)).toEqual(['followup'])
  })
})


describe('consult.send · 会话来源与拒绝路径', () => {
  it('进程重启后（另一个 service 实例）也能接着问：走 ctx.agents.resume', async () => {
    const { api, agents, session, sandbox } = await scene()
    // 模拟「上一次进程建的会话」：假 registry 里那个 agent 随进程一起没了，新实例手上也没有句柄。
    agents.live.clear()
    const host2 = makeHost({
      services: {
        agents: agents.service,
        agentPresets: fakeAgentPresets().service,
        agentDefaultModel: fakeAgentDefaultModel().service,
      },
    })
    const api2 = createConsultMethods(host2.ctx, { dataDir: sandbox.dataDir })
    await api2['consult.send']({ sessionId: session.sessionId, text: '继续这次问事' })

    expect(agents.resumed.map((options) => options.resumeSessionId)).toEqual([session.sessionId])
    const calls = callsOf(agents, session.sessionId)
    expect(calls.map((call) => call.kind)).toEqual(['followup'])
  })

  it('没有旁挂清单的会话：拒绝，且不碰 agents', async () => {
    const { api, agents } = await scene()
    await expect(api['consult.send']({ sessionId: 'session-xs-consult-不存在', text: QUESTION })).rejects.toThrow(/问事记录|不存在/u)
    expect(agents.resumed).toEqual([])
    expect(agents.created).toHaveLength(1)
  })

  it('不是问事会话的 id（比如工作区会话）：拒绝，防止问事面驱动别的会话', async () => {
    const { api, agents } = await scene()
    await expect(api['consult.send']({ sessionId: 'session-1bb37188-5787-4f96-a6ec-0de66a825f2a', text: QUESTION })).rejects.toThrow(/问事/u)
    expect(agents.resumed).toEqual([])
  })

  it('空问题 / 非文本问题：拒绝，不新增投递也不落账', async () => {
    const { api, agents, session, sandbox } = await scene()
    const before = sandbox.read('consult', 'sessions', `${session.sessionId}.json`)
    // 首轮上下文在 `consult.create` 那一刻已经灌了（见 create.test.mjs），所以这里的判据是
    // 「拒绝路径**一条新投递都没有**」，而不是「调用列表是空的」；比整条投递（同 kind 多投一条也要红）。
    const callsBefore = [...callsOf(agents, session.sessionId)]
    for (const text of ['', '   ', undefined, 42]) {
      await expect(api['consult.send']({ sessionId: session.sessionId, text })).rejects.toThrow(/问题|文本/u)
    }
    expect(callsOf(agents, session.sessionId)).toEqual(callsBefore)
    expect(sandbox.read('consult', 'sessions', `${session.sessionId}.json`)).toBe(before)
  })
})
