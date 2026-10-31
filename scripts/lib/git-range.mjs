/**
 * `scripts/lib/git-range.mjs` —— 修复通道两条检查共用的 git 读面（票 10 / #57）。
 *
 * 为什么单独一层：`check-ux-fix-notes.mjs`（修复说明）与 `check-ux-authority.mjs`（写入面）
 * 问的是同一类事实——「这一段提交里，每个提交改了什么、说了什么」——只是判据不同。
 * 把调用 git 的细节收在一处，两个检查各写各的判据；用例也只需要造一种临时仓库夹具
 * （`mkdtempSync` + `git init`），不依赖主仓历史（BRIEF-57 硬约束）。
 *
 * 口径：
 *   - 路径一律 posix 形式（git 在 Windows 上也输出 `/`），与仓库里其它清单的写法一致；
 *   - 读提交一律**按提交自己的 diff 读**（与首父对比）：检查的对象是历史，不是眼前的工作区；
 *     合并提交同样按首父对比 —— 这样「这次合并把什么带进来」是可核对的，而不会把整棵父树
 *     都算成这次改动；
 *   - 提交信息里的 CRLF 归一成 LF：同一份提交信息在 Windows / POSIX 上必须解析出同样的结果，
 *     否则「机器可读」只在一台机器上成立。
 *
 * 只用 Node 内置模块；不读时钟、不写仓库。
 */
import { spawnSync } from 'node:child_process'

/** git 没跑成（不是「检查红了」）：调用方按「工具没跑成」退出，与判据红分开。 */
export class GitRangeError extends Error {
  /**
   * @param {string} message
   * @param {{args?: string[], status?: number|null, stderr?: string}} [meta]
   */
  constructor(message, { args = [], status = null, stderr = '' } = {}) {
    super(message)
    this.name = 'GitRangeError'
    this.args = args
    this.status = status
    this.stderr = stderr
  }
}

/**
 * 跑一条 git 命令（不抛错：调用点自己判 status）。
 *
 * 为什么返回 `{status, stdout, stderr}` 而不是 `spawnSync` 的原始对象：调用方只关心这三样，
 * 而 `spawnSync` 的 `error` / `signal` 混在同一个对象里，容易写成「没输出就当空」。
 *
 * @param {string[]} args
 * @param {{cwd: string}} options
 * @returns {{status: number|null, stdout: string, stderr: string}}
 */
function git(args, { cwd }) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error !== undefined && result.error !== null) {
    throw new GitRangeError(`git 起不来（${result.error.message}）：先确认 PATH 里有 git`, { args })
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/**
 * 跑一条「必须成功」的 git 命令；失败抛 `GitRangeError`，消息里带 `what` 与 stderr 尾巴。
 *
 * @param {string[]} args
 * @param {{cwd: string, what: string}} options
 * @returns {string}
 */
function gitText(args, { cwd, what }) {
  const result = git(args, { cwd })
  if (result.status !== 0) {
    throw new GitRangeError(`${what} 失败（git ${args.join(' ')}，exit ${result.status}）：${result.stderr.trim()}`, {
      args,
      status: result.status,
      stderr: result.stderr,
    })
  }
  return result.stdout
}

/**
 * 把 `--repo` 指到的目录解析成**仓库根**。
 *
 * 为什么不直接用传入的目录：临时仓库夹具常把 `--repo` 指向子目录；检查里的路径比较
 * （`packages/xuanshu-client/**`）都相对仓库根，先统一才比较得动。
 *
 * @param {{cwd: string}} options
 * @returns {string}
 * @throws {GitRangeError} 目录不是 git 仓库
 */
export function resolveRepoRoot({ cwd }) {
  return gitText(['rev-parse', '--show-toplevel'], { cwd, what: `把 ${cwd} 解析成 git 仓库根` }).trim()
}

/** 提交信息的可读短名（报告里点名用）。 */
export function shortSha(sha) {
  return typeof sha === 'string' ? sha.slice(0, 7) : String(sha)
}

/**
 * 读一个提交的元数据。`%P` 给父提交、`%s` 给主题、`%B` 给完整正文（含主题行）。
 * 三个字段用 NUL 分隔：提交正文里可以出现任何字符，只有 NUL 不会。
 *
 * @param {{repoRoot: string, sha: string}} input
 * @returns {{sha: string, parents: string[], subject: string, message: string}}
 */
function readCommitMeta({ repoRoot, sha }) {
  const raw = gitText(['show', '-s', '--format=%P%x00%s%x00%B', sha], { cwd: repoRoot, what: `读提交 ${sha} 的元数据` })
  const [parentsRaw, subject, ...messageParts] = raw.replace(/\r\n/g, '\n').split('\u0000')
  const parents = (parentsRaw ?? '').trim() === '' ? [] : parentsRaw.trim().split(' ').filter(Boolean)
  return {
    sha,
    parents,
    subject: (subject ?? '').trim(),
    // `%B` 末尾总带一个换行；去掉它，让「提交正文」在测试与解析里是确定的字符串。
    message: messageParts.join('\u0000').replace(/\r\n/g, '\n').replace(/\n+$/u, ''),
  }
}

/**
 * 列出一段范围里的提交（时间顺序，旧 → 新；报告从上往下读就是修复的顺序）。
 *
 * `since` 既可以是单个 ref（解释为 `<ref>..HEAD`），也可以直接给 `<a>..<b>`：
 * 前者是日常用法，后者让用例可以钉住任意区间。
 *
 * @param {{repoRoot: string, since: string}} input
 * @returns {{sha: string, parents: string[], subject: string, message: string}[]}
 * @throws {GitRangeError} ref 认不出 / 不是 git 仓库
 */
export function listCommits({ repoRoot, since }) {
  const range = since.includes('..') ? since : `${since}..HEAD`
  const shas = gitText(['rev-list', '--reverse', range], { cwd: repoRoot, what: `读提交范围 ${range}` })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return shas.map((sha) => readCommitMeta({ repoRoot, sha }))
}

/**
 * 一个提交相对**首父**改了哪些文件（根提交相对空树）。
 *
 * 为什么是首父而不是「所有父」：合并提交的「带进来了什么」正是首父对比的结果；
 * 对首父逐个对比会把另一条分支的整段历史重复算进这个合并提交。
 *
 * @param {{repoRoot: string, commit: {sha: string, parents: string[]}}} input
 * @returns {string[]} 仓库相对 posix 路径
 */
export function commitPaths({ repoRoot, commit }) {
  const args = commit.parents.length > 0
    ? ['diff', '--name-only', '--no-renames', '-z', commit.parents[0], commit.sha]
    : ['show', '--pretty=format:', '--name-only', '--no-renames', '-z', commit.sha]
  const output = gitText(args, { cwd: repoRoot, what: `读提交 ${shortSha(commit.sha)} 改动的文件` })
  return output
    .split('\u0000')
    .map((path) => path.trim())
    .filter((path) => path !== '')
}

/**
 * 读某个提交里的文件内容（LF 归一）。文件在该提交里不存在 / 被删 → `null`：
 * 「读不到」与「读到了空文件」必须分得开，否则签名检查会把删文件当成空签字放过。
 *
 * @param {{repoRoot: string, sha: string, path: string}} input
 * @returns {string|null}
 */
export function readBlobAt({ repoRoot, sha, path }) {
  const result = git(['show', `${sha}:${path}`], { cwd: repoRoot })
  if (result.status !== 0) return null
  return result.stdout.replace(/\r\n/g, '\n')
}

/**
 * 已跟踪文件清单（NUL 分隔，路径不会被引号包起来）。
 *
 * @param {{repoRoot: string, prefix: string}} input
 * @returns {string[]}
 */
export function trackedPaths({ repoRoot, prefix }) {
  const output = gitText(['ls-files', '-z', '--', prefix], { cwd: repoRoot, what: `读已跟踪文件 ${prefix}` })
  return output.split('\u0000').filter((path) => path !== '')
}
