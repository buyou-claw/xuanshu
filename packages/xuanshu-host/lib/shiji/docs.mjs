/**
 * packages/xuanshu-host/lib/shiji/docs.mjs —— 项目**说明文档**的只读扫描（票 05 / #26 契约 §1）。
 *
 * 这是事记唯一读项目内容的地方，它的隐私与成本判据全部是**可测的代码**（ADR-0013 的要求）：
 *   - 只认扩展名白名单 `.md / .markdown / .txt / .rst` —— **扩展名就是判据，不按「内容像代码」猜**；
 *     于是代码正文（`.ts/.js/.py/...`）与锁文件（`.yaml/.json/...`）**一个字节都不会被读**；
 *   - 目录只认项目根（直接子文件）与 `docs|doc|notes|design|designs` 的递归；深度 ≤ 3（路径段数，含文件名）；
 *   - 单项目 ≤ 8 份、单份 ≤ 4000 字（截断，不整篇搬运）；
 *   - 跳过隐藏目录/文件（防 `.env` 类凭据）、`.git`、`node_modules`；
 *   - 用户排除的目录前缀（`<dataDir>/shiji-settings.json` 的 `excludedDirs`）**一个字节都不读** ——
 *     判据是「先判排除、再决定要不要 readFile」，不是读完再过滤。
 *
 * 本模块是**叶子**：只 import node 内置。返回 `{docs, notes}`；单个文件读不动只记一条 note，
 * 不拖垮整轮扫描（项目可能有一份暂时打不开的文档）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 说明文档的扩展名白名单（契约 §1；**这就是「不读代码正文」的判据**）。 */
export const DOC_EXTENSIONS = ['.md', '.markdown', '.txt', '.rst']
/** 允许递归的目录名（项目根的直接子文件另外算）。 */
export const DOC_DIRS = ['docs', 'doc', 'notes', 'design', 'designs']
/** 上限（契约 §1）。 */
export const MAX_DOCS = 8
export const MAX_DOC_CHARS = 4000
/** 深度上限（路径段数，含文件名：`README.md` 是 1，`docs/a.md` 是 2，`docs/x/y.md` 是 3）。 */
export const MAX_DOC_DEPTH = 3
/** 无论是否隐藏都不进的目录。 */
const SKIP_DIRS = new Set(['.git', 'node_modules'])

/** 扩展名在白名单里（小写比较；`README.MD` 也算）。 */
function isDocName(name) {
  const index = name.lastIndexOf('.')
  if (index <= 0) return false
  return DOC_EXTENSIONS.includes(name.slice(index).toLowerCase())
}

/** 隐藏文件 / 目录（`.` 开头；`.` / `..` 不算名字）。 */
function isHidden(name) {
  return name.startsWith('.')
}

/** 用户排除的目录前缀（相对 project 根、`/` 分隔）；只做字符串前缀判断，不碰文件系统。 */
export function isExcluded(relPath, excludedDirs = []) {
  const rel = relPath.replace(/\\/gu, '/')
  return excludedDirs.some((dir) => rel === dir || rel.startsWith(`${dir}/`))
}

/**
 * 扫描一个项目的说明文档。
 *
 * @param {{root: string, excludedDirs?: string[]}} input
 * @returns {{docs: Array<{relPath: string, size: number, mtimeMs: number, text: string}>, notes: string[]}}
 */
export function collectProjectDocs({ root, excludedDirs = [] } = {}) {
  const notes = []
  const docs = []
  if (typeof root !== 'string' || root === '') {
    return { docs, notes: ['项目目录为空：跳过说明文档扫描。'] }
  }
  let rootStat
  try {
    rootStat = statSync(root)
  } catch {
    return { docs, notes: [`项目目录不存在或读不到（${root}）：跳过说明文档扫描。`] }
  }
  if (!rootStat.isDirectory()) return { docs, notes: [`项目路径不是目录（${root}）：跳过说明文档扫描。`] }

  /** 待读取的候选（相对路径，posix 分隔）。 */
  const candidates = []

  const addFile = (relPath) => {
    if (isExcluded(relPath, excludedDirs)) return
    candidates.push(relPath)
  }

  // ① 项目根的直接子文件（深度 1）。
  let rootEntries = []
  try {
    rootEntries = readdirSync(root, { withFileTypes: true })
  } catch {
    return { docs, notes: [`项目目录列不出来（${root}）：跳过说明文档扫描。`] }
  }
  for (const entry of rootEntries) {
    if (!entry.isFile() || isHidden(entry.name) || !isDocName(entry.name)) continue
    addFile(entry.name)
  }

  // ② 允许的目录递归（深度 ≤ MAX_DOC_DEPTH）。
  for (const dirName of DOC_DIRS) {
    if (!rootEntries.some((entry) => entry.name === dirName && entry.isDirectory())) continue
    walk(dirName, 1)
  }

  function walk(relDir, depth) {
    if (isExcluded(relDir, excludedDirs)) return
    let entries
    try {
      entries = readdirSync(join(root, relDir), { withFileTypes: true })
    } catch {
      notes.push(`说明文档目录读不出来（${relDir}）：已跳过。`)
      return
    }
    // 确定性：按名字排序（不用 localeCompare）。
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    for (const entry of entries) {
      if (isHidden(entry.name) || SKIP_DIRS.has(entry.name)) continue
      const relPath = `${relDir}/${entry.name}`
      if (entry.isDirectory()) {
        // 子文件深度 = 当前目录段数 + 1；超过上限就不必再下去。
        if (depth + 1 < MAX_DOC_DEPTH) walk(relPath, depth + 1)
        continue
      }
      if (!entry.isFile() || !isDocName(entry.name)) continue
      if (depth + 1 > MAX_DOC_DEPTH) continue
      addFile(relPath)
    }
  }

  candidates.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  const capped = candidates.slice(0, MAX_DOCS)
  if (candidates.length > MAX_DOCS) {
    notes.push(`说明文档共 ${candidates.length} 份，按路径字典序只取前 ${MAX_DOCS} 份（契约 §1 的单项目上限）。`)
  }

  for (const relPath of capped) {
    const absolute = join(root, relPath)
    let size
    let mtimeMs
    let text
    try {
      const info = statSync(absolute)
      size = info.size
      mtimeMs = info.mtimeMs
      text = readFileSync(absolute, 'utf8')
    } catch (error) {
      notes.push(`说明文档读不出来（${relPath}）：${String(error?.message ?? error)}`)
      continue
    }
    docs.push({
      relPath,
      size,
      mtimeMs,
      text: text.length > MAX_DOC_CHARS ? text.slice(0, MAX_DOC_CHARS) : text,
    })
  }
  return { docs, notes }
}
