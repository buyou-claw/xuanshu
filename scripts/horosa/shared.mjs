/**
 * scripts/horosa/shared.mjs — 队友 B 的 `scripts/horosa/**` 内部共用小工具集。
 *
 * 契约出处：`.scratch/assembly-foundation/notes/setup-contract.md` §9（冻结接口只列
 * `mcp-client.mjs` / `serve-lifecycle.mjs` / `probe.mjs` 的六个函数名）；本文件**不是**对外的
 * 冻结面，只是这三份实现共用的几个纯函数（日志 / 截断 / JSON 读 / 控制台字节解码）。
 * 谁要动它，动的是三份实现共用的地基，别在这里加带副作用的逻辑。
 *
 * 硬约束（§9 第二条 + 票面）：本目录下任何模块**都不许往 stdout 打印** ——
 * `scripts/setup.mjs --json` 要求 stdout 只有报告 JSON。所有日志一律走 stderr，
 * 且默认沉默（`XUANSHU_HOROSA_DEBUG=1` 才出声）。
 */

import { readFileSync } from 'node:fs'

/** 调试日志开关：默认关。stdout 永远不碰，只碰 stderr。 */
const DEBUG_ENV = 'XUANSHU_HOROSA_DEBUG'

/**
 * 往 stderr 写一行调试日志（默认关闭）。
 * 为什么不用 console.*：`console.log` 会脏 stdout；即使 `console.error` 也只是包装，
 * 这里显式写 `process.stderr` 让「本模块不碰 stdout」这件事在代码里看得见。
 */
export function debug(scope, message) {
  if (!process.env[DEBUG_ENV]) return
  try {
    process.stderr.write(`[horosa:${scope}] ${message}\n`)
  } catch {
    /* stderr 被关了也不该影响主流程 */
  }
}

/** 把任意异常折算成一行可读文本（优先 message，其次 code，最后 String()）。 */
export function errorMessage(error) {
  if (error === null || error === undefined) return 'unknown error'
  if (typeof error === 'string') return error
  return error.message || error.code || String(error)
}

/** 截断字符串（evidence 只许放小体积关键字段，见契约 §7）。 */
export function truncate(value, limit = 2048) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  return text.length > limit ? `${text.slice(0, limit)}…(${text.length - limit} more)` : text
}

/** JSON.parse 的安全版本：解析不出来返回 undefined，绝不抛。 */
export function tryJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * 读 JSON 文件（探针里唯一一处文件 IO）。绝不抛：失败折算成 `{ ok:false, detail }`。
 */
export function readJsonFile(path) {
  try {
    const text = readFileSync(path, 'utf8')
    const value = tryJsonParse(text)
    if (value === undefined) return { ok: false, value: undefined, detail: `不是合法 JSON：${path}` }
    return { ok: true, value, detail: `已读取 ${path}` }
  } catch (error) {
    return { ok: false, value: undefined, detail: `读不了 JSON 文件（${errorMessage(error)}）：${path}` }
  }
}

/** fetch 的 Headers（或普通对象）→ 小写键的普通对象。 */
export function headersToObject(headers) {
  const out = {}
  if (!headers) return out
  try {
    if (typeof headers.forEach === 'function') {
      headers.forEach((value, key) => {
        out[String(key).toLowerCase()] = String(value)
      })
    } else if (typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers)) {
        if (value === undefined || value === null) continue
        out[String(key).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
      }
    }
  } catch {
    /* 取不到 header 就等于没有 header，不影响调用方的判定方向 */
  }
  return out
}

/**
 * 解码子进程输出字节。
 * 本机（Windows 中文）控制台是 cp936：`taskkill` 一类系统工具的输出按 cp936 编码，
 * 直接 utf8 解会出替换字符。先按 utf8 解，出现 U+FFFD 再试 gbk（Node 22 默认带 full ICU）。
 * 契约 §6：抓子进程输出**收字节再按 UTF-8 解**，这里是它的兜底版。
 */
export function decodeConsole(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])
  const utf8 = bytes.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    const gbk = new TextDecoder('gbk').decode(bytes)
    if (!gbk.includes('\uFFFD')) return gbk
  } catch {
    /* 该 ICU 没有 gbk：退回 utf8 结果 */
  }
  return utf8
}

/** 简单睡眠（探针轮询用）。 */
export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0))
  })
}
