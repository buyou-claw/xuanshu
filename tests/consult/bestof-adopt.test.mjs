/**
 * 票 11 · 拍板（adopt / merge / reject）、轮询与冷读、费用累计、能力门（契约 §1）。
 *
 * 抓的真实缺陷/风险：
 *   ① **AI 替人拍板**：跑完就把 `adoptedId` 设成判官第一 —— C9 明令「判官不自动采用」，
 *      所以「跑完」这一步的 `record.adoptedId` 必须是 null；
 *   ② **费用凭空出现**：没有价表时 `costUsd` 只能是 undefined（界面显示「费用未知」），
 *      **不许写 0**，更不许把打桩 usage 当实测金额；有价表时逐项算对；
 *   ③ **`bestof.state` 只认内存**：刷新页面/进程重启后按 runId 读不回来 → 回看就没数据了；
 *   ④ **合并没有下限**：不足两份也让它合 —— 界面要的是「可合并的候选不足两份」；
 *   ⑤ **能力门缺失**：没有 `ctx.llm` / 没有 provider·model 时回一个假的「开始合参」。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { bestofCapability, createBestOfMethods } from '../../packages/xuanshu-host/lib/consult/bestof.mjs'
import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { fakeAgentDefaultModel, fakeAgents, makeHost, makeSandbox } from './lib/sandbox.mjs'
import { fakeLlm, STUB_USAGE } from './lib/bestof-llm.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

const QUESTION = '这次转岗的时机怎么样？'
const JUDGE_PLAN = {
  tool: { name: 'submit_judgement', arguments: JSON.stringify({ judgement: { best: 'c1', ranking: ['c1', 'c2'], reasons: { c1: '依据足' } } }) },
  usage: { inputTokens: 500, outputTokens: 100, totalTokens: 600 },
}
const CANDIDATES = [
  { text: '第一份正文。', usage: STUB_USAGE },
  { text: '第二份正文。', usage: { inputTokens: 800, outputTokens: 400, totalTokens: 1200 } },
]

/** 起一套宿主；`services` 可覆盖（验能力门时把 llm / agentDefaultModel 拿掉）。 */
async function scene({ price, extra, plans = [...CANDIDATES, JUDGE_PLAN], services } = {}) {
  const sandbox = makeSandbox('bestof-adopt')
  roots.push(sandbox)
  const agents = fakeAgents()
  const llm = fakeLlm(plans)
  const merged = {
    agents: agents.service,
    agentPresets: { resolve: async () => ({ id: 'standard' }), mount: async () => ({}) },
    agentDefaultModel: fakeAgentDefaultModel().service,
    llm: llm.service,
    ...extra,
  }
  const host = makeHost({ services: services ?? merged })
  const consult = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
  const { session } = await consult['consult.create']({ pus: [] })
  const bestof = createBestOfMethods(host.ctx, { dataDir: sandbox.dataDir, prices: price })
  return { sandbox, host, llm, bestof, session }
}

async function runToEnd(bestof, sessionId, payload = {}) {
  const started = await bestof['bestof.run']({ sessionId, question: QUESTION, ...payload })
  let state = started
  for (let index = 0; index < 300 && state.finished !== true; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
    state = await bestof['bestof.state']({ runId: started.runId })
  }
  return { started, state }
}

describe('bestof.state · 轮询与冷读（契约 §1「供界面轮询/回看」）', () => {
  it('F3：第二轮受理后、首块返回前，新实例也能按 runId 冷读', async () => {
    const { bestof, session, sandbox, host, llm } = await scene({ plans: [...CANDIDATES, JUDGE_PLAN, ...CANDIDATES, JUDGE_PLAN] })
    await runToEnd(bestof, session.sessionId)
    let release
    const held = new Promise((resolveHeld) => { release = resolveHeld })
    const stream = llm.service.stream
    llm.service.stream = (options) => (async function* () { await held; yield* stream(options) })()
    try {
      const second = await bestof['bestof.run']({ sessionId: session.sessionId, question: '第二个问题' })
      const cold = createBestOfMethods(host.ctx, { dataDir: sandbox.dataDir })
      const recovered = await cold['bestof.state']({ runId: second.runId })
      expect(recovered.runId).toBe(second.runId)
      expect(recovered.candidates.every((candidate) => candidate.status === 'running')).toBe(true)
    } finally {
      release()
      await new Promise((resolveDone) => setTimeout(resolveDone, 20))
    }
  })

  it('进程重启后按 runId 仍读得回来（读旁挂文件，不靠内存）', async () => {
    const { bestof, session, sandbox, host } = await scene()
    const { started, state } = await runToEnd(bestof, session.sessionId)
    expect(state.finished).toBe(true)

    // 新实例 = 新进程：内存里没有这条记录，只能从 <dataDir>/consult/<sessionId>.bestof.json 冷读。
    const reborn = createBestOfMethods(host.ctx, { dataDir: sandbox.dataDir })
    const cold = await reborn['bestof.state']({ runId: started.runId })
    expect(cold.runId).toBe(started.runId)
    expect(cold.candidates.map((candidate) => candidate.text)).toEqual(['第一份正文。', '第二份正文。'])
    expect(cold.judge.ranking).toEqual(['c1', 'c2'])
  })

  it('未知 runId → 可读错误', async () => {
    const { bestof } = await scene()
    await expect(bestof['bestof.state']({ runId: 'bestof-不存在' })).rejects.toThrow(/合参记录不存在/u)
  })

  it('run 返回的是**受理态**：能立刻轮询到 candidates（先 running，再 done）', async () => {
    const { bestof, session } = await scene({ plans: [{ text: '慢一份', delay: 40 }, { text: '快一份' }, JUDGE_PLAN] })
    const started = await bestof['bestof.run']({ sessionId: session.sessionId, question: QUESTION })
    expect(started.finished).toBe(false)
    expect(started.candidates.map((candidate) => candidate.id)).toEqual(['c1', 'c2'])
    expect(started.candidates.map((candidate) => candidate.status)).toContain('running')
    const after = await bestof['bestof.state']({ runId: started.runId })
    expect(after.runId).toBe(started.runId)
  })
})

describe('bestof.adopt · 三个动作都要人点（C9）', () => {
  it('对**被取代的旧轮**迟到拍板：拒绝，且不许把旧记录写回去盖掉新一轮（复核 N4）', async () => {
    // 一层会话只留最后一份记录（覆盖写），但 `live` 里仍留着旧轮 —— 对旧 runId 的 adopt 会把旧记录
    // persist 回去，连新一轮的账本一起盖掉。这里钉住「拒绝 + 新记录原封不动」。
    const { bestof, sandbox, session } = await scene({ plans: [...CANDIDATES, JUDGE_PLAN, ...CANDIDATES, JUDGE_PLAN] })
    const first = await runToEnd(bestof, session.sessionId)
    const second = await runToEnd(bestof, session.sessionId)
    const secondRecord = sandbox.json('consult', `${session.sessionId}.bestof.json`)
    expect(secondRecord.runId).toBe(second.started.runId)

    await expect(bestof['bestof.adopt']({ runId: first.started.runId, decision: 'adopt', adoptedId: 'c1' })).rejects.toThrow(/已经被更新的一轮取代/u)
    // 新一轮的记录一个字节都没动（runId 仍是它、没有被旧记录盖掉）
    expect(sandbox.json('consult', `${session.sessionId}.bestof.json`).runId).toBe(second.started.runId)
  })
  it('采用某一份：adoptedId 落盘，rejected 复位', async () => {
    const { bestof, session, sandbox } = await scene()
    const { started } = await runToEnd(bestof, session.sessionId)

    // 跑完不等于采用（C9）：记录里 adoptedId 仍是 null。
    expect(sandbox.json('consult', `${session.sessionId}.bestof.json`).adoptedId).toBeNull()

    const { bestOf } = await bestof['bestof.adopt']({ runId: started.runId, decision: 'adopt', adoptedId: 'c2' })
    expect(bestOf.adoptedId).toBe('c2')
    expect(bestOf.rejected).toBe(false)
    expect(sandbox.json('consult', `${session.sessionId}.bestof.json`).adoptedId).toBe('c2')
  })

  it('否决：adoptedId 置空 + rejected=true（玄枢自有语义，S9 §2.5 / 定案 D4）', async () => {
    const { bestof, session, sandbox } = await scene()
    const { started } = await runToEnd(bestof, session.sessionId)
    await bestof['bestof.adopt']({ runId: started.runId, decision: 'adopt', adoptedId: 'c1' })

    const { bestOf } = await bestof['bestof.adopt']({ runId: started.runId, decision: 'reject' })
    expect(bestOf.adoptedId).toBeNull()
    expect(bestOf.rejected).toBe(true)
    // 候选正文**没有**因为否决而丢（数据仍在，只是不进历史）。
    expect(bestOf.candidates.map((candidate) => candidate.text)).toEqual(['第一份正文。', '第二份正文。'])
    const record = sandbox.json('consult', `${session.sessionId}.bestof.json`)
    expect(record.adoptedId).toBeNull()
    expect(record.rejected).toBe(true)
  })

  it('采用一份不存在的候选 / 未知动作 / 还在生成中：都拒绝', async () => {
    const { bestof, session } = await scene({ plans: [{ text: '慢', delay: 40 }, { text: '也慢', delay: 40 }, JUDGE_PLAN] })
    const started = await bestof['bestof.run']({ sessionId: session.sessionId, question: QUESTION })

    await expect(bestof['bestof.adopt']({ runId: started.runId, decision: 'adopt', adoptedId: 'c1' })).rejects.toThrow(/还在生成中/u)
    const { started: finished } = await runToEnd(bestof, session.sessionId)
    await expect(bestof['bestof.adopt']({ runId: finished.runId, decision: 'adopt', adoptedId: 'c9' })).rejects.toThrow(/没有这份可用候选/u)
    await expect(bestof['bestof.adopt']({ runId: finished.runId, decision: 'approve' })).rejects.toThrow(/未知的拍板动作/u)
  })
})

describe('被取代的旧轮 · 迟到操作不许静默成功（复核 32216d9 追加复核的 SP-1）', () => {
  it('旧轮的 adopt / cancel 都拒绝，且盘面仍是新一轮（旧记录不许写回去）', async () => {
    const { bestof, session, sandbox } = await scene({ plans: [...CANDIDATES, JUDGE_PLAN, ...CANDIDATES, JUDGE_PLAN] })
    const diskOf = () => sandbox.json('consult', `${session.sessionId}.bestof.json`)

    // 先在第一轮上正常拍板（守卫不许把正常路径一起挡掉）。
    const first = await runToEnd(bestof, session.sessionId)
    const adoptedOnFirst = await bestof['bestof.adopt']({ runId: first.started.runId, decision: 'adopt', adoptedId: 'c1' })
    expect(adoptedOnFirst.bestOf.adoptedId).toBe('c1')
    expect(diskOf().draftLedger).toHaveLength(1)

    // 起第二轮 ⇒ 第一轮成为「被取代的旧轮」。
    const second = await runToEnd(bestof, session.sessionId)
    const entriesBeforeStaleCalls = diskOf().draftLedger

    // 旧轮的两条写路径都必须给可读错误：报「成功」而盘上没变（或写回旧记录）都是撒谎。
    await expect(bestof['bestof.adopt']({ runId: first.started.runId, decision: 'adopt', adoptedId: 'c2' }))
      .rejects.toThrow(/已经被更新的一轮取代/u)
    await expect(bestof['bestof.cancel']({ runId: first.started.runId }))
      .rejects.toThrow(/已经被更新的一轮取代/u)

    // 盘面还是新一轮：runId 没被写回旧轮、账本没被旧轮的拍板污染。
    const onDisk = diskOf()
    expect(onDisk.runId).toBe(second.started.runId)
    expect(onDisk.adoptedId).toBeNull()
    expect(onDisk.draftLedger).toEqual(entriesBeforeStaleCalls)

    // 新一轮自己的拍板照常落盘。
    const { bestOf } = await bestof['bestof.adopt']({ runId: second.started.runId, decision: 'adopt', adoptedId: 'c1' })
    expect(bestOf.adoptedId).toBe('c1')
    expect(diskOf().runId).toBe(second.started.runId)
    expect(diskOf().adoptedId).toBe('c1')
  })
})

describe('bestof.adopt · 合并（S9 §5 步骤 8 的总编语义）', () => {
  it('不给 mergedText → 宿主发一次合并调用（不带工具、含两份候选），记 mergedBy=host', async () => {
    const { bestof, session, llm } = await scene({
      plans: [...CANDIDATES, JUDGE_PLAN, { text: '合并后的终稿。', usage: { inputTokens: 2000, outputTokens: 900 } }],
    })
    const { started } = await runToEnd(bestof, session.sessionId)
    const { bestOf } = await bestof['bestof.adopt']({ runId: started.runId, decision: 'merge' })

    const mergeCall = llm.calls.at(-1)
    expect(mergeCall.tools ?? []).toEqual([])
    const prompt = JSON.stringify(mergeCall.messages)
    expect(prompt).toContain('第一份正文。')
    expect(prompt).toContain('第二份正文。')
    expect(mergeCall.system).toMatch(/终稿总编/u)

    expect(bestOf.adoptedId).toBe('merged')
    expect(bestOf.mergedBy.by).toBe('host')
    const merged = bestOf.candidates.find((candidate) => candidate.id === 'merged')
    expect(merged.text).toBe('合并后的终稿。')
    expect(merged.status).toBe('done')
  })

  it('给了 mergedText → 不再调模型，mergedBy=caller', async () => {
    const { bestof, session, llm } = await scene()
    const { started } = await runToEnd(bestof, session.sessionId)
    const callsBefore = llm.calls.length

    const { bestOf } = await bestof['bestof.adopt']({ runId: started.runId, decision: 'merge', mergedText: '人手合并稿。' })
    expect(llm.calls).toHaveLength(callsBefore)
    expect(bestOf.candidates.find((candidate) => candidate.id === 'merged').text).toBe('人手合并稿。')
    expect(bestOf.mergedBy.by).toBe('caller')
  })

  it('可合并的候选不足两份：拒绝（界面文案的机器判据）', async () => {
    const { bestof, session } = await scene({
      plans: [{ text: '唯一一份。' }, { text: '', finish: { kind: 'error', failure: { code: 'NO_ADAPTER' } } }],
    })
    const { started } = await runToEnd(bestof, session.sessionId)
    await expect(bestof['bestof.adopt']({ runId: started.runId, decision: 'merge' })).rejects.toThrow(/不足两份/u)
  })

  it('合并稿为空 → 可读失败（不许静默采用一份空的）', async () => {
    const { bestof, session } = await scene({ plans: [...CANDIDATES, JUDGE_PLAN, { text: '' }] })
    const { started } = await runToEnd(bestof, session.sessionId)
    await expect(bestof['bestof.adopt']({ runId: started.runId, decision: 'merge' })).rejects.toThrow(/合并稿为空/u)
  })
})

describe('bestof.cancel · 停止全部（S9 §5 步骤 10；契约 §1 的 additive 方法）', () => {
  it('停下来：未完成的标 stopped、已产出的文字保留、不跑判官、不自动采用', async () => {
    const { bestof, session, llm, sandbox } = await scene({
      // c1：正文已经吐完、这一路还挂着（模拟人看着流式按停止）；c2：还没开始吐。
      plans: [{ text: '先产出的一段话。', hold: 300, pieces: 1 }, { text: '更慢的一份', delay: 400 }, JUDGE_PLAN],
    })
    const started = await bestof['bestof.run']({ sessionId: session.sessionId, question: QUESTION })
    const callsAtRun = llm.calls.length

    // 等第一路真的吐了点东西再停（此时它还在跑：hold 300ms）。
    await new Promise((resolve) => setTimeout(resolve, 60))
    const { bestOf } = await bestof['bestof.cancel']({ runId: started.runId })

    expect(bestOf.finished).toBe(true)
    expect(bestOf.candidates.map((candidate) => candidate.status)).toEqual(['stopped', 'stopped'])
    expect(bestOf.candidates[0].text).toBe('先产出的一段话。') // 看到的东西不许被抹掉
    expect(bestOf.judge.mode).toBe('skipped')
    expect(bestOf.judge.error).toMatch(/已停止/u)
    expect(bestOf.adoptedId).toBeNull()
    expect(llm.calls.length).toBe(callsAtRun) // 停下之后不再发起任何新调用（尤其不发起判官）
    expect(sandbox.json('consult', `${session.sessionId}.bestof.json`).judge.mode).toBe('skipped')

    // 停下来的那一轮照样能拍板（已产出的那份可用）。
    const adopted = await bestof['bestof.adopt']({ runId: started.runId, decision: 'adopt', adoptedId: 'c1' })
    expect(adopted.bestOf.adoptedId).toBe('c1')
  })

  it('已经结束的 run 再 cancel：幂等，不改采用态', async () => {
    const { bestof, session } = await scene()
    const { started } = await runToEnd(bestof, session.sessionId)
    await bestof['bestof.adopt']({ runId: started.runId, decision: 'adopt', adoptedId: 'c2' })

    const { bestOf } = await bestof['bestof.cancel']({ runId: started.runId })
    expect(bestOf.adoptedId).toBe('c2')
    expect(bestOf.candidates.map((candidate) => candidate.status)).toEqual(['done', 'done'])
    expect(bestOf.judge.ranking).toEqual(['c1', 'c2'])
  })

  it('cancel 之后 state 稳定（轮询不会看到又变回 running）', async () => {
    const { bestof, session } = await scene({ plans: [{ text: '慢', delay: 200 }, { text: '也慢', delay: 200 }, JUDGE_PLAN] })
    const started = await bestof['bestof.run']({ sessionId: session.sessionId, question: QUESTION })
    await bestof['bestof.cancel']({ runId: started.runId })
    await new Promise((resolve) => setTimeout(resolve, 30))
    const state = await bestof['bestof.state']({ runId: started.runId })
    expect(state.finished).toBe(true)
    expect(state.candidates.every((candidate) => candidate.status === 'stopped')).toBe(true)
  })
})

describe('费用：有价表才算，没价表就是「未知」（ADR-0010 Consequences）', () => {
  it('有价表：按 input/output 单价逐项累计（打桩 usage × 样例价表）', async () => {
    const price = { 'deepseek/deepseek-chat': { inputPerMTok: 1, outputPerMTok: 2 } }
    const { bestof, session } = await scene({ price })
    const { state } = await runToEnd(bestof, session.sessionId)

    // c1(1000,500)=0.002 + c2(800,400)=0.0016 + judge(500,100)=0.0007 = 0.0043
    expect(state.costUsd).toBeCloseTo(0.0043, 10)
    expect(state.costUsdComplete).toBe(true)
    expect(state.candidates[0].costUsd).toBeCloseTo(0.002, 10)
    expect(state.usage).toEqual({ inputTokens: 2300, outputTokens: 1000, totalTokens: 3300 })
  })

  it('没有价表：costUsd **整个键都不在**（界面据此显示「费用未知」），绝不写 0', async () => {
    const { bestof, session } = await scene()
    const { state } = await runToEnd(bestof, session.sessionId)
    expect(state.costUsd).toBeUndefined()
    expect(state.candidates.every((candidate) => candidate.costUsd === undefined)).toBe(true)
    // usage 是真实拿到的东西（这里是打桩值），照样记着。
    expect(state.usage.inputTokens).toBe(2300)
  })
})

describe('bestof.run · 路由、参数与能力门', () => {
  it('profileIds 指定两路 provider（各取该路由第一个模型）', async () => {
    const { bestof, session, llm } = await scene()
    await runToEnd(bestof, session.sessionId, { profileIds: ['deepseek', 'pi-ai'] })
    const candidateCalls = llm.calls.filter((call) => call.system?.includes('本候选视角'))
    expect(candidateCalls.map((call) => call.provider)).toEqual(['deepseek', 'pi-ai'])
    expect(candidateCalls.every((call) => typeof call.model === 'string' && call.model !== '')).toBe(true)
  })

  it('未知视角 / 重复视角 / 只有一个视角：当场拒绝', async () => {
    const { bestof, session } = await scene()
    for (const [angles, pattern] of [
      [['classic', 'classic'], /视角重复/u],
      [['现代派'], /未知视角/u],
      [['classic'], /至少要两路/u],
    ]) {
      await expect(bestof['bestof.run']({ sessionId: session.sessionId, question: QUESTION, angles })).rejects.toThrow(pattern)
    }
  })

  it('能力门：缺 llm / 缺默认模型 / 会话不存在 → 可读失败（不许回一个假的「开始合参」）', async () => {
    const noLlm = await scene({ services: { agents: fakeAgents().service, agentDefaultModel: fakeAgentDefaultModel().service } })
    await expect(noLlm.bestof['bestof.run']({ sessionId: noLlm.session.sessionId, question: QUESTION })).rejects.toThrow(/缺少 llm/u)

    const noModel = await scene({ services: { agents: fakeAgents().service, llm: fakeLlm().service } })
    await expect(noModel.bestof['bestof.run']({ sessionId: noModel.session.sessionId, question: QUESTION })).rejects.toThrow(/agentDefaultModel/u)

    const { bestof } = await scene()
    await expect(bestof['bestof.run']({ sessionId: 'session-xs-consult-0000-0000-0000-000000000000', question: QUESTION })).rejects.toThrow(/问事记录不存在/u)
    await expect(bestof['bestof.run']({ sessionId: 'session-1b2c', question: QUESTION })).rejects.toThrow(/不是问事会话/u)
    await expect(bestof['bestof.run']({ sessionId: 'session-xs-consult-x', question: '   ' })).rejects.toThrow(/问题不能为空/u)
  })

  it('能力门的形状：ok / missing / detail 指向修复路径', () => {
    const ok = makeHost({ services: { llm: fakeLlm().service, agentDefaultModel: fakeAgentDefaultModel().service } })
    expect(bestofCapability(ok.ctx)).toEqual({ ok: true, missing: [], detail: '' })
    const broken = bestofCapability(makeHost().ctx)
    expect(broken.ok).toBe(false)
    expect(broken.missing).toEqual(['llm', 'agentDefaultModel'])
    expect(broken.detail).toMatch(/dump-config/u)
  })
})
