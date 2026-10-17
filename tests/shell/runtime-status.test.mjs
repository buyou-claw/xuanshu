/**
 * P1（复核 #23）· 壳把自己的**实际生效状态**写成运行时文件（`runtime/shell-status.json`）。
 *
 * 复核发现 #23 的验收缺了最后一公里：`shell.settings.set` 有了、设置文件也是唯一权威，但
 *   - 壳从不把「开机自启实际用了哪条路（登录项 / 快捷方式 / 不支持）」告诉任何人；
 *   - 界面因此只能显示设置里**想要**的值，显示不出**实际生效**的值（托盘只有一行只读文字）。
 *
 * 加性契约（本文件钉住）：
 *   - 文件：`<home>/xuanshu/runtime/shell-status.json`（与 `shell-notify.json` 同目录的兄弟）；
 *     schema `xuanshu/shell-status@1`；
 *   - 形状：`{schema, pid, updatedAt, autostart:{enabled, method}, closeBehavior}`；
 *   - `method ∈ {'login-item','shortcut','unsupported'}`，`closeBehavior ∈ {'hide','quit'}`；
 *   - 宿主侧 `resolveShellStatus({env})` 从 `XUANSHU_SHELL_NOTIFY_STATE` 的**同目录兄弟**读它，
 *     读不到 / 坏文件一律「未知」（绝不把坏文件当真）。
 *
 * 环境：一次性 home（`tests/shell/.tmp/**`）+ 假适配器；不碰真机 home、不碰真 Electron。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createAutostart } from '../../packages/xuanshu-shell/lib/autostart.mjs'
import {
  AUTOSTART_METHODS, SHELL_STATUS_FILE, SHELL_STATUS_SCHEMA,
} from '../../packages/xuanshu-shell/lib/contract.mjs'
import {
  buildShellStatus, readShellStatusFile, removeShellStatus, writeShellStatusFile,
} from '../../packages/xuanshu-shell/lib/shell-status.mjs'
import { shellPaths } from '../../packages/xuanshu-shell/lib/home.mjs'
import { resolveShellStatus } from '../../packages/xuanshu-host/lib/notify/shell-status.mjs'
import { NOTIFY_STATE_ENV } from '../../packages/xuanshu-host/lib/notify/target.mjs'
import { makeScratch } from './lib/sandbox.mjs'

const boxes = []
afterEach(() => boxes.splice(0).forEach((box) => box.cleanup()))

function scene(label = 'shell-status') {
  const box = makeScratch(label)
  boxes.push(box)
  return box
}

/** 壳在跑时宿主怎么看：env 里是 notify 状态文件的路径。 */
const envFor = (box) => ({ [NOTIFY_STATE_ENV]: shellPaths(box.home).notifyStateFile })

describe('P1 · 壳侧形状：buildShellStatus 只接受契约里的值', () => {
  it('合法输入 → 逐字形状（schema / pid / updatedAt / autostart / closeBehavior）', () => {
    const status = buildShellStatus({
      pid: 4321,
      autostart: { enabled: true, method: 'shortcut' },
      closeBehavior: 'quit',
      updatedAt: '2026-10-17T00:00:00.000Z',
    })
    expect(status).toEqual({
      schema: SHELL_STATUS_SCHEMA,
      pid: 4321,
      updatedAt: '2026-10-17T00:00:00.000Z',
      autostart: { enabled: true, method: 'shortcut' },
      closeBehavior: 'quit',
    })
    expect(SHELL_STATUS_FILE).toBe('shell-status.json')
    expect([...AUTOSTART_METHODS]).toEqual(['login-item', 'shortcut', 'unsupported'])
  })

  it('不认识的方法 / 关窗行为 / 坏 pid → 抛（写出去的状态必须是可判读的）', () => {
    const base = { pid: 1, autostart: { enabled: true, method: 'shortcut' }, closeBehavior: 'hide' }
    expect(() => buildShellStatus({ ...base, autostart: { enabled: true, method: 'registry' } })).toThrow(/method/u)
    expect(() => buildShellStatus({ ...base, autostart: { enabled: 'yes', method: 'shortcut' } })).toThrow(/enabled/u)
    expect(() => buildShellStatus({ ...base, closeBehavior: 'minimize' })).toThrow(/closeBehavior/u)
    expect(() => buildShellStatus({ ...base, pid: 0 })).toThrow(/pid/u)
  })
})

describe('P1 · 壳写 → 宿主读（同一份文件、同一套判据）', () => {
  it('写入后原子读回，宿主从 notify 状态文件的同目录兄弟里读出**同一份**', () => {
    const box = scene()
    const file = shellPaths(box.home).statusFile
    const status = buildShellStatus({
      pid: 4321,
      autostart: { enabled: true, method: 'login-item' },
      closeBehavior: 'hide',
      updatedAt: '2026-10-17T00:00:00.000Z',
    })
    writeShellStatusFile(file, status)
    expect(readShellStatusFile(file)).toEqual(status)

    const resolved = resolveShellStatus({ env: envFor(box) })
    expect(resolved.ok).toBe(true)
    // 宿主侧只取「实际生效」的两项（schema / pid 是壳自己的排障字段，不进 RPC 面）。
    expect(resolved.status).toEqual({ autostart: status.autostart, closeBehavior: status.closeBehavior })
    expect(resolved.status.autostart.method).toBe('login-item')
  })

  it('壳不在场（env 缺席 / 状态文件不存在 / 坏文件 / schema 不认识）→ 一律「未知」，不抛', () => {
    expect(resolveShellStatus({ env: {} })).toMatchObject({ ok: false, reason: 'no-shell' })
    expect(resolveShellStatus({})).toMatchObject({ ok: false, reason: 'no-shell' })

    const box = scene()
    expect(resolveShellStatus({ env: envFor(box) })).toMatchObject({ ok: false, reason: 'state-missing' })

    box.write('runtime/shell-status.json', '{ 坏掉的 JSON')
    expect(resolveShellStatus({ env: envFor(box) })).toMatchObject({ ok: false, reason: 'state-invalid' })

    box.write('runtime/shell-status.json', JSON.stringify({ schema: 'xuanshu/shell-status@0' }))
    expect(resolveShellStatus({ env: envFor(box) })).toMatchObject({ ok: false, reason: 'state-invalid' })
  })

  it('状态文件的 pid 与这次子进程 env 里的壳 pid 对不上（上一次壳硬杀留下的）→ 当作未知', () => {
    const box = scene()
    writeShellStatusFile(shellPaths(box.home).statusFile, buildShellStatus({
      pid: 111,
      autostart: { enabled: true, method: 'shortcut' },
      closeBehavior: 'quit',
      updatedAt: '2026-10-17T00:00:00.000Z',
    }))
    // 这一次的壳是 222：111 那份是上一次留下的，不能当成「现在这个壳」。
    expect(resolveShellStatus({ env: { ...envFor(box), XUANSHU_SHELL_PID: '222' } }))
      .toMatchObject({ ok: false, reason: 'state-invalid' })
    // pid 对得上时照常读（别把正常路径也判死）。
    expect(resolveShellStatus({ env: { ...envFor(box), XUANSHU_SHELL_PID: '111' } }).ok).toBe(true)
  })

  it('干净退出删掉状态文件 → 宿主读不到（不会把「壳已经退出」当成「壳在跑」）', () => {
    const box = scene()
    const file = shellPaths(box.home).statusFile
    writeShellStatusFile(file, buildShellStatus({
      pid: 1,
      autostart: { enabled: false, method: 'unsupported' },
      closeBehavior: 'hide',
      updatedAt: '2026-10-17T00:00:00.000Z',
    }))
    expect(removeShellStatus(file)).toBe(true)
    expect(removeShellStatus(file)).toBe(false)
    expect(resolveShellStatus({ env: envFor(box) })).toMatchObject({ ok: false, reason: 'state-missing' })
  })
})

describe('P1 · 假适配器：壳写下的 method 是**实际生效**的那条路，不是设置里想要的值', () => {
  /** 假 Electron 自启适配器：登录项被系统拒绝 → 回退快捷方式（真机常见形态之一）。 */
  function fakeAdapter({ loginWorks = false, shortcutWorks = true } = {}) {
    const calls = []
    return {
      calls,
      adapter: {
        platform: 'win32',
        loginItem: {
          isAvailable: () => true,
          set: (enabled) => {
            calls.push(['login-set', enabled])
            if (!loginWorks) throw new Error('registry denied')
          },
          get: () => ({ enabled: loginWorks }),
        },
        shortcut: {
          isAvailable: () => shortcutWorks,
          exists: () => shortcutWorks,
          write: (enabled) => {
            calls.push(['shortcut-write', enabled])
            if (!shortcutWorks) throw new Error('startup folder denied')
          },
        },
      },
    }
  }

  it('设置里 autostart:true，登录项不可用 → 状态文件里的 method 是 shortcut、enabled 来自回读', () => {
    const box = scene('shell-status-fake')
    const { adapter, calls } = fakeAdapter({ loginWorks: false, shortcutWorks: true })
    const autostart = createAutostart({ ...adapter, target: 'C:/app/xuanshu.exe', logger: { warn() {} } })
    const effective = autostart.apply(true)
    expect(calls).toContainEqual(['login-set', true])
    expect(calls).toContainEqual(['shortcut-write', true])

    const file = shellPaths(box.home).statusFile
    writeShellStatusFile(file, buildShellStatus({
      pid: 99,
      autostart: effective,
      closeBehavior: 'hide',
      updatedAt: '2026-10-17T00:00:00.000Z',
    }))
    const resolved = resolveShellStatus({ env: envFor(box) })
    expect(resolved.ok).toBe(true)
    expect(resolved.status.autostart).toEqual({ enabled: true, method: 'shortcut' })
  })

  it('两条路都写不进去 → method:unsupported、enabled:false（不因为设置里写了 true 就报「已开」）', () => {
    const box = scene('shell-status-unsupported')
    const { adapter } = fakeAdapter({ loginWorks: false, shortcutWorks: false })
    const autostart = createAutostart({ ...adapter, target: 'C:/app/xuanshu.exe', logger: { warn() {} } })
    const effective = autostart.apply(true)
    const file = shellPaths(box.home).statusFile
    writeShellStatusFile(file, buildShellStatus({
      pid: 99,
      autostart: effective,
      closeBehavior: 'hide',
      updatedAt: '2026-10-17T00:00:00.000Z',
    }))
    expect(resolveShellStatus({ env: envFor(box) }).status.autostart).toEqual({ enabled: false, method: 'unsupported' })
  })
})
