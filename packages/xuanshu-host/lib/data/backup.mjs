/**
 * packages/xuanshu-host/lib/data/backup.mjs — 「一键备份」（票 30 · #30）。
 *
 * 契约（`.scratch/notes/spec002/contract-data-backup.md` §2，冻结）：
 *   - 目标目录**由用户自选**（复用 `cang.pickDirectory` 的系统目录选择器）；
 *   - 目标必须是绝对路径、已存在、是目录、可写，且不能位于 home / dataDir 内（含目录联接）；
 *   - 备份目录 `<targetDir>/xuanshu-backup-<YYYYMMDD-HHmmss>/`，同秒重复时加 `-2`、`-3`…，
 *     永不覆盖已有备份；
 *   - 内容 = 8 个数据组（业务数据 + 会话 + storages + skills）；**不含** `.credentials.yaml`
 *     与任何密钥引用；runtime 凭据与状态整组排除，`cordis.yml` / `*.tmp` / `logs/**` 记跳过原因；
 *   - `manifest.json`（`xuanshu/backup@1`）每文件 `sha256` + `size`，`items[].path` 是
 *     相对 home 的 POSIX 路径，可逐项对账；
 *   - **复制后重新摘要**必须等于复制前（不一致 = 备份失败，绝不静默）；
 *   - 源遍历截断 / 读失败即拒绝；先写临时文件再 rename，整体失败时清理本次备份目录。
 *
 * 为什么失败返回 `{ok:false,error}` 而不是 throw：这是**面向界面**的操作，
 * 用户要看到「为什么没备份成」（目标在 home 里 / 没确认 / 不可写），
 * 而不是一个 RPC 500。异常只留给编程错误（装配缺 home/dataDir）。
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { accessSync, constants as fsConstants, copyFileSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { writeAtomic } from '../atomic.mjs'
import { BACKUP_SCHEMA, NEVER_COUNT_BASENAME, dataGroups, isCredentialFile, isSameOrInside, walkFiles } from './plan.mjs'

/** 清单里 `skipped` 最多逐条列这么多；再多就用 notes 说明「另有 N 条」。 */
const MAX_SKIPPED_ENTRIES = 500

/** 备份自身失败（带可读中文原因与受控错误码）。 */
class BackupFailure extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'BackupFailure'
    this.backupCode = code
  }
}

/** 失败返回值（契约 §2 的形状）。 */
function fail(code, message) {
  return { ok: false, error: { code, message } }
}

/** `YYYYMMDD-HHmmss`（**本地时间**：用户在文件管理器里看到的是自己的钟）。 */
function stampOf(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-`
    + `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** 本机路径 → 清单里的 POSIX 相对路径（相对 home；home 之外用 `dataDir/` 前缀并记 note）。 */
function relPosix(home, dataDir, absolute) {
  const fromHome = relative(home, absolute)
  if (fromHome !== '' && !fromHome.startsWith('..') && !isAbsolute(fromHome)) {
    return fromHome.split(sep).join('/')
  }
  const fromData = relative(dataDir, absolute)
  if (fromData !== '' && !fromData.startsWith('..') && !isAbsolute(fromData)) {
    return `dataDir/${fromData.split(sep).join('/')}`
  }
  // 两个基准都覆盖不到（理论上不会发生：组根都在 home 或 dataDir 下）：
  // 用绝对路径的 POSIX 形态，宁可难看也不撒谎。
  return resolve(absolute).split(sep).join('/')
}

/** 一个文件的 sha256（流式；会话文件可能很大，不整读进内存）。 */
function hashFile(file) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolveHash(hash.digest('hex')))
    stream.on('error', rejectHash)
  })
}

/** 取一个已存在目录的写权限；不可写就抛 BackupFailure。 */
function assertWritableDir(dir) {
  let stat
  try {
    stat = statSync(dir)
  } catch {
    throw new BackupFailure('invalid-target', `备份目录不存在：${dir}。请先建好目录，再在「一键备份」里选它。`)
  }
  if (!stat.isDirectory()) {
    throw new BackupFailure('invalid-target', `备份目标不是目录：${dir}。请选择一个文件夹，而不是文件。`)
  }
  try {
    accessSync(dir, fsConstants.W_OK)
  } catch {
    throw new BackupFailure('invalid-target', `备份目录不可写：${dir}。请换一个有写权限的目录。`)
  }
}

/**
 * 执行一次备份。
 *
 * @param {object} input
 * @param {string} input.home - 宿主解析出的 home（`<home>/xuanshu` 的父目录）。
 * @param {string} input.dataDir - 宿主解析出的数据目录。
 * @param {string} input.targetDir - 用户自选的备份目标目录（必填，绝对路径）。
 * @param {unknown} input.confirmed - 必须**严格等于** `true`（人工确认过的语义）。
 * @param {() => Date} [input.clock] - 时钟（同秒碰撞与清单时间戳的测试缝）。
 * @param {{files?: number, depth?: number}} [input.limits] - 遍历上限。
 * @returns {Promise<{ok: true, backupDir: string, manifestPath: string, manifest: object}|{ok: false, error: {code: string, message: string}}>}
 */
export async function runBackup({ home, dataDir, targetDir, confirmed, clock = () => new Date(), limits } = {}) {
  // 1) 人工确认：备份包含会话记录，必须显式点头（`'true'` 不算 —— 这是布尔语义，不是字符串）。
  if (confirmed !== true) {
    return fail(
      'not-confirmed',
      '备份未确认：备份会包含全部会话记录（不含密钥），请确认「已了解备份内容」后再点一次。',
    )
  }

  // 2) 目标目录：绝对 + 已存在 + 是目录 + 可写。
  if (typeof targetDir !== 'string' || targetDir.trim() === '') {
    return fail('invalid-target', '请选择一个备份目录：目标必须是已存在的文件夹（用「选择目录」挑一个）。')
  }
  if (!isAbsolute(targetDir)) {
    return fail('invalid-target', `备份目录必须是绝对路径：${targetDir}。请用「选择目录」挑选绝对路径。`)
  }
  const target = resolve(targetDir)
  try {
    assertWritableDir(target)
  } catch (error) {
    if (error instanceof BackupFailure) return fail(error.backupCode, error.message)
    throw error
  }

  // 3) 防递归：同时检查字面路径与真实路径，目录联接不能绕过门；dataDir 可以单独覆盖到 home 外。
  let realTarget
  let realHome
  let realDataDir
  try {
    realTarget = realpathSync(target)
    realHome = existsSync(home) ? realpathSync(home) : resolve(home)
    realDataDir = existsSync(dataDir) ? realpathSync(dataDir) : resolve(dataDir)
  } catch (error) {
    return fail('invalid-target', `无法核对备份目录的真实位置：${String(error?.message ?? error)}。请确认目录可访问后重试。`)
  }
  if (isSameOrInside(home, target) || isSameOrInside(realHome, realTarget)) {
    return fail(
      'target-inside-home',
      `备份目录不能是玄枢 home 本身，也不能放在 home（${home}）里面：那样会把备份再备份一遍。请选 home 之外的文件夹。`,
    )
  }
  if (isSameOrInside(dataDir, target) || isSameOrInside(realDataDir, realTarget)) {
    return fail('target-inside-data', `备份目录不能放在业务数据目录（${dataDir}）里面。请选数据目录之外的文件夹，避免把旧备份再次收入备份。`)
  }

  // 4) 定位这次备份的目录：同秒重复加后缀，绝不覆盖已有备份。
  const now = clock()
  const stamp = stampOf(now)
  let backupDir = join(target, `xuanshu-backup-${stamp}`)
  for (let suffix = 2; existsSync(backupDir); suffix += 1) {
    if (suffix > 999) {
      return fail('backup-failed', `同一秒内的备份目录名已用尽：${join(target, `xuanshu-backup-${stamp}`)}。请过一秒再试。`)
    }
    backupDir = join(target, `xuanshu-backup-${stamp}-${suffix}`)
  }

  const logsDir = join(dataDir, 'logs')
  const skipped = []
  const skippedSeen = new Set()
  let skippedOverflow = 0

  /** 记一条跳过项（去重；超过上限只计数，最后用 notes 说明）。 */
  const addSkipped = (absolute, reason) => {
    const path = relPosix(home, dataDir, absolute)
    if (skippedSeen.has(path)) return
    skippedSeen.add(path)
    if (skipped.length >= MAX_SKIPPED_ENTRIES) {
      skippedOverflow += 1
      return
    }
    skipped.push({ path, reason })
  }

  // 备份侧的排除口径（与 overview 的 excluded 一致，但原因按「为什么不备份」来写）。
  const ignore = (absolute) => {
    const name = process.platform === 'win32' ? basename(absolute).toLowerCase() : basename(absolute)
    if (isCredentialFile(absolute)) return '凭据与密钥引用：不进备份'
    if (name === 'cordis.yml') return '运行时生成的 profile 根配置：不是用户数据'
    if (name === 'cordis.patch.yml') return '机器级补丁配置：不属于「我的数据」'
    if (name === '.anonymous-user-id') return '机器标识（遥测用）：不随备份迁移'
    if (name.endsWith('.tmp')) return '原子写残留的临时文件：不备份'
    if (isSameOrInside(logsDir, absolute) || isSameOrInside(join(home, 'logs'), absolute)) return '运行日志：不备份'
    return undefined
  }

  // 5) 收集 8 组要复制的文件（不跟随联接；跳过项逐条记原因）。
  const sources = []
  const sourceSeen = new Set()
  let readFailure
  const onError = (path, error) => { readFailure ??= { path, error } }
  for (const group of dataGroups({ home, dataDir }, { onError })) {
    const walked = walkFiles(group.roots, {
      limits,
      ignore,
      onError,
      onSkip: (absolute, reason) => {
        // 凭据是「排除项」（manifest.excluded），不混进 skipped —— 两处原因写法不同，别让用户两边都看到。
        if (isCredentialFile(absolute)) return
        addSkipped(absolute, reason)
      },
    })
    if (readFailure !== undefined) {
      return fail('source-unreadable', `无法读取备份源 ${readFailure.path}：${String(readFailure.error?.message ?? readFailure.error)}。无法确认备份完整性，本次未写入备份目录。`)
    }
    // 概览可以显示「至少这么多」；完整备份不能把截断的源清单当成全部数据。
    if (walked.capped) {
      return fail('source-limit', `「${group.label}」达到文件数或目录深度上限，无法生成完整备份；本次未写入备份目录。请先检查该目录的规模。`)
    }
    for (const file of walked.files) {
      if (sourceSeen.has(file)) continue
      sourceSeen.add(file)
      sources.push(file)
    }
  }

  // home 根下这些条目不在任何数据组内（默认布局 dataDir=<home>/xuanshu 时遍历走不到）：
  // 仍然在清单里点名，免得用户以为「备份里怎么少了它」。
  for (const [name, reason] of [
    ['cordis.yml', '运行时生成的 profile 根配置：不是用户数据'],
    ['cordis.patch.yml', '机器级补丁配置：不属于「我的数据」'],
    ['.anonymous-user-id', '机器标识（遥测用）：不随备份迁移'],
  ]) {
    const absolute = join(home, name)
    if (existsSync(absolute)) addSkipped(absolute, reason)
  }

  const notes = []
  if (!isSameOrInside(home, dataDir)) {
    notes.push('数据目录不在 home 内（config.dataDir 覆盖）：清单里 `dataDir/` 前缀的条目相对于 dataDir。')
  }
  if (skippedOverflow > 0) {
    notes.push(`另有 ${skippedOverflow} 条跳过项未逐项列出（清单只列前 ${MAX_SKIPPED_ENTRIES} 条）。`)
  }
  notes.push('密钥不在备份里：本机凭据库 `.credentials.yaml` 被排除；换机器后在「设置 → 模型」重填 API key。')
  notes.push('恢复不自动覆盖：把备份里的文件放回 home 对应位置即可（见 docs/runbook/home.md 的「数据 / 备份 / 恢复」）。')

  // 6) 复制：先写临时文件再 rename；复制后重新摘要，必须与复制前一致。
  let created = false
  try {
    mkdirSync(backupDir)
    created = true
    const items = []
    let totalBytes = 0
    let seq = 0
    for (const source of sources) {
      const path = relPosix(home, dataDir, source)
      const destination = join(backupDir, ...path.split('/'))
      const sourceHash = await hashFile(source)
      mkdirSync(dirname(destination), { recursive: true })
      seq += 1
      const tmp = `${destination}.${process.pid}.${seq.toString(36)}.tmp`
      copyFileSync(source, tmp)
      const copiedHash = await hashFile(tmp)
      if (copiedHash !== sourceHash) {
        rmSync(tmp, { force: true })
        throw new BackupFailure('verify-failed', `复制后摘要与源文件不一致：${path}（备份已中止，未留下半份文件）`)
      }
      renameSync(tmp, destination)
      const size = statSync(destination).size
      totalBytes += size
      items.push({ path, sha256: copiedHash, size })
    }
    items.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))

    const manifest = {
      schema: BACKUP_SCHEMA,
      createdAt: now.toISOString(),
      home,
      dataDir,
      files: items.length,
      totalBytes,
      items,
      excluded: [
        { path: NEVER_COUNT_BASENAME, reason: '凭据与密钥引用：密钥留在本机凭据库，不进备份' },
        { path: 'profiles', reason: 'profile 代码与 node_modules：重装即可，不是用户数据' },
        { path: relPosix(home, dataDir, join(dataDir, 'runtime')), reason: '壳端点凭据与进程状态：只在本机当次运行有效，不随备份迁移' },
        { path: '**/*.tmp', reason: '原子写残留的临时文件：不备份' },
        { path: relPosix(home, dataDir, logsDir), reason: '运行日志：不备份' },
      ],
      skipped,
      notes,
    }
    const manifestPath = writeAtomic(join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    return { ok: true, backupDir, manifestPath, manifest }
  } catch (error) {
    // 半份备份比没有备份更糟：整目录删掉，只把可读原因回给界面。
    if (created) {
      try {
        rmSync(backupDir, { recursive: true, force: true })
      } catch {
        // 删不掉也不掩盖原错误
      }
    }
    if (error instanceof BackupFailure) return fail(error.backupCode, error.message)
    return fail('backup-failed', `备份失败，已清理未完成的备份目录：${String(error?.message ?? error)}`)
  }
}
