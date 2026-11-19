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

/** 一轮评估的证据目录名形如 `experience-round-01`；`--out` 必须是它下面的一层。 */
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
 * 字段闭集、键序固定；**不含时间戳与绝对路径**（比较要靠它）。
 * 需要「什么时候发生的」时，用 `at` 这个**相对序号**（第几步），不用墙上时钟：
 * 两次执行的速度必然不同，时钟一进来，两份报告就没法逐项比。
 *
 * @param {{step: number, action: string, target?: string, outcome: string, shot?: string, note?: string}} input
 * @returns {string} 一行 JSON（不含换行符）
 * @throws {EvidenceError} 字段缺失 / 类型不对 / outcome 不认识
 */
export function stepLine(input) {
  const { step, action, target, outcome, shot, note } = input ?? {}

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
 * 脱敏一条 URL：去掉 `token=` / `code=` 一类的一次性凭据。
 *
 * 为什么要它：认证材料出现在 URL、日志、trace 里是常态；这些证据会被贴进报告与 PR。
 * 计划 §9.3 要求「分享前脱敏核查」，把核查做成函数，才不是一句口号。
 *
 * @param {string} url
 * @returns {string} 敏感查询参数的值替换为 `<redacted>`，其余原样
 */
export function sanitizeUrl(url) {
  if (typeof url !== 'string') throw new EvidenceError('sanitizeUrl: 必须是字符串')
  return url.replace(
    /([?&](?:token|access_token|code|key|secret|password)=)[^&#\s]*/giu,
    '$1<redacted>',
  )
}

/**
 * 造 `errors.json` 的形状（浏览器侧捕获的几类错误）。
 *
 * 只留能定位问题的最小字段：`kind`（哪一类）、`message`（脱敏后）、`step`（发生在第几步）。
 * **不留堆栈与完整请求头**：它们含有凭据与内部路径，而定位靠的是步骤 + 截图。
 *
 * @param {{consoleErrors?: string[], pageErrors?: string[], requestFailures?: string[], httpErrors?: string[]}} input
 * @returns {{console: object[], page: object[], requestFailed: object[], http: object[], total: number}}
 */
export function errorsDocument(input = {}) {
  const { consoleErrors = [], pageErrors = [], requestFailures = [], httpErrors = [] } = input
  const asText = (value) => (typeof value === 'string' ? sanitizeUrl(value) : String(value))

  const document = {
    console: consoleErrors.map((message) => ({ kind: 'console', message: asText(message) })),
    page: pageErrors.map((message) => ({ kind: 'page', message: asText(message) })),
    requestFailed: requestFailures.map((message) => ({ kind: 'request', message: asText(message) })),
    http: httpErrors.map((message) => ({ kind: 'http', message: asText(message) })),
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
    if (seen.has(caseId)) throw new EvidenceError(`coverageDocument: caseId 重复：${caseId}（一条用例只能有一行结论）`)
    seen.add(caseId)

    const normalized = normalizeStatus(status)
    const needsEvidence = normalized === 'pass' || normalized === 'fail'
    if (needsEvidence && (typeof evidence !== 'string' || evidence.trim() === '')) {
      throw new EvidenceError(`coverageDocument: ${caseId} 是 ${normalized}，必须给 evidence（指向截图或步骤）`)
    }
    if (!needsEvidence && (typeof reason !== 'string' || reason.trim() === '')) {
      throw new EvidenceError(`coverageDocument: ${caseId} 是 ${normalized}，必须给 reason（为什么没走成）`)
    }

    const row = { caseId: caseId.trim(), status: normalized }
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
