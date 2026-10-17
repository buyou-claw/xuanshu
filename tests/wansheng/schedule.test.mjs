/**
 * #25 · 第三条 daily 任务（晚省 21:30）+ 时刻可调（冻结契约 §2）。
 *
 * 这一组钉：
 *   1. 会话/任务身份是单一来源（`digao/tasks.mjs` 的 `WANSHENG_*`），前缀 `session-xs-wansheng-`；
 *   2. `installDailyTasks` 建**第三条**任务（旧两条的返回字段与结构不变，新增 `wansheng`）；
 *   3. 安装期按 `<dataDir>/shell-settings.json` 里的合法时刻建任务（缺省 07:30 / 21:30）；
 *   4. 幂等仍按 title（catalog 里已有「晚省」→ 复用，不再 create、不再建会话）；
 *   5. 改时刻立即改 schedule（下次到点即生效）+ 把期望值同步进设置文件。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createWanshengMethods } from '../../packages/xuanshu-host/lib/wansheng/service.mjs'
import { createRikkeMethods } from '../../packages/xuanshu-host/lib/rikke/service.mjs'
import { writeShellSettings, readShellSettings, readTouchTimes } from '../../packages/xuanshu-host/lib/notify/settings.mjs'
import { createTrafficMethods } from '../../packages/xuanshu-host/lib/notify/service.mjs'
import {
  RIKKE_TASK_TITLE, WANSHENG_DEFAULT_TIME, WANSHENG_SESSION_PREFIX, WANSHENG_TASK_TITLE,
  installDailyTasks, newSessionId,
} from '../../packages/xuanshu-host/lib/rikke/daily-tasks.mjs'
import { fakeAgents, fakeSchedule, makeSandbox, makeCtx } from '../digao/lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

function scene({ catalog = [] } = {}) {
  const sandbox = makeSandbox('wansheng-schedule')
  roots.push(sandbox)
  const schedule = fakeSchedule({ catalog })
  const agents = fakeAgents()
  const ctx = makeCtx({ services: { schedule, agents } })
  return { sandbox, ctx, schedule, agents }
}

const NOW = () => new Date('2026-10-15T03:00:00.000Z')

describe('#25 · 晚省是第三条 daily 任务（21:30，绑玄枢自铸会话）', () => {
  it('installDailyTasks 建三条：日课 / 底稿刷新 / 晚省，晚省在 21:30', async () => {
    const { sandbox, ctx, schedule } = scene()
    const result = await installDailyTasks({ ctx, dataDir: sandbox.dataDir, timeZone: 'Asia/Shanghai', now: NOW })

    expect(result.wansheng.ok).toBe(true)
    expect(result.wansheng.reused).toBe(false)
    expect(result.rikke.ok).toBe(true)
    expect(result.digao.ok).toBe(true)
    expect(result.notes).toEqual([])

    const creates = schedule.calls.filter((call) => call.method === 'create')
    expect(creates).toHaveLength(3)
    const wansheng = creates.find((call) => call.request.title === WANSHENG_TASK_TITLE)
    expect(wansheng).toBeDefined()
    expect(wansheng.request.daily).toEqual({ time: WANSHENG_DEFAULT_TIME, time_zone: 'Asia/Shanghai' })
    expect(wansheng.request.prompt).toMatch(/晚省|问事/u)
    expect(String(wansheng.sessionId).startsWith(WANSHENG_SESSION_PREFIX)).toBe(true)
    // 专用 cwd 仍要在（ADR-0009 的归属载体）。
    expect(sandbox.exists('wansheng')).toBe(true)
  })

  it('身份常量与铸 id 同步：newSessionId("wansheng") 用同一前缀', () => {
    expect(WANSHENG_TASK_TITLE).toBe('晚省')
    expect(WANSHENG_DEFAULT_TIME).toBe('21:30:00')
    expect(WANSHENG_SESSION_PREFIX).toBe('session-xs-wansheng-')
    expect(newSessionId('wansheng').startsWith(WANSHENG_SESSION_PREFIX)).toBe(true)
    expect(() => newSessionId('late')).toThrow(/未知的 daily 任务 kind/u)
  })

  it('幂等：catalog 里已有「晚省」→ 复用（不再 create、不再建会话）', async () => {
    const existing = {
      id: 'sched-w', kind: 'daily', title: WANSHENG_TASK_TITLE, time: '21:30:00.000', timeZone: 'Asia/Shanghai',
      scheduledAt: '2026-10-16T13:30:00.000Z', sessionId: 'session-xs-wansheng-existing', status: 'active',
    }
    const { sandbox, ctx, schedule, agents } = scene({ catalog: [existing] })
    const result = await installDailyTasks({ ctx, dataDir: sandbox.dataDir, timeZone: 'Asia/Shanghai', now: NOW })

    expect(result.wansheng.reused).toBe(true)
    expect(result.wansheng.task.id).toBe('sched-w')
    // 另外两条照建；晚省这条没有 create、也没有新会话。
    expect(schedule.calls.filter((call) => call.method === 'create')).toHaveLength(2)
    expect(agents.calls).toHaveLength(2)
  })
})

describe('#25 · 时刻可调：安装期按设置建任务，改时刻同步设置', () => {
  it('设置里 rikkeTime / wanshengTime → 安装期就按它建（缺省仍是 07:30 / 21:30）', async () => {
    const { sandbox, ctx, schedule } = scene()
    writeShellSettings(sandbox.dataDir, { rikkeTime: '06:45', wanshengTime: '22:15' })

    await installDailyTasks({ ctx, dataDir: sandbox.dataDir, timeZone: 'Asia/Shanghai', now: NOW })
    const creates = schedule.calls.filter((call) => call.method === 'create')
    expect(creates.find((call) => call.request.title === WANSHENG_TASK_TITLE).request.daily.time).toBe('22:15:00')
    expect(creates.find((call) => call.request.title === RIKKE_TASK_TITLE).request.daily.time).toBe('06:45:00')

    // 设置文件的读面把两个时刻归一到 HH:mm（契约 §4 的 RPC 形状）。
    expect(readTouchTimes(sandbox.dataDir)).toEqual({ rikkeTime: '06:45', wanshengTime: '22:15' })
  })

  it('设置里是坏时刻 → 回落缺省建任务（坏文件不当设置，也不让安装失败）', async () => {
    const { sandbox, ctx, schedule } = scene()
    sandbox.write('shell-settings.json', JSON.stringify({
      schema: 'xuanshu/shell-settings@1', rikkeTime: '25:99', wanshengTime: 'abc',
    }))

    const result = await installDailyTasks({ ctx, dataDir: sandbox.dataDir, timeZone: 'Asia/Shanghai', now: NOW })
    expect(result.notes).toEqual([])
    const creates = schedule.calls.filter((call) => call.method === 'create')
    expect(creates.find((call) => call.request.title === RIKKE_TASK_TITLE).request.daily.time).toBe('07:30:00')
    expect(creates.find((call) => call.request.title === WANSHENG_TASK_TITLE).request.daily.time).toBe('21:30:00')
  })

  it('晚省 setTime：改 schedule（立即生效）+ 把期望值同步进设置文件', async () => {
    const { sandbox, ctx, schedule } = scene()
    await installDailyTasks({ ctx, dataDir: sandbox.dataDir, timeZone: 'Asia/Shanghai', now: NOW })
    const methods = createWanshengMethods(ctx, { dataDir: sandbox.dataDir, now: NOW })

    const answer = await methods['wansheng.setTime']({ time: '22:05' })
    expect(answer).toEqual({ schedule: { time: '22:05', timeZone: 'Asia/Shanghai' } })
    // schedule 是「实际生效」的权威：任务本身已经被改掉。
    const updated = schedule.calls.find((call) => call.method === 'update')
    expect(updated.request.change.daily.time).toBe('22:05:00')
    // 设置文件是「下次安装 / 界面显示」的期望值。
    expect(readTouchTimes(sandbox.dataDir).wanshengTime).toBe('22:05')
  })

  it('日课 setTime 也同步设置（两条任务同一套语义）；非法时刻抛可读错误', async () => {
    const { sandbox, ctx } = scene()
    await installDailyTasks({ ctx, dataDir: sandbox.dataDir, timeZone: 'Asia/Shanghai', now: NOW })
    const rikke = createRikkeMethods(ctx, { dataDir: sandbox.dataDir, now: NOW })
    await rikke['rikke.setTime']({ time: '06:45' })
    expect(readTouchTimes(sandbox.dataDir).rikkeTime).toBe('06:45')

    const wansheng = createWanshengMethods(ctx, { dataDir: sandbox.dataDir, now: NOW })
    await expect(wansheng['wansheng.setTime']({ time: '9pm' })).rejects.toThrow(/HH:mm/u)
  })
})

describe('#25 · traffic.settings.* 扩晚省/日课时刻（加性）', () => {
  it('get 给三个键（notifySummary + 两个时刻）；set 能单独改时刻，其它键不动', async () => {
    const { sandbox, ctx } = scene()
    const traffic = createTrafficMethods(ctx, { dataDir: sandbox.dataDir })
    expect(await traffic['traffic.settings.get']({})).toEqual({
      notifySummary: false, rikkeTime: '07:30', wanshengTime: '21:30',
    })
    expect(await traffic['traffic.settings.set']({ wanshengTime: '22:15' })).toEqual({
      notifySummary: false, rikkeTime: '07:30', wanshengTime: '22:15',
    })
    expect(readShellSettings(sandbox.dataDir).notifySummary).toBe(false)
    await expect(traffic['traffic.settings.set']({ rikkeTime: '7:30pm' })).rejects.toThrow(/rikkeTime/u)
    await expect(traffic['traffic.settings.set']({})).rejects.toThrow(/notifySummary|rikkeTime|wanshengTime/u)
  })
})
