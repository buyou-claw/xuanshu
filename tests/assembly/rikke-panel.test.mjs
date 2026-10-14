/**
 * 票 13 · 日课半边（客户端）的契约与界面断言。
 *
 * 对应票面验收里属于**客户端半**的那几条：
 *   1. 契约 §2 的三个 `rikke.*` 方法名**逐字一致**（status / generate / setTime）与请求形状透传；
 *   2. **日课只能由人点生成**：控制器造出来不发 `rikke.generate`，只有显式 `generate()` 才发；
 *      `[重新生成（今天）]` 必过一次轻确认（S14 §5 第 3 步的人工闸门），且**没有**任何 `useEffect` 自动生成；
 *   3. 面板把「时间基准（日期 / 时刻 / 时区 / 本机时钟）+ 不联网」与宜 / 忌 / 流日摆出来，
 *      `[改时刻]` 走 `rikke.setTime`、`[打开自动化任务面板]` 跳 DSH 的 `schedules`；
 *   4. 底座未立（或推运失败）时**失败理由可见**，不许静默；
 *   5. `installRikke` 在无 `document` 的 Node 下安全返回，注册面纯加性。
 *
 * 环境：`renderToStaticMarkup`（无 jsdom）。真浏览器里的点击链路**没有**被本文件覆盖，
 * 交付报告里如实标注；「人点才生成」用控制器层的行为断言 + 渲染期 spy 双重证明。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RIKKE_ENDPOINTS, createRikkeApi } from '../../packages/xuanshu-client/src/client/rikke-api.ts'
import { createRikkeUiController } from '../../packages/xuanshu-client/src/client/rikke-controller.ts'
import { RikkePanel, installRikke } from '../../packages/xuanshu-client/src/client/rikke.tsx'
import { RIKKE_ID, RIKKE_LABEL, RIKKE_ORDER } from '../../packages/xuanshu-client/src/client/panel.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const RIKKE_SRC = resolve(REPO_ROOT, 'packages', 'xuanshu-client', 'src', 'client', 'rikke.tsx')

const render = (element) => renderToStaticMarkup(element)

/** 契约 §1 的当日卡内容（三键与票 07 的 `XsRikkeCard` ready 结构逐字对齐）。 */
const CONTENT = { yi: '祭祀、出行', ji: '动土', liuri: '甲子日 · 水' }

/** `rikke.status` 的 ready 回答（`generatedAt` / `zone` / `huangli` 是契约缺口提案里的**可选**字段）。 */
const STATUS_READY = {
  date: '2026-10-15',
  exists: true,
  content: CONTENT,
  generatedAt: '2026-10-15 07:30',
  zone: 'Asia/Shanghai',
  huangli: { ok: true, version: '0.40.1', tool: 'huangli' },
  schedule: { time: '07:30:00', timeZone: 'Asia/Shanghai', id: 'sched-rikke-1' },
}

/** 造一个记录调用的假数据面（不 mock 业务：只记方法名与请求体）。 */
function spyApi(over = {}) {
  const calls = []
  return {
    calls,
    api: {
      async status(payload) {
        calls.push(['rikke.status', payload])
        return { date: '2026-10-15', exists: false }
      },
      async generate(payload) {
        calls.push(['rikke.generate', payload])
        return { ok: true, date: '2026-10-15', content: CONTENT }
      },
      async setTime(payload) {
        calls.push(['rikke.setTime', payload])
        return { schedule: { time: payload.time, timeZone: 'Asia/Shanghai' } }
      },
      ...over,
    },
  }
}

/* ───────────────────────── 1. 三个 RPC 方法名（契约 §2） ───────────────────────── */

describe('票 13 · 日课数据面的方法名逐字对齐契约 §2', () => {
  it('三个方法名是契约表格那一列的原文', () => {
    expect(RIKKE_ENDPOINTS).toEqual({
      status: 'rikke.status',
      generate: 'rikke.generate',
      setTime: 'rikke.setTime',
    })
  })

  it('三个方法都走 /xuanshu 通道，请求体按契约透传（date 省缺 = 今天）', async () => {
    const calls = []
    const ctx = {
      connection: {
        rpc: {
          async call(...args) {
            calls.push(args)
            return { ok: true, value: { exists: false } }
          },
        },
      },
    }
    const api = createRikkeApi(ctx)
    await api.status()
    await api.status({ date: '2026-10-15' })
    await api.generate()
    await api.setTime({ time: '07:45' })
    expect(calls.map((call) => [call[0], call[1]])).toEqual([
      ['/xuanshu', 'rikke.status'],
      ['/xuanshu', 'rikke.status'],
      ['/xuanshu', 'rikke.generate'],
      ['/xuanshu', 'rikke.setTime'],
    ])
    expect(calls[0][2]).toEqual({})
    expect(calls[1][2]).toEqual({ date: '2026-10-15' })
    expect(calls[2][2]).toEqual({})
    expect(calls[3][2]).toEqual({ time: '07:45' })
  })

  it('RPC 失败时抛出（由调用方决定降级：面板 error 态）', async () => {
    const ctx = { connection: { rpc: { async call() { return { ok: false, error: { message: '底座未立' } } } } } }
    await expect(createRikkeApi(ctx).generate()).rejects.toThrow('底座未立')
  })
})

/* ───────────────────────── 2. 「人点才生成」（S14 §5 第 3 步） ───────────────────────── */

describe('票 13 · 日课生成只能由人点触发', () => {
  it('造控制器本身不发任何请求（自动生成会是这里的第一声）', () => {
    const spy = spyApi()
    createRikkeUiController(spy.api)
    expect(spy.calls).toEqual([])
  })

  it('显式 generate() 才发一次 rikke.generate，并把结果记下来', async () => {
    const spy = spyApi()
    const controller = createRikkeUiController(spy.api)
    const outcome = await controller.generate()
    expect(spy.calls).toEqual([['rikke.generate', {}]])
    expect(outcome).toEqual({ ok: true, date: '2026-10-15' })
    expect(controller.getOutcome()).toEqual({ ok: true, date: '2026-10-15' })
  })

  it('失败时理由落进 outcome（底座未立时卡片拿得到可读理由，不静默）', async () => {
    const spy = spyApi({
      async generate() {
        return { ok: false, date: '2026-10-15', reason: '底座未立：还没有出生信息（走 S3）' }
      },
    })
    const outcome = await createRikkeUiController(spy.api).generate()
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('底座未立：还没有出生信息（走 S3）')
  })

  it('连点只跑一次（单飞），完成后广播一次取数代次', async () => {
    let resolveGenerate
    const spy = spyApi({
      generate(payload) {
        spy.calls.push(['rikke.generate', payload])
        return new Promise((done) => {
          resolveGenerate = () => { done({ ok: true, date: '2026-10-15', content: CONTENT }) }
        })
      },
    })
    const controller = createRikkeUiController(spy.api)
    let notified = 0
    controller.subscribe(() => { notified += 1 })
    const first = controller.generate()
    const second = controller.generate()
    expect(spy.calls.filter((call) => call[0] === 'rikke.generate')).toHaveLength(1)
    resolveGenerate()
    await Promise.all([first, second])
    expect(controller.getRevision()).toBe(1)
    expect(notified).toBe(1)
  })

  it('rikke.tsx 里没有任何 useEffect 自动生成（机器判据：effect 体内不得出现 generate / setTime）', () => {
    const source = readFileSync(RIKKE_SRC, 'utf8')
    const bodies = useEffectBodies(source)
    expect(bodies.length, 'rikke.tsx 里应当有取数用的 useEffect（不是空转断言）').toBeGreaterThan(0)
    for (const body of bodies) {
      expect(body, 'useEffect 里不许自动生成日课（生成只能由人点）').not.toMatch(/\.generate\(|\.setTime\(/)
    }
  })
})

/**
 * 抠出源码里每个 `useEffect(` 的参数体（配对括号扫描）。
 * 这是「无自动生成」的**机器判据**：静态渲染跑不到 effect，所以用源码级守卫补这一刀。
 * @param source - 源码文本。
 * @returns 每个 useEffect 的参数体（含首尾括号之间的原文）。
 */
function useEffectBodies(source) {
  const bodies = []
  const marker = 'useEffect('
  let index = source.indexOf(marker)
  while (index !== -1) {
    let depth = 0
    let cursor = index + marker.length - 1
    const start = cursor
    for (; cursor < source.length; cursor += 1) {
      const char = source[cursor]
      if (char === '(') depth += 1
      else if (char === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    bodies.push(source.slice(start, cursor + 1))
    index = source.indexOf(marker, cursor)
  }
  return bodies
}

/* ───────────────────────── 3. 日课面板（S14 §2 A） ───────────────────────── */

describe('票 13 · 日课面板（看完整日课）', () => {
  it('ready：时间基准（日期 / 时刻 / 时区 / 本机时钟）+ 不联网声明 + 生成时刻', () => {
    const html = render(h(RikkePanel, { api: spyApi().api, navigate: () => {}, preloaded: STATUS_READY }))
    expect(html).toContain(`data-xuanshu-panel="${RIKKE_ID}"`)
    expect(html).toContain('日课 · 2026-10-15')
    expect(html).toContain('2026-10-15 07:30')
    expect(html).toContain('Asia/Shanghai')
    expect(html).toContain('本机时钟')
    expect(html).toContain('不联网取外部资讯：本次内容只用底座 + 上面的时间基准。')
    expect(html).toContain('生成于 2026-10-15 07:30')
    expect(html).toContain('huangli 0.40.1') // 来源可溯（本地 horosa 黄历）
  })

  it('ready：宜 / 忌 / 流日三行 + [重新生成（今天）] / [改时刻] / [打开自动化任务面板]', () => {
    const html = render(h(RikkePanel, { api: spyApi().api, navigate: () => {}, preloaded: STATUS_READY }))
    expect(html).toContain('宜')
    expect(html).toContain('祭祀、出行')
    expect(html).toContain('忌')
    expect(html).toContain('动土')
    expect(html).toContain('流日')
    expect(html).toContain('甲子日 · 水')
    expect(html).toContain('data-xuanshu-action="generate-rikke"')
    expect(html).toContain('重新生成（今天）')
    expect(html).toContain('data-xuanshu-action="edit-time"')
    expect(html).toContain('data-xuanshu-nav="schedules"')
    expect(html).toContain('打开自动化任务面板')
  })

  it('ready：改时刻是内联编辑 + 保存即调 rikke.setTime（走 ctx.schedule.update 的那条路）', () => {
    const html = render(
      h(RikkePanel, { api: spyApi().api, navigate: () => {}, preloaded: STATUS_READY, preloadedTimeEdit: true }),
    )
    expect(html).toContain('data-xuanshu-time-edit="rikke"')
    expect(html).toMatch(/<input[^>]*type="time"/)
    expect(html).toContain('value="07:30"')
    expect(html).toContain('data-xuanshu-action="save-time"')
    expect(html).toContain('Asia/Shanghai')
  })

  it('重新生成必过轻确认：未点之前确认块 hidden、文案是「将覆盖今天的日课，继续？」', () => {
    const html = render(h(RikkePanel, { api: spyApi().api, navigate: () => {}, preloaded: STATUS_READY }))
    expect(html).toContain('data-xuanshu-confirm="regenerate"')
    expect(html).toContain('将覆盖今天的日课，继续？')
    const confirmBlock = html.slice(html.indexOf('data-xuanshu-confirm="regenerate"'))
    expect(confirmBlock.slice(0, confirmBlock.indexOf('>'))).toContain('hidden')
  })

  it('渲染期不发 generate / setTime（人点才跑；status 是只读取数）', () => {
    const spy = spyApi()
    const element = h(RikkePanel, { api: spy.api, navigate: () => {}, preloaded: STATUS_READY })
    render(element)
    render(element)
    expect(spy.calls.filter((call) => call[0] !== 'rikke.status')).toEqual([])
  })

  it('底座未立 / 生成失败：理由可见 + 重试', () => {
    const html = render(
      h(RikkePanel, {
        api: spyApi().api,
        navigate: () => {},
        preloaded: { error: '底座未立：还没有出生信息（走 S3）' },
      }),
    )
    expect(html).toContain('底座未立：还没有出生信息（走 S3）')
    expect(html).toContain('data-xuanshu-action="retry"')
  })

  it('empty：今天还没生成时写「今天还没有生成日课」+ [立即生成（今天）]，并保留 [改时刻]', () => {
    const html = render(
      h(RikkePanel, {
        api: spyApi().api,
        navigate: () => {},
        preloaded: { date: '2026-10-15', exists: false, schedule: STATUS_READY.schedule },
      }),
    )
    expect(html).toContain('今天还没有生成日课')
    expect(html).toContain('data-xuanshu-action="generate-rikke"')
    expect(html).toContain('data-xuanshu-action="edit-time"')
    expect(html).toContain('（底座未立时生成会失败）')
  })
})

/* ───────────────────────── 4. 面板安装：加性注册 + 非 DOM 安全 ───────────────────────── */

describe('票 13 · installRikke（加性注册 / 无 document 安全）', () => {
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

  it('注册 main key `rikke` + 侧栏行 `rikke`（label 日课），不切面板', () => {
    const { registrations, ctx } = installCtx()
    expect(() => installRikke(ctx, { api: spyApi().api, navigate: () => {} })).not.toThrow()
    expect(registrations.map((row) => ({ name: row.name, key: row.key, id: row.id, order: row.order, label: row.label }))).toEqual([
      { name: 'main', key: RIKKE_ID, id: undefined, order: undefined, label: undefined },
      { name: 'sidebar.panellist', key: undefined, id: RIKKE_ID, order: RIKKE_ORDER, label: RIKKE_LABEL },
    ])
    expect(RIKKE_ID).toBe('rikke')
    expect(RIKKE_LABEL).toBe('日课')
    // 20/30/40/50/60/70 已被 S15 六行表预约，80/90 被票 08 占用 → 取 100。
    expect(RIKKE_ORDER).toBe(100)
  })
})
