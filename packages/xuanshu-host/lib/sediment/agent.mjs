/**
 * packages/xuanshu-host/lib/sediment/agent.mjs — 把**这一场问事会话**接回来（票 10 的会话，不是新会话）。
 *
 * 为什么沉淀驱动的是既有会话而不是另开一场：草稿的全部价值来自这场对话的上下文 ——
 * 另开一场就得把会话正文整段贴进提示里，既贵又容易失真，而且会在侧栏里多出一场
 * 用户没发起过的「问事」。所以这里只做一件事：拿到那个自铸 id 的 agent。
 *
 * 与 `lib/consult/service.mjs` 的 `ensureAgent()` 同款三步（那一处是本文件的原型）：
 *   1. 本进程活着（`ctx.agents.get`）→ 直接用；
 *   2. 不活但能 resume → 走票 10 的 `resumeConsultAgent()`（它会认回会话 header 里存的 preset，
 *      不会把一个 minimal 会话按 standard 重新组合）；
 *   3. 既拿不到也 resume 不了 → 可读失败（绝不静默什么都不做）。
 *
 * **不复用 consult 的私有函数**：那是票 10 模块的内部实现（未导出），沉淀这边照同一套口径
 * 写一份短的，而不是去改别的票的域。
 */

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/**
 * 取（必要时接上）问事会话的 agent。
 * @param {object} ctx 宿主 ctx
 * @param {string} sessionId 问事会话 id（调用方已确认它是 `session-xs-consult-…`）
 * @param {{resume: (ctx: object, options: {sessionId: string}) => Promise<{agent: object}>}} deps
 *        接回实现（生产传票 10 的 `resumeConsultAgent`；断言台可换成替身）
 * @returns {Promise<object>} agent（有 `followup`）
 */
export async function ensureConsultAgent(ctx, sessionId, { resume }) {
  const agents = softGet(ctx, 'agents')
  if (typeof agents?.create !== 'function') {
    throw new Error('DSH agent 服务（ctx.agents）不可得：驱动不了这场问事会话，也就产不出草稿。')
  }
  if (typeof agents.get === 'function') {
    const live = agents.get(sessionId)
    if (live !== undefined && live !== null) return live
  }
  if (typeof agents.resume !== 'function') {
    throw new Error(`这场问事会话（${sessionId}）不在本进程活着，且 ctx.agents 不能 resume：先在会话面板里打开它，或重新问一句。`)
  }
  const handle = await resume(ctx, { sessionId })
  const agent = handle?.agent
  if (agent === undefined || agent === null) throw new Error(`接回这场问事会话（${sessionId}）失败：DSH 没有交出 agent。`)
  return agent
}
