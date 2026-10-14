/**
 * 票 10 · 等一轮结束的判据（契约 §4）
 *
 * `waitForTurnEnd()` 是 `consult.send` 的后台记账用的：命中**这个会话**的 `turn/end` 才算一轮结束。
 * 它存在的理由就是「不许用 `whenIdle()`」——`whenIdle()` 不标识某条消息的结束
 * （`dsh-agent/lib/types/runtime-types.d.ts:164`），拿它记账会把上一轮的结束记到这一轮头上，且不报错。
 */
import { describe, expect, it } from 'vitest'

import { waitForTurnEnd } from '../../packages/xuanshu-host/lib/consult/turn.mjs'
import { makeHost } from './lib/sandbox.mjs'

const SESSION = 'session-xs-consult-1a2b3c4d'
const turnEnd = (id, time = Date.now()) => [{ id }, { type: 'turn/end', seq: 3, time, data: { turn: 1, reason: { kind: 'completed' } } }]

describe('waitForTurnEnd · 只看这一轮的 turn/end', () => {
  it('命中该会话的 turn/end：给出 turn 与 reason，并当场退订', async () => {
    const host = makeHost()
    const waiting = waitForTurnEnd(host.ctx, SESSION)
    expect(host.listenerCount('session/event')).toBe(1)

    host.emit('session/event', ...turnEnd('session-xs-consult-other'))
    host.emit('session/event', { id: SESSION }, { type: 'assistant/message', seq: 2, time: Date.now(), data: {} })
    host.emit('session/event', ...turnEnd(SESSION, 1730000000000))

    await expect(waiting).resolves.toEqual({ kind: 'ended', turn: 1, reason: { kind: 'completed' } })
    expect(host.listenerCount('session/event'), '命中后没退订：每次问事都会漏一个监听器').toBe(0)
  })

  it('取消信号 → {kind: "aborted"}，同样退订（不发问的一方放弃等待）', async () => {
    const host = makeHost()
    const controller = new AbortController()
    const waiting = waitForTurnEnd(host.ctx, SESSION, { signal: controller.signal })
    controller.abort()
    await expect(waiting).resolves.toEqual({ kind: 'aborted' })
    expect(host.listenerCount('session/event')).toBe(0)
  })

  it('宿主 ctx 上没有事件订阅：拒绝，而不是永远挂着', async () => {
    await expect(waitForTurnEnd({}, SESSION)).rejects.toThrow(/ctx\.on/u)
  })
})
