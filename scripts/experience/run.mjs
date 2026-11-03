#!/usr/bin/env node
/**
 * `scripts/experience/run.mjs` —— **实操评估 runner**（Spec 04 · 票 #77）。
 *
 * 一条命令跑完一条真实任务，并把过程落成一份可复算的证据包：
 *
 *   node scripts/experience/run.mjs --scenario consult-no-model \
 *     --out ux-reports/experience-round-01 --phase task-before
 *
 * 它做的四件事（一件都不多做）：
 *   1. **自己拉起体验实例**（复用 `startIsolatedInstance`：诱饵是独立 home + 独立端口）；
 *   2. 起自己的浏览器、开 tracing，把场景交出去跑（场景在 `scenarios/`，本文件不懂业务）；
 *   3. 把结果写成固定文件名的证据包（`evidence.mjs` 负责「一行长什么样」，这里负责「落在哪」）；
 *   4. 收尾只关**自己的**浏览器与实例，然后核对端口真的不再可连。
 *
 * 五条不许越过的线（ADR-0017）：
 *   - 不写 token 到盘、不留常驻凭据文件：`?token=` 只用于认证握手，进证据前一律 `sanitizeUrl`；
 *   - 不杀占用端口的任意进程、不删体验 home（默认保留；`--drop-home` 是**人显式**要求清理）；
 *   - 不用强制点击 / 内部 RPC 代替表单（那在场景里，见 `scenarios/consult.mjs` 的头注释）；
 *   - 覆盖表只写执行到的事实：没跑完的用例记 `blocked` 或「超时未完成」，**不许提前填通过**；
 *   - 执行期间持续说「正在等什么」（stderr），别让长任务看起来像卡死。
 *
 * 退出码（写死在 `--help` 里，别按「0/1」理解）：
 *   0 = 证据齐全且全部用例 `pass`
 *   2 = 输入 / 环境没就绪（参数错、客户端产物落后、没有 playwright）——**这一轮没跑起来**
 *   3 = 跑了但没走满（有用例 `fail` / `blocked`，或场景中断）——证据照旧落盘，看 `coverage.json`
 *
 * 仅使用 Node 内置模块（playwright 由宿主环境提供，本仓不装它）。ESM。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  EVIDENCE_FILES,
  EvidenceError,
  assertEvidenceDir,
  coverageDocument,
  errorsDocument,
  sanitizeUrl,
  stepLine,
} from './evidence.mjs'
import {
  defaultLaunchHeadless,
  defaultReadEdge,
  defaultResolvePlaywright,
  probeEnvironment,
} from './probe-env.mjs'
import { checkClientArtifact, resolvePlaywright, startIsolatedInstance } from '../ux/collect/browser.mjs'
import { createBootSequence } from './instance-lifecycle.mjs'
import { SCENARIOS, SCENARIO_IDS } from './scenarios/index.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 退出码闭集（与 `--help` 同源）。 */
export const EXIT = Object.freeze({ ok: 0, usage: 2, incomplete: 3 })

/** 体验 home 的默认落点（ADR-0017 第 10 条：`.experience-home/` 已 gitignore）。 */
export const DEFAULT_HOME = '.experience-home/round-01'

/**
 * 阶段名的形状：**安全短名**。
 *
 * 它是目录名的一部分（`<out>/<phase>/`），所以不允许分隔符、不允许 `..`、不允许空格与大小写——
 * 一个能写到别的目录去的阶段名，就是把「证据落在 ux-reports 下」这条断言从后门破掉。
 */
export const PHASE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,23}$/u

/**
 * 「场景结束时的环境快照」的文件名。
 * 为什么是第二个文件而不是同一个文件里的第二个对象：一份 JSON 里塞两段，读的人永远不知道该看哪段；
 * 两份固定文件名（起 / 止）可以直接 diff，也能各自被报告引用。
 */
export const ENVIRONMENT_END_FILE = 'environment-end.json'

/**
 * 场景附加证据文件的文件名形状（票 #80 新增）。
 *
 * 场景除了固定六件之外，偶尔要交一份自己的结构化记录（E07 的 `restart-boots.json`：
 * 两次实例的 port / 起止时间 / 时长 / 是否同 home）。文件名由**场景**写死，runner 只负责
 * 校验它是「一个文件」而不是一段路径——带分隔符的名字会把证据写到别的目录去。
 */
export const EVIDENCE_FILE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}\.json$/u

/**
 * 校验场景附加证据文件的文件名。
 * @param {string} name
 * @returns {string} 原样返回
 * @throws {EvidenceError}
 */
export function assertEvidenceFileName(name) {
  if (typeof name !== 'string' || name.trim() === '') throw new EvidenceError('附加证据文件名必须是非空字符串')
  const fileName = name.trim()
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new EvidenceError(`附加证据文件名只能是文件名（不含目录分隔符与 ..），收到「${fileName}」`)
  }
  if (!EVIDENCE_FILE_PATTERN.test(fileName)) {
    throw new EvidenceError(`附加证据文件名必须是形如 restart-boots.json 的安全短名（小写字母数字与 . _ -，≤64 字符，以 .json 结尾），收到「${fileName}」`)
  }
  return fileName
}

/** 场景开始 / 结束两份环境快照的 schema 标签（与覆盖表 schema 同一族命名）。 */
const ENVIRONMENT_SCHEMA = 'xuanshu/experience-environment@1'

/** 每个错误类最多留多少行：证据要能看出「哪一类、哪一句」，不负责搬整份控制台。 */
const MAX_ERROR_ROWS = 40

/** 可读的输入问题（调用方按它退 2，不当成断言红）。 */
export class RunError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RunError'
  }
}

const HELP = `用法：node scripts/experience/run.mjs --scenario <id> --out <dir> --phase <名> [--home <dir>] [--keep-home|--drop-home] [--help]
  --scenario <id>   要跑的场景（当前：${SCENARIO_IDS.join(' / ')}）
  --out <dir>       证据落点，必须形如 ux-reports/experience-<轮次>（其余形状一律拒绝）
  --phase <名>      阶段名（安全短名：小写字母数字与 . _ -，≤24 字符），落在 <out>/<名>/ 下
  --home <dir>      体验 home（默认 ${DEFAULT_HOME}）；同一 home 可跨轮复用来验「离开后再回来」
  --keep-home       进程退出后保留体验 home（默认行为）
  --drop-home       显式要求清理本次 home（只给自己一次性造的临时 home 用）
  --help            打印本说明
退出码：0 = 证据齐全且全部用例 pass
        2 = 输入 / 环境没就绪（参数错、客户端产物落后、没有 playwright）——这一轮没跑起来
        3 = 跑了但没走满（有 fail / blocked 或场景中断）——证据照旧落盘，看 coverage.json
本命令只用系统 Edge（channel msedge）的无头实例，不下载 Chromium；不杀占用端口的其它进程，
不删体验 home（除非显式 --drop-home）；不写 token 到盘。`

/**
 * 解析命令行。**只做形状判断**，不碰文件系统、不起进程——所以非法输入能在任何机器上被测。
 *
 * @param {string[]} argv
 * @returns {{scenario: string, out: string, phase: string, home: string, keepHome: boolean, help: boolean}}
 * @throws {RunError} 缺参数 / 未知参数 / 形状不对
 */
export function parseRunArgs(argv) {
  const opts = { scenario: null, out: null, phase: null, home: DEFAULT_HOME, keepHome: true, help: false }
  let keepHomeFlag = false
  let dropHomeFlag = false
  const valueOf = (flag, index) => {
    const value = argv[index]
    if (value === undefined) throw new RunError(`${flag} 需要一个值`)
    return value
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--scenario') opts.scenario = valueOf(arg, ++index)
    else if (arg === '--out') opts.out = valueOf(arg, ++index)
    else if (arg === '--phase') opts.phase = valueOf(arg, ++index)
    else if (arg === '--home') opts.home = valueOf(arg, ++index)
    else if (arg === '--keep-home') { opts.keepHome = true; keepHomeFlag = true }
    else if (arg === '--drop-home') { opts.keepHome = false; dropHomeFlag = true }
    else if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg.startsWith('--')) throw new RunError(`未知参数：${arg}（用法见 --help）`)
  }
  if (opts.help) return opts
  // 两个开关表达相反的意图：同时给的时候静默取一个 = 把「删不删 home」变成运气。
  if (keepHomeFlag && dropHomeFlag) throw new RunError('--keep-home 与 --drop-home 互斥，只能给一个（删除是显式动作）')
  if (opts.scenario === null) throw new RunError(`缺少 --scenario（当前可选：${SCENARIO_IDS.join(' / ')}）`)
  if (SCENARIOS[opts.scenario] === undefined) {
    throw new RunError(`未知场景「${opts.scenario}」——当前可选：${SCENARIO_IDS.join(' / ')}`)
  }
  if (opts.out === null) throw new RunError('缺少 --out（形如 ux-reports/experience-round-01）')
  try {
    assertEvidenceDir(opts.out)
  } catch (error) {
    if (error instanceof EvidenceError) throw new RunError(error.message)
    throw error
  }
  if (opts.phase === null) throw new RunError('缺少 --phase（阶段名，如 task-before）')
  opts.phase = assertPhase(opts.phase)
  return opts
}

/**
 * 校验阶段名（安全短名）。
 * @param {string} phase
 * @returns {string} 归一后的阶段名
 * @throws {RunError}
 */
export function assertPhase(phase) {
  if (typeof phase !== 'string' || phase.trim() === '') throw new RunError('--phase 不能为空：阶段名必须是小写安全短名（如 task-before）')
  const name = phase.trim()
  if (!PHASE_PATTERN.test(name)) {
    throw new RunError(
      `--phase「${name}」不是安全短名：只允许小写字母数字与 . _ -，以字母数字开头，≤24 字符`
      + '（它会成为证据目录的一段，分隔符与 .. 一律不收）',
    )
  }
  return name
}

/**
 * 覆盖表 → 退出码。
 * `pass` 之外任何状态都意味着「这轮没走满」，但**证据已经落盘**，所以要跟「没跑起来」分开。
 * @param {{status: string}[]} cases
 * @returns {number}
 */
export function exitCodeForCoverage(cases) {
  if (!Array.isArray(cases) || cases.length === 0) return EXIT.incomplete
  return cases.every((row) => row.status === 'pass') ? EXIT.ok : EXIT.incomplete
}

/** 仓库内相对路径（不打印仓库外的绝对路径：证据要能换台机器看）。 */
function displayPath(absolute) {
  const back = relative(REPO_ROOT, absolute)
  if (back === '' || back.startsWith('..') || isAbsolute(back)) return `(仓库外)/${absolute.split(/[\\/]/u).at(-1)}`
  return back.replaceAll('\\', '/')
}

/** 当前源码事实（SHA / 分支 / 脏文件数）——两轮之间「改了什么」要从这里对。 */
function sourceSnapshot() {
  const git = (args) => spawnSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' })
  const head = git(['rev-parse', 'HEAD'])
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const status = git(['status', '--porcelain'])
  return {
    sha: (head.stdout ?? '').trim() || null,
    branch: (branch.stdout ?? '').trim() || null,
    dirtyFiles: (status.stdout ?? '').split('\n').filter((line) => line.trim() !== '').length,
  }
}

/** 客户端产物的指纹：产物与证据绑定，才知道这一轮跑的是哪份界面。 */
function clientArtifactFingerprint() {
  const path = join(REPO_ROOT, 'packages', 'xuanshu-client', 'lib', 'client.js')
  if (!existsSync(path)) return null
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * 实例进程退出后，端口还连不连得上。
 *
 * 为什么用「端口不可连」而不是「我看过进程表」：子进程可能再拉起别的进程，
 * 拿 pid 判只覆盖自己 spawn 的那一个；端口是**外部可观察物**，它关了才算真的没人管这个实例。
 *
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>} true = 已关闭（连不上）
 */
export function checkPortClosed(port, timeoutMs = 1_500) {
  return new Promise((resolveClosed) => {
    let settled = false
    const finish = (closed) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolveClosed(closed)
    }
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(false))
    socket.once('error', () => finish(true))
  })
}

/** 步骤账本：全局递增序号 + 每一步都回一句人话（长任务不该看起来像卡死）。 */
function createStepRecorder(log) {
  const steps = []
  return {
    steps,
    current: () => (steps.length === 0 ? 1 : steps.at(-1).step),
    step(input) {
      const row = { step: steps.length + 1, ...input }
      steps.push(row)
      log(`步骤 ${row.step}：${row.action} → ${row.outcome}`)
      return row.step
    },
  }
}

/**
 * 造 `findings.md`（本轮：**已知发现骨架 + 实测记录**）。
 *
 * 为什么这一版没有编号发现：编号发现是「已经裁定过的观察」，裁定要人签字（ADR-0017 第 7 条）。
 * runner 只记录事实；把「界面有点丑」自动写成 `EXP-001`，就是把测量冒充成结论。
 *
 * @param {{phase: string, runs: object[], notes: string[]}} input
 * @returns {string}
 */
export function findingsMarkdown({ phase, runs, notes = [] }) {
  const lines = [
    `# 实操评估实测记录（${phase}）`,
    '',
    '> 本文件由 `node scripts/experience/run.mjs` 生成，**重跑会覆盖**。',
    '> 发现编号从 `EXP-001` 起（ADR-0017 第 6 条：`EXP` 编号不是判据 id，不能被 `UX-FIX:` 引用）。',
    '',
    '## 一、本轮场景结果',
    '',
    '| 场景 | 用例 | 状态 | 依据 |',
    '|---|---|---|---|',
  ]
  for (const run of runs) {
    const basis = run.status.evidence ?? run.status.reason ?? ''
    lines.push(`| ${run.scenarioId} | ${run.caseId} | ${run.status.status} | ${oneLine(basis, 160)} |`)
  }
  lines.push('', '## 二、已知发现（EXP 编号）', '')
  lines.push(
    '本轮**没有编号发现**：本次执行只做事实记录，未对任何观察做裁定（裁定要人签字）。',
    '若上一轮已登记过 `EXP-xxx`，它的结论按记录日期引用，不因本轮重跑而改写。',
    '',
    '## 三、实测记录',
    '',
  )
  for (const run of runs) {
    lines.push(`### ${run.scenarioId}（${run.caseId} · ${run.title}）`, '')
    lines.push(`- 状态：\`${run.status.status}\``)
    lines.push(`- 摘要：${run.status.summary}`)
    if (run.summary !== undefined && Object.keys(run.summary).length > 0) {
      const pairs = Object.entries(run.summary).map(([key, value]) => `${key}=${String(value)}`)
      lines.push(`- 观测：${pairs.join(' / ')}`)
    }
    lines.push(`- 步骤：${run.steps.length} 步（见同目录 \`${EVIDENCE_FILES.steps}\` 与截图）`)
    lines.push('')
  }
  if (notes.length > 0) {
    lines.push('## 四、执行期注记', '')
    for (const note of notes) lines.push(`- ${note}`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

/** 把一段文案压成一行（表格里放不下多行）。 */
function oneLine(text, limit = 200) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit)
}

/**
 * 写一整份证据包（**唯一的落盘口**：测试与真跑走同一条路径）。
 *
 * 固定文件名、每场景一个子目录、起止两份环境快照 —— 报告与复测脚本按这些名字取。
 * 只写执行到的东西：调用方给几条 `runs` 就写几条，**这里不补任何「通过」**。
 *
 * @param {{
 *   dir: string,                 // 阶段目录（绝对路径）
 *   phase: string,
 *   environment: object,         // 场景开始
 *   environmentEnd: object,      // 场景结束
 *   runs: object[],              // 每场景：{scenarioId, caseId, title, status, steps, errors, summary?}
 *   notes?: string[],
 * }} input
 * @returns {{coverage: object, files: string[]}}
 */
export function writeEvidencePack({ dir, phase, environment, environmentEnd, runs, notes = [] }) {
  mkdirSync(dir, { recursive: true })
  const allLines = []
  const mergedErrors = { consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [] }
  const cases = []

  for (const run of runs) {
    const scenarioDir = join(dir, run.scenarioId)
    mkdirSync(scenarioDir, { recursive: true })

    const lines = run.steps.map((step) => stepLine(step))
    writeFileSync(join(scenarioDir, EVIDENCE_FILES.steps), lines.length === 0 ? '' : `${lines.join('\n')}\n`, 'utf8')
    const scenarioErrors = errorsDocument(run.errors ?? {})
    writeFileSync(join(scenarioDir, EVIDENCE_FILES.errors), `${JSON.stringify(scenarioErrors, null, 2)}\n`, 'utf8')

    // 场景附加证据（票 #80）：文件名由场景写死，这里只做「它必须是一个文件名」的校验。
    // 只写调用方真的交上来的东西：没交就不落空文件（不许替谁补一份「看起来有」的记录）。
    const extraFiles = run.files ?? {}
    if (extraFiles === null || typeof extraFiles !== 'object' || Array.isArray(extraFiles)) {
      throw new EvidenceError(`场景 ${run.scenarioId} 的 files 必须是 {文件名: JSON 值} 的对象`)
    }
    for (const [name, value] of Object.entries(extraFiles)) {
      const fileName = assertEvidenceFileName(name)
      writeFileSync(join(scenarioDir, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    }

    allLines.push(...lines)
    mergedErrors.consoleErrors.push(...(run.errors?.consoleErrors ?? []))
    mergedErrors.pageErrors.push(...(run.errors?.pageErrors ?? []))
    mergedErrors.requestFailures.push(...(run.errors?.requestFailures ?? []))
    mergedErrors.httpErrors.push(...(run.errors?.httpErrors ?? []))

    cases.push({
      caseId: run.caseId,
      status: run.status.status,
      scenario: run.scenarioId,
      lastStep: run.steps.at(-1)?.action,
      ...(run.status.evidence === undefined ? { reason: run.status.reason } : { evidence: run.status.evidence }),
    })
  }

  const coverage = coverageDocument(cases)
  writeFileSync(join(dir, EVIDENCE_FILES.coverage), `${JSON.stringify(coverage, null, 2)}\n`, 'utf8')
  writeFileSync(join(dir, EVIDENCE_FILES.steps), allLines.length === 0 ? '' : `${allLines.join('\n')}\n`, 'utf8')
  writeFileSync(join(dir, EVIDENCE_FILES.errors), `${JSON.stringify(errorsDocument(mergedErrors), null, 2)}\n`, 'utf8')
  writeFileSync(join(dir, EVIDENCE_FILES.environment), `${JSON.stringify(environment, null, 2)}\n`, 'utf8')
  writeFileSync(join(dir, ENVIRONMENT_END_FILE), `${JSON.stringify(environmentEnd, null, 2)}\n`, 'utf8')
  writeFileSync(join(dir, EVIDENCE_FILES.findings), findingsMarkdown({ phase, runs, notes }), 'utf8')

  return {
    coverage,
    files: [
      EVIDENCE_FILES.environment,
      ENVIRONMENT_END_FILE,
      EVIDENCE_FILES.coverage,
      EVIDENCE_FILES.steps,
      EVIDENCE_FILES.errors,
      EVIDENCE_FILES.findings,
      ...runs.flatMap((run) => [
        `${run.scenarioId}/${EVIDENCE_FILES.steps}`,
        `${run.scenarioId}/${EVIDENCE_FILES.errors}`,
        ...Object.keys(run.files ?? {}).map((name) => `${run.scenarioId}/${name}`),
      ]),
    ],
  }
}

/** 探测一次环境（真启动一次无头 Edge；`ready` 是唯一可信的就绪判断）。 */
async function probeOnce() {
  return probeEnvironment({
    resolvePlaywright: defaultResolvePlaywright,
    readEdge: defaultReadEdge,
    launchHeadless: defaultLaunchHeadless,
  })
}

/** 装配一份环境快照（起 / 止各一份；两段除 `stage` 与实例收尾外完全同形，便于逐项比）。 */
function environmentSnapshot({ stage, phase, scenario, probe, instance }) {
  const fresh = checkClientArtifact({ repoRoot: REPO_ROOT })
  return {
    schema: ENVIRONMENT_SCHEMA,
    stage,
    phase,
    scenario,
    source: sourceSnapshot(),
    clientArtifact: {
      path: 'packages/xuanshu-client/lib/client.js',
      fresh: fresh.fresh === true,
      sha256: clientArtifactFingerprint(),
    },
    probe,
    instance,
  }
}

/**
 * CLI 主体。
 * @param {string[]} argv
 * @param {{log?: (line: string) => void, out?: (line: string) => void}} [io]
 *        `log` 走 stderr 说进度（票面标准 7：执行期间持续报告正在等什么），`out` 走 stdout 给人看结论
 * @returns {Promise<number>} 退出码
 */
export async function main(argv = process.argv.slice(2), io = {}) {
  const say = io.out ?? ((line) => process.stdout.write(`${line}\n`))
  const log = io.log ?? ((line) => process.stderr.write(`[experience] ${line}\n`))

  let opts
  try {
    opts = parseRunArgs(argv)
  } catch (error) {
    log(error instanceof RunError ? error.message : `参数解析没跑成：${error?.message ?? error}`)
    log('用法见 --help')
    return EXIT.usage
  }
  if (opts.help) {
    say(HELP)
    return EXIT.ok
  }

  const scenario = SCENARIOS[opts.scenario]
  const outDir = opts.out.replaceAll('\\', '/').replace(/\/+$/u, '')
  const phaseDirAbs = join(REPO_ROOT, ...outDir.split('/'), opts.phase)
  const scenarioDirAbs = join(phaseDirAbs, scenario.id)
  const homeAbs = resolve(REPO_ROOT, opts.home)
  const homeDisplay = displayPath(homeAbs)

  log(`场景 ${scenario.id}（${scenario.caseId} · ${scenario.title}）`)
  log(`证据落点：${displayPath(phaseDirAbs)}`)

  // ① 前置：客户端产物必须新于源码——旧产物跑出来的观感不是当前界面（spec 003 §13）。
  const fresh = checkClientArtifact({ repoRoot: REPO_ROOT })
  if (!fresh.fresh) {
    log(`拒绝采集：${fresh.reason}`)
    return EXIT.usage
  }

  // ② 前置：playwright 由宿主提供，本仓不装（也不许加依赖）。
  const playwright = resolvePlaywright()
  if (playwright === null) {
    log('找不到 playwright（本仓不装它）：先按 probe-env 的 next 处理环境，这一轮不采集')
    return EXIT.usage
  }

  // ③ 场景开始的环境快照：它先落盘，后面无论成败都留得下「跑之前机器是什么样」。
  log('正在等：环境探测（真启动一次无头 Edge）')
  const probeStart = await probeOnce()
  log(`环境：ready=${probeStart.snapshot.ready} reason=${probeStart.snapshot.reason}`
    + ` playwright=${probeStart.snapshot.playwright.version ?? '未解析'} edge=${probeStart.snapshot.edge.version ?? '未找到'}`)

  const instanceBase = { home: homeDisplay, keepHome: opts.keepHome }
  const environment = environmentSnapshot({
    stage: 'start',
    phase: opts.phase,
    scenario: scenario.id,
    probe: probeStart.snapshot,
    instance: { ...instanceBase, port: null, url: null, viewport: { width: 1280, height: 900 }, colorScheme: 'light' },
  })

  if (probeStart.snapshot.ready !== true) {
    // 环境缺前置：写一份诚实的包（coverage = blocked），退出码跟「没跑起来」区分开。
    const run = {
      scenarioId: scenario.id,
      caseId: scenario.caseId,
      title: scenario.title,
      status: { status: 'blocked', reason: `执行环境没就绪（${probeStart.snapshot.reason}）：按 environment.json 的 next 处理后再跑`, summary: '环境缺前置' },
      steps: [],
      errors: {},
      summary: {},
    }
    writeEvidencePack({
      dir: phaseDirAbs,
      phase: opts.phase,
      environment,
      environmentEnd: { ...environment, stage: 'end', instance: { ...environment.instance, shutdown: { portClosed: true } } },
      runs: [run],
    })
    log(`环境没就绪，已写 blocked 证据包：${displayPath(phaseDirAbs)}`)
    return EXIT.incomplete
  }

  mkdirSync(scenarioDirAbs, { recursive: true })

  const recorder = createStepRecorder(log)
  const notes = []
  const signals = { consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [] }
  const truncated = {}
  const pushSignal = (kind, row) => {
    if (signals[kind].length >= MAX_ERROR_ROWS) {
      truncated[kind] = (truncated[kind] ?? 0) + 1
      return
    }
    signals[kind].push(row)
  }

  let browser = null
  let context = null
  let sequence = null
  let portClosed = true
  let run = null

  try {
    // 实例起停序列（票 #80）：拉起 / 停止 / 重启都走同一份生命周期，场景只通过 ctx 请求，
    // 不自己 spawn、不按端口 kill（ADR-0017 第 4 条：持久 = home 跨轮复用，不是进程长驻）。
    sequence = createBootSequence({
      repoRoot: REPO_ROOT,
      home: homeAbs,
      homeLabel: homeDisplay,
      keepHome: opts.keepHome,
      log,
      start: startIsolatedInstance,
      checkClosed: checkPortClosed,
    })
    log(`起隔离实例：home=${homeDisplay}${opts.keepHome ? '（结束后保留）' : '（结束后清理，--drop-home）'}`)
    const first = await sequence.start()
    environment.instance = {
      ...instanceBase,
      port: first.port,
      url: sanitizeUrl(first.url),
      viewport: { width: 1280, height: 900 },
      colorScheme: 'light',
    }
    log(`实例就绪：port=${first.port}`)

    log('启动浏览器（channel=msedge, headless）')
    browser = await playwright.chromium.launch({ channel: 'msedge', headless: true })
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' })
    // tracing 全程开：一张静态截图证明不了跳转与等待，失败时要能从 trace 里回放（ADR-0017 第 2 条）。
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false })
    const page = await context.newPage()
    page.on('console', (message) => {
      if (message.type() === 'error') pushSignal('consoleErrors', { message: message.text().slice(0, 300), step: recorder.current() })
    })
    page.on('pageerror', (error) => {
      pushSignal('pageErrors', { message: String(error?.message ?? error).slice(0, 300), step: recorder.current() })
    })
    page.on('requestfailed', (request) => {
      pushSignal('requestFailures', {
        message: `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim(),
        step: recorder.current(),
      })
    })
    page.on('response', (response) => {
      if (response.status() < 400) return
      pushSignal('httpErrors', { message: `HTTP ${response.status()} ${response.url()}`, step: recorder.current() })
    })

    // `env` 是**当前**实例的地址：重启之后由 `restartInstance()` 原地更新，场景读到的永远是最新一次 boot。
    // `homeAbs` 只给场景做**只读**数据面核对（票 #79：旁挂清单文件数前后对比）；
    // 它不进任何证据文件（证据里仍然只有 `homeDisplay`），也不用于读写业务数据。
    const env = { url: first.url, port: first.port, home: homeDisplay, homeAbs }
    const ctx = {
      page,
      context,
      log,
      env,
      /**
       * 两次实例的 boot 记录（票 #80）：场景读它写 `restart-boots.json`，也是「这是新进程」的证据。
       * 数组是活的：`restartInstance()` 会往里追加。
       */
      boots: sequence.boots,
      /** 停旧进程（保 home）→ 起同一个 home 的新实例。场景不自己 spawn / kill。 */
      restartInstance: async () => {
        const next = await sequence.restart()
        env.url = next.url
        env.port = next.port
        log(`重起实例：第 ${sequence.boots.length} 次 boot，port=${next.port}；旧 port=${next.previousPort} 已关=${next.previousPortClosed}`)
        return next
      },
      /** 停当前实例（幂等；收尾时 runner 也会再调一次，不会重复停）。 */
      stopInstance: async () => {
        const stopped = await sequence.stopCurrent()
        log(`实例已停止：port ${sequence.boot()?.port ?? '无'} ${stopped.portClosed ? '已不可连' : '仍可连（有进程还占着）'}`)
        return stopped
      },
      settle: (ms) => sleep(ms),
      shot: async (name, options = {}) => {
        await page.screenshot({ path: join(scenarioDirAbs, name), ...options })
        return name
      },
      step: (input) => recorder.step(input),
      note: (text) => {
        notes.push(oneLine(text, 300))
        log(`注记：${oneLine(text, 200)}`)
      },
    }

    const result = await scenario.run(ctx)
    run = {
      scenarioId: scenario.id,
      caseId: scenario.caseId,
      title: scenario.title,
      status: result.status,
      steps: recorder.steps,
      errors: signals,
      summary: result.observations?.summary ?? flattenObservations(result.observations),
      // 场景自己的结构化记录（文件名由场景写死；runner 只校验形状并落盘）。
      ...(result.files === undefined ? {} : { files: result.files }),
    }
    log(`场景结束：${result.status.status}（${result.status.summary}）`)
  } catch (error) {
    // 场景中断不是「没发生」：已经跑过的步骤照旧带出去，断在哪一步就记在哪一步。
    const message = oneLine(error?.message ?? error, 300)
    log(`场景中断：${message}`)
    notes.push(`场景中断：${message}`)
    recorder.step({ action: '场景执行', target: scenario.id, outcome: `中断：${message}` })
    run = {
      scenarioId: scenario.id,
      caseId: scenario.caseId,
      title: scenario.title,
      status: { status: 'blocked', reason: `场景中断：${message}（已跑过的步骤与截图保留）`, summary: '场景中断' },
      steps: recorder.steps,
      errors: signals,
      summary: {},
    }
  } finally {
    // 收尾只动自己的东西（票面标准 8）：先停 tracing / 关浏览器，再停实例。
    if (context !== null) {
      try {
        await context.tracing.stop({ path: join(scenarioDirAbs, EVIDENCE_FILES.trace) })
        const bytes = existsSync(join(scenarioDirAbs, EVIDENCE_FILES.trace)) ? statSync(join(scenarioDirAbs, EVIDENCE_FILES.trace)).size : 0
        recorder.step({
          action: '保存 trace',
          target: EVIDENCE_FILES.trace,
          outcome: bytes > 0 ? `trace 已落盘（${bytes} 字节）` : 'trace 没写出来（0 字节）',
        })
      } catch (error) {
        notes.push(`trace 保存失败：${oneLine(error?.message ?? error, 200)}`)
      }
    }
    try { await browser?.close() } catch { /* 只关自己的浏览器；关不掉不覆盖主结论 */ }
    if (sequence !== null) {
      // 场景可能已经自己停过（E07 要先停再写 `restart-boots.json` 的停止时间）；这里再调是幂等的。
      const stopped = await sequence.stopCurrent()
      portClosed = stopped.portClosed === true
      const lastBoot = sequence.boot()
      log(`实例已停止：port ${lastBoot?.port ?? '无'} ${portClosed ? '已不可连' : '仍可连（有进程还占着）'}`)
    }
    if (run === null) {
      run = {
        scenarioId: scenario.id,
        caseId: scenario.caseId,
        title: scenario.title,
        status: { status: 'blocked', reason: '场景没跑起来（实例或浏览器启动失败）', summary: '没跑起来' },
        steps: recorder.steps,
        errors: signals,
        summary: {},
      }
    }
    // 停实例 / 关浏览器之后才探测结尾快照：它要说明的是「收尾之后机器回到什么样」。
    // 结尾的 instance 段指的是**最后一次 boot**：E07 重启之后，起止两份环境快照因此端口不同，
    // 读者一眼能看出「这不是同一个进程」（两次 boot 的完整记录在场景的 `restart-boots.json` 里）。
    log('正在等：场景结束的环境探测')
    const probeEnd = await probeOnce()
    const finalInstance = sequence?.current() ?? null
    const environmentEnd = environmentSnapshot({
      stage: 'end',
      phase: opts.phase,
      scenario: scenario.id,
      probe: probeEnd.snapshot,
      instance: {
        ...environment.instance,
        port: finalInstance?.port ?? environment.instance.port,
        url: finalInstance === null ? environment.instance.url : sanitizeUrl(finalInstance.url),
        shutdown: {
          portClosed,
          keptHome: opts.keepHome,
          boots: (sequence?.boots ?? []).map((boot) => ({
            boot: boot.boot,
            port: boot.port,
            startedAt: boot.startedAt,
            stoppedAt: boot.stoppedAt,
            durationMs: boot.durationMs,
            portClosed: boot.portClosed,
            keepHome: boot.keepHome,
          })),
        },
      },
    })
    try {
      const { coverage } = writeEvidencePack({
        dir: phaseDirAbs,
        phase: opts.phase,
        environment,
        environmentEnd,
        runs: [run],
        notes,
      })
      const totals = Object.entries(coverage.totals).filter(([, count]) => count > 0).map(([status, count]) => `${status}=${count}`).join(' ')
      say(`[experience] ${opts.phase}：${coverage.cases.map((row) => `${row.caseId}=${row.status}`).join(' ')}（${totals}）→ ${displayPath(phaseDirAbs)}`)
    } catch (error) {
      log(`证据包落盘失败：${error?.message ?? error}`)
      return EXIT.usage
    }
  }

  if (truncated.consoleErrors !== undefined || truncated.httpErrors !== undefined) {
    log(`错误行超上限（每类 ${MAX_ERROR_ROWS} 行），已截断：${Object.entries(truncated).map(([kind, count]) => `${kind}+${count}`).join(' ')}`)
  }
  return exitCodeForCoverage([{ status: run.status.status }])
}

/** 把观测摊平成 `key=value` 摘要（`findings.md` 的「观测」行）。 */
function flattenObservations(observations) {
  if (observations === null || typeof observations !== 'object') return {}
  const flat = {}
  for (const [key, value] of Object.entries(observations)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'object') {
      for (const [inner, innerValue] of Object.entries(value)) {
        if (innerValue === null || innerValue === undefined || typeof innerValue === 'object') continue
        flat[`${key}.${inner}`] = innerValue
      }
      continue
    }
    flat[key] = value
  }
  return flat
}

/** `sleep` 的本地包装：只为了让 `ctx.settle` 读起来像一句人话。 */
function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code), (error) => {
    process.stderr.write(`[experience] runner 没跑成：${error?.message ?? error}\n`)
    process.exit(EXIT.incomplete)
  })
}
