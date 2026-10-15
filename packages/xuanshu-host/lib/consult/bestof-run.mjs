/**
 * packages/xuanshu-host/lib/consult/bestof-run.mjs — 多 AI 合参的「跑」：N 路并行流 + judge + 合并槽。
 *
 * 三条硬约束决定了本模块的形状：
 *
 * 1. **候选流不带工具**（票面 + S9 §9 C10/D23：「候选只回答、不执行动作」）——
 *    候选的 `GenerateOptions.tools` 是空；只有 judge 槽带那一个 `submit_judgement`。
 * 2. **judge 没有结构化输出可用**（ADR-0010）：rc.2 的 `GenerateOptions` 没有
 *    `response_format`/`json_schema`（`dsh-llm/lib/types/types.d.ts:489-531`），所以判定走
 *    「让模型调一个单字段工具 → `arguments` 是模型产出的原始 JSON 字符串 → 自己校验」；
 *    校验失败或没调工具 → **回落完成顺序第一份**（回落是规格的一部分，不是异常处理）。
 * 3. **chunk 序列是 7 分支 + 唯一终止 `finish`**（`.scratch/notes/dsh-api-facts.md` E.3，
 *    证据 `dsh-llm/lib/types/types.d.ts:417-447`）。这里自己收（`collectStream()`），
 *    **不 import `@deepseek-ai/dsh-llm/assembler`**：断言台跑在仓库检出里、profile 那棵树不可解析，
 *    静态 import 会让整组用例 import 失败（与票 10 `message.mjs` 的取舍同款）。
 *    `tests/consult/bestof-assembler.test.mjs` 在 profile 装好时把同一串 chunk 同时喂给
 *    官方 `BlockAssembler` 与这里，钉住「两条路产出同一份文本 / usage / finish」。
 */

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛；与包内其它模块同款）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/** 取 llm 服务；缺了给可读错误（调用方已经过能力门，这里是第二道保险）。 */
function requireLlm(ctx) {
  const llm = softGet(ctx, 'llm')
  if (typeof llm?.stream !== 'function') throw new Error('宿主没有可用的 LLM 服务（ctx.llm）：合参发不出去。')
  return llm
}

/** judge 工具的唯一名字（ADR-0010：单字段工具）。 */
export const JUDGE_TOOL_NAME = 'submit_judgement'

/**
 * 首版两个视角（S9 §2.1：经典 + 审慎）。
 *
 * 视角以「首条 system 消息末尾追加 directive」的方式注入（S9 §5 步骤 4）。
 * 文案是玄枢自己的（上游 `ROLE_ANGLES` 的原文不在本仓库、离线不可得），所以这里
 * **只说清视角取向**，不假装逐字照抄上游。
 */
export const BESTOF_ANGLES = [
  {
    id: 'classic',
    name: '经典派',
    directive: '先给结论，再给依据链；覆盖问题的主要面向，保持推理自洽。',
  },
  {
    id: 'cautious',
    name: '审慎派',
    directive: '先核对前提与边界条件，指出不确定处与风险；结论可以保守，但要给出可验证的判据。',
  },
]

/** 缺省视角（首版 2 路）。 */
export const DEFAULT_ANGLE_IDS = ['classic', 'cautious']

/** 候选流的系统词（不带工具、不替用户拍板）。 */
export const CANDIDATE_SYSTEM = '你是玄枢多 AI 合参的一路候选。只回答问题本身，不要执行任何动作、不要读写文件。'
/** judge 的系统词：只排序 + 工具/JSON 两条出口（ADR-0010 的首选与降级路径）。 */
export const JUDGE_SYSTEM = [
  '你是玄枢多 AI 合参的判官。只看问题与候选答案，按「依据充分、自洽 > 覆盖充分 > 表达清楚」排序。',
  '你只排序，不替用户做决定。',
  `首选做法：调用工具 ${JUDGE_TOOL_NAME}，参数形如 {"judgement":{"best":"<候选 id>","ranking":["<id>",…],"reasons":{"<id>":"≤40 字理由"}}}。`,
  '若不能调用工具，就直接输出同一结构的 JSON 对象：不要 Markdown 围栏、不要多余文字。',
].join('\n')
/** 合并槽的系统词（S9 §5 步骤 8 的总编语义）。 */
export const MERGE_SYSTEM = [
  '你是玄枢多 AI 合参的终稿总编。',
  '以排序靠前的那一份为主干，吸收其他候选里有依据的补充；去重；矛盾处以有依据者为准并注明。',
  '绝不新增候选里没有的事实。只输出合并后的正文。',
].join('\n')

/** 视角定义；认不出的 id 直接抛（宁可当场说不行，也不静默少一路）。 */
export function resolveAngles(ids) {
  if (ids === undefined || ids === null) return DEFAULT_ANGLE_IDS.map((id) => angleOf(id))
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('视角列表（angles）必须是非空字符串数组。')
  const seen = new Set()
  return ids.map((id) => {
    const angle = angleOf(id)
    if (seen.has(angle.id)) throw new Error(`视角重复：${angle.id}`)
    seen.add(angle.id)
    return angle
  })
}

function angleOf(id) {
  const angle = BESTOF_ANGLES.find((entry) => entry.id === id)
  if (angle === undefined) throw new Error(`未知视角：${JSON.stringify(id)}（首版只有 ${BESTOF_ANGLES.map((entry) => entry.id).join(' / ')}）。`)
  return angle
}

/** judge 工具 schema（单字段 `judgement`；契约与 ADR-0010 都只认这一个字段）。 */
export function judgeToolSchema() {
  return {
    name: JUDGE_TOOL_NAME,
    description: '提交本次合参的判定：只排序，不替用户做决定。',
    parameters: {
      type: 'object',
      properties: {
        judgement: {
          type: 'object',
          description: '判定载荷',
          properties: {
            best: { type: 'string', description: '排序第一的候选 id' },
            ranking: { type: 'array', items: { type: 'string' }, description: '候选 id，从好到差' },
            reasons: { type: 'object', description: '每个候选一句 ≤40 字理由（键是候选 id）' },
          },
          required: ['best', 'ranking'],
        },
      },
      required: ['judgement'],
      additionalProperties: false,
    },
  }
}

/**
 * 收一路 chunk 序列（照 `StreamChunk` 的 7 分支，逐分支处理）。
 *
 * @param {AsyncIterable<object>} chunks `ctx.llm.stream()` 的返回
 * @param {{onText?: (text: string) => void}} [hooks] `onText` 每次文本增量后给一次**累计文本**
 *        （界面靠轮询 `bestof.state` 看流式回填，宿主就靠这个钩子把半成品写进记录）
 * @returns {Promise<{text: string, reasoning: string, toolCalls: object[], usage: object|undefined, finish: object}>}
 */
export async function collectStream(chunks, { onText } = {}) {
  const texts = new Map()
  const reasonings = new Map()
  const toolCalls = new Map()
  let usage
  let finish = { kind: 'stop' }

  for await (const chunk of chunks) {
    switch (chunk?.type) {
      case 'block-start':
        break
      case 'text-delta': {
        const next = `${texts.get(chunk.index) ?? ''}${chunk.text ?? ''}`
        texts.set(chunk.index, next)
        onText?.(joinBlocks(texts))
        break
      }
      case 'reasoning-delta':
        reasonings.set(chunk.index, `${reasonings.get(chunk.index) ?? ''}${chunk.text ?? ''}`)
        break
      case 'tool-call-delta': {
        const current = toolCalls.get(chunk.index) ?? { id: chunk.id, name: chunk.name, arguments: '' }
        if (chunk.id !== undefined) current.id = chunk.id
        if (chunk.name !== undefined) current.name = chunk.name
        current.arguments = `${current.arguments ?? ''}${chunk.argumentsDelta ?? ''}`
        toolCalls.set(chunk.index, current)
        break
      }
      case 'block-end': {
        const block = chunk.block
        if (block?.type === 'text') texts.set(chunk.index, block.text ?? '')
        if (block?.type === 'reasoning') reasonings.set(chunk.index, block.text ?? '')
        if (block?.type === 'tool-call') toolCalls.set(chunk.index, { id: block.id, name: block.name, arguments: block.arguments ?? '' })
        break
      }
      case 'usage':
        usage = chunk.usage
        break
      case 'finish':
        finish = chunk.reason ?? { kind: 'stop' }
        break
      default:
        // 未知 chunk：前向兼容地忽略（契约里 chunk 是判别联合，多出来的分支不该炸掉整路）。
        break
    }
  }

  return {
    text: joinBlocks(texts).trim(),
    reasoning: [...reasonings.keys()].sort((a, b) => a - b).map((key) => reasonings.get(key)).join(''),
    toolCalls: [...toolCalls.keys()].sort((a, b) => a - b).map((key) => toolCalls.get(key)).filter((call) => call?.name !== undefined),
    usage,
    finish,
  }
}

/** 按块序拼文本（块序 = index，不是到达序）。 */
function joinBlocks(texts) {
  const keys = [...texts.keys()].sort((a, b) => a - b)
  return keys.map((key) => texts.get(key)).join('')
}

/** 失败 finish（error / aborted）→ 可读原因；**读 `failure.code`，不读 message 文本**（E.3 的要点）。 */
export function failureOf(finish) {
  if (finish?.kind === 'error' || finish?.kind === 'aborted') {
    return `调用失败（${finish.kind}${finish.failure?.code ? `：${finish.failure.code}` : ''}）`
  }
  return undefined
}

/**
 * 跑一路候选（一次 `stream()` + 采集）。异常一律折算成 `{ok:false, error}`，
 * 让「某一路失败」不拖垮整次合参（S9 §6 的部分失败态）。
 *
 * `context` 是这场问事的上下文（底座谱 + 底稿 + 勾选谱 + 挂载；由调用方用**与
 * `consult.send` 同一份装配**读出来，见 `inject.mjs`）。为什么必须带上：
 * 候选流是直接调 `ctx.llm.stream()`、**不走会话历史**，而用户在这一场问事里问的常常是
 * 「结合我的信息」——不带这一段，候选只能凭问题本身答，答出来的东西与这场问事无关。
 * 判官与合并槽**不带**（H4：判官只看问题与候选，免得把上下文当判据）。
 *
 * `now` 是**可注入的时钟**（缺省 `Date.now`）：`elapsedMs` 是「这次调用花了多久」的**唯一**证据，
 * 而拿 `Date.now()` 差值写的断言恒 ≥ 0、永远不会红 —— 断言台要能证否，就得让耗时可控。
 * 调用方（`bestof.mjs`）把 `config.now` 透传进来，测试注入一个每次 +250ms 的计数时钟。
 */
export async function runCandidate(ctx, { route, angle, question, context, signal, onText, now = Date.now }) {
  const started = now()
  // 上下文与问题合成**一条** user 消息：候选流没有会话历史，分开成连续两条 user 消息
  // 在部分 provider 上会被拒（同角色连发），而它们本来就是「一份材料 + 一个问题」。
  const prompt = typeof context === 'string' && context.trim() !== ''
    ? `${context.trimEnd()}\n\n【本次合参的问题】\n${question}`
    : question
  try {
    const result = await collectStream(
      requireLlm(ctx).stream({
        provider: route.provider,
        model: route.model,
        system: `${CANDIDATE_SYSTEM}\n【本候选视角】${angle.name}：${angle.directive}`,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        tools: [],
        signal,
      }),
      { onText },
    )
    const failure = failureOf(result.finish)
    if (failure !== undefined) return { ok: false, error: failure, usage: result.usage, elapsedMs: now() - started }
    if (result.text === '') return { ok: false, error: '这一路没有产出任何文本。', usage: result.usage, elapsedMs: now() - started }
    return { ok: true, text: result.text, usage: result.usage, elapsedMs: now() - started }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error), elapsedMs: now() - started }
  }
}

/**
 * 从 judge 的一次返回里取判定（工具调用优先，正文 JSON 是降级路径）。
 *
 * **三种来源，三种说法**（ADR-0010：`mode` 记录的是**这次判定到底怎么来的**）：
 *   - `'tool'` —— 模型真的调了 `submit_judgement`；
 *   - `'prompt-json'` —— 没调工具，但正文里有可解析的 JSON（ADR-0010 的降级路径）；
 *   - `'failed'` —— **既没调工具、正文也没有 JSON**：这次判定**没有来源**。
 * 第三个档曾经报成 `'tool'`（`raw` 为空、`error` 写着「既没有调用…」），那是在记录里说一件
 * 没发生的事 —— 与「打桩值不许写成实测值」同一条硬线。`'failed'` 本来就在客户端的联合类型里
 * （`packages/xuanshu-client/src/client/bestof-api.ts:38`），所以不需要动接口面。
 *
 * @returns {{mode: 'tool'|'prompt-json'|'failed', raw?: string, error?: string}}
 */
export function extractJudgementPayload(result) {
  const call = result.toolCalls?.find((entry) => entry.name === JUDGE_TOOL_NAME) ?? result.toolCalls?.[0]
  if (call !== undefined) return { mode: 'tool', raw: call.arguments ?? '' }
  const json = extractJsonObject(result.text ?? '')
  if (json === undefined) {
    return { mode: 'failed', error: '模型既没有调用 submit_judgement，正文里也没有可解析的 JSON 对象（这次判定没有来源，不按 tool 记）。' }
  }
  return { mode: 'prompt-json', raw: json }
}

/** 从正文里抠一个 JSON 对象：允许 ```json 围栏，其余原样。 */
export function extractJsonObject(text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return undefined
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(trimmed)
  const body = (fenced === null ? trimmed : fenced[1]).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  return body.slice(start, end + 1)
}

/**
 * 校验判定载荷（ADR-0010 第 2 条：解析 + 逐字段校验，任何一步失败都要回落）。
 * @returns {{ok: true, best: string, ranking: string[], reasons: object} | {ok: false, error: string}}
 */
export function validateJudgement(parsed, ids) {
  const judgement = parsed?.judgement
  if (judgement === null || typeof judgement !== 'object' || Array.isArray(judgement)) {
    return { ok: false, error: '判定载荷缺 judgement 对象（ADR-0010 的单字段工具口径）。' }
  }
  const known = new Set(ids)
  const ranking = judgement.ranking
  if (!Array.isArray(ranking) || ranking.length === 0) return { ok: false, error: 'judgement.ranking 必须是非空数组。' }
  const seen = new Set()
  for (const id of ranking) {
    if (typeof id !== 'string' || !known.has(id)) return { ok: false, error: `judgement.ranking 里有未知候选 id：${JSON.stringify(id)}。` }
    if (seen.has(id)) return { ok: false, error: `judgement.ranking 里有重复候选 id：${id}。` }
    seen.add(id)
  }
  if (typeof judgement.best !== 'string' || !known.has(judgement.best)) {
    return { ok: false, error: `judgement.best 不是有效候选 id：${JSON.stringify(judgement.best)}。` }
  }
  if (!seen.has(judgement.best)) return { ok: false, error: 'judgement.best 必须出现在 ranking 里。' }
  const reasons = {}
  if (judgement.reasons !== undefined && judgement.reasons !== null) {
    if (typeof judgement.reasons !== 'object' || Array.isArray(judgement.reasons)) return { ok: false, error: 'judgement.reasons 必须是对象。' }
    for (const [id, reason] of Object.entries(judgement.reasons)) {
      if (typeof reason === 'string' && reason !== '') reasons[id] = reason
    }
  }
  return { ok: true, best: judgement.best, ranking: [...ranking], reasons }
}

/**
 * 判官结果 → `judge` 段。
 *
 * 回落口径（ADR-0010 第 2 条 + S9 §5 步骤 6）：**完成顺序**（不是路由顺序）第一份排前，
 * 并把失败原因写进 `judge.error`；`mode` 记的是**这次尝试用的路子**（tool / prompt-json）。
 * 判官失败**不自动采用**：`judge.adoptedId` 只是「判官眼里排第一」，采用仍由人点（C9）。
 */
export function judgeFrom(result, completionOrder) {
  const ids = [...completionOrder]
  const fallback = {
    // 这个 `mode` 是**兜底默认**，下面四条返回路径无一例外用 `payload.mode` 覆盖它
    // （工具 / 正文 JSON / 没有来源 三种来源都要如实记）。缺省取最诚实的那个值：
    // 「判官不可用」不是一次工具调用。
    mode: 'failed',
    adoptedId: ids[0] ?? null,
    ranking: ids,
    error: '判官不可用，已按完成顺序排前。',
  }
  const payload = extractJudgementPayload(result)
  if (payload.error !== undefined) return { ...fallback, mode: payload.mode, error: payload.error }
  let parsed
  try {
    parsed = JSON.parse(payload.raw)
  } catch (error) {
    return { ...fallback, mode: payload.mode, error: `判定参数不是合法 JSON：${String(error?.message ?? error)}` }
  }
  const checked = validateJudgement(parsed, ids)
  if (checked.ok !== true) return { ...fallback, mode: payload.mode, error: checked.error }
  return {
    mode: payload.mode,
    adoptedId: checked.best,
    ranking: checked.ranking,
    reasons: checked.reasons,
    error: undefined,
  }
}

/** 从 usage 与价表算钱；任一项缺失 → undefined（**不编一个 0 当费用**）。 */
export function costUsdOf(usage, price) {
  if (usage === undefined || usage === null || price === undefined || price === null) return undefined
  const input = Number.isFinite(usage.inputTokens) ? usage.inputTokens : undefined
  const output = Number.isFinite(usage.outputTokens) ? usage.outputTokens : undefined
  if (input === undefined || output === undefined) return undefined
  const inRate = Number.isFinite(price.inputPerMTok) ? price.inputPerMTok : undefined
  const outRate = Number.isFinite(price.outputPerMTok) ? price.outputPerMTok : undefined
  if (inRate === undefined || outRate === undefined) return undefined
  return (input / 1_000_000) * inRate + (output / 1_000_000) * outRate
}

/** 价表键：`<provider>/<model>`；没有这张表时一切 `costUsd` 都是 undefined（界面显示「费用未知」）。 */
export function priceFor(prices, route) {
  if (prices === undefined || prices === null) return undefined
  return prices[`${route.provider}/${route.model}`]
}

/** 合并槽：一次不带工具的 stream（总编语义）。失败/空正文 → 抛可读错误（不许静默采用一份空的）。 */
export async function mergeCandidates(ctx, { route, question, candidates, signal }) {
  const body = candidates
    .map((candidate, index) => `【候选 ${candidate.id} · 第 ${index + 1} 位】\n${candidate.text}`)
    .join('\n\n')
  const result = await collectStream(
    requireLlm(ctx).stream({
      provider: route.provider,
      model: route.model,
      system: MERGE_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: `问题：${question}\n\n${body}` }] }],
      tools: [],
      signal,
    }),
  )
  const failure = failureOf(result.finish)
  if (failure !== undefined) throw new Error(`合并调用失败：${failure}`)
  if (result.text === '') throw new Error('合并稿为空：换一份采用，或稍后重试。')
  return { text: result.text, usage: result.usage }
}
