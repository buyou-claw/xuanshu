/**
 * 票 05（#52）· 报告 diff 与排序：新增 / 已修 / 回退（+ 消失 / 一直红）。
 *
 * 这一份钉住五件事：
 *   1. 三分类对：上次没有这次有 = 新增、上次红这次绿 = 已修、上次绿这次红 = 回退；
 *   2. 两种「数量对不上」：`disappeared`（不许静默消失）与 `stillFailing`（一直红不算新增）；
 *   3. **「未采到 → 绿」不算修好**——那是采集器补上了，界面没变好；
 *   4. 人读顺序固定：回退 → blocker → 新增 → 已修 → human-only，回退带 🔴 且排最前；
 *   5. 跨判据版本 → 「不可比」，一个桶都不填；diff 是纯函数，读上一次报告只在 report.mjs。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildDiff,
  compareCriteria,
  DiffError,
  diffVerdicts,
  transitionReason,
  verdictKey,
} from '../../scripts/ux/diff.mjs'
import {
  buildReport,
  HUMAN_SECTION_ORDER,
  readPreviousReport,
  renderMarkdown,
  REPORT_SCHEMA,
} from '../../scripts/ux/report.mjs'
import { runVerifyUx } from '../../scripts/verify-ux.mjs'
import { faceManifest } from '../assembly/lib/panel-surface.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const VERSION = 'a'.repeat(64)

const FACES = [
  { id: 'panel:ask', kind: 'panel', label: '问事' },
  { id: 'panel:consent', kind: 'panel', label: '授权' },
  { id: 'panel:history', kind: 'panel', label: '历史' },
  { id: 'panel:overview', kind: 'panel', label: '自我总览' },
  { id: 'panel:settings', kind: 'panel', label: '设置' },
  { id: 'panel:today', kind: 'panel', label: '今天' },
  { id: 'panel:workflow', kind: 'panel', label: '工作流门厅' },
]

const CRITERIA = {
  label: 'ux-v1',
  version: VERSION,
  criteria: [
    { id: 'T-001', statement: '不出现字面色值', severity: 'blocker', check: 'static' },
    { id: 'S-001', statement: '每个面都有三态', severity: 'major', check: 'static' },
  ],
}

/** 一条 verdict；默认是「T-001 / panel:overview / 绿」。 */
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

/** 人读的身份（断言里比它，比比整对象更好读）。 */
function idOf(item) {
  const entry = item?.verdict ?? item
  return `${entry.face}/${entry.criterionId}`
}

function facesOf(list) {
  return list.map(idOf)
}

/** 两组 verdict 的固定剧本：五种情形一次全出现（新/修/退/消失/一直红/迁移）。 */
const PREVIOUS_SCRIPT = [
  verdict({ face: 'panel:overview', status: 'pass' }), // → 回退
  verdict({ face: 'panel:workflow', status: 'fail', message: '上次红' }), // → 已修
  verdict({ face: 'panel:settings', status: 'pass' }), // → 没变（只计数）
  verdict({ face: 'panel:consent', status: 'fail', message: '上次红' }), // → 消失
  verdict({ face: 'panel:history', status: 'fail', message: '一直红' }), // → 一直红
  verdict({ face: 'panel:today', status: 'not-collected', message: '上次没采到' }), // → 状态迁移
]
const CURRENT_SCRIPT = [
  verdict({ face: 'panel:overview', status: 'fail', message: '这次红' }), // 回退
  verdict({ face: 'panel:workflow', status: 'pass' }), // 已修
  verdict({ face: 'panel:settings', status: 'pass' }), // 没变
  verdict({ face: 'panel:history', status: 'fail', message: '一直红' }), // 一直红
  verdict({ face: 'panel:today', status: 'pass' }), // 未采到 → 绿（不算修好）
  verdict({ face: 'panel:ask', status: 'fail', message: '这次才出现的面' }), // 新增
]

describe('票 05 · 四种情形都分对', () => {
  it('新增 / 已修 / 回退 / 消失 各就各位（含「上次没有这次有」与「上次有这次没有」）', () => {
    const diff = diffVerdicts(PREVIOUS_SCRIPT, CURRENT_SCRIPT)

    // 上次没有、这次有
    expect(facesOf(diff.added)).toEqual(['panel:ask/T-001'])
    // 上次红、这次绿 —— 唯一的「修好」
    expect(facesOf(diff.fixed)).toEqual(['panel:workflow/T-001'])
    // 上次绿、这次红 —— 唯一的「回退」
    expect(facesOf(diff.regressions)).toEqual(['panel:overview/T-001'])
    // 上次有、这次没有 —— 不许静默消失
    expect(facesOf(diff.disappeared)).toEqual(['panel:consent/T-001'])
    // 两次都红 —— 不算新增，也不算回退
    expect(facesOf(diff.stillFailing)).toEqual(['panel:history/T-001'])
    // 未采到 → 绿：迁移，不是修好
    expect(facesOf(diff.transitions)).toEqual(['panel:today/T-001'])
    expect(diff.transitions[0]).toMatchObject({ from: 'not-collected', to: 'pass' })
    // 两次都绿：只计数，不占版面
    expect(diff.unchanged).toBe(1)
  })

  it('每个身份恰好落进一个桶（没有哪个键悄悄消失）', () => {
    const diff = diffVerdicts(PREVIOUS_SCRIPT, CURRENT_SCRIPT)
    const union = new Set([...PREVIOUS_SCRIPT, ...CURRENT_SCRIPT].map(verdictKey))
    const accounted =
      diff.added.length
      + diff.fixed.length
      + diff.regressions.length
      + diff.disappeared.length
      + diff.stillFailing.length
      + diff.transitions.length
      + diff.unchanged
    expect(accounted).toBe(union.size)
    expect(union.size).toBe(7)
  })

  it('整批判据一起出现时，added 是「面 × 新判据」的全集（不是一条）', () => {
    const previous = [verdict(), verdict({ face: 'panel:workflow' })]
    const current = [
      ...previous,
      verdict({ criterionId: 'S-001', severity: 'major' }),
      verdict({ criterionId: 'S-001', severity: 'major', face: 'panel:workflow' }),
    ]
    const diff = diffVerdicts(previous, current)
    expect(facesOf(diff.added)).toEqual(['panel:overview/S-001', 'panel:workflow/S-001'])
    expect(diff.fixed).toEqual([])
    expect(diff.regressions).toEqual([])
  })

  it('同一个身份换了证据仍然是同一条债务：不产生新增 / 消失', () => {
    const previous = [verdict({ face: 'panel:overview', status: 'fail', evidence: [{ file: 'a.tsx', line: 3 }] })]
    const current = [verdict({ face: 'panel:overview', status: 'fail', evidence: [{ file: 'b.tsx', line: 9 }] })]
    const diff = diffVerdicts(previous, current)
    expect(diff.added).toEqual([])
    expect(diff.disappeared).toEqual([])
    expect(facesOf(diff.stillFailing)).toEqual(['panel:overview/T-001'])
  })
})

describe('票 05 · 「未采到 → 绿」不算修好', () => {
  it('上次没采到、这次绿：不进 fixed，只进 transitions（采集器补上了，界面没变好）', () => {
    const diff = diffVerdicts(
      [verdict({ status: 'not-collected' })],
      [verdict({ status: 'pass' })],
    )
    expect(diff.fixed).toEqual([])
    expect(facesOf(diff.transitions)).toEqual(['panel:overview/T-001'])
    expect(diff.transitions[0].why).toContain('采集器')
    expect(diff.transitions[0].why).toContain('不计为已修')
  })

  it('上次采集失败、这次绿：同样不算修好（修好体检 ≠ 修好界面）', () => {
    const diff = diffVerdicts(
      [verdict({ status: 'collection-failed' })],
      [verdict({ status: 'pass' })],
    )
    expect(diff.fixed).toEqual([])
    expect(diff.transitions).toHaveLength(1)
  })

  it('只有「红 → 绿」才进 fixed（对照组：同一剧本里 fail → pass 才算）', () => {
    const onlyFixed = diffVerdicts([verdict({ status: 'fail' })], [verdict({ status: 'pass' })])
    expect(facesOf(onlyFixed.fixed)).toEqual(['panel:overview/T-001'])
    expect(onlyFixed.transitions).toEqual([])

    const stillGrey = diffVerdicts(
      [verdict({ status: 'not-collected' })],
      [verdict({ status: 'pass' })],
    )
    expect(stillGrey.fixed).toEqual([])
  })

  it('上次红、这次没采到：债从量尺下逃走，也不算修好（进 transitions，理由点明）', () => {
    const diff = diffVerdicts([verdict({ status: 'fail' })], [verdict({ status: 'not-collected' })])
    expect(diff.fixed).toEqual([])
    expect(diff.regressions).toEqual([])
    expect(diff.transitions[0]).toMatchObject({ from: 'fail', to: 'not-collected' })
    expect(diff.transitions[0].why).toContain('逃走')
    expect(transitionReason('fail', 'not-collected')).toBe(diff.transitions[0].why)
  })
})

describe('票 05 · 跨判据版本给「不可比」而不是硬算', () => {
  it('版本不同：comparable=false + 说清是版本不同，一个桶都不填', () => {
    const previous = { criteria: { version: 'b'.repeat(64) }, verdicts: [verdict()] }
    const diff = buildDiff({
      previous,
      criteriaVersion: VERSION,
      verdicts: [verdict({ status: 'fail' })],
    })
    expect(diff.comparable).toBe(false)
    expect(diff.reason).toContain('不可比')
    expect(diff.reason).toContain('版本不同')
    expect(diff.added).toEqual([])
    expect(diff.fixed).toEqual([])
    expect(diff.regressions).toEqual([])
    expect(diff.disappeared).toEqual([])
    expect(diff.stillFailing).toEqual([])
    expect(diff.transitions).toEqual([])
    expect(diff.unchanged).toBe(0)
  })

  it('compareCriteria：同版本可比；任一版本缺失也不可比（口径不明）', () => {
    expect(compareCriteria(VERSION, VERSION)).toEqual({ comparable: true, reason: '' })
    expect(compareCriteria(undefined, VERSION).comparable).toBe(false)
    expect(compareCriteria(VERSION, '').comparable).toBe(false)
    expect(compareCriteria('b'.repeat(64), VERSION).reason).toContain('版本不同')
  })

  it('报告层面同样是「不可比」：groups 全空、人读报告里每段都写不可比，不出现任何差值', () => {
    const previous = { criteria: { version: 'b'.repeat(64) }, verdicts: [verdict({ status: 'pass' })] }
    const report = buildReport({
      criteria: CRITERIA,
      faces: FACES,
      verdicts: [verdict({ status: 'fail', message: '这次红' })],
      previous,
      generatedAt: '2026-10-31T00:00:00.000Z',
    })
    expect(report.diff.comparable).toBe(false)
    expect(report.diff.reason).toContain('不可比')
    expect(report.groups.regressions).toEqual([])
    expect(report.groups.added).toEqual([])
    expect(report.groups.fixed).toEqual([])
    expect(report.groups.disappeared).toEqual([])

    const markdown = renderMarkdown(report)
    // 三段都明确写「不可比」，而不是留空让人误读成「没有变化」。
    const notComparable = markdown.split('不可比：').length - 1
    expect(notComparable).toBeGreaterThanOrEqual(3)
    expect(markdown).not.toContain('🔴')
    expect(markdown).toContain('> 较上次：不可比')
  })

  it('第一次巡检（没有上一次）→ 不可比，并说明是第一次', () => {
    const diff = buildDiff({ previous: null, criteriaVersion: VERSION, verdicts: [verdict()] })
    expect(diff.comparable).toBe(false)
    expect(diff.reason).toContain('第一次')
    expect(renderMarkdown(buildReport({ criteria: CRITERIA, faces: FACES, verdicts: [verdict()], generatedAt: 'now' })))
      .toContain('这是第一次巡检')
  })
})

describe('票 05 · 人读顺序固定：回退 → blocker → 新增 → 已修 → human-only', () => {
  /** 一份「四种情形都出现」的报告。 */
  function scriptedReport(previousVersion = VERSION) {
    return buildReport({
      criteria: CRITERIA,
      faces: FACES,
      verdicts: [
        verdict({ face: 'panel:overview', status: 'fail', message: '这次红', evidence: [{ file: 'a.tsx', line: 3, detail: '#fff' }] }),
        verdict({ face: 'panel:workflow', status: 'pass' }),
        verdict({ face: 'panel:history', status: 'fail', message: '一直红' }),
        verdict({ face: 'panel:today', status: 'pass' }),
        verdict({ face: 'panel:ask', status: 'fail', message: '这次才出现' }),
        verdict({ criterionId: 'S-001', severity: 'major', face: 'panel:settings', status: 'human-only', message: '要人看' }),
      ],
      previous: { criteria: { version: previousVersion }, verdicts: PREVIOUS_SCRIPT },
      generatedAt: '2026-10-31T00:00:00.000Z',
    })
  }

  it('五段标题按固定顺序出现（顺序 = HUMAN_SECTION_ORDER，改顺序要新 ADR）', () => {
    expect(HUMAN_SECTION_ORDER).toEqual(['regressions', 'blockers', 'added', 'fixed', 'humanOnly'])
    const markdown = renderMarkdown(scriptedReport())
    const headings = ['## 1. 回退', '## 2. blocker', '## 3. 新增', '## 4. 已修', '## 5. human-only']
    const positions = headings.map((heading) => markdown.indexOf(heading))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(positions)
  })

  it('回退带 🔴 且排在最前（在 blocker 之前），用的是这次的红而不是上次的', () => {
    const markdown = renderMarkdown(scriptedReport())
    const redAt = markdown.indexOf('🔴')
    expect(redAt).toBeGreaterThan(markdown.indexOf('## 1. 回退'))
    expect(redAt).toBeLessThan(markdown.indexOf('## 2. blocker'))
    expect(markdown.slice(redAt, redAt + 80)).toContain('panel:overview')
    expect(markdown.slice(redAt, redAt + 80)).toContain('这次红')
  })

  it('「消失」在第一段紧跟回退（不许翻到后面才发现覆盖面缩水）', () => {
    const report = scriptedReport()
    // 上次的 panel:settings/T-001 与 panel:consent/T-001 这次都没了 → 2 条消失。
    expect(facesOf(report.groups.disappeared)).toEqual(['panel:consent/T-001', 'panel:settings/T-001'])
    const markdown = renderMarkdown(report)
    const disappearedAt = markdown.indexOf('⚠️ 消失 2 条')
    expect(disappearedAt).toBeGreaterThan(markdown.indexOf('## 1. 回退'))
    expect(disappearedAt).toBeLessThan(markdown.indexOf('## 2. blocker'))
    expect(markdown.slice(disappearedAt)).toContain('panel:consent')
    expect(markdown.slice(disappearedAt)).toContain('panel:settings')
  })

  it('「一直红」挂在新增段落下面并标明不算新增，不出现在新增正列表里', () => {
    const report = scriptedReport()
    // 新增 = 新面 panel:ask/T-001 + 新判据 panel:settings/S-001；panel:history 不在其中。
    expect(facesOf(report.groups.added)).toEqual(['panel:ask/T-001', 'panel:settings/S-001'])
    expect(facesOf(report.groups.added)).not.toContain('panel:history/T-001')
    expect(facesOf(report.groups.stillFailing)).toEqual(['panel:history/T-001'])
    const markdown = renderMarkdown(report)
    expect(markdown).toContain('一直红 1 条（上次就红，不算新增）')
    expect(markdown).toContain('panel:history')
  })

  it('「未采到 → 绿」写在已修段落下面并明说不计为已修', () => {
    const markdown = renderMarkdown(scriptedReport())
    const transitionsAt = markdown.indexOf('不计为已修')
    expect(transitionsAt).toBeGreaterThan(markdown.indexOf('## 4. 已修'))
    expect(transitionsAt).toBeLessThan(markdown.indexOf('## 5. human-only'))
    expect(markdown.slice(transitionsAt)).toContain('`not-collected` → `pass`')
  })
})

describe('票 05 · diff 与 groups 是一处计算、两处引用', () => {
  const previous = { criteria: { version: VERSION }, verdicts: [verdict({ status: 'pass' }), verdict({ face: 'panel:workflow', status: 'fail' })] }
  const current = [verdict({ status: 'fail' }), verdict({ face: 'panel:workflow', status: 'pass' })]

  it('报告 JSON 的 diff 字段齐全（comparable/reason + 五个桶）', () => {
    const report = buildReport({ criteria: CRITERIA, faces: FACES, verdicts: current, previous, generatedAt: 'now' })
    for (const field of ['comparable', 'reason', 'added', 'fixed', 'regressions', 'disappeared']) {
      expect(report.diff).toHaveProperty(field)
    }
    expect(report.diff.comparable).toBe(true)
  })

  it('groups 与 diff 是同一批数组（引用相等）：清单与计数不可能对不上', () => {
    const report = buildReport({ criteria: CRITERIA, faces: FACES, verdicts: current, previous, generatedAt: 'now' })
    expect(report.groups.regressions).toBe(report.diff.regressions)
    expect(report.groups.added).toBe(report.diff.added)
    expect(report.groups.fixed).toBe(report.diff.fixed)
    expect(report.groups.disappeared).toBe(report.diff.disappeared)
    expect(report.groups.stillFailing).toBe(report.diff.stillFailing)
    expect(report.groups.transitions).toBe(report.diff.transitions)
    expect(report.groups.regressions).toHaveLength(1)
    expect(report.groups.fixed).toHaveLength(1)
  })
})

describe('票 05 · diff 是纯函数，读上一次只在 report.mjs', () => {
  it('diff.mjs 不读文件、不读时钟、不 import 任何模块', () => {
    const source = readFileSync(join(REPO_ROOT, 'scripts/ux/diff.mjs'), 'utf8')
    expect(source).not.toMatch(/from 'node:fs'/)
    expect(source).not.toMatch(/from 'node:/)
    expect(source).not.toMatch(/^import\s/m)
    expect(source).not.toMatch(/Date\.now|new Date\(/)
    expect(source).not.toMatch(/writeFile|readFile/)
  })

  it('readPreviousReport：没有上一次 = 正常；坏了/不是本 schema/缺 verdicts = 降级 + 一句说明', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ux-previous-'))
    expect(readPreviousReport(dir)).toEqual({ previous: null, note: '' })

    writeFileSync(join(dir, 'latest.json'), '{ 这不是 JSON')
    const broken = readPreviousReport(dir)
    expect(broken.previous).toBeNull()
    expect(broken.note).toContain('读不出来')

    writeFileSync(join(dir, 'latest.json'), JSON.stringify({ schema: 'something/else' }))
    const wrongSchema = readPreviousReport(dir)
    expect(wrongSchema.previous).toBeNull()
    expect(wrongSchema.note).toContain(REPORT_SCHEMA)

    writeFileSync(join(dir, 'latest.json'), JSON.stringify({ schema: REPORT_SCHEMA, criteria: { version: VERSION } }))
    expect(readPreviousReport(dir).note).toContain('verdicts')

    writeFileSync(
      join(dir, 'latest.json'),
      JSON.stringify({ schema: REPORT_SCHEMA, criteria: { version: VERSION }, verdicts: [verdict()] }),
    )
    const ok = readPreviousReport(dir)
    expect(ok.note).toBe('')
    expect(ok.previous.verdicts).toHaveLength(1)
  })

  it('坏报告不毁掉这一轮：verify:ux 照跑，并把降级原因写进报告说明', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'ux-previous-e2e-'))
    writeFileSync(join(outDir, 'latest.json'), '{ 坏掉了')
    const faces = faceManifest()
    const { report } = runVerifyUx({ repoRoot: REPO_ROOT, faces, outDir, write: false, generatedAt: 'now' })
    expect(report.diff.comparable).toBe(false)
    expect(report.collection.notes.join('\n')).toContain('读不出来')
  })

  it('同一落点跑两轮：第二轮拿第一轮的 latest.json 做基准，四个桶都空（这才是「可比」）', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'ux-diff-e2e-'))
    const faces = faceManifest()
    const first = runVerifyUx({ repoRoot: REPO_ROOT, faces, outDir, generatedAt: '2026-10-31T00:00:00.000Z' })
    expect(first.report.diff.comparable).toBe(false)

    const second = runVerifyUx({ repoRoot: REPO_ROOT, faces, outDir, generatedAt: '2026-10-31T00:01:00.000Z' })
    expect(second.report.diff.comparable).toBe(true)
    expect(second.report.diff.added).toEqual([])
    expect(second.report.diff.fixed).toEqual([])
    expect(second.report.diff.regressions).toEqual([])
    expect(second.report.diff.disappeared).toEqual([])
    expect(second.report.diff.transitions).toEqual([])
    // 同一批输入：没变化的（绿 + 一直红）刚好铺满身份并集，一条都没被塞进别的桶。
    expect(second.report.diff.unchanged + second.report.diff.stillFailing.length).toBe(second.report.verdicts.length)
  })
})

describe('票 05 · 拒绝喂进来的坏数据（可读失败，不是静默吞掉）', () => {
  it('同一 (判据, 面) 出现两条 → DiffError', () => {
    expect(() => diffVerdicts([verdict(), verdict()], [])).toThrow(DiffError)
    expect(() => diffVerdicts([verdict(), verdict()], [])).toThrow(/重复身份/)
  })

  it('不是 verdict[] → DiffError', () => {
    expect(() => diffVerdicts(null, [])).toThrow(/不是数组/)
    expect(() => diffVerdicts([], undefined)).toThrow(/不是数组/)
  })

  it('verdict 缺身份 → DiffError（点名缺的是哪个字段）', () => {
    expect(() => verdictKey({ face: 'panel:overview' })).toThrow(/criterionId/)
    expect(() => verdictKey({ criterionId: 'T-001' })).toThrow(DiffError)
  })
})
