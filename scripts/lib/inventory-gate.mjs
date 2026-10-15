/**
 * scripts/lib/inventory-gate.mjs —— 用例清单门的**判据**与**读报告**这两半（可单测的部分）。
 *
 * 为什么从 `scripts/check-test-inventory.mjs` 里拆出来：那一份是 bin，顶层就跑全仓 vitest 并
 * `process.exit`，于是它自己的「读报告」逻辑**从来没被任何用例验过** —— 而它正是本轮评审
 * 实测证明会撒谎的那一段：
 *
 *   - **假绿**：旧报告还在，测试进程崩了没写出新报告 → 门读到**上一轮**的报告，判「用例都在、
 *     都通过」。评审的故障注入探针（`.scratch/review-inventory-stale-probe.mjs`）把
 *     `spawnSync` 换成「exit 73、不写报告」，门照样打印「通过」并 exit 0。
 *   - **假红**：另一面是基线跟着环境变（`tests/assembly/assembly-contract.test.mjs` 未装 profile 时
 *     只收集 1 条 vs 基线 8 条）→ 干净 CI 上必红。用例数那一面的修法在测试文件本身（恒 8 条），
 *     这里只管「报告是不是这一轮的」。
 *
 * 三道判据（缺一条就是一个实测踩到的假绿形状）：
 *   1. **先删旧报告**：存在即「这一轮写的」——不给自己留读到旧文件的机会；
 *   2. **子进程起不来 / 报告没写出来** → 抛（不拿旧报告凑合）；
 *   3. **报告比这一轮启动还旧**（有人/别的进程又写了一份旧的） → 抛。
 *
 * 注意：**vitest 退出码非 0 是正常的** —— 已知红在跑（本例是 S1 两条），vitest 自己就 exit 1。
 * 「跑没跑完」的判据是**报告新鲜度**，不是退出码；把退出码当判据会把「已知红」误判成「没验」。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { relative, sep } from 'node:path'

/** 绝对路径 → 仓库相对 posix 路径（基线跨机器可比）。 */
export function toRepoPath(absolute, repoRoot) {
  return relative(repoRoot, absolute).split(sep).join('/')
}

/**
 * vitest JSON 报告 → `{files, failures, skipped, total}`。
 *
 * `files` 记的是**收集到的用例数**（含 skip）——「文件收集失败」在摘要里只是「passed 变少」，
 * 所以这里的 0 条与变少才是要抓的形状。
 */
export function collectReport(report, { repoRoot }) {
  const files = {}
  const failures = []
  let skipped = 0
  for (const result of report?.testResults ?? []) {
    const key = toRepoPath(result.name, repoRoot)
    const assertions = result.assertionResults ?? []
    files[key] = assertions.length
    for (const assertion of assertions) {
      if (assertion.status === 'failed') failures.push({ file: key, title: assertion.title })
      if (assertion.status !== 'passed' && assertion.status !== 'failed') skipped += 1
    }
  }
  return { files, failures, skipped, total: Object.values(files).reduce((sum, count) => sum + count, 0) }
}

/**
 * 这一轮结果 vs 基线 → 违规清单。
 *
 * 三条判据都指向「数量/身份」而不是「某条断言的值」：
 *   1. 文件收集到 0 条（收集期报错，用例从总数里静默消失）；
 *   2. 比基线少 / 文件消失（不许悄悄删或悄悄跳过）；
 *   3. 已知红名单之外的失败（名单在基线文件里逐条写明理由）。
 *
 * @returns {{violations: string[], known: Array<{file: string, title: string}>}}
 *          `known` 是**放过**的已知红（逐条打印，别静默）；用对象而不是拼好的字符串，
 *          免得调用方再去 `split('::')` —— 用例标题里出现 `::` 会被截断。
 */
export function violationsFor({ current, baseline }) {
  const violations = []
  const known = []

  for (const [file, count] of Object.entries(current.files)) {
    if (count === 0) violations.push(`收集失败：「${file}」收集到 0 条用例（收集期报错会让用例从总数里消失）`)
  }

  for (const [file, count] of Object.entries(baseline?.files ?? {})) {
    const now = current.files[file]
    if (now === undefined) violations.push(`文件消失：「${file}」这次没被收集（基线 ${count} 条）`)
    else if (now < count) violations.push(`用例变少：「${file}」${count} → ${now}（少了 ${count - now} 条；要么补回来，要么 --update 并说明为什么）`)
  }

  const knownRed = new Set((baseline?.knownRed ?? []).map((entry) => `${entry.file}\u0000${entry.title}`))
  for (const failure of current.failures) {
    if (knownRed.has(`${failure.file}\u0000${failure.title}`)) known.push({ file: failure.file, title: failure.title })
    else violations.push(`新失败：「${failure.file}」· ${failure.title}`)
  }

  return { violations, known }
}

/**
 * 跑一次 vitest 并**只接受这一轮写出来的**报告。
 *
 * @param {object} input
 * @param {string} input.vitest vitest 入口（`node_modules/vitest/vitest.mjs`）
 * @param {string} input.reportPath 报告落点（这一轮的唯一判据）
 * @param {string} input.repoRoot 工作目录（也是相对路径的基准）
 * @param {Function} [input.spawn] 进程启动器（缺省 `spawnSync`；断言台注入替身来复现「跑挂了」）
 * @param {Function} [input.now] 时钟（缺省 `Date.now`；断言台注入固定刻度）
 * @returns {{report: object, exitCode: number|null}} `exitCode` 非 0 可能是「有已知红」，不是失败信号
 * @throws {Error} 起不动 / 没写出报告 / 报告是旧的 / 报告不是合法 JSON —— 四种都**不许**继续比对
 */
export function runSuiteReport({ vitest, reportPath, repoRoot, spawn = spawnSync, now = Date.now }) {
  if (!existsSync(vitest)) {
    throw new Error(`找不到 vitest：${vitest}\n先跑 pnpm install --frozen-lockfile`)
  }
  // 判据 1：旧报告先删掉。删不掉就让下面的「报告是旧的」兜住，绝不静默读旧文件。
  rmSync(reportPath, { force: true })
  const startedAt = now()
  const run = spawn(process.execPath, [vitest, 'run', '--reporter=json', `--outputFile=${reportPath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  if (run?.error !== undefined && run.error !== null) {
    throw new Error(`测试进程起不来：${run.error.message}\n这一轮没有用例清单可比对，不许拿旧报告顶上。`)
  }
  // 判据 2：报告必须存在。测试进程半路死掉（崩溃 / 被杀）时它根本不会写。
  if (!existsSync(reportPath)) {
    throw new Error(`vitest 没写出报告（exit ${run?.status ?? 'null'}）——测试进程没跑完，这一轮**没有**可比对的用例清单；报告路径 ${reportPath}`)
  }
  // 判据 3：报告必须是这一轮写的（有人又塞了一份旧文件进来时拦住）。
  // 给 2 秒宽容：有些文件系统 mtime 粒度粗（1s / 2s），写在同一秒里的合法报告不该被判成旧件。
  const writtenAt = statSync(reportPath).mtimeMs
  if (writtenAt + 2_000 < startedAt) {
    throw new Error(`报告是**旧文件**（写于 ${new Date(writtenAt).toISOString()}，这一轮 ${new Date(startedAt).toISOString()} 才启动）：${reportPath}\n不许拿上一轮的报告当这一轮的结果。`)
  }
  try {
    return { report: JSON.parse(readFileSync(reportPath, 'utf8')), exitCode: run?.status ?? null }
  } catch (error) {
    throw new Error(`报告不是合法 JSON（测试进程写了一半就没了？exit ${run?.status ?? 'null'}）：${String(error?.message ?? error)}`)
  }
}
