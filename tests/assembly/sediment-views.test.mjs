/**
 * 票 15 · 沉淀的**界面形状**（客户端）：入口条、草稿卡、确认弹窗、结果通知，以及三处加性注册。
 *
 * 对应票面「客户端：草稿预览 + 目标谱 + [更新到谱] 确认按钮；按钮不可用时理由可见」：
 *   1. 入口 `[导出汇总]` + 目标谱选择（`conversation.composer.dock`，list/session）——
 *      **只在问事会话里出现**（判据是自铸 id 前缀，不是 meta）；
 *   2. 草稿卡（`conversation.chat.turnTail`，list/session，id `xuanshu.sediment-draft`，order 30）：
 *      状态 + 字数 + 「尚未写进任何谱」+ 只读预览 + 目标谱 + 人点的动作；
 *   3. 确认弹窗：目标谱 / 逐段 diff / 字数变化 / 只读写入路径四件齐全；`[确认更新]` 是**第二道确认**，
 *      不可用时理由渲染在按钮下面（置灰而不说为什么 = 把闸门藏起来）；
 *   4. 结果通知（`shell.overlay`，list/root）：无内容时 `return null`（自动 click-through）。
 *
 * 环境诚实登记：本文件用 `renderToStaticMarkup`（无 jsdom）断言**静态界面事实**与纯模型；
 * 真浏览器里的点击链路（含取目标谱现状的 `useEffect`）**没有**被本文件覆盖，
 * 交付报告里如实标注 —— 不假装跑过。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { createSedimentController, isConsultSessionId } from '../../packages/xuanshu-client/src/client/sediment-model.ts'
import {
  SEDIMENT_DRAFT_CARD_ID,
  SEDIMENT_ENTRY_ID,
  SEDIMENT_NOTICE_ID,
  SEDIMENT_TURNTAIL_ORDER,
  XsSedimentConfirmDialog,
  XsSedimentDraftCard,
  XsSedimentEntry,
  XsSedimentNotice,
  installSediment,
} from '../../packages/xuanshu-client/src/client/sediment-views.tsx'

const SESSION = 'session-xs-consult-1bb37188-5787-4f96-a6ec-0de66a825f2a'
const render = (element) => renderToStaticMarkup(element)

const DRAFT = {
  description: '近一年事业判断的沉淀：以稳为主，4—6 月有一次岗位变动窗口。',
  body: '# 概览\n近一年事业判断的沉淀。\n\n## 近一年判断\n今年以稳为主；4—6 月有一次岗位变动，适合先谈条件再定去留。\n\n## 口径\n八字与紫微两路合看。\n',
  summary: '事业：稳为主，4—6 月有岗位变动窗口。',
}

const TARGET = {
  slug: '事业与行业',
  name: '事业与行业',
  level: 'optional',
  body: '# 概览\n事业与行业的总览。\n\n## 近一年判断\n今年以稳为主，步子收一收。\n\n## 口径\n八字与紫微两路合看。\n',
  summary: '旧的 summary。',
  updatedAt: '2026-10-15T00:00:00.000Z',
}

const TARGETS = [{ slug: '事业与行业', name: '事业与行业', level: 'optional', summary: '' }]

/** 记录型假数据面：静态渲染**不许**碰写路径，所以这里也记一笔调用。 */
function fakeApi(overrides = {}) {
  const calls = []
  const api = {
    async draft(payload) {
      calls.push({ method: 'sediment.draft', payload })
      return { draftId: 'd1', target: { slug: TARGET.slug, name: TARGET.name }, draft: DRAFT }
    },
    async commit(payload) {
      calls.push({ method: 'sediment.commit', payload })
      return { pu: { ...TARGET, body: DRAFT.body, updatedAt: '2026-10-15T01:00:00.000Z' } }
    },
    async discard(payload) {
      calls.push({ method: 'sediment.discard', payload })
      return { ok: true }
    },
    async readTarget(slug) {
      calls.push({ method: 'pu.read', payload: { slug } })
      return TARGET
    },
    async listTargets() {
      calls.push({ method: 'pu.list', payload: {} })
      return TARGETS
    },
    ...overrides,
  }
  return { calls, api }
}

/** 一整套替身：数据面 + 控制器（`fakeApi` 只给数据面，控制器要显式造）。 */
function scene(overrides = {}) {
  const { calls, api } = fakeApi(overrides)
  return { calls, api, controller: createSedimentController(api) }
}

/** 造一个已经导出过汇总的控制器（ready 态）。 */
async function readyController() {
  const { calls, api } = fakeApi()
  const controller = createSedimentController(api)
  await controller.export(SESSION)
  return { calls, api, controller }
}

/* ───────────────────────── 1. 注册面（纯加性，三处 cell） ───────────────────────── */

describe('票 15 · installSediment：三处加性注册（不碰 root / 不声明 children / 不加 priority）', () => {
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
            throw new Error('安装期不许调 selectPanel（默认面板只属于 overview）')
          },
        },
      },
    }
  }
  const deps = () => {
    const { api, controller } = scene()
    return { api, controller, navigate: () => {} }
  }

  it('当前环境确实没有 document（证明这条断言不是在 jsdom 里空转）', () => {
    expect(typeof document).toBe('undefined')
  })

  it('注册三处 cell：composer.dock 入口 / chat.turnTail 草稿卡 / shell.overlay 通知，且不切面板', () => {
    const { registrations, ctx } = installCtx()
    expect(() => installSediment(ctx, deps())).not.toThrow()
    expect(registrations.map((row) => ({ name: row.name, id: row.id, order: row.order }))).toEqual([
      { name: 'conversation.composer.dock', id: SEDIMENT_ENTRY_ID, order: undefined },
      { name: 'conversation.chat.turnTail', id: SEDIMENT_DRAFT_CARD_ID, order: SEDIMENT_TURNTAIL_ORDER },
      { name: 'shell.overlay', id: SEDIMENT_NOTICE_ID, order: undefined },
    ])
    expect(SEDIMENT_ENTRY_ID).toBe('xuanshu.sediment-entry')
    expect(SEDIMENT_DRAFT_CARD_ID).toBe('xuanshu.sediment-draft')
    expect(SEDIMENT_NOTICE_ID).toBe('xuanshu.sediment-notice')
    expect(SEDIMENT_TURNTAIL_ORDER).toBe(30)
    for (const row of registrations) {
      expect(row.priority, '新 cell 不需要 priority').toBeUndefined()
      expect(row.children, '不得声明 children').toBeUndefined()
    }
  })
})

/* ───────────────────────── 2. 入口条：只在问事会话里出现 ───────────────────────── */

describe('票 15 · [导出汇总] 入口：只在问事会话里出现（工作区会话不渲染）', () => {
  it('非问事会话 / 拿不到会话座位：什么都不渲染（绝不猜一个会话去写）', () => {
    const { api, controller } = scene()
    expect(render(h(XsSedimentEntry, { sessionId: 'session-1bb37188', api, controller, navigate: () => {} }))).toBe('')
    expect(render(h(XsSedimentEntry, { api, controller, navigate: () => {} }))).toBe('')
    expect(isConsultSessionId(SESSION)).toBe(true)
  })

  it('问事会话：给 [导出汇总] 与目标谱选择（目标谱必选，选项只来自谱列表）', () => {
    const { api, controller } = scene()
    const html = render(
      h(XsSedimentEntry, { sessionId: SESSION, api, controller, navigate: () => {}, preloadedTargets: TARGETS }),
    )
    expect(html).toContain('data-xuanshu-action="sediment-export"')
    expect(html).toContain('导出汇总')
    expect(html).toContain('data-xuanshu-field="sediment-target"')
    expect(html).toContain('事业与行业')
    // 说明「写入必须人点」这件事就写在入口旁（S10 §9 C4）。
    expect(html).toMatch(/人点|确认/u)
    // 边界：工作区 / 工作流不是谱，不出现在这里。
    expect(html).not.toContain('工作区')
    expect(html).not.toContain('工作流')
  })

  it('静态渲染不碰写路径：不调 sediment.draft / commit / discard', () => {
    const { calls, api, controller } = scene()
    render(h(XsSedimentEntry, { sessionId: SESSION, api, controller, navigate: () => {}, preloadedTargets: TARGETS }))
    expect(calls).toEqual([])
  })
})

/* ───────────────────────── 3. 草稿卡：四件事写在脸上 ───────────────────────── */

describe('票 15 · 草稿卡：字数 / 未写入 / 预览 / 目标谱 + 人点的动作', () => {
  it('empty 态：卡片不出现（只有人点过 [导出汇总] 才有草稿）', () => {
    const { api, controller } = scene()
    expect(render(h(XsSedimentDraftCard, { sessionId: SESSION, api, controller, navigate: () => {} }))).toBe('')
  })

  it('ready 态：首行披露「N 字 · 尚未写进任何谱」+ 只读预览 + 目标谱 + 落点', async () => {
    const { api, controller } = await readyController()
    const html = render(h(XsSedimentDraftCard, { sessionId: SESSION, api, controller, navigate: () => {} }))
    expect(html).toContain('data-xuanshu-card="sediment-draft"')
    expect(html).toContain('data-xs-state="ready"')
    expect(html).toMatch(/尚未写进任何谱/u)
    // 字数由模型的确定口径算出（去空白字符数），不是编的。
    expect(html).toMatch(/[\d,]+ 字/u)
    expect(html).toContain('data-xuanshu-preview="sediment"')
    expect(html).toContain('今年以稳为主')
    expect(html).toContain('事业与行业')
    expect(html).toContain('sediment/d1.json')
    // 动作全部要人点；没有第四个「AI 自动更新」。
    expect(html).toContain('data-xuanshu-action="sediment-open-confirm"')
    expect(html).toContain('更新到谱')
    expect(html).toContain('data-xuanshu-action="sediment-discard"')
    expect(html).toContain('丢弃')
    expect(html).not.toContain('AI 自动')
    // 静态渲染（没人点「更新到谱…」）不该出现确认弹窗。
    expect(html).not.toContain('data-xuanshu-action="sediment-confirm"')
  })

  it('error 态：失败理由写在卡面上（不静默）+ [重试]', async () => {
    const { api, controller } = scene({ async draft() { throw new Error('这次导出汇总发不出去。宿主缺少 agentDefaultModel 服务') } })
    await controller.export(SESSION)
    const html = render(h(XsSedimentDraftCard, { sessionId: SESSION, api, controller, navigate: () => {} }))
    expect(html).toContain('data-xs-state="error"')
    expect(html).toContain('agentDefaultModel')
    expect(html).toContain('data-xuanshu-action="sediment-retry"')
  })

  it('loading 态：骨架屏（不是整页转圈）+ 明说在等一轮对话', async () => {
    const { api, controller } = scene()
    const pending = controller.export(SESSION)
    const html = render(h(XsSedimentDraftCard, { sessionId: SESSION, api, controller, navigate: () => {} }))
    expect(html).toContain('data-xs-state="loading"')
    expect(html).toContain('data-xuanshu-skeleton="sediment"')
    await pending
  })

  it('done 态：说清写到哪本谱 + [看这张谱]（带打开意图进那张谱详情，不新开 main key）', async () => {
    const { calls, api, controller } = await readyController()
    const outcome = await controller.commit(SESSION)
    expect(outcome.ok).toBe(true)
    expect(calls.at(-1)).toEqual({ method: 'sediment.commit', payload: { draftId: 'd1' } })
    const html = render(h(XsSedimentDraftCard, { sessionId: SESSION, api, controller, navigate: () => {} }))
    expect(html).toContain('data-xs-state="done"')
    expect(html).toContain('已更新到谱')
    // 动作换成「打开刚写进的这张谱」（`requestPuOpenAndGo`），所以不再挂 `data-xuanshu-nav="pus"`：
    // 谱管理那扇门只有侧栏行「谱」一个（判据 N-001），挂上去等于把同一动作再指一次。
    expect(html).toContain('data-xuanshu-action="sediment-open-pu"')
    expect(html).toContain('看这张谱 -&gt;')
    expect(html).not.toContain('data-xuanshu-nav="pus"')
  })
})

/* ───────────────────────── 4. 确认弹窗：四件东西齐全 + 置灰理由可见 ───────────────────────── */

describe('票 15 · 确认弹窗：目标谱 / diff / 字数 / 只读路径四件齐全', () => {
  const deps = (overrides = {}) => ({
    draft: DRAFT,
    target: { slug: TARGET.slug, name: TARGET.name },
    base: TARGET,
    stale: false,
    busy: false,
    onConfirm: () => {},
    onCancel: () => {},
    onReopen: () => {},
    ...overrides,
  })

  it('四件东西都在弹窗里（缺一即不合格，S10 §9 C4）', () => {
    const html = render(h(XsSedimentConfirmDialog, deps()))
    // ① 目标谱（必选）
    expect(html).toContain('目标谱')
    expect(html).toContain('事业与行业')
    // ② 逐段 diff 预览（记号 + 统计）
    expect(html).toContain('data-xuanshu-diff="sediment"')
    expect(html).toContain('data-xs-diff-kind="="')
    expect(html).toContain('data-xs-diff-kind="~"')
    expect(html).toContain('新增')
    expect(html).toContain('替换')
    expect(html).toContain('未变')
    // ③ 字数变化（前 → 后 / 差值）
    expect(html).toMatch(/[\d,]+ → [\d,]+ 字/u)
    // ④ 写入路径（只读展示，界面不可改）
    expect(html).toContain('玄枢数据目录/pus/事业与行业/content.md')
    expect(html).toContain('玄枢数据目录/pus/事业与行业/summary.md')
    // 第二道确认：文案把闸门写在脸上。
    expect(html).toContain('data-xuanshu-action="sediment-confirm"')
    expect(html).toContain('确认更新')
    expect(html).toMatch(/人点|人工确认|由你/u)
  })

  it('stale：`[确认更新]` 置灰 + 理由可见（`[重新预览]` 是必做的一步）', () => {
    const html = render(h(XsSedimentConfirmDialog, deps({ stale: true })))
    expect(html).toContain('data-xs-gate="stale"')
    expect(html).toMatch(/重新预览/u)
    const button = html.slice(html.indexOf('data-xuanshu-action="sediment-confirm"'))
    expect(button.slice(0, button.indexOf('>'))).toContain('disabled')
  })

  it('busy：写入期间按钮置灰 + 理由可见（不静默吞掉第二次点击）', () => {
    const html = render(h(XsSedimentConfirmDialog, deps({ busy: true })))
    expect(html).toMatch(/正在写入/u)
    const button = html.slice(html.indexOf('data-xuanshu-action="sediment-confirm"'))
    expect(button.slice(0, button.indexOf('>'))).toContain('disabled')
  })

  it('没有目标谱：置灰并说清「沉淀只能写进谱」', () => {
    const html = render(h(XsSedimentConfirmDialog, deps({ target: undefined })))
    expect(html).toContain('data-xs-gate="no-target"')
    expect(html).toMatch(/谱/u)
    const button = html.slice(html.indexOf('data-xuanshu-action="sediment-confirm"'))
    expect(button.slice(0, button.indexOf('>'))).toContain('disabled')
  })

  it('草稿正文只读：弹窗里没有可编辑控件（改草稿是 S5 的事，不在闸门这一步做）', () => {
    const html = render(h(XsSedimentConfirmDialog, deps()))
    expect(html).not.toMatch(/<input|<textarea/u)
  })
})

/* ───────────────────────── 5. 结果通知（shell.overlay，无内容 click-through） ───────────────────────── */

describe('票 15 · 结果通知：无内容时 return null（自动 click-through）', () => {
  it('没有通知：渲染为空（层本身 click-through，不挡任何东西）', () => {
    const { controller } = scene()
    expect(render(h(XsSedimentNotice, { controller, navigate: () => {} }))).toBe('')
  })

  it('写入成功后：通知里说清写到了哪本谱 + [看这张谱]；可以关掉', async () => {
    const { api, controller } = await readyController()
    void api
    await controller.commit(SESSION)
    const html = render(h(XsSedimentNotice, { controller, navigate: () => {} }))
    expect(html).toContain('data-xuanshu-notice="sediment"')
    expect(html).toContain('已更新到谱')
    expect(html).toContain('事业与行业')
    // 通知手里拿得到那张谱（`SedimentNotice.pu`），所以这一处也是**打开意图**而不是裸跳。
    expect(html).toContain('data-xuanshu-action="sediment-open-pu"')
    expect(html).not.toContain('data-xuanshu-nav="pus"')
    expect(html).toContain('data-xuanshu-action="sediment-dismiss"')
    controller.dismissNotice()
    expect(render(h(XsSedimentNotice, { controller, navigate: () => {} }))).toBe('')
  })
})
