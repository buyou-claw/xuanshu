/**
 * 票 12 · 客户端纯模型（S8 的三档 Tag、状态栏、H2 折叠记忆）
 *
 * 这一层判据全是纯函数：不渲染、不发 RPC。界面里最容易搞错的几处（Tag 文案与互斥、
 * 状态栏分母、预算未知、新层默认展开）都在这里逐字钉住。
 *
 * 抓的真实缺陷/风险：
 *   ① **Tag 三档只剩一档**（比如只写「已裁剪」，不区分「超预算未纳入」）：C7① 明文要求三档；
 *   ② **同一层既算 dropped 又算 clipped**：界面会同时亮两枚 Tag，自相矛盾；
 *   ③ **预算未知时显示 0 或空白**：C7⑤ 要的是「预算未知」四个字，不是编一个数；
 *   ④ **折叠记忆整块重置**：用户收起的层在新增一层后被强行展开（H2 明说按层记忆）；
 *   ⑤ **挂载与谱混词**：动词必须「挂载 / 移入本轮」，不能写成「勾选」（C6③）。
 */
import { describe, expect, it } from 'vitest'

import {
  BUDGET_UNKNOWN_NOTE,
  MOUNT_BOUNDARY_LINE,
  createLayerFoldState,
  formatChars,
  isMounted,
  layerNote,
  layerRows,
  layerTag,
  mountsSummary,
  statusFromPreview,
  statusLine,
  toMountRef,
  toggleMount,
} from '../../packages/xuanshu-client/src/client/mounts-model.ts'

/** 造一层预览（只给判据用得到的字段）。 */
const layer = (over = {}) => ({
  id: 'workspace:ws-print',
  kind: 'workspace',
  label: '打印车间',
  chars: 12_400,
  keptChars: 8_420,
  kept: true,
  clipped: true,
  dropped: false,
  keptSegments: [{ label: 'README.md', chars: 8_420 }],
  droppedSegments: [{ label: '早前历史', chars: 3_980, reason: '超预算未纳入' }],
  ...over,
})

describe('票 12 · 三档 Tag（C7①）', () => {
  it('纳入 / 已裁剪 raw→kept 字 / 超预算未纳入 —— 文案逐字', () => {
    expect(layerTag(layer({ clipped: false, keptChars: 12_400 }))).toEqual({ tone: 'included', text: '纳入' })
    expect(layerTag(layer())).toEqual({ tone: 'clipped', text: '已裁剪 12,400→8,420 字' })
    expect(layerTag(layer({ kept: false, keptChars: 0, clipped: false, dropped: true }))).toEqual({ tone: 'dropped', text: '超预算未纳入' })
  })

  it('读不出来单独一档（S8 §6 error①），且优先于其它档', () => {
    expect(layerTag(layer({ error: '路径不存在：E:\\nope', kept: false, keptChars: 0, clipped: false }))).toEqual({ tone: 'error', text: '读不出来' })
  })

  it('互斥：即使数据自相矛盾（dropped && clipped），也只亮「超预算未纳入」', () => {
    expect(layerTag(layer({ dropped: true })).tone).toBe('dropped')
  })

  it('补充说明：丢弃层给「本次不会进入上下文」，读不出来给原因，正常层没有多余一行', () => {
    expect(layerNote(layer({ kept: false, keptChars: 0, clipped: false, dropped: true, reason: '超预算未纳入 · 本次不会进入上下文' }))).toBe('超预算未纳入 · 本次不会进入上下文')
    expect(layerNote(layer({ error: '路径不存在' }))).toBe('路径不存在')
    expect(layerNote(layer())).toBeUndefined()
    expect(layerNote(layer({ kept: false, keptChars: 0, clipped: false, dropped: false, hint: '工作流内容的数据源属票 16' }))).toContain('票 16')
  })
})

describe('票 12 · 状态栏（S8 §2.1⑤/§2.2③；C7②）', () => {
  it('正常态：`挂载 N 字 / 预算 M 字`', () => {
    expect(statusLine({ keptChars: 9_600, budget: 60_000, keptLayers: 2, totalLayers: 2, overBudget: false })).toBe('挂载 9,600 字 / 预算 60,000 字')
  })

  it('超预算补分母：`（已纳入 1 / 3 层）`', () => {
    expect(statusLine({ keptChars: 8_420, budget: 60_000, keptLayers: 1, totalLayers: 3, overBudget: true })).toBe('挂载 8,420 字 / 预算 60,000 字（已纳入 1 / 3 层）')
  })

  it('预算未知：写「预算未知」，**绝不出现数字**（C7⑤）', () => {
    const line = statusLine({ keptChars: 9_600, budget: null, keptLayers: 2, totalLayers: 2, overBudget: false })
    expect(line).toBe('挂载 9,600 字 / 预算未知')
    expect(line).not.toMatch(/预算\s*[\d,]/u)
    expect(BUDGET_UNKNOWN_NOTE).toContain('不会替你编一个数')
  })

  it('千分位口径只有一处（formatChars）', () => {
    expect(formatChars(8_420)).toBe('8,420')
    expect(formatChars(0)).toBe('0')
    expect(formatChars(-3)).toBe('0')
    expect(formatChars(999)).toBe('999')
  })

  it('statusFromPreview：超预算判据是 truncatedChars > 0；没读过预览 → undefined（界面显示读取中）', () => {
    expect(statusFromPreview(undefined)).toBeUndefined()
    const status = statusFromPreview({ layers: [], totalChars: 5_300, keptChars: 120, budget: 1_000, truncatedChars: 5_180, keptLayers: 1, totalLayers: 2, notice: '', notes: [] })
    expect(status).toEqual({ keptChars: 120, budget: 1_000, keptLayers: 1, totalLayers: 2, overBudget: true })
    expect(statusFromPreview({ layers: [], totalChars: 10, keptChars: 10, budget: null, truncatedChars: 0, keptLayers: 1, totalLayers: 1, notice: '', notes: [] })?.budget).toBeNull()
  })
})

describe('票 12 · 选择与折叠（C6③ / H2）', () => {
  const print = { kind: 'workspace', id: 'ws-print', label: '打印车间' }
  const dev = { kind: 'workspace', id: 'ws-xuanshu', label: '玄枢开发' }

  it('选入 / 移出：同 kind+id 去重；同名不同 kind 是两回事', () => {
    expect(toggleMount([], print)).toEqual([print])
    expect(toggleMount([print], print)).toEqual([])
    expect(toggleMount([print], { kind: 'workflow', id: 'ws-print', label: '同 id 的工作流' })).toHaveLength(2)
    expect(isMounted([print], print)).toBe(true)
    expect(isMounted([print], dev)).toBe(false)
  })

  it('候选行 → MountRef：标题空就用 path（不显示一个空标签）', () => {
    expect(toMountRef({ id: 'ws-1', path: 'E:\\work\\a', title: '甲', sessionCount: 2, updatedAt: '2026-10-11T00:00:00.000Z' })).toEqual({ kind: 'workspace', id: 'ws-1', label: '甲' })
    expect(toMountRef({ id: 'ws-2', path: 'E:\\work\\b', title: '', sessionCount: 0, updatedAt: '' }).label).toBe('E:\\work\\b')
  })

  it('H2：新出现的层默认展开；手动收起过的**保持收起**（按层记忆，不整块重置）', () => {
    const fold = createLayerFoldState()
    expect(fold.isOpen('workspace:ws-print')).toBe(true)
    fold.toggle('workspace:ws-print')
    expect(fold.isOpen('workspace:ws-print')).toBe(false)
    // 新来一层：它默认展开，而刚才那层仍然保持收起
    expect(fold.isOpen('workspace:ws-xuanshu')).toBe(true)
    expect(fold.isOpen('workspace:ws-print')).toBe(false)
    expect(fold.collapsedIds()).toEqual(['workspace:ws-print'])
    fold.toggle('workspace:ws-print')
    expect(fold.isOpen('workspace:ws-print')).toBe(true)
  })

  it('层行：顺序 = 挂载顺序，保留/裁掉两列各就各位', () => {
    const rows = layerRows({ layers: [layer(), layer({ id: 'workspace:ws-x', label: '玄枢开发', kept: false, keptChars: 0, clipped: false, dropped: true, keptSegments: [], droppedSegments: [{ label: 'README.md', chars: 5_000, reason: '超预算未纳入' }] })], totalChars: 0, keptChars: 0, budget: null, truncatedChars: 0, keptLayers: 1, totalLayers: 2, notice: '', notes: [] })
    expect(rows.map((row) => row.layer.label)).toEqual(['打印车间', '玄枢开发'])
    expect(rows[0].keptLabels).toEqual(['README.md'])
    expect(rows[0].droppedLabels).toEqual(['早前历史'])
    expect(rows[1].tag.text).toBe('超预算未纳入')
  })

  it('边界句与摘要：挂载 ≠ 谱；挂载动作的措辞里不许出现「勾选」', () => {
    expect(MOUNT_BOUNDARY_LINE).toContain('工作区')
    expect(MOUNT_BOUNDARY_LINE).toContain('谱不在这里')
    // 边界句**必须**把用户指去谱那边（「谱在问事面板里勾选」），所以「勾选」出现在这句里是对的；
    // 判据是：**挂载自己的摘要/动词**不许用「勾选」这个词（C6③ 的措辞约束）。
    expect(MOUNT_BOUNDARY_LINE).toContain('谱在问事面板里勾选')
    expect(mountsSummary([])).toContain('没有临时挂载')
    expect(mountsSummary([print, { kind: 'workflow', id: 'wf-1', label: '排产' }])).toBe('本次临时挂载：1 个工作区 + 1 个工作流（打印车间、排产）。')
    expect(mountsSummary([print])).not.toContain('勾选')
  })
})
