/**
 * `packages/xuanshu-host/lib/soft-service.mjs` — 从宿主 ctx 上取**可选服务**的唯一安全入口。
 *
 * 为什么（真机实测，2026-10-18）：cordis 的 ctx 属性代理对**没写进 `inject` 数组**的服务
 * **直接抛** `Error: cannot get property "<name>" without inject`。本插件的纪律是
 * `inject = []`（拿不到服务也要能起来、要能写装配报告），所以任何服务都只能软取。
 *
 * `ctx?.name` 这种写法同样是错的：`?.` 只挡住 ctx 为 null，挡不住代理的抛。
 * 表现是「功能静默失败」——日课 AI 段报 `AI 段跑的时候抛了异常（已兜住）：cannot get property "llm" without inject`。
 *
 * 用法：`const llm = getService(ctx, 'llm')`，之后再按缺席处理（`if (!llm) …降级…`）。
 */

/**
 * 取服务；ctx 不支持 `get` 或服务缺席时返回 `undefined`，**从不抛**。
 * @param {object} ctx cordis 上下文
 * @param {string} name 服务名
 * @returns {unknown} 服务实例或 `undefined`
 */
export function getService(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}
