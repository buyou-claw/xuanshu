/**
 * packages/xuanshu-host/lib/horosa/paths.mjs
 *
 * 路径解析（票 06 契约 §3.1 冻结签名）：
 *   resolveHorosaPaths({ dshHome, config, env, platform })
 *     -> { dshHome, dataDir, runtimeRoot, cacheDir, serveLogFile, statusFile, setupReportFile }
 *   loopbackHost(value) -> 回环字面量原样返回，否则 null
 *
 * 解析优先级（每条都能被测试注入点覆盖，见契约 §3.2 R10）：
 *   dshHome   = 入参（调用方已解析的 home）?? `home.mjs` 的 `resolveHostHome`（`profileContext.home`
 *               ＞ `$DSH_HOME` ＞ 玄枢自己的兜底；本层**不再自己串联**）
 *   dataDir   = config.dataDir ?? $XUANSHU_HOROSA_DATA_DIR ?? <dshHome>/xuanshu/horosa
 *   runtimeRoot = config.runtimeRoot ?? $HOROSA_RUNTIME_ROOT ?? win32 `C:\horosa` / posix `~/.horosa/runtime`
 *   cacheDir  = $XUANSHU_CACHE ?? win32 `%LOCALAPPDATA%\xuanshu\cache` / posix `~/.cache/xuanshu`
 *   uvxBin    （不在本文件，见 plan.mjs）= config.uvxBin ?? $XUANSHU_UVX_BIN ?? `uvx.exe`(win32) / `uvx`
 *
 * **真实 `~/.dsh` 的门（ADR-0014，复核 C2）**：任何一档解析出的 home 落在用户真实的 DSH 桌面版 home
 * （等于或在其子目录）都改判玄枢自己的兜底，并把原因写进回执的 `note`（additive；不进契约 §3.1 的七键）。
 * 判据只有一份 —— `home.mjs::pointsAtRealDshHome`，本文件不另写。
 *
 * 三个落点定值：`<dataDir>/serve.log`（R3 的日志 fd 落点）、`<dataDir>/horosa-status.json`（R7）、
 * `<dshHome>/xuanshu/setup-report.json`（票 05 §7 的报告，`resolveHorosaPlan` 从它取 pin 版本）。
 * runtimeRoot / cacheDir 的缺省出处：`.scratch/assembly-foundation/notes/setup-contract.md` §2。
 *
 * 仅用 Node 内置模块，零第三方依赖；不抛异常（解析不出来就给缺省值，由调用方按「读不到」处置）。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import { fallbackXuanshuHome, pointsAtRealDshHome, resolveHostHome, XUANSHU_HOME_ENV } from '../home.mjs'
import { HOROSA_SERVE_LOG_FILENAME, HOROSA_STATUS_FILENAME } from './constants.mjs'

/** 数据目录名（`<dshHome>/xuanshu/`，票 01/04/05 同款「一切归你」目录）。 */
const DATA_DIR_NAME = 'xuanshu'

/** 回环字面量白名单：只有这三个能进（非回环不暴露，契约 §2.3/§3.2 R6）。 */
const LOOPBACK_LITERALS = ['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']

/** 非空字符串规范化（`''`/空白/非字符串一律折算成空串）。 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 读环境变量（只认非空串，避免 `KEY=` 把缺省值顶掉）。 */
function envText(env, key) {
  return env && typeof env === 'object' ? text(env[key]) : ''
}

/**
 * 回环字面量判定（契约 §3.1：**原样返回**，不是归一化）。
 * 接受的写法：`127.0.0.1` / `localhost`（大小写不敏感）/ `::1` / `[::1]` / 全零 IPv6 写法。
 * 其余（含 `0.0.0.0`、`::`、任何域名或 IP）一律 null —— fail-closed：不认识的写法不算回环。
 * @returns {string|null} 命中的字面量（去掉首尾空白后的原文），否则 null。
 */
export function loopbackHost(value) {
  const raw = text(value)
  if (raw === '') return null
  const bare = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1).trim().toLowerCase() : raw.toLowerCase()
  return LOOPBACK_LITERALS.includes(bare) ? raw : null
}

/** win32 的 runtime 根缺省：`C:\horosa`（上游 install 的目标；setup-contract §2）。 */
function defaultRuntimeRoot(platform) {
  return platform === 'win32' ? 'C:\\horosa' : join(homedir(), '.horosa', 'runtime')
}

/**
 * 工件缓存目录缺省：win32 `%LOCALAPPDATA%\xuanshu\cache`，posix `~/.cache/xuanshu`
 * （setup-contract §2 的 `--cache` 缺省）。
 */
function defaultCacheDir(platform, env) {
  if (platform === 'win32') {
    const localAppData = envText(env, 'LOCALAPPDATA')
    const base = localAppData !== '' ? localAppData : join(homedir(), 'AppData', 'Local')
    return join(base, 'xuanshu', 'cache')
  }
  return join(homedir(), '.cache', 'xuanshu')
}

/**
 * 解析 horosa 的四个路径（纯函数，不建目录、不读盘）。
 * @param {object} [options]
 * @param {string} [options.dshHome] 调用方**已解析**的 DSH home（缺省走 `home.mjs::resolveHostHome`）
 * @param {object} [options.config]  补丁行的 config（认 `dataDir` / `runtimeRoot`）
 * @param {object} [options.env]     `process.env` 的形状（测试注入点）
 * @param {string} [options.platform] `process.platform` 的形状（测试注入点）
 * @param {string} [options.homedirPath] 用户家目录的形状（测试注入点；只给「真实 home」判据用）
 */
export function resolveHorosaPaths({ dshHome, config = {}, env = process.env, platform = process.platform, homedirPath } = {}) {
  const seam = homedirPath === undefined ? {} : { homedirPath }
  const explicit = text(dshHome)
  // home 的解析只在 `home.mjs` 里：本层要么收调用方已解析好的那一份，要么把「没有」交给同一实现。
  const resolvedHome = explicit !== ''
    ? { home: explicit, source: 'dshHome' }
    : resolveHostHome({ env, ...seam })
  // ADR-0014 的门只有一份判据（`pointsAtRealDshHome`）：真实 ~/.dsh 绝不当地基目录。
  const rejected = pointsAtRealDshHome(resolvedHome.home, seam)
  const home = rejected ? fallbackXuanshuHome({ env, ...seam }).home : resolvedHome.home
  const cfg = config && typeof config === 'object' ? config : {}
  const dataDir = text(cfg.dataDir) || envText(env, 'XUANSHU_HOROSA_DATA_DIR') || join(home, DATA_DIR_NAME, 'horosa')
  const runtimeRoot = text(cfg.runtimeRoot) || envText(env, 'HOROSA_RUNTIME_ROOT') || defaultRuntimeRoot(platform)
  const cacheDir = envText(env, 'XUANSHU_CACHE') || defaultCacheDir(platform, env)

  const resolved = {
    dshHome: home,
    dataDir,
    runtimeRoot,
    cacheDir,
    serveLogFile: join(dataDir, HOROSA_SERVE_LOG_FILENAME),
    statusFile: join(dataDir, HOROSA_STATUS_FILENAME),
    setupReportFile: envText(env, 'XUANSHU_SETUP_REPORT') || join(home, DATA_DIR_NAME, 'setup-report.json'),
  }
  if (rejected) {
    resolved.note = `horosa 的 dshHome 解析到用户真实的 DSH 桌面版 home（${resolvedHome.home}，来源 ${resolvedHome.source}）：`
      + `玄枢与 DSH 桌面版零交集，绝不读写 ~/.dsh —— 本次改用玄枢自己的 home（${home}）。`
      + `改法：让 DSH 用玄枢自己的 home 启动（DSH_HOME=<玄枢 home>，或设 ${XUANSHU_HOME_ENV}）。`
  }
  return resolved
}
