/**
 * 票 29 · 「接上 AI」的数据面 —— **只有一次读**：`routes.list`。
 *
 * 为什么不新开一个宿主方法：票 28 已经把「哪几家 provider / 各自哪些模型 / key 配没配 / 默认路由」
 * 合成了一张只读清单（`packages/xuanshu-host/lib/consult/routes.mjs`）。#29 的状态面是它的**投影**，
 * 再探测一遍只会多一处会漂移的真相，也会违反「检测只读」。
 *
 * 方法名复用 `BESTOF_ENDPOINTS.routes`（同一处冻结字符串），请求体固定 `{}`。
 * 旧宿主没有这个方法 → RPC 抛「未知玄枢操作：routes.list」→ 控制器把它降级成「未知」
 * （`ai-model.ts` 的 `deriveAiReadiness(undefined)`），不编造「未配置」。
 */
import { BESTOF_ENDPOINTS } from './bestof-api.js';
import type { RouteCatalog } from './bestof-api.js';
import { rpcCall } from './rpc.js';
import type { RpcContext } from './rpc.js';

/** 「接上 AI」的数据面（只有一个只读方法）。 */
export interface AiApi {
  routes(signal?: AbortSignal): Promise<RouteCatalog>;
}

/**
 * 用连接上下文造一个只读状态面。
 * @param ctx - 需要 `connection.rpc`（`dsh-client-connection` 提供）。
 * @returns 只含 `routes()` 的数据面。
 */
export function createAiApi(ctx: RpcContext): AiApi {
  return {
    routes: (signal) => rpcCall<RouteCatalog>(ctx, BESTOF_ENDPOINTS.routes, {}, signal),
  };
}
