/**
 * 判据族 T（票 04 / #51 建立，票 11 / #58 清偿后重写）。
 *
 * 这个文件在票 11 之后**换了口径**：清偿前它钉「12 个注入点 / 9 处字面断点 / 15 处字面色值」，
 * 清偿后那些数字应当全部归零。归零的断言本身很容易变成「什么都没验」，所以每条都配一个
 * **植入式反证**：往临时源文件里放一个违规，探测器必须仍然红。没有反证的「0」不算证据。
 *
 * 仍钉住的事：
 *   1. 四条判据的 id / 严重级 / 检查方式不变，且每条都追得回 `§0.4 禁则`；
 *   2. 全仓现状：字面色值 0 / 注入点 1（`styles.ts` 的单一消费层）/ 字面断点 0 / 非 token 颜色声明 0；
 *   3. 探测器在植入违规时仍然报红（T-001 / T-002 / T-003 / T-004 各一条）；
 *   4. 采集器不判定、谓词不读文件（本仓 review 的硬线）。
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { T_ASSERTIONS } from '../../scripts/ux/assertions/t.mjs'
import { collectStatic } from '../../scripts/ux/collect/static.mjs'
import { run } from '../../scripts/ux/judge.mjs'
import { projectCriteria, readNormalizedText } from '../../scripts/ux/project.mjs'
import { T_PROBES } from '../../scripts/ux/probes/t.mjs'
import { faceManifest } from '../assembly/lib/panel-surface.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const FACES = faceManifest()
const CRITERIA = projectCriteria({ repoRoot: REPO_ROOT, faces: FACES }).document
const COLLECTED = collectStatic({ repoRoot: REPO_ROOT, criteria: CRITERIA, faces: FACES })
const JUDGED = run({ criteria: CRITERIA, evidence: COLLECTED.evidence, faces: FACES })

function evidenceOf(criterionId) {
  return COLLECTED.evidence.filter((item) => item.criterionId === criterionId)
}

function factsOf(criterionId, face) {
  const item = evidenceOf(criterionId).find((candidate) => candidate.face === face)
  expect(item, `${criterionId} 没有 ${face} 的证据`).toBeTruthy()
  return item.facts
}

function verdictsOf(criterionId) {
  return JUDGED.verdicts.filter((verdict) => verdict.criterionId === criterionId)
}

function redFacesOf(criterionId) {
  return verdictsOf(criterionId)
    .filter((verdict) => verdict.status === 'fail')
    .map((verdict) => verdict.face)
    .sort()
}

/** 造一个只含一个源文件的「假界面面」，用来证明探测器仍有牙。 */
function plantedFace({ file = 'src/planted.ts', text }) {
  const root = mkdtempSync(join(tmpdir(), 'ux-t-plant-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, file), text)
  const read = (relative) => {
    const source = readFileSync(join(root, relative), 'utf8').replace(/\r\n/g, '\n')
    return { path: relative, text: source, lines: source.split('\n') }
  }
  const face = { id: 'panel:planted', kind: 'panel', label: '植入样本', sources: [file] }
  return { face, read, faces: [face] }
}

describe('票 04 · 判据集：族 T 四条，每条都追得回 §0.4 禁则', () => {
  it('id / 严重级 / 检查方式不变（T-001 仍是 blocker）', () => {
    const familyT = CRITERIA.criteria.filter((criterion) => criterion.family === 'T')
    expect(familyT.map((criterion) => [criterion.id, criterion.severity, criterion.check])).toEqual([
      ['T-001', 'blocker', 'static'],
      ['T-002', 'major', 'static'],
      ['T-003', 'major', 'static'],
      ['T-004', 'major', 'static'],
    ])
    for (const criterion of familyT) expect(criterion.evidence).toBe('file-line')
  })

  it('每条判据的锚都落在 `设计token字典.md` §0.4 禁则那一节里（追不到的判据不许进判据集）', () => {
    const dictionary = readNormalizedText(join(REPO_ROOT, 'docs/design/ui-v1/shared/设计token字典.md'))
    const start = dictionary.indexOf('### 0.4 禁则（写稿人自查）')
    expect(start).toBeGreaterThan(-1)
    const end = dictionary.indexOf('\n---', start)
    const section = dictionary.slice(start, end === -1 ? undefined : end)
    for (const criterion of CRITERIA.criteria.filter((candidate) => candidate.family === 'T')) {
      expect(readNormalizedText(join(REPO_ROOT, criterion.source.file))).toContain(criterion.source.anchor)
      expect(section, `${criterion.id} 的锚不在 §0.4 禁则里`).toContain(criterion.source.anchor)
    }
  })
})

describe('票 11 · 清偿后的真实数字：T 族全绿', () => {
  it('T-001：全仓 0 处字面色值（15 → 0）', () => {
    const occurrences = evidenceOf('T-001').flatMap((item) => item.facts.occurrences)
    expect(occurrences).toEqual([])
    expect(redFacesOf('T-001')).toEqual([])
  })

  it('T-002：界面面自己不再注入样式（12 → 0 面内注入点），全仓只剩 `styles.ts` 一处消费层', () => {
    const repo = factsOf('T-002', 'panel:overview').repo
    // 面内口径：各面的源文件里一个注入点都没有（全仓那一处 `styles.ts` 不属于任何面 —— 它是消费层）
    expect(repo.total).toBe(0)
    expect(redFacesOf('T-002')).toEqual([])
    expect(verdictsOf('T-002')).toHaveLength(FACES.length)
    // 全仓口径：真的是「一处」而不是「没有」（否则归零只是因为没人注入样式了）
    const clientSources = [
      'styles.ts', 'style.ts', 'bestof-style.ts', 'bazi-style.ts', 'cang-style.ts', 'data-style.ts',
      'digao-style.ts', 'rikke-style.ts', 'consult.tsx', 'mounts.tsx', 'PuPanel.tsx',
      'sediment-views.tsx', 'shiji-views.tsx', 'workflow/WorkflowPanel.tsx',
    ].map((name) => readNormalizedText(join(REPO_ROOT, 'packages/xuanshu-client/src/client', name)))
    const withCreation = clientSources.filter((source) => /document\.createElement\(\s*['"]style['"]\s*\)/.test(source))
    expect(withCreation).toHaveLength(1)
    expect(withCreation[0]).toBe(clientSources[0])
  })

  it('T-003：0 处字面断点（9 → 0），断点只从 `breakpoints.ts` 来', () => {
    const repo = factsOf('T-003', 'panel:overview').repo
    expect(repo.total).toBe(0)
    expect(redFacesOf('T-003')).toEqual([])
    const breakpoints = readNormalizedText(join(REPO_ROOT, 'packages/xuanshu-client/src/client/breakpoints.ts'))
    expect(breakpoints).toContain('BREAKPOINT_WIDE_PX')
    expect(breakpoints).toContain("--xs-size-breakpoint-wide")
  })

  it('T-004：0 处非 token 颜色声明（8 → 0）', () => {
    const repo = factsOf('T-004', 'panel:overview').repo
    expect(repo.literal).toBe(0)
    expect(redFacesOf('T-004')).toEqual([])
  })

  it('`--dsw-alias-*` 的消费事实仍可数（票 04 的「全仓仅 4 处」是旧数字，这里只钉「事实在场且可数」）', () => {
    const facts = factsOf('T-004', 'panel:overview')
    // 事实字段名就是 `alias`（`probes/t.mjs:347`）；写成 `?? 兜底` 会让这条断言永远真空转。
    expect(facts.alias).toBeTruthy()
    expect(typeof facts.alias.sites).toBe('number')
    expect(facts.alias.sites).toBeGreaterThan(0)
    expect(Array.isArray(facts.alias.tokens)).toBe(true)
    for (const verdict of verdictsOf('T-004')) expect(verdict.status).toBe('pass')
  })
})

describe('票 11 · 植入式反证：归零不是把探测器关掉', () => {
  it('T-001 还能抓：`color:#fff` 一放就红', () => {
    const planted = plantedFace({ text: '.x{color:#fff}\n' })
    const collected = T_PROBES['T-001'](planted)
    expect(collected.facts.occurrences).toHaveLength(1)
    expect(T_ASSERTIONS['T-001'](collected.facts).pass).toBe(false)
  })

  it('T-002 还能抓：多一个 `createElement(\'style\')` 就红', () => {
    const planted = plantedFace({ text: 'export function installPlantedStyle(){ const style = document.createElement(\'style\'); document.head.appendChild(style) }\n' })
    const collected = T_PROBES['T-002'](planted)
    expect(collected.facts.repo.total).toBe(1)
    expect(T_ASSERTIONS['T-002'](collected.facts).pass).toBe(false)
  })

  it('T-003 还能抓：`@media(max-width: 900px)` 一放就红', () => {
    const planted = plantedFace({ text: '@media(max-width: 900px){.x{display:none}}\n' })
    const collected = T_PROBES['T-003'](planted)
    expect(collected.facts.repo.total).toBe(1)
    expect(T_ASSERTIONS['T-003'](collected.facts).pass).toBe(false)
  })

  it('T-004 还能抓：`background:#123456` 一放就红', () => {
    const planted = plantedFace({ text: '.x{background:#123456}\n' })
    const collected = T_PROBES['T-004'](planted)
    expect(collected.facts.repo.literal).toBe(1)
    expect(T_ASSERTIONS['T-004'](collected.facts).pass).toBe(false)
  })

  it('`var(--xs-…)` 与允许的关键字不算违规（否则「全绿」只能靠改判据拿到）', () => {
    const planted = plantedFace({ text: '.x{color:var(--xs-text-body);background:transparent;border:0}\n' })
    const collected = T_PROBES['T-004'](planted)
    expect(collected.facts.repo.literal).toBe(0)
    expect(T_ASSERTIONS['T-004'](collected.facts).pass).toBe(true)
  })
})

describe('票 04 · 采集器不判定、谓词不读文件（本仓 review 的硬线）', () => {
  it('采集器源码里没有 pass / fail 判定词', () => {
    const probeSource = readFileSync(join(REPO_ROOT, 'scripts/ux/probes/t.mjs'), 'utf8')
    expect(probeSource).not.toMatch(/\bpass\s*:/)
    expect(probeSource).not.toMatch(/\bpass\s*=/)
  })

  it('谓词源码里没有文件系统 / 时钟依赖', () => {
    const assertionSource = readFileSync(join(REPO_ROOT, 'scripts/ux/assertions/t.mjs'), 'utf8')
    expect(assertionSource).not.toMatch(/from 'node:fs'/)
    expect(assertionSource).not.toMatch(/Date\.now\(/)
  })

  it('单条判据红时 message 说得清「哪种违规、几处、在哪」', () => {
    const judged = T_ASSERTIONS['T-001']({ occurrences: [{ file: 'a.ts', line: 2, literal: '#fff' }], scannedFiles: 1 })
    expect(judged.pass).toBe(false)
    expect(judged.message).toContain('a.ts:2')
    expect(judged.message).toContain('#fff')
  })
})
