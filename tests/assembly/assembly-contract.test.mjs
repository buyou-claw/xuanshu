/**
 * 装配契约测试（票 01 的验收面）。
 *
 * 同一套断言不重复实现：这里只跑 `scripts/verify-assembly.mjs --json` 一次，然后逐个 seam 断言
 * 它的结果。CLI 与测试因此永远同源——CLI 绿 ⇒ 测试绿，CLI 红 ⇒ 测试红（并打印它给的具体漂移项）。
 *
 * 环境门（不许假绿）：
 *   - profile 已安装 → S1~S5 全部真跑真断言；
 *   - 未安装 → 显式 skip 并打印原因与修复命令；设 `XUANSHU_REQUIRE_ASSEMBLY=1` 则改为硬失败
 *     （CI / 交付前验收用这个，免得「没装 = 全绿」）。
 *   - 隔离：默认 DSH_HOME=<repo>/.dsh-home，可用 `XUANSHU_DSH_HOME` 覆盖；测试台拒绝写用户真实 ~/.dsh。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const VERIFIER = join(REPO_ROOT, 'scripts', 'verify-assembly.mjs')
const DSH_HOME = resolve(process.env.XUANSHU_DSH_HOME ?? join(REPO_ROOT, '.dsh-home'))
const PROFILE = process.env.XUANSHU_PROFILE ?? 'xuanshu'
const PROFILE_DIR = join(DSH_HOME, 'profiles', PROFILE)
const REQUIRE_INSTALL = process.env.XUANSHU_REQUIRE_ASSEMBLY === '1'
const INSTALLED = existsSync(join(PROFILE_DIR, 'package.json')) && existsSync(join(PROFILE_DIR, 'node_modules'))
const INSTALL_HINT = `node scripts/install-profile.mjs --home "${DSH_HOME}"`

const SEAMS = [
  ['s1', 'S1 装配树（dsh --dump-config-schema）'],
  ['s2', 'S2 进程内挂载（官方 loadProfile/boot，fiber.state=2）'],
  ['s3', 'S3 客户端预编译产物（静态 + 物化契约）'],
  ['s4', 'S4 漂移基线（dsh --dump-config）'],
  ['s5', 'S5 真 CLI 启动 + 装配报告'],
]

let report
let raw = ''

if (INSTALLED) {
  describe('玄枢装配契约（S1~S5）', () => {
    beforeAll(() => {
      const run = spawnSync(process.execPath, [
        VERIFIER, '--json', '--dsh-home', DSH_HOME, '--profile', PROFILE,
      ], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 })
      raw = `${run.stdout ?? ''}\n--- stderr ---\n${run.stderr ?? ''}`
      try {
        report = JSON.parse(run.stdout)
      } catch {
        report = undefined
      }
      report.exitCode = run.status
      report.spawnError = run.error?.message
    }, 660_000)

    it('测试台给出结构化结果（本身没崩）', () => {
      expect(report, `scripts/verify-assembly.mjs 没有输出可解析的 JSON：\n${raw.slice(0, 2000)}`).toBeDefined()
      expect(report.spawnError ?? null, raw.slice(0, 2000)).toBeNull()
      expect(report.error ?? null, raw.slice(0, 2000)).toBeNull()
    })

    for (const [key, title] of SEAMS) {
      it(title, () => {
        expect(report, `没有结果：\n${raw.slice(0, 2000)}`).toBeDefined()
        const check = report.checks?.[key]
        expect(check, `CLI 没跑这一项；输出：\n${raw.slice(0, 2000)}`).toBeDefined()
        expect(check.ok, `[${check.id}] ${check.detail}`).toBe(true)
      })
    }

    it('CLI 退出码为 0（五条 seam 全绿）', () => {
      expect(report?.ok, raw.slice(0, 2000)).toBe(true)
      expect(report?.exitCode, raw.slice(0, 2000)).toBe(0)
    })

    it('S4 基线不是空的、且来自真实安装的 DSH 包', () => {
      const baseline = report?.baseline
      expect(baseline?.exists, '漂移基线不存在：先跑 node scripts/verify-assembly.mjs --write-baseline').toBe(true)
      expect(baseline.rows).toBeGreaterThan(0)
      for (const source of baseline.sources ?? []) {
        expect(source.layer.startsWith('@deepseek-ai/'), `基线的层不是 DSH 包：${source.layer}`).toBe(true)
        expect(source.rows, `层 ${source.layer} 一行都没提到`).toBeGreaterThan(0)
      }
    })
  })
} else if (REQUIRE_INSTALL) {
  describe('玄枢装配契约（强制模式）', () => {
    it('profile 必须已安装（XUANSHU_REQUIRE_ASSEMBLY=1）', () => {
      expect.fail(`profile "${PROFILE}" 未安装在 ${PROFILE_DIR}；先跑：${INSTALL_HINT}`)
    })
  })
} else {
  // 显式 skip + 说明原因：绝不让「没装」看起来像「契约成立」。
  console.warn(
    `\n⚠️  玄枢装配契约测试 SKIPPED：profile "${PROFILE}" 未安装在 ${PROFILE_DIR}\n`
    + `   先安装：${INSTALL_HINT}\n`
    + '   交付/CI 校验请设 XUANSHU_REQUIRE_ASSEMBLY=1，让「没装」变成硬失败。\n',
  )
  describe.skip(`玄枢装配契约（SKIPPED：profile 未安装，见上面的原因；${INSTALL_HINT}）`, () => {
    it('未安装时不做任何断言', () => {})
  })
}
