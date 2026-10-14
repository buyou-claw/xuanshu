/**
 * 票 15 · 沉淀草稿的暂存区（契约 §3 的落盘形状：`<dataDir>/sediment/<draftId>.json`，schema `xuanshu/sediment@1`）。
 *
 * 草稿区是**人的闸门**的物证：草稿在哪、长什么样、能不能被读回来，决定了「未确认不写谱」这条
 * 是不是可验证的。这里只断言外部可观察的东西：落盘路径、schema、字段、以及「读不回来时返回 null
 * 而不是按今天的字段去猜」。
 *
 * 抓的真实缺陷/风险：
 *   ① **草稿落进 `pus/`**：那等于没确认就出现在谱列表里（S10 §1 的边界句）。
 *   ② **draftId 直接拼进文件名**：`../` 就能写到数据目录外面去；这里逐条试路径穿越面。
 *   ③ **schema 不认识也硬读**：旧结构被当新结构用，是本项目最忌讳的「静默偏差」。
 *   ④ **半个 JSON 落盘**：原子替换写（临时文件 + rename）的判据 —— 写入过程中不该有可见的半份文件。
 */
import { describe, expect, it } from 'vitest'

import { SEDIMENT_SCHEMA, createSedimentStore, isDraftId, sedimentDraftPath } from '../../packages/xuanshu-host/lib/sediment/store.mjs'
import { makeSandbox } from './lib/sandbox.mjs'

const DRAFT = {
  description: '近一年事业判断的沉淀。',
  // 正文的规范形：不含两端空白（归一规则单独在下面一条用例里钉）。
  body: '# 概览\n近一年事业判断的沉淀。\n\n## 近一年判断\n今年以稳为主。',
  summary: '事业：稳为主。',
}

function scene() {
  const sandbox = makeSandbox('store')
  const store = createSedimentStore(sandbox.dataDir)
  return { sandbox, store }
}

describe('票 15 · 草稿仓：落盘形状（契约 §3）', () => {
  it('create 落 <dataDir>/sediment/<draftId>.json，schema = xuanshu/sediment@1', () => {
    const { sandbox, store } = scene()
    const record = store.create({ sessionId: 'session-xs-consult-1a2b', target: { slug: '事业与行业', name: '事业与行业' }, draft: DRAFT, draftId: 'draft-1', createdAt: '2026-10-15T00:00:00.000Z' })

    expect(sandbox.files()).toEqual(['sediment/draft-1.json'])
    expect(sandbox.json('sediment', 'draft-1.json')).toEqual({
      schema: SEDIMENT_SCHEMA,
      draftId: 'draft-1',
      sessionId: 'session-xs-consult-1a2b',
      createdAt: '2026-10-15T00:00:00.000Z',
      target: { slug: '事业与行业', name: '事业与行业' },
      draft: DRAFT,
    })
    expect(record.draftId).toBe('draft-1')
    // 草稿区**不在** pus/ 下：没确认过的东西不该出现在谱目录里。
    expect(sandbox.exists('pus')).toBe(false)
  })

  it('不传 draftId 时自铸，两次不一样；read 读回来的与写下去的一致', () => {
    const { store } = scene()
    const first = store.create({ sessionId: 'session-xs-consult-a', target: { slug: 'a', name: 'a' }, draft: DRAFT })
    const second = store.create({ sessionId: 'session-xs-consult-b', target: { slug: 'b', name: 'b' }, draft: DRAFT })
    expect(first.draftId).not.toBe(second.draftId)
    expect(store.read(first.draftId)).toEqual(first)
  })

  it('正文两端空白被归一（概览必须真的在一级标题上，否则不落盘）', () => {
    const { store } = scene()
    const record = store.create({ sessionId: 'session-xs-consult-a', target: { slug: 'a', name: 'a' }, draft: { ...DRAFT, body: '\n\n# 概览\n正文\n\n', description: '  概览  ' } })
    expect(record.draft.body).toBe('# 概览\n正文')
    expect(record.draft.description).toBe('概览')
  })

  it('不合规的草稿：拒收，且一个字都不落盘', () => {
    const { sandbox, store } = scene()
    const cases = [
      ['没有概览', { ...DRAFT, description: '  ' }],
      ['正文为空', { ...DRAFT, body: '   ' }],
      ['正文缺一级概览节', { ...DRAFT, body: '## 小节\n正文\n' }],
      ['summary 不是文本', { ...DRAFT, summary: 42 }],
      ['整体不是对象', '一段文本'],
    ]
    for (const [label, draft] of cases) {
      expect(() => store.create({ sessionId: 'session-xs-consult-a', target: { slug: 'a', name: 'a' }, draft }), label).toThrow()
    }
    expect(sandbox.files()).toEqual([])
  })

  it('目标谱 slug 必须是票 09 的规范形（不规范就拒收，免得提交时才发现读不出来）', () => {
    const { store } = scene()
    expect(() => store.create({ sessionId: 's', target: { slug: 'Zi Wei', name: '紫微' }, draft: DRAFT })).toThrow(/规范/u)
    expect(() => store.create({ sessionId: 's', target: { slug: '紫微', name: '  ' }, draft: DRAFT })).toThrow(/名字/u)
    expect(() => store.create({ sessionId: 's', target: {}, draft: DRAFT })).toThrow()
  })
})

describe('票 15 · 草稿仓：读不回来时返回 null（不猜）', () => {
  it('不存在的 id / 坏 JSON / schema 不是本版 → null', () => {
    const { sandbox, store } = scene()
    expect(store.read('nope')).toBeNull()
    sandbox.write('sediment/broken.json', '{ 这不是 JSON')
    expect(store.read('broken')).toBeNull()
    sandbox.write('sediment/other.json', JSON.stringify({ schema: 'xuanshu/other@1', draftId: 'other' }))
    expect(store.read('other')).toBeNull()
    // 结构自相矛盾（缺 target）：当作读不出来，不把半份草稿送进确认流程。
    sandbox.write('sediment/half.json', JSON.stringify({ schema: SEDIMENT_SCHEMA, draftId: 'half', sessionId: 's', createdAt: 'now' }))
    expect(store.read('half')).toBeNull()
  })

  it('文件名与记录里的 draftId 不一致 → null（防止把 A 的草稿当 B 用）', () => {
    const { sandbox, store } = scene()
    sandbox.write('sediment/mismatch.json', JSON.stringify({ schema: SEDIMENT_SCHEMA, draftId: 'other', sessionId: 's', createdAt: 'now', target: { slug: 'a', name: 'a' }, draft: DRAFT }))
    expect(store.read('mismatch')).toBeNull()
  })
})

describe('票 15 · 草稿仓：draftId 的路径穿越面', () => {
  it('只认 [A-Za-z0-9._-]，`.` / `..` / 分隔符 / 空串一律不认', () => {
    for (const value of ['../escape', '..', '.', 'a/b', 'a\\b', '', 'a b', '草稿']) {
      expect(isDraftId(value), `${JSON.stringify(value)} 不该被认`).toBe(false)
    }
    for (const value of ['1a2b3c', 'draft-1', 'a_b.c']) expect(isDraftId(value)).toBe(true)
  })

  it('恶意 id 既不删也不写数据目录外的文件', () => {
    const { sandbox, store } = scene()
    sandbox.write('outside-marker.txt', 'keep me\n')
    expect(store.read('../../outside-marker')).toBeNull()
    expect(store.remove('../../outside-marker')).toBe(false)
    expect(sandbox.read('outside-marker.txt')).toBe('keep me\n')
    // 落盘路径永远在 <dataDir>/sediment 里。
    expect(sedimentDraftPath(sandbox.dataDir, 'draft-1').startsWith(store.dir)).toBe(true)
  })
})
