#!/usr/bin/env node
/**
 * `scripts/check-test-inventory.mjs` —— **用例清单门**：让「测试悄悄消失」变成红的。
 *
 * 为什么需要它（本轮实测踩到）：`tests/setup/pin.test.mjs` 在**收集期**读 `.scratch/` 里的离线证据副本，
 * 副本不在就 ENOENT → 整个文件收集失败 → 它的 9 条用例从总数里消失（1030 → 1021），
 * 而摘要只会显示「passed 变少」，失败名单里根本没有它。另一面：`skipIf(证据存在)` 会把
 * 「证据没了」渲染成「跳过」。两种失败都不会红在自己的名字上。
 *
 * 三条判据（都指向「数量/身份」而不是「某条断言的值」）：
 *   1. 任何测试文件**收集到 0 条**用例 → 红（收集期报错的形状）
 *   2. 任何文件的用例数**比基线少** / 文件消失 → 红（不许悄悄删或悄悄跳过）
 *   3. 出现**不在已知红名单里**的失败用例 → 红（已知红名单在基线文件里逐条写明理由）
 *
 * 用法：
 *   node scripts/check-test-inventory.mjs              # 跑全仓 vitest 并比对（exit 1 = 有违规）
 *   node scripts/check-test-inventory.mjs --update     # 用当前结果刷新基线（新增用例/新增已知红时）
 *   node scripts/check-test-inventory.mjs --json out.json   # 顺带把原始报告留一份（贴数字用）
 *
 * 基线：`tests/test-inventory.json`（随仓库提交）。它记的是**收集到的用例数**（含 skip），
 * 这个数在本机与 CI 上应当一致；不一致就是有文件没被收集。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const VITEST = join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const BASELINE_FILE = join(REPO_ROOT, 'tests', 'test-inventory.json')

const argv = process.argv.slice(2)
const update = argv.includes('--update')
const jsonFlag = argv.indexOf('--json')
const reportPath = jsonFlag === -1 ? join(REPO_ROOT, '.scratch', 'test-inventory-report.json') : resolve(argv[jsonFlag + 1])

/** 把绝对路径写成仓库相对的 posix 路径（基线跨机器可比）。 */
const rel = (absolute) => relative(REPO_ROOT, absolute).split(sep).join('/')

function runSuite() {
  if (!existsSync(VITEST)) {
    console.error(`[inventory] 找不到 vitest：${VITEST}\n[inventory] 先跑 pnpm install --frozen-lockfile`)
    process.exit(2)
  }
  mkdirSync(dirname(reportPath), { recursive: true })
  const run = spawnSync(process.execPath, [VITEST, 'run', '--reporter=json', `--outputFile=${reportPath}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  if (!existsSync(reportPath)) {
    console.error(`[inventory] vitest 没写出报告（exit ${run.status}）；报告路径 ${reportPath}`)
    process.exit(2)
  }
  return JSON.parse(readFileSync(reportPath, 'utf8'))
}

function collect(report) {
  const files = {}
  const failures = []
  for (const result of report.testResults ?? []) {
    const key = rel(result.name)
    const assertions = result.assertionResults ?? []
    files[key] = assertions.length
    for (const assertion of assertions) {
      if (assertion.status === 'failed') failures.push({ file: key, title: assertion.title })
    }
  }
  return { files, failures, total: Object.values(files).reduce((n, count) => n + count, 0) }
}

const report = runSuite()
const current = collect(report)
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
  console.log(`[inventory] 基线${baseline === null ? '不存在，已创建' : '已刷新'}：${rel(BASELINE_FILE)}（${current.total} 条用例 / ${Object.keys(current.files).length} 个文件）`)
  for (const entry of knownRed) console.log(`[inventory]   已知红：${entry.file} · ${entry.title}（${entry.reason}）`)
  process.exit(0)
}

const violations = []

// 1) 收集到 0 条的（= 收集期报错，静默消失的那种）
for (const [file, count] of Object.entries(current.files)) {
  if (count === 0) violations.push(`收集失败：「${file}」收集到 0 条用例（收集期报错会让用例从总数里消失）`)
}

// 2) 比基线少 / 消失
for (const [file, count] of Object.entries(baseline.files ?? {})) {
  const now = current.files[file]
  if (now === undefined) violations.push(`文件消失：「${file}」这次没被收集（基线 ${count} 条）`)
  else if (now < count) violations.push(`用例变少：「${file}」${count} → ${now}（少了 ${count - now} 条；要么补回来，要么 --update 并说明为什么）`)
}

// 3) 已知红之外的失败
const knownRed = new Set((baseline.knownRed ?? []).map((entry) => `${entry.file}::${entry.title}`))
for (const failure of current.failures) {
  const key = `${failure.file}::${failure.title}`
  if (!knownRed.has(key)) violations.push(`新失败：「${failure.file}」· ${failure.title}`)
  else console.log(`[inventory] 已知红（放过）：${failure.file} · ${failure.title}`)
}

console.log(
  `[inventory] 用例 ${current.total} 条（基线 ${baseline.total}）/ 文件 ${Object.keys(current.files).length} 个 / 失败 ${current.failures.length} 条（已知红 ${knownRed.size} 条）`,
)
if (violations.length > 0) {
  console.error(`\n[inventory] 违规 ${violations.length} 条：`)
  for (const violation of violations) console.error(`  ✗ ${violation}`)
  console.error('\n[inventory] 这是清单门，不是断言台：断言红绿看测试本身；这里只问「用例还在不在、数对不对」。')
  process.exit(1)
}
console.log('[inventory] 通过：没有用例消失、没有已知红之外的失败。')
