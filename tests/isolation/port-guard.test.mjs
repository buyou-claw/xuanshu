/**
 * 隔离验收 · I3 / I4（web 端口门 + horosa 8765 守卫四态）
 *
 * 覆盖的断言面（契约 §5；R5/R14 见 §5.1）：
 *   I3  web 端口门：被占 → 启动器退出码 3 + detail 点名端口；空闲 → 通过（exit 0）
 *   I4  horosa 守卫四态：free / horosa-ready / occupied-foreign / probe-failed 判对，
 *       且**真实端口**上四态都能复现（空闲 / 普通 HTML / MCP 形状 / 只 accept 不应答）
 *   R5  「有人 LISTEN 但 HTTP 不应答」= probe-failed（无法判定），不再是 occupied-foreign
 *   R14 `probe-failed` 时门 `ok:false`，但**启动器退出码仍是 0**（只有 occupied-foreign → 3）
 *
 * 分工（这条边界很重要）：
 *   本文件**造现场**——真起对照组服务端（`lib/fixture-server.mjs`，一律 `listen(0)` 拿 OS 分配的
 *   空闲端口，测完 kill；绝不占固定端口、绝不起真 horosa、绝不联网）；
 *   `scripts/verify-isolation.mjs` **下判断**——四态判据、退出码映射、hint 是否给全都在它里面。
 *   于是「测试绿」与「验收台绿」是同一条代码路径，不存在第二份判据。
 *
 * 对照组为什么必须独立成进程：验收台是 `spawnSync` 跑的（抓输出必须 utf8），而 spawnSync 会阻塞
 * 测试进程的事件循环 —— 对照组若长在测试进程里，探测那一刻它不会被调度，所有「有 HTTP 响应」的
 * 对照组都会退化成一件事（TCP 连得上、HTTP 无响应 → 无法判定），
 * 于是 horosa-ready 那两态根本没被验过，测试却全绿。见 lib/fixture-server.mjs 的注释。
 *
 * `probe-failed` 的两条来源都钉了：**非法端口**（守卫自己的入口分支）与**裸 TCP 不应答**（R5 的
 * 行为改变）。前者无法经 `resolve.mjs` 走到 startup（它会先拒非法端口），所以由验收台直接调守卫；
 * 后者必须经 `--horosa-port` 真跑一遍 startup 才能验到「门 ok:false 而退出码 0」。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { INVALID_PROBE_PORT } from '../../scripts/isolation/defaults.mjs'
import {
  DSH_HOME, PROFILE,
  expectCheckPass, reserveFreePort, runVerifier, startFixture, stopFixtures, withProfileGate,
} from './lib/verifier.mjs'

/** 单条测试里起服务端是异步的：这里统一把 beforeAll 变成「夹具就绪」的等待点。 */
const state = {}

withProfileGate('玄枢隔离验收 · I3/I4（web-port / horosa-guard）', () => {
  beforeAll(async () => {
    state.fixtures = []
    state.foreign = await startFixture('foreign-html')
    state.readyShape = await startFixture('json-rpc')
    state.readySession = await startFixture('mcp-session-id')
    state.ready405 = await startFixture('method-not-allowed')
    state.readyNotMcp = await startFixture('not-found-on-mcp')
    state.bareTcp = await startFixture('bare-tcp')
    state.webOccupied = await startFixture('foreign-html') // 假装 desktop 占着 xuanshu 想用的 web 端口
    state.fixtures.push(state.foreign, state.readyShape, state.readySession, state.ready405, state.readyNotMcp, state.bareTcp, state.webOccupied)
    state.freeHorosaPort = await reserveFreePort()
    state.freeWebPort = await reserveFreePort()
  }, 60_000)

  afterAll(() => {
    stopFixtures(state.fixtures ?? [])
  })

  /** 只跑 horosa-guard 那一条，把对照组端口喂给验收台（默认 8765 不碰，免得撞真端口）。 */
  const runGuard = (port) => runVerifier(['--json', '--only', 'horosa-guard', '--horosa-port', String(port), '--home', DSH_HOME, '--profile', PROFILE])

  const expectVerdict = (result, verdict) => {
    const entry = expectCheckPass(result, 'horosa-guard')
    expect(entry.evidence.verdict, `判定 ${entry.evidence.verdict} ≠ 期望 ${verdict}（${entry.detail}）`).toBe(verdict)
    return entry
  }

  it('I4 空闲端口 → free（且证据是 ECONNREFUSED，不是猜的）', () => {
    const entry = expectVerdict(runGuard(state.freeHorosaPort), 'free')
    expect(entry.evidence.gate.ok).toBe(true)
    expect(entry.evidence.probe.error).toBe('ECONNREFUSED')
  })

  it('I4 普通 HTML 服务端 → occupied-foreign（门 FAIL + hint 非空 + detail 点名端口）', () => {
    const entry = expectVerdict(runGuard(state.foreign.port), 'occupied-foreign')
    expect(entry.evidence.gate.ok).toBe(false)
    expect(String(entry.evidence.gate.detail)).toContain(String(state.foreign.port))
    expect(entry.evidence.gate.hint, 'occupied-foreign 没给处置建议').toBeTruthy()
    // 这一格必须是「真拿到了 HTTP 响应」后的判定，而不是「连上了但没响应」那条兜底分支。
    expect(entry.evidence.probe.status).toBe(200)
    expect(String(entry.evidence.probe.contentType)).toContain('text/html')
  })

  it('I4 200 + JSON-RPC body（application/json）→ horosa-ready（契约判据 2）', () => {
    const entry = expectVerdict(runGuard(state.readyShape.port), 'horosa-ready')
    expect(entry.evidence.gate.ok).toBe(true)
    expect(entry.evidence.probe.status).toBe(200)
  })

  it('I4 响应头带 mcp-session-id → horosa-ready（契约判据 1）', () => {
    const entry = expectVerdict(runGuard(state.readySession.port), 'horosa-ready')
    expect(entry.evidence.gate.ok).toBe(true)
    expect(entry.evidence.probe.mcpSessionId).toBe('fixture-session-1')
  })

  it('I4 405 + allow: POST → horosa-ready（契约判据 3）', () => {
    const entry = expectVerdict(runGuard(state.ready405.port), 'horosa-ready')
    expect(entry.evidence.gate.ok).toBe(true)
    expect(entry.evidence.probe.status).toBe(405)
  })

  it('I4 根路径有 JSON 但 /mcp 是 404 → 仍然 occupied-foreign（路径不对就不算 horosa）', () => {
    const entry = expectVerdict(runGuard(state.readyNotMcp.port), 'occupied-foreign')
    expect(entry.evidence.gate.ok).toBe(false)
    expect(entry.evidence.probe.status).toBe(404)
  })

  it('I4 只 accept 不应答的裸 TCP 服务 → probe-failed（"无法判定" ≠ "确定被占"，R5）', () => {
    const result = runGuard(state.bareTcp.port)
    const entry = expectVerdict(result, 'probe-failed')
    // R5：这一格的真值是「无法判定」—— 判成「确定被占」会在慢应答的 horosa 上制造假红。
    expect(entry.evidence.gate.ok, 'R14：没验成不许显示成绿灯（门的 ok 必须是 false）').toBe(false)
    expect(entry.evidence.gate.hint, 'fail-closed 时必须给排查 hint').toBeTruthy()
    expect(String(entry.evidence.gate.detail)).toMatch(/无法判定/)
    // R14 的另一半：门 ok:false **不改退出码** —— 只有 occupied-foreign 才是隔离失败。
    expect(entry.evidence.startupExitCode, 'probe-failed 不该让启动器 exit 3').toBe(0)
    expect(result.json.report.exitCode).toBe(0)
    expect(result.json.report.checks.horosaGuard.ok, '启动器报告里的 horosaGuard 门 ok 必须是 false').toBe(false)
    // 验收台自己的 check 说的是「判对了没有」：判对 → ok（它不是「端口没问题」的意思）。
    expect(entry.ok).toBe(true)
  })

  it('I4 probe-failed 子例：非法端口必须 fail-closed（ok:false + hint + unknown），且不改退出码', () => {
    // 非法端口走的是**真链路**（`--horosa-port <INVALID_PROBE_PORT>` → 端口解析放行数字、守卫判「没验成」），
    // 所以这里断言的是启动器报告里的 horosaGuard 门，而不是绕开启动器直接调守卫。
    const result = runGuard(INVALID_PROBE_PORT)
    const entry = expectCheckPass(result, 'horosa-guard')
    const sub = entry.evidence.probeFailed
    expect(sub.verdict).toBe('probe-failed')
    expect(sub.ok).toBe(false)
    expect(sub.unknown).toBe(true)
    expect(sub.startupExitCode, 'probe-failed 不是隔离失败：启动器退出码必须是 0').toBe(0)
    expect(result.json.report.exitCode).toBe(0)
    expect(result.json.report.checks.horosaGuard.ok).toBe(false)
    expect(String(sub.detail)).toMatch(/无法判定|没验成|无法探测/)
    expect(String(sub.detail)).toContain(String(INVALID_PROBE_PORT))
    expect(String(sub.hint ?? '')).toBeTruthy()
    // 端口解析只拦**非数字**：越界数字必须原样透传给守卫（否则这一格又变成「无法复现」）。
    expect(result.json.report.instance.horosaPort).toBe(INVALID_PROBE_PORT)
  })

  it('I4 四态口径：验收台认的就是这四个 verdict，且真实端口上四态都能复现', () => {
    const seen = new Set()
    // 四个真实端口：空闲 / 普通 HTML / MCP 形状 / 只 accept 不应答 —— 正好覆盖四态。
    for (const port of [state.freeHorosaPort, state.foreign.port, state.readyShape.port, state.bareTcp.port]) {
      const entry = expectCheckPass(runGuard(port), 'horosa-guard')
      seen.add(entry.evidence.verdict)
      expect(['free', 'horosa-ready', 'occupied-foreign', 'probe-failed']).toContain(entry.evidence.verdict)
    }
    // 四次真实探测必须落在四个**不同**的态上（否则上面的断言可能只是「都判成了一样」）。
    expect([...seen].sort()).toEqual(['free', 'horosa-ready', 'occupied-foreign', 'probe-failed'])
  })

  it('I3 web 端口被对照组占住 → 启动器 exit 3、detail 点名端口、hint 给换端口办法', () => {
    const result = runVerifier(['--json', '--only', 'web-port', '--web-port', String(state.webOccupied.port), '--home', DSH_HOME, '--profile', PROFILE])
    const entry = expectCheckPass(result, 'web-port')
    expect(entry.evidence.primary.busy, 'isPortBusy 没认出我们占着的端口').toBe(true)
    expect(entry.evidence.primary.port).toBe(state.webOccupied.port)
    expect(entry.evidence.primary.exitCode, 'web 端口被占必须让启动器 exit 3（隔离门）').toBe(3)
    expect(result.json.report.exitCode).toBe(3)
    expect(String(entry.evidence.primary.detail)).toContain(String(state.webOccupied.port))
    expect(String(entry.evidence.primary.detail)).toMatch(/已被占用/)
  })

  it('I3 web 端口空闲 → busy=false 且启动器 exit 0（两个端口都用刚释放的空闲端口，不碰固定端口）', () => {
    const result = runVerifier(['--json', '--only', 'web-port', '--web-port', String(state.freeWebPort), '--horosa-port', String(state.freeHorosaPort), '--home', DSH_HOME, '--profile', PROFILE])
    const entry = expectCheckPass(result, 'web-port')
    expect(entry.evidence.primary.busy).toBe(false)
    expect(entry.evidence.primary.port).toBe(state.freeWebPort)
    expect(entry.evidence.primary.exitCode).toBe(0)
    expect(entry.evidence.primary.detail).toContain(String(state.freeWebPort))
  })

  it('I3 验收台自带的三个对照组（被占 / 空闲 / 撞 desktop 19387）都判对', () => {
    const result = runVerifier(['--json', '--only', 'web-port', '--web-port', String(state.webOccupied.port), '--home', DSH_HOME, '--profile', PROFILE])
    const entry = expectCheckPass(result, 'web-port')
    const cases = entry.evidence.cases
    expect(cases.map((row) => row.name)).toEqual(['occupied-by-control-server', 'free-port', 'desktop-port-19387'])
    for (const row of cases) {
      expect(row.ok, `对照组 ${row.name} 判错：期望的 ok/exit 组合没对上（实际 ok=${row.verdictOk} exit=${row.exitCode}）`).toBe(true)
    }
    // 桌面端口那一格：撞上 19387 必须让门 FAIL 且退出码 3（这就是 I7 的端口侧证据）。
    const desktop = cases.find((row) => row.name === 'desktop-port-19387')
    expect(desktop.port).toBe(19387)
    expect(desktop.verdictOk).toBe(false)
    expect(desktop.exitCode).toBe(3)
  })

  it('CLI 表面：非数字 --horosa-port 直接用法失败（越界数字则交给守卫判，见上一条）', () => {
    const result = runVerifier(['--json', '--horosa-port', 'abc'])
    expect(result.status, result.raw()).toBe(1)
    expect(result.stderr).toContain('--horosa-port')
    // `--web-port` 是要拿去 bind 的，越界值属于用法错，不该被透传（同一个越界原语，两种命运）。
    const webOutOfRange = runVerifier(['--json', '--web-port', String(INVALID_PROBE_PORT)])
    expect(webOutOfRange.status, webOutOfRange.raw()).toBe(1)
    expect(webOutOfRange.stderr).toContain('--web-port')
  })
})
