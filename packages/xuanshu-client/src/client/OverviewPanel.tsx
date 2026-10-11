/**
 * `main` keyed 槽 key `overview` 的占位面板（玄枢「自我总览」空壳）。
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';

import { PANEL_PLACEHOLDER, PANEL_SUBTITLE, PANEL_TITLE } from './panel.js';

/**
 * 组件 props。
 *
 * `PropsRuntime<'main'>` = owner 分享 + 作用域标准件。`main` 槽未声明 `owner`
 * （`@deepseek-ai/dsh-client-ui-layout/lib/types/client/index.d.ts:49-56`
 * 只有 `kind: 'keyed'` / `scope: 'root'`），故 owner 分享为 `{}`。
 *
 * **刻意不声明 `children`**，所以 props 里没有 `renderSlot`：
 *   - 槽位声明是排他的 —— 同一子槽的第二个声明者会抛
 *     （`@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:789` 附近，
 *     `register` 文档「declaring an already-declared child key throws」），
 *     `main.conversation` 已由官方 ui-conversation 声明
 *     （`…/dsh-client-ui-conversation/lib/types/client/skeleton/ConversationPanel.d.ts:8`）；
 *   - 玄枢这个面板不渲染会话。将来「问事」是另开 `consult` key（票 10 · 问事闭环），
 *     不是复用 `conversation`。
 */
export type OverviewPanelProps = PropsRuntime<'main'>;

/**
 * 渲染占位内容。
 * @param _props - main 槽 owner 分享（本票不使用；保留形参以固定契约形状）。
 * @returns 占位面板节点。
 */
export function OverviewPanel(_props: OverviewPanelProps) {
  return (
    <div className="xs-overview" data-xuanshu-panel="overview">
      <header className="xs-overview__header">
        <h1 className="xs-overview__title">{PANEL_TITLE}</h1>
        <p className="xs-overview__subtitle">{PANEL_SUBTITLE}</p>
      </header>
      <p className="xs-overview__placeholder">{PANEL_PLACEHOLDER}</p>
    </div>
  );
}
