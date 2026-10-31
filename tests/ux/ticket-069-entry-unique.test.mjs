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
 *   - `cang-drawer`：**同一原语真重复**，且只在空态同时出现（工具条「登记藏」+ 空态「登记第一个藏」）
 *     → 空态只留一个门（空态那个，它是 #68 补的可执行空态）。
 *   - `mounts-drawer`：**同一原语真重复**，门厅里「临时挂载…」与状态栏（点开同一个抽屉）同时可点
 *     → 门留给「临时挂载…」，状态栏退回纯读数（C7 要的「挂载 N 字 / 预算 M 字」照旧常驻）。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CangPanel } from '../../packages/xuanshu-client/src/client/CangPanel.tsx'
import { XsConsultPicker } from '../../packages/xuanshu-client/src/client/consult-views.tsx'
import { XsMountSection } from '../../packages/xuanshu-client/src/client/mounts-views.tsx'
import { N_ASSERTIONS } from '../../scripts/ux/assertions/n.mjs'
import { NAV_ACTIONS, actionOfLabel } from '../../scripts/ux/nav-vocabulary.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')

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
    entries.push({ primitive: 'panel', label, actionId: action.id })
  }
  return entries
}

/** 某个动作在这个面里被几扇门指着（只给 id 与文案，够写 message 用）。 */
function doorsFor(html, actionId) {
  return census(html).filter((entry) => entry.actionId === actionId)
}

/** 入口表 → `N-001` 的 facts（判定谓词只吃这个形状）。 */
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

/* ───────────────────────── panel:pus ───────────────────────── */

describe('票 69 · panel:pus：谱管理的那一跳只留侧栏行', () => {
  it('藏库面板不再给第二扇门（「查看谱」删掉，改谱的路径点名侧栏行）', () => {
    const html = render(h(CangPanel, { api: {}, controller: CANG_CONTROLLER, initialData: { registryPath: 'registry.jsonl', entries: [] } }))
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

  it('壳（consult.tsx）里也没有第二扇门：这一处 SSR 起不来，退一步按源码断言', () => {
    // consult.tsx 是状态机壳（取数 + 会话切换），`renderToStaticMarkup` 起不来它，
    // 所以这里断源码：壳里不许再有「点一下就切到谱管理」的接线。
    const source = readFileSync(join(REPO_ROOT, 'packages/xuanshu-client/src/client/consult.tsx'), 'utf8')
    expect(source, '壳里还留着去谱管理的按钮').not.toContain('goto-manage-pu')
    // 壳里只剩**一处**切到谱管理的接线，而且只能是历史子页空态那枚**次按钮**。
    // 为什么留它：`docs/design/ui-v1/screens/S7-问事历史回看.md:65` 明文要求首次空态
    // 「主按钮（去 S6 开一次问事）+ 次按钮（先建谱）」—— 那个次按钮只能是这一跳。删它等于
    // 在没有替代次动作的情况下撕掉 S7，这要人来裁决，所以本轮只把它记在这里当已知例外：
    // 历史子页不在入口采样状态里（剧本只「打开 → 退回」，不采入口），故不影响本票三面转绿；
    // 一旦剧本开始采历史子页，`panel:pus` 会因它再红一次。
    const pusJumps = [...source.matchAll(/navigate\('pus'\)/gu)]
    expect(pusJumps, '壳里切到谱管理的接线不止历史空态那一处').toHaveLength(1)
    expect(source).toContain('onManagePu={() => { navigate(\'pus\'); }}')
  })

  it('把三个面采到的入口并成一张表（采集器是跨采样累加的）：谱管理只剩侧栏行一个 → N-001 判绿', () => {
    // 侧栏行不在这些组件的渲染里（它由 `sidebar.panellist` 槽注册，标「谱」）：按浏览器会看到的
    // 那一条补进来 —— 这正是「唯一的那扇门」本身，不是补偿出来的假入口。
    const entries = [
      { primitive: 'sidebar-row', label: '谱', panel: 'conversation' },
      ...census(render(h(CangPanel, { api: {}, controller: CANG_CONTROLLER, initialData: { registryPath: 'registry.jsonl', entries: [] } }))),
      ...census(render(h(XsConsultPicker, PICKER_PROPS))),
    ].filter((entry) => entry.actionId === undefined || entry.actionId === 'pus')
      .map((entry) => ({ primitive: entry.primitive, label: entry.label, panel: entry.panel ?? 'consult' }))

    const verdict = judgeN001('panel:pus', entries)
    expect(verdict.pass, verdict.message).toBe(true)
    expect(entries).toHaveLength(1)
  })
})

/* ───────────────────────── cang-drawer ───────────────────────── */

describe('票 69 · cang-drawer：登记藏只有一个门（空态不再多一个）', () => {
  it('空态：只有空态里那一个「登记第一个藏」，工具条不再并排第二个', () => {
    const html = render(h(CangPanel, { api: {}, controller: CANG_CONTROLLER, initialData: { registryPath: 'registry.jsonl', entries: [] } }))
    const doors = doorsFor(html, 'cang-drawer')

    expect(doors.map((door) => door.label)).toEqual(['登记第一个藏'])
    const verdict = judgeN001('slot:shell.overlay#xuanshu-cang-drawer', doors)
    expect(verdict.pass, verdict.message).toBe(true)
  })

  it('有藏时：只剩工具条那一个「登记藏」（卡里的「编辑登记」在收起的「更多操作」里，不算门）', () => {
    const html = render(h(CangPanel, { api: {}, controller: CANG_CONTROLLER, initialData: { registryPath: 'registry.jsonl', entries: [CANG_ENTRY] } }))
    const doors = doorsFor(html, 'cang-drawer')

    expect(doors.map((door) => door.label)).toEqual(['登记藏'])
    expect(judgeN001('slot:shell.overlay#xuanshu-cang-drawer', doors).pass).toBe(true)
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
    expect(judgeN001('slot:shell.overlay#xuanshu-mounts-drawer', doors).pass, '门厅里还有两扇门').toBe(true)
    // 「常驻锚点」是 C7 的要求：数还在，只是不再兼作入口。
    expect(html).toContain('挂载 0 字 / 预算 60,000 字')
  })
})
