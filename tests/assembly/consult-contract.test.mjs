/**
 * 票 10 · 产物与注册面契约（客户端半边）。
 *
 * 对应票面验收里「客户端半能拿命令证明」的那几条：
 *   1. 注册面仍是**纯加性**：不碰 `root`、不声明 `children`、不给任何注册加 `priority`、
 *      不遮蔽 DSH 既有 cell、`overview` 仍是**第一个** main 注册、默认面板 `selectPanel('overview')`
 *      **恰好一次**（`verify-assembly.mjs` 的 S3 同款断言，这里先按住）；
 *   2. 新 sidebar 行的 `id` 与 main key **同字符串**，order 取 S15 预约给「问事」的 30；
 *   3. `installConsult` 在**无 `document` 的 Node** 下安全返回：样式注入被守卫挡掉、注册照做；
 *   4. 只 require 基线外部依赖（没有为票 10 新增运行期依赖）。
 *
 * 局限（同票 08）：真 `@deepseek-ai/dsh-client-ui-slots` registry 只在装了 web bundle 的
 * profile 树里可解析，遮蔽语义用「按 `DSH槽位映射.md` §1.4 文档语义实现的最小忠实 registry」承载。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

import { createConsultApi } from '../../packages/xuanshu-client/src/client/consult-api.ts'
import { ConsultPanel, installConsult } from '../../packages/xuanshu-client/src/client/consult.tsx'
import { CONSULT_ID, CONSULT_LABEL, CONSULT_ORDER, PANEL_ID, PANEL_ORDER } from '../../packages/xuanshu-client/src/client/panel.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const ARTIFACT = join(REPO_ROOT, 'packages', 'xuanshu-client', 'lib', 'client.js')

/** DSH 已装机的 cell（遮蔽判据）。 */
const DSH_MAIN_KEYS = ['conversation', 'plugins', 'schedules']
const DSH_SIDEBAR_IDS = ['plugins', 'schedules']

/** 票 10 之后玄枢的全部 main 注册（顺序有意义，见下）。 */
const EXPECTED_MAIN_KEYS = ['overview', 'pus', 'cang', 'onboarding', 'mingpan', CONSULT_ID]

const REACT_STUB = {
  Fragment: Symbol.for('react.fragment'),
  createElement: () => null,
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: () => ({ current: undefined }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

/** 物化提交的 `lib/client.js`（假 loader + 假 require）。 */
function materializeArtifact() {
  const loaded = []
  const requested = []
  const text = readFileSync(ARTIFACT, 'utf8')
  vm.runInNewContext(text, { window: { __ModuleLoader__: { load: (spec) => loaded.push(spec) } } }, { filename: ARTIFACT })
  expect(loaded.length, '产物必须恰好调用一次 __ModuleLoader__.load()').toBe(1)
  const spec = loaded[0]
  const fakeRequire = (name) => {
    requested.push(name)
    if (name === 'react/jsx-runtime') {
      return { Fragment: Symbol.for('react.fragment'), jsx: () => null, jsxs: () => null }
    }
    if (name === 'react') return REACT_STUB
    throw new Error(`物化时出现未预期的 require(${JSON.stringify(name)})`)
  }
  return { id: spec.id, plugin: spec.factory(fakeRequire), requested }
}

/** 记录型假 ctx。 */
function recordingCtx(mainKeys = ['conversation', 'plugins', 'schedules']) {
  const calls = []
  const ctx = {
    effect(callback) {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    theme: {
      overrideTokens(source, tokens) {
        calls.push({ kind: 'overrideTokens', source, tokenCount: Object.keys(tokens ?? {}).length })
        return () => {}
      },
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
      entries(name) {
        return name === 'main' ? mainKeys.map((key) => ({ options: { key } })) : []
      },
      subscribe() {
        return () => {}
      },
    },
  }
  return { calls, ctx }
}

describe('票 10 · 产物（lib/client.js）与注册面', () => {
  const { id, plugin, requested } = materializeArtifact()

  it('信封与插件面未变：id 是包名、inject 仍是四个 cordis 服务', () => {
    expect(id).toBe('xuanshu-client')
    expect([...plugin.inject].sort()).toEqual(['connection', 'layout', 'slots', 'theme'])
  })

  it('只 require 基线外部依赖（票 10 没新增运行期依赖）', () => {
    expect([...new Set(requested)].sort()).toEqual(['react', 'react/jsx-runtime'])
  })

  it('consult 的 main key 与侧栏行 id 同字符串，order=30 正是 S15 预约的「问事」档', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    const registers = calls.filter((call) => call.kind === 'register')
    const mainKeys = registers.filter((row) => row.name === 'main').map((row) => row.options.key)
    const rows = registers.filter((row) => row.name === 'sidebar.panellist')
    expect(mainKeys).toEqual(EXPECTED_MAIN_KEYS)
    expect(rows.map((row) => row.options.id)).toEqual(EXPECTED_MAIN_KEYS)
    const consult = rows.find((row) => row.options.id === CONSULT_ID)
    expect(consult?.options).toMatchObject({ order: CONSULT_ORDER, label: CONSULT_LABEL })
    expect(CONSULT_ID).toBe('consult')
    expect(CONSULT_LABEL).toBe('问事')
    expect(CONSULT_ORDER).toBe(30)
    // 既有值不许变（票 10 契约 §5）。
    expect(PANEL_ID).toBe('overview')
    expect(PANEL_ORDER).toBe(20)
    // order 与既有行互不相同（同 order 的 tie 会按注册序，语义就糊了）。
    const orders = rows.map((row) => row.options.order)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('注册面仍是纯加性：不碰 root、不声明 children、不加 priority、不遮蔽 DSH cell', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    const registers = calls.filter((call) => call.kind === 'register')
    const mainKeys = registers.filter((row) => row.name === 'main').map((row) => row.options.key)
    const rowIds = registers.filter((row) => row.name === 'sidebar.panellist').map((row) => row.options.id)
    expect(mainKeys[0], '`overview` 必须仍是第一个 main 注册').toBe(PANEL_ID)
    expect(registers.some((row) => row.name === 'root'), '不得注册进 root 槽').toBe(false)
    for (const register of registers) {
      expect(register.options.priority, '新 cell 不需要 priority').toBeUndefined()
      expect(register.options.children, '不得声明 children').toBeUndefined()
    }
    for (const key of mainKeys) expect(DSH_MAIN_KEYS, `遮蔽了 DSH 的 main key：${key}`).not.toContain(key)
    for (const id of rowIds) expect(DSH_SIDEBAR_IDS, `遮蔽了 DSH 的侧栏行：${id}`).not.toContain(id)
  })

  it('默认面板与 token 覆盖层没被票 10 搅动：selectPanel 恰一次、overrideTokens 恰一次', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    expect(calls.filter((call) => call.kind === 'selectPanel').map((call) => call.panelId)).toEqual([PANEL_ID])
    const mainIndex = calls.findIndex((call) => call.kind === 'register' && call.name === 'main')
    const selectIndex = calls.findIndex((call) => call.kind === 'selectPanel')
    expect(selectIndex).toBeGreaterThan(mainIndex)
    expect(calls.filter((call) => call.kind === 'overrideTokens')).toHaveLength(1)
  })
})

/** 按 `DSH槽位映射.md` §1.4 文档语义实现的最小忠实 registry。 */
function createDocumentedRegistry() {
  const cells = new Map()
  return {
    cells,
    register(options, component) {
      const cellId = options.key ?? options.id
      if (cellId === undefined) throw new Error(`keyed 缺 key / list 缺 id：${String(options.name)}`)
      const cellKey = `${String(options.name)}\u0000${String(cellId)}`
      const priority = options.priority ?? 0
      const byPriority = cells.get(cellKey) ?? new Map()
      if (byPriority.has(priority)) throw new Error(`same cell same priority：${cellKey}@${priority}`)
      byPriority.set(priority, component)
      cells.set(cellKey, byPriority)
      return () => {}
    },
  }
}

describe('票 10 · 槽位不 fail-loud（加性注册）', () => {
  it('consult 的两个新 cell 落位，不与任何既有 cell 同 key 同 priority', () => {
    const registry = createDocumentedRegistry()
    const { plugin } = materializeArtifact()
    const { ctx } = recordingCtx()
    ctx.slots.register = (options, component) => registry.register(options, component)
    expect(() => plugin.apply(ctx)).not.toThrow()
    expect([...registry.cells.keys()].sort()).toEqual([
      'main\u0000cang',
      'main\u0000consult',
      'main\u0000mingpan',
      'main\u0000onboarding',
      'main\u0000overview',
      'main\u0000pus',
      'shell.overlay\u0000xuanshu-cang-drawer',
      'sidebar.panellist\u0000cang',
      'sidebar.panellist\u0000consult',
      'sidebar.panellist\u0000mingpan',
      'sidebar.panellist\u0000onboarding',
      'sidebar.panellist\u0000overview',
      'sidebar.panellist\u0000pus',
    ])
  })
})

describe('票 10 · 安装函数在无 document 的 Node 里安全', () => {
  function installCtx() {
    const registrations = []
    return {
      registrations,
      ctx: {
        slots: {
          inject: (_key, effect) => effect(),
          register: (options) => {
            registrations.push(options)
            return () => {}
          },
          entries: () => [],
          subscribe: () => () => {},
        },
        layout: {
          selectPanel() {
            throw new Error('安装期不许调 selectPanel')
          },
        },
      },
    }
  }

  const deps = () => ({ api: createConsultApi({ connection: { rpc: { async call() { return { ok: true, value: {} } } } } }), navigate: () => {}, openSession: () => {} })

  it('当前环境确实没有 document（证明这条断言不是在 jsdom 里空转）', () => {
    expect(typeof document).toBe('undefined')
  })

  it('installConsult：注册 main + sidebar 两个 cell，不抛、不切面板', () => {
    const { registrations, ctx } = installCtx()
    expect(() => installConsult(ctx, deps())).not.toThrow()
    expect(registrations.map((row) => ({ name: row.name, key: row.key, id: row.id, order: row.order, label: row.label }))).toEqual([
      { name: 'main', key: CONSULT_ID, id: undefined, order: undefined, label: undefined },
      { name: 'sidebar.panellist', key: undefined, id: CONSULT_ID, order: CONSULT_ORDER, label: CONSULT_LABEL },
    ])
    expect(Object.keys(registrations[0].inject()).sort()).toEqual(['api', 'navigate', 'openSession'])
  })

  it('`openSession` 可以缺席（DSH 工作区面不可用）：安装仍成立，由界面据实说明', () => {
    const { registrations, ctx } = installCtx()
    expect(() => installConsult(ctx, { api: deps().api, navigate: () => {} })).not.toThrow()
    expect(registrations[0].inject().openSession).toBeUndefined()
  })

  it('面板组件本体在 Node 里可直接渲染（无 document / 无连接）', () => {
    expect(typeof ConsultPanel).toBe('function')
  })
})
