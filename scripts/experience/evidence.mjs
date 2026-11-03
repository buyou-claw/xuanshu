#!/usr/bin/env node
/**
 * `scripts/experience/evidence.mjs` —— **实操评估的证据记录器**（ADR-0017 的唯一新 seam）。
 *
 * 它只做一件事：把「一次操作」变成**确定性的证据结构**——步骤行、覆盖状态、错误行、
 * 截图落点。它**不驱动浏览器、不判定成败、不读写真实 home**：驱动与判定分别在
 * `startIsolatedInstance`（既有）与报告里，本模块只管「记下来的是什么形状」。
 *
 * 为什么必须确定性（同一输入两跑字节相同）：
 *   证据要能跨轮逐项比较（`task-before` ↔ `task-after`）。一旦步骤行里混进时间戳、
 *   随机 id 或绝对路径，两份报告就再也对不上，「改前/改后」只能靠人眼看截图。
 *
 * 为什么状态词表**复用判据词表**（ADR-0017 第 5 条）：
 *   「未采到 ≠ 通过」是本仓的一条铁律。它已经有一份口径（`scripts/ux/judge.mjs` 的
 *   `VERDICT_STATUSES`）。实操评估若另造 `passed/failed/not-run/needs-human`，
 *   同一个事实就会有两个名字，两边迟早各说各话。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { VERDICT_STATUSES } from '../ux/judge.mjs'

/** 证据根目录（gitignore；ADR-0017 第 10 条）。原始截图与 trace 不入库。 */
export const EVIDENCE_ROOT = 'ux-reports'

/**
 * 一轮评估的证据目录名形如 `experience-round-01`。
 * `assertEvidenceDir` 只认**正好这一层**：更深（`…/shots`）与更浅（`ux-reports`）都不算
 * 一轮评估的落点，文件名由 `EVIDENCE_FILES` 固定，调用方拼到轮次目录下即可。
 */
export const EXPERIENCE_DIR_PATTERN = /^ux-reports\/experience-[a-z0-9][a-z0-9._-]*$/u

/**
 * 覆盖状态闭集 = **判据判定词表 + `blocked`**。
 * `blocked` 是实操独有的：环境缺前置（没配模型、horosa 未起、桌面壳测不了）
 * 时任务走不完，这不是「未采到」，也不是「失败」——它拒绝把环境问题记成产品问题。
 */
export const COVERAGE_STATUSES = [...VERDICT_STATUSES, 'blocked']

/**
 * 旧词 → 判据词。计划 §9.3 写的是 `passed / failed / blocked / not-run / needs-human`；
 * 按 ADR-0017 第 5 条统一到判据词表，映射只此一份。
 */
export const LEGACY_STATUS_MAP = Object.freeze({
  passed: 'pass',
  failed: 'fail',
  'not-run': 'not-collected',
  'needs-human': 'human-only',
  blocked: 'blocked',
})

/** 证据包里的固定文件名（报告与复测脚本按这些名字取，不许各写各的）。 */
export const EVIDENCE_FILES = Object.freeze({
  environment: 'environment.json',
  coverage: 'coverage.json',
  findings: 'findings.md',
  steps: 'steps.jsonl',
  errors: 'errors.json',
  trace: 'trace.zip',
})

/**
 * 步骤行的**字段闭集**（票 #75 验收标准第 1 条）。
 * 顺序即输出键序 —— 确定性靠它：同一输入两跑字节完全相同。
 * 闭集外的键（`timestamp` / `at` / `time` / 绝对路径……）一律拒绝，见 `stepLine`。
 */
export const STEP_FIELDS = Object.freeze(['step', 'action', 'target', 'outcome', 'shot', 'note'])

/** 可读的输入问题（调用方按它退 2，不当成断言红）。 */
export class EvidenceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'EvidenceError'
  }
}

/**
 * 归一一个覆盖状态。
 * @param {string} status 计划原词、判据词或 `blocked`
 * @returns {string} 判据词表里的状态
 * @throws {EvidenceError} 不认识的状态（不猜、不静默放过）
 */
export function normalizeStatus(status) {
  if (typeof status !== 'string' || status.trim() === '') {
    throw new EvidenceError('覆盖状态必须是非空字符串')
  }
  const raw = status.trim()
  if (COVERAGE_STATUSES.includes(raw)) return raw
  const mapped = LEGACY_STATUS_MAP[raw]
  if (mapped !== undefined) return mapped
  throw new EvidenceError(
    `未知覆盖状态「${raw}」——只接受 ${COVERAGE_STATUSES.join(' / ')}，`
    + `以及计划旧词 ${Object.keys(LEGACY_STATUS_MAP).join(' / ')}（旧词按 ADR-0017 第 5 条映射到判据词）`,
  )
}

/**
 * 造一行 `steps.jsonl`。
 *
 * 字段闭集（`STEP_FIELDS`：step / action / target / outcome / shot / note）、键序固定；
 * **不含时间戳与绝对路径**（比较要靠它），**闭集外的键直接报错**而不是静默丢弃。
 * 需要「什么时候发生的」时，用 `step` 这个**相对序号**（第几步），不用墙上时钟：
 * 两次执行的速度必然不同，时钟一进来，两份报告就没法逐项比。
 *
 * @param {{step: number, action: string, target?: string, outcome: string, shot?: string, note?: string}} input
 * @returns {string} 一行 JSON（不含换行符）
 * @throws {EvidenceError} 字段缺失 / 类型不对 / 出现闭集外的字段 / shot 带目录分隔符
 */
export function stepLine(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new EvidenceError('stepLine: 输入必须是对象')
  }
  // 闭集封口：多余键一律拒绝，不静默丢弃。
  // 为什么不能「忽略」：调用方顺手带上一个墙上时钟（`Date.now` 那一类）时若被静默丢掉，
  // 它会以为证据里记了时间；而真正的坑是反过来——哪天有人把时钟塞进这个闭集，
  // 两份报告立刻没法逐项比。闭集是「改前/改后可比」的唯一保障，所以它必须是**硬**的
  // （票 #75 验收标准第 1、2 条）。
  for (const key of Object.keys(input)) {
    if (!STEP_FIELDS.includes(key)) {
      throw new EvidenceError(
        `stepLine: 出现闭集外的字段「${key}」——步骤行只允许 ${STEP_FIELDS.join(' / ')}；`
        + '时间戳、绝对路径一类字段被明确排除（确定性靠它）。',
      )
    }
  }

  const { step, action, target, outcome, shot, note } = input

  if (!Number.isInteger(step) || step < 1) throw new EvidenceError('stepLine: step 必须是 ≥1 的整数（步骤序号）')
  if (typeof action !== 'string' || action.trim() === '') throw new EvidenceError('stepLine: action 必须是非空字符串（做了什么）')
  if (typeof outcome !== 'string' || outcome.trim() === '') throw new EvidenceError('stepLine: outcome 必须是非空字符串（这一步的结果）')

  const line = { step, action: action.trim(), outcome: outcome.trim() }
  if (target !== undefined) {
    if (typeof target !== 'string' || target.trim() === '') throw new EvidenceError('stepLine: target 给了就必须是非空字符串')
    line.target = target.trim()
  }
  if (shot !== undefined) {
    if (typeof shot !== 'string' || shot.trim() === '') throw new EvidenceError('stepLine: shot 给了就必须是非空字符串')
    // 截图只记相对证据目录的文件名：绝对路径一进报告，换台机器就对不上。
    if (shot.includes('/') || shot.includes('\\')) {
      throw new EvidenceError(`stepLine: shot 只能是文件名（不含目录分隔符），收到「${shot}」`)
    }
    line.shot = shot.trim()
  }
  if (note !== undefined) {
    if (typeof note !== 'string') throw new EvidenceError('stepLine: note 必须是字符串')
    line.note = note
  }
  // 确定性序列化：键序由构造决定，不排序、不缩进（JSONL 一行一条）。
  return JSON.stringify(line)
}

/**
 * 需要脱敏的查询参数名（ADR-0017「脱敏」段的定值）。
 * 匹配时按整名对齐：`?apikey=` / `?tokens=` / `?my_key=` 这类前后缀变体**不**在名单里，
 * 免得把无害参数改成占位符而看不出问题（也免得真正的凭据因为「少匹配」漏出去时无人察觉）。
 */
export const SENSITIVE_URL_PARAMS = Object.freeze([
  'token', 'access_token', 'code', 'key', 'secret', 'password',
])

/** 脱敏后的占位值。 */
export const REDACTED = '<redacted>'

/**
 * 脱敏一条 URL：去掉 `token=` / `code=` 一类的一次性凭据。
 *
 * 为什么要它：认证材料出现在 URL、日志、trace 里是常态；这些证据会被贴进报告与 PR。
 * 起隔离实例的 `?token=` 就打在启动器 stdout 上，一旦被抄进 `errors.json` 或步骤行，
 * 报告就成了凭据载体。计划 §9.3 要求「分享前脱敏核查」，把核查做成函数，才不是一句口号。
 *
 * 覆盖的起始位置：`?`（`/?token=`）、`&`（`?a=1&token=`）、`#`（哈希路由 `#/p?token=`
 * 与片段直接带值的 `#token=`）。值截止到 `&` / `#` / 空白，所以带片段的 URL 只脱值本身。
 * 参数名大小写不敏感；重复执行幂等。
 *
 * @param {string} url
 * @returns {string} 敏感查询参数的值替换为 `REDACTED`，其余原样
 * @throws {EvidenceError} 不是字符串（不猜它是什么）
 */
export function sanitizeUrl(url) {
  if (typeof url !== 'string') throw new EvidenceError('sanitizeUrl: 必须是字符串')
  const names = SENSITIVE_URL_PARAMS.join('|')
  return url.replaceAll(
    new RegExp(`([?&#])(?:${names})=[^&#\\s]*`, 'giu'),
    // 保留「前导符 + 参数名」时不能直接回填原大小写，所以用函数式替换重新拼一次。
    (match) => {
      const lead = match[0]
      const name = match.slice(1, match.indexOf('='))
      return `${lead}${name}=${REDACTED}`
    },
  )
}

/**
 * 剥掉堆栈帧，只留消息本体。
 *
 * 浏览器侧的 `pageerror` / console 文本常常把整段堆栈拼在消息后面（`Error: x\n    at f (…)`)。
 * 堆栈里是**内部文件路径与调用链**，定位靠的是「第几步 + 截图」，不是它（票 #75 验收标准第 7 条）。
 * 判定用行首的 `at `：V8 与 Firefox 的帧都是这个形状。
 *
 * @param {string} message
 * @returns {string} 去掉堆栈帧后的消息
 */
function stripStack(message) {
  const kept = []
  for (const line of message.split(/\r?\n/u)) {
    if (/^\s*at\s+\S/u.test(line)) continue
    if (/^\s*at\s*$/u.test(line)) continue
    kept.push(line)
  }
  return kept.join('\n').trim()
}

/**
 * 归一一条错误：接受 `'文本'` 或 `{ message, step }`，产出 `{ kind, message, step? }`。
 * 闭集外的键（`stack` / `headers` / `requestHeaders` / `responseHeaders` / `url` …）**不进输出**，
 * 而且这里不是静默丢弃：消息与步骤之外的东西一律留在文档外面，正是「不留堆栈与完整请求头」的落点。
 *
 * @param {string | {message: string, step?: number}} item
 * @param {string} kind 错误类别名
 * @returns {object} 最小字段行
 * @throws {EvidenceError} 既不是非空字符串、也不是带非空 `message` 的对象；或 `step` 不是 ≥1 整数
 */
function errorRow(item, kind) {
  let message
  let step
  if (typeof item === 'string') {
    message = item
  } else if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
    const keys = Object.keys(item)
    for (const key of keys) {
      if (key === 'message' || key === 'step') continue
      // 允许「多余键被忽略」是这条验收的漏洞：调用方以为记下了 headers。
      // 所以显式拒绝，让它回来把凭据从输入里摘掉。
      throw new EvidenceError(
        `errorsDocument: ${kind} 一行出现闭集外的字段「${key}」——只允许 message / step；`
        + '堆栈与请求头明确不入库（含凭据与内部路径）。',
      )
    }
    message = item.message
    step = item.step
  } else {
    throw new EvidenceError(`errorsDocument: ${kind} 的每一项必须是非空字符串或 { message, step }，收到「${String(item)}」`)
  }

  if (typeof message !== 'string' || stripStack(message) === '') {
    throw new EvidenceError(`errorsDocument: ${kind} 一行的 message 必须是非空字符串（剥掉堆栈后还剩内容）`)
  }
  const row = { kind, message: sanitizeUrl(stripStack(message)) }
  if (step !== undefined) {
    if (!Number.isInteger(step) || step < 1) {
      throw new EvidenceError(`errorsDocument: ${kind} 一行的 step 必须是 ≥1 的整数（发生在第几步），收到「${String(step)}」`)
    }
    row.step = step
  }
  return row
}

/**
 * 造 `errors.json` 的形状（浏览器侧捕获的几类错误）。
 *
 * 只留能定位问题的最小字段：`kind`（哪一类）、`message`（脱敏后）、`step`（发生在第几步）。
 * **不留堆栈与完整请求头**：它们含有凭据与内部路径，而定位靠的是步骤 + 截图。
 * `message` 一律走过 `sanitizeUrl`，所以凭据不会借「错误文本」这条路进报告。
 *
 * @param {{consoleErrors?: (string | {message: string, step?: number})[], pageErrors?: (string | object)[], requestFailures?: (string | object)[], httpErrors?: (string | object)[]}} input
 * @returns {{console: object[], page: object[], requestFailed: object[], http: object[], total: number}}
 * @throws {EvidenceError} 单行形状不对 / 出现 message·step 之外的字段 / step 非法
 */
export function errorsDocument(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new EvidenceError('errorsDocument: 输入必须是对象')
  }
  const allowed = ['consoleErrors', 'pageErrors', 'requestFailures', 'httpErrors']
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      throw new EvidenceError(`errorsDocument: 出现未知输入字段「${key}」——只接受 ${allowed.join(' / ')}`)
    }
  }
  const { consoleErrors = [], pageErrors = [], requestFailures = [], httpErrors = [] } = input
  const groups = [
    ['console', consoleErrors],
    ['page', pageErrors],
    ['request', requestFailures],
    ['http', httpErrors],
  ]
  for (const [kind, list] of groups) {
    if (!Array.isArray(list)) throw new EvidenceError(`errorsDocument: ${kind}Errors 必须是数组`)
  }

  const document = {
    console: consoleErrors.map((item) => errorRow(item, 'console')),
    page: pageErrors.map((item) => errorRow(item, 'page')),
    requestFailed: requestFailures.map((item) => errorRow(item, 'request')),
    http: httpErrors.map((item) => errorRow(item, 'http')),
  }
  const total = Object.values(document).reduce((sum, rows) => sum + rows.length, 0)
  return { ...document, total }
}

/**
 * 造 `coverage.json`。
 *
 * 每一行都必须**指向证据或阻塞理由**（计划 §9.3）：`pass` / `fail` 要给 `evidence`，
 * `blocked` / `not-collected` 要给 `reason`。缺了这一半，覆盖表就会退化成「打勾表」。
 *
 * @param {{caseId: string, status: string, evidence?: string, reason?: string, lastStep?: string, scenario?: string}[]} cases
 * @returns {{schema: string, cases: object[], totals: Record<string, number>}}
 * @throws {EvidenceError} 状态不认识 / 该给的证据或理由没给 / caseId 重复
 */
export function coverageDocument(cases) {
  if (!Array.isArray(cases)) throw new EvidenceError('coverageDocument: cases 必须是数组')
  const seen = new Set()
  const rows = cases.map((item) => {
    const { caseId, status, evidence, reason, lastStep, scenario } = item ?? {}
    if (typeof caseId !== 'string' || caseId.trim() === '') throw new EvidenceError('coverageDocument: 每条都要有 caseId')
    // 查重按**归一后**的 caseId：一条用例只有一个结论，写成 `'E01'` 与 `' E01 '`
    // 是同一个结论的两个说法，不是两条用例（票 #75 验收标准第 5 条）。
    const normalizedCaseId = caseId.trim()
    if (seen.has(normalizedCaseId)) {
      throw new EvidenceError(`coverageDocument: caseId 重复：${normalizedCaseId}（一条用例只能有一行结论）`)
    }
    seen.add(normalizedCaseId)

    const normalized = normalizeStatus(status)
    const needsEvidence = normalized === 'pass' || normalized === 'fail'
    if (needsEvidence && (typeof evidence !== 'string' || evidence.trim() === '')) {
      throw new EvidenceError(`coverageDocument: ${caseId} 是 ${normalized}，必须给 evidence（指向截图或步骤）`)
    }
    if (!needsEvidence && (typeof reason !== 'string' || reason.trim() === '')) {
      throw new EvidenceError(`coverageDocument: ${caseId} 是 ${normalized}，必须给 reason（为什么没走成）`)
    }

    const row = { caseId: normalizedCaseId, status: normalized }
    if (scenario !== undefined) row.scenario = scenario
    if (lastStep !== undefined) row.lastStep = lastStep
    if (needsEvidence) row.evidence = evidence.trim()
    else row.reason = reason.trim()
    return row
  })

  const totals = Object.fromEntries(COVERAGE_STATUSES.map((status) => [status, 0]))
  for (const row of rows) totals[row.status] += 1
  return { schema: 'xuanshu/experience-coverage@1', cases: rows, totals }
}

/**
 * 断言证据目录落在 `ux-reports/` 下且形如一轮评估（ADR-0017 第 10 条）。
 * 这条同时挡住两个错：把证据写进仓库源码树、把证据写进真实 home。
 *
 * @param {string} out 相对仓库根的路径
 * @returns {string} 原样返回（便于链式调用）
 * @throws {EvidenceError}
 */
export function assertEvidenceDir(out) {
  if (typeof out !== 'string' || out.trim() === '') throw new EvidenceError('assertEvidenceDir: out 必须是非空字符串')
  const normalized = out.replaceAll('\\', '/').replace(/\/+$/u, '')
  if (normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) {
    throw new EvidenceError(`assertEvidenceDir: 必须是相对仓库根的路径，收到绝对路径「${out}」`)
  }
  if (!EXPERIENCE_DIR_PATTERN.test(normalized)) {
    throw new EvidenceError(
      `assertEvidenceDir: 证据目录必须形如 ${EVIDENCE_ROOT}/experience-<轮次>（小节字母数字），收到「${normalized}」`,
    )
  }
  return normalized
}
