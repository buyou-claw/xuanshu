/**
 * 票 15 · 装配接线（契约 §3：三个方法进**同一条** `/xuanshu` 通道 + 内置 skill `xuanshu:sediment`）。
 *
 * 这条用例走**真** `installRpc`（`lib/rpc.mjs`）与**真** `apply()`（`lib/index.js` 的总装配），
 * 只有宿主 ctx 是替身 —— 要验的正是「接线有没有接上」：方法名逐字可调、与既有组的合并
 * （不是互相覆盖）、skill 真的注册进 `ctx.skills`、以及数据目录同源。
 *
 * 抓的真实缺陷/风险：
 *   ① **方法名写错一个字母**：客户端按 `sediment.draft` 调、宿主注册 `sediment.drafts`，
 *      症状是界面上「导出汇总」永远失败而没有任何线索。这里逐名打一遍通道。
 *   ② **`...createSedimentMethods()` 合并时被后面的展开覆盖**（或漏了展开）：
 *      只有「既有方法都还在」这一条断言能挡住。
 *   ③ **skill 没注册**：模型永远发现不了这条能力（人点按钮那条路仍然通，
 *      所以这个缺口不会以报错的形式暴露）。
 *   ④ **数据目录各写一处**：草稿落 A、谱落 B 是最难查的错位。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { apply } from '../../packages/xuanshu-host/lib/index.js'
import { SEDIMENT_SKILL_NAME } from '../../packages/xuanshu-host/lib/sediment/skill.mjs'
import {
  assistantEvent,
  draftAnswer,
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

/** 跑一次总装配，返回通道上的一条路由（宿主 ctx 是替身）。 */
function assemble() {
  const sandbox = makeSandbox('wiring')
  roots.push(sandbox)
  const pu = seedPu(sandbox, { name: '事业与行业', description: '事业与行业的总览。' })
  const consult = seedConsult(sandbox, { pus: [pu.slug], turns: 1 })
  const agents = fakeAgents()
  const query = fakeSessionQuery({ [consult.sessionId]: [userEvent(1, { text: '今年事业怎么走？' })] })
  const presets = fakeAgentPresets()
  const host = makeHost({
    wired: true,
    services: {
      agents: agents.service,
      sessionQuery: query.service,
      agentPresets: presets.service,
      agentDefaultModel: fakeAgentDefaultModel().service,
    },
  })
  // autoStart:false：本用例不验 horosa serve 生命周期，只验接线。
  apply(host.ctx, { dataDir: sandbox.dataDir, autoStart: false })
  expect(host.routes, '总装配没有注册 /xuanshu 通道').toHaveLength(1)
  return { sandbox, host, agents, query, pu, consult, route: host.routes[0] }
}

/** 通过 `/xuanshu` 通道调一个方法（rpc.mjs 的返回信封：`{ok, value}` / `{ok:false, error}`）。 */
function call(route, method, payload = {}) {
  return route.handler(method, payload, new AbortController().signal)
}

describe('票 15 · 三个方法挂在同一条 /xuanshu 通道上（契约 §3）', () => {
  it('sediment.commit / sediment.draft / sediment.discard 逐字可调，且与既有组合并而不是互相覆盖', async () => {
    const { route } = assemble()
    expect(route.path).toBe('/api/xuanshu')

    // commit：闸门在通道上也拦得住（未确认 = {ok:false}，不是静默成功）。
    const refused = await call(route, 'sediment.commit', { draftId: 'nope', confirmed: false })
    expect(refused.ok).toBe(false)
    expect(refused.error.message).toMatch(/人工确认/u)

    // discard：没有这份草稿 → 可读失败（方法确实在）。
    const gone = await call(route, 'sediment.discard', { draftId: 'nope' })
    expect(gone.ok).toBe(false)
    expect(gone.error.message).not.toMatch(/未知玄枢操作/u)

    // draft：非问事会话 → 可读失败（方法确实在，且分类判据生效）。
    const wrongSession = await call(route, 'sediment.draft', { sessionId: 'session-1bb37188' })
    expect(wrongSession.ok).toBe(false)
    expect(wrongSession.error.message).toMatch(/问事/u)

    // 合并（不是覆盖）：票 08 / 09 / 10 / 13 / 14 的方法仍在。
    for (const method of ['pu.list', 'cang.list', 'bazi.basePu', 'consult.list', 'digao.status', 'rikke.status']) {
      const response = await call(route, method, {})
      expect(response.ok, `${method} 被 sediment.* 挤掉了：${JSON.stringify(response)}`).toBe(true)
    }

    // 名字写错就该是「未知玄枢操作」，而不是静默成功。
    const typo = await call(route, 'sediment.confirm', {})
    expect(typo.ok).toBe(false)
    expect(typo.error.message).toMatch(/未知玄枢操作/u)
  })

  it('内置 skill `xuanshu:sediment` 注册进 ctx.skills（与票 09 的 create-pu 并列）', () => {
    const { host } = assemble()
    const names = host.skills.map((row) => row.skill?.name)
    expect(names).toContain('xuanshu-create-pu')
    expect(names).toContain(SEDIMENT_SKILL_NAME)
    const sediment = host.skills.find((row) => row.skill?.name === SEDIMENT_SKILL_NAME)
    expect(sediment.skill.description).toMatch(/xuanshu:sediment/u)
    // 正文就是那份契约（模型照它吐 JSON；解析侧按同一份校验）。
    expect(sediment.skill.content).toContain('# xuanshu:sediment')
    for (const field of ['description', 'body', 'summary']) expect(sediment.skill.content).toContain(field)
    expect(sediment.skill.content).toMatch(/确认更新/u)
  })

  it('导出汇总走通道：草稿落在 config.dataDir/sediment 下（数据目录同源）', async () => {
    const sandbox = makeSandbox('wiring-draft')
    roots.push(sandbox)
    const pu = seedPu(sandbox, { name: '事业与行业', description: '事业与行业的总览。' })
    const consult = seedConsult(sandbox, { pus: [pu.slug], turns: 1 })
    const agents = fakeAgents()
    const query = fakeSessionQuery({ [consult.sessionId]: [userEvent(1, { text: '今年事业怎么走？' })] })
    const host = makeHost({
      wired: true,
      services: {
        agents: agents.service,
        sessionQuery: query.service,
        agentPresets: fakeAgentPresets().service,
        agentDefaultModel: fakeAgentDefaultModel().service,
      },
    })
    apply(host.ctx, { dataDir: sandbox.dataDir, autoStart: false })
    const route = host.routes[0]

    agents.onFollowup(() => {})
    answerRound({ agents, query, host }, consult.sessionId, draftAnswer())

    const response = await call(route, 'sediment.draft', { sessionId: consult.sessionId })
    expect(response.ok, JSON.stringify(response)).toBe(true)
    const answer = response.value
    expect(answer.target).toEqual({ slug: pu.slug, name: pu.name })
    expect(sandbox.exists('sediment', `${answer.draftId}.json`)).toBe(true)

    // 确认之后写回，落到同一棵数据目录里的谱上。
    const committed = await call(route, 'sediment.commit', { draftId: answer.draftId, confirmed: true })
    expect(committed.ok, JSON.stringify(committed)).toBe(true)
    expect(committed.value.pu.slug).toBe(pu.slug)
    expect(sandbox.read('pus', pu.slug, 'content.md')).toContain('4—6 月有一次岗位变动')
  })
})

/** 走一次完整轮：假 agent 在 followup 之后补上这一轮的答复与 `turn/end`。 */
function answerRound({ agents, query, host }, sessionId, text) {
  agents.onFollowup(({ sessionId: id }) => {
    if (id !== sessionId) return
    query.events[id] = [...(query.events[id] ?? []), assistantEvent(50, text)]
    setTimeout(() => host.emit('session/event', { id }, turnEndEvent(51, 1)), 0)
  })
}
