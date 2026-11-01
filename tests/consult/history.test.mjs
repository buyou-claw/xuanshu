/**
 * 票 10 · `consult.list` / `consult.read` / `consult.rename`（契约 §2，S7）
 *
 * 历史回看的**两条权威分开**（ADR-0009 Consequences）：
 *   - `consult.list` 读**旁挂清单目录**（含本次勾选的谱与挂载），**不扫会话日志**；
 *   - `consult.read` 的正文走 `ctx.sessionQuery.readSession(id)`（本机日志是 `session.v4.jsonl.zstd`，
 *     **不要自己解压**）。
 *
 * 抓的真实缺陷/风险：
 *   ① **list 去扫会话日志反推清单**：慢、且反推不出「这次勾了哪些谱」（`meta` 读不回）。判据是
 *      「不给 sessionQuery 也照样列得出来」+「假 sessionQuery 零调用」。
 *   ② **read 自己解压 / 自己读文件**：zstd 细节一变就全红，且绕过了 replay 校验。
 *   ③ **把工具结果当消息读出去**：阅读器要的是「你问 → AI 答」，`tool/result` 混进消息流会让回看变成日志。
 *   ④ **损坏的旁挂文件拖垮整张列表**：一条坏记录不该让「历史」整页打不开。
 *   ⑤ **改名不改权威**：改名必须落到旁挂清单上（列表与阅读器都读它），否则重启就丢。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { BESTOF_SCHEMA, createBestofStore } from '../../packages/xuanshu-host/lib/consult/bestof-store.mjs'
import { buildCandidateHistory, projectConsultMessages } from '../../packages/xuanshu-host/lib/consult/history.mjs'
import {
  assistantEvent,
  envelope,
  fakeAgents,
  fakeHorosa,
  fakeSessionQuery,
  makeHost,
  makeSandbox,
  seedBasePu,
  userEvent,
} from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

const QUESTION = '帮我看这次转岗的时机'
const T1 = Date.parse('2026-10-15T00:41:00.000Z')
const T2 = Date.parse('2026-10-15T00:41:01.000Z')
const T3 = Date.parse('2026-10-15T00:41:20.000Z')
const T5 = Date.parse('2026-10-15T00:42:00.000Z')

/** 一条真实形状的会话事件流：注入消息 → 用户问题 → AI 答 → 工具结果 → AI 再答。 */
const EVENTS = [
  userEvent(1, { id: 'm1', role: 'user', source: { kind: 'xuanshu-consult' }, content: [{ type: 'text', text: '【玄枢·问事上下文】……' }] }, T1),
  userEvent(2, { id: 'm2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: QUESTION }] }, T2),
  assistantEvent(3, '先读你的谱……', T3),
  { type: 'tool/result', seq: 4, time: T3 + 1000, data: { callId: 'c1', content: [{ type: 'text', text: '不该出现在回看里' }], isError: false } },
  assistantEvent(5, '结论：这次转岗宜缓。', T5),
]

/** 起一套方法 + 沙箱；`sessionQuery` 可缺席（用来验 list 不依赖它）。 */
async function scene({ withSessionQuery = true, events = EVENTS } = {}) {
  const sandbox = makeSandbox('history')
  roots.push(sandbox)
  const fake = fakeHorosa(envelope('bazi-ok-default'))
  const agents = fakeAgents()
  const query = fakeSessionQuery()
  const services = { xuanshuHorosa: fake.service, agents: agents.service }
  if (withSessionQuery) services.sessionQuery = query.service
  const host = makeHost({ services })
  await seedBasePu(sandbox, host.ctx)
  const api = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
  const { session } = await api['consult.create']({ pus: [] })
  if (events !== null) query.events[session.sessionId] = events
  return { sandbox, host, api, agents, query, session }
}

describe('consult.list · 旁挂清单是列表权威（不扫会话日志）', () => {
  it('按 createdAt 倒序；每项形状是 ConsultSummary', async () => {
    const { api, session } = await scene()
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await api['consult.create']({ pus: ['紫微笔记'] })

    const { items } = await api['consult.list']({})
    expect(items.map((item) => item.sessionId)).toEqual([second.session.sessionId, session.sessionId])
    expect(Object.keys(items[0]).sort()).toEqual(['createdAt', 'mounts', 'pus', 'sessionId', 'title', 'turns'])
    expect(items[0]).toMatchObject({ title: '未命名问事', pus: ['紫微笔记'], mounts: [], turns: 0 })
  })

  it('会话日志不是清单来源：没有 sessionQuery 服务也照样列得出来', async () => {
    const { api, sandbox } = await scene({ withSessionQuery: false })
    const { items } = await api['consult.list']({})
    expect(items).toHaveLength(1)
    expect(sandbox.exists('consult', 'sessions', `${items[0].sessionId}.json`)).toBe(true)
  })

  it('旁挂清单里没有的会话（一条别的会话日志）不会出现在列表里', async () => {
    const { api, query } = await scene()
    // 会话日志里造一条不属于问事的记录：清单是权威，它不该冒出来。
    query.events['session-foreign'] = EVENTS
    const { items } = await api['consult.list']({})
    expect(items.map((item) => item.sessionId)).not.toContain('session-foreign')
    expect(query.calls).toEqual([])
  })

  it('坏掉的旁挂文件不拖垮整张列表（其余照常列出）', async () => {
    const { api, sandbox, session } = await scene()
    sandbox.write('consult/sessions/session-xs-consult-broken.json', '{ 这不是 JSON')
    const { items } = await api['consult.list']({})
    expect(items.map((item) => item.sessionId)).toEqual([session.sessionId])
  })
})

describe('consult.read · 正文走 ctx.sessionQuery.readSession', () => {
  it('回放成 user/assistant 消息；注入行带得出 source，工具结果不进消息流', async () => {
    const { api, query, session } = await scene()
    const answer = await api['consult.read']({ sessionId: session.sessionId })

    expect(query.calls).toEqual([session.sessionId])
    expect(Object.keys(answer).sort()).toEqual(['messages', 'session'])
    expect(answer.session.sessionId).toBe(session.sessionId)
    expect(answer.messages).toEqual([
      { role: 'user', text: '【玄枢·问事上下文】……', at: new Date(T1).toISOString(), source: 'xuanshu-consult' },
      { role: 'user', text: QUESTION, at: new Date(T2).toISOString(), source: 'user' },
      { role: 'assistant', text: '先读你的谱……', at: new Date(T3).toISOString(), source: 'model' },
      { role: 'assistant', text: '结论：这次转岗宜缓。', at: new Date(T5).toISOString(), source: 'model' },
    ])
  })

  it('刚建好、还没落盘的会话：sessionQuery 报 not-found → messages 为空数组而不是报错', async () => {
    const { api, session, query } = await scene()
    query.service.readSession = async () => {
      const error = new Error(`session "${session.sessionId}" not found`)
      error.code = 'SESSION_QUERY_SESSION_NOT_FOUND'
      throw error
    }
    const answer = await api['consult.read']({ sessionId: session.sessionId })
    expect(answer.messages).toEqual([])
    expect(answer.session.sessionId).toBe(session.sessionId)
  })

  it('会话读坏了（不是 not-found）：把 upstream 的错误原文带出来，不吞', async () => {
    const { api, session, query } = await scene()
    query.service.readSession = async () => {
      throw new Error('corrupt session log')
    }
    await expect(api['consult.read']({ sessionId: session.sessionId })).rejects.toThrow(/corrupt session log/u)
  })

  it('没有 sessionQuery 服务：明确说清读不了正文（不假装空会话）', async () => {
    const { api, session } = await scene({ withSessionQuery: false })
    await expect(api['consult.read']({ sessionId: session.sessionId })).rejects.toThrow(/读会话的服务|读不出/u)
  })

  it('没有旁挂清单的会话：拒绝（先 consult.list 看有没有）', async () => {
    const { api } = await scene()
    await expect(api['consult.read']({ sessionId: 'session-xs-consult-不存在' })).rejects.toThrow(/问事记录|不存在/u)
  })
})

/**
 * 回看按轮标出当前采用稿（票 31；Spec 002 §补两处已知缺陷）。
 *
 * 服务端已经有「当前采用稿」的集合语义（`currentAdoptedMessageIds`），但它只说得出
 * **哪几份算数**，说不出「这份属于第几轮」—— 客户端要按轮分组，就得由 `consult.read`
 * 把轮次表（含每轮当前稿）与消息 id 一并交出去，否则客户端只能自己再实现一遍按轮语义。
 *
 * 加性口径：没有合参记录的会话**一个键都不多**（老响应的 `{session, messages}` 逐字不变）。
 */
describe('consult.read · 回看按轮标出当前采用稿（票 31）', () => {
  /** 一条采用稿消息（`source.kind = xuanshu-bestof-adopted`）；`messageId` 与账本里那条对得上。 */
  const adoptedEvent = (seq, id, text, time = T5) => userEvent(seq, {
    id,
    role: 'user',
    source: { kind: 'xuanshu-bestof-adopted' },
    content: [{ type: 'text', text }],
  }, time)

  /** 落一份带上账本的合参记录（旁挂文件的真形状；`schema` 认不出就当没有）。 */
  const writeBestof = (sandbox, sessionId, draftLedger) => createBestofStore(sandbox.dataDir).write({
    schema: BESTOF_SCHEMA,
    sessionId,
    runId: 'bestof-current-run',
    draftLedger,
  })

  it('多轮各采用一份：带出每轮的当前采用稿（客户端据此按轮分组）', async () => {
    const { api, query, session, sandbox } = await scene()
    writeBestof(sandbox, session.sessionId, [
      { kind: 'adopted', messageId: 'm-r1', candidateId: 'c1', runId: 'bestof-r1', at: '2026-10-15T00:41:00.000Z' },
      { kind: 'adopted', messageId: 'm-r2', candidateId: 'c2', runId: 'bestof-r2', at: '2026-10-15T00:42:00.000Z' },
    ])
    query.events[session.sessionId] = [
      userEvent(1, { id: 'm-q', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: QUESTION }] }, T1),
      adoptedEvent(2, 'm-r1', '方案 A：先按 3000/月 试算。'),
      adoptedEvent(3, 'm-r2', '方案 B：先核对前提。'),
    ]
    const answer = await api['consult.read']({ sessionId: session.sessionId })

    expect(answer.drafts.rounds).toEqual([
      { runId: 'bestof-r1', round: 1, messageIds: ['m-r1'], currentId: 'm-r1', rejected: false },
      { runId: 'bestof-r2', round: 2, messageIds: ['m-r2'], currentId: 'm-r2', rejected: false },
    ])
    expect(answer.drafts.currentIds.sort()).toEqual(['m-r1', 'm-r2'])
    // 消息自带 messageId：客户端才能把「这一条」对到「哪一轮」，正文一字不改。
    expect(answer.messages.filter((message) => message.source === 'xuanshu-bestof-adopted').map((message) => message.messageId))
      .toEqual(['m-r1', 'm-r2'])
  })

  it('被否决的轮：回看里仍看得到那份稿，但它**不是**当前（currentId 为空、当前集合为空）', async () => {
    const { api, query, session, sandbox } = await scene()
    writeBestof(sandbox, session.sessionId, [
      { kind: 'adopted', messageId: 'm-old', candidateId: 'c1', runId: 'bestof-r1', at: '2026-10-15T00:41:00.000Z' },
      { kind: 'rejected', runId: 'bestof-r1' },
    ])
    query.events[session.sessionId] = [
      userEvent(1, { id: 'm-q', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: QUESTION }] }, T1),
      adoptedEvent(2, 'm-old', '方案 A：先按 3000/月 试算。'),
    ]
    const answer = await api['consult.read']({ sessionId: session.sessionId })

    expect(answer.drafts.rounds).toEqual([
      { runId: 'bestof-r1', round: 1, messageIds: ['m-old'], currentId: undefined, rejected: true },
    ])
    expect(answer.drafts.currentIds).toEqual([])
    // 「不列为当前」不是「从回看里删掉」：正文仍要看得到（历史是只读的）。
    expect(answer.messages.some((message) => message.messageId === 'm-old')).toBe(true)
  })

  it('没有合参记录：不加 drafts 键（老响应逐字不变，老客户端照常工作）', async () => {
    const { api, session } = await scene()
    const answer = await api['consult.read']({ sessionId: session.sessionId })
    expect(Object.keys(answer).sort()).toEqual(['messages', 'session'])
  })
})

describe('consult.rename · 改名落到旁挂清单', () => {
  it('返回改后的 ConsultSummary，列表与阅读器都跟着变', async () => {
    const { api, sandbox, session } = await scene()
    const answer = await api['consult.rename']({ sessionId: session.sessionId, title: '  转岗时机  ' })

    expect(answer.session).toMatchObject({ sessionId: session.sessionId, title: '转岗时机' })
    expect(sandbox.json('consult', 'sessions', `${session.sessionId}.json`).title).toBe('转岗时机')
    const { items } = await api['consult.list']({})
    expect(items[0].title).toBe('转岗时机')
  })

  it('空标题 / 非文本标题：拒绝，且不改盘', async () => {
    const { api, sandbox, session } = await scene()
    const before = sandbox.read('consult', 'sessions', `${session.sessionId}.json`)
    for (const title of ['', '   ', 42, undefined]) {
      await expect(api['consult.rename']({ sessionId: session.sessionId, title })).rejects.toThrow(/标题/u)
    }
    expect(sandbox.read('consult', 'sessions', `${session.sessionId}.json`)).toBe(before)
  })

  it('没有旁挂清单的会话：拒绝', async () => {
    const { api } = await scene()
    await expect(api['consult.rename']({ sessionId: 'session-xs-consult-不存在', title: 'x' })).rejects.toThrow(/问事记录|不存在/u)
  })
})

/**
 * `buildCandidateHistory()` —— 合参候选带的那段会话历史（评审 R5；纯函数，窗口与口径都在这里钉住）。
 *
 * 判据都打在**文本**上：模型看到的就是这段文本，回看也是这段文本。
 */
describe('合参候选的会话历史 · 窗口与口径（评审 R5）', () => {
  const messages = [
    { role: 'user', text: '第一轮：预算怎么定？', source: 'user' },
    { role: 'assistant', text: 'ANSWER_1：先按 3000/月 试算。' },
    { role: 'user', text: 'MATERIAL：底座谱概览', source: 'xuanshu-consult' },
    { role: 'user', text: 'ADOPTED：方案 A，3000/月。', source: 'xuanshu-bestof-adopted' },
    { role: 'assistant', text: 'ANSWER_2：那按 A 走。' },
  ]

  it('注入的谱资料不进历史（它已经作为「材料」单独给了候选）；采用稿单独标；顺序照日志', () => {
    const built = buildCandidateHistory({ messages, budget: null })
    expect(built.text).toContain('用户：第一轮：预算怎么定？')
    expect(built.text).toContain('助手：ANSWER_1：先按 3000/月 试算。')
    expect(built.text).toContain('已采用的合参稿：ADOPTED：方案 A，3000/月。')
    expect(built.text).not.toContain('MATERIAL')
    expect(built.included).toBe(4)
    expect(built.omitted).toBe(0)
    // 顺序 = 日志顺序（采用稿夹在第一条回答之后）。
    expect(built.text.indexOf('ANSWER_1')).toBeLessThan(built.text.indexOf('ADOPTED'))
    expect(built.text.indexOf('ADOPTED')).toBeLessThan(built.text.indexOf('ANSWER_2'))
  })

  it('预算未知（拿不到模型窗口）：不做裁剪，全部带上，并如实说一句', () => {
    const built = buildCandidateHistory({ messages, budget: null })
    expect(built.omitted).toBe(0)
    expect(built.text).toContain('预算未知')
    expect(built.text).not.toMatch(/省略了/u)
  })

  it('窗口按**整条**消息裁（从最新往回装），并写明省略了几条', () => {
    // 只够装最后两条（"助手：ANSWER_2：那按 A 走。" + "已采用的合参稿：ADOPTED：方案 A，3000/月。"）。
    const built = buildCandidateHistory({ messages, budget: 60 })
    expect(built.included).toBe(2)
    expect(built.omitted).toBe(2)
    expect(built.text).toContain('ANSWER_2')
    expect(built.text).toContain('ADOPTED')
    expect(built.text).not.toContain('ANSWER_1')
    expect(built.text).toMatch(/历史按 60 字窗口裁剪：省略了更早的 2 条消息/u)
  })

  it('最新一条自己就超窗口：照样带上（宁可超窗口，也不许候选对刚发生的事一无所知）', () => {
    const built = buildCandidateHistory({ messages: [{ role: 'user', text: 'x'.repeat(500) }], budget: 10 })
    expect(built.included).toBe(1)
    expect(built.omitted).toBe(0)
    expect(built.text).toContain('x'.repeat(500))
  })

  it('没有历史（空会话 / 只有注入行）：返回空串，调用方据此连标题都不加', () => {
    expect(buildCandidateHistory({ messages: [], budget: null }).text).toBe('')
    expect(buildCandidateHistory({ messages: [{ role: 'user', text: 'MATERIAL', source: 'xuanshu-consult' }], budget: 100 }).text).toBe('')
  })
})

/**
 * 采用稿的**当前性**过滤（复核 48e0e0a 的 N4）。
 *
 * 日志是追加式的：改选 / 否决都不会删掉旧的采用稿消息。投影层负责把「不再算数的那几份」挡在外面 ——
 * 判据由 `bestof-store.mjs` 的 `currentAdoptedMessageIds` 给（`null` = 判不出来，不过滤）。
 */
describe('候选历史的采用稿过滤 · 只带当前那一份（N4）', () => {
  const ADOPTED = (id, text) => ({ type: 'user/message', seq: Number(id.slice(1)), time: T2, data: { id, role: 'user', source: { kind: 'xuanshu-bestof-adopted' }, content: [{ type: 'text', text }] } })
  const events = [
    userEvent(1, { id: 'm-q', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: QUESTION }] }, T1),
    ADOPTED('m-c1', 'ADOPTED_C1：先看大方向。'),
    ADOPTED('m-c2', 'ADOPTED_C2：先核对前提。'),
  ]

  it('改选之后：只保留当前那一份（旧的那份从候选历史里消失）', () => {
    const messages = projectConsultMessages({ events }, { keepAdoptedIds: new Set(['m-c2']) })
    const text = messages.map((message) => message.text).join('\n')
    expect(text).toContain('ADOPTED_C2')
    expect(text).not.toContain('ADOPTED_C1')
    // 不是「把所有注入都删了」：用户问题照常在里面
    expect(text).toContain(QUESTION)
  })

  it('否决之后：一份采用稿都不进候选历史（keepAdoptedIds 为空集）', () => {
    const messages = projectConsultMessages({ events }, { keepAdoptedIds: new Set() })
    const text = messages.map((message) => message.text).join('\n')
    expect(text).not.toContain('ADOPTED_C1')
    expect(text).not.toContain('ADOPTED_C2')
    expect(text).toContain(QUESTION)
  })

  it('判不出来（`null` / 不给）：不过滤 —— 阅读器那一侧照旧看得到全部投递史', () => {
    for (const options of [undefined, {}, { keepAdoptedIds: null }]) {
      const messages = projectConsultMessages({ events }, options)
      const text = messages.map((message) => message.text).join('\n')
      expect(text).toContain('ADOPTED_C1')
      expect(text).toContain('ADOPTED_C2')
    }
  })

  it('候选历史文本里也只出现当前那一份（投影 + 窗口两段串起来看）', () => {
    const messages = projectConsultMessages({ events }, { keepAdoptedIds: new Set(['m-c1']) })
    const built = buildCandidateHistory({ messages, budget: null })
    expect(built.text).toContain('已采用的合参稿：ADOPTED_C1')
    expect(built.text).not.toContain('ADOPTED_C2')
  })
})
