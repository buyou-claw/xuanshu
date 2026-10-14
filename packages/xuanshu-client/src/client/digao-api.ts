/**
 * 票 13 · 底稿数据面（`/xuanshu` 通道上 `digao.*` 三个方法的客户端面；冻结契约 §2）。
 *
 * 为什么单独立一层（同 `bazi-api.ts` 的理由）：方法名与请求/响应形状是**两个实现者共享的接口面**
 * ——写在一处，方法名就等于契约表格那一列，断言台可以逐字比对。
 *
 * **刻意没有写方法**：契约 §1 定死「底稿不可手改」，没有 `digao.write` / `digao.update`；
 * 要改就改源头（谱 / 工作区 / 工作流），再点 `[刷新]` 重算派生文件。
 */
import { rpcCall } from './rpc.js';
import type { RpcContext } from './rpc.js';

/**
 * `digao.json` 的元数据（契约 §1 的 `xuanshu/digao@1`；缺项一律可选，读不到就不假装有）。
 *
 * `digest` 是**必须如实展示**的一位：`'skeleton'` = LLM 不可用/失败时降级成的规则骨架，
 * 界面不许把骨架说成提炼稿。
 */
export interface DigaoMeta {
  schema?: string;
  generatedAt?: string;
  /** 段数（契约的骨架规则算出；界面直接展示，不自算）。 */
  segments?: number;
  /** 来源路数（谱 / 工作区 / 工作流里有内容的几路）。 */
  sources?: number;
  bySource?: { pu?: number; workspace?: number; workflow?: number };
  digest?: 'llm' | 'skeleton';
}

/** `digao.status`：`{ exists, meta: DigaoMeta|null }`。 */
export interface DigaoStatus {
  exists: boolean;
  meta: DigaoMeta | null;
  reason?: string;
}

/** `digao.read`：正文 + 元数据（正文是派生物，界面只是它的视图）。 */
export interface DigaoRead {
  markdown: string;
  meta: DigaoMeta | null;
}

/** `digao.refresh`：重算后的元数据（正文用 `digao.read` 再读一次）。 */
export interface DigaoRefresh {
  meta: DigaoMeta | null;
}

/** `digao.*` 的方法名（逐字对齐契约 §2；改这里等于改接口面）。 */
export const DIGAO_ENDPOINTS = {
  status: 'digao.status',
  read: 'digao.read',
  refresh: 'digao.refresh',
} as const;

/** 底稿数据面的形状（概览底稿卡与底稿面板共用一份）。 */
export interface DigaoApi {
  /** 底稿是否存在 + 元数据（卡级三态的判据）。 */
  status(signal?: AbortSignal): Promise<DigaoStatus>;
  /** 只读正文（客户端只解析、不改写）。 */
  read(signal?: AbortSignal): Promise<DigaoRead>;
  /** 人点 `[刷新]` 才走它：重算派生文件（原子替换由宿主半负责）。 */
  refresh(signal?: AbortSignal): Promise<DigaoRefresh>;
}

/**
 * 用连接上下文造一个底稿数据面。
 * @param ctx - 需要 `connection.rpc`（`dsh-client-connection` 提供）。
 * @returns 三个方法都指向 `digao.*` 的客户端面。
 */
export function createDigaoApi(ctx: RpcContext): DigaoApi {
  return {
    status: (signal) => rpcCall<DigaoStatus>(ctx, DIGAO_ENDPOINTS.status, {}, signal),
    read: (signal) => rpcCall<DigaoRead>(ctx, DIGAO_ENDPOINTS.read, {}, signal),
    refresh: (signal) => rpcCall<DigaoRefresh>(ctx, DIGAO_ENDPOINTS.refresh, {}, signal),
  };
}
