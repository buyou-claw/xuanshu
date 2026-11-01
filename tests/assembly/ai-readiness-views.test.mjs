/**
 * 票 29 · 「接上 AI」的三块界面事实（受控组件 + `renderToStaticMarkup`）。
 *
 *   - **状态面**（向导第 6 步）：`configured / providers / defaultModel / reason` 四件事全在屏上；
 *     「读不到」显示「未知」而不是「未接上 / 没配」；
 *   - **问事入口门禁**（总览快捷入口）：未接上 → 格置灰 + 可见原因 + 逐字去向「设置 → 模型」；
 *     状态未知 → **不静默禁用**（格仍可用 + 明说未知 + 重试）；
 *     「去设置」按钮**只在真有打开动作时**出现（没有 handler 就只显示路径文本，绝不渲染死按钮）；
 *   - **向导可完成或跳过**：已接上才有 [完成]；任何状态都有 [跳过]，且跳过时说明「入口仍禁用」。
 *
 * 局限（诚实登记）：`renderToStaticMarkup` 不做 DOM 事件，所以这里断言的是「这一刻渲染了什么」
 * 与「按钮只在有真实 handler 时出现」；真实点击链路在浏览器里，未由本文件覆盖。
 */

import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AI_SETTINGS_PATH } from '../../packages/xuanshu-client/src/client/ai-model.ts'
import { XsAiGate, XsAiReadiness } from '../../packages/xuanshu-client/src/client/ai-views.tsx'
import { XsQuickLinks } from '../../packages/xuanshu-client/src/client/cards.tsx'
import { XsAiStep } from '../../packages/xuanshu-client/src/client/onboarding-steps.tsx'

const render = (element) => renderToStaticMarkup(element)

/** 按标记切出承载它的那个标签（断言 `disabled` 在不在**这个**控件上）。 */
function tagOf(html, marker) {
  const start = html.indexOf(marker)
  expect(start, `没有找到 ${marker}`).toBeGreaterThanOrEqual(0)
  const open = html.lastIndexOf('<', start)
  const close = html.indexOf('>', start)
  return html.slice(open, close + 1)
}

/** 按标记切出该**行**（`<tag ...>...</tag>`）：用于「这一行上写了什么」。 */
function rowOf(html, marker) {
  const start = html.indexOf(marker)
  expect(start, `没有找到 ${marker}`).toBeGreaterThanOrEqual(0)
  const open = html.lastIndexOf('<', start)
  const close = html.indexOf('</li>', start)
  return html.slice(open, close === -1 ? undefined : close + '</li>'.length)
}

/** 稳定 watch（满足 `useSyncExternalStore` 的 `Object.is` 比较）。 */
function watchOf(keys) {
  const snapshot = [...keys].sort()
  return { subscribe: () => () => {}, getSnapshot: () => snapshot }
}

const injected = (mainKeys = ['conversation', 'overview', 'consult', 'plugins', 'schedules']) => ({
  navigate: () => {},
  mainPanels: watchOf(mainKeys),
})

/* ───────────────────────── 独立事实源：三态状态面字面量 ───────────────────────── */

const READY = {
  configured: true,
  known: true,
  providers: [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      registered: true,
      keyConfigured: true,
      modelsKnown: true,
      modelCount: 1,
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
      isDefaultProvider: true,
      usable: true,
    },
  ],
  defaultModel: { provider: 'deepseek-official', model: 'deepseek-chat' },
  reason: { code: 'ready', text: '已接上：DeepSeek · deepseek-chat。', next: '可以问事了。' },
  checkedAt: '2026-10-17T00:00:00.000Z',
}

const MISSING = {
  configured: false,
  known: true,
  providers: [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      registered: true,
      keyConfigured: false,
      modelsKnown: true,
      modelCount: 1,
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
      isDefaultProvider: true,
      usable: false,
    },
  ],
  defaultModel: { provider: 'deepseek-official', model: 'deepseek-chat' },
  reason: {
    code: 'missing-key',
    text: 'DeepSeek 已有模型，但这个提供商没有配置密钥（key）。',
    next: '打开 DSH「设置 → 模型」给 DeepSeek 填上密钥。',
  },
  checkedAt: '2026-10-17T00:00:00.000Z',
}

const UNKNOWN = {
  configured: 'unknown',
  known: false,
  providers: [],
  defaultModel: null,
  reason: {
    code: 'unavailable',
    text: '读不到 AI 状态（路由清单服务不可用）—— 这不等于「没配」。',
    next: '点「重试」再检测一次；仍然读不到就去「设置 → 模型」看看。',
  },
  detail: '未知玄枢操作：routes.list',
  checkedAt: '2026-10-17T00:00:00.000Z',
}

/* ───────────────────────── 状态面（向导第 6 步的内容） ───────────────────────── */

describe('票 29 · AI 状态面：configured / providers / defaultModel / reason', () => {
  it('已接上：状态、默认模型、provider 行、只读说明都在屏上，且有 [完成]', () => {
    const html = render(
      h(XsAiReadiness, { readiness: READY, onRetry: () => {}, onFinish: () => {}, onSkip: () => {} }),
    )
    expect(html).toContain('data-xs-state="configured"')
    expect(html).toContain('已接上 AI')
    expect(html).toContain('data-xuanshu-ai-default')
    expect(html).toContain('deepseek-official · deepseek-chat')
    expect(html).toContain('data-xuanshu-ai-provider="deepseek-official"')
    expect(html).toContain('已配置')
    expect(html).toContain('1 个模型')
    expect(html).toContain('可以问事了。')
    // 检测只读：界面上明说，别让人以为它会替你写配置。
    expect(html).toContain('检测只读')
    expect(html).toContain('data-xuanshu-action="finish-ai"')
    expect(html).toContain('data-xuanshu-action="skip-ai"')
  })

  it('未接上：原因 + 下一步 + 逐字去向「设置 → 模型」；没有 opener 时**不渲染死按钮**', () => {
    const html = render(h(XsAiReadiness, { readiness: MISSING, onRetry: () => {}, onSkip: () => {} }))
    expect(html).toContain('data-xs-state="missing"')
    expect(html).toContain('未接上 AI')
    expect(html).toContain(MISSING.reason.text)
    expect(html).toContain(MISSING.reason.next)
    expect(html).toContain(AI_SETTINGS_PATH)
    // 没有打开设置的 handler → 只显示路径，不渲染点了没反应的按钮。
    expect(html).not.toContain('data-xuanshu-action="open-ai-settings"')
    // 未接上时没有 [完成]，只有 [跳过]。
    expect(html).not.toContain('data-xuanshu-action="finish-ai"')
    expect(html).toContain('data-xuanshu-action="skip-ai"')
    expect(html).toContain('data-xuanshu-action="retry-ai"')
  })

  it('有 opener 时才出现 [去「设置 → 模型」]（一键指路），否则只显示路径文本', () => {
    const opened = render(
      h(XsAiReadiness, { readiness: MISSING, onRetry: () => {}, onOpenSettings: () => {}, onSkip: () => {} }),
    )
    expect(opened).toContain('data-xuanshu-action="open-ai-settings"')
    expect(opened).toContain(`>去「${AI_SETTINGS_PATH}」<`)
  })

  it('未知：显示「未知」+ 原文 + 重试；**不许**说成「未接上 / 没配」', () => {
    const html = render(h(XsAiReadiness, { readiness: UNKNOWN, onRetry: () => {} }))
    expect(html).toContain('data-xs-state="unknown"')
    expect(html).toContain('未知')
    expect(html).toContain(UNKNOWN.reason.text)
    expect(html).toContain('未知玄枢操作：routes.list')
    expect(html).toContain('data-xuanshu-action="retry-ai"')
    expect(html).not.toContain('未接上 AI')
    expect(html).not.toContain('没有配置密钥')
  })

  it('一家 provider 的 key 是未知 → 那一行如实写「未知」，不写成「未配置」', () => {
    const mixed = {
      ...MISSING,
      providers: [
        { ...MISSING.providers[0], keyConfigured: 'unknown' },
        { ...MISSING.providers[0], id: 'pi-ai', name: 'Pi', modelsKnown: false, modelCount: 0, models: [] },
      ],
    }
    const html = render(h(XsAiReadiness, { readiness: mixed, onRetry: () => {} }))
    const deepseek = rowOf(html, 'data-xuanshu-ai-provider="deepseek-official"')
    expect(deepseek).toContain('未知')
    expect(deepseek).not.toContain('未配置')
    const pi = rowOf(html, 'data-xuanshu-ai-provider="pi-ai"')
    expect(pi).toContain('模型清单读不到')
  })

  it('还在检测（没有 readiness）→ 「正在检测 AI …」，不提前下结论', () => {
    const html = render(h(XsAiReadiness, { checking: true, onRetry: () => {} }))
    expect(html).toContain('data-xs-state="checking"')
    expect(html).toContain('正在检测 AI')
    expect(html).not.toContain('未接上 AI')
  })
})

/* ───────────────────────── 问事入口门禁（总览快捷入口卡） ───────────────────────── */

describe('票 29 · 问事入口门禁：未接上 → 置灰 + 原因 + 去向；已接上 → 可用', () => {
  const card = (props = {}) => render(h(XsQuickLinks, { ...injected(), ...props }))

  it('未接上：问事格 disabled，可见原因与逐字去向都在卡里（不是只在 title 里）', () => {
    const html = card({ aiReadiness: MISSING, onRetryAi: () => {} })
    const consult = tagOf(html, 'data-xuanshu-nav="consult"')
    expect(consult).toContain('disabled')
    expect(html).toContain('data-xuanshu-ai-gate="missing"')
    expect(html).toContain(MISSING.reason.text)
    expect(html).toContain(AI_SETTINGS_PATH)
    expect(html).toContain('data-xuanshu-action="retry-ai"')
  })

  it('已接上：问事格可用，卡里不再出现门禁行', () => {
    const html = card({ aiReadiness: READY })
    const consult = tagOf(html, 'data-xuanshu-nav="consult"')
    expect(consult).not.toContain('disabled')
    expect(html).not.toContain('data-xuanshu-ai-gate')
  })

  it('状态未知：**不静默禁用**也不静默放行 —— 格仍可用，但卡里明说「AI 状态未知」并给重试', () => {
    const html = card({ aiReadiness: UNKNOWN, onRetryAi: () => {} })
    const consult = tagOf(html, 'data-xuanshu-nav="consult"')
    expect(consult).not.toContain('disabled')
    expect(html).toContain('data-xuanshu-ai-gate="unknown"')
    expect(html).toContain('未知')
    expect(html).toContain('data-xuanshu-action="retry-ai"')
  })

  it('门禁与「面板未装配」是两条理由：面板没注册时仍按面板那条置灰', () => {
    const html = card({ aiReadiness: READY, mainPanels: watchOf(['conversation', 'overview']) })
    const consult = tagOf(html, 'data-xuanshu-nav="consult"')
    expect(consult).toContain('disabled')
    expect(html).toContain('问事面板还没装配（属票 10 · 问事闭环）')
  })
})

/* ───────────────────────── 向导第 6 步：可完成或跳过 ───────────────────────── */

describe('票 29 · 向导第 6 步「接上 AI」：完成 / 跳过', () => {
  it('已接上 → 第 6 步页头 + [完成，回总览] + [跳过]', () => {
    const html = render(h(XsAiStep, { readiness: READY, onRetry: () => {}, onFinish: () => {}, onSkip: () => {} }))
    expect(html).toContain('data-xs-step="6"')
    expect(html).toContain('第 6 / 6 步')
    expect(html).toContain('接上 AI')
    expect(html).toContain('data-xuanshu-action="finish-ai"')
    expect(html).toContain('data-xuanshu-action="skip-ai"')
  })

  it('未接上 → 没有 [完成]，[跳过] 明说「入口仍禁用」与去向', () => {
    const html = render(h(XsAiStep, { readiness: MISSING, onRetry: () => {}, onFinish: () => {}, onSkip: () => {} }))
    expect(html).not.toContain('data-xuanshu-action="finish-ai"')
    expect(html).toContain('data-xuanshu-action="skip-ai"')
    expect(html).toContain('入口仍禁用')
    expect(html).toContain(AI_SETTINGS_PATH)
  })

  it('未知也能跳过（不把人卡死在读不到的状态里）', () => {
    const html = render(h(XsAiStep, { readiness: UNKNOWN, onRetry: () => {}, onFinish: () => {}, onSkip: () => {} }))
    expect(html).toContain('data-xuanshu-action="skip-ai"')
    expect(html).toContain('data-xs-state="unknown"')
  })
})

/* ───────────────────────── 门禁行本身（快捷入口外也可复用） ───────────────────────── */

describe('票 29 · 门禁行 XsAiGate', () => {
  it('已接上 → 什么都不渲染（不占屏）', () => {
    expect(render(h(XsAiGate, { readiness: READY }))).toBe('')
  })

  it('未接上 → 原因 + 去向 + 重试', () => {
    const html = render(h(XsAiGate, { readiness: MISSING, onRetry: () => {} }))
    expect(html).toContain('data-xuanshu-ai-gate="missing"')
    expect(html).toContain(MISSING.reason.text)
    expect(html).toContain(AI_SETTINGS_PATH)
    expect(html).toContain('data-xuanshu-action="retry-ai"')
  })
})
