/**
 * P9 · **状态文件 + 裸 ctx**（装配永不许拖垮别人，但必须留下可机器读的现场）
 *
 * 判据出处：契约 §3.2 R1/R7/R8/R9 + §3.1 `createHorosaRuntime`/`installHorosa` + §5 P9。
 *
 * 抓的真实缺陷/风险：
 *   ① **`installHorosa` 抛异常 = 整个 DSH 装配树起不来**（用户失去的是全部功能，不是一个底座）。
 *      所以「裸 ctx（没有 provide/commands/logger/effect）也要活」是最重的一条：
 *      DSH 的 ctx 在不同宿主里能力不同，插件不许假设能力存在。
 *   ② **状态文件是排障唯一入口**：没有它，用户看到的是「八字卡一直转圈」，而现场（哪个 phase、
 *      哪个 code、hint 指向哪条命令）没人知道。所以断言的是**机器可读**的字段：`schema`（版本化）、
 *      `phase`（合法枚举）、`code`、`hint`（要能照着敲）、`generatedAt`（R7：每次状态变化都重写）。
 *   ③ **自动起 serve 必须在 apply 之后异步发生**（R1：`apply` 立即返回）——
 *      apply 里同步等 runtime 冷启动 = DSH 启动卡住分钟级。`XUANSHU_HOROSA_AUTOSTART=0` 是它的开关，
 *      也是断言台「零真实 uvx」的前提。
 *   ④ 同一进程多次装配必须共用一份（R8）：两次装配各起一个 serve 会撞端口。
 *
 * ⚠️ 本文件的**测试写法**有一条非显然的约束：`service.mjs` 按 R8 在**模块级**存了一份单例
 * （`INSTALLED`）。同一个文件里的用例共享模块实例 —— 第二个用例的 `config.dataDir` 会被忽略
 * （状态文件仍写在第一个沙箱里）。所以每个用例都用 `vi.resetModules()` + 动态 import 拿一份**新的**
 * 模块实例（等于「另一个进程里的第一次装配」），而 R8 的单例语义由**它自己那条用例**正面验。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { HOROSA_STATUS_SCHEMA } from '../../packages/xuanshu-host/lib/horosa/constants.mjs'
import { resolveHorosaPaths } from '../../packages/xuanshu-host/lib/horosa/paths.mjs'
import { FAKE_UVX_MJS } from './lib/paths.mjs'
import { makeSandbox } from './lib/sandbox.mjs'
import { findFreePort } from './lib/servers.mjs'
import { isolateProcessEnv } from './lib/env.mjs'

/** 合法的 phase 词表（R7 冻结）。 */
const PHASES = ['idle', 'ensuring', 'starting', 'ready', 'blocked', 'foreign', 'stopped']

/**
 * 拿一份**全新的** service 模块（新的模块级单例）。
 * `vi.resetModules()` 让下一次动态 import 重新求值 —— 等于「另一个进程里的第一次装配」。
 */
async function freshService() {
  vi.resetModules()
  return await import('../../packages/xuanshu-host/lib/horosa/service.mjs')
}

/**
 * cordis 形状的假 ctx：能力**逐项可关**。
 * 形状对着 T1 的取用方式（`ctx.provide(name, value)`、`softGet(ctx,'commands')` → `ctx.get('commands', false)`、
 * `ctx.effect(fn, label)`、`ctx.logger(scope) → {info,warn,error}`）——这正是「能力探测」该被测的形状。
 */
function fakeCtx({ provide = true, commands = true, effect = true, logger = true } = {}) {
  const record = { provided: [], commands: [], effects: [], logs: [] }
  const ctx = {}
  if (provide) ctx.provide = (name, service) => { record.provided.push({ name, service }) }
  if (commands) {
    ctx.commands = { register: (definition) => { record.commands.push(definition); return () => {} } }
    ctx.get = (name) => (name === 'commands' ? ctx.commands : undefined)
  } else {
    ctx.get = () => undefined
  }
  if (effect) ctx.effect = (fn, label) => { const dispose = fn(); record.effects.push(label); return typeof dispose === 'function' ? dispose : () => {} }
  if (logger) {
    const scoped = { info: (...args) => record.logs.push(args), warn: (...args) => record.logs.push(args), error: (...args) => record.logs.push(args) }
    ctx.logger = (scope) => { record.logs.push([`scope:${scope}`]); return scoped }
    Object.assign(ctx.logger, scoped)
  }
  ctx.record = record
  return ctx
}

function scene(label, env = {}) {
  const sandbox = makeSandbox(label)
  // `DSH_HOME` 也钉进沙箱：`installHorosa` 从 `process.env.DSH_HOME` 解析 dshHome，
  // 不钉的话它会去读/写**真实** `~/.dsh/xuanshu/…`（断言台的第一条卫生规矩就是不许碰它）。
  const restore = isolateProcessEnv({ DSH_HOME: sandbox.home, XUANSHU_UVX_BIN: FAKE_UVX_MJS, XUANSHU_HOROSA_AUTOSTART: '0', ...env })
  const config = { dataDir: sandbox.dataDir, runtimeRoot: sandbox.runtimeRoot, wheel: sandbox.wheel, uvxBin: FAKE_UVX_MJS, autoStart: false }
  return { sandbox, config, restore }
}

describe('P9 · 状态文件 + 装配（R1/R7/R8/R9）', () => {
  it('installHorosa 在「能力齐」的 ctx 上：provide 服务 xuanshuHorosa + 注册 /xuanshu-horosa 命令 + 落状态文件', async () => {
    const { installHorosa } = await freshService()
    const { sandbox, config, restore } = scene('p9-install-full')
    try {
      const ctx = fakeCtx()
      let returned
      expect(() => { returned = installHorosa(ctx, config) }).not.toThrow()
      // R8/R9：服务与命令都挂上了（服务名是跨模块判据：客户端按 xuanshuHorosa 取服务）。
      expect(ctx.record.provided.map((entry) => entry.name)).toContain('xuanshuHorosa')
      expect(returned.provided, `返回值说服务没注册：${returned.detail}`).toBe(true)
      expect(ctx.record.commands.length, '没注册 /xuanshu-horosa 命令').toBeGreaterThan(0)
      expect(returned.commanded).toBe(true)
      const command = ctx.record.commands[0]
      expect(command.name).toBe('xuanshu-horosa')
      expect(typeof command.handler).toBe('function')
      // R9：命令在 ctx.effect 的包裹里注册（dispose 要能收掉）。
      expect(ctx.record.effects.length, '命令没被 ctx.effect 包裹（dispose 收不掉）').toBeGreaterThan(0)
      // provide 进去的就是服务本身（返回值的 service 与它同一份）。
      const provided = ctx.record.provided.find((entry) => entry.name === 'xuanshuHorosa')
      expect(provided.service).toBe(returned.service)

      // R7：状态文件真的落了盘，且字段是机器可读的那几个。
      expect(existsSync(sandbox.statusFile), `${sandbox.statusFile} 没落盘`).toBe(true)
      const status = sandbox.status()
      expect(status.schema).toBe(HOROSA_STATUS_SCHEMA)
      expect(status.schema).toBe('xuanshu/horosa-status@1')
      expect(PHASES, `phase=${status.phase} 不在冻结词表里`).toContain(status.phase)
      expect(Number.isNaN(Date.parse(status.generatedAt)), 'generatedAt 不是可解析的时间').toBe(false)
      expect(status.runtime, 'status 缺 runtime 块').toBeTruthy()

      // R1 + 零真实 uvx：AUTOSTART=0 时一次都不许 spawn。
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(sandbox.uvxCalls(), 'AUTOSTART=0 却 spawn 了 serve').toEqual([])
    } finally {
      restore()
    }
  }, 30_000)

  it('裸 ctx（没有 provide/commands/effect/logger）也不抛、返回 ok，且状态文件照落（R1）', async () => {
    const { installHorosa } = await freshService()
    const { sandbox, config, restore } = scene('p9-install-bare')
    try {
      const ctx = {}
      let returned
      expect(() => { returned = installHorosa(ctx, config) }, '裸 ctx 上装配抛了 —— 整个 DSH 装配树会跟着死').not.toThrow()
      expect(returned.ok, `裸 ctx 上装配失败：${returned.detail}`).toBe(true)
      expect(returned.provided).toBe(false)
      expect(returned.commanded).toBe(false)
      // 缺能力要**说清楚**（notes 是排障入口），不是静默。
      expect(returned.notes.join('\n')).toMatch(/provide|commands/u)
      expect(existsSync(sandbox.statusFile)).toBe(true)
      const status = sandbox.status()
      expect(status.schema).toBe('xuanshu/horosa-status@1')
      expect(PHASES).toContain(status.phase)
      expect(sandbox.uvxCalls()).toEqual([])
    } finally {
      restore()
    }
  }, 30_000)

  it('只有 logger 没有 provide/commands 的 ctx 也活（能力是逐项可缺的）', async () => {
    const { installHorosa } = await freshService()
    const { sandbox, config, restore } = scene('p9-install-partial')
    try {
      const ctx = fakeCtx({ provide: false, commands: false, effect: false })
      expect(() => installHorosa(ctx, config)).not.toThrow()
      expect(existsSync(sandbox.statusFile)).toBe(true)
      expect(ctx.record.logs.length, '缺能力时应该留一条 note/日志，而不是静默').toBeGreaterThan(0)
    } finally {
      restore()
    }
  }, 30_000)

  it('R2 的分流落进状态文件：没装 runtime（也没有 setup 报告）→ code/hint 指向 setup，且不起 serve', async () => {
    const { installHorosa } = await freshService()
    const { sandbox, config, restore } = scene('p9-status-blocked')
    try {
      const ctx = fakeCtx()
      const returned = installHorosa(ctx, config)
      const service = ctx.record.provided.find((entry) => entry.name === 'xuanshuHorosa')?.service
      expect(service, `没有 xuanshuHorosa 服务（${returned.detail}）`).toBeTruthy()

      await service.ensure()
      const status = sandbox.status()
      expect(PHASES).toContain(status.phase)
      expect(status.ok).toBe(false)
      expect(['setup-report-missing', 'runtime-not-installed', 'runtime-version-mismatch']).toContain(status.code)
      expect(String(status.hint), 'blocked 状态必须给得出可执行的下一步（R2：指向 setup）').toMatch(/setup/iu)
      expect(status.phase).not.toBe('ready')
      // 门没过就不许起 serve。
      expect(sandbox.uvxCalls()).toEqual([])
    } finally {
      restore()
    }
  }, 30_000)

  it('R7：每次状态变化都重写（第二次 ensure 的 generatedAt 必须更新，且读到的永远是完整 JSON）', async () => {
    const { installHorosa } = await freshService()
    const { sandbox, config, restore } = scene('p9-status-rewrite')
    try {
      const ctx = fakeCtx()
      installHorosa(ctx, config)
      const service = ctx.record.provided.find((entry) => entry.name === 'xuanshuHorosa')?.service
      await service.ensure()
      const first = sandbox.status()
      const firstMtime = statSync(sandbox.statusFile).mtimeMs
      await new Promise((resolve) => setTimeout(resolve, 60))
      await service.ensure()
      const second = sandbox.status()
      expect(second.generatedAt).not.toBe(first.generatedAt)
      expect(statSync(sandbox.statusFile).mtimeMs).toBeGreaterThanOrEqual(firstMtime)
      expect(PHASES).toContain(second.phase)
      // 原子写：读到的永远是完整 JSON（不许出现半截文件）。
      expect(() => JSON.parse(readFileSync(sandbox.statusFile, 'utf8'))).not.toThrow()
    } finally {
      restore()
    }
  }, 30_000)

  it('createHorosaRuntime 返回冻结的服务面，且 status() 不产生副作用（不起进程）', async () => {
    const { createHorosaRuntime } = await freshService()
    const { sandbox, config, restore } = scene('p9-service-shape')
    try {
      const ctx = fakeCtx()
      const paths = resolveHorosaPaths({ dshHome: sandbox.home, config, env: {} })
      const plan = {
        ok: true, code: null, wheel: sandbox.wheel, version: sandbox.pin.version, uvxBin: FAKE_UVX_MJS,
        host: '127.0.0.1', port: 8765, runtimeRoot: sandbox.runtimeRoot, dataDir: sandbox.dataDir,
        source: 'test', detail: 'test plan', hint: '',
      }
      const service = createHorosaRuntime({ ctx, config, log: () => {}, paths, plan })
      for (const key of ['status', 'ensure', 'start', 'stop', 'waitReady', 'baziBirth', 'snapshot']) {
        expect(typeof service[key], `服务面少了 ${key}()`).toBe('function')
      }
      // status() 不产生副作用（§3.3/R8）：
      //   · 值与「内存里的现场」一致 —— 除了 `generatedAt`（它就是「这份快照是什么时候生成的」，
      //     每次读刷新是**语义正确**的；早先这里断言整体 deep-equal，在全仓跑到第 3 次时因为跨毫秒而红，
      //     是断言写错了，不是实现错了）；
      //   · 不起进程、不写盘。
      const one = service.status()
      await new Promise((resolve) => setTimeout(resolve, 25))
      const two = service.status()
      const VOLATILE = new Set(['generatedAt'])
      for (const key of new Set([...Object.keys(one), ...Object.keys(two)])) {
        if (VOLATILE.has(key)) continue
        expect(two[key], `status().${key} 两次调用不同 —— status() 该是从内存里读快照`).toEqual(one[key])
      }
      expect(one.schema).toBe(HOROSA_STATUS_SCHEMA)
      expect(PHASES).toContain(one.phase)
      const before = existsSync(sandbox.statusFile)
      service.status()
      expect(sandbox.uvxCalls(), 'status() spawn 了进程').toEqual([])
      expect(existsSync(sandbox.statusFile), 'status() 写了状态文件（读操作不该落盘）').toBe(before)
    } finally {
      restore()
    }
  }, 30_000)

  it('同一进程内多次装配共用一份服务与一份路径（R8：幂等，不许各起一个 serve）', async () => {
    const { installHorosa } = await freshService()
    const { sandbox, config, restore } = scene('p9-idempotent')
    try {
      const first = fakeCtx()
      const other = fakeCtx()
      const a = installHorosa(first, config)
      const b = installHorosa(other, config)
      expect(a.service).toBeTruthy()
      expect(b.service, '两次装配给了两份服务（各起一个 serve 会撞端口）').toBe(a.service)
      expect(b.paths.dataDir).toBe(a.paths.dataDir)
      expect(b.notes.join('\n'), '第二次装配没认出「已存在」').toMatch(/幂等|已存在/u)
      expect(existsSync(join(a.paths.dataDir, 'horosa-status.json'))).toBe(true)
      // 两次装配各自都要把服务挂到自己的 ctx 上（同进程两个 fiber 各取各的）。
      expect(first.record.provided.map((entry) => entry.name)).toContain('xuanshuHorosa')
      expect(other.record.provided.map((entry) => entry.name)).toContain('xuanshuHorosa')
      expect(sandbox.uvxCalls()).toEqual([])
    } finally {
      restore()
    }
  }, 30_000)

  it('幂等是按**目标 dataDir** 分的：两个不同目标各一份（不许合成一份把状态写串）', async () => {
    const { installHorosa } = await freshService()
    const { sandbox, config, restore } = scene('p9-idempotent-key')
    const second = makeSandbox('p9-idempotent-key-second')
    try {
      const a = installHorosa(fakeCtx(), config)
      const b = installHorosa(fakeCtx(), { ...config, dataDir: second.dataDir })
      expect(a.service).toBeTruthy()
      expect(b.service).toBeTruthy()
      expect(b.service, '两个不同目标被合成一份服务：状态/日志会写到同一个 dataDir 里').not.toBe(a.service)
      expect(b.paths.dataDir).toBe(second.dataDir)
      expect(existsSync(join(second.dataDir, 'horosa-status.json')), '第二个目标没落自己的状态文件').toBe(true)
      expect(sandbox.uvxCalls()).toEqual([])
    } finally {
      restore()
    }
  }, 30_000)

  it('自动起 serve 是异步的：installHorosa 立即返回（R1），runtime 门没过就不 spawn', async () => {
    const { installHorosa } = await freshService()
    const { sandbox, restore } = scene('p9-autostart-async', { XUANSHU_HOROSA_AUTOSTART: '1' })
    try {
      const port = await findFreePort()
      const ctx = fakeCtx()
      const config = { dataDir: sandbox.dataDir, runtimeRoot: sandbox.runtimeRoot, wheel: sandbox.wheel, uvxBin: FAKE_UVX_MJS, autoStart: true, startDelayMs: 20, host: '127.0.0.1', port }
      const started = Date.now()
      // runtime 根是空的、报告也没有 → 门会挡住，所以 apply 之后**不会**真的起 serve。
      // 这条用例量的是「apply 有没有同步等」：等待 runtime 门 = 立刻返回（毫秒级）。
      const returned = installHorosa(ctx, config)
      const elapsed = Date.now() - started
      expect(elapsed, `installHorosa 同步花了 ${elapsed}ms —— apply 里不许等（R1）`).toBeLessThan(2000)
      // autoStart=true 且 env 未关：它必须**安排了**自启（否则「默认自带」就成了空话）。
      expect(returned.autostart).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 600))
      // 门没过 → 即使安排了自启也不许 spawn 任何东西。
      expect(sandbox.uvxCalls()).toEqual([])
      const status = sandbox.status()
      expect(PHASES).toContain(status.phase)
    } finally {
      restore()
    }
  }, 30_000)

  it('状态文件在 <dataDir>/horosa-status.json（R7 的落点），且写的是完整 JSON', async () => {
    const { installHorosa } = await freshService()
    const { sandbox, config, restore } = scene('p9-status-path')
    try {
      installHorosa(fakeCtx(), config)
      const expected = join(sandbox.dataDir, 'horosa-status.json')
      expect(existsSync(expected)).toBe(true)
      expect(sandbox.statusFile).toBe(expected)
      // 目录里不许留 `.tmp`/`.part` 之类的半成品（原子写的常见失误：rename 没做干净）。
      const leftovers = readFileSync(sandbox.dataDir ? join(sandbox.dataDir, 'horosa-status.json') : expected, 'utf8')
      expect(() => JSON.parse(leftovers)).not.toThrow()
    } finally {
      restore()
    }
  }, 30_000)
})
