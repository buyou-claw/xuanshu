/**
 * #25 · 晚省四个 RPC（契约 §1）：`wansheng.status / read / generate / setTime`。
 *
 * 加性纪律（与 `rikke.status` 同款）：**拿不到就省略键**，不写 false / 0 冒充已知。
 * 这一组钉：
 *   1. `status` 给 `{date, exists}` + ready 时的事实 / 生成时刻 / missed + `schedule`；
 *   2. `unread` / `notify` 只数**晚省**的账行（日课那条不许混进来）；
 *   3. `read` 缺产物 → `exists:false`；坏产物 → `reason`（不假装有内容）；
 *   4. `generate` 人点 → 产物 + 账行 skipped；`manual:false` 有壳时 delivered。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createWanshengMethods } from '../../packages/xuanshu-host/lib/wansheng/service.mjs'
import { WANSHENG_TASK_TITLE } from '../../packages/xuanshu-host/lib/rikke/daily-tasks.mjs'
import { appendTraffic, buildTrafficEntry, readTraffic } from '../../packages/xuanshu-host/lib/notify/traffic.mjs'
import { writeRikke } from '../../packages/xuanshu-host/lib/rikke/store.mjs'
import { writeWansheng } from '../../packages/xuanshu-host/lib/wansheng/store.mjs'
import { makeWanshengSandbox, writeConsultSession } from './lib/sandbox.mjs'
import { fakeAgents, fakeLlm, fakeSchedule, makeCtx } from '../digao/lib/sandbox.mjs'

const boxes = []
afterEach(() => boxes.splice(0).forEach((box) => box.cleanup()))

const TZ = 'Asia/Shanghai'
const NOW = () => new Date('2026-10-15T13:30:00.000Z')
const TODAY = '2026-10-15'

function scene({ catalog } = {}) {
  const box = makeWanshengSandbox('wansheng-service')
  boxes.push(box)
  const schedule = fakeSchedule(catalog === undefined ? {} : { catalog })
  const agents = fakeAgents()
  const llm = fakeLlm()
  const ctx = makeCtx({ services: { schedule, agents, llm } })
  const methods = createWanshengMethods(ctx, { dataDir: box.dataDir, now: NOW })
  return { box, ctx, schedule, agents, llm, methods }
}

/** 一条合法的晚省产物（直接按 schema 落盘，验读面）。 */
function seed(box, over = {}) {
  writeWansheng(box.dataDir, {
    schema: 'xuanshu/wansheng@1',
    date: TODAY,
    generatedAt: '2026-10-15T13:30:00.000Z',
    zone: TZ,
    missed: false,
    facts: { consultSessions: { count: 2, items: [{ sessionId: 'session-xs-consult-a', title: '先收口' }] } },
    notes: [],
    ...over,
  })
}

describe('#25 · wansheng.status / read（拿不到就省略键）', () => {
  it('今天还没有晚省 → exists:false；schedule 来自那条 daily 任务', async () => {
    const { methods } = scene({
      catalog: [{
        id: 'sched-w', kind: 'daily', title: WANSHENG_TASK_TITLE, time: '21:30:00.000', timeZone: TZ,
        scheduledAt: '2026-10-16T13:30:00.000Z', sessionId: 'session-xs-wansheng-x', status: 'active',
      }],
    })
    const status = await methods['wansheng.status']({})
    expect(status.date).toBe(TODAY)
    expect(status.exists).toBe(false)
    expect(status.schedule).toEqual({ time: '21:30', timeZone: TZ, id: 'sched-w' })
    // 没产物 → missed / facts / generatedAt 都**不编**。
    expect(Object.hasOwn(status, 'missed')).toBe(false)
    expect(Object.hasOwn(status, 'facts')).toBe(false)
    expect(Object.hasOwn(status, 'generatedAt')).toBe(false)
    // 账本不存在 → unread 整键省略（不是 0）。
    expect(Object.hasOwn(status, 'unread')).toBe(false)

    const read = await methods['wansheng.read']({})
    expect(read).toEqual({ date: TODAY, exists: false })
  })

  it('产物在 → facts / generatedAt / missed 原样回；坏产物给 reason 不假装有内容', async () => {
    const { box, methods } = scene()
    seed(box)
    const status = await methods['wansheng.status']({})
    expect(status).toMatchObject({
      date: TODAY,
      exists: true,
      missed: false,
      generatedAt: '2026-10-15T13:30:00.000Z',
      zone: TZ,
      facts: { consultSessions: { count: 2, items: [{ sessionId: 'session-xs-consult-a', title: '先收口' }] } },
    })
    const read = await methods['wansheng.read']({})
    expect(read.exists).toBe(true)
    expect(read.record.schema).toBe('xuanshu/wansheng@1')

    box.write(`wansheng/${TODAY}.json`, '{"schema":"xuanshu/wansheng@0","date":"2026-10-15","facts":{}}')
    expect((await methods['wansheng.status']({})).reason).toMatch(/schema/u)
    expect((await methods['wansheng.read']({})).reason).toMatch(/schema/u)
  })

  it('unread / notify 只数晚省的账行（日课那条不混进来）', async () => {
    const { box, methods } = scene()
    seed(box)
    appendTraffic(box.dataDir, buildTrafficEntry({
      kind: 'rikke',
      date: TODAY,
      occurrenceAt: '2026-10-14T23:30:00.000Z',
      artifactPath: `rikke/${TODAY}.json`,
      notify: { status: 'delivered', reason: null },
      at: '2026-10-15T00:00:00.000Z',
    }))
    appendTraffic(box.dataDir, buildTrafficEntry({
      kind: 'wansheng',
      date: TODAY,
      occurrenceAt: '2026-10-15T13:30:00.000Z',
      artifactPath: `wansheng/${TODAY}.json`,
      notify: { status: 'failed', reason: 'permission-denied' },
      at: '2026-10-15T13:31:00.000Z',
    }))
    const status = await methods['wansheng.status']({})
    expect(status.unread).toBe(0) // 晚省这条是 failed，不算未读
    // #40：权限缺失在账里可区分 —— 人话原因（含去哪开）+ `reasonCode` 机器码，不再只落英文原串。
    expect(status.notify).toMatchObject({ status: 'failed', at: '2026-10-15T13:31:00.000Z', reasonCode: 'permission-denied' })
    expect(status.notify.reason).toMatch(/权限缺失/u)
    expect(status.notify.reason).toMatch(/通知权限/u)
  })
})

describe('#25 · wansheng.generate（人点 / 定时同一份链）', () => {
  it('人点 → 确定性产物（零 LLM）+ 账行 skipped；返回 record 可读', async () => {
    const { box, methods, llm } = scene()
    writeConsultSession(box.dataDir, { sessionId: 'session-xs-consult-a', createdAt: '2026-10-15T02:00:00.000Z', title: '先收口' })
    const generated = await methods['wansheng.generate']({})
    expect(generated.ok).toBe(true)
    expect(generated.record.schema).toBe('xuanshu/wansheng@1')
    expect(generated.record.facts.consultSessions.count).toBe(1)
    expect(box.exists('wansheng', `${TODAY}.json`)).toBe(true)
    expect(llm.calls).toEqual([])

    const row = readTraffic(box.dataDir).entries[0]
    expect(row).toMatchObject({ kind: 'wansheng', date: TODAY, notify: { status: 'skipped' } })
    expect(row.notify.reason).toMatch(/人点/u)
  })

  it('manual:false 且没有壳 → skipped（no-shell），产物照写', async () => {
    const { box, methods } = scene()
    const generated = await methods['wansheng.generate']({ manual: false })
    expect(generated.ok).toBe(true)
    const row = readTraffic(box.dataDir).entries[0]
    expect(row.notify.status).toBe('skipped')
    expect(row.notify.reason).toMatch(/没有桌面壳/u)
  })

  it('晚省不读日课产物里的内容、也不写日课：两条链互不覆盖', async () => {
    const { box, methods } = scene()
    writeRikke(box.dataDir, {
      schema: 'xuanshu/rikke@1',
      date: TODAY,
      generatedAt: '2026-10-15T00:00:00.000Z',
      zone: TZ,
      content: { yi: '祭祀', ji: '动土', liuri: '甲子日 · 水' },
      manual: false,
    })
    await methods['wansheng.generate']({})
    // 晚省事实里会记「日课几点生成」（事实），但日课产物本身一个字不改。
    expect(box.readJson('rikke', `${TODAY}.json`).content).toEqual({ yi: '祭祀', ji: '动土', liuri: '甲子日 · 水' })
    expect(box.readJson('wansheng', `${TODAY}.json`).facts.rikke).toEqual({ generatedAt: '2026-10-15T00:00:00.000Z' })
  })
})
