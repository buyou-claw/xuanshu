/**
 * `tests/ux/regreen.test.mjs` —— 转绿断言（spec 003 §修复通道 · 票 10 / #57）。
 *
 * 钉住的是一条**迁移**，不是一句话：修复前被点名（`fail`）的每条「判据 × 界面面」，
 * 修复后必须变成 `pass`。看起来「不红了」的三条路都被单独钉住：
 *   - `fail → not-collected`（没采到）不算修好——债只是从量尺下面挪走了；
 *   - `fail → collection-failed`（采集炸了）不算修好——体检坏了不等于界面变好；
 *   - `fail → human-only`（降级给人看）不算修好——让机器闭嘴不是修好；
 *   - 整条 verdict 消失也不算修好——覆盖面缩水不是修复。
 *
 * 另外两条：跨判据集版本直接拒绝（考卷换了谈不上修好）；修复前本来没有红 → 通过且
 * `checked = 0`（没有要转绿的东西，不算失败）。用例全部是构造的 report 对象 / 临时文件，
 * 不起浏览器、不依赖主仓（BRIEF-57 硬约束）。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { REGREEN_SCHEMA, RegreenError, assertRegreened } from '../../scripts/ux/regreen.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO_ROOT, 'scripts', 'ux', 'regreen.mjs')
const VERSION = 'a'.repeat(64)

/** 造一条 verdict（只给判定需要的字段；报告器产物里的其它字段与转绿无关）。 */
function verdict(criterionId, face, status, extra = {}) {
  return { criterionId, face, status, severity: 'major', statement: '一句话判据', message: '', evidence: [], ...extra }
}

/** 造一份巡检报告（转绿断言只吃 `criteria.version` + `verdicts`）。 */
function report(verdicts, version = VERSION) {
  return {
    schema: 'xuanshu/ux-report@1',
    criteria: { label: 'ux-v1', version, count: verdicts.length },
    rate: { passed: 0, applicable: verdicts.length, value: 0 },
    verdicts,
  }
}

/** 期望抛 RegreenError，并把错误交回给用例断言细节。 */
function expectRegreenError(fn) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(RegreenError)
    return error
  }
  throw new Error('期望抛 RegreenError，实际没抛')
}

const made = []
afterEach(() => {
  while (made.length > 0) rmSync(made.pop(), { recursive: true, force: true })
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ux-regreen-'))
  made.push(dir)
  return dir
}

function writeReport(root, relativePath, value) {
  const absolute = join(root, ...relativePath.split('/'))
  mkdirSync(join(absolute, '..'), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** 跑被测 CLI（仓库根只用来解析相对路径，所以 --repo 指到临时目录即可）。 */
function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8' })
}

describe('票 10 · 转绿断言：只有 fail → pass 才算修好', () => {
  it('被点名的判据由红转绿 → 通过，并返回转绿清单', () => {
    const before = report([
      verdict('T-001', 'panel:overview', 'fail'),
      verdict('S-001', 'panel:overview', 'pass'),
    ])
    const after = report([
      verdict('T-001', 'panel:overview', 'pass'),
      verdict('S-001', 'panel:overview', 'pass'),
    ])

    const result = assertRegreened({ before, after })
    expect(result.schema).toBe(REGREEN_SCHEMA)
    expect(result.checked).toBe(1)
    expect(result.regreened).toEqual([{ criterionId: 'T-001', face: 'panel:overview' }])
  })

  it('修完仍是红 → 报错点名「修完仍是红：<判据> <面>」', () => {
    const error = expectRegreenError(() =>
      assertRegreened({
        before: report([verdict('T-001', 'panel:overview', 'fail')]),
        after: report([verdict('T-001', 'panel:overview', 'fail')]),
      }),
    )
    expect(error.kind).toBe('not-regreened')
    expect(error.message).toContain('修完仍是红：T-001 panel:overview')
    expect(error.offenders.map((offender) => offender.kind)).toEqual(['still-red'])
  })

  it('fail → not-collected 不算转绿（没验成不是修好）', () => {
    const error = expectRegreenError(() =>
      assertRegreened({
        before: report([verdict('T-001', 'panel:overview', 'fail')]),
        after: report([verdict('T-001', 'panel:overview', 'not-collected')]),
      }),
    )
    expect(error.message).toContain('not-collected')
    expect(error.message).toContain('不算转绿')
    expect(error.offenders[0].kind).toBe('not-collected')
  })

  it('fail → collection-failed 不算转绿（体检坏了不等于界面变好）', () => {
    const error = expectRegreenError(() =>
      assertRegreened({
        before: report([verdict('T-001', 'panel:overview', 'fail')]),
        after: report([verdict('T-001', 'panel:overview', 'collection-failed')]),
      }),
    )
    expect(error.message).toContain('collection-failed')
    expect(error.offenders[0].kind).toBe('collection-failed')
  })

  it('fail → human-only 不算转绿（把判据降级成人看也不行）', () => {
    const error = expectRegreenError(() =>
      assertRegreened({
        before: report([verdict('T-001', 'panel:overview', 'fail')]),
        after: report([verdict('T-001', 'panel:overview', 'human-only')]),
      }),
    )
    expect(error.message).toContain('human-only')
    expect(error.offenders[0].kind).toBe('human-only')
  })

  it('修复后整条 verdict 消失 → 不算转绿（债不能从量尺下藏起来）', () => {
    const error = expectRegreenError(() =>
      assertRegreened({
        before: report([verdict('T-001', 'panel:overview', 'fail'), verdict('S-001', 'panel:overview', 'pass')]),
        after: report([verdict('S-001', 'panel:overview', 'pass')]),
      }),
    )
    expect(error.message).toContain('消失了')
    expect(error.offenders[0].kind).toBe('disappeared')
  })

  it('一次报出所有没转绿的判据（不是撞到第一条就停）', () => {
    const error = expectRegreenError(() =>
      assertRegreened({
        before: report([
          verdict('T-001', 'panel:a', 'fail'),
          verdict('T-002', 'panel:a', 'fail'),
          verdict('S-001', 'panel:b', 'fail'),
        ]),
        after: report([
          verdict('T-001', 'panel:a', 'pass'),
          verdict('T-002', 'panel:a', 'fail'),
          verdict('S-001', 'panel:b', 'not-collected'),
        ]),
      }),
    )
    expect(error.offenders).toHaveLength(2)
    expect(error.message).toContain('T-002 panel:a')
    expect(error.message).toContain('S-001 panel:b')
  })
})

describe('票 10 · 转绿断言：口径与报告本身要先站得住', () => {
  it('修复前后不是同一版判据集 → 拒绝比较（考卷换了谈不上修好）', () => {
    const error = expectRegreenError(() =>
      assertRegreened({
        before: report([verdict('T-001', 'panel:a', 'fail')], 'a'.repeat(64)),
        after: report([verdict('T-001', 'panel:a', 'pass')], 'b'.repeat(64)),
      }),
    )
    expect(error.message).toContain('同一版判据集')
  })

  it('修复前没有红 → 通过且 checked = 0（没有要转绿的东西）', () => {
    const result = assertRegreened({
      before: report([verdict('T-001', 'panel:a', 'pass')]),
      after: report([verdict('T-001', 'panel:a', 'pass')]),
    })
    expect(result.checked).toBe(0)
    expect(result.regreened).toEqual([])
  })

  it('空 verdicts 不能当基线（没有分母就没有「转绿」）', () => {
    const error = expectRegreenError(() =>
      assertRegreened({ before: report([]), after: report([verdict('T-001', 'panel:a', 'pass')]) }),
    )
    expect(error.message).toContain('空报告')
  })

  it('缺 verdicts / 缺判据集版本 → RegreenError（不是断言红）', () => {
    expect(expectRegreenError(() => assertRegreened({ before: {}, after: report([verdict('T-001', 'panel:a', 'pass')]) })).message)
      .toContain('verdicts')
    const noVersion = { schema: 'xuanshu/ux-report@1', verdicts: [verdict('T-001', 'panel:a', 'fail')] }
    expect(expectRegreenError(() => assertRegreened({ before: noVersion, after: report([verdict('T-001', 'panel:a', 'pass')]) })).message)
      .toContain('criteria.version')
  })
})

describe('票 10 · 转绿断言：报告文件路径与 CLI', () => {
  it('可以给报告文件路径（相对 repoRoot 解析），与对象入参等价', () => {
    const root = tempDir()
    writeReport(root, 'ux-reports/before/report.json', report([verdict('T-001', 'panel:a', 'fail')]))
    writeReport(root, 'ux-reports/after/report.json', report([verdict('T-001', 'panel:a', 'pass')]))

    const result = assertRegreened({
      repoRoot: root,
      before: 'ux-reports/before/report.json',
      after: 'ux-reports/after/report.json',
    })
    expect(result.checked).toBe(1)
    expect(result.regreened).toEqual([{ criterionId: 'T-001', face: 'panel:a' }])
  })

  it('报告文件不存在 → 说清是哪个路径（不是笼统「读不出」）', () => {
    const root = tempDir()
    const error = expectRegreenError(() =>
      assertRegreened({ repoRoot: root, before: 'ux-reports/missing.json', after: report([verdict('T-001', 'panel:a', 'pass')]) }),
    )
    expect(error.message).toContain('ux-reports/missing.json')
  })

  it('CLI：全部转绿 → 0；仍是红 → 1；缺参数 → 2', () => {
    const root = tempDir()
    const beforePass = 'ux-reports/before-pass.json'
    const afterPass = 'ux-reports/after-pass.json'
    writeReport(root, beforePass, report([verdict('T-001', 'panel:a', 'fail')]))
    writeReport(root, afterPass, report([verdict('T-001', 'panel:a', 'pass')]))

    const green = runCli(['--repo', root, '--before', beforePass, '--after', afterPass])
    expect(green.status).toBe(0)
    expect(green.stdout).toContain('✅ 全部转绿')

    const beforeRed = 'ux-reports/before-red.json'
    const afterRed = 'ux-reports/after-red.json'
    writeReport(root, beforeRed, report([verdict('T-001', 'panel:a', 'fail')]))
    writeReport(root, afterRed, report([verdict('T-001', 'panel:a', 'not-collected')]))

    const red = runCli(['--repo', root, '--before', beforeRed, '--after', afterRed])
    expect(red.status).toBe(1)
    expect(red.stderr).toContain('不算转绿')
    expect(red.stderr).toContain('pnpm verify:ux')

    const usage = runCli(['--repo', root, '--before', beforeRed])
    expect(usage.status).toBe(2)
    expect(usage.stderr).toContain('--after')
  })

  it('--help 立出「哪些迁移不算转绿」的口径', () => {
    const help = runCli(['--help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('not-collected')
    expect(help.stdout).toContain('不算转绿')
  })
})
