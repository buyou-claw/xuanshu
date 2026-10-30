/**
 * 票 27（#27）· 底稿「最近在做什么」的工作区这一路：**按最后活跃倒序 + 补最近活跃日期**（契约 §3）。
 *
 * 为什么这条要单独钉：
 *   ① `Workspace.updatedAt` 是「持久记录最后变更时刻」，**不是**最后活跃（探路笔记 §2.1）；
 *      真正的活跃时间只有事记扫描算得出来（`shiji.list()` 的 `lastActiveAt`，DSH 侧栏同口径）。
 *      底稿若自己再算一遍，就会与事记互相打脸 —— 所以「最近」的排序/日期**只认账本那一份**。
 *   ② 账本里没有活跃时间的项目**不许编一个日期**（核不了 ≠ 没有）：它排最后、且段文本不写日期。
 *   ③ 顺序必须稳定：两次刷新换来换去，用户会以为底稿乱了。
 */
import { describe, expect, it } from 'vitest'

import { collectSources, collectWorkspaceSources } from '../../packages/xuanshu-host/lib/digao/sources.mjs'

/** 三个工作区（故意按「旧 → 新 → 没扫到」的顺序给，验证排序真的在排）。 */
const WORKSPACES = [
  { id: 'w-old', path: 'E:\\ai_project\\旧项目', title: '旧项目', sessionIds: ['s1'] },
  { id: 'w-new', path: 'E:\\ai_project\\新项目', title: '新项目', sessionIds: ['s2', 's3'] },
  { id: 'w-unknown', path: 'E:\\ai_project\\未见', title: '未见', sessionIds: [] },
]

/** 事记账本里与它们对应的两条（第三条没扫到 → 没有活跃时间）。 */
const ENTRIES = [
  { source: 'workspace', refId: 'w-old', lastActiveAt: '2026-09-01T00:00:00.000Z' },
  { source: 'workspace', refId: 'w-new', lastActiveAt: '2026-10-17T08:00:00.000Z' },
  // 非工作区的条目不该被拿来给工作区排序。
  { source: 'workflow', refId: 'w-unknown', lastActiveAt: '2026-12-01T00:00:00.000Z' },
]

/**
 * 宿主 ctx 的**唯一**取服务方式是 `ctx.get(name)`（`lib/soft-service.mjs`；cordis 对没进
 * `inject` 的服务属性访问会直接抛，见复核清单第 5 条）。所以夹具必须编码这个形状，
 * 不能拿一个裸属性对象顶替——那会让「服务取不到」的实现也能过。
 */
function makeHostCtx(services) {
  return { get: (name) => (Object.hasOwn(services, name) ? services[name] : undefined) }
}

const ctx = makeHostCtx({ workspaceRegistry: { list: () => WORKSPACES } })

describe('票27 · 工作区一路：按最后活跃倒序（账本是唯一权威）', () => {
  it('最后活跃新的排前面；账本里没有活跃时间的排最后（保持原序）', () => {
    const rows = collectWorkspaceSources(ctx, ENTRIES)
    expect(rows.map((row) => row.name)).toEqual(['新项目', '旧项目', '未见'])
  })

  it('段文本补「最近活跃 <日期>」；没有活跃时间的不编日期', () => {
    const rows = collectWorkspaceSources(ctx, ENTRIES)
    expect(rows[0].text).toContain('最近活跃 2026-10-17')
    expect(rows[1].text).toContain('最近活跃 2026-09-01')
    expect(rows[2].text).not.toContain('最近活跃')
    // 原有标识行不丢（标题 / 路径 / 会话数仍在）。
    expect(rows[0].text).toContain('工作区「新项目」')
    expect(rows[0].text).toContain('会话 2 场')
  })

  it('没有事记账本（或服务缺席）时行为不变：原序、不写日期', () => {
    expect(collectWorkspaceSources(ctx).map((row) => row.name)).toEqual(['旧项目', '新项目', '未见'])
    expect(collectWorkspaceSources({}).map((row) => row.name)).toEqual([])
  })

  it('不改输入（工作区对象原样）', () => {
    const snapshot = JSON.stringify(WORKSPACES)
    collectWorkspaceSources(ctx, ENTRIES)
    expect(JSON.stringify(WORKSPACES)).toBe(snapshot)
  })

  it('collectSources 把事记一路原样透传给工作区（不在这里再扫一遍）', () => {
    const sources = collectSources({ ctx, dataDir: '/tmp/does-not-exist', shijiEntries: ENTRIES })
    expect(sources.workspace.map((row) => row.name)).toEqual(['新项目', '旧项目', '未见'])
    expect(sources.pu).toEqual([]) // 不存在的 dataDir：谱这一路空着，不抛
    expect(sources.workflow).toEqual([])
  })
})
