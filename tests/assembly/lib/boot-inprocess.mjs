#!/usr/bin/env node
/**
 * boot-inprocess.mjs — S2 的进程内装配探针（玄枢装配契约测试台的内部执行体）。
 *
 * 为什么单独一个进程：S2 走 DSH 官方进程内 API（`loadProfile` / `createRuntimeResolution` /
 * `readProfilePatches` / `boot`），复刻 `runProfile` 的装配过程。DSH 会在进程里装全局
 * handler、写 stdout、跑 loader；把它关在一个子进程里，主测试台才有确定的 stdout 与退出码。
 *
 * 这里**不 import 玄枢任何包**（`packages/**` 一个都不碰）：只 import 装在 profile 里/CLI 锚点里的
 * 官方 DSH 包，然后读装配结果（`ctx.loader.entries()` 的 `fiber.state`、
 * `ctx.get('pluginPackages').packageOf()`）。这正是契约第 5 节允许的「跑官方 API」。
 *
 * 用法（只被 scripts/verify-assembly.mjs 调用）：
 *   node tests/assembly/lib/boot-inprocess.mjs --dsh-home <dir> --profile <name> --cli-bin <abs bin.js>
 * stdout 末尾有一行 `##XUANSHU-BOOT-RESULT## {json}`；退出码 0 = 探针自身跑通（S2 的断言由调用方做）。
 *
 * 为什么把一个 overlay 挂上去关掉 headless app 的两行：headless 的启动行是「必激活」行
 * （`headless-runner` 在官方 startup audit 的硬失败清单里），而它一激活就要读 task、建 agent、
 * 调 LLM。S2 只想知道「整棵树挂起来、我们两行真的激活了」，所以用官方 overlay 机制
 * （`readProfilePatches(..., context.overlays)`，等价于 CLI 的 `--patch`）把 app 的启动行关掉：
 * 树照挂、我们两行照激活，但不跑任何 run、不调 LLM、不开端口。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MARKER = '##XUANSHU-BOOT-RESULT##'

/**
 * 传给官方 API 的 **binName**：固定 `'xuanshu'`，与 `--profile` 取值无关。
 *
 * 官方签名是 `loadProfile(binName, name, installAnchor, home)` /
 * `boot(binName, rootConfig, patches, prepare)` —— 第一个参数是**诊断前缀**
 * （`@deepseek-ai/dsh-app-boot/lib/types/profile.d.ts:211` 的
 * `@param binName - the diagnostic prefix on thrown errors`；`profile-context.d.ts:45`
 * 同义），第二个才是 profile 名（本探针用 `opts.profile`，默认也是 `xuanshu`，
 * 但可用 `XUANSHU_PROFILE` 换成别的）。
 * 它只影响报错文本，**不影响装配结果**，所以固定一个值就够了 —— 这里统一成常量，
 * 免得「有些调用写死 `'xuanshu'`、有些用 `opts.profile`」这种读起来像 bug 的混用。
 */
const BIN_NAME = 'xuanshu'

/** S2 用的 overlay：关掉 headless app 的启动行（理由见文件头注释）。 */
const NO_APP_OVERLAY = [
  { id: 'headless-runner', disabled: true },
  { id: 'headless-startup', disabled: true },
]

function parseArgs(argv) {
  const opts = { profile: 'xuanshu', dshHome: undefined, cliBin: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dsh-home') opts.dshHome = argv[++i]
    else if (arg === '--profile') opts.profile = argv[++i]
    else if (arg === '--cli-bin') opts.cliBin = argv[++i]
    else throw new Error(`boot-inprocess: unknown argument ${arg}`)
  }
  if (!opts.dshHome) throw new Error('boot-inprocess: --dsh-home is required')
  if (!opts.cliBin) throw new Error('boot-inprocess: --cli-bin is required')
  opts.dshHome = resolve(opts.dshHome)
  opts.cliBin = resolve(opts.cliBin)
  return opts
}

/** 在 node_modules 根里找第一个存在的入口文件。 */
function findModuleEntry(nodeModulesRoot, relPath) {
  const candidate = join(nodeModulesRoot, ...relPath.split('/'))
  return existsSync(candidate) ? candidate : undefined
}

/**
 * CLI 入口 `<root>/@deepseek-ai/dsh/lib/bin.js` → 它的 node_modules 根。
 *
 * 为什么一定要用 CLI 自己那棵树来 import DSH API：`@deepseek-ai/cordis` 是 peer dependency，
 * 我们的 profile 用 `autoInstallPeers: false` 装的，profile 树里**没有** cordis
 * （`<profile>/node_modules/@deepseek-ai/cordis` 不存在），于是从 profile 树 import
 * `dsh-app-boot` 会以 `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/cordis'` 失败。
 * 官方 CLI 也是从自己那棵树 import app-boot 的 —— 这里照做。
 */
function moduleRootOfCliBin(cliBin) {
  let dir = dirname(cliBin)
  for (let depth = 0; depth < 12; depth += 1) {
    if (dir === dirname(dir)) break
    if (dir.split(/[\\/]/).pop() === 'node_modules') return dir
    dir = dirname(dir)
  }
  throw new Error(`cannot locate the node_modules root above ${cliBin}`)
}

const fatal = []
const recordFatal = (label) => (error) => { fatal.push({ label, message: error?.stack ?? String(error) }) }
process.on('unhandledRejection', recordFatal('unhandledRejection'))
process.on('uncaughtException', recordFatal('uncaughtException'))

const result = {
  ok: false,
  profile: undefined,
  dshHome: undefined,
  apiRoot: undefined,
  installAnchor: undefined,
  appExitCode: undefined,
  rowCount: 0,
  rows: [],
  packages: {},
  tools: [],
  toolCount: 0,
  fatal: [],
  error: undefined,
  notes: [],
}

const report = (code) => {
  result.fatal = fatal
  process.stdout.write(`\n${MARKER} ${JSON.stringify(result)}\n`)
  process.exitCode = code
}

try {
  const opts = parseArgs(process.argv.slice(2))
  result.dshHome = opts.dshHome
  const profileDir = join(opts.dshHome, 'profiles', opts.profile)
  if (!existsSync(join(profileDir, 'package.json'))) throw new Error(`profile not installed: ${profileDir}`)

  const cliDir = dirname(dirname(opts.cliBin))
  const installAnchor = join(cliDir, 'package.json')
  const moduleRoot = moduleRootOfCliBin(opts.cliBin)

  // 官方 DSH 模块一律从 CLI 那棵树 import（cordis 在那）；profile 树只用来装配。
  const api = {
    appBoot: findModuleEntry(moduleRoot, '@deepseek-ai/dsh-app-boot/lib/index.js'),
    cmdline: findModuleEntry(moduleRoot, '@deepseek-ai/dsh-cmdline/lib/index.js'),
    launchEnv: findModuleEntry(moduleRoot, '@deepseek-ai/dsh-launch-environment/lib/index.js'),
  }
  if (api.appBoot === undefined || api.cmdline === undefined) {
    throw new Error(`DSH API modules not found under ${moduleRoot}`)
  }
  result.apiRoot = moduleRoot
  result.installAnchor = installAnchor

  const appBoot = await import(pathToFileURL(api.appBoot).href)
  const cmdline = await import(pathToFileURL(api.cmdline).href)
  const launchKey = api.launchEnv === undefined
    // 常量本体是字符串（`dsh-launch-environment/lib/index.js: DSH_LAUNCH_ENVIRONMENT_KEY`）；
    // 模块解析不到时用它，免得为了一个字符串把两棵依赖树混起来。
    ? 'launchEnvironment'
    : (await import(pathToFileURL(api.launchEnv).href)).DSH_LAUNCH_ENVIRONMENT_KEY

  // --- 1. profile：CLI 的 prepareProfile 每次都会重写根 cordis.yml，这里自己兜住 ---
  const profile = appBoot.loadProfile(BIN_NAME, opts.profile, installAnchor, opts.dshHome)
  result.profile = { name: opts.profile, dir: profile.dir, patchPath: profile.patchPath, bundles: profile.layers.map((l) => l.packageName) }
  const rootConfig = join(profile.dir, 'cordis.yml')
  const rootSnapshot = existsSync(rootConfig) ? readFileSync(rootConfig) : undefined
  writeFileSync(rootConfig, '# dsh profile root — an empty entry list.\n[]\n')
  const restoreRoot = () => {
    try {
      if (rootSnapshot === undefined) rmSync(rootConfig, { force: true })
      else writeFileSync(rootConfig, rootSnapshot)
    } catch (error) {
      result.notes.push(`failed to restore ${rootConfig}: ${error?.message ?? error}`)
    }
  }

  // --- 2. 运行时解析 + 补丁栈（复刻 runProfile） ---------------------------------
  const resolution = await appBoot.createRuntimeResolution({ installAnchor, profile, home: opts.dshHome })
  const environment = appBoot.loadLayeredEnv(BIN_NAME, process.cwd())
  const patches = appBoot.readProfilePatches(BIN_NAME, {
    dir: profile.dir,
    patchPath: profile.patchPath,
    installAnchor,
    home: opts.dshHome,
    overlays: NO_APP_OVERLAY,
    telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
  }, profile)

  // --- 3. boot：`boot()` 不装 PluginPackages、不装 failLoud，都得自己来 ----------
  let ctx
  try {
    ctx = await appBoot.boot(BIN_NAME, rootConfig, patches, async (host) => {
      host.provide('profileContext', {
        name: opts.profile,
        dir: profile.dir,
        patchPath: profile.patchPath,
        installAnchor,
        startedBundles: profile.layers.map((layer) => layer.packageName),
        cwd: process.cwd(),
        home: opts.dshHome,
        overlays: [],
        telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
      })
      host.provide(launchKey, environment)
      await host.plugin(appBoot.PluginPackages, { resolution })
      cmdline.provideCmdline(host, {
        args: ['--help'],
        exit: (code) => { result.appExitCode = code },
        ready: { onReady: (listener) => { listener(); return () => {} } },
      })
    })
  } catch (error) {
    restoreRoot()
    throw new Error(`boot() failed: ${error?.message ?? error}`)
  }

  // --- 4. 读装配结果（这就是 S2 的全部断言素材） ---------------------------------
  const entries = [...ctx.loader.entries()]
  result.rows = entries.map((entry) => ({
    id: entry.options.id,
    name: entry.options.name,
    state: entry.fiber?.state,
  }))
  result.rowCount = result.rows.length

  const pluginPackages = ctx.get('pluginPackages')
  for (const name of ['xuanshu-host', 'xuanshu-client']) {
    const found = pluginPackages?.packageOf(name, pathToFileURL(rootConfig).href)
    result.packages[name] = found === undefined
      ? null
      : { version: found.version, dir: found.dir, manifestPath: found.manifestPath }
  }
  if (pluginPackages === undefined) result.notes.push("ctx.get('pluginPackages') is undefined: boot() does not mount PluginPackages by itself")

  // --- 4b. 本进程注册的工具名（票 06 的断言素材：`mcp__horosa__*` 是否随装配即注册） ----
  // 只暴露名字数组：工具 schema 的体积与形状是 DSH 内部事务，装配契约不该钉它。
  const tools = ctx.get('tools')
  result.tools = typeof tools?.schemas === 'function'
    ? tools.schemas().map((schema) => schema?.name).filter((name) => typeof name === 'string' && name !== '').sort()
    : []
  result.toolCount = result.tools.length

  // --- 5. dispose：干净退出 -----------------------------------------------------
  const fatalBeforeDispose = fatal.length
  await ctx.fiber.dispose()
  result.notes.push(`fatal during dispose: ${fatal.length - fatalBeforeDispose}`)
  restoreRoot()
  result.ok = fatal.length === 0
  report(result.ok ? 0 : 1)
} catch (error) {
  result.error = error?.stack ?? String(error)
  report(1)
}
