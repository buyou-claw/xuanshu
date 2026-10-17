/**
 * 票 13 · 产物（`lib/client.js`）的注册面与装配纪律（客户端半边）。
 *
 * 对应票面验收里「注册面纯加性 / apply 期不许调 `ctx.layout.selectPanel` / 无 document 下安全返回」
 * 这三条在**提交的产物**上的样子（不是只看源码）：
 *   1. `digao` / `rikke` 两个 main cell 与两条 `sidebar.panellist` 行都落位，id 与 key 同字符串，
 *      order / label 取自 `panel.ts`（底稿 60 / 日课 100）；
 *   2. **纯加性**：不碰 `root`、不声明 `children`、不给任何注册加 `priority`、不遮蔽 DSH 既有 cell，
 *      `overview` 仍是第一个 main 注册、`selectPanel('overview')` **恰好一次**（`verify-assembly` S3 同断）；
 *   3. 产物在**无 `document` 的 Node** 里物化 + `apply` 不抛（样式注入被守卫挡掉，注册照做）；
 *   4. 概览的注入面带上票 13 的两份数据面与两个控制器，且**不**带 `onGenerate` / `onRefresh`
 *      ——「生成 / 刷新」只有一条路径（控制器），概览面板自己造回调，避免两条写路径并存。
 *
 * 环境无关：不装 profile、不起 CLI、不联网；`lib/client.js` 是仓库提交物。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

import { PANEL_KEYS, expectedCells, expectedRegisterNames } from './lib/panel-surface.mjs'

import { DIGAO_ID, DIGAO_LABEL, DIGAO_ORDER, RIKKE_ID, RIKKE_LABEL, RIKKE_ORDER } from '../../packages/xuanshu-client/src/client/panel.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const ARTIFACT = join(REPO_ROOT, 'packages', 'xuanshu-client', 'lib', 'client.js')

/** DSH 已装机的 cell（遮蔽判据）：main key 与 sidebar.panellist id。 */
const DSH_MAIN_KEYS = ['conversation', 'plugins', 'schedules']
const DSH_SIDEBAR_IDS = ['plugins', 'schedules']

/** 票 13 之后的完整 main 注册（顺序有意义）。 */

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

/** 物化提交的 `lib/client.js`：假 loader 拿信封、假 require 物化 factory。 */
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

describe('票 13 · 产物注册面（digao / rikke 两个 cell）', () => {
  const { id, plugin, requested } = materializeArtifact()

  it('信封与插件面：id 是包名、apply/inject 齐备、cordis 服务注入未扩容', () => {
    expect(id).toBe('xuanshu-client')
    expect(typeof plugin.apply).toBe('function')
    expect([...plugin.inject].sort()).toEqual(['connection', 'layout', 'slots', 'theme'])
  })

  it('只 require 基线外部依赖（票 13 没有新增运行期依赖）', () => {
    expect([...new Set(requested)].sort()).toEqual(['react', 'react/jsx-runtime'])
  })

  it('无 document 的 Node 里 apply 不抛：样式注入被守卫挡掉、注册照做', () => {
    expect(typeof document).toBe('undefined')
    const { ctx } = recordingCtx()
    expect(() => plugin.apply(ctx)).not.toThrow()
  })

  it('两条新侧栏行的 id 与 main key 同字符串，order / label 取自 panel.ts', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    const registers = calls.filter((call) => call.kind === 'register')
    const mainKeys = registers.filter((row) => row.name === 'main').map((row) => row.options.key)
    const rows = registers.filter((row) => row.name === 'sidebar.panellist')
    expect(mainKeys).toEqual(PANEL_KEYS)
    expect(rows.map((row) => row.options.id)).toEqual(PANEL_KEYS)
    const digao = rows.find((row) => row.options.id === DIGAO_ID)
    const rikke = rows.find((row) => row.options.id === RIKKE_ID)
    expect(digao?.options).toMatchObject({ order: DIGAO_ORDER, label: DIGAO_LABEL })
    expect(rikke?.options).toMatchObject({ order: RIKKE_ORDER, label: RIKKE_LABEL })
    // S13 §8 / S15 六行表：底稿 60（库 · 底稿）；日课 100（20/30/40/50/60/70 已预约、80/90 被票 08 占用）。
    expect(DIGAO_ORDER).toBe(60)
    expect(RIKKE_ORDER).toBe(100)
    expect(DIGAO_ID).toBe('digao')
    expect(RIKKE_ID).toBe('rikke')
  })

  it('纯加性：不碰 root、不声明 children、不加 priority、不遮蔽 DSH cell、默认面板恰一次且是 overview', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    const registers = calls.filter((call) => call.kind === 'register')
    const mainKeys = registers.filter((row) => row.name === 'main').map((row) => row.options.key)
    const rowIds = registers.filter((row) => row.name === 'sidebar.panellist').map((row) => row.options.id)
    expect(mainKeys[0], '`overview` 必须仍是第一个 main 注册（默认面板与 S3 的 find(main) 都取首个）').toBe('overview')
    expect(registers.some((row) => row.name === 'root'), '不得注册进 root 槽').toBe(false)
    for (const register of registers) {
      expect(register.options.priority, '新 cell 不需要 priority（加了反而像在遮蔽）').toBeUndefined()
      expect(register.options.children, '不得声明 children（槽位声明排他）').toBeUndefined()
    }
    for (const key of mainKeys) expect(DSH_MAIN_KEYS, `遮蔽了 DSH 的 main key：${key}`).not.toContain(key)
    for (const rowId of rowIds) expect(DSH_SIDEBAR_IDS, `遮蔽了 DSH 的侧栏行：${rowId}`).not.toContain(rowId)
    // apply 期只允许一次 selectPanel，且值必须是 overview（verify-assembly 的 S3 同断）。
    const selections = calls.filter((call) => call.kind === 'selectPanel')
    expect(selections.map((call) => call.panelId)).toEqual(['overview'])
    const mainIndex = calls.findIndex((call) => call.kind === 'register' && call.name === 'main')
    const selectIndex = calls.findIndex((call) => call.kind === 'selectPanel')
    expect(selectIndex).toBeGreaterThan(mainIndex)
  })

  it('概览注入面带票 13 的数据面与控制器；生成 / 刷新只有控制器这一条路径', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    const main = calls.find((call) => call.kind === 'register' && call.name === 'main')
    const provided = main.options.inject()
    for (const key of ['rikke', 'rikkeController', 'digao', 'digaoController']) {
      expect(provided[key], `概览注入面缺 ${key}`).toBeDefined()
    }
    expect(typeof provided.rikkeController.generate).toBe('function')
    expect(typeof provided.digaoController.refresh).toBe('function')
    // 概览面板自己用控制器造 `onGenerate` / `onRefresh`（保证「人点才跑」只有一条路径）。
    expect(provided.onGenerate, 'onGenerate 不该由注入面提供（会变成第二条写路径）').toBeUndefined()
    expect(provided.onRefresh, 'onRefresh 不该由注入面提供（会变成第二条写路径）').toBeUndefined()
  })

  it('两块面板各自带自己的 inject（api + navigate），且不含 layout 面', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    const registers = calls.filter((call) => call.kind === 'register')
    for (const key of [DIGAO_ID, RIKKE_ID]) {
      const main = registers.find((row) => row.name === 'main' && row.options.key === key)
      expect(main, `缺 main cell ${key}`).toBeDefined()
      expect(Object.keys(main.options.inject()).sort()).toEqual(['api', 'navigate'])
    }
  })
})
