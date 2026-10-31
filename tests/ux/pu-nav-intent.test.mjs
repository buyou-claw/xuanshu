/**
 * fix/ux-nav-intent · 谱面板的两条**跨面板意图**（建一个谱 / 看这张谱）+ 判据 N-001 的落点。
 *
 * 要解决的不是「实现没写完」，是**两个权威打架**：
 *   - 判据 N-001（`docs/design/ui-v1/criteria/rules/N.json`）：同一个动作出现在两个及以上入口即红；
 *   - 设计稿 S7（`docs/design/ui-v1/screens/S7-问事历史回看.md:65`）：历史首次空态**必须**有
 *     「主按钮（去开一次问事）+ 次按钮（先建谱）」。
 * 三处调用点原先都只是 `navigate('pus')`（侧栏行 / 问事历史空态 / 沉淀完成与沉淀通知），
 * 于是「谱管理」这一个动作有 3 扇门。修法不是删掉 S7 要的那颗按钮，而是让它们**变成不同的动作**：
 * 「建一个谱」和「看这张谱」各自带一条意图进谱面板 —— 门还在，动作不一样了。
 *
 * 这份用例钉在两道缝上（都在 Node 里点得到，不需要 DOM）：
 *   1. **元素树**：`XsConsultHistoryList` 是不带 hook 的纯函数，直接调用拿回元素树，
 *      取出那颗次按钮并**真的触发它自己的 onClick**（SSR 字符串里没有处理器，所以读树不读串）；
 *   2. **模块级意图槽**：`requestPuCreate*` / `requestPuOpen*` 之后 `renderToStaticMarkup` 谱面板，
 *      断言初始视图真的进了 `create` 第 1 步 / `detail` —— 这就是「不是单纯跳列表」的证据。
 *
 * 显式让开的（不装成验过）：`consult.tsx` / `sediment-views.tsx` 里那两行**接线**
 * （把 `() => requestPuCreateAndGo(navigate)` 塞进 prop / onClick）没有用例点得到 ——
 * SSR 摸不到组件内部的分支，那一行的类型由 `tsc` 管。交付报告里按「未覆盖」记。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import {
  consumePuIntent,
  installPuPanel,
  requestPuCreate,
  requestPuCreateAndGo,
  requestPuOpen,
  requestPuOpenAndGo,
} from '../../packages/xuanshu-client/src/client/PuPanel.tsx'
import { XsConsultHistoryList } from '../../packages/xuanshu-client/src/client/consult-views.tsx'
import { XsSedimentNotice } from '../../packages/xuanshu-client/src/client/sediment-views.tsx'
import { N_ASSERTIONS } from '../../scripts/ux/assertions/n.mjs'
import { actionOfLabel } from '../../scripts/ux/nav-vocabulary.mjs'

const render = (element) => renderToStaticMarkup(element)

/* ───────────────────────── 谱面板（从加性注册里取回组件） ───────────────────────── */

/**
 * 谱面板组件本身没有直接导出：它由 `installPuPanel` 注册进 `main` 槽。
 * 这里给一个**够用即可**的假 ctx（渲染期只用到 `slots`；`rpcCall` 全在事件/effect 里）。
 */
function puPanelComponent() {
  const registered = []
  const ctx = {
    slots: {
      inject: (_name, run) => { run() },
      register: (meta, component) => { registered.push({ meta, component }); return { dispose: () => {} } },
    },
  }
  installPuPanel(ctx)
  const main = registered.find((entry) => entry.meta.name === 'main')
  expect(main, '谱面板没注册进 main 槽').toBeDefined()
  return main.component
}

const panel = () => render(h(puPanelComponent(), { ctx: { slots: {} } }))

/** 一张谱的视图（字段与 `SedimentPuView` 同形，所以两条入口都能把同一份东西递进来）。 */
const PU = {
  slug: 'shiye-yu-hangye',
  name: '事业与行业',
  level: 'optional',
  description: '我的职业侧面',
  body: '# 概览\n在制造业做工程',
  summary: '制造业工程',
  source: 'sediment',
  updatedAt: '2026-10-31T09:00:00+08:00',
}

// 意图槽是模块级状态：每个用例自己收拾，免得一条红了把下一条也带红。
afterEach(() => { consumePuIntent() })

/* ───────────────────────── 意图 → 面板初始视图 ───────────────────────── */

describe('谱面板的意图：设了就要**进到那一步**，不是跳回列表', () => {
  it('建谱意图：进建谱向导第 1 步（向导步骤条 + 第 1 步的资料输入，不是列表）', () => {
    requestPuCreate()
    const html = panel()
    expect(html).toContain('aria-label="创建步骤"')
    expect(html).toContain('把你知道的先写进来')
    expect(html, '还停在列表上（列表里那颗「＋ 创建新谱」不是向导）').not.toContain('正在读取谱…')
  })

  it('打开意图：直接进详情，标题挂着那张谱的名字、正文就在编辑面里', () => {
    requestPuOpen(PU)
    const html = panel()
    expect(html).toContain(`谱管理 / ${PU.name}`)
    expect(html).toContain('在制造业做工程')
    expect(html).not.toContain('aria-label="创建步骤"')
  })

  it('意图**消费一次即清空**：销账之后再渲染谱面板就回到列表（下次切回来不自动弹向导）', () => {
    requestPuCreate()
    expect(panel(), '设了意图却没进向导').toContain('aria-label="创建步骤"')

    // 面板挂载后的那一遍销账（组件里由 effect 调它；SSR 不跑 effect，所以这里直接调）。
    expect(consumePuIntent()).toMatchObject({ kind: 'create' })

    const html = panel()
    expect(html, '意图没清掉：切回谱面板又自己弹向导了').not.toContain('aria-label="创建步骤"')
    expect(html).toContain('<h1>谱管理</h1>')
  })

  it('严格模式的双挂载：两遍渲染读到的是**同一份**意图（不被第一遍吃掉，也不会弹两次）', () => {
    // 严格模式会把组件函数（含 useState 初始化器）跑两遍。若初始化器里就地清空，
    // 第二遍就读不到意图 —— 向导被吃掉一次，而这正是这次改动最容易翻车的地方。
    requestPuCreate()
    const first = panel()
    const second = panel()
    expect(first).toContain('aria-label="创建步骤"')
    expect(second).toContain('aria-label="创建步骤"')
    // 两遍都读完，槽里还剩着（清空只发生在 effect 那一遍，见组件注释）。
    expect(consumePuIntent()).toMatchObject({ kind: 'create' })
  })

  it('两条「设意图 + 跳面板」的接线：成对发生（只设意图不跳，向导不会自己出现）', () => {
    const visited = []
    requestPuCreateAndGo((target) => { visited.push(target) })
    expect(visited).toEqual(['pus'])
    expect(panel()).toContain('aria-label="创建步骤"')

    consumePuIntent()
    requestPuOpenAndGo(PU, (target) => { visited.push(target) })
    expect(visited).toEqual(['pus', 'pus'])
    expect(panel()).toContain(`谱管理 / ${PU.name}`)
  })
})

/* ───────────────────────── 问事历史空态：次按钮 ───────────────────────── */

/** 按标记在元素树里找第一个满足条件的宿主元素（元素树是 React 的公开输出，不是内部结构）。 */
function findByProp(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByProp(child, predicate)
      if (found !== undefined) return found
    }
    return undefined
  }
  const props = node.props ?? {}
  if (predicate(props) === true) return node
  return findByProp(props.children, predicate)
}

const listProps = (over = {}) => ({
  items: [],
  loading: false,
  error: undefined,
  query: '',
  range: 'all',
  now: new Date('2026-10-31T09:00:00+08:00'),
  onQuery: () => {},
  onRange: () => {},
  onOpen: () => {},
  onBack: () => {},
  onStart: () => {},
  onCreatePu: () => {},
  onRetry: () => {},
  ...over,
})

describe('问事历史空态的次按钮（S7:65）：动作是「先建一个谱」，不是谱管理的第二扇门', () => {
  it('次按钮在册、叫「先建一个谱」，点了触发的是它自己的 onCreatePu', () => {
    const clicks = []
    // 不带 hook 的组件可以直接当函数调：拿回的是元素树，于是**处理器**也在手上。
    const tree = XsConsultHistoryList(listProps({ onCreatePu: () => { clicks.push('create-pu') } }))
    const button = findByProp(tree, (props) => props['data-xuanshu-action'] === 'create-pu')

    expect(button, '历史空态里没有建谱那颗次按钮（S7 要求主按钮 + 次按钮）').toBeDefined()
    expect(button.props.children).toBe('先建一个谱')
    // 它不再是「谱管理」那扇门：不挂 `data-xuanshu-nav`，别把同一动作再指一次。
    expect(Object.keys(button.props)).not.toContain('data-xuanshu-nav')

    button.props.onClick()
    expect(clicks).toEqual(['create-pu'])
  })

  it('点它之后谱面板真的进了建谱向导（这条链的终点，而不是「跳去了列表」）', () => {
    const tree = XsConsultHistoryList(listProps({ onCreatePu: () => { requestPuCreateAndGo(() => {}) } }))
    const button = findByProp(tree, (props) => props['data-xuanshu-action'] === 'create-pu')

    button.props.onClick()
    expect(panel(), '点了次按钮却没进建谱向导（只跳列表就不算动作变了）').toContain('aria-label="创建步骤"')
  })
})

/* ───────────────────────── N-001：谱管理只剩侧栏那一扇门 ───────────────────────── */

/** 一串 HTML 里「动作名 = 谱管理」的按钮（与采集器同一张动作表，见 `actionOfLabel`）。 */
function pusDoorsIn(html) {
  const doors = []
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu)) {
    const label = match[2].replace(/<[^>]*>/gu, '').replace(/&gt;/gu, '>').replace(/\s+/gu, ' ').trim()
    const action = actionOfLabel(label)
    if (action !== undefined && action.id === 'pus') doors.push(label)
  }
  return doors
}

describe('N-001 · panel:pus：三处入口变成三个不同动作之后，谱管理只剩侧栏行', () => {
  it('历史空态那枚次按钮不再匹配「谱管理」的动作名（侧栏行「谱」仍然是唯一那一个）', () => {
    expect(pusDoorsIn(render(h(XsConsultHistoryList, listProps())))).toEqual([])
    expect(actionOfLabel('先建一个谱'), '「先建一个谱」被当成了谱管理').toBeUndefined()
    expect(pusDoorsIn('<button type="button">谱</button>')).toEqual(['谱'])
  })

  it('判据仍有牙：把旧的「管理谱 ▸ S5」与侧栏行放进同一份快照，N-001 必然红', () => {
    // 这条不是给现在的界面看的，是钉住口径：改的是**动作**，不是把判据喂瞎。
    const verdict = N_ASSERTIONS['N-001']({
      face: 'panel:pus',
      action: { id: 'pus', label: '谱管理' },
      entries: [
        { primitive: 'sidebar-row', label: '谱', panel: 'conversation' },
        { primitive: 'panel', label: '管理谱 ▸ S5', panel: 'consult' },
      ],
      snapshot: { index: 0, doors: 2, samples: 2 },
    })
    expect(verdict.pass).toBe(false)
    expect(verdict.message).toContain('2 个入口')
  })

  it('动作换名之后同一份快照只有 1 个入口 → N-001 判绿', () => {
    const verdict = N_ASSERTIONS['N-001']({
      face: 'panel:pus',
      action: { id: 'pus', label: '谱管理' },
      entries: [{ primitive: 'sidebar-row', label: '谱', panel: 'conversation' }],
      snapshot: { index: 0, doors: 1, samples: 2 },
    })
    expect(verdict.pass, verdict.message).toBe(true)
  })
})

/* ───────────────────────── 沉淀通知：看这张谱 ───────────────────────── */

/** 通知只读控制器三个成员（订阅式快照 + 关掉），不需要 api / 会话。 */
const noticeController = (pu) => {
  let notice = { pu }
  return {
    subscribe: () => () => {},
    getNotice: () => notice,
    dismissNotice: () => { notice = undefined },
  }
}

describe('沉淀通知的「看这张谱」：动作换了名，带的是**打开意图**', () => {
  it('按钮叫「看这张谱 ->」、带自己那颗动作标记，也不再是谱管理的第二扇门', () => {
    const html = render(h(XsSedimentNotice, { controller: noticeController(PU), navigate: () => {} }))
    expect(html).toContain('看这张谱 -&gt;')
    expect(html).toContain('data-xuanshu-action="sediment-open-pu"')
    expect(html, '还挂着 data-xuanshu-nav="pus"：那还是「谱管理」那一扇门').not.toContain('data-xuanshu-nav="pus"')
    expect(actionOfLabel('看这张谱 ->')).toBeUndefined()
    expect(pusDoorsIn(html)).toEqual([])
  })

  it('这条链的终点：通知手里那份谱真的被送进详情（不是只跳到列表）', () => {
    const visited = []
    // 通知拿得到 `notice.pu`（`sediment-model.ts` 的 `SedimentNotice.pu`），所以这一处用 open 而不是裸跳。
    requestPuOpenAndGo(PU, (target) => { visited.push(target) })
    expect(visited).toEqual(['pus'])
    expect(panel()).toContain(`谱管理 / ${PU.name}`)
  })
})
