#!/usr/bin/env node
/**
 * `scripts/ux/scope.mjs` —— 判据的**适用范围**（一条纯函数，采集器与判定器共用一份）。
 *
 * 为什么单独一层：分母 = 界面面 × 判据适用数。如果「哪些面适用」由采集器算一遍、
 * 判定器再算一遍，两处一旦不一致，兑现率就会算在一个谁也没验过的分母上。
 *
 * 仅使用 Node 内置模块。ESM。
 */

/**
 * @param {{appliesTo: {kind: string, ids?: string[]}}} criterion
 * @param {{id: string, kind: string}[]} faces
 * @returns {{id: string, kind: string, category?: string, label?: string, sources?: string[]}[]} 适用的界面面（保持清单顺序）
 */
export function applicableFaces(criterion, faces) {
  const scope = criterion.appliesTo ?? { kind: 'all' }
  if (scope.kind === 'all') return faces
  if (scope.kind === 'panel') return faces.filter((face) => face.kind === 'panel')
  if (scope.kind === 'parasitic') return faces.filter((face) => face.kind === 'parasitic')
  if (scope.kind === 'ids') {
    const wanted = new Set(scope.ids)
    return faces.filter((face) => wanted.has(face.id))
  }
  throw new Error(`scope: 未知的 appliesTo.kind「${scope.kind}」`)
}

/**
 * 一条判据的全部（面 × 判据）配对——这就是报告分母的原始清单。
 * @param {{criteria: {id: string, check: string, tombstone?: boolean}[]}} criteriaDocument
 * @param {{id: string, kind: string}[]} faces
 * @returns {{criterionId: string, faceId: string}[]}
 */
export function applicablePairs(criteriaDocument, faces) {
  const pairs = []
  for (const criterion of criteriaDocument.criteria) {
    if (criterion.tombstone === true) continue
    for (const face of applicableFaces(criterion, faces)) pairs.push({ criterionId: criterion.id, faceId: face.id })
  }
  return pairs
}
