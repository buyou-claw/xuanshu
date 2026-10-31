/**
 * 门厅小字的对比度契约（issue #64 / UX-02 · 判据 C-003「对比度达 WCAG AA」）。
 *
 * 为什么要把这条单独钉成静态断言：C-003 的机器判定在浏览器半边（`pnpm verify:ux --browser`
 * 量 computed-style），而实现者票在 worktree 里跑不了浏览器（`docs/development-status.md`
 * §17.6 第 2 条）。于是「改深了没有」只靠一次浏览器体检兜底 —— 体检之前谁都不知道。
 * 这里改从**样式源 + token 文件**算同一个比值，让回退在几毫秒内红，而不是等下一轮浏览器录制。
 *
 * 三份真值，**各有出处**，本文件不手抄任何一个数字：
 *   1. 公式与阈值：`scripts/ux/assertions/c.mjs` 的 `contrastRatio` / `parseCssColor`、
 *      `scripts/ux/assertions/visual-thresholds.mjs` 的 `CONTRAST_AA_NORMAL`（判据谓词用的就是这两份，
 *      这里再写一份就等于有两套「AA」）；
 *   2. 颜色：token 文件 `docs/design/ui-v1/assets/tokens/xs-tokens.css` 里的字面值（本文件现读现解析，
 *      `var()` 链也在文件里跟到底；解析不出来就红，不退回手抄的表）；
 *      只有落到 DSH 宿主 token 的那几个别名才用 `HOST_ALIAS`（本仓确实没有它们的字面值），
 *      而且别名目标一变就会红（解析时按名查找，找不到目标就抛）；
 *   3. 对拍：`tests/ux/fixtures/visual-facts.json` 是**真浏览器录制**的 computed-style，
 *      它的最低一条（3.42:1）既是「公式没走样」的证据，也是「token 字面值 = 浏览器算出来的颜色」的证据。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { OVERVIEW_CSS } from '../../packages/xuanshu-client/src/client/style.ts'
import { contrastRatio, parseCssColor } from '../../scripts/ux/assertions/c.mjs'
import { VISUAL_THRESHOLDS } from '../../scripts/ux/assertions/visual-thresholds.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const TOKENS_FILE = join(REPO_ROOT, 'docs', 'design', 'ui-v1', 'assets', 'tokens', 'xs-tokens.css')
const RECORDING_FILE = join(REPO_ROOT, 'tests', 'ux', 'fixtures', 'visual-facts.json')

/* ───────────────────────── token 文件 → 字面色（现读现解析） ───────────────────────── */

/** 读 token 文件并去掉注释：注释里也写着 `body[data-ds-dark-theme]` 与十六进制，不能参与解析。 */
function tokenSheet() {
  const text = readFileSync(TOKENS_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
  /** 取某个选择器块里的 `--name: value` 声明（选择器逐字匹配，两个块：`:root` / dark）。 */
  const blockOf = (selector) => {
    const start = text.indexOf(selector)
    if (start === -1) throw new Error(`xs-tokens.css 里没有 ${selector} 块（token 文件结构变了？）`)
    const open = text.indexOf('{', start)
    const close = text.indexOf('}', open)
    if (open === -1 || close === -1) throw new Error(`xs-tokens.css 的 ${selector} 块没写完`)
    const declarations = new Map()
    for (const match of text.slice(open + 1, close).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gu)) {
      declarations.set(match[1], match[2].trim())
    }
    return declarations
  }
  return { light: blockOf(':root'), dark: blockOf('body[data-ds-dark-theme]') }
}

const SHEET = tokenSheet()

/**
 * 本仓不持有字面值的 DSH 宿主别名（token 字典自己写的取值，见 `xs-tokens.css` §surface 那几行注释）。
 *
 * 为什么这里必须留一张小表：`--xs-surface-panel: var(--dsw-alias-bg-base)` 的目标在宿主包里，
 * 本仓拿不到。表里只放「别名 → 宿主给的 light/dark 值」；**别名本身**仍从 token 文件读，
 * 所以别名一改（`bg-base` 换成别的）解析就会抛错 —— 这张表不会被默默绕过。
 */
const HOST_ALIAS = {
  '--dsw-alias-bg-base': { light: '#ffffff', dark: '#151517' },
  '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#232324' },
}

/**
 * 文字族别名 → 本仓**同值**的尺度条目。
 *
 * 出处就在 token 文件里：`--xs-static-constraint-readonly-fg` 的注释写着「取自 …（=label-secondary 取色）」，
 * `-locked-fg` 写着「=label-tertiary 取色」，`-human-gate-bg` 写着「=brand-primary/button-primary-fill 取色」
 * （= label-primary 的双模取色）。所以这几档的**字面值**在本仓是有真值的，只是写在同一份文件的尺度层。
 */
const SCALE_OF_ALIAS = {
  '--dsw-alias-label-primary': '--xs-static-constraint-human-gate-bg',
  '--dsw-alias-label-secondary': '--xs-static-constraint-readonly-fg',
  '--dsw-alias-label-tertiary': '--xs-static-constraint-locked-fg',
}

/**
 * 解一个 token（双模）：先在本文件里跟 `var()` 链，落到宿主别名再查上面两张表。
 * @param {string} name token 名（`--xs-*`）
 * @param {'light'|'dark'} mode
 * @param {number} [depth] 防环（`var()` 自己绕自己）
 * @returns {string} `#rrggbb`
 */
function colorOf(name, mode, depth = 0) {
  if (depth > 8) throw new Error(`token ${name} 的 var() 链绕圈了（${mode}）`)
  const raw = mode === 'dark' ? (SHEET.dark.get(name) ?? SHEET.light.get(name)) : SHEET.light.get(name)
  if (raw === undefined) throw new Error(`xs-tokens.css 里没有 ${name}（${mode}）`)
  const alias = /^var\(\s*(--[a-z0-9-]+)\s*\)$/u.exec(raw)
  if (alias !== null) {
    const target = alias[1]
    // 先看目标在**这份文件**里有没有声明（`--xs-surface-*` → `--xs-static-*` 那一层就在文件里）。
    if (SHEET.light.has(target) || SHEET.dark.has(target)) return colorOf(target, mode, depth + 1)
    if (SCALE_OF_ALIAS[target] !== undefined) return colorOf(SCALE_OF_ALIAS[target], mode, depth + 1)
    if (HOST_ALIAS[target] !== undefined) return HOST_ALIAS[target][mode]
    throw new Error(`${name}（${mode}）经 ${target} 落到本仓没有的 token：请把出处补进 HOST_ALIAS / SCALE_OF_ALIAS`)
  }
  if (!/^#[0-9a-fA-F]{6}$/u.test(raw)) throw new Error(`${name}（${mode}）不是 6 位十六进制：${raw}`)
  return raw
}

/** `#rrggbb` → `rgb(r, g, b)`（`parseCssColor` 只吃计算值，这是唯一的一次格式转换）。 */
function rgbOfHex(hex) {
  const digits = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

/** 两色的对比度：**同一个** `contrastRatio`（判据谓词用的那份），这里不另写公式。 */
function ratioOfTokens(foregroundToken, backgroundToken, mode) {
  return contrastRatio(rgbOfHex(colorOf(foregroundToken, mode)), rgbOfHex(colorOf(backgroundToken, mode)))
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
 * 全部用了 secondary 一档（tertiary 不够 AA）。C-003 要求这些正文级文字 ≥ 4.5:1。
 */
const SMALL_TEXT = [
  { selector: '.xs-empty__sub', surface: '--xs-surface-empty', what: '空态副行' },
  { selector: '.xs-overview__localnote', surface: '--xs-surface-panel', what: '页眉的本地数据路径' },
  { selector: '.xs-quicklinks__note', surface: '--xs-surface-card', what: '快捷入口卡脚注' },
]

/* ───────────────────────── 对拍：token 文件 ↔ 浏览器录制 ───────────────────────── */

const RECORDING = JSON.parse(readFileSync(RECORDING_FILE, 'utf8'))

/** 录制里 `panel:overview` 的正文事实（真浏览器算出来的 color / backgroundColor）。 */
function recordedOverview() {
  const face = RECORDING.faces['panel:overview']
  if (face === undefined) throw new Error('录制里没有 panel:overview（fixtures/visual-facts.json 被换掉了？）')
  return face.bodyTexts
}

const recordedSubLine = recordedOverview().find((text) => text.selector.includes('xs-empty__sub'))
if (recordedSubLine === undefined) throw new Error('录制里没有 .xs-empty__sub 那一条（#64 的基线就是它）')

describe('#64 / UX-02 · token 文件与浏览器录制必须说同一件事', () => {
  it('tertiary / 空态底的字面值 = 录制里算出来的那对颜色（任何一侧改了都红）', () => {
    // 录制（`visual-facts.json`）是**修之前**的浏览器事实：tertiary 在空态底上只有 3.42:1。
    expect(parseCssColor(recordedSubLine.color), '录制里那一行的颜色结构变了').not.toBeNull()
    expect(parseCssColor(rgbOfHex(colorOf('--xs-text-tertiary', 'light'))), 'token 的 tertiary 与浏览器算出来的不是同一个颜色').toEqual(
      parseCssColor(recordedSubLine.color),
    )
    expect(parseCssColor(rgbOfHex(colorOf('--xs-surface-empty', 'light'))), 'token 的空态底与浏览器算出来的不是同一个颜色').toEqual(
      parseCssColor(recordedSubLine.backgroundColor),
    )
  })

  it('同一份 contrastRatio 能复现录制里的最低值 3.42:1（公式没走样）', () => {
    const ratios = recordedOverview()
      .map((text) => contrastRatio(text.color, text.backgroundColor))
      .filter((ratio) => ratio !== null)
    expect(Math.min(...ratios), '录制里 panel:overview 的最低对比度不再是 3.42：公式或证据被换过了').toBe(3.42)
  })
})

describe('#64 / UX-02 · 门厅小字对比度 ≥ 4.5:1（C-003）', () => {
  for (const { selector, surface, what } of SMALL_TEXT) {
    it(`${what}（${selector}）在浅色 / 深色两模下都过 AA`, () => {
      const token = colorTokenOf(OVERVIEW_CSS, selector)
      for (const mode of ['light', 'dark']) {
        const foreground = colorOf(token, mode)
        const background = colorOf(surface, mode)
        const ratio = contrastRatio(rgbOfHex(foreground), rgbOfHex(background))
        expect(ratio, `${token}（${foreground}）在 token 里解不出颜色`).not.toBeNull()
        expect(
          ratio,
          `${mode}：${what} ${token}(${foreground}) on ${surface}(${background}) = ${ratio.toFixed(2)}:1，低于 WCAG AA 的 ${VISUAL_THRESHOLDS.CONTRAST_AA_NORMAL}:1`,
        ).toBeGreaterThanOrEqual(VISUAL_THRESHOLDS.CONTRAST_AA_NORMAL)
      }
    })
  }
})
