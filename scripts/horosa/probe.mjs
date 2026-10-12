/**
 * scripts/horosa/probe.mjs
 *
 * 票 05 自检 C2/C3 的探针（队友 B）。冻结接口（契约 §9，名字/签名/返回形状不许改）：
 *   checkHorosaHealth({ port, path, timeoutMs })            // 包票 04 的 checkHorosaPort
 *   checkBaziTool({ port, path, timeoutMs, fixturePath })   // C3 的两步
 *
 * C2（`checkHorosaHealth`）= 票 04 的四态守卫 + 「MCP initialize 成功（有 `mcp-session-id`）
 *   且 `tools/list` 非空」。四态判定**只**来自 `scripts/isolation/horosa-guard.mjs::checkHorosaPort`
 *   （同一个函数，不另写一份，§9 第三条）；`ok` 只在「端口放行 **且** MCP 真答」时为真：
 *     - `free`             → `{ ok:true, verdict:'free', mcp:null, mcpReady:false }`
 *       端口没被占（票 04 的这道门放行，所以 ok 随守卫为 true），但还没人答 MCP ——
 *       **调用方的正确顺序**：先看 verdict → free 就先 `startServe()`（它自己会等到 horosa-ready）
 *       → 再跑一次 `checkHorosaHealth()`（这次会握手），或直接跑 `checkBaziTool()`（内含 tools/list）。
 *       端到端假绿走不通：没人应答时 C3 的 `tools/list` 必然失败。
 *     - `horosa-ready`     → 再做 MCP 握手；成功 `ok:true && mcpReady:true`，失败 `ok:false`（fail-closed）
 *     - `occupied-foreign` → `ok:false`（调用方按契约 §8 记 exit 3）
 *     - `probe-failed`     → `ok:false`（不确定就是不放行；调用方按 unknown 处置）
 *   `mcp` 字段：`{ ok, status, sessionId, serverInfo, toolCount, detail } | null`；
 *   `mcpReady` 把「MCP 真的能用」单独拎出来（`free` 时为 false），可直接当 C2 的判据。
 *
 * C3（`checkBaziTool`）= ① `tools/list` 含 `horosa_cn_bazi_birth`；② 用它调
 *   `scripts/horosa/bazi-fixture.json` 里那份**写死的合成**出生数据（非真人生日，不传 timeAlg →
 *   缺省 0 真太阳时），断言信封 `ok === true && version === <pin.version> && tool === 'bazi_birth'`
 *   （后两条按 Lead 2026-10-12 真机实测口径，见 `captures/setup-e2e-groundtruth.md` §4：
 *   四柱在 `data.bazi.fourColumns.{year,month,day,hour}.ganzi`），且四柱四个 2 字干支串合法、
 *   `data` 非空。**不去** `data.export_text` 找干支（实测那里是空串）。
 *
 * 两个探针都**不抛**：一切失败折算成 `{ ok:false, ... , detail }`（§9 末条）；也**不往 stdout 打印**。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { DEFAULT_HOROSA_PORT, HOROSA_MCP_PATH } from '../isolation/defaults.mjs'
import { checkHorosaPort } from '../isolation/horosa-guard.mjs'
import { mcpCallTool, mcpToolsList } from './mcp-client.mjs'
import { debug, truncate } from './shared.mjs'

/** C3 的目标工具：MCP 名（`captures/horosa-cli/tool-list.json` 的 `bazi_birth.mcp_name`）。 */
const BAZI_TOOL = 'horosa_cn_bazi_birth'
/** CLI/信封里的技法名（信封 `tool` 字段实测是 CLI 名，不是 MCP 名）。 */
const BAZI_ENVELOPE_TOOL = 'bazi_birth'
/** 契约 §5 写死的钉版；能读到 `scripts/setup/horosa-pin.json` 时以 pin 为准（升级时只改 pin）。 */
const FALLBACK_VERSION = '0.40.1'
/** C2 的默认总预算：端口探针 + MCP 握手（tools/list 在 120 条时约 500KB）。 */
const DEFAULT_HEALTH_TIMEOUT_MS = 20_000
/** C3 的默认总预算：tools/list + 一次八字出盘（首调会拉起 runtime，冷启动慢，调用方按 §2 传大值）。 */
const DEFAULT_BAZI_TIMEOUT_MS = 60_000
/** 干支字符集与合法性判据（四柱可读 = 四个 2 字干支串）。 */
const GAN = '甲乙丙丁戊己庚辛壬癸'
const ZHI = '子丑寅卯辰巳午未申酉戌亥'
const GANZI_RE = new RegExp(`^[${GAN}][${ZHI}]$`)
/** 四柱的键与快照行首标签（`hour` 是真机键名；`time` 是 vendored builder 里的别名）。 */
const PILLARS = [
  { key: 'year', alias: ['year'], label: '年柱' },
  { key: 'month', alias: ['month'], label: '月柱' },
  { key: 'day', alias: ['day'], label: '日柱' },
  { key: 'hour', alias: ['hour', 'time'], label: '时柱' },
]
/** 默认 fixture 路径：跟模块同目录，避免调用方（setup-core）拼路径。 */
const DEFAULT_FIXTURE_URL = new URL('./bazi-fixture.json', import.meta.url)

let cachedExpectedVersion
/** 期望版本：pin 文件是唯一来源，读不到才退契约 §5 的 0.40.1。 */
function expectedVersion() {
  if (cachedExpectedVersion) return cachedExpectedVersion
  cachedExpectedVersion = FALLBACK_VERSION
  try {
    const pinPath = fileURLToPath(new URL('../setup/horosa-pin.json', import.meta.url))
    const pin = JSON.parse(readFileSync(pinPath, 'utf8'))
    if (pin && typeof pin.version === 'string' && pin.version.trim()) cachedExpectedVersion = pin.version.trim()
  } catch {
    /* pin 不可读（还没落地/被改名）：用契约写死的版本，探针不因此失败 */
  }
  return cachedExpectedVersion
}

function healthResult(portResult, extra = {}) {
  const result = { ...portResult, ...extra }
  return result
}

/**
 * C2：harosa MCP 端点的健康判定。
 * 端口四态复用票 04 的守卫；`horosa-ready` 时再做一次 MCP 握手（initialize + tools/list）。
 * @returns {Promise<{ok:boolean,verdict:string,port:number,url:string,evidence:object,detail:string,hint?:string,mcp:object|null}>}
 */
export async function checkHorosaHealth({ port = DEFAULT_HOROSA_PORT, path = HOROSA_MCP_PATH, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS } = {}) {
  const startedAt = Date.now()
  const budget = Math.max(1, Number(timeoutMs) || DEFAULT_HEALTH_TIMEOUT_MS)
  // 端口探针只占预算的一小块（守卫默认 1500ms 就够），其余留给 MCP 握手；两者共享同一个预算，
  // 保证整个 check 有界（contract §9 的 timeoutMs 是「这次 check 的总预算」）。
  const portBudget = Math.min(Math.max(1000, Math.floor(budget * 0.25)), 5000)

  const guard = await checkHorosaPort({ port, path, timeoutMs: portBudget })
  const evidenceBase = { ...guard.evidence, verdict: guard.verdict, port: guard.port, url: guard.url, elapsedMs: Date.now() - startedAt }

  if (guard.verdict !== 'horosa-ready') {
    return healthResult(guard, {
      evidence: evidenceBase,
      mcp: null,
      mcpReady: false,
      detail:
        guard.verdict === 'free'
          ? `${guard.detail} 端口空着（这道门放行，但还没有 MCP）：调用方需要先用 startServe 起 serve，起了再复探一次。`
          : guard.detail,
    })
  }

  const list = await mcpToolsList({ port, path, timeoutMs: Math.max(1000, budget - (Date.now() - startedAt)) })
  const sessionId = list.evidence && list.evidence.sessionId ? list.evidence.sessionId : null
  const mcpReady = list.ok === true && Boolean(sessionId) && list.tools.length > 0
  const mcp = {
    ok: mcpReady,
    status: list.status ?? null,
    sessionId,
    serverInfo: list.serverInfo ?? null,
    toolCount: list.tools.length,
    detail: truncate(list.detail, 400),
  }
  const evidence = {
    ...evidenceBase,
    elapsedMs: Date.now() - startedAt,
    mcpReady,
    mcp: { ok: mcp.ok, status: mcp.status, sessionId: mcp.sessionId, serverInfo: mcp.serverInfo, toolCount: mcp.toolCount },
  }
  debug('probe', `MCP 握手：ok=${mcp.ok} session=${mcp.sessionId ?? '-'} tools=${mcp.toolCount}`)

  return healthResult(guard, {
    ok: mcp.ok,
    evidence,
    mcp,
    mcpReady,
    detail: mcp.ok
      ? `${guard.url} 上的 horosa MCP 健康：${guard.detail} MCP initialize 成功（mcp-session-id=${sessionId}），tools/list 返回 ${mcp.toolCount} 个工具。`
      : `${guard.url} 端口上有 MCP 形态的响应，但 MCP 握手不完整（mcp-session-id=${sessionId ?? '缺失'}、tools/list=${mcp.toolCount} 条）：${list.detail}`,
  })
}

/** 把 fixture 文件读成 tools/call 的 arguments；形状不对就当失败（fail-closed）。 */
function loadFixture(fixturePath) {
  const target = fixturePath ? String(fixturePath) : fileURLToPath(DEFAULT_FIXTURE_URL)
  let payload
  try {
    payload = JSON.parse(readFileSync(target, 'utf8'))
  } catch (error) {
    return { ok: false, path: target, detail: `读不了八字 fixture（${error && error.message ? error.message : String(error)}）：${target}` }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, path: target, detail: `八字 fixture 不是对象：${target}` }
  }
  const required = ['date', 'time', 'zone', 'lat', 'lon']
  const missing = required.filter((key) => payload[key] === undefined || payload[key] === null || `${payload[key]}`.length === 0)
  if (missing.length) {
    return { ok: false, path: target, detail: `八字 fixture 缺必填字段 ${missing.join(', ')}（上游 technical_required_fields = date,time,zone,lat,lon）：${target}` }
  }
  if (payload.timeAlg !== undefined) {
    // 契约 §5：**不传 timeAlg**（缺省 0 = 真太阳时，与票 06 口径一致）。fixture 被改出 timeAlg 就是有人动过它，直接说清楚。
    return { ok: false, path: target, detail: `八字 fixture 不该带 timeAlg（应由引擎缺省 0 = 真太阳时）：${target}` }
  }
  return { ok: true, path: target, payload }
}

/** 单个柱值 → 2 字干支串（认字符串 / `{ganzi|ganZhi|ganzhi|gz}` / `{stem,branch}` 三种形状）。 */
function pillarGanzi(value) {
  if (typeof value === 'string') {
    const text = value.trim()
    if (GANZI_RE.test(text)) return text
    const head = text.slice(0, 2)
    return GANZI_RE.test(head) ? head : null
  }
  if (!value || typeof value !== 'object') return null
  for (const key of ['ganzi', 'ganZhi', 'ganzhi', 'gz', 'ganzhiStr']) {
    const raw = value[key]
    if (typeof raw === 'string' && GANZI_RE.test(raw.trim())) return raw.trim()
  }
  const stem = value.stem && typeof value.stem === 'object' ? value.stem.cell ?? value.stem.gan ?? value.stem.stem : value.stem ?? value.gan
  const branch = value.branch && typeof value.branch === 'object' ? value.branch.cell ?? value.branch.zhi ?? value.branch.branch : value.branch ?? value.zhi
  if (typeof stem === 'string' && typeof branch === 'string') {
    const joined = `${stem.trim()}${branch.trim()}`
    if (GANZI_RE.test(joined)) return joined
  }
  return null
}

function hasFourKeys(node) {
  const keys = Object.keys(node)
  return ['year', 'month', 'day'].every((key) => keys.includes(key)) && (keys.includes('hour') || keys.includes('time'))
}

/** 有界的广度优先搜索：找第一个「同时有 year/month/day/hour|time」的对象。 */
function findFourColumns(root) {
  const queue = [{ node: root, depth: 0 }]
  const seen = new Set()
  let visited = 0
  while (queue.length && visited < 4000) {
    const { node, depth } = queue.shift()
    if (!node || typeof node !== 'object' || depth > 5) continue
    if (seen.has(node)) continue
    seen.add(node)
    visited += 1
    if (!Array.isArray(node) && hasFourKeys(node)) return node
    const values = Array.isArray(node) ? node : Object.values(node)
    for (const value of values.slice(0, 200)) {
      if (value && typeof value === 'object') queue.push({ node: value, depth: depth + 1 })
    }
  }
  return null
}

/**
 * 四柱容器的优先路径：真机实测是 `data.bazi.fourColumns`（`capture/setup-e2e-groundtruth.md` §4），
 * 其余是 vendored builder / 其它后端形状的别名。**先按名字精确取**，取不到才退自动搜索 ——
 * 自动搜索只要「有 year/month/day/hour 四个键」就认，可能撞上 `nongli` 一类的同形对象，
 * 那份证据（`pillarsFrom`）就会指错地方。
 */
const FOUR_COLUMNS_PATHS = [
  ['bazi', 'fourColumns'],
  ['fourColumns'],
  ['bazi', 'pillars'],
  ['pillars'],
  ['bazi', 'sizhu'],
  ['sizhu'],
  ['bazi', 'fourPillars'],
  ['fourPillars'],
]

function pickContainer(data) {
  if (!data || typeof data !== 'object') return { container: null, from: null }
  for (const path of FOUR_COLUMNS_PATHS) {
    let node = data
    let ok = true
    for (const key of path) {
      if (!node || typeof node !== 'object') {
        ok = false
        break
      }
      node = node[key]
    }
    if (ok && node && typeof node === 'object' && !Array.isArray(node) && hasFourKeys(node)) {
      return { container: node, from: `data.${path.join('.')}` }
    }
  }
  const found = findFourColumns(data)
  return { container: found, from: found ? 'data.…（自动搜索）' : null }
}

/** 快照文本兜底：`年柱：甲子…` 这类行（真机四柱来自 `data.bazi.fourColumns`，这里只作后备）。 */
function pillarsFromSnapshot(text) {
  if (typeof text !== 'string' || text.length === 0) return null
  const found = {}
  for (const pillar of PILLARS) {
    const pattern = new RegExp(`${pillar.label}\\s*[：:]\\s*([${GAN}][${ZHI}])`)
    const matched = pattern.exec(text)
    if (matched) found[pillar.key] = matched[1]
  }
  return Object.keys(found).length ? found : null
}

/** 从信封的 data 里抽四柱（返回 4 槽数组：year, month, day, hour；抽不到的位置是 null）。 */
function extractPillars(data) {
  const { container, from } = pickContainer(data)
  let slots = [null, null, null, null]
  if (container) {
    slots = PILLARS.map((pillar) => {
      for (const key of pillar.alias) {
        if (container[key] !== undefined) {
          const ganzi = pillarGanzi(container[key])
          if (ganzi) return ganzi
        }
      }
      return null
    })
  }
  if (slots.every((slot) => slot === null) && data && typeof data === 'object') {
    const fromText = pillarsFromSnapshot(data.snapshot_text)
    if (fromText) slots = PILLARS.map((pillar) => fromText[pillar.key] ?? null)
  }
  return { container, from, slots }
}

/**
 * C3：八字工具可用（两步）。
 * @returns {Promise<{ok:boolean,tool:string,version:string|null,expectedVersion:string,pillars:(string|null)[],checks:object,evidence:object,detail:string}>}
 */
export async function checkBaziTool({ port = DEFAULT_HOROSA_PORT, path = HOROSA_MCP_PATH, timeoutMs = DEFAULT_BAZI_TIMEOUT_MS, fixturePath } = {}) {
  const startedAt = Date.now()
  const budget = Math.max(1000, Number(timeoutMs) || DEFAULT_BAZI_TIMEOUT_MS)
  const expected = expectedVersion()
  const fixture = loadFixture(fixturePath)

  const fail = (detail, checks = {}, extra = {}) => ({
    ok: false,
    tool: BAZI_TOOL,
    version: null,
    expectedVersion: expected,
    pillars: [null, null, null, null],
    checks,
    evidence: { tool: BAZI_TOOL, expectedVersion: expected, fixturePath: fixture.path ?? null, elapsedMs: Date.now() - startedAt, ...extra },
    detail,
  })

  if (!fixture.ok) return fail(fixture.detail, { fixture: false })

  /* ---------- 第一步：tools/list 必须含八字工具 ---------- */
  const list = await mcpToolsList({ port, path, timeoutMs: Math.max(1000, Math.floor(budget * 0.35)) })
  if (!list.ok) {
    return fail(`C3 第一步失败：${list.detail}`, { listed: false }, { toolCount: 0, mcpDetail: truncate(list.detail, 300) })
  }
  if (!list.tools.includes(BAZI_TOOL)) {
    return fail(
      `C3 第一步失败：tools/list 返回 ${list.tools.length} 个工具，但没有 ${BAZI_TOOL}（前 8 个：${list.tools.slice(0, 8).join(', ')}）。`,
      { listed: false, toolPresent: false },
      { toolCount: list.tools.length, toolsHead: list.tools.slice(0, 8) },
    )
  }

  /* ---------- 第二步：tools/call 打固定 fixture ---------- */
  const called = await mcpCallTool({
    name: BAZI_TOOL,
    args: fixture.payload,
    port,
    path,
    timeoutMs: Math.max(1000, budget - (Date.now() - startedAt)),
  })
  const envelope = called.envelope
  const baseEvidence = {
    tool: BAZI_TOOL,
    expectedVersion: expected,
    fixturePath: fixture.path,
    toolCount: list.tools.length,
    serverInfo: list.serverInfo ?? null,
    callEnvelopeFrom: called.evidence.envelopeFrom ?? null,
    elapsedMs: Date.now() - startedAt,
  }

  if (!called.ok || !envelope) {
    return {
      ok: false,
      tool: BAZI_TOOL,
      version: null,
      expectedVersion: expected,
      pillars: [null, null, null, null],
      checks: { listed: true, toolPresent: true, envelope: false },
      evidence: { ...baseEvidence, mcpDetail: truncate(called.detail, 300), envelopeKeys: called.evidence.envelopeKeys ?? null },
      detail: `C3 第二步失败：${called.detail}`,
    }
  }

  const version = typeof envelope.version === 'string' ? envelope.version : null
  const envelopeTool = typeof envelope.tool === 'string' ? envelope.tool : null
  const data = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data) ? envelope.data : null
  const dataKeys = data ? Object.keys(data) : []
  const { container, from: pillarsFrom, slots } = extractPillars(data ?? {})
  const pillarsOk = slots.every((slot) => typeof slot === 'string' && GANZI_RE.test(slot))
  const checks = {
    listed: true,
    toolPresent: true,
    envelope: true,
    envelopeOk: envelope.ok === true,
    version: version === expected,
    envelopeTool: envelopeTool === BAZI_ENVELOPE_TOOL,
    dataNonEmpty: Boolean(data) && dataKeys.length > 0,
    pillars: pillarsOk,
  }
  const evidence = {
    ...baseEvidence,
    version,
    envelopeTool,
    envelopeOk: envelope.ok === true,
    dataKeys: dataKeys.slice(0, 24),
    pillars: slots,
    pillarsFrom: container ? pillarsFrom : 'snapshot_text',
  }
  debug('probe', `C3 信封：ok=${envelope.ok} version=${version} tool=${envelopeTool} pillars=${slots.join(' ')}`)

  if (envelope.ok !== true) {
    const code = envelope.code ?? (envelope.error && envelope.error.code) ?? null
    const message = envelope.message ?? (envelope.error && envelope.error.message) ?? null
    return {
      ok: false,
      tool: BAZI_TOOL,
      version,
      expectedVersion: expected,
      pillars: slots,
      checks,
      evidence: { ...evidence, code, message: truncate(message ?? '', 300) },
      detail: `C3 失败：八字信封 ok !== true（code=${code ?? '-'}${message ? `，message=${truncate(message, 200)}` : ''}）——大概率是确认闸（agent_confirmed_settings/clarification_notes）或 fixture 字段问题。`,
    }
  }
  if (version !== expected) {
    return {
      ok: false,
      tool: BAZI_TOOL,
      version,
      expectedVersion: expected,
      pillars: slots,
      checks,
      evidence,
      detail: `C3 失败：信封 version=${version ?? '-'}，期望 ${expected}（钉版见 scripts/setup/horosa-pin.json）——「新树混旧 runtime」的典型症状。`,
    }
  }
  if (envelopeTool !== BAZI_ENVELOPE_TOOL) {
    return {
      ok: false,
      tool: BAZI_TOOL,
      version,
      expectedVersion: expected,
      pillars: slots,
      checks,
      evidence,
      detail: `C3 失败：信封 tool=${envelopeTool ?? '-'}，期望 ${BAZI_ENVELOPE_TOOL}（MCP 名 ${BAZI_TOOL} 应当转发到同名技法）。`,
    }
  }
  if (!checks.dataNonEmpty) {
    return { ok: false, tool: BAZI_TOOL, version, expectedVersion: expected, pillars: slots, checks, evidence, detail: 'C3 失败：信封 data 为空（没有可读的盘面）。' }
  }
  if (!pillarsOk) {
    return {
      ok: false,
      tool: BAZI_TOOL,
      version,
      expectedVersion: expected,
      pillars: slots,
      checks,
      evidence,
      detail: `C3 失败：四柱不可读（拿到 ${slots.map((slot) => slot ?? '?').join(' ')}，期望四个 2 字干支串；键路径 data.bazi.fourColumns.{year,month,day,hour}.ganzi）。`,
    }
  }

  return {
    ok: true,
    tool: BAZI_TOOL,
    version,
    expectedVersion: expected,
    pillars: slots,
    checks,
    evidence,
    detail: `C3 通过：tools/list 含 ${BAZI_TOOL}（共 ${list.tools.length} 条），tools/call 信封 ok=true、version=${version}、tool=${envelopeTool}，四柱 ${slots.join(' ')}。`,
  }
}
