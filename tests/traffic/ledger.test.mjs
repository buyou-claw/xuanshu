/**
 * #24 · 触达账（冻结契约 §4）——append-only JSONL。
 *
 * 账是「推没推成」的**唯一权威**（`schedule.lastDelivery` 只记「进过 inbox」，不记通知成没成）。
 * 这一组钉：
 *   1. 一次投递尝试 = 一行，行形状逐字照契约 §4（`xuanshu/traffic@1`）；
 *   2. 读面**最新在前**、坏行跳过不炸、`unread` = `notify.status==='delivered' && read!==true` 的条数、
 *      `lastFailure` = 最近一条 failed 的 `{at,kind,reason}`；
 *   3. `markRead({ids})` 只改 `read`，**不动别的行、不重排、不丢坏行**；
 *   4. 文件缺失不是错误（没投过 = 空账），且**不写 `lastFailure`**（不编 0/false 冒充）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  TRAFFIC_SCHEMA, appendTraffic, buildTrafficEntry, markTrafficRead, readTraffic, trafficFile,
} from '../../packages/xuanshu-host/lib/notify/traffic.mjs'
import { makeScratch } from '../notify/lib/sandbox.mjs'

const boxes = []
afterEach(() => boxes.splice(0).forEach((box) => box.cleanup()))

function box(label = 'traffic') {
  const scratch = makeScratch(label)
  boxes.push(scratch)
  return scratch
}

/** 契约 §4 的一行（宿主写的就是它）。 */
function entry(over = {}) {
  return buildTrafficEntry({
    kind: 'rikke',
    date: '2026-10-17',
    occurrenceAt: '2026-10-16T23:30:00.000Z',
    generated: true,
    artifactPath: 'rikke/2026-10-17.json',
    notify: { status: 'delivered', reason: null },
    at: '2026-10-16T23:30:01.000Z',
    ...over,
  })
}

/* ───────────────────────── 1. 行形状与 append ───────────────────────── */

describe('#24 · 触达账：一行一次投递尝试', () => {
  it('append 之后文件里就是契约 §4 的那一行（schema/id/at/notify/read/missed 都在）', () => {
    const scratch = box()
    const written = appendTraffic(scratch.dataDir, entry())
    const lines = scratch.read('traffic.jsonl').trim().split('\n')
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed).toEqual(written)
    expect(parsed.schema).toBe(TRAFFIC_SCHEMA)
    expect(parsed.schema).toBe('xuanshu/traffic@1')
    expect(parsed.id).toMatch(/^traffic-/u)
    expect(parsed.at).toBe('2026-10-16T23:30:01.000Z')
    expect(parsed.kind).toBe('rikke')
    expect(parsed.date).toBe('2026-10-17')
    expect(parsed.occurrenceAt).toBe('2026-10-16T23:30:00.000Z')
    expect(parsed.generated).toBe(true)
    expect(parsed.artifactPath).toBe('rikke/2026-10-17.json')
    expect(parsed.notify).toEqual({ status: 'delivered', reason: null })
    expect(parsed.read).toBe(false)
    expect(parsed.missed).toBe(false)
    expect(trafficFile(scratch.dataDir)).toBe(scratch.path('traffic.jsonl'))
  })

  it('notify.status 不在取值域里 → 写盘前就抛（账不能记一个不存在的状态）', () => {
    const scratch = box()
    expect(() => appendTraffic(scratch.dataDir, entry({ notify: { status: 'pushed', reason: null } }))).toThrow(/status/u)
    expect(() => appendTraffic(scratch.dataDir, entry({ kind: 'unknown' }))).toThrow()
  })
})

/* ───────────────────────── 2. 读面：最新在前 / unread / lastFailure ───────────────────────── */

describe('#24 · 触达账读面：最新在前 + 未读 + 最近失败', () => {
  it('两条投递 → 最新在前；unread 只数 delivered 且未读（skipped 不算未读）', () => {
    const scratch = box()
    appendTraffic(scratch.dataDir, entry({ at: '2026-10-16T23:30:01.000Z' }))
    appendTraffic(scratch.dataDir, entry({
      at: '2026-10-17T23:30:01.000Z',
      date: '2026-10-18',
      notify: { status: 'skipped', reason: '人点生成' },
    }))
    const ledger = readTraffic(scratch.dataDir)
    expect(ledger.exists).toBe(true)
    expect(ledger.entries.map((row) => row.date)).toEqual(['2026-10-18', '2026-10-17'])
    expect(ledger.unread).toBe(1) // 昨天那条 delivered 未读；今天这条 skipped 不算
    expect(ledger).not.toHaveProperty('lastFailure')
  })

  it('failed 落账之后 lastFailure 给 {at,kind,reason}；且 failed 不计入未读', () => {
    const scratch = box()
    appendTraffic(scratch.dataDir, entry({
      notify: { status: 'failed', reason: '壳回了 500' },
      at: '2026-10-16T23:30:01.000Z',
    }))
    const ledger = readTraffic(scratch.dataDir)
    expect(ledger.lastFailure).toEqual({ at: '2026-10-16T23:30:01.000Z', kind: 'rikke', reason: '壳回了 500' })
    expect(ledger.unread).toBe(0)
  })

  it('坏行跳过不炸；limit 只截 entries，unread 仍按全账算', () => {
    const scratch = box()
    appendTraffic(scratch.dataDir, entry({ at: '2026-10-16T23:30:01.000Z' }))
    appendTraffic(scratch.dataDir, entry({ at: '2026-10-17T23:30:01.000Z', date: '2026-10-18' }))
    scratch.write('traffic.jsonl', scratch.read('traffic.jsonl') + 'not json at all\n')
    const limited = readTraffic(scratch.dataDir, { limit: 1 })
    expect(limited.entries).toHaveLength(1)
    expect(limited.entries[0].date).toBe('2026-10-18')
    expect(limited.unread).toBe(2)
  })

  it('账本不存在 → {entries:[], unread:0, exists:false}（不编 lastFailure）', () => {
    const scratch = box()
    const ledger = readTraffic(scratch.dataDir)
    expect(ledger).toEqual({ entries: [], unread: 0, exists: false })
  })

  it('markRead({ids}) 只改 read：命中几条报几条，别的行原样（坏行也原样留着）', () => {
    const scratch = box()
    const first = appendTraffic(scratch.dataDir, entry({ at: '2026-10-16T23:30:01.000Z' }))
    const second = appendTraffic(scratch.dataDir, entry({ at: '2026-10-17T23:30:01.000Z', date: '2026-10-18' }))
    scratch.write('traffic.jsonl', `${scratch.read('traffic.jsonl')}broken line\n`)

    const result = markTrafficRead(scratch.dataDir, [first.id, 'traffic-does-not-exist'])
    expect(result).toEqual({ ok: true, updated: 1 })

    const lines = scratch.read('traffic.jsonl').trim().split('\n')
    expect(lines.at(-1)).toBe('broken line')
    expect(JSON.parse(lines[0]).read).toBe(true)
    expect(JSON.parse(lines[1]).read).toBe(false)
    expect(JSON.parse(lines[1]).id).toBe(second.id)
    expect(readTraffic(scratch.dataDir).unread).toBe(1)

    // 已读的再点一次不算更新（幂等）。
    expect(markTrafficRead(scratch.dataDir, [first.id])).toEqual({ ok: true, updated: 0 })
  })

  it('markRead 的 ids 不合法 → 抛（写操作不许静默）', () => {
    const scratch = box()
    expect(() => markTrafficRead(scratch.dataDir, 'traffic-1')).toThrow(/ids/u)
    expect(() => markTrafficRead(scratch.dataDir, [123])).toThrow(/ids/u)
  })
})
