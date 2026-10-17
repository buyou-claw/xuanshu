/**
 * 票 05（#26）· 项目说明文档的读面（契约 §1）
 *
 * 「**绝不读代码正文**」是本票的隐私/成本判据（ADR-0013），所以这里的断言不是「文档读得对」，
 * 而是**哪些文件被读了、哪些一个字节都没读**：
 *   - 扩展名白名单就是判据（`.md/.markdown/.txt/.rst`），`src/*.ts` 不进扫描；
 *   - 目录只认项目根 + `docs|doc|notes|design|designs`；深度 ≤3、≤8 份、单份 ≤4000 字；
 *   - 隐藏目录 / `.git` / `node_modules` 不进；
 *   - 用户排除目录**一个字节都不读** —— 机器判据：把排除目录里的 `.md` 放成一个**目录**，
 *     真去读会 EISDIR 进 `notes`；排除生效时 `notes` 里不该出现它。
 */
import { describe, expect, it } from 'vitest'

import { collectProjectDocs } from '../../packages/xuanshu-host/lib/shiji/docs.mjs'
import { makeSandbox, seedProject } from './lib/sandbox.mjs'

describe('票05 · 说明文档白名单（扩展名就是判据）', () => {
  it('收 README 与 docs/notes/design/designs 下的四种扩展；代码正文一律不收', () => {
    const sandbox = makeSandbox('shiji-docs')
    try {
      const root = seedProject(sandbox, 'xuan', {
        docs: {
          'README.md': '# XuanShu\n在做玄枢。',
          'AGENTS.md': '# 仓库说明\n',
          'docs/design.md': '# 设计\n',
          'doc/notes.markdown': '# 笔记\n',
          'notes/todo.txt': '待办：事记\n',
          'design/spec.rst': 'Spec\n====\n',
          'designs/draft.md': '# 草稿\n'.repeat(10),
          'src/index.ts': 'export const secret = 1\n',
          'docs/code.ts': 'const x = 1\n',
          'docs/deep/a/b/c.md': '# 太深了\n',
          '.hidden/readme.md': '# 隐藏目录\n',
          '.secret.md': '# 隐藏文件\n',
          'node_modules/pkg/README.md': '# 依赖\n',
          'docs/private/secret.md': '# 私密\n',
        },
      })
      const { docs, notes } = collectProjectDocs({ root, excludedDirs: ['docs/private'] })
      const paths = docs.map((doc) => doc.relPath)
      expect(paths).toEqual(['AGENTS.md', 'README.md', 'design/spec.rst', 'designs/draft.md', 'doc/notes.markdown', 'docs/design.md', 'notes/todo.txt'])
      // 代码正文没有一条进来（扩展名白名单就是判据，不按「内容像代码」猜）。
      expect(paths.some((path) => path.endsWith('.ts'))).toBe(false)
      // 目录/文件不存在 / 被排除时都不该有读取失败噪音。
      expect(notes).toEqual([])
      expect(docs.find((doc) => doc.relPath === 'README.md').text).toContain('在做玄枢')
    } finally {
      sandbox.cleanup()
    }
  })

  it('排除目录一个字节都不读（把里面的 .md 放成目录：真读会 EISDIR 进 notes）', () => {
    const sandbox = makeSandbox('shiji-docs-exclude')
    try {
      const root = seedProject(sandbox, 'xuan', {
        docs: { 'docs/public.md': '# 公开\n' },
      })
      // 一个「名字像文档、实际是目录」的路径：任何真去 readFile 的实现都会拿到 EISDIR。
      seedProject(sandbox, 'xuan', { docs: { 'docs/private/broken.md/inner.txt': 'x' } })
      const { docs, notes } = collectProjectDocs({ root, excludedDirs: ['docs/private'] })
      expect(docs.map((doc) => doc.relPath)).toEqual(['docs/public.md'])
      expect(notes.join('\n')).not.toMatch(/broken\.md|EISDIR|EACCES/u)
    } finally {
      sandbox.cleanup()
    }
  })

  it('上限：单份 ≤4000 字、整项目 ≤8 份（按路径字典序取前 8，并如实记一条 note）', () => {
    const sandbox = makeSandbox('shiji-docs-limits')
    try {
      const fileMap = { 'README.md': '甲'.repeat(4500) }
      for (let index = 0; index < 10; index += 1) fileMap[`docs/doc-${String(index).padStart(2, '0')}.md`] = `# ${index}\n`
      const root = seedProject(sandbox, 'xuan', { docs: fileMap })
      const { docs, notes } = collectProjectDocs({ root })
      expect(docs).toHaveLength(8)
      expect(docs[0].relPath).toBe('README.md')
      expect(docs[0].text).toHaveLength(4000)
      expect(notes.join('\n')).toMatch(/只取前 8 份/u)
      // 尺寸取真实 stat（指纹依赖它，不许编）。
      expect(docs[0].size).toBeGreaterThan(4000)
    } finally {
      sandbox.cleanup()
    }
  })

  it('项目目录不存在 / 不是目录 → 空列表 + 可读 note（不抛）', () => {
    const sandbox = makeSandbox('shiji-docs-missing')
    try {
      const missing = sandbox.rootPath('projects', 'nope')
      expect(collectProjectDocs({ root: missing })).toEqual({ docs: [], notes: [expect.stringMatching(/项目目录/u)] })
    } finally {
      sandbox.cleanup()
    }
  })
})
