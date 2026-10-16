/**
 * packages/xuanshu-host/lib/consult/bestof.mjs — 票 11 的 `bestof.*` RPC 方法组（契约 §1 冻结三个方法）。
 *
 * 与 `consult.*` 同一形态：`lib/index.js` 的 `installRpc` 把这一组并进同一条 `/xuanshu` 通道。
 *
 * 两条运行期口径：
 *
 * 1. **`bestof.run` 是「受理即回」**：候选是并发多路流，几秒到几十秒；把它挂在 RPC 上等完，
 *    客户端的取消/流式都没了着力点，还会撑爆 HTTP 超时。所以 run 落记录、**后台跑**，
 *    界面按 `bestof.state` 轮询 —— 这也正是契约给 `bestof.state` 的用途（「供界面轮询/回看」）。
 * 2. **能力门**：`ctx.llm` 或 provider/model 缺一个，当场可读地失败（与票 10 `consult.send` 同一条纪律）。
 *    合参是**多花几倍钱**的动作，绝不能回一个假的「开始合参」然后什么都不发生。
 * 3. **采用稿进历史**（task-14）：人点「采用 / 合并」时，把**那一份**文本作为一条
 *    `user/message`（`source.kind = xuanshu-bestof-adopted`）投递进会话 —— 后续轮次看得见它；
 *    **落选候选永远不进日志**（旁挂 `bestof` 记录是候选的唯一权威）。`reject` 什么都不写。
 */
import { resolveDataDir } from '../bazi/service.mjs'
import { defaultModelSelection, resumeConsultAgent } from './agent.mjs'
import { BESTOF_SCHEMA, createBestofStore, migrateLegacyDecisions, newRunId } from './bestof-store.mjs'
import { createContextAssembly } from './inject.mjs'
import {
  collectStream,
  costUsdOf,
  failureOf,
  judgeFrom,
  judgeToolSchema,
  JUDGE_SYSTEM,
  mergeCandidates,
  priceFor,
  resolveAngles,
  runCandidate,
} from './bestof-run.mjs'
import { BESTOF_ADOPTED_SOURCE_KIND, createBestofAdoptedMessage } from './message.mjs'
import { createConsultStore, isConsultSessionId } from './store.mjs'

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/** 合参现在能不能跑：`ctx.llm.stream` 与一个 provider/model 缺一不可。 */
export function bestofCapability(ctx) {
  const missing = []
  if (typeof softGet(ctx, 'llm')?.stream !== 'function') missing.push('llm')
  if (defaultModelSelection(ctx) === undefined) missing.push('agentDefaultModel')
  return {
    ok: missing.length === 0,
    missing,
    detail: missing.length === 0
      ? ''
      : `宿主缺少 ${missing.join('、')}：合参要多路调用模型，缺了这一步就发不出去。`
        + '修复路径：确认 profile 里 `llm-*` 与默认模型行在（`dsh --profile xuanshu --dump-config`），'
        + '并在设置里选好模型；玄枢不另配密钥。',
  }
}

/** 非空字符串参数。 */
function requireText(value, label) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') throw new Error(`${label}不能为空。`)
  return text
}

/** 校验问事会话 id（与 `consult.send` 同一道门：合参是挂在问事会话上的旁路）。 */
function requireSessionId(value) {
  if (!isConsultSessionId(value)) {
    throw new Error(`不是问事会话的 id：${JSON.stringify(value) ?? String(value)}（合参挂在问事会话上，id 一律是 session-xs-consult-<uuid>）。`)
  }
  return value
}

/**
 * 解析这一轮的 provider 路由。
 *
 * 缺省 = **同一路由两路**（S9 §2.1「首版 2 路 = 经典派 + 审慎派（同一模型两视角）」），
 * 路由取 `ctx.agentDefaultModel.currentSelection()`（与票 10 建会话时同一个来源）。
 * 给了 `profileIds` 就按 id 各取该路由的**第一个模型**（`listModels()`）—— 首版不做模型选择 UI。
 */
export async function resolveRoutes(ctx, { profileIds, count }) {
  if (profileIds === undefined || profileIds === null) {
    const selection = defaultModelSelection(ctx)
    if (selection === undefined) throw new Error('拿不到当前 provider / model：先在设置里选好模型再合参。')
    return Array.from({ length: count }, () => ({ provider: selection.provider, model: selection.model }))
  }
  if (!Array.isArray(profileIds) || profileIds.length === 0) throw new Error('profileIds 必须是非空字符串数组。')
  const llm = softGet(ctx, 'llm')
  const routes = []
  for (const id of profileIds) {
    const provider = typeof id === 'string' ? id.trim() : ''
    if (provider === '') throw new Error('profileIds 里有空 id。')
    let models
    try {
      models = await llm.listModels(provider)
    } catch (error) {
      throw new Error(`取不到 provider ${provider} 的模型列表：${String(error?.message ?? error)}。`)
    }
    const model = Array.isArray(models) && models.length > 0 ? models[0]?.id : undefined
    if (typeof model !== 'string' || model === '') throw new Error(`provider ${provider} 没有可用模型。`)
    routes.push({ provider, model })
  }
  return routes
}

/** 可用候选：跑完的，或**被人停下来但已经产出了文字**的（S9 §6「已停止」中间态照样能采用）。 */
function usableCandidates(record) {
  return record.candidates.filter((candidate) => (candidate.status === 'done' || candidate.status === 'stopped') && candidate.text !== '')
}

/**
 * 会话日志里那一条采用稿的**出生证明**（响应与旁挂记录都带它）。
 *
 * `deliveries` 是 append-only 的：改选一次就多一条（每一次都是人点的），
 * 而**落选候选一条都不会有**。`deliveryError` 记最后那次的失败原因。
 */
function deliveryOf(record) {
  const last = Array.isArray(record.deliveries) && record.deliveries.length > 0 ? record.deliveries[record.deliveries.length - 1] : undefined
  if (last !== undefined && record.deliveryError === undefined) {
    return { ok: true, candidateId: last.candidateId, messageId: last.messageId, source: BESTOF_ADOPTED_SOURCE_KIND, at: last.at }
  }
  if (record.deliveryError !== undefined) {
    return { ok: false, candidateId: last?.candidateId ?? record.adoptedId, error: record.deliveryError, attemptedAt: record.deliveryAttemptedAt }
  }
  return undefined
}

/**
 * 一次采用投递 → 账本里的那条条目（**唯一**的构造点）。
 *
 * 导出给测试用：SP-1 的回归要构造「盘上/内存里已经有一条同形交付」的记录，若测试自己拼一份
 * `{kind,messageId,candidateId,runId}`，形状一漂两边就对不上（账本键进 `currentAdoptedMessageIds` 的判据）。
 *
 * @param {{runId: string}} record 那一轮的记录（`runId` = 这一轮）
 * @param {{messageId: string, at: string}} entry `deliverAdopted()` 写进 `deliveries` 的那条
 */
export function adoptedLedgerEntry(record, entry) {
  return { kind: 'adopted', messageId: entry.messageId, candidateId: entry.candidateId, runId: record.runId, at: entry.at }
}

/** 记录 → RPC 响应（契约 §1 的 `{runId, candidates, judge}` + 界面要用的采用态/费用）。 */
function view(record) {
  return {
    runId: record.runId,
    sessionId: record.sessionId,
    question: record.question,
    candidates: record.candidates.map((candidate) => ({ ...candidate })),
    judge: { ...record.judge },
    adoptedId: record.adoptedId,
    rejected: record.rejected,
    finished: record.finishedAt !== undefined,
    ...(record.usage === undefined ? {} : { usage: { ...record.usage } }),
    ...(record.costUsd === undefined ? {} : { costUsd: record.costUsd, costUsdComplete: record.costUsdComplete === true }),
    ...(record.mergedBy === undefined ? {} : { mergedBy: { ...record.mergedBy } }),
    // 采用稿到底有没有进会话：`state` 也要说同一句话（冷读/刷新后界面不能又变回「已写进历史」）。
    ...(Array.isArray(record.deliveries) && record.deliveries.length > 0
      ? { deliveredAt: record.deliveries[record.deliveries.length - 1].at, delivery: deliveryOf(record) }
      : record.deliveryError === undefined
        ? {}
        : { delivery: deliveryOf(record) }),
  }
}

/** usage 相加（只加存在的计数）。 */
function addUsage(total, usage) {
  if (usage === undefined || usage === null) return total
  const next = { ...(total ?? {}) }
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    if (Number.isFinite(usage[key])) next[key] = (next[key] ?? 0) + usage[key]
  }
  return Object.keys(next).length === 0 ? total : next
}

/**
 * 建 `bestof.*` 方法组。
 * @param {object} ctx cordis 宿主上下文
 * @param {{dataDir?: string, prices?: Record<string, {inputPerMTok: number, outputPerMTok: number}>}} [config]
 *        `prices` 是按 `<provider>/<model>` 索引的价表；**没有价表就没有 `costUsd`**
 *        （界面显示「费用未知」，绝不编一个 0 当实测费用）。
 */
export function createBestOfMethods(ctx, config = {}) {
  const dataDir = resolveDataDir(ctx, config)
  const prices = config.prices
  // 候选耗时的时钟：缺省真钟；断言台注入计数时钟，好让 `elapsedMs` 能被证否（见 bestof-run.mjs）。
  const now = typeof config.now === 'function' ? config.now : Date.now
  const consultStore = createConsultStore(dataDir)
  const store = createBestofStore(dataDir)
  /** 候选看到的上下文 = 这场问事的上下文（与 `consult.send` 的**同一份装配**，见 inject.mjs）。 */
  const assembly = createContextAssembly(ctx, config)
  /** 活记录（轮询读它）；进程重启后由 `store.findByRunId()` 冷查。 */
  const live = new Map()
  /** 每个 run 一个中断开关：`bestof.cancel` 用它真的把 N 路流掐掉（S9「停止全部」）。 */
  const aborts = new Map()
  /** 每层会话当前那一轮（`runId`）：`bestof.run` 覆盖写时更新，给 `persist` 判「我还算不算当前那一轮」。 */
  const currentRun = new Map()

  function findRecord(runId) {
    const inMemory = live.get(runId)
    if (inMemory !== undefined) return inMemory
    const cold = store.findByRunId(runId)
    if (cold !== null) live.set(cold.runId, cold)
    return cold ?? undefined
  }

  /**
   * 这层会话在**本进程里**是不是已经有更新的一轮了（逻辑先后，不看盘面那一刻是谁）。
   *
   * 与 `bestof.adopt` 原来那条「读盘面判取代」是一对：盘面判据在「新一轮首次落盘失败」或
   * 「两个宿主实例共用 dataDir」时会漏，而这里的标记跟着 `bestof.run` 的**成功落盘**走。
   * 两道一起用，迟到的拍板 / 停止才不会写回旧记录、盖掉新一轮的账本。
   */
  function hasNewerRun(record) {
    const current = currentRun.get(record.sessionId)
    return current !== undefined && current !== record.runId
  }

  /**
   * 落一次盘。**返回这次到底写了没有**（调用方据此决定要不要把「成功」报出去）。
   *
   * **只允许当前那一轮写**：一层会话一份记录（覆盖写），而上一轮的 `execute` 还在后台跑 ——
   * 它收尾 / 流式回填时若把**陈旧记录**写回去，会把新一轮的 runId 与采用稿账本一起盖掉
   * （`bestof.adopt` 的取代判据随后就会误报「已经被更新的一轮取代」，新一轮的候选也可能读成旧的）。
   * 判据用**逻辑先后**（新 `bestof.run` 落盘**成功之后**才把当前轮标成自己），不看去盘上此刻是谁 ——
   * 判盘面会和后台写抢同一个瞬间。单轮时标记就是自己（或还没标记），照常写。
   *
   * **为什么返回值要往上冒**（复核 32216d9 追加复核的 SP-1）：丢弃写对「决定是否真的落盘」这件事
   * 不能是静默的 —— 拍板那条路上，静默丢弃会让 RPC 报「已采用」而盘上什么都没变。
   */
  function persist(record) {
    const current = currentRun.get(record.sessionId)
    if (current !== undefined && current !== record.runId) return false
    store.write(record)
    return true
  }

  /** 解析官方 `@deepseek-ai/dsh-llm/message` 的锚点顺序（与 `consult.send` 同一条：profile 目录优先）。 */
  function messageSearchDirs() {
    const profile = softGet(ctx, 'profileContext')
    return [typeof profile?.dir === 'string' ? profile.dir : null, process.cwd()].filter((dir) => typeof dir === 'string' && dir !== '')
  }

  /** 取（必要时接上）会话的 agent：本进程活着就直接用，进程重启过就 `agents.resume`。 */
  async function sessionAgent(sessionId) {
    const agents = softGet(ctx, 'agents')
    if (typeof agents?.get !== 'function' && typeof agents?.resume !== 'function') {
      throw new Error('DSH agent 服务（ctx.agents）不可得：这一份采用稿写不进会话。')
    }
    const live = typeof agents.get === 'function' ? agents.get(sessionId) : undefined
    if (live !== undefined && live !== null) return live
    const handle = await resumeConsultAgent(ctx, { sessionId })
    return handle?.agent
  }

  /**
   * 把**被采用的那一份**投递进会话历史（task-14）。
   *
   * 载体是 `user/message` + `source.kind = xuanshu-bestof-adopted`（ADR-0009 第 5 条的合并点）：
   * `user/message` 是**已登记**的事件类型（不新增 type、不碰 `meta`），自定义 source kind 让它在
   * 轨迹里显示成一条「注入」行而不是用户原话。落选候选**不走**这条路 —— 它们只活在旁挂记录里。
   *
   * **为什么是 `followup()` 而不是 `inject()`**（Lead 2026-10-15 定案，别按「省一次调用」的直觉改回去）：
   * 合参走 `ctx.llm.stream()`、不经 agent，采纳那一刻会话**就是 idle** —— `inject` 的原文是
   * 「without waking the driver … idle drivers leave it pending until follow-up or steering wakes them」，
   * 采用稿会停在待办里、**立刻不进日志**，人点完看不到任何变化。`followup` 多跑一轮（花一次 token），
   * 但那一轮**可见**且有意义（人刚拍板了定稿，会话就该从这一份往下走）；「多花一次调用」看得见，
   * 「日志里其实没有采用稿」看不见 —— 这个项目一律选可见的那个代价。
   *
   * 失败**不上抛**：采用这个决定已经落盘（人是真点了），但**必须如实回来**
   * （`delivery.ok=false` + 原因），绝不能让界面以为「已经写进历史了」。
   */
  async function deliverAdopted(record, view, { merged }) {
    const candidate = view.candidates.find((entry) => entry.id === view.adoptedId)
    const text = typeof candidate?.text === 'string' ? candidate.text.trim() : ''
    if (text === '') throw new Error(`采用稿是空的（${String(view.adoptedId)}）：没有可写进会话的文本。`)
    const message = await createBestofAdoptedMessage(text, { searchDirs: messageSearchDirs(), merged })
    const agent = await sessionAgent(record.sessionId)
    if (typeof agent?.followup !== 'function') {
      throw new Error('这个会话的 agent 不能 followup：采用稿写不进会话（宿主 DSH 版本不同？）。')
    }
    agent.followup(message)
    const entry = { candidateId: view.adoptedId, messageId: message.id, source: BESTOF_ADOPTED_SOURCE_KIND, at: new Date().toISOString() }
    record.deliveries = [...(Array.isArray(record.deliveries) ? record.deliveries : []), entry]
    // 账本也追加一条（复核 N4）：改选时旧的那条留在 deliveries 里（那是投递史），
    // 但「当前采用稿」以账本的最后一条为准。条目形状由 `adoptedLedgerEntry()` 唯一给出 ——
    // 测试要构造同形的记录，两处各拼一份必然漂移。
    record.draftLedger = [...(Array.isArray(record.draftLedger) ? record.draftLedger : []), adoptedLedgerEntry(record, entry)]
    delete record.deliveryError
    return entry
  }

  /** 记账：一路候选的 usage / 费用。 */
  function account(record, { route, usage }) {
    record.usage = addUsage(record.usage, usage)
    const cost = costUsdOf(usage, priceFor(prices, route))
    if (cost === undefined) {
      if (usage !== undefined) record.costUsdComplete = false
      return undefined
    }
    record.costUsd = (record.costUsd ?? 0) + cost
    if (record.costUsdComplete === undefined) record.costUsdComplete = true
    return cost
  }

  /**
   * 后台跑一次合参：N 路并行 → judge → 落记录。任何一路失败都只标那一张卡（S9 §6 部分失败态），
   * 整次失败（全部候选都没文本）也照样落记录，界面看得见「为什么没成」。
   */
  async function execute(record, { question, context, history, routes, signal }) {
    const completionOrder = []
    await Promise.all(
      record.candidates.map(async (candidate, index) => {
        const route = routes[index]
        const result = await runCandidate(ctx, {
          route,
          angle: resolveAngles([candidate.angle])[0],
          question,
          context,
          history,
          signal,
          now,
          // 流式回填：界面轮询 `bestof.state` 就能看到半成品（写盘节流在下面）。
          onText: (text) => {
            candidate.text = text
            const now = Date.now()
            if (now - (record.lastFlush ?? 0) > 120) {
              record.lastFlush = now
              persist(record)
            }
          },
        })
        if (signal.aborted) {
          // 人点了「停止全部」：已产出的文字**保留**并标「已停止」（S9 §5 步骤 10）。
          candidate.status = 'stopped'
          delete candidate.error
        } else if (result.ok === true) {
          candidate.status = 'done'
          candidate.text = result.text
        } else {
          candidate.status = 'error'
          candidate.error = result.error
        }
        candidate.elapsedMs = result.elapsedMs
        candidate.usage = result.usage
        candidate.costUsd = account(record, { route, usage: result.usage })
        completionOrder.push(candidate.id)
        persist(record)
      }),
    )

    if (signal.aborted) {
      // 不跑判官、不自动采用任何一份：停下来的那一轮等人自己点（S9 §5 步骤 10）。
      record.completionOrder = [...completionOrder]
      record.judge = { mode: 'skipped', skipped: true, adoptedId: null, ranking: [], error: '已停止：这一轮没有跑完，判官不会给出排序。' }
      record.finishedAt = new Date().toISOString()
      persist(record)
      return
    }

    const usable = usableCandidates(record)
    record.completionOrder = [...completionOrder]
    // 回落口径是**完成顺序**（ADR-0010 第 2 条），不是路由顺序 —— 所以这里按完成顺序过滤。
    const completionOfUsable = completionOrder.filter((id) => usable.some((candidate) => candidate.id === id))
    if (usable.length === 0) {
      record.judge = { mode: 'skipped', skipped: true, adoptedId: null, ranking: [], error: '所有候选都没有产出文本，这次合参没有可拍板的东西。' }
    } else if (usable.length === 1) {
      // S9 §6：只有一份可用 → 不跑判官，直接进「只有一份可用」中间态。
      record.judge = { mode: 'skipped', skipped: true, adoptedId: usable[0].id, ranking: [usable[0].id], error: undefined }
    } else {
      record.judge = await runJudge(record, usable, completionOfUsable)
    }
    record.finishedAt = new Date().toISOString()
    persist(record)
  }

  /** judge 槽：一次带单字段工具的调用；失败回落完成顺序第一份（ADR-0010）。 */
  async function runJudge(record, usable, completionOfUsable) {
    const selection = defaultModelSelection(ctx) ?? { provider: usable[0].provider, model: usable[0].model }
    const route = { provider: selection.provider, model: selection.model }
    const body = usable.map((candidate) => `【候选 ${candidate.id} · ${candidate.angle}】\n${candidate.text}`).join('\n\n')
    let result
    try {
      result = await collectJudge({ route, question: record.question, body })
    } catch (error) {
      return { mode: 'tool', adoptedId: completionOfUsable[0] ?? null, ranking: completionOfUsable, error: `判官调用失败：${String(error?.message ?? error)}` }
    }
    account(record, { route, usage: result.usage })
    // judge 那一路自己的失败 finish（超时 / 限流 / 无 adapter）也是「判官不可用」，不是「模型没调工具」。
    const failure = failureOf(result.finish)
    if (failure !== undefined) {
      return { mode: 'tool', adoptedId: completionOfUsable[0] ?? null, ranking: completionOfUsable, error: `判官调用失败：${failure}`, ...(result.usage === undefined ? {} : { usage: result.usage }) }
    }
    const judged = judgeFrom(result, completionOfUsable)
    return {
      mode: judged.mode,
      ...(judged.error === undefined ? {} : { error: judged.error }),
      adoptedId: judged.adoptedId,
      ranking: judged.ranking,
      ...(judged.reasons === undefined ? {} : { reasons: judged.reasons }),
      ...(result.usage === undefined ? {} : { usage: result.usage }),
      provider: route.provider,
      model: route.model,
    }
  }

  /** judge 的一次调用（单独抽出来是为了让「调用失败」与「判定不可用」两条路分开写）。 */
  async function collectJudge({ route, question, body }) {
    const llm = softGet(ctx, 'llm')
    if (typeof llm?.stream !== 'function') throw new Error('宿主没有可用的 LLM 服务（ctx.llm）。')
    return collectStream(
      llm.stream({
        provider: route.provider,
        model: route.model,
        system: JUDGE_SYSTEM,
        messages: [{ role: 'user', content: [{ type: 'text', text: `问题：${question}\n\n${body}` }] }],
        tools: [judgeToolSchema()],
      }),
    )
  }

  return {
    /**
     * 开一次合参（契约 §1）：**受理即回**（`{runId, candidates, judge}` 里候选先是 `running`），
     * 后台并发跑 N 路；界面按 `bestof.state` 轮询。
     */
    'bestof.run': async (request) => {
      const source = request && typeof request === 'object' && !Array.isArray(request) ? request : {}
      const sessionId = requireSessionId(source.sessionId)
      const question = requireText(source.question, '问题')
      const capability = bestofCapability(ctx)
      if (!capability.ok) throw new Error(`这次合参发不出去。${capability.detail}`)
      // 合参挂在问事会话上：旁挂清单是「这是哪一次问事」的权威（票 10 契约 §2）。
      const manifest = consultStore.read(sessionId)
      if (manifest === null) {
        throw new Error(`问事记录不存在：${sessionId}（合参挂在问事会话上，先 consult.create）。`)
      }
      // 候选流不带会话历史（它直接走 `ctx.llm.stream()`），所以把这场问事的上下文**读出来带上**：
      // 底座谱 + 底稿 + 勾选谱 + 挂载，与 `agent/pre-step` 边界**同一份装配**。
      // 评审实测的缺陷正是这一处：候选只拿到一句裸问题 —— 问「结合我的信息建议怎么做？」
      // 时，答出来的东西与这场问事毫无关系，而界面上一切正常。
      // 这里**只取文本**：候选流不落会话日志，所以不去动「挂载已交付」那本账（那是边界的事）。
      const { text: context } = await assembly.buildInjection(manifest)
      // 评审 R5 补的另一半：**会话文本历史**（含被采用的合参稿）。只有候选槽带 —— 判官与合并槽
      // 继续遵守各自的边界（H4：判官只看问题与候选）。读不到历史就是 `null`（不编一段假的）。
      const history = await assembly.buildHistory(sessionId)

      const angles = resolveAngles(source.angles)
      const routes = await resolveRoutes(ctx, { profileIds: source.profileIds, count: angles.length })
      if (routes.length < 2) throw new Error(`合参至少要两路（现在 ${routes.length} 路）：去设置加一个视角或换一个 provider。`)

      // **采用稿账本**（复核 N4 / 32216d9 的 R2–R4）：一层会话只留最后一份记录（覆盖写），而
      // 「谁还是当前采用稿」要跨轮才说得清 —— 新记录**继承**上一份的账本，此后每次采用 / 否决各追加一条。
      // 消费方是 `history.mjs` 的候选历史投影（只带各轮当前那几份采用稿）。
      // 上一版记录（只有 `deliveries / adoptedId / rejected`）在**被覆盖之前**先迁移一次：否则
      // 第二个新轮次起旧轮的采用关系就没了，旧采用稿会重新混进候选历史（R4）。
      const previousRecord = store.read(sessionId)
      const record = {
        schema: BESTOF_SCHEMA,
        runId: newRunId(),
        sessionId,
        question,
        createdAt: new Date().toISOString(),
        candidates: angles.map((angle, index) => ({
          id: `c${index + 1}`,
          angle: angle.id,
          angleName: angle.name,
          provider: routes[index].provider,
          model: routes[index].model,
          status: 'running',
          text: '',
        })),
        judge: { mode: 'pending', adoptedId: null, ranking: [] },
        adoptedId: null,
        rejected: false,
        draftLedger: migrateLegacyDecisions(previousRecord),
      }
      live.set(record.runId, record)
      persist(record)
      // **落盘成功之后**才认下「这层会话当前是这一轮」：`persist` 抛错（磁盘满 / 权限 / AV 锁）时
      // `bestof.run` 已经向调用方抛错，旧轮仍是当前轮、它的收尾写照常落盘 —— 盘面与「当前轮」不会分叉
      // （加固的缘由见 `persist` 的注释：分叉会让迟到的拍板被静默丢弃）。
      currentRun.set(sessionId, record.runId)
      // 每个 run 一个中断开关：「停止全部」靠它把 N 路流真的掐掉（契约 §1 的 additive `bestof.cancel`）。
      const controller = new AbortController()
      aborts.set(record.runId, controller)
      // 后台跑：不 await（见文件头第 1 条）。失败已折进记录，这里只兜住「连记录都没写成」。
      void execute(record, { question, context, history, routes, signal: controller.signal })
        .catch((error) => {
          record.finishedAt = new Date().toISOString()
          record.judge = { mode: 'failed', adoptedId: null, ranking: [], error: `合参执行失败：${String(error?.message ?? error)}` }
          try {
            persist(record)
          } catch {
            /* 落盘失败也无处可报：调用方靠 state 看到 failed */
          }
        })
        .finally(() => {
          aborts.delete(record.runId)
        })
      return view(record)
    },

    /**
     * 「停止全部」（S9 §5 步骤 10；契约 §1 的 **additive** 方法，Lead 2026-10-15 批准）。
     *
     * 语义：abort 这一轮的 N 路 stream —— 未完成的候选标 `stopped`、**已产出的文字保留**、
     * **不跑判官、不自动采用任何一份**，界面进「已停止」中间态等人点。
     * 已经结束的 run 调用它是幂等的（返回当前记录），不报错。
     */
    'bestof.cancel': async (request) => {
      const source = request && typeof request === 'object' && !Array.isArray(request) ? request : {}
      const runId = requireText(source.runId, 'runId')
      const record = findRecord(runId)
      if (record === undefined) throw new Error(`合参记录不存在：${runId}。`)
      // 这一轮已被取代时**什么都不做**（与 `bestof.adopt` 的取代判据同一口径，只是判据取**内存里的
      // 逻辑先后**）：写在盘面上的更旧一轮若去 abort 自己的 controller，状态不落盘、界面也只看得到
      // `state` —— 回应一个「已停止」等于替新一轮发言。
      if (hasNewerRun(record)) {
        throw new Error(`这一轮合参已经被更新的一轮取代（当前是 ${currentRun.get(record.sessionId)}）：刷新界面再操作 —— 对旧记录写入会盖掉新一轮。`)
      }
      const controller = aborts.get(runId)
      if (controller !== undefined) controller.abort()
      if (record.finishedAt === undefined) {
        // abort 之后 `execute` 会把在跑的那几路收尾；这里先把「还挂着」的标成已停止，
        // 免得轮询在收尾完成前看到一个自相矛盾的状态。
        for (const candidate of record.candidates) {
          if (candidate.status === 'running') candidate.status = 'stopped'
        }
        record.judge = { mode: 'skipped', skipped: true, adoptedId: null, ranking: [], error: '已停止：这一轮没有跑完，判官不会给出排序。' }
        record.finishedAt = new Date().toISOString()
        if (!persist(record)) {
          throw new Error('这一轮合参已经被更新的一轮取代：停止状态没有落盘，刷新界面看当前那一轮。')
        }
      }
      return { bestOf: view(record) }
    },

    /** 轮询 / 回看（契约 §1）：内存里的活记录优先，进程重启后按 runId 冷查旁挂文件。 */
    'bestof.state': async (request) => {
      const source = request && typeof request === 'object' && !Array.isArray(request) ? request : {}
      const runId = requireText(source.runId, 'runId')
      const record = findRecord(runId)
      if (record === undefined) throw new Error(`合参记录不存在：${runId}。`)
      return view(record)
    },

    /**
     * 拍板（契约 §1）：`adopt` / `merge` / `reject` 三个动作**都要人点**（C9：判官不自动采用）。
     * 候选还在跑时拒绝：拍板的对象必须是已经看得见的正文。
     */
    'bestof.adopt': async (request) => {
      const source = request && typeof request === 'object' && !Array.isArray(request) ? request : {}
      const runId = requireText(source.runId, 'runId')
      const decision = source.decision
      if (!['adopt', 'merge', 'reject'].includes(decision)) {
        throw new Error(`未知的拍板动作：${JSON.stringify(decision)}（只接受 adopt / merge / reject）。`)
      }
      const record = findRecord(runId)
      if (record === undefined) throw new Error(`合参记录不存在：${runId}。`)
      // 一层会话只留**最后一份**记录（覆盖写），而 `live` 里可能还留着更早那几轮 —— 对旧 runId 迟到的
      // 拍板会把旧记录 persist 回去、**盖掉新那一轮**（连它的采用稿账本一起）。所以只允许对
      // 「当前那一份记录」拍板；其它情况给可读错误，让人刷新界面（复核 48e0e0a 规格轴指出的这条）。
      // **两道判据一起用**：内存里的逻辑先后（`hasNewerRun`，覆盖「新一轮首次落盘失败 / 两个宿主实例
      // 共用 dataDir」时盘面还写着旧轮那一小段窗口）与盘面上的取代关系。两者都通过、但落盘仍被跳过时，
      // 下面的 `persist` 返回值会把它顶成可读错误 —— 绝不静默报「已采用」。
      if (hasNewerRun(record)) {
        throw new Error(`这一轮合参已经被更新的一轮取代（当前是 ${currentRun.get(record.sessionId)}）：刷新界面再拍板 —— 对旧记录写入会盖掉新一轮。`)
      }
      const latest = store.read(record.sessionId)
      if (latest !== null && latest.runId !== record.runId) {
        throw new Error(`这一轮合参已经被更新的一轮取代（当前是 ${latest.runId}）：刷新界面再拍板 —— 对旧记录写入会盖掉新一轮。`)
      }
      if (record.finishedAt === undefined) throw new Error('候选还在生成中：等这一轮跑完再拍板（或先点「停止全部」）。')

      const usable = usableCandidates(record)
      if (decision === 'adopt') {
        const id = requireText(source.adoptedId, 'adoptedId')
        const candidate = usable.find((entry) => entry.id === id)
        if (candidate === undefined) throw new Error(`没有这份可用候选：${id}。`)
        record.adoptedId = id
        record.rejected = false
        delete record.mergedBy
      } else if (decision === 'merge') {
        if (usable.length < 2) throw new Error(`可合并的候选不足两份（现在 ${usable.length} 份）：换一份采用，或先补一路。`)
        const ranked = rankByJudge(record, usable)
        let text = typeof source.mergedText === 'string' ? source.mergedText.trim() : ''
        let usage
        if (text === '') {
          const selection = defaultModelSelection(ctx) ?? { provider: ranked[0].provider, model: ranked[0].model }
          const merged = await mergeCandidates(ctx, { route: selection, question: record.question, candidates: ranked })
          text = merged.text
          usage = merged.usage
          account(record, { route: selection, usage })
        }
        const merged = record.candidates.find((candidate) => candidate.id === 'merged')
        const payload = {
          id: 'merged',
          angle: 'merged',
          angleName: '合并稿',
          provider: (defaultModelSelection(ctx) ?? ranked[0]).provider,
          model: (defaultModelSelection(ctx) ?? ranked[0]).model,
          status: 'done',
          text,
          usage,
        }
        if (merged === undefined) record.candidates.push(payload)
        else Object.assign(merged, payload)
        record.adoptedId = 'merged'
        record.rejected = false
        record.mergedBy = { by: typeof source.mergedText === 'string' && source.mergedText.trim() !== '' ? 'caller' : 'host', at: new Date().toISOString() }
      } else {
        // 否决（玄枢自有语义，S9 §2.5 / README 定案 D4）：不采用任何一份，也不跑判官。
        record.adoptedId = null
        record.rejected = true
        delete record.mergedBy
        // 账本追加一条否决（复核 N4）：**按轮**记 —— 这一轮此前可能已经采用过一份并投进了日志，
        // 否决之后它不再是当前采用稿，候选历史里也不该再出现（S9:174「否决轮次不带任何候选正文」）；
        // 而**别的轮**已采用的稿不受影响（那一份仍在会话日志里、仍是这场问事的采用决定）。
        record.draftLedger = [...(Array.isArray(record.draftLedger) ? record.draftLedger : []), { kind: 'rejected', runId: record.runId, at: new Date().toISOString() }]
      }
      // 决定本身必须先落盘（**失败不许静默**）：被取代时 `persist` 不写，这一拍就不能报成功 ——
      // 采用稿已经投进会话日志、账本却没落，「当前采用稿」下一轮读盘就会把刚投的那份当非当前过滤掉
      // （复核 32216d9 追加复核的 SP-1）。这里在**投递之前**判：报错时还什么都没写进会话。
      if (!persist(record)) {
        throw new Error('这一轮合参已经被更新的一轮取代：这一拍没有落盘（采用稿也还没写进会话），刷新界面重拍。')
      }

      // 采用 / 合并 = 人点了「这一份就是定稿」→ 把**它**写进会话历史（只写这一份；落选候选永不进日志）。
      // 否决什么都不写。投递失败不上抛（决定已经落盘），但如实回 `delivery.ok=false`。
      if (decision === 'reject') return { bestOf: view(record) }
      const snapshot = view(record)
      try {
        await deliverAdopted(record, snapshot, { merged: decision === 'merge' })
      } catch (error) {
        record.deliveryError = String(error?.message ?? error)
        record.deliveryAttemptedAt = new Date().toISOString()
      }
      // 这一次是补记投递结果的写：被取代时不落盘也不抛 —— 决定与投递都已如实回报，
      // 此时抛错只会让「采用稿其实已经进会话」的调用方以为整件事失败了。
      persist(record)
      const delivered = deliveryOf(record)
      return { bestOf: view(record), ...(delivered === undefined ? {} : { delivery: delivered }) }
    },
  }
}

/** 按判官排序把可用候选排一遍（判官没覆盖到的排后面，顺序按原候选序）。 */
function rankByJudge(record, usable) {
  const ranking = Array.isArray(record.judge?.ranking) ? record.judge.ranking : []
  const position = new Map(ranking.map((id, index) => [id, index]))
  return [...usable].sort((a, b) => (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER))
}
