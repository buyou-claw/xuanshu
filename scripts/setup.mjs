#!/usr/bin/env node
/**
 * scripts/setup.mjs — 玄枢「一条命令装好」的唯一入口（票 05 / 契约 `.scratch/assembly-foundation/notes/setup-contract.md` §2–§9）。
 *
 * 一条命令 = 取件 → 校验 → 装 runtime → 装配 profile → 自检 → 写报告：
 *
 *   node scripts/setup.mjs                    # 开发机一键（缺省：隔离 home <repo>/.dsh-home，runtime 落 C:\horosa）
 *   pnpm setup:xuanshu                        # 等价（npm script 由 Lead 落地）
 *   node scripts/setup.mjs --dry-run          # 只打印计划，零副作用
 *   node scripts/setup.mjs --wheel D:\whl\horosa_skill-0.40.1-py3-none-any.whl \
 *                          --runtime D:\rt\horosa-runtime-win32-x64-v0.40.1.zip   # 全离线（仍过 SHA256 门）
 *   node scripts/setup.mjs --mirror https://gh-proxy.com/https://github.com       # 走镜像（本机直连只有 12–24 KB/s）
 *   node scripts/setup.mjs --verify-only --no-selfcheck                           # 只写报告，不取件不安装
 *
 * 选项（全部可选，缺省即「开发机一键」）：
 *   --wheel <path|url>        离线/替代 wheel（本地路径优先，且不走网络）      缺省：cache/下载
 *   --runtime <path|url>      离线/替代 runtime 归档（本地路径优先）            缺省：cache/下载
 *   --mirror <prefix[,prefix]> GitHub 镜像前缀，替换 https://github.com（原 URL 永远最后）
 *                             缺省：$HOROSA_RUNTIME_MIRROR ＞ 空
 *   --retries <n>             每个候选 URL 的最大尝试次数                        缺省 3（指数退避，≤5s）
 *   --recheck                 强制重算缓存大文件的 SHA256（默认只比 sidecar）   缺省关
 *   --cache <dir>             工件缓存目录                                       缺省 $XUANSHU_CACHE ＞ win32 %LOCALAPPDATA%\xuanshu\cache ＞ ~/.cache/xuanshu
 *   --runtime-root <dir>      HOROSA_RUNTIME_ROOT（Windows 必须纯 ASCII）        缺省 win32 C:\horosa；posix ~/.horosa/runtime
 *   --dsh-home <dir>          DSH home（profile 装配目标 + 数据目录根）          缺省 $XUANSHU_DSH_HOME ＞ $DSH_HOME ＞ <repo>/.dsh-home
 *   --install                 显式允许写**真实** ~/.dsh（不给则拒绝，exit 3）     缺省关
 *   --profile <name>          profile 名                                         缺省 xuanshu
 *   --profile-mode link|copy  装配形态（透传 install-profile.mjs）               缺省 link
 *   --horosa-port <n>         horosa MCP 端口（＞ XUANSHU_HOROSA_PORT ＞ HOROSA_SKILL_PORT ＞ 8765）
 *   --skip-download           只用缓存/本地件；缺件即失败（严格离线）             缺省关
 *   --verify-only             只跑自检，不做取件/安装                             缺省关
 *   --no-selfcheck            跳过三条自检                                       缺省关
 *   --selfcheck-timeout <ms>  自检里「起 serve + 八字出盘」的预算                 缺省 600000
 *   --keep-serve              自检结束后不关掉**自己起的** horosa serve           缺省关
 *   --force                   同版本也重装 runtime（透传 install --force）        缺省关
 *   --dry-run                 只打印计划（含两道纯环境门的结论），零副作用        缺省关
 *   --json                    stdout 只输出报告 JSON（进度一律走 stderr）         缺省关
 *   -h, --help                打印本注释块
 *
 * 退出码（冻结）：0 成功 / 1 用法或未预期错误 / 2 取件校验失败 / 3 环境门拒绝 / 4 安装失败 / 5 自检失败。
 *
 * 硬约束（不是建议）：
 *   - **缺省绝不写真实 `~/.dsh`**：解析结果等于/落在真实 home 里时必须显式 `--install`，否则 exit 3；
 *   - 缺省绝不写真实 `~/.horosa`：数据目录一律 `<dsh-home>/xuanshu/horosa`；
 *   - Windows 上 runtime 根必须纯 ASCII（`C:\horosa`），且这道门跑在任何网络/写盘动作**之前**；
 *   - SHA256 不匹配 = 一个字节都不装（删 `.part`/目标件 + exit 2）；
 *   - `install --archive` **只收本地已校验绝对路径**（给 URL 会绕开我们的校验门）；
 *   - 自检只停**自己起的** serve，绝不动别人在 8765/9999/8899 上的进程；
 *   - 报告：`<dsh-home>/xuanshu/setup-report.json`（schema `xuanshu/setup-report@1`）。
 *
 * 测试注入口（仅测试用，缺省走真实实现）：
 *   XUANSHU_UVX_BIN / XUANSHU_SKIP_PREFLIGHT / XUANSHU_SETUP_PIN / XUANSHU_INSTALL_PROFILE_BIN / XUANSHU_VERIFY_ASSEMBLY_BIN
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { acquireArtifact, cacheFilePath, cacheState, isUrl } from './setup/acquire.mjs'
import { parseArgs, readHelpBlock } from './setup/args.mjs'
import { humanBytes } from './setup/digest.mjs'
import { EXIT, SetupError, exitLabel } from './setup/exit.mjs'
import { mirrorCandidates, resolveMirrorPrefixes } from './setup/mirror.mjs'
import { checkAsciiRuntimeRoot, checkRealHomePolicy, resolveSetupPaths } from './setup/paths.mjs'
import { DEFAULT_PIN_PATH, loadPin, resolveArtifacts } from './setup/pin.mjs'
import { runCommand, uvxBin } from './setup/proc.mjs'
import { installProfile } from './setup/profile.mjs'
import { clipEvidence, formatReport, newReport, writeReport } from './setup/report.mjs'
import { setupRuntime } from './setup/runtime-install.mjs'
import { runSelfcheck } from './setup/selfcheck.mjs'

/** 仓库根：本文件在 `scripts/` 下。 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** pin 覆盖（测试注入点，契约 §10）。 */
const PIN_ENV = 'XUANSHU_SETUP_PIN'

/** uvx 环境门的探测超时。 */
const PREFLIGHT_TIMEOUT_MS = 20_000

const log = (line) => process.stderr.write(`${line}\n`)

async function main(argv) {
  let opts
  try {
    opts = parseArgs(argv)
  } catch (error) {
    return usageFailure(error)
  }
  if (opts.help) {
    process.stdout.write(`${readHelpBlock(fileURLToPath(import.meta.url))}\n`)
    return EXIT.ok
  }

  /* ── 路径 + 钉版（纯解析，零副作用） ───────────────────────────── */
  let paths
  let pin
  let artifacts
  try {
    paths = resolveSetupPaths({
      home: opts.dshHome,
      profile: opts.profile,
      cache: opts.cache,
      runtimeRoot: opts.runtimeRoot,
      horosaPort: opts.horosaPort,
      repoRoot: REPO_ROOT,
    })
    paths.profileMode = opts.profileMode
    const pinPath = resolvePinPath(process.env)
    pin = loadPin(pinPath)
    artifacts = resolveArtifacts(pin)
    artifacts.wheel.pinVersion = pin.version
    artifacts.runtime.pinVersion = pin.version
  } catch (error) {
    return failureReport(setupError(error), { opts, paths: undefined, pin: undefined })
  }

  const mirror = resolveMirrorPrefixes({ mirror: opts.mirror })
  const report = newReport({
    pin: { version: pin.version, wheel: artifacts.wheel, runtime: artifacts.runtime },
    paths,
  })
  report.profile.mode = opts.profileMode
  report.notes.push(`DSH home：${paths.home}（来源 ${paths.homeSource}）`)
  for (const note of paths.homeIgnored) report.notes.push(note)
  report.notes.push(`runtime 根：${paths.runtimeRoot}（来源 ${paths.runtimeRootSource}）`)
  report.notes.push(`缓存目录：${paths.cacheDir}（来源 ${paths.cacheSource}）`)
  report.notes.push(`数据目录：${paths.dataDir}（来源 ${paths.dataDirSource}）`)
  report.notes.push(`horosa 端口：${paths.horosaPort}（来源 ${paths.horosaPortSource}）；host ${paths.horosaHost}（来源 ${paths.horosaHostSource}）`)
  if (artifacts.runtime.fallback) report.notes.push(`平台 ${artifacts.runtime.hostPlatform} 走 ${artifacts.runtime.platform} 载荷（上游支持的仿真组合）`)
  report.notes.push(mirror.prefixes.length > 0
    ? `镜像前缀 ${mirror.prefixes.length} 个（来源 ${mirror.source}）：${mirror.prefixes.join(', ')}`
    : `未配置镜像（来源 ${mirror.source}）—— 本机直连 github 实测只有 12–24 KB/s`)

  /* ── 两道纯环境门（`--dry-run` 也跑：它们零副作用，而且正是你想提前知道的） ── */
  const realHome = checkRealHomePolicy({ home: paths.home, install: opts.install })
  const ascii = checkAsciiRuntimeRoot(paths.runtimeRoot)
  const gates = { realHome, ascii }

  if (opts.dryRun) {
    return dryRun({ opts, paths, pin, artifacts, mirror, gates, report })
  }

  /* ── 真跑 ─────────────────────────────────────────────── */
  try {
    if (!realHome.ok) throw new SetupError(realHome.detail, { code: EXIT.environment, hint: realHome.hint })
    if (!ascii.ok) throw new SetupError(ascii.detail, { code: EXIT.environment, hint: ascii.hint })
    await preflightUvx()

    const childEnv = buildChildEnv({ mirror, prefixes: mirror.prefixes, paths })

    if (opts.verifyOnly) {
      report.notes.push('--verify-only：不做取件/安装，只跑自检并写报告（pin 段只反映缓存现状）')
      fillPinFromCache({ report, artifacts, cacheDir: paths.cacheDir })
    } else {
      await acquireAll({ report, artifacts, opts, paths, mirror })
      const runtimeResult = await setupRuntime({
        wheelPath: report.pin.wheel.path,
        archivePath: report.pin.runtime.path,
        pinVersion: pin.version,
        runtimeRoot: paths.runtimeRoot,
        dataDir: paths.dataDir,
        force: opts.force,
        env: childEnv,
        log,
      })
      report.runtime.action = runtimeResult.action
      report.runtime.version = runtimeResult.version
      report.runtime.evidence = clipEvidence({
        versionKey: runtimeResult.versionKey,
        doctorBefore: runtimeResult.doctorBefore,
        doctorAfter: runtimeResult.doctorAfter,
        install: runtimeResult.install,
      })

      const profileResult = await installProfile({
        repoRoot: REPO_ROOT,
        dshHome: paths.home,
        profile: paths.profile,
        mode: opts.profileMode,
        env: process.env,
        log,
      })
      report.profile.action = profileResult.action
      report.profile.target = profileResult.target
      log(`[setup] profile 完成：${profileResult.action}（${profileResult.durationMs}ms）`)
    }

    if (opts.noSelfcheck) {
      report.notes.push('--no-selfcheck：三条自检被显式跳过（报告 checks 为空）')
      report.ok = true
      report.exitCode = EXIT.ok
    } else {
      const selfcheck = await runSelfcheck({
        repoRoot: REPO_ROOT,
        dshHome: paths.home,
        profile: paths.profile,
        wheelPath: report.pin.wheel.path,
        runtimeRoot: paths.runtimeRoot,
        dataDir: paths.dataDir,
        horosaPort: paths.horosaPort,
        horosaHost: paths.horosaHost,
        horosaPath: paths.horosaPath,
        selfcheckTimeoutMs: opts.selfcheckTimeoutMs,
        keepServe: opts.keepServe,
        env: process.env,
        log,
      })
      report.checks = selfcheck.checks
      report.serve = selfcheck.serve
      const failed = selfcheck.checks.filter((check) => check.ok !== true)
      if (failed.length > 0) {
        report.ok = false
        report.exitCode = EXIT.selfcheck
        report.error = `自检未通过：${failed.map((check) => check.id).join(', ')}`
      } else {
        report.ok = true
        report.exitCode = EXIT.ok
      }
    }
  } catch (error) {
    const setupErr = setupError(error)
    if (Array.isArray(setupErr.checks)) report.checks = setupErr.checks
    if (setupErr.serve !== undefined) report.serve = setupErr.serve
    report.ok = false
    report.exitCode = setupErr.code
    report.error = setupErr.message
    if (setupErr.hint !== undefined) report.hint = setupErr.hint
    if (setupErr.evidence !== undefined) report.evidence = clipEvidence(setupErr.evidence)
  }

  // 失败时把「错误 + 处置」也写到 **stderr**：`--json` 下报告在 stdout，但操作者看的是终端；
  // 只有报告里能读到处置建议的话，出问题时会先看到一坨 JSON 而不知所措。
  if (report.error !== undefined) {
    process.stderr.write(`setup: ${report.error}\n`)
    if (report.hint !== undefined) process.stderr.write(`${report.hint}\n`)
  }

  // 报告**无论成败都写** —— 唯一的例外是「真实 home 被拒」这条：那时 reportFile 正指向用户的真实
  // `~/.dsh`，而契约 §6 的第一句「缺省绝不写真实 ~/.dsh」**没有例外条款**：拒绝路径恰恰是最需要零副作用
  // 的那条（用户可能只是打错了一个参数）。显式给了 `--install` 就不一样了，那是他要求的。
  if (realHome.ok) {
    try {
      writeReport(paths.reportFile, report)
      report.notes.push(`报告：${paths.reportFile}`)
    } catch (error) {
      log(`[setup] 警告：报告写不进去（${paths.reportFile}）：${error?.message ?? error}`)
    }
  } else {
    report.notes.push(`真实 DSH home 被拒：报告未落盘（只在 stdout/stderr），${paths.reportFile} 一个字节都没动`)
    log(`[setup] 真实 DSH home 被拒：不写任何文件（含报告）`)
  }

  if (opts.json) process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
  else process.stdout.write(`${formatReport(report)}\n`)
  return report.exitCode
}

/* ─────────────────────────── 步骤 ─────────────────────────── */

/** 取件两个工件（都过同一道 SHA256 门）；报告里记 action/path/url。 */
async function acquireAll({ report, artifacts, opts, paths, mirror }) {
  const wheel = await acquireArtifact({
    artifact: artifacts.wheel,
    local: opts.wheel,
    cacheDir: paths.cacheDir,
    // 镜像对 wheel 同样生效（Lead 裁决）：上游自己就是同一份 HOROSA_RUNTIME_MIRROR 改写
    // 清单 / 归档 / wheel URL 三处；而且 dry-run 已经打了 wheel 的镜像候选，行为必须与计划一致。
    mirrorPrefixes: mirror.prefixes,
    retries: opts.retries,
    recheck: opts.recheck,
    skipDownload: opts.skipDownload,
    log,
  })
  report.pin.wheel.path = wheel.path
  report.pin.wheel.action = wheel.action
  report.pin.wheel.bytes = wheel.bytes
  report.pin.wheel.url = wheel.url
  report.pin.wheel.resumedBytes = wheel.resumedBytes

  const runtime = await acquireArtifact({
    artifact: artifacts.runtime,
    local: opts.runtime,
    cacheDir: paths.cacheDir,
    mirrorPrefixes: mirror.prefixes,
    retries: opts.retries,
    recheck: opts.recheck,
    skipDownload: opts.skipDownload,
    log,
  })
  report.pin.runtime.path = runtime.path
  report.pin.runtime.action = runtime.action
  report.pin.runtime.bytes = runtime.bytes
  report.pin.runtime.url = runtime.url
  report.pin.runtime.candidates = runtime.candidates
  report.pin.runtime.resumedBytes = runtime.resumedBytes

  report.notes.push(`wheel ${wheel.action}：${wheel.path}（${humanBytes(wheel.bytes)}）`)
  report.notes.push(`runtime ${runtime.action}：${runtime.path}（${humanBytes(runtime.bytes)}）`)
  if (runtime.url !== null && runtime.url !== artifacts.runtime.url) {
    report.notes.push(`runtime 实际下载 URL（镜像）：${runtime.url}`)
  }
}

/** `--verify-only`：只看缓存现状，**不发请求、不算哈希**（那属于取件步骤，被显式跳过了）。 */
function fillPinFromCache({ report, artifacts, cacheDir }) {
  const human = {
    hit: '缓存命中（size 与 sidecar 都与 pin 一致）',
    'no-sidecar': '文件在缓存里但没有 sidecar（--verify-only 不做校验，故不写 sidecar）',
    'sidecar-mismatch': '缓存里的 sidecar 与 pin 不符（真要取件时会被删掉重取）',
    'size-mismatch': '缓存里的大小与 pin 不符（真要取件时会被删掉重取）',
    missing: '不在缓存里',
  }
  for (const [kind, artifact] of [['wheel', artifacts.wheel], ['runtime', artifacts.runtime]]) {
    const state = cacheState({ cacheDir, artifact })
    if (state.state === 'hit') {
      report.pin[kind].path = state.file
      report.pin[kind].action = 'cache-hit'
      report.pin[kind].bytes = state.size
      report.notes.push(`${kind}：${human[state.state]} → ${state.file}`)
    } else {
      report.notes.push(`${kind}：${human[state.state] ?? state.state} → ${state.file}`
        + '（--verify-only 不取件，pin.path/action 留空）')
    }
  }
}

/**
 * 环境门：uvx 在不在（契约 §8 的 exit 3）。
 *
 * `XUANSHU_SKIP_PREFLIGHT=1` 直接跳过（测试注入口）。判定口径：**spawn 失败才算缺失**
 * （ENOENT/EACCES…）；能起来但 `--version` 非 0 只记一条警告 —— 那种情况下真正的失败
 * 会由 install/doctor 带着完整输出响亮地报出来，比在这里猜「uv 装坏了」准得多。
 */
async function preflightUvx() {
  if (process.env.XUANSHU_SKIP_PREFLIGHT === '1') {
    log('[setup] XUANSHU_SKIP_PREFLIGHT=1：跳过 uvx 环境门（仅测试用）')
    return
  }
  const bin = uvxBin(process.env)
  const run = await runCommand(bin, ['--version'], { env: process.env, timeoutMs: PREFLIGHT_TIMEOUT_MS, log, label: 'uvx' })
  if (run.error !== null) {
    throw new SetupError(`uvx 不可用（${bin}）：${run.error}`, {
      code: EXIT.environment,
      evidence: { bin, error: run.error },
      hint: [
        '# 装 uv（自带 uvx）: PowerShell: irm https://astral.sh/uv/install.ps1 | iex',
        '#                  macOS/Linux: curl -LsSf https://astral.sh/uv/install.sh | sh',
        '# 或者显式指一支已装的: $env:XUANSHU_UVX_BIN="<path-to-uvx>"',
      ].join('\n'),
    })
  }
  const version = (run.stdout || run.stderr).trim().split(/\r?\n/)[0] ?? ''
  if (run.status !== 0) {
    log(`[setup] 警告：${bin} --version 退出码 ${run.status}（${version}）—— 继续，真正的失败会在 doctor/install 步骤带着输出报出来`)
  } else {
    log(`[setup] uvx：${bin}  ${version}`)
  }
}

/** 子进程环境：两个 HOROSA_* 根 + （显式给了 --mirror 时）把镜像也交给上游（同一份语义）。 */
function buildChildEnv({ mirror, prefixes, paths }) {
  const env = {
    ...process.env,
    HOROSA_RUNTIME_ROOT: paths.runtimeRoot,
    HOROSA_SKILL_DATA_DIR: paths.dataDir,
  }
  if (mirror.source === '--mirror') {
    // 「同一份值可以直接交给 horosa 自己的 installer」（上游 mirrors.py 的 comma-separated 语义）。
    if (prefixes.length > 0) env.HOROSA_RUNTIME_MIRROR = prefixes.join(',')
    else delete env.HOROSA_RUNTIME_MIRROR
  }
  return env
}

/* ─────────────────────────── dry-run ─────────────────────────── */

/** 只打印计划：不写报告、不建目录、不发请求（两道纯门 + 缓存现状都是只读的）。 */
function dryRun({ opts, paths, pin, artifacts, mirror, gates, report }) {
  const plan = []
  const push = (step, action, detail) => plan.push({ step, action, detail })

  push('gate:dsh-home', gates.realHome.ok ? 'pass' : 'blocked', gates.realHome.detail)
  push('gate:runtime-root-ascii', gates.ascii.ok ? 'pass' : 'blocked', gates.ascii.detail)

  const skipAcquire = opts.verifyOnly === true
  for (const [kind, artifact, local] of [['wheel', artifacts.wheel, opts.wheel], ['runtime', artifacts.runtime, opts.runtime]]) {
    if (skipAcquire) {
      push(`acquire:${kind}`, 'skipped', '--verify-only：不做取件')
      continue
    }
    if (local !== undefined && String(local).trim() !== '' && !isUrl(local)) {
      push(`acquire:${kind}`, 'offline', `用离线件 ${resolve(String(local))}（仍过 SHA256 门，零网络）`)
      continue
    }
    const state = cacheState({ cacheDir: paths.cacheDir, artifact })
    if (state.state === 'hit' && !opts.recheck) {
      push(`acquire:${kind}`, 'cache-hit', `${state.file}（size=${state.size}，sidecar 与 pin 一致）`)
      continue
    }
    if (state.state === 'no-sidecar' || state.state === 'sidecar-mismatch') {
      push(`acquire:${kind}`, opts.recheck ? 'recheck' : 'verify-once',
        `${state.file} 大小与 pin 一致但 sidecar 不可用（${state.state}）：先算一次 SHA256 复核`
        + '（通过即命中并补写 sidecar；不通过才删掉重取，不会无谓地重下大件）')
      continue
    }
    const url = isUrl(local) ? String(local).trim() : artifact.url
    const candidates = mirrorCandidates(url, mirror.prefixes)
    if (opts.skipDownload) {
      push(`acquire:${kind}`, 'blocked', `--skip-download 且缓存不可用（${state.state}）：${cacheFilePath(paths.cacheDir, artifact)}`)
      continue
    }
    push(`acquire:${kind}`, 'download', `缓存现状 ${state.state}；候选：${candidates.join('  |  ')}  →  ${cacheFilePath(paths.cacheDir, artifact)}`
      + `（最多 ${opts.retries} 次/候选，断点续传，落盘后算 SHA256）`)
  }

  if (opts.verifyOnly) {
    push('install:runtime', 'skipped', '--verify-only：不装 runtime')
    push('profile', 'skipped', '--verify-only：不装配 profile')
  } else {
    push('install:runtime', opts.force ? 'install-force' : 'install-or-skip', `uvx --from <wheel> horosa-skill install --archive <本地归档>${opts.force ? ' --force' : ''}`
      + `（先 doctor：已装同版本且未给 --force 则跳过） → HOROSA_RUNTIME_ROOT=${paths.runtimeRoot}`)
    push('profile', opts.profileMode, `node scripts/install-profile.mjs --home "${paths.home}" --profile "${paths.profile}"${opts.profileMode === 'copy' ? ' --copy' : ''}`)
  }

  if (opts.noSelfcheck) push('selfcheck', 'skipped', '--no-selfcheck')
  else {
    push('selfcheck', 'run', `C1 verify-assembly ｜ C2 8765(${paths.horosaPort}) 四态守卫`
      + '（occupied-foreign → exit 3；horosa-ready → 复用；其余 → 自起并只停自己起的）'
      + ` ｜ C3 八字工具（预算 ${opts.selfcheckTimeoutMs}ms${opts.keepServe ? '，--keep-serve' : ''}）`)
  }
  push('report', 'write', paths.reportFile)

  const blocked = plan.some((item) => item.action === 'blocked')
  const exitCode = blocked ? EXIT.environment : EXIT.ok
  report.ok = !blocked
  report.exitCode = exitCode
  report.dryRun = true
  report.plan = plan
  report.notes.push('--dry-run：零副作用（不写报告、不建目录、不发请求；uvx 环境门也没跑）')

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
  } else {
    const lines = [`玄枢 setup（dry-run，零副作用）  pin v${pin.version}  profile=${paths.profile}（${opts.profileMode}）`, '']
    lines.push(`  DSH home     ${paths.home}   ← ${paths.homeSource}`)
    lines.push(`  runtime 根   ${paths.runtimeRoot}   ← ${paths.runtimeRootSource}`)
    lines.push(`  缓存         ${paths.cacheDir}   ← ${paths.cacheSource}`)
    lines.push(`  数据目录     ${paths.dataDir}`)
    lines.push(`  horosa 端口  ${paths.horosaPort}（${paths.horosaPortSource}）  host ${paths.horosaHost}（${paths.horosaHostSource}）`)
    lines.push(`  镜像         ${mirror.prefixes.length > 0 ? `${mirror.prefixes.join(', ')}（${mirror.source}）` : `无（${mirror.source}）`}`)
    lines.push('')
    for (const item of plan) lines.push(`  [${item.step}] ${item.action}  ${item.detail}`)
    lines.push('')
    for (const note of report.notes) lines.push(`note: ${note}`)
    lines.push('')
    lines.push(blocked ? `计划里有被挡住的门 → 退出码 ${exitCode}（${exitLabel(exitCode)}）` : '计划未发现阻塞（真跑请去掉 --dry-run）')
    process.stdout.write(`${lines.join('\n')}\n`)
  }
  return exitCode
}

/* ─────────────────────────── 杂项 ─────────────────────────── */

function resolvePinPath(env) {
  const override = env?.[PIN_ENV]
  if (typeof override === 'string' && override.trim() !== '') return resolve(override.trim())
  return DEFAULT_PIN_PATH
}

/** 任何异常都折成 SetupError：未预期的异常按「用法/未知错误」= exit 1（契约 §8）。 */
function setupError(error) {
  if (error instanceof SetupError) return error
  if (error instanceof Error) {
    return new SetupError(`未预期的错误：${error.message}`, {
      code: EXIT.usage,
      evidence: { name: error.name, stack: String(error.stack ?? '').split('\n').slice(0, 4).join('\n') },
    })
  }
  return new SetupError(`未预期的错误：${String(error)}`, { code: EXIT.usage })
}

function usageFailure(error) {
  const setupErr = setupError(error)
  process.stderr.write(`setup: ${setupErr.message}\n`)
  if (setupErr.hint !== undefined) process.stderr.write(`${setupErr.hint}\n`)
  return setupErr.code
}

function failureReport(error, { opts, paths, pin }) {
  const setupErr = setupError(error)
  process.stderr.write(`setup: ${setupErr.message}\n`)
  if (setupErr.hint !== undefined) process.stderr.write(`${setupErr.hint}\n`)
  if (opts?.json === true) {
    const report = newReport({ pin: pin ?? undefined, paths: paths ?? undefined })
    report.ok = false
    report.exitCode = setupErr.code
    report.error = setupErr.message
    if (setupErr.hint !== undefined) report.hint = setupErr.hint
    process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
  }
  return setupErr.code
}

/** 只有作为 CLI 直接跑时才执行；被测试 import 时只导出零件。 */
const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (error) => {
      process.stderr.write(`setup: 未捕获的异常：${error?.stack ?? error}\n`)
      process.exitCode = EXIT.usage
    },
  )
}

export { main, REPO_ROOT }
