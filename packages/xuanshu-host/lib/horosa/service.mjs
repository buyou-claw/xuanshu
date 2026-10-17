/**
 * packages/xuanshu-host/lib/horosa/service.mjs
 *
 * 宿主侧的 horosa **服务 + 装配入口**（票 06 契约 §3.1/§3.3 冻结签名，§3.2 R1–R10）：
 *   createHorosaRuntime({ ctx, config, log, paths, plan })
 *     -> { status, ensure, start, stop, waitReady, baziBirth, snapshot, ... }
 *   installHorosa(ctx, config)   // lib/index.js 只调它：装配 + 注册服务/命令，**永不抛**
 *
 * 状态机（§3.3）：
 *   status()              —— 不产生副作用，返回当前状态对象（与状态文件同形）
 *   ensure()              —— 解析 plan（→ wheel/版本/uvx/端口）→ ensureRuntime（同版本门）→ 落状态
 *   start()               —— ensure 通过 → checkHorosaEndpoint 四态裁决 → startHorosaServe →
 *                            等 `horosa-ready`（**判据 = MCP 握手**：200 + 响应头 mcp-session-id）→ 落状态
 *   waitReady(ms)         —— 不自动起 serve，等外部实例就绪（轮询四态）
 *   baziBirth(input)      —— buildBaziPayload → mcpCallTool(HOROSA_BAZI_TOOL) → classifyBaziEnvelope
 *                            → 落 status.bazi
 *
 * 硬约束（都能被外部观察到）：
 *   R1 **永不抛、永不拖垮装配**：任何异常只记日志 + 落状态文件；`installHorosa` 立即返回，
 *      起 serve 是后台任务（`setTimeout(..., startDelayMs).unref()`，dispose 时清掉定时器）。
 *   R7 状态文件 `<dataDir>/horosa-status.json`（schema `xuanshu/horosa-status@1`，**原子写**）：
 *      `{ schema, generatedAt, ok, phase, code, detail, hint, runtime, serve, endpoint, bazi? }`
 *      + additive `plan{version,wheel,wheelExists,uvxBin,host,port,source,runtimePayloadVersion}`
 *      （`plan.wheelExists:false` 时 `hint` 指向 `pnpm setup:xuanshu`），**每次状态变化都重写**。
 *      `ok` = 「这一步没有失败」（`stopped`/`idle` 都是 `true`，只有 `blocked`/`foreign`/带 `code` 才 `false`）；
 *      判「底座在不在跑」看 `phase === 'ready'` 与 `serve.started`，**不看** `ok`。
 *   R8 服务名 `xuanshuHorosa`（`ctx.provide` 不可得就跳过并记 note）；同一进程内多次装配**共用一份**。
 *   R9 命令 `/xuanshu-horosa`（子参数 `status`（默认）/ `start` / `stop` / `bazi`），
 *      `ctx.effect` 包裹注册，返回 `{kind:'success'|'error', text}`。
 *   R10 测试注入口（缺省一律 = 真实路径）：`XUANSHU_UVX_BIN` / `XUANSHU_HOROSA_WHEEL` /
 *      `XUANSHU_SETUP_REPORT` / `XUANSHU_HOROSA_DATA_DIR` / `XUANSHU_HOROSA_AUTOSTART`（`0` 不自动起）/
 *      `HOROSA_RUNTIME_ROOT`。
 *
 * DSH API 出处（本机实装 0.2.0-rc.2，只读核对；与 `lib/index.js` 同一套引用）：
 *   - `ctx.get(name, strict?)`：`@deepseek-ai/cordis/lib/types/reflect.d.ts:16`（非严格第二参数传 `false`）。
 *   - `ctx.provide(name, value?)`：`.../cordis/lib/types/reflect.d.ts:41-43`（返回 disposer，服务生命周期归本 fiber）。
 *   - `ctx.effect(cb, label?)`：`.../cordis/lib/types/fiber.d.ts:157`（`Context extends Pick<Fiber,'effect'>` 见同文件 :8）。
 *   - `ctx.commands.register(def) → disposer`：`@deepseek-ai/dsh-commands/lib/types/index.d.ts:94`；
 *     入参 `CommandInvocation.rawInput`（命令名之后的原文，含分隔空白）：同文件 `:24-25`；
 *     返回体 `CommandResult`（`kind: 'success'|'error'` + `text`）：`.../dsh-commands/lib/types/types.d.ts:33-41`。
 *   - `ctx.logger(name)`：`.../cordis/lib/types/context.d.ts:26-27`。
 *   - `ctx.get('profileContext')` → `ProfileContext{name,dir,home,installAnchor,cwd,…}`：
 *     `@deepseek-ai/dsh-app-boot/lib/types/profile-context.d.ts:10-25`（`home` 在 `:18`）。
 *
 * 只用 Node 内置模块，零第三方依赖。
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { HOROSA_BAZI_TOOL, HOROSA_DEFAULT_HOST, HOROSA_DEFAULT_PORT, HOROSA_MCP_PATH, HOROSA_SETUP_COMMAND, HOROSA_STATUS_SCHEMA } from './constants.mjs'
import { buildBaziPayload, classifyBaziEnvelope } from './bazi.mjs'
import { checkHorosaEndpoint, mcpCallTool, mcpToolsList } from './guard.mjs'
import { resolveHorosaPaths } from './paths.mjs'
import { ensureRuntime, resolveHorosaPlan } from './plan.mjs'
import { startHorosaServe, stopHorosaServe, ownsServe, ownedServePids } from './serve.mjs'

/** 服务名（R8）与命令名（R9）。 */
const SERVICE_NAME = 'xuanshuHorosa'
const COMMAND_NAME = 'xuanshu-horosa'
/** 装配时落状态文件的标签（R7：装配即可观察）。 */
const INSTALL_LABEL = 'xuanshu-host: horosa 生命周期'
/** 四态探针的短预算（轮询用）。 */
const POLL_PROBE_MS = 2000
/** 轮询间隔。 */
const POLL_INTERVAL_MS = 700
/** 出盘（首调会拉起 runtime，冷启动慢）的默认预算。 */
const DEFAULT_BAZI_TIMEOUT_MS = 120_000
/** dispose 时停自己起的那份 serve 的预算（不能拖住关机）。 */
const DISPOSE_STOP_TIMEOUT_MS = 8000

/**
 * 「失败态」phase 词表（`status.ok` 的判据之一）：只有这两态 + 带 `code` 的状态算失败。
 * `stopped`（正常收工）与 `idle`（已装配、等自启）**不算**失败 —— 见 `statusObject()` 的注释。
 */
const FAILURE_PHASES = new Set(['blocked', 'foreign'])

/**
 * `plan.wheelExists === false` 的排障提示（Lead 2026-10-13 补充）：
 * wheel 不在盘上**不是门**（测试注入点给的就是「还没落盘」的路径，硬门会把它一起否掉），
 * 但排障人必须能从**状态文件**一眼看到「缺件 → 跑 setup」，而不是等 spawn 失败去翻日志。
 * 它落进 `status.hint` 与 `status.plan.wheelExists`，并由 `start()` 的失败路径继续沿用（不覆盖更具体的 hint）。
 */
const WHEEL_MISSING_HINT =
  `wheel 不在盘上（status.plan.wheelExists=false）：先跑 \`${HOROSA_SETUP_COMMAND}\`（取件会重新落 wheel 并校验 SHA256），`
  + '或给 config.wheel / `$XUANSHU_HOROSA_WHEEL` 指向一份已校验的本地 wheel。'

/** 上面那条 hint 的**短版**（塞进 detail 用，避免 detail 里出现嵌套括号的同一句话）。 */
const WHEEL_MISSING_NOTE =
  `**wheel 不在盘上**（详见 hint：先跑 \`${HOROSA_SETUP_COMMAND}\` 重新取件，或给 config.wheel / \`$XUANSHU_HOROSA_WHEEL\` 指一份已校验的本地 wheel）`

/** 补丁行 config 的键（契约 §3.2 末表：全部可选、全部有缺省；**本次不改 `cordis.patch.yml`**）。
 *
 * ⚠️ `port` **刻意不进缺省**：它是 R10 注入点链（`config.port` > `$XUANSHU_HOROSA_PORT` > 常量）的入口，
 * 在这里塞一个数字缺省会**永远遮住 env 注入点**（断言台正是用 `XUANSHU_HOROSA_PORT` 顶端口起用例的，
 * 被遮住就会把 serve 起到真实默认端口上 —— 假 uvx 直接拒绑、真机上则是抢用户的端口）。
 * 所以它与 `dataDir`/`runtimeRoot`/`wheel`/`uvxBin` 同一处理：不给就留给下层（env → 缺省）；
 * 端口缺省的唯一来源是 `constants.mjs` 的 `HOROSA_DEFAULT_PORT`（由 `plan.mjs::pickPort` 兜）。
 */
const DEFAULT_CONFIG = {
  enabled: true,
  autoStart: true,
  startDelayMs: 2000,
  startupWaitMs: 60_000,
  keepServeOnDispose: false,
  host: HOROSA_DEFAULT_HOST,
  runtimeRoot: undefined,
  dataDir: undefined,
  wheel: undefined,
  uvxBin: undefined,
}

/** 合并 config 与缺省（只认对象；非对象一律当没给）。 */
function normalizeConfig(config) {
  const cfg = config && typeof config === 'object' && !Array.isArray(config) ? config : {}
  return { ...DEFAULT_CONFIG, ...cfg }
}

/**
 * service 层自己要用端口时的取值（`config.port` → 常量缺省；非法值回落常量），与 `plan.mjs::pickPort` 同口径。
 * **只用于 plan 还没解析出来的场合**（状态文件初值、`waitReady`/`baziBirth` 的兜底）；
 * 真正的端口一律以 `plan.port` 为准（它才认 env 注入点）。
 */
function effectivePort(cfg) {
  const value = cfg.port
  if (value === undefined || value === null || String(value).trim() === '') return HOROSA_DEFAULT_PORT
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 65535 ? numeric : HOROSA_DEFAULT_PORT
}

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/** 非严格读一个 cordis service：`ctx.get(name, false)` **与** `ctx[name]` 两种取法都试。 */
function softService(ctx, name) {
  const viaGet = softGet(ctx, name)
  if (viaGet !== undefined && viaGet !== null) return viaGet
  // cordis 的 service 也是 Context 上的属性（`ctx.commands` / `ctx.profileContext`），
  // 而宿主替身/裸 ctx 可能只给其中一种形状 —— 两种都认，缺能力才降级。
  try {
    const direct = ctx?.[name]
    if (direct !== undefined && direct !== null) return direct
  } catch {
    /* 属性访问器抛了：当没有 */
  }
  return undefined
}

/** 静默 logger（宿主没装 logger 时的替身；绝不因为日志失败影响主流程）。 */
const SILENT_LOGGER = { info() {}, warn() {}, error() {} }

/** 把一个「像 logger 的东西」（函数或带 info/warn/error 的对象）包成安全 logger：任何调用都不抛。 */
function wrapLogger(candidate) {
  if (candidate === undefined || candidate === null) return SILENT_LOGGER
  const safe = { info() {}, warn() {}, error() {} }
  let bound = false
  for (const key of ['info', 'warn', 'error']) {
    if (typeof candidate[key] === 'function') {
      safe[key] = (...args) => {
        try {
          return candidate[key](...args)
        } catch {
          /* 日志失败不该影响主流程 */
        }
      }
      bound = true
    }
  }
  if (!bound && typeof candidate === 'function') {
    for (const key of ['info', 'warn', 'error']) {
      safe[key] = (...args) => {
        try {
          return candidate(...args)
        } catch {
          /* 同上 */
        }
      }
    }
  }
  return safe
}

/**
 * 取一个带作用域名的 logger（出处：`@deepseek-ai/cordis/lib/types/context.d.ts:26-27`）。
 * 三级兜底：`ctx.logger('xuanshu-host:horosa')` → `ctx.logger` 本体 → 静默替身。
 * 返回的一定是 `{info,warn,error}` 三件套都在的**安全对象**（宿主 logger 是裸函数也能用）。
 */
function namedLogger(ctx) {
  try {
    const logger = ctx?.logger
    if (typeof logger === 'function') {
      return wrapLogger(logger('xuanshu-host:horosa') ?? logger)
    }
    if (logger !== undefined && logger !== null) return wrapLogger(logger)
  } catch {
    /* 落到静默替身 */
  }
  return SILENT_LOGGER
}

/** 解析 DSH home：profileContext.home → `$DSH_HOME` → `~/.dsh`（与票 01 `lib/index.js` 同口径）。 */
function resolveDshHome(ctx, env) {
  const profileCtx = softService(ctx, 'profileContext')
  if (typeof profileCtx?.home === 'string' && profileCtx.home !== '') return profileCtx.home
  if (typeof env?.DSH_HOME === 'string' && env.DSH_HOME !== '') return env.DSH_HOME
  return undefined // 交给 resolveHorosaPaths 走 ~/.dsh 缺省
}

/** `process.kill(pid, 0)` 探活（EPERM 表示存在但不属于我 → 仍算活着）。 */
function pidAlive(pid) {
  const numericPid = Number(pid)
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false
  try {
    process.kill(numericPid, 0)
    return true
  } catch (error) {
    return error && error.code === 'EPERM'
  }
}

/**
 * 创建一个 horosa 运行时（状态机 + 服务方法）。**纯构造**：不读盘、不起进程、不写状态文件
 * （第一次状态写入由调用方显式触发，见 `persistStatus`）。
 *
 * 与 `installHorosa` 的分工：本函数每次调用都给**独立实例**（测试要能各自造状态），
 * 「同进程多次装配共用一份」由 `installHorosa` 里的模块级安装槽负责。
 */
export function createHorosaRuntime({ ctx, config, log, paths, plan } = {}) {
  const cfg = normalizeConfig(config)
  const env = process.env
  // `log` 由调用方给（测试/宿主）时优先用它，否则从 ctx 取；两种都包成安全 logger。
  const logger = log !== undefined && log !== null ? wrapLogger(log) : namedLogger(ctx)
  const resolvedPaths = paths && typeof paths === 'object' ? paths : resolveHorosaPaths({ dshHome: resolveDshHome(ctx, env), config: cfg, env })
  let planCache = plan && typeof plan === 'object' ? plan : null
  /** `plan.wheelExists === false` 时的排障 hint（ensure 时算一次；start 的失败路径沿用它）。 */
  let wheelHint = null

  const state = {
    phase: 'idle',
    code: null,
    detail: '尚未装配完成（createHorosaRuntime 已构造，等 installHorosa 落状态）。',
    hint: null,
    runtime: { root: resolvedPaths.runtimeRoot, installed: null, version: null, expectedVersion: null },
    // `cleanedUp`：true = 没有「自己起过、还没收掉」的进程；false = 有（失败路径留下的孤儿）。
    serve: { started: false, pid: null, reused: false, cleanedUp: true, logFile: resolvedPaths.serveLogFile, readyMs: null },
    endpoint: {
      host: HOROSA_DEFAULT_HOST,
      port: effectivePort(cfg),
      url: `http://${HOROSA_DEFAULT_HOST}:${effectivePort(cfg)}${HOROSA_MCP_PATH}`,
      verdict: null,
      sessionId: null,
      toolCount: null,
    },
    // 计划摘要（additive 顶层块；`ensure()` 之后才有值）：排障时最先要看的一小块。
    // `wheelExists:false` 同时会把 setup 提示写进 `status.hint`（见 WHEEL_MISSING_HINT）。
    plan: null,
    bazi: null,
  }

  /** 状态文件对象（R7 的字段表）。
   *
   * **`ok` 的语义（Lead 2026-10-13 裁决）**：`ok` = 「**这一步没有失败**」，**不是**「serve 正在跑」。
   * 所以 `phase:'stopped'`（正常收工）与 `idle`（已装配、等自启）都是 `ok:true`；只有真的失败
   * —— `blocked`（环境门没过 / spawn 失败 / 超时 / probe-failed）与 `foreign`（端口被非 horosa 占）
   * —— 才是 `ok:false`。`stop()` 被拒（`code:'not-ours'`）同样算失败 → `ok:false`。
   * 判「底座在不在跑」要看 `phase === 'ready'` 与 `serve.started/pid`，**不要**看 `ok`。
   */
  function statusObject() {
    const failed = state.code !== null || FAILURE_PHASES.has(state.phase)
    const out = {
      schema: HOROSA_STATUS_SCHEMA,
      generatedAt: new Date().toISOString(),
      ok: !failed,
      phase: state.phase,
      code: state.code,
      detail: state.detail,
      hint: state.hint,
      runtime: { ...state.runtime },
      serve: { ...state.serve },
      endpoint: { ...state.endpoint },
    }
    if (state.plan) out.plan = { ...state.plan }
    if (state.bazi) out.bazi = { ...state.bazi }
    return out
  }

  /** 原子写状态文件（同目录临时文件 + rename；**永不抛**，失败只记日志）。 */
  function persist() {
    try {
      mkdirSync(dirname(resolvedPaths.statusFile), { recursive: true })
      const tmp = `${resolvedPaths.statusFile}.${process.pid}.${Date.now().toString(36)}.tmp`
      writeFileSync(tmp, `${JSON.stringify(statusObject(), null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
      try {
        renameSync(tmp, resolvedPaths.statusFile)
      } catch (error) {
        try {
          rmSync(tmp, { force: true })
        } catch {
          /* 临时文件清不掉不掩盖原错误 */
        }
        throw error
      }
    } catch (error) {
      try {
        logger.warn(`horosa 状态文件写不出去：${String(error?.message ?? error)}`)
      } catch {
        /* 日志也失败就闭嘴 */
      }
    }
    return resolvedPaths.statusFile
  }

  /** 状态迁移 + 落盘（R7：每次状态变化都重写）。 */
  function setState(phase, patch = {}) {
    state.phase = phase
    if ('code' in patch) state.code = patch.code ?? null
    if ('detail' in patch) state.detail = patch.detail ?? state.detail
    if ('hint' in patch) state.hint = patch.hint ?? null
    persist()
    return statusObject()
  }

  /** 解析 plan（缓存；失败也缓存 —— 免得每次轮询都去戳文件系统）。 */
  function ensurePlan() {
    if (planCache && typeof planCache.ok === 'boolean') return planCache
    planCache = resolveHorosaPlan({ paths: resolvedPaths, config: cfg, env })
    return planCache
  }

  /** 端点对象刷新（host/port/url/verdict 随 plan 走）。 */
  function setEndpoint(patch) {
    state.endpoint = { ...state.endpoint, ...patch }
  }

  /**
   * 装环境门：plan → runtime（同版本）。**不 spawn**。
   * @returns {Promise<{ok:boolean, code:string|null, detail:string, hint:string|null, runtime:object, plan:object|null}>}
   */
  async function ensure() {
    setState('ensuring', { code: null, detail: '解析 plan + 检查 runtime（同版本门）…', hint: null })

    const planRead = ensurePlan()
    if (!planRead.ok) {
      setState('blocked', { code: planRead.code, detail: planRead.detail, hint: planRead.hint })
      return { ok: false, code: planRead.code, detail: planRead.detail, hint: planRead.hint, runtime: { ...state.runtime }, plan: null }
    }

    const runtime = ensureRuntime({ runtimeRoot: planRead.runtimeRoot, expectedVersion: planRead.version })
    state.runtime = { root: planRead.runtimeRoot, installed: runtime.installed, version: runtime.version, expectedVersion: runtime.expectedVersion }
    setEndpoint({ host: HOROSA_DEFAULT_HOST, port: planRead.port, url: `http://${HOROSA_DEFAULT_HOST}:${planRead.port}${HOROSA_MCP_PATH}` })
    state.serve = { ...state.serve, logFile: resolvedPaths.serveLogFile }
    // 计划摘要落状态文件（排障人第一眼看的就是它；`wheelExists` 也在里面）。
    state.plan = {
      version: planRead.version,
      wheel: planRead.wheel,
      wheelExists: planRead.wheelExists === true,
      uvxBin: planRead.uvxBin,
      host: planRead.host,
      port: planRead.port,
      source: planRead.source,
      runtimePayloadVersion: runtime.version ?? null,
    }
    // wheel 不在盘上不是门（测试注入点就是要给「还没落盘」的路径），但要**看得见**：
    // 写进 status.hint（+ plan.wheelExists），让排障顺序是「缺件 → 跑 setup」而不是「翻 serve 日志猜」。
    wheelHint = planRead.wheelExists === true ? null : WHEEL_MISSING_HINT

    if (!runtime.ok) {
      setState('blocked', { code: runtime.code, detail: runtime.detail, hint: runtime.hint })
      return { ok: false, code: runtime.code, detail: runtime.detail, hint: runtime.hint, runtime: { ...state.runtime }, plan: planRead }
    }

    const wheelNote = wheelHint === null ? '' : `；${WHEEL_MISSING_NOTE}`
    setState('idle', {
      code: null,
      detail: `环境就绪（v${planRead.version}、wheel=${planRead.wheel}、端点 ${state.endpoint.url}）：可以起 serve${wheelNote}。`,
      hint: wheelHint,
    })
    return { ok: true, code: null, detail: state.detail, hint: wheelHint, runtime: { ...state.runtime }, plan: planRead }
  }

  /**
   * 起 serve：ensure 通过 → 四态裁决 → spawn/复用 → 等 MCP 握手 → 落状态。
   * 失败一律折算成返回值（R1），绝不抛。
   */
  async function start() {
    const gate = await ensure()
    if (!gate.ok) return { ok: false, code: gate.code, detail: gate.detail, hint: gate.hint, started: false, pid: null }

    const planRead = gate.plan
    setState('starting', { code: null, detail: '四态裁决 + 起/复用 serve…', hint: null })

    const probe = await checkHorosaEndpoint({ host: HOROSA_DEFAULT_HOST, port: planRead.port, path: HOROSA_MCP_PATH, timeoutMs: POLL_PROBE_MS })
    setEndpoint({ verdict: probe.verdict, sessionId: probe.sessionId ?? state.endpoint.sessionId })

    if (probe.verdict === 'occupied-foreign') {
      setState('foreign', { code: 'occupied-foreign', detail: probe.detail, hint: probe.hint })
      return { ok: false, code: 'occupied-foreign', detail: probe.detail, hint: probe.hint, started: false, pid: null }
    }
    if (probe.verdict === 'probe-failed') {
      setState('blocked', { code: 'probe-failed', detail: probe.detail, hint: probe.hint })
      return { ok: false, code: 'probe-failed', detail: probe.detail, hint: probe.hint, started: false, pid: null }
    }

    const started = await startHorosaServe({
      wheel: planRead.wheel,
      uvxBin: planRead.uvxBin,
      runtimeRoot: planRead.runtimeRoot,
      dataDir: planRead.dataDir,
      host: HOROSA_DEFAULT_HOST, // R6：spawn 的 --host 恒为 127.0.0.1
      port: planRead.port,
      logFile: resolvedPaths.serveLogFile,
      timeoutMs: cfg.startupWaitMs,
    })

    if (!started.ok) {
      const phase = started.verdict === 'occupied-foreign' ? 'foreign' : 'blocked'
      const code = started.evidence?.reason ?? started.code ?? 'start-failed'
      // hint 优先用失败现场给的；没有就给 wheel 缺件的提示（wheel 不在盘上正是最常见的启动失败原因）。
      const hint = started.evidence?.hint ?? wheelHint ?? null
      const detail = wheelHint !== null && started.evidence?.hint == null ? `${started.detail}（注意：${WHEEL_MISSING_NOTE}）` : started.detail
      // **失败也可能已经 spawn 出进程**（起得来但答不出 / 端口被抢 / 超时）：pid 必须落进状态。
      // 否则 `cleanedUp === false`（清理没成功）时，dispose 就再也收不到它 —— 8765 上留一个
      // 我们自己起的孤儿，正是 R5 要防的漏水口（双轴评审 2026-10-13 指出）。
      const leftoverPid = Number.isInteger(started.pid) && started.pid > 0 ? started.pid : null
      const cleanedUp = started.evidence?.cleanedUp === true
      if (leftoverPid !== null && !cleanedUp) {
        state.serve = { started: true, pid: leftoverPid, reused: false, cleanedUp: false, logFile: resolvedPaths.serveLogFile, readyMs: null }
      }
      setState(phase, { code, detail, hint })
      return { ok: false, code, detail, hint, started: started.started === true, pid: leftoverPid, cleanedUp, serve: started }
    }

    // 「复用」有两种：复用**别人**起的（pid 记 null，永不碰）与复用**我们自己**起的
    // （pid 必须留着 —— R5：dispose 时要收掉自己起的那份；丢了 pid 就等于把自己的 serve 丢在端口上不管了）。
    const previousPid = Number.isInteger(state.serve.pid) && state.serve.pid > 0 ? state.serve.pid : null
    const keepPrevious = previousPid !== null && ownsServe(previousPid) && pidAlive(previousPid)
    state.serve = {
      started: started.started === true || keepPrevious,
      pid: started.started === true ? started.pid : keepPrevious ? previousPid : null,
      reused: started.started !== true,
      cleanedUp: true,
      logFile: resolvedPaths.serveLogFile,
      readyMs: started.started === true ? (typeof started.evidence?.readyMs === 'number' ? started.evidence.readyMs : null) : keepPrevious ? state.serve.readyMs : null,
    }
    setEndpoint({ verdict: 'horosa-ready', sessionId: started.evidence?.sessionId ?? state.endpoint.sessionId })

    // 工具面（端点的 toolCount）：起/复用完摸一次。摸失败**不**改判 ok —— 握手已经证明「MCP 真的能用」。
    const list = await mcpToolsList({ host: HOROSA_DEFAULT_HOST, port: planRead.port, path: HOROSA_MCP_PATH, timeoutMs: 20_000 })
    if (list.ok) setEndpoint({ toolCount: list.tools.length })

    const detail = started.started
      ? `${state.endpoint.url} 上的 horosa serve 已由宿主起来并握手成功（pid ${state.serve.pid}，${state.serve.readyMs ?? '?'}ms${list.ok ? `，${state.endpoint.toolCount} 个工具` : ''}）。`
      : `${state.endpoint.url} 上已有 horosa 在答：复用（不新起第二个实例）${keepPrevious ? `，复用的是本模块自己起的 pid ${state.serve.pid}` : '，那份不是本模块起的（永不 kill）'}${list.ok ? `，${state.endpoint.toolCount} 个工具` : ''}。`
    setState('ready', { code: null, detail, hint: null })
    return { ok: true, code: null, detail, hint: null, started: state.serve.started, pid: state.serve.pid, reused: state.serve.reused, serve: started }
  }

  /**
   * 要收尾的 pid 集合 = `state.serve.pid` **∪** 登记表里「自己起过、还没收掉」的全部 pid。
   *
   * 为什么要并集：失败路径可能没把 pid 记进状态（历史缺陷）或记漏，而登记表是 spawn 的**唯一授权来源**，
   * 它一定知道我们起过谁。两者取并集，收尾就不会留孤儿（R5）。
   */
  function cleanupTargets() {
    const pids = new Set()
    if (Number.isInteger(state.serve.pid) && state.serve.pid > 0) pids.add(state.serve.pid)
    for (const pid of ownedServePids()) pids.add(pid)
    return [...pids].sort((a, b) => a - b)
  }

  /** 停掉自己起的 serve（不是自己起的一律拒绝，R5）；并集收尾，一个都不留。 */
  async function stop() {
    const targets = cleanupTargets()
    if (targets.length === 0) {
      // 语义与 `stopHorosaServe({pid:null})` 一致：没有要停的 → no-op 成功。
      const result = await stopHorosaServe({ pid: null, timeoutMs: 20_000 })
      state.serve = { started: false, pid: null, reused: false, cleanedUp: true, logFile: resolvedPaths.serveLogFile, readyMs: null }
      setState('stopped', { code: null, detail: result.detail, hint: null })
      return { ok: true, detail: result.detail, evidence: result.evidence }
    }

    const results = []
    for (const pid of targets) results.push({ pid, ...(await stopHorosaServe({ pid, timeoutMs: 20_000 })) })
    const ok = results.every((entry) => entry.ok === true)
    const detail = results.map((entry) => entry.detail).join(' ')

    if (ok) {
      state.serve = { started: false, pid: null, reused: false, cleanedUp: true, logFile: resolvedPaths.serveLogFile, readyMs: null }
      setState('stopped', { code: null, detail, hint: null })
      return { ok: true, detail, evidence: { pids: targets, results } }
    }

    // 拒绝或不干净：**不改** serve 记录（它可能还在跑），把 code 亮出来；没收回来的 pid 留在状态里，下次再试。
    const failed = results.find((entry) => entry.ok !== true)
    const remaining = results.filter((entry) => entry.ok !== true).map((entry) => entry.pid).filter(Boolean)
    setState(state.phase === 'ready' ? 'ready' : state.phase, {
      code: failed?.evidence?.reason ?? 'stop-failed',
      detail,
      hint: '见 evidence：不是本模块起的进程一律不碰（只停自己起的）；没收回来的 pid 仍记在状态里，下次 start/stop 会再试。',
    })
    return { ok: false, detail, evidence: { pids: targets, results, remaining } }
  }

  /**
   * 等外部实例就绪（**不 spawn**）：轮询四态。
   * @param {number} [timeoutMs] 预算，缺省 config.startupWaitMs
   */
  async function waitReady(timeoutMs) {
    const budget = Math.max(1, Number(timeoutMs) || cfg.startupWaitMs || DEFAULT_CONFIG.startupWaitMs)
    const planRead = ensurePlan()
    const port = planRead.ok ? planRead.port : effectivePort(cfg)
    setEndpoint({ host: HOROSA_DEFAULT_HOST, port, url: `http://${HOROSA_DEFAULT_HOST}:${port}${HOROSA_MCP_PATH}` })
    const startedAt = Date.now()
    let last = null
    for (;;) {
      last = await checkHorosaEndpoint({ host: HOROSA_DEFAULT_HOST, port, path: HOROSA_MCP_PATH, timeoutMs: POLL_PROBE_MS })
      setEndpoint({ verdict: last.verdict, sessionId: last.sessionId ?? null })
      if (last.verdict === 'horosa-ready') {
        setState('ready', { code: null, detail: `等到了 horosa-ready（${Date.now() - startedAt}ms）：${last.detail}`, hint: null })
        return { ok: true, verdict: last.verdict, elapsedMs: Date.now() - startedAt, detail: state.detail }
      }
      if (Date.now() - startedAt >= budget) {
        setState(last.verdict === 'occupied-foreign' ? 'foreign' : 'blocked', { code: last.verdict, detail: `等 ${budget}ms 仍未就绪（最后判定 ${last.verdict}）：${last.detail}`, hint: last.hint })
        return { ok: false, verdict: last.verdict, elapsedMs: Date.now() - startedAt, detail: state.detail, hint: last.hint }
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }

  /**
   * 八字出盘：`buildBaziPayload` → `mcpCallTool(HOROSA_BAZI_TOOL)` → `classifyBaziEnvelope` → 落 `status.bazi`。
   *
   * 返回形状 = 分类结果 + 三个附加键：
   *   - `pillars`：**4 槽数组** `[年,月,日,时]`（不全合法则 null）—— 与票 05 setup 报告的 `pillars` 同形；
   *   - `fourColumns`：分类结果里的**对象**形状 `{year,month,day,hour}`（`classifyBaziEnvelope().pillars`）；
   *   - `evidence`：MCP 调用的证据（信封来自哪个字段、HTTP 状态、会话 id…）。
   */
  async function baziBirth(input) {
    const built = buildBaziPayload(input)
    if (!built.ok) {
      state.bazi = { lastPhase: 'invalid', lastTool: null, lastVersion: null, pillars: null }
      persist()
      return {
        ok: false,
        phase: 'invalid',
        code: built.code,
        detail: built.detail,
        hint: built.hint,
        missing: built.missing ?? [],
        problems: built.problems,
        pillars: null,
        fourColumns: null,
        timeAlg: null,
        timeAlgSource: null,
        techniqueCard: null,
      }
    }

    const planRead = ensurePlan()
    const port = planRead.ok ? planRead.port : effectivePort(cfg)
    const called = await mcpCallTool({ name: HOROSA_BAZI_TOOL, args: built.payload, host: HOROSA_DEFAULT_HOST, port, path: HOROSA_MCP_PATH, timeoutMs: DEFAULT_BAZI_TIMEOUT_MS })

    if (!called.ok || !called.envelope) {
      state.bazi = { lastPhase: 'error', lastTool: HOROSA_BAZI_TOOL, lastVersion: null, pillars: null }
      persist()
      return {
        ok: false,
        phase: 'error',
        code: 'mcp-call-failed',
        tool: HOROSA_BAZI_TOOL,
        detail: `八字出盘没走到信封：${called.detail}`,
        hint: '先看端点四态（/xuanshu-horosa status）与 serve 日志：<dataDir>/serve.log。',
        pillars: null,
        fourColumns: null,
        timeAlg: null,
        timeAlgSource: null,
        techniqueCard: null,
        payload: built.payload,
        evidence: called.evidence,
      }
    }

    const classified = classifyBaziEnvelope(called.envelope)
    const fourColumns = classified.pillars
    // 对外槽位固定是 4 槽数组（Lead 验收脚本按 Array.isArray + every(Boolean) 判）。
    const pillars = fourColumns ? [fourColumns.year, fourColumns.month, fourColumns.day, fourColumns.hour] : null
    state.bazi = {
      lastPhase: classified.phase,
      lastTool: classified.tool ?? null,
      lastVersion: classified.version ?? null,
      pillars,
    }
    persist()
    return { ...classified, pillars, fourColumns, payload: built.payload, evidence: called.evidence }
  }

  /**
   * 通用工具调用（裸信封）：给「不是八字」的技法用（票 13 的日课要 `horosa_cn_huangli`）。
   *
   * 与 `baziBirth()` 的**同族**语义：只负责「取端点 → `mcpCallTool` → 原样回信封」，
   * **不替你起 serve**（起没起由 `start` / `ensure` / apply 期的 autostart 决定，与 `baziBirth` 一致）。
   * 之所以要有它：票 06 冻结的服务面只有 `baziBirth` 一个业务方法，而「自己起 serve / 直连 8765」
   * 是票 08 明令禁止的第二条通道 —— 缺这一口，票 13 的日课就没有合法通道。
   *
   * @param {string} name MCP 工具名（如 `horosa_cn_huangli`）。
   * @param {object} [args] 工具参数。
   * @param {{timeoutMs?: number}} [options] 超时（缺省用八字那一档：首调会拉起 runtime）。
   * @returns {Promise<{ok: boolean, envelope: object|null, tool: string|null, detail: string, code: string|null, from: object|null, evidence: object|null}>}
   *   `ok` 的语义 = **调用走到了信封**（不是「业务成功」）——判业务要看信封的 `ok` 与各技法的口径，
   *   与 `mcpCallTool` 同口径。
   */
  async function callTool(name, args = {}, options = {}) {
    const tool = typeof name === 'string' && name.trim() !== '' ? name.trim() : null
    if (tool === null) {
      return { ok: false, envelope: null, tool: null, code: 'missing-tool-name', detail: 'callTool 需要一个非空工具名（如 horosa_cn_huangli）。', from: null, evidence: null }
    }
    const planRead = ensurePlan()
    const port = planRead.ok ? planRead.port : effectivePort(cfg)
    const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_BAZI_TIMEOUT_MS
    const called = await mcpCallTool({ name: tool, args, host: HOROSA_DEFAULT_HOST, port, path: HOROSA_MCP_PATH, timeoutMs })
    if (!called.ok || !called.envelope) {
      return {
        ok: false,
        envelope: null,
        tool,
        code: 'mcp-call-failed',
        detail: `${tool} 没走到信封：${called.detail}`,
        from: called.from ?? null,
        evidence: called.evidence ?? null,
      }
    }
    return { ok: true, envelope: called.envelope, tool, code: null, detail: `调用 ${tool} 成功（信封已回，业务成败看信封 ok）。`, from: called.from ?? null, evidence: called.evidence ?? null }
  }

  /**
   * 收尾（dispose 用）：清状态 + 停掉自己起的 serve（`keepServeOnDispose` 可留）。
   * 与 `stop()` 同一套「并集」收尾：`state.serve.pid` ∪ 登记表里还没收掉的 pid ——
   * 失败路径留下的孤儿即使没记进状态，也在这里被收掉（R5）。
   */
  async function dispose() {
    if (cfg.keepServeOnDispose === true) {
      logger.info('keepServeOnDispose=true：留着宿主起的 horosa serve。')
      return { ok: true, kept: true, detail: '按 config.keepServeOnDispose 保留自己起的 serve。' }
    }
    const targets = cleanupTargets()
    if (targets.length === 0) return { ok: true, kept: false, detail: '没有自己起的 serve：无需收尾。' }
    const results = []
    for (const target of targets) results.push({ pid: target, ...(await stopHorosaServe({ pid: target, timeoutMs: DISPOSE_STOP_TIMEOUT_MS })) })
    const ok = results.every((entry) => entry.ok === true)
    const detail = results.map((entry) => entry.detail).join(' ')
    state.serve = { started: false, pid: null, reused: false, cleanedUp: ok, logFile: resolvedPaths.serveLogFile, readyMs: null }
    setState('stopped', { code: ok ? null : 'dispose-stop-failed', detail: `dispose：${detail}`, hint: ok ? null : '见 evidence：没收掉的 pid 仍留在登记表里（进程没了才算收干净）。' })
    return { ok, kept: false, detail, evidence: { pids: targets, results } }
  }

  return {
    /** 当前状态（与状态文件同形；**无副作用**）。 */
    status() {
      return statusObject()
    },
    ensure,
    start,
    stop,
    waitReady,
    baziBirth,
    callTool,
    /** 紧凑快照（给命令/排障用：路径、config、plan、状态）。 */
    snapshot() {
      const planRead = planCache
      return {
        schema: HOROSA_STATUS_SCHEMA,
        phase: state.phase,
        code: state.code,
        statusFile: resolvedPaths.statusFile,
        paths: { ...resolvedPaths },
        config: { ...cfg },
        plan: planRead
          ? { ok: planRead.ok === true, code: planRead.code ?? null, version: planRead.version ?? null, wheel: planRead.wheel ?? null, wheelExists: planRead.wheelExists ?? null, uvxBin: planRead.uvxBin ?? null, host: planRead.host ?? null, port: planRead.port ?? null, source: planRead.source ?? null }
          : null,
        serve: { ...state.serve },
        endpoint: { ...state.endpoint },
        bazi: state.bazi ? { ...state.bazi } : null,
      }
    },
    /** 立即落一次状态文件（装配时用；R7）。 */
    persistStatus(phase, patch) {
      return setState(phase, patch)
    },
    dispose,
  }
}

/* ------------------------------------------------------------------ *
 * 命令处理（R9）
 * ------------------------------------------------------------------ */

/** 命令的一行摘要（人类可读；不出 JSON）。`ok` 与状态文件同一口径（这一步有没有失败）。 */
function statusLine(status) {
  const bazi = status.bazi ? `，最近出盘 ${status.bazi.lastPhase}/${status.bazi.lastTool ?? '-'}${status.bazi.pillars ? ` ${status.bazi.pillars.join(' ')}` : ''}` : ''
  const wheel = status.plan && status.plan.wheelExists === false ? '，wheel 不在盘上（跑 pnpm setup:xuanshu）' : ''
  const leftover = status.serve && status.serve.cleanedUp === false ? `，有没收回来的 pid ${status.serve.pid}（下次 start/stop 会再收）` : ''
  return `horosa ${status.phase}（ok=${status.ok}${status.code ? `，code=${status.code}` : ''}）：${status.detail} 端点 ${status.endpoint.url}（verdict=${status.endpoint.verdict ?? '-'}，工具 ${status.endpoint.toolCount ?? '?'}）${wheel}${leftover}${bazi}${status.hint ? ` ｜ 处置：${status.hint.split('\n')[0]}` : ''}`
}

/** 把 `key=value` 形式的子参数拼成出盘输入（`/xuanshu-horosa bazi date=1990-01-01 time=12:00 zone=+08:00 lat=31n14 lon=121e29`）。 */
function parseBaziArgs(tokens) {
  const input = {}
  for (const token of tokens) {
    const at = token.indexOf('=')
    if (at <= 0) continue
    const key = token.slice(0, at)
    const value = token.slice(at + 1)
    if (key === 'timeAlg') input.timeAlg = Number(value)
    else if (key === 'gender') input.gender = value
    else if (key === 'clarificationNotes') input.clarificationNotes = value
    else input[key] = value
  }
  return input
}

/** 执行一条 `/xuanshu-horosa …`（**永不抛**：一切异常折算成 `{kind:'error', text}`）。 */
async function handleCommand(service, invocation) {
  try {
    const raw = typeof invocation?.rawInput === 'string' ? invocation.rawInput : ''
    const tokens = raw.trim().split(/\s+/).filter(Boolean)
    const sub = tokens[0] ?? 'status'

    if (sub === 'status') {
      return { kind: 'success', text: statusLine(service.status()) }
    }
    if (sub === 'start') {
      const result = await service.start()
      return { kind: result.ok ? 'success' : 'error', text: `${result.ok ? '✓' : '✗'} ${result.detail}${result.hint ? ` ｜ 处置：${result.hint.split('\n')[0]}` : ''}` }
    }
    if (sub === 'stop') {
      const result = await service.stop()
      return { kind: result.ok ? 'success' : 'error', text: `${result.ok ? '✓' : '✗'} ${result.detail}` }
    }
    if (sub === 'bazi') {
      const input = parseBaziArgs(tokens.slice(1))
      if (!input.date || !input.time || !input.zone || !input.lat || !input.lon) {
        return {
          kind: 'error',
          text: '用法：/xuanshu-horosa bazi date=1990-01-01 time=12:00 zone=+08:00 lat=31n14 lon=121e29 [gender=1] [timeAlg=1|3]（五个出生字段必填；缺经纬度不许出盘）。',
        }
      }
      const cast = await service.baziBirth(input)
      const pillars = Array.isArray(cast.pillars) ? cast.pillars.join(' ') : '(四柱不可读)'
      return {
        kind: cast.ok ? 'success' : 'error',
        text: `${cast.ok ? '✓' : '✗'} ${cast.detail}${cast.ok ? ` ｜ 四柱 ${pillars} ｜ timeAlg=${cast.timeAlg ?? '?'}${cast.timeAlgSource ? `（${cast.timeAlgSource}）` : ''}` : ''}`,
      }
    }
    return { kind: 'error', text: `未知子参数 ${sub}：只认 status / start / stop / bazi。` }
  } catch (error) {
    return { kind: 'error', text: `horosa 命令执行失败：${String(error?.message ?? error)}（已兜住，不影响 DSH 本体）。` }
  }
}

/* ------------------------------------------------------------------ *
 * 装配（lib/index.js 只调 installHorosa）
 * ------------------------------------------------------------------ */

/**
 * 模块级安装槽：同一进程内多次装配**共用一份**运行时（R8 幂等）。
 *
 * 为什么要按「目标」分槽：R8 的原文是「同一进程内多次装配共用一份」—— 它防的是
 * 「同一个 DSH 进程里挂两次 → 各起一个 serve 撞端口」。而**不同的目标**（不同 dataDir /
 * runtimeRoot / 端口）是两套独立现场：测试要在同一个进程里造十几个沙箱，共用一份会让第二个
 * 沙箱的状态文件永远写不出来（跨用例假红）。所以：目标相同 → 同一份；目标不同 → 各一份。
 */
const INSTALLED = new Map()

/**
 * 安装槽的键：目标身份（路径 + 端点 + 工件 + uvx）。
 * 端口把「config 显式给的」与「env 注入的」都算上：两者都可能换掉 serve 的落点，
 * 不区分就会让「同一 dataDir + 不同端口」的两次装配错误地共用一份运行时。
 */
function installKey(paths, cfg, env) {
  const envPort = env && typeof env === 'object' ? String(env.XUANSHU_HOROSA_PORT ?? '') : ''
  return [paths.dataDir, paths.runtimeRoot, cfg.host, effectivePort(cfg), envPort, cfg.wheel ?? '', cfg.uvxBin ?? ''].join('|')
}

/** 注册 `xuanshuHorosa` 服务（provide 不可得就跳过并记 note）。 */
function provideService(ctx, service, notes) {
  if (typeof ctx?.provide !== 'function') {
    notes.push('ctx.provide 不可得：跳过 xuanshuHorosa 服务注册（状态文件与命令仍在）。')
    return false
  }
  try {
    ctx.provide(SERVICE_NAME, service) // 出处：cordis/lib/types/reflect.d.ts:41-43（服务生命周期归本 fiber）
    return true
  } catch (error) {
    notes.push(`xuanshuHorosa 服务注册失败（${String(error?.message ?? error)}）：多半是同名服务已被提供。`)
    return false
  }
}

/** 注册 `/xuanshu-horosa` 命令（`ctx.effect` 包裹；R9）。 */
function registerCommand(ctx, service, notes) {
  const commands = softService(ctx, 'commands')
  if (!commands || typeof commands.register !== 'function') {
    notes.push('commands 服务不可得：跳过 /xuanshu-horosa 命令（状态文件仍是主证据）。')
    return false
  }
  const register = () => {
    const dispose = commands.register({
      name: COMMAND_NAME,
      description: '玄枢 horosa 底座：status（默认）/ start / stop / bazi key=value…',
      handler: (invocation) => handleCommand(service, invocation),
    })
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }
  try {
    // **先真的注册**，再把注销交给 `ctx.effect`：宿主替身（以及能力不齐的 ctx）不一定会执行
    // effect 回调体，注册要是只写在回调里，命令就永远挂不上（R9 的外部判据是「命令真的注册了」）。
    const cleanup = register()
    if (typeof ctx.effect === 'function') {
      try {
        ctx.effect(() => cleanup, 'xuanshu-host: /xuanshu-horosa 命令') // 出处：cordis/lib/types/fiber.d.ts:157
      } catch (error) {
        notes.push(`/xuanshu-horosa 命令的卸载钩子没挂上（${String(error?.message ?? error)}）：命令仍可用，卸载时不会自动注销。`)
      }
    } else {
      notes.push('/xuanshu-horosa 已注册，但 ctx.effect 不可得：卸载时不会自动注销（进程退出即回收）。')
    }
    return true
  } catch (error) {
    notes.push(`/xuanshu-horosa 命令注册失败（${String(error?.message ?? error)}）。`)
    return false
  }
}

/** 后台自启（R1：`setTimeout(...).unref()`，dispose 清定时器）。 */
function scheduleAutostart(ctx, service, cfg, notes) {
  const envOff = String(process.env.XUANSHU_HOROSA_AUTOSTART ?? '') === '0'
  if (cfg.autoStart !== true) {
    notes.push('config.autoStart=false：不自动起 serve（可用 /xuanshu-horosa start 手动起）。')
    return false
  }
  if (envOff) {
    notes.push('XUANSHU_HOROSA_AUTOSTART=0：不自动起 serve（测试注入点）。')
    return false
  }

  const delay = Math.max(0, Number(cfg.startDelayMs) || 0)
  const timer = setTimeout(() => {
    service.start().catch((error) => {
      try {
        namedLogger(ctx).warn(`horosa 自动启动失败：${String(error?.message ?? error)}`)
      } catch {
        /* 日志失败无所谓 */
      }
    })
  }, delay)
  // unref：装配不为一个后台任务吊住 DSH 进程（R1）。
  if (typeof timer.unref === 'function') timer.unref()

  const cleanup = async () => {
    clearTimeout(timer)
    try {
      await service.dispose()
    } catch (error) {
      try {
        namedLogger(ctx).warn(`horosa 收尾失败：${String(error?.message ?? error)}`)
      } catch {
        /* 收尾失败不改主流程 */
      }
    }
  }
  if (typeof ctx?.effect === 'function') {
    try {
      ctx.effect(() => cleanup, INSTALL_LABEL)
    } catch (error) {
      notes.push(`ctx.effect 不可得（${String(error?.message ?? error)}）：dispose 时不自动收 serve。`)
    }
  } else {
    notes.push('ctx.effect 不可得：dispose 时不自动收 serve。')
  }
  return true
}

/**
 * 装配 horosa 底座（**lib/index.js 只调这一个函数**）。
 *
 * 顺序：解析路径 → 复用/创建运行时 → **同步**落一次状态文件（装配即可观察）→ provide 服务
 * → 注册命令 → 安排后台自启。任何一步失败都只记 note/日志，**绝不抛**（R1）。
 *
 * @param {object} ctx cordis 宿主上下文（裸 `{}` 也要活：没有 logger/commands/provide/effect 都行）
 * @param {object} [config] 补丁行 config（全部可选、全部有缺省；本票不改 `cordis.patch.yml`）
 * @returns {{ok:boolean, code:string|null, detail:string, service:object|null, paths:object|null, provided:boolean, commanded:boolean, autostart:boolean, notes:string[]}}
 */
export function installHorosa(ctx, config) {
  const notes = []
  const log = namedLogger(ctx)
  try {
    const cfg = normalizeConfig(config)
    if (cfg.enabled === false) {
      notes.push('config.enabled=false：整个 horosa 底座跳过装配。')
      return { ok: true, code: null, detail: 'horosa 底座被 config.enabled=false 关掉。', service: null, paths: null, provided: false, commanded: false, autostart: false, notes }
    }

    const paths = resolveHorosaPaths({ dshHome: resolveDshHome(ctx, process.env), config: cfg, env: process.env })

    const key = installKey(paths, cfg, process.env)
    let service = INSTALLED.get(key) ?? null
    if (service === null) {
      service = createHorosaRuntime({ ctx, config: cfg, log, paths })
      INSTALLED.set(key, service)
    } else {
      notes.push(`xuanshuHorosa 运行时已存在（同一目标 dataDir=${paths.dataDir}）：同进程内共用同一份（幂等装配）。`)
    }

    // ① 状态文件：同步落一次（P9 的判据是「装配后文件就在」）。**先写**再注册服务/命令。
    const status = service.persistStatus('idle', { code: null, detail: `已装配（config: autoStart=${cfg.autoStart}，端点缺省 http://${HOROSA_DEFAULT_HOST}:${effectivePort(cfg)}${HOROSA_MCP_PATH}${process.env.XUANSHU_HOROSA_PORT ? `，端口由 $XUANSHU_HOROSA_PORT=${process.env.XUANSHU_HOROSA_PORT} 注入` : ''}）；等自启/手动 start。`, hint: null })

    // ② 服务 + ③ 命令 + ④ 自启
    const provided = provideService(ctx, service, notes)
    const commanded = registerCommand(ctx, service, notes)
    const autostart = scheduleAutostart(ctx, service, cfg, notes)

    log.info(`horosa 底座已装配：status=${paths.statusFile}（phase=${status.phase}），provide=${provided}，command=${commanded}，autostart=${autostart}`)
    return {
      ok: true,
      code: null,
      detail: `horosa 底座已装配（服务 ${provided ? '已注册' : '未注册'}、命令 ${commanded ? '已注册' : '未注册'}、自启 ${autostart ? `将在 ${cfg.startDelayMs}ms 后开始` : '关闭'}）。`,
      service,
      paths,
      provided,
      commanded,
      autostart,
      notes,
    }
  } catch (error) {
    const detail = `horosa 底座装配失败（已兜住，不影响其它装配）：${String(error?.message ?? error)}`
    try {
      log.warn(detail)
    } catch {
      /* 日志也失败就闭嘴 */
    }
    return { ok: false, code: 'install-failed', detail, service: null, paths: null, provided: false, commanded: false, autostart: false, notes }
  }
}
