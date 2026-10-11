/**
 * `sidebar.panellist` list 槽行 `overview` 的图标组件。
 */
import type { SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client';

/**
 * owner 分享 = 侧栏行给的呈现参数：请求的方形边长 + 本行是否选中。
 * 依据：`@deepseek-ai/dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:93-99`
 * （`SidebarPanelIconOwnerProps { size: number; active: boolean }`）。
 */
export type OverviewIconProps = SidebarPanelIconOwnerProps;

/**
 * 渲染侧栏行图标。
 *
 * 侧栏把它套在一个带 `aria-label` 的 `button` 里、外层 `span` 已 `aria-hidden`
 * （`…/ui-sidebar/lib/client.js:179-197`），所以这里再标一次 `aria-hidden`
 * 是为了让 SVG 自身不进可访问性树（`role="img"` + `aria-hidden` 是显式声明）。
 *
 * @param props - 侧栏行的尺寸与选中态。
 * @returns 图标节点。
 */
export function OverviewIcon({ size = 16, active }: OverviewIconProps) {
  return (
    <svg
      className="xs-overview-icon"
      data-xuanshu-panel="overview"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth={1.4} />
      {active ? <circle cx="8" cy="8" r="2" fill="currentColor" /> : null}
    </svg>
  );
}
