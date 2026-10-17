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
import type { ShijiEntry } from './shiji-api.js';

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
  /** 来源路数（谱 / 工作区 / 工作流 / 事记里有内容的几路）。 */
  sources?: number;
  bySource?: { pu?: number; workspace?: number; workflow?: number; shiji?: number };
  digest?: 'llm' | 'skeleton';
  /**
   * #27 的加性字段：两段各多少段（`{recent, past}`）。
   * 客户端用它识别「这份 md 是两段结构」；老文件没有它，按三章形态渲染。
   */
  sections?: { recent?: number; past?: number };
}

/**
 * `digao.read|status` 的**加性**事记读面（#27 契约 §3）：UI 的 [删除] 要 id。
 *
 * 为什么由底稿的读面带：正文里有事记条目（人读标记），但**没有 id**；而删除动作需要 id。
 * 这份读面与正文「曾经做过什么」同源（同一个 `listShiji()`），不是第二个渲染权威。
 * **没有事记账本时整个键缺席**（拿不到就省略，不写 null）。
 */
export interface DigaoShijiRead {
  entries: ShijiEntry[];
}

/** `digao.status`：`{ exists, meta: DigaoMeta|null, shiji?, schedule? }`（契约 §2 + 两处加性扩容）。 */
export interface DigaoStatus {
  exists: boolean;
  meta: DigaoMeta | null;
  /** 底稿 daily 任务的计划时刻（**可选**：宿主不回传时省略键，界面不编一个时刻）。 */
  schedule?: DigaoSchedule;
  /** 事记条目（**可选**：还没有事记账本时省略键）。 */
  shiji?: DigaoShijiRead;
  reason?: string;
}

/** `digao.read`：正文 + 元数据（正文是派生物，界面只是它的视图）。 */
export interface DigaoRead {
  markdown: string;
  meta: DigaoMeta | null;
  schedule?: DigaoSchedule;
  shiji?: DigaoShijiRead;
}

/** 底稿 daily 任务的计划时刻投影（只读展示用；改它去 DSH 的「自动化任务」面板）。 */
export interface DigaoSchedule {
  time: string;
  timeZone: string;
  id?: string;
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
