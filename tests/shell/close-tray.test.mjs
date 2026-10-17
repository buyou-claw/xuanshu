/**
 * #23 · 关窗语义 + 托盘（验收：关窗后壳与子进程都还在；托盘「打开」恢复窗口；「退出」真退出）。
 *
 * 契约 §5 的时机要求在这里落地：**每次关窗前重读设置**（宿主可能刚把 closeBehavior 改成 quit），
 * **每次构建托盘菜单前重读设置**。壳不缓存「上次读到的设置」，否则设置页改了没反应。
 *
 * 首次关窗的一次性说明：标记落在 Electron 的 `userData`（壳自己的存储，不是共享契约文件），
 * 所以「一次性」跨重启也成立；这里用临时文件测。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  buildTrayMenu,
  CLOSE_EXPLAINED_FILE,
  createCloseHandler,
  createTrayController,
  decideCloseAction,
  readCloseExplained,
  writeCloseExplained,
} from '../../packages/xuanshu-shell/lib/desktop-behavior.mjs'
import { makeScratch } from './lib/sandbox.mjs'

const scratch = []
afterEach(() => {
  scratch.splice(0).forEach((box) => box.cleanup())
})

function scene(label) {
  const box = makeScratch(label)
  scratch.push(box)
  return box
}

describe('#23 · decideCloseAction：默认隐藏，可配置为退出', () => {
  it('默认（hide）→ 隐藏；首次给一次性说明', () => {
    expect(decideCloseAction({ settings: { closeBehavior: 'hide' }, firstHideExplained: false }))
      .toEqual({ action: 'hide', explain: true })
    expect(decideCloseAction({ settings: { closeBehavior: 'hide' }, firstHideExplained: true }))
      .toEqual({ action: 'hide', explain: false })
  })

  it('设置 closeBehavior=quit → 真退出（没有说明弹窗）', () => {
    expect(decideCloseAction({ settings: { closeBehavior: 'quit' }, firstHideExplained: false }))
      .toEqual({ action: 'quit', explain: false })
  })

  it('设置缺失 / 取值非法 → 按默认 hide（壳不因为一份坏设置把窗口关死）', () => {
    for (const settings of [undefined, {}, { closeBehavior: 'minimize' }]) {
      expect(decideCloseAction({ settings, firstHideExplained: true })).toEqual({ action: 'hide', explain: false })
    }
  })
})

describe('#23 · createCloseHandler：每次关窗前重读设置', () => {
  it('第一次关窗：隐藏 + 说明；第二次：只隐藏；设置改成 quit 后：退出', () => {
    let settings = { closeBehavior: 'hide' }
    const onHide = vi.fn()
    const onQuit = vi.fn()
    const onExplain = vi.fn()
    const explained = { value: false }
    const handler = createCloseHandler({
      readSettings: () => settings,
      isExplained: () => explained.value,
      markExplained: () => {
        explained.value = true
      },
      onHide,
      onQuit,
      onExplain,
    })

    expect(handler.handleClose()).toEqual({ action: 'hide', explain: true })
    expect(onHide).toHaveBeenCalledTimes(1)
    expect(onExplain).toHaveBeenCalledTimes(1)
    expect(onQuit).not.toHaveBeenCalled()

    expect(handler.handleClose()).toEqual({ action: 'hide', explain: false })
    expect(onHide).toHaveBeenCalledTimes(2)
    expect(onExplain).toHaveBeenCalledTimes(1)

    settings = { closeBehavior: 'quit' }
    expect(handler.handleClose()).toEqual({ action: 'quit', explain: false })
    expect(onQuit).toHaveBeenCalledTimes(1)
    expect(onHide).toHaveBeenCalledTimes(2)
  })

  it('readSettings 每次关窗都被调用（不缓存）', () => {
    const readSettings = vi.fn(() => ({ closeBehavior: 'hide' }))
    const handler = createCloseHandler({
      readSettings, isExplained: () => true, markExplained: () => {}, onHide: () => {}, onQuit: () => {}, onExplain: () => {},
    })
    handler.handleClose()
    handler.handleClose()
    expect(readSettings).toHaveBeenCalledTimes(2)
  })
})

describe('#23 · 一次性说明的持久标记（Electron userData，不是共享设置文件）', () => {
  it('标记文件缺失 = 没解释过；写过之后跨 handler 实例都算解释过', () => {
    const box = scene('shell-close-flag')
    const file = box.path(CLOSE_EXPLAINED_FILE)
    expect(readCloseExplained(file)).toBe(false)

    mkdirSync(dirname(file), { recursive: true })
    writeCloseExplained(file)
    expect(readCloseExplained(file)).toBe(true)

    const onExplain = vi.fn()
    const handler = createCloseHandler({
      readSettings: () => ({ closeBehavior: 'hide' }),
      isExplained: () => readCloseExplained(file),
      markExplained: () => writeCloseExplained(file),
      onHide: () => {}, onQuit: () => {}, onExplain,
    })
    expect(handler.handleClose()).toEqual({ action: 'hide', explain: false })
    expect(onExplain).not.toHaveBeenCalled()
  })
})

describe('#23 · 托盘菜单：打开 / 退出 + 当前状态如实显示', () => {
  it('菜单含「打开」「退出」；状态项随 supervisor 状态变化（不静默死亡）', () => {
    const open = vi.fn()
    const quit = vi.fn()
    const menu = buildTrayMenu({
      supervisorState: { phase: 'ready', url: 'http://127.0.0.1:19388/?token=x' },
      settings: { closeBehavior: 'hide', autostart: false },
      autostart: { method: 'login-item', enabled: true, label: '登录项' },
      actions: { open, quit },
    })
    const labels = menu.map((item) => item.label).filter(Boolean)
    expect(labels).toContain('打开')
    expect(labels).toContain('退出')
    expect(labels.some((label) => label.includes('已就绪'))).toBe(true)
    // 自启方式如实显示（设置页同源数据；这里显示在托盘里）。
    expect(labels.some((label) => label.includes('登录项'))).toBe(true)

    const openItem = menu.find((item) => item.label === '打开')
    const quitItem = menu.find((item) => item.label === '退出')
    openItem.click()
    quitItem.click()
    expect(open).toHaveBeenCalledTimes(1)
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('没有 URL 时状态项显示「服务未就绪」（绝不显示一个猜的地址）', () => {
    const menu = buildTrayMenu({
      supervisorState: { phase: 'starting' },
      settings: { closeBehavior: 'hide', autostart: false },
      autostart: { method: 'unsupported', enabled: false, label: '不支持' },
      actions: { open: () => {}, quit: () => {} },
    })
    const text = JSON.stringify(menu)
    expect(text).toContain('服务未就绪')
    expect(text).not.toContain('http://')
  })

  it('重启中 / 已放弃：托盘如实说明（第几次、退出码），且「打开」仍可用', () => {
    const restarting = buildTrayMenu({
      supervisorState: { phase: 'restarting', attempt: 2, lastExit: { code: 1, signal: null }, nextRetryMs: 200 },
      settings: {},
      autostart: { method: 'shortcut', enabled: true, label: '启动文件夹快捷方式' },
      actions: { open: () => {}, quit: () => {} },
    })
    const restartingText = JSON.stringify(restarting)
    expect(restartingText).toContain('第 2 次')
    expect(restartingText).toContain('启动文件夹快捷方式')

    const failed = buildTrayMenu({
      supervisorState: { phase: 'failed', attempt: 5, detail: '连续 5 次启动失败' },
      settings: {},
      autostart: { method: 'unsupported', enabled: false, label: '不支持' },
      actions: { open: () => {}, quit: () => {} },
    })
    const failedText = JSON.stringify(failed)
    expect(failedText).toContain('连续 5 次启动失败')
    expect(failed.find((item) => item.label === '打开').enabled).toBe(true)
  })
})

describe('#23 · createTrayController：每次构建菜单前重读设置', () => {
  it('refresh() 先 readSettings 再 setMenu；设置变化后 tooltip 跟着变', () => {
    const tray = { setMenu: vi.fn(), setToolTip: vi.fn(), destroy: vi.fn() }
    let settings = { closeBehavior: 'hide', autostart: false }
    const readSettings = vi.fn(() => settings)
    let autostart = { method: 'login-item', enabled: false, label: '登录项' }
    const controller = createTrayController({
      tray,
      readSettings,
      getSupervisorState: () => ({ phase: 'starting' }),
      getAutostart: () => autostart,
      actions: { open: () => {}, quit: () => {} },
    })

    controller.refresh()
    expect(readSettings).toHaveBeenCalledTimes(1)
    expect(tray.setMenu).toHaveBeenCalledTimes(1)
    const firstTooltip = tray.setToolTip.mock.calls[0][0]
    expect(firstTooltip).toContain('服务未就绪')

    settings = { closeBehavior: 'quit', autostart: true }
    autostart = { method: 'shortcut', enabled: true, label: '启动文件夹快捷方式' }
    controller.refresh()
    expect(readSettings).toHaveBeenCalledTimes(2)
    expect(tray.setToolTip.mock.calls[1][0]).toContain('启动文件夹快捷方式')

    controller.destroy()
    expect(tray.destroy).toHaveBeenCalledTimes(1)
  })
})
