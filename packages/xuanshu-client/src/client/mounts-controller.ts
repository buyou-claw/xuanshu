/**
 * packages/xuanshu-client/src/client/mounts-controller.ts — 票 12 的抽屉状态机（无 React）。
 *
 * 为什么单独一个文件：抽屉的开合 / 选择 / 折叠 / 预览缓存 / 确认写入全是**纯状态迁移**，
 * 单独成文件就能在 Node 里直接断言（不渲染组件），也与票 08/13 的 controller 同款。
 *
 * 三条不可动摇的纪律：
 *   1. **预览只算不写**：`refreshPreview()` 走 `setMounts({preview:true})`；只有 `confirm()` 才真写。
 *      于是「预览后清单字节不变」是这条状态机的性质，而不是调用点的自觉。
 *   2. **预览缓存按会话**：门厅的状态栏与抽屉共用同一份缓存 —— 两处数字不可能不一样。
 *   3. **失败不静默**：任何一步失败都落到 `error`（界面有 `data-xuanshu-error="mounts"` 错误条）。
 */
import type { MountPreview, MountRef, MountsApi, WorkspaceCandidate } from './mounts-api.js';
import { createLayerFoldState, isMounted, toggleMount, toMountRef, type LayerFoldState } from './mounts-model.js';

/** 抽屉快照（组件只读它）。 */
export interface MountsSnapshot {
  open: boolean;
  sessionId?: string;
  /** 这个会话**已经挂上**的清单（来自旁挂清单，权威）。 */
  mounts: MountRef[];
  /** 抽屉里**正在编辑**的选择（未确认前不改 `mounts`）。 */
  selection: MountRef[];
  preview?: MountPreview;
  busy: boolean;
  error?: string;
  workspaceAvailable: boolean;
  fold: LayerFoldState;
  /** 每次成功写入 +1（门厅据此重读会话）。 */
  revision: number;
}

/** 控制器面。 */
export interface MountsController {
  subscribe(listener: () => void): () => void;
  snapshot(): MountsSnapshot;
  /** 为某个会话打开抽屉（`mounts` = 当前已挂清单，作为初值）。 */
  open(sessionId: string, mounts: readonly MountRef[]): void;
  close(): void;
  /** 选入 / 移出本轮（动词不是「勾选」）。 */
  toggleWorkspace(candidate: WorkspaceCandidate): void;
  fold(layerId: string): void;
  /** 重新读一遍预览（只读）。 */
  refreshPreview(): Promise<void>;
  /** 确认挂载到本轮（**写入**）。 */
  confirm(): Promise<void>;
  /** 门厅用：若这个会话还没有缓存，拉一次预览（只读，不打开抽屉）。 */
  ensurePreview(sessionId: string, mounts: readonly MountRef[]): void;
  /** 门厅用：缓存里的预览（没有就 `undefined`）。 */
  cachedPreview(sessionId: string): MountPreview | undefined;
}

/** 默认快照。 */
function emptySnapshot(workspaceAvailable: boolean): MountsSnapshot {
  return {
    open: false,
    mounts: [],
    selection: [],
    busy: false,
    workspaceAvailable,
    fold: createLayerFoldState(),
    revision: 0,
  };
}

/** 键：挂载清单的指纹（用于判断缓存是否还对得上）。 */
function mountsFingerprint(mounts: readonly MountRef[]): string {
  return [...mounts].map((mount) => `${mount.kind}:${mount.id}`).sort().join('|');
}

/** 建控制器。 */
export function createMountsController(options: {
  api: MountsApi;
  workspaces: () => WorkspaceCandidate[];
  workspaceAvailable?: boolean;
}): MountsController {
  const listeners = new Set<() => void>();
  const fold = createLayerFoldState();
  const previews = new Map<string, { preview: MountPreview; fingerprint: string }>();
  let snapshot: MountsSnapshot = { ...emptySnapshot(options.workspaceAvailable ?? true), fold };

  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const set = (patch: Partial<MountsSnapshot>): void => {
    snapshot = { ...snapshot, ...patch };
    emit();
  };
  const fail = (error: unknown): void => {
    set({ busy: false, error: String((error as Error)?.message ?? error) });
  };

  /** 取一次预览（只读）。`silent` = 门厅的状态栏要的那次，不打开抽屉也不显示忙碌。 */
  async function load(sessionId: string, mounts: readonly MountRef[], silent = false): Promise<void> {
    if (!silent) set({ busy: true, error: undefined });
    try {
      const answer = await options.api.setMounts({ sessionId, mounts: [...mounts], preview: true });
      const preview = answer.preview;
      if (preview === undefined) {
        set({ busy: false, error: '宿主没有返回预览（setMounts 的 preview 字段缺失）：这次不显示账本，避免给出没依据的数字。' });
        return;
      }
      previews.set(sessionId, { preview, fingerprint: mountsFingerprint(mounts) });
      if (silent) set({});
      else set({ busy: false, preview, error: undefined });
    } catch (error) {
      if (silent) return; // 门厅的状态栏失败不弹错：用户没在做挂载这件事
      fail(error);
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => snapshot,
    open(sessionId, mounts) {
      const fingerprint = mountsFingerprint(mounts);
      const cached = previews.get(sessionId);
      set({
        open: true,
        sessionId,
        mounts: [...mounts],
        selection: [...mounts],
        error: undefined,
        preview: cached !== undefined && cached.fingerprint === fingerprint ? cached.preview : undefined,
      });
      void load(sessionId, mounts);
    },
    close() {
      set({ open: false, busy: false, error: undefined });
    },
    toggleWorkspace(candidate) {
      const mount = toMountRef(candidate);
      const selection = toggleMount(snapshot.selection, mount);
      set({ selection, error: undefined });
      if (snapshot.sessionId !== undefined) void load(snapshot.sessionId, selection);
    },
    fold(layerId) {
      fold.toggle(layerId);
      set({});
    },
    async refreshPreview() {
      if (snapshot.sessionId === undefined) return;
      await load(snapshot.sessionId, snapshot.selection);
    },
    async confirm() {
      const sessionId = snapshot.sessionId;
      if (sessionId === undefined) return;
      set({ busy: true, error: undefined });
      try {
        const answer = await options.api.setMounts({ sessionId, mounts: [...snapshot.selection] });
        const mounts = Array.isArray(answer.session?.mounts) ? answer.session.mounts : snapshot.selection;
        set({ busy: false, open: false, mounts, selection: mounts, revision: snapshot.revision + 1, error: undefined });
        // 写入之后再读一次预览：状态栏的数字要与「确认后的清单」一致，而不是与编辑中的选择一致。
        await load(sessionId, mounts, true);
      } catch (error) {
        fail(error);
      }
    },
    ensurePreview(sessionId, mounts) {
      if (mounts.length === 0) return;
      const cached = previews.get(sessionId);
      if (cached !== undefined && cached.fingerprint === mountsFingerprint(mounts)) return;
      void load(sessionId, mounts, true);
    },
    cachedPreview(sessionId) {
      return previews.get(sessionId)?.preview;
    },
  };
}

/** 已挂 / 选中判据（给视图与断言台复用）。 */
export { isMounted };
