/**
 * 自我总览四卡的样式（自研；F4：不 require primitives，只保留 token 引用）。
 *
 * 取值纪律（票 03 assets README §4 / 皮肤规格）：
 *   - 一律引用 `--xs-*`（由 `tokens.ts` 的 overrideTokens 覆盖层落到 body）；
 *   - 主按钮底走 DSH 品牌别名 `--dsw-alias-brand-primary`（skins/primary-button.md）；
 *   - **不写字面色值**；断点也不写字面值，一律走 `breakpoints.ts`（macros 吃不了 `var()`，
 *     语义权威 = `--xs-size-breakpoint-wide`，见 `assets/tokens/xs-tokens.css:214`）。
 *
 * 注入纪律（spec 003 判据 T-002）：本文件**不再自己建 style 标签** —— CSS 登记到
 * `styles.ts` 的单一消费层，由它幂等注入一次。
 *
 * 皮肤对照：`assets/skins/skeleton-card.md`（卡级骨架）、`quicklinks-cell.md`（快捷入口）、
 *   `badge-readonly.md`（两类徽标）、`why-empty-caption.md`（空态说明行）、`primary-button.md`（主按钮）。
 */
import { BREAKPOINT_WIDE_PX } from './breakpoints.js';
import { installXuanshuStyles, registerStyleSheet } from './styles.js';

/**
 * 总览这一段样式的**段名**（不是 `<style>` 标签 id —— 标签 id 只有 `styles.ts` 的 `STYLE_TAG_ID`，
 * 全仓一个标签）。名字里带 `SHEET` 就是为了不再和它混。
 */
const OVERVIEW_SHEET_ID = 'xuanshu-client/overview.css';

/** 本包全部类名以 `xs-` 前缀（F4：自有前缀，不与宿主类名竞争）。 */
export const OVERVIEW_CSS = `
.xs-overview {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--xs-space-section);
  padding: var(--xs-space-page);
  width: 100%;
  height: 100%;
  overflow: auto;
  background: var(--xs-surface-panel);
  color: var(--xs-text-body);
  /* 正文下限钉在**面板根**上（判据 C-001）：宿主在容器上定义了
     --dsh-content-font-size（真浏览器实测 14px），所以 var(…, 16px) 的 fallback 永远不生效 ——
     只有 max() 能把下限压住。放根上而不是逐条写：标题 / 段落 / 卡片正文都是从这条继承的，
     元信息自己声明 12–14px，不受影响（层级不塌）。 */
  font-size: max(16px, var(--dsh-content-font-size, 16px));
}
.xs-overview__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--xs-space-row);
  flex-wrap: wrap;
}
.xs-overview__title {
  margin: 0;
  /* 标题档 18px（type-scale §2 title），不是正文档：卡片标题也落在 16px，
     两档同号同字重就等于没有标题 —— L-001 要防的正是这个。下限仍按 max() 钉。 */
  font-size: max(18px, var(--dsh-content-font-size, 16px));
  font-weight: 600;
  color: var(--xs-text-title);
}
.xs-overview__home {
  color: var(--xs-text-brand);
  font-weight: 600;
}
.xs-overview__localnote {
  margin: 0;
  /* 这里是 13px 级的路径正文，落在白底上：走 tertiary（bluish-600）只有 3.71:1，不到 AA 的 4.5:1。
     改用 secondary（bluish-700）= 5.80:1。为什么不把 tertiary 整体调深：它被全站共用，
     动一次就把所有面的观感一起改了，超出这张票（#64 / UX-02）的范围。 */
  color: var(--xs-text-secondary);
  font-size: var(--dsh-content-font-size-secondary, 14px);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
}
.xs-overview__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--xs-space-card-gap);
  width: 100%;
  max-width: var(--xs-size-panel-content-max);
  margin: 0 auto;
}
/* 宽屏（>= --xs-size-breakpoint-wide = 1100px）：2×2；窄屏单列按 D3 读序堆叠。 */
@media (min-width: ${BREAKPOINT_WIDE_PX}px) {
  .xs-overview__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.xs-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--xs-space-stack-md);
  min-height: var(--xs-size-card-minheight);
  padding: var(--xs-space-card-pad);
  background: var(--xs-surface-card);
  border: 1px solid var(--xs-edge-card);
  border-radius: var(--xs-radius-card);
}
.xs-card__head {
  display: flex;
  align-items: center;
  gap: var(--xs-space-row);
}
.xs-card__icon {
  flex: 0 0 auto;
  color: var(--xs-text-heading);
}
.xs-card__title {
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
  font-size: max(16px, var(--dsh-content-font-size, 16px));
  font-weight: 600;
  color: var(--xs-text-heading);
}
.xs-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--xs-space-stack-sm);
  min-width: 0;
}
.xs-card__empty,
.xs-card__error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--xs-space-stack-sm);
  padding: var(--xs-space-stack-md);
  border-radius: var(--xs-radius-nested);
  background: var(--xs-surface-empty);
  color: var(--xs-state-empty-fg);
}
.xs-card__actions {
  display: flex;
  align-items: center;
  gap: var(--xs-space-toolbar);
  flex-wrap: wrap;
  margin-top: var(--xs-space-stack-sm);
}

.xs-empty__illus {
  width: 45%;
  max-width: 160px;
  height: auto;
  color: var(--xs-state-empty-fg);
}
.xs-empty__why {
  margin: 0;
  color: var(--xs-text-secondary);
  /* 空态「为什么空」是正文（人要先读懂这句才能决定下一步），不是元信息。 */
  font-size: max(16px, var(--dsh-content-font-size, 16px));
}
.xs-empty__sub {
  margin: 0;
  /* 空态副行是这一面原先的最低对比度：tertiary 在空态底（--xs-surface-empty）上只有 3.42:1。
     它 13px、整句都是要读的信息，属「正文级」，因此按 WCAG AA 提到 secondary = 5.36:1。
     与 .xs-empty__why 同档：空态块里两行都是说明句，弱化不再靠「再暗一档」而是靠括号 / 位置
     （token 字典目前没有 tertiary 与 secondary 之间的中间档，见台账 §17.7.2 的字阶重排）。 */
  color: var(--xs-text-secondary);
  font-size: var(--dsh-content-font-size-secondary, 14px);
}

.xs-badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: var(--xs-size-chip-height);
  padding: 0 8px;
  border-radius: var(--xs-radius-chip);
  font-size: var(--dsh-content-font-size-secondary, 14px);
  white-space: nowrap;
}
.xs-badge--readonly {
  color: var(--xs-constraint-readonly-fg);
  background: var(--xs-constraint-readonly-bg);
}
.xs-badge--derived {
  color: var(--xs-constraint-derived-fg);
  background: var(--xs-constraint-derived-bg);
}

.xs-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: var(--xs-size-control-height);
  padding: 0 12px;
  border: 1px solid var(--xs-edge-card-strong);
  border-radius: var(--xs-radius-control);
  background: transparent;
  color: var(--xs-text-body);
  font: inherit;
  cursor: pointer;
  transition: background var(--xs-motion-duration-fast) var(--xs-motion-ease-standard);
}
.xs-btn--primary {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary);
  color: var(--xs-text-on-accent);
}
.xs-btn:focus-visible,
.xs-link:focus-visible,
.xs-cell:focus-visible {
  outline: 2px solid var(--xs-edge-focus);
  outline-offset: 2px;
}
.xs-btn[disabled],
.xs-link[disabled],
.xs-cell[disabled] {
  color: var(--xs-text-disabled);
  cursor: not-allowed;
}
.xs-btn[disabled] {
  border-color: var(--xs-edge-readonly);
  background: var(--xs-surface-readonly);
}
.xs-btn--primary[disabled] {
  background: var(--xs-surface-locked);
  color: var(--xs-text-disabled);
}
.xs-link {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: none;
  background: none;
  color: var(--xs-text-link);
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.xs-link[disabled] {
  text-decoration: none;
}

.xs-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--xs-space-stack-sm);
}
.xs-skeleton__bar,
.xs-skeleton__block {
  border-radius: var(--xs-radius-nested);
  background: var(--xs-surface-skeleton);
}
.xs-skeleton__bar {
  height: 10px;
  width: 60%;
}
.xs-skeleton__bar--head {
  height: 14px;
  width: 40%;
}
.xs-skeleton__bar--badge {
  height: var(--xs-size-chip-height);
  width: 96px;
  border-radius: var(--xs-radius-chip);
}
.xs-skeleton__blocks {
  display: flex;
  gap: var(--xs-space-row);
}
.xs-skeleton__block {
  flex: 1 1 0;
  height: 28px;
}
.xs-skeleton__shimmer {
  background-image: linear-gradient(90deg, transparent, var(--xs-state-loading-fg), transparent);
  opacity: 0.08;
  animation: xs-skeleton-sweep var(--xs-motion-duration-fast) var(--xs-motion-ease-standard) infinite;
}
@keyframes xs-skeleton-sweep {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}
@media (prefers-reduced-motion: reduce) {
  .xs-skeleton__shimmer { animation: none; }
}

.xs-pillars {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--xs-space-row);
}
.xs-pillar {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border-radius: var(--xs-radius-nested);
  background: var(--xs-surface-card-nested);
}
.xs-pillar__name {
  color: var(--xs-text-tertiary);
  /* 柱名与柱值同一行相邻两档：字重分（值 600 / 名 400），字号都吃 16px 下限。
     原先走 -secondary（14px）：它既不是 tag/badge，也不是路径/计数，判据按正文量，
     量出来就是 14px 红（ux-reports 2026-10-31T11-42-28 的 C-001 证据）。 */
  font-size: max(16px, var(--dsh-content-font-size, 16px));
}
.xs-pillar__value {
  color: var(--xs-text-heading);
  font-weight: 600;
}
.xs-basis {
  display: flex;
  gap: var(--xs-space-row);
  flex-wrap: wrap;
  color: var(--xs-text-secondary);
  /* 依据行是正文（读得懂才敢信数），不是元信息：同样吃 16px 下限。 */
  font-size: max(16px, var(--dsh-content-font-size, 16px));
}
.xs-lines {
  display: flex;
  flex-direction: column;
  gap: var(--xs-space-stack-sm);
}
.xs-line {
  display: flex;
  gap: var(--xs-space-row);
  color: var(--xs-text-body);
}
.xs-line__label {
  flex: 0 0 auto;
  color: var(--xs-text-tertiary);
}
.xs-line__value {
  min-width: 0;
}
.xs-digao-summary {
  margin: 0;
  color: var(--xs-text-body);
}
.xs-source-links {
  display: flex;
  align-items: center;
  gap: var(--xs-space-toolbar);
  flex-wrap: wrap;
  color: var(--xs-text-secondary);
  /* 出处链接文字是正文：这是「凭什么是这个结论」的入口，不吃小字。 */
  font-size: max(16px, var(--dsh-content-font-size, 16px));
}

.xs-quicklinks {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--xs-space-toolbar);
}
.xs-cell {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--xs-space-stack-sm);
  padding: var(--xs-space-card-pad);
  border: 1px solid var(--xs-edge-card);
  border-radius: var(--xs-radius-nested);
  background: var(--xs-surface-card-nested);
  color: var(--xs-text-heading);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--xs-motion-duration-fast) var(--xs-motion-ease-standard);
}
.xs-cell:hover:not([disabled]) {
  background: var(--xs-surface-interactive-hover);
}
.xs-cell[disabled] {
  background: var(--xs-surface-readonly);
}
.xs-cell__icon {
  color: inherit;
}
.xs-cell__title {
  font-weight: 600;
}
.xs-cell__subtitle {
  color: var(--xs-text-secondary);
  /* 快捷入口的副标题与标题相邻两档：字重分（标题 600 / 副标题 400），字号都吃 16px 下限。
     __subtitle 不在元信息词表里（词表按 sub / note 这类整词匹配），判据按正文量。 */
  font-size: max(16px, var(--dsh-content-font-size, 16px));
}
.xs-cell[disabled] .xs-cell__subtitle {
  color: var(--xs-text-disabled);
}
.xs-quicklinks__note {
  margin: var(--xs-space-stack-md) 0 0;
  /* 同 .xs-overview__localnote：13px 小字落卡面白底，tertiary 只有 3.71:1 → secondary = 5.80:1。 */
  color: var(--xs-text-secondary);
  font-size: var(--dsh-content-font-size-secondary, 14px);
  text-align: right;
}
`;

/**
 * 幂等注入 style 标签（照官方 `ui-layout` 的手法：
 * `profile/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js:72-81`）。
 *
 * 浏览器半边是经典脚本、不经过任何 CSS 管线，所以样式随 JS 走、由本函数挂到 head。
 *
 * @returns 本次是否真的插入了标签（测试/SSR 下返回 false）。
 */
export function installOverviewStyle(): boolean {
  registerStyleSheet(OVERVIEW_SHEET_ID, OVERVIEW_CSS);
  return installXuanshuStyles();
}
