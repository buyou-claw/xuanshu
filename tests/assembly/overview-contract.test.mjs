/**
 * 票 07 · UI 槽位契约测试（首页替换 = 自我总览四卡）。
 *
 * 对应票验收四条（`.scratch/assembly-foundation/issues/07-home-overview-four-cards.md`）：
 *   1. 首屏 = 自我总览：main key `overview` + sidebar 行 `overview` + **默认面板** + 遮蔽不报错
 *      → 「产物物化」与「槽位遮蔽语义」两组；`conversation` 面板不受影响（纯加性断言）。
 *   2. 四卡渲染（命盘只读 / 日课 / 底稿 / 快捷入口）→ 「四卡渲染」组（逐条对照 S1 §3/§6/§9）。
 *   3. UI 槽位契约测试绿：本文件。
 *   4. 工作区 / 项目保持 DSH 原样 → 「只注册两个 cell、不碰 root / children」断言（装配级由 S1–S5 兜底）。
 *
 * 为什么能直接断言**已提交的产物**（`packages/xuanshu-client/lib/client.js`）：
 *   浏览器半边就是经典脚本，`dsh-client-modules` 原样送进浏览器 —— 在 vm 里物化
 *   factory、拿假 ctx 调 apply，走的就是运行时真实路径（同 `scripts/build-client.mjs` 与
 *   `scripts/verify-assembly.mjs` 的 S3④）。组件渲染断言则直接 import `src/client/*.tsx`
 *   （vite 原生 esbuild 变换；`vitest.config.mjs` 里 `esbuild.jsx = automatic`）。
 *
 * 环境无关性：本文件不装 profile、不起 CLI、不联网；`lib/client.js` 是仓库提交物。
 * 遮蔽语义的局限（诚实登记）：真 `@deepseek-ai/dsh-client-ui-slots` registry 只在装了
 *   web bundle 的 profile 树里可解析（票 07 · xs-web 落地后），且其入口是浏览器信封形态；
 *   本文件因此用「按 `DSH槽位映射.md` §1.4 文档语义实现的最小忠实 registry」承载
 *   「我们的注册不触发 fail-loud」这一断言，并自带一条 fail-loud 自检证明该规则真的生效。
 *   真 registry 的验证落在 web 冒烟与装配 seam（S1–S5）上，不在这里假装跑过。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { PANEL_KEYS, expectedCells, expectedRegisterNames } from './lib/panel-surface.mjs'
import { installRpcFetch, restoreRpcFetch } from './lib/rpc-fetch.mjs'

// 数据面是同源 fetch（`POST /api/xuanshu`），桩装在 fetch 上；漏还原会污染后面的文件。
afterEach(restoreRpcFetch)

import { OverviewPanel } from '../../packages/xuanshu-client/src/client/OverviewPanel.tsx'
import {
  XsDestinyCard,
  XsDigaoCard,
  XsQuickLinks,
  XsRikkeCard,
} from '../../packages/xuanshu-client/src/client/cards.tsx'
import { PANEL_ID, PANEL_ORDER } from '../../packages/xuanshu-client/src/client/panel.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const ARTIFACT = join(REPO_ROOT, 'packages', 'xuanshu-client', 'lib', 'client.js')

/** DSH 已装机的 cell（遮蔽判据）：main key 与 sidebar.panellist id。 */
const DSH_MAIN_KEYS = ['conversation', 'plugins', 'schedules']
const DSH_SIDEBAR_IDS = ['plugins', 'schedules']

/* ───────────────────────── 产物物化（运行时真实路径） ───────────────────────── */

/** 假 react：apply 期不渲染，只要成员在（与 `scripts/build-client.mjs` 的假 require 同法）。 */
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
 *
 * `fetch` 必须显式放进沙箱：`vm.runInNewContext` 给的是一个**独立全局**，`8fdaa4b` 之后
 * 数据面走同源 fetch，产物在 apply 期会调 `fetch('/api/xuanshu')` —— 浏览器里它是真全局，
 * 这里就得在沙箱里补一个（转发到**当下**的 `globalThis.fetch`，于是 `lib/rpc-fetch.mjs`
 * 装的夹具对产物同样生效；转发而不是直接给引用，是为了让同一文件里的 `setHandler` 也管用）。
 *
 * @returns 插件对象与它请求过的外部依赖。
 */
function materializeArtifact() {
  const loaded = []
  const requested = []
  const text = readFileSync(ARTIFACT, 'utf8')
  vm.runInNewContext(
    text,
    {
      window: { __ModuleLoader__: { load: (spec) => loaded.push(spec) } },
      fetch: (...args) => globalThis.fetch(...args),
    },
    { filename: ARTIFACT },
  )
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

/**
 * 记录型假 ctx：只记录槽位/面板/token 的调用，不 mock 业务。
 * @param mainKeys - `ctx.slots.entries('main')` 要报的已注册面板键（默认含 conversation）。
 */
function recordingCtx(mainKeys = ['conversation', 'plugins', 'schedules']) {
  const calls = []
  const ctx = {
    effect(callback) {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    theme: {
      overrideTokens(source, tokens) {
        calls.push({
          kind: 'overrideTokens',
          source,
          tokenCount: tokens === null || typeof tokens !== 'object' ? 0 : Object.keys(tokens).length,
        })
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

/* ───────────────────────── 渲染工具（无 JSX：测试文件是 .mjs） ───────────────────────── */

/** 稳定 watch：快照为排序后的常量数组（满足 `Object.is` 比较要求）。 */
function watchOf(keys) {
  const snapshot = [...keys].sort()
  return { subscribe: () => () => {}, getSnapshot: () => snapshot }
}

/** 面板/卡片的注入面（07 不接任何回调 → 写路径全部置灰，见契约注记 §4）。 */
function injected(mainKeys = ['conversation', 'overview', 'plugins', 'schedules']) {
  return { navigate: () => {}, mainPanels: watchOf(mainKeys) }
}

/** 渲染为静态 HTML 文本。 */
function render(element) {
  return renderToStaticMarkup(element)
}

/** 按 `data-xuanshu-card` 切出单卡的 HTML 片段（section 不嵌套，第一个 </section> 即边界）。 */
function cardOf(html, name) {
  const start = html.indexOf(`data-xuanshu-card="${name}"`)
  expect(start, `四卡里没有 ${name}`).toBeGreaterThanOrEqual(0)
  const end = html.indexOf('</section>', start)
  return html.slice(start, end === -1 ? undefined : end)
}

/** 数一个字符串在 HTML 里出现几次（D-002 问的是「一屏有几个」）。 */
function countOf(html, needle) {
  return html.split(needle).length - 1
}

/**
 * 取某个动作按钮的**完整开始标签**（`<button …>`）。
 *
 * 为什么不从 `data-xuanshu-action` 起切：`class` 排在 `data-*` **之前**，从属性起切会漏掉类名，
 * 而这张票要断言的正是类名（主/次权重）。所以回到最近的 `<button` 再切到 `>`。
 */
function buttonTagOf(html, action) {
  const marker = `data-xuanshu-action="${action}"`
  const at = html.indexOf(marker)
  expect(at, `没有按钮：${action}`).toBeGreaterThanOrEqual(0)
  return html.slice(html.lastIndexOf('<button', at), html.indexOf('>', at) + 1)
}

/* ───────────────────────── 1. 首屏 / 默认面板 / 纯加性 ───────────────────────── */

describe('票 07 · 首屏 = 自我总览（产物物化）', () => {
  const { id, plugin, requested } = materializeArtifact()

  it('信封与插件面：id 是包名、apply/inject 齐备', () => {
    expect(id).toBe('xuanshu-client')
    expect(typeof plugin.apply).toBe('function')
    expect(Array.isArray(plugin.inject)).toBe(true)
  })

  it('cordis 服务注入含 slots / layout / theme / connection（默认面板、token 覆盖层与谱藏 RPC 的前置）', () => {
    // `connection` 是总装配（票 09 谱 / 票 14 藏）加进来的：面板的 RPC 走
    // `dsh-client-connection` 的 `ctx.provide("connection", …)`（`…/dsh-client-connection/lib/client.js:1477`）。
    expect([...plugin.inject].sort()).toEqual(['connection', 'layout', 'slots', 'theme'])
  })

  it('只 require 基线外部依赖（react / react/jsx-runtime）', () => {
    expect([...new Set(requested)].sort()).toEqual(['react', 'react/jsx-runtime'])
  })

  it('main 注册 key=overview、sidebar 行 id=overview、行 order=20', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    const main = calls.find((call) => call.kind === 'register' && call.name === 'main')
    const row = calls.find((call) => call.kind === 'register' && call.name === 'sidebar.panellist')
    expect(main?.options?.key).toBe(PANEL_ID)
    expect(row?.options?.id).toBe(PANEL_ID)
    expect(row?.options?.order).toBe(PANEL_ORDER)
    expect(row?.options?.label).toBe('总览')
  })

  it('默认面板：selectPanel("overview") 恰一次，且在 main 注册之后', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    const selections = calls.filter((call) => call.kind === 'selectPanel')
    expect(selections.map((call) => call.panelId)).toEqual(['overview'])
    const mainIndex = calls.findIndex((call) => call.kind === 'register' && call.name === 'main')
    const selectIndex = calls.findIndex((call) => call.kind === 'selectPanel')
    expect(selectIndex, 'selectPanel 必须晚于 main 注册（对未注册 key 会 throw）').toBeGreaterThan(mainIndex)
  })

  it('token 覆盖层：overrideTokens("xuanshu-ui-v1", 非空) 恰一次', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    const overrides = calls.filter((call) => call.kind === 'overrideTokens')
    expect(overrides).toHaveLength(1)
    expect(overrides[0].source).toBe('xuanshu-ui-v1')
    expect(overrides[0].tokenCount).toBeGreaterThan(90)
  })

  it('四卡注入面：inject 提供 navigate 与 mainPanels watch', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    const main = calls.find((call) => call.kind === 'register' && call.name === 'main')
    expect(typeof main?.options?.inject).toBe('function')
    const provided = main.options.inject()
    expect(typeof provided.navigate).toBe('function')
    expect(typeof provided.mainPanels.getSnapshot).toBe('function')
    expect(typeof provided.mainPanels.subscribe).toBe('function')
    expect(provided.mainPanels.getSnapshot()).toEqual(['conversation', 'plugins', 'schedules'])
  })

  it('导航语义（V94）：conversation → selectPanel(null)；未注册的 main key 被挡住', () => {
    const { calls, ctx } = recordingCtx(['conversation'])
    plugin.apply(ctx)
    const main = calls.find((call) => call.kind === 'register' && call.name === 'main')
    const { navigate } = main.options.inject()
    navigate('conversation')
    expect(calls.filter((call) => call.kind === 'selectPanel').map((call) => call.panelId)).toEqual([
      'overview', // apply 期的默认面板
      null, // 工作区 = 回 DSH 原面板（V94）
    ])
    // 未注册目标：navigate 内部再挡一次（渲染层也已置灰）
    navigate('consult')
    expect(calls.filter((call) => call.kind === 'selectPanel')).toHaveLength(2)
  })

  it('纯加性 + 工作区原样：玄枢只加自己的 cell、无 priority、不碰 root/children、不遮蔽 DSH cell', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    const registers = calls.filter((call) => call.kind === 'register')
    // 总装配后的完整注册面：overview（票 07）、pus（票 09）、cang（票 14）、
    // onboarding + mingpan（票 08）+ 藏登记浮层 + digao + rikke（票 13）。
    // **只扩容期望数组，断言语义未变**：票 08 的两个 key 是纯加性追加（在 cang 之后），
    // 票 13 的两个 key 同样是纯加性追加（在 mingpan 之后）——不遮蔽、不加 priority、不声明 children。
    // 顺序有意义：overview 必须仍是**第一个** main 注册（默认面板与 S3 的 `find('main')` 都取首个）。
    const mainKeys = registers.filter((r) => r.name === 'main').map((r) => r.options.key)
    const rowIds = registers.filter((r) => r.name === 'sidebar.panellist').map((r) => r.options.id)
    // 注册面的**单一事实来源**是 `tests/assembly/lib/panel-surface.mjs`；这里不再手写清单，
    // 否则每加一个面板都要在两张契约测试里各改一遍（票 07/08/10/13 已经各收过一次税）。
    expect(mainKeys).toEqual(PANEL_KEYS)
    // 「每个侧栏行 id 必须与某个 main key 同字符串」是行与面板配对的唯一依据。
    expect(rowIds).toEqual(mainKeys)
    expect(registers.map((r) => r.name)).toEqual(expectedRegisterNames())
    expect(registers.some((call) => call.name === 'root'), '不得注册进 root 槽（single 槽会单独占满整页）').toBe(false)
    for (const register of registers) {
      expect(register.options.priority, '新 cell 不需要 priority（加了反而像在遮蔽）').toBeUndefined()
      expect(register.options.children, '不得声明 children（槽位声明排他，main.conversation 已由 ui-conversation 声明）').toBeUndefined()
    }
    for (const key of mainKeys) expect(DSH_MAIN_KEYS, `遮蔽了 DSH 的 main key：${key}`).not.toContain(key)
    for (const id of rowIds) expect(DSH_SIDEBAR_IDS, `遮蔽了 DSH 的侧栏行：${id}`).not.toContain(id)
  })
})

/* ───────────────────────── 2. 槽位遮蔽语义（加性 vs fail-loud） ───────────────────────── */

/**
 * 按 `docs/design/ui-v1/shared/DSH槽位映射.md` §1.4 文档语义实现的最小忠实 registry：
 *   - cell 粒度：`single`/`keyed` 按 key、`list` 按 id；
 *   - 同 cell 同 priority 再注册 → throw（fail-loud）；不同 priority 共存（数值小者渲染）；
 *   - 不同 id 加性。
 * 证据行：`@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:577-583, 764-791`。
 */
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
      if (byPriority.has(priority)) {
        throw new Error(`same cell same priority：${cellKey}@${priority}（文档语义：fail-loud）`)
      }
      byPriority.set(priority, component)
      cells.set(cellKey, byPriority)
      return () => {}
    },
  }
}

describe('票 07 · 槽位遮蔽不 fail-loud（加性注册）', () => {
  it('玄枢的全部注册落在按文档语义实现的 registry 上，不触发 fail-loud，每个 cell 都落位', () => {
    const registry = createDocumentedRegistry()
    const { plugin } = materializeArtifact()
    const { ctx } = recordingCtx()
    // 把 register 换成文档语义 registry：任何「同 cell 同 priority」都会抛。
    ctx.slots.register = (options, component) => registry.register(options, component)
    expect(() => plugin.apply(ctx)).not.toThrow()
    expect([...registry.cells.keys()].sort()).toEqual(expectedCells())
  })

  it('registry 的 fail-loud 是活的（自检桩本身）：同 cell 同 priority 二次注册必须 throw', () => {
    const registry = createDocumentedRegistry()
    registry.register({ name: 'main', key: 'overview' }, () => null)
    expect(() => registry.register({ name: 'main', key: 'overview' }, () => null)).toThrow()
    // 显式不同 priority：正常遮蔽（数值小者渲染），不 throw。
    expect(() => registry.register({ name: 'main', key: 'overview', priority: -1 }, () => null)).not.toThrow()
    // 不同 key：加性，不 throw。
    expect(() => registry.register({ name: 'main', key: 'consult' }, () => null)).not.toThrow()
  })
})

/* ───────────────────────── 3. 五卡渲染（冷启动） ───────────────────────── */

describe('票 07 · 五卡渲染（冷启动空态；#25 加第 5 张晚省）', () => {
  // R3：页眉那行路径的来源是**宿主回传的 dataDir**。这里按生产形状给一个真值，
  // 不再把中性占位（「玄枢数据目录/」）当成产品文案断言 —— 占位是「宿主没回传」时的降级。
  const HOST_DATA_DIR = 'D:\\xuanshu-home\\xuanshu'
  const html = render(h(OverviewPanel, { ...injected(), dataDir: HOST_DATA_DIR, today: '2026-10-13' }))

  it('面板壳与页头：overview 根、家 · 自我总览、宿主回传的本地数据路径（C11）', () => {
    expect(html).toContain('data-xuanshu-panel="overview"')
    expect(html).toContain('自我总览')
    expect(html).toContain('家')
    expect(html).toContain(`数据都在本地 ${HOST_DATA_DIR}\\`)
    expect(html).not.toContain('数据都在本地（玄枢数据目录/）')
  })

  it('五卡齐备且 DOM 顺序 = D3 读序（命盘 → 日课 → 底稿 → 快捷入口 → 晚省）', () => {
    const order = ['mingpan', 'rike', 'digao', 'quicklinks', 'wansheng'].map((name) => html.indexOf(`data-xuanshu-card="${name}"`))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('① 命盘卡只读：徽标逐字、零输入控件、空态唯一主行动（C1）', () => {
    const card = cardOf(html, 'mingpan')
    expect(card).toContain('data-xs-state="empty"')
    expect(card).toContain('命盘 / 八字')
    expect(card).toContain('只读 · 由出生信息与底座生成')
    expect(card).toContain('底座还没立起来')
    expect(card).toContain('填一次出生信息，命盘就点亮了。')
    expect(card).toContain('开始填写出生信息 -&gt;')
    // C1①：卡内没有任何输入控件（input / select / textarea / switch）。
    expect(card).not.toMatch(/<input|<select|<textarea/)
    expect(card).not.toContain('role="switch"')
    // 07 冷启动：向导未装配 → 主行动置灰并给出理由，不移除节点。
    expect(card).toContain('data-xuanshu-action="start-onboarding"')
    expect(card).toContain('disabled')
    expect(card).toContain('八字冷启动向导还没装配（属票 08）')
  })

  it('② 日课卡：卡头带今天日期、宜/忌/流日空态文案、[立即生成] 与 [改时间]', () => {
    const card = cardOf(html, 'rike')
    expect(card).toContain('日课 · 今天 2026-10-13')
    expect(card).toContain('今天还没有生成日课。日课默认每天 07:30 生成。')
    expect(card).toContain('（底座未立时生成会失败）')
    expect(card).toContain('data-xuanshu-action="generate-rikke"')
    expect(card).toContain('日课生成还没接上（属票 13 · 底稿与日课）')
    // [改时间 ->] 的目标是 DSH 原 schedules 面板：已注册 → 可用。
    expect(card).toContain('data-xuanshu-nav="schedules"')
    const changeTime = card.slice(card.indexOf('data-xuanshu-nav="schedules"'), card.indexOf('>', card.indexOf('data-xuanshu-nav="schedules"')))
    expect(changeTime).not.toContain('disabled')
  })

  it('③ 底稿卡：纯派生徽标逐字、冷启动无 [刷新] / 无 [打开底稿]（C2 + S4 差异）', () => {
    const card = cardOf(html, 'digao')
    expect(card).toContain('纯派生 · 不可手改')
    expect(card).toContain('底座未立，还没有可提炼的来源。')
    expect(card).toContain('这里不会先有内容：提炼源是 0。')
    expect(card).toContain('data-xuanshu-action="start-onboarding"')
    expect(card, '冷启动空态不提供 [刷新]').not.toContain('data-xuanshu-action="refresh-digao"')
    expect(card, '冷启动空态不提供 [打开底稿]').not.toContain('data-xuanshu-nav="digao"')
  })

  it('④ 快捷入口：三格 + 边界句 + 底座未立副标题；问事/工作流置灰、工作区可用（C6 / §6④）', () => {
    const card = cardOf(html, 'quicklinks')
    expect(card).toContain('data-xs-state="ready"')
    for (const target of ['consult', 'conversation', 'workflow']) {
      expect(card).toContain(`data-xuanshu-nav="${target}"`)
    }
    expect(card).toContain('问事')
    expect(card).toContain('工作区')
    expect(card).toContain('工作流')
    expect(card).toContain('底座未立 · 也能空手先问一句')
    // 2026-11-01：原文是「在侧栏「库」与设置里」，但侧栏没有「库」这个分区（十行平铺，
    // 谱 / 藏 各自独立注册），「定时任务」的实名是「自动化任务」。导航名必须指得到实体。
    expect(card).toContain('谱 / 藏 / 自动化任务是管理入口：都在侧栏，不在这张卡里。')
    // 未注册的 consult / workflow 置灰 + 理由；工作区（conversation）可用。
    expect(card).toContain('问事面板还没装配（属票 10 · 问事闭环）')
    expect(card).toContain('工作流面板还没装配（属票 16 · 工作流创建向导）')
    const workspaceStart = card.indexOf('data-xuanshu-nav="conversation"')
    const workspaceTag = card.slice(workspaceStart, card.indexOf('>', workspaceStart))
    expect(workspaceTag).not.toContain('disabled')
  })

  it('⑤ 晚省卡（#25）：默认 21:30 的空态文案、[立即生成] 与 [改时间]；点开进问事（卡上给出口）', () => {
    const card = cardOf(html, 'wansheng')
    expect(card).toContain('data-xs-state="empty"')
    expect(card).toContain('晚省 · 今天 2026-10-13')
    expect(card).toContain('今天还没有晚省。晚省默认每天 21:30 生成。')
    expect(card).toContain('（它只摆事实、不替你下结论；点开进问事）')
    expect(card).toContain('data-xuanshu-action="generate-wansheng"')
    expect(card).toContain('晚省生成还没接上（属票 04 · 晚间触达）')
    expect(card).toContain('data-xuanshu-nav="schedules"')
    // 「补」徽标是 ready 态的事实，不在空态出现（不冒充生成过）。
    expect(card).not.toContain('data-xuanshu-badge="missed"')
  })

  it('#64 · 冷启动一屏只有一个主操作（D-002）：命盘卡领主权重，底稿卡同动作降为次要、按钮仍在', () => {
    // 判据 D-002 问的是「任一时刻一屏可见的主操作 ≤1」，与「哪张卡」无关；
    // 而「两个按钮都还在、动作名不变」是这张票的另一半 —— 降级只改视觉权重，不改功能。
    expect(countOf(html, 'xs-btn--primary'), '冷启动门厅只能有一个主操作').toBe(1)
    // 读序第一张卡（命盘）占主权重：冷启动的主要目的就是「去填一次出生信息」。
    expect(buttonTagOf(cardOf(html, 'mingpan'), 'start-onboarding')).toContain('xs-btn--primary')
    // 底稿卡是同一个动作的第二个入口：功能留着，权重降一档（次要按钮）。
    const digaoStart = buttonTagOf(cardOf(html, 'digao'), 'start-onboarding')
    expect(digaoStart, '底稿卡的同一动作降为次要按钮').not.toContain('xs-btn--primary')
    expect(digaoStart, '降级后仍是按钮类，不是换了标签').toContain('xs-btn')
    // 功能不变：动作名与文案逐字相同，点下去仍是同一件事。
    expect(digaoStart).toContain('data-xuanshu-action="start-onboarding"')
    expect(cardOf(html, 'digao')).toContain('开始填写出生信息 -&gt;')
  })

  it('fail-soft 是结构性的：目标装配后（快照含 consult/workflow）两格自动点亮', () => {
    const future = render(
      h(OverviewPanel, {
        ...injected(['conversation', 'consult', 'workflow', 'overview', 'plugins', 'schedules']),
        today: '2026-10-13',
      }),
    )
    const card = cardOf(future, 'quicklinks')
    for (const target of ['consult', 'conversation', 'workflow']) {
      const start = card.indexOf(`data-xuanshu-nav="${target}"`)
      const tag = card.slice(start, card.indexOf('>', start))
      expect(tag, `${target} 应当已可用`).not.toContain('disabled')
    }
    expect(card).not.toContain('还没装配')
  })

  it('loading 是卡级骨架（D2）：有骨架节点、不出空态文案', () => {
    const skeleton = render(h(XsDestinyCard, { state: 'loading', ...injected() }))
    expect(skeleton).toContain('data-xuanshu-skeleton="card"')
    expect(skeleton).toContain('data-xs-state="loading"')
    expect(skeleton).not.toContain('底座还没立起来')
  })

  it('error 态有插画与重试（结构；07 无取数链路不可达）', () => {
    const error = render(h(XsDestinyCard, { state: 'error', ...injected() }))
    expect(error).toContain('data-xs-state="error"')
    expect(error).toContain('命盘快照读不出来（文件缺失或格式不符）。')
    expect(error).toContain('data-xuanshu-action="retry"')
  })
})

/* ───────────────────────── 4. ready 结构（票 08 / 13 喂数据） ───────────────────────── */

describe('票 07 · ready 结构（后续票接线，本票只证结构）', () => {
  it('命盘卡 ready：四柱 + 口径行 + 看详情，且仍然零输入控件（C1 不因点亮而松）', () => {
    const card = render(
      h(XsDestinyCard, {
        state: 'ready',
        snapshot: {
          pillars: { year: '甲子', month: '乙丑', day: '丙寅', hour: '丁卯' },
          basis: { trueSolar: '04:12', clock: '04:00' },
        },
        ...injected(),
      }),
    )
    expect(card).toContain('data-xs-state="ready"')
    for (const label of ['年柱', '月柱', '日柱', '时柱']) expect(card).toContain(label)
    for (const value of ['甲子', '乙丑', '丙寅', '丁卯']) expect(card).toContain(value)
    expect(card).toContain('真太阳时 04:12')
    expect(card).toContain('钟表时 04:00')
    expect(card).toContain('看详情 -&gt;')
    expect(card).not.toMatch(/<input|<select|<textarea/)
    // 详情抽屉属票 08：未接线 → 置灰 + 理由。
    expect(card).toContain('命盘详情还没装配（属票 08）')
  })

  it('日课卡 ready：宜 / 忌 / 流日 三行 + 看完整日课 + 立即生成', () => {
    const card = render(
      h(XsRikkeCard, {
        state: 'ready',
        today: '2026-10-13',
        content: { yi: '祭祀、出行', ji: '动土', liuri: '甲子日 · 水' },
        ...injected(),
      }),
    )
    expect(card).toContain('宜')
    expect(card).toContain('祭祀、出行')
    expect(card).toContain('忌')
    expect(card).toContain('流日')
    expect(card).toContain('甲子日 · 水')
    expect(card).toContain('看完整日课 -&gt;')
    expect(card).toContain('data-xuanshu-action="generate-rikke"')
  })

  it('底稿卡 ready：关于我 N 段 · 来源 M 路 + 三源头跳转 + 打开底稿 / 刷新（C2）', () => {
    const card = render(
      h(XsDigaoCard, { state: 'ready', summary: { segments: 15, sources: 3 }, ...injected() }),
    )
    expect(card).toContain('关于我：15 段 · 来源 3 路')
    expect(card).toContain('要改就改源头：')
    // 三源头：谱 / 工作区 / 工作流（未装配的置灰，工作区可用）。
    for (const target of ['pus', 'conversation', 'workflow']) {
      expect(card).toContain(`data-xuanshu-nav="${target}"`)
    }
    expect(card).toContain('谱面板还没装配（属票 09 · 谱管理）')
    expect(card).toContain('工作流面板还没装配（属票 16 · 工作流创建向导）')
    expect(card).toContain('data-xuanshu-action="refresh-digao"')
    expect(card).toContain('底稿刷新还没接上（属票 13 · 底稿与日课）')
    expect(card, '底稿卡 ready 才有 [打开底稿]').toContain('data-xuanshu-nav="digao"')
  })

  it('快捷入口卡是静态组件：任何状态下都不出现骨架或空态（S1 §6④ 显式说明）', () => {
    const card = render(h(XsQuickLinks, { baseplateReady: true, ...injected() }))
    expect(card).toContain('data-xs-state="ready"')
    expect(card).not.toContain('data-xuanshu-skeleton')
    expect(card).toContain('书房')
    expect(card).toContain('车间')
    expect(card).toContain('流水线')
  })
})

/* ───────────────────────── 5. R3 注入面：装配期接上宿主 data.overview ───────────────────────── */

/**
 * 复核发现（F1）：文案层早已收口，但**生产装配点从不传值** —— 六处里只有藏库页脚
 * （`cang.list.registryPath`）拿到真路径，其余五处永远显示中性占位。
 *
 * 这一组不直传 props：它物化**已提交的产物**（`lib/client.js`）、用假 ctx 跑 `apply`，
 * 从 `register` 的 `inject` 面取注入值，再把它渲染成 SSR —— 走的就是生产装配的那条路径。
 */
const HOST_HOME = 'D:\\xuanshu-home'
const HOST_DATA_DIR = `${HOST_HOME}\\xuanshu`

/** 让 apply 期发起的 `data.overview` 走完（Promise 链 + React 无关）。 */
function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * 造一个**带数据面**的假 ctx：apply 期唯一会发生的 RPC 是 `data.overview`，
 * 它由宿主回传产品 / 开发档的 home / dataDir（形状照 `lib/data/service.mjs`）。
 *
 * 数据面走同源 fetch（`POST /api/xuanshu`），桩装在 `globalThis.fetch` 上（见 `lib/rpc-fetch.mjs`），
 * 所以 `rpcCalls` 是夹具的记录项，`ctx` 本身不再需要 `connection`。
 */
function wiredCtx(answer = { home: HOST_HOME, dataDir: HOST_DATA_DIR }) {
  const rpc = installRpcFetch({
    value: {
      schema: 'xuanshu/data@1',
      ...answer,
      groups: [],
      total: { bytes: 0, files: 0 },
      excluded: [],
      notes: [],
    },
  })
  const registers = []
  const ctx = {
    effect(callback) {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    theme: { overrideTokens: () => () => {} },
    layout: { selectPanel: () => {} },
    slots: {
      inject(_name, callback) {
        callback()
        return () => {}
      },
      register(options) {
        registers.push(options)
        return () => {}
      },
      entries: () => [],
      subscribe: () => () => {},
    },
  }
  return { ctx, rpcCalls: rpc.calls, setRpcHandler: rpc.setHandler, registers }
}

/** 按 main key / cell id 找那一次注册，取它的注入面（= 生产里组件收到的 props）。 */
function injectOf(registers, key) {
  const found = registers.find((options) => options.key === key || options.id === key)
  expect(found, `产物里没有注册 ${key}`).toBeDefined()
  expect(typeof found.inject, `${key} 的注册必须给 inject 面`).toBe('function')
  return found.inject()
}

describe('票 07 · R3 注入面：装配期取一次宿主 data.overview 的 home / dataDir', () => {
  it('apply 期只读一次 data.overview（一份共享，不是每个面板各读一次）', async () => {
    const { ctx, rpcCalls } = wiredCtx()
    const { plugin } = materializeArtifact()
    plugin.apply(ctx)
    await flushAsync()
    expect(rpcCalls.map((call) => call.endpoint)).toEqual(['data.overview'])
    expect(rpcCalls[0].channel).toBe('/xuanshu')
  })

  it('总览页眉走注入的真值：SSR 出来的不是「玄枢数据目录」占位', async () => {
    const { ctx, registers } = wiredCtx()
    const { plugin } = materializeArtifact()
    plugin.apply(ctx)
    await flushAsync()

    const provided = injectOf(registers, 'overview')
    expect(provided.homePaths.getSnapshot()).toEqual({ home: HOST_HOME, dataDir: HOST_DATA_DIR })

    // 安装后的组件树在 SSR 里拿到注入值 —— 这是本组的核心断言（不是 props 直传）。
    const html = render(h(OverviewPanel, { ...provided, today: '2026-10-13' }))
    expect(html).toContain(`数据都在本地 ${HOST_DATA_DIR}\\`)
    expect(html).not.toContain('数据都在本地（玄枢数据目录/）')
  })

  it('其余四个文案点拿到同一份注入面：问事历史 / 命盘确认 / 沉淀草稿卡 / 沉淀确认弹窗', async () => {
    const { ctx, registers } = wiredCtx({ home: HOST_HOME, dataDir: HOST_DATA_DIR })
    const { plugin } = materializeArtifact()
    plugin.apply(ctx)
    await flushAsync()

    for (const key of ['consult', 'mingpan', 'xuanshu.sediment-entry', 'xuanshu.sediment-draft', 'xuanshu.sediment-notice']) {
      const provided = injectOf(registers, key)
      expect(provided.homePaths, `${key} 没拿到 home/dataDir 注入面`).toBeDefined()
      expect(provided.homePaths.getSnapshot(), `${key} 的注入面不是宿主回传值`).toEqual({
        home: HOST_HOME,
        dataDir: HOST_DATA_DIR,
      })
    }
  })

  it('宿主读不到（RPC 拒绝 / 没连接）：装配不抛，注入面回空中性占位', async () => {
    const { ctx, registers, setRpcHandler } = wiredCtx()
    // 让 data.overview 拒绝：装配层必须 fail-soft，不能把异常丢给 apply。
    setRpcHandler({ error: { message: '宿主还没解析 home' } })
    const { plugin } = materializeArtifact()
    expect(() => plugin.apply(ctx)).not.toThrow()
    await flushAsync()

    const provided = injectOf(registers, 'overview')
    expect(provided.homePaths.getSnapshot()).toEqual({})
  })
})

