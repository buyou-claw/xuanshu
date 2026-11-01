/**
 * #40 · R7 失败文案：宿主「写入前归一」与客户端「渲染前翻译」是**同一份文案的两侧实现**。
 *
 * 为什么需要这一份对拍：跨包没有可共享的运行时模块（`packages/xuanshu-host/lib/notify/reason.mjs`
 * 文件头写了原因），所以两边各留一份 token→人话表 + 识别正则。没有对拍时，任何一侧改一个字都
 * 不会被发现 —— 界面会把宿主已经翻好的句子再当 token 认一遍，或者反过来把 token 原样露给用户。
 *
 * 判据（两轴都查，不只是「文案相同」）：
 *   ① 文案表**逐键相等**（键集合与每个值）；
 *   ② 识别用的正则**完全一致**（source + flags）；
 *   ③ 同一组样例在两侧**结论相同**：认识的 token → 同一机器码 + 同一句人话；
 *      不认识的 reason → 两侧都**原样保留**（不抹平、可排查）；
 *   ④ 对拍函数本身不是空转：改一个字的副本必须被它抓出来（同仓扫描器测试的写法）。
 *
 * 两侧模块都能直接被 vitest import：宿主是 `.mjs`，客户端是 `.tsx`（esbuild 变换）。
 */
import { describe, expect, it } from 'vitest'

import {
  NOTIFY_FAILURE_TEXT as HOST_TEXT,
  NOTIFY_FAILURE_TOKEN as HOST_TOKEN,
  normalizeNotifyFailure,
} from '../../packages/xuanshu-host/lib/notify/reason.mjs'
import {
  NOTIFY_FAILURE_TEXT as CLIENT_TEXT,
  NOTIFY_FAILURE_TOKEN as CLIENT_TOKEN,
  notifyFailureText,
  notifyReasonCode,
} from '../../packages/xuanshu-client/src/client/notify.tsx'

/** 两侧文案表的差异清单（空 = 逐键相等）。导出给自检用，免得比较逻辑本身写错还静默通过。 */
function tableDrift(left, right) {
  const keys = [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].sort()
  const drift = []
  for (const key of keys) {
    if (left[key] === undefined) drift.push(`左侧缺键：${key}`)
    else if (right[key] === undefined) drift.push(`右侧缺键：${key}`)
    else if (left[key] !== right[key]) drift.push(`文案不同：${key}（左 ${JSON.stringify(left[key])} / 右 ${JSON.stringify(right[key])}）`)
  }
  return drift
}

/**
 * 同一句 reason 在两侧的结论（宿主归一 vs 客户端渲染）。
 * @param raw - 账行里的原始 reason（已知 token / 带中文前缀 / 不认识的自由文本 / 空串）
 */
function conclusions(raw) {
  const host = normalizeNotifyFailure(raw)
  const client = { reason: raw }
  return {
    hostCode: host.reasonCode,
    clientCode: notifyReasonCode(client),
    hostReason: host.reason,
    clientText: notifyFailureText(client),
  }
}

/** 两侧都要认的壳侧 token（`xuanshu-shell/lib/notify-server.mjs::FAILURE_REASONS` 的同一词表）。 */
const KNOWN_TOKENS = ['permission-denied', 'unsupported', 'failed']

/**
 * 识别样例：裸 token / 宿主旧写法（中文前缀 + token）/ 尾随空白 / 换行 / 只是包含 token 的串 /
 * 完全不相干的自由文本 / 冒号但不是已知 token / 空串。
 */
const SAMPLES = [
  ...KNOWN_TOKENS,
  ...KNOWN_TOKENS.map((token) => `桌面应用没有弹出通知：${token}`),
  ...KNOWN_TOKENS.map((token) => `${token}   `),
  ...KNOWN_TOKENS.map((token) => `${token}\n`),
  'not-permission-denied',
  'permission-denied-harder',
  'unsupportedx',
  '桌面应用崩溃了：EPERM（拒绝访问）',
  '超时：等不到系统通知服务',
  '没有任何理由',
  '',
]

describe('#40 · R7 失败文案两侧对拍：宿主归一 ↔ 客户端渲染', () => {
  it('① 文案表逐键相等（键集合 + 每个值都一致）', () => {
    expect(tableDrift(HOST_TEXT, CLIENT_TEXT)).toEqual([])
    // 两表都不是空的：守卫本身不能因为「两边都空」而假绿。
    expect(Object.keys(CLIENT_TEXT).sort()).toEqual([...KNOWN_TOKENS].sort())
  })

  it('对拍函数是活的：改一个字的副本必须被抓出来（否则上面那条等于没查）', () => {
    const mutated = { ...CLIENT_TEXT, failed: `${CLIENT_TEXT.failed}（改了）` }
    expect(tableDrift(HOST_TEXT, mutated).length).toBeGreaterThan(0)
    const missing = { ...CLIENT_TEXT }
    delete missing.unsupported
    expect(tableDrift(HOST_TEXT, missing)).toContain('右侧缺键：unsupported')
  })

  it('② 识别正则完全一致（同一个 source + 同一个 flags）', () => {
    expect(CLIENT_TOKEN.source).toBe(HOST_TOKEN.source)
    expect(CLIENT_TOKEN.flags).toBe(HOST_TOKEN.flags)
    // 两侧都必须真的能认（不是 /(?:)/ 这种恒真空正则）。
    expect(CLIENT_TOKEN.test('permission-denied')).toBe(true)
    expect(CLIENT_TOKEN.test('没有任何理由')).toBe(false)
  })

  it('③ 认识 token：两侧给同一个机器码 + 同一句人话（两侧都用表里的字，不各写一份）', () => {
    for (const token of KNOWN_TOKENS) {
      for (const sample of [token, `桌面应用没有弹出通知：${token}`]) {
        const views = conclusions(sample)
        expect(views.hostCode, `宿主没认出 ${sample}`).toBe(token)
        expect(views.clientCode, `客户端没认出 ${sample}`).toBe(token)
        expect(views.hostReason).toBe(HOST_TEXT[token])
        expect(views.clientText).toBe(HOST_TEXT[token])
        // 「说人话」的判据：翻出来的句子不等于原始 token / 也不是旧的中文前缀写法。
        expect(views.clientText).not.toBe(token)
      }
    }
  })

  it('③ 不认识的 reason：两侧都原样保留（不抹平、可排查）', () => {
    for (const sample of ['桌面应用崩溃了：EPERM（拒绝访问）', '超时：等不到系统通知服务', 'permission-denied-harder']) {
      const views = conclusions(sample)
      expect(views.hostCode, `${sample} 被误认成已知 token`).toBeUndefined()
      expect(views.clientCode).toBeUndefined()
      expect(views.hostReason).toBe(sample)
      expect(views.clientText).toBe(sample)
    }
  })

  it('③ 边界样例（尾随空白 / 换行 / 包含 token 的串）：两侧结论逐一相同', () => {
    for (const sample of SAMPLES) {
      const views = conclusions(sample)
      expect(views.clientCode, `两侧对「${sample}」的识别结论不一致`).toBe(views.hostCode)
      // 空串是唯一的刻意差异：宿主写 `{reason:null}`（没有理由可记），界面要说「（没有给理由）」。
      if (sample === '') {
        expect(views.hostReason).toBeNull()
        expect(views.clientText).toBe('（没有给理由）')
        continue
      }
      expect(views.clientText, `两侧对「${sample}」的人话不一致`).toBe(views.hostReason)
    }
  })

  it('客户端显式 reasonCode 优先（新账行）：与宿主写入的值同表翻译', () => {
    for (const token of KNOWN_TOKENS) {
      expect(notifyReasonCode({ reason: '随便什么自由文本', reasonCode: token })).toBe(token)
      expect(notifyFailureText({ reason: '随便什么自由文本', reasonCode: token })).toBe(HOST_TEXT[token])
    }
  })
})
