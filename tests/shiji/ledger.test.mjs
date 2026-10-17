/**
 * 票 05（#26）· 事记账本：upsert / 冻结 / 墓碑 / 指纹（契约 §1）
 *
 * 这一层才把「扫描到的依据」变成账本条目。判据：
 *   - **一项目一条**：重扫同 `source+refId` 更新、不追加；id 确定性；
 *   - **依据指纹不变 → 0 次摘要 LLM**，只更新 `lastActiveAt`；变了才重算；
 *   - **源头消失 → 写 `frozenAt` 并保留**；重新出现 → 清 `frozenAt` 并更新；
 *   - **删除 = 墓碑**：`excludedAt` 之后自动扫描永不重建；恢复只能显式清墓碑；
 *   - 人工「存成今天的事记」（`source:'session'`）自动扫描**永不动**。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { DIGEST_SYSTEM } from '../../packages/xuanshu-host/lib/digao/llm.mjs'
import {
  evidenceFingerprint, listShiji, recordSessionShiji, removeShijiEntry, restoreShijiEntry, scanAndUpdateShiji,
} from '../../packages/xuanshu-host/lib/shiji/ledger.mjs'
import { SHIJI_SUMMARY_SYSTEM } from '../../packages/xuanshu-host/lib/shiji/summary.mjs'
import { writeShijiSettings } from '../../packages/xuanshu-host/lib/shiji/store.mjs'
import { writeWorkflow } from '../../packages/xuanshu-host/lib/workflow/store.mjs'
import {
  fakeLlm, fakeProjectionCache, fakeSessionQuery, fakeWorkspaceRegistry, makeCtx, makeSandbox, readJsonl, seedProject, userEvent,
} from './lib/sandbox.mjs'

const NOW = new Date('2026-10-17T03:30:00.000Z')
const LATER = new Date('2026-10-18T03:30:00.000Z')
const PROMPT_AT = Date.parse('2026-10-16T12:00:00.000Z')

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/**
 * 一个完整现场：项目（README + docs/shiji.md）+ 一个工作区 + 一份已导出工作流。
 * @param {{llm?: 'ok'|'absent', missing?: boolean, workspaces?: object[]}} [parts]
 */
function scene(parts = {}) {
  const sandbox = makeSandbox('shiji-ledger')
  roots.push(sandbox)
  const projectRoot = seedProject(sandbox, 'xuan', {
    docs: {
      'README.md': '# XuanShu\n在做玄枢。',
      'docs/shiji.md': '# 事记\n底稿的第四个来源。',
      'src/index.ts': 'export const code = 1\n',
    },
  })
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

  const defaultWorkspaces = [{
    id: 'w1',
    path: projectRoot,
    title: 'XuanShu',
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    sessionIds: ['s1'],
  }]
  const workspaces = parts.workspaces ?? defaultWorkspaces
  const registry = fakeWorkspaceRegistry(workspaces, { missing: parts.missing === true ? ['w1'] : [] })
  const query = fakeSessionQuery({
    headers: { s1: { createdAt: Date.parse('2026-10-01T00:00:00.000Z') } },
    events: { s1: [userEvent(1, '事记怎么接？', PROMPT_AT)] },
    titles: { s1: '事记怎么接' },
  })
  const cache = fakeProjectionCache({ s1: { title: '事记怎么接', lastPromptAt: PROMPT_AT } })
  const services = { workspaceRegistry: registry.service, sessionQuery: query.service, sessionProjectionCache: cache.service }
  let llm
  if (parts.llm !== 'absent') {
    llm = fakeLlm({ text: '在做玄枢：把底稿与事记接上。' })
    services.llm = llm
  }
  const ctx = makeCtx({ services })
  return { sandbox, ctx, llm, registry, projectRoot, dshHome }
}

/** 只数「事记摘要」调用（按 system 提示分；底稿压缩是另一套）。 */
function shijiSummaryCalls(llm) {
  return llm.calls.filter((call) => call.method === 'stream' && call.options?.system === SHIJI_SUMMARY_SYSTEM)
}

/** 扫一次（固定 now）。 */
async function scan(target, now = NOW) {
  return scanAndUpdateShiji({ ctx: target.ctx, dataDir: target.sandbox.dataDir, dshHome: target.dshHome, now })
}

/** 读账本行。 */
function rows(target) {
  return readJsonl(target.sandbox.path('shiji.jsonl'))
}

describe('票05 · 第一次扫描落账本（条目形状 / 一路一条）', () => {
  it('工作区与已导出工作流各一条，条目形状逐字段（schema/id/basis/指纹/时间/manual）', async () => {
    const target = scene()
    const result = await scan(target)
    const entries = rows(target)
    expect(entries).toHaveLength(2)
    expect(result.entries).toHaveLength(2)

    const workspace = entries.find((entry) => entry.source === 'workspace')
    expect(Object.keys(workspace).sort()).toEqual([
      'basis', 'excludedAt', 'fingerprint', 'firstSeenAt', 'frozenAt', 'id', 'lastActiveAt',
      'manual', 'name', 'refId', 'schema', 'source', 'summary', 'summaryMode',
    ])
    expect(workspace.schema).toBe('xuanshu/shiji@1')
    expect(workspace.id).toBe('shiji-aca7386a043a83a1') // sha256('workspace\0w1') 前 16 位
    expect(workspace.refId).toBe('w1')
    expect(workspace.name).toBe('XuanShu')
    expect(workspace.summary).toBe('在做玄枢：把底稿与事记接上。')
    expect(workspace.summaryMode).toBe('llm')
    expect(workspace.firstSeenAt).toBe(NOW.toISOString())
    expect(workspace.lastActiveAt).toBe('2026-10-16T12:00:00.000Z')
    expect(workspace.basis).toEqual({ sessions: 1, docs: 2 })
    expect(workspace.fingerprint).toMatch(/^[0-9a-f]{64}$/u)
    expect(workspace.manual).toBe(false)
    expect(workspace.frozenAt).toBeNull()
    expect(workspace.excludedAt).toBeNull()

    const workflow = entries.find((entry) => entry.source === 'workflow')
    expect(workflow.refId).toBe('wf1')
    expect(workflow.name).toBe('把周报自动化')
    expect(workflow.basis).toEqual({ sessions: 0, docs: 1 })
    // 摘要调用两次：两条各一次（底稿压缩不在这一层）。
    expect(shijiSummaryCalls(target.llm)).toHaveLength(2)
    expect(target.llm.calls.filter((call) => call.method === 'stream' && call.options?.system === DIGEST_SYSTEM)).toHaveLength(0)
  })

  it('重扫同一现场：更新不新增、摘要 0 次；标题变了 name 跟着变而 id 不变', async () => {
    const target = scene()
    await scan(target)
    const first = rows(target)
    const callsAfterFirst = shijiSummaryCalls(target.llm).length

    const again = await scan(target, LATER)
    expect(again.entries).toHaveLength(2)
    const second = rows(target)
    expect(second.map((entry) => entry.id).sort()).toEqual(first.map((entry) => entry.id).sort())
    expect(shijiSummaryCalls(target.llm)).toHaveLength(callsAfterFirst) // 依据没变 → 0 次
    // 只更新 lastActiveAt（会话活动没变时它也不变）。
    expect(second.find((entry) => entry.source === 'workspace').lastActiveAt).toBe('2026-10-16T12:00:00.000Z')

    const renamed = scene({ workspaces: [{ id: 'w1', path: target.projectRoot, title: '玄枢', createdAt: '2026-10-10T00:00:00.000Z', sessionIds: ['s1'] }] })
    // 同一个 dataDir / dshHome，只换标题：仍是一条。
    const renamedResult = await scanAndUpdateShiji({ ctx: renamed.ctx, dataDir: target.sandbox.dataDir, dshHome: target.dshHome, now: LATER })
    expect(renamedResult.entries.filter((entry) => entry.source === 'workspace')).toHaveLength(1)
    expect(rows(target).find((entry) => entry.source === 'workspace').name).toBe('玄枢')
    roots.push(renamed.sandbox)
  })
})

describe('票05 · 依据指纹：不变不重算，变了才重算（零 LLM 是正常路径）', () => {
  it('指纹 = sha256(JSON.stringify({sessions, docs:[relPath,size,mtimeMs]}))（独立字面量核对）', () => {
    const fingerprint = evidenceFingerprint({ sessions: ['s2', 's1'], docs: [{ relPath: 'docs/a.md', size: 20, mtimeMs: 456 }, { relPath: 'README.md', size: 10, mtimeMs: 123 }] })
    expect(fingerprint).toBe('c290abdba7e0d36262731ecdb30ed7bef3a97e2532f88fe4353845eb15602bdc')
    // 顺序无关（两份依据集合相同 → 同一指纹）。
    expect(evidenceFingerprint({ sessions: ['s1', 's2'], docs: [{ relPath: 'README.md', size: 10, mtimeMs: 123 }, { relPath: 'docs/a.md', size: 20, mtimeMs: 456 }] })).toBe(fingerprint)
    // 正文变化但尺寸/时刻不变 → 指纹不变（契约就是元组；内容变化必然改 size 或 mtime，除同时伪造）。
    expect(evidenceFingerprint({ sessions: ['s1'], docs: [] })).not.toBe(fingerprint)
  })

  it('改一份文档（size/mtime 变）→ 只重算那一条；未变的条目 0 次', async () => {
    const target = scene()
    await scan(target)
    const before = rows(target).find((entry) => entry.source === 'workspace')
    const callsBefore = shijiSummaryCalls(target.llm).length

    // 改工作区项目的文档（工作流 SKILL.md 不动）。
    target.sandbox.writeRoot('projects/xuan/docs/shiji.md', '# 事记\n底稿的第四个来源；今天补了一句：删除写墓碑。\n')
    await scan(target, LATER)
    const after = rows(target).find((entry) => entry.source === 'workspace')
    expect(after.id).toBe(before.id)
    expect(after.fingerprint).not.toBe(before.fingerprint)
    expect(shijiSummaryCalls(target.llm).length).toBe(callsBefore + 1)
    // 这一次的素材确实带上了新内容（不是拿旧摘要冒充）。
    const newest = shijiSummaryCalls(target.llm).at(-1).options.messages[0].content[0].text
    expect(newest).toContain('删除写墓碑')
  })

  it('LLM 缺席 → skeleton 条目照写（带依据计数）；之后 LLM 有了但依据没变 → 仍 0 次、仍是 skeleton', async () => {
    const target = scene({ llm: 'absent' })
    await scan(target)
    const entry = rows(target).find((item) => item.source === 'workspace')
    expect(entry.summaryMode).toBe('skeleton')
    expect(entry.summary).toBe('摘要未能生成（模型不可用）：依据 会话 1 场 · 文档 2 份。')

    // 同一份 dataDir，补上 LLM 再扫：指纹没变 → 不许补生成（契约 §1 的成本口径）。
    const llm = fakeLlm({ text: '补生成的摘要。' })
    const replay = makeCtx({
      services: {
        llm,
        workspaceRegistry: fakeWorkspaceRegistry([{ id: 'w1', path: target.projectRoot, title: 'XuanShu', createdAt: '2026-10-10T00:00:00.000Z', sessionIds: ['s1'] }]).service,
        sessionQuery: fakeSessionQuery({
          headers: { s1: { createdAt: Date.parse('2026-10-01T00:00:00.000Z') } },
          events: { s1: [userEvent(1, '事记怎么接？', PROMPT_AT)] },
          titles: { s1: '事记怎么接' },
        }).service,
        sessionProjectionCache: fakeProjectionCache({ s1: { title: '事记怎么接', lastPromptAt: PROMPT_AT } }).service,
      },
    })
    await scanAndUpdateShiji({ ctx: replay, dataDir: target.sandbox.dataDir, dshHome: target.dshHome, now: LATER })
    expect(shijiSummaryCalls(llm)).toHaveLength(0)
    expect(rows(target).find((item) => item.source === 'workspace').summaryMode).toBe('skeleton')
  })
})

describe('票05 · 源头消失 → 冻结并保留；重新出现 → 清冻结', () => {
  it('工作区从注册表消失（或目录 missing-dir）→ frozenAt 写一次；重扫不重复写、不重算摘要', async () => {
    const target = scene()
    await scan(target)
    const callsBefore = shijiSummaryCalls(target.llm).length
    const frozenAtFirst = LATER.toISOString()

    // 目录被移走（记录还在，status=missing-dir）：同一个 dataDir、同一个项目路径。
    const missingRegistry = fakeWorkspaceRegistry(
      [{ id: 'w1', path: target.projectRoot, title: 'XuanShu', createdAt: '2026-10-10T00:00:00.000Z', sessionIds: ['s1'] }],
      { missing: ['w1'] },
    )
    const missingCtx = makeCtx({
      services: {
        llm: target.llm,
        workspaceRegistry: missingRegistry.service,
        sessionQuery: fakeSessionQuery({
          headers: { s1: { createdAt: Date.parse('2026-10-01T00:00:00.000Z') } },
          events: { s1: [userEvent(1, '事记怎么接？', PROMPT_AT)] },
          titles: { s1: '事记怎么接' },
        }).service,
        sessionProjectionCache: fakeProjectionCache({ s1: { title: '事记怎么接', lastPromptAt: PROMPT_AT } }).service,
      },
    })
    await scanAndUpdateShiji({ ctx: missingCtx, dataDir: target.sandbox.dataDir, dshHome: target.dshHome, now: LATER })

    const frozen = rows(target).find((entry) => entry.source === 'workspace')
    expect(frozen).toBeDefined()
    expect(frozen.frozenAt).toBe(frozenAtFirst)
    expect(frozen.lastActiveAt).toBe('2026-10-16T12:00:00.000Z')
    expect(shijiSummaryCalls(target.llm)).toHaveLength(callsBefore)

    // 继续不在：frozenAt 不许被后一次扫描改写。
    await scanAndUpdateShiji({ ctx: missingCtx, dataDir: target.sandbox.dataDir, dshHome: target.dshHome, now: new Date('2026-10-19T03:30:00.000Z') })
    expect(rows(target).find((entry) => entry.source === 'workspace').frozenAt).toBe(frozenAtFirst)

    // 重新出现：清 frozenAt、更新（依据没变 → 0 次摘要）。
    const back = scene()
    roots.push(back.sandbox)
    await scanAndUpdateShiji({ ctx: back.ctx, dataDir: target.sandbox.dataDir, dshHome: target.dshHome, now: new Date('2026-10-20T03:30:00.000Z') })
    expect(rows(target).find((entry) => entry.source === 'workspace').frozenAt).toBeNull()
  })

  it('工作区记录整个被删（list 不再给）→ 同样冻结并保留', async () => {
    const target = scene()
    await scan(target)
    const empty = scene({ workspaces: [] })
    roots.push(empty.sandbox)
    await scanAndUpdateShiji({ ctx: empty.ctx, dataDir: target.sandbox.dataDir, dshHome: target.dshHome, now: LATER })
    const frozen = rows(target).find((entry) => entry.source === 'workspace')
    expect(frozen).toBeDefined()
    expect(frozen.frozenAt).toBe(LATER.toISOString())
  })

  it('工作区服务整个缺席（核不了 ≠ 没有）→ **不**冻结已有条目', async () => {
    const target = scene()
    await scan(target)
    // 只有 LLM，没有 workspaceRegistry / sessionQuery：这一路「核不了」，不是「项目没了」。
    const blind = makeCtx({ services: { llm: target.llm } })
    await scanAndUpdateShiji({ ctx: blind, dataDir: target.sandbox.dataDir, dshHome: target.dshHome, now: LATER })
    const workspace = rows(target).find((entry) => entry.source === 'workspace')
    expect(workspace.frozenAt).toBeNull()
    expect(workspace.lastActiveAt).toBe('2026-10-16T12:00:00.000Z')
  })
})

describe('票05 · 墓碑：删除后自动扫描永不重建，恢复只能显式', () => {
  it('remove 写 excludedAt（条目仍保留）；重扫不重建、不调摘要；restore 后下一轮重新出现', async () => {
    const target = scene()
    await scan(target)
    const workspace = rows(target).find((entry) => entry.source === 'workspace')
    const callsBefore = shijiSummaryCalls(target.llm).length

    const removed = removeShijiEntry(target.sandbox.dataDir, { id: workspace.id, now: LATER })
    expect(removed.ok).toBe(true)
    expect(removed.entry.excludedAt).toBe(LATER.toISOString())
    expect(rows(target).find((entry) => entry.id === workspace.id).excludedAt).toBe(LATER.toISOString())

    // 自动扫描：这一条不许回来，也不许重新生成一条同 source+refId 的。
    await scan(target, new Date('2026-10-19T03:30:00.000Z'))
    const after = rows(target).filter((entry) => entry.source === 'workspace')
    expect(after).toHaveLength(1)
    expect(after[0].excludedAt).toBe(LATER.toISOString())
    expect(shijiSummaryCalls(target.llm)).toHaveLength(callsBefore)

    // list 默认不含墓碑；includeDeleted 才看得到（审计面）。
    const visible = listShiji(target.sandbox.dataDir)
    expect(visible.entries.some((entry) => entry.id === workspace.id)).toBe(false)
    const all = listShiji(target.sandbox.dataDir, { includeDeleted: true })
    expect(all.entries.some((entry) => entry.id === workspace.id)).toBe(true)

    // 恢复 = 显式清墓碑；下一次扫描重新生成（同一条 id，不新增）。
    const restored = restoreShijiEntry(target.sandbox.dataDir, { id: workspace.id })
    expect(restored.ok).toBe(true)
    expect(restored.entry.excludedAt).toBeNull()
    await scan(target, new Date('2026-10-20T03:30:00.000Z'))
    const back = rows(target).filter((entry) => entry.source === 'workspace')
    expect(back).toHaveLength(1)
    expect(back[0].id).toBe(workspace.id)
    expect(back[0].excludedAt).toBeNull()
  })

  it('remove/restore 不存在的 id → 可读 {ok:false,error}（不静默成功）', () => {
    const target = scene()
    expect(removeShijiEntry(target.sandbox.dataDir, { id: 'shiji-ffffffffffffffff' })).toMatchObject({ ok: false, error: { code: 'not-found' } })
    expect(restoreShijiEntry(target.sandbox.dataDir, { id: 'shiji-ffffffffffffffff' })).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })
})

describe('票05 · 人工「存成今天的事记」永不自动改写', () => {
  it('source:session 条目在自动扫描里不冻结、不覆盖', async () => {
    const target = scene()
    const recorded = recordSessionShiji(target.sandbox.dataDir, {
      sessionId: 'session-xs-consult-abc',
      name: '今天的问事',
      summary: '今天问的是事记怎么接。',
      summaryMode: 'llm',
      now: NOW,
    })
    expect(recorded.ok).toBe(true)
    expect(recorded.entry).toMatchObject({
      schema: 'xuanshu/shiji@1',
      id: 'shiji-9e652e74a0b9f407',
      source: 'session',
      refId: 'session-xs-consult-abc',
      manual: true,
      basis: { sessions: 1, docs: 0 },
      frozenAt: null,
      excludedAt: null,
    })

    await scan(target, LATER)
    const sessionEntry = rows(target).find((entry) => entry.source === 'session')
    expect(sessionEntry).toEqual(recorded.entry)
    // 同一 refId 再写一次是更新，不是新增。
    const again = recordSessionShiji(target.sandbox.dataDir, {
      sessionId: 'session-xs-consult-abc',
      name: '今天的问事（改名）',
      summary: '更新过的摘要。',
      summaryMode: 'llm',
      now: LATER,
    })
    expect(again.ok).toBe(true)
    expect(again.entry.id).toBe(recorded.entry.id)
    expect(again.entry.firstSeenAt).toBe(NOW.toISOString()) // 首次出现时间保留
    expect(rows(target).filter((entry) => entry.source === 'session')).toHaveLength(1)
  })
})

describe('票05 · 排除目录由设置驱动（扫描入口读 shiji-settings.json）', () => {
  it('set excludedDirs=docs/private → 扫描依据计数不含被排除文档', async () => {
    const target = scene()
    seedProject(target.sandbox, 'xuan', { docs: { 'docs/private/secret.md': '# 私密\n' } })
    writeShijiSettings(target.sandbox.dataDir, { excludedDirs: ['docs/private'] })
    await scan(target)
    const entry = rows(target).find((item) => item.source === 'workspace')
    expect(entry.basis.docs).toBe(2)
  })
})
