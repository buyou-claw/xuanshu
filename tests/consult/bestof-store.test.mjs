/**
 * tests/consult/bestof-store.test.mjs —— 采用稿**账本**的判据（复核 48e0e0a 的 N4）。
 *
 * 背景：会话日志是**追加式**的 —— 先采用 c1、再改选 c2 时两条采用消息都在日志里；否决之后那条也不会消失。
 * 而 S9:174 与 ADR-0010 第 5 条要的是「只带**当前**采用稿」。所以「哪一份还算数」必须由旁挂决策判，
 * 判据就是这个函数的输出（`history.mjs` 的候选投影拿它过滤）。
 *
 * 三种记录形态都要照顾：
 *   - 有 `draftLedger`（本版写的：跨轮继承，采用/否决各追加一条）→ 从末尾往前找第一条；
 *   - 老记录（只有 `adoptedId` / `rejected` / `deliveries`）→ 退回当次决策；
 *   - 判不出来（没有记录 / 还没人拍板）→ `null` = **不过滤**（宁可多带一段历史，也不许误删真采用稿）。
 */
import { describe, expect, it } from 'vitest'

import { currentAdoptedMessageIds } from '../../packages/xuanshu-host/lib/consult/bestof-store.mjs'

describe('采用稿账本 · 谁还是当前采用稿（N4）', () => {
  it('没有记录 / 还没人拍板 → null（判不出来就别过滤）', () => {
    expect(currentAdoptedMessageIds(null)).toBeNull()
    expect(currentAdoptedMessageIds(undefined)).toBeNull()
    expect(currentAdoptedMessageIds({ schema: 'xuanshu/bestof@1', adoptedId: null, rejected: false, draftLedger: [] })).toBeNull()
    expect(currentAdoptedMessageIds({ schema: 'xuanshu/bestof@1', adoptedId: null, rejected: false })).toBeNull()
  })

  it('否决是**按轮**的：抹掉本轮那些采用稿，但不牵连别的轮已采用的稿', () => {
    // 上一轮采用的那一份仍在会话日志里、仍是这场问事的采用决定 —— 这一轮被否决不该把它一起抹掉
    // （复核 48e0e0a 规格轴指出：原实现「末尾 rejected ⇒ 空集」会连带抹掉上一轮的采用稿）。
    const crossRun = {
      draftLedger: [
        { kind: 'adopted', messageId: 'm-run1', runId: 'bestof-r1' },
        { kind: 'rejected', runId: 'bestof-r2' },
      ],
    }
    expect(currentAdoptedMessageIds(crossRun)).toEqual(new Set(['m-run1']))
  })

  it('否决本轮：本轮采纳过的那份也不算了（S9:174 否决轮次不带任何候选正文）', () => {
    const sameRun = {
      draftLedger: [
        { kind: 'adopted', messageId: 'm-c1', runId: 'bestof-r1' },
        { kind: 'rejected', runId: 'bestof-r1' },
      ],
    }
    expect(currentAdoptedMessageIds(sameRun)).toEqual(new Set())
    // 本轮否决之后**又**采纳（人改主意）：以最后那条 adopted 为准。
    const resumed = {
      draftLedger: [
        { kind: 'adopted', messageId: 'm-c1', runId: 'bestof-r1' },
        { kind: 'rejected', runId: 'bestof-r1' },
        { kind: 'adopted', messageId: 'm-c3', runId: 'bestof-r3' },
      ],
    }
    expect(currentAdoptedMessageIds(resumed)).toEqual(new Set(['m-c3']))
  })

  it('改选：账本最后一条 adopted 才算数（旧的那条仍在 deliveries 里，但不再进历史）', () => {
    const record = {
      draftLedger: [
        { kind: 'adopted', messageId: 'm-c1', runId: 'bestof-r1' },
        { kind: 'adopted', messageId: 'm-c2', runId: 'bestof-r1' },
      ],
    }
    expect(currentAdoptedMessageIds(record)).toEqual(new Set(['m-c2']))
  })

  it('跨轮继承：新记录带着上一轮的账本，仍能判出当前采用稿', () => {
    // run#2 的记录（覆盖写）继承了 run#1 的账本，此时 run#1 采用的那一份**仍然算数**
    // （直到本轮拍板）—— 候选历史在这一轮就必须带上它。
    const inherited = { draftLedger: [{ kind: 'adopted', messageId: 'm-run1', runId: 'bestof-r1' }] }
    expect(currentAdoptedMessageIds(inherited)).toEqual(new Set(['m-run1']))
  })

  it('账本在但一条 adopted 都没有（只否决过）→ 空集；老记录（没有账本）退回当次决策', () => {
    expect(currentAdoptedMessageIds({ draftLedger: [{ kind: 'rejected', runId: 'bestof-r1' }] })).toEqual(new Set())
    const legacy = {
      adoptedId: 'c1',
      rejected: false,
      deliveries: [
        { candidateId: 'c1', messageId: 'm-c1-old' },
        { candidateId: 'c2', messageId: 'm-c2' },
        { candidateId: 'c1', messageId: 'm-c1-new' },
      ],
    }
    expect(currentAdoptedMessageIds(legacy)).toEqual(new Set(['m-c1-new']))
    expect(currentAdoptedMessageIds({ ...legacy, rejected: true, adoptedId: null })).toEqual(new Set())
    // 投递史里找不到对应那一份（比如只是跑完还没拍板）：判不出来 → null（不过滤）
    expect(currentAdoptedMessageIds({ adoptedId: 'c9', rejected: false, deliveries: legacy.deliveries })).toBeNull()
  })
})
