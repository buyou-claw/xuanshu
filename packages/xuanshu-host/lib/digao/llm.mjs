/**
 * packages/xuanshu-host/lib/digao/llm.mjs — 底稿的**唯一** LLM 用途：把多段压成一段精简汇总（契约 §1）。
 *
 * 契约把边界写得很死：**LLM 只做「把多段压成一段精简汇总」这一步，骨架与来源标记不经过 LLM**。
 * 所以这里只产出一段文本，产出后由 `skeleton.mjs` 放进 `## 摘要` 节；失败一律回落
 * `{ok:false, reason}`，调用方据此标 `digest:'skeleton'`（契约 §4：降级必须可观察）。
 *
 * 形状出处（本机实装 0.2.0-rc.2，只读核对）：
 *   - `ctx.llm.listProviders(): LlmProviderInfo[]`：`dsh-llm/lib/types/index.d.ts:272`；
 *   - `ctx.llm.listModels(provider): Promise<LlmModelInfo[]>`：同文件 `:350`；
 *   - `ctx.llm.stream(options): AsyncIterable<StreamChunk>`：同文件 `:412`；
 *   - `GenerateOptions.messages: RequestMessage[]`，其中 `RequestUserInput = { role:'user', content, id?:never, source?:never }`
 *     ——类型注释原文「a hand-built one-shot may include identity-free user inputs」
 *     （`dsh-llm/lib/types/types.d.ts:468-475,489-501`），所以这里手搓一条**无身份**的 user 输入即可；
 *   - `StreamChunk` 的文本增量为 `{ type:'text-delta', index, text }`（同文件 `:421-424`）。
 *
 * 2026-10-17（#24）起，「挑路由 + 跑一次文本流」抽到 `lib/llm/text.mjs`：日课的 AI 段要的是
 * 同一件事（只差 system 与素材），两处各抄一份正是本仓库记过的漂移来源。本文件只剩「底稿的素材
 * 怎么拼 + 失败怎么标」这一层业务。
 */

import { streamText } from '../llm/text.mjs'
import { getService } from '../soft-service.mjs'

/** 摘要的长度上限（底稿是精简汇总；截断而不是超长占用）。 */
const DIGEST_LIMIT = 600

/** 精简汇总的提示词：只让它压缩，不让它发挥（输出直接进人读的底稿）。 */
export const DIGEST_SYSTEM = '你是玄枢的底稿压缩器。把用户给的若干段自述压成一段中文精简汇总，'
  + '只保留事实与人称一致的信息，不要新增、不要推测、不要分点、不要标题，长度不超过 200 字。'

/** 拼给模型的素材：每段带来源标记（与正文同一套标记，便于模型知道哪句来自哪里）。 */
export function digestPrompt(segments) {
  return segments.map((segment) => `【来源：${segment.source} ${segment.name}】\n${segment.text}`).join('\n\n')
}

/**
 * 调 LLM 压一段。
 *
 * **绝不抛**：`ctx.llm` 不在场 / 没路由 / 流里报错 / 返回空文本 —— 全都折算成 `{ok:false, reason}`，
 * 由调用方标 `digest:'skeleton'`（契约 §4）。这里**不自旋、不重试**（底稿每天有一次定时刷新，
 * 重试留给下一次刷新更诚实）。
 *
 * @param {object} ctx 宿主上下文
 * @param {{segments: object[]}} input 已摊平的段（`{source,name,text}`）
 * @returns {Promise<{ok: boolean, text: string, reason: string|null, route?: object}>}
 */
export async function condenseWithLlm(ctx, { segments }) {
  const llm = getService(ctx, 'llm')
  if (!llm || typeof llm.stream !== 'function') return { ok: false, text: '', reason: 'ctx.llm 不可得（宿主没装 LLM 服务）' }
  if (!Array.isArray(segments) || segments.length === 0) return { ok: false, text: '', reason: '没有可压缩的段' }

  const streamed = await streamText(llm, { system: DIGEST_SYSTEM, prompt: digestPrompt(segments) })
  if (!streamed.ok) {
    return { ok: false, text: '', reason: streamed.reason, ...(streamed.route === undefined ? {} : { route: streamed.route }) }
  }

  const collapsed = streamed.text.replace(/\s+/g, ' ').trim()
  if (collapsed === '') return { ok: false, text: '', reason: 'LLM 返回了空文本', route: streamed.route }
  return { ok: true, text: collapsed.length > DIGEST_LIMIT ? `${collapsed.slice(0, DIGEST_LIMIT)}…` : collapsed, reason: null, route: streamed.route }
}
