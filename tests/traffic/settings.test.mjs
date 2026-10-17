/**
 * #24 · 共享设置文件（冻结契约 §5）与 `traffic.settings.*` / `shell.settings.*` 两个 RPC 面。
 *
 * 设置不是第二条 IPC：壳读、宿主写，**文件是唯一权威**（契约 §5）。这一组钉：
 *   1. 文件缺失 = 全部默认值（不报错）；
 *   2. 写入后落 `<dataDir>/shell-settings.json`，schema `xuanshu/shell-settings@1`，
 *      且**写后回读**（写坏了不许回「改成了」）；
 *   3. `notifySummary` 是宿主决定「通知正文带不带一句短句」的唯一开关；
 *   4. 非法值**抛**（写操作不许静默）；`traffic.settings.set` 只认 `notifySummary`（#24 的范围）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_SHELL_SETTINGS, SHELL_SETTINGS_SCHEMA, readShellSettings, shellSettingsFile, writeShellSettings,
} from '../../packages/xuanshu-host/lib/notify/settings.mjs'
import { createTrafficMethods } from '../../packages/xuanshu-host/lib/notify/service.mjs'
import { makeScratch } from '../notify/lib/sandbox.mjs'

const boxes = []
afterEach(() => boxes.splice(0).forEach((box) => box.cleanup()))

function scene() {
  const box = makeScratch('traffic-settings')
  boxes.push(box)
  return { box, methods: createTrafficMethods({}, { dataDir: box.dataDir }) }
}

/* ───────────────────────── 1. 设置文件本身 ───────────────────────── */

describe('#24 · shell-settings.json：缺失 = 默认值，写入 = 原子 + 回读', () => {
  it('文件缺失 → 契约 §5 的三个默认值（hide / false / false），不报错', () => {
    const box = makeScratch('traffic-settings')
    boxes.push(box)
    expect(shellSettingsFile(box.dataDir)).toBe(box.path('shell-settings.json'))
    expect(readShellSettings(box.dataDir)).toEqual({ closeBehavior: 'hide', autostart: false, notifySummary: false })
    expect(DEFAULT_SHELL_SETTINGS).toEqual({ closeBehavior: 'hide', autostart: false, notifySummary: false })
  })

  it('写 notifySummary 后文件是契约 §5 的形状（schema + 三键），读回来就是新值', () => {
    const box = makeScratch('traffic-settings')
    boxes.push(box)
    const written = writeShellSettings(box.dataDir, { notifySummary: true })
    expect(written).toEqual({ closeBehavior: 'hide', autostart: false, notifySummary: true })
    expect(box.readJson('shell-settings.json')).toEqual({
      schema: SHELL_SETTINGS_SCHEMA,
      closeBehavior: 'hide',
      autostart: false,
      notifySummary: true,
    })
    expect(readShellSettings(box.dataDir).notifySummary).toBe(true)
    // 部分更新不冲掉别的键。
    expect(writeShellSettings(box.dataDir, { autostart: true })).toEqual({
      closeBehavior: 'hide',
      autostart: true,
      notifySummary: true,
    })
  })

  it('非法值 / schema 不认识 / 文件坏掉 → 写抛；读回默认（不把坏文件当设置）', () => {
    const box = makeScratch('traffic-settings')
    boxes.push(box)
    expect(() => writeShellSettings(box.dataDir, { notifySummary: 'yes' })).toThrow(/notifySummary/u)
    expect(() => writeShellSettings(box.dataDir, { closeBehavior: 'minimize' })).toThrow(/closeBehavior/u)
    expect(() => writeShellSettings(box.dataDir, { autostart: 1 })).toThrow(/autostart/u)
    box.write('shell-settings.json', '{"schema":"xuanshu/shell-settings@0","notifySummary":true}')
    expect(readShellSettings(box.dataDir)).toEqual(DEFAULT_SHELL_SETTINGS)
  })
})

/* ───────────────────────── 2. RPC 面 ───────────────────────── */

describe('#24 · traffic.settings.*：只认 notifySummary（#24 的范围）', () => {
  it('get 缺省给 false；set 写共享设置文件，两项互相独立', async () => {
    const { box, methods } = scene()
    expect(await methods['traffic.settings.get']({})).toEqual({ notifySummary: false })
    expect(await methods['traffic.settings.set']({ notifySummary: true })).toEqual({ notifySummary: true })
    expect(await methods['traffic.settings.get']({})).toEqual({ notifySummary: true })
    expect(box.readJson('shell-settings.json').schema).toBe(SHELL_SETTINGS_SCHEMA)
    // 这个 RPC 不改 #24 范围之外的键。
    expect(box.readJson('shell-settings.json')).toMatchObject({ closeBehavior: 'hide', autostart: false })
  })

  it('set 给非法值 → 抛（RPC 层折成 {ok:false,error}，不许静默改错）', async () => {
    const { methods } = scene()
    await expect(methods['traffic.settings.set']({ notifySummary: 'true' })).rejects.toThrow(/notifySummary/u)
  })
})

describe('#24 · shell.settings.*：契约 §5 点名的宿主半边（加性）', () => {
  it('get / set 三个键都在，且写的是同一个文件', async () => {
    const { box, methods } = scene()
    expect(await methods['shell.settings.get']({})).toEqual({ closeBehavior: 'hide', autostart: false, notifySummary: false })
    expect(await methods['shell.settings.set']({ closeBehavior: 'quit', autostart: true, notifySummary: false })).toEqual({
      closeBehavior: 'quit',
      autostart: true,
      notifySummary: false,
    })
    expect(box.readJson('shell-settings.json')).toMatchObject({ closeBehavior: 'quit', autostart: true })
    expect(await methods['shell.settings.get']({})).toEqual({ closeBehavior: 'quit', autostart: true, notifySummary: false })
  })
})

describe('#24 · traffic.status / traffic.markRead 两个 RPC', () => {
  it('status 缺省摘要，markRead 回 {ok:true, updated}', async () => {
    const { methods } = scene()
    const empty = await methods['traffic.status']({})
    expect(empty).toEqual({ entries: [], unread: 0 })
    expect(await methods['traffic.markRead']({ ids: [] })).toEqual({ ok: true, updated: 0 })
  })

  it('limit 透传到读面（entries 截断，unread 不变）', async () => {
    const { box, methods } = scene()
    const { appendTraffic, buildTrafficEntry } = await import('../../packages/xuanshu-host/lib/notify/traffic.mjs')
    for (const date of ['2026-10-16', '2026-10-17']) {
      appendTraffic(box.dataDir, buildTrafficEntry({
        kind: 'rikke',
        date,
        occurrenceAt: `${date}T00:00:00.000Z`,
        generated: true,
        artifactPath: `rikke/${date}.json`,
        notify: { status: 'delivered', reason: null },
        at: `${date}T00:00:01.000Z`,
      }))
    }
    const answered = await methods['traffic.status']({ limit: 1 })
    expect(answered.entries).toHaveLength(1)
    expect(answered.entries[0].date).toBe('2026-10-17')
    expect(answered.unread).toBe(2)
  })
})
