#!/usr/bin/env node
/**
 * verify-isolation.mjs — 玄枢（XuanShu）票 04 的「隔离验收台」：**唯一断言实现**。
 *
 * 用法：
 *   node scripts/verify-isolation.mjs [--json] [--home <dir>] [--profile <name>] [--dsh-bin <path>]
 *                                     [--only <ids>] [--timeout-ms <n>]
 *                                     [--web-port <n>] [--horosa-port <n>] [--keep-tmp] [-h]
 * 退出码：0 = 选中的 check 全过；1 = 有失败，或 profile 未装（显式 skip，见下）。
 *
 * 八个 check id（契约 §4.6 定值，不许改名）与契约 §5 的断言面对照：
 *   home-isolated        I1  隔离 home 生效：7 条派生路径全在 home 下；换 home 后两两不同
 *   cli-version          I2  CLI 来自 profile 树、版本 = profile 装的 dsh-base 版本；--cli-bin 优先
 *   profile-installed        环境门本体：profile 装没装（装不上就别谈隔离）
 *   web-port             I3  web 端口门：被占 → 启动器退出码 3 且 detail 点名端口；空闲 → 通过
 *   horosa-guard         I4  8765 守卫四态（free / horosa-ready / occupied-foreign / probe-failed）
 *   dual-instance        I5  两个隔离 home 各真跑一次 headless，各自写自己的 sessions/storages/报告
 *   no-crosstalk         I5+I7  B 跑完不动 A 的状态；两份清单不相交；xuanshu 端口 ≠ desktop 19387
 *   no-real-home-write   I6  跑完用户真实 ~/.dsh 无新增无删除（只读指纹）
 *
 * 同源原则：所有启动器层的事实都来自 `scripts/isolation/startup.mjs` 的 `runStartup()`（§4.5），
 * 本文件不重新实现任何启动/探测逻辑，也不重复判断「端口算不算被占」——那是队友 B 的 `horosa-guard.mjs`
 * 与 `port-probe.mjs` 的唯一判据。tests/isolation/*.test.mjs 只跑本 CLI 的 `--json` 并断言 checks，
 * 所以「CLI 绿 ⇒ 测试绿」。
 *
 * 两处**有意**的例外（都写在证据里，不藏着）：
 *   1) I1 的「换 home 后两两不同」按契约 §5 用纯函数 `resolveInstance()` 对照（不落盘、不 spawn），
 *      这正是契约对 I1 指定的测法。
 *   2) I4 的 `probe-failed` 态无法经由 `runStartup` 触发：`resolve.mjs` 会在端口号非法时先拒（用法错误），
 *      而「连得上的假服务端」按契约一律判 occupied-foreign。于是这一态由本文件直接调守卫的非法端口
 *      分支来钉住（fail-closed：探针坏了必须报错，不能静默放行一个被占的 8765）。
 *
 * 三条硬规矩（改代码前先读）：
 *   1) **绝不写用户真实 `~/.dsh`**：只读它的顶层 + sessions/storages 指纹；任何 home 解析结果等于
 *      或位于真实 home 下都不接受（由启动器的 home 门 + 本文件的 no-real-home-write 双重兜底）。
 *   2) 临时 home 一律 `tests/isolation/.tmp/**`（已 gitignore），跑完清理；失败时 `--keep-tmp` 留着排查。
 *   3) 对照组服务端一律 `listen(0)` 拿 OS 分配的空闲端口，测完 `close()`；绝不占固定端口、绝不起真 horosa、
 *      绝不联网、绝不调 LLM。
 *
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs'
import http from 'node:http'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_HOROSA_PORT,
  DEFAULT_PROFILE,
  DEFAULT_WEB_PORT,
  DESKTOP_WEB_PORT,
  ENV,
  HOROSA_MCP_PATH,
} from './isolation/defaults.mjs'
import { checkHorosaPort } from './isolation/horosa-guard.mjs'
import { isUnderPath, resolveInstance, resolveRepoRoot, samePath } from './isolation/resolve.mjs'
import { runStartup } from './isolation/startup.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 契约 §4.6 冻结的八个 check id（顺序即打印顺序）。 */
const CHECK_IDS = [
  'home-isolated', 'cli-version', 'profile-installed', 'web-port',
  'horosa-guard', 'dual-instance', 'no-crosstalk', 'no-real-home-write',
]

/** `stateIsolated` 断言的那 7 条派生路径（= I1 的路径面）。 */
const ISOLATED_PATH_KEYS = [
  'profileDir', 'dataDir', 'sessionsDir', 'storagesDir', 'credentialsFile', 'machinePatchFile', 'reportFile',
]

/** 需要 profile 已安装才有意义的 check（未装时显式 skip，不给假绿）。 */
const NEEDS_PROFILE = ['cli-version', 'profile-installed', 'web-port', 'horosa-guard', 'dual-instance', 'no-crosstalk']

const TMP_REL = join('tests', 'isolation', '.tmp')
/** 双实例的两个临时 home 名（各自一份状态，互不相交才叫隔离）。 */
const DUAL_HOME_A = 'dual-a'
const DUAL_HOME_B = 'dual-b'
/** I1 的纯函数对照组 home 名（只用来算路径，不 spawn）。 */
const ALT_HOME = 'alt-home'
/** I4 的 probe-failed 子例：非法端口，确定性地打到守卫的「探针无法判定」分支。 */
const INVALID_PROBE_PORT = 70_000
/** 桌面端原子写留下的临时名（`.xxx.tmp`）：真实 home 里由 desktop 自己创建/改名，按设计不算「我们写了」。 */
const TRANSIENT_NAME = /\.tmp$/i

/* ───────────────────────────── 参数 ───────────────────────────── */

function printHelp() {
  const text = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const block = text.slice(text.indexOf('/**') + 3, text.indexOf('*/'))
  process.stdout.write(`${block.split('\n').map((line) => line.replace(/^ \* ?/, '')).join('\n').trim()}\n`)
}

function parseArgs(argv) {
  const opts = {
    json: false,
    home: process.env[ENV.home],
    profile: process.env[ENV.profile],
    cliBin: process.env[ENV.cliBin],
    only: undefined,
    timeoutMs: undefined,
    webPort: undefined,
    horosaPort: undefined,
    keepTmp: false,
    help: false,
  }
  const value = (flag, raw) => {
    if (raw === undefined) throw new Error(`${flag} needs a value`)
    return raw
  }
  const port = (flag, raw) => {
    const text = value(flag, raw)
    const number = Number(text)
    if (!Number.isInteger(number) || number < 1 || number > 65535) {
      throw new Error(`${flag} needs an integer 1..65535 (got ${text})`)
    }
    return number
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') opts.json = true
    else if (arg === '--home') opts.home = value(arg, argv[++i])
    else if (arg === '--profile') opts.profile = value(arg, argv[++i])
    else if (arg === '--dsh-bin') opts.cliBin = value(arg, argv[++i])
    else if (arg === '--web-port') opts.webPort = port(arg, argv[++i])
    else if (arg === '--horosa-port') opts.horosaPort = port(arg, argv[++i])
    else if (arg === '--only') {
      opts.only = value(arg, argv[++i]).split(',').map((id) => id.trim().toLowerCase()).filter(Boolean)
      for (const id of opts.only) {
        if (!CHECK_IDS.includes(id)) throw new Error(`--only got an unknown check id: ${id} (valid: ${CHECK_IDS.join('|')})`)
      }
    } else if (arg === '--timeout-ms') {
      const number = Number(value(arg, argv[++i]))
      if (!Number.isFinite(number) || number <= 0) throw new Error(`--timeout-ms needs a positive number (got ${argv[i]})`)
      opts.timeoutMs = number
    } else if (arg === '--keep-tmp') opts.keepTmp = true
    else if (arg === '-h' || arg === '--help') opts.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (opts.profile !== undefined && (opts.profile === '.' || opts.profile === '..' || /[\\/]/.test(opts.profile))) {
    throw new Error(`invalid profile name: ${opts.profile}`)
  }
  return opts
}

/* ───────────────────────────── 只读指纹 / 清单 ───────────────────────────── */

/** 单个条目的轻量指纹（mtime + size）；读不到记 null，绝不抛。 */
function statFingerprint(target) {
  try {
    const stat = statSync(target)
    return { mtimeMs: Math.round(stat.mtimeMs), bytes: stat.size }
  } catch {
    return undefined
  }
}

/**
 * 用户真实 home 的**只读**指纹：顶层 + `sessions/` + `storages/` 的直接子项（name + mtime + size）。
 *
 * 为什么是「一层」而不是递归：契约 §5 I6 要的就是这个粒度。递归进会话正文既慢又没意义 ——
 * 「我们的实现误用真实 home」这种 bug 一定表现为**新条目出现**（新 profile / 新报告 / 新 storage），
 * 而不是某个既有会话文件长度变了。
 *
 * 本函数只 `readdirSync` + `statSync`：不创建、不删除、不打开文件内容。
 */
function fingerprintRealHome(realHome) {
  const rows = new Map()
  const add = (rel) => {
    const base = rel === '' ? realHome : join(realHome, rel)
    let entries
    try {
      entries = readdirSync(base, { withFileTypes: true })
    } catch {
      return // 目录不存在 / 权限不足：不是本检查的失败，只是没有这一组指纹
    }
    for (const entry of entries) {
      const key = rel === '' ? entry.name : `${rel}/${entry.name}`
      const fp = statFingerprint(join(base, entry.name))
      rows.set(key, { dir: entry.isDirectory(), mtimeMs: fp?.mtimeMs ?? null, bytes: fp?.bytes ?? null })
    }
  }
  add('')
  add('sessions')
  add('storages')
  return { root: realHome, at: new Date().toISOString(), rows: Object.fromEntries([...rows.entries()].sort()) }
}

/** 两组指纹的差集。分组只是为了让人读得懂「哪儿变了」。 */
function diffFingerprint(before, after) {
  const added = []
  const removed = []
  const touched = []
  for (const [key, next] of Object.entries(after.rows)) {
    const prev = before.rows[key]
    if (prev === undefined) added.push(key)
    else if (prev.mtimeMs !== next.mtimeMs || prev.bytes !== next.bytes) touched.push(key)
  }
  for (const key of Object.keys(before.rows)) if (after.rows[key] === undefined) removed.push(key)
  const group = (key) => (key.includes('/') ? key.slice(0, key.indexOf('/')) : 'top')
  const byGroup = (list) => list.reduce((acc, key) => {
    const name = group(key)
    acc[name] = (acc[name] ?? 0) + 1
    return acc
  }, {})
  return {
    added, removed, touched,
    addedByGroup: byGroup(added), removedByGroup: byGroup(removed), touchedByGroup: byGroup(touched),
    // `.tmp` 是 desktop 自己的原子写（写临时名再改名），按设计会闪现：不算「我们写的」。
    addedStable: added.filter((key) => !TRANSIENT_NAME.test(key)),
    removedStable: removed.filter((key) => !TRANSIENT_NAME.test(key)),
  }
}

/**
 * 一个隔离 home 的状态清单（相对路径 + 指纹）。**跳过符号联接**：临时 home 里的
 * `profiles/<name>` 是指向仓库 profile 的 junction，跟进去会把共享的 profile 树算成
 * 「两个实例各自的文件」，让「清单不相交」变成假绿（或假红）。
 */
function walkTree(root, rel = '') {
  const out = []
  const base = rel === '' ? root : join(root, rel)
  let entries
  try {
    entries = readdirSync(base, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
    if (entry.isDirectory()) out.push(...walkTree(root, childRel))
    else {
      const fp = statFingerprint(join(base, entry.name))
      out.push({ path: childRel.split(sep).join('/'), abs: join(base, entry.name), mtimeMs: fp?.mtimeMs ?? null, bytes: fp?.bytes ?? null })
    }
  }
  return out
}

/* ───────────────────────────── 对照组服务端（listen(0)，测完 close） ───────────────────────────── */

function listenOn(server, port = 0) {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolvePromise(server.address().port))
  })
}

async function closeServer(server) {
  // closeAllConnections：探针可能留着 keep-alive/半开连接，不掐掉 server.close() 的回调永远不来。
  try {
    server.closeAllConnections?.()
  } catch {
    /* 老版本 Node 没有这个方法 */
  }
  await new Promise((resolvePromise) => server.close(() => resolvePromise()))
}

/** 起一个对照组 server 占端口；返回 { server, port, close }。 */
async function startControlServer(handler) {
  const server = http.createServer(handler)
  const port = await listenOn(server)
  return { server, port, close: () => closeServer(server) }
}

/** 拿一个「刚被释放、此刻应该空闲」的端口（对照组的空闲侧）。 */
async function reserveFreePort() {
  const server = http.createServer((_req, res) => res.end(''))
  const port = await listenOn(server)
  await closeServer(server)
  return port
}

/* ───────────────────────────── 小工具 ───────────────────────────── */

function check(id, ok, detail, extra = {}) {
  return { id, ok, detail, ...extra }
}

function skipped(id, detail, hint) {
  // skipped 不是「通过」：顶层 ok=false、退出码 1，只是把「为什么没测」写清楚。
  return { id, ok: false, skipped: true, detail: `SKIPPED：${detail}`, hint }
}

/**
 * 需要 profile 的 check，在「profile 未装」时怎么呈现：
 *   默认 → `skipped:true`（显式 skip，机器能看出「这不是绿，是没测」）；
 *   `XUANSHU_REQUIRE_ASSEMBLY=1` → 直接当 FAIL（交付/CI 用：不许把「没装」降级成 skip）。
 */
function gateOnProfile(requireAssembly, id, detail, hint) {
  if (!requireAssembly) return skipped(id, detail, hint)
  return { id, ok: false, skipped: false, detail: `HARD FAIL（XUANSHU_REQUIRE_ASSEMBLY=1）：${detail}`, hint }
}

const sample = (list, limit = 12) => (list.length <= limit ? list : [...list.slice(0, limit), `…还有 ${list.length - limit} 条`])

/* ───────────────────────────── 事实采集 ───────────────────────────── */

/**
 * 一个绝对路径是不是指向已安装的 profile（package.json + node_modules 都在）。
 * 为什么这里要自己看一眼：临时 home 的 home/profile 门在启动器里判，但「要不要 skip 全部
 * 需要 profile 的 check」这个决定必须在**跑之前**做，否则会跑出一堆 exit 2 的噪声。
 */
function profileInstalledAt(profileDir) {
  return existsSync(join(profileDir, 'package.json')) && existsSync(join(profileDir, 'node_modules'))
}

/** 临时 home 的 `profiles/<name>` 该联到哪里：优先跟随已装好的那个（可能是 junction），否则仓库 `profile/`。 */
function profileTargetOf(home, profile) {
  const dir = join(home, 'profiles', profile)
  try {
    const real = realpathSync(dir)
    if (!samePath(real, dir)) return real
  } catch {
    /* 不存在或不是联接 */
  }
  return join(REPO_ROOT, 'profile')
}

/**
 * 建一个临时隔离 home：真目录 + 指向**已装 profile** 的 junction。
 * 为什么用联接而不是拷贝：profile 是整棵 pnpm 依赖树（几百 MB），拷贝既慢又会让「两个实例用的是
 * 同一份代码」这件事变得含糊。联接意味着两个实例共享**代码**、各自持有**状态**——这正是要验的东西，
 * 所以状态指纹的遍历必须跳过联接（见 walkTree）。
 */
function makeTmpHome(tmpRoot, name, profile, sourceHome) {
  const dir = join(tmpRoot, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'profiles'), { recursive: true })
  symlinkSync(profileTargetOf(sourceHome, profile), join(dir, 'profiles', profile), 'junction')
  return dir
}

/* ───────────────────────────── 主流程 ───────────────────────────── */

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`[isolation] 用法错误：${error.message}\n用法：node scripts/verify-isolation.mjs [--json] [--home <dir>] [--profile <name>] [--only <ids>] [-h]\n`)
    process.exitCode = 1
    return
  }
  if (opts.help) {
    printHelp()
    return
  }

  const startedAt = Date.now()
  const repoRoot = resolveRepoRoot(REPO_ROOT)
  const home = resolve(opts.home ?? join(repoRoot, '.dsh-home'))
  const profile = opts.profile ?? DEFAULT_PROFILE
  const realHome = join(homedir(), '.dsh')
  const requireAssembly = process.env.XUANSHU_REQUIRE_ASSEMBLY === '1'
  const installHint = `node scripts/install-profile.mjs --home "${home}"`
  const tmpRoot = join(repoRoot, TMP_REL)
  const selected = (id) => opts.only === undefined || opts.only.includes(id)

  const result = {
    ok: false,
    exitCode: 1,
    skipped: false,
    checks: {},
    report: undefined,
    reports: {},
    env: {
      repoRoot,
      home,
      profile,
      profileDir: join(home, 'profiles', profile),
      realHome,
      tmpRoot,
      desktopPort: DESKTOP_WEB_PORT,
      webPort: opts.webPort ?? DEFAULT_WEB_PORT,
      horosaPort: opts.horosaPort ?? DEFAULT_HOROSA_PORT,
      requireAssembly,
      only: opts.only ?? CHECK_IDS,
      node: process.version,
      platform: process.platform,
      checkIds: CHECK_IDS,
    },
    notes: [],
  }
  const runs = result.reports
  const notes = result.notes
  const runErrors = {}

  /** 统一的 runStartup 包装：启动器不该抛（它自己 abort 成报告），真抛了就记下来让 check 报 FAIL。 */
  const run = async (label, options) => {
    try {
      const report = await runStartup({ repoRoot, profile, timeoutMs: opts.timeoutMs, ...options })
      runs[label] = report
      return report
    } catch (error) {
      runErrors[label] = error?.message ?? String(error)
      return undefined
    }
  }

  /* I6 的「跑之前」指纹：必须在任何 spawn / 任何写盘之前采。 */
  const realHomeBefore = fingerprintRealHome(realHome)
  const doctor = await run('doctor', { mode: 'doctor', home, webPort: opts.webPort, horosaPort: opts.horosaPort, cliBin: opts.cliBin })
  result.report = doctor
  const installed = doctor?.checks?.profile?.ok === true

  if (!installed) {
    result.skipped = true
    notes.push(
      `profile "${profile}" 未装在 ${result.env.profileDir}：需要 profile 的 check（${NEEDS_PROFILE.join('、')}）已显式 skip。`
      + ` 先跑：${installHint}`
      + (requireAssembly ? '（XUANSHU_REQUIRE_ASSEMBLY=1：本次按硬失败处理）' : ''),
    )
  }

  /* ② I2 的 `--cli-bin` 优先对照：默认解析出来的那支，显式传回去必须变成 source=explicit。 */
  if (installed && selected('cli-version') && opts.cliBin === undefined && doctor?.cli?.binJs !== undefined) {
    await run('explicitCli', { mode: 'doctor', home, cliBin: doctor.cli.binJs, horosaPort: await reserveFreePort() })
  }

  /* ③ I3 的对照组：真起 node:http server 占端口 / 真拿一个空闲端口 / 故意撞 desktop 端口。 */
  if (installed && selected('web-port')) {
    const occupied = await startControlServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><body>对照组：假装是 desktop 的 web 端口</body></html>')
    })
    try {
      const horosaFree = await reserveFreePort()
      await run('webBusy', { mode: 'doctor', home, webPort: occupied.port, horosaPort: horosaFree })
      const freePort = await reserveFreePort()
      await run('webFree', { mode: 'doctor', home, webPort: freePort, horosaPort: await reserveFreePort() })
      await run('webDesktop', { mode: 'doctor', home, webPort: DESKTOP_WEB_PORT, horosaPort: await reserveFreePort() })
    } finally {
      await occupied.close()
    }
  }

  /* ④ I5/I7：两个临时 home 各真跑一次 headless；A 的指纹在 B 之前/之后各采一次（B 不许动 A）。 */
  let dual
  if (installed && (selected('dual-instance') || selected('no-crosstalk'))) {
    mkdirSync(tmpRoot, { recursive: true })
    const dirA = makeTmpHome(tmpRoot, DUAL_HOME_A, profile, home)
    const dirB = makeTmpHome(tmpRoot, DUAL_HOME_B, profile, home)
    const runA = await run('dualA', { mode: 'headless', home: dirA })
    const manifestA1 = walkTree(dirA)
    const runB = await run('dualB', { mode: 'headless', home: dirB })
    const manifestA2 = walkTree(dirA)
    const manifestB = walkTree(dirB)
    const reportFileA = runA?.instance?.reportFile ?? join(dirA, 'xuanshu', 'assembly-report.json')
    const reportFileB = runB?.instance?.reportFile ?? join(dirB, 'xuanshu', 'assembly-report.json')
    dual = {
      dirA, dirB, runA, runB,
      manifestA1, manifestA2, manifestB,
      reportA: existsSync(reportFileA) ? JSON.parse(readFileSync(reportFileA, 'utf8')) : undefined,
      reportB: existsSync(reportFileB) ? JSON.parse(readFileSync(reportFileB, 'utf8')) : undefined,
      reportFileA, reportFileB,
      // 「B 有没有动过 A」：同一棵树的两次指纹必须逐条相同。
      touchedA: diffTree(manifestA1, manifestA2),
    }
  }

  /* ⑤ I6 的「跑之后」指纹：所有 spawn 与写盘都发生完了才采。 */
  const realHomeAfter = fingerprintRealHome(realHome)
  const realHomeDiff = diffFingerprint(realHomeBefore, realHomeAfter)

  /* ───────────────────────── check: home-isolated（I1） ───────────────────────── */
  if (selected('home-isolated')) {
    const instance = doctor?.instance
    if (instance === undefined) {
      result.checks['home-isolated'] = check('home-isolated', false,
        `启动器没有给出 instance（${runErrors.doctor ?? doctor?.error ?? '未知原因'}）`,
        { hint: '先修 home 门：node scripts/isolation/startup.mjs --mode doctor --home "<dir>"' })
    } else {
      const rows = ISOLATED_PATH_KEYS.map((key) => ({ key, path: instance[key], underHome: isUnderPath(home, instance[key]) }))
      const escaped = rows.filter((row) => !row.underHome)
      const homeMatches = samePath(instance.home, home)
      const notRealHome = !samePath(instance.home, realHome) && !isUnderPath(realHome, instance.home)

      // 纯函数对照组（契约 §5 I1 指定的测法）：换一个 home，7 条路径必须两两不同。
      let alt
      let altError
      try {
        alt = resolveInstance({
          home: join(tmpRoot, ALT_HOME), profile, webPort: instance.webPort, horosaPort: instance.horosaPort,
          repoRoot, env: {},
        })
      } catch (error) {
        altError = error?.message ?? String(error)
      }
      const paired = alt === undefined ? [] : ISOLATED_PATH_KEYS.map((key) => ({
        key, primary: instance[key], alt: alt[key], distinct: !samePath(instance[key], alt[key]),
      }))
      const notDistinct = paired.filter((row) => !row.distinct)

      const ok = homeMatches && notRealHome && escaped.length === 0
        && alt !== undefined && notDistinct.length === 0
        && doctor.checks.home?.ok === true && doctor.checks.stateIsolated?.ok === true
      result.checks['home-isolated'] = check('home-isolated', ok,
        escaped.length > 0
          ? `这些派生路径跑到隔离 home 之外了：${escaped.map((row) => `${row.key}=${row.path}`).join('、')}`
          : alt === undefined
            ? `home 对照失败（resolveInstance 抛错：${altError}）`
            : notDistinct.length > 0
              ? `换 home 后这些路径没变（隔离是错觉）：${notDistinct.map((row) => row.key).join('、')}`
              : !homeMatches
                ? `报告里的 home=${instance.home} ≠ 请求的 ${home}`
                : !notRealHome
                  ? `home 撞上用户真实 DSH home：${instance.home}`
                  : `${rows.length} 条派生路径全在 ${home} 下；换 home（${alt.home}）后 ${paired.length} 条两两不同`,
        {
          hint: ok ? undefined : '这是隔离实现的问题（不是用法问题）：报给隔离启动器的维护者',
          evidence: {
            home: instance.home, requestedHome: home, realHome,
            paths: rows, alternateHome: alt?.home, pairedDistinct: paired.map((row) => [row.key, row.distinct]),
            homeCheck: doctor.checks.home?.detail, stateIsolated: doctor.checks.stateIsolated?.detail,
          },
        })
    }
  }

  /* ───────────────────────── check: profile-installed（环境门） ───────────────────────── */
  if (selected('profile-installed')) {
    if (!installed) {
      result.checks['profile-installed'] = gateOnProfile(requireAssembly, 'profile-installed',
        `profile "${profile}" 未装在 ${result.env.profileDir}（${doctor?.checks?.profile?.detail ?? runErrors.doctor ?? '启动器没跑起来'}）`
        + (requireAssembly ? '；XUANSHU_REQUIRE_ASSEMBLY=1，本次必须当硬失败' : ''),
        installHint)
    } else {
      const evidence = doctor.checks.profile.evidence ?? {}
      const ok = evidence.nodeModules === true && evidence.dshBaseVersion !== undefined
        && isUnderPath(home, result.env.profileDir)
      result.checks['profile-installed'] = check('profile-installed', ok,
        ok
          ? `profile "${profile}" 装在 ${result.env.profileDir}（@deepseek-ai/dsh-base ${evidence.dshBaseVersion}`
            + `${evidence.linkTarget === undefined ? '' : `，联接 → ${evidence.linkTarget}`}，bundles=${(evidence.bundles ?? []).join('+') || '—'}）`
          : `profile 目录结构不完整：node_modules=${evidence.nodeModules} dshBaseVersion=${evidence.dshBaseVersion} 在 home 下=${isUnderPath(home, result.env.profileDir)}`,
        { hint: ok ? undefined : installHint, evidence: { ...evidence, profileDir: result.env.profileDir } })
    }
  }

  /* ───────────────────────── check: cli-version（I2） ───────────────────────── */
  if (selected('cli-version')) {
    if (!installed) {
      result.checks['cli-version'] = gateOnProfile(requireAssembly, 'cli-version',
        `profile "${profile}" 未装 → 无从判断「CLI 来自 profile 树且版本相符」`, installHint)
    } else {
      const instance = doctor.instance
      const cli = doctor.cli ?? {}
      const explicitRun = runs.explicitCli
      const expectedSource = opts.cliBin === undefined ? 'profile node_modules' : 'explicit (--cli-bin)'
      const failed = []
      if (doctor.checks.cli?.ok !== true) failed.push(`cli 门 FAIL：${doctor.checks.cli?.detail}`)
      if (cli.source !== expectedSource) failed.push(`CLI 来源是 ${JSON.stringify(cli.source)}，期望 ${JSON.stringify(expectedSource)}`)
      if (cli.versionMatches !== true) failed.push(`versionMatches=${cli.versionMatches}（CLI v${cli.version} vs profile 的 dsh-base ${cli.wantedVersion}）`)
      if (cli.version !== cli.wantedVersion) failed.push(`CLI v${cli.version} ≠ dsh-base ${cli.wantedVersion}`)
      if (cli.binJs === undefined || !isUnderPath(instance.profileDir, cli.binJs)) {
        failed.push(`CLI 不在 profile 树里：${cli.binJs}（profileDir=${instance.profileDir}）`)
      }
      if (opts.cliBin === undefined) {
        if (explicitRun === undefined) failed.push(`--cli-bin 优先对照没跑起来：${runErrors.explicitCli ?? '未执行'}`)
        else if (explicitRun.cli?.source !== 'explicit (--cli-bin)') {
          failed.push(`显式传 --cli-bin 后 source=${JSON.stringify(explicitRun.cli?.source)}，没体现优先级`)
        } else if (explicitRun.cli?.versionMatches !== true) {
          failed.push(`显式 --cli-bin 的版本不符：v${explicitRun.cli?.version} vs ${explicitRun.cli?.wantedVersion}`)
        }
      }
      result.checks['cli-version'] = check('cli-version', failed.length === 0,
        failed.length === 0
          ? `CLI v${cli.version} 来自 ${cli.source}，与 profile 装的 dsh-base ${cli.wantedVersion} 相符；--cli-bin 可覆盖（已验优先级）`
          : failed.join('；'),
        {
          hint: failed.length === 0 ? undefined : installHint,
          evidence: {
            binJs: cli.binJs, version: cli.version, wantedVersion: cli.wantedVersion,
            source: cli.source, versionMatches: cli.versionMatches, moduleRoot: cli.moduleRoot,
            explicitSource: explicitRun?.cli?.source, rejects: cli.rejects,
          },
        })
    }
  }

  /* ───────────────────────── check: web-port（I3） ───────────────────────── */
  if (selected('web-port')) {
    if (!installed) {
      result.checks['web-port'] = gateOnProfile(requireAssembly, 'web-port',
        'profile 未装 → 启动器在环境门（exit 2）就停了，测不到「web 端口被占 → exit 3」', installHint)
    } else {
      const failed = []
      const primary = doctor
      const instance = primary.instance
      const webCheck = primary.checks.webPort
      const evidence = webCheck?.evidence ?? {}
      const expectedOk = evidence.busy !== true && evidence.port !== DESKTOP_WEB_PORT
      if (webCheck === undefined) failed.push('报告里没有 webPort 门')
      else {
        if (webCheck.ok !== expectedOk) failed.push(`webPort.ok=${webCheck.ok} 与事实（busy=${evidence.busy}）不符`)
        if (evidence.port !== instance.webPort) failed.push(`门的 evidence.port=${evidence.port} ≠ instance.webPort=${instance.webPort}`)
        if (!String(webCheck.detail).includes(String(instance.webPort))) failed.push(`detail 没有点名端口 ${instance.webPort}：${webCheck.detail}`)
        if (webCheck.ok !== true && (webCheck.hint === undefined || webCheck.hint === '')) failed.push('端口被占时 hint 为空（人不知道该改什么）')
        // I3 的核心：被占必须让启动器退出码 3（隔离门），不是 0 也不是 2。
        if (webCheck.ok !== true && primary.exitCode !== 3) failed.push(`web 端口被占但启动器 exit=${primary.exitCode}（应为 3）`)
        // 空闲侧：只有**其它门也全绿**时才能要求 exit 0 —— 否则会把别的门的问题算到端口头上。
        const othersOk = Object.entries(primary.checks ?? {}).every(([id, entry]) => id === 'webPort' || entry.ok === true)
        if (webCheck.ok === true && othersOk && primary.exitCode !== 0) failed.push(`web 端口空闲且其它门全绿，但启动器 exit=${primary.exitCode}（应为 0）`)
      }

      const cases = [
        { name: 'occupied-by-control-server', run: runs.webBusy, wantOk: false, wantExit: 3 },
        { name: 'free-port', run: runs.webFree, wantOk: true, wantExit: 0 },
        { name: 'desktop-port-19387', run: runs.webDesktop, wantOk: false, wantExit: 3 },
      ].map((item) => {
        const report = item.run
        if (report === undefined) {
          failed.push(`对照组 ${item.name} 没跑起来：${runErrors[item.name === 'occupied-by-control-server' ? 'webBusy' : item.name === 'free-port' ? 'webFree' : 'webDesktop'] ?? '未执行'}`)
          return { name: item.name, ok: false }
        }
        const entry = report.checks.webPort
        const row = {
          name: item.name, port: report.instance.webPort, verdictOk: entry?.ok, exitCode: report.exitCode,
          detail: entry?.detail, hint: entry?.hint === undefined ? undefined : String(entry.hint).split('\n')[0],
          ok: entry?.ok === item.wantOk && report.exitCode === item.wantExit,
        }
        if (!row.ok) failed.push(`对照组 ${item.name}（端口 ${row.port}）期望 ok=${item.wantOk}/exit=${item.wantExit}，实际 ok=${entry?.ok}/exit=${report.exitCode}`)
        if (item.wantOk === false && !String(entry?.detail).includes(String(row.port))) failed.push(`对照组 ${item.name} 的 detail 没点名端口 ${row.port}`)
        return row
      })

      result.checks['web-port'] = check('web-port', failed.length === 0,
        failed.length === 0
          ? `web 端口 ${instance.webPort}：${webCheck.ok ? '空闲' : '被占'}（启动器 exit ${primary.exitCode}）`
            + `；对照组三态全对（被占 exit 3、空闲 exit 0、撞 desktop ${DESKTOP_WEB_PORT} exit 3）`
          : failed.join('；'),
        {
          hint: failed.length === 0 ? undefined : `换端口：--web-port <n> 或设 ${ENV.webPort}=<n>（desktop 占 ${DESKTOP_WEB_PORT}）`,
          evidence: { requestedWebPort: opts.webPort, primary: { port: evidence.port, busy: evidence.busy, exitCode: primary.exitCode, detail: webCheck?.detail }, cases },
        })
    }
  }

  /* ───────────────────────── check: horosa-guard（I4） ───────────────────────── */
  if (selected('horosa-guard')) {
    if (!installed) {
      result.checks['horosa-guard'] = gateOnProfile(requireAssembly, 'horosa-guard',
        'profile 未装 → 启动器在环境门就被挡住，horosa 门不会被执行（探针缺失会判 exit 2）', installHint)
    } else {
      const failed = []

      // 子例 A：probe-failed（非法端口 → 守卫必须 fail-closed，而不是放行）。
      let probeFailed
      try {
        probeFailed = await checkHorosaPort({ port: INVALID_PROBE_PORT, path: HOROSA_MCP_PATH })
      } catch (error) {
        probeFailed = { verdict: `threw: ${error?.message ?? error}` }
      }
      if (probeFailed.verdict !== 'probe-failed') failed.push(`非法端口 ${INVALID_PROBE_PORT} 的判定是 ${probeFailed.verdict}（应为 probe-failed）`)
      if (probeFailed.ok !== false) failed.push(`probe-failed 时 ok=${probeFailed.ok}（必须 fail-closed）`)
      if (probeFailed.hint === undefined || probeFailed.hint === '') failed.push('probe-failed 没有给处置 hint')
      // 「无法判定」是这一态的语义（不是「被占」也不是「空闲」）：detail 必须说清 + 点名端口。
      if (!/无法/.test(String(probeFailed.detail ?? ''))) failed.push(`probe-failed 的 detail 没说清「无法判定」：${probeFailed.detail}`)
      if (!String(probeFailed.detail ?? '').includes(String(INVALID_PROBE_PORT))) failed.push(`probe-failed 的 detail 没点名端口 ${INVALID_PROBE_PORT}`)

      // 子例 B：调用方指定的端口（默认 8765）—— 四态里它落在哪一态，就得按契约给出对应的 ok/hint。
      const guard = doctor.checks.horosaGuard
      const evidence = guard?.evidence ?? {}
      const verdict = evidence.verdict
      const port = doctor.instance.horosaPort
      const VERDICTS = ['free', 'horosa-ready', 'occupied-foreign', 'probe-failed']
      if (!VERDICTS.includes(verdict)) failed.push(`horosa 门 verdict=${JSON.stringify(verdict)} 不在四态里`)
      if (evidence.port !== port) failed.push(`门的 evidence.port=${evidence.port} ≠ instance.horosaPort=${port}`)
      if (verdict === 'occupied-foreign') {
        if (guard.ok !== false) failed.push('occupied-foreign 时门却是 ok（fail-fast 失效）')
        if (!guard.hint) failed.push('occupied-foreign 没有给 hint（人不知道该腾端口还是换端口）')
        if (!String(guard.detail).includes(String(port))) failed.push(`occupied-foreign 的 detail 没点名端口 ${port}`)
      } else if (verdict === 'free' || verdict === 'horosa-ready') {
        if (guard.ok !== true) failed.push(`${verdict} 时门是 ok=false（契约 §4.5：这两态放行）`)
        if (verdict === 'free' && evidence.probe?.error !== 'ECONNREFUSED') {
          failed.push(`free 的证据不是 ECONNREFUSED（${JSON.stringify(evidence.probe?.error)}）—— 「空闲」不能靠猜`)
        }
      } else if (verdict === 'probe-failed') {
        if (guard.ok !== true) failed.push('probe-failed 让门 FAIL 了（契约 §4.5：不算被占，进 notes、ok 保持 true）')
        if (!notes.some((note) => note.includes('probe-failed'))) failed.push('probe-failed 没有进 notes（结论是 unknown，不能静默）')
      }
      if (guard === undefined) failed.push('报告里没有 horosaGuard 门')

      result.checks['horosa-guard'] = check('horosa-guard', failed.length === 0,
        failed.length === 0
          ? `127.0.0.1:${port} 判定 ${verdict}（门 ok=${guard.ok}）；probe-failed 子例（非法端口 ${INVALID_PROBE_PORT}）fail-closed 正确`
          : failed.join('；'),
        {
          hint: failed.length === 0 ? undefined : '这是守卫/启动器的判断错了（不是用法问题）：把 detail 与 evidence 一起报给维护者',
          evidence: {
            requestedHorosaPort: opts.horosaPort, verdict, port, gate: { ok: guard?.ok, detail: guard?.detail, hint: guard?.hint?.split('\n')[0] },
            probe: evidence.probe, probeFailed: { verdict: probeFailed.verdict, ok: probeFailed.ok, detail: probeFailed.detail, evidence: probeFailed.evidence },
          },
        })
    }
  }

  /* ───────────────────────── check: dual-instance（I5） ───────────────────────── */
  if (selected('dual-instance')) {
    if (!installed || dual === undefined) {
      result.checks['dual-instance'] = gateOnProfile(requireAssembly, 'dual-instance',
        installed ? '两个临时 home 没跑起来' : 'profile 未装 → headless 真跑不可能成功', installHint)
    } else {
      const failed = []
      const rows = []
      for (const [name, dir, report, reportFile] of [
        ['A', dual.dirA, dual.runA, dual.reportFileA],
        ['B', dual.dirB, dual.runB, dual.reportFileB],
      ]) {
        const row = { name, home: dir }
        if (report === undefined) {
          failed.push(`${name} 的 headless 没跑起来：${runErrors[`dual${name}`] ?? '未执行'}`)
          rows.push(row)
          continue
        }
        const spawnReport = report.spawn?.report ?? {}
        row.exitCode = report.exitCode
        row.spawnExit = report.spawn?.exitCode
        row.fresh = spawnReport.fresh
        row.reportFile = reportFile
        row.underHome = isUnderPath(dir, reportFile)
        row.stateIsolated = report.checks.stateIsolated?.ok
        row.reportSchema = spawnReport.schema
        row.reportOk = spawnReport.assemblyOk
        // I5 的「各自 sessions/storages 落在自己 home 下」：路径取自 CLI 可见的 instance，
        // 存在与否单独记（`dsh --help` 不建会话，所以不要求它们出现，只要求「在就必在自家」）。
        row.generatedAt = spawnReport.generatedAt
        row.stateDirs = ['sessionsDir', 'storagesDir'].map((key) => ({
          key, path: report.instance?.[key], underHome: isUnderPath(dir, report.instance?.[key] ?? ''), exists: existsSync(report.instance?.[key] ?? join(dir, '__none__')),
        }))
        const assembly = name === 'A' ? dual.reportA : dual.reportB
        row.assemblyHome = assembly?.profile?.dshHome
        row.assemblyGeneratedAt = assembly?.generatedAt
        if (report.exitCode !== 0) failed.push(`${name} headless exit=${report.exitCode}（${report.error ?? report.checks.home?.detail ?? ''}）`)
        if (spawnReport.fresh !== true) failed.push(`${name} 的 assembly-report.json 不是本次新写出（mtime 没前进）`)
        if (!row.underHome) failed.push(`${name} 的报告没有落在自己的 home 下：${reportFile}`)
        if (spawnReport.schema !== 'xuanshu/assembly-report@1') failed.push(`${name} 报告 schema=${JSON.stringify(spawnReport.schema)}`)
        if (spawnReport.assemblyOk !== true) failed.push(`${name} 报告 ok=${JSON.stringify(spawnReport.assemblyOk)}`)
        if (assembly === undefined) failed.push(`${name} 的 assembly-report.json 读不出来`)
        else if (!samePath(assembly.profile?.dshHome ?? '', dir)) failed.push(`${name} 报告里的 dshHome=${assembly.profile?.dshHome} ≠ ${dir}`)
        if (report.checks.stateIsolated?.ok !== true) failed.push(`${name} 的 stateIsolated 门 FAIL`)
        rows.push(row)
      }
      if (samePath(dual.dirA, dual.dirB)) failed.push('两个实例用了同一个 home（那就没在测隔离）')
      const pathsA = new Set(dual.manifestA1.map((row) => row.abs.toLowerCase()))
      const overlap = dual.manifestB.filter((row) => pathsA.has(row.abs.toLowerCase())).map((row) => row.abs)
      if (overlap.length > 0) failed.push(`两份文件清单相交：${sample(overlap, 4).join('、')}`)
      const hasReport = (manifest) => manifest.some((row) => row.path === 'xuanshu/assembly-report.json')
      if (!hasReport(dual.manifestA1)) failed.push('A 的 home 里没有 xuanshu/assembly-report.json')
      if (!hasReport(dual.manifestB)) failed.push('B 的 home 里没有 xuanshu/assembly-report.json')
      // 两次真跑必须各自生成报告：generatedAt 相同就意味着第二次只是在读第一次的产物。
      const [rowA, rowB] = rows
      if (rowA?.generatedAt !== undefined && rowA.generatedAt === rowB?.generatedAt) {
        failed.push(`两次 headless 的装配报告 generatedAt 相同（${rowA.generatedAt}）：第二次没真跑`)
      }
      for (const row of rows) {
        for (const dir of row.stateDirs ?? []) {
          if (dir.underHome !== true) failed.push(`${row.name} 的 ${dir.key} 跑到自己的 home 之外：${dir.path}`)
        }
      }

      result.checks['dual-instance'] = check('dual-instance', failed.length === 0,
        failed.length === 0
          ? `两个隔离 home 各真跑一次 headless 均 exit 0 且本次新写出各自报告；清单 A=${dual.manifestA1.length} 项 / B=${dual.manifestB.length} 项，不相交`
          : failed.join('；'),
        {
          hint: failed.length === 0 ? undefined : `加 --keep-tmp 重跑以保留现场；临时 home：${dual.dirA} 与 ${dual.dirB}`,
          evidence: {
            homes: rows,
            manifestA: dual.manifestA1.map((row) => row.path),
            manifestB: dual.manifestB.map((row) => row.path),
            overlap,
            // 两个实例共享的是**代码**（profiles/xuanshu 联接到仓库 profile），状态必须各归各的。
            sharedProfileLink: 'profiles/<name> → 仓库 profile（只共享代码，不共享状态）',
          },
        })
    }
  }

  /* ───────────────────────── check: no-crosstalk（I5 + I7） ───────────────────────── */
  if (selected('no-crosstalk')) {
    if (!installed || dual === undefined) {
      result.checks['no-crosstalk'] = gateOnProfile(requireAssembly, 'no-crosstalk',
        installed ? '两个临时 home 没跑起来' : 'profile 未装 → 无法真跑双实例', installHint)
    } else {
      const failed = []
      const touched = dual.touchedA
      if (touched.length > 0) {
        failed.push(`B 跑完之后 A 的状态被动了：${sample(touched.map((row) => `${row.path}(${row.reason})`), 6).join('、')}`)
      }
      const webPorts = [dual.runA?.instance?.webPort, dual.runB?.instance?.webPort, doctor?.instance?.webPort]
        .filter((port) => port !== undefined)
      if (webPorts.some((port) => port === DESKTOP_WEB_PORT)) failed.push(`有实例计划绑 desktop 的 ${DESKTOP_WEB_PORT}`)
      for (const [name, report] of [['A', dual.runA], ['B', dual.runB]]) {
        if (report === undefined) continue
        if (String(report.instance?.webPort) === String(DESKTOP_WEB_PORT)) failed.push(`${name} 的 webPort 就是 ${DESKTOP_WEB_PORT}`)
        if (String(report.plan?.env?.[ENV.webPort] ?? '') === String(DESKTOP_WEB_PORT)) failed.push(`${name} 的 plan.env.${ENV.webPort} 就是 ${DESKTOP_WEB_PORT}`)
        if ((report.plan?.command ?? []).some((token) => String(token).includes(String(DESKTOP_WEB_PORT)))) {
          failed.push(`${name} 的计划命令行里出现了 ${DESKTOP_WEB_PORT}`)
        }
        if (!samePath(report.instance?.home ?? '', name === 'A' ? dual.dirA : dual.dirB)) {
          failed.push(`${name} 报告的 home=${report.instance?.home} 与自己的临时 home 不符`)
        }
      }
      const primaryInstance = doctor?.instance
      const desktopBusy = doctor?.checks?.webPort?.evidence?.desktopBusy
      if (primaryInstance !== undefined && primaryInstance.webPort === DESKTOP_WEB_PORT) failed.push('默认实例的 webPort 撞上 desktop 端口')

      result.checks['no-crosstalk'] = check('no-crosstalk', failed.length === 0,
        failed.length === 0
          ? `B 跑完后 A 的 ${dual.manifestA1.length} 项状态指纹逐条未变；两份清单 0 相交；`
            + `三个实例的 web 端口 ${webPorts.join('/')} 都 ≠ desktop 的 ${DESKTOP_WEB_PORT}`
            + `（desktop ${desktopBusy === true ? '正在跑' : '没在跑'}，与我们无关）`
          : failed.join('；'),
        {
          hint: failed.length === 0 ? undefined : `加 --keep-tmp 重跑以保留现场；临时 home：${dual.dirA} 与 ${dual.dirB}`,
          evidence: {
            stateFingerprintA: { before: dual.manifestA1.length, after: dual.manifestA2.length, changed: touched },
            webPorts: { A: dual.runA?.instance?.webPort, B: dual.runB?.instance?.webPort, primary: primaryInstance?.webPort, desktop: DESKTOP_WEB_PORT },
            desktopBusy,
            planCommandPrimary: doctor?.plan?.command,
          },
        })
    }
  }

  /* ───────────────────────── check: no-real-home-write（I6） ───────────────────────── */
  if (selected('no-real-home-write')) {
    const failed = []
    const leaked = Object.entries(runs)
      .filter(([, report]) => typeof report?.instance?.home === 'string')
      .filter(([, report]) => samePath(report.instance.home, realHome) || isUnderPath(realHome, report.instance.home))
      .map(([label, report]) => `${label}=${report.instance.home}`)
    if (leaked.length > 0) failed.push(`有运行把家安在真实 home 上：${leaked.join('、')}`)
    if (realHomeDiff.addedStable.length > 0) failed.push(`真实 home 多出了条目：${sample(realHomeDiff.addedStable).join('、')}`)
    if (realHomeDiff.removedStable.length > 0) failed.push(`真实 home 少了条目：${sample(realHomeDiff.removedStable).join('、')}`)
    if (existsSync(join(realHome, 'xuanshu'))) failed.push(`真实 home 里出现了 xuanshu/ 数据目录：${join(realHome, 'xuanshu')}`)

    const total = Object.keys(realHomeBefore.rows).length
    const concurrent = realHomeDiff.touched.length
    result.checks['no-real-home-write'] = check('no-real-home-write', failed.length === 0,
      failed.length === 0
        ? `真实 home ${realHome}：${total} 个指纹条目**无新增无删除**`
          + (concurrent === 0
            ? '；mtime/size 逐条未变（强证据）'
            : `；${concurrent} 个既有条目的 mtime/size 变了（本机 desktop 会话在并发写，指纹法无法归因——本次所有运行的 home 都是隔离 home）`)
        : failed.join('；'),
      {
        hint: failed.length === 0 ? undefined : '别对真实 home 做任何清洗：先在隔离 home 上复现，再把这一项报给维护者',
        evidence: {
          realHome,
          entries: total,
          groups: {
            top: Object.keys(realHomeBefore.rows).filter((key) => !key.includes('/')).length,
            sessions: Object.keys(realHomeBefore.rows).filter((key) => key.startsWith('sessions/')).length,
            storages: Object.keys(realHomeBefore.rows).filter((key) => key.startsWith('storages/')).length,
          },
          added: realHomeDiff.added, removed: realHomeDiff.removed,
          addedStable: realHomeDiff.addedStable, removedStable: realHomeDiff.removedStable,
          touched: sample(realHomeDiff.touched, 12), touchedCount: realHomeDiff.touched.length,
          touchedByGroup: realHomeDiff.touchedByGroup,
          xuanshuDirExists: existsSync(join(realHome, 'xuanshu')),
          runsHomes: Object.fromEntries(Object.entries(runs).map(([label, report]) => [label, report?.instance?.home])),
          note: '指纹只读：readdir + stat，不创建/删除真实 home 里任何东西',
        },
      })
  }

  /* ───────────────────────── 收尾 ───────────────────────── */

  // 临时 home 清理：绿了就删干净（证据早已进 JSON），红了就留现场给人查（或显式 --keep-tmp）。
  const dualChecksOk = ['dual-instance', 'no-crosstalk']
    .every((id) => result.checks[id] === undefined || result.checks[id].ok === true)
  if (dual !== undefined && (opts.keepTmp === true || !dualChecksOk)) {
    notes.push(
      `保留了临时 home 供排查（${opts.keepTmp === true ? '--keep-tmp' : '有 FAIL 的 check'}）：${dual.dirA} 与 ${dual.dirB}`
      + '；它们都在 tests/**/.tmp/ 下（已 gitignore），确认完自己删掉即可。',
    )
  } else if (dual !== undefined) {
    for (const dir of [dual.dirA, dual.dirB]) {
      // 先显式摘掉 junction 再递归删：确认过 rmSync 不跟随联接，但少一次「跟随」的机会总是好的。
      try {
        rmSync(join(dir, 'profiles', profile), { force: true })
      } catch {
        /* 联接可能已不在 */
      }
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch (error) {
        notes.push(`临时 home 没删干净（${dir}）：${error?.message ?? error}`)
      }
    }
  }

  const selectedIds = CHECK_IDS.filter(selected)
  const ran = selectedIds.map((id) => result.checks[id]).filter(Boolean)
  const skippedIds = ran.filter((entry) => entry.skipped === true).map((entry) => entry.id)
  result.ok = ran.length === selectedIds.length && ran.every((entry) => entry.ok === true) && skippedIds.length === 0
  result.exitCode = result.ok ? 0 : 1
  result.skipped = skippedIds.length > 0
  result.skippedIds = skippedIds
  result.durationMs = Date.now() - startedAt
  result.checkedIds = selectedIds
  result.assertions = {
    I1: 'home-isolated', I2: 'cli-version', I3: 'web-port', I4: 'horosa-guard',
    I5: 'dual-instance + no-crosstalk', I6: 'no-real-home-write', I7: 'no-crosstalk',
  }
  if (result.skipped) notes.push(`有 ${skippedIds.length} 个 check 被 skip（${skippedIds.join('、')}）：这不是绿，是没测。修法：${installHint}`)

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
  } else {
    process.stdout.write(`${humanReport(result, opts)}\n`)
  }
  process.exitCode = result.exitCode
}

/** 两棵树的指纹差：只用于「B 有没有动 A」。 */
function diffTree(before, after) {
  const map = new Map(before.map((row) => [row.path, row]))
  const out = []
  for (const row of after) {
    const prev = map.get(row.path)
    if (prev === undefined) out.push({ path: row.path, reason: 'added' })
    else if (prev.mtimeMs !== row.mtimeMs || prev.bytes !== row.bytes) out.push({ path: row.path, reason: `mtime ${prev.mtimeMs}→${row.mtimeMs} bytes ${prev.bytes}→${row.bytes}` })
  }
  const afterPaths = new Set(after.map((row) => row.path))
  for (const row of before) if (!afterPaths.has(row.path)) out.push({ path: row.path, reason: 'removed' })
  return out
}

function humanReport(result, opts) {
  const lines = []
  lines.push(`玄枢隔离验收台  profile=${result.env.profile}  home=${result.env.home}`)
  lines.push(`  真实 home  ${result.env.realHome}（只读指纹）`)
  lines.push(`  desktop    ${result.env.desktopPort}   tmp ${relative(REPO_ROOT, result.env.tmpRoot).split(sep).join('/')}/`)
  lines.push('')
  for (const id of result.checkedIds) {
    const entry = result.checks[id]
    if (entry === undefined) continue
    const status = entry.skipped === true ? 'SKIP' : entry.ok ? 'PASS' : 'FAIL'
    lines.push(`[${id}] ${status}  ${entry.detail}`)
    if (entry.hint !== undefined) lines.push(`      → ${String(entry.hint).split('\n')[0]}`)
  }
  const passed = result.checkedIds.filter((id) => result.checks[id]?.ok === true).length
  lines.push('')
  lines.push(`结果：${passed}/${result.checkedIds.length} 通过，exit ${result.exitCode}（${result.durationMs}ms）`)
  for (const note of result.notes) lines.push(`note: ${note}`)
  const doctor = result.report
  if (doctor?.exitCode !== undefined) {
    lines.push(`启动器报告：mode=${doctor.mode} exit=${doctor.exitCode} ok=${doctor.ok}`)
    for (const [id, entry] of Object.entries(doctor.checks ?? {})) lines.push(`  启动器[${id}] ${entry.ok ? 'PASS' : 'FAIL'}  ${entry.detail}`)
  }
  if (opts.only !== undefined) lines.push(`（--only ${opts.only.join(',')}：只跑了这些 check）`)
  return lines.join('\n')
}

/** 只有作为 CLI 直接跑时才执行；被 import 时只导出纯函数（供将来复用，测试不依赖它）。 */
const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (invokedDirectly) await main()
