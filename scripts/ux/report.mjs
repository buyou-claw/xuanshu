#!/usr/bin/env node
/**
 * `scripts/ux/report.mjs` —— **报告器**（spec 003 · 模块 5）。
 *
 * 它把 `verdict[]` 变成三样东西：
 *   1. **兑现率**：`通过 / 适用`。分子分母与判据集版本号**同时**出现，缺一个这个数字就不接受
 *      （spec 003 §16：`assertRate()` 会直接抛）。
 *   2. **体验债清单**：按界面面分组、按严重级排序；每条带证据（`file:line` / 计算值 / 截图区）。
 *   3. **与上一次的三分类 diff**：新增 / 已修 / 回退，外加「上次有、这次没有」（消失）与
 *      「一直红」。回退单独标红并排最前——「改一处坏三处」必须当场看见。跨判据版本时给
 *      「不可比」，不硬算一个数。
 *
 * 分类口径**不在这里**：那套纯函数在 `scripts/ux/diff.mjs`（`buildDiff()`）。本文件只做两件事：
 *   - **读上一次报告**（`readPreviousReport()`）—— 全仓唯一读「上一次」的地方，diff 模块不碰文件；
 *   - **把人读顺序钉死**（回退 → blocker → 新增 → 已修 → human-only），并把 `diff` 里的桶
 *     **原样**当成 `groups.*`（一处计算、两处引用，不许两边各算一遍）。
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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildDiff, diffCounts } from './diff.mjs'
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

/** 「上一次报告」的文件名：它是下一次 diff 的基准（报告指针，不是判据）。 */
export const PREVIOUS_REPORT_FILE = 'latest.json'

/**
 * 读上一次的报告 —— **全仓唯一读「上一次」的地方**（`diff.mjs` 只吃数组，不碰文件）。
 *
 * 这几种情况都不该让这一轮跑不成；除了「第一次巡检」，**都不许静默**：
 *   - 没有上一次（第一次巡检）→ `previous: null`，没有 note（这是常态，不值得说）；
 *   - 文件坏了 / 不是本 schema 的报告 / 缺 verdicts → `previous: null` + 一句 note 说明为什么
 *     （「当成没有上一次」是可接受的降级，但读者要知道自己看到的不是「没变化」而是「比不了」）。
 *
 * @param {string} reportDir - 报告目录（`ux-reports`）
 * @returns {{previous: object | null, note: string}}
 */
export function readPreviousReport(reportDir) {
  const absolute = join(reportDir, PREVIOUS_REPORT_FILE)
  if (!existsSync(absolute)) return { previous: null, note: '' }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'))
  } catch (error) {
    return {
      previous: null,
      note: `上一次报告读不出来（${absolute}）：${error?.message ?? error} —— 这一轮按「没有上一次」处理，diff 不可比`,
    }
  }
  if (parsed?.schema !== REPORT_SCHEMA) {
    return {
      previous: null,
      note: `上一次报告不是 ${REPORT_SCHEMA}（拿到 ${String(parsed?.schema)}）：这一轮按「没有上一次」处理，diff 不可比`,
    }
  }
  if (!Array.isArray(parsed.verdicts)) {
    return {
      previous: null,
      note: '上一次报告没有 verdicts 数组：这一轮按「没有上一次」处理，diff 不可比',
    }
  }
  return { previous: parsed, note: '' }
}

/**
 * 「缺态清单」：S 族的红按**界面面**翻成「哪几个面、缺的哪一态」。
 *
 * 为什么不从 findings 推：findings 按 `file:line` 去重，`sediment-views.tsx` 那种一份源文件被
 * 三个面共用的情形会被压成一行 —— 而「哪几个面缺态」正是这份清单要回答的问题。
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
    applicable += 1
    if (verdict.status !== 'fail') continue
    const entry = byFace.get(verdict.face) ?? { face: verdict.face, states: [] }
    entry.states.push(state)
    byFace.set(verdict.face, entry)
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
  return {
    faces: rows,
    totals: {
      faces: rows.length,
      empty: rows.filter((row) => row.missing.includes('empty')).length,
      loading: rows.filter((row) => row.missing.includes('loading')).length,
      error: rows.filter((row) => row.missing.includes('error')).length,
      applicable,
    },
  }
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

  // 分类只在 diff.mjs 里发生一次；不可比时它返回空桶 + 原因，这里不做任何补算。
  const diff = buildDiff({ previous, criteriaVersion: criteria.version, verdicts })

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
    // groups 与 diff 是**同一批数组**（引用同一对象）：两处只许有一处计算，
    // 否则「回退 3 条」和清单里的 4 条会同时出现在一份报告里。
    groups: {
      regressions: diff.regressions,
      blockers,
      added: diff.added,
      fixed: diff.fixed,
      disappeared: diff.disappeared,
      stillFailing: diff.stillFailing,
      transitions: diff.transitions,
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

/** 首行的「较上次」摘要：回退几个、新增几个、修好几个、消失几个，一眼看完。 */
function diffLine(report) {
  const diff = report.diff
  if (!diff.comparable) return `不可比 —— ${diff.reason}`
  const counts = diffCounts(diff)
  const parts = [
    `回退 ${counts.regressions}`,
    `新增 ${counts.added}`,
    `已修 ${counts.fixed}`,
    `消失 ${counts.disappeared}`,
  ]
  if (counts.stillFailing > 0) parts.push(`一直红 ${counts.stillFailing}`)
  if (counts.transitions > 0) parts.push(`状态迁移 ${counts.transitions}`)
  return parts.join(' · ')
}

/**
 * 渲染人读报告。顺序**固定**：回退 → blocker → 新增 → 已修 → human-only。
 *
 * 「消失」放在第 1 段（和回退并排）：判据或界面面被删了，是比红更要人管的事，
 * 不许等到翻到第 3 段才发现覆盖面缩水。「一直红」挂在第 3 段（它最容易被误读成「新增」），
 * 「状态迁移」挂在第 4 段（它最容易被误读成「已修」）。
 *
 * @param {object} report - `buildReport()` 的产物
 * @returns {string} Markdown
 */
export function renderMarkdown(report) {
  const lines = []
  lines.push('# 体验质量线巡检报告')
  lines.push('')
  lines.push(`> 兑现率 **${rateLine(report)}** · 判据集 \`${report.criteria.label}\` @ \`${report.criteria.version.slice(0, 12)}\` · ${report.generatedAt}`)
  lines.push(`> 较上次：${diffLine(report)}`)
  lines.push('> 只报告、不挡门：本命令不进 `verify:all`（升级成门需另立 ADR）。')
  lines.push('')
  lines.push('覆盖面：' + `${report.faces.length} 个界面面 × ${report.criteria.count} 条判据`)
  const collection = report.collection ?? {}
  if (collection.scannedFiles !== undefined) lines.push(`静态半边：读了 ${collection.scannedFiles} 个源文件`)
  for (const note of collection.notes ?? []) lines.push(`- 说明：${note}`)
  lines.push('')

  // ① 回退（红）+ 消失（上次有、这次没有）
  lines.push('## 1. 回退（改一处坏三处）')
  if (!report.diff.comparable) lines.push(`- 不可比：${report.diff.reason}`)
  else {
    if (report.groups.regressions.length === 0) lines.push('- 无。上次通过的这次没有变红。')
    else for (const verdict of report.groups.regressions) lines.push(verdictLine(verdict, '- 🔴'))
    if (report.groups.disappeared.length > 0) {
      lines.push(
        `- ⚠️ 消失 ${report.groups.disappeared.length} 条（上次有、这次没有——判据或界面面被删了，不许静默消失）：`,
      )
      for (const verdict of report.groups.disappeared) {
        lines.push(`  - \`${verdict.criterionId}\` ${verdict.face} · 上次是 \`${verdict.status}\``)
      }
    }
  }

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
  else {
    if (report.groups.added.length === 0) lines.push('- 无。')
    else for (const verdict of report.groups.added) lines.push(verdictLine(verdict))
    if (report.groups.stillFailing.length > 0) {
      // 一直红不是新增：上次就红，这次还红。只点名「判据 + 面」（细节在第 2 段），
      // 目的是让人知道「没变」而不是「新出现」。
      lines.push(`- 对照：一直红 ${report.groups.stillFailing.length} 条（上次就红，不算新增）：`)
      for (const verdict of report.groups.stillFailing) lines.push(`  - \`${verdict.criterionId}\` ${verdict.face}`)
    }
  }

  lines.push('')
  lines.push('## 4. 已修（上次红、这次绿：只有红 → 绿才算修好）')
  if (!report.diff.comparable) lines.push(`- 不可比：${report.diff.reason}`)
  else {
    if (report.groups.fixed.length === 0) lines.push('- 无。')
    else for (const verdict of report.groups.fixed) lines.push(verdictLine(verdict))
    if (report.groups.transitions.length > 0) {
      // 「未采到 → 绿」落在这里，不是第 4 段的正列表：采集器补上了 ≠ 界面变好。
      lines.push(`- 另有 ${report.groups.transitions.length} 条状态迁移，**不计为已修**：`)
      for (const { verdict, from, to, why } of report.groups.transitions) {
        lines.push(`  - \`${verdict.criterionId}\` ${verdict.face} · \`${from}\` → \`${to}\` · ${why}`)
      }
    }
  }

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
  // 它从 `missingStates`（由 verdicts 现算）出，不从 findings 推 —— 理由见 `missingStatesOf()`。
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
