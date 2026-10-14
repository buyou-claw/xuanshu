/**
 * tests/consult/lib/bestof-llm.mjs — 票 11 断言台的**假 `ctx.llm`**：按剧本回放真实的 chunk 序列。
 *
 * 为什么不是「返回一段文本的假对象」：`ctx.llm.stream()` 的契约是
 * **7 分支 chunk 序列 + 唯一终止 `finish`**（`.scratch/notes/dsh-api-facts.md` E.3，
 * 证据 `dsh-llm/lib/types/types.d.ts:417-447`）。合参的采集、工具调用解析、usage 累计
 * 全都在这一层上，替身必须逐条发同形状的 chunk，否则「打桩绿了、真机红」。
 *
 * 剧本（`plan`）三选一：
 *   - `{ text: '…' }`：发文本块（默认切成 3 段 delta，模拟流式）；
 *   - `{ tool: { name, arguments } }`：发一个工具调用块（`arguments` 是**未解析的 JSON 字符串**，
 *     与 `'tool/call'.arguments` 同形）；
 *   - `{ text, tool, usage, finish }`：组合；`finish` 缺省 `{kind:'stop'}`。
 * 剧本可给函数 `(options, index) => plan`，按调用次序/入参决定这一路答什么。
 */

/** 一次调用的 usage（**打桩值**，绝不当实测值用；见 E.3 的字段表）。 */
export const STUB_USAGE = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 }

/** 文本块的 chunk 序列（切成 `pieces` 段 delta，模拟流式）。 */
export function textChunks(text, { index = 0, pieces = 3 } = {}) {
  const chunks = [{ type: 'block-start', index, blockType: 'text' }]
  const size = Math.max(1, Math.ceil(text.length / pieces))
  for (let offset = 0; offset < text.length; offset += size) {
    chunks.push({ type: 'text-delta', index, text: text.slice(offset, offset + size) })
  }
  chunks.push({ type: 'block-end', index, block: { type: 'text', text } })
  return chunks
}

/** 工具调用块的 chunk 序列（`argumentsDelta` 同样是**原始 JSON 字符串**）。 */
export function toolChunks({ id = 'call-1', name, arguments: args }, { index = 0 } = {}) {
  return [
    { type: 'block-start', index, blockType: 'tool-call' },
    { type: 'tool-call-delta', index, id, name, argumentsDelta: args },
    { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: args } },
  ]
}

/** 剧本 → chunk 序列。 */
export function planChunks(plan = {}) {
  const chunks = []
  let index = 0
  if (typeof plan.text === 'string' && plan.text !== '') {
    chunks.push(...textChunks(plan.text, { index, pieces: plan.pieces }))
    index += 1
  }
  if (plan.tool !== undefined) {
    chunks.push(...toolChunks(plan.tool, { index }))
    index += 1
  }
  if (plan.usage !== null) chunks.push({ type: 'usage', usage: plan.usage ?? STUB_USAGE })
  chunks.push({ type: 'finish', reason: plan.finish ?? { kind: 'stop' } })
  return chunks
}

/** 一个会抛的流（模拟 adapter 抛错被 `stream()` 归一成 error finish 之外的情形）。 */
async function* drain(chunks, { delayMs = 0, holdMs = 0 } = {}) {
  // `delay` 让「完成顺序」与「路由顺序」不同——回落口径就是按完成顺序排前。
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
  for (const chunk of chunks) {
    // `hold` = 正文已经吐完、但这一路还没结束（模拟「人看着流式按了停止全部」）。
    if (chunk.type === 'finish' && holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs))
    yield chunk
  }
}

/**
 * 造一个假 `ctx.llm`。
 * @param {Array<object|Function>|Function} plans 每次 `stream()` 的剧本（越界时重复最后一份）
 * @returns {{service: object, calls: object[]}}
 */
export function fakeLlm(plans = [{}]) {
  const calls = []
  const list = Array.isArray(plans) ? plans : [plans]
  return {
    calls,
    service: {
      listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
      listModels: async (provider) => [{ provider, id: 'deepseek-chat', name: 'DeepSeek Chat' }],
      stream(options) {
        const index = calls.length
        calls.push(options)
        const plan = typeof list[0] === 'function'
          ? list[0](options, index)
          : (list[index] ?? list[list.length - 1])
        return drain(planChunks(plan), { delayMs: plan.delay ?? 0, holdMs: plan.hold ?? 0 })
      },
    },
  }
}

/** 假 `ctx.agentDefaultModel`：合参缺省路由（provider/model）的来源。 */
export function fakeBestofModel(selection = { provider: 'deepseek', model: 'deepseek-chat' }) {
  return { service: { currentSelection: () => ({ ...selection }) } }
}
