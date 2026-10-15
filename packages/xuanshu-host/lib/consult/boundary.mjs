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
 *   - 也因此**不必每轮重发**：材料补一次（判据 = 日志里有没有），挂载按**变化**补（判据 = 旁挂清单的
 *     `mountsInjected`，逐层记「内容已经交给模型」）。
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
import { CONSULT_MESSAGE_SOURCE_KIND, createConsultContextMessage } from './message.mjs'
import { createConsultStore, isConsultSessionId } from './store.mjs'

/** 注册的事件名（DSH 的 pre-step waterfall；随包 `dsh-time-context` 同款）。 */
export const PRE_STEP_EVENT = 'agent/pre-step'

/** 材料里一定会出现的段标记（判「日志里已经有材料了没有」用的哨兵，不是给模型看的）。 */
const MATERIAL_MARKERS = ['【来源：底座谱】', '【来源：底稿】']

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
   * 这条会话的日志里有没有我们注入过的**材料**（底座谱 / 底稿那一段）。
   *
   * 为什么要这条判据：材料交付一次就永久在日志里（见文件头），所以「已经在」= 不用再发；
   * 而**挂载**不在这个判据里 —— 它是按变化逐层补的（`buildMountDelta`）。
   *
   * 认的是**正文里的段标记**而不是 `source.kind`：挂载增量段用的是同一个 kind，
   * 只看 kind 会把「只补过挂载」的会话误判成「材料已在」。
   */
  function hasLoggedMaterial(agent, sessionId) {
    // 只缓存**肯定**的那一半：材料缺席时每一问都要重扫（第一问那一刻它还没落盘）。
    // 反过来缓存 false 就会每轮重发一份材料 —— 复核第二轮实测到的正是这个形状。
    if (materialLogged.get(sessionId) === true) return true
    let found = false
    try {
      const events = typeof agent?.session?.snapshotEvents === 'function' ? agent.session.snapshotEvents() : []
      found = (Array.isArray(events) ? events : []).some((event) => {
        if (event?.type !== 'user/message' || event.data?.source?.kind !== CONSULT_MESSAGE_SOURCE_KIND) return false
        const text = (event.data.content ?? []).map((block) => block?.text ?? '').join('\n')
        return MATERIAL_MARKERS.some((marker) => text.includes(marker))
      })
    } catch {
      // 拿不到事件列表（替身 / 冷会话）：按「没有」处理 —— 宁可多带一段材料，也不许漏。
      found = false
    }
    if (found) materialLogged.set(sessionId, true)
    return found
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

      if (!hasLoggedMaterial(agent, sessionId)) {
        const { text, mountsInjected } = await assembly.buildInjection(manifest)
        if (typeof text !== 'string' || text.trim() === '') return decision
        if (mountsInjected !== null) store.update(sessionId, { mountsInjected })
        return await withContext(decision, claimed, text)
      }

      // 材料已在日志里：这一问只看**挂载变没变**（新增 / 上次没读出来 → 补投；撤下 → 说一句）。
      const { text, mountsInjected } = await assembly.buildMountDelta(manifest)
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
