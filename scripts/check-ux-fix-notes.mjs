#!/usr/bin/env node
/**
 * `scripts/check-ux-fix-notes.mjs` —— **修复说明门槛**（spec 003 §修复通道 20 · 票 10 / #57）。
 *
 * 它把「每次修复都写清哪条判据 / 改了什么 / 证据在哪」从自觉变成可核对的闸门：
 *
 *   - 只拦**动了 `packages/xuanshu-client/**` 的提交**：文档票、测试票、装配票不会被误伤
 *     （例外是 BRIEF 明写的：不含客户端改动的提交不需要说明）；
 *   - 说明形状固定、一行一条、可多条：`UX-FIX: <判据 id> | <改了什么> | <证据 file:line>`；
 *   - 判据 id 必须真的在判据集里（读 `criteria.json`）——否则「修好了 T-999」这种说明
 *     只是一句话，不能指向任何一条可判真假的判据；新判据只能先落 `criteria/proposals/`；
 *   - 失败时说清**是哪个提交、缺哪几条判据**（BRIEF 验收第 1 条），而不是笼统一句「不规范」。
 *
 * 为什么跳合并提交：合并提交的内容来自被合入的分支，而**那些内容提交各自**都要带说明；
 * 再向合并提交要一份说明，只会训练人写「merge」这种假说明。首父对比的路径集仍会被
 * `check-ux-authority.mjs` 用来核判据生效区（那里合并提交不跳过）。
 *
 * 为什么退出码是 1 而不是「有红就 2」：2 留给「工具没跑成」（不是 git 仓库 / 判据集读不出来 /
 * ref 认不出）。值班的人看到 1 知道是提交缺说明，看到 2 知道是环境或材料问题。
 *
 * 用法：
 *   node scripts/check-ux-fix-notes.mjs [--since <ref>] [--repo <dir>] [--criteria <file>]
 *   pnpm verify:ux:fix
 *
 * 只用 Node 内置模块；只读 git 历史与判据集，不写任何东西。
 */
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { GitRangeError, commitPaths, listCommits, resolveRepoRoot, shortSha } from './lib/git-range.mjs'
import { CRITERIA_FILE, readNormalizedText } from './ux/project.mjs'
import {
  CLIENT_SCOPE,
  DEFAULT_BASE_REF,
  FIX_NOTE_PREFIX,
  FIX_NOTE_SHAPE,
  isClientPath,
} from './ux/repair-channel.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_ROOT = resolve(HERE, '..')

/** 工具没跑成（退出码 2）。判据红走 `violations`，不走异常。 */
export class FixNotesError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FixNotesError'
  }
}

/**
 * 一条修复说明的严格形状。
 *
 * 判据 id 用 `[A-Z]-\d{3}`：与投影器的 id 规则同源（`scripts/ux/project.mjs`）。
 * 「改了什么」允许出现 `|`（解析时按列切再拼回去），只有最后一列必须是 `file:line`。
 */
const ID_PATTERN = /^[A-Z]-\d{3}$/u
const EVIDENCE_PATTERN = /^(.+):(\d+)$/u
/** 绝对路径（Windows 盘符 / 前导斜杠）不许当证据：证据要能在仓库里找到。 */
const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|[\\/])/u

/**
 * 解析提交正文里的修复说明。
 *
 * 返回两桶而不是抛错：一个提交可能**既有**能用的说明、**又有**写坏的说明；
 * 把坏行悄悄丢掉等于让「写错 = 没写」也放行，所以坏行必须单独成为一条违规。
 *
 * @param {string} message - 提交正文（`git show -s --format=%B`）
 * @returns {{
 *   notes: {criterionId: string, summary: string, file: string, line: number, raw: string}[],
 *   problems: {criterionId: string|null, reason: 'no-id'|'incomplete'|'empty-summary'|'bad-evidence', raw: string, message: string}[],
 * }}
 */
export function parseFixNotes(message) {
  const notes = []
  const problems = []
  for (const rawLine of String(message ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith(FIX_NOTE_PREFIX)) continue
    const rest = line.slice(FIX_NOTE_PREFIX.length).trim()

    // ① 判据 id：必须是第一列。先认 id，才能在报错里点名「缺的是哪条判据的说明」。
    const idMatch = rest.match(/^([^\s|]+)/u)
    const criterionId = idMatch !== null && ID_PATTERN.test(idMatch[1]) ? idMatch[1] : null
    if (criterionId === null) {
      problems.push({
        criterionId: null,
        reason: 'no-id',
        raw: line,
        message: '第一列不是判据 id（要 T-004 这种形状；判据 id 见 docs/design/ui-v1/criteria/criteria.json）',
      })
      continue
    }

    // ② 三列：按 `|` 切，首列是 id、末列是证据、中间全部算「改了什么」（中间允许出现 `|`）。
    const columns = rest.split('|').map((column) => column.trim())
    if (columns.length < 3) {
      problems.push({
        criterionId,
        reason: 'incomplete',
        raw: line,
        message: `三列没给全（判据 id | 改了什么 | 证据 file:line），收到 ${columns.length} 列`,
      })
      continue
    }
    const summary = columns.slice(1, -1).join(' | ').trim()
    if (summary === '') {
      problems.push({ criterionId, reason: 'empty-summary', raw: line, message: '「改了什么」是空的' })
      continue
    }
    const evidence = columns[columns.length - 1]
    const evidenceMatch = evidence.match(EVIDENCE_PATTERN)
    const file = evidenceMatch?.[1]?.trim() ?? ''
    const lineNumber = evidenceMatch === null ? 0 : Number(evidenceMatch[2])
    if (
      evidenceMatch === null
      || file === ''
      || !Number.isInteger(lineNumber)
      || lineNumber <= 0
      || ABSOLUTE_PATH_PATTERN.test(file)
    ) {
      problems.push({
        criterionId,
        reason: 'bad-evidence',
        raw: line,
        message: `证据必须是仓库相对的 file:line（收到「${evidence}」；行号必须 > 0）`,
      })
      continue
    }
    notes.push({ criterionId, summary, file, line: lineNumber, raw: line })
  }
  return { notes, problems }
}

/**
 * 读判据集里的 id 全集（修复说明必须指向真实判据）。
 *
 * 判据集缺失 / 读不出来 → `FixNotesError`（退出码 2）：没有考卷就无从核对说明指向谁，
 * 这时候「放行」会把门槛变成装饰。
 *
 * @param {{repoRoot: string, criteriaFile?: string}} input
 * @returns {Set<string>}
 */
export function loadCriteriaIds({ repoRoot, criteriaFile = CRITERIA_FILE }) {
  const absolute = isAbsolute(criteriaFile) ? criteriaFile : join(repoRoot, criteriaFile)
  if (!existsSync(absolute)) {
    throw new FixNotesError(
      `判据集不存在：${criteriaFile} —— 修复说明必须指向真实判据，先跑 node scripts/ux/project.mjs --write`,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(readNormalizedText(absolute))
  } catch (error) {
    throw new FixNotesError(`判据集读不出来：${criteriaFile}（${error?.message ?? error}）`)
  }
  if (!Array.isArray(parsed?.criteria)) {
    throw new FixNotesError(`判据集形状不对：${criteriaFile} 里没有 criteria 数组`)
  }
  const ids = new Set()
  for (const criterion of parsed.criteria) {
    if (typeof criterion?.id === 'string' && criterion.id !== '') ids.add(criterion.id)
  }
  return ids
}

/**
 * 跑一次修复说明检查（纯读；测试可直接调用，不起进程）。
 *
 * @param {{repoRoot: string, since?: string, criteriaIds?: Set<string>|null}} input
 *   `criteriaIds = null` 表示不核对「判据是否存在」（库调用方的选择；CLI 总会传）。
 * @returns {{
 *   since: string, range: string, commits: number, merges: number, clientCommits: number, notes: number,
 *   violations: {
 *     kind: 'missing-note'|'malformed-note'|'unknown-criterion',
 *     sha: string, subject: string,
 *     criterionId?: string|null, paths?: string[], detail?: string, raw?: string,
 *   }[],
 * }}
 */
export function checkFixNotes({ repoRoot, since = DEFAULT_BASE_REF, criteriaIds = null }) {
  const commits = listCommits({ repoRoot, since })
  const violations = []
  let merges = 0
  let clientCommits = 0
  let noteCount = 0

  for (const commit of commits) {
    // 合并提交跳过：内容提交各自带说明（理由见文件头）。
    if (commit.parents.length > 1) {
      merges += 1
      continue
    }
    const clientPaths = commitPaths({ repoRoot, commit }).filter(isClientPath)
    if (clientPaths.length === 0) continue
    clientCommits += 1

    const { notes, problems } = parseFixNotes(commit.message)
    noteCount += notes.length

    if (notes.length === 0 && problems.length === 0) {
      violations.push({ kind: 'missing-note', sha: commit.sha, subject: commit.subject, paths: clientPaths })
      continue
    }
    for (const problem of problems) {
      violations.push({
        kind: 'malformed-note',
        sha: commit.sha,
        subject: commit.subject,
        criterionId: problem.criterionId,
        detail: problem.message,
        raw: problem.raw,
      })
    }
    if (criteriaIds !== null) {
      for (const note of notes) {
        if (criteriaIds.has(note.criterionId)) continue
        violations.push({
          kind: 'unknown-criterion',
          sha: commit.sha,
          subject: commit.subject,
          criterionId: note.criterionId,
        })
      }
    }
  }

  return {
    since,
    range: since.includes('..') ? since : `${since}..HEAD`,
    commits: commits.length,
    merges,
    clientCommits,
    notes: noteCount,
    violations,
  }
}

/** 一条违规的人读一行（报告与测试都按这一行认领）。 */
export function describeViolation(violation) {
  const who = `${shortSha(violation.sha)} ${violation.subject}`
  if (violation.kind === 'missing-note') {
    const shown = violation.paths.slice(0, 3).join('、')
    const more = violation.paths.length > 3 ? ` 等 ${violation.paths.length} 个` : ''
    return `  ✗ ${who}：缺修复说明（改了 ${violation.paths.length} 个 client 文件：${shown}${more}）`
  }
  if (violation.kind === 'malformed-note') {
    const which = violation.criterionId === null ? '缺判据 id' : `判据 ${violation.criterionId}`
    return `  ✗ ${who}：UX-FIX 行不完整（${which}）：${violation.detail}；原文「${violation.raw}」`
  }
  return `  ✗ ${who}：UX-FIX 指向不存在的判据 ${violation.criterionId}（判据集里没有它；新判据只能先落 criteria/proposals/）`
}

function parseArgs(argv) {
  const options = { since: DEFAULT_BASE_REF, repoRoot: DEFAULT_REPO_ROOT, criteriaFile: CRITERIA_FILE, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--since') {
      const value = argv[++index]
      if (value === undefined || value.startsWith('--')) throw new FixNotesError('--since 缺一个 ref')
      options.since = value
    } else if (arg === '--repo') {
      const value = argv[++index]
      if (value === undefined) throw new FixNotesError('--repo 缺一个目录')
      options.repoRoot = resolve(value)
    } else if (arg === '--criteria') {
      const value = argv[++index]
      if (value === undefined) throw new FixNotesError('--criteria 缺一个文件路径')
      options.criteriaFile = value
    } else throw new FixNotesError(`未知参数：${arg}（用法见 --help）`)
  }
  return options
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`[ux:fix-notes] ${error.message}`)
    return 2
  }
  if (options.help) {
    console.log('用法：node scripts/check-ux-fix-notes.mjs [--since <ref>] [--repo <dir>] [--criteria <file>]')
    console.log(`  ${FIX_NOTE_SHAPE}`)
    console.log('  一行一条、可多条；只有动了 packages/xuanshu-client/** 的提交需要说明（合并提交跳过）。')
    console.log(`  缺省范围：${DEFAULT_BASE_REF}..HEAD（--since 可换成任意 ref）`)
    console.log('退出码：0 = 都有说明；1 = 有提交缺说明 / 说明不完整；2 = 工具没跑成（不是 git 仓库 / 判据集读不出来）')
    return 0
  }

  try {
    const repoRoot = resolveRepoRoot({ cwd: options.repoRoot })
    const criteriaIds = loadCriteriaIds({ repoRoot, criteriaFile: options.criteriaFile })
    const result = checkFixNotes({ repoRoot, since: options.since, criteriaIds })
    console.log(
      `[ux:fix-notes] 范围 ${result.range}：${result.commits} 个提交（合并提交跳过 ${result.merges} 个；`
        + `动了 ${CLIENT_SCOPE}** 的 ${result.clientCommits} 个）`,
    )
    if (result.violations.length === 0) {
      console.log(`[ux:fix-notes] ✅ 通过：每个动了客户端的提交都带了修复说明（共 ${result.notes} 条 UX-FIX）。`)
      return 0
    }
    console.error(`[ux:fix-notes] ✗ 修复说明违规 ${result.violations.length} 条：`)
    for (const violation of result.violations) console.error(describeViolation(violation))
    console.error(`[ux:fix-notes] 每条修复提交都要写：${FIX_NOTE_SHAPE}；一条一行、可多条。不含客户端的提交不需要。`)
    return 1
  } catch (error) {
    if (error instanceof FixNotesError || error instanceof GitRangeError) {
      console.error(`[ux:fix-notes] 检查没跑成：${error.message}`)
      return 2
    }
    throw error
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}

export { main }
