/**
 * 票 13 · 装配接线（契约 §1/§2：六个方法进**同一条** `/xuanshu` 通道；两条 daily 任务在装配后就在）
 *
 * 这条用例走**真** `apply()` 与**真** `installRpc`（宿主 ctx 是替身）—— 要验的正是「接线有没有接上」：
 * 方法名、通道路径、与票 08/09/14 的合并，以及**装配完成时** `ctx.schedule` 上是不是已经躺着两条任务。
 *
 * 抓的真实缺陷/风险：
 *   ① **定时任务晚于装配**：验收判据是「装配后含日课/底稿两条任务」。fire-and-forget 的实现在
 *      `dsh --help` 那种随即退出的启动路径上根本来不及建 —— 所以 apply 必须是 async 且 await 到完成。
 *   ② **方法名写错一个字母**两侧都编译得过：这里逐名打一遍通道，并让一个笔误落「未知玄枢操作」。
 *   ③ **接线把 `pu.*` / `cang.*` / `bazi.*` 覆盖掉**：合并断言（九路以上方法都在）。
 *   ④ **定时注册失败不许拖垮装配**：没有 `ctx.schedule` 时 apply 仍要正常返回（只是记 warn）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { apply } from '../../packages/xuanshu-host/lib/index.js'
import { fakeAgents, fakeSchedule, makeSandbox, waitFor } from '../digao/lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 宿主替身：只实现 `apply()` 真会碰的能力（与票 08 的接线用例同款）。 */
function makeHost({ services = {} } = {}) {
  const routes = []
  const provided = new Map()
  const host = {
    get(name) {
      return services[name]
    },
    logger() {
      return { info() {}, warn() {}, error() {} }
    },
    effect(callback) {
      callback()
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
        connection: { rpc: { handle(path, handler) { routes.push({ path, handler }); return () => {} } } },
      })
      return () => {}
    },
  }
  return { host, routes, provided }
}

function call(route, method, payload = {}) {
  return route.handler(method, payload, new AbortController().signal)
}

/** 装配一次（真 apply）。 */
async function assemble({ withSchedule = true } = {}) {
  const sandbox = makeSandbox('t13-wiring')
  roots.push(sandbox)
  const schedule = withSchedule ? fakeSchedule() : undefined
  const agents = fakeAgents()
  const services = { agents }
  if (schedule !== undefined) services.schedule = schedule
  const { host, routes } = makeHost({ services })
  // autoStart:false：本用例不验 horosa 的 serve 生命周期（票 06 的事），只验接线。
  apply(host, { dataDir: sandbox.dataDir, autoStart: false })
  expect(routes).toHaveLength(1)
  // 两条 daily 任务是**异步**注册的（`ctx.inject(['schedule'], …)` 的回调里跑两位 Promise 面），
  // 装配返回时可能还在飞；等它们落地再断言（等价于界面上「装配完成后看得到任务」）。
  await waitFor(
    () => (withSchedule ? schedule.calls.filter((entry) => entry.method === 'create').length === 2 : true),
    { describe: '两条 daily 任务注册' },
  )
  return { sandbox, route: routes[0], schedule, agents }
}

describe('票13 · 六个方法挂在同一条 /xuanshu 通道上（契约 §1/§2）', () => {
  it('通道路径 /xuanshu；digao.* 与 rikke.* 逐字可调，且与 pu/藏/八字合并', async () => {
    const { route } = await assemble()
    expect(route.path).toBe('/xuanshu')

    for (const method of ['digao.status', 'digao.read', 'digao.refresh']) {
      const response = await call(route, method, {})
      expect(response.ok, `${method} 没挂上通道：${JSON.stringify(response)}`).toBe(true)
    }
    for (const method of ['rikke.status', 'rikke.generate']) {
      const response = await call(route, method, {})
      expect(response.ok, `${method} 没挂上通道：${JSON.stringify(response)}`).toBe(true)
    }
    // setTime 经通道改时间：装配期已经建好了「日课」，所以这条能真改成功（compare-and-update）。
    const setTime = await call(route, 'rikke.setTime', { time: '06:45' })
    expect(setTime.ok, JSON.stringify(setTime)).toBe(true)
    expect(setTime.value.schedule).toEqual({ time: '06:45', timeZone: 'Asia/Shanghai' })

    // 合并（不是覆盖）：票 09/14/08 的方法仍在。
    for (const method of ['pu.list', 'cang.list', 'bazi.status']) {
      expect((await call(route, method, {})).ok, `${method} 被覆盖了`).toBe(true)
    }
    // 笔误必须是「未知玄枢操作」，而不是静默成功。
    const typo = await call(route, 'rikke.set_time', {})
    expect(typo.ok).toBe(false)
    expect(typo.error.message).toMatch(/未知玄枢操作/u)
  })

  it('底稿是只读派生物：通道上没有 digao.write / digao.update / digao.delete', async () => {
    const { route } = await assemble()
    for (const method of ['digao.write', 'digao.update', 'digao.delete']) {
      const response = await call(route, method, {})
      expect(response.ok, `${method} 不该存在`).toBe(false)
      expect(response.error.message).toMatch(/未知玄枢操作/u)
    }
  })
})

describe('票13 · 装配完成时两条 daily 任务已经在场（验收判据）', () => {
  it('日课 07:30 + 底稿刷新 03:30，各自绑玄枢自铸会话', async () => {
    const { schedule, agents } = await assemble()
    const creates = schedule.calls.filter((entry) => entry.method === 'create')
    expect(creates.map((entry) => entry.request.title).sort()).toEqual(['底稿刷新', '日课'].sort())
    expect(creates.find((entry) => entry.request.title === '日课').request.daily.time).toBe('07:30:00')
    expect(creates.find((entry) => entry.request.title === '底稿刷新').request.daily.time).toBe('03:30:00')
    expect(agents.calls.map((entry) => entry.sessionId.split('-')[2]).sort()).toEqual(['digao', 'rikke'])
  })

  it('rikke.status 经通道拿得到 schedule（契约修订的加性字段）', async () => {
    const { route } = await assemble()
    const status = await call(route, 'rikke.status', {})
    expect(status.value.schedule).toMatchObject({ time: '07:30', timeZone: 'Asia/Shanghai' })
    expect(typeof status.value.schedule.id).toBe('string')
  })

  it('没有 ctx.schedule（bundle 没启用）时装配照常完成：不抛、方法仍在、只是没有 schedule 键', async () => {
    const { route } = await assemble({ withSchedule: false })
    const status = await call(route, 'rikke.status', {})
    expect(status.ok).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(status.value, 'schedule')).toBe(false)
    const digao = await call(route, 'digao.status', {})
    expect(digao.ok).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(digao.value, 'schedule')).toBe(false)
  })
})
