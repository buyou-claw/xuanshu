/**
 * 命令面 `pnpm verify:ux`（spec 003 · 票 02 / #49）。
 *
 * 钉住三件事：一条命令能跑完并给数字；判据投影产物过期就**拒绝跑**；
 * 报告同时存在人读与机读两份。
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CRITERIA_FILE, projectCriteria } from '../../scripts/ux/project.mjs'
import { runVerifyUx, VerifyUxError } from '../../scripts/verify-ux.mjs'
import { faceManifest } from '../assembly/lib/panel-surface.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const FACES = faceManifest()

describe('票 02 · 一条命令跑完全链路', () => {
  it('跑完给出兑现率 + 判据集版本号 + 人读/机读两份报告（不落盘模式）', () => {
    const { report, markdown, exitCode, paths } = runVerifyUx({
      repoRoot: REPO_ROOT,
      faces: FACES,
      write: false,
      generatedAt: '2026-10-30T00:00:00.000Z',
    })
    expect(exitCode).toBe(0)
    expect(report.criteria.label).toBe('ux-v1')
    expect(report.criteria.version).toMatch(/^[0-9a-f]{64}$/)
    // 分母 = 判据 × 适用界面面：族 T 四条（票 04）覆盖全部 25 面；D-001（browser）只覆盖 22 个有渲染位置的面
    expect(report.rate.applicable).toBe(4 * FACES.length + FACES.filter((face) => face.slot !== null).length)
    expect(report.rate.passed).toBeLessThan(report.rate.applicable) // 现实里有红
    expect(markdown).toContain('兑现率')
    expect(paths).toEqual({}) // write:false 时一个文件都不写
  })

  it('报告点名「字面色值」的具体位置（人能三秒核回源码）', () => {
    const { report } = runVerifyUx({ repoRoot: REPO_ROOT, faces: FACES, write: false, generatedAt: 'now' })
    expect(report.findings.length).toBeGreaterThan(0)
    for (const finding of report.findings) {
      expect(finding.file).toMatch(/^packages\/xuanshu-client\/src\//)
      expect(finding.line).toBeGreaterThan(0)
    }
    // 去重后的位置数 = 判定失败面 × 证据的去重结果（不是乘积）
    expect(report.findings.length).toBeLessThan(
      report.verdicts.filter((verdict) => verdict.status === 'fail').reduce((sum, verdict) => sum + verdict.evidence.length, 0),
    )
  })

  it('浏览器半边还没实现：如实写「没有浏览器证据」，不装作跑过', () => {
    const { report } = runVerifyUx({ repoRoot: REPO_ROOT, faces: FACES, mode: 'browser', write: false, generatedAt: 'now' })
    expect(report.collection.notes.join('\n')).toContain('浏览器半边尚未实现')
  })
})

describe('票 02 · 判据投影产物过期就拒绝跑', () => {
  /** 造一份「设计稿锚 + rules + criteria.json」都齐的最小仓库，用于测拒绝路径。 */
  function tempRepo({ tamperCriteria = false } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'ux-verify-'))
    mkdirSync(join(root, 'docs/design/ui-v1/shared'), { recursive: true })
    copyFileSync(
      join(REPO_ROOT, 'docs/design/ui-v1/shared/设计token字典.md'),
      join(root, 'docs/design/ui-v1/shared/设计token字典.md'),
    )
    mkdirSync(join(root, 'docs/design/ui-v1/criteria/rules'), { recursive: true })
    copyFileSync(join(REPO_ROOT, 'docs/design/ui-v1/criteria/rules/T.json'), join(root, 'docs/design/ui-v1/criteria/rules/T.json'))
    const faces = [{ id: 'panel:overview', kind: 'panel', label: '自我总览', sources: [] }]
    const projected = projectCriteria({ repoRoot: root, faces })
    writeFileSync(join(root, CRITERIA_FILE), projected.text)
    if (tamperCriteria) {
      // 改判据集里一个字节：模拟「AI 顺手调低了考卷」
      writeFileSync(join(root, CRITERIA_FILE), projected.text.replace('不出现字面色值', '不出现字面色值 '))
    }
    return { root, faces }
  }

  it('投影产物与 rules/ 不一致 → 拒绝跑并说清怎么修（不是笼统报错）', () => {
    const { root, faces } = tempRepo({ tamperCriteria: true })
    expect(() => runVerifyUx({ repoRoot: root, faces, write: false, generatedAt: 'now' })).toThrow(VerifyUxError)
    expect(() => runVerifyUx({ repoRoot: root, faces, write: false, generatedAt: 'now' })).toThrow(/--write|过期/)
  })

  it('投影产物缺失 → 拒绝跑（不允许拿一份没投影过的考卷判分）', () => {
    const { root, faces } = tempRepo()
    rmSync(join(root, CRITERIA_FILE))
    expect(() => runVerifyUx({ repoRoot: root, faces, write: false, generatedAt: 'now' })).toThrow(/不存在/)
  })

  it('一致时能跑：族 T 四条判据 × 一个面 = 4 对分母（这个面没有源文件，四条都无从命中）', () => {
    const { root, faces } = tempRepo()
    const { report } = runVerifyUx({ repoRoot: root, faces, write: false, generatedAt: 'now' })
    expect(report.criteria.count).toBe(4)
    expect(report.rate).toEqual({ passed: 4, applicable: 4, value: 1 })
  })
})

describe('票 02 · 报告落盘（默认模式）', () => {
  it('写到 ux-reports/<时间>/report.{json,md} + latest 指针，机读报告是合法 JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'ux-write-'))
    const { paths } = runVerifyUx({
      repoRoot: REPO_ROOT,
      faces: FACES,
      generatedAt: '2026-10-30T01:02:03.004Z',
      outDir: join(root, 'reports'),
    })
    expect(paths.json).toContain('2026-10-30T01-02-03-004Z')
    const parsed = JSON.parse(readFileSync(paths.json, 'utf8'))
    expect(parsed.schema).toBe('xuanshu/ux-report@1')
    expect(readFileSync(paths.markdown, 'utf8')).toContain('体验质量线巡检报告')
    const latest = JSON.parse(readFileSync(join(root, 'reports/latest.json'), 'utf8'))
    expect(latest.criteria.version).toBe(parsed.criteria.version)
  })
})
