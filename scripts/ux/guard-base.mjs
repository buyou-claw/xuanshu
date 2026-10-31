/**
 * `scripts/ux/guard-base.mjs` —— **修复护栏的基准分支**（spec 003 §修复通道 · 票 10 的补丁）。
 *
 * 为什么单独一份：`check-ux-authority` 与 `check-ux-fix-notes` 必须对「从哪儿起算」给出
 * 同一个答案。原来两处都把基准硬编码成集成分支 `feat/spec-003-integration`，
 * 于是**在集成分支自己身上跑**时范围是 `feat/spec-003-integration..HEAD` = 0 个提交 ——
 * 检查真空通过（`commits=0`）。这不是「没有违规」，是「没有看」（2026-10-31 实测踩到）。
 *
 * 硬编码成 `main` 也不行：每张票的分支都从集成分支切出去，从 `main` 起算会把整条
 * spec 分支的历史都算成「本票的改动」，守卫第一天就红一片，第二天所有人都会加
 * `--since` 绕开它 —— 一个总被绕开的守卫等于没有。
 *
 * 所以按**当前分支**决定基准：
 *   - 在集成分支上 → 以 `main` 为基准（要合进去的东西都该被看）
 *   - 在票分支上   → 以集成分支为基准（只看本票引入的改动）
 *   - 都没有       → `main`
 *
 * 只读 git（rev-parse / branch 存在性），不读文件、不写任何东西。ESM。
 */
import { execFileSync } from 'node:child_process'

/** spec 003 的集成分支。改名时只改这里。 */
export const INTEGRATION_BRANCH = 'feat/spec-003-integration'

/** 主干。 */
export const TRUNK_BRANCH = 'main'

function gitText(args, repoRoot) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

/**
 * 当前分支名。分离头指针时返回 `HEAD`。
 * @param {{repoRoot: string}} input
 */
export function currentBranch({ repoRoot }) {
  return gitText(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)
}

/**
 * 这个分支名在本地或远端存在吗。
 * @param {{repoRoot: string, name: string}} input
 */
export function branchExists({ repoRoot, name }) {
  for (const ref of [`refs/heads/${name}`, `refs/remotes/origin/${name}`]) {
    try {
      gitText(['rev-parse', '--verify', '--quiet', ref], repoRoot)
      return true
    } catch {
      /* 试下一个 */
    }
  }
  return false
}

/**
 * 解析护栏的基准 ref。
 *
 * @param {{repoRoot: string, explicit?: string}} input
 *   `explicit` 来自 CLI 的 `--since`；给了就用它（人明确要看哪一段）。
 * @returns {{ref: string, branch: string, reason: string}}
 */
export function resolveBaseRef({ repoRoot, explicit }) {
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    return { ref: explicit.trim(), branch: currentBranch({ repoRoot }), reason: '显式指定了 --since' }
  }
  const branch = currentBranch({ repoRoot })
  if (branch === INTEGRATION_BRANCH) {
    return {
      ref: TRUNK_BRANCH,
      branch,
      reason: `当前就在集成分支上，基准取 ${TRUNK_BRANCH}（拿自己比自己等于永远合规）`,
    }
  }
  if (branch === TRUNK_BRANCH) {
    // 主干上「本分支相对基线新增了什么」本来就是空集 —— 这是正确答案，不是漏看。
    // 工作区的东西照样会被检查（冻结值配对、基线是否进历史）。
    return {
      ref: TRUNK_BRANCH,
      branch,
      reason: `当前在 ${TRUNK_BRANCH} 上，基准就是它自己（主干没有「本票改动」；工作区仍会检查）`,
    }
  }
  if (branchExists({ repoRoot, name: INTEGRATION_BRANCH })) {
    return {
      ref: INTEGRATION_BRANCH,
      branch,
      reason: `当前在票分支上，基准取集成分支（只看本票引入的改动）`,
    }
  }
  return {
    ref: TRUNK_BRANCH,
    branch,
    reason: `没有集成分支，基准取 ${TRUNK_BRANCH}`,
  }
}
