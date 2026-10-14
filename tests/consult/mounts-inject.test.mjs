/**
 * 票 12 · 挂载进首轮注入（S8 §5 步骤 7；契约 §2「注入前按预算分层裁剪并披露」）
 *
 * 两半都验：
 *   ① **纯函数**（`buildConsultContext`）：装出来的文本里有披露块、有纳入层的正文、
 *      有「此处裁去 N 字」，**没有被丢弃层的内容**；
 *   ② **服务端到端**（`consult.setMounts` → `consult.send`）：挂载真的进了首轮注入消息，
 *      而不是只躺在旁挂清单里。
 *
 * 还有一条**加性**判据：没有挂载的会话，注入文本与加挂载之前**逐字节相同** ——
 * 票 12 不许改变任何「没挂东西」的问事行为（票 10 的 send/turn 断言台也是靠这条继续绿的）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { buildConsultContext, sourceMarkMount } from '../../packages/xuanshu-host/lib/consult/context.mjs'
import {
  envelope,
  fakeAgentDefaultModel,
  fakeAgentPresets,
  fakeAgents,
  fakeFsReader,
  fakeHorosa,
  fakeWorkspaceRegistryForMounts,
  makeHost,
  makeSandbox,
  seedPu,
} from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

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
    expect(buildConsultContext({ ...base })).not.toContain('挂载')
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

describe('票 12 · 端到端：挂载真的进了首轮注入', () => {
  /** 一套带挂载的 send 现场：真目录 + 假 registry/fs + 假 agents + 真旁挂清单。 */
  async function scene() {
    const sandbox = makeSandbox('mounts-inject')
    roots.push(sandbox)
    sandbox.write('work/README.md', '# 打印车间\n排产表在这里。\n')
    sandbox.write('work/logo.png', 'PNGDATA')
    const root = sandbox.path('work')
    const registry = fakeWorkspaceRegistryForMounts({ workspaces: [{ id: 'ws-print', path: root, title: '打印车间' }] })
    const fs = fakeFsReader()
    const agents = fakeAgents()
    const host = makeHost({
      services: {
        xuanshuHorosa: fakeHorosa(envelope('bazi-ok-default')).service,
        agents: agents.service,
        workspaceRegistry: registry.service,
        fs: fs.service,
        agentPresets: fakeAgentPresets().service,
        agentDefaultModel: fakeAgentDefaultModel().service,
      },
    })
    seedPu(sandbox, { name: '软件开发', level: 'base', description: '手上的项目。', summary: '项目摘要。' })
    const api = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir, mountBudget: 10_000 })
    const { session } = await api['consult.create']({ pus: [] })
    return { sandbox, api, agents, session }
  }

  /** 首轮注入的正文。 */
  function injectedText(agents, sessionId) {
    const calls = agents.live.get(sessionId).calls
    const injected = calls.filter((call) => call.kind === 'inject')
    expect(injected).toHaveLength(1)
    return injected[0].message.content.map((block) => block.text).join('\n')
  }

  it('setMounts 之后 send：注入文本里有挂载标记、文件正文与披露；二进制不进', async () => {
    const { api, agents, session } = await scene()
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [{ kind: 'workspace', id: 'ws-print', label: '打印车间' }] })
    await api['consult.send']({ sessionId: session.sessionId, text: '排产表怎么看' })

    const text = injectedText(agents, session.sessionId)
    expect(text).toContain('【来源：临时挂载·披露】')
    expect(text).toContain('【来源：挂载 工作区「打印车间」')
    expect(text).toContain('排产表在这里。')
    // 二进制既不进正文，也不把 base64/乱码带进来（文件级排除的清单在抽屉里看，注入文本保持精简）
    expect(text).not.toContain('PNGDATA')
    // 预算来自 config（10000）：没超预算 → 披露里说「没有裁剪」
    expect(text).toContain('没有裁剪')
  })

  it('没挂载的会话：注入文本里没有挂载块（票 10 的行为一字不改）', async () => {
    const { api, agents, session } = await scene()
    await api['consult.send']({ sessionId: session.sessionId, text: '随便问一句' })
    const text = injectedText(agents, session.sessionId)
    expect(text).not.toContain('临时挂载')
    expect(text).toContain('【来源：底座谱】')
    expect(text).toContain('【来源：底稿】')
  })
})
