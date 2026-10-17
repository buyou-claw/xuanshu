/**
 * #23 · 共享设置文件：壳读、宿主写（冻结契约 §5）。
 *
 * 契约 §5 的硬要求：
 *   - 路径 `<dataDir>/shell-settings.json`，schema `xuanshu/shell-settings@1`；
 *   - 壳读 `closeBehavior` / `autostart`；**文件缺失 = 全部默认值，不报错**；
 *   - 壳的应用时机：启动时读一次；每次关窗、每次构建托盘菜单前重读；`fs.watch` 可用时监听（best-effort）。
 *
 * 这组测试同时钉住「壳的读面与宿主写面同判」：两边读同一份文件必须得到同一组值。
 * 读面用注入的 dataDir（`tests/shell/.tmp/**`），绝不读 `.dsh-home`。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { readShellSettings as hostRead } from '../../packages/xuanshu-host/lib/notify/settings.mjs'
import { DEFAULT_SHELL_SETTINGS } from '../../packages/xuanshu-shell/lib/contract.mjs'
import {
  createSettingsStore,
  readShellSettings,
  readShellSettingsFromFile,
  shellSettingsFile,
} from '../../packages/xuanshu-shell/lib/settings.mjs'
import { makeScratch } from './lib/sandbox.mjs'

const scratch = []
afterEach(() => {
  scratch.splice(0).forEach((box) => box.cleanup())
})

/** 一次性 dataDir（= `<home>/xuanshu`）。 */
function scene(label = 'shell-settings') {
  const box = makeScratch(label)
  scratch.push(box)
  return box
}

describe('#23 · 设置读面：缺文件 = 默认值，坏文件也不抛', () => {
  it('文件不存在 → 全默认（hide / false / false）', () => {
    const box = scene()
    expect(readShellSettings(box.dataDir)).toEqual({ ...DEFAULT_SHELL_SETTINGS })
    expect(readShellSettingsFromFile(join(box.dataDir, 'nope.json'))).toEqual({ ...DEFAULT_SHELL_SETTINGS })
  })

  it('合法文件 → 逐字读出（closeBehavior=quit / autostart=true / notifySummary=true）', () => {
    const box = scene()
    box.write('shell-settings.json', JSON.stringify({
      schema: 'xuanshu/shell-settings@1',
      closeBehavior: 'quit',
      autostart: true,
      notifySummary: true,
    }))
    expect(readShellSettings(box.dataDir)).toEqual({ closeBehavior: 'quit', autostart: true, notifySummary: true })
  })

  it('坏 JSON / schema 不认识 / 非对象 / 缺键 / 取值非法 → 逐键回落默认值', () => {
    const cases = [
      ['not json', { closeBehavior: 'hide', autostart: false, notifySummary: false }],
      [JSON.stringify({ schema: 'xuanshu/shell-settings@0', closeBehavior: 'quit', autostart: true }),
        { closeBehavior: 'hide', autostart: false, notifySummary: false }],
      [JSON.stringify([]), { closeBehavior: 'hide', autostart: false, notifySummary: false }],
      [JSON.stringify(null), { closeBehavior: 'hide', autostart: false, notifySummary: false }],
      [JSON.stringify({ schema: 'xuanshu/shell-settings@1' }),
        { closeBehavior: 'hide', autostart: false, notifySummary: false }],
      // 逐键回落：合法的 quit 留下，非法的 minimize 回落 hide。
      [JSON.stringify({ schema: 'xuanshu/shell-settings@1', closeBehavior: 'minimize' }),
        { closeBehavior: 'hide', autostart: false, notifySummary: false }],
      [JSON.stringify({ schema: 'xuanshu/shell-settings@1', closeBehavior: 'quit', autostart: 'yes' }),
        { closeBehavior: 'quit', autostart: false, notifySummary: false }],
      [JSON.stringify({
        schema: 'xuanshu/shell-settings@1', closeBehavior: 'quit', autostart: true, notifySummary: 1,
      }), { closeBehavior: 'quit', autostart: true, notifySummary: false }],
    ]
    for (const [text, expected] of cases) {
      const box = scene()
      box.write('shell-settings.json', text)
      expect(readShellSettings(box.dataDir), text).toEqual(expected)
    }
  })

  it('与宿主的读面同判（同一份文件、同一组值）', () => {
    const fixtures = [
      undefined,
      '{"schema":"xuanshu/shell-settings@1","closeBehavior":"quit","autostart":true,"notifySummary":true}',
      '{"schema":"xuanshu/shell-settings@1","closeBehavior":"hide","autostart":false}',
      '{"schema":"xuanshu/shell-settings@1","closeBehavior":"nope","autostart":"nope"}',
      '{"schema":"other","closeBehavior":"quit"}',
      'broken json',
    ]
    for (const text of fixtures) {
      const box = scene()
      if (text !== undefined) box.write('shell-settings.json', text)
      expect(readShellSettings(box.dataDir), String(text)).toEqual(hostRead(box.dataDir))
    }
  })

  it('设置文件路径 = <dataDir>/shell-settings.json', () => {
    expect(shellSettingsFile('/tmp/x/xuanshu')).toBe(join('/tmp/x/xuanshu', 'shell-settings.json'))
  })
})

describe('#23 · 重读时机：启动 / 关窗前 / 构建托盘菜单前 / fs.watch（best-effort）', () => {
  it('store.read() 每次都读盘（外部改文件后立刻看到）', () => {
    const box = scene()
    const store = createSettingsStore({ dataDir: box.dataDir })
    expect(store.read()).toEqual({ ...DEFAULT_SHELL_SETTINGS })

    box.write('shell-settings.json', JSON.stringify({ schema: 'xuanshu/shell-settings@1', closeBehavior: 'quit' }))
    expect(store.read().closeBehavior).toBe('quit')

    box.write('shell-settings.json', JSON.stringify({ schema: 'xuanshu/shell-settings@1', closeBehavior: 'hide' }))
    expect(store.read().closeBehavior).toBe('hide')
  })

  it('watch() 注册：文件变化 → 重读并把新设置交给回调；close() 之后不再回调', () => {
    const box = scene()
    const listeners = []
    const fakeWatcher = {
      close: vi.fn(),
    }
    const watchFactory = vi.fn((_file, listener) => {
      listeners.push(listener)
      return fakeWatcher
    })
    const store = createSettingsStore({ dataDir: box.dataDir, watchFactory })
    const onChange = vi.fn()
    store.watch(onChange)

    expect(watchFactory).toHaveBeenCalledTimes(1)
    expect(watchFactory.mock.calls[0][0]).toBe(shellSettingsFile(box.dataDir))

    box.write('shell-settings.json', JSON.stringify({ schema: 'xuanshu/shell-settings@1', autostart: true }))
    listeners[0]('change', 'shell-settings.json')
    expect(onChange).toHaveBeenCalledWith({ closeBehavior: 'hide', autostart: true, notifySummary: false })

    store.close()
    expect(fakeWatcher.close).toHaveBeenCalledTimes(1)
    listeners[0]('change', 'shell-settings.json')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('watch 工厂抛（文件/目录还不存在、平台不支持）→ 不抛、不影响读面（best-effort）', () => {
    const box = scene()
    const store = createSettingsStore({
      dataDir: box.dataDir,
      watchFactory: () => {
        throw new Error('ENOENT: no such file or directory')
      },
    })
    expect(() => store.watch(() => {})).not.toThrow()
    expect(store.read()).toEqual({ ...DEFAULT_SHELL_SETTINGS })
    expect(() => store.close()).not.toThrow()
  })

  it('默认 watchFactory 是真实的 fs.watch（不传也能用；这里只验证能注册/关闭，不等事件）', () => {
    const box = scene()
    mkdirSync(box.dataDir, { recursive: true })
    writeFileSync(join(box.dataDir, 'shell-settings.json'), '{"schema":"xuanshu/shell-settings@1"}\n')
    const store = createSettingsStore({ dataDir: box.dataDir })
    expect(() => store.watch(() => {})).not.toThrow()
    expect(() => store.close()).not.toThrow()
  })
})
