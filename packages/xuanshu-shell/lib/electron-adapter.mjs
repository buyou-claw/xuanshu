/**
 * packages/xuanshu-shell/lib/electron-adapter.mjs — **唯一** import `electron` 的文件。
 *
 * 为什么把 electron 关在一个文件里（ADR-0014:28）：壳的所有控制面（看护 / 关窗语义 / 自启 /
 * 托盘 / 端点）都必须是**纯模块**，能在没有真实窗口的机器上单测。electron 的 API 形状在
 * 测试环境里不存在，所以只在这里出现一次；`main.mjs` 只依赖这个适配器的方法名。
 *
 * 约定：适配器方法只做「把 electron 变成可注入的接口」这一件事，不承载判断逻辑
 * （判断都在纯模块里，测试覆盖那里）。托盘图标是**运行时画出来的**占位图：仓库里不放二进制，
 * 真机视觉验收见 `docs/runbook/shell.md`。
 */

import {
  app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage, shell,
} from 'electron'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** 玄枢的 Windows 通知标识（未设置时系统通知可能不显示应用名）。 */
const APP_USER_MODEL_ID = 'com.xuanshu.shell'

/**
 * 画一个 24×24 的托盘图标（纸张色圆环 + 中央墨点），避免往仓库塞二进制。
 * 返回 Electron `NativeImage`；失败时返回空图（托盘仍会创建，只是图标不可见 —— 写进 runbook）。
 */
function createTrayIcon(nativeImageApi) {
  const size = 24
  const buffer = Buffer.alloc(size * size * 4)
  const center = (size - 1) / 2
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center)
      const offset = (y * size + x) * 4
      let blue = 0
      let green = 0
      let red = 0
      let alpha = 0
      if (distance <= 10.5) {
        // 外环：墨色（BGRA）
        blue = 40
        green = 30
        red = 30
        alpha = 255
      }
      if (distance <= 7.5) {
        // 内圈：纸色
        blue = 228
        green = 236
        red = 240
        alpha = 255
      }
      if (distance <= 3.2) {
        // 中央墨点
        blue = 40
        green = 30
        red = 30
        alpha = 255
      }
      buffer[offset] = blue
      buffer[offset + 1] = green
      buffer[offset + 2] = red
      buffer[offset + 3] = alpha
    }
  }
  try {
    return nativeImageApi.createFromBitmap(buffer, { width: size, height: size, scaleFactor: 1 })
  } catch {
    return nativeImageApi.createEmpty()
  }
}

/**
 * 建一个 electron 适配器（真机用；测试不 import 这个文件）。
 *
 * 两条**真机实测**的硬约束（2026-10-18，Windows 11 22631 / electron 38.2.2，都有最小复现）：
 *
 * ① **模块加载期不许读路径**：本文件被 `main.mjs` 顶层 import，这时还没 `app.whenReady()`。
 *    在这种时刻调用 `app.getPath('userData' | 'appData')` 或 `app.getName()`，进程会在
 *    `whenReady()` 之前**直接退出、退出码 0xFFFF7003（-36861）**，stderr 只有一行
 *    `crashpad_client_win.cc: not connected`，**没有任何 JS 报错**——现象就是「双击没反应」。
 *    最小复现：`import { app } from 'electron'; app.getPath('userData')` 两行就崩。
 *    所以下面这些全部改成 **getter**，只在真正用到时（`bootstrap()` 里，ready 之后）求值。
 *
 * ② **appName 用 ASCII**：它决定 `userData` 目录（`%APPDATA%\<appName>`）。显示名走窗口标题
 *    （`createWindow` 的 `title: '玄枢'`），目录名保持 ASCII，避免非 ASCII 路径带来的平台差异。
 *
 * @param {{appName?: string}} [options]
 */
export function createElectronAdapter({ appName = 'xuanshu-shell' } = {}) {
  const platform = process.platform
  try {
    app.setName(appName)
  } catch {
    /* 某些平台 / 早期阶段不允许改名：不影响功能 */
  }
  if (platform === 'win32') {
    try {
      app.setAppUserModelId(APP_USER_MODEL_ID)
    } catch {
      /* 同上 */
    }
  }

  const startupFolder = () => join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')

  return {
    platform,
    pid: process.pid,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    /**
     * 下面三个必须是 **getter**（实测踩到，2026-10-18）：
     * 在 `app.whenReady()` 之前调用 `app.getPath()` / `app.getName()` 会让 Chromium 的 crashpad
     * 起不来（stderr 只有 `crashpad_client_win.cc: not connected`），主进程在 `whenReady` 之前
     * **直接退出、退出码 0xFFFF7003（-36861），且没有任何 JS 报错**——现象就是「双击没反应」。
     * 最小复现：`import { app } from 'electron'; app.getPath('userData')` 两行就崩；
     * 同样的调用挪到 `await app.whenReady()` 之后正常。
     * 本文件被 `main.mjs` 顶层 import，所以**模块加载期一律不许读路径**。
     */
    get appName() {
      return app.getName()
    },
    get userDataPath() {
      return app.getPath('userData')
    },
    get appDataPath() {
      return app.getPath('appData')
    },
    homePathOverride: undefined,

    /** app 的最小面（单实例 / 事件 / 退出）。 */
    app: {
      requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
      on: (event, callback) => app.on(event, callback),
      whenReady: () => app.whenReady(),
      quit: () => app.quit(),
      exit: (code) => app.exit(code),
      onBeforeQuit: (callback) => app.on('before-quit', callback),
      onWillQuit: (callback) => app.on('will-quit', callback),
      onWindowAllClosed: (callback) => app.on('window-all-closed', callback),
    },

    /* ───────────── 窗口 ───────────── */
    createWindow({ width = 1180, height = 780, title = '玄枢', show = true } = {}) {
      const window = new BrowserWindow({
        width,
        height,
        title,
        show,
        backgroundColor: '#f6f4ee',
        autoHideMenuBar: true,
        webPreferences: {
          // 壳只负责显示宿主页面：不给 renderer 任何 Node 能力。
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
      return window
    },
    loadUrl(window, url) {
      return window.loadURL(url)
    },
    loadHtml(window, html) {
      return window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    },
    /**
     * 页面内改 hash（P2：点通知停到 overview，不重载页面）。
     * 返回 renderer 的 Promise；窗口没了 / 页面还没加载好会 reject —— 调用方退回带 hash 的 loadURL。
     */
    setHash(window, hash) {
      if (!window || window.isDestroyed()) return Promise.resolve()
      return window.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(`#${hash}`)}`)
    },
    onWindowClose(window, callback) {
      window.on('close', callback)
    },
    onWindowClosed(window, callback) {
      window.on('closed', callback)
    },
    isWindowAlive: (window) => window !== null && window !== undefined && window.isDestroyed() === false,
    showWindow(window) {
      if (!window || window.isDestroyed()) return
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    },
    hideWindow(window) {
      if (!window || window.isDestroyed()) return
      window.hide()
    },
    destroyWindow(window) {
      if (!window || window.isDestroyed()) return
      window.destroy()
    },

    /* ───────────── 托盘 / 菜单 ───────────── */
    createTray() {
      const icon = createTrayIcon(nativeImage)
      const tray = new Tray(icon)
      tray.setToolTip('玄枢')
      return tray
    },
    setTrayMenu(tray, template) {
      tray.setContextMenu(Menu.buildFromTemplate(template))
    },
    setTrayToolTip(tray, text) {
      tray.setToolTip(text)
    },
    onTrayClick(tray, callback) {
      tray.on('click', callback)
    },
    destroyTray(tray) {
      tray?.destroy?.()
    },

    /* ───────────── 系统通知 ───────────── */
    notifications: {
      supported: () => {
        try {
          return Notification.isSupported() === true
        } catch {
          return false
        }
      },
      /**
       * 契约 §2 的 delivered 语义 = 「构造并 show() 没抛」。
       * 这里**不**判断用户是否真的看到了（那不在契约内），也不谎报。
       */
      show(payload, { onClick } = {}) {
        if (Notification.isSupported() !== true) {
          return { shown: false, reason: 'unsupported', detail: '当前系统 / 环境不支持 Electron 通知' }
        }
        try {
          const notification = new Notification({
            title: payload.title,
            body: payload.body ?? '',
            silent: payload.silent === true,
          })
          if (typeof onClick === 'function') notification.on('click', () => onClick())
          notification.show()
          return { shown: true }
        } catch (error) {
          return { shown: false, reason: 'failed', detail: String(error?.message ?? error) }
        }
      },
    },

    /* ───────────── 登录项 / 启动文件夹快捷方式 ───────────── */
    loginItem: {
      isAvailable: () => platform === 'win32' || platform === 'darwin',
      set(enabled, { target, args } = {}) {
        app.setLoginItemSettings({
          openAtLogin: enabled === true,
          ...(target === undefined ? {} : { path: target }),
          ...(Array.isArray(args) ? { args } : {}),
        })
      },
      get() {
        const settings = app.getLoginItemSettings()
        return { enabled: settings.openAtLogin === true }
      },
    },
    shortcut: {
      isAvailable: () => platform === 'win32' && typeof shell.writeShortcutLink === 'function',
      path(name) {
        return join(startupFolder(), name)
      },
      exists(name) {
        return existsSync(this.path(name))
      },
      write(enabled, { name, target, args } = {}) {
        const file = this.path(name)
        if (enabled === true) {
          const created = shell.writeShortcutLink(file, 'create', {
            target,
            args: Array.isArray(args) ? args.join(' ') : '',
            description: '玄枢',
          })
          if (created !== true) throw new Error(`写启动文件夹快捷方式失败：${file}`)
          return
        }
        // Electron 没有「删除快捷方式」的 API：直接删文件（这个文件是我们自己建的）。
        rmSync(file, { force: true })
      },
    },

    /* ───────────── 对话框 ───────────── */
    showMessageBoxSync({ title, message, detail, buttons = ['知道了'] } = {}) {
      return dialog.showMessageBoxSync({ type: 'info', title, message, detail, buttons })
    },
    showErrorBox(title, content) {
      dialog.showErrorBox(title, content)
    },
  }
}
