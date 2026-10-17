/**
 * packages/xuanshu-shell/lib/main.mjs — 桌面壳的接线层（Electron 主进程入口）。
 *
 * 这一层只做「把纯模块接起来」：
 *   home 解析 → 共享设置 → 开机自启 → 回环通知端点 + 状态文件 → 看护 DSH 子进程（+ 看门狗）
 *   → 窗口 / 托盘 / 关窗语义 → 退出时先停子进程再退壳。
 *
 * 为什么这里几乎没有判断逻辑：判断都在 `home.mjs` / `settings.mjs` / `autostart.mjs` /
 * `notify-server.mjs` / `supervisor.mjs` / `desktop-behavior.mjs` / `status.mjs` 里，且都有
 * 无真实窗口的测试覆盖。`main.mjs` 与 `electron-adapter.mjs` 是「无法在 CI 里跑」的那一小块，
 * 真机验收步骤写在 `docs/runbook/shell.md`。
 *
 * 用法（开发期）：
 *   pnpm --filter xuanshu-shell exec electron .
 *   pnpm --filter xuanshu-shell exec electron . -- --home E:/ai_project/XuanShu/.dsh-home
 */

import { randomBytes } from 'node:crypto'
import { spawn as nodeSpawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { createElectronAdapter } from './electron-adapter.mjs'
import { createAutostart } from './autostart.mjs'
import { DEFAULT_PROFILE, DEFAULT_WEB_PORT } from './contract.mjs'
import {
  CLOSE_EXPLAINED_FILE, createCloseHandler, createTrayController,
  readCloseExplained, writeCloseExplained,
} from './desktop-behavior.mjs'
import { resolveDshEntry } from './dsh-entry.mjs'
import { isRealDshHome, resolveRepoRoot, resolveShellHome, shellPaths } from './home.mjs'
import { buildNotifyState, removeNotifyState, writeNotifyStateFile } from './notify-state.mjs'
import { createNotifyServer } from './notify-server.mjs'
import { createSettingsStore } from './settings.mjs'
import { bootstrapSingleInstance } from './single-instance.mjs'
import { shellStatusViewModel, statusPageHtml } from './status.mjs'
import { createSupervisor } from './supervisor.mjs'
import { createWatchdogProcess } from './watchdog.mjs'

/** 壳自己的命令行开关（只影响开发期；产品形态靠环境变量与默认 home）。 */
export function parseShellArgs(argv) {
  const options = { home: undefined, profile: undefined, port: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--home') options.home = argv[++index]
    else if (arg === '--profile') options.profile = argv[++index]
    else if (arg === '--port') {
      const port = Number(argv[++index])
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--port 需要 1..65535 的整数（拿到 ${argv[index]}）`)
      options.port = port
    } else if (arg === '--') {
      continue
    } else if (arg.startsWith('-')) {
      throw new Error(`未知的壳参数：${arg}`)
    }
  }
  return options
}

const adapter = createElectronAdapter()
const args = (() => {
  try {
    return parseShellArgs(process.argv.slice(2))
  } catch (error) {
    adapter.showErrorBox('玄枢启动失败', String(error?.message ?? error))
    adapter.app.exit(1)
    return { home: undefined, profile: undefined, port: undefined }
  }
})()
const profile = args.profile ?? process.env.XUANSHU_PROFILE ?? DEFAULT_PROFILE
const webPort = args.port ?? DEFAULT_WEB_PORT
const watchdogScript = fileURLToPath(new URL('./watchdog.mjs', import.meta.url))
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

/** 壳的运行时状态（窗口 / 托盘都读它）。 */
const shellState = {
  supervisor: { phase: 'starting' },
  autostart: { method: 'unsupported', enabled: false, label: '不支持' },
  notification: { supported: false, detail: '通知端点还没起来' },
  windowError: undefined,
}
let activeHome
let window
let tray
let trayController
let settingsStore
let supervisor
let notifyServer
let autostart
let closeHandler
let shuttingDown = false
let shutdownPromise = null
let lastLoadedUrl

function view() {
  return shellStatusViewModel({
    // 页面加载失败是「窗口这一层」的失败，不篡改看护状态（子进程可能好好的）。
    supervisorState: shellState.windowError === undefined
      ? shellState.supervisor
      : { phase: 'failed', detail: shellState.windowError },
    autostart: shellState.autostart,
    notification: shellState.notification,
  })
}

function showStatusPage() {
  if (!adapter.isWindowAlive(window)) return
  lastLoadedUrl = undefined
  void adapter.loadHtml(window, statusPageHtml(view())).catch((error) => {
    console.error('[shell] 状态页加载失败：', error)
  })
}

function showMainWindow() {
  if (!adapter.isWindowAlive(window)) return
  adapter.showWindow(window)
}

function onSupervisorState(next) {
  shellState.supervisor = next
  if (next.phase === 'ready' && typeof next.url === 'string') {
    if (lastLoadedUrl !== next.url) {
      lastLoadedUrl = next.url
      adapter.loadUrl(window, next.url).then(() => {
        shellState.windowError = undefined
      }).catch((error) => {
        console.error('[shell] 加载玄枢首页失败：', error)
        shellState.windowError = `加载玄枢首页失败：${String(error?.message ?? error)}`
        showStatusPage()
      })
    }
  } else {
    showStatusPage()
  }
  trayController?.refresh()
}

/** 真退出：先停子进程，再关端点 / 清状态文件，最后退壳（验收：不留孤儿）。 */
function shutdown() {
  if (shutdownPromise !== null) return shutdownPromise
  shuttingDown = true
  shutdownPromise = (async () => {
    try {
      await supervisor?.stop()
    } catch (error) {
      console.error('[shell] 停子进程失败：', error)
    }
    try {
      await notifyServer?.close()
    } catch (error) {
      console.error('[shell] 关通知端点失败：', error)
    }
    try {
      // 干净退出删掉状态文件：宿主读不到 = 没有壳（比留一个死端口更不容易误判）。
      if (activeHome !== undefined) removeNotifyState(shellPaths(activeHome).notifyStateFile)
    } catch {
      /* 没写过就不用删 */
    }
    settingsStore?.close()
    try {
      trayController?.destroy()
    } catch {
      /* 托盘可能已经不在了 */
    }
    adapter.app.exit(0)
  })()
  return shutdownPromise
}

/** 关停阶段可能还没解析 home；解析失败时用一个无害路径（删除会 ENOENT）。 */
function bestEffortRepoRoot() {
  try {
    return resolveRepoRoot(process.cwd())
  } catch {
    return undefined
  }
}

/** 依赖看门狗的兜底：它盯壳 pid，壳被硬杀时收掉 DSH 子进程。 */
function createWatchdog() {
  return createWatchdogProcess({
    spawn: nodeSpawn,
    nodeBin: process.env.XUANSHU_NODE_BIN ?? 'node',
    scriptPath: watchdogScript,
    parentPid: adapter.pid,
  })
}

async function bootstrap() {
  await adapter.app.whenReady()
  window = adapter.createWindow()
  adapter.onWindowClosed(window, () => {
    window = undefined
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // 窗口先给出「正在启动」的状态页：不加载任何猜的地址。
  showStatusPage()
  adapter.showWindow(window)

  const repoRoot = bestEffortRepoRoot()
  const homeInfo = resolveShellHome({ home: args.home, env: process.env, repoRoot })
  for (const note of homeInfo.ignored) console.warn('[shell]', note)
  if (isRealDshHome(homeInfo.home, { realHome: homeInfo.realHome })) {
    adapter.showErrorBox(
      '玄枢不能使用 DSH 桌面版的 home',
      `解析出的 home 是 ${homeInfo.home}（真实 DSH home：${homeInfo.realHome}）。\n`
      + '玄枢自己的家是 ~/.xuanshu（开发期 <repo>/.dsh-home）；请检查 XUANSHU_DSH_HOME / DSH_HOME。',
    )
    adapter.app.exit(1)
    return
  }
  activeHome = homeInfo.home
  const paths = shellPaths(homeInfo.home)
  mkdirSync(paths.dataDir, { recursive: true })
  console.log(`[shell] home=${paths.home}（来源：${homeInfo.source}）`)

  // ① 共享设置（壳读、宿主写；每次关窗 / 构建托盘菜单前重读）。
  settingsStore = createSettingsStore({ dataDir: paths.dataDir })
  const settings = settingsStore.read()

  // ② 开机自启：写入后**回读**，界面显示实际生效方式。
  autostart = createAutostart({
    platform: adapter.platform,
    loginItem: adapter.loginItem,
    shortcut: adapter.shortcut,
    shortcutName: '玄枢.lnk',
    target: adapter.execPath,
    args: adapter.isPackaged ? [] : [packageRoot],
    isPackaged: adapter.isPackaged,
  })
  shellState.autostart = autostart.apply(settings.autostart)
  console.log(`[shell] ${autostart.describe()}`)

  // ③ 通知端点（只绑回环）+ 运行时状态文件（原子写）。
  const token = randomBytes(32).toString('hex')
  const notificationSupported = adapter.notifications.supported()
  try {
    notifyServer = createNotifyServer({
      token,
      showNotification: (payload, options) => adapter.notifications.show(payload, options),
      onNotificationClick: () => showMainWindow(),
      capabilities: { notification: notificationSupported, clickToWindow: true },
    })
    const { url } = await notifyServer.listen()
    writeNotifyStateFile(paths.notifyStateFile, buildNotifyState({
      url,
      token,
      pid: adapter.pid,
      capabilities: { notification: notificationSupported, clickToWindow: true },
    }))
    shellState.notification = {
      supported: notificationSupported,
      detail: notificationSupported ? undefined : '系统通知不可用（平台不支持）',
    }
    console.log(`[shell] 通知端点 ${url}（状态文件 ${paths.notifyStateFile}）`)
  } catch (error) {
    // 端点起不来 = 通知不可用，如实告诉界面；壳本身照常可用。
    shellState.notification = { supported: false, detail: `通知端点起不来：${String(error?.message ?? error)}` }
    try {
      removeNotifyState(paths.notifyStateFile)
    } catch {
      /* 没有旧文件 */
    }
    console.error('[shell] 通知端点启动失败：', error)
  }

  // ④ 看护子进程。
  const entry = resolveDshEntry({ home: paths.home, profile, env: process.env })
  if (entry.ok !== true) {
    shellState.supervisor = { phase: 'failed', detail: entry.detail ?? '找不到 DSH CLI' }
    console.error(`[shell] ${shellState.supervisor.detail}`)
  } else {
    supervisor = createSupervisor({
      spawn: nodeSpawn,
      entry,
      home: paths.home,
      profile,
      port: webPort,
      baseEnv: process.env,
      shellPid: adapter.pid,
      onState: onSupervisorState,
      logger: console,
      watchdog: createWatchdog(),
    })
  }

  // ⑤ 托盘 + 关窗语义。
  try {
    tray = adapter.createTray()
    adapter.onTrayClick(tray, () => showMainWindow())
    trayController = createTrayController({
      tray: {
        setMenu: (template) => adapter.setTrayMenu(tray, template),
        setToolTip: (text) => adapter.setTrayToolTip(tray, text),
        destroy: () => adapter.destroyTray(tray),
      },
      readSettings: () => settingsStore.read(),
      getSupervisorState: () => shellState.supervisor,
      getAutostart: () => shellState.autostart,
      getNotification: () => shellState.notification,
      actions: {
        open: () => showMainWindow(),
        quit: () => adapter.app.quit(),
      },
    })
    trayController.refresh()
  } catch (error) {
    // Linux 上没有托盘是正常形态：如实记录，窗口照常可用。
    console.warn('[shell] 托盘不可用：', error)
  }

  closeHandler = createCloseHandler({
    readSettings: () => settingsStore.read(),
    isExplained: () => readCloseExplained(join(adapter.userDataPath, CLOSE_EXPLAINED_FILE)),
    markExplained: () => {
      try {
        writeCloseExplained(join(adapter.userDataPath, CLOSE_EXPLAINED_FILE))
      } catch (error) {
        console.warn('[shell] 写「首次关窗说明」标记失败：', error)
      }
    },
    onExplain: () => {
      adapter.showMessageBoxSync({
        title: '玄枢还在后台运行',
        message: '关掉窗口只是把它收进托盘，日课与晚省仍会照常到点。',
        detail: '要彻底退出，请用托盘菜单的「退出」。',
      })
    },
    onHide: () => adapter.hideWindow(window),
    onQuit: () => adapter.app.quit(),
  })

  adapter.onWindowClose(window, (event) => {
    if (shuttingDown) return
    const decision = closeHandler.handleClose()
    if (decision.action === 'quit') {
      // 走真退出路径：before-quit → shutdown（先停子进程再退壳）。
      event.preventDefault()
      adapter.app.quit()
    } else {
      event.preventDefault()
    }
  })

  // ⑥ 设置文件变化（best-effort）：重读 → 自启改变才重写 → 刷新托盘 / 状态页。
  let lastAutostartWanted = settings.autostart === true
  settingsStore.watch((next) => {
    try {
      if ((next.autostart === true) !== lastAutostartWanted) {
        lastAutostartWanted = next.autostart === true
        shellState.autostart = autostart.apply(lastAutostartWanted)
      }
      trayController?.refresh()
      if (shellState.supervisor.phase !== 'ready') showStatusPage()
    } catch (error) {
      console.warn('[shell] 应用设置变化失败：', error)
    }
  })

  // ⑦ 先让用户看到状态页，再启动子进程。
  showStatusPage()
  adapter.showWindow(window)
  if (supervisor !== undefined) {
    try {
      supervisor.start()
    } catch (error) {
      shellState.supervisor = { phase: 'failed', detail: `起不来 DSH 子进程：${String(error?.message ?? error)}` }
      console.error('[shell] 启动子进程失败：', error)
      showStatusPage()
    }
  }
  trayController?.refresh()
}

/* ───────────────────────────── 进程级接线 ───────────────────────────── */

// 单实例：第二个进程只把 first-instance 叫醒，然后自己退出。
bootstrapSingleInstance({
  app: adapter.app,
  start: () => {
    void bootstrap().catch((error) => {
      console.error('[shell] 启动失败：', error)
      adapter.showErrorBox('玄枢启动失败', String(error?.message ?? error))
      adapter.app.exit(1)
    })
  },
  showExisting: () => showMainWindow(),
})

// 真退出路径（托盘「退出」/ 设置里的「关窗即退出」/ 系统退出都走它）。
adapter.app.onBeforeQuit((event) => {
  if (shuttingDown) return
  event.preventDefault()
  void shutdown()
})

// 兜底：能被捕获的异常 / 正常退出时同步发 SIGTERM（硬杀的情况由独立看门狗负责）。
process.on('exit', () => {
  try {
    supervisor?.killNow()
  } catch {
    /* 进程都要没了 */
  }
})
process.on('uncaughtException', (error) => {
  console.error('[shell] 未捕获异常：', error)
  try {
    supervisor?.killNow()
  } catch {
    /* 已尽力 */
  }
  adapter.app.exit(1)
})
process.on('unhandledRejection', (reason) => {
  console.error('[shell] 未处理的 Promise 拒绝：', reason)
})
