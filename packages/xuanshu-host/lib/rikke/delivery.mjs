/**
 * packages/xuanshu-host/lib/rikke/delivery.mjs — 定时到点 → **跑生成链**（复核 Spec 1 的修复处）。
 *
 * 两条 daily 任务各有一条链，到点都由这里认领（task-2 接日课，task-3 接底稿）：
 *   - `session-xs-rikke-` → `rikke/generate.mjs` 的 `generateRikke()`（`manual:false`）；
 *   - `session-xs-digao-` → `digao/generate.mjs` 的 `refreshDigao()`。
 * 两条都**在宿主侧跑、不依赖模型**，因此即使 provider 挂了，到点照样出日课 / 底稿。
 *
 * 机制（钉版 rc.2 实装，只读核对）：`ctx.schedule` 到点后 `resolveAgent(task.sessionId)` →
 * 造一条 `source:{kind:'schedule'}` 的 user 消息 → `agent.followup(message)` → `sessions.flush`
 * —— **真唤醒那个会话、开一个 turn**（`dsh-schedule/lib/index.js:1576-1597`）。也就是说投递
 * 那一刻就是一个确定的执行时机：我们只要在 `agent/pre-step`（每一步模型输入成型的边界；
 * 随包先例 `dsh-time-context/lib/index.js:242-246`，本仓库另一处用法见 `consult/boundary.mjs`）
 * 上认领「这条 daily 会话收到的这一步里有定时提醒」，就地把生成链跑掉。
 *
 * **为什么在宿主侧跑，而不是让会话里的模型去做**（这是复核那条「未接可执行生成链」的正面回答）：
 *   - 两份产物都是**确定性**内容：日课 = 读底座 + 当前时刻的黄历（设计稿 S14 §4「生成只做两件事：
 *     读底座、取当前时刻」）；底稿 = 规则骨架 + 来源标记 + 一段 LLM 压缩（契约 §1：骨架与标记
 *     不经过 LLM）。模型既不必要（它产不出 schema 与章序/三键契约的那份产物），而两个会话的 cwd
 *     正是产物所在目录 —— 让模型去「产出」它，最坏会把产物写坏。
 *   - 模型/服务不可得时到点**照样出产物**：定时任务不会因为 provider 挂了而空转。
 *
 * 三条门（写在这儿，免得下一轮被「简化」掉）：
 *   - `step !== 1` → 一轮只在第一步做：定时提醒走的是 `agent.followup()`，而 `followup` 落到
 *     **next-turn** 待办（`dsh-agent-loop/lib/index.js:806-807`）、只有新 turn 的第一步会 claim 它
 *     （`claim(target, turn)` 仅在 `target === 'next-turn'` 时取那一列，`:103-111`）——所以第一步是
 *     投递唯一会到的那一步，后面几步是同一轮的工具循环；
 *   - 会话 id 必须是玄枢自铸的 daily 前缀（`rikke/…` 与 `digao/…` 各认各的；前缀常量在
 *     `../digao/tasks.mjs`，与铸 id 用的是同一份）；
 *   - 这一步 claim 的消息里必须有 `source.kind === 'schedule'` 的那条（用户自己问的话不算到点）。
 *
 * 纪律：**永不抛**（catch 住只记日志）—— 生成失败不该把那一轮问答弄挂，下一次投递再试。
 *
 * 解环相关（task-3）：本文件 import `../digao/generate.mjs`，因此 `digao/generate.mjs`
 * **不许**反过来 import `rikke/**`（那会成环）。完整说明写在 `../digao/tasks.mjs` 的文件头。
 */

import { refreshDigao } from '../digao/generate.mjs'
import { DIGAO_SESSION_PREFIX, RIKKE_SESSION_PREFIX } from '../digao/tasks.mjs'
import { generateRikke, zoneFor } from './generate.mjs'
import { dateInZone } from './store.mjs'

/** 注册的事件名（DSH 的 pre-step waterfall；随包 `dsh-time-context` 同款）。 */
export const PRE_STEP_EVENT = 'agent/pre-step'

/** 这条会话是不是日课 / 底稿的定时会话（ADR-0009 的 `session-xs-<kind>-<uuid>`）。 */
export function isRikkeDailySession(sessionId) {
  return typeof sessionId === 'string' && sessionId.startsWith(RIKKE_SESSION_PREFIX)
}

export function isDigaoDailySession(sessionId) {
  return typeof sessionId === 'string' && sessionId.startsWith(DIGAO_SESSION_PREFIX)
}

/**
 * 这一步 claim 的消息里有没有定时提醒（`dsh-schedule` 造的消息就带这个 source）。
 * @param {unknown} messages loop 交给 pre-step 的 claimed 消息
 */
export function hasScheduleReminder(messages) {
  return (Array.isArray(messages) ? messages : []).some((message) => message?.source?.kind === 'schedule')
}

/** 带作用域名的 logger；宿主没装 logger 时静默（断言台就是这种现场）。 */
function namedLogger(ctx) {
  try {
    if (typeof ctx?.logger === 'function') {
      const scoped = ctx.logger('xuanshu-host')
      if (scoped !== null && scoped !== undefined) return scoped
    }
  } catch {
    /* 落到静默替身 */
  }
  return { info() {}, warn() {} }
}

/**
 * 把「到点 → 生成链」接到 `agent/pre-step` 边界上（两条 daily 任务共用一条边界）。
 *
 * @param {object} ctx cordis 宿主上下文（需要 `ctx.on`）
 * @param {{dataDir: string, timeZone?: string, now?: () => Date}} config
 *        `timeZone`：底座快照不可得时的兜底（装配期那一份）；`now` 只为断言台留
 * @returns {{ok: boolean, reason: string|null, dispose: Function}} **永不抛**
 */
export function installDailyDelivery(ctx, { dataDir, timeZone, now } = {}) {
  if (typeof ctx?.on !== 'function') {
    return { ok: false, reason: 'ctx.on 不可得：装不上 `agent/pre-step` 边界，定时到点不会跑生成链。', dispose: () => {} }
  }
  const logger = namedLogger(ctx)
  const at = () => (typeof now === 'function' ? now() : new Date())

  /** 日课那条链（底座快照 + 本地黄历 → `<dataDir>/rikke/<日期>.json`）。 */
  async function runRikke(moment) {
    try {
      const zone = zoneFor(dataDir, timeZone)
      const generated = await generateRikke({
        ctx,
        dataDir,
        date: dateInZone(zone, moment),
        zone,
        manual: false, // 「定时产出的那一份」（人点那条是 true）
        at: moment,
      })
      if (generated.ok) {
        logger.info('定时任务到点：日课 %s 已生成（manual=false）', generated.date)
      } else {
        // 如实记，不假装成了：界面那边看到的是「今天还没有日课」+ 可重试，下一次投递会再来一遍。
        logger.warn('日课到点没生成（%s）：%s', generated.date, generated.reason)
      }
    } catch (error) {
      logger.warn('日课到点跑生成链时抛了异常（已兜住，不影响这一轮）：%s', String(error?.message ?? error))
    }
  }

  /** 底稿那条链（三路来源 + 规则骨架 + 一段 LLM 压缩 → `<dataDir>/digao.{md,json}`）。 */
  async function runDigao(moment) {
    try {
      const refreshed = await refreshDigao({ ctx, dataDir, now: moment })
      logger.info(
        '定时任务到点：底稿已重派生（段 %s / 来源 %s 路 / digest=%s）',
        refreshed.meta.segments,
        refreshed.meta.sources,
        refreshed.meta.digest,
      )
      // 某一路没读上 / LLM 没提炼：产物本身仍然是对的（骨架 + 如实标注），但理由要说出来。
      for (const note of refreshed.notes) logger.warn('底稿到点的一路来源没读上：%s', note)
    } catch (error) {
      // 写盘失败照抛到这儿：只记日志，不动那一轮（「必须让用户知道」的义务在 RPC 那条路上）。
      logger.warn('底稿到点刷新失败：%s', String(error?.message ?? error))
    }
  }

  async function onPreStep(payload, next) {
    const decision = await next()
    try {
      if (decision === undefined || decision === null || decision?.kind === 'reject') return decision
      if (payload?.step !== 1) return decision
      if (payload?.signal?.aborted === true) return decision
      if (!hasScheduleReminder(payload?.messages)) return decision
      const sessionId = payload?.agent?.session?.id
      const moment = at()
      if (isRikkeDailySession(sessionId)) await runRikke(moment)
      else if (isDigaoDailySession(sessionId)) await runDigao(moment)
    } catch (error) {
      logger.warn('定时任务到点跑生成链时抛了异常（已兜住，不影响这一轮）：%s', String(error?.message ?? error))
    }
    return decision
  }

  const dispose = ctx.on(PRE_STEP_EVENT, onPreStep)
  return { ok: true, reason: null, dispose: typeof dispose === 'function' ? dispose : () => {} }
}
