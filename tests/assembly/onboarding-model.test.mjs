/**
 * 票 08 · 冷启动向导的纯模型（S3 §2 / §3；冻结契约 §2 / §3）。
 *
 * 断言的都是**能在界面上看见、也能被上游吃进去**的事实：
 *   - `timeAlg` 默认档**省略该键**（契约 §0-2 的客观判据：「payload 里 timeAlg 缺省不出现」）；
 *   - `confirmed: true` 必须由人点确认触发（AI 不许静默出盘，契约 §2）；
 *   - 缺经纬度时**列得出缺什么**（经度 / 纬度），供 §2.6 的禁用理由行逐字展示；
 *   - 度分串 `118e47 / 32n03` 的取整与补零规则（floor + 两位，见上游快照字段 `19N04`）；
 *   - 四分钟粒度 = 1° 经度时差（S3 §3.1③ 明说「不要改写成加减分秒」）。
 *
 * 这一层不 import React，也不碰 document/RPC：向导组件与详情面板都从它取口径，
 * 保证「界面上写的」与「发给底座的」是同一份模型（票 06 的教训：四柱验 timeAlg 恒真）。
 */
import { describe, expect, it } from 'vitest'

import {
  CAST_MISSING_REASON,
  GENDER_OPTIONS,
  NUDGE_GRAINS,
  NOTE_OPTIONS,
  TIME_ALG_OPTIONS,
  TIME_ALG_LABELS,
  UNNAMED_PLACE,
  ZONE_OFFSETS,
  buildCastRequest,
  castBlockers,
  composeNotes,
  defaultDraft,
  draftFromSnapshot,
  formatCoords,
  formatDegreeMinute,
  formatOffsetMinutes,
  genderLabel,
  manualLocation,
  missingCoordinates,
  nudgeDateTime,
  placeLabel,
  timeAlgLabel,
  timeAlgOptionLabel,
} from '../../packages/xuanshu-client/src/client/onboarding-model.ts'

/** 一个「有经纬度、时区已定、已勾核对」的草稿（各用例只改自己关心的那一项）。 */
const ready = () => ({
  ...defaultDraft(),
  date: '1990-06-01',
  time: '04:00',
  place: '上海',
  lon: 121.4737,
  lat: 31.2304,
  zone: 'Asia/Shanghai',
  verified: true,
})

describe('票 08 · 出盘请求（契约 §2 / §3 的口径本体）', () => {
  it('timeAlg 默认档（0 = 真太阳时）**不写进请求**，1 / 3 才透传', () => {
    expect(buildCastRequest(ready()).birth.timeAlg).toBeUndefined()
    expect(buildCastRequest({ ...ready(), timeAlg: 1 }).birth.timeAlg).toBe(1)
    expect(buildCastRequest({ ...ready(), timeAlg: 3 }).birth.timeAlg).toBe(3)
    // 键必须在 birth 里（宿主的 buildBaziPayload 认这个位置）。
    expect(buildCastRequest(ready()).birth).toMatchObject({
      date: '1990-06-01',
      time: '04:00',
      zone: 'Asia/Shanghai',
      lat: 31.2304,
      lon: 121.4737,
      place: '上海',
    })
  })

  it('confirmed 恒为 true：出盘只由人点确认触发（AI 不许静默出盘）', () => {
    expect(buildCastRequest(ready()).confirmed).toBe(true)
  })

  it('clarification_notes：勾了才有、没勾就省（不是拒绝出盘）', () => {
    expect(buildCastRequest(ready()).notes).toBeUndefined()
    expect(composeNotes(['minute'])).toBe('出生时间只精确到分钟')
    expect(composeNotes(['minute', 'place'])).toBe('出生时间只精确到分钟；出生地是大概位置')
    expect(buildCastRequest({ ...ready(), notes: ['place'] }).notes).toBe('出生地是大概位置')
    // 澄清闸的自由回答与勾选项同进 clarification_notes（前者在后，读起来像补充说明）。
    expect(
      buildCastRequest({ ...ready(), notes: ['minute'], gateAnswer: '只知道凌晨 4 点前后' }).notes,
    ).toBe('出生时间只精确到分钟；只知道凌晨 4 点前后')
    expect(NOTE_OPTIONS.map((option) => option.label)).toEqual([
      '出生时间只精确到分钟',
      '出生地是大概位置',
    ])
  })

  it('手输无地名：**不带 place**，也绝不把界面占位词「未命名地点」当事实发出去', () => {
    const request = buildCastRequest({ ...ready(), place: '' })
    expect(request.birth.place).toBeUndefined()
    expect(JSON.stringify(request)).not.toContain(UNNAMED_PLACE)
    expect(placeLabel({ ...ready(), place: '' })).toBe(UNNAMED_PLACE)
    expect(placeLabel(ready())).toBe('上海')
  })

  it('缺经纬度列得出缺什么，理由行写明「不让这种盘生成」，且没有旁路按钮文案', () => {
    const empty = { ...ready(), lon: undefined, lat: undefined }
    expect(missingCoordinates(empty)).toEqual(['经度', '纬度'])
    expect(missingCoordinates({ ...empty, lon: 121.4737 })).toEqual(['纬度'])
    expect(castBlockers(empty)).toContain('coordinates')
    // 缺经纬度时**不构造**出盘请求（宁可没有请求，也不产出一个静默退化的盘）。
    expect(buildCastRequest(empty)).toBeUndefined()
    expect(CAST_MISSING_REASON).toContain('缺：经度 / 纬度')
    expect(CAST_MISSING_REASON).toContain('悄悄退回钟表口径')
    expect(CAST_MISSING_REASON).not.toContain('继续出盘')
  })

  it('时区缺失 / 未勾核对也是阻塞项（各自有理由），全部满足才可出盘', () => {
    expect(castBlockers({ ...ready(), zone: '' })).toEqual(['zone'])
    expect(castBlockers({ ...ready(), verified: false })).toEqual(['verified'])
    expect(castBlockers({ ...ready(), verified: true })).toEqual([])
    expect(buildCastRequest({ ...ready(), zone: '', verified: false })).toBeUndefined()
    expect(buildCastRequest({ ...ready(), verified: true })).toBeDefined()
  })

  it('时区可以手改成固定偏移串（上游引擎对 `+HH:MM` 同款语义），改完不算缺时区', () => {
    const manual = { ...ready(), zone: '+06:00', zoneManual: true, verified: true }
    expect(castBlockers(manual)).toEqual([])
    expect(buildCastRequest(manual).birth.zone).toBe('+06:00')
  })
})

describe('票 08 · 度分串与地名（S3 §2.2③ / S2 §2.1②，防脏状态）', () => {
  it('度分串取整为 floor + 两位补零，方向后缀小写（与屏稿线框逐字一致）', () => {
    // 屏稿例子：南京 `<城市> 118e47 / 32n03`（118.7969 → 47′、32.0603 → 03′）。
    expect(formatDegreeMinute(118.7969, 'e', 'w')).toBe('118e47')
    expect(formatDegreeMinute(32.0603, 'n', 's')).toBe('32n03')
    expect(formatCoords(118.7969, 32.0603)).toBe('118e47 / 32n03')
    // 西经 / 南纬走另一侧后缀，且不带负号（-46.6333 = 46°37.998′ → 截断为 37′）。
    expect(formatCoords(-46.6333, -23.5505)).toBe('46w37 / 23s33')
    expect(formatDegreeMinute(-0.1278, 'e', 'w')).toBe('0w07')
  })

  it('手输经纬：经度在前、纬度在后；非法值返回 null（调用方据此忽略、不回填旧地名）', () => {
    expect(manualLocation('118.78', '32.06')).toEqual({ lon: 118.78, lat: 32.06 })
    expect(manualLocation(' 118.78 ', '32.06')).toEqual({ lon: 118.78, lat: 32.06 })
    expect(manualLocation('abc', '32.06')).toBeUndefined()
    expect(manualLocation('118.78', '')).toBeUndefined()
    // 越界值不算坐标（经度 ±180、纬度 ±90）。
    expect(manualLocation('200', '32.06')).toBeUndefined()
    expect(manualLocation('118.78', '95')).toBeUndefined()
  })
})

describe('票 08 · 时区偏移表与时间微调（S3 §2.3② / §3.1③）', () => {
  it('固定 UTC 偏移表 28 档，含半区 +05:30 / -07:30（照抄上游 GeoCoordSelector 的表）', () => {
    expect(ZONE_OFFSETS).toHaveLength(28)
    expect(ZONE_OFFSETS[0]).toEqual({ value: '+00:00', label: '东0区' })
    expect(ZONE_OFFSETS.map((row) => row.value)).toContain('+05:30')
    expect(ZONE_OFFSETS.map((row) => row.value)).toContain('-07:30')
    expect(ZONE_OFFSETS.map((row) => row.value)).toContain('+12:00')
    expect(ZONE_OFFSETS.map((row) => row.value)).toContain('-11:00')
  })

  it('四分钟粒度 = 1° 经度时差；跨小时 / 跨日进位正确', () => {
    expect(NUDGE_GRAINS.map((grain) => grain.label)).toEqual(['年', '月', '天', '小时', '四分钟'])
    const minute = NUDGE_GRAINS.find((grain) => grain.id === 'fourMinute')
    expect(minute.minutes).toBe(4)
    expect(nudgeDateTime('1990-01-01', '04:00', 'fourMinute', 1)).toEqual({
      date: '1990-01-01',
      time: '04:04',
    })
    expect(nudgeDateTime('1990-01-01', '23:58', 'fourMinute', 1)).toEqual({
      date: '1990-01-02',
      time: '00:02',
    })
    expect(nudgeDateTime('1990-01-01', '04:00', 'hour', -1)).toEqual({
      date: '1990-01-01',
      time: '03:00',
    })
    // 跨日：00:30 往前一小时要退到昨天（日期与时刻同时进位）。
    expect(nudgeDateTime('1990-01-01', '00:30', 'hour', -1)).toEqual({
      date: '1989-12-31',
      time: '23:30',
    })
    expect(nudgeDateTime('1990-01-01', '04:00', 'year', 1).date).toBe('1991-01-01')
    expect(nudgeDateTime('1990-01-31', '04:00', 'month', 1).date).toBe('1990-03-03')
    expect(nudgeDateTime('1990-01-01', '04:00', 'day', 1).date).toBe('1990-01-02')
  })
})

describe('票 08 · 起盘口径文案与档位（S3 §2.4 / S2 §3.6）', () => {
  it('三档只在界面出现 0 / 1 / 3，且 0 档文案写明「缺省省略 = 0」', () => {
    expect(TIME_ALG_OPTIONS.map((option) => option.value)).toEqual([0, 1, 3])
    expect(timeAlgOptionLabel(0)).toContain('真太阳时（经度 + 均时差）')
    expect(timeAlgOptionLabel(0)).toContain('= 0')
    expect(TIME_ALG_LABELS[1]).toBe('直接时间（钟表时）')
    expect(TIME_ALG_LABELS[3]).toBe('平太阳时（仅经度差）')
    // 春分定卯时（=2）上游未实现：界面上不出现，也不置灰。
    expect(TIME_ALG_OPTIONS.map((option) => option.value)).not.toContain(2)
    expect(timeAlgLabel(2)).toBe('未知档位')
  })

  it('时间算法档位文案与偏移显示格式（契约 §2 的 offsetMinutes → +HH:MM）', () => {
    expect(formatOffsetMinutes(540)).toBe('+09:00')
    expect(formatOffsetMinutes(480)).toBe('+08:00')
    expect(formatOffsetMinutes(-330)).toBe('-05:30')
    expect(formatOffsetMinutes(0)).toBe('+00:00')
    expect(formatOffsetMinutes(null)).toBe('—')
  })

  it('性别三档含「未知（按男排）」的后果说明', () => {
    expect(GENDER_OPTIONS.map((option) => option.label)).toEqual(['未知（按男排）', '女', '男'])
    expect(genderLabel('unknown')).toBe('未知（按男排）')
    expect(genderLabel('female')).toBe('女')
    expect(genderLabel('male')).toBe('男')
  })
})

describe('票 08 · 重录预填（S2 §5.4「五步全部预填现值」）', () => {
  it('从快照回填草稿：五步的初始值都来自现值', () => {
    const draft = draftFromSnapshot({
      birth: {
        date: '1990-06-01',
        time: '04:00',
        zone: 'Asia/Shanghai',
        lat: 31.2304,
        lon: 121.4737,
        place: '上海',
        timeAlg: 0,
      },
    })
    expect(draft).toMatchObject({
      date: '1990-06-01',
      time: '04:00',
      zone: 'Asia/Shanghai',
      lat: 31.2304,
      lon: 121.4737,
      place: '上海',
      timeAlg: 0,
    })
    // 重录是写操作：进入时必须重新勾核对（上一次的确认不能顺延到下一条盘）。
    expect(draft.verified).toBe(false)
    expect(missingCoordinates(draft)).toEqual([])
  })

  it('快照缺项时给安全缺省（不编造坐标，缺就是缺）', () => {
    const draft = draftFromSnapshot({})
    expect(draft.lon).toBeUndefined()
    expect(draft.lat).toBeUndefined()
    expect(missingCoordinates(draft)).toEqual(['经度', '纬度'])
    expect(draft.zone).toBe('')
    expect(draft.timeAlg).toBe(0)
  })
})
