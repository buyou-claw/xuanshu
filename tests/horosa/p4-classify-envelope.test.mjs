/**
 * P4 · `classifyBaziEnvelope` 用**真实捕获**做 fixture（纯单测，零网络）
 *
 * 判据出处：契约 §4.2 + §0.1/§0.2（Lead 2026-10-13 真机实测）+ §5 P4。
 *
 * 抓的真实缺陷/风险：
 *   ① **`timeAlg` 只能用 `technique_card.settings.timeAlg.value` 判**（首选），回退 `input_normalized.timeAlg`：
 *      §0.1 实测上海 1.48° 经度差 + 均时差 ≈ +2m34s，**跨不了时支** —— 拿四柱当 `timeAlg` 判据的写法
 *      在三档下都会「通过」，是纯粹的假绿。这条用例把三档当成三条独立断言，且额外钉死「四柱在三档里相同」
 *      这件事本身（如果哪天四柱变了，说明 fixture/上游变了，也该有人看一眼）。
 *   ② **时柱在真机里叫 `fourColumns.time`**（没有 `hour`）：契约 §0.1 一度写成 `hour`。映射错 → 四柱永远读不全
 *      → `pillars` 静默变 null → 界面「出盘了但没有四柱」。fixture 按真机保留 `time`，断言对外槽位是 `hour`。
 *   ③ **澄清闸不是 error，是 ok:false 的信封**（HTTP 200 / isError:false）：把它当异常处理就会
 *      「出盘失败」而不是「就地展开追问」；`prompt_to_user` 必须**原文**带出来（S3 §2.7：原文展示、不转述）。
 *   ④ `error` 分三种：gate（有 code + 追问）、普通 error（有 code/message）、invalid（连 `ok` 都没有）——
 *      三种处置完全不同：前两者重试/追问，后者是契约破坏，必须显式 invalid 而不是硬当 ok。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { classifyBaziEnvelope, extractTrueSolarTime } from '../../packages/xuanshu-host/lib/horosa/bazi.mjs'
import { ENVELOPES_DIR } from './lib/paths.mjs'

function fixture(name) {
  return JSON.parse(readFileSync(join(ENVELOPES_DIR, `${name}.json`), 'utf8'))
}

const OK_DEFAULT = fixture('bazi-ok-default')
const OK_CLOCK = fixture('bazi-ok-clock')
const OK_MEAN = fixture('bazi-ok-meansolar')
const GATE = fixture('bazi-gate')
const ERROR = fixture('bazi-error')
const NO_SETTINGS_TIME_ALG = fixture('bazi-ok-default-no-settings-timealg')

/** 真机四柱的对外槽位（year/month/day/hour）与四柱值（§0.1）。 */
const EXPECTED_PILLARS = { year: '己巳', month: '丙子', day: '丙寅', hour: '甲午' }

describe('P4 · classifyBaziEnvelope（真实信封）', () => {
  describe('成功信封 → phase ok', () => {
    it('三档 timeAlg：唯一判据是 technique_card.settings.timeAlg.value', () => {
      for (const [envelope, expected] of [[OK_DEFAULT, 0], [OK_CLOCK, 1], [OK_MEAN, 3]]) {
        const result = classifyBaziEnvelope(envelope)
        expect(result.phase).toBe('ok')
        expect(result.ok).toBe(true)
        expect(result.timeAlg, `settings.timeAlg.value=${envelope.data.technique_card.settings.timeAlg.value}`).toBe(expected)
      }
    })

    it('三档的四柱**完全相同**（所以四柱不能当 timeAlg 判据 —— §0.1 的坑本身）', () => {
      const pillarsOf = (envelope) => classifyBaziEnvelope(envelope).pillars
      expect(pillarsOf(OK_DEFAULT)).toEqual(pillarsOf(OK_CLOCK))
      expect(pillarsOf(OK_CLOCK)).toEqual(pillarsOf(OK_MEAN))
      // 同一份 fixture 若被改成三档不同四柱，那一定不是真机来的（上游上海样例跨不了时支）。
      expect(pillarsOf(OK_DEFAULT)).toEqual(EXPECTED_PILLARS)
    })

    it('四柱：真机 `fourColumns.time` 映射到对外槽位 `pillars.hour`', () => {
      const result = classifyBaziEnvelope(OK_DEFAULT)
      // 真机里根本没有 hour 键 —— 先把这个事实钉住，映射才不是「碰巧」。
      expect(OK_DEFAULT.data.bazi.fourColumns.hour).toBeUndefined()
      expect(OK_DEFAULT.data.bazi.fourColumns.time.ganzi).toBe('甲午')
      expect(result.pillars).toEqual(EXPECTED_PILLARS)
      expect(Object.keys(result.pillars).sort()).toEqual(['day', 'hour', 'month', 'year'])
    })

    it('techniqueCard = data.technique_card 整块（含 versions.runtime = 上游版本），version = 信封版本', () => {
      const result = classifyBaziEnvelope(OK_DEFAULT)
      expect(result.techniqueCard).toEqual(OK_DEFAULT.data.technique_card)
      expect(result.techniqueCard.settings.timeAlg.value).toBe(0)
      expect(result.techniqueCard.versions.runtime).toBe(OK_DEFAULT.version)
      expect(result.version).toBe(OK_DEFAULT.version)
      expect(result.tool).toBe('bazi_birth')
      expect(typeof result.pillarSource).toBe('string')
      expect(result.pillarSource.toLowerCase()).toContain('fourcolumns')
    })

    it('timeAlgSource 记来源：主来源不含 input，回退时点名 input_normalized', () => {
      const primary = classifyBaziEnvelope(OK_DEFAULT)
      expect(primary.timeAlg).toBe(0)
      expect(primary.timeAlgSource.toLowerCase()).not.toContain('input')

      // 派生 fixture：抹掉 settings.timeAlg → 只剩 input_normalized.timeAlg（真机回显 0）。
      const fallbackEnvelope = NO_SETTINGS_TIME_ALG
      expect(fallbackEnvelope.data.technique_card.settings.timeAlg).toBeUndefined()
      const fallback = classifyBaziEnvelope(fallbackEnvelope)
      expect(fallback.phase).toBe('ok')
      expect(fallback.timeAlg).toBe(0)
      expect(fallback.timeAlgSource.toLowerCase()).toContain('input_normalized')
      // 两条路都要能读全四柱（回退只影响口径来源，不影响四柱）。
      expect(fallback.pillars).toEqual(EXPECTED_PILLARS)
    })

    it('四柱不合法（缺/空）→ pillars 为 null，但 phase 仍是 ok（四柱缺失不等于出盘失败）', () => {
      for (const broken of ['fourColumns 缺 time', 'ganzi/ganZhi 都是空串', 'fourColumns 整个没了']) {
        const envelope = structuredClone(OK_DEFAULT)
        if (broken === 'fourColumns 缺 time') delete envelope.data.bazi.fourColumns.time
        if (broken === 'ganzi/ganZhi 都是空串') {
          // 真机里 ganzi 与 ganZhi 同值（实现两者都要认）——要造「不合法」必须两个都抹掉。
          envelope.data.bazi.fourColumns.time.ganzi = ''
          envelope.data.bazi.fourColumns.time.ganZhi = ''
        }
        if (broken === 'fourColumns 整个没了') delete envelope.data.bazi.fourColumns
        const result = classifyBaziEnvelope(envelope)
        expect(result.phase, broken).toBe('ok')
        expect(result.pillars, `${broken} 时不该给出四柱`).toBe(null)
        // 判据只能来自 technique_card —— 四柱坏了也不许把 timeAlg 一起丢掉。
        expect(result.timeAlg, broken).toBe(0)
      }
    })

    it('ganzi 与 ganZhi 同值时两个都认（真机两个字段都在；只认一个就会漏四柱）', () => {
      for (const key of ['ganzi', 'ganZhi']) {
        const envelope = structuredClone(OK_DEFAULT)
        delete envelope.data.bazi.fourColumns.hour
        // 只留一个字段：实现的回退链必须还能读出年柱。
        for (const other of ['ganzi', 'ganZhi']) if (other !== key) delete envelope.data.bazi.fourColumns.year[other]
        const result = classifyBaziEnvelope(envelope)
        expect(result.pillars?.year, `只留 ${key} 时读不出年柱`).toBe('己巳')
      }
    })
  })

  describe('澄清闸拦截 → phase gate（不是 error、不是异常）', () => {
    it('phase/code/追问/promptToUser 原文', () => {
      const result = classifyBaziEnvelope(GATE)
      expect(GATE.ok).toBe(false)
      expect(result.phase).toBe('gate')
      expect(result.ok).toBe(false)
      expect(result.code).toBe('agent_guidance.required')
      expect(result.tool).toBe('bazi_birth')
      expect(result.version).toBe(GATE.version)
      // 4 条追问的原文，逐条一致（界面要按 field 分组展示）。
      expect(result.questions).toEqual(GATE.error.details.ask_if_missing)
      expect(result.questions).toHaveLength(4)
      expect(result.questions.map((question) => question.field)).toEqual(['birth data', 'timeAlg/after23NewDay/lateZiHourUseNextDay', 'godKeyPos/minggongMethod/school', 'southMonth'])
      // prompt_to_user 必须**原文**（S3 §2.7：原文展示、不转述）。
      expect(result.promptToUser).toBe(GATE.error.details.agent_recovery.prompt_to_user)
      expect(result.promptToUser).toContain('调用 `bazi_birth` 前需要先确认这些会影响结果的设置')
      expect(result.safeDefaults).toEqual(GATE.error.details.safe_defaults)
      expect(result.safeDefaults).toHaveLength(6)
      expect(result.confirmationFields).toEqual(GATE.error.details.confirmation_fields)
    })

    it('拦截期间不落谱的机器判据：data 空、四柱读不出来、timeAlg 为 null', () => {
      const result = classifyBaziEnvelope(GATE)
      // 真机 gate 的 data 是 {}：四柱 → null，口径 → null（界面「不点亮命盘卡」靠这两条可判定）。
      expect(result.pillars).toBe(null)
      expect(result.timeAlg).toBe(null)
      expect(result.techniqueCard == null).toBe(true)
      expect(GATE.data?.bazi?.fourColumns).toBeUndefined()
    })

    it('顶层 code 也要认（error.code 缺失时用信封的 code）', () => {
      const envelope = structuredClone(GATE)
      delete envelope.error.code
      expect(envelope.code).toBe('agent_guidance.required')
      const result = classifyBaziEnvelope(envelope)
      expect(result.phase).toBe('gate')
      expect(result.code).toBe('agent_guidance.required')
    })
  })

  describe('error / invalid', () => {
    it('ok:false 且 code ≠ gate → phase error，带 code 与 message', () => {
      const result = classifyBaziEnvelope(ERROR)
      expect(result.phase).toBe('error')
      expect(result.ok).toBe(false)
      expect(result.code).toBe('invalid_payload')
      expect(result.message).toBe(ERROR.error.message)
      expect(result.pillars).toBe(null)
      // error 相位不该带追问（带出来 = 界面会去展开一个没有内容的「底座需要你确认」）。
      expect(result.questions ?? []).toHaveLength(0)
      expect(result.promptToUser ?? '').toBe('')
      expect(result.timeAlg ?? null).toBe(null)
    })

    for (const [label, value] of [
      ['非对象：null', null],
      ['非对象：字符串', '{"ok":true}'],
      ['非对象：数字', 42],
      ['数组', [1, 2, 3]],
      ['缺 ok', { tool: 'bazi_birth', version: '0.40.1', data: {}, summary: [], warnings: [], error: null }],
      ['只有 ok:true', { ok: true }],
    ]) {
      it(`信封键不满足 REQUIRED_KEYS → phase invalid（${label}）`, () => {
        const result = classifyBaziEnvelope(value)
        expect(result.phase).toBe('invalid')
        expect(result.ok).toBe(false)
        expect(result.pillars).toBe(null)
        expect(result.timeAlg ?? null).toBe(null)
      })
    }

    it('ok 不是布尔（"true"）→ **绝不算成功**（契约字面在 error/invalid 之间留了缝，但「像成功」不许有缝）', () => {
      const envelope = structuredClone(OK_DEFAULT)
      envelope.ok = 'true'
      const result = classifyBaziEnvelope(envelope)
      // 契约 §4.2 只定义了 ok===true / ok===false 两态；非布尔值落在缝里。
      // 这里钉的是**行为**：真值转换不许把它当成成功（界面会去点亮命盘卡，而信封其实不合规）。
      expect(result.phase, `ok:'true' 被判成了 ${result.phase}`).not.toBe('ok')
      expect(result.ok).toBe(false)
      expect(['error', 'invalid']).toContain(result.phase)
      expect(result.pillars ?? null).toBe(null)
    })
  })

  it('纯函数：不改输入、连调两次结果一致', () => {
    const envelope = structuredClone(OK_DEFAULT)
    const snapshot = JSON.stringify(envelope)
    const first = classifyBaziEnvelope(envelope)
    const second = classifyBaziEnvelope(envelope)
    expect(JSON.stringify(envelope)).toBe(snapshot)
    expect(second.phase).toBe(first.phase)
    expect(second.pillars).toEqual(first.pillars)
    expect(second.timeAlg).toBe(first.timeAlg)
  })

  /**
   * 真太阳时（票 08 的命盘卡口径行要用）。
   *
   * 抓的真实缺陷/风险：该版本信封**没有**结构化的真太阳时字段 —— 看起来像的那个
   * `data.bazi.directTime` 的**时间部分随 timeAlg 变**（下面这条断言就是它的反证），
   * 拿它当「真太阳时」会在用户选钟表时/平太阳时时报错一个不是真太阳时的值。
   * 真太阳时只在口径文本的 `真太阳时：<时间戳>` 行里，且三档下**恒为同一个值**。
   */
  describe('真太阳时（extractTrueSolarTime，真实信封）', () => {
    it('三档 timeAlg 下真太阳时是同一个值（真太阳时按定义不随口径选择而变）', () => {
      for (const envelope of [OK_DEFAULT, OK_CLOCK, OK_MEAN]) {
        expect(extractTrueSolarTime(envelope.data)).toEqual({ date: '1990-01-01', time: '12:02:34' })
        expect(classifyBaziEnvelope(envelope).trueSolarTime).toEqual({ date: '1990-01-01', time: '12:02:34' })
      }
    })

    it('反证：data.bazi.directTime 的时间部分**随 timeAlg 变**，所以它不能当真太阳时', () => {
      const timeOf = (envelope) => String(envelope.data.bazi.directTime).split(' ')[1]
      const times = [OK_DEFAULT, OK_CLOCK, OK_MEAN].map(timeOf)
      expect(new Set(times).size, `三档 directTime 相同（${times.join(' / ')}）——这条反证失去意义，请复核 fixture`).toBe(3)
      // 只有 `timeAlg=0`（真太阳时那一档）恰好等于真太阳时；另两档分别是钟表时与平太阳时。
      // 也就是说：把它当真太阳时用，在 2/3 的口径选择下会报出一个**不是**真太阳时的值 —— 这正是要害。
      expect(timeOf(OK_DEFAULT)).toBe('12:02:34')
      expect(timeOf(OK_CLOCK)).toBe('12:00:00')
      expect(timeOf(OK_MEAN)).toBe('12:05:56')
      for (const envelope of [OK_CLOCK, OK_MEAN]) {
        expect(timeOf(envelope), '非真太阳时档的 directTime 不该等于真太阳时').not.toBe('12:02:34')
      }
    })

    it('读不出就 null（不抛、不编）：缺 snapshot_text / 文本里没有那一行 / 非对象', () => {
      expect(extractTrueSolarTime(null)).toBe(null)
      expect(extractTrueSolarTime({})).toBe(null)
      expect(extractTrueSolarTime({ snapshot_text: '' })).toBe(null)
      expect(extractTrueSolarTime({ snapshot_text: '时间基准：真太阳时(经度+均时差校正)\n' })).toBe(null)
      expect(extractTrueSolarTime({ snapshot_text: '真太阳时：看起来像但不是时间戳' })).toBe(null)
    })

    it('非 ok 相位的 trueSolarTime 恒为 null（口径行只在成功信封里有意义）', () => {
      expect(classifyBaziEnvelope(GATE).trueSolarTime).toBe(null)
      expect(classifyBaziEnvelope(ERROR).trueSolarTime).toBe(null)
    })
  })
})
