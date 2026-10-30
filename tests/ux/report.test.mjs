/**
 * 报告器（spec 003 · 票 02 / #49）：兑现率、字段齐全、人读顺序。
 *
 * 三分类 diff 的完整覆盖在票 05（#52）；本文件只管「没有上一次报告时不许硬算一个数」。
 */
import { describe, expect, it } from 'vitest'

import {
  buildReport,
  computeRate,
  assertRate,
  diffVerdicts,
  renderMarkdown,
  ReportError,
  verdictKey,
} from '../../scripts/ux/report.mjs'

const FACES = [
  { id: 'panel:overview', kind: 'panel', label: '自我总览' },
  { id: 'panel:workflow', kind: 'panel', label: '工作流门厅' },
]

const CRITERIA = {
  label: 'ux-v1',
  version: 'a'.repeat(64),
  criteria: [
    { id: 'T-001', statement: '不出现字面色值', severity: 'blocker', check: 'static' },
    { id: 'S-001', statement: '每个面都有三态', severity: 'major', check: 'static' },
  ],
}

function verdict(overrides = {}) {
  return {
    criterionId: 'T-001',
    family: 'T',
    face: 'panel:overview',
    severity: 'blocker',
    statement: '不出现字面色值',
    status: 'pass',
    message: '',
    evidence: [],
    ...overrides,
  }
}

describe('票 02 · 兑现率', () => {
  it('分子/分母都写出来；未采到与采集失败留在分母里（没验的不能算通过）', () => {
    const verdicts = [
      verdict(),
      verdict({ face: 'panel:workflow', status: 'fail', message: '红' }),
      verdict({ criterionId: 'S-001', severity: 'major', status: 'not-collected' }),
      verdict({ criterionId: 'S-001', face: 'panel:workflow', severity: 'major', status: 'human-only' }),
    ]
    expect(computeRate(verdicts)).toEqual({ passed: 1, applicable: 3, value: 0.3333 })
  })

  it('分母为 0 时不算出一个假数字（value=null），但分子分母仍在', () => {
    const rate = computeRate([verdict({ status: 'human-only' })])
    expect(rate).toEqual({ passed: 0, applicable: 0, value: null })
  })

  it('缺分子 / 缺分母 / 缺判据集版本号 → 这个数字不接受', () => {
    const base = { rate: { passed: 1, applicable: 2, value: 0.5 }, criteria: { version: 'v' } }
    expect(() => assertRate(base)).not.toThrow()
    expect(() => assertRate({ ...base, rate: { applicable: 2 } })).toThrow(/分子/)
    expect(() => assertRate({ ...base, rate: { passed: 1 } })).toThrow(/分母/)
    expect(() => assertRate({ ...base, criteria: {} })).toThrow(/版本号/)
    expect(() => assertRate({ criteria: { version: 'v' } })).toThrow(ReportError)
  })

  it('buildReport 产出的报告必须自带版本号与分子分母', () => {
    const report = buildReport({
      criteria: CRITERIA,
      faces: FACES,
      verdicts: [verdict(), verdict({ face: 'panel:workflow', status: 'fail', message: '红' })],
      generatedAt: '2026-10-30T00:00:00.000Z',
    })
    expect(report.criteria.version).toBe(CRITERIA.version)
    expect(report.rate).toEqual({ passed: 1, applicable: 2, value: 0.5 })
    expect(report.findings).toEqual([])
  })

  it('判据集没有版本号 → 报告造不出来（口径不明 = 不可比）', () => {
    expect(() =>
      buildReport({ criteria: { ...CRITERIA, version: '' }, faces: FACES, verdicts: [], generatedAt: 'now' }),
    ).toThrow(ReportError)
  })
})

describe('票 02 · 人读报告的顺序固定', () => {
  it('章节顺序 = 回退 → blocker → 新增 → 已修 → human-only', () => {
    const report = buildReport({
      criteria: CRITERIA,
      faces: FACES,
      verdicts: [
        verdict({ status: 'fail', message: '红', evidence: [{ file: 'a.tsx', line: 3, detail: '#fff' }] }),
        verdict({ criterionId: 'S-001', severity: 'major', status: 'human-only', message: '要人看' }),
      ],
      generatedAt: '2026-10-30T00:00:00.000Z',
    })
    const markdown = renderMarkdown(report)
    const positions = ['## 1. 回退', '## 2. blocker', '## 3. 新增', '## 4. 已修', '## 5. human-only'].map((heading) =>
      markdown.indexOf(heading),
    )
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(positions)
    // 命中位置（去重后）也要出现在人读报告里：人三秒就能核到源码行
    expect(markdown).toContain('a.tsx:3')
    expect(markdown).toContain('兑现率')
    expect(markdown).toContain('ux-v1')
  })

  it('blocker 按界面面分组，不同面不混排', () => {
    const report = buildReport({
      criteria: CRITERIA,
      faces: FACES,
      verdicts: [
        verdict({ status: 'fail', message: '甲' }),
        verdict({ face: 'panel:workflow', status: 'fail', message: '乙' }),
      ],
      generatedAt: 'now',
    })
    const markdown = renderMarkdown(report)
    expect(markdown).toContain('### panel:overview')
    expect(markdown).toContain('### panel:workflow')
  })
})

describe('票 02 · 没有上一次报告时不硬算 diff', () => {
  it('previous=null → 不可比，并说明为什么', () => {
    const report = buildReport({ criteria: CRITERIA, faces: FACES, verdicts: [verdict()], generatedAt: 'now' })
    expect(report.diff.comparable).toBe(false)
    expect(report.diff.reason).toContain('第一次')
    expect(report.groups.added).toEqual([])
  })

  it('判据集版本不同 → 不可比（数字口径变了）', () => {
    const previous = { criteria: { version: 'b'.repeat(64) }, verdicts: [verdict()] }
    const report = buildReport({ criteria: CRITERIA, faces: FACES, verdicts: [verdict()], previous, generatedAt: 'now' })
    expect(report.diff.comparable).toBe(false)
    expect(report.diff.reason).toContain('不可比')
  })

  it('同一版本时做三分类（票 05 会在此基础上补排序与「上次有、这次没有」）', () => {
    const previous = {
      criteria: { version: CRITERIA.version },
      verdicts: [
        verdict({ status: 'pass' }),
        verdict({ face: 'panel:workflow', status: 'fail' }),
      ],
    }
    const current = [
      verdict({ status: 'fail' }), // 上次通过、这次失败 → 回退
      verdict({ face: 'panel:workflow', status: 'pass' }), // 上次失败、这次通过 → 已修
      verdict({ criterionId: 'S-001', severity: 'major', status: 'fail' }), // 上次没有 → 新增
    ]
    const diff = diffVerdicts(previous.verdicts, current)
    expect(diff.regressions.map(verdictKey)).toEqual([verdictKey(current[0])])
    expect(diff.fixed.map(verdictKey)).toEqual([verdictKey(current[1])])
    expect(diff.added.map(verdictKey)).toEqual([verdictKey(current[2])])
  })
})
