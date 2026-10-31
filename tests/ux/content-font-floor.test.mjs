/**
 * 正文 16px 下限（票 UX-01 / #63 · 判据 C-001）。
 *
 * 为什么必须在这里钉：判据 C-001 量的是**渲染值**，而宿主在容器上定义了
 * `--dsh-content-font-size`（真浏览器实测 14px）—— 于是 `var(--dsh-content-font-size, 16px)`
 * 的 fallback **永远不生效**，样式里写着 16 也照样量到 14。浏览器半边在 CI / worktree 里
 * 起不来（见 `docs/development-status.md` §17.6），所以这条断言补的是「取值本身带下限」：
 * 给定宿主 token = 14，声明必须解到 ≥16；宿主把 token 抬到 20 时也必须跟着抬（不是写死 16）。
 *
 * 第二条断言防的是「唯一能过判据的坏办法」：把整屏调成同号。元信息（tag / badge / 状态行 /
 * 路径 / 计数）天生该小，判据也不要求它到 16 —— 这里正面钉住它们仍然 < 16，
 * 否则层级会被压平（那正是判据 L-001 要防的事）。
 */
import { describe, expect, it } from 'vitest'

import { installConsult } from '../../packages/xuanshu-client/src/client/consult.tsx'
import { createConsultApi } from '../../packages/xuanshu-client/src/client/consult-api.ts'
import { installMountsStyle } from '../../packages/xuanshu-client/src/client/mounts.tsx'
import { installOverviewStyle } from '../../packages/xuanshu-client/src/client/style.ts'
import { composedStyleText } from '../../packages/xuanshu-client/src/client/styles.ts'

/** 真浏览器里的实测值（`ux-reports/2026-10-31T11-42-28-453Z` 的 C-001 证据）：宿主把正文 token 定在 14px。 */
const HOST_CONTENT_PX = 14

/** 宿主把 token 抬高时我们应当跟随（证明没有写死 16）。 */
const HOST_RAISED_PX = 20

/** 判据 C-001 的下限（`docs/design/ui-v1/criteria/rules/C.json`）。 */
const BODY_FLOOR_PX = 16

/** 三个面板各注册自己的 CSS；注册进单一消费层后从 `composedStyleText()` 读合成文本。 */
function composedCss() {
  installOverviewStyle()
  installMountsStyle()
  installConsult({ slots: { inject: (_key, effect) => effect(), register: () => () => {} } }, {
    api: createConsultApi({}),
    navigate: () => {},
    openSession: () => {},
    refreshSessions: async () => {},
  })
  return composedStyleText()
}

/** 注释里有花括号与逗号，先剥掉再按规则切（否则「选择器」会把上一条注释吃进来）。 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//gu, '')
}

/** 取某条选择器的全部声明文本（同一选择器可能出现在基础段与 `@media` 里，全部返回）。 */
function declarationsOf(css, selector) {
  const found = []
  for (const match of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const selectors = match[1].split(',').map((part) => part.trim())
    if (selectors.includes(selector)) found.push(match[2])
  }
  return found
}

/** 某条选择器声明的全部 `font-size` 原值（没有就返回空数组 = 走继承）。 */
function fontSizesOf(css, selector) {
  return declarationsOf(css, selector)
    .flatMap((declarations) => [...declarations.matchAll(/(?:^|;)\s*font-size\s*:\s*([^;]+)/gu)].map((match) => match[1].trim()))
}

/** 顶层逗号切分（`max()` 里可能还有逗号）。 */
function splitTopLevel(value) {
  const parts = []
  let depth = 0
  let current = ''
  for (const character of value) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  if (current.trim() !== '') parts.push(current.trim())
  return parts
}

/**
 * 把一条 `font-size` 声明解成 px：只实现这条判据用得到的语法
 * （`max()` / `var()` / px / rem / 百分比跟随继承）。
 *
 * `var(--dsh-content-font-size, …)` 取宿主值；别的 token 视为宿主未定义、取 fallback。
 */
function resolvePx(raw, hostContentPx) {
  const value = raw.trim()
  const maxMatch = /^max\((.*)\)$/u.exec(value)
  if (maxMatch !== null) return Math.max(...splitTopLevel(maxMatch[1]).map((part) => resolvePx(part, hostContentPx)))
  const varMatch = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/u.exec(value)
  if (varMatch !== null) {
    if (varMatch[1] === '--dsh-content-font-size') return hostContentPx
    return varMatch[2] === undefined ? Number.NaN : resolvePx(varMatch[2], hostContentPx)
  }
  const pxMatch = /^(-?[\d.]+)px$/u.exec(value)
  if (pxMatch !== null) return Number(pxMatch[1])
  const remMatch = /^(-?[\d.]+)rem$/u.exec(value)
  if (remMatch !== null) return Number(remMatch[1]) * 16
  return Number.NaN
}

/** 一条选择器「在宿主 token = 14 时的字号」：没有声明就返回 null（走继承，由根节点那条兜）。 */
function sizeUnderHostToken(css, selector, hostContentPx = HOST_CONTENT_PX) {
  const sizes = fontSizesOf(css, selector)
  if (sizes.length === 0) return null
  return Math.max(...sizes.map((raw) => resolvePx(raw, hostContentPx)))
}

/**
 * 浏览器报告里「正文级、实测 < 16px」的选择器（独立真值：`report.json` 的 C-001 证据）。
 * 面板根也必须在这里：它的字号是继承链的源头，不钉死的话后代继承下来仍是 14。
 */
const OVERVIEW_BODY_SELECTORS = [
  '.xs-overview', // 继承链源头（h1 / 卡片正文都从这里继承）
  '.xs-overview__title', // 14px · 自我总览
  '.xs-card__title', // 14px · 命盘 / 八字
  '.xs-empty__why', // 14px · 底座还没立起来
  '.xs-pillar__name',
  '.xs-basis',
  '.xs-source-links',
  '.xs-cell__subtitle',
]

const CONSULT_BODY_SELECTORS = [
  '.xs-consult', // 继承链源头
  '.xs-consult h3', // 15.68px（.98rem）· ① 本次要用的谱 / 临时挂载
  '.xs-consult h4', // 13.6px（.85rem）· 默认在场 · 不可关
  '.xs-consult__field>span', // 13.6px · 这一次想问什么
  '.xs-consult__round-head',
  '.xs-consult__summary', // 票面点名的那一处：靠继承拿字号，所以根节点必须钉死
  '.xs-consult__text',
]

/** 元信息：tag / badge / 状态行 / 路径 / 计数 / 说明行。判据不要求它们到 16，且**不许**被一起放大。 */
const META_SELECTORS = [
  '.xs-overview__localnote',
  '.xs-empty__sub',
  '.xs-badge',
  '.xs-quicklinks__note',
  '.xs-consult__badge',
  '.xs-consult__note',
  '.xs-consult__shortid',
  '.xs-consult__role',
  '.xs-mounts__note',
]

describe('票 UX-01 · 正文 16px 下限（宿主 token 覆盖了 fallback）', () => {
  it('overview 的根节点把下限钉死：宿主 token = 14 时解到 16，抬到 20 时跟着抬', () => {
    const css = composedCss()
    expect(sizeUnderHostToken(css, '.xs-overview')).toBeGreaterThanOrEqual(BODY_FLOOR_PX)
    expect(sizeUnderHostToken(css, '.xs-overview', HOST_RAISED_PX)).toBe(HOST_RAISED_PX)
  })

  it('overview 的正文级选择器都带下限（报告里实测 14px 的那几处）', () => {
    const css = composedCss()
    for (const selector of OVERVIEW_BODY_SELECTORS) {
      const size = sizeUnderHostToken(css, selector)
      // null = 没有自己的 font-size，走根节点继承 —— 根节点已由上一条钉死。
      if (size === null) continue
      expect(size, `${selector} 在宿主 token = 14 时仍不足 ${BODY_FLOOR_PX}px`).toBeGreaterThanOrEqual(BODY_FLOOR_PX)
    }
  })

  it('consult 的根节点把下限钉死：宿主 token = 14 时解到 16，抬到 20 时跟着抬', () => {
    const css = composedCss()
    expect(sizeUnderHostToken(css, '.xs-consult')).toBeGreaterThanOrEqual(BODY_FLOOR_PX)
    expect(sizeUnderHostToken(css, '.xs-consult', HOST_RAISED_PX)).toBe(HOST_RAISED_PX)
  })

  it('consult 的正文级选择器都带下限（h3 / h4 / 字段标签 / 挂载区标题）', () => {
    const css = composedCss()
    for (const selector of CONSULT_BODY_SELECTORS) {
      const size = sizeUnderHostToken(css, selector)
      if (size === null) continue
      expect(size, `${selector} 在宿主 token = 14 时仍不足 ${BODY_FLOOR_PX}px`).toBeGreaterThanOrEqual(BODY_FLOOR_PX)
    }
  })

  it('元信息仍走小档：没有为了过判据把整屏调成同号', () => {
    const css = composedCss()
    for (const selector of META_SELECTORS) {
      const size = sizeUnderHostToken(css, selector)
      expect(size, `${selector} 应当自带小档（元信息不参与 16px 下限）`).not.toBeNull()
      expect(size, `${selector} 被一起放大了：层级会被压平`).toBeLessThan(BODY_FLOOR_PX)
    }
  })

  it('标题档仍然高于正文档：门厅标题解出来比卡片标题大', () => {
    const css = composedCss()
    const title = sizeUnderHostToken(css, '.xs-overview__title')
    const heading = sizeUnderHostToken(css, '.xs-card__title')
    expect(title).toBeGreaterThan(heading)
  })
})
