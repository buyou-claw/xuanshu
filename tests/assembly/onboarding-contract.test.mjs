/**
 * 票 08 · 产物与注册面契约（客户端半边）。
 *
 * 对应票面验收里「客户端半能拿命令证明」的那几条：
 *   1. 契约 §2 的六个 `bazi.*` 方法名**逐字一致**（含请求形状的透传）；
 *   2. 注册面仍是**纯加性**：不碰 `root`、不声明 `children`、不给任何注册加 `priority`、
 *      不遮蔽 DSH 既有 cell、`overview` 仍是**第一个** main 注册、默认面板 `selectPanel('overview')`
 *      **恰好一次**（`verify-assembly.mjs` 的 S3 也是这么断的，这里先把它按住）；
 *   3. 两条新 sidebar 行的 `id` 与 main key **同字符串**（行与面板配对的唯一依据）；
 *   4. `installOnboarding` / `installMingpan` 在**无 `document` 的 Node** 下安全返回：
 *      样式注入被守卫挡掉、注册面照做（否则产物物化断言就看不到注册形状了）。
 *
 * 为什么直接物化 `lib/client.js`：浏览器半边就是这份经典脚本，`dsh-client-modules` 原样送进浏览器；
 * 在 vm 里跑 factory + apply，走的就是运行时真实路径（与 `scripts/build-client.mjs` 的自检同法）。
 * 局限（诚实登记）：真 `@deepseek-ai/dsh-client-ui-slots` registry 只在装了 web bundle 的
 * profile 树里可解析，因此遮蔽语义用「按 `DSH槽位映射.md` §1.4 文档语义实现的最小忠实 registry」承载。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

import { PANEL_KEYS, expectedCells, expectedRegisterNames } from './lib/panel-surface.mjs'

import { BAZI_ENDPOINTS, createBaziApi } from '../../packages/xuanshu-client/src/client/bazi-api.ts'
import { createBaziUiController } from '../../packages/xuanshu-client/src/client/bazi-controller.ts'
import { installMingpan } from '../../packages/xuanshu-client/src/client/MingpanPanel.tsx'
import { installOnboarding } from '../../packages/xuanshu-client/src/client/onboarding.tsx'
import {
  CONSULT_ID,
  DIGAO_ID,
  MINGPAN_ID,
  MINGPAN_LABEL,
  MINGPAN_ORDER,
  ONBOARDING_ID,
  ONBOARDING_LABEL,
  ONBOARDING_ORDER,
  PANEL_ID,
  PANEL_ORDER,
  RIKKE_ID,
} from '../../packages/xuanshu-client/src/client/panel.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const ARTIFACT = join(REPO_ROOT, 'packages', 'xuanshu-client', 'lib', 'client.js')

/** DSH 已装机的 cell（遮蔽判据）：main key 与 sidebar.panellist id。 */
const DSH_MAIN_KEYS = ['conversation', 'plugins', 'schedules']
const DSH_SIDEBAR_IDS = ['plugins', 'schedules']

/*
 * 玄枢的注册面清单已收口到 `tests/assembly/lib/panel-surface.mjs`（单一事实来源）——
 * 此前每张票都要在几张契约测试里各改一遍穷举数组，票 07/08/10/13 已经各收过一次税。
 * 这里只断言「全部注册、纯加性、`overview` 在最前」，清单本体不在此维护。
 */

/* ───────────────────────── 产物物化（运行时真实路径） ───────────────────────── */

const REACT_STUB = {
  Fragment: Symbol.for('react.fragment'),
  createElement: () => null,
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: () => ({ current: undefined }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

/**
 * 物化提交的 `lib/client.js`：假 loader 拿信封、假 require 物化 factory。
 * @returns 插件对象与它请求过的外部依赖。
 */
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

/** 记录型假 ctx（只记录槽位/面板/token 调用，不 mock 业务）。 */
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

/* ───────────────────────── 1. 六个 RPC 方法名（契约 §2） ───────────────────────── */

describe('票 08 · 命盘数据面的方法名逐字对齐契约 §2', () => {
  it('六个方法名是契约表格那一列的原文', () => {
    expect(BAZI_ENDPOINTS).toEqual({
      status: 'bazi.status',
      snapshot: 'bazi.snapshot',
      basePu: 'bazi.basePu',
      cities: 'bazi.cities',
      timezone: 'bazi.timezone',
      cast: 'bazi.cast',
    })
  })

  it('每个方法都走 /xuanshu 通道，并原样透传请求体（含 confirmed 与 timeAlg 省缺）', async () => {
    const calls = []
    const ctx = {
      connection: {
        rpc: {
          async call(...args) {
            calls.push(args)
            return { ok: true, value: { state: 'empty' } }
          },
        },
      },
    }
    const api = createBaziApi(ctx)

    await api.status()
    await api.snapshot()
    await api.basePu()
    await api.cities({ query: 'shang', limit: 20 })
    await api.timezone({ lat: 31.2304, lon: 121.4737, date: '1990-06-01', time: '04:00' })
    await api.cast({ birth: { date: '1990-06-01', time: '04:00', zone: 'Asia/Shanghai', lat: 31.2304, lon: 121.4737 }, confirmed: true })

    expect(calls.map((call) => [call[0], call[1]])).toEqual([
      ['/xuanshu', 'bazi.status'],
      ['/xuanshu', 'bazi.snapshot'],
      ['/xuanshu', 'bazi.basePu'],
      ['/xuanshu', 'bazi.cities'],
      ['/xuanshu', 'bazi.timezone'],
      ['/xuanshu', 'bazi.cast'],
    ])
    expect(calls[3][2]).toEqual({ query: 'shang', limit: 20 })
    expect(calls[4][2]).toEqual({ lat: 31.2304, lon: 121.4737, date: '1990-06-01', time: '04:00' })
    expect(calls[5][2]).toEqual({
      birth: { date: '1990-06-01', time: '04:00', zone: 'Asia/Shanghai', lat: 31.2304, lon: 121.4737 },
      confirmed: true,
    })
  })

  it('RPC 失败时抛出（由调用方决定降级：卡级 error / 城市静默回落小库）', async () => {
    const ctx = { connection: { rpc: { async call() { return { ok: false, error: { message: '底座没起来' } } } } } }
    await expect(createBaziApi(ctx).status()).rejects.toThrow('底座没起来')
  })
})

/* ───────────────────────── 2. 产物与注册形状 ───────────────────────── */

describe('票 08 · 产物（lib/client.js）与注册面', () => {
  const { id, plugin, requested } = materializeArtifact()

  it('信封与插件面：id 是包名、apply/inject 齐备、cordis 服务注入未扩容', () => {
    expect(id).toBe('xuanshu-client')
    expect(typeof plugin.apply).toBe('function')
    expect([...plugin.inject].sort()).toEqual(['connection', 'layout', 'slots', 'theme'])
  })

  it('只 require 基线外部依赖（没有为票 08 新增运行期依赖）', () => {
    expect([...new Set(requested)].sort()).toEqual(['react', 'react/jsx-runtime'])
  })

  it('两条新 sidebar 行的 id 与 main key 同字符串，order / label 取自 panel.ts', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    const registers = calls.filter((call) => call.kind === 'register')
    const mainKeys = registers.filter((row) => row.name === 'main').map((row) => row.options.key)
    const rows = registers.filter((row) => row.name === 'sidebar.panellist')
    expect(mainKeys).toEqual(PANEL_KEYS)
    expect(rows.map((row) => row.options.id)).toEqual(PANEL_KEYS)
    const onboarding = rows.find((row) => row.options.id === ONBOARDING_ID)
    const mingpan = rows.find((row) => row.options.id === MINGPAN_ID)
    expect(onboarding?.options).toMatchObject({ order: ONBOARDING_ORDER, label: ONBOARDING_LABEL })
    expect(mingpan?.options).toMatchObject({ order: MINGPAN_ORDER, label: MINGPAN_LABEL })
    // 70 之后取位，不与 S15 六行表预约的 30 / 60 / 70 撞位。
    expect(ONBOARDING_ORDER).toBeGreaterThan(70)
    expect(MINGPAN_ORDER).toBeGreaterThan(ONBOARDING_ORDER)
    // 既有值不许变（契约 §7）。
    expect(PANEL_ID).toBe('overview')
    expect(PANEL_ORDER).toBe(20)
  })

  it('注册面仍是纯加性：不碰 root、不声明 children、不加 priority、不遮蔽 DSH cell', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    const registers = calls.filter((call) => call.kind === 'register')
    const mainKeys = registers.filter((row) => row.name === 'main').map((row) => row.options.key)
    const rowIds = registers.filter((row) => row.name === 'sidebar.panellist').map((row) => row.options.id)
    expect(mainKeys[0], '`overview` 必须仍是第一个 main 注册（默认面板与 S3 的 find(main) 都取首个）').toBe(PANEL_ID)
    expect(registers.some((row) => row.name === 'root'), '不得注册进 root 槽').toBe(false)
    for (const register of registers) {
      expect(register.options.priority, '新 cell 不需要 priority（加了反而像在遮蔽）').toBeUndefined()
      expect(register.options.children, '不得声明 children（槽位声明排他）').toBeUndefined()
    }
    for (const key of mainKeys) expect(DSH_MAIN_KEYS, `遮蔽了 DSH 的 main key：${key}`).not.toContain(key)
    for (const rowId of rowIds) expect(DSH_SIDEBAR_IDS, `遮蔽了 DSH 的侧栏行：${rowId}`).not.toContain(rowId)
  })

  it('默认面板与 token 覆盖层都没被票 08 搅动：selectPanel 恰一次、overrideTokens 恰一次', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    const selections = calls.filter((call) => call.kind === 'selectPanel')
    expect(selections.map((call) => call.panelId)).toEqual([PANEL_ID])
    const mainIndex = calls.findIndex((call) => call.kind === 'register' && call.name === 'main')
    const selectIndex = calls.findIndex((call) => call.kind === 'selectPanel')
    expect(selectIndex).toBeGreaterThan(mainIndex)
    expect(calls.filter((call) => call.kind === 'overrideTokens')).toHaveLength(1)
  })
})

/* ───────────────────────── 3. 遮蔽语义（文档语义的最小 registry） ───────────────────────── */

/** 按 `DSH槽位映射.md` §1.4 文档语义实现的最小忠实 registry（同 `overview-contract.test.mjs`）。 */
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

describe('票 08 · 槽位不 fail-loud（加性注册）', () => {
  it('票 08 的两个新 cell 落位，且不与任何既有 cell 同 key 同 priority', () => {
    const registry = createDocumentedRegistry()
    const { plugin } = materializeArtifact()
    const { ctx } = recordingCtx()
    ctx.slots.register = (options, component) => registry.register(options, component)
    expect(() => plugin.apply(ctx)).not.toThrow()
    expect([...registry.cells.keys()].sort()).toEqual(expectedCells())
  })
})

/* ───────────────────────── 4. 非 DOM 环境安全 ───────────────────────── */

describe('票 08 · 安装函数在无 document 的 Node 里安全', () => {
  /** 只提供 `slots` 的最小 ctx（`layout` 故意不给：安装期不许用它）。 */
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
        // apply 期若误用 layout，这里会抛（也顺便证明「安装期不切面板」）。
        layout: {
          selectPanel() {
            throw new Error('安装期不许调 selectPanel')
          },
        },
      },
    }
  }

  const deps = () => ({ api: {}, controller: createBaziUiController(), navigate: () => {} })

  it('当前环境确实没有 document（证明这条断言不是在 jsdom 里空转）', () => {
    expect(typeof document).toBe('undefined')
  })

  it('installOnboarding：注册 main+sidebar 两个 cell，不抛、不切面板', () => {
    const { registrations, ctx } = installCtx()
    expect(() => installOnboarding(ctx, deps())).not.toThrow()
    expect(registrations.map((row) => ({ name: row.name, key: row.key, id: row.id, order: row.order }))).toEqual([
      { name: 'main', key: ONBOARDING_ID, id: undefined, order: undefined },
      { name: 'sidebar.panellist', key: undefined, id: ONBOARDING_ID, order: ONBOARDING_ORDER },
    ])
    // 注入面必须带上数据面 / 控制器 / 导航：向导全靠这三样。
    expect(Object.keys(registrations[0].inject()).sort()).toEqual(['api', 'controller', 'navigate'])
  })

  it('installMingpan：注册 main+sidebar 两个 cell，不抛、不切面板', () => {
    const { registrations, ctx } = installCtx()
    expect(() => installMingpan(ctx, deps())).not.toThrow()
    expect(registrations.map((row) => ({ name: row.name, key: row.key, id: row.id, order: row.order }))).toEqual([
      { name: 'main', key: MINGPAN_ID, id: undefined, order: undefined },
      { name: 'sidebar.panellist', key: undefined, id: MINGPAN_ID, order: MINGPAN_ORDER },
    ])
  })
})
