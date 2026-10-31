/**
 * packages/xuanshu-host/lib/rikke/daily-tasks.mjs — 票 13 两条 daily 任务的共用装配。
 *
 * 日课（07:30）与底稿刷新（03:30）是**同一件事的两条**：找一个绑定会话 → 建一条 daily 任务 →
 * 之后能改时间。所以只写一份，避免两处各自漂移（比如一处按 title 去重、另一处不去重，
 * 用户就会收到两份日课提醒）。
 *
 * 放在 `lib/rikke/` 下的理由（写作用域相关，明写在案）：task-7 只给了 `lib/digao/` 与 `lib/rikke/`
 * 两个目录，而契约 §2「定时投递」把这条机制写全了。**不**再新开 `lib/schedule/` 目录免得越过写作用域。
 *
 * 复核 Spec 1 的修复（2026-10-16）：这里的绑定会话**不再裸 create**（原来那行在 142 行），
 * 而是走与问事同一份「跑得起来的会话」组合；并且两条任务**到点那一刻都真跑生成链**
 * （`delivery.mjs` 在 `agent/pre-step` 上跑 `rikke/generate.mjs` / `digao/generate.mjs`）——
 * 原来只投一句话给一个没有模型、没有工具的会话，一个字节都不落盘。
 *
 * **本文件只留「装配」**（task-3 拆过）：两条任务的身份（名字 / 提示词 / 默认时刻 / 会话前缀）与
 * schedule 读面在 `../digao/tasks.mjs`（中立叶子），到点的两条链在 `./delivery.mjs`。
 * 拆法是解 import 环的两刀之一 —— 完整解法写在 `../digao/tasks.mjs` 的文件头。
 * 下面的 `export { … }` 是同一份绑定的**再导出**（不是副本），老引用点不用跟着搬。
 *
 * API 出处（本机实装 0.2.0-rc.2，只读核对）：
 *   - `ctx.schedule.create(sessionId, {title, prompt, daily:{time, time_zone}})`：`dsh-schedule/lib/types/index.d.ts:68`；
 *   - 到点投递：`dsh-schedule/lib/index.js:1576-1597`（`resolveAgent` → `followup` → 真开一个 turn）。
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { consultAgentCapability, createConsultAgent } from '../consult/agent.mjs'
import { readTouchTimes } from '../notify/settings.mjs'
import { installDailyDelivery } from './delivery.mjs'
import { settleMissedTouches } from './missed.mjs'
import {
  DEFAULT_TIME_ZONE, DIGAO_DEFAULT_TIME, DIGAO_PROMPT, DIGAO_TASK_TITLE,
  RIKKE_DEFAULT_TIME, RIKKE_PROMPT, RIKKE_TASK_TITLE,
  WANSHENG_DEFAULT_TIME, WANSHENG_PROMPT, WANSHENG_TASK_TITLE,
  findDailyTask, newSessionId, normalizeDailyTime, scheduleService, scheduleSummary,
} from '../digao/tasks.mjs'

// 兼容面：这些名字原来定义在本文件里（`rikke/service.mjs`、`lib/index.js`、`tests/**` 都在用；
// `digao/service.mjs` 这一轮已改成直接 import 自己的 `./tasks.mjs`，不再绕经 rikke）。
// 单一来源是 `../digao/tasks.mjs` —— 这里是同一份绑定的再导出，不是副本。
export {
  DEFAULT_TIME_ZONE, DIGAO_DEFAULT_TIME, DIGAO_PROMPT, DIGAO_SESSION_PREFIX, DIGAO_TASK_TITLE,
  RIKKE_DEFAULT_TIME, RIKKE_PROMPT, RIKKE_SESSION_PREFIX, RIKKE_TASK_TITLE,
  WANSHENG_DEFAULT_TIME, WANSHENG_PROMPT, WANSHENG_SESSION_PREFIX, WANSHENG_TASK_TITLE,
  displayTime, findDailyTask, newSessionId, normalizeDailyTime, scheduleService, scheduleSummary,
} from '../digao/tasks.mjs'

/** 装配期日志（拿不到 logger 就静默；断言台/裁剪宿主是这种现场）。 */
function softLogger(ctx) {
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

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/**
 * 建一条每日定时任务的绑定会话 —— **不能裸 create**（复核 Spec 1 指的就是这一行）。
 *
 * 裸 `ctx.agents.create({sessionId, meta:{cwd}})` 建出来的会话没有 provider/model、也没有 preset
 * 挂出来的工具：宿主到点把它唤醒时**一个 turn 都跑不起来**（实装 `dsh-agent-loop/lib/index.js:1185`
 * 在第一轮请求前抛 `has no provider/model: …`）。所以走**与问事会话同一份**组合
 * （`consult/agent.mjs` 的 `createConsultAgent`：resolve preset + 默认模型 + 把 preset 挂进 agent scope）。
 * 那是本仓库里「建一个跑得起来的会话」的唯一一份实现 —— 复制一份就是平行实现，迟早漂移
 * （`pruneStale` 六份复制后判据写反，是本仓库已付过的学费）。
 *
 * **软降级**（与 consult 同一口径，且「失败不许把定时任务本身弄挂」）：
 *   - `agentPresets` / `agentDefaultModel` 不在场（裁剪 profile / 断言台）→ 退回契约 §4 字面的裸
 *     create，**不算失败、不记理由**（那是 profile 的缺口，由装配报告 S2/S3 去报）；
 *   - 组合过程真的抛了 → 退回裸 create 并把理由带回去（装配期记一条 warn）。
 * 两种情况下**会话都建得出来**：定时任务要有绑定对象，而且日课产物由宿主侧的确定性链产出
 * （`delivery.mjs`），不依赖模型 —— 模型不可得只是那一轮说不出话，不是日课生成不了。
 *
 * 为什么先问 `consultAgentCapability()` 再建：`createConsultAgent` **自己**就会软降级成裸 create
 * （它不抛），只凭「没抛」分不出「真组合了 preset/模型」与「其实退回了裸建」。能力判据问的是同一个
 * 来源（那两行 service 在不在），所以我们记的 `composed` 是**事实**，不是猜的。
 *
 * @returns {Promise<{composed: boolean, reason: string|null}>}
 */
async function createDailySession({ ctx, agents, sessionId, cwd }) {
  const capable = consultAgentCapability(ctx)
  if (!capable.ok) {
    softLogger(ctx).warn('定时会话降级为裸建（缺 %s）：%s', capable.missing.join('、'), capable.detail)
    await agents.create({ sessionId, meta: { cwd } })
    return { composed: false, reason: null }
  }
  try {
    await createConsultAgent(ctx, { sessionId, cwd })
    return { composed: true, reason: null }
  } catch (error) {
    const detail = String(error?.message ?? error)
    try {
      await agents.create({ sessionId, meta: { cwd } })
    } catch (bareError) {
      // 两条路都没成就没得降级了：这里抛，由调用方折成可读理由（任务不建，但装配不受影响）。
      throw new Error(`组合与裸建都没成（${detail} / ${String(bareError?.message ?? bareError)}）`)
    }
    return { composed: false, reason: `组合 agent preset / 默认模型失败（${detail}）` }
  }
}

/**
 * 保证某条 daily 任务在场（**幂等**：已有同名任务就复用，不重复建）。
 *
 * @param {{ctx: object, dataDir: string, kind: string, title: string, prompt: string, time: string, timeZone: string}} input
 * @returns {Promise<{ok: boolean, reason: string|null, task: object|null, reused: boolean,
 *                    agent: {composed: boolean, reason: string|null}|null}>}
 *          `agent`：新建会话时的组合结果（`null` = 没建会话，比如任务已存在、或建之前就失败了）。
 */
export async function ensureDailyTask({ ctx, dataDir, kind, title, prompt, time, timeZone }) {
  const schedule = scheduleService(ctx)
  if (schedule === null) {
    return {
      ok: false,
      reused: false,
      task: null,
      agent: null,
      reason: 'ctx.schedule 不可得：profile 没启用 `@deepseek-ai/dsh-experimental-schedule-bundle`（'
        + '本仓库 `packages/xuanshu-host/cordis.patch.yml` 插了它的三行；装完要重跑 `node scripts/install-profile.mjs --home .dsh-home`）。',
    }
  }
  const daily = normalizeDailyTime(time) ?? normalizeDailyTime(RIKKE_DEFAULT_TIME)

  const existing = await findDailyTask(ctx, title)
  if (existing !== null) {
    return { ok: true, reused: true, task: scheduleSummary(existing), agent: null, reason: null }
  }

  const agents = softGet(ctx, 'agents')
  if (!agents || typeof agents.create !== 'function') {
    return { ok: false, reused: false, task: null, agent: null, reason: 'ctx.agents 不可得：定时任务必须绑在一个会话上（宿主建会话的能力没就绪）。' }
  }

  const sessionId = newSessionId(kind)
  const cwd = join(dataDir, kind)
  let agent
  try {
    // 专用 cwd = ADR-0009 的归属载体之一（不是 workspace）；先建目录，别让建会话去猜。
    mkdirSync(cwd, { recursive: true })
    agent = await createDailySession({ ctx, agents, sessionId, cwd })
  } catch (error) {
    return { ok: false, reused: false, task: null, agent: null, reason: `建定时会话失败（${String(error?.message ?? error)}）。` }
  }

  try {
    const record = await schedule.create(sessionId, { title, prompt, daily: { time: daily, time_zone: timeZone } })
    return { ok: true, reused: false, task: scheduleSummary(record), agent, reason: null }
  } catch (error) {
    return { ok: false, reused: false, task: null, agent, reason: `建 daily 任务失败（${String(error?.message ?? error)}）。` }
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

/**
 * 装配两条 daily 任务 + **到点的生成链**（**永不抛**；每条各自成败，理由原样带回）。
 *
 * 到点那两条链（`installDailyDelivery`）装在这里而不是 `lib/index.js`：它跟这两条任务是同一件事的
 * 两半（任务负责到点、链负责到点之后真的生成），装在一起才不会出现「任务建了、链没装」的半截装配。
 * 装不上（没有 `ctx.on`）**不进 `notes`**：`notes` 的语义是「任务为什么没建」，而这条由本函数
 * 自己记一条 warn —— 而且此时任务照建，界面上的空态与 [改时间] 都还在。
 *
 * @param {{ctx: object, dataDir: string, timeZone?: string, now?: () => Date, env?: Record<string, string|undefined>}} input
 *        `now` 只为断言台留；`env` 是壳的运行时状态文件来源（生产 `process.env`，断言台注入）
 * @returns {Promise<{rikke: object, digao: object, timeZone: string, notes: string[], delivery: {ok: boolean, reason: string|null}}>}
 */
export async function installDailyTasks({ ctx, dataDir, timeZone = DEFAULT_TIME_ZONE, now, env }) {
  const notes = []
  // #25：时刻的期望值在共享设置文件里（缺失 / 坏值回落缺省）。schedule 才是实际生效的权威 ——
  // 这里只决定「安装期按几点建」；改时刻走 `rikke.setTime` / `wansheng.setTime`（改完立即生效）。
  let settings
  try {
    settings = readTouchTimes(dataDir)
  } catch {
    // 设置文件坏到读不出来：按缺省建（不让装配因此失败）。
    settings = { rikkeTime: undefined, wanshengTime: undefined }
  }
  const rikkeTime = normalizeDailyTime(settings.rikkeTime) ?? RIKKE_DEFAULT_TIME
  const wanshengTime = normalizeDailyTime(settings.wanshengTime) ?? WANSHENG_DEFAULT_TIME

  const rikke = await ensureDailyTask({
    ctx, dataDir, kind: 'rikke', title: RIKKE_TASK_TITLE, prompt: RIKKE_PROMPT, time: rikkeTime, timeZone,
  })
  if (!rikke.ok) notes.push(`日课定时未建：${rikke.reason}`)
  // 组合失败是非致命的（会话已退回裸建、任务照建），但**不静默**：它是「到点那一轮说不出话」的根因。
  if (rikke.ok && rikke.agent?.reason) notes.push(`日课定时会话降级：${rikke.agent.reason}`)

  const digao = await ensureDailyTask({
    ctx, dataDir, kind: 'digao', title: DIGAO_TASK_TITLE, prompt: DIGAO_PROMPT, time: DIGAO_DEFAULT_TIME, timeZone,
  })
  if (!digao.ok) notes.push(`底稿刷新定时未建：${digao.reason}`)
  if (digao.ok && digao.agent?.reason) notes.push(`底稿刷新定时会话降级：${digao.agent.reason}`)

  // #25：第三条 daily —— 晚省（21:30，可调）。
  const wansheng = await ensureDailyTask({
    ctx, dataDir, kind: 'wansheng', title: WANSHENG_TASK_TITLE, prompt: WANSHENG_PROMPT, time: wanshengTime, timeZone,
  })
  if (!wansheng.ok) notes.push(`晚省定时未建：${wansheng.reason}`)
  if (wansheng.ok && wansheng.agent?.reason) notes.push(`晚省定时会话降级：${wansheng.agent.reason}`)

  const delivery = installDailyDelivery(ctx, { dataDir, timeZone, now, env })
  if (!delivery.ok) softLogger(ctx).warn('票13 定时到点的生成链没装上：%s', delivery.reason)

  // #25：启动时结算「错过的触达」（关机 / 没打开漏掉的那些）。幂等；失败只记日志。
  // 这一步在 `ctx.inject(['schedule'], …)` 的回调里跑（装配已经返回，不阻塞 apply）。
  const missed = await settleMissedTouches({ ctx, dataDir, timeZone, now, env })
  for (const note of missed.notes) softLogger(ctx).warn('补课：%s', note)
  for (const failure of missed.errors) softLogger(ctx).warn('补课：%s', failure)

  return {
    rikke,
    digao,
    wansheng,
    timeZone,
    notes,
    delivery: { ok: delivery.ok, reason: delivery.reason },
    missed: { ok: missed.ok, days: missed.days },
  }
}
