/**
 * 剧本 2 / 3（问事 / 藏库）+ 导航族采样 —— 票 08 / #55。
 *
 * 覆盖口径（spec 003 §Testing Decisions 第 3 条）：**浏览器侧只留 1 条端到端**（那条在
 * `browser-collector.test.mjs`，别在这里再起浏览器）。所以这份用例只测**不起浏览器**的那一层：
 *   1. 剧本的形状与注册（加一条剧本 = 一条记录，缺 `run` 直接红）；
 *   2. `scriptIds` 的变体解析（失败态要能单独跑；名字打错必须报错，不能静默跳过）；
 *   3. 三条失败态各自**绑定在剧本参数上**（不是「跑着看会不会撞上」）；
 *   4. 导航族的证据形状（store → facts）：入口表 / 关闭事件 / Tab 走查，以及「没采到就不产证据」。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { coverageOf, createNavStore, entriesFor, navFactsFor } from '../../scripts/ux/collect/browser-nav.mjs'
import { SCRIPTS, parseScriptId, resolveScripts, scriptIds } from '../../scripts/ux/collect/browser-scripts.mjs'
import { NAV_ACTIONS, actionOfLabel, serializeActions } from '../../scripts/ux/nav-vocabulary.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')

describe('票 08 · 剧本 2 / 3 已登记（与剧本 1 同构）', () => {
  it('三条剧本都在，且每条都有 {id, title, faces, criteria, run}', () => {
    expect(scriptIds()).toEqual(['create-pu', 'ask-consult', 'register-cang'])
    for (const [key, script] of Object.entries(SCRIPTS)) {
      expect(script.id).toBe(key)
      expect(typeof script.title).toBe('string')
      expect(script.title.length).toBeGreaterThan(0)
      expect(Array.isArray(script.faces)).toBe(true)
      expect(script.faces.length).toBeGreaterThan(0)
      expect(Array.isArray(script.criteria)).toBe(true)
      expect(typeof script.run).toBe('function')
      expect(Array.isArray(script.scenarios)).toBe(true)
    }
  })

  it('剧本 2 / 3 各自动到导航族：criteria 里带 N-001 / N-002 / N-003', () => {
    for (const id of ['ask-consult', 'register-cang']) {
      expect(SCRIPTS[id].criteria).toEqual(expect.arrayContaining(['D-001', 'N-001', 'N-002', 'N-003']))
    }
    expect(SCRIPTS['ask-consult'].faces).toContain('panel:consult')
    expect(SCRIPTS['register-cang'].faces).toContain('panel:cang')
    expect(SCRIPTS['register-cang'].faces).toContain('slot:shell.overlay#xuanshu-cang-drawer')
  })

  it('两条剧本各自可单独跑、也能串起来跑（resolveScripts 保序，返回同一批剧本对象）', () => {
    expect(resolveScripts(['ask-consult']).map((item) => item.script.id)).toEqual(['ask-consult'])
    expect(resolveScripts(['register-cang']).map((item) => item.script.id)).toEqual(['register-cang'])
    const both = resolveScripts(['ask-consult', 'register-cang'])
    expect(both.map((item) => item.script.id)).toEqual(['ask-consult', 'register-cang'])
    expect(both[0].script).toBe(SCRIPTS['ask-consult'])
  })

  it('剧本名打错 / 变体不认识 → 直接报错（不许静默少跑一剧本）', () => {
    expect(() => resolveScripts(['ask-conslt'])).toThrow(/没有这条剧本/)
    expect(() => resolveScripts(['ask-consult:no-model'])).toThrow(/没有这个变体/)
    expect(() => resolveScripts(['register-cang:load-failed'])).not.toThrow()
  })
})

describe('票 08 · 三条失败态各自有名字、用来真触发', () => {
  const failureScenarios = Object.entries(SCRIPTS).flatMap(([id, script]) =>
    (script.scenarios ?? []).filter((scenario) => scenario !== 'clean' && scenario !== 'normal').map((scenario) => ({ id, scenario })),
  )

  it('三条失败态（无会话 / 文件不存在 / 加载失败）都在剧本参数里各有一个变体', () => {
    expect(failureScenarios.map((item) => `${item.id}:${item.scenario}`)).toEqual([
      'ask-consult:no-session',
      'register-cang:missing-file',
      'register-cang:load-failed',
    ])
  })

  it('解析出的变体带着剧本对象一起走（采集器据它决定这一跑要故意触发哪一条失败态）', () => {
    const [only] = resolveScripts(['register-cang:load-failed'])
    expect(only.scenario).toBe('load-failed')
    expect(only.script).toBe(SCRIPTS['register-cang'])
  })

  it('失败态在剧本里被**写明是故意的**（步骤记录里要有 deliberate 标记）', () => {
    // 这里是源码级断言：三条失败态各有一处 `deliberate: true`，且都在 `failure-scenario` 那一步里。
    const source = readFileSync(join(REPO_ROOT, 'scripts/ux/collect/browser-scripts.mjs'), 'utf8')
    const blocks = source.match(/step\('failure-scenario',\s*\{[\s\S]*?\n\s*\}\)/g) ?? []
    expect(blocks).toHaveLength(3)
    for (const block of blocks) expect(block).toContain('deliberate: true')
    // 无会话那条还要先证明「历史子页真的空着」（不是假设干净 home 一定没有会话）。
    expect(source).toContain('sessionsEmpty')
    // 故意触发 ≠ 假装触发：终态那一步要写出「失败到底触发了没有」。
    expect(source).toContain('failureTriggered')
  })
})

describe('票 08 · 采集器只收证据（判定只在 assertions）', () => {
  it('剧本与导航采样器里没有「算不算过」的字样', () => {
    for (const file of ['scripts/ux/collect/browser-scripts.mjs', 'scripts/ux/collect/browser-nav.mjs']) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8')
      expect(source).not.toMatch(/\bpass:\s*(?:true|false)/)
      expect(source).not.toMatch(/\bfail:\s*(?:true|false)/)
      expect(source).not.toMatch(/severity/)
    }
  })

  it('剧本 3 在临时 home 里造真文件、把注册表写坏 —— 都是真触发，不是 mock', () => {
    const source = readFileSync(join(REPO_ROOT, 'scripts/ux/collect/browser-scripts.mjs'), 'utf8')
    expect(source).toContain("'ux-cang-sample.txt'")
    expect(source).toContain('registry.jsonl')
    // 坏行必须是「真的坏」：写进去的东西不是合法 JSON 事件。
    expect(source).toContain('这一行故意写坏')
  })
})

describe('票 08 · 导航族的证据形状（store → facts）', () => {
  function storeWith(entries = [], closes = [], walks = []) {
    const store = createNavStore()
    for (const entry of entries) {
      const key = `${entry.face}\u0000${entry.primitive}\u0000${entry.label}`
      store.entries.set(key, { ...entry, firstSeenAt: 'fixture' })
      store.samples += 1
      store.panels.add(entry.panel ?? 'overview')
      store.primitives.add(entry.primitive)
    }
    store.closes.push(...closes)
    for (const walk of walks) store.keyboards.set(walk.face, walk)
    return store
  }

  it('N-001 的 facts：同一动作的入口按原语顺序排好，没有的 face 不产证据', () => {
    const store = storeWith([
      { face: 'panel:pus', primitive: 'panel', label: '查看谱', panel: 'cang', via: 'label' },
      { face: 'panel:pus', primitive: 'sidebar-row', label: '谱', panel: 'overview', via: 'label' },
      { face: 'panel:pus', primitive: 'panel', label: '管理谱 ▸ S5', panel: 'consult', via: 'label' },
    ])
    const facts = navFactsFor('N-001', 'panel:pus', store)
    expect(facts.action).toEqual({ id: 'pus', label: '谱管理' })
    expect(facts.entries.map((entry) => `${entry.primitive}:${entry.label}`)).toEqual([
      'sidebar-row:谱',
      'panel:查看谱',
      'panel:管理谱 ▸ S5',
    ])
    expect(facts.coverage.primitives).toEqual(['sidebar-row', 'panel'])
    expect(navFactsFor('N-001', 'panel:cang', store)).toBeNull()
  })

  it('N-002 的 facts：只收「被关掉的那个面」的关闭事件', () => {
    const store = storeWith([], [
      { from: 'panel:cang', opened: 'slot:shell.overlay#xuanshu-cang-drawer', closedBy: 'Escape', landed: 'panel:cang' },
      { from: 'panel:consult', opened: 'panel:consult', closedBy: '「← 回到当前会话」', landed: 'panel:consult' },
    ])
    expect(navFactsFor('N-002', 'slot:shell.overlay#xuanshu-cang-drawer', store).events).toHaveLength(1)
    expect(navFactsFor('N-002', 'panel:consult', store).events[0].closedBy).toContain('回到当前会话')
    expect(navFactsFor('N-002', 'panel:pus', store)).toBeNull()
  })

  it('N-003 的 facts：Tab 走查原样带出（含 expect / reached），没走过的面不产证据', () => {
    const store = storeWith([], [], [{
      face: 'panel:cang',
      root: '[data-xuanshu-panel="cang"]',
      found: true,
      controls: 6,
      expect: ['登记藏'],
      reached: ['登记藏'],
      stops: [{ tag: 'button', label: '登记藏', inFace: true, focusVisible: true, outline: 'auto 2px', visibleFocus: true }],
    }])
    const facts = navFactsFor('N-003', 'panel:cang', store)
    expect(facts.expect).toEqual(['登记藏'])
    expect(facts.reached).toEqual(['登记藏'])
    expect(facts.stops).toHaveLength(1)
    expect(navFactsFor('N-003', 'panel:pus', store)).toBeNull()
  })

  it('入口表跨多次采样去重（同一入口采两遍还是一条）', () => {
    const store = storeWith([
      { face: 'panel:pus', primitive: 'sidebar-row', label: '谱', panel: 'overview' },
      { face: 'panel:pus', primitive: 'sidebar-row', label: '谱', panel: 'overview' },
    ])
    expect(entriesFor(store, 'panel:pus')).toHaveLength(1)
    // 采样次数照样是两次（同一次运行里采了两遍页面）：去重的是**入口**，不是采样的历史。
    expect(navFactsFor('N-001', 'panel:pus', store).coverage.samples).toBe(2)
  })
})

describe('票 08 · 动作表口径（同一个动作怎么认）', () => {
  it('显式列出的动作名认得出，跨面板同一动作认成同一个 face', () => {
    expect(actionOfLabel('谱')).toMatchObject({ id: 'pus' })
    expect(actionOfLabel('管理谱 ▸ S5')).toMatchObject({ id: 'pus' })
    expect(actionOfLabel('查看谱')).toMatchObject({ id: 'pus' })
    expect(actionOfLabel('填八字')).toMatchObject({ face: 'panel:onboarding' })
    expect(actionOfLabel('开始填写出生信息 ->')).toMatchObject({ face: 'panel:onboarding' })
  })

  it('整串锚定：被置灰的快捷入口（标题 + 副标题拼一串）不算第二个入口', () => {
    expect(actionOfLabel('问事底座未立 · 会先引导你填出生信息')).toBeUndefined()
    expect(actionOfLabel('工作区车间')).toBeUndefined()
    // 但启用着的三格是 `data-xuanshu-nav` 认的，走结构线索（见 browser-nav 的 census）。
    expect(actionOfLabel('工作流 流水线')).toBeUndefined()
  })

  it('动作表的 face 都是真界面面 id（panel: 或 slot: 开头）', () => {
    for (const action of NAV_ACTIONS) expect(action.face).toMatch(/^(?:panel|slot):/)
  })

  it('动作表能跨进页面（正则拆成 source/flags，JSON 往返不变）', () => {
    const serialized = serializeActions()
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized)
    expect(serialized.actions).toHaveLength(NAV_ACTIONS.length)
    expect(serialized.drawerFaces['xs-cang-drawer-title']).toBe('slot:shell.overlay#xuanshu-cang-drawer')
  })

  it('parseScriptId 只按第一个冒号切（剧本 id 里没有冒号，face id 有）', () => {
    expect(parseScriptId('ask-consult')).toEqual({ id: 'ask-consult', scenario: undefined })
    expect(parseScriptId('register-cang:load-failed')).toEqual({ id: 'register-cang', scenario: 'load-failed' })
  })

  it('coverageOf 说清「哪些原语真的观测过」（命令原语今天观测不到就如实缺着）', () => {
    const store = createNavStore()
    expect(coverageOf(store)).toEqual({ samples: 0, panels: [], primitives: [] })
    store.samples = 3
    store.primitives.add('panel')
    store.primitives.add('sidebar-row')
    expect(coverageOf(store).primitives).toEqual(['sidebar-row', 'panel'])
  })
})
