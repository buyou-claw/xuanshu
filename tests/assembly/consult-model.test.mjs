/**
 * 票 10 · 问事门厅与历史回看的纯模型（S6 §2/§3/§9；S7 §2/§3；冻结契约 §1/§2/§3）。
 *
 * 断言的都是**能在界面上看见、也能被契约钉住**的事实：
 *   - sessionId 形状 `session-xs-consult-…`（ADR-0009：分类靠自铸前缀，不靠 meta）；
 *   - 底座 / 底稿是**恒定在场项**，不进 `pus`（契约 §1 明文）；
 *   - base 级可选谱**默认勾选**、optional 默认不勾（S6 §2.1 / pu-spec §4）；
 *   - 历史列表按本地时间倒序分组，搜索**只搜标题**（S7 §3③ 明写「不搜全文」）；
 *   - 「无源拦截引导」的判定条件收窄为「无勾选可选谱 **且** 无挂载项」（S6 §7 同名行）。
 */
import { describe, expect, it } from 'vitest'

import {
  CONSULT_SESSION_PREFIX,
  contextSummary,
  draftBadgeLabel,
  draftRoundLabel,
  filterHistory,
  formatHistoryMeta,
  groupHistory,
  groupOptional,
  historyEmptyCopy,
  initialSelection,
  isConsultSession,
  nudgeNeeded,
  openConsultSession,
  reviewTimeline,
  roleLabel,
  shortConsultId,
  toggleSelection,
} from '../../packages/xuanshu-client/src/client/consult-model.ts'

/** 两个可选谱：一个 base 级（默认勾选）、一个 optional 级（默认不勾）。 */
const optional = [
  { slug: 'rensheng-jingli', name: '人生经历', level: 'base', summary: '成长与转折的骨架' },
  { slug: 'ruanjian-kaifa', name: '软件开发', level: 'optional', summary: '技术栈与项目史' },
]

const summary = (over = {}) => ({
  sessionId: 'session-xs-consult-9f8e7d6c-0000-4000-8000-000000000000',
  title: '转岗时机',
  createdAt: '2026-10-15T00:41:00.000Z',
  pus: ['ruanjian-kaifa'],
  mounts: [],
  turns: 5,
  ...over,
})

describe('票 10 · 会话 id 形状与展示（ADR-0009 §1）', () => {
  it('前缀是契约的一部分：`session-xs-consult-`，改它等于改数据格式', () => {
    expect(CONSULT_SESSION_PREFIX).toBe('session-xs-consult-')
    expect(isConsultSession('session-xs-consult-1a2b')).toBe(true)
    // 别的玄枢自铸会话（票 13 的日课 / 底稿定时会话）不是问事，不能被本面板当问事列。
    expect(isConsultSession('session-xs-rikke-1a2b')).toBe(false)
    expect(isConsultSession('session-1a2b')).toBe(false)
  })

  it('列表行显示短 id：`#consult-<uuid 前 8 位>`（不显示整串 uuid，也不显示工作区）', () => {
    expect(shortConsultId('session-xs-consult-9f8e7d6c-0000-4000-8000-000000000000')).toBe('#consult-9f8e7d6c')
    expect(shortConsultId('session-xs-consult-short')).toBe('#consult-short')
  })
})

describe('票 10 · 勾选谱：锁定项与两组可选谱（S6 §2.1 / §9 C5）', () => {
  it('底座与底稿是恒定在场项：不进任何勾选集合（契约 §1）', () => {
    const selected = initialSelection(optional)
    expect(selected).toEqual(['rensheng-jingli'])
    expect(selected).not.toContain('base-pu')
    expect(selected).not.toContain('digao')
  })

  it('base 级默认勾选、optional 级默认不勾；按级别分组且组序 = base 在前', () => {
    const groups = groupOptional(optional)
    expect(groups.map((group) => group.level)).toEqual(['base', 'optional'])
    expect(groups[0].items.map((item) => item.slug)).toEqual(['rensheng-jingli'])
    expect(groups[1].items.map((item) => item.slug)).toEqual(['ruanjian-kaifa'])
  })

  it('空组不显示（没有 optional 谱时不出现空分组头）', () => {
    expect(groupOptional([optional[0]]).map((group) => group.level)).toEqual(['base'])
    expect(groupOptional([])).toEqual([])
  })

  it('勾选 / 取消勾选是集合语义：重复勾不产生重复项', () => {
    expect(toggleSelection([], 'a')).toEqual(['a'])
    expect(toggleSelection(['a'], 'a')).toEqual([])
    expect(toggleSelection(['a', 'b'], 'b')).toEqual(['a'])
    // 顺序按操作历史保留（强调「这一次勾了什么」，不重排）
    expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('「本次上下文将含」摘要行：底座 + 底稿恒在，谱与挂载按实际数量（S6 §2.1②）', () => {
    expect(contextSummary({ selected: [], mounts: [] })).toBe('底座 + 底稿')
    expect(contextSummary({ selected: ['a'], mounts: [] })).toBe('底座 + 底稿 + 1 个谱')
    expect(contextSummary({ selected: ['a', 'b'], mounts: [] })).toBe('底座 + 底稿 + 2 个谱')
    expect(contextSummary({ selected: [], mounts: [{ kind: 'workspace', id: 'w1', label: '打印车间' }] })).toBe(
      '底座 + 底稿 + 1 项挂载',
    )
    expect(
      contextSummary({ selected: ['a'], mounts: [{ kind: 'workspace', id: 'w1', label: '打印车间' }, { kind: 'workflow', id: 'f1', label: '周报' }] }),
    ).toBe('底座 + 底稿 + 1 个谱 + 2 项挂载')
  })

  it('一个可选谱都没有时给可执行的追加行（S6 §6 empty）', () => {
    expect(historyEmptyCopy.noneOptionalPu).toContain('谱都非必填')
    expect(historyEmptyCopy.noneOptionalPu).toContain('去 S5')
  })
})

describe('票 10 · 无源拦截引导（S6 §5 步骤 5a / §7 同名行）', () => {
  it('只在「有问题 + 无勾选可选谱 + 无挂载项」时触发（底座与底稿不构成针对该事项的依据）', () => {
    expect(nudgeNeeded({ question: '帮我看转岗时机', selected: [], mounts: [] })).toBe(true)
    // 勾了谱：不再拦
    expect(nudgeNeeded({ question: '帮我看转岗时机', selected: ['a'], mounts: [] })).toBe(false)
    // 有挂载：不再拦
    expect(nudgeNeeded({ question: '帮我看转岗时机', selected: [], mounts: [{ kind: 'workspace', id: 'w', label: 'x' }] })).toBe(false)
    // 空问题（只是开一个会话）：不拦 —— 引导只在「要发出去」这一刻有意义
    expect(nudgeNeeded({ question: '   ', selected: [], mounts: [] })).toBe(false)
  })
})

describe('票 10 · 历史列表的分组、过滤与元信息（S7 §2.1 / §3①②③）', () => {
  const now = new Date('2026-10-15T09:00:00+08:00')

  it('按本地日期分组：今天 / 更早（更早带 MM-DD），组内按时间倒序', () => {
    const items = [
      summary({ sessionId: 'session-xs-consult-a', title: 'A', createdAt: '2026-10-15T00:41:00.000Z' }),
      summary({ sessionId: 'session-xs-consult-b', title: 'B', createdAt: '2026-10-14T02:12:00.000Z' }),
      summary({ sessionId: 'session-xs-consult-c', title: 'C', createdAt: '2026-10-10T14:03:00.000Z' }),
    ]
    const groups = groupHistory(items, now)
    expect(groups.map((group) => group.label)).toEqual(['今天 · 1 条', '更早 · 10-14 · 1 条', '更早 · 10-10 · 1 条'])
    expect(groups[0].items.map((item) => item.title)).toEqual(['A'])
    expect(groups[1].items.map((item) => item.title)).toEqual(['B'])
  })

  it('元信息行：时间 · 轮数 · 谱数（挂载为 0 时不写「挂载 0」，只写有内容的）', () => {
    // 时刻是**本地时间**，所以只断形状；轮数 / 谱数 / 挂载才是这一行要传达的事实。
    expect(formatHistoryMeta(summary())).toMatch(/^\d{2}:\d{2} · 5 轮 · 谱 1$/)
    expect(formatHistoryMeta(summary({ mounts: [{ kind: 'workspace', id: 'w', label: '打印车间' }] }))).toMatch(
      /^\d{2}:\d{2} · 5 轮 · 谱 1 · 挂载 1$/,
    )
    expect(formatHistoryMeta(summary({ turns: 0, pus: [] }))).toMatch(/^\d{2}:\d{2} · 0 轮 · 谱 0$/)
  })

  it('搜索**只搜标题**（S7 §3③：不搜全文），范围筛选收成 全部 / 今天 / 更早', () => {
    const items = [
      summary({ sessionId: 'session-xs-consult-a', title: '转岗时机', createdAt: '2026-10-15T00:41:00.000Z' }),
      summary({ sessionId: 'session-xs-consult-b', title: '房子的朝向', createdAt: '2026-10-10T00:41:00.000Z' }),
    ]
    expect(filterHistory(items, '转岗', 'all', now).map((item) => item.title)).toEqual(['转岗时机'])
    expect(filterHistory(items, '朝向', 'all', now).map((item) => item.title)).toEqual(['房子的朝向'])
    // 标题里没有的正文词不命中（本版本就没有正文可搜 —— 界面也要这么说）
    expect(filterHistory(items, '打印车间', 'all', now)).toEqual([])
    expect(filterHistory(items, '', 'today', now).map((item) => item.title)).toEqual(['转岗时机'])
    expect(filterHistory(items, '', 'earlier', now).map((item) => item.title)).toEqual(['房子的朝向'])
    expect(filterHistory(items, '', 'all', now)).toHaveLength(2)
  })

  it('消息角色标签：user → 你，assistant → AI（S7 §2.2 的正文行）', () => {
    expect(roleLabel('user')).toBe('你')
    expect(roleLabel('assistant')).toBe('AI')
  })
})

/* ───────────────────────── 「打开那个会话」的编排（不许静默失败） ───────────────────────── */

describe('票 10 · 打开宿主建的会话：先 refresh 再 openSession，失败要可读', () => {
  /**
   * 为什么这条编排值得单独成函数并逐条断言（`dsh-api-facts.md` 附录 F 的实证）：
   * `openSession(id)` 内部直接 `retain(id)` 且**没有 try/catch**（`dsh-client-ui-workspace/lib/client.js:821-823,973`），
   * 而 `retain` 对不在客户端会话目录里的 id **同步抛** `unknown session`
   * （`dsh-api-session-controller/.../sessions/manager.js:63-71`）；宿主建的会话只靠
   * `api-session/added` 推送进目录，推送与 RPC 回包的到达顺序**没有被证明有序**。
   * 所以「RPC 一返回就 openSession」不可靠，而失败又绝不能静默 —— 用户会以为按钮坏了。
   */
  const sessionId = 'session-xs-consult-9f8e7d6c-0000-4000-8000-000000000000'

  it('顺序：refresh 必须在 openSession **之前**被调用（各恰一次），成功即 ok', async () => {
    const order = []
    const result = await openConsultSession({
      sessionId,
      refresh: async () => { order.push('refresh') },
      open: (id) => { order.push(`open:${id}`) },
    })
    expect(order).toEqual(['refresh', `open:${sessionId}`])
    expect(result).toEqual({ ok: true })
  })

  it('refresh 失败：不硬闯 openSession，返回可读失败（含短 id，让用户能自己找到会话）', async () => {
    const order = []
    const result = await openConsultSession({
      sessionId,
      refresh: async () => { throw new Error('session.list 超时') },
      open: () => { order.push('open') },
    })
    expect(order, 'refresh 失败时不该再调 openSession（那正是 unknown session 抛错的那条路）').toEqual([])
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('refresh-failed')
    expect(result.message).toContain('session.list 超时')
    expect(result.message).toContain('#consult-9f8e7d6c')
  })

  it('openSession 抛 unknown session：返回可读失败而不是静默吞掉', async () => {
    const result = await openConsultSession({
      sessionId,
      refresh: async () => {},
      open: () => { throw new Error('sessions.retain: unknown session session-xs-consult-9f8e7d6c') },
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('open-failed')
    expect(result.message).toContain('unknown session')
    expect(result.message).toContain('#consult-9f8e7d6c')
  })

  it('DSH 会话面板不可用（open 缺席）：仍给可读失败 + 短 id，且不去刷目录', async () => {
    const order = []
    const result = await openConsultSession({
      sessionId,
      refresh: async () => { order.push('refresh') },
    })
    expect(order).toEqual([])
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('unavailable')
    expect(result.message).toContain('#consult-9f8e7d6c')
  })

  it('客户端不自己造 id：open 拿到的就是传进来的那一个', async () => {
    const seen = []
    await openConsultSession({
      sessionId: 'session-xs-consult-abc',
      refresh: async () => {},
      open: (id) => { seen.push(id) },
    })
    expect(seen).toEqual(['session-xs-consult-abc'])
  })
})

/* ───────────────────────── 回看：按轮分组 + 当前采用稿（票 31 / Spec 002 §补两处已知缺陷） ───────────────────────── */

/**
 * 「当前采用稿」从**全场一份**变成**各轮各一份**之后，回看要按轮分组渲染。
 *
 * 判据全在宿主给的 `drafts` 上（`consult.read` 的加性字段）：客户端只查表，**不自己**再实现
 * 一遍按轮语义 —— 两处各算一遍必然漂移，而漂移的界面会「历史里算当前、回看里不算」。
 */
describe('票 31 · 回看按轮分组与当前采用稿', () => {
  const draftsOf = (over = {}) => ({
    rounds: [
      { runId: 'bestof-r1', round: 1, messageIds: ['m-r1'], currentId: 'm-r1', rejected: false },
      { runId: 'bestof-r2', round: 2, messageIds: ['m-r2'], currentId: undefined, rejected: true },
    ],
    resolved: true,
    currentIds: ['m-r1'],
    ...over,
  })

  const messages = [
    { role: 'user', text: '帮我看这次转岗的时机' },
    { role: 'user', text: '方案 A：先按 3000/月 试算。', source: 'xuanshu-bestof-adopted', messageId: 'm-r1' },
    { role: 'assistant', text: '好，按 A 记下。' },
    { role: 'user', text: '方案 B：先核对前提。', source: 'xuanshu-bestof-adopted', messageId: 'm-r2' },
  ]

  it('同一轮的采用稿合成一组（按日志顺序），普通消息原样单独出现', () => {
    const items = reviewTimeline(messages, draftsOf())
    expect(items.map((item) => (item.kind === 'round' ? `round:${String(item.round)}:${item.state}` : 'message'))).toEqual([
      'message',
      'round:1:current',
      'message',
      'round:2:rejected',
    ])
    expect(items[1].items.map((row) => row.state)).toEqual(['current'])
  })

  it('每轮标出当前采用稿；被否决的轮**不显示为当前**（item 也标 rejected）', () => {
    const items = reviewTimeline(messages, draftsOf())
    const first = items.find((item) => item.kind === 'round' && item.round === 1)
    const second = items.find((item) => item.kind === 'round' && item.round === 2)
    expect(first.state).toBe('current')
    expect(first.items[0].state).toBe('current')
    expect(second.state).toBe('rejected')
    expect(second.items[0].state).toBe('rejected')
    expect(draftRoundLabel(first)).toContain('第 1 轮合参')
    expect(draftRoundLabel(first)).toContain('当前采用稿')
    expect(draftRoundLabel(second)).toContain('已否决')
    expect(draftRoundLabel(second)).not.toContain('当前采用稿')
    expect(draftBadgeLabel('rejected')).toBe('已被否决 · 非当前')
    expect(draftBadgeLabel('current')).toBe('当前采用稿')
  })

  it('同一轮改选：旧的那份标「已被取代」，当前只标最后一份；同轮两稿合成一组', () => {
    const rounds = [{
      runId: 'bestof-r1',
      round: 1,
      messageIds: ['m-c1', 'm-c2'],
      currentId: 'm-c2',
      rejected: false,
    }]
    const items = reviewTimeline([
      { role: 'user', text: 'C1', source: 'xuanshu-bestof-adopted', messageId: 'm-c1' },
      { role: 'user', text: 'C2', source: 'xuanshu-bestof-adopted', messageId: 'm-c2' },
    ], { rounds, resolved: true, currentIds: ['m-c2'] })
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('round')
    expect(items[0].items.map((row) => row.state)).toEqual(['superseded', 'current'])
    expect(draftRoundLabel(items[0])).toContain('当前采用稿')
  })

  it('没有 drafts（老宿主 / 没有合参记录）→ 全部按普通消息渲染：**一个字符都不改**', () => {
    for (const drafts of [undefined, null]) {
      const items = reviewTimeline(messages, drafts)
      expect(items.every((item) => item.kind === 'message')).toBe(true)
      expect(items).toHaveLength(messages.length)
    }
  })

  it('对不上任何轮次的采用稿（账本里没有它）：当普通消息渲染，**不声称**它是当前或被取代', () => {
    const items = reviewTimeline(
      [{ role: 'user', text: '来历不明的一份', source: 'xuanshu-bestof-adopted', messageId: 'm-unknown' }],
      draftsOf(),
    )
    expect(items[0].kind).toBe('message')
  })
})
