/**
 * 票 13 · 日课定时任务接上**可执行的生成链**（复核 Spec 1 的回归判据）
 *
 * 复核的原文（`docs/reviews/spec001-a2ceaf3-review.md` 的逐项对照表）：
 *
 * > Spec 1：定时任务未接可执行生成链 —— `rikke/daily-tasks.mjs:142` 仍裸建 agent。
 *
 * 两处**实**的差距（不是风格问题）：
 *
 *   1. **裸 create 的会话开不了一轮**：`ctx.agents.create({sessionId, meta:{cwd}})` 既没有
 *      provider/model、也没有 preset 挂出来的工具（`consult/agent.mjs` 的文件头记了实装出处
 *      `dsh-agent-loop/lib/index.js:1185`）。日课到点时宿主 `resolveAgent(sessionId)` →
 *      `agent.followup(提醒)` 真唤醒它（`dsh-schedule/lib/index.js:1576-1597`），而那个会话
 *      **一个 turn 都跑不起来** —— 提示词写得再好也没有执行者。
 *   2. **日课产物没人写**：`<dataDir>/rikke/<YYYY-MM-DD>.json` 只有 `rikke.generate`（人点）写。
 *      定时这条路只落了一条提醒消息，**一个字节都不落盘**，日课卡永远是空的。
 *
 * 这一组用例钉的就是「到点 → 生成」这条链：
 *   - 到点投递（`agent/pre-step` 上收到 `source.kind === 'schedule'` 的那条提醒）→ 跑**与
 *     `rikke.generate` 同一份**生成代码（`manual:false`；`service.mjs` 头部记着这个约定的来历 ——
 *     原来那句「将来定时路径复用同一份代码时显式传 manual:false」）→ 落 `<dataDir>/rikke/<日期>.json`；
 *   - 会话按**与问事同一份**组合建（preset + 默认模型），不再是裸 create；
 *   - 失败路径（模型不可得 / preset 名册抛错 / horosa 不可得）**不许把定时任务本身弄挂**：
 *     任务照建、钩子永不抛、下一次投递照样能重试。
 *
 * 断言只打外部可观察物：`ctx.schedule` / `ctx.agents` / `xuanshuHorosa.callTool` 收到了什么，
 * 以及沙箱里落了哪些文件。零网络、零真实会话、零真实 LLM（与 `tests/rikke/service.test.mjs` 同款现场）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { installDailyTasks } from '../../packages/xuanshu-host/lib/rikke/daily-tasks.mjs'
import { createRikkeMethods } from '../../packages/xuanshu-host/lib/rikke/service.mjs'
import { fakeAgentDefaultModel, fakeAgentPresets } from '../consult/lib/sandbox.mjs'
import {
  BIRTH, fakeAgents, fakeHorosa, fakeSchedule, huangliFixture, makeCtx, makeSandbox, writeBaseSnapshot,
} from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 固定「现在」：2026-10-15 11:00 Asia/Shanghai（= 03:00Z）——与 `service.test.mjs` 同一口径。 */
const NOW = () => new Date('2026-10-15T03:00:00.000Z')
const TODAY = '2026-10-15'
const TZ = 'Asia/Shanghai'

/**
 * 宿主到点投进来的那条消息（形状照 `dsh-schedule` 的 `renderReminderFraming` + `createUserMessage`：
 * `source.kind === 'schedule'`，正文是 `[SCHEDULE REMINDER]` 前缀的纯文本）。
 */
function scheduleReminder(id = 'msg-1') {
  return {
    id,
    role: 'user',
    source: { kind: 'schedule' },
    content: [{
      type: 'text',
      text: '[SCHEDULE REMINDER]\nschedule_id_json: "sched-1"\noccurrence_at: 2026-10-15T07:30:00.000Z\nreminder_prompt_json: "现在做日课：…"',
    }],
  }
}

/** 一条普通用户消息（不是定时投递）。 */
function userMessage(id = 'msg-2') {
  return { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '今天怎么样？' }] }
}

/** 沙箱里落下的日课产物（相对 `rikke/` 的那些文件）。 */
function rikkeFiles(sandbox) {
  return sandbox.files().filter((file) => file.startsWith('rikke/'))
}

/**
 * 一个完整的装配现场。
 * @param {{withBase?: boolean, horosa?: 'ok'|'missing'|'bad', model?: 'ok'|'absent'|'preset-throws'}} [parts]
 */
function scene(parts = {}) {
  const sandbox = makeSandbox('rikke-daily')
  roots.push(sandbox)
  if (parts.withBase !== false) writeBaseSnapshot(sandbox.dataDir, BIRTH)

  const schedule = fakeSchedule()
  const agents = fakeAgents()
  const services = { schedule, agents }

  let horosa
  if (parts.horosa !== 'missing') {
    horosa = fakeHorosa(huangliFixture(parts.horosa === 'bad' ? 'huangli-invalid-payload' : 'huangli-ok'))
    services.xuanshuHorosa = horosa.service
  }

  let presets
  if (parts.model !== 'absent') {
    presets = fakeAgentPresets()
    services.agentDefaultModel = fakeAgentDefaultModel().service
    services.agentPresets = parts.model === 'preset-throws'
      ? {
        resolve: async () => { throw new Error('preset 名册读不出来') },
        mount: async () => { throw new Error('不该走到 mount') },
      }
      : presets.service
  }

  const ctx = makeCtx({ services })
  // 断言台补上 `ctx.on`（真宿主是 cordis ctx）：`agent/pre-step` 钩子就装在这儿。
  const listeners = []
  ctx.on = (event, listener) => {
    listeners.push({ event, listener })
    return () => {}
  }
  return { sandbox, ctx, schedule, agents, horosa, presets, listeners }
}

/** 装一次（真 `installDailyTasks`），返回两条任务的结果。 */
async function install(target) {
  return await installDailyTasks({
    ctx: target.ctx, dataDir: target.sandbox.dataDir, timeZone: TZ, now: NOW,
  })
}

/** 日课那条定时会话的 id（装配期自铸的 `session-xs-rikke-<uuid>`）。 */
function rikkeSessionId(target) {
  const created = target.agents.calls.find((call) => String(call.sessionId).startsWith('session-xs-rikke-'))
  if (created === undefined) throw new Error('装配期没有建出日课定时会话')
  return created.sessionId
}

/**
 * 模拟「到点」：宿主把提醒 claim 进这一轮的第一步，`agent/pre-step` waterfall 跑一遍。
 * @returns waterfall 的 decision（钩子必须原样交还）
 */
async function deliver(target, { sessionId, messages, step = 1, aborted = false }) {
  const entry = target.listeners.find((item) => item.event === 'agent/pre-step')
  if (entry === undefined) {
    throw new Error('`agent/pre-step` 上没有钩子：定时任务到点后没有任何可执行的生成链（复核 Spec 1）')
  }
  const decision = { kind: 'enter', messages }
  const result = await entry.listener(
    { agent: { session: { id: sessionId } }, step, messages, signal: { aborted } },
    async () => decision,
  )
  return { decision, result }
}

describe('票13 · 到点 → 跑 `rikke.generate` 那一份生成链（复核 Spec 1）', () => {
  it('定时投递跑同一份链：落 `<dataDir>/rikke/<今天>.json`，manual=false', async () => {
    const target = scene()
    const installed = await install(target)
    expect(installed.rikke.ok).toBe(true)

    const { decision, result } = await deliver(target, { sessionId: rikkeSessionId(target), messages: [scheduleReminder()] })

    // 钩子是 waterfall 的一环：decision 原样交还（不改这一步的模型输入）。
    expect(result).toBe(decision)

    const record = target.sandbox.readJson('rikke', `${TODAY}.json`)
    expect(record.schema).toBe('xuanshu/rikke@1')
    expect(record.date).toBe(TODAY)
    expect(record.zone).toBe(TZ)
    // 「定时产出的那一份」与「人点出来的那一份」用同一个字段区分（service.mjs 头部记着这个约定的来历）。
    expect(record.manual).toBe(false)
    expect(Object.keys(record.content).sort()).toEqual(['ji', 'liuri', 'yi'])

    // 与 `rikke.generate` 同一条通道、同一份入参：底座 + 当前时刻（整数小时）。
    expect(target.horosa.calls).toHaveLength(1)
    expect(target.horosa.calls[0].name).toBe('horosa_cn_huangli')
    expect(target.horosa.calls[0].args.date).toBe(TODAY)
    expect(target.horosa.calls[0].args.hour).toBe(11) // 03:00Z 的 Asia/Shanghai 小时数
    // 原子写：只此一份产物，不留 .tmp。
    expect(rikkeFiles(target.sandbox)).toEqual([`rikke/${TODAY}.json`])
  })

  it('两条路产出同一份形状：定时那份（manual=false）与人点那份（manual=true）只差这两个字段', async () => {
    const target = scene()
    await install(target)
    await deliver(target, { sessionId: rikkeSessionId(target), messages: [scheduleReminder()] })
    const fromTimer = target.sandbox.readJson('rikke', `${TODAY}.json`)

    // 人点 [立即生成] 走的是同一个 ctx / 同一个 dataDir（同一份链的另一半）。
    const methods = createRikkeMethods(target.ctx, { dataDir: target.sandbox.dataDir, now: NOW })
    const manual = await methods['rikke.generate']({})
    expect(manual.ok).toBe(true)
    const fromHuman = target.sandbox.readJson('rikke', `${TODAY}.json`)

    expect(fromTimer.manual).toBe(false)
    expect(fromHuman.manual).toBe(true)
    // 同一份代码 → 同 schema / 同日期 / 同时区 / 同内容 / 同黄历出处。
    const strip = (record) => ({ ...record, manual: null, generatedAt: null })
    expect(strip(fromHuman)).toEqual(strip(fromTimer))
  })

  it('不是定时投递 / 不是日课会话 → 一个字都不写（钩子只认自己那条链）', async () => {
    const target = scene()
    await install(target)
    const sessionId = rikkeSessionId(target)

    // ① 日课会话里的一条普通用户消息：不触发生成。
    await deliver(target, { sessionId, messages: [userMessage()] })
    expect(rikkeFiles(target.sandbox)).toEqual([])
    expect(target.horosa.calls).toEqual([])

    // ② 别的会话（问事）收到定时提醒：不是我们的任务，不动手。
    await deliver(target, { sessionId: 'session-xs-consult-x', messages: [scheduleReminder()] })
    expect(rikkeFiles(target.sandbox)).toEqual([])

    // ③ 非第一步（同一轮的工具循环）不重复生成。
    await deliver(target, { sessionId, messages: [scheduleReminder()], step: 2 })
    expect(rikkeFiles(target.sandbox)).toEqual([])
  })
})

describe('票13 · 日课定时会话不再是裸 create（复核 Spec 1 的证据行）', () => {
  it('会话按与问事同一份组合建：preset + 默认模型 + setup（工具与模型都齐）', async () => {
    const target = scene()
    await install(target)

    const created = target.agents.calls.find((call) => String(call.sessionId).startsWith('session-xs-rikke-'))
    expect(created).toBeDefined()
    expect(created.meta.agentPreset).toBe('standard')
    expect(created.agentOptions).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(typeof created.setup).toBe('function')
    // 专用 cwd 仍要在（ADR-0009 的归属载体），且目录先建出来。
    expect(created.meta.cwd).toBe(target.sandbox.path('rikke'))
    expect(target.sandbox.exists('rikke')).toBe(true)

    // setup 真的把 preset 挂进那个 agent scope（工具来自这里）。
    await created.setup({})
    expect(target.presets.mounted).toEqual([{ agentCtx: {}, id: 'standard' }])
  })

  it('模型 / preset 服务不可得 → 会话照建、两条任务照建、到点照样落盘（生成链不依赖模型）', async () => {
    const target = scene({ model: 'absent' })
    const installed = await install(target)

    expect(installed.rikke.ok).toBe(true)
    expect(installed.digao.ok).toBe(true)
    // 退回契约 §4 字面的裸 create：会话仍建得出来（preset 缺 → 没有工具与路由，理由由装配报告去报）。
    const created = target.agents.calls.find((call) => String(call.sessionId).startsWith('session-xs-rikke-'))
    expect(created.meta.agentPreset).toBeUndefined()
    expect(created.agentOptions).toBeUndefined()
    // 这是**有意的**软降级（不是失败）：不给理由，免得把正常的裁剪 profile 说成故障。
    expect(installed.rikke.agent).toEqual({ composed: false, reason: null })
    expect(installed.notes).toEqual([])

    // 关键：日课产物由宿主侧的确定性链产出，没有模型也照样落盘。
    await deliver(target, { sessionId: rikkeSessionId(target), messages: [scheduleReminder()] })
    expect(target.sandbox.readJson('rikke', `${TODAY}.json`).manual).toBe(false)
  })

  it('preset 名册抛错 → 退回裸建但不抛，两条任务照建，理由如实带回', async () => {
    const target = scene({ model: 'preset-throws' })
    const installed = await install(target)

    expect(installed.rikke.ok).toBe(true)
    expect(installed.digao.ok).toBe(true)
    expect(installed.rikke.agent.composed).toBe(false)
    expect(installed.rikke.agent.reason).toMatch(/preset/u)
    // 非致命，但**不静默**：进 notes，装配期会被记一条 warn。
    expect(installed.notes.join('\n')).toMatch(/日课/u)
    expect(installed.notes.join('\n')).toMatch(/preset/u)
    // 会话还是建出来了（否则任务没有绑定对象）。
    expect(target.agents.calls.filter((call) => String(call.sessionId).startsWith('session-xs-rikke-'))).toHaveLength(1)
    // 到点仍然能落盘。
    await deliver(target, { sessionId: rikkeSessionId(target), messages: [scheduleReminder()] })
    expect(target.sandbox.exists('rikke', `${TODAY}.json`)).toBe(true)
  })
})

describe('票13 · 失败路径不许把定时任务本身弄挂', () => {
  it('horosa 不可得 / 底座未立 → 钩子不抛、不落盘、decision 原样交还（下一次投递再试）', async () => {
    const noHorosa = scene({ horosa: 'missing' })
    await install(noHorosa)
    const first = await deliver(noHorosa, { sessionId: rikkeSessionId(noHorosa), messages: [scheduleReminder()] })
    expect(first.result).toBe(first.decision)
    expect(rikkeFiles(noHorosa.sandbox)).toEqual([])

    const noBase = scene({ withBase: false })
    const installed = await install(noBase)
    // 底座未立：日课无法生成，但**任务本身照建**（界面上的空态与「改时间」都还要在）。
    expect(installed.rikke.ok).toBe(true)
    const second = await deliver(noBase, { sessionId: rikkeSessionId(noBase), messages: [scheduleReminder()] })
    expect(second.result).toBe(second.decision)
    expect(rikkeFiles(noBase.sandbox)).toEqual([])
  })

  it('上游回了失败信封（真样本）→ 不抛、不落盘', async () => {
    const target = scene({ horosa: 'bad' })
    await install(target)
    const { decision, result } = await deliver(target, { sessionId: rikkeSessionId(target), messages: [scheduleReminder()] })
    expect(result).toBe(decision)
    expect(rikkeFiles(target.sandbox)).toEqual([])
  })

  it('装配期拿不到 ctx.on（断言台 / 裁剪宿主）→ 两条任务照建，理由如实带回，不抛', async () => {
    const target = scene()
    delete target.ctx.on
    const installed = await install(target)

    expect(installed.rikke.ok).toBe(true)
    expect(installed.digao.ok).toBe(true)
    expect(installed.rikke.task.id).toBeTruthy()
    expect(installed.delivery.ok).toBe(false)
    expect(installed.delivery.reason).toMatch(/ctx\.on/u)
  })
})
