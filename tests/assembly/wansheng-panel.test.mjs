/**
 * #25 · 晚省客户端（卡 + 面板 + 设置里的投递历史）。
 *
 * 验收里属于客户端半的几条：
 *   - 首页**第 5 张卡**：当天事实（几场问事 / 哪些项目有活动）+ 「补」徽标 + 未读/失败行；
 *   - 点晚省就进问事（`[去问事 ->]` → `navigate('consult')`）；
 *   - 新 main key `wansheng`（order 110），面板摆完整事实 + [立即生成] + 投递历史折叠块；
 *   - 设置里能看到投递历史（成功 / 失败 / 跳过 + 原因 + 是否补）。
 *
 * 环境：`renderToStaticMarkup`（无 jsdom）——只断静态界面事实与纯映射；
 * 真浏览器点击链路没有覆盖（与 `rikke-panel.test.mjs` 同一条边界，交付报告如实标注）。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { XsDeliveryHistory, TRAFFIC_STATUS_TEXT } from '../../packages/xuanshu-client/src/client/notify.tsx'
import { OverviewPanel, wanshengStateFromStatus } from '../../packages/xuanshu-client/src/client/OverviewPanel.tsx'
import {
  WANSHENG_ID, WANSHENG_LABEL, WANSHENG_ORDER,
} from '../../packages/xuanshu-client/src/client/panel.ts'
import { XsMissedBadge, XsWanshengCard } from '../../packages/xuanshu-client/src/client/cards.tsx'
import { WanshengPanel, installWansheng } from '../../packages/xuanshu-client/src/client/wansheng.tsx'

const render = (element) => renderToStaticMarkup(element)

/** 稳定 watch：快照为排序后的常量数组（满足 `Object.is` 比较要求）。 */
function watchOf(keys) {
  const snapshot = [...keys].sort()
  return { subscribe: () => () => {}, getSnapshot: () => snapshot }
}

const injected = (mainKeys = ['conversation', 'overview', 'plugins', 'schedules', 'consult', 'wansheng']) => ({
  navigate: () => {},
  mainPanels: watchOf(mainKeys),
})

const FACTS = {
  consultSessions: {
    count: 2,
    items: [
      { sessionId: 'session-xs-consult-a', title: '先收口', lastTurnAt: '2026-10-15T02:00:00.000Z' },
      { sessionId: 'session-xs-consult-b', title: '续问' },
    ],
  },
  activeWorkspaces: [{ id: 'w1', title: 'XuanShu', sessionCount: 3, lastActiveAt: '2026-10-15T02:30:00.000Z' }],
  digao: { generatedAt: '2026-10-15T03:00:00.000Z' },
  rikke: { generatedAt: '2026-10-15T00:00:00.000Z' },
}

const STATUS_READY = {
  date: '2026-10-15',
  exists: true,
  facts: FACTS,
  generatedAt: '2026-10-15T13:30:00.000Z',
  zone: 'Asia/Shanghai',
  missed: false,
  schedule: { time: '21:30:00', timeZone: 'Asia/Shanghai', id: 'sched-w' },
}

const HISTORY = {
  entries: [
    {
      id: 'traffic-1', at: '2026-10-15T13:30:01.000Z', kind: 'wansheng', date: '2026-10-15',
      notify: { status: 'delivered', reason: null }, read: false, missed: false,
    },
    {
      id: 'traffic-0', at: '2026-10-15T00:00:01.000Z', kind: 'rikke', date: '2026-10-15',
      notify: { status: 'skipped', reason: '补生成：不补推送（界面标「补」）' }, read: false, missed: true,
    },
    {
      id: 'traffic-x', at: '2026-10-14T13:30:01.000Z', kind: 'wansheng', date: '2026-10-14',
      notify: { status: 'failed', reason: 'permission-denied' }, read: false, missed: false,
    },
  ],
  unread: 1,
  lastFailure: { at: '2026-10-14T13:30:01.000Z', kind: 'wansheng', reason: 'permission-denied' },
}

/** 按 `data-xuanshu-card` 切出单卡的 HTML 片段。 */
function cardOf(html, name) {
  const start = html.indexOf(`data-xuanshu-card="${name}"`)
  expect(start, `卡里没有 ${name}`).toBeGreaterThanOrEqual(0)
  const end = html.indexOf('</section>', start)
  return html.slice(start, end === -1 ? undefined : end)
}

/* ───────────────────────── 1. status → 卡级四态（纯映射） ───────────────────────── */

describe('#25 · 晚省 status → 卡级四态（纯映射，可无 DOM 测）', () => {
  it('有产物有事实 → ready（date 用宿主给的日期）', () => {
    expect(wanshengStateFromStatus(STATUS_READY)).toEqual({
      state: 'ready',
      date: '2026-10-15',
      facts: FACTS,
      missed: false,
      reason: undefined,
    })
  })

  it('今天还没生成 → empty；产物在但事实缺失 → error（不假装「今天没事发生」）', () => {
    expect(wanshengStateFromStatus({ date: '2026-10-15', exists: false }).state).toBe('empty')
    const broken = wanshengStateFromStatus({ date: '2026-10-15', exists: true })
    expect(broken.state).toBe('error')
    expect(broken.reason).toMatch(/facts/u)
  })

  it('人点生成失败 → error + 理由可见；补生成带上 missed', () => {
    const failed = wanshengStateFromStatus({ date: '2026-10-15', exists: false }, { ok: false, reason: '写盘失败：EACCES' })
    expect(failed.state).toBe('error')
    expect(failed.reason).toBe('写盘失败：EACCES')
    expect(wanshengStateFromStatus({ ...STATUS_READY, missed: true }).missed).toBe(true)
  })
})

/* ───────────────────────── 2. 晚省卡 ───────────────────────── */

describe('#25 · 晚省卡：当天事实 + 补徽标 + 去问事', () => {
  it('ready：今天 N 场问事 / M 个项目有活动 / 日课与底稿时间', () => {
    const html = render(h(XsWanshengCard, { state: 'ready', today: '2026-10-15', facts: FACTS, ...injected() }))
    expect(html).toContain('data-xuanshu-card="wansheng"')
    expect(html).toContain('晚省 · 今天 2026-10-15')
    expect(html).toContain('今天 2 场问事')
    expect(html).toContain('今天 1 个项目有活动')
    expect(html).toContain('2026-10-15T00:00:00.000Z 生成') // 日课
    expect(html).toContain('2026-10-15T03:00:00.000Z 刷新过') // 底稿
  })

  it('点晚省进问事：[去问事 ->] 指向 consult；[看完整晚省 ->] 指向 wansheng', () => {
    const html = render(h(XsWanshengCard, { state: 'ready', today: '2026-10-15', facts: FACTS, ...injected() }))
    expect(html).toContain('data-xuanshu-nav="consult"')
    expect(html).toContain('去问事 -&gt;')
    expect(html).toContain('data-xuanshu-nav="wansheng"')
    expect(html).toContain('看完整晚省 -&gt;')
    // 问事面板已装配 → 不置灰。
    const consult = html.slice(html.indexOf('data-xuanshu-nav="consult"'))
    expect(consult.slice(0, consult.indexOf('>'))).not.toContain('disabled')
  })

  it('补生成的那一份 → 卡头「补」徽标（data-xuanshu-badge="missed"）', () => {
    const html = render(h(XsWanshengCard, { state: 'ready', today: '2026-10-14', facts: FACTS, missed: true, ...injected() }))
    expect(html).toContain('data-xuanshu-badge="missed"')
    expect(html).toMatch(/补<\/span>/u)
    expect(render(h(XsMissedBadge))).toContain('data-xuanshu-badge="missed"')
  })

  it('未读 > 0 → 未读徽标；最近一次推送失败 → role=alert 行（原因逐字）', () => {
    const html = render(h(XsWanshengCard, {
      state: 'ready',
      today: '2026-10-15',
      facts: FACTS,
      unread: 2,
      notify: { status: 'failed', reason: 'permission-denied', at: '2026-10-15T13:31:00.000Z' },
      ...injected(),
    }))
    expect(html).toContain('data-xuanshu-badge="unread"')
    expect(html).toContain('data-xuanshu-notify="failed"')
    expect(html).toMatch(/role="alert"/u)
    expect(html).toContain('permission-denied')
  })

  it('事实拿不到 → 写「未知」，不写 0（不把未知冒充已知）', () => {
    const html = render(h(XsWanshengCard, { state: 'ready', today: '2026-10-15', ...injected() }))
    expect(html).toContain('今天几场问事：未知（宿主没回传）')
    expect(html).toContain('哪些项目有活动：未知（宿主没回传）')
  })

  it('empty：默认 21:30 的空态文案 + [立即生成]（未接线则置灰给理由）+ [改时间 ->]', () => {
    const html = render(h(XsWanshengCard, { state: 'empty', today: '2026-10-15', ...injected() }))
    expect(html).toContain('今天还没有晚省。晚省默认每天 21:30 生成。')
    expect(html).toContain('data-xuanshu-action="generate-wansheng"')
    expect(html).toContain('晚省生成还没接上（属票 04 · 晚间触达）')
    expect(html).toContain('data-xuanshu-nav="schedules"')
  })

  it('error：理由逐字 + [重试]', () => {
    const html = render(h(XsWanshengCard, {
      state: 'error', today: '2026-10-15', reason: '晚省写盘失败：EACCES', ...injected(),
    }))
    expect(html).toContain('晚省读不出来（产物缺失或格式不符）。')
    expect(html).toContain('晚省写盘失败：EACCES')
    expect(html).toContain('data-xuanshu-action="retry"')
  })
})

/* ───────────────────────── 3. 晚省面板 ───────────────────────── */

describe('#25 · 晚省面板：完整事实 + [立即生成] + 投递历史', () => {
  const panel = (over = {}) => render(h(WanshengPanel, {
    api: { status: async () => STATUS_READY },
    navigate: () => {},
    preloaded: STATUS_READY,
    preloadedHistory: HISTORY,
    ...over,
  }))

  it('摆完整事实：问事清单（标题）+ 项目活动 + 底稿/日课/事记时间', () => {
    const html = panel()
    expect(html).toContain('data-xuanshu-panel="wansheng"')
    expect(html).toContain('晚省 · 2026-10-15')
    expect(html).toContain('今天 2 场问事')
    expect(html).toContain('先收口')
    expect(html).toContain('续问')
    expect(html).toContain('XuanShu · 3 场会话')
    expect(html).toContain('日课：2026-10-15T00:00:00.000Z 生成')
    expect(html).toContain('底稿：2026-10-15T03:00:00.000Z 刷新过')
  })

  it('[立即生成] 在（面板的主行动）；计划时刻来自 schedule', () => {
    const html = panel()
    expect(html).toContain('data-xuanshu-action="generate-wansheng"')
    expect(html).toContain('计划时刻：每天 21:30（Asia/Shanghai）')
  })

  it('投递历史折叠块：成功 / 失败 / 跳过 + 原因 + 是否补', () => {
    const html = panel()
    expect(html).toContain('data-xuanshu-history="wansheng"')
    expect(html).toContain('<summary>投递历史</summary>')
    expect(html).toContain('data-xuanshu-history-row="delivered"')
    expect(html).toContain('data-xuanshu-history-row="failed"')
    expect(html).toContain('data-xuanshu-history-row="skipped"')
    expect(html).toContain('permission-denied')
    expect(html).toContain('data-xuanshu-badge="missed"')
    expect(html).toContain('data-xuanshu-history-missed="true"')
  })

  it('补的那一份：面板标「补」并写明「不是今天的」', () => {
    const html = panel({ preloaded: { ...STATUS_READY, missed: true } })
    expect(html).toContain('data-xuanshu-badge="missed"')
    expect(html).toContain('这是补生成的一份（过去的日期），不是今天的。')
  })

  it('事实缺失 → 面板写「未知」（不把拿不到写成 0）', () => {
    const html = panel({ preloaded: { date: '2026-10-15', exists: true, facts: {} } })
    expect(html).toContain('今天几场问事：未知（宿主没回传）')
    expect(html).toContain('哪些项目有活动：未知（宿主没回传）')
  })

  it('empty / error：各有可读文案；静态渲染不碰写路径', () => {
    const calls = []
    const api = {
      status: async () => { calls.push('status'); return { date: '2026-10-15', exists: false } },
      generate: async () => { calls.push('generate'); return { ok: true } },
      setTime: async () => { calls.push('setTime'); return { schedule: { time: '21:30', timeZone: 'Asia/Shanghai' } } },
      read: async () => ({ date: '2026-10-15', exists: false }),
    }
    const empty = render(h(WanshengPanel, { api, navigate: () => {}, preloaded: { date: '2026-10-15', exists: false } }))
    expect(empty).toContain('data-xuanshu-view="empty"')
    expect(empty).toContain('今天还没有晚省。晚省默认每天 21:30 生成。')
    const failed = render(h(WanshengPanel, { api, navigate: () => {}, preloaded: { error: '晚省读不出来' } }))
    expect(failed).toContain('data-xuanshu-view="error"')
    expect(failed).toContain('晚省读不出来')
    // 静态渲染只渲染，不调用生成 / 改时刻。
    expect(calls.filter((call) => call === 'generate' || call === 'setTime')).toEqual([])
  })
})

/* ───────────────────────── 4. 设置里的投递历史 ───────────────────────── */

describe('#25 · 设置里能看到投递历史（traffic.status 的读面）', () => {
  it('三种状态都有人话文案；行里带原因与「补」', () => {
    expect(TRAFFIC_STATUS_TEXT).toEqual({ delivered: '成功', failed: '失败', skipped: '跳过' })
    const html = render(h(XsDeliveryHistory, { status: HISTORY }))
    expect(html).toContain('data-xuanshu-history="traffic"')
    expect(html).toContain('成功')
    expect(html).toContain('失败')
    expect(html).toContain('跳过')
    expect(html).toContain('晚省')
    expect(html).toContain('日课')
    expect(html).toContain('最近一次失败：晚省 · permission-denied')
    expect(html).toContain('补生成：不补推送（界面标「补」）')
  })

  it('账本空 → 「还没有投递记录。」（不编一行假记录）', () => {
    const html = render(h(XsDeliveryHistory, { status: { entries: [], unread: 0 } }))
    expect(html).toContain('还没有投递记录。')
    expect(html).not.toContain('data-xuanshu-history-row=')
  })
})

/* ───────────────────────── 5. 安装面（加性注册） ───────────────────────── */

describe('#25 · installWansheng（加性注册 / 无 document 安全）', () => {
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

  it('注册 main key `wansheng` + 侧栏行 `wansheng`（label 晚省，order 110），不切面板', () => {
    const { registrations, ctx } = installCtx()
    const api = {
      status: async () => ({ date: '2026-10-15', exists: false }),
      read: async () => ({ date: '2026-10-15', exists: false }),
      generate: async () => ({ ok: true }),
      setTime: async () => ({ schedule: { time: '21:30', timeZone: 'Asia/Shanghai' } }),
    }
    expect(() => installWansheng(ctx, { api, navigate: () => {} })).not.toThrow()
    expect(registrations.map((row) => ({ name: row.name, key: row.key, id: row.id, order: row.order, label: row.label }))).toEqual([
      { name: 'main', key: WANSHENG_ID, id: undefined, order: undefined, label: undefined },
      { name: 'sidebar.panellist', key: undefined, id: WANSHENG_ID, order: WANSHENG_ORDER, label: WANSHENG_LABEL },
    ])
    expect(WANSHENG_ID).toBe('wansheng')
    expect(WANSHENG_LABEL).toBe('晚省')
    expect(WANSHENG_ORDER).toBe(110)
  })
})

/* ───────────────────────── 6. 概览接线（第 5 张卡） ───────────────────────── */

describe('#25 · 概览面板接上晚省卡（第 5 张）', () => {
  it('DOM 顺序：命盘 → 日课 → 底稿 → 快捷入口 → 晚省；晚省卡由 status 喂数据', () => {
    const html = render(h(OverviewPanel, {
      ...injected(),
      today: '2026-10-15',
      preloadedBaziStatus: { state: 'empty' },
      preloadedRikkeStatus: { date: '2026-10-15', exists: false },
      preloadedDigaoStatus: { exists: false, meta: null },
      preloadedWanshengStatus: STATUS_READY,
    }))
    const order = ['mingpan', 'rike', 'digao', 'quicklinks', 'wansheng'].map((name) => html.indexOf(`data-xuanshu-card="${name}"`))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    const card = cardOf(html, 'wansheng')
    expect(card).toContain('data-xs-state="ready"')
    expect(card).toContain('今天 2 场问事')
    expect(card).toContain('data-xuanshu-nav="consult"')
  })

  it('没有晚省数据面 → 卡恒空态（票 07 的 fail-soft 观感不变）', () => {
    const html = render(h(OverviewPanel, { ...injected(), today: '2026-10-15', preloadedBaziStatus: { state: 'empty' } }))
    const card = cardOf(html, 'wansheng')
    expect(card).toContain('data-xs-state="empty"')
    expect(card).toContain('今天还没有晚省。晚省默认每天 21:30 生成。')
  })
})
