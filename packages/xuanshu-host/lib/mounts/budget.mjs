/**
 * packages/xuanshu-host/lib/mounts/budget.mjs — 挂载预算 M 的**单一来源**（契约 §2；S8 §5 步骤 3）。
 *
 * 预算做什么：注入前按它决定「这次挂进来多少字」。它必须是**一个数**，而且**不许编**：
 * rc.2 的 `maxTokens` 是采样参数、不是上下文窗口（事实笔记 §3），而设计稿 S8 §6 error③
 * 明确要求「预算换算拿不到模型窗口 → 状态栏写『预算未知』，**不假装有预算**」。
 * 所以取值顺序是：**配置覆盖 → 模型窗口实算 → `null`（未知）**，`source` 一路带着来源，
 * 界面据此显示「预算未知」。S9 的候选截断护栏吃同一个函数 —— 两张票不许各算一遍。
 *
 * 探到窗口后的换算（玄枢 v1 的**保守**口径，两个常量都导出、可被 S9 复用与调参）：
 *   `budget(字) = floor(contextWindow(令牌) × 挂载占窗口比例 × 每令牌字数)`
 * 1.5 字/令牌是混排中英的保守估计（CJK ≈ 1 字/令牌，英文 ≈ 4 字符/令牌）；
 * 0.25 是因为挂载只占窗口的一部分（同一窗口还要放底座谱 / 底稿 / 勾选谱 / 对话历史 / 回答）。
 *
 * 证据（本机只读核对，`.dsh-home/profiles/xuanshu/node_modules/@deepseek-ai/`）：
 *   - `dsh-agent-default-model/lib/types/index.d.ts:40-42` `currentSelection()` → `{provider, model, reasoningEffort?}`
 *     （票 10 的 `consult/agent.mjs:42-58` 已在用同一条，读法一致）；
 *   - `dsh-llm/lib/types/types.d.ts`（`LlmModelContext`）：「Provider-owned context capacity for one
 *     exact provider/model route. Maximum combined request and response context in **tokens**」；
 *   - `dsh-llm/lib/types/index.d.ts:360` `resolveModelInfo(provider, model, signal?)`
 *     → `LlmResolvedModelInfo`，其中 `context?: LlmModelContext`（**可选**：未知就是没有这个键）。
 */

/** 挂载占模型窗口的比例（保守：同一窗口还要放谱 / 底稿 / 历史 / 回答）。 */
export const MOUNT_BUDGET_WINDOW_SHARE = 0.25

/** 每令牌折合多少字（混排中英的保守估计：CJK ≈ 1 字/令牌，英文 ≈ 4 字符/令牌）。 */
export const MOUNT_BUDGET_CHARS_PER_TOKEN = 1.5

/** 宿主上下文里本模块用到的两小块（**照本包既有约定走 `ctx.get(name, false)`**，拿不到就 undefined）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/**
 * 探测当前默认模型的上下文窗口（令牌）。拿不到就 `undefined` —— **不猜、不回落成一个默认窗口**。
 *
 * @param {object} ctx - cordis 宿主上下文（裸 `{}` 也要活）。
 * @returns {Promise<{contextWindow: number, provider: string, model: string} | undefined>}
 */
export async function probeModelContext(ctx) {
  const selection = softGet(ctx, 'agentDefaultModel')
  const current = typeof selection?.currentSelection === 'function' ? selection.currentSelection() : undefined
  if (current === null || typeof current !== 'object') return undefined
  const provider = typeof current.provider === 'string' && current.provider !== '' ? current.provider : undefined
  const model = typeof current.model === 'string' && current.model !== '' ? current.model : undefined
  if (provider === undefined || model === undefined) return undefined

  const llm = softGet(ctx, 'llm')
  if (typeof llm?.resolveModelInfo !== 'function') return undefined
  let info
  try {
    info = await llm.resolveModelInfo(provider, model)
  } catch {
    // 探测失败 ≠ 预算为 0：拿不到就说不知道（下面的 null 分支会如实报告）。
    return undefined
  }
  const window = info?.context?.contextWindow
  if (!Number.isFinite(window) || window <= 0) return undefined
  return { contextWindow: Math.floor(window), provider, model }
}

/**
 * 解析挂载预算。
 *
 * @param {object} ctx - cordis 宿主上下文。
 * @param {{mountBudget?: number}} [config] - 运维 / 测试覆盖（第一优先；`0` / 负数 / 非数一律忽略）。
 * @returns {Promise<{budget: number|null, source: 'config'|'model-window'|'unknown', detail?: string}>}
 *   `budget: null` 是**合法结果**（界面显示「预算未知」），不是错误。
 */
export async function resolveMountBudget(ctx, config = {}) {
  const override = config?.mountBudget
  if (Number.isFinite(override) && override > 0) {
    return { budget: Math.floor(override), source: 'config' }
  }
  const probed = await probeModelContext(ctx)
  if (probed !== undefined) {
    const budget = Math.floor(probed.contextWindow * MOUNT_BUDGET_WINDOW_SHARE * MOUNT_BUDGET_CHARS_PER_TOKEN)
    if (budget > 0) {
      return {
        budget,
        source: 'model-window',
        detail: `${probed.provider}/${probed.model} 窗口 ${probed.contextWindow} 令牌 × ${MOUNT_BUDGET_WINDOW_SHARE} × ${MOUNT_BUDGET_CHARS_PER_TOKEN} 字/令牌`,
      }
    }
  }
  return {
    budget: null,
    source: 'unknown',
    detail: '拿不到当前模型的上下文窗口（rc.2 的采样参数 maxTokens 不是窗口；agentDefaultModel/llm.resolveModelInfo 任一不在场也一样）——按「预算未知」处理，不编一个数。',
  }
}
