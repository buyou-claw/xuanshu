#!/usr/bin/env node
/**
 * scripts/horosa/bazi-contract.mjs — 票 06 的**上游 seam 契约 CLI**（队友 B）。
 *
 * 用途：直打 `http://127.0.0.1:8765/mcp`，把票面「八字出盘符合 envelope 契约 + timeAlg 缺省口径 +
 * 澄清闸拦截路径」变成一条可复跑的命令 —— **不依赖 DSH**（不 boot 装配树、不读 profile）。
 *
 * 用法：
 *   node scripts/horosa/bazi-contract.mjs [选项…]
 *
 * 选项（全部可选；缺省即「本机真实 8765」）：
 *   --port <n>          MCP 端口          缺省 8765（定值唯一来源 scripts/isolation/defaults.mjs）
 *   --path </mcp>       MCP 端点路径      缺省 /mcp（同上）
 *   --timeout-ms <n>    **每次** MCP 调用的预算，缺省 300000（与挂载行 toolCallTimeoutMs 同值：首调会拉起 runtime）
 *   --fixture <file>    出生数据 fixture  缺省 scripts/horosa/bazi-fixture.json（写死的合成生日，非真人；不许改）
 *   --out <file>        把原始证据（每个用例的信封全文，单个 >2MB 截断）落成一份 JSON
 *   --json              stdout 只输出一份报告 JSON（进度与错误一律走 stderr）
 *   -h, --help          打印本注释块
 *
 * 四组断言（全绿 → exit 0；任一断言失败 → exit 1；环境门失败 → exit 3，与票 05 的退出码表同口径）：
 *   ① `tools/list` 含 `horosa_cn_bazi_birth`；
 *   ② 信封结构（缺省档）：`ok=true`、`tool='bazi_birth'`、`version=<pin>`、`data` 非空、`error===null`、
 *      顶层键 ⊇ `HOROSA_ENVELOPE_REQUIRED_KEYS`、`technique_card` 在且 `versions.runtime === <pin>`；
 *   ③ `timeAlg` 缺省口径：同一份 fixture 跑三档（省略 / 1 / 3）→ `techniqueCard.settings.timeAlg.value`
 *      分别 0 / 1 / 3（**不是**看四柱：上海 1.48° 经度差 + 均时差 ≈ +2m34s，跨不了时支）；
 *   ④ 澄清闸：不带 `agent_confirmed_settings`/`defaults_accepted` 调一次 → `phase='gate'`、
 *      `code='agent_guidance.required'`、`questions.length > 0`、`promptToUser` 非空、**闸没过盘** ——
 *      这条**故意绕过 classifier、直接读原始信封**（`data.bazi.fourColumns.{year,month,day,time}` 里没有可读
 *      干支，且 `data` 里没有 `technique_card`）：闸分支的 `classify.pillars` **恒为 null**（见 bazi.mjs 的闸
 *      返回），拿它当判据是恒真的复制品，发现不了「闸放行了却照样出盘」；
 *      再带确认调一次 → `phase='ok'` 且四柱可读（「回答后重新出盘」的路径）。
 *
 * **单源**（这里一行判据都不重写）：
 *   - 载荷：`packages/xuanshu-host/lib/horosa/bazi.mjs::buildBaziPayload`（宿主侧那份，与 DSH 里跑的是同一套规则）；
 *   - 判据：同文件 `classifyBaziEnvelope`（phase / timeAlg / 四柱 / techniqueCard / 闸字段路径都在它里面）；
 *   - 定值：工具名 / 闸码 / timeAlg 档位 / 必需键来自 `packages/xuanshu-host/lib/horosa/constants.mjs`；
 *     端口 / 路径来自 `scripts/isolation/defaults.mjs`；版本来自 `scripts/setup/horosa-pin.json`
 *     （pin 读不到 → exit 3，**不猜**版本，也不拿兜底字面量放行）；
 *   - 传输：`scripts/horosa/mcp-client.mjs`（自带 MCP 握手与「SSE 拿到应答即早停」，本文件不重写 HTTP）。
 *
 * 每条断言的「实测出处」写在 `checks[].source` 里（`captures/gt06-*` 是 Lead 2026-10-13 的真机捕获，
 * 见契约 §0）—— 断言不是照规范猜的，是照真实响应写的；人类摘要里也会打印它。
 *
 * 退出码（契约 §8，冻结）：0 四组断言全过 / 1 断言失败（信封/口径/闸/结构不符；用法错、fixture 坏同码）/
 *   3 环境门（8765 没人在答、pin 读不到、MCP 握手不成）。**3 优先于 1**：环境门没过时，「断言未过」这句话
 *   没有意义。传输层一失败就停（后面的用例不再跑，报告里写明），不做「拿半个现场硬判」的事。
 *
 * 除 `--out` 显式指定的那个文件外，本文件不写任何东西；stdout 只在 `--json` 时输出那份报告。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_HOROSA_PORT, HOROSA_MCP_PATH, PROBE_HOST } from '../isolation/defaults.mjs'
import { readHelpBlock } from '../setup/args.mjs'
import { DEFAULT_PIN_PATH, loadPin } from '../setup/pin.mjs'
import { mcpCallTool, mcpToolsList } from './mcp-client.mjs'
import { errorMessage, truncate } from './shared.mjs'
import {
  HOROSA_BAZI_ENVELOPE_TOOL,
  HOROSA_BAZI_TOOL,
  HOROSA_ENVELOPE_REQUIRED_KEYS,
  HOROSA_GATE_CODE,
  HOROSA_TIME_ALG,
} from '../../packages/xuanshu-host/lib/horosa/constants.mjs'
import { buildBaziPayload, classifyBaziEnvelope } from '../../packages/xuanshu-host/lib/horosa/bazi.mjs'

/** 报告 schema（本 CLI 自己的；与 setup-report / isolation-report 无关）。 */
const REPORT_SCHEMA = 'xuanshu/horosa-bazi-contract@1'
/** 证据文件 schema（`--out`）。 */
const EVIDENCE_SCHEMA = 'xuanshu/horosa-bazi-contract-evidence@1'
/** 每次 MCP 调用的缺省预算：与 profile 补丁行的 toolCallTimeoutMs 同值（首调拉起 runtime，冷启动分钟级）。 */
const DEFAULT_TIMEOUT_MS = 300_000
/** 单个信封的证据上限（契约 §4.3：≤2MB 截断）；真机信封约 2.4MB，所以正常路径就会走截断。 */
const MAX_EVIDENCE_CHARS = 2 * 1024 * 1024
/** 缺省 fixture：与本文件同目录（跟 probe.mjs 的 DEFAULT_FIXTURE_URL 同一个文件）。 */
const DEFAULT_FIXTURE_URL = new URL('./bazi-fixture.json', import.meta.url)
/** pin 覆盖（与 setup.mjs 同名的测试注入点，见契约 §10）。 */
const PIN_ENV = 'XUANSHU_SETUP_PIN'

/** 退出码（契约 §8）。数值**冻结**。 */
const EXIT = Object.freeze({ ok: 0, assert: 1, environment: 3 })

/** fixture 里这三个键由「确认闸」注入规则管辖，不由 fixture 直接透传（契约 §4.1 的最后两行）。 */
const CONFIRMATION_KEYS = ['agent_confirmed_settings', 'defaults_accepted', 'clarification_notes']

/** classifier 给的四柱的对外槽位（**顺序**就是报告的 [年,月,日,时]）。 */
const PILLAR_SLOTS = ['year', 'month', 'day', 'hour']

/** 原始信封里四柱的真实键：**时柱是 `time`**（真机 17 键里没有 `hour`，`hour` 只是我们的槽位名）。 */
const FOUR_COLUMNS_KEYS = ['year', 'month', 'day', 'time']

/**
 * 干支合法性（60 甲子字符集）。
 * 为什么 CLI 里会有一份：评审必修 1 要求「闸没过盘」那条断言**绕过 classifier** 直接读原始信封，
 * 那就必须自己判「这个 cell 是不是可读干支」。同一份字符集见 `lib/horosa/bazi.mjs` 与 `scripts/horosa/probe.mjs`
 * （两处都没导出；只此一处断言需要，故就近一份，不为此去改冻结文件）。
 */
const GAN = '甲乙丙丁戊己庚辛壬癸'
const ZHI = '子丑寅卯辰巳午未申酉戌亥'
const GANZI_RE = new RegExp(`^[${GAN}][${ZHI}]$`)

/* ------------------------------------------------------------------ *
 * 实测出处（每条断言都指向一份真机捕获；契约 §0）
 * ------------------------------------------------------------------ */

const SOURCE = Object.freeze({
  toolsList:
    '实测出处：captures/gt06-summary.json → toolsList{status:200, count:120, hasBazi:true}'
    + '；工具名同一来源 captures/horosa-cli/tool-list.json 的 bazi_birth.mcp_name',
  envelope:
    '实测出处：captures/gt06-envelope-default.json（Lead 2026-10-13 真机；契约 §0.1 的键表）'
    + '；信封来自 SSE data: 行里 result.content[0].text 的 JSON 字符串',
  timeAlg:
    '实测出处：captures/gt06-envelope-{default,clock,meansolar}.json（契约 §0.1 的三档对照表）'
    + '：传入 省略/1/3 → settings.timeAlg.value = 0/1/3；四柱三档相同（己巳 丙子 丙寅 甲午），不能当判据',
  gate:
    '实测出处：captures/gt06-gate-raw.json + gt06-summary.json cases.gate（契约 §0.2）'
    + '：HTTP 200 / result.isError=false / 信封照回 —— 闸不是 JSON-RPC error，所以判据只能落在 classifyBaziEnvelope；'
    + '信封 ok=false、error.code=agent_guidance.required、ask_if_missing 4 条、四柱不可读',
})

/* ------------------------------------------------------------------ *
 * 参数解析（只认契约 §4.3 列出的选项；未知参数是用法错 → exit 1）
 * ------------------------------------------------------------------ */

const VALUE_OPTIONS = Object.freeze({
  '--port': 'port',
  '--path': 'path',
  '--timeout-ms': 'timeoutMs',
  '--fixture': 'fixture',
  '--out': 'out',
})
const FLAG_OPTIONS = Object.freeze({ '--json': 'json' })

/** 用法提示（错误信息里附它，比让人翻文档强）。 */
function usageHint() {
  return '# 用法: node scripts/horosa/bazi-contract.mjs [--port N] [--path /mcp] [--timeout-ms N]'
    + ' [--fixture <file>] [--json] [--out <file>]    # 全部选项见 --help'
}

function parseArgs(argv = []) {
  const opts = {
    help: false,
    json: false,
    port: DEFAULT_HOROSA_PORT,
    path: HOROSA_MCP_PATH,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    fixture: undefined,
    out: undefined,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '-h' || arg === '--help') {
      opts.help = true
      continue
    }
    if (Object.hasOwn(FLAG_OPTIONS, arg)) {
      opts[FLAG_OPTIONS[arg]] = true
      continue
    }
    if (Object.hasOwn(VALUE_OPTIONS, arg)) {
      const raw = argv[index + 1]
      if (raw === undefined || raw.startsWith('--')) throw new Error(`${arg} 需要一个值`)
      opts[VALUE_OPTIONS[arg]] = raw
      index += 1
      continue
    }
    throw new Error(`未知参数：${arg}`)
  }
  opts.port = positiveInt(opts.port, '--port', { min: 1, max: 65535 })
  opts.timeoutMs = positiveInt(opts.timeoutMs, '--timeout-ms', { min: 1000, max: 3_600_000 })
  if (typeof opts.path !== 'string' || opts.path.trim() === '') throw new Error('--path 不能是空串')
  opts.path = opts.path.startsWith('/') ? opts.path.trim() : `/${opts.path.trim()}`
  if (opts.fixture !== undefined && String(opts.fixture).trim() === '') throw new Error('--fixture 不能是空串')
  if (opts.out !== undefined && String(opts.out).trim() === '') throw new Error('--out 不能是空串')
  return opts
}

function positiveInt(raw, label, { min, max }) {
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} 需要 ${min}..${max} 的整数，收到 ${JSON.stringify(raw)}`)
  }
  return value
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/** 进度与错误一律走 stderr：`--json` 时 stdout 只能有一份 JSON。 */
const log = (line) => process.stderr.write(`${line}\n`)

/**
 * 把 `classifyBaziEnvelope(...).pillars` 摊成 4 个可读值（**只用于报告展示**）。
 * 只认两种真机形状：槽位已经是字符串（classifier 归一过的），或原始柱对象 `{ganzi}`（缺键退 `{ganZhi}`）。
 * 数组形状与 `ganzhi`/`gz` 一类别名**不认** —— 契约 §4.3 明令「CLI 里不重写判据」，多认一种形状
 * 等于偷偷把判据放宽一次（第一版就是那么泛化的，评审已收敛）。
 * 判据始终是 `classify.pillars !== null`；这里返回 null 只影响展示。
 */
function pillarValues(pillars) {
  if (!pillars || typeof pillars !== 'object' || Array.isArray(pillars)) return null
  const pick = (value) => {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (value && typeof value === 'object') {
      for (const key of ['ganzi', 'ganZhi']) {
        if (typeof value[key] === 'string' && value[key].trim() !== '') return value[key].trim()
      }
    }
    return null
  }
  const out = PILLAR_SLOTS.map((slot) => pick(pillars[slot]))
  return out.every(Boolean) ? out : null
}

/**
 * 原始信封里四柱的可读干支（**不经过 classifier**；评审必修 1 用）。
 * 返回 `{ present, found }`：`present` = `data.bazi.fourColumns` 在不在，`found` = 四个键里可读的
 * `键=干支` 列表（`ganzi` 为主、缺键退 `ganZhi`）。**闸档期望 `found` 为空** —— 那才叫「没过盘」。
 */
function fourColumnsGanzi(data) {
  const four = data && typeof data === 'object' ? data?.bazi?.fourColumns : undefined
  if (!four || typeof four !== 'object' || Array.isArray(four)) return { present: false, found: [] }
  const found = []
  for (const key of FOUR_COLUMNS_KEYS) {
    const node = four[key]
    if (!node || typeof node !== 'object') continue
    const raw = typeof node.ganzi === 'string' ? node.ganzi.trim() : typeof node.ganZhi === 'string' ? node.ganZhi.trim() : ''
    if (GANZI_RE.test(raw)) found.push(`${key}=${raw}`)
  }
  return { present: true, found }
}

/** 四柱/键集合的小摘要（报告里不放大对象）。 */
const keysOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).slice(0, 32) : null)

/** pin 路径（`XUANSHU_SETUP_PIN` 覆盖只给测试用；缺省与 setup.mjs 同一份文件）。 */
function resolvePinPath(env) {
  const override = env?.[PIN_ENV]
  if (typeof override === 'string' && override.trim() !== '') return resolve(override.trim())
  return DEFAULT_PIN_PATH
}

/** 读 fixture；缺字段这件事交给 `buildBaziPayload` 判（不在这里另写一份字段表）。 */
function readFixture(fixturePath) {
  const file = fixturePath ? resolve(String(fixturePath)) : fileURLToPath(DEFAULT_FIXTURE_URL)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return { ok: false, file, detail: `读不了/解析不了八字 fixture（${errorMessage(error)}）：${file}` }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, file, detail: `八字 fixture 不是一个对象：${file}` }
  }
  return { ok: true, file, value: parsed, keys: Object.keys(parsed) }
}

/**
 * fixture → 五个用例的输入。
 * 为什么在这里剥键：fixture 进版本库、被票 05 的 C3 与票 06 的 CLI 共用（不许改）。它自带
 * `agent_confirmed_settings`/`clarification_notes`（那是**缺省档**该带的东西），而当我们要验「不给确认 → 拦截」
 * 时，必须把确认键**从源头摘掉**，否则测的是一个自带通行证的载荷 —— 那才是假绿。
 * `timeAlg` 同样剥掉：三档的**唯一变量**必须是 timeAlg，fixture 带着它是有人动过它（记一条 note 说清楚）。
 */
function prepareInputs(fixture) {
  const notes = []
  const birth = { ...fixture }
  const rawNotes = birth.clarification_notes
  const clarificationNotes = typeof rawNotes === 'string' && rawNotes.trim() !== '' ? rawNotes : undefined
  if (Object.hasOwn(birth, 'timeAlg')) {
    notes.push('fixture 里带了 timeAlg：已按契约 §4.3「省略档」剥掉（三档的唯一变量必须是 timeAlg）')
    delete birth.timeAlg
  }
  for (const key of CONFIRMATION_KEYS) delete birth[key]
  const confirmExtras = clarificationNotes === undefined ? {} : { clarificationNotes }
  return {
    birth,
    clarificationNotes,
    notes,
    cases: [
      { name: 'default', label: '缺省（不传 timeAlg）', input: { ...birth, ...confirmExtras, agentConfirmed: true } },
      { name: 'clock', label: `timeAlg=${HOROSA_TIME_ALG.CLOCK}（钟表时）`, input: { ...birth, ...confirmExtras, agentConfirmed: true, timeAlg: HOROSA_TIME_ALG.CLOCK } },
      { name: 'meansolar', label: `timeAlg=${HOROSA_TIME_ALG.MEAN_SOLAR}（平太阳时）`, input: { ...birth, ...confirmExtras, agentConfirmed: true, timeAlg: HOROSA_TIME_ALG.MEAN_SOLAR } },
      // 澄清闸那一次**不带** clarification_notes：真实拦截就发生在「还没问过用户」的时刻（契约 §0.2 的探针同形）。
      { name: 'gate', label: '不给确认（澄清闸拦截）', input: { ...birth, agentConfirmed: false } },
      { name: 'confirmed', label: '带确认（回答后重新出盘）', input: { ...birth, ...confirmExtras, agentConfirmed: true } },
    ],
  }
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

async function main(argv) {
  const startedAt = Date.now()

  let opts
  try {
    opts = parseArgs(argv)
  } catch (error) {
    log(`bazi-contract: ${errorMessage(error)}`)
    log(usageHint())
    return EXIT.assert
  }
  if (opts.help) {
    process.stdout.write(`${readHelpBlock(fileURLToPath(import.meta.url))}\n`)
    return EXIT.ok
  }

  const url = `http://${PROBE_HOST}:${opts.port}${opts.path}`
  const report = {
    schema: REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    ok: false,
    exitCode: EXIT.assert,
    url,
    host: PROBE_HOST,
    port: opts.port,
    path: opts.path,
    timeoutMs: opts.timeoutMs,
    pin: null,
    fixture: null,
    checks: [],
    cases: {},
    environment: { failures: [] },
    assertionFailures: [],
    evidenceFile: null,
    notes: [],
    elapsedMs: 0,
  }

  // 断言/环境门的收集器：`checks` 是人读的四组断言，考试结果以两个 failures 数组为准（§8 的 3 > 1）。
  const check = (id, group, ok, detail, extra = {}) => {
    const entry = { id, group, ok: ok === true, detail, ...extra }
    report.checks.push(entry)
    if (!entry.ok) report.assertionFailures.push({ id, group, detail })
    return entry.ok
  }
  const envFailure = (code, detail, extra = {}) => {
    report.environment.failures.push({ code, detail, ...extra })
  }

  /* ---------- 环境门 1：pin（版本期望值的唯一来源；读不到就不猜） ---------- */
  const pinPath = resolvePinPath(process.env)
  let pin
  try {
    pin = loadPin(pinPath)
    report.pin = { version: pin.version, file: pinPath }
  } catch (error) {
    envFailure('pin-unreadable', `${errorMessage(error)}（pin：${pinPath}）`, { hint: error?.hint ?? null })
    return finish({ report, opts, startedAt })
  }
  log(`[bazi-contract] pin v${pin.version}（${pinPath}）  目标 ${url}`)

  /* ---------- 环境门 2：MCP 握手 + tools/list（8765 有没有人在答） ---------- */
  const list = await mcpToolsList({ host: PROBE_HOST, port: opts.port, path: opts.path, timeoutMs: opts.timeoutMs })
  report.environment.toolsList = {
    ok: list.ok === true,
    status: list.status ?? null,
    toolCount: list.tools.length,
    serverInfo: list.serverInfo ?? null,
    sessionId: list.evidence?.sessionId ?? null,
    detail: truncate(list.detail, 400),
  }
  if (!list.ok) {
    envFailure('mcp-handshake', `tools/list 失败：${truncate(list.detail, 500)}`, { status: list.status ?? null, url })
    report.notes.push('环境门没过：8765 上没人答 MCP（或握手不完整）。先起 serve：node scripts/setup.mjs 或宿主插件的 /xuanshu-horosa start。')
    return finish({ report, opts, startedAt })
  }

  /* ---------- ① tools/list 含八字工具 ---------- */
  const listed = check(
    'g1.tool-listed',
    '① tools/list',
    list.tools.includes(HOROSA_BAZI_TOOL),
    `tools/list 返回 ${list.tools.length} 条工具，${list.tools.includes(HOROSA_BAZI_TOOL) ? '含' : '**不含**'} ${HOROSA_BAZI_TOOL}`,
    { source: SOURCE.toolsList, evidence: { toolCount: list.tools.length, toolsHead: list.tools.slice(0, 8), serverInfo: list.serverInfo ?? null } },
  )
  if (!listed) {
    report.notes.push(`① 不过就停在这里：${HOROSA_BAZI_TOOL} 不在 tools/list 里，后面的调用没有意义（先看 runtime 版本与 pin 是否一致）。`)
    return finish({ report, opts, startedAt })
  }

  /* ---------- fixture → 五个用例的载荷（载荷一律来自 buildBaziPayload） ---------- */
  const fixture = readFixture(opts.fixture)
  report.fixture = { ok: fixture.ok, file: fixture.file, keys: fixture.keys ?? null, detail: fixture.detail ?? null }
  if (!fixture.ok) {
    // 记成断言失败（不是环境门）：fixture 是我们自己的输入，坏了要人来看版本库，而不是「去修环境」。
    check('g1.fixture', '① tools/list', false, fixture.detail, { source: `fixture 是版本库里的固定件（票 06 契约 §4.3：不许改）` })
    return finish({ report, opts, startedAt })
  }
  const prepared = prepareInputs(fixture.value)
  report.fixture.keys = fixture.keys
  for (const note of prepared.notes) report.notes.push(note)

  /* ---------- ③④ 的五个调用（顺序 = 契约 §4.3 的叙述顺序） ---------- */
  const results = {} // 可序列化摘要 → 报告里的 cases
  const classified = {} // classifyBaziEnvelope 的原始返回（断言用；不进 --json：technique_card 整块塞进 stdout 会撑爆）
  const envelopes = {} // 原始信封（只给 --out 证据；同理不进 --json）
  for (const testCase of prepared.cases) {
    const built = buildBaziPayload(testCase.input)
    const payloadEntry = {
      ok: built.ok === true,
      keys: keysOf(built.payload),
      omitted: Array.isArray(built.omitted) ? built.omitted : null,
      problems: built.problems ?? null,
      timeAlgInPayload: Boolean(built.payload && Object.hasOwn(built.payload, 'timeAlg')),
      sentTimeAlg: built.payload && Object.hasOwn(built.payload, 'timeAlg') ? built.payload.timeAlg : 'omitted',
      detail: built.detail ?? null,
      hint: built.hint ?? null,
    }
    if (!built.ok) {
      const detail = `buildBaziPayload 不肯为用例「${testCase.label}」造载荷：${built.detail ?? ''}`
      check(`payload-${testCase.name}`, '③ timeAlg 口径', false, detail, {
        source: '判据出处：契约 §4.1（缺 lat/lon 一律拒绝出盘；timeAlg 只接受 0/1/3）',
        evidence: { problems: built.problems ?? null, hint: built.hint ?? null },
      })
      results[testCase.name] = { label: testCase.label, payload: payloadEntry, skipped: detail }
      continue
    }

    log(`[bazi-contract] ${testCase.name}：调 ${HOROSA_BAZI_TOOL}（载荷键 ${payloadEntry.keys?.join(',') ?? '-'}）`)
    const called = await mcpCallTool({
      name: HOROSA_BAZI_TOOL,
      args: built.payload,
      host: PROBE_HOST,
      port: opts.port,
      path: opts.path,
      timeoutMs: opts.timeoutMs,
    })
    if (!called.ok || !called.envelope) {
      envFailure('mcp-call', `tools/call ${HOROSA_BAZI_TOOL}（用例 ${testCase.name}）没拿到信封：${truncate(called.detail, 500)}`, {
        case: testCase.name,
        url,
        status: called.evidence?.status ?? null,
      })
      results[testCase.name] = { label: testCase.label, payload: payloadEntry, transport: { ok: false, detail: truncate(called.detail, 400) } }
      report.notes.push(`传输层在用例「${testCase.label}」上失败：后面的用例不再跑（环境门没过时，「断言未过」没有意义）。`)
      break
    }

    const envelope = called.envelope
    // 名字别叫 classified：外面那张 `classified` 是「用例名 → classifier 原始返回」的表（断言读它），
    // 同名会把表遮住 —— 第一次自测就是这么红的（断言全读不到它）。
    const verdict = classifyBaziEnvelope(envelope)
    results[testCase.name] = {
      label: testCase.label,
      payload: payloadEntry,
      transport: {
        ok: true,
        from: called.evidence?.envelopeFrom ?? null,
        status: called.evidence?.status ?? null,
        envelopeKeys: keysOf(envelope),
        dataKeys: keysOf(envelope.data),
        error: envelope.error ?? null,
      },
      classify: {
        ok: verdict.ok === true,
        phase: verdict.phase ?? null,
        tool: verdict.tool ?? null,
        version: verdict.version ?? null,
        timeAlg: verdict.timeAlg ?? null,
        timeAlgSource: verdict.timeAlgSource ?? null,
        pillars: pillarValues(verdict.pillars),
        pillarSource: verdict.pillarSource ?? null,
        techniqueCard: verdict.techniqueCard
          ? { keys: keysOf(verdict.techniqueCard), versions: verdict.techniqueCard.versions ?? null, settingsKeys: keysOf(verdict.techniqueCard.settings) }
          : null,
        code: verdict.code ?? null,
        message: verdict.message ? truncate(verdict.message, 300) : null,
        questions: Array.isArray(verdict.questions) ? verdict.questions.length : null,
        promptToUser: typeof verdict.promptToUser === 'string' ? truncate(verdict.promptToUser, 400) : null,
        safeDefaults: Array.isArray(verdict.safeDefaults) ? verdict.safeDefaults.length : null,
        confirmationFields: verdict.confirmationFields ?? null,
        detail: typeof verdict.detail === 'string' ? truncate(verdict.detail, 400) : null,
      },
    }
    classified[testCase.name] = verdict
    envelopes[testCase.name] = envelope
    log(`[bazi-contract] ${testCase.name}：phase=${verdict.phase} timeAlg=${verdict.timeAlg ?? '-'} 四柱=${pillarValues(verdict.pillars)?.join(' ') ?? '不可读'}`)
  }

  report.cases = results
  if (report.environment.failures.length === 0) collectAssertions({ check, results, classified, envelopes, pin })

  return finish({ report, opts, startedAt, envelopes })
}

/* ------------------------------------------------------------------ *
 * ②③④ 的断言（判据全部来自 classifyBaziEnvelope）
 * ------------------------------------------------------------------ */

function collectAssertions({ check, results, classified, envelopes, pin }) {
  const classifiedOf = (name) => classified[name] ?? null
  const envelopeOf = (name) => envelopes[name] ?? null
  const missing = (name) => `用例「${results[name]?.label ?? name}」没有可判的信封（${results[name]?.skipped ?? '传输层失败'}）`

  /* ---------- ② 信封结构（缺省档） ---------- */
  const base = classifiedOf('default')
  const baseEnvelope = envelopeOf('default')
  const G2 = '② 信封结构'

  check('g2.phase-ok', G2, base?.phase === 'ok', base ? `phase=${base.phase}（期望 ok）` : missing('default'), {
    source: SOURCE.envelope,
    evidence: { phase: base?.phase ?? null, detail: base?.detail ?? null },
  })
  check('g2.tool', G2, base?.tool === HOROSA_BAZI_ENVELOPE_TOOL, base ? `tool=${base.tool ?? '-'}（期望 ${HOROSA_BAZI_ENVELOPE_TOOL}）` : missing('default'), {
    source: `${SOURCE.envelope}：信封 tool 是 CLI 名（MCP 名 ${HOROSA_BAZI_TOOL} 转发到同名技法）`,
  })
  check('g2.version', G2, base?.version === pin.version, base ? `version=${base.version ?? '-'}（期望 pin ${pin.version}）` : missing('default'), {
    source: `${SOURCE.envelope}：pin 版本见 scripts/setup/horosa-pin.json（不匹配 = 新树混旧 runtime）`,
  })
  check(
    'g2.data-nonempty',
    G2,
    Boolean(baseEnvelope) && keysOf(baseEnvelope.data) !== null && keysOf(baseEnvelope.data).length > 0,
    baseEnvelope ? `data 键 ${keysOf(baseEnvelope.data)?.length ?? 0} 个：${(keysOf(baseEnvelope.data) ?? []).join(', ')}` : missing('default'),
    { source: `${SOURCE.envelope}：data = {bazi, gender, local, compute_sources, snapshot_text, export_snapshot, technique_card}` },
  )
  check('g2.error-null', G2, Boolean(baseEnvelope) && baseEnvelope.error === null, baseEnvelope ? `error=${JSON.stringify(baseEnvelope.error)}（期望 null）` : missing('default'), {
    source: SOURCE.envelope,
  })
  const envelopeKeys = baseEnvelope && typeof baseEnvelope === 'object' ? Object.keys(baseEnvelope) : []
  const missingKeys = HOROSA_ENVELOPE_REQUIRED_KEYS.filter((key) => !envelopeKeys.includes(key))
  check('g2.required-keys', G2, missingKeys.length === 0, `顶层键 ⊇ HOROSA_ENVELOPE_REQUIRED_KEYS${missingKeys.length ? `；缺 ${missingKeys.join(', ')}` : `（实测 ${envelopeKeys.length} 键，这 ${HOROSA_ENVELOPE_REQUIRED_KEYS.length} 个都在）`}`, {
    source: `${SOURCE.envelope}；必需键表来自 packages/xuanshu-host/lib/horosa/constants.mjs::HOROSA_ENVELOPE_REQUIRED_KEYS`,
    evidence: { envelopeKeys },
  })
  const versions = base?.techniqueCard?.versions ?? null
  check(
    'g2.technique-card',
    G2,
    Boolean(base?.techniqueCard) && versions !== null && versions.runtime === pin.version,
    base?.techniqueCard
      ? `technique_card 在（键 ${base.techniqueCard.keys?.length ?? 0} 个）；versions.runtime=${versions?.runtime ?? '-'}（期望 ${pin.version}）`
      : missing('default'),
    {
      source: `${SOURCE.envelope}：technique_card.versions = {skill, tool_envelope_schema, export_settings, runtime}`,
      evidence: { versions },
    },
  )

  /* ---------- ③ timeAlg 缺省口径（三档） ---------- */
  const G3 = '③ timeAlg 口径'
  const def = results.default ?? {}
  check(
    'g3.default-omitted',
    G3,
    Boolean(def.payload) && def.payload.timeAlgInPayload === false && Array.isArray(def.payload.omitted) && def.payload.omitted.includes('timeAlg'),
    def.payload
      ? `缺省档载荷 ${def.payload.timeAlgInPayload ? '**带了** timeAlg' : '不含 timeAlg 键'}；omitted=${JSON.stringify(def.payload.omitted)}`
      : missing('default'),
    { source: '判据出处：契约 §4.1「timeAlg 缺省或 0 → 键省略」+ §0.1 实测（缺省档 sentArgs 里没有 timeAlg）' },
  )
  for (const [name, expected] of [['default', HOROSA_TIME_ALG.TRUE_SOLAR], ['clock', HOROSA_TIME_ALG.CLOCK], ['meansolar', HOROSA_TIME_ALG.MEAN_SOLAR]]) {
    const verdict = classifiedOf(name)
    const payload = results[name]?.payload ?? null
    check(
      `g3.${name}-timealg-${expected}`,
      G3,
      verdict?.timeAlg === expected,
      verdict
        ? `settings.timeAlg.value=${verdict.timeAlg ?? '-'}（期望 ${expected}）；载荷 timeAlg=${payload?.sentTimeAlg ?? '-'}；来源 ${verdict.timeAlgSource ?? '-'}；四柱 ${pillarValues(verdict.pillars)?.join(' ') ?? '读不到'}`
        : missing(name),
      { source: SOURCE.timeAlg, evidence: { timeAlg: verdict?.timeAlg ?? null, timeAlgSource: verdict?.timeAlgSource ?? null, sentTimeAlg: payload?.sentTimeAlg ?? null } },
    )
  }

  /* ---------- ④ 澄清闸拦截 → 回答后重新出盘 ---------- */
  const G4 = '④ 澄清闸'
  const gatePayload = results.gate?.payload ?? null
  const gate = classifiedOf('gate')
  const gateEnvelope = envelopeOf('gate')
  const confirmed = classifiedOf('confirmed')

  check(
    'g4.gate-payload-unconfirmed',
    G4,
    Boolean(gatePayload) && Array.isArray(gatePayload.keys)
      && !gatePayload.keys.includes('agent_confirmed_settings') && !gatePayload.keys.includes('defaults_accepted'),
    gatePayload ? `拦截档载荷键 ${(gatePayload.keys ?? []).join(', ') || '-'}（期望不含 agent_confirmed_settings/defaults_accepted）` : missing('gate'),
    { source: '判据出处：契约 §4.1 的确认闸（agentConfirmed === false → 不注入确认键）+ §0.2 的探针形态（只发五个出生字段）' },
  )
  check('g4.gate-phase', G4, gate?.phase === 'gate', gate ? `phase=${gate.phase}（期望 gate；注意 HTTP 200 / isError=false 也可能是闸）` : missing('gate'), {
    source: SOURCE.gate,
  })
  check('g4.gate-code', G4, gate?.code === HOROSA_GATE_CODE, gate ? `code=${gate.code ?? '-'}（期望 ${HOROSA_GATE_CODE}）` : missing('gate'), {
    source: SOURCE.gate,
  })
  const questions = Array.isArray(gate?.questions) ? gate.questions : null
  check('g4.gate-questions', G4, Boolean(questions) && questions.length > 0, questions ? `questions.length=${questions.length}（>0；实测 4）` : missing('gate'), {
    source: `${SOURCE.gate}；字段路径 error.details.ask_if_missing`,
    evidence: { questions: questions?.length ?? null },
  })
  check('g4.gate-prompt', G4, typeof gate?.promptToUser === 'string' && gate.promptToUser.trim() !== '', gate ? `promptToUser（原文，前 120 字）：${truncate(gate.promptToUser ?? '', 120)}` : missing('gate'), {
    source: `${SOURCE.gate}；字段路径 error.details.agent_recovery.prompt_to_user（S3 §2.7：原文展示、不转述）`,
  })
  const gateDataKeys = gateEnvelope && typeof gateEnvelope === 'object' ? keysOf(gateEnvelope.data) : null
  // 评审必修 1：这条**绕过 classifier** 读原始信封。闸分支的 `classify.pillars` 恒为 null（bazi.mjs 的闸返回），
  // 拿它判是恒真 —— 只有直接看「原始信封里有没有可读四柱 / 有没有 technique_card」，才能把
  // 「闸放行了却照样出盘」和「闸真的没过盘」分开。
  const gateFour = fourColumnsGanzi(gateEnvelope?.data)
  const gateHasCard = Boolean(gateEnvelope?.data) && Object.hasOwn(gateEnvelope.data, 'technique_card')
  check(
    'g4.gate-no-chart',
    G4,
    Boolean(gateEnvelope) && gateFour.found.length === 0 && !gateHasCard,
    gateEnvelope
      ? `原始信封：fourColumns 可读干支 ${gateFour.found.length} 处`
        + `${gateFour.found.length ? `（**有盘面**：${gateFour.found.join(' ')}）` : `（逐键 ${FOUR_COLUMNS_KEYS.join('/')} 全无可读值${gateFour.present ? '' : '；data.bazi.fourColumns 本身不在'}）`}`
        + `；data.technique_card=${gateHasCard ? '**在**（闸却出了盘？）' : '缺'}`
        + `；参考信息（**不是判据**）：data 键 ${gateDataKeys?.length ?? 0} 个`
      : missing('gate'),
    {
      source: `${SOURCE.gate}；判据 = 原始信封里 fourColumns 无可读干支 且 data 无 technique_card`
        + '（**故意绕过 classifier**：闸分支的 classify.pillars 恒为 null，拿它判等于复制 g4.gate-phase）',
      evidence: { fourColumnsPresent: gateFour.present, readable: gateFour.found, techniqueCard: gateHasCard, classifierPillars: gate?.pillars ?? null, gateDataKeys },
    },
  )
  check('g4.confirmed-phase-ok', G4, confirmed?.phase === 'ok', confirmed ? `带确认后 phase=${confirmed.phase}（期望 ok）` : missing('confirmed'), {
    source: `${SOURCE.gate} 的反面 + contracts §4.3 第 4 条：retry_requires_one_of = [{agent_confirmed_settings:true},{defaults_accepted:true}]，带上就出盘`,
  })
  check(
    'g4.confirmed-pillars',
    G4,
    confirmed !== null && confirmed.pillars !== null,
    confirmed ? `四柱（判据 = classify.pillars 非 null）：${(pillarValues(confirmed.pillars) ?? []).join(' ') || JSON.stringify(confirmed.pillars)?.slice(0, 120)}` : missing('confirmed'),
    {
      source: `${SOURCE.envelope}：真机 data.bazi.fourColumns 的时柱键是 **time**（没有 hour，共 17 键）；`
        + '`pillars.hour` 是我们的对外槽位名，映射由 classifyBaziEnvelope 负责（本 CLI 不自己取 fourColumns）',
    },
  )
}

/* ------------------------------------------------------------------ *
 * 收尾：证据文件 + 报告 + 退出码
 * ------------------------------------------------------------------ */

function finish({ report, opts, startedAt, envelopes = {} }) {
  report.elapsedMs = Date.now() - startedAt
  const envBroken = report.environment.failures.length > 0
  report.exitCode = envBroken ? EXIT.environment : report.assertionFailures.length > 0 ? EXIT.assert : EXIT.ok
  report.ok = report.exitCode === EXIT.ok

  if (opts.out !== undefined) writeEvidence({ report, out: opts.out, envelopes })

  if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else process.stdout.write(`${formatReport(report)}\n`)

  if (!report.ok) {
    log(report.exitCode === EXIT.environment
      ? `bazi-contract: 环境门没过（退出码 ${EXIT.environment}）：${truncate(report.environment.failures.map((item) => item.detail).join(' | '), 400)}`
      : `bazi-contract: ${report.assertionFailures.length} 条断言未过（退出码 ${EXIT.assert}）：${report.assertionFailures.map((item) => item.id).join(', ')}`)
  }
  return report.exitCode
}

/** `--out`：原始证据（信封全文，单个 >2MB 截断）。写不进去只记 note：它是排障产物，不该改判结论。 */
function writeEvidence({ report, out, envelopes }) {
  const file = resolve(String(out))
  const cases = {}
  for (const [name, result] of Object.entries(report.cases)) {
    if (!result || typeof result !== 'object') continue
    const entry = { label: result.label ?? null, payload: result.payload ?? null, transport: result.transport ?? null, classify: result.classify ?? null }
    const envelope = envelopes[name]
    if (envelope !== undefined && envelope !== null) {
      let text = ''
      try {
        text = JSON.stringify(envelope)
      } catch (error) {
        entry.serializationError = errorMessage(error)
      }
      entry.envelopeChars = text.length
      entry.truncated = text.length > MAX_EVIDENCE_CHARS
      if (entry.truncated) entry.envelopeText = text.slice(0, MAX_EVIDENCE_CHARS)
      else entry.envelope = envelope
    }
    cases[name] = entry
  }
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    generatedAt: new Date().toISOString(),
    url: report.url,
    pin: report.pin,
    fixture: report.fixture,
    maxChars: MAX_EVIDENCE_CHARS,
    ok: report.ok,
    exitCode: report.exitCode,
    cases,
  }
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    report.evidenceFile = file
    report.notes.push(`证据：${file}（信封全文；单个 >${MAX_EVIDENCE_CHARS} 字符的部分落成 envelopeText）`)
  } catch (error) {
    report.notes.push(`证据没写进去（${errorMessage(error)}）：${file}`)
  }
}

/** 人类可读摘要（`--json` 时不用它）。 */
function formatReport(report) {
  const lines = []
  const verdict = report.ok
    ? `四组断言全过 → 退出码 ${report.exitCode}`
    : report.exitCode === EXIT.environment
      ? `环境门没过 → 退出码 ${report.exitCode}（3 = 8765 没人在答 / pin 读不到 / MCP 握手不成）`
      : `${report.assertionFailures.length} 条断言未过 → 退出码 ${report.exitCode}`

  lines.push(`horosa 八字契约（上游 seam）  ${report.url}  pin v${report.pin?.version ?? '?'}  ${report.elapsedMs}ms`)
  lines.push(report.fixture
    ? `fixture：${report.fixture.file}（${report.fixture.ok ? '读了' : '读不了'}）`
    : 'fixture：还没读（环境门先挡住了，没走到那一步）')
  lines.push('')
  let group = null
  for (const item of report.checks) {
    if (item.group !== group) {
      group = item.group
      lines.push(`${group}`)
    }
    lines.push(`  [${item.ok ? '✓' : '✗'}] ${item.id}  ${item.detail}`)
    if (item.source) lines.push(`        ↳ ${item.source}`)
  }
  if (report.checks.length === 0) lines.push('（没有任何断言跑起来：环境门先挡住了）')
  for (const failure of report.environment.failures) lines.push(`环境门 ${failure.code}：${failure.detail}`)
  lines.push('')
  for (const note of report.notes) lines.push(`note: ${note}`)
  if (report.evidenceFile) lines.push(`证据文件：${report.evidenceFile}`)
  lines.push('')
  lines.push(verdict)
  return lines.join('\n')
}

/* ------------------------------------------------------------------ *
 * 入口（只有直接跑才执行；被测试 import 时只导出零件）
 * ------------------------------------------------------------------ */

const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      log(`bazi-contract: 未捕获的异常：${error?.stack ?? error}`)
      process.exitCode = EXIT.assert
    },
  )
}

// `fourColumnsGanzi` 一并导出：它是「闸没过盘」这条断言的**判据本体**，导出后可以用真机捕获
// （成功信封 vs 闸信封）直接演示它会给出相反结论 —— 证明这条断言不是恒真。
export { EXIT, fourColumnsGanzi, main, parseArgs, prepareInputs, pillarValues }
