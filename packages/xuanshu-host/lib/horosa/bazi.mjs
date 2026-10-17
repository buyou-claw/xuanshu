/**
 * packages/xuanshu-host/lib/horosa/bazi.mjs
 *
 * 八字接缝的**两个纯函数**（票 06 契约 §4.1 / §4.2；名字 / 签名 / 返回形状冻结）：
 *   buildBaziPayload(input)         -> { ok, payload, omitted, problems, code?, missing?, detail, hint }
 *   classifyBaziEnvelope(envelope)  -> { ok, phase, tool, version, timeAlg, timeAlgSource, pillars,
 *                                        pillarSource, techniqueCard, code, message, questions,
 *                                        promptToUser, safeDefaults, confirmationFields, detail }
 *
 * 两个函数**不碰网络、不读盘、不读环境变量**（C 的表驱动单测直接喂对象即可）。
 *
 * 真实形状的依据（契约 §0，Lead 2026-10-13 实测捕获
 * `captures/gt06-envelope-{default,clock,meansolar}.json` / `gt06-gate-raw.json`）：
 *   - 成功信封：`ok:true`、`tool:'bazi_birth'`（**CLI 名**，不是 MCP 名）、`version:'0.40.1'`、
 *     `data.technique_card.settings.timeAlg.value` 是 `timeAlg` 口径的**唯一判据**（四柱不能当判据：
 *     上海 1.48° 经度差 + 均时差 ≈ +2m34s，跨不了时支）；
 *   - 四柱在 `data.bazi.fourColumns.{year,month,day,time}.ganzi`（**时柱的键是 `time`，没有 `hour`**；
 *     17 个键里的 `year/month/day/time` 才是四柱，其余是胎元/命宫/神煞一类的附加列）；
 *   - 澄清闸拦截：HTTP 200 + `isError:false`，但信封 `ok:false` + `error.code='agent_guidance.required'`，
 *     `data:{}`（无四柱）。界面按 S3 §2.7 原文展示 `agent_recovery.prompt_to_user`、不转述、不落谱。
 */

import {
  HOROSA_BAZI_ENVELOPE_TOOL,
  HOROSA_BAZI_OMITTED_KEYS,
  HOROSA_ENVELOPE_REQUIRED_KEYS,
  HOROSA_GATE_CODE,
  HOROSA_TIME_ALG,
} from './constants.mjs'

/** 上游 `technical_required_fields`（真机 tool-list 捕获）：五个都必填，缺任一拒绝出盘。 */
const REQUIRED_FIELDS = ['date', 'time', 'zone', 'lat', 'lon']

/** 干支字符集（判「四柱可读」用；与票 05 `probe.mjs` 同一份口径）。 */
const GAN = '甲乙丙丁戊己庚辛壬癸'
const ZHI = '子丑寅卯辰巳午未申酉戌亥'
const GANZI_RE = new RegExp(`^[${GAN}][${ZHI}]$`)

/** 合法的 timeAlg 三档（三档之外的整数/字符串一律拒）。 */
const TIME_ALG_VALUES = [HOROSA_TIME_ALG.TRUE_SOLAR, HOROSA_TIME_ALG.CLOCK, HOROSA_TIME_ALG.MEAN_SOLAR]

/** 四柱的对外槽位 → 上游 `fourColumns` 的真实键（**时柱是 `time`**，`hour` 只是别名兜底）。 */
const PILLAR_SLOTS = [
  { slot: 'year', keys: ['year'] },
  { slot: 'month', keys: ['month'] },
  { slot: 'day', keys: ['day'] },
  { slot: 'hour', keys: ['hour', 'time'] },
]

/**
 * 缺省确认说明（契约 §4.1：`clarificationNotes` 缺省 = buildBaziPayload 生成的**固定可读文本**）。
 * 固定 = 常量，不掺时间戳/随机数：同一份输入永远得到同一份 payload（可复现，测试好写）。
 */
const DEFAULT_CLARIFICATION_NOTES =
  '玄枢 v1 出盘口径：只透传出生信息（date/time/zone/lat/lon）+（可选）时间算法 timeAlg；'
  + '其余旋钮一律省略，由星阙引擎按缺省决定。本次由用户确认后出盘（agent_confirmed_settings=true）。'

/** 非空字符串判定：`undefined`/`null`/空白串都算「没给」。 */
function blank(value) {
  if (value === undefined || value === null) return true
  return typeof value === 'string' && value.trim() === ''
}

/** 非空字符串规范化（对象/数组也折算成空串）。 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * timeAlg 归一：只收 `0/1/3`（数字，或**数字字符串** —— 归一成数字后透传）。
 *
 * 口径（P3 表逐条钉住）：
 *   - `undefined` / `null` / 空串 = 「没选档」→ **省略该键**（见调用点；不是非法值）；
 *   - 数字 `0/1/3` 与数字字符串 `'0'/'1'/'3'` → 归一成数字；`0` 省略、`1/3` 透传；
 *   - 其余（`2`、`4`、`-1`、`'2'`、`'true'`、`'x'`、布尔…）→ 非法。`2`（春分定卯时）上游自身未实现，
 *     尤其要拦：放过去就是给用户一个点了没反应的档（S3 §3.4）。
 *   「把 `'1'` 静默丢掉（退化成真太阳时）」是绝对不许的 —— 那是用户看不见的口径漂移。
 */
function normalizeTimeAlg(value) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  if (!Number.isInteger(numeric)) return null
  return TIME_ALG_VALUES.includes(numeric) ? numeric : null
}

/** 「没选档」的三种写法（`undefined` / `null` / 空串）都算缺省，不算非法值。 */
function timeAlgMissing(value) {
  if (value === undefined || value === null) return true
  return typeof value === 'string' && value.trim() === ''
}

/**
 * gender 白名单归一（契约 §4.1）：`'1'|'0'|'男'|'女'|1|0|true|false` → `1|0`；其余/缺省 → null（省略）。
 * 为什么归一成数字：上游 `input_normalized.gender` 实测就是 `1`（数字），给字符串要靠上游自己转，
 * 而转法没写在任何契约里 —— 我们自己转，语义就钉死在这一行。
 */
function normalizeGender(value) {
  if (value === true || value === 1) return 1
  if (value === false || value === 0) return 0
  if (typeof value === 'string') {
    const raw = value.trim()
    if (raw === '1' || raw === '男' || raw.toLowerCase() === 'true') return 1
    if (raw === '0' || raw === '女' || raw.toLowerCase() === 'false') return 0
  }
  return null
}

/**
 * 组八字出盘载荷（纯函数，契约 §4.1）。
 *
 * 三条硬规则：
 *   1. `date/time/zone/lat/lon` 必填，缺任一 → `missing-birth-fields` 且 **不产出 payload**
 *      （spec:70：绝不允许静默退化成钟表口径 —— 缺经纬度就没有真太阳时可言）；
 *   2. `timeAlg`：缺省或 `0` → **省略该键**（S3 §D4：不写默认值，让引擎缺省决定）；`1`/`3` 透传；
 *      非法值 → `invalid-time-alg`；
 *   3. 其余旋钮（`HOROSA_BAZI_OMITTED_KEYS`）**一律省略**，调用方传了也丢，并记进 `omitted`。
 *
 * 确认闸（契约 §4.1）：`agentConfirmed !== false` 时注入 `agent_confirmed_settings:true` +
 * `clarification_notes`；`defaultsAccepted === true` 时额外注入 `defaults_accepted:true`。
 * 想走「澄清闸拦截」那条路（测试/CLI 用）就显式传 `agentConfirmed:false`。
 *
 * @param {object} input 出生信息 + 可选 `timeAlg` / `gender` / `agentConfirmed` / `clarificationNotes` / `defaultsAccepted`
 * @returns {{ok:boolean, payload:object|null, omitted:string[], problems:string[], code?:string, missing?:string[], detail:string, hint:string|null}}
 */
export function buildBaziPayload(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {}

  const missing = REQUIRED_FIELDS.filter((key) => blank(src[key]))
  if (missing.length > 0) {
    return {
      ok: false,
      payload: null,
      omitted: [],
      problems: [],
      code: 'missing-birth-fields',
      missing,
      detail: `缺必填出生信息 ${missing.join(', ')}：拒绝产出 payload（缺经纬度就无法按真太阳时出盘，绝不允许静默退化成钟表口径）。`,
      hint: '把这五个字段补齐再出盘：date / time / zone / lat / lon（上游 technical_required_fields）。',
    }
  }

  const payload = {}
  for (const key of REQUIRED_FIELDS) payload[key] = String(src[key]).trim()

  const omitted = []
  const problems = []

  /* ---------- timeAlg（契约 §4.1 第 2 条） ---------- */
  if (timeAlgMissing(src.timeAlg)) {
    omitted.push('timeAlg') // 缺省 = 0 真太阳时，但**不写进载荷**
  } else {
    const timeAlg = normalizeTimeAlg(src.timeAlg)
    if (timeAlg === null) {
      return {
        ok: false,
        payload: null,
        omitted: [],
        problems: [],
        code: 'invalid-time-alg',
        detail: `timeAlg 非法（${JSON.stringify(src.timeAlg)}）：只接受 ${TIME_ALG_VALUES.join(' / ')}（0 真太阳时 / 1 直接时间 / 3 平太阳时）；空值表示「没选档」，请直接省略该键。`,
        hint: '改传 0、1 或 3（默认档 0 的正确做法是**根本不传**这个键）。',
      }
    }
    if (timeAlg === HOROSA_TIME_ALG.TRUE_SOLAR) omitted.push('timeAlg')
    else payload.timeAlg = timeAlg
  }

  /* ---------- gender（白名单；其余一律省略） ---------- */
  if (!blank(src.gender)) {
    const gender = normalizeGender(src.gender)
    if (gender === null) problems.push(`gender=${JSON.stringify(src.gender)} 不在白名单（1/0/男/女/true/false）：已省略，交给引擎缺省。`)
    else payload.gender = gender
  }

  /* ---------- 其余旋钮：一律省略（S3 §D4） ---------- */
  for (const key of HOROSA_BAZI_OMITTED_KEYS) {
    if (src[key] !== undefined) omitted.push(key)
  }

  /* ---------- 确认闸（契约 §4.1 第 4 条） ---------- */
  const confirmed = src.agentConfirmed !== false
  if (confirmed) {
    payload.agent_confirmed_settings = true
    payload.clarification_notes = text(src.clarificationNotes) || DEFAULT_CLARIFICATION_NOTES
    if (src.defaultsAccepted === true) payload.defaults_accepted = true
  }

  const known = new Set([...REQUIRED_FIELDS, 'timeAlg', 'gender', 'agentConfirmed', 'clarificationNotes', 'defaultsAccepted', ...HOROSA_BAZI_OMITTED_KEYS])
  for (const key of Object.keys(src)) {
    if (!known.has(key)) problems.push(`未知键 ${key} 已忽略（v1 只透传出生信息 + timeAlg）。`)
  }

  const algNote = payload.timeAlg === undefined ? '省略（= 0 真太阳时，由引擎缺省决定）' : String(payload.timeAlg)
  return {
    ok: true,
    payload,
    omitted,
    problems,
    detail:
      `载荷就绪：date=${payload.date} time=${payload.time} zone=${payload.zone} lat=${payload.lat} lon=${payload.lon}，`
      + `timeAlg=${algNote}，gender=${payload.gender ?? '省略'}，确认闸=${confirmed ? '已注入 agent_confirmed_settings' + (payload.defaults_accepted ? ' + defaults_accepted' : '') : '未注入（走拦截路径）'}，`
      + `省略 ${omitted.length} 个键${problems.length ? `，${problems.length} 条提示` : ''}。`,
    hint: null,
  }
}

/**
 * 从 `fourColumns` 的一个柱对象里取 2 字干支串。
 * 主键是 `ganzi`（契约 §4.2 写的就是它）；`ganZhi` 是实测里的等价别名，**只在 `ganzi` 缺键时**兜底 ——
 * `ganzi` 存在但为空/非法就是「这一柱读不出来」，不许拿同值的别名把空值糊过去（P4 钉住了这一条）。
 */
function pillarGanzi(node) {
  if (!node || typeof node !== 'object') return null
  const raw = 'ganzi' in node ? text(node.ganzi) : text(node.ganZhi)
  return GANZI_RE.test(raw) ? raw : null
}

/**
 * 从信封里抽四柱（对象形状 `{year,month,day,hour}`；hour 槽来自上游的 `time` 键）。
 * **四个都合法才算**（契约 §4.2）：任一柱读不出来 → `pillars:null` + `pillarSource:null`
 * —— 半个盘比没有盘更危险（界面会点错灯）。
 * @returns {{ pillars: object|null, pillarSource: string|null }}
 */
function extractPillars(data) {
  const fourColumns = data && typeof data === 'object' ? data?.bazi?.fourColumns : undefined
  if (!fourColumns || typeof fourColumns !== 'object') return { pillars: null, pillarSource: null }

  const out = {}
  for (const { slot, keys } of PILLAR_SLOTS) {
    let ganzi = null
    for (const key of keys) {
      ganzi = pillarGanzi(fourColumns[key])
      if (ganzi !== null) break
    }
    if (ganzi === null) return { pillars: null, pillarSource: null }
    out[slot] = ganzi
  }
  return { pillars: out, pillarSource: 'data.bazi.fourColumns' }
}

/**
 * 从信封里取**真太阳时**（票 08 的命盘卡「口径行」要用，票 06 的接缝原本没把它带出来）。
 *
 * 为什么只能解析 `data.snapshot_text`：该版本信封里**没有**结构化的真太阳时字段 ——
 * 结构化的 `data.bazi.directTime` 是「<直运日期> + <本次口径下实际采用的那个时刻>」，
 * 它的**时间部分随 timeAlg 变**（实测同一出生：timeAlg=0 → `12:02:34`、=1 → `12:00:00`、
 * =3 → `12:05:56`），而「真太阳时」按定义恒为真太阳时那一档，只出现在口径文本里。
 * 三份实测信封（`bazi-ok-default` / `-clock` / `-meansolar`）里该行逐字相同：
 *   `直接时间：1990-01-01 12:00:00　真太阳时：1990-01-01 12:02:34`
 *
 * **读不出就返回 null**（调用方省略该键），绝不拿经度自己算一个假值 ——
 * 「录入层不换算」是 spec 明文，真太阳时只能来自上游引擎。
 *
 * @param {object|null} data - 信封的 `data`。
 * @returns {{date: string, time: string}|null} 形如 `{date:'1990-01-01', time:'12:02:34'}`。
 */
export function extractTrueSolarTime(data) {
  const raw = data?.snapshot_text
  if (typeof raw !== 'string' || raw === '') return null
  // 锚在 `真太阳时：<时间戳>` 上（全角/半角冒号都收）：`时间基准：真太阳时(…)` 那行后面没有时间戳，不会命中。
  const match = /真太阳时\s*[：:]\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(raw)
  if (match === null) return null
  return { date: match[1], time: match[2] }
}

/**
 * 分类八字信封（纯函数，契约 §4.2）。
 *
 * phase 判据（**实测**，不是规范猜的）：
 *   'ok'      `envelope.ok === true`
 *   'gate'    `envelope.ok === false` 且 `(error.code ?? code) === 'agent_guidance.required'`
 *   'error'   `envelope.ok === false` 且 code ≠ gate
 *   'invalid' 不是对象 / 缺 `ok` / 缺 `HOROSA_ENVELOPE_REQUIRED_KEYS` 里的键
 *
 * `pillars` 是**对象** `{year,month,day,hour}`（四个都合法才非 null）。
 * `baziBirth()` 会把它摊成 4 槽数组（`[年,月,日,时]`，与票 05 setup 报告的 `pillars` 同形）。
 *
 * @param {object} envelope `tools/call` 返回的信封
 */
export function classifyBaziEnvelope(envelope) {
  const base = {
    ok: false,
    phase: 'invalid',
    tool: null,
    version: null,
    timeAlg: null,
    timeAlgSource: null,
    pillars: null,
    pillarSource: null,
    techniqueCard: null,
    trueSolarTime: null,
    code: null,
    message: null,
    questions: [],
    promptToUser: null,
    safeDefaults: [],
    confirmationFields: [],
    detail: '',
  }

  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ...base, detail: `不是信封：拿到 ${Array.isArray(envelope) ? '数组' : typeof envelope}（信封必须是对象）。` }
  }
  if (!('ok' in envelope)) {
    return { ...base, detail: '不是信封：缺 `ok` 字段（实测信封必带 ok/tool/version/data/summary/warnings/error）。' }
  }
  const missingKeys = HOROSA_ENVELOPE_REQUIRED_KEYS.filter((key) => !(key in envelope))
  if (missingKeys.length > 0) {
    return { ...base, detail: `信封不完整：缺 ${missingKeys.join(', ')}（必需键 ${HOROSA_ENVELOPE_REQUIRED_KEYS.join('/')}）。` }
  }
  // `ok` 必须是布尔：`"true"` 这种真值串要被真值转换糊过去的话，界面会把一个错误信封点亮成命盘卡。
  if (typeof envelope.ok !== 'boolean') {
    return { ...base, detail: `不是信封：ok 不是布尔（拿到 ${typeof envelope.ok}：${JSON.stringify(envelope.ok)}）。` }
  }

  const tool = text(envelope.tool) || null
  const version = text(envelope.version) || null

  /* ---------------- ok:true ---------------- */
  if (envelope.ok === true) {
    const data = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data) ? envelope.data : null
    const techniqueCard =
      data?.technique_card && typeof data.technique_card === 'object' && !Array.isArray(data.technique_card) ? data.technique_card : null

    // timeAlg 口径：首选 technique_card.settings.timeAlg.value（实测的唯一可靠判据），
    // 次选 input_normalized.timeAlg（同一份实测里两者恒等）。
    let timeAlg = null
    let timeAlgSource = null
    const fromCard = techniqueCard?.settings?.timeAlg?.value
    if (typeof fromCard === 'number' && TIME_ALG_VALUES.includes(fromCard)) {
      timeAlg = fromCard
      timeAlgSource = 'technique_card.settings.timeAlg'
    } else {
      const fromInput = envelope.input_normalized?.timeAlg
      if (typeof fromInput === 'number' && TIME_ALG_VALUES.includes(fromInput)) {
        timeAlg = fromInput
        timeAlgSource = 'input_normalized.timeAlg'
      }
    }

    const { pillars, pillarSource } = extractPillars(data)
    const pillarNote = pillars
      ? `四柱 ${[pillars.year, pillars.month, pillars.day, pillars.hour].join(' ')}`
      : '四柱不可读（data.bazi.fourColumns 不全，按 null 处理）'

    const trueSolarTime = extractTrueSolarTime(data)

    return {
      ...base,
      ok: true,
      phase: 'ok',
      tool,
      version,
      timeAlg,
      timeAlgSource,
      pillars,
      pillarSource,
      techniqueCard,
      trueSolarTime,
      detail:
        `出盘成功：tool=${tool ?? '?'}，version=${version ?? '?'}，${pillarNote}，`
        + `timeAlg=${timeAlg ?? '?'}（来源 ${timeAlgSource ?? '未知'}），technique_card=${techniqueCard ? '有' : '缺'}`
        + `，真太阳时=${trueSolarTime ? `${trueSolarTime.date} ${trueSolarTime.time}` : '信封里读不出（省略）'}`
        + `${tool !== null && tool !== HOROSA_BAZI_ENVELOPE_TOOL ? `（注意：tool 不是 ${HOROSA_BAZI_ENVELOPE_TOOL}）` : ''}。`,
    }
  }

  /* ---------------- ok:false ---------------- */
  const error = envelope.error && typeof envelope.error === 'object' ? envelope.error : {}
  const details = error.details && typeof error.details === 'object' ? error.details : {}
  const recovery = details.agent_recovery && typeof details.agent_recovery === 'object' ? details.agent_recovery : {}
  const code = text(error.code) || text(envelope.code) || null
  const message = text(error.message) || text(envelope.message) || null

  if (code === HOROSA_GATE_CODE) {
    const questions = Array.isArray(details.ask_if_missing) ? details.ask_if_missing : Array.isArray(recovery.ask_if_missing) ? recovery.ask_if_missing : []
    const safeDefaults = Array.isArray(details.safe_defaults) ? details.safe_defaults : Array.isArray(recovery.safe_defaults) ? recovery.safe_defaults : []
    const confirmationFields = Array.isArray(details.confirmation_fields)
      ? details.confirmation_fields
      : Array.isArray(recovery.confirmation_fields)
        ? recovery.confirmation_fields
        : []
    // prompt_to_user **原文**带出（S3 §2.7：原文展示、不转述）；只做字符串化，不改一个字。
    const promptToUser = text(recovery.prompt_to_user) || text(details.prompt_to_user) || null
    // 拦截的**第二条证据**（不是判据）：四柱读不出来（Lead 2026-10-13 更正 §4.2）。
    // 判据只有 `ok===false && code===gate` 这一条；这里只把「盘面读没读到」记进 detail，
    // 因为真机闸的 `data` 恰好是 `{}`，但那是**结果**，不是我们据以分类的条件。
    const gateData = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data) ? envelope.data : null
    const { pillars: gatePillars } = extractPillars(gateData)
    return {
      ...base,
      phase: 'gate',
      tool,
      version,
      code,
      message,
      questions,
      promptToUser,
      safeDefaults,
      confirmationFields,
      detail:
        `澄清闸拦截（code=${code}）：需要先向用户确认 ${questions.length} 项设置再重试；`
        + `${gatePillars ? '（注意：本次仍读到了四柱，按闸处置）' : '四柱不可读 = 拦截生效的第二条证据'}；`
        + '拦截期间不落谱、不点亮命盘卡。',
    }
  }

  return {
    ...base,
    phase: 'error',
    tool,
    version,
    code,
    message,
    detail: `信封 ok=false（code=${code ?? '-'}）：${message ? message.slice(0, 300) : '上游没给 message'}。`,
  }
}
