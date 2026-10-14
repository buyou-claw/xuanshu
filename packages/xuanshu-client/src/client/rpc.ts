/** Real DSH Connection call signature from dsh-client-connection rpc.d.ts. */
export interface RpcContext {
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string } }> } };
}
export async function rpcCall<T>(ctx: RpcContext, method: string, payload: unknown = {}, signal?: AbortSignal): Promise<T> {
  const result = await ctx.connection.rpc.call('/xuanshu', method, payload, signal);
  if (!result.ok) throw new Error(result.error.message);
  return result.value as T;
}
