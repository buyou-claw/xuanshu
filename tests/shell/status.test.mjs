/**
 * #23 · 界面状态：没有认证 URL 时如实显示「服务未就绪」（验收：界面显示当前状态）。
 *
 * 壳的窗口只有两种内容：认证后的玄枢首页，或一张**本地状态页**。状态页必须：
 *   - 绝不包含任何 http(s) 地址（那等于在教壳「猜一个地址」）；
 *   - 把 supervisor 的状态如实翻成人话（启动中 / 第 N 次重拉 / 已放弃 + 原因 / 已停止）；
 *   - 自启方式与通知能力一并显示（设置页同源数据）。
 */
import { describe, expect, it } from 'vitest'

import { shellStatusViewModel, statusPageHtml } from '../../packages/xuanshu-shell/lib/status.mjs'

const AUTOSTART = { method: 'login-item', enabled: true, label: '登录项' }

describe('#23 · shellStatusViewModel：状态翻人话，ready 才带 url', () => {
  it('started 中 → 服务未就绪 + 正在启动；没有 url', () => {
    const view = shellStatusViewModel({ supervisorState: { phase: 'starting' }, autostart: AUTOSTART })
    expect(view.ready).toBe(false)
    expect(view.title).toBe('服务未就绪')
    expect(view.detail).toContain('正在启动')
    expect(view.url).toBeUndefined()
  })

  it('ready → 服务已就绪，带认证 URL', () => {
    const view = shellStatusViewModel({
      supervisorState: { phase: 'ready', url: 'http://127.0.0.1:19388/?token=x' },
      autostart: AUTOSTART,
    })
    expect(view.ready).toBe(true)
    expect(view.title).toBe('服务已就绪')
    expect(view.url).toBe('http://127.0.0.1:19388/?token=x')
  })

  it('restarting → 服务未就绪 + 第 N 次重拉 + 上次退出码', () => {
    const view = shellStatusViewModel({
      supervisorState: { phase: 'restarting', attempt: 2, lastExit: { code: 1, signal: null }, nextRetryMs: 200 },
      autostart: AUTOSTART,
    })
    expect(view.ready).toBe(false)
    expect(view.detail).toContain('第 2 次')
    expect(view.detail).toContain('code=1')
  })

  it('failed → 服务未就绪 + 如实原因（不显示成正在恢复）', () => {
    const view = shellStatusViewModel({
      supervisorState: { phase: 'failed', attempt: 5, detail: '连续 5 次启动失败，已停止重拉' },
      autostart: AUTOSTART,
    })
    expect(view.title).toBe('服务未就绪')
    expect(view.detail).toContain('连续 5 次启动失败')
    expect(view.detail).not.toContain('正在恢复')
  })

  it('stopped → 服务未就绪 + 已停止', () => {
    const view = shellStatusViewModel({ supervisorState: { phase: 'stopped' }, autostart: AUTOSTART })
    expect(view.detail).toContain('已停止')
  })

  it('自启方式与通知能力一并进视图（设置页 / 状态页同源）', () => {
    const view = shellStatusViewModel({
      supervisorState: { phase: 'starting' },
      autostart: { method: 'unsupported', enabled: false, label: '不支持' },
      notification: { supported: false, detail: '系统通知不可用' },
    })
    expect(view.autostart).toMatchObject({ method: 'unsupported', label: '不支持' })
    expect(view.notification.supported).toBe(false)
  })
})

describe('#23 · statusPageHtml：本地状态页绝不带地址', () => {
  it('未就绪页包含「服务未就绪」与细节，且不含任何 http(s) 地址', () => {
    const view = shellStatusViewModel({
      supervisorState: { phase: 'restarting', attempt: 1, lastExit: { code: 1, signal: null }, nextRetryMs: 500 },
      autostart: AUTOSTART,
    })
    const html = statusPageHtml(view)
    expect(html).toContain('服务未就绪')
    expect(html).toContain('第 1 次')
    expect(html).not.toMatch(/https?:\/\//u)
    expect(html).not.toContain('window.location')
    // 自启方式如实显示在页面上。
    expect(html).toContain('登录项')
  })

  it('HTML 转义 detail / label（这些字符串来自子进程日志与设置文件）', () => {
    const view = shellStatusViewModel({
      supervisorState: { phase: 'failed', detail: '<script>alert(1)</script> & <b>x</b>' },
      autostart: { method: 'unsupported', enabled: false, label: '<b>不支持</b>' },
    })
    const html = statusPageHtml(view)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<b>不支持</b>')
  })

  it('ready 视图仍给出状态页（壳不会用它），页面里带的是「已就绪」而不是地址', () => {
    const view = shellStatusViewModel({
      supervisorState: { phase: 'ready', url: 'http://127.0.0.1:19388/?token=secret' },
      autostart: AUTOSTART,
    })
    const html = statusPageHtml(view)
    expect(html).toContain('服务已就绪')
    expect(html).not.toContain('token=secret')
  })
})
