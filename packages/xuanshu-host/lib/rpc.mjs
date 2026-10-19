/**
 * `packages/xuanshu-host/lib/rpc.mjs` — 玄枢 RPC 通道（DSH 0.2.0-rc.2）。
 *
 * **为什么不是一个独立 channel**（真机实测踩到，2026-10-18）：
 * `connection.rpc.handle('/xuanshu', …)` 在 `register()` 内部读 `owner.webServer`，
 * 而那个 owner 是 connection service 自己的 ctx（没有 inject `webServer`）——
 * 必然抛 `cannot get property "webServer" without inject`，通道一条都注册不上，
 * 客户端于是对 `/xuanshu/<method>` 拿到 HTTP 405，界面上所有数据面全灭
 * （`rikke.status` → 「底座未就绪 / 推送调用失败」、命盘快照读不出来）。
 *
 * **rc.2 给扩展的正确入口是 `/api` 共享通道上的 exact Fetch 路由**：
 * `connection.fetch.register({ path: '/api/<name>', methods, requestBody, fetch })`
 * （先例：`dsh-api-session-controller` 的 `/api/file`）。它不需要 `webServer`，
 * 鉴权（Host/Origin 围栏 + 浏览器会话）由 `/api` 前缀路由统一施加。
 *
 * 所以本体只有一件事：把 `/api/xuanshu` 这个 POST 端点接到 `methods` 上，
 * 信封极简 —— 请求 `{ method, payload }`，响应 `{ ok: true, value }` 或
 * `{ ok: false, error: { code, message, details } }`。客户端那半边见
 * `packages/xuanshu-client/src/client/rpc.ts`。
 */

/** 端点路径：必须落在 `/api/<单个 segment>` 上（`assertFetchRoute` 用 `endpointFromPath('/api', …)` 校验）。 */
export const RPC_PATH = '/api/xuanshu';

/**
 * 建 JSON 响应。
 * @param {unknown} body 响应体
 * @param {number} [status] HTTP 状态码（缺省 200）
 */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * 挂上玄枢 RPC 端点。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 宿主插件上下文
 * @param {Record<string, (payload: object, signal: AbortSignal) => Promise<unknown>>} methods 方法表
 * @returns {() => void} disposer（随插件 fiber 回收）
 */
export function installRpc(ctx, methods) {
  const dispatch = createRpcDispatch(methods);
  return ctx.inject(['connection'], (connected) => {
    const connection = connected.connection;
    const route = {
      path: RPC_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      /**
       * 非 HTTP 入口：按 `(endpoint, payload, signal)` 直接调，返回同一信封。
       * 内嵌方与装配断言台用它，不必自己造 `Request`/`Response`（HTTP 那层只做解析与包装）。
       */
      handler: dispatch,
      fetch: async (request) => {
        let body;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ ok: false, error: { code: 'xuanshu/invalid', message: 'body 不是 JSON', details: {} } }, 400);
        }
        const method = typeof body?.method === 'string' ? body.method : '';
        const payload = body?.payload ?? {};
        // 客户端断开 = 取消：方法和宿主内部共用同一条 AbortSignal 语义。
        const controller = new AbortController();
        if (typeof request.signal?.addEventListener === 'function') {
          request.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
        const envelope = await dispatch(method, payload, controller.signal);
        return jsonResponse(envelope);
      },
    };
    // 首选：rc.2 给扩展的 exact Fetch 路由面（唯一在真机能注册成功的那条）。
    if (typeof connection?.fetch?.register === 'function') {
      return connected.effect(() => connection.fetch.register(route), 'xuanshu RPC');
    }
    // 兼容面：测试替身 / 未来嵌入方可能只给旧的 `rpc.handle`。真 cordis 上这条路会抛
    //（`register()` 里读 `owner.webServer`，见文件头），所以生产永远不会走到这里。
    if (typeof connection?.rpc?.handle === 'function') {
      return connected.effect(() => connection.rpc.handle(RPC_PATH, dispatch), 'xuanshu RPC');
    }
    throw new Error('宿主没有可用的 connection.fetch.register（rc.2 的路由注册面）');
  });
}

/**
 * 建信封派发器（方法表 → `(endpoint, payload, signal) => Promise<Envelope>`）。
 *
 * @param {Record<string, (payload: object, signal: AbortSignal) => Promise<unknown>>} methods 方法表
 * @returns {(endpoint: string, payload: object, signal: AbortSignal) => Promise<
 *   {ok: true, value: unknown} | {ok: false, error: {code: string, message: string, details: object}}>}
 */
export function createRpcDispatch(methods) {
  return async (endpoint, payload = {}, signal = new AbortController().signal) => {
    if (!Object.hasOwn(methods, endpoint)) {
      return { ok: false, error: { code: 'xuanshu/invalid', message: `未知玄枢操作：${endpoint}`, details: {} } };
    }
    try {
      signal.throwIfAborted();
      return { ok: true, value: await methods[endpoint](payload, signal) };
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
  };
}
