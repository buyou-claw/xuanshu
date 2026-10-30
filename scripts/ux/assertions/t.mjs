#!/usr/bin/env node
/**
 * `scripts/ux/assertions/t.mjs` —— 判据族 T 的**判定**（「算不算过」只在这里与 judge 里出现）。
 *
 * 形状：`(facts) => { pass, message }`。**不读文件、不碰环境**：给它同一份 facts，它必须给同一个答案，
 * 否则兑现率不可复现。
 *
 * 仅使用 Node 内置模块。ESM。
 */

/** 把命中的位置压成一行可读摘要（超过 6 处就收尾，避免报告被一行刷爆）。 */
function summarize(occurrences, limit = 6) {
  const shown = occurrences.slice(0, limit).map((occurrence) => `${occurrence.file}:${occurrence.line}（${occurrence.literal}）`)
  const rest = occurrences.length - shown.length
  return rest > 0 ? `${shown.join('、')} 等 ${occurrences.length} 处` : shown.join('、')
}

export const T_ASSERTIONS = {
  /**
   * T-001：样式里不许出现字面色值。
   * @param {{occurrences: {file: string, line: number, literal: string}[], scannedFiles: number}} facts
   */
  'T-001': (facts) => {
    const occurrences = facts?.occurrences ?? []
    if (occurrences.length === 0) return { pass: true, message: '没有字面色值' }
    return {
      pass: false,
      message: `命中 ${occurrences.length} 处字面色值：${summarize(occurrences)}`,
    }
  },
}
