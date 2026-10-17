/**
 * 票 05（#26）· 事记的文件契约（契约 §1）
 *
 * 抓的真实缺陷/风险：
 *   ① `shiji.jsonl` 是**一条一行的快照**（整文件原子重写），不是事件流：两行同 id = 账本坏了；
 *   ② 坏行 / 旧 schema 行不许把整份账本读死（坏行报行号，其余照读）；
 *   ③ id 是**确定性**的：重扫同一个 `source+refId` 必须落到同一个 id（否则「一项目一条」靠运气）。
 */
import { describe, expect, it } from 'vitest'

import {
  SHIJI_SCHEMA, SHIJI_SETTINGS_SCHEMA, readShijiEntries, readShijiSettings, shijiExists, shijiFile,
  shijiId, shijiSettingsFile, writeShijiEntries, writeShijiSettings,
} from '../../packages/xuanshu-host/lib/shiji/store.mjs'
import { makeSandbox, readJsonl } from './lib/sandbox.mjs'

function entry(patch = {}) {
  return {
    schema: SHIJI_SCHEMA,
    id: 'shiji-0123456789abcdef',
    source: 'workspace',
    refId: 'w1',
    name: 'XuanShu',
    summary: '在做玄枢。',
    summaryMode: 'llm',
    firstSeenAt: '2026-10-17T00:00:00.000Z',
    lastActiveAt: '2026-10-17T01:00:00.000Z',
    basis: { sessions: 1, docs: 2 },
    fingerprint: 'f'.repeat(64),
    manual: false,
    frozenAt: null,
    excludedAt: null,
    ...patch,
  }
}

describe('票05 · shiji.jsonl 一条一行（整文件原子重写）', () => {
  it('写入两条：文件只有两行、每行一个完整条目、读回来逐字段相同', () => {
    const sandbox = makeSandbox('shiji-store')
    try {
      writeShijiEntries(sandbox.dataDir, [entry(), entry({ id: 'shiji-fedcba9876543210', refId: 'w2', firstSeenAt: '2026-10-16T00:00:00.000Z' })])
      const lines = sandbox.read('shiji.jsonl').split('\n').filter((line) => line !== '')
      expect(lines).toHaveLength(2)
      for (const line of lines) expect(JSON.parse(line).schema).toBe('xuanshu/shiji@1')
      const result = readShijiEntries(sandbox.dataDir)
      expect(result.notes).toEqual([])
      expect(result.entries.map((item) => item.refId).sort()).toEqual(['w1', 'w2'])
    } finally {
      sandbox.cleanup()
    }
  })

  it('整文件重写：第二次写入不会追加出第三条；按 firstSeenAt 稳定排序', () => {
    const sandbox = makeSandbox('shiji-store')
    try {
      writeShijiEntries(sandbox.dataDir, [entry({ id: 'shiji-bbbbbbbbbbbbbbbb', firstSeenAt: '2026-10-15T00:00:00.000Z' })])
      writeShijiEntries(sandbox.dataDir, [entry({ id: 'shiji-aaaaaaaaaaaaaaaa' })])
      const rows = readJsonl(shijiFile(sandbox.dataDir))
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('shiji-aaaaaaaaaaaaaaaa')
      // 排序是稳定、可复现的：老条目在前。
      writeShijiEntries(sandbox.dataDir, [
        entry({ id: 'shiji-cccccccccccccccc', firstSeenAt: '2026-10-17T00:00:00.000Z' }),
        entry({ id: 'shiji-dddddddddddddddd', firstSeenAt: '2026-10-15T00:00:00.000Z' }),
      ])
      expect(readJsonl(shijiFile(sandbox.dataDir)).map((item) => item.id)).toEqual(['shiji-dddddddddddddddd', 'shiji-cccccccccccccccc'])
      // 原子写不留临时件。
      expect(sandbox.read('shiji.jsonl').endsWith('\n')).toBe(true)
      expect(sandbox.exists('shiji.jsonl')).toBe(true)
      expect(shijiExists(sandbox.dataDir)).toBe(true)
      expect(sandbox.files().filter((file) => file.endsWith('.tmp'))).toEqual([])
    } finally {
      sandbox.cleanup()
    }
  })

  it('坏行 / 旧 schema 行跳过并报行号，其余照读（不许整份账本读死）', () => {
    const sandbox = makeSandbox('shiji-store')
    try {
      sandbox.write('shiji.jsonl', [
        JSON.stringify(entry({ refId: 'w1' })),
        '{不是 JSON',
        JSON.stringify({ ...entry({ refId: 'w2' }), schema: 'xuanshu/shiji@0' }),
        '',
        JSON.stringify(entry({ id: 'shiji-1111111111111111', refId: 'w3' })),
      ].join('\n'))
      const result = readShijiEntries(sandbox.dataDir)
      expect(result.entries.map((item) => item.refId)).toEqual(['w1', 'w3'])
      expect(result.notes).toHaveLength(2)
      expect(result.notes[0]).toMatch(/第 2 行/u)
      expect(result.notes[1]).toMatch(/第 3 行/u)
    } finally {
      sandbox.cleanup()
    }
  })

  it('文件不存在时读成空账本（不是错误）', () => {
    const sandbox = makeSandbox('shiji-store')
    try {
      expect(readShijiEntries(sandbox.dataDir)).toEqual({ entries: [], notes: [] })
      expect(shijiExists(sandbox.dataDir)).toBe(false)
    } finally {
      sandbox.cleanup()
    }
  })
})

describe('票05 · id 是确定性的（同 source+refId 永不新增）', () => {
  it('sha256(source\\0refId) 前 16 位；换 source 或 refId 就换 id', () => {
    expect(shijiId('workspace', 'w1')).toBe('shiji-aca7386a043a83a1')
    expect(shijiId('workspace', 'w1')).toBe(shijiId('workspace', 'w1'))
    expect(shijiId('session', 'session-xs-consult-abc')).toBe('shiji-9e652e74a0b9f407')
    expect(shijiId('workspace', 'w2')).not.toBe(shijiId('workspace', 'w1'))
    // source 也参与散列：同名 refId 在两路来源里不是同一条。
    expect(shijiId('workflow', 'w1')).not.toBe(shijiId('workspace', 'w1'))
  })
})

describe('票05 · 事记设置（排除目录，契约 §1）', () => {
  it('缺省 = {excludedDirs: []}；写入后读回同值，落独立文件', () => {
    const sandbox = makeSandbox('shiji-settings')
    try {
      expect(readShijiSettings(sandbox.dataDir)).toEqual({ schema: SHIJI_SETTINGS_SCHEMA, excludedDirs: [] })
      writeShijiSettings(sandbox.dataDir, { excludedDirs: ['docs/private', 'notes/secret/'] })
      expect(readShijiSettings(sandbox.dataDir)).toEqual({ schema: SHIJI_SETTINGS_SCHEMA, excludedDirs: ['docs/private', 'notes/secret'] })
      expect(shijiSettingsFile(sandbox.dataDir)).toBe(sandbox.path('shiji-settings.json'))
      expect(JSON.parse(sandbox.read('shiji-settings.json')).schema).toBe('xuanshu/shiji-settings@1')
    } finally {
      sandbox.cleanup()
    }
  })

  it('坏文件 / 旧 schema → 回到缺省（不因一份坏设置卡死扫描）', () => {
    const sandbox = makeSandbox('shiji-settings')
    try {
      sandbox.write('shiji-settings.json', '{坏')
      expect(readShijiSettings(sandbox.dataDir).excludedDirs).toEqual([])
      sandbox.write('shiji-settings.json', JSON.stringify({ schema: 'xuanshu/shiji-settings@0', excludedDirs: ['docs/private'] }))
      expect(readShijiSettings(sandbox.dataDir).excludedDirs).toEqual([])
    } finally {
      sandbox.cleanup()
    }
  })
})
