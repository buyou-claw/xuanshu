/**
 * #25 · 晚省数据面（`/xuanshu` 通道上 `wansheng.*` 四个方法的客户端面；冻结契约 §1/§4）。
 *
 *   - `wansheng.status`  → `{date, exists}` + ready 时 `facts` / `generatedAt` / `zone` / `missed`
 *     + `schedule?` + `unread?` / `notify?`（加性读面；拿不到就省略键）；
 *   - `wansheng.read`    → `{date, exists, record?}` / `reason?`；
 *   - `wansheng.generate`→ `{ok, date, record?, reason?}`（**人点才调**）；
 *   - `wansheng.setTime` → `{schedule:{time,timeZone}}`（人点才调；宿主走 `ctx.schedule.update`）。
 *
 * 可选字段一律容忍：缺 `facts` / `generatedAt` / `schedule` 时界面显示「未知 / 未回传」，
 * **不自己编一个值**（与 `rikke-api.ts` 同一条纪律）。
 */
import { rpcCall } from './rpc.js';
import type { RpcContext } from './rpc.js';
import type { RikkeNotify, RikkeSchedule } from './rikke-api.js';

/** 一场今天开过 / 今天还在问的问事（会话级事实，不做逐轮统计）。 */
export interface WanshengConsultItem {
  sessionId: string;
  title: string;
  lastTurnAt?: string;
}

/** 当天问事场次（`count` 是全量，`items` 是清单，上限由宿主定）。 */
export interface WanshengConsultSessions {
  count: number;
  items: WanshengConsultItem[];
}

/** 今天有活动的一个项目（工作区）。 */
export interface WanshengWorkspace {
  id: string;
  title: string;
  sessionCount: number;
  lastActiveAt?: string;
}

/**
 * 晚省的确定性事实（宿主 `wansheng/facts.mjs` 产出）。
 * **拿不到的键整键不出现**：界面写「未知」，而不是把它当成 0 / false。
 */
export interface WanshengFacts {
  consultSessions?: WanshengConsultSessions;
  activeWorkspaces?: WanshengWorkspace[];
  /** 今天有活动的工作流；与工作区并列，缺席表示未知。 */
  activeWorkflows?: WanshengWorkspace[];
  digao?: { generatedAt?: string };
  rikke?: { generatedAt?: string };
  shiji?: { updatedAt?: string };
}

/** `wansheng.status`：今天有没有晚省 + 当天事实 + 计划时刻 + 触达状态。 */
export interface WanshengStatus {
  date: string;
  exists: boolean;
  facts?: WanshengFacts;
  generatedAt?: string;
  zone?: string;
  /** 这一份是不是**补生成**的（界面标「补」；不冒充今天）。 */
  missed?: boolean;
  schedule?: RikkeSchedule;
  /** 未读条数（只数晚省的账行；账本拿不到 → 省略键）。 */
  unread?: number;
  /** 最近一次晚省触达（拿不到 → 省略键）。 */
  notify?: RikkeNotify;
  reason?: string;
}

/** `wansheng.read`：某天的完整记录（界面要显示事实时用）。 */
export interface WanshengReadResult {
  date: string;
  exists: boolean;
  record?: {
    schema: string;
    date: string;
    generatedAt?: string;
    zone?: string;
    missed?: boolean;
    facts?: WanshengFacts;
    notes?: string[];
  };
  reason?: string;
}

/** `wansheng.generate` 的回答。 */
export interface WanshengGenerateResult {
  ok: boolean;
  date?: string;
  record?: WanshengReadResult['record'];
  reason?: string;
}

/** `wansheng.setTime` 的回答。 */
export interface WanshengSetTimeResult {
  schedule: { time: string; timeZone: string };
}

/** `wansheng.*` 的方法名（逐字对齐契约 §1；改这里等于改接口面）。 */
export const WANSHENG_ENDPOINTS = {
  status: 'wansheng.status',
  read: 'wansheng.read',
  generate: 'wansheng.generate',
  setTime: 'wansheng.setTime',
} as const;

/** 晚省数据面（晚省卡与晚省面板共用一份）。 */
export interface WanshengApi {
  /** 今天（或指定日期）的晚省状态；`date` 省缺 = 宿主按本机时钟取今天。 */
  status(payload?: { date?: string }, signal?: AbortSignal): Promise<WanshengStatus>;
  /** 读某天的完整记录（缺省今天）。 */
  read(payload?: { date?: string }, signal?: AbortSignal): Promise<WanshengReadResult>;
  /** **人点才调**：生成（或重新生成）某天的晚省（确定性事实，不调模型）。 */
  generate(payload?: { date?: string; manual?: boolean }, signal?: AbortSignal): Promise<WanshengGenerateResult>;
  /** **人点才调**：改晚省的时刻（`HH:mm`）。 */
  setTime(payload: { time: string }, signal?: AbortSignal): Promise<WanshengSetTimeResult>;
}

/**
 * 用连接上下文造一个晚省数据面。
 * @param ctx - 需要 `connection.rpc`（`dsh-client-connection` 提供）。
 * @returns 四个方法都指向 `wansheng.*` 的客户端面。
 */
export function createWanshengApi(ctx: RpcContext): WanshengApi {
  return {
    status: (payload, signal) => rpcCall<WanshengStatus>(ctx, WANSHENG_ENDPOINTS.status, payload ?? {}, signal),
    read: (payload, signal) => rpcCall<WanshengReadResult>(ctx, WANSHENG_ENDPOINTS.read, payload ?? {}, signal),
    generate: (payload, signal) => rpcCall<WanshengGenerateResult>(ctx, WANSHENG_ENDPOINTS.generate, payload ?? {}, signal),
    setTime: (payload, signal) => rpcCall<WanshengSetTimeResult>(ctx, WANSHENG_ENDPOINTS.setTime, payload, signal),
  };
}
