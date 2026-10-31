#!/usr/bin/env node
/**
 * `scripts/ux/assertions/x.mjs` —— 判据族 `X` 的**判定**（文案一致性）。
 *
 * 三个红条件，按严重度排：
 *   1. 用了族字典**禁止**的同义替换（「暂无」/「加载中」/「读取中」/「错误」…）——两种说法并存；
 *   2. 有错误行却**没有可执行的下一步**（没有重试 / 换个 / 请在…）；
 *   3. **一个状态文案都没有**：证明不了「同一套说法」（与 S 族同因，不当成通过）。
 *
 * 只拿 facts，不读文件。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { STATES, STATE_LABEL } from '../state-vocabulary.mjs'

export const X_ASSERTIONS = {
  /**
   * X-001：同一状态用同一套说法 + 错误行可执行。
   * @param {{wordingCount: number, violations: object[], errorPresent: boolean, errorActionable: {count: number}, perState: object}} facts
   */
  'X-001': (facts) => {
    const violations = facts?.violations ?? []
    if (violations.length > 0) {
      const shown = violations.slice(0, 3).map((violation) => `${STATE_LABEL[violation.state] ?? violation.state}「${violation.token}」@${violation.file}:${violation.line}`)
      const rest = violations.length - shown.length
      return {
        pass: false,
        message: `说法不一致：${shown.join('、')}${rest > 0 ? ` 等 ${violations.length} 处` : ''}（族字典只允许一套说法）`,
      }
    }

    if (facts?.errorPresent === true && (facts?.errorActionable?.count ?? 0) === 0) {
      return { pass: false, message: '有错误行，但旁边没有可执行的下一步（重试 / 换个 / 请在…）' }
    }

    const wordingCount = facts?.wordingCount ?? 0
    if (wordingCount === 0) {
      return { pass: false, message: '本面没有任何状态文案，无法证明「同一套说法」（与 S 族同因，不算通过）' }
    }

    const perState = facts?.perState ?? {}
    const summary = STATES.filter((state) => (perState[state]?.canonicalCount ?? 0) > 0)
      .map((state) => `${STATE_LABEL[state]} ${perState[state].canonicalCount} 处`)
      .join(' / ')
    return {
      pass: true,
      message: `说法一致（${summary || `${wordingCount} 处`}）${facts?.errorPresent === true ? ' · 错误行有下一步' : ''}`,
    }
  },
}
