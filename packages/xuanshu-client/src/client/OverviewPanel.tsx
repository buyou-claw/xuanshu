/**
 * `main` keyed 槽 key `overview` 的面板：自我总览（四卡首屏）。
 *
 * 屏稿：`docs/design/ui-v1/screens/S1-自我总览.md`（§2 线框、§4 组件树 XsOverviewGrid、§5 交互流程）。
 * 票 07 的现实：三张数据卡恒为冷启动空态（读数据的 RPC 属票 08/13）。
 * **票 08 起命盘卡改为数据驱动**：按 `bazi.status` 给 `state`（loading / empty / ready / error）+ `snapshot`；
 * 日课卡 / 底稿卡本次**不动**（`onGenerate` / `onRefresh` 仍未接线，属票 13）。
 * 快捷入口是静态卡；四卡共用 `XsCardShell` 外壳，卡级三态、无整页 loading（D2）。
 *
 * 注入面（`PropsRuntime<'main'>` 的 owner 分享）：由 `index.tsx` 的 register `inject`
 * 提供 `navigate` / `mainPanels` / 命盘数据面与取数代次；`main` 槽未声明 owner，
 * 官方座位里没有 `useSession`/`useConversation`（`DSH槽位映射.md` F1），
 * 因此本面板只用全局座位与注入面。
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';

import type { BaziApi, BaziStatus } from './bazi-api.js';
import type { BaziUiController } from './bazi-controller.js';
import { XsDestinyCard, XsDigaoCard, XsQuickLinks, XsRikkeCard } from './cards.js';
import type { DestinySnapshot, OverviewInjected } from './cards.js';
import { ERROR_COPY, PANEL_HOME, PANEL_ID, PANEL_LOCAL_NOTE, PANEL_TITLE } from './panel.js';
import type { CardState } from './panel.js';

/** 本机日期（`YYYY-MM-DD`，本地时区）——卡头「今天 <日期>」的缺省来源。 */
function localDate(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 没有控制器时的空实现（组件被单独渲染：测试 / SSR）。`useSyncExternalStore` 要求订阅稳定。 */
const NO_CONTROLLER: Pick<BaziUiController, 'subscribe' | 'getRevision'> = {
  subscribe: () => () => {},
  getRevision: () => 0,
};

/** 卡片要的那一层快照（`DestinySnapshot`）从契约 §1 的快照里投影出来，缺项一律「—」。 */
export function destinyFromSnapshot(snapshot: BaziStatus['snapshot']): DestinySnapshot {
  return {
    pillars: {
      year: snapshot?.pillars?.year ?? '—',
      month: snapshot?.pillars?.month ?? '—',
      day: snapshot?.pillars?.day ?? '—',
      hour: snapshot?.pillars?.hour ?? '—',
    },
    // `basis.trueSolar` / `clock` 拿不到时**省略该键**（契约 §1：绝不自己算一个假值），
    // 卡面按「—」显示：看得见「这一项没有」，而不是一个编出来的时间。
    basis: {
      trueSolar: snapshot?.basis?.trueSolar ?? '—',
      clock: snapshot?.basis?.clock ?? '—',
    },
  };
}

/**
 * `bazi.status` 的回答 → 卡级四态（S1 §6①：读到快照 → ready；文件缺失 → empty；读不出来 → error）。
 * @param status - 宿主回答。
 * @returns 卡级状态与投影后的快照。
 */
export function destinyStateFromStatus(status: BaziStatus): { state: CardState; snapshot?: DestinySnapshot } {
  if (status.state === 'ready' && status.snapshot !== undefined) {
    return { state: 'ready', snapshot: destinyFromSnapshot(status.snapshot) };
  }
  // 「ready 但没有快照」是宿主侧的形状违约：按读不出来处理，不假装有盘。
  if (status.state === 'ready') return { state: 'error' };
  return { state: status.state === 'error' ? 'error' : 'empty' };
}

/**
 * 命盘取数钩子：`bazi.status` → 卡级四态。
 *
 * 三条行为：
 *   1. `preloaded` 给了就**不取数**（静态预置：测试与 SSR 断言）；
 *   2. 没有数据面（`bazi === undefined`，例如单独渲染本组件）→ 恒 `empty`：
 *      四卡的 fail-soft 语义不变，票 07 的冷启动观感原样保留；
 *   3. 出盘成功 / 手动重试会让 `controller` 的代次 +1，本钩子据此**重取快照**
 *      （不是重新出盘：快照是唯一事实源，S2 §5.1）。
 *
 * @param options - 数据面、控制器与静态预置。
 * @returns 卡级状态、卡片快照与失败理由。
 */
export function useBaziStatus(options: {
  api?: BaziApi;
  controller?: BaziUiController;
  preloaded?: BaziStatus;
}): { state: CardState; snapshot?: DestinySnapshot; reason?: string } {
  const { api, controller, preloaded } = options;
  const active = controller ?? NO_CONTROLLER;
  const revision = useSyncExternalStore(active.subscribe, active.getRevision, active.getRevision);
  const [status, setStatus] = useState<BaziStatus | undefined>(
    preloaded ?? (api === undefined ? { state: 'empty' } : undefined),
  );

  useEffect(() => {
    if (preloaded !== undefined) {
      setStatus(preloaded);
      return;
    }
    if (api === undefined) {
      setStatus({ state: 'empty' });
      return;
    }
    let alive = true;
    void api
      .status()
      .then((answer) => {
        if (alive) setStatus(answer);
      })
      .catch((error: unknown) => {
        // 取数失败 = 卡级 error（不需要整页失败，D2）。
        if (alive) {
          setStatus({ state: 'error', reason: error instanceof Error ? error.message : ERROR_COPY.mingpan });
        }
      });
    return () => {
      alive = false;
    };
  }, [api, preloaded, revision]);

  if (status === undefined) return { state: 'loading' };
  return { ...destinyStateFromStatus(status), reason: status.reason };
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
    /** 底座是否已立（票 08 起缺省由命盘状态推导；显式给了就以它为准）。 */
    baseplateReady?: boolean;
    /** 静态预置的命盘状态（测试 / SSR：给了就不调 `bazi.status`）。 */
    preloadedBaziStatus?: BaziStatus;
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
  bazi,
  baziController,
  preloadedBaziStatus,
  today,
  baseplateReady,
  onStartOnboarding,
  onOpenDetail,
  onGenerate,
  onRefresh,
  onRetry,
}: OverviewPanelProps) {
  const date = today ?? localDate();
  // 命盘卡：票 08 起数据驱动（loading / empty / ready / error + 快照）。
  const destiny = useBaziStatus({ api: bazi, controller: baziController, preloaded: preloadedBaziStatus });
  // 卡面的注入面刻意**不含**数据面：四卡只吃回调与快照，拿不到 RPC 面。
  const injected = { navigate, mainPanels, onStartOnboarding, onOpenDetail, onGenerate, onRefresh, onRetry };
  // 底座是否已立：命盘 ready 即已立（S1 §5 第 5 步：快捷入口据此换副标题）。
  const quicklinkReady = baseplateReady ?? destiny.state === 'ready';

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
        <XsDestinyCard state={destiny.state} snapshot={destiny.snapshot} {...injected} />
        <XsRikkeCard state="empty" today={date} {...injected} />
        <XsDigaoCard state="empty" {...injected} />
        <XsQuickLinks baseplateReady={quicklinkReady} navigate={navigate} mainPanels={mainPanels} />
      </div>
    </div>
  );
}
