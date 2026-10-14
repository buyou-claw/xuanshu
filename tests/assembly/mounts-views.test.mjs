/**
 * 票 12 · S8 抽屉与门厅挂载区的组件级断言（S8 §2/§7；C6③、C7①③②⑤）
 *
 * 环境是 `renderToStaticMarkup`（Node 里没有 jsdom），所以这里只驱动**受控组件**：
 * 点击链条（选入 → 预览 → 确认）由 `mounts-controller.ts` 的状态机承担（见 mounts-contract.test.mjs）。
 *
 * 抓的真实缺陷/风险：
 *   ① **边界句丢了**：抽屉顶部必须常驻「对象是工作区/工作流，谱不在这里」（C6③ 的一半）；
 *   ② **逐层 Tag 只剩一句「已裁剪」**：每层一枚、三档齐（C7①）；
 *   ③ **裁掉的清单不可见**：展开层必须能看「保留了 / 裁掉的」（C7③）；
 *   ④ **状态栏在预算未知时给数字**：C7⑤ 要「预算未知」四个字；
 *   ⑤ **工作流分区编造行**：数据源属票 16，必须是空态 + 可读理由；
 *   ⑥ **门厅在没有会话时把按钮装成可点**：挂载落在会话上，没有会话就该禁用 + 说明理由。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { XsMountDrawer, XsMountSection, XsMountStatusBar } from '../../packages/xuanshu-client/src/client/mounts-views.tsx'
import { layerRows } from '../../packages/xuanshu-client/src/client/mounts-model.ts'

const render = (element) => renderToStaticMarkup(element)

/** 按标记切出承载它的那个标签（只取开标签，便于断言属性）。 */
function tagOf(html, marker) {
  const index = html.indexOf(marker)
  if (index < 0) throw new Error(`渲染结果里没有 ${marker}`)
  return html.slice(html.lastIndexOf('<', index), html.indexOf('>', index) + 1)
}

/** 预览：一层已裁剪 + 一层被丢弃（覆盖三档 Tag 里的两档 + 分母）。 */
const PREVIEW = {
  layers: [],
  totalChars: 17_400,
  keptChars: 8_420,
  budget: 60_000,
  truncatedChars: 8_980,
  keptLayers: 1,
  totalLayers: 2,
  notice: '【挂载披露】本次挂载 2 层、共 17,400 字；预算 60,000 字，纳入 1 / 2 层、8,420 字；裁去 8,980 字。',
  notes: ['本次装配 17,400 字 > 预算 60,000 字：按**段边界**公平裁剪（水位 30,000 字／层），没有切半句话。', '整层丢弃 1 层（不会静默截断）：玄枢开发 —— 缩小挂载范围可以换回它们。'],
}

const ROWS = layerRows({
  ...PREVIEW,
  layers: [
    {
      id: 'workspace:ws-print',
      kind: 'workspace',
      label: '打印车间',
      head: '工作区「打印车间」（E:\\work\\print-shop）',
      chars: 12_400,
      keptChars: 8_420,
      kept: true,
      clipped: true,
      dropped: false,
      keptSegments: [{ label: 'README.md', chars: 8_420 }],
      droppedSegments: [{ label: '早前历史', chars: 3_980, reason: '超预算未纳入' }],
    },
    {
      id: 'workspace:ws-xuanshu',
      kind: 'workspace',
      label: '玄枢开发',
      head: '工作区「玄枢开发」（E:\\ai_project\\XuanShu）',
      chars: 5_000,
      keptChars: 0,
      kept: false,
      clipped: false,
      dropped: true,
      reason: '超预算未纳入 · 本次不会进入上下文',
      keptSegments: [],
      droppedSegments: [{ label: 'README.md', chars: 5_000, reason: '超预算未纳入' }],
    },
  ],
})

const WORKSPACES = [
  { id: 'ws-print', path: 'E:\\work\\print-shop', title: '打印车间', sessionCount: 3, updatedAt: '2026-10-11T02:00:00.000Z' },
  { id: 'ws-xuanshu', path: 'E:\\ai_project\\XuanShu', title: '玄枢开发', sessionCount: 38, updatedAt: '2026-10-11T03:00:00.000Z' },
]

/** 抽屉的默认 props（每个用例只覆盖自己关心的那几个）。 */
function drawer(over = {}) {
  return h(XsMountDrawer, {
    workspaces: WORKSPACES,
    workspaceAvailable: true,
    selection: [{ kind: 'workspace', id: 'ws-print', label: '打印车间' }],
    preview: PREVIEW,
    rows: ROWS,
    budgetSource: 'config',
    busy: false,
    canConfirm: true,
    foldOpen: () => true,
    onToggleWorkspace: () => {},
    onFold: () => {},
    onCancel: () => {},
    onConfirm: () => {},
    ...over,
  })
}

describe('票 12 · S8 抽屉：边界句 / 分区 / 逐层账本', () => {
  it('① 边界句常驻：对象是工作区 / 工作流，谱不在这里', () => {
    const html = render(drawer())
    expect(html).toContain('对象是工作区 / 工作流。谱不在这里——谱在问事面板里勾选。')
    expect(tagOf(html, 'data-xuanshu-boundary')).toContain('data-xuanshu-boundary="1"')
  })

  it('② 工作区分区：标题 + path + 会话数；选入即挂载（有勾选框，不是「勾选谱」那套）', () => {
    const html = render(drawer())
    expect(html).toContain('工作区（DSH 原有，只读引用）')
    expect(html).toContain('E:\\work\\print-shop')
    expect(html).toContain('3 个会话')
    expect(html).toContain('data-xuanshu-mount-check="ws-print"')
    // 已挂的那个是选中态（整枚开标签里必须带 checked）
    expect(tagOf(html, 'data-xuanshu-mount-check="ws-print"')).toContain('checked')
    expect(tagOf(html, 'data-xuanshu-mount-check="ws-xuanshu"')).not.toContain('checked')
    expect(html).toContain('去 DSH 工作区界面')
  })

  it('③ 工作流分区：空态 + 可读理由（数据源属票 16），不编造行', () => {
    const html = render(drawer())
    expect(tagOf(html, 'data-xuanshu-group="workflow"')).toContain('data-xuanshu-group="workflow"')
    expect(html).toContain('工作流清单的数据源属票 16')
    expect(html).not.toContain('data-xuanshu-mount-check="wf-')
  })

  it('④ 逐层 Tag 三档齐 + 展开可看「保留了 / 裁掉的」', () => {
    const html = render(drawer())
    expect(html).toContain('已裁剪 12,400→8,420 字')
    expect(html).toContain('超预算未纳入')
    expect(html).toContain('超预算未纳入 · 本次不会进入上下文')
    expect(html).toContain('保留了：README.md（8,420 字）')
    expect(html).toContain('裁掉的：早前历史')
    expect(tagOf(html, 'data-xuanshu-layer-tone="clipped"')).toContain('data-xuanshu-layer-tone="clipped"')
  })

  it('④b 折叠：收起的那层不渲染「保留了 / 裁掉了」两行（H2 的按层记忆落到视图上）', () => {
    const html = render(drawer({ foldOpen: (id) => id !== 'workspace:ws-print' }))
    expect(html).not.toContain('保留了：README.md')
    // 另一层（被丢弃的那层）本来就没有「保留」行；它的说明仍在
    expect(html).toContain('超预算未纳入 · 本次不会进入上下文')
  })

  it('⑤ 状态栏在抽屉底部：`挂载 8,420 字 / 预算 60,000 字（已纳入 1 / 2 层）`', () => {
    const html = render(drawer())
    expect(html).toContain('挂载 8,420 字 / 预算 60,000 字（已纳入 1 / 2 层）')
    expect(html).toContain('确认挂载到本轮')
    expect(html).toContain('取消')
  })

  it('⑤b 预算未知：状态栏写「预算未知」并带标记，不出现预算数字', () => {
    const html = render(drawer({ preview: { ...PREVIEW, budget: null, truncatedChars: 0, notes: ['预算未知：本次不做裁剪，全部纳入。'] }, budgetSource: 'unknown' }))
    expect(html).toContain('挂载 8,420 字 / 预算未知')
    expect(tagOf(html, 'data-xuanshu-budget-unknown')).toContain('data-xuanshu-budget-unknown="1"')
    expect(html).not.toMatch(/预算\s*[\d,]/u)
  })

  it('超预算给了出路与解释：整层丢弃不静默截断 + 「为什么砍」可展开', () => {
    const html = render(drawer())
    expect(html).toContain('整层丢弃；不会静默截断')
    expect(html).toContain('为什么砍（2 条）')
    expect(html).toContain('段边界')
  })

  it('错误态：错误条 + [重试]，且不显示任何假的数字', () => {
    const html = render(drawer({ preview: undefined, rows: [], error: 'DSH 文件服务（ctx.fs）不可得：挂载内容读不出来。', onRetry: () => {}, busy: false }))
    expect(tagOf(html, 'data-xuanshu-error="mounts"')).toContain('data-xuanshu-error="mounts"')
    expect(html).toContain('挂载内容读不出来')
    expect(html).toContain('重试')
    expect(html).toContain('挂载 … 字 / 预算 …')
  })

  it('工作区面不可用 / 一个工作区都没有：两种空态文案不同（别把「没面」说成「没有工作区」）', () => {
    expect(render(drawer({ workspaceAvailable: false, workspaces: [] }))).toContain('没有客户端工作区面')
    expect(render(drawer({ workspaces: [] }))).toContain('DSH 里还没有工作区')
  })
})

describe('票 12 · 门厅挂载区与常驻状态栏', () => {
  it('有会话：摘要 + 状态栏 + 可点开抽屉', () => {
    const html = render(h(XsMountSection, {
      mounts: [{ kind: 'workspace', id: 'ws-print', label: '打印车间' }],
      status: { keptChars: 8_420, budget: 60_000, keptLayers: 1, totalLayers: 2, overBudget: true },
      canMount: true,
      revision: 3,
      onOpen: () => {},
    }))
    expect(html).toContain('本次临时挂载：1 个工作区（打印车间）。')
    expect(html).toContain('挂载 8,420 字 / 预算 60,000 字（已纳入 1 / 2 层）')
    expect(tagOf(html, 'data-xuanshu-mounts-revision')).toContain('data-xuanshu-mounts-revision="3"')
    expect(html).not.toContain('disabled')
  })

  it('还没有会话：入口禁用 + 说明「先问一句」（挂载落在会话的清单上）', () => {
    const html = render(h(XsMountSection, { mounts: [], canMount: false }))
    expect(html).toContain('先生成一次问事，再临时挂载')
    expect(html).toMatch(/<button[^>]*data-xuanshu-action="open-mounts"[^>]*disabled/u)
    expect(html).toContain('本次没有临时挂载')
  })

  it('状态栏单独可用：没有预览时显示读取中，不编数字', () => {
    expect(render(h(XsMountStatusBar, {}))).toContain('挂载 … 字 / 预算 …')
    expect(render(h(XsMountStatusBar, { status: { keptChars: 0, budget: null, keptLayers: 0, totalLayers: 0, overBudget: false } }))).toContain('预算未知')
  })
})
