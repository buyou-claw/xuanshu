/** DSH 0.2.0-rc.2 Connection channel: rpc.d.ts HostConnectionRpc.handle. */
export function installRpc(ctx, methods) {
  return ctx.inject(['connection', 'webServer'], connected => {
    connected.effect(() => connected.connection.rpc.handle('/xuanshu', async (endpoint, payload, signal) => {
      try {
        signal.throwIfAborted();
        if (!Object.hasOwn(methods, endpoint)) throw new Error(`未知玄枢操作：${endpoint}`);
        return { ok: true, value: await methods[endpoint](payload ?? {}, signal) };
      } catch (error) {
        // 票 28 起，方法可以带一个**受控**错误码（`error.xuanshuCode`）与结构化详情：
        // `bestof.run` 的 `needs-confirmation` 要把 estimate 原样带回给界面。
        // 只认这个显式字段，不把任意 `error.code`（如 fs 的 ENOENT）漏成 RPC 错误码。
        const code = typeof error?.xuanshuCode === 'string' && error.xuanshuCode !== ''
          ? error.xuanshuCode
          : signal.aborted ? 'cancelled' : 'xuanshu/invalid';
        return {
          ok: false,
          error: {
            code,
            message: String(error?.message ?? error),
            details: error?.details !== null && typeof error?.details === 'object' ? error.details : {},
          },
        };
      }
    }), 'xuanshu RPC');
  });
}
