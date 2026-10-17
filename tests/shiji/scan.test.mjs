/**
 * 票 05（#26）· 扫描：工作区 / 工作流两路依据（契约 §1）
 *
 * 判据只打「依据集合」这一层（摘要在 `summary.test.mjs`、账本在 `ledger.test.mjs`）：
 *   - 工作区：`basis.sessions` 只数**有人说过话**的会话（`user/message` + `source.kind==='user'`；
 *     投影缓存的 `lastPromptAt` 与 DSH 侧栏同口径），`basis.docs` = 真读到的说明文档数；
 *   - 最后活跃 = `max(工作区 createdAt, 会话 lastPromptAt)`；**会话服务缺席**时按本次扫描时刻记并留 note；
 *   - 工作流：**只收导出过 skill 的**（`exportedAt` 非空 **且** `<dshHome>/skills/<name>/SKILL.md` 真存在）；
 *   - 目录 `status()==='missing-dir'` 的工作区当「本轮没扫到」（后续由账本写冻结）。
 */
import { describe, expect, it } from 'vitest'

import { collectShijiEvidence, resolveShijiDshHome } from '../../packages/xuanshu-host/lib/shiji/scan.mjs'
import { writeWorkflow } from '../../packages/xuanshu-host/lib/workflow/store.mjs'
import {
  assistantEvent, fakeProjectionCache, fakeSessionQuery, fakeWorkspaceRegistry, makeCtx, makeSandbox, seedProject, userEvent,
} from './lib/sandbox.mjs'

const NOW = new Date('2026-10-17T03:30:00.000Z')
const PROMPT_AT = Date.parse('2026-10-16T12:00:00.000Z')

/** 造一个现场：一个项目 + 两个会话 + 一份导出过的工作流。 */
function scene() {
  const sandbox = makeSandbox('shiji-scan')
  const projectRoot = seedProject(sandbox, 'xuan', {
    docs: { 'README.md': '# XuanShu\n在做玄枢。', 'docs/shiji.md': '# 事记\n一两句摘要。', 'src/index.ts': 'code' },
  })
  const dshHome = sandbox.rootPath('home')
  sandbox.writeRoot('home/skills/weekly/SKILL.md', '---\nname: weekly\ndescription: 周报\n---\n\n把周报自动化。\n')

  writeWorkflow(sandbox.dataDir, {
    schema: 'xuanshu/workflow@1',
    id: 'session-xs-workflow-ok',
    name: '把周报自动化',
    sessionId: 'session-xs-workflow-ok',
    cwd: sandbox.path('workflow'),
    seed: '把周报自动化',
    createdAt: '2026-10-15T00:00:00.000Z',
    skillName: 'weekly',
    skillPath: sandbox.rootPath('home/skills/weekly/SKILL.md'),
    exportedAt: '2026-10-16T03:00:00.000Z',
  })
  writeWorkflow(sandbox.dataDir, {
    schema: 'xuanshu/workflow@1',
    id: 'session-xs-workflow-no-file',
    name: '文件被手删了',
    sessionId: 'session-xs-workflow-no-file',
    cwd: sandbox.path('workflow'),
    seed: 'x',
    createdAt: '2026-10-15T00:00:00.000Z',
    skillName: 'gone',
    exportedAt: '2026-10-16T03:00:00.000Z',
  })
  writeWorkflow(sandbox.dataDir, {
    schema: 'xuanshu/workflow@1',
    id: 'session-xs-workflow-not-exported',
    name: '还没导出',
    sessionId: 'session-xs-workflow-not-exported',
    cwd: sandbox.path('workflow'),
    seed: 'y',
    createdAt: '2026-10-15T00:00:00.000Z',
    skillName: 'weekly',
  })

  const workspaces = [{
    id: 'w1',
    path: projectRoot,
    title: 'XuanShu',
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    sessionIds: ['s1', 's2'],
  }]
  return { sandbox, projectRoot, dshHome, workspaces }
}

/** 一个「s1 有人说过话、s2 只有注入上下文」的会话现场。 */
function sessions() {
  const headers = {
    s1: { createdAt: Date.parse('2026-10-01T00:00:00.000Z'), cwd: 'E:\\proj' },
    s2: { createdAt: Date.parse('2026-10-02T00:00:00.000Z'), cwd: 'E:\\proj' },
    'session-xs-workflow-ok': { createdAt: Date.parse('2026-10-15T00:00:00.000Z'), cwd: 'wf' },
  }
  const events = {
    s1: [userEvent(1, '事记怎么接？', PROMPT_AT - 1000), assistantEvent(2, '这样接。', PROMPT_AT), userEvent(3, '好。', PROMPT_AT)],
    s2: [{ type: 'user/message', seq: 1, time: PROMPT_AT, data: { id: 'm1', source: { kind: 'xuanshu-consult' }, content: [{ type: 'text', text: '注入的上下文' }] } }],
    'session-xs-workflow-ok': [userEvent(1, '把周报自动化怎么做？', PROMPT_AT)],
  }
  const query = fakeSessionQuery({ headers, events, titles: { s1: '事记怎么接', s2: '底稿' } })
  const cache = fakeProjectionCache({
    s1: { title: '事记怎么接', lastPromptAt: PROMPT_AT },
    s2: { title: '底稿', lastPromptAt: null },
    'session-xs-workflow-ok': { title: '周报工作流', lastPromptAt: PROMPT_AT },
  })
  return { query, cache }
}

describe('票05 · 工作区这一路：会话数 / 文档数 / 最后活跃', () => {
  it('一个项目一条依据：basis={sessions:1,docs:2}，只数有人说过话的会话，lastActiveAt 取 max(createdAt,lastPromptAt)', async () => {
    const { sandbox, dshHome, workspaces } = scene()
    try {
      const { query, cache } = sessions()
      const registry = fakeWorkspaceRegistry(workspaces)
      const ctx = makeCtx({ services: { workspaceRegistry: registry.service, sessionQuery: query.service, sessionProjectionCache: cache.service } })
      const result = await collectShijiEvidence({ ctx, dataDir: sandbox.dataDir, dshHome, now: NOW })

      const workspaceItems = result.items.filter((item) => item.source === 'workspace')
      expect(workspaceItems).toHaveLength(1)
      const item = workspaceItems[0]
      expect(item.refId).toBe('w1')
      expect(item.name).toBe('XuanShu')
      expect(item.basis).toEqual({ sessions: 1, docs: 2 })
      expect(item.sessions).toEqual(['s1'])
      expect(item.lastActiveAt).toBe('2026-10-16T12:00:00.000Z')
      expect(item.material.sessionTitles).toEqual(['事记怎么接'])
      expect(item.material.docs.map((doc) => doc.relPath)).toEqual(['README.md', 'docs/shiji.md'])
      // 指纹素材 = 文档三元组（relPath,size,mtimeMs），不含正文。
      expect(item.docs.map((doc) => doc.relPath)).toEqual(['README.md', 'docs/shiji.md'])
      expect(item.docs.every((doc) => typeof doc.size === 'number' && typeof doc.mtimeMs === 'number')).toBe(true)
      expect(result.notes).toEqual([])
    } finally {
      sandbox.cleanup()
    }
  })

  it('工作区素材含会话内容（人问的句子，有界）：标题保留，basis 计数语义不变', async () => {
    const { sandbox, dshHome, workspaces } = scene()
    try {
      const { query, cache } = sessions()
      const registry = fakeWorkspaceRegistry(workspaces)
      const ctx = makeCtx({ services: { workspaceRegistry: registry.service, sessionQuery: query.service, sessionProjectionCache: cache.service } })
      const result = await collectShijiEvidence({ ctx, dataDir: sandbox.dataDir, dshHome, now: NOW })

      const item = result.items.find((entry) => entry.source === 'workspace')
      // 标题照旧（票 05 的字段不动），会话内容是新加的一路素材。
      expect(item.material.sessionTitles).toEqual(['事记怎么接'])
      expect(item.material.sessionTexts).toEqual([
        { sessionId: 's1', title: '事记怎么接', questions: ['事记怎么接？', '好。'] },
      ])
      // `basis` 仍是「会话几场 · 文档几份」：素材变多不改计数。
      expect(item.basis).toEqual({ sessions: 1, docs: 2 })
      // 素材齐了就不该有降级 note。
      expect(result.notes).toEqual([])
    } finally {
      sandbox.cleanup()
    }
  })

  it('会话正文读不出来（缓存答了活跃时间、日志读不动）→ 素材降级为标题 + 文档，notes 如实说明', async () => {
    const { sandbox, dshHome, workspaces } = scene()
    try {
      const { cache } = sessions()
      // 清单与投影缓存都在（所以会话照样计入依据），但正文日志读不动。
      const unreadable = {
        async listSessions() {
          return [{ header: { id: 's1', version: 4, createdAt: Date.parse('2026-10-01T00:00:00.000Z') }, live: false, persisted: true }]
        },
        async readSession() {
          throw new Error('log is unreadable')
        },
      }
      const registry = fakeWorkspaceRegistry(workspaces)
      const ctx = makeCtx({ services: { workspaceRegistry: registry.service, sessionQuery: unreadable, sessionProjectionCache: cache.service } })
      const result = await collectShijiEvidence({ ctx, dataDir: sandbox.dataDir, dshHome, now: NOW })
      const item = result.items.find((entry) => entry.source === 'workspace')
      expect(item.basis).toEqual({ sessions: 1, docs: 2 })
      expect(item.material.sessionTitles).toEqual(['事记怎么接'])
      expect(item.material.sessionTexts).toEqual([])
      expect(result.notes.join('\n')).toMatch(/会话正文读不出来/u)
      expect(result.notes.join('\n')).toMatch(/标题 \+ 说明文档/u)
    } finally {
      sandbox.cleanup()
    }
  })

  it('日志读得动但会话里没有人问的文本 → 同样降级并在 notes 说明（不编内容）', async () => {
    const { sandbox, dshHome, workspaces } = scene()
    try {
      // s1 的日志只有助手回话、没有人的问句；缓存仍说它「活跃过」。
      const silent = fakeSessionQuery({ headers: { s1: { createdAt: Date.parse('2026-10-01T00:00:00.000Z') } }, events: { s1: [assistantEvent(1, '自说自话。', PROMPT_AT)] } })
      const cache = fakeProjectionCache({ s1: { title: '事记怎么接', lastPromptAt: PROMPT_AT } })
      const ctx = makeCtx({ services: { workspaceRegistry: fakeWorkspaceRegistry(workspaces).service, sessionQuery: silent.service, sessionProjectionCache: cache.service } })
      const result = await collectShijiEvidence({ ctx, dataDir: sandbox.dataDir, dshHome, now: NOW })
      const item = result.items.find((entry) => entry.source === 'workspace')
      expect(item.material.sessionTexts).toEqual([])
      expect(result.notes.join('\n')).toMatch(/没有可摘的人问文本/u)
    } finally {
      sandbox.cleanup()
    }
  })

  it('会话内容有界：每场最多 3 句、每句最多 200 字（截断），每条最多带 3 场（按活跃倒序）', async () => {
    const { sandbox, dshHome, projectRoot } = scene()
    try {
      const long = '要'.repeat(250)
      const ids = ['s1', 's2', 's3', 's4']
      const headers = Object.fromEntries(ids.map((id, index) => [id, { createdAt: Date.parse('2026-10-01T00:00:00.000Z') + index }]))
      const events = {
        s1: [userEvent(1, long, PROMPT_AT), userEvent(2, '第二问', PROMPT_AT), userEvent(3, '第三问', PROMPT_AT), userEvent(4, '第四问', PROMPT_AT), userEvent(5, '第五问', PROMPT_AT)],
        s2: [userEvent(1, 's2 的问句', PROMPT_AT)],
        s3: [userEvent(1, 's3 的问句', PROMPT_AT)],
        s4: [userEvent(1, 's4 的问句', PROMPT_AT)],
      }
      const query = fakeSessionQuery({ headers, events, titles: { s1: '长会话', s2: '二', s3: '三', s4: '四' } })
      const cache = fakeProjectionCache({
        s1: { title: '长会话', lastPromptAt: PROMPT_AT + 4000 },
        s2: { title: '二', lastPromptAt: PROMPT_AT + 3000 },
        s3: { title: '三', lastPromptAt: PROMPT_AT + 2000 },
        s4: { title: '四', lastPromptAt: PROMPT_AT + 1000 },
      })
      const registry = fakeWorkspaceRegistry([{ id: 'w1', path: projectRoot, title: 'XuanShu', createdAt: '2026-10-10T00:00:00.000Z', sessionIds: ids }])
      const ctx = makeCtx({ services: { workspaceRegistry: registry.service, sessionQuery: query.service, sessionProjectionCache: cache.service } })
      const result = await collectShijiEvidence({ ctx, dataDir: sandbox.dataDir, dshHome, now: NOW })
      const item = result.items.find((entry) => entry.source === 'workspace')

      // 依据计数照旧数全部计入的会话（4 场），素材只带有界的前 3 场。
      expect(item.basis.sessions).toBe(4)
      expect(item.material.sessionTexts.map((session) => session.sessionId)).toEqual(['s1', 's2', 's3'])
      // 一场最多 3 句（首问在前）。
      const first = item.material.sessionTexts[0]
      expect(first.questions).toHaveLength(3)
      expect(first.questions[1]).toBe('第二问')
      expect(first.questions[2]).toBe('第三问')
      // 一句最多 200 字 + 省略号（不把整段问句搬进 prompt）。
      expect(first.questions[0]).toHaveLength(201)
      expect(first.questions[0].endsWith('…')).toBe(true)
      expect(first.questions[0].startsWith('要')).toBe(true)
    } finally {
      sandbox.cleanup()
    }
  })

  it('目录 status()=missing-dir → 本轮当作没扫到（不产依据；冻结由账本写）', async () => {
    const { sandbox, dshHome, workspaces } = scene()
    try {
      const { query, cache } = sessions()
      const registry = fakeWorkspaceRegistry(workspaces, { missing: ['w1'] })
      const ctx = makeCtx({ services: { workspaceRegistry: registry.service, sessionQuery: query.service, sessionProjectionCache: cache.service } })
      const result = await collectShijiEvidence({ ctx, dataDir: sandbox.dataDir, dshHome, now: NOW })
      expect(result.items.filter((item) => item.source === 'workspace')).toEqual([])
      expect(result.notes.join('\n')).toMatch(/missing-dir|没扫到|不在/u)
    } finally {
      sandbox.cleanup()
    }
  })

  it('会话服务缺席 → lastActiveAt 用本次扫描时刻，并记一条 note（不编历史活跃时间）', async () => {
    const { sandbox, dshHome, workspaces } = scene()
    try {
      const registry = fakeWorkspaceRegistry(workspaces)
      const ctx = makeCtx({ services: { workspaceRegistry: registry.service } })
      const result = await collectShijiEvidence({ ctx, dataDir: sandbox.dataDir, dshHome, now: NOW })
      const item = result.items.find((entry) => entry.source === 'workspace')
      expect(item.lastActiveAt).toBe(NOW.toISOString())
      expect(item.basis.sessions).toBe(0)
      expect(result.notes.join('\n')).toMatch(/会话服务不可得/u)
    } finally {
      sandbox.cleanup()
    }
  })

  it('投影缓存里缺 sessionListMetadata 键（层叠差异）→ 回落读日志，不把问过的会话数成 0', async () => {
    const { sandbox, dshHome, workspaces } = scene()
    try {
      const { query } = sessions()
      // 只给 title、不给 lastPromptAt 那一行（本机 `session-1bb37188` 的缓存就是这种，探路笔记 §5.2）。
      // s2 给了明确的 `lastPromptAt:null`（= 确实没说过话）——它不该触发读日志。
      const cache = fakeProjectionCache({ s1: { title: '事记怎么接' }, s2: { title: '底稿', lastPromptAt: null } })
      const registry = fakeWorkspaceRegistry(workspaces)
      const ctx = makeCtx({ services: { workspaceRegistry: registry.service, sessionQuery: query.service, sessionProjectionCache: cache.service } })
      const result = await collectShijiEvidence({ ctx, dataDir: sandbox.dataDir, dshHome, now: NOW })
      const item = result.items.find((entry) => entry.source === 'workspace')
      expect(item.basis.sessions).toBe(1)
      expect(item.lastActiveAt).toBe('2026-10-16T12:00:00.000Z')
      expect(query.calls.some((call) => call.method === 'readSession' && call.sessionId === 's1')).toBe(true)
      // 缓存给了明确 `lastPromptAt:null` 的会话仍然不读日志（成本口径）：s2 不在 readSession 调用里。
      expect(query.calls.some((call) => call.method === 'readSession' && call.sessionId === 's2')).toBe(false)
    } finally {
      sandbox.cleanup()
    }
  })

  it('用户排除目录在扫描这一层就生效（docs 计数不含被排除的目录）', async () => {    const { sandbox, dshHome, workspaces } = scene()
    try {
      seedProject(sandbox, 'xuan', { docs: { 'docs/private/secret.md': '# 私密\n' } })
      const { query, cache } = sessions()
      const registry = fakeWorkspaceRegistry(workspaces)
      const ctx = makeCtx({ services: { workspaceRegistry: registry.service, sessionQuery: query.service, sessionProjectionCache: cache.service } })
      const result = await collectShijiEvidence({ ctx, dataDir: sandbox.dataDir, dshHome, now: NOW, excludedDirs: ['docs/private'] })
      const item = result.items.find((entry) => entry.source === 'workspace')
      expect(item.basis.docs).toBe(2)
      expect(item.material.docs.map((doc) => doc.relPath)).not.toContain('docs/private/secret.md')
    } finally {
      sandbox.cleanup()
    }
  })
})

describe('票05 · 工作流这一路：只收导出过 skill 的', () => {
  it('exportedAt 非空且 SKILL.md 真存在 → 一条；文件被删 / 没导出 → 都不收', async () => {
    const { sandbox, dshHome } = scene()
    try {
      const { query, cache } = sessions()
      const ctx = makeCtx({ services: { sessionQuery: query.service, sessionProjectionCache: cache.service } })
      const result = await collectShijiEvidence({ ctx, dataDir: sandbox.dataDir, dshHome, now: NOW })
      const workflows = result.items.filter((item) => item.source === 'workflow')
      expect(workflows.map((item) => item.refId)).toEqual(['session-xs-workflow-ok'])
      const item = workflows[0]
      expect(item.name).toBe('把周报自动化')
      expect(item.basis).toEqual({ sessions: 1, docs: 1 })
      expect(item.material.docs[0].relPath).toBe('SKILL.md')
      expect(item.material.docs[0].text).toContain('把周报自动化')
      expect(item.lastActiveAt).toBe('2026-10-16T12:00:00.000Z') // 会话活动晚于 exportedAt / createdAt
    } finally {
      sandbox.cleanup()
    }
  })

  it('工作流素材同样含会话内容：它的那一场会话里人问的句子进 material', async () => {
    const { sandbox, dshHome } = scene()
    try {
      const { query, cache } = sessions()
      const ctx = makeCtx({ services: { sessionQuery: query.service, sessionProjectionCache: cache.service } })
      const result = await collectShijiEvidence({ ctx, dataDir: sandbox.dataDir, dshHome, now: NOW })
      const item = result.items.find((entry) => entry.source === 'workflow')
      expect(item.material.sessionTitles).toEqual(['周报工作流'])
      expect(item.material.sessionTexts).toEqual([
        { sessionId: 'session-xs-workflow-ok', title: '周报工作流', questions: ['把周报自动化怎么做？'] },
      ])
      expect(item.basis).toEqual({ sessions: 1, docs: 1 })
    } finally {
      sandbox.cleanup()
    }
  })

  it('没有工作区注册表也照扫工作流（两路互不拖累）', async () => {
    const { sandbox, dshHome } = scene()
    try {
      const ctx = makeCtx({ services: {} })
      const result = await collectShijiEvidence({ ctx, dataDir: sandbox.dataDir, dshHome, now: NOW })
      expect(result.items.filter((item) => item.source === 'workspace')).toEqual([])
      expect(result.items.filter((item) => item.source === 'workflow')).toHaveLength(1)
      expect(result.items.every((item) => item.source !== 'session')).toBe(true)
      expect(result.notes.join('\n')).toMatch(/workspaceRegistry/u)
      // 「核不了」要能传给账本：否则下一轮会把所有工作区条目误判成「源头消失」。
      expect(result.routes).toEqual({ workspace: false, workflow: true })
    } finally {
      sandbox.cleanup()
    }
  })
})

describe('票05 · dshHome 解析（skill 落点，不靠 ctx.skills.list）', () => {
  it('config/profileContext → dataDir 的父目录（目录名是 xuanshu）；拿不到才退环境变量/家目录', () => {
    expect(resolveShijiDshHome({}, 'E:\\home\\xuanshu')).toBe('E:\\home')
    expect(resolveShijiDshHome({ get: () => ({ home: 'E:\\explicit' }) }, 'E:\\other\\data')).toBe('E:\\explicit')
  })
})
