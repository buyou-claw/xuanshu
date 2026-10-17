/**
 * 票 27（#27）· 事记的数据面（`/xuanshu` 通道上 `shiji.*`；宿主侧见 `lib/shiji/service.mjs`）。
 *
 * 为什么单独立一层（同 `digao-api.ts` / `bazi-api.ts` 的理由）：方法名与请求/响应形状是
 * **两个实现者共享的接口面**，写在一处才能逐字比对宿主那一份（`tests/assembly/shiji-entry.test.mjs`）。
 *
 * 三条纪律（都来自冻结契约 §1/§2）：
 *   1. **底稿没有写方法，写入口只在事记**：`remove`（删除 = 墓碑）、`restore`（清墓碑）与
 *      `fromSession`（人点「存成今天的事记」）是仅有的三个写动作；可排除目录走 `settings.set`；
 *   2. **人确认闸门写在数据面里**：三个写动作的请求体都**硬编码** `confirmed: true` ——
 *      界面没有第二条能构造请求的路径，所以「不点不写」不是靠自觉，是靠这里没有第二个入参；
 *   3. 宿主的方法内部失败回 `{ok:false, error:{code,message}}`（RPC 外层信封仍是 ok:true），
 *      这里把它折成**可读的 Error** 抛给界面 —— 失败理由必须能显示出来，不许静默。
 *
 * P4（复核 #26）：**从前刻意没有** `restore` 与 `settings.*`（「本期不做独立管理面板」）；
 * 复核指出底稿面板承诺「可以在设置里恢复」而设置里没有入口 —— 现在补上客户端面，
 * 对应的设置分区在 `shiji-views.tsx::installShijiSettings()`（`settings.section`）。
 */
import { rpcCall } from './rpc.js';
import type { RpcContext } from './rpc.js';

/** 一条事记（`shiji.list` 的条目；只取界面要用的字段，账本内部字段不往界面漏）。 */
export interface ShijiEntry {
  id: string;
  /** `workspace | workflow | session`（客户端只用于显示 / 不参与判据）。 */
  source?: string;
  refId?: string;
  name: string;
  summary: string;
  firstSeenAt: string;
  lastActiveAt: string;
  basis: { sessions: number; docs: number };
  manual?: boolean;
  frozenAt?: string | null;
}

/** 宿主回的可读失败（`{ok:false, error}`；方法级失败，外层信封仍是 ok:true）。 */
interface ShijiFailure {
  ok: false;
  error: { code: string; message: string };
}

/** 一条写动作的结果：`{ok:true, entry}` 或可读失败。 */
export type ShijiWriteResult = { ok: true; entry: ShijiEntry } | ShijiFailure;

/** `shiji.list` 的返回（`notes` 只在账本有坏行时出现）。 */
export interface ShijiList {
  entries: ShijiEntry[];
  notes?: string[];
}

/** P4：事记设置（`<dataDir>/shiji-settings.json`；相对项目根的排除目录）。 */
export interface ShijiSettings {
  excludedDirs: string[];
}

/** `shiji.settings.set` 的返回：成功带归一后的列表；失败带可读理由。 */
export type ShijiSettingsWriteResult =
  | { ok: true; excludedDirs: string[] }
  | { ok: false; error: { code: string; message: string } };

/** `shiji.*` 的方法名（逐字对齐宿主 `createShijiMethods()`；改这里等于改接口面）。 */
export const SHIJI_ENDPOINTS = {
  list: 'shiji.list',
  remove: 'shiji.remove',
  restore: 'shiji.restore',
  fromSession: 'shiji.fromSession',
  settingsGet: 'shiji.settings.get',
  settingsSet: 'shiji.settings.set',
} as const;

/** 事记数据面的形状（底稿面板的删除 / 设置页的恢复 / 会话里的「存成今天的事记」共用一份）。 */
export interface ShijiApi {
  /** 列事记（宿主已按 `lastActiveAt` 倒序、默认不含墓碑）。 */
  list(payload?: { includeDeleted?: boolean }, signal?: AbortSignal): Promise<ShijiList>;
  /** 删除 = 写墓碑（**人确认闸门**：`confirmed: true` 由这里写死，界面没有第二个入参）。 */
  remove(payload: { id: string }, signal?: AbortSignal): Promise<ShijiWriteResult>;
  /** P4：恢复 = 清墓碑（同样写死 `confirmed: true`；下一轮扫描按在场源头重建）。 */
  restore(payload: { id: string }, signal?: AbortSignal): Promise<ShijiWriteResult>;
  /** 「存成今天的事记」（只有一个问事会话 id 入参；`confirmed` 同样写死）。 */
  fromSession(payload: { sessionId: string }, signal?: AbortSignal): Promise<ShijiWriteResult>;
  /** P4：读可排除目录（缺失 = 空数组，由宿主决定）。 */
  getSettings(signal?: AbortSignal): Promise<ShijiSettings>;
  /** P4：写可排除目录（非法输入由宿主拒绝，这里折成可读 Error）。 */
  setSettings(payload: { excludedDirs: string[] }, signal?: AbortSignal): Promise<ShijiSettings>;
}

/**
 * 把宿主的 `{ok:false, error}` 折成可读 Error（外层 ok:true 时才会走到这里）。
 * @param value - 方法返回值
 */
function unwrapWrite<T extends { ok?: unknown; error?: { message?: string } }>(value: T): T {
  if (value?.ok === false) {
    throw new Error(value.error?.message ?? '事记操作失败（宿主没有给理由）。');
  }
  return value;
}

/**
 * 用连接上下文造一个事记数据面。
 * @param ctx - 需要 `connection.rpc`（`dsh-client-connection` 提供）。
 * @returns 三个方法都指向 `shiji.*` 的客户端面；写动作的确认位在**这里**写死。
 */
export function createShijiApi(ctx: RpcContext): ShijiApi {
  return {
    list: (payload, signal) => rpcCall<ShijiList>(ctx, SHIJI_ENDPOINTS.list, payload ?? {}, signal),
    remove: async (payload, signal) =>
      unwrapWrite(await rpcCall<ShijiWriteResult>(ctx, SHIJI_ENDPOINTS.remove, { id: payload.id, confirmed: true }, signal)),
    restore: async (payload, signal) =>
      unwrapWrite(await rpcCall<ShijiWriteResult>(ctx, SHIJI_ENDPOINTS.restore, { id: payload.id, confirmed: true }, signal)),
    fromSession: async (payload, signal) =>
      unwrapWrite(
        await rpcCall<ShijiWriteResult>(ctx, SHIJI_ENDPOINTS.fromSession, { sessionId: payload.sessionId, confirmed: true }, signal),
      ),
    getSettings: (signal) => rpcCall<ShijiSettings>(ctx, SHIJI_ENDPOINTS.settingsGet, {}, signal),
    async setSettings(payload, signal) {
      const answer = await rpcCall<ShijiSettingsWriteResult>(ctx, SHIJI_ENDPOINTS.settingsSet, payload, signal);
      if (answer?.ok !== true) {
        // 写操作不许静默：宿主拒绝（非法路径等）折成可读 Error，界面把理由显示在行上。
        throw new Error(answer?.error?.message ?? '事记设置没写成（宿主没有给理由）。');
      }
      return { excludedDirs: Array.isArray(answer.excludedDirs) ? answer.excludedDirs : [] };
    },
  };
}
