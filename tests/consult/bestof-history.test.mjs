/**
 * task-14 · 采用稿进会话历史（落选候选永不进日志）。
 *
 * 「历史只带采用稿」这一条在票 11 首版只做到一半：候选**从不**进日志 ✓，但**采用稿也没进** ✗ ——
 * 于是「采用」对后续对话没有任何影响。这一条把缺口补上，并且把**更重要的那一半**钉死：
 * 我们必须能证明**没把 N 份候选悄悄灌进用户的会话**。
 *
 * 载体：`agent.followup(createUserMessage({ content, source:{ kind:'xuanshu-bestof-adopted' } }))`
 * —— `user/message` 是**已登记**的事件类型（不新增 type、不碰 `meta`），自定义 `source.kind`
 * 让它在轨迹里显示成一条「注入」行而不是用户原话（ADR-0009 第 5 条）。
 *
 * 断言台里「会话日志」怎么取：假 agent 的 `calls` 就是宿主**能**影响日志的全部面
 * （`inject` / `followup` 是仅有的两条投递通道）—— 所以对这一串做逐字 grep 与前后 diff，
 * 等价于「宿主往日志里放了什么」。真正的 JSONL 端到端另有一条 profile 门控用例
 * （`bestof-history-real.test.mjs`）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createBestOfMethods } from '../../packages/xuanshu-host/lib/consult/bestof.mjs'
import { createBestofStore } from '../../packages/xuanshu-host/lib/consult/bestof-store.mjs'
import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { fakeAgentDefaultModel, fakeAgents, fakeSessionQuery, makeHost, makeSandbox, userEvent } from './lib/sandbox.mjs'
import { fakeLlm, STUB_USAGE } from './lib/bestof-llm.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

const QUESTION = '这次转岗该不该去'
/** 两份候选的正文：`LOSER` 是我们要求**在整份会话日志里逐字搜不到**的那一份。 */
const WINNER = '第一份正文：先看大方向。'
const LOSER = '第二份正文：先核对前提。'
const MERGED = '合并后的终稿：先核对前提，再放大方向。'

const JUDGE_PLAN = {
  tool: { name: 'submit_judgement', arguments: JSON.stringify({ judgement: { best: 'c1', ranking: ['c1', 'c2'] } }) },
}

/** 起一套宿主；`plans` 依次是 c1 / c2 / judge（+ 需要时合并那一次）。 */
async function scene({ plans = [{ text: WINNER }, { text: LOSER }, JUDGE_PLAN], services } = {}) {
  const sandbox = makeSandbox('bestof-history')
  roots.push(sandbox)
  const agents = fakeAgents()
  const llm = fakeLlm(plans)
  const host = makeHost({
    services: services ?? {
      agents: agents.service,
      agentPresets: { resolve: async () => ({ id: 'standard' }), mount: async () => ({}) },
      agentDefaultModel: fakeAgentDefaultModel().service,
      llm: llm.service,
    },
  })
  const consult = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
  const { session } = await consult['consult.create']({ pus: [] })
  const bestof = createBestOfMethods(host.ctx, { dataDir: sandbox.dataDir })
  return { sandbox, host, agents, llm, bestof, session }
}

async function runToEnd(bestof, sessionId) {
  const started = await bestof['bestof.run']({ sessionId, question: QUESTION })
  let state = started
  for (let index = 0; index < 300 && state.finished !== true; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
    state = await bestof['bestof.state']({ runId: started.runId })
  }
  return started
}

/**
 * 「会话日志」= 假 agent 收到的**每一条投递**（宿主能碰到日志的全部通道，含 `inject()`）。
 * 「落选候选的正文有没有漏进日志」这类断言用**这一份**：收窄通道会让判据变松。
 */
function allDeliveries(agents) {
  const rows = []
  for (const agent of agents.live.values()) {
    for (const call of agent.calls) rows.push({ sessionId: agent.id, via: call.kind, message: call.message })
  }
  return rows
}

const logText = (agents) => JSON.stringify(allDeliveries(agents))
const recordOf = (sandbox, sessionId) => sandbox.json('consult', `${sessionId}.bestof.json`)

describe('task-14 · 采用后：采用稿进历史，落选候选永不进日志', () => {
  it('F4：冷恢复中的改选与下一轮交错，下一轮仍只带新的采用稿', async () => {
    const agents = fakeAgents()
    const llm = fakeLlm([{ text: WINNER }, { text: LOSER }, JUDGE_PLAN, { text: '下一轮甲' }, { text: '下一轮乙' }, JUDGE_PLAN])
    let delayed = false
    let entered
    let release
    const waiting = new Promise((resolveEntered) => { entered = resolveEntered })
    const held = new Promise((resolveHeld) => { release = resolveHeld })
    const services = {
      agents: {
        ...agents.service,
        get: (id) => delayed ? undefined : agents.service.get(id),
        resume: async (options) => {
          entered()
          await held
          return { agent: agents.service.get(options.resumeSessionId) }
        },
      },
      agentPresets: { resolve: async () => ({ id: 'standard' }), mount: async () => ({}) },
      agentDefaultModel: fakeAgentDefaultModel().service,
      llm: llm.service,
      sessionQuery: { readSession: async (id) => ({
        session: { id, agentPreset: 'standard' },
        events: [...agents.live.values()].flatMap((agent) => agent.calls.filter((call) => call.kind === 'followup').map((call, index) => userEvent(index + 1, call.message))),
      }) },
    }
    const { bestof, session } = await scene({ services })
    const first = await runToEnd(bestof, session.sessionId)
    await bestof['bestof.adopt']({ runId: first.runId, decision: 'adopt', adoptedId: 'c1' })
    delayed = true
    const adopting = bestof['bestof.adopt']({ runId: first.runId, decision: 'adopt', adoptedId: 'c2' })
    try {
      await waiting
      const before = llm.calls.length
      const starting = bestof['bestof.run']({ sessionId: session.sessionId, question: '沿用刚采用的结论' })
      await new Promise((resolveTurn) => setImmediate(resolveTurn))
      release()
      expect((await adopting).delivery.ok).toBe(true)
      const second = await starting
      for (let index = 0; index < 600; index += 1) {
        if ((await bestof['bestof.state']({ runId: second.runId })).finished) break
        await new Promise((resolveTurn) => setTimeout(resolveTurn, 5))
      }
      const prompts = llm.calls.slice(before).filter((call) => call.system?.includes('本候选视角')).map((call) => JSON.stringify(call.messages))
      expect(prompts).toHaveLength(2)
      for (const prompt of prompts) {
        expect(prompt).toContain(LOSER)
        expect(prompt).not.toContain(WINNER)
      }
    } finally { release() }
  })

  it('采用 c1：日志多出**恰好一条**消息 —— 采用稿本身，带我们的 source kind', async () => {
    const { bestof, session, agents, sandbox } = await scene()
    const started = await runToEnd(bestof, session.sessionId)
    // 比的是**全部通道**（含 `inject()`）：多出一条别的投递也要红（收窄到 followup 会让判据变松）。
    const before = allDeliveries(agents)

    const { bestOf, delivery } = await bestof['bestof.adopt']({ runId: started.runId, decision: 'adopt', adoptedId: 'c1' })

    const after = allDeliveries(agents)
    // ③ adopt 前后日志的差异**只有那一处**。
    expect(after).toHaveLength(before.length + 1)
    expect(after.slice(0, before.length)).toEqual(before)

    const added = after[after.length - 1]
    expect(added.via).toBe('followup') // 人点才写：只有这一条通道
    expect(added.sessionId).toBe(session.sessionId)
    // ① 历史里出现该文本，且**带我们的 source kind**（不是伪造的用户原话）。
    expect(added.message.role).toBe('user')
    expect(added.message.source).toEqual({ kind: 'xuanshu-bestof-adopted' })
    expect(added.message.content).toHaveLength(1)
    expect(added.message.content[0].type).toBe('text')
    expect(added.message.content[0].text).toContain(WINNER)
    expect(Object.isFrozen(added.message)).toBe(true)
    expect(typeof added.message.id).toBe('string')

    // ② 落选候选的正文**在整个会话日志里逐字搜不到**。
    expect(logText(agents)).not.toContain(LOSER)
    expect(logText(agents)).not.toContain('第二份')

    // ④ 旁挂记录仍是候选的唯一权威：正文、ranking、judge、费用都在记录里，不在日志里。
    const record = recordOf(sandbox, session.sessionId)
    expect(record.adoptedId).toBe('c1')
    expect(record.candidates.map((candidate) => candidate.text)).toEqual([WINNER, LOSER])
    expect(record.judge.ranking).toEqual(['c1', 'c2'])
    expect(record.deliveries).toHaveLength(1)
    expect(logText(agents)).not.toContain('ranking')
    expect(logText(agents)).not.toContain('costUsd')
    expect(logText(agents)).not.toContain('"c1"')
    expect(logText(agents)).not.toContain('"c2"')

    // 回执如实：`delivery.ok=true` + 消息 id 与 source。
    expect(delivery.ok).toBe(true)
    expect(delivery.candidateId).toBe('c1')
    expect(delivery.source).toBe('xuanshu-bestof-adopted')
    expect(delivery.messageId).toBe(added.message.id)
    expect(bestOf.adoptedId).toBe('c1')
  })

  it('采用 c2：日志里是 c2 的正文，c1 的正文反而搜不到（同一口径对另一份也成立）', async () => {
    const { bestof, session, agents } = await scene()
    const started = await runToEnd(bestof, session.sessionId)
    await bestof['bestof.adopt']({ runId: started.runId, decision: 'adopt', adoptedId: 'c2' })

    expect(logText(agents)).toContain(LOSER)
    expect(logText(agents)).not.toContain(WINNER)
  })

  it('跑完不写、否决不写：只有「采用 / 合并」才动日志', async () => {
    const { bestof, session, agents } = await scene()
    // 判据是**差异**（全部通道，含 create 时那条上下文注入）：跑完 / 否决之后一条新投递都不许有。
    const before = allDeliveries(agents)
    const started = await runToEnd(bestof, session.sessionId)
    expect(allDeliveries(agents), '跑完这一轮不该往会话里写任何东西').toEqual(before)

    const { delivery } = await bestof['bestof.adopt']({ runId: started.runId, decision: 'reject' })
    expect(allDeliveries(agents), '否决不该往会话里写任何东西').toEqual(before)
    expect(delivery).toBeUndefined()
    expect(logText(agents)).not.toContain(WINNER)
    expect(logText(agents)).not.toContain(LOSER)
  })

  it('合并：写的是**合并后的那一份**（宿主总编这条路的产物）', async () => {
    const { bestof, session, agents } = await scene({ plans: [{ text: WINNER }, { text: LOSER }, JUDGE_PLAN, { text: MERGED, usage: STUB_USAGE }] })
    const started = await runToEnd(bestof, session.sessionId)

    const { delivery } = await bestof['bestof.adopt']({ runId: started.runId, decision: 'merge' })
    expect(delivery.ok).toBe(true)
    expect(delivery.candidateId).toBe('merged')
    expect(logText(agents)).toContain(MERGED)
    expect(logText(agents)).toContain('合并稿')
    // 两份原始候选仍然一个字都不在日志里。
    expect(logText(agents)).not.toContain(WINNER)
    expect(logText(agents)).not.toContain(LOSER)
  })

  it('改选（再点另一份）：日志多第二条，两条都是人点的，落选的仍在记录里', async () => {
    const { bestof, session, agents } = await scene()
    const started = await runToEnd(bestof, session.sessionId)
    const before = allDeliveries(agents)
    await bestof['bestof.adopt']({ runId: started.runId, decision: 'adopt', adoptedId: 'c1' })
    await bestof['bestof.adopt']({ runId: started.runId, decision: 'adopt', adoptedId: 'c2' })

    const rows = allDeliveries(agents).slice(before.length)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.via)).toEqual(['followup', 'followup'])
    expect(rows[0].message.content[0].text).toContain(WINNER)
    expect(rows[1].message.content[0].text).toContain(LOSER)
  })

  it('R4：新 run 继承迁移结果 —— 上一版记录（无账本）在覆盖前补上「旧轮」条目，第二个新 run 起旧采用稿仍算数', async () => {
    // 复核 32216d9 的 R4 反例：上一版 `xuanshu/bestof@1` 只有 deliveries / adoptedId / rejected。
    // `bestof.run` 覆盖写时若把账本当空数组，旧轮的采用关系就说不清了 —— 升级后的**第二个**新 run
    // 起，候选历史里会重新混进「改选前的旧稿」。这里断言两件事：
    //   ① 第一个新 run 的记录里已经带上迁移出的「旧轮」条目（不是空数组）；
    //   ② 那两个新 run 的候选 prompt 里，旧稿不在、当前采用稿在（secondHasObsolete=false）。
    const sandbox = makeSandbox('bestof-history-legacy')
    roots.push(sandbox)
    const query = fakeSessionQuery()
    const AGED = '第一版旧稿正文（已被改选掉）。'
    const CURRENT = '当前采用稿正文。'
    const agents = fakeAgents()
    const llm = fakeLlm([{ text: AGED }, { text: CURRENT }, JUDGE_PLAN])
    const host = makeHost({
      services: {
        agents: agents.service,
        agentPresets: { resolve: async () => ({ id: 'standard' }), mount: async () => ({}) },
        agentDefaultModel: fakeAgentDefaultModel().service,
        llm: llm.service,
        sessionQuery: query.service,
      },
    })
    const consult = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
    const { session } = await consult['consult.create']({ pus: [] })
    const bestof = createBestOfMethods(host.ctx, { dataDir: sandbox.dataDir })

    // 上一版记录：两稿都真的投过（一条被改选掉），`adoptedId` 指向后投的那一份。
    createBestofStore(sandbox.dataDir).write({
      schema: 'xuanshu/bestof@1',
      runId: 'bestof-previous-release-run',
      sessionId: session.sessionId,
      question: QUESTION,
      createdAt: '2026-10-15T00:00:00.000Z',
      candidates: [],
      judge: { mode: 'skipped', skipped: true, adoptedId: null, ranking: [] },
      adoptedId: 'c2',
      rejected: false,
      deliveries: [
        { candidateId: 'c1', messageId: 'm-aged', source: 'xuanshu-bestof-adopted', at: '2026-10-15T00:01:00.000Z' },
        { candidateId: 'c2', messageId: 'm-current', source: 'xuanshu-bestof-adopted', at: '2026-10-15T00:02:00.000Z' },
      ],
    })
    // 会话日志（追加式）：两条采用稿都留在里面 —— 改选不会删掉旧那条。
    const log = []
    query.events[session.sessionId] = log
    log.push(userEvent(log.length + 1, { id: 'm-question', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: QUESTION }] }))
    log.push(userEvent(log.length + 1, { id: 'm-aged', role: 'user', source: { kind: 'xuanshu-bestof-adopted' }, content: [{ type: 'text', text: AGED }] }))
    log.push(userEvent(log.length + 1, { id: 'm-current', role: 'user', source: { kind: 'xuanshu-bestof-adopted' }, content: [{ type: 'text', text: CURRENT }] }))

    /** 开一个真 run，返回那两路候选 prompt（判据：历史段里出现了什么正文）。 */
    const nextRunPrompts = async () => {
      const before = llm.calls.length
      await runToEnd(bestof, session.sessionId)
      return llm.calls
        .slice(before)
        .filter((call) => call.system?.includes('本候选视角'))
        .map((call) => call.messages[0].content.map((block) => block.text).join('\n'))
    }

    // 第一个新 run：**覆盖写之前**完成了迁移（记录里已经有哨兵条目）。
    const firstPrompts = await nextRunPrompts()
    const recordAfterFirst = recordOf(sandbox, session.sessionId)
    expect(recordAfterFirst.draftLedger).toEqual([
      { kind: 'adopted', messageId: 'm-current', candidateId: 'c2', runId: 'legacy', at: '2026-10-15T00:02:00.000Z' },
    ])
    for (const prompt of firstPrompts) {
      expect(prompt).toContain(CURRENT)
      expect(prompt, '改选前的旧稿不该进候选历史').not.toContain(AGED)
    }

    // 第二个新 run：旧轮的采用关系还在（迁移不断档），旧稿仍不混进来。
    const secondPrompts = await nextRunPrompts()
    expect(recordOf(sandbox, session.sessionId).draftLedger).toHaveLength(1)
    for (const prompt of secondPrompts) {
      expect(prompt).toContain(CURRENT)
      expect(prompt, '第二个新 run 起旧采用稿不该重新混入候选').not.toContain(AGED)
    }
  })

  it('SP-2：上一版「先采用、后否决」的旧记录，第二个新 run 起旧稿也不许重新混入', async () => {
    // 复核 32216d9 追加复核的反例：旧版 48e0e0a 的否决路径是 `adoptedId=null; rejected=true`，
    // 且**不清** `deliveries` —— 所以「本轮先采用 m-aged（已投进日志）再否决」是上一版可产生的合法记录。
    // 迁移若在这种形状上返回空账本，覆盖写之后消费方就退回「不过滤」，旧稿在第二个新 run 重新进候选历史。
    const sandbox = makeSandbox('bestof-history-legacy-rejected')
    roots.push(sandbox)
    const query = fakeSessionQuery()
    const OBSOLETE = '上一版先采用、随后被否决的那份稿子。'
    const agents = fakeAgents()
    const llm = fakeLlm([{ text: '这一轮的新候选一。' }, { text: '这一轮的新候选二。' }, JUDGE_PLAN, JUDGE_PLAN])
    const host = makeHost({
      services: {
        agents: agents.service,
        agentPresets: { resolve: async () => ({ id: 'standard' }), mount: async () => ({}) },
        agentDefaultModel: fakeAgentDefaultModel().service,
        llm: llm.service,
        sessionQuery: query.service,
      },
    })
    const consult = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
    const { session } = await consult['consult.create']({ pus: [] })
    const bestof = createBestOfMethods(host.ctx, { dataDir: sandbox.dataDir })

    createBestofStore(sandbox.dataDir).write({
      schema: 'xuanshu/bestof@1',
      runId: 'bestof-previous-release-rejected',
      sessionId: session.sessionId,
      question: QUESTION,
      createdAt: '2026-10-15T00:00:00.000Z',
      candidates: [],
      judge: { mode: 'skipped', skipped: true, adoptedId: null, ranking: [] },
      adoptedId: null,
      rejected: true,
      deliveries: [{ candidateId: 'c1', messageId: 'm-obsolete', source: 'xuanshu-bestof-adopted', at: '2026-10-15T00:01:00.000Z' }],
    })
    const log = []
    query.events[session.sessionId] = log
    log.push(userEvent(log.length + 1, { id: 'm-question', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: QUESTION }] }))
    log.push(userEvent(log.length + 1, { id: 'm-obsolete', role: 'user', source: { kind: 'xuanshu-bestof-adopted' }, content: [{ type: 'text', text: OBSOLETE }] }))

    const nextRunPrompts = async () => {
      const before = llm.calls.length
      await runToEnd(bestof, session.sessionId)
      return llm.calls
        .slice(before)
        .filter((call) => call.system?.includes('本候选视角'))
        .map((call) => call.messages[0].content.map((block) => block.text).join('\n'))
    }

    // 第一个新 run：覆盖写之前迁出「旧轮被否决」这条哨兵（账本非空 ⇒ 不会退回「不过滤」）。
    const firstPrompts = await nextRunPrompts()
    expect(recordOf(sandbox, session.sessionId).draftLedger).toEqual([
      { kind: 'rejected', runId: 'legacy', at: expect.any(String) },
    ])
    for (const prompt of firstPrompts) expect(prompt, '被否决轮次的稿子不该进候选历史').not.toContain(OBSOLETE)

    // 第二个新 run：旧稿仍不许重新混进来（这正是 R4 原反例的形态，只是换成 rejected 形状）。
    const secondPrompts = await nextRunPrompts()
    for (const prompt of secondPrompts) {
      expect(prompt, '第二个新 run 起被否决的旧稿不该重新混入候选').not.toContain(OBSOLETE)
    }
  })

  it('N4：候选历史只带**当前**采用稿 —— 改选后旧的那份不进历史；否决只抹掉**本轮**的采用稿', async () => {
    // 复核 48e0e0a 的 N4 实测：日志是追加式的（改选 / 否决都不会删掉旧消息），
    // 而 S9:174 要的是「只带 adoptedId 指向的那一份」。判据是旁挂决策（按轮记的账本），
    // 不是消息的来源标签；**否决按轮生效** —— 否决这一轮不该把上一轮已采用的那份一起抹掉。
    const sandbox = makeSandbox('bestof-history-n4')
    roots.push(sandbox)
    const query = fakeSessionQuery()
    const agents = fakeAgents()
    /** 6 轮候选的剧本：R1 用固定 sentinel（改选场景要认得出哪一份进/不进历史），R2–R6 各自可辨。 */
    const tags = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']
    const firstOf = (tag) => `${tag} 第一份。`
    const llm = fakeLlm(tags.flatMap((tag, index) => [
      { text: index === 0 ? WINNER : firstOf(tag) },
      { text: index === 0 ? LOSER : `${tag} 第二份。` },
      JUDGE_PLAN,
    ]))
    const host = makeHost({
      services: {
        agents: agents.service,
        agentPresets: { resolve: async () => ({ id: 'standard' }), mount: async () => ({}) },
        agentDefaultModel: fakeAgentDefaultModel().service,
        llm: llm.service,
        sessionQuery: query.service,
      },
    })
    const consult = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
    const { session } = await consult['consult.create']({ pus: [] })
    const bestof = createBestOfMethods(host.ctx, { dataDir: sandbox.dataDir })

    // 「会话日志」：按真实 loop 的方式追加（这里只手工做 append 这一步；消息本身是业务 API 产出的）。
    const log = []
    query.events[session.sessionId] = log
    log.push(userEvent(log.length + 1, { id: 'm-question', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: QUESTION }] }))
    const appendDelivered = () => log.push(userEvent(log.length + 1, allDeliveries(agents).at(-1).message))
    /** 下一个 run 的候选提示（两路）。 */
    const nextRunPrompts = async () => {
      const before = llm.calls.length
      await runToEnd(bestof, session.sessionId)
      return llm.calls.slice(before).filter((call) => call.system?.includes('本候选视角')).map((call) => call.messages[0].content.map((block) => block.text).join('\n'))
    }

    // ① 第一轮：跑完 → 采用 c1 → **改选** c2（两条都真的投递进会话，日志里于是有两份）。
    const run1 = await runToEnd(bestof, session.sessionId)
    await bestof['bestof.adopt']({ runId: run1.runId, decision: 'adopt', adoptedId: 'c1' })
    appendDelivered()
    await bestof['bestof.adopt']({ runId: run1.runId, decision: 'adopt', adoptedId: 'c2' })
    appendDelivered()
    expect(log.filter((event) => event.data?.source?.kind === 'xuanshu-bestof-adopted')).toHaveLength(2)

    // ② 第二轮候选：历史里**只该有 c2 那一份**（c1 已被改选掉）。
    for (const prompt of await nextRunPrompts()) {
      expect(prompt).toContain('【这场问事的历史】')
      expect(prompt).toContain('已采用的合参稿：')
      expect(prompt).toContain(LOSER)
      expect(prompt, '被改选掉的旧采用稿不该进候选历史').not.toContain(WINNER)
    }

    // ③ 否决第三轮（本轮没投递过任何采用稿）→ 上一轮采用的 c2 **仍然算数**（否决按轮生效）。
    const thirdRun = await runToEnd(bestof, session.sessionId)
    await bestof['bestof.adopt']({ runId: thirdRun.runId, decision: 'reject' })
    for (const prompt of await nextRunPrompts()) {
      expect(prompt, '否决这一轮不该抹掉上一轮已采用的稿').toContain(LOSER)
      expect(prompt).not.toContain(WINNER)
    }

    // ④ 第五轮：采用它的一份 → 再**否决同一轮** → 下一轮候选历史里这一份也不该再出现。
    const fifthRun = await runToEnd(bestof, session.sessionId)
    await bestof['bestof.adopt']({ runId: fifthRun.runId, decision: 'adopt', adoptedId: 'c1' })
    appendDelivered()
    const adoptedInFifth = log.at(-1).data.content.map((block) => block.text).join('\n')
    expect(adoptedInFifth).toContain(firstOf('R5'))
    // 采纳之后、再启动下一轮之前否决（同一轮）：账本记两条（adopted + rejected，runId 相同）
    await bestof['bestof.adopt']({ runId: fifthRun.runId, decision: 'reject' })
    for (const prompt of await nextRunPrompts()) {
      expect(prompt, '本轮被否决 ⇒ 本轮采用过的那份不再进历史').not.toContain(firstOf('R5'))
      expect(prompt, '上一轮（未被否决）的采用稿照旧在').toContain(LOSER)
    }
  })

  it('会话不在本进程活着 → 走 agents.resume 再投递（进程重启后也能补上）', async () => {
    const { bestof, session, agents } = await scene()
    const started = await runToEnd(bestof, session.sessionId)
    // 模拟「进程重启过」：进程里没有这个 agent 了。
    agents.live.clear()

    const { delivery } = await bestof['bestof.adopt']({ runId: started.runId, decision: 'adopt', adoptedId: 'c1' })
    expect(agents.resumed.map((options) => options.resumeSessionId)).toEqual([session.sessionId])
    expect(delivery.ok).toBe(true)
    expect(logText(agents)).toContain(WINNER)
  })

  it('投递不了（采纳时 agents 服务没了）→ 决定照常落盘，但回执如实说没写进会话', async () => {
    const agents = fakeAgents()
    // 可变的 services：会话建得出来，采纳时把 agents 摘掉（模拟「这一侧的服务掉线」）。
    const services = {
      agents: agents.service,
      agentPresets: { resolve: async () => ({ id: 'standard' }), mount: async () => ({}) },
      agentDefaultModel: fakeAgentDefaultModel().service,
      llm: fakeLlm([{ text: WINNER }, { text: LOSER }, JUDGE_PLAN]).service,
    }
    const { bestof, session, sandbox } = await scene({ services })
    const started = await runToEnd(bestof, session.sessionId)
    const before = allDeliveries(agents)
    delete services.agents

    const { bestOf, delivery } = await bestof['bestof.adopt']({ runId: started.runId, decision: 'adopt', adoptedId: 'c1' })
    expect(bestOf.adoptedId).toBe('c1') // 人点过就是点过了
    expect(delivery.ok).toBe(false)
    expect(delivery.error).toMatch(/ctx\.agents/u)
    expect(allDeliveries(agents), '全部通道，一条都没写进去').toEqual(before)
    const record = recordOf(sandbox, session.sessionId)
    expect(record.deliveryError).toMatch(/ctx\.agents/u)
    expect(record.deliveries).toBeUndefined()
    // 记录里没有 `deliveredAt`：界面据此不会说「已写进历史」（`state` 冷读也说同一句话）。
    expect(record.deliveredAt).toBeUndefined()
    const polled = await bestof['bestof.state']({ runId: started.runId })
    expect(polled.delivery).toEqual({ ok: false, error: record.deliveryError, candidateId: 'c1', attemptedAt: record.deliveryAttemptedAt })
    expect(polled.deliveredAt).toBeUndefined()
  })

  it('投递失败后再点一次：成功那次把 deliveryError 清掉，日志里仍然只有采用稿', async () => {
    const agents = fakeAgents()
    const llm = fakeLlm([{ text: WINNER }, { text: LOSER }, JUDGE_PLAN])
    let broken = true
    const sandbox = makeSandbox('bestof-history-retry')
    roots.push(sandbox)
    const host = makeHost({
      services: {
        // 可开关的 agent 服务：开关打开时既取不到活会话、也 resume 不回来（模拟「会话打不开」）。
        agents: {
          create: (options) => agents.service.create(options),
          get: (id) => (broken ? undefined : agents.service.get(id)),
          resume: async (options) => {
            if (broken) throw new Error('接不回这个会话（模拟：日志被删/宿主换了）')
            return agents.service.resume(options)
          },
        },
        agentPresets: { resolve: async () => ({ id: 'standard' }), mount: async () => ({}) },
        agentDefaultModel: fakeAgentDefaultModel().service,
        llm: llm.service,
      },
    })
    const consult = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
    const { session } = await consult['consult.create']({ pus: [] })
    const bestof = createBestOfMethods(host.ctx, { dataDir: sandbox.dataDir })
    const started = await runToEnd(bestof, session.sessionId)
    const before = allDeliveries(agents)

    const failed = await bestof['bestof.adopt']({ runId: started.runId, decision: 'adopt', adoptedId: 'c1' })
    expect(failed.delivery.ok).toBe(false)
    expect(failed.bestOf.adoptedId).toBe('c1')
    expect(recordOf(sandbox, session.sessionId).deliveryError).toBeDefined()
    expect(allDeliveries(agents), '投递失败那次一条都没写进去').toEqual(before)

    broken = false
    const retried = await bestof['bestof.adopt']({ runId: started.runId, decision: 'adopt', adoptedId: 'c1' })
    expect(retried.delivery.ok).toBe(true)
    const record = recordOf(sandbox, session.sessionId)
    expect(record.deliveryError).toBeUndefined()
    expect(record.deliveries).toHaveLength(1)
    const rows = allDeliveries(agents).slice(before.length)
    expect(rows).toHaveLength(1)
    expect(rows[0].message.content[0].text).toContain(WINNER)
    expect(logText(agents)).not.toContain(LOSER)
  })
})

describe('task-14 · 采用稿的形状稳定（不受消息工厂两条路影响）', () => {
  it('无 profile 时走本地兜底工厂，形状与官方一致：role/source/content/id', async () => {
    const { bestof, session, agents } = await scene()
    const started = await runToEnd(bestof, session.sessionId)
    await bestof['bestof.adopt']({ runId: started.runId, decision: 'adopt', adoptedId: 'c1' })

    // 取全部投递的**最后一条**：adopt 是这条会话最后发生的事（多一条别的投递也会被这一步照出来）。
    const row = allDeliveries(agents).at(-1)
    expect(row.via).toBe('followup')
    expect(Object.keys(row.message).sort()).toEqual(['content', 'id', 'role', 'source'])
    expect(row.message.content[0].text.startsWith('【已采用的多 AI 合参稿】')).toBe(true)
  })
})
