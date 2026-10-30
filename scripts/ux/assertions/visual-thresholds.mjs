#!/usr/bin/env node
/**
 * `scripts/ux/assertions/visual-thresholds.mjs` —— **视觉档阈值表**（spec 003 §视觉档位第 21 条 · ADR-0015 第 2 条）。
 *
 * 这张表只做一件事：把「克制留白档」（comfortable）的数值集中到**一处**，
 * 让三件事同时成立：
 *   1. **判据正文里可查**：同样的数字写在 `rules/D.json` / `rules/C.json` 的 `statement` 里，
 *      不藏在代码深处（`tests/ux/family-dc.test.mjs` 钉住「判据文本里的数字 = 这里的常量」）；
 *   2. **改阈值 = 换档**：数字在判据体里，所以改它必然改判据集 `version`，冻结值必然对不上
 *      （spec 003 §Testing Decisions 第 4 条；用例钉住这一条，见同文件「改阈值触发冻结」）；
 *   3. **只有一份**：判定谓词从这里取，报告里的阈值行也从这里取 —— 两处各写一份就会漂。
 *
 * 取值出处（ADR-0015 第 2 条：量化阈值一律由 Material 3 口径给出，不自己发明）：
 *   - 点击目标 44×44、对比度 4.5:1 / 3:1、大字定义 18.66px / 24px / 700 —— Material 3 · WCAG 2.1 AA；
 *   - 正文 16px、行高 1.5、单屏主操作 ≤1 —— spec 003 §视觉档位第 21 条（留白档的选择见于
 *     §Further Notes「视觉档位的由来」：改它等同于换档，需要新的 ADR）。
 *
 * 仅使用 Node 内置模块。ESM。
 */

/**
 * 视觉档阈值（**只读**：要改档，先改 ADR + 设计稿，再改这里与 `rules/` 的判据正文）。
 * @type {Readonly<{
 *   MIN_TARGET: number,
 *   MAX_PRIMARY_ACTIONS: number,
 *   MIN_BODY_FONT_SIZE: number,
 *   MIN_LINE_HEIGHT_RATIO: number,
 *   CONTRAST_AA_NORMAL: number,
 *   CONTRAST_AA_LARGE: number,
 *   LARGE_TEXT_PX: number,
 *   LARGE_TEXT_BOLD_PX: number,
 *   LARGE_TEXT_BOLD_WEIGHT: number,
 * }>}
 */
export const VISUAL_THRESHOLDS = Object.freeze({
  /** 可点目标的最小边（CSS px）。 */
  MIN_TARGET: 44,
  /** 任一时刻一屏允许的主操作上限。 */
  MAX_PRIMARY_ACTIONS: 1,
  /** 正文级文字的计算字号下限（px）。 */
  MIN_BODY_FONT_SIZE: 16,
  /** 正文级文字的行高 / 字号 比值下限。 */
  MIN_LINE_HEIGHT_RATIO: 1.5,
  /** WCAG AA 正文对比度（< 大字口径）。 */
  CONTRAST_AA_NORMAL: 4.5,
  /** WCAG AA 大字对比度。 */
  CONTRAST_AA_LARGE: 3,
  /** WCAG 大字定义的第一支：字号 ≥ 24px（18pt）。 */
  LARGE_TEXT_PX: 24,
  /** WCAG 大字定义的第二支：字号 ≥ 18.66px（14pt）… */
  LARGE_TEXT_BOLD_PX: 18.66,
  /** …且字重不低于 700（粗体）。 */
  LARGE_TEXT_BOLD_WEIGHT: 700,
})
