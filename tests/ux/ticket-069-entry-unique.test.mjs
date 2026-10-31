/**
 * 票 UX-07 / #69 · 同一个动作只有一个入口（N-001）在三个红面上的落点。
 *
 * 为什么钉在「渲染出来的 HTML × 采集器的同一张动作表」这道缝上：
 * `verify:ux` 的 N-001 原料来自真浏览器（`collect/browser-nav.mjs` 的 `pageCensus`），
 * 而 worktree 里起不了隔离实例（--browser 不可用）。于是这份用例做两件事：
 *   1. 用 `renderToStaticMarkup` 渲染**同一个组件**，再用采集器同一张动作表（`actionOfLabel`）
 *      认入口 —— 口径只有一份，所以这里数出来的「2 个门」就是浏览器会数出来的「2 个门」；
 *   2. 把数出来的入口喂给**真正的判定谓词**（`assertions/n.mjs` 的 `N-001`），
 *      于是「这条断言绿了」= 「巡检会判绿」，而不是「我觉得按钮少了」。
 *      采到的入口先按采集器的**快照**口径走一遍（`entriesInWorstSnapshot` / `navFactsFor`），
 *      不是直接拼一张平表 —— 判据说的是「同一时刻」，绕开这一层就会把互斥的两个状态误判成重复入口。
 *
 * SSR 复现不了、这里显式让开的两件事（不让开就会得到假绿 / 假红）：
 *   - **可见性**：采集器用 `getBoundingClientRect()` 为 0 就排除。React 不渲染即不存在；
 *     唯一例外是 `<details>` 收起的内容 —— 它渲染了但看不见，所以先整块剪掉再数；
 *   - **置灰**：判据原文「置灰的入口不算入口」，按 `disabled` 属性排除（与采集器同一条）。
 *
 * 三个红面（2026-10-31 巡检实测）各自的判断与落点：
 *   - `panel:pus`：**跨原语真重复**。侧栏行「谱」是十个面板共同的唯一导航原语，面板里那两个
 *     （藏库「查看谱」/ 门厅勾选清单「管理谱 ▸ S5」）是同一动作的第二、第三扇门 → 删面板里的，
 *     留侧栏行；被删的能力仍在（点侧栏「谱」），只是不再有第二个门。
 *     历史空态那枚次按钮是**例外**（S7:65 明文要求）：它没被删，后来改成带意图的「先建一个谱」
 *     —— 动作换掉了，才既留住 S7 的次按钮、又不算同动作的第二扇门（见 `tests/ux/pu-nav-intent.test.mjs`）。
 *   - `cang-drawer`：**同一原语真重复**，且只在空态同时出现（工具条「登记藏」+ 空态「登记第一个藏」）
 *     → 空态只留一个门（空态那个，它是 #68 补的可执行空态）。
 *     两个状态的门**名字不同**（「登记第一个藏」/「登记藏」）：它们互斥，不是重复入口。
 *   - `mounts-drawer`：**同一原语真重复**，门厅里「临时挂载…」与状态栏（点开同一个抽屉）同时可点
 *     → 门留给「临时挂载…」，状态栏退回纯读数（C7 要的「挂载 N 字 / 预算 M 字」照旧常驻）。
 */

import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CangPanel } from '../../packages/xuanshu-client/src/client/CangPanel.tsx'
import { ConsultPanel } from '../../packages/xuanshu-client/src/client/consult.tsx'
import { XsConsultPicker } from '../../packages/xuanshu-client/src/client/consult-views.tsx'
import { XsMountSection } from '../../packages/xuanshu-client/src/client/mounts-views.tsx'
import { N_ASSERTIONS } from '../../scripts/ux/assertions/n.mjs'
import { createNavStore, entriesInWorstSnapshot, navFactsFor } from '../../scripts/ux/collect/browser-nav.mjs'
import { NAV_ACTIONS, actionOfLabel } from '../../scripts/ux/nav-vocabulary.mjs'

/* ───────────────────────── 采集器的 SSR 对应物 ───────────────────────── */

function textOf(markup) {
  return markup
    .replace(/<[^>]*>/gu, '')
    .replace(/&gt;/gu, '>')
    .replace(/&lt;/gu, '<')
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;/gu, "'")
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** 一个面里「能点且点得通的入口」（`pageCensus` 在 SSR 上能复现的那一半，见文件头）。 */
function census(html) {
  const visible = html.replace(/<details\b[\s\S]*?<\/details>/gu, '')
  const entries = []
  for (const match of visible.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu)) {
    const attrs = match[1]
    if (/\bdisabled\b/u.test(attrs)) continue
    const aria = /aria-label="([^"]*)"/u.exec(attrs)
    const label = textOf(aria === null ? match[2] : aria[1])
    const action = actionOfLabel(label)
    if (action === undefined) continue
    entries.push({ primitive: 'panel', label, actionId: action.id, panel: 'rendered' })
  }
  return entries
}

/** 某个动作在这个面里被几扇门指着（只给 id 与文案，够写 message 用）。 */
function doorsFor(html, actionId) {
  return census(html).filter((entry) => entry.actionId === actionId)
}

/** 入口表 → `N-001` 的 facts（判定谓词只吃这个形状；不经过快照层，用于直接喂谓词）。 */
function nFacts(face, entries) {
  const action = NAV_ACTIONS.find((candidate) => candidate.face === face)
  return {
    face,
    action: action === undefined ? null : { id: action.id, label: action.label },
    entries: entries.map((entry) => ({ primitive: entry.primitive, label: entry.label, panel: entry.panel })),
  }
}

/** 判一次 N-001：返回 `{pass, message}`，message 就是报告里那一行。 */
function judgeN001(face, entries) {
  return N_ASSERTIONS['N-001'](nFacts(face, entries))
}

/**
 * 按采集器的口径造一份 store：**每次 `census()` 一个快照**（浏览器里一次采样 = 页面上此刻的全部门）。
 * 累加表也照 `census()` 的做法灌一遍 —— 两条路都必须走得通，判据只该吃快照那条。
 *
 * @param {object[][]} snapshots 逐次采样的入口
 */
function storeOf(...snapshots) {
  const store = createNavStore()
  for (const snapshot of snapshots) {
    store.samples += 1
    store.snapshots.push(snapshot.map((entry) => ({ ...entry })))
    for (const entry of snapshot) {
      const key = `${entry.face}\u0000${entry.primitive}\u0000${entry.label}`
      if (!store.entries.has(key)) store.entries.set(key, { ...entry, firstSeenAt: 'fixture' })
      store.panels.add(entry.panel)
      store.primitives.add(entry.primitive)
    }
  }
  return store
}

/* ───────────────────────── 夹具 ───────────────────────── */

const render = (element) => renderToStaticMarkup(element)

const CANG_CONTROLLER = { snapshot: () => ({ revision: 0, draft: undefined }), subscribe: () => () => {}, edit: () => {} }

const CANG_ENTRY = {
  id: 'one',
  name: '经典藏书',
  path: 'C:/private/notes.pdf',
  tags: ['书'],
  actions: { open: true, reveal: true, copy: true },
  pointer: { valid: true, kind: 'file', checkedAt: '2026-10-14T00:00:00Z' },
}

const CANG_DRAWER_FACE = 'slot:shell.overlay#xuanshu-cang-drawer'
const MOUNTS_DRAWER_FACE = 'slot:shell.overlay#xuanshu-mounts-drawer'

/** 藏库面板的一次渲染（空库 / 有藏）。 */
const cangPanel = (entries) =>
  render(h(CangPanel, { api: {}, controller: CANG_CONTROLLER, initialData: { registryPath: 'registry.jsonl', entries } }))

/** 门厅勾选清单（契约 §2 的 `consult.defaults` 样例）。 */
const PICKER_PROPS = {
  required: [
    { kind: 'base-pu', name: '底座（八字）', present: true },
    { kind: 'digao', name: '底稿', present: false, reason: '底稿还没生成（属票 13 · 底稿与日课）' },
  ],
  optional: [{ slug: 'rensheng-jingli', name: '人生经历', level: 'base', summary: '成长与转折的骨架' }],
  selected: [],
  onToggle: () => {},
  onManagePu: () => {},
}

/** 问事门厅的静态渲染（`preloaded` 短路取数；SSR 里 effect 不跑，所以只能喂预置）。 */
const CONSULT_DEFAULTS = {
  required: [
    { kind: 'base-pu', name: '底座（八字）', present: true },
    { kind: 'digao', name: '底稿', present: false, reason: '底稿还没生成（属票 13 · 底稿与日课）' },
  ],
  optional: [{ slug: 'rensheng-jingli', name: '人生经历', level: 'base', summary: '成长与转折的骨架' }],
}
const CONSULT_API = {
  create: async () => ({ session: {} }),
  send: async () => ({ accepted: true }),
  list: async () => ({ items: [] }),
  read: async () => ({ session: {}, messages: [] }),
  rename: async () => ({ session: {} }),
  defaults: async () => CONSULT_DEFAULTS,
}
const consultPanel = (view, items = []) =>
  render(h(ConsultPanel, {
    api: CONSULT_API,
    navigate: () => {},
    openSession: () => {},
    preloaded: { defaults: CONSULT_DEFAULTS, items, view },
  }))

/* ───────────────────────── panel:pus ───────────────────────── */

describe('票 69 · panel:pus：谱管理的那一跳只留侧栏行', () => {
  it('藏库面板不再给第二扇门（「查看谱」删掉，改谱的路径点名侧栏行）', () => {
    const html = cangPanel([])
    const doors = doorsFor(html, 'pus')

    // 判据要的是「门只有一个」：这个面里一个都不该有（唯一的门在侧栏）。
    expect(doors.map((door) => door.label), '藏库面板里还留着去谱管理的门').toEqual([])
    // 删掉入口不等于删掉能力：说法必须点名那条路（不然用户不知道谱管理还能怎么去）。
    expect(html).toContain('侧栏「谱」')
  })

  it('门厅勾选清单不再给第二扇门（「管理谱 ▸ S5」删掉，同样点名侧栏行）', () => {
    const html = render(h(XsConsultPicker, PICKER_PROPS))
    expect(doorsFor(html, 'pus').map((door) => door.label), '勾选清单里还留着去谱管理的门').toEqual([])
    expect(html).toContain('侧栏「谱」')
  })

  it('问事门厅落地态没有去谱管理的门；历史空态那枚次按钮换成了**建谱**动作（S7 明文要求，N-001 不再重复）', () => {
    // 壳（`ConsultPanel`）在 SSR 里起得来：`preloaded` 短路取数，于是「渲染出来的入口表」
    // 就是浏览器会看到的那一份 —— 不必再去读源码字符串。
    expect(doorsFor(consultPanel('lobby'), 'pus').map((door) => door.label), '门厅落地态又冒出去谱管理的门').toEqual([])
    // 历史子页空态：`docs/design/ui-v1/screens/S7-问事历史回看.md:65` 要求「主按钮（开一次问事）+
    // 次按钮（先建谱）」。那枚次按钮从「管理谱 ▸ S5」改成了**建谱**（带 `requestPuCreate` 意图）：
    // 按钮还在（S7 的次按钮保住了），但它不再是「谱管理」这个动作的第二扇门 —— 动作变了，不是名字变了。
    const history = consultPanel('history', [])
    expect(doorsFor(history, 'pus').map((door) => door.label), '历史空态还挂着去谱管理的门').toEqual([])
    expect(history, 'S7 要的次按钮没了').toContain('data-xuanshu-action="create-pu"')
    // 从前这里记过一句「剧本不采历史子页，所以这枚不影响 panel:pus 转绿」。现在那一层依赖不需要了：
    // 这枚按钮已经不在「谱管理」的动作表里（`actionOfLabel('先建一个谱')` 为空），采不采到都不再是第二个入口。
  })

  it('把三个面采到的入口并成一张表（采集器是跨采样累加的）：谱管理只剩侧栏行一个 → N-001 判绿', () => {
    // 侧栏行不在这些组件的渲染里（它由 `sidebar.panellist` 槽注册，标「谱」）：按浏览器会看到的
    // 那一条补进来 —— 这正是「唯一的那扇门」本身，不是补偿出来的假入口。
    const entries = [
      { primitive: 'sidebar-row', label: '谱', panel: 'conversation' },
      ...census(cangPanel([])),
      ...census(render(h(XsConsultPicker, PICKER_PROPS))),
    ].filter((entry) => entry.actionId === undefined || entry.actionId === 'pus')
      .map((entry) => ({ primitive: entry.primitive, label: entry.label, panel: entry.panel ?? 'consult' }))

    const verdict = judgeN001('panel:pus', entries)
    expect(verdict.pass, verdict.message).toBe(true)
    expect(entries).toHaveLength(1)
  })
})

/* ───────────────────────── cang-drawer ───────────────────────── */

describe('票 69 · cang-drawer：登记藏只有一个门，两个状态各自一扇（互斥，不靠同名）', () => {
  it('空态：只有空态里那一个门，叫「登记第一个藏」（工具条那个不渲染）', () => {
    const html = cangPanel([])
    const doors = doorsFor(html, 'cang-drawer')

    expect(doors.map((door) => door.label)).toEqual(['登记第一个藏'])
    expect(judgeN001(CANG_DRAWER_FACE, doors).pass).toBe(true)
  })

  it('有藏时：只剩工具条那一个「登记藏」（卡里的「编辑登记」在收起的「更多操作」里，不算门）', () => {
    const html = cangPanel([CANG_ENTRY])
    const doors = doorsFor(html, 'cang-drawer')

    expect(doors.map((door) => door.label)).toEqual(['登记藏'])
    expect(judgeN001(CANG_DRAWER_FACE, doors).pass).toBe(true)
  })

  it('两次采样各一扇门（空态 / 有藏态名字不同）：按同一时刻数 → 仍是 1 个入口，判绿', () => {
    // 这就是真跑巡检时的形状：剧本先进空态、登记之后再采一次。并集口径会把这**两扇互斥的门**
    // 算成两处重复入口，逼人给它们起同一个名字；快照口径按「同一时刻」数，两扇门就还是两扇门。
    const store = storeOf(
      doorsFor(cangPanel([]), 'cang-drawer').map((door) => ({ ...door, face: CANG_DRAWER_FACE })),
      doorsFor(cangPanel([CANG_ENTRY]), 'cang-drawer').map((door) => ({ ...door, face: CANG_DRAWER_FACE })),
    )
    const worst = entriesInWorstSnapshot(store, CANG_DRAWER_FACE)
    expect(worst.map((door) => door.label)).toEqual(['登记第一个藏'])
    expect(store.snapshots).toHaveLength(2)

    const facts = navFactsFor('N-001', CANG_DRAWER_FACE, store)
    expect(facts.snapshot).toEqual({ index: 0, doors: 1, samples: 2 })
    const verdict = N_ASSERTIONS['N-001'](facts)
    expect(verdict.pass, verdict.message).toBe(true)
  })

  it('同一快照里放两扇同名门 → N-001 必须判红（判据仍有牙，没被同名去重吃掉）', () => {
    // 两扇门在同一时刻并排出现：无论叫什么名字，都是「同一个动作出现在两个入口」。
    const twoDoors = [
      { primitive: 'panel', label: '登记藏', panel: 'cang', face: CANG_DRAWER_FACE },
      { primitive: 'panel', label: '登记藏', panel: 'cang', face: CANG_DRAWER_FACE },
    ]
    const store = storeOf(twoDoors)

    // 累加表按 key 去重只剩 1 条 —— 所以绝不能用并集判「入口唯一」。
    expect(store.entries.size).toBe(1)
    // 快照里是 2 扇门，判定必须红。
    expect(entriesInWorstSnapshot(store, CANG_DRAWER_FACE)).toHaveLength(2)
    const verdict = N_ASSERTIONS['N-001'](navFactsFor('N-001', CANG_DRAWER_FACE, store))
    expect(verdict.pass, '两扇同名门被同名去重吃掉了：判据失去牙').toBe(false)
    expect(verdict.message).toContain('同一次采样里有 2 个入口')
  })
})

/* ───────────────────────── mounts-drawer ───────────────────────── */

describe('票 69 · mounts-drawer：门厅里那扇门只有「临时挂载…」', () => {
  it('状态栏退回纯读数：数字照旧常驻，但不再是第二扇门', () => {
    const html = render(h(XsMountSection, {
      mounts: [],
      status: { keptChars: 0, budget: 60_000, keptLayers: 0, totalLayers: 0, overBudget: false },
      canMount: true,
      revision: 1,
      onOpen: () => {},
    }))
    const doors = doorsFor(html, 'mounts-drawer')

    expect(doors.map((door) => door.label)).toEqual(['临时挂载…'])
    expect(judgeN001(MOUNTS_DRAWER_FACE, doors).pass, '门厅里还有两扇门').toBe(true)
    // 「常驻锚点」是 C7 的要求：数还在，只是不再兼作入口。
    expect(html).toContain('挂载 0 字 / 预算 60,000 字')
  })
})
