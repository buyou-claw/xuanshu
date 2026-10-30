#!/usr/bin/env node
/**
 * `scripts/ux/assertions/d.mjs` —— 判据族 D（密度与点击目标）的判定。
 *
 * 输入是**真实浏览器量出来的**事实（`getBoundingClientRect` 的矩形、`querySelectorAll` 命中的
 * 主按钮），不是读源码猜的尺寸 —— 所以这一族只能由浏览器半边喂证据；静态半边喂不出它
 * （喂不出就是「未采到」）。
 *
 * D-001 由票 07 落地（语义不动：一个目标的最小边 < 44 就算红）。
 * D-002 由票 09 / #56 补上：**任一时刻**一屏可见的主操作 ≤ 1 —— 它吃的是「快照」而不是并集，
 * 因为同一屏在两个状态里各有一个主按钮（先「创建新谱」后「开始转换」）不算并列主操作。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { VISUAL_THRESHOLDS } from './visual-thresholds.mjs'

/** 留白档的最小可点目标（spec 003 §视觉档位；与 ADR-0015 的 comfortable 档一致）。 */
export const MIN_TARGET = VISUAL_THRESHOLDS.MIN_TARGET

/** 一行摘要：把最小的几个目标点名（人一眼能去改哪一个）。 */
function smallest(targets, limit = 6) {
  const sorted = [...targets].sort((left, right) => Math.min(left.width, left.height) - Math.min(right.width, right.height))
  return sorted
    .slice(0, limit)
    .map((target) => `${target.label === '' ? target.tag : target.label} ${target.width}×${target.height}`)
    .join('、')
}

/** 一次快照里的主操作数量（采集器给 `{count, buttons}`；两个字段任一可信）。 */
function snapshotCount(snapshot) {
  if (Array.isArray(snapshot?.buttons)) return snapshot.buttons.length
  const count = Number(snapshot?.count)
  return Number.isFinite(count) && count >= 0 ? count : 0
}

/** 一次快照里主操作的文本（点名用）。 */
function snapshotLabels(snapshot) {
  return (Array.isArray(snapshot?.buttons) ? snapshot.buttons : [])
    .map((button) => (button.label === '' ? button.tag : button.label))
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

  /**
   * D-002：任一时刻一屏可见的主操作（`.xs-btn--primary`）≤ 1。
   * @param {{primaryActions: {count: number, buttons: {tag: string, label: string}[]}[]}} facts
   */
  'D-002': (facts) => {
    const snapshots = Array.isArray(facts?.primaryActions) ? facts.primaryActions : []
    if (snapshots.length === 0) {
      // 没量到快照 = 这个面当时不在场；不能当成「零个主操作，所以合规」。
      return { pass: false, message: '没有量到任何主操作快照：这个面当时不在场，证据不足以判过' }
    }
    const counts = snapshots.map(snapshotCount)
    const max = Math.max(...counts)
    if (max <= VISUAL_THRESHOLDS.MAX_PRIMARY_ACTIONS) {
      return {
        pass: true,
        message: `主操作最多 ${max} 个（上限 ${VISUAL_THRESHOLDS.MAX_PRIMARY_ACTIONS}），共 ${snapshots.length} 次快照`,
      }
    }
    const worst = snapshots[counts.indexOf(max)]
    const labels = snapshotLabels(worst)
    return {
      pass: false,
      message:
        `某一时刻有 ${max} 个并列主操作（上限 ${VISUAL_THRESHOLDS.MAX_PRIMARY_ACTIONS}）：`
        + `${labels === '' ? '(无文本)' : labels}`,
    }
  },
}
