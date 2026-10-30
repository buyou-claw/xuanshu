#!/usr/bin/env node
/**
 * `scripts/ux/assertions/d.mjs` —— 判据族 D（密度与点击目标）的判定。
 *
 * 输入是**真实浏览器量出来的矩形**（`getBoundingClientRect`），不是读源码猜的尺寸 ——
 * 所以这条判据只能由浏览器半边喂证据；静态半边喂不出它（喂不出就是「未采到」）。
 *
 * 仅使用 Node 内置模块。ESM。
 */

/** 留白档的最小可点目标（spec 003 §视觉档位；与 ADR-0015 的 comfortable 档一致）。 */
export const MIN_TARGET = 44

/** 一行摘要：把最小的几个目标点名（人一眼能去改哪一个）。 */
function smallest(targets, limit = 6) {
  const sorted = [...targets].sort((left, right) => Math.min(left.width, left.height) - Math.min(right.width, right.height))
  return sorted
    .slice(0, limit)
    .map((target) => `${target.label === '' ? target.tag : target.label} ${target.width}×${target.height}`)
    .join('、')
}

export const D_ASSERTIONS = {
  /**
   * D-001：可点目标 ≥ 44×44。
   * @param {{targets: {tag: string, label: string, width: number, height: number}[]}} facts
   */
  'D-001': (facts) => {
    const targets = Array.isArray(facts?.targets) ? facts.targets : []
    if (targets.length === 0) {
      // 一个可点目标都没量到：这不是「没问题」，是没采到（采集器本该在面不在场时留空证据）。
      return { pass: false, message: '没有量到任何可点目标：这个面当时不在场，证据不足以判过' }
    }
    const tooSmall = targets.filter((target) => target.width < MIN_TARGET || target.height < MIN_TARGET)
    if (tooSmall.length === 0) return { pass: true, message: `全部 ${targets.length} 个目标都 ≥ ${MIN_TARGET}×${MIN_TARGET}` }
    return {
      pass: false,
      message: `${tooSmall.length}/${targets.length} 个可点目标小于 ${MIN_TARGET}×${MIN_TARGET}：${smallest(tooSmall)}`,
    }
  },
}
