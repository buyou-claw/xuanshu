/**
 * tests/experience/run-e2e.test.mjs —— 实操 runner 的**唯一一条**浏览器端到端（票 #77 标准 9）。
 *
 * 它与 `run-cli.test.mjs` 的分工（ADR-0017 · Testing Decisions）：
 *   - 本文件只证明「一条命令真的能把一条任务跑完、并把证据落对」，**不证明** E01 的产品结论；
 *   - 场景判定、证据包形状、错误归类的全部分支都在 `run-cli.test.mjs` 用录制夹具跑同一条路径，
 *     **不在测试里起浏览器**。所以这里只留 1 条 `it`——多一条就要多起一次实例（15–40s/次）。
 *
 * 断言的都是**外部可观察物**：退出码、证据包里的文件与内容、stderr 上的「正在等什么」、
 * 以及进程退出后端口是否真的不可连（「不留无人管理的进程」的判定方式，票面标准 1）。
 *
 * 拿不到 playwright / 起不来实例时**跳过并写明原因**：没有浏览器证据时不许判成通过
 * （照 `tests/ux/browser-collector.test.mjs` 的口径）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { COVERAGE_STATUSES, EVIDENCE_FILES, STEP_FIELDS } from '../../scripts/experience/evidence.mjs'
import { resolvePlaywright } from '../../scripts/ux/collect/browser.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const RUN_SCRIPT = join(REPO_ROOT, 'scripts', 'experience', 'run.mjs')
const ENVIRONMENT_END_FILE = 'environment-end.json'

/** 本测试自己的证据落点（`ux-reports/` 是 gitignore 的产物目录；这一层是本文件拥有的）。 */
const OUT = 'ux-reports/experience-e2e'
const OUT_ABS = join(REPO_ROOT, 'ux-reports', 'experience-e2e')
const PHASE = 'run-cli'
const PHASE_ABS = join(OUT_ABS, PHASE)

const hasPlaywright = resolvePlaywright() !== null

/** 每条用例自己起的临时 home（E01 的前提就是「空 home、未配模型」）。 */
const homes = []
afterAll(() => {
  for (const home of homes) {
    try { rmSync(home, { recursive: true, force: true }) } catch { /* 临时目录留着不致命 */ }
  }
})

/** 跑一次真 CLI，边跑边收 stderr（「正在等什么」正是断言对象之一）。 */
function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUN_SCRIPT, ...args], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

/** 端口还连不连得上（从**测试进程**这一侧探，不采信 runner 的自述）。 */
function portAnswers(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(1_000, () => { socket.destroy(); resolve(true) })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

describe('票 #77 · 唯一条端到端：一条命令跑完 E01 并落完整证据包', () => {
  it.skipIf(!hasPlaywright)(
    '起实例 → 走真实入口 → 落证据包 → 退出后端口不可连、体验 home 还在',
    async () => {
      // 0. 干净起点：本测试自己的证据目录先清掉（旧报告留着会让「这一次写了什么」说不清）。
      rmSync(OUT_ABS, { recursive: true, force: true })
      const home = mkdtempSync(join(tmpdir(), 'xuanshu-exp-e2e-'))
      homes.push(home)

      // 1. 一条命令（票面标准 1）；home 用临时目录保证「空 home、未配模型」这个前提成立。
      const { code, stdout, stderr } = await runCli([
        '--scenario', 'consult-no-model',
        '--out', OUT,
        '--phase', PHASE,
        '--home', home,
      ])
      if (code !== 0 && code !== 3) {
        throw new Error(`runner 退出码 ${code}（证据目录 ${PHASE_ABS}）：\n${stderr.slice(-2000)}\n${stdout.slice(-1000)}`)
      }

      // 2. 固定文件名一件不少（票面标准 2）。
      for (const name of [EVIDENCE_FILES.environment, ENVIRONMENT_END_FILE, EVIDENCE_FILES.coverage, EVIDENCE_FILES.steps, EVIDENCE_FILES.errors, EVIDENCE_FILES.findings]) {
        expect(existsSync(join(PHASE_ABS, name)), name).toBe(true)
      }
      const scenarioDir = join(PHASE_ABS, 'consult-no-model')
      for (const name of [EVIDENCE_FILES.steps, EVIDENCE_FILES.errors, EVIDENCE_FILES.trace]) {
        expect(existsSync(join(scenarioDir, name)), name).toBe(true)
      }
      expect(statSync(join(scenarioDir, EVIDENCE_FILES.trace)).size).toBeGreaterThan(1_000)

      // 3. 覆盖表：E01 一行，状态在词表内，且**指向证据或理由**——不许是空的通过。
      const coverage = JSON.parse(readFileSync(join(PHASE_ABS, EVIDENCE_FILES.coverage), 'utf8'))
      expect(coverage.cases).toHaveLength(1)
      const [row] = coverage.cases
      expect(row.caseId).toBe('E01')
      expect(COVERAGE_STATUSES).toContain(row.status)
      if (row.status === 'pass' || row.status === 'fail') expect(row.evidence).toBeTruthy()
      else expect(row.reason).toBeTruthy()
      // 退出码与覆盖表一致：pass 与非 pass 不能报同一个码
      expect(code).toBe(row.status === 'pass' ? 0 : 3)

      // 4. 步骤行：闭集字段、没有绝对路径、每张被引用的截图真的存在（票面标准 2/6）。
      const lines = readFileSync(join(PHASE_ABS, EVIDENCE_FILES.steps), 'utf8').trimEnd().split('\n').filter((line) => line !== '')
      expect(lines.length).toBeGreaterThanOrEqual(4)
      const shots = []
      for (const line of lines) {
        const step = JSON.parse(line)
        for (const key of Object.keys(step)) expect(STEP_FIELDS).toContain(key)
        expect(JSON.stringify(step)).not.toMatch(/[A-Za-z]:[\\/]/u) // 绝对路径不进报告
        if (step.shot !== undefined) shots.push(step.shot)
      }
      expect(shots.length).toBeGreaterThanOrEqual(4)
      for (const shot of shots) {
        expect(existsSync(join(scenarioDir, shot)), shot).toBe(true)
        expect(statSync(join(scenarioDir, shot)).size).toBeGreaterThan(1_000)
      }
      // 场景子目录里除固定三件外，就是这些截图（不多不少，说明没替谁补图）
      const files = readdirSync(scenarioDir).sort()
      expect(files).toEqual([...new Set([...shots, EVIDENCE_FILES.steps, EVIDENCE_FILES.errors, EVIDENCE_FILES.trace])].sort())

      // 5. 执行期间持续报告「正在等什么」（票面标准 7）。
      const waiting = stderr.split('\n').filter((line) => line.includes('正在等'))
      expect(waiting.length).toBeGreaterThanOrEqual(3)

      // 6. 环境快照起止各一份，且带着实例 home / port 与源码 SHA（票面标准 2）。
      const start = JSON.parse(readFileSync(join(PHASE_ABS, EVIDENCE_FILES.environment), 'utf8'))
      const end = JSON.parse(readFileSync(join(PHASE_ABS, ENVIRONMENT_END_FILE), 'utf8'))
      expect(start.stage).toBe('start')
      expect(end.stage).toBe('end')
      expect(start.source.sha).toMatch(/^[0-9a-f]{40}$/u)
      expect(start.instance.port).toBeGreaterThan(0)
      expect(start.instance.url).toContain('<redacted>') // token 不进报告
      expect(start.probe.ready).toBe(true)
      expect(start.probe.launch.launched).toBe(true) // 「解析到」不等于「启动成功」，两个都要有

      // 7. 退出后不留无人管理的进程：runner 自述的端口已关 **且** 测试自己连不上（票面标准 1）。
      expect(end.instance.shutdown.portClosed).toBe(true)
      expect(await portAnswers(start.instance.port)).toBe(false)

      // 8. 体验 home 不被 runner 删掉（票面标准 8：清理是人显式发起的事）。
      expect(existsSync(home)).toBe(true)

      // 9. 错误文档只留最小字段（本轮的现场可能一条都没有，形状仍然要对）。
      const errors = JSON.parse(readFileSync(join(PHASE_ABS, EVIDENCE_FILES.errors), 'utf8'))
      expect(errors).toHaveProperty('total')
      for (const rows of [errors.console, errors.page, errors.requestFailed, errors.http]) {
        for (const errorRow of rows) {
          expect(Object.keys(errorRow).every((key) => ['kind', 'message', 'step'].includes(key))).toBe(true)
        }
      }
    },
    180_000,
  )

  it('没有 playwright 时这条线不跑、也不假装跑过；有 playwright 时留下的必须是真判定', async () => {
    // 与上一条同文件但**不起浏览器**：钉的是「缺件时不许判成通过」这个口径。
    if (!hasPlaywright) {
      // 没有浏览器就没有证据：先清掉本文件拥有的证据目录，避免上一轮的旧报告冒充这一轮。
      rmSync(OUT_ABS, { recursive: true, force: true })
      const home = mkdtempSync(join(tmpdir(), 'xuanshu-exp-e2e-'))
      homes.push(home)

      // 真跑一次 CLI：它必须在启动浏览器之前就承认缺件（退出码 2），而不是写一份 pass。
      const { code, stdout, stderr } = await runCli([
        '--scenario', 'consult-no-model',
        '--out', OUT,
        '--phase', PHASE,
        '--home', home,
      ])
      expect(code, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(2)
      // 覆盖表根本没写：没有浏览器证据时不许出现任何 pass 行（「未采到 ≠ 通过」）。
      expect(existsSync(join(PHASE_ABS, EVIDENCE_FILES.coverage))).toBe(false)
      return
    }

    // 有 playwright 时，上一条必须留下「真的跑过」的判定：覆盖表存在，且每一行都落在
    // pass / fail / blocked 里——不是 `not-collected` 那种「没采到」冒充结论。
    const coverage = JSON.parse(readFileSync(join(PHASE_ABS, EVIDENCE_FILES.coverage), 'utf8'))
    expect(coverage.cases.length).toBeGreaterThan(0)
    for (const row of coverage.cases) {
      expect(['pass', 'fail', 'blocked']).toContain(row.status)
    }
    expect(coverage.totals.pass + coverage.totals.fail + coverage.totals.blocked).toBe(coverage.cases.length)
  })
})
