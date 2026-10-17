/**
 * packages/xuanshu-host/lib/notify/settings.mjs — 壳与宿主共享的设置文件（冻结契约 §5）。
 *
 * **不是第二条 IPC**：`<dataDir>/shell-settings.json` 是唯一权威，壳读、宿主读写；缺文件 = 全部默认值。
 * 壳自己关心 `closeBehavior` / `autostart`（#23），宿主关心 `notifySummary`（决定通知正文带不带
 * 一句不含私事的短句）。两边读同一份文件，因此谁先起都能读到对方的设置。
 *
 * #25 的加性键：`rikkeTime` / `wanshengTime`（两条触达的计划时刻期望值）。
 * **它们不进 `DEFAULT_SHELL_SETTINGS`**：壳的读面（`readShellSettings`）与 #23 的本地副本逐字对拍
 * （`tests/shell/contract-parity.test.mjs`），壳不认这两个键；宿主用 `readTouchTimes` 单独读。
 *
 * 三条纪律：
 *   - **写后回读**：写操作不许静默（界面会按返回值显示「开 / 关」，写坏了却回新值等于骗人）；
 *   - **坏文件不当设置**：schema 不认识 / JSON 坏了 → 读面回落默认值（与 `digao/store.mjs` 的
 *     「schema 不认识就当没有」同款），下一次写会覆盖成合法形状；
 *   - **壳的默认值 vs 宿主的默认值分开**：`DEFAULT_SHELL_SETTINGS` 是壳契约，#25 的两键在
 *     `DEFAULT_TOUCH_TIMES` 里（同一份文件、不同的读面）。
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

/**
 * 两条触达的计划时刻（#25 契约 §2/§4 的加性键）：`HH:mm`，缺省 07:30 / 21:30。
 *
 * **语义分工**：`ctx.schedule` 里那条 daily 任务才是「实际生效」的权威；这两个键是
 * 「下次安装 / 界面显示」的**期望值**。`rikke.setTime` / `wansheng.setTime` 会两边一起写，
 * 所以改完下一次到点就按新时刻走（不需要重装）。
 */
export const TOUCH_TIME_KEYS = Object.freeze({ rikkeTime: '07:30', wanshengTime: '21:30' })

/** 壳关心的三项（#23/#24 冻结；#25 **不扩**这一层 —— 壳的本地副本与这里逐字对拍）。 */
export const DEFAULT_SHELL_SETTINGS = Object.freeze({
  closeBehavior: 'hide',
  autostart: false,
  notifySummary: false,
})

/** 宿主关心的两个时刻（#25 加性；壳不读）。 */
export const DEFAULT_TOUCH_TIMES = Object.freeze({ ...TOUCH_TIME_KEYS })

/**
 * `'H:mm'` / `'HH:mm'` / `'HH:mm:ss'` → `'HH:mm'`；非法 → null（设置面只显示到分钟）。
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeClockTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/u.exec(String(value ?? '').trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${match[2]}`
}

/** `<dataDir>/shell-settings.json`。 */
export function shellSettingsFile(dataDir) {
  return join(dataDir, SHELL_SETTINGS_FILE)
}

/**
 * 读盘上那份设置对象：文件缺失 / JSON 坏 / schema 不认识 / 非对象 → null（调用方给默认值）。
 * @returns {object|null}
 */
function readParsed(dataDir) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(shellSettingsFile(dataDir), 'utf8'))
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schema !== SHELL_SETTINGS_SCHEMA) {
    return null
  }
  return parsed
}

/**
 * 读**壳**关心的三项（任何读不懂的东西都回落默认值，不抛）。
 * 这一层的形状与 #23 壳的本地副本逐字对拍 —— 不要往这里加 #25 的时刻键。
 * @param {string} dataDir
 * @returns {{closeBehavior: 'hide'|'quit', autostart: boolean, notifySummary: boolean}}
 */
export function readShellSettings(dataDir) {
  const parsed = readParsed(dataDir)
  if (parsed === null) return { ...DEFAULT_SHELL_SETTINGS }
  return {
    closeBehavior: CLOSE_BEHAVIORS.includes(parsed.closeBehavior) ? parsed.closeBehavior : DEFAULT_SHELL_SETTINGS.closeBehavior,
    autostart: typeof parsed.autostart === 'boolean' ? parsed.autostart : DEFAULT_SHELL_SETTINGS.autostart,
    notifySummary: typeof parsed.notifySummary === 'boolean' ? parsed.notifySummary : DEFAULT_SHELL_SETTINGS.notifySummary,
  }
}

/**
 * 读**宿主**关心的两个触达时刻（#25）。坏形状 / 缺失 → 回落缺省（坏设置不该让安装或到点链失败）。
 * @param {string} dataDir
 * @returns {{rikkeTime: string, wanshengTime: string}} `HH:mm`
 */
export function readTouchTimes(dataDir) {
  const parsed = readParsed(dataDir)
  if (parsed === null) return { ...DEFAULT_TOUCH_TIMES }
  return {
    rikkeTime: normalizeClockTime(parsed.rikkeTime) ?? DEFAULT_TOUCH_TIMES.rikkeTime,
    wanshengTime: normalizeClockTime(parsed.wanshengTime) ?? DEFAULT_TOUCH_TIMES.wanshengTime,
  }
}

/** 全部五个键（宿主内部用：写入前的合并与写后回读）。 */
function readAllSettings(dataDir) {
  return { ...readShellSettings(dataDir), ...readTouchTimes(dataDir) }
}

/**
 * 改设置（部分更新；**校验 + 原子写 + 回读**）。
 *
 * 接受的键：壳的三项（`closeBehavior` / `autostart` / `notifySummary`）+ #25 的两个时刻。
 * **返回值保持 #24 的形状（壳的三项）** —— 时刻请用 `readTouchTimes` 读
 * （`traffic.settings.get` 会把两者拼在一起给界面）。
 *
 * @param {string} dataDir
 * @param {{closeBehavior?: 'hide'|'quit', autostart?: boolean, notifySummary?: boolean,
 *          rikkeTime?: string, wanshengTime?: string}} patch
 * @returns {{closeBehavior: 'hide'|'quit', autostart: boolean, notifySummary: boolean}}
 */
export function writeShellSettings(dataDir, patch = {}) {
  const source = patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const allowed = [...Object.keys(DEFAULT_SHELL_SETTINGS), ...Object.keys(TOUCH_TIME_KEYS)]
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) {
      throw new Error(`shell-settings 不认识这个键：${JSON.stringify(key)}（只认 ${allowed.join(' / ')}）`)
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
  for (const key of Object.keys(TOUCH_TIME_KEYS)) {
    if (source[key] === undefined) continue
    if (normalizeClockTime(source[key]) === null) {
      throw new Error(`${key} 必须是 HH:mm（拿到 ${JSON.stringify(source[key])}）`)
    }
  }

  // 时刻写盘前归一（'7:05' → '07:05'），回读断言才对得上。
  const normalized = { ...source }
  for (const key of Object.keys(TOUCH_TIME_KEYS)) {
    if (normalized[key] !== undefined) normalized[key] = normalizeClockTime(normalized[key])
  }
  const merged = { ...readAllSettings(dataDir), ...normalized }
  const file = shellSettingsFile(dataDir)
  writeAtomic(file, `${JSON.stringify({ schema: SHELL_SETTINGS_SCHEMA, ...merged }, null, 2)}\n`)

  // 写后回读：磁盘上还是旧的（或写坏了）就如实抛，不把「没写进去」说成「改成了」。
  const readBack = readAllSettings(dataDir)
  for (const key of Object.keys(merged)) {
    if (readBack[key] !== merged[key]) {
      throw new Error(`设置没写进去（${key} 回读是 ${JSON.stringify(readBack[key])}）：${file}`)
    }
  }
  if (!existsSync(file)) throw new Error(`设置文件写完之后不在了：${file}`)
  return readShellSettings(dataDir)
}

/**
 * 把改好的触达时刻同步进共享设置（#25 契约 §2：schedule 是实际生效的权威，设置文件是期望值）。
 *
 * `ctx.schedule.update` 成功之后才调它；这里失败要说清「时刻已经生效了，只是期望值没落盘」——
 * 静默吞掉会让界面显示旧值，用户以为没改成。
 *
 * @param {string} dataDir
 * @param {'rikkeTime'|'wanshengTime'} key
 * @param {string} time `HH:mm` 或 `HH:mm:ss`
 * @returns {string} 写进去的 `HH:mm`
 */
export function syncTouchTimeSettings(dataDir, key, time) {
  if (!Object.hasOwn(TOUCH_TIME_KEYS, key)) throw new Error(`不认识的触达时刻键：${JSON.stringify(key)}`)
  const normalized = normalizeClockTime(time)
  if (normalized === null) throw new Error(`${key} 必须是 HH:mm（拿到 ${JSON.stringify(time)}）`)
  try {
    writeShellSettings(dataDir, { [key]: normalized })
  } catch (error) {
    throw new Error(`时刻已生效（schedule 已改），但设置文件没写成：${String(error?.message ?? error)}`)
  }
  return normalized
}
