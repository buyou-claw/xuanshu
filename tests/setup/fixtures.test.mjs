/**
 * tests/setup/fixtures.test.mjs — **替身自检**：先证明断言台的 fixture 自己是对的。
 *
 * 为什么值得一条独立用例：`setup-cli.test.mjs` 里任何一条红，第一件要回答的问题是「是实现错了，
 * 还是 fixture 错了」。这个文件把三个替身（计数 server / 假 uvx / 两个 stub）各自的契约当场钉一遍，
 * 于是端到端失败时可以直接把嫌疑落到实现上，而不必先怀疑工具。
 *
 * 顺带把 fixture 的形状**文档化**：假 uvx 回放的 doctor/install/serve 就是
 * `.scratch/assembly-foundation/captures/setup-e2e-groundtruth.md` 里 Lead 实测的真机形状
 * （尤其是「装了但服务没起时 doctor.ok 仍是 false」这一条 —— 版本门只能看
 * `installed` + `runtime_payload_version`）。
 *
 * 仍然零外网：只碰 127.0.0.1 的回环端口。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { FAKE_UVX, STUB_INSTALL_PROFILE, STUB_VERIFY_ASSEMBLY } from './lib/paths.mjs'
import { childEnv } from './lib/env.mjs'
import { PIN_VERSION, writeFixtureArtifacts } from './lib/fixtures.mjs'
import { makeSandbox } from './lib/sandbox.mjs'
import { findFreePort, readCalls, startReleaseServer } from './lib/setup-run.mjs'
import { sha256File } from './lib/sha.mjs'

const sandbox = makeSandbox('fixtures')

/** 直接调假 uvx（不经被测实现）。 */
function fakeUvx(args, env = {}) {
  const run = spawnSync(process.execPath, [FAKE_UVX, ...args], {
    encoding: 'utf8',
    env: childEnv({ XUANSHU_FAKE_UVX_STATE: sandbox.state, ...env }),
  })
  let json
  try {
    json = JSON.parse(run.stdout)
  } catch {
    json = undefined
  }
  return { status: run.status, json, stdout: run.stdout ?? '', stderr: run.stderr ?? '' }
}

describe('fixture 自检 · 本地计数 server（唯一允许的「网络」）', () => {
  it('按请求计数、支持 Range 206、能「先给半个文件后断连」', async () => {
    const artifacts = writeFixtureArtifacts(sandbox)
    const half = Math.floor(artifacts.wheel.size / 2)
    const server = await startReleaseServer({
      state: join(sandbox.state, 'server-1'),
      routes: {
        [artifacts.wheel.name]: { file: artifacts.wheel.path, range: true, breakAfterBytes: half, breakTimes: 1 },
        default: { status: 404 },
      },
    })
    try {
      expect(await server.count()).toBe(0)

      // 第一次：断连（fetch 会以「body 提前结束」失败）
      await expect(fetch(server.url(`/releases/${artifacts.wheel.name}`)).then((res) => res.arrayBuffer())).rejects.toThrow()

      // 第二次：带 Range → 206 + 剩余字节
      const ranged = await fetch(server.url(`/releases/${artifacts.wheel.name}`), { headers: { range: `bytes=${half}-` } })
      expect(ranged.status).toBe(206)
      const rest = Buffer.from(await ranged.arrayBuffer())
      expect(rest.length).toBe(artifacts.wheel.size - half)
      expect(Buffer.concat([Buffer.from(readFileSync(artifacts.wheel.path)).subarray(0, half), rest]).length).toBe(artifacts.wheel.size)

      const stats = await server.stats()
      expect(stats.count).toBe(2)
      expect(stats.responses[0]).toMatchObject({ status: 200, sent: half, kind: 'break' })
      expect(stats.responses[1]).toMatchObject({ status: 206, kind: 'full' })
      expect(stats.requests[1].range).toBe(`bytes=${half}-`)

      // default 路由：别的路径 404（用来抓「实现打了个计划外的地址」）
      expect((await fetch(server.url('/whatever'))).status).toBe(404)
      expect(await server.count()).toBe(3)
      await server.reset()
      expect(await server.count()).toBe(0)
    } finally {
      server.stop()
    }
  })
})

describe('fixture 自检 · 假 uvx（回放真机形状）', () => {
  it('--version 是 preflight 要的那一行', () => {
    const result = fakeUvx(['--version'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('uv ')
  })

  it('doctor → install → doctor：版本门看 installed + runtime_payload_version，而 ok 一直是 false', () => {
    const state = join(sandbox.state, 'doctor-after')
    const artifacts = writeFixtureArtifacts(sandbox)
    const env = { XUANSHU_FAKE_UVX_STATE: state, HOROSA_RUNTIME_ROOT: join(sandbox.root, 'rt') }

    const before = fakeUvx(['--from', artifacts.wheel.path, 'horosa-skill', 'doctor'], env)
    expect(before.status).toBe(0)
    expect(before.json.installed).toBe(false)
    expect(before.json.runtime_payload_version).toBeNull()

    const install = fakeUvx(['--from', artifacts.wheel.path, 'horosa-skill', 'install', '--archive', artifacts.runtime.path], env)
    expect(install.status).toBe(0)
    expect(install.json.runtime_payload_version).toBe(PIN_VERSION)

    const after = fakeUvx(['--from', artifacts.wheel.path, 'horosa-skill', 'doctor'], env)
    expect(after.status).toBe(0)
    expect(after.json.installed).toBe(true)
    expect(after.json.runtime_payload_version).toBe(PIN_VERSION)
    // ⚠️ 真机实测：装好了但服务没起，`ok` 就是 false —— 谁拿 ok 当版本门，谁就会把好机器判坏。
    expect(after.json.ok).toBe(false)

    const calls = readCalls(state)
    expect(calls.map((call) => call.kind)).toEqual(['doctor', 'install', 'doctor'])
  })

  it('install --archive 指向不存在的归档 → 非 0（不许假装装好了）', () => {
    const state = join(sandbox.state, 'install-missing')
    const artifacts = writeFixtureArtifacts(sandbox)
    const result = fakeUvx(['--from', artifacts.wheel.path, 'horosa-skill', 'install', '--archive', join(sandbox.work, 'nope.zip')], { XUANSHU_FAKE_UVX_STATE: state })
    expect(result.status).not.toBe(0)
  })

  /**
   * 网络级重试：`TypeError: fetch failed` = 「连接还没起来 / 被拒」，不是断言失败。
   *
   * 为什么需要（本轮实测）：假服务器是子进程，全仓跑时启动会慢 —— 原来只给**握手** 5s 窗口，后面的
   * `fetch` 完全没有重试，于是同一份代码「单独跑绿、全仓跑偶发红」（`fetch failed`）。
   * 假红比不红更坏：它让新加的用例清单门（`scripts/check-test-inventory.mjs`）每跑几次就报一条假违规。
   * 只重试网络层，**断言失败照旧立即红**。
   */
  async function fetchUp(url, options, attempts = 150) {
    let last
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await fetch(url, options)
      } catch (error) {
        last = error
        if (error?.name !== 'TypeError') throw error
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    throw last
  }

  it('serve：MCP 握手是**真机形状**（SSE + mcp-session-id + 信封在 content[0].text 里）', async () => {
    const state = join(sandbox.state, 'serve')
    const port = await findFreePort()
    const artifacts = writeFixtureArtifacts(sandbox)
    const child = spawn(
      process.execPath,
      [FAKE_UVX, '--from', artifacts.wheel.path, 'horosa-skill', 'serve', '--transport', 'streamable-http', '--host', '127.0.0.1', '--port', String(port)],
      { env: childEnv({ XUANSHU_FAKE_UVX_STATE: state }), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const url = `http://127.0.0.1:${port}/mcp`
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    try {
      // 等它起监听（最多 15s：全仓跑时子进程启动慢，5s 会偶发假红）
      let sessionId
      for (let attempt = 0; attempt < 150; attempt += 1) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture-test', version: '1' } } }),
          })
          sessionId = response.headers.get('mcp-session-id')
          expect(response.status).toBe(200)
          expect(response.headers.get('content-type')).toContain('text/event-stream')
          expect(sessionId).toMatch(/^[0-9a-f]{32}$/)
          const text = await response.text()
          expect(text.startsWith('event: message\ndata: ')).toBe(true)
          const payload = JSON.parse(text.split('data: ')[1])
          expect(payload.result.serverInfo.version).toBe(PIN_VERSION)
          break
        } catch (error) {
          if (attempt === 149) throw error
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }

      // notifications → 202 空体（真机行为：客户端必须容忍空体）
      const notified = await fetchUp(url, {
        method: 'POST',
        headers: { ...headers, 'mcp-session-id': sessionId },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      })
      expect(notified.status).toBe(202)
      expect((await notified.text()).trim()).toBe('')

      // tools/list → 含 horosa_cn_bazi_birth
      const listText = await (await fetchUp(url, { method: 'POST', headers: { ...headers, 'mcp-session-id': sessionId }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) })).text()
      const tools = JSON.parse(listText.split('data: ')[1]).result.tools
      expect(tools.map((tool) => tool.name)).toContain('horosa_cn_bazi_birth')

      // tools/call：信封在 content[0].text；四柱可读；缺确认字段会被闸门挡
      const callArgs = { date: '1990-01-01', time: '12:00', zone: '+08:00', lat: '31n14', lon: '121e29', gender: '1', agent_confirmed_settings: true, clarification_notes: 'fixture' }
      const okText = await (await fetchUp(url, { method: 'POST', headers: { ...headers, 'mcp-session-id': sessionId }, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'horosa_cn_bazi_birth', arguments: callArgs } }) })).text()
      const envelope = JSON.parse(JSON.parse(okText.split('data: ')[1]).result.content[0].text)
      expect(envelope.ok).toBe(true)
      expect(envelope.version).toBe(PIN_VERSION)
      for (const key of ['year', 'month', 'day', 'hour']) {
        expect(envelope.data.bazi.fourColumns[key].ganzi).toMatch(/^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]$/)
      }

      const gateText = await (await fetchUp(url, { method: 'POST', headers: { ...headers, 'mcp-session-id': sessionId }, body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'horosa_cn_bazi_birth', arguments: { ...callArgs, agent_confirmed_settings: false } } }) })).text()
      const gate = JSON.parse(JSON.parse(gateText.split('data: ')[1]).result.content[0].text)
      expect(gate.ok).toBe(false)
      expect(gate.code).toBe('agent_guidance.required')

      expect(readCalls(state).some((call) => call.kind === 'tools-call')).toBe(true)
    } finally {
      child.kill()
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  })
})

describe('fixture 自检 · 两个 stub（零 pnpm / 零 DSH 启动）', () => {
  it('install-profile 替身：建出 <home>/profiles/<name>，并把 argv 记账', () => {
    const home = join(sandbox.root, 'stub-home')
    const log = join(sandbox.state, 'stub-log')
    const run = spawnSync(process.execPath, [STUB_INSTALL_PROFILE, '--home', home, '--profile', 'xuanshu'], {
      encoding: 'utf8',
      env: childEnv({ XUANSHU_STUB_LOG: log }),
    })
    expect(run.status).toBe(0)
    expect(existsSync(join(home, 'profiles', 'xuanshu', 'package.json'))).toBe(true)
    expect(readCalls(log, 'install-profile.jsonl')[0].argv).toEqual(['--home', home, '--profile', 'xuanshu'])
  })

  it('verify-assembly 替身：默认 ok=true / 强制失败时 exit 1 且 ok=false', () => {
    const okRun = spawnSync(process.execPath, [STUB_VERIFY_ASSEMBLY, '--json', '--dsh-home', sandbox.home, '--profile', 'xuanshu'], { encoding: 'utf8', env: childEnv() })
    expect(okRun.status).toBe(0)
    expect(JSON.parse(okRun.stdout).ok).toBe(true)

    const badRun = spawnSync(process.execPath, [STUB_VERIFY_ASSEMBLY, '--json', '--dsh-home', sandbox.home, '--profile', 'xuanshu'], { encoding: 'utf8', env: childEnv({ XUANSHU_STUB_MODE: 'fail-verify' }) })
    expect(badRun.status).toBe(1)
    expect(JSON.parse(badRun.stdout).ok).toBe(false)
  })

  it('fixture 归档是真 zip（`PK\\x03\\x04` 开头）且能被读到字节', () => {
    const artifacts = writeFixtureArtifacts(sandbox)
    for (const artifact of [artifacts.wheel, artifacts.runtime]) {
      const head = readFileSync(artifact.path).subarray(0, 4)
      expect(head.toString('hex'), `${artifact.name} 不是 zip`).toBe('504b0304')
      expect(statSync(artifact.path).size).toBe(artifact.size)
      expect(sha256File(artifact.path)).toBe(artifact.sha256)
    }
  })
})
