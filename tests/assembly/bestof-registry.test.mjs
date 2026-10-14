/**
 * 票 11 · 客户端产物与注册面契约（`/多模型` 命令 + 浮层 + 设置开关行）。
 *
 * 对应票面验收里「客户端半能拿命令证明」的那几条：
 *   1. 注册面仍是**纯加性**：不碰 `root`、不声明 `children`、不给任何注册加 `priority`、
 *      不遮蔽 DSH 既有 cell、`overview` 仍是**第一个** main 注册、`selectPanel('overview')` **恰好一次**；
 *   2. 浮层落在 `shell.overlay` 的 `xuanshu-bestof-overlay` cell、开关行落在 `settings.general.item`；
 *   3. `/多模型` + 别名 `/合参` · `bestof` 三个命令名都注册到 `commandUi`，且都叫同一个处理器；
 *   4. `installBestOf` 在**无 `document` 的 Node** 下安全返回（样式注入被守卫挡掉、注册照做）；
 *   5. 只 require 基线外部依赖（没有为票 11 新增运行期依赖）。
 *
 * 注册面清单来自 `tests/assembly/lib/panel-surface.mjs`（单一事实来源），本文件不再手写清单。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

import { DSH_MAIN_KEYS, DSH_SIDEBAR_IDS, expectedCells } from './lib/panel-surface.mjs'

import { createBestofApi } from '../../packages/xuanshu-client/src/client/bestof-api.ts'
import { BESTOF_COMMAND_NAMES, createBestofController } from '../../packages/xuanshu-client/src/client/bestof-model.ts'
import { BESTOF_OVERLAY_ID, BESTOF_SETTINGS_ID, BESTOF_TRIGGER_ID, installBestOf } from '../../packages/xuanshu-client/src/client/bestof.tsx'

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
    if (name === 'react/jsx-runtime') return { Fragment: Symbol.for('react.fragment'), jsx: () => null, jsxs: () => null }
    if (name === 'react') return REACT_STUB
    throw new Error(`物化时出现未预期的 require(${JSON.stringify(name)})`)
  }
  return { id: spec.id, plugin: spec.factory(fakeRequire), requested }
}

/** 记录型假 ctx（含命令面与设置行槽）。 */
function recordingCtx() {
  const calls = []
  const commands = []
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
    commandUi: {
      register(contribution) {
        commands.push(contribution)
        calls.push({ kind: 'command', name: contribution?.name })
        return () => {}
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
        return name === 'main' ? DSH_MAIN_KEYS.map((key) => ({ options: { key } })) : []
      },
      subscribe() {
        return () => {}
      },
    },
  }
  return { calls, commands, ctx }
}

describe('票 11 · 产物（lib/client.js）与注册面', () => {
  const { id, plugin, requested } = materializeArtifact()

  it('信封与插件面未变：id 是包名、inject 仍是四个 cordis 服务', () => {
    expect(id).toBe('xuanshu-client')
    expect([...plugin.inject].sort()).toEqual(['connection', 'layout', 'slots', 'theme'])
  })

  it('只 require 基线外部依赖（票 11 没新增运行期依赖）', () => {
    expect([...new Set(requested)].sort()).toEqual(['react', 'react/jsx-runtime'])
  })

  it('浮层 / 设置行 / 触发按钮落在约定的 cell 上，且 `/多模型` 三个名字都注册进命令面', () => {
    const { calls, commands, ctx } = recordingCtx()
    plugin.apply(ctx)

    const registers = calls.filter((call) => call.kind === 'register')
    const overlay = registers.filter((row) => row.name === 'shell.overlay').map((row) => row.options.id)
    const settings = registers.filter((row) => row.name === 'settings.general.item').map((row) => row.options.id)
    const trigger = registers.filter((row) => row.name === 'conversation.composer.dock').map((row) => row.options.id)

    expect(overlay).toContain(BESTOF_OVERLAY_ID)
    expect(BESTOF_OVERLAY_ID).toBe('xuanshu-bestof-overlay')
    expect(settings).toEqual([BESTOF_SETTINGS_ID])
    expect(BESTOF_SETTINGS_ID).toBe('xuanshu.bestof')
    // `conversation.composer.dock` 是**共享槽**：票 15 的沉淀入口条也注册在那里。
    // 所以这里断言「我们那一格在里面」，而**不是**「这个槽只有我们一格」——
    // 后者会让后加的票无端打红（票 12 的挂载契约就因为同类全局计数断言红过一次）。
    expect(trigger).toContain(BESTOF_TRIGGER_ID)
    expect(BESTOF_TRIGGER_ID).toBe('xuanshu-bestof-trigger')

    expect(commands.map((contribution) => contribution.name).sort()).toEqual([...BESTOF_COMMAND_NAMES].sort())
    expect(BESTOF_COMMAND_NAMES).toEqual(['多模型', '合参', 'bestof'])
    // 三个名字指同一个处理器：都能进费用确认（这里只验它们是同一个函数形状 + 都 available）。
    for (const contribution of commands) {
      expect(contribution.available({ sessionId: 'session-xs-consult-x' })).toBe(true)
      expect(contribution.ui?.kind).toBe('action')
      expect(typeof contribution.ui.run).toBe('function')
    }
  })

  it('注册面仍是纯加性：不碰 root、不声明 children、不加 priority、不遮蔽 DSH cell', () => {
    const { calls, ctx } = recordingCtx()
    plugin.apply(ctx)
    const registers = calls.filter((call) => call.kind === 'register')
    const mainKeys = registers.filter((row) => row.name === 'main').map((row) => row.options.key)
    const rowIds = registers.filter((row) => row.name === 'sidebar.panellist').map((row) => row.options.id)

    expect(mainKeys[0], '`overview` 必须仍是第一个 main 注册').toBe('overview')
    expect(registers.some((row) => row.name === 'root'), '不得注册进 root 槽').toBe(false)
    for (const register of registers) {
      expect(register.options.priority, '新 cell 不需要 priority').toBeUndefined()
      expect(register.options.children, '不得声明 children').toBeUndefined()
    }
    for (const key of mainKeys) expect(DSH_MAIN_KEYS, `遮蔽了 DSH 的 main key：${key}`).not.toContain(key)
    for (const id of rowIds) expect(DSH_SIDEBAR_IDS, `遮蔽了 DSH 的侧栏行：${id}`).not.toContain(id)

    // 默认面板没被搅动：selectPanel 恰一次且值是 overview。
    expect(calls.filter((call) => call.kind === 'selectPanel').map((call) => call.panelId)).toEqual(['overview'])
  })

  it('全部槽位注册落成的 cell 与单一事实来源一致（票 11 加的两个 cell 已登记）', () => {
    const registry = (() => {
      const map = new Map()
      return {
        map,
        register(options, component) {
          const cellId = options.key ?? options.id
          const cellKey = `${String(options.name)}\u0000${String(cellId)}`
          if (map.has(cellKey)) throw new Error(`same cell：${cellKey}`)
          map.set(cellKey, component)
          return () => {}
        },
      }
    })()
    const { ctx } = recordingCtx()
    ctx.slots.register = (options, component) => registry.register(options, component)
    expect(() => plugin.apply(ctx)).not.toThrow()
    expect([...registry.map.keys()].sort()).toEqual(expectedCells())
  })
})

describe('票 11 · 安装函数在无 document 的 Node 里安全', () => {
  function installCtx() {
    const registrations = []
    const commands = []
    return {
      registrations,
      commands,
      ctx: {
        effect: (callback) => {
          callback()
          return () => {}
        },
        commandUi: { register: (contribution) => { commands.push(contribution); return () => {} } },
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

  const fakeRpc = () => ({ connection: { rpc: { async call() { return { ok: true, value: {} } } } } })

  const deps = () => {
    const api = createBestofApi(fakeRpc())
    return { api, controller: createBestofController({ api }) }
  }

  it('当前环境确实没有 document（证明这条断言不是在 jsdom 里空转）', () => {
    expect(typeof document).toBe('undefined')
  })

  it('installBestOf：注册浮层 + 设置行 + 触发按钮 + 三个命令名，不抛、不切面板', () => {
    const { registrations, commands, ctx } = installCtx()
    expect(() => installBestOf(ctx, deps())).not.toThrow()
    expect(registrations.map((row) => ({ name: row.name, id: row.id, order: row.order }))).toEqual([
      { name: 'shell.overlay', id: BESTOF_OVERLAY_ID, order: undefined },
      { name: 'settings.general.item', id: BESTOF_SETTINGS_ID, order: 60 },
      { name: 'conversation.composer.dock', id: BESTOF_TRIGGER_ID, order: undefined },
    ])
    expect(commands.map((contribution) => contribution.name)).toEqual(BESTOF_COMMAND_NAMES)
    expect(Object.keys(registrations[0].inject()).sort()).toEqual(['api', 'controller'])
  })

  it('命令面不在场（没有 commandUi）：槽位照常注册，不抛', () => {
    const { registrations, ctx } = installCtx()
    delete ctx.commandUi
    expect(() => installBestOf(ctx, deps())).not.toThrow()
    expect(registrations).toHaveLength(3)
  })

  it('触发按钮：拿不到 sessionId 也照常进费用确认（由控制器说「还没有问事会话」）', async () => {
    const { registrations, ctx } = installCtx()
    const install = deps()
    install.controller.setEnabled(true) // 开关默认关：先打开（设置行的职责）
    install.controller.editQuestion('这次转岗该不该去')
    installBestOf(ctx, install)

    const button = registrations.find((row) => row.name === 'conversation.composer.dock')
    const { onTrigger } = button.inject()
    onTrigger()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const state = install.controller.snapshot()
    expect(state.phase).toBe('confirm')
    expect(state.sessionId).toBe('')
    await install.controller.confirm()
    expect(install.controller.snapshot().error).toMatch(/还没有问事会话/u)
  })

  it('命令的 run(session) 把 sessionId 带进控制器（关着时进禁用态，一个请求都不发）', () => {
    const { commands, ctx } = installCtx()
    const install = deps()
    installBestOf(ctx, install)
    commands[0].ui.run({ sessionId: 'session-xs-consult-9f8e7d6c' })
    const state = install.controller.snapshot()
    expect(state.phase).toBe('disabled')
    expect(state.sessionId).toBe('session-xs-consult-9f8e7d6c')
  })
})
