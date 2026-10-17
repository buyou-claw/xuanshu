/**
 * 装配契约测试（票 01 的验收面）。
 *
 * 同一套断言不重复实现：这里只跑 `scripts/verify-assembly.mjs --json` 一次，然后逐个 seam 断言
 * 它的结果。CLI 与测试因此永远同源——CLI 绿 ⇒ 测试绿，CLI 红 ⇒ 测试红（并打印它给的具体漂移项）。
 *
 * 环境门（不许假绿）：
 *   - profile 已安装 → S1~S5 全部真跑真断言；
 *   - 未安装 → 这 8 条**照样被收集**、逐条 skip 并打印原因与修复命令；设 `XUANSHU_REQUIRE_ASSEMBLY=1`
 *     则改为硬失败（CI / 交付前验收用这个，免得「没装 = 全绿」）。
 *   - 隔离：默认 DSH_HOME=<repo>/.dsh-home，可用 `XUANSHU_DSH_HOME` 覆盖；测试台拒绝写用户真实 ~/.dsh。
 *
 * **为什么用例条数与环境解耦**（本轮评审发现，别再改回 `if (INSTALLED) { describe(...) } else { describe.skip(1 条) }`）：
 * 那种写法在未装 profile 的机器上只收集 **1** 条（基线是 8 条），于是
 * `scripts/check-test-inventory.mjs` 判「用例变少」——**干净 CI 上必红**，红的原因却与本仓无关。
 * 「缺证据时总数不许变」这条纪律在 `tests/setup/pin.test.mjs` 已经付过一次学费（见台账 §10/§11）：
 * 缺证据 = 那一条红 + 那一组跳过，**收集到的条数一个不少**。
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
/** 未装且没被要求硬失败 → 这 8 条逐条 skip（**条数不变**，见文件头）。 */
const SKIP_ALL = !INSTALLED && !REQUIRE_INSTALL

/**
 * 未装 profile 且要求硬失败（`XUANSHU_REQUIRE_ASSEMBLY=1`）时，让**每一条**用例红在自己的名字上。
 *
 * 为什么不写成 `beforeAll` 里 `throw`：vitest 对「beforeAll 炸了」的处置是把这一组**标成跳过**
 * （本轮实测：8 条全 skipped、失败数 0、`success` 仍是 true）—— 那正是这个仓库最防的一种假绿。
 * 断言写在用例体内，「没装」就红在该红的地方。
 */
function requireProfile() {
  if (INSTALLED || !REQUIRE_INSTALL) return
  expect.fail(`玄枢装配契约要求 profile 已安装（XUANSHU_REQUIRE_ASSEMBLY=1）：profile "${PROFILE}" 不在 ${PROFILE_DIR}；先跑 ${INSTALL_HINT}`)
}

const SEAMS = [
  ['s1', 'S1 装配树（dsh --dump-config-schema）'],
  ['s2', 'S2 进程内挂载（官方 loadProfile/boot，fiber.state=2）'],
  ['s3', 'S3 客户端预编译产物（静态 + 物化契约）'],
  ['s4', 'S4 漂移基线（dsh --dump-config）'],
  ['s5', 'S5 真 CLI 启动 + 装配报告'],
]

let report
let raw = ''

describe('玄枢装配契约（S1~S5）', () => {
  beforeAll(() => {
    if (!INSTALLED) {
      if (!REQUIRE_INSTALL) {
        console.warn(
          `\n⚠️  玄枢装配契约测试 SKIPPED：profile "${PROFILE}" 未安装在 ${PROFILE_DIR}\n`
          + `   先安装：${INSTALL_HINT}\n`
          + '   交付/CI 校验请设 XUANSHU_REQUIRE_ASSEMBLY=1，让「没装」变成硬失败。\n',
        )
      }
      return
    }
    const run = spawnSync(process.execPath, [
      VERIFIER, '--json', '--dsh-home', DSH_HOME, '--profile', PROFILE,
    ], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 })
    raw = `${run.stdout ?? ''}\n--- stderr ---\n${run.stderr ?? ''}`
    try {
      report = JSON.parse(run.stdout)
    } catch {
      report = undefined
    }
    // 输出不可解析时**不在这里抛**：那会让整组 8 条以「beforeAll 炸了」的样子红，
    // 而第一条用例本来就负责把原始输出贴出来（「没有可解析的 JSON」+ 前 2000 字）。
    if (report !== undefined) {
      report.exitCode = run.status
      report.spawnError = run.error?.message
    }
  }, 660_000)

  it.skipIf(SKIP_ALL)('测试台给出结构化结果（本身没崩）', () => {
    requireProfile()
    expect(report, `scripts/verify-assembly.mjs 没有输出可解析的 JSON：\n${raw.slice(0, 2000)}`).toBeDefined()
    expect(report.spawnError ?? null, raw.slice(0, 2000)).toBeNull()
    expect(report.error ?? null, raw.slice(0, 2000)).toBeNull()
  })

  for (const [key, title] of SEAMS) {
    it.skipIf(SKIP_ALL)(title, () => {
      requireProfile()
      expect(report, `没有结果：\n${raw.slice(0, 2000)}`).toBeDefined()
      const check = report.checks?.[key]
      expect(check, `CLI 没跑这一项；输出：\n${raw.slice(0, 2000)}`).toBeDefined()
      expect(check.ok, `[${check.id}] ${check.detail}`).toBe(true)
    })
  }

  it.skipIf(SKIP_ALL)('CLI 退出码为 0（五条 seam 全绿）', () => {
    requireProfile()
    expect(report?.ok, raw.slice(0, 2000)).toBe(true)
    expect(report?.exitCode, raw.slice(0, 2000)).toBe(0)
  })

  it.skipIf(SKIP_ALL)('S4 基线不是空的、且来自真实安装的 DSH 包', () => {
    requireProfile()
    const baseline = report?.baseline
    expect(baseline?.exists, '漂移基线不存在：先跑 node scripts/verify-assembly.mjs --write-baseline').toBe(true)
    expect(baseline.rows).toBeGreaterThan(0)
    for (const source of baseline.sources ?? []) {
      expect(source.layer.startsWith('@deepseek-ai/'), `基线的层不是 DSH 包：${source.layer}`).toBe(true)
      expect(source.rows, `层 ${source.layer} 一行都没提到`).toBeGreaterThan(0)
    }
  })
})
