/**
 * packages/xuanshu-shell/lib/dsh-entry.mjs — 找到 DSH CLI、拼命令、拼子进程环境（冻结契约 §0）。
 *
 * 契约 §0（逐字）：
 *   - 命令：`node <profile 里的 dsh/bin.js> --profile xuanshu --port 19388 --no-open`
 *   - 入口解析：`XUANSHU_DSH_BIN` > `<home>/profiles/xuanshu/node_modules/@deepseek-ai/dsh/lib/bin.js` > PATH `dsh`
 *   - 子进程 env：`DSH_HOME` / `XUANSHU_DSH_HOME` / `XUANSHU_SHELL_NOTIFY_STATE` / `XUANSHU_SHELL_PID`，其余继承
 *
 * 三条纪律：
 *   1. **不静默退回**：显式给了 `XUANSHU_DSH_BIN` 却解析不出来 → 报 `env-missing`，不偷偷换一个入口；
 *   2. **不猜 node**：Electron 的 `process.execPath` 是 electron.exe，把它当 node 会起不来 ——
 *      node 可执行文件由 `XUANSHU_NODE_BIN` 覆盖，缺省是 PATH 上的 `node`；
 *   3. **Windows 的 npm shim 是真 shim**：`dsh.cmd` 不能被 `spawn` 直接执行（Node 要求 shell），
 *      这里显式走 `cmd.exe /d /s /c`，而不是「失败了再说」。
 *
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  DEFAULT_PROFILE,
  DEFAULT_WEB_PORT,
  DSH_HOME_ENV,
  DSH_PACKAGE,
  ENV,
  NOTIFY_STATE_ENV,
  SHELL_PID_ENV,
} from './contract.mjs'
import { shellPaths } from './home.mjs'

const isBlank = (value) => typeof value !== 'string' || value.trim() === ''

/** Windows 上默认按这个顺序找可执行文件（与 cmd 的 PATHEXT 语义一致）。 */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

/**
 * 在 PATH 里找一个可执行文件（只查存在性，不执行）。
 *
 * @param {string} name 不带扩展名的命令名
 * @param {{env?: Record<string, string|undefined>, platform?: string, fsExists?: (path: string) => boolean}} [options]
 * @returns {string|undefined}
 */
export function findExecutableOnPath(name, { env = {}, platform = process.platform, fsExists = existsSync } = {}) {
  const separator = platform === 'win32' ? ';' : ':'
  const pathValue = env.PATH ?? env.Path ?? ''
  const extensions = platform === 'win32'
    // PATHEXT 通常是全大写（`.EXE`），但拼出来的文件名要长得像真文件；Windows 不区分大小写，
    // 统一小写更不会在日志里出现「dsh.CMD 找不到」这种自相矛盾的提示。
    ? String(env.PATHEXT ?? DEFAULT_PATHEXT).split(';').filter((ext) => ext !== '').map((ext) => ext.toLowerCase())
    : ['']
  for (const dir of String(pathValue).split(separator)) {
    if (dir === '') continue
    for (const extension of extensions) {
      const candidate = join(dir, `${name}${extension}`)
      if (fsExists(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * 解析 DSH 入口（纯函数；文件系统与 PATH 查询都可注入）。
 *
 * @param {{home: string, profile?: string, env?: Record<string, string|undefined>,
 *          fsExists?: (path: string) => boolean, pathLookup?: (name: string) => string|undefined,
 *          platform?: string}} options
 * @returns {{ok: true, source: 'env', binJs: string}
 *          |{ok: true, source: 'profile', binJs: string}
 *          |{ok: true, source: 'path', executable: string}
 *          |{ok: false, reason: 'env-missing'|'not-found', detail: string}}
 */
export function resolveDshEntry({
  home, profile = DEFAULT_PROFILE, env = {}, fsExists = existsSync, pathLookup, platform = process.platform,
} = {}) {
  const lookup = typeof pathLookup === 'function'
    ? pathLookup
    : (name) => findExecutableOnPath(name, { env, platform, fsExists })

  const explicit = env?.[ENV.dshBin]
  if (!isBlank(explicit)) {
    if (fsExists(explicit)) return { ok: true, source: 'env', binJs: resolve(explicit) }
    return {
      ok: false,
      reason: 'env-missing',
      detail: `${ENV.dshBin} 指向的 DSH 入口不存在：${explicit}（显式指定就不静默退回别的入口）`,
    }
  }

  const profileBinJs = join(home, 'profiles', profile, 'node_modules', ...DSH_PACKAGE.split('/'), 'lib', 'bin.js')
  if (fsExists(profileBinJs)) return { ok: true, source: 'profile', binJs: profileBinJs }

  const executable = lookup('dsh')
  if (!isBlank(executable)) return { ok: true, source: 'path', executable }

  return {
    ok: false,
    reason: 'not-found',
    detail: `找不到 DSH CLI：${profileBinJs} 不存在，PATH 上也没有 dsh`
      + '（先跑 node scripts/install-profile.mjs 装配 profile，或设 ' + ENV.dshBin + '）',
  }
}

/** 把一个参数按 Windows 命令行规则包起来（我们的参数不含空格，这里只是不赌将来）。 */
function quoteWindowsArg(value) {
  const text = String(value)
  return /[\s"]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text
}

/**
 * 拼出「怎么起子进程」。
 *
 * @param {{entry: {ok: true, binJs?: string, executable?: string}, profile?: string, port?: number,
 *          nodeBin?: string, platform?: string, comspec?: string}} options
 * @returns {{command: string, args: string[], windowsVerbatimArguments?: boolean, display: string}}
 */
export function buildDshInvocation({
  entry, profile = DEFAULT_PROFILE, port = DEFAULT_WEB_PORT, nodeBin = 'node',
  platform = process.platform, comspec = process.env.ComSpec ?? 'cmd.exe',
} = {}) {
  if (entry === undefined || entry === null || entry.ok !== true) {
    throw new Error(`cannot build the DSH command: the entry did not resolve (${JSON.stringify(entry?.reason ?? entry)})`)
  }
  if (isBlank(profile)) throw new Error('cannot build the DSH command: profile is required')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`cannot build the DSH command: invalid port ${JSON.stringify(port)} (expected an integer 1..65535)`)
  }

  const dshArgs = ['--profile', String(profile), '--port', String(port), '--no-open']

  if (!isBlank(entry.binJs)) {
    const command = isBlank(nodeBin) ? 'node' : String(nodeBin)
    const args = [entry.binJs, ...dshArgs]
    return { command, args, display: [command, ...args].map(quoteWindowsArg).join(' ') }
  }

  const executable = String(entry.executable)
  if (platform === 'win32' && /\.(cmd|bat)$/iu.test(executable)) {
    // cmd /d /s /c 需要「整条命令」一个参数；`windowsVerbatimArguments` 让 Node 不再二次加引号。
    const commandLine = `""${executable}" ${dshArgs.map(quoteWindowsArg).join(' ')}"`
    const args = ['/d', '/s', '/c', commandLine]
    return {
      command: isBlank(comspec) ? 'cmd.exe' : String(comspec),
      args,
      windowsVerbatimArguments: true,
      display: [executable, ...dshArgs].map(quoteWindowsArg).join(' '),
    }
  }
  return { command: executable, args: dshArgs, display: [executable, ...dshArgs].map(quoteWindowsArg).join(' ') }
}

/**
 * 拼子进程环境：契约点名的四个变量 + 继承的其余变量。
 *
 * 为什么 `DSH_HOME` 必须由壳**覆盖写**（而不是只在缺席时补）：父进程环境里常年带着
 * `DSH_HOME=C:\Users\<me>\.dsh`（DSH 桌面版自己的 home）。照单全收 = 玄枢的会话/凭据落进 desktop 的家，
 * ADR-0014 的「零交集」当场破功。这里是最后一道兜底，调用方传错 home 也覆盖掉。
 *
 * @param {{home: string, shellPid: number, baseEnv?: Record<string, string|undefined>}} options
 * @returns {Record<string, string>}
 */
export function buildChildEnv({ home, shellPid, baseEnv = {} } = {}) {
  if (isBlank(home)) throw new Error('cannot build the child env: home is required')
  if (!Number.isInteger(shellPid) || shellPid <= 0) {
    throw new Error(`cannot build the child env: shell pid must be a positive integer (got ${JSON.stringify(shellPid)})`)
  }
  const paths = shellPaths(home)
  const env = {}
  for (const [key, value] of Object.entries(baseEnv ?? {})) {
    if (value === undefined) continue
    env[key] = String(value)
  }
  env[DSH_HOME_ENV] = paths.home
  env[ENV.home] = paths.home
  env[NOTIFY_STATE_ENV] = paths.notifyStateFile
  env[SHELL_PID_ENV] = String(shellPid)
  return env
}
