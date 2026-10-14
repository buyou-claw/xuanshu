/**
 * 票 08 · 装配接线（契约 §2：六个方法进**同一条** `/xuanshu` 通道；契约 §3：出盘只走 `xuanshuHorosa`）
 *
 * 这条用例走的是**真** `installRpc`（`lib/rpc.mjs`，票 09/14 共用、本票不改）与**真** `apply()`
 * （`lib/index.js` 的总装配），只有宿主 ctx 是替身 —— 因为这里要验的正是「接线有没有接上」：
 * 方法名、通道路径、与 `pu.*` / `cang.*` 的合并，以及 `bazi.cast` 是否真的从 `ctx.get('xuanshuHorosa')`
 * 取服务（替身模拟的就是票 06 装出来的那个服务）。
 *
 * 抓的真实缺陷/风险：
 *   ① **方法名写错一个字母**在两侧都编译得过：客户端按 `bazi.basePu` 调、宿主注册 `bazi.base_pu`，
 *      症状是界面上「底座读不出来」而没有任何报错。这里逐名打一遍通道。
 *   ② **`...createBaziMethods()` 合并时被后面的展开覆盖**（或漏了展开）：`pu.list` / `cang.list`
 *      还在、`bazi.*` 全丢 —— 只有「九个方法都在」这一条断言能挡住。
 *   ③ **出盘绕过 `ctx` 直接 find 服务**：那样测试替身就换不进来（本用例的假 horosa 会失效）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { apply } from '../../packages/xuanshu-host/lib/index.js'
import { envelope, fakeHorosa, makeSandbox } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/**
 * 宿主替身：只实现 `apply()` 真正会碰的那几样能力。
 * `inject` 同步回调（等价于「依赖服务已就绪」），`effect` 立即执行回调并记下清理函数。
 */
function makeHost({ services = {} } = {}) {
  const routes = []
  const provided = new Map()
  const cleanups = []
  const host = {
    get(name) {
      return services[name]
    },
    logger() {
      return { info() {}, warn() {}, error() {} }
    },
    effect(callback) {
      cleanups.push(callback())
      return () => {}
    },
    provide(name, value) {
      provided.set(name, value)
      return () => {}
    },
    commands: { register: () => () => {} },
    inject(names, callback) {
      callback({
        ...host,
        skills: { register: () => () => {} },
        connection: {
          rpc: {
            handle(path, handler) {
              routes.push({ path, handler })
              return () => {}
            },
          },
        },
      })
      return () => {}
    },
  }
  return { host, routes, provided, cleanups }
}

/** 跑一次总装配，返回通道上的一条路由。 */
function assemble() {
  const sandbox = makeSandbox('wiring')
  roots.push(sandbox)
  const fake = fakeHorosa(envelope('bazi-ok-default'))
  const { host, routes, provided } = makeHost({ services: { xuanshuHorosa: fake.service } })
  // autoStart:false：本用例不验 serve 生命周期（票 06 的事），只验接线。
  apply(host, { dataDir: sandbox.dataDir, autoStart: false })
  expect(routes).toHaveLength(1)
  return { sandbox, fake, route: routes[0], provided }
}

/** 通过 `/xuanshu` 通道调一个方法（rpc.mjs 的返回信封：`{ok, value}` / `{ok:false, error}`）。 */
function call(route, method, payload = {}) {
  return route.handler(method, payload, new AbortController().signal)
}

const CONTRACT_METHODS = ['bazi.status', 'bazi.snapshot', 'bazi.basePu', 'bazi.cities', 'bazi.timezone', 'bazi.cast']

describe('票 08 · 六个方法挂在同一条 /xuanshu 通道上（契约 §2）', () => {
  it('通道路径 = /xuanshu，六个方法名逐字可调，且与 pu.* / cang.* 合并而不是互相覆盖', async () => {
    const { route } = assemble()
    expect(route.path).toBe('/xuanshu')

    for (const method of CONTRACT_METHODS) {
      const response = await call(route, method, method === 'bazi.cast' ? { birth: {}, confirmed: false } : {})
      expect(response.ok, `${method} 没挂上通道：${JSON.stringify(response)}`).toBe(true)
    }

    // 合并（不是覆盖）：票 09 / 票 14 的方法仍在。
    const pu = await call(route, 'pu.list', {})
    expect(pu.ok).toBe(true)
    expect(Array.isArray(pu.value)).toBe(true)
    const cang = await call(route, 'cang.list', {})
    expect(cang.ok).toBe(true)

    // 名字写错就该是「未知玄枢操作」，而不是静默成功。
    const typo = await call(route, 'bazi.base_pu', {})
    expect(typo.ok).toBe(false)
    expect(typo.error.message).toMatch(/未知玄枢操作/u)
  })

  it('装配时 xuanshuHorosa 被 provide 出来（票 06 的服务仍是 bazi.cast 的唯一通道）', () => {
    const { provided } = assemble()
    expect(provided.has('xuanshuHorosa')).toBe(true)
  })

  it('bazi.cast 经通道出盘：取的是 ctx 上的 xuanshuHorosa，落的是同一个 dataDir 的快照与底座谱', async () => {
    const { sandbox, fake, route } = assemble()
    const response = await call(route, 'bazi.cast', {
      birth: { date: '1990-06-01', time: '04:00', zone: 'Asia/Shanghai', lat: 31.2304, lon: 121.4737, place: '上海' },
      confirmed: true,
    })
    expect(response.ok, JSON.stringify(response)).toBe(true)
    expect(response.value.phase).toBe('ok')
    expect(fake.calls).toHaveLength(1)

    const status = await call(route, 'bazi.status', {})
    expect(status.value).toMatchObject({ state: 'ready' })
    expect(status.value.snapshot.pillars).toEqual({ year: '己巳', month: '丙子', day: '丙寅', hour: '甲午' })

    expect(sandbox.exists('bazi', 'snapshot.json')).toBe(true)
    expect(sandbox.exists('pus', '_base', 'manifest.md')).toBe(true)

    const basePu = await call(route, 'bazi.basePu', {})
    expect(basePu.value.pu.name).toBe('底座')
  })

  it('数据目录同源：装配报告、快照、底座谱都落在 config.dataDir 下（不各写一处）', async () => {
    const { sandbox, route } = assemble()
    await call(route, 'bazi.cast', {
      birth: { date: '1990-06-01', time: '04:00', zone: 'Asia/Shanghai', lat: 31.2304, lon: 121.4737 },
      confirmed: true,
    })
    expect(sandbox.exists('assembly-report.json')).toBe(true)
    expect(sandbox.exists('bazi', 'snapshot.json')).toBe(true)
    expect(sandbox.exists('pus', '_base', 'bazi.md')).toBe(true)
  })
})
