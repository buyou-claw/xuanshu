#!/usr/bin/env node
/**
 * `scripts/ux/assertions/c.mjs` —— 判据族 C（对比度与可读性）的判定。
 *
 * 三条判据全部吃**真实计算样式**（`getComputedStyle`）：采集器只把 `fontSize` / `lineHeight` /
 * `color` / `backgroundColor` 这些**原始值**搬回来，比值与阈值比较只发生在这里
 * （spec 003 · 票 09 / #56：采集只收证据，判定只有一个地方）。
 *
 * 比值的两个纯函数（`contrastRatio` / `lineHeightRatio`）**导出去**：报告器要用它们算
 * 「每面最低对比度」这类实测值 —— 但报告只显示数值、不产生通过与否，所以阈值比较仍然只在本文件。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { VISUAL_THRESHOLDS as V } from './visual-thresholds.mjs'

/**
 * 解析 `rgb()/rgba()` 计算值。
 * @param {string} css
 * @returns {{r: number, g: number, b: number, a: number} | null}
 */
export function parseCssColor(css) {
  if (typeof css !== 'string') return null
  const match = /^rgba?\(([^)]+)\)$/.exec(css.trim())
  if (match === null) return null
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
}

/** sRGB 通道的线性化（WCAG 2.1 相对亮度定义里的那一段）。 */
function linearize(channel) {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/**
 * 相对亮度（WCAG 2.1 §relative luminance，0 = 黑，1 = 白）。
 * @param {{r: number, g: number, b: number}} rgb
 */
export function relativeLuminance({ r, g, b }) {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/**
 * 两色的对比度比值（1..21）。**只算数，不判过不过**：阈值比较在谓词里。
 *
 * 前景带 alpha（`rgba(…, 0.6)`）时先按背景合成 —— 否则半透明文字会被算成比实际更清楚。
 * 解析不出颜色就返回 `null`（调用方必须把它当成「没算出来」，不是「没问题」）。
 *
 * @param {string} foreground - `color` 的计算值
 * @param {string} background - 有效背景色（采集器已向上合成到不透明，见 `collect/browser.mjs`）
 * @returns {number | null} 保留两位小数；算不出时为 null
 */
export function contrastRatio(foreground, background) {
  const fg = parseCssColor(foreground)
  const bg = parseCssColor(background)
  if (fg === null || bg === null) return null
  const alpha = Math.min(Math.max(fg.a, 0), 1)
  const composited = {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
  }
  const light = Math.max(relativeLuminance(composited), relativeLuminance(bg))
  const dark = Math.min(relativeLuminance(composited), relativeLuminance(bg))
  const ratio = (light + 0.05) / (dark + 0.05)
  return Math.round(ratio * 100) / 100
}

/**
 * 行高 / 字号 的比值。`line-height: normal` 没有给出比值 —— 返回 `null`，
 * 由谓词把它算成「低于下限」（而不是猜一个 1.2 蒙过去）。
 * @param {{fontSize?: number|string, lineHeight?: number|string}} text
 * @returns {number | null}
 */
export function lineHeightRatio(text) {
  const fontSize = Number(text?.fontSize)
  const lineHeight = text?.lineHeight
  if (!(fontSize > 0)) return null
  if (typeof lineHeight !== 'number' && typeof lineHeight !== 'string') return null
  if (typeof lineHeight === 'string' && lineHeight.trim() === 'normal') return null
  const pixels = Number(lineHeight)
  if (!(pixels > 0) || Number.isNaN(pixels)) return null
  return Math.round((pixels / fontSize) * 1000) / 1000
}

/**
 * WCAG 的「大字」判定：≥ 24px，或 ≥ 18.66px 且字重 ≥ 700。大字下限是 3:1，其余 4.5:1。
 * @param {{fontSize?: number|string, fontWeight?: number|string}} text
 */
export function isLargeText(text) {
  const fontSize = Number(text?.fontSize)
  const fontWeight = Number(text?.fontWeight)
  if (!(fontSize > 0)) return false
  if (fontSize >= V.LARGE_TEXT_PX) return true
  return fontSize >= V.LARGE_TEXT_BOLD_PX && fontWeight >= V.LARGE_TEXT_BOLD_WEIGHT
}

/** 一条红色要点名道具体文字（人一眼能去改哪一句）。 */
function nameOf(text, limit = 14) {
  const label = String(text?.text ?? '').replace(/\s+/g, ' ').trim()
  const shown = label.slice(0, limit)
  return `${shown}${label.length > limit ? '…' : ''}（${text?.selector ?? '?'}）`
}

/** 最小的几个（按给定数值升序），供消息里点名。 */
function smallestBy(texts, valueOf, limit = 4) {
  return [...texts]
    .map((text) => ({ text, value: valueOf(text) }))
    .sort((left, right) => left.value - right.value)
    .slice(0, limit)
}

function bodyTextsOf(facts) {
  return Array.isArray(facts?.bodyTexts)
    ? facts.bodyTexts.filter((text) => text !== null && typeof text === 'object')
    : []
}

const EMPTY = '没有量到任何文字元素（正文级）：这个面当时不在场，证据不足以判过'

export const C_ASSERTIONS = {
  /**
   * C-001：正文级文字的计算字号 ≥ 16px（留白档下限）。
   *
   * **只判正文**：`role === 'meta'` 的文字（tag / badge / 状态行 / 路径 / 计数）天生该小，
   * 不参与 16px 下限 —— 否则唯一的「通过」方式是把整屏调成同号，那会压平层级（L-001 要防的正是这个）。
   * 没有 `role` 字段的旧证据按正文处理（保守：宁可判红，也不悄悄放过）。
   * @param {{bodyTexts: {selector: string, fontSize: number, text: string, role?: string}[]}} facts
   */
  'C-001': (facts) => {
    const all = bodyTextsOf(facts)
    if (all.length === 0) return { pass: false, message: EMPTY }
    const texts = all.filter((text) => text.role !== 'meta')
    const metaCount = all.length - texts.length
    if (texts.length === 0) {
      return { pass: true, message: `本面 ${all.length} 个文字元素全是元信息（tag / 状态 / 路径），没有正文级文字` }
    }
    const small = texts.filter((text) => !(Number(text.fontSize) >= V.MIN_BODY_FONT_SIZE))
    if (small.length === 0) {
      return {
        pass: true,
        message: `正文级 ${texts.length} 个都 ≥ ${V.MIN_BODY_FONT_SIZE}px（另有 ${metaCount} 个元信息不参与）`,
      }
    }
    const worst = smallestBy(small, (text) => Number(text.fontSize))
    const named = worst.map((entry) => `${entry.value}px ${nameOf(entry.text)}`).join('、')
    return {
      pass: false,
      message: `${small.length}/${texts.length} 个正文级文字字号小于 ${V.MIN_BODY_FONT_SIZE}px，最小的几个：${named}`
        + `（另有 ${metaCount} 个元信息不参与这条判据）`,
    }
  },

  /**
   * C-002：正文级文字的行高 / 字号 ≥ 1.5。
   * `line-height: normal` 没有给出比值 —— 它不算达标（浏览器默认约 1.2，但这里不猜，只如实说没给比值）。
   * @param {{bodyTexts: {selector: string, fontSize: number, lineHeight: number|string, text: string}[]}} facts
   */
  'C-002': (facts) => {
    const texts = bodyTextsOf(facts)
    if (texts.length === 0) return { pass: false, message: EMPTY }
    const ratios = texts.map((text) => lineHeightRatio(text))
    const below = texts.filter((_text, index) => ratios[index] === null || ratios[index] < V.MIN_LINE_HEIGHT_RATIO)
    if (below.length === 0) {
      const lowest = Math.min(...ratios)
      return { pass: true, message: `全部 ${texts.length} 个文字元素行高 ≥ ${V.MIN_LINE_HEIGHT_RATIO}（最低 ${lowest}）` }
    }
    const normal = below.filter((text) => lineHeightRatio(text) === null)
    const worst = smallestBy(
      below.filter((text) => lineHeightRatio(text) !== null),
      (text) => lineHeightRatio(text),
    )
    const parts = []
    if (worst.length > 0) {
      parts.push(`最小的几个：${worst.map((entry) => `${entry.value}× ${nameOf(entry.text)}`).join('、')}`)
    }
    if (normal.length > 0) {
      parts.push(`${normal.length} 个写着 line-height: normal（没给比值）：${normal.slice(0, 3).map((text) => nameOf(text)).join('、')}`)
    }
    return {
      pass: false,
      message: `${below.length}/${texts.length} 个文字元素行高比小于 ${V.MIN_LINE_HEIGHT_RATIO}，${parts.join('；')}`,
    }
  },

  /**
   * C-003：正文级文字与其有效背景的对比度达 WCAG AA（正文 4.5:1 / 大字 3:1）。
   * @param {{bodyTexts: {selector: string, fontSize: number, fontWeight: number, color: string, backgroundColor: string, text: string}[]}} facts
   */
  'C-003': (facts) => {
    const texts = bodyTextsOf(facts)
    if (texts.length === 0) return { pass: false, message: EMPTY }
    const measured = texts.map((text) => ({
      text,
      ratio: contrastRatio(text.color, text.backgroundColor),
      floor: isLargeText(text) ? V.CONTRAST_AA_LARGE : V.CONTRAST_AA_NORMAL,
    }))
    const unmeasured = measured.filter((entry) => entry.ratio === null)
    const below = measured.filter((entry) => entry.ratio !== null && entry.ratio < entry.floor)
    if (below.length === 0 && unmeasured.length === 0) {
      const lowest = Math.min(...measured.map((entry) => entry.ratio))
      return {
        pass: true,
        message: `全部 ${texts.length} 个文字元素对比度达 AA（最低 ${lowest}:1；正文 ${V.CONTRAST_AA_NORMAL}:1 / 大字 ${V.CONTRAST_AA_LARGE}:1）`,
      }
    }
    const worst = [...below].sort((left, right) => left.ratio - right.ratio).slice(0, 4)
    const parts = []
    if (worst.length > 0) {
      parts.push(
        `最低的几个：${worst
          .map((entry) => `${entry.ratio}:1（下限 ${entry.floor}:1，${entry.text.fontSize}px）${nameOf(entry.text)}`)
          .join('、')}`,
      )
    }
    if (unmeasured.length > 0) {
      parts.push(`${unmeasured.length} 个文字元素算不出对比度（颜色解析不出）：${unmeasured.slice(0, 3).map((entry) => nameOf(entry.text)).join('、')}`)
    }
    return {
      pass: false,
      message: `${below.length}/${texts.length} 个文字元素对比度低于 AA，${parts.join('；')}`,
    }
  },
}
