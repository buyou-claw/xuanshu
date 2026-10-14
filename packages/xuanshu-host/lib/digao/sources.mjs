/**
 * packages/xuanshu-host/lib/digao/sources.mjs — 底稿的三个来源怎么采（票 13 契约 §1）。
 *
 * 契约 §1 点名的三个来源：
 *   - **谱**：`pu.list({level:'base'})`（base 级谱）**加**票 08 的底座谱（`pus/_base/`，走
 *     `repository.readBase()` 那条保留路径）——底座是「我是谁」的第一来源，必须在场；
 *   - **工作区**：`ctx.workspaceRegistry.list()`（宿主侧唯一的「工作区」实体 ——
 *     `CONTEXT.md` 的术语两级是「工作区 / 项目」，**不拿「项目」当工作区的同义词**）；
 *   - **工作流**：**票 16 才生产**，本票只留空路（正文里写「尚无来源」，不是假装扫过了）。
 *
 * 段落内容 = 该源的 `summary`（优先）或概览（契约 §1 原文）。工作区没有 summary/概览这两个字段，
 * 所以只落它的**标识行**（标题 + 路径 + 会话数）——扫描工作区内容属票 12 的挂载面，
 * 本票不越界去读别人的文件（也免得把底稿变成一份代码索引）。
 */

import { basename } from 'node:path'

import { createPuRepository } from '../pu/repository.mjs'

/** 单段正文的字符上限（底稿是「精简汇总」，不是全文搬运；超了截断并标注）。 */
export const SEGMENT_TEXT_LIMIT = 400

/** 非空字符串规范化。 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 超长正文截断（保留「还有更多」的信号，不静默丢）。 */
export function clip(value) {
  const raw = text(value)
  if (raw.length <= SEGMENT_TEXT_LIMIT) return raw
  return `${raw.slice(0, SEGMENT_TEXT_LIMIT)}…（下略）`
}

/**
 * 谱来源：底座谱在前，其余 base 级谱按仓库顺序跟在后面。
 * @returns {{name: string, text: string}[]}
 */
export function collectPuSources(dataDir) {
  const repository = createPuRepository(dataDir)
  const out = []
  try {
    const base = repository.readBase()
    if (base !== null) out.push({ name: text(base.name) || '底座', text: clip(base.summary || base.description || base.body) })
  } catch {
    /* 底座谱坏了：不阻断底稿（它在快照那一侧自有 error 态），当这一路没内容 */
  }
  for (const pu of repository.list({ level: 'base' })) {
    if (pu.error !== undefined) continue
    out.push({ name: text(pu.name) || text(pu.slug), text: clip(pu.summary || pu.description || pu.body) })
  }
  return out
}

/**
 * 工作区来源（`ctx.workspaceRegistry.list()`；服务不可得 → 空数组，不抛）。
 * @returns {{name: string, text: string}[]}
 */
export function collectWorkspaceSources(ctx) {
  const registry = ctx?.workspaceRegistry
  if (!registry || typeof registry.list !== 'function') return []
  let workspaces
  try {
    workspaces = registry.list()
  } catch {
    return []
  }
  if (!Array.isArray(workspaces)) return []
  return workspaces.map((workspace) => {
    const title = text(workspace?.title) || (text(workspace?.path) !== '' ? basename(text(workspace.path)) : '工作区')
    const path = text(workspace?.path)
    const sessions = Array.isArray(workspace?.sessionIds) ? workspace.sessionIds.length : 0
    return {
      name: title,
      text: `工作区「${title}」${path === '' ? '' : ` · 路径 ${path}`} · 会话 ${sessions} 场`,
    }
  })
}

/** 工作流来源：票 16 才生产（契约 §1：本票留空路）。 */
export function collectWorkflowSources() {
  return []
}

/**
 * 采集三路来源（同步：全是本地文件与内存枚举，**不联网、不调 LLM**）。
 * @returns {{pu: object[], workspace: object[], workflow: object[], notes: string[]}}
 */
export function collectSources({ ctx, dataDir } = {}) {
  const notes = []
  if (!ctx?.workspaceRegistry || typeof ctx.workspaceRegistry.list !== 'function') {
    notes.push('workspaceRegistry 服务不可得：工作区这一路按「无来源」处理（不伪造）。')
  }
  return {
    pu: collectPuSources(dataDir),
    workspace: collectWorkspaceSources(ctx),
    workflow: collectWorkflowSources(),
    notes,
  }
}
