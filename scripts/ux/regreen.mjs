#!/usr/bin/env node
/**
 * `scripts/ux/regreen.mjs` —— **转绿断言**（spec 003 §修复通道 · 票 10 / #57）。
 *
 * 「修完了」不是一句话，是一个可核对的迁移：修复前巡检里被点名（`fail`）的每一条
 * **判据 × 界面面**，在修复后的巡检里都必须变成 `pass`。这个模块只做这一件事。
 *
 * 为什么 `fail → not-collected` / `collection-failed` **不算转绿**（BRIEF 明写）：
 * 把判据从「红」变成「没采到」，债并没有消失，只是从量尺下面挪走了（`diff.mjs` 里
 * 把这类迁移叫 `transitions`，明确不计入 `fixed`）。同理：
 *   - `fail → human-only` 也不算：把判据降级成「人看」同样是让机器闭嘴；
 *   - 整条 verdict **消失** 也不算：判据或界面面被删，覆盖面上就少了一块（`disappeared`）。
 * 这三种「看起来不红了」的路径都必须报出来，而且要点名到「判据 + 面」。
 *
 * 跨判据集版本也直接拒绝：考卷换了，分母跟着变，谈「同一条判据修好了」没有意义。
 *
 * `repoRoot` 的作用：`before` / `after` 可以是**报告文件路径**（相对仓库根）而不是对象，
 * 这样 CLI 与调用方给的是同一份文件；对象入参时它只用于报错里显示路径。
 *
 * 用法（CLI）：
 *   node scripts/ux/regreen.mjs --before ux-reports/<修复前>/report.json --after ux-reports/latest.json
 *   pnpm verify:ux:regreen -- --before <file> --after <file>
 *
 * 只用 Node 内置模块；只读报告，不写任何东西。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { STATUS } from './diff.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_ROOT = resolve(HERE, '..', '..')

/** 转绿结果的形状版本；改语义（什么算转绿）要升版本。 */
export const REGREEN_SCHEMA = 'xuanshu/ux-regreen@1'

/** 转绿断言的可读失败。`kind` 让调用方不用去啃中文串。 */
export class RegreenError extends Error {
  /**
   * @param {string} message
   * @param {{kind?: 'usage'|'not-regreened', offenders?: object[]}} [options]
   */
  constructor(message, { kind = 'usage', offenders = [] } = {}) {
    super(message)
    this.name = 'RegreenError'
    this.kind = kind
    this.offenders = offenders
  }
}

/** verdict 的稳定身份（与 `diff.mjs` 同口径：同一 (判据, 面) 就是同一条债）。 */
function verdictKey(verdict) {
  return `${verdict.criterionId}\u0000${verdict.face}`
}

/** 人读的「判据 + 面」（报告里点名用）。 */
function describeVerdict(verdict) {
  return `${verdict.criterionId} ${verdict.face}`
}

/**
 * 校验一份报告能用（可读的失败一律 `RegreenError`，退出码 2 那一档）。
 *
 * @param {unknown} report
 * @param {string} label - 「修复前」/「修复后」
 * @returns {{verdicts: object[], criteria: {version: string}}}
 */
function requireReport(report, label) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new RegreenError(`${label}不是一份巡检报告（拿到 ${Array.isArray(report) ? 'array' : typeof report}）`)
  }
  if (!Array.isArray(report.verdicts)) {
    throw new RegreenError(`${label}没有 verdicts 数组：这不是一次巡检报告（报告器产物见 scripts/ux/report.mjs）`)
  }
  if (report.verdicts.length === 0) {
    throw new RegreenError(`${label}的 verdicts 是空的：空报告不能当基线（没有分母就谈不上「转绿」）`)
  }
  const version = report?.criteria?.version
  if (typeof version !== 'string' || version === '') {
    throw new RegreenError(`${label}没有判据集版本号（criteria.version）：口径不明就谈不上「修好」`)
  }
  return report
}

/**
 * 读一份报告：字符串按仓库相对路径读文件，对象原样用。
 *
 * @param {{repoRoot: string, input: string|object, label: string}} input
 * @returns {object}
 */
function loadReport({ repoRoot, input, label }) {
  if (typeof input !== 'string') return input
  const absolute = isAbsolute(input) ? input : join(repoRoot, input)
  if (!existsSync(absolute)) {
    throw new RegreenError(`${label}报告不存在：${input}（路径按仓库根解析：${absolute}）`)
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'))
  } catch (error) {
    throw new RegreenError(`${label}报告不是合法 JSON：${input}（${error?.message ?? error}）`)
  }
  return parsed
}

/** 按身份建索引；重复身份直接拒绝（同一 (判据, 面) 只能有一条 verdict）。 */
function indexVerdicts(verdicts, label) {
  const index = new Map()
  for (const verdict of verdicts) {
    const criterionId = verdict?.criterionId
    const face = verdict?.face
    if (typeof criterionId !== 'string' || criterionId === '' || typeof face !== 'string' || face === '') {
      throw new RegreenError(`${label}里有缺身份的 verdict：${JSON.stringify(verdict ?? null)}`)
    }
    const key = verdictKey(verdict)
    if (index.has(key)) {
      throw new RegreenError(`${label}里有重复身份：${describeVerdict(verdict)}（同一 (判据, 面) 只能有一条 verdict）`)
    }
    index.set(key, verdict)
  }
  return index
}

/**
 * 断言「修复前被点名的判据都转绿了」。
 *
 * @param {{repoRoot?: string, before: string|object, after: string|object}} input
 * @returns {{
 *   schema: string, checked: number,
 *   regreened: {criterionId: string, face: string}[],
 *   before: {version: string}, after: {version: string},
 * }}
 * @throws {RegreenError} 报告读不出来 / 不是同一版判据集 / 有判据没转绿（`kind = 'not-regreened'`）
 */
export function assertRegreened({ repoRoot = DEFAULT_REPO_ROOT, before, after }) {
  const beforeReport = requireReport(loadReport({ repoRoot, input: before, label: '修复前报告' }), '修复前报告')
  const afterReport = requireReport(loadReport({ repoRoot, input: after, label: '修复后报告' }), '修复后报告')

  // 考卷换了就谈不上「同一条判据修好了」：先在同一版判据下重跑巡检，再比。
  if (beforeReport.criteria.version !== afterReport.criteria.version) {
    throw new RegreenError(
      `修复前后不是同一版判据集（${beforeReport.criteria.version.slice(0, 12)} → ${afterReport.criteria.version.slice(0, 12)}）：`
        + '考卷换了，分母口径跟着变，谈不上「转绿」——先在同一版判据下重跑巡检',
    )
  }

  const beforeIndex = indexVerdicts(beforeReport.verdicts, '修复前报告')
  const afterIndex = indexVerdicts(afterReport.verdicts, '修复后报告')

  const named = []
  const offenders = []
  for (const [key, prior] of beforeIndex) {
    if (prior.status !== STATUS.FAIL) continue
    const pair = { criterionId: prior.criterionId, face: prior.face }
    named.push(pair)
    const now = afterIndex.get(key)
    if (now === undefined) {
      offenders.push({
        kind: 'disappeared',
        ...pair,
        status: null,
        message: `修完从报告里消失了，不算转绿（债不能从量尺下藏起来）：${describeVerdict(prior)}`,
      })
      continue
    }
    if (now.status === STATUS.PASS) continue
    if (now.status === STATUS.FAIL) {
      offenders.push({ kind: 'still-red', ...pair, status: now.status, message: `修完仍是红：${describeVerdict(prior)}` })
    } else if (now.status === STATUS.NOT_COLLECTED) {
      offenders.push({
        kind: 'not-collected',
        ...pair,
        status: now.status,
        message: `修完没验成（not-collected），不算转绿：${describeVerdict(prior)}`,
      })
    } else if (now.status === STATUS.COLLECTION_FAILED) {
      offenders.push({
        kind: 'collection-failed',
        ...pair,
        status: now.status,
        message: `采集失败（collection-failed），不算转绿：${describeVerdict(prior)}`,
      })
    } else if (now.status === STATUS.HUMAN_ONLY) {
      offenders.push({
        kind: 'human-only',
        ...pair,
        status: now.status,
        message: `把判据降级成 human-only，不算转绿：${describeVerdict(prior)}`,
      })
    } else {
      offenders.push({
        kind: 'unknown-status',
        ...pair,
        status: now.status,
        message: `修完的状态认不出（${String(now.status)}），不算转绿：${describeVerdict(prior)}`,
      })
    }
  }

  if (offenders.length > 0) {
    throw new RegreenError(
      `修完没有转绿：${offenders.length} 条被点名的判据 × 面还不是绿\n${offenders.map((offender) => `  ✗ ${offender.message}`).join('\n')}`,
      { kind: 'not-regreened', offenders },
    )
  }

  return {
    schema: REGREEN_SCHEMA,
    checked: named.length,
    regreened: named,
    before: { version: beforeReport.criteria.version },
    after: { version: afterReport.criteria.version },
  }
}

function parseArgs(argv) {
  const options = { before: undefined, after: undefined, repoRoot: DEFAULT_REPO_ROOT, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--before') options.before = argv[++index]
    else if (arg === '--after') options.after = argv[++index]
    else if (arg === '--repo') {
      const value = argv[++index]
      if (value === undefined || value.startsWith('--')) throw new RegreenError('--repo 缺一个目录')
      options.repoRoot = resolve(value)
    } else throw new RegreenError(`未知参数：${arg}（用法见 --help）`)
  }
  return options
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`[ux:regreen] ${error.message}`)
    return 2
  }
  if (options.help) {
    console.log('用法：node scripts/ux/regreen.mjs --before <report.json> --after <report.json> [--repo <dir>]')
    console.log('  修复前被点名（fail）的每条「判据 × 界面面」，修复后必须变成 pass；')
    console.log('  fail → not-collected / collection-failed / human-only / 消失，都不算转绿。')
    console.log('退出码：0 = 全部转绿；1 = 仍有判据没转绿（逐条点名）；2 = 报告读不出来 / 不是同一版判据集')
    return 0
  }
  if (options.before === undefined || options.after === undefined) {
    console.error('[ux:regreen] 需要 --before <report.json> 与 --after <report.json>（修复前 / 修复后各一份巡检报告）')
    return 2
  }

  try {
    const result = assertRegreened({ repoRoot: options.repoRoot, before: options.before, after: options.after })
    console.log(
      `[ux:regreen] 修复前被点名 ${result.checked} 条（判据集 ${result.before.version.slice(0, 12)}）；修复后转绿 ${result.regreened.length} 条。`,
    )
    console.log('[ux:regreen] ✅ 全部转绿：被点名的判据 × 面都已由红变绿。')
    return 0
  } catch (error) {
    if (error instanceof RegreenError) {
      console.error(`[ux:regreen] ✗ ${error.message}`)
      if (error.kind === 'not-regreened') {
        console.error('[ux:regreen] 修完要重跑巡检：pnpm verify:ux；被点名的判据要由红转绿，没验成不算修好。')
        return 1
      }
      return 2
    }
    throw error
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}

export { main }
