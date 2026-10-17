/**
 * 复核 A1 · 「会话活动判据」两处实现（晚省事实 vs 事记依据扫描）的**两侧对拍**。
 *
 * 结论先说（精读两处 + 本文件逐条钉住）：**语义不完全一致，不能硬抽成一份**。两处共用的只是
 * 「投影缓存是捷径、拿不到再读会话日志」这条链上的**中立零件**（见
 * `packages/xuanshu-host/lib/consult/session-activity.mjs`：缓存读取 / header 归一 / 人的消息判据）；
 * 策略层有意分叉，硬合并会把一边的语义改掉：
 *
 *   | 维度 | 晚省事实 `wansheng/facts.mjs` | 事记依据 `shiji/scan.mjs` |
 *   |---|---|---|
 *   | 错误纪律 | 一场核不了 → **抛**，调用方省略整个事实键（宁缺勿假） | 单场核不了 → 记 `notes` 继续（一条事记不该让整轮扫描失败） |
 *   | 活动口径 | 每场会话 `max(header.createdAt, lastPromptAt)`；今天建、没说过的场次也算 | 只数「人的消息」的场次（`basis.sessions`）；`createdAt` 只在条目级 `lastActiveAt` 兜底 |
 *   | 「缓存答了」 | `lastPromptAt` 为 null 或可解析成时间才算答（否则回落日志） | `sessionListMetadata` 非空即算答（值类型不合法就按 0） |
 *   | 附带产物 | 无（只要活跃时刻） | 标题 + 人问过的句子（有界摘要素材） |
 *   | 会话已不在 | `null`（该会话没有内容，不是错误） | 跳过该会话（`SESSION_NOT_FOUND` 不算读失败） |
 *
 * 本文件的作用：**相同的场景断言两侧同一结果；有意的差异逐条钉成显式期望**，
 * 以后谁把一侧改得跟另一侧一样，会红在这里（而不是静默漂移）。
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { collectShijiEvidence } from '../../packages/xuanshu-host/lib/shiji/scan.mjs'
import { collectWanshengFacts } from '../../packages/xuanshu-host/lib/wansheng/facts.mjs'
import {
  fakeProjectionCache, fakeSessionQuery, fakeWorkspaceRegistry, makeWanshengSandbox, userEvent,
} from './lib/sandbox.mjs'

/** 本地 2026-10-15 10:30（Asia/Shanghai）。 */
const TODAY = '2026-10-15T02:30:00.000Z'
/** 本地 2026-10-14 10:30（昨天）。 */
const YESTERDAY = '2026-10-14T02:30:00.000Z'
const DATE = '2026-10-15'
const ZONE = 'Asia/Shanghai'

const boxes = []
afterEach(() => boxes.splice(0).forEach((box) => box.cleanup()))

/** 同一份现场喂给两个采集器（工作区 + 一个项目目录 + 空的 workflow 目录）。 */
function scene(workspaces, services) {
  const box = makeWanshengSandbox('activity-parity')
  boxes.push(box)
  mkdirSync(join(box.dataDir, 'workflow'), { recursive: true })
  const projectDir = join(box.root, 'project')
  mkdirSync(projectDir, { recursive: true })
  const registry = fakeWorkspaceRegistry(workspaces.map((workspace) => ({ path: projectDir, ...workspace })))
  // `shiji/scan.mjs` 只认 `ctx.get(name)`（cordis 形状），晚省两边都认：给一个两种取法都能用的 ctx。
  const ctxOf = () => {
    const all = { workspaceRegistry: registry.service, ...services }
    return { ...all, get: (name) => all[name] }
  }
  return {
    box,
    collectBoth: async () => {
      const facts = await collectWanshengFacts({ ctx: ctxOf(), dataDir: box.dataDir, date: DATE, zone: ZONE })
      const evidence = await collectShijiEvidence({
        ctx: ctxOf(),
        dataDir: box.dataDir,
        dshHome: join(box.root, 'dsh-home'),
      })
      return {
        facts,
        evidence,
        factsWorkspace: facts.facts.activeWorkspaces?.[0],
        scanWorkspace: evidence.items.find((item) => item.source === 'workspace'),
      }
    },
  }
}

describe('A1 · 两侧一致的场景（共用中立零件后仍然对拍）', () => {
  it('投影缓存给出 lastPromptAt：晚省与事记的「最后活跃」是同一时刻', async () => {
    const id = 'session-xs-parity-cache'
    const query = fakeSessionQuery({ headers: { [id]: { createdAt: Date.parse(YESTERDAY) } } })
    const cache = fakeProjectionCache({ [id]: { lastPromptAt: Date.parse(TODAY) } })
    const { collectBoth } = scene([{ id: 'w1', title: 'XuanShu', sessionIds: [id], createdAt: YESTERDAY }], {
      sessionQuery: query.service, sessionProjectionCache: cache.service,
    })
    const { factsWorkspace, scanWorkspace } = await collectBoth()
    expect(factsWorkspace.lastActiveAt).toBe(TODAY)
    expect(scanWorkspace.lastActiveAt, '缓存路径下两侧必须同一时刻').toBe(factsWorkspace.lastActiveAt)
    expect(scanWorkspace.basis.sessions).toBe(1)
  })

  it('投影缺席回落会话日志：两侧都取人的提问时刻（自动注入的事件不算）', async () => {
    const id = 'session-xs-parity-log'
    const query = fakeSessionQuery({
      headers: { [id]: { createdAt: Date.parse(YESTERDAY) } },
      events: {
        [id]: [
          userEvent(1, '今天接着做', Date.parse(TODAY)),
          { ...userEvent(2, '定时注入', Date.parse('2026-10-16T02:00:00.000Z')), data: { source: { kind: 'schedule' } } },
        ],
      },
    })
    const { collectBoth } = scene([{ id: 'w1', title: 'XuanShu', sessionIds: [id], createdAt: YESTERDAY }], {
      sessionQuery: query.service,
    })
    const { factsWorkspace, scanWorkspace } = await collectBoth()
    expect(factsWorkspace.lastActiveAt).toBe(TODAY)
    expect(scanWorkspace.lastActiveAt).toBe(factsWorkspace.lastActiveAt)
  })
})

describe('A1 · 有意的差异（不许硬合并；每条都钉住当前语义）', () => {
  it('只有 createdAt、没人说过话的会话：晚省算「今天有活动」，事记不计入依据会话', async () => {
    const id = 'session-xs-parity-created-at'
    const query = fakeSessionQuery({ headers: { [id]: { createdAt: Date.parse(TODAY) } } })
    const cache = fakeProjectionCache({ [id]: { lastPromptAt: null } })
    const { collectBoth } = scene([{ id: 'w1', title: 'XuanShu', sessionIds: [id], createdAt: YESTERDAY }], {
      sessionQuery: query.service, sessionProjectionCache: cache.service,
    })
    const { factsWorkspace, scanWorkspace } = await collectBoth()
    // 晚省：创建时刻也是可核对的活动（今天开的场不该漏）。
    expect(factsWorkspace.lastActiveAt).toBe(TODAY)
    expect(factsWorkspace.sessionCount).toBe(1)
    // 事记：`basis.sessions` 只数「人在里面说过话」的场次；条目级 active 由 workspace.createdAt 兜底。
    expect(scanWorkspace.basis.sessions).toBe(0)
    expect(scanWorkspace.lastActiveAt).toBe(YESTERDAY)
  })

  it('一场会话日志读失败：晚省省略整键并说明；事记记 note 后继续（单点失败不拖垮整轮）', async () => {
    const id = 'session-xs-parity-denied'
    const query = fakeSessionQuery({ headers: { [id]: { createdAt: Date.parse(YESTERDAY) } } }).service
    query.readSession = async () => { throw Object.assign(new Error('parity denied'), { code: 'EACCES' }) }
    const { collectBoth } = scene([{ id: 'w1', title: 'XuanShu', sessionIds: [id], createdAt: YESTERDAY }], {
      sessionQuery: query,
    })
    const { facts, evidence, scanWorkspace } = await collectBoth()
    // 晚省：拿不到就省略（不发布不完整的列表）。
    expect(Object.hasOwn(facts.facts, 'activeWorkspaces')).toBe(false)
    expect(facts.notes.join('\n')).toMatch(/parity denied.*未知/u)
    // 事记：这一路仍可用，原因进 notes；条目照建（active 退到 workspace.createdAt）。
    expect(evidence.routes.workspace).toBe(true)
    expect(scanWorkspace).toBeTruthy()
    expect(evidence.notes.join('\n')).toMatch(/会话日志读不出来/u)
  })

  it('会话不在 listSessions 清单里：晚省当「该会话已不在」，事记仍按日志/兜底建条目', async () => {
    const known = 'session-xs-parity-known'
    const unknown = 'session-xs-parity-unknown'
    const query = fakeSessionQuery({ headers: { [known]: { createdAt: Date.parse(YESTERDAY) } } })
    const { collectBoth } = scene([{ id: 'w1', title: 'XuanShu', sessionIds: [unknown], createdAt: YESTERDAY }], {
      sessionQuery: query.service,
    })
    const { facts, scanWorkspace } = await collectBoth()
    // 晚省：header 都没有 → 该会话已不在 → 今天没有活动项目（已知的空，不是未知）。
    expect(facts.facts.activeWorkspaces).toEqual([])
    // 事记：仍会为工作区建条目（依据会话数为 0），active 用 workspace.createdAt 兜底。
    expect(scanWorkspace.basis.sessions).toBe(0)
    expect(scanWorkspace.lastActiveAt).toBe(YESTERDAY)
  })
})
