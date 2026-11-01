/**
 * 「试一下能不能用」按钮的渲染契约（票 29 的补充，2026-11-02）。
 *
 * 为什么单独一份：状态面那一堆（configured / providers / defaultModel / reason）都是
 * **看配置清单**得出的；只有这个按钮会**真发一次请求**。它必须遵守本仓那条纪律：
 *
 *   **绝不渲染一个点了没反应的按钮** —— 没有 `onProbe`（宿主没这个能力）时不渲染，
 *   而不是渲染成禁用或点了没反应的死按钮。
 *
 * 局限（诚实登记，同 ai-readiness-views.test.mjs）：`renderToStaticMarkup` 不做事件，
 * 所以这里只断言「这一刻渲染了什么」。「点了之后三态怎么变」在浏览器里验过（`.scratch/proof-probe-ui.mjs`），
 * 本文件不覆盖。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { XsAiReadiness } from '../../packages/xuanshu-client/src/client/ai-views.tsx'
import { XsAiStep } from '../../packages/xuanshu-client/src/client/onboarding-steps.tsx'

const render = (element) => renderToStaticMarkup(element)

/** 一份「配置齐了」的最小状态（与 ai-readiness-views 里那份同形，只留本文件用得到的字段）。 */
const READY = {
  configured: true,
  known: true,
  providers: [{ id: 'deepseek-official', name: 'DeepSeek', keyConfigured: 'yes', usable: true, modelsKnown: true, modelCount: 1, isDefaultProvider: true }],
  defaultModel: { provider: 'deepseek-official', model: 'deepseek-flash' },
  reason: { code: 'ready', text: '配置齐了：DeepSeek · deepseek-flash。' },
  checkedAt: '2026-11-02T00:00:00.000Z',
}

describe('「试一下能不能用」：只在宿主真的有探测能力时才渲染', () => {
  it('给了 onProbe → 按钮在，且带可断言的 data 属性', () => {
    const html = render(h(XsAiReadiness, { readiness: READY, onProbe: async () => ({ ok: true, ms: 5 }) }))
    expect(html).toContain('data-xuanshu-action="probe-ai"')
    expect(html).toContain('试一下能不能用')
  })

  it('没给 onProbe → 不渲染按钮（绝不留一个点了没反应的控件）', () => {
    const html = render(h(XsAiReadiness, { readiness: READY }))
    expect(html).not.toContain('data-xuanshu-action="probe-ai"')
    expect(html).not.toContain('试一下能不能用')
  })

  it('初始状态不显示结果行（没点之前什么都不说）', () => {
    const html = render(h(XsAiReadiness, { readiness: READY, onProbe: async () => ({ ok: true, ms: 5 }) }))
    expect(html).not.toContain('data-xuanshu-ai-probe')
  })

  it('向导第 6 步会把它透传下来（有 onProbe 时按钮出现在那一屏）', () => {
    const html = render(h(XsAiStep, { readiness: READY, onProbe: async () => ({ ok: true, ms: 5 }), onFinish: () => {}, onSkip: () => {} }))
    expect(html).toContain('data-xuanshu-action="probe-ai"')
  })

  it('向导没拿到 onProbe 时同样不渲染（不会自己编一个）', () => {
    const html = render(h(XsAiStep, { readiness: READY, onFinish: () => {}, onSkip: () => {} }))
    expect(html).not.toContain('data-xuanshu-action="probe-ai"')
  })
})
