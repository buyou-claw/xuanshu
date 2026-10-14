/**
 * 票 14 · 藏的样式（面板 + 抽屉共用一张样式表）。
 *
 * 三条「为什么」：
 *   1. **样式随 JS 走**：模块加载时注入一个 `<style>`（与 `style.ts` / 其它面板同款），
 *      非 DOM 环境（断言台 / SSR）直接返回 —— 组件因此可以在无 jsdom 的 `renderToStaticMarkup` 里渲染；
 *   2. **颜色全走 `--xs-*` token**，不写死色值：这些 token 由玄枢的主题覆盖层注入
 *      （本仓 `style.ts` 的 `installOverviewStyle` / token 表；DSH 侧的接口名是 `ctx.theme.overrideTokens`
 *      —— 证据来自 `node scripts/build-client.mjs` 的自检输出「槽位/面板副作用: overrideTokens(xuanshu-ui-v1×122)」，
 *      **具体 file:line 未确认**，不编）；
 *   3. `.xs-cang__boundary` 用 `position:sticky` 钉住顶部：那句「藏永不进 AI」是本屏的**边界声明**，
 *      滚动时必须一直可见（S15 §C6 的措辞要求 —— 未确认到具体行号）。
 */

export function installCangStyle() {
  if (typeof document === 'undefined' || document.getElementById('xuanshu-cang-style')) return;
  const style = document.createElement('style'); style.id = 'xuanshu-cang-style';
  style.textContent = `
.xs-cang{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--xs-text-body)}
.xs-cang h1,.xs-cang h2{font-weight:600}.xs-cang h2{font-size:1.05rem}.xs-cang p{line-height:1.6}.xs-cang__boundary{position:sticky;top:0;z-index:1;background:var(--xs-constraint-noai-bg);color:var(--xs-constraint-noai-fg);padding:12px;border-radius:8px}
.xs-cang__toolbar,.xs-cang__actions{display:flex;align-items:center;flex-wrap:wrap;gap:var(--xs-space-toolbar);margin:16px 0}.xs-cang button,.xs-cang__drawer button{font:inherit;padding:7px 12px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}.xs-cang button:disabled,.xs-cang__drawer button:disabled{opacity:.5;cursor:not-allowed}
.xs-cang input,.xs-cang select,.xs-cang__drawer input{font:inherit;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:7px;min-width:0}.xs-cang__card{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:var(--xs-space-card-pad);margin:12px 0;background:var(--xs-surface-card)}.xs-cang code{overflow-wrap:anywhere;font-family:var(--font-mono,monospace);color:var(--xs-text-code)}.xs-cang__status{font-size:.8rem;font-weight:400}.xs-cang__more>summary{cursor:pointer}.xs-cang__more>div{display:flex;flex-wrap:wrap;gap:8px}.xs-cang__group>summary{padding:8px;cursor:pointer}.xs-cang footer{margin-top:24px;color:var(--xs-text-secondary)}.xs-cang__confirm{padding:16px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-nested)}
.xs-cang__overlay{position:fixed;inset:0;display:flex;justify-content:flex-end;background:var(--xs-surface-overlay-mask);pointer-events:auto;z-index:100}.xs-cang__drawer{width:min(560px,100%);overflow:auto;background:var(--xs-surface-overlay);color:var(--xs-text-body);padding:var(--xs-space-overlay-pad);box-sizing:border-box;box-shadow:0 0 30px rgb(0 0 0 / .15)}.xs-cang__drawer form>label{display:block;margin:16px 0}.xs-cang__drawer form>label input{display:block;box-sizing:border-box;width:100%;margin-top:8px}.xs-cang__drawer fieldset label{display:block;margin:8px 0}.xs-cang__drawer fieldset input{margin-right:8px}
@media(min-width:1100px){.xs-cang__more>summary{display:none}.xs-cang__more:not([open])>div{display:flex}}
@media(max-width:700px){.xs-cang{padding:14px}.xs-cang__toolbar{align-items:stretch;flex-direction:column}.xs-cang__drawer{padding:16px}}`;
  document.head.appendChild(style);
}
