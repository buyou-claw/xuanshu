/**
 * tests/setup/selfcheck-branches.test.mjs — C2 的两条**分流**（A1 / A2）。
 *
 * 这两条用例的共同前提是「8765 上**已经**有一个 listener」，所以端口上那份假 horosa serve 由
 * **测试自己**起（`startFakeHorosa`），不由被测实现托管 —— 否则「被测实现有没有偷偷 spawn 一个」
 * 这件事就测不到了，而它正是这两条 A 项各自的硬规矩之一。
 *
 *   A1（`probe-failed` 的复探）：契约 §5 的新口径是「用加长预算复探一次；拿到 mcpReady 就按复用通过；
 *      仍不成 → fail-closed（exit 5），**不 spawn**」。用例造的是「慢一次应答的 horosa」：
 *      头一次 GET 拖过守卫的预算 → 守卫判 `probe-failed`（有人 LISTEN 但零 HTTP 响应），
 *      复探（预算更长）时它已经答得出来了 → horosa-ready → 复用 → exit 0。
 *      `report.serve.started === false` 就是「没有起第二个进程」这条断言。
 *
 *   A2（判据必须含 `mcp-session-id`）：契约 §5 的 C2 判据是 `initialize` **200 且带响应头
 *      `mcp-session-id`** + `tools/list` 非空。用例造一份「别的都正常、就是不回 session 头」的假
 *      server：修 A2 之前 `mcpToolsList().ok` 不看它 → C2 假绿 → exit 0；现在必须 C2 false → exit 5，
 *      而且**不是** exit 3（那不是 `occupied-foreign`：守卫确实认出了 MCP 形态的应答）。
 *
 *   A7（信封抽取顺序）：契约 §9 冻结「`result.content[].text` 优先、`structuredContent` 仅兼容」。
 *      用例让假 server **同时**回两处，其中 `structuredContent` 是一份**错的**信封 —— 顺序反了 C3 必红。
 *
 * 零网络（只碰 127.0.0.1 的回环端口）、零真实安装（`--verify-only` 不取件不安装）。
 */
import { describe, expect, it } from 'vitest'

import { PIN_VERSION } from './lib/fixtures.mjs'
import { STUB_VERIFY_ASSEMBLY } from './lib/paths.mjs'
import { makeSandbox } from './lib/sandbox.mjs'
import { findFreePort, readReport, runSetup, startFakeHorosa } from './lib/setup-run.mjs'

/** `--verify-only` 的公共参数：只跑自检，不取件不安装（pin 段只反映缓存现状）。 */
function verifyArgs(sandbox, port, timeoutMs) {
  return [
    '--verify-only',
    '--cache', sandbox.cache,
    '--dsh-home', sandbox.home,
    '--runtime-root', sandbox.runtimeRoot,
    '--horosa-port', String(port),
    '--selfcheck-timeout', String(timeoutMs),
    '--json',
  ]
}

/** 公共环境：C1 必须换替身（真实现要起 DSH CLI，分钟级），其余走真实实现。 */
function verifyEnv(extra = {}) {
  return { XUANSHU_VERIFY_ASSEMBLY_BIN: STUB_VERIFY_ASSEMBLY, ...extra }
}

describe('票 05 · A1：守卫判 probe-failed（无法判定）→ 加长预算复探一次', () => {
  it('慢一次应答的 horosa：复探后按「复用」通过（exit 0），且没有起第二个进程', async () => {
    const sandbox = makeSandbox('c2-probe-failed')
    const port = await findFreePort()
    // 3000ms > 初始守卫的探测预算（checkHorosaHealth 只把总预算的 25%（≤5s）给端口探针）
    // 而 < 复探时的预算 → 「第一次探不出、第二次答得出」正是 probe-failed 这一格的成因。
    const horosa = await startFakeHorosa({
      state: sandbox.state,
      port,
      env: { XUANSHU_FAKE_UVX_GET_DELAY_MS: '3000', XUANSHU_FAKE_UVX_GET_DELAY_TIMES: '1' },
    })
    try {
      const result = runSetup(verifyArgs(sandbox, port, 30_000), { env: verifyEnv(), timeoutMs: 120_000 })
      expect(result.status, result.raw()).toBe(0)

      const { report } = readReport(sandbox.home)
      expect(report, '没写报告').toBeDefined()
      const [, c2, c3] = report.checks
      expect(c2.ok, `C2 没通过：${c2.detail}`).toBe(true)
      // 「复用」而不是「自起」：这两条断言合起来就是 A1 的「不 spawn」。
      expect(c2.evidence.reused, 'C2 不是复用（那就说明它自己起了一份）').toBe(true)
      expect(report.serve.started, 'A1 明令：probe-failed 这一格不许 spawn').toBe(false)
      expect(report.serve.pid).toBe(null)
      // C2 过了，C3 也应当能跑（同一份假 server 答得出来）
      expect(c3.ok, `C3 没通过：${c3.detail}`).toBe(true)
    } finally {
      await horosa.stop()
    }
  }, 150_000)
})

describe('票 05 · A2：C2 判据含「initialize 200 且带 mcp-session-id」', () => {
  it('不回 mcp-session-id 的假 server → C2 false、exit 5（不是 exit 3，也不是假绿）', async () => {
    const sandbox = makeSandbox('c2-no-session')
    const port = await findFreePort()
    const horosa = await startFakeHorosa({
      state: sandbox.state,
      port,
      env: { XUANSHU_FAKE_UVX_NO_SESSION: '1' },
    })
    try {
      const result = runSetup(verifyArgs(sandbox, port, 20_000), { env: verifyEnv(), timeoutMs: 120_000 })
      // 关键：修 A2 之前这里会是 0（`mcpToolsList().ok` 不看 sessionId → C2 假绿）。
      expect(result.status, result.raw()).toBe(5)
      expect(result.json, `--json 下 stdout 不是报告 JSON：\n${result.raw()}`).toBeDefined()

      const { report } = readReport(sandbox.home)
      const ids = report.checks.map((check) => check.id)
      expect(ids).toEqual(['assembly', 'horosa8765', 'bazi'])
      const [, c2, c3] = report.checks
      expect(c2.ok).toBe(false)
      expect(c2.detail, `C2 的 detail 没说清缺的是什么：${c2.detail}`).toMatch(/mcp-session-id/)
      expect(report.exitCode).toBe(5)
      expect(report.ok).toBe(false)
      // C2 没过 → C3 记一条「先修 C2」（checks 仍恰好三条、顺序固定）
      expect(c3.ok).toBe(false)
    } finally {
      await horosa.stop()
    }
  }, 150_000)
})

describe('票 05 · A7：信封抽取顺序 = result.content[].text 优先', () => {
  it('两处都有信封时，读的是 content[0].text（structuredContent 只作兼容）', async () => {
    const sandbox = makeSandbox('c3-both-envelopes')
    const port = await findFreePort()
    const horosa = await startFakeHorosa({
      state: sandbox.state,
      port,
      env: { XUANSHU_FAKE_UVX_BOTH_ENVELOPES: '1' },
    })
    try {
      const result = runSetup(verifyArgs(sandbox, port, 30_000), { env: verifyEnv(), timeoutMs: 120_000 })
      // structuredContent 那份是**错的**信封（ok:false + 别的版本）：抽取顺序反了这里就是 5。
      expect(result.status, result.raw()).toBe(0)
      const { report } = readReport(sandbox.home)
      const bazi = report.checks.find((check) => check.id === 'bazi')
      expect(bazi.ok, `C3 没通过：${bazi.detail}`).toBe(true)
      expect(bazi.evidence.callEnvelopeFrom, '信封不是从 content[].text 取的').toBe('content.text')
      expect(bazi.evidence.version, '读到的信封版本不是 content[].text 里那份').toBe(PIN_VERSION)
    } finally {
      await horosa.stop()
    }
  }, 150_000)
})
