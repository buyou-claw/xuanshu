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
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { resolve } from 'node:path'

import { collectWanshengFacts } from '../../packages/xuanshu-host/lib/wansheng/facts.mjs'
import { listWorkflows, writeWorkflow } from '../../packages/xuanshu-host/lib/workflow/store.mjs'
import {
  fakeProjectionCache, fakeSessionQuery, fakeWorkspaceRegistry, makeWanshengSandbox, shijiEntry, userEvent,
  writeConsultSession, writeDigaoMeta, writeRikkeArtifact, writeShiji,
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

describe('#25 · 晚省事实：当天有活动的工作流', () => {
  it('续问、创建或导出落在今天都计入；只有历史活动的工作流不计入', async () => {
    const box = scene()
    const sessions = ['renewed', 'created', 'exported', 'old'].map((name) => `session-xs-workflow-${name}`)
    for (const sessionId of sessions) {
      writeWorkflow(box.dataDir, {
        schema: 'xuanshu/workflow@1', id: sessionId, sessionId, name: sessionId,
        createdAt: sessionId.endsWith('-created') ? TODAY_EARLY : YESTERDAY,
        ...(sessionId.endsWith('-exported') ? { exportedAt: '2026-10-15T02:30:00.000Z' } : {}),
      })
    }
    const query = fakeSessionQuery({ headers: Object.fromEntries(sessions.map((id) => [id, {
      createdAt: Date.parse(id.endsWith('-created') ? TODAY_EARLY : YESTERDAY),
    }])) })
    const cache = fakeProjectionCache(Object.fromEntries(sessions.map((id) => [id, {
      lastPromptAt: id.endsWith('-renewed') ? Date.parse('2026-10-15T02:00:00.000Z') : null,
    }])))
    const { facts, notes } = await collectWanshengFacts({
      ctx: { workspaceRegistry: fakeWorkspaceRegistry([]).service, sessionQuery: query.service, sessionProjectionCache: cache.service },
      dataDir: box.dataDir, date: DATE, zone: ZONE,
    })
    expect(facts.activeWorkflows).toEqual([
      { id: sessions[2], title: sessions[2], sessionCount: 0, lastActiveAt: '2026-10-15T02:30:00.000Z' },
      { id: sessions[0], title: sessions[0], sessionCount: 1, lastActiveAt: '2026-10-15T02:00:00.000Z' },
      { id: sessions[1], title: sessions[1], sessionCount: 1, lastActiveAt: TODAY_EARLY },
    ])
    expect(notes).toEqual([])
  })

  it('工作流也会在缺投影时回落人的提问日志', async () => {
    const box = scene()
    const id = 'session-xs-workflow-log'
    writeWorkflow(box.dataDir, { schema: 'xuanshu/workflow@1', id, sessionId: id, name: '续写流程', createdAt: YESTERDAY })
    const query = fakeSessionQuery({
      headers: { [id]: { createdAt: Date.parse(YESTERDAY) } },
      events: { [id]: [userEvent(1, '今天接着做', Date.parse(TODAY_EARLY))] },
    })
    const { facts } = await collectWanshengFacts({
      ctx: { sessionQuery: query.service }, dataDir: box.dataDir, date: DATE, zone: ZONE,
    })
    expect(facts.activeWorkflows).toEqual([{ id, title: '续写流程', sessionCount: 1, lastActiveAt: TODAY_EARLY }])
  })

  it('工作流会话核不了时只省工作流这一路并记原因', async () => {
    const box = scene()
    const id = 'session-xs-workflow-unreadable'
    writeWorkflow(box.dataDir, { schema: 'xuanshu/workflow@1', id, sessionId: id, name: '核不了', createdAt: YESTERDAY })
    const query = fakeSessionQuery({ headers: { [id]: { createdAt: Date.parse(YESTERDAY) } } }).service
    query.readSession = async () => { throw new Error('workflow log denied') }
    const { facts, notes } = await collectWanshengFacts({
      ctx: { workspaceRegistry: fakeWorkspaceRegistry([]).service, sessionQuery: query },
      dataDir: box.dataDir, date: DATE, zone: ZONE,
    })
    expect(Object.hasOwn(facts, 'activeWorkflows')).toBe(false)
    expect(facts.activeWorkspaces).toEqual([])
    expect(notes.join('\n')).toMatch(/工作流.*workflow log denied.*未知/u)
  })

  it('工作流目录读不出来时不报已知空列表', async () => {
    const box = scene()
    box.write('workflow', 'a file instead of a readable directory')
    const { facts, notes } = await collectWanshengFacts({ ctx: {}, dataDir: box.dataDir, date: DATE, zone: ZONE })
    expect(Object.hasOwn(facts, 'activeWorkflows')).toBe(false)
    expect(notes.join('\n')).toMatch(/工作流清单.*未知/u)
  })

  it('逐份工作流坏 JSON 不能变成已知空列表，既有宽松列表保持兼容', async () => {
    const box = scene()
    const filename = 'session-xs-workflow-broken.json'
    box.write(`workflow/${filename}`, '{broken')
    expect(listWorkflows(box.dataDir)).toEqual([])
    const { facts, notes } = await collectWanshengFacts({ ctx: {}, dataDir: box.dataDir, date: DATE, zone: ZONE })
    expect(Object.hasOwn(facts, 'activeWorkflows')).toBe(false)
    expect(notes.join('\n')).toContain(filename)
    expect(notes.join('\n')).toMatch(/工作流清单.*未知/u)
  })

  it.each(['directory', 'manifest'])('工作流 %s 瞬时读错时省略事实并可读报错', async (operation) => {
    const box = scene()
    const id = 'session-xs-workflow-unreadable-file'
    writeWorkflow(box.dataDir, { schema: 'xuanshu/workflow@1', id, sessionId: id, name: '暂不可读', createdAt: YESTERDAY })
    const dir = resolve(box.path('workflow'))
    const file = resolve(box.path('workflow', `${id}.json`))
    const originalRead = fs.readFileSync
    const originalList = fs.readdirSync
    const originalExists = fs.existsSync
    fs.existsSync = (path) => operation === 'directory' && resolve(String(path)) === dir ? false : originalExists(path)
    fs.readdirSync = function (path, ...args) {
      if (operation === 'directory' && resolve(String(path)) === dir) throw Object.assign(new Error('fixture directory denied'), { code: 'EACCES' })
      return originalList.call(this, path, ...args)
    }
    fs.readFileSync = function (path, ...args) {
      if (operation === 'manifest' && resolve(String(path)) === file) throw Object.assign(new Error('fixture manifest denied'), { code: 'EACCES' })
      return originalRead.call(this, path, ...args)
    }
    syncBuiltinESMExports()
    try {
      const { facts, notes } = await collectWanshengFacts({ ctx: {}, dataDir: box.dataDir, date: DATE, zone: ZONE })
      expect(Object.hasOwn(facts, 'activeWorkflows')).toBe(false)
      expect(notes.join('\n')).toMatch(/工作流清单.*未知/u)
      expect(notes.join('\n')).toContain(operation === 'manifest' ? `${id}.json` : 'fixture directory denied')
    } finally {
      fs.readFileSync = originalRead
      fs.readdirSync = originalList
      fs.existsSync = originalExists
      syncBuiltinESMExports()
    }
  })

  it('合法空目录是已知没有工作流，不需要会话服务也不报未知', async () => {
    const box = scene()
    fs.mkdirSync(box.path('workflow'), { recursive: true })
    const { facts, notes } = await collectWanshengFacts({ ctx: {}, dataDir: box.dataDir, date: DATE, zone: ZONE })
    expect(facts.activeWorkflows).toEqual([])
    expect(notes.join('\n')).not.toContain('工作流')
  })
})

describe('#25 · 晚省事实：项目活动、底稿/日课/事记的时间', () => {
  it('工作区按 header.createdAt 与投影 lastPromptAt 的最大值落在今天 → 只留有活动的项目', async () => {
    const box = scene()
    const registry = fakeWorkspaceRegistry([
      { id: 'w1', path: '/work/xuanshu', title: 'XuanShu', sessionIds: ['s-a', 's-b'], createdAt: '2026-10-01T00:00:00.000Z' },
      { id: 'w2', path: '/work/yesterday', title: '昨天项目', sessionIds: ['s-c'], createdAt: '2026-10-01T00:00:00.000Z' },
    ])
    const query = fakeSessionQuery({
      headers: {
        's-a': { createdAt: Date.parse(TODAY_EARLY) },
        's-b': { createdAt: Date.parse(YESTERDAY) },
        's-c': { createdAt: Date.parse(YESTERDAY) },
      },
    })
    // 钉版 SessionHeader 没有 lastPromptAt；它属于 sessionListMetadata 投影。
    // 夹具必须走真实字段，否则旧实现读 header.lastPromptAt 也能绿（review-checklist §2）。
    const cache = fakeProjectionCache({
      's-a': { lastPromptAt: null },
      's-b': { lastPromptAt: Date.parse('2026-10-15T02:30:00.000Z') },
      's-c': { lastPromptAt: Date.parse(YESTERDAY) },
    })
    writeDigaoMeta(box.dataDir)
    writeRikkeArtifact(box.dataDir, { date: DATE })
    writeShiji(box.dataDir, [
      shijiEntry({ id: 'shiji-a', refId: 'w1', lastActiveAt: '2026-10-14T22:00:00.000Z' }),
      shijiEntry({ id: 'shiji-b', refId: 'w2', lastActiveAt: '2026-10-15T01:00:00.000Z' }),
    ])

    const { facts, notes } = await collectWanshengFacts({
      ctx: { workspaceRegistry: registry.service, sessionQuery: query.service, sessionProjectionCache: cache.service },
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

  it.each(['absent', 'metadata-missing', 'throws'])('投影 %s 时回落日志，只数人的提问时刻', async (mode) => {
    const box = scene()
    const registry = fakeWorkspaceRegistry([{ id: 'w1', title: '续问项目', sessionIds: ['s-a'] }])
    const query = fakeSessionQuery({
      headers: { 's-a': { createdAt: Date.parse(YESTERDAY) } },
      events: { 's-a': [
        userEvent(1, '今天接着做', Date.parse(TODAY_EARLY)),
        { ...userEvent(2, '自动注入的内容', Date.parse('2026-10-16T02:00:00.000Z')), data: { source: { kind: 'schedule' } } },
      ] },
    })
    const cache = mode === 'absent' ? undefined : mode === 'throws'
      ? { cachedSnapshot() { throw new Error('cache temporarily unavailable') } }
      : fakeProjectionCache({ 's-a': { title: '只有标题，没有活动投影' } }).service
    const { facts, notes } = await collectWanshengFacts({
      ctx: { workspaceRegistry: registry.service, sessionQuery: query.service, sessionProjectionCache: cache },
      dataDir: box.dataDir, date: DATE, zone: ZONE,
    })
    expect(facts.activeWorkspaces).toEqual([{
      id: 'w1', title: '续问项目', sessionCount: 1, lastActiveAt: TODAY_EARLY,
    }])
    expect(notes).toEqual([])
  })

  it('投影明确 lastPromptAt:null 是已知无提问，不能拿 header 的伪字段当活动', async () => {
    const box = scene()
    const registry = fakeWorkspaceRegistry([{ id: 'w1', title: '没有提问', sessionIds: ['s-a'] }])
    const query = fakeSessionQuery({ headers: { 's-a': { createdAt: Date.parse(YESTERDAY), lastPromptAt: Date.parse(TODAY_EARLY) } } })
    const cache = fakeProjectionCache({ 's-a': { lastPromptAt: null } })
    const { facts } = await collectWanshengFacts({
      ctx: { workspaceRegistry: registry.service, sessionQuery: query.service, sessionProjectionCache: cache.service },
      dataDir: box.dataDir, date: DATE, zone: ZONE,
    })
    expect(facts.activeWorkspaces).toEqual([])
  })

  it('一场日志读失败时省略整个项目活动事实并留原因，不发布不完整的空列表', async () => {
    const box = scene()
    const registry = fakeWorkspaceRegistry([{ id: 'w1', title: '核不了', sessionIds: ['s-a'] }])
    const query = fakeSessionQuery({ headers: { 's-a': { createdAt: Date.parse(YESTERDAY) } } }).service
    query.readSession = async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) }
    const { facts, notes } = await collectWanshengFacts({
      ctx: { workspaceRegistry: registry.service, sessionQuery: query }, dataDir: box.dataDir, date: DATE, zone: ZONE,
    })
    expect(Object.hasOwn(facts, 'activeWorkspaces')).toBe(false)
    expect(notes.join('\n')).toMatch(/s-a.*denied.*未知/u)
  })

  it('会话清单返回非数组时按未知处理，不能折算成已知没有活动', async () => {
    const box = scene()
    const registry = fakeWorkspaceRegistry([{ id: 'w1', title: '核不了', sessionIds: ['s-a'] }])
    const { facts, notes } = await collectWanshengFacts({
      ctx: { workspaceRegistry: registry.service, sessionQuery: { listSessions: async () => ({}) } },
      dataDir: box.dataDir, date: DATE, zone: ZONE,
    })
    expect(Object.hasOwn(facts, 'activeWorkspaces')).toBe(false)
    expect(notes.join('\n')).toMatch(/会话清单.*数组.*未知/u)
  })

  /* ── 复核 (c)①：事记读失败曾被空 `catch {}` 吞掉（省键但没有原因） ── */

  it('事记账本读不出来（EISDIR）→ 省略 shiji 键并写明原因，晚省其余事实仍可用', async () => {
    const box = scene()
    // 让 `shiji.jsonl` 是个目录：`readFileSync` 抛 EISDIR（不是 ENOENT，属于「读失败」而不是「没有账本」）。
    fs.mkdirSync(box.path('shiji.jsonl'), { recursive: true })
    writeConsultSession(box.dataDir, { sessionId: 'session-xs-consult-a', createdAt: TODAY_EARLY })

    const { facts, notes } = await collectWanshengFacts({ ctx: {}, dataDir: box.dataDir, date: DATE, zone: ZONE })
    expect(Object.hasOwn(facts, 'shiji'), '读不出来时必须省略整个键（不编空对象/0）').toBe(false)
    const joined = notes.join('\n')
    expect(joined, '空 catch 吞掉了原因：用户不知道「事记这一路为什么没出现」').toMatch(/事记.*读不出来/u)
    expect(joined).toMatch(/本轮不展示事记/u)
    // 单路失败不拖垮整轮：问事这一路照常（今天那场照常计数）。
    expect(facts.consultSessions.count).toBe(1)
  })

  it('事记账本权限失败（EACCES）同样只降级这一路并留原因', async () => {
    const box = scene()
    writeShiji(box.dataDir, [shijiEntry({ id: 'shiji-a', refId: 'w1' })])
    const file = resolve(box.path('shiji.jsonl'))
    const originalRead = fs.readFileSync
    fs.readFileSync = function (path, ...args) {
      if (resolve(String(path)) === file) throw Object.assign(new Error('fixture ledger denied'), { code: 'EACCES' })
      return originalRead.call(this, path, ...args)
    }
    syncBuiltinESMExports()
    try {
      const { facts, notes } = await collectWanshengFacts({ ctx: {}, dataDir: box.dataDir, date: DATE, zone: ZONE })
      expect(Object.hasOwn(facts, 'shiji')).toBe(false)
      expect(notes.join('\n')).toMatch(/事记.*fixture ledger denied/u)
    } finally {
      fs.readFileSync = originalRead
      syncBuiltinESMExports()
    }
  })
})
