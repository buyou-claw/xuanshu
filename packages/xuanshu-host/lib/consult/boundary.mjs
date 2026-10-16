/**
 * packages/xuanshu-host/lib/consult/boundary.mjs —— 问事上下文的**统一发问边界**（评审 R2/R3/R4）。
 *
 * 为什么不能再靠 `agent.inject()` 排队（评审实测出来的那条洞）：`inject()` 只是把消息**排进 inbox**
 * （`agent/inbox/spliced`，还没有 `user/message`），而正常 `handle.dispose()` 会追加一条
 * `outcome:"canceled"` 把待消费的消息**撤掉**（实装：`dsh-agent-loop/lib/index.js:815` 清 inbox、
 * `:1688` dispose 调 cancel）——「空白开会话 → 关应用 / dispose → 恢复后从原生 composer 问第一句」
 * 这条路上，必需上下文一个字都没留下。而原生 composer 不经过 `consult.send`，「send 时兜底」也够不着。
 *
 * 这一处改用 DSH 真正的**发问边界**：`agent/pre-step` waterfall
 * （`dsh-agent-loop/lib/index.js:906-918`：每一步的模型输入在这里成型；随包实装先例
 * `dsh-time-context/lib/index.js:242-246` 就是用同一个事件把「当前时间」加进每一步的）。
 *
 * **交付落在哪里**（这一条是复核第二轮纠正的，别再按「不写日志」写文档）：我们返回的消息会被 loop
 * **原样追加进会话日志**（`:1061` 首次尝试时 `append("user/message", message, {surfaceOp:'append'})`）
 * —— 这就是「模型可见 ⟺ 已落日志」不变量的具体形态。所以：
 *   - 交付**永久在场**（重启 / dispose / 原生 composer 都一样，因为读的是日志），
 *   - 也因此**不必每轮重发**：材料补一次（判据 = 日志里有没有），挂载按**与日志的差**补
 *     （判据 = 日志里有没有那一层的 `【来源：挂载 …】` 标记；旁挂清单的 `mountsInjected` 只提供
 *     「每层对应的标记是什么」—— 账走在事实前面时，日志说了算，见「交付账与日志对账」）。
 *
 * 三条门都是有理由的（写在这儿，免得下一轮有人「简化」掉）：
 *   - `step !== 1` → 一轮只在第一步补：后面几步是同一轮的工具循环；
 *   - `claimed.length === 0` → 这一步**没有用户输入**（收尾步骤），补进去会凭空多出一次模型调用；
 *   - 材料已在日志 / 挂载没有变化 → 没有可说的（空文本不注入）。
 *
 * 纪律：这里**永不抛**（catch 住只记日志）—— 一个辅助上下文不该把别人的一轮问答弄挂。
 */
import { resolveDataDir } from '../bazi/service.mjs'
import { createContextAssembly, messageSearchDirs } from './inject.mjs'
import { MOUNT_MARKER_PREFIX } from './context.mjs'
import { CONSULT_MESSAGE_SOURCE_KIND, createConsultContextMessage } from './message.mjs'
import { createConsultStore, isConsultSessionId } from './store.mjs'

/** 注册的事件名（DSH 的 pre-step waterfall；随包 `dsh-time-context` 同款）。 */
export const PRE_STEP_EVENT = 'agent/pre-step'

/** 材料里一定会出现的段标记（判「日志里已经有材料了没有」用的哨兵，不是给模型看的）。 */
const MATERIAL_MARKERS = ['【来源：底座谱】', '【来源：底稿】']

/**
 * 注入文本里的挂载层标记（**交付账与日志对账**的凭据；复核 48e0e0a 的 N3）。
 *
 * 前缀从 `context.mjs` 取 —— 标记是账与日志之间唯一的契约，两处各抄一遍模板必然漂移。
 */
const MOUNT_MARKER = new RegExp(`${MOUNT_MARKER_PREFIX}([^】]*)】`, 'gu')

/**
 * 把「问事上下文」接到 `agent/pre-step` 边界上。
 *
 * @param {object} ctx cordis 宿主上下文（需要 `ctx.on`）
 * @param {{dataDir?: string, mountBudget?: number}} [config]
 * @returns {Function} 退订函数（拿不到 `ctx.on` 时是个空函数）
 */
export function installConsultBoundary(ctx, config = {}) {
  if (typeof ctx?.on !== 'function') return () => {}
  const dataDir = resolveDataDir(ctx, config)
  const store = createConsultStore(dataDir)
  const assembly = createContextAssembly(ctx, config)
  /** 会话日志里**已经**有材料了（我们注入过的）→ 不再补（只按缓存判一次，之后不再扫）。 */
  const materialLogged = new Map()
  const logger = (() => {
    try {
      const scoped = typeof ctx?.logger === 'function' ? ctx.logger('xuanshu-consult') : undefined
      if (scoped && typeof scoped.warn === 'function') return scoped
    } catch {
      /* 落到静默替身 */
    }
    return { info() {}, warn() {} }
  })()

  /**
   * 扫一遍这条会话的日志（一次遍历，两件事）。
   *
   * 为什么挂载要看日志而不是只看账（复核 48e0e0a 的 N3）：账是我们自己写的，而「交付」发生在
   * loop 的 append 里 —— 中间任何一处失败（`prepareRequest` 抛错就是常态路径之一）都会让账
   * 走在事实前面，那一层于是**永远**不再重投。把日志当权威，这类不一致下一问就自愈。
   *
   * 认的是**正文里的标记**而不是 `source.kind`：挂载增量段与材料用的是同一个 kind，
   * 只看 kind 会把「只补过挂载」的会话误判成「材料已在」。
   *
   * @returns {{hasMaterial: boolean, mountMarkers: Set<string>}}
   */
  function scanLog(agent) {
    const result = { hasMaterial: false, mountMarkers: new Set() }
    let events = []
    try {
      events = typeof agent?.session?.snapshotEvents === 'function' ? agent.session.snapshotEvents() : []
    } catch {
      // 拿不到事件列表（替身 / 冷会话）：当成「什么都没有」—— 材料会重发一次，
      // 挂载会重投一次，都是宁可多说一次的代价。
      events = []
    }
    for (const event of Array.isArray(events) ? events : []) {
      if (event?.type !== 'user/message' || event.data?.source?.kind !== CONSULT_MESSAGE_SOURCE_KIND) continue
      const text = (event.data.content ?? []).map((block) => block?.text ?? '').join('\n')
      if (!result.hasMaterial && MATERIAL_MARKERS.some((marker) => text.includes(marker))) result.hasMaterial = true
      for (const match of text.matchAll(MOUNT_MARKER)) result.mountMarkers.add(match[0])
    }
    return result
  }

  /** 把一段文本交给这一步的模型输入（排在用户那句话之前）。 */
  async function withContext(decision, claimed, text) {
    const message = await createConsultContextMessage(text, { searchDirs: messageSearchDirs(ctx) })
    return { ...decision, messages: [message, ...claimed] }
  }

  async function onPreStep(payload, next) {
    const decision = await next()
    try {
      if (decision === undefined || decision === null || decision?.kind === 'reject') return decision
      const { agent, step, signal } = payload ?? {}
      if (signal?.aborted === true) return decision
      if (step !== 1) return decision
      const claimed = Array.isArray(decision?.messages) ? decision.messages : []
      if (claimed.length === 0) return decision
      const sessionId = agent?.session?.id
      if (!isConsultSessionId(sessionId)) return decision
      const manifest = store.read(sessionId)
      if (manifest === null) return decision

      const log = scanLog(agent)
      // 扫到材料就记进缓存，之后不再依赖「这一轮能不能扫到事件列表」：
      // 材料一旦落过日志就永远是「已在」，而 `snapshotEvents()` 偶发拿不到时不该退回重发一份大文本。
      // 反过来**不缓存 false** —— 第一问那一刻它确实还没落盘，缓存 false 就会每轮重发（复核实测过的形状）。
      if (log.hasMaterial) materialLogged.set(sessionId, true)

      if (materialLogged.get(sessionId) !== true) {
        const { text, mountsInjected } = await assembly.buildInjection(manifest)
        if (typeof text !== 'string' || text.trim() === '') return decision
        if (mountsInjected !== null) store.update(sessionId, { mountsInjected })
        return await withContext(decision, claimed, text)
      }

      // 材料已在日志里：这一问只看**挂载比日志里多/少了什么**（新增 / 上次没落日志 → 补投；
      // 撤下 → 说一句）。账只提供「每一层对应的标记」，判断以日志为准（N3）。
      const { text, mountsInjected } = await assembly.buildMountDelta(manifest, { loggedMarkers: log.mountMarkers })
      if (typeof text !== 'string' || text.trim() === '') return decision
      if (mountsInjected !== null) store.update(sessionId, { mountsInjected })
      return await withContext(decision, claimed, text)
    } catch (error) {
      logger.warn('问事上下文没并进这一步的输入（已兜住，不影响这一轮）：%s', String(error?.message ?? error))
      return decision
    }
  }

  return ctx.on(PRE_STEP_EVENT, onPreStep, { prepend: true })
}
