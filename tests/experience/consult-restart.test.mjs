/**
 * tests/experience/consult-restart.test.mjs —— 票 #80（06 · 重启后找回）的**结构判据台**。
 *
 * 本文件钉住六条验收标准里所有**不依赖真浏览器**的部分：
 *   1. 「停旧进程 → 保 home → 起新进程」的编排（`createBootSequence`，注入替身，零浏览器）；
 *   2. 认证重新握手的判定（`describeHandshake`：新 token → 新 cookie，URL 里 token 已被消费）；
 *   3. 同一条记录 + 内容一致（`compareRecordContent`，逐条消息比对，不做「有字就算」）；
 *   4. 「已落盘会话」与「未提交草稿」两种保留承诺（`describeDraftBoundary`：草稿丢了**不算缺陷**）；
 *   5. 「不能只关浏览器冒充重启」：两次 boot 必须是**先停后起**、同一 home、两个端口、两份起止时间；
 *   6. 起止环境快照与场景附加证据文件（`restart-boots.json`）由 runner 落盘（`writeEvidencePack`）。
 *
 * 范式照 `tests/experience/consult-sample.test.mjs`：零浏览器，只测外部可观察的返回值与产物形状。
 * 真实浏览器端到端仍然只有 `run-e2e.test.mjs` 那一条（票 #77 标准 9）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { COVERAGE_STATUSES, EVIDENCE_FILES } from '../../scripts/experience/evidence.mjs'
import { createBootSequence } from '../../scripts/experience/instance-lifecycle.mjs'
import {
  assertEvidenceFileName,
  writeEvidencePack,
} from '../../scripts/experience/run.mjs'
import { SCENARIOS } from '../../scripts/experience/scenarios/index.mjs'
import {
  RESTART_BOOTS_FILE,
  RESTART_QUESTION,
  RESTART_SHOTS,
  compareRecordContent,
  decideRestartOutcome,
  describeDraftBoundary,
  describeHandshake,
  restartBootDocument,
} from '../../scripts/experience/scenarios/consult-restart.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const RESTART_SOURCE = join(REPO_ROOT, 'scripts', 'experience', 'scenarios', 'consult-restart.mjs')
const LIFECYCLE_SOURCE = join(REPO_ROOT, 'scripts', 'experience', 'instance-lifecycle.mjs')

/** 临时目录登记表：用例结束一律删（本文件不往仓库里写证据）。 */
const tempDirs = []
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 临时目录留着不致命 */ }
  }
})

function tempDir(prefix = 'xuanshu-restart-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** 覆盖状态必须是判据词表 + blocked 里的一个，并且「通过/失败带证据、阻塞带理由」。 */
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

/** 注入替身：两次实例、两个端口、时钟按给定序列走。 */
function makeBootHarness({ ports = [19001, 19002], closed = { 19001: true, 19002: true }, times } = {}) {
  const events = []
  const startCalls = []
  const stopCalls = []
  let clockIndex = 0
  const clockValues = times ?? [
    '2026-11-03T00:00:00.000Z',
    '2026-11-03T00:00:01.000Z',
    '2026-11-03T00:00:03.000Z',
    '2026-11-03T00:00:04.000Z',
  ]
  const now = () => clockValues[Math.min(clockIndex++, clockValues.length - 1)]

  const sequence = createBootSequence({
    repoRoot: 'C:/repo',
    home: 'C:/home/round-01-t80',
    homeLabel: '.experience-home/round-01-t80',
    keepHome: true,
    log: () => {},
    now,
    wait: async () => {},
    checkClosed: async (port) => closed[port] === true,
    start: async (options) => {
      startCalls.push(options)
      const port = ports[startCalls.length - 1]
      events.push(`start:${port}`)
      return {
        port,
        url: `http://127.0.0.1:${port}/?token=SECRET-${port}`,
        home: options.home,
        keepHome: options.keepHome,
        stop: async () => {
          events.push(`stop:${port}`)
          stopCalls.push({ port, keepHome: options.keepHome, home: options.home })
        },
      }
    },
  })
  return { sequence, events, startCalls, stopCalls }
}

/** E07 的「一路走通」基线观测：各用例只改其中一格。 */
function restartObservations(overrides = {}) {
  return {
    panel: { opened: true, attempts: 1 },
    boot: {
      firstStarted: true,
      secondStarted: true,
      firstStopped: true,
      sameHome: true,
      previousPortClosed: true,
      distinctPorts: true,
      finalStopped: true,
    },
    handshake: {
      succeeded: true,
      appLoaded: true,
      tokenInUrl: false,
      cookieCount: 1,
    },
    recorded: {
      created: true,
      readable: true,
      foundInHistory: true,
      shortId: '#consult-<id>',
      questionPresent: true,
      answerPresent: true,
      terminal: 'error',
    },
    recovered: {
      found: true,
      sameShortId: true,
      contentEqual: true,
      questionPresent: true,
      answerPresent: true,
      selectionPresent: true,
    },
    continueEntry: { clicked: true, sameSession: true, errorText: '' },
    draft: { typedBeforeRestart: true, retainedAfterRestart: false, promise: 'not-guaranteed', isDefect: false },
    ...overrides,
  }
}

function fixtureEnvironment(stage, port = 19001) {
  return {
    schema: 'xuanshu/experience-environment@1',
    stage,
    phase: 'task-before',
    scenario: 'consult-restart',
    instance: { home: '(仓库外)/round-01-t80', port, url: `http://127.0.0.1:${port}/?token=<redacted>`, keepHome: true },
  }
}

function fixtureRun(overrides = {}) {
  return {
    scenarioId: 'consult-restart',
    caseId: 'E07',
    title: '重启后找回',
    status: { status: 'fail', evidence: '12-boot2-final.png', summary: '追问入口失败' },
    steps: [{ step: 1, action: '起实例', outcome: 'port=19001' }],
    errors: { consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [] },
    ...overrides,
  }
}

describe('票 #80 · 场景表形状：consult-restart 就是 E07', () => {
  it('SCENARIOS 里有 consult-restart，带标题、截图清单与 run 函数', () => {
    const scenario = SCENARIOS['consult-restart']
    expect(scenario).toBeDefined()
    expect(scenario.caseId).toBe('E07')
    expect(scenario.title).toContain('重启')
    expect(scenario.shots).toEqual(expect.arrayContaining([
      RESTART_SHOTS.boot1Reader,
      RESTART_SHOTS.boot2FirstPaint,
      RESTART_SHOTS.boot2Reader,
      RESTART_SHOTS.boot2ContinueError,
    ]))
    expect(typeof scenario.run).toBe('function')
  })

  it('场景源码没有 force: true、没有内部 RPC / fetch、没有手工 kill 端口', () => {
    const source = readFileSync(RESTART_SOURCE, 'utf8')
    expect(source).not.toMatch(/force\s*:\s*true/u)
    expect(source).not.toMatch(/\/api\/xuanshu/u)
    expect(source).not.toMatch(/\bfetch\s*\(/u)
    // 「不要手工 kill 端口」：停实例只能走 runner 的实例生命周期（注入的 restartInstance / stopInstance）。
    expect(source).not.toMatch(/process\.kill/u)
    expect(source).not.toMatch(/taskkill/iu)
    expect(source).not.toMatch(/child_process/u)
    expect(source).toContain('restartInstance')
  })

  it('编排模块不碰进程表：只调用注入的 start / stop / checkClosed', () => {
    const source = readFileSync(LIFECYCLE_SOURCE, 'utf8')
    expect(source).not.toMatch(/process\.kill/u)
    expect(source).not.toMatch(/spawn/u)
    expect(source).not.toMatch(/child_process/u)
  })
})

describe('票 #80 · AC1/AC5 重启编排：先停后起、同一 home、两次 boot 分开记', () => {
  it('restart 先停旧实例（保留 home）再起新实例，同一 home、两个端口', async () => {
    const { sequence, events, startCalls, stopCalls } = makeBootHarness()
    const first = await sequence.start()
    expect(first.port).toBe(19001)
    expect(sequence.boots).toHaveLength(1)

    const second = await sequence.restart()
    expect(second.port).toBe(19002)
    expect(second.previousPort).toBe(19001)
    expect(second.previousPortClosed).toBe(true)
    expect(events).toEqual(['start:19001', 'stop:19001', 'start:19002'])

    // 两次装配用的是**同一个 home**，且都要求保 home（不是「关浏览器」冒充重启）。
    expect(startCalls).toHaveLength(2)
    for (const call of startCalls) {
      expect(call.home).toBe('C:/home/round-01-t80')
      expect(call.keepHome).toBe(true)
    }
    expect(stopCalls).toEqual([{ port: 19001, keepHome: true, home: 'C:/home/round-01-t80' }])
    expect(sequence.boots).toHaveLength(2)
  })

  it('每次 boot 各落一份开始/停止/时长/端口关闭事实（新进程可从证据里看出来）', async () => {
    const { sequence } = makeBootHarness()
    await sequence.start()
    await sequence.restart()
    const [first, second] = sequence.boots
    expect(first.boot).toBe(1)
    expect(first.port).toBe(19001)
    expect(first.home).toBe('.experience-home/round-01-t80')
    expect(first.startedAt).toBe('2026-11-03T00:00:00.000Z')
    expect(first.stoppedAt).toBe('2026-11-03T00:00:01.000Z')
    expect(first.durationMs).toBe(1_000)
    expect(first.portClosed).toBe(true)

    expect(second.boot).toBe(2)
    expect(second.port).toBe(19002)
    expect(second.startedAt).toBe('2026-11-03T00:00:03.000Z')
    expect(second.stoppedAt).toBeNull()
    expect(second.durationMs).toBeNull()
  })

  it('stopCurrent 幂等：收尾再停一次不会重复停同一个实例', async () => {
    const { sequence, events, stopCalls } = makeBootHarness()
    await sequence.start()
    await sequence.restart()
    const stopped = await sequence.stopCurrent()
    expect(stopped.portClosed).toBe(true)
    expect(events).toEqual(['start:19001', 'stop:19001', 'start:19002', 'stop:19002'])
    expect(sequence.boots[1].stoppedAt).toBe('2026-11-03T00:00:04.000Z')
    expect(sequence.boots[1].durationMs).toBe(1_000)

    await sequence.stopCurrent()
    expect(stopCalls).toHaveLength(2)
    expect(events.at(-1)).toBe('stop:19002')
  })

  it('旧端口没确认关闭时，编排放行但如实记 previousPortClosed=false（判定会记 blocked）', async () => {
    const { sequence } = makeBootHarness({ closed: { 19001: false, 19002: true } })
    await sequence.start()
    const second = await sequence.restart()
    expect(second.previousPortClosed).toBe(false)
    expect(sequence.boots[0].portClosed).toBe(false)
  })

  it('没有实例时 restart 是可读失败（不静默起一个）', async () => {
    const { sequence } = makeBootHarness()
    await expect(sequence.restart()).rejects.toThrow(/没有可重启/u)
  })

  it('restart-boots.json：同 home、两个 boot、端口与时长逐项可查', () => {
    const document = restartBootDocument({
      home: '.experience-home/round-01-t80',
      previousPortClosed: true,
      boots: [
        { boot: 1, port: 19001, home: '.experience-home/round-01-t80', keepHome: true, startedAt: '2026-11-03T00:00:00.000Z', stoppedAt: '2026-11-03T00:00:01.000Z', durationMs: 1000, portClosed: true },
        { boot: 2, port: 19002, home: '.experience-home/round-01-t80', keepHome: true, startedAt: '2026-11-03T00:00:03.000Z', stoppedAt: '2026-11-03T00:00:04.000Z', durationMs: 1000, portClosed: true },
      ],
    })
    expect(document.schema).toBe('xuanshu/experience-restart-boots@1')
    expect(document.bootCount).toBe(2)
    expect(document.sameHome).toBe(true)
    expect(document.distinctPorts).toBe(true)
    expect(document.previousPortClosed).toBe(true)
    expect(document.boots.map((boot) => boot.port)).toEqual([19001, 19002])
    expect(document.boots.every((boot) => boot.durationMs === 1000)).toBe(true)
  })

  it('restart-boots.json：不同 home 时 sameHome=false（不许把两次不同现场说成重启）', () => {
    const document = restartBootDocument({
      home: 'a',
      previousPortClosed: true,
      boots: [
        { boot: 1, port: 19001, home: 'a', startedAt: 't1', stoppedAt: 't2', durationMs: 1, portClosed: true },
        { boot: 2, port: 19002, home: 'b', startedAt: 't3', stoppedAt: 't4', durationMs: 1, portClosed: true },
      ],
    })
    expect(document.sameHome).toBe(false)
  })
})

describe('票 #80 · AC2 认证重新握手：新 token → 新 cookie', () => {
  it('拿到新 origin 的 cookie 且页面已加载 → 握手成功', () => {
    const handshake = describeHandshake({
      port: 19002,
      urlAfterLoad: 'http://127.0.0.1:19002/',
      cookieNames: ['dsh-session'],
      appLoaded: true,
    })
    expect(handshake.succeeded).toBe(true)
    expect(handshake.tokenInUrl).toBe(false)
    expect(handshake.cookieCount).toBe(1)
  })

  it('URL 里 token 还没被消费 → 不算握手完成', () => {
    const handshake = describeHandshake({
      port: 19002,
      urlAfterLoad: 'http://127.0.0.1:19002/?token=abc',
      cookieNames: ['dsh-session'],
      appLoaded: true,
    })
    expect(handshake.tokenInUrl).toBe(true)
  })

  it('没有 cookie 或页面没加载 → 握手失败（不拿「浏览器开着」冒充认证成功）', () => {
    expect(describeHandshake({ port: 19002, urlAfterLoad: 'http://127.0.0.1:19002/', cookieNames: [], appLoaded: true }).succeeded).toBe(false)
    expect(describeHandshake({ port: 19002, urlAfterLoad: 'http://127.0.0.1:19002/', cookieNames: ['dsh-session'], appLoaded: false }).succeeded).toBe(false)
  })

  it('cookie 只记个数，名字与值都不进证据', () => {
    const handshake = describeHandshake({
      port: 19002,
      urlAfterLoad: 'http://127.0.0.1:19002/',
      cookieNames: ['dsh-auth-SECRETNAME'],
      appLoaded: true,
    })
    expect(JSON.stringify(handshake)).not.toContain('SECRETNAME')
    expect(handshake.cookieNames).toBeUndefined()
    expect(handshake.cookieCount).toBe(1)
  })
})

describe('票 #80 · AC3 同一条记录与内容一致', () => {
  const baseMessages = [
    { role: 'system', source: 'xuanshu-consult', text: '【来源：谱 体验-木工】' },
    { role: 'user', source: '', text: RESTART_QUESTION },
    { role: 'assistant', source: '', text: '可以。先安排一次两小时的练习，把工具与木料准备好，再做一次收尾。' },
  ]

  it('同一份记录逐条消息（角色 / 来源 / 文本）一致 → equal=true', () => {
    const comparison = compareRecordContent({ messages: baseMessages }, { messages: baseMessages.map((message) => ({ ...message })) })
    expect(comparison.equal).toBe(true)
    expect(comparison.messageCount).toBe(3)
  })

  it('空白差异不影响一致（阅读器渲染的换行不算内容变化）', () => {
    const comparison = compareRecordContent(
      { messages: baseMessages },
      { messages: baseMessages.map((message) => ({ ...message, text: ` ${message.text.replaceAll(' ', '  ')} ` })) },
    )
    expect(comparison.equal).toBe(true)
  })

  it('少一条 / 文本变了 / 角色变了 → 都不算内容一致', () => {
    expect(compareRecordContent({ messages: baseMessages }, { messages: baseMessages.slice(0, 2) }).equal).toBe(false)
    expect(compareRecordContent({ messages: baseMessages }, { messages: baseMessages.map((message, index) => (index === 2 ? { ...message, text: '换了一句' } : message)) }).equal).toBe(false)
    expect(compareRecordContent({ messages: baseMessages }, { messages: baseMessages.map((message, index) => (index === 2 ? { ...message, role: 'user' } : message)) }).equal).toBe(false)
  })
})

describe('票 #80 · AC4 已落盘会话 vs 未提交草稿：后者缺失不算缺陷', () => {
  it('草稿重启后丢了：承诺是 not-guaranteed，isDefect 永远为 false', () => {
    const boundary = describeDraftBoundary({ typedBeforeRestart: true, retainedAfterRestart: false })
    expect(boundary.promise).toBe('not-guaranteed')
    expect(boundary.typedBeforeRestart).toBe(true)
    expect(boundary.retainedAfterRestart).toBe(false)
    expect(boundary.isDefect).toBe(false)
  })

  it('草稿意外还在：也不构成缺陷（多留不是违约）', () => {
    expect(describeDraftBoundary({ typedBeforeRestart: true, retainedAfterRestart: true }).isDefect).toBe(false)
  })

  it('判定里草稿丢与不丢都不改变 E07 的状态', () => {
    const lost = decideRestartOutcome(restartObservations({ draft: { typedBeforeRestart: true, retainedAfterRestart: false, promise: 'not-guaranteed', isDefect: false } }))
    const kept = decideRestartOutcome(restartObservations({ draft: { typedBeforeRestart: true, retainedAfterRestart: true, promise: 'not-guaranteed', isDefect: false } }))
    expect(lost.status).toBe('pass')
    expect(kept.status).toBe('pass')
  })
})

describe('票 #80 · AC3 判定：找回 / 一致 / 可继续各有归处', () => {
  it('问事面板没打开 → blocked', () => {
    const decision = decideRestartOutcome(restartObservations({ panel: { opened: false, attempts: 3 } }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('面板')
    expectStatus(decision)
  })

  it('新实例没起来 → blocked（重启编排没完成，不记成产品缺陷）', () => {
    const decision = decideRestartOutcome(restartObservations({ boot: { ...restartObservations().boot, secondStarted: false } }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('第二次')
    expectStatus(decision)
  })

  it('两次不是同一个 home → blocked（那是两次不同现场）', () => {
    const decision = decideRestartOutcome(restartObservations({ boot: { ...restartObservations().boot, sameHome: false } }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('home')
    expectStatus(decision)
  })

  it('旧端口没确认关闭 → blocked（不能证明是新进程）', () => {
    const decision = decideRestartOutcome(restartObservations({ boot: { ...restartObservations().boot, previousPortClosed: false } }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('端口')
    expectStatus(decision)
  })

  it('认证没有重新握手成功 → blocked', () => {
    const decision = decideRestartOutcome(restartObservations({ handshake: { succeeded: false, appLoaded: false, tokenInUrl: true, cookieCount: 0, cookieNames: [] } }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('握手')
    expectStatus(decision)
  })

  it('第一段没有产生可找回的记录 → blocked（前置没走完）', () => {
    const decision = decideRestartOutcome(restartObservations({ recorded: { created: false, foundInHistory: false, shortId: '', questionPresent: false, answerPresent: false, terminal: 'error' } }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('记录')
    expectStatus(decision)
  })

  it('第一段的 AI 产物 120s 没出现 → blocked（服务问题，不记成持久化缺陷）', () => {
    const decision = decideRestartOutcome(restartObservations({
      recorded: { ...restartObservations().recorded, answerPresent: false },
    }))
    expect(decision.status).toBe('blocked')
    expect(decision.reason).toContain('120s')
    expectStatus(decision)
  })

  it('重启后历史里找不到那条记录 → fail（跨进程持久化失败）', () => {
    const decision = decideRestartOutcome(restartObservations({ recovered: { ...restartObservations().recovered, found: false } }))
    expect(decision.status).toBe('fail')
    expect(decision.evidence).toContain(RESTART_SHOTS.boot2History)
    expectStatus(decision)
  })

  it('找到的不是同一条（短 id 不同）→ fail', () => {
    const decision = decideRestartOutcome(restartObservations({ recovered: { ...restartObservations().recovered, sameShortId: false } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('同一条')
    expectStatus(decision)
  })

  it('同一条但内容不一致 → fail（不许拿「打开了」冒充内容还在）', () => {
    const decision = decideRestartOutcome(restartObservations({ recovered: { ...restartObservations().recovered, contentEqual: false } }))
    expect(decision.status).toBe('fail')
    expect(decision.evidence).toContain(RESTART_SHOTS.boot2Reader)
    expect(decision.summary).toContain('内容')
    expectStatus(decision)
  })

  it('没有追问入口 → fail', () => {
    const decision = decideRestartOutcome(restartObservations({ continueEntry: { clicked: false, sameSession: false, errorText: '' } }))
    expect(decision.status).toBe('fail')
    expect(decision.summary).toContain('追问')
    expectStatus(decision)
  })

  it('追问入口进不去同一会话 → fail，证据带上产品给的可读原因', () => {
    const decision = decideRestartOutcome(restartObservations({
      continueEntry: {
        clicked: true,
        sameSession: false,
        errorText: '会话已建好（#consult-<id>），但 DSH 会话面板不可用：请在侧栏工作区里打开它。',
      },
    }))
    expect(decision.status).toBe('fail')
    expect(decision.evidence).toContain(RESTART_SHOTS.boot2ContinueError)
    expect(decision.evidence).toContain('DSH 会话面板不可用')
    expectStatus(decision)
  })

  it('找回同一条、内容一致、追问进入同一会话 → pass；证据含 boot 记录与两次取证图', () => {
    const decision = decideRestartOutcome(restartObservations())
    expect(decision.status).toBe('pass')
    expect(decision.evidence).toContain(RESTART_BOOTS_FILE)
    expect(decision.evidence).toContain(RESTART_SHOTS.boot1Reader)
    expect(decision.evidence).toContain(RESTART_SHOTS.boot2Reader)
    expect(decision.summary).toContain('草稿')
    expectStatus(decision)
  })
})

describe('票 #80 · AC6 环境快照与场景附加证据文件', () => {
  it('writeEvidencePack 按场景写死的文件名落附加证据，并拒绝带目录的名字', () => {
    const dir = join(tempDir(), 'task-before')
    const result = writeEvidencePack({
      dir,
      phase: 'task-before',
      environment: fixtureEnvironment('start'),
      environmentEnd: fixtureEnvironment('end'),
      runs: [fixtureRun({ files: { [RESTART_BOOTS_FILE]: { bootCount: 2, sameHome: true } } })],
    })
    const path = join(dir, 'consult-restart', RESTART_BOOTS_FILE)
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ bootCount: 2, sameHome: true })
    expect(result.files).toContain(`consult-restart/${RESTART_BOOTS_FILE}`)

    expect(assertEvidenceFileName('restart-boots.json')).toBe('restart-boots.json')
    expect(() => assertEvidenceFileName('../escape.json')).toThrow(/文件名/u)
    expect(() => assertEvidenceFileName('nested/restart-boots.json')).toThrow(/文件名/u)
    expect(() => assertEvidenceFileName('restart-boots.txt')).toThrow(/\.json/u)
  })

  it('起止两份环境快照仍是两个文件（重启前后各一份，可对比）', () => {
    const dir = join(tempDir(), 'task-before')
    writeEvidencePack({
      dir,
      phase: 'task-before',
      environment: fixtureEnvironment('start', 19001),
      environmentEnd: fixtureEnvironment('end', 19002),
      runs: [fixtureRun()],
    })
    const start = JSON.parse(readFileSync(join(dir, EVIDENCE_FILES.environment), 'utf8'))
    const end = JSON.parse(readFileSync(join(dir, 'environment-end.json'), 'utf8'))
    expect(start.stage).toBe('start')
    expect(end.stage).toBe('end')
    expect(start.instance.port).not.toBe(end.instance.port) // 夹具用两个端口：重启前后可对比
  })
})
