/**
 * packages/xuanshu-host/lib/notify/target.mjs — 壳写、宿主读的**运行时状态文件**（冻结契约 §1 / §3）。
 *
 * 壳与宿主之间只有一条 IPC：回环 JSON 通知端点。壳把「端口 + token」写进
 * `<home>/xuanshu/runtime/shell-notify.json`，宿主从 env `XUANSHU_SHELL_NOTIFY_STATE` 拿到路径。
 *
 * 两条纪律：
 *   - **env 可注入**（纯函数）：测试不读机器 env、不读真 home（照 `lib/horosa/paths.mjs:80-83` 的
 *     `resolveHorosaPaths({paths, config, env, platform})` 同一套形状）；
 *   - **拿不到就如实说**：`{ok:false, reason:'no-shell'|'state-missing'|'state-invalid', detail?}`。
 *     `no-shell` 是**正常形态**（浏览器里用玄枢），不是故障；`state-invalid` 才是「有人说自己是壳，
 *     但这份状态文件不能用」。
 *
 * 为什么必须校验回环：状态文件是可写文件，写坏了/被换掉就可能把「今天的日课已生成」发去外网。
 * 契约 §1 的原话是「非回环一律判非法，宿主拒绝使用」——这里是那道门。
 */

import { readFileSync } from 'node:fs'

import { SHELL_NOTIFY_SCHEMA } from './contract.mjs'

// schema 的唯一来源在 `contract.mjs`（两侧夹测的公共断言）；这里再导出一份同一绑定，方便引用。
export { SHELL_NOTIFY_SCHEMA }

/** 壳把状态文件路径注入子进程用的环境变量名（契约 §0 定值）。 */
export const NOTIFY_STATE_ENV = 'XUANSHU_SHELL_NOTIFY_STATE'

/** 回环 host 白名单（契约 §1：`127.0.0.1` 或 `localhost`，别的都不认）。 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost'])

/**
 * 把状态文件里的 URL 解析成「回环 origin」；不合契约 → null。
 *
 * 三条硬要求：`http:`（不是 https）、host 是回环白名单、**必须带端口**（契约 §1 的形状是
 * `http://127.0.0.1:<port>`；没有端口的 URL 会打到 80，那不是壳的端点）。
 *
 * @param {unknown} raw
 * @returns {{origin: string, host: string, port: number}|null}
 */
export function parseLoopbackOrigin(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:') return null
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null
  if (url.port === '') return null
  const port = Number(url.port)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  // 状态文件里应当是纯 origin：允许 `/`，别的路径说明写错了（端点路径由发送侧拼 `/v1/notify`）。
  if (url.pathname !== '/' && url.pathname !== '') return null
  if (url.search !== '' || url.hash !== '') return null
  return { origin: `http://${url.hostname}:${url.port}`, host: url.hostname, port }
}

/**
 * 解析通知目标（**纯函数**：只读 env 给出的那个文件）。
 *
 * @param {{env?: Record<string, string|undefined>}} [options]
 *        `env` 缺省 = `{}`（= 拿不到环境 = 没有壳）；生产调用方显式传 `process.env`
 *        —— 默认读 `process.env` 会让断言台被机器现场污染，这里刻意不这么做。
 * @returns {{ok: true, url: string, token: string}
 *          |{ok: false, reason: 'no-shell'|'state-missing'|'state-invalid', detail?: string}}
 */
export function resolveNotifyTarget({ env } = {}) {
  const source = env !== null && typeof env === 'object' ? env : {}
  const file = typeof source[NOTIFY_STATE_ENV] === 'string' ? source[NOTIFY_STATE_ENV].trim() : ''
  // env 缺席 = 没有壳（浏览器模式）：这是**正常形态**，不是失败。
  if (file === '') return { ok: false, reason: 'no-shell' }

  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    return { ok: false, reason: 'state-missing', detail: `读不到壳的运行时状态文件 ${file}：${String(error?.message ?? error)}` }
  }

  let state
  try {
    state = JSON.parse(text)
  } catch (error) {
    return { ok: false, reason: 'state-invalid', detail: `${file} 不是合法 JSON：${String(error?.message ?? error)}` }
  }
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, reason: 'state-invalid', detail: `${file} 不是对象` }
  }
  if (state.schema !== SHELL_NOTIFY_SCHEMA) {
    return {
      ok: false,
      reason: 'state-invalid',
      detail: `${file} 的 schema 不认识：拿到 ${JSON.stringify(state.schema)}，只认 ${SHELL_NOTIFY_SCHEMA}`,
    }
  }
  const origin = parseLoopbackOrigin(state.url)
  if (origin === null) {
    return { ok: false, reason: 'state-invalid', detail: `${file} 的 url 不是回环 http 端点（要 http://127.0.0.1:<port>）：${JSON.stringify(state.url)}` }
  }
  const token = typeof state.token === 'string' ? state.token.trim() : ''
  if (token === '') return { ok: false, reason: 'state-invalid', detail: `${file} 的 token 为空` }

  // 形状逐字照契约 §3：`{ ok:true, url, token }`（不多塞键 —— 发送侧一次 `new URL()` 很便宜，
  // 而形状多一个键就意味着两侧夹测要多容忍一个字段）。
  return { ok: true, url: origin.origin, token }
}
