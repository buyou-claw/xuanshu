/**
 * #24 · 日课 AI 段的开关文件（`<dataDir>/rikke-settings.json`，schema `xuanshu/rikke-settings@1`）。
 *
 * 这是「AI 段可关」的唯一权威（契约 §3 的 `{aiEnabled:boolean}`）：文件缺失 = 默认开。
 * 它**不是**共享的 `shell-settings.json` —— 那是壳/宿主共用的一层（`notifySummary` / 关窗行为），
 * 而「日课要不要 AI 段」是宿主自己的业务设置，写进共享文件会让壳也不得不认识它。
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_RIKKE_SETTINGS, RIKKE_SETTINGS_SCHEMA, readRikkeSettings, rikkeSettingsFile, writeRikkeSettings,
} from '../../packages/xuanshu-host/lib/rikke/settings.mjs'
import { createRikkeMethods } from '../../packages/xuanshu-host/lib/rikke/service.mjs'
import { makeSandbox } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

function scene() {
  const sandbox = makeSandbox('rikke-settings')
  roots.push(sandbox)
  return { sandbox, methods: createRikkeMethods({}, { dataDir: sandbox.dataDir, now: () => new Date('2026-10-15T03:00:00.000Z') }) }
}

describe('#24 · rikke-settings.json：缺失 = 默认开', () => {
  it('文件缺失 → {aiEnabled:true}（默认开），路径与 schema 照契约', () => {
    const { sandbox } = scene()
    expect(rikkeSettingsFile(sandbox.dataDir)).toBe(sandbox.path('rikke-settings.json'))
    expect(DEFAULT_RIKKE_SETTINGS).toEqual({ aiEnabled: true })
    expect(readRikkeSettings(sandbox.dataDir)).toEqual({ aiEnabled: true })
  })

  it('写 false → 文件是 {schema, aiEnabled:false}，读回来就是关', () => {
    const { sandbox } = scene()
    expect(writeRikkeSettings(sandbox.dataDir, { aiEnabled: false })).toEqual({ aiEnabled: false })
    expect(sandbox.readJson('rikke-settings.json')).toEqual({ schema: RIKKE_SETTINGS_SCHEMA, aiEnabled: false })
    expect(sandbox.readJson('rikke-settings.json').schema).toBe('xuanshu/rikke-settings@1')
    expect(readRikkeSettings(sandbox.dataDir)).toEqual({ aiEnabled: false })
  })

  it('坏文件 / schema 不认识 → 回落默认开（坏文件不当设置）；非法写入 → 抛', () => {
    const { sandbox } = scene()
    sandbox.write('rikke-settings.json', '{"schema":"xuanshu/rikke-settings@0","aiEnabled":false}')
    expect(readRikkeSettings(sandbox.dataDir)).toEqual({ aiEnabled: true })
    sandbox.write('rikke-settings.json', '{oops')
    expect(readRikkeSettings(sandbox.dataDir)).toEqual({ aiEnabled: true })
    expect(() => writeRikkeSettings(sandbox.dataDir, { aiEnabled: 'yes' })).toThrow(/aiEnabled/u)
  })

  it('RPC：rikke.settings.get 缺省开；set 落文件并回读', async () => {
    const { sandbox, methods } = scene()
    expect(await methods['rikke.settings.get']({})).toEqual({ aiEnabled: true })
    expect(await methods['rikke.settings.set']({ aiEnabled: false })).toEqual({ aiEnabled: false })
    expect(await methods['rikke.settings.get']({})).toEqual({ aiEnabled: false })
    expect(sandbox.readJson('rikke-settings.json').aiEnabled).toBe(false)
  })

  it('RPC：set 缺 aiEnabled / 值非法 → 抛（RPC 层折成 {ok:false,error}）', async () => {
    const { methods } = scene()
    await expect(methods['rikke.settings.set']({})).rejects.toThrow(/aiEnabled/u)
    await expect(methods['rikke.settings.set']({ aiEnabled: 1 })).rejects.toThrow(/aiEnabled/u)
  })
})
