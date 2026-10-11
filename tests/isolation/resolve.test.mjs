/**
 * 隔离验收 · I1 / I2 + 启动器 CLI 前提（纯函数面 + CLI 表面）
 *
 * 覆盖的断言面（契约 `.scratch/assembly-foundation/notes/isolation-contract.md` §5；§5.1 的 R 条目另注）：
 *   I1  隔离 home 生效：`home`/`dataDir`/`sessionsDir`/`storagesDir`/`credentialsFile`/
 *       `machinePatchFile`/`reportFile` 全在 `$DSH_HOME` 下，且换一个 home 后两两不同
 *   I2  CLI 来自 profile 树、版本 = profile 装的 dsh-base 版本；显式 `--cli-bin` 优先
 *   （另加一份环境门本体 profile-installed，以及两条**不需要 profile** 的拒绝路径负例）
 *   再加一块「启动器 CLI 前提」（真的 spawn `scripts/isolation/startup.mjs --json`）：
 *   R12 doctor/env 报告里**没有** `spawn` 字段；R2/R17 `--mode web` 在缺
 *       `@deepseek-ai/dsh-web-app` bundle 时 exit 2、detail 点名 bundle、无 `spawn`、stdout 单份 JSON；
 *   R3  真会 spawn 的 `--mode headless` 把**终版报告**（含真实 `spawn.exitCode`）写进单份 stdout JSON。
 *
 * 同源：主块只跑 `scripts/verify-isolation.mjs --json --only home-isolated,cli-version,profile-installed`，
 * 断言它给出的 checks；四态判据/路径包含关系等判断逻辑都在验收台里，这里不重写一份。
 * 「启动器 CLI 前提」那一块直接跑启动器自己的 CLI —— 因为 R17 要断言的就是**它的进程退出码与
 * stdout 形状**（验收台是包在它外面的机器，量不到这两样）。
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { DSH_WEB_APP_PACKAGE } from '../../scripts/isolation/defaults.mjs'
import { CLI_SOURCES, resolveInstance } from '../../scripts/isolation/resolve.mjs'
import { runStartup } from '../../scripts/isolation/startup.mjs'
import {
  DSH_HOME, PROFILE, PROFILE_DIR, REAL_HOME, REPO_ROOT, VERIFIER,
  expectCheckPass, runVerifier, withProfileGate,
} from './lib/verifier.mjs'

const SELECTED = ['home-isolated', 'cli-version', 'profile-installed']
const STARTUP = join(REPO_ROOT, 'scripts', 'isolation', 'startup.mjs')
/** 回归用端口（数字形态）：故意不是默认值，被忽略就一定看得出来。 */
const NUMERIC_WEB_PORT = 7973
const NUMERIC_HOROSA_PORT = 65533

/** 真跑启动器 CLI（utf8 抓输出；`--json` 时 stdout 必须只有一份 JSON）。 */
function runStartupCli(args, { timeoutMs = 300_000 } = {}) {
  const run = spawnSync(process.execPath, [STARTUP, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  })
  let json
  try {
    json = JSON.parse(run.stdout)
  } catch {
    json = undefined
  }
  return {
    status: run.status,
    json,
    stdout: run.stdout ?? '',
    stderr: run.stderr ?? '',
    error: run.error?.message,
    raw: () => `exit=${run.status}\n--- stdout ---\n${(run.stdout ?? '').slice(0, 3000)}\n--- stderr ---\n${(run.stderr ?? '').slice(0, 1500)}`,
  }
}

/** `--json` 的 stdout 必须是**恰好一份** JSON 文档：能整体 parse，且只有一个根行（无前导空白）。 */
function expectSingleJsonDoc(result) {
  expect(result.json, `stdout 不是一份可解析的 JSON：\n${result.raw()}`).toBeDefined()
  const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim() !== '')
  expect(lines[0].trim(), `stdout 第一行不是 JSON 开头：${lines[0].slice(0, 120)}`).toBe('{')
  expect(lines[lines.length - 1].trim(), `stdout 最后一行不是 JSON 结尾：${lines[lines.length - 1].slice(0, 120)}`).toBe('}')
  // 拼接两份报告时第二份会以「顶格的 {」开头；`JSON.stringify(..., undefined, 2)` 里嵌套对象都缩进 ≥2。
  // （别用 `"schema":` 出现次数当判据：报告里 schema 字段本来就有好几处，那是嵌套键，不是第二份文档。）
  const roots = lines.filter((line) => /^[[{]/.test(line))
  expect(roots.length, `stdout 里有 ${roots.length} 个顶格 JSON 根行：${roots.slice(0, 4).join(' | ')}`).toBe(1)
}

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
    // R10：source 是封闭枚举，断言也引用常量（裸字符串比较一旦漂移就成了「永远为真」的假绿）。
    expect(evidence.source).toBe(CLI_SOURCES.profile)
    expect(evidence.versionMatches).toBe(true)
    expect(evidence.version).toBe(evidence.wantedVersion)
    expect(evidence.version, 'CLI 版本解析不出来').toBeTruthy()
    // CLI 必须长在 profile 树里（`<profileDir>/node_modules/@deepseek-ai/dsh/lib/bin.js`）。
    expect(evidence.binJs.startsWith(PROFILE_DIR)).toBe(true)
    expect(evidence.binJs.endsWith('lib\\bin.js') || evidence.binJs.endsWith('lib/bin.js')).toBe(true)
    // `--cli-bin` 传同一支 CLI 时必须显示为 explicit（= 优先级被真正验证过，而不是碰巧选了同一支）。
    expect(evidence.explicitSource).toBe(CLI_SOURCES.explicit)
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

// ── 端口解析回归（数字形态）：R6 那次重写曾让**数字**端口被静默忽略、退回默认端口。
//    这一块不需要 profile：纯函数 + 一次 env 模式的 runStartup。
describe('玄枢隔离验收 · 端口解析回归（数字端口不许被静默忽略）', () => {
  it('resolveInstance：数字端口原样生效，来源也标对（数字/字符串/未设三种形态）', () => {
    const numeric = resolveInstance({ home: join(REPO_ROOT, '.dsh-home'), env: {}, webPort: NUMERIC_WEB_PORT, horosaPort: NUMERIC_HOROSA_PORT })
    expect(numeric.webPort, '数字 webPort 被静默忽略了（退回默认端口）').toBe(NUMERIC_WEB_PORT)
    expect(numeric.horosaPort, '数字 horosaPort 被静默忽略了（退回默认端口）').toBe(NUMERIC_HOROSA_PORT)
    expect(numeric.portSources).toEqual({ web: '--web-port', horosa: '--horosa-port' })
    expect(numeric.horosaUrl).toContain(String(NUMERIC_HOROSA_PORT))

    // 字符串形态（CLI 路径）必须同样成立：两种形态不该有第二种行为。
    const textual = resolveInstance({ home: join(REPO_ROOT, '.dsh-home'), env: {}, webPort: String(NUMERIC_WEB_PORT), horosaPort: String(NUMERIC_HOROSA_PORT) })
    expect(textual.webPort).toBe(NUMERIC_WEB_PORT)
    expect(textual.horosaPort).toBe(NUMERIC_HOROSA_PORT)

    // 未设 → 默认值（别把「修好了」写成「永远返回入参」）。
    const fallback = resolveInstance({ home: join(REPO_ROOT, '.dsh-home'), env: {} })
    expect(fallback.webPort).toBe(19388)
    expect(fallback.horosaPort).toBe(8765)
    expect(fallback.portSources).toEqual({ web: 'default', horosa: 'default' })
  })

  it('runStartup：数字端口进 instance 与 plan.env（API 路径和 CLI 路径同一份事实）', async () => {
    const report = await runStartup({ mode: 'env', home: join(REPO_ROOT, '.dsh-home'), webPort: NUMERIC_WEB_PORT, horosaPort: NUMERIC_HOROSA_PORT })
    expect(report.instance.webPort).toBe(NUMERIC_WEB_PORT)
    expect(report.instance.horosaPort).toBe(NUMERIC_HOROSA_PORT)
    expect(report.plan.env.XUANSHU_WEB_PORT).toBe(String(NUMERIC_WEB_PORT))
    expect(report.plan.env.XUANSHU_HOROSA_PORT).toBe(String(NUMERIC_HOROSA_PORT))
    expect(report.plan.command.join(' ')).toContain(`--port ${NUMERIC_WEB_PORT}`)
  })
})

// ── 启动器 CLI 前提（R2 / R3 / R12 / R17）：真跑 startup.mjs，断言的是它的**进程退出码与 stdout 形状**。
withProfileGate('玄枢隔离验收 · 启动器 CLI 前提（web 模式 / 单份 JSON / spawn 字段）', () => {
  const base = ['--json', '--home', DSH_HOME, '--profile', PROFILE]

  it('R12 doctor 模式的报告里**没有** spawn 字段（没 spawn 就不出现，不是 { attempted: false }）', () => {
    const result = runStartupCli([...base, '--mode', 'doctor'])
    expectSingleJsonDoc(result)
    expect(result.status, result.raw()).toBe(0)
    expect(result.json.mode).toBe('doctor')
    expect(Object.keys(result.json)).not.toContain('spawn')
    expect(result.json.spawn).toBeUndefined()
  })

  it('R12 env 模式同样没有 spawn 字段，且给出 plan.command + plan.env', () => {
    const result = runStartupCli([...base, '--mode', 'env'])
    expectSingleJsonDoc(result)
    expect(result.status, result.raw()).toBe(0)
    expect(Object.keys(result.json)).not.toContain('spawn')
    expect(Array.isArray(result.json.plan.command)).toBe(true)
    expect(result.json.plan.env.DSH_HOME).toBe(DSH_HOME)
  })

  it('R2/R17 --mode web 在缺 web bundle 时拒绝 spawn：exit 2 + 点名 bundle + 无 spawn + 单份 JSON', () => {
    // 真跑（不是 dry-run）：这一票里 `@deepseek-ai/dsh-web-app` 不在 profile 的 bundles 里（§5.1 R1），
    // 所以启动器必须在 spawn 前就拒绝，而不是放一个必死的 `dsh web --port` 子进程出去。
    const result = runStartupCli([...base, '--mode', 'web', '--timeout-ms', '30000'])
    expectSingleJsonDoc(result)
    expect(result.status, `--mode web 应退出 2（环境门），实际 ${result.status}\n${result.raw()}`).toBe(2)
    expect(result.json.exitCode).toBe(2)
    expect(result.json.ok).toBe(false)
    // 拒绝的证据：profile 门 FAIL 且 detail 点名缺哪个 bundle；报告里没有 spawn 字段。
    const profile = result.json.checks.profile
    expect(profile.ok, `profile 门应 FAIL：${profile.detail}`).toBe(false)
    expect(profile.detail).toContain(DSH_WEB_APP_PACKAGE)
    expect(String(profile.detail)).toMatch(/bundles/)
    expect(profile.hint, '拒了就得给两条出路（--mode env 取命令 / 等票 07）').toBeTruthy()
    expect(Object.keys(result.json)).not.toContain('spawn')
    // 门不 ok 的原因必须是「缺 web bundle」，不是「profile 没装」—— 后者会让这条断言失去意义。
    expect(result.json.checks.profile.evidence.webBundle.available).toBe(false)
    expect(result.json.checks.profile.evidence.webBundle.declaredInBundles).toBe(false)
    // doctor/headless 不受它影响：这条前提只该挡住 web 模式。
    expect(result.json.checks.home.ok).toBe(true)
    expect(result.json.checks.cli.ok).toBe(true)
  })

  it('R3 真会 spawn 的 headless：stdout 是**终版**单份 JSON，含真实 spawn.exitCode', () => {
    const result = runStartupCli([...base, '--mode', 'headless'])
    expectSingleJsonDoc(result)
    expect(result.status, result.raw()).toBe(0)
    expect(result.json.spawn, 'headless 必须真的 spawn 一次').toBeDefined()
    expect(result.json.spawn.attempted).toBe(true)
    expect(result.json.spawn.exitCode).toBe(0)
    expect(result.json.spawn.report.fresh).toBe(true)
  }, 300_000)
})
