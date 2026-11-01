/**
 * 票 29 · 「接上 AI」的状态面（客户端纯派生 + 只读轮询控制器）。
 *
 * ## 这份文件回答什么
 *
 * 冷启动第二步要一句话说清：**现在能不能问事**。数据只有一份来源 —— 票 28 的 `routes.list`
 * （宿主 `packages/xuanshu-host/lib/consult/routes.mjs`，形状 `xuanshu/routes@1`）。
 * 这里**不重新探测** provider / 模型 / key，只把那张只读清单投影成界面要的四件事：
 * `configured / providers / defaultModel / reason`。
 *
 * ## 三态而不是两态（票面验收第 1、5 条）
 *
 * - `configured: true` = 已接上；
 * - `configured: false` = 读到了清单、但问事真的开不了口（原因见 `reason`）；
 * - `configured: 'unknown'` = **这次读不到**（RPC 不可用 / 旧宿主没有这个方法 / 形状对不上）。
 *   `'unknown'` 不许写成 `false` —— 那会被读成「你没配」，是编造。同理 `keyConfigured: 'unknown'`
 *   （登录型 provider、设置服务不在场）在界面上一律显示「未知」，不冒充「没配」。
 *
 * ## 精确判据（实现与测试共用同一句话）
 *
 * ```
 * usable(p) := p.registered === true
 *              && p.keyConfigured !== false     // 'unknown' 不挡（但界面必须写明未知）
 *              && p.modelsKnown === true
 *              && p.models.length > 0
 * configured := 清单读不到            → 'unknown'
 *              default === null      → false      // 见下：问事开不了口
 *              usable 中找不到 default.provider → false
 *              找得到                → true
 * ```
 *
 * **为什么还要默认模型**：`consult.send` 的宿主门是 `consultAgentCapability()`
 * （`packages/xuanshu-host/lib/consult/agent.mjs:113-127`）——它要求
 * `agentDefaultModel.currentSelection()` 给出 provider/model，否则第一轮请求前就抛
 * `has no provider/model`。所以「有可用 provider」只是必要条件；默认模型落在可用 provider 上，
 * 才是问事真能开口的充要条件。缺默认模型时报 `no-default-model`，而不是把入口点亮后
 * 让用户撞上一句宿主报错。
 *
 * ## 只读纪律（票面验收第 4 条）
 *
 * 这份文件**没有任何写路径**：不写 provider 配置、不写密钥、不调 `settings`/`credentials` 的写方法。
 * 唯一的 I/O 是 `AiApi.routes()`（即 `routes.list`），由 `createAiReadinessController` 轮询。
 */

/**
 * 「设置 → 模型」的逐字路径（界面只读这一个常量；票面验收要求「说明去向」）。
 * 依据：模型段 id 就是 `models`（`dsh-client-ui-settings-models/lib/client.js:4057-4061`）。
 */
export const AI_SETTINGS_PATH = '设置 → 模型'

/** DSH 设置里「模型」段的 section id（`openSection(id)` 用的那个字符串）。 */
export const AI_SETTINGS_SECTION = 'models'

/** 未接上时的轮询间隔：5s。只在「门禁可见且未接上」时跑，配好后立即停（票面验收第 3 条）。 */
export const AI_POLL_MS = 5000

/** `routes.list` 的 schema（票 28 冻结）。形状对不上按「未知」处理，不瞎猜。 */
export const ROUTES_SCHEMA = 'xuanshu/routes@1'

/** 三态「接没接上」：`'unknown'` = 这次读不到，绝不是「没配」。 */
export type AiConfigured = boolean | 'unknown'

/** provider 行（界面逐家显示 key 三态与模型数量）。 */
export interface AiProviderLine {
  id: string
  name: string | null
  registered: boolean
  /** 三态：`true` 已配 / `false` 缺 key / `'unknown'` 读不到。 */
  keyConfigured: boolean | 'unknown'
  /** `false` = 这家列模型失败；此时 `models` 为空**不代表**没有模型。 */
  modelsKnown: boolean
  modelCount: number
  models: Array<{ id: string; name: string | null }>
  /** 这家是不是默认模型所在的那家：`true` / `false` / `null`（默认路由读不到 = 未知）。 */
  isDefaultProvider: boolean | null
  /** 按上面的 `usable()` 判据算出来的可用性（唯一给它赋值的地方）。 */
  usable: boolean
}

/** 状态码：`ready*` = 已接上；其余 = 未接上；`unavailable` = 读不到（未知）。 */
export type AiReasonCode =
  | 'ready'
  | 'ready-key-unknown'
  | 'no-provider'
  | 'no-model'
  | 'models-unreadable'
  | 'missing-key'
  | 'no-default-model'
  | 'default-provider-missing'
  | 'unavailable'

/** 一句原因 + 下一步（每个状态都有下一步；界面逐字取用）。 */
export interface AiReason {
  code: AiReasonCode
  text: string
  next: string
}

/**
 * 状态面（票面验收第一条的四个键都在：`configured / providers / defaultModel / reason`）。
 *
 * `known: false` 与 `configured: 'unknown'` 永远同时出现 —— 给调用方一个不用再判三态的布尔。
 */
export interface AiReadiness {
  configured: AiConfigured
  known: boolean
  providers: AiProviderLine[]
  defaultModel: { provider: string; model: string } | null
  reason: AiReason
  /** 读不到时的原文（RPC 错误信息 / 宿主 `ok:false` 的 reason）；读得到时不出现。 */
  detail?: string
  /** 这次检测的时刻（ISO；由调用方给时钟，测试可复现）。 */
  checkedAt: string
}

/** `routes.list` 里我们真正消费的字段（不 import 宿主，保持纯函数可在 Node 里跑）。 */
interface CatalogLike {
  schema?: unknown
  ok?: unknown
  reason?: unknown
  default?: unknown
  providers?: unknown
}

/** 非严格读一个字符串。 */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** 逐字路径 + 下一步的共同尾巴。 */
const NEXT_TO_SETTINGS = `打开 DSH「${AI_SETTINGS_PATH}」添加 / 选择。`

/**
 * 把一家 provider 投影成界面行（`usable` 是唯一判据，别处不许再算一遍）。
 * `defaultProvider === null` = 默认路由**读不到**：`isDefaultProvider` 留 `null`，不写成 `false`。
 */
function providerLine(entry: Record<string, unknown>, defaultProvider: string | null | undefined): AiProviderLine {
  const keyConfigured = entry.keyConfigured === true || entry.keyConfigured === false ? entry.keyConfigured : 'unknown'
  const modelsKnown = entry.modelsKnown === true
  const models = Array.isArray(entry.models)
    ? entry.models
        .filter((model): model is Record<string, unknown> => typeof model === 'object' && model !== null)
        .filter((model) => textOf(model.id) !== undefined)
        .map((model) => ({ id: model.id as string, name: textOf(model.name) ?? null }))
    : []
  const id = textOf(entry.id) ?? ''
  return {
    id,
    name: textOf(entry.name) ?? null,
    registered: entry.registered === true,
    keyConfigured,
    modelsKnown,
    modelCount: models.length,
    models,
    isDefaultProvider: defaultProvider === null || defaultProvider === undefined ? null : defaultProvider === id,
    usable: entry.registered === true && keyConfigured !== false && modelsKnown && models.length > 0,
  }
}

/** 默认路由（形状不对 → null，绝不编一个）。 */
function defaultOf(value: unknown): { provider: string; model: string } | null {
  if (typeof value !== 'object' || value === null) return null
  const provider = textOf(Reflect.get(value, 'provider'))
  const model = textOf(Reflect.get(value, 'model'))
  return provider === undefined || model === undefined ? null : { provider, model }
}

/** 读不到时的统一状态（`reason.text` 必须带「读不到」与「不等于没配」两句）。 */
function unavailable(detail: string | undefined, checkedAt: string): AiReadiness {
  return {
    configured: 'unknown',
    known: false,
    providers: [],
    defaultModel: null,
    reason: {
      code: 'unavailable',
      text: '读不到 AI 状态（路由清单服务不可用）—— 这不等于「没配」。',
      next: '点「重试」再检测一次；仍然读不到就去「设置 → 模型」看看。',
    },
    ...(detail === undefined ? {} : { detail }),
    checkedAt,
  }
}

/**
 * 把 `routes.list` 的回答投影成状态面。
 *
 * @param catalog - `routes.list` 的响应；`undefined` / `null` = 这次没读到。
 * @param options - `now` 只为可复现的 `checkedAt`，`detail` 为读不到时的原文。
 * @returns 状态面（`configured / providers / defaultModel / reason` 恒在）。
 */
export function deriveAiReadiness(
  catalog: CatalogLike | null | undefined,
  options: { now?: string; detail?: string } = {},
): AiReadiness {
  const checkedAt = options.now ?? new Date().toISOString()
  if (catalog === null || catalog === undefined) return unavailable(options.detail, checkedAt)
  if (catalog.ok !== true) {
    return unavailable(textOf(catalog.reason) ?? options.detail, checkedAt)
  }
  // 形状对不上（旧宿主 / 未来的 schema）：按「未知」处理，不把缺字段读成「没配」。
  if (catalog.schema !== ROUTES_SCHEMA || !Array.isArray(catalog.providers)) {
    return unavailable(options.detail ?? `路由清单形状不符（期望 ${ROUTES_SCHEMA}）。`, checkedAt)
  }

  const defaultModel = defaultOf(catalog.default)
  const providers = catalog.providers
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => providerLine(entry, defaultModel?.provider))
    .filter((line) => line.id !== '')

  const base = {
    providers,
    defaultModel,
    // providers 是逐家的「事实上有什么」；configured 另算（见文件头判据）。
    checkedAt,
  }
  const usable = providers.filter((line) => line.usable)

  // ① 有默认模型，且它落在可用的那家上 → 配置齐了。
  /*
   * 2026-11-02 改：原来这里判成 "已接上"，界面上就写「已接上 AI · 可以问事了」。
   * 但这条判定**只是看路由清单**（有没有这家 provider、密钥状态、默认模型指向哪）——
   * 从来不发一次真请求。实测遇到过：界面说「已接上」，真去提炼时 AI 一句话都没回。
   * 说「已接上」等于替用户担保了一次它没做过的验证。改成「配置齐了」，并明说没试过调用。
   */
  if (defaultModel !== null) {
    const backed = usable.find((line) => line.id === defaultModel.provider)
    if (backed !== undefined) {
      const keyUnknown = backed.keyConfigured === 'unknown'
      return {
        configured: true,
        known: true,
        ...base,
        reason: {
          code: keyUnknown ? 'ready-key-unknown' : 'ready',
          text: keyUnknown
            ? `配置齐了：${backed.name ?? backed.id} · ${defaultModel.model}，密钥状态读不到（设置服务没回应）：先按可用处理，真发不出去时会有报错。`
            : `配置齐了：${backed.name ?? backed.id} · ${defaultModel.model}。这是看清单得出的，没有真发一次请求试通；发不出去时会在用的地方告诉你。`,
          next: keyUnknown ? `若问事失败，去「${AI_SETTINGS_PATH}」核对密钥。` : '可以问事了。',
        },
      }
    }
  }

  // ② 未接上：按「离能跑还差哪一步」给最具体的那条原因。
  const reason = missingReason(providers, defaultModel)
  return { configured: false, known: true, ...base, reason }
}

/* ───────────────────── 只读轮询控制器（票面「无需重启」的那一半） ───────────────────── */

/** 控制器只依赖这一个方法（`routes.list`）；写方法在类型上就不存在。 */
export interface AiApiLike {
  routes(signal?: AbortSignal): Promise<CatalogLike>
}

/** 控制器快照：`readiness` 缺席 = 还没出结果（界面显示「检测中」）。 */
export interface AiReadinessSnapshot {
  readiness?: AiReadiness
  checking: boolean
}

/** 窗口 focus 的最小形状（Node 里没有 window；测试传假件）。 */
export interface AiFocusTarget {
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

/** 「接上 AI」的只读轮询控制器（`ai-views.tsx` 的 hook 与断言台共用）。 */
export interface AiReadinessController {
  snapshot(): AiReadinessSnapshot
  subscribe(listener: () => void): () => void
  /** 消费者挂载：`0 → 1` 时挂 focus 监听并武装定时器；返回释放函数（引用计数）。 */
  start(): () => void
  /** 取一次 `routes.list`（人工重试 = 直接调它；乱序回包用序号丢弃）。 */
  refresh(): Promise<void>
  /** 彻底停：定时器、focus 监听、订阅者全清（组件树整体卸载时用）。 */
  dispose(): void
}

/**
 * 造一个只读轮询控制器。
 *
 * **什么时候问**：有消费者（panel 在屏）**且**状态不是 `configured === true`。
 * 配好后定时器立刻停；窗口聚焦与人工重试仍可再问一次（人可能刚在设置里改了东西）。
 *
 * @param options - 数据面、轮询间隔、focus 目标与时钟（后三者给测试注入）。
 * @returns 控制器（唯一 I/O 是 `options.api.routes()`）。
 */
export function createAiReadinessController(options: {
  api: AiApiLike
  pollMs?: number
  /** `undefined` = 自动取 `window`（Node 里没有 → 不挂）；`null` = 明确不挂。 */
  focus?: AiFocusTarget | null
  now?: () => string
}): AiReadinessController {
  const pollMs = options.pollMs ?? AI_POLL_MS
  const now = options.now ?? (() => new Date().toISOString())
  const focus = options.focus === undefined
    ? (typeof globalThis.window === 'undefined' ? undefined : (globalThis.window as unknown as AiFocusTarget))
    : (options.focus ?? undefined)

  let snapshot: AiReadinessSnapshot = { checking: false }
  let consumers = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let listening = false
  let disposed = false
  let sequence = 0
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of [...listeners]) listener()
  }
  const assign = (next: AiReadinessSnapshot): void => {
    snapshot = next
    emit()
  }

  /** 只在「有人看 + 没接上」时武装；结果一变就重算，配好即停。 */
  const syncTimer = (): void => {
    const shouldPoll = !disposed && consumers > 0 && snapshot.readiness?.configured !== true
    if (shouldPoll && timer === undefined) {
      timer = setInterval(() => {
        void refresh()
      }, pollMs)
    } else if (!shouldPoll && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  const refresh = async (): Promise<void> => {
    if (disposed) return
    const mine = ++sequence
    assign({ ...snapshot, checking: true })
    try {
      const catalog = await options.api.routes()
      if (disposed || mine !== sequence) return // 乱序回包：先发后到的不许覆盖新答案
      assign({ readiness: deriveAiReadiness(catalog, { now: now() }), checking: false })
    } catch (error) {
      if (disposed || mine !== sequence) return
      const detail = error instanceof Error ? error.message : String(error)
      assign({ readiness: deriveAiReadiness(undefined, { now: now(), detail }), checking: false })
    }
    syncTimer()
  }

  const onFocus = (): void => {
    void refresh()
  }

  const listen = (): void => {
    if (listening || disposed) return
    if (typeof focus?.addEventListener !== 'function') return
    focus.addEventListener('focus', onFocus)
    listening = true
  }
  const unlisten = (): void => {
    if (!listening) return
    if (typeof focus?.removeEventListener === 'function') focus.removeEventListener('focus', onFocus)
    listening = false
  }

  return {
    snapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start: () => {
      if (disposed) return () => {}
      consumers += 1
      if (consumers === 1) listen()
      syncTimer()
      let released = false
      return () => {
        if (released) return
        released = true
        consumers = Math.max(0, consumers - 1)
        if (consumers === 0) unlisten()
        syncTimer()
      }
    },
    refresh,
    dispose: () => {
      disposed = true
      consumers = 0
      unlisten()
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
      listeners.clear()
    },
  }
}

/** 未接上时的原因判定（顺序即优先级；每条都带下一步）。 */
function missingReason(
  providers: AiProviderLine[],
  defaultModel: { provider: string; model: string } | null,
): AiReason {
  if (providers.length === 0) {
    return {
      code: 'no-provider',
      text: '还没有可用的 AI provider（宿主没有注册任何一家）。',
      next: NEXT_TO_SETTINGS,
    }
  }
  if (defaultModel === null) {
    return {
      code: 'no-default-model',
      text: '有已注册的 provider，但还没有默认模型 —— 问事会因此开不了口。',
      next: `打开 DSH「${AI_SETTINGS_PATH}」选一个默认模型。`,
    }
  }
  const target = providers.find((line) => line.id === defaultModel.provider)
  if (target === undefined) {
    return {
      code: 'default-provider-missing',
      text: `默认模型指向 ${defaultModel.provider}，但它不在已注册的 provider 里。`,
      next: `打开 DSH「${AI_SETTINGS_PATH}」重新选一个默认模型。`,
    }
  }
  if (target.keyConfigured === false) {
    return {
      code: 'missing-key',
      text: `${target.name ?? target.id} 已有模型，但这个提供商没有配置密钥（key）。`,
      next: `打开 DSH「${AI_SETTINGS_PATH}」给 ${target.name ?? target.id} 填上密钥。`,
    }
  }
  if (!target.modelsKnown) {
    return {
      code: 'models-unreadable',
      text: `${target.name ?? target.id} 已注册，但读不到它的模型清单 —— 这不等于「没有模型」。`,
      next: '点「重新检测」再试一次；仍然读不到就去「设置 → 模型」核对。',
    }
  }
  if (target.modelCount === 0) {
    return {
      code: 'no-model',
      text: `${target.name ?? target.id} 已注册，但模型清单里还没有可用的模型。`,
      next: `打开 DSH「${AI_SETTINGS_PATH}」给这个提供商加一个模型。`,
    }
  }
  // 理论到不了这里（usable 判据与上面各分支互补）；留一条不撒谎的兜底。
  return {
    code: 'default-provider-missing',
    text: `默认模型 ${defaultModel.provider} · ${defaultModel.model} 还不是一个可用路由。`,
    next: `打开 DSH「${AI_SETTINGS_PATH}」重新选择。`,
  }
}
