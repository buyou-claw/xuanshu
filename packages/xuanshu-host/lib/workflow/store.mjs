/**
 * packages/xuanshu-host/lib/workflow/store.mjs — 工作流会话的旁挂清单（票 16 契约 §4）。
 *
 * 一个工作流 = **一个会话**（向导本体就跑在会话里，S12 D5）。分类载体照 ADR-0009：
 *   - `sessionId` = `session-xs-workflow-<uuid>`（玄枢自铸前缀，`SessionId` 不做格式校验）；
 *   - `cwd` = `<dataDir>/workflow`（专用 cwd，**不是** workspace —— 挂进 workspace 会破坏
 *     「问事 / 工作流与工作区并列」这条产品约束）；
 *   - 旁挂清单 = `<dataDir>/workflow/<sessionId>.json`，schema `xuanshu/workflow@1`。
 *
 * **不做什么**（与票 10 同一套纪律）：不往 `meta` 塞额外键（那 7 个字段是闭集，塞了静默丢）、
 * 不新增会话事件 `type`（会话会打不开）、不把 `agentPreset` 当标签。
 *
 * 「工作流不是谱」（CONTEXT.md）：这里**没有**任何写 `pus/` 的路径，`workflow.list` 也绝不读谱目录。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** 旁挂清单的 schema。 */
export const WORKFLOW_SCHEMA = 'xuanshu/workflow@1'

/** 会话 id 前缀（ADR-0009 的 `session-xs-<kind>-<uuid>`）。 */
export const WORKFLOW_SESSION_PREFIX = 'session-xs-workflow-'

/** 名字兜底（还没起名时的显示名）。 */
export const UNNAMED_WORKFLOW = '未命名工作流'

/** 工作流目录（`<dataDir>/workflow/`）。 */
export function workflowRoot(dataDir) {
  return join(dataDir, 'workflow')
}

/** 一个工作流的清单文件（文件名就是 sessionId —— 一个工作流一个会话）。 */
export function workflowFile(dataDir, sessionId) {
  if (!isWorkflowSessionId(sessionId)) throw new Error(`工作流会话 id 非法：${JSON.stringify(sessionId)}`)
  return join(workflowRoot(dataDir), `${sessionId}.json`)
}

/** 玄枢自铸的会话 id（前缀 + uuid；`isWorkflowSessionId` 是唯一的形状判据）。 */
export function newWorkflowSessionId() {
  return `${WORKFLOW_SESSION_PREFIX}${randomUUID()}`
}

export function isWorkflowSessionId(value) {
  return typeof value === 'string' && value.startsWith(WORKFLOW_SESSION_PREFIX) && value.length > WORKFLOW_SESSION_PREFIX.length
}

/** 工作流的工作目录（会话 cwd；建会话前先建出来，别让 DSH 去猜）。 */
export function workflowCwd(dataDir) {
  return workflowRoot(dataDir)
}

/** 非空字符串规范化。 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 从 seed 里取一个显示名（首行、截断；给不出就用兜底名）。 */
export function nameFromSeed(seed) {
  const first = text(seed).split(/\r?\n/).find((line) => line.trim() !== '') ?? ''
  const name = first.replace(/^[/\s]+/u, '').trim()
  return name === '' ? UNNAMED_WORKFLOW : (name.length > 40 ? `${name.slice(0, 40)}…` : name)
}

/** 原子写（同目录临时文件 + rename）。 */
function writeAtomic(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  try {
    renameSync(tmp, file)
  } catch (error) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* 临时文件清不掉不掩盖原错误 */
    }
    throw error
  }
  return file
}

/** 写一份工作流清单（建会话时调一次；导出后再更新一次）。 */
export function writeWorkflow(dataDir, record) {
  mkdirSync(workflowRoot(dataDir), { recursive: true })
  return writeAtomic(workflowFile(dataDir, record.sessionId), record)
}

/** 读一份工作流清单：不存在 / 坏 / schema 不认识 → null（列表里就当没有这一条）。 */
export function readWorkflow(dataDir, sessionId) {
  try {
    const parsed = JSON.parse(readFileSync(workflowFile(dataDir, sessionId), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed.schema === WORKFLOW_SCHEMA ? parsed : null
  } catch {
    return null
  }
}

/**
 * 列出全部工作流（创建时间倒序）。默认宽松列表跳过坏条目；strict 用于事实统计，
 * 必须区分「没有工作流」与「清单核不了」，不能把读取失败折算成已知零条。
 */
export function listWorkflows(dataDir, { strict = false } = {}) {
  const root = workflowRoot(dataDir)
  if (!strict && !existsSync(root)) return []
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch (error) {
    if (strict && error?.code === 'ENOENT') return []
    throw error
  }
  const out = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const record = readWorkflow(dataDir, entry.name.slice(0, -'.json'.length))
    if (record === null && strict) throw new Error(`工作流清单 ${entry.name} 读不出来或格式不合法，无法核对完整工作流列表。`)
    if (record !== null) out.push(record)
  }
  return out.sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))
}

/** 清单 → 契约 §4 的列表项（`exportedAt` 只有导出过才有 —— 缺失即省略键）。 */
export function toWorkflowItem(record) {
  const item = { id: String(record.id ?? record.sessionId ?? ''), name: String(record.name ?? UNNAMED_WORKFLOW), sessionId: String(record.sessionId ?? '') }
  if (typeof record.exportedAt === 'string' && record.exportedAt !== '') item.exportedAt = record.exportedAt
  return item
}
