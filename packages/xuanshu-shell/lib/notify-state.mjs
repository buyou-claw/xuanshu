/**
 * packages/xuanshu-shell/lib/notify-state.mjs — 壳写、宿主读的运行时状态文件（冻结契约 §1）。
 *
 * 这是壳与宿主之间**唯一**的握手：壳在回环上起通知端点后，把 `{url, token}` 写进
 * `<home>/xuanshu/runtime/shell-notify.json`；宿主从 env `XUANSHU_SHELL_NOTIFY_STATE` 拿到路径。
 * 路径由壳注入子进程 env（`dsh-entry.mjs::buildChildEnv`），所以两份文件位置不会各写一份。
 *
 * 三条纪律：
 *   1. **原子写**：同目录 tmp（`wx`）→ rename；宁可没有状态文件，也不给宿主半份 JSON
 *      （半份 JSON 在宿主侧是 `state-invalid`，用户看到的是「通知坏了」而不是「壳正在起」）；
 *   2. **只写回环**：`url` 非回环 / token 为空直接抛 —— 写出去就是给宿主一个把私事发去外网的地址；
 *   3. **尽力 0600**：Windows 上 chmod 只影响只读位，失败也继续（文件里是回环端点的 token，
 *      不是长期凭据；真正的边界是「只监听 127.0.0.1」）。
 *
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { SHELL_NOTIFY_SCHEMA } from './contract.mjs'

/** 回环 host 白名单（契约 §1：`127.0.0.1` 或 `localhost`，别的都不认）。 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost'])

/** token 的形态（契约 §1：64 hex chars）。只用于校验，不用于生成。 */
const TOKEN_RE = /^[0-9a-f]{64}$/u

/**
 * URL 是不是契约 §1 认的回环端点（http + 回环 host + 明写端口 + 纯 origin）。
 * 与宿主 `target.mjs::parseLoopbackOrigin` 同一套判据（宿主侧另有对拍测试）。
 *
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isLoopbackUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return false
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  if (!LOOPBACK_HOSTS.has(url.hostname)) return false
  if (url.port === '') return false
  const port = Number(url.port)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return false
  if (url.pathname !== '/' && url.pathname !== '') return false
  if (url.search !== '' || url.hash !== '') return false
  return true
}

/**
 * 构造状态对象（shape 只有这一份）。
 *
 * @param {{url: string, token: string, pid: number, startedAt?: string,
 *          capabilities?: {notification: boolean, clickToWindow: boolean}}} options
 * @returns {{schema: string, url: string, token: string, pid: number, startedAt: string,
 *            capabilities: {notification: boolean, clickToWindow: boolean}}}
 */
export function buildNotifyState({
  url, token, pid, startedAt = new Date().toISOString(),
  capabilities = { notification: true, clickToWindow: true },
} = {}) {
  if (!isLoopbackUrl(url)) {
    throw new Error(`通知端点必须是回环 http URL（http://127.0.0.1:<port>），拿到 ${JSON.stringify(url)}`)
  }
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
    throw new Error(`通知 token 必须是 64 位小写 hex，拿到 ${JSON.stringify(token)}`)
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`壳 pid 必须是正整数，拿到 ${JSON.stringify(pid)}`)
  }
  if (typeof startedAt !== 'string' || Number.isNaN(Date.parse(startedAt))) {
    throw new Error(`startedAt 必须是 ISO 时间字符串，拿到 ${JSON.stringify(startedAt)}`)
  }
  const caps = capabilities !== null && typeof capabilities === 'object' ? capabilities : {}
  return {
    schema: SHELL_NOTIFY_SCHEMA,
    url,
    token,
    pid,
    startedAt,
    capabilities: {
      notification: caps.notification === true,
      clickToWindow: caps.clickToWindow === true,
    },
  }
}

/**
 * 原子写状态文件（同目录 tmp + rename；尽力 0600）。
 *
 * @param {string} file
 * @param {object} state `buildNotifyState()` 的产物
 * @returns {{file: string, state: object}}
 */
export function writeNotifyStateFile(file, state) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
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
    /* Windows 上 chmod 只影响只读位；失败不影响握手（边界是「只监听 127.0.0.1」） */
  }
  return { file, state }
}

/**
 * 读并校验状态文件（壳自己重启/排障用；**不抛**）。
 *
 * 判据与宿主 `resolveNotifyTarget` 同一套；理由码刻意用短标识，便于日志与测试断言。
 *
 * @param {string} file
 * @returns {{ok: true, state: object}
 *          |{ok: false, reason: 'missing'|'invalid-json'|'schema-mismatch'|'not-loopback'|'token-empty', detail: string}}
 */
export function readNotifyState(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    return { ok: false, reason: 'missing', detail: `读不到 ${file}：${String(error?.message ?? error)}` }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, reason: 'invalid-json', detail: `${file} 不是合法 JSON：${String(error?.message ?? error)}` }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid-json', detail: `${file} 不是对象` }
  }
  if (parsed.schema !== SHELL_NOTIFY_SCHEMA) {
    return { ok: false, reason: 'schema-mismatch', detail: `${file} 的 schema 不认识：${JSON.stringify(parsed.schema)}` }
  }
  if (!isLoopbackUrl(parsed.url)) {
    return { ok: false, reason: 'not-loopback', detail: `${file} 的 url 不是回环 http 端点：${JSON.stringify(parsed.url)}` }
  }
  if (typeof parsed.token !== 'string' || parsed.token.trim() === '') {
    return { ok: false, reason: 'token-empty', detail: `${file} 的 token 为空` }
  }
  return { ok: true, state: parsed }
}

/**
 * 删掉状态文件（干净退出时用；缺失也算成功）。
 *
 * 为什么干净退出要删：留着一个指向已关闭端口的文件，宿主会拿到 `failed` 而不是「没有壳」。
 * 契约 §1 两种都允许（「退出时可删除，也可留着」），但「删掉」让宿主侧的因果更清楚。
 *
 * @param {string} file
 * @returns {boolean} 真的删掉了一个文件
 */
export function removeNotifyState(file) {
  try {
    rmSync(file, { force: false })
    return true
  } catch (error) {
    // ENOENT = 本来就没有：不是失败（干净退出时状态文件可能已经被删过一次）。
    if (error?.code === 'ENOENT') return false
    return false
  }
}
