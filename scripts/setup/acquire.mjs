/**
 * scripts/setup/acquire.mjs — 取件与校验：缓存 / 断点续传 / 镜像 / SHA256 门（票 05 契约 §3）。
 *
 * 缓存布局（契约 §3.2，三件套缺一不可）：
 *   <cache>/<name>          最终件（只有校验通过的字节才会出现在这里）
 *   <cache>/<name>.part     正在下载；崩溃/断连后**故意保留**，下次用 `Range: bytes=<已下>-` 续传
 *   <cache>/<name>.sha256   校验通过后写的 sidecar（命中判据的一半）
 *
 * 命中条件 = 文件存在 **且** 大小 == pin **且** sidecar == pin 的 sha256。
 * 默认**不重算**大文件哈希（719MB 重算要几十秒），要重算走 `--recheck`。
 *
 * 三条不许松的口：
 *   1. **SHA256 不匹配 = 一个字节都不装**：删掉 `.part`/目标件 + exit 2；绝不「先装上再报警」。
 *   2. **镜像只换传输**：候选 URL 由 `mirror.mjs` 生成（原 URL 永远最后），校验门原样保留 ——
 *      第三方代理正是需要校验的理由。
 *   3. **`--skip-download` 是真离线**：只用缓存/本地件，缺件就失败并告诉人两条出路。
 *
 * 只走 Node 内置 `fetch`，不引第三方。ESM。
 */

import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { humanBytes, readSidecar, removeArtifact, sha256File, writeSidecar } from './digest.mjs'
import { EXIT, SetupError } from './exit.mjs'
import { mirrorCandidates } from './mirror.mjs'

/** 下载停滞判定：多少毫秒没有任何字节就掐掉重试（慢镜像 ≠ 死镜像，所以按「停顿」而不是总时长判）。 */
const STALL_MS = 60_000

/** 重试退避上限（指数退避 500ms → 1s → 2s → … 到 5s 封顶）。 */
const BACKOFF_CAP_MS = 5_000

/** 是不是 http(s) URL（`file://` 与本地路径都算「离线件」）。 */
export function isUrl(value) {
  return /^https?:\/\//i.test(String(value ?? '').trim())
}

/** 缓存里这个工件的最终路径。 */
export function cacheFilePath(cacheDir, artifact) {
  return join(cacheDir, artifact.name)
}

/**
 * 看一眼缓存状态（**同步、不读大文件**，所以 `--dry-run` 也能用）。
 * @returns {{ file: string, state: 'hit'|'missing'|'size-mismatch'|'no-sidecar'|'sidecar-mismatch', size?: number }}
 */
export function cacheState({ cacheDir, artifact }) {
  const file = cacheFilePath(cacheDir, artifact)
  if (!existsSync(file)) return { file, state: 'missing' }
  const size = statSync(file).size
  if (size !== artifact.size) return { file, state: 'size-mismatch', size }
  const sidecar = readSidecar(file)
  if (sidecar === undefined) return { file, state: 'no-sidecar', size }
  if (sidecar !== artifact.sha256) return { file, state: 'sidecar-mismatch', size }
  return { file, state: 'hit', size }
}

/** 大小/哈希不匹配时统一措辞：期望 vs 实际 + pin 版本（人一眼看出是「钉错版」还是「抓到坏字节」）。 */
function mismatchError({ artifact, actualSha, actualSize, path, source }) {
  const sizeNote = actualSize === undefined || actualSize === artifact.size
    ? ''
    : `\n  大小也不对：期望 ${artifact.size} 字节（${humanBytes(artifact.size)}），实际 ${actualSize} 字节`
  return new SetupError(
    `${artifact.kind} 的 SHA256 与钉版不符（${source}）\n`
    + `  文件：${path}${sizeNote}\n`
    + `  期望：${artifact.sha256}  (pin v${artifact.pinVersion})\n`
    + `  实际：${actualSha}`,
    {
      code: EXIT.fetch,
      evidence: {
        kind: artifact.kind,
        path,
        expectedSha256: artifact.sha256,
        actualSha256: actualSha,
        expectedSize: artifact.size,
        actualSize,
        pinVersion: artifact.pinVersion,
      },
      hint: `# pin 里的 URL 是权威：换版本要改 scripts/setup/horosa-pin.json（ADR-0004 的升级清单），不要手改缓存里的字节。`,
    },
  )
}

/**
 * 取一个工件：本地件 → 缓存 → 下载，三条路最后都过同一道 SHA256 门。
 *
 * @param {{
 *   artifact: { kind: string, name: string, sha256: string, size: number, url: string, pinVersion: string },
 *   local?: string,            // --wheel / --runtime 的值（本地路径或 URL）
 *   cacheDir: string,
 *   mirrorPrefixes?: string[],
 *   retries?: number,          // 每个候选 URL 的最大尝试次数
 *   recheck?: boolean,         // 强制重算缓存大文件的 SHA256
 *   skipDownload?: boolean,    // 严格离线
 *   log?: (line: string) => void,
 * }} options
 * @returns {Promise<{ action: 'offline'|'cache-hit'|'downloaded', path: string, sha256: string,
 *                     bytes: number, url: string|null, candidates: string[], attempts: number,
 *                     resumedBytes?: number }>}
 */
export async function acquireArtifact({
  artifact, local, cacheDir, mirrorPrefixes = [], retries = 3, recheck = false, skipDownload = false, log = () => {},
}) {
  const label = artifact.kind
  const pinned = { ...artifact, pinVersion: artifact.pinVersion ?? artifact.version ?? '?' }

  /* ---------------------------- 1. 离线件优先 ---------------------------- */
  if (local !== undefined && local !== null && String(local).trim() !== '' && !isUrl(local)) {
    const path = resolve(String(local))
    if (!existsSync(path)) {
      throw new SetupError(`--${label} 给的本地文件不存在：${path}`, {
        code: EXIT.fetch,
        hint: `# 确认路径；或去掉 --${label}，让我们按 pin 取件（必要时加 --skip-download 只用缓存）。`,
      })
    }
    const size = statSync(path).size
    log(`[setup] ${label}：用离线件 ${path}（${humanBytes(size)}），仍过 SHA256 门`)
    const actualSha = await sha256File(path, { onProgress: (state) => logProgress(`${label} 校验`, state, log) })
    if (actualSha !== pinned.sha256) {
      throw mismatchError({ artifact: pinned, actualSha, actualSize: size, path, source: '离线件 --' + label })
    }
    log(`[setup] ${label} 离线件 SHA256 通过`)
    return { action: 'offline', path, sha256: actualSha, bytes: size, url: null, candidates: [], attempts: 0 }
  }

  /* ---------------------------- 2. 缓存命中 ---------------------------- */
  const target = cacheFilePath(cacheDir, pinned)
  const part = `${target}.part`
  const state = cacheState({ cacheDir, artifact: pinned })
  // 被判定为坏件而删掉的缓存件：信息要留到最后的错误里（否则「文件明明在、怎么还说缺件」）
  let discarded = null
  if (state.state === 'hit') {
    if (!recheck) {
      log(`[setup] ${label}：缓存命中 ${state.file}（size=${state.size}，sidecar 与 pin 一致；未重算大文件哈希）`)
      return { action: 'cache-hit', path: state.file, sha256: pinned.sha256, bytes: state.size, url: null, candidates: [], attempts: 0 }
    }
    log(`[setup] ${label}：--recheck 重算 ${state.file} 的 SHA256…`)
    const actualSha = await sha256File(state.file, { onProgress: (s) => logProgress(`${label} 复核`, s, log) })
    if (actualSha === pinned.sha256) {
      writeSidecar(state.file, actualSha)
      log(`[setup] ${label}：--recheck 复核通过`)
      return { action: 'cache-hit', path: state.file, sha256: actualSha, bytes: state.size, url: null, candidates: [], attempts: 0 }
    }
    log(`[setup] ${label}：缓存件与 pin 不符（${actualSha.slice(0, 12)}…），删掉重取`)
    discarded = { file: state.file, reason: 'sha256-mismatch', expectedSha256: pinned.sha256, actualSha256: actualSha }
    removeArtifact(state.file)
  } else if (state.state === 'size-mismatch') {
    log(`[setup] ${label}：缓存件大小不对（${state.size} ≠ pin ${pinned.size}），删掉重取：${state.file}`)
    discarded = { file: state.file, reason: 'size-mismatch', expectedSize: pinned.size, actualSize: state.size }
    removeArtifact(state.file)
  } else if (state.state === 'no-sidecar' || state.state === 'sidecar-mismatch') {
    // 大小对得上，但 sidecar 缺了/不符。**不许直接删**：这个工件可能是别人（Lead、手工下载、另一个工具）
    // 放进来的正确件 —— 删一个 719MB 的正确件，比算一次哈希贵得多，而且会让人以为「缓存永远不命中」。
    // 契约 §3.2 的「首次落盘必须算一次」正是这一格：先算、算过就写 sidecar，之后才是纯 sidecar 命中。
    log(`[setup] ${label}：缓存件没有可用 sidecar（${state.state}，size 与 pin 一致），算一次 SHA256 判真伪…`)
    const actualSha = await sha256File(state.file, { onProgress: (s) => logProgress(`${label} 核对`, s, log) })
    if (actualSha === pinned.sha256) {
      writeSidecar(state.file, actualSha)
      log(`[setup] ${label}：缓存件核对通过，补写 sidecar → ${state.file}.sha256`)
      return { action: 'cache-hit', path: state.file, sha256: actualSha, bytes: state.size, url: null, candidates: [], attempts: 0 }
    }
    log(`[setup] ${label}：缓存件与 pin 不符（${actualSha.slice(0, 12)}…），删掉重取`)
    discarded = { file: state.file, reason: 'sha256-mismatch', expectedSha256: pinned.sha256, actualSha256: actualSha }
    removeArtifact(state.file)
  }

  /* ---------------------------- 3. 下载 ---------------------------- */
  const url = isUrl(local) ? String(local).trim() : pinned.url
  const candidates = mirrorCandidates(url, mirrorPrefixes)
  if (skipDownload) {
    const discardedNote = discarded === null ? '' : [
      '',
      `  注意：缓存里那份已判定为坏件并**删除**了（${discarded.reason}）`,
      `    文件：${discarded.file}`,
      discarded.expectedSha256 === undefined ? '' : `    期望 SHA256：${discarded.expectedSha256}`,
      discarded.actualSha256 === undefined ? '' : `    实际 SHA256：${discarded.actualSha256}`,
      discarded.actualSize === undefined ? '' : `    期望大小：${discarded.expectedSize}  实际大小：${discarded.actualSize}`,
    ].filter((line) => line !== '').join('\n')
    throw new SetupError(
      `--skip-download 且 ${label} 不在缓存里：${target}\n  镜像/候选：${candidates.join(', ')}${discardedNote}`,
      {
        code: EXIT.fetch,
        evidence: { kind: label, cacheFile: target, candidates, discarded },
        hint: [
          `# 两条出路：`,
          `#   1) 用离线件:  node scripts/setup.mjs --${label} <本地 ${label} 路径>`,
          `#   2) 先联网跑一次（可带镜像）:  node scripts/setup.mjs --mirror https://gh-proxy.com/https://github.com`,
        ].join('\n'),
      },
    )
  }

  mkdirSync(cacheDir, { recursive: true })
  const attemptsPerCandidate = Math.max(1, Number(retries) || 1)
  const failures = []
  let attempts = 0
  let resumedBytes = 0
  let usedUrl = candidates[0]

  for (const candidate of candidates) {
    usedUrl = candidate
    for (let attempt = 1; attempt <= attemptsPerCandidate; attempt += 1) {
      attempts += 1
      try {
        const result = await downloadOnce({ url: candidate, partFile: part, expectedSize: pinned.size, log, label })
        log(`[setup] ${label}：下载完成（HTTP ${result.httpStatus}，${humanBytes(result.bytes)}${result.resumed > 0 ? `，续传 ${humanBytes(result.resumed)}` : ''}）`)
        resumedBytes = result.resumed
        failures.length = 0
        break
      } catch (error) {
        const message = error?.message ?? String(error)
        failures.push(`${candidate}（第 ${attempt}/${attemptsPerCandidate} 次）：${message}`)
        log(`[setup] ${label}：下载失败（第 ${attempt}/${attemptsPerCandidate} 次）：${message}`)
        if (attempt < attemptsPerCandidate) await sleep(Math.min(BACKOFF_CAP_MS, 500 * 2 ** (attempt - 1)))
      }
    }
    if (failures.length === 0) break
  }

  if (failures.length > 0) {
    throw new SetupError(`${label} 下载失败（${candidates.length} 个候选 URL × ${attemptsPerCandidate} 次全部失败）`, {
      code: EXIT.fetch,
      evidence: { kind: label, candidates, failures: failures.slice(-8) },
      hint: [
        `# 直连 github 在本机实测只有 12–24 KB/s（719MB ≈ 8–16 小时），务必给镜像：`,
        `#   node scripts/setup.mjs --mirror https://gh-proxy.com/https://github.com`,
        `# 或者用离线件: node scripts/setup.mjs --${label} <本地路径>`,
      ].join('\n'),
    })
  }

  /* ---------------------------- 4. 校验（唯一入口） ---------------------------- */
  if (!existsSync(part)) {
    throw new SetupError(`${label} 下载后找不到 ${part}（不可能发生：请报 bug）`, { code: EXIT.fetch })
  }
  const partSize = statSync(part).size
  if (partSize !== pinned.size) {
    throw new SetupError(
      `${label} 下载件大小不对：期望 ${pinned.size}（${humanBytes(pinned.size)}），实际 ${partSize}（${humanBytes(partSize)}）`,
      { code: EXIT.fetch, evidence: { kind: label, part, expectedSize: pinned.size, actualSize: partSize } },
    )
  }

  log(`[setup] ${label}：算 SHA256…`)
  const actualSha = await sha256File(part, { onProgress: (s) => logProgress(`${label} 校验`, s, log) })
  if (actualSha !== pinned.sha256) {
    // 契约 §3.3：不匹配 → 删掉 .part/目标件，一个字节都不装。
    removeArtifact(part)
    removeArtifact(target)
    throw mismatchError({ artifact: pinned, actualSha, actualSize: partSize, path: part, source: `镜像候选 ${usedUrl}` })
  }

  // 原子落地：Windows 上 rename 不覆盖已存在的目标，所以先清掉旧目标（旧目标已被上面的 cacheState 判为不可用）。
  if (existsSync(target)) unlinkSync(target)
  renameSync(part, target)
  writeSidecar(target, actualSha)
  log(`[setup] ${label}：SHA256 通过 → ${target}`)

  return {
    action: 'downloaded',
    path: target,
    sha256: actualSha,
    bytes: partSize,
    url: usedUrl,
    candidates,
    attempts,
    resumedBytes,
  }
}

/** 单次尝试：Range 续传 + 停滞掐断 + 「服务端不支持 206 就整份重下」。失败**保留 `.part`** 供下次续传。 */
async function downloadOnce({ url, partFile, expectedSize, log, label }) {
  const existing = existsSync(partFile) ? statSync(partFile).size : 0
  const headers = {}
  if (existing > 0) headers.Range = `bytes=${existing}-`

  const controller = new AbortController()
  let stallTimer
  const armStall = () => {
    if (stallTimer !== undefined) clearTimeout(stallTimer)
    stallTimer = setTimeout(() => controller.abort(new Error(`超过 ${STALL_MS}ms 没有任何字节（停滞）`)), STALL_MS)
  }
  const disarmStall = () => {
    if (stallTimer !== undefined) clearTimeout(stallTimer)
  }

  let response
  try {
    armStall()
    response = await fetch(url, { headers, redirect: 'follow', signal: controller.signal })
  } catch (error) {
    disarmStall()
    throw new Error(`请求失败：${error?.name === 'AbortError' ? '停滞超时' : error?.message ?? String(error)}`)
  }

  // 416：Range 起点已经超过文件长度。若「已下满 expectedSize」就是已完成（多半是上次刚好下完但没来得及改名）。
  if (response.status === 416) {
    disarmStall()
    if (existing > 0 && expectedSize !== undefined && existing === expectedSize) {
      return { httpStatus: 416, bytes: existing, resumed: existing }
    }
    // 否则这份 .part 是坏的：删掉，让下一次尝试从零开始。
    removeArtifact(partFile)
    throw new Error(`HTTP 416（Range 不可满足），已丢弃残留的 .part 重来`)
  }
  if (response.status !== 200 && response.status !== 206) {
    disarmStall()
    throw new Error(`HTTP ${response.status} ${response.statusText ?? ''}`.trim())
  }

  const append = response.status === 206
  if (existing > 0) {
    log(`[setup] ${label}：${append ? `服务端支持续传，从 ${humanBytes(existing)} 继续` : '服务端不支持 Range（没有 206），整份重下'}`)
  }

  let written = 0
  let lastProgressLog = 0
  const started = Date.now()
  const tap = new Transform({
    transform(chunk, _encoding, callback) {
      written += chunk.length
      armStall()
      const now = Date.now()
      if (now - lastProgressLog >= 1000) {
        lastProgressLog = now
        const contentLength = numberOrNull(response.headers.get('content-length'))
        const fromHeader = contentLength === null ? null : existing + contentLength
        logProgress(`${label} 下载`, { bytes: existing + written, total: expectedSize ?? fromHeader, elapsedMs: now - started }, log)
      }
      callback(null, chunk)
    },
  })

  const sink = createWriteStream(partFile, { flags: append ? 'a' : 'w' })
  try {
    await pipeline(Readable.fromWeb(response.body), tap, sink)
  } catch (error) {
    // 断连/停滞：**保留** .part（下次从这里续），把错误交回重试循环。
    throw new Error(`传输中断：${error?.name === 'AbortError' ? '停滞超时' : error?.message ?? String(error)}`)
  } finally {
    disarmStall()
  }

  const size = statSync(partFile).size
  if (expectedSize !== undefined && size !== expectedSize) {
    throw new Error(`传输提前结束：${humanBytes(size)} / ${humanBytes(expectedSize)}（.part 保留，下次续传）`)
  }
  return { httpStatus: response.status, bytes: size, resumed: append ? existing : 0 }
}

/** content-length 可能是 null；`Number(null)` 是 0（会把总分母算错），所以显式挡一层。 */
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** 进度行：只在 stderr（`--json` 时 stdout 必须干净），且带速度，方便人判断「是慢还是死」。 */
function logProgress(label, { bytes, total, elapsedMs }, log) {
  const speed = elapsedMs > 0 ? bytes / (elapsedMs / 1000) : 0
  const percent = total ? ` ${((bytes / total) * 100).toFixed(1)}%` : ''
  log(`[setup] ${label}：${humanBytes(bytes)}${total ? ` / ${humanBytes(total)}` : ''}${percent}  ${humanBytes(speed)}/s`)
}

const sleep = (ms) => new Promise((done) => { setTimeout(done, ms) })
