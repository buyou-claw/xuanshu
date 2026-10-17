/**
 * packages/xuanshu-host/lib/horosa/paths.mjs
 *
 * 路径解析（票 06 契约 §3.1 冻结签名）：
 *   resolveHorosaPaths({ dshHome, config, env, platform })
 *     -> { dshHome, dataDir, runtimeRoot, cacheDir, serveLogFile, statusFile, setupReportFile }
 *   loopbackHost(value) -> 回环字面量原样返回，否则 null
 *
 * 解析优先级（每条都能被测试注入点覆盖，见契约 §3.2 R10）：
 *   dshHome   = 入参 ?? $DSH_HOME ?? <home>/.dsh（DSH 官方缺省；与票 01 的 `resolveDshHome` 同口径）
 *   dataDir   = config.dataDir ?? $XUANSHU_HOROSA_DATA_DIR ?? <dshHome>/xuanshu/horosa
 *   runtimeRoot = config.runtimeRoot ?? $HOROSA_RUNTIME_ROOT ?? win32 `C:\horosa` / posix `~/.horosa/runtime`
 *   cacheDir  = $XUANSHU_CACHE ?? win32 `%LOCALAPPDATA%\xuanshu\cache` / posix `~/.cache/xuanshu`
 *   uvxBin    （不在本文件，见 plan.mjs）= config.uvxBin ?? $XUANSHU_UVX_BIN ?? `uvx.exe`(win32) / `uvx`
 *
 * 三个落点定值：`<dataDir>/serve.log`（R3 的日志 fd 落点）、`<dataDir>/horosa-status.json`（R7）、
 * `<dshHome>/xuanshu/setup-report.json`（票 05 §7 的报告，`resolveHorosaPlan` 从它取 pin 版本）。
 * runtimeRoot / cacheDir 的缺省出处：`.scratch/assembly-foundation/notes/setup-contract.md` §2。
 *
 * 仅用 Node 内置模块，零第三方依赖；不抛异常（解析不出来就给缺省值，由调用方按「读不到」处置）。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import { fallbackXuanshuHome } from '../home.mjs'
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
 * @param {string} [options.dshHome] 覆盖 DSH home（缺省 `$DSH_HOME` → `~/.dsh`）
 * @param {object} [options.config]  补丁行的 config（认 `dataDir` / `runtimeRoot`）
 * @param {object} [options.env]     `process.env` 的形状（测试注入点）
 * @param {string} [options.platform] `process.platform` 的形状（测试注入点）
 */
export function resolveHorosaPaths({ dshHome, config = {}, env = process.env, platform = process.platform } = {}) {
  // 兜底是**玄枢自己的 home**（`XUANSHU_DSH_HOME` ＞ `~/.xuanshu`），不是 `~/.dsh`（ADR-0014）。
  const home = text(dshHome) || envText(env, 'DSH_HOME') || fallbackXuanshuHome({ env }).home
  const cfg = config && typeof config === 'object' ? config : {}
  const dataDir = text(cfg.dataDir) || envText(env, 'XUANSHU_HOROSA_DATA_DIR') || join(home, DATA_DIR_NAME, 'horosa')
  const runtimeRoot = text(cfg.runtimeRoot) || envText(env, 'HOROSA_RUNTIME_ROOT') || defaultRuntimeRoot(platform)
  const cacheDir = envText(env, 'XUANSHU_CACHE') || defaultCacheDir(platform, env)

  return {
    dshHome: home,
    dataDir,
    runtimeRoot,
    cacheDir,
    serveLogFile: join(dataDir, HOROSA_SERVE_LOG_FILENAME),
    statusFile: join(dataDir, HOROSA_STATUS_FILENAME),
    setupReportFile: envText(env, 'XUANSHU_SETUP_REPORT') || join(home, DATA_DIR_NAME, 'setup-report.json'),
  }
}
