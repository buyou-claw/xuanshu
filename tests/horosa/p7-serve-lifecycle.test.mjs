/**
 * P7 · **serve 生命周期（假 uvx）** —— 起 / 复用 / 拒绝 / 只停自己起的
 *
 * 判据出处：契约 §3.2 R3/R4/R5 + §3.1 `startHorosaServe`/`stopHorosaServe`/`ownsServe` + §5 P7。
 *
 * 抓的真实缺陷/风险：
 *   ① **「起得来」不等于「答得出」**：`uvx --from … serve` 会立刻返回一个进程，但端口要等 runtime 起来
 *      （真机冷启动分钟级）。所以断言分两层：**进程外的台账**（假 uvx 真被调用过、argv/env 对）
 *      + **端口上的握手**（我们自己的最小客户端复判 200 + `mcp-session-id`），不看实现自报的字段。
 *   ② **复用不是「再起一份」**：端口上已有 horosa 形态时再 spawn 一份，结果是两个进程抢 8765，
 *      后起那个死掉、先起那个被留成孤儿 —— 断言「假 uvx 的台账行数不变」才抓得住。
 *   ③ **`occupied-foreign` / `probe-failed` 都必须不 spawn**（fail-closed）：起一份去撞别人的端口，
 *      轻则白起一个进程，重则把用户桌面版星阙的端口占了（`:9999`/`:8899` 永不触碰）。
 *   ④ **只停自己起的**：`stopHorosaServe(别人 pid)` 若真的 taskkill，就把用户的进程杀了。
 *      这条用例的对照组是**测试自己起的**独立进程 —— 断言它「调用之后还活着」（不是看返回值那么弱）。
 *
 * 零网络（只连 127.0.0.1）、零真实 uvx（`XUANSHU_UVX_BIN` 指假 uvx）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { delimiter } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { checkHorosaEndpoint } from '../../packages/xuanshu-host/lib/horosa/guard.mjs'
import { ownsServe, startHorosaServe, stopHorosaServe } from '../../packages/xuanshu-host/lib/horosa/serve.mjs'
import { FAKE_BIN_DIR, FAKE_UVX_CMD, FAKE_UVX_MJS } from './lib/paths.mjs'
import { makeSandbox, waitFor } from './lib/sandbox.mjs'
import { findFreePort, isAlive, startFakeMcp, waitMcpReady } from './lib/servers.mjs'
import { childEnv, isolateProcessEnv } from './lib/env.mjs'

/** serve 的启动预算：假 uvx 秒起，给 20s 足够宽（真机冷启动分钟级是生产的事，不是断言台的）。 */
const START_TIMEOUT_MS = 20_000
/** 端口就绪预算：内核分配的端口 + 秒起的替身，正常 <1s；宽预算只为不让负载抖动变成假红。 */
const READY_TIMEOUT_MS = 20_000

const receivers = []
const startedServePids = []
afterAll(async () => {
  // 收尾：先收自己起的 serve（不留孤儿），再收对照组。
  for (const pid of startedServePids.splice(0)) {
    try {
      await stopHorosaServe({ pid, timeoutMs: 8000, sync: true })
    } catch {
      /* 已经死了 */
    }
  }
  for (const receiver of receivers.splice(0)) await receiver.stop()
})

/**
 * 造一套「被测实现的外界」：沙箱 + 假 uvx + 干净的进程环境。
 *
 * `DSH_HOME` 也钉进沙箱：`installHorosa` 的 `dshHome` 是从 `process.env.DSH_HOME` 解析的
 * （`resolveDshHome(ctx, process.env)`），不钉的话它会去读**真实** `~/.dsh/xuanshu/setup-report.json`，
 * 于是「有报告 → 起 serve」这条用例永远等不到 spawn（而且看起来像是实现的问题）。
 *
 * `env` 可以是对象，也可以是 `(sandbox) => env` —— 后者用于「env 里要写沙箱内部路径」的场合
 * （比如把假 uvx 的台账 `XUANSHU_FAKE_UVX_LOG` 指到 `<sandbox>/uvx-calls.jsonl`）。
 *
 * 返回值里的 `config` 是这套沙箱的**基础 config**（dataDir/runtimeRoot/wheel/uvxBin/autoStart:false）。
 * 早先这里没有 `config` 键，而用例写着 `const { config: baseConfig } = scene(...)` ——
 * `baseConfig` 恒为 `undefined`，被 `{...baseConfig}` 静默展开成空对象：**看着像配了、其实没配**。
 */
function scene(label, env = {}) {
  const sandbox = makeSandbox(label)
  const overrides = typeof env === 'function' ? env(sandbox) : env
  const restore = isolateProcessEnv({ DSH_HOME: sandbox.home, XUANSHU_UVX_BIN: FAKE_UVX_MJS, XUANSHU_HOROSA_AUTOSTART: '0', ...overrides })
  const config = { dataDir: sandbox.dataDir, runtimeRoot: sandbox.runtimeRoot, wheel: sandbox.wheel, uvxBin: FAKE_UVX_MJS, autoStart: false }
  return { sandbox, config, restore }
}

/**
 * cordis 形状的最小 ctx（只给 installHorosa 要用的四件）：
 * `provide` 记账、`get('commands')` → 能 register、`effect(fn, label)` **立即执行 fn 并返回它的 cleanup**、
 * `logger(scope)` → 带 info/warn/error 的作用域日志。`record.disposers` 就是「DSH 退出时会调的东西」。
 */
function lifecycleCtx() {
  const record = { provided: [], commands: [], effects: [], disposers: [], logs: [] }
  const ctx = {}
  ctx.provide = (name, service) => { record.provided.push({ name, service }) }
  ctx.commands = { register: (definition) => { record.commands.push(definition); return () => {} } }
  ctx.get = (name) => (name === 'commands' ? ctx.commands : undefined)
  ctx.effect = (fn, label) => {
    const cleanup = fn()
    record.effects.push(label)
    const disposer = typeof cleanup === 'function' ? cleanup : () => {}
    record.disposers.push(disposer)
    return disposer
  }
  const scoped = { info: (...args) => record.logs.push(args), warn: (...args) => record.logs.push(args), error: (...args) => record.logs.push(args) }
  ctx.logger = (scope) => { record.logs.push([`scope:${scope}`]); return scoped }
  Object.assign(ctx.logger, scoped)
  ctx.record = record
  return ctx
}

/**
 * 起一次 serve（固定用假 uvx + 内核分配的空闲端口 + 沙箱 dataDir）。
 *
 * `findFreePort()` 是「先 bind(0) 拿端口、再关掉、稍后由别人 bind」——中间有一个 TOCTOU 窗口：
 * 机器上别的进程（或另一个用例）可能先抢到它，那时假 uvx 会以 EADDRINUSE 退出。
 * 对这种**明确的端口竞争**换一个端口重试一次（其余失败原样返回，不许把真失败也吞掉）。
 */
async function startServe(sandbox, { port, uvxBin = FAKE_UVX_MJS, host = '127.0.0.1', env = {}, timeoutMs = START_TIMEOUT_MS } = {}) {
  const attempt = async (targetPort) => {
    const result = await startHorosaServe({
      wheel: sandbox.wheel,
      uvxBin,
      runtimeRoot: sandbox.runtimeRoot,
      dataDir: sandbox.dataDir,
      host,
      port: targetPort,
      logFile: sandbox.serveLog,
      timeoutMs,
      env: childEnv({ XUANSHU_FAKE_UVX_LOG: sandbox.uvxLog, ...env }),
    })
    if (result?.pid) startedServePids.push(result.pid)
    return result
  }
  const first = await attempt(port)
  const bindConflict = sandbox.uvxCalls().some((entry) => entry.kind === 'serve-error' && /EADDRINUSE/i.test(String(entry.error ?? '')) && entry.port === port)
  if (first?.ok === false && bindConflict) {
    const retryPort = await findFreePort()
    const second = await attempt(retryPort)
    return { ...second, retriedPort: { from: port, to: retryPort } }
  }
  return first
}

describe('P7 · serve 生命周期（假 uvx）', () => {
  it('空闲端口：spawn 假 uvx → ok/started + pid>0 + 端口真的答 MCP + argv/env 全对 + 日志落了盘', async () => {
    const { sandbox, restore } = scene('p7-start-free')
    try {
      const port = await findFreePort()
      const result = await startServe(sandbox, { port })
      expect(result.ok, `startHorosaServe 失败：${JSON.stringify(result)}`).toBe(true)
      expect(result.started).toBe(true)
      expect(result.pid).toBeGreaterThan(0)
      // `verdict` 是**四态词表**里的值：起成功后可以报 free（决策那一刻的裁决）或 horosa-ready
      // （起来之后的终态）；两种口径都自洽，所以这里只钉「词表内 + 与 ok 一致」——
      // 真正的事实由下面的端口握手与台账判（不靠这个字段自证）。
      expect(['free', 'horosa-ready'], `verdict=${result.verdict} 不在四态词表里`).toContain(result.verdict)
      expect(ownsServe(result.pid), 'ownsServe 认不出自己起的进程').toBe(true)

      // ① 进程外证据：假 uvx 真的被调用过，argv/env 与 R3 逐条一致。
      const call = sandbox.uvxCalls().find((entry) => entry.kind === 'serve')
      expect(call, `假 uvx 没被调用过（台账：${JSON.stringify(sandbox.uvxCalls())}）`).toBeTruthy()
      expect(call.wheel).toBe(sandbox.wheel)
      expect(call.cmd).toBe('serve')
      expect(call.host).toBe('127.0.0.1')
      expect(call.port).toBe(port)
      expect(call.env.HOROSA_RUNTIME_ROOT).toBe(sandbox.runtimeRoot)
      expect(call.env.HOROSA_SKILL_DATA_DIR).toBe(sandbox.dataDir)
      expect(call.env.HOROSA_SKILL_HOST).toBe('127.0.0.1')
      expect(call.env.HOROSA_SKILL_PORT).toBe(String(port))

      // ① 端口证据：我们自己的最小客户端复判（判据 = 200 + mcp-session-id，票 05 口径）。
      const probe = await waitMcpReady(result.retriedPort?.to ?? port, {
        timeoutMs: READY_TIMEOUT_MS,
        requireSession: true,
        describe: '假 uvx 起的 serve',
        tail: () => `台账：\n${sandbox.uvxLogTail()}\n--- serve.log ---\n${sandbox.serveLogTail()}`,
      })
      expect(probe.ok).toBe(true)
      expect(String(probe.sessionId)).toMatch(/^[0-9a-f]{32}$/)

      // R3：stdio 直接落 <dataDir>/serve.log（不给子进程留管道 —— 票 05 的 BrokenPipe 坑）。
      expect(existsSync(sandbox.serveLog), 'serve.log 没落盘（R3）').toBe(true)
      expect(readFileSync(sandbox.serveLog, 'utf8')).toContain('监听')
    } finally {
      restore()
    }
  }, 60_000)

  it('端口上已有 horosa 形态（别人的）→ 复用：started:false、pid:null，且**不再 spawn 一次**', async () => {
    const { sandbox, restore } = scene('p7-reuse')
    const existing = await startFakeMcp({ mode: 'mcp' })
    receivers.push(existing)
    try {
      const result = await startServe(sandbox, { port: existing.port })
      expect(result.ok, `复用失败：${JSON.stringify(result)}`).toBe(true)
      expect(result.verdict).toBe('horosa-ready')
      expect(result.started).toBe(false)
      expect(result.pid ?? null).toBe(null)
      // ② 复用不是「再起一份」：台账里一行都不该有（假 uvx 是**我们自己起的**那个服务器的替身）。
      expect(sandbox.uvxCalls(), `端口上已有 horosa 却又 spawn 了一次：${JSON.stringify(sandbox.uvxCalls())}`).toEqual([])
      // 别人的进程不许被碰。
      expect(existing.alive(), '复用路径把别人的 server 杀了？').toBe(true)
    } finally {
      restore()
    }
  }, 60_000)

  it('端口被非 horosa 进程占着 → 拒绝启动（ok:false + occupied-foreign），且不 spawn', async () => {
    const { sandbox, restore } = scene('p7-foreign')
    const foreign = await startFakeMcp({ mode: 'foreign-html' })
    receivers.push(foreign)
    try {
      const result = await startServe(sandbox, { port: foreign.port })
      expect(result.ok).toBe(false)
      expect(result.verdict).toBe('occupied-foreign')
      expect(result.started).toBe(false)
      expect(result.pid ?? null).toBe(null)
      expect(String(result.detail ?? '')).toContain(String(foreign.port))
      expect(sandbox.uvxCalls(), '被占却还是 spawn 了一份（fail-fast 失效）').toEqual([])
      expect(foreign.alive(), '拒绝路径把占用者杀了？').toBe(true)
    } finally {
      restore()
    }
  }, 60_000)

  it('端口有人 LISTEN 但零 HTTP 响应 → fail-closed 拒绝（probe-failed ≠ 通过，也 ≠ 被占），且不 spawn', async () => {
    const { sandbox, restore } = scene('p7-probe-failed')
    const bare = await startFakeMcp({ mode: 'bare-tcp' })
    receivers.push(bare)
    try {
      const result = await startServe(sandbox, { port: bare.port, timeoutMs: 3000 })
      expect(result.ok).toBe(false)
      expect(result.verdict).toBe('probe-failed')
      expect(result.started).toBe(false)
      // ③ 「无法判定 ≠ 被占」：文案不许说成被占（否则用户会去杀一个可能是自家慢 horosa 的进程）。
      expect(String(result.detail ?? '')).toMatch(/无法判定/)
      expect(sandbox.uvxCalls(), 'probe-failed 却还是 spawn 了一份（fail-closed 失效）').toEqual([])
      expect(bare.alive()).toBe(true)
    } finally {
      restore()
    }
  }, 60_000)

  it('假 uvx 起得来但立刻退出 → ok:false（不抛、不留假 ready）', async () => {
    const { sandbox, restore } = scene('p7-died')
    try {
      const port = await findFreePort()
      const result = await startServe(sandbox, { port, env: { XUANSHU_FAKE_UVX_MODE: 'exit-immediately' }, timeoutMs: 5000 })
      expect(result.ok).toBe(false)
      expect(String(result.detail ?? '').length, '失败却不给 detail（用户无从下手）').toBeGreaterThan(0)
      // 报出来的 pid 若存在，它必须已经死了 —— 不许留一个「假装在跑」的句柄。
      if (result.pid) {
        await waitFor(() => !isAlive(result.pid), { timeoutMs: 5000, describe: `pid ${result.pid} 退出` })
      }
      // 台账里能看到它确实被调用过（失败发生在「起得来但答不出」，不是「没调用」）。
      expect(sandbox.uvxCalls().some((entry) => entry.died === true)).toBe(true)
    } finally {
      restore()
    }
  }, 60_000)

  it('stopHorosaServe(自己起的 pid) → ok:true，进程真没了、ownsServe 也不再认它', async () => {
    const { sandbox, restore } = scene('p7-stop-own')
    try {
      const port = await findFreePort()
      const result = await startServe(sandbox, { port })
      expect(result.ok).toBe(true)
      const pid = result.pid
      const stopped = await stopHorosaServe({ pid, timeoutMs: 8000, sync: true })
      expect(stopped.ok, `stop 失败：${JSON.stringify(stopped)}`).toBe(true)
      const dead = await waitFor(() => !isAlive(pid), { timeoutMs: 8000, describe: `pid ${pid} 退出` })
      expect(dead).toBe(true)
      expect(ownsServe(pid), '停了之后还认它 —— 下一轮会把别人的同号 pid 当成自己的').toBe(false)
    } finally {
      restore()
    }
  }, 60_000)

  it('stopHorosaServe(别人的 pid) → ok:false 拒绝，且那个进程**还活着**（绝不 kill 不是自己起的）', async () => {
    const { sandbox, restore } = scene('p7-stop-foreign')
    const foreign = await startFakeMcp({ mode: 'mcp' })
    receivers.push(foreign)
    try {
      expect(ownsServe(foreign.pid)).toBe(false)
      const result = await stopHorosaServe({ pid: foreign.pid, timeoutMs: 3000, sync: true })
      expect(result.ok, `stopHorosaServe 接受了表外 pid：${JSON.stringify(result)}`).toBe(false)
      // 真正要断言的：调用之后它**还活着**（返回值可能是假的，进程状态骗不了人）。
      expect(foreign.alive(), 'stopHorosaServe 把不是自己起的进程杀了（R5 最重的一条）').toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(foreign.alive()).toBe(true)
      // dataDir/台账保持干净：拒绝路径不该留下 spawn 痕迹。
      expect(sandbox.uvxCalls()).toEqual([])
    } finally {
      restore()
    }
  }, 60_000)

  it('R5 dispose：装配时自启的 serve 会在 effect 收尾时被**自己收掉**（端口不留孤儿）', async () => {
    // 端口用 env 顶（`XUANSHU_HOROSA_PORT`）：`config.port` 传数字目前会被 plan 丢（已回报 T1 的缺陷），
    // 而这条用例要验的是 dispose，不是端口来源 —— 用两种实现下都成立的那条路。
    const port = await findFreePort()
    const { sandbox, config: baseConfig, restore } = scene('p7-dispose', (box) => ({
      XUANSHU_HOROSA_AUTOSTART: '1',
      XUANSHU_FAKE_UVX_LOG: box.uvxLog,
    }))
    const { installHorosa } = await import('../../packages/xuanshu-host/lib/horosa/service.mjs')
    try {
      // 门要过：假 runtime 清单（同版本）+ 假 setup 报告（pin 版本 / wheel 路径）。
      sandbox.writeRuntimeManifest()
      sandbox.writeSetupReport()
      const ctx = lifecycleCtx()
      // 端口走 config.port（**数字**）：plan 层的三级链 config.port > $XUANSHU_HOROSA_PORT > 常量
      // 现在都生效（2026-10-13 T1 修掉了「数字被静默丢掉」那条缺陷，P6 有它的回归门）。
      const config = { ...baseConfig, uvxBin: FAKE_UVX_MJS, host: '127.0.0.1', port, autoStart: true, startDelayMs: 0 }
      const returned = installHorosa(ctx, config)
      expect(returned.autostart, `没安排自启（${returned.detail}）`).toBe(true)

      // 等自启真的把 serve 起起来（pid 落进状态文件 = 上一条断言的可观察物）。
      const status = await waitFor(() => (sandbox.status()?.serve?.pid ? sandbox.status() : undefined), {
        timeoutMs: 25_000,
        describe: `自启的 serve 拿到 pid（台账：${sandbox.uvxLogTail(600)}）`,
      })
      const pid = status.serve.pid
      expect(pid).toBeGreaterThan(0)
      startedServePids.push(pid)
      await waitMcpReady(port, { timeoutMs: 20_000, requireSession: true, describe: '自启起的 serve', tail: () => sandbox.serveLogTail() })

      // 触发 cordis 的 effect 收尾（= DSH 退出时会发生的事）：
      // 一个 ctx 上会挂**多个** effect（命令注册、后台自启的清理…），fiber 销毁时按序全跑一遍，
      // 所以这里全跑（只跑第一个等于什么也没发生）。
      expect(ctx.record.disposers.length, '没注册 effect 收尾：dispose 时不会收 serve').toBeGreaterThan(0)
      for (const dispose of ctx.record.disposers) await dispose()
      await waitFor(() => !isAlive(pid), { timeoutMs: 15_000, describe: `dispose 后 pid ${pid} 退出` })
      // 端口真的空出来了（用户可见的事实：DSH 退出后 8765 不该被自己占着）。
      const endpoint = await checkHorosaEndpoint({ host: '127.0.0.1', port, path: '/mcp', timeoutMs: 3000 })
      expect(endpoint.verdict, `dispose 之后端口上还有东西：${endpoint.detail}`).toBe('free')
      expect(sandbox.status().phase).toBe('stopped')
    } finally {
      restore()
    }
  }, 90_000)

  it('R5 keepServeOnDispose:true：明确要求保留时**不许**收（用户自己托管的那份留给他）', async () => {
    const port = await findFreePort()
    const { sandbox, config: baseConfig, restore } = scene('p7-keep-serve', (box) => ({
      XUANSHU_HOROSA_AUTOSTART: '1',
      XUANSHU_FAKE_UVX_LOG: box.uvxLog,
    }))
    const { installHorosa } = await import('../../packages/xuanshu-host/lib/horosa/service.mjs')
    try {
      sandbox.writeRuntimeManifest()
      sandbox.writeSetupReport()
      const ctx = lifecycleCtx()
      const config = { ...baseConfig, uvxBin: FAKE_UVX_MJS, host: '127.0.0.1', port, autoStart: true, startDelayMs: 0, keepServeOnDispose: true }
      installHorosa(ctx, config)
      const status = await waitFor(() => (sandbox.status()?.serve?.pid ? sandbox.status() : undefined), {
        timeoutMs: 25_000,
        describe: `自启的 serve 拿到 pid（台账：${sandbox.uvxLogTail(600)}）`,
      })
      const pid = status.serve.pid
      startedServePids.push(pid)
      for (const dispose of ctx.record.disposers) await dispose()
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(isAlive(pid), 'keepServeOnDispose=true 却把 serve 收了').toBe(true)
      expect(ownsServe(pid), 'keeper 模式下自己起的 serve 仍该被登记（否则以后没人认得它是自己的）').toBe(true)
    } finally {
      restore()
    }
  }, 90_000)

  it('XUANSHU_UVX_BIN 的三种 Windows 路径形态都能被 spawn 计划分派（.mjs / .cmd / 裸名走 PATH）', async () => {
    const originalPath = process.env.PATH
    // 裸名 `uvx` 要同时能被两种实现读到 PATH：用**显式 env** 传的（子进程侧）与 `process.env`（解析侧）。
    process.env.PATH = `${FAKE_BIN_DIR}${delimiter}${originalPath ?? ''}`
    const forms = [
      ['绝对 .mjs（node 直跑）', FAKE_UVX_MJS],
      ['绝对 .cmd（cmd.exe）', FAKE_UVX_CMD],
      ['裸名 uvx（PATH 命中 fixture bin）', 'uvx'],
    ]
    try {
      for (const [label, uvxBin] of forms) {
        const { sandbox, restore } = scene(`p7-form-${label.replace(/[^\w]+/g, '-')}`)
        try {
          const port = await findFreePort()
          const result = await startServe(sandbox, { port, uvxBin, env: { PATH: process.env.PATH } })
          expect(result.ok, `形态「${label}」起不来：${JSON.stringify(result)}\n台账：\n${sandbox.uvxLogTail()}`).toBe(true)
          expect(sandbox.uvxCalls().some((entry) => entry.kind === 'serve'), `形态「${label}」没走到假 uvx`).toBe(true)
          await waitMcpReady(result.retriedPort?.to ?? port, {
            timeoutMs: READY_TIMEOUT_MS,
            describe: `形态「${label}」起的 serve`,
            tail: () => `台账：\n${sandbox.uvxLogTail()}\n--- serve.log ---\n${sandbox.serveLogTail()}`,
          })
        } finally {
          restore()
        }
      }
    } finally {
      process.env.PATH = originalPath
    }
  }, 120_000)
})
