/**
 * `packages/xuanshu-client/src/client/ctx-service.ts` — 读客户端 cordis ctx 上的**未声明服务**。
 *
 * 为什么必须有这一个入口（真机实测，2026-10-18）：
 * 客户端 ctx 的属性访问走拓扑敏感的代理 —— 服务名没写进本插件的 `inject` 数组时，
 * `ctx.uiWorkspace` 会**直接抛** `Error: cannot get property "uiWorkspace" without inject`，
 * 而 `as SomeShape` 这类类型断言在运行时**什么也不做**。这个异常发生在 `apply()` 里，
 * DSH 的 web boot 只会把它显示成一行 `xuanshu-client: failed`（真实栈被吞），
 * 整块玄枢 UI 因此一个面板都不渲染。
 *
 * 可缺席的服务（`uiWorkspace` / `workspaces` / `sessions` / `commandUi`）一律走 `ctx.get(name)`：
 * 它在服务缺席时返回 `undefined`，正是各调用点「拿不到就如实降级」需要的东西。
 *
 * 已写进 `inject` 的服务（`slots` / `layout` / `theme` / `connection`）继续用属性访问，别绕这里。
 */

/** 取客户端 ctx 上的可选服务；`ctx.get` 不可用或服务缺席时返回 `undefined`。 */
export function readService<T>(ctx: unknown, name: string): T | undefined {
  const get = (ctx as { get?: (service: string) => unknown } | null | undefined)?.get;
  if (typeof get !== 'function') return undefined;
  return get.call(ctx, name) as T | undefined;
}
