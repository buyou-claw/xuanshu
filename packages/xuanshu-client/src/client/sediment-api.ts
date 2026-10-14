/**
 * 票 15 · 沉淀数据面（`/xuanshu` 通道上 `sediment.*` 三个方法的客户端面；冻结契约 §3）。
 *
 * 为什么单独立一层（同 `consult-api.ts` / `digao-api.ts` 的理由）：方法名与请求/响应形状是
 * **两个实现者共享的接口面** —— 写在一处，方法名就等于契约表格那一列，
 * 断言台可以逐字比对（`tests/assembly/sediment-api.test.mjs`）。
 *
 * 本票在数据面上的**唯一硬约束**：`commit` 的 `confirmed` 由这里写死成 `true`，
 * 不是调用方传进来的开关。于是「AI 静默写谱」在这条数据面上**没有入口** ——
 * 宿主侧还会再拦一次（`confirmed !== true` 一律拒收），两层各自独立成立。
 */
import { rpcCall } from './rpc.js';
import type { RpcContext } from './rpc.js';

/** 目标谱（契约 §3 的 `target`）：沉淀只能写进谱，工作区 / 工作流不是谱。 */
export interface SedimentTarget {
  slug: string;
  name: string;
}

/** 草稿正文三件（与票 09 谱规范 v1 的字段同名：description / body / summary）。 */
export interface SedimentDraft {
  description: string;
  body: string;
  summary: string;
}

/** `sediment.draft` 的返回（契约 §3）：草稿 + 它建议的目标谱。 */
export interface SedimentDraftAnswer {
  draftId: string;
  target: SedimentTarget;
  draft: SedimentDraft;
}

/**
 * 谱的读面（`pu.read` 的既有返回里本票用到的那几项）。
 * 确认弹窗靠它算 diff / 字数 / 陈旧判定 —— 不新开读方法，谱的读面仍只有一处。
 */
export interface SedimentPuView {
  slug: string;
  name: string;
  level?: string;
  description?: string;
  body: string;
  summary?: string;
  source?: string;
  updatedAt: string;
}

/** `sediment.commit` 的返回（契约 §3）：写回之后的谱。 */
export interface SedimentCommitAnswer {
  pu: SedimentPuView;
}

/** 目标谱选择器的一项（`pu.list` 的既有返回里本票用到的那几项）。 */
export interface SedimentTargetOption {
  slug: string;
  name: string;
  level?: string;
  summary?: string;
}

/** `sediment.*` 的方法名（逐字对齐契约 §3；改这里等于改接口面）。 */
export const SEDIMENT_ENDPOINTS = {
  draft: 'sediment.draft',
  commit: 'sediment.commit',
  discard: 'sediment.discard',
} as const;

/** 沉淀数据面的形状（入口条、草稿卡、确认弹窗共用一份）。 */
export interface SedimentApi {
  /**
   * 导出汇总：让**这一场问事会话**产出草稿并暂存（宿主侧）。
   * 这一步会真的等一轮对话结束，可能持续数十秒；`signal` 可取消（取消时草稿不落盘）。
   */
  draft(payload: { sessionId: string; targetSlug?: string }, signal?: AbortSignal): Promise<SedimentDraftAnswer>;
  /** **人点确认**之后才调它：写回目标谱。`confirmed` 由本层写死，调用方给不了。 */
  commit(payload: { draftId: string; draft?: SedimentDraft }, signal?: AbortSignal): Promise<SedimentCommitAnswer>;
  /** 丢弃草稿（正当路径，只删草稿文件）。 */
  discard(payload: { draftId: string }, signal?: AbortSignal): Promise<{ ok: true }>;
  /** 目标谱的当前态（`pu.read`，只读）：确认弹窗的 diff / 字数 / 陈旧判定都从它来。 */
  readTarget(slug: string, signal?: AbortSignal): Promise<SedimentPuView>;
  /**
   * 可选目标谱列表（`pu.list`，只读）：入口的「目标谱（必选）」用它。
   * **只有谱**：`pu.list()` 本来就不含底座与保留目录，工作区 / 工作流不在这份数据里。
   */
  listTargets(signal?: AbortSignal): Promise<SedimentTargetOption[]>;
}

/**
 * 用连接上下文造一个沉淀数据面。
 * @param ctx - 需要 `connection.rpc`（`dsh-client-connection` 提供）。
 * @returns 四个方法：三个 `sediment.*` + 一个只读的谱读面。
 */
export function createSedimentApi(ctx: RpcContext): SedimentApi {
  return {
    draft: (payload, signal) => rpcCall<SedimentDraftAnswer>(ctx, SEDIMENT_ENDPOINTS.draft, payload, signal),
    // `confirmed` 在这里写死成字面量 `true`：确认是人在弹窗里点的那一次，不是一个可传参的开关。
    commit: (payload, signal) => rpcCall<SedimentCommitAnswer>(ctx, SEDIMENT_ENDPOINTS.commit, { ...payload, confirmed: true }, signal),
    discard: (payload, signal) => rpcCall<{ ok: true }>(ctx, SEDIMENT_ENDPOINTS.discard, payload, signal),
    readTarget: (slug, signal) => rpcCall<SedimentPuView>(ctx, 'pu.read', { slug }, signal),
    // 读面仍是既有方法（`pu.list`）：本票不新开端点，只把「可选目标谱」这件事收在一处。
    listTargets: async (signal) => {
      const rows = await rpcCall<SedimentTargetOption[]>(ctx, 'pu.list', {}, signal);
      return rows.filter((row) => row !== null && typeof row === 'object' && typeof row.slug === 'string');
    },
  };
}
