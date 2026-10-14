/**
 * 票 13 · 底稿面板的样式（S13）。
 *
 * 与 `bazi-style.ts` / `cang-style.ts` 同款守卫：这块 JS 会在 Node 里被执行
 * （产物物化断言、SSR 渲染断言），`document` 不在时样式注入必须安静跳过 ——
 * 注册面照做，只有碰 DOM 的那一步被挡掉。
 *
 * token 只走票 03 覆盖过的 `--xs-*`；徽标配色走 `--xs-constraint-derived-*`
 * （S13 §9 C2：constraint 族只用于「能指回约束」的地方，不做装饰）。
 */
export function installDigaoStyle(): void {
  if (typeof document === 'undefined' || document.getElementById('xs-digao-style') !== null) return;
  const style = document.createElement('style');
  style.id = 'xs-digao-style';
  style.textContent = `
.xs-digao{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--xs-text-body)}
.xs-digao h1,.xs-digao h2{font-weight:600}.xs-digao h1{font-size:1.15rem}.xs-digao h2{font-size:1rem}
.xs-digao__head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;position:sticky;top:0;background:var(--xs-surface-card);padding:8px 0;z-index:1}
.xs-digao__jumps,.xs-digao__actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
.xs-digao button{font:inherit;padding:6px 12px;margin:2px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-digao button:disabled{opacity:.5;cursor:not-allowed}
.xs-digao__jumps button{background:transparent;border-color:transparent;text-decoration:underline;padding:2px 4px}
.xs-digao__note,.xs-digao__origin{color:var(--xs-text-secondary);font-size:.85rem;line-height:1.7}
.xs-digao__no-edit{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:8px 10px}
.xs-digao__group{margin:18px 0;border-left:3px solid var(--xs-edge-card);padding-left:12px}
.xs-digao__group-head{margin:0 0 6px}
.xs-digao__segment{margin:10px 0;border-left:2px solid var(--xs-edge-card);padding-left:10px}
.xs-digao__tag{display:inline-block;padding:1px 6px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);font-size:.8rem;color:var(--xs-text-secondary);margin-right:6px}
.xs-digao__segment-body{white-space:pre-wrap;line-height:1.8;margin:4px 0}
.xs-digao__raw{white-space:pre-wrap;font-family:var(--font-mono,monospace);font-size:.85rem;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:10px;overflow:auto;max-height:var(--xs-size-scrollregion-max,420px)}
.xs-digao__alert{padding:10px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);margin:8px 0}
@media(max-width:1100px){.xs-digao{padding:16px}}
`;
  document.head.appendChild(style);
}
