/**
 * P1 · **四态 parity**：宿主侧 `checkHorosaEndpoint` ↔ 票 04 `scripts/isolation/horosa-guard.mjs::checkHorosaPort`
 *
 * 抓的真实缺陷/风险：本票刻意存在**两份**四态实现（宿主插件是从 `<profile>/node_modules/xuanshu-host`
 * 加载的分发物，不能 import 仓库 `scripts/`，见 ADR-0008）。两份实现漂移的后果不是「测试红」，而是
 * **生产行为分叉**：宿主的 `start()` 说「复用」，开发期的 `startup.mjs --mode doctor` 说「被别的进程占了」，
 * 于是同一台机器上两条路给出相反结论，用户不知道信谁。所以这条用例的判据不是「各自判得对」，
 * 而是**同一个现场必须逐字给出同一个 verdict**（§5 P1：「verdict 字符串逐字相同」）。
 *
 * 现场一律是**独立进程**的对照组（`fake-mcp-server.mjs`）：`spawnSync`/同步等待会阻塞测试进程的
 * 事件循环，长在测试进程里的 server 在被探的那一刻不会`被调度 —— 那样「有 HTTP 响应」的现场会
 * 退化成一件事（TCP 连得上、HTTP 无响应），horosa-ready 与 occupied-foreign 根本没被验过。
 *
 * 覆盖：契约 §5 P1 明写的三个现场（空闲 / 非 MCP 的 HTTP 服务 / 带 `mcp-session-id` 的假 MCP）
 * **加**两个「判据 2 / 判据 3」的现场（200 + JSON-RPC body；404 的 /mcp）与 probe-failed 那一格
 * （「有人 LISTEN 但零 HTTP 响应」≠ 被占，票 04 §5.1 R5 的行为改变，宿主侧必须同口径）。
 * 零网络：只连 127.0.0.1 + 内核分配的空闲端口。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { checkHorosaEndpoint } from '../../packages/xuanshu-host/lib/horosa/guard.mjs'
import { checkHorosaPort } from '../../scripts/isolation/horosa-guard.mjs'
import { findFreePort, startFakeMcp } from './lib/servers.mjs'

/** 契约 §5 P1 冻死的词表。 */
const VERDICTS = ['free', 'horosa-ready', 'occupied-foreign', 'probe-failed']
/** 两个实现共享的预算（bare-tcp 那一格要花掉它，所以别调大）。 */
const TIMEOUT_MS = 1200

const receivers = []
afterAll(async () => {
  for (const receiver of receivers.splice(0)) await receiver.stop()
})

/** 一个现场 = 一个真实端口 + 一份「期望 verdict」的地面真值（由**现场形状**决定，不是由被测实现决定）。 */
const scenes = {}

beforeAll(async () => {
  scenes.free = { port: await findFreePort(), expect: 'free' }
  for (const [name, mode] of [['foreign', 'foreign-html'], ['ready', 'mcp-session-id'], ['jsonRpc', 'json-rpc'], ['notFound', 'not-found'], ['bareTcp', 'bare-tcp']]) {
    const server = await startFakeMcp({ mode })
    receivers.push(server)
    scenes[name] = { server, port: server.port }
  }
  scenes.foreign.expect = 'occupied-foreign'
  scenes.ready.expect = 'horosa-ready'
  scenes.jsonRpc.expect = 'horosa-ready'
  scenes.notFound.expect = 'occupied-foreign'
  scenes.bareTcp.expect = 'probe-failed'
}, 60_000)

/** 两个实现都探同一个端口，返回两边的原始结果。 */
async function both(port) {
  const mine = await checkHorosaEndpoint({ host: '127.0.0.1', port, path: '/mcp', timeoutMs: TIMEOUT_MS })
  const theirs = await checkHorosaPort({ port, path: '/mcp', timeoutMs: TIMEOUT_MS })
  return { mine, theirs }
}

describe('P1 · 四态 parity（宿主侧 ↔ 票 04 守卫）', () => {
  it('宿主侧导出的是冻结签名，且字段齐（ok/verdict/host/port/url/detail；fail 时有 hint）', async () => {
    const { mine } = await both(scenes.foreign.port)
    expect(typeof checkHorosaEndpoint).toBe('function')
    expect(mine.host).toBe('127.0.0.1')
    expect(mine.port).toBe(scenes.foreign.port)
    expect(mine.url).toBe(`http://127.0.0.1:${scenes.foreign.port}/mcp`)
    expect(typeof mine.detail).toBe('string')
    expect(VERDICTS).toContain(mine.verdict)
    // fail-closed 的两态必须给「怎么办」（§3.1 的 hint；票 04 同一约定）。
    expect(mine.ok).toBe(false)
    expect(typeof mine.hint, 'occupied-foreign 没给处置 hint').toBe('string')
    expect(mine.hint.length).toBeGreaterThan(0)
  })

  for (const [name, label] of [
    ['free', '空闲端口（ECONNREFUSED）'],
    ['foreign', '非 MCP 的 HTTP 服务（200 + text/html）'],
    ['ready', '带 mcp-session-id 的假 MCP'],
    ['jsonRpc', '200 + JSON-RPC body（判据 2）'],
    ['notFound', '/mcp 是 404（路径不对就不算 horosa）'],
    ['bareTcp', '只 accept 不应答（无法判定 ≠ 被占）'],
  ]) {
    it(`${label} → 两边都判 \`${scenes[name]?.expect ?? '?'}\`，且逐字相同`, async () => {
      const scene = scenes[name]
      const { mine, theirs } = await both(scene.port)
      // 先钉「现场的形状」确实是我们以为的那一格（否则 parity 可能只是「两边都判错成一样」）。
      expect(theirs.verdict, `票 04 守卫把现场判成了 ${theirs.verdict}（现场：${JSON.stringify(scene.server?.mode ?? 'free')}）`).toBe(scene.expect)
      expect(mine.verdict, `宿主侧把现场判成了 ${mine.verdict}，与票 04 的 ${theirs.verdict} 不一致`).toBe(theirs.verdict)
      // 词表本身也要逐字落在冻结的四个里（防「第三份词表」）。
      expect(VERDICTS).toContain(mine.verdict)
      // ok 的语义也必须一致：只有 free / horosa-ready 放行（fail-closed）。
      expect(mine.ok).toBe(theirs.ok)
      expect(mine.ok).toBe(scene.expect === 'free' || scene.expect === 'horosa-ready')
    })
  }

  it('四态词表被真的用满（不是「都判成一样」的假绿）', async () => {
    const seen = new Map()
    for (const name of ['free', 'foreign', 'ready', 'bareTcp']) {
      const { mine, theirs } = await both(scenes[name].port)
      expect(mine.verdict).toBe(theirs.verdict)
      seen.set(name, mine.verdict)
    }
    expect([...new Set(seen.values())].sort()).toEqual(['free', 'horosa-ready', 'occupied-foreign', 'probe-failed'])
  })

  it('端口是数字时两边都不抛；非法端口两边都 fail-closed（probe-failed，不是 occupied-foreign）', async () => {
    const { mine, theirs } = await both(70_000)
    expect(mine.verdict).toBe('probe-failed')
    expect(mine.verdict).toBe(theirs.verdict)
    expect(mine.ok).toBe(false)
    expect(typeof mine.hint).toBe('string')
  })

  it('宿主侧不碰别人的进程：探完 foreign 现场后那个 server 还活着（只探不杀）', async () => {
    const { mine } = await both(scenes.foreign.port)
    expect(mine.verdict).toBe('occupied-foreign')
    expect(scenes.foreign.server.alive(), 'occupied-foreign 之后对照组进程没了 —— 谁杀了它？').toBe(true)
  })
})
