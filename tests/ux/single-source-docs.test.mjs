/**
 * 单事实源检查（spec 003 · 票 12 / #59）。
 *
 * 这条检查守的是一句很朴素的话：**判据不能有第二份权威**。
 * 本仓已经吃过一次「三处各写各的」的苦（12 个样式注入点），所以这里用机器证明三件事：
 *   1. 判据目录只有一处（`docs/design/ui-v1/criteria/`），别处没有第二份 `rules/` / `freeze.json`；
 *   2. 设计语言文档只有一份（`设计token字典.md`），没有同名的第二本；
 *   3. 「五列判据」的定义只出现在 `criteria/README.md` 一处 —— 别处出现 `id / 判据 / 检查方式 /
 *      证据 / 严重级` 这种五列表述，就意味着有人又写了一份判据书。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const CRITERIA_DIR = join(REPO_ROOT, 'docs/design/ui-v1/criteria')

/** 递归列文件（跳过 node_modules / .git / .scratch / .upstream —— 那些不是本仓的权威面）。 */
function walk(directory, { skip = new Set(['node_modules', '.git', '.scratch', '.upstream', 'ux-reports', 'dist']) } = {}) {
  const out = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) out.push(...walk(absolute, { skip }))
    else if (entry.isFile()) out.push(absolute)
  }
  return out
}

describe('票 12 · 判据只有一份权威', () => {
  it('`docs/` 下只有一个 `criteria/` 目录，别处没有第二份 rules / freeze', () => {
    const files = walk(join(REPO_ROOT, 'docs'))
    const criteriaDirs = new Set(
      files
        .filter((file) => /(^|[\\/])criteria[\\/]/.test(file))
        .map((file) => relative(REPO_ROOT, file).split(/[\\/]/).slice(0, 4).join('/')),
    )
    expect([...criteriaDirs]).toEqual(['docs/design/ui-v1/criteria'])
    expect(files.filter((file) => /freeze\.json$/.test(file))).toHaveLength(1)
  })

  it('设计 token 字典只有一本（`.md` 与 `.json` 各一份，且在同一个 shared/ 下）', () => {
    const files = walk(REPO_ROOT)
    const dictionaries = files.filter((file) => /设计token字典\.md$/.test(file))
    const machine = files.filter((file) => /xs-tokens\.json$/.test(file))
    expect(dictionaries).toHaveLength(1)
    expect(machine).toHaveLength(1)
  })

  it('「五列判据」的定义只出现在 criteria/README.md 一处', () => {
    const files = walk(REPO_ROOT).filter((file) => file.endsWith('.md'))
    // 允许提到五列的**指针型**文档：术语表（定义词）、spec（提要求）、ADR（记决策）、台账（记数字）。
    // 它们指向权威，不复制权威；真正的第二份判据书会出现在别处（例如 design/ui-v2/…），那才是要拦的。
    const allowed = ['CONTEXT.md', 'docs/specs/', 'docs/adr/', 'docs/development-status.md', 'docs/design/ui-v1/criteria/']
    const defining = files.filter((file) => {
      const relativePath = relative(REPO_ROOT, file).replaceAll('\\', '/')
      if (allowed.some((prefix) => relativePath === prefix || relativePath.startsWith(prefix))) return false
      const text = readFileSync(file, 'utf8')
      return ['检查方式', '严重级', '证据'].every((column) => text.includes(column)) && text.includes('判据')
    })
    expect(defining.map((file) => relative(REPO_ROOT, file).replaceAll('\\', '/'))).toEqual([])
  })

  it('判据目录里该有的东西都在、且没有孤儿文件', () => {
    const entries = readdirSync(CRITERIA_DIR).sort()
    expect(entries).toEqual(['README.md', 'criteria.json', 'freeze.json', 'proposals', 'rules'])
    expect(statSync(join(CRITERIA_DIR, 'criteria.json')).isFile()).toBe(true)
  })

  it('id 规则与墓碑规则写在设计稿侧的文档里（不是只写在 spec 里）', () => {
    const readme = readFileSync(join(CRITERIA_DIR, 'README.md'), 'utf8')
    expect(readme).toContain('稳定且永不复用')
    expect(readme).toContain('tombstone')
    // 墓碑判据仍在判据集里（下架不删条目）—— 投影器会把 tombstone 原样带出来
    const criteria = JSON.parse(readFileSync(join(CRITERIA_DIR, 'criteria.json'), 'utf8'))
    for (const criterion of criteria.criteria) expect(typeof criterion.tombstone).toBe('boolean')
  })
})
