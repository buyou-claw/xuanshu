/**
 * 票 08 · `bazi.timezone`（契约 §2 方法面 / §4 时区推导）
 *
 * 抓的真实缺陷/风险：
 *   ① **历史 DST 不许硬编码**：`Asia/Shanghai` 在 1986-05-04 ~ 1991-09-15 实行过夏令时，
 *      1990-06-01 的偏移是 **+09:00（540 分）**，1985-06-01 与 1990-09-16 都是 +08:00（480 分）。
 *      「中国 = +08:00」这种写死的实现会把 1990 年出生的人整体算错一小时 —— 而真太阳时
 *      与四柱都建在这个偏移上。判据只能来自 ICU（`Intl`），本用例是它的人口级回归。
 *   ② **越界 / (0,0) / 非数必须落 null，不许猜一个时区**：(0,0) 在 tz-lookup 里返回 `Etc/GMT`
 *      （几内亚湾海面），拿它当出生地时区是**编造**。契约 §4 要求界面上还能落回「手改时区」，
 *      所以这三类一律 `zone:null`。
 *   ③ **DST 的判据要含南半球**：`Australia/Sydney` 一月是夏令时、七月不是 ——
 *      「夏天 = 夏令时」的北半球写法在这里会反。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createBaziMethods } from '../../packages/xuanshu-host/lib/bazi/service.mjs'
import { makeSandbox, makeCtx } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 起一套 `bazi.*` 方法（本用例只用 `bazi.timezone`：不落盘、不调 horosa）。 */
function methods() {
  const sandbox = makeSandbox('timezone')
  roots.push(sandbox)
  return createBaziMethods(makeCtx({}), { dataDir: sandbox.dataDir })
}

/** 上海（出生地样例，与票 06 fixture 同一份坐标）。 */
const SHANGHAI = { lat: 31.2304, lon: 121.4737 }

describe('bazi.timezone · 坐标 → IANA zone（契约 §4）', () => {
  const TABLE = [
    ['上海', SHANGHAI, 'Asia/Shanghai'],
    ['纽约', { lat: 40.71427, lon: -74.00597 }, 'America/New_York'],
    ['伦敦', { lat: 51.5074, lon: -0.1278 }, 'Europe/London'],
    ['东京', { lat: 35.6895, lon: 139.69171 }, 'Asia/Tokyo'],
    ['悉尼（南半球）', { lat: -33.8688, lon: 151.2093 }, 'Australia/Sydney'],
  ]
  for (const [label, coords, zone] of TABLE) {
    it(`${label} → ${zone}`, async () => {
      const result = await methods()['bazi.timezone']({ ...coords, date: '2024-07-01' })
      expect(result.zone).toBe(zone)
    })
  }

  it('坐标可以是数字字符串（表单里坐标常常就是文本），归一后同样算得出', async () => {
    const result = await methods()['bazi.timezone']({ lat: '31.2304', lon: '121.4737', date: '2024-07-01', time: '04:00' })
    expect(result.zone).toBe('Asia/Shanghai')
    expect(result.offsetMinutes).toBe(480)
  })
})

describe('bazi.timezone · 含 DST 的偏移（契约 §4：Intl，不硬编码）', () => {
  // 期望值来自 ICU（Node 24 自带完整 tzdata），不是从实现里回读的：
  //   Asia/Shanghai 1990-06-01 = GMT+09:00、1990-09-16 = GMT+08:00、1985-06-01 = GMT+08:00
  //   America/New_York 2024-01-15 = GMT-05:00、2024-07-01 = GMT-04:00
  //   Europe/London 2024-01-15 = GMT+00:00、2024-07-01 = GMT+01:00
  //   Australia/Sydney 2024-01-15 = GMT+11:00、2024-07-01 = GMT+10:00
  const TABLE = [
    ['上海 1990-06-01（中国大陆 1986–1991 夏令时）', SHANGHAI, '1990-06-01', 540, true],
    ['上海 1990-09-16（夏令时当天结束）', SHANGHAI, '1990-09-16', 480, false],
    ['上海 1985-06-01（夏令时实行之前）', SHANGHAI, '1985-06-01', 480, false],
    ['上海 1990-01-01（冬令）', SHANGHAI, '1990-01-01', 480, false],
    ['上海 2024-06-01（现在不实行夏令时）', SHANGHAI, '2024-06-01', 480, false],
    ['纽约 2024-01-15（冬令）', { lat: 40.71427, lon: -74.00597 }, '2024-01-15', -300, false],
    ['纽约 2024-07-01（夏令）', { lat: 40.71427, lon: -74.00597 }, '2024-07-01', -240, true],
    ['伦敦 2024-01-15（冬令）', { lat: 51.5074, lon: -0.1278 }, '2024-01-15', 0, false],
    ['伦敦 2024-07-01（夏令）', { lat: 51.5074, lon: -0.1278 }, '2024-07-01', 60, true],
    ['悉尼 2024-01-15（南半球夏令）', { lat: -33.8688, lon: 151.2093 }, '2024-01-15', 660, true],
    ['悉尼 2024-07-01（南半球冬令）', { lat: -33.8688, lon: 151.2093 }, '2024-07-01', 600, false],
  ]
  for (const [label, coords, date, offsetMinutes, dst] of TABLE) {
    it(`${label} → ${offsetMinutes} 分 / dst=${dst}`, async () => {
      const result = await methods()['bazi.timezone']({ ...coords, date })
      expect(result.zone).toBeTruthy()
      expect(result.offsetMinutes).toBe(offsetMinutes)
      expect(result.dst).toBe(dst)
    })
  }

  it('带上出生时刻也不改变当天偏移（同一日内偏移恒定）', async () => {
    const withTime = await methods()['bazi.timezone']({ ...SHANGHAI, date: '1990-06-01', time: '04:00' })
    expect(withTime.offsetMinutes).toBe(540)
    expect(withTime.dst).toBe(true)
  })
})

describe('bazi.timezone · 无效坐标一律 null（契约 §4：界面落回手改时区）', () => {
  const INVALID = [
    ['(0,0) 海面无意义', { lat: 0, lon: 0 }],
    ['纬度越界', { lat: 91, lon: 121 }],
    ['纬度越界（负）', { lat: -90.5, lon: 121 }],
    ['经度越界', { lat: 31, lon: 181 }],
    ['经度越界（负）', { lat: 31, lon: -180.5 }],
    ['经纬度都不是数', { lat: 'x', lon: 'y' }],
    ['只有纬度', { lat: 31.2 }],
    ['缺经纬度', {}],
    ['null 经纬度', { lat: null, lon: null }],
  ]
  for (const [label, coords] of INVALID) {
    it(`${label} → zone/offsetMinutes/dst 全 null（不报错、不猜）`, async () => {
      const result = await methods()['bazi.timezone']({ ...coords, date: '1990-06-01' })
      expect(result).toEqual({ zone: null, offsetMinutes: null, dst: null })
    })
  }

  it('日期缺失或非法 → zone 照给，offset/dst 为 null（坐标本身是有效的，只是当天算不出）', async () => {
    const missing = await methods()['bazi.timezone']({ ...SHANGHAI, date: '' })
    expect(missing.zone).toBe('Asia/Shanghai')
    expect(missing.offsetMinutes).toBe(null)
    expect(missing.dst).toBe(null)

    const broken = await methods()['bazi.timezone']({ ...SHANGHAI, date: '不是日期' })
    expect(broken.zone).toBe('Asia/Shanghai')
    expect(broken.offsetMinutes).toBe(null)
  })
})
