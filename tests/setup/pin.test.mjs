/**
 * tests/setup/pin.test.mjs — **第 8 条**：`scripts/setup/horosa-pin.json` 自洽（纯单测，零网络）。
 *
 * 判据来源：契约 §3.1（pin 是钉版唯一来源）+ §10 第 8 条（与离线副本逐值比对，不许联网）。
 * 离线副本两份，都是票 05 侦察期落在 `.scratch/assembly-foundation/captures/` 的真实件：
 *   - `horosa-SHA256SUMS.txt`      → release 资产名 ↔ sha256（**逐值比对**）
 *   - `horosa-runtime-manifest.json` → runtime 的平台键 / url / sha256 / size / archive_type + 版本
 *
 * 为什么这值得一条独立用例：pin 是本链上**唯一**的钉版来源。它一旦漂一格，`--recheck` 之外的所有
 * 校验都会「对着自己」通过（哈希不对时会 exit 2，但大小/平台/URL 漂移是静默的）。
 * 另外必须断言 **pin 里不出现 `latest`** —— 契约 §3.1 明令绝不解析 latest。
 *
 * 两条「不写死」的规矩（B4）：版本与大小都**从离线副本派生**，不再出现 `'0.40.1'` / `1_403_270`
 * 这类字面量 —— 它们是 README 自己点名的假红来源：「升级 pin」这件日常操作不该把断言台弄红。
 * 本文件额外直接单测 `scripts/setup/pin.mjs` 的 `runtimeArtifact()`（**纯函数**，契约 §10 的「纯单测」
 * 同类）：本机是 win32-x64，`win32-arm64 → win32-x64` 的回退**造不出来**，只能这样验它的「显式」。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { runtimeArtifact } from '../../scripts/setup/pin.mjs'
import { CAPTURES_DIR, PIN_FILE, RUNTIME_MANIFEST_JSON, SHA256SUMS_TXT } from './lib/paths.mjs'
import { sha256File } from './lib/sha.mjs'

const SHA256_RE = /^[0-9a-f]{64}$/

function parseSha256Sums(text) {
  const sums = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(trimmed)
    if (!match) throw new Error(`SHA256SUMS 行解析失败: ${line}`)
    sums[match[2].trim()] = match[1]
  }
  return sums
}

const pinText = readFileSync(PIN_FILE, 'utf8')
const pin = JSON.parse(pinText)

/**
 * 离线副本**必须在收集期就能缺**：顶层 `readFileSync` 一旦抛，这个文件**整个收集失败** ——
 * 它的用例会从总数里消失（本轮实测：总数 1030 → 1021，而摘要只显示「passed 变少」，不在失败名单里）。
 * 所以读成「缺席就给哨兵 + 门放在下面那条用例上」：红得响，也红在自己的名字上。
 */
const readCapture = (path, parse) => (existsSync(path) ? parse(readFileSync(path, 'utf8')) : undefined)
const sums = readCapture(SHA256SUMS_TXT, parseSha256Sums) ?? {}
const manifest = readCapture(RUNTIME_MANIFEST_JSON, JSON.parse) ?? {}
const fixturesPresent = existsSync(SHA256SUMS_TXT) && existsSync(RUNTIME_MANIFEST_JSON)

// 门：副本缺失时**只有这一条红**，下面那一组整组跳过（不假装验过，也不静默消失）。
it('两份离线证据副本都在（缺了就必须红，不许静默跳过）', () => {
  expect(
    fixturesPresent,
    `离线证据副本缺失：${CAPTURES_DIR}\n（.scratch/ 不入库；按 scripts/setup/horosa-pin.json 的 release URL 取回，见 docs/development-status.md §10）`,
  ).toBe(true)
})

describe.skipIf(!fixturesPresent)('票 05 · pin 自洽（horosa-pin.json ↔ 离线证据副本）—— 副本不在时整组跳过，红留给上面那条', () => {
  it('pin 的 schema / 版本 / 顶层形状正确', () => {
    expect(pin.schema).toBe('xuanshu/horosa-pin@1')
    // B4：版本**从离线副本派生**（runtime manifest 里也写着一个 version），不写死 0.40.1 ——
    // 升级 pin 时这条断言不该红，红了说明离线副本与 pin 已经不是同一份 release。
    expect(pin.version).toBe(manifest.version)
    expect(pin.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(typeof pin.releaseBase).toBe('string')
    expect(pin.wheel).toBeTypeOf('object')
    expect(pin.runtime?.platforms).toBeTypeOf('object')
    expect(Object.keys(pin.runtime.platforms).length).toBeGreaterThan(0)
    expect(pin.evidence).toBeTypeOf('object')
  })

  it('pin 里不出现 "latest" 字样（契约 §3.1：绝不解析 latest）', () => {
    expect(pinText.toLowerCase()).not.toContain('latest')
  })

  it('releaseBase 钉在 v<version> 的 tag 上，且 evidence 指向同一个根', () => {
    const wanted = `https://github.com/Horace-Maxwell/horosa-skill/releases/download/v${pin.version}`
    expect(pin.releaseBase).toBe(wanted)
    expect(pin.evidence.sha256sums).toBe(`${wanted}/SHA256SUMS.txt`)
    expect(pin.evidence.runtimeManifest).toBe(`${wanted}/runtime-manifest.json`)
  })

  it('wheel：名字与 sha256 与 SHA256SUMS 逐值一致（大小没有离线副本可比 → 见下面两条）', () => {
    expect(pin.wheel.name).toBe(`horosa_skill-${pin.version}-py3-none-any.whl`)
    expect(pin.wheel.sha256).toMatch(SHA256_RE)
    expect(sums[pin.wheel.name], `${pin.wheel.name} 不在 SHA256SUMS 里`).toBeDefined()
    expect(pin.wheel.sha256).toBe(sums[pin.wheel.name])
    // B4：`SHA256SUMS.txt` 里只有哈希，wheel 的 size **没有**离线副本可比 —— 所以这里不再写死
    // `1_403_270`（升级 pin 时那是纯假红）。真值由下面「真工件字节级等于 pin」那条兜（本机有缓存时恒跑）。
    expect(Number.isInteger(pin.wheel.size)).toBe(true)
    expect(pin.wheel.size).toBeGreaterThan(0)
  })

  it('runtime：平台键集与 runtime-manifest 相等（不许自己造平台、也不许漏）', () => {
    expect(Object.keys(pin.runtime.platforms).sort()).toEqual(Object.keys(manifest.platforms).sort())
  })

  it('runtime：每个平台的 name / url / sha256 / size / archiveType 与 manifest + SHA256SUMS 三方一致', () => {
    for (const [key, entry] of Object.entries(pin.runtime.platforms)) {
      const real = manifest.platforms[key]
      expect(real, `pin 里的平台 ${key} 在 runtime-manifest 里不存在`).toBeDefined()
      // 名字：manifest 的 url 末段 = pin 的名字 = SHA256SUMS 的键
      expect(entry.name).toBe(basename(real.url))
      expect(entry.name).toBe(`horosa-runtime-${key}-v${pin.version}.${real.archive_type}`)
      expect(entry.sha256).toMatch(SHA256_RE)
      expect(entry.sha256).toBe(real.sha256)
      expect(sums[entry.name], `${entry.name} 不在 SHA256SUMS 里`).toBeDefined()
      expect(entry.sha256).toBe(sums[entry.name])
      expect(entry.size).toBe(real.size)
      expect(entry.archiveType).toBe(real.archive_type)
      // 同一个 release 根下的资产：URL 必须等于 releaseBase/name（镜像只换传输，不换钉版值）
      expect(real.url).toBe(`${pin.releaseBase}/${entry.name}`)
    }
  })

  it('所有 sha256 都是 64 位小写 hex、所有 size 都是正整数（防「写成字符串/0」的静默漂移）', () => {
    const entries = [pin.wheel, ...Object.values(pin.runtime.platforms)]
    for (const entry of entries) {
      expect(entry.sha256).toMatch(SHA256_RE)
      expect(Number.isInteger(entry.size)).toBe(true)
      expect(entry.size).toBeGreaterThan(0)
    }
  })

  // ── 与**真实缓存里的真工件**再对一次（1.4MB 的 wheel，读一次约 10ms）。
  //    719MB 的 runtime 归档是任务书明令禁止在测试里读的，所以只对 wheel；缺件时这条自动不跑。
  const cachedWheel = join(process.env.LOCALAPPDATA ?? '', 'xuanshu', 'cache', pin.wheel.name)
  it.runIf(existsSync(cachedWheel))('真工件（缓存里的 wheel）字节级等于 pin（sha256 + size）', () => {
    expect(statSync(cachedWheel).size).toBe(pin.wheel.size)
    expect(sha256File(cachedWheel)).toBe(pin.wheel.sha256)
  })
})

/**
 * A10：平台选择是**纯函数**，但 `win32-arm64 → win32-x64` 这格在 win32-x64 机器上永远走不到
 * （`process.arch` 不是 arm64），所以直接单测 `runtimeArtifact()` —— 它是契约 §3.1「pin 没有当前平台
 * 就 exit 2」的唯一实现处，回退必须**显式**（把 from/to 一起回传），否则「装的到底是哪份载荷」
 * 只能靠人去读 pin 才发现。
 */
describe('票 05 · A10：平台回退必须显式（from/to 一起回传）', () => {
  it('win32-arm64 命中 pin 里的 win32-x64 → fallback=true 且 platformFallback={from,to}', () => {
    const artifact = runtimeArtifact(pin, { platform: 'win32', arch: 'arm64' })
    expect(artifact.hostPlatform).toBe('win32-arm64')
    expect(artifact.platform).toBe('win32-x64')
    expect(artifact.fallback).toBe(true)
    expect(artifact.platformFallback).toEqual({ from: 'win32-arm64', to: 'win32-x64' })
    // 载荷本身仍然由 pin 决定（回退不改信任：name/sha256/size 都来自 pin 的 win32-x64 条目）
    expect(artifact.sha256).toBe(pin.runtime.platforms['win32-x64'].sha256)
    expect(artifact.size).toBe(pin.runtime.platforms['win32-x64'].size)
  })

  it('平台直接命中时 platformFallback 是 null（键**存在**且为 null，报告里也这样写）', () => {
    for (const [key, entry] of Object.entries(pin.runtime.platforms)) {
      const [platform, arch] = key.split('-')
      const artifact = runtimeArtifact(pin, { platform, arch })
      expect(artifact.fallback).toBe(false)
      expect(artifact.platformFallback).toBe(null)
      expect(artifact.sha256).toBe(entry.sha256)
    }
  })

  it('既没有当前平台、也没有回退 → 抛 exit 2 并列出 pin 支持的平台', () => {
    let thrown
    try {
      runtimeArtifact(pin, { platform: 'linux', arch: 'riscv64' })
    } catch (error) {
      thrown = error
    }
    expect(thrown, '没有当前平台却不失败 —— 那就成了静默换载荷').toBeDefined()
    expect(thrown.code).toBe(2)
    expect(thrown.message).toContain('linux-riscv64')
    for (const key of Object.keys(pin.runtime.platforms)) expect(thrown.message).toContain(key)
  })
})
