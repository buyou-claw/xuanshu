/**
 * packages/xuanshu-host/lib/consult/routes.mjs — 只读路由清单（票 28 的 `routes.list`）。
 *
 * 这张清单回答三件事，**只读**：哪几家 provider 已注册、每家有哪些模型、每家 key 配没配；
 * 外加默认路由与「可配置但还没注册」的家。玄枢不写 provider 配置与密钥 —— 那是
 * DSH「设置 → 模型」页的职责（票面验收最后一条）。
 *
 * 数据来源（钉版 `0.2.0-rc.2`，实装核对）：
 *   - `ctx.llm.listProviders(): LlmProviderInfo[]` —— **只有已注册**路由
 *     （`dsh-llm/lib/index.js:1896-1898`，类型 `lib/types/index.d.ts:272`）；
 *   - `ctx.llm.listModels(provider): Promise<LlmModelInfo[]>` —— async，catalog 是 advisory
 *     （`lib/types/index.d.ts:350`，`types.d.ts:303-315`）；
 *   - `ctx.llm.listConfigurableProviders(): LlmConfigurableProvider[]` —— 含**未注册**但可配置的家
 *     （`lib/index.js:1958`，`types.d.ts:224-247`）；
 *   - 默认路由 = `ctx.agentDefaultModel.currentSelection()`（`consult/agent.mjs` 的同一来源）；
 *   - key 是否配置 = `settings.describe({redactSecrets:true})` 取该家的 `settingsPath` 走到
 *     `apiKeyEnv`，再 `credentials.describe(ref).configured` —— 与上游
 *     `dsh-api-session-controller/lib/index.js:573-588` 的 `hasProviderApiKey` 同一范式。
 *
 * **三态而不是两态**：`settings` / `credentials` 任一不在场（裁剪过的 profile、断言台），
 * 或者这家没有 `apiKeyEnv` 可查（登录型）时，`keyConfigured = 'unknown'`。
 * 把「读不到」写成 `false` 会被用户读成「这家没配」，那是编造。
 */

/** 清单 schema（票 28 冻结；#29 消费同一份形状）。 */
export const ROUTES_SCHEMA = 'xuanshu/routes@1'

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/** 读 `agentDefaultModel.currentSelection()`；读不到 → null（不编一个默认 provider）。 */
function defaultRouteOf(ctx) {
  const service = softGet(ctx, 'agentDefaultModel')
  const selection = typeof service?.currentSelection === 'function' ? service.currentSelection() : undefined
  if (selection === null || typeof selection !== 'object') return null
  if (typeof selection.provider !== 'string' || selection.provider === '') return null
  if (typeof selection.model !== 'string' || selection.model === '') return null
  return { provider: selection.provider, model: selection.model }
}

/** 读 settings 的命名空间快照；服务缺席或抛错 → null（= key 未知）。 */
function describeNamespaces(ctx) {
  const settings = softGet(ctx, 'settings')
  if (typeof settings?.describe !== 'function') return null
  try {
    const namespaces = settings.describe({ redactSecrets: true })
    return Array.isArray(namespaces) ? namespaces : null
  } catch {
    return null
  }
}

/** 沿 `settingsPath` 走到该 provider 的 profile 对象（空路径 = 整个命名空间就是 profile）。 */
function profileOf(namespaces, entry) {
  if (namespaces === null || entry === undefined) return undefined
  let profile = namespaces.find((namespace) => namespace?.ns === entry.settingsNs)?.value
  for (const key of Array.isArray(entry.settingsPath) ? entry.settingsPath : []) {
    profile = typeof profile === 'object' && profile !== null ? Reflect.get(profile, key) : undefined
  }
  return typeof profile === 'object' && profile !== null ? profile : undefined
}

/**
 * 这一家的 key 到底配没配：`true` / `false` / `'unknown'`。
 *
 * 只有「读得到 `apiKeyEnv` 且 `credentials.describe()` 明确回了一个布尔」时才给布尔值；
 * 其余一律 unknown（读不到 ≠ 没配）。
 */
async function keyConfiguredOf(ctx, entry, namespaces) {
  const credentials = softGet(ctx, 'credentials')
  if (namespaces === null || typeof credentials?.describe !== 'function') return 'unknown'
  // 目录里没有这家（例如登录型的 `deepseek-account`）：没有 `apiKeyEnv` 可查，如实未知。
  if (entry === undefined) return 'unknown'
  const profile = profileOf(namespaces, entry)
  if (profile === undefined) return 'unknown'
  const ref = Reflect.get(profile, 'apiKeyEnv')
  if (typeof ref !== 'string' || ref === '') return 'unknown'
  try {
    const described = await credentials.describe(ref)
    if (described?.configured === true) return true
    if (described?.configured === false) return false
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 列一家已注册 provider 的模型；失败记进 failures 并标 `modelsKnown:false`。 */
async function modelsOf(llm, provider, failures) {
  try {
    const models = await llm.listModels(provider)
    return {
      modelsKnown: true,
      models: (Array.isArray(models) ? models : []).filter((model) => typeof model?.id === 'string' && model.id !== ''),
    }
  } catch (error) {
    failures.push({ provider, reason: String(error?.message ?? error) })
    return { modelsKnown: false, models: [] }
  }
}

/**
 * 组装路由清单（**唯一实现**；`routes.list` 与将来的 #29 状态面共用）。
 *
 * @param {object} ctx cordis 宿主上下文
 * @returns {Promise<object>} 冻结形状见文件头与 `.scratch/notes/spec002/t28-multiprovider-bestof.md`
 */
export async function listRoutes(ctx) {
  const defaultRoute = defaultRouteOf(ctx)
  const llm = softGet(ctx, 'llm')
  const empty = {
    schema: ROUTES_SCHEMA,
    ok: false,
    reason: '宿主没有可用的 LLM 服务（ctx.llm）：路由清单读不到。',
    default: null,
    providers: [],
    configurable: [],
    failures: [],
  }
  if (typeof llm?.listProviders !== 'function' || typeof llm?.listModels !== 'function') return empty

  let registered
  try {
    registered = llm.listProviders()
  } catch (error) {
    return { ...empty, reason: `读不到 provider 列表：${String(error?.message ?? error)}` }
  }
  registered = Array.isArray(registered) ? registered : []

  let configurableEntries = []
  if (typeof llm.listConfigurableProviders === 'function') {
    try {
      const entries = llm.listConfigurableProviders()
      configurableEntries = Array.isArray(entries) ? entries : []
    } catch {
      // 可配置目录读不到不影响已注册路由的清单 —— 只是「没配过的家」那一栏空着。
      configurableEntries = []
    }
  }

  const namespaces = describeNamespaces(ctx)
  const failures = []
  const providers = []
  for (const entry of registered) {
    const id = typeof entry?.id === 'string' ? entry.id : ''
    if (id === '') continue
    const configurable = configurableEntries.find((candidate) => candidate?.provider === id)
    const { modelsKnown, models } = await modelsOf(llm, id, failures)
    providers.push({
      id,
      name: typeof entry?.name === 'string' && entry.name !== '' ? entry.name : (configurable?.displayName ?? null),
      registered: true,
      keyConfigured: await keyConfiguredOf(ctx, configurable, namespaces),
      isDefault: defaultRoute?.provider === id,
      modelsKnown,
      models: models.map((model) => ({
        id: model.id,
        name: typeof model.name === 'string' && model.name !== '' ? model.name : null,
        isDefault: defaultRoute?.provider === id && defaultRoute?.model === model.id,
      })),
    })
  }

  const registeredIds = new Set(providers.map((provider) => provider.id))
  const configurable = []
  for (const entry of configurableEntries) {
    const id = typeof entry?.provider === 'string' ? entry.provider : ''
    if (id === '' || registeredIds.has(id)) continue
    configurable.push({
      id,
      name: typeof entry?.displayName === 'string' && entry.displayName !== '' ? entry.displayName : null,
      keyConfigured: await keyConfiguredOf(ctx, entry, namespaces),
    })
  }

  return {
    schema: ROUTES_SCHEMA,
    ok: true,
    default: defaultRoute,
    providers,
    configurable,
    failures,
  }
}

/** `routes.list` 方法组（与其它组一起并进同一条 `/xuanshu`）。 */
export function createRouteMethods(ctx) {
  return {
    'routes.list': async () => listRoutes(ctx),
  }
}
