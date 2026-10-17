/**
 * 票 13 · 底稿 03:30 也接上**可执行的生成链**（task-3；复核 Spec 1 的另一半）
 *
 * 修复前的状态（task-2 收尾时如实登记的边界 2）：两条 daily 任务的会话都已经是「跑得起来的会话」
 * （preset + 默认模型），日课 07:30 到点由 `rikke/delivery.mjs` 在 `agent/pre-step` 上跑生成链，
 * 但**底稿 03:30 到点仍然只是把 `DIGAO_PROMPT` 投进会话**。模型做不了宿主才做得对的那几件事
 * ——`digao.json` 的 meta（`segments`/`sources`/`bySource`/`digest`）、确定性骨架与 `【来源：…】` 标记、
 * `condenseWithLlm` 的摘要 ——产物一个字都不落，而 schedule 那边照样把这次投递记成「已送达」。
 *
 * 判据（与 `tests/rikke/daily-chain.test.mjs` 同款）：
 *   - 到点投递（`session-xs-digao-` + `source.kind === 'schedule'` + 第一步）→ 跑**与
 *     `digao.refresh` 同一份**生成代码（`digao/generate.mjs` 的 `refreshDigao()`）→ 落
 *     `<dataDir>/digao.md` + `<dataDir>/digao.json`（schema `xuanshu/digao@1`）；
 *   - 两条链各认各的会话（日课的提醒不许去刷底稿，反之亦然）；
 *   - 失败路径（LLM 报错 / 写盘失败）**不许把那一轮弄挂**：钩子永不抛、原因进日志。
 *
 * 断言只打外部可观察物：`ctx.schedule` / `ctx.agents` / `ctx.llm` 收到了什么、沙箱里落了哪些文件、
 * 以及记到的日志行。零网络、零真实会话、零真实 LLM。
 */
import { mkdirSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'

import { installDailyTasks } from '../../packages/xuanshu-host/lib/rikke/daily-tasks.mjs'
import { createDigaoMethods } from '../../packages/xuanshu-host/lib/digao/service.mjs'
import { createPuRepository } from '../../packages/xuanshu-host/lib/pu/repository.mjs'
import { fakeAgentDefaultModel, fakeAgentPresets } from '../consult/lib/sandbox.mjs'
import { fakeAgents, fakeLlm, fakeSchedule, makeCtx, makeSandbox } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 固定「现在」：2026-10-16 03:30 Asia/Shanghai（= 2026-10-15T19:30Z）。 */
const NOW = () => new Date('2026-10-15T19:30:00.000Z')
const TZ = 'Asia/Shanghai'
/** 假 LLM 压出来的那一句（与 `tests/digao/service.test.mjs` 同款现场）。 */
const DIGEST_TEXT = '一句话：写工具链的开发者，八字丙寅日主。'

/**
 * 宿主到点投进来的那条消息（形状照 `dsh-schedule` 的 `renderReminderFraming` + `createUserMessage`）。
 */
function scheduleReminder(id = 'msg-d1') {
  return {
    id,
    role: 'user',
    source: { kind: 'schedule' },
    content: [{ type: 'text', text: '[SCHEDULE REMINDER]\nschedule_id_json: "sched-2"\nreminder_prompt_json: "现在刷新底稿：…"' }],
  }
}

/** 一条普通用户消息（不是定时投递）。 */
function userMessage(id = 'msg-d2') {
  return { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '底稿现在是什么样？' }] }
}

/** 沙箱里落下的底稿产物。 */
function digaoFiles(sandbox) {
  return sandbox.files().filter((file) => file.startsWith('digao.'))
}

/**
 * 一个完整的装配现场：三路来源齐（底座谱 + 一份 base 级用户谱 + 一个工作区）、两条 daily 任务
 * 能建、`agent/pre-step` 钩子能装。
 * @param {{llm?: 'ok'|'absent'|'failing'}} [parts]
 */
function scene(parts = {}) {
  const sandbox = makeSandbox('digao-daily')
  roots.push(sandbox)

  const repository = createPuRepository(sandbox.dataDir)
  repository.writeBase(
    { 'bazi.md': '# 八字（出生盘）\n\n## 四柱\n\n| 柱 | 年 |\n|---|---|\n| 干支 | 己巳 |\n' },
    { description: '底座：出生信息与八字底盘。', summary: '底座：四柱 己巳 丙子 丙寅 甲午。' },
  )
  repository.confirm({
    name: '软件开发',
    level: 'base',
    description: '我的开发背景',
    body: '# 概览\n十年工具链经验。',
    summary: '擅长 Rust；做过十年工具链。',
  }, true)

  const schedule = fakeSchedule()
  const agents = fakeAgents()
  const services = { schedule, agents }
  let llm
  if (parts.llm !== 'absent') {
    llm = fakeLlm(parts.llm === 'failing' ? { fail: true } : { text: DIGEST_TEXT })
    services.llm = llm
  }
  services.agentPresets = fakeAgentPresets().service
  services.agentDefaultModel = fakeAgentDefaultModel().service

  const ctx = makeCtx({
    services,
    workspaceRegistry: { list: () => [{ id: 'w1', path: 'E:\\ai_project\\XuanShu', title: 'XuanShu', sessionIds: ['a', 'b', 'c'] }] },
  })
  // 断言台补上 `ctx.on`（真宿主是 cordis ctx）与记日志的 logger（失败原因要可读）。
  const listeners = []
  const logs = []
  const warns = []
  ctx.on = (event, listener) => {
    listeners.push({ event, listener })
    return () => {}
  }
  ctx.logger = () => ({
    info: (...args) => logs.push(args.map(String).join(' ')),
    warn: (...args) => warns.push(args.map(String).join(' ')),
  })
  return { sandbox, ctx, schedule, agents, llm, listeners, logs, warns }
}

/** 装一次（真 `installDailyTasks`）。 */
async function install(target) {
  return await installDailyTasks({
    ctx: target.ctx, dataDir: target.sandbox.dataDir, timeZone: TZ, now: NOW,
  })
}

/** 某条 daily 会话的 id（装配期自铸）。 */
function sessionIdOf(target, kind) {
  const created = target.agents.calls.find((call) => String(call.sessionId).startsWith(`session-xs-${kind}-`))
  if (created === undefined) throw new Error(`装配期没有建出 ${kind} 的定时会话`)
  return created.sessionId
}

/**
 * 模拟「到点」：宿主把提醒 claim 进这一轮的第一步，`agent/pre-step` waterfall 跑一遍。
 * @returns waterfall 的 decision（钩子必须原样交还）
 */
async function deliver(target, { sessionId, messages, step = 1 }) {
  const entry = target.listeners.find((item) => item.event === 'agent/pre-step')
  if (entry === undefined) {
    throw new Error('`agent/pre-step` 上没有钩子：定时任务到点后没有任何可执行的生成链（复核 Spec 1）')
  }
  const decision = { kind: 'enter', messages }
  const result = await entry.listener(
    { agent: { session: { id: sessionId } }, step, messages, signal: { aborted: false } },
    async () => decision,
  )
  return { decision, result }
}

describe('票13 · 底稿到点 → 跑 `digao.refresh` 那一份生成链', () => {
  it('定时投递跑同一份链：落 `<dataDir>/digao.md` + `digao.json`（schema/来源标记都对）', async () => {
    const target = scene({ llm: 'ok' })
    const installed = await install(target)
    expect(installed.digao.ok).toBe(true)

    const { decision, result } = await deliver(target, { sessionId: sessionIdOf(target, 'digao'), messages: [scheduleReminder()] })

    // 钩子是 waterfall 的一环：decision 原样交还（不改这一步的模型输入）。
    expect(result).toBe(decision)

    const meta = target.sandbox.readJson('digao.json')
    expect(meta.schema).toBe('xuanshu/digao@1')
    expect(meta.segments).toBe(3)
    expect(meta.sources).toBe(2) // 谱 + 工作区（工作流本票留空）
    expect(meta.bySource).toEqual({ pu: 2, workspace: 1 })
    expect(meta.digest).toBe('llm')
    expect(meta.generatedAt).toBe('2026-10-15T19:30:00.000Z') // 时间基准来自注入的 now

    const markdown = target.sandbox.read('digao.md')
    expect(markdown).toContain('## 摘要')
    expect(markdown).toContain(DIGEST_TEXT)
    expect(markdown).toContain('【来源：谱 底座】')
    expect(markdown).toContain('【来源：工作区 XuanShu】')
    expect(markdown.indexOf('## 来源：谱')).toBeLessThan(markdown.indexOf('## 来源：工作区'))
    // 整文件原子重写：只此两份，没有 .tmp 残留。
    expect(digaoFiles(target.sandbox)).toEqual(['digao.json', 'digao.md'])
    expect(target.sandbox.files().filter((file) => file.endsWith('.tmp'))).toEqual([])
  })

  it('两条链各认各的会话：日课会话收到定时提醒**不会**去刷底稿', async () => {
    const target = scene({ llm: 'ok' })
    await install(target)
    await deliver(target, { sessionId: sessionIdOf(target, 'rikke'), messages: [scheduleReminder()] })

    expect(digaoFiles(target.sandbox)).toEqual([])
    // 日课那条路缺底座快照 → 它自己的可读失败，与底稿无关。
    expect(target.warns.join('\n')).toMatch(/日课/u)
  })

  it('不是定时投递 / 不是第一步 → 不再跑（底稿保持上一份）', async () => {
    const target = scene({ llm: 'ok' })
    await install(target)
    const sessionId = sessionIdOf(target, 'digao')

    // ① 普通用户消息：不触发生成。
    await deliver(target, { sessionId, messages: [userMessage()] })
    expect(digaoFiles(target.sandbox)).toEqual([])
    expect(target.llm.calls).toEqual([])

    // ② 到点那一轮跑一次。
    await deliver(target, { sessionId, messages: [scheduleReminder()] })
    const afterFirst = target.sandbox.read('digao.md')
    const digestCalls = target.llm.calls.filter((call) => call.method === 'stream').length
    expect(digestCalls).toBe(1)

    // ③ 同一轮的第二步（工具循环）：不重复跑。
    await deliver(target, { sessionId, messages: [scheduleReminder('msg-d3')], step: 2 })
    expect(target.sandbox.read('digao.md')).toBe(afterFirst)
    expect(target.llm.calls.filter((call) => call.method === 'stream').length).toBe(digestCalls)
    expect(digaoFiles(target.sandbox)).toEqual(['digao.json', 'digao.md'])
  })

  it('与 `digao.refresh` 产出形状一致（只差生成时间那一行）', async () => {
    const target = scene({ llm: 'ok' })
    await install(target)
    await deliver(target, { sessionId: sessionIdOf(target, 'digao'), messages: [scheduleReminder()] })
    const fromTimer = target.sandbox.read('digao.md')
    const metaFromTimer = target.sandbox.readJson('digao.json')

    // 人点 [刷新] 走同一个 ctx / 同一个 dataDir（同一份链的另一半）。
    const methods = createDigaoMethods(target.ctx, { dataDir: target.sandbox.dataDir })
    await methods['digao.refresh']({})
    const fromHuman = target.sandbox.read('digao.md')

    const strip = (text) => text.replace(/^- 生成时间：.*$/mu, '')
    expect(strip(fromHuman)).toBe(strip(fromTimer))
    const metaFromHuman = target.sandbox.readJson('digao.json')
    expect({ ...metaFromHuman, generatedAt: null }).toEqual({ ...metaFromTimer, generatedAt: null })
  })
})

describe('票13 · 底稿到点的失败路径不许弄挂那一轮', () => {
  it('LLM 报错 → 仍写成 skeleton（可观察），warn 里有可读原因，decision 原样交还', async () => {
    const target = scene({ llm: 'failing' })
    await install(target)
    const { decision, result } = await deliver(target, { sessionId: sessionIdOf(target, 'digao'), messages: [scheduleReminder()] })

    expect(result).toBe(decision)
    expect(target.sandbox.readJson('digao.json').digest).toBe('skeleton')
    expect(target.sandbox.read('digao.md')).toContain('未提炼')
    expect(target.warns.join('\n')).toMatch(/LLM/u)
    expect(target.warns.join('\n')).toMatch(/provider down/u)
  })

  it('写盘失败（`digao.md` 位置被占成目录）→ 不抛、不落半份、warn 里有可读原因', async () => {
    const target = scene({ llm: 'ok' })
    await install(target)
    // 让整文件重写的 rename 必然失败：目标位置不是一个可替换的文件。
    mkdirSync(target.sandbox.path('digao.md'), { recursive: true })

    const { decision, result } = await deliver(target, { sessionId: sessionIdOf(target, 'digao'), messages: [scheduleReminder()] })
    expect(result).toBe(decision)
    // 半份 JSON 不许留下（原子写的意义就在这儿）。
    expect(target.sandbox.exists('digao.json')).toBe(false)
    expect(target.sandbox.files().filter((file) => file.endsWith('.tmp'))).toEqual([])
    const warns = target.warns.join('\n')
    expect(warns).toMatch(/底稿到点刷新失败/u)
    expect(warns.length).toBeGreaterThan('底稿到点刷新失败'.length)
  })
})
