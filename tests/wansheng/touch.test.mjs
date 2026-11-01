/**
 * #25 · 晚省触达（宿主 ↔ 假壳端点）：到点 → 一条通知 + 一行账。
 *
 * 与 #24 的日课触达同一套语义（共用 `notify/touch.mjs`），这一组只钉晚省特有的四处：
 *   1. 载荷逐字：`kind='wansheng'`、`title='今天要不要过一遍'`、`target='consult'`（点开进问事）；
 *   2. 默认 `body=''`（锁屏不露内容），开摘要才带一句泛化短句；
 *   3. **零模型调用**（晚省只摆事实）；
 *   4. 人点不发、补课不发（`skipped` + 可读理由）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { installDailyTasks } from '../../packages/xuanshu-host/lib/rikke/daily-tasks.mjs'
import {
  WANSHENG_NOTIFY_SUMMARY, buildWanshengNotify, deliverWanshengTouch,
} from '../../packages/xuanshu-host/lib/wansheng/touch.mjs'
import { createWanshengMethods } from '../../packages/xuanshu-host/lib/wansheng/service.mjs'
import { writeShellSettings } from '../../packages/xuanshu-host/lib/notify/settings.mjs'
import { readTraffic } from '../../packages/xuanshu-host/lib/notify/traffic.mjs'
import { makeScratch, notifyStatePath, startFakeShell, writeNotifyStateFile } from '../notify/lib/sandbox.mjs'
import { fakeAgents, fakeLlm, fakeSchedule, makeCtx, makeSandbox } from '../digao/lib/sandbox.mjs'

const boxes = []
const shells = []
const scratches = []
afterEach(async () => {
  boxes.splice(0).forEach((box) => box.cleanup())
  scratches.splice(0).forEach((box) => box.cleanup())
  await Promise.all(shells.splice(0).map((shell) => shell.close()))
})

const TZ = 'Asia/Shanghai'
/** 本地 2026-10-15 21:32（= 13:32Z）：提醒的计划时刻是本地 21:30，投递只晚 2 分钟。 */
const NOW = () => new Date('2026-10-15T13:32:00.000Z')
const TODAY = '2026-10-15'

/** 晚省的到点提醒（本地 21:30 = 13:30Z）。 */
function reminder() {
  return {
    id: 'msg-w1',
    role: 'user',
    source: { kind: 'schedule' },
    content: [{
      type: 'text',
      text: '[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user\n'
        + 'reminders_json: [{"schedule_id":"sched-w","occurrence_at":"2026-10-15T13:30:00.000Z","reminder_prompt":"现在做晚省：…"}]',
    }],
  }
}

/** 造一个带假壳的晚省现场。 */
async function scene({ shell = true, notifySummary = false, llm } = {}) {
  const sandbox = makeSandbox('wansheng-touch')
  boxes.push(sandbox)

  let env = {}
  let fakeShell = null
  if (shell) {
    fakeShell = await startFakeShell()
    shells.push(fakeShell)
    const stateHome = makeScratch('wansheng-touch-state')
    scratches.push(stateHome)
    writeNotifyStateFile(stateHome.dataDir, { url: fakeShell.url, token: fakeShell.token })
    env = { XUANSHU_SHELL_NOTIFY_STATE: notifyStatePath(stateHome.dataDir) }
  }
  if (notifySummary) writeShellSettings(sandbox.dataDir, { notifySummary: true })

  const fakeLlmService = llm ?? fakeLlm({ text: '模型说的一句话。' })
  const schedule = fakeSchedule()
  const agents = fakeAgents()
  const services = { schedule, agents, llm: fakeLlmService }
  const ctx = makeCtx({ services })
  const listeners = []
  ctx.on = (event, listener) => {
    listeners.push({ event, listener })
    return () => {}
  }
  return { sandbox, ctx, schedule, agents, llm: fakeLlmService, env, listeners, shell: fakeShell }
}

/** 装一次（启动结算不会动：现场没有历史）。 */
function install(target) {
  return installDailyTasks({ ctx: target.ctx, dataDir: target.sandbox.dataDir, timeZone: TZ, now: NOW, env: target.env })
}

/** 把到点提醒 claim 进晚省会话的第一步。 */
async function deliver(target) {
  const entry = target.listeners.find((item) => item.event === 'agent/pre-step')
  const created = target.agents.calls.find((call) => String(call.sessionId).startsWith('session-xs-wansheng-'))
  const decision = { kind: 'enter', messages: [reminder()] }
  return entry.listener(
    { agent: { session: { id: created.sessionId } }, step: 1, messages: decision.messages, signal: { aborted: false } },
    async () => decision,
  )
}

describe('#25 · 到点 → 晚省产物 + 一条通知（kind=wansheng / target=consult）', () => {
  it('通知载荷逐字（默认 body 为空），产物落盘，一次模型都不调', async () => {
    const target = await scene()
    await install(target)
    await deliver(target)

    expect(target.sandbox.exists('wansheng', `${TODAY}.json`)).toBe(true)
    expect(target.shell.requests).toHaveLength(1)
    expect(target.shell.requests[0].json).toEqual({
      schema: 'xuanshu/notify@1',
      id: expect.stringMatching(/^notify-/u),
      kind: 'wansheng',
      title: '今天要不要过一遍',
      body: '',
      silent: false,
      target: 'consult',
      createdAt: '2026-10-15T13:32:00.000Z',
    })
    // 晚省只摆事实：LLM 一次都不许调。
    expect(target.llm.calls).toEqual([])

    const row = readTraffic(target.sandbox.dataDir).entries[0]
    expect(row).toMatchObject({
      kind: 'wansheng',
      date: TODAY,
      occurrenceAt: '2026-10-15T13:30:00.000Z',
      artifactPath: `wansheng/${TODAY}.json`,
      notify: { status: 'delivered', reason: null },
      missed: false,
    })
  })

  it('打开通知摘要 → body 是一句泛化短句（不含具体场次 / 项目名）', async () => {
    const target = await scene({ notifySummary: true })
    await install(target)
    await deliver(target)
    const body = target.shell.requests[0].json.body
    expect(body).toBe(WANSHENG_NOTIFY_SUMMARY)
    expect(body.length).toBeGreaterThan(0)
    expect(body.length).toBeLessThanOrEqual(200)
  })

  it('没有壳（浏览器模式）→ skipped 而不是 failed；产物照写', async () => {
    const target = await scene({ shell: false })
    await install(target)
    await deliver(target)
    expect(target.sandbox.exists('wansheng', `${TODAY}.json`)).toBe(true)
    const row = readTraffic(target.sandbox.dataDir).entries[0]
    expect(row.notify.status).toBe('skipped')
    expect(row.notify.reason).toMatch(/没有桌面应用/u)
  })
})

describe('#25 · 人点 / 补课都不推送', () => {
  it('人点 [立即生成]：壳收不到请求，账里 skipped + 可读理由', async () => {
    const target = await scene()
    await install(target)
    const methods = createWanshengMethods(target.ctx, { dataDir: target.sandbox.dataDir, now: NOW, env: target.env })
    const generated = await methods['wansheng.generate']({})
    expect(generated.ok).toBe(true)
    expect(target.shell.requests).toEqual([])
    const row = readTraffic(target.sandbox.dataDir).entries[0]
    expect(row.notify.status).toBe('skipped')
    expect(row.notify.reason).toMatch(/人点/u)
  })

  it('补课（missed:true）→ 不推送，账行说明「补生成：不补推送」', async () => {
    const target = await scene()
    const touch = await deliverWanshengTouch({
      dataDir: target.sandbox.dataDir, date: TODAY, at: NOW(), missed: true, env: target.env,
    })
    expect(touch.notify).toEqual({ status: 'skipped', reason: '补生成：不补推送（界面标「补」）' })
    expect(target.shell.requests).toEqual([])
  })

  it('载荷构造函数可单独断言（id 缺省自铸、createdAt 来自注入的钟）', () => {
    const payload = buildWanshengNotify({ now: new Date('2026-10-15T13:32:00.000Z') })
    expect(payload.id).toMatch(/^notify-/u)
    expect(payload).toMatchObject({
      kind: 'wansheng',
      title: '今天要不要过一遍',
      body: '',
      target: 'consult',
      createdAt: '2026-10-15T13:32:00.000Z',
    })
  })
})
