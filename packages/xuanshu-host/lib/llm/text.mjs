/**
 * packages/xuanshu-host/lib/llm/text.mjs — 宿主侧**一次性文本流**的唯一实现（底稿摘要 / 日课 AI 段共用）。
 *
 * 为什么抽出来：`digao/llm.mjs` 与 `rikke/ai-note.mjs` 要的是同一件事 —— 挑一条 provider/model
 * 路由、手搓一条无身份 user 输入、把 `text-delta` 拼起来、**绝不抛**。本仓库吃过「同一段判据
 * 抄六份然后漂移」的亏（`pruneStale` 的旧账），所以这里只留一份，两个用途只差 `system` 与素材。
 *
 * API 出处（本机实装 0.2.0-rc.2，只读核对；`digao/llm.mjs` 头部记了完整证据行）：
 *   - `ctx.llm.listProviders()` / `listModels(provider)` / `stream(options)`；
 *   - `GenerateOptions.messages` 里的 `RequestUserInput` 允许**无身份** user 输入；
 *   - `StreamChunk` 的文本增量是 `{type:'text-delta', index, text}`，错误块是 `{type:'error', ...}`。
 */

/**
 * 从一个 LLM 服务里挑首个可用的 provider/model；挑不出 → null。
 * @param {object} llm
 * @returns {Promise<{provider: string, model: string}|null>}
 */
export async function pickRoute(llm) {
  if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') return null
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
 * 跑一次文本流（**绝不抛**；不自旋、不重试）。
 *
 * @param {object} llm `ctx.llm`（需要 `stream`）
 * @param {{system: string, prompt: string}} input
 * @returns {Promise<{ok: true, text: string, reason: null, route: object}
 *          |{ok: false, text: '', reason: string, route?: object}>} `text` 是**未压缩**的原文
 */
export async function streamText(llm, { system, prompt }) {
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
      if (chunk?.type === 'error') {
        /**
         * 2026-11-02 改：原来写的是 `String(chunk.error ?? chunk.message ?? '未知')`。
         *
         * `chunk.error` 在真机上是**对象**（`{message, code}`），`String({…})` 得到
         * `[object Object]` —— 于是不管真实原因是 401、超时还是没配额，用户和日志看到的
         * 都是「LLM 流报错：[object Object]」。写 `ai.probe` 单测时被这条逮住的。
         */
        const detail = chunk.error ?? chunk.message ?? '未知'
        const text = typeof detail === 'string'
          ? detail
          : (detail?.message ?? detail?.code ?? describeValue(detail))
        return { ok: false, text: '', reason: `LLM 流报错：${text}`, route }
      }
    }
  } catch (error) {
    return { ok: false, text: '', reason: `LLM 调用失败：${String(error?.message ?? error)}`, route }
  }
  /**
   * 2026-11-02 加：**流正常结束但一个字都没有**，不算成功。
   *
   * 实测出来的：把 key 换成一个假的（`sk-deadbeef-…`），「试一下能不能用」照样报
   * 「通了 … 回的是「（空）」」—— 因为 provider 没抛错、也没吐 error 块，只是什么文本都没给。
   *
   * 这个判定影响两处：
   *   - 探测按钮会把「假 key」报成「通了」，比不报更糟；
   *   - 底稿的 `condenseWithLlm` 会把空摘要当成 `ok`，于是 `digest:'llm'` 但摘要节是空的。
   *
   * 空输出就是没拿到东西，如实说。
   */
  if (collected.trim() === '') {
    return {
      ok: false,
      text: '',
      reason: 'LLM 这次流正常结束，但一个字都没有返回（空文本；通常是凭证无效、额度用尽，或模型把内容全放进了非文本块）',
      route,
    }
  }
  return { ok: true, text: collected, reason: null, route }
}

/**
 * 把不认识的值变成一句能看的话（对象走 JSON，别落到 `[object Object]`）。
 * @param {unknown} value
 * @returns {string}
 */
function describeValue(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
