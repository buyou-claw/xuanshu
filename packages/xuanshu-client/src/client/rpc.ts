/**
 * `packages/xuanshu-client/src/client/rpc.ts` — 玄枢数据面调用（浏览器半边）。
 *
 * **为什么不用 `ctx.connection.rpc.call`**（真机实测踩到，2026-10-18）：
 * 那条路会把请求发到 `/<channel>/<method>`，而 rc.2 的宿主只把 **`/api`**
 * 挂成前缀路由；玄枢自己的 channel 又注册不上（`connection.rpc.handle()` 内部
 * 读 `owner.webServer` 会抛，见宿主 `lib/rpc.mjs` 文件头）。结果是客户端对
 * `/xuanshu/<method>` 拿到 HTTP 405，界面上所有数据面全灭。
 *
 * 现在两端对齐到同一个 exact Fetch 路由 `/api/xuanshu`：
 * 请求 `{ method, payload }`，响应 `{ ok: true, value }` /
 * `{ ok: false, error: { code, message, details } }`。
 * 同源 fetch 自带会话 cookie，鉴权由 `/api` 前缀路由统一施加（不需要额外头）。
 */

/** 端点（与宿主 `RPC_PATH` 同一个值；两侧改动必须同时改）。 */
export const RPC_PATH = '/api/xuanshu';

/** 调用方上下文面（保留形状：调用点传 `rpc`，本实现不再经 ctx 走连接服务）。 */
export interface RpcContext {
  connection?: unknown;
}

interface RpcEnvelope<T> {
  ok: boolean;
  value?: T;
  error?: { code?: string; message?: string; details?: unknown };
}

/**
 * 调一个玄枢宿主方法。
 *
 * @param _ctx 调用方上下文（保留参数位，便于将来换回连接服务）
 * @param method 方法名（如 `rikke.status`）
 * @param payload 载荷
 * @param signal 取消信号
 * @returns 方法返回值
 */
export async function rpcCall<T>(_ctx: RpcContext, method: string, payload: unknown = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(RPC_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, payload }),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`transport failure for ${RPC_PATH}: HTTP ${response.status}`);
  const body = await response.json() as RpcEnvelope<T>;
  if (body?.ok === true) return body.value as T;
  throw new Error(body?.error?.message ?? `${method} 调用失败（宿主没有给原因）`);
}
