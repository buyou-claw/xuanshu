/**
 * `tests/ux/fix-notes.test.mjs` —— 修复说明门槛（spec 003 §修复通道 20 · 票 10 / #57）。
 *
 * 钉住四件事：
 *   1. **缺说明 → 红**：动了 `packages/xuanshu-client/**` 的提交没有 `UX-FIX:` 行时退出码 1，
 *      并点名提交（短 sha + 主题）与缺说明的文件；
 *   2. **例外**：不含客户端改动的提交（文档票 / 测试票）不被拦；
 *   3. **说明必须机器可读且指向真实判据**：解析是确定性的（三列、file:line），
 *      判据 id 不在判据集里时同样红——否则「修好了 T-999」只是一句话；
 *   4. **合并提交不重复要说明**：内容提交各自带说明，合并提交再要一份只会训练人写假说明。
 *
 * 全部用例在临时 git 仓库里跑（`tests/ux/lib/temp-git.mjs`），不依赖主仓历史，
 * 也不在主仓造脏提交（BRIEF-57 硬约束）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkFixNotes, parseFixNotes } from '../../scripts/check-ux-fix-notes.mjs'
import { createTempRepo } from './lib/temp-git.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-ux-fix-notes.mjs')
const CLIENT_FILE = 'packages/xuanshu-client/src/client/panel-title.ts'
const SIDE_FILE = 'packages/xuanshu-client/src/client/side.ts'

/** 判据集夹具：检查只读 `criteria[].id`，所以给一份最小但形状真实的投影产物。 */
const CRITERIA = {
  schema: 'xuanshu/ux-criteria@1',
  label: 'ux-v1',
  families: [],
  criteria: [{ id: 'T-001' }, { id: 'S-001' }, { id: 'X-001' }],
  version: '0'.repeat(64),
  ruleFiles: [],
}

const made = []
afterEach(() => {
  while (made.length > 0) made.pop().remove()
})

/** 跑被测命令：cwd 留在主仓，仓库位置一律走 `--repo`（脚本不许依赖「我在哪」）。 */
function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8' })
}

/** 造一个已提交初始状态的临时仓库：判据集 + 一个客户端源文件 + 一份文档。 */
function fixture() {
  const repo = createTempRepo()
  made.push(repo)
  repo.write('docs/design/ui-v1/criteria/criteria.json', `${JSON.stringify(CRITERIA, null, 2)}\n`)
  repo.write(CLIENT_FILE, 'export const titleSize = 14\n')
  repo.write('docs/notes.md', '# 说明\n')
  const base = repo.commitAll('init：临时仓库初始状态')
  return { repo, base }
}

/** 把一行修复说明拼进提交正文。 */
function withNotes(subject, ...notes) {
  return `${subject}\n\n${notes.join('\n')}`
}

describe('票 10 · 修复说明：缺说明被拦（红）', () => {
  it('动了客户端却没有 UX-FIX 行 → 退出码 1，点名提交与缺说明的文件', () => {
    const { repo, base } = fixture()
    repo.write(CLIENT_FILE, 'export const titleSize = 16\n')
    const sha = repo.commitAll('把面板标题改到 16px')

    const result = runCli(['--repo', repo.root, '--since', base])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('缺修复说明')
    expect(result.stderr).toContain(sha.slice(0, 7))
    expect(result.stderr).toContain('把面板标题改到 16px')
    expect(result.stderr).toContain('panel-title.ts')
    expect(result.stderr).toContain('UX-FIX:')
  })

  it('说明不完整（只有两列）→ 退出码 1，并点名是哪条判据的说明', () => {
    const { repo, base } = fixture()
    repo.write(CLIENT_FILE, 'export const titleSize = 16\n')
    repo.commitAll(withNotes('把面板标题改到 16px', 'UX-FIX: T-001 | 标题字号改用 16px'))

    const result = runCli(['--repo', repo.root, '--since', base])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('T-001')
    expect(result.stderr).toContain('三列没给全')
  })

  it('证据不是 file:line（或行号 ≤ 0）→ 退出码 1，并点名判据', () => {
    const { repo, base } = fixture()
    repo.write(CLIENT_FILE, 'export const titleSize = 16\n')
    repo.commitAll(withNotes('把面板标题改到 16px', `UX-FIX: T-001 | 改了什么 | ${CLIENT_FILE}`))

    const result = runCli(['--repo', repo.root, '--since', base])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('证据必须是仓库相对的 file:line')
    expect(result.stderr).toContain('T-001')
  })

  it('指向判据集里没有的 id → 退出码 1（判据集是 id 的唯一来源）', () => {
    const { repo, base } = fixture()
    repo.write(CLIENT_FILE, 'export const titleSize = 16\n')
    repo.commitAll(withNotes('把面板标题改到 16px', `UX-FIX: Z-999 | 自己发明的判据 | ${CLIENT_FILE}:1`))

    const result = runCli(['--repo', repo.root, '--since', base])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Z-999')
    expect(result.stderr).toContain('不存在的判据')
  })
})

describe('票 10 · 修复说明：带说明即放行（绿）', () => {
  it('一条合规说明 → 退出码 0，并如实报出检查了几个客户端提交', () => {
    const { repo, base } = fixture()
    repo.write(CLIENT_FILE, 'export const titleSize = 16\n')
    repo.commitAll(withNotes('把面板标题改到 16px', `UX-FIX: T-001 | 标题字号改用正文档 16px | ${CLIENT_FILE}:1`))

    const result = runCli(['--repo', repo.root, '--since', base])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('✅ 通过')
    expect(result.stdout).toContain('1 个')
  })

  it('一个提交可以写多条说明（一次修多条判据），解析结果稳定可读', () => {
    const { repo, base } = fixture()
    repo.write(CLIENT_FILE, 'export const titleSize = 16\n')
    const sha = repo.commitAll(
      withNotes(
        '一次修两条判据',
        `UX-FIX: T-001 | 标题字号换档 | ${CLIENT_FILE}:1`,
        `UX-FIX: S-001 | 补空态文案 | ${CLIENT_FILE}:1`,
      ),
    )

    const result = runCli(['--repo', repo.root, '--since', base])
    expect(result.status).toBe(0)

    const checked = checkFixNotes({ repoRoot: repo.root, since: base, criteriaIds: new Set(['T-001', 'S-001', 'X-001']) })
    expect(checked.violations).toEqual([])
    expect(checked.notes).toBe(2)
    expect(checked.clientCommits).toBe(1)
    expect(checked.commits).toBe(1)
    // 库调用与 CLI 同一判据：说明不是「有」就算，还要解析得出（CLI 用同一个 checkFixNotes）。
    expect(sha).toMatch(/^[0-9a-f]{40}$/u)
  })

  it('不含 packages/xuanshu-client/** 的提交不拦（文档票 / 测试票不被误伤）', () => {
    const { repo, base } = fixture()
    repo.write('docs/notes.md', '# 说明（补一段）\n')
    repo.commitAll('补一段文档')

    const result = runCli(['--repo', repo.root, '--since', base])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('动了 packages/xuanshu-client/** 的 0 个')
  })
})

describe('票 10 · 修复说明：合并提交不重复要说明', () => {
  it('两条分支各自带说明，合并提交本身没有 UX-FIX 也放行', () => {
    const { repo, base } = fixture()
    const mainBranch = repo.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()

    repo.git(['checkout', '-q', '-b', 'side'])
    repo.write(SIDE_FILE, 'export const side = 1\n')
    repo.commitAll(withNotes('侧栏标题换档', `UX-FIX: T-001 | 侧栏标题换档 | ${SIDE_FILE}:1`))

    repo.git(['checkout', '-q', mainBranch])
    repo.write(CLIENT_FILE, 'export const titleSize = 16\n')
    repo.commitAll(withNotes('主面板标题换档', `UX-FIX: T-001 | 主面板标题换档 | ${CLIENT_FILE}:1`))

    repo.git(['merge', '--no-edit', 'side'])
    expect(repo.git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ').length).toBe(3) // 合并提交真有两条父

    const result = runCli(['--repo', repo.root, '--since', base])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('合并提交跳过 1 个')
    expect(result.stdout).toContain('动了 packages/xuanshu-client/** 的 2 个')
  })
})

describe('票 10 · 修复说明：解析器（机器可读的那一半）', () => {
  it('合法行按三列解析；坏行进 problems，不静默丢掉', () => {
    const message = [
      'UX-FIX: T-001 | 标题字号换档 | packages/xuanshu-client/src/a.ts:3',
      'UX-FIX: S-001 | 补空态 | packages/xuanshu-client/src/b.ts:0',
      'UX-FIX: 没有id | 说明 | c.ts:1',
      '不是说明的行（不该被解析）',
    ].join('\n')

    const { notes, problems } = parseFixNotes(message)
    expect(notes).toEqual([
      {
        criterionId: 'T-001',
        summary: '标题字号换档',
        file: 'packages/xuanshu-client/src/a.ts',
        line: 3,
        raw: 'UX-FIX: T-001 | 标题字号换档 | packages/xuanshu-client/src/a.ts:3',
      },
    ])
    expect(problems.map((problem) => problem.reason)).toEqual(['bad-evidence', 'no-id'])
    expect(problems[0].criterionId).toBe('S-001')
    expect(problems[1].criterionId).toBeNull()
  })

  it('「改了什么」里可以出现竖线（按列切再拼回），证据仍取最后一列', () => {
    const { notes, problems } = parseFixNotes('UX-FIX: T-001 | 前 | 后 | src/a.ts:9')
    expect(problems).toEqual([])
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ summary: '前 | 后', file: 'src/a.ts', line: 9 })
  })

  it('绝对路径不算证据（证据要能在仓库里找到）', () => {
    const { problems } = parseFixNotes('UX-FIX: T-001 | 改了什么 | C:\\repo\\a.ts:1')
    expect(problems).toHaveLength(1)
    expect(problems[0].reason).toBe('bad-evidence')
  })
})

describe('票 10 · 修复说明：工具没跑成与「判据红」分开', () => {
  it('--repo 指向不是 git 仓库的目录 → 退出码 2，说清检查没跑成', () => {
    const plain = mkdtempSync(join(tmpdir(), 'ux-fix-notes-norepo-'))
    try {
      const result = runCli(['--repo', plain, '--since', 'HEAD~1'])
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('检查没跑成')
      expect(existsSync(join(plain, '.git'))).toBe(false)
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })

  it('--help 立出说明形状与「合并提交跳过」的口径', () => {
    const help = runCli(['--help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('UX-FIX: <判据 id> | <改了什么> | <证据 file:line>')
    expect(help.stdout).toContain('合并提交跳过')
    expect(help.stdout).toContain('1 =')
  })
})
