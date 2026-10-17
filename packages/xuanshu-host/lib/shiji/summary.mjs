/**
 * 票 05（#26）· 事记摘要（契约 §1/§2）
 *
 * 两条硬边界：
 *   ① **只写依据里出现过的事**：素材 = 会话标题（+ 需要时的一段会话文本历史）+ 说明文档正文；
 *      LLM 不可用 / 报错 / 返回空 → `summaryMode:'skeleton'`，`summary` 如实写
 *      「摘要未能生成（模型不可用）」+ 依据计数，**不编内容**；
 *   ② **绝不抛**（与 `digao/llm.mjs` 同一口径）：失败折成 `{ok:false, reason}`，由账本决定降级。
 *
 * 为什么单独一套提示词、不复用底稿的 `DIGEST_SYSTEM`：底稿要「200 字精简汇总」，事记只要
 * 「一两句」；而且两种调用必须在日志/测试里能按 `system` 分清（`tests/digao/daily-chain.test.mjs`
 * 的 LLM 计数断言就是按这个分的）。
 */

/** 事记摘要的系统提示（与底稿的 `DIGEST_SYSTEM` 明确区分）。 */
export const SHIJI_SUMMARY_SYSTEM = '你是玄枢的事记摘要器。把用户给的项目名、会话标题与项目说明文档压成一两句中文事记，'
  + '只写材料里出现过的事实，不要推测、不要分点、不要标题，长度不超过 120 字。'

/** 会话「存成今天的事记」的摘要提示（素材是会话文本历史）。 */
export const SHIJI_SESSION_SYSTEM = '你是玄枢的事记摘要器。把用户给的一场问事的文本历史压成一两句中文事记，'
  + '只写这场问事里出现过的事实，不要推测、不要分点、不要标题，长度不超过 120 字。'

/** 摘要长度上限（一两句；超了截断）。 */
export const SHIJI_SUMMARY_LIMIT = 200

/** 降级摘要的固定开头（契约 §1 原文）。 */
export const SKELETON_PREFIX = '摘要未能生成（模型不可用）'

/** 依据的固定说法：「依据：会话 N 场 · 文档 M 份」。 */
export function basisText(basis) {
  const sessions = Number.isInteger(basis?.sessions) && basis.sessions >= 0 ? basis.sessions : 0
  const docs = Number.isInteger(basis?.docs) && basis.docs >= 0 ? basis.docs : 0
  return `会话 ${sessions} 场 · 文档 ${docs} 份`
}

/** 降级摘要（如实 + 依据计数，不编内容）。 */
export function skeletonSummary(basis) {
  return `${SKELETON_PREFIX}：依据 ${basisText(basis)}。`
}

/** 从一个 DSH LLM 运行时里挑首个可用 provider/model；挑不出 → null（绝不抛）。 */
async function pickRoute(llm) {
  if (typeof llm?.listProviders !== 'function' || typeof llm?.listModels !== 'function') return null
  let providers
  try {
    providers = llm.listProviders()
  } catch {
    return null
  }
  for (const provider of Array.isArray(providers) ? providers : []) {
    const id = typeof provider?.id === 'string' ? provider.id : typeof provider === 'string' ? provider : ''
    if (id === '') continue
    try {
      const models = await llm.listModels(id)
      const model = Array.isArray(models) ? models.find((entry) => typeof entry?.id === 'string' && entry.id !== '') : undefined
      if (model !== undefined) return { provider: id, model: model.id }
    } catch {
      /* 这条路由问不出模型：试下一条 */
    }
  }
  return null
}

/**
 * 调一次 LLM（只收 text-delta；失败一律 `{ok:false}`）。
 * @returns {Promise<{ok: boolean, text: string, reason: string|null}>}
 */
async function callLlm(ctx, { system, prompt }) {
  const llm = softLlm(ctx)
  if (!llm || typeof llm.stream !== 'function') return { ok: false, text: '', reason: 'ctx.llm 不可得（宿主没装 LLM 服务）' }
  if (prompt.trim() === '') return { ok: false, text: '', reason: '没有可摘要的素材' }
  const route = await pickRoute(llm)
  if (route === null) return { ok: false, text: '', reason: 'ctx.llm 里没有可用的 provider/model 路由' }
  let collected = ''
  try {
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    })
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') collected += chunk.text
      if (chunk?.type === 'error') return { ok: false, text: '', reason: `LLM 流报错：${String(chunk.error ?? chunk.message ?? '未知')}` }
    }
  } catch (error) {
    return { ok: false, text: '', reason: `LLM 调用失败：${String(error?.message ?? error)}` }
  }
  const collapsed = collected.replace(/\s+/gu, ' ').trim()
  if (collapsed === '') return { ok: false, text: '', reason: 'LLM 返回了空文本' }
  return { ok: true, text: collapsed.length > SHIJI_SUMMARY_LIMIT ? `${collapsed.slice(0, SHIJI_SUMMARY_LIMIT)}…` : collapsed, reason: null }
}

/** `ctx.llm` 只从 ctx 上取（宿主服务），拿不到不抛。 */
function softLlm(ctx) {
  try {
    return ctx?.llm
  } catch {
    return undefined
  }
}

/** 把一条依据拼成摘要素材（只给「看过的东西」：标题 + 文档片段）。 */
export function summaryPrompt(item) {
  const lines = [
    `项目/工作流：${item?.name ?? ''}`,
    `依据：${basisText(item?.basis)}`,
  ]
  const titles = (Array.isArray(item?.material?.sessionTitles) ? item.material.sessionTitles : []).filter((title) => typeof title === 'string' && title !== '')
  if (titles.length > 0) lines.push(`会话标题：${titles.join('；')}`)
  for (const doc of Array.isArray(item?.material?.docs) ? item.material.docs : []) {
    if (typeof doc?.text !== 'string' || doc.text.trim() === '') continue
    lines.push(`【文档 ${doc.relPath}】`, doc.text)
  }
  return lines.join('\n')
}

/**
 * 依据 → 摘要（注入的 LLM；失败降级但不抛）。
 *
 * @param {object} ctx 宿主上下文（`ctx.llm` 可缺席）
 * @param {{name: string, basis: {sessions: number, docs: number}, material?: object}} item
 * @returns {Promise<{ok: boolean, text: string, mode: 'llm'|'skeleton', reason: string|null}>}
 */
export async function summarizeShijiEvidence(ctx, item) {
  const result = await callLlm(ctx, { system: SHIJI_SUMMARY_SYSTEM, prompt: summaryPrompt(item) })
  if (!result.ok) {
    return { ok: false, text: skeletonSummary(item?.basis), mode: 'skeleton', reason: result.reason }
  }
  return { ok: true, text: result.text, mode: 'llm', reason: null }
}

/**
 * 会话文本历史 → 摘要（`shiji.fromSession` 用；模板同 `summarizeShijiEvidence`）。
 *
 * @param {object} ctx 宿主上下文
 * @param {{name?: string, messages?: Array<{role: string, text: string}>}} input
 *        `messages` 是 `consult/history.mjs` 的 `projectConsultMessages()` 产物
 */
export async function summarizeSessionHistory(ctx, { name, messages } = {}) {
  const recent = (Array.isArray(messages) ? messages : [])
    .filter((message) => (message?.role === 'user' || message?.role === 'assistant') && typeof message.text === 'string' && message.text.trim() !== '')
    .slice(-8)
  // 一句可摘的文本都没有 → 不调 LLM（调用方据此**不写空条目**）。
  if (recent.length === 0) return { ok: false, text: '', reason: '这场会话没有可摘要的文本历史' }
  const lines = [`会话：${name ?? ''}`]
  for (const message of recent) lines.push(`${message.role === 'user' ? '用户' : '助手'}：${message.text.slice(0, 800)}`)
  return callLlm(ctx, { system: SHIJI_SESSION_SYSTEM, prompt: lines.join('\n') })
}
