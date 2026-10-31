/**
 * `tests/ux/lib/temp-git.mjs` —— 修复通道用例的临时 git 仓库夹具（票 10 / #57）。
 *
 * 为什么每个用例都造一个临时仓库：三项检查（修复说明 / 转绿 / 写入面）只有两种硬度——
 * 要么能在**不依赖主仓历史**的前提下被证伪，要么它只是把主仓当下的样子拍成了快照。
 * BRIEF-57 的硬约束也是这条：`mkdtempSync` + `git init` + 空提交，用完即删。
 *
 * 仓库配置一律在夹具里钉死（`user.*`、`commit.gpgsign=false`、`core.autocrlf=false`）：
 * 用例不该随开发机的全局 git 配置变红或变绿——尤其是 autocrlf，它会让「同一份文件」
 * 在不同机器上算出不同字节。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * 跑一条 git 命令（失败直接抛：夹具里的 git 失败是测试自身坏了，不该被当成被测行为）。
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string} stdout
 */
export function runGit(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败（exit ${result.status}）：${result.stderr}`)
  }
  return result.stdout
}

/**
 * 造一个已初始化、已配好身份的空仓库。
 *
 * `realpathSync.native` 把 CI 的 8.3 短名展开成长名：git 输出的路径是长名，
 * 比较前先统一，否则本地绿、CI 红（`tests/lib/worktree-create.test.mjs` 实测踩过）。
 *
 * @returns {{
 *   root: string,
 *   git: (args: string[]) => string,
 *   write: (relativePath: string, content: string) => string,
 *   stage: (relativePath: string, options?: {force?: boolean}) => void,
 *   commit: (message: string) => string,
 *   commitAll: (message: string) => string,
 *   headSha: () => string,
 *   remove: () => void,
 * }}
 */
export function createTempRepo() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ux-repair-')))
  const git = (args) => runGit(root, args)
  git(['init', '-q'])
  git(['config', 'user.email', 'ux-repair@test.invalid'])
  git(['config', 'user.name', 'ux repair test'])
  git(['config', 'commit.gpgsign', 'false'])
  git(['config', 'core.autocrlf', 'false'])

  return {
    root,
    git,
    write(relativePath, content) {
      const absolute = join(root, ...relativePath.split('/'))
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, content, 'utf8')
      return relativePath
    },
    stage(relativePath, { force = false } = {}) {
      git(['add', ...(force ? ['-f'] : []), '--', relativePath])
    },
    commit(message) {
      // `-m` 传整段（含换行）而不是 `-F`：不需要额外临时文件，提交正文原样进历史。
      git(['commit', '-q', '-m', message])
      return git(['rev-parse', 'HEAD']).trim()
    },
    commitAll(message) {
      git(['add', '-A'])
      return this.commit(message)
    },
    headSha() {
      return git(['rev-parse', 'HEAD']).trim()
    },
    remove() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}
