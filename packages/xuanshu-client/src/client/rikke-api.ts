/**
 * 票 13 · 日课数据面（`/xuanshu` 通道上 `rikke.*` 三个方法的客户端面；冻结契约 §2）。
 *
 * 契约 §2（Lead 2026-10-15 批准的两处纯加性扩容已并入）：
 *   - `rikke.status`  → `{ date, exists, content?, generatedAt?, zone?, huangli?, schedule? }`
 *   - `rikke.generate`→ `{ ok, date, content?, reason? }`
 *   - `rikke.setTime` → `{ schedule: { time, timeZone } }`（宿主走 `ctx.schedule.update` 的
 *     compare-and-update，回传完整 observed record；客户端只提交 `HH:mm`）
 *
 * **可选字段一律容忍**：`generatedAt` / `zone` / `huangli` / `schedule` 缺失时省略键
 * （不是回 `null`/空串），界面因此显示「未回传」而不是一个编出来的时刻。
 * 「计划时刻」（`schedule.time`）与「生成时刻」（`generatedAt`）是**两个值**，界面分开显示。
 */
import { rpcCall } from './rpc.js';
import type { RpcContext } from './rpc.js';

/** 当日卡内容三键（与票 07 的 `XsRikkeCard` ready 结构逐字对齐）。 */
export interface RikkeContent {
  yi: string;
  ji: string;
  liuri: string;
}

/** 日课任务的定时记录投影（只读展示用；改时刻走 `rikke.setTime`）。 */
export interface RikkeSchedule {
  time: string;
  timeZone: string;
  id?: string;
}

/** 黄历引擎口径出处（只点到「工具名 + 版本」，不把整个信封塞进界面）。 */
export interface RikkeHuangli {
  ok?: boolean;
  version?: string;
  tool?: string;
}

/**
 * #24 · 日课 AI 段的三态（`ai-note.mjs` 写进产物、`rikke.status` 原样回传）。
 *
 * 三态**必须分得开**：`off` = 人在设置里关掉了（不是故障）；`failed` = 试过但没成（理由可读）；
 * `ok` = 有一段话。界面文案因此也不同（见 `rikke-model.ts` 的 `rikkeAiView`）。
 */
export interface RikkeAiNote {
  mode: 'ok' | 'off' | 'failed';
  text?: string;
  reason?: string;
}

/** #24 · 最近一次触达的投影（来自 `traffic.jsonl` 的最新一行；`reason` 只在失败时出现）。 */
export interface RikkeNotify {
  status: 'delivered' | 'failed' | 'skipped';
  at?: string;
  reason?: string;
}

/** #24 · AI 段开关（`rikke-settings.json`）。 */
export interface RikkeSettings {
  aiEnabled: boolean;
}

/** `rikke.status`：今天的日课在不在 + 内容 + 时间基准 + 计划时刻。 */
export interface RikkeStatus {
  date: string;
  exists: boolean;
  content?: RikkeContent;
  /** 生成时刻（宿主从当日 json 里回传；缺 = 未回传，界面不许编）。 */
  generatedAt?: string;
  /** 生成时用的 IANA 时区。 */
  zone?: string;
  huangli?: RikkeHuangli;
  schedule?: RikkeSchedule;
  /** #24：AI 段三态（旧产物没有这个键 → 省略，界面不编一段话）。 */
  ai?: RikkeAiNote;
  /** #24：未读条数（**只数 `kind=rikke`** 的 `delivered && !read`；账本拿不到 → 省略键，不写 0 冒充已读）。 */
  unread?: number;
  /** #24：最近一次**日课**触达（晚省那一条不混进来；拿不到 → 省略键）。 */
  notify?: RikkeNotify;
  reason?: string;
}

/** `rikke.generate`：人点 `[立即生成]` / `[重新生成（今天）]` 的回答。 */
export interface RikkeGenerateResult {
  ok: boolean;
  date?: string;
  content?: RikkeContent;
  /** 失败理由（契约 §2：底座未立时必须给可读理由，不许静默）。 */
  reason?: string;
}

/** `rikke.setTime`：改的是**播种出去的那条任务**（不是当日卡）。 */
export interface RikkeSetTimeResult {
  schedule: { time: string; timeZone: string };
}

/** `rikke.*` 的方法名（逐字对齐契约 §2；改这里等于改接口面）。 */
export const RIKKE_ENDPOINTS = {
  status: 'rikke.status',
  generate: 'rikke.generate',
  setTime: 'rikke.setTime',
  settingsGet: 'rikke.settings.get',
  settingsSet: 'rikke.settings.set',
} as const;

/** 日课数据面的形状（日课卡与日课面板共用一份）。 */
export interface RikkeApi {
  /** 今天（或指定日期）的日课状态；`date` 省缺 = 宿主按本机时钟取今天。 */
  status(payload?: { date?: string }, signal?: AbortSignal): Promise<RikkeStatus>;
  /** **人点才调**：生成当日日课（宿主半读底座 + 调 horosa 黄历，不联网）。 */
  generate(payload?: { date?: string }, signal?: AbortSignal): Promise<RikkeGenerateResult>;
  /** **人点才调**：改日课任务的时刻（`HH:mm`）。 */
  setTime(payload: { time: string }, signal?: AbortSignal): Promise<RikkeSetTimeResult>;
  /** #24：读 AI 段开关（缺失 = 默认开，由宿主决定）。 */
  getSettings(signal?: AbortSignal): Promise<RikkeSettings>;
  /** #24：**人点才调**：改 AI 段开关（只影响下一次生成；今天已写好的产物不就地改写）。 */
  setSettings(payload: { aiEnabled?: boolean }, signal?: AbortSignal): Promise<RikkeSettings>;
}

/**
 * 用连接上下文造一个日课数据面。
 * @param ctx - 需要 `connection.rpc`（`dsh-client-connection` 提供）。
 * @returns 五个方法都指向 `rikke.*` 的客户端面。
 */
export function createRikkeApi(ctx: RpcContext): RikkeApi {
  return {
    status: (payload, signal) => rpcCall<RikkeStatus>(ctx, RIKKE_ENDPOINTS.status, payload ?? {}, signal),
    generate: (payload, signal) => rpcCall<RikkeGenerateResult>(ctx, RIKKE_ENDPOINTS.generate, payload ?? {}, signal),
    setTime: (payload, signal) => rpcCall<RikkeSetTimeResult>(ctx, RIKKE_ENDPOINTS.setTime, payload, signal),
    getSettings: (signal) => rpcCall<RikkeSettings>(ctx, RIKKE_ENDPOINTS.settingsGet, {}, signal),
    setSettings: (payload, signal) => rpcCall<RikkeSettings>(ctx, RIKKE_ENDPOINTS.settingsSet, payload, signal),
  };
}
