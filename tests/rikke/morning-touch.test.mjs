/**
 * #24 · 早间触达端到端（宿主半）：到点生成 → 系统通知 → 触达账 → `rikke.status` 如实反映。
 *
 * 这一组是**宿主 ↔ 假壳端点**的夹测（冻结契约 §2/§3/§4）：假壳是**真 `node:http`**，
 * 只绑 `127.0.0.1` 的 OS 分配端口（#23 的真壳包不在本文件的依赖里）。
 *
 * 验收里属于这一组的几条：
 *   - 到点且窗口关着时**仍生成产物并推送通知**（通知由壳弹，宿主只发回环 POST）；
 *   - 通知默认**不露具体内容**；开摘要后才带一句**不含私事**的短句；
 *   - 通知失败（未授权 / 连不上）**如实落账**并在 `rikke.status` 显示未读与原因，**不影响产物**；
 *   - `manual:true` 的生成**不发系统通知**（账里记 skipped，理由可读）；
 *   - 没有壳（浏览器模式）记 skipped，不是 failed（不把「没装壳」说成故障）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { installDailyTasks } from '../../packages/xuanshu-host/lib/rikke/daily-tasks.mjs'
import { createRikkeMethods } from '../../packages/xuanshu-host/lib/rikke/service.mjs'
import { writeShellSettings } from '../../packages/xuanshu-host/lib/notify/settings.mjs'
import { createTrafficMethods } from '../../packages/xuanshu-host/lib/notify/service.mjs'
import { readTraffic } from '../../packages/xuanshu-host/lib/notify/traffic.mjs'
import {
  BIRTH, fakeAgents, fakeHorosa, fakeLlm, fakeSchedule, huangliFixture, makeCtx, makeSandbox, writeBaseSnapshot,
} from './lib/sandbox.mjs'
import {
  makeScratch, notifyStatePath, startFakeShell, writeNotifyStateFile,
} from '../notify/lib/sandbox.mjs'

const roots = []
const shells = []
const scratches = []
afterEach(async () => {
  roots.splice(0).forEach((sandbox) => sandbox.cleanup())
  scratches.splice(0).forEach((box) => box.cleanup())
  await Promise.all(shells.splice(0).map((shell) => shell.close()))
})

/** 本地 2026-10-15 07:40（= 23:40Z 前一天）：提醒的计划时刻是本地 07:30，投递只晚 10 分钟。 */
const NOW = () => new Date('2026-10-14T23:40:00.000Z')
const TODAY = '2026-10-15'
const TZ = 'Asia/Shanghai'

/** 到点投进来的那条提醒（形状照 `dsh-schedule` 的 `createUserMessage`）。 */
function scheduleReminder() {
  return {
    id: 'msg-1',
    role: 'user',
    source: { kind: 'schedule' },
    content: [{ type: 'text', text: '[SCHEDULE REMINDER]\noccurrence_at: 2026-10-14T23:30:00.000Z\nreminder_prompt_json: "现在做日课：…"' }],
  }
}

/**
 * 一个「到点」现场：沙箱 + 底座 + 假 horosa + 假 schedule/agents/llm +（可选）假壳端点。
 * @param {{shell?: boolean, shellReply?: Function, notifySummary?: boolean, aiEnabled?: boolean, llm?: object|null}} [parts]
 */
async function scene(parts = {}) {
  const sandbox = makeSandbox('rikke-touch')
  roots.push(sandbox)
  writeBaseSnapshot(sandbox.dataDir, BIRTH)

  let shell = null
  let env = {}
  if (parts.shell !== false) {
    shell = await startFakeShell(parts.shellReply)
    shells.push(shell)
    const stateHome = makeScratch('rikke-touch-state')
    scratches.push(stateHome)
    writeNotifyStateFile(stateHome.dataDir, { url: shell.url, token: shell.token })
    env = { XUANSHU_SHELL_NOTIFY_STATE: notifyStatePath(stateHome.dataDir) }
  }

  if (parts.notifySummary === true) writeShellSettings(sandbox.dataDir, { notifySummary: true })
  if (parts.aiEnabled === false) {
    const { writeRikkeSettings } = await import('../../packages/xuanshu-host/lib/rikke/settings.mjs')
    writeRikkeSettings(sandbox.dataDir, { aiEnabled: false })
  }

  const schedule = fakeSchedule()
  const agents = fakeAgents()
  const services = {
    schedule,
    agents,
    xuanshuHorosa: fakeHorosa(huangliFixture('huangli-ok')).service,
  }
  if (parts.llm !== null) services.llm = parts.llm ?? fakeLlm({ text: '今天把要交付的那件事先收口，别把安排排太满。' })
  const ctx = makeCtx({ services })
  const listeners = []
  ctx.on = (event, listener) => {
    listeners.push({ event, listener })
    return () => {}
  }
  return { sandbox, ctx, schedule, agents, shell, env, listeners }
}

/** 装一次两条 daily 任务（带 env 注入）。 */
function install(target) {
  return installDailyTasks({
    ctx: target.ctx, dataDir: target.sandbox.dataDir, timeZone: TZ, now: NOW, env: target.env,
  })
}

/** 模拟到点：把提醒 claim 进这一轮第一步，跑 `agent/pre-step`。 */
async function deliver(target) {
  const entry = target.listeners.find((item) => item.event === 'agent/pre-step')
  const created = target.agents.calls.find((call) => String(call.sessionId).startsWith('session-xs-rikke-'))
  const decision = { kind: 'enter', messages: [scheduleReminder()] }
  const result = await entry.listener(
    { agent: { session: { id: created.sessionId } }, step: 1, messages: decision.messages, signal: { aborted: false } },
    async () => decision,
  )
  return { decision, result }
}

/** 宿主侧的三个读面（status / traffic.status）。 */
function readers(target) {
  return {
    rikke: createRikkeMethods(target.ctx, { dataDir: target.sandbox.dataDir, now: NOW, env: target.env }),
    traffic: createTrafficMethods(target.ctx, { dataDir: target.sandbox.dataDir }),
  }
}

/* ───────────────────────── 1. 到点 → 通知 + 账 + status ───────────────────────── */

describe('#24 · 到点生成 → 一条系统通知（宿主 ↔ 假壳端点）', () => {
  it('通知载荷逐字照契约 §2（默认 body 为空、target=overview、kind=rikke）', async () => {
    const target = await scene()
    await install(target)
    const { result, decision } = await deliver(target)
    // 钩子是 waterfall 的一环：decision 原样交还（通知不许改这一轮的模型输入）。
    expect(result).toBe(decision)

    expect(target.sandbox.exists('rikke', `${TODAY}.json`)).toBe(true)
    expect(target.shell.requests).toHaveLength(1)
    const sent = target.shell.requests[0].json
    expect(sent).toEqual({
      schema: 'xuanshu/notify@1',
      id: expect.stringMatching(/^notify-/u),
      kind: 'rikke',
      title: '今日日课已生成',
      body: '',
      silent: false,
      target: 'overview',
      createdAt: '2026-10-14T23:40:00.000Z',
    })
    expect(target.shell.requests[0].headers.authorization).toMatch(/^Bearer /u)
  })

  it('账里落一行 delivered：generated/artifactPath/date/occurrenceAt/read 都对', async () => {
    const target = await scene()
    await install(target)
    await deliver(target)

    const ledger = readTraffic(target.sandbox.dataDir)
    expect(ledger.entries).toHaveLength(1)
    const row = ledger.entries[0]
    expect(row).toMatchObject({
      schema: 'xuanshu/traffic@1',
      kind: 'rikke',
      date: TODAY,
      // #25：occurrenceAt = 提醒里的计划时刻（不是投递时刻）。
      occurrenceAt: '2026-10-14T23:30:00.000Z',
      generated: true,
      artifactPath: `rikke/${TODAY}.json`,
      notify: { status: 'delivered', reason: null },
      read: false,
      missed: false,
    })
    expect(row.id).toMatch(/^traffic-/u)
  })

  it('rikke.status 如实反映未读与最近一次 notify（不把「推成了」说成没推）', async () => {
    const target = await scene()
    await install(target)
    await deliver(target)
    const { rikke } = readers(target)
    const status = await rikke['rikke.status']({})
    expect(status.exists).toBe(true)
    expect(status.unread).toBe(1)
    expect(status.notify).toEqual({ status: 'delivered', at: '2026-10-14T23:40:00.000Z' })
    expect(status.ai).toEqual({ mode: 'ok', text: '今天把要交付的那件事先收口，别把安排排太满。' })

    // 打开面板（traffic.markRead）之后未读数归零。
    const { traffic } = readers(target)
    const marked = await traffic['traffic.markRead']({ ids: [readTraffic(target.sandbox.dataDir).entries[0].id] })
    expect(marked).toEqual({ ok: true, updated: 1 })
    expect((await rikke['rikke.status']({})).unread).toBe(0)
  })
})

/* ───────────────────────── 2. 摘要开关 ───────────────────────── */

describe('#24 · 通知默认不露具体内容；开摘要才带一句不含私事的短句', () => {
  it('默认（notifySummary=false）→ body 为空串', async () => {
    const target = await scene()
    await install(target)
    await deliver(target)
    expect(target.shell.requests[0].json.body).toBe('')
  })

  it('打开通知摘要 → body 是一句泛化短句；不含宜 / 忌 / 流日的任何具体内容', async () => {
    const target = await scene({ notifySummary: true })
    await install(target)
    await deliver(target)
    const body = target.shell.requests[0].json.body
    expect(typeof body).toBe('string')
    expect(body.length).toBeGreaterThan(0)
    expect(body.length).toBeLessThanOrEqual(200)

    const record = target.sandbox.readJson('rikke', `${TODAY}.json`)
    for (const fact of [record.content.yi, record.content.ji, record.content.liuri]) {
      expect(body).not.toContain(fact)
    }
    // 也不带 AI 段正文（同样可能提到具体安排）。
    if (record.ai?.mode === 'ok') expect(body).not.toContain(record.ai.text)
  })
})

/* ───────────────────────── 3. 人点生成不发系统通知 ───────────────────────── */

describe('#24 · manual:true 的生成不发系统通知（账记 skipped）', () => {
  it('人点 [立即生成]：壳一个请求都收不到，账里是 skipped + 可读理由', async () => {
    const target = await scene()
    await install(target)
    const { rikke } = readers(target)
    const generated = await rikke['rikke.generate']({})
    expect(generated.ok).toBe(true)
    expect(target.shell.requests).toEqual([])

    const ledger = readTraffic(target.sandbox.dataDir)
    expect(ledger.entries).toHaveLength(1)
    expect(ledger.entries[0].notify.status).toBe('skipped')
    expect(ledger.entries[0].notify.reason).toMatch(/人点/u)
    // skipped 不算未读（未读的语义是「推到了但你没看」）。
    expect((await rikke['rikke.status']({})).unread).toBe(0)
  })
})

/* ───────────────────────── 4. 失败与无壳：如实落账、不影响产物 ───────────────────────── */

describe('#24 · 通知失败不阻塞生成、如实落账', () => {
  it('没有壳（浏览器模式，env 缺席）→ skipped 而不是 failed；产物照写', async () => {
    const target = await scene({ shell: false })
    await install(target)
    await deliver(target)
    expect(target.sandbox.exists('rikke', `${TODAY}.json`)).toBe(true)
    const ledger = readTraffic(target.sandbox.dataDir)
    expect(ledger.entries[0].notify.status).toBe('skipped')
    expect(ledger.entries[0].notify.reason).toMatch(/no-shell|没有桌面应用/u)
    const { rikke } = readers(target)
    expect((await rikke['rikke.status']({})).notify.status).toBe('skipped')
  })

  it('壳收到但没弹成（delivered:false 权限缺失）→ failed + 可读原因；产物在；status 显示失败', async () => {
    const target = await scene({
      shellReply: (_request, respond) => respond(200, { ok: true, delivered: false, reason: 'permission-denied' }),
    })
    await install(target)
    await deliver(target)

    expect(target.sandbox.exists('rikke', `${TODAY}.json`)).toBe(true)
    const ledger = readTraffic(target.sandbox.dataDir)
    expect(ledger.entries[0].notify.status).toBe('failed')
    // #40：权限缺失落账即人话（并指路），机器码留在 `reasonCode` 里 —— 原始英文 token 不再当文案。
    expect(ledger.entries[0].notify.reason).toMatch(/权限缺失/u)
    expect(ledger.entries[0].notify.reason).toMatch(/通知权限/u)
    expect(ledger.entries[0].notify.reasonCode).toBe('permission-denied')
    expect(ledger.lastFailure).toMatchObject({ kind: 'rikke', reasonCode: 'permission-denied' })
    expect(ledger.lastFailure.reason).toMatch(/权限缺失/u)

    const { rikke, traffic } = readers(target)
    const status = await rikke['rikke.status']({})
    expect(status.notify.status).toBe('failed')
    expect(status.notify.reason).toMatch(/权限缺失/u)
    expect(status.notify.reasonCode).toBe('permission-denied')
    const answered = await traffic['traffic.status']({})
    expect(answered.lastFailure).toMatchObject({ kind: 'rikke', reasonCode: 'permission-denied' })
  })

  it('连不上壳（状态文件指着已关闭的端口）→ failed + 可读原因；生成链与 decision 都不受影响', async () => {
    const box = makeScratch('rikke-touch-dead')
    scratches.push(box)
    const fake = await startFakeShell()
    const url = fake.url
    await fake.close()
    writeNotifyStateFile(box.dataDir, { url })

    const target = await scene({ shell: false })
    target.env = { XUANSHU_SHELL_NOTIFY_STATE: notifyStatePath(box.dataDir) }
    await install(target)
    const { result, decision } = await deliver(target)

    expect(result).toBe(decision)
    expect(target.sandbox.exists('rikke', `${TODAY}.json`)).toBe(true)
    const row = readTraffic(target.sandbox.dataDir).entries[0]
    expect(row.notify.status).toBe('failed')
    expect(row.notify.reason).toMatch(/连不上|连接/u)
  })

  it('AI 段关掉时到点照样推送（通知只依赖「生成了」，不依赖 AI 段）', async () => {
    const target = await scene({ aiEnabled: false })
    await install(target)
    await deliver(target)
    expect(target.sandbox.readJson('rikke', `${TODAY}.json`).ai).toEqual({ mode: 'off' })
    expect(target.shell.requests).toHaveLength(1)
    expect(readTraffic(target.sandbox.dataDir).entries[0].notify.status).toBe('delivered')
  })
})
