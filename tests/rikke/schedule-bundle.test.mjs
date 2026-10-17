/**
 * 票 13 · schedule bundle 前置（契约 §0）
 *
 * 判据就是契约写的那条：**`--dump-config` 里能看到 `id: schedule`**（外加同 bundle 的
 * `time-context` / `ui-schedule`）。为什么值得一条测试：`ctx.schedule` 不在 shipped 组合里，
 * 缺了它 `ctx.schedule` 是 `undefined` 而 boot **不报错** —— 本票最恶劣的失败形态。
 * 这条测试是「三行还在不在」的机器判据（改坏了 patch 就会红）。
 *
 * 环境门（与 `tests/assembly/assembly-contract.test.mjs` 同款）：profile 没安装就显式 skip 并打印修复命令，
 * 绝不让「没装」看起来像「装配成立」。
 *
 * **不许再往「未安装」那条分支里塞一条占位用例**（本轮评审发现）：那样会让收集到的用例数随环境变
 * （装了 1 条 / 没装 2 条），而 `scripts/check-test-inventory.mjs` 的基线是**一个数**。
 * `describe.skipIf` 已经保证「照样收集、只标跳过」——条数一致，跳过本身也在报告里看得见。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DSH_HOME = resolve(process.env.XUANSHU_DSH_HOME ?? join(REPO_ROOT, '.dsh-home'))
const PROFILE = process.env.XUANSHU_PROFILE ?? 'xuanshu'
const PROFILE_DIR = join(DSH_HOME, 'profiles', PROFILE)
const CLI_BIN = join(PROFILE_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const INSTALLED = existsSync(join(PROFILE_DIR, 'package.json')) && existsSync(CLI_BIN)
const INSTALL_HINT = `node scripts/install-profile.mjs --home "${DSH_HOME}"`

/** 契约 §0 的三行（id 与 shipped bundle 逐字一致）。 */
const SCHEDULE_ROWS = ['time-context', 'schedule', 'ui-schedule']

describe.skipIf(!INSTALLED)('票13 · schedule 三行在装配树里（契约 §0 判据）', () => {
  it('`dsh --dump-config` 里出现 time-context / schedule / ui-schedule 三个 id', () => {
    const run = spawnSync(process.execPath, [CLI_BIN, '--profile', PROFILE, '--dump-config'], {
      cwd: REPO_ROOT,
      env: { ...process.env, DSH_HOME, DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    })
    expect(run.status, `dump-config 退出码 ${run.status}：${String(run.stderr).slice(-400)}`).toBe(0)
    const rows = new Set([...String(run.stdout).matchAll(/^- id: (\S+)$/gmu)].map((match) => match[1]))
    for (const id of SCHEDULE_ROWS) {
      expect(rows.has(id), `装配树里没有 id: ${id}（schedule bundle 的三行掉了？先跑 ${INSTALL_HINT}）`).toBe(true)
    }
    // 本插件自己那一行也还在（插行不许把自己挤掉）。
    expect(rows.has('xuanshu-host')).toBe(true)
  }, 200_000)
})

if (!INSTALLED) {
  console.warn(
    `\n⚠️  schedule bundle 测试 SKIPPED：profile "${PROFILE}" 未安装在 ${PROFILE_DIR}\n   先安装：${INSTALL_HINT}\n`,
  )
}
