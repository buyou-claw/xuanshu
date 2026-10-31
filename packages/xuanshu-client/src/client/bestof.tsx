/**
 * 票 11 · 合参的客户端装配：浮层 + 设置开关行 + `/多模型` 命令（契约 §1）。
 *
 * 三条注册都是**纯加性**（新 cell / 新设置行 / 新命令名，都不碰 DSH 既有 key）：
 *   - `shell.overlay`：浮层，**没有内容时 `return null`**（click-through 约定，事实笔记 §6.1）；
 *   - `settings.general.item`：一行开关（比 `settings.section` 轻；先例 `dsh-client-locale` 的
 *     `id:'language', order:0` 注册法）；
 *   - `ctx.commandUi.register`：`/多模型` + 别名 `/合参` · `bestof`（`CommandContribution` 没有
 *     `aliases` 字段，所以按名字注册三条，指同一个处理器）。
 *
 * **命令面拿不到问题原文**：`ActionSpec.run(session)` 只拿到 `ClientSessionContext{sessionId}`
 * （`dsh-client-ui-commands` 的 `invoke()` 把 `segment` 自己消费掉、不传给 `run`），所以浮层自带一个
 * 问题输入框 —— `/多模型 <问题>` 里那截文本进不来。`parseBestofCommand()` 已按 S9 §2.1 的规则
 * 实现并测好（命令名到第一个空白为界、`//` 不算命令），等有带文本的触发面直接接上。
 *
 * **票 UX-03（#65）· 三个入口的空态**：浮层、设置项、输入框触发器都会出现「什么都没有」的时刻
 * （没有会话 / 凑不到两路 / 一轮跑完 0 份候选）。判定只写在 `bestofEmptyOf()` 一处，
 * 三个宿主各挑自己那一格渲染 —— 空态因此不会随三个面漂成三种口径。
 *
 * **两个宿主在挂载时各问一次**（2026-10-31 收口）：设置项读一次路由目录、触发器探一次问事会话。
 * 不问的话初始快照里 `sessionId` / `routes` 都是 `undefined`，两条空态**永远命中不了** ——
 * 静态判据（S-001）绿着，用户看到的仍是空白。所以「未加载」与「确实没有」在状态里是两个位
 * （`sessionKnown` / `routesKnown`）：没问过 → 「正在读…」；问过且确实没有 → 空态 + 下一步。
 */
import type { Context } from '@deepseek-ai/cordis';
import { useEffect, useSyncExternalStore } from 'react';

import type { BestofApi } from './bestof-api.js';
import { readService } from './ctx-service.js';
import { BESTOF_COMMAND_NAMES, BESTOF_MIN_ROUTES, createBestofController } from './bestof-model.js';
import type { BestofController, BestofUiState } from './bestof-model.js';
import { installBestofStyle } from './bestof-style.js';
import { XsBestofOverlay, XsBestofSettingsRow, XsBestofTriggerButton } from './bestof-views.js';
import type { BestofOverlayActions } from './bestof-views.js';

/** 浮层在 `shell.overlay` 里的 cell id / 设置行 id / 触发按钮 id（改这里等于改注册面）。 */
export const BESTOF_OVERLAY_ID = 'xuanshu-bestof-overlay';
export const BESTOF_SETTINGS_ID = 'xuanshu.bestof';
export const BESTOF_TRIGGER_ID = 'xuanshu-bestof-trigger';

/** `installBestOf` 需要的依赖（`index.tsx` 造好；浮层与设置行共用一份控制器）。 */
export interface BestofInstallDeps {
  api: BestofApi;
  controller: BestofController;
  /** 打开设置（DSH 里「设置」不是 main 面板，能不能导航由调用方决定；给不出就不渲染按钮）。 */
  openSettings?(): void;
  /**
   * 按钮触发时用的会话 id：命令面能拿到当前 sessionId，**按钮拿不到**，
   * 所以由一个回调去定（`index.tsx` 里取「最近一次问事会话」）。拿不到就按空处理 ——
   * 控制器会停在费用确认框上说「还没有问事会话」。
   */
  resolveSessionId?(): Promise<string | undefined>;
}

/** 把控制器接成视图要的动作面（纯转发，不加任何自己的判断）。 */
export function bestofActions(deps: Pick<BestofInstallDeps, 'controller' | 'openSettings'>): BestofOverlayActions {
  const { controller } = deps;
  return {
    onEditQuestion: (question) => controller.editQuestion(question),
    onStart: () => {
      void controller.confirm();
    },
    onCancel: () => controller.dismiss(),
    onStop: () => {
      void controller.stop();
    },
    onAdopt: (candidateId) => {
      void controller.adopt(candidateId);
    },
    onMerge: () => {
      void controller.merge();
    },
    onReject: () => {
      void controller.reject();
    },
    onRetry: () => {
      // 「重来一轮」= 收起旧的一轮、回到费用确认（沿用同一个问题）。
      const { question, sessionId } = controller.snapshot();
      controller.ask({ question, sessionId: sessionId ?? '' });
    },
    // 票 28：确认屏上增删一路（控制器负责 2–4 路上限与重算 estimate）。
    onToggleRoute: (route) => {
      void controller.toggleRoute(route);
    },
    ...(deps.openSettings === undefined ? {} : { onOpenSettings: deps.openSettings }),
  };
}

/**
 * 票 UX-03（#65）· 空态的种类。
 *
 * 三个入口（浮层 / 设置项 / 输入框触发器）各自的「空」不是同一件事，但**判定只在这一处**：
 * 谁空着、空成什么样，由 `bestofEmptyOf()` 一张表说完；三个宿主只挑自己那一格去渲染。
 * 于是「空态」不会随着三个面各写一份判断而漂成三种口径。
 */
export type BestofEmptyKind = 'no-session' | 'no-route' | 'no-candidate';

/** 一条空态：一句人话（只许「还没有…」）+ 一步可执行的下一步。 */
export interface BestofEmpty {
  kind: BestofEmptyKind;
  /** 人话（词表：空态只许「还没有…」「没有…」，`scripts/ux/state-vocabulary.mjs`）。 */
  text: string;
  /** 下一步：没有这一步的空态等于把闸门藏起来。 */
  next: string;
}

/**
 * 三面共用的空态判定（按「挡住合参的第一件事」排先后）。
 *
 * 顺序是有意的：没有会话就没法算跑前估算（`loadEstimate` 直接返回），所以「没有会话」
 * 排在「凑不到两路」之前；「这一轮没有候选」是跑完之后的事，排最后。
 *
 * @param state 控制器快照（浮层 / 设置行 / 触发器共用一份）
 * @returns 空态；`undefined` = 不空（有内容、正在跑、或本来就该收起）
 */
export function bestofEmptyOf(state: BestofUiState): BestofEmpty | undefined {
  // ① 输入框触发器那条路径拿不到 sessionId（`resolveSessionId` 也给不出）——先要有会话可挂。
  //    `undefined` 且**没问过**只是「还不知道」（首屏），不是「没有」：混成一个会让空态要么永不出现，
  //    要么在没问之前就替用户断言「你还没有会话」。
  const sessionMissing = state.sessionId === '' || (state.sessionId === undefined && state.sessionKnown === true);
  if (sessionMissing) {
    return {
      kind: 'no-session',
      text: '还没有问事会话：合参要挂在一个问事会话上。',
      next: '先去「问事」开一次会话，再回来点「多 AI 合参」。',
    };
  }
  // ② 路由目录**真读过**、且确实凑不到两路：这时候「跑一轮」也只有一个视角，谈不上并列。
  //    `routes === undefined` 可能只是「还没读」或老宿主没有 `routes.list` —— 那两种都不是空态。
  if (state.routesKnown === true && Array.isArray(state.routes) && state.routes.length < BESTOF_MIN_ROUTES) {
    return {
      kind: 'no-route',
      text: `还没有两路可并列（现在 ${state.routes.length} 路）。`,
      next: '去 DSH「设置 → 模型」里再加一家 provider 或 model：合参至少要两路。',
    };
  }
  // ③ 一轮跑完了，一份候选都没回来：网格是空的，但这不是「还在加载」。
  if (state.view !== undefined && state.view.finished === true && state.view.candidates.length === 0) {
    return {
      kind: 'no-candidate',
      text: '这一轮还没有任何候选回来（几路都没有产出）。',
      next: '点「重试合参」再跑一轮；若还是这样，去 DSH「设置 → 模型」里换一家 provider。',
    };
  }
  return undefined;
}

/** 空态说明块（三面共用一份标记；`data-xuanshu-view="empty"` 是采集口径认的那个状态标记）。 */
export function XsBestofEmptyNotice({ empty }: { empty: BestofEmpty }) {
  return (
    <div className="xs-bestof__warn" data-xs-bestof="empty" data-xuanshu-view="empty">
      <p className="xs-bestof__note">{empty.text}</p>
      <p className="xs-bestof__note">{empty.next}</p>
    </div>
  );
}

/** `shell.overlay` 的浮层本体（注册时由 `inject: () => deps` 注入依赖）。 */
export function BestofOverlayHost({ controller, openSettings }: BestofInstallDeps) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const actions = bestofActions({ controller, ...(openSettings === undefined ? {} : { openSettings }) });
  // click-through 不变：没内容时浮层整块不出现（空态也不许把这一条破坏掉）。
  if (state.phase === 'idle') return null;
  const empty = bestofEmptyOf(state);
  // 一轮跑完却一份候选都没有：原来只留一个空网格，人分不清「没数据」还是「没加载出来」。
  if (empty !== undefined && empty.kind === 'no-candidate') {
    return (
      <div className="xs-bestof-backdrop" role="dialog" aria-label="多 AI 合参">
        <div className="xs-bestof" data-xs-bestof="empty">
          <div className="xs-bestof__head">
            <h3>多 AI 合参</h3>
            <span className="xs-bestof__tag">这一轮 0 路</span>
          </div>
          <XsBestofEmptyNotice empty={empty} />
          <div className="xs-bestof__actions">
            <button type="button" className="xs-btn--primary" onClick={actions.onRetry}>重试合参</button>
            <button type="button" onClick={actions.onReject}>否决本轮</button>
            <button type="button" onClick={actions.onCancel}>收起</button>
          </div>
        </div>
      </div>
    );
  }
  return <XsBestofOverlay state={state} actions={actions} />;
}

/** 设置里的一行开关（外加一条只在「凑不到两路」时出现的空态）。 */
export function BestofSettingsRowHost({ controller }: BestofInstallDeps) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  // 挂载时读一次路由目录：不读，`routes` 就永远是 `undefined`（它原先只在估算成功后才有），
  // 「还没有两路可并列」这条空态在首屏就永远不可能出现 —— 静态判据绿、用户看到的还是空白。
  useEffect(() => {
    void controller.loadRoutes();
  }, [controller]);
  const empty = bestofEmptyOf(state);
  const routeGap = empty !== undefined && empty.kind === 'no-route' ? empty : undefined;
  return (
    <>
      <XsBestofSettingsRow state={state} actions={{ onToggle: (enabled) => controller.setEnabled(enabled) }} />
      {/* 还没读过目录时只说「正在读」，不冒充空态（未加载 ≠ 确实没有）。 */}
      {state.routesKnown !== true && <p className="xs-bestof__note" role="status">正在读取模型目录…</p>}
      {routeGap !== undefined && <XsBestofEmptyNotice empty={routeGap} />}
    </>
  );
}

/**
 * 装配合参的客户端面。
 * @param ctx - 客户端 cordis 上下文（`slots` 已就绪；`commandUi` 软取）。
 * @param deps - 数据面与控制器（浮层与设置行共用一份）。
 */
export function installBestOf(ctx: Context, deps: BestofInstallDeps): void {
  installBestofStyle();

  // ① 浮层：无内容时视图自己 return null（不占指针）。
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: BESTOF_OVERLAY_ID, inject: () => deps }, BestofOverlayHost as never),
  );

  // ② 设置里的一行开关（`settings.general.item` 由 ui-settings-general 声明；不在场时不抛）。
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({ name: 'settings.general.item', id: BESTOF_SETTINGS_ID, order: 60, inject: () => deps }, BestofSettingsRowHost as never),
  );

  // ③ `/多模型` 与两个别名：客户端命令面（宿主目录里没有同名命令，不会撞名报错）。
  const commandUi = readService<{ register(contribution: unknown): () => void }>(ctx, 'commandUi');
  if (typeof commandUi?.register === 'function') {
    for (const name of BESTOF_COMMAND_NAMES) {
      ctx.effect(() =>
        commandUi.register({
          name,
          label: () => '多 AI 合参',
          description: () => '一个问题多路 AI 并列给答案、分歧可见、拍板在人',
          // 关着的时候命令也在（S9 §1：关闭时触发一次提示 + 给「去设置打开」）。
          available: () => true,
          ui: {
            kind: 'action',
            run: (session: { sessionId: string }) => {
              const snapshot = deps.controller.snapshot();
              deps.controller.ask({ question: snapshot.question, sessionId: session.sessionId });
            },
          },
        }),
      );
    }
  }

  // ④ 会话 composer 旁的触发按钮（与命令等价的入口）。槽名在本版是否在册**未确认**：
  //    槽不在时 inject 只是不回调，命令入口照常可用。
  const trigger = () => {
    const snapshot = deps.controller.snapshot();
    const resolve = deps.resolveSessionId;
    if (resolve === undefined) {
      deps.controller.ask({ question: snapshot.question, sessionId: '' });
      return;
    }
    void resolve().then((sessionId) => {
      deps.controller.ask({ question: deps.controller.snapshot().question, sessionId: sessionId ?? '' });
    });
  };
  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.composer.dock',
        id: BESTOF_TRIGGER_ID,
        // `resolveSessionId` 一起注入：空态要在挂载时就问一次「有没有会话」，
        // 只在点击时问意味着首屏永远不显示「还没有问事会话」。
        inject: () => ({
          onTrigger: trigger,
          controller: deps.controller,
          ...(deps.resolveSessionId === undefined ? {} : { resolveSessionId: deps.resolveSessionId }),
        }),
      },
      BestofTriggerHost as never,
    ),
  );
}

/**
 * 按钮的宿主组件（把 `onTrigger` 与控制器一起传进纯视图）。
 *
 * 票 UX-03：这个入口唯一会「空着」的情况是**拿不到问事会话** —— 点下去会开到确认屏，
 * 人要写完问题、点「开始合参」才知道「还没有会话」。所以空态提前长在按钮旁边。
 * 「有没有会话」在挂载时问一次（`resolveSessionId`）：不问的话首屏的 `sessionId` 是 `undefined`，
 * 空态永远不出现 —— 静态判据绿着，用户看到的还是什么都没有。
 */
export function BestofTriggerHost({ controller, onTrigger, resolveSessionId }: { controller: BestofController; onTrigger(): void; resolveSessionId?(): Promise<string | undefined> }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useEffect(() => {
    // SSR 不跑 effect：首屏按「还没问过」渲染（下一行那句「正在读」），问过之后才敢说「没有」。
    let alive = true;
    if (resolveSessionId === undefined) {
      controller.probeSession(undefined);
      return () => { alive = false; };
    }
    void resolveSessionId()
      .then((sessionId) => { if (alive) controller.probeSession(sessionId); })
      .catch(() => { if (alive) controller.probeSession(undefined); });
    return () => { alive = false; };
  }, [controller, resolveSessionId]);
  const empty = bestofEmptyOf(state);
  const sessionGap = empty !== undefined && empty.kind === 'no-session' ? empty : undefined;
  return (
    <>
      <XsBestofTriggerButton onTrigger={onTrigger} />
      {/* 还没问过会话时只说「正在读」，不说「还没有」（那是替用户编事实）。 */}
      {state.sessionKnown !== true && <p className="xs-bestof__note" role="status">正在读取最近一次问事会话…</p>}
      {sessionGap !== undefined && <XsBestofEmptyNotice empty={sessionGap} />}
    </>
  );
}

/** 造一个默认关闭的控制器（`index.tsx` 用；断言台也可直接用）。 */
export function createBestofClient(api: BestofApi): BestofController {
  return createBestofController({ api });
}
