/**
 * P0 · **替身自检**：先证明 fixture 自己是对的，再去信 P1–P9 的红绿。
 *
 * 为什么单独一个文件（照票 05 `tests/setup/fixtures.test.mjs`）：端到端红了的时候，第一件事是
 * 回答「是实现的锅还是 fixture 的锅」。这个文件把每个替身对着**它声称回放的真形状**过一遍：
 *   · 假 MCP 服务器真的在答 MCP（120 条工具、`mcp-session-id`、信封在 `content[0].text`）；
 *   · 五种模式的形状各自正确（否则 P1 的四态 parity 会拿错现场去比）；
 *   · 假 uvx 真的能被 `--from <wheel> horosa-skill serve` 起起来、真的记账、真的拒绝 8765；
 *   · 信封 fixture 与**真实捕获**逐字段路径一致（捕获不在的机器上自动跳过，见 PROVENANCE.md）；
 *   · 假的 setup 报告 / runtime 清单填完占位符后是合法 JSON 且路径指向沙箱里的真文件。
 *
 * 这个文件红了 → **别改被测代码**，先修 fixture。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CAPTURES_DIR, ENVELOPES_DIR, FAKE_UVX_CMD, FAKE_UVX_MJS, HOST_LIB, PROFILE_HOST_LIB } from './lib/paths.mjs'
import { makeSandbox, readJson, waitFor } from './lib/sandbox.mjs'
import { childEnv } from './lib/env.mjs'
import { findFreePort, httpRequest, probeMcpInitialize, startFakeMcp, waitMcpReady } from './lib/servers.mjs'

const ENVELOPE_NAMES = ['bazi-ok-default', 'bazi-ok-clock', 'bazi-ok-meansolar', 'bazi-gate', 'bazi-error', 'bazi-ok-default-no-settings-timealg']

/** 捕获目录在不在（`.scratch/` 不入库）：不在就跳过「对回捕获」那一组，不假装验过。 */
const HAS_CAPTURES = existsSync(CAPTURES_DIR)
const HAS_PROFILE_COPY = existsSync(PROFILE_HOST_LIB)

const receivers = []
afterAll(async () => {
  for (const receiver of receivers.splice(0)) await receiver.stop()
})

describe('P0 · 替身自检（fixture 自己是对的）', () => {
  describe('信封 fixture', () => {
    it('六个 fixture 都在、都是合法 JSON，且顶层键逐条对得上（含四个 null 键）', () => {
      for (const name of ENVELOPE_NAMES) {
        const envelope = readJson(join(ENVELOPES_DIR, `${name}.json`))
        expect(typeof envelope, name).toBe('object')
        for (const key of ['ok', 'tool', 'version', 'data', 'summary', 'warnings', 'error']) {
          expect(Object.prototype.hasOwnProperty.call(envelope, key), `${name} 缺顶层键 ${key}`).toBe(true)
        }
        expect(envelope.version, name).toBe('0.40.1')
      }
    })

    it('三档 timeAlg 的 fixture 唯一变量就是 timeAlg（四柱相同、口径行不同）', () => {
      const [def, clock, mean] = ['bazi-ok-default', 'bazi-ok-clock', 'bazi-ok-meansolar'].map((name) => readJson(join(ENVELOPES_DIR, `${name}.json`)))
      expect(def.data.technique_card.settings.timeAlg.value).toBe(0)
      expect(clock.data.technique_card.settings.timeAlg.value).toBe(1)
      expect(mean.data.technique_card.settings.timeAlg.value).toBe(3)
      const pillars = (envelope) => ['year', 'month', 'day', 'time'].map((key) => envelope.data.bazi.fourColumns[key].ganzi).join('')
      expect(pillars(def)).toBe('己巳丙子丙寅甲午')
      expect(pillars(clock)).toBe(pillars(def))
      expect(pillars(mean)).toBe(pillars(def))
      // §0.1 的坑：四柱跨不了时支，判别 timeAlg 只能靠 settings.timeAlg.value 或口径行。
      expect(def.data.snapshot_text).toContain('时间算法：真太阳时')
      expect(clock.data.snapshot_text).toContain('时间算法：直接时间')
      expect(mean.data.snapshot_text).toContain('时间算法：平太阳时(仅经度)')
    })

    it('gate fixture：ok:false + code + 4 条追问 + prompt_to_user 原文 + data 为空（四柱不可读）', () => {
      const gate = readJson(join(ENVELOPES_DIR, 'bazi-gate.json'))
      expect(gate.ok).toBe(false)
      expect(gate.error.code).toBe('agent_guidance.required')
      expect(gate.error.details.ask_if_missing).toHaveLength(4)
      expect(typeof gate.error.details.agent_recovery.prompt_to_user).toBe('string')
      expect(gate.error.details.agent_recovery.prompt_to_user.length).toBeGreaterThan(40)
      expect(gate.error.details.safe_defaults).toHaveLength(6)
      expect(gate.error.details.confirmation_fields).toEqual(['agent_confirmed_settings', 'defaults_accepted', 'clarification_notes'])
      // 真机形状：`data` 与 `input_normalized` 都是 `{}`（不是「成功信封的骨架」）。
      expect(gate.data).toEqual({})
      expect(gate.input_normalized).toEqual({})
      expect(gate.data?.bazi?.fourColumns).toBeUndefined()
    })

    it.skipIf(!HAS_CAPTURES)('逐字段路径对回真实捕获：fixture 不是手写的', () => {
      const cases = [
        ['bazi-ok-default', 'gt06-envelope-default.json', 0],
        ['bazi-ok-clock', 'gt06-envelope-clock.json', 1],
        ['bazi-ok-meansolar', 'gt06-envelope-meansolar.json', 3],
      ]
      for (const [fixture, capture, timeAlg] of cases) {
        const trimmed = readJson(join(ENVELOPES_DIR, `${fixture}.json`))
        const real = readJson(join(CAPTURES_DIR, capture))
        expect(trimmed.input_normalized, `${fixture} 的 input_normalized`).toEqual(real.input_normalized)
        expect(trimmed.data.technique_card, `${fixture} 的 technique_card`).toEqual(real.data.technique_card)
        expect(trimmed.data.snapshot_text, `${fixture} 的 snapshot_text`).toBe(real.data.snapshot_text)
        expect(trimmed.summary).toEqual(real.summary)
        expect(trimmed.warnings).toEqual(real.warnings)
        expect(trimmed.version).toBe(real.version)
        expect(timeAlg).toBe(real.data.technique_card.settings.timeAlg.value)
        // 四柱：真机的**键名**（year/month/day/time）与 ganzi 值都要对上。
        for (const key of ['year', 'month', 'day', 'time']) {
          expect(trimmed.data.bazi.fourColumns[key].ganzi, `${fixture} 的 ${key} 柱`).toBe(real.data.bazi.fourColumns[key].ganzi)
        }
        // 契约 §0.1 曾写 `fourColumns.hour`，真机上**不存在** —— 这条断言就是那处「契约与真机不符」的探针。
        expect(real.data.bazi.fourColumns.hour, '真机 fourColumns 出现了 hour？契约已更新，请重新核对').toBeUndefined()
      }
    })

    it.skipIf(!HAS_CAPTURES)('gate fixture 与 gt06-gate-raw.json 的 SSE 载荷一致（含 4 条追问的原文）', () => {
      const gate = readJson(join(ENVELOPES_DIR, 'bazi-gate.json'))
      const raw = readJson(join(CAPTURES_DIR, 'gt06-gate-raw.json'))
      const line = String(raw.text).split(/\r?\n/).find((entry) => entry.startsWith('data: '))
      const rpc = JSON.parse(line.slice('data: '.length))
      const real = JSON.parse(rpc.result.content[0].text)
      expect(gate.data).toEqual(real.data)
      expect(gate.input_normalized).toEqual(real.input_normalized)
      expect(gate.error).toEqual(real.error)
      expect(gate.error.details.ask_if_missing).toEqual(real.error.details.ask_if_missing)
      expect(gate.error.details.agent_recovery.prompt_to_user).toBe(real.error.details.agent_recovery.prompt_to_user)
    })
  })

  describe('假 MCP 服务器（独立进程）', () => {
    let server
    beforeAll(async () => {
      server = await startFakeMcp({ mode: 'mcp' })
      receivers.push(server)
    }, 30_000)

    it('mcp 模式：GET /mcp 是 405 + allow: POST（真机对 GET 的答复）', async () => {
      const response = await httpRequest(server.url)
      expect(response.status).toBe(405)
      expect(String(response.headers.allow)).toContain('POST')
    })

    it('mcp 模式：initialize → 200 + mcp-session-id（32 hex）+ serverInfo.version = pin 版本', async () => {
      const probe = await probeMcpInitialize(server.url)
      expect(probe.ok).toBe(true)
      expect(probe.status).toBe(200)
      expect(String(probe.sessionId)).toMatch(/^[0-9a-f]{32}$/)
      const payload = JSON.parse(probe.text)
      expect(payload.result.serverInfo).toEqual({ name: 'horosa-skill', version: '0.40.1' })
    })

    it('mcp 模式：notifications/initialized → 202 空体；tools/list → 120 条含 horosa_cn_bazi_birth', async () => {
      const session = await probeMcpInitialize(server.url)
      const headers = { 'content-type': 'application/json', 'mcp-session-id': String(session.sessionId) }
      const notified = await httpRequest(server.url, { method: 'POST', headers, body: { jsonrpc: '2.0', method: 'notifications/initialized' } })
      expect(notified.status).toBe(202)
      expect(notified.text).toBe('')
      const listed = await httpRequest(server.url, { method: 'POST', headers, body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } })
      const tools = JSON.parse(listed.text).result.tools
      expect(tools).toHaveLength(120)
      expect(tools.map((tool) => tool.name)).toContain('horosa_cn_bazi_birth')
    })

    it('mcp 模式：tools/call 的**信封在 content[0].text**，且闸/timeAlg 三档都回对', async () => {
      const session = await probeMcpInitialize(server.url)
      const headers = { 'content-type': 'application/json', 'mcp-session-id': String(session.sessionId) }
      const call = async (args) => {
        const response = await httpRequest(server.url, {
          method: 'POST',
          headers,
          body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'horosa_cn_bazi_birth', arguments: args } },
        })
        const result = JSON.parse(response.text).result
        expect(result.structuredContent, 'fixture 不该用 structuredContent（真机不用它）').toBeUndefined()
        return JSON.parse(result.content[0].text)
      }
      const base = { date: '1990-01-01', time: '12:00', zone: '+08:00', lat: '31n14', lon: '121e29' }
      expect((await call(base)).error.code).toBe('agent_guidance.required')
      expect((await call({ ...base, agent_confirmed_settings: true })).data.technique_card.settings.timeAlg.value).toBe(0)
      expect((await call({ ...base, agent_confirmed_settings: true, timeAlg: 1 })).data.technique_card.settings.timeAlg.value).toBe(1)
      expect((await call({ ...base, agent_confirmed_settings: true, timeAlg: 3 })).data.technique_card.settings.timeAlg.value).toBe(3)
    })

    it('五种模式的形状各自正确（P1 拿它们当现场，形状错了就会比出假 verdict）', async () => {
      const modes = {}
      for (const mode of ['mcp-session-id', 'json-rpc', 'foreign-html', 'not-found', 'bare-tcp']) {
        modes[mode] = await startFakeMcp({ mode })
        receivers.push(modes[mode])
      }
      const session = await httpRequest(modes['mcp-session-id'].url)
      expect(session.status).toBe(200)
      expect(String(session.headers['mcp-session-id'])).not.toBe('')
      expect(String(session.headers['content-type'])).toContain('application/json')

      const json = await httpRequest(modes['json-rpc'].url)
      expect(json.status).toBe(200)
      expect(JSON.parse(json.text)).toHaveProperty('result')

      const html = await httpRequest(modes['foreign-html'].url)
      expect(html.status).toBe(200)
      expect(String(html.headers['content-type'])).toContain('text/html')

      const missing = await httpRequest(modes['not-found'].url)
      expect(missing.status).toBe(404)

      // bare-tcp：连得上、但预算内一个响应都没有（守卫必须判 probe-failed，不许判 occupied-foreign）。
      await expect(probeMcpInitialize(modes['bare-tcp'].url, { timeoutMs: 700 })).rejects.toThrow(/超时/)
    }, 30_000)
  })

  describe('假 uvx（P7/P8 的替身可执行文件）', () => {
    it('`--from <wheel> horosa-skill serve --host 127.0.0.1 --port <free>`：起得来、答 MCP、记了账', async () => {
      const sandbox = makeSandbox('p0-fake-uvx')
      const port = await findFreePort()
      const child = spawn(process.execPath, [FAKE_UVX_MJS, '--from', sandbox.wheel, 'horosa-skill', 'serve', '--host', '127.0.0.1', '--port', String(port)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv({ XUANSHU_FAKE_UVX_LOG: sandbox.uvxLog }),
      })
      receivers.push({ stop: async () => { child.kill(); await new Promise((resolve) => setTimeout(resolve, 150)) } })
      // 假 uvx 监听成功后才记账 —— 等这一行出现，等于等 serve 真的起来了。
      const call = await waitFor(() => sandbox.uvxCalls().find((entry) => entry.kind === 'serve'), {
        timeoutMs: 10_000,
        describe: `假 uvx 记账（现有 ${JSON.stringify(sandbox.uvxCalls())}）`,
      })
      expect(call.wheel).toBe(sandbox.wheel)
      expect(call.cmd).toBe('serve')
      expect(call.host).toBe('127.0.0.1')
      expect(call.port).toBe(port)
      // 没设过的契约 env 是 null：断言台不许继承开发机上真的 HOROSA_RUNTIME_ROOT/HOROSA_SKILL_DATA_DIR。
      expect(call.env).toEqual({ HOROSA_RUNTIME_ROOT: null, HOROSA_SKILL_DATA_DIR: null, HOROSA_SKILL_HOST: null, HOROSA_SKILL_PORT: null })
      await waitMcpReady(port, { timeoutMs: 20_000, requireSession: true, describe: 'uvx.mjs 形态的假 uvx', tail: () => sandbox.uvxLogTail() })
    }, 60_000)

    it('`uvx.cmd` 形态存在且能同样起服务（Windows 的第二种路径形态）', async () => {
      expect(existsSync(FAKE_UVX_CMD)).toBe(true)
      const sandbox = makeSandbox('p0-fake-uvx-cmd')
      const port = await findFreePort()
      // `.cmd` 在 Windows 上必须经 cmd.exe 起（Node 直接 spawn .cmd 会 EINVAL；被测实现也要处理这个形态）。
      // 参数逐项交给 cmd.exe（`/d /c <script> <args…>`），不要把整条命令拼成一个字符串：
      // `/s /c "…"` 会吃掉首尾引号，把路径里的引号配平弄坏（这一条踩过）。
      const child = spawn('cmd.exe', ['/d', '/c', FAKE_UVX_CMD, '--from', sandbox.wheel, 'horosa-skill', 'serve', '--host', '127.0.0.1', '--port', String(port)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv({ XUANSHU_FAKE_UVX_LOG: sandbox.uvxLog }),
      })
      receivers.push({ stop: async () => { child.kill(); await new Promise((resolve) => setTimeout(resolve, 150)) } })
      // 等就绪：预算 20s（内核分配端口 + 假 uvx 秒起，正常 <1s；留宽预算只为不让负载抖动变成假红），
      // 失败信息里带端口号 + 假 uvx 的输出（Lead 2026-10-13 的要求）。
      const stderr = []
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk) => stderr.push(chunk))
      await waitMcpReady(port, { timeoutMs: 20_000, describe: 'uvx.cmd 形态的假 uvx', tail: () => stderr.join('') })
      expect(sandbox.uvxCalls().some((entry) => entry.kind === 'serve' && entry.port === port)).toBe(true)
    }, 60_000)

    it('拒绝绑真实 8765（安全护栏）：exit 9 + 台账留 serve-refused', async () => {
      const sandbox = makeSandbox('p0-fake-uvx-8765')
      const child = spawn(process.execPath, [FAKE_UVX_MJS, '--from', sandbox.wheel, 'horosa-skill', 'serve', '--host', '127.0.0.1', '--port', '8765'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv({ XUANSHU_FAKE_UVX_LOG: sandbox.uvxLog }),
      })
      const code = await new Promise((resolve) => child.on('exit', resolve))
      expect(code).toBe(9)
      expect(sandbox.uvxCalls().some((entry) => entry.kind === 'serve-refused')).toBe(true)
    }, 20_000)
  })

  describe('假 setup 报告 / 假 runtime 清单', () => {
    it('fill() 之后是合法 JSON，pin.version / pin.wheel.path / runtime.root 都指向沙箱', () => {
      const sandbox = makeSandbox('p0-templates')
      const report = sandbox.writeSetupReport()
      expect(report.schema).toBe('xuanshu/setup-report@1')
      expect(report.pin.version).toBe(sandbox.pin.version)
      expect(report.pin.wheel.path).toBe(sandbox.wheel)
      expect(existsSync(report.pin.wheel.path)).toBe(true)
      expect(report.pin.wheel.name).toBe(sandbox.pin.wheel.name)
      expect(report.runtime.root).toBe(sandbox.runtimeRoot)
      expect(readJson(sandbox.setupReportFile).pin.wheel.path).toBe(sandbox.wheel)

      const manifest = sandbox.writeRuntimeManifest()
      expect(manifest.runtime_payload_version).toBe(sandbox.pin.version)
      expect(manifest.schema_version).toBe(1)
      expect(readJson(join(sandbox.runtimeRoot, 'current', 'runtime-manifest.json')).version).toBe(sandbox.pin.version)
    })

    it('writeRuntimeManifest({key:version}) 真的抹掉 runtime_payload_version（R2 的回退分支要用）', () => {
      const sandbox = makeSandbox('p0-templates-fallback')
      const manifest = sandbox.writeRuntimeManifest({ key: 'version', version: '0.0.1' })
      expect(manifest.runtime_payload_version).toBeUndefined()
      expect(manifest.version).toBe('0.0.1')
    })
  })

  describe('夹具的落地面', () => {
    it('假 uvx / 假 MCP 服务器都在 fixtures/bin 下（P7/P8 用 XUANSHU_UVX_BIN 指过去）', () => {
      expect(existsSync(FAKE_UVX_MJS)).toBe(true)
      expect(existsSync(FAKE_UVX_CMD)).toBe(true)
    })

    it('信封 fixture 是纯 JSON、不带任何额外键（不污染被测对象的输入面）', () => {
      for (const name of ENVELOPE_NAMES) {
        const envelope = readJson(join(ENVELOPES_DIR, `${name}.json`))
        expect(Object.keys(envelope).filter((key) => key.startsWith('_')), `${name} 混进了注释键`).toEqual([])
      }
    })

    it.skipIf(!HAS_CAPTURES)('PROVENANCE.md 写明了那处「契约与真机不符」（fourColumns 里是 time）', () => {
      const provenance = readFileSync(join(ENVELOPES_DIR, 'PROVENANCE.md'), 'utf8')
      expect(provenance).toMatch(/fourColumns/)
      expect(provenance).toMatch(/\*\*time\*\*/)
    })
  })

  describe('profile 物化快照（P10 的新鲜度门用的路径）', () => {
    it.skipIf(!HAS_PROFILE_COPY)('仓库 lib 与 profile/node_modules 拷贝都存在（两个不同的目录，不是 symlink）', () => {
      expect(existsSync(HOST_LIB)).toBe(true)
      expect(existsSync(PROFILE_HOST_LIB)).toBe(true)
    })
  })
})
