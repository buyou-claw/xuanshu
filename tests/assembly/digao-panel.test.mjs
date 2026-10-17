/**
 * 票 13 · 底稿半边（客户端）的契约与界面断言；票 27（#27）扩成两段 + 事记条目。
 *
 * 对应票面验收里属于**客户端半**的那几条：
 *   1. 契约 §2 的三个 `digao.*` 方法名**逐字一致**，且**没有**写方法（`digao.write` /
 *      `digao.update` 这类一律不存在——底稿不可手改，要改就改源头）；
 *   2. 契约 §3 的 markdown 形态能被解析成**两段**（最近 / 曾经）：
 *      「最近」按 谱 → 工作区 → 工作流 三路、每段首行 `【来源：…】`、空路写「（尚无来源：<路>）」；
 *      「曾经」是事记条目（`【来源：事记 <name>】` + 日期区间 + 依据 + 摘要）；
 *      **旧文件（三章 `## 来源：…`）仍然能解析**（升级后不能把老底稿读成「形态不符」）；
 *   3. 「纯派生 · 不可手改」徽标**逐字**、面板里**零编辑控件**（无 input / textarea / select /
 *      contenteditable），三个源头跳转齐备（谱 → S5 / 工作区 → DSH / 工作流 → S12）；
 *   4. 事记的 [删除] 动作在条目上：只给**读得到 id** 的条目（md 里的记录 ↔ `digao.read.shiji.entries`
 *      按「名字 + 最后活跃日期」对上）；删掉的条目下一次读就不再渲染，并给「可在设置里恢复」的话；
 *   5. `installDigao` 在**无 `document` 的 Node** 下安全返回：样式注入被守卫挡掉、注册面照做。
 *
 * 环境：`renderToStaticMarkup`（无 jsdom），因此本文件只断静态界面事实与纯函数；
 * 真浏览器里的点击链路（确认 → 删除 → 重读）**没有**被本文件覆盖——交付报告里如实标注。
 */
import { readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DIGAO_ENDPOINTS, createDigaoApi } from '../../packages/xuanshu-client/src/client/digao-api.ts'
import { matchShijiEntries, parseDigaoMarkdown } from '../../packages/xuanshu-client/src/client/digao-model.ts'
import { DigaoPanel, installDigao } from '../../packages/xuanshu-client/src/client/digao.tsx'
import {
  BADGE_DERIVED,
  DIGAO_ID,
  DIGAO_LABEL,
  DIGAO_ORDER,
} from '../../packages/xuanshu-client/src/client/panel.ts'

const render = (element) => renderToStaticMarkup(element)

/**
 * 契约 §3 的正文形态（**逐字取自宿主的 `renderDigaoMarkdown()`**）：两段 + 四路来源标记，
 * 其中工作流这一路本轮没内容（空态点名），事记两条。
 */
const DIGAO_MARKDOWN = [
  '# 底稿',
  '',
  '> 纯派生 · 不可手改：本文件由玄枢从源头派生，要改就改源头（谱 / 工作区 / 工作流）。',
  '',
  '- 生成时间：2026-10-17T03:30:00.000Z',
  '- 段：5 ｜ 来源：3 路（谱 2 / 工作区 1 / 事记 2）',
  '- 未提炼：LLM 不可用或失败，本份为规则骨架（digest=skeleton）',
  '',
  '## 最近在做什么',
  '',
  '【来源：谱 事业与行业】事业与行业 ▸ 近一年判断',
  '今年以稳为主；4—6 月有一次岗位变动，适合先谈条件再定去留。',
  '源自：pus/事业与行业/内容.md',
  '',
  '【来源：谱 技能与工具】技能与工具 ▸ 常用链',
  '常用链：node / pnpm / vitest。',
  '源自：pus/技能与工具/内容.md',
  '',
  '【来源：工作区 xuanshu（本项目）】工作区「xuanshu（本项目）」 · 路径 E:\\ai_project\\XuanShu · 会话 3 场 · 最近活跃 2026-10-17',
  '玄枢装配仓库：一个 profile + 两个插件包。',
  '源自：workspace/xuanshu',
  '',
  '（尚无来源：工作流）',
  '',
  '## 曾经做过什么',
  '',
  '【来源：事记 XuanShu】2026-09-01～2026-10-17 · 依据：会话 3 场 · 文档 2 份',
  '在做玄枢：DSH profile + 两个插件包，当前在接事记与底稿两段。',
  '',
  '【来源：事记 把周报自动化】2026-10-10～2026-10-12 · 依据：会话 1 场 · 文档 1 份',
  '工作流导出成 skill 了，每周五跑一次。',
  '',
].join('\n')

/** 升级前的旧形态（三章 `## 来源：…`）：老底稿文件必须还能读，不许整段退化成「形态不符」。 */
const DIGAO_MARKDOWN_LEGACY = [
  '# 底稿',
  '',
  '## 来源：谱',
  '【来源：谱 事业与行业】事业与行业 ▸ 近一年判断',
  '今年以稳为主；4—6 月有一次岗位变动。',
  '源自：pus/事业与行业/内容.md',
  '',
  '## 来源：工作区',
  '【来源：工作区 xuanshu（本项目）】xuanshu（本项目） · 扫描于 2026-10-11 07:30',
  '玄枢装配仓库：一个 profile + 两个插件包。',
  '源自：workspace/xuanshu',
  '',
  '## 来源：工作流',
  '尚无来源',
  '',
].join('\n')

/** 契约 §1/§3 的元数据（`digest:'llm'` = 真提炼过；`'skeleton'` = 降级骨架，必须如实标注）。 */
const META = {
  schema: 'xuanshu/digao@1',
  generatedAt: '2026-10-17T03:30:00.000Z',
  segments: 5,
  sources: 3,
  bySource: { pu: 2, workspace: 1, shiji: 2 },
  digest: 'llm',
  sections: { recent: 4, past: 2 },
}

/** `digao.read` 的**加性**事记读面（UI 的删除动作要 id；形状见契约 §3）。 */
const SHIJI_READ = {
  entries: [
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
  ],
}

/** 面板静态预置（给了就不取数：SSR 断言用）。 */
const preloadedReady = {
  status: { exists: true, meta: META, shiji: SHIJI_READ },
  read: { markdown: DIGAO_MARKDOWN, meta: META, shiji: SHIJI_READ },
}

/** 面板的注入面（导航用假实现；数据面按用例给）。 */
const injected = (navigate = () => {}) => ({ navigate })

/* ───────────────────────── 1. 三个 RPC 方法名（契约 §2） ───────────────────────── */

describe('票 13 · 底稿数据面的方法名逐字对齐契约 §2', () => {
  it('三个方法名是契约表格那一列的原文', () => {
    expect(DIGAO_ENDPOINTS).toEqual({
      status: 'digao.status',
      read: 'digao.read',
      refresh: 'digao.refresh',
    })
  })

  it('没有写方法：不可手改（要改就改源头，契约 §1）', () => {
    const methods = Object.values(DIGAO_ENDPOINTS)
    expect(methods).not.toContain('digao.write')
    expect(methods).not.toContain('digao.update')
    expect(methods.some((method) => /write|update|save|edit/i.test(method)), '底稿数据面不得出现写方法').toBe(false)
  })

  it('三个方法都走 /xuanshu 通道，请求体为空对象（缺省原样透传）', async () => {
    const calls = []
    const ctx = {
      connection: {
        rpc: {
          async call(...args) {
            calls.push(args)
            return { ok: true, value: { exists: false, meta: null } }
          },
        },
      },
    }
    const api = createDigaoApi(ctx)
    await api.status()
    await api.read()
    await api.refresh()
    expect(calls.map((call) => [call[0], call[1]])).toEqual([
      ['/xuanshu', 'digao.status'],
      ['/xuanshu', 'digao.read'],
      ['/xuanshu', 'digao.refresh'],
    ])
  })

  it('RPC 失败时抛出（由调用方决定降级：面板 error 态）', async () => {
    const ctx = { connection: { rpc: { async call() { return { ok: false, error: { message: '底稿读不出来' } } } } } }
    await expect(createDigaoApi(ctx).read()).rejects.toThrow('底稿读不出来')
  })
})

/* ───────────────────────── 2. 两段解析（契约 §3 的确定性规则） ───────────────────────── */

describe('票 27 · 底稿 markdown 的两段解析（最近 / 曾经）', () => {
  const groups = parseDigaoMarkdown(DIGAO_MARKDOWN)

  it('四组按段序与路序排：最近（谱 → 工作区 → 工作流）→ 曾经（事记）', () => {
    expect(groups.map((group) => [group.section, group.kind, group.name])).toEqual([
      ['recent', 'pu', '谱'],
      ['recent', 'workspace', '工作区'],
      ['recent', 'workflow', '工作流'],
      ['past', 'shiji', '事记'],
    ])
  })

  it('每段首行标记解析出「行内来源标签 + 名称」，正文与「源自：」分列', () => {
    const pu = groups[0]
    expect(pu.segments).toHaveLength(2)
    expect(pu.segments[0].label).toBe('谱')
    expect(pu.segments[0].name).toBe('事业与行业')
    expect(pu.segments[0].body).toContain('今年以稳为主；4—6 月有一次岗位变动')
    expect(pu.segments[0].origin).toBe('pus/事业与行业/内容.md')
    // 「源自：」那一行不再混在正文里（界面上单列一行）。
    expect(pu.segments[0].body).not.toContain('源自：')
    expect(pu.segments[1].name).toBe('技能与工具')
    expect(pu.segments[1].origin).toBe('pus/技能与工具/内容.md')
  })

  it('工作区段带行内标签与「源自：」，段文本里有最近活跃日期', () => {
    const workspace = groups[1]
    expect(workspace.segments).toHaveLength(1)
    expect(workspace.segments[0].label).toBe('工作区')
    expect(workspace.segments[0].name).toBe('xuanshu（本项目）')
    expect(workspace.segments[0].body).toContain('最近活跃 2026-10-17')
    expect(workspace.segments[0].origin).toBe('workspace/xuanshu')
  })

  it('空路仍占一组、段数为 0，空态那句话原样保留（哪一路这轮没内容，一眼看得出）', () => {
    const workflow = groups[2]
    expect(workflow.section).toBe('recent')
    expect(workflow.segments).toHaveLength(0)
    expect(workflow.note).toBe('（尚无来源：工作流）')
  })

  it('事记条目解析出名字 / 日期区间 / 依据 / 摘要（删除动作要靠这些字段对人）', () => {
    const past = groups[3]
    expect(past.section).toBe('past')
    expect(past.segments).toHaveLength(2)
    const [first, second] = past.segments
    expect(first.label).toBe('事记')
    expect(first.kind).toBe('shiji')
    expect(first.name).toBe('XuanShu')
    expect(first.since).toBe('2026-09-01')
    expect(first.until).toBe('2026-10-17')
    expect(first.basis).toEqual({ sessions: 3, docs: 2 })
    expect(first.body).toBe('在做玄枢：DSH profile + 两个插件包，当前在接事记与底稿两段。')
    expect(second.name).toBe('把周报自动化')
    expect(second.basis).toEqual({ sessions: 1, docs: 1 })
  })

  it('CRLF 与空行不影响解析（文件在 Windows 上被编辑过也一样）', () => {
    const crlf = parseDigaoMarkdown(DIGAO_MARKDOWN.replace(/\n/g, '\r\n'))
    expect(crlf.map((group) => group.segments.length)).toEqual([2, 1, 0, 2])
    expect(crlf[0].segments[0].origin).toBe('pus/事业与行业/内容.md')
    expect(crlf[3].segments[0].since).toBe('2026-09-01')
  })

  it('旧形态（三章 `## 来源：…`）仍然解析：没有 section 归属，按原样分组（升级不弄丢老底稿）', () => {
    const legacy = parseDigaoMarkdown(DIGAO_MARKDOWN_LEGACY)
    expect(legacy.map((group) => [group.section, group.kind, group.name])).toEqual([
      [undefined, 'pu', '谱'],
      [undefined, 'workspace', '工作区'],
      [undefined, 'workflow', '工作流'],
    ])
    expect(legacy[0].segments[0].origin).toBe('pus/事业与行业/内容.md')
    expect(legacy[2].note).toBe('尚无来源')
  })

  it('形态不符（没有两段也没有来源章节）时返回空数组：界面据此给「按原文展示」的兜底', () => {
    expect(parseDigaoMarkdown('随手写的一点东西，没有来源章节。')).toEqual([])
    expect(parseDigaoMarkdown('')).toEqual([])
  })

  it('未知章节名保留为 other 组（不吞掉文件里出现过的东西）', () => {
    const groups2 = parseDigaoMarkdown('## 来源：藏\n【来源：藏 某条】\n正文\n')
    expect(groups2.map((group) => [group.kind, group.name])).toEqual([['other', '藏']])
    expect(groups2[0].segments[0].label).toBe('藏')
  })
})

describe('票 27 · 事记记录 ↔ 读面条目的配对（删除动作的判据）', () => {
  const records = parseDigaoMarkdown(DIGAO_MARKDOWN)[3].segments

  it('按「名字 + 最后活跃日期」对上 id（md 里不写 id：正文只有人读的标记）', () => {
    expect(matchShijiEntries(records, SHIJI_READ.entries).map((entry) => entry?.id)).toEqual([
      'shiji-aaaaaaaaaaaaaaaa',
      'shiji-bbbbbbbbbbbbbbbb',
    ])
  })

  it('读面里没有的那条 → undefined（界面据此不渲染它、并提示「可在设置里恢复」）', () => {
    const matched = matchShijiEntries(records, [SHIJI_READ.entries[0]])
    expect(matched.map((entry) => entry?.id)).toEqual(['shiji-aaaaaaaaaaaaaaaa', undefined])
  })

  it('没有事记读面（没有账本）→ 全部 undefined（界面不许自己编一个 id 去删）', () => {
    expect(matchShijiEntries(records, undefined)).toEqual([undefined, undefined])
  })
})

/* ───────────────────────── 3. 底稿面板：只读 + 事记可删（C2 / #27） ───────────────────────── */

/** 造一个记录调用的假数据面（不 mock 业务：只记方法名）。 */
function spyApi(over = {}) {
  const calls = []
  return {
    calls,
    api: {
      async status() {
        calls.push('digao.status')
        return { exists: false, meta: null }
      },
      async read() {
        calls.push('digao.read')
        return { markdown: DIGAO_MARKDOWN, meta: META, shiji: SHIJI_READ }
      },
      async refresh() {
        calls.push('digao.refresh')
        return { meta: META }
      },
      ...over,
    },
  }
}

/** 事记数据面（删除动作走它；静态渲染不该碰它）。 */
function spyShiji(over = {}) {
  const calls = []
  return {
    calls,
    api: {
      async list() {
        calls.push('shiji.list')
        return SHIJI_READ
      },
      async remove(payload) {
        calls.push({ method: 'shiji.remove', payload })
        return { ok: true, entry: SHIJI_READ.entries[0] }
      },
      async fromSession(payload) {
        calls.push({ method: 'shiji.fromSession', payload })
        return { ok: true, entry: SHIJI_READ.entries[0] }
      },
      ...over,
    },
  }
}

describe('票 13 · 底稿面板（只读视图）', () => {
  it('ready：徽标逐字「纯派生 · 不可手改」+ 三源头跳转 + 负向声明', () => {
    const html = render(h(DigaoPanel, { api: spyApi().api, ...injected(), preloaded: preloadedReady }))
    expect(html).toContain(`data-xuanshu-panel="${DIGAO_ID}"`)
    expect(html).toContain(BADGE_DERIVED)
    expect(html).toContain('纯派生 · 不可手改')
    expect(html).toContain('要改就改源头：')
    for (const target of ['pus', 'conversation', 'workflow']) {
      expect(html, `缺源头跳转 ${target}`).toContain(`data-xuanshu-nav="${target}"`)
    }
    expect(html).toContain('本面板没有编辑框、没有保存按钮')
  })

  it('ready：零编辑控件（C2 硬约束：没有 input / textarea / select / contenteditable）', () => {
    const html = render(h(DigaoPanel, { api: spyApi().api, ...injected(), preloaded: preloadedReady }))
    expect(html).not.toMatch(/<input|<textarea|<select/)
    expect(html).not.toContain('contenteditable')
    expect(html).not.toContain('role="textbox"')
  })

  it('ready：两段按契约章序渲染，组头带段数，段有行内标签与「源自：」', () => {
    const html = render(h(DigaoPanel, { api: spyApi().api, ...injected(), preloaded: preloadedReady }))
    // 两段的先后看**段容器**，不看字面（负向声明里也会提到「曾经做过什么」）。
    const recent = html.indexOf('data-xuanshu-section="recent"')
    const past = html.indexOf('data-xuanshu-section="past"')
    expect(recent).toBeGreaterThanOrEqual(0)
    expect(past).toBeGreaterThan(recent)
    expect(html).toContain('>最近在做什么<')
    expect(html).toContain('>曾经做过什么<')
    // 段内路序：谱 → 工作区 → 工作流（组头仍标来源）。
    expect(html.indexOf('来源：谱')).toBeLessThan(html.indexOf('来源：工作区'))
    expect(html.indexOf('来源：工作区')).toBeLessThan(html.indexOf('来源：工作流'))
    expect(html).toContain('来源：谱（2 段）')
    expect(html).toContain('来源：工作区（1 段）')
    expect(html).toContain('来源：工作流（0 段）')
    expect(html).toContain('data-xuanshu-source-tag="谱"')
    expect(html).toContain('[谱]')
    expect(html).toContain('[工作区]')
    expect(html).toContain('事业与行业')
    expect(html).toContain('今年以稳为主；4—6 月有一次岗位变动')
    expect(html).toContain('源自：pus/事业与行业/内容.md')
    // 空路的空态原样可见（C2：哪一路这轮没内容，一眼看得出）。
    expect(html).toContain('（尚无来源：工作流）')
  })

  it('ready：「曾经」逐条渲染事记：来源标记 [事记] + 名字 + 日期区间 + 依据 + 摘要', () => {
    const html = render(h(DigaoPanel, { api: spyApi().api, ...injected(), preloaded: preloadedReady }))
    const past = html.slice(html.indexOf('data-xuanshu-section="past"'))
    expect(past).toContain('来源：事记（2 条）')
    expect(past).toContain('data-xuanshu-source-tag="事记"')
    expect(past).toContain('[事记]')
    expect(past).toContain('XuanShu')
    expect(past).toContain('2026-09-01～2026-10-17 · 依据：会话 3 场 · 文档 2 份')
    expect(past).toContain('在做玄枢：DSH profile + 两个插件包')
    expect(past).toContain('把周报自动化')
    expect(past).toContain('2026-10-10～2026-10-12 · 依据：会话 1 场 · 文档 1 份')
  })

  it('ready：事记条目上有 [删除] 动作（带 id），但静态渲染不调任何写方法', () => {
    const shiji = spyShiji()
    const html = render(h(DigaoPanel, { api: spyApi().api, shiji: shiji.api, ...injected(), preloaded: preloadedReady }))
    expect(html).toContain('data-xuanshu-action="delete-shiji"')
    expect(html).toContain('data-xuanshu-shiji-id="shiji-aaaaaaaaaaaaaaaa"')
    expect(html).toContain('data-xuanshu-shiji-id="shiji-bbbbbbbbbbbbbbbb"')
    expect(html).toContain('删除')
    // 人没点 → 一个请求都不发；确认条也不预先展开。
    expect(shiji.calls).toEqual([])
    expect(html).not.toContain('data-xuanshu-action="delete-shiji-confirm"')
  })

  it('ready：读面里已没有的那条不渲染，并给「可在设置里恢复」的可读提示（删了就不再出现）', () => {
    const html = render(
      h(DigaoPanel, {
        api: spyApi().api,
        shiji: spyShiji().api,
        ...injected(),
        preloaded: {
          status: { exists: true, meta: META, shiji: { entries: [SHIJI_READ.entries[0]] } },
          read: { markdown: DIGAO_MARKDOWN, meta: META, shiji: { entries: [SHIJI_READ.entries[0]] } },
        },
      }),
    )
    expect(html).toContain('XuanShu')
    expect(html).not.toContain('把周报自动化')
    expect(html).toContain('可以在设置里恢复')
  })

  it('ready：没有事记读面时如实说明「这里暂时不能删」，不编 id、不假装删过', () => {
    const html = render(
      h(DigaoPanel, {
        api: spyApi().api,
        shiji: spyShiji().api,
        ...injected(),
        preloaded: {
          status: { exists: true, meta: META },
          read: { markdown: DIGAO_MARKDOWN, meta: META },
        },
      }),
    )
    // 条目照旧可见（正文是权威），但没有 [删除]（没读到账本就不许猜 id）。
    expect(html).toContain('2026-09-01～2026-10-17')
    expect(html).not.toContain('data-xuanshu-action="delete-shiji"')
    expect(html).toContain('没有读到事记账本')
  })

  it('摘要来源如实标注（digest=llm → AI 提炼；骨架 = 确定性规则）', () => {
    const llm = render(h(DigaoPanel, { api: spyApi().api, ...injected(), preloaded: preloadedReady }))
    expect(llm).toContain('骨架＝确定性规则')
    expect(llm).toContain('摘要＝AI 提炼')

    const skeleton = render(
      h(DigaoPanel, {
        api: spyApi().api,
        ...injected(),
        preloaded: {
          status: { exists: true, meta: { ...META, digest: 'skeleton' } },
          read: { markdown: DIGAO_MARKDOWN, meta: { ...META, digest: 'skeleton' }, shiji: SHIJI_READ },
        },
      }),
    )
    // 降级必须可观察：不许把骨架说成提炼稿。
    expect(skeleton).toContain('摘要＝规则骨架')
    expect(skeleton).toContain('LLM 不可用')
    expect(skeleton).not.toContain('摘要＝AI 提炼')
  })

  it('时间信息：上次刷新来自 meta.generatedAt；下次刷新不编造（指向自动化任务面板）', () => {
    const html = render(h(DigaoPanel, { api: spyApi().api, ...injected(), preloaded: preloadedReady }))
    expect(html).toContain('上次刷新 2026-10-17T03:30:00.000Z')
    expect(html).toContain('下次刷新')
    expect(html).toContain('自动化任务')
  })

  it('宿主回传 schedule 时显示计划时刻（可选字段；缺失就只指路，不编一个时刻）', () => {
    const html = render(
      h(DigaoPanel, {
        api: spyApi().api,
        ...injected(),
        preloaded: {
          status: { exists: true, meta: META, schedule: { time: '03:30:00', timeZone: 'Asia/Shanghai', id: 'sched-digao-1' }, shiji: SHIJI_READ },
          read: { markdown: DIGAO_MARKDOWN, meta: META, shiji: SHIJI_READ },
        },
      }),
    )
    // 计划时刻 = 03:30（契约 §1 的播种默认），与「上次刷新」分列，不合成一个数字。
    expect(html).toContain('下次刷新 03:30（Asia/Shanghai）')
    expect(html).toContain('上次刷新 2026-10-17T03:30:00.000Z')
    expect(html).toContain('自动化任务')
  })

  it('唯一的功能按钮是 [刷新]；只读动作（查看 MD 形态）不写内容', () => {
    const html = render(h(DigaoPanel, { api: spyApi().api, ...injected(), preloaded: preloadedReady }))
    expect(html).toContain('data-xuanshu-action="refresh-digao"')
    expect(html).toContain('data-xuanshu-action="view-md"')
    expect(html).not.toContain('data-xuanshu-action="save"')
    expect(html).not.toContain('data-xuanshu-action="edit"')
  })

  it('渲染期不触发 refresh（刷新是人点的；status/read 是只读取数）', () => {
    const spy = spyApi()
    const element = h(DigaoPanel, { api: spy.api, ...injected(), preloaded: preloadedReady })
    render(element)
    render(element) // 重渲染也不许跑
    expect(spy.calls).not.toContain('digao.refresh')
  })

  it('旧形态（三章）仍按原来的分组渲染（升级不弄丢老底稿）', () => {
    const html = render(
      h(DigaoPanel, {
        api: spyApi().api,
        ...injected(),
        preloaded: {
          status: { exists: true, meta: META },
          read: { markdown: DIGAO_MARKDOWN_LEGACY, meta: META },
        },
      }),
    )
    expect(html).toContain('来源：谱（1 段）')
    expect(html).toContain('来源：工作区（1 段）')
    expect(html).toContain('来源：工作流（0 段）')
    expect(html).toContain('尚无来源')
    expect(html).not.toContain('data-xuanshu-section="past"')
  })

  it('empty：没生成过时给「底稿还没生成过」+ [刷新] + 三源头跳转，且仍无编辑控件', () => {
    const html = render(
      h(DigaoPanel, {
        api: spyApi().api,
        ...injected(),
        preloaded: { status: { exists: false, meta: null } },
      }),
    )
    expect(html).toContain('底稿还没生成过')
    expect(html).toContain('data-xuanshu-action="refresh-digao"')
    expect(html).toContain('要改就改源头：')
    expect(html).not.toMatch(/<input|<textarea|<select/)
  })

  it('error：写明失败原因（不静默）', () => {
    const html = render(
      h(DigaoPanel, {
        api: spyApi().api,
        ...injected(),
        preloaded: { error: 'EACCES: 读不了 digao.md' },
      }),
    )
    expect(html).toContain('EACCES: 读不了 digao.md')
    expect(html).toContain('data-xuanshu-action="retry"')
  })

  it('正文形态不符（既没有两段也没有来源章节）时按原文只读展示，并说明形态不符', () => {
    const raw = '# 底稿\n\n随手写的一点东西。\n'
    const html = render(
      h(DigaoPanel, {
        api: spyApi().api,
        ...injected(),
        preloaded: { status: { exists: true, meta: META }, read: { markdown: raw, meta: META } },
      }),
    )
    expect(html).toContain('形态不符')
    expect(html).toContain('随手写的一点东西。')
    expect(html).not.toMatch(/<input|<textarea|<select/)
  })

  it('查看 MD 形态给出的就是文件原文（界面是文件的投影）', () => {
    const html = render(
      h(DigaoPanel, {
        api: spyApi().api,
        ...injected(),
        preloaded: preloadedReady,
        preloadedRawView: true,
      }),
    )
    expect(html).toContain('data-xuanshu-raw="digao"')
    expect(html).toContain('## 最近在做什么')
    expect(html).toContain('## 曾经做过什么')
  })
})

/* ───────────────────────── 4. 面板安装：加性注册 + 非 DOM 安全 ───────────────────────── */

describe('票 13 · installDigao（加性注册 / 无 document 安全）', () => {
  /** 只提供 `slots` 的最小 ctx（`layout` 故意不给：安装期不许用它）。 */
  function installCtx() {
    const registrations = []
    return {
      registrations,
      ctx: {
        slots: {
          inject: (_key, effect) => effect(),
          register: (options) => {
            registrations.push(options)
            return () => {}
          },
          entries: () => [],
          subscribe: () => () => {},
        },
        layout: {
          selectPanel() {
            throw new Error('安装期不许调 selectPanel')
          },
        },
      },
    }
  }

  it('当前环境确实没有 document（证明这条断言不是在 jsdom 里空转）', () => {
    expect(typeof document).toBe('undefined')
  })

  it('注册 main key `digao` + 侧栏行 `digao`（order 60 / label 底稿），不切面板', () => {
    const { registrations, ctx } = installCtx()
    const shiji = spyShiji()
    expect(() => installDigao(ctx, { api: spyApi().api, shiji: shiji.api, navigate: () => {} })).not.toThrow()
    expect(registrations.map((row) => ({ name: row.name, key: row.key, id: row.id, order: row.order, label: row.label }))).toEqual([
      { name: 'main', key: DIGAO_ID, id: undefined, order: undefined, label: undefined },
      { name: 'sidebar.panellist', key: undefined, id: DIGAO_ID, order: DIGAO_ORDER, label: DIGAO_LABEL },
    ])
    expect(DIGAO_ID).toBe('digao')
    expect(DIGAO_LABEL).toBe('底稿')
    expect(DIGAO_ORDER).toBe(60) // S13 §8 定的落位（S15 六行表：库 · 底稿 60）
    expect(Object.keys(registrations[0].inject()).sort()).toEqual(['api', 'navigate', 'shiji'])
  })
})

describe('S6（复核）· 术语：用「来源标记」，不用「标签」', () => {
  it('CONTEXT.md 冻结的术语是「来源标记」；底稿的解析/视图源码里不许出现「来源标签」', () => {
    for (const file of ['digao-model.ts', 'digao.tsx']) {
      const source = readFileSync(new URL(`../../packages/xuanshu-client/src/client/${file}`, import.meta.url), 'utf8')
      expect(source, file).not.toContain('来源标签')
      expect(source, file).toContain('来源标记')
    }
  })
})
