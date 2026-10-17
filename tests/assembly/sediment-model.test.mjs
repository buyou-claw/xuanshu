/**
 * 票 15 · 沉淀的**纯模型**（无 DOM、无网络）：分类判据、段落 diff、字数变化、确认闸门的置灰理由。
 *
 * 这些是「界面上人到底看到了什么」的全部算法 —— 拆出来单测的理由与 S10 §2 B② 的要求一致：
 * **人在按下去之前必须看清会动哪个文件、改了多少字**。所以每个数都必须有确定的口径：
 *   - 字数 = 去掉空白后的字符数（中文按字算，与「1,842 字」的口径一致）；
 *   - diff = 逐段 `= / ~ / + / -`，位置对应优先，其次全篇找同文段落（避免「整本重写」的假象）；
 *   - 置灰理由 = 缺什么就说什么（S1 §6④ 的 fail-soft 约定）。
 *
 * 期望值全部来自**规格与手算**：`wordDeltaText(1204, 1842)` 的 638 字 / 53% 就是 S10 §2 B③
 * 线框里那一行，逐字对齐。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  CONSULT_SESSION_PREFIX,
  confirmGate,
  countWords,
  createSedimentController,
  diffParagraphs,
  isConsultSessionId,
  previewText,
  puPaths,
  wordDeltaText,
} from '../../packages/xuanshu-client/src/client/sediment-model.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')

/* ───────────────────────── 1. 会话分类（ADR-0009 第 1 条：自铸 id 前缀） ───────────────────────── */

describe('票 15 · 只有问事会话才出现沉淀（分类载体 = 自铸 id 前缀）', () => {
  it('session-xs-consult-<uuid> 才是问事会话；别的会话一律不注册沉淀区块（S10 §1）', () => {
    expect(CONSULT_SESSION_PREFIX).toBe('session-xs-consult-')
    expect(isConsultSessionId('session-xs-consult-1bb37188-5787-4f96-a6ec-0de66a825f2a')).toBe(true)
    for (const value of ['session-1bb37188', 'session-xs-rikke-1', 'session-xs-digao-1', '', undefined, null, 42]) {
      expect(isConsultSessionId(value), `${String(value)} 不该被认成问事会话`).toBe(false)
    }
  })
})

/* ───────────────────────── 2. 字数与字数变化（S10 §2 B③ 口径） ───────────────────────── */

describe('票 15 · 字数口径：去空白后的字符数', () => {
  it('空串 0 字；空白不算字；中文按字算', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n\t ')).toBe(0)
    expect(countWords('  a b\n c\t')).toBe(3)
    expect(countWords('近一年。')).toBe(4)
  })

  it('字数变化逐字对齐线框：1,204 → 1,842 字（+638 字 / +53%）', () => {
    expect(wordDeltaText(1204, 1842)).toBe('1,204 → 1,842 字（+638 字 / +53%）')
  })

  it('减少 / 未变 / 从零开始都说得清（不做出除法除零的假数字）', () => {
    expect(wordDeltaText(1842, 1204)).toBe('1,842 → 1,204 字（-638 字 / -35%）')
    expect(wordDeltaText(1204, 1204)).toBe('1,204 → 1,204 字（未变）')
    expect(wordDeltaText(0, 100)).toBe('0 → 100 字（+100 字 / 新增）')
    expect(wordDeltaText(100, 0)).toBe('100 → 0 字（-100 字 / 清空）')
  })
})

/* ───────────────────────── 3. 逐段 diff（S10 §2 B②） ───────────────────────── */

describe('票 15 · 逐段 diff：位置对应优先，其次全篇找同文段落', () => {
  const current = '# 概览\n甲。\n\n## 节\n乙。\n\n丙。'
  const draft = '# 概览\n甲。\n\n## 节\n乙改。\n\n丙。\n\n丁。'

  it('未变 / 替换 / 新增：逐段记号与统计', () => {
    const diff = diffParagraphs(current, draft)
    expect(diff.items.map((item) => item.kind)).toEqual(['=', '~', '=', '+'])
    expect(diff.items[1].text).toBe('## 节\n乙改。')
    expect(diff.counts).toEqual({ unchanged: 2, replaced: 1, added: 1, removed: 0 })
  })

  it('草稿删掉一段：未匹配的原文段落记 `-`（不装作没发生过）', () => {
    const diff = diffParagraphs('甲\n\n乙\n\n丙', '甲\n\n丙')
    expect(diff.items.map((item) => item.kind)).toEqual(['=', '=', '-'])
    expect(diff.items[2].text).toBe('乙')
    expect(diff.counts).toEqual({ unchanged: 2, replaced: 0, added: 0, removed: 1 })
  })

  it('段落换序不算变化（草稿只是重排 = 三段未变，不该显示成整本重写）', () => {
    const diff = diffParagraphs('甲\n\n乙\n\n丙', '丙\n\n甲\n\n乙')
    expect(diff.items.map((item) => item.kind)).toEqual(['=', '=', '='])
    expect(diff.counts).toEqual({ unchanged: 3, replaced: 0, added: 0, removed: 0 })
  })

  it('替换只在「该位置的原文段落没被别处用掉」时成立，否则算新增', () => {
    const diff = diffParagraphs('甲', '乙\n\n丙')
    expect(diff.items.map((item) => item.kind)).toEqual(['~', '+'])
    expect(diff.counts).toEqual({ unchanged: 0, replaced: 1, added: 1, removed: 0 })
  })

  it('空正文 / 单段 / 首尾空白都不炸', () => {
    expect(diffParagraphs('', '').counts).toEqual({ unchanged: 0, replaced: 0, added: 0, removed: 0 })
    expect(diffParagraphs('', '甲').counts).toEqual({ unchanged: 0, replaced: 0, added: 1, removed: 0 })
    expect(diffParagraphs('甲', '').counts).toEqual({ unchanged: 0, replaced: 0, added: 0, removed: 1 })
    expect(diffParagraphs('\n\n甲\n\n', '\n甲\n').items).toEqual([{ kind: '=', text: '甲' }])
  })
})

/* ───────────────────────── 4. 确认按钮的置灰理由（S1 §6④ / S10 §6 disabled 行） ───────────────────────── */

describe('票 15 · 确认更新的可用性与**可见理由**', () => {
  it('四件东西齐了才可用', () => {
    expect(confirmGate({ hasDraft: true, targetSlug: 'shiye', stale: false, busy: false })).toEqual({ ok: true })
  })

  it('没有草稿：说清「先导出汇总」', () => {
    const gate = confirmGate({ hasDraft: false, targetSlug: 'shiye', stale: false, busy: false })
    expect(gate.ok).toBe(false)
    expect(gate.reason).toContain('导出汇总')
  })

  it('没有目标谱：说清「沉淀只能写进谱」', () => {
    const gate = confirmGate({ hasDraft: true, targetSlug: '', stale: false, busy: false })
    expect(gate.ok).toBe(false)
    expect(gate.reason).toContain('谱')
  })

  it('目标谱在预览后被改动：必须先重新预览（S10 §6 stale 行）', () => {
    const gate = confirmGate({ hasDraft: true, targetSlug: 'shiye', stale: true, busy: false })
    expect(gate.ok).toBe(false)
    expect(gate.reason).toContain('重新预览')
  })

  it('正在写入：按钮不可再点，理由可见（不静默吞掉第二次点击）', () => {
    const gate = confirmGate({ hasDraft: true, targetSlug: 'shiye', stale: false, busy: true })
    expect(gate.ok).toBe(false)
    expect(gate.reason).toContain('正在')
  })
})

/* ───────────────────────── 5. 只读展示：预览与路径 ───────────────────────── */

describe('票 15 · 草稿预览与写入路径的只读展示', () => {
  it('预览截断：超长只给前 N 字 + 省略号（不因为一份长草稿把卡片撑开）', () => {
    expect(previewText('甲'.repeat(10), 20)).toBe('甲'.repeat(10))
    expect(previewText('甲'.repeat(30), 20)).toBe(`${'甲'.repeat(20)}…`)
    expect(previewText('  甲  ', 20)).toBe('甲')
  })

  it('写入路径只读展示：pus/<slug>/ 下的三份文件（默认数据目录口径，与 S5 同源）', () => {
    expect(puPaths('事业与行业')).toEqual({
      content: '~/.dsh/xuanshu/pus/事业与行业/content.md',
      summary: '~/.dsh/xuanshu/pus/事业与行业/summary.md',
      manifest: '~/.dsh/xuanshu/pus/事业与行业/manifest.md',
    })
  })
})

/* ───────────────────────── 6. 控制器：人点才跑 + confirmed 只此一处 ───────────────────────── */

/** 记录型假数据面。 */
function fakeApi(overrides = {}) {
  const calls = []
  const answer = {
    draftId: 'd1',
    target: { slug: 'shiye', name: '事业与行业' },
    draft: { description: '概览', body: '# 概览\n正文\n', summary: '汇总' },
  }
  return {
    calls,
    api: {
      async draft(payload) {
        calls.push({ method: 'sediment.draft', payload })
        return answer
      },
      async commit(payload) {
        calls.push({ method: 'sediment.commit', payload })
        return { pu: { slug: 'shiye', name: '事业与行业', updatedAt: '2026-10-15T01:00:00.000Z' } }
      },
      async discard(payload) {
        calls.push({ method: 'sediment.discard', payload })
        return { ok: true }
      },
      async readTarget(slug) {
        calls.push({ method: 'pu.read', payload: { slug } })
        return { slug, name: '事业与行业', body: '旧正文', summary: '旧汇总', updatedAt: '2026-10-15T00:00:00.000Z' }
      },
      ...overrides,
    },
  }
}

describe('票 15 · 沉淀控制器：造出来不发请求，人点才跑', () => {
  it('createSedimentController 不调任何方法；每个会话一份状态', () => {
    const { calls, api } = fakeApi()
    const controller = createSedimentController(api)
    expect(calls).toEqual([])
    expect(controller.getState('session-xs-consult-a').kind).toBe('empty')
    expect(controller.getState('session-xs-consult-b').kind).toBe('empty')
  })

  it('export()：走 sediment.draft，状态 loading → ready，广播一次', async () => {
    const { calls, api } = fakeApi()
    const controller = createSedimentController(api)
    let notified = 0
    controller.subscribe(() => { notified += 1 })
    const sessionId = 'session-xs-consult-a'

    const outcome = await controller.export(sessionId, 'shiye')

    expect(outcome.ok).toBe(true)
    expect(calls).toEqual([{ method: 'sediment.draft', payload: { sessionId, targetSlug: 'shiye' } }])
    expect(controller.getState(sessionId)).toMatchObject({ kind: 'ready', answer: { draftId: 'd1' } })
    expect(controller.getState('session-xs-consult-b').kind).toBe('empty')
    expect(notified).toBeGreaterThan(0)
  })

  it('export() 失败：状态 error + 理由可见（不静默）', async () => {
    const { api } = fakeApi({ async draft() { throw new Error('这次导出汇总发不出去：宿主缺少 agentDefaultModel 服务') } })
    const controller = createSedimentController(api)
    const sessionId = 'session-xs-consult-a'
    const outcome = await controller.export(sessionId)
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toContain('agentDefaultModel')
    expect(controller.getState(sessionId)).toMatchObject({ kind: 'error' })
    expect(controller.getState(sessionId).reason).toContain('agentDefaultModel')
  })

  it('commit()：只有它下发 confirmed（人在弹窗里点的那一次），成功后状态 done', async () => {
    const { calls, api } = fakeApi()
    const controller = createSedimentController(api)
    const sessionId = 'session-xs-consult-a'
    await controller.export(sessionId)

    const outcome = await controller.commit(sessionId)

    expect(outcome.ok).toBe(true)
    expect(calls.at(-1)).toEqual({ method: 'sediment.commit', payload: { draftId: 'd1' } })
    expect(controller.getState(sessionId).kind).toBe('done')
    expect(controller.getState(sessionId).pu?.slug).toBe('shiye')
  })

  it('commit() 失败：回到 ready（草稿还在，人还能再试），理由可见', async () => {
    const { api } = fakeApi({ async commit() { throw new Error('目标谱读不出来（slug=shiye）') } })
    const controller = createSedimentController(api)
    const sessionId = 'session-xs-consult-a'
    await controller.export(sessionId)
    const outcome = await controller.commit(sessionId)
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toContain('读不出来')
    expect(controller.getState(sessionId).kind).toBe('ready')
    expect(controller.getState(sessionId).reason).toContain('读不出来')
  })

  it('commit() 不能在没草稿时跑（不会凭空写谱）', async () => {
    const { calls, api } = fakeApi()
    const controller = createSedimentController(api)
    const outcome = await controller.commit('session-xs-consult-a')
    expect(outcome.ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('discard()：丢草稿，状态回 empty', async () => {
    const { calls, api } = fakeApi()
    const controller = createSedimentController(api)
    const sessionId = 'session-xs-consult-a'
    await controller.export(sessionId)
    const outcome = await controller.discard(sessionId)
    expect(outcome.ok).toBe(true)
    expect(calls.at(-1)).toEqual({ method: 'sediment.discard', payload: { draftId: 'd1' } })
    expect(controller.getState(sessionId).kind).toBe('empty')
  })
})

/* ───────────────────────── 7. 结构性保证：界面上没有「AI 自动写入」入口 ───────────────────────── */

describe('票 15 · 「AI 不静默写谱」的结构判据（S10 §9 C4 的评审验点）', () => {
  const read = (name) => readFileSync(join(REPO_ROOT, 'packages', 'xuanshu-client', 'src', 'client', name), 'utf8')

  it('`confirmed: true` 在客户端只出现一次，且落在数据面写死的那一处', () => {
    for (const file of ['sediment-api.ts', 'sediment-model.ts', 'sediment-views.tsx']) {
      const matches = read(file).match(/confirmed\s*:\s*true/gu) ?? []
      const expected = file === 'sediment-api.ts' ? 1 : 0
      expect(matches.length, `${file} 里 confirmed: true 出现 ${matches.length} 次`).toBe(expected)
    }
  })

  it('视图层不直接调 `sediment.commit`（写入只能经由控制器的人点方法）', () => {
    expect(read('sediment-views.tsx')).not.toContain('sediment.commit')
  })

  it('视图层不出现「自动」写入的措辞（自动沉淀 / 自动更新 / 总是允许 / 别再问）', () => {
    const source = read('sediment-views.tsx')
    for (const phrase of ['自动沉淀', '自动更新', '总是允许', '别再问', '记住这个选择']) {
      expect(source, `视图层出现了 ${phrase}`).not.toContain(phrase)
    }
  })
})
