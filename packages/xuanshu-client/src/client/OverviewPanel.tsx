/**
 * `main` keyed 槽 key `overview` 的面板：自我总览（四卡首屏）。
 *
 * 屏稿：`docs/design/ui-v1/screens/S1-自我总览.md`（§2 线框、§4 组件树 XsOverviewGrid、§5 交互流程）。
 * 票内现实：三张数据卡恒为冷启动空态（读本地文件 RPC 属票 08/13），
 * 快捷入口是静态卡；四卡共用 `XsCardShell` 外壳，卡级三态、无整页 loading（D2）。
 *
 * 注入面（`PropsRuntime<'main'>` 的 owner 分享）：由 `index.tsx` 的 register `inject`
 * 提供 `navigate` / `mainPanels` 与后续票的接线回调；`main` 槽未声明 owner，
 * 官方座位里没有 `useSession`/`useConversation`（`DSH槽位映射.md` F1），
 * 因此本面板只用全局座位与注入面。
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';

import { XsDestinyCard, XsDigaoCard, XsQuickLinks, XsRikkeCard } from './cards.js';
import type { OverviewInjected } from './cards.js';
import { PANEL_HOME, PANEL_ID, PANEL_LOCAL_NOTE, PANEL_TITLE } from './panel.js';

/** 本机日期（`YYYY-MM-DD`，本地时区）——卡头「今天 <日期>」的缺省来源。 */
function localDate(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * 面板 props。
 *
 * `PropsRuntime<'main'>` = owner 分享 + 作用域标准件；`main` 槽未声明 owner
 * （`@deepseek-ai/dsh-client-ui-layout/lib/types/client/index.d.ts:49-56` 只有
 * `kind: 'keyed'` / `scope: 'root'`），故 owner 分享为 `{}`。
 *
 * **刻意不声明 `children`**，所以 props 里没有 `renderSlot`：槽位声明是排他的
 * （`main.conversation` 已由官方 ui-conversation 声明），玄枢不抢声明。
 */
export type OverviewPanelProps = PropsRuntime<'main'> &
  OverviewInjected & {
    /** 卡头日期（测试注入固定值；缺省 = 本机日期）。 */
    today?: string;
    /** 底座是否已立（07 恒 false；票 08 起接取数）。 */
    baseplateReady?: boolean;
  };

/**
 * 渲染自我总览：页头（家 · 自我总览 + 本地数据路径）+ 2×2 四卡。
 *
 * @param props - 注入面与可选展示覆盖值。
 * @returns 面板节点。
 */
export function OverviewPanel({
  navigate,
  mainPanels,
  today,
  baseplateReady = false,
  onStartOnboarding,
  onOpenDetail,
  onGenerate,
  onRefresh,
  onRetry,
}: OverviewPanelProps) {
  const date = today ?? localDate();
  const injected = { navigate, mainPanels, onStartOnboarding, onOpenDetail, onGenerate, onRefresh, onRetry };

  return (
    <div className="xs-overview" data-xuanshu-panel={PANEL_ID}>
      <header className="xs-overview__header">
        <h1 className="xs-overview__title">
          <span className="xs-overview__home">{PANEL_HOME}</span> · {PANEL_TITLE}
        </h1>
        <p className="xs-overview__localnote" data-xuanshu-note="local-data">
          {PANEL_LOCAL_NOTE}
        </p>
      </header>
      {/* D3 读序：命盘 → 日课 → 底稿 → 快捷入口（窄屏单列时顺序不变）。 */}
      <div className="xs-overview__grid">
        <XsDestinyCard state="empty" {...injected} />
        <XsRikkeCard state="empty" today={date} {...injected} />
        <XsDigaoCard state="empty" {...injected} />
        <XsQuickLinks baseplateReady={baseplateReady} navigate={navigate} mainPanels={mainPanels} />
      </div>
    </div>
  );
}
