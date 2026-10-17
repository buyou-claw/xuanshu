/**
 * scripts/isolation/resolve.mjs — 票 04 的「路径 / CLI 解析」纯函数层。
 *
 * 只做解析，不 spawn、不写盘、不打日志；一切判断留给 startup.mjs（启动器）与
 * scripts/verify-isolation.mjs（断言台）。这样队友 C 的 I1/I2 断言可以只调这两个函数，
 * 不必装 profile、不必起端口。
 *
 * 接口冻结出处：契约 §4.4（resolve.mjs）。以下三条是**硬规矩**，改代码前先读：
 *
 *   1) 只允许读 `home` 与 `repoRoot` 下的东西，加上显式传入的 `--cli-bin` 路径。
 *      **不许**把用户真实 `~/.dsh` 当候选来源扫——那正是本票要隔离掉的东西。
 *      （唯一例外：读 `homedir()` 拼出真实 home 的**路径字符串**，用来拒绝它，不读它的内容。）
 *   2) `resolveRepoRoot()` 用「向上找 pnpm-workspace.yaml」，不写死盘符 / 仓库名：
 *      换机器、换克隆目录、从子目录调用都得对。
 *   3) 路径比较一律走 `samePath` / `isUnderPath`（Windows 大小写不敏感），
 *      不要在调用点自己写 `===`：`E:\X` 与 `e:\x` 是同一个目录。
 *
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'

import {
  DATA_DIR_NAME,
  DEFAULT_HOROSA_PORT,
  DEFAULT_PROFILE,
  DEFAULT_WEB_PORT,
  DEV_HOME_DIR_NAME,
  DSH_BASE_PACKAGE,
  DSH_HOME_ENV,
  DSH_PACKAGE,
  ENV,
  HOME_MODES,
  HOROSA_MCP_PATH,
  PROBE_HOST,
  PRODUCT_HOME_DIR_NAME,
} from './defaults.mjs'

const CASE_INSENSITIVE = process.platform === 'win32'
const fold = (path) => (CASE_INSENSITIVE ? path.toLowerCase() : path)
/** 空 / 纯空白当「未设」——与 `@deepseek-ai/dsh-home-paths` 的语义保持一致，否则 `DSH_HOME=""` 会被当成路径。 */
const isBlank = (value) => typeof value !== 'string' || value.trim() === ''

/**
 * 「候选值设了没有」。**只有 `undefined` 与空白字符串算「未设」**，其余一律进入校验。
 *
 * 为什么必须与 `isBlank` 分开：`runStartup({ webPort: 7973 })` 这种**以 API 复用**的调用方传的是
 * 数字（CLI 走 argv 才是字符串）。曾按 `isBlank` 判，结果数字候选被当成「未设」静默跳过、退回默认
 * 端口 —— 在一个「端口隔离」工具里，静默换端口是最危险的一类错误：报告里 `portSource: 'default'`
 * 看着毫无异常，两个实例却可能因此撞端口（isolation-verifier 在 task-6 报过这条）。
 *
 * 顺带把同类漏洞一起堵死：`NaN` / `null` / 布尔 / 对象这些「设了但不是端口」的值**不许**再退回默认
 * （那还是「静默换端口」），必须走 `asPortNumber()` 抛出来。宁可调用方看到一句明确的用法错，
 * 也不要它以为自己在 7973 上跑、实际在 19388 上跑。
 */
const isUnset = (value) => value === undefined || (typeof value === 'string' && value.trim() === '')

/**
 * 把候选值折成端口号；不是「数字或数字字符串」就抛（不静默降级）。
 * `Number('7973')`/`Number(7973)` 都成立；`Number('')`、`Number(null)`、`Number(true)` 这类
 * 会被折成 0/1 的坑，在这里按类型先拦掉，免得它们变成「合法端口 1」。
 */
function asPortNumber(raw, source, label) {
  const describe = typeof raw === 'number' ? String(raw) : JSON.stringify(raw) // JSON.stringify(NaN) 是 "null"，会看得人一头雾水
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  throw new Error(`invalid ${label} port: ${describe} (from ${source}; expected a number, got ${raw === null ? 'null' : typeof raw})`)
}

/* ───────────────────────────── 路径比较 ───────────────────────────── */

/** 两个路径是不是同一个位置（Windows 上忽略大小写）。空值一律 false，不抛异常。 */
export function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a === '' || b === '') return false
  return fold(resolve(a)) === fold(resolve(b))
}

/** child 是否落在 parent 之内（含相等）。用于「所有派生路径都在隔离 home 下」的断言。 */
export function isUnderPath(parent, child) {
  if (typeof parent !== 'string' || typeof child !== 'string' || parent === '' || child === '') return false
  const p = fold(resolve(parent))
  const c = fold(resolve(child))
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep)
}

/** 本机用户真实 DSH home（`~/.dsh`）。只用来**拒绝**它，绝不用来读内容。 */
export function realDshHome() {
  return join(homedir(), '.dsh')
}

/**
 * `home` 是不是（或落在）用户真实 DSH home 里 —— **全仓唯一的「真实 home」判据**。
 *
 * 为什么收成一条：验收台、启动器、setup 门、host 插件各写过一次 `samePath || isUnderPath`，
 * 而「落在里面」（`~/.dsh/profiles/xuanshu`）比「等于」更危险。写成一条以后，
 * 「玄枢 home 永不等于 `~/.dsh`」这条验收要求只有一个地方会漂移。
 *
 * 语义故意取「**指向真实 home = true**」：调用方一律写 `!pointsAtRealDshHome(...)`，
 * 比 `!samePath && !isUnderPath` 更难读错方向。空值 / 非字符串 → false（没有 home 不等于「指向 ~/.dsh」）。
 */
export function pointsAtRealDshHome(home, { realHome = realDshHome() } = {}) {
  if (typeof home !== 'string' || home === '') return false
  return samePath(home, realHome) || isUnderPath(realHome, home)
}

/* ───────────────────────────── 默认 home（两档） ───────────────────────────── */

/**
 * home 的**来源**（封闭枚举）。报告、断言台、runbook 都拿它做比较 / 展示：
 * 「这次打的是哪儿、这个值是谁定的」必须一句话说清，否则排障第一句话就答不上来。
 */
export const HOME_SOURCES = {
  explicit: '--home',
  env: ENV.home,
  dshEnv: DSH_HOME_ENV,
  defaultDev: `default (dev <repo>/${DEV_HOME_DIR_NAME})`,
  defaultProduct: `default (product ~/${PRODUCT_HOME_DIR_NAME})`,
}

/**
 * 默认 home 的**唯一一份**：`dev` = `<repo>/.dsh-home`，`product` = `<homedir>/.xuanshu`。
 *
 * 为什么必须有 product 这一档（ADR-0014）：玄枢与 DSH 桌面版**零交集**，装好的玄枢自己的家只能是
 * `~/.xuanshu`；而仓库检出里的开发/测试继续用仓库内的 `.dsh-home`（已 gitignore，几百 MB 的 profile
 * 不该落在用户家目录）。两档都不是 `~/.dsh` —— 由 `pointsAtRealDshHome()` 在验收台与测试里钉着。
 *
 * `repoRoot` 必须由调用方给出（dev 档不猜路径：猜出来的家比报错危险）。
 */
export function defaultHome({ mode = 'dev', repoRoot, homedirPath = homedir() } = {}) {
  if (mode === 'product') {
    return { home: join(homedirPath, PRODUCT_HOME_DIR_NAME), source: HOME_SOURCES.defaultProduct, mode: 'product' }
  }
  if (typeof repoRoot !== 'string' || repoRoot === '') {
    throw new Error(
      `dev home default needs the repo root (expected ${DEV_HOME_DIR_NAME} under a checkout): `
      + 'pass repoRoot, or use mode "product"',
    )
  }
  return { home: join(repoRoot, DEV_HOME_DIR_NAME), source: HOME_SOURCES.defaultDev, mode: 'dev' }
}

/**
 * 这次该用哪一档默认：显式 `mode` ＞「能不能找到仓库根」这一条客观判据。
 *
 * 为什么用「仓库根」当判别器（而不是 ADR 没规定的那类隐式规则）：仓库检出 = 开发期
 * （`<repo>/.dsh-home`），找不到仓库 = 这不是一份仓库检出 = 产品机（`~/.xuanshu`）。
 * 两种判错的代价都不对称地安全：判成 dev 只是把家落在一个仓库内目录，**永远不会落到 `~/.dsh`**。
 *
 * `locateRepoRoot` 是给测试用的接缝（产品机上 `resolveRepoRoot()` 会抛，本函数把它折成 product）。
 */
export function resolveHomeMode({ mode, repoRoot, locateRepoRoot = resolveRepoRoot } = {}) {
  if (!isBlank(mode)) {
    const normalized = String(mode).trim().toLowerCase()
    if (!HOME_MODES.includes(normalized)) {
      throw new Error(`invalid home mode: ${JSON.stringify(mode)} (expected ${HOME_MODES.join('|')})`)
    }
    return { mode: normalized, source: `explicit (mode=${normalized})` }
  }
  if (!isBlank(repoRoot)) return { mode: 'dev', source: 'detected (repo checkout)' }
  try {
    locateRepoRoot()
    return { mode: 'dev', source: 'detected (repo checkout)' }
  } catch {
    return { mode: 'product', source: 'detected (no repo checkout)' }
  }
}


/* ───────────────────────────── 仓库根 ───────────────────────────── */

/**
 * 从 `from` 向上找 `pnpm-workspace.yaml`，返回仓库根绝对路径。
 * 找不到就抛错：这时任何「相对仓库的默认值」都是猜的，宁可让调用方明确传 --home。
 */
export function resolveRepoRoot(from = process.cwd()) {
  const start = resolve(from)
  let dir = existsSync(start) && statSync(start).isDirectory() ? start : dirname(start)
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`cannot find the XuanShu repo root above ${start}: no pnpm-workspace.yaml in any ancestor directory`)
    }
    dir = parent
  }
}

/* ───────────────────────────── 隔离 home ───────────────────────────── */

/**
 * 解析隔离 home，并**说明它是怎么来的**（source 会进报告，便于别人一眼看懂这次打的是哪儿）。
 *
 * 优先级（每一级都能被下一级的人为覆盖，且来源可追溯）：
 *   1. 显式 `home` 参数（CLI `--home`）
 *   2. `XUANSHU_DSH_HOME`（本票自己的变量，专给「我就是想换个隔离目录」用；壳也认它）
 *   3. `$DSH_HOME` —— **仅当它不指向用户真实 `~/.dsh`（或其子目录）时才采纳**
 *   4. 默认，两档（ADR-0014）：`mode: 'product'` → `~/.xuanshu`；`mode: 'dev'` → `<repo>/.dsh-home`。
 *      `mode` 缺省时按 `resolveHomeMode()` 判（仓库检出 = dev，找不到仓库 = product）。
 *
 * 第 3 条的例外为什么必要（评审裁决 §5.1 **R16** 确认的语义）：在一个 DSH 会话里跑本脚本时，
 * 环境里天然带着 `DSH_HOME=C:\Users\<me>\.dsh`（desktop 自己的 home）。若照单全收，默认调用会
 * 直接撞上真实 home 并被拒绝，隔离启动器等于开箱不可用。所以：
 *   - **环境里那支 `DSH_HOME`** 指向真实 `~/.dsh` → 忽略 + 记 notes（软处理）；
 *   - **显式 `--home` / `XUANSHU_DSH_HOME`** 指向真实 `~/.dsh` → 硬拒绝（exit 1，见 startup.mjs）。
 * 「显式」= 有人真的打出来了，那就该按字面执行并拒绝；「环境里带的」= 不是这次调用的意图。
 *
 * `repoRoot` 不再**无条件**求值（旧实现 `resolveRepoRoot()` 在产品机上直接抛，于是「产品默认
 * `~/.xuanshu`」根本走不到）；现在只是尽力而为：找得到就写进返回（dev 档要用它），找不到就是 undefined。
 */
export function resolveHomeWithSource({
  home, env = process.env, repoRoot, realHome = realDshHome(), mode, locateRepoRoot,
} = {}) {
  const root = isBlank(repoRoot) ? bestEffortRepoRoot(locateRepoRoot) : repoRoot
  const resolvedMode = resolveHomeMode({ mode, repoRoot: root, locateRepoRoot })
  const ignored = []
  const base = { ignored, realHome, repoRoot: root, mode: resolvedMode.mode, modeSource: resolvedMode.source }

  if (!isBlank(home)) return { ...base, home: resolve(home), source: HOME_SOURCES.explicit }

  const fromEnv = env?.[ENV.home]
  if (!isBlank(fromEnv)) return { ...base, home: resolve(fromEnv), source: HOME_SOURCES.env }

  const dshHome = env?.[DSH_HOME_ENV]
  if (!isBlank(dshHome)) {
    const candidate = resolve(dshHome)
    if (pointsAtRealDshHome(candidate, { realHome })) {
      ignored.push(`${DSH_HOME_ENV}=${candidate} 指向用户真实 DSH home，已忽略（改用默认隔离 home）`)
    } else {
      return { ...base, home: candidate, source: HOME_SOURCES.dshEnv }
    }
  }

  const fallback = defaultHome({ mode: resolvedMode.mode, repoRoot: root })
  return { ...base, home: fallback.home, source: fallback.source }
}

/** 找得到仓库根就返回它，找不到返回 undefined（产品机上找不到是**正常**的，不是错误）。 */
function bestEffortRepoRoot(locate = resolveRepoRoot) {
  try {
    return locate()
  } catch {
    return undefined
  }
}

/** 契约 §4.4 的窄接口：只要绝对路径字符串。 */
export function resolveHome(options = {}) {
  return resolveHomeWithSource(options).home
}

/* ───────────────────────────── CLI 解析 ───────────────────────────── */

/** 读一个包的 package.json；不存在 / 坏 JSON 都返回 undefined（解析层不该抛）。 */
function readManifest(packageDir) {
  try {
    return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * profile 树里那支 CLI：`<profile>/node_modules/@deepseek-ai/dsh/lib/bin.js`。
 * 这是本票唯一受支持的 CLI——全局 npm 装的那支是 0.1.2-rc.1，和 0.2.0-rc.2 的树不兼容。
 */
export function findCliInProfile(profileDir) {
  if (typeof profileDir !== 'string' || profileDir === '') return undefined
  const packageDir = join(profileDir, 'node_modules', DSH_PACKAGE)
  const binJs = join(packageDir, 'lib', 'bin.js')
  const manifest = readManifest(packageDir)
  if (manifest === undefined || !existsSync(binJs)) return undefined
  return { binJs, version: manifest.version, packageDir }
}

/**
 * 把用户给的 `--cli-bin` 归一成 `<...>/@deepseek-ai/dsh/lib/bin.js`。
 * 用户可能给 bin.js、包目录、node_modules 根、或 PATH 上那个 shim 的目录——
 * 这四种写法都是「我指的是这支 CLI」，不该让调用方背路径细节。
 */
function normalizeExplicitBin(value) {
  const given = resolve(value)
  const candidates = [
    given,
    join(given, 'lib', 'bin.js'),
    join(given, '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(dirname(given), '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(dirname(given), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ]
  return candidates.find((candidate) => /bin\.js$/i.test(candidate) && existsSync(candidate))
}

/**
 * `source` 是**封闭枚举**（评审裁决 §5.1 R10）：报告、断言台、runbook 都拿它做比较，
 * 裸字符串比较一旦有人手滑少个空格，就成了「看起来断言了、其实永远为真」的假绿。
 * `sibling` 那段需要名字与 home 才能拼全，所以走 `cliSource()` 这个唯一构造入口。
 */
export const CLI_SOURCES = {
  profile: 'profile node_modules',
  explicit: 'explicit (--cli-bin)',
  sibling: 'sibling profile',
  path: 'PATH',
}

/** 构造 source 字符串的唯一入口（契约 §4.4 的 `sibling profile <name> (<home>)` 形态）。 */
export function cliSource(kind, { profileName, home } = {}) {
  const prefix = CLI_SOURCES[kind]
  if (prefix === undefined) throw new Error(`unknown CLI source kind: ${JSON.stringify(kind)} (expected ${Object.keys(CLI_SOURCES).join('|')})`)
  if (kind === 'sibling') {
    if (profileName === undefined || home === undefined) throw new Error('cliSource("sibling") needs both profileName and home')
    return `${prefix} ${profileName} (${home})`
  }
  return prefix
}

/**
 * 选一支 DSH CLI，并明确它「从哪来」「版本对不对」。
 *
 * 候选顺序（越靠前越受信任）：显式 `--cli-bin` → profile 自己装的 → 同一隔离 home 下的兄弟
 * profile（`<home>/profiles/*`，只读）→ PATH。
 *
 * 版本锚 `wantedVersion` = profile 里装的 `@deepseek-ai/dsh-base` 版本：CLI 与 dsh-base 不同树
 * 时会去解析别人的 node_modules（实测崩在 `does not provide an export named 'StartupError'`），
 * 所以「版本对不对」比「跑不跑得起来」更重要，必须回传 `versionMatches` 让上层判。
 *
 * 找不到任何 CLI 时返回 `undefined`（不抛）：调用方要的是「环境门失败 + 人读提示」，不是栈。
 * 例外：显式给了 `--cli-bin` 却解析不出来 → 抛错（这是用户用法错误，静默退回别的 CLI 更糟）。
 */
export function resolveCli({ profileDir, explicit, repoRoot, env = process.env } = {}) {
  const requested = !isBlank(explicit) ? explicit : env?.[ENV.cliBin]
  const wantedVersion = readManifest(join(profileDir ?? '', 'node_modules', DSH_BASE_PACKAGE))?.version
    ?? readManifest(join(profileDir ?? '', 'node_modules', '@deepseek-ai/dsh-headless'))?.version

  const found = []
  const seen = new Set()
  /** kind ∈ CLI_SOURCES；detail 只有 sibling 需要（名字 + home）。 */
  const consider = (packageDir, kind, detail) => {
    if (typeof packageDir !== 'string' || !existsSync(join(packageDir, 'package.json'))) return
    let key
    try {
      key = fold(realpathSync(packageDir))
    } catch {
      key = fold(resolve(packageDir))
    }
    if (seen.has(key)) return
    seen.add(key)
    const manifest = readManifest(packageDir)
    const binJs = join(packageDir, 'lib', 'bin.js')
    if (manifest === undefined || !existsSync(binJs)) return
    found.push({ binJs, version: manifest.version, packageDir, source: cliSource(kind, detail) })
  }

  if (!isBlank(requested)) {
    const binJs = normalizeExplicitBin(requested)
    if (binJs === undefined) {
      throw new Error(
        `--cli-bin/${ENV.cliBin} did not resolve to a DSH CLI: ${requested}\n`
        + `  expected <...>/node_modules/@deepseek-ai/dsh/lib/bin.js (or the package / node_modules directory)`,
      )
    }
    consider(dirname(dirname(binJs)), 'explicit')
  }

  // profile 自己那支：复用 findCliInProfile（R11），别在这里再写一遍 join。
  const own = findCliInProfile(profileDir)
  if (own !== undefined) consider(own.packageDir, 'profile')

  // 兄弟 profile：同一个隔离 home 下的 `profiles/*`。**只扫隔离 home**，不扫真实 home。
  const profilesDir = basename(dirname(profileDir ?? '')) === 'profiles' ? dirname(profileDir) : undefined
  if (profilesDir !== undefined && existsSync(profilesDir)) {
    const home = dirname(profilesDir)
    try {
      for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        consider(join(profilesDir, entry.name, 'node_modules', DSH_PACKAGE), 'sibling', { profileName: entry.name, home })
      }
    } catch {
      /* 目录读不了就当没有兄弟 profile，不影响 profile 自己那支 */
    }
  }

  for (const dir of String(env?.PATH ?? env?.Path ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (dir === '') continue
    consider(join(dir, DSH_PACKAGE), 'path')
    consider(join(dir, 'node_modules', DSH_PACKAGE), 'path')
  }

  if (found.length === 0) return undefined

  const rank = (candidate) => (wantedVersion === undefined || candidate.version === wantedVersion ? 0 : 1)
  const ranked = [...found].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return String(b.version).localeCompare(String(a.version))
  })
  const chosen = ranked[0]
  // moduleRoot：CLI 那棵 node_modules 的根，用于「它的树里有没有 cordis」这类旁证。
  let moduleRoot
  for (let dir = dirname(chosen.binJs), i = 0; i < 12 && dir !== dirname(dir); i += 1, dir = dirname(dir)) {
    if (basename(dir) === 'node_modules') {
      moduleRoot = dir
      break
    }
  }

  return {
    binJs: chosen.binJs,
    version: chosen.version,
    source: chosen.source,
    versionMatches: wantedVersion === undefined || chosen.version === wantedVersion,
    wantedVersion,
    packageDir: chosen.packageDir,
    moduleRoot,
    rejects: ranked.slice(1).map((candidate) => `${candidate.version} (${candidate.source})`),
  }
}

/* ───────────────────────────── 实例 ───────────────────────────── */

/**
 * 端口解析：候选**按优先级排好**，第一个「设了值」的生效（空/纯空白当未设）。
 * 为什么把来源一起回传：报告必须能回答「这个 18765 是哪来的」——是 `--horosa-port`、
 * `XUANSHU_HOROSA_PORT`，还是 horosa skill 自己认的 `HOROSA_SKILL_PORT`（R6）。
 * 端口不对时，人问的第一句话就是这个。
 */
function pickPort(candidates, fallback, label) {
  for (const [raw, source] of candidates) {
    if (isUnset(raw)) continue
    const port = asPortNumber(raw, source, label)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`invalid ${label} port: ${JSON.stringify(raw)} (from ${source}; expected an integer 1..65535)`)
    }
    return { port, source }
  }
  return { port: fallback, source: 'default' }
}

/**
 * horosa 端口只要「能拿去做一次探测」，不需要「能拿去 bind」，所以这里**只**要求是数字：
 * 越界值（如 70000）交给守卫去判 —— 它会回 `probe-failed`(=「没验成」)，按 §5.1 R14
 * 这既不改退出码、也不会被误当成「端口被占」（本票 web bundle 不在，我们本来也不 bind 它）。
 * 反过来，非数字（`--horosa-port abc`）是纯用法错，在这里就拦掉，别让它变成一句含糊的 unknown。
 */
function pickProbePort(candidates, fallback, label) {
  for (const [raw, source] of candidates) {
    if (isUnset(raw)) continue
    const port = asPortNumber(raw, source, label)
    return { port, source }
  }
  return { port: fallback, source: 'default' }
}

/**
 * 把「一个隔离实例长什么样」一次性算全：home、profile、端口、以及 $DSH_HOME 下的每一条派生路径。
 *
 * 为什么要把派生路径显式列出来（而不是让调用方自己 join）：这些路径就是隔离的**断言面**——
 * sessions / storages / 凭据 / 机器级补丁必须全部落在同一个 home 下，且换一个 home 就全换一套。
 * 列在这里，测试与报告就能拿同一份事实去断言，不会各写一份 join 然后「看起来都对」。
 *
 * 硬规矩：只读 `home`、`repoRoot` 与显式 `cliBin`；不扫真实 `~/.dsh`。
 */
export function resolveInstance({ home, profile, webPort, horosaPort, repoRoot, env = process.env, cliBin, explicit, mode } = {}) {
  const root = repoRoot ?? resolveRepoRoot()
  // home 的默认值只有一份（`defaultHome`），别在这里再写一遍 `.dsh-home` —— 两处各写一份时，
  // 换默认值只改一处不会红（所有测试都显式传 home），但语义会悄悄分叉。
  const resolvedHome = isBlank(home)
    ? defaultHome({ mode: resolveHomeMode({ mode, repoRoot: root }).mode, repoRoot: root }).home
    : resolve(home)
  const profileName = isBlank(profile) ? (isBlank(env?.[ENV.profile]) ? DEFAULT_PROFILE : String(env[ENV.profile])) : String(profile)
  if (profileName === '.' || profileName === '..' || /[\\/]/.test(profileName)) {
    throw new Error(`invalid profile name: ${JSON.stringify(profileName)}`)
  }

  // 端口回退链（§5.1 R6）：web 只认 --web-port > XUANSHU_WEB_PORT；
  // horosa 多一级 HOROSA_SKILL_PORT —— horosa 自己那份 skill 认的就是它，守卫必须跟着它走。
  const web = pickPort(
    [[webPort, '--web-port'], [env?.[ENV.webPort], ENV.webPort]],
    DEFAULT_WEB_PORT,
    'web',
  )
  const horosa = pickProbePort(
    [
      [horosaPort, '--horosa-port'],
      [env?.[ENV.horosaPort], ENV.horosaPort],
      [env?.[ENV.horosaSkillPort], ENV.horosaSkillPort],
    ],
    DEFAULT_HOROSA_PORT,
    'horosa',
  )

  const profileDir = join(resolvedHome, 'profiles', profileName)
  const cli = resolveCli({ profileDir, explicit: cliBin ?? explicit, repoRoot: root, env })

  return {
    home: resolvedHome,
    profile: profileName,
    profileDir,
    webPort: web.port,
    horosaPort: horosa.port,
    horosaUrl: `http://${PROBE_HOST}:${horosa.port}${HOROSA_MCP_PATH}`,
    dataDir: join(resolvedHome, DATA_DIR_NAME),
    sessionsDir: join(resolvedHome, 'sessions'),
    storagesDir: join(resolvedHome, 'storages'),
    credentialsFile: join(resolvedHome, '.credentials.yaml'),
    machinePatchFile: join(resolvedHome, 'cordis.patch.yml'),
    reportFile: join(resolvedHome, DATA_DIR_NAME, 'assembly-report.json'),
    // 非契约字段（报告里的 instance 由 INSTANCE_KEYS 白名单挑，不会泄漏）：
    // 端口各自生效的来源，用来在报告/提示里说清「这个数字哪来的」。
    portSources: { web: web.source, horosa: horosa.source },
    cli,
  }
}
