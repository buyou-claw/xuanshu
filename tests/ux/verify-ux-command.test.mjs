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

import { writeFreeze } from '../../scripts/ux/freeze.mjs'
import { CRITERIA_FILE, projectCriteria } from '../../scripts/ux/project.mjs'
import { runVerifyUx, VerifyUxError } from '../../scripts/verify-ux.mjs'
import { faceManifest } from '../assembly/lib/panel-surface.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const FACES = faceManifest()

describe('票 02 · 一条命令跑完全链路', () => {
  it('跑完给出兑现率 + 判据集版本号 + 人读/机读两份报告（不落盘模式）', async () => {
    const { report, markdown, exitCode, paths } = await runVerifyUx({
      repoRoot: REPO_ROOT,
      faces: FACES,
      write: false,
      generatedAt: '2026-10-30T00:00:00.000Z',
    })
    expect(exitCode).toBe(0)
    expect(report.criteria.label).toBe('ux-v1')
    expect(report.criteria.version).toMatch(/^[0-9a-f]{64}$/)
    // 分母 = 判据 × 适用界面面；判据数与各族 scope 会随票增长，所以钉「分母 = verdict 行数」这条不变式
    // （一条 verdict 就是一对 (判据, 面)，没有一行被悄悄丢掉）。
    expect(report.rate.applicable).toBe(report.verdicts.filter((verdict) => verdict.status !== 'human-only').length)
    expect(report.rate.applicable).toBeGreaterThan(FACES.length)
    expect(report.rate.passed).toBeLessThan(report.rate.applicable) // 现实里有红
    expect(markdown).toContain('兑现率')
    expect(paths).toEqual({}) // write:false 时一个文件都不写
  })

  it('报告点名「字面色值」的具体位置（人能三秒核回源码）', async () => {
    const { report } = await runVerifyUx({ repoRoot: REPO_ROOT, faces: FACES, write: false, generatedAt: 'now' })
    // 前提变了（2026-10-31）：静态红被清干净之后，真仓库此刻的 `findings` 可以是 0
    // （T 族本来就绿、S/X 已全绿、C/D/N 走浏览器落在 not-collected）。
    // 所以不能拿「至少有一条」当前提。这里守两个不变式：
    //   · 没有红的时候，不许凭空造出位置；
    //   · 有红的时候，每个位置都点得回源码、同一个位置只出现一次。
    if (report.findings.length === 0) {
      expect(report.verdicts.filter((verdict) => verdict.status === 'fail')).toEqual([])
      return
    }
    for (const finding of report.findings) {
      expect(finding.file).toMatch(/^packages\/xuanshu-client\/src\//)
      expect(finding.line).toBeGreaterThan(0)
    }
    // 去重后的位置数 ≤ 各失败面的证据条数之和（去重只会变少，不会变多）。
    //
    // 这里曾经写的是「严格小于」，隐含前提是「至少有一处重复」。红清到只剩三条、
    // 每条失败面各带一行证据时，`findings` 与证据总数都等于 3 —— 严格小于不成立，
    // 而那并不是缺陷（没有可去重的东西）。所以改成守住真正的不变式：
    //   · 每个位置只出现一次（去重真的发生了）；
    //   · 位置数不超过证据总数（没有凭空造出的位置）。
    const positions = report.findings.map((finding) => `${finding.file}:${finding.line}`)
    expect(new Set(positions).size).toBe(positions.length)
    expect(report.findings.length).toBeLessThanOrEqual(
      report.verdicts.filter((verdict) => verdict.status === 'fail').reduce((sum, verdict) => sum + verdict.evidence.length, 0),
    )
  })

  it('只跑静态半边时如实写「browser 判据未采到」，不装作跑过', async () => {
    const { report } = await runVerifyUx({ repoRoot: REPO_ROOT, faces: FACES, write: false, generatedAt: 'now' })
    expect(report.collection.notes.join('\n')).toContain('browser 判据显示为「未采到」')
    // 未采到 ≠ 通过：D-001 这一轮全部落在 not-collected 里，不进 pass
    const browserVerdicts = report.verdicts.filter((verdict) => verdict.criterionId === 'D-001')
    expect(browserVerdicts.length).toBeGreaterThan(0)
    expect(browserVerdicts.every((verdict) => verdict.status === 'not-collected')).toBe(true)
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
    // 巡检启动先校验冻结值（票 03 / #50）：夹具也得先冻一次，否则测的就不是本组要测的那条路径。
    writeFreeze({ repoRoot: root, frozenAt: '2026-10-30T00:00:00.000Z', approvedBy: 'fixture' })
    if (tamperCriteria) {
      // 改判据集里一个字节：模拟「AI 顺手调低了考卷」
      writeFileSync(join(root, CRITERIA_FILE), projected.text.replace('不出现字面色值', '不出现字面色值 '))
    }
    return { root, faces }
  }

  it('投影产物与 rules/ 不一致 → 拒绝跑并说清怎么修（不是笼统报错）', async () => {
    const { root, faces } = tempRepo({ tamperCriteria: true })
    await expect(runVerifyUx({ repoRoot: root, faces, write: false, generatedAt: 'now' })).rejects.toThrow(VerifyUxError)
    await expect(runVerifyUx({ repoRoot: root, faces, write: false, generatedAt: 'now' })).rejects.toThrow(/--write|过期/)
  })

  it('投影产物缺失 → 拒绝跑（不允许拿一份没投影过的考卷判分）', async () => {
    const { root, faces } = tempRepo()
    rmSync(join(root, CRITERIA_FILE))
    await expect(runVerifyUx({ repoRoot: root, faces, write: false, generatedAt: 'now' })).rejects.toThrow(/不存在/)
  })

  it('一致时能跑：族 T 四条判据 × 一个面 = 4 对分母（这个面没有源文件，四条都无从命中）', async () => {
    const { root, faces } = tempRepo()
    const { report } = await runVerifyUx({ repoRoot: root, faces, write: false, generatedAt: 'now' })
    expect(report.criteria.count).toBe(4)
    expect(report.rate).toEqual({ passed: 4, applicable: 4, value: 1 })
  })
})

describe('票 02 · 报告落盘（默认模式）', () => {
  it('写到 ux-reports/<时间>/report.{json,md} + latest 指针，机读报告是合法 JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ux-write-'))
    const { paths } = await runVerifyUx({
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
