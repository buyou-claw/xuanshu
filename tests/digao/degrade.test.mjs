/**
 * 复核 (c)② · 事记账本读失败时 `digao.status|read` **不许整体失败**，也不许把健康的底稿卡变红。
 *
 * 为什么这是缺陷（而不是「读不到就报错」）：`digao.read|status` 的主体是**底稿正文与元数据**
 * （纯派生、可正常展示），事记条目只是它们的**加性**读面（#27：UI 的 [删除] 要有 id）。
 * 账本坏了（EISDIR / EACCES）时，用户仍然应该能看底稿；只是这一次「删除列表」拿不到 ——
 * 按本仓纪律「拿不到就省略键 + 说明原因」，而不是让整个底稿面板 500。
 *
 * 判据（都指向外部可观察的行为）：
 *   ① `digao.status` / `digao.read` 仍然 resolve（不抛）；
 *   ② `shiji` 键缺席（不编空数组 —— 「读不出来」≠「一条都没有」）；
 *   ③ 原因写在**专用加性字段 `shijiReason`** 里（可读，不是错误码）；
 *   ④ **不占用 `reason`**：`reason` 只表示 digao 自身失败（客户端据此把卡判成 error），
 *      账本坏不该把健康的底稿卡变红（`digaoStateFromStatus` 仍为 ready）；
 *   ⑤ 与底稿主体无关：markdown / meta 照常回。
 */
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { resolve } from 'node:path'

import { digaoStateFromStatus } from '../../packages/xuanshu-client/src/client/OverviewPanel.tsx'
import { createDigaoMethods } from '../../packages/xuanshu-host/lib/digao/service.mjs'
import { makeSandbox } from './lib/sandbox.mjs'

const sandboxes = []
afterEach(() => sandboxes.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 健康底稿（正文 + 元数据都在）+ 造坏的账本由各用例负责。 */
function scene() {
  const sandbox = makeSandbox('digao-degrade')
  sandboxes.push(sandbox)
  sandbox.write('digao.md', '# 底稿\n\n## 最近在做什么\n\n- 在做玄枢。\n')
  sandbox.write('digao.json', `${JSON.stringify({
    schema: 'xuanshu/digao@1',
    generatedAt: '2026-10-15T03:00:00.000Z',
    segments: 2,
    sources: 1,
    digest: 'skeleton',
  })}\n`)
  return { sandbox, methods: createDigaoMethods({}, { dataDir: sandbox.dataDir }) }
}

describe('(c)② · 事记账本读失败：digao.status/read 降级而不是整体失败', () => {
  it('账本是目录（EISDIR）：仍 resolve，省略 shiji、原因进 shijiReason，reason 缺席且卡仍 ready', async () => {
    const { sandbox, methods } = scene()
    // 让 `shiji.jsonl` 是个目录：`readFileSync` 抛 EISDIR（不是 ENOENT，属于「读失败」而不是「没有账本」）。
    fs.mkdirSync(sandbox.path('shiji.jsonl'), { recursive: true })

    const status = await methods['digao.status']({})
    expect(status.exists).toBe(true)
    expect(status.meta?.generatedAt).toBe('2026-10-15T03:00:00.000Z')
    expect('shiji' in status, '读不出来时不许拿空数组冒充「一条都没有」').toBe(false)
    expect(typeof status.shijiReason, '账本读失败的原因必须可读（专用加性字段）').toBe('string')
    expect(status.shijiReason).toMatch(/事记/u)
    expect(status.shijiReason).toMatch(/EISDIR|读不出来/u)
    expect('reason' in status, 'reason 只表示 digao 自身失败：账本坏不许占用它').toBe(false)

    const read = await methods['digao.read']({})
    expect(read.markdown).toContain('在做玄枢')
    expect('shiji' in read).toBe(false)
    expect(typeof read.shijiReason).toBe('string')
    expect(read.shijiReason).toMatch(/事记/u)
    expect('reason' in read).toBe(false)

    // 卡态：账本坏 ≠ 底稿坏 —— 仍是 ready，不是 error（`reason` 缺席，映射不会把它翻成 error）。
    expect(digaoStateFromStatus(status)).toEqual({
      state: 'ready',
      summary: { segments: 2, sources: 1, updatedAt: '2026-10-15T03:00:00.000Z' },
      reason: undefined,
    })
  })

  it('账本权限失败（EACCES）：同样只省略 shiji 键、原因进 shijiReason、reason 缺席', async () => {
    const { sandbox, methods } = scene()
    sandbox.write('shiji.jsonl', `${JSON.stringify({ schema: 'xuanshu/shiji@1' })}\n`)
    const ledger = resolve(sandbox.path('shiji.jsonl'))
    const originalRead = fs.readFileSync
    fs.readFileSync = function (path, ...args) {
      if (resolve(String(path)) === ledger) throw Object.assign(new Error('fixture ledger denied'), { code: 'EACCES' })
      return originalRead.call(this, path, ...args)
    }
    syncBuiltinESMExports()
    try {
      const status = await methods['digao.status']({})
      expect('shiji' in status).toBe(false)
      expect(status.shijiReason).toMatch(/事记/u)
      expect(status.shijiReason).toMatch(/EACCES|fixture ledger denied/u)
      expect('reason' in status).toBe(false)

      const read = await methods['digao.read']({})
      expect('shiji' in read).toBe(false)
      expect(read.shijiReason).toMatch(/事记/u)
      expect('reason' in read).toBe(false)
    } finally {
      fs.readFileSync = originalRead
      syncBuiltinESMExports()
    }
  })
})
