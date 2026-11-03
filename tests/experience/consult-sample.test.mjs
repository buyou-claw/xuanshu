/**
 * tests/experience/consult-sample.test.mjs —— 票 #78 首条样板路径（E03/E06）的**结构判据台**。
 *
 * 浏览器侧已经在 `ux-reports/experience-round-01/task-before/` 留下了真跑证据；本文件只钉两件事：
 *   1. **场景表形状**：两条场景的 id / caseId / 标题 / 截图清单 / run 函数都在，且源码里没有
 *      `force: true`、没有内部 RPC / fetch（ADR-0017 第 3 条）；
 *   2. **终点归类**（纯函数）：每一种观测组合落到 pass / fail / blocked 的哪一格——
 *      「环境缺前置记 blocked」「产品缺陷记 fail」「没看到产物不许记 pass」在这里逐条钉死。
 *
 * 范式照 `tests/experience/run-cli.test.mjs`：零浏览器、只测外部可观察的返回值。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { COVERAGE_STATUSES } from '../../scripts/experience/evidence.mjs'
import { SCENARIOS } from '../../scripts/experience/scenarios/index.mjs'
import {
  FIXTURE,
  decideHistoryOutcome,
  decideNormalOutcome,
} from '../../scripts/experience/scenarios/consult-sample.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const SOURCE = join(REPO_ROOT, 'scripts', 'experience', 'scenarios', 'consult-sample.mjs')

/** 覆盖状态必须是判据词表 + blocked 里的一个。 */
function expectStatus(decision) {
  expect(COVERAGE_STATUSES).toContain(decision.status)
  if (decision.status === 'pass' || decision.status === 'fail') {
    expect(typeof decision.evidence).toBe('string')
    expect(decision.evidence.trim()).not.toBe('')
  } else {
    expect(typeof decision.reason).toBe('string')
    expect(decision.reason.trim()).not.toBe('')
  }
}

/** E03 的「一路走通」基线观测：各用例只改其中一格。 */
function normalObservations(overrides = {}) {
  return {
    panel: { opened: true, attempts: 1 },
    model: { ok: true, alreadyConfigured: false, saved: true },
    pu: { ok: true, created: true, reused: false },
    selection: { found: true, checked: true, carried: true, summary: '本次上下文将含：底座 + 底稿 + 1 个谱', selection: '已勾 1 个可选谱 · 已挂 0 项' },
    question: { filled: true, carried: true },
    submit: {
      clicked: true,
      requestStarted: true,
      feedback: { kind: 'busy', text: '开问事中…' },
      terminal: { kind: 'session', text: '', inViewport: null },
    },
    product: { visible: true, source: 'conversation', excerpt: '木工练习安排' },
    workspace: { reachable: false },
    ...overrides,
  }
}

/** E06 的「一路走通」基线观测。 */
function historyObservations(overrides = {}) {
  return {
    panel: { opened: true, attempts: 1 },
    history: { opened: true, rowCount: 1, searchMatched: true },
    record: {
      rowShortId: '#consult-abc123',
      readerShortId: '#consult-abc123',
      sameShortId: true,
      questionPresent: true,
      answerPresent: true,
      selectionPresent: true,
      answerExcerpt: '木工练习安排',
    },
    continueEntry: { clicked: true, sameSession: true, errorText: '' },
    landing: { afterReturn: 'lobby', reasonable: true },
    stillThere: true,
    ...overrides,
  }
}

describe('票 #78 · 场景表形状：E03 / E06 都是可执行的场景', () => {
  it('consult-normal 就是 E03，带标题、截图清单与 run 函数', () => {
    const scenario = SCENARIOS['consult-normal']
    expect(scenario).toBeDefined()
    expect(scenario.caseId).toBe('E03')
    expect(scenario.title).toContain('问事')
    expect(scenario.shots).toContain('08-terminal.png')
    expect(scenario.shots).toContain('10-history-reader.png')
    expect(typeof scenario.run).toBe('function')
  })

  it('consult-history 就是 E06，带标题、截图清单与 run 函数', () => {
    const scenario = SCENARIOS['consult-history']
    expect(scenario).toBeDefined()
    expect(scenario.caseId).toBe('E06')
    expect(scenario.title).toContain('历史')
    expect(scenario.shots).toContain('10-history-reader.png')
    expect(scenario.shots).toContain('14-history-again.png')
    expect(typeof scenario.run).toBe('function')
  })

  it('虚构材料与计划 §9.2 第 3 条逐字一致', () => {
    expect(FIXTURE.identity).toBe('体验用户-01')
    expect(FIXTURE.birth).toBe('1990-06-15 12:00 上海')
    expect(FIXTURE.puName).toBe('体验-木工')
    expect(FIXTURE.material).toBe('我周末学习木工，希望安排练习时间')
    expect(FIXTURE.question).toBe('这周我只有两小时，怎样安排木工练习？')
  })

  it('场景源码没有 force: true、没有内部 RPC / fetch（ADR-0017 第 3 条）', () => {
    const source = readFileSync(SOURCE, 'utf8')
    expect(source).not.toMatch(/force\s*:\s*true/u)
    expect(source).not.toMatch(/\/api\/xuanshu/u)
    expect(source).not.toMatch(/\bfetch\s*\(/u)
    // 密钥只从环境变量取，且不打印：源码里不许出现把值写进日志/步骤的拼接。
    expect(source).toContain('process.env.DeepSeekApi')
    expect(source).not.toMatch(/console\.(?:log|error)\([^)]*DeepSeekApi/u)
  })
})

describe('票 #78 · E03 判定：前置、带入、终态各有归处', () => {
  it('问事面板没打开 → blocked + 理由（环境缺前置不记成产品缺陷）', () => {
    const decision = decideNormalOutcome(normalObservations({ panel: { opened: false, attempts: 3 } }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('问事面板没打开')
    expectStatus(decision)
  })

  it('模型没配好 → blocked（不是 E03 的产品结论）', () => {
    const decision = decideNormalOutcome(normalObservations({ model: { ok: false, reason: '环境变量 DeepSeekApi 未设置' } }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('DeepSeekApi')
    expectStatus(decision)
  })

  it('建谱 AI 转换失败 → blocked（服务问题）', () => {
    const decision = decideNormalOutcome(normalObservations({ pu: { ok: false, reason: '建谱 AI 转换失败：模型不可用' } }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('建谱')
    expectStatus(decision)
  })

  it('建谱界面缺控件 → fail（产品问题）', () => {
    const decision = decideNormalOutcome(normalObservations({ pu: { ok: false, reason: '谱面板里找不到「＋ 创建新谱」' } }))
    expect(decision.status).toBe('fail')
    expect(decision.evidence).toContain('01-model-settings.png')
    expectStatus(decision)
  })

  it('测试谱没出现在勾选区 / 勾不上 → fail', () => {
    const decision = decideNormalOutcome(normalObservations({ selection: { found: false, checked: false } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('测试谱')
    expectStatus(decision)
  })

  it('勾选没被带入上下文摘要 → fail（E03 的核心之一）', () => {
    const decision = decideNormalOutcome(normalObservations({ selection: { found: true, checked: true, carried: false } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('勾选')
    expectStatus(decision)
  })

  it('问题填不进去 → fail', () => {
    const decision = decideNormalOutcome(normalObservations({ question: { filled: false, carried: false } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('问题')
    expectStatus(decision)
  })

  it('提交按钮不可点 → blocked（先记环境）', () => {
    const decision = decideNormalOutcome(normalObservations({ submit: { clicked: false, requestStarted: false, feedback: { kind: 'disabled' }, terminal: { kind: 'disabled' } } }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('不可点')
    expectStatus(decision)
  })

  it('120s 没有终态 → fail，摘要就是「超时未完成」', () => {
    const decision = decideNormalOutcome(normalObservations({ submit: { clicked: true, requestStarted: true, feedback: { kind: 'busy' }, terminal: { kind: 'timeout', text: '' } }, product: { visible: false } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('超时未完成')
    expect(decision.evidence).toContain('08-terminal.png')
    expectStatus(decision)
  })

  it('终态是可读错误、AI 产物在历史回看里可见 → 仍记 fail（错误本身是产品缺陷），但摘要如实写产物可见', () => {
    const decision = decideNormalOutcome(normalObservations({
      submit: { clicked: true, requestStarted: true, feedback: { kind: 'busy' }, terminal: { kind: 'error', text: '会话已建好（#consult-<id>），但 DSH 会话面板不可用：请在侧栏工作区里打开它。', inViewport: false } },
      product: { visible: true, source: 'history-reader', excerpt: '木工练习安排' },
    }))
    expect(decision.status).toBe('fail')
    expect(decision.evidence).toContain('10-history-reader.png')
    expect(decision.summary).toContain('DSH 会话面板不可用')
    expect(decision.summary).toContain('历史回看')
    expectStatus(decision)
  })

  it('终态切进会话且有真实 AI 产物 → pass', () => {
    const decision = decideNormalOutcome(normalObservations())
    expect(decision.status).toBe('pass')
    expect(decision.evidence).toContain('08-terminal.png')
    expectStatus(decision)
  })

  it('切进会话但没读到 AI 产物 → fail（不许拿「切过去了」冒充产物）', () => {
    const decision = decideNormalOutcome(normalObservations({ product: { visible: false, source: 'none' } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('没有真实 AI 产物')
    expectStatus(decision)
  })
})

describe('票 #78 · E06 判定：同一条、输入与产物、追问入口、返回落点', () => {
  it('问事面板没打开 → blocked', () => {
    const decision = decideHistoryOutcome(historyObservations({ panel: { opened: false } }))
    expect(decision.status).toBe('blocked')
    expectStatus(decision)
  })

  it('没有可找回的记录 → blocked（先跑 E03，不记成产品缺陷）', () => {
    const decision = decideHistoryOutcome(historyObservations({ history: { opened: true, rowCount: 0 } }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('先跑 consult-normal')
    expectStatus(decision)
  })

  it('点开的不是列表里那条记录 → fail', () => {
    const decision = decideHistoryOutcome(historyObservations({ record: { ...historyObservations().record, sameShortId: false, readerShortId: '#consult-other' } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('不是列表里那条')
    expectStatus(decision)
  })

  it('原始输入不在记录里 → fail', () => {
    const decision = decideHistoryOutcome(historyObservations({ record: { ...historyObservations().record, questionPresent: false } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('原始输入')
    expectStatus(decision)
  })

  it('AI 产物不在记录里 → fail', () => {
    const decision = decideHistoryOutcome(historyObservations({ record: { ...historyObservations().record, answerPresent: false } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('原始产物')
    expectStatus(decision)
  })

  it('追问入口没进入同一会话 → fail，证据里带产品给的可读原因', () => {
    const decision = decideHistoryOutcome(historyObservations({
      continueEntry: { clicked: true, sameSession: false, errorText: '会话已建好（#consult-<id>），但 DSH 会话面板不可用：请在侧栏工作区里打开它。' },
    }))
    expect(decision.status).toBe('fail')
    expect(decision.evidence).toContain('12-continue.png')
    expect(decision.evidence).toContain('DSH 会话面板不可用')
    expect(decision.summary).toContain('追问入口失败')
    expectStatus(decision)
  })

  it('返回落点被丢回总览首页 → fail', () => {
    const decision = decideHistoryOutcome(historyObservations({ landing: { afterReturn: 'overview-or-absent', reasonable: false } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('返回落点不合理')
    expectStatus(decision)
  })

  it('离开再回来后同一条记录不见了 → fail', () => {
    const decision = decideHistoryOutcome(historyObservations({ stillThere: false }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('记录不见了')
    expectStatus(decision)
  })

  it('同一条、输入与产物、追问、返回都成立 → pass', () => {
    const decision = decideHistoryOutcome(historyObservations())
    expect(decision.status).toBe('pass')
    expect(decision.evidence).toContain('14-history-again.png')
    expectStatus(decision)
  })
})
