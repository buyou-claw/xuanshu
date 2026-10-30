/**
 * P1（复核 #23）· 「关窗口行为 / 开机自启」设置行 + **实际生效方式**。
 *
 * 复核发现 #23 只做了一半：`shell.settings.set` RPC 有，但设置页没有调用者；托盘只有一行只读文字；
 * 用户看不到「开机自启实际用了哪条路」。这组测试钉住客户端那半边：
 *
 *   1. 两个开关调到 `shell.settings.set`（`closeBehavior` / `autostart`），且**不**碰
 *      `traffic.settings.set`（摘要开关走那一份）；
 *   2. 行上如实显示**实际生效方式**（登录项 / 启动文件夹快捷方式 / 不支持 + 开/关）；
 *   3. 壳没在跑（宿主回 `{settings}` 没有 `effective`）→ 显示「未知（桌面壳未运行）」，
 *      绝不把设置里的「想要」写成「已生效」；
 *   4. `settings.general.item` 仍只有一行（纯加性，不新增面板 / 侧栏行）。
 *
 * 环境：`renderToStaticMarkup`（无 jsdom）；写动作由假数据面记录，不触网。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import {
  NOTIFY_ENDPOINTS,
  createNotifyApi,
} from '../../packages/xuanshu-client/src/client/notify-api.ts'
import {
  SHELL_SETTINGS_ENDPOINTS,
  TOUCH_SETTINGS_ID,
  XsTouchSettingsRow,
  autostartMethodText,
  createShellSettingsWriter,
  installTouchSettings,
} from '../../packages/xuanshu-client/src/client/notify.tsx'
import { installRpcFetch, restoreRpcFetch } from './lib/rpc-fetch.mjs'

// 数据面是同源 fetch（`POST /api/xuanshu`），桩装在 fetch 上；漏还原会污染后面的文件。
afterEach(restoreRpcFetch)

const render = (element) => renderToStaticMarkup(element)

/** 一份「壳在跑、自启实际走快捷方式」的状态。 */
const EFFECTIVE = {
  autostart: { enabled: true, method: 'shortcut' },
  closeBehavior: 'quit',
}

const STATE = {
  aiEnabled: true,
  notifySummary: false,
  shell: {
    closeBehavior: 'quit',
    autostart: true,
    effective: EFFECTIVE,
  },
}

/** 收集调用、按方法名回值的假数据面。 */
function fakeApi({ effective } = { effective: EFFECTIVE }) {
  const calls = []
  return {
    calls,
    api: {
      async getShellSettings() {
        calls.push(['shell.settings.get'])
        return { settings: { closeBehavior: 'quit', autostart: true, notifySummary: false }, ...(effective === undefined ? {} : { effective }) }
      },
      async setShellSettings(patch) {
        calls.push(['shell.settings.set', patch])
        return { settings: { closeBehavior: 'quit', autostart: true, notifySummary: false }, ...(effective === undefined ? {} : { effective }) }
      },
      async getSettings() {
        calls.push(['traffic.settings.get'])
        return { notifySummary: false }
      },
      async setSettings(patch) {
        calls.push(['traffic.settings.set', patch])
        return { notifySummary: true }
      },
    },
  }
}

describe('P1 · 方法名与请求形状：两个开关调到 shell.settings.set', () => {
  it('端点逐字对齐宿主（shell.settings.get / set）', () => {
    expect(SHELL_SETTINGS_ENDPOINTS).toEqual({
      get: 'shell.settings.get',
      set: 'shell.settings.set',
    })
  })

  it('createNotifyApi 补的两个方法走 /xuanshu 通道；set 只提交 closeBehavior / autostart', async () => {
    const { calls } = installRpcFetch({ value: { settings: { closeBehavior: 'hide', autostart: false, notifySummary: false } } })
    const api = createNotifyApi({})
    await api.getShellSettings()
    await api.setShellSettings({ closeBehavior: 'hide', autostart: false })
    expect(calls.map((call) => [call.channel, call.endpoint])).toEqual([
      ['/xuanshu', 'shell.settings.get'],
      ['/xuanshu', 'shell.settings.set'],
    ])
    expect(calls[1].payload).toEqual({ closeBehavior: 'hide', autostart: false })
  })

  it('NOTIFY_ENDPOINTS 不受影响（摘要开关仍走 traffic.settings.*）', () => {
    expect(NOTIFY_ENDPOINTS.settingsGet).toBe('traffic.settings.get')
    expect(NOTIFY_ENDPOINTS.settingsSet).toBe('traffic.settings.set')
  })
})

describe('P1 · 行渲染：两个开关 + 实际生效方式', () => {
  it('两个开关都在，当前值来自宿主（关窗 quit / 自启开）', () => {
    const html = render(h(XsTouchSettingsRow, { state: STATE, actions: { onToggleAi() {}, onToggleSummary() {}, onToggleCloseBehavior() {}, onToggleAutostart() {} } }))
    expect(html).toContain('data-xuanshu-setting="close-behavior"')
    expect(html).toContain('data-xuanshu-setting="autostart"')
    expect(html).toContain('关窗口行为')
    expect(html).toContain('开机自启')
    // 两个 checkbox 都按宿主当前值渲染（quit → 勾上；autostart true → 勾上）。
    expect((html.match(/checked=""/gu) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('实际生效方式逐字显示（启动文件夹快捷方式 · 已开），并明说它不是设置值', () => {
    const html = render(h(XsTouchSettingsRow, { state: STATE, actions: { onToggleAi() {}, onToggleSummary() {}, onToggleCloseBehavior() {}, onToggleAutostart() {} } }))
    expect(html).toContain('实际生效')
    expect(html).toContain('启动文件夹快捷方式')
    expect(html).toContain('已开')
    expect(html).toContain('data-xuanshu-effective="autostart"')
  })

  it('壳没在跑（没有 effective）→ 如实显示「未知（桌面壳未运行）」，不写成已生效', () => {
    const html = render(h(XsTouchSettingsRow, { state: { ...STATE, shell: { closeBehavior: 'quit', autostart: true } }, actions: { onToggleAi() {}, onToggleSummary() {}, onToggleCloseBehavior() {}, onToggleAutostart() {} } }))
    expect(html).toContain('未知')
    expect(html).toContain('桌面壳未运行')
    // 说明文字里会提到「启动文件夹快捷方式」（那是解释），但**实际生效行**不许报一个方法。
    expect(html).not.toContain('实际生效：启动文件夹快捷方式')
  })

  it('读不到壳设置（老宿主 / RPC 失败）→ 两行禁用 + 可读理由，其余两行照常可用', () => {
    const html = render(h(XsTouchSettingsRow, {
      state: { aiEnabled: true, notifySummary: false, shellError: '读不到壳设置：未知玄枢操作：shell.settings.get' },
      actions: { onToggleAi() {}, onToggleSummary() {}, onToggleCloseBehavior() {}, onToggleAutostart() {} },
    }))
    expect(html).toContain('data-xuanshu-setting-error="shell"')
    expect(html).toContain('读不到壳设置')
    expect(html).toContain('未知玄枢操作')
    // 壳那两行是禁用的（不能拿默认值冒充当前值）。
    expect((html.match(/disabled=""/gu) ?? []).length).toBe(2)
    // 其余两行仍然可按（AI 段 / 通知摘要）。
    expect(html).toContain('data-xuanshu-setting="ai"')
    expect(html).toContain('data-xuanshu-setting="notify-summary"')
  })

  it('三种方式的人话逐字固定', () => {
    expect(autostartMethodText('login-item')).toContain('登录项')
    expect(autostartMethodText('shortcut')).toContain('启动文件夹快捷方式')
    expect(autostartMethodText('unsupported')).toContain('不支持')
    expect(autostartMethodText(undefined)).toContain('未知')
  })
})

describe('P1 · 写路径：钩子真的调用 set（失败可读、不静默）', () => {
  it('createShellSettingsWriter：写成功 → 把宿主回读的答案交给调用方；写的是 shell.settings.set', async () => {
    const { calls, api } = fakeApi()
    const changed = []
    const writer = createShellSettingsWriter({
      api,
      onChanged: (answer) => changed.push(answer),
      onError: () => {
        throw new Error('不该走失败分支')
      },
    })
    await writer({ autostart: true })
    expect(calls).toEqual([['shell.settings.set', { autostart: true }]])
    expect(changed[0].settings.autostart).toBe(true)
    expect(changed[0].effective).toEqual(EFFECTIVE)
  })

  it('写失败 → 可读理由交给 onError，且不外抛（设置行不把界面打挂）', async () => {
    const errors = []
    const writer = createShellSettingsWriter({
      api: {
        async setShellSettings() {
          throw new Error('shell-settings 不认识这个键')
        },
      },
      onChanged: () => {
        throw new Error('失败时不该报成功')
      },
      onError: (message) => errors.push(message),
    })
    await expect(writer({ autostart: true })).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('shell-settings 不认识这个键')
  })

  it('行上的两个复选框绑到两个动作（结构断言；点击链路由 writer 的那两条覆盖）', () => {
    const html = render(h(XsTouchSettingsRow, {
      state: STATE,
      actions: {
        onToggleAi() {},
        onToggleSummary() {},
        onToggleCloseBehavior() {},
        onToggleAutostart() {},
      },
    }))
    expect(html).toContain('data-xuanshu-setting="autostart"')
    expect(html).toContain('type="checkbox"')
    expect((html.match(/type="checkbox"/gu) ?? []).length).toBe(4) // AI / 摘要 / 关窗 / 自启
  })
})

describe('P1 · 安装：仍只注册 settings.general.item 一行（纯加性）', () => {
  it('id / name / order 稳定，且 inject 期不取数', () => {
    const injected = []
    const registered = []
    const ctx = {
      slots: {
        inject(name, callback) {
          injected.push(name)
          callback()
          return () => {}
        },
        register(options, component) {
          registered.push({ options, component })
          return () => {}
        },
      },
    }
    const { api } = fakeApi()
    installTouchSettings(ctx, { rikke: { getSettings: async () => ({ aiEnabled: true }), setSettings: async () => ({ aiEnabled: true }) }, notify: api })
    expect(injected).toEqual(['settings.general.item'])
    expect(registered).toHaveLength(1)
    expect(registered[0].options).toMatchObject({ name: 'settings.general.item', id: TOUCH_SETTINGS_ID, order: 70 })
  })
})
