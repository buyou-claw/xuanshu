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
 * 退出码（契约 §2）：0 通过；1 用法/内部错误；2 环境门失败（home / CLI / profile）；
 *                    3 隔离门失败（web 端口被占、horosa 被非 horosa 进程占用、状态外溢）。
 *
 * 四种模式：
 *   doctor（默认） 算清一切 + 跑 webPort/horosaGuard 两道门 + 断言派生路径都在 home 下，只报告不 spawn；
 *   web            doctor 全绿后 spawn `dsh --profile <p> web --port <n> --no-open`（stdio inherit），
 *                  退出码 = 子进程退出码；
 *   headless       真跑一次 `dsh --profile <p> --help`（= boot + dispose + exit 0，不调 LLM、不开端口），
 *                  并断言 `<home>/xuanshu/assembly-report.json` **本次新写出**；
 *   env            不 spawn，只把 plan.env / plan.command 打到 stdout，给 pwsh / CI 用。
 *
 * 隔离硬规矩（改代码前先读）：
 *   1) 解析出的 home 等于**或位于**用户真实 `~/.dsh` 下 → 用法失败（exit 1）。本票**不**提供
 *      `--allow-real-home` 之类的逃生舱：这个开关一存在，早晚会有人在 CI 里打开它。
 *   2) 环境里那支 `$DSH_HOME` 若指向真实 `~/.dsh` 会被**忽略**并记进 notes（在 DSH 会话里跑本脚本时，
 *      环境天然带着 desktop 的 `DSH_HOME`）；显式 `--home` / `XUANSHU_DSH_HOME` 永远优先。
 *   3) CLI 一律用 profile 树里那份 `<profile>/node_modules/@deepseek-ai/dsh/lib/bin.js`：
 *      PATH 上全局 npm 装的是 0.1.2-rc.1，与本票的 0.2.0-rc.2 树不兼容（会崩在
 *      `does not provide an export named 'StartupError'`）。版本不符时 `cli` 门判 FAIL（exit 2）。
 *   4) `--json` 时 stdout 只有一份 JSON，其余一切走 stderr；`runStartup()` 被 import 时**不打印任何东西**
 *      （断言台要自己决定怎么输出），也不调用 process.exit。
 *   5) `<profile>/cordis.yml` 是 DSH 每次启动都重写的运行期产物（profile 已 gitignore）：
 *      启动器**不清理**它（清理会让下一次启动的补丁栈基线漂移），只在 notes 里说明。
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

function spawnInherit(command, args, { cwd, env, killAfterMs = 0 }) {
  return new Promise((resolvePromise) => {
    let settled = false
    let timer
    const done = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolvePromise(result)
    }
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
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
    child.once('error', (error) => done({ error: error?.message ?? String(error) }))
    child.once('exit', (code, signal) => done({ code, signal }))
  })
}

/* ───────────────────────────── 报告骨架 ───────────────────────────── */

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
    spawn: { attempted: false },
    notes: [],
  }
}

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
 */
function pickExitCode(checks, { probeUnavailable = false } = {}) {
  if (probeUnavailable) return EXIT.environment
  if (ENVIRONMENT_CHECK_IDS.some((id) => checks[id]?.ok !== true)) return EXIT.environment
  if (ISOLATION_CHECK_IDS.some((id) => checks[id]?.ok !== true)) return EXIT.isolation
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
      `换隔离 home：node scripts/isolation/startup.mjs --home "${join(repoRoot, '.dsh-home')}"（或设 ${ENV.home}）`,
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

  /* ⑥ profile 门（doctor 层面：装没装；headless 之后还会加「能不能真的 boot」）。 */
  const profileManifest = readJsonFile(join(instance.profileDir, 'package.json'))
  const profileNodeModules = existsSync(join(instance.profileDir, 'node_modules'))
  const dshBaseVersion = readJsonFile(join(instance.profileDir, 'node_modules', ...DSH_BASE_PACKAGE.split('/'), 'package.json'))?.version
  const profileInstalled = profileManifest !== undefined && profileNodeModules
  report.checks.profile = check(
    'profile',
    profileInstalled,
    profileInstalled
      ? `profile "${instance.profile}" 已装在 ${instance.profileDir}（node_modules 在${dshBaseVersion === undefined ? '' : `，${DSH_BASE_PACKAGE} ${dshBaseVersion}`}）`
      : `profile "${instance.profile}" 没装在 ${instance.profileDir}（缺 ${profileManifest === undefined ? 'package.json' : 'node_modules'}）`,
    {
      hint: profileInstalled ? undefined : `node scripts/isolation/startup.mjs --install  或  node scripts/install-profile.mjs --home "${home}" --profile ${instance.profile}`,
      evidence: {
        profile: instance.profile,
        profileDir: instance.profileDir,
        linkTarget: linkTargetOf(instance.profileDir),
        manifestName: profileManifest?.name,
        nodeModules: profileNodeModules,
        dshBaseVersion,
        bundles: profileManifest?.dsh?.profile?.bundles,
        install,
      },
    },
  )

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
  let guardResult
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
    guardResult = guard
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
        evidence: { port: instance.webPort, busy: webBusy, desktopPort: DESKTOP_WEB_PORT, desktopBusy },
      },
    )

    // 契约 §4.5：free / horosa-ready / probe-failed 都不算失败；只有 occupied-foreign 让门 FAIL。
    const verdict = guard?.verdict
    const horosaOk = verdict !== 'occupied-foreign'
    if (verdict === 'probe-failed') {
      notes.push(`horosa 守卫无法判定 127.0.0.1:${instance.horosaPort}（probe-failed）：不算被占，也不算通过 —— 报告该门为 ok=${horosaOk}，但结论是 unknown。`)
    }
    report.checks.horosaGuard = check('horosaGuard', horosaOk, guard?.detail ?? `horosa 守卫没有给出结论（verdict=${verdict}）`, {
      hint: horosaOk ? undefined : guard?.hint,
      evidence: { verdict, port: guard?.port ?? instance.horosaPort, url: guard?.url ?? instance.horosaUrl, probe: guard?.evidence ?? {} },
    })
  }

  /* ⑨ 计划：命令 + 环境覆盖（env 模式直接打给 pwsh/CI 用）。 */
  const webArgs = [
    'web', '--port', String(instance.webPort), '--no-open',
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
  const ready = CHECK_IDS.every((id) => report.checks[id]?.ok === true)

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

  /* ⑫ web：全绿才 spawn（stdio inherit），退出码 = 子进程退出码。 */
  if (mode === 'web') {
    if (!ready) {
      notes.push('体检没过：不 spawn（先解决上面 FAIL 的门）')
      return finish(report)
    }
    report.spawn = { attempted: true }
    // web 是长驻进程：`--json` 时报告必须在子进程接管 stdout 之前打出去（命令行壳用这个钩子）。
    if (typeof options.onBeforeSpawn === 'function') options.onBeforeSpawn(report)
    const outcome = await spawnInherit(process.execPath, [plannedBinJs, ...dshArgs], {
      cwd: repoRoot,
      env: { ...env, ...planEnv },
      // 只有显式给了 --timeout-ms 才给长驻进程上闹钟：默认值是用来兜住 headless 的，不是用来掐服务器的。
      killAfterMs: options.timeoutExplicit === true ? timeoutMs : 0,
    })
    report.spawn = {
      attempted: true,
      exitCode: outcome.code ?? undefined,
      signal: outcome.signal ?? undefined,
      error: outcome.error,
      timedOut: outcome.timedOut === true ? true : undefined,
      ms: Date.now() - started,
    }
    notes.push('CLI 已真跑一次（web）：<profile>/cordis.yml 是 DSH 每次启动都重写的运行期产物（profile 已 gitignore），本次已被重写；启动器不清理它。')
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
  if (mode === 'doctor' && !ready) notes.push('doctor 没过：web 模式会拒绝启动（先解决上面 FAIL 的门）')
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

  let printed = false
  const printJson = (report) => {
    printed = true
    process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
  }
  const report = await runStartup({
    ...options,
    // web 模式的 stdout 之后归子进程所有：报告要在那之前打出去，否则 JSON 后面会接一坨服务器日志。
    onBeforeSpawn: options.json ? (pending) => { pending.spawn.pending = true; printJson(pending) } : undefined,
  })

  const install = report.checks.profile?.evidence?.install
  if (install !== undefined && install.status !== 0) {
    process.stderr.write(`[isolation] install-profile 失败：exit ${install.status ?? 'null'}\n${install.stderrTail ?? ''}\n`)
  }

  if (options.json) {
    if (!printed) printJson(report)
    else process.stderr.write(`[isolation] web 子进程已退出：exit ${report.exitCode}\n`)
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
