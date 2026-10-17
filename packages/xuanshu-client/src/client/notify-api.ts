/**
 * #24 · 触达数据面（`traffic.*` 的客户端面；冻结契约 §4）。
 *
 * 三个用途：
 *   - 卡 / 面板上的**未读与失败原因**（`status()` / `markDeliveredRead()`）；
 *   - 打开日课面板时把 delivered 的条目标已读（`markDeliveredRead()`，只读一遍账、只写必要的那次）；
 *   - 设置行的**通知摘要开关**（`getSettings()` / `setSettings()`）。
 *
 * 「人点才跑」在这里同样成立：造 api 不发请求；`markDeliveredRead()` 是打开面板的副作​用（只标已读，
 * 不生成任何东西）；`setSettings` 只由开关的 onChange 调用。
 */
import { rpcCall } from './rpc.js';
import type { RpcContext } from './rpc.js';

/** 账里的一行（只声明界面用得到的字段）。 */
export interface TrafficEntry {
  id: string;
  at?: string;
  kind?: string;
  date?: string;
  notify: { status: 'delivered' | 'failed' | 'skipped'; reason?: string | null };
  read?: boolean;
}

/** `traffic.status` 的回答（`lastFailure` 只在账里真有 failed 时出现）。 */
export interface TrafficStatus {
  entries: TrafficEntry[];
  unread: number;
  lastFailure?: { at: string; kind: string; reason: string | null };
}

/** 共享设置里与通知有关的那一项（`shell-settings.json`）。 */
export interface NotifySettings {
  notifySummary: boolean;
}

/** `traffic.*` 的方法名（逐字对齐契约 §4；改这里等于改接口面）。 */
export const NOTIFY_ENDPOINTS = {
  trafficStatus: 'traffic.status',
  markRead: 'traffic.markRead',
  settingsGet: 'traffic.settings.get',
  settingsSet: 'traffic.settings.set',
} as const;

/** 触达数据面（日课卡 / 日课面板 / 设置行共用一份）。 */
export interface NotifyApi {
  /** 账本读面（最新在前；`limit` 只截 entries）。 */
  status(payload?: { limit?: number }, signal?: AbortSignal): Promise<TrafficStatus>;
  /** 标已读（只改 `read`）。 */
  markRead(payload: { ids: string[] }, signal?: AbortSignal): Promise<{ ok: boolean; updated: number }>;
  /**
   * 打开面板时调：把 delivered 且未读的条目标已读。
   * 没有未读就不发第二次请求（不做无意义的写盘）。
   */
  markDeliveredRead(signal?: AbortSignal): Promise<{ ok: boolean; updated: number }>;
  /** 通知摘要开关（写着 `shell-settings.json`，壳也读同一份）。 */
  getSettings(signal?: AbortSignal): Promise<NotifySettings>;
  setSettings(payload: { notifySummary?: boolean }, signal?: AbortSignal): Promise<NotifySettings>;
}

/**
 * 用连接上下文造一个触达数据面。
 * @param ctx - 需要 `connection.rpc`。
 * @returns 五个方法都指向 `traffic.*` 的客户端面。
 */
export function createNotifyApi(ctx: RpcContext): NotifyApi {
  return {
    status: (payload, signal) => rpcCall<TrafficStatus>(ctx, NOTIFY_ENDPOINTS.trafficStatus, payload ?? {}, signal),
    markRead: (payload, signal) => rpcCall<{ ok: boolean; updated: number }>(ctx, NOTIFY_ENDPOINTS.markRead, payload, signal),
    async markDeliveredRead(signal) {
      const ledger = await rpcCall<TrafficStatus>(ctx, NOTIFY_ENDPOINTS.trafficStatus, {}, signal);
      // 只有「推到了但没看」的才算未读：failed / skipped 不该因为打开面板就被抹掉。
      const ids = (Array.isArray(ledger?.entries) ? ledger.entries : [])
        .filter((entry) => entry?.notify?.status === 'delivered' && entry.read !== true)
        .map((entry) => entry.id);
      if (ids.length === 0) return { ok: true, updated: 0 };
      return rpcCall<{ ok: boolean; updated: number }>(ctx, NOTIFY_ENDPOINTS.markRead, { ids }, signal);
    },
    getSettings: (signal) => rpcCall<NotifySettings>(ctx, NOTIFY_ENDPOINTS.settingsGet, {}, signal),
    setSettings: (payload, signal) => rpcCall<NotifySettings>(ctx, NOTIFY_ENDPOINTS.settingsSet, payload, signal),
  };
}
