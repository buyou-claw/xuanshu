/**
 * S4（复核 2026-10-17）· 「到点 → 生成 → 触达」的**一段共用骨架**。
 *
 * 复核发现 `rikke/delivery.mjs` 里 `runRikke` / `runWansheng` 是两段几乎逐字相同的骨架
 * （解析 occurrence → 算日期 → 判补 → 生成 → 记日志 → 投递 → 记账失败/通知失败各记一笔）。
 * 两段各写一份的最坏形态是「日课补了推送、晚省没补」这类只在一边发生的行为漂移。
 *
 * 本文件钉住共用骨架的行为（不是它的实现形状）：
 *   - 日期取 **occurrence** 在时区里的那一天（解析不出才退回投递时刻）；
 *   - 迟到 > 30 分钟判 `missed`，并把 `occurrenceAt`（ISO 或 null）交给投递方；
 *   - 生成失败**不投递**、如实记理由；投递失败/记账失败只记日志，**永不抛**（不拖垮那一轮）。
 */
import { describe, expect, it } from 'vitest'

import { runTouchChain } from '../../packages/xuanshu-host/lib/rikke/delivery.mjs'

const ZONE = 'UTC'

/** 收集日志的假 logger（`info` / `warn` 都记下来）。 */
function recorder() {
  const lines = []
  return {
    lines,
    logger: {
      info: (...args) => lines.push(['info', ...args]),
      warn: (...args) => lines.push(['warn', ...args]),
    },
  }
}

/** 记录调用参数的假生成 / 假投递。 */
function scene({ generated, touch } = {}) {
  const calls = { generate: [], deliver: [] }
  const { lines, logger } = recorder()
  return {
    calls,
    lines,
    logger,
    generate: async (input) => {
      calls.generate.push(input)
      return generated ?? { ok: true, date: input.date }
    },
    deliver: async (input) => {
      calls.deliver.push(input)
      return touch ?? { notify: { status: 'delivered', reason: null }, ledgerError: null }
    },
  }
}

describe('S4 · 共用触达骨架：日期 / 补 / 投递参数', () => {
  it('日期取 occurrence 那一天（不是投递时刻那一天），准时 → missed:false，occurrenceAt 是 ISO', async () => {
    const s = scene()
    await runTouchChain({
      label: '日课',
      logger: s.logger,
      zone: ZONE,
      moment: new Date('2026-10-16T23:31:00.000Z'),
      occurrence: { at: new Date('2026-10-16T23:30:00.000Z') },
      generate: s.generate,
      deliver: s.deliver,
    })
    expect(s.calls.generate).toEqual([{ date: '2026-10-16', missed: false }])
    expect(s.calls.deliver).toEqual([{
      date: '2026-10-16',
      missed: false,
      occurrenceAt: '2026-10-16T23:30:00.000Z',
    }])
  })

  it('迟到 > 30 分钟 → missed:true，但日期仍是 occurrence 那一天（补的是那一天的事）', async () => {
    const s = scene()
    await runTouchChain({
      label: '晚省',
      logger: s.logger,
      zone: ZONE,
      moment: new Date('2026-10-17T02:00:00.000Z'),
      occurrence: { at: new Date('2026-10-16T21:30:00.000Z') },
      generate: s.generate,
      deliver: s.deliver,
    })
    expect(s.calls.generate).toEqual([{ date: '2026-10-16', missed: true }])
    expect(s.calls.deliver[0].missed).toBe(true)
    expect(s.calls.deliver[0].date).toBe('2026-10-16')
  })

  it('occurrence 解析不出（at:null）→ 退回投递时刻，occurrenceAt 为 null', async () => {
    const s = scene()
    await runTouchChain({
      label: '日课',
      logger: s.logger,
      zone: ZONE,
      moment: new Date('2026-10-17T00:05:00.000Z'),
      occurrence: { at: null },
      generate: s.generate,
      deliver: s.deliver,
    })
    expect(s.calls.generate).toEqual([{ date: '2026-10-17', missed: false }])
    expect(s.calls.deliver[0]).toMatchObject({ date: '2026-10-17', missed: false, occurrenceAt: null })
  })
})

describe('S4 · 共用触达骨架：失败路径（不投递 / 不抛 / 理由可见）', () => {
  it('生成失败 → 不投递，warn 里带 label、日期与可读理由', async () => {
    const s = scene()
    const generated = { ok: false, date: '2026-10-16', reason: '底座没有立起来' }
    await runTouchChain({
      label: '日课',
      logger: s.logger,
      zone: ZONE,
      moment: new Date('2026-10-16T23:30:00.000Z'),
      occurrence: { at: new Date('2026-10-16T23:30:00.000Z') },
      generate: async () => generated,
      deliver: s.deliver,
    })
    expect(s.calls.deliver).toEqual([])
    const warned = s.lines.filter((line) => line[0] === 'warn').map((line) => line.join(' '))
    expect(warned).toHaveLength(1)
    expect(warned[0]).toContain('日课')
    expect(warned[0]).toContain('2026-10-16')
    expect(warned[0]).toContain('底座没有立起来')
  })

  it('记账失败 / 通知失败各记一笔，且都提到 label（不静默）', async () => {
    const s = scene({
      touch: { notify: { status: 'failed', reason: '系统通知被关掉了' }, ledgerError: 'ENOSPC' },
    })
    await runTouchChain({
      label: '晚省',
      logger: s.logger,
      zone: ZONE,
      moment: new Date('2026-10-16T21:30:00.000Z'),
      occurrence: { at: new Date('2026-10-16T21:30:00.000Z') },
      generate: s.generate,
      deliver: s.deliver,
    })
    const warned = s.lines.filter((line) => line[0] === 'warn').map((line) => line.join(' '))
    expect(warned.some((line) => line.includes('ENOSPC') && line.includes('晚省'))).toBe(true)
    expect(warned.some((line) => line.includes('系统通知被关掉了') && line.includes('晚省'))).toBe(true)
  })

  it('生成 / 投递抛异常都不外抛（这一轮不能被定时链弄挂）', async () => {
    const s = scene()
    await expect(runTouchChain({
      label: '日课',
      logger: s.logger,
      zone: ZONE,
      moment: new Date('2026-10-16T23:30:00.000Z'),
      occurrence: { at: new Date('2026-10-16T23:30:00.000Z') },
      generate: async () => {
        throw new Error('horosa 挂了')
      },
      deliver: s.deliver,
    })).resolves.toBeUndefined()
    expect(s.calls.deliver).toEqual([])
    expect(s.lines.map((line) => line.join(' ')).some((line) => line.includes('horosa 挂了'))).toBe(true)

    const s2 = scene()
    await expect(runTouchChain({
      label: '晚省',
      logger: s2.logger,
      zone: ZONE,
      moment: new Date('2026-10-16T21:30:00.000Z'),
      occurrence: { at: new Date('2026-10-16T21:30:00.000Z') },
      generate: s2.generate,
      deliver: async () => {
        throw new Error('回环端点没了')
      },
    })).resolves.toBeUndefined()
    expect(s2.lines.map((line) => line.join(' ')).some((line) => line.includes('回环端点没了'))).toBe(true)
  })
})
