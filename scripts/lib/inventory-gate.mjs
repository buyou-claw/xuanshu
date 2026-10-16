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
 * vitest JSON 报告 → `{files, failures, suiteFailures, skipped, total, reportFailed, exitCode, unhandledErrors}`。
 *
 * `files` 记的是**收集到的用例数**（含 skip）——「文件收集失败」在摘要里只是「passed 变少」，
 * 所以这里的 0 条与变少才是要抓的形状。
 *
 * **`suiteFailures` 是 hook / suite 错误的独立台账**（评审三轮实测出来的三类形状）：
 *   - **整文件没跑起来**：`beforeAll` 抛错时文件 `status:'failed'` + 用例全 `skipped`
 *     （`numFailedTests: 0`、`success: false`）——只看 `assertion.status === 'failed'` 完全漏掉；
 *   - **与已知红并存**（复核 48e0e0a 的 N1）：同一个文件里一条已知红断言 + 另一个 describe 的
 *     `beforeAll` 抛错 —— 文件里有失败断言，**但那些 skipped 的用例不是已知红**
 *     （已知红名单豁免的是「跑过且失败」的断言，豁免不了「没跑起来」的用例）。
 *   - **与已知红并存、且没有 skipped**（复核 32216d9 的 R1）：`afterAll` 在断言**全部执行完**之后
 *     抛错 —— 文件里有失败断言（已知红）、跳过 0 条，于是上面两条形状都不成立，hook 错误整个漏掉
 *     （`.scratch/review-322-standards/after-all-report.json` 实测：`exit=1 / success=false`、
 *     `numFailedTests:1 / numPendingTests:0`，门却 `suiteFailures=[] / violations=[]`）。
 *     这一类唯一的报告信号是**文件级 `result.message`**：afterAll 抛错时它正好是那次 hook 的错误文本
 *     （实测 `'NEW_AFTER_ALL_ERROR'`），而**纯断言失败时它是空串**（同目录 `mixed-report.json`、
 *     本仓 `assembly-contract.test.mjs` 的真实报告都是 `''`）。
 *   判据因此是：**文件 failed 且（没有失败断言，或有被跳过的用例，或文件级 message 非空）**——
 *   三种都进 `suiteFailures`，断言失败另由 `failures` 逐条对已知红名单。
 *
 * **未处理错误只能从 reporter 文本看出来**（复核 48e0e0a 的 N1 第二半）：JSON 报告在那种情况下
 * `success` 仍是 `true`、0 条失败、也没有文件级失败，**唯一**的信号是 default reporter 打印的
 * `⎯⎯ Unhandled Errors ⎯⎯` 段与 `Errors  N error` 汇总行（退出码 1 也一样，但「退出码 1」在已知红
 * 在跑时本来就会出现，单独用它判不出来）。所以 `unhandledErrors` 由调用方从 reporter 文本扫出来传进来，
 * 与断言失败**各自独立**记账 —— 已知红不能替它背书。
 *
 * @param {object} report vitest JSON 报告
 * @param {{repoRoot?: string, exitCode?: number|null, unhandledErrors?: boolean}} [options]
 */
export function collectReport(report, { repoRoot, exitCode, unhandledErrors } = {}) {
  const files = {}
  const failures = []
  const suiteFailures = []
  let skipped = 0
  for (const result of report?.testResults ?? []) {
    const key = toRepoPath(result.name, repoRoot)
    const assertions = result.assertionResults ?? []
    files[key] = assertions.length
    let failedAssertions = 0
    let skippedAssertions = 0
    for (const assertion of assertions) {
      if (assertion.status === 'failed') {
        failedAssertions += 1
        failures.push({ file: key, title: assertion.title })
      }
      if (assertion.status !== 'passed' && assertion.status !== 'failed') skippedAssertions += 1
    }
    skipped += skippedAssertions
    // 文件级失败：用例根本没能跑（hook/suite 抛错），或同文件里失败与「没跑起来」并存，
    // 或 hook 在断言全部跑完之后才抛（`afterAll`：没有 skipped、只有文件级 message —— 复核 32216d9 的 R1）。
    // 有失败断言**不能**解释 skipped 的用例 —— 那是两件事，已知红名单只管前者。
    const suiteMessage = typeof result.message === 'string' ? result.message : ''
    if (result.status === 'failed' && (failedAssertions === 0 || skippedAssertions > 0 || suiteMessage !== '')) {
      suiteFailures.push({ file: key, message: suiteMessage, skippedAssertions })
    }
  }
  return {
    files,
    failures,
    suiteFailures,
    skipped,
    total: Object.values(files).reduce((sum, count) => sum + count, 0),
    reportFailed: report?.success === false,
    exitCode: exitCode ?? null,
    unhandledErrors: unhandledErrors === true,
  }
}

/**
 * 这一轮结果 vs 基线 → 违规清单。
 *
 * 判据都指向「数量/身份」而不是「某条断言的值」：
 *   1. 文件收集到 0 条（收集期报错，用例从总数里静默消失）；
 *   2. 比基线少 / 文件消失（不许悄悄删或悄悄跳过）；
 *   3. 已知红名单之外的**用例级**失败（名单在基线文件里逐条写明理由）；
 *   4. **文件级失败**（hook / suite 错误）：要么整个文件没跑起来，要么同文件里失败断言与
 *      没跑起来的用例并存，要么 hook 在断言跑完之后才抛（`afterAll`：文件级 message 非空、
 *      跳过 0 条 —— 复核 32216d9 的 R1）—— 已知红名单豁免的是「跑过且失败」的断言，
 *      豁免不了没跑起来的用例，也豁免不了 hook 抛错这件事本身。
 *      这一条没有豁免名单：真要有已知的文件级失败，先把它变成一条看得见的失败用例再谈豁免。
 *      **接受的代价**（JSON 报告里没有更细的信号，已实测）：
 *      ① `it.skipIf` 那种**刻意跳过**也会被算进「没跑起来的用例」—— 所以「一个文件既有已知红断言、
 *         又有刻意跳过」会误红。真遇上，就把它拆开（跳过与失败别同文件，或先修掉已知红），别放宽判据；
 *      ② 第三类证据认的是**上游 reporter 给的 `result.message`**（与 `detectUnhandledErrors` 同一条纪律：
 *         只在钉版 ADR-0004 上成立，换 vitest 版本要跟着复核 —— 真 vitest 夹具钉着它）。
 *         若某个**已登记已知红**的文件将来带上非空文件级 message（上游改了报告形状），它会从「放过」
 *         变成文件级失败违规。这是**刻意的失败方向**：宁可让人去看一眼，也不许把 hook 错误当已知红放过去。
 *      两条合计的取向一致：漏报 hook 错误的代价（测试整批没跑而门说通过）比误红一次大得多。
 *   5. **未处理错误**（vitest reporter 的 `Unhandled Errors` 段）：它不进断言失败、`success` 也仍是
 *      `true`，所以必须**独立**占一条判据 —— 仓库常态有已知红在跑，任何「没有任何失败时才看它」的写法
 *      等于没看（复核 48e0e0a 的 N1 第二半实测）；
 *   6. **vitest 自己说失败了却核不出条目**：报告 `success=false`，或**退出码非 0**而
 *      `failures` 与 `suiteFailures` 都为空（收集期失败 / 环境问题的兜底）。退出码只在这条兜底里用，
 *      别扩成总判据（已知红在跑时 vitest 自己就 exit 1）。
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

  for (const failure of current.suiteFailures ?? []) {
    const detail = failure.message === '' ? '' : `：${failure.message.slice(0, 200)}`
    const skippedNote = failure.skippedAssertions > 0 ? `（另有 ${failure.skippedAssertions} 条用例没跑起来）` : ''
    violations.push(
      `文件级失败（hook / suite 错误）${skippedNote}：「${failure.file}」${detail}`
      + ' —— 已知红豁免的是跑过且失败的断言，豁免不了 hook / suite 抛错（以及因此没跑起来的用例）；'
      + '若那几条是刻意的 it.skipIf，请把它们与失败分开（或先修掉已知红）再谈豁免。',
    )
  }

  // 未处理错误：**独立于断言失败**的一条判据（复核 48e0e0a 的 N1）。
  // 它必须自己占一条 —— 仓库常态就有已知红在跑，任何「只有在没有任何失败时才看它」的写法都等于没看。
  if (current.unhandledErrors === true) {
    violations.push('未处理错误（vitest reporter 打了 Unhandled Errors）：这类错误不计入断言失败，已知红也不能替它背书 —— 先看 reporter 里那一段堆栈')
  }

  // 两条兜底都指向「vitest 说这一轮失败，却没有任何可核对的失败条目」：
  //   - 报告 success=false（收集期 / 环境问题的形状）；
  //   - 退出 1 但报告干净 —— 未处理错误的报告 success 仍是 true（复核实测）。
  // 注意：这条只兜「一条失败都核不出来」的情况；未处理错误与已知红并存时由上面那条独立判据抓。
  const nothingAccounted = current.failures.length === 0 && (current.suiteFailures ?? []).length === 0
  if (nothingAccounted && (current.reportFailed === true || (typeof current.exitCode === 'number' && current.exitCode > 0))) {
    violations.push('vitest 这一轮失败了（success=false 或退出码非 0），但没有任何可核对的失败条目 —— 未处理错误 / 环境问题？先看 vitest 的 stderr')
  }

  return { violations, known }
}

/**
 * 跑一次 vitest 并**只接受这一轮写出来的**报告。
 *
 * 用两个 reporter：`json` 写报告文件（机器判据），`default` 写 stdout（人看的进度 + **未处理错误**）。
 * `default` 那一路是被**捕获后回放**的：JSON 报告里根本不含未处理错误（`success` 仍是 `true`），
 * 唯一能看出它的是 reporter 文本里的 `Unhandled Errors` 段 / `Errors  N error` 汇总行 ——
 * 而这段文本只有把 stdout 抓下来才拿得到（原先 stdout 是 `ignore`，等于没有）。
 *
 * @param {object} input
 * @param {string} input.vitest vitest 入口（`node_modules/vitest/vitest.mjs`）
 * @param {string} input.reportPath 报告落点（这一轮的唯一判据）
 * @param {string} input.repoRoot 工作目录（也是相对路径的基准）
 * @param {Function} [input.spawn] 进程启动器（缺省 `spawnSync`；断言台注入替身来复现「跑挂了」）
 * @param {Function} [input.now] 时钟（缺省 `Date.now`；断言台注入固定刻度）
 * @param {Function} [input.echo] reporter 文本的回放入口（缺省写 `process.stdout`；断言台注入收集器）
 * @returns {{report: object, exitCode: number|null, unhandledErrors: boolean, reporterText: string}}
 * @throws {Error} 起不动 / 没写出报告 / 报告是旧的 / 报告不是合法 JSON —— 四种都**不许**继续比对
 */
export function runSuiteReport({ vitest, reportPath, repoRoot, spawn = spawnSync, now = Date.now, echo = (text) => process.stdout.write(text) }) {
  if (!existsSync(vitest)) {
    throw new Error(`找不到 vitest：${vitest}\n先跑 pnpm install --frozen-lockfile`)
  }
  // 判据 1：旧报告先删掉。删不掉就让下面的「报告是旧的」兜住，绝不静默读旧文件。
  rmSync(reportPath, { force: true })
  const startedAt = now()
  const run = spawn(process.execPath, [vitest, 'run', '--reporter=default', '--reporter=json', `--outputFile=${reportPath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (run?.error !== undefined && run.error !== null) {
    throw new Error(`测试进程起不来：${run.error.message}\n这一轮没有用例清单可比对，不许拿旧报告顶上。`)
  }
  const reporterText = typeof run?.stdout === 'string' ? run.stdout : ''
  if (reporterText !== '') echo(reporterText)
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
    return {
      report: JSON.parse(readFileSync(reportPath, 'utf8')),
      exitCode: run?.status ?? null,
      unhandledErrors: detectUnhandledErrors(reporterText),
      reporterText,
    }
  } catch (error) {
    throw new Error(`报告不是合法 JSON（测试进程写了一半就没了？exit ${run?.status ?? 'null'}）：${String(error?.message ?? error)}`)
  }
}

/**
 * reporter 文本里有没有**这一轮自己**的未处理错误（复核 48e0e0a 的 N1 第二半）。
 *
 * 认的是 vitest 4 的 default reporter 自己打的两种形状：分节标题 `⎯⎯ Unhandled Errors ⎯⎯`
 * 与汇总行 `Errors  N error`。这是**上游打印格式**，所以只在钉版（ADR-0004）上成立 ——
 * 换 vitest 版本时这条判据要跟着复核（`tests/lib/inventory-gate.test.mjs` 有真 vitest 夹具钉着它）。
 *
 * **只看最后一段汇总块**（从最后一个 `Test Files …` 行到结尾）：断言台里会再 spawn 一次 vitest
 * （清单门自己的单测就是这样），那一路的 reporter 文本会被外层 reporter 当控制台输出打出来 ——
 * 其中就包含它自己的 `Unhandled Errors` 段与 `Errors 1 error` 行。整篇搜会被这种**嵌套文本**骗到
 * （本轮实测踩过：门对着全仓套件报了 1 条假违规）。汇总块是**本进程**打的，只有它算数。
 *
 * @param {string} reporterText default reporter 的 stdout
 */
export function detectUnhandledErrors(reporterText) {
  if (typeof reporterText !== 'string' || reporterText === '') return false
  const lines = reporterText.split(/\r?\n/u)
  let start = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^\s*Test Files\s+\d/u.test(lines[index])) { start = index; break }
  }
  const ownSummary = (start === -1 ? lines : lines.slice(start)).join('\n')
  return /⎯+\s*Unhandled Errors\s*⎯+/u.test(ownSummary) || /^\s*Errors\s+\d+ errors?\s*$/mu.test(ownSummary)
}
