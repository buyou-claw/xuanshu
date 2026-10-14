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
 */
import { resolveDataDir } from '../bazi/service.mjs'
import { defaultModelSelection } from './agent.mjs'
import { BESTOF_SCHEMA, createBestofStore, newRunId } from './bestof-store.mjs'
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
  const consultStore = createConsultStore(dataDir)
  const store = createBestofStore(dataDir)
  /** 活记录（轮询读它）；进程重启后由 `store.findByRunId()` 冷查。 */
  const live = new Map()
  /** 每个 run 一个中断开关：`bestof.cancel` 用它真的把 N 路流掐掉（S9「停止全部」）。 */
  const aborts = new Map()

  function findRecord(runId) {
    const inMemory = live.get(runId)
    if (inMemory !== undefined) return inMemory
    const cold = store.findByRunId(runId)
    if (cold !== null) live.set(cold.runId, cold)
    return cold ?? undefined
  }

  /** 落一次盘（失败不吞：记录的权威就是这份文件）。 */
  function persist(record) {
    store.write(record)
    return record
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
  async function execute(record, { question, routes, signal }) {
    const completionOrder = []
    await Promise.all(
      record.candidates.map(async (candidate, index) => {
        const route = routes[index]
        const result = await runCandidate(ctx, {
          route,
          angle: resolveAngles([candidate.angle])[0],
          question,
          signal,
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
      if (consultStore.read(sessionId) === null) {
        throw new Error(`问事记录不存在：${sessionId}（合参挂在问事会话上，先 consult.create）。`)
      }

      const angles = resolveAngles(source.angles)
      const routes = await resolveRoutes(ctx, { profileIds: source.profileIds, count: angles.length })
      if (routes.length < 2) throw new Error(`合参至少要两路（现在 ${routes.length} 路）：去设置加一个视角或换一个 provider。`)

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
      }
      live.set(record.runId, record)
      persist(record)
      // 每个 run 一个中断开关：「停止全部」靠它把 N 路流真的掐掉（契约 §1 的 additive `bestof.cancel`）。
      const controller = new AbortController()
      aborts.set(record.runId, controller)
      // 后台跑：不 await（见文件头第 1 条）。失败已折进记录，这里只兜住「连记录都没写成」。
      void execute(record, { question, routes, signal: controller.signal })
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
        persist(record)
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
      }
      persist(record)
      return { bestOf: view(record) }
    },
  }
}

/** 按判官排序把可用候选排一遍（判官没覆盖到的排后面，顺序按原候选序）。 */
function rankByJudge(record, usable) {
  const ranking = Array.isArray(record.judge?.ranking) ? record.judge.ranking : []
  const position = new Map(ranking.map((id, index) => [id, index]))
  return [...usable].sort((a, b) => (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER))
}
