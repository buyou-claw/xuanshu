/**
 * packages/xuanshu-host/lib/data/plan.mjs — 「我的数据」的分类口径与递归遍历（票 30 · #30）。
 *
 * 本文件是**唯一一份**「哪一组算哪几个路径」的定义：宿主 `data.overview`（体积）与
 * `data.backup`（备份）都从这里取组，绝不各写一份 —— 两处口径分叉时，用户会看到
 * 「统计说有 3 MB，备份里却没有」这种最难解释的错位。
 *
 * 布局出处：`.scratch/notes/spec002/explore-home-isolation.md` §5（全表）与
 * `.scratch/notes/spec002/contract-data-backup.md` §1（8 组，冻结）。home / dataDir
 * **由宿主 `lib/index.js` 传入**（#22 的解析结果），本文件不重算、不猜。
 *
 * 三条硬边界：
 *   1. 递归统计**不跟随符号链接 / 目录联接**（否则一次 `~/.xuanshu/xuanshu/pus` 的联接就能
 *      把整个磁盘算成「谱」的体积，甚至扫到 home 之外）；
 *   2. 缺失 = 0 / 0，不报错（新建的 home 里大多数组还不存在）；
 *   3. 统计有上限（文件数 / 深度），到顶就停并记 note —— 宁可说「至少这么多」，也不挂起界面。
 */

import { lstatSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

/** 体积口径的 schema（契约 §1 定值）。 */
export const DATA_SCHEMA = 'xuanshu/data@1'
/** 备份清单的 schema（契约 §2 定值）。 */
export const BACKUP_SCHEMA = 'xuanshu/backup@1'

/** 统计上限的缺省值：正常用户 home 远小于它；超了就是「先算到这里」并记 note。 */
export const DEFAULT_LIMITS = { files: 20_000, depth: 32 }

/** 任何分类都**绝不算**的文件名：本机凭据库（契约 §1「凭据不计入任何组」）。 */
export const NEVER_COUNT_BASENAME = '.credentials.yaml'

/** Windows 文件名大小写等价；排除判据必须与文件系统使用同一口径。 */
const foldName = (name) => process.platform === 'win32' ? name.toLowerCase() : name

/** 凭据库判据在体积与备份中共用，不能因大小写变体漏出密钥。 */
export function isCredentialFile(path) {
  return foldName(basename(path)) === NEVER_COUNT_BASENAME
}

/** `dataDir` 下属于「其它」的条目必须排除这些名字（它们各自有组，或根本不是数据）。 */
const OTHER_EXCLUDED_NAMES = new Set([
  'pus',
  'cang',
  'digao.md',
  'digao.json',
  'shiji.jsonl',
  // dataDir 被覆盖成 home 本身时（嵌入方 / 测试的注入口），这三个会是 home 级组：
  // 不排除就会在「其它」里重复计一遍。
  'sessions',
  'storages',
  'skills',
  // profile 代码：几百 MB 的 node_modules，不是用户数据。
  'profiles',
  // 壳端点 token / pid 等瞬时状态既不是业务数据，也不应离开本机。
  'runtime',
])

/** 缺省人类可读标签（顺序即展示顺序）。 */
const GROUP_LABELS = {
  pu: '谱',
  cang: '藏',
  digao: '底稿',
  shiji: '事记',
  consult: '问事与会话',
  storages: '存储',
  skills: 'skills',
  other: '其它',
}

/**
 * 列出 8 个数据组（**顺序即展示顺序**，契约 §1）。
 *
 * `roots` 是真实要遍历的绝对路径（目录或文件）；`path` 是给人看的路径串
 * （底稿由两个文件组成，所以要写成 `a + b`）。缺失的根不在这里过滤 ——
 * 遍历层统一按 0 / 0 处理，这样「组表」始终是 8 条，不会随 home 状态变形。
 *
 * @param {{home: string, dataDir: string}} paths - 宿主解析出的 home 与数据目录。
 * @returns {Array<{id: string, label: string, path: string, roots: string[]}>}
 */
export function dataGroups({ home, dataDir }, { onError } = {}) {
  const groups = [
    { id: 'pu', roots: [join(dataDir, 'pus')] },
    { id: 'cang', roots: [join(dataDir, 'cang')] },
    {
      id: 'digao',
      roots: [join(dataDir, 'digao.md'), join(dataDir, 'digao.json')],
      path: `${join(dataDir, 'digao.md')} + ${join(dataDir, 'digao.json')}`,
    },
    { id: 'shiji', roots: [join(dataDir, 'shiji.jsonl')] },
    { id: 'consult', roots: [join(home, 'sessions')] },
    { id: 'storages', roots: [join(home, 'storages')] },
    { id: 'skills', roots: [join(home, 'skills')] },
    { id: 'other', roots: otherRoots(dataDir, { onError }), path: dataDir },
  ]
  return groups.map((group) => ({
    id: group.id,
    label: GROUP_LABELS[group.id],
    path: group.path ?? group.roots[0],
    roots: group.roots,
  }))
}

/** 「其它」= `dataDir` 下未被前几组覆盖的直接子项（递归由遍历层负责）。 */
export function otherRoots(dataDir, { onError } = {}) {
  try {
    return readdirSync(dataDir)
      .filter((name) => !OTHER_EXCLUDED_NAMES.has(foldName(name)))
      .map((name) => join(dataDir, name))
  } catch (error) {
    // 缺失是合法空组；权限等读失败必须让概览/备份按各自语义处理。
    if (error?.code !== 'ENOENT') onError?.(dataDir, error)
    return []
  }
}

/**
 * 递归收集一组根下的**真实文件**（不跟随符号链接 / 目录联接）。
 *
 * @param {string[]} roots - 绝对路径（目录或文件）。
 * @param {object} [options]
 * @param {{files?: number, depth?: number}} [options.limits] - 上限。
 * @param {(path: string, reason: string) => void} [options.onSkip] - 跳过项回调（备份要记 skipped）。
 * @param {(path: string, error: Error) => void} [options.onError] - 读取失败（缺失 / 扫描窗口内消失除外，
 *        那两种走 `onSkip`：前者是合法空组、后者是并发写的正常形状，都不是「读不动」）。
 * @param {(path: string) => string|undefined} [options.ignore] - 返回原因 = 跳过且不再深入。
 * @returns {{files: string[], symlinks: number, capped: boolean}}
 */
export function walkFiles(roots, { limits = DEFAULT_LIMITS, onSkip, onError, ignore } = {}) {
  const fileCap = Number.isFinite(limits.files) && limits.files > 0 ? Math.floor(limits.files) : DEFAULT_LIMITS.files
  const depthCap = Number.isFinite(limits.depth) && limits.depth >= 0 ? Math.floor(limits.depth) : DEFAULT_LIMITS.depth
  const files = []
  let symlinks = 0
  let capped = false

  /** 单个根：先 lstat（不跟随），再按类型分派。 */
  const visit = (path, depth) => {
    if (capped) return
    // 凭据库在任何组里都不算（dataDir 被覆盖成 home 时它会正好落在「其它」的根下）。
    if (isCredentialFile(path)) {
      onSkip?.(path, '凭据与密钥引用：不计体积')
      return
    }
    let stat
    try {
      stat = lstatSync(path)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        // 根缺失 = 合法空组（新建 home 里大多数组还不存在）；**扫描窗口内消失**（并发写 /
        // 原子替换：写盘先写临时文件再 rename）不是读失败 —— 记跳过（带原因），让备份能成功并
        // 逐条对账；把它当 onError 会让一次正常的 rename 变成「备份整单拒绝」。
        if (depth > 0) onSkip?.(path, '扫描期间已消失（并发写 / 原子替换）：不纳入')
        return
      }
      onError?.(path, error)
      return
    }
    if (stat.isSymbolicLink()) {
      symlinks += 1
      onSkip?.(path, '符号链接 / 目录联接：不跟随')
      return
    }
    // 备份侧的「整棵子树跳过」判据（logs/**、*.tmp、运行时配置…）：命中就不再深入。
    const ignoredReason = ignore?.(path)
    if (typeof ignoredReason === 'string' && ignoredReason !== '') {
      onSkip?.(path, ignoredReason)
      return
    }
    if (stat.isFile()) {
      if (files.length >= fileCap) {
        capped = true
        return
      }
      files.push(path)
      return
    }
    if (!stat.isDirectory()) return
    if (depth >= depthCap) {
      capped = true
      return
    }
    let entries
    try {
      entries = readdirSync(path, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') {
        // 与 lstat 的 ENOENT 同一种形状：目录在 lstat 之后、readdir 之前消失（并发删除 / rename）。
        onSkip?.(path, '扫描期间已消失（并发写 / 原子替换）：不纳入')
        return
      }
      onError?.(path, error)
      return
    }
    for (const entry of entries) {
      if (capped) return
      visit(join(path, entry.name), depth + 1)
    }
  }

  for (const root of roots) {
    if (capped) break
    visit(resolve(root), 0)
  }
  return { files, symlinks, capped }
}

/**
 * 统计一组根下的字节数与文件数。
 * @param {string[]} roots - 绝对路径。
 * @param {object} [options] - 透传 `walkFiles`。
 * @returns {{bytes: number, files: number, symlinks: number, capped: boolean}}
 */
export function measureRoots(roots, options = {}) {
  const walked = walkFiles(roots, options)
  let bytes = 0
  for (const file of walked.files) {
    try {
      bytes += statSync(file).size
    } catch (error) {
      // 部分统计仍可展示，但必须让调用方知道有文件没核上。
      options.onError?.(file, error)
    }
  }
  return { bytes, files: walked.files.length, symlinks: walked.symlinks, capped: walked.capped }
}

/** Windows 大小写不敏感；路径包含判断用同一套折叠。 */
const foldPath = (path) => (process.platform === 'win32' ? path.toLowerCase() : path)

/**
 * `target` 是否等于 `parent` 或落在它里面（只做词法判断，不解析符号链接）。
 * @param {string} parent - 绝对路径。
 * @param {string} target - 绝对路径。
 * @returns {boolean}
 */
export function isSameOrInside(parent, target) {
  const base = resolve(parent)
  const candidate = resolve(target)
  const foldedBase = foldPath(base).replace(/[\\/]+$/u, '')
  const foldedCandidate = foldPath(candidate).replace(/[\\/]+$/u, '')
  return foldedCandidate === foldedBase || foldedCandidate.startsWith(`${foldedBase}\\`) || foldedCandidate.startsWith(`${foldedBase}/`)
}
