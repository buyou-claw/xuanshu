/**
 * 票 11 · 合参界面的组件级断言（S9 §2.2–§2.7；C9 / H3 / H4）。
 *
 * 这一层断言**界面上能看见的事实**——票面验收里最容易被「结构对但口径丢了」糊过去的部分：
 *   - C9：判官区标题固定「只排序，不替你做决定」；**没有**「建议采用 / 推荐」这类字眼；
 *     生成中只有「停止全部」；三动作都在结束后才出现，且全部等人点；
 *   - H4：判官区常驻「判官只看候选与问题，不读你的谱与挂载内容」；
 *   - H3：采用摘要常驻「合参没有改动本次会话的挂载账本与字数状态」；
 *   - 回落态（§2.3）：写清「暂按先完成的一份排前」+「采用与否仍然由你点」，Tag 改口径；
 *   - 禁用态（§6）：说清「当前是关的」，不静默改走普通问答；
 *   - 空内容 `return null`（`shell.overlay` 的 click-through）。
 *
 * 环境：`renderToStaticMarkup`（Node 里没有 jsdom），因此只驱动**受控组件**；
 * 点击链条由 `bestof-model.test.mjs` 的状态机用例承担。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  XsBestofActions,
  XsBestofCandidateCard,
  XsBestofCostConfirm,
  XsBestofDisabled,
  XsBestofJudgePanel,
  XsBestofOverlay,
  XsBestofSettingsRow,
} from '../../packages/xuanshu-client/src/client/bestof-views.tsx'

const SESSION = 'session-xs-consult-9f8e7d6c-0000-4000-8000-000000000000'
const noop = () => {}

const actions = {
  onEditQuestion: noop,
  onStart: noop,
  onCancel: noop,
  onStop: noop,
  onAdopt: noop,
  onMerge: noop,
  onReject: noop,
  onRetry: noop,
}

const candidate = (over = {}) => ({
  id: 'c1',
  angle: 'classic',
  angleName: '经典派',
  provider: 'deepseek',
  model: 'deepseek-chat',
  status: 'done',
  text: '第一份正文。',
  elapsedMs: 1200,
  ...over,
})

const view = (over = {}) => ({
  runId: 'bestof-1',
  sessionId: SESSION,
  question: '这次转岗该不该去',
  candidates: [candidate(), candidate({ id: 'c2', angle: 'cautious', angleName: '审慎派', text: '第二份正文。' })],
  judge: { mode: 'tool', adoptedId: 'c1', ranking: ['c1', 'c2'], reasons: { c1: '依据充分、自洽', c2: '覆盖够但结论偏保守' } },
  adoptedId: null,
  rejected: false,
  finished: true,
  ...over,
})

const state = (over = {}) => ({ phase: 'ready', enabled: true, question: '这次转岗该不该去', sessionId: SESSION, view: view(), ...over })

const render = (element) => renderToStaticMarkup(element)

describe('票 11 · C9：判官只排序，采用由人点', () => {
  it('判官区标题固定写「只排序，不替你做决定」，且没有「建议采用 / 推荐」这类字眼', () => {
    const html = render(h(XsBestofJudgePanel, { view: view() }))
    expect(html).toContain('只排序，不替你做决定')
    expect(html).toContain('判官不会自动采用')
    expect(html).toContain('判官只看候选与问题，不读你的谱与挂载内容') // H4 披露
    expect(html).not.toMatch(/建议采用|推荐/u)
  })

  it('生成中：底部只有「停止全部」，不出现采用 / 合并 / 否决', () => {
    const html = render(h(XsBestofActions, { view: view({ finished: false }), running: true, actions }))
    expect(html).toContain('停止全部')
    expect(html).not.toContain('采用')
    expect(html).not.toContain('合并')
    expect(html).not.toContain('否决')
  })

  it('结束后：三动作都在，且「合并」在不足两份时禁用', () => {
    const html = render(h(XsBestofActions, { view: view(), running: false, actions }))
    expect(html).toContain('采用 c1')
    expect(html).toContain('采用 c2')
    expect(html).toContain('合并为一稿')
    expect(html).toContain('否决本轮')
    expect(html).not.toContain('disabled')

    const single = view({ candidates: [candidate()], judge: { mode: 'skipped', adoptedId: 'c1', ranking: ['c1'], skipped: true } })
    const singleHtml = render(h(XsBestofActions, { view: single, running: false, actions }))
    expect(singleHtml).toContain('disabled')
    expect(singleHtml).toContain('可合并的候选不足两份')
  })

  it('生成中的候选卡**没有**采用按钮；卡上的采用入口统一在底部动作行', () => {
    const running = render(h(XsBestofCandidateCard, { candidate: candidate({ status: 'running', text: '' }) }))
    expect(running).not.toContain('采用')

    const done = render(h(XsBestofCandidateCard, { candidate: candidate(), rank: '排序 1' }))
    expect(done).toContain('排序 1')
    expect(done).toContain('经典派')
    expect(done).toContain('deepseek-chat')
    expect(done).toContain('1.2s')
  })
})

describe('票 11 · 回落 / 否决 / 采用三态的可解释文案', () => {
  it('回落态：写清「暂按先完成的一份排前」+「采用与否仍然由你点」，Tag 改「完成顺序」', () => {
    const fallback = view({ judge: { mode: 'tool', adoptedId: 'c2', ranking: ['c2', 'c1'], error: '模型既没有调用 submit_judgement…' } })
    const html = render(h(XsBestofOverlay, { state: state({ phase: 'ready', view: fallback }), actions }))
    expect(html).toContain('判官不可用，暂按先完成的一份排前')
    expect(html).toContain('采用与否仍然由你点')
    expect(html).toContain('完成顺序第 1')
    expect(html).not.toContain('排序 1')
  })

  it('否决态：写清不采用任何一份、不进历史，数据仍在；给「重来一轮」', () => {
    const rejected = view({ rejected: true, adoptedId: null })
    const html = render(h(XsBestofOverlay, { state: state({ phase: 'rejected', view: rejected }), actions }))
    expect(html).toContain('本轮合参作废')
    expect(html).toContain('没有任何一份被采用')
    expect(html).toContain('不会进入后续对话与历史回看')
    expect(html).toContain('候选正文仍保存在本地合参记录里')
    expect(html).toContain('重来一轮（沿用同一个问题）')
  })

  it('采用态：摘要写「已采用 c1」+ 历史只带采用稿 + H3 旁路披露', () => {
    const html = render(h(XsBestofOverlay, { state: state({ phase: 'adopted', view: view({ adoptedId: 'c1' }) }), actions }))
    expect(html).toContain('已采用 c1')
    expect(html).toContain('历史只带这一份采用稿')
    expect(html).toContain('合参没有改动本次会话的挂载账本与字数状态')
    expect(html).not.toMatch(/建议采用|推荐/u)
  })

  it('合并态：摘要写「已合并为一稿并采用」（不写「最佳」）', () => {
    const merged = view({
      adoptedId: 'merged',
      candidates: [...view().candidates, candidate({ id: 'merged', angle: 'merged', angleName: '合并稿', text: '合并稿正文。' })],
      mergedBy: { by: 'host', at: '2026-10-15T00:00:00.000Z' },
    })
    const html = render(h(XsBestofOverlay, { state: state({ phase: 'adopted', view: merged }), actions }))
    expect(html).toContain('已合并为一稿并采用')
    expect(html).not.toContain('最佳')
  })
})

/**
 * task-15 · 投递回执进界面。
 *
 * 硬线：**失败必须说失败**。界面说「历史只带这一份采用稿」而实际没写进去，就是说了一句没发生的事。
 * 所以这里的第一条断言是**逐字冻结成功态**（task-15 之前渲染出来的那一份，原样贴在下面），
 * 后面几条才验失败态。
 */
const ADOPTED_BLOCK_BEFORE_TASK15 =
  '<div class="xs-bestof__warn" data-xs-bestof="adopted">' +
  '<h4>已采用 c1</h4>' +
  '<p class="xs-bestof__note">采用只影响这次对话与回看；写进谱要在结束沉淀时由你确认。历史只带这一份采用稿。 其余候选已折叠保存在本地合参记录里，需要时展开查看。</p>' +
  '<p class="xs-bestof__note">合参没有改动本次会话的挂载账本与字数状态（旁路，不写页面态）。</p>' +
  '</div>'

/** 从整块界面里切出「采用态摘要」那一块（比对逐字冻结的成功态文案）。 */
function adoptedBlock(html) {
  const start = html.indexOf('<div class="xs-bestof__warn" data-xs-bestof="adopted">')
  expect(start, '采用态摘要块没渲染出来').toBeGreaterThanOrEqual(0)
  const end = html.indexOf('</div>', start) + '</div>'.length
  return html.slice(start, end)
}

describe('task-15 · 采用稿投递失败必须说出来（不许说没发生的事）', () => {
  const adoptedState = (over = {}) => {
    const base = view({ adoptedId: 'c1' })
    return state({ phase: 'adopted', ...over, view: { ...base, ...(over.view ?? {}) } })
  }

  it('成功（delivery.ok=true）：渲染与加这个分支之前**逐字相同**', () => {
    const html = render(
      h(XsBestofOverlay, {
        state: adoptedState({ delivery: { ok: true, candidateId: 'c1', messageId: 'm-1', source: 'xuanshu-bestof-adopted', at: '2026-10-15T00:00:00.000Z' } }),
        actions,
      }),
    )
    expect(adoptedBlock(html)).toBe(ADOPTED_BLOCK_BEFORE_TASK15)
  })

  it('老宿主（delivery 字段整个缺席）：按成功态渲染，不崩、也不出现警告', () => {
    const html = render(h(XsBestofOverlay, { state: adoptedState(), actions }))
    expect(adoptedBlock(html)).toBe(ADOPTED_BLOCK_BEFORE_TASK15)
    expect(html).not.toContain('没能写进会话')
  })

  it('失败：逐字给出原因，且**不再**出现「历史只带这一份采用稿」', () => {
    const delivery = { ok: false, candidateId: 'c1', error: 'DSH agent 服务（ctx.agents）不可得：这一份采用稿写不进会话。', attemptedAt: '2026-10-15T00:00:00.000Z' }
    const html = render(h(XsBestofOverlay, { state: adoptedState({ delivery }), actions }))

    // 警告在，且是 role=alert（读屏也要说）。
    expect(html).toContain('data-xs-bestof="delivery-failed"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('⚠ 采用稿没能写进会话：DSH agent 服务（ctx.agents）不可得：这一份采用稿写不进会话。')
    // 自相矛盾的那一句必须消失。
    expect(html).not.toContain('历史只带这一份采用稿')
    // 其余照旧（采用这个动作本身仍然生效、旁路披露仍成立）。
    expect(html).toContain('已采用 c1')
    expect(html).toContain('合参没有改动本次会话的挂载账本与字数状态')
  })

  it('失败原因缺失时也不给空话：「原因未知」兜底', () => {
    const html = render(h(XsBestofOverlay, { state: adoptedState({ delivery: { ok: false } }), actions }))
    expect(html).toContain('⚠ 采用稿没能写进会话：原因未知')
  })

  it('冷读（state 的视图里带 delivery）与点击回执（state.delivery）说同一句话', () => {
    const delivery = { ok: false, error: '接不回这个会话（模拟：日志被删/宿主换了）' }
    const fromPoll = render(h(XsBestofOverlay, { state: adoptedState({ view: { adoptedId: 'c1', delivery } }), actions }))
    const fromClick = render(h(XsBestofOverlay, { state: adoptedState({ delivery }), actions }))
    expect(fromPoll).toContain('⚠ 采用稿没能写进会话：接不回这个会话（模拟：日志被删/宿主换了）')
    expect(adoptedBlock(fromPoll)).toBe(adoptedBlock(fromClick))
  })

  it('合并态同样受这条约束（失败时也不说「历史只带这一份采用稿」）', () => {
    const merged = view({
      adoptedId: 'merged',
      candidates: [...view().candidates, candidate({ id: 'merged', angle: 'merged', angleName: '合并稿', text: '合并稿正文。' })],
    })
    const html = render(h(XsBestofOverlay, { state: state({ phase: 'adopted', view: merged, delivery: { ok: false, error: '写不进去' } }), actions }))
    expect(html).toContain('已合并为一稿并采用')
    expect(html).toContain('⚠ 采用稿没能写进会话：写不进去')
    expect(html).not.toContain('历史只带这一份采用稿')
  })
})

describe('票 11 · 费用与开关的口径', () => {
  it('没有 costUsd → 「费用未知」；有 → 四位小数', () => {
    const unknown = render(h(XsBestofJudgePanel, { view: view() }))
    expect(unknown).toContain('费用未知')
    const known = render(h(XsBestofJudgePanel, { view: view({ costUsd: 0.0043, costUsdComplete: true }) }))
    expect(known).toContain('$0.0043')
  })

  it('费用确认框：写明候选几路、候选不带工具、可编辑问题', () => {
    const html = render(h(XsBestofCostConfirm, { state: state({ phase: 'confirm', view: undefined }), actions }))
    expect(html).toContain('预估费用确认')
    expect(html).toContain('候选 2 路')
    expect(html).toContain('候选只回答、不执行任何动作')
    expect(html).toContain('开始合参')
    expect(html).toContain('取消')
    expect(html).toContain('<textarea')
  })

  it('禁用态：说清当前是关的 + 两条出路，不静默改走普通问答', () => {
    const html = render(h(XsBestofDisabled, { state: state({ phase: 'disabled', view: undefined, enabled: false }), actions }))
    expect(html).toContain('多 AI 合参当前是关的')
    expect(html).toContain('去 设置')
    expect(html).toContain('照常问（带工具）')
    expect(html).not.toContain('开始合参')
  })

  it('设置行：默认关闭（checkbox 未勾选），文案说清命令与别名', () => {
    const off = render(h(XsBestofSettingsRow, { state: state({ enabled: false }), actions: { onToggle: noop } }))
    expect(off).toContain('多 AI 合参')
    expect(off).toContain('/多模型')
    expect(off).toContain('bestof')
    expect(off).not.toContain('checked')

    const on = render(h(XsBestofSettingsRow, { state: state({ enabled: true }), actions: { onToggle: noop } }))
    expect(on).toContain('checked')
  })

  it('空内容 return null（shell.overlay 的 click-through）', () => {
    expect(render(h(XsBestofOverlay, { state: state({ phase: 'idle', view: undefined }), actions }))).toBe('')
  })

  it('整块界面里没有「建议采用 / 推荐」这类替人拍板的字眼；「自动采用」只以否定形式出现', () => {
    const html = render(h(XsBestofOverlay, { state: state(), actions }))
    expect(html).not.toMatch(/建议采用|推荐/u)
    // 设计稿允许的原话是「判官不会自动采用」——所以 `自动采用` 的出现次数必须全被 `不会` 否定掉。
    const occurrences = html.split('自动采用').length - 1
    const negated = html.split('不会自动采用').length - 1
    expect(occurrences).toBe(negated)
    expect(occurrences).toBeGreaterThan(0)
  })
})
