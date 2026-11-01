/**
 * 票 13 · 底稿骨架与来源标记（契约 §1：**确定性函数，可无 LLM 测**）
 *
 * 票 27（#27）扩成两段（契约 §3）：「最近在做什么」（谱 / 工作区 / 工作流）与
 * 「曾经做过什么」（事记）。本文件同时钉住**旧形态不回归**的部分：来源标记逐字、空路可读、
 * 降级如实标注、两次渲染逐字相同。
 *
 * 抓的真实缺陷/风险：
 *   ① **段序漂移**：两段与三路的顺序一旦跟着输入顺序走，同一份数据两次刷新会排出两种底稿 ——
 *      用户会以为「底稿乱了」；章序即契约（§3）。
 *   ② **来源标记要落在每段首行**：没有标记的段落在只读面板上就是一段无主正文，
 *      「要改就改源头」这条产品约束就失去了锚点。事记段同样要标记（`【来源：事记 <name>】`）。
 *   ③ **事记必须落在「曾经」里**：事记混进「最近」就等于把历史当成现状。
 *   ④ **降级必须如实标注**（契约 §1/§4）：LLM 不可用时底稿仍然可用，但**不许**把规则骨架
 *      说成「提炼稿」—— 所以 `digest:'skeleton'` 时既没有 `## 摘要`，正文头部也要写明「未提炼」。
 *   ⑤ **可复现**：同一组来源两次渲染逐字相同（`generatedAt` 是唯一的时间变量，由调用方给）。
 */
import { describe, expect, it } from 'vitest'

import {
  buildDigaoMeta,
  buildPastSegments,
  buildSegments,
  renderDigaoMarkdown,
} from '../../packages/xuanshu-host/lib/digao/skeleton.mjs'

/** 三个来源各给一点内容（固定合成数据，与仓库里任何真实谱无关）。键名用契约 §1 的单数词表
 *（`bySource` 的键就是 `pu` / `workspace` / `workflow`）——输入与输出同一套词，免得多一层翻译。 */
const SOURCES = {
  pu: [
    { name: '底座', text: '出生信息与八字底盘：四柱 己巳 丙子 丙寅 甲午。' },
    { name: '软件开发', text: '擅长 Rust；做过十年工具链。' },
  ],
  workspace: [{ name: 'XuanShu', text: '工作区 XuanShu（E:\\ai_project\\XuanShu）· 会话 3 场 · 最近活跃 2026-10-17' }],
  workflow: [],
}
const GENERATED_AT = '2026-10-15T00:00:00.000Z'

/** 事记条目（票 05 / #26 的账本形状；契约 §3 的「曾经」就是它的投影）。 */
const SHIJI_ENTRIES = [
  {
    id: 'shiji-aaaaaaaaaaaaaaaa',
    name: 'XuanShu',
    summary: '在做玄枢：DSH profile + 两个插件包，当前在接事记与底稿两段。',
    firstSeenAt: '2026-09-01T02:00:00.000Z',
    lastActiveAt: '2026-10-17T08:19:11.000Z',
    basis: { sessions: 3, docs: 2 },
  },
  {
    id: 'shiji-bbbbbbbbbbbbbbbb',
    name: '把周报自动化',
    summary: '工作流导出成 skill 了，每周五跑一次。',
    firstSeenAt: '2026-10-10T01:00:00.000Z',
    lastActiveAt: '2026-10-12T09:00:00.000Z',
    basis: { sessions: 1, docs: 1 },
  },
]

/** 「最近」那一段的正文（`## 最近在做什么` 到 `## 曾经做过什么` 之间）。 */
function recentOf(markdown) {
  return markdown.slice(markdown.indexOf('## 最近在做什么'), markdown.indexOf('## 曾经做过什么'))
}

/** 「曾经」那一段的正文。 */
function pastOf(markdown) {
  return markdown.slice(markdown.indexOf('## 曾经做过什么'))
}

describe('票13/27 · 底稿两段的章序与来源标记（契约 §3）', () => {
  it('章序固定：最近在做什么 → 曾经做过什么（在摘要之后；与输入顺序无关）', () => {
    const markdown = renderDigaoMarkdown({
      segments: [...buildSegments(SOURCES), ...buildPastSegments(SHIJI_ENTRIES)],
      digest: 'skeleton',
      generatedAt: GENERATED_AT,
    })
    const recent = markdown.indexOf('## 最近在做什么')
    const past = markdown.indexOf('## 曾经做过什么')
    expect(recent).toBeGreaterThan(-1)
    expect(past).toBeGreaterThan(recent)
  })

  it('每段首行是【来源：<路> <name>】，段落正文紧接着它（最近三路 + 事记）', () => {
    const segments = buildSegments(SOURCES)
    const markdown = renderDigaoMarkdown({ segments, digest: 'skeleton', generatedAt: GENERATED_AT })
    expect(markdown).toContain('【来源：谱 底座】\n出生信息与八字底盘：四柱 己巳 丙子 丙寅 甲午。')
    expect(markdown).toContain('【来源：谱 软件开发】\n擅长 Rust；做过十年工具链。')
    expect(markdown).toContain('【来源：工作区 XuanShu】\n工作区 XuanShu（E:\\ai_project\\XuanShu）· 会话 3 场 · 最近活跃 2026-10-17')
    // 段落数与标记数一致（没有「有段无标记」的漏网段）。
    expect(markdown.split('【来源：').length - 1).toBe(segments.length)
  })

  it('「最近」里没有任何事记段；事记全在「曾经」里（历史不许混成现状）', () => {
    const markdown = renderDigaoMarkdown({
      segments: [...buildSegments(SOURCES), ...buildPastSegments(SHIJI_ENTRIES)],
      digest: 'skeleton',
      generatedAt: GENERATED_AT,
    })
    expect(recentOf(markdown)).not.toContain('【来源：事记')
    expect(pastOf(markdown)).toContain('【来源：事记 XuanShu】')
    expect(pastOf(markdown)).toContain('【来源：事记 把周报自动化】')
    // 事记正文只在「曾经」里出现。
    expect(recentOf(markdown)).not.toContain('在做玄枢')
    expect(pastOf(markdown)).toContain('在做玄枢')
  })

  it('空来源路写「（尚无来源：<路>）」，不是留白（工作流本票不生产，票 16 才有）', () => {
    const markdown = renderDigaoMarkdown({ segments: buildSegments(SOURCES), digest: 'skeleton', generatedAt: GENERATED_AT })
    const recent = recentOf(markdown)
    expect(recent).toContain('（尚无来源：工作流）')
    // 有内容的那两路不写空态。
    expect(recent).not.toContain('（尚无来源：谱）')
    expect(recent).not.toContain('（尚无来源：工作区）')
  })

  it('buildSegments 按章序摊平，且不改输入', () => {
    const snapshot = JSON.stringify(SOURCES)
    const segments = buildSegments(SOURCES)
    expect(JSON.stringify(SOURCES)).toBe(snapshot)
    expect(segments.map((segment) => segment.source)).toEqual(['pu', 'pu', 'workspace'])
    expect(segments[0]).toEqual({ source: 'pu', name: '底座', text: SOURCES.pu[0].text })
  })
})

describe('票27 · 「曾经做过什么」的事记条目（契约 §3）', () => {
  it('每条一行来源标记 + 日期区间 + 依据，摘要紧随其后', () => {
    const markdown = renderDigaoMarkdown({
      segments: [...buildSegments(SOURCES), ...buildPastSegments(SHIJI_ENTRIES)],
      digest: 'skeleton',
      generatedAt: GENERATED_AT,
    })
    expect(markdown).toContain(
      '【来源：事记 XuanShu】2026-09-01～2026-10-17 · 依据：会话 3 场 · 文档 2 份\n在做玄枢：DSH profile + 两个插件包，当前在接事记与底稿两段。',
    )
    expect(markdown).toContain('【来源：事记 把周报自动化】2026-10-10～2026-10-12 · 依据：会话 1 场 · 文档 1 份')
  })

  it('顺序照调用方给的（`shiji.list` 已按 lastActiveAt 倒序），渲染器不重排', () => {
    const markdown = renderDigaoMarkdown({
      segments: [...buildSegments(SOURCES), ...buildPastSegments(SHIJI_ENTRIES)],
      digest: 'skeleton',
      generatedAt: GENERATED_AT,
    })
    expect(markdown.indexOf('【来源：事记 XuanShu】')).toBeLessThan(markdown.indexOf('【来源：事记 把周报自动化】'))
  })

  it('没有事记时「曾经」给可读的空态（不编一条假历史、也不留白）', () => {
    const markdown = renderDigaoMarkdown({ segments: buildSegments(SOURCES), digest: 'skeleton', generatedAt: GENERATED_AT })
    expect(pastOf(markdown)).toContain('（还没有事记：底稿刷新时会自动扫描工作区与工作流。）')
    expect(markdown).not.toContain('【来源：事记')
  })

  it('事记的日期取 ISO 的日期段（确定性，不随本机时区漂）', () => {
    const markdown = renderDigaoMarkdown({
      segments: buildPastSegments([{ ...SHIJI_ENTRIES[0], lastActiveAt: '2026-10-17T23:59:59.000Z' }]),
      digest: 'skeleton',
      generatedAt: GENERATED_AT,
    })
    expect(markdown).toContain('2026-09-01～2026-10-17')
  })
})

describe('票13/27 · 底稿元数据（契约 §1 的 digao.json + §3 的加性字段）', () => {
  it('segments / sources / bySource 三者自洽，且 sources 只数「有段的来源」', () => {
    const segments = buildSegments(SOURCES)
    const meta = buildDigaoMeta({ segments, digest: 'skeleton', generatedAt: GENERATED_AT })
    expect(meta.schema).toBe('xuanshu/digao@1')
    expect(meta.generatedAt).toBe(GENERATED_AT)
    expect(meta.segments).toBe(3)
    expect(meta.bySource).toEqual({ pu: 2, workspace: 1 })
    expect(meta.sources).toBe(2) // 工作流这一路本票没有来源，不该被算成「一路」
    expect(meta.digest).toBe('skeleton')
    // 加性字段：两段各有多少（recent 含三路，past 只含事记）。
    expect(meta.sections).toEqual({ recent: 3, past: 0 })
  })

  it('三路都有来源时 sources=3（契约 §1 的样例形状）', () => {
    const segments = buildSegments({ ...SOURCES, workflow: [{ name: '日课流程', text: '每日 07:30 出日课。' }] })
    const meta = buildDigaoMeta({ segments, digest: 'llm', generatedAt: GENERATED_AT })
    expect(meta.bySource).toEqual({ pu: 2, workspace: 1, workflow: 1 })
    expect(meta.sources).toBe(3)
    expect(meta.segments).toBe(4)
    expect(meta.sections).toEqual({ recent: 4, past: 0 })
  })

  it('事记是第四路：bySource.shiji 计数、sources 最多 4，schema 不变（不升级 = 老文件不会被读成「底稿消失」）', () => {
    const segments = [...buildSegments(SOURCES), ...buildPastSegments(SHIJI_ENTRIES)]
    const meta = buildDigaoMeta({ segments, digest: 'skeleton', generatedAt: GENERATED_AT })
    expect(meta.schema).toBe('xuanshu/digao@1')
    expect(meta.bySource).toEqual({ pu: 2, workspace: 1, shiji: 2 })
    expect(meta.sources).toBe(3)
    expect(meta.segments).toBe(5)
    expect(meta.sections).toEqual({ recent: 3, past: 2 })
  })

  it('四路都有内容时 sources=4（上限就是四路）', () => {
    const segments = [
      ...buildSegments({ ...SOURCES, workflow: [{ name: '日课流程', text: '每日 07:30 出日课。' }] }),
      ...buildPastSegments(SHIJI_ENTRIES),
    ]
    const meta = buildDigaoMeta({ segments, digest: 'skeleton', generatedAt: GENERATED_AT })
    expect(meta.bySource).toEqual({ pu: 2, workspace: 1, workflow: 1, shiji: 2 })
    expect(meta.sources).toBe(4)
  })

  it('buildPastSegments 不改条目、不吞字段（id 一并带出，便于对账）', () => {
    const snapshot = JSON.stringify(SHIJI_ENTRIES)
    const segments = buildPastSegments(SHIJI_ENTRIES)
    expect(JSON.stringify(SHIJI_ENTRIES)).toBe(snapshot)
    expect(segments[0]).toEqual({
      source: 'shiji',
      id: SHIJI_ENTRIES[0].id,
      name: 'XuanShu',
      text: SHIJI_ENTRIES[0].summary,
      firstSeenAt: SHIJI_ENTRIES[0].firstSeenAt,
      lastActiveAt: SHIJI_ENTRIES[0].lastActiveAt,
      basis: { sessions: 3, docs: 2 },
    })
  })
})

describe('票13 · 降级如实标注（契约 §1/§4）', () => {
  it("digest='skeleton'：没有 `## 摘要` 节，正文头部明写「未提炼」", () => {
    const markdown = renderDigaoMarkdown({ segments: buildSegments(SOURCES), digest: 'skeleton', generatedAt: GENERATED_AT })
    expect(markdown).not.toContain('## 摘要')
    expect(markdown).toContain('未提炼')
    expect(markdown).toContain('只有规则骨架')
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
    // 摘要节在两段之前（先看汇总、再逐段核对）。
    expect(markdown.indexOf('## 摘要')).toBeLessThan(markdown.indexOf('## 最近在做什么'))
  })

  it('纯派生：同一输入两次渲染逐字相同；正文头部带「不可手改」与生成时间', () => {
    const first = renderDigaoMarkdown({ segments: buildSegments(SOURCES), digest: 'skeleton', generatedAt: GENERATED_AT })
    const second = renderDigaoMarkdown({ segments: buildSegments(SOURCES), digest: 'skeleton', generatedAt: GENERATED_AT })
    expect(second).toBe(first)
    expect(first).toContain('不可手改')
    expect(first).toContain(GENERATED_AT)
  })

  it('头部仍写段数与来源路数（四路里几路有内容），口径与 meta 一致', () => {
    const segments = [...buildSegments(SOURCES), ...buildPastSegments(SHIJI_ENTRIES)]
    const markdown = renderDigaoMarkdown({ segments, digest: 'skeleton', generatedAt: GENERATED_AT })
    expect(markdown).toContain('- 段：5 ｜ 来源：3 路（谱 2 / 工作区 1 / 事记 2）')
  })
})
