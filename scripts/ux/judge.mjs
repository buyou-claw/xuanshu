#!/usr/bin/env node
/**
 * `scripts/ux/judge.mjs` —— **唯一判定点**（spec 003 · 模块 4）。
 *
 * 契约（这三条是 spec 的 Testing Decisions 明确钉过的）：
 *   1. **纯函数**：`run({criteria, evidence, assertions, faces})` 不读文件、不读时钟、不起浏览器。
 *      同一份输入必须给同一份输出 —— 否则「兑现率」这个数字不可复现，也就不是判据。
 *   2. **不区分来源**：静态采集器与浏览器采集器给的是同一种证据形状，判定器不看 `collector` 字段
 *      来决定严不严（否则「换个采集器就变绿」会成为一条逃生通道）。
 *   3. **未采到 ≠ 通过**：没有证据、采集失败都是独立状态，不进 `pass` 计数。
 *
 * 判定逻辑本身不在这里，而在 `scripts/ux/assertions/<族>.mjs`：一条判据一个纯谓词。
 * 本文件只负责「配对 → 找证据 → 调谓词 → 归一成 verdict」。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { ASSERTIONS } from './assertions/index.mjs'
import { applicableFaces } from './scope.mjs'

/** verdict 的五个状态。**没有第六个**：任何「拿不准」都必须落进其中一个可解释的口袋。 */
export const VERDICT_STATUSES = ['pass', 'fail', 'not-collected', 'collection-failed', 'human-only']

/** 判定器的可读失败（装配错误，不是断言红）。 */
export class JudgeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'JudgeError'
  }
}

/** 证据的主键：一条判据 × 一个界面面只能有一份证据，重复即歧义。 */
function evidenceKey(criterionId, faceId) {
  return `${criterionId}\u0000${faceId}`
}

/**
 * 跑判定。
 *
 * @param {{
 *   criteria: {criteria: object[]},
 *   evidence: object[],
 *   faces: object[],
 *   assertions?: Record<string, (facts: object) => {pass: boolean, message?: string}>,
 * }} input
 * @returns {{verdicts: object[], counts: Record<string, number>}}
 * @throws {JudgeError} 机器判据缺谓词 / 证据重复 / 谓词不返回布尔
 */
export function run({ criteria, evidence, faces, assertions = ASSERTIONS }) {
  // ① 机器判据必须有谓词。缺了就说清是哪条，不静默当成「通过」。
  const missing = criteria.criteria
    .filter((criterion) => criterion.tombstone !== true && criterion.check !== 'human-only')
    .filter((criterion) => typeof assertions[criterion.id] !== 'function')
    .map((criterion) => criterion.id)
  if (missing.length > 0) {
    throw new JudgeError(
      `这些机器判据没有判定谓词：${missing.join('、')}（在 scripts/ux/assertions/ 里补，或改成 human-only 并写理由）`,
    )
  }

  // ② 证据索引：同一 (判据, 面) 出现两次就是歧义，直接拒。
  const byKey = new Map()
  for (const item of evidence) {
    const key = evidenceKey(item.criterionId, item.faceId ?? item.face)
    if (byKey.has(key)) throw new JudgeError(`证据重复：${item.criterionId} × ${item.faceId ?? item.face}`)
    byKey.set(key, item)
  }

  const verdicts = []
  for (const criterion of criteria.criteria) {
    if (criterion.tombstone === true) continue
    for (const face of applicableFaces(criterion, faces)) {
      const base = {
        criterionId: criterion.id,
        family: criterion.family,
        face: face.id,
        severity: criterion.severity,
        statement: criterion.statement,
      }
      if (criterion.check === 'human-only') {
        verdicts.push({ ...base, status: 'human-only', message: criterion.humanReason, evidence: [] })
        continue
      }
      const item = byKey.get(evidenceKey(criterion.id, face.id))
      if (item === undefined) {
        verdicts.push({ ...base, status: 'not-collected', message: '采集器没有给出这个界面面的证据（未采到 ≠ 通过）', evidence: [] })
        continue
      }
      if (item.status === 'collection-failed') {
        verdicts.push({ ...base, status: 'collection-failed', message: `采集失败：${item.reason ?? '原因未给'}`, evidence: [] })
        continue
      }
      const judged = assertions[criterion.id](item.facts)
      if (typeof judged?.pass !== 'boolean') {
        throw new JudgeError(`判据 ${criterion.id} 的谓词没有返回 {pass: boolean}（返回了 ${JSON.stringify(judged)}）`)
      }
      verdicts.push({
        ...base,
        status: judged.pass ? 'pass' : 'fail',
        message: judged.message ?? '',
        evidence: item.evidence ?? [],
      })
    }
  }

  const counts = Object.fromEntries(VERDICT_STATUSES.map((status) => [status, 0]))
  for (const verdict of verdicts) counts[verdict.status] += 1
  return { verdicts, counts }
}
