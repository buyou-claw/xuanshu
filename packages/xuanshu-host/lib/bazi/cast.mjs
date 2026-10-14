/**
 * packages/xuanshu-host/lib/bazi/cast.mjs — 出盘编排（票 08 契约 §2 `bazi.cast` + §3 出盘口径）。
 *
 * 一条直线，每一步的判据都来自冻结契约：
 *   1. `confirmed !== true` → `invalid`（AI 不许静默出盘）；
 *   2. 出生信息校验（缺 / 非有限数 / 越界）→ `invalid`，**不调 horosa、不落一个字节**；
 *   3. payload 交给票 06 的单源纯函数 `buildBaziPayload`（必填五件、`timeAlg` 缺省省略、
 *      确认闸注入、其余旋钮一律不透传）；
 *   4. `ctx.get('xuanshuHorosa').baziBirth(payload)` —— **唯一的出盘通道**（不起 serve、不直连端口），
 *      服务不可得 → `error` 且 message 指向 `pnpm setup:xuanshu`；
 *   5. 信封四态由票 06 的 `classifyBaziEnvelope` 判：`ok` / `gate` / `error` / `invalid`；
 *      `gate` 时把 `agent_recovery.prompt_to_user` **原文**带出去（不许自己编问题）；
 *   6. `ok` → 先落底座谱、再落快照（顺序见下），两步都成了才回 `ok`。
 *
 * **落盘顺序**（S3 §352(e)）：底座谱先、快照后。快照是命盘卡的开关（`bazi.status` 读它），
 * 先写快照再写谱失败 = 「有盘无谱」的半成品，正是 S3 明令不许点亮的那种状态；
 * 反过来失败只是「有谱无盘」，界面仍是空态，再出一次盘就原子替换掉。
 *
 * **四柱缺失**：信封 `ok:true` 但 `fourColumns` 读不全（票 06 会给出 `pillars:null`）时，
 * 按 `error` 处置、不落盘 —— 快照 schema 要求四柱齐（没有四柱的盘点不亮命盘卡，
 * 也不该在底座谱里留下半张盘）。
 */

import { buildBaziPayload, classifyBaziEnvelope } from '../horosa/bazi.mjs'
import { HOROSA_SETUP_COMMAND } from '../horosa/constants.mjs'
import { renderBaseSummary, writeBasePu } from './base-pu.mjs'
import { buildSnapshot, writeSnapshot } from './snapshot.mjs'

/** 出盘通道的服务名（票 06 R8 的 `xuanshuHorosa`）。 */
export const HOROSA_SERVICE = 'xuanshuHorosa'

/** 合法 `timeAlg`（与票 06 `buildBaziPayload` 的白名单同一份口径）。 */
const TIME_ALG_VALUES = [0, 1, 3]

/** 必填的出生信息键（除经纬度外的三个文本字段；经纬度单独按「有限数 + 范围」判）。 */
const REQUIRED_TEXT_FIELDS = ['date', 'time', 'zone']

/** 非空字符串判定（`undefined`/`null`/空白串都算「没给」）。 */
function blank(value) {
  if (value === undefined || value === null) return true
  return typeof value === 'string' && value.trim() === ''
}

/** 有限数归一（数字或数字字符串）；其余 → null。 */
function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value.trim())
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}

/** 非严格读 cordis service（拿不到 → undefined，绝不抛）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/** `invalid` 的一句话结果（契约 §2：`snapshot`/`gate` 都不给）。 */
function invalid(message) {
  return { phase: 'invalid', message }
}

/** `error` 的一句话结果。 */
function failure(message) {
  return { phase: 'error', message }
}

/**
 * 校验 + 归一 `bazi.cast` 的出生信息（契约 §2）。
 *
 * 三条拒绝（都返回 `{ok:false, message}`，调用方一律**不落盘、不调 horosa**）：
 *   - 出生信息整个缺失 / 不是对象；
 *   - `date` / `time` / `zone` 任一为空；
 *   - `lat` / `lon` 非有限数或越界（契约字面是「缺失或非有限数」；越界值同样拒绝 ——
 *     一个 `lat=91` 的出生地会让真太阳时与时区都算出一个**看着像真的**的错值）。
 * @returns {{ok: true, birth: object} | {ok: false, message: string}}
 */
export function normalizeBirth(request) {
  const source = request && typeof request === 'object' && !Array.isArray(request) ? request : {}
  const birth = source.birth
  if (!birth || typeof birth !== 'object' || Array.isArray(birth)) {
    return { ok: false, message: '缺少出生信息（birth）：出盘需要 date / time / zone / lat / lon 五项。' }
  }
  const missing = REQUIRED_TEXT_FIELDS.filter((key) => blank(birth[key]))
  if (missing.length > 0) {
    return { ok: false, message: `出生信息缺 ${missing.join('、')}：这三项是起盘的前提，缺任一都不出盘。` }
  }

  const lat = finiteNumber(birth.lat)
  if (lat === null) {
    return { ok: false, message: '缺纬度 lat（或不是有限数）：缺经纬度禁止出盘 —— 引擎会静默退化成钟表口径，而用户看不见这件事。' }
  }
  const lon = finiteNumber(birth.lon)
  if (lon === null) {
    return { ok: false, message: '缺经度 lon（或不是有限数）：缺经纬度禁止出盘 —— 真太阳时的经度校正就落在这里。' }
  }
  if (lat < -90 || lat > 90) return { ok: false, message: `纬度 lat=${lat} 越界（合法范围 -90..90）。` }
  if (lon < -180 || lon > 180) return { ok: false, message: `经度 lon=${lon} 越界（合法范围 -180..180）。` }

  /** `timeAlg`：缺省 / `null` / 空串 = 没选档（→ 0，真太阳时）；非法档位 → 拒绝。 */
  let timeAlg = 0
  if (!blank(birth.timeAlg)) {
    const numeric = finiteNumber(birth.timeAlg)
    if (numeric === null || !TIME_ALG_VALUES.includes(numeric)) {
      return { ok: false, message: `时间算法 timeAlg 非法（${JSON.stringify(birth.timeAlg)}）：只接受 0（真太阳时）/ 1（直接时间）/ 3（平太阳时）。` }
    }
    timeAlg = numeric
  }

  const normalized = {
    date: String(birth.date).trim(),
    time: String(birth.time).trim(),
    zone: String(birth.zone).trim(),
    lat,
    lon,
    timeAlg,
  }
  if (typeof birth.place === 'string' && birth.place.trim() !== '') normalized.place = birth.place.trim()
  return { ok: true, birth: normalized }
}

/**
 * 四柱归一：优先票 06 的 `fourColumns` 对象，退路是 4 槽数组（票 05 setup 报告的形状）。
 * 四条都是两字干支串才算齐；否则 null（半个盘宁可不要）。
 */
export function normalizePillars(cast) {
  const source = cast && typeof cast === 'object' ? cast : {}
  const slots = ['year', 'month', 'day', 'hour']
  const four = source.fourColumns
  if (four && typeof four === 'object' && slots.every((slot) => typeof four[slot] === 'string' && four[slot] !== '')) {
    return { year: four.year, month: four.month, day: four.day, hour: four.hour }
  }
  const array = Array.isArray(source.pillars) ? source.pillars : null
  if (array && array.length === 4 && array.every((item) => typeof item === 'string' && item !== '')) {
    return { year: array[0], month: array[1], day: array[2], hour: array[3] }
  }
  return null
}

/** 闸的追问归一成 `string[]`（契约 §2）：取每条追问的**原文问题**，没有就用它的机器键。 */
export function gateQuestions(questions) {
  if (!Array.isArray(questions)) return []
  return questions.map((question) => {
    if (typeof question === 'string') return question
    if (question && typeof question === 'object') {
      if (typeof question.question === 'string' && question.question !== '') return question.question
      if (typeof question.field === 'string' && question.field !== '') return question.field
      return JSON.stringify(question)
    }
    return String(question)
  })
}

/**
 * 出盘（契约 §2 的 `bazi.cast`）。
 * @param {{ctx: object, dataDir: string, request?: object}} input
 * @returns {Promise<{phase: 'ok'|'gate'|'error'|'invalid', message: string, snapshot?: object, gate?: object}>}
 */
export async function castBazi({ ctx, dataDir, request }) {
  const source = request && typeof request === 'object' && !Array.isArray(request) ? request : {}

  // ① 人工确认闸：AI 不许静默出盘。
  if (source.confirmed !== true) {
    return invalid('还没有人工确认（confirmed !== true）：八字出盘是写操作，必须由用户在向导上点「确认并出盘」。')
  }

  // ② 出生信息校验：不过关就**一个字节都不落盘、一次都不调 horosa**。
  const checked = normalizeBirth(source)
  if (checked.ok !== true) return invalid(checked.message)
  const { birth } = checked

  // ③ payload 走票 06 的单源纯函数（必填五件 + timeAlg 缺省省略 + 确认闸）。
  const built = buildBaziPayload({
    date: birth.date,
    time: birth.time,
    zone: birth.zone,
    lat: String(birth.lat),
    lon: String(birth.lon),
    timeAlg: source.birth?.timeAlg,
    clarificationNotes: typeof source.notes === 'string' ? source.notes : undefined,
  })
  if (built.ok !== true) return invalid(built.detail)

  // ④ 唯一出盘通道：票 06 的宿主服务（自己管 serve 生命周期）。
  const horosa = softGet(ctx, HOROSA_SERVICE)
  if (!horosa || typeof horosa.baziBirth !== 'function') {
    return failure(`horosa 服务（${HOROSA_SERVICE}）不可得：底座没起来，出不了盘。先跑 \`${HOROSA_SETUP_COMMAND}\` 装好底座，或看 /xuanshu-horosa status。`)
  }

  let cast
  try {
    cast = await horosa.baziBirth(built.payload)
  } catch (error) {
    return failure(`调用 ${HOROSA_SERVICE}.baziBirth() 抛了异常（已兜住）：${String(error?.message ?? error)}`)
  }
  const classified = cast && typeof cast === 'object' ? cast : {}
  const phase = typeof classified.phase === 'string' ? classified.phase : 'invalid'

  // ⑤ 澄清闸：把信封里的追问与 prompt_to_user **原文**带出去（不转述、不编问题、不落盘）。
  if (phase === 'gate') {
    const promptToUser = typeof classified.promptToUser === 'string' ? classified.promptToUser : ''
    return {
      phase: 'gate',
      message: `澄清闸拦截（${classified.code ?? 'agent_guidance.required'}）：上游要求先与用户确认设置再出盘；原文见 gate.promptToUser，本次不落谱、不点亮命盘卡。`,
      gate: { questions: gateQuestions(classified.questions), promptToUser },
    }
  }

  if (phase !== 'ok') {
    const detail = typeof classified.detail === 'string' && classified.detail !== ''
      ? classified.detail
      : `出盘没成功（phase=${phase}${classified.code ? `，code=${classified.code}` : ''}${classified.message ? `：${classified.message}` : ''}）。`
    return failure(detail)
  }

  // ⑥ 四柱读不全 = 出盘失败（P4 §0.1：四柱不全时票 06 给 pillars:null）。
  const pillars = normalizePillars(classified)
  if (pillars === null) {
    return failure('信封 ok 但四柱读不全（data.bazi.fourColumns 缺柱）：快照与底座谱都要求完整四柱，本次不落盘。')
  }

  const generatedAt = new Date().toISOString()
  const horosaMeta = { version: classified.version ?? null, tool: classified.tool ?? null }
  const snapshot = buildSnapshot({ birth, pillars, horosa: horosaMeta, generatedAt })

  // ⑦ 先谱后盘（见文件头）：两步都成了才算出盘成功。
  try {
    writeBasePu(dataDir, { birth, pillars, basis: snapshot.basis, horosa: horosaMeta, generatedAt })
    writeSnapshot(dataDir, snapshot)
  } catch (error) {
    return failure(`八字算出来了，但底座谱 / 快照没写进去：${String(error?.message ?? error)}（本次不点亮命盘卡，避免出现「有盘无谱」的半成品）。`)
  }

  return {
    phase: 'ok',
    message: `出盘成功：四柱 ${pillars.year} ${pillars.month} ${pillars.day} ${pillars.hour}，口径 timeAlg=${birth.timeAlg}，`
      + `快照与底座谱已落盘（${renderBaseSummary({ birth, pillars, basis: snapshot.basis, horosa: horosaMeta, generatedAt }).trim()}）。`,
    snapshot,
  }
}
