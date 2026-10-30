/**
 * `scripts/ux/repair-channel.mjs` —— **修复通道的词表**（spec 003 §修复通道的约定 19–20 · 票 10 / #57）。
 *
 * 为什么单独一份：修复说明（`check-ux-fix-notes.mjs`）与写入面（`check-ux-authority.mjs`）
 * 必须对「什么算客户端源码 / 什么算判据生效区 / 基线落在哪」给出**同一个答案**。
 * 两处各写一份正则，迟早出现「说明检查放行、写入面检查拦下」的岔口——而这类岔口
 * 正是守卫失去信任的方式（看提示的人不知道该按哪一条办）。
 *
 * 这里只有常量与两个纯谓词；不读文件、不调 git、不读时钟。
 */
import { CRITERIA_DIR, CRITERIA_FILE, CRITERIA_RULES_DIR } from './project.mjs'
import { FREEZE_FILE } from './freeze.mjs'

/** 修复的范围：只有动了这个前缀的提交才需要修复说明（文档票 / 测试票不该被拦）。 */
export const CLIENT_SCOPE = 'packages/xuanshu-client/'

/** 修复说明的机器可读前缀。改它等于改协议：解析器与 README §4 必须同时改。 */
export const FIX_NOTE_PREFIX = 'UX-FIX:'

/** 修复说明的形状（拒绝提示里原样给出，读提示的人可以照抄）。 */
export const FIX_NOTE_SHAPE = 'UX-FIX: <判据 id> | <改了什么> | <证据 file:line>'

/**
 * 修复通道的缺省基线：spec 003 的集成分支。
 *
 * 为什么默认是它而不是 `main`：每张票的分支都从这里切出去（AGENTS「并行实现」），
 * 从 `main` 起算会把整条 spec 分支的历史都算成「本票的修复提交」——守卫第一天就红一片，
 * 第二天所有人都会加 `--since` 绕开它。别的分支用 `--since <ref>` 显式给。
 */
export const DEFAULT_BASE_REF = 'feat/spec-003-integration'

/** 报告与基线的落点（被 `.gitignore` 覆盖；基线**不进历史**）。 */
export const BASELINE_ROOT = 'ux-reports/'

/**
 * 基线目录的机检形状：`ux-reports/<…>/baseline/` 或 `ux-reports/baselines/`。
 * 单复数都收：README 里定的落点是 `ux-reports/baselines/`，但历史约定里也出现过单数。
 */
export const BASELINE_PATTERN = /^ux-reports\/(?:.*\/)?baselines?\//u

/** 判据生效区的三处（ADR-0015 第 6 条：生效判据由人改，AI 只能写 proposals/）。 */
export const EFFECTIVE_CRITERIA = CRITERIA_FILE
export const EFFECTIVE_FREEZE = FREEZE_FILE
export const EFFECTIVE_RULES_DIR = `${CRITERIA_RULES_DIR}/`

/** 提案区（AI 可以写；不在生效区内，也不在任何一条检查的拦截范围里）。 */
export const PROPOSALS_DIR = `${CRITERIA_DIR}/proposals/`

/**
 * 这个路径是不是客户端源码（修复说明的触发条件）。
 * @param {string} path - 仓库相对 posix 路径
 */
export function isClientPath(path) {
  return path.startsWith(CLIENT_SCOPE)
}

/**
 * 这个路径是不是判据生效区（写入面检查的触发条件）。
 * 注意：`proposals/` 在 `criteria/` 下面但**不属于**生效区——显式排除由调用点按前缀自然完成
 * （proposals 不在 rules/ 下，也不等于 criteria.json / freeze.json）。
 * @param {string} path - 仓库相对 posix 路径
 */
export function isEffectiveCriteriaPath(path) {
  return path === EFFECTIVE_CRITERIA || path === EFFECTIVE_FREEZE || path.startsWith(EFFECTIVE_RULES_DIR)
}

/**
 * 这个路径是不是基线落点（基线不进历史的机检形状）。
 * @param {string} path - 仓库相对 posix 路径
 */
export function isBaselinePath(path) {
  return BASELINE_PATTERN.test(path)
}

/**
 * 这个路径是不是提案区（AI 的合法写入面；写入面检查**不**拦它）。
 * @param {string} path - 仓库相对 posix 路径
 */
export function isProposalPath(path) {
  return path.startsWith(PROPOSALS_DIR)
}
