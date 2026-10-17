/**
 * #23 · 开机自启：登录项 > 启动文件夹快捷方式 > 不支持，且**如实显示实际生效方式**。
 *
 * 验收原话：「自启开关生效、设置页显示当前实际生效方式」——关键是最后半句：
 * 不允许「设置里写 true 就显示已开启」。所以每一种组合都断言**方法名与回读到的真实状态**，
 * 包括「登录项写失败 → 退回快捷方式」与「两边都不可用 → unsupported，不假装成功」。
 */
import { describe, expect, it, vi } from 'vitest'

import { createAutostart } from '../../packages/xuanshu-shell/lib/autostart.mjs'

/** 登录项适配器的替身。 */
function fakeLoginItem({ available = true, initial = false, failSet = false } = {}) {
  const state = { enabled: initial }
  return {
    state,
    isAvailable: () => available,
    set: vi.fn((enabled) => {
      if (failSet) throw new Error('login item registry denied')
      state.enabled = enabled
    }),
    get: vi.fn(() => ({ enabled: state.enabled })),
  }
}

/** 启动文件夹快捷方式适配器的替身。 */
function fakeShortcut({ available = true, initial = false, failWrite = false } = {}) {
  const state = { exists: initial }
  return {
    state,
    isAvailable: () => available,
    write: vi.fn((enabled) => {
      if (failWrite) throw new Error('shortcut write denied')
      state.exists = enabled
    }),
    exists: vi.fn(() => state.exists),
  }
}

function make({ loginItem, shortcut } = {}) {
  return createAutostart({
    platform: 'win32',
    loginItem,
    shortcut,
    shortcutName: '玄枢.lnk',
    target: 'C:/Apps/xuanshu.exe',
    args: ['--hidden'],
  })
}

describe('#23 · 方法选择：登录项优先，其次快捷方式，最后 unsupported', () => {
  it('登录项可用 → method=login-item，apply(true) 后回读 enabled=true', () => {
    const loginItem = fakeLoginItem()
    const shortcut = fakeShortcut()
    const autostart = make({ loginItem, shortcut })

    expect(autostart.method()).toBe('login-item')
    const status = autostart.apply(true)
    expect(status).toMatchObject({ method: 'login-item', enabled: true, applied: true, label: '登录项' })
    expect(loginItem.set).toHaveBeenCalledWith(true, { target: 'C:/Apps/xuanshu.exe', args: ['--hidden'] })
    expect(shortcut.write).not.toHaveBeenCalled()
    expect(autostart.describe()).toContain('登录项')
    expect(autostart.describe()).toContain('已开')
  })

  it('登录项不可用、快捷方式可用 → method=shortcut（写启动文件夹快捷方式）', () => {
    const loginItem = fakeLoginItem({ available: false })
    const shortcut = fakeShortcut()
    const autostart = make({ loginItem, shortcut })

    expect(autostart.method()).toBe('shortcut')
    const status = autostart.apply(true)
    expect(status).toMatchObject({ method: 'shortcut', enabled: true, applied: true, label: '启动文件夹快捷方式' })
    expect(shortcut.write).toHaveBeenCalledWith(true, {
      name: '玄枢.lnk', target: 'C:/Apps/xuanshu.exe', args: ['--hidden'],
    })
    expect(loginItem.set).not.toHaveBeenCalled()
  })

  it('两边都不可用 → unsupported：apply(true) 不假装成功（enabled 仍 false）', () => {
    const autostart = make({ loginItem: fakeLoginItem({ available: false }), shortcut: fakeShortcut({ available: false }) })
    expect(autostart.method()).toBe('unsupported')
    const status = autostart.apply(true)
    expect(status).toMatchObject({ method: 'unsupported', enabled: false, applied: false, label: '不支持' })
    expect(status.detail).toMatch(/不支持/u)
    expect(autostart.describe()).toContain('不支持')
    expect(autostart.describe()).not.toContain('已开')
  })

  it('Linux 上没有登录项、也没有启动文件夹约定 → unsupported', () => {
    const autostart = createAutostart({
      platform: 'linux', loginItem: fakeLoginItem({ available: false }), shortcut: fakeShortcut({ available: false }),
    })
    expect(autostart.method()).toBe('unsupported')
  })
})

describe('#23 · 失败与回读：写不进去就如实说，不把设置值当结果', () => {
  it('登录项写失败 → 退回快捷方式（detail 说明为什么换了方法）', () => {
    const loginItem = fakeLoginItem({ failSet: true })
    const shortcut = fakeShortcut()
    const autostart = make({ loginItem, shortcut })
    const status = autostart.apply(true)
    expect(status).toMatchObject({ method: 'shortcut', enabled: true, applied: true })
    expect(status.detail).toMatch(/登录项/u)
    expect(shortcut.write).toHaveBeenCalledWith(true, expect.objectContaining({ name: '玄枢.lnk' }))
  })

  it('登录项与快捷方式都写失败 → unsupported，enabled=false，detail 带原因', () => {
    const autostart = make({
      loginItem: fakeLoginItem({ failSet: true }),
      shortcut: fakeShortcut({ failWrite: true }),
    })
    const status = autostart.apply(true)
    expect(status).toMatchObject({ method: 'unsupported', enabled: false, applied: false })
    expect(status.detail).toMatch(/快捷方式/u)
  })

  it('回读优先于写入：用户从系统设置里关掉登录项 → status() 如实说「已关」', () => {
    const loginItem = fakeLoginItem()
    const autostart = make({ loginItem, shortcut: fakeShortcut({ available: false }) })
    autostart.apply(true)
    expect(autostart.status()).toMatchObject({ method: 'login-item', enabled: true })

    loginItem.state.enabled = false // 系统设置里被关掉
    expect(autostart.status()).toMatchObject({ method: 'login-item', enabled: false })
    expect(autostart.describe()).toContain('已关')
  })

  it('关闭自启：登录项 / 快捷方式各自走「关」的那条路', () => {
    const loginItem = fakeLoginItem({ initial: true })
    const withLogin = make({ loginItem, shortcut: fakeShortcut() })
    expect(withLogin.apply(false)).toMatchObject({ method: 'login-item', enabled: false, applied: true })
    expect(loginItem.set).toHaveBeenLastCalledWith(false, expect.anything())

    const shortcut = fakeShortcut({ initial: true })
    const withShortcut = make({ loginItem: fakeLoginItem({ available: false }), shortcut })
    expect(withShortcut.apply(false)).toMatchObject({ method: 'shortcut', enabled: false, applied: true })
    expect(shortcut.write).toHaveBeenLastCalledWith(false, expect.anything())
  })

  it('detail 说明开发期注册的是哪支可执行文件（不假装它和装好的一样）', () => {
    const autostart = createAutostart({
      platform: 'win32',
      loginItem: fakeLoginItem(),
      shortcut: fakeShortcut(),
      target: 'C:/repo/node_modules/.bin/electron.exe',
      args: ['.'],
      isPackaged: false,
    })
    const status = autostart.apply(true)
    expect(status.method).toBe('login-item')
    expect(status.detail).toMatch(/开发期/u)
    expect(status.detail).toContain('electron.exe')
  })
})
