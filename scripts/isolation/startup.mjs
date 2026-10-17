#!/usr/bin/env node
/**
 * startup.mjs — 玄枢（XuanShu）票 04 的「隔离启动器」：先体检，再决定要不要把实例拉起来。
 *
 * 用法：
 *   node scripts/isolation/startup.mjs [options] [-- <dsh args...>]
 *     --mode doctor|web|headless|env      (默认 doctor)
 *     --home <dir>            --profile <name>
 *     --web-port <n>          --horosa-port <n>
 *     --cli-bin <path>        --host <host>      --trusted-host <authority>...
 *     --install               缺 profile 时先跑 scripts/install-profile.mjs
 *     --no-open               转发给 dsh web（默认就带）
 *     --json                  stdout 只输出单份 JSON（无其它行）
 *     --dry-run               不 spawn，只打印计划
 *     --timeout-ms <n>        转发/等待上限，默认 180000
 *
 * 退出码（契约 §2）：0 通过；1 用法/内部错误；2 环境门失败（home / CLI / profile，含 web 前提）；
 *                    3 隔离门失败（web 端口被占、horosa 被**确认**非 horosa 进程占用、状态外溢）。
 *
 * 四种模式：
 *   doctor（默认） 算清一切 + 跑 webPort/horosaGuard 两道门 + 断言派生路径都在 home 下，只报告不 spawn；
 *   web            前提全绿后 spawn `dsh --profile <p> --port <n> --no-open`，退出码 = 子进程退出码。
 *                  **票 04 时这条必然跑不起来**：`dsh web` 由 `@deepseek-ai/dsh-web-app` bundle 提供，
 *                  而票 04 不接它（评审裁决 §5.1 R1：接进 `dsh.profile.bundles` 会让装配树多出 4 条
 *                  error 行，属票 07 首页替换）。缺它时 CLI 会以 `error: unknown option '--port'` exit 1，
 *                  所以那时**在 spawn 前就拒绝**：`profile` 门 FAIL、退出码 2、detail 点名缺哪个包。
 *                  **票 07 已把该 bundle 接进 `dsh.profile.bundles`**，所以上面那条前置拒绝的真值翻了：
 *                  `webBundle.available === true`，`profile` 门过、放行 spawn（见 tests/isolation/resolve.test.mjs
 *                  的 R2/R17 翻转断言 + 真起冒烟 `tests/isolation/lib/web-boot.mjs`）。
 *                  **已知残留**：本模式构造的命令仍是 `--profile <p> web …`，而 0.2.0-rc.2 的 CLI 根解析器
 *                  会把 `web` 当多余位置参数拒掉（实测 `error: too many arguments. Expected 0 arguments
 *                  but got 1: web.`）；CLI 认的形态是 `dsh web --port <n> --no-open`（`dsh <name>` 捷径
 *                  把 `web` 展开成 `--profile web`）。所以「web 真的能起」由上面那个冒烟文件用后者证明，
 *                  而本模式的命令构造尚未随票 07 调整（写域与门行为分离，改前先由票主裁决）。
 *   headless       真跑一次 `dsh --profile <p> --help`（= boot + dispose + exit 0，不调 LLM、不开端口），
 *                  并断言 `<home>/xuanshu/assembly-report.json` **本次新写出**；
 *   env            不 spawn，只把 plan.env / plan.command 打到 stdout，给 pwsh / CI 用。
 *
 * 隔离硬规矩（改代码前先读）：
 *   1) 解析出的 home 等于**或位于**用户真实 `~/.dsh` 下 → 用法失败（exit 1）。本票**不**提供
 *      `--allow-real-home` 之类的逃生舱：这个开关一存在，早晚会有人在 CI 里打开它。
 *   2) （评审裁决 §5.1 R16）环境里那支 `$DSH_HOME` 若指向真实 `~/.dsh` 会被**忽略**并记进 notes ——
 *      在 DSH 会话里跑本脚本时它天然如此，硬拒绝会让脚本在会话内根本没法用；
 *      而**显式** `--home` / `XUANSHU_DSH_HOME` 指到真实 home 一律硬拒绝（exit 1）：
 *      显式 = 有人真的这么打了，那就按字面执行并拒绝。
 *   3) CLI 一律用 profile 树里那份 `<profile>/node_modules/@deepseek-ai/dsh/lib/bin.js`：
 *      PATH 上全局 npm 装的是 0.1.2-rc.1，与本票的 0.2.0-rc.2 树不兼容（会崩在
 *      `does not provide an export named 'StartupError'`）。版本不符时 `cli` 门判 FAIL（exit 2）。
 *   4) `--json` 时 stdout 只有一份 JSON，其余一切走 stderr；`runStartup()` 被 import 时**不打印任何东西**
 *      （断言台要自己决定怎么输出），也不调用 process.exit。
 *      `--mode web` 也不例外（§5.1 R3）：不预打印，子进程 stdout/stderr 被转发到**父进程 stderr**，
 *      等子进程退出后打**终版报告**（含真实 spawn.exitCode/signal/ms）。代价是 `--json` 时拿不到
 *      实时日志，这一条写进 notes。
 *   5) `<profile>/cordis.yml` 是 DSH 每次启动都重写的运行期产物（profile 已 gitignore）：
 *      启动器**不清理**它（清理会让下一次启动的补丁栈基线漂移），只在 notes 里说明。
 *   6) horosa 端口的回退链是 `--horosa-port` > `XUANSHU_HOROSA_PORT` > `HOROSA_SKILL_PORT` > 8765
 *      （§5.1 R6）：horosa 自己那份 skill 认 `HOROSA_SKILL_PORT`，守卫判的必须是它**真正会监听**的端口。
 *   7) `horosaGuard` 门的 `ok` 与**退出码**解耦（§5.1 R14）：`ok = verdict ∈ {free, horosa-ready}`，
 *      所以 `probe-failed`（没验成）是 `ok:false`，但只有 `occupied-foreign` 才让退出码变成 3。
 *      「不确定」不该显示成绿灯，也不该被当成「隔离失败」。
 *
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ASSEMBLY_REPORT_SCHEMA,
  CHECK_IDS,
  DEFAULT_MODE,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_WEB_PORT,
  DESKTOP_WEB_PORT,
  DSH_BASE_PACKAGE,
  DSH_PACKAGE,
  DSH_WEB_APP_PACKAGE,
  ENVIRONMENT_CHECK_IDS,
  ENV,
  EXIT,
  HOROSA_MCP_PATH,
  ISOLATION_CHECK_IDS,
  ISOLATION_REPORT_SCHEMA,
  MODES,
} from './defaults.mjs'
import { isUnderPath, resolveHomeWithSource, resolveInstance, resolveRepoRoot, samePath } from './resolve.mjs'

/** 报告的 instance 字段（契约 §4.5）：严格这些键，顺序即打印顺序。 */
const INSTANCE_KEYS = [
  'home', 'profile', 'profileDir', 'webPort', 'horosaPort', 'horosaUrl',
  'dataDir', 'sessionsDir', 'storagesDir', 'credentialsFile', 'machinePatchFile', 'reportFile',
]
/** stateIsolated 要断言的派生路径：全部必须落在同一个 `$DSH_HOME` 下。 */
const ISOLATED_PATH_KEYS = [
  'profileDir', 'dataDir', 'sessionsDir', 'storagesDir', 'credentialsFile', 'machinePatchFile', 'reportFile',
]
/** 输出尾部截断长度：报告里只留「够看懂失败原因」的部分，避免 JSON 变成日志搬家。 */
const TAIL_LIMIT = 2000
/**
 * 参与退出码的隔离门：**除了 horosaGuard**（§5.1 R14）。
 * horosaGuard 的 ok 是「验没验成」，退出码只认「确认被外人占了」，两者不是一回事。
 */
const ISOLATION_EXIT_CHECK_IDS = ISOLATION_CHECK_IDS.filter((id) => id !== 'horosaGuard')

function printHelp() {
  const text = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const block = text.slice(text.indexOf('/**') + 3, text.indexOf('*/'))
  process.stdout.write(`${block.split('\n').map((line) => line.replace(/^ \* ?/, '')).join('\n').trim()}\n`)
}

/* ───────────────────────────── 参数 ───────────────────────────── */

/**
 * 解析 CLI 参数。返回**纯数据**（不读环境、不解析路径）：`runStartup` 也接受同样形状的对象，
 * 断言台因此可以「构造 options」而不是拼命令行。
 */
export function parseStartupArgs(argv) {
  const opts = {
    mode: DEFAULT_MODE,
    home: undefined,
    profile: undefined,
    webPort: undefined,
    horosaPort: undefined,
    cliBin: undefined,
    host: undefined,
    trustedHosts: [],
    install: false,
    noOpen: true,
    json: false,
    dryRun: false,
    timeoutMs: undefined,
    timeoutExplicit: false,
    extraArgs: [],
    help: false,
  }
  const needsValue = (flag, value) => {
    if (value === undefined) throw new Error(`${flag} needs a value`)
    return value
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') {
      opts.extraArgs = argv.slice(i + 1)
      break
    } else if (arg === '--mode') opts.mode = needsValue(arg, argv[++i])
    else if (arg === '--home') opts.home = needsValue(arg, argv[++i])
    else if (arg === '--profile') opts.profile = needsValue(arg, argv[++i])
    else if (arg === '--web-port') opts.webPort = needsValue(arg, argv[++i])
    else if (arg === '--horosa-port') opts.horosaPort = needsValue(arg, argv[++i])
    else if (arg === '--cli-bin') opts.cliBin = needsValue(arg, argv[++i])
    else if (arg === '--host') opts.host = needsValue(arg, argv[++i])
    else if (arg === '--trusted-host') opts.trustedHosts.push(needsValue(arg, argv[++i]))
    else if (arg === '--install') opts.install = true
    else if (arg === '--no-open') opts.noOpen = true
    else if (arg === '--json') opts.json = true
    else if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--timeout-ms') {
      const raw = needsValue(arg, argv[++i])
      const value = Number(raw)
      if (!Number.isFinite(value) || value <= 0) throw new Error(`--timeout-ms needs a positive number (got ${raw})`)
      opts.timeoutMs = value
      opts.timeoutExplicit = true
    } else if (arg === '-h' || arg === '--help') opts.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (!MODES.includes(opts.mode)) throw new Error(`--mode must be one of ${MODES.join('|')} (got ${opts.mode})`)
  return opts
}

/* ───────────────────────────── 小工具 ───────────────────────────── */

/** 只取输出尾部并归一换行：JSON 里不需要整篇 pnpm/CLI 日志。 */
function tail(text, limit = TAIL_LIMIT) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim()
  return normalized.length <= limit ? normalized : `…${normalized.slice(-limit)}`
}

/** 文件「本次有没有被写过」的判据：mtime + size。不存在返回 { exists:false }。 */
function snapshotFile(file) {
  try {
    const stat = statSync(file)
    return { exists: true, bytes: stat.size, mtimeMs: stat.mtimeMs, mtime: new Date(stat.mtimeMs).toISOString() }
  } catch {
    return { exists: false }
  }
}

function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** 目录联接（Windows junction / POSIX symlink）的落点；不是联接返回 undefined。 */
function linkTargetOf(path) {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return realpathSync(path)
    if (!stat.isDirectory()) return undefined
    const real = realpathSync(path)
    return samePath(real, path) ? undefined : real
  } catch {
    return undefined
  }
}

function isProfileInstalled(profileDir) {
  return existsSync(join(profileDir, 'package.json')) && existsSync(join(profileDir, 'node_modules'))
}

/** 人读的命令行（PowerShell 用 `&` 调用运算符；引号里的单引号翻倍转义）。 */
function renderCommandLine(command) {
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`
  const win = process.platform === 'win32'
  const [exe, ...rest] = command
  return win ? `& ${quote(exe)} ${rest.map(quote).join(' ')}` : `'${String(exe).replace(/'/g, "'\\''")}' ${rest.map(quote).join(' ')}`
}

/**
 * 探针模块（队友 B）是运行时才需要的东西：import 失败不该让整个启动器崩掉，
 * 但也不能假装端口检查通过了 —— 上层把它折算成 `environment`（exit 2）+ 「等 B 的模块」的 detail。
 */
async function loadGates() {
  try {
    const [probe, guard] = await Promise.all([import('./port-probe.mjs'), import('./horosa-guard.mjs')])
    if (typeof probe.isPortBusy !== 'function') throw new Error('port-probe.mjs 没有导出 isPortBusy')
    if (typeof guard.checkHorosaPort !== 'function') throw new Error('horosa-guard.mjs 没有导出 checkHorosaPort')
    return { isPortBusy: probe.isPortBusy, checkHorosaPort: guard.checkHorosaPort }
  } catch (error) {
    return { error: error?.message ?? String(error) }
  }
}

/**
 * 跑一个子进程并**收集**它的输出（stdio: ['inherit','pipe','pipe']）。
 * 为什么不是 inherit：web 是长驻进程，`--json` 时若让它直接写 stdout，那份 JSON 后面就会接着
 * 一坨服务器日志 —— 契约要的是「stdout 只有一份 JSON」。所以 stdout/stderr 走管道，
 * 由调用方决定去哪（命令行壳转发到父进程 stderr，见 `onChildOutput`），同时留尾部进报告。
 * stdin 仍然 inherit：交互式 CLI 不该被我们掐掉。
 */
function spawnPiped(command, args, { cwd, env, killAfterMs = 0, onOutput }) {
  return new Promise((resolvePromise) => {
    let settled = false
    let timer
    let stdout = ''
    let stderr = ''
    const done = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolvePromise({ ...result, stdout, stderr })
    }
    // 只留尾部：长驻服务器的日志可以无限长，报告里要的是「最后发生了什么」。
    const absorb = (buffer, chunk) => (buffer + chunk).slice(-TAIL_LIMIT * 2)
    const child = spawn(command, args, { cwd, env, stdio: ['inherit', 'pipe', 'pipe'] })
    if (killAfterMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* 已经退出 */
        }
        done({ timedOut: true, signal: 'SIGTERM' })
      }, killAfterMs)
    }
    child.stdout?.on('data', (chunk) => {
      stdout = absorb(stdout, chunk)
      onOutput?.('stdout', chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = absorb(stderr, chunk)
      onOutput?.('stderr', chunk)
    })
    child.once('error', (error) => done({ error: error?.message ?? String(error) }))
    child.once('exit', (code, signal) => done({ code, signal }))
  })
}

/* ───────────────────────────── 报告骨架 ───────────────────────────── */

/**
 * 报告骨架。注意**没有** `spawn` 键（§5.1 R12）：契约 §4.5 标的是 `spawn?: …`，
 * 「没 spawn 就不出现」比「塞一个 {attempted:false} 让调用方自己分辨」更难被读错 ——
 * 后者只要有人写 `if (report.spawn)` 就永远为真，那正是评审要消掉的坑。
 */
function newReport(mode) {
  return {
    schema: ISOLATION_REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    ok: false,
    exitCode: EXIT.ok,
    mode,
    instance: undefined,
    cli: undefined,
    checks: {},
    plan: { command: [], env: {}, display: '', dryRun: false },
    notes: [],
  }
}

/**
 * 收尾：`generatedAt` 记的是**完成时刻**，`ok` 跟随退出码。
 * 为什么 ok 跟退出码而不是「所有门都 ok」：§5.1 R14 明确把 horosaGuard 的 ok 与退出码解耦了
 * （probe-failed = 没验成 → 门 ok:false，但退出码仍 0）。报告顶层的 ok 是给 CI 用的那个信号，
 * 单门的 ok 是门自己的口径；两者的关系写在 notes 里，不靠猜。
 */
function finish(report) {
  report.generatedAt = new Date().toISOString()
  report.ok = report.exitCode === EXIT.ok
  return report
}

/** 6 个 check 位——契约 §4.5 冻结了这六个，不多不少。 */
function check(id, ok, detail, extra = {}) {
  return { id, ok, detail, ...extra }
}

function notEvaluated(id) {
  return check(id, false, '未执行：更早的门就失败了（见同一报告里 FAIL 的那一项）')
}

/**
 * 早退（用法/环境/内部错误）：把六个 check 位填满（保持报告形状稳定，调用方不必判空），
 * 再覆盖出错那一项。这样 `checks.<id>.ok` 永远是可信的，测试不会因为「键不存在」写特殊分支。
 */
function abort(report, exitCode, id, detail, hint, error) {
  for (const checkId of CHECK_IDS) {
    if (report.checks[checkId] === undefined) report.checks[checkId] = notEvaluated(checkId)
  }
  report.checks[id] = check(id, false, detail, hint === undefined ? {} : { hint })
  report.exitCode = exitCode
  report.error = error ?? detail
  return finish(report)
}

/**
 * 退出码推导：环境门（home/cli/profile）失败 → 2；否则隔离门失败 → 3；否则 0。
 * 探针模块缺失时强制 2：那是「环境还没准备好」，不是「端口被占」。
 *
 * horosaGuard **不按 ok 推**（§5.1 R14）：`probe-failed` 是 ok:false 但退出码不变，
 * 只有 `verdict === 'occupied-foreign'`（真的拿到 HTTP 响应、但形态不像 MCP）才判 3。
 */
function pickExitCode(checks, { probeUnavailable = false } = {}) {
  if (probeUnavailable) return EXIT.environment
  if (ENVIRONMENT_CHECK_IDS.some((id) => checks[id]?.ok !== true)) return EXIT.environment
  if (checks.horosaGuard?.evidence?.verdict === 'occupied-foreign') return EXIT.isolation
  if (ISOLATION_EXIT_CHECK_IDS.some((id) => checks[id]?.ok !== true)) return EXIT.isolation
  return EXIT.ok
}

/* ───────────────────────────── 主流程（可复用 API） ───────────────────────────── */

/**
 * 算清一切并按 mode 执行，返回 `xuanshu/isolation-report@1` 报告。
 * **不打印、不 process.exit**：命令行壳（本文件底部）与 `scripts/verify-isolation.mjs` 共用它，
 * 所以「测试跑的东西」和「人敲的命令」永远是同一条代码路径。
 */
export async function runStartup(options = {}) {
  const started = Date.now()
  const env = options.env ?? process.env
  const mode = String(options.mode ?? DEFAULT_MODE)
  const dryRun = options.dryRun === true
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS
  const report = newReport(mode)
  report.plan.dryRun = dryRun
  const notes = report.notes

  if (!MODES.includes(mode)) {
    return abort(report, EXIT.usage, 'home', `未知 mode：${mode}`, `--mode ${MODES.join('|')}`, `--mode must be one of ${MODES.join('|')}`)
  }

  /* ① 仓库根：向上找 pnpm-workspace.yaml（不写死盘符/仓库名）。 */
  let repoRoot
  try {
    repoRoot = options.repoRoot ?? resolveRepoRoot(options.cwd ?? process.cwd())
  } catch (error) {
    return abort(report, EXIT.usage, 'home', error.message, '在仓库目录里运行，或显式传 --home <dir>')
  }

  /* ② 隔离 home：解析 + 拒绝真实 home。 */
  const homeInfo = resolveHomeWithSource({ home: options.home, env, repoRoot, realHome: options.realHome })
  const home = homeInfo.home
  for (const message of homeInfo.ignored) notes.push(message)
  if (samePath(home, homeInfo.realHome) || isUnderPath(homeInfo.realHome, home)) {
    return abort(
      report,
      EXIT.usage,
      'home',
      `拒绝在用户真实 DSH home 上运行：${home}`,
      `换隔离 home：node scripts/isolation/startup.mjs --home "${join(repoRoot, '.dsh-home')}"（开发档默认；`
      + `产品档是自己的 ~/.xuanshu，见 docs/runbook/home.md），也可设 ${ENV.home}`,
    )
  }

  /* ③ 实例：把「这次要跑的是什么」一次算全。 */
  let instance
  try {
    instance = resolveInstance({
      home,
      profile: options.profile,
      webPort: options.webPort,
      horosaPort: options.horosaPort,
      repoRoot,
      env,
      cliBin: options.cliBin,
    })
  } catch (error) {
    return abort(report, EXIT.usage, 'home', error.message, 'node scripts/isolation/startup.mjs --help')
  }
  report.instance = Object.fromEntries(INSTANCE_KEYS.map((key) => [key, instance[key]]))
  report.cli = instance.cli === undefined
    ? { binJs: undefined, version: undefined, source: 'not-found', versionMatches: false, wantedVersion: undefined }
    : {
      binJs: instance.cli.binJs,
      version: instance.cli.version,
      source: instance.cli.source,
      versionMatches: instance.cli.versionMatches,
      wantedVersion: instance.cli.wantedVersion,
    }

  /* ④ home 门。 */
  const homeExists = existsSync(home) && (() => { try { return statSync(home).isDirectory() } catch { return false } })()
  report.checks.home = check(
    'home',
    homeExists,
    homeExists
      ? `隔离 home ${home}（来源 ${homeInfo.source}）；真实 home ${homeInfo.realHome} 不会被碰`
      : `隔离 home 不存在：${home}（来源 ${homeInfo.source}）`,
    {
      hint: homeExists ? undefined : `node scripts/install-profile.mjs --home "${home}" 会把它建出来，或先 mkdir`,
      evidence: { home, homeSource: homeInfo.source, realHome: homeInfo.realHome, exists: homeExists, ignoredEnv: homeInfo.ignored },
    },
  )

  /* ⑤ --install：缺 profile 时先装配（否则 profile 门必然 FAIL，提示里也是这条命令）。 */
  let install = options.install === true ? { skipped: true, reason: 'profile 已装好，未重跑' } : undefined
  if (options.install === true && !isProfileInstalled(instance.profileDir)) {
    const script = join(repoRoot, 'scripts', 'install-profile.mjs')
    const installStarted = Date.now()
    // stdio 用 pipe 而不是 inherit：`--json` 时 stdout 必须是单份 JSON，不能被 pnpm 的日志插队。
    const run = spawnSync(process.execPath, [script, '--home', home, '--profile', instance.profile], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: options.timeoutExplicit === true ? timeoutMs : 600_000,
    })
    install = {
      script,
      status: run.status,
      signal: run.signal ?? undefined,
      error: run.error?.message,
      ms: Date.now() - installStarted,
      stdoutTail: tail(run.stdout),
      stderrTail: tail(run.stderr),
    }
    notes.push(`--install：跑过 scripts/install-profile.mjs（exit ${run.status ?? 'null'}）`)
  }

  /* ⑥ profile 门（doctor 层面：装没装；headless 之后还会加「能不能真的 boot」；
      web 模式还会加一条「web bundle 在不在」的前置条件 —— 见下面 §5.1 R2 那段）。 */
  const profileManifest = readJsonFile(join(instance.profileDir, 'package.json'))
  const profileNodeModules = existsSync(join(instance.profileDir, 'node_modules'))
  const dshBaseVersion = readJsonFile(join(instance.profileDir, 'node_modules', ...DSH_BASE_PACKAGE.split('/'), 'package.json'))?.version
  const profileInstalled = profileManifest !== undefined && profileNodeModules

  // ── web bundle 门（评审裁决 §5.1 R2） ─────────────────────────────────────────
  // `dsh web` 这个子命令由 `@deepseek-ai/dsh-web-app` 提供。profile 里**有它的包文件**不等于
  // 它会加载：DSH 只把 `dsh.profile.bundles` 里声明的层叠进装配树（这也是票 01 的补丁栈语义）。
  // 本机实测：包在 node_modules 里、但不在 bundles 列表里 → `dsh web --port N` 立刻
  // `error: unknown option '--port'` exit 1（2.3s）。所以判据是「**声明了** + 装上了」，
  // 而不是「node_modules 里躺着个目录」—— 后者会让我们 spawn 一个必死的子进程（正是 R2 禁止的）。
  const bundles = Array.isArray(profileManifest?.dsh?.profile?.bundles) ? profileManifest.dsh.profile.bundles : []
  const webAppDir = join(instance.profileDir, 'node_modules', ...DSH_WEB_APP_PACKAGE.split('/'))
  const webAppManifest = readJsonFile(join(webAppDir, 'package.json'))
  const webBundle = {
    package: DSH_WEB_APP_PACKAGE,
    installed: webAppManifest !== undefined,
    version: webAppManifest?.version,
    patchFile: existsSync(join(webAppDir, 'cordis.patch.yml')),
    declaredInBundles: bundles.includes(DSH_WEB_APP_PACKAGE),
    bundles,
  }
  webBundle.available = webBundle.declaredInBundles && webBundle.installed
  // 只有 web 模式需要它：headless 与 web bundle 无关，doctor/env 只是「算清事实」，
  // 让它们因此变红会把「本票装不出 web」误报成「隔离环境坏了」。
  const webBundleBlocksMode = mode === 'web' && !webBundle.available
  const profileOk = profileInstalled && !webBundleBlocksMode
  const profileDetail = webBundleBlocksMode
    ? `profile "${instance.profile}" 装在 ${instance.profileDir}，但缺 web bundle：${DSH_WEB_APP_PACKAGE} `
      + `没有出现在 dsh.profile.bundles（当前：${bundles.join(', ') || '空'}；node_modules 里${webBundle.installed ? '有包文件但不会加载' : '连包文件都没有'}）`
      + `—— 缺它时 \`dsh web --port\` 会以 \`error: unknown option '--port'\` exit 1，所以 --mode web 拒绝 spawn；`
      + `该 bundle 属票 07（首页替换），本票不接（§5.1 R1）`
    : profileInstalled
      ? `profile "${instance.profile}" 已装在 ${instance.profileDir}（node_modules 在${dshBaseVersion === undefined ? '' : `，${DSH_BASE_PACKAGE} ${dshBaseVersion}`}）`
      : `profile "${instance.profile}" 没装在 ${instance.profileDir}（缺 ${profileManifest === undefined ? 'package.json' : 'node_modules'}）`
  report.checks.profile = check('profile', profileOk, profileDetail, {
    hint: webBundleBlocksMode
      ? [
        `node scripts/isolation/startup.mjs --mode env    # 拿 plan.command 交给装了 web bundle 的实例去跑`,
        `# 或等票 07 把 ${DSH_WEB_APP_PACKAGE} 接进 profile/package.json 的 dsh.profile.bundles（本票 §5.1 R1 明确不接）`,
      ].join('\n')
      : profileInstalled ? undefined : `node scripts/isolation/startup.mjs --install  或  node scripts/install-profile.mjs --home "${home}" --profile ${instance.profile}`,
    evidence: {
      profile: instance.profile,
      profileDir: instance.profileDir,
      linkTarget: linkTargetOf(instance.profileDir),
      manifestName: profileManifest?.name,
      nodeModules: profileNodeModules,
      dshBaseVersion,
      bundles,
      webBundle,
      install,
    },
  })
  if (mode === 'web' && !webBundle.available) {
    notes.push(`${DSH_WEB_APP_PACKAGE} bundle 不在（declaredInBundles=${webBundle.declaredInBundles}, installed=${webBundle.installed}）：--mode web 在 spawn 前就拒绝，而不是放一个必死的子进程出去（§5.1 R2）。`)
  } else if (!webBundle.available) {
    notes.push(`${DSH_WEB_APP_PACKAGE} bundle 不在（属票 07）：--mode web 在本票用不了；doctor/env/headless 不受影响。`)
  }

  /* ⑦ CLI 门：必须来自 profile 树且版本与 dsh-base 相符。 */
  const cliFound = instance.cli !== undefined
  const cliOk = cliFound && instance.cli.versionMatches === true
  const cliDetail = !cliFound
    ? `找不到 DSH CLI（profile 树 / 同 home 的兄弟 profile / PATH 都没有）`
    : instance.cli.versionMatches
      ? `CLI v${instance.cli.version}（${instance.cli.source}）与 profile 装的 ${DSH_BASE_PACKAGE} ${instance.cli.wantedVersion ?? '?'} 相符`
      : `CLI v${instance.cli.version}（${instance.cli.source}）≠ profile 装的 ${DSH_BASE_PACKAGE} ${instance.cli.wantedVersion}：版本不符的 CLI 会去解析别人的 node_modules（实测崩在 StartupError 导入）`
  report.checks.cli = check('cli', cliOk, cliDetail, {
    hint: cliOk ? undefined : `重新装配 profile 让它自带 CLI：node scripts/install-profile.mjs --home "${home}" --profile ${instance.profile}`,
    evidence: {
      binJs: instance.cli?.binJs,
      version: instance.cli?.version,
      source: instance.cli?.source,
      versionMatches: instance.cli?.versionMatches,
      wantedVersion: instance.cli?.wantedVersion,
      moduleRoot: instance.cli?.moduleRoot,
      hasCordis: instance.cli?.moduleRoot === undefined ? undefined : existsSync(join(instance.cli.moduleRoot, '@deepseek-ai', 'cordis')),
      rejects: instance.cli?.rejects ?? [],
    },
  })

  /* ⑧ 两道隔离门：web 端口 与 horosa 单占用守卫（并发跑，省一半等待）。 */
  const gates = await loadGates()
  const probeUnavailable = gates.error !== undefined
  if (probeUnavailable) {
    const detail = `探针模块不可用（等队友 B 的 scripts/isolation/port-probe.mjs + horosa-guard.mjs）：${gates.error}`
    report.checks.webPort = check('webPort', false, detail, { hint: '等这两个文件落盘后重跑；期间不要拿它当「端口空闲」的证据' })
    report.checks.horosaGuard = check('horosaGuard', false, detail, { hint: '同上' })
    report.exitCode = pickExitCode(report.checks, { probeUnavailable })
  } else {
    const [webBusy, desktopBusy, guard] = await Promise.all([
      gates.isPortBusy(instance.webPort),
      gates.isPortBusy(DESKTOP_WEB_PORT),
      gates.checkHorosaPort({ port: instance.horosaPort, path: HOROSA_MCP_PATH }),
    ])
    const collidesWithDesktop = instance.webPort === DESKTOP_WEB_PORT
    const webPortOk = webBusy !== true && !collidesWithDesktop
    report.checks.webPort = check(
      'webPort',
      webPortOk,
      collidesWithDesktop
        ? `web 端口 ${instance.webPort} 就是 desktop 的端口：xuanshu 必须用独立端口（默认 ${DEFAULT_WEB_PORT}）`
        : webBusy
          ? `127.0.0.1:${instance.webPort} 已被占用：xuanshu 需要独立端口才能与 desktop 同跑`
          : `127.0.0.1:${instance.webPort} 空闲（desktop 的 ${DESKTOP_WEB_PORT} ${desktopBusy ? '在跑' : '没在跑'}）`,
      {
        hint: webPortOk ? undefined : `换端口：--web-port <n> 或设 ${ENV.webPort}=<n>（desktop 占 ${DESKTOP_WEB_PORT}，别撞）`,
        evidence: { port: instance.webPort, portSource: instance.portSources?.web, busy: webBusy, desktopPort: DESKTOP_WEB_PORT, desktopBusy },
      },
    )

    // §5.1 R14：`ok` 是「验没验成」，退出码只认「确认被外人占」（见 pickExitCode）。
    // free / horosa-ready → ok:true；occupied-foreign → ok:false + exit 3；
    // probe-failed → ok:false（没验成不能显示成绿灯）但**不改退出码**，结论记成 unknown。
    const verdict = guard?.verdict
    const horosaOk = verdict === 'free' || verdict === 'horosa-ready'
    const unknown = verdict === 'probe-failed' || verdict === undefined
    if (unknown) {
      notes.push(`horosa 守卫没验成 127.0.0.1:${instance.horosaPort}（verdict=${verdict ?? '无'}）：checks.horosaGuard.ok=false，但这不是隔离失败 —— 退出码不受它影响（§5.1 R14），结论是 unknown。`)
    }
    report.checks.horosaGuard = check(
      'horosaGuard',
      horosaOk,
      unknown
        ? `${guard?.detail ?? `horosa 守卫没有给出结论（verdict=${verdict}）`}（没验成：ok=false，但这不是隔离失败、不改退出码）`
        : guard?.detail ?? `horosa 守卫没有给出结论（verdict=${verdict}）`,
      {
        hint: horosaOk ? undefined : guard?.hint,
        evidence: {
          verdict,
          unknown,
          port: guard?.port ?? instance.horosaPort,
          url: guard?.url ?? instance.horosaUrl,
          portSource: instance.portSources?.horosa,
          probe: guard?.evidence ?? {},
        },
      },
    )
  }

  /* ⑨ 计划：命令 + 环境覆盖（env 模式直接打给 pwsh/CI 用）。 */
  const webArgs = [
    '--port', String(instance.webPort), '--no-open',
    ...(options.host === undefined ? [] : ['--host', String(options.host)]),
    ...((options.trustedHosts ?? []).flatMap((authority) => ['--trusted-host', String(authority)])),
    ...(options.extraArgs ?? []),
  ]
  const headlessArgs = ['--help', ...(options.extraArgs ?? [])]
  const dshArgs = ['--profile', instance.profile, ...(mode === 'headless' ? headlessArgs : webArgs)]
  const plannedBinJs = instance.cli?.binJs ?? join(instance.profileDir, 'node_modules', ...DSH_PACKAGE.split('/'), 'lib', 'bin.js')
  const planEnv = {
    [ENV.home]: home,
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
    NO_COLOR: '1',
    XUANSHU_SURFACE: mode === 'headless' ? 'headless' : 'web',
    [ENV.profile]: instance.profile,
    [ENV.webPort]: String(instance.webPort),
    [ENV.horosaPort]: String(instance.horosaPort),
  }
  report.plan = {
    command: [process.execPath, plannedBinJs, ...dshArgs],
    env: planEnv,
    display: renderCommandLine([process.execPath, plannedBinJs, ...dshArgs]),
    dryRun,
    // doctor/env 展示的是「真正启动实例」的那条命令（web）；headless 展示它自己那条。
    note: mode === 'headless' ? 'headless 计划（boot + dispose，不调 LLM、不开端口）' : 'web 计划（doctor/env 模式只展示、不执行）',
  }

  /* ⑩ 状态隔离门：六条派生路径 + （headless 时）装配报告本次新写出。 */
  const pathRows = ISOLATED_PATH_KEYS.map((key) => ({ key, path: instance[key], underHome: isUnderPath(home, instance[key]) }))
  const escaped = pathRows.filter((row) => !row.underHome)
  let alternate
  try {
    // 纯函数对照（不落盘）：换一个 home，派生路径必须两两不同，否则「隔离」只是错觉。
    const alt = resolveInstance({
      home: `${home}.alt`,
      profile: instance.profile,
      webPort: instance.webPort,
      horosaPort: instance.horosaPort,
      repoRoot,
      env: {},
    })
    alternate = { home: alt.home, allDistinct: ISOLATED_PATH_KEYS.every((key) => !samePath(alt[key], instance[key])) }
  } catch {
    alternate = undefined
  }
  report.checks.stateIsolated = check(
    'stateIsolated',
    escaped.length === 0,
    escaped.length === 0
      ? `${pathRows.length} 条派生路径全在 ${home} 下（profileDir 是指向仓库 profile 的联接）；换 home 后两两不同=${alternate?.allDistinct ?? 'n/a'}`
      : `这些派生路径跑到隔离 home 之外了：${escaped.map((row) => `${row.key}=${row.path}`).join('、')}`,
    {
      hint: escaped.length === 0 ? undefined : '这是隔离实现出错了（不是用法问题）：报给隔离启动器的维护者',
      evidence: { home, paths: pathRows, alternateHome: alternate, headlessReport: undefined },
    },
  )

  report.exitCode = pickExitCode(report.checks, { probeUnavailable })
  // spawn 前提 = 「没有任何**阻断性**失败」，也就是退出码为 0。
  // 注意它**不等于**「六门全绿」：probe-failed 的 horosaGuard 是 ok:false 但不阻断（§5.1 R14）。
  // 若按「全绿」放行，就会出现「退出码 0 但拒绝启动」这种自相矛盾的状态 —— 没人能据此写 CI。
  const ready = report.exitCode === EXIT.ok

  if (dryRun) {
    notes.push('--dry-run：没有 spawn 任何进程、没有写盘；plan.* 就是本次的全部产物')
    return finish(report)
  }

  /* ⑪ headless：真跑一次 `--help`（boot + dispose + exit 0），断言装配报告「本次新写出」。 */
  if (mode === 'headless') {
    if (!ready) {
      notes.push('体检没过：不 spawn（先解决上面 FAIL 的门）')
      return finish(report)
    }
    const before = snapshotFile(instance.reportFile)
    const spawnStarted = Date.now()
    const run = spawnSync(process.execPath, [plannedBinJs, ...dshArgs], {
      cwd: repoRoot,
      env: { ...env, ...planEnv },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
    })
    const after = snapshotFile(instance.reportFile)
    const assembly = after.exists ? readJsonFile(instance.reportFile) : undefined
    // 「本次新写出」的判据是 mtime 前进（或从无到有），不是「文件存在」——
    // 上一次跑留下的旧报告会让「存在」永远为真，那种绿是假的。
    const fresh = after.exists && (before.exists !== true || after.mtimeMs > before.mtimeMs)
    const bootOk = run.error === undefined && run.status === 0
    const contentOk = assembly?.schema === ASSEMBLY_REPORT_SCHEMA && assembly?.ok === true
    report.spawn = {
      attempted: true,
      exitCode: run.status ?? undefined,
      signal: run.signal ?? undefined,
      error: run.error?.message,
      ms: Date.now() - spawnStarted,
      stdoutTail: tail(run.stdout),
      stderrTail: tail(run.stderr),
      report: {
        file: instance.reportFile,
        existedBefore: before.exists === true,
        mtimeBefore: before.mtimeMs,
        mtimeAfter: after.mtimeMs,
        bytes: after.bytes,
        fresh,
        schema: assembly?.schema,
        assemblyOk: assembly?.ok,
        generatedAt: assembly?.generatedAt,
      },
    }
    notes.push(`CLI 已真跑一次（${mode}）：<profile>/cordis.yml 是 DSH 每次启动都重写的运行期产物（profile 已 gitignore），本次已被重写；启动器不清理它。`)

    // 装配报告是否落在隔离 home 里、且是本次写的 → stateIsolated（隔离门）。
    report.checks.stateIsolated = {
      ...report.checks.stateIsolated,
      ok: report.checks.stateIsolated.ok && fresh,
      detail: `${report.checks.stateIsolated.detail}；装配报告${fresh ? '本次新写出' : `没有本次新写出（${instance.reportFile}）`}`,
      evidence: { ...report.checks.stateIsolated.evidence, headlessReport: report.spawn.report },
    }
    // profile 能不能真的 boot 出树 → profile 门（环境门）：doctor 里看不到这一层。
    if (!bootOk || !contentOk) {
      const reasons = []
      if (!bootOk) reasons.push(`CLI 退出异常：status=${run.status} signal=${run.signal} error=${run.error?.message ?? '—'}`)
      if (!contentOk) reasons.push(`装配报告不合格：schema=${JSON.stringify(assembly?.schema)} ok=${JSON.stringify(assembly?.ok)}`)
      report.checks.profile = {
        ...report.checks.profile,
        ok: false,
        detail: `${report.checks.profile.detail}；headless 启动没通过：${reasons.join('；')}`,
        hint: report.checks.profile.hint ?? `node scripts/isolation/startup.mjs --home "${home}" --install`,
      }
    } else {
      report.checks.profile = {
        ...report.checks.profile,
        detail: `${report.checks.profile.detail}；headless 启动一次 exit 0 且装配报告 ok=true`,
      }
    }
    report.exitCode = pickExitCode(report.checks, { probeUnavailable })
    return finish(report)
  }

  /* ⑫ web：全绿才 spawn，退出码 = 子进程退出码。
     §5.1 R3：`--json` 时 stdout 只允许一份 JSON，且必须是**终版**报告 —— 所以不预打印；
     子进程的 stdout/stderr 被转发到**父进程 stderr**（人在终端里照样看得见），
     子进程退出后才打报告（含真实 exitCode/signal/ms）。代价：`--json` 时日志不是实时的。 */
  if (mode === 'web') {
    if (!ready) {
      notes.push('体检没过：不 spawn（先解决上面 FAIL 的门）')
      return finish(report)
    }
    const spawnStarted = Date.now()
    const outcome = await spawnPiped(process.execPath, [plannedBinJs, ...dshArgs], {
      cwd: repoRoot,
      env: { ...env, ...planEnv },
      // 只有显式给了 --timeout-ms 才给长驻进程上闹钟：默认值是用来兜住 headless 的，不是用来掐服务器的。
      killAfterMs: options.timeoutExplicit === true ? timeoutMs : 0,
      onOutput: options.onChildOutput,
    })
    report.spawn = {
      attempted: true,
      exitCode: outcome.code ?? undefined,
      signal: outcome.signal ?? undefined,
      error: outcome.error,
      timedOut: outcome.timedOut === true ? true : undefined,
      ms: Date.now() - spawnStarted,
      stdoutTail: tail(outcome.stdout),
      stderrTail: tail(outcome.stderr),
    }
    notes.push('CLI 已真跑一次（web）：<profile>/cordis.yml 是 DSH 每次启动都重写的运行期产物（profile 已 gitignore），本次已被重写；启动器不清理它。')
    notes.push('web 的子进程日志是**转发**到父进程 stderr 的（--json 时 stdout 只留终版报告）：终端里看得到，但 `--json` 消费方拿不到实时日志。')
    if (outcome.error !== undefined || outcome.timedOut === true) {
      report.exitCode = EXIT.environment
      report.error = outcome.error ?? `web 子进程超过 ${timeoutMs}ms 未退出，已杀掉`
    } else {
      report.exitCode = outcome.code ?? (outcome.signal === undefined ? EXIT.environment : 130)
    }
    return finish(report)
  }

  /* ⑬ doctor / env：到此为止，绝不 spawn。 */
  report.exitCode = pickExitCode(report.checks, { probeUnavailable })
  if (mode === 'doctor' && !ready) {
    const blocking = CHECK_IDS.filter((id) => report.checks[id]?.ok !== true)
    notes.push(`doctor 没过（exit ${report.exitCode}）：${blocking.join('、')}；web 模式会拒绝启动。`)
  }
  if (mode === 'env') notes.push('env 模式只输出计划（plan.env + plan.command），不 spawn、不写盘')
  return finish(report)
}

/* ───────────────────────────── 输出（命令行壳） ───────────────────────────── */

function humanReport(report) {
  const lines = []
  const instance = report.instance ?? {}
  lines.push(`玄枢隔离启动器  mode=${report.mode}  profile=${instance.profile ?? '?'}`)
  lines.push(`  DSH_HOME   ${instance.home ?? '?'}`)
  lines.push(`  profileDir ${instance.profileDir ?? '?'}${report.checks.profile?.evidence?.linkTarget === undefined ? '' : `  → ${report.checks.profile.evidence.linkTarget}`}`)
  lines.push(`  CLI        ${report.cli?.binJs ?? '(未找到)'}${report.cli?.version === undefined ? '' : `  v${report.cli.version} (${report.cli.source})`}`)
  lines.push(`  端口       web 127.0.0.1:${instance.webPort ?? '?'}   horosa ${instance.horosaUrl ?? '?'}`)
  lines.push('')
  for (const id of CHECK_IDS) {
    const entry = report.checks[id]
    if (entry === undefined) continue
    lines.push(`[${id}] ${entry.ok ? 'PASS' : 'FAIL'}  ${entry.detail}`)
    if (entry.hint !== undefined) lines.push(`      → ${entry.hint.split('\n')[0]}`)
  }
  lines.push('')
  lines.push(`隔离环境：${Object.entries(report.plan.env).map(([key, value]) => `${key}=${value}`).join(' ')}`)
  lines.push(`计划命令：${report.plan.display}`)
  if (report.spawn?.attempted) {
    lines.push(`子进程：exit ${report.spawn.exitCode ?? '—'}${report.spawn.signal === undefined ? '' : ` signal ${report.spawn.signal}`}${report.spawn.ms === undefined ? '' : ` (${report.spawn.ms}ms)`}`)
  }
  const passed = CHECK_IDS.filter((id) => report.checks[id]?.ok === true).length
  lines.push('')
  lines.push(`结果：${passed}/${CHECK_IDS.length} 通过，exit ${report.exitCode}`)
  for (const note of report.notes) lines.push(`note: ${note}`)
  if (report.error !== undefined) lines.push(`错误：${report.error}`)
  return lines.join('\n')
}

/** env 模式的 stdout：给 pwsh / CI 直接消费的赋值语句 + 启动命令。 */
function envReport(report) {
  const lines = [`# 玄枢隔离环境  mode=env  profile=${report.instance?.profile ?? '?'}  home=${report.instance?.home ?? '?'}`]
  for (const [key, value] of Object.entries(report.plan.env)) {
    lines.push(process.platform === 'win32'
      ? `$env:${key}='${String(value).replace(/'/g, "''")}'`
      : `export ${key}='${String(value).replace(/'/g, "'\\''")}'`)
  }
  lines.push(`# 启动命令（web）：`)
  lines.push(report.plan.display)
  for (const note of report.notes) lines.push(`# note: ${note}`)
  return lines.join('\n')
}

function usageFailure(error, json) {
  const message = error?.message ?? String(error)
  if (json) {
    process.stdout.write(`${JSON.stringify({ schema: ISOLATION_REPORT_SCHEMA, ok: false, exitCode: EXIT.usage, error: message }, undefined, 2)}\n`)
  } else {
    process.stderr.write(`[isolation] 用法错误：${message}\n用法：node scripts/isolation/startup.mjs [--mode doctor|web|headless|env] [--home <dir>] [--json] [--dry-run] [-h]\n`)
  }
  process.exitCode = EXIT.usage
}

async function main() {
  let options
  try {
    options = parseStartupArgs(process.argv.slice(2))
  } catch (error) {
    usageFailure(error, process.argv.includes('--json'))
    return
  }
  if (options.help) {
    printHelp()
    return
  }

  const report = await runStartup({
    ...options,
    // web 的子进程日志转发到**父进程 stderr**：stdout 留给那份唯一的终版 JSON（§5.1 R3）。
    onChildOutput: (stream, chunk) => process.stderr.write(chunk),
  })

  const install = report.checks.profile?.evidence?.install
  if (install !== undefined && install.status !== 0) {
    process.stderr.write(`[isolation] install-profile 失败：exit ${install.status ?? 'null'}\n${install.stderrTail ?? ''}\n`)
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
  } else if (options.mode === 'env') {
    process.stdout.write(`${envReport(report)}\n`)
  } else {
    process.stdout.write(`${humanReport(report)}\n`)
  }
  process.exitCode = report.exitCode
}

/** 只有作为 CLI 直接跑时才执行；被 verify-isolation / 测试 import 时只导出 API。 */
const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (invokedDirectly) await main()
