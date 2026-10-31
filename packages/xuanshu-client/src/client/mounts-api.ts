/**
 * packages/xuanshu-client/src/client/mounts-api.ts — 票 12 的数据面（契约 §2）。
 *
 * 两条来源分开，别混：
 *   - **挂载清单**：走宿主 RPC `consult.setMounts`（唯一新增的方法；`preview:true` 只算不写）。
 *     挂载的权威是票 10 旁挂清单里的 `mounts` 字段 —— 客户端**不另存一份**。
 *   - **工作区清单**：走 DSH **客户端**服务 `ctx.workspaces.list.getSnapshot()`（事实笔记 §5.3）
 *     —— 那是 DSH 原生的工作区行，我们只**读**（只读引用；S8 §2.1② 明说「不提供新建工作区入口」）。
 *     工作流清单的数据源属票 16（设计稿「待验证 3」未确认）：这里返回空 + 理由，不编造行。
 *
 * 客户端的 `WorkspaceView` 形状照 `dsh-api-workspace-controller/lib/types/types.d.ts` 抄：
 * `{ workspaceId, path, title, sessionIds, createdAt, updatedAt }`。
 * 我们把 `workspaceId` 当 `MountRef.id`（宿主用同一个 id 去 `workspaceRegistry.get()` 取 path）——
 * 若哪天两边不再是同一个值，宿主会给一层可读的「不在工作区清单里」错误，而不是读错内容。
 */

/** RPC 端点（`/xuanshu` 通道）。 */
export const MOUNTS_ENDPOINTS = { setMounts: 'consult.setMounts' } as const;

/** 挂载对象（票 10 冻结的形状）。 */
export interface MountRef {
  kind: 'workspace' | 'workflow';
  id: string;
  label: string;
}

/** 逐层账本（宿主 `clip.mjs` 的产物；界面按它打三档 Tag）。 */
export interface MountLayerPreview {
  id: string;
  kind: 'workspace' | 'workflow';
  label: string;
  head?: string;
  /** 该层读到的总字数（未裁剪前）。 */
  chars: number;
  /** 该层进入上下文的字数。 */
  keptChars: number;
  kept: boolean;
  clipped: boolean;
  dropped: boolean;
  reason?: string;
  error?: string;
  hint?: string;
  keptSegments: Array<{ label: string; chars: number }>;
  droppedSegments: Array<{ label: string; chars: number; reason: string }>;
}

/** 预览（契约 §2 的四项 + 逐层细节）。 */
export interface MountPreview {
  layers: MountLayerPreview[];
  totalChars: number;
  keptChars: number;
  budget: number | null;
  truncatedChars: number;
  keptLayers: number;
  totalLayers: number;
  notice: string;
  notes: string[];
  budgetSource?: 'config' | 'model-window' | 'unknown';
}

/** `consult.setMounts` 的应答：`preview` 缺席时与票 10 的 `{session}` 逐字相同。 */
export interface SetMountsAnswer {
  session: { sessionId: string; mounts: MountRef[] } & Record<string, unknown>;
  preview?: MountPreview;
}

/** 数据面。 */
export interface MountsApi {
  /** 写入挂载清单；`preview:true` 时**只算不写**。 */
  setMounts(payload: { sessionId: string; mounts: MountRef[]; preview?: boolean }): Promise<SetMountsAnswer>;
}

/** 工作区候选（DSH 原生工作区行的只读投影）。 */
export interface WorkspaceCandidate {
  id: string;
  path: string;
  title: string;
  sessionCount: number;
  updatedAt: string;
}

/** 最小 RPC 形状：与 `consult-api.ts` 同款，走 `rpcCall`（`/xuanshu` 通道，信封统一在这里拆）。 */
import { readService } from './ctx-service.js';
import { rpcCall, type RpcContext } from './rpc.js';

/** 建数据面。 */
export function createMountsApi(ctx: RpcContext): MountsApi {
  return {
    async setMounts(payload) {
      return rpcCall<SetMountsAnswer>(ctx, MOUNTS_ENDPOINTS.setMounts, payload);
    },
  };
}

/** 最小工作区面（客户端 `IWorkspaces.list`：`getSnapshot()` + `subscribe()`）。 */
interface WorkspacesFace {
  list?: {
    getSnapshot?: () => { items?: ReadonlyArray<Record<string, unknown>> };
    subscribe?: (listener: () => void) => () => void;
  };
}

/** 工作区清单的只读适配：把 DSH 的 `WorkspaceView` 投影成本票要的三四个字段。 */
export interface WorkspaceCatalog {
  list(): WorkspaceCandidate[];
  /** 变更订阅（拿不到就返回一个什么都不做的退订函数）。 */
  subscribe(listener: () => void): () => void;
  /** 客户端没有工作区面（裁剪过的 profile）：界面照实说明，不编工作区。 */
  available: boolean;
}

/**
 * 从客户端 ctx 建工作区清单。
 *
 * **只读**：只调 `getSnapshot()` / `subscribe()`，不碰 `create/rename/delete/insertSessionBefore`
 * （S8 §2.1②：不提供新建工作区入口，那种事去 DSH 原界面）。
 */
export function createWorkspaceCatalog(ctx: unknown): WorkspaceCatalog {
  const face = readService<WorkspacesFace>(ctx, 'workspaces');
  const source = face?.list;
  if (typeof source?.getSnapshot !== 'function') {
    return { list: () => [], subscribe: () => () => {}, available: false };
  }
  const project = (item: Record<string, unknown>): WorkspaceCandidate | undefined => {
    const id = typeof item.workspaceId === 'string' ? item.workspaceId : undefined;
    const path = typeof item.path === 'string' ? item.path : '';
    if (id === undefined) return undefined;
    const title = typeof item.title === 'string' && item.title !== '' ? item.title : path;
    return {
      id,
      path,
      title,
      sessionCount: Array.isArray(item.sessionIds) ? item.sessionIds.length : 0,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
    };
  };
  return {
    available: true,
    list() {
      let snapshot;
      try {
        snapshot = source.getSnapshot?.();
      } catch {
        return [];
      }
      const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
      return items.map(project).filter((row): row is WorkspaceCandidate => row !== undefined);
    },
    subscribe(listener) {
      try {
        return typeof source.subscribe === 'function' ? source.subscribe(listener) : () => {};
      } catch {
        return () => {};
      }
    },
  };
}
