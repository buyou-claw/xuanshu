/**
 * packages/xuanshu-host/lib/rikke/daily-tasks.mjs — 票 13 两条 daily 定时任务的共用装配。
 *
 * 日课（07:30）与底稿刷新（03:30）是**同一件事的两条**：找一个绑定会话 → 建一条 daily 任务 →
 * 之后能改时间。所以只写一份，避免两处各自漂移（比如一处按 title 去重、另一处不去重，
 * 用户就会收到两份日课提醒）。
 *
 * 放在 `lib/rikke/` 下的理由（写作用域相关，明写在案）：task-7 只给了 `lib/digao/` 与 `lib/rikke/`
 * 两个目录，而契约 §2「定时投递」把这条机制写全了（`agents.create` + `schedule.create` + `setTime`
 * 的 compare-and-update）。**不**再新开 `lib/schedule/` 目录免得越过写作用域。若 Lead 认为该独立成模块，
 * 整文件平移即可（引用点只有本目录的 service.mjs、digao 的 service.mjs 与 lib/index.js 三处）。
 *
 * API 出处（本机实装 0.2.0-rc.2，只读核对）：
 *   - `ctx.schedule.create(sessionId, {title, prompt, daily:{time, time_zone}})`：`dsh-schedule/lib/types/index.d.ts:68`；
 *   - `ctx.schedule.catalog()`：同文件 `:81`（**所有**任务的 sessionId 绑定都在这儿 —— 幂等的唯一依据）；
 *   - `ctx.schedule.update({sessionId, id, expected, change})`：同文件 `:111`（**compare-and-update**，
 *     `expected` 必须是完整 observed record：`dsh-schedule/lib/types/types.d.ts:359-364`）；
 *   - `ctx.agents.create({sessionId, meta:{cwd}})`：`dsh-agent/lib/types/index.d.ts:278` +
 *     ADR-0009（专用 cwd 归属；会话 id 用玄枢自铸前缀）。
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** 任务名（**同时是幂等键**：catalog 里按它找自己那条）。 */
export const RIKKE_TASK_TITLE = '日课'
export const DIGAO_TASK_TITLE = '底稿刷新'

/** 缺省时刻（契约 §1/§2 定值；错开一小时，免得两条任务在同一分钟抢会话）。 */
export const RIKKE_DEFAULT_TIME = '07:30:00'
export const DIGAO_DEFAULT_TIME = '03:30:00'

/** 缺省时区（底座还没立、快照里没有 zone 时用）。 */
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai'

/**
 * `'HH:mm'` / `'HH:mm:ss'` / `'HH:mm:ss.SSS'` → `'HH:mm:ss'`；非法 → null。
 *
 * 为什么要收 `.SSS`：真机 `DailyScheduleRecord.time` 的注释是
 * 「Local time normalized to **HH:mm:ss.SSS**」（`dsh-schedule/lib/types/types.d.ts:63-64`）——
 * 只认 `HH:mm` 的实现会把真机读回来的时间当成非法值。
 */
export function normalizeDailyTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/.exec(String(value ?? '').trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? '0')
  if (hour > 23 || minute > 59 || second > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
}

/** 展示用 `HH:mm`（`'07:30:00.000'` → `'07:30'`）；连 `HH:mm` 都认不出 → 原样回。 */
export function displayTime(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? '').trim())
  if (!match) return String(value ?? '')
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return String(value ?? '')
  return `${String(hour).padStart(2, '0')}:${match[2]}`
}

/** 玄枢自铸会话 id（ADR-0009：`session-xs-<kind>-<uuid>`）。 */
export function newSessionId(kind) {
  return `session-xs-${kind}-${randomUUID()}`
}

/** 非严格读 cordis service。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/** 读 schedule 服务；不可得 → null（调用方给可读理由，不抛）。 */
export function scheduleService(ctx) {
  const schedule = softGet(ctx, 'schedule') ?? ctx?.schedule
  return schedule && typeof schedule.create === 'function' ? schedule : null
}

/**
 * 在 catalog 里找自己那条任务（按名字）。
 *
 * 为什么用 `catalog()` 而不是自己存一份 id：task 表已经是权威（`catalog` 返回**所有**任务及其
 * sessionId 绑定），再存一份旁挂 id 就是第二份权威 —— 会出现「旁挂说任务在、表里其实被删了」。
 * @returns {Promise<object|null>} 完整 observed record（sessionId/status/lastDelivery 都在里面）
 */
export async function findDailyTask(ctx, title) {
  const schedule = scheduleService(ctx)
  if (schedule === null || typeof schedule.catalog !== 'function') return null
  try {
    const entries = await schedule.catalog()
    return (Array.isArray(entries) ? entries : []).find((entry) => entry?.title === title) ?? null
  } catch {
    return null
  }
}

/** 任务的对外摘要（`{time, timeZone, id}`；契约修订 2026-10-15 的三个字段）。 */
export function scheduleSummary(task) {
  if (!task || typeof task !== 'object') return null
  return { time: displayTime(task.time), timeZone: String(task.timeZone ?? ''), id: String(task.id ?? '') }
}

/**
 * 保证某条 daily 任务在场（**幂等**：已有同名任务就复用，不重复建）。
 *
 * @param {{ctx: object, dataDir: string, kind: string, title: string, prompt: string, time: string, timeZone: string}} input
 * @returns {Promise<{ok: boolean, reason: string|null, task: object|null, reused: boolean}>}
 */
export async function ensureDailyTask({ ctx, dataDir, kind, title, prompt, time, timeZone }) {
  const schedule = scheduleService(ctx)
  if (schedule === null) {
    return {
      ok: false,
      reused: false,
      task: null,
      reason: 'ctx.schedule 不可得：profile 没启用 `@deepseek-ai/dsh-experimental-schedule-bundle`（'
        + '本仓库 `packages/xuanshu-host/cordis.patch.yml` 插了它的三行；装完要重跑 `node scripts/install-profile.mjs --home .dsh-home`）。',
    }
  }
  const daily = normalizeDailyTime(time) ?? normalizeDailyTime(RIKKE_DEFAULT_TIME)

  const existing = await findDailyTask(ctx, title)
  if (existing !== null) {
    return { ok: true, reused: true, task: scheduleSummary(existing), reason: null }
  }

  const agents = softGet(ctx, 'agents') ?? ctx?.agents
  if (!agents || typeof agents.create !== 'function') {
    return { ok: false, reused: false, task: null, reason: 'ctx.agents 不可得：定时任务必须绑在一个会话上（宿主建会话的能力没就绪）。' }
  }

  const sessionId = newSessionId(kind)
  const cwd = join(dataDir, kind)
  try {
    // 专用 cwd = ADR-0009 的归属载体之一（不是 workspace）；先建目录，别让建会话去猜。
    mkdirSync(cwd, { recursive: true })
    await agents.create({ sessionId, meta: { cwd } })
  } catch (error) {
    return { ok: false, reused: false, task: null, reason: `建定时会话失败（${String(error?.message ?? error)}）。` }
  }

  try {
    const record = await schedule.create(sessionId, { title, prompt, daily: { time: daily, time_zone: timeZone } })
    return { ok: true, reused: false, task: scheduleSummary(record), reason: null }
  } catch (error) {
    return { ok: false, reused: false, task: null, reason: `建 daily 任务失败（${String(error?.message ?? error)}）。` }
  }
}

/**
 * 改某条 daily 任务的时间（compare-and-update，契约 §2）。
 * @returns {Promise<{ok: boolean, reason: string|null, schedule: object|null}>}
 */
export async function updateDailyTime({ ctx, title, time }) {
  const schedule = scheduleService(ctx)
  if (schedule === null || typeof schedule.update !== 'function') {
    return { ok: false, schedule: null, reason: 'ctx.schedule 不可得：改不了定时时间。' }
  }
  const daily = normalizeDailyTime(time)
  if (daily === null) return { ok: false, schedule: null, reason: `时间格式不对（${JSON.stringify(time)}）：要 HH:mm。` }

  const observed = await findDailyTask(ctx, title)
  if (observed === null) {
    return { ok: false, schedule: null, reason: `没找到「${title}」这条 daily 任务：先在装配期建出来（重跑 install-profile）再改时间。` }
  }
  try {
    const result = await schedule.update({
      sessionId: observed.sessionId,
      id: observed.id,
      expected: observed, // 完整 observed record：compare-and-update 的前提
      change: { kind: 'daily', daily: { time: daily, time_zone: observed.timeZone } },
    })
    if (result?.updated !== true) {
      return { ok: false, schedule: null, reason: `定时时间没改成功（${result?.code ?? '未知原因'}）：任务可能已被改过或已停用，刷新后再试。` }
    }
    return { ok: true, schedule: scheduleSummary(result.record ?? observed), reason: null }
  } catch (error) {
    return { ok: false, schedule: null, reason: `改定时时间失败（${String(error?.message ?? error)}）。` }
  }
}

/** 日课的提示词（到期由宿主把这条当 followup 投进绑定会话并唤醒它）。 */
export const RIKKE_PROMPT = '现在做日课：读底座谱 + 当前时刻调 horosa 黄历，产出今日宜忌与注意事项。'
/** 底稿刷新的提示词。 */
export const DIGAO_PROMPT = '现在刷新底稿：读谱 / 工作区 / 工作流三路来源，按规则骨架生成底稿（要改就改源头）。'

/**
 * 装配两条 daily 任务（**永不抛**；每条各自成败，理由原样带回）。
 * @returns {Promise<{rikke: object, digao: object, timeZone: string, notes: string[]}>}
 */
export async function installDailyTasks({ ctx, dataDir, timeZone = DEFAULT_TIME_ZONE }) {
  const notes = []
  const rikke = await ensureDailyTask({
    ctx, dataDir, kind: 'rikke', title: RIKKE_TASK_TITLE, prompt: RIKKE_PROMPT, time: RIKKE_DEFAULT_TIME, timeZone,
  })
  if (!rikke.ok) notes.push(`日课定时未建：${rikke.reason}`)
  const digao = await ensureDailyTask({
    ctx, dataDir, kind: 'digao', title: DIGAO_TASK_TITLE, prompt: DIGAO_PROMPT, time: DIGAO_DEFAULT_TIME, timeZone,
  })
  if (!digao.ok) notes.push(`底稿刷新定时未建：${digao.reason}`)
  return { rikke, digao, timeZone, notes }
}
