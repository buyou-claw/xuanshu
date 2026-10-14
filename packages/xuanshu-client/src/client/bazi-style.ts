/**
 * 票 08 · 两块新面的样式（S3 向导 / S2 命盘详情）。
 *
 * 为什么与 `cang-style.ts` 一样**自带守卫**：这块 JS 会在 Node 里被执行
 * （产物物化断言、SSR 渲染断言），`document` 不在时样式注入必须安静地跳过 ——
 * 注册面照做，只有碰 DOM 的那一步被挡掉。
 *
 * token 全部走 `tokens.ts` 覆盖过的 `--xs-*`（票 03 取值），不写死配色。
 */
export function installBaziStyle(): void {
  if (typeof document === 'undefined' || document.getElementById('xs-bazi-style') !== null) return;
  const style = document.createElement('style');
  style.id = 'xs-bazi-style';
  style.textContent = `
.xs-wizard{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--xs-text-body)}
.xs-wizard h1,.xs-wizard h2,.xs-wizard h3{font-weight:600}.xs-wizard h2{font-size:1.05rem}.xs-wizard h3{font-size:.95rem;margin:18px 0 6px}
.xs-wizard__steps{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0}
.xs-wizard__step-list{display:flex;gap:6px;list-style:none;margin:0;padding:0;flex-wrap:wrap}
.xs-wizard__step{display:flex;gap:6px;align-items:center;padding:4px 10px;border:1px solid var(--xs-edge-card);border-radius:999px;font-size:.8rem;color:var(--xs-text-secondary)}
.xs-wizard__step--current{border-color:var(--xs-accent);color:var(--xs-text-body)}
.xs-wizard__step--done{opacity:.75}
.xs-wizard__cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--xs-space-card-pad)}
.xs-wizard__aside{color:var(--xs-text-secondary);font-size:.85rem;line-height:1.7}
.xs-wizard__field{display:block;margin:10px 0}
.xs-wizard__field>span{display:block;margin-bottom:4px;font-size:.85rem}
.xs-wizard input,.xs-wizard select,.xs-wizard textarea{font:inherit;color:inherit;background:var(--xs-surface-card);border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:7px;box-sizing:border-box;max-width:100%}
.xs-wizard textarea{display:block;width:100%;min-height:72px}
.xs-wizard button{font:inherit;padding:6px 12px;margin:2px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-wizard button:disabled{opacity:.5;cursor:not-allowed}
.xs-btn--primary{background:var(--xs-accent);border-color:var(--xs-accent);color:var(--xs-accent-fg)}
.xs-wizard__note,.xs-wizard__hint,.xs-wizard__status{font-size:.8rem;color:var(--xs-text-secondary);line-height:1.6}
.xs-wizard__hint{color:var(--xs-text-body)}
.xs-wizard__nudge,.xs-wizard__manual,.xs-wizard__actions,.xs-wizard__cast{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
.xs-wizard__nudge-grains{display:inline-flex;gap:4px}
.xs-chip{font-size:.8rem;padding:3px 8px}
.xs-chip--on{border-color:var(--xs-accent)}
.xs-wizard__cities{list-style:none;margin:6px 0;padding:0;max-height:220px;overflow:auto}
.xs-wizard__cities li{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--xs-edge-card)}
.xs-wizard__city-region{color:var(--xs-text-secondary);font-size:.8rem;flex:1}
.xs-wizard__place{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.xs-wizard__place-coord{font-family:var(--font-mono,monospace);color:var(--xs-text-code)}
.xs-wizard__zone-value{display:flex;gap:8px;align-items:baseline;font-size:1.05rem}
.xs-wizard__confirm{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:var(--xs-space-card-pad)}
.xs-wizard__confirm-list{list-style:none;margin:0;padding:0}
.xs-wizard__confirm-list li{display:flex;gap:12px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--xs-edge-card)}
.xs-wizard__confirm-label{min-width:72px;color:var(--xs-text-secondary);font-size:.85rem}
.xs-wizard__confirm-value{flex:1}
.xs-wizard__radio{display:block;margin:6px 0}
.xs-wizard__radio small{margin-left:8px}
.xs-wizard__check{display:block;margin:6px 0}
.xs-wizard__check input{margin-right:8px}
.xs-wizard__reason{padding:12px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);margin-top:8px}
.xs-wizard__reason-main{color:var(--xs-text-body);line-height:1.7}
.xs-wizard__gate{padding:12px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);margin:12px 0}
.xs-wizard__gate-prompt{font-size:1rem;line-height:1.7}
.xs-wizard__footer{display:flex;gap:8px;align-items:center;margin-top:18px;position:sticky;bottom:0;background:var(--xs-surface-card);padding:10px 0}
.xs-wizard__footer .xs-wizard__spacer{flex:1}
.xs-mingpan{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--xs-text-body)}
.xs-mingpan h1,.xs-mingpan h2{font-weight:600}.xs-mingpan h2{font-size:1rem;margin:18px 0 6px}
.xs-mingpan button{font:inherit;padding:6px 12px;margin:2px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-mingpan button:disabled{opacity:.5;cursor:not-allowed}
.xs-mingpan__summary p{margin:4px 0}
.xs-mingpan__coord{font-family:var(--font-mono,monospace);color:var(--xs-text-code)}
.xs-mingpan__pillars{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.xs-mingpan__pillar{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:10px;text-align:center}
.xs-mingpan__pillar-name{display:block;font-size:.8rem;color:var(--xs-text-secondary)}
.xs-mingpan__pillar-value{font-size:1.2rem}
.xs-mingpan__basis,.xs-mingpan__origin{line-height:1.8}
.xs-mingpan__confirm{margin-top:12px;padding:12px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card)}
.xs-mingpan__actions,.xs-mingpan__head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
@media(max-width:1100px){.xs-wizard__cols{grid-template-columns:1fr}.xs-wizard{padding:16px}.xs-mingpan{padding:16px}}
`;
  document.head.appendChild(style);
}
