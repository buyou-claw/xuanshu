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

import { collectReport, detectUnhandledErrors, runSuiteReport, violationsFor } from '../../scripts/lib/inventory-gate.mjs'

const REPO_ROOT = resolve(tmpdir(), 'not-a-real-repo')
/** R1 的真实形状夹具：`beforeAll` 抛错的那个文件（见 fixtures/inventory-hook/）。 */
const HOOK_FIXTURE = 'tests/lib/fixtures/inventory-hook/hook-failure.mjs'
/** N1 的第二种真实形状夹具：同一文件里已知红断言 + 另一个 describe 的 hook 抛错。 */
const MIXED_FIXTURE = 'tests/lib/fixtures/inventory-hook/mixed.fixture.mjs'
/** N1 的第三种真实形状夹具：断言全绿，只有未处理错误。 */
const UNHANDLED_FIXTURE = 'tests/lib/fixtures/inventory-hook/unhandled.fixture.mjs'
/** R1 的真实形状夹具：一条已知红断言 + `afterAll` 抛错（没有 skipped、只有文件级 message）。 */
const AFTER_ALL_FIXTURE = 'tests/lib/fixtures/inventory-hook/after-all.fixture.mjs'
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
    expect(current.suiteFailures).toEqual([{ file: 'tests/hook-failure.test.mjs', message: '', skippedAssertions: 1 }])
    const { violations } = violationsFor({ current, baseline: { files: { 'tests/hook-failure.test.mjs': 1 }, knownRed: [] } })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/文件级失败/u)
  })

  it('N1 混合形状：同文件一条已知红断言 + 另一个 describe 的 hook 抛错 → 也必须红', () => {
    // 复核 48e0e0a 的 N1 实测形状（.scratch/review-48-standards/mixed-report.json）：
    // 文件 failed、1 条失败断言（已知红）+ 1 条 skipped（hook 吃掉的）。旧判据要求
    // 「没有任何失败断言」才记账 ⇒ 这一类整个漏掉。已知红豁免的是断言，豁免不了没跑起来的用例。
    const mixedReport = {
      success: false,
      numFailedTestSuites: 3,
      testResults: [
        {
          name: '/repo/tests/mixed.test.mjs',
          status: 'failed',
          message: '',
          assertionResults: [
            { title: 'known red', status: 'failed', ancestorTitles: ['known red suite'] },
            { title: 'must actually run', status: 'skipped', ancestorTitles: ['new broken setup'] },
          ],
        },
      ],
    }
    const current = collectReport(mixedReport, { repoRoot: '/repo' })
    expect(current.suiteFailures).toEqual([{ file: 'tests/mixed.test.mjs', message: '', skippedAssertions: 1 }])
    const { violations, known } = violationsFor({
      current,
      baseline: { files: { 'tests/mixed.test.mjs': 2 }, knownRed: [{ file: 'tests/mixed.test.mjs', title: 'known red', reason: '已知' }] },
    })
    expect(known, '那条已知红断言照常豁免').toEqual([{ file: 'tests/mixed.test.mjs', title: 'known red' }])
    expect(violations, '但 hook 吃掉的用例必须以文件级失败记账').toEqual([
      expect.stringMatching(/文件级失败.*没跑起来.*tests\/mixed\.test\.mjs/u),
    ])
  })

  it('R1 afterAll 形状：一条已知红断言 + 文件级 message 非空 + 0 skipped → 已知红照常豁免，hook 错误独立记账', () => {
    // 复核 32216d9 的真实报告（.scratch/review-322-standards/after-all-report.json）：
    // `afterAll` 在断言跑完之后抛错 ⇒ 文件 failed、1 条失败断言（已知红）、`numPendingTests: 0`、
    // 文件级 `message === 'NEW_AFTER_ALL_ERROR'`。旧判据（没有失败断言 **或** 有 skipped）两条都不成立
    // ⇒ suiteFailures 为空、退出码兜底又被那条已知红挡住 ⇒ 假绿。
    const afterAllReport = {
      success: false,
      numFailedTestSuites: 1,
      numTotalTests: 1,
      numFailedTests: 1,
      numPendingTests: 0,
      testResults: [
        {
          name: '/repo/tests/after-all.test.mjs',
          status: 'failed',
          message: 'NEW_AFTER_ALL_ERROR',
          assertionResults: [{ title: 'known red', status: 'failed', ancestorTitles: ['known red suite'] }],
        },
      ],
    }
    const current = collectReport(afterAllReport, { repoRoot: '/repo' })
    expect(current.failures).toEqual([{ file: 'tests/after-all.test.mjs', title: 'known red' }])
    expect(current.skipped, 'afterAll 不产生 skipped 用例 —— 这正是旧判据漏它的原因').toBe(0)
    expect(current.suiteFailures).toEqual([
      { file: 'tests/after-all.test.mjs', message: 'NEW_AFTER_ALL_ERROR', skippedAssertions: 0 },
    ])
    const { violations, known } = violationsFor({
      current,
      baseline: { files: { 'tests/after-all.test.mjs': 1 }, knownRed: [{ file: 'tests/after-all.test.mjs', title: 'known red', reason: '已知' }] },
    })
    expect(known, '那条已知红断言照常豁免').toEqual([{ file: 'tests/after-all.test.mjs', title: 'known red' }])
    expect(violations, 'hook 抛错必须以文件级失败记账').toHaveLength(1)
    expect(violations[0]).toMatch(/文件级失败/u)
    expect(violations[0]).toContain('tests/after-all.test.mjs')
    expect(violations[0]).toContain('NEW_AFTER_ALL_ERROR')
  })

  it('纯断言失败的文件（文件级 message 是空串）→ 不因新判据误报文件级失败', () => {
    // 真报告的对照组（复核 32216d9 的同目录 mixed-report.json、本仓 assembly-contract 报告）：
    // 只有断言失败时 `result.message === ''`。新判据只认非空 message ⇒ 这一形状不受影响。
    const current = collectReport(
      {
        success: false,
        testResults: [
          {
            name: '/repo/tests/assertion-only.test.mjs',
            status: 'failed',
            message: '',
            assertionResults: [{ title: 'x', status: 'failed' }],
          },
          // message 字段整个缺失的报告（合成报告 / 老版本 reporter）也一样不算 hook 证据。
          { name: '/repo/tests/no-message.test.mjs', status: 'failed', assertionResults: [{ title: 'x', status: 'failed' }] },
        ],
      },
      { repoRoot: '/repo' },
    )
    expect(current.suiteFailures).toEqual([])
    expect(current.failures).toHaveLength(2)
    const { violations, known } = violationsFor({
      current,
      baseline: {
        files: { 'tests/assertion-only.test.mjs': 1, 'tests/no-message.test.mjs': 1 },
        knownRed: [
          { file: 'tests/assertion-only.test.mjs', title: 'x', reason: '已知' },
          { file: 'tests/no-message.test.mjs', title: 'x', reason: '已知' },
        ],
      },
    })
    expect(known).toHaveLength(2)
    expect(violations).toEqual([])
  })

  it('已知红独存的文件（有失败断言、没有没跑起来的用例）→ 不报文件级失败，已知红照常豁免', () => {
    const current = collectReport(
      { success: false, testResults: [{ name: '/repo/tests/a.test.mjs', status: 'failed', assertionResults: [{ title: 'x', status: 'failed' }] }] },
      { repoRoot: '/repo' },
    )
    expect(current.suiteFailures).toEqual([])
    const { violations } = violationsFor({ current, baseline: { files: { 'tests/a.test.mjs': 1 }, knownRed: [{ file: 'tests/a.test.mjs', title: 'x', reason: '已知' }] } })
    expect(violations).toEqual([])
  })

  it('N1 未处理错误：断言全绿、报告 success=true，但退出码 1 → 违规（退出码是兜底）', () => {
    // 复核 48e0e0a 的 N1 实测：定时器抛未处理错误时 JSON 报告完全干净（success=true、0 失败），
    // 只有 vitest 的退出码是 1。旧的兜底只看 success=false ⇒ 漏。
    const current = collectReport(
      { success: true, testResults: [{ name: '/repo/tests/a.test.mjs', status: 'passed', assertionResults: [{ title: 'x', status: 'passed' }] }] },
      { repoRoot: '/repo', exitCode: 1 },
    )
    expect(current.exitCode).toBe(1)
    const { violations } = violationsFor({ current, baseline: { files: { 'tests/a.test.mjs': 1 }, knownRed: [] } })
    expect(violations).toEqual([expect.stringMatching(/退出码非 0.*没有任何可核对的失败条目/u)])
  })

  it('N1 未处理错误**与已知红并存**：必须独立报出来（已知红不能替它背书）', () => {
    // 规格轴复核实测：仓库常态就有 2 条 knownRed，任何「只有在没有任何失败时才看未处理错误」的
    // 写法都等于没看 —— 所以 unhandledErrors 自己占一条判据，与断言失败各自记账。
    const current = collectReport(
      { success: false, testResults: [{ name: '/repo/tests/a.test.mjs', status: 'failed', assertionResults: [{ title: 'known red', status: 'failed' }] }] },
      { repoRoot: '/repo', exitCode: 1, unhandledErrors: true },
    )
    expect(current.unhandledErrors).toBe(true)
    const { violations, known } = violationsFor({
      current,
      baseline: { files: { 'tests/a.test.mjs': 1 }, knownRed: [{ file: 'tests/a.test.mjs', title: 'known red', reason: '已知' }] },
    })
    expect(known).toHaveLength(1)
    expect(violations).toEqual([expect.stringMatching(/未处理错误.*已知红也不能替它背书/u)])
  })

  it('未处理错误的识别：认本轮汇总块里的分节标题 / Errors 行，不认嵌套文本与用例名', () => {
    // 真形状：分节标题在失败段里，`Errors N error` 在最后那一段汇总里
    expect(detectUnhandledErrors(' Test Files  1 passed (1)\n\n⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯\n')).toBe(true)
    expect(detectUnhandledErrors(' Test Files  1 passed (1)\n      Tests  1 passed (1)\n     Errors  1 error\n')).toBe(true)
    expect(detectUnhandledErrors(' Test Files  1 failed (1)\n      Tests  2 failed (2)\n')).toBe(false)
    expect(detectUnhandledErrors('')).toBe(false)
    expect(detectUnhandledErrors(undefined)).toBe(false)

    // **嵌套文本不算数**（本轮实测踩到的假阳性）：断言台里再 spawn 一次 vitest 时，
    // 那一路的 reporter 输出会被外层当控制台输出打出来 —— 里面同样有 Unhandled Errors 段与 Errors 行。
    const nested = [
      ' ❯ tests/lib/fixtures/inventory-hook/unhandled.fixture.mjs (1 test) 8ms',
      '     Errors  1 error',
      '⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯',
      'Error: FIXTURE: NEW_UNHANDLED_ERROR',
      ' ✓ tests/lib/inventory-gate.test.mjs (20 tests) 6860ms',
      '',
      ' Test Files  1 passed (1)',
      '      Tests  20 passed (20)',
      '   Duration  7.53s',
    ].join('\n')
    expect(detectUnhandledErrors(nested), '嵌套的 reporter 文本不该被判成本轮的错误').toBe(false)

    // 用例名里出现这几个字（比如这条测试的名字）也不算
    const titled = ' ✓ tests/lib/inventory-gate.test.mjs (1 test)\n   ✓ 认 reporter 里的 Unhandled Errors / Errors 行\n\n Test Files  1 passed (1)\n      Tests  1 passed (1)\n'
    expect(detectUnhandledErrors(titled)).toBe(false)

    // 本轮真有未处理错误时，即使前面嵌了别的输出也要认出来
    expect(detectUnhandledErrors(`${nested}\n Test Files  1 passed (1)\n      Tests  1 passed (1)\n     Errors  1 error\n`)).toBe(true)
  })

  it('**真 vitest** 跑一遍未处理错误夹具：reporter 文本认得出它（形状假设由真 vitest 说了算）', () => {
    const reportPath = reportPathOf('unhandled-real')
    const run = runSuiteReport({
      vitest: join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs'),
      reportPath,
      repoRoot: process.cwd(),
      spawn: (command, args, options) => spawnSync(command, [...args, '--config', HOOK_FIXTURE_CONFIG], options),
      echo: () => {},
    })
    // JSON 报告里**看不出来**（这正是问题所在）：那个夹具文件是 passed、它的用例也是 passed。
    const unhandledResult = run.report.testResults.find((entry) => entry.name.endsWith('unhandled.fixture.mjs'))
    expect(unhandledResult?.status).toBe('passed')
    expect(unhandledResult?.assertionResults?.map((assertion) => assertion.status)).toEqual(['passed'])
    // 但 reporter 文本与退出码都看得出来
    expect(run.exitCode).toBe(1)
    expect(run.unhandledErrors, 'reporter 文本里应当有 Unhandled Errors 段').toBe(true)
    const current = collectReport(run.report, { repoRoot: process.cwd(), exitCode: run.exitCode, unhandledErrors: run.unhandledErrors })
    // 与已知红（hook / mixed 两个夹具里那条已知红）并存时也要报出来
    const { violations } = violationsFor({
      current,
      baseline: {
        files: { [HOOK_FIXTURE]: 1, [MIXED_FIXTURE]: 2, UNHANDLED_FIXTURE: 1 },
        knownRed: [{ file: MIXED_FIXTURE, title: 'known red', reason: '夹具已知红' }],
      },
    })
    expect(violations.some((violation) => /未处理错误/u.test(violation))).toBe(true)
  })

  it('退出码 1 但有已知红在跑（正常形状）→ 不触发兜底；没有退出码信息的合成报告也不触发', () => {
    const accounted = collectReport(
      { success: false, testResults: [{ name: '/repo/tests/a.test.mjs', status: 'failed', assertionResults: [{ title: 'x', status: 'failed' }] }] },
      { repoRoot: '/repo', exitCode: 1 },
    )
    expect(violationsFor({ current: accounted, baseline: { files: { 'tests/a.test.mjs': 1 }, knownRed: [{ file: 'tests/a.test.mjs', title: 'x', reason: '已知' }] } }).violations).toEqual([])

    const noExitInfo = collectReport(
      { success: true, testResults: [{ name: '/repo/tests/a.test.mjs', status: 'passed', assertionResults: [{ title: 'x', status: 'passed' }] }] },
      { repoRoot: '/repo' },
    )
    expect(violationsFor({ current: noExitInfo, baseline: { files: { 'tests/a.test.mjs': 1 }, knownRed: [] } }).violations).toEqual([])
  })

  it('**真实 vitest** 跑三个夹具（纯 hook + 已知红并存的混合 + afterAll 抛错）：形状与合成报告一致，门判红', () => {
    const reportPath = reportPathOf('hook-real')
    const run = runSuiteReport({
      vitest: join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs'),
      reportPath,
      repoRoot: process.cwd(),
      spawn: (command, args, options) => spawnSync(command, [...args, '--config', HOOK_FIXTURE_CONFIG], options),
    })
    const current = collectReport(run.report, { repoRoot: process.cwd(), exitCode: run.exitCode })
    // 真实形状：mixed 与 afterAll 两个夹具里各有一条已知红按用例记账（两者同名 `known red`）；
    // 三个文件都进了文件级失败 —— hook-failure / mixed 是「有没跑起来的用例」，
    // afterAll 是「跳过 0 条、只有文件级 message」（R1 的新形状）。
    const byFile = (a, b) => a.file.localeCompare(b.file)
    expect(current.failures.map(({ file, title }) => ({ file, title })).sort(byFile)).toEqual(
      [
        { file: AFTER_ALL_FIXTURE, title: 'known red' },
        { file: MIXED_FIXTURE, title: 'known red' },
      ].sort(byFile),
    )
    expect(current.suiteFailures.map((entry) => entry.file).sort()).toEqual(
      [HOOK_FIXTURE, MIXED_FIXTURE, AFTER_ALL_FIXTURE].sort(),
    )
    // R1 的关键实测：afterAll 的形状是「0 skipped + 文件级 message 非空」，与断言失败（message 空串）可区分。
    const afterAll = current.suiteFailures.find((entry) => entry.file === AFTER_ALL_FIXTURE)
    expect(afterAll?.skippedAssertions, 'afterAll 吃不到用例，所以没有 skipped').toBe(0)
    expect(afterAll?.message, 'afterAll 抛错时文件级 message 就是那次 hook 的错误文本').toBe('NEW_AFTER_ALL_ERROR')
    expect(run.exitCode).toBe(1)
    const { violations, known } = violationsFor({
      current,
      baseline: {
        files: { [HOOK_FIXTURE]: 1, [MIXED_FIXTURE]: 2, [AFTER_ALL_FIXTURE]: 1 },
        knownRed: [
          { file: MIXED_FIXTURE, title: 'known red', reason: '夹具已知红' },
          { file: AFTER_ALL_FIXTURE, title: 'known red', reason: '夹具已知红' },
        ],
      },
    })
    expect(known, '两个夹具里的已知红都照常豁免').toHaveLength(2)
    expect(violations, '三个文件的 hook 错误都必须被文件级失败拦下').toHaveLength(3)
    expect(violations.every((violation) => /文件级失败/u.test(violation))).toBe(true)
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
