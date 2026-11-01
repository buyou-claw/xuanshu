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
import { useAiReadiness } from './ai-views.js';
import { XsDestinyCard, XsDigaoCard, XsQuickLinks, XsRikkeCard, XsWanshengCard } from './cards.js';
import type { DestinySnapshot, DigaoSummary, OverviewInjected, RikkeContent } from './cards.js';
import type { DigaoApi, DigaoStatus } from './digao-api.js';
import type { DigaoOutcome, DigaoUiController } from './digao-controller.js';
import { useHomePaths } from './home-paths.js';
import { ERROR_COPY, PANEL_HOME, PANEL_ID, PANEL_TITLE, panelLocalNote } from './panel.js';
import type { CardState } from './panel.js';
import type { RikkeAiNote, RikkeApi, RikkeNotify, RikkeStatus } from './rikke-api.js';
import type { RikkeOutcome, RikkeUiController } from './rikke-controller.js';
import type { WanshengApi, WanshengFacts, WanshengStatus } from './wansheng-api.js';
import type { WanshengOutcome, WanshengUiController } from './wansheng-controller.js';

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
): { state: CardState; content?: RikkeContent; date?: string; reason?: string; ai?: RikkeAiNote; unread?: number; notify?: RikkeNotify } {
  // #24 的三个加性字段：宿主没给就整键省略（不写 0 / 不编一个 notify）。
  const extras = {
    ...(status.ai === undefined ? {} : { ai: status.ai }),
    ...(status.unread === undefined ? {} : { unread: status.unread }),
    ...(status.notify === undefined ? {} : { notify: status.notify }),
  };
  const base = { content: status.content, date: status.date, ...extras };
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
}): { state: CardState; content?: RikkeContent; date?: string; reason?: string; ai?: RikkeAiNote; unread?: number; notify?: RikkeNotify } {
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

/** 晚省控制器缺席时的空实现（同 `NO_RIKKE_CONTROLLER`）。 */
const NO_WANSHENG_CONTROLLER: Pick<WanshengUiController, 'subscribe' | 'getRevision' | 'getOutcome'> = {
  subscribe: () => () => {},
  getRevision: () => 0,
  getOutcome: () => undefined,
};

/**
 * `wansheng.status` 的回答 → 晚省卡四态（#25）。
 *
 * 三条判据：
 *   - ready 但 `facts` 缺失 = 宿主形状违约 → error（不假装「今天没事发生」）；
 *   - `exists:false` → empty（今天还没生成，不是失败）；
 *   - 人点生成失败 → error + 理由（与日课卡同款）。
 *
 * @param status - 宿主回答。
 * @param outcome - 最近一次**人点的生成**的结果。
 */
export function wanshengStateFromStatus(
  status: WanshengStatus,
  outcome?: WanshengOutcome,
): { state: CardState; facts?: WanshengFacts; date?: string; missed?: boolean; unread?: number; notify?: RikkeNotify; reason?: string } {
  const extras = {
    ...(status.facts === undefined ? {} : { facts: status.facts }),
    ...(status.missed === undefined ? {} : { missed: status.missed }),
    ...(status.unread === undefined ? {} : { unread: status.unread }),
    ...(status.notify === undefined ? {} : { notify: status.notify }),
  };
  const base = { date: status.date, ...extras };
  if (outcome?.ok === false) return { state: 'error', ...base, reason: outcome.reason };
  if (status.exists !== true) return { state: 'empty', ...base, reason: undefined };
  if (status.facts === undefined) {
    return { state: 'error', ...base, reason: '晚省产物在，但当天事实没读回来（facts 缺失）。' };
  }
  return { state: 'ready', ...base, reason: undefined };
}

/**
 * 晚省取数钩子：`wansheng.status` → 卡级四态（`controller` 的代次变化触发重取）。
 * effect 里只允许 `wansheng.status` —— 生成是人点的。
 *
 * @param options - 数据面、控制器与静态预置。
 * @returns 卡级状态、事实、日期与失败理由。
 */
export function useWanshengStatus(options: {
  api?: WanshengApi;
  controller?: WanshengUiController;
  preloaded?: WanshengStatus;
  preloadedOutcome?: WanshengOutcome;
}): { state: CardState; facts?: WanshengFacts; date?: string; missed?: boolean; unread?: number; notify?: RikkeNotify; reason?: string } {
  const { api, controller, preloaded, preloadedOutcome } = options;
  const active = controller ?? NO_WANSHENG_CONTROLLER;
  const revision = useSyncExternalStore(active.subscribe, active.getRevision, active.getRevision);
  const [status, setStatus] = useState<WanshengStatus | undefined>(
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
        if (alive) {
          setStatus({ date: '', exists: false, reason: error instanceof Error ? error.message : ERROR_COPY.wansheng });
        }
      });
    return () => {
      alive = false;
    };
  }, [api, preloaded, revision]);

  const outcome = preloadedOutcome ?? active.getOutcome();
  if (status === undefined) return { state: 'loading' };
  const mapped = wanshengStateFromStatus(status, outcome);
  return status.reason === undefined ? mapped : { ...mapped, state: 'error', reason: status.reason };
}

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
    /**
     * 宿主回传的数据目录（`data.overview.dataDir`，产品 `~/.xuanshu/xuanshu` /
     * 开发 `<repo>/.dsh-home/xuanshu`）：页眉那行「数据都在本地 …」据此渲染。
     * 缺席时显示中性占位「玄枢数据目录」（不写死任何一档，见 `home-paths.ts`）。
     */
    dataDir?: string;
    /** 底座是否已立（票 08 起缺省由命盘状态推导；显式给了就以它为准）。 */
    baseplateReady?: boolean;
    /** 静态预置的命盘状态（测试 / SSR：给了就不调 `bazi.status`）。 */
    preloadedBaziStatus?: BaziStatus;
    /** 静态预置的日课状态与生成结果（测试 / SSR：给了就不取数）。 */
    preloadedRikkeStatus?: RikkeStatus;
    preloadedRikkeOutcome?: RikkeOutcome;
    /** 静态预置的底稿状态与刷新结果（测试 / SSR：给了就不取数）。 */
    preloadedDigaoStatus?: DigaoStatus;
    preloadedDigaoOutcome?: DigaoOutcome;
    /** #25 静态预置的晚省状态与生成结果（测试 / SSR：给了就不取数）。 */
    preloadedWanshengStatus?: WanshengStatus;
    preloadedWanshengOutcome?: WanshengOutcome;
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
  wansheng,
  wanshengController,
  preloadedRikkeStatus,
  preloadedRikkeOutcome,
  preloadedDigaoStatus,
  preloadedDigaoOutcome,
  preloadedWanshengStatus,
  preloadedWanshengOutcome,
  today,
  dataDir,
  homePaths,
  baseplateReady,
  onStartOnboarding,
  onOpenDetail,
  onGenerate,
  onRefresh,
  onRetry,
  aiStatus,
  onOpenAiSettings,
}: OverviewPanelProps) {
  const date = today ?? localDate();
  // R3：装配期注入的宿主 home/dataDir（订阅式，晚到也能重渲染）；显式 props 优先（测试 / SSR 直传）。
  const injectedHomePaths = useHomePaths(homePaths);
  const localDataDir = dataDir ?? injectedHomePaths.dataDir;
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
  // #25：晚省卡（第 5 张）—— 当天事实；生成是人点的，卡本身只取数。
  const wanshengState = useWanshengStatus({
    api: wansheng,
    controller: wanshengController,
    preloaded: preloadedWanshengStatus,
    preloadedOutcome: preloadedWanshengOutcome,
  });
  // 底座是否已立：命盘 ready 即已立（S1 §5 第 5 步：快捷入口与底稿卡空因据此分流）。
  const baseplate = baseplateReady ?? destiny.state === 'ready';
  // #29：问事入口的门禁读「接上 AI」的只读状态（控制器缺席 → unknown，不静默禁用）。
  const aiSnapshot = useAiReadiness(aiStatus);
  /** 2026-11-02：底稿刷新的两个可观察痕迹（见 refreshDigao 的注释）。 */
  const [digaoRefreshing, setDigaoRefreshing] = useState(false);
  const [digaoRefreshedAt, setDigaoRefreshedAt] = useState<Date | undefined>(undefined);

  /**
   * 日课卡 `[去生成 ->]`：**送到日课面板**，而不是就地生成。
   *
   * 2026-11-02 改：原来这里直接 `rikkeController.generate()` —— 点一下就把当天的日课覆盖掉，
   * 一句确认都没有；而日课面板里的同名动作要过一次轻确认（「将覆盖今天的日课，继续？」）。
   * 同一个动作两个入口两种代价。卡面放不下确认块，所以这里只负责导航，
   * 生成闸门统一在 `RikkePanel` 那一处，语义不再有两套。
   */
  const generateRikke = (): void => {
    navigate('rikke');
  };

  /**
   * 底稿卡 `[刷新]`：同样是**人点**才走。
   *
   * 2026-11-02 加：跑完要留两个可观察痕迹 ——
   *   `refreshing`（跑着时按钮显示「刷新中…」、卡上给 role=status）
   *   `refreshedAt`（跑完给一个时刻；底稿内容没变时，这是唯一能确认「真的跑了」的东西）
   *
   * 为什么要这个：实测点完后端 generatedAt 从 14:00:04 变成 14:02:49，
   * 但屏幕上 15 秒采样一个字没变 —— 用户只会以为按钮坏了，于是反复点。
   */
  const refreshDigao =
    digaoController === undefined && onRefresh === undefined
      ? undefined
      : (): void => {
          setDigaoRefreshing(true);
          const run = digaoController === undefined
            ? onRefresh
            : (): Promise<unknown> => digaoController.refresh();
          void Promise.resolve(run?.())
            .catch(() => { /* 失败理由由 outcome 那一路展示，这里只负责收尾 */ })
            .then(() => {
              setDigaoRefreshing(false);
              setDigaoRefreshedAt(new Date());
            });
        };

  /** #25：晚省卡 `[去生成 ->]`：同 `generateRikke`，送到晚省面板由那边的闸门把关。 */
  const generateWansheng = (): void => {
    navigate('wansheng');
  };

  /**
   * 卡级重试（D2：只重跑该卡取数，其它卡不动）。
   *
   * 票 13 的两张卡各自有「上一次人点动作的结果」挂在控制器上，重试必须**清掉它**再重读宿主事实
   * ——否则 `[重试]` 点了界面不动（失败理由还在），看起来像坏了。
   * 命盘卡仍走票 08 的注入面回调（快照代次）。
   */
  const retryRikke =
    rikkeController === undefined
      ? onRetry
      : (): void => {
          rikkeController.clearOutcome();
        };
  const retryDigao =
    digaoController === undefined
      ? onRetry
      : (): void => {
          digaoController.clearOutcome();
        };
  const retryWansheng =
    wanshengController === undefined
      ? onRetry
      : (): void => {
          wanshengController.clearOutcome();
        };

  // 卡面的注入面刻意**不含**数据面：四卡只吃回调与快照，拿不到 RPC 面。
  const injected = {
    navigate,
    mainPanels,
    onStartOnboarding,
    onOpenDetail,
    onGenerate: generateRikke,
    onRefresh: refreshDigao,
    refreshing: digaoRefreshing,
    refreshedAt: digaoRefreshedAt,
    onRetry,
  };

  return (
    <div className="xs-overview" data-xuanshu-panel={PANEL_ID}>
      <header className="xs-overview__header">
        <h1 className="xs-overview__title">
          <span className="xs-overview__home">{PANEL_HOME}</span> · {PANEL_TITLE}
        </h1>
        <p className="xs-overview__localnote" data-xuanshu-note="local-data">
          {panelLocalNote(localDataDir)}
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
          // #24：两段式与触达状态（AI 三态 / 未读 / 最近一次推送失败）都从 `rikke.status` 来。
          ai={rikkeState.ai}
          unread={rikkeState.unread}
          notify={rikkeState.notify}
          {...injected}
          onRetry={retryRikke}
        />
        <XsDigaoCard
          state={digaoState.state}
          summary={digaoState.summary}
          reason={digaoState.reason}
          baseplateEstablished={baseplate}
          {...injected}
          onRetry={retryDigao}
        />
        <XsQuickLinks
          baseplateReady={baseplate}
          navigate={navigate}
          mainPanels={mainPanels}
          {...(aiSnapshot?.readiness === undefined ? {} : { aiReadiness: aiSnapshot.readiness })}
          checking={aiSnapshot?.checking === true}
          {...(aiStatus === undefined ? {} : { onRetryAi: () => { void aiStatus.refresh(); } })}
          {...(onOpenAiSettings === undefined ? {} : { onOpenAiSettings })}
        />
        {/* #25：第 5 张卡 —— 晚省（当天事实；点开进问事）。 */}
        <XsWanshengCard
          state={wanshengState.state}
          today={wanshengState.date === undefined || wanshengState.date === '' ? date : wanshengState.date}
          facts={wanshengState.facts}
          missed={wanshengState.missed}
          unread={wanshengState.unread}
          notify={wanshengState.notify}
          reason={wanshengState.reason}
          {...injected}
          onGenerate={generateWansheng}
          onRetry={retryWansheng}
        />
      </div>
    </div>
  );
}
