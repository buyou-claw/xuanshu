/**
 * packages/xuanshu-host/lib/shiji/store.mjs —— 事记的**文件契约**（票 05 / #26 契约 §1）。
 *
 * 文件契约：
 *   `<dataDir>/shiji.jsonl`          事记账本，schema `xuanshu/shiji@1`，**一条一行**（快照式）
 *   `<dataDir>/shiji-settings.json`  事记设置，schema `xuanshu/shiji-settings@1`，`{excludedDirs}`
 *
 * 为什么是「快照式整文件重写」而不是事件流：契约 §1 把 `frozenAt` / `excludedAt` 放在**条目上**，
 * 每条 = 一个项目/工作流**当前**的样子；事件流要读侧折叠，而这里读侧只有 `shiji.list` 与底稿。
 * 原子写（同目录临时文件 + rename）保证崩在半路不会留下半份账本。
 *
 * 本模块是**叶子**：只 import node 内置。`lib/shiji/*` 里只有它知道文件长什么样 ——
 * 扫描、摘要、账本都通过这里的函数读写（与 `digao/store.mjs` 同一种分工）。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 账本 schema（契约 §1 冻结；换结构时它就是迁移锚点）。 */
export const SHIJI_SCHEMA = 'xuanshu/shiji@1'
/** 设置的 schema（契约 §1 的 `<dataDir>/shiji-settings.json`）。 */
export const SHIJI_SETTINGS_SCHEMA = 'xuanshu/shiji-settings@1'
/** 文件名（契约 §1 定值）。 */
export const SHIJI_JSONL = 'shiji.jsonl'
export const SHIJI_SETTINGS = 'shiji-settings.json'
/** 三种来源（`session` 只用于人工「存成今天的事记」，自动扫描永不产生）。 */
export const SHIJI_SOURCES = ['workspace', 'workflow', 'session']
/** 摘要模式。 */
export const SHIJI_SUMMARY_MODES = ['llm', 'skeleton']

/** `<dataDir>/shiji.jsonl`。 */
export function shijiFile(dataDir) {
  return join(dataDir, SHIJI_JSONL)
}

/** `<dataDir>/shiji-settings.json`。 */
export function shijiSettingsFile(dataDir) {
  return join(dataDir, SHIJI_SETTINGS)
}

/** 账本在不在（`shiji.status` / 测试用；只判文件）。 */
export function shijiExists(dataDir) {
  return existsSync(shijiFile(dataDir))
}

/**
 * 确定性条目 id：`'shiji-' + sha256(source + '\\0' + refId).slice(0,16)`（契约 §1）。
 *
 * 为什么把 source 也拌进去：工作区 id 与工作流 id 可能长得一样（都是 uuid / session 前缀），
 * 但它们是两路来源、两条事记 —— 只按 refId 散列会让它们撞成一条。
 */
export function shijiId(source, refId) {
  return `shiji-${createHash('sha256').update(`${source}\u0000${refId}`).digest('hex').slice(0, 16)}`
}

/** 非空字符串。 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 时间戳（ISO 字符串）或 null。 */
function timestampOrNull(value) {
  return typeof value === 'string' && value !== '' ? value : null
}

/** 依据计数：非负整数，缺省 0。 */
function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0
}

/**
 * 一条账本行 → 条目对象；形状不对 → null（读侧宁可跳过，也不把旧结构当新结构用）。
 * 只校验**契约里点名的必需字段**；加性字段原样保留（`...parsed` 在前，必需字段规范化在后）。
 */
export function normalizeShijiEntry(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  if (parsed.schema !== SHIJI_SCHEMA) return null
  const id = text(parsed.id)
  const source = text(parsed.source)
  const refId = text(parsed.refId)
  const summaryMode = text(parsed.summaryMode)
  if (id === '' || refId === '' || !SHIJI_SOURCES.includes(source)) return null
  if (!SHIJI_SUMMARY_MODES.includes(summaryMode)) return null
  if (typeof parsed.firstSeenAt !== 'string' || typeof parsed.lastActiveAt !== 'string') return null
  if (typeof parsed.summary !== 'string' || typeof parsed.fingerprint !== 'string') return null
  return {
    ...parsed,
    schema: SHIJI_SCHEMA,
    id,
    source,
    refId,
    name: text(parsed.name) || refId,
    summary: parsed.summary,
    summaryMode,
    firstSeenAt: parsed.firstSeenAt,
    lastActiveAt: parsed.lastActiveAt,
    basis: {
      sessions: count(parsed.basis?.sessions),
      docs: count(parsed.basis?.docs),
    },
    fingerprint: parsed.fingerprint,
    manual: parsed.manual === true,
    frozenAt: timestampOrNull(parsed.frozenAt),
    excludedAt: timestampOrNull(parsed.excludedAt),
  }
}

/**
 * 读账本。
 * @returns {{entries: object[], notes: string[]}} 坏行 / 旧 schema 行跳过，note 里带**行号**
 * @throws 文件存在却读不出来时抛可读错误。只有 ENOENT 是空账；否则后续整账重写会丢墓碑与历史。
 */
export function readShijiEntries(dataDir) {
  let raw
  try {
    raw = readFileSync(shijiFile(dataDir), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { entries: [], notes: [] }
    throw new Error(`事记账本读不出来（${shijiFile(dataDir)}；${String(error?.code ?? 'unknown')}）：`
      + `${String(error?.message ?? error)}。本次不改写账本。`, { cause: error })
  }
  const entries = []
  const notes = []
  const lines = raw.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '') continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      notes.push(`${SHIJI_JSONL} 第 ${index + 1} 行不是合法 JSON，已跳过。`)
      continue
    }
    const entry = normalizeShijiEntry(parsed)
    if (entry === null) {
      const got = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? text(parsed.schema) : ''
      notes.push(got !== '' && got !== SHIJI_SCHEMA
        ? `${SHIJI_JSONL} 第 ${index + 1} 行的 schema 不是 ${SHIJI_SCHEMA}（拿到 ${JSON.stringify(got)}），已跳过。`
        : `${SHIJI_JSONL} 第 ${index + 1} 行字段不完整，已跳过。`)
      continue
    }
    entries.push(entry)
  }
  return { entries, notes }
}

/** 原子写一个文件（同目录临时文件 + rename；失败清临时件）。 */
function writeAtomic(file, contents) {
  mkdirSync(join(file, '..'), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  writeFileSync(tmp, contents, { encoding: 'utf8', flag: 'wx' })
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

/**
 * 整文件原子重写账本（**快照式**：调用方给的就是完整账本）。
 * 文件内按 `firstSeenAt` 稳定排序（同刻按 id），一条一行。
 */
export function writeShijiEntries(dataDir, entries) {
  const rows = (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeShijiEntry(entry))
    .filter((entry) => entry !== null)
    .sort((left, right) => {
      if (left.firstSeenAt !== right.firstSeenAt) return left.firstSeenAt < right.firstSeenAt ? -1 : 1
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    })
  return writeAtomic(shijiFile(dataDir), `${rows.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
}

/** 相对路径前缀归一：统一 `/`、去掉 `./` 与末尾 `/`；不合法就抛（设置是用户输入，要有可读理由）。 */
export function normalizeExcludedDir(value) {
  if (typeof value !== 'string') throw new Error('排除目录必须是字符串。')
  const cleaned = value.trim().replace(/\\/gu, '/').replace(/^\.\/+/u, '').replace(/\/+$/u, '')
  if (cleaned === '') throw new Error('排除目录不能为空。')
  if (cleaned.startsWith('/') || /^[A-Za-z]:/u.test(cleaned)) {
    throw new Error(`排除目录必须是**相对**项目根的路径（不要把绝对路径写进来）：${JSON.stringify(value)}。`)
  }
  const segments = cleaned.split('/')
  if (segments.some((segment) => segment === '..' || segment === '.' || segment === '')) {
    throw new Error(`排除目录里不能有 . / .. 或空段：${JSON.stringify(value)}。`)
  }
  return segments.join('/')
}

/** 归一整个 `excludedDirs` 列表（去重、保序）。 */
export function normalizeExcludedDirs(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('excludedDirs 必须是字符串数组。')
  const out = []
  for (const item of value) {
    const dir = normalizeExcludedDir(item)
    if (!out.includes(dir)) out.push(dir)
  }
  return out
}

/**
 * 读设置：文件不存在 / 坏 / 旧 schema / 字段不合法 → 缺省 `{excludedDirs: []}`
 * （一份坏设置不该让自动扫描整个停摆；但写入侧 `shiji.settings.set` 会如实拒绝非法输入）。
 */
export function readShijiSettings(dataDir) {
  const fallback = { schema: SHIJI_SETTINGS_SCHEMA, excludedDirs: [] }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(shijiSettingsFile(dataDir), 'utf8'))
  } catch {
    return fallback
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schema !== SHIJI_SETTINGS_SCHEMA) return fallback
  try {
    return { schema: SHIJI_SETTINGS_SCHEMA, excludedDirs: normalizeExcludedDirs(parsed.excludedDirs) }
  } catch {
    return fallback
  }
}

/** 写设置（原子替换；写入前归一，非法输入照抛给 RPC 层折成可读错误）。 */
export function writeShijiSettings(dataDir, settings = {}) {
  const value = {
    schema: SHIJI_SETTINGS_SCHEMA,
    excludedDirs: normalizeExcludedDirs(settings.excludedDirs),
  }
  writeAtomic(shijiSettingsFile(dataDir), `${JSON.stringify(value, null, 2)}\n`)
  return value
}
