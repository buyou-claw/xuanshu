/**
 * 票 05（#26）· 事记 RPC（契约 §1/§2）
 *
 * 独立方法组 `createShijiMethods()`（**不塞进 `createDigaoMethods()`** —— 那边的方法名被全量钉住）。
 * 判据：
 *   - `shiji.list` 默认不含墓碑、按 `lastActiveAt` 倒序；`includeDeleted` 才看得到墓碑；
 *   - 写操作（remove / restore / fromSession）一律要 `confirmed === true`，失败回**可读** `{ok:false,error}`；
 *   - `fromSession` 只处理玄枢自铸问事会话：摘要来自会话文本历史；LLM 不可用 → `summary-unavailable`
 *     **且一个字节都不写**（不写空条目、不编摘要）；同 refId 更新不新增。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createConsultStore } from '../../packages/xuanshu-host/lib/consult/store.mjs'
import { scanAndUpdateShiji } from '../../packages/xuanshu-host/lib/shiji/ledger.mjs'
import { createShijiMethods } from '../../packages/xuanshu-host/lib/shiji/service.mjs'
import { writeWorkflow } from '../../packages/xuanshu-host/lib/workflow/store.mjs'
import {
  assistantEvent, fakeLlm, fakeProjectionCache, fakeSessionQuery, fakeWorkspaceRegistry, makeCtx, makeSandbox, readJsonl, seedProject, userEvent,
} from './lib/sandbox.mjs'

const NOW = new Date('2026-10-17T03:30:00.000Z')
const PROMPT_AT = Date.parse('2026-10-16T12:00:00.000Z')
const CONSULT_SESSION = 'session-xs-consult-abc'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 一个已扫描过的工作区现场（+ 可选 LLM）。 */
async function scannedScene({ llm = null } = {}) {
  const sandbox = makeSandbox('shiji-rpc')
  roots.push(sandbox)
  const projectRoot = seedProject(sandbox, 'xuan', { docs: { 'README.md': '# XuanShu\n在做玄枢。', 'docs/shiji.md': '# 事记\n' } })
  const dshHome = sandbox.rootPath('home')
  sandbox.writeRoot('home/skills/weekly/SKILL.md', '---\nname: weekly\ndescription: 周报\n---\n\n把周报自动化。\n')
  writeWorkflow(sandbox.dataDir, {
    schema: 'xuanshu/workflow@1',
    id: 'wf1',
    name: '把周报自动化',
    sessionId: 'session-xs-workflow-wf1',
    cwd: sandbox.path('workflow'),
    seed: '把周报自动化',
    createdAt: '2026-10-15T00:00:00.000Z',
    skillName: 'weekly',
    exportedAt: '2026-10-16T03:00:00.000Z',
  })
  const registry = fakeWorkspaceRegistry([{ id: 'w1', path: projectRoot, title: 'XuanShu', createdAt: '2026-10-10T00:00:00.000Z', sessionIds: ['s1'] }])
  const query = fakeSessionQuery({
    headers: { s1: { createdAt: Date.parse('2026-10-01T00:00:00.000Z') } },
    events: { s1: [userEvent(1, '事记怎么接？', PROMPT_AT)] },
    titles: { s1: '事记怎么接' },
  })
  const cache = fakeProjectionCache({ s1: { title: '事记怎么接', lastPromptAt: PROMPT_AT } })
  const services = { workspaceRegistry: registry.service, sessionQuery: query.service, sessionProjectionCache: cache.service }
  if (llm !== null) services.llm = llm
  const ctx = makeCtx({ services })
  await scanAndUpdateShiji({ ctx, dataDir: sandbox.dataDir, dshHome, now: NOW })
  return { sandbox, ctx, dshHome, query, cache, llm }
}

describe('票05 · 方法组是独立的一组（契约 §1）', () => {
  it('恰好六个方法：list / remove / restore / fromSession / settings.get / settings.set', () => {
    const methods = createShijiMethods(makeCtx(), { dataDir: 'E:\\tmp\\xuanshu' })
    expect(Object.keys(methods).sort()).toEqual([
      'shiji.fromSession', 'shiji.list', 'shiji.remove', 'shiji.restore', 'shiji.settings.get', 'shiji.settings.set',
    ])
    // 没有 write/update 这类「手改事记」的方法：事记只可删、不可改。
    for (const key of Object.keys(methods)) expect(key).toMatch(/^shiji\.(list|remove|restore|fromSession|settings\.(get|set))$/u)
  })
})

describe('票05 · shiji.list', () => {
  it('按 lastActiveAt 倒序；默认不含墓碑，includeDeleted 才看得到；没有 notes 就省略该键', async () => {
    const target = await scannedScene({ llm: fakeLlm({ text: '摘要。' }) })
    const methods = createShijiMethods(target.ctx, { dataDir: target.sandbox.dataDir, dshHome: target.dshHome })
    const listed = await methods['shiji.list']({})
    expect(listed.entries.map((entry) => entry.source)).toEqual(['workspace', 'workflow'])
    expect(listed.entries[0].lastActiveAt).toBe('2026-10-16T12:00:00.000Z')
    expect(listed.entries[1].lastActiveAt).toBe('2026-10-16T03:00:00.000Z')
    expect(Object.hasOwn(listed, 'notes')).toBe(false)

    const workspace = listed.entries[0]
    await methods['shiji.remove']({ id: workspace.id, confirmed: true })
    expect((await methods['shiji.list']({})).entries.map((entry) => entry.source)).toEqual(['workflow'])
    expect((await methods['shiji.list']({ includeDeleted: true })).entries.map((entry) => entry.source)).toEqual(['workspace', 'workflow'])
  })
})

describe('票05 · 写操作的人确认闸门（confirmed === true）', () => {
  it('remove / restore / fromSession 少 confirmed → confirmation-required，且账本一个字节不变', async () => {
    const target = await scannedScene()
    const methods = createShijiMethods(target.ctx, { dataDir: target.sandbox.dataDir, dshHome: target.dshHome })
    const before = target.sandbox.read('shiji.jsonl')
    const entry = readJsonl(target.sandbox.path('shiji.jsonl'))[0]

    for (const call of [
      () => methods['shiji.remove']({ id: entry.id }),
      () => methods['shiji.restore']({ id: entry.id }),
      () => methods['shiji.fromSession']({ sessionId: CONSULT_SESSION }),
    ]) {
      const result = await call()
      expect(result.ok).toBe(false)
      expect(result.error.code).toBe('confirmation-required')
    }
    expect(target.sandbox.read('shiji.jsonl')).toBe(before)
  })

  it('remove/restore 不存在的 id → not-found（可读）', async () => {
    const target = await scannedScene()
    const methods = createShijiMethods(target.ctx, { dataDir: target.sandbox.dataDir, dshHome: target.dshHome })
    expect(await methods['shiji.remove']({ id: 'shiji-ffffffffffffffff', confirmed: true })).toMatchObject({ ok: false, error: { code: 'not-found' } })
    expect(await methods['shiji.restore']({ id: 'shiji-ffffffffffffffff', confirmed: true })).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })

  it('remove → 墓碑；rescan 不重建；restore → 下一轮扫描重新出现（同 id）', async () => {
    const target = await scannedScene()
    const methods = createShijiMethods(target.ctx, { dataDir: target.sandbox.dataDir, dshHome: target.dshHome })
    const entry = (await methods['shiji.list']({})).entries.find((item) => item.source === 'workspace')

    const removed = await methods['shiji.remove']({ id: entry.id, confirmed: true })
    expect(removed).toMatchObject({ ok: true, entry: { excludedAt: expect.any(String) } })
    await scanAndUpdateShiji({ ctx: target.ctx, dataDir: target.sandbox.dataDir, dshHome: target.dshHome, now: new Date('2026-10-18T03:30:00.000Z') })
    expect(readJsonl(target.sandbox.path('shiji.jsonl')).filter((item) => item.source === 'workspace')).toHaveLength(1)

    const restored = await methods['shiji.restore']({ id: entry.id, confirmed: true })
    expect(restored).toMatchObject({ ok: true, entry: { excludedAt: null } })
    await scanAndUpdateShiji({ ctx: target.ctx, dataDir: target.sandbox.dataDir, dshHome: target.dshHome, now: new Date('2026-10-19T03:30:00.000Z') })
    const workspace = readJsonl(target.sandbox.path('shiji.jsonl')).filter((item) => item.source === 'workspace')
    expect(workspace).toHaveLength(1)
    expect(workspace[0].id).toBe(entry.id)
    expect(workspace[0].excludedAt).toBeNull()
  })
})

describe('票05 · shiji.settings', () => {
  it('get 缺省 []; set 落盘并可读；非法输入回可读错误且不改原文件', async () => {
    const target = await scannedScene()
    const methods = createShijiMethods(target.ctx, { dataDir: target.sandbox.dataDir, dshHome: target.dshHome })
    expect(await methods['shiji.settings.get']({})).toEqual({ excludedDirs: [] })

    const set = await methods['shiji.settings.set']({ excludedDirs: ['docs/private', 'notes/secret/'] })
    expect(set).toEqual({ ok: true, excludedDirs: ['docs/private', 'notes/secret'] })
    expect(await methods['shiji.settings.get']({})).toEqual({ excludedDirs: ['docs/private', 'notes/secret'] })

    const before = target.sandbox.read('shiji-settings.json')
    const bad = await methods['shiji.settings.set']({ excludedDirs: ['E:\\secret'] })
    expect(bad.ok).toBe(false)
    expect(bad.error.code).toBe('invalid-settings')
    expect(bad.error.message).toMatch(/相对/u)
    expect(target.sandbox.read('shiji-settings.json')).toBe(before)
  })
})

describe('票05 · shiji.fromSession（契约 §2：只处理问事会话 + 人工确认）', () => {
  /** 登记一个玄枢问事会话（旁挂清单 + 会话日志）。 */
  function seedConsult(target) {
    const store = createConsultStore(target.sandbox.dataDir)
    store.create({ sessionId: CONSULT_SESSION, createdAt: NOW.toISOString() })
    store.update(CONSULT_SESSION, { title: '事记怎么接进底稿' })
    target.query.service.readSession = async (sessionId) => {
      target.query.calls.push({ method: 'readSession', sessionId })
      return {
        session: { id: sessionId, version: 4 },
        inheritedEventCount: 0,
        events: [
          userEvent(1, '事记怎么接进底稿？', PROMPT_AT - 10),
          assistantEvent(2, '在 refreshDigao 之前先扫一遍，写 shiji.jsonl。', PROMPT_AT),
        ],
      }
    }
  }

  it('正常：LLM 摘要成功 → 写一条 source:session / manual:true 的事记（name=会话标题）', async () => {
    const llm = fakeLlm({ text: '今天问的是把事记接进底稿。' })
    const target = await scannedScene({ llm })
    seedConsult(target)
    const methods = createShijiMethods(target.ctx, { dataDir: target.sandbox.dataDir, dshHome: target.dshHome })

    const result = await methods['shiji.fromSession']({ sessionId: CONSULT_SESSION, confirmed: true })
    expect(result.ok).toBe(true)
    expect(result.entry).toMatchObject({
      schema: 'xuanshu/shiji@1',
      source: 'session',
      refId: CONSULT_SESSION,
      name: '事记怎么接进底稿',
      summary: '今天问的是把事记接进底稿。',
      summaryMode: 'llm',
      manual: true,
      basis: { sessions: 1, docs: 0 },
      frozenAt: null,
      excludedAt: null,
    })
    const entry = readJsonl(target.sandbox.path('shiji.jsonl')).find((item) => item.source === 'session')
    expect(entry).toEqual(result.entry)
    // 素材是会话文本历史（用户/助手都带），不是别的会话。
    const prompt = llm.calls.filter((call) => call.method === 'stream').at(-1).options.messages[0].content[0].text
    expect(prompt).toContain('用户：事记怎么接进底稿？')
    expect(prompt).toContain('助手：在 refreshDigao 之前先扫一遍')
  })

  it('同 refId 再存一次 → 更新不新增（firstSeenAt 保留）', async () => {
    const target = await scannedScene({ llm: fakeLlm({ text: '第一次摘要。' }) })
    seedConsult(target)
    const methods = createShijiMethods(target.ctx, { dataDir: target.sandbox.dataDir, dshHome: target.dshHome })
    const first = await methods['shiji.fromSession']({ sessionId: CONSULT_SESSION, confirmed: true })
    const second = await methods['shiji.fromSession']({ sessionId: CONSULT_SESSION, confirmed: true })
    expect(second.entry.id).toBe(first.entry.id)
    expect(second.entry.firstSeenAt).toBe(first.entry.firstSeenAt)
    expect(readJsonl(target.sandbox.path('shiji.jsonl')).filter((item) => item.source === 'session')).toHaveLength(1)
  })

  it('LLM 不可用 → {ok:false, error:{code:summary-unavailable}} 且**一个字节都不写**', async () => {
    const target = await scannedScene({ llm: null })
    seedConsult(target)
    const methods = createShijiMethods(target.ctx, { dataDir: target.sandbox.dataDir, dshHome: target.dshHome })
    const before = target.sandbox.read('shiji.jsonl')

    const result = await methods['shiji.fromSession']({ sessionId: CONSULT_SESSION, confirmed: true })
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('summary-unavailable')
    expect(result.error.message).toMatch(/ctx\.llm|摘要/u)
    expect(target.sandbox.read('shiji.jsonl')).toBe(before)
    expect(readJsonl(target.sandbox.path('shiji.jsonl')).some((item) => item.source === 'session')).toBe(false)
  })

  it('LLM 报错 → 同样 summary-unavailable，不写空条目、不编摘要', async () => {
    const target = await scannedScene({ llm: fakeLlm({ fail: true }) })
    seedConsult(target)
    const methods = createShijiMethods(target.ctx, { dataDir: target.sandbox.dataDir, dshHome: target.dshHome })
    const result = await methods['shiji.fromSession']({ sessionId: CONSULT_SESSION, confirmed: true })
    expect(result).toMatchObject({ ok: false, error: { code: 'summary-unavailable' } })
    expect(readJsonl(target.sandbox.path('shiji.jsonl')).some((item) => item.source === 'session')).toBe(false)
  })

  it('不是玄枢问事会话 → invalid-session，不写', async () => {
    const target = await scannedScene({ llm: fakeLlm() })
    const methods = createShijiMethods(target.ctx, { dataDir: target.sandbox.dataDir, dshHome: target.dshHome })
    const result = await methods['shiji.fromSession']({ sessionId: 'session-1bb37188-xxx', confirmed: true })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-session' } })
    expect(readJsonl(target.sandbox.path('shiji.jsonl')).some((item) => item.source === 'session')).toBe(false)
  })

  it('会话正文读不出来（服务缺席）→ session-unavailable，不写', async () => {
    const target = await scannedScene({ llm: fakeLlm() })
    const store = createConsultStore(target.sandbox.dataDir)
    store.create({ sessionId: CONSULT_SESSION, createdAt: NOW.toISOString() })
    target.ctx.get = (name) => (name === 'sessionQuery' ? undefined : target.ctx[name])
    delete target.ctx.sessionQuery
    const methods = createShijiMethods(target.ctx, { dataDir: target.sandbox.dataDir, dshHome: target.dshHome })
    const result = await methods['shiji.fromSession']({ sessionId: CONSULT_SESSION, confirmed: true })
    expect(result).toMatchObject({ ok: false, error: { code: 'session-unavailable' } })
    expect(readJsonl(target.sandbox.path('shiji.jsonl')).some((item) => item.source === 'session')).toBe(false)
  })
})
