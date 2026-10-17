/**
 * P8 · **非回环门**（spec / 契约 §2.3 + §3.2 R6：「非回环不暴露」）
 *
 * 抓的真实缺陷/风险：horosa 的 MCP 端点**没有认证**。把它绑在 `0.0.0.0` 或局域网 IP 上，
 * 等于把「能算你的八字、能读你的 runtime」的接口开放给同网段所有人。所以这条门必须：
 *   ① 配置里写非回环 host → **拒绝启动**（`code:'non-loopback-host'`），且**不 spawn**任何进程；
 *   ② 真的 spawn 时 `--host` 恒为 `127.0.0.1`（即使配置里写了别的回环字面量，也不许把 `::1` 直接透传出去——
 *      透传 `::1` 会让 serve 只绑 IPv6 回环，客户端按 `127.0.0.1` 探活就探不到）；
 *   ③ `loopbackHost()` 只认回环字面量：`0.0.0.0` / 局域网 IP / 域名 一律 null。
 *
 * 断言「不 spawn」的证据是**进程外**的：假 uvx 的调用台账（`XUANSHU_FAKE_UVX_LOG`）零行。
 */
import { describe, expect, it } from 'vitest'

import { loopbackHost } from '../../packages/xuanshu-host/lib/horosa/paths.mjs'
import { startHorosaServe } from '../../packages/xuanshu-host/lib/horosa/serve.mjs'
import { FAKE_UVX_MJS } from './lib/paths.mjs'
import { makeSandbox } from './lib/sandbox.mjs'
import { findFreePort, waitMcpReady } from './lib/servers.mjs'
import { childEnv, isolateProcessEnv } from './lib/env.mjs'

async function attempt(sandbox, { host, port }) {
  return await startHorosaServe({
    wheel: sandbox.wheel,
    uvxBin: FAKE_UVX_MJS,
    runtimeRoot: sandbox.runtimeRoot,
    dataDir: sandbox.dataDir,
    host,
    port,
    logFile: sandbox.serveLog,
    timeoutMs: 8000,
    env: childEnv({ XUANSHU_FAKE_UVX_LOG: sandbox.uvxLog }),
  })
}

describe('P8 · 非回环门（不暴露）', () => {
  it('loopbackHost：只认三个回环字面量，其余一律 null', () => {
    expect(loopbackHost('127.0.0.1')).toBe('127.0.0.1')
    expect(loopbackHost('::1')).toBe('::1')
    expect(loopbackHost('localhost')).toBe('localhost')
    for (const value of ['0.0.0.0', '192.168.1.5', '10.1.2.3', '172.16.0.9', 'example.com', '127.0.0.1.evil.com', '']) {
      expect(loopbackHost(value), `loopbackHost(${JSON.stringify(value)}) 该判非回环`).toBe(null)
    }
  })

  for (const host of ['0.0.0.0', '192.168.1.5', '10.1.2.3', 'example.com']) {
    it(`host=${host} → 拒绝启动（code non-loopback-host），且**没有 spawn 任何进程**`, async () => {
      const sandbox = makeSandbox(`p8-${host.replace(/\W+/g, '-')}`)
      const restore = isolateProcessEnv()
      try {
        const port = await findFreePort()
        const result = await attempt(sandbox, { host, port })
        expect(result.ok).toBe(false)
        expect(result.code).toBe('non-loopback-host')
        expect(result.started ?? false).toBe(false)
        expect(result.pid ?? null).toBe(null)
        // 进程外证据：假 uvx 一次都没被调用（台账文件根本不该出现）。
        expect(sandbox.uvxCalls(), `非回环配置却 spawn 了：${JSON.stringify(sandbox.uvxCalls())}`).toEqual([])
        expect(String(result.detail ?? result.hint ?? '')).toBeTruthy()
      } finally {
        restore()
      }
    }, 30_000)
  }

  it('spawn 时的 --host 恒为 127.0.0.1（配置里写 ::1 也不许把 IPv6 字面量透传出去）', async () => {
    const sandbox = makeSandbox('p8-loopback-ipv6')
    const restore = isolateProcessEnv()
    try {
      const port = await findFreePort()
      const result = await attempt(sandbox, { host: '::1', port })
      expect(result.ok).toBe(true)
      const call = sandbox.uvxCalls().find((entry) => entry.kind === 'serve')
      expect(call, '假 uvx 没被调用').toBeTruthy()
      // 客户端按 127.0.0.1 探活：serve 必须也在 127.0.0.1 上答，否则「起来了但连不上」。
      expect(call.host).toBe('127.0.0.1')
      expect(call.env.HOROSA_SKILL_HOST).toBe('127.0.0.1')
      await waitMcpReady(port, { timeoutMs: 20_000, describe: '::1 配置起的 serve', tail: () => sandbox.uvxLogTail() })
      // 收尾（这条用例起的是真的假 uvx 进程）。
      const { stopHorosaServe } = await import('../../packages/xuanshu-host/lib/horosa/serve.mjs')
      if (result.pid) await stopHorosaServe({ pid: result.pid, timeoutMs: 5000, sync: true })
    } finally {
      restore()
    }
  }, 40_000)
})
