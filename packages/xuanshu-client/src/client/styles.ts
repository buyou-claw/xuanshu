/**
 * `packages/xuanshu-client/src/client/styles.ts` — 玄枢样式的**单一消费层**。
 *
 * 为什么要有这一层（spec 003 判据 T-002）：浏览器半边是经典脚本、不过 CSS 管线，所以样式只能
 * 「随 JS 走」——每个模块自己 `document.createElement('style')` 再 `head.appendChild`。于是同一个
 * 客户端里有 12 个注入点，各写各的，既没法整体替换也没法整体审计。这里把「收集」与「注入」拆开：
 *
 *   - 各模块在**加载时** `registerStyleSheet(id, css)`（纯记账，不碰 DOM）；
 *   - 全仓只有这里 `createElement('style')`，而且**幂等**：同一个 `data-plugin-css` 只插一次。
 *
 * 结果：注入点从 12 收敛到 1，而样式的归属（哪段 CSS 属于哪个模块）仍然在各自的文件里 ——
 * 收敛的是**出口**，不是把 CSS 搬家（搬家会让 review 看不见 diff 的语义）。
 *
 * 注入顺序 = 注册顺序（模块 import 顺序），与收敛前逐模块注入的相对顺序一致，所以覆盖关系不变。
 */

/** style 标签的稳定 id（`data-plugin-css`）：全部样式合成一个标签。 */
export const STYLE_TAG_ID = 'xuanshu-client/styles.css';

/** id → CSS 文本。模块加载时登记；同 id 重复登记以后者为准（幂等，热重载安全）。 */
const SHEETS = new Map<string, string>();

/**
 * 登记一段样式（不碰 DOM）。
 * @param id - 稳定的段名（惯例：`<来源文件>.css`）
 * @param css - 该段的 CSS 原文
 */
export function registerStyleSheet(id: string, css: string): void {
  SHEETS.set(id, css);
}

/** 已登记段数（测试与诊断用；不参与渲染）。 */
export function registeredStyleSheetCount(): number {
  return SHEETS.size;
}

/** 合成后的 CSS（按登记顺序；测试与诊断用）。 */
export function composedStyleText(): string {
  return [...SHEETS.values()].join('\n');
}

/**
 * 幂等注入：把已登记的全部样式挂成一个 `<style>`。
 *
 * 照官方 `ui-layout` 的手法（`dsh-client-ui-layout/lib/client.js:72-81`）：先按
 * `data-plugin-css` 查一次，命中就不再插 —— 插件重载 / 多次 apply 都不会叠出第二份。
 *
 * @returns 本次是否真的插入了标签（无 DOM 的环境返回 false：SSR / 断言台 / 产物物化）
 */
export function installXuanshuStyles(): boolean {
  if (typeof document === 'undefined') return false;
  const selector = `style[data-plugin-css="${STYLE_TAG_ID}"]`;
  if (document.querySelector(selector) !== null) return false;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'xuanshu-client';
  tag.dataset.pluginCss = STYLE_TAG_ID;
  tag.textContent = composedStyleText();
  (document.head ?? document.documentElement).appendChild(tag);
  return true;
}
