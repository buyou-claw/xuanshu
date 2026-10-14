/**
 * 票 11 · 合参浮层的样式（token 走票 03 覆盖过的 `--xs-*`，不写死配色）。
 *
 * 与 `consult-style.ts` / `cang-style.ts` 同款守卫：Node（无 document）里安静跳过 ——
 * 断言台直接 import 组件，样式注入这一步必须不抛。
 */
export const BESTOF_STYLE_ID = 'xs-bestof-style';

export function installBestofStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(BESTOF_STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = BESTOF_STYLE_ID;
  style.textContent = `
.xs-bestof-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.32);display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px;z-index:40;overflow:auto}
.xs-bestof{width:min(960px,100%);max-height:88vh;overflow:auto;background:var(--xs-surface-card);color:var(--xs-text-body);border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:var(--xs-space-card-pad);box-shadow:var(--xs-shadow-card)}
.xs-bestof h3,.xs-bestof h4{margin:0 0 6px;font-weight:600}
.xs-bestof h3{font-size:1.05rem}
.xs-bestof h4{font-size:.9rem;color:var(--xs-text-secondary)}
.xs-bestof__head{display:flex;gap:10px;align-items:baseline;justify-content:space-between;flex-wrap:wrap;margin-bottom:8px}
.xs-bestof__note{color:var(--xs-text-secondary);font-size:.82rem;margin:4px 0}
.xs-bestof__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin:10px 0}
.xs-bestof__card{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:10px;display:flex;flex-direction:column;gap:6px;min-width:0}
.xs-bestof__card-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.xs-bestof__tag{font-size:.74rem;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:1px 6px;color:var(--xs-text-secondary)}
.xs-bestof__tag--rank{color:var(--xs-accent-fg);background:var(--xs-accent);border-color:var(--xs-accent)}
.xs-bestof__body{white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;font-size:.88rem;line-height:1.5}
.xs-bestof__actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
.xs-bestof button{font:inherit;padding:6px 12px;margin:2px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-bestof button:disabled{opacity:.5;cursor:not-allowed}
.xs-bestof .xs-btn--primary{background:var(--xs-accent);border-color:var(--xs-accent);color:var(--xs-accent-fg)}
.xs-bestof textarea,.xs-bestof input{font:inherit;color:inherit;background:var(--xs-surface-card);border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:7px;width:100%;box-sizing:border-box}
.xs-bestof textarea{min-height:64px}
.xs-bestof__judge{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:10px;margin:8px 0;background:var(--xs-surface-page)}
.xs-bestof__judge-row{display:flex;gap:8px;align-items:baseline;padding:3px 0;border-bottom:1px dashed var(--xs-edge-card);flex-wrap:wrap}
.xs-bestof__judge-row:last-child{border-bottom:0}
.xs-bestof__warn{border:1px solid var(--xs-edge-card);border-left:3px solid var(--xs-accent);border-radius:var(--xs-radius-control);padding:8px 10px;margin:8px 0;background:var(--xs-surface-page)}
.xs-bestof__error{color:var(--xs-text-danger,var(--xs-text-body));font-size:.86rem;margin:6px 0}
.xs-bestof details{margin:8px 0}
.xs-bestof summary{cursor:pointer;color:var(--xs-text-secondary);font-size:.85rem}
.xs-bestof__settings{display:flex;gap:10px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--xs-edge-card);padding:8px 0}
.xs-bestof__settings-note{color:var(--xs-text-secondary);font-size:.8rem}
`;
  document.head.appendChild(style);
}
