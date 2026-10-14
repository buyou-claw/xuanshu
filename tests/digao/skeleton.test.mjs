/**
 * 票 13 · 底稿骨架与来源标记（契约 §1：**确定性函数，可无 LLM 测**）
 *
 * 抓的真实缺陷/风险：
 *   ① **章序漂移**：票面要求「哪段来自谱 / 工作区 / 工作流」一眼可查。章序一旦跟着输入顺序走，
 *      同一份数据两次刷新会排出两种底稿 —— 用户会以为「底稿乱了」。
 *   ② **来源标记要落在每段首行**：没有标记的段落在只读面板上就是一段无主正文，
 *      「要改就改源头」这条产品约束就失去了锚点。
 *   ③ **降级必须如实标注**（契约 §1/§4）：LLM 不可用时底稿仍然可用，但**不许**把规则骨架
 *      说成「提炼稿」—— 所以 `digest:'skeleton'` 时既没有 `## 摘要`，正文头部也要写明「未提炼」。
 *   ④ **可复现**：同一组来源两次渲染逐字相同（`generatedAt` 是唯一的时间变量，由调用方给）。
 */
import { describe, expect, it } from 'vitest'

import { buildDigaoMeta, buildSegments, renderDigaoMarkdown } from '../../packages/xuanshu-host/lib/digao/skeleton.mjs'

/** 三个来源各给一点内容（固定合成数据，与仓库里任何真实谱无关）。键名用契约 §1 的单数词表
 *（`bySource` 的键就是 `pu` / `workspace` / `workflow`）——输入与输出同一套词，免得多一层翻译。 */
const SOURCES = {
  pu: [
    { name: '底座', text: '出生信息与八字底盘：四柱 己巳 丙子 丙寅 甲午。' },
    { name: '软件开发', text: '擅长 Rust；做过十年工具链。' },
  ],
  workspace: [{ name: 'XuanShu', text: '工作区 XuanShu（E:\\ai_project\\XuanShu）· 会话 3 场' }],
  workflow: [],
}
const GENERATED_AT = '2026-10-15T00:00:00.000Z'

describe('票13 · 底稿骨架：章序与来源标记（契约 §1）', () => {
  it('三个来源章按固定章序出现：谱 → 工作区 → 工作流（与输入顺序无关）', () => {
    const shuffled = { workflows: [], workspaces: SOURCES.workspaces, pus: SOURCES.pus }
    const markdown = renderDigaoMarkdown({ segments: buildSegments(shuffled), digest: 'skeleton', generatedAt: GENERATED_AT })
    const pu = markdown.indexOf('## 来源：谱')
    const workspace = markdown.indexOf('## 来源：工作区')
    const workflow = markdown.indexOf('## 来源：工作流')
    expect(pu).toBeGreaterThan(-1)
    expect(workspace).toBeGreaterThan(pu)
    expect(workflow).toBeGreaterThan(workspace)
  })

  it('每段首行是【来源：<章名> <name>】，段落正文紧接着它', () => {
    const segments = buildSegments(SOURCES)
    const markdown = renderDigaoMarkdown({ segments, digest: 'skeleton', generatedAt: GENERATED_AT })
    expect(markdown).toContain('【来源：谱 底座】\n出生信息与八字底盘：四柱 己巳 丙子 丙寅 甲午。')
    expect(markdown).toContain('【来源：谱 软件开发】\n擅长 Rust；做过十年工具链。')
    expect(markdown).toContain('【来源：工作区 XuanShu】\n工作区 XuanShu（E:\\ai_project\\XuanShu）· 会话 3 场')
    // 段落数与标记数一致（没有「有段无标记」的漏网段）。
    expect(markdown.split('【来源：').length - 1).toBe(segments.length)
  })

  it('空来源章写「尚无来源」，不是留白（工作流本票不生产，票 16 才有）', () => {
    const markdown = renderDigaoMarkdown({ segments: buildSegments(SOURCES), digest: 'skeleton', generatedAt: GENERATED_AT })
    const workflowChapter = markdown.slice(markdown.indexOf('## 来源：工作流'))
    expect(workflowChapter).toContain('尚无来源')
  })

  it('buildSegments 按章序摊平，且不改输入', () => {
    const snapshot = JSON.stringify(SOURCES)
    const segments = buildSegments(SOURCES)
    expect(JSON.stringify(SOURCES)).toBe(snapshot)
    expect(segments.map((segment) => segment.source)).toEqual(['pu', 'pu', 'workspace'])
    expect(segments[0]).toEqual({ source: 'pu', name: '底座', text: SOURCES.pu[0].text })
  })
})

describe('票13 · 底稿元数据（契约 §1 的 digao.json）', () => {
  it('segments / sources / bySource 三者自洽，且 sources 只数「有段的来源」', () => {
    const segments = buildSegments(SOURCES)
    const meta = buildDigaoMeta({ segments, digest: 'skeleton', generatedAt: GENERATED_AT })
    expect(meta.schema).toBe('xuanshu/digao@1')
    expect(meta.generatedAt).toBe(GENERATED_AT)
    expect(meta.segments).toBe(3)
    expect(meta.bySource).toEqual({ pu: 2, workspace: 1 })
    expect(meta.sources).toBe(2) // 工作流这一路本票没有来源，不该被算成「一路」
    expect(meta.digest).toBe('skeleton')
  })

  it('三路都有来源时 sources=3（契约 §1 的样例形状）', () => {
    const segments = buildSegments({ ...SOURCES, workflow: [{ name: '日课流程', text: '每日 07:30 出日课。' }] })
    const meta = buildDigaoMeta({ segments, digest: 'llm', generatedAt: GENERATED_AT })
    expect(meta.bySource).toEqual({ pu: 2, workspace: 1, workflow: 1 })
    expect(meta.sources).toBe(3)
    expect(meta.segments).toBe(4)
  })
})

describe('票13 · 降级如实标注（契约 §1/§4）', () => {
  it("digest='skeleton'：没有 `## 摘要` 节，正文头部明写「未提炼」", () => {
    const markdown = renderDigaoMarkdown({ segments: buildSegments(SOURCES), digest: 'skeleton', generatedAt: GENERATED_AT })
    expect(markdown).not.toContain('## 摘要')
    expect(markdown).toContain('未提炼')
    expect(markdown).toContain('digest=skeleton')
  })

  it("digest='llm'：`## 摘要` 节带 LLM 压出来的那段，且不再写「未提炼」", () => {
    const markdown = renderDigaoMarkdown({
      segments: buildSegments(SOURCES),
      digest: 'llm',
      digestText: '一句话：写工具链的开发者，八字丙寅日主。',
      generatedAt: GENERATED_AT,
    })
    expect(markdown).toContain('## 摘要')
    expect(markdown).toContain('一句话：写工具链的开发者，八字丙寅日主。')
    expect(markdown).not.toContain('未提炼')
    // 摘要节在三个来源章之前（先看汇总、再逐段核对）。
    expect(markdown.indexOf('## 摘要')).toBeLessThan(markdown.indexOf('## 来源：谱'))
  })

  it('纯派生：同一输入两次渲染逐字相同；正文头部带「不可手改」与生成时间', () => {
    const first = renderDigaoMarkdown({ segments: buildSegments(SOURCES), digest: 'skeleton', generatedAt: GENERATED_AT })
    const second = renderDigaoMarkdown({ segments: buildSegments(SOURCES), digest: 'skeleton', generatedAt: GENERATED_AT })
    expect(second).toBe(first)
    expect(first).toContain('不可手改')
    expect(first).toContain(GENERATED_AT)
  })
})
