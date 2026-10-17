/**
 * task-14 · 采用稿的载体在**真会话日志**上合法（ADR-0009 第 5 条 / facts §7.2 的明文禁令）。
 *
 * 这一条回答的是那个最贵的担心：**我们投的那条消息会不会让日志打不开**。
 * ADR-0009 / facts §7.2 禁止「新增会话事件 `type`」（未知 type 且没有 `ignorable` 标记时，
 * 读日志的一方必须拒绝重建整份会话）。所以这里用**真** `dsh-session` 的 `SessionStore` + `Session`
 * 把那条消息真的 append 进去，再看：
 *   1. `append('user/message', …)` 不抛（`user/message` 是**已登记**的事件类型）；
 *   2. `snapshotEvents()` 里逐字找得到这条事件，`data.source.kind` 就是我们的 kind
 *      （`source` 是 DSH 显式 merge-extensible 的合并点，未知 kind 原样保留）；
 *   3. `deriveMessages()`（模型可见投影）里那条消息带着我们的 source 出现；
 *   4. `session.header` / 事件序列都没被搅动（不新增 type、不碰 meta）。
 *
 * profile 没装时整组跳过（不做假绿）。
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { BESTOF_ADOPTED_SOURCE_KIND, createBestofAdoptedMessage } from '../../packages/xuanshu-host/lib/consult/message.mjs'
import { makeSandbox } from './lib/sandbox.mjs'

function findProfile() {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'profile', 'node_modules', '@deepseek-ai', 'dsh-session', 'package.json'))) return join(dir, 'profile')
    dir = dirname(dir)
  }
  return undefined
}
const PROFILE = findProfile()

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

describe.skipIf(PROFILE === undefined)('task-14 · 采用稿是合法载体（真 Session 日志）', () => {
  it('append → 事件在册、投影可见、source kind 原样保留', async () => {
    const require = createRequire(join(PROFILE, 'package.json'))
    const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
    const sessionModule = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href)

    const sandbox = makeSandbox('bestof-real-log')
    roots.push(sandbox)
    const ctx = new Context()
    new sessionModule.SessionStore(ctx)

    const sessionId = 'session-xs-consult-11111111-2222-4333-8444-555555555555'
    const session = ctx.sessions.create(sessionId, { meta: { cwd: sandbox.dataDir } })
    // 先记下 append 之前的现场：header 键集合与已登记的事件类型集合。
    const headerKeysBefore = Object.keys(session.header).sort()
    const typesBefore = new Set(session.snapshotEvents().map((entry) => entry.type))

    const message = await createBestofAdoptedMessage('采用稿正文：先看大方向。', { searchDirs: [PROFILE] })
    const event = session.append('user/message', message, { surfaceOp: 'append' })

    // ① 事件类型是已登记的那一种（没有新增 type）。
    expect(event.type).toBe('user/message')
    expect(event.data.source).toEqual({ kind: BESTOF_ADOPTED_SOURCE_KIND })
    expect(event.data.content[0].text).toContain('采用稿正文：先看大方向。')

    // ② 日志里逐字找得到（`snapshotEvents()` 就是读日志的那条路）。
    const events = session.snapshotEvents()
    expect(events.map((entry) => entry.type)).toContain('user/message')
    expect(JSON.stringify(events)).toContain('采用稿正文：先看大方向。')
    expect(JSON.stringify(events)).toContain(BESTOF_ADOPTED_SOURCE_KIND)

    // ③ 模型可见投影里带着我们的 source（不是伪造的用户原话）。
    const derived = session.deriveMessages()
    const ours = derived.filter((entry) => entry.source?.kind === BESTOF_ADOPTED_SOURCE_KIND)
    expect(ours).toHaveLength(1)
    expect(ours[0].role).toBe('user')
    expect(ours[0].content[0].text).toContain('采用稿正文：先看大方向。')
    expect(derived.filter((entry) => entry.source?.kind === 'user')).toHaveLength(0) // 没有冒充用户

    // ④ 会话 header 没被搅动（我们没往 meta 塞任何东西），事件类型集合只多了 `user/message` 这一类。
    expect(Object.keys(session.header).sort()).toEqual(headerKeysBefore)
    expect(session.header.cwd).toBe(sandbox.dataDir)
    const typesAfter = new Set(events.map((entry) => entry.type))
    for (const type of typesAfter) {
      if (!typesBefore.has(type)) expect(type, '只允许多出已登记的那一类事件').toBe('user/message')
    }
    expect(typesAfter.size - typesBefore.size).toBeLessThanOrEqual(1)
  })

  it('落选候选不进日志：只 append 采用稿时，日志里搜不到别的候选', async () => {
    const require = createRequire(join(PROFILE, 'package.json'))
    const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
    const sessionModule = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href)

    const sandbox = makeSandbox('bestof-real-log-2')
    roots.push(sandbox)
    const ctx = new Context()
    new sessionModule.SessionStore(ctx)
    const session = ctx.sessions.create('session-xs-consult-99999999-2222-4333-8444-555555555555', { meta: { cwd: sandbox.dataDir } })

    session.append('user/message', await createBestofAdoptedMessage('采用稿：第一份。', { searchDirs: [PROFILE] }), { surfaceOp: 'append' })
    const dump = JSON.stringify(session.snapshotEvents())
    expect(dump).toContain('采用稿：第一份。')
    expect(dump).not.toContain('落选候选：第二份。')
    // 旁挂记录才带 ranking/candidates —— 日志里一个字段都不该有。
    expect(dump).not.toContain('ranking')
    expect(dump).not.toContain('candidates')
  })
})
