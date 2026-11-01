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
 * 基础段：**所有**玄枢元素共享的排版下限。
 *
 * 为什么放在消费层而不是各 `*-style.ts`：这是跨全部面板的一条纪律（判据 C-002 要求行高比 ≥1.5）。
 * 复制到 6 个风格文件里就会漂；而它又必须**早于**各段落地，让具体规则仍能覆盖它。
 * 实测（2026-10-31）：不加这条时 `line-height: normal` 在 overview 是 22/22、pus 14/14 —— 全屏都没给比值。
 */
const BASE_SHEET = `
[class^="xs-"], [class*=" xs-"] { line-height: 1.6; }

/* 可点目标的下限（判据 D-001：44×44）。放在基础段是因为它是**跨面**的一条纪律；
   各面板自己的 padding 仍然生效，这条只是兜住「做小了没人拦」的底。

   2026-11-02 修：原来这条把 input:not([type=hidden]) 一网打尽，勾选框（checkbox / radio）
   也被按成 44×44 —— 问事面板里那两颗勾选框在屏上是 44px 的大蓝方块（实测）。
   勾选框真正该大的是**包住它的 label 那一行**（整行宽、行高够，点哪都能中），
   控件本身按 DSH 那套 16px 就行。所以排除 checkbox / radio / range / color。 */
[class^="xs-"] button, [class*=" xs-"] button,
[class^="xs-"] a[href], [class*=" xs-"] a[href],
[class^="xs-"] select, [class*=" xs-"] select,
[class^="xs-"] input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]),
[class*=" xs-"] input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]),
[class^="xs-"] textarea, [class*=" xs-"] textarea,
[class^="xs-"] [role="button"], [class*=" xs-"] [role="button"] {
  min-height: 44px;
  min-width: 44px;
}

/* 勾选框本身按 16px，不吃文本框那套尺寸（点击区交给外层 label）。 */
[class^="xs-"] input[type="checkbox"], [class*=" xs-"] input[type="checkbox"],
[class^="xs-"] input[type="radio"], [class*=" xs-"] input[type="radio"] {
  width: 16px;
  height: 16px;
  min-width: 0;
  min-height: 0;
  flex: 0 0 auto;
  margin: 0;
  padding: 0;
}
`;

/** 登记一段样式（不碰 DOM）。 */
export function registerStyleSheet(id: string, css: string): void {
  SHEETS.set(id, css);
}

/** 合成后的 CSS（基础段在前；测试与诊断用）。 */
export function composedStyleText(): string {
  return [BASE_SHEET, ...SHEETS.values()].join('\n');
}

/**
 * 幂等注入：把已登记的全部样式挂成一个 `<style>`，**并在有新段落时刷新它的内容**。
 *
 * 为什么必须刷新：各模块的调用形状是「先 `registerStyleSheet(自己的 CSS)`，再 `installXuanshuStyles()`」。
 * 如果这里像官方 ui-layout 那样「标签在就早退」，那么**只有第一个 apply 的模块**的样式会真的进 DOM，
 * 后面注册的段落永远不落地 —— 页面不会报错，只会「样式莫名其妙没生效」。所以：
 *   - 标签只在第一次创建（幂等，重载不会叠出第二份）；
 *   - 之后每次调用都按当前登记内容对一次 `textContent`，不同就刷新（新段落照样落地）。
 *
 * @returns 本次是否真的**新建**了标签（内容刷新不算；无 DOM 的环境返回 false）
 */
export function installXuanshuStyles(): boolean {
  if (typeof document === 'undefined') return false;
  const selector = `style[data-plugin-css="${STYLE_TAG_ID}"]`;
  const composed = composedStyleText();
  const existing = document.querySelector(selector) as HTMLStyleElement | null;
  if (existing !== null) {
    if (existing.textContent !== composed) existing.textContent = composed;
    return false;
  }
  const tag = document.createElement('style');
  tag.dataset.plugin = 'xuanshu-client';
  tag.dataset.pluginCss = STYLE_TAG_ID;
  tag.textContent = composed;
  (document.head ?? document.documentElement).appendChild(tag);
  return true;
}
