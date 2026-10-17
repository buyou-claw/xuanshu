/**
 * packages/xuanshu-host/lib/mounts/content.mjs — 把挂载对象读成**层**（票 12；S8 §2.1④）。
 *
 * 一条挂载 = 一层。读的法子只有 `ctx.fs`（沙箱 provider）：
 * `dsh-fs-sandbox` 只在 `writeText`/`editText` 上设围栏、**读一律放行**，可读任意绝对路径，
 * 而且没有 `workspaceFiles` 那套 caps（2 MiB/5000 行/2000 条目，超限直接拒）——
 * 证据 `.scratch/notes/dsh-api-facts.md` E.4。**本模块一次写都不做**（断言台把写方法做成抛）。
 *
 * 「层」的形状（给 `clip.mjs` 与注入用）：
 * ```
 * { id, kind, label, head, segments: [{ id, label, chars, text }], dropped: [{ label, chars, reason }], error?, hint? }
 * ```
 * `head` 是注入时的小标题（不计入字数）；`segments` 是**可裁剪单位 = 段**
 * （一个文本文件一段，段边界裁剪就是文件边界裁剪：永远不切半句话）；
 * `dropped` 是**根本没读**的东西（二进制 / 锁文件 / 超大 / 条目超限），带人话理由 ——
 * 设计稿 S8 §2.3 的「裁掉的：… 二进制与锁文件」就是这一列。
 *
 * 确定性：目录项按名字排序、递归顺序固定，同一个目录两次读出来**逐字节一样**
 * （裁剪与披露要能复现，见 §5 步骤 3/7）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

import { isSkillName, parseSkillFile, skillFile } from '../workflow/skill-export.mjs'
import { readWorkflow } from '../workflow/store.mjs'

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）——与 `consult/service.mjs` 同款。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/** 一次挂载最多读多少个文件（超出的部分记进 `dropped`，理由说清「目录条目超限」）。 */
export const MOUNT_MAX_FILES = 60

/** 单个文本文件最多算多少字符（超出记进 `dropped`，理由带真实体积）。 */
export const MOUNT_MAX_FILE_CHARS = 60_000

/** 递归深度上限（工作区里的源码树不浅，但没必要陪它走到底）。 */
export const MOUNT_MAX_DEPTH = 4

/** 这些目录**从不**进上下文（版本库 / 依赖 / 构建产物：噪音大、体积大、无信息）。 */
export const MOUNT_SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', '.idea', '.vscode'])

/** 锁文件：内容全是哈希与求解结果，对「针对这个工作区提问」没有任何用处。 */
export const MOUNT_LOCK_FILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'Cargo.lock',
  'poetry.lock',
  'composer.lock',
  'Gemfile.lock',
  'go.sum',
])

/** 二进制 / 压缩 / 媒体：一律不读（读了也只会是乱码或巨量 base64）。 */
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'svgz', 'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar',
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'class', 'jar', 'pyc', 'wasm', 'o', 'a', 'lib', 'pdb',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'mov', 'avi', 'mkv', 'wav', 'flac', 'db', 'sqlite', 'sqlite3',
])

/** 字数口径：**码点**数（CJK 一字算 1；与设计稿的「字」同口径，且与实现的字符集无关）。 */
export function countChars(text) {
  return typeof text === 'string' ? [...text].length : 0
}

/** 相对路径的显示形式：一律 `/` 分隔（跨平台可复现）。 */
function relativeLabel(base, name) {
  return base === '' ? name : `${base}/${name}`
}

/** 按扩展名 / 文件名判「不读」并给理由；`undefined` = 可以读。 */
function skipReason(name) {
  if (MOUNT_LOCK_FILES.has(name)) return '锁文件（只有哈希与求解结果）'
  if (name.endsWith('.min.js') || name.endsWith('.min.css') || name.endsWith('.map')) return '压缩产物 / sourcemap'
  const dot = name.lastIndexOf('.')
  if (dot > 0 && BINARY_EXT.has(name.slice(dot + 1).toLowerCase())) return '二进制或媒体文件'
  return undefined
}

/** 人类可读的体积（披露用；字节 → KB/MB）。 */
function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 读一个目录（递归、确定性、只读）。
 *
 * @param {object} fs - `ctx.fs`（`resolve/stat/listDir/readText`）。
 * @param {string} dirPath - 绝对路径（工作区 path）。
 * @param {{maxFiles?: number, maxFileChars?: number, maxDepth?: number}} [limits]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{segments: Array, dropped: Array, error?: string}>}
 */
export async function readDirectoryLayers(fs, dirPath, limits = {}, signal) {
  const maxFiles = limits.maxFiles ?? MOUNT_MAX_FILES
  const maxFileChars = limits.maxFileChars ?? MOUNT_MAX_FILE_CHARS
  const maxDepth = limits.maxDepth ?? MOUNT_MAX_DEPTH
  const segments = []
  const dropped = []

  let root
  try {
    root = await fs.resolve(dirPath)
  } catch (error) {
    return { segments, dropped, error: `路径读不出来（${dirPath}）：${String(error?.message ?? error)}` }
  }
  const info = await fs.stat(root, signal)
  if (info === undefined || info === null) {
    return { segments, dropped, error: `路径不存在：${dirPath}` }
  }
  if (info.type !== 'directory') {
    return { segments, dropped, error: `挂载对象不是目录（${dirPath} 是 ${String(info.type)}）：工作区挂载只读目录。` }
  }

  /** 递归读一层目录；`prefix` 是相对路径前缀（用于段的标签）。 */
  async function walk(target, prefix, depth) {
    if (depth > maxDepth) {
      dropped.push({ label: prefix === '' ? '(根)' : prefix, chars: 0, reason: `目录层级超过 ${maxDepth} 层` })
      return
    }
    let entries
    try {
      entries = await fs.listDir(target, signal)
    } catch (error) {
      dropped.push({ label: prefix === '' ? '(根)' : prefix, chars: 0, reason: `目录列举失败：${String(error?.message ?? error)}` })
      return
    }
    // 确定性：按名字排序（不用 localeCompare：不同机器上的排序结果会不一样）。
    const sorted = [...entries].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    for (const entry of sorted) {
      if (segments.length >= maxFiles) {
        dropped.push({ label: relativeLabel(prefix, entry.name), chars: 0, reason: `目录条目超限（一次最多读 ${maxFiles} 个文件）` })
        continue
      }
      if (entry.type === 'directory') {
        if (MOUNT_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          dropped.push({ label: relativeLabel(prefix, entry.name), chars: 0, reason: '目录已跳过（版本库 / 依赖 / 隐藏目录）' })
          continue
        }
        await walk(entry.target, relativeLabel(prefix, entry.name), depth + 1)
        continue
      }
      if (entry.type !== 'file') {
        dropped.push({ label: relativeLabel(prefix, entry.name), chars: 0, reason: '不是普通文件（符号链接 / 设备等）' })
        continue
      }
      // 隐藏文件同样不读：`.env` / `.npmrc` 这类最常见的就是凭据，灌进上下文既没用又危险。
      if (entry.name.startsWith('.')) {
        dropped.push({ label: relativeLabel(prefix, entry.name), chars: 0, reason: '隐藏文件（配置 / 密钥，不进上下文）' })
        continue
      }
      const reason = skipReason(entry.name)
      if (reason !== undefined) {
        dropped.push({ label: relativeLabel(prefix, entry.name), chars: 0, reason })
        continue
      }
      let text
      try {
        text = await fs.readText(entry.target, signal)
      } catch (error) {
        dropped.push({ label: relativeLabel(prefix, entry.name), chars: 0, reason: `读不出来：${String(error?.message ?? error)}` })
        continue
      }
      const chars = countChars(text)
      if (chars > maxFileChars) {
        dropped.push({ label: relativeLabel(prefix, entry.name), chars: 0, reason: `单文件超限（${String(chars)} 字 > ${String(maxFileChars)} 字，${humanBytes(entry.size ?? 0)}）` })
        continue
      }
      if (chars === 0) {
        dropped.push({ label: relativeLabel(prefix, entry.name), chars: 0, reason: '空文件' })
        continue
      }
      segments.push({
        id: relativeLabel(prefix, entry.name),
        label: relativeLabel(prefix, entry.name),
        chars,
        text,
      })
    }
  }

  await walk(root, '', 1)
  return { segments, dropped }
}

/**
 * skill 扫描根 `<dshHome>/skills` 的父目录（票 31）。
 *
 * 生产装配（`lib/index.js`）**显式**把 `dshHome` 传进这一层 —— 它与 workflow 的导出落点同源
 * （`workflow/service.mjs` 的 `resolveDshHome`）。只拿到 `dataDir` 时沿用票 01 的布局
 * （数据目录是 `<dshHome>/xuanshu`，与 `resolveMountBudget` 同一套推导）。
 * 两者都没有就**不猜**：宁可如实报错，也不去读一个碰巧存在的 `~/.dsh`。
 *
 * @param {{dataDir?: string, dshHome?: string}} [config]
 * @returns {string|undefined}
 */
function resolveSkillHome(config) {
  if (typeof config?.dshHome === 'string' && config.dshHome !== '') return config.dshHome
  if (typeof config?.dataDir === 'string' && config.dataDir !== '' && basename(config.dataDir) === 'xuanshu') {
    return dirname(config.dataDir)
  }
  return undefined
}

/**
 * 工作流层：读该工作流**已导出**的 `SKILL.md` 正文（票 31）。
 *
 * 判据顺序（与 `workflow/service.mjs` 的导出落点逐条对齐）：
 *   ① 清单里有没有这一条 → 没有就是 error（挂一个不存在的工作流没有意义）；
 *   ② 清单里有没有 `skillName` → 没有 = **从没导出过**（只有这一步才说「还没有导出过 skill」）；
 *   ③ 文件在不在 → 不在 = 导出过但被删了（点名 skill 名与路径，别提「没导出过」）；
 *   ④ 解析（`parseSkillFile`）→ frontmatter 坏 / 正文空都如实说明。
 *
 * 返回的层形状与工作区分支**逐字段同构**（`segments` / `dropped` / `error?` / `hint?`），
 * 所以 `clip.mjs` 的预算裁剪、`context.mjs` 的披露与 `boundary.mjs` 的交付账都不用改一行。
 *
 * @param {{kind: string, id: string, label: string}} mount
 * @param {string} head
 * @param {{dataDir?: string, dshHome?: string}} limits
 * @returns {object}
 */
function readWorkflowLayer(mount, head, limits) {
  const id = `${mount.kind}:${mount.id}`
  const layer = { id, kind: mount.kind, label: mount.label, head, segments: [], dropped: [] }
  const dataDir = typeof limits?.dataDir === 'string' && limits.dataDir !== '' ? limits.dataDir : undefined
  if (dataDir === undefined) {
    return { ...layer, error: '找不到玄枢数据目录（dataDir）：工作流清单读不出来（挂载清单本身仍然保存）。' }
  }
  const record = readWorkflow(dataDir, mount.id)
  if (record === null) {
    return {
      ...layer,
      error: `这个工作流不在工作流清单里（id=${mount.id}）：去工作流面板确认，或先移除它。`,
    }
  }
  const skillName = typeof record.skillName === 'string' && record.skillName !== '' ? record.skillName : undefined
  if (skillName === undefined) {
    return {
      ...layer,
      hint: '这个工作流还没有导出过 skill：先去工作流面板导出一次，再挂载它（没有导出就没有可注入的正文）。',
    }
  }
  // 清单是本地 JSON（可被手改）：名字不合规就不拼路径（否则 `../..` 能把这层变成任意文件读取）。
  if (!isSkillName(skillName)) {
    return {
      ...layer,
      hint: `这个工作流清单里的 skill 名不合法（${JSON.stringify(skillName)}）：不能拿它去拼 skill 路径，请重新导出一次。`,
    }
  }
  const dshHome = resolveSkillHome(limits)
  if (dshHome === undefined) {
    return {
      ...layer,
      error: '不知道 DSH home（skill 扫描根）：读不出这个工作流导出的 skill（挂载清单本身仍然保存）。',
    }
  }
  const file = skillFile(dshHome, skillName)
  if (!existsSync(file)) {
    return {
      ...layer,
      hint: `这个工作流导出过 skill（${skillName}），但 ${file} 读不到（可能被手动删掉了）：重新导出一次，或先移除这个挂载。`,
    }
  }
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    return { ...layer, error: `读不出这个工作流导出的 skill（${file}）：${String(error?.message ?? error)}` }
  }
  const parsed = parseSkillFile(text)
  if (!parsed.ok) {
    return {
      ...layer,
      hint: `这个工作流导出的 skill 文件不合法：${parsed.reason}（重新导出一次；不合法的 skill 不会被 DSH 扫描器收进去）。`,
    }
  }
  const body = String(parsed.content ?? '').trim()
  if (body === '') {
    return { ...layer, hint: `这个工作流导出的 skill 正文是空的（${file}）：没有可注入的内容，重新导出时把正文写进去。` }
  }
  return {
    ...layer,
    head: `${head}（skill ${skillName}）`,
    segments: [{ id: 'SKILL.md', label: 'SKILL.md', chars: countChars(body), text: body }],
  }
}

/**
 * 把一次挂载读成「一层」：工作区走目录；工作流读它**已导出**的 `SKILL.md`（票 31）。
 *
 * 工作流为什么不是 hint 空层了：票 16 已经落地（`workflow.exportSkill` 把正文写到
 * `<dshHome>/skills/<kebab>/SKILL.md`，清单里记 `skillName` / `skillPath`），而票 31 的验收
 * 就是「挂载工作流时模型看到 SKILL.md 正文」。读不到时**只说读到的事实**：
 *   - 从没导出过 ⇒ 「这个工作流还没有导出过 skill」；
 *   - 导出过但文件没了 ⇒ 点名 skill 名与路径，请人重新导出（不冒充「没导出过」）；
 *   - 文件不合法 / 正文为空 ⇒ 说清是哪一种（不编正文）。
 *
 * @param {object} ctx - 宿主上下文（工作区分支用 `ctx.fs` 与 `ctx.workspaceRegistry`）。
 * @param {{kind: string, id: string, label: string}} mount - 一条 `MountRef`。
 * @param {{dataDir?: string, dshHome?: string, maxFiles?: number, maxFileChars?: number, maxDepth?: number}} [limits]
 *        `dataDir` / `dshHome` 是工作流分支的读面（生产装配显式给；断言台给沙箱）。
 * @returns {Promise<object>} 层。
 */
export async function readMountLayer(ctx, mount, limits = {}) {
  const id = `${mount.kind}:${mount.id}`
  const head = mount.kind === 'workspace' ? `工作区「${mount.label}」` : `工作流「${mount.label}」`
  if (mount.kind === 'workflow') return readWorkflowLayer(mount, head, limits)

  const fs = softGet(ctx, 'fs')
  if (typeof fs?.resolve !== 'function' || typeof fs?.readText !== 'function' || typeof fs?.listDir !== 'function') {
    return { id, kind: mount.kind, label: mount.label, head, segments: [], dropped: [], error: 'DSH 文件服务（ctx.fs）不可得：挂载内容读不出来（挂载清单本身仍然保存）。' }
  }

  const registry = softGet(ctx, 'workspaceRegistry')
  const workspace = typeof registry?.get === 'function' ? registry.get(mount.id) : undefined
  const path = typeof workspace?.path === 'string' && workspace.path !== '' ? workspace.path : undefined
  if (path === undefined) {
    return { id, kind: mount.kind, label: mount.label, head, segments: [], dropped: [], error: `这个工作区不在 DSH 的工作区清单里（id=${mount.id}）：去 DSH 工作区界面确认，或先移除它。` }
  }

  const read = await readDirectoryLayers(fs, path, limits)
  return {
    id,
    kind: mount.kind,
    label: mount.label,
    head: `${head}（${path}）`,
    segments: read.segments,
    dropped: read.dropped,
    ...(read.error === undefined ? {} : { error: read.error }),
    ...(read.segments.length === 0 && read.error === undefined ? { hint: '这个目录里没有可读的文本内容（只有二进制 / 锁文件或空文件）。' } : {}),
  }
}
