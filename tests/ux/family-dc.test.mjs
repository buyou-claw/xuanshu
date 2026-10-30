/**
 * 判据族 `D`（密度与点击目标）/ `C`（对比度与可读性）——票 09 / #56。
 *
 * 这份用例守四件事（brief 点名的四条最容易做歪的地方）：
 *   1. **阈值可查、且只有一份**：判据正文里的数字必须等于 `visual-thresholds.mjs` 的常量；
 *   2. **改阈值 = 换档**：数字在判据体里，所以改它必然改判据集 `version`（冻结值必然对不上，
 *      要人重新签字 —— 这条是「AI 不能改考卷」的技术封口）；
 *   3. **判定只在断言里**：采集器只搬原始值（不 import 断言、不算比值），比值与阈值比较在这里；
 *   4. **真数据**：`tests/ux/fixtures/visual-facts.json` 是真浏览器跑剧本 1 时 `measure()` 收到的
 *      原始事实（票 09 录制）。用例读它走同一条判定路径，不再起浏览器 —— 浏览器侧只留 1 条端到端
 *      （`tests/ux/browser-collector.test.mjs`）。
 *
 * 另外钉住分母：D-002 与 C 族三条 × 22 个渲染面（3 个命令面没有 DOM，量不出计算样式）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ASSERTIONS } from '../../scripts/ux/assertions/index.mjs'
import { C_ASSERTIONS, contrastRatio, isLargeText, lineHeightRatio } from '../../scripts/ux/assertions/c.mjs'
import { D_ASSERTIONS, MIN_TARGET } from '../../scripts/ux/assertions/d.mjs'
import { VISUAL_THRESHOLDS } from '../../scripts/ux/assertions/visual-thresholds.mjs'
import { run as judgeRun } from '../../scripts/ux/judge.mjs'
import { projectCriteria, readNormalizedText, versionOfBody } from '../../scripts/ux/project.mjs'
import { buildReport, renderMarkdown } from '../../scripts/ux/report.mjs'
import { visualMetricsOf } from '../../scripts/ux/visual-metrics.mjs'
import { faceManifest } from '../assembly/lib/panel-surface.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const FACES = faceManifest()
const PROJECTED = projectCriteria({ repoRoot: REPO_ROOT, faces: FACES })
const CRITERIA = PROJECTED.document
const BY_ID = new Map(CRITERIA.criteria.map((criterion) => [criterion.id, criterion]))

const NEW_IDS = ['D-002', 'C-001', 'C-002', 'C-003']
const RULES = {
  D: JSON.parse(readNormalizedText(join(REPO_ROOT, 'docs/design/ui-v1/criteria/rules/D.json'))),
  C: JSON.parse(readNormalizedText(join(REPO_ROOT, 'docs/design/ui-v1/criteria/rules/C.json'))),
}
const FIXTURE = JSON.parse(readNormalizedText(join(import.meta.dirname, 'fixtures/visual-facts.json')))

/** 判据原文（作者面）里的那一条。 */
function ruleOf(id) {
  const family = RULES[id.slice(0, 1)]
  return family.rules.find((rule) => rule.id === id)
}

/** 取文本里所有匹配到的数字（阈值对账用）。 */
function numbersIn(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => Number.parseFloat(match[1]))
}

/** 用录制夹具造证据（形状与浏览器采集器给出的完全一致）。 */
function evidenceFromFixture(ids = ['D-001', ...NEW_IDS]) {
  const evidence = []
  for (const id of ids) {
    for (const [face, facts] of Object.entries(FIXTURE.faces)) {
      evidence.push({ criterionId: id, face, collector: 'browser', status: 'observed', facts, evidence: [] })
    }
  }
  return evidence
}

/** 跑一次判定（夹具 → 判定引擎），返回按 id → face → verdict 的索引。 */
function judgeFixture() {
  const judged = judgeRun({ criteria: CRITERIA, evidence: evidenceFromFixture(), faces: FACES })
  const indexed = new Map()
  for (const verdict of judged.verdicts) {
    indexed.set(`${verdict.criterionId}\u0000${verdict.face}`, verdict)
  }
  return { ...judged, at: (id, face) => indexed.get(`${id}\u0000${face}`) }
}

describe('票 09 · D-002 / C 族已登记（加判据 = 改四处，缺一处就报错）', () => {
  it('四条新判据都投影进了判据集，且 check=browser / severity=major / appliesTo=rendered', () => {
    for (const id of NEW_IDS) {
      const criterion = BY_ID.get(id)
      expect(criterion, `${id} 没进判据集`).toBeTruthy()
      expect(criterion.check).toBe('browser')
      expect(criterion.severity).toBe('major')
      expect(criterion.appliesTo).toEqual({ kind: 'rendered' })
      expect(criterion.family).toBe(id.slice(0, 1))
      expect(criterion.tombstone).toBe(false)
    }
  })

  it('每条都有判定谓词（缺了判定引擎直接报错，不是跳过）', () => {
    for (const id of NEW_IDS) expect(typeof ASSERTIONS[id]).toBe('function')
  })

  it('出处锚落在 spec 003 的视觉档位那一条上（判据不许自造规则）', () => {
    expect(BY_ID.get('D-002').source.file).toBe('docs/specs/003-ux-quality-line.md')
    expect(BY_ID.get('D-002').source.anchor).toContain('单屏主操作 ≤1')
    expect(BY_ID.get('C-001').source.anchor).toContain('正文 ≥16px')
    expect(BY_ID.get('C-002').source.anchor).toContain('行高 ≥1.5')
    expect(BY_ID.get('C-003').source.anchor).toContain('对比度达 WCAG AA')
  })

  it('D-001 的语义没被动过（票 07 落地的那条：≥44×44、browser、rendered、major）', () => {
    const d001 = BY_ID.get('D-001')
    expect(d001.statement).toContain('44×44')
    expect(d001.check).toBe('browser')
    expect(d001.appliesTo).toEqual({ kind: 'rendered' })
    expect(d001.severity).toBe('major')
    // 断言语义也不动：43px 仍然算红，44px 仍然算过
    expect(D_ASSERTIONS['D-001']({ targets: [{ tag: 'button', label: 'a', width: 44, height: 44 }] }).pass).toBe(true)
    expect(D_ASSERTIONS['D-001']({ targets: [{ tag: 'button', label: 'a', width: 44, height: 43 }] }).pass).toBe(false)
    expect(MIN_TARGET).toBe(44)
  })

  it('分母：D-002 与 C 族三条各 22 个渲染面（3 个命令面没有 DOM，不进分母）', () => {
    const rendered = FACES.filter((face) => face.slot !== null)
    expect(rendered.length).toBe(22)
    const { verdicts } = judgeRun({ criteria: CRITERIA, evidence: [], faces: FACES })
    for (const id of NEW_IDS) {
      const rows = verdicts.filter((verdict) => verdict.criterionId === id)
      expect(rows.length, `${id} 的分母不是 22`).toBe(22)
      expect(rows.some((verdict) => verdict.face.startsWith('command:'))).toBe(false)
      expect(rows.every((verdict) => verdict.status === 'not-collected')).toBe(true)
    }
  })
})

describe('票 09 · 阈值表可查：判据正文里的数字 = 代码里的常量', () => {
  it('D-002 的「不超过 1 个」= MAX_PRIMARY_ACTIONS', () => {
    expect(numbersIn(ruleOf('D-002').statement, /不超过\s*(\d+)\s*个/g)).toEqual([VISUAL_THRESHOLDS.MAX_PRIMARY_ACTIONS])
  })

  it('C-001 的「≥ 16px」= MIN_BODY_FONT_SIZE', () => {
    expect(numbersIn(ruleOf('C-001').statement, /计算字号\s*≥\s*(\d+(?:\.\d+)?)px/g)).toEqual([VISUAL_THRESHOLDS.MIN_BODY_FONT_SIZE])
  })

  it('C-002 的「≥ 1.5」= MIN_LINE_HEIGHT_RATIO', () => {
    expect(numbersIn(ruleOf('C-002').statement, /之比\s*≥\s*(\d+(?:\.\d+)?)/g)).toEqual([VISUAL_THRESHOLDS.MIN_LINE_HEIGHT_RATIO])
  })

  it('C-003 的 4.5:1 / 3:1 与大字定义 = WCAG AA 那一组常量', () => {
    const statement = ruleOf('C-003').statement
    expect(numbersIn(statement, /≥\s*(\d+(?:\.\d+)?):1/g)).toEqual([
      VISUAL_THRESHOLDS.CONTRAST_AA_NORMAL,
      VISUAL_THRESHOLDS.CONTRAST_AA_LARGE,
    ])
    expect(numbersIn(statement, /≥\s*(\d+(?:\.\d+)?)px/g)).toEqual([
      VISUAL_THRESHOLDS.LARGE_TEXT_PX,
      VISUAL_THRESHOLDS.LARGE_TEXT_BOLD_PX,
    ])
    // 粗体字重这一支写成 `字重 ≥ 700`（大字），正文那一支写成 `字重 < 700`：同一个常量，两种写法
    expect(numbersIn(statement, /字重\s*≥\s*(\d+)/g)).toEqual([VISUAL_THRESHOLDS.LARGE_TEXT_BOLD_WEIGHT])
    expect(Number(/字重\s*<\s*(\d+)/.exec(statement)[1])).toBe(VISUAL_THRESHOLDS.LARGE_TEXT_BOLD_WEIGHT)
  })

  it('投影产物里的 statement 与 rules/ 原文一致（阈值表在判据集里可查，不是只在源码里）', () => {
    for (const id of NEW_IDS) {
      expect(BY_ID.get(id).statement).toBe(ruleOf(id).statement)
    }
  })

  it('D-001 的 44 也是同一份常量（不是两处各写一个 44）', () => {
    expect(numbersIn(ruleOf('D-001').statement, /不小于\s*(\d+)×(\d+)/g)).toEqual([VISUAL_THRESHOLDS.MIN_TARGET])
  })
})

describe('票 09 · 改阈值等于换档：阈值在判据体里，改它必然改 version', () => {
  const body = { schema: CRITERIA.schema, label: CRITERIA.label, families: CRITERIA.families, criteria: CRITERIA.criteria }

  it('判据集的 version 就是判据体的 sha256（同一个函数算出来的）', () => {
    expect(versionOfBody(body)).toBe(CRITERIA.version)
  })

  it('把 C-001 的下限从 16 改成 18 → version 变了（冻结值会对不上，巡检拒绝运行）', () => {
    const mutated = structuredClone(body)
    const criterion = mutated.criteria.find((item) => item.id === 'C-001')
    criterion.statement = criterion.statement.replace('≥ 16px', '≥ 18px')
    expect(criterion.statement).not.toBe(BY_ID.get('C-001').statement)
    expect(versionOfBody(mutated)).not.toBe(CRITERIA.version)
  })

  it('改 D-002 的主操作上限、改扩写的行高比、改对比度，同样改 version', () => {
    const mutations = [
      ['D-002', '不超过 1 个', '不超过 2 个'],
      ['C-002', '之比 ≥ 1.5', '之比 ≥ 1.6'],
      ['C-003', '≥ 4.5:1', '≥ 5:1'],
    ]
    for (const [id, from, to] of mutations) {
      const mutated = structuredClone(body)
      const criterion = mutated.criteria.find((item) => item.id === id)
      expect(criterion.statement).toContain(from)
      criterion.statement = criterion.statement.replace(from, to)
      expect(versionOfBody(mutated), `${id} 改阈值却版本不变`).not.toBe(CRITERIA.version)
    }
  })
})

describe('票 09 · 判定只在断言里（边界逐一钉住）', () => {
  it('C-001：正好 16px 算过，15px 算红，一个文字都没量到 → 红（证据不足不能判过）', () => {
    const text = (fontSize) => ({ selector: 'p', text: '正文', fontSize, lineHeight: fontSize * 1.6 })
    expect(C_ASSERTIONS['C-001']({ bodyTexts: [text(16)] }).pass).toBe(true)
    const failed = C_ASSERTIONS['C-001']({ bodyTexts: [text(16), text(15)] })
    expect(failed.pass).toBe(false)
    expect(failed.message).toContain('1/2')
    expect(failed.message).toContain('15px')
    expect(C_ASSERTIONS['C-001']({ bodyTexts: [] }).pass).toBe(false)
  })

  it('C-002：24/16=1.5 算过，21/16=1.31 算红，line-height: normal 算红（没给比值）', () => {
    const text = (fontSize, lineHeight) => ({ selector: 'p', text: '正文', fontSize, lineHeight })
    expect(C_ASSERTIONS['C-002']({ bodyTexts: [text(16, 24)] }).pass).toBe(true)
    expect(lineHeightRatio(text(16, 24))).toBe(1.5)
    expect(C_ASSERTIONS['C-002']({ bodyTexts: [text(16, 21)] }).pass).toBe(false)
    expect(lineHeightRatio(text(16, 'normal'))).toBeNull()
    const normal = C_ASSERTIONS['C-002']({ bodyTexts: [text(16, 'normal')] })
    expect(normal.pass).toBe(false)
    expect(normal.message).toContain('line-height: normal')
    expect(C_ASSERTIONS['C-002']({ bodyTexts: [] }).pass).toBe(false)
  })

  it('C-003：4.5:1 是正文下限（4.48 红 / 4.54 过），大字下限 3:1 按 WCAG 大字定义分档', () => {
    const body = (color, fontSize = 16, fontWeight = 400) => ({
      selector: 'p',
      text: '正文',
      fontSize,
      fontWeight,
      color,
      backgroundColor: 'rgb(255, 255, 255)',
    })
    expect(contrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)')).toBe(21)
    expect(contrastRatio('rgb(119, 119, 119)', 'rgb(255, 255, 255)')).toBe(4.48)
    expect(contrastRatio('rgb(118, 118, 118)', 'rgb(255, 255, 255)')).toBe(4.54)
    expect(C_ASSERTIONS['C-003']({ bodyTexts: [body('rgb(118, 118, 118)')] }).pass).toBe(true)
    expect(C_ASSERTIONS['C-003']({ bodyTexts: [body('rgb(119, 119, 119)')] }).pass).toBe(false)
    // 同一颜色：13px 正文算红，32px 大字算过（大字下限 3:1）
    expect(isLargeText({ fontSize: 32, fontWeight: 400 })).toBe(true)
    expect(isLargeText({ fontSize: 13, fontWeight: 400 })).toBe(false)
    expect(isLargeText({ fontSize: 18.66, fontWeight: 700 })).toBe(true)
    expect(isLargeText({ fontSize: 18.66, fontWeight: 400 })).toBe(false)
    expect(C_ASSERTIONS['C-003']({ bodyTexts: [body('rgb(119, 119, 119)', 32)] }).pass).toBe(true)
    expect(C_ASSERTIONS['C-003']({ bodyTexts: [body('rgb(119, 119, 119)', 13)] }).pass).toBe(false)
  })

  it('C-003：算不出颜色就红（不是「没问题」）', () => {
    const judged = C_ASSERTIONS['C-003']({
      bodyTexts: [{ selector: 'p', text: '正文', fontSize: 16, fontWeight: 400, color: 'color-mix(in srgb, red, blue)', backgroundColor: 'rgb(255, 255, 255)' }],
    })
    expect(judged.pass).toBe(false)
    expect(judged.message).toContain('算不出对比度')
  })

  it('D-002：一屏 2 个主操作 → 红并点名；1 个 / 0 个 → 过；没量到快照 → 红', () => {
    const snapshot = (...labels) => ({ count: labels.length, buttons: labels.map((label) => ({ tag: 'button', label })) })
    expect(D_ASSERTIONS['D-002']({ primaryActions: [snapshot('立即生成')] }).pass).toBe(true)
    expect(D_ASSERTIONS['D-002']({ primaryActions: [snapshot()] }).pass).toBe(true)
    const failed = D_ASSERTIONS['D-002']({ primaryActions: [snapshot('开始填写出生信息', '开始填写出生信息')] })
    expect(failed.pass).toBe(false)
    expect(failed.message).toContain('2 个并列主操作')
    expect(failed.message).toContain('开始填写出生信息')
    expect(D_ASSERTIONS['D-002']({ primaryActions: [] }).pass).toBe(false)
  })

  it('D-002 按「快照」判，不按并集判：同一屏两个状态各 1 个主按钮不算并列', () => {
    const judged = D_ASSERTIONS['D-002']({
      primaryActions: [
        { count: 1, buttons: [{ tag: 'button', label: '创建新谱' }] },
        { count: 1, buttons: [{ tag: 'button', label: '开始转换' }] },
      ],
    })
    expect(judged.pass).toBe(true)
    expect(judged.message).toContain('2 次快照')
  })

  it('采集器只收原始值：不 import 断言、不算比值（否则就是第二个判定点）', () => {
    const source = readNormalizedText(join(REPO_ROOT, 'scripts/ux/collect/browser.mjs'))
    // 只看 import 说明符：注释里点名「比值算在 assertions/」是必须的，但那不是依赖
    expect(source).not.toMatch(/from\s+'[^']*assertions/)
    expect(source).not.toMatch(/contrastRatio\s*\(|lineHeightRatio\s*\(|VISUAL_THRESHOLDS\./)
    // 实测值模块同理：注释里可以讨论「不产生通过与否」，**代码**里不许出现判定词
    const metricsSource = readNormalizedText(join(REPO_ROOT, 'scripts/ux/visual-metrics.mjs'))
    const metricsCode = metricsSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(metricsCode).not.toMatch(/\bpass\b|\bfail\b/)
    expect(metricsCode).not.toMatch(/ASSERTIONS|assertions\/index/)
  })
})

describe('票 09 · 录制夹具走同一条判定路径（真浏览器量出来的数）', () => {
  const judged = judgeFixture()

  it('D-001 没变语义：两个面都红，点名到具体尺寸', () => {
    const overview = judged.at('D-001', 'panel:overview')
    expect(overview.status).toBe('fail')
    expect(overview.message).toContain('70×21') // 最小的那个：「改时间 ->」
    expect(judged.at('D-001', 'panel:pus').status).toBe('fail')
  })

  it('D-002 真命中：总览一屏并列 2 个主操作（「开始填写出生信息 ->」×2）', () => {
    const overview = judged.at('D-002', 'panel:overview')
    expect(overview.status).toBe('fail')
    expect(overview.message).toContain('2 个并列主操作')
    expect(overview.message).toContain('开始填写出生信息')
    // 同一面的另一个快照只有 1 个主操作也不算过：判据问的是「任一时刻」
    expect(judged.at('D-002', 'panel:pus').status).toBe('pass')
  })

  it('C-001 真命中：总览 19/22 个文字元素小于 16px（最小 13px），谱管理全过', () => {
    const overview = judged.at('C-001', 'panel:overview')
    expect(overview.status).toBe('fail')
    expect(overview.message).toContain('19/22')
    expect(overview.message).toContain('13px')
    expect(judged.at('C-001', 'panel:pus').status).toBe('pass')
  })

  it('C-002 真命中：两个面的文字全是 line-height: normal（没给比值，按低于下限算）', () => {
    for (const face of ['panel:overview', 'panel:pus']) {
      const verdict = judged.at('C-002', face)
      expect(verdict.status, `${face} 的 C-002 应该是红`).toBe('fail')
      expect(verdict.message).toContain('line-height: normal')
    }
    expect(judged.at('C-002', 'panel:overview').message).toContain('22/22')
    expect(judged.at('C-002', 'panel:pus').message).toContain('14/14')
  })

  it('C-003 真命中：总览 6/22 低于 AA，最低 3.42:1（13px 次要文字），谱管理全过', () => {
    const overview = judged.at('C-003', 'panel:overview')
    expect(overview.status).toBe('fail')
    expect(overview.message).toContain('6/22')
    expect(overview.message).toContain('3.42:1')
    expect(judged.at('C-003', 'panel:pus').status).toBe('pass')
  })

  it('剧本没走到的面一律「未采到」，不是通过（22 个渲染面 − 量过的 2 个）', () => {
    const rows = judged.verdicts.filter((verdict) => NEW_IDS.includes(verdict.criterionId))
    const notCollected = rows.filter((verdict) => verdict.status === 'not-collected')
    expect(notCollected.length).toBe(NEW_IDS.length * 20)
    expect(rows.some((verdict) => verdict.face.startsWith('command:'))).toBe(false)
  })

  it('录制夹具的形状与采集器一致（六个字段齐、背景已合成到不透明）', () => {
    for (const [face, facts] of Object.entries(FIXTURE.faces)) {
      expect(Array.isArray(facts.targets), `${face} 缺 targets`).toBe(true)
      expect(Array.isArray(facts.primaryActions), `${face} 缺 primaryActions`).toBe(true)
      expect(Array.isArray(facts.bodyTexts), `${face} 缺 bodyTexts`).toBe(true)
      for (const text of facts.bodyTexts) {
        expect(typeof text.selector).toBe('string')
        expect(typeof text.text).toBe('string')
        expect(text.fontSize).toBeGreaterThan(0)
        expect(typeof text.lineHeight === 'number' || text.lineHeight === 'normal').toBe(true)
        expect(typeof text.fontWeight).toBe('number')
        expect(text.color).toMatch(/^rgba?\(/)
        expect(text.backgroundColor).toMatch(/^rgb\(/) // 不透明：半透明层已在采集器里合成掉
      }
      for (const snapshot of facts.primaryActions) {
        expect(Number.isInteger(snapshot.count)).toBe(true)
        expect(snapshot.buttons.length).toBe(snapshot.count)
      }
    }
  })
})

describe('票 09 · 报告每面给出最小点击目标与最低对比度', () => {
  const evidence = evidenceFromFixture()
  const metrics = visualMetricsOf({ evidence, faces: FACES })

  it('实测极值来自证据（不是从 verdict 反推）：70×21 / 3.42:1 / 主操作 2 个', () => {
    expect(metrics.schema).toBe('xuanshu/ux-visual-metrics@1')
    expect(metrics.totals.smallestTarget).toMatchObject({ face: 'panel:overview', width: 70, height: 21 })
    expect(metrics.totals.lowestContrast.ratio).toBe(3.42)
    expect(metrics.totals.lowestContrast.face).toBe('panel:overview')
    expect(metrics.totals.primaryActionsMax).toMatchObject({ face: 'panel:overview', value: 2 })
    expect(metrics.totals.measured).toBe(2)
    expect(metrics.totals.textElements).toBe(36)
  })

  it('每面一行：实测值 + 判定状态互不冒充（未量到的面带 measured:false）', () => {
    const overview = metrics.faces.find((row) => row.face === 'panel:overview')
    expect(overview.measured).toBe(true)
    expect(overview.smallestTarget).toMatchObject({ width: 70, height: 21 })
    expect(overview.lowestContrast.ratio).toBe(3.42)
    expect(overview.primaryActionsMax).toBe(2)
    for (const row of metrics.faces) expect(typeof row.measured).toBe('boolean')
  })

  it('阈值表随实测值一起进报告（读报告的人不用翻源码核对口径）', () => {
    expect(metrics.thresholds).toMatchObject({ MIN_TARGET: 44, MIN_BODY_FONT_SIZE: 16, MIN_LINE_HEIGHT_RATIO: 1.5 })
  })

  it('人读报告有「视觉档实测」一节，且写着最小点击目标与最低对比度', () => {
    const { verdicts } = judgeRun({ criteria: CRITERIA, evidence, faces: FACES })
    const report = buildReport({
      criteria: CRITERIA,
      faces: FACES,
      verdicts,
      generatedAt: '2026-10-31T00:00:00.000Z',
      visualMetrics: metrics,
    })
    expect(report.visualMetrics.totals.lowestContrast.ratio).toBe(3.42)
    const markdown = renderMarkdown(report)
    expect(markdown).toContain('## 附：视觉档实测（每面最小点击目标 / 最低对比度）')
    expect(markdown).toContain('70×21')
    expect(markdown).toContain('3.42:1')
    expect(markdown).toContain('`panel:overview`')
    // 报告原有的五节顺序不变（新节挂在附录，不插队）
    const order = ['## 1. 回退', '## 2. blocker', '## 3. 新增', '## 4. 已修', '## 5. human-only'].map((heading) => markdown.indexOf(heading))
    expect(order.every((position) => position >= 0)).toBe(true)
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    expect(markdown.indexOf('## 5. human-only')).toBeLessThan(markdown.indexOf('## 附：视觉档实测'))
  })

  it('没有浏览器证据时如实说「没有」，不产出 0 面全绿的假表', () => {
    const empty = visualMetricsOf({ evidence: [], faces: FACES })
    expect(empty.faces).toEqual([])
    expect(empty.totals.measured).toBe(0)
    const report = buildReport({ criteria: CRITERIA, faces: FACES, verdicts: [], generatedAt: '2026-10-31T00:00:00.000Z' })
    expect(report.visualMetrics.totals.faces).toBe(0)
    expect(renderMarkdown(report)).toContain('没有浏览器证据')
  })
})
