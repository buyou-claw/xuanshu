/**
 * packages/xuanshu-host/lib/consult/agent.mjs — 把问事会话接上 agent（preset 组合 + 模型选择）。
 *
 * **为什么不能只写 `ctx.agents.create({ sessionId, meta: { cwd } })`**（两条实的证据，不是猜测）：
 *
 *   1. **没有 provider/model 就开不了口**：`dsh-agent-loop/lib/index.js:1185` 在第一轮请求前
 *      直接抛 `agent "…" has no provider/model: set AgentOptions.provider and AgentOptions.model
 *      or supply both via the agent/request waterfall`。provider/model 只有两个来源：`agentOptions`，
 *      或 `agent/request` waterfall（由 `installModelSelection` 装）。裸 create 两者都没有。
 *   2. **工具不是「装配了就都在」**：`standard` preset 声明的行（`tool-pwsh` / `tool-fs` /
 *      `tool-skill` / `skill-filesystem` …，见 `dsh-web-app/presets/standard.patch.yml`）只在
 *      **preset 挂载出来的 scope** 里激活；`dsh-web-app/cordis.patch.yml:558` 的注释明说 preset
 *      面的 gate「读声明行 id，而不看 `disabled`」—— 也就是这些行在宿主平面上并不生效。
 *      票 10 的验收第 3 条要的「DSH 全套工具能力（读文件、调工具）」就落在这里。
 *
 * **照着第一方先例做**（两处都是「插件自己拥有一个会话」的官方写法）：
 *   - `dsh-webhook/lib/index.js:154-174`：`agentPresets.resolve(...)` → `meta.agentPreset` →
 *     `agentOptions` → `setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, preset.id) }`；
 *   - `dsh-api-session-controller/lib/index.js:358-371,449-458`：同款（`composeAgent` + `create`）。
 * 缺省 preset 由 registry 的 `config.default` 决定（web 层是 `standard`）：`resolve()` 不带参数即取它。
 *
 * **为什么 `agentPreset` 写进 `meta` 不算「拿它当标签」（ADR-0009 第 6 条禁的是后者）**：
 * 这里是它的**真语义** —— 写进会话 header 后，resume 才能认回同一个 preset（`presets.resolve(id)`）；
 * 不写它，进程重启后接回来的是一个 preset 不匹配的会话（`assertPresetUnchanged` 那一类冲突的前身）。
 * 我们**不**用 `meta` 存问事的 `pus` / `mounts`（那些在旁挂清单里，见 store.mjs）。
 *
 * **软降级**：`agentPresets` / `agentDefaultModel` 任一不在场（裁剪过的 profile、断言台）时，
 * 退回契约 §4 字面的裸 create —— 会话仍建得出来，只是没有 preset 与模型（那是 profile 本身的缺口，
 * 由装配报告与 S2/S3 探针去报，不该让 `consult.create` 抛在用户面前）。
 */

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/**
 * 当前默认模型选择（provider/model/reasoningEffort）。
 *
 * 与 `dsh-api-session-controller` 的 `agentOptions()` 同源：`ctx.agentDefaultModel.currentSelection()`
 * （`dsh-agent-default-model/lib/types/index.d.ts:40-42`）。服务不在场或选择不完整 → undefined
 * （**不编一个假的 provider**：编出来的路由只会把失败推迟到第一轮请求）。
 */
export function defaultModelSelection(ctx) {
  const service = softGet(ctx, 'agentDefaultModel')
  const selection = typeof service?.currentSelection === 'function' ? service.currentSelection() : undefined
  if (selection === null || typeof selection !== 'object') return undefined
  if (typeof selection.provider !== 'string' || selection.provider === '') return undefined
  if (typeof selection.model !== 'string' || selection.model === '') return undefined
  return {
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
  }
}

/**
 * 组合一个 preset：resolve（缺省 = registry 的 `default`）+ 一个把它挂进 agent scope 的 `setup`。
 * @param {object} ctx 宿主 ctx
 * @param {string} [requested] 指定 preset id（resume 时用会话里存的那个）；缺省用 registry 默认
 * @returns {Promise<{id: string, setup: (agentCtx: object, agent: object) => Promise<void>} | undefined>}
 *          没有 registry / preset 无 id → undefined（调用方退回裸 create）
 */
export async function composeAgentPreset(ctx, requested) {
  const presets = softGet(ctx, 'agentPresets')
  if (typeof presets?.resolve !== 'function' || typeof presets?.mount !== 'function') return undefined
  const preset = await presets.resolve(requested)
  const id = preset?.id
  if (typeof id !== 'string' || id === '') return undefined
  return {
    id,
    // `mount()` 的契约是「绑定一个尚未发布的 Agent」（registry types:79-84），
    // 所以它只能在 create/resume 的 `setup` 里调，不能在 create 之前调。
    setup: async (agentCtx) => {
      await presets.mount(agentCtx, id)
    },
  }
}

/** 装配一次的公共参数（preset + 模型选择）；两者都缺时返回 `{}`，调用方就是契约 §4 的裸 create。 */
async function compositionOptions(ctx, requested) {
  let preset
  try {
    preset = await composeAgentPreset(ctx, requested)
  } catch (error) {
    throw new Error(`组合 agent preset 失败：${String(error?.message ?? error)}（问事会话的工具与提示都来自 preset，缺了它这一场问事开不起来）。`)
  }
  const agentOptions = defaultModelSelection(ctx)
  return {
    ...(preset === undefined ? {} : { setup: preset.setup }),
    ...(agentOptions === undefined ? {} : { agentOptions }),
    agentPreset: preset?.id,
  }
}

/**
 * 这个宿主现在能不能组合出「跑得了一轮」的问事会话。
 *
 * 缺 `agentPresets` → 没有工具（preset 行只在挂载出来的 scope 里激活）；
 * 缺 `agentDefaultModel`（或它的选择不完整）→ 第一轮请求前就抛 `has no provider/model`
 * （`dsh-agent-loop/lib/index.js:1185`）。
 *
 * 用途：`consult.send` 拿它做**发问前的门**。不装这道门的症状是「RPC 回了 accepted:true，
 * 用户等了半天什么都没发生」—— 与票 08「缺经纬度禁止出盘」「确认闸拦下不落盘」同一条纪律：
 * 宁可当场说不行，也不许假装成了。
 *
 * @returns {{ok: boolean, missing: string[], detail: string}}
 */
export function consultAgentCapability(ctx) {
  const missing = []
  if (typeof softGet(ctx, 'agentPresets')?.mount !== 'function') missing.push('agentPresets')
  if (defaultModelSelection(ctx) === undefined) missing.push('agentDefaultModel')
  if (missing.length === 0) return { ok: true, missing, detail: '' }
  return {
    ok: false,
    missing,
    detail: `宿主缺少 ${missing.join('、')} 服务：问事会话的工具（agent preset）与模型（provider/model）都来自它们，缺了就跑不了一轮。`
      + '修复路径：确认 profile 装配里这两行在（web 层由 @deepseek-ai/dsh-web-app 的 preset 名册提供 default: standard），'
      + '用 `dsh --profile xuanshu --dump-config` 或 /xuanshu-report 核对装配报告。',
  }
}

/**
 * 建一个能跑的问事会话（`ctx.agents.create`）。
 * @param {object} ctx 宿主 ctx（调用方已确认 `ctx.agents.create` 可用）
 * @param {{sessionId: string, cwd: string}} options
 * @returns {Promise<{agent: object, dispose?: Function}>} `ctx.agents.create()` 的句柄
 */
export async function createConsultAgent(ctx, { sessionId, cwd }) {
  const agents = softGet(ctx, 'agents')
  if (typeof agents?.create !== 'function') {
    throw new Error('DSH agent 服务（ctx.agents）不可得：建不出能跑的会话（工具能力来自 agent preset）。')
  }
  const { setup, agentOptions, agentPreset } = await compositionOptions(ctx)
  return agents.create({
    sessionId,
    meta: { cwd, ...(agentPreset === undefined ? {} : { agentPreset }) },
    ...(agentOptions === undefined ? {} : { agentOptions }),
    ...(setup === undefined ? {} : { setup }),
  })
}

/**
 * 接回一个已存在的问事会话（进程重启后 `consult.send` 走这里）。
 *
 * preset 优先取**会话自己存的**那一个（header 的 `agentPreset`，通过 `ctx.sessionQuery.readSession()`
 * 读；那是创建时写进 header 的真值），读不到或已失效才退回 registry 默认 ——
 * 否则进程重启后会把一个 `minimal` 会话按 `standard` 重新组合。
 * @returns {Promise<{agent: object, dispose?: Function}>}
 */
export async function resumeConsultAgent(ctx, { sessionId }) {
  const agents = softGet(ctx, 'agents')
  if (typeof agents?.resume !== 'function') {
    throw new Error('DSH agent 服务（ctx.agents）不可得或不能 resume：接不回这个会话。')
  }
  const stored = await storedAgentPreset(ctx, sessionId)
  let composition
  try {
    composition = await compositionOptions(ctx, stored)
  } catch (error) {
    if (stored === undefined) throw error
    // 存的 preset 已经不在名册里（被删/改名）：退回缺省，而不是让这次问事彻底打不开。
    composition = await compositionOptions(ctx)
  }
  return agents.resume({
    resumeSessionId: sessionId,
    ...(composition.agentOptions === undefined ? {} : { agentOptions: composition.agentOptions }),
    ...(composition.setup === undefined ? {} : { setup: composition.setup }),
  })
}

/** 读会话 header 里存的 preset id（读不出来就 undefined —— 由调用方退回缺省）。 */
async function storedAgentPreset(ctx, sessionId) {
  const query = softGet(ctx, 'sessionQuery')
  if (typeof query?.readSession !== 'function') return undefined
  try {
    const snapshot = await query.readSession(sessionId)
    const preset = snapshot?.session?.agentPreset
    return typeof preset === 'string' && preset !== '' ? preset : undefined
  } catch {
    return undefined
  }
}
