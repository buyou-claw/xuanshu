/**
 * packages/xuanshu-host/lib/data/overview.mjs — 「我的数据」一屏的体积口径（票 30 · #30）。
 *
 * 契约（`.scratch/notes/spec002/contract-data-backup.md` §1，冻结）：
 *   `{ schema:'xuanshu/data@1', home, dataDir, groups[8], total, excluded[], notes[] }`
 *
 * 两条容易被做错的语义：
 *   1. **绝不算凭据**：`.credentials.yaml` 既不计入任何组的字节数，也不进备份。它是
 *      本机凭据库，体积再小也不该出现在「我的数据」里（否则用户会以为备份带走了它）。
 *   2. **绝不跟随联接**：`skills/` 常被链到 home 之外（DSH 还读 `~/.agents/skills`），
 *      跟随统计会把外部目录算成自己的体积 —— 见 `plan.mjs::walkFiles` 的 lstat 分支。
 */

import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'

import { DATA_SCHEMA, DEFAULT_LIMITS, dataGroups, isSameOrInside, measureRoots } from './plan.mjs'

/** 排除项（给界面直接显示；每条都必须是能读懂的原因，不是错误码）。 */
export function exclusionNotes({ home, dataDir }) {
  return [
    {
      path: join(home, '.credentials.yaml'),
      reason: '凭据与密钥引用：既不计体积，也不进备份（密钥留在本机凭据库）',
    },
    {
      path: join(home, 'profiles'),
      reason: 'profile 代码与 node_modules（安装产物）：不是用户数据，重装即可',
    },
    {
      path: join(dataDir, 'runtime'),
      reason: '壳的运行时凭据与进程状态：只在本机当次运行有效，不计体积、不进备份',
    },
    {
      path: join(dataDir, 'logs'),
      reason: '运行日志：排障用，不是用户数据，不进备份',
    },
    {
      path: `${home}${sep}**${sep}*.tmp`,
      reason: '原子写残留的临时文件：随时会被覆盖，不进备份',
    },
  ]
}

/**
 * 采集一次体积快照（纯本地读盘；不建目录、不写文件、不联网）。
 *
 * @param {{home: string, dataDir: string, limits?: {files?: number, depth?: number}}} input
 * @returns {{schema: string, home: string, dataDir: string, groups: Array<object>, total: {bytes: number, files: number}, excluded: Array<object>, notes: string[]}}
 */
export function buildOverview({ home, dataDir, limits = DEFAULT_LIMITS }) {
  const notes = []
  let symlinks = 0
  const cappedLabels = []
  const unreadable = new Set()
  const onError = (path) => unreadable.add(path)

  const groups = dataGroups({ home, dataDir }, { onError }).map((group) => {
    const measured = measureRoots(group.roots, { limits, onError })
    symlinks += measured.symlinks
    if (measured.capped) cappedLabels.push(group.label)
    return {
      id: group.id,
      label: group.label,
      path: group.path,
      bytes: measured.bytes,
      files: measured.files,
    }
  })

  const total = groups.reduce(
    (acc, group) => ({ bytes: acc.bytes + group.bytes, files: acc.files + group.files }),
    { bytes: 0, files: 0 },
  )

  if (!existsSync(home)) {
    notes.push('home 目录还不存在：所有分类按 0 计（首次启动前这是正常状态）。')
  }
  if (!isSameOrInside(home, dataDir)) {
    notes.push('数据目录不在 home 内（config.dataDir 覆盖）：分组路径按 dataDir 计，备份清单的路径会以它为准。')
  }
  if (symlinks > 0) {
    notes.push(`已跳过 ${symlinks} 个符号链接 / 目录联接（不跟随，避免统计到 home 之外）。`)
  }
  if (cappedLabels.length > 0) {
    notes.push(
      `统计达到上限（文件 ${limits.files ?? DEFAULT_LIMITS.files} / 深度 ${limits.depth ?? DEFAULT_LIMITS.depth}）：`
      + `${cappedLabels.join('、')} 的体积可能被截断，显示的是「至少这么多」。`,
    )
  }
  for (const path of unreadable) {
    notes.push(`无法读取 ${path}：统计不完整，显示的是已核对的部分，未读部分大小未知。`)
  }

  return {
    schema: DATA_SCHEMA,
    home,
    dataDir,
    groups,
    total,
    excluded: exclusionNotes({ home, dataDir }),
    notes,
  }
}
