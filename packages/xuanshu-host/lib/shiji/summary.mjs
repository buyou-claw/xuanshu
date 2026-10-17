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

import { streamText } from '../llm/text.mjs'

/** 事记摘要的系统提示（与底稿的 `DIGEST_SYSTEM` 明确区分）。 */
export const SHIJI_SUMMARY_SYSTEM = '你是玄枢的事记摘要器。把用户给的项目名、会话标题、会话内容（人在会话里问过的话）'
  + '与项目说明文档压成一两句中文事记，只写材料里出现过的事实，不要推测、不要分点、不要标题，长度不超过 120 字。'

/**
 * 素材范围的固定说明（#38）：摘要素材有会话内容，但**没有**代码正文。
 * 写在 prompt 里而不是只写在注释里 —— 模型看得到才有约束力，测试也钉得住。
 */
export const SHIJI_MATERIAL_SCOPE = '（素材只来自会话标题、会话内容与项目说明文档；不读代码正文）'

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

/**
 * 调一次 LLM（只收 text-delta；失败一律 `{ok:false}`）。
 *
 * 路由与流处理复用 `lib/llm/text.mjs` 的**唯一实现**（#24 抽出来的：底稿摘要 / 日课 AI 段 /
 * 事记摘要只差 system 与素材）；本函数只负责「事记要的失败口径 + 一两句的长度截断」。
 * @returns {Promise<{ok: boolean, text: string, reason: string|null}>}
 */
async function callLlm(ctx, { system, prompt }) {
  const llm = softLlm(ctx)
  if (!llm || typeof llm.stream !== 'function') return { ok: false, text: '', reason: 'ctx.llm 不可得（宿主没装 LLM 服务）' }
  if (prompt.trim() === '') return { ok: false, text: '', reason: '没有可摘要的素材' }
  const streamed = await streamText(llm, { system, prompt })
  if (!streamed.ok) return { ok: false, text: '', reason: streamed.reason }
  const collapsed = streamed.text.replace(/\s+/gu, ' ').trim()
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

/**
 * 把一条依据拼成摘要素材（只给「看过的东西」：标题 + 会话内容 + 文档片段）。
 *
 * 素材的三路顺序固定（会话标题 → 会话内容 → 文档正文）：同一份依据必须拼出同一段 prompt
 * （用例钉着），否则「指纹不变 → 0 次摘要」的成本口径会在模型侧抖动。
 * 会话内容缺席（日志读不出来 / 一场会话没人说话）时**不补、不编** —— 如实按标题 + 文档降级。
 */
export function summaryPrompt(item) {
  const lines = [
    `项目/工作流：${item?.name ?? ''}`,
    `依据：${basisText(item?.basis)}`,
    SHIJI_MATERIAL_SCOPE,
  ]
  const titles = (Array.isArray(item?.material?.sessionTitles) ? item.material.sessionTitles : []).filter((title) => typeof title === 'string' && title !== '')
  if (titles.length > 0) lines.push(`会话标题：${titles.join('；')}`)
  // 「会话内容」= 人在会话里问过的句子（首问在前，有界；采集侧已截断）。
  for (const session of Array.isArray(item?.material?.sessionTexts) ? item.material.sessionTexts : []) {
    const questions = (Array.isArray(session?.questions) ? session.questions : []).filter((question) => typeof question === 'string' && question !== '')
    if (questions.length === 0) continue
    const title = typeof session?.title === 'string' && session.title !== '' ? ` ${session.title}` : ''
    lines.push(`【会话内容${title}】`)
    for (const question of questions) lines.push(`问：${question}`)
  }
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
