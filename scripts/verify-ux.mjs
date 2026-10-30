#!/usr/bin/env node
/**
 * `scripts/verify-ux.mjs` —— **命令面**（spec 003 · 模块 6）：`pnpm verify:ux`。
 *
 * 一条命令跑完「投影 → 采集 → 判定 → 报告」，**只报告、不挡门**（不进 `verify:all`；
 * 升级成门要另立 ADR，ADR-0015 第 8 条）。
 *
 * 退出码的口径（别按「有没有红」理解）：
 *   - `0` = 体检跑完了（红绿都算跑完，报告里看）；
 *   - `2` = 体检自己没跑成（判据投影产物过期 / 缺检查器 / 采集器炸了导致一份证据都没收上来）；
 *   - `3` = 判据被改（冻结值对不上 / 缺失 / 冻结值坏了）——**拒绝运行**，且一个报告文件都不写。
 *   「有红」不是工具失败，是体检结论 —— 所以它不改退出码，否则第二天所有人都会绕开它。
 *
 * 用法：
 *   pnpm verify:ux                  # 静态半边（默认；不启浏览器）
 *   pnpm verify:ux -- --browser     # 静态 + 浏览器半边（后续票接入）
 *   node scripts/verify-ux.mjs --json out.json
 *
 * 签字只有两处：判据集冻结（`node scripts/ux/freeze.mjs --write`）与改动 PR；日常巡检零签字。
 * 这条口径写进 `--help` 是因为「巡检要不要签字」是每次都会有人重新问一遍的问题。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { faceManifest } from '../tests/assembly/lib/panel-surface.mjs'
import { collectStatic } from './ux/collect/static.mjs'
import { CriteriaFrozenError, guardCriteria } from './ux/freeze.mjs'
import { run as judgeRun } from './ux/judge.mjs'
import { CRITERIA_FILE, projectCriteria, readNormalizedText } from './ux/project.mjs'
import { buildReport, renderMarkdown, REPORT_SCHEMA } from './ux/report.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_REPO_ROOT = resolve(HERE, '..')

/** 报告落点（gitignore；报告是产物，不是仓库内容）。 */
export const DEFAULT_REPORT_DIR = 'ux-reports'

/** 体检自己的失败（默认退出码 2；冻结拒绝用 3，见类注释）。 */
export class VerifyUxError extends Error {
  /**
   * @param {string} message
   * @param {{exitCode?: number, cause?: unknown}} [options]
   */
  constructor(message, { exitCode = 2, cause } = {}) {
    super(message)
    this.name = 'VerifyUxError'
    this.exitCode = exitCode
    if (cause !== undefined) this.cause = cause
  }
}

function parseArgs(argv) {
  const opts = { mode: 'static', repoRoot: DEFAULT_REPO_ROOT, outDir: undefined, jsonOut: undefined, write: true }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg === '--static') opts.mode = 'static'
    else if (arg === '--browser') opts.mode = 'browser'
    else if (arg === '--repo') opts.repoRoot = resolve(argv[++index])
    else if (arg === '--out') opts.outDir = argv[++index]
    else if (arg === '--json') opts.jsonOut = argv[++index]
    else if (arg === '--no-write') opts.write = false
    else throw new VerifyUxError(`未知参数：${arg}（用法见 --help）`)
  }
  return opts
}

/** 读已提交的判据投影产物；缺了 / 过期了都**拒绝跑**（不允许拿一份没冻过的考卷判分）。 */
function readCommittedCriteria({ repoRoot, projected }) {
  const absolute = join(repoRoot, CRITERIA_FILE)
  if (!existsSync(absolute)) {
    throw new VerifyUxError(
      `判据投影产物不存在：${CRITERIA_FILE}。先跑 node scripts/ux/project.mjs --write 生成它（这一步要提交）。`,
    )
  }
  const text = readNormalizedText(absolute)
  if (text !== projected.text) {
    throw new VerifyUxError(
      `判据投影产物与 rules/ 不一致：${CRITERIA_FILE} 过期了。跑 node scripts/ux/project.mjs --write 重新投影（判据集的变更权在人，见 criteria/README.md §4）。`,
    )
  }
  return projected.document
}

function readPreviousReport(repoRoot) {
  const absolute = join(repoRoot, DEFAULT_REPORT_DIR, 'latest.json')
  if (!existsSync(absolute)) return null
  try {
    const parsed = JSON.parse(readNormalizedText(absolute))
    if (parsed?.schema !== REPORT_SCHEMA) return null
    return parsed
  } catch {
    // 上一次报告坏了不该让这一轮跑不成：当成「没有上一次」并在 notes 里说清。
    return null
  }
}

function timestampSlug(iso) {
  return iso.replace(/[:.]/g, '-')
}

/**
 * 跑一次体检（可被测试直接调用：不读时钟、不读 argv）。
 *
 * @param {{
 *   repoRoot?: string,
 *   mode?: 'static'|'browser',
 *   outDir?: string,
 *   generatedAt?: string,
 *   write?: boolean,
 *   faces?: object[],
 * }} [options]
 * @returns {{report: object, markdown: string, paths: {json?: string, markdown?: string}, exitCode: number}}
 */
export function runVerifyUx(options = {}) {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT
  const mode = options.mode ?? 'static'
  const faces = options.faces ?? faceManifest()
  const generatedAt = options.generatedAt ?? new Date().toISOString()

  // 冻结守卫：巡检启动的第一件事（spec 003 §Implementation Decisions 2 / ADR-0015 第 6 条）。
  // 它排在采集**与建目录**之前 —— 拒绝运行时连 ux-reports/ 都不该被新建：一个「拒绝但还是留下
  // 一份报告」的守卫，第二天就会有人拿那份报告当结论。
  // 拒绝统一走 VerifyUxError（命令面只认它），退出码用 3 与「工具没跑成」(2) 分开。
  const committedPath = join(repoRoot, CRITERIA_FILE)
  let freeze = null
  if (existsSync(committedPath)) {
    try {
      freeze = guardCriteria({ repoRoot, criteriaText: readNormalizedText(committedPath) })
    } catch (error) {
      if (error instanceof CriteriaFrozenError) throw new VerifyUxError(error.message, { exitCode: 3, cause: error })
      throw error
    }
  }

  const projected = projectCriteria({ repoRoot, faces })
  const criteria = readCommittedCriteria({ repoRoot, projected })

  // 浏览器半边在后续票接入；现在只跑静态，并把「没跑」如实写进报告（不装作已跑）。
  const collection = { mode, notes: [] }
  if (freeze !== null) {
    collection.notes.push(
      `冻结值已校验：判据集 ${freeze.version.slice(0, 12)}（冻结于 ${freeze.frozen.frozenAt}，签字人 ${freeze.frozen.approvedBy}）`,
    )
  }
  const evidence = []
  if (mode === 'static' || mode === 'browser') {
    const statics = collectStatic({ repoRoot, criteria, faces })
    evidence.push(...statics.evidence)
    collection.scannedFiles = statics.scannedFiles
    collection.notes.push(...statics.notes)
    collection.staticEvidence = statics.evidence.length
  }
  if (mode === 'browser') {
    collection.notes.push('浏览器半边尚未实现（票 07）：本轮没有浏览器证据，相关的红会显示为「未采到」而不是通过')
  }

  const judged = judgeRun({ criteria, evidence, faces })
  const previous = readPreviousReport(repoRoot)
  const report = buildReport({ criteria, faces, verdicts: judged.verdicts, previous, generatedAt, collection })
  const markdown = renderMarkdown(report)

  const paths = {}
  if (options.write !== false) {
    // `--out` 给绝对路径就用它（测试往临时目录写），给相对路径就相对仓库根。
    const outRoot =
      options.outDir === undefined
        ? join(repoRoot, DEFAULT_REPORT_DIR)
        : isAbsolute(options.outDir)
          ? options.outDir
          : join(repoRoot, options.outDir)
    const reportDir = join(outRoot, timestampSlug(generatedAt))
    mkdirSync(reportDir, { recursive: true })
    paths.json = join(reportDir, 'report.json')
    paths.markdown = join(reportDir, 'report.md')
    writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`)
    writeFileSync(paths.markdown, markdown)
    // `latest.*` 是「下一次 diff 的基准」；它只是报告指针，不是判据，也不参与通过与否。
    writeFileSync(join(outRoot, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`)
    writeFileSync(join(outRoot, 'latest.md'), markdown)
  }

  return { report, markdown, paths, exitCode: 0 }
}

/** CLI 的人读摘要（跑完先给人这一屏，细节在报告文件里）。 */
function printSummary({ report, paths, outDir }) {
  const { passed, applicable, value } = report.rate
  const percent = value === null ? '—' : `${(value * 100).toFixed(1)}%`
  console.log('[verify:ux] 体验质量线 · 只报告、不挡门')
  console.log(`[verify:ux] 兑现率：${passed}/${applicable} = ${percent} · 判据集 ${report.criteria.label} @ ${report.criteria.version.slice(0, 12)}`)
  console.log(`[verify:ux] 覆盖面：${report.faces.length} 个界面面 × ${report.criteria.count} 条判据`)
  const counts = report.verdicts.reduce((accumulator, verdict) => {
    accumulator[verdict.status] = (accumulator[verdict.status] ?? 0) + 1
    return accumulator
  }, {})
  console.log(`[verify:ux] 判定：${Object.entries(counts).map(([status, count]) => `${status} ${count}`).join(' / ')}`)
  if (report.groups.blockers.length > 0) {
    console.log('[verify:ux] blocker：')
    for (const verdict of report.groups.blockers) console.log(`  ✗ ${verdict.criterionId} ${verdict.face} · ${verdict.message}`)
  }
  if (report.findings.length > 0) {
    console.log(`[verify:ux] 命中位置（去重后 ${report.findings.length} 处）：`)
    for (const finding of report.findings) {
      console.log(`  · ${finding.criterionId} ${finding.file}:${finding.line ?? '-'} · ${finding.detail}`)
    }
  }
  if (!report.diff.comparable) console.log(`[verify:ux] diff：${report.diff.reason}`)
  if (paths?.markdown !== undefined) {
    console.log(`[verify:ux] 报告：${paths.markdown}`)
    console.log(`[verify:ux] 机读：${paths.json}`)
  } else if (outDir !== undefined) {
    console.log('[verify:ux] --no-write：本次没有落盘')
  }
}

function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`[verify:ux] ${error.message}`)
    return 2
  }
  if (opts.help) {
    console.log('用法：node scripts/verify-ux.mjs [--static|--browser] [--out <dir>] [--json <file>] [--no-write]')
    console.log('退出码：0 = 跑完（红绿都在报告里）/ 2 = 工具没跑成 / 3 = 判据被改，需人确认（拒绝运行，不出报告）')
    console.log('签字只有两处：判据集冻结（node scripts/ux/freeze.mjs --write）与改动 PR；日常巡检零签字。')
    return 0
  }
  try {
    const result = runVerifyUx({ repoRoot: opts.repoRoot, mode: opts.mode, outDir: opts.outDir, write: opts.write })
    printSummary({ ...result, outDir: opts.outDir })
    if (opts.jsonOut !== undefined) {
      const absolute = resolve(opts.jsonOut)
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, `${JSON.stringify(result.report, null, 2)}\n`)
    }
    return result.exitCode
  } catch (error) {
    // 冻结拒绝和「工具没跑成」在值班时是两种事：前者要去问人，后者要去看日志。
    console.error(`[verify:ux] 体检没跑成：${error?.message ?? error}`)
    return error?.exitCode ?? 2
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main())
}

export { main }
