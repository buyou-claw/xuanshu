/**
 * packages/xuanshu-host/lib/consult/history.mjs — 会话正文的只读投影（契约 §2 的 `ConsultMessage`，S7 阅读器）。
 *
 * 正文的权威是**会话日志**，读它只有一条路：`ctx.sessionQuery.readSession(id)`
 * （`dsh-session-query` 的冷热统一读面）。本机日志是 `session.v4.jsonl.zstd`，
 * **不要自己解压、不要自己读文件**：replay 校验、损坏会话的错误语义都在 sessionQuery 那边。
 *
 * 投影只做一件事：把回放出来的事件流收敛成「你问 / AI 答」两种消息。
 * `tool/result`、`step/*`、`turn/*` 一律不进消息流 —— 回看视图要的是结论，不是执行复盘
 * （S7 §3：工具调用折叠粒度由阅读器自己决定，数据面只给消息）。
 */

/** 一条消息里取文本：多段文本用换行拼接；没有文本段（纯工具调用等）→ null（不进消息流）。 */
function textOf(blocks) {
  if (!Array.isArray(blocks)) return null
  const parts = blocks.filter((block) => block?.type === 'text' && typeof block.text === 'string' && block.text !== '')
  if (parts.length === 0) return null
  return parts.map((block) => block.text).join('\n')
}

/** epoch 毫秒 → ISO；不是数就不给 `at`（宁可少一个字段，也不编时间）。 */
function atOf(time) {
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined
}

/** source kind：认不出就不给（消费方对未知 kind 直接 fall through —— 我们连它是什么都不知道时也一样）。 */
function kindOf(source) {
  return typeof source?.kind === 'string' && source.kind !== '' ? source.kind : undefined
}

/**
 * 事件流 → `ConsultMessage[]`（只读，不改任何东西）。
 * @param {{events?: object[]}} snapshot `ctx.sessionQuery.readSession()` 的返回
 */
export function projectConsultMessages(snapshot) {
  const events = Array.isArray(snapshot?.events) ? snapshot.events : []
  const messages = []
  for (const event of events) {
    if (event?.type === 'user/message') {
      const text = textOf(event.data?.content)
      if (text === null) continue
      messages.push({ role: 'user', text, ...pick(atOf(event.time), 'at'), ...pick(kindOf(event.data?.source), 'source') })
    } else if (event?.type === 'assistant/message') {
      const text = textOf(event.data?.message?.content)
      if (text === null) continue
      messages.push({ role: 'assistant', text, ...pick(atOf(event.time), 'at'), ...pick(kindOf(event.data?.message?.source), 'source') })
    }
  }
  return messages
}

/** 值存在才带上这个键（契约里 `at` / `source` 都是可选的）。 */
function pick(value, key) {
  return value === undefined ? {} : { [key]: value }
}

/**
 * 是不是「这个会话还不存在/还没落盘」。
 *
 * 上游错误码是 `SESSION_QUERY_SESSION_NOT_FOUND`（`dsh-session-query/lib/index.js:311`；
 * 码表见 `lib/types/config.d.ts:23`）。刚 `consult.create` 完、一句话都没问的会话就是这个状态 ——
 * 阅读器该显示「还没有消息」，而不是一个错误条。
 */
export function isSessionNotFound(error) {
  if (error?.code === 'SESSION_QUERY_SESSION_NOT_FOUND') return true
  return error?.name === 'SessionQueryError' && /not found/iu.test(String(error?.message ?? ''))
}
