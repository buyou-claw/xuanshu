/**
 * 票 12 · 安装面、控制器状态机与产物（契约 §2；S8 §7；注册面纪律 §0）
 *
 * 三块判据：
 *   ① **加性安装**：只注册一个 `shell.overlay` cell，不碰 root / children / priority，
 *      apply 期**不调** `ctx.layout.selectPanel`（S3 断言它恰一次且值为 overview）；
 *   ② **控制器状态机**：预览走 `preview:true`（**只算不写**），确认才真写；缓存按会话单一来源；
 *      失败落到可读 `error`（不静默）；
 *   ③ **产物与注册面**：提交的 `lib/client.js` 里真有这个 cell，且 `panel-surface.mjs`
 *      的单一事实来源认得它（`expectedCells()` 含 `shell.overlay\0xuanshu-mounts-drawer`）。
 *
 * 抓的真实缺陷/风险：
 *   ① 预览路径顺手写盘（用户点取消却已经改了清单）；
 *   ② 门厅的状态栏与抽屉各拉一次预览（两处数字可能不一样）；
 *   ③ 确认失败却把抽屉关了（用户看不到错误，也改不了）；
 *   ④ 手写注册面清单（本票只许改 `panel-surface.mjs`）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

import { EXTRA_REGISTRATIONS, PANEL_KEYS, expectedCells, expectedRegisterNames } from './lib/panel-surface.mjs'
import { createMountsController, installMounts } from '../../packages/xuanshu-client/src/client/mounts.tsx'
import { MOUNT_BOUNDARY_LINE } from '../../packages/xuanshu-client/src/client/mounts-model.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const ARTIFACT = join(REPO_ROOT, 'packages', 'xuanshu-client', 'lib', 'client.js')

const REACT_STUB = {
  Fragment: Symbol.for('react.fragment'),
  createElement: () => null,
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: () => ({ current: undefined }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

/** 记录型假 ctx（与票 10 的断言台同款形状）。 */
function recordingCtx() {
  const calls = []
  return {
    calls,
    ctx: {
      effect(callback) {
        const disposer = callback()
        return typeof disposer === 'function' ? disposer : () => {}
      },
      layout: {
        selectPanel(panelId) {
          calls.push({ kind: 'selectPanel', panelId })
        },
      },
      slots: {
        inject(name, callback) {
          calls.push({ kind: 'inject', name })
          callback()
          return () => {}
        },
        register(options, component) {
          calls.push({ kind: 'register', name: options?.name, options, component })
          return () => {}
        },
        entries() {
          return []
        },
      },
    },
  }
}

/** 记录型假数据面。 */
function fakeApi(answer) {
  const calls = []
  return {
    calls,
    api: {
      async setMounts(payload) {
        calls.push(payload)
        if (typeof answer === 'function') return answer(payload)
        return answer
      },
    },
  }
}

const WORKSPACES = [{ id: 'ws-print', path: 'E:\\work\\print-shop', title: '打印车间', sessionCount: 3, updatedAt: '2026-10-11T00:00:00.000Z' }]
const MOUNT = { kind: 'workspace', id: 'ws-print', label: '打印车间' }
const PREVIEW = { layers: [], totalChars: 100, keptChars: 100, budget: 60_000, truncatedChars: 0, keptLayers: 1, totalLayers: 1, notice: '披露', notes: [] }

describe('票 12 · 加性安装（只一个 shell.overlay cell）', () => {
  it('注册一个 `shell.overlay` cell（id=xuanshu-mounts-drawer），不碰 root/children/priority', () => {
    const { ctx, calls } = recordingCtx()
    const controller = installMounts(ctx, { api: fakeApi({ session: { sessionId: 's', mounts: [] } }).api, workspaces: () => WORKSPACES })
    expect(typeof controller.open).toBe('function')
    const registers = calls.filter((call) => call.kind === 'register')
    expect(registers).toHaveLength(1)
    expect(registers[0].name).toBe('shell.overlay')
    expect(registers[0].options).toEqual({ name: 'shell.overlay', id: 'xuanshu-mounts-drawer', inject: expect.any(Function) })
    expect(registers[0].options).not.toHaveProperty('root')
    expect(registers[0].options).not.toHaveProperty('children')
    expect(registers[0].options).not.toHaveProperty('priority')
    expect(registers[0].options).not.toHaveProperty('key')
    expect(registers[0].options).not.toHaveProperty('order')
    // 注入面就是控制器 + 工作区目录
    expect(Object.keys(registers[0].options.inject()).sort()).toEqual(['controller', 'workspaces'])
    expect(calls.filter((call) => call.kind === 'inject').map((call) => call.name)).toEqual(['shell.overlay'])
  })

  it('apply 期**不调** `ctx.layout.selectPanel`（默认面板语义只属于 overview）', () => {
    const { ctx, calls } = recordingCtx()
    installMounts(ctx, { api: fakeApi({ session: { sessionId: 's', mounts: [] } }).api, workspaces: () => [] })
    expect(calls.filter((call) => call.kind === 'selectPanel')).toEqual([])
  })

  it('当前环境确实没有 document（证明这条安装不是在 jsdom 里空转）', () => {
    expect(typeof document).toBe('undefined')
  })
})

describe('票 12 · 控制器：预览只算不写、确认才写', () => {
  it('open() 只发预览（每次都带 preview:true），绝不写盘', async () => {
    const fake = fakeApi({ session: { sessionId: 's', mounts: [] }, preview: PREVIEW })
    const controller = createMountsController({ api: fake.api, workspaces: () => WORKSPACES })
    controller.open('s', [])
    await new Promise((done) => setTimeout(done, 0))
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]).toEqual({ sessionId: 's', mounts: [], preview: true })
    expect(controller.snapshot().preview?.notice).toBe('披露')
    expect(controller.snapshot().open).toBe(true)
    expect(controller.cachedPreview('s')).toEqual(PREVIEW)
  })

  it('toggleWorkspace：选择变了就重读预览（仍然是 preview:true）', async () => {
    const fake = fakeApi({ session: { sessionId: 's', mounts: [] }, preview: PREVIEW })
    const controller = createMountsController({ api: fake.api, workspaces: () => WORKSPACES })
    controller.open('s', [])
    await new Promise((done) => setTimeout(done, 0))
    controller.toggleWorkspace(WORKSPACES[0])
    await new Promise((done) => setTimeout(done, 0))
    expect(controller.snapshot().selection).toEqual([MOUNT])
    expect(fake.calls.at(-1)).toEqual({ sessionId: 's', mounts: [MOUNT], preview: true })
    expect(fake.calls.every((call) => call.preview === true)).toBe(true)
  })

  it('confirm()：不带 preview 的真写；mounts 取应答里的权威值、revision +1、抽屉关闭', async () => {
    const fake = fakeApi((payload) => (payload.preview === true
      ? { session: { sessionId: 's', mounts: [] }, preview: PREVIEW }
      : { session: { sessionId: 's', mounts: [MOUNT] } }))
    const controller = createMountsController({ api: fake.api, workspaces: () => WORKSPACES })
    controller.open('s', [])
    controller.toggleWorkspace(WORKSPACES[0])
    await new Promise((done) => setTimeout(done, 0))
    await controller.confirm()
    const writes = fake.calls.filter((call) => call.preview !== true)
    expect(writes).toHaveLength(1)
    expect(Object.hasOwn(writes[0], 'preview'), '写入请求里不许出现 preview 键').toBe(false)
    expect(writes[0]).toEqual({ sessionId: 's', mounts: [MOUNT] })
    const snapshot = controller.snapshot()
    expect(snapshot.open).toBe(false)
    expect(snapshot.mounts).toEqual([MOUNT])
    expect(snapshot.revision).toBe(1)
  })

  it('写入失败：抽屉**不关**、错误可读（用户能改能重试）', async () => {
    const fake = fakeApi((payload) => {
      if (payload.preview === true) return { session: { sessionId: 's', mounts: [] }, preview: PREVIEW }
      throw new Error('这个工作区不在 DSH 的工作区清单里：打印车间')
    })
    const controller = createMountsController({ api: fake.api, workspaces: () => WORKSPACES })
    controller.open('s', [])
    controller.toggleWorkspace(WORKSPACES[0])
    await new Promise((done) => setTimeout(done, 0))
    await controller.confirm()
    expect(controller.snapshot().open).toBe(true)
    expect(controller.snapshot().busy).toBe(false)
    expect(controller.snapshot().error).toContain('不在 DSH 的工作区清单里')
    expect(controller.snapshot().revision).toBe(0)
  })

  it('预览失败：错误落到 error（不静默），不假装有数字', async () => {
    const fake = fakeApi(() => { throw new Error('DSH 文件服务（ctx.fs）不可得') })
    const controller = createMountsController({ api: fake.api, workspaces: () => WORKSPACES })
    controller.open('s', [])
    await new Promise((done) => setTimeout(done, 0))
    expect(controller.snapshot().error).toContain('ctx.fs')
    expect(controller.snapshot().preview).toBeUndefined()
  })

  it('宿主没返回 preview：给可读错误而不是编一份空账本', async () => {
    const fake = fakeApi({ session: { sessionId: 's', mounts: [] } })
    const controller = createMountsController({ api: fake.api, workspaces: () => WORKSPACES })
    controller.open('s', [])
    await new Promise((done) => setTimeout(done, 0))
    expect(controller.snapshot().error).toContain('没有返回预览')
    expect(controller.snapshot().preview).toBeUndefined()
  })

  it('预览缓存按会话单一来源：门厅 ensurePreview 命中缓存就不再发 RPC；清单变了才重读', async () => {
    const fake = fakeApi({ session: { sessionId: 's', mounts: [MOUNT] }, preview: PREVIEW })
    const controller = createMountsController({ api: fake.api, workspaces: () => WORKSPACES })
    controller.ensurePreview('s', [MOUNT])
    await new Promise((done) => setTimeout(done, 0))
    expect(fake.calls).toHaveLength(1)
    controller.ensurePreview('s', [MOUNT])
    await new Promise((done) => setTimeout(done, 0))
    expect(fake.calls, '同一份清单不该重复拉预览（门厅与抽屉共用一份）').toHaveLength(1)
    controller.ensurePreview('s', [MOUNT, { kind: 'workflow', id: 'wf-1', label: '排产' }])
    await new Promise((done) => setTimeout(done, 0))
    expect(fake.calls).toHaveLength(2)
    // 没有挂载的会话不拉预览（省一次目录读）
    controller.ensurePreview('other', [])
    await new Promise((done) => setTimeout(done, 0))
    expect(fake.calls).toHaveLength(2)
  })

  it('折叠是 H2 的按层记忆：toggle 一次就收起，新层不受影响', () => {
    const controller = createMountsController({ api: fakeApi({}).api, workspaces: () => [] })
    expect(controller.snapshot().fold.isOpen('workspace:ws-print')).toBe(true)
    controller.fold('workspace:ws-print')
    expect(controller.snapshot().fold.isOpen('workspace:ws-print')).toBe(false)
    expect(controller.snapshot().fold.isOpen('workspace:ws-x')).toBe(true)
  })
})

describe('票 12 · 注册面单一事实来源（panel-surface.mjs）', () => {
  it('expectedCells() 含抽屉 cell，且注册序里它紧跟 `consult` 那一对之后', () => {
    expect(expectedCells()).toContain('shell.overlay\u0000xuanshu-mounts-drawer')
    const names = expectedRegisterNames()
    // 每个 key 贡献 `main` + `sidebar.panellist` 两项，加上排在它后面的额外注册。
    const keyIndex = PANEL_KEYS.indexOf('consult')
    const extrasBefore = EXTRA_REGISTRATIONS.filter((entry) => PANEL_KEYS.indexOf(entry.after) < keyIndex).length
    const pairEnd = keyIndex * 2 + extrasBefore + 2;
    // 两个 `shell.overlay`：藏的那个在更前面，挂载账本的那个紧跟 consult 那一对。
    expect(names.indexOf('shell.overlay'), '藏抽屉应在挂载抽屉之前').toBeLessThan(pairEnd)
    expect(names[pairEnd], '挂载抽屉必须紧跟 consult 那一对').toBe('shell.overlay')
    expect(names[pairEnd - 1]).toBe('sidebar.panellist')
    // 两个 shell.overlay cell 并存，谁也没挤掉谁
    expect(names.filter((name) => name === 'shell.overlay')).toHaveLength(2)
    expect(expectedCells()).toContain('shell.overlay\u0000xuanshu-cang-drawer')
  })

  it('产出的 `lib/client.js` 里真有这个 cell 与边界句（不是只改了源码）', () => {
    const text = readFileSync(ARTIFACT, 'utf8')
    expect(text).toContain('xuanshu-mounts-drawer')
    expect(text).toContain(MOUNT_BOUNDARY_LINE)
    expect(text).toContain('consult.setMounts')
  })

  it('产物物化时只 require react（没有新的外部依赖）', () => {
    const loaded = []
    const requested = []
    const text = readFileSync(ARTIFACT, 'utf8')
    vm.runInNewContext(text, { window: { __ModuleLoader__: { load: (spec) => loaded.push(spec) } } }, { filename: ARTIFACT })
    expect(loaded).toHaveLength(1)
    const fakeRequire = (name) => {
      requested.push(name)
      if (name === 'react/jsx-runtime') return { Fragment: Symbol.for('react.fragment'), jsx: () => null, jsxs: () => null }
      if (name === 'react') return REACT_STUB
      throw new Error(`物化时出现未预期的 require(${JSON.stringify(name)})`)
    }
    expect(() => loaded[0].factory(fakeRequire)).not.toThrow()
    expect([...new Set(requested)].sort()).toEqual(['react', 'react/jsx-runtime'])
  })
})
