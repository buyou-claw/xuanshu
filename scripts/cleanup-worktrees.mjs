#!/usr/bin/env node
/**
 * `scripts/cleanup-worktrees.mjs` —— 收掉实现者 worktree，**先证明没丢活，再删**。
 *
 * 为什么不是一句 `Remove-Item -Recurse`（本轮实测踩到）：PowerShell 的递归删会**跟随 pnpm 的 junction**，
 * 删掉的可能是仓库根 `node_modules` 里的真件（实测：`.pnpm` 只剩 72 个目录、`@esbuild/win32-x64` 与
 * `@jridgewell/sourcemap-codec` 消失 → vitest 起动即 `ERR_MODULE_NOT_FOUND`）。所以这里：
 *
 *   1. **先证明**：worktree 的分支 tip 必须是 `HEAD` 的祖先（`git merge-base --is-ancestor`）——
 *      没并回来的活一律不动，只报告。本轮就是靠这条发现票 13 客户端两笔从未并回。
 *   2. **再存档**：工作区脏（含未跟踪）就先 `git stash --include-untracked`，草稿留在 `stash@{0}`。
 *   3. **最后删**：先摘掉 worktree 里的 junction/symlink（实现者的 `node_modules` 常指向主仓，
 *      见 `scripts/lib/cleanup-junctions.mjs` 的事故记录 —— `git worktree remove` 会跟穿 junction
 *      清空主仓依赖），再 `git worktree remove`；若目录还在，Windows 用 `cmd /c rmdir /s /q`，
 *      其它平台 `rm -rf`。
 *
 * 用法：
 *   node scripts/cleanup-worktrees.mjs                 # 只处理 <repo>/.scratch/worktrees/** 下的 worktree
 *   node scripts/cleanup-worktrees.mjs --dry-run       # 只报告，不动手
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { removeLinks } from './lib/cleanup-junctions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const SAFE_ROOT = resolve(REPO_ROOT, '.scratch', 'worktrees')
const dryRun = process.argv.includes('--dry-run')

const git = (args, cwd = REPO_ROOT) => spawnSync('git', args, { cwd, encoding: 'utf8' })
const ok = (result) => result.status === 0

function listWorktrees() {
  const result = git(['worktree', 'list', '--porcelain'])
  if (!ok(result)) {
    console.error('[worktrees] git worktree list 失败：', result.stderr)
    process.exit(2)
  }
  const entries = []
  let current = null
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current)
      current = { path: resolve(line.slice('worktree '.length)), branch: null, head: null }
    } else if (line.startsWith('HEAD ') && current) current.head = line.slice(5)
    else if (line.startsWith('branch ') && current) current.branch = line.slice(7)
  }
  if (current) entries.push(current)
  return entries
}

/** 分支 tip（或 detached 的 HEAD）必须是集成分支 HEAD 的祖先 —— 没并回来的活不许删。 */
function isContained(entry) {
  const ref = entry.branch ?? entry.head
  if (!ref) return { contained: false, why: '既没有 branch 也没有 HEAD' }
  const result = git(['merge-base', '--is-ancestor', ref, 'HEAD'])
  if (ok(result)) return { contained: true }
  const ahead = git(['rev-list', '--count', `HEAD..${ref}`])
  const count = ahead.stdout.trim()
  return { contained: false, why: `有 ${count} 笔提交不在 HEAD 里（ref=${ref}）` }
}

const worktrees = listWorktrees().filter((entry) => resolve(entry.path) !== resolve(REPO_ROOT))
if (worktrees.length === 0) {
  console.log('[worktrees] 没有实现者 worktree，收工。')
  process.exit(0)
}

let removed = 0
const skipped = []
const archived = []

for (const entry of worktrees) {
  const inside = resolve(entry.path).startsWith(SAFE_ROOT + sep)
  console.log(`\n[worktrees] ${entry.path}${entry.branch ? `  [${entry.branch}]` : ''}`)
  if (!inside) {
    skipped.push(`${entry.path}：不在 ${SAFE_ROOT} 下（安全边界，需人工处理）`)
    console.log('[worktrees]   跳过：不在 .scratch/worktrees 下')
    continue
  }
  const containment = isContained(entry)
  if (!containment.contained) {
    skipped.push(`${entry.path}：${containment.why}`)
    console.log(`[worktrees]   跳过：${containment.why} —— 先并回集成分支，别删`)
    continue
  }
  const dirty = !ok(git(['diff', '--quiet', 'HEAD'], entry.path)) || git(['status', '--porcelain'], entry.path).stdout.trim() !== ''
  if (dirty) {
    if (dryRun) {
      console.log('[worktrees]   脏（未提交/未跟踪）→ 会先 stash 存档')
    } else {
      const stamp = new Date().toISOString().slice(0, 10)
      const stash = git(['stash', 'push', '--include-untracked', '-m', `cleanup-worktrees ${stamp}`], entry.path)
      if (!ok(stash)) {
        skipped.push(`${entry.path}：stash 失败（${stash.stderr.trim()}），未删`)
        console.log('[worktrees]   跳过：stash 失败')
        continue
      }
      archived.push(entry.path)
      console.log('[worktrees]   未提交内容已存档到 stash')
    }
  }
  if (dryRun) {
    const links = removeLinks(entry.path, { dryRun: true })
    console.log(`[worktrees]   会删除（先摘 ${links.links.length} 个 junction/symlink，再 deregister + rmdir）`)
    removed += 1
    continue
  }
  // 先摘链接本身：git worktree remove 在 Windows 上会跟穿 junction，删到主仓依赖。
  const links = removeLinks(entry.path)
  if (links.links.length > 0) {
    console.log(`[worktrees]   已摘 ${links.removed.length}/${links.links.length} 个 junction/symlink`)
  }
  if (links.failed.length > 0) {
    skipped.push(`${entry.path}：${links.failed.length} 个链接摘不掉（${links.failed[0]}…），未删`)
    console.log('[worktrees]   跳过：链接摘不掉，避免跟穿删除')
    continue
  }
  git(['worktree', 'remove', entry.path])
  if (existsSync(entry.path)) {
    // git worktree 已经 deregister，剩下的目录是普通文件树（pnpm 的 junction 混在里面）：
    // Windows 必须用 cmd 的 rmdir（不跟随 reparse point）。
    if (process.platform === 'win32') spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', entry.path], { stdio: 'ignore' })
    else rmSync(entry.path, { recursive: true, force: true })
  }
  if (existsSync(entry.path)) {
    skipped.push(`${entry.path}：删除后目录仍在（可能被占用）`)
    console.log('[worktrees]   目录仍在：可能被占用，需重试')
  } else {
    removed += 1
    console.log('[worktrees]   已删除')
  }
}

console.log(`\n[worktrees] 删除 ${removed} 个${dryRun ? '（dry-run）' : ''}；存档 ${archived.length} 个脏工作区`)
for (const note of skipped) console.log(`[worktrees] 未处理：${note}`)
process.exit(skipped.length > 0 ? 1 : 0)
