/**
 * 清单门的报告读取与判据。JSON reporter 提供断言清单；专用 reporter
 * 通过 TestModule/TestSuite.errors() 与 onTestRunEnd 的 unhandledErrors
 * 提供独立错误事实。两份报告都必须是本轮完整产物。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ERROR_REPORTER = fileURLToPath(new URL('./inventory-error-reporter.mjs', import.meta.url))

/** 绝对路径 → 仓库相对 posix 路径（基线跨机器可比）。 */
export function toRepoPath(absolute, repoRoot) {
  return relative(repoRoot, absolute).split(sep).join('/')
}

/**
 * 汇总断言与独立错误。runSuiteReport() 附带结构化错误时以它为准；
 * 只读旧 JSON 的调用方保留原启发式兼容，但该格式本身无法证明没有空消息 hook 错误。
 */
export function collectReport(report, { repoRoot, exitCode, unhandledErrors } = {}) {
  const files = {}
  const failures = []
  const suiteFailures = []
  const structured = report?.xuanshuErrors
  const errorsByFile = structured === undefined ? null : new Map(structured.modules.map((entry) => [toRepoPath(entry.name, repoRoot), entry.errors]))
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
    // 结构化错误与断言互不豁免；只有旧 JSON 读面才退回历史启发式。
    const suiteMessage = typeof result.message === 'string' ? result.message : ''
    const errors = errorsByFile?.get(key) ?? []
    if (errorsByFile !== null ? errors.length > 0 : result.status === 'failed' && (failedAssertions === 0 || skippedAssertions > 0 || suiteMessage !== '')) {
      suiteFailures.push({ file: key, message: errors.length > 0 ? errors.map((error) => error.message || error.name).join('\n') : suiteMessage, skippedAssertions })
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
    unhandledErrors: structured === undefined ? unhandledErrors === true : structured.unhandledErrors.length > 0,
  }
}

/**
 * 文件数与用例数不得缩水；已知红只豁免列明的断言。
 * suite/hook 与未处理错误独立判违规，没有豁免名单。
 * 退出码仅兜底没有任何失败条目的异常运行，已知红运行的 exit 1 本身不是违规。
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
      + ' —— 已知红只豁免断言，不能豁免 hook / suite 错误。',
    )
  }

  // 未处理错误：**独立于断言失败**的一条判据（复核 48e0e0a 的 N1）。
  // 它必须自己占一条 —— 仓库常态就有已知红在跑，任何「只有在没有任何失败时才看它」的写法都等于没看。
  if (current.unhandledErrors === true) {
    violations.push('未处理错误（Vitest 独立错误报告）：这类错误不计入断言失败，已知红也不能替它背书 —— 先看 reporter 里那一段堆栈')
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
 * 跑一次 Vitest，读取本轮断言报告和结构化错误报告。
 * 子进程失败、报告缺失、过期、不合法或文件覆盖不完整均抛错，禁止拿旧报告判绿。
 * spawn / now / echo 是进程、时钟与诊断输出的测试接缝。
 */
export function runSuiteReport({ vitest, reportPath, repoRoot, spawn = spawnSync, now = Date.now, echo = (text) => process.stdout.write(text) }) {
  if (!existsSync(vitest)) {
    throw new Error(`找不到 vitest：${vitest}\n先跑 pnpm install --frozen-lockfile`)
  }
  // 判据 1：旧报告先删掉。删不掉就让下面的「报告是旧的」兜住，绝不静默读旧文件。
  rmSync(reportPath, { force: true })
  const errorsPath = `${reportPath}.errors.json`
  rmSync(errorsPath, { force: true })
  const startedAt = now()
  const run = spawn(process.execPath, [vitest, 'run', '--reporter=default', '--reporter=json', `--reporter=${ERROR_REPORTER}`, `--outputFile=${reportPath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, XUANSHU_TEST_ERRORS_FILE: errorsPath },
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
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    if (!existsSync(errorsPath)) throw new Error(`缺少结构化错误报告：${errorsPath}`)
    if (statSync(errorsPath).mtimeMs + 2_000 < startedAt) throw new Error(`结构化错误报告是旧文件：${errorsPath}`)
    const errors = JSON.parse(readFileSync(errorsPath, 'utf8'))
    if (errors?.schema !== 'xuanshu/test-errors@1' || !Array.isArray(errors.modules) || !Array.isArray(errors.unhandledErrors)
      || errors.modules.some((entry) => typeof entry?.name !== 'string' || !Array.isArray(entry.errors))) {
      throw new Error('结构化错误报告形状不合法')
    }
    const covered = new Set(errors.modules.map((entry) => toRepoPath(entry.name, repoRoot)))
    const expected = new Set((report.testResults ?? []).map((entry) => toRepoPath(entry.name, repoRoot)))
    if (covered.size !== expected.size || [...expected].some((name) => !covered.has(name))) {
      throw new Error('结构化错误报告缺少已收集的测试文件')
    }
    return {
      report: { ...report, xuanshuErrors: errors },
      exitCode: run?.status ?? null,
      unhandledErrors: errors.unhandledErrors.length > 0,
      reporterText,
    }
  } catch (error) {
    throw new Error(`报告不是合法 JSON（测试进程写了一半就没了？exit ${run?.status ?? 'null'}）：${String(error?.message ?? error)}`)
  }
}

/** 兼容旧 reporter 文本的读面；生产 runner 使用结构化错误，不依赖打印格式。 */
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
