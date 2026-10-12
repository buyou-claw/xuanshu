/**
 * tests/setup/pin.test.mjs — **第 8 条**：`scripts/setup/horosa-pin.json` 自洽（纯单测，零网络）。
 *
 * 判据来源：契约 §3.1（pin 是钉版唯一来源）+ §10 第 8 条（与离线副本逐值比对，不许联网）。
 * 离线副本两份，都是票 05 侦察期落在 `.scratch/assembly-foundation/captures/` 的真实件：
 *   - `horosa-SHA256SUMS.txt`      → release 资产名 ↔ sha256（**逐值比对**）
 *   - `horosa-runtime-manifest.json` → runtime 的平台键 / url / sha256 / size / archive_type
 *
 * 为什么这值得一条独立用例：pin 是本链上**唯一**的钉版来源。它一旦漂一格，`--recheck` 之外的所有
 * 校验都会「对着自己」通过（哈希不对时会 exit 2，但大小/平台/URL 漂移是静默的）。
 * 另外必须断言 **pin 里不出现 `latest`** —— 契约 §3.1 明令绝不解析 latest。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CAPTURES_DIR, PIN_FILE, RUNTIME_MANIFEST_JSON, SHA256SUMS_TXT } from './lib/paths.mjs'
import { sha256File } from './lib/sha.mjs'

/** 契约 §0 表里冻结的 wheel 大小（离线 SHA256SUMS 只有哈希，大小出自 release API 的实测记录）。 */
const WHEEL_SIZE = 1_403_270

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
const sums = parseSha256Sums(readFileSync(SHA256SUMS_TXT, 'utf8'))
const manifest = JSON.parse(readFileSync(RUNTIME_MANIFEST_JSON, 'utf8'))

// 只读一次，供多条用例共用；顺带在「离线副本缺失」时报一个能读懂的错误（而不是 ENOENT 堆栈）。
const fixturesPresent = existsSync(SHA256SUMS_TXT) && existsSync(RUNTIME_MANIFEST_JSON)

describe('票 05 · pin 自洽（horosa-pin.json ↔ 离线证据副本）', () => {
  it('两份离线证据副本都在（缺了就必须红，不许静默跳过）', () => {
    expect(fixturesPresent, `离线副本缺失：${CAPTURES_DIR}`).toBe(true)
  })

  it('pin 的 schema / 版本 / 顶层形状正确', () => {
    expect(pin.schema).toBe('xuanshu/horosa-pin@1')
    expect(pin.version).toBe('0.40.1') // ADR-0004 钉死的版本
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

  it('wheel：名字与 sha256 与 SHA256SUMS 逐值一致，大小等于冻结值', () => {
    expect(pin.wheel.name).toBe(`horosa_skill-${pin.version}-py3-none-any.whl`)
    expect(pin.wheel.sha256).toMatch(SHA256_RE)
    expect(sums[pin.wheel.name], `${pin.wheel.name} 不在 SHA256SUMS 里`).toBeDefined()
    expect(pin.wheel.sha256).toBe(sums[pin.wheel.name])
    expect(pin.wheel.size).toBe(WHEEL_SIZE)
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
