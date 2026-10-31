#!/usr/bin/env node
/**
 * `scripts/ux/visual-metrics.mjs` —— **视觉档实测值**（spec 003 · 票 09 / #56 的报告要求）。
 *
 * 报告要回答一句很朴素的话：「每一面**最小**的点击目标是多少、**最低**的对比度是多少」。
 * 这不是判定（判定在 `scripts/ux/assertions/`），也不是采集（采集只收原始值）——它是
 * 「把已经采到的原始事实收成一个极值表」，两者都不重复：
 *   - 判定：`D-001` 逐个目标比 44、`C-003` 逐句比 AA —— 产出**通过与否**；
 *   - 实测：`visualMetricsOf()` 只报**极值**（最小 / 最低 / 最多），不产出通过与否。
 *
 * 因此本文件里没有 `pass` / `fail` 字样：读报告的人不该从这一节读到结论，
 * 他该读到的是数字，然后去看第 2 段 blocker 与第 1 段回退。
 *
 * 为什么极值而不是平均值：平均值会把「有一个 90×32 的主按钮」这种该立刻修的事抹平。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { contrastRatio } from './assertions/c.mjs'
import { VISUAL_THRESHOLDS } from './assertions/visual-thresholds.mjs'

/** 实测值块的 schema（报告器与「读报告的下一步」靠它对齐）。 */
export const VISUAL_METRICS_SCHEMA = 'xuanshu/ux-visual-metrics@1'

/** 数字统一留两位，免得报告里出现 1.2000000000000002 这种噪声。 */
const round2 = (value) => Math.round(value * 100) / 100

function extremesOfTargets(targets) {
  let smallest = null
  for (const target of targets) {
    const edge = Math.min(Number(target.width), Number(target.height))
    if (!Number.isFinite(edge)) continue
    if (smallest === null || edge < smallest.edge) {
      smallest = { edge, label: target.label ?? '', tag: target.tag ?? '', width: target.width, height: target.height }
    }
  }
  if (smallest === null) return null
  return { label: smallest.label, tag: smallest.tag, width: smallest.width, height: smallest.height }
}

function extremesOfContrast(bodyTexts) {
  let lowest = null
  for (const text of bodyTexts) {
    const ratio = contrastRatio(text.color, text.backgroundColor)
    if (ratio === null) continue
    if (lowest === null || ratio < lowest.ratio) {
      lowest = {
        ratio,
        text: String(text.text ?? '').slice(0, 24),
        selector: text.selector ?? '',
        fontSize: text.fontSize ?? null,
      }
    }
  }
  return lowest === null ? null : { ...lowest, ratio: round2(lowest.ratio) }
}

function countOfPrimary(primaryActions) {
  let max = null
  for (const snapshot of primaryActions) {
    const count = Array.isArray(snapshot?.buttons) ? snapshot.buttons.length : Number(snapshot?.count)
    if (!Number.isFinite(count)) continue
    max = max === null ? count : Math.max(max, count)
  }
  return max
}

/**
 * 从证据里收出「每面视觉档实测值」。
 *
 * 只认浏览器半边：这些数字静态半边量不出来（源码里读不到计算样式）。同一条判据 × 同一个面
 * 只留一份证据（判定器会拒绝重复证据），所以命中第一份就够，不必去重。
 *
 * @param {{evidence: object[], faces: {id: string, label?: string}[]}} input
 * @returns {{schema: string, thresholds: object, faces: object[], totals: object}}
 */
export function visualMetricsOf({ evidence, faces = [] }) {
  const labelOf = new Map(faces.map((face) => [face.id, face.label ?? '']))
  const factsByFace = new Map()
  for (const item of evidence) {
    if (item?.collector !== 'browser') continue
    const faceId = item.faceId ?? item.face
    // 只吃 `measure()` 产的那份样本（有 `targets` / `bodyTexts`）。浏览器半边不止一种证据：
    // 导航族 N 采的是入口表 / 落点 / Tab 走查（票 08b），它同样 `status: 'observed'`，但里面没有尺寸 ——
    // 混进来会让「这一面」取到一份空样本，报出一张「最小点击目标 无」的假表。
    if (item.status === 'observed' && !Array.isArray(item.facts?.targets) && !Array.isArray(item.facts?.bodyTexts)) continue
    if (factsByFace.has(faceId)) continue
    if (item.status !== 'observed' || item.facts === null || typeof item.facts !== 'object') {
      factsByFace.set(faceId, null) // 采到了「没采成」：也要出现在表里，不能让这个面悄悄消失
      continue
    }
    factsByFace.set(faceId, item.facts)
  }

  const rows = []
  for (const [face, facts] of factsByFace) {
    if (facts === null) {
      rows.push({
        face,
        label: labelOf.get(face) ?? '',
        measured: false,
        smallestTarget: null,
        lowestContrast: null,
        primaryActionsMax: null,
        bodyTexts: 0,
      })
      continue
    }
    const targets = Array.isArray(facts.targets) ? facts.targets : []
    const bodyTexts = Array.isArray(facts.bodyTexts) ? facts.bodyTexts : []
    const primaryActions = Array.isArray(facts.primaryActions) ? facts.primaryActions : []
    rows.push({
      face,
      label: labelOf.get(face) ?? '',
      measured: true,
      smallestTarget: extremesOfTargets(targets),
      lowestContrast: extremesOfContrast(bodyTexts),
      primaryActionsMax: countOfPrimary(primaryActions),
      bodyTexts: bodyTexts.length,
    })
  }
  rows.sort((left, right) => left.face.localeCompare(right.face))

  const measuredRows = rows.filter((row) => row.measured)
  const smallest = measuredRows
    .filter((row) => row.smallestTarget !== null)
    .sort((left, right) => Math.min(left.smallestTarget.width, left.smallestTarget.height) - Math.min(right.smallestTarget.width, right.smallestTarget.height))[0]
  const lowest = measuredRows
    .filter((row) => row.lowestContrast !== null)
    .sort((left, right) => left.lowestContrast.ratio - right.lowestContrast.ratio)[0]
  const mostPrimary = measuredRows
    .filter((row) => row.primaryActionsMax !== null)
    .sort((left, right) => right.primaryActionsMax - left.primaryActionsMax)[0]

  return {
    schema: VISUAL_METRICS_SCHEMA,
    thresholds: { ...VISUAL_THRESHOLDS },
    faces: rows,
    totals: {
      faces: rows.length,
      measured: measuredRows.length,
      textElements: measuredRows.reduce((sum, row) => sum + row.bodyTexts, 0),
      smallestTarget: smallest === undefined ? null : { face: smallest.face, ...smallest.smallestTarget },
      lowestContrast: lowest === undefined ? null : { face: lowest.face, ...lowest.lowestContrast },
      primaryActionsMax: mostPrimary === undefined ? null : { face: mostPrimary.face, value: mostPrimary.primaryActionsMax },
    },
  }
}
