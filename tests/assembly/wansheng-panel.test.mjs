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
import { momentOf } from '../../packages/xuanshu-client/src/client/panel.ts'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { XsDeliveryHistory, TRAFFIC_STATUS_TEXT } from '../../packages/xuanshu-client/src/client/notify.tsx'
import { OverviewPanel, wanshengStateFromStatus } from '../../packages/xuanshu-client/src/client/OverviewPanel.tsx'
import {
  WANSHENG_ID, WANSHENG_LABEL, WANSHENG_ORDER,
} from '../../packages/xuanshu-client/src/client/panel.ts'
import { XsMissedBadge, XsWanshengCard } from '../../packages/xuanshu-client/src/client/cards.tsx'
import { WanshengPanel, installWansheng } from '../../packages/xuanshu-client/src/client/wansheng.tsx'
import { createWanshengApi } from '../../packages/xuanshu-client/src/client/wansheng-api.ts'
import { installRpcFetch, restoreRpcFetch } from './lib/rpc-fetch.mjs'

// 数据面是同源 fetch（`POST /api/xuanshu`），桩装在 fetch 上；漏还原会污染后面的文件。
afterEach(restoreRpcFetch)

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
  activeWorkflows: [{ id: 'f1', title: '整理阅读笔记', sessionCount: 1, lastActiveAt: '2026-10-15T02:00:00.000Z' }],
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
  it.each([
    [undefined, '哪些工作流有活动：未知（这边暂时读不到）'],
    [[], '今天没有工作流活动'],
    [FACTS.activeWorkflows, '今天 1 个工作流有活动'],
  ])('卡与面板分别如实显示工作流活动：%j', (activeWorkflows, expected) => {
    const status = { ...STATUS_READY, facts: { ...FACTS, activeWorkflows } }
    const card = render(h(XsWanshengCard, { state: 'ready', today: status.date, facts: status.facts, ...injected() }))
    const panel = render(h(WanshengPanel, { api: {}, navigate: () => {}, preloaded: status, preloadedHistory: { entries: [], unread: 0 } }))
    expect(card).toContain(expected)
    expect(panel).toContain(expected)
    if (activeWorkflows?.length) expect(panel).toContain('整理阅读笔记')
  })

  it('空态两路同一句式：「今天没有{项目|工作流}活动」（不再出现「今天 0 个…」）', () => {
    const status = { ...STATUS_READY, facts: { ...FACTS, activeWorkspaces: [], activeWorkflows: [] } }
    const card = render(h(XsWanshengCard, { state: 'ready', today: status.date, facts: status.facts, ...injected() }))
    const panel = render(h(WanshengPanel, { api: {}, navigate: () => {}, preloaded: status, preloadedHistory: { entries: [], unread: 0 } }))
    for (const html of [card, panel]) {
      expect(html).toContain('今天没有项目活动')
      expect(html).toContain('今天没有工作流活动')
      // 旧的「0 个」措辞是把「已知零」写成计数式，与项目那一路的句式不一致（复核 A3）。
      expect(html).not.toContain('今天 0 个项目有活动')
      expect(html).not.toContain('今天 0 个工作流有活动')
    }
  })
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
    expect(html).toContain(`${momentOf('2026-10-15T00:00:00.000Z')} 生成`) // 日课
    expect(html).toContain(`${momentOf('2026-10-15T03:00:00.000Z')} 刷新过`) // 底稿
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

  it('未读 > 0 → 未读徽标；最近一次推送失败 → role=alert 行（权限缺失说人话 + 机器码可查）', () => {
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
    // #40：界面不再只显示壳侧英文 token —— 说清「权限缺失」并指路去哪开。
    expect(html).toContain('权限缺失')
    expect(html).toContain('系统通知权限被关')
    expect(html).toContain('系统设置 → 通知 → 玄枢')
    expect(html).not.toContain('上一次通知没发出去：permission-denied')
    // 原始 token 仍可查（机器码），只是不再当文案。
    expect(html).toContain('data-xuanshu-reason-code="permission-denied"')
  })

  it('事实拿不到 → 写「未知」，不写 0（不把未知冒充已知）', () => {
    const html = render(h(XsWanshengCard, { state: 'ready', today: '2026-10-15', ...injected() }))
    expect(html).toContain('今天几场问事：未知（这边暂时读不到）')
    expect(html).toContain('哪些项目有活动：未知（这边暂时读不到）')
  })

  it('empty：空态文案（不写死钟点） + [立即生成]（未接线则置灰给理由）+ [改时间 ->]', () => {
    const html = render(h(XsWanshengCard, { state: 'empty', today: '2026-10-15', ...injected() }))
    expect(html).toContain('今天还没有晚省。到计划时刻会自动生成。')
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
    expect(html).toContain(`日课：${momentOf('2026-10-15T00:00:00.000Z')} 生成`)
    expect(html).toContain(`底稿：${momentOf('2026-10-15T03:00:00.000Z')} 刷新过`)
  })

  it('[立即生成] 在（面板的主行动）；计划时刻来自 schedule', () => {
    const html = panel()
    expect(html).toContain('data-xuanshu-action="generate-wansheng"')
    expect(html).toContain('计划时刻：每天 21:30（Asia/Shanghai）')
  })

  it('投递历史折叠块：成功 / 失败 / 跳过 + 原因 + 是否补（权限缺失给人话，机器码可查）', () => {
    const html = panel()
    expect(html).toContain('data-xuanshu-history="wansheng"')
    expect(html).toContain('<summary>投递历史</summary>')
    expect(html).toContain('data-xuanshu-history-row="delivered"')
    expect(html).toContain('data-xuanshu-history-row="failed"')
    expect(html).toContain('data-xuanshu-history-row="skipped"')
    expect(html).toContain('权限缺失')
    expect(html).toContain('data-xuanshu-reason-code="permission-denied"')
    expect(html).not.toContain('>permission-denied<')
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
    expect(html).toContain('今天几场问事：未知（这边暂时读不到）')
    expect(html).toContain('哪些项目有活动：未知（这边暂时读不到）')
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
    expect(empty).toContain('今天还没有晚省。到计划时刻会自动生成。')
    const failed = render(h(WanshengPanel, { api, navigate: () => {}, preloaded: { error: '晚省读不出来' } }))
    expect(failed).toContain('data-xuanshu-view="error"')
    expect(failed).toContain('晚省读不出来')
    // 静态渲染只渲染，不调用生成 / 改时刻。
    expect(calls.filter((call) => call === 'generate' || call === 'setTime')).toEqual([])
  })
})

/* ───────────────────────── 4. 设置里的投递历史 ───────────────────────── */

describe('#25 · 设置里能看到投递历史（traffic.status 的读面）', () => {
  it('三种状态都有人话文案；行里带原因与「补」（权限缺失给人话，机器码可查）', () => {
    /**
     * 2026-11-02 改：原来逐字锁 `{ delivered:'成功', failed:'失败', skipped:'跳过' }`。
     * 但「跳过」在那一行里会和前面的「日课/晚省」连读成「日课跳过」——
     * 实测过：日课**生成成功了**，跳过的只是发通知那一步，用户却读成「日课没生成」。
     * 文案改成「通知已发 / 通知失败 / 没发通知」。
     *
     * 这条断言本来要守的是**三态可区分、都能读到**（不是逐字相等），所以按那个原意重写。
     */
    expect(Object.keys(TRAFFIC_STATUS_TEXT).sort()).toEqual(['delivered', 'failed', 'skipped'])
    const texts = Object.values(TRAFFIC_STATUS_TEXT)
    expect(new Set(texts).size).toBe(3)
    expect(texts.every((x) => !/^(delivered|failed|skipped)$/.test(x))).toBe(true)
    const html = render(h(XsDeliveryHistory, { status: HISTORY }))
    expect(html).toContain('data-xuanshu-history="traffic"')
    expect(html).toContain(TRAFFIC_STATUS_TEXT.delivered)
    expect(html).toContain(TRAFFIC_STATUS_TEXT.failed)
    expect(html).toContain(TRAFFIC_STATUS_TEXT.skipped)
    expect(html).toContain('晚省')
    expect(html).toContain('日课')
    // #40：最近一次失败说人话 + 带「去哪开」；原始 token 只在机器码里。
    expect(html).toContain('最近一次失败：晚省 · 权限缺失')
    expect(html).toContain('系统设置 → 通知 → 玄枢')
    expect(html).toContain('data-xuanshu-reason-code="permission-denied"')
    expect(html).toContain('补生成：不补推送（界面标「补」）')
  })

  it('其他失败原因照旧逐字可查（只翻已知的权限缺失 token，不抹平别的 reason）', () => {
    const other = {
      entries: [{
        id: 'traffic-y', at: '2026-10-14T13:30:01.000Z', kind: 'wansheng', date: '2026-10-14',
        notify: { status: 'failed', reason: '连不上壳的通知端点（ECONNREFUSED）' },
      }],
      unread: 0,
      lastFailure: { at: '2026-10-14T13:30:01.000Z', kind: 'wansheng', reason: '连不上壳的通知端点（ECONNREFUSED）' },
    }
    const html = render(h(XsDeliveryHistory, { status: other }))
    expect(html).toContain('连不上壳的通知端点（ECONNREFUSED）')
    expect(html).not.toContain('权限缺失')
    expect(html).not.toContain('data-xuanshu-reason-code=')
  })

  it('账本空 → 「还没有投递记录。」（不编一行假记录）；未读 0 明确写成「未读 0 条」', () => {
    const html = render(h(XsDeliveryHistory, { status: { entries: [], unread: 0 } }))
    expect(html).toContain('还没有投递记录。')
    expect(html).toContain('未读 0 条')
    expect(html).not.toContain('data-xuanshu-history-row=')
  })

  it('账读不出来（unread 缺席）→ 写「未读数未知」，不谎称 0 条未读、也不谎称空历史', () => {
    const html = render(h(XsDeliveryHistory, { status: { entries: [] } }))
    expect(html).toContain('data-xuanshu-note="unread-unknown"')
    expect(html).toContain('未读数未知')
    expect(html).not.toContain('未读 0 条')
    expect(html).not.toContain('还没有投递记录。')
  })
})

/* ───────────────────────── 5. 安装面（加性注册） ───────────────────────── */

describe('#25 · installWansheng（加性注册 / 无 document 安全）', () => {
  function installCtx() {
    const registrations = []
    const components = new Map()
    return {
      registrations,
      components,
      ctx: {
        slots: {
          inject: (_key, effect) => effect(),
          register: (options, component) => {
            registrations.push(options)
            components.set(options, component)
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

  it('实际注册入口通过 RPC 取回工作流事实并传给晚省面板', async () => {
    const { registrations, components, ctx } = installCtx()
    const calls = []
    const rpc = installRpcFetch((call) => {
      calls.push([call.channel, call.endpoint])
      return { value: STATUS_READY }
    })
    installWansheng(ctx, { api: createWanshengApi(ctx), navigate: () => {} })
    const main = registrations.find((options) => options.name === 'main')
    const props = main.inject()
    const status = await props.api.status()
    const html = render(h(components.get(main), { ...props, preloaded: status, preloadedHistory: { entries: [], unread: 0 } }))
    expect(calls).toEqual([['/xuanshu', 'wansheng.status']])
    expect(rpc.calls).toHaveLength(1)
    expect(html).toContain('今天 1 个工作流有活动')
    expect(html).toContain('整理阅读笔记')
  })

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
    expect(card).toContain('今天还没有晚省。到计划时刻会自动生成。')
  })
})
