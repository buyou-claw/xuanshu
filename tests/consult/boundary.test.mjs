/**
 * tests/consult/boundary.test.mjs —— 问事上下文的**统一发问边界**（评审 R2/R3/R4 的回归）。
 *
 * 被验的东西：**每一轮的第一步，模型输入里有没有该有的东西** ——
 * 不管这一轮是谁发起的（门厅 `consult.send` / 原生 composer / 重启后恢复）。
 *
 * 为什么不再验「`consult.create` / `consult.setMounts` 里 inject 了一条」：
 * 那条路（把消息排进 DSH 的 inbox）**会丢** —— `handle.dispose()` 追加
 * `outcome:"canceled"` 把待消费消息撤掉（实装 `dsh-agent-loop/lib/index.js:815,1688`），
 * 而原生 composer 根本不经过 `consult.send`。评审的两条探针就是这么把它钉住的。
 *
 * **交付落在会话日志里**（这一条是复核第二轮纠正的）：边界返回的消息会被 loop **原样追加**成
 * `user/message`（`dsh-agent-loop/lib/index.js:1061`，首次尝试时）——所以交付一次就永久在场，
 * 材料不必每轮重发、挂载只需按**变化**补。断言台的 `step()` 照做这件事（把新增的消息落进
 * 假日志），否则「材料已在日志里」这条判据在替身上永远为假，测出来的行为与真机不是一回事。
 */
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { installConsultBoundary, PRE_STEP_EVENT } from '../../packages/xuanshu-host/lib/consult/boundary.mjs'
import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { CONSULT_MESSAGE_SOURCE_KIND } from '../../packages/xuanshu-host/lib/consult/message.mjs'
import {
  envelope,
  fakeAgentDefaultModel,
  fakeAgentPresets,
  fakeAgents,
  fakeFsReader,
  fakeHorosa,
  fakeWorkspaceRegistryForMounts,
  makeHost,
  makeSandbox,
  seedBasePu,
  seedPu,
} from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

const QUESTION = { id: 'q-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '排产表怎么看' }] }
const SPEC = { kind: 'workspace', id: 'ws-print', label: '打印车间' }
const SPEC_B = { kind: 'workspace', id: 'ws-b', label: 'B 车间' }
/** 两个谱（一个 optional、一个 base 级）：验「勾了才进去」用的是这两份。 */
const ZIWEI = { name: '紫微笔记', level: 'optional', description: '紫微斗数的读书笔记。', summary: '紫微：十四主星与四化的笔记。' }
const RUANJIAN = { name: '软件开发', level: 'base', description: '手上的软件项目与排期。', summary: '软件开发：项目、排期与复盘。' }
const DIGAO_TEXT = '# 底稿\n底稿正文第一行：最近在做的事。\n底稿正文第二行：手上有的谱。\n'

/**
 * 带**会话日志**的假 agent：`snapshotEvents()` + 一个可以被 `step()` 追加的事件数组。
 * 真 agent 的日志由 loop 写；替身里由 `step()` 模拟（见文件头）。
 */
function loggedAgent(sessionId, seed = []) {
  const events = [...seed]
  return { session: { id: sessionId, snapshotEvents: () => [...events] }, events }
}

/** 一条「日志里已经有材料」的旧事件（a2ceaf3 之前建的会话，或任何手写注入的会话）。 */
function materialEvent(text = '【玄枢·问事上下文】\n【来源：底座谱】\n名称：底座\n【来源：底稿】\n底稿全文……') {
  return { type: 'user/message', seq: 1, time: Date.now(), data: { id: 'm-legacy', role: 'user', source: { kind: CONSULT_MESSAGE_SOURCE_KIND }, content: [{ type: 'text', text }] } }
}

/**
 * 一套现场：真目录 + 真旁挂清单 + 假 registry/fs。
 * `withFs:false` = 挂载内容读不出来；`basePu:false` = 还没起过盘；`pus` = 这次勾选的谱。
 */
async function scene({ withFs = true, digao = true, mounts = [], basePu = false, pus = ['软件开发'] } = {}) {
  const sandbox = makeSandbox('boundary')
  roots.push(sandbox)
  sandbox.write('work/README.md', '# 打印车间\n排产表在这里。\n')
  if (digao) sandbox.write('digao.md', DIGAO_TEXT)
  const registry = fakeWorkspaceRegistryForMounts({
    workspaces: [
      { id: 'ws-print', path: sandbox.path('work'), title: '打印车间' },
      { id: 'ws-b', path: sandbox.path('work-b'), title: 'B 车间' },
    ],
  })
  const agents = fakeAgents()
  const fs = withFs ? fakeFsReader() : undefined
  const host = makeHost({
    services: {
      xuanshuHorosa: fakeHorosa(envelope('bazi-ok-default')).service,
      agents: agents.service,
      workspaceRegistry: registry.service,
      ...(fs === undefined ? {} : { fs: fs.service }),
      agentPresets: fakeAgentPresets().service,
      agentDefaultModel: fakeAgentDefaultModel().service,
    },
  })
  if (basePu) await seedBasePu(sandbox, host.ctx)
  seedPu(sandbox, ZIWEI)
  seedPu(sandbox, RUANJIAN)
  const api = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir, mountBudget: 10_000 })
  const { session } = await api['consult.create']({ pus })
  if (mounts.length > 0) await api['consult.setMounts']({ sessionId: session.sessionId, mounts })
  const boundary = installConsultBoundary(host.ctx, { dataDir: sandbox.dataDir, mountBudget: 10_000 })
  /** 拿注册上去的那个 pre-step 监听器（宿主替身记下了）。 */
  const listener = host.listeners.find((entry) => entry.event === PRE_STEP_EVENT)?.listener
  const manifestOf = () => sandbox.json('consult', 'sessions', `${session.sessionId}.json`)
  return { sandbox, host, agents, api, session, boundary, listener, manifestOf }
}

/**
 * 走一次「边界 + 一步」，并把边界新增的消息**落进假日志** ——
 * 真 loop 就是这么做的（`dsh-agent-loop/lib/index.js:1061`）；不模拟这一步，
 * 「材料已经在日志里了」在替身上永远为假。
 *
 * @param {object} options `step` 默认 1；`claimed` 默认就是那一句问题
 */
async function step(listener, agent, { step: stepNumber = 1, claimed = [QUESTION], signal, append = true } = {}) {
  const decision = await listener(
    { agent, turn: 1, step: stepNumber, signal },
    () => Promise.resolve({ kind: 'enter', messages: claimed }),
  )
  if (append && Array.isArray(decision?.messages) && Array.isArray(agent?.events)) {
    for (const message of decision.messages) {
      if (claimed.includes(message)) continue
      agent.events.push({ type: 'user/message', seq: agent.events.length + 1, time: Date.now(), data: message })
    }
  }
  return decision
}

/** 边界补进来的那一条（没有就返回 undefined）。 */
const injectedOf = (decision) => decision.messages.find((message) => message?.source?.kind === CONSULT_MESSAGE_SOURCE_KIND)
const textOf = (message) => (message?.content ?? []).map((block) => block.text).join('\n')

/**
 * 交付账条目的形状：MountRef + `head`。
 *
 * `head` 是注入文本里 `【来源：挂载 <head>】` 标记的主体 —— 复核 48e0e0a 的 N3 之后，
 * 它就是「这一层到底进没进日志」的对账凭据（只比 kind/id/label 会漏掉它）。
 */
const ledgerEntry = (mount) => ({
  kind: mount.kind,
  id: mount.id,
  label: mount.label,
  head: expect.stringContaining(`「${mount.label}」`),
})

describe('发问边界 · 首次交付（R2：材料一次落进日志，永久在场）', () => {
  it('F2：失败撤下、失败重挂之后再撤下，仍须撤回曾经交付的旧正文', async () => {
    const { listener, session, api, sandbox } = await scene({ mounts: [SPEC] })
    const agent = loggedAgent(session.sessionId)
    await step(listener, agent)
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [] })
    await step(listener, agent, { append: false })
    sandbox.write('work/README.md', '新版工作区内容')
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [SPEC] })
    await step(listener, agent, { append: false })
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [] })
    const withdrawn = await step(listener, agent)
    expect(textOf(injectedOf(withdrawn))).toContain('已撤下、不再适用')
    expect(injectedOf(await step(listener, agent))).toBeUndefined()
  })

  it('F2：重挂时读取失败，也不能丢掉尚未确认的撤下', async () => {
    const { listener, session, api, host } = await scene({ mounts: [SPEC] })
    const agent = loggedAgent(session.sessionId)
    await step(listener, agent)
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [] })
    await step(listener, agent, { append: false })
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [SPEC] })
    host.ctx.get('fs').readText = async () => { throw new Error('工作区暂不可读') }
    await step(listener, agent)
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [] })
    expect(textOf(injectedOf(await step(listener, agent)))).toContain('已撤下、不再适用')
  })

  it('第一步：材料并进模型输入，排在用户那句话之前；底座谱 / 底稿 / 勾选谱都在', async () => {
    const { listener, session } = await scene()
    const agent = loggedAgent(session.sessionId)
    const decision = await step(listener, agent)

    const injected = injectedOf(decision)
    expect(injected, '边界没把材料并进这一步').toBeDefined()
    expect(decision.messages).toHaveLength(2)
    expect(decision.messages[1]).toBe(QUESTION) // 顺序：材料在前，用户那句话在后
    const text = textOf(injected)
    expect(text).toContain('【来源：底座谱】')
    expect(text).toContain('底稿正文第二行：手上有的谱。')
    expect(text).toContain('【来源：谱 软件开发】')
    expect(text).toContain('软件开发：项目、排期与复盘。')
  })

  it('第二步（同一轮的工具循环）不再重复；没有用户输入的那一步也不补（不凭空多一次模型调用）', async () => {
    const { listener, session } = await scene()
    const agent = loggedAgent(session.sessionId)
    const later = await step(listener, agent, { step: 2 })
    expect(injectedOf(later)).toBeUndefined()
    const empty = await step(listener, agent, { claimed: [] })
    expect(empty.messages).toEqual([])
  })

  it('第二轮：材料**已经在日志里**（loop 把上一步的消息追加了）→ 不再重发；没有挂载变化就什么都不注入', async () => {
    const { listener, session } = await scene()
    const agent = loggedAgent(session.sessionId)
    await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-1' }] })
    expect(agent.events).toHaveLength(1) // 第一步那条材料（替身按 loop 的行为落的）

    const second = await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-2' }] })
    expect(second.messages).toEqual([{ ...QUESTION, id: 'q-2' }])
    expect(agent.events, '材料不该被重复写进日志').toHaveLength(1)
  })

  it('非问事会话 / 没有旁挂清单的会话：一个字符都不补', async () => {
    const { listener } = await scene()
    const foreign = await step(listener, loggedAgent('session-1bb37188-5787-4f96-a6ec-0de66a825f2a'))
    expect(injectedOf(foreign)).toBeUndefined()
    const unknown = await step(listener, loggedAgent('session-xs-consult-00000000-0000-4000-8000-000000000000'))
    expect(injectedOf(unknown)).toBeUndefined()
  })

  it('上游拒绝这一步（reject）/ 信号已中止：原样返回，不掺东西', async () => {
    const { listener, session } = await scene()
    const agent = loggedAgent(session.sessionId)
    const rejected = await listener({ agent, turn: 1, step: 1 }, () => Promise.resolve({ kind: 'reject' }))
    expect(rejected).toEqual({ kind: 'reject' })
    const aborted = await step(listener, agent, { signal: { aborted: true } })
    expect(injectedOf(aborted)).toBeUndefined()
  })

  it('装配抛错：**不抛**，这一步照常返回（辅助材料不许弄挂别人的一轮问答）', async () => {
    const { listener } = await scene()
    const throwingAgent = {
      get session() {
        throw new Error('FAULT INJECTION: session 拿不到')
      },
    }
    const decision = await step(listener, throwingAgent)
    expect(decision.kind).toBe('enter')
    expect(injectedOf(decision)).toBeUndefined()
    expect(decision.messages).toEqual([QUESTION])
  })

  it('R2：空白创建之后 dispose（排队待消费的 inbox 被取消）→ 恢复回来问第一句，那一步照样带材料', async () => {
    // 评审探针的复刻（`.scratch/review-a2-spec-inbox-probe.mjs`）：`inject()` 只是排进 inbox，
    // 正常 `dispose()` 会追加 `outcome:"canceled"` 把它撤掉 —— 旧实现这条路**一个字都不剩**。
    // 边界交付的是**日志**（不是 inbox），所以恢复之后照带。
    const { agents, listener, session } = await scene()
    agents.live.clear() // 进程重启：本进程不再持有这条会话的 agent
    const resumed = await agents.service.resume({ resumeSessionId: session.sessionId })
    expect(resumed.agent.session.id).toBe(session.sessionId)
    const text = textOf(injectedOf(await step(listener, loggedAgent(session.sessionId))))
    expect(text).toContain('【来源：底座谱】')
    expect(text).toContain('底稿正文第二行：手上有的谱。')
  })

  it('老会话（日志里已经有材料）**且没有挂载**：什么都不补', async () => {
    const { listener, session } = await scene()
    const decision = await step(listener, loggedAgent(session.sessionId, [materialEvent()]))
    expect(injectedOf(decision)).toBeUndefined()
  })
})

describe('发问边界 · 挂载按变化补投（R3/R4）', () => {
  it('首次交付就带上挂载：披露 + 纳入层正文，并把「内容已交付」逐层记账', async () => {
    const { listener, session, manifestOf } = await scene({ mounts: [SPEC] })
    const agent = loggedAgent(session.sessionId)
    const text = textOf(injectedOf(await step(listener, agent)))

    expect(text).toContain('【来源：临时挂载·披露】')
    expect(text).toContain('【来源：挂载 工作区「打印车间」')
    expect(text).toContain('排产表在这里。')
    expect(manifestOf().mountsInjected).toEqual([ledgerEntry(SPEC)])
  })

  it('R3：重启后（没有活 agent）先确认挂载、再从原生 composer 问 —— 那一问补投这段挂载', async () => {
    // 评审 R3 的场景：`consult.setMounts` 那一刻没有 agent 可投递，
    // 而「继续这次问事」只是导航、原生 composer 不经过 consult.send —— 边界在**发问那一刻**补。
    const { api, listener, session, manifestOf } = await scene()
    const agent = loggedAgent(session.sessionId)
    // 第一问（此时还没挂任何东西）：材料落进日志。
    await step(listener, agent)
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [SPEC] })

    const decision = await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-2' }] })
    const text = textOf(injectedOf(decision))
    expect(text, '材料不该重发（已在日志里）').not.toContain('【来源：底座谱】')
    expect(text).toContain('本次补投临时挂载')
    expect(text).toContain('排产表在这里。')
    expect(manifestOf().mountsInjected).toEqual([ledgerEntry(SPEC)])
  })

  it('挂载没变：第二问不再重复投（内容已经在日志里了）', async () => {
    const { listener, session, manifestOf } = await scene({ mounts: [SPEC] })
    const agent = loggedAgent(session.sessionId)
    await step(listener, agent)
    const eventsAfterFirst = agent.events.length

    const second = await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-2' }] })
    expect(injectedOf(second)).toBeUndefined()
    expect(agent.events).toHaveLength(eventsAfterFirst)
    expect(manifestOf().mountsInjected).toEqual([ledgerEntry(SPEC)])
  })

  it('撤下挂载：说一句「不再适用」（S8 §5：不声明就会拿旧正文当现况）', async () => {
    const { api, listener, session, manifestOf } = await scene({ mounts: [SPEC] })
    const agent = loggedAgent(session.sessionId)
    await step(listener, agent)
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [] })

    const text = textOf(injectedOf(await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-2' }] })))
    expect(text).toContain('【来源：临时挂载·撤下】')
    expect(text).toContain('打印车间')
    expect(text).toContain('不再适用')
    // 撤下声明**落日志之前不许删条目**（R5）：这一问的消息 id 记在 `withdrawal` 上，下一问据此确认。
    expect(manifestOf().mountsInjected).toEqual([{ ...ledgerEntry(SPEC), withdrawal: expect.any(String) }])

    // 撤下这件事只说一次：下一问确认「声明已在日志里」，条目清掉、不再重复。
    const third = await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-3' }] })
    expect(injectedOf(third)).toBeUndefined()
    expect(manifestOf().mountsInjected).toEqual([])
  })

  it('R5：撤下声明**没落日志**（模型准备阶段失败）→ 条目留着，下一问重发撤下声明', async () => {
    // 反例一（评审 32216d9）：`setMounts([])` → 撤下那一问 `prepareCall` 抛错 ⇒ 声明没 append，
    // 而账已经把它清成 `[]` ⇒ 恢复模型再问也不补发，旧挂载正文永远留在历史里。
    const { api, listener, session, manifestOf } = await scene({ mounts: [SPEC] })
    const agent = loggedAgent(session.sessionId)
    await step(listener, agent) // 材料 + 挂载交付（落日志）
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [] })

    // 撤下那一问：边界返回了撤下声明（`step()` 照 loop 的行为把它落进假日志）。
    await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-2' }] })
    const appendedIndex = agent.events.findIndex((event) => textOf(event.data).includes('【来源：临时挂载·撤下】'))
    expect(appendedIndex, '这一问确实投了撤下声明').toBeGreaterThanOrEqual(0)
    expect(manifestOf().mountsInjected).toHaveLength(1)

    // 模拟「append 没发生」：把那条刚落进去的撤下声明摘掉（账留在原地）—— 这正是 R5 的现场。
    agent.events.splice(appendedIndex, 1)
    expect(agent.events.some((event) => textOf(event.data).includes('【来源：临时挂载·撤下】'))).toBe(false)

    // 下一问：声明不在日志里 ⇒ 必须重发（修之前这里永久沉默）。
    const retry = textOf(injectedOf(await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-3' }] })))
    expect(retry).toContain('【来源：临时挂载·撤下】')
    expect(retry).toContain('不再适用')

    // 再下一问：声明这次真的在日志里了 ⇒ 条目清掉、不再重复声明。
    const fourth = await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-4' }] })
    expect(injectedOf(fourth)).toBeUndefined()
    expect(manifestOf().mountsInjected).toEqual([])
  })

  it('R5：撤下确认后改工作区内容再重挂，首次投递没落日志 → 下一问补投**新版内容**', async () => {
    // 反例二（评审 32216d9）：成功挂载 → 成功撤下 → 改内容 → 重挂 → 准备失败。
    // 旧实现拿第一次挂载留下的正文标记当本次重挂的交付证据 ⇒ 新版内容永不补投。
    const { api, listener, session, sandbox, manifestOf } = await scene({ mounts: [SPEC] })
    const agent = loggedAgent(session.sessionId)
    await step(listener, agent) // 首轮：旧内容的挂载交付
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [] })
    await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-2' }] }) // 撤下声明落日志

    // 改工作区内容，再重新挂上。
    sandbox.write('work/README.md', '# 打印车间\nUPDATED_MOUNT_SENTINEL\n')
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [SPEC] })

    // 重挂后的首次投递（这一问会把新版内容投出去）。
    const remount = textOf(injectedOf(await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-3' }] })))
    expect(remount).toContain('UPDATED_MOUNT_SENTINEL')
    const appendedIndex = agent.events.findIndex((event) => textOf(event.data).includes('UPDATED_MOUNT_SENTINEL'))
    expect(appendedIndex, '这一问确实投了新版内容').toBeGreaterThanOrEqual(0)

    // 模拟「append 没发生」：旧一轮的正文标记还在日志里，但本次交付的回执没落 ⇒ 必须再投一次。
    agent.events.splice(appendedIndex, 1)
    const retry = textOf(injectedOf(await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-4' }] })))
    expect(retry, '旧一轮的正文标记不能充当本次重挂的回执').toContain('UPDATED_MOUNT_SENTINEL')

    // 这次真落了日志：再下一问不再重投。
    const last = await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-5' }] })
    expect(injectedOf(last)).toBeUndefined()
    expect(manifestOf().mountsInjected).toEqual([
      { ...ledgerEntry(SPEC), receipt: expect.any(String) },
    ])
  })

  it('R5：撤下声明没落日志时又把这一层挂回来 → 重投当前内容，待确认的撤下作废', async () => {
    // 撤下没成功（声明没进日志）、这一层又挂回来了：正文从没被撤回，但重挂必须当作**新一次交付**
    // ——旧正文在历史里、重挂后内容可能已经变了，宁可多投一次。
    const { api, listener, session, sandbox, manifestOf } = await scene({ mounts: [SPEC] })
    const agent = loggedAgent(session.sessionId)
    await step(listener, agent)
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [] })
    await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-2' }] })
    // 撤下声明没落日志（模型准备阶段失败）。
    const withdrawalIndex = agent.events.findIndex((event) => textOf(event.data).includes('【来源：临时挂载·撤下】'))
    agent.events.splice(withdrawalIndex, 1)
    expect(manifestOf().mountsInjected[0].withdrawal).toEqual(expect.any(String))

    // 内容变了，再挂回来。
    sandbox.write('work/README.md', '# 打印车间\nREMOUNT_AFTER_FAILED_WITHDRAWAL\n')
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [SPEC] })
    const text = textOf(injectedOf(await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-3' }] })))
    expect(text).toContain('REMOUNT_AFTER_FAILED_WITHDRAWAL')

    // 新交付确认前保留旧事实；确认后只剩新回执，不再有待确认的撤下。
    expect(manifestOf().mountsInjected).toEqual([{ ...ledgerEntry(SPEC), receipt: expect.any(String), previousDelivery: { head: ledgerEntry(SPEC).head } }])
    expect(injectedOf(await step(listener, agent))).toBeUndefined()
    expect(manifestOf().mountsInjected).toEqual([{ ...ledgerEntry(SPEC), receipt: expect.any(String) }])
  })

  it('R5 向后兼容：上一版写下的账（只有 head，没有 receipt）标记在日志里 ⇒ 照旧算已交付，不重投', async () => {
    // 老条目没有新字段时按现状处理：`【来源：挂载 <head>】` 标记在日志里就算交付过
    // —— 升级不许让每一问都重投一份大文本。
    const { listener, session, sandbox, manifestOf } = await scene({ mounts: [SPEC] })
    const agent = loggedAgent(session.sessionId, [materialEvent()]) // 材料已在日志里（老会话）
    const manifest = manifestOf()
    manifest.mountsInjected = [{ kind: SPEC.kind, id: SPEC.id, label: SPEC.label, head: '工作区「打印车间」' }]
    sandbox.write(`consult/sessions/${session.sessionId}.json`, `${JSON.stringify(manifest, null, 2)}\n`)
    // 日志里已经有这一层交付过的标记（上一版投的那个 head）。
    agent.events.push({
      type: 'user/message',
      seq: 2,
      time: Date.now(),
      data: { id: 'm-legacy-mount', role: 'user', source: { kind: CONSULT_MESSAGE_SOURCE_KIND }, content: [{ type: 'text', text: '【来源：挂载 工作区「打印车间」】\n排产表在这里。' }] },
    })

    const decision = await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-2' }] })
    expect(injectedOf(decision), '老账条目照旧算已交付 ⇒ 不许重投').toBeUndefined()
    expect(manifestOf().mountsInjected).toEqual([ledgerEntry(SPEC)])
  })

  it('R4：部分层读不出来 —— 只把读到的记账，下一问自动重试那一层', async () => {
    // A 读得到、B 一时读不到：不许把整份标成「已交付」，也不许永远不再读 B。
    const { listener, session, sandbox, manifestOf } = await scene({ mounts: [SPEC, SPEC_B] })
    const agent = loggedAgent(session.sessionId)

    const first = textOf(injectedOf(await step(listener, agent)))
    expect(first).toContain('排产表在这里。')
    expect(first).toContain('B 车间') // 披露里看得见（那是事实）
    expect(first).not.toContain('MOUNT_B_SENTINEL')
    expect(manifestOf().mountsInjected, '读不到内容的那一层不许记账').toEqual([ledgerEntry(SPEC)])

    // B 的文件就位：**下一问**补投 B 的内容（无需重新确认挂载）。
    sandbox.write('work-b/README.md', 'MOUNT_B_SENTINEL')
    const second = textOf(injectedOf(await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-2' }] })))
    expect(second).toContain('MOUNT_B_SENTINEL')
    expect(second).not.toContain('排产表在这里。') // A 已交付，不再重发
    expect(manifestOf().mountsInjected).toEqual([ledgerEntry(SPEC), ledgerEntry(SPEC_B)])
  })

  it('N3 连带：两层 head 撞车（两个工作区 id 指向同一路径、同名）时，两层都要投递且只投一次', async () => {
    // 日志对账以 `【来源：挂载 <head>】` 为键：head 撞车时第二层会被当成「已经交付过」而永不投递。
    // 预览层给撞车的 head 补了 id，所以这里两层各有各的标记。
    const sandbox = makeSandbox('boundary-heads')
    roots.push(sandbox)
    sandbox.write('work/README.md', 'HEAD_COLLISION_SENTINEL\n')
    const registry = fakeWorkspaceRegistryForMounts({
      workspaces: [
        { id: 'ws-one', path: sandbox.path('work'), title: '打印车间' },
        { id: 'ws-two', path: sandbox.path('work'), title: '打印车间' },
      ],
    })
    const agents = fakeAgents()
    const host = makeHost({
      services: {
        xuanshuHorosa: fakeHorosa(envelope('bazi-ok-default')).service,
        agents: agents.service,
        workspaceRegistry: registry.service,
        fs: fakeFsReader().service,
        agentPresets: fakeAgentPresets().service,
        agentDefaultModel: fakeAgentDefaultModel().service,
      },
    })
    seedPu(sandbox, ZIWEI)
    seedPu(sandbox, RUANJIAN)
    const api = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir, mountBudget: 10_000 })
    const { session } = await api['consult.create']({ pus: [] })
    const twinMounts = [
      { kind: 'workspace', id: 'ws-one', label: '打印车间' },
      { kind: 'workspace', id: 'ws-two', label: '打印车间' },
    ]
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: twinMounts })
    installConsultBoundary(host.ctx, { dataDir: sandbox.dataDir, mountBudget: 10_000 })
    const listener = host.listeners.find((entry) => entry.event === PRE_STEP_EVENT)?.listener
    const agent = loggedAgent(session.sessionId)
    const manifestOf = () => sandbox.json('consult', 'sessions', `${session.sessionId}.json`)

    const text = textOf(injectedOf(await step(listener, agent)))
    expect(text.match(/【来源：挂载 /gu), '两层各有一个标记（head 不撞车）').toHaveLength(2)
    expect(manifestOf().mountsInjected).toHaveLength(2)
    expect(new Set(manifestOf().mountsInjected.map((entry) => entry.head)).size).toBe(2)

    const second = await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-2' }] })
    expect(injectedOf(second), '两层都已交付 ⇒ 第二问不再重投').toBeUndefined()
    sandbox.cleanup()
  })

  it('老会话（日志里已有材料）+ 挂了东西：**只补挂载段**，材料不重复（复核第二轮的 HARD 2）', async () => {
    const { listener, session, manifestOf } = await scene({ mounts: [SPEC] })
    const text = textOf(injectedOf(await step(listener, loggedAgent(session.sessionId, [materialEvent()]))))

    expect(text).toContain('本次补投临时挂载')
    expect(text).toContain('排产表在这里。')
    expect(text).not.toContain('【来源：底座谱】')
    expect(text).not.toContain('底稿正文第二行')
    expect(manifestOf().mountsInjected).toEqual([ledgerEntry(SPEC)])
  })

  it('N3：账说已交付、但那条消息**没落进日志**（模型准备阶段失败）→ 下一问重投，不许永久跳过', async () => {
    // 复核 48e0e0a 的 N3 实测：边界先写交付账、再返回消息；loop 之后才 `prepareRequest()`，
    // 失败（INVALID_CONFIG / UNKNOWN_MODEL）就**不会** append —— 账已经前移，那一层永远不再补。
    // 修法：判断以**日志**为准（账只提供每层对应的标记），不一致下一问自愈。
    const { api, listener, session, manifestOf } = await scene()
    const agent = loggedAgent(session.sessionId, [materialEvent()]) // 材料已在日志里（老会话）
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [SPEC] })

    // 第一问：补投挂载段并记账（`step()` 照 loop 的行为把消息落进假日志）。
    await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-1' }] })
    const appendedIndex = agent.events.findIndex((event) => textOf(event.data).includes('【来源：挂载 '))
    expect(appendedIndex, '这一问确实投了挂载段').toBeGreaterThanOrEqual(0)
    expect(manifestOf().mountsInjected).toEqual([ledgerEntry(SPEC)])

    // 模拟「append 没发生」：把那条刚落进去的事件摘掉（账留在原地）—— 这正是 N3 的现场。
    agent.events.splice(appendedIndex, 1)
    expect(agent.events.some((event) => textOf(event.data).includes('【来源：挂载 '))).toBe(false)

    // 下一问：标记不在日志里 ⇒ 必须重投（修之前这里会永久跳过）。
    const retry = textOf(injectedOf(await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-2' }] })))
    expect(retry).toContain('排产表在这里。')
    expect(manifestOf().mountsInjected).toEqual([ledgerEntry(SPEC)])
  })

  it('N3 连带：工作流挂载（没有内容、只有一句 hint）也只投一次 —— 标记同样进日志', async () => {
    // 工作流层 `kept:false` 但带 hint：修之前它永远不算「已交付」⇒ 每一问都重投同一段披露。
    const workflow = { kind: 'workflow', id: 'wf-1', label: '周报' }
    const { listener, session, manifestOf } = await scene({ mounts: [workflow] })
    const agent = loggedAgent(session.sessionId)

    const first = textOf(injectedOf(await step(listener, agent)))
    expect(first).toContain('【来源：挂载 工作流「周报」】')
    expect(first).toContain('工作流内容的数据源属票 16')
    expect(first).toContain('没有可注入的内容')
    expect(manifestOf().mountsInjected).toEqual([ledgerEntry(workflow)])

    const second = await step(listener, agent, { claimed: [{ ...QUESTION, id: 'q-2' }] })
    expect(injectedOf(second), '工作流层不该每问重投').toBeUndefined()
  })
})

/**
 * 上下文**正文口径**（这些用例原本挂在 `consult.send` 的首轮注入上）：交付机制换了地方，
 * 但口径一个字没松 —— 概览 + summary + 路径，正文留给 AI 自己读；没勾的谱一个字符都不出现。
 */
describe('发问边界 · 正文口径（原 send.test.mjs 的首轮注入口径）', () => {
  /** 走一步，取边界并进来的那一段正文。 */
  async function injectedText(options) {
    const { listener, session } = await scene(options)
    return textOf(injectedOf(await step(listener, loggedAgent(session.sessionId))))
  }

  it('三段来源标记齐、内容只给概览 + summary + 路径（正文留给 AI 自己读）', async () => {
    const text = await injectedText({ basePu: true, pus: ['紫微笔记'] })

    expect(text).toContain('【来源：底座谱】')
    expect(text).toContain('【来源：底稿】')
    expect(text).toContain('【来源：谱 紫微笔记】')

    // 底座谱：票 08 的 manifest 概览 + summary + 文件路径（`pus/_base/**` 的真实路径）。
    expect(text).toContain('出生信息与八字底盘') // renderBaseDescription 的开头
    expect(text).toContain('四柱 己巳 丙子 丙寅 甲午') // renderBaseSummary 的原文

    // 底稿：契约要的是**全文**（它本身就是摘要层）。
    expect(text).toContain('底稿正文第二行：手上有的谱。')

    // 勾选谱：概览 + summary + 路径；**正文不进来**（票面第 3 条：AI 自己按需读）。
    expect(text).toContain('紫微斗数的读书笔记。')
    expect(text).toContain('紫微：十四主星与四化的笔记。')
    expect(text).not.toContain('这里是《紫微笔记》的正文')

    // 非勾选谱：连路径痕迹都不许有（勾选区失去意义就是从这种地方开始的）。
    expect(text).not.toContain('【来源：谱 软件开发】')
    expect(text).not.toContain('软件开发：项目、排期与复盘。')
  })

  it('底稿还没生成（票 13 的产物）：照样注入，但写明「底稿未生成」，且不顺手造一份空底稿', async () => {
    const { listener, session, sandbox } = await scene({ digao: false })
    const text = textOf(injectedOf(await step(listener, loggedAgent(session.sessionId))))
    expect(text).toContain('【来源：底稿】')
    expect(text).toMatch(/底稿未生成/u)
    expect(text).toContain(join(sandbox.dataDir, 'digao.md'))
    // 探测 ≠ 生产：不要顺手造一份空底稿。
    expect(sandbox.exists('digao.md')).toBe(false)
  })

  it('还没起过盘：底座段写明「底座未立」，其余照常', async () => {
    const text = await injectedText({ basePu: false })
    expect(text).toContain('【来源：底座谱】')
    expect(text).toMatch(/底座未立/u)
    expect(text).toContain('【来源：底稿】')
  })

  it('一个可选谱都没勾：注入里只有底座与底稿两段，没有任何「谱 …」段', async () => {
    const text = await injectedText({ pus: [] })
    expect(text).toContain('【来源：底座谱】')
    expect(text).toContain('【来源：底稿】')
    expect(text).not.toMatch(/【来源：谱 /u)
  })
})
