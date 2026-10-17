/**
 * packages/xuanshu-host/lib/notify/settings.mjs — 壳与宿主共享的设置文件（冻结契约 §5）。
 *
 * **不是第二条 IPC**：`<dataDir>/shell-settings.json` 是唯一权威，壳读、宿主读写；缺文件 = 全部默认值。
 * 壳自己关心 `closeBehavior` / `autostart`（#23），宿主关心 `notifySummary`（决定通知正文带不带
 * 一句不含私事的短句）。两边读同一份文件，因此谁先起都能读到对方的设置。
 *
 * 两条纪律：
 *   - **写后回读**：写操作不许静默（`TrafficSettings` 的界面会按返回值显示「开 / 关」，
 *     写坏了却回新值等于骗人）；
 *   - **坏文件不当设置**：schema 不认识 / JSON 坏了 → 读面回落默认值（与 `digao/store.mjs` 的
 *     「schema 不认识就当没有」同款），下一次写会覆盖成合法形状。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { writeAtomic } from '../atomic.mjs'
import { SHELL_SETTINGS_SCHEMA } from './contract.mjs'

// schema 的唯一来源在 `contract.mjs`；设置面再导出同一绑定（壳/宿主/测试都从一处取）。
export { SHELL_SETTINGS_SCHEMA }

/** 设置文件名（契约 §5 定值：`<dataDir>/shell-settings.json`）。 */
export const SHELL_SETTINGS_FILE = 'shell-settings.json'

/** 关窗行为（契约 §5：`hide` 默认 / `quit`）。 */
export const CLOSE_BEHAVIORS = Object.freeze(['hide', 'quit'])

/** 缺文件 / 缺键时的默认值（契约 §5 的 JSON 就是它）。 */
export const DEFAULT_SHELL_SETTINGS = Object.freeze({
  closeBehavior: 'hide',
  autostart: false,
  notifySummary: false,
})

/** `<dataDir>/shell-settings.json`。 */
export function shellSettingsFile(dataDir) {
  return join(dataDir, SHELL_SETTINGS_FILE)
}

/**
 * 读设置（任何读不懂的东西都回落默认值，不抛）。
 * @param {string} dataDir
 * @returns {{closeBehavior: 'hide'|'quit', autostart: boolean, notifySummary: boolean}}
 */
export function readShellSettings(dataDir) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(shellSettingsFile(dataDir), 'utf8'))
  } catch {
    return { ...DEFAULT_SHELL_SETTINGS }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schema !== SHELL_SETTINGS_SCHEMA) {
    return { ...DEFAULT_SHELL_SETTINGS }
  }
  return {
    closeBehavior: CLOSE_BEHAVIORS.includes(parsed.closeBehavior) ? parsed.closeBehavior : DEFAULT_SHELL_SETTINGS.closeBehavior,
    autostart: typeof parsed.autostart === 'boolean' ? parsed.autostart : DEFAULT_SHELL_SETTINGS.autostart,
    notifySummary: typeof parsed.notifySummary === 'boolean' ? parsed.notifySummary : DEFAULT_SHELL_SETTINGS.notifySummary,
  }
}

/**
 * 改设置（部分更新；**校验 + 原子写 + 回读**）。
 *
 * @param {string} dataDir
 * @param {{closeBehavior?: 'hide'|'quit', autostart?: boolean, notifySummary?: boolean}} patch
 * @returns {{closeBehavior: 'hide'|'quit', autostart: boolean, notifySummary: boolean}} 回读后的完整设置
 */
export function writeShellSettings(dataDir, patch = {}) {
  const source = patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(DEFAULT_SHELL_SETTINGS, key)) {
      throw new Error(`shell-settings 不认识这个键：${JSON.stringify(key)}（只认 ${Object.keys(DEFAULT_SHELL_SETTINGS).join(' / ')}）`)
    }
  }
  if (source.closeBehavior !== undefined && !CLOSE_BEHAVIORS.includes(source.closeBehavior)) {
    throw new Error(`closeBehavior 只能是 ${CLOSE_BEHAVIORS.join(' / ')}（拿到 ${JSON.stringify(source.closeBehavior)}）`)
  }
  if (source.autostart !== undefined && typeof source.autostart !== 'boolean') {
    throw new Error(`autostart 必须是 boolean（拿到 ${typeof source.autostart}）`)
  }
  if (source.notifySummary !== undefined && typeof source.notifySummary !== 'boolean') {
    throw new Error(`notifySummary 必须是 boolean（拿到 ${typeof source.notifySummary}）`)
  }

  const merged = { ...readShellSettings(dataDir), ...source }
  const file = shellSettingsFile(dataDir)
  writeAtomic(file, `${JSON.stringify({ schema: SHELL_SETTINGS_SCHEMA, ...merged }, null, 2)}\n`)

  // 写后回读：磁盘上还是旧的（或写坏了）就如实抛，不把「没写进去」说成「改成了」。
  const readBack = readShellSettings(dataDir)
  for (const key of Object.keys(merged)) {
    if (readBack[key] !== merged[key]) {
      throw new Error(`设置没写进去（${key} 回读是 ${JSON.stringify(readBack[key])}）：${file}`)
    }
  }
  if (!existsSync(file)) throw new Error(`设置文件写完之后不在了：${file}`)
  return readBack
}
