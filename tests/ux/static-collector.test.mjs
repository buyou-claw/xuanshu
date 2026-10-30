/**
 * 静态采集器（spec 003 · 票 02 / #49）。
 *
 * 只测「输出形状」与「失败如实」——采集器不判定，所以这里不测 pass/fail
 * （那由 `tests/ux/judge.test.mjs` 覆盖）。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { collectStatic } from '../../scripts/ux/collect/static.mjs'
import { projectCriteria } from '../../scripts/ux/project.mjs'
import { faceManifest } from '../assembly/lib/panel-surface.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const FACES = faceManifest()
const CRITERIA = projectCriteria({ repoRoot: REPO_ROOT, faces: FACES }).document

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

  it('11 处字面 hex（mounts.tsx 9 + WorkflowPanel 2）——spec 里那个数字是 hex 口径', () => {
    const { evidence } = collectStatic({ repoRoot: REPO_ROOT, criteria: CRITERIA, faces: FACES })
    const hex = occurrencesOf(evidence).filter((occurrence) => occurrence.literal.startsWith('#'))
    const files = [...new Set(hex.map((occurrence) => occurrence.file))]
    expect(hex).toHaveLength(11)
    expect(files.sort()).toEqual([
      'packages/xuanshu-client/src/client/mounts.tsx',
      'packages/xuanshu-client/src/client/workflow/WorkflowPanel.tsx',
    ])
    expect(hex.filter((occurrence) => occurrence.file.endsWith('mounts.tsx'))).toHaveLength(9)
    expect(hex.filter((occurrence) => occurrence.file.endsWith('WorkflowPanel.tsx'))).toHaveLength(2)
  })

  it('判据写的是「字面色值」而不是「hex」：rgb()/rgba() 同样点名（禁则原文就是这么写的）', () => {
    const { evidence } = collectStatic({ repoRoot: REPO_ROOT, criteria: CRITERIA, faces: FACES })
    const functions = occurrencesOf(evidence).filter((occurrence) => !occurrence.literal.startsWith('#'))
    expect(functions.length).toBeGreaterThan(0)
    for (const occurrence of functions) expect(occurrence.literal).toMatch(/^(rgb|rgba|hsl|hsla)\($/)
  })

  it('一个文件被多个面共用时，每个面各自留下自己的证据（判定按面算，报告按位置去重）', () => {
    const { evidence } = collectStatic({ repoRoot: REPO_ROOT, criteria: CRITERIA, faces: FACES })
    const sedimentFaces = evidence.filter(
      (item) =>
        item.criterionId === 'T-001'
        && item.status === 'observed'
        && item.facts.occurrences.some((occurrence) => occurrence.file.endsWith('sediment-views.tsx')),
    )
    expect(sedimentFaces.map((item) => item.face).sort()).toEqual([
      'slot:conversation.chat.turnTail#xuanshu.sediment-draft',
      'slot:conversation.composer.dock#xuanshu.sediment-entry',
      'slot:shell.overlay#xuanshu.sediment-notice',
    ])
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
