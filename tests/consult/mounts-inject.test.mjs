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
import { buildConsultContext, buildMountUpdateContext, sourceMarkMount } from '../../packages/xuanshu-host/lib/consult/context.mjs'
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

  it('挂载**变更**段：带变更标记 + 披露 + 纳入层正文，并声明「此前注入的已被取代」', () => {
    const text = buildMountUpdateContext({ mounts: PREVIEW })
    expect(text).toContain('【来源：临时挂载·变更】')
    expect(text).toContain('已被它取代')
    expect(text).toContain('【来源：临时挂载·披露】')
    expect(text).toContain(PREVIEW.notice)
    expect(text).toContain(sourceMarkMount('工作区「打印车间」（E:\\work\\print-shop）'))
    expect(text).toContain('排产表在这里。')
    // 被整层丢弃的那一层，正文一个字符都不进（与首轮注入同一条纪律）。
    expect(text).not.toContain('x'.repeat(50))
  })

  it('挂载**清空**段：说清「已全部移除」，不留一段没有内容的挂载标记', () => {
    const text = buildMountUpdateContext({ mounts: undefined })
    expect(text).toContain('【来源：临时挂载·变更】')
    expect(text).toContain('已全部移除')
    expect(text).not.toContain('【来源：临时挂载·披露】')
    expect(text).toBe(buildMountUpdateContext({ mounts: { layers: [] } }))
  })
})

describe('票 12 · 端到端：挂载真的进了会话', () => {
  /** 一套带挂载的现场：真目录 + 假 registry/fs + 假 agents + 真旁挂清单。`withFs:false` = 读不到内容。 */
  async function scene({ withFs = true } = {}) {
    const sandbox = makeSandbox('mounts-inject')
    roots.push(sandbox)
    sandbox.write('work/README.md', '# 打印车间\n排产表在这里。\n')
    sandbox.write('work/logo.png', 'PNGDATA')
    const root = sandbox.path('work')
    const registry = fakeWorkspaceRegistryForMounts({ workspaces: [{ id: 'ws-print', path: root, title: '打印车间' }] })
    const fs = withFs ? fakeFsReader() : undefined
    const agents = fakeAgents()
    const host = makeHost({
      services: {
        xuanshuHorosa: fakeHorosa(envelope('bazi-ok-default')).service,
        agents: agents.service,
        workspaceRegistry: registry.service,
        ...(fs === undefined ? {} : { fs: fs.service }),
        agentPresets: fakeAgentPresets().service,
        agentDefaultModel: fakeAgentDefaultModel().service,
      },
    })
    seedPu(sandbox, { name: '软件开发', level: 'base', description: '手上的项目。', summary: '项目摘要。' })
    const api = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir, mountBudget: 10_000 })
    const { session } = await api['consult.create']({ pus: [] })
    return { sandbox, api, agents, session, host }
  }

  /** 这个会话收到的投递（按顺序）：`{kind, text}`。 */
  function deliveries(agents, sessionId) {
    return agents.live.get(sessionId).calls.map((call) => ({
      kind: call.kind,
      text: call.message.content.map((block) => block.text).join('\n'),
    }))
  }
  const SPEC = { kind: 'workspace', id: 'ws-print', label: '打印车间' }
  const manifestOf = (sandbox, sessionId) => sandbox.json('consult', 'sessions', `${sessionId}.json`)

  it('setMounts 确认那一刻就把挂载排进会话（首轮上下文之后、下一问之前）', async () => {
    const { api, agents, session } = await scene()
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [SPEC] })
    await api['consult.send']({ sessionId: session.sessionId, text: '排产表怎么看' })

    const log = deliveries(agents, session.sessionId)
    // 顺序是被验的东西：首轮上下文（create 时灌）→ 挂载变更 → 问题。
    expect(log.map((row) => row.kind)).toEqual(['inject', 'inject', 'followup'])
    expect(log[0].text).toContain('【来源：底座谱】')
    expect(log[0].text).not.toContain('临时挂载')

    const mount = log[1].text
    expect(mount).toContain('【来源：临时挂载·变更】')
    expect(mount).toContain('【来源：临时挂载·披露】')
    expect(mount).toContain('【来源：挂载 工作区「打印车间」')
    expect(mount).toContain('排产表在这里。')
    // 二进制既不进正文，也不把 base64/乱码带进来（文件级排除的清单在抽屉里看，注入文本保持精简）
    expect(mount).not.toContain('PNGDATA')
    // 预算来自 config（10000）：没超预算 → 披露里说「没有裁剪」
    expect(mount).toContain('没有裁剪')
  })

  it('**迟到挂载不再静默失效**：首轮之后再挂 → 下一问之前补一段（评审发现的那一处）', async () => {
    const { api, agents, session, sandbox } = await scene()
    await api['consult.send']({ sessionId: session.sessionId, text: '先随便问一句' })
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [SPEC] })

    // 改挂载的那一刻就排进了会话（不等下一问）。
    expect(deliveries(agents, session.sessionId).map((row) => row.kind)).toEqual(['inject', 'followup', 'inject'])
    await api['consult.send']({ sessionId: session.sessionId, text: '现在看排产表' })

    const log = deliveries(agents, session.sessionId)
    const mountIndex = log.findIndex((row) => row.text.includes('【来源：临时挂载·变更】'))
    const questionIndex = log.findIndex((row) => row.kind === 'followup' && row.text.includes('现在看排产表'))
    expect(mountIndex).toBeGreaterThan(-1)
    // 判据是**顺序**：挂载内容必须排在它要影响的那一问之前。
    expect(mountIndex).toBeLessThan(questionIndex)
    expect(log[mountIndex].text).toContain('排产表在这里。')
    // 旁挂清单记下「这一份已经交给模型」：下一问不再重复灌。
    expect(manifestOf(sandbox, session.sessionId).mountsInjected).toEqual([SPEC])
  })

  it('同一份挂载重复确认：不重复注入（幂等）', async () => {
    const { api, agents, session } = await scene()
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [SPEC] })
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [SPEC] })
    await api['consult.send']({ sessionId: session.sessionId, text: '问一句' })

    const mounts = deliveries(agents, session.sessionId).filter((row) => row.text.includes('【来源：临时挂载·变更】'))
    expect(mounts).toHaveLength(1)
  })

  it('移除挂载：说清「已全部移除」，此前注入的挂载不再适用', async () => {
    const { api, agents, session } = await scene()
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [SPEC] })
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [] })

    const changes = deliveries(agents, session.sessionId).filter((row) => row.text.includes('【来源：临时挂载·变更】'))
    expect(changes).toHaveLength(2)
    expect(changes[0].text).toContain('排产表在这里。')
    expect(changes[1].text).toContain('已全部移除')
    expect(changes[1].text).not.toContain('排产表在这里。')
  })

  it('setMounts 那一刻拿不到活 agent（跨进程）→ 由下一问兜底补上', async () => {
    const { api, agents, session, sandbox } = await scene()
    // 先让这一场问事「已经问过一轮」：兜底那一段是给首轮之后的挂载变更用的。
    await api['consult.send']({ sessionId: session.sessionId, text: '先问一句' })

    // 模拟「这条会话是别的进程建的」：新实例没有句柄，进程里也没有这个 agent。
    const host2 = makeHost({
      services: {
        agents: agents.service,
        agentPresets: fakeAgentPresets().service,
        agentDefaultModel: fakeAgentDefaultModel().service,
        workspaceRegistry: fakeWorkspaceRegistryForMounts({ workspaces: [{ id: 'ws-print', path: sandbox.path('work'), title: '打印车间' }] }).service,
        fs: fakeFsReader().service,
      },
    })
    const other = createConsultMethods(host2.ctx, { dataDir: sandbox.dataDir, mountBudget: 10_000 })
    agents.live.clear()

    await other['consult.setMounts']({ sessionId: session.sessionId, mounts: [SPEC] })
    // 那一刻排不进去 → 旁挂清单不许假装「已经交给模型」。
    expect(manifestOf(sandbox, session.sessionId).mountsInjected).toBeUndefined()

    await other['consult.send']({ sessionId: session.sessionId, text: '现在看排产表' })
    const log = deliveries(agents, session.sessionId) // resume 之后重建的假 agent
    expect(log.map((row) => row.kind)).toEqual(['inject', 'followup'])
    expect(log[0].text).toContain('【来源：临时挂载·变更】')
    expect(log[0].text).toContain('排产表在这里。')
    expect(manifestOf(sandbox, session.sessionId).mountsInjected).toEqual([SPEC])
  })

  it('挂载内容读不出来时**不算交付**：留着不记账，下一问读到内容了才记「已交给模型」', async () => {
    const { api, agents, session, sandbox, host } = await scene({ withFs: false })
    await api['consult.setMounts']({ sessionId: session.sessionId, mounts: [SPEC] })
    // 那一刻读不出来（`ctx.fs` 不在）：披露照进（那是事实），但不能假装「内容已经交给模型」。
    expect(manifestOf(sandbox, session.sessionId).mountsInjected).toBeUndefined()
    expect(deliveries(agents, session.sessionId).at(-1).text).toMatch(/读不出来|不可得/u)

    await api['consult.send']({ sessionId: session.sessionId, text: '先问一句' })
    expect(manifestOf(sandbox, session.sessionId).mountsInjected).toBeUndefined()

    // fs 回来了（真机上这是常态：那一刻服务还没就位）→ 再问一次就补上真实内容。
    host.services.fs = fakeFsReader().service
    await api['consult.send']({ sessionId: session.sessionId, text: '现在看排产表' })
    const log = deliveries(agents, session.sessionId)
    expect(log.at(-2).text).toContain('排产表在这里。')
    expect(log.at(-1).text).toContain('现在看排产表')
    expect(manifestOf(sandbox, session.sessionId).mountsInjected).toEqual([SPEC])
  })

  it('没挂载的会话：没有挂载块（票 10 的行为一字不改）', async () => {
    const { api, agents, session } = await scene()
    await api['consult.send']({ sessionId: session.sessionId, text: '随便问一句' })
    const log = deliveries(agents, session.sessionId)
    expect(log).toHaveLength(2)
    expect(log[0].text).not.toContain('临时挂载')
    expect(log[0].text).toContain('【来源：底座谱】')
    expect(log[0].text).toContain('【来源：底稿】')
  })
})
