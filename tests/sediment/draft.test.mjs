/**
 * 票 15 · `sediment.draft`（契约 §3）：`{ sessionId, targetSlug? }` → `{ draftId, target, draft }`。
 *
 * 「导出汇总」这一步是 AI 唯一被允许做的事：**产出草稿**，不碰谱。
 * 所以这里钉三件事：
 *   ① 驱动的是**这场问事会话本身**（它有全部上下文）而不是另开一场会话；
 *      判据是 `ctx.agents.get/resume` 收到那个自铸 id、`agents.created` 为空；
 *   ② 模型吐的 JSON 必须被**校验**（缺 summary / 不是 JSON / 正文没有一级概览节 → 拒收 + 不落草稿）；
 *   ③ 目标谱可推断但要**确定**：`targetSlug` 优先，其次这场问事勾过的第一本可选谱，
 *      再不行就用谱列表里第一本；一本谱都没有时说清楚「没有可写入的谱」。
 *
 * 为什么这些用例必须能快速失败：`sediment.draft` 要等 `turn/end`，**顺序写错就是永久挂起**。
 * 所以假 agent 在 `followup()` 的那一刻就把「当时有几个 `session/event` 监听器」记下来，
 * 用例直接断言「等这一轮结束的订阅必须先于 followup 建立」，并给每条用例 10s 上限。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createConsultStore } from '../../packages/xuanshu-host/lib/consult/store.mjs'
import { createSedimentMethods } from '../../packages/xuanshu-host/lib/sediment/service.mjs'
import { createPuRepository } from '../../packages/xuanshu-host/lib/pu/repository.mjs'
import { SEDIMENT_SCHEMA } from '../../packages/xuanshu-host/lib/sediment/store.mjs'
import {
  assistantEvent,
  draftAnswer,
  fencedDraftAnswer,
  fakeAgentDefaultModel,
  fakeAgentPresets,
  fakeAgents,
  fakeSessionQuery,
  makeHost,
  makeSandbox,
  seedConsult,
  seedPu,
  turnEndEvent,
  userEvent,
} from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 假会话服务：任何调用都记账并抛（票 15 不许另开会话 —— 沉淀的是这一场问事）。 */
function fakeSessionStore() {
  const calls = []
  const trap = (name) => (...args) => {
    calls.push({ name, args })
    throw new Error(`票 15 不许用 ctx.sessions.${name}：沉淀的是这场问事会话本身，不另开一场。`)
  }
  return { calls, service: { create: trap('create'), prepare: trap('prepare'), enter: trap('enter') } }
}

/**
 * 起一套方法 + 沙箱 + 一场问事会话（真旁挂清单）。
 * @param {{pus?: string[], turns?: number, services?: object}} [options]
 */
function scene({ pus = [], turns = 1, services = {}, seed = [] } = {}) {
  const sandbox = makeSandbox('draft')
  roots.push(sandbox)
  const seeded = seed.map((item) => seedPu(sandbox, item))
  const consult = seedConsult(sandbox, { pus: pus.length > 0 ? pus : seeded.map((pu) => pu.slug), turns })
  const agents = fakeAgents()
  const sessions = fakeSessionStore()
  const query = fakeSessionQuery({
    [consult.sessionId]: [userEvent(1, { text: '今年事业怎么走？' }), userEvent(2, { text: '再具体点。' })],
  })
  const host = makeHost({
    services: {
      agents: agents.service,
      sessions: sessions.service,
      sessionQuery: query.service,
      agentPresets: fakeAgentPresets().service,
      agentDefaultModel: fakeAgentDefaultModel().service,
      ...services,
    },
  })
  const api = createSedimentMethods(host.ctx, { dataDir: sandbox.dataDir })
  return { sandbox, seeded, consult, agents, sessions, query, host, api, store: createConsultStore(sandbox.dataDir) }
}

/**
 * 让「导出汇总」真的发生一轮：followup 之后补上这一轮的答案与 `turn/end`。
 * 顺序与真机一致 —— 事件在 followup 之后到达。
 */
function answerRound({ agents, query, host }, sessionId, text) {
  let seq = 100
  return agents.onFollowup(({ sessionId: id }) => {
    if (id !== sessionId) return
    const events = query.events[sessionId] ?? []
    events.push(assistantEvent(seq, text))
    query.events[sessionId] = events
    const end = turnEndEvent(seq + 1, 1)
    seq += 2
    setTimeout(() => host.emit('session/event', { id: sessionId }, end), 0)
  })
}

const FAST = { timeout: 10_000 }

describe('票 15 · sediment.draft：AI 只产出草稿，不碰谱', FAST, () => {
  it('成功：驱动这一场问事会话（不另开会话），草稿落 <dataDir>/sediment/<draftId>.json', async () => {
    const sc = scene({ seed: [{ name: '事业与行业', description: '事业与行业的总览。' }] })
    answerRound(sc, sc.consult.sessionId, draftAnswer())

    const answer = await sc.api['sediment.draft']({ sessionId: sc.consult.sessionId })

    expect(Object.keys(answer).sort()).toEqual(['draft', 'draftId', 'target'])
    expect(answer.target).toEqual({ slug: '事业与行业', name: '事业与行业' })
    expect(answer.draft.description).toContain('沉淀')
    expect(answer.draft.body).toContain('# 概览')
    expect(answer.draft.summary).toBe('事业：稳为主，4—6 月有岗位变动窗口。')

    expect(sc.sandbox.exists('sediment', `${answer.draftId}.json`)).toBe(true)
    const stored = sc.sandbox.json('sediment', `${answer.draftId}.json`)
    expect(stored.schema).toBe(SEDIMENT_SCHEMA)
    expect(stored.sessionId).toBe(sc.consult.sessionId)
    expect(stored.draft).toEqual(answer.draft)

    // 驱动的是这一场会话：resume 它、不 create 新的。
    expect(sc.agents.resumed.map((row) => row.resumeSessionId)).toEqual([sc.consult.sessionId])
    expect(sc.agents.created, '不许为沉淀另开一场会话').toEqual([])
    expect(sc.sessions.calls, '不许用 ctx.sessions 造日志对象').toEqual([])
    // 谱一个字节都没被碰：确认闸在 commit 上。
    expect(sc.sandbox.exists('pus', '事业与行业', 'manifest.md')).toBe(true)
  })

  it('先订阅 turn/end 再 followup（顺序错了就是永久挂起），且提示里带上 skill 与目标谱', async () => {
    const sc = scene({ seed: [{ name: '事业与行业', description: '事业与行业的总览。' }] })
    answerRound(sc, sc.consult.sessionId, draftAnswer())
    // 在 followup 那一刻数一次「等这一轮结束的监听器」：顺序写反的实现这里是 0。
    const listenersAtFollowup = []
    sc.agents.onFollowup(() => listenersAtFollowup.push(sc.host.listenerCount('session/event')))

    await sc.api['sediment.draft']({ sessionId: sc.consult.sessionId })

    expect(listenersAtFollowup).toEqual([1])
    // 等到了就退订（否则每导出一次就积一个监听器）。
    expect(sc.host.listenerCount('session/event')).toBe(0)

    const followup = sc.agents.followups[0]
    expect(followup.sessionId).toBe(sc.consult.sessionId)
    expect(followup.message.role).toBe('user')
    // 来源标记：这是一条玄枢注入的指令，不是用户说的话（ADR-0009 第 5 条）。
    expect(followup.message.source).toEqual({ kind: 'xuanshu-sediment' })
    const prompt = followup.message.content.map((part) => part.text).join('\n')
    expect(prompt).toContain('xuanshu:sediment')
    expect(prompt).toContain('事业与行业')
    // 目标谱的**当前正文**必须进提示：草稿是「既有正文之上的更新」，不是另起一本。
    expect(prompt).toContain('旧正文')
    // 建模的答案只许是 JSON 三字段，这条要求必须写进提示里（否则解析必然靠运气）。
    for (const field of ['description', 'body', 'summary']) expect(prompt).toContain(field)
    // 提示里明说「不许直接写谱」——草稿只是草稿。
    expect(prompt).toMatch(/不要|不得|不许禁止?/u)
  })

  it('模型把 JSON 包在代码围栏里也认（真机上很常见）', async () => {
    const sc = scene({ seed: [{ name: '事业与行业', description: '总览。' }] })
    answerRound(sc, sc.consult.sessionId, fencedDraftAnswer())
    const answer = await sc.api['sediment.draft']({ sessionId: sc.consult.sessionId })
    expect(answer.draft.body).toContain('# 概览')
  })

  it('模型没吐 JSON / 缺 summary：拒收，草稿区一个字节都没落', async () => {
    const cases = [
      ['一段散文', '好的，我来总结一下：今年以稳为主。'],
      ['缺 summary', JSON.stringify({ description: '概览', body: '# 概览\n正文\n' })],
      ['summary 是空的', JSON.stringify({ description: '概览', body: '# 概览\n正文\n', summary: '   ' })],
      ['正文缺一级概览节', JSON.stringify({ description: '概览', body: '## 小节\n正文\n', summary: 's' })],
    ]
    for (const [label, text] of cases) {
      const sc = scene({ seed: [{ name: '事业与行业', description: '总览。' }] })
      answerRound(sc, sc.consult.sessionId, text)
      await expect(sc.api['sediment.draft']({ sessionId: sc.consult.sessionId }), label).rejects.toThrow()
      expect(sc.sandbox.exists('sediment'), `${label} 却落了草稿`).toBe(false)
    }
  })
})

describe('票 15 · sediment.draft：只认问事会话（分类载体 = 自铸 id 前缀）', FAST, () => {
  it('非问事会话 id：拒收，一次会话都不接、一个字节不落', async () => {
    const sc = scene({ seed: [{ name: '事业与行业', description: '总览。' }] })
    for (const sessionId of ['session-1bb37188', 'session-xs-rikke-1', '', undefined, 42]) {
      await expect(sc.api['sediment.draft']({ sessionId })).rejects.toThrow(/问事/u)
    }
    expect(sc.agents.resumed).toEqual([])
    expect(sc.sandbox.files().filter((file) => file.startsWith('sediment/'))).toEqual([])
  })

  it('id 形状对但旁挂清单不存在：拒收（列表以旁挂清单为准）', async () => {
    const sc = scene({ seed: [{ name: '事业与行业', description: '总览。' }] })
    await expect(sc.api['sediment.draft']({ sessionId: 'session-xs-consult-nonexistent' })).rejects.toThrow(/不存在/u)
    expect(sc.agents.resumed).toEqual([])
  })

  it('这场问事一句话都没问过（turns=0）：没有可沉淀的东西，拒收', async () => {
    const sc = scene({ seed: [{ name: '事业与行业', description: '总览。' }], turns: 0 })
    // 「真的没问过」= 旁挂清单与会话日志**都**是空的。场景默认会注册两句问话（那是给成功路径用的），
    // 这里必须清掉 —— 否则测的就不是「没问过」，而是「旁挂清单与会话日志不一致」（见下一条用例）。
    sc.query.events[sc.consult.sessionId] = []
    await expect(sc.api['sediment.draft']({ sessionId: sc.consult.sessionId })).rejects.toThrow(/还没有|没问/u)
    expect(sc.agents.resumed).toEqual([])
  })

  it('旁挂清单说 0 轮、会话日志里真的问过（原生 composer 说的那两句）→ 按日志补账，不拒收', async () => {
    // 评审发现的那条洞：`turns` 只记玄枢受理过的轮次，用户从原生 composer 说的话不在里面 ——
    // 只看旁挂清单的话，一场真问过的问事会被这里拒掉。判据是**会话日志**（consult/turns.mjs）。
    const sc = scene({ seed: [{ name: '事业与行业', description: '总览。' }], turns: 0 })
    expect(sc.store.read(sc.consult.sessionId).turns).toBe(0)
    answerRound(sc, sc.consult.sessionId, draftAnswer())

    const answer = await sc.api['sediment.draft']({ sessionId: sc.consult.sessionId })
    expect(answer.draft.body).toContain('# 概览')
    // 账补上了：日志里那两句 = 2 轮（并且这一步不是「编一个数」，是数出来的）。
    expect(sc.store.read(sc.consult.sessionId).turns).toBe(2)
  })
})

describe('票 15 · sediment.draft：目标谱的推断与拒收', FAST, () => {
  it('targetSlug 优先于这场问事勾过的谱', async () => {
    const sc = scene({ seed: [{ name: '紫微笔记', description: '紫微的总览。' }, { name: '事业与行业', description: '事业的总览。' }] })
    answerRound(sc, sc.consult.sessionId, draftAnswer())
    const answer = await sc.api['sediment.draft']({ sessionId: sc.consult.sessionId, targetSlug: '事业与行业' })
    expect(answer.target.slug).toBe('事业与行业')
  })

  it('没给 targetSlug：用这场问事勾过的**第一本**可选谱', async () => {
    const sc = scene({ seed: [{ name: '紫微笔记', description: '紫微的总览。' }, { name: '事业与行业', description: '事业的总览。' }] })
    answerRound(sc, sc.consult.sessionId, draftAnswer())
    const answer = await sc.api['sediment.draft']({ sessionId: sc.consult.sessionId })
    expect(answer.target).toEqual({ slug: '紫微笔记', name: '紫微笔记' })
  })

  it('这场问事没勾谱：退回谱列表里第一本可选谱', async () => {
    const sandbox = makeSandbox('draft-fallback')
    roots.push(sandbox)
    const seeded = [seedPu(sandbox, { name: '紫微笔记', description: '紫微的总览。' })]
    const consult = seedConsult(sandbox, { pus: [], turns: 1 })
    const agents = fakeAgents()
    const query = fakeSessionQuery({ [consult.sessionId]: [userEvent(1, { text: '问一句' })] })
    const host = makeHost({
      services: {
        agents: agents.service,
        sessionQuery: query.service,
        agentPresets: fakeAgentPresets().service,
        agentDefaultModel: fakeAgentDefaultModel().service,
      },
    })
    const api = createSedimentMethods(host.ctx, { dataDir: sandbox.dataDir })
    answerRound({ agents, query, host }, consult.sessionId, draftAnswer())

    const answer = await api['sediment.draft']({ sessionId: consult.sessionId })
    expect(answer.target).toEqual({ slug: seeded[0].slug, name: '紫微笔记' })
  })

  it('勾过的谱已经被删掉：跳过它，别把草稿指向一本读不出来的谱', async () => {
    const sandbox = makeSandbox('draft-deleted')
    roots.push(sandbox)
    const alive = seedPu(sandbox, { name: '事业与行业', description: '事业的总览。' })
    const consult = seedConsult(sandbox, { pus: ['紫微笔记', '事业与行业'], turns: 1 })
    const agents = fakeAgents()
    const query = fakeSessionQuery({ [consult.sessionId]: [userEvent(1, { text: '问一句' })] })
    const host = makeHost({
      services: {
        agents: agents.service,
        sessionQuery: query.service,
        agentPresets: fakeAgentPresets().service,
        agentDefaultModel: fakeAgentDefaultModel().service,
      },
    })
    const api = createSedimentMethods(host.ctx, { dataDir: sandbox.dataDir })
    answerRound({ agents, query, host }, consult.sessionId, draftAnswer())

    const answer = await api['sediment.draft']({ sessionId: consult.sessionId })
    expect(answer.target.slug).toBe(alive.slug)
  })

  it('一本可选谱都没有：说清楚「先去 S5 建一本谱」，且不接会话', async () => {
    const sc = scene({ seed: [] })
    await expect(sc.api['sediment.draft']({ sessionId: sc.consult.sessionId })).rejects.toThrow(/谱/u)
    expect(sc.agents.resumed).toEqual([])
  })

  it('targetSlug 指向不存在的谱：拒收（不新建、不猜）', async () => {
    const sc = scene({ seed: [{ name: '事业与行业', description: '总览。' }] })
    await expect(sc.api['sediment.draft']({ sessionId: sc.consult.sessionId, targetSlug: 'nope' })).rejects.toThrow(/nope/u)
    expect(sc.agents.resumed).toEqual([])
  })
})

describe('票 15 · sediment.draft：跑不了一轮就先说不行', FAST, () => {
  it('缺 agentDefaultModel（没有 provider/model）：可读失败，不 followup', async () => {
    const sandbox = makeSandbox('draft-nomodel')
    roots.push(sandbox)
    seedPu(sandbox, { name: '事业与行业', description: '总览。' })
    const consult = seedConsult(sandbox, { pus: ['事业与行业'], turns: 1 })
    const agents = fakeAgents()
    const query = fakeSessionQuery({ [consult.sessionId]: [userEvent(1, { text: '问一句' })] })
    const host = makeHost({
      services: {
        agents: agents.service,
        sessionQuery: query.service,
        agentPresets: fakeAgentPresets().service,
        // 刻意不给 agentDefaultModel。
      },
    })
    const api = createSedimentMethods(host.ctx, { dataDir: sandbox.dataDir })
    await expect(api['sediment.draft']({ sessionId: consult.sessionId })).rejects.toThrow(/agentDefaultModel|模型/u)
    expect(agents.followups).toEqual([])
    expect(agents.resumed).toEqual([])
  })

  it('会话正文读不出来（sessionQuery 不可得）：可读失败，不落草稿', async () => {
    const sandbox = makeSandbox('draft-noquery')
    roots.push(sandbox)
    seedPu(sandbox, { name: '事业与行业', description: '总览。' })
    const consult = seedConsult(sandbox, { pus: ['事业与行业'], turns: 1 })
    const agents = fakeAgents()
    const host = makeHost({
      services: {
        agents: agents.service,
        agentPresets: fakeAgentPresets().service,
        agentDefaultModel: fakeAgentDefaultModel().service,
      },
    })
    const api = createSedimentMethods(host.ctx, { dataDir: sandbox.dataDir })
    agents.onFollowup(() => { setTimeout(() => host.emit('session/event', { id: consult.sessionId }, turnEndEvent(9)), 0) })
    await expect(api['sediment.draft']({ sessionId: consult.sessionId })).rejects.toThrow(/sessionQuery|会话/u)
    expect(sandbox.exists('sediment')).toBe(false)
  })

  it('取消（signal 已 abort）：可读失败，不落草稿', async () => {
    const sc = scene({ seed: [{ name: '事业与行业', description: '总览。' }] })
    const controller = new AbortController()
    controller.abort()
    answerRound(sc, sc.consult.sessionId, draftAnswer())
    await expect(sc.api['sediment.draft']({ sessionId: sc.consult.sessionId }, controller.signal)).rejects.toThrow(/取消|中止/u)
    expect(sc.sandbox.exists('sediment')).toBe(false)
  })

  it('草稿只暂存，不改任何谱（导出汇总不是写入）', async () => {
    const sc = scene({ seed: [{ name: '事业与行业', description: '总览。' }] })
    const before = sc.sandbox.snapshot()
    answerRound(sc, sc.consult.sessionId, draftAnswer())
    await sc.api['sediment.draft']({ sessionId: sc.consult.sessionId })
    const after = sc.sandbox.snapshot()
    for (const file of Object.keys(before)) expect(after[file], `${file} 被改了`).toBe(before[file])
    // 新增的只有草稿文件。
    expect(Object.keys(after).filter((file) => !(file in before))).toHaveLength(1)
    expect(Object.keys(after).find((file) => !(file in before))).toMatch(/^sediment\//u)
    expect(createPuRepository(sc.sandbox.dataDir).read('事业与行业').body).toContain('旧正文')
  })
})
