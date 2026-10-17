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

/** 合参候选的历史里**不**出现的 kind：注入进去的谱资料（它已经作为「材料」单独给了候选）。 */
const HISTORY_EXCLUDED_KINDS = new Set(['xuanshu-consult'])

/** 已采用的合参稿（ADR-0010 第 5 条：历史只带采用稿）——单独标一行，模型才知道那是一份被拍板的稿子。 */
const ADOPTED_KIND = 'xuanshu-bestof-adopted'

/**
 * 事件流 → `ConsultMessage[]`（只读，不改任何东西）。
 *
 * @param {{events?: object[]}} snapshot `ctx.sessionQuery.readSession()` 的返回
 * @param {{keepAdoptedIds?: Set<string>|null}} [options]
 *        `keepAdoptedIds` 给**候选历史**用（复核 48e0e0a 的 N4）：日志是追加式的，改选 / 否决都不会
 *        删掉旧的采用稿消息，所以「还算不算当前采用稿」必须由旁挂决策判（`currentAdoptedMessageIds`）。
 *        `null` / 不给 = **不过滤**（阅读器那一侧照旧看得到全部投递史；判不出来时也不误删）。
 */
export function projectConsultMessages(snapshot, { keepAdoptedIds = null } = {}) {
  const events = Array.isArray(snapshot?.events) ? snapshot.events : []
  const messages = []
  for (const event of events) {
    if (event?.type === 'user/message') {
      // 采用稿的「当前性」不在这一层判：被改选 / 被否决掉的那几份从这里就不进历史。
      if (keepAdoptedIds instanceof Set
        && event.data?.source?.kind === ADOPTED_KIND
        && !keepAdoptedIds.has(event.data?.id)) continue
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

/** 一条历史消息的说话人标签（采用稿单独标，别让模型以为那是用户自己写的）。 */
function labelOf(message) {
  if (message.source === ADOPTED_KIND) return '已采用的合参稿'
  return message.role === 'user' ? '用户' : '助手'
}

/**
 * 候选流要带的**会话文本历史**（S9 每路独立的历史窗口 → 玄枢 v1 按合参模型统一处理）。
 *
 * 为什么候选需要它（评审 R5）：候选直接走 `ctx.llm.stream()`，没有会话历史；只带「材料 + 当前问题」时，
 * 用户下一轮说「沿用刚才预算比较已经采用的方案」，候选**取不到**上一轮的方案与预算。
 *
 * 三条口径：
 *   ① 只带**文本**（`projectConsultMessages` 已经滤掉工具调用与执行复盘：S9 排除的是图片历史，
 *      不是全部文本历史）；
 *   ② 落选 / 被否决的候选**不在其中** —— 它们从来没进过会话日志，日志里只有被采用的那一份
 *      （`xuanshu-bestof-adopted`），这里如实标成「已采用的合参稿」；
 *   ③ 窗口**按整条**消息裁剪（从最新往回装）：半条被截断的历史比少一条更难查；一条都装不下时，
 *      最新那条照样带上（宁可超窗口，也不许候选对刚发生的事一无所知），并把裁剪事实写在文本里。
 *
 * @param {{messages?: Array<{role: string, text: string, source?: string}>, budget: number|null}} input
 *        `messages` 是 `projectConsultMessages()` 的产物；`budget` 单位是**字**（`null` = 预算未知）。
 * @returns {{text: string, included: number, omitted: number, chars: number}}
 */
export function buildCandidateHistory({ messages, budget }) {
  const all = (Array.isArray(messages) ? messages : []).filter(
    (message) => (message?.role === 'user' || message?.role === 'assistant')
      && typeof message.text === 'string' && message.text.trim() !== ''
      && !HISTORY_EXCLUDED_KINDS.has(message.source),
  )
  if (all.length === 0) return { text: '', included: 0, omitted: 0, chars: 0 }

  const take = []
  let chars = 0
  for (let index = all.length - 1; index >= 0; index -= 1) {
    const message = all[index]
    const cost = labelOf(message).length + message.text.length + 1
    if (budget !== null && take.length > 0 && chars + cost > budget) break
    take.unshift(message)
    chars += cost
    if (budget !== null && chars > budget) break
  }

  const omitted = all.length - take.length
  const lines = take.map((message) => `${labelOf(message)}：${message.text}`)
  const notes = []
  if (omitted > 0) notes.push(`（历史按 ${budget} 字窗口裁剪：省略了更早的 ${omitted} 条消息）`)
  else if (budget === null) notes.push('（预算未知：拿不到模型窗口，本次不做裁剪，历史全部带上）')

  return {
    text: [
      '【这场问事的历史】（只保留被采用的合参稿；落选候选不在其中）',
      ...lines,
      ...notes,
    ].join('\n'),
    included: take.length,
    omitted,
    chars,
  }
}
