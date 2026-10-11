/**
 * 隔离验收 · I1 / I2（纯函数面，不需要起端口、不需要 spawn CLI）
 *
 * 覆盖的断言面（契约 `.scratch/assembly-foundation/notes/isolation-contract.md` §5）：
 *   I1  隔离 home 生效：`home`/`dataDir`/`sessionsDir`/`storagesDir`/`credentialsFile`/
 *       `machinePatchFile`/`reportFile` 全在 `$DSH_HOME` 下，且换一个 home 后两两不同
 *   I2  CLI 来自 profile 树、版本 = profile 装的 dsh-base 版本；显式 `--cli-bin` 优先
 *   （另加一份环境门本体 profile-installed，以及两条**不需要 profile** 的拒绝路径负例）
 *
 * 同源：本文件只跑 `scripts/verify-isolation.mjs --json --only home-isolated,cli-version,profile-installed`，
 * 断言它给出的 checks；四态判据/路径包含关系等判断逻辑都在验收台里，这里不重写一份。
 */
import { beforeAll, describe, expect, it } from 'vitest'

import {
  DSH_HOME, PROFILE, PROFILE_DIR, REAL_HOME, VERIFIER,
  expectCheckPass, runVerifier, withProfileGate,
} from './lib/verifier.mjs'

const SELECTED = ['home-isolated', 'cli-version', 'profile-installed']

withProfileGate('玄枢隔离验收 · I1/I2（home-isolated / cli-version / profile-installed）', () => {
  let result

  beforeAll(() => {
    result = runVerifier(['--json', '--only', SELECTED.join(','), '--home', DSH_HOME, '--profile', PROFILE])
  }, 660_000)

  it('验收台给出结构化结果（本身没崩）', () => {
    expect(result.json, `验收台没有输出可解析的 JSON：\n${result.raw()}`).toBeDefined()
    expect(result.error ?? null, result.raw()).toBeNull()
    expect(result.json.report, `验收台没带上启动器报告：\n${result.raw()}`).toBeDefined()
    // 契约 §4.6 冻结的 JSON 形状：{ ok, exitCode, checks, report, env } —— 少一个键就是破坏接口。
    expect(Object.keys(result.json)).toEqual(expect.arrayContaining(['ok', 'exitCode', 'checks', 'report', 'env']))
    expect(typeof result.json.exitCode).toBe('number')
    expect(result.json.env.home).toBe(DSH_HOME)
    expect(result.json.env.profile).toBe(PROFILE)
  })

  it('只跑了请求的三个 check（防「悄悄 skip」）', () => {
    expect(result.json.checkedIds).toEqual(SELECTED)
    expect(Object.keys(result.json.checks).sort()).toEqual([...SELECTED].sort())
    expect(result.json.skipped, `有 check 被 skip：${JSON.stringify(result.json.skippedIds)}`).toBe(false)
  })

  it('I1 七条派生路径全在隔离 home 下，且换 home 后两两不同', () => {
    const entry = expectCheckPass(result, 'home-isolated')
    const evidence = entry.evidence
    expect(evidence.home).toBe(DSH_HOME)
    expect(evidence.requestedHome).toBe(DSH_HOME)
    // 七条路径：契约 §4.4 列出的派生路径，一条都不能少。
    expect(evidence.paths.map((row) => row.key).sort()).toEqual(
      ['dataDir', 'credentialsFile', 'machinePatchFile', 'profileDir', 'reportFile', 'sessionsDir', 'storagesDir'].sort(),
    )
    for (const row of evidence.paths) {
      expect(row.underHome, `${row.key}=${row.path} 不在 ${DSH_HOME} 下`).toBe(true)
    }
    // 「换 home 后两两不同」是 I1 的后半句：否则「隔离」只是错觉。
    expect(evidence.alternateHome).not.toBe(evidence.home)
    for (const [key, distinct] of evidence.pairedDistinct) {
      expect(distinct, `换 home 后 ${key} 没变`).toBe(true)
    }
    // 验收台绝不能给用户真实 home 背书。
    expect(evidence.realHome).toBe(REAL_HOME)
    expect(evidence.home).not.toBe(REAL_HOME)
  })

  it('I2 CLI 来自 profile 树、版本 = dsh-base 版本，且 --cli-bin 优先', () => {
    const entry = expectCheckPass(result, 'cli-version')
    const evidence = entry.evidence
    expect(evidence.source).toBe('profile node_modules')
    expect(evidence.versionMatches).toBe(true)
    expect(evidence.version).toBe(evidence.wantedVersion)
    expect(evidence.version, 'CLI 版本解析不出来').toBeTruthy()
    // CLI 必须长在 profile 树里（`<profileDir>/node_modules/@deepseek-ai/dsh/lib/bin.js`）。
    expect(evidence.binJs.startsWith(PROFILE_DIR)).toBe(true)
    expect(evidence.binJs.endsWith('lib\\bin.js') || evidence.binJs.endsWith('lib/bin.js')).toBe(true)
    // `--cli-bin` 传同一支 CLI 时必须显示为 explicit（= 优先级被真正验证过，而不是碰巧选了同一支）。
    expect(evidence.explicitSource).toBe('explicit (--cli-bin)')
  })

  it('profile-installed 环境门：profile 真的装在这个隔离 home 下', () => {
    const entry = expectCheckPass(result, 'profile-installed')
    expect(entry.evidence.profileDir).toBe(PROFILE_DIR)
    expect(entry.evidence.nodeModules).toBe(true)
    expect(entry.evidence.dshBaseVersion).toBeTruthy()
  })

  it('三项全过 → 顶层 ok=true、exit 0', () => {
    expect(result.json.ok, result.raw()).toBe(true)
    expect(result.json.exitCode).toBe(0)
    expect(result.status, `验收台进程退出码 ${result.status}`).toBe(0)
    // 启动器自己的报告也必须是绿的（否则「验收台绿」就成了第二套事实）。
    expect(result.json.report.ok).toBe(true)
    expect(result.json.report.exitCode).toBe(0)
  })
})

// ── 下面两条**不需要 profile**：它们是「拒绝路径」的负例，任何机器上都该跑。
describe('玄枢隔离验收 · 拒绝路径（用法错误不许静默通过）', () => {
  it('未知 --only id → 用法失败（exit 1），并点名合法 id', () => {
    const result = runVerifier(['--json', '--only', 'no-such-check'])
    expect(result.status, result.raw()).toBe(1)
    expect(result.json, result.raw()).toBeUndefined() // 用法错误走 stderr，不产 JSON
    expect(result.stderr).toContain('no-such-check')
    expect(result.stderr).toContain('home-isolated')
  })

  it('把 --home 指到用户真实 ~/.dsh → 验收台拒绝背书（home-isolated FAIL、exit 1）', () => {
    const result = runVerifier(['--json', '--only', 'home-isolated', '--home', REAL_HOME])
    expect(result.json, `验收台没有输出 JSON：\n${result.raw()}`).toBeDefined()
    expect(result.status, result.raw()).toBe(1)
    expect(result.json.exitCode).toBe(1)
    expect(result.json.ok).toBe(false)
    // 拒得住的证据：启动器的 home 门 FAIL（用法失败 exit 1），而不是「成功跑了真实 home」。
    expect(result.json.checks['home-isolated'].ok).toBe(false)
    expect(result.json.report.exitCode).toBe(1)
    expect(result.json.report.checks.home.ok).toBe(false)
  })

  it('不存在 --dsh-bin 也没关系：验收台必须先跑起来（用法/环境失败都要有 JSON 或明确 stderr）', () => {
    // 这条只钉「CLI 表面」：验收台不认识的参数必须报用法错，绝不静默忽略。
    const result = runVerifier(['--json', '--not-a-flag'])
    expect(result.status, result.raw()).toBe(1)
    expect(result.stderr).toContain('--not-a-flag')
  })
})
