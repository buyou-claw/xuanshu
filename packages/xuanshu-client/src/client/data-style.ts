import { installXuanshuStyles, registerStyleSheet } from './styles.js'
import { BREAKPOINT_NARROW_PX } from './breakpoints.js'
/**
 * 票 30 · 「我的数据」设置页的样式（随 JS 注入一个 `<style>`，与其它面板同款）。
 *
 * 颜色全走 `--xs-*` token（玄枢主题覆盖层注入）；非 DOM 环境（断言台 / SSR）直接返回 ——
 * 组件因此可以在无 jsdom 的 `renderToStaticMarkup` 里渲染。
 */

export function installDataStyle() {
  registerStyleSheet("xuanshu-data-style", `
.xs-data{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;box-sizing:border-box;color:var(--xs-text-body)}
.xs-data h2{margin:0 0 8px;font-size:1.15rem;font-weight:600}.xs-data h3{margin:0 0 8px;font-size:1rem;font-weight:600}
.xs-data p,.xs-data li{line-height:1.6}.xs-data code{overflow-wrap:anywhere;font-family:var(--font-mono,monospace);color:var(--xs-text-code)}
.xs-data__lead,.xs-data__note{color:var(--xs-text-secondary);font-size:.9rem}
.xs-data__block{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:var(--xs-space-card-pad);margin:16px 0;background:var(--xs-surface-card)}
.xs-data__groups{width:100%;border-collapse:collapse;font-size:.9rem}.xs-data__groups th,.xs-data__groups td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--xs-edge-card);vertical-align:top}
/* 2026-11-02：体积与文件数是短数字，不该被挤成两行（截图里看到「6 个」/「文件」上下断开）。路径列本来就该换行，单独放行。 */
.xs-data__groups td{white-space:nowrap}.xs-data__groups td:has(code){white-space:normal}
.xs-data__groups thead th{color:var(--xs-text-secondary);font-weight:500}.xs-data__groups tbody th{font-weight:600;white-space:nowrap}
.xs-data__total{margin:12px 0 0;font-weight:600}
.xs-data button{font:inherit;padding:7px 14px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-data button:disabled{opacity:.5;cursor:not-allowed}
.xs-data__error{color:var(--xs-text-error,inherit);border-left:3px solid var(--xs-edge-card);padding-left:10px}
.xs-data__result{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-nested);padding:12px;margin-top:12px}
.xs-data__block ul,.xs-data__block ol{margin:8px 0;padding-left:20px}.xs-data__block li{margin:4px 0}
@media(max-width: ${BREAKPOINT_NARROW_PX}px){.xs-data{padding:14px}.xs-data__groups{display:block;overflow-x:auto}}`);
  installXuanshuStyles()
}
