/**
 * packages/xuanshu-host/lib/consult/store.mjs — 问事会话的**旁挂清单**（ADR-0009 第 4 条，契约 §1）。
 *
 * 为什么不是 `meta.xuanshu`：rc.2 的会话 `meta` 是**闭集 7 字段**、实现逐字段挑，
 * 额外键不报错、不落盘、读不回（`dsh-session/lib/index.js:1697-1710`，Lead 独立复核）。
 * 为什么不是自定义会话事件：`Session.append()` 写不了 `ignorable`，读侧拒绝未知非 ignorable 事件
 * → 会话从此打不开（ADR-0009 第 6 条）。所以「这次勾了哪些谱、挂了什么」落在
 * `<dataDir>/consult/sessions/<sessionId>.json` 这一份**旁挂文件**里，schema `xuanshu/consult@1`。
 *
 * 权威分工（ADR-0009 Consequences）：
 *   - **旁挂清单** = 「问过哪些事、这次用了哪些谱」的权威（`consult.list` 只读它，不扫会话日志）；
 *   - **会话日志** = 正文的权威（`ctx.sessionQuery.readSession()`）。
 *
 * 路径形状与 `cwd` **同源**：`<dataDir>/consult` 既是全部问事会话共用的 `cwd`
 * （ADR-0009 第 2 条：一个 `filterSessions([{kind:'cwd',…}])` 就能列出全部），
 * 也是这份旁挂目录 —— 会话记录（`$DSH_HOME/sessions/**`）与旁挂清单不会各写一处。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { puSlug } from '../pu/repository.mjs'

/** 旁挂清单 schema（契约 §1 冻结；换结构时它就是迁移锚点）。 */
export const CONSULT_SCHEMA = 'xuanshu/consult@1'
/** 会话 id 前缀（ADR-0009 第 1 条：玄枢自铸 id，`SessionId` 不做格式校验）。 */
export const CONSULT_SESSION_PREFIX = 'session-xs-consult-'
/** 旁挂清单里的固定种类标记（与 id 前缀互为冗余，方便人肉看文件）。 */
export const CONSULT_KIND = 'consult'
/** 数据目录下的问事子目录：既是共用 cwd，也是旁挂清单的家。 */
export const CONSULT_DIR = 'consult'
/** 首问之前的缺省标题（契约 §1）。 */
export const DEFAULT_CONSULT_TITLE = '未命名问事'
/** 首问生成标题时的截断长度（契约 §1：首问前 40 字）。 */
export const CONSULT_TITLE_MAX_CHARS = 40
/** 可勾选谱的数量上限：谱 slug 本身限 80 字符（票 09），这里只防一条畸形的超长清单。 */
export const CONSULT_MAX_PUS = 200

/** 挂载对象的两个种类（票 10 冻结的 `MountRef.kind`；`项目` 与 workspace 同义，不另开第三种）。 */
export const MOUNT_KINDS = ['workspace', 'workflow']
/** 一次挂载的数量上限：挂载是「临时」把**一个具体对象**引进来，不是批量导入。 */
export const CONSULT_MAX_MOUNTS = 20

/** 全部问事会话共用的 `cwd`（也是旁挂根）。 */
export function consultRoot(dataDir) {
  return resolve(dataDir, CONSULT_DIR)
}

/** 旁挂清单目录。 */
export function consultSessionsDir(dataDir) {
  return join(consultRoot(dataDir), 'sessions')
}

/** 铸一个新问事会话 id（字符只用 `[A-Za-z0-9._-]`，见 ADR-0009 第 1 条）。 */
export function newConsultSessionId() {
  return `${CONSULT_SESSION_PREFIX}${randomUUID()}`
}

/**
 * 是不是玄枢的问事会话 id。
 *
 * 这条判据是**分类**的一部分：`consult.send/read/rename` 只接受这种 id，
 * 免得一条 `consult.send` 打到工作区会话上去（那种会话不属于问事，也不该被问事面驱动）。
 */
export function isConsultSessionId(value) {
  return typeof value === 'string' && /^session-xs-consult-[A-Za-z0-9._-]+$/u.test(value)
}

/**
 * 归一用户勾选的谱 slug 列表（契约 §1：`pus` **只记用户勾选的可选谱**）。
 *
 * 三条口径：
 *   - 底座与底稿是**恒定在场项**，不进 `pus`（它们是每场问事的前提，不是这次的选择）；
 *   - slug 必须已经是规范形式（票 09 `puSlug()` 的产物）—— 否则注入时必然读不出来，
 *     与其在注入文本里写一段「读不出来」，不如在开会话这一步就说清楚；
 *   - 去重且保序（用户勾选顺序就是界面顺序）。
 */
export function normalizePus(input) {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) throw new Error('勾选谱（pus）必须是字符串数组。')
  if (input.length > CONSULT_MAX_PUS) throw new Error(`一次勾选最多 ${CONSULT_MAX_PUS} 个谱（收到 ${input.length} 个）。`)
  const out = []
  for (const value of input) {
    if (typeof value !== 'string') throw new Error('勾选谱（pus）里混进了非字符串项。')
    const slug = value.trim()
    if (slug === '') throw new Error('勾选谱（pus）里有空 slug。')
    if (slug === '_base') throw new Error('底座谱是恒定在场项，不进勾选谱（pus）。')
    let canonical
    try {
      canonical = puSlug(slug)
    } catch {
      throw new Error(`勾选谱 slug 不是规范形式：${JSON.stringify(value)}。`)
    }
    if (canonical !== slug) throw new Error(`勾选谱 slug 不是规范形式：${JSON.stringify(value)}（规范形是 ${JSON.stringify(canonical)}）。`)
    if (!out.includes(slug)) out.push(slug)
  }
  return out
}

/**
 * 归一挂载清单（票 12；`MountRef = {kind,id,label}` 是票 10 冻结的形状）。
 *
 * 三条口径：
 *   - **只收 `workspace` / `workflow`**：`项目` 与 workspace 同义（facts §5.4 的读法），
 *     不另开第三种 kind —— 多一种 kind 就多一处「注入时读不出来」；
 *   - **同 kind+id 去重且保序**：`workspace:x` 与 `workflow:x` 是两回事，但同一个工作区挂两次不是；
 *   - `label` 空串回落到 `id`：界面上宁可显示一个冷 id，也不显示空标签。
 *
 * 这里**不做存在性校验**（那要看 registry，属于 service 的事）：store 只管形状，
 * 于是「预览/写入」两条路径共用同一份校验（契约修订：少一处漂移）。
 *
 * @param {unknown} input 请求里的 `mounts`（可为 `undefined` = 空清单）。
 * @returns {Array<{kind: string, id: string, label: string}>} 归一后的清单。
 */
export function normalizeMounts(input) {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) throw new Error('挂载清单（mounts）必须是数组。')
  if (input.length > CONSULT_MAX_MOUNTS) {
    throw new Error(`一次最多挂载 ${CONSULT_MAX_MOUNTS} 个对象（收到 ${input.length} 个）：挂载是临时把一个具体对象引进来，不是批量导入。`)
  }
  const out = []
  const seen = new Set()
  for (const value of input) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('挂载项必须是 {kind,id,label} 对象。')
    const kind = typeof value.kind === 'string' ? value.kind.trim() : ''
    if (!MOUNT_KINDS.includes(kind)) {
      throw new Error(`挂载项 kind 只能是 ${MOUNT_KINDS.join(' / ')}（收到 ${JSON.stringify(value.kind)}）：工作区 / 工作流**不是谱**，谱走 pus。`)
    }
    const id = typeof value.id === 'string' ? value.id.trim() : ''
    if (id === '') throw new Error(`挂载项的 id 不能为空（kind=${kind}）。`)
    if (value.label !== undefined && typeof value.label !== 'string') throw new Error('挂载项的 label 必须是字符串。')
    const label = typeof value.label === 'string' && value.label.trim() !== '' ? value.label.trim() : id
    const key = `${kind}\u0000${id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind, id, label })
  }
  return out
}

/**
 * 归一**交付账**（旁挂清单的 `mountsInjected`）。
 *
 * 与 `normalizeMounts` 的差别只有两点，都是为了复核 48e0e0a 的 N3 / 32216d9 的 R5（账要与日志对账）：
 *   1. 多带对账凭据 —— 三层，按可信度从高到低：
 *      - `receipt`：**本次交付**那条会话消息的 id（边界盖的章）。它在日志里出现过 ⇒ 这一轮的
 *        正文真的落进了日志。同一层重新挂载后必须有新的 `receipt`，**旧一轮的正文标记不算数**（R5）；
 *      - `withdrawal`：**本次撤下声明**那条消息的 id。它在日志里出现过 ⇒ 撤下已说出口，
 *        条目才可以清掉；没出现 ⇒ 下一问重发（撤下失败不许丢重试依据，R5）；
 *      - `head`：注入文本里 `【来源：挂载 <head>】` 标记的主体 —— **老条目**（没有上面两个字段）
 *        唯一的凭据：标记在日志里就算交付过（向后兼容，不许因此每问重投）。
 *   2. **宽容**：交付账是我们自己写的缓存，坏条目丢掉就行（不像 `mounts` 那样抛错）——
 *      一份坏的缓存不该让整场问事哑掉。
 *
 * @param {unknown} input 旁挂清单里的 `mountsInjected`
 * @returns {Array<{kind: string, id: string, label: string, head?: string, receipt?: string, withdrawal?: string}>}
 */
export function normalizeDeliveredMounts(input) {
  if (!Array.isArray(input)) return []
  const out = []
  const seen = new Set()
  for (const entry of input) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const kind = typeof entry.kind === 'string' ? entry.kind.trim() : ''
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (kind === '' || id === '') continue
    const key = `${kind}\u0000${id}`
    if (seen.has(key)) continue
    seen.add(key)
    const label = typeof entry.label === 'string' && entry.label.trim() !== '' ? entry.label.trim() : id
    const head = typeof entry.head === 'string' && entry.head !== '' ? entry.head : undefined
    const receipt = typeof entry.receipt === 'string' && entry.receipt !== '' ? entry.receipt : undefined
    const withdrawal = typeof entry.withdrawal === 'string' && entry.withdrawal !== '' ? entry.withdrawal : undefined
    out.push({
      kind,
      id,
      label,
      ...(head === undefined ? {} : { head }),
      ...(receipt === undefined ? {} : { receipt }),
      ...(withdrawal === undefined ? {} : { withdrawal }),
    })
  }
  return out
}

/**
 * 首问 → 标题：折叠空白后取前 40 字（契约 §1）。空问题由调用方先拒掉，这里只兜底成缺省标题。
 */
export function titleFromQuestion(text) {
  const collapsed = String(text ?? '').replace(/\s+/gu, ' ').trim()
  if (collapsed === '') return DEFAULT_CONSULT_TITLE
  return collapsed.slice(0, CONSULT_TITLE_MAX_CHARS)
}

/** 归一一个会话标题（改名用）：折叠空白、拒空、限长。 */
export function normalizeTitle(value) {
  if (typeof value !== 'string') throw new Error('标题必须是文本。')
  const collapsed = value.replace(/\s+/gu, ' ').trim()
  if (collapsed === '') throw new Error('标题不能为空。')
  if (collapsed.length > 120) throw new Error('标题过长（最多 120 字）。')
  return collapsed
}

/** 旁挂清单 → `ConsultSummary`（契约 §2 的冻结形状；`lastTurnAt` 没有就省略）。 */
export function toConsultSummary(manifest) {
  const summary = {
    sessionId: manifest.sessionId,
    title: manifest.title,
    createdAt: manifest.createdAt,
    pus: [...manifest.pus],
    mounts: [...manifest.mounts],
    turns: manifest.turns,
  }
  if (typeof manifest.lastTurnAt === 'string' && manifest.lastTurnAt !== '') summary.lastTurnAt = manifest.lastTurnAt
  return summary
}

/** 旁挂文件路径；`sessionId` 已由 `isConsultSessionId()` 挡过，不存在目录穿越面。 */
export function consultManifestPath(dataDir, sessionId) {
  return join(consultSessionsDir(dataDir), `${sessionId}.json`)
}

/**
 * 旁挂清单仓库：一会话一文件（ADR-0009 第 4 条），原子替换写。
 *
 * 为什么不要一份 `sessions.json` 总索引：ADR-0009 已裁定「只在旁挂文件之上做只读聚合，
 * 不引入第二份权威」—— 双写一致性问题比列表性能贵得多。
 */
export function createConsultStore(dataDir) {
  const dir = consultSessionsDir(dataDir)
  const fileOf = (sessionId) => consultManifestPath(dataDir, sessionId)

  /** 读一个会话的旁挂清单；不存在 / 读不出来 / 不是我们的 schema → null（调用方决定怎么报）。 */
  function read(sessionId) {
    if (!isConsultSessionId(sessionId)) return null
    let raw
    try {
      raw = readFileSync(fileOf(sessionId), 'utf8')
    } catch {
      return null
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
    // schema 认不出就**不要**按今天的字段去解释它：宁可当作读不出来，也不能把旧结构当新结构用。
    if (!parsed || typeof parsed !== 'object' || parsed.schema !== CONSULT_SCHEMA) return null
    if (parsed.sessionId !== sessionId || parsed.kind !== CONSULT_KIND) return null
    return {
      schema: CONSULT_SCHEMA,
      sessionId,
      kind: CONSULT_KIND,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date(0).toISOString(),
      title: typeof parsed.title === 'string' && parsed.title !== '' ? parsed.title : DEFAULT_CONSULT_TITLE,
      pus: Array.isArray(parsed.pus) ? parsed.pus.filter((slug) => typeof slug === 'string') : [],
      mounts: Array.isArray(parsed.mounts) ? parsed.mounts : [],
      // 「内容已经交给模型的挂载」（**逐层** + 每层带 `head` 供与日志对账）：只在真的注入过之后才写。
      // 缺省**不补空数组** —— 老文件（与新建的会话）不该因为我们加了字段就变样。
      ...(Array.isArray(parsed.mountsInjected) ? { mountsInjected: normalizeDeliveredMounts(parsed.mountsInjected) } : {}),
      turns: Number.isInteger(parsed.turns) && parsed.turns >= 0 ? parsed.turns : 0,
      ...(typeof parsed.lastTurnAt === 'string' && parsed.lastTurnAt !== '' ? { lastTurnAt: parsed.lastTurnAt } : {}),
    }
  }

  /** 原子写（同目录临时文件 + rename）：半个 JSON 的清单比没有清单更坏。 */
  function write(manifest) {
    mkdirSync(dir, { recursive: true })
    const target = fileOf(manifest.sessionId)
    const tmp = join(dir, `.${manifest.sessionId}.json.${process.pid}.${randomUUID()}.tmp`)
    writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    try {
      renameSync(tmp, target)
    } catch (error) {
      try {
        rmSync(tmp, { force: true })
      } catch {
        /* 临时文件清不掉不掩盖原错误 */
      }
      throw error
    }
    return manifest
  }

  return {
    root: consultRoot(dataDir),
    dir,
    fileOf,

    /** 建一份旁挂清单（契约 §1 的冻结字段，顺序照契约）。 */
    create({ sessionId, pus = [], createdAt }) {
      if (!isConsultSessionId(sessionId)) throw new Error(`问事会话 id 形状不对：${JSON.stringify(sessionId)}。`)
      return write({
        schema: CONSULT_SCHEMA,
        sessionId,
        kind: CONSULT_KIND,
        createdAt: createdAt ?? new Date().toISOString(),
        title: DEFAULT_CONSULT_TITLE,
        pus: [...pus],
        mounts: [],
        turns: 0,
      })
    },

    read,

    /**
     * 列全部旁挂清单，`createdAt` 倒序（S7：列表按本地时间倒序）。
     * 坏文件（不是我们的 schema / JSON 破了）直接跳过：它进不了界面，也不该拖垮整张列表。
     */
    list() {
      if (!existsSync(dir)) return []
      const out = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const manifest = read(entry.name.slice(0, -'.json'.length))
        if (manifest !== null) out.push(manifest)
      }
      return out.sort((a, b) => (a.createdAt === b.createdAt ? (a.sessionId < b.sessionId ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))
    },

    /**
     * 只允许改这几样：`pus` 是开会话时的选择（本票没有改选择的 RPC），
     * `mounts` 归票 12（`consult.setMounts` —— 走同一份旁挂清单，不另开权威），
     * `mountsInjected` 归注入侧（`boundary.mjs`：**逐层**记「内容已经交给模型」的那一份，
     * 判据是「模型见过它的正文没有」，见 `inject.mjs` 的 `buildMountDelta`）。
     */
    update(sessionId, patch = {}) {
      const current = read(sessionId)
      if (current === null) return null
      const next = { ...current }
      if (Object.hasOwn(patch, 'title')) next.title = patch.title
      if (Object.hasOwn(patch, 'turns')) next.turns = patch.turns
      if (Object.hasOwn(patch, 'lastTurnAt')) next.lastTurnAt = patch.lastTurnAt
      if (Object.hasOwn(patch, 'mounts')) next.mounts = normalizeMounts(patch.mounts)
      if (Object.hasOwn(patch, 'mountsInjected')) next.mountsInjected = normalizeDeliveredMounts(patch.mountsInjected)
      return write(next)
    },
  }
}
