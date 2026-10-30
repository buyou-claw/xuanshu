/**
 * 浏览器半边与视觉档判据（spec 003 · 票 07 / #54）。
 *
 * 覆盖口径（spec §Testing Decisions 第 3 条）：**浏览器侧只留 1 条端到端**——
 * 起隔离实例 → 跑一条剧本 → 拿到证据 → 判定引擎给 verdict。其余场景全部用录制的证据夹具，
 * 不在测试里起浏览器。
 *
 * 端到端那条在拿不到 playwright / 起不来实例时**跳过并写明原因**：
 * 「没采到」不是「通过」，报告里也会照样显示 `not-collected`。
 */
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { D_ASSERTIONS, MIN_TARGET } from '../../scripts/ux/assertions/d.mjs'
import { checkClientArtifact, resolvePlaywright } from '../../scripts/ux/collect/browser.mjs'
import { run as judgeRun } from '../../scripts/ux/judge.mjs'
import { faceManifest } from '../assembly/lib/panel-surface.mjs'
import { runVerifyUx } from '../../scripts/verify-ux.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const FACES = faceManifest()

/** 造一个「产物 vs 源码」可操控的最小仓库。 */
function artifactRepo({ artifactOlderThanSource }) {
  const root = mkdtempSync(join(tmpdir(), 'ux-artifact-'))
  mkdirSync(join(root, 'packages/xuanshu-client/lib'), { recursive: true })
  mkdirSync(join(root, 'packages/xuanshu-client/src/client'), { recursive: true })
  const artifact = join(root, 'packages/xuanshu-client/lib/client.js')
  const source = join(root, 'packages/xuanshu-client/src/client/index.tsx')
  writeFileSync(artifact, '// built\n')
  writeFileSync(source, '// source\n')
  const now = Date.now() / 1000
  utimesSync(source, now - 100, now - 100)
  utimesSync(artifact, artifactOlderThanSource ? now - 200 : now, artifactOlderThanSource ? now - 200 : now)
  return root
}

describe('票 07 · 产物落后于源码就拒绝采集', () => {
  it('源码比产物新 → 不新鲜，并说清「先 build」', () => {
    const root = artifactRepo({ artifactOlderThanSource: true })
    const result = checkClientArtifact({ repoRoot: root })
    expect(result.fresh).toBe(false)
    expect(result.reason).toContain('落后')
    expect(result.reason).toContain('build-client')
  })

  it('产物新于源码 → 新鲜', () => {
    const root = artifactRepo({ artifactOlderThanSource: false })
    expect(checkClientArtifact({ repoRoot: root })).toMatchObject({ fresh: true })
  })

  it('产物不存在 → 不新鲜（不是「没问题」）', () => {
    const root = mkdtempSync(join(tmpdir(), 'ux-artifact-none-'))
    const result = checkClientArtifact({ repoRoot: root })
    expect(result.fresh).toBe(false)
    expect(result.reason).toContain('不存在')
  })

  it('真实仓库此刻是新鲜的（否则任何浏览器采集都该被拒绝）', () => {
    // 这条**必须能红**：src 改了没重建 → 巡检该拒绝采集。它不是「只断言形状」——
    // 那样写等于永不失败。真值由 `pnpm verify:all` 的 `build-client --check` 一起守。
    const result = checkClientArtifact({ repoRoot: REPO_ROOT })
    expect(result.fresh, result.reason ?? '').toBe(true)
  })
})

describe('票 07 · D-001：可点目标 ≥44×44（留白档）', () => {
  it('全部达标 → 通过', () => {
    const judged = D_ASSERTIONS['D-001']({ targets: [{ tag: 'button', label: '好', width: 44, height: 44 }] })
    expect(judged.pass).toBe(true)
  })

  it('有一个 32px 高的按钮 → 红，并点名到具体控件与尺寸', () => {
    const judged = D_ASSERTIONS['D-001']({
      targets: [
        { tag: 'button', label: '立即生成', width: 90, height: 32 },
        { tag: 'button', label: '重试', width: 58, height: 32 },
        { tag: 'button', label: '够大的', width: 120, height: 48 },
      ],
    })
    expect(judged.pass).toBe(false)
    expect(judged.message).toContain('2/3')
    expect(judged.message).toContain('立即生成 90×32')
    expect(judged.message).toContain(`${MIN_TARGET}×${MIN_TARGET}`)
  })

  it('一个目标都没量到 → 红（证据不足不能判过）', () => {
    const judged = D_ASSERTIONS['D-001']({ targets: [] })
    expect(judged.pass).toBe(false)
    expect(judged.message).toContain('没有量到')
  })

  it('录制夹具走同一条判定路径：证据形状与静态半边一致，判定器不区分来源', () => {
    const criteria = {
      label: 'ux-v1',
      version: 'fixture',
      criteria: [
        {
          id: 'D-001',
          family: 'D',
          statement: '可点目标 ≥44×44',
          check: 'browser',
          evidence: 'computed-style',
          severity: 'major',
          appliesTo: { kind: 'rendered' },
          humanReason: null,
          tombstone: false,
        },
      ],
    }
    const recorded = [
      {
        criterionId: 'D-001',
        face: 'panel:overview',
        collector: 'browser',
        status: 'observed',
        facts: { targets: [{ tag: 'button', label: '立即生成', width: 90, height: 32 }] },
        evidence: [],
      },
    ]
    const { verdicts } = judgeRun({ criteria, evidence: recorded, faces: FACES })
    const overview = verdicts.find((verdict) => verdict.face === 'panel:overview')
    expect(overview.status).toBe('fail')
    // 没走到的渲染面是「未采到」，不是通过
    const others = verdicts.filter((verdict) => verdict.face !== 'panel:overview')
    expect(others.every((verdict) => verdict.status === 'not-collected')).toBe(true)
    // 命令面不在 D 族分母里（入口不是渲染面）
    expect(verdicts.some((verdict) => verdict.face.startsWith('command:'))).toBe(false)
  })
})

const hasPlaywright = resolvePlaywright() !== null

describe('票 07 · 唯一条端到端：隔离实例 + 三条剧本（建谱 / 问事 / 藏库）', () => {
  it.skipIf(!hasPlaywright)(
    '起隔离实例 → 走完「建一个谱」→ 拿到浏览器证据 → 判定引擎给出 D-001 verdict',
    async () => {
      const { report, exitCode } = await runVerifyUx({
        repoRoot: REPO_ROOT,
        faces: FACES,
        mode: 'browser',
        write: false,
        generatedAt: '2026-10-31T00:00:00.000Z',
      })
      expect(exitCode).toBe(0)
      // 证据从真浏览器来：默认剧本集是**三条**（票 08 加了问事 / 藏库），所以 D-001 量到的就是
      // 三条剧本走到的四个面；命令面不在其中（入口不是渲染面）。
      const browserVerdicts = report.verdicts.filter((verdict) => verdict.criterionId === 'D-001')
      const observed = browserVerdicts.filter((verdict) => verdict.status === 'pass' || verdict.status === 'fail')
      expect(observed.map((verdict) => verdict.face).sort()).toEqual(['panel:cang', 'panel:consult', 'panel:overview', 'panel:pus'])
      // 报告如实写「没走到那些面」而不是假装通过
      expect(browserVerdicts.filter((verdict) => verdict.status === 'not-collected').length).toBeGreaterThan(0)
      // D-001 至少在一个面上是红（实测：32–39px 的按钮不少），且 message 带尺寸
      const failing = observed.filter((verdict) => verdict.status === 'fail')
      expect(failing.length).toBeGreaterThan(0)
      expect(failing[0].message).toMatch(/\d+×\d+/)
    },
    180_000,
  )

  it('没有 playwright 时，报告必须说清「没有浏览器证据」而不是判成通过', async () => {
    if (hasPlaywright) {
      // 有 playwright 的机器上这条由上面那条端到端覆盖；这里只钉静态模式的诚实口径。
      const { report } = await runVerifyUx({ repoRoot: REPO_ROOT, faces: FACES, write: false, generatedAt: 'now' })
      expect(report.collection.notes.join('\n')).toContain('browser 判据显示为「未采到」')
      return
    }
    const { report } = await runVerifyUx({ repoRoot: REPO_ROOT, faces: FACES, mode: 'browser', write: false, generatedAt: 'now' })
    expect(report.collection.notes.join('\n')).toContain('没有浏览器证据')
  })
})
