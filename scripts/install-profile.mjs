#!/usr/bin/env node
/**
 * install-profile.mjs — 把仓库里的 `profile/` 装配成一个可被 DSH 启动的 profile。
 *
 * 玄枢的分发形态（ADR-0001）：一个 DSH profile = `package.json`（dsh.profile.bundles）
 * + `cordis.patch.yml` + lockfile + 自有插件包。DSH 只从 `$DSH_HOME/profiles/<name>` 启动
 * profile，所以「装配」= 让本仓库的 `profile/` 出现在那个位置。
 *
 * 两种模式：
 *   link（默认，开发/测试用）
 *     在 `$DSH_HOME/profiles/xuanshu` 建目录联接（Windows junction / POSIX symlink）
 *     → `<repo>/profile`，然后在 `<repo>/profile` 里跑 `pnpm install`。
 *     只有一份 node_modules、一份 lockfile；仓库里的 `profile/pnpm-lock.yaml`
 *     就是真正在用的锁文件；测试可把 `DSH_HOME` 指到仓库内的隔离目录。
 *   copy（--copy，真分发包语义）
 *     复制 `package.json` / `cordis.patch.yml` / `pnpm-workspace.yaml` / `pnpm-lock.yaml`
 *     到目标，把自有插件包（`packages/xuanshu-host`、`packages/xuanshu-client`）**复制进**
 *     `<target>/packages/<name>`，依赖改写成 `file:./packages/<name>`，在目标里 `pnpm install`。
 *     刻意不复制 `cordis.yml`（DSH 每次启动重写的运行期产物，见 installCopy 的注释）。
 *
 *     为什么是「复制包 + `file:`」而不是 `link:<仓库绝对路径>`（2026-10-16 离网探针实测）：
 *       - pnpm 的 `link:` 只建联接、**不装**被链接包自己的 dependencies —— 目标 profile 的
 *         `node_modules` 里没有 `tz-lookup`，`xuanshu-host` 一 import 就是 ERR_MODULE_NOT_FOUND；
 *       - `link:` 的产物仍然指向仓库绝对路径，而 ADR-0008 的 copy 场景里运行环境**没有**仓库
 *         （仓库目录一挪走，目标 profile 连插件文件都找不到）。
 *     改成包内容进目标、说明符指向目标内相对目录后，插件自己的 dependencies 会被 pnpm 当依赖图装，
 *     `pnpm-lock.yaml` 也随之可被 `pnpm install --frozen-lockfile` 校验。
 *
 *     依赖口径（两种模式一致——都复制同一份 `pnpm-workspace.yaml`）：
 *       - `dependencies`：装（copy 模式下就是 `file:` 语义保证的那部分）；
 *       - `optionalDependencies`：pnpm 默认装；平台/架构不匹配的例外交给 pnpm 按默认口径处置，不特殊处理；
 *       - `peerDependencies`：**不装**（复制过去的 `autoInstallPeers: false`，与上游官方 profile 同款）。
 *         所以自有插件包不得把运行时依赖写成 peer；它需要的 DSH 侧包应由 profile 自己声明。
 *         实测：自有包带一个没被满足的 peer 时 `pnpm install` 仍然 exit 0（只是不装它）。
 *
 * 无论哪种模式，跑完 `pnpm install` 后都会**逐文件同步自有插件包**（`packages/xuanshu-host`、
 * `packages/xuanshu-client`）进 profile 的 `node_modules`：pnpm 对 `file:` 依赖不会因为源目录
 * 变了就刷新拷贝（实测会打印 `Lockfile is up to date` + `reused`，留下旧代码）。见 syncOwnPackages。
 *
 * 用法：
 *   node scripts/install-profile.mjs                    # link 模式，装到 ~/.dsh/profiles/xuanshu
 *   node scripts/install-profile.mjs --copy             # copy 模式
 *   node scripts/install-profile.mjs --home <dir>       # 换 DSH_HOME（测试隔离用）
 *   node scripts/install-profile.mjs --profile <name>   # 换 profile 名（默认 xuanshu）
 *   node scripts/install-profile.mjs --skip-install     # 只做目录装配，不跑 pnpm
 *   node scripts/install-profile.mjs --force            # 目标是被丢弃得起的 profile 骨架时也覆盖
 *
 * 安全：绝不递归删除真实目录内容。`--force` 只允许清掉「没有 node_modules 的
 * DSH profile 骨架」，其余情况一律报错并打印你该手工执行的命令。
 */

import { spawnSync } from 'node:child_process'
import {
  cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_PROFILE = join(REPO_ROOT, 'profile')
/** profile 里由本仓库提供的插件包（依赖写成 `file:../packages/<name>`）。 */
const OWN_PACKAGES = ['xuanshu-host', 'xuanshu-client']
/** copy 模式下自有插件包在目标 profile 里的落点目录（包内容复制进来，说明符 `file:./packages/<name>`）。 */
const COPY_PACKAGES_DIR = 'packages'
/**
 * copy 模式可以重入的顶层条目：全部是本脚本自己产出的东西。
 *
 * 为什么这里必须有 `packages`：copy 模式现在会物化 `<target>/packages/<name>`，少了这一项，
 * 第二次 `--copy` 就会把自己的产物当「外来条目」拒绝掉。
 */
const COPY_OWN_ENTRIES = ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', COPY_PACKAGES_DIR, 'node_modules']

function printHelp() {
  const text = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const block = text.slice(text.indexOf('/**') + 3, text.indexOf('*/'))
  process.stdout.write(block.split('\n').map((line) => line.replace(/^ \* ?/, '')).join('\n').trim() + '\n')
}

function parseArgs(argv) {
  const opts = {
    mode: 'link',
    home: process.env.DSH_HOME || join(homedir(), '.dsh'),
    profile: 'xuanshu',
    install: true,
    force: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--link') opts.mode = 'link'
    else if (arg === '--copy') opts.mode = 'copy'
    else if (arg === '--home') opts.home = argv[++i]
    else if (arg === '--profile') opts.profile = argv[++i]
    else if (arg === '--skip-install') opts.install = false
    else if (arg === '--force') opts.force = true
    else if (arg === '-h' || arg === '--help') { printHelp(); process.exit(0) }
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (!opts.home || !opts.profile) throw new Error('--home and --profile need a value')
  if (opts.profile === '.' || opts.profile === '..' || /[\\/]/.test(opts.profile)) throw new Error(`invalid profile name: ${opts.profile}`)
  opts.home = resolve(opts.home)
  return opts
}

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

/** 目录联接（junction/symlink）的落点；不是联接就返回 undefined。 */
function linkTarget(path) {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return realpathSync(path)
    if (!stat.isDirectory()) return undefined
    const real = realpathSync(path)
    return samePath(real, path) ? undefined : real
  } catch {
    return undefined
  }
}

/** 只删除联接本身，不跟随、不递归——Windows 上 rmdir 对 junction 正是这个语义。 */
function removeLink(path) {
  if (lstatSync(path).isSymbolicLink()) unlinkSync(path)
  else rmdirSync(path)
}

/** 目标是不是「可以丢弃的 DSH profile 骨架」：dsh-profile-* 的 package.json 且没有 node_modules。 */
function isDisposableSkeleton(path) {
  try {
    if (!lstatSync(path).isDirectory()) return false
    if (existsSync(join(path, 'node_modules'))) return false
    const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
    return typeof manifest.name === 'string' && manifest.name.startsWith('dsh-profile-')
  } catch {
    return false
  }
}

function prepareTarget(opts, target) {
  if (!existsSync(target)) return
  const linked = linkTarget(target)
  if (linked !== undefined) {
    if (!samePath(linked, SOURCE_PROFILE) && !opts.force) {
      throw new Error(`${target} is a link to ${linked}, not to ${SOURCE_PROFILE}; refusing (use --force)`)
    }
    removeLink(target)
    return
  }
  if (opts.mode === 'copy') {
    const foreign = readdirSync(target).filter((name) => !COPY_OWN_ENTRIES.includes(name))
    if (foreign.length === 0) return // copy 模式可重入：只覆盖自己产的文件
    if (opts.force && isDisposableSkeleton(target)) { removeDisposableSkeleton(target); return }
    throw new Error(`${target} holds foreign entries (${foreign.slice(0, 5).join(', ')}); refusing to touch it`)
  }
  if (opts.force && isDisposableSkeleton(target)) { removeDisposableSkeleton(target); return }
  throw new Error(`refusing to replace an existing real directory: ${target}\n  inspect it, then remove it yourself if that is what you want:\n    Remove-Item -Recurse -Force '${target}'`)
}

/** 删掉一个已确认可丢弃的骨架目录（可能是联接；否则只删已知的骨架文件）。 */
const SKELETON_FILES = ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']
function removeDisposableSkeleton(path) {
  if (linkTarget(path) !== undefined) { removeLink(path); return }
  for (const entry of readdirSync(path)) {
    if (entry === COPY_PACKAGES_DIR) { removeOwnPackagesDir(join(path, entry)); continue }
    if (!SKELETON_FILES.includes(entry)) throw new Error(`${path} contains unexpected entry ${entry}; refusing to delete`)
    unlinkSync(join(path, entry))
  }
  rmdirSync(path)
}

/**
 * 删掉 copy 模式自己产出的 `<target>/packages`。
 *
 * 只在里面**全是**自有插件包目录时才动手（多一个陌生条目就报错不删）——`--force` 的适用前提
 * 是 `isDisposableSkeleton` 已经证明这是可丢弃的 profile 骨架，这里只是把「我们自己的那部分」
 * 收干净。
 */
function removeOwnPackagesDir(path) {
  for (const entry of readdirSync(path)) {
    if (!OWN_PACKAGES.includes(entry)) throw new Error(`${path} contains unexpected entry ${entry}; refusing to delete`)
  }
  removeTreeNoFollow(path)
}

/**
 * 递归删除一棵目录树，但**不跟随联接**：联接只 unlink 本身。
 *
 * 为什么不用 `rmSync(recursive)`：Windows 上 pnpm 的 junction 会被递归删除跟着走，删掉的可能是
 * 仓库里的真件（台账「操作陷阱」3 记过同类事故）。这里只删我们刚物化出来的包文件。
 */
function removeTreeNoFollow(path) {
  for (const name of readdirSync(path)) {
    const child = join(path, name)
    const stat = lstatSync(child)
    if (stat.isSymbolicLink()) { unlinkSync(child); continue }
    if (stat.isDirectory()) { removeTreeNoFollow(child); continue }
    unlinkSync(child)
  }
  rmdirSync(path)
}

function installLink(opts, target) {
  prepareTarget(opts, target)
  mkdirSync(dirname(target), { recursive: true })
  symlinkSync(SOURCE_PROFILE, target, process.platform === 'win32' ? 'junction' : 'dir')
  return SOURCE_PROFILE
}

function installCopy(opts, target) {
  prepareTarget(opts, target)
  mkdirSync(target, { recursive: true })
  const manifest = JSON.parse(readFileSync(join(SOURCE_PROFILE, 'package.json'), 'utf8'))
  const materialized = []
  for (const name of OWN_PACKAGES) {
    const spec = manifest.dependencies?.[name]
    if (typeof spec !== 'string' || !spec.startsWith('file:')) continue
    // 仓库里写的是 `file:../packages/<name>`（相对 profile 目录）；装到别处后那个相对路径不再成立。
    // 把包**复制进目标**、说明符改成目标内的相对目录：既没有仓库绝对路径，也保住了 `file:` 语义
    // （pnpm 会把这个包自己的 dependencies 当依赖图装进去；`link:` 不会——见文件头注释的实测依据）。
    const from = join(REPO_ROOT, 'packages', name)
    if (!existsSync(join(from, 'package.json'))) {
      throw new Error(`自有插件包源目录不存在：${from}（profile/package.json 里 ${name} 写的是 ${spec}）`)
    }
    const to = join(target, COPY_PACKAGES_DIR, name)
    const copied = copyPackageFiles(from, to)
    manifest.dependencies[name] = `file:./${COPY_PACKAGES_DIR}/${name}`
    materialized.push({ name, copied })
  }
  writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  // 刻意**不**复制 `cordis.yml`：那是 DSH 每次启动都重写的运行期产物（gitignore）。
  // 从旧目录带一份非空的过去，用户第一次启动就会撞 duplicate-insert（根配置里已经有那些行，
  // 补丁栈再插一次）。让 DSH 首次启动自己生成空 root 配置。
  for (const file of ['cordis.patch.yml', 'pnpm-workspace.yaml']) {
    const from = join(SOURCE_PROFILE, file)
    if (existsSync(from)) cpSync(from, join(target, file))
  }
  // 锁文件一并复制：没有它，目标里 `pnpm install` 会**重新解析**一遍版本范围（要联网、还可能
  // 装到与仓库不同的版本），而 `pnpm install --frozen-lockfile` 无从校验。见 rewriteLockfileForCopy。
  const lockFrom = join(SOURCE_PROFILE, 'pnpm-lock.yaml')
  if (existsSync(lockFrom)) {
    const { text, missing } = rewriteLockfileForCopy(readFileSync(lockFrom, 'utf8'), OWN_PACKAGES)
    assertCopiedLockfileResolves(target, text)
    writeFileSync(join(target, 'pnpm-lock.yaml'), text)
    for (const name of missing) {
      process.stdout.write(`[install-profile] copy: 注意——源 pnpm-lock.yaml 里没有 ${name} 的条目，复制过去的锁文件与改写后的清单不一致，目标里首次 pnpm install 会重写它（那时就不是 --frozen-lockfile 语义了）\n`)
    }
  } else {
    process.stdout.write('[install-profile] copy: 源 profile 没有 pnpm-lock.yaml（未安装过？）→ 目标里由 pnpm 首次生成\n')
  }
  for (const entry of materialized) {
    process.stdout.write(`[install-profile] copy: 物化自有插件包 ${entry.name} → ${COPY_PACKAGES_DIR}/${entry.name}（${entry.copied} 个文件）\n`)
  }
  return target
}

/**
 * 把源包的文件逐个复制进目标；只做「缺了就补、不同就覆盖」，不删多余文件（与 syncOwnPackages 同口径）。
 *
 * 用 `listPackageFiles` 的同一套排除表：`node_modules` 是依赖树、`.git`/`.cache` 是版本库元数据，
 * 都不是分发物；把包自己的 `node_modules` 带过去会带进仓库侧的联接/旧件。
 *
 * @returns {number} 实际写入的文件数（内容相同的文件跳过）。
 */
function copyPackageFiles(from, to) {
  let copied = 0
  for (const rel of listPackageFiles(from)) {
    const source = readFileSync(join(from, rel))
    const dest = join(to, rel)
    if (existsSync(dest) && readFileSync(dest).equals(source)) continue
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, source)
    copied += 1
  }
  return copied
}

/**
 * 把源 profile 的 lockfile 改写成「包已复制进 `<target>/packages/<name>`」的版本。
 *
 * 只改自有插件包相关的路径，其余**一个字节都不动**：pnpm 的 lockfile 是它自己序列化的，
 * 任何重新序列化（解析 YAML 再写回）都会改掉引号/顺序/空行，让 `--frozen-lockfile` 报
 * 「锁文件与清单不一致」——那正是这条修复要解决的问题，不能自己再制造一次。
 *
 * 三处路径（以 xuanshu-host 为例，源 → 目标）：
 *   - `specifier: file:../packages/<name>` → `specifier: file:./packages/<name>`（与改写后的清单一致）；
 *   - `version: file:../packages/<name>` → `version: file:packages/<name>`（lockfile 的键与会话写法，pnpm 不带 `./`）；
 *   - `resolution: {directory: ../packages/<name>, ...}` 与 `packages:` / `snapshots:` 的键同理。
 * 后两类都是「`../packages/<name>` → `packages/<name>`」，所以先把 specifier 行单独换掉，再统一替换。
 *
 * @returns {{ text: string, missing: string[] }} 改写后的文本，以及源 lockfile 里根本没出现的包名。
 */
function rewriteLockfileForCopy(text, names) {
  let out = text
  const missing = []
  for (const name of names) {
    const from = `../packages/${name}`
    if (!out.includes(from)) { missing.push(name); continue }
    out = out.split(`specifier: file:${from}`).join(`specifier: file:./packages/${name}`)
    out = out.split(from).join(`packages/${name}`)
  }
  return { text: out, missing }
}

/**
 * 复制过去的锁文件里，所有 `type: directory` 的解析路径必须在目标内真实存在。
 *
 * 为什么要有这道门：pnpm 安装时会去 pack 这些目录，缺一个就抛 ENOENT —— 原始报错只有 pnpm 内部栈，
 * 完全看不出「自有插件包依赖了仓库里另一个没被复制进来的目录」。提前失败，并把路径点出来。
 * 现状：只物化 `OWN_PACKAGES`，所以自有插件包若用 `file:` 依赖仓库里**别的**目录，就该在这里报错
 * （而不是留一个装到一半、事后才知道坏了的 profile）。
 */
function assertCopiedLockfileResolves(target, text) {
  const missing = []
  for (const match of text.matchAll(/directory:\s*([^,}]+?)\s*,\s*type:\s*directory/g)) {
    const dir = match[1].trim().replace(/^['"]|['"]$/g, '')
    if (!existsSync(resolve(target, dir))) missing.push(dir)
  }
  if (missing.length > 0) {
    throw new Error(
      `复制后的 pnpm-lock.yaml 里有 ${missing.length} 个 type:directory 路径在目标里不存在：${missing.join(', ')}\n`
      + `  本模式只把 ${OWN_PACKAGES.join(' / ')} 复制进目标；自有插件包的 file: 依赖若指向仓库里别的目录，需要先改成自带（放进包内）或 registry 依赖。`,
    )
  }
}

/**
 * 跑 `pnpm install`。
 *
 * Windows 上有两条路都走不通/不划算，本函数是实测出来的唯一稳妥写法（node 24 / pnpm 11 实测）：
 *   - `spawnSync('pnpm.cmd', ['install'], { shell: false })` → **EINVAL**。node 从 18.20/20.12 起
 *     出于命令注入防护，拒绝在 shell:false 下直接执行 `.cmd`/`.bat`（本机复现：status=null、error.code=EINVAL）。
 *   - `spawnSync('pnpm', ['install'], { shell: true })` → 能跑，但 node 会对「带 args 又开 shell」
 *     发 DEP0190 弃用警告（参数只做拼接、不转义）。
 * 所以：Windows 用**整条命令字符串** + shell（没有 args 数组，因此不触发 DEP0190，也没有需要转义的
 * 外部输入——命令里唯一的变量是目录，而目录走 cwd 参数传）；POSIX 直接按参数数组调用。
 */
function runPnpmInstall(dir) {
  const result = process.platform === 'win32'
    ? spawnSync('pnpm install', { cwd: dir, stdio: 'inherit', shell: true })
    : spawnSync('pnpm', ['install'], { cwd: dir, stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`pnpm install failed in ${dir} (exit ${result.status})`)
}

/** 同步自有插件包时跳过的目录（依赖树/版本库元数据不是分发物）。 */
const SYNC_SKIP_DIRS = new Set(['node_modules', '.git', '.cache'])

/** 递归列出源包里的文件（相对路径，`/` 分隔），跳过 SYNC_SKIP_DIRS。 */
function listPackageFiles(root, prefix = '') {
  const files = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    if (SYNC_SKIP_DIRS.has(entry.name)) continue
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...listPackageFiles(root, rel))
    else if (entry.isFile()) files.push(rel)
  }
  return files
}

/**
 * 把仓库里的自有插件包**逐文件同步**进 profile 的 `node_modules/<name>`。
 *
 * 为什么必须做（实测，票 06 的验收踩到）：pnpm 对 `file:` 依赖按 lockfile 判定，源目录改了它照样
 * 打印 `Lockfile is up to date` + `reused N`，留在 `node_modules` 里的是**旧拷贝**——
 * 实测 11 个文件里 9 个不同、7 个缺失（缺的正是新加的 `lib/horosa/**`），于是「改了插件 → 重跑
 * install-profile → 启动 DSH」加载的还是旧代码（症状：新功能像没生效，或者插件在半新半旧的状态下跑）。
 *
 * 只做「缺了就补、不同就覆盖」：不删多余文件、不动 `package.json` 之外的 pnpm 记账（hoisted 布局下
 * `node_modules/<name>` 就是包内容本身）。同步后由调用方打印统计，让「有没有真的刷新」在输出里可见。
 * @returns {Array<{ name: string, copied?: number, same?: number, skipped?: string }>}
 */
function syncOwnPackages(installDir) {
  const report = []
  for (const name of OWN_PACKAGES) {
    const from = join(REPO_ROOT, 'packages', name)
    const to = join(installDir, 'node_modules', name)
    if (!existsSync(join(from, 'package.json'))) {
      report.push({ name, skipped: 'source-package-missing' })
      continue
    }
    if (!existsSync(join(to, 'package.json'))) {
      report.push({ name, skipped: 'not-installed-by-pnpm' })
      continue
    }
    let copied = 0
    let same = 0
    for (const rel of listPackageFiles(from)) {
      const source = readFileSync(join(from, rel))
      const target = join(to, rel)
      if (existsSync(target) && readFileSync(target).equals(source)) {
        same += 1
        continue
      }
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, source)
      copied += 1
    }
    report.push({ name, copied, same })
  }
  return report
}

function reportSync(report) {
  for (const entry of report) {
    if (entry.skipped !== undefined) {
      process.stdout.write(`[install-profile] own-package ${entry.name}: skipped (${entry.skipped})\n`)
      continue
    }
    process.stdout.write(
      entry.copied === 0
        ? `[install-profile] own-package ${entry.name}: 已是最新（${entry.same} 个文件逐一比对相同）\n`
        : `[install-profile] own-package ${entry.name}: 同步了 ${entry.copied} 个文件（${entry.same} 个已相同）——pnpm 对 file: 依赖不会因源目录变化而刷新拷贝\n`,
    )
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!existsSync(join(SOURCE_PROFILE, 'package.json'))) throw new Error(`profile source not found: ${SOURCE_PROFILE}`)

  const target = join(opts.home, 'profiles', opts.profile)
  const installDir = opts.mode === 'link' ? installLink(opts, target) : installCopy(opts, target)

  process.stdout.write(`[install-profile] mode=${opts.mode} dshHome=${opts.home} profile=${opts.profile}\n`)
  process.stdout.write(`[install-profile] target=${target}\n[install-profile] installDir=${installDir}\n`)

  if (opts.install) runPnpmInstall(installDir)
  else process.stdout.write('[install-profile] --skip-install: skipped pnpm install\n')
  // pnpm 之后**再同步一次自有插件**：`file:` 依赖不会因源目录变化而刷新拷贝（见 syncOwnPackages 的注释）。
  reportSync(syncOwnPackages(installDir))
  process.stdout.write('[install-profile] done\n')
}

main()
