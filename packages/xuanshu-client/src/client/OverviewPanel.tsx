/**
 * `main` keyed 槽 key `overview` 的面板：自我总览（四卡首屏）。
 *
 * 屏稿：`docs/design/ui-v1/screens/S1-自我总览.md`（§2 线框、§4 组件树 XsOverviewGrid、§5 交互流程）。
 * 票 07 交付结构（三张数据卡恒冷启动空态），**票 08 点亮命盘卡**（`bazi.status`），
 * **票 13 点亮日课卡与底稿卡**：
 *   - 日课卡：读 `rikke.status` 给 `state`（loading / empty / ready / error）+ `content`，
 *     `[立即生成]` → 人点的 `rikke.generate`（经 `RikkeUiController`，**不许自动跑**）；
 *   - 底稿卡：读 `digao.status` 给 `state` + `summary={{segments,sources}}`，
 *     `[刷新]` → 人点的 `digao.refresh`（经 `DigaoUiController`）。
 * 快捷入口是静态卡；四卡共用 `XsCardShell` 外壳，卡级三态、无整页 loading（D2）。
 *
 * 注入面（`PropsRuntime<'main'>` 的 owner 分享）：由 `index.tsx` 的 register `inject`
 * 提供 `navigate` / `mainPanels` / 三份数据面与取数代次；`main` 槽未声明 owner，
 * 官方座位里没有 `useSession`/`useConversation`（`DSH槽位映射.md` F1），
 * 因此本面板只用全局座位与注入面。
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';

import type { BaziApi, BaziStatus } from './bazi-api.js';
import type { BaziUiController } from './bazi-controller.js';
import { XsDestinyCard, XsDigaoCard, XsQuickLinks, XsRikkeCard } from './cards.js';
import type { DestinySnapshot, DigaoSummary, OverviewInjected, RikkeContent } from './cards.js';
import type { DigaoApi, DigaoStatus } from './digao-api.js';
import type { DigaoOutcome, DigaoUiController } from './digao-controller.js';
import { ERROR_COPY, PANEL_HOME, PANEL_ID, PANEL_LOCAL_NOTE, PANEL_TITLE } from './panel.js';
import type { CardState } from './panel.js';
import type { RikkeApi, RikkeStatus } from './rikke-api.js';
import type { RikkeOutcome, RikkeUiController } from './rikke-controller.js';

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
 * `rikke.status` 的回答 → 日课卡四态（S1 §6②：今天有卡 → ready；今天还没生成 → empty；
 * 生成失败 / 读不出来 → error）。
 *
 * @param status - 宿主回答。
 * @param outcome - 最近一次**人点的生成**的结果（失败时理由必须看得见）。
 * @returns 卡级状态、卡片内容、卡头日期与失败理由。
 */
export function rikkeStateFromStatus(
  status: RikkeStatus,
  outcome?: RikkeOutcome,
): { state: CardState; content?: RikkeContent; date?: string; reason?: string } {
  const base = { content: status.content, date: status.date };
  if (outcome?.ok === false) {
    // 生成失败：理由优先（底座未立 / 推运失败），已有内容照常带出去（S14 §6 error 行）。
    return { state: 'error', ...base, reason: outcome.reason };
  }
  if (status.exists !== true) return { state: 'empty', ...base, reason: undefined };
  // 「exists 但没有 content」是宿主侧的形状违约：按失败处理，不假装今天有内容。
  if (status.content === undefined) {
    return { state: 'error', ...base, reason: '当日日课文件在，但内容没读回来（content 缺失）。' };
  }
  return { state: 'ready', ...base, reason: undefined };
}

/**
 * `digao.status` 的回答 → 底稿卡四态（S1 §6③：meta 在 → ready；没生成过 → empty；
 * 读不出来 / 刷新失败 → error）。
 *
 * @param status - 宿主回答。
 * @param outcome - 最近一次**人点的刷新**的结果。
 * @returns 卡级状态、卡面 summary（段数 / 来源路数）与失败理由。
 */
export function digaoStateFromStatus(
  status: DigaoStatus,
  outcome?: DigaoOutcome,
): { state: CardState; summary?: DigaoSummary; reason?: string } {
  const summary: DigaoSummary | undefined =
    status.meta === null
      ? undefined
      : {
          segments: status.meta.segments ?? 0,
          sources: status.meta.sources ?? 0,
          ...(status.meta.generatedAt === undefined ? {} : { updatedAt: status.meta.generatedAt }),
        };
  if (outcome?.ok === false) return { state: 'error', summary, reason: outcome.reason };
  if (status.exists !== true) return { state: 'empty', summary, reason: undefined };
  if (status.meta === null) {
    return { state: 'error', summary, reason: '底稿文件在，但元数据没读回来（meta 缺失）。' };
  }
  return { state: 'ready', summary, reason: undefined };
}

/**
 * 日课取数钩子：`rikke.status` → 卡级四态（`controller` 的代次变化触发重取）。
 *
 * 与 `useBaziStatus` 同三条行为：`preloaded` 给了就不取数；没有数据面 → 恒 `empty`
 * （票 07 的冷启动观感原样保留，卡片写路径继续 fail-soft 置灰）；
 * **effect 里只允许 `rikke.status`** —— 生成是人点的，绝不在这里调 `rikke.generate`。
 *
 * @param options - 数据面、控制器与静态预置。
 * @returns 卡级状态、内容、日期与失败理由。
 */
export function useRikkeStatus(options: {
  api?: RikkeApi;
  controller?: RikkeUiController;
  preloaded?: RikkeStatus;
  preloadedOutcome?: RikkeOutcome;
}): { state: CardState; content?: RikkeContent; date?: string; reason?: string } {
  const { api, controller, preloaded, preloadedOutcome } = options;
  const active = controller ?? NO_RIKKE_CONTROLLER;
  const revision = useSyncExternalStore(active.subscribe, active.getRevision, active.getRevision);
  const [status, setStatus] = useState<RikkeStatus | undefined>(
    preloaded ?? (api === undefined ? { date: '', exists: false } : undefined),
  );

  useEffect(() => {
    if (preloaded !== undefined) {
      setStatus(preloaded);
      return;
    }
    if (api === undefined) {
      setStatus({ date: '', exists: false });
      return;
    }
    let alive = true;
    void api
      .status()
      .then((answer) => {
        if (alive) setStatus(answer);
      })
      .catch((error: unknown) => {
        if (alive) setStatus({ date: '', exists: false, reason: error instanceof Error ? error.message : ERROR_COPY.rike });
      });
    return () => {
      alive = false;
    };
  }, [api, preloaded, revision]);

  const outcome = preloadedOutcome ?? active.getOutcome();
  if (status === undefined) return { state: 'loading' };
  const mapped = rikkeStateFromStatus(status, outcome);
  // 取数本身失败（RPC 拒绝）时，status.reason 就是卡面的理由（不许静默）。
  return status.reason === undefined ? mapped : { ...mapped, state: 'error', reason: status.reason };
}

/**
 * 底稿取数钩子：`digao.status` → 卡级四态 + summary（`controller` 的代次变化触发重取）。
 * effect 里只允许 `digao.status` —— 刷新是人点的。
 *
 * @param options - 数据面、控制器与静态预置。
 * @returns 卡级状态、summary 与失败理由。
 */
export function useDigaoStatus(options: {
  api?: DigaoApi;
  controller?: DigaoUiController;
  preloaded?: DigaoStatus;
  preloadedOutcome?: DigaoOutcome;
}): { state: CardState; summary?: DigaoSummary; reason?: string } {
  const { api, controller, preloaded, preloadedOutcome } = options;
  const active = controller ?? NO_DIGAO_CONTROLLER;
  const revision = useSyncExternalStore(active.subscribe, active.getRevision, active.getRevision);
  const [status, setStatus] = useState<DigaoStatus | undefined>(
    preloaded ?? (api === undefined ? { exists: false, meta: null } : undefined),
  );

  useEffect(() => {
    if (preloaded !== undefined) {
      setStatus(preloaded);
      return;
    }
    if (api === undefined) {
      setStatus({ exists: false, meta: null });
      return;
    }
    let alive = true;
    void api
      .status()
      .then((answer) => {
        if (alive) setStatus(answer);
      })
      .catch((error: unknown) => {
        if (alive) {
          setStatus({
            exists: false,
            meta: null,
            reason: error instanceof Error ? error.message : ERROR_COPY.digao,
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [api, preloaded, revision]);

  const outcome = preloadedOutcome ?? active.getOutcome();
  if (status === undefined) return { state: 'loading' };
  const mapped = digaoStateFromStatus(status, outcome);
  return status.reason === undefined ? mapped : { ...mapped, state: 'error', reason: status.reason };
}

/** 没有控制器时的空实现（组件被单独渲染：测试 / SSR）。`useSyncExternalStore` 要求订阅稳定。 */
const NO_RIKKE_CONTROLLER: Pick<RikkeUiController, 'subscribe' | 'getRevision' | 'getOutcome'> = {
  subscribe: () => () => {},
  getRevision: () => 0,
  getOutcome: () => undefined,
};

/** 底稿控制器缺席时的空实现（同 `NO_RIKKE_CONTROLLER`）。 */
const NO_DIGAO_CONTROLLER: Pick<DigaoUiController, 'subscribe' | 'getRevision' | 'getOutcome'> = {
  subscribe: () => () => {},
  getRevision: () => 0,
  getOutcome: () => undefined,
};

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
    /** 日课数据面（票 13；`index.tsx` 用 `createRikkeApi(ctx)` 造好注入）。 */
    rikke?: RikkeApi;
    /** 日课生成 / 取数代次（票 13）。 */
    rikkeController?: RikkeUiController;
    /** 底稿数据面（票 13）。 */
    digao?: DigaoApi;
    /** 底稿刷新 / 取数代次（票 13）。 */
    digaoController?: DigaoUiController;
    /** 静态预置的日课状态与生成结果（测试 / SSR：给了就不取数）。 */
    preloadedRikkeStatus?: RikkeStatus;
    preloadedRikkeOutcome?: RikkeOutcome;
    /** 静态预置的底稿状态与刷新结果（测试 / SSR：给了就不取数）。 */
    preloadedDigaoStatus?: DigaoStatus;
    preloadedDigaoOutcome?: DigaoOutcome;
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
  rikke,
  rikkeController,
  digao,
  digaoController,
  preloadedRikkeStatus,
  preloadedRikkeOutcome,
  preloadedDigaoStatus,
  preloadedDigaoOutcome,
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
  // 日课卡 / 底稿卡：票 13 起数据驱动（取数只读；生成与刷新是人点的，见下两个回调）。
  const rikkeState = useRikkeStatus({
    api: rikke,
    controller: rikkeController,
    preloaded: preloadedRikkeStatus,
    preloadedOutcome: preloadedRikkeOutcome,
  });
  const digaoState = useDigaoStatus({
    api: digao,
    controller: digaoController,
    preloaded: preloadedDigaoStatus,
    preloadedOutcome: preloadedDigaoOutcome,
  });
  // 底座是否已立：命盘 ready 即已立（S1 §5 第 5 步：快捷入口与底稿卡空因据此分流）。
  const baseplate = baseplateReady ?? destiny.state === 'ready';

  /**
   * 日课卡 `[立即生成]`：**人点**才走（`rikkeController.generate()` 是唯一调用点；
   * 数据面缺席时退回注入面的回调，票 07 的 fail-soft 置灰原样保留）。
   */
  const generateRikke =
    rikkeController === undefined
      ? onGenerate
      : (): void => {
          void rikkeController.generate();
        };

  /** 底稿卡 `[刷新]`：同样是**人点**才走。 */
  const refreshDigao =
    digaoController === undefined
      ? onRefresh
      : (): void => {
          void digaoController.refresh();
        };

  // 卡面的注入面刻意**不含**数据面：四卡只吃回调与快照，拿不到 RPC 面。
  const injected = {
    navigate,
    mainPanels,
    onStartOnboarding,
    onOpenDetail,
    onGenerate: generateRikke,
    onRefresh: refreshDigao,
    onRetry,
  };

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
        <XsRikkeCard
          state={rikkeState.state}
          today={rikkeState.date === undefined || rikkeState.date === '' ? date : rikkeState.date}
          content={rikkeState.content}
          reason={rikkeState.reason}
          {...injected}
        />
        <XsDigaoCard
          state={digaoState.state}
          summary={digaoState.summary}
          reason={digaoState.reason}
          baseplateEstablished={baseplate}
          {...injected}
        />
        <XsQuickLinks baseplateReady={baseplate} navigate={navigate} mainPanels={mainPanels} />
      </div>
    </div>
  );
}
