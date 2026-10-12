/**
 * scripts/setup/digest.mjs — SHA256 计算与缓存 sidecar（票 05 契约 §3.2/§3.3）。
 *
 * 为什么要单独一个文件：`<name>.sha256` sidecar 的**读写格式**是缓存命中判据的一部分
 * （「命中 = 文件存在 ∧ 大小等 pin ∧ sidecar 等 pin」）。格式散在两处就会漂移：
 * 一处写 `<hex>\n`、另一处按 `<hex> *<name>` 比，缓存就会永远不命中（表现为每次重跑都重下 719MB）。
 *
 * 为什么默认不重算大文件哈希：719MB 在机械盘上要几秒到几十秒，而 sidecar 是我们自己在**校验通过后**
 * 写的（写它之前必然算过一次）。要重算就走 `--recheck`（也会刷新 sidecar）。
 *
 * 仅使用 Node 内置模块。ESM。
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { writeFileSync } from 'node:fs'

/** sidecar 里只放 64 位 hex + 换行：单一形状，读的时候 trim 即可。 */
const HEX64 = /^[0-9a-f]{64}$/

/** 读进度回调的最小间隔：大文件每秒最多刷几次，避免把 stderr 刷爆（也避免拖慢哈希本身）。 */
const PROGRESS_INTERVAL_MS = 1000

/**
 * 流式算文件的 SHA256（不把文件读进内存）。
 *
 * @param {string} file 绝对路径
 * @param {{ onProgress?: (state: { bytes: number, total: number|null, elapsedMs: number }) => void }} [options]
 * @returns {Promise<string>} 小写 hex
 */
export async function sha256File(file, { onProgress } = {}) {
  let total = null
  try {
    total = statSync(file).size
  } catch {
    /* 大小拿不到也能算（比如被别的进程占着），进度只是少个分母 */
  }

  const hash = createHash('sha256')
  let bytes = 0
  const started = Date.now()
  let lastReport = 0
  const stream = createReadStream(file, { highWaterMark: 1 << 20 })

  for await (const chunk of stream) {
    hash.update(chunk)
    bytes += chunk.length
    if (typeof onProgress === 'function') {
      const now = Date.now()
      if (now - lastReport >= PROGRESS_INTERVAL_MS) {
        lastReport = now
        onProgress({ bytes, total, elapsedMs: now - started })
      }
    }
  }
  if (typeof onProgress === 'function') onProgress({ bytes, total: total ?? bytes, elapsedMs: Date.now() - started })
  return hash.digest('hex')
}

/** sidecar 路径（`<cache>/<name>.sha256`）。 */
export function sidecarPath(file) {
  return `${file}.sha256`
}

/** 读 sidecar；不存在/不是 64 位 hex 都返回 undefined（调用方按「没有 sidecar」处置）。 */
export function readSidecar(file) {
  const path = sidecarPath(file)
  try {
    if (!existsSync(path)) return undefined
    const text = readFileSync(path, 'utf8').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    return HEX64.test(text) ? text : undefined
  } catch {
    return undefined
  }
}

/** 写 sidecar（校验通过后才写；这是「命中判据」的一半，不许在校验前写）。 */
export function writeSidecar(file, sha256) {
  writeFileSync(sidecarPath(file), `${String(sha256).toLowerCase()}\n`, 'utf8')
}

/** 删文件 + 它的 sidecar；不存在不报错（清理路径专用）。 */
export function removeArtifact(file) {
  for (const path of [file, sidecarPath(file)]) {
    try {
      if (existsSync(path)) unlinkSync(path)
    } catch {
      /* 删不掉不是本轮要报的错：调用方随后会用「文件还在」这个事实判失败 */
    }
  }
}

/** 人类可读的字节数（报告与进度行共用，避免两处各写一份除法）。 */
export function humanBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value)) return '?'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let index = 0
  let size = Math.abs(value)
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size < 10 && index > 0 ? size.toFixed(1) : Math.round(size)}${units[index]}`
}
