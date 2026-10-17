/**
 * P6 · **ensure runtime 门**（假 runtime 根 + 假 setup 报告，零网络、零 uvx）
 *
 * 判据出处：契约 §3.2 R2 / §3.1（`readSetupReport` / `resolveHorosaPlan` / `ensureRuntime`）+ §5 P6。
 *
 * 抓的真实缺陷/风险：
 *   ① 「runtime 没装」却照样起 serve：`uvx horosa-skill serve` 会在几十秒后以一句
 *      库里读不懂的错误退出，用户看到的是「工具没反应」而不是「请先跑 setup」。
 *      门必须在**起 serve 之前**判，且 `code` 要机器可读、`hint` 要给得出可执行命令。
 *   ② 版本门看错字段（票 05 的 A3 真缺陷：`manifest_version` 蒙着旧载荷）——
 *      这里把 R2 的顺序钉死：先 `runtime_payload_version`，缺了才回退 `version`；
 *      且「装好了但版本不符」与「根本没装」必须是**两个不同的 code**（处置不同）。
 *   ③ 「没有 setup 报告」时**不许猜 wheel**：版本/工件只有 pin（报告）一个来源，
 *      猜出来的 wheel 路径会让 uvx 报一个与真正病因无关的错（票 05 A9 的同款教训）。
 *   ④ 报告的 `ok:false`（上次 setup 失败）与「报告不存在」也是两回事，但都不能静默通过。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ensureRuntime, readSetupReport, resolveHorosaPlan } from '../../packages/xuanshu-host/lib/horosa/plan.mjs'
import { resolveHorosaPaths } from '../../packages/xuanshu-host/lib/horosa/paths.mjs'
import { FAKE_UVX_MJS } from './lib/paths.mjs'
import { makeSandbox } from './lib/sandbox.mjs'
import { isolateProcessEnv } from './lib/env.mjs'

/** 每个用例一个沙箱，并保证被测实现读不到开发机上真的 `HOROSA_*` / `XUANSHU_*`。 */
function scene(label) {
  const sandbox = makeSandbox(label)
  const restore = isolateProcessEnv()
  const paths = resolveHorosaPaths({ dshHome: sandbox.home, config: {}, env: {} })
  return { sandbox, paths, restore }
}

describe('P6 · ensureRuntime（R2 的门）', () => {
  it('runtime 根里没有 manifest → ok:false + code runtime-not-installed + hint 指向 setup，且不装任何东西', () => {
    const { sandbox, restore } = scene('p6-not-installed')
    try {
      const result = ensureRuntime({ runtimeRoot: sandbox.runtimeRoot, expectedVersion: sandbox.pin.version })
      expect(result.ok).toBe(false)
      expect(result.code).toBe('runtime-not-installed')
      expect(result.expectedVersion).toBe(sandbox.pin.version)
      expect(result.installed).toBe(false)
      expect(String(result.hint), 'R2：提示必须给得出可执行命令').toMatch(/setup/iu)
      // 门只读不写：没装就是没装，不许顺手建 manifest 目录。
      expect(existsSync(join(sandbox.runtimeRoot, 'current')), 'ensureRuntime 没装却建了 current/').toBe(false)
    } finally {
      restore()
    }
  })

  it('manifest 版本 ≠ pin → ok:false + code runtime-version-mismatch（与「没装」是两个 code）', () => {
    const { sandbox, restore } = scene('p6-mismatch')
    try {
      sandbox.writeRuntimeManifest({ version: '0.39.9' })
      const result = ensureRuntime({ runtimeRoot: sandbox.runtimeRoot, expectedVersion: sandbox.pin.version })
      expect(result.ok).toBe(false)
      expect(result.code).toBe('runtime-version-mismatch')
      expect(result.version).toBe('0.39.9')
      expect(result.expectedVersion).toBe(sandbox.pin.version)
      expect(String(result.hint)).toMatch(/setup/iu)
    } finally {
      restore()
    }
  })

  it('version 字段与 pin 一致 → ok:true + installed:true + version', () => {
    const { sandbox, restore } = scene('p6-ok')
    try {
      sandbox.writeRuntimeManifest()
      const result = ensureRuntime({ runtimeRoot: sandbox.runtimeRoot, expectedVersion: sandbox.pin.version })
      expect(result.ok).toBe(true)
      expect(result.installed).toBe(true)
      expect(result.version).toBe(sandbox.pin.version)
      expect(result.expectedVersion).toBe(sandbox.pin.version)
      expect(result.manifestFile).toContain('runtime-manifest.json')
    } finally {
      restore()
    }
  })

  it('R2 的取版本顺序：先 runtime_payload_version；没有它时回退 version（两个都能过门）', () => {
    const { sandbox, restore } = scene('p6-fallback-version')
    try {
      // 只给 version（老清单形状）——门必须认它，否则「只有 version 的机器」永远起不来。
      const manifest = sandbox.writeRuntimeManifest({ key: 'version' })
      expect(manifest.runtime_payload_version).toBeUndefined()
      const result = ensureRuntime({ runtimeRoot: sandbox.runtimeRoot, expectedVersion: sandbox.pin.version })
      expect(result.ok).toBe(true)
      expect(result.version).toBe(sandbox.pin.version)
    } finally {
      restore()
    }
  })

  it('载荷版本 ≠ 预期而 version 恰好相等 → 仍然拒绝（载荷优先，别被旧清单糊过去）', () => {
    const { sandbox, restore } = scene('p6-payload-wins')
    try {
      sandbox.writeRuntimeManifest({ version: sandbox.pin.version, extra: { runtime_payload_version: '0.0.1' } })
      const result = ensureRuntime({ runtimeRoot: sandbox.runtimeRoot, expectedVersion: sandbox.pin.version })
      expect(result.ok).toBe(false)
      expect(result.code).toBe('runtime-version-mismatch')
      expect(result.version).toBe('0.0.1')
    } finally {
      restore()
    }
  })

  it('manifest 是坏 JSON → 拒绝（ok:false + code），不许抛', () => {
    const { sandbox, restore } = scene('p6-broken-manifest')
    try {
      sandbox.writeRuntimeManifest()
      mkdirSync(join(sandbox.runtimeRoot, 'current'), { recursive: true })
      writeFileSync(join(sandbox.runtimeRoot, 'current', 'runtime-manifest.json'), '{ not json')
      expect(() => ensureRuntime({ runtimeRoot: sandbox.runtimeRoot, expectedVersion: sandbox.pin.version })).not.toThrow()
      const result = ensureRuntime({ runtimeRoot: sandbox.runtimeRoot, expectedVersion: sandbox.pin.version })
      expect(result.ok).toBe(false)
      expect(typeof result.code).toBe('string')
    } finally {
      restore()
    }
  })
})

describe('P6 · resolveHorosaPlan（wheel/版本的唯一来源是 setup 报告 + 注入点）', () => {
  it('有报告 → plan.ok，wheel/version 逐字来自报告，host/port 用缺省回环', () => {
    const { sandbox, paths, restore } = scene('p6-plan-ok')
    try {
      const report = sandbox.writeSetupReport()
      const read = readSetupReport({ setupReportFile: sandbox.setupReportFile })
      expect(read.ok).toBe(true)
      expect(read.report.pin.version).toBe(sandbox.pin.version)

      // `report` 这个入参 = **报告对象本身**（不是 readSetupReport 的包装 `{ok, report, detail}`）。
      const plan = resolveHorosaPlan({ paths, config: {}, env: { XUANSHU_UVX_BIN: FAKE_UVX_MJS }, report: read.report })
      expect(plan.ok, JSON.stringify(plan)).toBe(true)
      expect(plan.wheel).toBe(report.pin.wheel.path)
      expect(plan.version).toBe(report.pin.version)
      expect(plan.uvxBin).toBe(FAKE_UVX_MJS)
      expect(plan.host).toBe('127.0.0.1')
      expect(plan.port).toBe(8765)
      expect(plan.source, 'plan 必须能回答「这些值是哪来的」').toBeTruthy()
    } finally {
      restore()
    }
  })

  it('不给 report 入参时自己读盘（<dshHome>/xuanshu/setup-report.json）', () => {
    const { sandbox, paths, restore } = scene('p6-plan-reads-disk')
    try {
      const report = sandbox.writeSetupReport()
      const plan = resolveHorosaPlan({ paths, config: {}, env: { XUANSHU_UVX_BIN: FAKE_UVX_MJS } })
      expect(plan.ok, JSON.stringify(plan)).toBe(true)
      expect(plan.wheel).toBe(report.pin.wheel.path)
      expect(plan.version).toBe(report.pin.version)
    } finally {
      restore()
    }
  })

  it('没有报告、也没有 wheel 注入点 → code setup-report-missing + hint 指向 setup（不猜 wheel）', () => {
    const { sandbox, paths, restore } = scene('p6-plan-no-report')
    try {
      const read = readSetupReport({ setupReportFile: sandbox.setupReportFile })
      expect(read.ok).toBe(false)
      const plan = resolveHorosaPlan({ paths, config: {}, env: { XUANSHU_UVX_BIN: FAKE_UVX_MJS } })
      expect(plan.ok).toBe(false)
      expect(plan.code).toBe('setup-report-missing')
      expect(String(plan.hint)).toMatch(/setup/iu)
      expect(plan.wheel ?? null, '没有报告还敢猜 wheel？').toBe(null)
    } finally {
      restore()
    }
  })

  it('报告坏了（不是 JSON）→ 仍然拒绝，且不抛', () => {
    const { sandbox, paths, restore } = scene('p6-plan-broken-report')
    try {
      mkdirSync(join(sandbox.home, 'xuanshu'), { recursive: true })
      writeFileSync(sandbox.setupReportFile, '{ 这不是 JSON')
      const read = readSetupReport({ setupReportFile: sandbox.setupReportFile })
      expect(read.ok).toBe(false)
      const plan = resolveHorosaPlan({ paths, config: {}, env: {}, report: read.report })
      expect(plan.ok).toBe(false)
      expect(plan.code).toBe('setup-report-missing')
    } finally {
      restore()
    }
  })

  it('报告缺 pin.version（只有 wheel）→ 仍然 setup-report-missing（版本只有 pin 一个来源）', () => {
    const { sandbox, paths, restore } = scene('p6-plan-wheel-without-version')
    try {
      const report = sandbox.writeSetupReport()
      delete report.pin.version
      const plan = resolveHorosaPlan({ paths, config: {}, env: {}, report })
      expect(plan.ok).toBe(false)
      expect(plan.code).toBe('setup-report-missing')
      expect(String(plan.hint)).toMatch(/setup/iu)
    } finally {
      restore()
    }
  })

  it('环境注入点优先于报告：XUANSHU_HOROSA_WHEEL 覆盖 wheel 路径（测试注入口 R10）', () => {
    const { sandbox, paths, restore } = scene('p6-plan-env-wheel')
    try {
      const report = sandbox.writeSetupReport()
      const read = readSetupReport({ setupReportFile: sandbox.setupReportFile })
      const other = join(sandbox.dir('other'), 'other.whl')
      const plan = resolveHorosaPlan({ paths, config: {}, env: { XUANSHU_HOROSA_WHEEL: other, XUANSHU_UVX_BIN: FAKE_UVX_MJS }, report: read.report })
      expect(plan.ok, JSON.stringify(plan)).toBe(true)
      expect(plan.wheel).toBe(other)
      // 版本仍然来自报告（注入点只换工件路径，不换版本口径）。
      expect(plan.version).toBe(sandbox.pin.version)
    } finally {
      restore()
    }
  })

  it('config.port 的**类型**不许丢：数字（YAML 的自然类型）与数字字符串都必须逐值生效', () => {
    const { sandbox, paths, restore } = scene('p6-plan-port-type')
    try {
      const report = sandbox.writeSetupReport()
      // 背景（T3 2026-10-13 抓到、T1 当天修）：plan 层曾用「只认字符串」的 text() 读 cfg.port，
      // 于是 YAML 里 `port: 18765`（数字）被判成「没设」→ 静默回落 8765，而 DSH 那一行的 URL 指 18765
      // → 工具全不见、日志里什么都没有。这条断言就是那次静默失败的回归门。
      for (const given of [18765, '18765']) {
        const plan = resolveHorosaPlan({ paths, config: { port: given, dataDir: sandbox.dataDir, wheel: sandbox.wheel, uvxBin: FAKE_UVX_MJS }, env: {}, report })
        expect(plan.ok, JSON.stringify(plan)).toBe(true)
        expect(plan.port, `config.port=${JSON.stringify(given)}（${typeof given}）被丢掉了`).toBe(18765)
        expect(typeof plan.port).toBe('number')
      }
      // 另一条：非法端口必须显式拒绝（不许静默回落）。
      const bad = resolveHorosaPlan({ paths, config: { port: 70_000, dataDir: sandbox.dataDir, wheel: sandbox.wheel, uvxBin: FAKE_UVX_MJS }, env: {}, report })
      expect(bad.ok).toBe(false)
      expect(bad.code).toBe('invalid-port')
      // config 没给 port 时，env 注入仍然生效。
      const viaEnv = resolveHorosaPlan({ paths, config: { dataDir: sandbox.dataDir, wheel: sandbox.wheel, uvxBin: FAKE_UVX_MJS }, env: { XUANSHU_HOROSA_PORT: '18766' }, report })
      expect(viaEnv.port).toBe(18766)
    } finally {
      restore()
    }
  })

  it('report 入参两种形状都认（原始报告 / readSetupReport 的返回对象）', () => {
    const { sandbox, paths, restore } = scene('p6-plan-report-shapes')
    try {
      const report = sandbox.writeSetupReport()
      const read = readSetupReport({ setupReportFile: sandbox.setupReportFile })
      const raw = resolveHorosaPlan({ paths, config: { dataDir: sandbox.dataDir, wheel: sandbox.wheel, uvxBin: FAKE_UVX_MJS }, env: {}, report })
      const wrapped = resolveHorosaPlan({ paths, config: { dataDir: sandbox.dataDir, wheel: sandbox.wheel, uvxBin: FAKE_UVX_MJS }, env: {}, report: read })
      expect(raw.ok).toBe(true)
      expect(wrapped.ok, JSON.stringify(wrapped)).toBe(true)
      expect(wrapped.version).toBe(raw.version)
      expect(wrapped.wheel).toBe(raw.wheel)
    } finally {
      restore()
    }
  })
})
