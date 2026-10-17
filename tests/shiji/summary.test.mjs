/**
 * 票 05（#26）· 事记摘要（契约 §1/§2）
 *
 * 判据：
 *   - 摘要只用**注入的 LLM 桩**（不依赖真实模型），素材必须来自依据（项目名 / 会话标题 / 文档正文）；
 *   - LLM 不可用 / 报错 → `summaryMode:'skeleton'`，摘要如实写「摘要未能生成（模型不可用）」+ 依据计数，
 *     **不编内容**；
 *   - 事记的提示词与底稿的 `DIGEST_SYSTEM` 必须不同（两种调用要能在日志/测试里分开计数）。
 */
import { describe, expect, it } from 'vitest'

import { DIGEST_SYSTEM } from '../../packages/xuanshu-host/lib/digao/llm.mjs'
import {
  SHIJI_SESSION_SYSTEM, SHIJI_SUMMARY_SYSTEM, basisText, skeletonSummary, summarizeSessionHistory, summarizeShijiEvidence, summaryPrompt,
} from '../../packages/xuanshu-host/lib/shiji/summary.mjs'
import { fakeLlm, makeCtx } from './lib/sandbox.mjs'

const ITEM = {
  source: 'workspace',
  refId: 'w1',
  name: 'XuanShu',
  basis: { sessions: 1, docs: 2 },
  material: {
    sessionTitles: ['事记怎么接'],
    docs: [{ relPath: 'docs/shiji.md', text: '事记 = 底稿的第四个来源，只可删不可改。' }],
  },
}

/** #38：素材多了「会话内容」（人问过的句子），标题照旧保留。 */
const ITEM_WITH_SESSION = {
  ...ITEM,
  material: {
    ...ITEM.material,
    sessionTexts: [{ sessionId: 's1', title: '事记怎么接', questions: ['事记怎么接？', '好。'] }],
  },
}

describe('票05 · 摘要用注入的 LLM 桩（零真实模型）', () => {
  it('有 LLM：返回 llm 文本，素材含项目名/会话标题/文档正文，且 system 与底稿不同', async () => {
    const llm = fakeLlm({ text: '在做玄枢：把底稿与事记接上。' })
    const ctx = makeCtx({ services: { llm } })
    const result = await summarizeShijiEvidence(ctx, ITEM_WITH_SESSION)
    expect(result).toEqual({ ok: true, text: '在做玄枢：把底稿与事记接上。', mode: 'llm', reason: null })

    const streams = llm.calls.filter((call) => call.method === 'stream')
    expect(streams).toHaveLength(1)
    const options = streams[0].options
    expect(options.system).toBe(SHIJI_SUMMARY_SYSTEM)
    expect(options.system).not.toBe(DIGEST_SYSTEM)
    const prompt = options.messages[0].content[0].text
    expect(prompt).toContain('XuanShu')
    expect(prompt).toContain('事记怎么接')
    expect(prompt).toContain('底稿的第四个来源')
    expect(prompt).toContain('依据：会话 1 场 · 文档 2 份')
    // #38 AC2：注桩 LLM 收到的素材里确实有「会话内容」，不是只有标题与文档。
    expect(prompt).toContain('问：事记怎么接？')
    expect(prompt).toContain('问：好。')
    expect(prompt).toContain('不读代码正文')
  })

  it('没有 ctx.llm → skeleton：如实写「摘要未能生成（模型不可用）」+ 依据计数，不编内容', async () => {
    const ctx = makeCtx({ services: {} })
    const result = await summarizeShijiEvidence(ctx, ITEM)
    expect(result.mode).toBe('skeleton')
    expect(result.ok).toBe(false)
    expect(result.text).toBe('摘要未能生成（模型不可用）：依据 会话 1 场 · 文档 2 份。')
    expect(result.text).not.toContain('玄枢：把底稿')
    expect(result.reason).toMatch(/ctx\.llm/u)
  })

  it('LLM 流里报错 → skeleton + 可读 reason（绝不抛）', async () => {
    const llm = fakeLlm({ fail: true })
    const ctx = makeCtx({ services: { llm } })
    const result = await summarizeShijiEvidence(ctx, ITEM)
    expect(result.mode).toBe('skeleton')
    expect(result.reason).toMatch(/provider down/u)
    expect(result.text).toContain('摘要未能生成（模型不可用）')
  })

  it('依据计数与素材拼装的确定性（同一份依据 → 同一段 prompt）：带会话内容 + 声明不读代码正文', () => {
    expect(basisText({ sessions: 3, docs: 2 })).toBe('会话 3 场 · 文档 2 份')
    expect(skeletonSummary({ sessions: 0, docs: 0 })).toBe('摘要未能生成（模型不可用）：依据 会话 0 场 · 文档 0 份。')
    expect(summaryPrompt(ITEM_WITH_SESSION)).toBe([
      '项目/工作流：XuanShu',
      '依据：会话 1 场 · 文档 2 份',
      '（素材只来自会话标题、会话内容与项目说明文档；不读代码正文）',
      '会话标题：事记怎么接',
      '【会话内容 事记怎么接】',
      '问：事记怎么接？',
      '问：好。',
      '【文档 docs/shiji.md】',
      '事记 = 底稿的第四个来源，只可删不可改。',
    ].join('\n'))
    // 降级（没有会话内容）时素材就是标题 + 文档：不编会话里的事。
    expect(summaryPrompt(ITEM)).toBe([
      '项目/工作流：XuanShu',
      '依据：会话 1 场 · 文档 2 份',
      '（素材只来自会话标题、会话内容与项目说明文档；不读代码正文）',
      '会话标题：事记怎么接',
      '【文档 docs/shiji.md】',
      '事记 = 底稿的第四个来源，只可删不可改。',
    ].join('\n'))
  })
})

describe('票05 · 会话历史摘要（「存成今天的事记」的素材）', () => {
  it('一段会话文本历史 → 一两次 LLM 调用拿到摘要；素材只含用户/助手文本', async () => {
    const llm = fakeLlm({ text: '今天问的是事记怎么接。' })
    const ctx = makeCtx({ services: { llm } })
    const result = await summarizeSessionHistory(ctx, {
      name: '今天的问事',
      messages: [
        { role: 'user', text: '事记怎么接进底稿？' },
        { role: 'assistant', text: '在 refreshDigao 之前先扫一遍。', source: 'model' },
      ],
    })
    expect(result).toEqual({ ok: true, text: '今天问的是事记怎么接。', reason: null })
    const options = llm.calls.find((call) => call.method === 'stream').options
    expect(options.system).toBe(SHIJI_SESSION_SYSTEM)
    expect(options.system).not.toBe(SHIJI_SUMMARY_SYSTEM)
    expect(options.messages[0].content[0].text).toContain('用户：事记怎么接进底稿？')
    expect(options.messages[0].content[0].text).toContain('助手：在 refreshDigao 之前先扫一遍。')
  })

  it('没有可摘的会话文本 → 不调 LLM，返回 ok:false（调用方据此不写空条目）', async () => {
    const llm = fakeLlm()
    const ctx = makeCtx({ services: { llm } })
    const result = await summarizeSessionHistory(ctx, { name: 'x', messages: [] })
    expect(result.ok).toBe(false)
    expect(llm.calls.filter((call) => call.method === 'stream')).toHaveLength(0)
  })
})
