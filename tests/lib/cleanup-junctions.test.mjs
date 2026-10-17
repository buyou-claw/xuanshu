/**
 * tests/lib/cleanup-junctions.test.mjs —— `scripts/lib/cleanup-junctions.mjs` 的判据台。
 *
 * 事故背景（2026-10-17）：实现者 worktree 里的 `node_modules` junction 指向主仓根依赖，
 * `git worktree remove` 跟穿 junction 把主仓 `node_modules` 清空。清理脚本现在**先摘链接再删 worktree**。
 * 这里钉住「只删链接本身、绝不进目标」这条语义（Windows junction 才有跟穿风险，其它平台跳过）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findLinks, isLink, removeLinks } from '../../scripts/lib/cleanup-junctions.mjs'

const made = []
const temp = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}
const cleanup = (dir) => {
  // 先把可能存在的链接摘掉，再递归删临时目录（避免测试自身踩同一个坑）。
  removeLinks(dir)
  rmSync(dir, { recursive: true, force: true })
}
afterEach(() => {
  for (const dir of made.splice(0)) {
    try { cleanup(dir) } catch { /* 临时目录清不掉不拖垮用例 */ }
  }
})

/** Windows 上建 junction；其它平台跳过整组。 */
function makeJunction(target, link) {
  const result = spawnSync('cmd', ['/c', 'mklink', '/J', link, target], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`mklink /J 失败：${result.stdout}${result.stderr}`)
}

const windows = process.platform === 'win32'

describe.skipIf(!windows)('cleanup-junctions：只摘链接、不进目标', () => {
  it('摘掉 junction 后目标与里面的哨兵文件仍在', () => {
    const target = temp('cj-target-')
    writeFileSync(join(target, 'sentinel.txt'), 'alive', 'utf8')
    const root = temp('cj-root-')
    mkdirSync(join(root, 'packages', 'x'), { recursive: true })
    makeJunction(target, join(root, 'node_modules'))

    expect(isLink(join(root, 'node_modules'))).toBe(true)
    expect(findLinks(root)).toEqual([join(root, 'node_modules')])

    const { removed, failed } = removeLinks(root)
    expect(failed).toEqual([])
    expect(removed).toEqual([join(root, 'node_modules')])
    expect(existsSync(join(root, 'node_modules'))).toBe(false)
    // 关键判据：目标一个字节都不许少
    expect(existsSync(join(target, 'sentinel.txt'))).toBe(true)
    expect(existsSync(target)).toBe(true)
  })

  it('普通目录与文件原样保留（只删链接）', () => {
    const root = temp('cj-plain-')
    mkdirSync(join(root, 'src', 'nested'), { recursive: true })
    writeFileSync(join(root, 'src', 'nested', 'keep.txt'), 'keep', 'utf8')

    const { links, removed } = removeLinks(root)
    expect(links).toEqual([])
    expect(removed).toEqual([])
    expect(existsSync(join(root, 'src', 'nested', 'keep.txt'))).toBe(true)
  })

  it('嵌套的 packages/x/node_modules junction 也会被找到并摘掉', () => {
    const target = temp('cj-nested-target-')
    writeFileSync(join(target, 'sentinel.txt'), 'alive', 'utf8')
    const root = temp('cj-nested-root-')
    const nested = join(root, 'packages', 'x')
    mkdirSync(nested, { recursive: true })
    makeJunction(target, join(nested, 'node_modules'))

    expect(findLinks(root)).toEqual([join(nested, 'node_modules')])
    removeLinks(root)
    expect(existsSync(join(nested, 'node_modules'))).toBe(false)
    expect(existsSync(join(target, 'sentinel.txt'))).toBe(true)
  })
})
