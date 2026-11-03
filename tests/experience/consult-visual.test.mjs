/**
 * tests/experience/consult-visual.test.mjs —— 票 #81 视觉复核 E09 的**结构判据台**。
 *
 * E09 与 E01/E03 的最大区别：它的产物不是「通没通过」，而是**能不能被逐项比**。
 * 所以本文件钉的是四件事，全部零浏览器：
 *
 *   1. **采样条件**：三种（1280×900 浅 / 1024×768 / 1280×900 深）是**采样条件**，
 *      不许在源码里长出第四个断点常量（宽窄分界只有 README §3.1 那一个）；
 *   2. **测量 → 发现**（纯函数）：字号 / 行高 / 点击目标 / 主操作 / 溢出 / 滚动 / 弹层，
 *      每一条发现都必须带「截图区域 + 既有设计依据」，指不出依据的只能落到
 *      「待人工判断」或「判据缺口」——**不许把审美意见写成已确认的体验债**；
 *   3. **机器可读清单**：同一份测量两跑字节相同（下一轮要逐项比）；
 *   4. **终点归类**：没取到三组样本记 fail、没有真实记录记 blocked —— 未取到 ≠ 通过。
 *
 * 范式照 `tests/experience/consult-sample.test.mjs`：只测外部可观察的返回值。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { COVERAGE_STATUSES } from '../../scripts/experience/evidence.mjs'
import { SCENARIOS, SCENARIO_IDS } from '../../scripts/experience/scenarios/index.mjs'
import {
  ARTIFACT_NAME,
  BASES,
  DISPOSITIONS,
  SAMPLING_CONDITIONS,
  SURFACES,
  WIDE_MIN_WIDTH_PX,
  analyseSurface,
  buildVisualSamples,
  decideVisualOutcome,
  overlayMissingFinding,
  serialiseVisualSamples,
  shotName,
} from '../../scripts/experience/scenarios/consult-visual.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const SOURCE = join(REPO_ROOT, 'scripts', 'experience', 'scenarios', 'consult-visual.mjs')

/** 覆盖状态必须是判据词表 + blocked 里的一个（`pass`/`fail` 带证据，其余带理由）。 */
function expectStatus(decision) {
  expect(COVERAGE_STATUSES).toContain(decision.status)
  if (decision.status === 'pass' || decision.status === 'fail') {
    expect(typeof decision.evidence).toBe('string')
    expect(decision.evidence.trim()).not.toBe('')
  } else {
    expect(typeof decision.reason).toBe('string')
    expect(decision.reason.trim()).not.toBe('')
  }
}

describe('票 #81 · 场景表形状：consult-visual 就是 E09', () => {
  it('注册进场景表，带用例号、标题、截图清单与 run 函数', () => {
    const scenario = SCENARIOS['consult-visual']
    expect(scenario).toBeDefined()
    expect(scenario.caseId).toBe('E09')
    expect(scenario.title).toContain('视觉')
    expect(scenario.shots).toContain('e09-1-w1280x900-light-lobby.png')
    expect(scenario.shots).toContain('e09-3-w1280x900-dark-reader.png')
    expect(typeof scenario.run).toBe('function')
    expect(SCENARIO_IDS).toContain('consult-visual')
  })

  it('三种采样条件逐字对齐票面（尺寸＝采样条件，不是新增设计断点）', () => {
    expect(SAMPLING_CONDITIONS).toHaveLength(3)
    expect(SAMPLING_CONDITIONS.map((condition) => `${condition.width}x${condition.height}-${condition.colorScheme}`))
      .toEqual(['1280x900-light', '1024x768-light', '1280x900-dark'])
    for (const condition of SAMPLING_CONDITIONS) expect(condition.kind).toBe('sample')
  })

  it('三种条件 × 六个面各有一张图，名字不互相覆盖', () => {
    const names = SAMPLING_CONDITIONS.flatMap((condition, index) => SURFACES.map((surface) => shotName(index + 1, condition, surface)))
    expect(new Set(names).size).toBe(names.length)
    expect(names).toHaveLength(SAMPLING_CONDITIONS.length * SURFACES.length)
    expect(names.every((name) => /^e09-[1-3]-[a-z0-9-]+-[a-z-]+\.png$/u.test(name))).toBe(true)
  })

  it('场景源码没有 force: true、没有内部 RPC / fetch、没有新增断点（ADR-0017 第 3 条）', () => {
    const source = readFileSync(SOURCE, 'utf8')
    expect(source).not.toMatch(/force\s*:\s*true/u)
    expect(source).not.toMatch(/\/api\/xuanshu/u)
    expect(source).not.toMatch(/\bfetch\s*\(/u)
    // 宽窄分界只**引用** README §3.1 那一个（1100），源码里不许再写一份 @media。
    expect(WIDE_MIN_WIDTH_PX).toBe(1100)
    expect(source).not.toMatch(/@media/u)
  })
})

// ── 切片：测量快照（夹具形状与页面真实返回值一致） ─────────────────────────

/** 一段正文：默认合 C-001 / C-002（16px / 1.6）。 */
function bodyText(overrides = {}) {
  return {
    role: 'body', tag: 'p', cls: 'xs-consult__text', excerpt: '这周我只有两小时，怎样安排木工练习？',
    fontSize: 16, fontWeight: 400, lineHeightPx: 27.2, ratio: 1.7,
    rect: { x: 360, y: 320, width: 640, height: 108 },
    scrollWidth: 640, clientWidth: 640,
    overflowX: 'visible', whiteSpace: 'pre-wrap', textOverflow: 'clip',
    contrast: 12.6, visible: true,
    ...overrides,
  }
}

/** 一个按钮：默认合 D-001（≥44×44）。 */
function button(overrides = {}) {
  return {
    label: '← 列表', cls: '', primary: false, disabled: false, visible: true,
    rect: { x: 320, y: 96, width: 72, height: 44 },
    ...overrides,
  }
}

/** 一份页面快照：默认是「1280×900 浅色 · 阅读器」，各用例只改其中一格。 */
function snapshot(overrides = {}) {
  return {
    surface: 'reader',
    viewport: { width: 1280, height: 900, dpr: 1 },
    panelPresent: true,
    panelRect: { x: 288, y: 0, width: 992, height: 900 },
    panelScroll: { scrollHeight: 2400, clientHeight: 900, scrollTop: 0, scrollWidth: 992, clientWidth: 992 },
    docScroll: { scrollWidth: 1280, innerWidth: 1280 },
    toolbar: { present: true, top: 88, height: 32 },
    texts: [
      { ...bodyText(), role: 'heading', tag: 'h1', cls: '', fontSize: 18.4, fontWeight: 600, lineHeightPx: 24.8, ratio: 1.35, excerpt: '问事' },
      bodyText(),
      { ...bodyText(), role: 'meta', cls: 'xs-consult__note', fontSize: 12.8, fontWeight: 400, lineHeightPx: 20.5, ratio: 1.6, excerpt: '注入 · xuanshu-consult' },
    ],
    buttons: [
      button(),
      button({ label: '继续这次问事 ▸', rect: { x: 1120, y: 96, width: 140, height: 44 } }),
    ],
    overlays: [],
    ...overrides,
  }
}

/** 发现必须具备的形状：截图区域 + 依据 + 裁定去向。 */
function expectFindingShape(finding) {
  expect(typeof finding.area).toBe('string')
  expect(finding.area.trim()).not.toBe('')
  expect(typeof finding.observed).toBe('string')
  expect(finding.observed.trim()).not.toBe('')
  expect(DISPOSITIONS).toContain(finding.disposition)
  expect(Object.keys(BASES)).toContain(finding.basis.kind)
  expect(typeof finding.basis.ref).toBe('string')
  expect(finding.basis.ref.trim()).not.toBe('')
}

describe('票 #81 · 字号与层级：正文下限与行高按判据量，层级辨识留给人', () => {
  it('合口径的阅读器正文不产生任何字号 / 行高发现', () => {
    const result = analyseSurface(snapshot(), { shot: 'e09-1-w1280x900-light-reader.png' })
    const typography = result.findings.filter((finding) => finding.basis.ref === 'C-001' || finding.basis.ref === 'C-002')
    expect(typography).toEqual([])
  })

  it('正文 14px → C-001 发现（引用 README §11.1 的正文 ≥16px）', () => {
    const result = analyseSurface(snapshot({ texts: [bodyText({ fontSize: 14, lineHeightPx: 22.4, ratio: 1.6 })] }), { shot: 'e09-2-w1024x768-light-reader.png' })
    const finding = result.findings.find((item) => item.basis.ref === 'C-001')
    expect(finding).toBeDefined()
    expect(finding.disposition).toBe('measured-violation')
    expect(finding.observed).toContain('14px')
    expect(finding.area).toContain('e09-2-w1024x768-light-reader.png')
    expectFindingShape(finding)
  })

  it('行高比 1.4 → C-002 发现；line-height: normal（量不出比值）同样算低于下限', () => {
    const byRatio = analyseSurface(snapshot({ texts: [bodyText({ lineHeightPx: 22.4, ratio: 1.4 })] }), { shot: 'shot.png' })
    expect(byRatio.findings.find((item) => item.basis.ref === 'C-002')).toBeDefined()

    const byNormal = analyseSurface(snapshot({ texts: [bodyText({ lineHeightPx: null, ratio: null })] }), { shot: 'shot.png' })
    const finding = byNormal.findings.find((item) => item.basis.ref === 'C-002')
    expect(finding).toBeDefined()
    expect(finding.observed).toContain('normal')
  })

  it('元信息（note / badge / shortid）不吃正文下限：12.8px 不产生 C-001 发现', () => {
    const result = analyseSurface(snapshot({ texts: [bodyText({ role: 'meta', cls: 'xs-consult__note', fontSize: 12.8 })] }), { shot: 'shot.png' })
    expect(result.findings.filter((item) => item.basis.ref === 'C-001')).toEqual([])
  })

  it('层级（L-001）只出「待人工判断」的测量摘要，不写成体验债', () => {
    const result = analyseSurface(snapshot(), { shot: 'shot.png' })
    const finding = result.findings.find((item) => item.basis.ref === 'L-001')
    expect(finding).toBeDefined()
    expect(finding.disposition).toBe('待人工判断')
    expect(finding.observed).toMatch(/18\.4px|600/u)
    expectFindingShape(finding)
  })

  it('6 档之外的字号（19px）标成判据缺口，而不是判成违例', () => {
    const result = analyseSurface(snapshot({ texts: [bodyText({ role: 'heading', tag: 'h2', fontSize: 19, fontWeight: 700, lineHeightPx: 26, ratio: 1.37, excerpt: '新档' })] }), { shot: 'shot.png' })
    const finding = result.findings.find((item) => item.basis.ref === '11.1')
    expect(finding).toBeDefined()
    expect(finding.disposition).toBe('判据缺口')
    expect(finding.observed).toContain('19px')
    expectFindingShape(finding)
  })
})

describe('票 #81 · 主次按钮与点击目标：D-001 / D-002 有明确阈值', () => {
  it('36×36 的按钮 → D-001 发现（引用点击目标 ≥44×44）', () => {
    const result = analyseSurface(snapshot({ buttons: [button({ label: '导出选中', rect: { x: 900, y: 100, width: 88, height: 36 } })] }), { shot: 'shot.png' })
    const finding = result.findings.find((item) => item.basis.ref === 'D-001')
    expect(finding).toBeDefined()
    expect(finding.disposition).toBe('measured-violation')
    expect(finding.observed).toContain('88×36')
    expectFindingShape(finding)
  })

  it('同一屏两个可见主操作 → D-002 发现；只有一个不算', () => {
    const two = analyseSurface(snapshot({ buttons: [button({ label: '＋ 开一次问事', primary: true }), button({ label: '删除这条记录', primary: true })] }), { shot: 'shot.png' })
    const finding = two.findings.find((item) => item.basis.ref === 'D-002')
    expect(finding).toBeDefined()
    expect(finding.observed).toContain('2')
    expectFindingShape(finding)

    const one = analyseSurface(snapshot({ buttons: [button({ label: '＋ 开一次问事', primary: true })] }), { shot: 'shot.png' })
    expect(one.findings.filter((item) => item.basis.ref === 'D-002')).toEqual([])
  })

  it('禁用按钮不算主操作（D-002 的口径），但照旧量点击目标', () => {
    const result = analyseSurface(snapshot({ buttons: [button({ label: '＋ 开一次问事', primary: true }), button({ label: '删除', primary: true, disabled: true })] }), { shot: 'shot.png' })
    expect(result.findings.filter((item) => item.basis.ref === 'D-002')).toEqual([])
  })
})

describe('票 #81 · 长文本挤压与截断：没有判据就标缺口，判截得对不对留给人', () => {
  it('文字宽度超出容器 → 判据缺口（截图区域指到那一段）', () => {
    const result = analyseSurface(snapshot({
      texts: [bodyText({ excerpt: 'E:\\ai_project\\XuanShu\\.experience-home\\round-01\\xuanshu\\pus\\体验-木工\\content.md', scrollWidth: 1180, clientWidth: 640 })],
    }), { shot: 'e09-2-w1024x768-light-reader.png' })
    const finding = result.findings.find((item) => item.disposition === '判据缺口' && /溢出/u.test(item.observed))
    expect(finding).toBeDefined()
    expect(finding.area).toContain('e09-2-w1024x768-light-reader.png')
    expect(finding.observed).toContain('1180')
    expectFindingShape(finding)
  })

  it('省略号截断与静默裁掉分开记（前者看得见，后者看不见）', () => {
    const ellipsis = analyseSurface(snapshot({
      texts: [bodyText({ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflowX: 'hidden', scrollWidth: 900, clientWidth: 640 })],
    }), { shot: 'shot.png' })
    expect(ellipsis.findings.some((item) => /省略号/u.test(item.observed))).toBe(true)

    const clipped = analyseSurface(snapshot({
      texts: [bodyText({ whiteSpace: 'nowrap', textOverflow: 'clip', overflowX: 'hidden', scrollWidth: 900, clientWidth: 640 })],
    }), { shot: 'shot.png' })
    expect(clipped.findings.some((item) => /裁掉/u.test(item.observed))).toBe(true)
  })

  it('面板自身横向溢出（内容把面板撑宽）单独记一条', () => {
    const result = analyseSurface(snapshot({ panelScroll: { scrollHeight: 2400, clientHeight: 900, scrollTop: 0, scrollWidth: 1180, clientWidth: 992 } }), { shot: 'shot.png' })
    expect(result.findings.some((item) => /面板横向溢出/u.test(item.observed))).toBe(true)
  })
})

describe('票 #81 · 滚动与弹层：测量事实齐全，取舍留给人', () => {
  it('滚到底后工具条整条离开视口 → 待人工判断（S7 线框没规定吸顶）', () => {
    const result = analyseSurface(snapshot({
      surface: 'reader-bottom',
      toolbar: { present: true, top: -120, height: 32 },
      panelScroll: { scrollTop: 900, scrollHeight: 1800, clientHeight: 900, scrollWidth: 992, clientWidth: 992 },
    }), { shot: 'e09-1-w1280x900-light-reader-bottom.png' })
    const finding = result.findings.find((item) => /工具条/u.test(item.observed))
    expect(finding).toBeDefined()
    expect(finding.disposition).toBe('待人工判断')
    expect(finding.observed).toContain('scrollTop=900')
    expectFindingShape(finding)
  })

  it('工具条只露出一截（没整条离开）不算这条发现', () => {
    const result = analyseSurface(snapshot({
      surface: 'reader-bottom',
      toolbar: { present: true, top: -8, height: 54 },
    }), { shot: 'shot.png' })
    expect(result.findings.filter((item) => /工具条/u.test(item.observed))).toEqual([])
  })

  it('不是「刻意滚到底」的面，即使头部被带走也不记这条（别借框架动作造发现）', () => {
    const result = analyseSurface(snapshot({
      surface: 'overlay',
      toolbar: { present: true, top: -446, height: 54 },
      panelScroll: { scrollTop: 462, scrollHeight: 1505, clientHeight: 768, scrollWidth: 744, clientWidth: 744 },
    }), { shot: 'shot.png' })
    expect(result.findings.filter((item) => /工具条/u.test(item.observed))).toEqual([])
  })

  it('弹层超出视口 → 判据缺口（D8 只规定照 Modal 的行为）', () => {
    const result = analyseSurface(snapshot({
      surface: 'overlay',
      overlays: [{ kind: 'drawer', label: '临时挂载', role: 'dialog', withinViewport: false, maskPresent: true, rect: { x: 0, y: 0, width: 1180, height: 900 } }],
    }), { shot: 'e09-2-w1024x768-light-overlay.png' })
    const finding = result.findings.find((item) => /弹层|抽屉/u.test(item.observed))
    expect(finding).toBeDefined()
    expect(finding.disposition).toBe('判据缺口')
    expectFindingShape(finding)
  })

  it('合口径的弹层不产生发现（视口内 + 遮罩在）', () => {
    const result = analyseSurface(snapshot({
      surface: 'overlay',
      overlays: [{ kind: 'drawer', label: '临时挂载', role: 'dialog', withinViewport: true, maskPresent: true, rect: { x: 560, y: 0, width: 720, height: 900 } }],
    }), { shot: 'shot.png' })
    expect(result.findings.filter((item) => /弹层|抽屉/u.test(item.observed))).toEqual([])
  })

  it('弹层点了没出现 → 现场观测作为一条「待人工判断」，并计进 metrics', () => {
    const shot = 'e09-1-w1280x900-light-overlay.png'
    const missing = overlayMissingFinding({ shot, reason: '点了「临时挂载…」但没有出现抽屉（15s 内）' })
    expect(missing.disposition).toBe('待人工判断')
    expect(missing.basis.ref).toContain('S6 §5')
    expectFindingShape(missing)

    const result = analyseSurface(snapshot({ surface: 'overlay' }), { shot, extraFindings: [missing] })
    expect(result.findings).toContain(missing)
    expect(result.metrics.findings.humanJudgement).toBe(result.findings.filter((item) => item.disposition === '待人工判断').length)
  })
})

describe('票 #81 · 间距：只对照阶梯，挤不挤留给人', () => {
  it('间隙落在 4 / 8 / 12 / 16 / 20 / 24 之外 → 待人工判断，并把实测值记进 metrics', () => {
    const result = analyseSurface(snapshot({ spacing: { panelPaddingTop: 24, panelPaddingBottom: 24, blockGaps: [12, 13, -4] } }), { shot: 'shot.png' })
    const finding = result.findings.find((item) => item.basis.ref === 'token --xs-space-*')
    expect(finding).toBeDefined()
    expect(finding.disposition).toBe('待人工判断')
    expect(finding.observed).toContain('13')
    expect(finding.observed).toContain('面板内边距 24px')
    expectFindingShape(finding)
    expect(result.metrics.spacing.offLadder).toEqual([13, -4])
  })

  it('间隙都在阶梯上 → 不产生这条发现', () => {
    const result = analyseSurface(snapshot({ spacing: { panelPaddingTop: 24, panelPaddingBottom: 24, blockGaps: [8, 12, 24] } }), { shot: 'shot.png' })
    expect(result.findings.filter((item) => item.basis.ref === 'token --xs-space-*')).toEqual([])
    expect(result.metrics.spacing.offLadder).toEqual([])
  })

  it('0px 不是一次间距取值（两块贴在一起），不判成阶梯外；负值（重叠）要留', () => {
    const result = analyseSurface(snapshot({ spacing: { panelPaddingTop: 24, panelPaddingBottom: 24, blockGaps: [0, 12, -2] } }), { shot: 'shot.png' })
    expect(result.metrics.spacing.offLadder).toEqual([-2])
    expect(result.metrics.spacing.blockGaps).toEqual([0, 12, -2])
  })
})

describe('票 #81 · 窄屏形态：工具条折行是可量的事实，算不算偏离留给人', () => {
  it('1024 下工具条折成两行 → 一条「待人工判断」（依据 S7 §2.4）', () => {
    const result = analyseSurface(snapshot({
      viewport: { width: 1024, height: 768, dpr: 1 },
      toolbar: { present: true, top: 16, height: 76, rows: 2 },
    }), { shot: 'e09-2-w1024x768-light-reader.png' })
    const finding = result.findings.find((item) => item.basis.ref === 'S7 §2.4')
    expect(finding).toBeDefined()
    expect(finding.disposition).toBe('待人工判断')
    expect(finding.observed).toContain('2 行')
    expectFindingShape(finding)
  })

  it('宽屏（1280）工具条只有一行 → 不产生这条发现', () => {
    const result = analyseSurface(snapshot({ toolbar: { present: true, top: 24, height: 44, rows: 1 } }), { shot: 'shot.png' })
    expect(result.findings.filter((item) => item.basis.ref === 'S7 §2.4')).toEqual([])
  })
})

describe('票 #81 · 机器可读清单：下一轮要逐项比', () => {
  /** 三种条件各来一份最小分析结果（真实跑时由页面快照算出）。 */
  function conditionSample(condition, index) {
    const result = analyseSurface(snapshot(), { shot: shotName(index, condition, 'reader') })
    return {
      condition,
      files: { reader: shotName(index, condition, 'reader') },
      surfaces: { reader: result },
    }
  }

  it('清单含条件 → 截图文件名 → 关键尺寸与字号实测值', () => {
    const manifest = buildVisualSamples({
      generatedAt: '2026-11-03T00:00:00.000Z',
      conditions: SAMPLING_CONDITIONS.map((condition, index) => conditionSample(condition, index + 1)),
    })
    expect(manifest.schema).toBe('xuanshu/experience-visual-samples@1')
    expect(manifest.caseId).toBe('E09')
    expect(manifest.conditions).toHaveLength(3)
    const first = manifest.conditions[0]
    expect(first.viewport).toEqual({ width: 1280, height: 900 })
    expect(first.colorScheme).toBe('light')
    expect(first.files.reader).toBe('e09-1-w1280x900-light-reader.png')
    expect(first.measured.reader.bodyFontSizeMin).toBe(16)
    expect(first.measured.reader.bodyLineHeightRatioMin).toBe(1.7)
    expect(first.measured.reader.clickTargetMin).toEqual({ width: 72, height: 44 })
  })

  it('同一份测量两跑字节相同（确定性：下一轮能直接比）', () => {
    const input = {
      generatedAt: '2026-11-03T00:00:00.000Z',
      conditions: SAMPLING_CONDITIONS.map((condition, index) => conditionSample(condition, index + 1)),
    }
    const a = serialiseVisualSamples(buildVisualSamples(input))
    const b = serialiseVisualSamples(buildVisualSamples(input))
    expect(a).toBe(b)
    expect(a.endsWith('\n')).toBe(true)
    expect(a.includes('"schema": "xuanshu/experience-visual-samples@1"')).toBe(true)
  })
})

describe('票 #81 · 清单交给 runner 的 files 通道（文件名固定，落点由证据包决定）', () => {
  it('文件名是 visual-samples.json，内容是可直接落盘的 JSON（2 空格缩进 + 结尾换行）', () => {
    expect(ARTIFACT_NAME).toBe('visual-samples.json')
    const manifest = buildVisualSamples({ generatedAt: '2026-11-03T00:00:00.000Z', conditions: [] })
    const text = serialiseVisualSamples(manifest)
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toBe(`${JSON.stringify(manifest, null, 2)}\n`)
    expect(JSON.parse(text).caseId).toBe('E09')
  })
})

describe('票 #81 · 终点归类：没取到样本不许记通过', () => {
  /** 三组样本齐全、每份都带发现与测量值。 */
  function fullObservations(overrides = {}) {
    return {
      panel: { opened: true, attempts: 1 },
      record: { opened: true, title: '转岗时机', messageCount: 4 },
      conditions: SAMPLING_CONDITIONS.map((condition, index) => ({
        condition,
        files: Object.fromEntries(SURFACES.map((surface) => [surface, shotName(index + 1, condition, surface)])),
        surfaces: Object.fromEntries(SURFACES.map((surface) => [surface, analyseSurface(snapshot({ surface }), { shot: shotName(index + 1, condition, surface) })])),
      })),
      ...overrides,
    }
  }

  it('三组样本齐全且每条发现都有落点 → pass，摘要里如实报三类发现的条数', () => {
    const decision = decideVisualOutcome(fullObservations())
    expect(decision.status).toBe('pass')
    expect(decision.summary).toContain('待人工判断')
    expect(decision.evidence).toContain('e09-1-w1280x900-light')
    expectStatus(decision)
  })

  it('问事面板没打开 → blocked（环境缺前置）', () => {
    const decision = decideVisualOutcome(fullObservations({ panel: { opened: false, attempts: 3 } }))
    expect(decision.status).toBe('blocked')
    expectStatus(decision)
  })

  it('没有真实问事记录（阅读器打不开）→ blocked，理由指回 consult-normal', () => {
    const decision = decideVisualOutcome(fullObservations({ record: { opened: false } }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('consult-normal')
    expectStatus(decision)
  })

  it('少一组采样（1024×768 没取到）→ fail，证据里写清缺哪一组', () => {
    const observations = fullObservations()
    observations.conditions = observations.conditions.filter((sample) => sample.condition.id !== 'w1024x768-light')
    const decision = decideVisualOutcome(observations)
    expect(decision.status).toBe('fail')
    expect(decision.evidence).toContain('w1024x768-light')
    expectStatus(decision)
  })

  it('有发现指不出依据或没标裁定去向 → fail（证据不成立，不许算完）', () => {
    const observations = fullObservations()
    observations.conditions[0].surfaces.reader.findings.push({ area: '', observed: '', disposition: 'measured-violation', basis: { kind: 'gap', ref: '' } })
    const decision = decideVisualOutcome(observations)
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('依据')
    expectStatus(decision)
  })
})
