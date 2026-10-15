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
import { CONSULT_MESSAGE_SOURCE_KIND } from '../../packages/xuanshu-host/lib/consult/message.mjs'
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
async function scene({ pus = ['紫微笔记'], digao = true, basePu = true, sessionQuery, failFirstInject = false } = {}) {
  const sandbox = makeSandbox('send')
  roots.push(sandbox)
  const fake = fakeHorosa(envelope('bazi-ok-default'))
  const agents = fakeAgents()
  if (failFirstInject) {
    // 让 create 那一刻的首灌抛一次（模拟「那一刻读谱 / 读底稿失败」），之后恢复正常。
    const realCreate = agents.service.create
    agents.service.create = async (options) => {
      const handle = await realCreate(options)
      const realInject = handle.agent.inject
      let failed = false
      handle.agent.inject = (message) => {
        if (!failed) {
          failed = true
          throw new Error('FAULT INJECTION: create 时首灌失败')
        }
        return realInject(message)
      }
      return handle
    }
  }
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

/** 注入文本（第一条 inject 消息的正文）。 */
function injectionText(agents, sessionId) {
  const injected = callsOf(agents, sessionId).filter((call) => call.kind === 'inject')
  expect(injected).toHaveLength(1)
  return injected[0].message
}

describe('consult.send · 首轮注入（契约 §3）', () => {
  it('注入消息排在用户问题之前，source.kind = xuanshu-consult；问题是普通用户消息', async () => {
    const { api, agents, session } = await scene()
    const response = await api['consult.send']({ sessionId: session.sessionId, text: QUESTION, requestId: 'r-1' })

    expect(response).toEqual({ accepted: true })
    const calls = callsOf(agents, session.sessionId)
    // 顺序是被验的东西：注入必须先于唤醒那一轮（`inject()` 不唤醒，`followup()` 才唤醒）。
    expect(calls.map((call) => call.kind)).toEqual(['inject', 'followup'])

    const injection = calls[0].message
    expect(injection.role).toBe('user')
    expect(Object.keys(injection).sort()).toEqual(['content', 'id', 'role', 'source'])
    expect(injection.source.kind).toBe(CONSULT_MESSAGE_SOURCE_KIND)
    expect(injection.content.every((block) => block.type === 'text' && typeof block.text === 'string')).toBe(true)

    const question = calls[1].message
    expect(question.source.kind).toBe('user')
    expect(question.content).toEqual([{ type: 'text', text: QUESTION }])
  })

  it('三段来源标记齐、内容只给概览 + summary + 路径（正文留给 AI 自己读）', async () => {
    const { api, agents, session, sandbox } = await scene()
    await api['consult.send']({ sessionId: session.sessionId, text: QUESTION })
    const text = injectionText(agents, session.sessionId).content.map((block) => block.text).join('\n')

    expect(text).toContain('【来源：底座谱】')
    expect(text).toContain('【来源：底稿】')
    expect(text).toContain('【来源：谱 紫微笔记】')

    // 底座谱：票 08 的 manifest 概览 + summary + 文件路径（`pus/_base/**` 的真实路径）。
    expect(text).toContain('出生信息与八字底盘') // renderBaseDescription 的开头
    expect(text).toContain('四柱 己巳 丙子 丙寅 甲午') // renderBaseSummary 的原文
    expect(text).toContain(join(sandbox.dataDir, 'pus', '_base', 'manifest.md'))
    expect(text).toContain(join(sandbox.dataDir, 'pus', '_base', 'bazi.md'))

    // 底稿：契约要的是**全文**（它本身就是摘要层）+ 路径。
    expect(text).toContain('底稿正文第二行：手上有的谱。')
    expect(text).toContain(join(sandbox.dataDir, 'digao.md'))

    // 勾选谱：概览 + summary + 路径；**正文不进来**（票面第 3 条：AI 自己按需读）。
    expect(text).toContain('紫微斗数的读书笔记。')
    expect(text).toContain('紫微：十四主星与四化的笔记。')
    expect(text).toContain(join(sandbox.dataDir, 'pus', '紫微笔记', 'manifest.md'))
    expect(text).toContain(join(sandbox.dataDir, 'pus', '紫微笔记', 'summary.md'))
    expect(text).toContain(join(sandbox.dataDir, 'pus', '紫微笔记', 'content.md'))
    expect(text).not.toContain('这里是《紫微笔记》的正文')

    // 非勾选谱：连路径痕迹都不许有（勾选区失去意义就是从这种地方开始的）。
    expect(text).not.toContain('【来源：谱 软件开发】')
    expect(text).not.toContain('软件开发：项目、排期与复盘。')
    expect(text).not.toContain(join(sandbox.dataDir, 'pus', '软件开发'))
  })

  it('底稿还没生成（票 13 的产物）：照样注入，但写明「底稿未生成」', async () => {
    const { api, agents, session, sandbox } = await scene({ digao: false })
    await api['consult.send']({ sessionId: session.sessionId, text: QUESTION })
    const text = injectionText(agents, session.sessionId).content.map((block) => block.text).join('\n')
    expect(text).toContain('【来源：底稿】')
    expect(text).toMatch(/底稿未生成/u)
    expect(text).toContain(join(sandbox.dataDir, 'digao.md'))
    // 探测 ≠ 生产：不要顺手造一份空底稿。
    expect(sandbox.exists('digao.md')).toBe(false)
  })

  it('还没起过盘：底座段写明「底座未立」，其余照常', async () => {
    const { api, agents, session } = await scene({ basePu: false })
    await api['consult.send']({ sessionId: session.sessionId, text: QUESTION })
    const text = injectionText(agents, session.sessionId).content.map((block) => block.text).join('\n')
    expect(text).toContain('【来源：底座谱】')
    expect(text).toMatch(/底座未立/u)
    expect(text).toContain('【来源：底稿】')
  })

  it('一个可选谱都没勾：注入里只有底座与底稿两段，没有任何「谱 …」段', async () => {
    const { api, agents, session } = await scene({ pus: [] })
    await api['consult.send']({ sessionId: session.sessionId, text: QUESTION })
    const text = injectionText(agents, session.sessionId).content.map((block) => block.text).join('\n')
    expect(text).toContain('【来源：底座谱】')
    expect(text).toContain('【来源：底稿】')
    expect(text).not.toMatch(/【来源：谱 /u)
  })
})

describe('consult.send · 一轮只灌一次（契约 §3：首轮才注入）', () => {
  it('第二问不再注入，而是普通用户消息；turns 与标题按首问落账', async () => {
    const { api, agents, session, sandbox } = await scene()
    await api['consult.send']({ sessionId: session.sessionId, text: QUESTION })
    await api['consult.send']({ sessionId: session.sessionId, text: '那如果不去呢' })

    const calls = callsOf(agents, session.sessionId)
    expect(calls.map((call) => call.kind)).toEqual(['inject', 'followup', 'followup'])
    expect(calls[2].message.source.kind).toBe('user')
    expect(calls[2].message.content).toEqual([{ type: 'text', text: '那如果不去呢' }])

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

  it('同一会话两问并发：只灌一次上下文，turns 不丢更新（send 按会话串行）', async () => {
    const { api, agents, session, sandbox } = await scene()
    await Promise.all([
      api['consult.send']({ sessionId: session.sessionId, text: '第一问' }),
      api['consult.send']({ sessionId: session.sessionId, text: '第二问' }),
    ])

    const calls = callsOf(agents, session.sessionId)
    expect(calls.filter((call) => call.kind === 'inject')).toHaveLength(1)
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

describe('consult.send · 原生 composer 那条路（评审发现的那一处）', () => {
  it('原生 composer 说的第一句也算一轮：turns / 标题按**会话日志**核对（那条路不经过 consult.send）', async () => {
    const query = fakeSessionQuery()
    const { api, agents, session, sandbox } = await scene({ sessionQuery: query })
    // 用户从原生 composer 说了第一句：会话日志里有这条 `user/message`（`source.kind = 'user'`），
    // 而旁挂清单的 `turns` 仍是 0 —— 两个下游会因此出错（票 15 的 sediment 据此拒绝；
    // 首轮判据会以为「还没灌过」）。
    query.events[session.sessionId] = [
      userEvent(1, { id: 'm-native-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '原生输入的首问' }] }),
    ]

    await api['consult.send']({ sessionId: session.sessionId, text: '接着问一句' })

    const manifest = sandbox.json('consult', 'sessions', `${session.sessionId}.json`)
    // 原生那一句 + 这一句 = 2 轮；标题取**首问**（原生那一句），不许被这一句顶掉。
    expect(manifest.turns).toBe(2)
    expect(manifest.title).toBe('原生输入的首问')
    // 上下文在 create 时就灌过了（同进程判据），这一问不再灌一遍。
    expect(callsOf(agents, session.sessionId).map((call) => call.kind)).toEqual(['inject', 'followup'])
  })

  it('create 时首灌失败 + 原生 composer 说过话 → 下一问仍然补灌（宁可晚一轮，不许一直没有）', async () => {
    // 两个条件同时成立才是那条缝：create 的注入没成（`injected` 里没有），而首问又不经过 consult.send
    // （会话日志里有问句、旁挂清单被核对成 turns=1）。**注入判据看「灌过没有」，不看 turns** ——
    // 否则这一场问事会永远没有上下文，而每一处都显示正常。
    const query = fakeSessionQuery()
    const { api, agents, session, sandbox } = await scene({ sessionQuery: query, failFirstInject: true })
    expect(callsOf(agents, session.sessionId).filter((call) => call.kind === 'inject')).toHaveLength(0)
    query.events[session.sessionId] = [
      userEvent(1, { id: 'm-native-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '原生输入的首问' }] }),
    ]

    await api['consult.send']({ sessionId: session.sessionId, text: '接着问一句' })

    const calls = callsOf(agents, session.sessionId)
    expect(calls.map((call) => call.kind)).toEqual(['inject', 'followup'])
    const text = calls[0].message.content.map((block) => block.text).join('\n')
    expect(text).toContain('【来源：底座谱】')
    expect(text).toContain('【来源：底稿】')
    // 账也补上了：原生那一句 + 这一句。
    expect(sandbox.json('consult', 'sessions', `${session.sessionId}.json`).turns).toBe(2)
  })

  it('别的进程建的会话：日志里已有上下文 → 不重复灌一遍（turns 为 0 也不再灌）', async () => {
    const query = fakeSessionQuery()
    const { agents, session, sandbox } = await scene({ sessionQuery: query })
    // 会话日志里已经有 create 时灌的那一条（source.kind = 我们的上下文 kind）。
    query.events[session.sessionId] = [
      userEvent(1, { id: 'm-ctx-1', role: 'user', source: { kind: CONSULT_MESSAGE_SOURCE_KIND }, content: [{ type: 'text', text: '【玄枢·问事上下文】…' }] }),
    ]
    agents.live.clear()

    const host2 = makeHost({
      services: {
        agents: agents.service,
        agentPresets: fakeAgentPresets().service,
        agentDefaultModel: fakeAgentDefaultModel().service,
        sessionQuery: query.service,
      },
    })
    const api2 = createConsultMethods(host2.ctx, { dataDir: sandbox.dataDir })
    await api2['consult.send']({ sessionId: session.sessionId, text: '第二句' })

    // resume 之后重建的假 agent：只有问题，没有第二条上下文（历史里那一份已经在了）。
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
    expect(calls.map((call) => call.kind)).toEqual(['inject', 'followup'])
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
