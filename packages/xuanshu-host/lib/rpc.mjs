/** DSH 0.2.0-rc.2 Connection channel: rpc.d.ts HostConnectionRpc.handle. */
export function installRpc(ctx, methods) {
  return ctx.inject(['connection'], connected => {
    connected.effect(() => connected.connection.rpc.handle('/xuanshu', async (endpoint, payload, signal) => {
      try {
        signal.throwIfAborted();
        if (!Object.hasOwn(methods, endpoint)) throw new Error(`未知玄枢操作：${endpoint}`);
        return { ok: true, value: await methods[endpoint](payload ?? {}, signal) };
      } catch (error) {
        return { ok: false, error: { code: signal.aborted ? 'cancelled' : 'xuanshu/invalid', message: String(error?.message ?? error), details: {} } };
      }
    }), 'xuanshu RPC');
  });
}
