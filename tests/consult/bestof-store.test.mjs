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

import { adoptedDraftRounds, currentAdoptedMessageIds, migrateLegacyDecisions } from '../../packages/xuanshu-host/lib/consult/bestof-store.mjs'

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

describe('采用稿账本 · 跨轮 / 否决后重采（复核 32216d9 的 R2 / R3）', () => {
  it('R2：两轮各自采用一份 → 两份都算当前采用稿（整场会话不是只留一稿）', () => {
    // 复核 32216d9 的 R2 反例：run#1 采用 DRAFT_9、run#2 采用 DRAFT_11，两轮都没否决；
    // 原实现从末尾倒着找**第一条** adopted 就返回，于是第一轮那份被历史过滤掉
    // （真实 Loop 实测 promptHasFirstRun=false / promptHasSecondRun=true）。
    const twoRuns = {
      draftLedger: [
        { kind: 'adopted', messageId: 'm-run1-c1', runId: 'bestof-r1' },
        { kind: 'adopted', messageId: 'm-run2-c1', runId: 'bestof-r2' },
      ],
    }
    expect(currentAdoptedMessageIds(twoRuns)).toEqual(new Set(['m-run1-c1', 'm-run2-c1']))
  })

  it('R3：同轮 c1 → reject → c2 → 返回 c2（按每轮**最后**一个决定，不是「曾经被否决」）', () => {
    const readopt = {
      draftLedger: [
        { kind: 'adopted', messageId: 'm-c1', runId: 'bestof-r1' },
        { kind: 'rejected', runId: 'bestof-r1' },
        { kind: 'adopted', messageId: 'm-c2', runId: 'bestof-r1' },
      ],
    }
    expect(currentAdoptedMessageIds(readopt)).toEqual(new Set(['m-c2']))
  })

  it('R3：同轮 adopted → rejected → 再 adopt c3 → 返回 c3（本轮最后决定是采用）', () => {
    const readoptedAgain = {
      draftLedger: [
        { kind: 'adopted', messageId: 'm-c1', runId: 'bestof-r1' },
        { kind: 'rejected', runId: 'bestof-r1' },
        { kind: 'adopted', messageId: 'm-c3', runId: 'bestof-r1' },
      ],
    }
    expect(currentAdoptedMessageIds(readoptedAgain)).toEqual(new Set(['m-c3']))
  })

  it('R3 与 R2 一起：某轮最后决定是否决，只抹掉**那一轮**，别的轮的采用稿照旧算数', () => {
    const mixed = {
      draftLedger: [
        { kind: 'adopted', messageId: 'm-run1', runId: 'bestof-r1' },
        { kind: 'adopted', messageId: 'm-run2', runId: 'bestof-r2' },
        { kind: 'rejected', runId: 'bestof-r2' },
      ],
    }
    expect(currentAdoptedMessageIds(mixed)).toEqual(new Set(['m-run1']))
  })
})

describe('采用稿账本 · 旧记录迁移（复核 32216d9 的 R4）', () => {
  /** 上一版 `xuanshu/bestof@1` 的合法形态：只有 deliveries / adoptedId / rejected，没有 draftLedger。 */
  const legacyRecord = {
    schema: 'xuanshu/bestof@1',
    runId: 'bestof-old-run',
    adoptedId: 'c2',
    rejected: false,
    deliveries: [
      { candidateId: 'c1', messageId: 'm-c1-old' },
      { candidateId: 'c2', messageId: 'm-c2' },
      { candidateId: 'c1', messageId: 'm-c1-new' },
    ],
  }

  it('没有账本 + 可判定的旧决策 → 合成一条归属「旧轮」的 adopted 条目', () => {
    const ledger = migrateLegacyDecisions(legacyRecord)
    expect(ledger).toHaveLength(1)
    expect(ledger[0].kind).toBe('adopted')
    expect(ledger[0].messageId).toBe('m-c2')
    expect(ledger[0].candidateId).toBe('c2')
    expect(ledger[0].runId).toBe('legacy')
    // 迁移后旧采用稿仍被认作当前采用稿（升级后的首个新 run 必须过滤掉改选前的旧稿）。
    expect(currentAdoptedMessageIds({ ...legacyRecord, draftLedger: ledger })).toEqual(new Set(['m-c2']))
  })

  it('迁移幂等：账本已在就原样返回，重复迁移不多条目', () => {
    const first = migrateLegacyDecisions(legacyRecord)
    const again = migrateLegacyDecisions({ ...legacyRecord, draftLedger: first })
    expect(again).toHaveLength(1)
    expect(again).toEqual(first)
    expect(again[0]).toBe(first[0]) // 原样返回，不是重建一份
    expect(migrateLegacyDecisions({ ...legacyRecord, draftLedger: again })).toHaveLength(1)
  })

  it('迁移后新 run 采用另一份 → 两份都在（旧轮的与新一轮的各算各的）', () => {
    const inherited = migrateLegacyDecisions(legacyRecord)
    const afterNewRunAdopt = [...inherited, { kind: 'adopted', messageId: 'm-run-new', runId: 'bestof-new-run' }]
    expect(currentAdoptedMessageIds({ ...legacyRecord, draftLedger: afterNewRunAdopt })).toEqual(new Set(['m-c2', 'm-run-new']))
  })

  it('判不出采用但**可判定为「这一轮不作数」**的旧决策：落否决哨兵，不许翻成「不过滤」', () => {
    // 复核 32216d9 追加复核的 SP-2：迁移前这两种形状都是**过滤**（空集 / 空集），迁移后若返回空账本，
    // 消费方会退回「不过滤」——语义翻转，旧采用稿在第二个新 run 重新混进候选历史。
    const rejectedOf = (record) => {
      const ledger = migrateLegacyDecisions(record)
      expect(ledger).toHaveLength(1)
      expect(ledger[0]).toMatchObject({ kind: 'rejected', runId: 'legacy' })
      return currentAdoptedMessageIds({ ...record, draftLedger: ledger })
    }
    expect(rejectedOf({ ...legacyRecord, adoptedId: null, rejected: true })).toEqual(new Set())
    expect(rejectedOf({ ...legacyRecord, adoptedId: 'c9' })).toEqual(new Set())
    // 迁移前后一致（迁移前走老 fallback：否决 ⇒ 空集、找不到投递 ⇒ 不过滤/空集，都算不出采用稿）。
    expect(currentAdoptedMessageIds({ ...legacyRecord, adoptedId: null, rejected: true })).toEqual(new Set())
  })

  it('还没拍板的旧记录：不合成条目（空账本 + 老字段 ⇒ 退回当次决策）', () => {
    expect(migrateLegacyDecisions({ ...legacyRecord, adoptedId: null })).toEqual([])
    expect(migrateLegacyDecisions(undefined)).toEqual([])
    expect(migrateLegacyDecisions(null)).toEqual([])
    // 空账本 + 老字段仍退回当次决策（老 fallback 语义不丢）。
    expect(currentAdoptedMessageIds({ ...legacyRecord, draftLedger: [] })).toEqual(new Set(['m-c2']))
    expect(currentAdoptedMessageIds({ ...legacyRecord, adoptedId: null, rejected: true, draftLedger: [] })).toEqual(new Set())
  })

  it('SP-4：账本**存在但为空**时也要迁移（空数组不等于「已经迁移过」）', () => {
    // 这个形状在现版本内可产生：`bestof.adopt` 先落盘（adoptedId 已写、账本还没追加）、
    // 随后 `deliverAdopted` 抛错。若把空数组当「账本已在」，那次采用就在覆盖写后彻底丢失。
    const ledger = migrateLegacyDecisions({ ...legacyRecord, draftLedger: [] })
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ kind: 'adopted', messageId: 'm-c2', runId: 'legacy' })
    expect(currentAdoptedMessageIds({ ...legacyRecord, draftLedger: ledger })).toEqual(new Set(['m-c2']))
  })

  it('SP-3：没有 runId 的条目**各自成轮**，不许后一条把前一条顶掉（静默丢采用稿）', () => {
    const keyless = {
      draftLedger: [
        { kind: 'adopted', messageId: 'm-keyless-1' },
        { kind: 'adopted', messageId: 'm-keyless-2' },
      ],
    }
    expect(currentAdoptedMessageIds(keyless)).toEqual(new Set(['m-keyless-1', 'm-keyless-2']))
    // 无 runId 的 adopted 与无 runId 的 rejected 也是两轮：否决只抹自己那一条。
    const keylessMixed = {
      draftLedger: [
        { kind: 'adopted', messageId: 'm-keyless-1' },
        { kind: 'rejected' },
      ],
    }
    expect(currentAdoptedMessageIds(keylessMixed)).toEqual(new Set(['m-keyless-1']))
  })
})

/**
 * 回看按轮分组（票 31；Spec 002 §补两处已知缺陷）。
 *
 * 客户端拿到的必须是**每一轮**的结论，而不是全场一条：`currentAdoptedMessageIds()` 只回答
 * 「哪几份算当前」，说不出「这份属于第几轮」。`adoptedDraftRounds()` 把同一份账本摊成轮次表，
 * 于是「按轮分组 + 标当前」在客户端只是一次查表，不必再实现一遍按轮语义（两处各算一遍必然漂移）。
 */
describe('采用稿轮次 · 回看按轮分组与当前性（票 31）', () => {
  it('两轮各采用一份：轮次序号按账本顺序（1 起），两轮都标当前', () => {
    const record = {
      draftLedger: [
        { kind: 'adopted', messageId: 'm-run1', candidateId: 'c1', runId: 'bestof-r1', at: 'T1' },
        { kind: 'rejected', runId: 'bestof-r2' },
        { kind: 'adopted', messageId: 'm-run3', candidateId: 'c2', runId: 'bestof-r3', at: 'T3' },
      ],
    }
    expect(adoptedDraftRounds(record)).toEqual([
      { runId: 'bestof-r1', round: 1, messageIds: ['m-run1'], currentId: 'm-run1', rejected: false },
      { runId: 'bestof-r2', round: 2, messageIds: [], currentId: undefined, rejected: true },
      { runId: 'bestof-r3', round: 3, messageIds: ['m-run3'], currentId: 'm-run3', rejected: false },
    ])
  })

  it('同一轮改选：两份投递都归这一轮，当前只认最后那一份（前一份标成被取代）', () => {
    const record = {
      draftLedger: [
        { kind: 'adopted', messageId: 'm-c1', runId: 'bestof-r1' },
        { kind: 'adopted', messageId: 'm-c2', runId: 'bestof-r1' },
      ],
    }
    expect(adoptedDraftRounds(record)).toEqual([
      { runId: 'bestof-r1', round: 1, messageIds: ['m-c1', 'm-c2'], currentId: 'm-c2', rejected: false },
    ])
  })

  it('同一轮 adopted → rejected → adopted：只认最后一轮的 adopted；被否决的中间态不作数', () => {
    const readopt = {
      draftLedger: [
        { kind: 'adopted', messageId: 'm-c1', runId: 'bestof-r1' },
        { kind: 'rejected', runId: 'bestof-r1' },
        { kind: 'adopted', messageId: 'm-c3', runId: 'bestof-r1' },
      ],
    }
    expect(adoptedDraftRounds(readopt)).toEqual([
      { runId: 'bestof-r1', round: 1, messageIds: ['m-c1', 'm-c3'], currentId: 'm-c3', rejected: false },
    ])
    const rejectedAtEnd = {
      draftLedger: [
        { kind: 'adopted', messageId: 'm-c1', runId: 'bestof-r1' },
        { kind: 'rejected', runId: 'bestof-r1' },
      ],
    }
    expect(adoptedDraftRounds(rejectedAtEnd)).toEqual([
      { runId: 'bestof-r1', round: 1, messageIds: ['m-c1'], currentId: undefined, rejected: true },
    ])
  })

  it('老记录（没有账本）：按迁移规则合成「旧轮」，仍能标出当前那份', () => {
    const legacy = {
      adoptedId: 'c2',
      rejected: false,
      deliveries: [
        { candidateId: 'c1', messageId: 'm-c1-old' },
        { candidateId: 'c2', messageId: 'm-c2' },
      ],
    }
    expect(adoptedDraftRounds(legacy)).toEqual([
      { runId: 'legacy', round: 1, messageIds: ['m-c2'], currentId: 'm-c2', rejected: false },
    ])
  })

  it('没有记录 / 空账本里判不出采用 → 空轮次表（不凭空造轮）', () => {
    expect(adoptedDraftRounds(null)).toEqual([])
    expect(adoptedDraftRounds(undefined)).toEqual([])
    expect(adoptedDraftRounds({ draftLedger: [] })).toEqual([])
    expect(adoptedDraftRounds({ adoptedId: null, draftLedger: [] })).toEqual([])
  })

  it('没有 runId 的条目各自成轮（与 SP-3 同一条口径，不许合成一轮）', () => {
    const rounds = adoptedDraftRounds({
      draftLedger: [
        { kind: 'adopted', messageId: 'm-keyless-1' },
        { kind: 'adopted', messageId: 'm-keyless-2' },
      ],
    })
    expect(rounds.map((row) => row.messageIds)).toEqual([['m-keyless-1'], ['m-keyless-2']])
    expect(rounds.map((row) => row.round)).toEqual([1, 2])
    expect(rounds.every((row) => row.currentId === row.messageIds[0])).toBe(true)
  })

  it('轮次表与当前集合自洽：currentId 并集 === currentAdoptedMessageIds()', () => {
    const record = {
      draftLedger: [
        { kind: 'adopted', messageId: 'm-run1', runId: 'bestof-r1' },
        { kind: 'adopted', messageId: 'm-run2', runId: 'bestof-r2' },
        { kind: 'rejected', runId: 'bestof-r2' },
        { kind: 'adopted', messageId: 'm-run3', runId: 'bestof-r3' },
      ],
    }
    const current = [...adoptedDraftRounds(record).map((row) => row.currentId).filter(Boolean)]
    expect(new Set(current)).toEqual(currentAdoptedMessageIds(record))
  })
})
