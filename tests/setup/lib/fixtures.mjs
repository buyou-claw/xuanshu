/**
 * tests/setup/lib/fixtures.mjs — 小型 fixture 归档 + **测试自己的 pin**。
 *
 * 契约 §3.1 的 pin 是唯一 URL/哈希来源；真实 pin 钉的是 1.4MB 的 wheel 与 719MB 的 runtime。
 * 断言台不可能造出「sha256 恰好等于真实 pin」的字节（那是 hash 原像问题），所以：
 *
 *   - 「真 pin 自洽」由 `pin.test.mjs` 对着离线证据副本（`captures/horosa-SHA256SUMS.txt`）判，不碰网络；
 *   - 「取件/校验/续传/幂等」这些**流程**断言，用 `XUANSHU_SETUP_PIN` 指向**测试自己的 pin**：
 *     schema 形状逐字段照抄 §3.1，只有 `releaseBase` 指向本地计数 server、sha256/size 指向小 fixture。
 *
 * 这样既没有把断言放宽，也没有让测试去下载 719MB，更没有改仓内 pin 文件。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PIN_FILE } from './paths.mjs'
import { sha256Bytes } from './sha.mjs'
import { makeZip } from './zip.mjs'

/** 当前平台键（契约 §3.1 的 `runtime.platforms` 键形态）。 */
export const PLATFORM_KEY = `${process.platform}-${process.arch}`

/**
 * 版本号**从仓内 pin 派生**（不是写死的字面量）。
 *
 * 为什么：C3 断言的「期望版本」由探针直接读 `scripts/setup/horosa-pin.json` 得到（**不认**
 * `XUANSHU_SETUP_PIN`），doctor 的同版本硬门又拿**测试 pin 的 version** 比 —— 两边都对着仓内 pin 的
 * 版本。写死一个 `0.40.1` 会让「升级 pin」这件日常操作莫名其妙地把断言台弄红（假红），
 * 于是有人会去改测试 —— 那正是最不该发生的动作。派生之后，升级 pin 只需要改 `horosa-pin.json`。
 *
 * pin 缺失时退回一个哨兵值，让 `pin.test.mjs` 里的「入口存在」那条去响亮地失败（而不是在这里抛）。
 */
function readPinVersion() {
  try {
    const version = JSON.parse(readFileSync(PIN_FILE, 'utf8'))?.version
    return typeof version === 'string' && version !== '' ? version : '0.0.0-pin-missing'
  } catch {
    return '0.0.0-pin-missing'
  }
}

export const PIN_VERSION = readPinVersion()

const WHEEL_NAME = `horosa_skill-${PIN_VERSION}-py3-none-any.whl`
const RUNTIME_NAME = `horosa-runtime-${PLATFORM_KEY}-v${PIN_VERSION}.zip`

/** 造一堆「看起来像真包、但只有几百字节」的归档字节（真 zip，能被 unzip 打开）。 */
function wheelBytes(salt = 'wheel') {
  return makeZip([
    { name: `horosa_skill-${PIN_VERSION}.dist-info/METADATA`, data: `Metadata-Version: 2.1\nName: horosa-skill\nVersion: ${PIN_VERSION}\n# fixture:${salt}\n` },
    { name: 'horosa_skill/__init__.py', data: `__version__ = "${PIN_VERSION}"  # fixture:${salt}\n` },
  ])
}

function runtimeBytes(salt = 'runtime') {
  return makeZip([
    { name: 'runtime/version.txt', data: `${PIN_VERSION}\n` },
    { name: 'runtime/platform.txt', data: `${PLATFORM_KEY}\n` },
    { name: 'runtime/manifest.json', data: `{"version":"${PIN_VERSION}","platform":"${PLATFORM_KEY}","fixture":"${salt}"}\n` },
  ])
}

/**
 * 在沙箱里落盘 fixture 归档。
 * @returns {{wheel:{name:string,path:string,sha256:string,size:number}, runtime:{name:string,path:string,sha256:string,size:number,archiveType:string}}}
 */
export function writeFixtureArtifacts(sandbox) {
  const dir = join(sandbox.work, 'artifacts')
  mkdirSync(dir, { recursive: true })
  const wheelPath = join(dir, WHEEL_NAME)
  const runtimePath = join(dir, RUNTIME_NAME)
  const wheel = wheelBytes()
  const runtime = runtimeBytes()

  writeFileSync(wheelPath, wheel)
  writeFileSync(runtimePath, runtime)

  return {
    wheel: { name: WHEEL_NAME, path: wheelPath, sha256: sha256Bytes(wheel), size: wheel.length },
    runtime: { name: RUNTIME_NAME, path: runtimePath, sha256: sha256Bytes(runtime), size: runtime.length, archiveType: 'zip' },
  }
}

/** 写一份**内容与 pin 不符**的假归档（第 1 条：SHA256 不匹配即中止）。 */
export function writeMismatchedArtifact(sandbox, { name, tag }) {
  const dir = join(sandbox.work, `mismatch-${tag}`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  const bytes = makeZip([{ name: 'tampered.txt', data: `tampered-${tag}\n` }])
  writeFileSync(path, bytes)
  return { path, sha256: sha256Bytes(bytes), size: bytes.length }
}

/**
 * 写测试 pin（schema 逐字段照 §3.1）。
 * @param {object} opts
 * @param {string} opts.path            写到哪
 * @param {string} opts.releaseBase     下载根（测试里指向本地计数 server）
 * @param {object} opts.wheel           {name, sha256, size}
 * @param {object} [opts.runtime]       {platform, name, sha256, size, archiveType}
 * @param {string[]} [opts.platforms]   只放这些平台键（默认只有当前平台）
 */
export function writeTestPin({ path, releaseBase, wheel, runtime, platforms }) {
  const keys = platforms ?? (runtime ? [runtime.platform] : [PLATFORM_KEY])
  const runtimePlatforms = {}
  for (const key of keys) {
    if (runtime && key === runtime.platform) {
      runtimePlatforms[key] = { name: runtime.name, sha256: runtime.sha256, size: runtime.size, archiveType: runtime.archiveType ?? 'zip' }
    } else {
      runtimePlatforms[key] = { name: `horosa-runtime-${key}-v${PIN_VERSION}.zip`, sha256: 'f'.repeat(64), size: 1024, archiveType: 'zip' }
    }
  }
  const pin = {
    schema: 'xuanshu/horosa-pin@1',
    version: PIN_VERSION,
    releaseBase,
    wheel: { name: wheel.name, sha256: wheel.sha256, size: wheel.size },
    runtime: { platforms: runtimePlatforms },
    evidence: {
      sha256sums: `${releaseBase}/SHA256SUMS.txt`,
      runtimeManifest: `${releaseBase}/runtime-manifest.json`,
    },
  }
  writeFileSync(path, `${JSON.stringify(pin, undefined, 2)}\n`)
  return pin
}
