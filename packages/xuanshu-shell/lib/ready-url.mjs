/**
 * packages/xuanshu-shell/lib/ready-url.mjs — 从 DSH 子进程 stdout 里认「认证后的 URL」（契约 §0）。
 *
 * 为什么必须是纯函数 + 流式扫描器：
 *   - 壳不能猜地址：拿不到 URL 时显示「服务未就绪」是**正确行为**，不是降级；
 *   - 子进程 stdout 是流：一行可能被拆进两个 chunk（实测 URL 很长，最容易在 token 处断开），
 *     对每个 chunk 直接跑正则会在慢机器上偶发解析失败 —— 这种 bug 在真机上表现为「有时打不开」。
 *
 * 真实打印处：`@deepseek-ai/dsh-web-app/lib/index.js:203`（rc.2）
 *   `dsh web: ${authenticatedUrl}`，带 LAN 时行尾追加 ` (LAN: ${lanUrl})`。
 */

/** 契约 §0 的正则：整行、只认 http URL。 */
const READY_URL_RE = /^dsh web: (http:\/\/\S+)(?: \(LAN: \S+\))?$/

/** 单行缓冲上限：超长行截断（stdout 里可能有巨型 JSON 日志，不能无限吃内存）。 */
const DEFAULT_MAX_LINE_LENGTH = 16 * 1024

/**
 * 解析一行 stdout；是认证 URL 行就返回 URL，否则 `null`。
 *
 * 不猜：不是 `dsh web:` 开头、不是 http、或后面还跟了别的 token 的行一律不认。
 *
 * @param {unknown} line
 * @returns {string|null}
 */
export function parseReadyUrlLine(line) {
  if (typeof line !== 'string') return null
  const trimmed = line.replace(/\r$/u, '').trim()
  if (trimmed === '') return null
  const match = READY_URL_RE.exec(trimmed)
  if (match === null) return null
  const candidate = match[1]
  try {
    const url = new URL(candidate)
    // 再校验一次协议：正则已经钉了 http，这里防的是「正则被改松」而测试没跟上。
    if (url.protocol !== 'http:') return null
    if (url.hostname === '') return null
    return candidate
  } catch {
    return null
  }
}

/**
 * 行扫描器：把任意切分的 chunk 还原成行。
 *
 * 语义：`push(chunk)` 返回本次**新完成**的行（可能 0..n 条）；`flush()` 把末尾残行交出来（只会交一次）。
 * 超长行被截断到 `maxLineLength`，宁可丢日志也不让壳被一段没有换行的输出撑爆内存。
 *
 * @param {{maxLineLength?: number}} [options]
 * @returns {{push: (chunk: unknown) => string[], flush: () => string[]}}
 */
export function createLineScanner({ maxLineLength = DEFAULT_MAX_LINE_LENGTH } = {}) {
  let buffer = ''
  let truncated = false
  const limit = Number.isFinite(maxLineLength) && maxLineLength > 0 ? maxLineLength : DEFAULT_MAX_LINE_LENGTH

  return {
    push(chunk) {
      if (chunk === undefined || chunk === null) return []
      buffer += String(chunk)
      const lines = []
      let index = buffer.indexOf('\n')
      while (index !== -1) {
        let line = buffer.slice(0, index)
        if (truncated) {
          line = `${line.slice(0, Math.max(0, limit - 1))}…`
          truncated = false
        }
        lines.push(line)
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
      }
      if (buffer.length > limit) {
        buffer = buffer.slice(0, limit)
        truncated = true
      }
      return lines
    },
    flush() {
      if (buffer === '') return []
      const line = truncated ? `${buffer.slice(0, Math.max(0, limit - 1))}…` : buffer
      buffer = ''
      truncated = false
      return [line]
    },
  }
}
