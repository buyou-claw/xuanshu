/**
 * scripts/setup/profile.mjs — 装配 DSH profile（票 05 契约 §4.5）。
 *
 * **只调用、不重写**：`scripts/install-profile.mjs` 是这件事的唯一实现（link/copy 两种形态、
 * 「不递归删真实目录」的安全规矩、pnpm install 的 Windows 调用姿势全在里面）。这里做三件事：
 *   1. 按 §4.5 传参：`--home <dsh-home> --profile <name> [--copy]`（link 是缺省，所以不给 `--link`）；
 *   2. 把它的 stdout/stderr 转发到**我们的 stderr**（`--json` 时 stdout 只许有报告 JSON）；
 *   3. 判「这次到底改了没有」：目标已经是指向 `<repo>/profile` 的联接且依赖已装 → `already`（幂等）。
 *
 * 幂等的依据（契约 §4.6③）：link 模式本来就是「重建联接 + 跑一次 pnpm install」，
 * pnpm install 本身幂等（已满足就秒退），所以重复执行不会破坏任何东西。
 *
 * 仅使用 Node 内置模块。ESM。
 */

import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { samePath } from '../isolation/resolve.mjs'
import { EXIT, SetupError } from './exit.mjs'
import { runCommand, tailLines } from './proc.mjs'

/** 测试注入口（契约 §10）：把 `install-profile.mjs` 换成替身，避免每个 E2E 都真跑 pnpm install。 */
export const PROFILE_BIN_ENV = 'XUANSHU_INSTALL_PROFILE_BIN'

/** pnpm install 可能是几分钟（首装/换 lockfile）；给 20 分钟，超时按安装失败处置。 */
export const PROFILE_TIMEOUT_MS = 20 * 60_000

/** 缺省装配脚本路径。 */
export function defaultProfileBin(repoRoot) {
  return join(repoRoot, 'scripts', 'install-profile.mjs')
}

/** 从环境（或显式参数）取这次要跑的装配脚本。 */
export function resolveProfileBin({ repoRoot, env = process.env } = {}) {
  const override = env?.[PROFILE_BIN_ENV]
  if (typeof override === 'string' && override.trim() !== '') return resolve(override.trim())
  return defaultProfileBin(repoRoot)
}

/** 目录联接（junction/symlink）的落点；不是联接就返回 undefined（与 install-profile.mjs 同口径的只读版）。 */
function linkTarget(path) {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return realpathSync(path)
    if (!stat.isDirectory()) return undefined
    const real = realpathSync(path)
    return samePath(real, path) ? undefined : real
  } catch {
    return undefined
  }
}

/**
 * 装配 profile。
 *
 * @returns {Promise<{ action: 'linked'|'copied'|'already', target: string, exitCode: number, durationMs: number }>}
 * @throws {SetupError} code = EXIT.install
 */
export async function installProfile({
  repoRoot, dshHome, profile, mode = 'link', env = process.env, log = () => {}, timeoutMs = PROFILE_TIMEOUT_MS,
}) {
  const bin = resolveProfileBin({ repoRoot, env })
  if (!existsSync(bin)) {
    throw new SetupError(`装配脚本不存在：${bin}（可用 ${PROFILE_BIN_ENV} 覆盖，仅测试用）`, { code: EXIT.install })
  }

  const sourceProfile = join(repoRoot, 'profile')
  const target = join(dshHome, 'profiles', profile)
  const linkedAlready = linkTarget(target) !== undefined
    && samePath(linkTarget(target), sourceProfile)
    && existsSync(join(sourceProfile, 'node_modules'))

  const args = ['--home', dshHome, '--profile', profile, ...(mode === 'copy' ? ['--copy'] : [])]
  log(`[setup] profile：${bin} ${args.join(' ')}`)

  const run = await runCommand(bin, args, { env, log, timeoutMs, label: 'install-profile' })
  if (run.error !== null || run.timedOut || run.status !== 0) {
    throw new SetupError(
      `装配 profile 失败（exit=${run.status}${run.timedOut ? '，超时' : ''}${run.error ? `，${run.error}` : ''}）`,
      {
        code: EXIT.install,
        evidence: {
          script: bin,
          args,
          exitCode: run.status,
          timedOut: run.timedOut,
          error: run.error,
          stdoutTail: tailLines(run.stdout, 6),
          stderrTail: tailLines(run.stderr, 8),
        },
        hint: [
          `# 复现：node "${bin}" --home "${dshHome}" --profile "${profile}"${mode === 'copy' ? ' --copy' : ''}`,
          '# 常见原因：pnpm 不在 PATH、profile/ 依赖装不上、目标位置被别的 profile 占着（先看它的输出）。',
        ].join('\n'),
      },
    )
  }

  const action = linkedAlready ? 'already' : (mode === 'copy' ? 'copied' : 'linked')
  log(`[setup] profile：${action} → ${target}`)
  return { action, target, exitCode: run.status, durationMs: run.durationMs }
}
