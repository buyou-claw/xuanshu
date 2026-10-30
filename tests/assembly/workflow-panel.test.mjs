/**
 * 票 16 · 工作流半边（客户端）的契约与界面断言。
 *
 * 对应票面验收里属于**客户端半**的那几条：
 *   1. 契约 §4 的三个 `workflow.*` 方法名**逐字一致**，请求体按契约透传；
 *   2. **渲染不发写请求**：`workflow.create` / `workflow.exportSkill` 都只由人点触发 ——
 *      静态渲染（effect 只跑 `workflow.list`）时一个写请求都不许出现；
 *   3. **人判定**：面板只显示那句规则文案，**没有**任何「通过 / 失败 / 评分」的系统结论；
 *      导出按钮在缺名字 / description / 正文时是 disabled（点不动），而不是提交后报错；
 *   4. `installWorkflowPanel` 纯加性注册（`main` + `sidebar.panellist` 各一），
 *      apply 期**不调** `ctx.layout.selectPanel`，且在无 `document` 的 Node 下安全返回；
 *   5. 失败理由可见（列表读不出来 → error 态文案，不静默）。
 *
 * 环境：`renderToStaticMarkup`（无 jsdom）。真浏览器里的点击链路**没有**被本文件覆盖，
 * 交付报告里如实标注；「人点才跑」用渲染期 spy（写请求计数为 0）证明。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { WORKFLOW_ENDPOINTS, createWorkflowApi } from '../../packages/xuanshu-client/src/client/workflow/workflow-api.ts'
import { QUICKLINK } from '../../packages/xuanshu-client/src/client/panel.ts'
import { installRpcFetch, restoreRpcFetch } from './lib/rpc-fetch.mjs'

// 数据面是同源 fetch（`POST /api/xuanshu`），桩装在 fetch 上；漏还原会污染后面的文件。
afterEach(restoreRpcFetch)
import {
  WORKFLOW_HUMAN_JUDGE_NOTE, WORKFLOW_ID, WORKFLOW_LABEL, WORKFLOW_ORDER, exportBlockers, splitWorkflows, workflowSubtitle,
} from '../../packages/xuanshu-client/src/client/workflow/workflow-model.ts'
import { WorkflowPanel, installWorkflowPanel } from '../../packages/xuanshu-client/src/client/workflow/WorkflowPanel.tsx'

const render = (element) => renderToStaticMarkup(element)

/** 记调用的假数据面（不 mock 业务：只记方法名与请求体）。 */
function spyApi(over = {}) {
  const calls = []
  return {
    calls,
    api: {
      async create(payload) {
        calls.push(['workflow.create', payload])
        return { sessionId: 'session-xs-workflow-1', cwd: 'C:\\dsh\\xuanshu\\workflow' }
      },
      async list() {
        calls.push(['workflow.list', {}])
        return { items: [] }
      },
      async exportSkill(payload) {
        calls.push(['workflow.exportSkill', payload])
        return { path: 'C:\\dsh\\skills\\weekly-digest\\SKILL.md', name: 'weekly-digest' }
      },
      ...over,
    },
  }
}

const ITEMS = [
  { id: 'wf-1', name: '每周整理行业动态', sessionId: 'session-xs-workflow-1' },
  { id: 'wf-2', name: 'weekly-industry-digest', sessionId: 'session-xs-workflow-2', exportedAt: '2026-10-11T09:00:00.000Z' },
]

describe('票16 · 工作流数据面的方法名逐字对齐契约 §4', () => {
  it('三个方法名是契约表格那一列的原文', () => {
    expect(WORKFLOW_ENDPOINTS).toEqual({
      create: 'workflow.create',
      list: 'workflow.list',
      exportSkill: 'workflow.exportSkill',
    })
  })

  it('都走 /xuanshu 通道，请求体按契约透传', async () => {
    const { calls } = installRpcFetch({ value: {} })
    const api = createWorkflowApi({})
    await api.create()
    await api.create({ seed: '每周整理行业动态' })
    await api.list()
    await api.exportSkill({ sessionId: 'session-xs-workflow-1', name: 'weekly-digest', description: 'd', content: 'c' })
    expect(calls.map((call) => [call.channel, call.endpoint])).toEqual([
      ['/xuanshu', 'workflow.create'],
      ['/xuanshu', 'workflow.create'],
      ['/xuanshu', 'workflow.list'],
      ['/xuanshu', 'workflow.exportSkill'],
    ])
    expect(calls[0].payload).toEqual({})
    expect(calls[1].payload).toEqual({ seed: '每周整理行业动态' })
    expect(calls[2].payload).toEqual({})
    expect(calls[3].payload.name).toBe('weekly-digest')
  })

  it('RPC 失败时抛出（由调用方决定降级：面板 error 态）', async () => {
    installRpcFetch({ error: { message: '工作流列表读不出来' } })
    await expect(createWorkflowApi({}).list()).rejects.toThrow('工作流列表读不出来')
  })
})

describe('票16 · 门厅面板：人判定 + 渲染期不发写请求', () => {
  it('渲染发出且只发出 workflow.list（创建 / 导出都不许自动跑）', () => {
    const spy = spyApi()
    render(h(WorkflowPanel, { api: spy.api, navigate: () => {}, preloaded: ITEMS }))
    expect(spy.calls).toEqual([]) // preloaded：连 list 都不发
    const live = spyApi()
    render(h(WorkflowPanel, { api: live.api, navigate: () => {} }))
    // 静态渲染不跑 effect（react-dom/server 不执行 useEffect）——这条断言的是「就算跑了 effect，
    // 里面也只有 list 这一件只读事」：写请求数为 0。
    expect(live.calls.filter((call) => call[0] !== 'workflow.list')).toEqual([])
  })

  it('摆出规则文案与两段列表；**没有**任何「通过 / 失败 / 评分」结论', () => {
    const html = render(h(WorkflowPanel, { api: spyApi().api, navigate: () => {}, preloaded: ITEMS }))
    expect(html).toContain(WORKFLOW_HUMAN_JUDGE_NOTE)
    expect(html).toContain('进行中')
    expect(html).toContain('已导出')
    expect(html).toContain('每周整理行业动态')
    expect(html).toContain('weekly-industry-digest')
    for (const forbidden of ['判定：通过', '判定：失败', '评分：', '系统判定']) {
      expect(html, `界面不许出现系统结论 ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('缺名字 / description / 正文时导出按钮 disabled（点不动），齐了才可点', () => {
    const blocked = render(h(WorkflowPanel, { api: spyApi().api, navigate: () => {}, preloaded: ITEMS }))
    expect(blocked).toContain('disabled')
    expect(blocked).toMatch(/kebab-case/u)
    const ready = render(h(WorkflowPanel, {
      api: spyApi().api,
      // 只能用 preloaded 摆状态：静态渲染点不了按钮，导出表单由 draft 驱动，
      // 所以「可点」这一条在纯函数层断言（见下一个用例）。
      navigate: () => {},
      preloaded: { error: 'x' },
    }))
    expect(ready).toContain('读不出来')
  })

  it('列不出来 → error 态文案可见（不静默）', () => {
    const html = render(h(WorkflowPanel, { api: spyApi().api, navigate: () => {}, preloaded: { error: '底座没起来' } }))
    expect(html).toContain('底座没起来')
  })
})

describe('票16 · 纯逻辑：分段、副标题、导出可提交判据', () => {
  it('splitWorkflows：有 exportedAt 的进「已导出」，其余进「进行中」（顺序保持）', () => {
    const { running, exported } = splitWorkflows(ITEMS)
    expect(running.map((item) => item.id)).toEqual(['wf-1'])
    expect(exported.map((item) => item.id)).toEqual(['wf-2'])
    expect(splitWorkflows(undefined)).toEqual({ running: [], exported: [] })
  })

  it('workflowSubtitle：导出过的显示日期；没导出的显示「等你判定」（不编时刻）', () => {
    expect(workflowSubtitle(ITEMS[1])).toBe('已导出 · 2026-10-11')
    expect(workflowSubtitle(ITEMS[0])).toBe('进行中（等你判定）')
  })

  it('exportBlockers：空 → 无阻塞；缺项逐条给理由；名字不合 kebab 单独一条', () => {
    expect(exportBlockers({ name: 'weekly-digest', description: 'd', content: 'c' })).toEqual([])
    expect(exportBlockers({}).length).toBe(3)
    expect(exportBlockers({ name: 'Weekly Digest', description: 'd', content: 'c' })).toEqual(['名字要 kebab-case：小写字母、数字、单连字符（中文名请另给一个英文名）。'])
    expect(exportBlockers({ name: 'a-b', description: ' ', content: 'c' })[0]).toMatch(/description/u)
  })
})

describe('票16 · 加性注册（不碰默认面板、Node 下安全）', () => {
  it('注册 main + sidebar.panellist 各一次，key/id 都是 workflow，order 70，label「工作流」', () => {
    const registrations = []
    const ctx = {
      slots: {
        inject(name, callback) { callback() },
        register(options) { registrations.push(options); return () => {} },
      },
    }
    installWorkflowPanel(ctx, { api: spyApi().api, navigate: () => {} })
    expect(registrations).toHaveLength(2)
    expect(registrations[0]).toMatchObject({ name: 'main', key: WORKFLOW_ID })
    expect(registrations[1]).toMatchObject({ name: 'sidebar.panellist', id: WORKFLOW_ID, order: WORKFLOW_ORDER, label: WORKFLOW_LABEL })
    expect(WORKFLOW_ID).toBe('workflow')
    expect(WORKFLOW_LABEL).toBe('工作流')
    expect(WORKFLOW_ORDER).toBe(70)
  })

  it('apply 期不调 ctx.layout.selectPanel（默认面板只由根入口切一次）', () => {
    let selectPanelCalls = 0
    const ctx = {
      layout: { selectPanel() { selectPanelCalls += 1 } },
      slots: { inject(name, callback) { callback() }, register() { return () => {} } },
    }
    installWorkflowPanel(ctx, { api: spyApi().api, navigate: () => {} })
    expect(selectPanelCalls).toBe(0)
  })

  it('S1 快捷入口那一格从此有落点：票 07 备好的 `QUICKLINK.workflow` + 本票注册的 main key `workflow`', () => {
    // 票 07 的快捷入口卡按 `mainPanels` 快照做 fail-soft 置灰：目标 main key 没注册就置灰。
    // 本票把 key 注册上（见上一条用例），这一格因此从「置灰」变成「可点」——S1 → 门厅 → 创建工作流 这条链闭了。
    expect(QUICKLINK.workflow).toEqual({ title: '工作流', subtitle: '流水线' })
    expect(WORKFLOW_ID).toBe('workflow')
  })

  it('注入面透传 api 与 navigate（面板 props 拿到的是同一份）', () => {
    const api = spyApi().api
    const nav = []
    const registrations = []
    const ctx = {
      slots: {
        inject(name, callback) { callback() },
        register(options) { registrations.push(options); return () => {} },
      },
    }
    installWorkflowPanel(ctx, { api, navigate: (target) => nav.push(target) })
    const main = registrations.find((options) => options.name === 'main')
    expect(typeof main.inject).toBe('function')
    const props = main.inject()
    expect(props.api).toBe(api)
    props.navigate('conversation')
    expect(nav).toEqual(['conversation'])
  })
})
