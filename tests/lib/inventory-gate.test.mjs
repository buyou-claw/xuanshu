/**
 * tests/lib/inventory-gate.test.mjs —— **清单门自己的判据**（票：评审修复轮）
 *
 * 为什么要有这一份：`scripts/check-test-inventory.mjs` 是「用例还在不在」的机器判据，
 * 而它自己此前**没有一条用例**。评审的故障注入探针（`.scratch/review-inventory-stale-probe.mjs`）
 * 证明了它有两种撒谎方式，两种都实测复现过：
 *
 *   ① **假绿**：报告路径上还留着上一轮的报告 → 测试进程崩了（探针里换成 exit 73、不写报告）
 *      也会被读成「用例都在、都通过」，门 exit 0。判据是「报告必须是这一轮写的」。
 *   ② **假红**：用例数跟着环境变（未装 profile 时 `assembly-contract` 只收集 1 条 vs 基线 8 条）
 *      → 干净 CI 必红。这一半的修法在被测文件里（恒 8 条，见 `tests/assembly/assembly-contract.test.mjs`），
 *      这一份只管「报告新鲜度」与三条数量判据。
 *
 * 环境：真文件系统（临时目录），零网络。**大部分用例的 `spawn` 是注入的替身**
 * （「子进程跑挂了」这种现场可以当场造出来），**但有一条例外**：`文件级失败` 那一组里
 * 「真实 vitest 跑一次 beforeAll 抛错的夹具」会真的 spawn 一次 `node_modules/vitest/vitest.mjs`
 * —— 因为那条发现本身就是「vitest 报出来的形状和我以为的不一样」，合成报告证明不了它。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { collectReport, runSuiteReport, violationsFor } from '../../scripts/lib/inventory-gate.mjs'

const REPO_ROOT = resolve(tmpdir(), 'not-a-real-repo')
/** R1 的真实形状夹具：`beforeAll` 抛错的那个文件（见 fixtures/inventory-hook/）。 */
const HOOK_FIXTURE = 'tests/lib/fixtures/inventory-hook/hook-failure.mjs'
const HOOK_FIXTURE_CONFIG = join(process.cwd(), 'tests', 'lib', 'fixtures', 'inventory-hook', 'vitest.config.mjs')
const litter = []
afterEach(() => {
  for (const path of litter.splice(0)) rmSync(path, { recursive: true, force: true })
})

/** 一个临时报告路径（父目录真建出来，好让被测代码自己写/删）。 */
function reportPathOf(label) {
  const dir = mkdtempSync(join(tmpdir(), `inventory-gate-${label}-`))
  litter.push(dir)
  return join(dir, 'report.json')
}

/** 造一份能解析的 vitest 报告（形状照 `--reporter=json`）。 */
function writeReport(path, files) {
  writeFileSync(
    path,
    JSON.stringify({
      testResults: Object.entries(files).map(([name, assertions]) => ({
        name,
        assertionResults: assertions.map((assertion) => (typeof assertion === 'string' ? { title: assertion, status: 'passed' } : assertion)),
      })),
    }),
  )
}

/** 跑一次 `runSuiteReport`，只关心它抛没抛、抛的是什么。 */
function attempt({ reportPath, spawn, now }) {
  try {
    runSuiteReport({ vitest: process.execPath, reportPath, repoRoot: REPO_ROOT, spawn, now })
    return { ok: true }
  } catch (error) {
    return { ok: false, message: String(error?.message ?? error) }
  }
}

describe('清单门 · 读报告（这一轮的报告才算数）', () => {
  it('故障注入：旧报告还在 + 测试进程崩了没写新报告 → 门必须是红的（不许拿旧报告顶）', () => {
    const reportPath = reportPathOf('stale')
    // 上一轮留下的「全绿」报告：正是探针里那份合成的旧件。
    writeReport(reportPath, { 'tests/whatever.test.mjs': ['通过', '通过'] })
    const result = attempt({ reportPath, spawn: () => ({ status: 73, error: null }) })

    expect(result.ok, '测试进程 exit 73 没写报告，门却继续比对 —— 这就是那个假绿').toBe(false)
    expect(result.message).toMatch(/没写出报告|旧文件/u)
    expect(result.message).toContain('73')
  })

  it('判据 3：报告比这一轮启动还旧（有人又塞了一份旧件进来）→ 红', () => {
    const reportPath = reportPathOf('old-mtime')
    const result = attempt({
      reportPath,
      // 替身「跑完了」并写一份真报告，但**这一轮的时钟快了一小时**（`now` 就是为这种判据留的注入点）
      // → 报告比这一轮启动还旧。
      now: () => Date.now() + 3_600_000,
      spawn: () => {
        writeReport(reportPath, { 'tests/whatever.test.mjs': ['通过'] })
        return { status: 0, error: null }
      },
    })

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/旧文件/u)
  })

  it('报告的写入时刻与启动同秒（粗粒度 mtime 的文件系统）→ 不算旧件，照常比对', () => {
    const reportPath = reportPathOf('coarse-mtime')
    const result = attempt({
      reportPath,
      // 时钟只比真实时间快 1 秒：报告是「真跑真写」的，不该被 2 秒宽容之外的判据误杀。
      now: () => Date.now() + 1_000,
      spawn: () => {
        writeReport(reportPath, { 'tests/whatever.test.mjs': ['通过'] })
        return { status: 0, error: null }
      },
    })

    expect(result.ok, result.message).toBe(true)
  })

  it('测试进程起不来（spawn error）→ 红，且说清「不许拿旧报告顶上」', () => {
    const reportPath = reportPathOf('spawn-error')
    const result = attempt({ reportPath, spawn: () => ({ status: null, error: new Error('FAULT INJECTION: 起不来') }) })

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/起不来/u)
  })

  it('报告不是合法 JSON（写了一半就没了）→ 红', () => {
    const reportPath = reportPathOf('half-json')
    const result = attempt({
      reportPath,
      spawn: () => {
        writeFileSync(reportPath, '{"testResults":[{"name":"x",')
        return { status: 0, error: null }
      },
    })

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/不是合法 JSON/u)
  })

  it('**vitest 退出码非 0 是正常的**（已知红在跑）：报告新鲜就照常比对，退出码只如实带出来', () => {
    const reportPath = reportPathOf('known-red-exit-1')
    const result = runSuiteReport({
      vitest: process.execPath,
      reportPath,
      repoRoot: REPO_ROOT,
      spawn: () => {
        writeReport(reportPath, { [join(REPO_ROOT, 'tests/assembly/assembly-contract.test.mjs')]: [{ title: 'S1 装配树', status: 'failed' }] })
        return { status: 1, error: null }
      },
    })

    expect(result.exitCode).toBe(1)
    expect(collectReport(result.report, { repoRoot: REPO_ROOT }).failures).toEqual([
      { file: 'tests/assembly/assembly-contract.test.mjs', title: 'S1 装配树' },
    ])
  })
})

describe('清单门 · 文件级失败（R1：hook / suite / 未处理错误）', () => {
  /** 评审给的那份真实报告形状（`beforeAll` 抛错）：文件 failed、用例全 skipped、numFailedTests 0。 */
  const hookReport = {
    numTotalTestSuites: 2,
    numPassedTestSuites: 0,
    numFailedTestSuites: 2,
    numTotalTests: 1,
    numPassedTests: 0,
    numFailedTests: 0,
    numPendingTests: 1,
    success: false,
    testResults: [
      {
        name: '/repo/tests/hook-failure.test.mjs',
        status: 'failed',
        message: '',
        assertionResults: [{ title: 'collected assertion remains present', status: 'skipped', ancestorTitles: ['suite with a broken setup'] }],
      },
    ],
  }

  it('合成报告：文件 failed + 用例全 skipped（用例级失败为 0）→ 「文件级失败」违规', () => {
    const current = collectReport(hookReport, { repoRoot: '/repo' })
    expect(current.failures, '用例级失败为 0 —— 这正是漏报的来源').toEqual([])
    expect(current.suiteFailures).toEqual([{ file: 'tests/hook-failure.test.mjs', message: '' }])
    const { violations } = violationsFor({ current, baseline: { files: { 'tests/hook-failure.test.mjs': 1 }, knownRed: [] } })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/文件级失败/u)
  })

  it('文件里有用例级失败时不再重复报「文件级失败」（那一份已按用例记账）', () => {
    const current = collectReport(
      { success: false, testResults: [{ name: '/repo/tests/a.test.mjs', status: 'failed', assertionResults: [{ title: 'x', status: 'failed' }] }] },
      { repoRoot: '/repo' },
    )
    expect(current.suiteFailures).toEqual([])
    const { violations } = violationsFor({ current, baseline: { files: { 'tests/a.test.mjs': 1 }, knownRed: [{ file: 'tests/a.test.mjs', title: 'x', reason: '已知' }] } })
    expect(violations).toEqual([])
  })

  it('报告 success=false 却一条失败都核不出来（未处理错误）→ 违规', () => {
    const current = collectReport(
      { success: false, testResults: [{ name: '/repo/tests/a.test.mjs', status: 'passed', assertionResults: [{ title: 'x', status: 'passed' }] }] },
      { repoRoot: '/repo' },
    )
    const { violations } = violationsFor({ current, baseline: { files: { 'tests/a.test.mjs': 1 }, knownRed: [] } })
    expect(violations).toEqual(['报告 success=false，但没有任何可核对的失败条目（未处理错误 / 环境问题？先看 vitest 的 stderr）'])
  })

  it('**真实 vitest** 跑一次 beforeAll 抛错的夹具：形状与合成报告一致，门判红', () => {
    const reportPath = reportPathOf('hook-real')
    const run = runSuiteReport({
      vitest: join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs'),
      reportPath,
      repoRoot: process.cwd(),
      spawn: (command, args, options) => spawnSync(command, [...args, '--config', HOOK_FIXTURE_CONFIG], options),
    })
    const current = collectReport(run.report, { repoRoot: process.cwd() })
    expect(run.report.numFailedTests, '真实 vitest 在这种形状下没有用例级失败').toBe(0)
    expect(current.failures).toEqual([])
    expect(current.suiteFailures.map((entry) => entry.file)).toEqual([HOOK_FIXTURE])
    expect(typeof current.suiteFailures[0].message).toBe('string')
    const { violations } = violationsFor({ current, baseline: { files: { [HOOK_FIXTURE]: 1 }, knownRed: [] } })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/文件级失败/u)
  })
})

describe('清单门 · 数量判据', () => {
  const baseline = {
    total: 3,
    files: { 'tests/a.test.mjs': 2, 'tests/b.test.mjs': 1 },
    knownRed: [{ file: 'tests/a.test.mjs', title: 'S1 装配树', reason: '上游 rc.2 的 schema 导出器' }],
  }

  /** 报告 → current（相对路径与 `collectReport` 同一套）。 */
  const currentOf = (files) => collectReport({ testResults: Object.entries(files).map(([name, assertions]) => ({ name: resolve(name), assertionResults: assertions })) }, { repoRoot: process.cwd() })

  it('收集到 0 条 → 「收集失败」（文件收集期报错的形状：用例从总数里静默消失）', () => {
    // `a` 是新加的文件（基线里还没有它）：这里只想单独看「收集到 0 条」这一条判据。
    const current = currentOf({ 'tests/a.test.mjs': [], 'tests/b.test.mjs': [{ title: 'ok', status: 'passed' }] })
    const { violations, known } = violationsFor({ current, baseline: { total: 1, files: { 'tests/b.test.mjs': 1 }, knownRed: [] } })
    expect(known).toEqual([])
    expect(violations).toEqual(['收集失败：「tests/a.test.mjs」收集到 0 条用例（收集期报错会让用例从总数里消失）'])
  })

  it('比基线少 / 文件消失 → 各自的违规；少一条也要报（不许悄悄删或悄悄跳过）', () => {
    const current = currentOf({ 'tests/a.test.mjs': [{ title: 'ok', status: 'passed' }] })
    const { violations } = violationsFor({ current, baseline })
    // 顺序 = 基线文件的顺序（逐文件报，方便读）。
    expect(violations).toEqual([
      '用例变少：「tests/a.test.mjs」2 → 1（少了 1 条；要么补回来，要么 --update 并说明为什么）',
      '文件消失：「tests/b.test.mjs」这次没被收集（基线 1 条）',
    ])
  })

  it('已知红名单里的失败放过、名单外的失败报违规（名单逐条带理由）', () => {
    const current = currentOf({
      'tests/a.test.mjs': [{ title: 'S1 装配树', status: 'failed' }, { title: '新的红', status: 'failed' }],
      'tests/b.test.mjs': [{ title: 'ok', status: 'passed' }],
    })
    const { violations, known } = violationsFor({ current, baseline })
    expect(known).toEqual([{ file: 'tests/a.test.mjs', title: 'S1 装配树' }])
    expect(violations).toEqual(['新失败：「tests/a.test.mjs」· 新的红'])
  })

  it('skip 计入用例数（收集到了就该在数里），但不算失败', () => {
    const current = currentOf({
      'tests/a.test.mjs': [{ title: 'S1 装配树', status: 'skipped' }, { title: 'S2', status: 'skipped' }],
      'tests/b.test.mjs': [{ title: 'ok', status: 'passed' }],
    })
    const { violations, known } = violationsFor({ current, baseline })
    expect(current.total).toBe(3)
    expect(current.skipped).toBe(2)
    expect(current.failures).toEqual([])
    expect(known).toEqual([])
    expect(violations).toEqual([])
  })

  it('当前全绿 → 一条违规都没有（门的正常态）', () => {
    const current = currentOf({
      'tests/a.test.mjs': [{ title: 'S1 装配树', status: 'failed' }, { title: 'S2', status: 'passed' }],
      'tests/b.test.mjs': [{ title: 'ok', status: 'passed' }],
    })
    const { violations } = violationsFor({ current, baseline })
    expect(violations).toEqual([])
  })
})
