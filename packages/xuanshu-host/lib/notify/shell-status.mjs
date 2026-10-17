/**
 * packages/xuanshu-host/lib/notify/shell-status.mjs — 读壳的**实际生效状态**（P1 复核 #23）。
 *
 * 冻结契约只钉了 `shell-notify.json`（端点 + token）。P1 发现「开机自启实际用了哪条路」没有出口，
 * 于是壳在**同一个 runtime 目录**里多写一份兄弟文件 `shell-status.json`（加性，不动既有形状）：
 *
 *   ```json
 *   { "schema": "xuanshu/shell-status@1", "pid": 12345, "updatedAt": "…",
 *     "autostart": { "enabled": true, "method": "shortcut" }, "closeBehavior": "hide" }
 *   ```
 *
 * 纪律（与 `target.mjs` 同款）：
 *   - **路径不另立环境变量**：从 `XUANSHU_SHELL_NOTIFY_STATE` 的**同目录兄弟**推出来 ——
 *     两份文件永远同生同灭，壳不需要注入第二个变量；
 *   - **env 可注入**（纯函数）：测试不读机器 env、不读真 home；
 *   - **拿不到就说拿不到**：`{ok:false, reason:'no-shell'|'state-missing'|'state-invalid'}`。
 *     读不到 ≠ 「自启没生效」—— 调用方必须省略 `effective`，不许写成 false。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { AUTOSTART_METHODS, SHELL_PID_ENV, SHELL_STATUS_FILE, SHELL_STATUS_SCHEMA } from './contract.mjs'
import { CLOSE_BEHAVIORS } from './settings.mjs'
import { NOTIFY_STATE_ENV } from './target.mjs'

// 文件名只有一份（`contract.mjs`）；这里再导出同一绑定，方便调用方与壳侧对拍。
export { SHELL_STATUS_FILE }

/** 非严格布尔。 */
function isBool(value) {
  return value === true || value === false
}

/**
 * 校验一份状态对象（形状不对 → undefined，不抛）。
 * @param {unknown} value
 * @returns {{autostart: {enabled: boolean, method: string}, closeBehavior: 'hide'|'quit'}|undefined}
 */
export function normalizeShellStatus(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (value.schema !== SHELL_STATUS_SCHEMA) return undefined
  const autostart = value.autostart
  if (autostart === null || typeof autostart !== 'object') return undefined
  if (!isBool(autostart.enabled) || !AUTOSTART_METHODS.includes(autostart.method)) return undefined
  if (!CLOSE_BEHAVIORS.includes(value.closeBehavior)) return undefined
  return {
    autostart: { enabled: autostart.enabled, method: autostart.method },
    closeBehavior: value.closeBehavior,
  }
}

/**
 * 解析壳的实际生效状态（**纯函数**：只读 env 指到的那个目录）。
 *
 * @param {{env?: Record<string, string|undefined>}} [options]
 * @returns {{ok: true, status: {autostart: object, closeBehavior: string}}
 *          |{ok: false, reason: 'no-shell'|'state-missing'|'state-invalid', detail?: string}}
 */
export function resolveShellStatus({ env } = {}) {
  const source = env !== null && typeof env === 'object' ? env : {}
  const notifyFile = typeof source[NOTIFY_STATE_ENV] === 'string' ? source[NOTIFY_STATE_ENV].trim() : ''
  // 没有壳（浏览器里用玄枢）= 正常形态，不是故障。
  if (notifyFile === '') return { ok: false, reason: 'no-shell' }
  const file = join(dirname(notifyFile), SHELL_STATUS_FILE)

  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    return { ok: false, reason: 'state-missing', detail: `读不到壳的实际生效状态 ${file}：${String(error?.message ?? error)}` }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, reason: 'state-invalid', detail: `${file} 不是合法 JSON：${String(error?.message ?? error)}` }
  }
  const status = normalizeShellStatus(parsed)
  if (status === undefined) {
    return { ok: false, reason: 'state-invalid', detail: `${file} 的形状不合 ${SHELL_STATUS_SCHEMA}（自启方式 / 关窗行为不认识）` }
  }
  // 上一次壳被硬杀留下的状态文件：pid 与**这次**子进程 env 里的壳 pid 对不上 = 不是「现在这个壳」。
  // 宁可回「未知」，也不把上一次的自启方式说成现在的（契约 §1 允许退出时留文件）。
  const expectedPid = Number(source[SHELL_PID_ENV])
  if (Number.isInteger(expectedPid) && expectedPid > 0 && parsed.pid !== expectedPid) {
    return {
      ok: false,
      reason: 'state-invalid',
      detail: `${file} 是上一次壳留下的（pid ${JSON.stringify(parsed.pid)} ≠ ${expectedPid}）：不把它当成现在这个壳的状态`,
    }
  }
  return { ok: true, status }
}
