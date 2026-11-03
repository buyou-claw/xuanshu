#!/usr/bin/env node
/**
 * `scripts/experience/probe-env.mjs` —— **实操评估的执行环境就绪探测**（Spec 04 · 票据 #74）。
 *
 * 一条命令回答「这台机器现在能不能跑实操评估」，并把答案写成**可机读的环境快照**。
 * 它不装任何东西、不改任何依赖、不下载 Chromium、不写真实 home。
 *
 * 为什么先要有这条探测（ADR-0017 · 计划 §9.2 第 2 条）：
 *   实操评估产出的是「发现」，而**环境缺失会被误记成产品缺陷**。没有一份诚实的环境事实，
 *   后面每一条发现的归属都靠猜——到底是「界面不好用」还是「这台机器根本没起浏览器」。
 *
 * 两条不能合并的判断（票据 #74 验收标准 2）：
 *   - `playwright.resolved`：按目录探到了 playwright 句柄。**这只说明模块在磁盘上。**
 *   - `launch.launched`：真的用它拉起过 `channel: 'msedge'` 的无头实例、开过一个页面、并关掉了。
 *   历史事故都是同一个形状：`require()` 成功被报成「环境就绪」，于是整轮评估红在启动那一步，
 *   看起来像产品的错。这里用两个独立字段把它钉死：**前者永远不构成后者。**
 *
 * 仅使用 Node 内置模块；playwright 由宿主环境提供（照 `scripts/ux/collect/browser.mjs`
 * 的 `resolvePlaywright()` 候选目录口径，本仓不装它，也不许加依赖）。ESM。
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, basename, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { sanitizeUrl } from './evidence.mjs'

/**
 * 退出码口径（写死在 `--help` 与本文档注释里，别再按「0/1」理解）：
 *   - `0` = 就绪：解析到句柄**且**真的启动成功。
 *   - `2` = 缺件不可用：没探到 playwright 模块，或没找到系统 Edge。**属环境缺前置。**
 *   - `3` = 启动被拒：模块与浏览器都在，但无头实例起不来 / 起得来但开页面失败。
 *   - `4` = 没验到启动：`--no-launch` 只解析没启动。**「没验」与「验了但红」是两件事**
 *     （本仓在 `check-test-inventory.mjs` 里就是这条纪律），拿 3 冒充 4 等于凭空造一条发现。
 *   - `5` = 探测自身没跑成（参数错、写盘失败）；与「环境不可用」也不是一回事。
 *   为什么非得分开：`2` 的下一步是「补环境（且明确不下载 Chromium）」，`3` 是「查 Edge 进程 /
 *   沙箱 / channel 报错」，`4` 是「再跑一次不带 --no-launch 的」——三类问题的处置完全不同。
 *   票据口径只承诺「可用 = 0 / 不可用 = 非 0，且区分缺模块、缺浏览器、启动被拒」：
 *   前三条是它的硬要求，`4`/`5` 是本命令把「没验」和「自己的错」也分出去的加法。
 */
export const EXIT = Object.freeze({
  ready: 0,
  missing: 2,
  launchRejected: 3,
  notAttempted: 4,
  probeFailed: 5,
})

/** 不可用原因的闭集：快照与退出码按同一份词表对应，避免出现第二套口径。 */
export const REASONS = Object.freeze({
  ready: 'ready',
  noPlaywright: 'no-playwright',
  noEdge: 'no-edge',
  launchRejected: 'launch-rejected',
  /** 只解析没启动（`--no-launch`）。它与「试了但被拒」必须分开：前者没资格谈启动。 */
  notAttempted: 'not-attempted',
})

/** `launch.next`：Edge 起不来时的处置口径（计划 §9.2 第 2 条：不默认下载 Chromium）。 */
const NEXT_LAUNCH_REJECTED = '记录准确报错后修复浏览器环境（Edge 安装 / channel msedge）；不下载 Chromium'

/**
 * 两类缺件是两种处置，所以 `next` 各写各的（糊成一句「环境不可用」就等于没给下一步）。
 * 计划 §9.2 第 2 条：Playwright 解析失败先查现有局部/全局安装，**确实缺失才安装并记录版本**；
 * Edge 起不来则修浏览器环境——两条都不承诺本命令会替你装任何东西。
 */
const NEXT_NO_PLAYWRIGHT = '先查现有局部/全局安装（%APPDATA%\\npm\\node_modules\\playwright 与 %LOCALAPPDATA%\\pnpm\\global\\5\\node_modules\\playwright）；确实缺失才自行安装并记录所用版本；不下载 Chromium'
const NEXT_NO_EDGE = '安装或修复系统 Edge（本线只用 channel msedge 的系统浏览器）；不下载 Chromium'

/**
 * 凭据参数表只有**一份真源**：`evidence.mjs` 的 `SENSITIVE_URL_PARAMS` + `sanitizeUrl`。
 *
 * 本模块原先自带一份 `SECRET_QUERY_KEYS`，理由是「#74 要零前置、单独可跑」；两处没有对拍，
 * 实测已经分化——`redact('…#token=ABC123')` 原样留下，而 `sanitizeUrl` 会脱成 `<redacted>`。
 * 环境探测的细节与证据包必须同一口径：两处各改各的，漏掉的那一边永远没人知道。
 * 现在直接复用 `sanitizeUrl`（`?` / `&` / `#` 与大小写变体同一套规则），删掉本模块的副本。
 */

/**
 * 绝对路径（Windows 盘符 / POSIX 常见根）——快照是入库口径的机器事实，不带本机路径。
 * 盘符那条带 `(?![\\/])`：否则 `http://` 里的 `p:/` 也会被当成「盘符路径」，
 * 把整条 URL 吃掉——那样连「哪里错了」都读不出来了，脱敏不能脱到没证据。
 */
const WINDOWS_PATH_PATTERN = /[A-Za-z]:[\\/](?![\\/])[^\s"'`,;)<>\u4e00-\u9fff]*/gu
const POSIX_PATH_PATTERN = /\/(?:Users|home|opt|var|root)\/[^\s"'`,;)<>\u4e00-\u9fff]*/gu

/**
 * 脱敏一段外部文本（浏览器报错、启动器输出都可能含凭据与本机绝对路径）。
 * 只替换敏感片段，**保留可读骨架**——把整条消息抹成 `redacted` 等于没给原因。
 *
 * 凭据部分直接调 `sanitizeUrl`（与证据包同一个函数、同一份参数表）：`?token=` / `&token=` /
 * `#token=` 与大小写变体都按同一套规则脱，不再由本模块维护第二份正则。
 * @param {string} text
 * @returns {string}
 */
export function redact(text) {
  const raw = String(text ?? '')
  const pathsHidden = raw.replace(WINDOWS_PATH_PATTERN, '<path>').replace(POSIX_PATH_PATTERN, '<path>')
  const secretsHidden = sanitizeUrl(pathsHidden)
  // 压成单行并限长：多行堆栈既难比较又常含内部路径（与计划「不留堆栈与完整请求头」同口径）。
  return secretsHidden.replace(/\s+/gu, ' ').trim().slice(0, 240)
}

/**
 * 探测一次执行环境。依赖全部**注入**，本函数不碰文件系统、不起浏览器——
 * 这是「不可用路径不依赖本机真实安装」的实现前提（验收标准 5）。
 *
 * @param {{resolvePlaywright: () => {handle: object|null, version?: string|null, source?: string|null},
 *          readEdge: () => {found: boolean, version?: string|null, source?: string|null},
 *          launchHeadless: (handle: object) => Promise<string|null>,
 *          now?: () => string}} deps `now` 给了才往快照里写时间戳（默认不写：时钟一进报告，
 *          前后两份就没法逐项比——与证据记录器同一条理由）
 * @returns {Promise<{snapshot: object, exitCode: number}>}
 */
export async function probeEnvironment(deps) {
  const resolved = deps.resolvePlaywright()
  const edge = deps.readEdge()

  const snapshot = {
    schema: 1,
    ready: false,
    reason: null,
    exitCode: EXIT.probeFailed,
    playwright: {
      resolved: Boolean(resolved.handle),
      version: resolved.version ?? null,
      source: resolved.source ?? null,
      next: null,
    },
    edge: {
      found: Boolean(edge.found),
      version: edge.version ?? null,
      source: edge.source ?? null,
      next: null,
    },
    launch: { launched: false, reason: null, detail: null, next: null, browserVersion: null },
  }
  if (deps.now !== undefined) snapshot.generatedAt = deps.now()

  const finish = (exitCode) => {
    // 退出码也进快照：证据包里的 `environment.json` 单独被读走时，不必回头查进程。
    snapshot.exitCode = exitCode
    return { snapshot, exitCode }
  }

  if (!snapshot.playwright.resolved) {
    snapshot.reason = REASONS.noPlaywright
    snapshot.playwright.next = NEXT_NO_PLAYWRIGHT
    return finish(EXIT.missing)
  }
  if (!snapshot.edge.found) {
    snapshot.reason = REASONS.noEdge
    snapshot.edge.next = NEXT_NO_EDGE
    return finish(EXIT.missing)
  }
  if (typeof deps.launchHeadless !== 'function') {
    // 没启动 ≠ 启动被拒。这一支存在的理由：`--no-launch` 时若照报 3，读的人以为
    // 「这台机器起不来 Edge」，而那件事本轮根本没验——把「没验」报成「验了但红」是最坏的一种谎。
    snapshot.reason = REASONS.notAttempted
    snapshot.launch.reason = REASONS.notAttempted
    snapshot.launch.next = '本轮没试启动：去掉 --no-launch 再跑一次才会真启动；不得据此认为 Edge 可用或不可用'
    return finish(EXIT.notAttempted)
  }

  // 真启动：这是独立于「解析到句柄」的第二判断项。
  try {
    snapshot.launch.browserVersion = await deps.launchHeadless(resolved.handle)
    snapshot.launch.launched = true
    snapshot.ready = true
    snapshot.reason = REASONS.ready
    return finish(EXIT.ready)
  } catch (error) {
    snapshot.launch.reason = REASONS.launchRejected
    // 外部报错一律先脱敏再入快照（playwright 的报错里常年带本机绝对路径与 URL）。
    snapshot.launch.detail = redact(error?.message ?? error)
    snapshot.launch.next = NEXT_LAUNCH_REJECTED
    snapshot.reason = REASONS.launchRejected
    return finish(EXIT.launchRejected)
  }
}

// ── 默认适配器（真机器用的那一份） ────────────────────────────────────────────
// 上面那个函数是**判断**，这里是**取材**。分开是为了让不可用路径能在任何机器上测（验收标准 5）。

/** playwright 的候选目录：照 `scripts/ux/collect/browser.mjs::resolvePlaywright()` 的口径。 */
const PLAYWRIGHT_CANDIDATES = [
  { specifier: 'playwright', label: 'node-path' },
  { specifier: join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'playwright'), label: 'npm-global' },
  { specifier: join(process.env.LOCALAPPDATA ?? '', 'pnpm', 'global', '5', 'node_modules', 'playwright'), label: 'pnpm-global' },
]

/** Edge 的安装根候选（Windows）。找到 `Microsoft/Edge/Application/msedge.exe` 即算装了。 */
const EDGE_ROOTS = [
  { dir: join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft', 'Edge', 'Application'), label: 'ProgramFiles(x86)' },
  { dir: join(process.env['PROGRAMFILES'] ?? '', 'Microsoft', 'Edge', 'Application'), label: 'ProgramFiles' },
  { dir: join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'Application'), label: 'LocalAppData' },
]

/** 版号目录形状：Edge 把 `156.0.4314.58/` 放在 `Application/` 旁边，这就是版本的权威落点。 */
const EDGE_VERSION_DIR = /^\d+\.\d+\.\d+\.\d+$/u

/**
 * 解析宿主环境里的 playwright。返回的 `source` 是**标签**不是路径（快照不泄漏仓库外绝对路径）。
 * @returns {{handle: object|null, version: string|null, source: string|null}}
 */
export function defaultResolvePlaywright() {
  const require = createRequire(import.meta.url)
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    if (candidate.specifier === '') continue
    let handle
    try {
      handle = require(candidate.specifier)
    } catch {
      continue // 下一个候选目录
    }
    let version = null
    try {
      version = require(join(candidate.specifier, 'package.json'))?.version ?? null
    } catch {
      /* 读不到 package.json 就写 null：宁缺毋假 */
    }
    return { handle, version: typeof version === 'string' ? version : null, source: candidate.label }
  }
  return { handle: null, version: null, source: null }
}

/** 版号目录段 → 数字数组，供数值比较（字典序会让 `9.x` 压过 `156.x`）。 */
function versionParts(version) {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0)
}

/** 按段做数值降序比较。 */
function compareVersions(left, right) {
  const a = versionParts(left)
  const b = versionParts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (b[index] ?? 0) - (a[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * 读系统 Edge：靠**目录里那个版号目录**，不执行 `msedge.exe --version`。
 * 为什么：启动浏览器二进制去问版本，等于用「能不能跑」证明「装没装」——那正是本票要拆开的两件事；
 * 而且它可能拉起真实用户实例、碰到日常 profile（验收标准 4「不写真实 home」）。
 * @returns {{found: boolean, version: string|null, source: string|null}}
 */
export function defaultReadEdge() {
  for (const root of EDGE_ROOTS) {
    if (root.dir === '' || !existsSync(join(root.dir, 'msedge.exe'))) continue
    let version = null
    try {
      version = readdirSync(root.dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && EDGE_VERSION_DIR.test(entry.name))
        .map((entry) => entry.name)
        // 数值降序取第一个：Edge 升级期 `Application/` 旁边会同时躺着新旧两个版号目录，
        // 字典序会把 `9.0.0.1` 报成比 `156.0.4314.58` 更新，于是环境快照里的版本号是错的。
        .sort(compareVersions)
        .at(0) ?? null
    } catch {
      version = null
    }
    return { found: true, version, source: root.label }
  }
  return { found: false, version: null, source: null }
}

/** 真启动的时限（毫秒）。超时算「启动被拒」：它不是缺件，查的是进程/沙箱那一侧。 */
const LAUNCH_TIMEOUT_MS = 60_000

/**
 * **真的**启动一次无头 Edge：launch → 开一个页面 → 关掉。返回浏览器自报的版本。
 *
 * 这条是 `launched` 的唯一来源：`require()` 成功不构成它，页面真开过才算。
 * 用 playwright 自己的临时 user-data-dir，不碰 `.experience-home`、更不碰日常 home。
 *
 * @param {object} handle 解析到的 playwright 句柄
 * @param {{timeoutMs?: number}} [options] 时限可注入，是为了让「超时」这一支能被测试钉住
 *        （不能为了测它真等 60 秒）
 * @returns {Promise<string|null>}
 */
export async function defaultLaunchHeadless(handle, { timeoutMs = LAUNCH_TIMEOUT_MS } = {}) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`启动无头实例超时（${timeoutMs}ms）`)), timeoutMs)
  })
  const run = (async () => {
    const browser = await handle.chromium.launch({ channel: 'msedge', headless: true })
    try {
      const version = typeof browser.version === 'function' ? browser.version() : null
      const page = await browser.newPage()
      await page.close()
      return version
    } finally {
      // 关不掉也要把原始错误抛出去：半途而废的实例不该让探测改报成另一种原因。
      await browser.close()
    }
  })()
  try {
    return await Promise.race([run, timeout])
  } finally {
    // 时限到了也必须把定时器摘掉：`Promise.race` 给两支都挂了 handler，所以「输掉的一支」
    // 不会变成未处理拒绝，但**那个 setTimeout 还挂在事件循环上**——它稍后照样会 reject 一次，
    // 而那时已经没人接。用例清单门把未处理错误单独算一条红（`check-test-inventory.mjs` 判据 5），
    // 于是可能出现「本机绿、全量跑红」。摘掉它，超时这一支就是确定的一次性事件。
    clearTimeout(timer)
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const HELP = `用法：node scripts/experience/probe-env.mjs [--json] [--out <file>] [--with-timestamp] [--no-launch] [--help]
  --json            把机读快照（JSON）打到 stdout；默认只给人看一行结论
  --out <file>      把快照写成 JSON 文件（绝对/相对都可，相对路径按当前目录算），供证据包的 environment.json 用
  --with-timestamp  往快照里加 generatedAt；默认不加（时钟一进报告，前后两份就没法逐项比）
  --no-launch       只解析不启动，用于「先看缺件、后验启动」的排查。代价：启动这一项本轮**没验**（退出码 4）
退出码：0 = 就绪（解析到句柄**且**真的启动成功）
        2 = 缺件不可用（缺 playwright 模块 / 缺系统 Edge）→ 按快照里的 next 补环境，不下载 Chromium
        3 = 启动被拒（模块与 Edge 都在，但无头实例起不来或开页面失败）→ 查 Edge 进程 / channel msedge / 沙箱
        4 = 本轮没验启动（--no-launch 只解析）→ 不得据此认为 Edge 可用或不可用
        5 = 探测自身没跑成（参数错、写盘失败）；与「环境不可用」是两件事
本命令不安装任何包、不下载 Chromium、不写真实 home；只用系统 Edge（channel msedge）的无头实例。`

/** @param {string[]} argv @returns {{json: boolean, out?: string, timestamp: boolean, launch: boolean, help: boolean}} */
export function parseArgs(argv) {
  const opts = { json: false, timestamp: false, launch: true, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') opts.json = true
    else if (arg === '--with-timestamp') opts.timestamp = true
    else if (arg === '--no-launch') opts.launch = false
    else if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg === '--out') {
      opts.out = argv[++index]
      if (opts.out === undefined) throw new Error('--out 需要一个文件路径')
    } else throw new Error(`未知参数：${arg}（用法见 --help）`)
  }
  return opts
}

/**
 * CLI 主体。@param {string[]} argv @param {{log?, error?, deps?}} [io]
 * @returns {Promise<number>} 退出码
 */
export async function main(argv = process.argv.slice(2), io = {}) {
  const log = io.log ?? ((line) => console.log(line))
  let opts
  try {
    opts = parseArgs(argv)
  } catch (error) {
    console.error(`[probe-env] ${error.message}`)
    return EXIT.probeFailed
  }
  if (opts.help) {
    log(HELP)
    return EXIT.ready
  }
  const deps = io.deps ?? {
    resolvePlaywright: defaultResolvePlaywright,
    readEdge: defaultReadEdge,
    // `--no-launch` 表达成「没有启动器」而不是「启动器抛错」：抛错会被判成启动被拒（3），
    // 而本轮压根没试，那是一条凭空造出来的发现。
    ...(opts.launch ? { launchHeadless: defaultLaunchHeadless } : {}),
    ...(opts.timestamp ? { now: () => new Date().toISOString() } : {}),
  }
  const { snapshot, exitCode } = await probeEnvironment(deps)
  if (opts.out !== undefined) {
    const target = resolve(opts.out)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  }
  if (opts.json) log(JSON.stringify(snapshot, null, 2))
  else log(describe(snapshot))
  if (opts.out !== undefined && !opts.json) log(`[probe-env] 快照：${displayOut(opts.out)}`)
  return exitCode
}

/** 快照的一行人类结论（不含绝对路径）。 */
function describe(snapshot) {
  // 三种说法而不是两种：把「没验」说成「不可用」，与把它说成「就绪」是同一种谎的反面。
  const head = snapshot.ready
    ? '[probe-env] 就绪'
    : snapshot.reason === REASONS.notAttempted
      ? '[probe-env] 未验证启动（本轮没试）'
      : '[probe-env] 不可用'
  const line = `${head}（reason=${snapshot.reason}, exit=${snapshot.exitCode}）`
  const parts = [
    `playwright ${snapshot.playwright.resolved ? `解析到 ${snapshot.playwright.version ?? '?'}` : '未解析'}`,
    `Edge ${snapshot.edge.found ? snapshot.edge.version ?? '(版本未读到)' : '未找到'}`,
    `启动 ${snapshot.launch.launched ? '成功' : '未成功'}`,
  ]
  const lines = [`${line} · ${parts.join(' / ')}`]
  if (snapshot.launch.detail !== null) lines.push(`[probe-env] 细节：${snapshot.launch.detail}`)
  for (const hint of [snapshot.playwright.next, snapshot.edge.next, snapshot.launch.next]) {
    if (hint !== null && hint !== undefined) lines.push(`[probe-env] 下一步：${hint}`)
  }
  return lines.join('\n')
}

/** 仓库根（脚本自身位置的上一级）。 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 打印落点时收回仓库内相对路径。
 * 为什么连这一行也要管：`--json` 的 stdout 就是人们贴进报告的东西，本机绝对路径一旦进去，
 * 报告就换台机器对不上（与快照不带绝对路径同一个理由）。仓库外的目标只报名字 + 标注。
 */
function displayOut(absolute) {
  const back = relative(REPO_ROOT, absolute)
  if (back === '' || back.startsWith('..') || isAbsolute(back)) return `${basename(absolute)}（仓库外，路径不打印）`
  return back.replaceAll('\\', '/')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code), (error) => {
    console.error(`[probe-env] 探测没跑成：${error?.message ?? error}`)
    process.exit(EXIT.probeFailed)
  })
}
