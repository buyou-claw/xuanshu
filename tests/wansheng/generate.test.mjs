/**
 * #25 · 晚省生成（冻结契约 §1）：确定性事实 → 原子写 `<dataDir>/wansheng/<date>.json`。
 *
 * 这一组钉四件事：
 *   1. 产物 schema `xuanshu/wansheng@1`、`date` / `generatedAt` / `zone` / `missed` / `facts` / `notes` 逐字；
 *   2. **零模型调用**：晚省只摆事实，不生成结论（`fakeLlm.calls` 必须为空）；
 *   3. 原子写：不留 `.tmp`（半份 JSON 会被读面当成 error，用户看到的是「产物消失」）；
 *   4. 读面三态：坏 schema / 缺 facts / date 与文件名不符 → `error`，不假装有内容。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { fakeLlm } from '../digao/lib/sandbox.mjs'
import { generateWansheng } from '../../packages/xuanshu-host/lib/wansheng/generate.mjs'
import { readWansheng, wanshengFile } from '../../packages/xuanshu-host/lib/wansheng/store.mjs'
import { writeWorkflow } from '../../packages/xuanshu-host/lib/workflow/store.mjs'
import {
  fakeSessionQuery, fakeWorkspaceRegistry, makeWanshengSandbox, writeConsultSession,
} from './lib/sandbox.mjs'

const boxes = []
afterEach(() => boxes.splice(0).forEach((box) => box.cleanup()))

const DATE = '2026-10-15'
const ZONE = 'Asia/Shanghai'
const AT = new Date('2026-10-15T13:30:00.000Z')

function scene() {
  const box = makeWanshengSandbox('wansheng-generate')
  boxes.push(box)
  writeConsultSession(box.dataDir, { sessionId: 'session-xs-consult-a', createdAt: '2026-10-14T17:00:00.000Z', title: '先收口' })
  const registry = fakeWorkspaceRegistry([
    { id: 'w1', path: '/work/xuanshu', title: 'XuanShu', sessionIds: ['s-a'], createdAt: '2026-10-01T00:00:00.000Z' },
  ])
  const workflowId = 'session-xs-workflow-evening'
  writeWorkflow(box.dataDir, {
    schema: 'xuanshu/workflow@1', id: workflowId, sessionId: workflowId,
    name: '晚省工作流', createdAt: '2026-10-14T17:00:00.000Z',
  })
  const query = fakeSessionQuery({ headers: {
    's-a': { createdAt: Date.parse('2026-10-14T17:00:00.000Z') },
    [workflowId]: { createdAt: Date.parse('2026-10-14T17:00:00.000Z') },
  } })
  const llm = fakeLlm()
  const ctx = { workspaceRegistry: registry.service, sessionQuery: query.service, llm }
  return { box, ctx, llm }
}

describe('#25 · 晚省生成：确定性事实 + 原子写', () => {
  it('落盘形状逐字（schema/date/generatedAt/zone/missed/facts/notes），且**一次模型都不调**', async () => {
    const { box, ctx, llm } = scene()
    const generated = await generateWansheng({ ctx, dataDir: box.dataDir, date: DATE, zone: ZONE, at: AT })

    expect(generated.ok).toBe(true)
    expect(generated.record).toEqual({
      schema: 'xuanshu/wansheng@1',
      date: DATE,
      generatedAt: '2026-10-15T13:30:00.000Z',
      zone: ZONE,
      missed: false,
      facts: {
        consultSessions: {
          count: 1,
          items: [{ sessionId: 'session-xs-consult-a', title: '先收口' }],
        },
        activeWorkspaces: [{ id: 'w1', title: 'XuanShu', sessionCount: 1, lastActiveAt: '2026-10-14T17:00:00.000Z' }],
        activeWorkflows: [{ id: 'session-xs-workflow-evening', title: '晚省工作流', sessionCount: 1, lastActiveAt: '2026-10-14T17:00:00.000Z' }],
      },
      notes: [],
    })
    expect(box.readJson('wansheng', `${DATE}.json`)).toEqual(generated.record)
    expect(wanshengFile(box.dataDir, DATE)).toBe(box.path('wansheng', `${DATE}.json`))
    // 原子写：不留半份 .tmp（现场里的 consult 旁挂清单不算）。
    expect(box.files().filter((file) => file.endsWith('.tmp'))).toEqual([])
    expect(box.exists('wansheng', `${DATE}.json`)).toBe(true)
    // 晚省不调模型（晚省只摆事实、不出结论）。
    expect(llm.calls).toEqual([])
  })

  it('补生成的产物带 missed:true（同一份形状，只差这一位）', async () => {
    const { box, ctx } = scene()
    const generated = await generateWansheng({ ctx, dataDir: box.dataDir, date: DATE, zone: ZONE, at: AT, missed: true })
    expect(generated.ok).toBe(true)
    expect(generated.record.missed).toBe(true)
    expect(generated.record.facts.consultSessions.count).toBe(1)
  })

  it('来源全拿不到时仍是一份诚实的空账：facts 是空对象 + notes 说明（不编 0 个项目）', async () => {
    const box = makeWanshengSandbox('wansheng-empty')
    boxes.push(box)
    const generated = await generateWansheng({ ctx: {}, dataDir: box.dataDir, date: DATE, zone: ZONE, at: AT })
    expect(generated.ok).toBe(true)
    expect(generated.record.facts).toEqual({ consultSessions: { count: 0, items: [] }, activeWorkflows: [] })
    expect(generated.record.notes.join('\n')).toMatch(/workspaceRegistry|工作区/u)
  })
})

describe('#25 · 晚省读面：坏东西不装成内容', () => {
  it('没生成过 → empty；写坏了 / schema 不认识 / 缺 facts / date 不符 → error + 可读理由', async () => {
    const box = makeWanshengSandbox('wansheng-read')
    boxes.push(box)
    expect(readWansheng(box.dataDir, DATE)).toEqual({ state: 'empty', record: null, reason: null })

    box.write(`wansheng/${DATE}.json`, 'not json')
    expect(readWansheng(box.dataDir, DATE).state).toBe('error')

    box.write(`wansheng/${DATE}.json`, '{"schema":"xuanshu/wansheng@0","date":"2026-10-15","facts":{}}')
    expect(readWansheng(box.dataDir, DATE).reason).toMatch(/schema/u)

    box.write(`wansheng/${DATE}.json`, '{"schema":"xuanshu/wansheng@1","date":"2026-10-14","facts":{}}')
    expect(readWansheng(box.dataDir, DATE).reason).toMatch(/date/u)

    box.write(`wansheng/${DATE}.json`, '{"schema":"xuanshu/wansheng@1","date":"2026-10-15"}')
    expect(readWansheng(box.dataDir, DATE).reason).toMatch(/facts/u)

    box.write(`wansheng/${DATE}.json`, '{"schema":"xuanshu/wansheng@1","date":"2026-10-15","facts":{}}')
    expect(readWansheng(box.dataDir, DATE).state).toBe('ready')
  })
})
