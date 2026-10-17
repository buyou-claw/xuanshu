/**
 * packages/xuanshu-shell/lib/home.mjs — 壳解析「玄枢的家」与派生路径（冻结契约 §0）。
 *
 * 这是 `scripts/isolation/resolve.mjs` 纯逻辑的**本地副本**（parity-tested，见
 * `tests/shell/home.test.mjs` 逐组对拍）。为什么复制而不是 import：
 *   - 壳是一个可被单独装进 Electron 应用的包（`electron .` 从 `packages/xuanshu-shell` 起），
 *     装好的应用里没有仓库的 `scripts/` 目录；
 *   - 但规则**不许分叉**：`XUANSHU_DSH_HOME` > `DSH_HOME`（仅当不指向真实 `~/.dsh`）> 默认两档
 *     （dev `<repo>/.dsh-home` / product `~/.xuanshu`），与 #22 完全同一套。
 *
 * 硬规矩（抄自 resolve.mjs，别在这里放宽）：
 *   1) 只读 home / repoRoot 下的东西；真实 `~/.dsh` 只用来**拒绝/忽略**，绝不读内容；
 *   2) `resolveRepoRoot()` 向上找 `pnpm-workspace.yaml`，不写死盘符 / 仓库名；
 *   3) 路径比较一律走 `samePath` / `isUnderPath`（Windows 大小写不敏感）。
 *
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

import {
  DATA_DIR_NAME,
  DEFAULT_PROFILE,
  DEV_HOME_DIR_NAME,
  DSH_HOME_ENV,
  ENV,
  HOME_MODES,
  PRODUCT_HOME_DIR_NAME,
  RUNTIME_DIR_NAME,
  SHELL_NOTIFY_STATE_FILE,
  SHELL_SETTINGS_FILE,
} from './contract.mjs'

const CASE_INSENSITIVE = process.platform === 'win32'
const fold = (path) => (CASE_INSENSITIVE ? path.toLowerCase() : path)
const isBlank = (value) => typeof value !== 'string' || value.trim() === ''

/* ───────────────────────────── 路径比较 ───────────────────────────── */

/** 两个路径是不是同一个位置（Windows 上忽略大小写）。空值一律 false，不抛异常。 */
export function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a === '' || b === '') return false
  return fold(resolve(a)) === fold(resolve(b))
}

/** child 是否落在 parent 之内（含相等）。 */
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
 * `home` 是不是（或落在）用户真实 DSH home 里 —— 与 `resolve.mjs::pointsAtRealDshHome` 同判。
 * 语义故意取「**指向真实 home = true**」：调用方一律写 `if (isRealDshHome(...)) 拒绝`。
 */
export function isRealDshHome(home, { realHome = realDshHome() } = {}) {
  if (typeof home !== 'string' || home === '') return false
  return samePath(home, realHome) || isUnderPath(realHome, home)
}

/* ───────────────────────────── 默认 home（两档） ───────────────────────────── */

/** home 的**来源**（封闭枚举；报告 / runbook 拿它说清「这次打的是哪儿」）。 */
export const HOME_SOURCES = Object.freeze({
  explicit: '--home',
  env: ENV.home,
  dshEnv: DSH_HOME_ENV,
  defaultDev: `default (dev <repo>/${DEV_HOME_DIR_NAME})`,
  defaultProduct: `default (product ~/${PRODUCT_HOME_DIR_NAME})`,
})

/**
 * 默认 home 的**唯一一份**：`dev` = `<repo>/.dsh-home`，`product` = `<homedir>/.xuanshu`。
 * `repoRoot` 必须由 dev 档显式给出（猜出来的家比报错危险）。
 */
export function defaultHome({ mode = 'dev', repoRoot } = {}) {
  if (mode === 'product') {
    return { home: join(homedir(), PRODUCT_HOME_DIR_NAME), source: HOME_SOURCES.defaultProduct, mode: 'product' }
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
 * 这次该用哪一档默认：显式 `mode` ＞「能不能找到仓库根」。
 * 判错的两种代价都不对称地安全：判成 dev 只是把家落在仓库内目录，**永远不会落到 `~/.dsh`**。
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
 * 从 `from` 向上找 `pnpm-workspace.yaml`，返回仓库根绝对路径；找不到就抛。
 * 找不到时任何「相对仓库的默认值」都是猜的 —— 那时宁可让调用方走 product 档。
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

/** 找得到仓库根就返回它，找不到返回 undefined（产品机上找不到是**正常**的，不是错误）。 */
function bestEffortRepoRoot(locate = resolveRepoRoot) {
  try {
    return locate()
  } catch {
    return undefined
  }
}

/* ───────────────────────────── 隔离 home ───────────────────────────── */

/**
 * 解析玄枢 home，并说明它是怎么来的。
 *
 * 优先级（与 `resolve.mjs::resolveHomeWithSource` 逐条相同）：
 *   1. 显式 `home` 参数
 *   2. `XUANSHU_DSH_HOME`
 *   3. `$DSH_HOME` —— **仅当它不指向用户真实 `~/.dsh`（或其子目录）时才采纳**，否则忽略并记进 `ignored`
 *   4. 默认两档（`mode` 缺省按「有没有仓库检出」判）
 *
 * @returns {{home: string, source: string, ignored: string[], realHome: string,
 *            repoRoot: string|undefined, mode: 'dev'|'product', modeSource: string}}
 */
export function resolveShellHome({
  home, env = {}, repoRoot, realHome = realDshHome(), mode, locateRepoRoot,
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
    if (isRealDshHome(candidate, { realHome })) {
      ignored.push(`${DSH_HOME_ENV}=${candidate} 指向用户真实 DSH home，已忽略（改用默认隔离 home）`)
    } else {
      return { ...base, home: candidate, source: HOME_SOURCES.dshEnv }
    }
  }

  const fallback = defaultHome({ mode: resolvedMode.mode, repoRoot: root })
  return { ...base, home: fallback.home, source: fallback.source }
}

/* ───────────────────────────── 派生路径 ───────────────────────────── */

/**
 * 壳关心的全部派生路径（形状照契约 §0/§1/§5；全部在同一个 home 下）。
 * @param {string} home
 */
export function shellPaths(home) {
  const dataDir = join(home, DATA_DIR_NAME)
  const runtimeDir = join(dataDir, RUNTIME_DIR_NAME)
  return {
    home,
    dataDir,
    runtimeDir,
    notifyStateFile: join(runtimeDir, SHELL_NOTIFY_STATE_FILE),
    settingsFile: join(dataDir, SHELL_SETTINGS_FILE),
    profileDir: join(home, 'profiles', DEFAULT_PROFILE),
  }
}
