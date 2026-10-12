/**
 * scripts/setup/selfcheck.mjs — 三条自检的编排（票 05 契约 §5）。
 *
 * 三条**全部真实**，任一条失败 → exit 5（环境门类例外，见下）：
 *   C1 assembly   spawn `node scripts/verify-assembly.mjs --json --dsh-home <home> --profile <name>`，
 *                 要求 exit 0 且 stdout JSON 的 `ok === true`（真机实测 36.8 秒 / 五条 seam 全绿）；
 *                 原始输出落 `<dsh-home>/xuanshu/logs/verify-assembly.json`，报告里给路径（A11）。
 *   C2 horosa8765 先走票 04 的四态守卫，再按结论分流（判据**只有一条**：`c2Ready` = MCP `initialize`
 *                 成功且带回 `mcp-session-id` + `tools/list` 非空，见下面的 `c2Ready`）：
 *                 · `occupied-foreign` → **exit 3**（环境门，不是自检失败）；
 *                 · 现成实例 MCP 就绪 → **复用**（绝不 stop 别人的 server）；
 *                 · `free` → 起 serve（日志 `<dataDir>/serve.log`）再等到 MCP 就绪；
 *                 · `probe-failed`（无法判定）或「`horosa-ready` 但握手不完整」→ **用加长预算复探一次**
 *                   （`min(selfcheckTimeout/2, 15s)`，下限 5s；慢应答的 horosa 正是这一格的常见成因），
 *                   仍不成再补一次无副作用的 MCP 握手，两者都不成 → C2 false（exit 5）。
 *                   **绝不 spawn**：端口上已经有 listener，再起必撞；detail 必须写明「无法判定 ≠ 被占」。
 *   C3 bazi       交给 `scripts/horosa/probe.mjs::checkBaziTool`（tools/list 含 `horosa_cn_bazi_birth`
 *                 + tools/call 的信封 ok 且四柱可读）。
 *
 * 两条纪律：
 *   - **只停自己起的 serve**：`pid` 为空一律 no-op（上游明令 :9999/:8899 是用户桌面版的端口，
 *     而 8765 上跑着的可能是 Lead/开发者手工起的实例）；
 *   - C2/C3 的模块来自队友 B（`scripts/horosa/**`）。它没落地时这两条**如实判失败**，
 *     并说清是「依赖没落地」而不是「horosa 坏了」。
 *
 * 仅使用 Node 内置模块。ESM。
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

import { EXIT, SetupError } from './exit.mjs'
import { runCommand, tailLines } from './proc.mjs'
import { clipEvidence, writeLogFile } from './report.mjs'

/** 测试注入口（契约 §10）：把 C1 的断言台换成替身，制造确定性的通过/失败两态。 */
export const VERIFY_ASSEMBLY_BIN_ENV = 'XUANSHU_VERIFY_ASSEMBLY_BIN'

/** C1 的超时：真机实测 36.8 秒；给 10 分钟是给「第一次装配 + 冷启动 CLI」留余量。 */
export const C1_TIMEOUT_MS = 600_000

/** 单次 MCP 探测的超时（initialize + tools/list 的预算）。 */
export const PROBE_TIMEOUT_MS = 20_000

/** 健康探针的超时：四态守卫自己是有界时间的（默认 1.5s），但冷启动的 horosa 会答得慢。 */
export const HEALTH_TIMEOUT_MS = 10_000

/** A1 加长复探的预算上下限：`min(selfcheckTimeout/2, 15s)`，下限 5s。 */
export const MIN_REPROBE_MS = 5_000
export const MAX_REPROBE_MS = 15_000

/** 起 serve 后等就绪的轮询间隔。 */
const READY_POLL_INTERVAL_MS = 3_000

/**
 * C2 的**唯一判据**（契约 §5）：MCP `initialize` 成功（200 且带响应头 `mcp-session-id`）+ `tools/list` 非空。
 *
 * 两个来源都算「同一条判据」：
 *   - `checkHorosaHealth().mcpReady`（B 的探针内部就是这条：`list.ok && sessionId && tools.length > 0`）；
 *   - 一次直接的 `mcpToolsList()` —— A2 之后它的 `ok` **同样**含「拿到了 mcp-session-id」，
 *     所以这条路也不存在「tools 列表非空就算过」的松口。
 * 「无 sessionId 的假 server」在两处都会判 false（tests/setup 有这条回归用例）。
 */
function c2Ready({ health: probeResult, list } = {}) {
  if (probeResult?.mcpReady === true) return true
  return list?.ok === true
    && Array.isArray(list.tools)
    && list.tools.length > 0
    && Boolean(list.evidence?.sessionId)
}

/**
 * A1 的加长复探预算：`min(selfcheckTimeout/2, 15s)`，下限 5s。
 * 为什么是「一半预算」：复探之后还要留预算给 C3（八字出盘），把预算一次吃光会把 C2 的问题
 * 变成 C3 的超时（那是另一种假红）。
 */
function reprobeBudget(remainingMs) {
  return Math.max(MIN_REPROBE_MS, Math.min(Math.floor(Math.max(0, remainingMs) / 2), MAX_REPROBE_MS))
}

/**
 * 跑三条自检。
 *
 * @returns {Promise<{ checks: object[], serve: { started: boolean, pid: number|null, stopped: boolean, detail: string } }>}
 * @throws {SetupError} code = EXIT.environment（8765 被非 horosa 占用）
 */
export async function runSelfcheck({
  repoRoot, dshHome, profile, wheelPath, runtimeRoot, dataDir,
  horosaPort, horosaHost, horosaPath, selfcheckTimeoutMs, keepServe = false,
  env = process.env, log = () => {}, logsDir,
}) {
  const checks = []
  const deadline = Date.now() + Math.max(1000, Number(selfcheckTimeoutMs) || 0)
  const remaining = () => Math.max(1000, deadline - Date.now())
  const serve = { started: false, pid: null, stopped: false, detail: '未起 serve（复用已有实例或未走到启动）' }

  // ── C1：装配可启动 ────────────────────────────────────────────────
  checks.push(await checkAssembly({ repoRoot, dshHome, profile, env, log, logsDir }))

  // ── C2 / C3：horosa ──────────────────────────────────────────────
  const modules = await loadHorosaModules(repoRoot, log)
  // 自己起 serve 时给子进程的环境：三个 HOROSA_* 必须**由这次运行算出**（不能用调用方那份裸 process.env，
  // 否则 uvx 起的 runtime 会落到别的根/别的数据目录），其余变量（如 XUANSHU_UVX_BIN）照旧透传。
  const serveEnv = horosaChildEnv({ env, runtimeRoot, dataDir, port: horosaPort })
  if (modules.missing.length > 0) {
    const detail = `依赖尚未落地：${modules.missing.join('、')}（队友 B 的 scripts/horosa/**）—— 这两条自检无法运行`
    log(`[setup] selfcheck：${detail}`)
    checks.push(fail('horosa8765', detail, { missing: modules.missing }))
    checks.push(fail('bazi', detail, { missing: modules.missing }))
    return { checks, serve }
  }

  try {
    const c2 = await checkHorosa({
      modules, wheelPath, runtimeRoot, dataDir, horosaPort, horosaHost, horosaPath, remaining, log, serve, serveEnv,
    })
    checks.push(c2)
    if (c2.ok) {
      checks.push(await checkBazi({ modules, repoRoot, horosaPort, horosaHost, horosaPath, remaining, log }))
    } else {
      checks.push(fail('bazi', '跳过：horosa8765 未通过（先修 C2，八字工具必然也不可用）'))
    }
  } finally {
    // 只停自己起的：pid 为空就是 no-op（复用别人实例时必须走这条）。
    if (serve.started && serve.pid !== null && !keepServe) {
      const stopped = await safeCall(() => modules.serve.stopServe({
        pid: serve.pid, runtimeRoot, dataDir, timeoutMs: 60_000,
      }))
      serve.stopped = stopped?.ok === true
      serve.detail = stopped?.detail ?? serve.detail
      log(`[setup] serve：stop pid=${serve.pid} → ${serve.stopped ? '已停' : `未确认（${serve.detail}）`}`)
    } else if (serve.started && keepServe) {
      serve.detail = `--keep-serve：保留 pid=${serve.pid}`
      log(`[setup] serve：--keep-serve，保留 pid=${serve.pid}`)
    }
  }

  return { checks, serve }
}

/* ─────────────────────────────── C1 ─────────────────────────────── */

async function checkAssembly({ repoRoot, dshHome, profile, env, log, logsDir }) {
  const started = Date.now()
  const bin = resolveVerifyAssemblyBin({ repoRoot, env })
  const args = ['--json', '--dsh-home', dshHome, '--profile', profile]
  log(`[setup] selfcheck C1：${bin} ${args.join(' ')}`)

  const run = await runCommand(bin, args, { env, log, timeoutMs: C1_TIMEOUT_MS, label: 'verify-assembly' })
  const parsed = tryParseJson(run.stdout)
  // A11：原始大输出落 `<dsh-home>/xuanshu/logs/`，报告里只给路径（契约 §7 的「大输出落 logs/」）。
  const logFile = writeLogFile(logsDir, 'verify-assembly.json', run.stdout)
  const stderrLogFile = run.stderr.trim() === '' ? null : writeLogFile(logsDir, 'verify-assembly.stderr.txt', run.stderr)
  const evidence = clipEvidence({
    bin,
    exitCode: run.status,
    schema: parsed?.schema,
    ok: parsed?.ok,
    error: parsed?.error,
    stderrTail: tailLines(run.stderr, 4),
    logFile,
    ...(stderrLogFile === null ? {} : { stderrLogFile }),
  })

  if (run.error !== null || run.timedOut) {
    return makeCheck('assembly', false, `断言台没能跑完（${run.error ?? '超时'}）`, evidence, started)
  }
  if (parsed === undefined) {
    return makeCheck('assembly', false, `断言台 stdout 不是 JSON（exit=${run.status}）：${run.stdout.slice(0, 200) || '（空）'}`, evidence, started)
  }
  const ok = run.status === 0 && parsed.ok === true
  const detail = ok
    ? `verify-assembly exit 0 且报告 ok=true（${Object.keys(parsed.checks ?? {}).join('+') || '无 checks'}）`
    : `verify-assembly exit=${run.status} 报告 ok=${JSON.stringify(parsed.ok)}；${parsed.error ?? tailLines(run.stderr, 3) ?? ''}`
  return makeCheck('assembly', ok, detail, clipEvidence({ ...evidence, checks: summarizeChecks(parsed.checks) }), started)
}

function resolveVerifyAssemblyBin({ repoRoot, env }) {
  const override = env?.[VERIFY_ASSEMBLY_BIN_ENV]
  if (typeof override === 'string' && override.trim() !== '') return override.trim()
  return join(repoRoot, 'scripts', 'verify-assembly.mjs')
}

/* ─────────────────────────────── C2 / C3 ─────────────────────────────── */

async function checkHorosa({ modules, wheelPath, runtimeRoot, dataDir, horosaPort, horosaHost, horosaPath, remaining, log, serve, serveEnv }) {
  const started = Date.now()
  const port = horosaPort
  const path = horosaPath

  const health = await safeCall(() => modules.probe.checkHorosaHealth({ port, path, timeoutMs: Math.min(HEALTH_TIMEOUT_MS, remaining()) }))
  const verdict = health?.verdict
  log(`[setup] selfcheck C2：8765 守卫 verdict=${verdict ?? '(无 verdict)'} ${health?.detail ?? ''}`)

  // 环境门：**真的**拿到了不像 MCP 的 HTTP 响应 → exit 3（不是自检失败，处置完全不同）。
  if (verdict === 'occupied-foreign') {
    throw new SetupError(
      `8765 被非 horosa 的进程占用：${health?.detail ?? ''}`,
      {
        code: EXIT.environment,
        evidence: clipEvidence({ verdict, evidence: health?.evidence }),
        hint: health?.hint ?? `# 腾端口或换端口：node scripts/setup.mjs --horosa-port ${Number(port) + 101}`,
      },
    )
  }

  /** 最近一次 `tools/list` 的结果（证据里的 toolsCount / serverInfo 优先来自它）。 */
  let tools = null
  let reused = false
  /** 用于判据的那次「复探/收尾探」：probe-failed 的加长复探，或自起成功后的收尾探。 */
  let healthAfter = null

  if (c2Ready({ health })) {
    // 现成实例，MCP 也真的就绪 → **复用**（自己没起，所以绝不会去 stop 它）。
    reused = true
    log(`[setup] selfcheck C2：复用已在跑的 horosa（guard=${verdict}、mcpReady=true、tools=${health?.mcp?.toolCount ?? 0}）`)
  } else if (verdict === 'free') {
    // 只有「端口空着」这一态才自己起一份（`startServe` 自己的守卫也会再探一次，已在跑则回 started:false）。
    if (modules.serve === undefined) {
      const check = makeCheck('horosa8765', false, 'scripts/horosa/serve-lifecycle.mjs 未落地，无法起 serve', clipEvidence({ verdict }), started)
      check.verdict = verdict ?? 'free'
      return check
    }
    const logFile = join(dataDir, 'serve.log')
    mkdirSync(dirname(logFile), { recursive: true })
    log(`[setup] selfcheck C2：起 serve（port=${port}，日志 ${logFile}）`)
    const started_ = await safeCall(() => modules.serve.startServe({
      wheel: wheelPath,
      runtimeRoot,
      dataDir,
      host: horosaHost,
      port,
      timeoutMs: remaining(),
      logFile,
      env: serveEnv,
    }))
    if (started_?.ok !== true) {
      const check = makeCheck('horosa8765', false, `起 serve 失败：${started_?.detail ?? '（无 detail）'}`, clipEvidence({
        verdict,
        start: started_,
        serveLog: logFile,
      }), started)
      check.verdict = verdict ?? 'free'
      return check
    }
    serve.started = started_.started === true
    serve.pid = typeof started_.pid === 'number' ? started_.pid : null
    serve.detail = started_.detail ?? `started=${serve.started} pid=${serve.pid}`
    log(`[setup] serve：${serve.detail}`)

    // 冷启动（Java + chart + Node）可能几分钟：预算里先切 60% 给「等就绪」，剩下的留给 C3。
    const readyDeadline = Date.now() + Math.max(1000, remaining() * 0.6)
    while (Date.now() < readyDeadline) {
      tools = await safeCall(() => modules.client.mcpToolsList({ host: horosaHost, port, path, timeoutMs: Math.min(PROBE_TIMEOUT_MS, remaining()) }))
      if (c2Ready({ list: tools })) break
      if (Date.now() + READY_POLL_INTERVAL_MS >= readyDeadline) break
      await sleep(READY_POLL_INTERVAL_MS)
    }
    // 收尾复探（B 的 `checkHorosaHealth`）：既服务判据（mcpReady），也把 `mcpReady` 一起记进证据
    // （排障时最有信息量的一格是「它当时到底算不算就绪」）。
    healthAfter = await safeCall(() => modules.probe.checkHorosaHealth({ port, path, timeoutMs: Math.min(HEALTH_TIMEOUT_MS, remaining()) }))
  } else {
    // 剩下两态都走这里（**绝不 spawn**：端口上已经有 listener，再起必撞）：
    //   - `probe-failed`（守卫说**无法判定**：慢应答的 horosa 是这一格的常见成因）；
    //   - `horosa-ready` 但 MCP 握手不完整（例如 initialize 没带 `mcp-session-id`）。
    // 处置（A1）：用加长预算复探一次 `checkHorosaHealth`；拿到 mcpReady 就按「复用」通过；仍不成再补一次
    // **无副作用**的 MCP 握手（有个别实现只答 POST、不答 GET，守卫因此判不出）；两者都不成才 fail-closed。
    const budget = reprobeBudget(remaining())
    log(`[setup] selfcheck C2：守卫判「${verdict ?? '无法判定'}」（不是「被占」）→ 用加长预算复探一次（${budget}ms），不起任何进程`)
    healthAfter = await safeCall(() => modules.probe.checkHorosaHealth({ port, path, timeoutMs: budget }))
    log(`[setup] selfcheck C2：复探 verdict=${healthAfter?.verdict ?? '(无 verdict)'} mcpReady=${healthAfter?.mcpReady === true}`)
    if (c2Ready({ health: healthAfter })) {
      reused = true
    } else {
      tools = await safeCall(() => modules.client.mcpToolsList({ host: horosaHost, port, path, timeoutMs: Math.min(PROBE_TIMEOUT_MS, remaining()) }))
      if (c2Ready({ list: tools })) {
        reused = true
        log(`[setup] selfcheck C2：守卫判不出但 MCP 握手成功（tools=${tools.tools.length}，mcp-session-id 已带回）→ 复用`)
      } else {
        const stateNote = verdict === 'horosa-ready'
          ? '守卫判「horosa-ready」，但 MCP 握手不完整（`initialize` 没带 `mcp-session-id`，或 `tools/list` 为空）'
          : `四态守卫判「${verdict ?? '无法判定'}」：8765 的状态**无法判定 ≠ 被占**`
        const check = makeCheck('horosa8765', false,
          `${stateNote}（加长预算复探一次仍不成：verdict=${healthAfter?.verdict ?? '-'}、`
          + `mcpReady=${healthAfter?.mcpReady === true}、MCP 握手 ${tools?.detail ?? tools?.error ?? '未成'}）。`
          + '按 fail-closed 处理，**未起任何进程**（端口上有 listener，再起必撞）。'
          + `处置：${health?.hint ?? `先人工复探一次（node scripts/isolation/horosa-guard.mjs --port ${port}），确认后再重跑`}`,
          clipEvidence({
            verdict,
            reprobe: { verdict: healthAfter?.verdict, mcpReady: healthAfter?.mcpReady === true, evidence: healthAfter?.evidence },
            mcpReady: health?.mcpReady,
            evidence: health?.evidence,
            probe: tools?.detail,
          }), started)
        check.verdict = verdict ?? 'probe-failed'
        return check
      }
    }
  }

  const toolsCount = Array.isArray(tools?.tools) && tools.tools.length > 0
    ? tools.tools.length
    : (healthAfter?.mcp?.toolCount ?? health?.mcp?.toolCount ?? 0)
  const serverInfo = tools?.serverInfo ?? healthAfter?.mcp?.serverInfo ?? health?.mcp?.serverInfo ?? null
  const ok = c2Ready({ health: healthAfter ?? health, list: tools })
  const detail = ok
    ? `${reused ? '复用' : '自起'}的 horosa 应答正常：MCP initialize 带 mcp-session-id、tools/list ${toolsCount} 条，serverInfo=${JSON.stringify(serverInfo ?? {})}`
    : `MCP 未就绪：${tools?.detail ?? tools?.error ?? healthAfter?.detail ?? '未知'}（verdict=${verdict ?? '-'}）`
  const check = makeCheck('horosa8765', ok, detail, clipEvidence({
    verdict,
    verdictAfter: healthAfter?.verdict,
    mcpReady: healthAfter?.mcpReady ?? health?.mcpReady,
    reused,
    toolsCount,
    serverInfo,
    port,
    path,
    evidence: tools?.evidence ?? healthAfter?.evidence ?? health?.evidence,
  }), started)
  // 契约 §7 的样例把 `verdict` 放在 check **顶层**：它回答的是「C2 最后是什么归宿」。
  // 通过时一律 `horosa-ready`（复用的现成实例与自起成功是同一个归宿，`evidence.reused` 能区分）；
  // 不通过时给**开工前那一探**的四态 —— 那时它才是有信息量的（「端口当时是空的」/「无法判定」）。
  check.verdict = ok ? 'horosa-ready' : (verdict ?? 'probe-failed')
  return check
}

async function checkBazi({ modules, repoRoot, horosaPort, horosaHost, horosaPath, remaining, log }) {
  const started = Date.now()
  if (typeof modules.probe?.checkBaziTool !== 'function') {
    return makeCheck('bazi', false, 'scripts/horosa/probe.mjs 没有导出 checkBaziTool', undefined, started)
  }
  const fixture = join(repoRoot, 'scripts', 'horosa', 'bazi-fixture.json')
  const result = await safeCall(() => modules.probe.checkBaziTool({
    port: horosaPort,
    path: horosaPath,
    timeoutMs: remaining(),
    ...(existsSync(fixture) ? { fixturePath: fixture } : {}),
  }))
  const ok = result?.ok === true
  const evidence = clipEvidence({
    tool: result?.evidence?.tool ?? 'horosa_cn_bazi_birth',
    version: result?.evidence?.version,
    pillars: result?.evidence?.pillars,
    ...(result?.evidence ?? {}),
  })
  log(`[setup] selfcheck C3：${ok ? 'PASS' : 'FAIL'} ${result?.detail ?? ''}`)
  return makeCheck('bazi', ok, result?.detail ?? (ok ? 'tools/call envelope ok' : '（无 detail）'), evidence, started)
}

/* ─────────────────────────────── 工具 ─────────────────────────────── */

/**
 * 起 serve 时子进程要用的环境。
 *
 * **不能**直接把调用方的 `process.env` 传下去：`HOROSA_RUNTIME_ROOT` / `HOROSA_SKILL_DATA_DIR` 必须等于
 * 这次运行真的装了 runtime 的那两个位置，`HOROSA_SKILL_PORT` 必须等于我们探的那个端口 —— 否则会出现
 * 「探 8765、serve 监听 18765」这种假红，或者「装的 C:\horosa、起的别处那份旧 runtime」。
 * 其余变量照旧透传（`XUANSHU_UVX_BIN` 等注入口才不会失效）。
 */
function horosaChildEnv({ env, runtimeRoot, dataDir, port }) {
  return {
    ...env,
    HOROSA_RUNTIME_ROOT: runtimeRoot,
    HOROSA_SKILL_DATA_DIR: dataDir,
    HOROSA_SKILL_PORT: String(port),
  }
}

/** 动态 import 队友 B 的三个模块；缺哪个就记哪个（不抛，让 C2/C3 如实报失败）。 */
async function loadHorosaModules(repoRoot, log) {
  const dir = join(repoRoot, 'scripts', 'horosa')
  const wanted = { client: 'mcp-client.mjs', serve: 'serve-lifecycle.mjs', probe: 'probe.mjs' }
  const out = { client: undefined, serve: undefined, probe: undefined, missing: [] }
  for (const [key, file] of Object.entries(wanted)) {
    const full = join(dir, file)
    if (!existsSync(full)) {
      out.missing.push(relative(repoRoot, full).split(/[\\/]/).join('/'))
      continue
    }
    try {
      out[key] = await import(pathToFileURL(full).href)
    } catch (error) {
      out.missing.push(`${relative(repoRoot, full).split(/[\\/]/).join('/')}（import 失败：${error?.message ?? error}）`)
    }
  }
  // 判据：**必须**有 mcp-client 与 probe 才能做 C2/C3；serve-lifecycle 缺失会让「自己起一份」这条腿失败，
  // 但「复用已在跑的实例」仍然可用，所以不把它算进 missing。
  const blocking = out.missing.filter((item) => !item.includes('serve-lifecycle'))
  if (out.missing.length > 0) log(`[setup] selfcheck：scripts/horosa 缺 ${out.missing.join('、')}`)
  out.missing = blocking
  return out
}

/** 包一层 try/catch：契约 §9 要求 B 的探针「返回不抛」，但失败也不能把 setup 崩掉。 */
async function safeCall(fn) {
  try {
    return await fn()
  } catch (error) {
    return { ok: false, detail: `探针抛错：${error?.message ?? String(error)}` }
  }
}

function makeCheck(id, ok, detail, evidence, startedAt) {
  const check = { id, ok, detail: String(detail ?? ''), durationMs: Date.now() - startedAt }
  if (evidence !== undefined) check.evidence = evidence
  return check
}

function fail(id, detail, evidence) {
  return makeCheck(id, false, detail, evidence === undefined ? undefined : clipEvidence(evidence), Date.now())
}

function tryParseJson(text) {
  const body = String(text ?? '').trim()
  if (body === '') return undefined
  try {
    const parsed = JSON.parse(body)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** 三条 seam 的小结（报告 evidence 只放体积可控的关键字段）。 */
function summarizeChecks(checks) {
  if (checks === null || typeof checks !== 'object') return undefined
  const summary = {}
  for (const [key, check] of Object.entries(checks)) {
    summary[key] = { ok: check?.ok === true, name: check?.name, detail: String(check?.detail ?? '').slice(0, 160) }
  }
  return summary
}

const sleep = (ms) => new Promise((done) => { setTimeout(done, ms) })
