/**
 * P3 · `buildBaziPayload` 表驱动（纯单测，零网络、零子进程）
 *
 * 判据出处：契约 §4.1 + §5 P3 + S3 §D4（v1 只透传出生信息 9 键 + `timeAlg`）。
 *
 * 抓的真实缺陷/风险（每条断言都对着一次可能的静默退化）：
 *   ① **缺 lat/lon 必须拒绝出盘**（spec:70「防静默退化为钟表口径」）—— 上游缺经度会**静默**按钟表时算，
 *      用户永远不知道自己的盘少了一道校正；所以这里不只断言 `missing` 里有它，还断言**没有 payload**。
 *   ② **缺省或 0 的 `timeAlg` 必须省略该键**（不是写 0）—— 写 0 与省略在真机上现在同果，
 *      但一旦上游改缺省值，显式 0 会把老代码钉在旧口径上；S3 §3.4 明写「实现上省略该键」。
 *   ③ **其余 10 键一律不进 payload**（南半球月令/神煞主位/命宫起法/晚子时两开关/…）——
 *      界面不呈现的旋钮却透传下去，等于用户在不知道自己选了什么的条件下改变了结果。
 *   ④ **确认闸必须默认注入**：不带 `agent_confirmed_settings:true` 的调用会被上游澄清闸拦截，
 *      所以「默认注入」是出盘能成功的前提；`agentConfirmed:false` 是唯一例外（要走拦截路径）。
 */
import { describe, expect, it } from 'vitest'

import { buildBaziPayload } from '../../packages/xuanshu-host/lib/horosa/bazi.mjs'

/** 出生信息（固定合成生日 1990-01-01 12:00 +08:00 上海，与票 05 的 fixture 同一份，非真人）。 */
const BIRTH = { date: '1990-01-01', time: '12:00', zone: '+08:00', lat: '31n14', lon: '121e29' }
/** 契约 §4.1「其余 10 键」+ `byLon`（真机 `input_normalized` 里也有它，v1 同样不透传）。 */
const OMITTED_ONLY_KEYS = {
  phaseType: 0,
  godKeyPos: '年',
  after23NewDay: 1,
  lateZiHourUseNextDay: 1,
  adjustJieqi: false,
  minggongMethod: 'tongxing',
  fenyeVersion: 1,
  southMonth: 'none',
  cangVersion: 'common',
  dayunPrecision: 'year',
  byLon: false,
}
/** payload 允许出现的**全部**键（多一个都算透传了界面不给的旋钮）。 */
const ALLOWED_KEYS = ['date', 'time', 'zone', 'lat', 'lon', 'timeAlg', 'gender', 'agent_confirmed_settings', 'defaults_accepted', 'clarification_notes']

describe('P3 · buildBaziPayload 表驱动', () => {
  it('必填齐全 → ok，payload 含出生信息 + 确认闸，且**不含 timeAlg 键**（缺省即省略）', () => {
    const result = buildBaziPayload({ ...BIRTH })
    expect(result.ok).toBe(true)
    expect(result.payload).toBeTypeOf('object')
    for (const key of ['date', 'time', 'zone', 'lat', 'lon']) {
      expect(result.payload[key], `payload 少了必填键 ${key}`).toBe(BIRTH[key])
    }
    // ③ 缺省 = 省略该键（不是写 0）。
    expect(Object.prototype.hasOwnProperty.call(result.payload, 'timeAlg')).toBe(false)
    expect(result.omitted).toContain('timeAlg')
    // ④ 确认闸默认注入。
    expect(result.payload.agent_confirmed_settings).toBe(true)
    expect(typeof result.payload.clarification_notes).toBe('string')
    expect(result.payload.clarification_notes.length).toBeGreaterThan(0)
    // 键集合整体封住（多余键 = 透传了不该透传的旋钮）。
    expect(Object.keys(result.payload).filter((key) => !ALLOWED_KEYS.includes(key))).toEqual([])
  })

  it('显式 timeAlg=0 → 仍然省略（0 与缺省同果：都不写键），且 omitted 含 timeAlg', () => {
    const result = buildBaziPayload({ ...BIRTH, timeAlg: 0 })
    expect(result.ok).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(result.payload, 'timeAlg')).toBe(false)
    expect(result.omitted).toContain('timeAlg')
  })

  for (const timeAlg of [1, 3]) {
    it(`显式 timeAlg=${timeAlg} → 透传，且 omitted 里**不含** timeAlg`, () => {
      const result = buildBaziPayload({ ...BIRTH, timeAlg })
      expect(result.ok).toBe(true)
      expect(result.payload.timeAlg).toBe(timeAlg)
      expect(result.omitted).not.toContain('timeAlg')
    })
  }

  // 明确非法：契约 §4.1「只接受 0/1/3」——`2`（春分定卯时，上游自身未实现）尤其要拦（S3 §3.4）。
  for (const timeAlg of [2, 4, -1, '2', 'true', 'x']) {
    it(`非法 timeAlg=${JSON.stringify(timeAlg)} → code invalid-time-alg，且不产出 payload`, () => {
      const result = buildBaziPayload({ ...BIRTH, timeAlg })
      expect(result.ok).toBe(false)
      expect(result.code).toBe('invalid-time-alg')
      expect(result.payload === undefined || result.payload === null, '拒绝时不许留下半成品 payload').toBe(true)
    })
  }

  // 「键在但没值」的三种写法（`null` / 空串 / 键不存在）：契约 §4.1 只说「缺省或 0 → 省略」。
  // 2026-10-13 与 T1 对齐后定死为：**都算缺省 → 省略该键**（不报错、不写 0）。
  // 理由：界面「没选档」就是没值，判成非法会让默认档的用户出不了盘；而静默写 0 会把老代码钉在旧口径上。
  // 这条是**实现的既有口径**，也写进了 tests/horosa/README.md 的分歧表（Lead 若要反过来，改一行实现 + 一行测试）。
  for (const [label, timeAlg] of [['undefined', undefined], ['null', null], ['空串', '']]) {
    it(`timeAlg=${label} 视为缺省 → 省略该键（不报错、不写 0）`, () => {
      const result = buildBaziPayload({ ...BIRTH, timeAlg })
      expect(result.ok, `timeAlg=${label} 被当成非法值了`).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(result.payload, 'timeAlg'), `timeAlg=${label} 该被省略`).toBe(false)
      expect(result.omitted).toContain('timeAlg')
    })
  }

  // 数字字符串（'1' / '3'）：契约 §4.1 的字面是「只接受 0/1/3」，实现的归一化**收数字字符串**。
  // 这条断言不争论字面，只钉死行为：要么按非法拒掉，要么**归一化成数字**透传 ——
  // 两者都接受，但「把 '1' 静默丢掉（退化成真太阳时）」是绝对不许的（那是用户看不见的口径漂移）。
  for (const [raw, numeric] of [['1', 1], ['3', 3]]) {
    it(`timeAlg=${JSON.stringify(raw)}（数字字符串）→ 要么拒，要么归一化成 ${numeric} 透传；不许静默省略`, () => {
      const result = buildBaziPayload({ ...BIRTH, timeAlg: raw })
      if (result.ok === false) {
        expect(result.code).toBe('invalid-time-alg')
        return
      }
      expect(result.payload.timeAlg, `timeAlg=${JSON.stringify(raw)} 被接受却没透传（= 静默退化成真太阳时）`).toBe(numeric)
      expect(typeof result.payload.timeAlg).toBe('number')
      expect(result.omitted).not.toContain('timeAlg')
    })
  }

  // ② 缺 lat/lon 一律拒绝出盘（spec:70：缺经纬度禁止出盘）。
  for (const missingKey of ['date', 'time', 'zone', 'lat', 'lon']) {
    it(`缺 ${missingKey} → code missing-birth-fields、missing 点名它、**不产出 payload**`, () => {
      const input = { ...BIRTH }
      delete input[missingKey]
      const result = buildBaziPayload(input)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('missing-birth-fields')
      expect(result.missing).toContain(missingKey)
      expect(result.payload ?? null, '缺经纬度还产出了 payload —— 正是 spec:70 禁止的静默退化').toBe(null)
    })
  }

  it('lat/lon 传空串/纯空白也算缺（不是「有值但非法」的漏洞）', () => {
    for (const blank of ['', '   ']) {
      const result = buildBaziPayload({ ...BIRTH, lat: blank })
      expect(result.ok, `lat=${JSON.stringify(blank)} 被当成了有效值`).toBe(false)
      expect(result.code).toBe('missing-birth-fields')
      expect(result.payload ?? null).toBe(null)
    }
  })

  it('gender 白名单：男/女/1/0/true/false 各自归一，其余（含缺省）一律省略该键', () => {
    const accepted = ['1', '0', '男', '女', 1, 0, true, false]
    for (const gender of accepted) {
      const result = buildBaziPayload({ ...BIRTH, gender })
      expect(result.ok, `gender=${JSON.stringify(gender)} 被拒了`).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(result.payload, 'gender'), `gender=${JSON.stringify(gender)} 没进 payload`).toBe(true)
    }
    for (const gender of ['未知', 'x', '', 2, null, {}, []]) {
      const result = buildBaziPayload({ ...BIRTH, gender })
      expect(result.ok, `gender=${JSON.stringify(gender)} 该被省略而不是报错`).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(result.payload, 'gender'), `gender=${JSON.stringify(gender)} 不该进 payload`).toBe(false)
    }
  })

  it('10 键 + byLon 一律不出现在 payload（界面不给的旋钮不许偷偷透传）', () => {
    const result = buildBaziPayload({ ...BIRTH, ...OMITTED_ONLY_KEYS })
    expect(result.ok).toBe(true)
    for (const key of Object.keys(OMITTED_ONLY_KEYS)) {
      expect(Object.prototype.hasOwnProperty.call(result.payload, key), `payload 里出现了 ${key}（S3 §D4：v1 不透传）`).toBe(false)
    }
    expect(Object.keys(result.payload).filter((key) => !ALLOWED_KEYS.includes(key))).toEqual([])
  })

  it('agentConfirmed:false → **不注入**确认闸（拦截路径要能造出来）', () => {
    const result = buildBaziPayload({ ...BIRTH, agentConfirmed: false })
    expect(result.ok).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(result.payload, 'agent_confirmed_settings')).toBe(false)
  })

  it('defaultsAccepted:true → 额外注入 defaults_accepted:true（「按星阙默认」的第二次调用）', () => {
    const result = buildBaziPayload({ ...BIRTH, defaultsAccepted: true })
    expect(result.ok).toBe(true)
    expect(result.payload.defaults_accepted).toBe(true)
    // 两者可以同时在（真机 error.details.retry_requires_one_of 是「二选一」），但注入的两个键都要真）。
    expect(result.payload.agent_confirmed_settings).toBe(true)
  })

  it('clarificationNotes 透传；缺省时有可读的固定文本（不许空串）', () => {
    const custom = buildBaziPayload({ ...BIRTH, clarificationNotes: '只知道大概：下午一点左右' })
    expect(custom.payload.clarification_notes).toBe('只知道大概：下午一点左右')
    const fallback = buildBaziPayload({ ...BIRTH })
    expect(fallback.payload.clarification_notes.trim().length).toBeGreaterThan(0)
  })

  it('纯函数：不改输入、连调两次结果一致（可被宿主缓存/重放）', () => {
    const input = { ...BIRTH, gender: '男' }
    const snapshot = JSON.stringify(input)
    const first = buildBaziPayload(input)
    const second = buildBaziPayload(input)
    expect(JSON.stringify(input)).toBe(snapshot)
    expect(second.payload).toEqual(first.payload)
    expect(second.omitted).toEqual(first.omitted)
  })
})
