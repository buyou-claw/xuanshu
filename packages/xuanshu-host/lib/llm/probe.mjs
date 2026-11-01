/**
 * packages/xuanshu-host/lib/llm/probe.mjs —— 「试一下 AI 到底能不能用」。
 *
 * 为什么要有这个：整条链路（DSH 的模型页 + 玄枢的 AI 状态）都只看**配置清单** ——
 * 「provider 注册了没、key 配了没、默认模型指向哪」。**没有一处真的发过一次请求。**
 *
 * 代价是实测过的：界面说「AI 配置齐了」，真去创建谱时 AI 一句话都不回；
 * 排查花了三个小时，最后发现是 `401 Invalid credential`（key 无效）。
 * 如果当时有个「试一下」，30 秒就能看出来。
 *
 * 这里只做一件事：发一句最短的话，如实报告三件事 ——
 * 走的哪条路由、耗时多少、失败的话原因是什么。
 */

import { streamText } from './text.mjs'
import { getService } from '../soft-service.mjs'

/** 探测用的最短提示词：只要能换回几个字，就说明这条路由活着。 */
const PROBE_SYSTEM = '你是一个连通性检查器。只回四个字，不要解释。'
const PROBE_PROMPT = '请回：连通正常'

/** 结果里的正文最多带这么多字（用户只需要看到「有东西回来」）。 */
const REPLY_LIMIT = 120

/**
 * 造 `ai.probe` 方法。
 * @param {object} ctx 宿主上下文
 * @returns {Record<string, Function>} RPC 方法表
 */
export function createAiProbeMethods(ctx) {
  return {
    /**
     * 真发一次最小请求。
     *
     * **绝不抛**：`ctx.llm` 不在场 / 没路由 / 流里报错，全都折算成 `{ok:false, reason}`——
     * 这个方法的用处就是「如实报告」，抛出去反而丢掉原因。
     *
     * @returns {Promise<{ok: boolean, route?: {provider: string, model: string}, ms: number, reply?: string, reason?: string}>}
     */
    'ai.probe': async () => {
      const started = Date.now()
      const llm = getService(ctx, 'llm')
      if (!llm || typeof llm.stream !== 'function') {
        return { ok: false, ms: Date.now() - started, reason: '宿主没有装 LLM 服务（ctx.llm 不可得），所以连试都试不了。' }
      }
      const result = await streamText(llm, { system: PROBE_SYSTEM, prompt: PROBE_PROMPT })
      const ms = Date.now() - started
      if (result.ok !== true) {
        return {
          ok: false,
          ms,
          ...(result.route === undefined ? {} : { route: result.route }),
          reason: result.reason,
        }
      }
      return {
        ok: true,
        ms,
        ...(result.route === undefined ? {} : { route: result.route }),
        reply: String(result.text ?? '').trim().slice(0, REPLY_LIMIT),
      }
    },
  }
}
