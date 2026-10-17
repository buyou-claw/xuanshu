/**
 * #25 · 补课（missed）：日期按 occurrence 算 + 错过的日课/晚省下次打开补上并标「补」（冻结契约 §3）。
 *
 * 这一组钉五件事（对应票面验收的第 2 条与第 5 条）：
 *   1. **日期来自 occurrence_at，不是投递时刻**：这是 `delivery.mjs` 的老 bug —— 进程在 10-16 06:00
 *      起来补 10-15 07:30 那一次时，旧实现会给「明天」写一份日课，而 10-15 那份永远不生成；
 *   2. 迟到 > 30 分钟（含同一天迟到）→ 产物与账行都标 `missed:true`；
 *   3. 判据 = 产物缺失 **且** 账里没有该 `kind+date` 行；窗口最多回看 7 天；
 *      该 kind 从没跑过（无产物也无账行）→ 不补（没有「错过」的证据）；
 *   4. 补生成**不调模型**（日课 AI 段 = `{mode:'off', reason:'补生成不做 AI 段'}`）、**不推送**
 *      （账行 `skipped`，理由「补生成：不补推送（界面标「补」）」）；
 *   5. 幂等：同一天不补两次；连漏 3 天就补 3 天（不受 schedule「只补最近一次」的语义限制）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { installDailyTasks } from '../../packages/xuanshu-host/lib/rikke/daily-tasks.mjs'
import { parseScheduleOccurrence } from '../../packages/xuanshu-host/lib/rikke/occurrence.mjs'
import { settleMissedTouches } from '../../packages/xuanshu-host/lib/rikke/missed.mjs'
import { readRikke, writeRikke } from '../../packages/xuanshu-host/lib/rikke/store.mjs'
import { readTraffic, appendTraffic, buildTrafficEntry } from '../../packages/xuanshu-host/lib/notify/traffic.mjs'
import { buildWanshengRecord, readWansheng, writeWansheng } from '../../packages/xuanshu-host/lib/wansheng/store.mjs'
import {
  BIRTH, fakeAgents, fakeHorosa, fakeLlm, fakeSchedule, huangliFixture, makeCtx, makeSandbox, writeBaseSnapshot,
} from './lib/sandbox.mjs'
import { makeScratch, notifyStatePath, startFakeShell, writeNotifyStateFile } from '../notify/lib/sandbox.mjs'

const boxes = []
const shells = []
const scratches = []
afterEach(async () => {
  boxes.splice(0).forEach((box) => box.cleanup())
  scratches.splice(0).forEach((box) => box.cleanup())
  await Promise.all(shells.splice(0).map((shell) => shell.close()))
})

const TZ = 'Asia/Shanghai'
const TODAY = '2026-10-15'
/** 今天 11:00（本地）。 */
const NOW_TODAY = () => new Date('2026-10-15T03:00:00.000Z')

/**
 * 本地 `date` 当天 07:30 的 UTC 瞬间（Asia/Shanghai = 东八区；手抄 23:30Z 容易错，用 UTC 运算算）。
 * @param {string} date `YYYY-MM-DD`（本地日）
 */
function morningOf(date) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 7, 30) - 8 * 3600_000).toISOString()
}

/** 到点投进来的那条提醒（形状照 `dsh-schedule` 的 `renderReminderFraming`）。 */
function reminderBatch(occurrenceAt, id = 'msg-1') {
  return {
    id,
    role: 'user',
    source: { kind: 'schedule' },
    content: [{
      type: 'text',
      text: '[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user\n'
        + `reminders_json: [{"schedule_id":"sched-1","occurrence_at":"${occurrenceAt}","reminder_prompt":"现在做日课：…"}]`,
    }],
  }
}

/** 单条提醒形态（`occurrence_at:` 裸行；旧 fixture 与真机单条版本）。 */
function reminderSingle(occurrenceAt, id = 'msg-2') {
  return {
    id,
    role: 'user',
    source: { kind: 'schedule' },
    content: [{
      type: 'text',
      text: `[SCHEDULE REMINDER]\nschedule_id: sched-1\noccurrence_at: ${occurrenceAt}\nreminder_prompt: 现在做日课：…`,
    }],
  }
}

/** 一个到点现场：底座 + 假 horosa/llm/schedule/agents +（可选）假壳端点。 */
async function scene({ now = NOW_TODAY, shell = false } = {}) {
  const sandbox = makeSandbox('rikke-missed')
  boxes.push(sandbox)
  writeBaseSnapshot(sandbox.dataDir, BIRTH)

  let env = {}
  let fakeShell = null
  if (shell) {
    fakeShell = await startFakeShell()
    shells.push(fakeShell)
    const stateHome = makeScratch('rikke-missed-state')
    scratches.push(stateHome)
    writeNotifyStateFile(stateHome.dataDir, { url: fakeShell.url, token: fakeShell.token })
    env = { XUANSHU_SHELL_NOTIFY_STATE: notifyStatePath(stateHome.dataDir) }
  }

  const schedule = fakeSchedule()
  const agents = fakeAgents()
  const llm = fakeLlm({ text: '模型说的一句话。' })
  const services = {
    schedule,
    agents,
    llm,
    xuanshuHorosa: fakeHorosa(huangliFixture('huangli-ok')).service,
  }
  const ctx = makeCtx({ services })
  const listeners = []
  ctx.on = (event, listener) => {
    listeners.push({ event, listener })
    return () => {}
  }
  return { sandbox, ctx, schedule, agents, llm, env, listeners, now, shell: fakeShell }
}

/** 装三条 daily（启动时也会结算一次补课）。 */
function install(target) {
  return installDailyTasks({ ctx: target.ctx, dataDir: target.sandbox.dataDir, timeZone: TZ, now: target.now, env: target.env })
}

/** 模拟到点：把提醒 claim 进这一轮第一步。 */
async function deliver(target, { sessionPrefix = 'session-xs-rikke-', messages, step = 1 } = {}) {
  const entry = target.listeners.find((item) => item.event === 'agent/pre-step')
  const created = target.agents.calls.find((call) => String(call.sessionId).startsWith(sessionPrefix))
  if (created === undefined) throw new Error(`装配期没有建出 ${sessionPrefix} 会话`)
  const decision = { kind: 'enter', messages }
  const result = await entry.listener(
    { agent: { session: { id: created.sessionId } }, step, messages, signal: { aborted: false } },
    async () => decision,
  )
  return { decision, result }
}

/** 种一份日课产物（= 「这个 kind 跑过」的证据）。 */
function seedRikke(box, date) {
  writeRikke(box.dataDir, {
    schema: 'xuanshu/rikke@1',
    date,
    generatedAt: `${date}T03:00:00.000Z`,
    zone: TZ,
    content: { yi: '祭祀', ji: '动土', liuri: '甲子日 · 水' },
    manual: false,
  })
}

/** 种一份晚省产物。 */
function seedWansheng(box, date) {
  writeWansheng(box.dataDir, buildWanshengRecord({
    date,
    zone: TZ,
    at: new Date(`${date}T03:00:00.000Z`),
    facts: { consultSessions: { count: 0, items: [] } },
  }))
}

/** 补课的账行理由（契约 §3 逐字）。 */
const MISSED_REASON = '补生成：不补推送（界面标「补」）'

/* ───────────────────────── 1. occurrence_at 解析 ───────────────────────── */

describe('#25 · 到点消息里的 occurrence_at（日期不是投递时刻）', () => {
  it('批量形态 `reminders_json[0].occurrence_at` 解析出精确瞬间', () => {
    const parsed = parseScheduleOccurrence([reminderBatch('2026-10-13T23:30:00.000Z')])
    expect(parsed.at?.toISOString()).toBe('2026-10-13T23:30:00.000Z')
    expect(parsed.source).toBe('reminders_json')
    expect(parsed.note).toBeNull()
  })

  it('单条形态的裸 `occurrence_at:` 行也认（真机两版 framing 都覆盖）', () => {
    const parsed = parseScheduleOccurrence([reminderSingle('2026-10-13T23:30:00.000Z')])
    expect(parsed.at?.toISOString()).toBe('2026-10-13T23:30:00.000Z')
    expect(parsed.source).toBe('occurrence_at')
  })

  it('解析不出 → at:null + 可读 note（调用方退回投递时刻，且要说出来）', () => {
    const parsed = parseScheduleOccurrence([{ role: 'user', source: { kind: 'schedule' }, content: [{ type: 'text', text: '到点了' }] }])
    expect(parsed.at).toBeNull()
    expect(parsed.source).toBe('fallback')
    expect(parsed.note).toMatch(/occurrence_at/u)
    // 非定时消息 / 空输入：同样退回，不抛。
    expect(parseScheduleOccurrence([]).at).toBeNull()
    expect(parseScheduleOccurrence([{ content: 'plain string' }]).at).toBeNull()
  })
})

/* ───────────────────────── 2. 到点 → 日期取 occurrence（bug 修复） ───────────────────────── */

describe('#25 · 到点生成：日期取 occurrence 在底座时区的那一天', () => {
  it('补昨天的 07:30（投递在 11:00）→ 写**昨天**那份、标 missed、账记 occurrenceAt', async () => {
    const target = await scene({ shell: true })
    await install(target)
    const occurrence = morningOf('2026-10-14') // 2026-10-13T23:30Z
    await deliver(target, { messages: [reminderBatch(occurrence)] })

    // 关键：不是给今天（10-15）写一份，而是给 10-14 那份补上。
    expect(target.sandbox.exists('rikke', '2026-10-14.json')).toBe(true)
    expect(target.sandbox.exists('rikke', `${TODAY}.json`)).toBe(false)
    const record = target.sandbox.readJson('rikke', '2026-10-14.json')
    expect(record.date).toBe('2026-10-14')
    expect(record.missed).toBe(true)

    const row = readTraffic(target.sandbox.dataDir).entries[0]
    expect(row).toMatchObject({
      kind: 'rikke',
      date: '2026-10-14',
      occurrenceAt: occurrence,
      missed: true,
      notify: { status: 'skipped', reason: MISSED_REASON },
    })
    // 迟到 = 补：不推送（开机瞬间不该连弹历史通知）。
    expect(target.shell.requests).toEqual([])
  })

  it('准点（< 30 分钟）→ 产物不标 missed，照常推送', async () => {
    const target = await scene({
      now: () => new Date('2026-10-14T23:40:00.000Z'), // 本地 07:40
      shell: true,
    })
    await install(target)
    await deliver(target, { messages: [reminderBatch('2026-10-14T23:30:00.000Z')] })

    const record = target.sandbox.readJson('rikke', `${TODAY}.json`)
    expect(record.missed).toBeUndefined()
    expect(target.shell.requests).toHaveLength(1)
    expect(target.shell.requests[0].json).toMatchObject({ kind: 'rikke', title: '今日日课已生成' })
    expect(readTraffic(target.sandbox.dataDir).entries[0]).toMatchObject({
      date: TODAY,
      occurrenceAt: '2026-10-14T23:30:00.000Z',
      missed: false,
      notify: { status: 'delivered', reason: null },
    })
  })

  it('同一天迟到 > 30 分钟 → 产物与账行都标 missed（同一天迟到也算补）', async () => {
    const target = await scene({ shell: true })
    await install(target)
    await deliver(target, { messages: [reminderBatch(morningOf(TODAY))] })

    const record = target.sandbox.readJson('rikke', `${TODAY}.json`)
    expect(record.missed).toBe(true)
    expect(target.shell.requests).toEqual([])
    expect(readTraffic(target.sandbox.dataDir).entries[0]).toMatchObject({
      date: TODAY,
      missed: true,
      notify: { status: 'skipped', reason: MISSED_REASON },
    })
  })

  it('没有 occurrence_at → 退回投递时刻（回到今天的日期），且不误标补', async () => {
    const target = await scene({ shell: true })
    await install(target)
    await deliver(target, { messages: [reminderSingle(morningOf(TODAY))].map((message) => ({
      ...message,
      content: [{ type: 'text', text: '[SCHEDULE REMINDER]\n到点了（没有 occurrence_at）' }],
    })) })

    const record = target.sandbox.readJson('rikke', `${TODAY}.json`)
    expect(record.missed).toBeUndefined()
    expect(readTraffic(target.sandbox.dataDir).entries[0].occurrenceAt).toBe('2026-10-15T03:00:00.000Z')
  })
})

/* ───────────────────────── 3. 补课结算（产物缺失 + 账里没有） ───────────────────────── */

describe('#25 · 补课：错过的日课/晚省下次打开补上、标「补」、不推送', () => {
  it('连漏 3 天 → 3 天都补（不受 schedule「只补最近一次」限制）；AI 段不调模型', async () => {
    const target = await scene()
    seedRikke(target.sandbox, '2026-10-11') // 第一次跑过的证据（窗口的起点）
    const settled = await settleMissedTouches({
      ctx: target.ctx, dataDir: target.sandbox.dataDir, zone: TZ, now: target.now, env: target.env,
    })
    expect(settled.days.map((item) => item.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14'])

    for (const date of ['2026-10-12', '2026-10-13', '2026-10-14']) {
      const record = target.sandbox.readJson('rikke', `${date}.json`)
      expect(readRikke(target.sandbox.dataDir, date).state).toBe('ready')
      expect(record.missed).toBe(true)
      // 补课的 AI 段：不调模型，但三态要写清楚（不是「失败」，是「补生成不做」）。
      expect(record.ai).toEqual({ mode: 'off', reason: '补生成不做 AI 段' })
      // 确定性三键照写。
      expect(Object.keys(record.content).sort()).toEqual(['ji', 'liuri', 'yi'])
    }
    // 零模型调用：补课不生成结论。
    expect(target.llm.calls).toEqual([])

    const rows = readTraffic(target.sandbox.dataDir).entries
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.date).sort()).toEqual(['2026-10-12', '2026-10-13', '2026-10-14'])
    for (const row of rows) {
      expect(row).toMatchObject({
        kind: 'rikke',
        generated: true,
        artifactPath: `rikke/${row.date}.json`,
        missed: true,
        notify: { status: 'skipped', reason: MISSED_REASON },
      })
      // occurrenceAt 是那天的计划时刻（本地 07:30），不是补的时刻。
      expect(row.occurrenceAt).toBe(morningOf(row.date))
    }
  })

  it('幂等：再结算一次什么都不做（同一天不补两次）', async () => {
    const target = await scene()
    seedRikke(target.sandbox, '2026-10-11')
    const first = await settleMissedTouches({
      ctx: target.ctx, dataDir: target.sandbox.dataDir, zone: TZ, now: target.now, env: target.env,
    })
    expect(first.days).toHaveLength(3)
    const second = await settleMissedTouches({
      ctx: target.ctx, dataDir: target.sandbox.dataDir, zone: TZ, now: target.now, env: target.env,
    })
    expect(second.days).toEqual([])
    expect(readTraffic(target.sandbox.dataDir).entries).toHaveLength(3)
    // 模型一次都没被调（两次结算都不生成结论）。
    expect(target.llm.calls).toEqual([])
  })

  it('账里已有该 kind+date 的生成行 → 不再生成（账是「补过没有」的唯一权威）', async () => {
    const target = await scene()
    seedRikke(target.sandbox, '2026-10-11')
    appendTraffic(target.sandbox.dataDir, buildTrafficEntry({
      kind: 'rikke',
      date: '2026-10-13',
      occurrenceAt: morningOf('2026-10-13'),
      generated: true,
      artifactPath: 'rikke/2026-10-13.json',
      notify: { status: 'delivered', reason: null },
      at: '2026-10-13T03:00:00.000Z',
    }))
    const settled = await settleMissedTouches({
      ctx: target.ctx, dataDir: target.sandbox.dataDir, zone: TZ, now: target.now, env: target.env,
    })
    expect(settled.days.map((item) => item.date)).toEqual(['2026-10-12', '2026-10-14'])
    expect(target.sandbox.exists('rikke', '2026-10-13.json')).toBe(false)
  })

  it('该 kind 从没跑过（无产物也无账行）→ 不补（没有「错过」的证据）', async () => {
    const target = await scene()
    const settled = await settleMissedTouches({
      ctx: target.ctx, dataDir: target.sandbox.dataDir, zone: TZ, now: target.now, env: target.env,
    })
    expect(settled.days).toEqual([])
    expect(readTraffic(target.sandbox.dataDir).exists).toBe(false)
  })

  it('只回看 7 天：8 天前的窗口外不补', async () => {
    const target = await scene()
    seedRikke(target.sandbox, '2026-10-07') // 8 天前
    const settled = await settleMissedTouches({
      ctx: target.ctx, dataDir: target.sandbox.dataDir, zone: TZ, now: target.now, env: target.env,
    })
    // 窗口 = 10-08 .. 10-14；起点是 10-07，所以 10-08..10-14 都算错过（7 天）。
    expect(settled.days.map((item) => item.date)).toEqual([
      '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14',
    ])
    expect(target.sandbox.exists('rikke', '2026-10-07.json')).toBe(true)
  })

  it('晚省同样补：确定性事实（无模型）+ missed + 账行 skipped', async () => {
    const target = await scene()
    seedWansheng(target.sandbox, '2026-10-11')
    const settled = await settleMissedTouches({
      ctx: target.ctx, dataDir: target.sandbox.dataDir, zone: TZ, now: target.now, env: target.env,
    })
    const wanshengDays = settled.days.filter((item) => item.kind === 'wansheng').map((item) => item.date)
    expect(wanshengDays).toEqual(['2026-10-12', '2026-10-13', '2026-10-14'])
    for (const date of wanshengDays) {
      const read = readWansheng(target.sandbox.dataDir, date)
      expect(read.state).toBe('ready')
      expect(read.record.missed).toBe(true)
      expect(read.record.facts).toBeTypeOf('object')
    }
    const rows = readTraffic(target.sandbox.dataDir).entries
    expect(rows.map((row) => row.kind)).toEqual(['wansheng', 'wansheng', 'wansheng'])
    expect(rows.every((row) => row.notify.status === 'skipped' && row.notify.reason === MISSED_REASON)).toBe(true)
    expect(target.llm.calls).toEqual([])
  })
})

/* ───────────────────────── 4. 结算时机 ───────────────────────── */

describe('#25 · 结算时机：启动时（不阻塞装配）+ 每次到点之后', () => {
  it('启动装配期就结算（installDailyTasks 返回里带 missed.days）', async () => {
    const target = await scene()
    seedRikke(target.sandbox, '2026-10-11')
    const installed = await install(target)
    expect(installed.missed.days).toEqual([
      { kind: 'rikke', date: '2026-10-12' },
      { kind: 'rikke', date: '2026-10-13' },
      { kind: 'rikke', date: '2026-10-14' },
    ])
    expect(target.sandbox.exists('rikke', '2026-10-14.json')).toBe(true)
  })

  it('每次到点之后也结算（到点那次只补最近的 occurrence，剩下的靠结算补齐）', async () => {
    const target = await scene({ shell: true })
    await install(target) // 此刻无历史 → 启动不补
    seedRikke(target.sandbox, '2026-10-12') // 之后才出现的旧证据（模拟历史产物）
    await deliver(target, { messages: [reminderBatch(morningOf(TODAY))] })

    // 到点那一次写今天；结算补上 13 / 14。
    expect(target.sandbox.exists('rikke', `${TODAY}.json`)).toBe(true)
    expect(target.sandbox.exists('rikke', '2026-10-13.json')).toBe(true)
    expect(target.sandbox.exists('rikke', '2026-10-14.json')).toBe(true)
    expect(target.sandbox.readJson('rikke', '2026-10-13.json').missed).toBe(true)
  })
})
