/**
 * packages/xuanshu-shell/lib/autostart.mjs — 开机自启（登录项优先，回退启动文件夹快捷方式）。
 *
 * 验收要的是**「设置页显示当前实际生效方式」**，所以本模块的返回值里永远带：
 *   - `method`：`login-item` | `shortcut` | `unsupported` —— 实际用了哪条路；
 *   - `enabled`：**回读系统后的真实状态**，不是传进来的开关值；
 *   - `applied`：这次写入是否与请求一致；
 *   - `detail`：为什么换方法 / 为什么没成（含「开发期注册的是哪支可执行文件」）。
 *
 * 不假装：
 *   - 两边都不可用 → `unsupported` + `enabled:false`，**不会**因为设置里写了 `autostart:true` 就报「已开」；
 *   - 登录项写失败 → 如实退回快捷方式，并在 detail 里说明；
 *   - 用户从系统设置里关掉登录项 → 下一次 `status()` 回读成 `enabled:false`。
 *
 * 不 import electron：`loginItem` / `shortcut` 适配器由 `electron-adapter.mjs` 注入。
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

/** 方法标签（托盘与设置页显示同一份字面量）。 */
export const AUTOSTART_LABELS = Object.freeze({
  'login-item': '登录项',
  shortcut: '启动文件夹快捷方式',
  unsupported: '不支持',
})

/** 空对象兜底。 */
function objectOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * @param {{platform?: string, loginItem?: object, shortcut?: object,
 *          shortcutName?: string, target?: string, args?: string[], isPackaged?: boolean,
 *          logger?: {warn?: Function}}} options
 */
export function createAutostart({
  platform = process.platform, loginItem, shortcut,
  shortcutName = '玄枢.lnk', target = '', args = [], isPackaged = true, logger = console,
} = {}) {
  const loginItemAvailable = () => platform === 'win32' || platform === 'darwin'
    ? loginItem?.isAvailable?.() !== false
    : false
  const shortcutAvailable = () => shortcut?.isAvailable?.() !== false

  /** 实际会用哪条路（登录项 > 快捷方式 > 不支持）。 */
  function method() {
    if (loginItemAvailable()) return 'login-item'
    if (shortcutAvailable()) return 'shortcut'
    return 'unsupported'
  }

  /** 开发期说明：登录项注册的是 electron 可执行文件而不一定是装好的玄枢。 */
  function devNote() {
    if (isPackaged !== false) return undefined
    return `开发期：注册的是 ${target || '当前可执行文件'}（不是装好的玄枢应用）`
  }

  function unsupportedDetail(extra) {
    return extra ?? '本平台不支持开机自启（既没有登录项 API，也没有启动文件夹快捷方式）'
  }

  /** 回读实际状态（无写入）。 */
  function status() {
    const kind = method()
    const label = AUTOSTART_LABELS[kind]
    if (kind === 'login-item') {
      let enabled = false
      try {
        enabled = loginItem.get()?.enabled === true
      } catch (error) {
        logger?.warn?.(`[shell] 读登录项状态失败：${String(error?.message ?? error)}`)
      }
      return { method: kind, label, enabled, supported: true, detail: devNote() }
    }
    if (kind === 'shortcut') {
      let enabled = false
      try {
        enabled = shortcut.exists() === true
      } catch (error) {
        logger?.warn?.(`[shell] 读启动文件夹快捷方式失败：${String(error?.message ?? error)}`)
      }
      return { method: kind, label, enabled, supported: true, detail: devNote() }
    }
    return { method: kind, label, enabled: false, supported: false, detail: unsupportedDetail() }
  }

  /**
   * 应用自启开关（写入后**回读**；与请求不一致时 `applied:false`）。
   * @param {boolean} enabled
   */
  function apply(enabled) {
    const wanted = enabled === true
    const note = devNote()
    let loginError
    if (loginItemAvailable()) {
      try {
        loginItem.set(wanted, { target, args: [...args] })
        const actual = loginItem.get()?.enabled === true
        return {
          method: 'login-item',
          label: AUTOSTART_LABELS['login-item'],
          enabled: actual,
          applied: actual === wanted,
          supported: true,
          detail: note,
        }
      } catch (error) {
        loginError = error
        logger?.warn?.(`[shell] 登录项设置失败，尝试启动文件夹快捷方式：${String(error?.message ?? error)}`)
      }
    }

    if (shortcutAvailable()) {
      const fallbackNote = loginError === undefined
        ? note
        : `登录项不可用（${String(loginError?.message ?? loginError)}），改用启动文件夹快捷方式`
      try {
        shortcut.write(wanted, { name: shortcutName, target, args: [...args] })
        const actual = shortcut.exists() === true
        return {
          method: 'shortcut',
          label: AUTOSTART_LABELS.shortcut,
          enabled: actual,
          applied: actual === wanted,
          supported: true,
          detail: note === undefined ? fallbackNote : `${fallbackNote}；${note}`,
        }
      } catch (error) {
        return {
          method: 'unsupported',
          label: AUTOSTART_LABELS.unsupported,
          enabled: false,
          applied: false,
          supported: false,
          detail: unsupportedDetail(`登录项与启动文件夹快捷方式都写不进去：${String(error?.message ?? error)}`),
        }
      }
    }

    return {
      method: 'unsupported',
      label: AUTOSTART_LABELS.unsupported,
      enabled: false,
      applied: false,
      supported: false,
      detail: unsupportedDetail(loginError === undefined
        ? undefined
        : `登录项写不进去（${String(loginError?.message ?? loginError)}），也没有启动文件夹快捷方式可用`),
    }
  }

  /** 一句人话（托盘 / 设置页同源）。 */
  function describe() {
    const current = status()
    if (current.method === 'unsupported') return `开机自启：${AUTOSTART_LABELS.unsupported}（未生效）`
    return `开机自启：${current.label}（${current.enabled ? '已开' : '已关'}）`
  }

  return { method, status, apply, describe, shortcutName, target }
}

/**
 * 从设置对象应用自启（壳启动时 / 设置文件变化时用）。
 * @param {{settings?: {autostart?: boolean}, autostart: ReturnType<typeof createAutostart>}} options
 */
export function applyAutostartFromSettings({ settings, autostart }) {
  const wanted = objectOf(settings).autostart === true
  return autostart.apply(wanted)
}
