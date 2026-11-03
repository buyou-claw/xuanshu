/**
 * tests/experience/run-cli.test.mjs —— 实操 runner（Spec 04 · 票 #77）的**结构判据台**。
 *
 * 这条线最难防的错误不是「脚本崩了」，而是「证据看起来齐全，其实什么都没验证」：
 * 覆盖表提前填了通过、命令行参数把证据写进了源码树、场景用了 `force: true` 绕开真实控件。
 * 所以本文件钉的正是这四件事，**全部零浏览器**（票面标准 9：浏览器侧只留 1 条 e2e）：
 *
 *   1. **CLI 形状**：一条命令的入口参数、非法输入的可读报错与退出码；非法输入**不落任何证据**；
 *   2. **证据包形状**（用录制夹具跑**同一条**打包路径）：固定文件名、覆盖表「证据或理由」、
 *      步骤行闭集、确定性、脱敏；
 *   3. **E01 判定**（纯函数）：未配模型时的四种终态各自落到 pass / fail / blocked 的哪一格——
 *      「未采到 ≠ 通过」与「不许提前填通过」在这里被钉死；
 *   4. **ADR-0017 第 3 条**：runner 源码里没有 `force: true`、场景不借内部 RPC 完成表单动作。
 *
 * 范式来自 prior art：`tests/ux/browser-collector.test.mjs`（浏览器侧只留 1 条端到端）、
 * `tests/experience/evidence.test.mjs`（确定性 + 状态词表）、
 * `tests/lib/worktree-create.test.mjs`（临时目录 + 真实脚本 + 外部可观察物：退出码 / 产物形状）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  COVERAGE_STATUSES,
  EVIDENCE_FILES,
  STEP_FIELDS,
  errorsDocument,
} from '../../scripts/experience/evidence.mjs'
import {
  DEFAULT_HOME,
  ENVIRONMENT_END_FILE,
  EXIT,
  PHASE_PATTERN,
  RunError,
  exitCodeForCoverage,
  parseRunArgs,
  writeEvidencePack,
} from '../../scripts/experience/run.mjs'
import { SCENARIOS } from '../../scripts/experience/scenarios/index.mjs'
import { decideConsultOutcome } from '../../scripts/experience/scenarios/consult.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const RUN_SCRIPT = join(REPO_ROOT, 'scripts', 'experience', 'run.mjs')

/**
 * 本文件加载时仓库里 `ux-reports/` 的有无。
 * 取样而不是写死 `false`：真跑过一轮之后它本来就在（`ux-reports/` 是 gitignore 的产物目录），
 * 写死会让「非法参数不许落证据」这条断言在真跑过之后假红。
 */
const REPO_UX_REPORTS_EXISTED_AT_LOAD = existsSync(join(REPO_ROOT, 'ux-reports'))

/** 临时目录登记表：用例结束一律删掉（本文件不往仓库里写证据）。 */
const tempDirs = []
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 临时目录留着不致命 */ }
  }
})

function tempDir(prefix = 'xuanshu-run-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** 跑一次真脚本（外部可观察物：退出码 + stdout/stderr）。 */
function runCli(args) {
  const result = spawnSync(process.execPath, [RUN_SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** 抓到抛出的错误对象本身（要断言类型与可读原因，而不只是「会抛」）。 */
function capture(action) {
  try {
    action()
    return null
  } catch (caught) {
    return caught
  }
}

// ── 录制夹具：一条「已经跑完」的场景结果 ───────────────────────────────────────

/**
 * 一条合法场景结果的基准（各条用例只改自己要钉的那一处）。
 * 它是**录制夹具**：形状来自真实执行会产出的东西，但这里不启动浏览器。
 */
function fixtureRun(overrides = {}) {
  return {
    scenarioId: 'consult-no-model',
    caseId: 'E01',
    title: '未配模型时的首次问事',
    status: {
      status: 'pass',
      evidence: '01-entry.png / 03-terminal.png（步骤 1–3）',
      summary: '产品禁止提交且解释清楚',
    },
    steps: [
      { step: 1, action: '打开问事面板', target: 'panel:consult', outcome: '面板出现，主按钮禁用并给出解释', shot: '01-entry.png' },
      { step: 2, action: '填入问题', target: 'consult-question', outcome: 'textarea 接受输入（不提交）', shot: '02-attempt.png' },
      { step: 3, action: '核查配置入口', target: 'settings', outcome: '设置面板可达', shot: '04-config-entry.png' },
    ],
    errors: { consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [] },
    trace: { saved: true, bytes: 4096 },
    ...overrides,
  }
}

function fixtureEnvironment(stage) {
  return {
    schema: 'xuanshu/experience-environment@1',
    stage,
    phase: 'task-before',
    scenario: 'consult-no-model',
    source: { sha: '47d157a086e25e7bd624e4bb84b8c31fb9abd4a2', branch: 'feat/spec04-t03-runner', dirtyFiles: 0 },
    instance: { home: '.experience-home/round-01', port: 19488, url: 'http://127.0.0.1:19488/?token=<redacted>', keepHome: true },
  }
}

describe('票 #77 · AC1 CLI 形状：一条命令、非法输入先失败且不落证据', () => {
  it('--help 退出 0，并列出三个必备参数（--scenario / --out / --phase）', () => {
    const { code, stdout } = runCli(['--help'])
    expect(code).toBe(EXIT.ok)
    for (const flag of ['--scenario', '--out', '--phase']) expect(stdout).toContain(flag)
  })

  it('默认值与计划口径一致：home 是 .experience-home/round-01，默认保留 home', () => {
    const opts = parseRunArgs(['--scenario', 'consult-no-model', '--out', 'ux-reports/experience-round-01', '--phase', 'task-before'])
    expect(opts.home).toBe(DEFAULT_HOME)
    expect(opts.keepHome).toBe(true)
  })

  it('缺 --out → 退出 2，报错说得清缺什么，且不创建任何目录', () => {
    const { code, stderr } = runCli(['--scenario', 'consult-no-model', '--phase', 'task-before'])
    expect(code).toBe(EXIT.usage)
    expect(stderr).toContain('--out')
    expect(existsSync(join(REPO_ROOT, 'ux-reports'))).toBe(REPO_UX_REPORTS_EXISTED_AT_LOAD)
  })

  it('--out 不是 ux-reports/experience-<轮次> 形状 → 退出 2，指出正确形状', () => {
    const { code, stderr } = runCli(['--scenario', 'consult-no-model', '--out', 'ux-reports/round-01', '--phase', 'task-before'])
    expect(code).toBe(EXIT.usage)
    expect(stderr).toContain('experience-')
  })

  it('--out 是绝对路径 → 退出 2，说明必须是相对仓库根的路径', () => {
    const absolute = process.platform === 'win32' ? 'C:\\evidence\\experience-round-01' : '/tmp/experience-round-01'
    const { code, stderr } = runCli(['--scenario', 'consult-no-model', '--out', absolute, '--phase', 'task-before'])
    expect(code).toBe(EXIT.usage)
    expect(stderr).toContain('绝对路径')
  })

  it('--phase 带目录分隔符 / 空格 / 超长 → 退出 2，报错点名「安全短名」', () => {
    for (const phase of ['../escape', 'Task Before', 'a'.repeat(40), '']) {
      const { code, stderr } = runCli(['--scenario', 'consult-no-model', '--out', 'ux-reports/experience-round-01', '--phase', phase])
      expect(code, phase).toBe(EXIT.usage)
      expect(stderr, phase).toContain('短名')
    }
    // 合法阶段名不被拒（它要能当目录名用）
    expect(PHASE_PATTERN.test('task-before')).toBe(true)
    expect(PHASE_PATTERN.test('before')).toBe(true)
  })

  it('未知场景 → 退出 2，并把可选的场景 id 列出来（不猜、不静默退回默认场景）', () => {
    const { code, stderr } = runCli(['--scenario', 'nope', '--out', 'ux-reports/experience-round-01', '--phase', 'task-before'])
    expect(code).toBe(EXIT.usage)
    expect(stderr).toContain('consult-no-model')
  })

  it('未知参数 / --keep-home 与 --drop-home 同时给 → 退出 2（两者互斥，不静默取一个）', () => {
    const unknown = runCli(['--scenario', 'consult-no-model', '--out', 'ux-reports/experience-round-01', '--phase', 'task-before', '--wat'])
    expect(unknown.code).toBe(EXIT.usage)
    expect(unknown.stderr).toContain('--wat')

    const both = runCli([
      '--scenario', 'consult-no-model', '--out', 'ux-reports/experience-round-01', '--phase', 'task-before',
      '--keep-home', '--drop-home',
    ])
    expect(both.code).toBe(EXIT.usage)
    expect(both.stderr).toMatch(/互斥|只能给一个/u)
  })

  it('parseRunArgs 对非法用例抛 RunError（可读失败，不是断言红）', () => {
    const caught = capture(() => parseRunArgs(['--out', 'ux-reports/experience-round-01', '--phase', 'task-before']))
    expect(caught).toBeInstanceOf(RunError)
    expect(caught.message).toContain('--scenario')
  })
})

describe('票 #77 · AC2 证据包形状：固定文件名 + 覆盖表指向证据 + 确定性', () => {
  it('写出全部固定文件名：phase 级六件 + 场景子目录三件（含 environment 起止各一份）', () => {
    const dir = join(tempDir(), 'task-before')
    writeEvidencePack({
      dir,
      phase: 'task-before',
      environment: fixtureEnvironment('start'),
      environmentEnd: fixtureEnvironment('end'),
      runs: [fixtureRun()],
    })

    for (const name of [EVIDENCE_FILES.environment, ENVIRONMENT_END_FILE, EVIDENCE_FILES.coverage, EVIDENCE_FILES.steps, EVIDENCE_FILES.errors, EVIDENCE_FILES.findings]) {
      expect(existsSync(join(dir, name)), name).toBe(true)
    }
    // 起止两份是**两个不同文件**：只交一份就说不出「这一轮从哪跑到哪」
    expect(ENVIRONMENT_END_FILE).not.toBe(EVIDENCE_FILES.environment)
    const start = JSON.parse(readFileSync(join(dir, EVIDENCE_FILES.environment), 'utf8'))
    const end = JSON.parse(readFileSync(join(dir, ENVIRONMENT_END_FILE), 'utf8'))
    expect(start.stage).toBe('start')
    expect(end.stage).toBe('end')

    for (const name of [EVIDENCE_FILES.steps, EVIDENCE_FILES.errors]) {
      expect(existsSync(join(dir, 'consult-no-model', name)), name).toBe(true)
    }
  })

  it('coverage.json：每行都指向证据或阻塞理由，状态取自判据词表 + blocked', () => {
    const dir = join(tempDir(), 'task-before')
    writeEvidencePack({
      dir,
      phase: 'task-before',
      environment: fixtureEnvironment('start'),
      environmentEnd: fixtureEnvironment('end'),
      runs: [fixtureRun()],
    })
    const coverage = JSON.parse(readFileSync(join(dir, EVIDENCE_FILES.coverage), 'utf8'))
    expect(coverage.cases).toHaveLength(1)
    const [row] = coverage.cases
    expect(row.caseId).toBe('E01')
    expect(COVERAGE_STATUSES).toContain(row.status)
    expect(row.evidence).toBeTruthy()
    expect(row.reason).toBeUndefined()
    expect(row.scenario).toBe('consult-no-model')
    // 「最后走到的步骤」也要留痕：读者要知道结论停在哪一步
    expect(row.lastStep).toBe('核查配置入口')
  })

  it('blocked 行给的是理由而不是证据（环境缺前置不许写成通过）', () => {
    const dir = join(tempDir(), 'task-before')
    writeEvidencePack({
      dir,
      phase: 'task-before',
      environment: fixtureEnvironment('start'),
      environmentEnd: fixtureEnvironment('end'),
      runs: [fixtureRun({ status: { status: 'blocked', reason: '问事面板没打开（首跑模态拦住侧栏）', summary: '面板不可达' } })],
    })
    const [row] = JSON.parse(readFileSync(join(dir, EVIDENCE_FILES.coverage), 'utf8')).cases
    expect(row.status).toBe('blocked')
    expect(row.reason).toContain('面板没打开')
    expect(row.evidence).toBeUndefined()
  })

  it('确定性与闭集：同一夹具两次打包字节相同，步骤行只含 STEP_FIELDS', () => {
    const first = join(tempDir(), 'task-before')
    const second = join(tempDir(), 'task-before')
    for (const dir of [first, second]) {
      writeEvidencePack({
        dir,
        phase: 'task-before',
        environment: fixtureEnvironment('start'),
        environmentEnd: fixtureEnvironment('end'),
        runs: [fixtureRun()],
      })
    }
    for (const name of [EVIDENCE_FILES.steps, EVIDENCE_FILES.coverage, EVIDENCE_FILES.findings]) {
      expect(readFileSync(join(second, name), 'utf8')).toBe(readFileSync(join(first, name), 'utf8'))
    }
    const lines = readFileSync(join(first, EVIDENCE_FILES.steps), 'utf8').trimEnd().split('\n')
    for (const line of lines) {
      const parsed = JSON.parse(line)
      for (const key of Object.keys(parsed)) expect(STEP_FIELDS).toContain(key)
      expect(parsed.shot === undefined || !/[\\/]/u.test(parsed.shot)).toBe(true)
    }
  })

  it('错误文档只有最小字段，URL 里的一次性凭据被脱敏', () => {
    const dir = join(tempDir(), 'task-before')
    writeEvidencePack({
      dir,
      phase: 'task-before',
      environment: fixtureEnvironment('start'),
      environmentEnd: fixtureEnvironment('end'),
      runs: [fixtureRun({ errors: { consoleErrors: ['boom http://127.0.0.1:19488/?token=SECRET123'], pageErrors: [], requestFailures: [], httpErrors: [] } })],
    })
    const doc = JSON.parse(readFileSync(join(dir, EVIDENCE_FILES.errors), 'utf8'))
    expect(doc.total).toBe(1)
    expect(doc.console[0].message).toContain('<redacted>')
    expect(doc.console[0].message).not.toContain('SECRET123')
    for (const row of doc.console) expect(Object.keys(row).every((key) => ['kind', 'message', 'step'].includes(key))).toBe(true)
  })

  it('findings.md 写的是本轮实测记录，并且不假装有裁定过的发现编号', () => {
    const dir = join(tempDir(), 'task-before')
    writeEvidencePack({
      dir,
      phase: 'task-before',
      environment: fixtureEnvironment('start'),
      environmentEnd: fixtureEnvironment('end'),
      runs: [fixtureRun()],
    })
    const markdown = readFileSync(join(dir, EVIDENCE_FILES.findings), 'utf8')
    expect(markdown).toContain('consult-no-model')
    expect(markdown).toContain('pass')
    // 没有人工签字就没有编号发现：本轮只能是骨架 + 实测记录
    expect(markdown).toContain('EXP-001')
    expect(markdown).toMatch(/未做裁定|没有编号发现/u)
  })
})

describe('票 #77 · AC3/AC4 E01 判定：未配模型时的每种终态各有归处', () => {
  /** 一份「问事面板已打开」的基准观测（各条用例只改要钉的那一处）。 */
  function observations(overrides = {}) {
    return {
      panel: { opened: true, attempts: 1 },
      submit: { found: true, disabled: true, label: '＋ 开一次问事', explanation: '未接上 AI：请打开 DSH「设置 → 模型」配置 provider 与默认模型。' },
      configEntry: { visible: true, enabled: true, label: '去「设置 → 模型」', pathText: '设置 → 模型' },
      attempt: { clicked: false, clickedAt: 'disabled' },
      terminal: { kind: 'disabled', text: '未接上 AI：请打开 DSH「设置 → 模型」配置 provider 与默认模型。' },
      spinner: { stillBusy: false, at: 'none' },
      ...overrides,
    }
  }

  it('面板没打开 → blocked + 理由（环境缺前置不记成产品缺陷）', () => {
    const decision = decideConsultOutcome(observations({ panel: { opened: false, attempts: 3 }, submit: { found: false, disabled: false, label: '', explanation: '' } }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('面板')
    expect(decision.evidence).toBeUndefined()
  })

  it('产品禁止提交但解释清楚 → pass（这就是 E01 要验的那一格），而且不让点', () => {
    const decision = decideConsultOutcome(observations())
    expect(decision.status).toBe('pass')
    expect(decision.evidence).toBeTruthy()
    // 「不强行点击」是可断言的行为：disabled 时 clicked 必须为 false 且 clickedAt 记成 disabled
    expect(decision.observed.clicked).toBe(false)
  })

  it('禁用却没有解释 → fail（禁用不是解释）', () => {
    const decision = decideConsultOutcome(observations({
      submit: { found: true, disabled: true, label: '＋ 开一次问事', explanation: '' },
      terminal: { kind: 'disabled', text: '' },
    }))
    expect(decision.status).toBe('fail')
    expect(decision.evidence).toContain('01-entry')
    expect(decision.summary).toContain('禁用')
  })

  it('点了之后有可读错误条、没有继续转圈 → pass（无假成功、无永久转圈）', () => {
    const decision = decideConsultOutcome(observations({
      submit: { found: true, disabled: false, label: '＋ 开一次问事', explanation: '' },
      attempt: { clicked: true, clickedAt: 'enabled' },
      terminal: { kind: 'error', text: '这次问事发不出去：没有可用的模型，请先到「设置 → 模型」配置。' },
    }))
    expect(decision.status).toBe('pass')
    expect(decision.summary).toContain('提示')
  })

  it('有错误条但界面还在转圈 → fail（错误和永久转圈同时出现）', () => {
    const decision = decideConsultOutcome(observations({
      submit: { found: true, disabled: false, label: '＋ 开一次问事', explanation: '' },
      attempt: { clicked: true, clickedAt: 'enabled' },
      terminal: { kind: 'error', text: '出错了' },
      spinner: { stillBusy: true, at: 'button' },
    }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toMatch(/转圈|正在/u)
  })

  it('超时未完成 → fail，摘要就是「超时未完成」，并指向当时画面', () => {
    const decision = decideConsultOutcome(observations({
      submit: { found: true, disabled: false, label: '＋ 开一次问事', explanation: '' },
      attempt: { clicked: true, clickedAt: 'enabled' },
      terminal: { kind: 'timeout', text: '' },
      spinner: { stillBusy: true, at: 'status' },
    }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('超时未完成')
    expect(decision.evidence).toContain('03-terminal')
  })

  it('点完毫无反应（没有提示也没转圈） → fail（点了没动静也是缺陷）', () => {
    const decision = decideConsultOutcome(observations({
      submit: { found: true, disabled: false, label: '＋ 开一次问事', explanation: '' },
      attempt: { clicked: true, clickedAt: 'enabled' },
      terminal: { kind: 'nothing', text: '' },
    }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toMatch(/没有反应|没动静/u)
  })

  it('提示存在但渲染在可视区之外 → 仍记 pass，但摘要必须点出「看不见」（本轮实测撞到的那一格）', () => {
    const decision = decideConsultOutcome(observations({
      submit: { found: true, disabled: false, label: '＋ 开一次问事', explanation: '' },
      attempt: { clicked: true, clickedAt: 'enabled' },
      terminal: { kind: 'error', text: '会话已建好（#consult-<id>），但 DSH 会话面板不可用：请在侧栏工作区里打开它。' },
      prompt: { mentionsConfigCause: false, inViewport: false },
    }))
    expect(decision.status).toBe('pass')
    expect(decision.summary).toContain('可视区之外')
    // 「提示有没有说清缺什么」也要如实说：这条实测提示里没有点到模型/配置
    expect(decision.summary).toContain('没有')
    expect(decision.observed.promptInViewport).toBe(false)
  })

  it('提示落在可视区内且点到配置原因 → 摘要如实说「点到了」', () => {
    const decision = decideConsultOutcome(observations({
      submit: { found: true, disabled: false, label: '＋ 开一次问事', explanation: '' },
      attempt: { clicked: true, clickedAt: 'enabled' },
      terminal: { kind: 'error', text: '没有可用的模型：请到 DSH 设置 → 模型 配置 provider。' },
      prompt: { mentionsConfigCause: true, inViewport: true },
    }))
    expect(decision.status).toBe('pass')
    expect(decision.summary).toContain('点到了')
    expect(decision.summary).not.toContain('可视区之外')
  })

  it('切进会话但屏上没有任何提示 → fail（未配模型还能开问事 = 疑似假成功）', () => {    const decision = decideConsultOutcome(observations({
      submit: { found: true, disabled: false, label: '＋ 开一次问事', explanation: '' },
      attempt: { clicked: true, clickedAt: 'enabled' },
      terminal: { kind: 'session', text: '' },
    }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toMatch(/提示|假成功/u)
  })
})

describe('票 #77 · AC5/AC8 结构约束与退出码', () => {
  it('runner 与场景源码里没有 force: true（ADR-0017 第 3 条）', () => {
    for (const file of ['run.mjs', 'scenarios/consult.mjs', 'scenarios/index.mjs']) {
      const source = readFileSync(join(REPO_ROOT, 'scripts', 'experience', file), 'utf8')
      expect(source, file).not.toMatch(/force\s*:\s*true/u)
    }
  })

  it('场景不借内部 RPC 完成表单动作（只能读，不能替人提交）', () => {
    const source = readFileSync(join(REPO_ROOT, 'scripts', 'experience', 'scenarios', 'consult.mjs'), 'utf8')
    expect(source).not.toMatch(/\/api\/xuanshu/u)
    expect(source).not.toMatch(/\bfetch\s*\(/u)
  })

  it('场景表里 consult-no-model 就是 E01，且带标题与截图清单', () => {
    const scenario = SCENARIOS['consult-no-model']
    expect(scenario.caseId).toBe('E01')
    expect(scenario.title).toContain('问事')
    expect(scenario.shots.length).toBeGreaterThanOrEqual(3)
    expect(typeof scenario.run).toBe('function')
  })

  it('退出码跟着覆盖表走：全 pass = 0，有 fail/blocked = 3（证据仍然落盘）', () => {
    expect(exitCodeForCoverage([{ status: 'pass' }])).toBe(EXIT.ok)
    expect(exitCodeForCoverage([{ status: 'fail' }])).toBe(EXIT.incomplete)
    expect(exitCodeForCoverage([{ status: 'blocked' }])).toBe(EXIT.incomplete)
    expect(exitCodeForCoverage([])).toBe(EXIT.incomplete)
  })
})

describe('票 #77 · 错误文档输入形状（供场景侧追加错误时不出格）', () => {
  it('错误行的 step 必须指向「第几步」，堆栈被剥掉', () => {
    const doc = errorsDocument({
      consoleErrors: [{ message: 'Error: x\n    at f (file:///C:/repo/a.js:1:1)', step: 2 }],
    })
    expect(doc.console[0].step).toBe(2)
    expect(doc.console[0].message).not.toContain('at f')
  })

  it('证据目录之外的写入不会发生：assertEvidenceDir 的拒绝在本 runner 的入口就生效', () => {
    const caught = capture(() => parseRunArgs(['--scenario', 'consult-no-model', '--out', '../escape/experience-round-01', '--phase', 'task-before']))
    expect(caught).toBeInstanceOf(RunError)
  })
})

// 让「临时目录」这条约定自己也被检查一次：本文件跑完不该在仓库里留下 ux-reports/ 的新东西。

describe('票 #77 · AC9 本文件不写仓库证据', () => {
  it('跑完本文件后仓库里 ux-reports/ 的有无与加载时一致', () => {
    expect(existsSync(join(REPO_ROOT, 'ux-reports'))).toBe(REPO_UX_REPORTS_EXISTED_AT_LOAD)
  })
})

// 说明：`writeFileSync` / `mkdirSync` 在上面被夹具用到时才会写盘；
// 这里保留一次最小自检，防止「夹具本身悄悄造了目录」这种自证。
describe('票 #77 · 夹具自检', () => {
  it('临时目录确实在 os.tmpdir() 下，不是仓库内', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'probe.txt'), 'ok')
    mkdirSync(join(dir, 'nested'), { recursive: true })
    expect(dir.startsWith(tmpdir())).toBe(true)
    expect(readFileSync(join(dir, 'probe.txt'), 'utf8')).toBe('ok')
  })
})
