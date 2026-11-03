/**
 * tests/experience/consult-exceptions.test.mjs —— 票 #79 异常与中断（E02/E04/E05/E08）的**结构判据台**。
 *
 * 真浏览器端到端只留 1 条（`run-e2e.test.mjs`）；本文件零浏览器、只测外部可观察的返回值：
 *   1. **场景表形状**：四条场景的 id / caseId / 标题 / 截图清单 / run 函数都在，源码里没有
 *      `force: true`、没有内部 RPC / fetch（ADR-0017 第 3 条）；
 *   2. **终点归类**（纯函数）：每种观测组合落到 pass / fail / blocked / not-collected 的哪一格——
 *      「空提交新建了会话记 fail」「连点多开会话记 fail」「丢草稿记 fail 并引用 §13.1」
 *      「没抓到生成窗口记 not-collected」「会话面板不可达记 blocked」在这里逐条钉死；
 *   3. **只读数据面**：旁挂清单文件数 / 回合数的读取与前后对比（临时目录，零浏览器）。
 *
 * 范式照 `tests/experience/consult-sample.test.mjs`：只测返回值与源码约束，不在测试里起浏览器。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { COVERAGE_STATUSES } from '../../scripts/experience/evidence.mjs'
import { SCENARIOS } from '../../scripts/experience/scenarios/index.mjs'
import {
  consultSessionsDir,
  decideEmptySubmitOutcome,
  decideRepeatOutcome,
  decideReturnOutcome,
  decideStopOutcome,
  diffConsultSessions,
  listConsultSessionFiles,
  readConsultSessionFile,
} from '../../scripts/experience/scenarios/consult-exceptions.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const SOURCE = join(REPO_ROOT, 'scripts', 'experience', 'scenarios', 'consult-exceptions.mjs')

/** 覆盖状态必须是判据词表 + blocked 里的一个；pass / fail 带 evidence，其余带 reason。 */
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

// ── 场景表形状 ──────────────────────────────────────────────────────────────

describe('票 #79 · 场景表形状：四条异常场景都可执行', () => {
  it('consult-empty 就是 E02，带标题、截图清单与 run 函数', () => {
    const scenario = SCENARIOS['consult-empty']
    expect(scenario).toBeDefined()
    expect(scenario.caseId).toBe('E02')
    expect(scenario.title).toContain('空问题')
    expect(scenario.shots).toContain('02-empty-submit.png')
    expect(scenario.shots).toContain('03-history-after.png')
    expect(typeof scenario.run).toBe('function')
  })

  it('consult-repeat 就是 E04，带标题、截图清单与 run 函数', () => {
    const scenario = SCENARIOS['consult-repeat']
    expect(scenario).toBeDefined()
    expect(scenario.caseId).toBe('E04')
    expect(scenario.title).toContain('连点')
    expect(scenario.shots).toContain('02-double-click-busy.png')
    expect(scenario.shots).toContain('03-history-after.png')
    expect(typeof scenario.run).toBe('function')
  })

  it('consult-return 就是 E05，带标题、截图清单与 run 函数', () => {
    const scenario = SCENARIOS['consult-return']
    expect(scenario).toBeDefined()
    expect(scenario.caseId).toBe('E05')
    expect(scenario.title).toContain('切走再回来')
    expect(scenario.shots).toContain('04-reader-before-leave.png')
    expect(scenario.shots).toContain('06-cross-session.png')
    expect(typeof scenario.run).toBe('function')
  })

  it('consult-stop 就是 E08，带标题、截图清单与 run 函数', () => {
    const scenario = SCENARIOS['consult-stop']
    expect(scenario).toBeDefined()
    expect(scenario.caseId).toBe('E08')
    expect(scenario.title).toContain('停止')
    expect(scenario.shots).toContain('04-stop-entry.png')
    expect(scenario.shots).toContain('05-after-stop.png')
    expect(typeof scenario.run).toBe('function')
  })

  it('场景源码没有 force: true、没有内部 RPC / fetch（ADR-0017 第 3 条）', () => {
    const source = readFileSync(SOURCE, 'utf8')
    expect(source).not.toMatch(/force\s*:\s*true/u)
    expect(source).not.toMatch(/\/api\/xuanshu/u)
    expect(source).not.toMatch(/\bfetch\s*\(/u)
    // 停止入口的规格依据与「切走再回来」的判定依据必须写在源码里（引用条款，不凭感觉）。
    expect(source).toContain('§13.1')
    expect(source).toContain('S6 §6')
  })

  it('场景只读旁挂清单，不写、不删（数据面只用于前后对比）', () => {
    const source = readFileSync(SOURCE, 'utf8')
    expect(source).toContain('readFileSync')
    // 名单外：本文件不许出现写 / 删业务数据的调用。
    expect(source).not.toMatch(/writeFileSync|rmSync|renameSync|unlinkSync|mkdirSync/u)
  })
})

// ── 只读数据面 ──────────────────────────────────────────────────────────────

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 临时目录留着不致命 */ }
  }
})

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'xuanshu-exp-exc-'))
  tempDirs.push(home)
  mkdirSync(consultSessionsDir(home), { recursive: true })
  return home
}

function writeManifest(home, name, body) {
  writeFileSync(join(consultSessionsDir(home), name), `${JSON.stringify(body, null, 2)}\n`, 'utf8')
}

describe('票 #79 · 旁挂清单只读核对（临时目录，零浏览器）', () => {
  it('目录不存在时返回空清单，不抛错', () => {
    const home = join(tmpdir(), `xuanshu-exp-missing-${String(Date.now())}`)
    expect(consultSessionsDir(home)).toContain('xuanshu')
    expect(listConsultSessionFiles(home)).toEqual([])
  })

  it('列出 *.json（排序），非 json 文件不混进来', () => {
    const home = makeHome()
    writeManifest(home, 'b.json', { turns: 1 })
    writeManifest(home, 'a.json', { turns: 0 })
    writeFileSync(join(consultSessionsDir(home), 'notes.txt'), 'x', 'utf8')
    expect(listConsultSessionFiles(home)).toEqual(['a.json', 'b.json'])
  })

  it('读一份旁挂清单；坏文件返回 null（坏文件不该中断场景）', () => {
    const home = makeHome()
    writeManifest(home, 'ok.json', { turns: 2, pus: ['体验-木工'] })
    writeFileSync(join(consultSessionsDir(home), 'broken.json'), '{ not json', 'utf8')
    expect(readConsultSessionFile(home, 'ok.json')).toEqual({ turns: 2, pus: ['体验-木工'] })
    expect(readConsultSessionFile(home, 'broken.json')).toBeNull()
  })

  it('前后对比只认新增文件，并带回 turns / pus', () => {
    const home = makeHome()
    writeManifest(home, 'old.json', { turns: 1, pus: [] })
    const before = listConsultSessionFiles(home)
    writeManifest(home, 'new.json', { turns: 1, pus: ['体验-木工'] })
    const diff = diffConsultSessions(home, before)
    expect(diff.newFiles).toEqual(['new.json'])
    expect(diff.newTurns).toEqual([1])
    expect(diff.newPus).toEqual([['体验-木工']])
  })
})

// ── E02 空提交判定 ──────────────────────────────────────────────────────────

function emptyObservations(overrides = {}) {
  return {
    panel: { opened: true, attempts: 1 },
    question: { empty: true, textareaUsable: true },
    submit: { found: true, disabled: true, clicked: false, busySeen: false, busyLabel: '', label: '＋ 开一次问事', explanation: '未配置模型：去「设置 → 模型」配置', errorText: '' },
    data: { sessionsBefore: 3, sessionsAfter: 3, historyBefore: 3, historyAfter: 3 },
    terminal: { kind: 'nothing', text: '', inViewport: null },
    ...overrides,
  }
}

describe('票 #79 · E02 空提交：被拦住 / 新建会话 / 没反应各有归处', () => {
  it('问事面板没打开 → blocked', () => {
    const decision = decideEmptySubmitOutcome(emptyObservations({ panel: { opened: false, attempts: 3 } }))
    expect(decision.status).toBe('blocked')
    expectStatus(decision)
  })

  it('找不到提交按钮 → fail', () => {
    const decision = decideEmptySubmitOutcome(emptyObservations({ submit: { found: false } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('按钮')
    expectStatus(decision)
  })

  it('按钮禁用但没有解释 → fail', () => {
    const decision = decideEmptySubmitOutcome(emptyObservations({ submit: { found: true, disabled: true, clicked: false, explanation: '' } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('没有说明')
    expectStatus(decision)
  })

  it('按钮禁用且解释清楚 → pass（按产品真实规则被拦住，未强行点击）', () => {
    const decision = decideEmptySubmitOutcome(emptyObservations())
    expect(decision.status).toBe('pass')
    expect(decision.evidence).toContain('按钮禁用并解释')
    expectStatus(decision)
  })

  it('点下去真的新建了一条会话 → fail（票面：不创建无意义会话）', () => {
    const decision = decideEmptySubmitOutcome(emptyObservations({
      submit: { found: true, disabled: false, clicked: true, busySeen: true, busyLabel: '开问事中…', explanation: '' },
      data: { sessionsBefore: 3, sessionsAfter: 4, historyBefore: 3, historyAfter: 4 },
      terminal: { kind: 'error', text: '会话已建好（#consult-<id>），但 DSH 会话面板不可用：请在侧栏工作区里打开它。', inViewport: false },
    }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('无意义会话')
    expect(decision.evidence).toContain('3→4')
    expectStatus(decision)
  })

  it('没建会话、但给出可读提示 → pass，并记下提示在不在视口', () => {
    const decision = decideEmptySubmitOutcome(emptyObservations({
      submit: { found: true, disabled: false, clicked: true, busySeen: true, busyLabel: '开问事中…', explanation: '' },
      terminal: { kind: 'error', text: '空问题不能提交：先写一句要问什么。', inViewport: false },
    }))
    expect(decision.status).toBe('pass')
    expect(decision.summary).toContain('可视区之外')
    expectStatus(decision)
  })

  it('点了没反应（没建会话、没提示）→ fail', () => {
    const decision = decideEmptySubmitOutcome(emptyObservations({
      submit: { found: true, disabled: false, clicked: true, busySeen: false, busyLabel: '', explanation: '' },
    }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('没有提示')
    expectStatus(decision)
  })

  it('按钮可见但点不动 → blocked（先记环境）', () => {
    const decision = decideEmptySubmitOutcome(emptyObservations({
      submit: { found: true, disabled: false, clicked: false, errorText: 'timeout' },
    }))
    expect(decision.status).toBe('blocked')
    expectStatus(decision)
  })
})

// ── E04 连点判定 ────────────────────────────────────────────────────────────

function repeatObservations(overrides = {}) {
  return {
    panel: { opened: true, attempts: 1 },
    submit: { found: true, disabledBefore: false, clicked: true, busySeen: true, busyLabel: '开问事中…', errorText: '' },
    data: { sessionsBefore: 3, sessionsAfter: 4, newTurns: [1], historyBefore: 3, historyAfter: 4 },
    terminal: { kind: 'error', text: '会话已建好（#consult-<id>），但 DSH 会话面板不可用：请在侧栏工作区里打开它。', inViewport: false },
    ...overrides,
  }
}

describe('票 #79 · E04 快速连点：重复会话 / 运行状态', () => {
  it('面板没打开 → blocked', () => {
    const decision = decideRepeatOutcome(repeatObservations({ panel: { opened: false } }))
    expect(decision.status).toBe('blocked')
    expectStatus(decision)
  })

  it('找不到提交按钮 → fail', () => {
    const decision = decideRepeatOutcome(repeatObservations({ submit: { found: false } }))
    expect(decision.status).toBe('fail')
    expectStatus(decision)
  })

  it('按钮在连点前就禁用 → blocked（没有可连点的对象）', () => {
    const decision = decideRepeatOutcome(repeatObservations({ submit: { found: true, disabledBefore: true, clicked: false } }))
    expect(decision.status).toBe('blocked')
    expect(decision.summary).toContain('不可点')
    expectStatus(decision)
  })

  it('连点没有落到控件上 → blocked', () => {
    const decision = decideRepeatOutcome(repeatObservations({ submit: { found: true, disabledBefore: false, clicked: false, errorText: 'element is not enabled' } }))
    expect(decision.status).toBe('blocked')
    expectStatus(decision)
  })

  it('多出两条会话 → fail（非预期重复会话）', () => {
    const decision = decideRepeatOutcome(repeatObservations({
      data: { sessionsBefore: 3, sessionsAfter: 5, newTurns: [1, 1], historyBefore: 3, historyAfter: 5 },
    }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('重复会话')
    expect(decision.evidence).toContain('3→5')
    expectStatus(decision)
  })

  it('只多一条会话但 turns>1 → fail（重复提交）', () => {
    const decision = decideRepeatOutcome(repeatObservations({
      data: { sessionsBefore: 3, sessionsAfter: 4, newTurns: [2], historyBefore: 3, historyAfter: 4 },
    }))
    expect(decision.status).toBe('fail')
    expect(decision.evidence).toContain('turns>1')
    expectStatus(decision)
  })

  it('只多一条会话且有运行态 → pass', () => {
    const decision = decideRepeatOutcome(repeatObservations())
    expect(decision.status).toBe('pass')
    expect(decision.summary).toContain('没有产生重复会话')
    expectStatus(decision)
  })

  it('只多一条会话但没有可观察的运行态 → fail', () => {
    const decision = decideRepeatOutcome(repeatObservations({
      submit: { found: true, disabledBefore: false, clicked: true, busySeen: false, busyLabel: '', errorText: '' },
      terminal: { kind: 'nothing', text: '', inViewport: null },
    }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('运行状态')
    expectStatus(decision)
  })

  it('一条都没建、失败原因是服务/环境 → blocked（不记成连点的产品结论）', () => {
    const decision = decideRepeatOutcome(repeatObservations({
      data: { sessionsBefore: 3, sessionsAfter: 3, newTurns: [], historyBefore: 3, historyAfter: 3 },
      terminal: { kind: 'error', text: '开问事失败：模型不可用', inViewport: false },
    }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('服务/环境')
    expectStatus(decision)
  })

  it('一条都没建、也没有反馈 → fail', () => {
    const decision = decideRepeatOutcome(repeatObservations({
      data: { sessionsBefore: 3, sessionsAfter: 3, newTurns: [], historyBefore: 3, historyAfter: 3 },
      terminal: { kind: 'nothing', text: '', inViewport: null },
    }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('没有反应')
    expectStatus(decision)
  })
})

// ── E05 切走再回来判定 ──────────────────────────────────────────────────────

function returnObservations(overrides = {}) {
  return {
    panel: { opened: true, attempts: 1 },
    prereq: { ok: true, reason: '' },
    samePanel: { draftKept: true, selectionKept: true },
    reading: { openRecorded: true, viewAfter: 'reader', viewKept: true, positionKept: true, topBefore: 320, topAfter: 318, scrollable: true },
    cross: { comparable: true, contaminated: false, identityMismatch: false, sampled: 2, pair: { a: '#consult-a', b: '#consult-b' } },
    ...overrides,
  }
}

describe('票 #79 · E05 切走再回来：逐条对 §13.1', () => {
  it('面板没打开 → blocked', () => {
    const decision = decideReturnOutcome(returnObservations({ panel: { opened: false } }))
    expect(decision.status).toBe('blocked')
    expectStatus(decision)
  })

  it('前置没就绪 → blocked（环境问题不记成产品缺陷）', () => {
    const decision = decideReturnOutcome(returnObservations({ prereq: { ok: false, reason: '勾选区里没有「体验-木工」' } }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('体验-木工')
    expectStatus(decision)
  })

  it('草稿正文丢了 → fail，并引用 §13.1 第 1 行', () => {
    const decision = decideReturnOutcome(returnObservations({ samePanel: { draftKept: false, selectionKept: true } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('§13.1')
    expect(decision.evidence).toContain('§13.1')
    expectStatus(decision)
  })

  it('已勾选的谱丢了 → fail，并引用 §13.1 第 1 行', () => {
    const decision = decideReturnOutcome(returnObservations({ samePanel: { draftKept: true, selectionKept: false } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('已勾选的谱')
    expectStatus(decision)
  })

  it('阅读器没有回来（落在门厅）→ fail，并引用 §13.1 第 1 行', () => {
    const decision = decideReturnOutcome(returnObservations({ reading: { openRecorded: true, viewAfter: 'lobby', viewKept: false, positionKept: false, topBefore: 320, topAfter: 0 } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('阅读位置')
    expectStatus(decision)
  })

  it('阅读器回来了但滚动位置没保留 → fail', () => {
    const decision = decideReturnOutcome(returnObservations({ reading: { openRecorded: true, viewAfter: 'reader', viewKept: true, positionKept: false, topBefore: 320, topAfter: 0 } }))
    expect(decision.status).toBe('fail')
    expect(decision.evidence).toContain('320 → 0')
    expectStatus(decision)
  })

  it('没有可打开的历史记录 → not-collected（不许把没采到记成通过）', () => {
    const decision = decideReturnOutcome(returnObservations({ reading: { openRecorded: false, viewKept: false, positionKept: false } }))
    expect(decision.status).toBe('not-collected')
    expect(decision.reason).toContain('未采到')
    expectStatus(decision)
  })

  it('点 A 看到 B（短 id 不一致）→ fail（§13.1 第 2 行串味风险）', () => {
    const decision = decideReturnOutcome(returnObservations({ cross: { comparable: true, contaminated: false, identityMismatch: true, sampled: 2 } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('不是所点的那条')
    expectStatus(decision)
  })

  it('A 的输入出现在 B 里 → fail（违反 §13.1 第 2 行）', () => {
    const decision = decideReturnOutcome(returnObservations({ cross: { comparable: true, contaminated: true, identityMismatch: false, sampled: 2 } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('串味')
    expect(decision.evidence).toContain('§13.1 第 2 行')
    expectStatus(decision)
  })

  it('没有两条可比记录 → not-collected（跨会话这一条未采到）', () => {
    const decision = decideReturnOutcome(returnObservations({ cross: { comparable: false, contaminated: false, identityMismatch: false, sampled: 1, reason: '采样不足' } }))
    expect(decision.status).toBe('not-collected')
    expect(decision.reason).toBe('采样不足')
    expectStatus(decision)
  })

  it('草稿 / 勾选 / 阅读位置 / 跨会话都成立 → pass', () => {
    const decision = decideReturnOutcome(returnObservations())
    expect(decision.status).toBe('pass')
    expect(decision.evidence).toContain('§13.1 第 1 行')
    expectStatus(decision)
  })
})

// ── E08 停止判定 ────────────────────────────────────────────────────────────

function stopObservations(overrides = {}) {
  return {
    panel: { opened: true, attempts: 1 },
    submit: { clicked: true, busySeen: true, busyLabel: '开问事中…' },
    conversation: { reached: true, completedBeforeCheck: false },
    stop: { consultEntry: false, seen: true, clicked: true },
    after: { feedback: true, operable: true },
    ...overrides,
  }
}

describe('票 #79 · E08 响应中停止：入口 / 终止反馈 / 后续可操作', () => {
  it('问事面板没打开 → blocked', () => {
    const decision = decideStopOutcome(stopObservations({ panel: { opened: false } }))
    expect(decision.status).toBe('blocked')
    expectStatus(decision)
  })

  it('没有把问事发出去 → blocked（无法进入运行中状态）', () => {
    const decision = decideStopOutcome(stopObservations({ submit: { clicked: false } }))
    expect(decision.status).toBe('blocked')
    expectStatus(decision)
  })

  it('会话面板不可达 → blocked，并说明停止入口按 S6 §6 在会话面板里', () => {
    const decision = decideStopOutcome(stopObservations({ conversation: { reached: false, reason: '侧栏没有「工作区 / 未分组」树' } }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('会话面板')
    expectStatus(decision)
  })

  it('响应进行中没有停止入口 → fail（S6 §6 要求 [停止]）', () => {
    const decision = decideStopOutcome(stopObservations({ stop: { consultEntry: false, seen: false, clicked: false } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('没有停止入口')
    expectStatus(decision)
  })

  it('没抓到生成中窗口（响应已结束）→ not-collected，不伪造停止成功', () => {
    const decision = decideStopOutcome(stopObservations({
      conversation: { reached: true, completedBeforeCheck: true },
      stop: { consultEntry: false, seen: false, clicked: false },
    }))
    expect(decision.status).toBe('not-collected')
    expect(decision.reason).toContain('没抓到生成中窗口')
    expectStatus(decision)
  })

  it('停止入口可见但点不动 → fail', () => {
    const decision = decideStopOutcome(stopObservations({ stop: { consultEntry: false, seen: true, clicked: false } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('点不动')
    expectStatus(decision)
  })

  it('点了停止但没有终止反馈 → fail', () => {
    const decision = decideStopOutcome(stopObservations({ after: { feedback: false, operable: true } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('终止反馈')
    expectStatus(decision)
  })

  it('停止之后不能再操作 → fail', () => {
    const decision = decideStopOutcome(stopObservations({ after: { feedback: true, operable: false } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('不能再操作')
    expectStatus(decision)
  })

  it('入口可见、点得动、有终止反馈、之后仍可操作 → pass', () => {
    const decision = decideStopOutcome(stopObservations())
    expect(decision.status).toBe('pass')
    expect(decision.evidence).toContain('S6 §6')
    expectStatus(decision)
  })
})
