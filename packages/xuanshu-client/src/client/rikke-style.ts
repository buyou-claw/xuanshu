import { installXuanshuStyles, registerStyleSheet } from './styles.js'
import { BREAKPOINT_WIDE_PX } from './breakpoints.js'
/**
 * 票 13 · 日课面板的样式（S14）。
 *
 * 与 `digao-style.ts` / `bazi-style.ts` 同款守卫：Node 里（产物物化 / SSR 断言）`document`
 * 不在时安静跳过样式注入，注册面照做。
 */
export function installRikkeStyle(): void {
  registerStyleSheet("xs-rikke-style", `
.xs-rikke{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--xs-text-body)}
.xs-rikke h1,.xs-rikke h2{font-weight:600}.xs-rikke h1{font-size:1.15rem}.xs-rikke h2{font-size:1rem;margin:18px 0 6px}
.xs-rikke__head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.xs-rikke__basis,.xs-rikke__note{line-height:1.8}
.xs-rikke__note{color:var(--xs-text-secondary);font-size:.85rem}
.xs-rikke__no-network{color:var(--xs-text-body)}
.xs-rikke__actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
.xs-rikke button{font:inherit;padding:6px 12px;margin:2px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-rikke button:disabled{opacity:.5;cursor:not-allowed}
.xs-rikke input[type=time]{font:inherit;color:inherit;background:var(--xs-surface-card);border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:6px}
.xs-rikke__time-edit{border:1px solid var(--xs-constraint-human-gate-fg,var(--xs-edge-card));border-radius:var(--xs-radius-card);padding:10px;margin:8px 0}
.xs-rikke__confirm{border:1px solid var(--xs-constraint-human-gate-fg,var(--xs-edge-card));border-radius:var(--xs-radius-card);padding:10px;margin:8px 0}
.xs-rikke__alert{padding:10px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);margin:8px 0}
@media(max-width: ${BREAKPOINT_WIDE_PX}px){.xs-rikke{padding:16px}}
`);
  installXuanshuStyles()
}
