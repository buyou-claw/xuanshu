/**
 * 票 13 · 消费者与提供者的接缝：`xuanshuHorosa.callTool`
 *
 * `lib/rikke/huangli.mjs` 依赖票 06 服务面上的 `callTool(name, args, options)`（Lead 2026-10-15
 * 采纳建议 A 后加的）。这条接缝横跨两张票的写作用域：**改名/改形状在两边都编译得过**，
 * 症状是「日课永远失败」而没有一行代码变红。所以这里对**真实现**钉三条最便宜的形状：
 *
 *   1. `createHorosaRuntime()` 的返回对象上有 `callTool`，且是函数；
 *   2. 空工具名 → `{ ok:false, code:'missing-tool-name' }`（不抛、不去打网络）；
 *   3. `ok` 的语义 = **走到信封**（不是业务成功）—— 这一条由 `baziBirth` 那侧的既有测试守着。
 *
 * 不联网：这两条都在连 MCP 之前就返回。
 */
import { describe, expect, it } from 'vitest'

import { createHorosaRuntime } from '../../packages/xuanshu-host/lib/horosa/service.mjs'

/** 一个不起任何进程的运行时（plan 指向不存在的端口；这里只用「本地形状」那两条）。 */
function runtime() {
  return createHorosaRuntime({
    ctx: {},
    config: { dataDir: 'C:\\nonexistent-xuanshu-riike-seam', autoStart: false },
    log: () => {},
    paths: {
      dshHome: 'C:\\nonexistent-xuanshu-riike-seam',
      dataDir: 'C:\\nonexistent-xuanshu-riike-seam\\horosa',
      runtimeRoot: 'C:\\nonexistent-horosa',
      cacheDir: 'C:\\nonexistent-xuanshu-cache',
      serveLogFile: 'C:\\nonexistent-xuanshu-riike-seam\\serve.log',
      statusFile: 'C:\\nonexistent-xuanshu-riike-seam\\horosa-status.json',
      setupReportFile: 'C:\\nonexistent-xuanshu-riike-seam\\setup-report.json',
    },
    plan: { ok: false, code: 'test-plan', detail: 'seam test', hint: '' },
  })
}

describe('票13 · 接缝：xuanshuHorosa.callTool 在场且形状正确', () => {
  it('服务面上有 callTool 函数（改名会在这里红，而不是在用户面前）', () => {
    const service = runtime()
    expect(typeof service.callTool).toBe('function')
  })

  it('空工具名 → {ok:false, code:"missing-tool-name"}（不抛、不打网络）', async () => {
    const service = runtime()
    const result = await service.callTool('', { date: '2026-10-15' })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('missing-tool-name')
    expect(typeof result.detail).toBe('string')
  })
})
