/**
 * packages/xuanshu-host/lib/shiji/scan.mjs —— 事记的**依据采集**（票 05 / #26 契约 §1）。
 *
 * 两路自动来源：
 *   1. **工作区**（`ctx.workspaceRegistry.list()`）：一个工作区 = 一条事记。依据 = 里有人说过话的会话
 *      （`user/message` 且 `source.kind === 'user'`）+ 项目里的说明文档（`shiji/docs.mjs` 的白名单）。
 *      「最后活跃」沿用 DSH 侧栏同一条口径 `max(createdAt, lastPromptAt)`
 *      （`dsh-api-session-controller` 的 `updatedAt()`；`Workspace.updatedAt` **不是**活跃时间）。
 *   2. **工作流**（票 16 的 `<dataDir>/workflow/*.json`）：**只收导出过 skill 的** ——
 *      `exportedAt` 非空 **且** `<dshHome>/skills/<skillName>/SKILL.md` 真存在（用户事后手删目录就
 *      不再算）。判据是清单 + 文件，**不用** `ctx.skills.list()`（web 层看不全 user-dsh 层，见
 *      `workflow/skill-export.mjs` 的注释）。
 *
 * 三条纪律：
 *   - **服务软取**：任一服务缺席 = 「这一路核不了」，不是「没有」；降级写 `notes`，绝不编时间/内容；
 *   - **单点失败不拖垮整轮**：一个项目目录读不动只影响它自己；坏工作流清单由 `workflow/store.mjs` 跳过；
 *   - **本模块只读**：不写 `shiji.jsonl`、不调 LLM、不 import `rikke/**` / `digao/**` / `workflow/service.mjs`
 *     （`digao/generate.mjs` 会 import 事记的账本，反向依赖必须保持单向）。
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { fallbackXuanshuHome } from '../home.mjs'
import { skillFile } from '../workflow/skill-export.mjs'
import { listWorkflows } from '../workflow/store.mjs'
import { collectProjectDocs } from './docs.mjs'

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/** 非空字符串规范化。 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * DSH home（skill 扫描根 `<dshHome>/skills` 的父目录）。
 *
 * 与 `workflow/service.mjs` 的 `resolveDshHome()` 同一条顺序，但**不能 import 它**（本模块必须是
 * 叶子：`workflow/service.mjs` 会把会话/agent 面拖进扫描链）。顺序：
 * 显式参数 → `profileContext.home` → `dataDir` 的父目录（目录名是 `xuanshu` 时）→ `$DSH_HOME` →
 * **玄枢自己的兜底**（`XUANSHU_DSH_HOME` ＞ `~/.xuanshu`；票 22/#22 起不再是 `~/.dsh`，ADR-0014）。
 */
export function resolveShijiDshHome(ctx, dataDir, explicit) {
  if (typeof explicit === 'string' && explicit !== '') return explicit
  const profile = softGet(ctx, 'profileContext')
  if (typeof profile?.home === 'string' && profile.home !== '') return profile.home
  if (typeof dataDir === 'string' && dataDir !== '' && basename(dataDir) === 'xuanshu') return dirname(dataDir)
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '') return process.env.DSH_HOME
  return fallbackXuanshuHome({ env: process.env }).home
}

/** 人说的那一句（注入的上下文 / 采用稿 / 定时提醒都不算）。 */
function isUserEvent(event) {
  return event?.type === 'user/message' && event?.data?.source?.kind === 'user'
}

/**
 * 采集一批会话的「有没有人说过话 / 最后活跃 / 标题」。
 *
 * 成本口径：
 *   - 优先走 `ctx.sessionProjectionCache.cachedSnapshot(header, ['title','sessionListMetadata'])`
 *     （零 I/O；`lastPromptAt` 与 DSH 侧栏同口径）；
 *   - 拿不到 header（`listSessions` 缺席 / 没这一条）或**投影缓存服务整个缺席**时，才回落到
 *     `ctx.sessionQuery.readSession(id)` 读日志（权威但更贵）；
 *   - 投影缓存明确给出 `lastPromptAt = null` 时**不再读日志**：那是「确实没说过话」，
 *     与 DSH 侧栏显示一致（缓存可能落后，但落后到把有轮次读成没有的概率远低于每轮读全量日志的成本）；
 *     但缓存**缺 `sessionListMetadata` 键**（这一层没挂载该投影）不等于「没有轮次」→ 回落读日志。
 *
 * @returns {Promise<{bySession: Map<string, {title: string, lastActiveMs: number}>, available: boolean}>}
 */
async function collectSessionEvidence(ctx, sessionIds, notes) {
  const bySession = new Map()
  const ids = [...new Set((Array.isArray(sessionIds) ? sessionIds : []).map((id) => text(id)).filter((id) => id !== ''))]
  const query = softGet(ctx, 'sessionQuery')
  const cache = softGet(ctx, 'sessionProjectionCache')
  const cacheAvailable = typeof cache?.cachedSnapshot === 'function'
  const queryAvailable = typeof query?.listSessions === 'function' || typeof query?.readSession === 'function'
  const available = cacheAvailable || queryAvailable

  const headers = new Map()
  if (typeof query?.listSessions === 'function') {
    try {
      const records = await query.listSessions()
      for (const record of Array.isArray(records) ? records : []) {
        const id = typeof record?.header?.id === 'string' ? record.header.id : ''
        if (id !== '') headers.set(id, record.header)
      }
    } catch (error) {
      notes.push(`会话清单读不出来（${String(error?.message ?? error)}）：本次按已有依据记，活跃时间可能偏旧。`)
    }
  }

  for (const id of ids) {
    let title = ''
    let lastActiveMs = 0
    let answeredByCache = false
    const header = headers.get(id)
    if (header !== undefined && cacheAvailable) {
      try {
        const snapshot = cache.cachedSnapshot(header, ['title', 'sessionListMetadata'])
        // 只有**明确给出** `sessionListMetadata` 时才算「缓存答了」（值是 null 也算：确实没人说过话）。
        // 缺这个键 = 这一层没挂载该投影（本机不同会话的缓存 key 集合确实不同，探路笔记 §5.2）——
        // 那不是「没有轮次」，要回落读日志，否则会把问过的会话数成 0 场。
        const metadata = snapshot?.values?.sessionListMetadata
        answeredByCache = metadata !== undefined && metadata !== null
        if (typeof snapshot?.values?.title === 'string') title = snapshot.values.title
        const lastPromptAt = metadata?.lastPromptAt
        if (Number.isFinite(lastPromptAt) && lastPromptAt > 0) lastActiveMs = lastPromptAt
      } catch (error) {
        notes.push(`会话投影缓存读不出来（${id}）：${String(error?.message ?? error)}`)
      }
    }
    if (!answeredByCache && typeof query?.readSession === 'function') {
      try {
        const snapshot = await query.readSession(id)
        const events = Array.isArray(snapshot?.events) ? snapshot.events : []
        const userEvents = events.filter(isUserEvent)
        if (userEvents.length > 0) {
          lastActiveMs = Math.max(...userEvents.map((event) => (Number.isFinite(event?.time) ? event.time : 0)))
        }
      } catch (error) {
        // 「会话还不存在」= 确实还没有内容（不是错误）；别的错误 = 读不动（记一笔，不编）。
        if (error?.code !== 'SESSION_QUERY_SESSION_NOT_FOUND') {
          notes.push(`会话日志读不出来（${id}）：${String(error?.message ?? error)}`)
        }
      }
    }
    if (lastActiveMs <= 0) continue
    if (title === '' && typeof query?.readTitle === 'function') {
      try {
        const snapshot = await query.readTitle(id)
        if (typeof snapshot?.title === 'string') title = snapshot.title
      } catch {
        /* 标题不是判据：拿不到就少一句摘要素材 */
      }
    }
    bySession.set(id, { title, lastActiveMs })
  }
  return { bySession, available }
}

/** 参与指纹 / 摘要的文档证据（只留元组，不留正文）。 */
function docEvidence(doc) {
  return { relPath: doc.relPath, size: doc.size, mtimeMs: doc.mtimeMs }
}

/** 最大时间（ISO 字符串输入，解析不了就跳过）。 */
function latestIso(...values) {
  let best = null
  for (const value of values) {
    const ms = typeof value === 'number' ? value : Date.parse(String(value ?? ''))
    if (!Number.isFinite(ms)) continue
    if (best === null || ms > best) best = ms
  }
  return best === null ? null : new Date(best).toISOString()
}

/**
 * 工作区这一路。
 * @returns {Promise<{items: object[], available: boolean}>}
 *          `available:false` = 这条路**核不了**（服务缺席/清单读不出来），账本据此**不冻结**已有条目。
 */
async function collectWorkspaceItems({ ctx, dataDir, excludedDirs, now, notes }) {
  const registry = softGet(ctx, 'workspaceRegistry')
  if (typeof registry?.list !== 'function') {
    notes.push('ctx.workspaceRegistry 服务不可得：工作区这一路按「无来源」处理（不伪造；也不会因此冻结已有事记）。')
    return { items: [], available: false }
  }
  let workspaces
  try {
    workspaces = registry.list()
  } catch (error) {
    notes.push(`工作区清单读不出来（${String(error?.message ?? error)}）：这一路本轮为空（核不了 ≠ 没有，不会冻结已有事记）。`)
    return { items: [], available: false }
  }
  if (!Array.isArray(workspaces)) return { items: [], available: false }

  const allSessionIds = workspaces.flatMap((workspace) => (Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : []))
  const { bySession, available } = await collectSessionEvidence(ctx, allSessionIds, notes)

  const items = []
  for (const workspace of workspaces) {
    if (!workspace || typeof workspace !== 'object') continue
    const refId = text(workspace.id)
    const title = text(workspace.title) || text(workspace.path).split(/[\\/]/u).filter((part) => part !== '').pop() || '工作区'
    if (refId === '') {
      notes.push(`工作区「${title}」没有 id：本轮跳过（事记的 id 必须能按 refId 稳定）。`)
      continue
    }
    if (typeof workspace.status === 'function') {
      try {
        const status = await workspace.status()
        if (status === 'missing-dir') {
          notes.push(`工作区「${title}」的目录已不在（status=missing-dir）：本轮不算它（源头消失 → 账本写冻结）。`)
          continue
        }
      } catch (error) {
        // 「核不了」不等于「没有」：状态服务坏了不冻结任何东西。
        notes.push(`工作区「${title}」的目录状态核不了（${String(error?.message ?? error)}）：本轮仍按在场处理。`)
      }
    }

    const docs = collectProjectDocs({ root: text(workspace.path), excludedDirs })
    notes.push(...docs.notes)

    const sessionIds = (Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []).map((id) => text(id)).filter((id) => id !== '')
    const counted = sessionIds.filter((id) => bySession.has(id))
    const titles = counted.map((id) => bySession.get(id)?.title ?? '').filter((value) => value !== '')
    const sessionTimes = counted.map((id) => bySession.get(id)?.lastActiveMs ?? 0)

    let lastActiveAt
    if (!available) {
      lastActiveAt = now.toISOString()
      notes.push(`工作区「${title}」：会话服务不可得，lastActiveAt 按本次扫描时刻记（不编历史活跃时间）。`)
    } else {
      lastActiveAt = latestIso(...sessionTimes, workspace.createdAt) ?? now.toISOString()
    }

    items.push({
      source: 'workspace',
      refId,
      name: title,
      lastActiveAt,
      basis: { sessions: counted.length, docs: docs.docs.length },
      sessions: [...counted].sort(),
      docs: docs.docs.map(docEvidence),
      material: { sessionTitles: titles, docs: docs.docs.map((doc) => ({ relPath: doc.relPath, text: doc.text })) },
    })
  }
  return { items, available: true }
}

/**
 * 工作流这一路：清单里 `exportedAt` 非空 + `SKILL.md` 真存在才收。
 * @returns {Promise<{items: object[], available: boolean}>}
 */
async function collectWorkflowItems({ ctx, dataDir, dshHome, now, notes }) {
  let records
  try {
    records = listWorkflows(dataDir)
  } catch (error) {
    notes.push(`工作流清单读不出来（${String(error?.message ?? error)}）：这一路本轮为空（核不了 ≠ 没有）。`)
    return { items: [], available: false }
  }
  const exported = []
  for (const record of records) {
    const skillName = text(record?.skillName)
    const exportedAt = text(record?.exportedAt)
    if (exportedAt === '' || skillName === '') continue
    const file = skillFile(dshHome, skillName)
    if (!existsSync(file)) continue
    exported.push({ record, file })
  }

  const sessionIds = exported.map((entry) => text(entry.record.sessionId)).filter((id) => id !== '')
  const { bySession } = await collectSessionEvidence(ctx, sessionIds, notes)

  const items = []
  for (const { record, file } of exported) {
    const refId = text(record.id) || text(record.sessionId)
    const name = text(record.name) || text(record.seed).split(/\r?\n/u).find((line) => line.trim() !== '')?.trim() || refId
    let info
    let body
    try {
      info = statSync(file)
      body = readFileSync(file, 'utf8')
    } catch (error) {
      notes.push(`工作流「${name}」的 SKILL.md 读不出来（${file}）：本轮跳过它（拿不到依据就不建条目）。`)
      continue
    }
    if (refId === '') {
      notes.push(`工作流「${name}」没有 id / sessionId：本轮跳过。`)
      continue
    }
    const sessionId = text(record.sessionId)
    const active = sessionId === '' ? undefined : bySession.get(sessionId)
    items.push({
      source: 'workflow',
      refId,
      name,
      lastActiveAt: latestIso(record.createdAt, record.exportedAt, active?.lastActiveMs) ?? now.toISOString(),
      basis: { sessions: active === undefined ? 0 : 1, docs: 1 },
      sessions: active === undefined ? [] : [sessionId],
      docs: [{ relPath: 'SKILL.md', size: info.size, mtimeMs: info.mtimeMs }],
      material: {
        sessionTitles: active?.title ? [active.title] : [],
        docs: [{ relPath: 'SKILL.md', text: body.length > 4000 ? body.slice(0, 4000) : body }],
      },
    })
  }
  return { items, available: true }
}

/**
 * 采集本轮扫描的全部依据（**不写盘、不调 LLM**）。
 *
 * @param {{ctx?: object, dataDir: string, dshHome?: string, excludedDirs?: string[], now?: Date}} input
 * @returns {Promise<{items: object[], notes: string[], routes: {workspace: boolean, workflow: boolean}}>}
 *          `routes.* === false` = 这一路**核不了**（服务缺席/清单读不出来）：账本据此不冻结已有条目。
 */
export async function collectShijiEvidence({ ctx, dataDir, dshHome, excludedDirs = [], now = new Date() } = {}) {
  const notes = []
  const resolvedHome = resolveShijiDshHome(ctx, dataDir, dshHome)
  const workspace = await collectWorkspaceItems({ ctx, dataDir, excludedDirs, now, notes })
  const workflow = await collectWorkflowItems({ ctx, dataDir, dshHome: resolvedHome, now, notes })
  return {
    items: [...workspace.items, ...workflow.items],
    notes,
    routes: { workspace: workspace.available, workflow: workflow.available },
  }
}
