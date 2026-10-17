/**
 * scripts/setup/paths.mjs — 「这次的目录长什么样」与两道纯环境门（票 05 契约 §2、§4.1、§6）。
 *
 * 分两层，别混：
 *   - **解析**（`resolveSetupPaths`）：把 CLI 参数 + 环境变量 + 平台默认值折成一组绝对路径，
 *     并说明每一项**是哪来的**（报告 notes 必须能回答「这个 C:\horosa 是谁定的」）；
 *   - **门**（`checkAsciiRuntimeRoot` / `checkRealHomePolicy`）：纯判断，返回 `{ok, detail, hint}`，
 *     不抛、不写盘、不发请求 —— 这样 `--dry-run` 能原样复用（干跑也要能告诉你「这次会被拒」）。
 *
 * 复用票 04 而不是新造：
 *   - 缓存/根目录之外的 dsh-home 解析走 `scripts/isolation/resolve.mjs::resolveHomeWithSource`
 *     （含 R16 裁决：**环境里带的 `DSH_HOME` 指向真实 `~/.dsh` 时忽略并记 notes**），
 *     否则在一个 DSH 会话里跑 setup 会撞真实 home 门，等于一条命令开箱不可用；
 *   - 同款裁决也用在数据目录上（A6）：**环境里带的 `HOROSA_SKILL_DATA_DIR` 指向真实 `~/.horosa`
 *     时忽略并记 notes**（显式 CLI 才是硬门，见 `resolveDataDir`），否则契约 §6 的
 *     「缺省绝不写真实 `~/.horosa`」只在没人设环境变量时成立；
 *   - 端口解析走 `resolveInstance`（`--horosa-port` ＞ `XUANSHU_HOROSA_PORT` ＞ `HOROSA_SKILL_PORT` ＞ 8765），
 *     本文件**不出现 8765 字面量**。
 *
 * 仅使用 Node 内置模块。ESM。
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import { DATA_DIR_NAME, ENV, HOROSA_MCP_PATH, PROBE_HOST } from '../isolation/defaults.mjs'
import { isUnderPath, realDshHome, resolveHomeWithSource, resolveInstance, samePath } from '../isolation/resolve.mjs'

/** 缓存目录的环境变量覆盖（契约 §2 参数表）。 */
export const CACHE_ENV = 'XUANSHU_CACHE'
/** runtime 根的环境变量覆盖 —— 也是上游 `install`/`doctor` 自己认的那个名字。 */
export const RUNTIME_ROOT_ENV = 'HOROSA_RUNTIME_ROOT'
/** 数据目录的环境变量覆盖（上游认的那个名字）。 */
export const DATA_DIR_ENV = 'HOROSA_SKILL_DATA_DIR'
/** horosa serve 自己的 host 变量（缺省 127.0.0.1，见 captures/horosa-cli/serve-help.txt）。 */
export const HOROSA_HOST_ENV = 'HOROSA_SKILL_HOST'

/** `C:\horosa`：win32 的 runtime 根缺省值（纯 ASCII，见 §0 表「Windows runtime 根」）。 */
export const WINDOWS_RUNTIME_ROOT = 'C:\\horosa'

/** 非空白字符串才算「设了」（空串/纯空白当未设，避免 `--cache ""` 折成当前目录）。 */
const isBlank = (value) => typeof value !== 'string' || value.trim() === ''

/* ───────────────────────────── 目录解析 ───────────────────────────── */

/**
 * 缓存目录：`--cache` ＞ `$XUANSHU_CACHE` ＞ win32 `%LOCALAPPDATA%\xuanshu\cache` ＞ `~/.cache/xuanshu`。
 * `%LOCALAPPDATA%` 缺失或空白时同样回落到 `~/.cache/xuanshu`（win32/posix 一支回落）。
 */
export function resolveCacheDir({ cache, env = process.env, platform = process.platform } = {}) {
  if (!isBlank(cache)) return { dir: resolve(cache), source: '--cache' }
  if (!isBlank(env?.[CACHE_ENV])) return { dir: resolve(env[CACHE_ENV]), source: CACHE_ENV }
  const localAppData = env?.LOCALAPPDATA
  if (platform === 'win32' && !isBlank(localAppData)) {
    return { dir: join(resolve(localAppData), 'xuanshu', 'cache'), source: '%LOCALAPPDATA%' }
  }
  return { dir: join(homedir(), '.cache', 'xuanshu'), source: '~/.cache/xuanshu' }
}

/** runtime 根：`--runtime-root` ＞ `$HOROSA_RUNTIME_ROOT` ＞ win32 `C:\horosa` ＞ posix `~/.horosa/runtime`。 */
export function resolveRuntimeRoot({ runtimeRoot, env = process.env, platform = process.platform } = {}) {
  if (!isBlank(runtimeRoot)) return { dir: resolve(runtimeRoot), source: '--runtime-root' }
  if (!isBlank(env?.[RUNTIME_ROOT_ENV])) return { dir: resolve(env[RUNTIME_ROOT_ENV]), source: RUNTIME_ROOT_ENV }
  if (platform === 'win32') return { dir: resolve(WINDOWS_RUNTIME_ROOT), source: 'default (C:\\horosa)' }
  return { dir: join(homedir(), '.horosa', 'runtime'), source: 'default (~/.horosa/runtime)' }
}

/**
 * 数据目录：`$HOROSA_SKILL_DATA_DIR` ＞ `<dsh-home>/xuanshu/horosa`（「一切归你」的数据目录）。
 *
 * 真实 `~/.horosa` 的守卫（A6，与票 04 R16 对 `DSH_HOME` 的裁决同款、同方向）：
 * 环境里带着的 `HOROSA_SKILL_DATA_DIR` 若**等于**或**落在**真实 `~/.horosa` 里 → **忽略并记一条 note**，
 * 退回 `<dsh-home>/xuanshu/horosa`。理由与 R16 完全一样：这条变量可能是别的会话/别的工具留在环境里的，
 * 照单全收就会在「一条命令」里静默写用户真实数据目录 —— 而契约 §6 说死了「数据目录一律
 * `<dsh-home>/xuanshu/horosa`」。
 *
 * 「显式」的 data 目录（CLI）才是硬门：本票参数表里**没有** data 目录的 CLI 开关，所以 `explicit`
 * 目前恒为 undefined；将来加了就在下面那一支补「指向真实 `~/.horosa` → 要求 `--install`，否则 exit 3」，
 * 与 `--dsh-home` 的硬门对称（函数签名已经把位置留好）。
 *
 * @returns {{ dir: string, source: string, ignored: string[] }}
 */
export function resolveDataDir({ dshHome, env = process.env, explicit, realHorosaHome = realHorosaDataHome() } = {}) {
  const fallback = { dir: join(dshHome, DATA_DIR_NAME, 'horosa'), source: `<dsh-home>/${DATA_DIR_NAME}/horosa` }
  if (!isBlank(explicit)) return { ...fallback, dir: resolve(explicit), source: '--data-dir（尚未落地）' }
  if (!isBlank(env?.[DATA_DIR_ENV])) {
    const candidate = resolve(env[DATA_DIR_ENV])
    if (samePath(candidate, realHorosaHome) || isUnderPath(realHorosaHome, candidate)) {
      return {
        ...fallback,
        ignored: [`${DATA_DIR_ENV}=${candidate} 指向用户真实 horosa 数据目录（${realHorosaHome}），已忽略（改用 <dsh-home>/${DATA_DIR_NAME}/horosa）`],
      }
    }
    return { dir: candidate, source: DATA_DIR_ENV, ignored: [] }
  }
  return { ...fallback, ignored: [] }
}

/** 本机用户真实 horosa 数据目录（`~/.horosa`）。只用来**拒绝**它，绝不用来写。 */
export function realHorosaDataHome() {
  return join(homedir(), '.horosa')
}

/** 报告文件路径（契约 §7：唯一机器可读产物）。 */
export function reportFileOf(dshHome) {
  return join(dshHome, DATA_DIR_NAME, 'setup-report.json')
}

/** 大输出落盘目录（契约 §7：证据只放小体积字段，大输出进这里）。 */
export function logsDirOf(dshHome) {
  return join(dshHome, DATA_DIR_NAME, 'logs')
}

/** horosa MCP 端点路径（复用票 04 常量，不新造 `/mcp`）。 */
export function horosaMcpPath() {
  return HOROSA_MCP_PATH
}

/**
 * horosa serve 的 host：读 `HOROSA_SKILL_HOST`（上游 serve 认的那个），缺省回环地址。
 * 为什么读它：serve 绑的不是 127.0.0.1 时，我们拿 127.0.0.1 去探会永远探不到 —— 端口问题的
 * 第一句问话又是「它到底绑在哪」。
 */
export function resolveHorosaHost({ env = process.env } = {}) {
  const raw = env?.[HOROSA_HOST_ENV]
  return { host: isBlank(raw) ? PROBE_HOST : String(raw).trim(), source: isBlank(raw) ? 'default (127.0.0.1)' : HOROSA_HOST_ENV }
}

/**
 * 一次性算全这次运行用到的每条路径（报告的 pin/runtime/profile 段直接引用它）。
 *
 * `home` 走票 04 的 `resolveHomeWithSource`：显式 `--dsh-home` ＞ `XUANSHU_DSH_HOME` ＞ `$DSH_HOME`
 * （**仅当不指向真实 `~/.dsh`**）＞ 默认两档（ADR-0014）：dev `<repo>/.dsh-home` / product `~/.xuanshu`。
 * 返回里带 `ignored`，调用方要把它写进 notes。
 */
export function resolveSetupPaths({
  home, profile, cache, runtimeRoot, horosaPort, env = process.env, repoRoot, platform = process.platform,
} = {}) {
  const resolvedHome = resolveHomeWithSource({ home, env, repoRoot })
  const cacheResolved = resolveCacheDir({ cache, env, platform })
  const rootResolved = resolveRuntimeRoot({ runtimeRoot, env, platform })
  const dataResolved = resolveDataDir({ dshHome: resolvedHome.home, env })
  const host = resolveHorosaHost({ env })
  // 端口解析只走票 04（--horosa-port ＞ XUANSHU_HOROSA_PORT ＞ HOROSA_SKILL_PORT ＞ 8765）；
  // resolveInstance 顺带把实例的每条派生路径算出来，但我们只取端口，别把它的 home 当我们的 home。
  const instance = resolveInstance({ home: resolvedHome.home, profile, horosaPort, repoRoot, env })

  return {
    home: resolvedHome.home,
    homeSource: resolvedHome.source,
    homeIgnored: resolvedHome.ignored ?? [],
    realHome: resolvedHome.realHome ?? realDshHome(),
    profile: instance.profile,
    profileDir: instance.profileDir,
    cacheDir: cacheResolved.dir,
    cacheSource: cacheResolved.source,
    runtimeRoot: rootResolved.dir,
    runtimeRootSource: rootResolved.source,
    dataDir: dataResolved.dir,
    dataDirSource: dataResolved.source,
    // 被忽略的环境覆盖（`DSH_HOME` / `HOROSA_SKILL_DATA_DIR` 指向真实用户目录）：调用方必须写进 report.notes。
    dataDirIgnored: dataResolved.ignored ?? [],
    horosaPort: instance.horosaPort,
    horosaPortSource: instance.portSources?.horosa ?? 'default',
    horosaHost: host.host,
    horosaHostSource: host.source,
    horosaPath: horosaMcpPath(),
    reportFile: reportFileOf(resolvedHome.home),
    logsDir: logsDirOf(resolvedHome.home),
    dataDirName: DATA_DIR_NAME,
    envHomeName: ENV.home,
  }
}

/* ───────────────────────────── 两道纯门 ───────────────────────────── */

/**
 * win32 的 runtime 根必须是**绝对**且**纯 ASCII**（契约 §4.1，与上游 `windows_runtime_path_ok` 同口径）。
 *
 * 为什么：随包的 java.exe 与 Swiss Ephemeris 用窄字符 API，非 ASCII 根会在**下载清单之前**就被拒
 * （上游 `runtime.path_not_ascii`）。这道门必须跑在任何网络/写盘动作之前 —— 否则先把 719MB 拉下来，
 * 再告诉你「这机器装不了」。
 *
 * posix 不做此门（保留 `--runtime-root` 覆盖，但只查绝对路径）。
 */
export function checkAsciiRuntimeRoot(root, { platform = process.platform } = {}) {
  const path = String(root ?? '')
  if (!isAbsolute(path)) {
    return {
      ok: false,
      detail: `runtime 根必须是绝对路径：${JSON.stringify(path)}`,
      hint: `# Windows: setx ${RUNTIME_ROOT_ENV} "C:\\horosa"    # 或 PowerShell: $env:${RUNTIME_ROOT_ENV}='C:\\horosa'`,
    }
  }
  if (platform !== 'win32') return { ok: true, detail: `${path}（posix 无 ASCII 门）` }
  if (/^[\x20-\x7E]+$/.test(path)) return { ok: true, detail: `${path} 是纯 ASCII 绝对路径` }
  return {
    ok: false,
    detail: `Windows 上 runtime 根必须纯 ASCII，而 ${JSON.stringify(path)} 含非 ASCII 字符`
      + '（随包的 java.exe 与 Swiss Ephemeris 用窄字符 API，非 ASCII 根会在解包/启动阶段挂起）。',
    hint: [
      `# 改成纯 ASCII 根（本机可用的是 ${WINDOWS_RUNTIME_ROOT}）:`,
      `#   PowerShell: setx ${RUNTIME_ROOT_ENV} "${WINDOWS_RUNTIME_ROOT}"    # 重开终端后生效`,
      `#   本次调用: node scripts/setup.mjs --runtime-root "${WINDOWS_RUNTIME_ROOT}"`,
      `# 上游 doctor 会报 windows:runtime_root_not_ascii，install 会以 runtime.path_not_ascii 拒装 —— 同口径。`,
    ].join('\n'),
  }
}

/**
 * 真实 `~/.dsh` 必须显式 `--install` 才允许（契约 §6）。
 *
 * 判据（比契约的「等于」严一档，方向是「更安全」）：解析结果**等于**真实 home，或**落在**它里面
 * （`~/.dsh/profiles/xuanshu` 这种更危险），都要 `--install`。
 */
export function checkRealHomePolicy({ home, install, realHome = realDshHome() } = {}) {
  const target = String(home ?? '')
  const hits = samePath(target, realHome) || isUnderPath(realHome, target)
  if (!hits || install) return { ok: true, detail: install ? `${target}（已显式 --install）` : `${target} 不是真实 DSH home` }
  return {
    ok: false,
    detail: `拒绝写真实 DSH home：${target}（= 本机 ${realHome}${samePath(target, realHome) ? '' : ' 的子路径'}）。`
      + '缺省绝不碰它 —— 装错 home 会改掉你正在用的桌面端/网页端实例。',
    hint: [
      `# 推荐（隔离装配，完全不动真实 home）:`,
      `#   node scripts/setup.mjs --dsh-home <repo>\\.dsh-home`,
      `# 产品安装（玄枢自己的 home）:`,
      `#   node scripts/setup.mjs --dsh-home "%USERPROFILE%\\.xuanshu"   # 或设 $env:XUANSHU_DSH_HOME`,
      `# 确实要装进真实 home 才加 --install:`,
      `#   node scripts/setup.mjs --install --dsh-home "${realHome}"`,
    ].join('\n'),
  }
}
