#!/usr/bin/env node
/**
 * `scripts/ux/report.mjs` —— **报告器**（spec 003 · 模块 5）。
 *
 * 它把 `verdict[]` 变成三样东西：
 *   1. **兑现率**：`通过 / 适用`。分子分母与判据集版本号**同时**出现，缺一个这个数字就不接受
 *      （spec 003 §16：`assertRate()` 会直接抛）。
 *   2. **体验债清单**：按界面面分组、按严重级排序；每条带证据（`file:line` / 计算值 / 截图区）。
 *   3. **与上一次的三分类 diff**：新增 / 已修 / 回退。回退单独标红并排最前——「改一处坏三处」
 *      必须当场看见。跨判据版本时给「不可比」，不硬算一个数。
 *
 * 视觉基线**不进这里**：基线只用于说明「这次有没有意外视觉变化」，不产生通过/未通过结论
 * （spec 003 §18）。所以本文件里没有任何 baseline 输入。
 *
 * `缺态清单`（#53 · 票 06）：把 S 族（`S-001` 空 / `S-002` 载 / `S-003` 错）的红按**界面面**翻成
 * 「哪几个面、缺的哪一态」。这一节由 verdicts 现算，不从 findings 推 —— findings 按 `file:line`
 * 去重，几个面共用同一份源文件时会被压成一行，正是本清单要避免的失真。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { CRITERION_STATE, STATES, STATE_LABEL } from './state-vocabulary.mjs'

/** 报告 schema。报告器与「读报告的下一步」靠它对齐。 */
export const REPORT_SCHEMA = 'xuanshu/ux-report@1'

/** 人读报告的顺序，**固定**（spec 003 §17）。改顺序等于改产品口径，要新 ADR。 */
export const HUMAN_SECTION_ORDER = ['regressions', 'blockers', 'added', 'fixed', 'humanOnly']

/** 严重级排序权重（越靠前越先修）。 */
const SEVERITY_WEIGHT = { blocker: 0, major: 1, minor: 2 }

/** 报告器的可读失败（装配错误，不是断言红）。 */
export class ReportError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ReportError'
  }
}

/** verdict 的稳定身份：同一 (判据, 面) 就是同一条债务（证据变了但债务没变）。 */
export function verdictKey(verdict) {
  return `${verdict.criterionId}\u0000${verdict.face}`
}

/** 按证据去重后的「命中位置」——报告里点名的是位置数，不是「面 × 判据」的乘积。 */
function findingsOf(verdicts) {
  const byKey = new Map()
  for (const verdict of verdicts) {
    if (verdict.status !== 'fail') continue
    for (const item of verdict.evidence ?? []) {
      const key = `${verdict.criterionId}\u0000${item.file}\u0000${item.line ?? ''}`
      const existing = byKey.get(key)
      if (existing === undefined) {
        byKey.set(key, {
          criterionId: verdict.criterionId,
          statement: verdict.statement,
          severity: verdict.severity,
          file: item.file,
          line: item.line ?? null,
          detail: item.detail ?? '',
          faces: [verdict.face],
        })
      } else if (!existing.faces.includes(verdict.face)) {
        existing.faces.push(verdict.face)
      }
    }
  }
  return [...byKey.values()].sort(
    (left, right) =>
      (SEVERITY_WEIGHT[left.severity] ?? 9) - (SEVERITY_WEIGHT[right.severity] ?? 9)
      || left.file.localeCompare(right.file)
      || (left.line ?? 0) - (right.line ?? 0),
  )
}

/**
 * 计算兑现率。**分母是「适用配对」的全集**，含未采到与采集失败——
 * 把它们剔出分母就等于「没验的算通过」，那是本 spec 最想封死的那条路。
 * @param {object[]} verdicts
 */
export function computeRate(verdicts) {
  const applicable = verdicts.filter((verdict) => verdict.status !== 'human-only')
  const passed = applicable.filter((verdict) => verdict.status === 'pass').length
  return {
    passed,
    applicable: applicable.length,
    value: applicable.length === 0 ? null : Math.round((passed / applicable.length) * 10000) / 10000,
  }
}

/**
 * 「一个数字能不能被接受」的判据：分子、分母、判据集版本号三件齐全。
 * @param {{rate: {passed: number, applicable: number}, criteria: {version: string}}} report
 * @throws {ReportError}
 */
export function assertRate(report) {
  const rate = report?.rate
  if (rate === null || typeof rate !== 'object') throw new ReportError('报告缺 rate：没有兑现率就不是一份体检报告')
  if (!Number.isInteger(rate.passed)) throw new ReportError('报告缺分子（rate.passed）：这个数字不接受')
  if (!Number.isInteger(rate.applicable)) throw new ReportError('报告缺分母（rate.applicable）：这个数字不接受')
  if (typeof report?.criteria?.version !== 'string' || report.criteria.version === '') {
    throw new ReportError('报告缺判据集版本号（criteria.version）：这个数字不接受（口径不明 = 不可比）')
  }
  return rate
}

/** 三分类 diff：新增（这次有上次没有）/ 已修（上次失败这次不是失败）/ 回退（上次通过这次失败）。 */
export function diffVerdicts(previousVerdicts, currentVerdicts) {
  const previous = new Map(previousVerdicts.map((verdict) => [verdictKey(verdict), verdict]))
  const current = new Map(currentVerdicts.map((verdict) => [verdictKey(verdict), verdict]))
  const added = []
  const fixed = []
  const regressions = []
  for (const [key, verdict] of current) {
    const before = previous.get(key)
    if (before === undefined) {
      added.push(verdict)
      continue
    }
    const wasFailing = before.status === 'fail' || before.status === 'collection-failed'
    const isFailing = verdict.status === 'fail' || verdict.status === 'collection-failed'
    if (wasFailing && !isFailing && verdict.status === 'pass') fixed.push(verdict)
    if (before.status === 'pass' && verdict.status === 'fail') regressions.push(verdict)
  }
  const disappeared = [...previous.keys()].filter((key) => !current.has(key))
  return { added, fixed, regressions, disappeared }
}

/**
 * 缺态清单：把 S 族三条判据的红翻成「哪几个界面面、缺的哪一态」。
 *
 * 为什么不从 `findings` 推：findings 按 `file:line` 去重（三个人脸共用一个源文件时会并成一行），
 * 而本清单要的恰恰是**按面**列全。所以这里只看 verdicts：`S-001` → 空、`S-002` → 载、`S-003` → 错，
 * `fail` 才算缺（`not-collected` / `collection-failed` 不算「缺」也不算「有」，它们不进这张表，
 * 但仍留在兑现率的分母里 —— 未采到 ≠ 通过）。
 *
 * @param {object[]} verdicts
 * @param {{id: string, label?: string, kind?: string}[]} faces
 * @returns {{faces: {face: string, label: string, kind: string, missing: string[], missingLabels: string[]}[], totals: {faces: number, empty: number, loading: number, error: number, applicable: number}}}
 */
export function missingStatesOf(verdicts, faces = []) {
  const labelOf = new Map(faces.map((face) => [face.id, face.label ?? '']))
  const kindOf = new Map(faces.map((face) => [face.id, face.kind ?? '']))
  const byFace = new Map()
  let applicable = 0
  for (const verdict of verdicts) {
    const state = CRITERION_STATE[verdict.criterionId]
    if (state === undefined) continue
    if (verdict.status !== 'fail') {
      applicable += 1
      continue
    }
    const entry = byFace.get(verdict.face) ?? { face: verdict.face, states: [] }
    entry.states.push(state)
    byFace.set(verdict.face, entry)
    applicable += 1
  }
  const rows = [...byFace.values()]
    .map((entry) => {
      const missing = STATES.filter((state) => entry.states.includes(state))
      return {
        face: entry.face,
        label: labelOf.get(entry.face) ?? '',
        kind: kindOf.get(entry.face) ?? '',
        missing,
        missingLabels: missing.map((state) => STATE_LABEL[state]),
      }
    })
    .sort((left, right) => left.face.localeCompare(right.face))
  const totals = {
    faces: rows.length,
    empty: rows.filter((row) => row.missing.includes('empty')).length,
    loading: rows.filter((row) => row.missing.includes('loading')).length,
    error: rows.filter((row) => row.missing.includes('error')).length,
    applicable,
  }
  return { faces: rows, totals }
}

/** 按面聚合计数（报告里「哪些界面面最脏」一眼可见）。 */
function faceSummaries(faces, verdicts) {
  const byFace = new Map()
  for (const verdict of verdicts) {
    const entry = byFace.get(verdict.face) ?? {
      pass: 0,
      fail: 0,
      'not-collected': 0,
      'collection-failed': 0,
      'human-only': 0,
    }
    entry[verdict.status] += 1
    byFace.set(verdict.face, entry)
  }
  return faces
    .filter((face) => byFace.has(face.id))
    .map((face) => ({
      id: face.id,
      label: face.label,
      kind: face.kind,
      category: face.category,
      counts: byFace.get(face.id),
    }))
}

/**
 * 造报告。
 *
 * @param {{
 *   criteria: {label: string, version: string, criteria: object[]},
 *   faces: object[],
 *   verdicts: object[],
 *   previous?: {criteria: {version: string}, verdicts: object[]} | null,
 *   generatedAt: string,
 *   collection?: object,
 * }} input
 * @returns {object} 机读报告（人读版本由 `renderMarkdown()` 出）
 */
export function buildReport({ criteria, faces, verdicts, previous = null, generatedAt, collection = {} }) {
  if (typeof criteria?.version !== 'string' || criteria.version === '') {
    throw new ReportError('判据集没有 version：报告不接受一个口径不明的数字')
  }
  const rate = computeRate(verdicts)

  let diff = { comparable: false, reason: '这是第一次巡检，没有上一次报告可比', added: [], fixed: [], regressions: [], disappeared: [] }
  if (previous !== null && previous !== undefined) {
    if (previous.criteria?.version !== criteria.version) {
      diff = {
        comparable: false,
        reason: `判据集版本不同（上次 ${String(previous.criteria?.version).slice(0, 12)}，这次 ${criteria.version.slice(0, 12)}）：数字不可比`,
        added: [],
        fixed: [],
        regressions: [],
        disappeared: [],
      }
    } else {
      const classified = diffVerdicts(previous.verdicts ?? [], verdicts)
      diff = { comparable: true, reason: '', ...classified }
    }
  }

  const failing = verdicts.filter((verdict) => verdict.status === 'fail')
  const blockers = failing
    .filter((verdict) => verdict.severity === 'blocker')
    .sort(
      (left, right) =>
        (SEVERITY_WEIGHT[left.severity] ?? 9) - (SEVERITY_WEIGHT[right.severity] ?? 9)
        || left.face.localeCompare(right.face)
        || left.criterionId.localeCompare(right.criterionId),
    )

  const report = {
    schema: REPORT_SCHEMA,
    generatedAt,
    criteria: { label: criteria.label, version: criteria.version, count: criteria.criteria.length },
    rate,
    collection,
    faces: faceSummaries(faces, verdicts),
    diff,
    groups: {
      regressions: diff.comparable ? diff.regressions : [],
      blockers,
      added: diff.comparable ? diff.added : [],
      fixed: diff.comparable ? diff.fixed : [],
      humanOnly: verdicts.filter((verdict) => verdict.status === 'human-only'),
    },
    findings: findingsOf(verdicts),
    missingStates: missingStatesOf(verdicts, faces),
    verdicts,
  }
  assertRate(report)
  return report
}

/** 一行摘要用的人读兑现率（`12/25 = 48.0%`）。 */
function rateLine(report) {
  const { passed, applicable, value } = report.rate
  const percent = value === null ? '—' : `${(value * 100).toFixed(1)}%`
  return `${passed}/${applicable} = ${percent}`
}

function verdictLine(verdict, prefix = '-') {
  const where = verdict.evidence?.length > 0 ? `（${verdict.evidence.length} 条证据）` : ''
  return `${prefix} \`${verdict.criterionId}\` ${verdict.face} · ${verdict.message}${where}`
}

/**
 * 渲染人读报告。顺序**固定**：回退 → blocker → 新增 → 已修 → human-only。
 * @param {object} report - `buildReport()` 的产物
 * @returns {string} Markdown
 */
export function renderMarkdown(report) {
  const lines = []
  lines.push('# 体验质量线巡检报告')
  lines.push('')
  lines.push(`> 兑现率 **${rateLine(report)}** · 判据集 \`${report.criteria.label}\` @ \`${report.criteria.version.slice(0, 12)}\` · ${report.generatedAt}`)
  lines.push('> 只报告、不挡门：本命令不进 `verify:all`（升级成门需另立 ADR）。')
  lines.push('')
  lines.push('覆盖面：' + `${report.faces.length} 个界面面 × ${report.criteria.count} 条判据`)
  const collection = report.collection ?? {}
  if (collection.scannedFiles !== undefined) lines.push(`静态半边：读了 ${collection.scannedFiles} 个源文件`)
  for (const note of collection.notes ?? []) lines.push(`- 说明：${note}`)
  lines.push('')

  // ① 回退（红）
  lines.push('## 1. 回退（改一处坏三处）')
  if (!report.diff.comparable) lines.push(`- 不可比：${report.diff.reason}`)
  else if (report.groups.regressions.length === 0) lines.push('- 无。上次通过的这次没有变红。')
  else for (const verdict of report.groups.regressions) lines.push(verdictLine(verdict, '- 🔴'))

  // ② blocker
  lines.push('')
  lines.push('## 2. blocker（按界面面分组）')
  if (report.groups.blockers.length === 0) lines.push('- 无。')
  else {
    const byFace = new Map()
    for (const verdict of report.groups.blockers) {
      const list = byFace.get(verdict.face) ?? []
      list.push(verdict)
      byFace.set(verdict.face, list)
    }
    for (const [face, verdicts] of byFace) {
      lines.push(`### ${face}`)
      for (const verdict of verdicts) lines.push(verdictLine(verdict))
    }
  }

  // ③ 新增 / ④ 已修
  lines.push('')
  lines.push('## 3. 新增（这次才出现）')
  if (!report.diff.comparable) lines.push(`- 不可比：${report.diff.reason}`)
  else if (report.groups.added.length === 0) lines.push('- 无。')
  else for (const verdict of report.groups.added) lines.push(verdictLine(verdict))

  lines.push('')
  lines.push('## 4. 已修（上次红、这次不是红）')
  if (!report.diff.comparable) lines.push(`- 不可比：${report.diff.reason}`)
  else if (report.groups.fixed.length === 0) lines.push('- 无。')
  else for (const verdict of report.groups.fixed) lines.push(verdictLine(verdict))

  // ⑤ human-only 清单（一次过完）
  lines.push('')
  lines.push('## 5. human-only（机器判不了，人看一次就够）')
  if (report.groups.humanOnly.length === 0) lines.push('- 无。')
  else for (const verdict of report.groups.humanOnly) lines.push(`- \`${verdict.criterionId}\` ${verdict.face} · ${verdict.message}`)

  // 命中位置（去重后的 file:line）
  if (report.findings.length > 0) {
    lines.push('')
    lines.push('## 附：命中位置（去重后）')
    for (const finding of report.findings) {
      const where = finding.line === null ? finding.file : `${finding.file}:${finding.line}`
      lines.push(`- \`${finding.criterionId}\` ${where} · ${finding.detail}`)
    }
  }

  // 缺态清单（#53 · 票 06）：人读报告里唯一一处**按面**列的清单。
  // findings 按 `file:line` 去重，共用同一份源文件的几个面会被压成一行 —— 那正是这份清单要避免的失真，
  // 所以它从 `missingStates`（由 verdicts 现算）出，不从 findings 推。
  const missing = report.missingStates ?? { faces: [], totals: { faces: 0, empty: 0, loading: 0, error: 0, applicable: 0 } }
  lines.push('')
  lines.push('## 附：缺态界面面（S 族 · 空 / 载 / 错）')
  if (missing.faces.length === 0) {
    lines.push('- 无。')
  } else {
    lines.push(
      `- 合计 **${missing.totals.faces} 个界面面缺态**（S 族分母 ${missing.totals.applicable} 条）：`
        + `缺空态 ${missing.totals.empty} 面 / 缺加载态 ${missing.totals.loading} 面 / 缺错误态 ${missing.totals.error} 面`,
    )
    for (const row of missing.faces) {
      lines.push(`- \`${row.face}\` ${row.label === '' ? '' : `${row.label} · `}缺：${row.missingLabels.join(' / ')}`)
    }
  }

  lines.push('')
  lines.push('---')
  lines.push('自证及格的两条通道都被结构封死：判据集有冻结值（改一个字节拒绝运行），视觉基线不进判定。')
  return `${lines.join('\n')}\n`
}