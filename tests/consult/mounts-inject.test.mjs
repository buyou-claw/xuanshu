/**
 * 票 12 · 挂载进注入文本（S8 §5 步骤 7；契约 §2「注入前按预算分层裁剪并披露」）
 *
 * 这一份只验**纯函数的文本口径**（`buildConsultContext`）：披露块、纳入层的正文、
 * 「此处裁去 N 字」、以及**没有被丢弃层的内容**。
 *
 * 谁把这段文本送进模型、什么时候送 —— 归 `tests/consult/boundary.test.mjs`
 * （`agent/pre-step` 边界：每一问按当前挂载现读现裁，读不出来的层下一问自动重试）。
 *
 * 还有一条**加性**判据：没有挂载的会话，注入文本与加挂载之前**逐字节相同** ——
 * 票 12 不许改变任何「没挂东西」的问事行为（票 10 的 send/turn 断言台也是靠这条继续绿的）。
 */
import { describe, expect, it } from 'vitest'

import { buildConsultContext, buildMountDeltaContext, buildMountRetraction, sourceMarkMount } from '../../packages/xuanshu-host/lib/consult/context.mjs'

/** 一个装好的预览结果（形状 = `buildMountPreview()` 的产物；不手搓层以外的字段）。 */
const PREVIEW = {
  layers: [
    {
      id: 'workspace:ws-print',
      kind: 'workspace',
      label: '打印车间',
      head: '工作区「打印车间」（E:\\work\\print-shop）',
      chars: 300,
      keptChars: 120,
      kept: true,
      clipped: true,
      dropped: false,
      keptSegments: [{ label: 'README.md', chars: 120 }],
      droppedSegments: [
        { label: 'src/main.mjs', chars: 180, reason: '超预算未纳入' },
        { label: 'logo.png', chars: 0, reason: '二进制或媒体文件' },
      ],
      segments: [{ id: 'README.md', label: 'README.md', chars: 120, text: '# 打印车间\n排产表在这里。' }],
    },
    {
      id: 'workspace:ws-xuanshu',
      kind: 'workspace',
      label: '玄枢开发',
      head: '工作区「玄枢开发」（E:\\ai_project\\XuanShu）',
      chars: 5000,
      keptChars: 0,
      kept: false,
      clipped: false,
      dropped: true,
      reason: '超预算未纳入 · 本次不会进入上下文',
      keptSegments: [],
      droppedSegments: [{ label: 'README.md', chars: 5000, reason: '超预算未纳入' }],
      segments: [],
    },
  ],
  totalChars: 5300,
  keptChars: 120,
  budget: 1000,
  truncatedChars: 5180,
  keptLayers: 1,
  totalLayers: 2,
  notice: '【挂载披露】本次挂载 2 层、共 5,300 字；预算 1,000 字，纳入 1 / 2 层、120 字；裁去 5,180 字（按段边界裁剪，未切半句话；被整层丢弃的层不会进入上下文）。',
  notes: ['本次装配 5,300 字 > 预算 1,000 字：按**段边界**公平裁剪（水位 500 字／层），没有切半句话。'],
}

describe('票 12 · 注入文本：披露块 + 纳入层正文 + 裁减注明', () => {
  const base = { dataDir: 'C:\\x', basePu: null, digao: null, selected: [] }

  it('**加性**：没有挂载时输出与不传 mounts 逐字节相同', () => {
    expect(buildConsultContext({ ...base })).toBe(buildConsultContext({ ...base, mounts: undefined }))
    expect(buildConsultContext({ ...base, mounts: { layers: [] } })).toBe(buildConsultContext({ ...base }))
    // 判据打在**挂载段的标记**上（正文里提到「改过挂载」不算多出挂载段）。
    expect(buildConsultContext({ ...base })).not.toContain('【来源：临时挂载')
  })

  it('有挂载：披露块在前（含 notice 与逐层 Tag），纳入层的正文在后', () => {
    const text = buildConsultContext({ ...base, mounts: PREVIEW })
    expect(text).toContain('【来源：临时挂载·披露】')
    expect(text).toContain(PREVIEW.notice)
    // 逐层 Tag：纳入/裁剪/丢弃三态都在披露块里看得见
    expect(text).toContain('工作区「打印车间」')
    expect(text).toContain('已纳入 120 / 300 字（已按段边界裁剪）')
    expect(text).toContain('超预算未纳入 · 本次不会进入上下文')
    // 纳入层的正文用【来源：挂载 …】标记
    expect(text).toContain(sourceMarkMount('工作区「打印车间」（E:\\work\\print-shop）'))
    expect(text).toContain('排产表在这里。')
  })

  it('**被丢弃的层正文一个字符都不进注入**（整层丢弃 ≠ 静默截断）', () => {
    const text = buildConsultContext({ ...base, mounts: PREVIEW })
    expect(text).not.toContain('玄枢开发（E:\\ai_project\\XuanShu）】\n──')
    // 它的段正文（5000 字的占位）当然也不该出现
    expect(text).not.toContain('x'.repeat(50))
  })

  it('裁掉的段在正文里注明「此处裁去 N 字」（S8 §2.3）', () => {
    const text = buildConsultContext({ ...base, mounts: PREVIEW })
    expect(text).toContain('此处裁去 180 字')
    expect(text).toContain('src/main.mjs')
  })

  it('预算未知：披露块照实写「预算未知」，不出现任何编出来的预算数字', () => {
    const unknown = {
      ...PREVIEW,
      budget: null,
      truncatedChars: 0,
      notice: '【挂载披露】本次挂载 2 层、共 5,300 字；预算未知（拿不到模型窗口），未做裁剪：全部纳入。',
      // notes 也要跟着一致：真实的「预算未知」路径里 clip 只会给这一条。
      notes: ['预算未知：本次不做裁剪，全部纳入（界面显示「预算未知」，不编一个数）。'],
    }
    const text = buildConsultContext({ ...base, mounts: unknown })
    expect(text).toContain('预算未知')
    expect(text).not.toMatch(/预算\s*\d/u)
  })
})

/**
 * 挂载**增量段**（票 12；复核 R3/R4）：只补「模型还没见过内容的层」+「已经撤下的层」。
 *
 * 端到端（谁在什么时机用它、逐层记账怎么走）在 `tests/consult/boundary.test.mjs`；
 * 这里只钉文本口径 —— 特别是**撤下**那一句：它是 R3/R4 之后补回来的覆盖
 * （旧实现删掉 `buildMountUpdateContext` 时把这条一起弄丢了）。
 */
describe('票 12 · 增量段：只补没见过的层 + 撤下的层', () => {
  it('只补投的层：带一句话说明 + 披露 + 正文；没有可补的就一个字符都不产出', () => {
    expect(buildMountDeltaContext({})).toBe('')
    expect(buildMountDeltaContext({ preview: { layers: [] }, removed: [] })).toBe('')

    const text = buildMountDeltaContext({ preview: PREVIEW })
    expect(text).toContain('本次补投临时挂载')
    expect(text).toContain('【来源：临时挂载·披露】')
    expect(text).toContain('排产表在这里。')
    expect(text).not.toContain('【来源：临时挂载·撤下】')
  })

  it('撤下的层：说清「已撤下、不再适用」并点名；没有撤下就一个字都不说', () => {
    expect(buildMountRetraction({ removed: [] })).toBe('')

    const text = buildMountDeltaContext({ removed: [{ kind: 'workspace', id: 'ws-print', label: '打印车间' }] })
    expect(text).toContain('【来源：临时挂载·撤下】')
    expect(text).toContain('工作区「打印车间」')
    expect(text).toContain('不再适用')
    // 撤下不是「没有挂载段」：一条正文都不该顺带装进来。
    expect(text).not.toContain('【来源：临时挂载·披露】')
  })

  it('工作流挂载的撤下也点名（kind 决定称呼，不写成「工作区」）', () => {
    const text = buildMountRetraction({ removed: [{ kind: 'workflow', id: 'wf-1', label: '周报' }] })
    expect(text).toContain('工作流「周报」')
    expect(text).not.toContain('工作区「周报」')
  })
})