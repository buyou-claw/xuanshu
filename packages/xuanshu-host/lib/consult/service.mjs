/**
 * packages/xuanshu-host/lib/consult/service.mjs — 票 10 的 `consult.*` RPC 方法组（契约 §2 冻结六个方法）。
 *
 * 与 `bazi/service.mjs` / `pu/service.mjs` / `cang/service.mjs` 同一形态：`lib/index.js` 的
 * `installRpc(ctx, {...})` 把这一组方法并进同一条 `/xuanshu` 通道（通道实现是 `lib/rpc.mjs`，本票不碰）。
 *
 * 分类载体（ADR-0009，契约 §1）：
 *   - `sessionId` = `session-xs-consult-<uuid>`（玄枢自铸；`SessionId` 不做格式校验）；
 *   - `cwd` = `<dataDir>/consult`（全部问事会话共用 → 一个 cwd 过滤就能列出全部）；
 *   - 旁挂清单 = `<dataDir>/consult/sessions/<sessionId>.json`（`store.mjs`）；
 *   - 消息来源 kind = `xuanshu-consult`（`message.mjs`）。
 *   **不做**：往 `meta` 塞额外键、新增会话事件 `type`、把 `agentPreset` 当标签、把会话挂进 workspace。
 *
 * 两条读取口径（本模块只消费、绝不另开一条路）：
 *   - 底座谱只走票 08 的 `bazi.basePu`；
 *   - 可选谱只走票 09 的 `pu.list` / `pu.read`（`<dataDir>/pus/**` 的读面单源在那里）。
 *   两者都是「把那一组方法现建一次再调」—— 与 RPC 上暴露的是同一批函数，不重复实现。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createBaziMethods, resolveDataDir } from '../bazi/service.mjs'
import { createPuMethods } from '../pu/service.mjs'
import { buildConsultContext } from './context.mjs'
import { consultAgentCapability, createConsultAgent, resumeConsultAgent } from './agent.mjs'
import { isSessionNotFound, projectConsultMessages } from './history.mjs'
import { createConsultContextMessage, createConsultQuestionMessage } from './message.mjs'
import { DEFAULT_CONSULT_TITLE, consultRoot, createConsultStore, isConsultSessionId, newConsultSessionId, normalizePus, normalizeTitle, titleFromQuestion, toConsultSummary } from './store.mjs'
import { waitForTurnEnd } from './turn.mjs'

/** 底稿文件名（契约 §2/§3：`<dataDir>/digao.md`，由票 13 生产，本票只探测与注入）。 */
export const DIGAO_FILENAME = 'digao.md'

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/** 底稿路径。 */
export function digaoPath(dataDir) {
  return join(dataDir, DIGAO_FILENAME)
}

/**
 * 读底稿：不存在 → null（**不造空底稿**：`present:false` 才是诚实的答案）。
 * 读不出来（权限/目录）也当没生成 —— 探测面不该因为一个文件读不动就整体报错。
 */
export function readDigao(dataDir) {
  const file = digaoPath(dataDir)
  try {
    if (!existsSync(file)) return null
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * 建 `consult.*` 方法组。
 * @param {object} ctx cordis 宿主上下文（裸 `{}` 也要活）
 * @param {{dataDir?: string}} [config] 数据目录（缺省按 `profileContext.home` → `$DSH_HOME` → `~/.dsh` 推导）
 * @returns {Record<string, Function>} 六个方法（契约 §2）
 */
export function createConsultMethods(ctx, config = {}) {
  const dataDir = resolveDataDir(ctx, config)
  const store = createConsultStore(dataDir)
  /** 本进程建过/接过的会话句柄（`consult.send` 复用；进程重启后靠 `agents.resume` 重新接）。 */
  const handles = new Map()
  /** 本进程已经灌过首轮上下文的会话（旁挂清单的 `turns` 是跨进程的判据，这里是同进程的防抖）。 */
  const injected = new Set()
  /** 每个会话最多一个「等这一轮结束」的订阅（免得并发发问堆监听器）。 */
  const turnWaiters = new Map()
  /** 每个会话一条串行队列：同一会话的两问不许交错改旁挂清单（否则丢更新）也不许各灌一次上下文。 */
  const sendChains = new Map()

  // 票 08 / 票 09 的读面：现建一次方法组再调它 —— 与 RPC 上的同名方法是同一批函数。
  const basePu = async () => createBaziMethods(ctx, { dataDir })['bazi.basePu']()
  const listPus = async () => createPuMethods(ctx, { dataDir })['pu.list']({})
  const readPu = async (slug) => createPuMethods(ctx, { dataDir })['pu.read']({ slug })
  /** 解析官方 `@deepseek-ai/dsh-llm/message` 的锚点顺序：profile 目录优先（真机就在这里）。 */
  const messageSearchDirs = () => {
    const profile = softGet(ctx, 'profileContext')
    return [typeof profile?.dir === 'string' ? profile.dir : null, process.cwd()].filter((dir) => typeof dir === 'string' && dir !== '')
  }
  /** 带作用域的 logger；宿主没装就静默替身（后台记账失败不该把发问拖下水）。 */
  const logger = (() => {
    try {
      const scoped = typeof ctx?.logger === 'function' ? ctx.logger('xuanshu-consult') : undefined
      if (scoped && typeof scoped.warn === 'function') return scoped
    } catch {
      /* 落到静默替身 */
    }
    return { info() {}, warn() {} }
  })()

  /** 校验并取出问事会话 id：**只吃玄枢自铸的前缀**，别的会话一律拒绝。 */
  function requireSessionId(value) {
    if (!isConsultSessionId(value)) {
      throw new Error(`不是问事会话的 id：${JSON.stringify(value) ?? String(value)}（问事会话的 id 一律是 session-xs-consult-<uuid>）。`)
    }
    return value
  }

  /** 取（必要时接上）会话的 agent：本进程建过就用句柄，进程重启过就 `agents.resume`。 */
  async function ensureAgent(sessionId) {
    const agents = softGet(ctx, 'agents')
    if (typeof agents?.create !== 'function') {
      throw new Error('DSH agent 服务（ctx.agents）不可得：驱动不了这个会话。')
    }
    const held = handles.get(sessionId)
    if (held?.agent) return held.agent
    const live = typeof agents.get === 'function' ? agents.get(sessionId) : undefined
    if (live) return live
    if (typeof agents.resume !== 'function') {
      throw new Error(`会话 ${sessionId} 不在本进程活着，且 ctx.agents 不能 resume：先 consult.create 或让 DSH 会话面板打开它。`)
    }
    const handle = await resumeConsultAgent(ctx, { sessionId })
    handles.set(sessionId, handle)
    return handle.agent
  }

  /** 装配这一场问事的首轮上下文（底座谱 → 底稿 → 勾选谱；读面全部来自票 08 / 票 09）。 */
  async function buildInjection(manifest) {
    const read = await basePu()
    const selected = []
    for (const slug of manifest.pus) {
      try {
        selected.push({ slug, pu: await readPu(slug) })
      } catch (error) {
        // 勾选时在、现在读不到：把原因带进注入文本，而不是静默少一段（见 context.mjs）。
        selected.push({ slug, error: String(error?.message ?? error) })
      }
    }
    return buildConsultContext({ dataDir, basePu: read?.pu ?? null, digao: readDigao(dataDir), selected })
  }

  /**
   * 把一次发问排进该会话的串行队列。
   *
   * 为什么必须串行：`consult.send` 的两步都是「读旁挂清单 → 写旁挂清单」（首轮判据 `turns`、
   * 记账 `turns+1`）。两问并发时两边都读到 `turns=0`，于是一个丢更新、另一个灌两遍上下文 ——
   * 都是安静发生的错。串行化的代价只是同一会话的第二问晚一个微任务起步。
   */
  function queueSend(sessionId, task) {
    const previous = sendChains.get(sessionId) ?? Promise.resolve()
    const next = previous.then(task, task)
    const tail = next.then(
      () => {},
      () => {},
    )
    sendChains.set(sessionId, tail)
    void tail.then(() => {
      if (sendChains.get(sessionId) === tail) sendChains.delete(sessionId)
    })
    return next
  }

  /**
   * 这一轮结束时记一笔（`lastTurnAt`）。
   *
   * 判据是 `turn/end`，**不是** `whenIdle()`（后者不标识某条消息的结束，见 turn.mjs 的文件头）。
   * 它是**后台**记账：`consult.send` 的语义与 DSH 的 `SessionPromptValue{accepted:true}` 一样 ——
   * 受理就回，不等答完（等答完会让 RPC 挂上几分钟，而且取消按钮就落不到实处）。
   */
  function watchTurnEnd(sessionId) {
    if (turnWaiters.has(sessionId)) return
    const waiter = waitForTurnEnd(ctx, sessionId)
      .then((result) => {
        if (result.kind !== 'ended') return
        if (store.read(sessionId) === null) return
        store.update(sessionId, { lastTurnAt: new Date().toISOString() })
      })
      .catch((error) => {
        logger.warn('等 %s 的 turn/end 失败（已兜住）：%s', sessionId, String(error?.message ?? error))
      })
      .finally(() => {
        turnWaiters.delete(sessionId)
      })
    turnWaiters.set(sessionId, waiter)
  }

  return {
    /**
     * 开一次问事（契约 §2）：建会话 + 写旁挂清单，**不发问**。
     *
     * 会话必须走 `ctx.agents.create()` 而不是 `ctx.sessions.create()`：
     * 后者只造日志对象、不接 agent、不挂 preset，会话跑不起来（`:449-458`）。
     * 建会话的完整口径（preset 组合 + 模型选择 + **为什么不能只给 `meta:{cwd}`**）在 `agent.mjs`；
     * 一句话：preset 是工具能力的来源，provider/model 不给就连第一轮都开不了口。
     */
    'consult.create': async (request) => {
      const source = request && typeof request === 'object' && !Array.isArray(request) ? request : {}
      const pus = normalizePus(source.pus)

      const agents = softGet(ctx, 'agents')
      if (typeof agents?.create !== 'function') {
        throw new Error('DSH agent 服务（ctx.agents）不可得：建不出能跑的会话（工具能力来自 agent preset）。')
      }

      const sessionId = newConsultSessionId()
      const cwd = consultRoot(dataDir)
      // `session-controller.create()` 会在建会话前 `mkdir -p` cwd（`:445-448`），
      // 而 `ctx.agents.create()` 这条路上没人做 —— 自己来，否则真机上会话建不出来。
      mkdirSync(cwd, { recursive: true })

      const handle = await createConsultAgent(ctx, { sessionId, cwd })
      handles.set(sessionId, handle)
      try {
        return { session: toConsultSummary(store.create({ sessionId, pus })) }
      } catch (error) {
        // 旁挂清单是列表的权威：写不进去就不能把会话留下 —— 否则它跑得起来却在列表里永远看不见。
        handles.delete(sessionId)
        try {
          await handle.dispose?.()
        } catch {
          /* 回滚失败不掩盖原错误 */
        }
        throw new Error(`问事记录（旁挂清单）写不进去：${String(error?.message ?? error)}（已回滚刚建的会话）。`)
      }
    },

    /**
     * 问一句话（契约 §2/§3）：**受理即回**（与 DSH `SessionPromptValue{accepted:true}` 同语义），
     * 不等这一轮答完 —— 等答完会让 RPC 挂上几分钟，客户端的取消/流式都没了着力点。
     *
     * 首轮才注入上下文（底座谱 + 底稿 + 勾选谱概览），之后都在会话历史里；
     * 注入用 `inject()`（不唤醒）排在 `followup()`（唤醒）之前 —— 于是它必然落在这一轮的问题之前。
     */
    'consult.send': async (request) => {
      const source = request && typeof request === 'object' && !Array.isArray(request) ? request : {}
      const sessionId = requireSessionId(source.sessionId)
      const text = typeof source.text === 'string' ? source.text.trim() : ''
      if (text === '') throw new Error('问题不能为空（text 需要一段文本）。')

      return queueSend(sessionId, async () => {
        const manifest = store.read(sessionId)
        if (manifest === null) {
          throw new Error(`问事记录不存在：${sessionId}（列表以旁挂清单为准 —— consult.list 里没有它，就先 consult.create）。`)
        }

        // 发问前的门（Lead 裁定）：preset / 模型服务缺一个，这一轮就一定跑不起来。
        // 宁可在这里可读地失败，也不许回一个 accepted:true 然后什么都不发生。
        const capability = consultAgentCapability(ctx)
        if (!capability.ok) throw new Error(`这次问事发不出去。${capability.detail}`)

        const agent = await ensureAgent(sessionId)
        // `turns` 是跨进程的首轮判据（旁挂清单），`injected` 是同进程的去重。
        if (manifest.turns === 0 && !injected.has(sessionId)) {
          const context = await buildInjection(manifest)
          agent.inject(await createConsultContextMessage(context, { searchDirs: messageSearchDirs() }))
          injected.add(sessionId)
        }
        agent.followup(await createConsultQuestionMessage(text, { searchDirs: messageSearchDirs() }))

        const patch = { turns: manifest.turns + 1 }
        // 标题由**首问**决定；改名过的会话不再被下一问覆盖。
        if (manifest.turns === 0 && manifest.title === DEFAULT_CONSULT_TITLE) patch.title = titleFromQuestion(text)
        store.update(sessionId, patch)

        // 后台等这一轮真正结束（turn/end），记 lastTurnAt；失败只记日志，不影响已受理的发问。
        watchTurnEnd(sessionId)
        return { accepted: true }
      })
    },

    /**
     * 勾选谱区的数据源（契约 §2）：`required` 恒为两项（底座谱 / 底稿），`optional` 是用户可勾的谱。
     *
     * `required` 的 `present:false` 必须带 `reason` —— 界面要在锁定行上说清「为什么现在没有」，
     * 而不是显示一条没有内容的锁定行。
     */
    'consult.defaults': async () => {
      const read = await basePu()
      const pu = read?.pu ?? null
      const digao = readDigao(dataDir)

      const required = [
        pu === null
          ? { kind: 'base-pu', name: '底座', present: false, reason: '底座未立：先去填出生信息（八字冷启动向导），出盘后底座谱会落到 pus/_base/。' }
          : { kind: 'base-pu', name: typeof pu.name === 'string' && pu.name !== '' ? pu.name : '底座', present: true },
        digao === null
          ? { kind: 'digao', name: '底稿', present: false, reason: '底稿未生成：它由日课定时刷新（票 13），现在还没有 digao.md。' }
          : { kind: 'digao', name: '底稿', present: true },
      ]

      // `pu.list()` 本来就不含保留目录 `_base`（票 09 的 slug 语义）；这里再按 error 过滤一层：
      // 读不出来的谱勾了也只会注入一段「读不出来」，用户修它的地方在 S5 谱管理。
      const optional = (await listPus())
        .filter((item) => item.error === undefined)
        .map((item) => ({ slug: item.slug, name: item.name, level: item.level, summary: item.summary ?? '' }))

      return { required, optional }
    },

    /**
     * 历史列表（契约 §2，S7）：**只读旁挂清单目录**，按 `createdAt` 倒序。
     *
     * 为什么不去扫会话日志反推：① 慢；② 反推不出「这次勾了哪些谱」——
     * 那些键在 rc.2 的会话 `meta` 里根本读不回来（ADR-0009）。旁挂清单是这件事的权威。
     */
    'consult.list': async () => ({ items: store.list().map(toConsultSummary) }),

    /**
     * 点开即读（契约 §2，S7）：旁挂清单给「这是哪一次问事」，会话日志给正文。
     * 正文只走 `ctx.sessionQuery.readSession()` —— 本地日志是 zstd JSONL，**不自己解压**。
     */
    'consult.read': async (request) => {
      const source = request && typeof request === 'object' && !Array.isArray(request) ? request : {}
      const sessionId = requireSessionId(source.sessionId)
      const manifest = store.read(sessionId)
      if (manifest === null) {
        throw new Error(`问事记录不存在：${sessionId}（列表以旁挂清单为准；consult.list 里没有它）。`)
      }

      const query = softGet(ctx, 'sessionQuery')
      if (typeof query?.readSession !== 'function') {
        throw new Error('DSH 会话查询服务（ctx.sessionQuery）不可得：会话正文读不出来（问事记录本身还在，列表与勾选谱不受影响）。')
      }

      let snapshot
      try {
        snapshot = await query.readSession(sessionId)
      } catch (error) {
        // 刚 create、一句话还没问的会话本来就没落盘：那是「还没有消息」，不是错误。
        if (isSessionNotFound(error)) return { session: toConsultSummary(manifest), messages: [] }
        throw new Error(`会话正文读不出来（${sessionId}）：${String(error?.message ?? error)}`)
      }
      return { session: toConsultSummary(manifest), messages: projectConsultMessages(snapshot) }
    },

    /** 改名（契约 §2，S7 的「标题」）：落到旁挂清单上，列表与阅读器读的都是它。 */
    'consult.rename': async (request) => {
      const source = request && typeof request === 'object' && !Array.isArray(request) ? request : {}
      const sessionId = requireSessionId(source.sessionId)
      const title = normalizeTitle(source.title)
      const updated = store.update(sessionId, { title })
      if (updated === null) {
        throw new Error(`问事记录不存在：${sessionId}（列表以旁挂清单为准；consult.list 里没有它）。`)
      }
      return { session: toConsultSummary(updated) }
    },
  }
}
