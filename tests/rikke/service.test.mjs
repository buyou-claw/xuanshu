/**
 * 票 13 · 日课三方法（契约 §2 + Lead 2026-10-15 的加性修订）
 *
 * 断言只打外部可观察行为：方法返回值、沙箱里落了哪些文件、发给 `xuanshuHorosa.callTool` 的入参。
 *
 * 抓的真实缺陷/风险：
 *   ① **底座未立不许静默**：契约 §2 要求 `rikke.generate` 给可读失败理由 ——
 *      判据不只是 `ok:false`，还有「**一次都没调 horosa**」与「一个字节都没落盘」
 *      （否则界面会亮一张空日课卡）。
 *   ② **`callTool` 这条缝不在场时要可读失败**（Lead 明令）：旧面/假服务没有 `callTool` 时
 *      不许静默当成「今天没日课」。
 *   ③ **`hour` 必须是整数**：真机对 `'07:30'` 回 `tool.invalid_payload`（有真机捕获作证）。
 *   ④ **契约修订的加性字段：拿不到就省略键**（不写 null/空串）——`schedule` / `generatedAt` /
 *      `zone` / `huangli` 四个都按这条钉。
 *   ⑤ **`setTime` 是 compare-and-update**：`update` 必须收到**完整 observed record**，
 *      否则上游判 `schedule_conflict`（真机语义，不是我们自己的规矩）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createRikkeMethods } from '../../packages/xuanshu-host/lib/rikke/service.mjs'
import { fakeAgents, fakeHorosa, fakeSchedule, makeCtx, makeSandbox } from './lib/sandbox.mjs'
import { BIRTH, huangliFixture, writeBaseSnapshot } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 固定「现在」：2026-10-15 11:00 Asia/Shanghai（= 03:00Z），与真机捕获的日期同一天。 */
const NOW = () => new Date('2026-10-15T03:00:00.000Z')

/**
 * 一个完整的日课现场。
 * @param {{envelope?: object, horosa?: 'fake'|'missing'|'no-call-tool', catalog?: object[], withBase?: boolean, schedule?: boolean}} [parts]
 */
function scene(parts = {}) {
  const sandbox = makeSandbox('rikke')
  roots.push(sandbox)
  if (parts.withBase !== false) writeBaseSnapshot(sandbox.dataDir, BIRTH)

  let horosaService
  let horosa
  if (parts.horosa === 'missing') {
    horosa = undefined
  } else if (parts.horosa === 'no-call-tool') {
    horosaService = { baziBirth: async () => ({ phase: 'ok' }) }
    horosa = { service: horosaService, calls: [] }
  } else {
    horosa = fakeHorosa(parts.envelope ?? huangliFixture('huangli-ok'))
  }

  const schedule = parts.schedule === false ? undefined : fakeSchedule({ catalog: parts.catalog ?? [] })
  const agents = fakeAgents()
  const services = {}
  if (horosa !== undefined) services.xuanshuHorosa = horosa.service
  if (schedule !== undefined) services.schedule = schedule
  services.agents = agents

  const ctx = makeCtx({ services })
  const methods = createRikkeMethods(ctx, { dataDir: sandbox.dataDir, now: NOW })
  return { sandbox, ctx, methods, horosa, schedule, agents }
}

describe('票13 · rikke.status（只读取数 + 加性字段缺失即省略）', () => {
  it('从未生成：{date, exists:false}，且**不含** schedule / content / generatedAt / zone / huangli 键', async () => {
    const { methods } = scene()
    const status = await methods['rikke.status']({})
    expect(status).toEqual({ date: '2026-10-15', exists: false })
    for (const key of ['schedule', 'content', 'generatedAt', 'zone', 'huangli']) {
      expect(Object.prototype.hasOwnProperty.call(status, key), `${key} 缺失时该省略键，不该回 null/空串`).toBe(false)
    }
  })

  it('有日课定时任务时 schedule 在场：{time, timeZone, id}', async () => {
    const { methods } = scene({
      catalog: [{ id: 'sched-1', kind: 'daily', title: '日课', time: '07:30:00.000', timeZone: 'Asia/Shanghai', scheduledAt: '2026-10-16T07:30:00.000Z', sessionId: 'session-xs-rikke-x', status: 'active' }],
    })
    const status = await methods['rikke.status']({})
    expect(status.schedule).toEqual({ time: '07:30', timeZone: 'Asia/Shanghai', id: 'sched-1' })
  })

  it('底盘（时间基准）取自底座快照：zone 落在产物里，日期按它算', async () => {
    const { methods, sandbox } = scene()
    await methods['rikke.generate']({})
    expect(sandbox.readJson('rikke', '2026-10-15.json').zone).toBe('Asia/Shanghai')
  })

  it('显式要某一天：读那天的产物（没有就 exists:false）', async () => {
    const { methods } = scene()
    expect(await methods['rikke.status']({ date: '2026-01-01' })).toEqual({ date: '2026-01-01', exists: false })
  })

  it('产物 JSON 坏了 → exists:true + reason（不是假装没做过，也不是假装 ready）', async () => {
    const { sandbox, methods } = scene()
    sandbox.write('rikke/2026-10-15.json', '{ 坏掉的 JSON')
    const status = await methods['rikke.status']({})
    expect(status.exists).toBe(true)
    expect(status.reason).toMatch(/JSON/u)
    expect(Object.prototype.hasOwnProperty.call(status, 'content')).toBe(false)
  })
})

describe('票13 · rikke.generate（人点 [立即生成]）', () => {
  it('生成成功：内容三键 + 落盘 + horosa 入参（工具名/日期/整数小时/确认闸）', async () => {
    const { sandbox, methods, horosa } = scene()
    const result = await methods['rikke.generate']({})

    expect(result).toEqual({
      ok: true,
      date: '2026-10-15',
      content: {
        yi: '祭祀、祈福、求嗣、开光、出行、解除、上梁、入宅、移徙、安床、安门、纳财、纳畜、造畜稠',
        ji: '伐木、行丧、破土、嫁娶、安葬、开渠',
        liuri: '壬戌日 · 土',
      },
      // #24：人点生成也带 AI 段；这个现场没有 `ctx.llm` → 三态里的 failed（可读理由），
      // 骨架（上面三键）照旧 —— 「AI 不可得也照样出日课」。
      ai: { mode: 'failed', reason: 'ctx.llm 不可得（宿主没装 LLM 服务）' },
    })

    expect(horosa.calls).toHaveLength(1)
    expect(horosa.calls[0].name).toBe('horosa_cn_huangli')
    expect(horosa.calls[0].args.date).toBe('2026-10-15')
    expect(horosa.calls[0].args.hour).toBe(11) // 03:00Z 的 Asia/Shanghai 小时数 = 11
    expect(horosa.calls[0].args.agent_confirmed_settings).toBe(true)

    const record = sandbox.readJson('rikke', '2026-10-15.json')
    expect(record.schema).toBe('xuanshu/rikke@1')
    expect(record.date).toBe('2026-10-15')
    expect(record.generatedAt).toBe('2026-10-15T03:00:00.000Z')
    expect(record.zone).toBe('Asia/Shanghai')
    expect(record.content.liuri).toBe('壬戌日 · 土')
    expect(record.huangli).toEqual({ ok: true, version: '0.40.1', tool: 'huangli' })
    expect(record.manual).toBe(true)
    // 只有这一份日课产物（原子写不留 .tmp）。
    expect(sandbox.files().filter((file) => file.startsWith('rikke/'))).toEqual(['rikke/2026-10-15.json'])
  })

  it('生成之后 status 变 ready，并带上 generatedAt / zone / huangli（契约修订的加性字段）', async () => {
    const { methods } = scene()
    const generated = await methods['rikke.generate']({})
    const status = await methods['rikke.status']({})
    expect(status.date).toBe('2026-10-15')
    expect(status.exists).toBe(true)
    expect(status.content).toEqual(generated.content)
    expect(status.generatedAt).toBe('2026-10-15T03:00:00.000Z')
    expect(status.zone).toBe('Asia/Shanghai')
    expect(status.huangli).toEqual({ ok: true, version: '0.40.1', tool: 'huangli' })
  })

  it('底座未立 → {ok:false, reason 可读} + 不调 horosa + 不落盘（不静默）', async () => {
    const { sandbox, methods, horosa } = scene({ withBase: false })
    const result = await methods['rikke.generate']({})
    expect(result.ok).toBe(false)
    expect(result.date).toBe('2026-10-15')
    expect(result.reason).toMatch(/底座/u)
    expect(horosa.calls).toEqual([])
    expect(sandbox.files().filter((file) => file.startsWith('rikke/'))).toEqual([])
  })

  it('horosa 服务不可得 → 可读失败（指向 setup:xuanshu），不落盘', async () => {
    const { sandbox, methods } = scene({ horosa: 'missing' })
    const result = await methods['rikke.generate']({})
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/setup:xuanshu/u)
    expect(sandbox.files().filter((file) => file.startsWith('rikke/'))).toEqual([])
  })

  it('服务面没有 callTool（旧面）→ 同样可读失败，不静默', async () => {
    const { methods } = scene({ horosa: 'no-call-tool' })
    const result = await methods['rikke.generate']({})
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/callTool/u)
  })

  it('callTool 没走到信封（如冷启动期 ECONNREFUSED）→ 原话带给用户', async () => {
    const sandbox = makeSandbox('rikke-refused')
    roots.push(sandbox)
    writeBaseSnapshot(sandbox.dataDir, BIRTH)
    const ctx = makeCtx({
      services: {
        xuanshuHorosa: { callTool: async () => ({ ok: false, code: 'mcp-call-failed', detail: 'connect ECONNREFUSED 127.0.0.1:8765' }) },
        agents: fakeAgents(),
      },
    })
    const api = createRikkeMethods(ctx, { dataDir: sandbox.dataDir, now: NOW })
    const result = await api['rikke.generate']({})
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('mcp-call-failed')
    expect(result.reason).toContain('ECONNREFUSED')
    expect(sandbox.files().filter((file) => file.startsWith('rikke/'))).toEqual([])
  })

  it('真实失败信封（hour 传成字符串那一份）→ 可读失败，带上游 code', async () => {
    const { methods } = scene({ envelope: huangliFixture('huangli-invalid-payload') })
    const result = await methods['rikke.generate']({})
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('tool.invalid_payload')
  })
})

describe('票13 · rikke.setTime（compare-and-update）', () => {
  const TASK = {
    id: 'sched-9', kind: 'daily', title: '日课', time: '07:30:00.000', timeZone: 'Asia/Shanghai',
    scheduledAt: '2026-10-16T07:30:00.000Z', sessionId: 'session-xs-rikke-abc', status: 'active',
  }

  it('改时间成功：回 {time, timeZone}，且 update 收到**完整 observed record**', async () => {
    const { methods, schedule } = scene({ catalog: [TASK] })
    const result = await methods['rikke.setTime']({ time: '06:45' })
    expect(result).toEqual({ schedule: { time: '06:45', timeZone: 'Asia/Shanghai' } })
    const update = schedule.calls.find((call) => call.method === 'update')
    expect(update).toBeDefined()
    expect(update.request.sessionId).toBe('session-xs-rikke-abc')
    expect(update.request.id).toBe('sched-9')
    expect(update.request.expected.scheduledAt).toBe('2026-10-16T07:30:00.000Z')
    expect(update.request.expected.sessionId).toBe('session-xs-rikke-abc')
    expect(update.request.change).toEqual({ kind: 'daily', daily: { time: '06:45:00', time_zone: 'Asia/Shanghai' } })
  })

  it('没有那条任务 → 抛可读错误（写操作不许静默吞）', async () => {
    const { methods } = scene()
    await expect(methods['rikke.setTime']({ time: '06:45' })).rejects.toThrow(/日课/u)
  })

  it('时间格式不对 → 抛可读错误，且没有调 update', async () => {
    const { methods, schedule } = scene({ catalog: [TASK] })
    await expect(methods['rikke.setTime']({ time: '六点三刻' })).rejects.toThrow(/HH:mm/u)
    expect(schedule.calls.filter((call) => call.method === 'update')).toEqual([])
  })
})
