/**
 * packages/xuanshu-shell/lib/shell-status.mjs — 壳的**实际生效状态**文件（P1 复核 #23 的加性扩展）。
 *
 * 为什么需要第二份文件（`shell-settings.json` 已经是唯一权威）：那份记的是**想要什么**
 * （`autostart:true` / `closeBehavior:'quit'`），回答不了「这台机器上实际生效的是哪条路」——
 * 登录项可能被系统策略拒绝、退回启动文件夹快捷方式，或者两条路都不可用。票面验收要的是后者。
 *
 * 文件契约（加性；与 `shell-notify.json` 同目录的兄弟）：
 *   `<home>/xuanshu/runtime/shell-status.json`，schema `xuanshu/shell-status@1`
 *   ```json
 *   {
 *     "schema": "xuanshu/shell-status@1",
 *     "pid": 12345,
 *     "updatedAt": "2026-10-17T00:00:00.000Z",
 *     "autostart": { "enabled": true, "method": "shortcut" },
 *     "closeBehavior": "hide"
 *   }
 *   ```
 *
 * 三条纪律（与 `notify-state.mjs` 同款）：
 *   1. **原子写**：同目录 tmp + rename —— 宁可没有状态文件，也不给宿主半份 JSON；
 *   2. **不写猜的值**：`buildShellStatus` 只接受 `AUTOSTART_METHODS` / `CLOSE_BEHAVIORS` 里的值；
 *   3. **干净退出删掉它**：宿主读不到 = 没有壳（比留一份「上次的已开」更容易判读）。
 *
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { AUTOSTART_METHODS, CLOSE_BEHAVIORS, SHELL_STATUS_SCHEMA } from './contract.mjs'

/**
 * 组装状态对象（形状只有这一份；非法值**抛**，不静默写出去）。
 *
 * @param {{pid: number, autostart: {enabled: boolean, method: string},
 *          closeBehavior: 'hide'|'quit', updatedAt?: string}} input
 * @returns {{schema: string, pid: number, updatedAt: string,
 *            autostart: {enabled: boolean, method: string}, closeBehavior: string}}
 */
export function buildShellStatus({ pid, autostart, closeBehavior, updatedAt = new Date().toISOString() } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`壳 pid 必须是正整数，拿到 ${JSON.stringify(pid)}`)
  }
  if (!AUTOSTART_METHODS.includes(autostart?.method)) {
    throw new Error(`autostart.method 只能是 ${AUTOSTART_METHODS.join(' / ')}（拿到 ${JSON.stringify(autostart?.method)}）`)
  }
  if (typeof autostart?.enabled !== 'boolean') {
    throw new Error(`autostart.enabled 必须是 boolean（拿到 ${JSON.stringify(autostart?.enabled)}）`)
  }
  if (!CLOSE_BEHAVIORS.includes(closeBehavior)) {
    throw new Error(`closeBehavior 只能是 ${CLOSE_BEHAVIORS.join(' / ')}（拿到 ${JSON.stringify(closeBehavior)}）`)
  }
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) {
    throw new Error(`updatedAt 必须是 ISO 时间字符串，拿到 ${JSON.stringify(updatedAt)}`)
  }
  return {
    schema: SHELL_STATUS_SCHEMA,
    pid,
    updatedAt,
    autostart: { enabled: autostart.enabled, method: autostart.method },
    closeBehavior,
  }
}

/**
 * 原子写状态文件（同目录 tmp + rename；尽力 0600）。
 * @param {string} file
 * @param {object} status `buildShellStatus()` 的产物
 * @returns {{file: string, status: object}}
 */
export function writeShellStatusFile(file, status) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try {
    renameSync(tmp, file)
  } catch (error) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* 临时文件清不掉不掩盖原错误 */
    }
    throw error
  }
  try {
    chmodSync(file, 0o600)
  } catch {
    /* Windows 上 chmod 只影响只读位；失败不影响读面 */
  }
  return { file, status }
}

/**
 * 读并校验状态文件（壳自己排障用；**不抛**，坏文件 = undefined）。
 * @param {string} file
 * @returns {object|undefined}
 */
export function readShellStatusFile(file) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  if (parsed.schema !== SHELL_STATUS_SCHEMA) return undefined
  try {
    // 复用同一份验证：读面不接受「写得出来但读不回去」的形状。
    return buildShellStatus({ ...parsed, updatedAt: parsed.updatedAt })
  } catch {
    return undefined
  }
}

/**
 * 删掉状态文件（干净退出时用；缺失也算「已经不在」）。
 * @param {string} file
 * @returns {boolean} 真的删掉了一个文件
 */
export function removeShellStatus(file) {
  try {
    rmSync(file, { force: false })
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    return false
  }
}
