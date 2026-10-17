/**
 * 票 11 · 合参数据面（`/xuanshu` 通道上 `bestof.*` 的客户端面；冻结契约 §1）。
 *
 * 与 `consult-api.ts` / `digao-api.ts` 同款理由：方法名与请求/响应形状是**两个实现者共享的接口面**
 * ——写在一处，方法名就等于契约表格那一列，断言台可以逐字比对。
 *
 * `cancel` 是契约 §1 的 **additive** 方法（Lead 2026-10-15 批准）：S9 的「停止全部」要真的停得住，
 * 一个按下去其实停不住的停止按钮比没有这个按钮更坏。宿主没有这个方法时（老版本），
 * 调用方按「未知玄枢操作」降级成本地停止并**如实显示「后台仍会跑完」**（见 `bestof-model.ts`）。
 */
import { rpcCall } from './rpc.js';
import type { RpcContext } from './rpc.js';

/** 一路候选。`status` 四态：`running` 生成中 / `done` 有正文 / `error` 失败 / `stopped` 被人停下。 */
export interface BestofCandidate {
  id: string;
  /** 视角 id（`classic` / `cautious`），合并稿是 `merged`。 */
  angle: string;
  /** 视角人读名（经典派 / 审慎派 / 合并稿）。 */
  angleName?: string;
  provider: string;
  model: string;
  status: 'running' | 'done' | 'error' | 'stopped';
  text: string;
  error?: string;
  /** 打桩语境下可能缺席；**没有价表时 `costUsd` 缺席**（界面显示「费用未知」）。 */
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  elapsedMs?: number;
  costUsd?: number;
}

/**
 * 判官结论。`mode` 记的是**这次判定是怎么来的**：
 * `tool` 工具调用 / `prompt-json` 提示词 JSON 降级 / `skipped` 没跑（只有一份候选或被人停下）/
 * `failed` 整次执行失败 / `pending` 还在跑。
 */
export interface BestofJudge {
  mode: 'pending' | 'tool' | 'prompt-json' | 'skipped' | 'failed';
  /** **判官眼里**排第一的那一份；采用与否仍由人点（C9）。 */
  adoptedId: string | null;
  ranking: string[];
  reasons?: Record<string, string>;
  error?: string;
  skipped?: boolean;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  provider?: string;
  model?: string;
}

/** `bestof.run` / `bestof.state` 的响应（契约 §1 的 `{runId, candidates, judge}` + 界面要用的采用态与费用）。 */
export interface BestofView {
  runId: string;
  sessionId: string;
  question: string;
  candidates: BestofCandidate[];
  judge: BestofJudge;
  /** **人**采用了哪一份（`merged` = 合并稿）；`null` = 还没拍板或被否决。 */
  adoptedId: string | null;
  rejected: boolean;
  finished: boolean;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  /** 没有价表时**整个键缺席** —— 界面据此显示「费用未知」，不许写成 0。 */
  costUsd?: number;
  costUsdComplete?: boolean;
  mergedBy?: { by: 'host' | 'caller'; at: string };
  /** 采用稿写进会话的时刻（**只在真有投递时出现**；冷读 `bestof.state` 也带它）。 */
  deliveredAt?: string;
  /** 投递失败时由宿主带在视图里（成功时不带）—— 刷新/冷读之后界面说同一句话。 */
  delivery?: BestofDelivery;
}

/**
 * 「采用稿到底有没有写进会话」的回执（task-14 宿主新增的加性字段；task-15 接到界面上）。
 *
 * `ok === false` 时**必须**逐字把 `error` 显示出来：界面说「历史只带这一份采用稿」而实际没写进去，
 * 就是说了一句没发生的事 —— 与「缺经纬度不许出盘」「没有价表不许写 0」是同一条硬线。
 * 字段**缺席** = 老宿主（没有投递面）→ 按成功态渲染。
 */
export interface BestofDelivery {
  ok: boolean;
  candidateId?: string;
  messageId?: string;
  /** 投递用的 source kind（`xuanshu-bestof-adopted`）。 */
  source?: string;
  at?: string;
  /** 失败原因原文（`ok === false` 时必有）。 */
  error?: string;
  attemptedAt?: string;
}

/** `bestof.adopt` 的响应（契约 §1 的 `{bestOf}` + 加性的 `delivery`）。 */
export interface BestofAdoptResult {
  bestOf: BestofView;
  delivery?: BestofDelivery;
}

/** `bestof.*` 的方法名（逐字对齐契约 §1；改这里等于改接口面）。 */
export const BESTOF_ENDPOINTS = {
  run: 'bestof.run',
  state: 'bestof.state',
  adopt: 'bestof.adopt',
  cancel: 'bestof.cancel',
} as const;

export type BestofDecision = 'adopt' | 'merge' | 'reject';

/** 合参数据面的形状（浮层与设置行共用一份）。 */
export interface BestofApi {
  /** 开一次合参：**受理即回**（候选先是 `running`），之后按 `state` 轮询。 */
  run(payload: { sessionId: string; question: string; angles?: string[]; profileIds?: string[] }, signal?: AbortSignal): Promise<BestofView>;
  /** 轮询 / 回看（进程重启后也能按 runId 读回来）。 */
  state(payload: { runId: string }, signal?: AbortSignal): Promise<BestofView>;
  /** 拍板：三个动作都要人点（C9）；`delivery` 是「采用稿有没有写进会话」的回执。 */
  adopt(payload: { runId: string; decision: BestofDecision; adoptedId?: string; mergedText?: string }, signal?: AbortSignal): Promise<BestofAdoptResult>;
  /** 「停止全部」：真的 abort 那 N 路流；已产出的正文保留。 */
  cancel(payload: { runId: string }, signal?: AbortSignal): Promise<{ bestOf: BestofView }>;
}

/**
 * 用连接上下文造一个合参数据面。
 * @param ctx - 需要 `connection.rpc`（`dsh-client-connection` 提供）。
 */
export function createBestofApi(ctx: RpcContext): BestofApi {
  return {
    run: (payload, signal) => rpcCall<BestofView>(ctx, BESTOF_ENDPOINTS.run, payload, signal),
    state: (payload, signal) => rpcCall<BestofView>(ctx, BESTOF_ENDPOINTS.state, payload, signal),
    adopt: (payload, signal) => rpcCall<BestofAdoptResult>(ctx, BESTOF_ENDPOINTS.adopt, payload, signal),
    cancel: (payload, signal) => rpcCall<{ bestOf: BestofView }>(ctx, BESTOF_ENDPOINTS.cancel, payload, signal),
  };
}
