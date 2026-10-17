/**
 * packages/xuanshu-shell/lib/main.mjs — 桌面壳的接线层（Electron 主进程入口）。
 *
 * 这一层做的是「把纯模块接起来」：
 *   home 解析 → 共享设置 → 开机自启 → 运行时状态文件（通知端点 + 设置生效方式）→ 看护 DSH 子进程
 *   （+ 看门狗）→ 窗口 / 托盘 / 关窗语义 → 退出时先停子进程再退壳。
 *
 * **哪些判断在这里、哪些不在这里**（复核 S3 之后如实写）：
 *   - 判断在纯模块里，且有测试：`main-flow.mjs`（参数解析 / 启动计划 / 早期退出 / 状态页 phase 改写 /
 *     何时加载 URL）、`home.mjs` / `settings.mjs` / `autostart.mjs` / `notify-server.mjs` /
 *     `supervisor.mjs` / `desktop-behavior.mjs` / `status.mjs`；
 *   - 本文件仍有**接线级的顺序与副作用**（先起窗口再起子进程、退出顺序、事件注册）。它顶层就要
 *     `electron`，CI 里 import 不了 —— 所以这部分**没有**自动化覆盖，真机验收步骤在
 *     `docs/runbook/shell.md`；改动这里必须同时更新 runbook 并在真机上走一遍。
 *   - 参数错误的早期退出走 `main-flow.mjs::startShell()`：错误框 + `exit(1)`，**不注册单实例、
 *     不 bootstrap**（从前 IIFE 兜底返回后还会继续初始化）。
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
import {
  OVERVIEW_HASH, createNotificationClickHandler, nextSupervisorLoad, overviewUrlWithHash, planStartup,
  shellStatusViewInput, startShell,
} from './main-flow.mjs'
import { buildNotifyState, removeNotifyState, writeNotifyStateFile } from './notify-state.mjs'
import { createNotifyServer } from './notify-server.mjs'
import { createSettingsStore } from './settings.mjs'
import { buildShellStatus, removeShellStatus, writeShellStatusFile } from './shell-status.mjs'
import { bootstrapSingleInstance } from './single-instance.mjs'
import { shellStatusViewModel, statusPageHtml } from './status.mjs'
import { createSupervisor } from './supervisor.mjs'
import { createWatchdogProcess } from './watchdog.mjs'

const adapter = createElectronAdapter()
const startup = planStartup(process.argv.slice(2), process.env)
const args = startup.ok ? startup.options : { home: undefined, profile: undefined, port: undefined }
const profile = startup.ok ? startup.profile : DEFAULT_PROFILE
const webPort = startup.ok ? startup.webPort : DEFAULT_WEB_PORT
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
  // phase / 窗口失败改写全在 `main-flow.mjs::shellStatusViewInput()`（有测试）：本文件不再做判断。
  return shellStatusViewModel(shellStatusViewInput(shellState))
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

/**
 * 把已加载的玄枢首页带到 overview（P2 复核 #24：点通知必须停在 overview，不是「窗口出来了就算」）。
 *
 * 首选页面内改 hash（不重载、用户正在看的内容不丢）；`executeJavaScript` 不可用 / 页面还没加载好时，
 * 退回「用带 hash 的地址重新加载」—— 客户端在 load 与 hashchange 两处都认这个 hash。
 * 状态页（data: URL）不深链：那时还没有玄枢首页可停。
 */
function navigateWindowToOverview() {
  if (!adapter.isWindowAlive(window)) return
  const fallbackUrl = overviewUrlWithHash(lastLoadedUrl)
  if (fallbackUrl === undefined) return
  try {
    const result = adapter.setHash(window, OVERVIEW_HASH)
    if (result !== null && typeof result === 'object' && typeof result.catch === 'function') {
      result.catch(() => {
        void adapter.loadUrl(window, fallbackUrl)
      })
    }
  } catch {
    void adapter.loadUrl(window, fallbackUrl)
  }
}

function onSupervisorState(next) {
  shellState.supervisor = next
  // 加载 / 留在状态页 / 同一个 URL 不重复加载 —— 判断在 `main-flow.mjs::nextSupervisorLoad()`。
  const action = nextSupervisorLoad({ supervisor: next, lastLoadedUrl })
  if (action.kind === 'load') {
    lastLoadedUrl = action.url
    adapter.loadUrl(window, action.url).then(() => {
      shellState.windowError = undefined
    }).catch((error) => {
      console.error('[shell] 加载玄枢首页失败：', error)
      shellState.windowError = `加载玄枢首页失败：${String(error?.message ?? error)}`
      showStatusPage()
    })
  } else if (action.kind === 'status') {
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
      if (activeHome !== undefined) {
        removeNotifyState(shellPaths(activeHome).notifyStateFile)
        // P1：生效状态同生同灭 —— 留着它会让设置页把「上次的已开」显示成「现在还在」。
        removeShellStatus(shellPaths(activeHome).statusFile)
      }
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

/**
 * 把壳的**实际生效状态**写进运行时文件（P1 复核 #23）。
 *
 * 为什么是「实际生效」而不是设置值：`shellState.autostart` 是 `autostart.apply()` 的**回读结果**
 * （登录项可能被系统拒绝 → 退回快捷方式 → 或两条路都不可用）；关窗行为则每次重读设置文件。
 * 宿主 `shell.settings.get` 的 `effective` 读的就是这份。写失败只记日志（设置面不会因此打不开）。
 */
function publishRuntimeStatus() {
  if (activeHome === undefined || settingsStore === undefined) return
  try {
    const status = buildShellStatus({
      pid: adapter.pid,
      autostart: shellState.autostart,
      closeBehavior: settingsStore.read().closeBehavior,
    })
    writeShellStatusFile(shellPaths(activeHome).statusFile, status)
  } catch (error) {
    console.warn('[shell] 写运行时状态（自启方式 / 关窗行为）失败：', error)
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
  // P1（复核 #23）：把「实际生效」写成运行时文件（宿主 `shell.settings.get().effective` 读它）。
  publishRuntimeStatus()

  // ③ 通知端点（只绑回环）+ 运行时状态文件（原子写）。
  const token = randomBytes(32).toString('hex')
  const notificationSupported = adapter.notifications.supported()
  try {
    notifyServer = createNotifyServer({
      token,
      showNotification: (payload, options) => adapter.notifications.show(payload, options),
      // P2（复核 #24）：点通知 = 唤出窗口 + 把页面带到 overview（不是只「show 一下」）。
      // `target:'consult'` 没有深链（契约 §2 的 target 是建议），同样落到 overview —— 明说的 best-effort。
      onNotificationClick: createNotificationClickHandler({
        showWindow: () => showMainWindow(),
        navigateToOverview: () => navigateWindowToOverview(),
      }),
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
      // P1：设置变了就重写生效状态（关窗行为也在这里反映给宿主）。
      publishRuntimeStatus()
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

/**
 * 参数错误 = 早期退出：错误框 + exit(1)，**不注册单实例、不 bootstrap**。
 * 这个分支的形状由 `main-flow.mjs::startShell()` 钉住（`start` 零调用），别在这里另写一份。
 */
startShell({
  plan: startup,
  showErrorBox: (title, content) => adapter.showErrorBox(title, content),
  exit: (code) => adapter.app.exit(code),
  start: () => {
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
  },
})
