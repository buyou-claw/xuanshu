/**
 * 票 28 · 客户端多处并列：路由选择器 + 跑前 estimate/确认 + same-source 判官文案。
 *
 * 全部打在纯函数 / 纯展示层（无 DOM）：状态机的请求序列用**记录型假数据面**验，
 * 界面用 `renderToStaticMarkup` 验。三条硬线：
 *   ① `ask` 只做**只读**的 routes.list + estimate，不调 run；人点「开始合参」才带 `confirm:true` 发 run；
 *   ② 确认屏必须列 N 路 × provider/model × 输入规模（标注估算）+「金额未知」，并显示每家 key 配置三态；
 *   ③ `judge.mode === 'same-source'` 如实显示「判官与候选同源」，不冒充异源判官。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  bestofPhase,
  createBestofController,
  defaultRouteSelection,
  estimateInputLabel,
  estimatePriceLabel,
  flattenCatalogRoutes,
  judgeSameSource,
  judgeSourceNotice,
  keyConfiguredLabel,
  routeKey,
  routeSelectionProblem,
} from '../../packages/xuanshu-client/src/client/bestof-model.ts'
import {
  XsBestofCandidateCard,
  XsBestofCostConfirm,
  XsBestofJudgePanel,
  XsBestofOverlay,
} from '../../packages/xuanshu-client/src/client/bestof-views.tsx'

const SESSION = 'session-xs-consult-9f8e7d6c-0000-4000-8000-000000000000'
const noop = () => {}

const actions = {
  onEditQuestion: noop,
  onStart: noop,
  onCancel: noop,
  onStop: noop,
  onAdopt: noop,
  onMerge: noop,
  onReject: noop,
  onRetry: noop,
  onToggleRoute: noop,
}

const CATALOG = {
  schema: 'xuanshu/routes@1',
  ok: true,
  default: { provider: 'deepseek', model: 'deepseek-chat' },
  providers: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      registered: true,
      keyConfigured: true,
      isDefault: true,
      modelsKnown: true,
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', isDefault: true }],
    },
    {
      id: 'pi-ai',
      name: 'Pi AI',
      registered: true,
      keyConfigured: false,
      isDefault: false,
      modelsKnown: true,
      models: [{ id: 'pi-chat', name: 'Pi Chat', isDefault: false }],
    },
    {
      id: 'glm',
      name: 'GLM',
      registered: true,
      keyConfigured: 'unknown',
      isDefault: false,
      modelsKnown: true,
      models: [{ id: 'glm-4', name: 'GLM-4', isDefault: false }],
    },
  ],
  configurable: [{ id: 'openrouter', name: 'OpenRouter', keyConfigured: 'unknown' }],
  failures: [],
}

const ESTIMATE = {
  routes: [
    { provider: 'deepseek', model: 'deepseek-chat', modelName: 'DeepSeek Chat' },
    { provider: 'pi-ai', model: 'pi-chat', modelName: 'Pi Chat' },
  ],
  inputTokens: 1234,
  price: 'unknown',
}

/** 记录型假数据面（形状照 `createBestofApi`；多 provider 面加进来）。 */
function fakeApi(handlers = {}) {
  const calls = []
  const api = {
    async listRoutes() {
      calls.push(['listRoutes', {}])
      if (handlers.listRoutes) return handlers.listRoutes()
      return CATALOG
    },
    async estimate(payload) {
      calls.push(['estimate', payload])
      if (handlers.estimate) return handlers.estimate(payload)
      return ESTIMATE
    },
    async run(payload) {
      calls.push(['run', payload])
      if (handlers.run) return handlers.run(payload)
      return {
        runId: 'bestof-1',
        sessionId: SESSION,
        question: payload.question,
        candidates: [],
        judge: { mode: 'pending', adoptedId: null, ranking: [] },
        adoptedId: null,
        rejected: false,
        finished: false,
      }
    },
    async state(payload) {
      calls.push(['state', payload])
      if (handlers.state) return handlers.state(payload)
      return {
        runId: 'bestof-1',
        sessionId: SESSION,
        question: '问一句',
        candidates: [
          { id: 'c1', angle: 'classic', provider: 'deepseek', model: 'deepseek-chat', status: 'done', text: '第一份。' },
        ],
        judge: { mode: 'tool', adoptedId: 'c1', ranking: ['c1'], source: 'cross-source' },
        adoptedId: null,
        rejected: false,
        finished: true,
      }
    },
    async adopt(payload) {
      calls.push(['adopt', payload])
      return { bestOf: { ...(await api.state({ runId: 'bestof-1' })), adoptedId: payload.adoptedId ?? 'merged' } }
    },
    async cancel(payload) {
      calls.push(['cancel', payload])
      return { bestOf: { ...(await api.state({ runId: 'bestof-1' })), finished: true } }
    },
  }
  return { calls, api }
}

async function settle(controller, predicate, { timeout = 500 } = {}) {
  const started = Date.now()
  while (!predicate(controller.snapshot())) {
    if (Date.now() - started > timeout) break
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  return controller.snapshot()
}

describe('pure view-model · 路由目录与 estimate 文案', () => {
  it('routeKey 按 provider::model；flattenCatalogRoutes 列出可选路由 + key 三态', () => {
    expect(routeKey({ provider: 'deepseek', model: 'deepseek-chat' })).toBe('deepseek::deepseek-chat')
    const options = flattenCatalogRoutes(CATALOG)
    expect(options.map((option) => option.label)).toEqual([
      'deepseek · DeepSeek Chat',
      'pi-ai · Pi Chat',
      'glm · GLM-4',
    ])
    expect(options.map((option) => option.keyConfigured)).toEqual([true, false, 'unknown'])
    expect(options[0].isDefault).toBe(true)
    // 可配置但未注册的家不在可选列表里（它没有 model，不能当候选）。
    expect(options.some((option) => option.provider === 'openrouter')).toBe(false)
  })

  it('defaultRouteSelection：默认路由在前，优先另一家 provider；去重且上限 4', () => {
    const selected = defaultRouteSelection(CATALOG)
    expect(selected).toEqual([
      { provider: 'deepseek', model: 'deepseek-chat' },
      { provider: 'pi-ai', model: 'pi-chat' },
    ])
    expect(routeSelectionProblem(selected)).toBeUndefined()
    expect(routeSelectionProblem([{ provider: 'deepseek', model: 'deepseek-chat' }])).toMatch(/至少两路/u)
    expect(routeSelectionProblem([
      { provider: 'a', model: 'm' },
      { provider: 'b', model: 'm' },
      { provider: 'c', model: 'm' },
      { provider: 'd', model: 'm' },
      { provider: 'e', model: 'm' },
    ])).toMatch(/最多四路/u)
    expect(routeSelectionProblem([
      { provider: 'a', model: 'm' },
      { provider: 'a', model: 'm' },
    ])).toMatch(/重复/u)
  })

  it('keyConfiguredLabel / estimate 文案：未知不写成「缺 key」，金额永远未知', () => {
    expect(keyConfiguredLabel(true)).toBe('已配 key')
    expect(keyConfiguredLabel(false)).toBe('缺 key')
    expect(keyConfiguredLabel('unknown')).toBe('未知')
    expect(estimateInputLabel(ESTIMATE)).toBe('≈ 1234 tokens/路（估算）')
    expect(estimatePriceLabel(ESTIMATE)).toBe('金额未知')
  })

  it('judge same-source 如实标出（不冒充异源）', () => {
    const view = { judge: { mode: 'same-source', source: 'same-source', adoptedId: 'c1', ranking: ['c1'], error: '没有不在候选里的另一家 provider。' } }
    expect(judgeSameSource(view)).toBe(true)
    expect(judgeSourceNotice(view)).toMatch(/同源/u)
    expect(judgeSameSource({ judge: { mode: 'tool', source: 'cross-source' } })).toBe(false)
    expect(judgeSourceNotice({ judge: { mode: 'tool', source: 'cross-source', provider: 'glm', model: 'glm-4' } })).toMatch(/glm/u)
  })
})

describe('控制器 · ask → estimate → 人点确认 → run(confirm:true)', () => {
  it('ask 只做 listRoutes + estimate；人点「开始合参」才 run，且带 routes + confirm:true', async () => {
    const { api, calls } = fakeApi()
    const controller = createBestofController({ api, pollMs: 1 })
    controller.setEnabled(true)
    controller.ask({ question: '这次转岗该不该去', sessionId: SESSION })
    expect(controller.snapshot().phase).toBe('confirm')

    await settle(controller, (snapshot) => snapshot.estimate !== undefined)
    expect(calls.map((call) => call[0])).toEqual(['listRoutes', 'estimate'])
    expect(controller.snapshot().estimate.price).toBe('unknown')
    expect(controller.snapshot().routes).toEqual([
      { provider: 'deepseek', model: 'deepseek-chat' },
      { provider: 'pi-ai', model: 'pi-chat' },
    ])

    await controller.confirm()
    const run = calls.find((call) => call[0] === 'run')
    expect(run[1]).toEqual({
      sessionId: SESSION,
      question: '这次转岗该不该去',
      routes: [
        { provider: 'deepseek', model: 'deepseek-chat' },
        { provider: 'pi-ai', model: 'pi-chat' },
      ],
      confirm: true,
    })
  })

  it('改选路由 → 重新 estimate；少于两路时说清不能开跑', async () => {
    const { api, calls } = fakeApi()
    const controller = createBestofController({ api, pollMs: 1 })
    controller.setEnabled(true)
    controller.ask({ question: '问一句', sessionId: SESSION })
    await settle(controller, (snapshot) => snapshot.estimate !== undefined)

    await controller.toggleRoute({ provider: 'glm', model: 'glm-4' })
    const estimates = calls.filter((call) => call[0] === 'estimate')
    expect(estimates.at(-1)[1].routes).toEqual([
      { provider: 'deepseek', model: 'deepseek-chat' },
      { provider: 'pi-ai', model: 'pi-chat' },
      { provider: 'glm', model: 'glm-4' },
    ])

    await controller.toggleRoute({ provider: 'deepseek', model: 'deepseek-chat' })
    await controller.toggleRoute({ provider: 'pi-ai', model: 'pi-chat' })
    expect(controller.snapshot().routes).toEqual([{ provider: 'glm', model: 'glm-4' }])
    expect(routeSelectionProblem(controller.snapshot().routes)).toMatch(/至少两路/u)
    await controller.confirm()
    expect(controller.snapshot().error).toMatch(/至少两路/u)
    expect(calls.some((call) => call[0] === 'run')).toBe(false)
  })

  it('estimate 不可用（老宿主）→ 不挡人：如实标 estimateError，run 退回不带 routes 的 legacy 载荷', async () => {
    const { api, calls } = fakeApi({
      listRoutes: async () => { throw new Error('未知玄枢操作：routes.list') },
      estimate: async () => { throw new Error('未知玄枢操作：bestof.estimate') },
    })
    const controller = createBestofController({ api, pollMs: 1 })
    controller.setEnabled(true)
    controller.ask({ question: '问一句', sessionId: SESSION })
    await settle(controller, (snapshot) => snapshot.estimateError !== undefined)
    expect(controller.snapshot().estimateError).toMatch(/未知玄枢操作/u)

    await controller.confirm()
    const run = calls.find((call) => call[0] === 'run')
    expect(run[1]).toEqual({ sessionId: SESSION, question: '问一句', angles: ['classic', 'cautious'] })
  })
})

describe('确认屏 / 候选卡 / 判官区', () => {
  const state = (over = {}) => ({
    phase: 'confirm',
    enabled: true,
    question: '这次转岗该不该去',
    sessionId: SESSION,
    catalog: CATALOG,
    estimate: ESTIMATE,
    routes: ESTIMATE.routes.map(({ provider, model }) => ({ provider, model })),
    ...over,
  })

  const render = (element) => renderToStaticMarkup(element)

  it('确认屏列 N 路 × provider/model × 输入规模（估算）+ 金额未知 + key 三态 + 开始合参', () => {
    const html = render(h(XsBestofCostConfirm, { state: state(), actions }))
    expect(html).toContain('候选 2 路')
    expect(html).toContain('deepseek · DeepSeek Chat')
    expect(html).toContain('pi-ai · Pi Chat')
    expect(html).toContain('≈ 1234 tokens/路（估算）')
    expect(html).toContain('金额未知')
    expect(html).toContain('已配 key')
    expect(html).toContain('缺 key')
    expect(html).toContain('未知')
    expect(html).toContain('开始合参')
    expect(html).toContain('data-xs-bestof="routes"')
  })

  it('候选卡显示 provider（两家同名 model 才分得开）', () => {
    const html = render(h(XsBestofCandidateCard, {
      candidate: { id: 'c1', angle: 'classic', provider: 'glm', model: 'glm-4', status: 'done', text: '正文。' },
    }))
    expect(html).toContain('glm')
    expect(html).toContain('glm-4')
  })

  it('same-source：判官区标题 + 提示如实写「同源」，不写「异源」', () => {
    const view = {
      runId: 'bestof-1',
      sessionId: SESSION,
      question: '问',
      candidates: [{ id: 'c1', angle: 'classic', provider: 'deepseek', model: 'deepseek-chat', status: 'done', text: '正文。' }],
      judge: { mode: 'same-source', source: 'same-source', adoptedId: 'c1', ranking: ['c1'], error: '没有不在候选里的另一家 provider。' },
      adoptedId: null,
      rejected: false,
      finished: true,
    }
    const panel = render(h(XsBestofJudgePanel, { view }))
    expect(panel).toContain('同源')
    expect(panel).toContain('没有不在候选里的另一家 provider')
    const overlay = render(h(XsBestofOverlay, { state: { ...state(), phase: 'ready', view }, actions }))
    expect(overlay).toContain('同源')
    expect(overlay).not.toMatch(/异源判官已给出/u)
  })

  it('judge.source = cross-source 时判官区写明是谁判的', () => {
    const view = {
      runId: 'bestof-1',
      sessionId: SESSION,
      question: '问',
      candidates: [{ id: 'c1', angle: 'classic', provider: 'deepseek', model: 'deepseek-chat', status: 'done', text: '正文。' }],
      judge: { mode: 'tool', source: 'cross-source', provider: 'glm', model: 'glm-4', adoptedId: 'c1', ranking: ['c1'] },
      adoptedId: null,
      rejected: false,
      finished: true,
    }
    const panel = render(h(XsBestofJudgePanel, { view }))
    expect(panel).toContain('glm')
    expect(panel).toContain('glm-4')
  })

  it('阶段推导不受 estimate 影响', () => {
    expect(bestofPhase(undefined)).toBe('idle')
    expect(bestofPhase({ finished: true, adoptedId: null, rejected: false })).toBe('ready')
  })
})
