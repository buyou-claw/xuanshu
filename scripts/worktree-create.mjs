#!/usr/bin/env node
/**
 * `scripts/worktree-create.mjs` —— 实现者 worktree 的「一条命令起」。
 *
 * 手工起工作树的成本不止 `git worktree add`：还要记得把仓库根 `node_modules` 与各
 * `packages/<pkg>/node_modules` 链进新工作树，否则 build / 测试起不来；而链多了又踩上
 * 2026-10-17 的事故（`docs/development-status.md` §16.4 第 7 条）：`git worktree remove`
 * 在 Windows 上会**跟穿 junction**，把主仓 `node_modules` 清空。所以这条命令把
 * 「建 worktree + 建分支 + 只链依赖 + 打印可复制的进入方式」收成一条，并钉死两条语义：
 *
 *   1. **只链不复制、不装包、绝不写链接目标**（目标里的文件一个字节都不动）；
 *   2. **失败不改现场**：worktree 目录或分支已存在 → 可读拒绝；`--dry-run` 只打印计划。
 *
 * 清理**不在本票**：仍走 `pnpm cleanup:worktrees`（它已负责「先摘链接、再删工作树」）。
 *
 * 用法：
 *   node scripts/worktree-create.mjs <name> [选项]
 *
 *   <name>            工作树名：决定路径 `<repo>/.scratch/worktrees/<name>` 与默认分支 `fix/<name>`
 *   --base <ref>      新分支的起点（缺省 = 当前 HEAD；建议传集成分支名）
 *   --branch <name>   新分支名（缺省 = `fix/<name>`）
 *   --repo <dir>      目标仓库根（缺省 = 本脚本所在仓库；测试用临时仓库注入）
 *   --dry-run         只打印计划，不建目录、不改 git
 *
 * 成功时最后打印一条可直接复制的进入方式（`cd "<worktree>"`）与分支名。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO = resolve(HERE, '..')
const WORKTREE_DIRS = ['.scratch', 'worktrees']

/**
 * 工作树名只允许安全字符：它同时决定**路径**（`.scratch/worktrees/<name>`）与默认分支。
 * 拒绝 `/`、`\`、`..`、前导 `.` —— 名字不该能把东西写到 `.scratch/worktrees` 之外。
 */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** 退出码：0 成功 / 1 用法错误或环境拒绝 / 2 外部命令失败。 */
const EXIT = { ok: 0, refused: 1, failed: 2 }

/** 统一的「可读失败」：原因 + 下一步，写 stderr 后退出。 */
function fail(message, { hint = '', code = EXIT.refused } = {}) {
  console.error(`[worktree-create] 失败：${message}`)
  if (hint !== '') console.error(`[worktree-create] 下一步：${hint}`)
  process.exit(code)
}

/** 跑 git（不抛；调用点自己判 status）。 */
function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' })
}

/**
 * 解析 argv：只收表里列出的参数；未知参数直接用法错（不静默吞）。
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const opts = { name: undefined, base: undefined, branch: undefined, repo: undefined, dryRun: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '-h' || arg === '--help') {
      opts.help = true
      continue
    }
    if (arg === '--dry-run') {
      opts.dryRun = true
      continue
    }
    if (arg === '--base' || arg === '--branch' || arg === '--repo') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        fail(`${arg} 需要一个值`, { hint: '用法见 node scripts/worktree-create.mjs --help' })
      }
      opts[{ '--base': 'base', '--branch': 'branch', '--repo': 'repo' }[arg]] = value
      index += 1
      continue
    }
    if (arg.startsWith('-')) {
      fail(`未知参数：${arg}`, { hint: '用法见 node scripts/worktree-create.mjs --help' })
    }
    if (opts.name !== undefined) fail(`只接受一个工作树名，收到多余的「${arg}」`, { hint: '一个 worktree 一个名字' })
    opts.name = arg
  }
  return opts
}

/** 打印用法（与文件头的参数表同一份口径）。 */
function printHelp() {
  console.log('用法：node scripts/worktree-create.mjs <name> [--base <ref>] [--branch <name>] [--repo <dir>] [--dry-run]')
  console.log('  <name>   工作树名 → <repo>/.scratch/worktrees/<name>，默认分支 fix/<name>')
  console.log('  --base   新分支起点（缺省 = 当前 HEAD）')
  console.log('  --branch 新分支名（缺省 = fix/<name>）')
  console.log('  --repo   目标仓库根（缺省 = 本脚本所在仓库）')
  console.log('  --dry-run 只打印计划，不落盘')
}

/**
 * 解析目标仓库根：`--repo` 或脚本所在仓库；用 git 确认它真是工作树。
 * @returns {string} 仓库根的绝对路径
 */
function resolveRepo(opts) {
  const candidate = opts.repo === undefined ? DEFAULT_REPO : resolve(opts.repo)
  const top = git(['rev-parse', '--show-toplevel'], candidate)
  if (top.status !== 0) {
    fail(`「${candidate}」不是一个 git 仓库（${(top.stderr || '').trim() || 'git rev-parse 失败'}）`, {
      hint: '用 --repo 指向仓库根，或在仓库里运行本脚本',
    })
  }
  return resolve(top.stdout.trim())
}

/**
 * 列出要链的依赖：仓库根 `node_modules` + 每个**已存在**的 `packages/<pkg>/node_modules`。
 * 目标是主仓里已装好的依赖目录；这里只描述，不创建。
 * @returns {{create: {label: string, target: string, link: string}[], skip: {label: string, why: string}[]}}
 */
function planLinks(repoRoot, worktreePath) {
  const create = []
  const skip = []
  const consider = (label, target, link) => {
    if (!existsSync(target)) {
      skip.push({ label, why: '目标不存在（主仓没装这份依赖，跳过）' })
      return
    }
    if (existsSync(link)) {
      skip.push({ label, why: '链接位已存在（不覆盖）' })
      return
    }
    create.push({ label, target, link })
  }

  consider('根 node_modules', join(repoRoot, 'node_modules'), join(worktreePath, 'node_modules'))

  let packageNames = []
  try {
    packageNames = readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    /* 没有 packages/ 的仓库：只有根依赖可链 */
  }
  for (const name of packageNames) {
    consider(
      `packages/${name}/node_modules`,
      join(repoRoot, 'packages', name, 'node_modules'),
      join(worktreePath, 'packages', name, 'node_modules'),
    )
  }
  return { create, skip }
}

/**
 * 建一个依赖链接（只建链接本身，绝不写 target）。
 * Windows 用 `cmd /c mklink /J`（junction）；其它平台用 symlink。
 * @returns {{ok: true} | {ok: false, error: string}}
 */
function createLink(link, target) {
  if (process.platform === 'win32') {
    // 参数用 argv 数组交给 Node 拼命令行，路径带空格也能整体当成一个参数。
    const result = spawnSync('cmd', ['/c', 'mklink', '/J', link, target], { encoding: 'utf8' })
    if (result.status === 0) return { ok: true }
    return { ok: false, error: (result.stderr || result.stdout || '').trim() || `mklink 退出码 ${result.status}` }
  }
  try {
    symlinkSync(target, link, 'dir')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 打印「跳过」的依赖（目标不存在 / 链接位已存在），让跳过不是静默的。 */
function printSkipLines(skip) {
  for (const skipped of skip) console.log(`[worktree-create] 跳过：${skipped.label}（${skipped.why}）`)
}

/** 依赖链接的人类可读摘要（`根 node_modules、packages/x/node_modules`）。 */
function labelsOf(links) {
  return links.map((link) => link.label).join('、')
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    printHelp()
    return EXIT.ok
  }
  if (opts.name === undefined || opts.name === '') {
    fail('缺少工作树名', { hint: 'node scripts/worktree-create.mjs <name>（用法见 --help）' })
  }
  if (!NAME_RE.test(opts.name)) {
    fail(`工作树名字不合法：${JSON.stringify(opts.name)}（只允许字母/数字/._-，且不能以 . 或 - 开头）`, {
      hint: '例：node scripts/worktree-create.mjs e1-worktree-script',
    })
  }

  const repoRoot = resolveRepo(opts)

  const baseRef = opts.base ?? 'HEAD'
  const base = git(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], repoRoot)
  if (base.status !== 0) {
    fail(`--base 解析不到提交：${baseRef}`, { hint: '确认这个 ref 存在（例如 feat/spec-002-integration）' })
  }
  const baseSha = base.stdout.trim()

  const branch = opts.branch ?? `fix/${opts.name}`
  const worktreePath = join(repoRoot, ...WORKTREE_DIRS, opts.name)

  // ── 前置拒绝：全部在「建目录 / 改 git」之前做完，拒绝时现场零改动 ──
  const safeRoot = resolve(repoRoot, ...WORKTREE_DIRS)
  if (!resolve(worktreePath).startsWith(safeRoot + sep)) {
    // 名字已拦过一次；这是防御纵深：路径只许落在本仓 .scratch/worktrees 之下。
    fail(`工作树路径越界：${worktreePath}`, { hint: `工作树只能建在 ${safeRoot} 下` })
  }
  const refCheck = git(['check-ref-format', '--branch', branch], repoRoot)
  if (refCheck.status !== 0) {
    fail(`分支名不合法：${branch}`, { hint: '用 --branch 给一个合法的 git 分支名' })
  }
  if (existsSync(worktreePath)) {
    fail(`工作树目录已存在：${worktreePath}`, {
      hint: '换一个工作树名；若那是旧工作树，先 pnpm cleanup:worktrees 收掉',
    })
  }
  if (git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repoRoot).status === 0) {
    fail(`分支已存在：${branch}`, { hint: '用 --branch 换一个分支名；或先把旧分支合并/删除' })
  }

  const links = planLinks(repoRoot, worktreePath)

  if (opts.dryRun) {
    console.log('[worktree-create] dry-run：只打印计划，不建目录、不改 git。')
    console.log(`[worktree-create] 将建工作树：${worktreePath}`)
    console.log(`[worktree-create] 将建分支：${branch}（基于 ${baseSha.slice(0, 10)}）`)
    if (links.create.length > 0) {
      console.log(`[worktree-create] 将链依赖：${links.create.length} 个（${labelsOf(links.create)}）`)
    }
    printSkipLines(links.skip)
    console.log('[worktree-create] 未改动任何文件。')
    return EXIT.ok
  }

  mkdirSync(join(repoRoot, ...WORKTREE_DIRS), { recursive: true })
  const added = git(['worktree', 'add', '-b', branch, worktreePath, baseSha], repoRoot)
  if (added.status !== 0) {
    fail(`git worktree add 失败：${(added.stderr || added.stdout || '').trim()}`, {
      hint: '若留下了半成品（分支或目录），先 pnpm cleanup:worktrees 收掉再试',
      code: EXIT.failed,
    })
  }

  const created = []
  const failedLinks = []
  for (const link of links.create) {
    mkdirSync(dirname(link.link), { recursive: true })
    const result = createLink(link.link, link.target)
    if (result.ok) created.push(link)
    else failedLinks.push({ ...link, error: result.error })
  }

  console.log(`[worktree-create] 工作树：${worktreePath}`)
  console.log(`[worktree-create] 分支：${branch}（基于 ${baseSha.slice(0, 10)}）`)
  if (created.length > 0) console.log(`[worktree-create] 依赖链接：${created.length} 个（${labelsOf(created)}）`)
  printSkipLines(links.skip)
  if (failedLinks.length > 0) {
    for (const link of failedLinks) console.error(`[worktree-create] 链接失败：${link.label} → ${link.target}（${link.error}）`)
    fail(`${failedLinks.length} 个依赖链接没建成`, {
      hint: `可先 cd 「${worktreePath}」手工补链接；或 pnpm cleanup:worktrees 收掉这个工作树重来`,
      code: EXIT.failed,
    })
  }

  console.log('[worktree-create] 进入：')
  console.log(`cd "${worktreePath}"`)
  return EXIT.ok
}

process.exit(main())
