/**
 * 票 13 · 两张卡的数据接线（日课卡 / 底稿卡）+ 底稿刷新控制器。
 *
 * 对应票面验收里属于**客户端半**的接线部分：
 *   1. 日课卡读 `rikke.status` 给 `state` + `content`（ready/empty/error），
 *      `onGenerate` → 人点的 `rikke.generate`；失败理由**可见**（底座未立时不静默）；
 *   2. 底稿卡读 `digao.status` 给 `state` + `summary={{segments,sources}}`，
 *      `onRefresh` → 人点的 `digao.refresh`；
 *   3. `[改时间 ->]` 仍指向 DSH 原生 `schedules` 面板（票 07 已接线，不许改道）。
 *
 * 环境：`renderToStaticMarkup`（无 jsdom）——本文件只断静态界面事实与纯映射/控制器行为；
 * 真浏览器里的点击链路**没有**被本文件覆盖，交付报告里如实标注。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { createDigaoApi } from '../../packages/xuanshu-client/src/client/digao-api.ts'
import { createDigaoUiController } from '../../packages/xuanshu-client/src/client/digao-controller.ts'
import { OverviewPanel, digaoStateFromStatus, rikkeStateFromStatus } from '../../packages/xuanshu-client/src/client/OverviewPanel.tsx'
import { createRikkeUiController } from '../../packages/xuanshu-client/src/client/rikke-controller.ts'

const render = (element) => renderToStaticMarkup(element)

/** 稳定 watch：快照为排序后的常量数组（满足 `Object.is` 比较要求）。 */
function watchOf(keys) {
  const snapshot = [...keys].sort()
  return { subscribe: () => () => {}, getSnapshot: () => snapshot }
}

/** 概览的注入面（含两个新面板 key：接线后两个出口都应可用）。 */
const injected = (mainKeys = ['conversation', 'overview', 'plugins', 'schedules', 'digao', 'rikke']) => ({
  navigate: () => {},
  mainPanels: watchOf(mainKeys),
})

const CONTENT = { yi: '祭祀、出行', ji: '动土', liuri: '甲子日 · 水' }
const RIKKE_READY = {
  date: '2026-10-15',
  exists: true,
  content: CONTENT,
  generatedAt: '2026-10-15 07:30',
  zone: 'Asia/Shanghai',
  schedule: { time: '07:30:00', timeZone: 'Asia/Shanghai', id: 'sched-rikke-1' },
}
const DIGAO_META = { schema: 'xuanshu/digao@1', generatedAt: '2026-10-11 07:30', segments: 15, sources: 3, digest: 'llm' }

/** 按 `data-xuanshu-card` 切出单卡的 HTML 片段（section 不嵌套，第一个 </section> 即边界）。 */
function cardOf(html, name) {
  const start = html.indexOf(`data-xuanshu-card="${name}"`)
  expect(start, `四卡里没有 ${name}`).toBeGreaterThanOrEqual(0)
  const end = html.indexOf('</section>', start)
  return html.slice(start, end === -1 ? undefined : end)
}

/* ───────────────────────── 1. 纯映射：status → 卡级四态 ───────────────────────── */

describe('票 13 · status → 卡级四态（纯映射，可无 DOM 测）', () => {
  it('日课卡：今日卡在且有内容 → ready（date 用宿主给的日期，不用本机猜）', () => {
    expect(rikkeStateFromStatus(RIKKE_READY)).toEqual({
      state: 'ready',
      content: CONTENT,
      date: '2026-10-15',
      reason: undefined,
    })
  })

  it('日课卡：今天还没生成 → empty', () => {
    const mapped = rikkeStateFromStatus({ date: '2026-10-15', exists: false })
    expect(mapped.state).toBe('empty')
    expect(mapped.date).toBe('2026-10-15')
  })

  it('日课卡：文件在但没有内容 → error（形状违约不假装有内容）', () => {
    expect(rikkeStateFromStatus({ date: '2026-10-15', exists: true }).state).toBe('error')
  })

  it('日课卡：人点生成失败 → error + 理由可见（底座未立时卡片有话说）', () => {
    const mapped = rikkeStateFromStatus({ date: '2026-10-15', exists: false }, { ok: false, reason: '底座未立：还没有出生信息' })
    expect(mapped.state).toBe('error')
    expect(mapped.reason).toBe('底座未立：还没有出生信息')
  })

  it('日课卡：生成失败但已有上一份内容 → error 态仍带着 content（不把已有内容吞掉）', () => {
    const mapped = rikkeStateFromStatus(RIKKE_READY, { ok: false, reason: '推运调用失败' })
    expect(mapped.state).toBe('error')
    expect(mapped.content).toEqual(CONTENT)
  })

  it('底稿卡：meta 在 → ready + summary{{segments,sources}}', () => {
    const mapped = digaoStateFromStatus({ exists: true, meta: DIGAO_META })
    expect(mapped.state).toBe('ready')
    expect(mapped.summary).toEqual({ segments: 15, sources: 3, updatedAt: '2026-10-11 07:30' })
  })

  it('底稿卡：没生成过 → empty；文件在但 meta 读不出来 → error', () => {
    expect(digaoStateFromStatus({ exists: false, meta: null }).state).toBe('empty')
    expect(digaoStateFromStatus({ exists: true, meta: null }).state).toBe('error')
  })

  it('底稿卡：人点刷新失败 → error + 理由可见', () => {
    const mapped = digaoStateFromStatus({ exists: true, meta: DIGAO_META }, { ok: false, reason: '刷新失败：EACCES' })
    expect(mapped.state).toBe('error')
    expect(mapped.reason).toBe('刷新失败：EACCES')
  })
})

/* ───────────────────────── 2. 底稿刷新控制器（人点才跑） ───────────────────────── */

describe('票 13 · 底稿刷新控制器', () => {
  it('造控制器不发请求；显式 refresh() 才走 digao.refresh 并广播代次', async () => {
    const calls = []
    const api = createDigaoApi({
      connection: {
        rpc: {
          async call(_channel, method) {
            calls.push(method)
            if (method === 'digao.refresh') return { ok: true, value: { meta: DIGAO_META } }
            return { ok: true, value: { exists: true, meta: DIGAO_META } }
          },
        },
      },
    })
    const controller = createDigaoUiController(api)
    expect(calls).toEqual([])
    let notified = 0
    controller.subscribe(() => { notified += 1 })
    const outcome = await controller.refresh()
    expect(calls).toEqual(['digao.refresh'])
    expect(outcome).toEqual({ ok: true })
    expect(controller.getRevision()).toBe(1)
    expect(notified).toBe(1)
  })

  it('刷新失败时理由落进 outcome（不静默）', async () => {
    const api = {
      async status() { return { exists: true, meta: DIGAO_META } },
      async read() { return { markdown: '', meta: DIGAO_META } },
      async refresh() { throw new Error('EACCES: digao.md') },
    }
    const outcome = await createDigaoUiController(api).refresh()
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('刷新失败：EACCES: digao.md')
  })

  it('卡级 [重试] 清掉上一次结果并广播重取（否则点了界面不动）', async () => {
    const api = {
      async status() { return { exists: false, meta: null } },
      async read() { return { markdown: '', meta: null } },
      async refresh() { throw new Error('EACCES: digao.md') },
    }
    const controller = createDigaoUiController(api)
    await controller.refresh()
    expect(controller.getOutcome()).toEqual({ ok: false, reason: '刷新失败：EACCES: digao.md' })
    let notified = 0
    controller.subscribe(() => { notified += 1 })
    controller.clearOutcome()
    expect(controller.getOutcome()).toBeUndefined()
    expect(controller.getRevision()).toBe(2)
    expect(notified).toBe(1)
  })
})

/* ───────────────────────── 3. 概览面板接线（静态界面事实） ───────────────────────── */

/**
 * 接好线的概览数据面（票 13 的真实装配形状：数据面 + 控制器都从注入面进）。
 * `generate` / `refresh` 只记账：静态渲染**不该**碰到它们。
 */
function wired() {
  const calls = []
  const rikkeApi = {
    async status() { calls.push('rikke.status'); return RIKKE_READY },
    async generate() { calls.push('rikke.generate'); return { ok: true, date: '2026-10-15', content: CONTENT } },
    async setTime() { calls.push('rikke.setTime'); return { schedule: { time: '07:30', timeZone: 'Asia/Shanghai' } } },
  }
  const digaoApi = {
    async status() { calls.push('digao.status'); return { exists: true, meta: DIGAO_META } },
    async read() { calls.push('digao.read'); return { markdown: '', meta: DIGAO_META } },
    async refresh() { calls.push('digao.refresh'); return { meta: DIGAO_META } },
  }
  return {
    calls,
    rikke: rikkeApi,
    rikkeController: createRikkeUiController(rikkeApi),
    digao: digaoApi,
    digaoController: createDigaoUiController(digaoApi),
  }
}

describe('票 13 · 概览面板：两张卡由 status 喂数据', () => {
  it('日课卡 ready：宜 / 忌 / 流日 + 生成按钮可用（数据面已接线）', () => {
    const html = render(
      h(OverviewPanel, {
        ...injected(),
        ...wired(),
        today: '2026-10-15',
        preloadedBaziStatus: { state: 'empty' },
        preloadedRikkeStatus: RIKKE_READY,
        preloadedDigaoStatus: { exists: true, meta: DIGAO_META },
      }),
    )
    const card = cardOf(html, 'rike')
    expect(card).toContain('data-xs-state="ready"')
    expect(card).toContain('祭祀、出行')
    expect(card).toContain('动土')
    expect(card).toContain('甲子日 · 水')
    expect(card).toContain('data-xuanshu-action="generate-rikke"')
    // 数据面接线后按钮不再置灰（未接线时才给「还没接上」的理由）。
    const tag = card.slice(card.indexOf('data-xuanshu-action="generate-rikke"'))
    expect(tag.slice(0, tag.indexOf('>'))).not.toContain('disabled')
    expect(card).not.toContain('日课生成还没接上')
  })

  it('日课卡 [改时间 ->] 仍指向 DSH 原生 schedules 面板（票 07 已接线，不许改道）', () => {
    const html = render(
      h(OverviewPanel, {
        ...injected(),
        ...wired(),
        today: '2026-10-15',
        preloadedBaziStatus: { state: 'empty' },
        preloadedRikkeStatus: { date: '2026-10-15', exists: false },
      }),
    )
    const card = cardOf(html, 'rike')
    expect(card).toContain('data-xuanshu-nav="schedules"')
    expect(card).toContain('改时间 -&gt;')
  })

  it('底稿卡 ready：关于我 N 段 · 来源 M 路 + [打开底稿] 可用（digao 面板已装配）', () => {
    const html = render(
      h(OverviewPanel, {
        ...injected(),
        ...wired(),
        today: '2026-10-15',
        preloadedBaziStatus: { state: 'ready', snapshot: { pillars: {}, basis: {} } },
        preloadedDigaoStatus: { exists: true, meta: DIGAO_META },
      }),
    )
    const card = cardOf(html, 'digao')
    expect(card).toContain('data-xs-state="ready"')
    expect(card).toContain('关于我：15 段 · 来源 3 路')
    expect(card).toContain('纯派生 · 不可手改')
    expect(card).toContain('data-xuanshu-nav="digao"')
    const open = card.slice(card.indexOf('data-xuanshu-nav="digao"'))
    expect(open.slice(0, open.indexOf('>'))).not.toContain('disabled')
    expect(card).toContain('data-xuanshu-action="refresh-digao"')
  })

  it('底座未立 + 从未生成：底稿卡给「底座未立，还没有可提炼的来源」（S1 §6③ 空因 a）', () => {
    const html = render(
      h(OverviewPanel, {
        ...injected(),
        ...wired(),
        today: '2026-10-15',
        preloadedBaziStatus: { state: 'empty' },
        preloadedDigaoStatus: { exists: false, meta: null },
      }),
    )
    const card = cardOf(html, 'digao')
    expect(card).toContain('data-xs-state="empty"')
    expect(card).toContain('底座未立，还没有可提炼的来源。')
    expect(card).not.toContain('data-xuanshu-action="refresh-digao"')
  })

  it('底座已立 + 从未生成：底稿卡给「底稿还没生成过」+ [立即刷新]（S1 §6③ 空因 b）', () => {
    const html = render(
      h(OverviewPanel, {
        ...injected(),
        ...wired(),
        today: '2026-10-15',
        preloadedBaziStatus: { state: 'ready', snapshot: { pillars: {}, basis: {} } },
        preloadedDigaoStatus: { exists: false, meta: null },
      }),
    )
    const card = cardOf(html, 'digao')
    expect(card).toContain('底稿还没生成过')
    expect(card).toContain('data-xuanshu-action="refresh-digao"')
  })

  it('日课生成失败的卡片：失败理由出现在卡面上（底座未立时不静默）', () => {
    const html = render(
      h(OverviewPanel, {
        ...injected(),
        ...wired(),
        today: '2026-10-15',
        preloadedBaziStatus: { state: 'empty' },
        preloadedRikkeStatus: { date: '2026-10-15', exists: false },
        preloadedRikkeOutcome: { ok: false, reason: '底座未立：还没有出生信息（走 S3）' },
      }),
    )
    const card = cardOf(html, 'rike')
    expect(card).toContain('data-xs-state="error"')
    expect(card).toContain('底座未立：还没有出生信息（走 S3）')
  })

  it('静态渲染不碰写路径：生成 / 刷新一个都不发（人点才跑）', () => {
    const wiring = wired()
    const html = render(
      h(OverviewPanel, {
        ...injected(),
        ...wiring,
        today: '2026-10-15',
        preloadedBaziStatus: { state: 'empty' },
        preloadedRikkeStatus: RIKKE_READY,
        preloadedDigaoStatus: { exists: true, meta: DIGAO_META },
      }),
    )
    expect(html).toContain('data-xs-state="ready"')
    expect(wiring.calls.filter((call) => call === 'rikke.generate' || call === 'digao.refresh')).toEqual([])
  })
})

/* ───────────────────────── 4. 控制器的接线面（人点才跑的结构保证） ───────────────────────── */

describe('票 13 · 概览的日课生成入口', () => {
  it('造两个控制器都不发请求（概览挂载不会自动生成 / 自动刷新）', () => {
    const calls = []
    const api = {
      status: async () => { calls.push('rikke.status'); return { date: '2026-10-15', exists: false } },
      generate: async () => { calls.push('rikke.generate'); return { ok: true } },
      setTime: async () => { calls.push('rikke.setTime'); return { schedule: { time: '07:30', timeZone: 'Asia/Shanghai' } } },
    }
    createRikkeUiController(api)
    expect(calls).toEqual([])
  })
})
