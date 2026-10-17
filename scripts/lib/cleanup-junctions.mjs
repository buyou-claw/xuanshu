/**
 * `scripts/lib/cleanup-junctions.mjs` —— 删除 worktree 之前先把里面的 **junction / symlink** 摘掉。
 *
 * 为什么需要它（2026-10-17 实测事故）：实现者在 worktree 里用 `mklink /J node_modules`
 * 指向主仓依赖，`git worktree remove`（git for Windows）会**跟穿 junction** 递归删，
 * 把主仓根 `node_modules` 清空（`.pnpm` 全没 → vitest 起不来；靠 pnpm store 离线恢复）。
 * 之前以为「`cmd rmdir /s` 不跟随 reparse point」就安全，但真正先删目录的是 git 自己。
 *
 * 语义：只处理**链接本身**（junction / symlink），绝不递归进链接目标；
 * 普通目录/文件原样留下，交给后续 `git worktree remove`。
 */
import { spawnSync } from 'node:child_process'
import { lstatSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/** lstat 判链接（Windows junction 在 Node 里也是 symbolic link）。 */
export function isLink(path) {
  try {
    const stat = lstatSync(path)
    return stat.isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * 找出 root 下所有链接（不进入链接目标；跳过 `.git`）。
 * @param {string} root
 * @param {{maxDepth?: number}} [options]
 * @returns {string[]} 链接的绝对/拼接路径（深度优先，父在前）
 */
export function findLinks(root, { maxDepth = 6 } = {}) {
  const found = []
  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue
      const full = join(dir, entry.name)
      if (isLink(full)) {
        found.push(full)
        continue // 绝不进入链接目标
      }
      if (entry.isDirectory()) walk(full, depth + 1)
    }
  }
  walk(root, 0)
  return found
}

/** 摘掉一个链接本身（Windows 用 cmd rmdir，POSIX 用 unlink）。 */
function defaultRemove(linkPath) {
  if (process.platform === 'win32') {
    return spawnSync('cmd', ['/c', 'rmdir', linkPath], { stdio: 'ignore' }).status === 0
  }
  try {
    unlinkSync(linkPath)
    return true
  } catch {
    return false
  }
}

/**
 * 摘掉 root 下所有链接（只删链接本身）。
 * @param {string} root
 * @param {{dryRun?: boolean, remove?: (path: string) => boolean, maxDepth?: number}} [options]
 * @returns {{links: string[], removed: string[], failed: string[]}}
 */
export function removeLinks(root, { dryRun = false, remove = defaultRemove, maxDepth = 6 } = {}) {
  const links = findLinks(root, { maxDepth })
  const removed = []
  const failed = []
  for (const link of links) {
    if (dryRun) continue
    if (remove(link)) removed.push(link)
    else failed.push(link)
  }
  return { links, removed, failed }
}
