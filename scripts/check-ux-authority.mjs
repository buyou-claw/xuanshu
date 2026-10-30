#!/usr/bin/env node
/**
 * `scripts/check-ux-authority.mjs` —— **写入面可机检**（spec 003 §修复通道 19 · ADR-0015 第 6 条 · 票 10 / #57）。
 *
 * 判据生效区（`criteria.json` / `rules/**` / `freeze.json`）与基线目录**不在自动化通道的写入面内**。
 * 这条检查把它变成可证伪的事实，而不是一句纪律：
 *
 *   1. **生效区的任何改动必须与一次冻结签字同现**：改了 `criteria.json` 或 `rules/**` 的提交里
 *      也必须出现 `freeze.json`；且该提交快照上的冻结值必须能通过 `scripts/ux/freeze.mjs` 的
 *      `guardCriteria`（重算 `version` + 判据集全文哈希）。只有 criteria 没有 freeze → 红，
 *      并给出两条路：「要么改回去，要么重新签字」。
 *   2. **`rules/**` 改了就必须重投影 `criteria.json`**：判据的变更是一整套（rules → criteria.json
 *      → freeze.json）。只改族文件不重投影，等于让投影产物变成一份没人知道的旧考卷。
 *   3. **基线不进历史**：`ux-reports/<…>/baseline(s)/` 出现在提交里、或已被 git 跟踪 → 红。
 *      基线之所以能「刷」，是因为它只是报告的一部分；一旦它能进历史，就成了「刷基线自证及格」。
 *   4. **`ux-reports/` 必须仍被 `.gitignore` 覆盖**：这是第 3 条的结构性保证——忽略规则一撤，
 *      基线第二天就会出现在某个提交里。
 *   5. **工作区不许是一份没签字的考卷**：当前 `criteria.json` 与 `freeze.json` 对不上（有人正在改、
 *      还没签字）→ 红。这让人在提交前就能看到自己越界了。
 *
 * 不判断「是谁改的」：提交作者字段可以随便写，按作者名拦人只会产生误伤与绕过。这里拦的是
 * **不变量**（改生效区 ⇒ 带签字；基线 ⇒ 不进历史），不是身份。
 *
 * 合并提交按**首父对比**一并检查：合并把什么带进这条分支，本身就该是可核对的；而签字是
 * 快照性质，所以「带进来的 criteria + freeze 是配套的」在合并提交上仍然成立。
 *
 * 用法：
 *   node scripts/check-ux-authority.mjs [--since <ref>] [--repo <dir>]
 *   pnpm verify:ux:authority
 *
 * 只用 Node 内置模块；只读 git 历史与工作区。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { GitRangeError, commitPaths, listCommits, readBlobAt, resolveRepoRoot, shortSha, trackedPaths } from './lib/git-range.mjs'
import { CriteriaError, readNormalizedText } from './ux/project.mjs'
import { CriteriaFrozenError, guardCriteria } from './ux/freeze.mjs'
import {
  BASELINE_ROOT,
  DEFAULT_BASE_REF,
  EFFECTIVE_CRITERIA,
  EFFECTIVE_FREEZE,
  EFFECTIVE_RULES_DIR,
  isBaselinePath,
  isEffectiveCriteriaPath,
} from './ux/repair-channel.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_ROOT = resolve(HERE, '..')

/** 人跑的两步（拒绝提示里必须给得出；与 `scripts/ux/freeze.mjs` 的提示同一口径）。 */
const PROJECT_WRITE = 'node scripts/ux/project.mjs --write'
const FREEZE_WRITE = 'node scripts/ux/freeze.mjs --write'

/** `.gitignore` 里必须仍然覆盖报告目录（`ux-reports` 或 `/ux-reports/` 都算）。 */
const REPORT_IGNORE = /^\s*\/?ux-reports\/?\s*$/mu

/** 工具没跑成（退出码 2）。判据红走 `violations`。 */
export class AuthorityError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AuthorityError'
  }
}

/**
 * 在临时目录里重建某个提交的判据快照，跑一次**真实**的冻结守卫。
 *
 * 为什么不把 `guardCriteria` 改成接受文本：签名必须只有一条实现路径（`freeze.mjs`），
 * 检查器只负责把「那个提交里的两份文件」原样交给它。少一条旁路，就少一个「守卫和检查器
 * 各判一套」的岔口。
 *
 * @param {{repoRoot: string, sha: string}} input
 * @returns {{ok: true} | {ok: false, message: string}}
 */
function guardCommitSnapshot({ repoRoot, sha }) {
  const criteriaText = readBlobAt({ repoRoot, sha, path: EFFECTIVE_CRITERIA })
  const freezeText = readBlobAt({ repoRoot, sha, path: EFFECTIVE_FREEZE })
  if (criteriaText === null || freezeText === null) {
    const missing = criteriaText === null ? EFFECTIVE_CRITERIA : EFFECTIVE_FREEZE
    return { ok: false, message: `在这个提交上读不到 ${missing}（判据只删不签，等于把量尺毁掉）` }
  }
  const scratch = mkdtempSync(join(tmpdir(), 'ux-authority-'))
  try {
    mkdirSync(join(scratch, dirname(EFFECTIVE_CRITERIA)), { recursive: true })
    writeFileSync(join(scratch, EFFECTIVE_CRITERIA), criteriaText)
    writeFileSync(join(scratch, EFFECTIVE_FREEZE), freezeText)
    guardCriteria({ repoRoot: scratch, criteriaText })
    return { ok: true }
  } catch (error) {
    if (error instanceof CriteriaFrozenError || error instanceof CriteriaError) {
      return { ok: false, message: error.message }
    }
    throw error
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * 当前工作区的两条结构性保证：`.gitignore` 覆盖报告目录、判据与冻结值配套。
 *
 * @param {{repoRoot: string}} input
 * @returns {{kind: string, message: string, path?: string}[]}
 */
function stateViolations({ repoRoot }) {
  const violations = []

  // ① 基线不能出现在被跟踪清单里（正常情况它连提交都进不去；这条兜住「曾经 --force 加进去」）。
  for (const path of trackedPaths({ repoRoot, prefix: BASELINE_ROOT.replace(/\/$/u, '') }).filter(isBaselinePath)) {
    violations.push({
      kind: 'baseline-tracked',
      path,
      message: `基线目录不在自动化通道的写入面内（${path} 被 git 跟踪了）—— 基线只进 ux-reports/ 报告，`
        + '且被 .gitignore 覆盖、不进历史；刷基线不等于通过（ADR-0015 第 5 条）',
    })
  }

  // ② 忽略规则是基线「进不了历史」的结构性保证：撤掉它，第 ① 条迟早会被踩穿。
  const gitignorePath = join(repoRoot, '.gitignore')
  if (!existsSync(gitignorePath)) {
    violations.push({
      kind: 'missing-gitignore',
      message: `仓库根没有 .gitignore：${BASELINE_ROOT} 会变成可提交物，等于给「刷基线自证及格」开了一条路`,
    })
  } else if (!REPORT_IGNORE.test(readFileSync(gitignorePath, 'utf8'))) {
    violations.push({
      kind: 'gitignore-open',
      message: `.gitignore 没有覆盖 ${BASELINE_ROOT}：基线一旦能进历史，就等于给「刷基线自证及格」开了条路（ADR-0015 第 5 条）`,
    })
  }

  // ③ 工作区不许是一份没签字的考卷（有人刚改完判据、还没跑 freeze --write）。
  const criteriaPath = join(repoRoot, EFFECTIVE_CRITERIA)
  const freezePath = join(repoRoot, EFFECTIVE_FREEZE)
  const hasCriteria = existsSync(criteriaPath)
  const hasFreeze = existsSync(freezePath)
  if (hasCriteria !== hasFreeze) {
    violations.push({
      kind: 'signature-pair',
      message: `${hasCriteria ? EFFECTIVE_CRITERIA + ' 在、' + EFFECTIVE_FREEZE + ' 不在' : EFFECTIVE_FREEZE + ' 在、' + EFFECTIVE_CRITERIA + ' 不在'}：`
        + '判据与签字必须同进同出（签字值覆盖整份判据集）',
    })
  } else if (hasCriteria) {
    try {
      guardCriteria({ repoRoot, criteriaText: readNormalizedText(criteriaPath) })
    } catch (error) {
      if (error instanceof CriteriaFrozenError || error instanceof CriteriaError) {
        violations.push({ kind: 'worktree-drift', message: `工作区的判据集与冻结值对不上 —— ${error.message}` })
      } else {
        throw error
      }
    }
  }

  return violations
}

/**
 * 跑一次写入面检查（纯读；测试可直接调用，不起进程）。
 *
 * @param {{repoRoot: string, since?: string}} input
 * @returns {{
 *   since: string, range: string, commits: number,
 *   effectiveCommits: {sha: string, subject: string, paths: string[]}[],
 *   violations: {kind: string, message: string, sha?: string, subject?: string, path?: string, paths?: string[]}[],
 * }}
 */
export function checkAuthority({ repoRoot, since = DEFAULT_BASE_REF }) {
  const commits = listCommits({ repoRoot, since })
  const violations = []
  const effectiveCommits = []

  for (const commit of commits) {
    const paths = commitPaths({ repoRoot, commit })

    // ① 基线出现在提交里：一旦进历史，「刷基线」就成了自证及格通道（ADR-0015 第 5 条）。
    for (const path of paths.filter(isBaselinePath)) {
      violations.push({
        kind: 'baseline-commit',
        sha: commit.sha,
        subject: commit.subject,
        path,
        message: `基线目录不在自动化通道的写入面内（${path}）—— 基线只进 ux-reports/ 报告，且它被 .gitignore 覆盖、不进历史`,
      })
    }

    // ② 判据生效区：只认「与签字同现，且签字算得通」这一种改动。
    const effective = paths.filter(isEffectiveCriteriaPath)
    if (effective.length === 0) continue
    effectiveCommits.push({ sha: commit.sha, subject: commit.subject, paths: effective })

    const rulesChanged = effective.some((path) => path.startsWith(EFFECTIVE_RULES_DIR))
    const hasCriteria = paths.includes(EFFECTIVE_CRITERIA)
    const hasFreeze = paths.includes(EFFECTIVE_FREEZE)

    if (rulesChanged && !hasCriteria) {
      violations.push({
        kind: 'rules-without-projection',
        sha: commit.sha,
        subject: commit.subject,
        paths: effective,
        message: '改了判据族文件 rules/ 却没有重投影 criteria.json —— 判据变更是一整套（rules → criteria.json → freeze.json），'
          + `先跑 ${PROJECT_WRITE}`,
      })
    }

    if (!hasFreeze) {
      violations.push({
        kind: 'missing-freeze',
        sha: commit.sha,
        subject: commit.subject,
        paths: effective,
        message: `改了判据生效区（${effective.join('、')}）但没有同现 ${EFFECTIVE_FREEZE} 签字 —— `
          + `要么改回去，要么重新签字：${PROJECT_WRITE} → ${FREEZE_WRITE}（冻结值不在自动化通道的写入面内）`,
      })
      continue
    }

    const guarded = guardCommitSnapshot({ repoRoot, sha: commit.sha })
    if (!guarded.ok) {
      violations.push({
        kind: 'signature-drift',
        sha: commit.sha,
        subject: commit.subject,
        paths: effective,
        message: `同现了签字，但签字对不上 —— ${guarded.message}`,
      })
    }
  }

  violations.push(...stateViolations({ repoRoot }))

  return {
    since,
    range: since.includes('..') ? since : `${since}..HEAD`,
    commits: commits.length,
    effectiveCommits,
    violations,
  }
}

/** 一条违规的人读一行。 */
export function describeViolation(violation) {
  const who = violation.sha === undefined ? '工作区' : `${shortSha(violation.sha)} ${violation.subject}`
  return `  ✗ ${who}：${violation.message}`
}

function parseArgs(argv) {
  const options = { since: DEFAULT_BASE_REF, repoRoot: DEFAULT_REPO_ROOT, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--since') {
      const value = argv[++index]
      if (value === undefined || value.startsWith('--')) throw new AuthorityError('--since 缺一个 ref')
      options.since = value
    } else if (arg === '--repo') {
      const value = argv[++index]
      if (value === undefined) throw new AuthorityError('--repo 缺一个目录')
      options.repoRoot = resolve(value)
    } else throw new AuthorityError(`未知参数：${arg}（用法见 --help）`)
  }
  return options
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`[ux:authority] ${error.message}`)
    return 2
  }
  if (options.help) {
    console.log('用法：node scripts/check-ux-authority.mjs [--since <ref>] [--repo <dir>]')
    console.log('  判据生效区（criteria.json / rules/** / freeze.json）的改动必须与 freeze.json 同现，且签字算得通；')
    console.log(`  ${BASELINE_ROOT}**/baseline(s)/** 不许进提交；${BASELINE_ROOT} 必须仍被 .gitignore 覆盖。`)
    console.log(`  缺省范围：${DEFAULT_BASE_REF}..HEAD（--since 可换成任意 ref）`)
    console.log('退出码：0 = 写入面干净；1 = 有人绕过了签字 / 基线进了历史；2 = 工具没跑成')
    return 0
  }

  try {
    const repoRoot = resolveRepoRoot({ cwd: options.repoRoot })
    const result = checkAuthority({ repoRoot, since: options.since })
    console.log(
      `[ux:authority] 范围 ${result.range}：${result.commits} 个提交（其中 ${result.effectiveCommits.length} 个动了判据生效区）`,
    )
    console.log(
      '[ux:authority] 写入面：可写 = 源码 / criteria/proposals/ / ux-reports/ 报告与基线；'
        + '不可写 = 判据生效区（criteria.json、rules/**、freeze.json）',
    )
    if (result.violations.length === 0) {
      console.log('[ux:authority] ✅ 通过：生效区的每处改动都有对得上的冻结签字；基线没有进历史；ux-reports/ 仍被 .gitignore 覆盖。')
      return 0
    }
    console.error(`[ux:authority] ✗ 写入面违规 ${result.violations.length} 条：`)
    for (const violation of result.violations) console.error(describeViolation(violation))
    console.error('[ux:authority] 判据的变更权在人：新判据先落 criteria/proposals/，由人搬进 rules/ 后重投影 + 重新冻结。')
    return 1
  } catch (error) {
    if (error instanceof AuthorityError || error instanceof GitRangeError) {
      console.error(`[ux:authority] 检查没跑成：${error.message}`)
      return 2
    }
    throw error
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}

export { main }
