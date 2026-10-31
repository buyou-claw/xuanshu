/**
 * 静态采集器（spec 003 · 票 02 / #49）。
 *
 * 只测「输出形状」与「失败如实」——采集器不判定，所以这里不测 pass/fail
 * （那由 `tests/ux/judge.test.mjs` 覆盖）。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { collectStatic } from '../../scripts/ux/collect/static.mjs'
import { projectCriteria } from '../../scripts/ux/project.mjs'
import { faceManifest } from '../assembly/lib/panel-surface.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const FACES = faceManifest()
const CRITERIA = projectCriteria({ repoRoot: REPO_ROOT, faces: FACES }).document

/** 造一个只含一个源文件的「假仓库 + 假界面面」（用来证明探测器仍有牙）。 */
function plantedRepo(file, text) {
  const root = mkdtempSync(join(tmpdir(), 'ux-collect-plant-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, file), text)
  return { root, face: { id: 'panel:planted', kind: 'panel', label: '植入样本', sources: [file] } }
}

/** 收集到的全部字面色值出现（跨面展开；票 04 起库里还有 T-002..T-004 的证据，这里只看 T-001）。 */
function occurrencesOf(evidence) {
  return evidence
    .filter((item) => item.criterionId === 'T-001' && item.status === 'observed')
    .flatMap((item) => item.facts.occurrences.map((occurrence) => ({ ...occurrence, face: item.face })))
}

describe('票 02 · 静态半边如实点名字面色值', () => {
  it('证据形状统一：criterionId / face / collector / status / facts / evidence 六件齐', () => {
    const { evidence } = collectStatic({ repoRoot: REPO_ROOT, criteria: CRITERIA, faces: FACES })
    expect(evidence.length).toBeGreaterThan(0)
    const staticCriteria = CRITERIA.criteria.filter((criterion) => criterion.check === 'static')
    const criterionIds = new Set(staticCriteria.map((criterion) => criterion.id))
    for (const item of evidence) {
      expect(criterionIds.has(item.criterionId)).toBe(true)
      expect(typeof item.face).toBe('string')
      expect(item.collector).toBe('static')
      expect(item.status).toBe('observed')
      expect(Array.isArray(item.evidence)).toBe(true)
      expect(item.facts).toBeTruthy()
    }
    // 票 04 起：静态判据（T-001..T-004）× 全部界面面，一个 (判据, 面) 一份证据，不重不漏
    expect(evidence).toHaveLength(staticCriteria.length * FACES.length)
  })

  it('清偿后（票 11）：全仓 0 处字面色值；采集器仍然逐个面去采（不是「不采了」）', () => {
    const { evidence } = collectStatic({ repoRoot: REPO_ROOT, criteria: CRITERIA, faces: FACES })
    expect(occurrencesOf(evidence)).toEqual([])
    // 25 个面每个都有一份 T-001 证据（「0 命中」是采出来的，不是没采）
    const t001 = evidence.filter((item) => item.criterionId === 'T-001')
    expect(t001).toHaveLength(FACES.length)
    expect(t001.every((item) => item.status === 'observed')).toBe(true)
  })

  it('判据写的是「字面色值」而不是「hex」：rgb()/rgba() 同样要抓（用植入样本证明探测器没退化成只认 hex）', () => {
    const planted = plantedRepo('src/planted.ts', '.x{background:rgba(0,0,0,.4)}\n')
    const { evidence } = collectStatic({
      repoRoot: planted.root,
      criteria: CRITERIA,
      faces: [planted.face],
    })
    const item = evidence.find((candidate) => candidate.criterionId === 'T-001')
    expect(item.facts.occurrences).toHaveLength(1)
    expect(item.facts.occurrences[0].literal).toBe('rgba(')
  })

  it('一个文件被多个面共用时，每个面各自留下自己的证据（判定按面算，报告按位置去重）', () => {
    // 用植入样本而不是真仓现状：真仓现在已经没有违规了，但「共用文件 → 每面一份证据」这条形状不能丢
    const shared = plantedRepo('src/shared.ts', '.x{color:#fff}\n')
    const faces = [
      { ...shared.face, id: 'slot:shell.overlay#a', kind: 'parasitic', sources: ['src/shared.ts'] },
      { ...shared.face, id: 'slot:shell.overlay#b', kind: 'parasitic', sources: ['src/shared.ts'] },
      { ...shared.face, id: 'slot:shell.overlay#c', kind: 'parasitic', sources: ['src/shared.ts'] },
    ]
    const { evidence } = collectStatic({ repoRoot: shared.root, criteria: CRITERIA, faces })
    const withHits = evidence.filter(
      (item) => item.criterionId === 'T-001' && item.facts.occurrences.length > 0,
    )
    expect(withHits.map((item) => item.face).sort()).toEqual(['slot:shell.overlay#a', 'slot:shell.overlay#b', 'slot:shell.overlay#c'])
    // 三份证据指向同一个 file:line —— 报告的「命中位置」去重后只剩一行
    expect(new Set(withHits.flatMap((item) => item.facts.occurrences.map((occurrence) => `${occurrence.file}:${occurrence.line}`))).size).toBe(1)
  })

  it('只读：采集不写源码（跑完前后文件字节不变）', async () => {
    const { readFileSync } = await import('node:fs')
    const file = join(REPO_ROOT, 'packages/xuanshu-client/src/client/mounts.tsx')
    const before = readFileSync(file)
    collectStatic({ repoRoot: REPO_ROOT, criteria: CRITERIA, faces: FACES })
    expect(readFileSync(file).equals(before)).toBe(true)
  })
})

describe('票 02 · 采集失败必须是独立状态', () => {
  it('源文件读不到 → `collection-failed` 并带原因，不是空 facts', () => {
    const root = mkdtempSync(join(tmpdir(), 'ux-collect-'))
    writeFileSync(join(root, 'unused.txt'), '')
    const { evidence } = collectStatic({
      repoRoot: root,
      criteria: CRITERIA,
      faces: [{ id: 'panel:ghost', kind: 'panel', label: '不存在', sources: ['src/不存在.tsx'] }],
    })
    // 静态判据（T-001..T-004）× 一个面：每条都读同一个不存在的文件，所以四条都得如实报「采集失败」。
    const staticCriteria = CRITERIA.criteria.filter((criterion) => criterion.check === 'static')
    expect(evidence).toHaveLength(staticCriteria.length)
    for (const item of evidence) {
      expect(item.status).toBe('collection-failed')
      expect(item.facts).toBeNull()
      expect(item.reason).toMatch(/ENOENT|no such file/i)
    }
  })

  it('没人给它检查器的机器判据 → 直接报错（不静默跳过）', () => {
    const criteria = {
      label: 'ux-v1',
      version: 'v',
      criteria: [{ id: 'Z-999', family: 'Z', statement: 'x', check: 'static', severity: 'minor', appliesTo: { kind: 'all' } }],
    }
    expect(() => collectStatic({ repoRoot: REPO_ROOT, criteria, faces: FACES })).toThrow(/Z-999/)
    expect(() => collectStatic({ repoRoot: REPO_ROOT, criteria, faces: FACES })).toThrow(/没有检查器/)
  })
})
