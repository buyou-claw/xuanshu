/**
 * 票 13 · 两条 daily 定时任务（契约 §1/§2 + Lead 2026-10-15 的加性修订）
 *
 * 装配期要保证树里有**恰好两条**任务：日课 07:30（绑 `session-xs-rikke-<uuid>`）、
 * 底稿刷新 03:30（绑 `session-xs-digao-<uuid>`）。断言只看「往 schedule 与 agents 上发了什么」，
 * 不碰真实进程、不联网。
 *
 * 抓的真实缺陷/风险：
 *   ① **重复建任务 = 每天收到 N 份提醒**：所以幂等靠 `catalog()` 按名字找（task 表是唯一权威），
 *      而不是自己再存一份 id。这条用一个「catalog 里已有日课」的现场钉住。
 *   ② **会话 id 形状是契约**（ADR-0009）：`session-xs-rikke-` / `session-xs-digao-` 前缀 + 自铸 uuid。
 *   ③ **归属用专用 cwd**（不是 workspace）：`<dataDir>/rikke`、`<dataDir>/digao`，且目录要先建出来。
 *   ④ **schedule bundle 没启用时要可读理由**：`ctx.schedule` 是 `undefined` 而 boot 不报错 ——
 *      这是本票最恶劣的失败形态，理由里必须点到那个 bundle 与 install-profile。
 *   ⑤ **契约修订的加性字段：拿不到就省略键**（`digao.status`/`digao.read` 的 `schedule`）。
 */
import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'

import { createDigaoMethods } from '../../packages/xuanshu-host/lib/digao/service.mjs'
import {
  DIGAO_DEFAULT_TIME, DIGAO_TASK_TITLE, RIKKE_DEFAULT_TIME, RIKKE_TASK_TITLE,
  WANSHENG_DEFAULT_TIME, WANSHENG_TASK_TITLE,
  ensureDailyTask, installDailyTasks,
} from '../../packages/xuanshu-host/lib/rikke/daily-tasks.mjs'
import { fakeAgents, fakeSchedule, makeCtx, makeSandbox } from '../digao/lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

function scene({ catalog = [], schedule = true } = {}) {
  const sandbox = makeSandbox('daily')
  roots.push(sandbox)
  const fake = schedule ? fakeSchedule({ catalog }) : undefined
  const agents = fakeAgents()
  const services = { agents }
  if (fake !== undefined) services.schedule = fake
  return { sandbox, ctx: makeCtx({ services }), schedule: fake, agents }
}

describe('票13 · 装配两条 daily 任务（契约 §1/§2；#25 加第三条「晚省」）', () => {
  it('时间与标题按契约：日课 07:30、底稿刷新 03:30、晚省 21:30，且都建在 daily 上', async () => {
    const { sandbox, ctx, schedule } = scene()
    const result = await installDailyTasks({ ctx, dataDir: sandbox.dataDir, timeZone: 'Asia/Shanghai' })

    expect(result.rikke.ok).toBe(true)
    expect(result.digao.ok).toBe(true)
    expect(result.wansheng.ok).toBe(true)
    expect(result.notes).toEqual([])
    expect(schedule.calls.filter((call) => call.method === 'create')).toHaveLength(3)

    const creates = schedule.calls.filter((call) => call.method === 'create')
    const rikke = creates.find((call) => call.request.title === RIKKE_TASK_TITLE)
    expect(rikke.request.daily).toEqual({ time: RIKKE_DEFAULT_TIME, time_zone: 'Asia/Shanghai' })
    expect(rikke.request.prompt).toMatch(/日课/u)
    const digao = creates.find((call) => call.request.title === DIGAO_TASK_TITLE)
    expect(digao.request.daily).toEqual({ time: DIGAO_DEFAULT_TIME, time_zone: 'Asia/Shanghai' })
    expect(digao.request.prompt).toMatch(/底稿/u)
    const wansheng = creates.find((call) => call.request.title === WANSHENG_TASK_TITLE)
    expect(wansheng.request.daily).toEqual({ time: WANSHENG_DEFAULT_TIME, time_zone: 'Asia/Shanghai' })
    expect(wansheng.request.prompt).toMatch(/晚省/u)
  })

  it('会话 id 用玄枢自铸前缀，cwd 是专用目录且**目录已建出来**（不是 workspace）', async () => {
    const { sandbox, ctx, agents } = scene()
    await installDailyTasks({ ctx, dataDir: sandbox.dataDir })

    expect(agents.calls).toHaveLength(3)
    const kinds = agents.calls.map((call) => call.sessionId.split('-')[2]).sort()
    expect(kinds).toEqual(['digao', 'rikke', 'wansheng'])
    for (const call of agents.calls) {
      const kind = call.sessionId.split('-')[2]
      expect(call.meta.cwd).toBe(`${sandbox.dataDir}\\${kind}`)
      expect(existsSync(call.meta.cwd)).toBe(true)
    }
    // 三个载体里没有 workspace：会话不进任何工作区（ADR-0009 第 3 条）。
    expect(ctx.workspaceRegistry).toBeUndefined()
  })

  it('幂等：catalog 里已有同名任务 → 复用（不再 create、不再建会话）', async () => {
    const existing = {
      id: 'sched-1', kind: 'daily', title: RIKKE_TASK_TITLE, time: '07:30:00.000', timeZone: 'Asia/Shanghai',
      scheduledAt: '2026-10-16T07:30:00.000Z', sessionId: 'session-xs-rikke-existing', status: 'active',
    }
    const { sandbox, ctx, schedule, agents } = scene({ catalog: [existing] })
    const result = await installDailyTasks({ ctx, dataDir: sandbox.dataDir })

    expect(result.rikke.ok).toBe(true)
    expect(result.rikke.reused).toBe(true)
    expect(result.rikke.task.id).toBe('sched-1')
    // 只剩底稿与晚省两条要建。
    expect(schedule.calls.filter((call) => call.method === 'create')).toHaveLength(2)
    expect(agents.calls).toHaveLength(2)
    expect(agents.calls.map((call) => call.sessionId.split('-')[2]).sort()).toEqual(['digao', 'wansheng'])
  })

  it('ctx.schedule 不可得（bundle 没启用）→ 可读理由点到 bundle 与 install-profile，且不抛', async () => {
    const { sandbox, ctx } = scene({ schedule: false })
    const result = await installDailyTasks({ ctx, dataDir: sandbox.dataDir })
    expect(result.rikke.ok).toBe(false)
    expect(result.rikke.reason).toContain('schedule')
    expect(result.rikke.reason).toContain('experimental-schedule-bundle')
    expect(result.rikke.reason).toContain('install-profile')
    expect(result.notes.length).toBe(3)
  })

  it('ctx.agents 不可得 → 不建任务，理由点名 agents（不静默建一条没有会话的任务）', async () => {
    const sandbox = makeSandbox('daily-no-agents')
    roots.push(sandbox)
    const schedule = fakeSchedule()
    const ctx = makeCtx({ services: { schedule } })
    const result = await ensureDailyTask({
      ctx, dataDir: sandbox.dataDir, kind: 'rikke', title: RIKKE_TASK_TITLE, prompt: 'x', time: RIKKE_DEFAULT_TIME, timeZone: 'Asia/Shanghai',
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('agents')
    expect(schedule.calls.filter((call) => call.method === 'create')).toEqual([])
  })
})

describe('票13 · 底稿的 schedule 加性字段（Lead 2026-10-15 修订）', () => {
  const TASK = {
    id: 'sched-3', kind: 'daily', title: DIGAO_TASK_TITLE, time: '03:30:00.000', timeZone: 'Asia/Shanghai',
    scheduledAt: '2026-10-16T03:30:00.000Z', sessionId: 'session-xs-digao-x', status: 'active',
  }

  it('任务在场 → status 与 read 都带 schedule:{time,timeZone,id}', async () => {
    const { sandbox, ctx } = scene({ catalog: [TASK] })
    const methods = createDigaoMethods(ctx, { dataDir: sandbox.dataDir })
    const expected = { time: '03:30', timeZone: 'Asia/Shanghai', id: 'sched-3' }
    expect((await methods['digao.status']({})).schedule).toEqual(expected)
    expect((await methods['digao.read']({})).schedule).toEqual(expected)
  })

  it('任务不在场 → **省略该键**（不是回 null / 空串）', async () => {
    const { sandbox, ctx } = scene({ schedule: false })
    const methods = createDigaoMethods(ctx, { dataDir: sandbox.dataDir })
    const status = await methods['digao.status']({})
    const read = await methods['digao.read']({})
    expect(Object.prototype.hasOwnProperty.call(status, 'schedule')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(read, 'schedule')).toBe(false)
  })
})
