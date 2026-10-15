/**
 * packages/xuanshu-host/lib/consult/turns.mjs —— 「这场问事到底问过几轮」的**核对**（票 10 的 `turns` 补齐）。
 *
 * 为什么需要单独一处：旁挂清单里的 `turns` 只记**玄枢受理过**的轮次，而会话一建出来门厅就
 * `openSession(id)` —— 用户完全可能直接在**原生 composer** 里说第一句，那条路不经过 `consult.send`。
 * 于是「问过 3 轮」与「一句没问过」在旁挂清单里长得一样，两个下游会因此出错：
 *   - 票 15 的 `sediment.draft` 读 `turns >= 1` 决定「有没有可沉淀的东西」→ 用户明明问过却被拒；
 *   - 首轮注入的判据会以为「还没灌过」→ 历史里出现**两份**底座谱（`inspectSessionLog().hasContext` 就是防这一条的）。
 *
 * 判据只有一条：**会话日志**（正文的权威，ADR-0009 Consequences）。`user/message` 且
 * `source.kind === 'user'` 的是「人说的」（含玄枢代发的那一问）；我们注入的上下文
 * （`xuanshu-consult`）与采用稿（`xuanshu-bestof-adopted`）都不算。
 *
 * 两条**刻意不编数**的口径：
 *   - `ctx.sessionQuery` 缺席 → `null`（「核不了」）。**不是**「没有」。
 *   - `readSession` 抛「会话不存在」（还没落盘） → `{questions: [], hasContext: false}`（「确实还没有」）；
 *     抛别的错 → `null`（读不动 ≠ 没说过，宁可不知道）。
 *
 * 成本：只在 `turns === 0` 时读一次日志（核对过就记进旁挂清单，之后不再读）。
 * 边界：核对发生在**玄枢接手这个会话的那一刻**（`consult.send` / `sediment.draft`）；
 * 一次纯原生的会话在玄枢下一次接手之前，旁挂清单里的 `turns` 仍是 0 —— 这条边界是刻意的，
 * 它换掉了「常驻监听 `session/event`」（那会让每次问事漏一个监听器，见 `turn.mjs` 与 send 的退订断言）。
 */
import { isSessionNotFound } from './history.mjs'
import { DEFAULT_CONSULT_TITLE, titleFromQuestion } from './store.mjs'

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/** 一条 `user/message` 事件里的正文（多段文本换行拼接；没有文本段 → 空串）。 */
function questionTextOf(event) {
  const blocks = event?.data?.content
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string' && block.text !== '')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/** 人说的那一句（不是我们注入的上下文 / 采用稿 / 系统消息）。 */
const isUserQuestion = (event) => event?.type === 'user/message' && event.data?.source?.kind === 'user'

/**
 * 读一次会话日志，看这一场问事里「人说过什么」。
 *
 * @param {object} ctx cordis 宿主上下文
 * @param {string} sessionId 问事会话 id
 * @returns {Promise<{questions: string[], hasContext: boolean}|null>} `null` = 核不了（服务缺席 / 读不动）
 */
export async function inspectSessionLog(ctx, sessionId) {
  const query = softGet(ctx, 'sessionQuery')
  if (typeof query?.readSession !== 'function') return null
  let snapshot
  try {
    snapshot = await query.readSession(sessionId)
  } catch (error) {
    // 「会话还不存在」= 一句话都还没说过（确实没有）；别的错误 = 读不动（不知道，不编）。
    return isSessionNotFound(error) ? { questions: [], hasContext: false } : null
  }
  const events = Array.isArray(snapshot?.events) ? snapshot.events : []
  return {
    questions: events.filter(isUserQuestion).map(questionTextOf).filter((text) => text !== ''),
    hasContext: events.some((event) => event?.type === 'user/message' && event.data?.source?.kind === 'xuanshu-consult'),
  }
}

/**
 * 把旁挂清单的 `turns` 与会话日志核对一次（只在 `turns === 0` 时真的去读）。
 *
 * 核对的**副作用**只有一处：`turns`（以及还没定过标题时的 `title` —— 原生 composer 说的那一句
 * 同样是「首问」，不许被下一句顶掉）。
 *
 * @param {object} ctx cordis 宿主上下文
 * @param {{read: Function, update: Function}} store 问事旁挂清单仓库（`createConsultStore()`）
 * @param {string} sessionId
 * @returns {Promise<{manifest: object|null, log: {questions: string[], hasContext: boolean}|null}>}
 *          `manifest` 是核对后的清单（记录不存在 → `null`）；`log` 只在真的读过时非空
 */
export async function reconcileTurns(ctx, store, sessionId) {
  const manifest = store.read(sessionId)
  if (manifest === null) return { manifest: null, log: null }
  if (manifest.turns > 0) return { manifest, log: null } // 已经记过账：不再读日志（成本）
  const log = await inspectSessionLog(ctx, sessionId)
  if (log === null || log.questions.length === 0) return { manifest, log }
  const patch = { turns: log.questions.length }
  if (manifest.title === DEFAULT_CONSULT_TITLE) patch.title = titleFromQuestion(log.questions[0])
  return { manifest: store.update(sessionId, patch) ?? manifest, log }
}
