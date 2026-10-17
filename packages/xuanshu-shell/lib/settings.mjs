/**
 * packages/xuanshu-shell/lib/settings.mjs — 读共享设置文件（冻结契约 §5）。
 *
 * 契约原话：**壳读、宿主写**。所以这里只有读面，没有写面 —— 壳改设置会让「文件是唯一权威」
 * 变成两条写路径（宿主 RPC 与壳），冲突时没人说得清谁赢。壳需要「改设置」时走宿主的
 * `shell.settings.set`（#24 已提供）。
 *
 * 三条纪律：
 *   - **缺文件 = 全部默认值**（不报错、不创建文件）；
 *   - **坏文件不当设置**：JSON 坏 / schema 不认识 / 取值非法 → 逐键回落默认（与宿主同判）；
 *   - **重读是常态**：启动时、每次关窗前、每次构建托盘菜单前都重读；`fs.watch` 只是加速，
 *     监听不上（目录还不存在 / 平台不支持）也不影响功能。
 *
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

import { readFileSync, watch as fsWatch } from 'node:fs'
import { join } from 'node:path'

import {
  CLOSE_BEHAVIORS,
  DEFAULT_SHELL_SETTINGS,
  SHELL_SETTINGS_FILE,
  SHELL_SETTINGS_SCHEMA,
} from './contract.mjs'

/** `<dataDir>/shell-settings.json`（契约 §5 定值）。 */
export function shellSettingsFile(dataDir) {
  return join(dataDir, SHELL_SETTINGS_FILE)
}

/**
 * 读一个设置文件；任何读不懂的东西都回落默认值（不抛）。
 * @param {string} file
 * @returns {{closeBehavior: 'hide'|'quit', autostart: boolean, notifySummary: boolean}}
 */
export function readShellSettingsFromFile(file) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { ...DEFAULT_SHELL_SETTINGS }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schema !== SHELL_SETTINGS_SCHEMA) {
    return { ...DEFAULT_SHELL_SETTINGS }
  }
  return {
    closeBehavior: CLOSE_BEHAVIORS.includes(parsed.closeBehavior)
      ? parsed.closeBehavior
      : DEFAULT_SHELL_SETTINGS.closeBehavior,
    autostart: typeof parsed.autostart === 'boolean' ? parsed.autostart : DEFAULT_SHELL_SETTINGS.autostart,
    notifySummary: typeof parsed.notifySummary === 'boolean'
      ? parsed.notifySummary
      : DEFAULT_SHELL_SETTINGS.notifySummary,
  }
}

/**
 * 读 `<dataDir>/shell-settings.json`（缺文件 = 默认值）。
 * @param {string} dataDir
 * @returns {{closeBehavior: 'hide'|'quit', autostart: boolean, notifySummary: boolean}}
 */
export function readShellSettings(dataDir) {
  return readShellSettingsFromFile(shellSettingsFile(dataDir))
}

/**
 * 设置读面 + best-effort 监听。
 *
 * 为什么包一层 store 而不是到处 `readShellSettings(dataDir)`：**重读时机**是契约的一部分
 * （关窗前 / 构建托盘菜单前），把「读哪份文件」收在一个对象里，调用点就不会各自 join 出
 * 第二份路径；测试也能注入 `watchFactory` 精确驱动「文件变了 → 重读」。
 *
 * @param {{dataDir: string, watchFactory?: (file: string, listener: Function) => {close: Function}}} options
 * @returns {{read: () => object, file: string, watch: (onChange: (settings: object) => void) => void, close: () => void}}
 */
export function createSettingsStore({ dataDir, watchFactory = fsWatch } = {}) {
  const file = shellSettingsFile(dataDir)
  let watcher
  let closed = false

  return {
    file,
    read: () => readShellSettingsFromFile(file),
    /**
     * 监听设置文件（best-effort）。文件/目录还不存在时 `fs.watch` 会抛 —— 这里吞掉并只打日志式回调，
     * 因为「监听不上」只意味着「晚一拍重读」，不该让壳起不来。
     */
    watch(onChange) {
      if (closed || watcher !== undefined) return
      try {
        watcher = watchFactory(file, () => {
          if (closed) return
          onChange(readShellSettingsFromFile(file))
        })
      } catch {
        watcher = undefined
      }
    },
    close() {
      closed = true
      try {
        watcher?.close()
      } catch {
        /* 已经关掉了 */
      }
      watcher = undefined
    },
  }
}
