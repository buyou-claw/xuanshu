#!/usr/bin/env node
/**
 * `scripts/ux/collect/source-cache.mjs` —— 采集器共用的**只读文件缓存**。
 *
 * 30 个界面面会反复引用同一批源文件（`mounts.tsx` 被抽屉与门厅同时引用、`bestof.tsx` 被
 * 浮层 / 设置行 / dock / 三个命令同时引用）。没有缓存时每跑一条判据就把同一棵源码读一遍；
 * 有缓存时每条判据只在第一次读盘。缓存是**只读**的：巡检从不写源码（spec 003 §31）。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 行号从 1 开始（报告里的 `file:line` 要能直接粘进编辑器）。 */
export function linesOfText(text) {
  return text.replace(/\r\n/g, '\n').split('\n')
}

/**
 * 造一个只读缓存。
 * @param {{repoRoot: string}} input
 * @returns {{read: (repoPath: string) => {path: string, text: string, lines: string[]}, reads: () => number}}
 */
export function createSourceCache({ repoRoot }) {
  const cache = new Map()
  let diskReads = 0
  return {
    read(repoPath) {
      const cached = cache.get(repoPath)
      if (cached !== undefined) return cached
      const text = readFileSync(join(repoRoot, repoPath), 'utf8')
      diskReads += 1
      const entry = { path: repoPath, text: text.replace(/\r\n/g, '\n'), lines: linesOfText(text) }
      cache.set(repoPath, entry)
      return entry
    },
    reads: () => diskReads,
  }
}
