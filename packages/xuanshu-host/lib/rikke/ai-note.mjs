/**
 * packages/xuanshu-host/lib/rikke/ai-note.mjs — 日课的**AI 段**（「今天注意什么」）。
 *
 * 为什么是新能力而不是接线：#24 之前日课是**纯确定性**的（`rikke/generate.mjs:16`「不联网、不调 LLM」），
 * 到点那一轮的模型只负责「读产物 + 说人话」（`digao/tasks.mjs` 的 `RIKKE_PROMPT` 逐字写着「不要改写它」）。
 * 这一段补上 spec `002-reside-and-use.md:126` 要的第二段：**一段短的「今天注意什么」**。
 *
 * 三条边界（照 `digao/llm.mjs` 的软降级同款）：
 *   1. **只产出一段文本**：骨架（宜 / 忌 / 流日）永远由确定性链算，AI 段**不参与**产物结构；
 *   2. **绝不抛**：`ctx.llm` 缺席 / 没路由 / 流报错 / 空文本 —— 一律 `{mode:'failed', reason}`；
 *      开关关掉是 `{mode:'off'}`（关闭 ≠ 失败：界面文案不同，用户的心智也不同）；
 *   3. **素材是真素材**：底座谱（`pu/repository.mjs` 的 `readBase()`）+ 底稿「最近在做什么」
 *      的正文（有界，不带「曾经」或混合摘要）+ 当日三键。不让模型凭空推运。
 *
 * 三态落法（与底稿的 `digest:'llm'|'skeleton'` 同一个思路，但这里多一档「关」）：
 * `ai: {mode:'ok', text} | {mode:'off'} | {mode:'failed', reason}` —— 见 `generate.mjs` 的写盘顺序。
 */

import { DIGAO_SECTIONS } from '../digao/skeleton.mjs'
import { readDigaoMarkdown, readDigaoMeta } from '../digao/store.mjs'
import { streamText } from '../llm/text.mjs'
import { createPuRepository } from '../pu/repository.mjs'
import { getService } from '../soft-service.mjs'

/** AI 段的提示词（只让它写「今天注意什么」，不让它复述宜忌、不让它发挥吉凶）。 */
export const AI_NOTE_SYSTEM = '你是玄枢的日课提示器。根据用户给的底座谱、最近的底稿与今日黄历三键，'
  + '用一段中文写下「今天注意什么」：只说与今天安排有关的注意事项，不要复述宜忌原文、不要新增事实、'
  + '不要推测吉凶、不要分点、不要标题，长度不超过 120 字。'

/** AI 段文本的长上限（「一段短话」；超了截断并标省略，不静默丢）。 */
export const AI_NOTE_LIMIT = 120

/** 喂给模型的素材上限（底座谱可能是长文；AI 段只需要「我是谁」的骨架）。 */
const MATERIAL_LIMIT = 240
/** 底稿近期安排的正文预算；保留来源标记，超长截断时仍给出省略信号。 */
const RECENT_MATERIAL_LIMIT = 2000

/** 非空字符串（去空白）。 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 超长截断（保留「还有更多」的信号）。 */
function clip(value, limit) {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

/**
 * 底座谱里「我是谁」的那一句（优先 summary，退 description / body）；读不出 → null（不抛）。
 * @param {string} dataDir
 * @returns {string|null}
 */
export function readBaseSummary(dataDir) {
  try {
    const base = createPuRepository(dataDir).readBase()
    if (base === null) return null
    const summary = text(base.summary) || text(base.description) || text(base.body)
    return summary === '' ? null : clip(summary, MATERIAL_LIMIT)
  } catch {
    // 底座谱坏了：底稿那边自有 error 态；AI 段当这一路没素材（prompt 里如实写「还没有」）。
    return null
  }
}

/**
 * 底稿「最近」的正文 + 刷新依据；没有底稿 → null，正文不可得时如实说明。
 * 两段边界来自底稿渲染器的常量，不能把顶部混合摘要或后面的事记当成「最近」。
 * @param {string} dataDir
 * @returns {string|null}
 */
export function readRecentDigao(dataDir) {
  const meta = readDigaoMeta(dataDir)
  if (meta === null) return null
  const generatedAt = text(meta.generatedAt)
  const segments = Number.isInteger(meta.segments) ? meta.segments : null
  const digest = text(meta.digest)
  if (generatedAt === '') return null
  const parts = [generatedAt]
  if (segments !== null) parts.push(`${segments} 段`)
  if (digest !== '') parts.push(`digest=${digest}`)
  const lines = readDigaoMarkdown(dataDir).split(/\r?\n/u)
  const recentStart = lines.findIndex((line) => line.trim() === `## ${DIGAO_SECTIONS[0].title}`)
  const pastStart = lines.findIndex((line, index) => index > recentStart && line.trim() === `## ${DIGAO_SECTIONS[1].title}`)
  const recent = recentStart < 0 || pastStart < 0 ? '' : lines.slice(recentStart + 1, pastStart).join('\n').trim()
  return `底稿 ${parts.join(' · ')}\n${recent === ''
    ? '最近正文不可得（尚未生成、正文读不出来或仍是旧版结构）'
    : clip(recent, RECENT_MATERIAL_LIMIT)}`
}

/**
 * 拼给模型的素材（**纯函数**，可逐字断言）。
 *
 * @param {{date: string, content?: {yi?: string, ji?: string, liuri?: string}, base?: string|null, recent?: string|null}} input
 * @returns {string}
 */
export function aiNotePrompt({ date, content, base, recent }) {
  return [
    `日期：${date}`,
    `今日宜：${text(content?.yi) || '（未给）'}`,
    `今日忌：${text(content?.ji) || '（未给）'}`,
    `流日：${text(content?.liuri) || '（未给）'}`,
    `底座谱（我是谁）：${text(base) || '（还没有底座谱）'}`,
    `底稿最近：${text(recent) || '（还没有底稿）'}`,
  ].join('\n')
}

/**
 * 把产物里的 `ai` 字段收敛成三态（读面用：坏形状不当成功，也不让界面拿到 undefined 之谜）。
 * @param {unknown} value
 * @returns {{mode: 'ok', text: string}|{mode: 'off'}|{mode: 'failed', reason: string}|undefined}
 */
export function normalizeAiNote(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (value.mode === 'ok') {
    const body = text(value.text)
    return body === '' ? undefined : { mode: 'ok', text: body }
  }
  if (value.mode === 'off') return { mode: 'off' }
  if (value.mode === 'failed') return { mode: 'failed', reason: text(value.reason) || 'AI 段生成失败（没有给理由）' }
  return undefined
}

/**
 * 生成 AI 段（**绝不抛**；不自旋、不重试 —— 下一次日课刷新更诚实）。
 *
 * @param {{ctx: object, dataDir: string, date: string, content: {yi: string, ji: string, liuri: string}, enabled?: boolean}} input
 * @returns {Promise<{mode: 'ok', text: string}|{mode: 'off'}|{mode: 'failed', reason: string}>}
 */
export async function composeAiNote({ ctx, dataDir, date, content, enabled = true }) {
  // 关闭是**显式选择**，不是失败：连 ctx.llm 都不碰（否则关闭也照样付一次调用的代价）。
  if (enabled === false) return { mode: 'off' }

  const llm = getService(ctx, 'llm')
  if (!llm || typeof llm.stream !== 'function') {
    return { mode: 'failed', reason: 'ctx.llm 不可得（宿主没装 LLM 服务）' }
  }

  try {
    const streamed = await streamText(llm, {
      system: AI_NOTE_SYSTEM,
      prompt: aiNotePrompt({
        date,
        content,
        base: readBaseSummary(dataDir),
        recent: readRecentDigao(dataDir),
      }),
    })
    if (!streamed.ok) return { mode: 'failed', reason: streamed.reason }
    const collapsed = streamed.text.replace(/\s+/gu, ' ').trim()
    if (collapsed === '') return { mode: 'failed', reason: 'LLM 返回了空文本' }
    return { mode: 'ok', text: clip(collapsed, AI_NOTE_LIMIT) }
  } catch (error) {
    // `streamText` 自己已经兜了一层；这里再兜一层，保证「AI 段失败」永远不会变成「今天没有日课」。
    return { mode: 'failed', reason: `AI 段生成时抛了异常（已兜住）：${String(error?.message ?? error)}` }
  }
}
