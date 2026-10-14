/**
 * packages/xuanshu-host/lib/consult/turn.mjs — 「等一轮真正结束」（契约 §4）。
 *
 * **为什么不能只靠 `whenIdle()`**：官方类型注释写明 `whenIdle()` 只表示「整个 agent 活动静默」，
 * **不标识某一条消息的结束** —— 多条输入可以共享同一个运行区间
 * （`dsh-agent/lib/types/runtime-types.d.ts:164`：does not identify the settlement of any particular message）。
 * 拿它当「这一问答完了」用，症状是记号错位（把上一轮的结束记到这一轮头上），而且不报错。
 *
 * 正确的判据是会话日志自己的边界事件 `turn/end`（`dsh-session/lib/types/types.d.ts:262-276`：
 * `{'turn/start':{turn}, 'turn/end':{turn, reason}}`），宿主侧通过
 * `ctx.on('session/event', (session, event) => …)` 订阅（`dsh-session/lib/types/index.d.ts:64`）。
 *
 * 本模块只做一件事：订阅 → 命中这个会话的 `turn/end` → 退订 → 把结果交出去。
 * `consult.send` 用它做**轮次完成的记账**（旁挂清单的 `lastTurnAt`），而不是阻塞发问 ——
 * `consult.send` 的语义与 DSH 的 `SessionPromptValue{accepted:true}` 一致：受理，不等答完。
 */

/**
 * 等指定会话的下一轮结束。
 * @param {object} ctx cordis 宿主上下文（需要 `ctx.on`）
 * @param {string} sessionId 目标会话
 * @param {{signal?: AbortSignal}} [options] 可选取消信号（调用方要提前放弃等待时用）
 * @returns {Promise<{kind: 'ended', turn: number|null, reason: object|null} | {kind: 'aborted'}>}
 */
export function waitForTurnEnd(ctx, sessionId, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof ctx?.on !== 'function') {
      reject(new Error('宿主 ctx 上没有事件订阅（ctx.on）：等不到 turn/end，也就判不出一轮什么时候结束。'))
      return
    }
    let off
    let settled = false
    const onAbort = () => finish({ kind: 'aborted' })
    const finish = (result) => {
      if (settled) return
      settled = true
      try {
        if (typeof off === 'function') off()
      } catch {
        /* 订阅可能随 fiber 一起早就没了：退订失败不影响结果 */
      }
      try {
        signal?.removeEventListener?.('abort', onAbort)
      } catch {
        /* 同上 */
      }
      resolve(result)
    }

    off = ctx.on('session/event', (session, event) => {
      if (session?.id !== sessionId) return
      if (event?.type !== 'turn/end') return
      finish({ kind: 'ended', turn: event.data?.turn ?? null, reason: event.data?.reason ?? null })
    })

    if (signal?.aborted === true) onAbort()
    else signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}
