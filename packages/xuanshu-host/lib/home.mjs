/**
 * xuanshu-host · `lib/home.mjs` — 宿主侧的 DSH home 解析（**唯一一份兜底口径**）。
 *
 * 为什么需要这个文件（ADR-0014「玄枢有自己的壳与 home，与 DSH 桌面版零交集」）：
 *
 * 宿主插件里过去有 **6 处**各自兜底 `join(homedir(), '.dsh')`（`lib/index.js`、`horosa/paths`、
 * `horosa/service`、`workflow/service`、`bazi/service`、`cang/service`）。正常启动时
 * `profileContext.home` 一定在（`dsh --profile xuanshu` 由 `@deepseek-ai/dsh` 的 `resolveDshHome()`
 * 填），所以那 6 个兜底平时不生效 —— **但一旦生效就是往用户真实的 `~/.dsh` 里读写**。
 * 触发它只需要一件事：手敲 `dsh --profile xuanshu` 而环境里没有 `DSH_HOME` ——
 * 那正是「玄枢从不读写 ~/.dsh」这条验收要消灭的路径。
 *
 * 本文件做三件事，全是纯函数：
 *   1. `realDshHome()` / `pointsAtRealDshHome()`：**唯一一份**「真实 home」判据（等于**或落在**里面都算）；
 *   2. `fallbackXuanshuHome()`：兜底改成玄枢自己的 home（`XUANSHU_DSH_HOME` ＞ `~/.xuanshu`），
 *      **绝不** `~/.dsh`；
 *   3. 三个解析入口（同一套判据，别再各抄一份）：
 *      - `resolveHostHome()`：`profileContext.home` ＞ `$DSH_HOME` ＞ 兜底，并把 `source` 与
 *        「是否指向真实 home」一起回传；
 *      - `resolveDataDir()` / `dataDirFor()`：数据目录（10 个服务组共用的那一份）；
 *      - `resolveSearchHome()`：skill 扫描根（显式 ＞ profileContext ＞ dataDir 父目录 ＞ `DSH_HOME` ＞ 兜底），
 *        且**任何一档落到真实 `~/.dsh` 都改判兜底并带回原因**。
 *
 * 边界：本文件不读盘、不建目录、不判断档位（产品档 `~/.xuanshu` 是这里的兜底；开发档由脚本侧
 * 显式传 `DSH_HOME=<repo>/.dsh-home`，宿主只认环境，不猜仓库位置）。
 */

import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'

/** 玄枢自己的 home 目录名（产品档；ADR-0014）。 */
export const PRODUCT_HOME_DIR_NAME = '.xuanshu'
/** 本仓自己的 home 覆盖变量（与 `scripts/isolation/resolve.mjs` 同一个名字，壳会设它）。 */
export const XUANSHU_HOME_ENV = 'XUANSHU_DSH_HOME'
/** DSH 自己的 home 变量（`@deepseek-ai/dsh-home-paths` 认的就是它）。 */
export const DSH_HOME_ENV = 'DSH_HOME'
/** DSH 桌面版的 home 目录名：只许被**拒绝**，绝不许被当成玄枢的家。 */
export const REAL_DSH_HOME_DIR_NAME = '.dsh'
/** 玄枢数据目录名（`<home>/xuanshu`，票 01 起的布局；壳与宿主同源）。 */
export const DATA_DIR_NAME = 'xuanshu'

const CASE_INSENSITIVE = process.platform === 'win32'
const fold = (path) => (CASE_INSENSITIVE ? path.toLowerCase() : path)
const isBlank = (value) => typeof value !== 'string' || value.trim() === ''

/** 本机用户真实 DSH home（`~/.dsh`）。只用来**拒绝**它，绝不用来读内容。 */
export function realDshHome({ homedirPath = homedir() } = {}) {
  return join(homedirPath, REAL_DSH_HOME_DIR_NAME)
}

/**
 * `home` 是不是（或落在）用户真实 DSH home 里。
 * 与 `scripts/isolation/resolve.mjs::pointsAtRealDshHome` 同口径（两侧各一份是**包边界**决定的：
 * scripts 是 ESM 脚本目录、不在 host 包的导出面里；两处都有断言钉着，见 `tests/isolation/home.test.mjs`）。
 */
export function pointsAtRealDshHome(home, { homedirPath = homedir(), realHome } = {}) {
  if (typeof home !== 'string' || home === '') return false
  const real = fold(resolve(realHome ?? realDshHome({ homedirPath })))
  const candidate = fold(resolve(home))
  return candidate === real || candidate.startsWith(real.endsWith(sep) ? real : real + sep)
}

/**
 * 兜底 home：玄枢自己的家（**不是** `~/.dsh`）。
 * `XUANSHU_DSH_HOME` ＞ `<homedir>/.xuanshu`。开发档由调用方显式传 `DSH_HOME=<repo>/.dsh-home`。
 * @returns {{ home: string, source: string }}
 */
export function fallbackXuanshuHome({ env = process.env, homedirPath = homedir() } = {}) {
  const fromEnv = env?.[XUANSHU_HOME_ENV]
  if (!isBlank(fromEnv)) return { home: resolve(fromEnv), source: XUANSHU_HOME_ENV }
  return { home: join(homedirPath, PRODUCT_HOME_DIR_NAME), source: `product default (~/${PRODUCT_HOME_DIR_NAME})` }
}

/**
 * 解析宿主该用的 DSH home：`profileContext.home` ＞ `$DSH_HOME` ＞ 玄枢自己的兜底。
 *
 * `realDsh` 为真表示**解析结果指向用户真实的 `~/.dsh`**：调用方必须据此拒绝写入（见 `lib/index.js`
 * 的 `apply`），不许把它当成一个普通 home 用下去。
 *
 * @returns {{ home: string, source: string, realDsh: boolean }}
 */
export function resolveHostHome({ profileContext, env = process.env, homedirPath = homedir() } = {}) {
  const fromProfile = profileContext?.home
  if (!isBlank(fromProfile)) {
    const home = fromProfile
    return { home, source: 'profileContext.home', realDsh: pointsAtRealDshHome(home, { homedirPath }) }
  }
  const fromEnv = env?.[DSH_HOME_ENV]
  if (!isBlank(fromEnv)) {
    return { home: fromEnv, source: DSH_HOME_ENV, realDsh: pointsAtRealDshHome(fromEnv, { homedirPath }) }
  }
  const fallback = fallbackXuanshuHome({ env, homedirPath })
  return { ...fallback, realDsh: false }
}

/* ───────────────────── 数据目录 / 搜索根（同一份判据，别再抄） ───────────────────── */

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/**
 * `<home>/xuanshu`，或显式 `config.dataDir`（测试 / 嵌入方的注入口）。
 *
 * 只是 join 口径的**唯一**一份：调用方已经算好了 home 时（`lib/index.js` 的装配报告）用它，
 * 需要连 home 一起解析时用 `resolveDataDir`。
 *
 * @param {string} home
 * @param {{dataDir?: string}} [config]
 * @returns {string}
 */
export function dataDirFor(home, config) {
  return typeof config?.dataDir === 'string' && config.dataDir !== ''
    ? config.dataDir
    : join(home, DATA_DIR_NAME)
}

/**
 * 宿主该用的**数据目录**（10 个方法组的同一份入口；票 01 起 `<dshHome>/xuanshu`）。
 *
 * 两条纪律（ADR-0014）：
 *   - 显式 `config.dataDir` 原样返回（谁注入谁负责；`lib/index.js` 的 `apply` 另有一道写入门）；
 *   - 否则按 `resolveHostHome`（`profileContext.home` ＞ `DSH_HOME` ＞ 兜底）解析，
 *     **解析结果指向真实 `~/.dsh`（或落在里面）时改判玄枢自己的兜底**：这里不再有第二份
 *     「home 变量长什么样」的判断 —— 那道门只在 `resolveHostHome` 里。
 *
 * @param {object} ctx cordis 宿主上下文（裸 `{}` 也要活）
 * @param {{dataDir?: string}} [config]
 * @param {{env?: Record<string, string|undefined>, homedirPath?: string}} [options] 纯函数接缝
 * @returns {string}
 */
export function resolveDataDir(ctx, config, { env = process.env, homedirPath = homedir() } = {}) {
  if (typeof config?.dataDir === 'string' && config.dataDir !== '') return config.dataDir
  const resolved = resolveHostHome({ profileContext: softGet(ctx, 'profileContext'), env, homedirPath })
  // 真实 ~/.dsh 绝不当数据目录：退回玄枢自己的家（与 resolveHostHome 的兜底同一份实现）。
  const home = resolved.realDsh ? fallbackXuanshuHome({ env, homedirPath }).home : resolved.home
  return join(home, DATA_DIR_NAME)
}

/**
 * **skill 扫描根**（`<home>/skills` 的父目录）—— 与数据目录同一条顺序、同一道真实 home 门。
 *
 * 顺序：显式 → `profileContext.home` → `dataDir` 的父目录（目录名是 `xuanshu` 时）→ `DSH_HOME` →
 * 玄枢自己的兜底。`dataDir` 排在 `$DSH_HOME` **之前**是有意的：skill 的落地根必须与数据目录同源
 * （断言台 / 隔离实例显式给了 dataDir 却让一个不相干的 `$DSH_HOME` 把 skill 写到别处，是最难查的错位）。
 *
 * **任何一档解析到真实 `~/.dsh`（或其子目录）都改判兜底**，并在 `note` 里说明为什么 ——
 * 这是 ADR-0014 那道门在扫描链上的唯一落点（从前 `shiji/scan.mjs` 与 `workflow/service.mjs`
 * 各抄了一份顺序，而且都没有这道门）。
 *
 * @param {{ctx?: object, dataDir?: string, explicit?: string,
 *          env?: Record<string, string|undefined>, homedirPath?: string}} [options]
 * @returns {{home: string, source: string, realDsh: boolean, note?: string}}
 */
export function resolveSearchHome({ ctx, dataDir, explicit, env = process.env, homedirPath = homedir() } = {}) {
  let candidate
  let source
  if (!isBlank(explicit)) {
    candidate = explicit
    source = 'explicit'
  } else {
    const profile = softGet(ctx, 'profileContext')
    if (typeof profile?.home === 'string' && profile.home !== '') {
      candidate = profile.home
      source = 'profileContext.home'
    } else if (typeof dataDir === 'string' && dataDir !== '' && basename(dataDir) === DATA_DIR_NAME) {
      candidate = dirname(dataDir)
      source = 'dataDir parent'
    } else if (typeof env?.[DSH_HOME_ENV] === 'string' && env[DSH_HOME_ENV] !== '') {
      candidate = env[DSH_HOME_ENV]
      source = DSH_HOME_ENV
    } else {
      const fallback = fallbackXuanshuHome({ env, homedirPath })
      candidate = fallback.home
      source = fallback.source
    }
  }

  if (pointsAtRealDshHome(candidate, { homedirPath })) {
    const fallback = fallbackXuanshuHome({ env, homedirPath })
    return {
      home: fallback.home,
      source: fallback.source,
      realDsh: true,
      note: `skill 扫描根解析到用户真实的 DSH 桌面版 home（${candidate}，来源 ${source}）：`
        + `玄枢与 DSH 桌面版零交集，绝不读写 ~/.dsh —— 本次改用玄枢自己的 home（${fallback.home}）。`
        + `改法：让 DSH 用玄枢自己的 home 启动（DSH_HOME=<玄枢 home>，或设 ${XUANSHU_HOME_ENV}）。`,
    }
  }
  return { home: candidate, source, realDsh: false }
}
