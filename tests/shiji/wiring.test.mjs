/**
 * 票 05（#26）· 装配接线（契约 §1）
 *
 * 走**真** `apply()` 与**真** `installRpc`（宿主 ctx 是替身）：
 *   - `shiji.*` 六个方法挂在同一条 `/xuanshu` 通道上，且是**独立方法组**（`digao.*` 仍是三个）；
 *   - `digao.refresh` 会把事记扫描带进**同一条管线**（一次刷新同时落 `shiji.jsonl` 与底稿两件）；
 *   - 没有 `workspaceRegistry` / 会话服务时装配照常完成（事记方法仍在，只是账本为空）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { apply } from '../../packages/xuanshu-host/lib/index.js'
import { fakeAgents } from '../digao/lib/sandbox.mjs'
import { fakeLlm, fakeProjectionCache, fakeSessionQuery, fakeWorkspaceRegistry, makeSandbox, readJsonl, seedProject, userEvent } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 宿主替身：只实现 `apply()` 真会碰的能力（与票 13 的接线用例同款）。 */
function makeHost({ services = {} } = {}) {
  const routes = []
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
    provide() {
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
  return { host, routes }
}

function call(route, method, payload = {}) {
  return route.handler(method, payload, new AbortController().signal)
}

/** 装配一次（真 apply）。 */
function assemble({ services = {} } = {}) {
  const sandbox = makeSandbox('t05-wiring')
  roots.push(sandbox)
  services.agents = fakeAgents()
  const { host, routes } = makeHost({ services })
  apply(host, { dataDir: sandbox.dataDir, autoStart: false })
  expect(routes).toHaveLength(1)
  return { sandbox, route: routes[0] }
}

describe('票05 · shiji.* 挂上同一条通道（独立方法组）', () => {
  it('shiji.list / settings.get / settings.set 可调；digao.* 仍是三个、digao.write 不存在', async () => {
    const { route } = assemble()
    expect(route.path).toBe('/xuanshu')

    const listed = await call(route, 'shiji.list', {})
    expect(listed.ok).toBe(true)
    expect(listed.value).toEqual({ entries: [] })

    const settings = await call(route, 'shiji.settings.get', {})
    expect(settings.ok).toBe(true)
    expect(settings.value).toEqual({ excludedDirs: [] })
    const set = await call(route, 'shiji.settings.set', { excludedDirs: ['docs/private'] })
    expect(set.ok).toBe(true)
    expect(set.value).toEqual({ ok: true, excludedDirs: ['docs/private'] })

    for (const method of ['digao.status', 'digao.read', 'digao.refresh']) {
      expect((await call(route, method, {})).ok, `${method} 没挂上通道`).toBe(true)
    }
    for (const method of ['digao.write', 'digao.update', 'digao.delete']) {
      const response = await call(route, method, {})
      expect(response.ok).toBe(false)
      expect(response.error.message).toMatch(/未知玄枢操作/u)
    }
    // 事记的写操作要人确认：通道上少 confirmed 也是可读拒绝（不是 500 / 静默成功）。
    const denied = await call(route, 'shiji.remove', { id: 'shiji-ffffffffffffffff' })
    expect(denied.ok).toBe(true)
    expect(denied.value).toMatchObject({ ok: false, error: { code: 'confirmation-required' } })
  })

  it('digao.refresh 走同一条管线：一次刷新同时落 shiji.jsonl（事记）与 digao.md/json', async () => {
    const sandbox = makeSandbox('t05-wiring-pipeline')
    roots.push(sandbox)
    const projectRoot = seedProject(sandbox, 'xuan', { docs: { 'README.md': '# XuanShu\n在做玄枢。' } })
    const registry = fakeWorkspaceRegistry([{ id: 'w1', path: projectRoot, title: 'XuanShu', createdAt: '2026-10-10T00:00:00.000Z', sessionIds: ['s1'] }])
    const query = fakeSessionQuery({ headers: { s1: { createdAt: Date.parse('2026-10-01T00:00:00.000Z') } }, events: { s1: [userEvent(1, '事记怎么接？', Date.parse('2026-10-16T00:00:00.000Z'))] } })
    const cache = fakeProjectionCache({ s1: { title: '事记怎么接', lastPromptAt: Date.parse('2026-10-16T00:00:00.000Z') } })
    const services = {
      agents: fakeAgents(),
      workspaceRegistry: registry.service,
      sessionQuery: query.service,
      sessionProjectionCache: cache.service,
      llm: fakeLlm({ text: '在做玄枢。' }),
    }
    const { host, routes } = makeHost({ services })
    apply(host, { dataDir: sandbox.dataDir, autoStart: false })
    const route = routes[0]

    const refreshed = await call(route, 'digao.refresh', {})
    expect(refreshed.ok, JSON.stringify(refreshed)).toBe(true)
    expect(sandbox.exists('shiji.jsonl')).toBe(true)
    expect(sandbox.exists('digao.md')).toBe(true)
    expect(sandbox.exists('digao.json')).toBe(true)

    const entries = readJsonl(sandbox.path('shiji.jsonl'))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ schema: 'xuanshu/shiji@1', source: 'workspace', refId: 'w1', basis: { sessions: 1, docs: 1 } })

    // 再走一次 shiji.list：同一条（不新增）。
    const listed = await call(route, 'shiji.list', {})
    expect(listed.value.entries).toHaveLength(1)
    expect(listed.value.entries[0].id).toBe(entries[0].id)
  })

  it('没有 workspaceRegistry / 会话服务时装配照常：shiji.list 给空账本，refresh 仍落底稿', async () => {
    const { sandbox, route } = assemble()
    expect((await call(route, 'shiji.list', {})).value).toEqual({ entries: [] })
    const refreshed = await call(route, 'digao.refresh', {})
    expect(refreshed.ok).toBe(true)
    expect(sandbox.exists('digao.md')).toBe(true)
    // 没工作区 = 没有依据；写空账本（一条一行都没有），但不报错。
    expect(readJsonl(sandbox.path('shiji.jsonl'))).toEqual([])
  })
})
