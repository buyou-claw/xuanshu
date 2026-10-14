/**
 * `sidebar.panellist` list 槽行 `overview` 的图标组件（asset.S1-1 的形状照抄）。
 */
import type { SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client';

import { GlyphOverview } from './glyphs.js';
import { PANEL_ID } from './panel.js';

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
 * （`…/ui-sidebar/lib/client.js:179-197`），所以图标自身再标一次 `aria-hidden`
 * 是为了不进可访问性树。几何 = `docs/design/ui-v1/assets/icons/nav/nav-overview.svg`
 * （asset.S1-1，viewBox 24；尺寸由侧栏的 `size` 决定，图标不写死宽高）。
 *
 * @param props - 侧栏行的尺寸与选中态。
 * @returns 图标节点。
 */
export function OverviewIcon({ size = 20 }: OverviewIconProps) {
  return (
    <span className="xs-overview-icon" data-xuanshu-panel={PANEL_ID}>
      <GlyphOverview className="xs-overview-icon__glyph" size={size} />
    </span>
  );
}
