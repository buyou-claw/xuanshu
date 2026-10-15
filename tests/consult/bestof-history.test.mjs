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
import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { fakeAgentDefaultModel, fakeAgents, makeHost, makeSandbox } from './lib/sandbox.mjs'
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
