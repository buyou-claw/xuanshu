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
  DSH_BASE_PACKAGE,
  DSH_HOME_ENV,
  DSH_PACKAGE,
  ENV,
  HOROSA_MCP_PATH,
  PROBE_HOST,
} from './defaults.mjs'

const CASE_INSENSITIVE = process.platform === 'win32'
const fold = (path) => (CASE_INSENSITIVE ? path.toLowerCase() : path)
/** 空 / 纯空白当「未设」——与 `@deepseek-ai/dsh-home-paths` 的语义保持一致，否则 `DSH_HOME=""` 会被当成路径。 */
const isBlank = (value) => typeof value !== 'string' || value.trim() === ''

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
 *   2. `XUANSHU_DSH_HOME`（本票自己的变量，专给「我就是想换个隔离目录」用）
 *   3. `$DSH_HOME` —— **仅当它不指向用户真实 `~/.dsh`（或其子目录）时才采纳**
 *   4. `<repo>/.dsh-home`（默认；已 gitignore）
 *
 * 第 3 条的例外为什么必要：在一个 DSH 会话里跑本脚本时，环境里天然带着
 * `DSH_HOME=C:\Users\<me>\.dsh`（desktop 自己的 home）。若照单全收，默认调用会直接撞上
 * 真实 home 并被拒绝，隔离启动器等于开箱不可用。忽略这个值会写进 `ignored[]` 并进报告 notes，
 * 不会静默发生；显式传 `--home ~/.dsh` 仍然照契约硬拒绝（exit 1）。
 */
export function resolveHomeWithSource({ home, env = process.env, repoRoot, realHome = realDshHome() } = {}) {
  const root = repoRoot ?? resolveRepoRoot()
  const ignored = []
  const base = { ignored, realHome, repoRoot: root }

  if (!isBlank(home)) return { ...base, home: resolve(home), source: '--home' }

  const fromEnv = env?.[ENV.home]
  if (!isBlank(fromEnv)) return { ...base, home: resolve(fromEnv), source: ENV.home }

  const dshHome = env?.[DSH_HOME_ENV]
  if (!isBlank(dshHome)) {
    const candidate = resolve(dshHome)
    if (samePath(candidate, realHome) || isUnderPath(realHome, candidate)) {
      ignored.push(`${DSH_HOME_ENV}=${candidate} 指向用户真实 DSH home，已忽略（改用默认隔离 home）`)
    } else {
      return { ...base, home: candidate, source: DSH_HOME_ENV }
    }
  }

  return { ...base, home: join(root, '.dsh-home'), source: 'default (<repo>/.dsh-home)' }
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
  const consider = (packageDir, source) => {
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
    found.push({ binJs, version: manifest.version, packageDir, source })
  }

  if (!isBlank(requested)) {
    const binJs = normalizeExplicitBin(requested)
    if (binJs === undefined) {
      throw new Error(
        `--cli-bin/${ENV.cliBin} did not resolve to a DSH CLI: ${requested}\n`
        + `  expected <...>/node_modules/@deepseek-ai/dsh/lib/bin.js (or the package / node_modules directory)`,
      )
    }
    consider(dirname(dirname(binJs)), 'explicit (--cli-bin)')
  }

  consider(join(profileDir ?? '', 'node_modules', DSH_PACKAGE), 'profile node_modules')

  // 兄弟 profile：同一个隔离 home 下的 `profiles/*`。**只扫隔离 home**，不扫真实 home。
  const profilesDir = basename(dirname(profileDir ?? '')) === 'profiles' ? dirname(profileDir) : undefined
  if (profilesDir !== undefined && existsSync(profilesDir)) {
    const home = dirname(profilesDir)
    try {
      for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        consider(join(profilesDir, entry.name, 'node_modules', DSH_PACKAGE), `sibling profile ${entry.name} (${home})`)
      }
    } catch {
      /* 目录读不了就当没有兄弟 profile，不影响 profile 自己那支 */
    }
  }

  for (const dir of String(env?.PATH ?? env?.Path ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (dir === '') continue
    consider(join(dir, DSH_PACKAGE), 'PATH')
    consider(join(dir, 'node_modules', DSH_PACKAGE), 'PATH')
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

/** 把「数字可能来自参数或环境」这件事收在一处：非法值一律抛（上层折成用法失败）。 */
function pickPort(value, envValue, fallback, label) {
  const raw = value ?? (isBlank(envValue) ? undefined : envValue)
  if (raw === undefined) return fallback
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid ${label} port: ${JSON.stringify(raw)} (expected an integer 1..65535)`)
  }
  return port
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
export function resolveInstance({ home, profile, webPort, horosaPort, repoRoot, env = process.env, cliBin, explicit } = {}) {
  const root = repoRoot ?? resolveRepoRoot()
  const resolvedHome = resolve(home ?? join(root, '.dsh-home'))
  const profileName = isBlank(profile) ? (isBlank(env?.[ENV.profile]) ? DEFAULT_PROFILE : String(env[ENV.profile])) : String(profile)
  if (profileName === '.' || profileName === '..' || /[\\/]/.test(profileName)) {
    throw new Error(`invalid profile name: ${JSON.stringify(profileName)}`)
  }

  const resolvedWebPort = pickPort(webPort, env?.[ENV.webPort], DEFAULT_WEB_PORT, 'web')
  const resolvedHorosaPort = pickPort(horosaPort, env?.[ENV.horosaPort], DEFAULT_HOROSA_PORT, 'horosa')

  const profileDir = join(resolvedHome, 'profiles', profileName)
  const cli = resolveCli({ profileDir, explicit: cliBin ?? explicit, repoRoot: root, env })

  return {
    home: resolvedHome,
    profile: profileName,
    profileDir,
    webPort: resolvedWebPort,
    horosaPort: resolvedHorosaPort,
    horosaUrl: `http://${PROBE_HOST}:${resolvedHorosaPort}${HOROSA_MCP_PATH}`,
    dataDir: join(resolvedHome, DATA_DIR_NAME),
    sessionsDir: join(resolvedHome, 'sessions'),
    storagesDir: join(resolvedHome, 'storages'),
    credentialsFile: join(resolvedHome, '.credentials.yaml'),
    machinePatchFile: join(resolvedHome, 'cordis.patch.yml'),
    reportFile: join(resolvedHome, DATA_DIR_NAME, 'assembly-report.json'),
    cli,
  }
}
