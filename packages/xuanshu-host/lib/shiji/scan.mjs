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
 *     （`digao/generate.mjs` 会 import 事记的账本，反向依赖必须保持单向；`consult/history.mjs` 是只含
 *     纯函数的叶子，不会把会话 / agent 面拖进扫描链）。
 */

import { existsSync, readFileSync, statSync } from 'node:fs'

import { projectConsultMessages } from '../consult/history.mjs'
import { isUserPromptEvent, readSessionProjection, sessionHeadersOf } from '../consult/session-activity.mjs'
import { resolveSearchHome } from '../home.mjs'
import { skillFile } from '../workflow/skill-export.mjs'
import { listWorkflows } from '../workflow/store.mjs'
import { collectProjectDocs } from './docs.mjs'

/**
 * 会话内容的取材上限（#38：素材要有「会话内容」，但**有界**——摘要 prompt 不许被一场会话炸掉）。
 * 判据全在这里，测试直接钉这几个数。
 */
export const MAX_CONTENT_SESSIONS = 3
export const MAX_SESSION_QUESTIONS = 3
export const MAX_QUESTION_CHARS = 200

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
 * **薄包装**：顺序、兜底与「真实 ~/.dsh 一律拒绝」的门都在 `home.mjs::resolveSearchHome()` 里
 * （复核 S1：本模块从前是第 5 份 home 解析，且绕过了那道门）。本模块仍保持**叶子**——
 * `home.mjs` 只 import node 内置，不会把会话 / agent 面拖进扫描链。
 *
 * @param {object} ctx cordis 宿主上下文
 * @param {string} [dataDir]
 * @param {string} [explicit]
 * @param {{env?: Record<string, string|undefined>, homedirPath?: string}} [options] 纯函数接缝
 */
export function resolveShijiDshHome(ctx, dataDir, explicit, options = {}) {
  return resolveSearchHome({ ctx, dataDir, explicit, ...options }).home
}

/** 有界化一句人问的话（折叠空白 + 截断；摘要 prompt 的素材不许无限长）。 */
function boundedQuestion(text) {
  const collapsed = text.replace(/\s+/gu, ' ').trim()
  return collapsed.length > MAX_QUESTION_CHARS ? `${collapsed.slice(0, MAX_QUESTION_CHARS)}…` : collapsed
}

/**
 * 会话日志 →「人问过的句子」（首问在前，有界）。
 *
 * 投影复用 `consult/history.mjs` 的唯一实现（不另写一份解析）；只留 `role:'user'` 且来源是人的消息 ——
 * 玄枢注入的上下文（`xuanshu-consult`）与采用稿（`xuanshu-bestof-adopted`）不是「人在会话里说的话」。
 * 助手回话**不进素材**：摘要是「这场会话在问什么」，而回话常带代码 / 执行复盘（不读代码正文的口径）。
 *
 * @param {{events?: object[]}} snapshot `ctx.sessionQuery.readSession()` 的返回
 * @returns {string[]} 至多 `MAX_SESSION_QUESTIONS` 句，每句至多 `MAX_QUESTION_CHARS` 字
 */
function questionsOf(snapshot) {
  return projectConsultMessages(snapshot)
    .filter((message) => message.role === 'user' && (message.source === undefined || message.source === 'user'))
    .map((message) => boundedQuestion(message.text))
    .filter((text) => text !== '')
    .slice(0, MAX_SESSION_QUESTIONS)
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
 * 「投影缓存 → 日志回落」的**零件**与 `wansheng/facts.mjs` 共用（`consult/session-activity.mjs`），
 * 但**策略**两边有意不同：这里单场读失败只记 note 继续（一条事记不该让整轮扫描失败），
 * 晚省那边是抛给调用方省略整个事实键。差异表见 `tests/wansheng/session-activity-parity.test.mjs`。
 *
 * @returns {Promise<{bySession: Map<string, {title: string, lastActiveMs: number, questions: string[]|null}>,
 *          available: boolean}>} `questions:null` = 这一场还没读过日志（投影缓存答了活跃时间）；
 *          `questions:[]` = 读过日志、确实没有可摘的人问文本。
 */
async function collectSessionEvidence(ctx, sessionIds, notes) {
  const bySession = new Map()
  const ids = [...new Set((Array.isArray(sessionIds) ? sessionIds : []).map((id) => text(id)).filter((id) => id !== ''))]
  const query = softGet(ctx, 'sessionQuery')
  const cache = softGet(ctx, 'sessionProjectionCache')
  const cacheAvailable = typeof cache?.cachedSnapshot === 'function'
  const queryAvailable = typeof query?.listSessions === 'function' || typeof query?.readSession === 'function'
  const available = cacheAvailable || queryAvailable

  let headers = new Map()
  if (typeof query?.listSessions === 'function') {
    try {
      headers = sessionHeadersOf(await query.listSessions())
    } catch (error) {
      notes.push(`会话清单读不出来（${String(error?.message ?? error)}）：本次按已有依据记，活跃时间可能偏旧。`)
    }
  }

  for (const id of ids) {
    let title = ''
    let lastActiveMs = 0
    let answeredByCache = false
    let questions = null
    const header = headers.get(id)
    if (header !== undefined && cacheAvailable) {
      const projection = readSessionProjection(cache, header, ['title', 'sessionListMetadata'])
      if (projection.error !== undefined) {
        notes.push(`会话投影缓存读不出来（${id}）：${String(projection.error?.message ?? projection.error)}`)
      } else {
        const values = projection.values
        // 只有**明确给出** `sessionListMetadata` 时才算「缓存答了」（值是 null 也算：确实没人说过话）。
        // 缺这个键 = 这一层没挂载该投影（本机不同会话的缓存 key 集合确实不同，探路笔记 §5.2）——
        // 那不是「没有轮次」，要回落读日志，否则会把问过的会话数成 0 场。
        const metadata = values?.sessionListMetadata
        answeredByCache = metadata !== undefined && metadata !== null
        if (typeof values?.title === 'string') title = values.title
        const lastPromptAt = metadata?.lastPromptAt
        if (Number.isFinite(lastPromptAt) && lastPromptAt > 0) lastActiveMs = lastPromptAt
      }
    }
    if (!answeredByCache && typeof query?.readSession === 'function') {
      try {
        const snapshot = await query.readSession(id)
        const events = Array.isArray(snapshot?.events) ? snapshot.events : []
        const userEvents = events.filter(isUserPromptEvent)
        if (userEvents.length > 0) {
          lastActiveMs = Math.max(...userEvents.map((event) => (Number.isFinite(event?.time) ? event.time : 0)))
        }
        // 日志本来就读了：顺手把人问过的句子留下来（不让 #38 再读第二遍）。
        questions = questionsOf(snapshot)
      } catch (error) {
        // 「会话还不存在」= 确实还没有内容（不是错误）；别的错误 = 读不动（记一笔，不编）。
        if (error?.code === 'SESSION_QUERY_SESSION_NOT_FOUND') questions = []
        else notes.push(`会话日志读不出来（${id}）：${String(error?.message ?? error)}`)
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
    bySession.set(id, { title, lastActiveMs, questions })
  }
  return { bySession, available }
}

/**
 * 一条依据的「会话内容」素材（#38）：从会话日志取人问过的句子，**按条数与字数有界**。
 *
 * 三件事要和别处对齐：
 *   - 只取**计入依据**的会话（`counted`：日志里真有人说过话），按最后活跃倒序取前
 *     `MAX_CONTENT_SESSIONS` 场 —— 素材有界，摘要 prompt 不会被几十场会话炸掉；
 *   - 日志已经读过（`collectSessionEvidence` 的回落路径）就直接用，不再读第二遍；
 *   - 拿不到就**如实降级**：没有会话内容时摘要只按标题 + 文档生成，并在 `notes` 里说明原因
 *     （「核不了 ≠ 没有」，绝不编会话里的事）。
 *
 * @param {object} ctx cordis 宿主上下文
 * @param {string[]} counted 计入依据的会话 id
 * @param {Map<string, {title: string, lastActiveMs: number, questions: string[]|null}>} bySession
 * @param {string[]} notes 降级说明写这里
 * @param {string} label 条目名（写进 notes，用户要知道是哪条降级了）
 * @returns {Promise<Array<{sessionId: string, title: string, questions: string[]}>>}
 */
async function collectSessionTexts(ctx, counted, bySession, notes, label) {
  if (counted.length === 0) return []
  const query = softGet(ctx, 'sessionQuery')
  const canRead = typeof query?.readSession === 'function'
  const ordered = [...counted].sort((left, right) => (bySession.get(right)?.lastActiveMs ?? 0) - (bySession.get(left)?.lastActiveMs ?? 0))
  const texts = []
  let failed = 0
  for (const id of ordered.slice(0, MAX_CONTENT_SESSIONS)) {
    const entry = bySession.get(id)
    if (entry === undefined) continue
    if (entry.questions === null) {
      if (!canRead) {
        failed += 1
        continue
      }
      try {
        entry.questions = questionsOf(await query.readSession(id))
      } catch (error) {
        // 「会话还不存在」= 确实没有内容（不是错误）；别的 = 读不动（降级，不编）。
        if (error?.code === 'SESSION_QUERY_SESSION_NOT_FOUND') entry.questions = []
        else failed += 1
      }
    }
    const questions = Array.isArray(entry.questions) ? entry.questions : []
    if (questions.length === 0) continue
    texts.push({ sessionId: id, title: entry.title, questions })
  }
  if (failed > 0) {
    notes.push(texts.length === 0
      ? `事记「${label}」：会话正文读不出来（${failed} 场），摘要按会话标题 + 说明文档生成（不编会话里的事）。`
      : `事记「${label}」：有 ${failed} 场会话的正文读不出来，摘要只带上读得到的会话内容（不编）。`)
  } else if (texts.length === 0) {
    notes.push(`事记「${label}」：会话里没有可摘的人问文本，摘要按会话标题 + 说明文档生成（不编内容）。`)
  }
  return texts
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
    // 会话内容（#38）：标题之外的「会话里到底问过什么」。拿不到就降级并在 notes 说明。
    const sessionTexts = await collectSessionTexts(ctx, counted, bySession, notes, title)

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
      material: { sessionTitles: titles, sessionTexts, docs: docs.docs.map((doc) => ({ relPath: doc.relPath, text: doc.text })) },
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
    // 工作流这一路同样要有会话内容（#38 AC1）：它的依据会话就是导出这条 skill 的那一场。
    const sessionTexts = await collectSessionTexts(ctx, active === undefined ? [] : [sessionId], bySession, notes, name)
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
        sessionTexts,
        docs: [{ relPath: 'SKILL.md', text: body.length > 4000 ? body.slice(0, 4000) : body }],
      },
    })
  }
  return { items, available: true }
}

/**
 * 采集本轮扫描的全部依据（**不写盘、不调 LLM**）。
 *
 * @param {{ctx?: object, dataDir: string, dshHome?: string, excludedDirs?: string[], now?: Date,
 *          env?: Record<string, string|undefined>, homedirPath?: string}} input
 *        `env` / `homedirPath` 是 home 解析的纯函数接缝（生产由 `shiji/service.mjs` 显式传 `process.env`）。
 * @returns {Promise<{items: object[], notes: string[], routes: {workspace: boolean, workflow: boolean}}>}
 *          `routes.* === false` = 这一路**核不了**（服务缺席/清单读不出来）：账本据此不冻结已有条目。
 */
export async function collectShijiEvidence({
  ctx, dataDir, dshHome, excludedDirs = [], now = new Date(), env, homedirPath,
} = {}) {
  const notes = []
  // 解析根与「真实 home 已改判」的原因是同一件事的两半：原因必须进 notes（用户看得到路径为什么不是他给的那个）。
  const home = resolveSearchHome({ ctx, dataDir, explicit: dshHome, env: env ?? process.env, homedirPath })
  if (home.note !== undefined) notes.push(home.note)
  const workspace = await collectWorkspaceItems({ ctx, dataDir, excludedDirs, now, notes })
  const workflow = await collectWorkflowItems({ ctx, dataDir, dshHome: home.home, now, notes })
  return {
    items: [...workspace.items, ...workflow.items],
    notes,
    routes: { workspace: workspace.available, workflow: workflow.available },
  }
}
