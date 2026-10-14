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
 */
import type { Context } from '@deepseek-ai/cordis';
import { useSyncExternalStore } from 'react';

import type { BestofApi } from './bestof-api.js';
import { BESTOF_COMMAND_NAMES, createBestofController } from './bestof-model.js';
import type { BestofController } from './bestof-model.js';
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
    ...(deps.openSettings === undefined ? {} : { onOpenSettings: deps.openSettings }),
  };
}

/** `shell.overlay` 的浮层本体（注册时由 `inject: () => deps` 注入依赖）。 */
export function BestofOverlayHost({ controller, openSettings }: BestofInstallDeps) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  return <XsBestofOverlay state={state} actions={bestofActions({ controller, ...(openSettings === undefined ? {} : { openSettings }) })} />;
}

/** 设置里的一行开关。 */
export function BestofSettingsRowHost({ controller }: BestofInstallDeps) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  return <XsBestofSettingsRow state={state} actions={{ onToggle: (enabled) => controller.setEnabled(enabled) }} />;
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
  const commandUi = (ctx as Context & { commandUi?: { register(contribution: unknown): () => void } }).commandUi;
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
    ctx.slots.register({ name: 'conversation.composer.dock', id: BESTOF_TRIGGER_ID, inject: () => ({ onTrigger: trigger }) }, BestofTriggerHost as never),
  );
}

/** 触发按钮的宿主组件（把 `onTrigger` 传进纯视图）。 */
export function BestofTriggerHost({ onTrigger }: { onTrigger(): void }) {
  return <XsBestofTriggerButton onTrigger={onTrigger} />;
}

/** 造一个默认关闭的控制器（`index.tsx` 用；断言台也可直接用）。 */
export function createBestofClient(api: BestofApi): BestofController {
  return createBestofController({ api });
}
