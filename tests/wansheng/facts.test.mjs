/**
 * #25 · 晚省的**确定性事实**（冻结契约 §1）：今天几场问事、哪些项目有活动、底稿/日课/事记何时动过。
 *
 * 三条纪律（这一组钉的就是它们）：
 *   1. **只看本地文件 + 注入的服务**：不联网、不调模型（模型调用数在 generate 那一组钉）；
 *   2. **落在当天 = 底座时区里的那一天**：UTC 的「昨天 17:00」在 Asia/Shanghai 是「今天 01:00」，
 *      用 UTC 日期筛会把今天开场次的问事漏掉；
 *   3. **拿不到就省略键**（与 `rikke.status` 同纪律）：工作区/事记读不到时整键不出现，
 *      绝不写 0 / false 冒充「已知为零」。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { collectWanshengFacts } from '../../packages/xuanshu-host/lib/wansheng/facts.mjs'
import {
  fakeSessionQuery, fakeWorkspaceRegistry, makeWanshengSandbox, shijiEntry, writeConsultSession,
  writeDigaoMeta, writeRikkeArtifact, writeShiji,
} from './lib/sandbox.mjs'

const boxes = []
afterEach(() => boxes.splice(0).forEach((box) => box.cleanup()))

const DATE = '2026-10-15'
const ZONE = 'Asia/Shanghai'
/** 本地 2026-10-15 01:00（UTC 还是 14 日）——时区判据的陷阱样本。 */
const TODAY_EARLY = '2026-10-14T17:00:00.000Z'
/** 本地 2026-10-14 10:00（昨天）。 */
const YESTERDAY = '2026-10-14T02:00:00.000Z'

function scene() {
  const box = makeWanshengSandbox('wansheng-facts')
  boxes.push(box)
  return box
}

describe('#25 · 晚省事实：问事的「今天」按底座时区算（会话级）', () => {
  it('今天 2 场（含一场昨天开、今天还在问）+ 昨天 1 场 → 计数 2，且带 lastTurnAt', async () => {
    const box = scene()
    // 今天开的场
    writeConsultSession(box.dataDir, { sessionId: 'session-xs-consult-a', createdAt: TODAY_EARLY, title: '先收口' })
    // 昨天开、今天还在问：`lastTurnAt` 落在今天 → 今天有活动
    writeConsultSession(box.dataDir, {
      sessionId: 'session-xs-consult-b', createdAt: YESTERDAY, lastTurnAt: '2026-10-15T02:00:00.000Z', title: '续问',
    })
    // 昨天的场：两边都不在今天
    writeConsultSession(box.dataDir, { sessionId: 'session-xs-consult-c', createdAt: YESTERDAY, title: '昨天的事' })

    // 这一组只关心问事那一路；工作区缺席的降级在下面单独钉。
    const { facts } = await collectWanshengFacts({ ctx: {}, dataDir: box.dataDir, date: DATE, zone: ZONE })
    expect(facts.consultSessions.count).toBe(2)
    expect(facts.consultSessions.items.map((item) => item.sessionId).sort()).toEqual([
      'session-xs-consult-a',
      'session-xs-consult-b',
    ])
    const renewed = facts.consultSessions.items.find((item) => item.sessionId === 'session-xs-consult-b')
    expect(renewed.lastTurnAt).toBe('2026-10-15T02:00:00.000Z')
    expect(renewed.title).toBe('续问')
    // 昨天那场不许混进来（否则「今天几场」就成了「一共几场」）。
    expect(facts.consultSessions.items.some((item) => item.sessionId === 'session-xs-consult-c')).toBe(false)
  })

  it('一场都没有 → count 0（这是真的零，不是「拿不到」）', async () => {
    const box = scene()
    const { facts } = await collectWanshengFacts({ ctx: {}, dataDir: box.dataDir, date: DATE, zone: ZONE })
    expect(facts.consultSessions).toEqual({ count: 0, items: [] })
  })
})

describe('#25 · 晚省事实：项目活动、底稿/日课/事记的时间', () => {
  it('工作区按会话 header 的 max(createdAt, lastPromptAt) 落在今天 → 只留有活动的项目', async () => {
    const box = scene()
    const registry = fakeWorkspaceRegistry([
      { id: 'w1', path: '/work/xuanshu', title: 'XuanShu', sessionIds: ['s-a', 's-b'], createdAt: '2026-10-01T00:00:00.000Z' },
      { id: 'w2', path: '/work/yesterday', title: '昨天项目', sessionIds: ['s-c'], createdAt: '2026-10-01T00:00:00.000Z' },
    ])
    const query = fakeSessionQuery({
      headers: {
        's-a': { createdAt: Date.parse(TODAY_EARLY) },
        's-b': { createdAt: Date.parse(YESTERDAY), lastPromptAt: Date.parse('2026-10-15T02:30:00.000Z') },
        's-c': { createdAt: Date.parse(YESTERDAY), lastPromptAt: Date.parse(YESTERDAY) },
      },
    })
    writeDigaoMeta(box.dataDir)
    writeRikkeArtifact(box.dataDir, { date: DATE })
    writeShiji(box.dataDir, [
      shijiEntry({ id: 'shiji-a', refId: 'w1', lastActiveAt: '2026-10-14T22:00:00.000Z' }),
      shijiEntry({ id: 'shiji-b', refId: 'w2', lastActiveAt: '2026-10-15T01:00:00.000Z' }),
    ])

    const { facts, notes } = await collectWanshengFacts({
      ctx: { workspaceRegistry: registry.service, sessionQuery: query.service },
      dataDir: box.dataDir,
      date: DATE,
      zone: ZONE,
    })
    expect(notes).toEqual([])
    // 只有 w1 今天有活动（s-a 今天创建、s-b 今天说过话）；w2 的会话停在昨天。
    expect(facts.activeWorkspaces).toEqual([{
      id: 'w1',
      title: 'XuanShu',
      sessionCount: 2,
      lastActiveAt: '2026-10-15T02:30:00.000Z',
    }])
    expect(facts.digao).toEqual({ generatedAt: '2026-10-15T03:00:00.000Z' })
    expect(facts.rikke).toEqual({ generatedAt: '2026-10-15T03:00:00.000Z' })
    // 事记只取最新一次活跃（不展开条目）。
    expect(facts.shiji).toEqual({ updatedAt: '2026-10-15T01:00:00.000Z' })
  })

  it('拿不到就**省略键**：没有工作区/会话服务、没有底稿、没有日课、没有事记 → 四个键都不出现', async () => {
    const box = scene()
    writeConsultSession(box.dataDir, { sessionId: 'session-xs-consult-a', createdAt: TODAY_EARLY })

    const { facts, notes } = await collectWanshengFacts({ ctx: {}, dataDir: box.dataDir, date: DATE, zone: ZONE })
    expect(facts.consultSessions.count).toBe(1)
    expect(Object.hasOwn(facts, 'activeWorkspaces')).toBe(false)
    expect(Object.hasOwn(facts, 'digao')).toBe(false)
    expect(Object.hasOwn(facts, 'rikke')).toBe(false)
    expect(Object.hasOwn(facts, 'shiji')).toBe(false)
    // 降级原因要写出来（「未知」不是「没有」）。
    expect(notes.join('\n')).toMatch(/workspaceRegistry|工作区/u)
  })

  it('工作区在但会话服务缺席 → 省 activeWorkspaces 并说明（不把「核不了」写成 0 个项目）', async () => {
    const box = scene()
    const registry = fakeWorkspaceRegistry([{ id: 'w1', path: '/work/x', title: 'X', sessionIds: ['s-a'] }])
    const { facts, notes } = await collectWanshengFacts({
      ctx: { workspaceRegistry: registry.service }, dataDir: box.dataDir, date: DATE, zone: ZONE,
    })
    expect(Object.hasOwn(facts, 'activeWorkspaces')).toBe(false)
    expect(notes.join('\n')).toMatch(/sessionQuery|会话/u)
  })
})
