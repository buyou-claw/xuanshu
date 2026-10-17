/**
 * packages/xuanshu-host/lib/rikke/settings.mjs — 日课 AI 段的开关文件（#24）。
 *
 * 文件契约：`<dataDir>/rikke-settings.json`，schema `xuanshu/rikke-settings@1`，`{aiEnabled:boolean}`。
 *
 * 为什么**不**写进 `shell-settings.json`（契约 §5 的共享设置）：那份是壳/宿主共用的一层
 * （关窗行为、自启动、通知摘要）。「日课要不要 AI 段」是宿主自己的业务设置，塞进共享文件会让壳
 * 也被迫认识它 —— 壳不实现业务（ADR-0014）。
 *
 * 三条纪律：文件缺失 = 默认开；坏文件 / schema 不认识 = 回落默认（坏文件不当设置）；
 * 写入非法值 = **抛**（写操作不许静默）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { writeAtomic } from '../atomic.mjs'

/** 设置文件的 schema（#24 契约定值）。 */
export const RIKKE_SETTINGS_SCHEMA = 'xuanshu/rikke-settings@1'

/** 设置文件名（`<dataDir>/rikke-settings.json`）。 */
export const RIKKE_SETTINGS_FILE = 'rikke-settings.json'

/** 缺文件 / 缺键时的默认值：AI 段默认**开**（关掉是显式选择）。 */
export const DEFAULT_RIKKE_SETTINGS = Object.freeze({ aiEnabled: true })

/** `<dataDir>/rikke-settings.json`。 */
export function rikkeSettingsFile(dataDir) {
  return join(dataDir, RIKKE_SETTINGS_FILE)
}

/**
 * 读设置（读不懂就回落默认，不抛）。
 * @param {string} dataDir
 * @returns {{aiEnabled: boolean}}
 */
export function readRikkeSettings(dataDir) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(rikkeSettingsFile(dataDir), 'utf8'))
  } catch {
    return { ...DEFAULT_RIKKE_SETTINGS }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schema !== RIKKE_SETTINGS_SCHEMA) {
    return { ...DEFAULT_RIKKE_SETTINGS }
  }
  return { aiEnabled: typeof parsed.aiEnabled === 'boolean' ? parsed.aiEnabled : DEFAULT_RIKKE_SETTINGS.aiEnabled }
}

/**
 * 改设置（部分更新；校验 + 原子写 + 回读）。
 * @param {string} dataDir
 * @param {{aiEnabled?: boolean}} patch
 * @returns {{aiEnabled: boolean}} 回读后的设置
 */
export function writeRikkeSettings(dataDir, patch = {}) {
  const source = patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(DEFAULT_RIKKE_SETTINGS, key)) {
      throw new Error(`rikke-settings 不认识这个键：${JSON.stringify(key)}（只认 ${Object.keys(DEFAULT_RIKKE_SETTINGS).join(' / ')}）`)
    }
  }
  if (source.aiEnabled !== undefined && typeof source.aiEnabled !== 'boolean') {
    throw new Error(`aiEnabled 必须是 boolean（拿到 ${typeof source.aiEnabled}）`)
  }
  const merged = { ...readRikkeSettings(dataDir), ...source }
  writeAtomic(rikkeSettingsFile(dataDir), `${JSON.stringify({ schema: RIKKE_SETTINGS_SCHEMA, ...merged }, null, 2)}\n`)
  const readBack = readRikkeSettings(dataDir)
  if (readBack.aiEnabled !== merged.aiEnabled) {
    throw new Error(`rikke-settings 没写进去（aiEnabled 回读是 ${JSON.stringify(readBack.aiEnabled)}）`)
  }
  return readBack
}

/** 设置文件在不在（只给「有没有显式配置过」这类诊断留的口）。 */
export function rikkeSettingsExist(dataDir) {
  return existsSync(rikkeSettingsFile(dataDir))
}
