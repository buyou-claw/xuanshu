/**
 * P9b · **§3.3 的服务状态机**：`waitReady` + `baziBirth` 的服务级接缝
 *
 * 为什么单开一条：契约 §3.3 明写「`createHorosaRuntime` 的状态机（C 的测试对象）」，
 * 而 P3/P4 只验了两个**纯函数**。中间的粘合层（`buildBaziPayload` → `mcpCallTool` → `classifyBaziEnvelope`
 * → 落 `status.bazi`）才是真机上出盘走的路：口径对了、接缝错了，用户看到的还是「没四柱」。
 *
 * 怎么做到零真实 uvx：`createHorosaRuntime({ …, plan })` 的 `plan` 是**显式入参**，
 * 把它指到测试自己的假 MCP 服务器（`127.0.0.1` + 内核分配端口）即可 —— 这本身就是契约给的注入口。
 *
 * 抓的真实缺陷/风险：
 *   ① `pillars` 的**对外形状**在两层不同：`classifyBaziEnvelope().pillars` 是对象
 *      `{year,month,day,hour}`，而 `baziBirth().pillars` 是**4 槽数组** `[年,月,日,时]`
 *      （票 05 的 setup 报告与 Lead 的验收脚本按数组判：`Array.isArray(...) && every(Boolean)`）。
 *      形状错了 → 上游报告/客户端读不出来，但类型系统不会拦。
 *   ② **缺 lat/lon 必须在调用之前就被挡住**：这条用一个**关闭的端口**当 plan 来验 ——
 *      如果实现仍然发起了 MCP 调用，结果会是 `mcp-call-failed`（phase:'error'），而不是
 *      `missing-birth-fields`（phase:'invalid'）。这就是「不产出 payload」的进程外证据。
 *   ③ 澄清闸要能**照样落状态**（`status.bazi.lastPhase === 'gate'`，pillars 为 null）：
 *      S3 §2.7 要求拦截期间「不落谱、不点亮命盘卡」，靠的就是这两条机器判据。
 *   ④ MCP 不可达时必须是**可诊断的失败**（`mcp-call-failed` + hint 指到 serve 日志），
 *      而不是一个裸异常或一个空的 ok:true。
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { HOROSA_BAZI_TOOL, HOROSA_STATUS_SCHEMA } from '../../packages/xuanshu-host/lib/horosa/constants.mjs'
import { resolveHorosaPaths } from '../../packages/xuanshu-host/lib/horosa/paths.mjs'
import { createHorosaRuntime } from '../../packages/xuanshu-host/lib/horosa/service.mjs'
import { makeSandbox } from './lib/sandbox.mjs'
import { findFreePort, startFakeMcp } from './lib/servers.mjs'
import { isolateProcessEnv } from './lib/env.mjs'

/** 固定合成生日（与票 05 的 fixture 同一份，非真人）。 */
const BIRTH = { date: '1990-01-01', time: '12:00', zone: '+08:00', lat: '31n14', lon: '121e29' }
const EXPECTED_PILLARS = ['己巳', '丙子', '丙寅', '甲午']

/** 起一个服务，plan 指向给定的假 MCP 端点（port = 0 的服务器由调用方给）。 */
function makeService(sandbox, port) {
  const config = { dataDir: sandbox.dataDir, runtimeRoot: sandbox.runtimeRoot, wheel: sandbox.wheel, autoStart: false }
  const paths = resolveHorosaPaths({ dshHome: sandbox.home, config, env: {} })
  const plan = {
    ok: true, code: null, wheel: sandbox.wheel, version: sandbox.pin.version, uvxBin: 'uvx',
    host: '127.0.0.1', port, runtimeRoot: sandbox.runtimeRoot, dataDir: sandbox.dataDir,
    source: 'test-plan', detail: `test plan → 127.0.0.1:${port}`, hint: '',
  }
  return createHorosaRuntime({ ctx: {}, config, log: () => {}, paths, plan })
}

describe('P9b · §3.3 服务状态机（waitReady + baziBirth，零真实 uvx）', () => {
  it('waitReady：假 MCP 在答 → ok:true（判据 = MCP 握手，不是「TCP 连得上」）', async () => {
    const sandbox = makeSandbox('p9b-waitready')
    const restore = isolateProcessEnv()
    const server = await startFakeMcp({ mode: 'mcp' })
    try {
      const service = makeService(sandbox, server.port)
      const ready = await service.waitReady(6000)
      expect(ready.ok, `waitReady 失败：${JSON.stringify(ready)}`).toBe(true)
    } finally {
      await server.stop()
      restore()
    }
  }, 30_000)

  it('waitReady：端口空着 → ok:false（不许把「起得来」当成「答得出」）', async () => {
    const sandbox = makeSandbox('p9b-waitready-fail')
    const restore = isolateProcessEnv()
    try {
      const port = await findFreePort()
      const service = makeService(sandbox, port)
      const ready = await service.waitReady(2500)
      expect(ready.ok).toBe(false)
      expect(typeof ready.detail).toBe('string')
    } finally {
      restore()
    }
  }, 30_000)

  it('baziBirth（真信封）：phase ok + **pillars 是 4 槽数组** + fourColumns 对象 + timeAlg 0 + 落 status.bazi', async () => {
    const sandbox = makeSandbox('p9b-bazi-ok')
    const restore = isolateProcessEnv()
    const server = await startFakeMcp({ mode: 'mcp' })
    try {
      const service = makeService(sandbox, server.port)
      const result = await service.baziBirth(BIRTH)
      expect(result.phase, JSON.stringify(result).slice(0, 500)).toBe('ok')
      expect(result.ok).toBe(true)
      // ① 对外形状：4 槽数组（票 05 报告 + Lead 验收脚本按这个判）。
      expect(Array.isArray(result.pillars), `pillars 该是数组，实际是 ${typeof result.pillars}`).toBe(true)
      expect(result.pillars).toEqual(EXPECTED_PILLARS)
      expect(result.pillars.every(Boolean)).toBe(true)
      // 同时给出对象形状（四个 ganzi 的对外槽位名叫 hour，真机字段叫 fourColumns.time）。
      expect(result.fourColumns).toEqual({ year: '己巳', month: '丙子', day: '丙寅', hour: '甲午' })
      expect(result.timeAlg).toBe(0)
      expect(result.tool).toBe('bazi_birth')
      expect(result.techniqueCard?.settings?.timeAlg?.value).toBe(0)

      // 状态文件：R7 的 bazi 块（界面「命盘卡点亮」读的就是它）。
      const status = sandbox.status()
      expect(status.schema).toBe(HOROSA_STATUS_SCHEMA)
      expect(status.bazi?.lastPhase).toBe('ok')
      expect(status.bazi?.pillars).toEqual(EXPECTED_PILLARS)
      expect(status.bazi?.lastTool).toBe('bazi_birth')
      expect(status.bazi?.lastVersion).toBe(sandbox.pin.version)
    } finally {
      await server.stop()
      restore()
    }
  }, 60_000)

  it('baziBirth(timeAlg=1)：口径透传到信封，timeAlg 读出来是 1（不是 0）', async () => {
    const sandbox = makeSandbox('p9b-bazi-clock')
    const restore = isolateProcessEnv()
    const server = await startFakeMcp({ mode: 'mcp' })
    try {
      const service = makeService(sandbox, server.port)
      const result = await service.baziBirth({ ...BIRTH, timeAlg: 1 })
      expect(result.phase).toBe('ok')
      expect(result.timeAlg).toBe(1)
      expect(sandbox.status().bazi?.pillars).toEqual(EXPECTED_PILLARS)
    } finally {
      await server.stop()
      restore()
    }
  }, 60_000)

  it('baziBirth + 澄清闸：phase gate + 4 条追问 + promptToUser 原文；status.bazi 记 gate 且 pillars 为 null', async () => {
    const sandbox = makeSandbox('p9b-bazi-gate')
    const restore = isolateProcessEnv()
    const server = await startFakeMcp({ mode: 'mcp' })
    try {
      const service = makeService(sandbox, server.port)
      // agentConfirmed:false = 用户还没在确认闸上按过「确认并出盘」。
      const result = await service.baziBirth({ ...BIRTH, agentConfirmed: false })
      expect(result.phase).toBe('gate')
      expect(result.ok).toBe(false)
      expect(result.code).toBe('agent_guidance.required')
      expect(result.questions).toHaveLength(4)
      expect(typeof result.promptToUser).toBe('string')
      expect(result.promptToUser.length).toBeGreaterThan(40)
      expect(result.pillars).toBe(null)
      // S3 §2.7：拦截期间不落谱、不点亮命盘卡 —— status 也必须说「这盘没出成」。
      const status = sandbox.status()
      expect(status.bazi?.lastPhase).toBe('gate')
      expect(status.bazi?.pillars).toBe(null)
    } finally {
      await server.stop()
      restore()
    }
  }, 60_000)

  it('缺 lat/lon：phase invalid + missing-birth-fields，且**根本没发起 MCP 调用**（plan 指向关闭端口也照样 invalid）', async () => {
    const sandbox = makeSandbox('p9b-bazi-missing')
    const restore = isolateProcessEnv()
    try {
      // plan 指向一个**没有监听**的端口：一旦实现先建 payload 再调用，结果就会变成 mcp-call-failed。
      const port = await findFreePort()
      const service = makeService(sandbox, port)
      const result = await service.baziBirth({ date: '1990-01-01', time: '12:00', zone: '+08:00' })
      expect(result.phase, `缺经纬度还是去调了 MCP：${JSON.stringify(result).slice(0, 300)}`).toBe('invalid')
      expect(result.code).toBe('missing-birth-fields')
      expect(result.missing ?? []).toEqual(expect.arrayContaining(['lat', 'lon']))
      expect(result.pillars).toBe(null)
      expect(sandbox.status().bazi?.lastPhase).toBe('invalid')
    } finally {
      restore()
    }
  }, 60_000)

  it('MCP 不可达：phase error + code mcp-call-failed + hint 指向 serve 日志（可诊断，不是裸异常）', async () => {
    const sandbox = makeSandbox('p9b-bazi-unreachable')
    const restore = isolateProcessEnv()
    try {
      const port = await findFreePort()
      const service = makeService(sandbox, port)
      const result = await service.baziBirth(BIRTH)
      expect(result.phase).toBe('error')
      expect(result.ok).toBe(false)
      expect(result.code).toBe('mcp-call-failed')
      expect(String(result.hint ?? '')).toMatch(/serve\.log|status/u)
      expect(result.pillars).toBe(null)
      // 失败也要落状态（R7：每次状态变化都重写）——界面据此给「出盘失败」而不是永远转圈。
      expect(existsSync(sandbox.statusFile)).toBe(true)
      expect(sandbox.status().bazi?.lastPhase).toBe('error')
      // 工具名是冻结常量（客户端按 mcp__horosa__<tool> 找）。
      expect(result.tool).toBe(HOROSA_BAZI_TOOL)
    } finally {
      restore()
    }
  }, 60_000)
})
