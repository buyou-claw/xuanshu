/**
 * 票 12 · 确定性分层裁剪（S8 §2.2/§2.3/§5 步骤 3；契约 §2「裁剪是确定性函数」）
 *
 * 这一组是 C7 的账本位：**三档 Tag 缺一不可**（`纳入` / `已裁剪 raw→kept` / `超预算未纳入`），
 * 且 `dropped` 与 `clipped` **互斥**。断言全打在纯函数的返回值上 —— 不吃 LLM、不吃时间，
 * 所以「预览看到的」与「确认后注入的」是同一份结果。
 *
 * 抓的真实缺陷/风险：
 *   ① **切半句话**：按字数硬切会把一段正文砍成两半，注入的上下文带着半句话；
 *      这里按**段边界**裁（段 = 一个文件），并断言「保留的段就是原段序列的前缀」。
 *   ② **只给一句「已裁剪」**：C7① 要求逐层一枚 Tag，且要能展开看「保留 / 裁掉」。
 *   ③ **静默截断**：超预算的层必须**整层丢弃**并写明「本次不会进入上下文」。
 *   ④ **预算未知时编一个数**：`budget: null` 必须原样传出去、不裁剪、并说明为什么（C7⑤）。
 *   ⑤ **读不出来的层去抢别人的水位**：坏层不占公平份额（否则一个坏挂载会把好挂载挤小）。
 */
import { describe, expect, it } from 'vitest'

import { clipMountLayers } from '../../packages/xuanshu-host/lib/mounts/clip.mjs'

/** 造一层：`sizes` 是各段字数（段 = 一个文件）。 */
function layer(label, sizes, over = {}) {
  return {
    id: `workspace:${label}`,
    kind: 'workspace',
    label,
    head: `工作区「${label}」`,
    segments: sizes.map((chars, index) => ({ id: `${label}#${index}`, label: `${label}/f${index}.md`, chars, text: 'x'.repeat(chars) })),
    dropped: [],
    ...over,
  }
}

/** 段标签序列（断言「按段边界」用）。 */
const segLabels = (row, key) => row[key].map((segment) => segment.label)

describe('票 12 · clip：未超预算就不动它', () => {
  it('总量 ≤ 预算：全部纳入、零裁剪，notice 也照实说「没有裁剪」', () => {
    const result = clipMountLayers([layer('A', [100, 200]), layer('B', [300])], 1000)
    expect(result.totalChars).toBe(600)
    expect(result.keptChars).toBe(600)
    expect(result.truncatedChars).toBe(0)
    expect(result.budget).toBe(1000)
    expect(result.keptLayers).toBe(2)
    for (const row of result.layers) {
      expect(row.kept).toBe(true)
      expect(row.clipped).toBe(false)
      expect(row.dropped).toBe(false)
      expect(row.keptChars).toBe(row.chars)
    }
    expect(result.notice).toContain('没有裁剪')
    expect(result.notice).toContain('600')
  })
})

describe('票 12 · clip：段边界公平裁剪（S8 §2.3）', () => {
  it('两层各 120 / 90 字、预算 100：水位 50，A 留 40、B 靠余量补到 60，一分不多一分不少', () => {
    const result = clipMountLayers([layer('A', [40, 40, 40]), layer('B', [30, 30, 30])], 100)
    expect(result.totalChars).toBe(210)
    expect(result.keptChars).toBe(100)
    expect(result.truncatedChars).toBe(110)
    const [a, b] = result.layers
    expect(a.chars).toBe(120)
    expect(a.keptChars).toBe(40)
    expect(a.clipped, 'A 被裁过').toBe(true)
    expect(a.dropped).toBe(false)
    expect(segLabels(a, 'keptSegments')).toEqual(['A/f0.md'])
    expect(a.droppedSegments.map((item) => item.reason)).toEqual(['超预算未纳入', '超预算未纳入'])
    expect(b.keptChars).toBe(60)
    expect(b.clipped).toBe(true)
    expect(segLabels(b, 'keptSegments')).toEqual(['B/f0.md', 'B/f1.md'])
  })

  it('**不切半句话**：每层保留的段就是它原段序列的前缀（逐段完整、顺序不变）', () => {
    const source = layer('A', [10, 20, 30, 40, 50])
    const result = clipMountLayers([source], 70)
    const row = result.layers[0]
    const keptLabels = segLabels(row, 'keptSegments')
    const allLabels = source.segments.map((segment) => segment.label)
    expect(keptLabels).toEqual(allLabels.slice(0, keptLabels.length))
    expect(row.keptChars).toBe(10 + 20 + 30)
    // 段内容一个字符都没被改（裁的是「整段要不要」，不是段内切片）
    expect(row.segments.map((segment) => segment.chars)).toEqual([10, 20, 30])
  })

  it('确定性：同一份输入两次调用逐字段相同（预览与注入不可能各算一套）', () => {
    const source = () => [layer('A', [40, 40, 40]), layer('B', [30, 30, 30])]
    expect(clipMountLayers(source(), 100)).toEqual(clipMountLayers(source(), 100))
  })
})

describe('票 12 · clip：超预算整层丢弃（S8 §2.2）', () => {
  it('一层进、一层被丢：丢的那层写明「本次不会进入上下文」，且**不静默截断**', () => {
    const result = clipMountLayers([layer('打印车间', [30]), layer('玄枢开发', [500])], 50)
    const [kept, gone] = result.layers
    expect(kept.kept).toBe(true)
    expect(kept.dropped).toBe(false)
    expect(kept.keptChars).toBe(30)
    expect(gone.kept).toBe(false)
    expect(gone.dropped).toBe(true)
    expect(gone.keptChars).toBe(0)
    expect(gone.reason).toContain('超预算未纳入')
    expect(gone.reason).toContain('本次不会进入上下文')
    expect(gone.droppedSegments[0].reason).toBe('超预算未纳入')
    expect(result.keptLayers).toBe(1)
    expect(result.notice).toContain('1 / 2 层')
  })

  it('`dropped` 与 `clipped` 互斥（C7①：三档 Tag 不许同时亮两枚）', () => {
    const result = clipMountLayers([layer('A', [30, 30]), layer('B', [500]), layer('C', [10, 10, 10])], 60)
    for (const row of result.layers) {
      expect(row.dropped && row.clipped, `${row.label} 同时是 dropped 与 clipped`).toBe(false)
    }
  })

  it('读不出来的层不占公平水位（坏挂载不许把好挂载挤小），且披露里带原因', () => {
    const broken = { id: 'workspace:坏', kind: 'workspace', label: '坏工作区', head: '工作区「坏工作区」', segments: [], dropped: [], error: '路径不存在：E:\\nope' }
    // 有内容的只有一层 → 水位 = 整个预算（100）：A 能留下 80。
    // 若坏层也参与分水位，水位会变成 50，而 A 的首段就是 80 > 50 → A 会被整层丢掉（keptChars=0）。
    // 所以 `keptChars === 80` 就是「坏层不占份额」的机器判据。
    const result = clipMountLayers([broken, layer('A', [80, 80])], 100)
    const [bad, good] = result.layers
    expect(bad.kept).toBe(false)
    expect(bad.dropped, '读不出来不是「超预算丢弃」，别把它算成丢弃').toBe(false)
    expect(bad.error).toContain('路径不存在')
    expect(good.keptChars).toBe(80)
    expect(good.clipped, 'A 的 160 字被裁到 80：它确实被裁过').toBe(true)
  })

  it('策略排除的文件（二进制 / 锁文件）出现在 droppedSegments 里，理由是人话（S8 §2.3）', () => {
    const withDropped = layer('A', [50], {
      dropped: [{ label: 'A/logo.png', chars: 0, reason: '二进制或媒体文件' }, { label: 'A/pnpm-lock.yaml', chars: 0, reason: '锁文件（只有哈希与求解结果）' }],
    })
    const result = clipMountLayers([withDropped], 1000)
    const row = result.layers[0]
    expect(row.droppedSegments.map((item) => item.label)).toEqual(['A/logo.png', 'A/pnpm-lock.yaml'])
    expect(row.droppedSegments.every((item) => typeof item.reason === 'string' && item.reason !== '')).toBe(true)
    // 没读的东西不占字数：总量只算读到的段
    expect(result.totalChars).toBe(50)
  })
})

describe('票 12 · clip：预算未知（C7⑤ / S8 §6 error③）', () => {
  it('budget=null：不裁剪、全部纳入，并说明「预算未知」——不编一个数', () => {
    const result = clipMountLayers([layer('A', [100, 100]), layer('B', [100])], null)
    expect(result.budget).toBeNull()
    expect(result.truncatedChars).toBe(0)
    expect(result.keptChars).toBe(300)
    expect(result.notes.join('\n')).toContain('预算未知')
    expect(result.notice).toContain('预算未知')
    // 不许出现任何被编出来的预算数字
    expect(result.notice).not.toMatch(/预算\s*\d/u)
  })
})
