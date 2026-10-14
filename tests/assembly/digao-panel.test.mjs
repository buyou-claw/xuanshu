/**
 * 票 13 · 底稿半边（客户端）的契约与界面断言。
 *
 * 对应票面验收里属于**客户端半**的那几条：
 *   1. 契约 §2 的三个 `digao.*` 方法名**逐字一致**，且**没有**写方法（`digao.write` /
 *      `digao.update` 这类一律不存在——底稿不可手改，要改就改源头）；
 *   2. 契约 §1 的 markdown 形态能被解析成**三路来源分组**（章序固定：谱 → 工作区 → 工作流；
 *      每段首行标记 `【来源：…】`；某一路没内容时该组留在屏上、段数为 0，正文里的「尚无来源」原样可见）；
 *   3. 「纯派生 · 不可手改」徽标**逐字**、面板里**零编辑控件**（无 input / textarea / select /
 *      contenteditable），三个源头跳转齐备（谱 → S5 / 工作区 → DSH / 工作流 → S12）；
 *   4. `installDigao` 在**无 `document` 的 Node** 下安全返回：样式注入被守卫挡掉、注册面照做。
 *
 * 环境：`renderToStaticMarkup`（无 jsdom），因此本文件只断静态界面事实与纯函数；
 * 真浏览器里的点击链路**没有**被本文件覆盖——交付报告里如实标注。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DIGAO_ENDPOINTS, createDigaoApi } from '../../packages/xuanshu-client/src/client/digao-api.ts'
import { parseDigaoMarkdown } from '../../packages/xuanshu-client/src/client/digao-model.ts'
import { DigaoPanel, installDigao } from '../../packages/xuanshu-client/src/client/digao.tsx'
import {
  BADGE_DERIVED,
  DIGAO_ID,
  DIGAO_LABEL,
  DIGAO_ORDER,
} from '../../packages/xuanshu-client/src/client/panel.ts'

const render = (element) => renderToStaticMarkup(element)

/** 契约 §1 的正文形态（三路 + 工作流留空路），逐字取自冻结契约的骨架规则。 */
const DIGAO_MARKDOWN = [
  '# 底稿',
  '',
  '## 来源：谱',
  '【来源：谱 事业与行业】事业与行业 ▸ 近一年判断',
  '今年以稳为主；4—6 月有一次岗位变动，适合先谈条件再定去留。',
  '源自：pus/事业与行业/内容.md',
  '',
  '【来源：谱 技能与工具】技能与工具 ▸ 常用链',
  '常用链：node / pnpm / vitest。',
  '源自：pus/技能与工具/内容.md',
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

/** 契约 §1 的元数据（`digest:'llm'` = 真提炼过；`'skeleton'` = 降级骨架，必须如实标注）。 */
const META = {
  schema: 'xuanshu/digao@1',
  generatedAt: '2026-10-11 07:30',
  segments: 3,
  sources: 3,
  bySource: { pu: 2, workspace: 1, workflow: 0 },
  digest: 'llm',
}

/** 面板静态预置（给了就不取数：SSR 断言用）。 */
const preloadedReady = { status: { exists: true, meta: META }, read: { markdown: DIGAO_MARKDOWN, meta: META } }

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

/* ───────────────────────── 2. 来源分组解析（契约 §1 的确定性规则） ───────────────────────── */

describe('票 13 · 底稿 markdown 的来源分组解析', () => {
  const groups = parseDigaoMarkdown(DIGAO_MARKDOWN)

  it('三路分组按章序固定：谱 → 工作区 → 工作流', () => {
    expect(groups.map((group) => group.name)).toEqual(['谱', '工作区', '工作流'])
    expect(groups.map((group) => group.kind)).toEqual(['pu', 'workspace', 'workflow'])
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

  it('工作区段带行内标签与「源自：」，段数与来源都在', () => {
    const workspace = groups[1]
    expect(workspace.segments).toHaveLength(1)
    expect(workspace.segments[0].label).toBe('工作区')
    expect(workspace.segments[0].name).toBe('xuanshu（本项目）')
    expect(workspace.segments[0].origin).toBe('workspace/xuanshu')
  })

  it('某一路没内容时组仍在、段数为 0，正文里的「尚无来源」原样保留', () => {
    const workflow = groups[2]
    expect(workflow.segments).toHaveLength(0)
    expect(workflow.note).toBe('尚无来源')
  })

  it('CRLF 与空行不影响解析（文件在 Windows 上被编辑过也一样）', () => {
    const crlf = parseDigaoMarkdown(DIGAO_MARKDOWN.replace(/\n/g, '\r\n'))
    expect(crlf.map((group) => group.segments.length)).toEqual([2, 1, 0])
    expect(crlf[0].segments[0].origin).toBe('pus/事业与行业/内容.md')
  })

  it('形态不符（没有来源章节）时返回空数组：界面据此给「按原文展示」的兜底，不假装解析成功', () => {
    expect(parseDigaoMarkdown('随手写的一点东西，没有来源章节。')).toEqual([])
    expect(parseDigaoMarkdown('')).toEqual([])
  })

  it('未知章节名保留为 other 组（不吞掉文件里出现过的东西）', () => {
    const groups2 = parseDigaoMarkdown('## 来源：藏\n【来源：藏 某条】\n正文\n')
    expect(groups2.map((group) => [group.kind, group.name])).toEqual([['other', '藏']])
    expect(groups2[0].segments[0].label).toBe('藏')
  })
})

/* ───────────────────────── 3. 底稿面板：只读（S13 / C2） ───────────────────────── */

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
        return { markdown: DIGAO_MARKDOWN, meta: META }
      },
      async refresh() {
        calls.push('digao.refresh')
        return { meta: META }
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

  it('ready：三路来源分组按章序渲染，组头带段数，段有行内标签与「源自：」', () => {
    const html = render(h(DigaoPanel, { api: spyApi().api, ...injected(), preloaded: preloadedReady }))
    const pu = html.indexOf('来源：谱')
    const workspace = html.indexOf('来源：工作区')
    const workflow = html.indexOf('来源：工作流')
    expect(pu).toBeGreaterThanOrEqual(0)
    expect(workspace).toBeGreaterThan(pu)
    expect(workflow).toBeGreaterThan(workspace)
    expect(html).toContain('来源：谱（2 段）')
    expect(html).toContain('来源：工作区（1 段）')
    expect(html).toContain('来源：工作流（0 段）')
    expect(html).toContain('data-xuanshu-source-tag="谱"')
    expect(html).toContain('[谱]')
    expect(html).toContain('[工作区]')
    expect(html).toContain('事业与行业')
    expect(html).toContain('今年以稳为主；4—6 月有一次岗位变动')
    expect(html).toContain('源自：pus/事业与行业/内容.md')
    // 空路的「尚无来源」原样可见（C2：哪一路这轮没内容，一眼看得出）。
    expect(html).toContain('尚无来源')
  })

  it('ready：摘要来源如实标注（digest=llm → AI 提炼；骨架 = 确定性规则）', () => {
    const llm = render(h(DigaoPanel, { api: spyApi().api, ...injected(), preloaded: preloadedReady }))
    expect(llm).toContain('骨架＝确定性规则')
    expect(llm).toContain('摘要＝AI 提炼')

    const skeleton = render(
      h(DigaoPanel, {
        api: spyApi().api,
        ...injected(),
        preloaded: {
          status: { exists: true, meta: { ...META, digest: 'skeleton' } },
          read: { markdown: DIGAO_MARKDOWN, meta: { ...META, digest: 'skeleton' } },
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
    expect(html).toContain('上次刷新 2026-10-11 07:30')
    expect(html).toContain('下次刷新')
    expect(html).toContain('自动化任务')
  })

  it('宿主回传 schedule 时显示计划时刻（可选字段；缺失就只指路，不编一个时刻）', () => {
    const html = render(
      h(DigaoPanel, {
        api: spyApi().api,
        ...injected(),
        preloaded: {
          status: { exists: true, meta: META, schedule: { time: '03:30:00', timeZone: 'Asia/Shanghai', id: 'sched-digao-1' } },
          read: { markdown: DIGAO_MARKDOWN, meta: META },
        },
      }),
    )
    // 计划时刻 = 03:30（契约 §1 的播种默认），与「上次刷新」分列，不合成一个数字。
    expect(html).toContain('下次刷新 03:30（Asia/Shanghai）')
    expect(html).toContain('上次刷新 2026-10-11 07:30')
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

  it('正文形态不符（没有来源章节）时按原文只读展示，并说明形态不符', () => {
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
    expect(html).toContain('## 来源：谱')
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
    expect(() => installDigao(ctx, { api: spyApi().api, navigate: () => {} })).not.toThrow()
    expect(registrations.map((row) => ({ name: row.name, key: row.key, id: row.id, order: row.order, label: row.label }))).toEqual([
      { name: 'main', key: DIGAO_ID, id: undefined, order: undefined, label: undefined },
      { name: 'sidebar.panellist', key: undefined, id: DIGAO_ID, order: DIGAO_ORDER, label: DIGAO_LABEL },
    ])
    expect(DIGAO_ID).toBe('digao')
    expect(DIGAO_LABEL).toBe('底稿')
    expect(DIGAO_ORDER).toBe(60) // S13 §8 定的落位（S15 六行表：库 · 底稿 60）
    expect(Object.keys(registrations[0].inject()).sort()).toEqual(['api', 'navigate'])
  })
})

