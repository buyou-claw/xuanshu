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
 *     复制 `package.json` / `cordis.patch.yml` / `pnpm-workspace.yaml`
 *     到目标，把自有插件依赖改写成 `link:<仓库绝对路径>`，在目标里 `pnpm install`。
 *     刻意不复制 `cordis.yml`（DSH 每次启动重写的运行期产物，见 installCopy 的注释）。
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
    const foreign = readdirSync(target).filter((name) => !['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'node_modules'].includes(name))
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
  for (const file of readdirSync(path)) {
    if (!SKELETON_FILES.includes(file)) throw new Error(`${path} contains unexpected entry ${file}; refusing to delete`)
    unlinkSync(join(path, file))
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
  for (const name of OWN_PACKAGES) {
    // 仓库里写的是 `file:../packages/<name>`（相对 profile 目录）；装到别处后那个相对
    // 路径不再成立，改写成指向仓库的绝对 link: 说明符。
    if (typeof manifest.dependencies?.[name] === 'string' && manifest.dependencies[name].startsWith('file:')) {
      manifest.dependencies[name] = `link:${join(REPO_ROOT, 'packages', name)}`
    }
  }
  writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  // 刻意**不**复制 `cordis.yml`：那是 DSH 每次启动都重写的运行期产物（gitignore）。
  // 从旧目录带一份非空的过去，用户第一次启动就会撞 duplicate-insert（根配置里已经有那些行，
  // 补丁栈再插一次）。让 DSH 首次启动自己生成空 root 配置。
  for (const file of ['cordis.patch.yml', 'pnpm-workspace.yaml']) {
    const from = join(SOURCE_PROFILE, file)
    if (existsSync(from)) cpSync(from, join(target, file))
  }
  return target
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

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!existsSync(join(SOURCE_PROFILE, 'package.json'))) throw new Error(`profile source not found: ${SOURCE_PROFILE}`)

  const target = join(opts.home, 'profiles', opts.profile)
  const installDir = opts.mode === 'link' ? installLink(opts, target) : installCopy(opts, target)

  process.stdout.write(`[install-profile] mode=${opts.mode} dshHome=${opts.home} profile=${opts.profile}\n`)
  process.stdout.write(`[install-profile] target=${target}\n[install-profile] installDir=${installDir}\n`)

  if (opts.install) runPnpmInstall(installDir)
  else process.stdout.write('[install-profile] --skip-install: skipped pnpm install\n')
  process.stdout.write('[install-profile] done\n')
}

main()
