/**
 * packages/xuanshu-host/lib/digao/tasks.mjs —— 两条 daily 任务的**共用身份**与 schedule 读面。
 *
 * ## 环是怎么解的（task-3 要求写在文件头，别按旧结构找）
 *
 * 原来的形状：`digao/service.mjs` import `rikke/daily-tasks.mjs`（要 `DIGAO_TASK_TITLE`、
 * `findDailyTask`、`scheduleSummary`）。task-2/task-3 之后到点那条链长成了
 * `rikke/daily-tasks → rikke/delivery → digao/generate`，于是只要下面任一条件成立，模块图就来环：
 *
 *   - `digao/generate.mjs` import `digao/service.mjs`（比如想复用 `writeAtomic` / 文件名）⇒
 *     环：`digao/service → rikke/daily-tasks → rikke/delivery → digao/generate → digao/service`；
 *   - `digao/generate.mjs`（或本文件）import `rikke/**` ⇒
 *     环：`rikke/daily-tasks → rikke/delivery → digao/generate → rikke/daily-tasks`。
 *
 * 两刀（缺一不可）：
 *   ① 生成链要用的**文件读写**抽到 `digao/store.mjs` —— `digao/generate.mjs` 不 import
 *      `digao/service.mjs`；
 *   ② 两条任务的**身份**（名字 / 提示词 / 默认时刻 / 会话前缀）与 **schedule 读面**
 *      （`scheduleService` / `findDailyTask` / `scheduleSummary` / 时刻格式化）搬进**本文件** ——
 *      它只 import node 内置模块，是**叶子**；谁都能 import 它，它不 import 任何业务模块。
 *
 * 结果：没有环（`.scratch/rikke-chain/check-cycles.mjs` 在 `lib/**` 上可复算）。
 * `rikke/daily-tasks.mjs` 把这些名字**再导出**同一份绑定（不是副本），所以老的引用点
 * （`rikke/service.mjs`、`digao/service.mjs` 的历史面、`tests/**`）不用跟着改。
 *
 * **为什么这个中立面住在 `lib/digao/`**：写作用域只给了 `lib/digao/` 与 `lib/rikke/` 两个目录
 * （Lead 已登记「共享常量挪到中立模块」），而只有放在 digao 侧才能让 `digao/service.mjs`
 * **不再** import `rikke/**`。若 Lead 要把它挪到 `lib/schedule/`，整文件平移即可
 * （引用点只有 `rikke/daily-tasks.mjs`、`rikke/delivery.mjs`、`digao/service.mjs` 三处）。
 *
 * API 出处（本机实装 0.2.0-rc.2，只读核对）：
 *   - `ctx.schedule.create(sessionId, {title, prompt, daily:{time, time_zone}})`：`dsh-schedule/lib/types/index.d.ts:68`；
 *   - `ctx.schedule.catalog()`：同文件 `:81`（**所有**任务的 sessionId 绑定都在这儿 —— 幂等的唯一依据）；
 *   - `ctx.schedule.update({sessionId, id, expected, change})`：同文件 `:111`（**compare-and-update**，
 *     `expected` 必须是完整 observed record：`dsh-schedule/lib/types/types.d.ts:359-364`）。
 */

import { randomUUID } from 'node:crypto'

/** 缺省时区（底座还没立、快照里没有 zone 时用）。 */
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai'

/** 任务名（**同时是幂等键**：catalog 里按它找自己那条）。 */
export const RIKKE_TASK_TITLE = '日课'
export const DIGAO_TASK_TITLE = '底稿刷新'
/** #25：晚间触达（晚省）。 */
export const WANSHENG_TASK_TITLE = '晚省'

/** 缺省时刻（契约 §1/§2 定值；错开一小时，免得两条任务在同一分钟抢会话）。 */
export const RIKKE_DEFAULT_TIME = '07:30:00'
export const DIGAO_DEFAULT_TIME = '03:30:00'
/** #25 契约 §2：晚省缺省 21:30。 */
export const WANSHENG_DEFAULT_TIME = '21:30:00'

/** 会话 id 前缀（ADR-0009：`session-xs-<kind>-<uuid>`；到点认领也按它认人）。 */
export const RIKKE_SESSION_PREFIX = 'session-xs-rikke-'
export const DIGAO_SESSION_PREFIX = 'session-xs-digao-'
/** #25：晚省会话前缀（`delivery.mjs` 按它认领）。 */
export const WANSHENG_SESSION_PREFIX = 'session-xs-wansheng-'

/** kind → 会话 id 前缀（**这一份是唯一来源**，别处不再写第二遍字面量）。 */
const SESSION_PREFIXES = Object.freeze({
  rikke: RIKKE_SESSION_PREFIX,
  digao: DIGAO_SESSION_PREFIX,
  wansheng: WANSHENG_SESSION_PREFIX,
})

/**
 * 玄枢自铸会话 id（ADR-0009）。
 *
 * 为什么未知 kind 直接抛：前缀要跟到点那条链认的**同一个**字面量对上，写错一个字母就会得到
 * 「任务建了、会话建了、到点却永远不生成」的静默失败 —— 这里宁可当场红。
 */
export function newSessionId(kind) {
  const prefix = SESSION_PREFIXES[kind]
  if (prefix === undefined) {
    throw new Error(`未知的 daily 任务 kind：${JSON.stringify(kind)}（只有 ${Object.keys(SESSION_PREFIXES).join(' / ')}）。`)
  }
  return `${prefix}${randomUUID()}`
}

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
  const schedule = softGet(ctx, 'schedule')
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
 * 日课的提示词（到期由宿主把这条当提醒投进绑定会话并唤醒它）。
 *
 * 措辞必须与实现对齐（复核的老教训：记录不许说一件没发生的事）。到点那一刻宿主**已经**把今天的
 * 产物写好了（`rikke/delivery.mjs` 在 `agent/pre-step` 上跑 `rikke/generate.mjs` 那一份链），
 * 所以这条提醒要的是「读它 + 说人话」，不是让模型自己去推运：模型推不出 schema `xuanshu/rikke@1`
 * 的产物，而它若照旧措辞去「产出今日宜忌」写文件，落点正是它的 cwd `<dataDir>/rikke/`，会把产物写坏。
 */
export const RIKKE_PROMPT = '现在做日课：宿主已按本地黄历把今天这一份写进你的工作目录'
  + '（`<YYYY-MM-DD>.json`，schema `xuanshu/rikke@1`，**不要改写它**）。读它、再读底座谱，'
  + '用一句话说出今日宜、忌与流日，并给最多三条注意事项。'

/**
 * 底稿刷新的提示词。
 *
 * 与日课同一条口径：到点那一刻宿主**已经**按规则骨架重派生过底稿（`digao/delivery` 那一侧跑
 * `digao/generate.mjs` 的 `refreshDigao()`）—— `digao.json` 的 meta、章序与 `【来源：…】` 标记、
 * 摘要的提炼都是宿主才做得对的事，模型写不了。所以这一轮只让它读、说、别动文件
 * （底稿是纯派生物，写它会立刻被下一次派生覆盖，却会让用户以为自己的手改生效了）。
 */
export const DIGAO_PROMPT = '现在刷新底稿：宿主已按规则骨架从谱 / 工作区 / 工作流三路重新派生过它'
  + '（`<dataDir>/digao.md` + `<dataDir>/digao.json`，纯派生 · 不可手改），**不要写这两个文件**。'
  + '读它，用一句话说这次刷新变了什么、或指出哪一路来源还是空的。'

/**
 * 晚省的提示词（#25）。
 *
 * 与日课/底稿同一条口径：**产物由宿主写**（`wansheng/generate.mjs` 的确定性事实），这一轮只让它
 * 读产物、按事实说人话；不许它去写 `<dataDir>/wansheng/`（那是它的 cwd，写坏就没人能修）。
 * 晚省是「摆事实 + 提醒回看」，**不替用户下结论**（spec 002 用户故事 15）。
 */
export const WANSHENG_PROMPT = '现在做晚省：宿主已经把今天的事实写进你的工作目录'
  + '（`wansheng/<YYYY-MM-DD>.json`，schema `xuanshu/wansheng@1`，**不要改写它**）。'
  + '读它，用一两句话把今天发生了什么说清楚（几场问事、哪些项目有活动），并提醒用户回看；'
  + '不要推测吉凶、不要替用户下结论。'
