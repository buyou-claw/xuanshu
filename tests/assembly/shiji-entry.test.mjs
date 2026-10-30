/**
 * 票 27（#27）· 会话内「存成今天的事记」+ 事记数据面（客户端半）。
 *
 * 对应票面验收：「会话内『存成今天的事记』点了才写（人确认闸门），不点不写」。
 *
 * 本文件钉四件事：
 *   1. **方法名与请求形状**：`shiji.fromSession({sessionId, confirmed:true})` / `shiji.remove({id, confirmed:true})`
 *      —— `confirmed: true` 由**数据面写死**，界面没有第二个入参可以构造请求；
 *   2. **不点不写**：静态渲染（SSR）一个请求都不发；入口只在**问事会话**里出现（判据是自铸 id 前缀）；
 *   3. **失败要看得见**：宿主的方法级失败 `{ok:false, error:{message}}` 被折成可读 Error；
 *   4. **注册面纯加性**：只在 `conversation.composer.dock` 上加一个 cell（不新增面板 / 侧栏行），
 *      并进 `tests/assembly/lib/panel-surface.mjs` 的单一事实来源（否则契约测试会说注册面「多了一个」）。
 *
 * 环境诚实登记：`renderToStaticMarkup`（无 jsdom）——真浏览器里的点按链路
 * （点 [存成今天的事记] → 确认 → RPC → 通知）**没有**被本文件覆盖，交付报告里如实标注。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { EXTRA_REGISTRATIONS, expectedCells } from './lib/panel-surface.mjs'
import { installRpcFetch, restoreRpcFetch } from './lib/rpc-fetch.mjs'
import { SHIJI_ENDPOINTS, createShijiApi } from '../../packages/xuanshu-client/src/client/shiji-api.ts'
import { SHIJI_ENTRY_ID, XsShijiSaveEntry, installShiji } from '../../packages/xuanshu-client/src/client/shiji-views.tsx'

// 数据面是同源 fetch（`POST /api/xuanshu`），桩装在 fetch 上；漏还原会污染后面的文件。
afterEach(restoreRpcFetch)

const render = (element) => renderToStaticMarkup(element)
const SESSION = 'session-xs-consult-1bb37188-5787-4f96-a6ec-0de66a825f2a'

/** 记调用的假数据面（静态渲染不该碰它）。 */
function spyShiji() {
  const calls = []
  return {
    calls,
    api: {
      async list(payload) {
        calls.push({ method: 'shiji.list', payload })
        return { entries: [] }
      },
      async remove(payload) {
        calls.push({ method: 'shiji.remove', payload })
        return { ok: true, entry: { id: payload.id } }
      },
      async fromSession(payload) {
        calls.push({ method: 'shiji.fromSession', payload })
        return { ok: true, entry: ENTRY }
      },
    },
  }
}

const ENTRY = {
  id: 'shiji-aaaaaaaaaaaaaaaa',
  source: 'session',
  name: '今天的问事',
  summary: '把底稿改成两段这件事聊清楚了。',
  firstSeenAt: '2026-10-17T08:00:00.000Z',
  lastActiveAt: '2026-10-17T08:00:00.000Z',
  basis: { sessions: 1, docs: 0 },
}

/* ───────────────────────── 1. 事记数据面的方法名与确认位 ───────────────────────── */

describe('票 27 · 事记数据面：方法名逐字对齐宿主，确认位写死在数据面里', () => {
  it('六个方法名逐字对齐宿主（P4 起含 restore / settings.get / settings.set）', () => {
    expect(SHIJI_ENDPOINTS).toEqual({
      list: 'shiji.list',
      remove: 'shiji.remove',
      restore: 'shiji.restore',
      fromSession: 'shiji.fromSession',
      settingsGet: 'shiji.settings.get',
      settingsSet: 'shiji.settings.set',
    })
    // 「底稿纯派生」的机器判据：没有改事记内容的方法（只有删 / 恢复 / 存 / 两条设置）。
    const methods = Object.values(SHIJI_ENDPOINTS)
    expect(methods.some((method) => /write|update|save|edit/i.test(method))).toBe(false)
    // 恢复不是「改内容」：它只清墓碑，下一条用例钉 confirmed 闸门。
    expect(methods).toContain('shiji.restore')
  })

  it('都走 /xuanshu 通道；写动作的请求体带 confirmed:true（界面构造不出别的）', async () => {
    const { calls } = installRpcFetch({ value: { ok: true, entry: ENTRY } })
    const api = createShijiApi({})
    await api.list()
    await api.remove({ id: 'shiji-aaaaaaaaaaaaaaaa' })
    await api.fromSession({ sessionId: SESSION })
    expect(calls.map((call) => [call.channel, call.endpoint, call.payload])).toEqual([
      ['/xuanshu', 'shiji.list', {}],
      ['/xuanshu', 'shiji.remove', { id: 'shiji-aaaaaaaaaaaaaaaa', confirmed: true }],
      ['/xuanshu', 'shiji.fromSession', { sessionId: SESSION, confirmed: true }],
    ])
  })

  it('宿主的方法级失败（ok:false）折成可读 Error（理由要显示在界面上）', async () => {
    // 注意外层仍是一封**成功**信封：失败在 `value` 里（方法级），不是传输层失败。
    installRpcFetch({
      value: { ok: false, error: { code: 'summary-unavailable', message: '摘要未能生成（模型不可用）：本次没有写入任何事记。' } },
    })
    const api = createShijiApi({})
    await expect(api.fromSession({ sessionId: SESSION })).rejects.toThrow('摘要未能生成（模型不可用）')
    await expect(api.remove({ id: 'shiji-aaaaaaaaaaaaaaaa' })).rejects.toThrow('摘要未能生成（模型不可用）')
  })
})

/* ───────────────────────── 2. 入口条：只在问事会话里出现 + 不点不写 ───────────────────────── */

describe('票 27 · [存成今天的事记]：只在问事会话里出现，不点不写', () => {
  it('非问事会话 / 拿不到会话座位：什么都不渲染（绝不猜一个会话去写）', () => {
    const { api } = spyShiji()
    expect(render(h(XsShijiSaveEntry, { sessionId: 'session-1bb37188', api }))).toBe('')
    expect(render(h(XsShijiSaveEntry, { api }))).toBe('')
    expect(render(h(XsShijiSaveEntry, { sessionId: SESSION }))).toBe('')
  })

  it('问事会话：给 [存成今天的事记]，并写明「点了才写 / 要确认」', () => {
    const { api } = spyShiji()
    const html = render(h(XsShijiSaveEntry, { sessionId: SESSION, api }))
    expect(html).toContain('data-xuanshu-block="shiji-entry"')
    expect(html).toContain('data-xuanshu-action="shiji-save-session"')
    expect(html).toContain('存成今天的事记')
    expect(html).toMatch(/人点|确认/u)
    // 确认闸门是**第二道**：静态渲染只看到第一道按钮，看不到 [确认存下]。
    expect(html).not.toContain('data-xuanshu-action="shiji-save-confirm"')
  })

  it('静态渲染不碰写路径：一个请求都不发（不点不写）', () => {
    const spy = spyShiji()
    render(h(XsShijiSaveEntry, { sessionId: SESSION, api: spy.api }))
    render(h(XsShijiSaveEntry, { sessionId: SESSION, api: spy.api }))
    expect(spy.calls).toEqual([])
  })
})

/* ───────────────────────── 3. 注册面：一个 composer.dock cell（纯加性） ───────────────────────── */

describe('票 27 · installShiji：只在 composer.dock 上加一个 cell', () => {
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

  it('当前环境确实没有 document（证明这条断言不是在 jsdom 里空转）', () => {
    expect(typeof document).toBe('undefined')
  })

  it('只注册 conversation.composer.dock 一个 cell：id `xuanshu.shiji-entry`，不切面板、不加 priority', () => {
    const { registrations, ctx } = installCtx()
    const { api } = spyShiji()
    expect(() => installShiji(ctx, { api })).not.toThrow()
    expect(registrations.map((row) => ({ name: row.name, id: row.id, key: row.key }))).toEqual([
      { name: 'conversation.composer.dock', id: SHIJI_ENTRY_ID, key: undefined },
    ])
    expect(SHIJI_ENTRY_ID).toBe('xuanshu.shiji-entry')
    expect(registrations[0].priority).toBeUndefined()
    expect(registrations[0].children).toBeUndefined()
  })

  it('注册面进了单一事实来源：`expectedCells()` 含这个 cell，且它挂在 workflow 那一对之后', () => {
    expect(expectedCells()).toContain('conversation.composer.dock\u0000xuanshu.shiji-entry')
    const extra = EXTRA_REGISTRATIONS.find((row) => row.cells.includes('conversation.composer.dock\u0000xuanshu.shiji-entry'))
    expect(extra).toBeDefined()
    expect(extra.after).toBe('workflow')
    // 与 index.tsx 的 install 顺序一致：sediment → bestof → shiji（靠数组顺序分先后）。
    const order = EXTRA_REGISTRATIONS.filter((row) => row.after === 'workflow').map((row) => row.cells[0])
    expect(order[order.length - 1]).toBe('conversation.composer.dock\u0000xuanshu.shiji-entry')
  })
})
