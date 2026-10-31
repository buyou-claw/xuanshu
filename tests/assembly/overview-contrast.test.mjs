/**
 * 门厅小字的对比度契约（issue #64 / UX-02 · 判据 C-003「对比度达 WCAG AA」）。
 *
 * 为什么要把这条单独钉成静态断言：C-003 的机器判定在浏览器半边（`pnpm verify:ux --browser`
 * 量 computed-style），而实现者票在 worktree 里跑不了浏览器（`docs/development-status.md`
 * §17.6 第 2 条）。于是「改深了没有」只靠一次浏览器体检兜底 —— 体检之前谁都不知道。
 * 这里改从**样式源 + token 对照**算同一个比值，让回退在几毫秒内红，而不是等下一轮浏览器录制。
 *
 * 真值从哪来（不从被测实现里取，否则就是自证）：
 *   1. WCAG 2.x 的相对亮度公式与 4.5:1 阈值（正文级 = 字号 < 18.66px 或字重 < 700）；
 *   2. token → 字面色的对照取自 `docs/design/ui-v1/assets/tokens/xs-tokens.css` 的尺度层
 *      （bluish-600/700 等；见下表逐行注释）。
 * 公式自身用**浏览器录制证据**校验：`tests/ux/fixtures/visual-facts.json` 里 `panel:overview`
 * 的最低对比度是 3.42:1（13px 次要文字），同一对颜色必须能算出同一个数，否则下面的数字不可信。
 */
import { describe, expect, it } from 'vitest'

import { OVERVIEW_CSS } from '../../packages/xuanshu-client/src/client/style.ts'

/* ───────────────────────── WCAG 2.x（独立于被测实现） ───────────────────────── */

/** 单通道线性化：sRGB 8bit → 相对亮度的输入（0…1）。 */
function channelOf(value) {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** `#rrggbb` → 相对亮度 L。 */
function luminanceOf(hex) {
  const digits = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((offset) => channelOf(Number.parseInt(digits.slice(offset, offset + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 两色对比度：(L亮 + 0.05) / (L暗 + 0.05)。 */
function contrastOf(first, second) {
  const a = luminanceOf(first)
  const b = luminanceOf(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/* ───────────────────────── token → 字面色（双模） ───────────────────────── */

/**
 * 文字族 token 的字面色。
 *
 * 来源：`xs-tokens.css` 的尺度层把 label 三档写成「别名 + 字面值」两处，这里取字面值那半：
 *   - `--xs-text-body`      = label-primary（light=bluish-1000 #0f1115 / dark=bluish-50 #f9fafb）；
 *   - `--xs-text-secondary` = label-secondary（light=bluish-700 #61666b / dark=bluish-300 #cfd3d6）；
 *   - `--xs-text-tertiary`  = label-tertiary（light=bluish-600 #81858c / dark=bluish-400 #adb2b8）；
 *   - `--xs-text-caption`   = label-caption（light=bluish-400 #adb2b8 / dark=bluish-600 #81858c）。
 * （同值可在 `--xs-static-constraint-readonly-fg` / `-locked-fg` 等尺度层条目里逐字对照。）
 */
const TONE = {
  '--xs-text-body': { light: '#0f1115', dark: '#f9fafb' },
  '--xs-text-secondary': { light: '#61666b', dark: '#cfd3d6' },
  '--xs-text-tertiary': { light: '#81858c', dark: '#adb2b8' },
  '--xs-text-caption': { light: '#adb2b8', dark: '#81858c' },
}

/**
 * 面（底）的字面色：只有 `--xs-surface-empty` 在本仓尺度层里有字面值，其余两个是宿主别名
 * （panel/card = DSH bg-base / bg-layer-1）——按 `xs-tokens.css` 注释里的双模取色写死：
 * light 两者都是 bluish-00 #ffffff；dark 是 bluish-950 #151517 / bluish-875 #232324。
 */
const SURFACE = {
  '--xs-surface-empty': { light: '#f5f6f7', dark: '#151517' },
  '--xs-surface-panel': { light: '#ffffff', dark: '#151517' },
  '--xs-surface-card': { light: '#ffffff', dark: '#232324' },
}

/* ───────────────────────── 从样式源取声明 ───────────────────────── */

/** 取某条规则块的声明文本（选择器逐字匹配，避免 `.xs-empty__sub` 命中 `.xs-card__empty`）。 */
function declarationsOf(css, selector) {
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    if (rule[1].trim() === selector) return rule[2]
  }
  throw new Error(`样式里没有这条规则：${selector}（选择器改名了？这条断言要跟着改）`)
}

/** 规则块里 `color` 用的 token 名（判据 T-004：颜色一律走 token，所以这里只认 `var(--xs-*)`）。 */
function colorTokenOf(css, selector) {
  const declared = declarationsOf(css, selector).match(/color:\s*var\((--xs-[a-z-]+)\)/u)
  if (declared === null) throw new Error(`${selector} 的 color 不是 var(--xs-*)（判据 T-004）`)
  return declared[1]
}

/**
 * 总览面上「13px 级小字」的三处 —— 浏览器录制里它们正是最低的三档（3.42 / 3.71 / 3.71），
 * 全部用了 tertiary 一档。C-003 要求这些正文级文字 ≥ 4.5:1。
 */
const SMALL_TEXT = [
  { selector: '.xs-empty__sub', surface: '--xs-surface-empty', what: '空态副行' },
  { selector: '.xs-overview__localnote', surface: '--xs-surface-panel', what: '页眉的本地数据路径' },
  { selector: '.xs-quicklinks__note', surface: '--xs-surface-card', what: '快捷入口卡脚注' },
]

describe('#64 / UX-02 · 门厅小字对比度 ≥ 4.5:1（C-003）', () => {
  it('公式能复现浏览器录制的 3.42:1：同一对颜色算同一个数，否则本文件的数字不可信', () => {
    // 录制证据：`tests/ux/fixtures/visual-facts.json` · panel:overview 最低对比度 3.42（13px 次要文字）。
    expect(contrastOf('#81858c', '#f5f6f7')).toBeCloseTo(3.42, 1)
    // 同一条公式在深色模上的已知值（tertiary on 空态底）——不是为了断言「该用 tertiary」，
    // 而是证明双模都按同一套公式算，浅色红、深色不红这件事本身来自数值，不是来自分支。
    expect(contrastOf('#adb2b8', '#151517')).toBeGreaterThan(4.5)
  })

  for (const { selector, surface, what } of SMALL_TEXT) {
    it(`${what}（${selector}）在浅色 / 深色两模下都过 AA`, () => {
      const token = colorTokenOf(OVERVIEW_CSS, selector)
      expect(TONE[token], `${selector} 用的 token 没进对照表：${token}`).toBeDefined()
      for (const mode of ['light', 'dark']) {
        const foreground = TONE[token][mode]
        const background = SURFACE[surface][mode]
        const ratio = contrastOf(foreground, background)
        expect(
          ratio,
          `${mode}：${what} ${token}(${foreground}) on ${surface}(${background}) = ${ratio.toFixed(2)}:1，低于 WCAG AA 的 4.5:1`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})
