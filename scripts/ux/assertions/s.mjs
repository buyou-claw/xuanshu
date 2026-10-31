#!/usr/bin/env node
/**
 * `scripts/ux/assertions/s.mjs` —— 判据族 `S` 的**判定**（「算不算过」只在这里与 `judge.mjs`）。
 *
 * 形状：`(facts) => { pass, message }`。**不读文件、不碰环境**：同一份 facts 必须给同一个答案。
 * 判定口径与采集口径是同一条：同一源文件里「有该状态的分支」且「有一句可见说明」。
 *
 * 仅使用 Node 内置模块。ESM。
 */

/** 缺席原因的短句（与采集器的长句分开：报告里一行要读得完）。 */
const MISSING_TEXT = {
  branch: '没有该状态的分支（没有条件、没有状态标记属性）',
  visual: '没有可见说明（没有中文提示；加载态也没有骨架屏）',
  'same-file': '分支与说明不在同一个源文件里',
}

/**
 * 三态共用的判定。
 * @param {{state: string, label: string, present: boolean, missing: string[], branch: object, visual: object, filesWithBoth: string[], scannedFiles: number, anchor: object}} facts
 * @returns {{pass: boolean, message: string}}
 */
function judgeState(facts) {
  const label = facts?.label ?? '该状态'
  if (facts?.present === true) {
    const where = facts.filesWithBoth?.[0] ?? '(未知文件)'
    return {
      pass: true,
      message: `${label}在场（${where}：分支 ${facts.branch?.count ?? 0} 处 + 说明 ${facts.visual?.count ?? 0} 处）`,
    }
  }
  const reason = (facts?.missing ?? []).map((key) => MISSING_TEXT[key] ?? key).join('；') || '未采到'
  const scanned = facts?.scannedFiles ?? 0
  return {
    pass: false,
    message: `缺${label}：扫了 ${scanned} 个源文件，${reason}`,
  }
}

export const S_ASSERTIONS = {
  /** S-001：空态。 */
  'S-001': judgeState,
  /** S-002：加载态。 */
  'S-002': judgeState,
  /** S-003：错误态。 */
  'S-003': judgeState,
}
