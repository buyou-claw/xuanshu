/**
 * packages/xuanshu-shell/lib/desktop-behavior.mjs — 关窗语义与托盘菜单（纯逻辑，不 import electron）。
 *
 * 验收：「关窗后壳与 DSH 子进程都还在（下一次触达仍能发生），托盘『打开』恢复窗口」；
 * 「『退出』先停子进程再退壳」。所以：
 *   - 关窗默认**隐藏**（不是最小化、不是退出），首次给一次性说明；设置 `closeBehavior:'quit'` 时才真退出；
 *   - 托盘永远有「打开 / 退出」两项；
 *   - 设置**每次关窗、每次构建菜单前重读**（宿主可能刚改过文件），壳不缓存；
 *   - 状态项如实显示 supervisor 的状态（启动中 / 第 N 次重拉 / 已放弃），不静默死亡。
 *
 * 首次说明的标记存在 Electron 的 `userData`（壳自己的存储），跨重启也只说明一次；
 * 它**不是**共享契约文件（§5 的 shell-settings.json 只有三个键，壳不往里加东西）。
 *
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 「首次关窗说明已展示」的标记文件（相对 Electron userData）。 */
export const CLOSE_EXPLAINED_FILE = 'close-explained'

/** 读标记：文件存在且内容为 `1` = 已经说明过。读不到一律 false。 */
export function readCloseExplained(file) {
  try {
    return readFileSync(file, 'utf8').trim() === '1'
  } catch {
    return false
  }
}

/** 写标记（尽力而为：写不了只是下次还会说明一遍，不影响关窗行为）。 */
export function writeCloseExplained(file) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '1\n')
}

/**
 * 关窗时该做什么（纯函数）。
 *
 * @param {{settings?: object, firstHideExplained?: boolean}} options
 * @returns {{action: 'hide'|'quit', explain: boolean}}
 */
export function decideCloseAction({ settings, firstHideExplained } = {}) {
  const behavior = settings?.closeBehavior === 'quit' ? 'quit' : 'hide'
  if (behavior === 'quit') return { action: 'quit', explain: false }
  return { action: 'hide', explain: firstHideExplained !== true }
}

/**
 * 关窗处理器：每次调用都重读设置（契约 §5 的时机要求）。
 *
 * @param {{readSettings: () => object, isExplained: () => boolean, markExplained: () => void,
 *          onHide: () => void, onQuit: () => void, onExplain: () => void}} options
 * @returns {{handleClose: () => {action: 'hide'|'quit', explain: boolean}}}
 */
export function createCloseHandler({ readSettings, isExplained, markExplained, onHide, onQuit, onExplain }) {
  if (typeof readSettings !== 'function') throw new Error('createCloseHandler needs readSettings')
  return {
    handleClose() {
      const decision = decideCloseAction({ settings: readSettings(), firstHideExplained: isExplained() === true })
      if (decision.action === 'quit') {
        onQuit?.()
        return decision
      }
      if (decision.explain) {
        // 先说清楚「它还在后台跑」，再隐藏；说明只做一次。
        onExplain?.()
        markExplained?.()
      }
      onHide?.()
      return decision
    },
  }
}

/* ───────────────────────────── 托盘 ───────────────────────────── */

/** supervisor 状态 → 一句人话（托盘与 tooltip 共用）。 */
export function supervisorStatusText(state) {
  const phase = state?.phase ?? 'stopped'
  switch (phase) {
    case 'ready':
      return '服务已就绪'
    case 'starting':
      return '服务未就绪（正在启动）'
    case 'restarting': {
      const exit = state.lastExit ?? {}
      const code = exit.code === undefined ? '—' : String(exit.code)
      const signal = exit.signal === undefined || exit.signal === null ? '' : ` signal=${exit.signal}`
      return `服务未就绪（第 ${state.attempt ?? 1} 次重拉：code=${code}${signal}）`
    }
    case 'failed':
      return `服务未就绪（${state.detail ?? '启动失败，已停止重拉'}）`
    case 'stopped':
      return '服务未就绪（已停止）'
    default:
      return '服务未就绪'
  }
}

/** 自启状态 → 一句人话（**如实**显示当前实际生效的方式）。 */
export function autostartText(status) {
  const method = status?.method ?? 'unsupported'
  if (method === 'unsupported') return '开机自启：不支持（本平台无法注册）'
  const label = status?.label ?? (method === 'login-item' ? '登录项' : '启动文件夹快捷方式')
  return `开机自启：${label}（${status?.enabled === true ? '已开' : '已关'}）`
}

/**
 * 构建托盘菜单模板（Electron `Menu.buildFromTemplate` 的形状：纯数据 + click 回调）。
 *
 * @param {{supervisorState?: object, settings?: object, autostart?: object,
 *          actions: {open: Function, quit: Function}, notification?: object}} options
 * @returns {Array<object>}
 */
export function buildTrayMenu({ supervisorState, autostart, actions, notification } = {}) {
  const items = [
    { label: `玄枢 · ${supervisorStatusText(supervisorState)}`, enabled: false },
    { type: 'separator' },
    { label: '打开', enabled: true, click: () => actions?.open?.() },
    { label: '退出', enabled: true, click: () => actions?.quit?.() },
    { type: 'separator' },
    { label: autostartText(autostart), enabled: false },
  ]
  if (notification !== undefined && notification?.supported === false) {
    items.push({ label: `系统通知：不可用（${notification.detail ?? '平台不支持'}）`, enabled: false })
  }
  return items
}

/**
 * 托盘控制器：每次 `refresh()` 先 `readSettings()` 再构建菜单（契约 §5）。
 *
 * @param {{tray: {setMenu: Function, setToolTip?: Function, destroy: Function},
 *          readSettings: () => object, getSupervisorState: () => object, getAutostart: () => object,
 *          actions: object, getNotification?: () => object}} options
 */
export function createTrayController({
  tray, readSettings, getSupervisorState, getAutostart, actions, getNotification = () => undefined,
}) {
  return {
    refresh() {
      // 顺序是契约的一部分：先重读设置，再构建菜单。
      readSettings()
      const state = getSupervisorState()
      const autostart = getAutostart()
      const template = buildTrayMenu({
        supervisorState: state,
        autostart,
        actions,
        notification: getNotification(),
      })
      tray.setMenu(template)
      tray.setToolTip?.(`玄枢 · ${supervisorStatusText(state)} · ${autostartText(autostart)}`)
      return template
    },
    destroy() {
      tray.destroy()
    },
  }
}
