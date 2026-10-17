/**
 * tests/wansheng/lib/sandbox.mjs — 晚省断言台的外界替身（#25）。
 *
 * 硬约束：不读 `.dsh-home` 真机文件、不联网、不调模型。事实全部由**造出来的文件**与**注入的替身**给出：
 *   - 问事旁挂清单：走真的 `createConsultStore(dataDir)` 写（与宿主读的是同一份文件契约）；
 *   - 工作区 / 会话 header：`tests/shiji/lib/sandbox.mjs` 的假 `workspaceRegistry` / `sessionQuery`（同一形状）；
 *   - 底稿 / 日课 / 事记：直接按各自 schema 落盘（读面不认识就省略键，测试不靠真机现场）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { createConsultStore } from '../../../packages/xuanshu-host/lib/consult/store.mjs'
import { writeRikke } from '../../../packages/xuanshu-host/lib/rikke/store.mjs'
import { makeScratch } from '../../notify/lib/sandbox.mjs'

export { fakeSessionQuery, fakeWorkspaceRegistry } from '../../shiji/lib/sandbox.mjs'

/** 一次性 dataDir（形状同 notify / digao 的沙箱）。 */
export function makeWanshengSandbox(label = 'wansheng') {
  return makeScratch(label)
}

/** 往 `<dataDir>/consult/sessions/` 写一份旁挂清单（问事的唯一权威）。 */
export function writeConsultSession(dataDir, { sessionId, createdAt, lastTurnAt, title, turns = 1, pus = [] }) {
  const store = createConsultStore(dataDir)
  store.create({ sessionId, createdAt, pus })
  const patch = { turns }
  if (lastTurnAt !== undefined) patch.lastTurnAt = lastTurnAt
  if (title !== undefined) patch.title = title
  return store.update(sessionId, patch)
}

/** 写 `<dataDir>/digao.json`（底稿元数据；只写 facts 要读的键）。 */
export function writeDigaoMeta(dataDir, generatedAt = '2026-10-15T03:00:00.000Z') {
  const file = join(dataDir, 'digao.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({
    schema: 'xuanshu/digao@1',
    generatedAt,
    segments: 3,
    sources: 2,
    digest: 'skeleton',
  }, null, 2)}\n`, 'utf8')
  return file
}

/** 写当天的日课产物（晚省的事实源之一）。 */
export function writeRikkeArtifact(dataDir, { date, generatedAt = '2026-10-15T03:00:00.000Z', zone = 'Asia/Shanghai' } = {}) {
  return writeRikke(dataDir, {
    schema: 'xuanshu/rikke@1',
    date,
    generatedAt,
    zone,
    content: { yi: '祭祀', ji: '动土', liuri: '甲子日 · 水' },
    manual: false,
  })
}

/** 写事记账本（`shiji.jsonl`：一条一行，快照式）。 */
export function writeShiji(dataDir, entries) {
  const file = join(dataDir, 'shiji.jsonl')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8')
  return file
}

/** 一条合法的事记条目（形状照 `lib/shiji/store.mjs` 的 normalizeShijiEntry）。 */
export function shijiEntry({ id = 'shiji-1', refId = 'ws-1', lastActiveAt = '2026-10-14T22:00:00.000Z', firstSeenAt = '2026-10-10T00:00:00.000Z' } = {}) {
  return {
    schema: 'xuanshu/shiji@1',
    id,
    source: 'workspace',
    refId,
    name: 'XuanShu',
    summary: '在做玄枢。',
    summaryMode: 'skeleton',
    firstSeenAt,
    lastActiveAt,
    basis: { sessions: 2, docs: 1 },
    fingerprint: 'fp-1',
    manual: false,
    frozenAt: null,
    excludedAt: null,
  }
}
