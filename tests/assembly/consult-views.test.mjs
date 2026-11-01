/**
 * 票 10 · 问事门厅与历史回看的组件级断言（S6 §2；S7 §2；冻结契约 §3/§4）。
 *
 * 这一层断言**界面上能看见的事实**（票面验收里最容易被「结构对但口径丢了」糊过去的部分）：
 *   - 底座 / 底稿是**恒定在场**：勾选框 `disabled` + 理由文案，**不移除节点**（契约 §3）；
 *   - 其余谱按级别分组，base 默认勾选、optional 默认不勾；「本次上下文将含」随勾选重算；
 *   - 门厅**不画消息流**（F1/D5）：只给「最近一次会话摘要卡 + [继续这次问事 ▸]」，
 *     正式对话在 DSH 原生 `conversation` 面板（`ctx.uiWorkspace.openSession` 只导航）；
 *   - 历史子页：分组倒序、搜索只搜标题、**点开即读且零编辑控件**（S7 §6 只读态）；
 *   - 无源拦截引导：两条去路 + 一枚「只带底座 + 底稿问一次」的显式出口（S6 §5 步骤 5a）。
 *
 * 环境：`renderToStaticMarkup`（Node 里没有 jsdom），因此这里只驱动**受控组件**；
 * 点击链条（勾选 → 开会话 → 切面板、点行 → 读会话）由 `consult.tsx` 的状态机承担，
 * **未被本文件覆盖**（在交付报告里如实标注）。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { contextSummary } from '../../packages/xuanshu-client/src/client/consult-model.ts'
import { ConsultPanel } from '../../packages/xuanshu-client/src/client/consult.tsx'
import {
  XsConsultAsk,
  XsConsultHistoryList,
  XsConsultHistoryReader,
  XsConsultMountPlaceholder,
  XsConsultPicker,
  XsConsultRecentCard,
} from '../../packages/xuanshu-client/src/client/consult-views.tsx'

const render = (element) => renderToStaticMarkup(element)

/** 按标记切出承载它的那个标签。 */
function tagOf(html, marker) {
  const start = html.indexOf(marker)
  expect(start, `没有找到 ${marker}`).toBeGreaterThanOrEqual(0)
  const open = html.lastIndexOf('<', start)
  const close = html.indexOf('>', start)
  return html.slice(open, close + 1)
}

/** 按标记切出该元素的**整段**（含内容），用于「这块里有没有输入控件」类断言。 */
function blockOf(html, marker) {
  const start = html.indexOf(marker)
  expect(start, `没有找到 ${marker}`).toBeGreaterThanOrEqual(0)
  const open = html.lastIndexOf('<', start)
  const tag = /^<([a-zA-Z]+)/.exec(html.slice(open))?.[1]
  const close = html.indexOf(`</${String(tag)}>`, open)
  return html.slice(open, close === -1 ? undefined : close + tag.length + 3)
}

/** 契约 §2 的 `consult.defaults` 样例：底座在场、底稿未生成、两个可选谱。 */
const defaults = () => ({
  required: [
    { kind: 'base-pu', name: '底座（八字）', present: true },
    { kind: 'digao', name: '底稿', present: false, reason: '底稿还没生成（属票 13 · 底稿与日课）' },
  ],
  optional: [
    { slug: 'rensheng-jingli', name: '人生经历', level: 'base', summary: '成长与转折的骨架' },
    { slug: 'ruanjian-kaifa', name: '软件开发', level: 'optional', summary: '技术栈与项目史' },
  ],
})

const summaryOf = (over = {}) => ({
  sessionId: 'session-xs-consult-9f8e7d6c-0000-4000-8000-000000000000',
  title: '转岗时机',
  createdAt: '2026-10-15T00:41:00.000Z',
  pus: ['ruanjian-kaifa'],
  mounts: [],
  turns: 5,
  ...over,
})

/* ───────────────────────── 勾选谱（S6 §2.1① / §9 C5；契约 §3） ───────────────────────── */

describe('票 10 · 勾选谱：恒定在场项 + 两组可选谱', () => {
  const picker = () =>
    render(
      h(XsConsultPicker, {
        required: defaults().required,
        optional: defaults().optional,
        selected: ['rensheng-jingli'],
        onToggle: () => {},
        onManagePu: () => {},
        onOpenDetail: () => {},
      }),
    )

  it('底座与底稿是**非交互锁定行**：行内没有勾选框，🔒 与「默认在场 · 不可关」逐字在', () => {
    const html = picker()
    // 三重区分之一：分组头（另两重是缩进与「无勾选框」）。
    expect(html).toContain('data-xuanshu-group-head="locked"')
    expect(blockOf(html, 'data-xuanshu-group-head="locked"')).toContain('默认在场 · 不可关')
    for (const [kind, name] of [['base-pu', '底座（八字）'], ['digao', '底稿']]) {
      const row = blockOf(html, `data-xuanshu-locked="${kind}"`)
      expect(row).toContain(name)
      expect(row).toContain('🔒')
      expect(row).toContain('默认在场 · 不可关')
      // S6 §9 C5（`S6-问事面板.md:192`，另见 `:48`/`:102`/`:110`/`:223`）：锁定行**不是被禁用的
      // 复选框，而是根本不该有复选框** —— 所以这里断「不存在 input」，比「存在但 disabled」更强。
      expect(row, `${name} 的锁定行内不许有任何勾选框`).not.toMatch(/<input/)
    }
    // 底稿是纯派生：徽标逐字（C2 与 S13 同款）
    expect(blockOf(picker(), 'data-xuanshu-locked="digao"')).toContain('纯派生 · 不可手改')
    // 缺席时把理由写在卡里（不是静默灰掉）
    expect(picker()).toContain('底稿还没生成（属票 13 · 底稿与日课）')
  })

  it('点锁定行只弹说明卡：给「不可关」的因果与「要改就改源头」的去路，**不给任何取消途径**', () => {
    const html = picker()
    const baseCard = blockOf(html, 'data-xuanshu-locked-card="base-pu"')
    expect(baseCard).toContain('始终在场、不可关')
    expect(baseCard).toContain('重新录制出生信息')
    expect(baseCard).toContain('data-xuanshu-action="locked-goto-mingpan"')

    // 底稿说明卡的三个源头（S6 §3 表 `:102`：谱 / 工作区 / 工作流）——这是**源头的名字**，
    // 不是勾选项：它与 C6②「勾选清单里不出现工作区」不冲突（那条由下一组用例按勾选块断言）。
    const digaoCard = blockOf(html, 'data-xuanshu-locked-card="digao"')
    expect(digaoCard).toContain('与八字同级')
    expect(digaoCard).toContain('纯派生')
    expect(digaoCard).toContain('要改就改源头')
    for (const source of ['谱', '工作区', '工作流']) expect(digaoCard).toContain(source)
    // #69 / 判据 N-001：去路仍然在，但**不是第二扇门** —— 谱管理只有侧栏行「谱」一个入口，
    // 所以这张卡指的是侧栏行，而不是再挂一枚「去谱管理 ▸」按钮（同一动作两个入口即红）。
    expect(digaoCard, '谱管理的门只剩侧栏行：这里不该再有按钮').not.toMatch(/<button[^>]*>去谱管理/u)
    expect(digaoCard).toContain('侧栏「谱」')

    // 锁定行不给任何「取消 / 关掉这一项」的途径
    expect(html).not.toMatch(/data-xuanshu-action="(unlock|disable-locked|cancel-locked)/)
  })

  it('可选谱按级别分组：base 组头写明「默认勾选」，行是可勾的 checkbox', () => {
    const html = picker()
    expect(blockOf(html, 'data-xuanshu-group="base"')).toContain('基础输入级 base · 默认勾选')
    expect(blockOf(html, 'data-xuanshu-group="optional"')).toContain('可选输入级 optional')
    const baseRow = blockOf(html, 'data-xuanshu-pu="rensheng-jingli"')
    expect(baseRow).toContain('人生经历')
    expect(baseRow).toContain('成长与转折的骨架')
    expect(tagOf(baseRow, 'type="checkbox"')).toContain('checked')
    const optionalRow = blockOf(html, 'data-xuanshu-pu="ruanjian-kaifa"')
    expect(tagOf(optionalRow, 'type="checkbox"')).not.toContain('checked')
  })

  it('勾选清单只列谱：两组可勾选块里不出现工作区 / 工作流（C6②）；去谱管理的路点名侧栏行而不是第二扇门', () => {
    const html = picker()
    // #69 / 判据 N-001：谱管理的门只有侧栏行「谱」一个 —— 这块里不许再挂一枚「管理谱 ▸ S5」。
    expect(html, '勾选清单里还挂着去谱管理的按钮').not.toMatch(/<button[^>]*>管理谱/u)
    expect(html).toContain('侧栏「谱」')
    for (const level of ['base', 'optional']) {
      const group = blockOf(html, `data-xuanshu-group="${level}"`)
      expect(group, `${level} 组里混进了挂载对象`).not.toContain('工作区')
      expect(group).not.toContain('工作流')
    }
  })

  it('一个可选谱都没有：给可执行的追加行（S6 §6 empty），不留空分组头', () => {
    const html = render(
      h(XsConsultPicker, { required: defaults().required, optional: [], selected: [], onToggle: () => {}, onManagePu: () => {} }),
    )
    expect(html).toContain('谱都非必填')
    expect(html).toContain('去 S5')
    expect(html).not.toContain('data-xuanshu-group="base"')
  })
})

/* ───────────────────────── 门厅：摘要 / 挂载位 / 提问区（S6 §2.1②③、§2.2） ───────────────────────── */

describe('票 10 · 门厅：摘要行、挂载展示位与提问区', () => {
  it('「本次上下文将含」摘要行随勾选与挂载重算（底座 + 底稿恒在）', () => {
    const html = render(
      h(XsConsultAsk, {
        question: '',
        selected: ['rensheng-jingli', 'ruanjian-kaifa'],
        mounts: [],
        busy: false,
        summary: contextSummary({ selected: ['rensheng-jingli', 'ruanjian-kaifa'], mounts: [] }),
        onQuestion: () => {},
        onStart: () => {},
      }),
    )
    expect(html).toContain('本次上下文将含：底座 + 底稿 + 2 个谱')
    expect(html).toContain('data-xuanshu-field="consult-question"')
    expect(html).toContain('data-xuanshu-action="start-consult"')
  })

  it('挂载是**展示位**：边界句常驻、按钮置灰并说明属票 12（不移除节点）', () => {
    const html = render(h(XsConsultMountPlaceholder, { mounts: [] }))
    expect(html).toContain('工作区 / 工作流不是谱')
    const button = tagOf(html, 'data-xuanshu-action="open-mounts"')
    expect(button).toContain('disabled')
    expect(html).toContain('属票 12')
    expect(html).toContain('data-xuanshu-note="mount-placeholder"')
  })

  it('无源拦截引导：只列走得通的去路 + 「只带底座 + 底稿问一次」的显式出口（S6 §5 步骤 5a）', () => {
    const renderAsk = (extra) => render(
      h(XsConsultAsk, {
        question: '帮我看这次转岗的时机',
        selected: [],
        mounts: [],
        busy: false,
        nudge: true,
        summary: contextSummary({ selected: [], mounts: [] }),
        onQuestion: () => {},
        onStart: () => {},
        onPlainAsk: () => {},
        onGotoHistory: () => {},
        onClearNudge: () => {},
        ...extra,
      }),
    )
    // 缺省（门厅还没会话 = 挂不了）：只给「勾一个谱」+「空手问一次」
    const html = renderAsk({})
    const nudge = blockOf(html, 'data-xuanshu-nudge="no-source"')
    expect(nudge).toContain('需要先给这一问一点依据')
    expect(nudge).toContain('在勾选区勾一个谱')
    expect(nudge).not.toContain('临时挂载一个工作区 / 工作流（去 S8）')
    expect(nudge).toContain('只带底座 + 底稿问一次')
    expect(html).toContain('data-xuanshu-action="plain-ask"')
    // 真有会话可挂时，挂载那条才出现
    expect(blockOf(renderAsk({ mountable: true }), 'data-xuanshu-nudge="no-source"'))
      .toContain('临时挂载一个工作区 / 工作流（去 S8）')
  })

  it('开会话失败：错误条 + [重试] + [改从历史里接着问]（S6 §6 error①）', () => {
    const html = render(
      h(XsConsultAsk, {
        question: 'x',
        selected: [],
        mounts: [],
        busy: false,
        error: '底座没起来（先跑 pnpm setup:xuanshu）',
        summary: contextSummary({ selected: [], mounts: [] }),
        onQuestion: () => {},
        onStart: () => {},
      }),
    )
    expect(blockOf(html, 'data-xuanshu-error="create"')).toContain('底座没起来（先跑 pnpm setup:xuanshu）')
    expect(html).toContain('data-xuanshu-action="retry-create"')
    expect(html).toContain('data-xuanshu-action="goto-history"')
  })

  it('最近一次会话摘要卡：短 id + 标题 + 元信息 + [继续这次问事 ▸]，且**不画消息流**', () => {
    const html = render(h(XsConsultRecentCard, { session: summaryOf(), onContinue: () => {} }))
    expect(html).toContain('#consult-9f8e7d6c')
    expect(html).toContain('转岗时机')
    expect(html).toContain('data-xuanshu-action="continue-consult"')
    expect(html).toContain('5 轮')
    // F1/D5：门厅不渲染消息流与工具轨迹
    expect(html).not.toContain('data-xuanshu-message=')
    // 2026-11-01：这两样都从卡里拿掉了 ——
    //   「历史回看 ▸」与面板 header 那个同名同动作（判据 N-001：一个动作一个入口）；
    //   「本面板是「书房门厅」」是**整个面板**的说明，主面板的 lobby 块已经有，挂在这张卡下会被读成在说这张卡。
    expect(html).not.toContain('历史回看')
    expect(html).not.toContain('本面板是「书房门厅」')
  })
})

/* ───────────────────────── 历史子页（S7 §2 / §3 / §6） ───────────────────────── */

describe('票 10 · 历史列表（S7 §2.1 / §2.3 / §6）', () => {
  const listProps = (over = {}) => ({
    items: [summaryOf()],
    loading: false,
    error: undefined,
    query: '',
    range: 'all',
    now: new Date('2026-10-15T09:00:00+08:00'),
    onQuery: () => {},
    onRange: () => {},
    onOpen: () => {},
    onBack: () => {},
    onStart: () => {},
    onCreatePu: () => {},
    onRetry: () => {},
    ...over,
  })

  it('列表：日期分组 + 行（短 id / 标题 / 元信息）+ 常驻数据形态与搜索边界说明', () => {
    const html = render(h(XsConsultHistoryList, listProps()))
    expect(html).toContain('data-xuanshu-view="history-list"')
    expect(html).toContain('今天 · 1 条')
    expect(html).toContain('data-xuanshu-row="session-xs-consult-9f8e7d6c-0000-4000-8000-000000000000"')
    expect(html).toContain('#consult-9f8e7d6c')
    expect(html).toContain('转岗时机')
    expect(html).toContain('5 轮')
    expect(html).toContain('会话记录 = 本地文件（JSONL 事件日志），玄枢只读不改')
    expect(html).toContain('搜索只搜本次问事的标题与首句，不搜全文')
    expect(html).toContain('data-xuanshu-action="back-lobby"')
  })

  it('工具栏：搜索框 + 范围三档；导出 / 删除是**置灰的展示位**（契约未冻结这两个 RPC）', () => {
    const html = render(h(XsConsultHistoryList, listProps()))
    expect(html).toContain('data-xuanshu-field="history-search"')
    expect(html).toContain('data-xuanshu-field="history-range"')
    for (const action of ['export-selected', 'delete-selected']) {
      const button = tagOf(html, `data-xuanshu-action="${action}"`)
      expect(button, `${action} 未接入时必须置灰而不是假按钮`).toContain('disabled')
    }
    expect(html).toContain('契约未冻结')
  })

  it('首次空态：为什么空 + 下一步主按钮 + 次按钮（S7 §2.3①），不写「暂无数据」', () => {
    const html = render(h(XsConsultHistoryList, listProps({ items: [] })))
    expect(blockOf(html, 'data-xuanshu-state="empty"')).toContain('还没有问事记录')
    expect(html).toContain('每次问事都会自动存成本地文件，随时能回来接着读。')
    expect(blockOf(html, 'data-xuanshu-state="empty"')).toContain('data-xuanshu-action="start-consult"')
    // 次按钮（S7:65「先建谱」）：动作是**建一个谱**，不是「去谱管理」（判据 N-001 的重复入口）。
    expect(html).toContain('data-xuanshu-action="create-pu"')
    expect(html).toContain('先建一个谱')
    expect(html).not.toContain('暂无数据')
  })

  it('筛选空态：`没有匹配「xxx」的记录` + [清空筛选] + [回到全部]（S7 §2.3②）', () => {
    // 「筛选空」与「从来没问过」是两回事：条目在、只是这一筛没命中 —— 用非空清单驱动。
    const html = render(h(XsConsultHistoryList, listProps({ items: [summaryOf()], query: '打印车间' })))
    const block = blockOf(html, 'data-xuanshu-state="no-match"')
    expect(block).toContain('没有匹配「打印车间」的记录')
    expect(html).toContain('data-xuanshu-action="clear-filter"')
    expect(html).toContain('data-xuanshu-action="reset-filter"')
  })

  it('清单读不到：面板级错误 + [重试] + 只读路径展示（S7 §6 error①）', () => {
    const html = render(h(XsConsultHistoryList, listProps({ items: [], error: '会话清单读不到' })))
    const block = blockOf(html, 'data-xuanshu-error="list"')
    expect(block).toContain('会话清单读不到')
    expect(html).toContain('data-xuanshu-action="retry-list"')
    expect(html).toContain('玄枢 home/sessions/')
  })
})

describe('票 10 · 历史阅读器（S7 §2.2 / §6 只读态）', () => {
  const readerProps = (over = {}) => ({
    session: summaryOf(),
    messages: [
      { role: 'user', text: '帮我看这次转岗的时机' },
      { role: 'assistant', text: '先读你的谱……' },
    ],
    onBack: () => {},
    onContinue: () => {},
    onRetry: () => {},
    ...over,
  })

  it('点开即读：只读徽标逐字、消息带角色标签、**零编辑控件**', () => {
    const html = render(h(XsConsultHistoryReader, readerProps()))
    expect(html).toContain('data-xuanshu-view="reader"')
    expect(html).toContain('【只读 · 不可编辑】')
    expect(html).toContain('data-xuanshu-action="back-list"')
    expect(blockOf(html, 'data-xuanshu-message="user"')).toContain('你')
    expect(html).toContain('帮我看这次转岗的时机')
    expect(blockOf(html, 'data-xuanshu-message="assistant"')).toContain('AI')
    expect(html).toContain('先读你的谱……')
    // S7 §6 只读态：阅读器里没有任何输入控件
    const reader = blockOf(html, 'data-xuanshu-view="reader"')
    expect(reader).not.toMatch(/<input|<textarea|<select/)
    expect(reader).not.toContain('contenteditable')
  })

  it('注入消息带来源标记（自定义 MessageSourceMap kind 原样显示），不改正文', () => {
    const html = render(
      h(
        XsConsultHistoryReader,
        readerProps({
          messages: [
            { role: 'user', text: '【来源：底座谱】…', source: 'xuanshu-consult' },
            { role: 'assistant', text: '好' },
          ],
        }),
      ),
    )
    expect(html).toContain('data-xuanshu-source="xuanshu-consult"')
  })

  it('票 31：合参采用稿按轮分组，标出每轮当前采用稿；被否决的轮不显示为当前', () => {
    const html = render(
      h(
        XsConsultHistoryReader,
        readerProps({
          messages: [
            { role: 'user', text: '帮我看这次转岗的时机' },
            { role: 'user', text: '方案 A：先按 3000/月 试算。', source: 'xuanshu-bestof-adopted', messageId: 'm-r1' },
            { role: 'assistant', text: '好，按 A 记下。' },
            { role: 'user', text: '方案 B：先核对前提。', source: 'xuanshu-bestof-adopted', messageId: 'm-r2' },
          ],
          drafts: {
            rounds: [
              { runId: 'bestof-r1', round: 1, messageIds: ['m-r1'], currentId: 'm-r1', rejected: false },
              { runId: 'bestof-r2', round: 2, messageIds: ['m-r2'], currentId: undefined, rejected: true },
            ],
            resolved: true,
            currentIds: ['m-r1'],
          },
        }),
      ),
    )
    const round1 = blockOf(html, 'data-xuanshu-round="1"')
    expect(round1).toContain('第 1 轮合参 · 当前采用稿')
    expect(round1).toContain('data-xuanshu-draft="current"')
    expect(round1).toContain('方案 A：先按 3000/月 试算。')

    const round2 = blockOf(html, 'data-xuanshu-round="2"')
    expect(round2).toContain('第 2 轮合参 · 已否决（不列为当前）')
    expect(round2).toContain('data-xuanshu-draft="rejected"')
    expect(round2).toContain('方案 B：先核对前提。')
    // 被否决的轮不许在任何地方被说成「当前采用稿」
    expect(round2).not.toContain('当前采用稿')

    // 分组只包采用稿：普通消息照旧单独成条
    expect(html).toContain('好，按 A 记下。')
    expect(html.match(/data-xuanshu-round="/gu)).toHaveLength(2)
  })

  it('阅读器不显示工作区归属（C6），只给 [继续这次问事 ▸] 跨面板入口', () => {
    const html = render(h(XsConsultHistoryReader, readerProps()))
    expect(html).toContain('data-xuanshu-action="continue-consult"')
    expect(blockOf(html, 'data-xuanshu-view="reader"')).not.toContain('工作区')
  })

  it('读取失败：原文理由 + [重试] + [返回列表]，其余行不受影响（S7 §6 error②）', () => {
    const html = render(h(XsConsultHistoryReader, readerProps({ messages: [], error: '这条会话读不出来（文件损坏或格式不符）' })))
    const block = blockOf(html, 'data-xuanshu-error="read"')
    expect(block).toContain('这条会话读不出来（文件损坏或格式不符）')
    expect(html).toContain('data-xuanshu-action="retry-read"')
    expect(html).toContain('data-xuanshu-action="back-list"')
  })
})

/* ───────────────────────── 门厅面板（静态度：给 preloaded 就不取数） ───────────────────────── */

describe('票 10 · 门厅面板（静态预置渲染）', () => {
  /** 静态度渲染下这些回调不会被调用；给最小形状即可（取数被 `preloaded` 短路）。 */
  const api = {
    create: async () => ({ session: summaryOf() }),
    send: async () => ({ accepted: true }),
    list: async () => ({ items: [] }),
    read: async () => ({ session: summaryOf(), messages: [] }),
    rename: async () => ({ session: summaryOf() }),
    defaults: async () => defaults(),
  }
  const panel = (preloaded) =>
    render(h(ConsultPanel, { api, navigate: () => {}, openSession: () => {}, preloaded }))

  it('落地态：边界句（与工作区并列）+ 勾选区（锁定行在位）+ 提问区，且**不画消息流**', () => {
    const html = panel({ defaults: defaults(), items: [] })
    expect(html).toContain('data-xuanshu-panel="consult"')
    expect(html).toContain('一次问事 = 勾选谱 → 说事 →（可选）多 AI 合参 → 结束沉淀')
    expect(html).toContain('与工作区并列、不属于任何工作区')
    expect(html).toContain('书房门厅')
    expect(html).toContain('底座（八字）')
    expect(html).toContain('默认在场 · 不可关')
    expect(html).toContain('data-xuanshu-field="consult-question"')
    expect(html).toContain('data-xuanshu-field="pu-rensheng-jingli"')
    // 门厅不是会话本体：没有任何消息节点
    expect(html).not.toContain('data-xuanshu-message=')
    // 没有会话时不出现摘要卡
    expect(html).not.toContain('data-xuanshu-block="recent"')
  })

  it('有最近一次会话：出摘要卡 + [继续这次问事 ▸]（门厅只给切换入口）', () => {
    const html = panel({ defaults: defaults(), items: [summaryOf()] })
    expect(html).toContain('data-xuanshu-block="recent"')
    expect(html).toContain('#consult-9f8e7d6c')
    expect(html).toContain('data-xuanshu-action="continue-consult"')
  })

  it('历史子页：静态落到列表（分组 / 行 / 只读说明都在）', () => {
    const html = panel({ defaults: defaults(), items: [summaryOf()], view: 'history' })
    expect(html).toContain('data-xuanshu-view="history-list"')
    expect(html).toContain('data-xuanshu-row="session-xs-consult-9f8e7d6c-0000-4000-8000-000000000000"')
    expect(html).toContain('玄枢只读不改')
  })
})
