/**
 * 判定引擎（spec 003 · 票 02 / #49）——**唯一判定点**的穷尽测试。
 *
 * 覆盖声明（spec §Testing Decisions）：判定引擎是穷尽测试对象。这里钉住的是
 * 「给定判据与证据，结果必须可预期」，不钉「采集器怎么遍历文件」。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { JudgeError, run, VERDICT_STATUSES } from '../../scripts/ux/judge.mjs'
import { computeRate } from '../../scripts/ux/report.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')

const FACES = [
  { id: 'panel:overview', kind: 'panel', label: '自我总览' },
  { id: 'panel:workflow', kind: 'panel', label: '工作流门厅' },
  { id: 'slot:shell.overlay#xuanshu-cang-drawer', kind: 'parasitic', label: '藏库抽屉' },
  { id: 'command:多模型', kind: 'command', label: '命令·多 AI 合参' },
]

function criterion(overrides = {}) {
  return {
    id: 'T-001',
    family: 'T',
    statement: '样式里不出现字面色值',
    check: 'static',
    evidence: 'file-line',
    severity: 'blocker',
    appliesTo: { kind: 'all' },
    source: { file: 'x', anchor: 'y' },
    humanReason: null,
    tombstone: false,
    ...overrides,
  }
}

function criteriaOf(...rules) {
  return { label: 'ux-v1', version: 'v-test', criteria: rules }
}

describe('票 02 · 判定引擎是纯函数', () => {
  it('源码里没有文件系统 / 时钟 / 子进程依赖（纯函数不是靠自觉）', () => {
    const source = readFileSync(join(REPO_ROOT, 'scripts/ux/judge.mjs'), 'utf8')
    expect(source).not.toMatch(/from 'node:fs'/)
    expect(source).not.toMatch(/from 'node:child_process'/)
    expect(source).not.toMatch(/from 'node:http'/)
    expect(source).not.toMatch(/Date\.now\(/)
    expect(source).not.toMatch(/new Date\(/)
  })

  it('同一份输入两跑结果完全相同（深比较）', () => {
    const criteria = criteriaOf(criterion())
    const evidence = [
      { criterionId: 'T-001', face: 'panel:overview', status: 'observed', facts: { occurrences: [] }, evidence: [] },
      { criterionId: 'T-001', face: 'panel:workflow', status: 'observed', facts: { occurrences: [{ file: 'a.tsx', line: 1, literal: '#fff' }] }, evidence: [{ file: 'a.tsx', line: 1, detail: '#fff' }] },
    ]
    const first = run({ criteria, evidence, faces: FACES })
    const second = run({ criteria, evidence, faces: FACES })
    expect(second).toEqual(first)
    expect(first.verdicts).toHaveLength(4)
  })
})

describe('票 02 · 未采到 ≠ 通过', () => {
  it('没有证据的界面面是 `not-collected`，不进 pass 计数，也不从分母里消失', () => {
    const criteria = criteriaOf(criterion())
    const evidence = [
      { criterionId: 'T-001', face: 'panel:overview', status: 'observed', facts: { occurrences: [] }, evidence: [] },
    ]
    const { verdicts, counts } = run({ criteria, evidence, faces: FACES })
    expect(counts.pass).toBe(1)
    expect(counts['not-collected']).toBe(3)
    const rate = computeRate(verdicts)
    expect(rate).toEqual({ passed: 1, applicable: 4, value: 0.25 })
  })

  it('采集失败是独立状态：既不算过，也不算「未采到」', () => {
    const criteria = criteriaOf(criterion())
    const evidence = [
      { criterionId: 'T-001', face: 'panel:overview', status: 'collection-failed', reason: '读不到文件', facts: null, evidence: [] },
    ]
    const { verdicts } = run({ criteria, evidence, faces: FACES })
    const failed = verdicts.find((verdict) => verdict.face === 'panel:overview')
    expect(failed.status).toBe('collection-failed')
    expect(failed.message).toContain('读不到文件')
    expect(computeRate(verdicts).passed).toBe(0)
  })

  it('未采到的界面面在报告里必须能说出「为什么没采到」，不是一句空白', () => {
    const { verdicts } = run({ criteria: criteriaOf(criterion()), evidence: [], faces: FACES })
    for (const verdict of verdicts) {
      expect(verdict.status).toBe('not-collected')
      expect(verdict.message.length).toBeGreaterThan(0)
    }
  })
})

describe('票 02 · 三档严重级都走同一条判定路径', () => {
  it('blocker / major / minor 各自原样带进 verdict，不改判定只改排序依据', () => {
    const criteria = criteriaOf(
      criterion({ id: 'T-001', severity: 'blocker' }),
      criterion({ id: 'T-002', severity: 'major' }),
      criterion({ id: 'T-003', severity: 'minor' }),
    )
    const evidence = [
      { criterionId: 'T-001', face: 'panel:overview', status: 'observed', facts: { occurrences: [] }, evidence: [] },
      { criterionId: 'T-002', face: 'panel:overview', status: 'observed', facts: { occurrences: [] }, evidence: [] },
      { criterionId: 'T-003', face: 'panel:overview', status: 'observed', facts: { occurrences: [] }, evidence: [] },
    ]
    const { verdicts } = run({
      criteria,
      evidence,
      faces: [FACES[0]],
      assertions: {
        'T-001': () => ({ pass: false, message: 'blocker 红' }),
        'T-002': () => ({ pass: false, message: 'major 红' }),
        'T-003': () => ({ pass: true, message: '' }),
      },
    })
    expect(verdicts.map((verdict) => verdict.severity)).toEqual(['blocker', 'major', 'minor'])
    expect(verdicts.map((verdict) => verdict.status)).toEqual(['fail', 'fail', 'pass'])
  })
})

describe('票 02 · 判定器拒绝「说不清」的输入', () => {
  it('机器判据缺谓词 → 报错并点名是哪条（不许静默当成通过）', () => {
    expect(() => run({ criteria: criteriaOf(criterion()), evidence: [], faces: FACES, assertions: {} })).toThrow(JudgeError)
    expect(() => run({ criteria: criteriaOf(criterion()), evidence: [], faces: FACES, assertions: {} })).toThrow(/T-001/)
  })

  it('同一 (判据, 面) 有两份证据 → 报错（歧义不做判定）', () => {
    const evidence = [
      { criterionId: 'T-001', face: 'panel:overview', status: 'observed', facts: {}, evidence: [] },
      { criterionId: 'T-001', face: 'panel:overview', status: 'observed', facts: {}, evidence: [] },
    ]
    expect(() => run({ criteria: criteriaOf(criterion()), evidence, faces: FACES })).toThrow(/证据重复/)
  })

  it('谓词不返回布尔 → 报错（不允许 undefined 被当成通过）', () => {
    const evidence = [
      { criterionId: 'T-001', face: 'panel:overview', status: 'observed', facts: {}, evidence: [] },
    ]
    expect(() =>
      run({ criteria: criteriaOf(criterion()), evidence, faces: [FACES[0]], assertions: { 'T-001': () => ({}) } }),
    ).toThrow(/pass: boolean/)
  })

  it('human-only 不进机器判定，也不进兑现率分母', () => {
    const criteria = criteriaOf(
      criterion({ id: 'T-001', check: 'human-only', humanReason: '审美判断，机器给不出可复现阈值' }),
      criterion({ id: 'T-002' }),
    )
    const evidence = [
      { criterionId: 'T-002', face: 'panel:overview', status: 'observed', facts: { occurrences: [] }, evidence: [] },
    ]
    const { verdicts } = run({
      criteria,
      evidence,
      faces: [FACES[0]],
      assertions: { 'T-002': () => ({ pass: true }) },
    })
    const human = verdicts.find((verdict) => verdict.criterionId === 'T-001')
    expect(human.status).toBe('human-only')
    expect(human.message).toContain('审美判断')
    const rate = computeRate(verdicts)
    expect(rate.applicable, 'human-only 不计入分母').toBe(1)
    expect(rate.passed).toBe(1)
  })

  it('墓碑判据不参与判定（下架不删条目）', () => {
    const criteria = criteriaOf(criterion({ tombstone: true }))
    const { verdicts } = run({ criteria, evidence: [], faces: FACES })
    expect(verdicts).toHaveLength(0)
  })

  it('verdict 状态集合是闭集：只有五个状态，没有「拿不准」', () => {
    expect(VERDICT_STATUSES).toEqual(['pass', 'fail', 'not-collected', 'collection-failed', 'human-only'])
  })
})

describe('票 02 · 适用范围决定分母', () => {
  it('appliesTo.kind=panel 只算面板面；ids 只算点名的面', () => {
    const panelOnly = run({ criteria: criteriaOf(criterion({ appliesTo: { kind: 'panel' } })), evidence: [], faces: FACES })
    expect(panelOnly.verdicts.map((verdict) => verdict.face)).toEqual(['panel:overview', 'panel:workflow'])
    const named = run({
      criteria: criteriaOf(criterion({ appliesTo: { kind: 'ids', ids: ['command:多模型'] } })),
      evidence: [],
      faces: FACES,
    })
    expect(named.verdicts.map((verdict) => verdict.face)).toEqual(['command:多模型'])
  })
})
