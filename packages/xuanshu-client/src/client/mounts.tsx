/**
 * packages/xuanshu-client/src/client/mounts.tsx — 票 12 的接线（S8 抽屉：`shell.overlay`）。
 *
 * 只做三件事：
 *   1. **控制器**（`createMountsController`）：抽屉的开合 / 选择 / 折叠 / 预览缓存 / 确认写入。
 *      预览走 `consult.setMounts({preview:true})`（**只算不写**），确认才真写 —— 两条路同一个方法，
 *      于是「预览看到的数字」就是「确认后注入的数字」。
 *   2. **浮层组件**：`shell.overlay` 上的抽屉（无内容时 `return null` ⇒ 自动 click-through，
 *      与票 07 的藏抽屉同款）。
 *   3. **安装函数**：**纯加性** —— 只注册一个 `shell.overlay` cell，不碰 root / children / priority，
 *      apply 期不调 `ctx.layout.selectPanel`（S3 断言它恰一次且值为 overview）。
 *
 * 抽屉挂在哪个会话：挂载落在**某一次问事**的旁挂清单上，所以必须先有会话。
 * 门厅里没有会话时按钮是禁用的（理由照实说），这比「挂到一个还不存在的东西上」诚实。
 */
import { useSyncExternalStore } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { MountRef, MountPreview, MountsApi, WorkspaceCandidate } from './mounts-api.js';
import { createMountsController as createController, type MountsController } from './mounts-controller.js';
import { XsMountDrawer, XsMountSection } from './mounts-views.js';
import { layerRows, statusFromPreview } from './mounts-model.js';

export type { MountsController } from './mounts-controller.js';

/** 样式（一次性注入同名 style；无 document 时**跳过注入**，但注册照常发生）。 */
export function installMountsStyle(): void {
  if (typeof document === 'undefined') return;
  const id = 'xuanshu-mounts-style';
  if (document.getElementById(id) !== null) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = [
    '.xs-mounts__section{margin:12px 0;padding:10px;border:1px solid var(--dsw-alias-border,#333);border-radius:8px}',
    '.xs-mounts__section-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.xs-mounts__summary,.xs-mounts__note{margin:6px 0;opacity:.8;font-size:12px}',
    '.xs-mounts__status{background:none;border:0;padding:0;color:inherit;opacity:.85;cursor:pointer;font-size:12px}',
    '.xs-mounts__overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;justify-content:flex-end;z-index:60}',
    '.xs-mounts__drawer{width:min(720px,92vw);height:100%;overflow:auto;background:var(--dsw-alias-bg,#111);padding:16px;display:flex;flex-direction:column;gap:12px}',
    '.xs-mounts__head{display:flex;align-items:center;justify-content:space-between}',
    '.xs-mounts__boundary{margin:0;padding:8px;border-left:3px solid var(--dsw-alias-accent,#888);opacity:.9;font-size:12px}',
    '.xs-mounts__rows,.xs-mounts__layers{list-style:none;margin:6px 0;padding:0}',
    '.xs-mounts__row label{display:flex;align-items:center;gap:8px;padding:4px 0}',
    '.xs-mounts__row-path{opacity:.7;font-size:12px}',
    '.xs-mounts__row-meta{opacity:.6;font-size:12px;margin-left:auto}',
    '.xs-mounts__layer{padding:6px 0;border-bottom:1px solid var(--dsw-alias-border,#2a2a2a)}',
    '.xs-mounts__layer-head{display:flex;align-items:center;gap:8px}',
    '.xs-mounts__layer-name{flex:1}',
    '.xs-mounts__tag{font-size:12px;padding:1px 6px;border-radius:10px;border:1px solid currentColor}',
    '.xs-mounts__tag[data-xuanshu-tag="clipped"]{color:#e0a030}',
    '.xs-mounts__tag[data-xuanshu-tag="dropped"]{color:#e05a5a}',
    '.xs-mounts__tag[data-xuanshu-tag="error"]{color:#e05a5a}',
    '.xs-mounts__foot{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border,#333)}',
    '.xs-mounts__primary{font-weight:600}',
    '.xs-mounts__ghost{background:none;border:0;padding:0;color:inherit;opacity:.75;cursor:pointer;font-size:12px;text-decoration:underline}',
    '.xs-mounts__error{color:#e05a5a;font-size:12px}',
  ].join('\n');
  document.head.appendChild(style);
}

/** 浮层组件：没有任何内容时返回 `null`（`shell.overlay` 自动 click-through）。 */
export function MountsOverlay({ controller, workspaces, gotoWorkspaces }: {
  controller: MountsController;
  workspaces: () => WorkspaceCandidate[];
  gotoWorkspaces?: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  if (!state.open) return null;
  const rows = layerRows(state.preview);
  return (
    <XsMountDrawer
      workspaces={workspaces()}
      workspaceAvailable={state.workspaceAvailable}
      selection={state.selection}
      preview={state.preview}
      rows={rows}
      budgetSource={state.preview?.budgetSource}
      busy={state.busy}
      error={state.error}
      canConfirm={state.selection.length > 0 || state.mounts.length > 0}
      foldOpen={(layerId) => state.fold.isOpen(layerId)}
      onToggleWorkspace={(candidate) => { controller.toggleWorkspace(candidate); }}
      onFold={(layerId) => { controller.fold(layerId); }}
      onCancel={() => { controller.close(); }}
      onConfirm={() => { void controller.confirm(); }}
      onRetry={() => { void controller.refreshPreview(); }}
      onRefresh={() => { void controller.refreshPreview(); }}
      {...(gotoWorkspaces === undefined ? {} : { gotoWorkspaces })}
    />
  );
}

/**
 * 门厅里的挂载区（受控小壳）：读缓存里的预览，不自己发 RPC。
 *
 * 首次进入时若这个会话已有挂载，会由控制器 `ensurePreview()` 拉一次（**读**，不写）。
 */
export function MountsSectionFor({ controller, session, reason }: {
  controller: MountsController;
  session?: { sessionId: string; mounts?: MountRef[] } | undefined;
  reason?: string;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const mounts = session?.mounts ?? [];
  const status = session === undefined ? undefined : statusFromPreview(controller.cachedPreview(session.sessionId));
  return (
    <XsMountSection
      mounts={mounts}
      status={status}
      canMount={session !== undefined}
      revision={state.revision}
      {...(reason === undefined ? {} : { reason })}
      {...(session === undefined
        ? {}
        : {
            onOpen: () => {
              controller.open(session.sessionId, mounts);
            },
          })}
    />
  );
}

/** 控制器依赖：数据面 + 工作区目录（只读投影）。 */
export interface MountsInstallDeps {
  api: MountsApi;
  workspaces: () => WorkspaceCandidate[];
  workspaceAvailable?: boolean;
  gotoWorkspaces?: () => void;
}

/** 建控制器（导出给 `index.tsx` 与断言台用；内部实现见 `mounts-controller.ts`）。 */
export function createMountsController(deps: MountsInstallDeps): MountsController {
  return createController({
    api: deps.api,
    workspaces: deps.workspaces,
    workspaceAvailable: deps.workspaceAvailable ?? true,
  });
}

/**
 * 加性安装：**只**注册一个 `shell.overlay` cell（抽屉）。
 * 没有面板、没有侧栏行 —— 票 12 是「挂载账本」，它的入口在门厅与状态栏上。
 */
export function installMounts(ctx: Context, deps: MountsInstallDeps): MountsController {
  installMountsStyle();
  const controller = createMountsController(deps);
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'xuanshu-mounts-drawer',
        inject: () => ({ controller, workspaces: deps.workspaces }),
      },
      MountsOverlay,
    ),
  );
  return controller;
}

/** 预览 → 层行（给断言台与外部复用，避免各处再算一遍）。 */
export { layerRows, statusFromPreview };
export type { MountPreview };
