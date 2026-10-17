/**
 * 票 17 · 任务 D：`hourInZone` 的午夜归一（原来那句里的 `hour === 24` 是**死分支**）
 *
 * 背景：`Intl` 用 `hour12: false` 时，某些 ICU/Node 组合把午夜给成 `"24"`（与 `"0"` 同一时刻）。
 * 原实现写成 `if (hour >= 0 && hour <= 23) return hour === 24 ? 0 : hour` —— `hour <= 23` 已经把 24
 * 挡在门外，那个三元**永远不执行**：真遇到 `"24"` 时会掉到 UTC 兜底分支，把「本地 0 点」当成「UTC 0 点」。
 *
 * 这条用例钉两件事：
 *   ① 归一函数本身（`24 → 0` 是**活的**分支；`25`/小数/非数/空值 → `null` 交给兜底）；
 *   ② `hourInZone` 在真时区上的午夜仍然给 0（东八区 00:30 = UTC 前一天 16:30 → 本地 0 点）。
 */
import { describe, expect, it } from 'vitest'

import { hourInZone, normalizeHour } from '../../packages/xuanshu-host/lib/rikke/store.mjs'

describe('票17 · normalizeHour（把午夜 24 点归一到 0）', () => {
  it('24 → 0（这就是原来那句死分支想做的事）', () => {
    expect(normalizeHour('24')).toBe(0)
    expect(normalizeHour(24)).toBe(0)
  })

  it('0..23 原样通过；字符串形式也给同一个数（Intl 给的就是字符串）', () => {
    expect(normalizeHour('00')).toBe(0)
    expect(normalizeHour('07')).toBe(7)
    expect(normalizeHour(23)).toBe(23)
    expect(normalizeHour('23')).toBe(23)
  })

  it('认不出 → null（25 / 小数 / 非数 / 空值 一律交给 UTC 兜底，不猜）', () => {
    expect(normalizeHour('25')).toBeNull()
    expect(normalizeHour(7.5)).toBeNull()
    expect(normalizeHour('七点')).toBeNull()
    expect(normalizeHour(undefined)).toBeNull()
    expect(normalizeHour(null)).toBeNull()
    // 关键一条：`Number('')` 是 0 —— 不挡住就会把「没读到小时」当成「本地 0 点」。
    expect(normalizeHour('')).toBeNull()
  })
})

describe('票17 · hourInZone 在午夜仍给 0（本地 0 点不许被当成 UTC 0 点）', () => {
  it('Asia/Shanghai 的 00:30 → 0（不是 16，也不是 24）', () => {
    // 2026-10-14T16:30Z = 2026-10-15 00:30 +08:00
    expect(hourInZone('Asia/Shanghai', new Date('2026-10-14T16:30:00.000Z'))).toBe(0)
  })

  it('固定偏移 `+08:00`（底座里存的那种形状）同样给 0', () => {
    expect(hourInZone('+08:00', new Date('2026-10-14T16:30:00.000Z'))).toBe(0)
  })

  it('时区名认不出 → 落 UTC 小时（不抛）', () => {
    expect(hourInZone('Not/AZone', new Date('2026-10-14T16:30:00.000Z'))).toBe(16)
  })
})
