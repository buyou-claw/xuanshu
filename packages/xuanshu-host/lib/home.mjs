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
 * 本文件只做三件事，全是纯函数：
 *   1. `realDshHome()` / `pointsAtRealDshHome()`：**唯一一份**「真实 home」判据（等于**或落在**里面都算）；
 *   2. `fallbackXuanshuHome()`：兜底改成玄枢自己的 home（`XUANSHU_DSH_HOME` ＞ `~/.xuanshu`），
 *      **绝不** `~/.dsh`；
 *   3. `resolveHostHome()`：`profileContext.home` ＞ `$DSH_HOME` ＞ 兜底，并把 `source` 与
 *      「是否指向真实 home」一起回传（报告/notes 要能说清这个值是哪来的）。
 *
 * 边界：本文件不读盘、不建目录、不判断档位（产品档 `~/.xuanshu` 是这里的兜底；开发档由脚本侧
 * 显式传 `DSH_HOME=<repo>/.dsh-home`，宿主只认环境，不猜仓库位置）。
 */

import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

/** 玄枢自己的 home 目录名（产品档；ADR-0014）。 */
export const PRODUCT_HOME_DIR_NAME = '.xuanshu'
/** 本仓自己的 home 覆盖变量（与 `scripts/isolation/resolve.mjs` 同一个名字，壳会设它）。 */
export const XUANSHU_HOME_ENV = 'XUANSHU_DSH_HOME'
/** DSH 自己的 home 变量（`@deepseek-ai/dsh-home-paths` 认的就是它）。 */
export const DSH_HOME_ENV = 'DSH_HOME'
/** DSH 桌面版的 home 目录名：只许被**拒绝**，绝不许被当成玄枢的家。 */
export const REAL_DSH_HOME_DIR_NAME = '.dsh'

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
