/**
 * tests/lib/worktree-create.test.mjs —— `scripts/worktree-create.mjs` 的判据台。
 *
 * 为什么要有这条脚本（E1 / #42）：实现者起工作树靠手工记忆——`git worktree add` 之后还要记得
 * 把主仓根 `node_modules` 与各 `packages/<pkg>/node_modules` 链进来（不链就 build/测试起不来），
 * 而链多了又踩上 2026-10-17 的事故：`git worktree remove` 跟穿 junction 清空主仓依赖
 * （`docs/development-status.md` §16.4 第 7 条）。这条命令把「建 + 链 + 可复制进入方式」收成一条，
 * 并把「只链不复制、绝不写链接目标」当硬语义。
 *
 * 断言面 = **外部可观察物**：进程退出码 / stdout / 新工作树里的链接与文件 / 目标里的哨兵文件 /
 * 目标仓库根目录的变化。不在真实仓库建 worktree、不联网、不安装任何包。
 *
 * 环境：临时 git 仓库（`os.tmpdir()`，`--repo` 指向它）。临时目录名**故意带空格**，
 * 顺手钉住「路径带空格时 Windows junction 不被打断」。**实测范围**：本机/CI 只实测 Windows
 * junction；POSIX `symlinkSync` 分支本机未实测（`scripts/worktree-create.mjs` 的注释已如实标注）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { isLink, removeLinks } from '../../scripts/lib/cleanup-junctions.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(REPO_ROOT, 'scripts', 'worktree-create.mjs')
const WORKTREES = ['.scratch', 'worktrees']

const made = []

/** 临时 git 仓库：根与 packages/a 有 node_modules（带哨兵）；packages/b 没有（应被跳过）。 */
function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'wt create-'))
  made.push(repo)
  runGit(repo, ['init', '-q'])
  runGit(repo, ['config', 'user.email', 'worktree-create@test.invalid'])
  runGit(repo, ['config', 'user.name', 'worktree-create test'])
  runGit(repo, ['config', 'commit.gpgsign', 'false'])
  // 检出内容逐字比对（--base 用例）：别让机器全局的 autocrlf 改行尾。
  runGit(repo, ['config', 'core.autocrlf', 'false'])
  writeFileSync(join(repo, 'README.md'), '# temp repo\n', 'utf8')
  mkdirSync(join(repo, 'node_modules'), { recursive: true })
  writeFileSync(join(repo, 'node_modules', 'sentinel.txt'), 'root-alive', 'utf8')
  for (const name of ['a', 'b']) {
    mkdirSync(join(repo, 'packages', name), { recursive: true })
    writeFileSync(join(repo, 'packages', name, 'package.json'), JSON.stringify({ name }), 'utf8')
  }
  mkdirSync(join(repo, 'packages', 'a', 'node_modules'), { recursive: true })
  writeFileSync(join(repo, 'packages', 'a', 'node_modules', 'sentinel.txt'), 'pkg-alive', 'utf8')
  runGit(repo, ['add', 'README.md', 'packages/a/package.json', 'packages/b/package.json'])
  runGit(repo, ['commit', '-q', '-m', 'init'])
  return repo
}

function runGit(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${result.stdout}${result.stderr}`)
  return result.stdout
}

function branchExists(repo, branch) {
  return spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { encoding: 'utf8' }).status === 0
}

function worktreeList(repo) {
  return runGit(repo, ['worktree', 'list', '--porcelain'])
}

/** 跑被测命令（cwd 故意留在临时仓库外：脚本不许依赖「我在哪个目录」；env 用于注入外部命令失败）。 */
function runCli(args, { env = {} } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
}

/** 链接建得成、且指向正确目标（读目标里的哨兵）才算就位。 */
function expectLink(worktree, relative, expected) {
  const link = join(worktree, ...relative.split('/'))
  expect(isLink(link), `${relative} 不是 junction/symlink`).toBe(true)
  expect(readFileSync(join(link, 'sentinel.txt'), 'utf8'), `${relative} 指错目标`).toBe(expected)
}

/** 先摘链接再递归删（测试自己也不能跟穿 junction）。 */
function removeTree(dir) {
  try {
    removeLinks(dir)
  } catch {
    /* 临时目录，摘不掉也别拖垮用例 */
  }
  rmSync(dir, { recursive: true, force: true })
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    try {
      removeTree(dir)
    } catch {
      /* 临时目录，尽力而为 */
    }
  }
})

describe('worktree-create：一条命令建工作树（临时仓库端到端）', () => {
  it('建成功：worktree + 分支 + 根/包级链接就位，目标哨兵仍在，打印可复制的进入方式', () => {
    const repo = makeRepo()
    const before = readdirSync(repo).sort()
    const headBefore = runGit(repo, ['rev-parse', 'HEAD']).trim()
    const worktree = join(repo, ...WORKTREES, 'wt-ok')

    const result = runCli(['wt-ok', '--repo', repo])

    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)
    // 工作树真的按 base 检出（分支 = fix/<name>，默认从当前 HEAD）。
    expect(existsSync(join(worktree, 'README.md'))).toBe(true)
    expect(branchExists(repo, 'fix/wt-ok')).toBe(true)
    // 默认 base = 当前 HEAD（在集成分支上执行即集成分支 tip）。
    expect(runGit(repo, ['rev-parse', 'fix/wt-ok']).trim()).toBe(headBefore)
    expect(worktreeList(repo)).toContain(worktree.replaceAll('\\', '/'))
    // 依赖链接就位：根 + 已存在的包级；不存在的目标跳过。
    expectLink(worktree, 'node_modules', 'root-alive')
    expectLink(worktree, 'packages/a/node_modules', 'pkg-alive')
    expect(existsSync(join(worktree, 'packages', 'b', 'node_modules'))).toBe(false)
    // 只说一条可复制的进入方式（路径 + 分支）。
    expect(result.stdout).toContain('fix/wt-ok')
    expect(result.stdout).toContain(`cd "${worktree}"`)
    // 目标一个字节都不许少：哨兵还在。
    expect(readFileSync(join(repo, 'node_modules', 'sentinel.txt'), 'utf8')).toBe('root-alive')
    expect(readFileSync(join(repo, 'packages', 'a', 'node_modules', 'sentinel.txt'), 'utf8')).toBe('pkg-alive')
    // 只动了 `.scratch`（工作树目录），没在仓库别处落东西。
    expect(readdirSync(repo).sort().filter((name) => !before.includes(name))).toEqual(['.scratch'])
  })

  it('摘掉链接后删除工作树：目标依赖与哨兵仍在（生命周期闭环）', () => {
    const repo = makeRepo()
    const worktree = join(repo, ...WORKTREES, 'wt-lifecycle')
    const result = runCli(['wt-lifecycle', '--repo', repo])
    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)
    expect(isLink(join(worktree, 'node_modules'))).toBe(true)

    // 清理侧（本票不实现、只复用已有护栏）：先摘链接，再交给 git。
    removeLinks(worktree)
    expect(existsSync(join(worktree, 'node_modules'))).toBe(false)
    runGit(repo, ['worktree', 'remove', '--force', worktree])

    expect(existsSync(worktree)).toBe(false)
    expect(readFileSync(join(repo, 'node_modules', 'sentinel.txt'), 'utf8')).toBe('root-alive')
    expect(readFileSync(join(repo, 'packages', 'a', 'node_modules', 'sentinel.txt'), 'utf8')).toBe('pkg-alive')
  })
  it('--base / --branch 生效：工作树检出指定提交，分支用给定名字', () => {
    const repo = makeRepo()
    const firstSha = runGit(repo, ['rev-parse', 'HEAD']).trim()
    // 第二个提交把 README 改掉：--base 指第一个提交时，工作树里必须是第一个提交的内容。
    writeFileSync(join(repo, 'README.md'), '# second commit\n', 'utf8')
    runGit(repo, ['add', 'README.md'])
    runGit(repo, ['commit', '-q', '-m', 'second'])

    const result = runCli(['wt-flags', '--repo', repo, '--base', firstSha, '--branch', 'feat/custom'])

    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)
    const worktree = join(repo, ...WORKTREES, 'wt-flags')
    expect(readFileSync(join(worktree, 'README.md'), 'utf8')).toBe('# temp repo\n')
    expect(branchExists(repo, 'feat/custom')).toBe(true)
    expect(branchExists(repo, 'fix/wt-flags')).toBe(false)
    expect(result.stdout).toContain('feat/custom')
    expectLink(worktree, 'node_modules', 'root-alive')
  })
})

describe('worktree-create：拒绝时现场零改动', () => {
  it('worktree 目录已存在 → 可读拒绝；目录内容、分支、依赖目标都不动', () => {
    const repo = makeRepo()
    const worktree = join(repo, ...WORKTREES, 'wt-exists')
    mkdirSync(worktree, { recursive: true })
    writeFileSync(join(worktree, 'keep.txt'), 'keep', 'utf8')
    const treesBefore = worktreeList(repo)

    const result = runCli(['wt-exists', '--repo', repo])

    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(1)
    expect(`${result.stdout}\n${result.stderr}`).toContain('已存在')
    expect(readFileSync(join(worktree, 'keep.txt'), 'utf8')).toBe('keep')
    expect(branchExists(repo, 'fix/wt-exists')).toBe(false)
    expect(worktreeList(repo)).toBe(treesBefore)
    expect(readFileSync(join(repo, 'node_modules', 'sentinel.txt'), 'utf8')).toBe('root-alive')
  })

  it('分支已存在 → 可读拒绝；不建工作树、不给分支换指向', () => {
    const repo = makeRepo()
    runGit(repo, ['branch', 'fix/wt-branch'])
    const branchHead = runGit(repo, ['rev-parse', 'fix/wt-branch']).trim()
    const treesBefore = worktreeList(repo)

    const result = runCli(['wt-branch', '--repo', repo])

    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(1)
    const output = `${result.stdout}\n${result.stderr}`
    expect(output).toContain('分支')
    expect(output).toContain('fix/wt-branch')
    expect(output).toContain('已存在')
    expect(existsSync(join(repo, ...WORKTREES, 'wt-branch'))).toBe(false)
    expect(worktreeList(repo)).toBe(treesBefore)
    expect(runGit(repo, ['rev-parse', 'fix/wt-branch']).trim()).toBe(branchHead)
  })

  it('名字带路径分隔符 / `..` → 拒绝，不在 `.scratch/worktrees` 之外落任何东西', () => {
    const repo = makeRepo()
    const before = readdirSync(repo).sort()
    for (const name of ['../escape', 'sub/dir', '..', '.']) {
      const result = runCli([name, '--repo', repo])
      expect(result.status, `名字「${name}」应被拒绝：${result.stdout}${result.stderr}`).toBe(1)
      expect(`${result.stdout}\n${result.stderr}`).toContain('名字')
    }
    expect(readFileSync(join(repo, 'node_modules', 'sentinel.txt'), 'utf8')).toBe('root-alive')
    expect(existsSync(join(repo, 'escape'))).toBe(false)
    expect(readdirSync(repo).sort()).toEqual(before) // 连 .scratch 都没建
  })

  it('外部命令失败（git worktree add 失败）→ exit 2，与用法/环境拒绝（1）分得开', () => {
    const repo = makeRepo()
    // GIT_INDEX_FILE 指向不存在的目录：rev-parse / check-ref-format / show-ref 都不碰索引，
    // 前置拒绝全过；到 `git worktree add` 写索引时才失败 —— 正好走「外部命令失败」那一支。
    const result = runCli(['wt-fail', '--repo', repo], {
      env: { GIT_INDEX_FILE: join(repo, 'no-such-dir', 'index') },
    })
    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(2)
    expect(`${result.stdout}\n${result.stderr}`).toContain('git worktree add 失败')
  })
})

describe('worktree-create：--dry-run 只打印计划', () => {
  it('不建目录、不改 git，但打印将建的工作树/分支与将链的依赖', () => {
    const repo = makeRepo()
    const before = readdirSync(repo).sort()
    const treesBefore = worktreeList(repo)
    const worktree = join(repo, ...WORKTREES, 'wt-plan')

    const result = runCli(['wt-plan', '--repo', repo, '--dry-run'])

    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)
    const output = `${result.stdout}\n${result.stderr}`
    expect(output).toContain('dry-run')
    expect(output).toContain(worktree) // 计划里写清将建在哪
    expect(output).toContain('fix/wt-plan')
    expect(output).toContain('node_modules') // 将链的依赖在计划里可见
    // 一个字节都不落盘，git 也不动。
    expect(existsSync(join(repo, '.scratch'))).toBe(false)
    expect(branchExists(repo, 'fix/wt-plan')).toBe(false)
    expect(worktreeList(repo)).toBe(treesBefore)
    expect(readdirSync(repo).sort()).toEqual(before)
    // dry-run 不给出可执行的进入方式（那条路径还不存在）。
    expect(output).not.toContain('cd "')
  })
})
