#!/usr/bin/env node
/**
 * `scripts/check-test-inventory.mjs` —— **用例清单门**：让「测试悄悄消失」变成红的。
 *
 * 为什么需要它（实测踩到）：`tests/setup/pin.test.mjs` 在**收集期**读 `.scratch/` 里的离线证据副本，
 * 副本不在就 ENOENT → 整个文件收集失败 → 它的 9 条用例从总数里消失（1030 → 1021），
 * 而摘要只会显示「passed 变少」，失败名单里根本没有它。另一面：`skipIf(证据存在)` 会把
 * 「证据没了」渲染成「跳过」。两种失败都不会红在自己的名字上。
 *
 * 判据（都指向「数量/身份」而不是「某条断言的值」）：
 *   1. 任何测试文件**收集到 0 条**用例 → 红（收集期报错的形状）
 *   2. 任何文件的用例数**比基线少** / 文件消失 → 红（不许悄悄删或悄悄跳过）
 *   3. 出现**不在已知红名单里**的失败用例 → 红（已知红名单在基线文件里逐条写明理由）
 *   4. **文件级失败**（hook / suite 错误）→ 红：从专用 reporter 的结构化错误独立读取，
 *      不依赖跳过数或错误消息非空；空消息 afterAll 也算失败 ——
 *      已知红豁免的是跑过且失败的断言，豁免不了 hook / suite 抛错
 *   5. **未处理错误**（reporter 的 unhandledErrors）→ 红：它不进断言失败、`success` 也仍是 `true`，
 *      所以独立占一条；已知红不能替它背书
 *   6. **vitest 这一轮失败了却没有任何可核对的失败条目** → 红（报告 `success:false`，或退出码非 0
 *      而 `failures` / `suiteFailures` 都为空 —— 收集期失败 / 环境问题的兜底）
 *
 * 判据与「读报告」的实现收在 `scripts/lib/inventory-gate.mjs`（那份有单测：门的三种撒谎形状
 * 都是实测踩过的 —— 尤其「旧报告还在 → 门读到上一轮的通过结果」这一条）。
 *
 * **两份机器报告**：`json` 写断言清单，专用 reporter 写 `<报告路径>.errors.json`。
 * 两份都必须新鲜且覆盖相同文件；`default` 的打印只用于人看诊断，不参与错误判定。
 *
 * **退出码怎么用**（别按旧注释理解）：退出码**不是**「跑没跑完」的判据（那看报告新鲜度），
 * 也**不是**「有没有红」的判据（已知红在跑时 vitest 自己就 exit 1）；它只用在判据 6 的兜底里
 * （「一条失败都核不出来」时才看它）—— 除此之外一律以报告内容为准。
 *
 * 用法：
 *   node scripts/check-test-inventory.mjs              # 跑全仓 vitest 并比对（exit 1 = 有违规）
 *   node scripts/check-test-inventory.mjs --update     # 用当前结果刷新基线（新增用例/新增已知红时）
 *   node scripts/check-test-inventory.mjs --json out.json   # 顺带把原始报告留一份（贴数字用）
 *
 * 基线：`tests/test-inventory.json`（随仓库提交）。它记的是**收集到的用例数**（含 skip），
 * 这个数在本机与 CI 上应当一致；不一致就是有文件没被收集。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectReport, runSuiteReport, toRepoPath, violationsFor } from './lib/inventory-gate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const VITEST = join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const BASELINE_FILE = join(REPO_ROOT, 'tests', 'test-inventory.json')

const argv = process.argv.slice(2)
const update = argv.includes('--update')
const jsonFlag = argv.indexOf('--json')
const reportPath = jsonFlag === -1 ? join(REPO_ROOT, '.scratch', 'test-inventory-report.json') : resolve(argv[jsonFlag + 1])

/** 读报告这一步的失败一律 exit 2：**没验**与「验了但红了」是两件事，退出码要分得开。 */
let current
let exitCode
try {
  mkdirSync(dirname(reportPath), { recursive: true })
  const run = runSuiteReport({ vitest: VITEST, reportPath, repoRoot: REPO_ROOT })
  current = collectReport(run.report, { repoRoot: REPO_ROOT, exitCode: run.exitCode, unhandledErrors: run.unhandledErrors })
  exitCode = run.exitCode
} catch (error) {
  console.error(`[inventory] ${String(error?.message ?? error)}`)
  process.exit(2)
}
const baseline = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : null

if (update || baseline === null) {
  const knownRed = baseline?.knownRed ?? current.failures.map((failure) => ({ ...failure, reason: '初次记录，待逐条确认' }))
  writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify(
      {
        note: '用例清单基线：收集到的用例数（含 skip）。--update 刷新；knownRed 之外的失败 = 违规。',
        total: current.total,
        files: current.files,
        knownRed,
      },
      null,
      2,
    )}\n`,
  )
  console.log(`[inventory] 基线${baseline === null ? '不存在，已创建' : '已刷新'}：${toRepoPath(BASELINE_FILE, REPO_ROOT)}（${current.total} 条用例 / ${Object.keys(current.files).length} 个文件）`)
  for (const entry of knownRed) console.log(`[inventory]   已知红：${entry.file} · ${entry.title}（${entry.reason}）`)
  process.exit(0)
}

const { violations, known } = violationsFor({ current, baseline })
for (const entry of known) {
  console.log(`[inventory] 已知红（放过）：${entry.file} · ${entry.title}`)
}

console.log(
  `[inventory] 用例 ${current.total} 条（基线 ${baseline.total}）/ 文件 ${Object.keys(current.files).length} 个 / 失败 ${current.failures.length} 条（已知红 ${known.length} 条）`
  + ` / 文件级失败 ${current.suiteFailures.length} 个 / 跳过 ${current.skipped} 条 / vitest exit ${exitCode ?? 'null'}`,
)
if (violations.length > 0) {
  console.error(`\n[inventory] 违规 ${violations.length} 条：`)
  for (const violation of violations) console.error(`  ✗ ${violation}`)
  console.error('\n[inventory] 这是清单门，不是断言台：断言红绿看测试本身；这里只问「用例还在不在、数对不对、有没有整个文件没跑成」。')
  process.exit(1)
}
console.log('[inventory] 通过：没有用例消失、没有已知红之外的失败、没有文件级失败。')
