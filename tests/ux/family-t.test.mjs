/**
 * 判据族 T 的第二批（票 04 / #51）：token 消费与样式注入点。
 *
 * 钉住四件事：
 *   1. 三条新判据（T-002 注入点 / T-003 断点 / T-004 颜色声明）的**事实**与源码对得上
 *      ——12 个注入点、9 处字面断点、8 处非 token 颜色声明，每个数字都能点回 `file:line`；
 *   2. 判定只按**本面**的事实算（跨面聚合只用来把话说得有数据，不参与通过与否）；
 *   3. `--dsw-alias-*` 的消费事实有数据支撑（票 04 点名「全仓仅 4 处」这条口径已过时，
 *      真实数字写进 message，逐处可核）；
 *   4. 采集器不判定、谓词不读文件（本仓 review 的硬线）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { T_ASSERTIONS } from '../../scripts/ux/assertions/t.mjs'
import { collectStatic } from '../../scripts/ux/collect/static.mjs'
import { run } from '../../scripts/ux/judge.mjs'
import { projectCriteria, readNormalizedText } from '../../scripts/ux/project.mjs'
import { buildReport } from '../../scripts/ux/report.mjs'
import { faceManifest } from '../assembly/lib/panel-surface.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const FACES = faceManifest()
const CRITERIA = projectCriteria({ repoRoot: REPO_ROOT, faces: FACES }).document
const COLLECTED = collectStatic({ repoRoot: REPO_ROOT, criteria: CRITERIA, faces: FACES })
const JUDGED = run({ criteria: CRITERIA, evidence: COLLECTED.evidence, faces: FACES })

/** 某条判据的全部证据（每条 = 判据 × 界面面）。 */
function evidenceOf(criterionId) {
  return COLLECTED.evidence.filter((item) => item.criterionId === criterionId)
}

/** 某条判据在某个面上的 facts（报告里那条 red 的原始事实）。 */
function factsOf(criterionId, face) {
  const item = evidenceOf(criterionId).find((candidate) => candidate.face === face)
  expect(item, `${criterionId} 没有 ${face} 的证据`).toBeTruthy()
  return item.facts
}

/** 某条判据的全部判定。 */
function verdictsOf(criterionId) {
  return JUDGED.verdicts.filter((verdict) => verdict.criterionId === criterionId)
}

/** 某条判据被判红（fail）的界面面，字典序。 */
function redFacesOf(criterionId) {
  return verdictsOf(criterionId)
    .filter((verdict) => verdict.status === 'fail')
    .map((verdict) => verdict.face)
    .sort()
}

/** 源码里的一行（1 起算），用来证明 `file:line` 不是编的。 */
function sourceLine(file, line) {
  const text = readFileSync(join(REPO_ROOT, file), 'utf8').replace(/\r\n/g, '\n')
  return text.split('\n')[line - 1] ?? ''
}

describe('票 04 · 判据集：族 T 补齐到四条，每条都追得回 §0.4 禁则', () => {
  it('id / 严重级 / 检查方式与票 04 口径一致（T-001 不动）', () => {
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
    expect(section.length).toBeGreaterThan(0)

    for (const criterion of CRITERIA.criteria.filter((candidate) => candidate.family === 'T')) {
      // 锚确实在它自己声明的文件里（投影器也校验这条，这里再钉一次防手改）
      expect(readNormalizedText(join(REPO_ROOT, criterion.source.file))).toContain(criterion.source.anchor)
      // 而且落在 §0.4 这一节——判据不是从别的章节借来的
      expect(section, `${criterion.id} 的锚不在 §0.4 禁则里`).toContain(criterion.source.anchor)
    }
  })
})

describe('票 04 · T-002 样式注入点：12 个点、按共享度排序、每条可点回源码', () => {
  it('跨面去重后 12 个注入点 / 12 份文件（7 个 *-style.ts + 5 处就地注入的实际口径见报告）', () => {
    const facts = factsOf('T-002', 'panel:overview')
    expect(facts.repo.faces).toBe(FACES.length)
    expect(facts.repo.total).toBe(12)
    expect(facts.repo.files).toBe(12)
    expect(facts.repo.points).toHaveLength(12)
    // 12 份文件各一个注入点：同一个文件注入两次会被算成两个点（没有被漏掉的文件）
    expect(new Set(facts.repo.points.map((point) => point.file)).size).toBe(12)
  })

  it('每个点都能点回源码那一行的 `createElement(\'style\')`，符号是最近的外层函数', () => {
    const points = factsOf('T-002', 'panel:overview').repo.points
    for (const point of points) {
      expect(sourceLine(point.file, point.line), `${point.file}:${point.line}`).toContain("createElement('style')")
      expect(point.symbol).toMatch(/^install[A-Za-z]+$|^\(module\)$/)
    }
    // 12 个函数名互不相同（同一份样式被两个函数各注入一次才算「各写各的」）
    expect(new Set(points.map((point) => point.symbol)).size).toBe(12)
  })

  it('共享度 = 有多少个界面面把这份文件列进了 sources；清单按共享度降序', () => {
    const points = factsOf('T-002', 'panel:overview').repo.points
    for (const point of points) {
      expect(point.sharedBy).toBe(FACES.filter((face) => face.sources.includes(point.file)).length)
    }
    const shared = points.map((point) => point.sharedBy)
    expect([...shared].sort((left, right) => right - left)).toEqual(shared)
    // 最重的三处：说法与票 04 的验收一致（3 面 / 2 面 / 2 面）
    expect(points.slice(0, 3).map((point) => [point.file.split('/').pop(), point.symbol, point.sharedBy])).toEqual([
      ['sediment-views.tsx', 'installSedimentStyle', 3],
      ['cang-style.ts', 'installCangStyle', 2],
      ['shiji-views.tsx', 'installShijiStyle', 2],
    ])
  })

  it('判定：16 个界面面各自有一处注入点 → 红；没有注入点的面通过（分母仍是 25）', () => {
    const reds = redFacesOf('T-002')
    expect(reds).toHaveLength(16)
    expect(reds).toContain('panel:overview')
    expect(reds).toContain('panel:pus')
    expect(reds).toContain('slot:shell.overlay#xuanshu-mounts-drawer')
    expect(reds).toContain('slot:conversation.chat.turnTail#xuanshu.sediment-draft')
    expect(reds).not.toContain('panel:onboarding')
    expect(verdictsOf('T-002')).toHaveLength(FACES.length)
    expect(verdictsOf('T-002').filter((verdict) => verdict.status === 'pass')).toHaveLength(FACES.length - 16)
    for (const verdict of verdictsOf('T-002')) expect(verdict.message).toContain('12')
  })

  it('判定只按本面算：跨面有 12 个注入点，但空源文件的面仍然是 pass（跨面事实不参与通过与否）', () => {
    const judged = T_ASSERTIONS['T-002']({
      injections: [],
      repo: { faces: 25, total: 12, files: 12, points: [{ file: 'x.ts', line: 1, symbol: 'installX', sharedBy: 3 }] },
    })
    expect(judged.pass).toBe(true)
    expect(T_ASSERTIONS['T-002']({ injections: [{ file: 'x.ts', line: 1, symbol: 'installX', sharedBy: 1 }], repo: { total: 0, points: [] } }).pass).toBe(false)
  })
})

describe('票 04 · T-003 断点：9 处字面 px，全部点回源码', () => {
  it('跨面 9 处：1100px ×7（等于 token 值但仍是字面）、700px ×2（字典里没有这个断点）', () => {
    const facts = factsOf('T-003', 'panel:overview')
    expect(facts.token).toEqual({ name: '--xs-size-breakpoint-wide', value: '1100px' })
    expect(facts.repo.total).toBe(9)
    expect(facts.repo.byValue).toEqual([
      { value: '1100px', count: 7 },
      { value: '700px', count: 2 },
    ])
    expect(facts.repo.files).toBe(8)
  })

  it('每个字面断点那一行真的是 `@media` + 宽度特征；`prefers-reduced-motion` 不算断点', () => {
    const hits = evidenceOf('T-003').flatMap((item) => item.evidence)
    const unique = [...new Map(hits.map((hit) => [`${hit.file}:${hit.line}`, hit])).values()]
    expect(unique).toHaveLength(9)
    for (const hit of unique) {
      const line = sourceLine(hit.file, hit.line)
      expect(line).toContain('@media')
      expect(line).toMatch(/(?:min|max)-width\s*:/)
    }
    // style.ts 的 `@media (prefers-reduced-motion: reduce)` 不是断点，不被点名
    const overview = factsOf('T-003', 'panel:overview')
    expect(overview.breakpoints).toEqual([
      { file: 'packages/xuanshu-client/src/client/style.ts', line: 63, feature: 'min-width', value: '1100px' },
    ])
    expect(unique.some((hit) => hit.file.endsWith('style.ts') && hit.line === 254)).toBe(false)
  })

  it('判定：11 个界面面各带字面断点 → 红；message 点名词典里的语义权威', () => {
    const reds = redFacesOf('T-003')
    expect(reds).toHaveLength(11)
    expect(reds).toContain('panel:cang')
    expect(reds).toContain('panel:pus')
    expect(reds).not.toContain('panel:workflow') // WorkflowPanel 没有 @media
    for (const verdict of verdictsOf('T-003')) {
      expect(verdict.message).toContain('--xs-size-breakpoint-wide')
    }
    const cang = verdictsOf('T-003').find((verdict) => verdict.face === 'panel:cang')
    expect(cang.message).toContain('700px')
    expect(cang.message).toContain('没有对应断点')
  })
})

describe('票 04 · T-004 颜色声明：8 处没从 token 取 + `--dsw-alias-*` 消费事实', () => {
  it('跨面 240 处颜色声明里 8 处字面值；`border: 0` 这类不主张颜色的声明不计入', () => {
    const facts = factsOf('T-004', 'panel:overview')
    expect(facts.repo).toEqual({ declarations: 240, literal: 8 })
    // panel:overview（style.ts）自己的账：50 处、45 token、4 关键字、0 字面、1 不主张颜色
    expect(facts.summary).toEqual({ total: 50, token: 45, keyword: 4, literal: 0, nonColor: 1 })

    const hits = evidenceOf('T-004').flatMap((item) => item.evidence)
    const unique = [...new Map(hits.map((hit) => [`${hit.file}:${hit.line}`, hit])).values()]
    expect(unique).toHaveLength(8)
    for (const hit of unique) {
      const line = sourceLine(hit.file, hit.line)
      expect(line).toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|rgb\(/)
      expect(line).not.toMatch(/\bborder(?:-bottom)?\s*:\s*0\b/)
    }
  })

  it('`--dsw-alias-*` 全仓消费 12 处 / 3 个文件 / 9 个 token（spec 的「4 处」已过时，逐处可核）', () => {
    const facts = factsOf('T-004', 'panel:overview')
    expect(facts.alias.sites).toBe(12)
    expect(facts.alias.unreadable).toEqual([])
    expect(facts.alias.byFile).toEqual([
      { file: 'packages/xuanshu-client/src/client/PuPanel.tsx', sites: 6 },
      { file: 'packages/xuanshu-client/src/client/mounts.tsx', sites: 5 },
      { file: 'packages/xuanshu-client/src/client/style.ts', sites: 1 },
    ])
    expect(facts.alias.tokens.map((token) => token.name)).toEqual([
      '--dsw-alias-accent',
      '--dsw-alias-bg',
      '--dsw-alias-bg-canvas',
      '--dsw-alias-bg-surface',
      '--dsw-alias-border',
      '--dsw-alias-border-danger',
      '--dsw-alias-border-default',
      '--dsw-alias-brand-primary',
      '--dsw-alias-text-primary',
    ])
    // 每个数字都能在源码里数出来：三个文件的 `var(--dsw-alias-` 出现次数
    for (const entry of facts.alias.byFile) {
      const text = readFileSync(join(REPO_ROOT, entry.file), 'utf8')
      expect(text.match(/var\(\s*--dsw-alias-/g) ?? []).toHaveLength(entry.sites)
    }
  })

  it('判定：7 个界面面各带非 token 颜色声明 → 红；message 点名 `--dsw-alias-*` 的真实数字', () => {
    const reds = redFacesOf('T-004')
    expect(reds).toHaveLength(7)
    expect(reds).toContain('slot:shell.overlay#xuanshu-mounts-drawer')
    expect(reds).toContain('slot:shell.overlay#xuanshu-bestof-overlay')
    expect(reds).not.toContain('panel:overview')
    for (const verdict of verdictsOf('T-004').filter((candidate) => candidate.status === 'fail')) {
      expect(verdict.message).toContain('--dsw-alias-*')
      expect(verdict.message).toContain('12 处')
      expect(verdict.message).toContain('3 个文件')
    }
  })

  it('判定只按本面算：全仓 8 处字面值，但本面没有 → pass（跨面事实不参与通过与否）', () => {
    const facts = { declarations: [], summary: { total: 3, token: 3, keyword: 0, literal: 0, nonColor: 0 }, alias: { sites: 12, byFile: [], tokens: [], unreadable: [] }, repo: { declarations: 240, literal: 8 } }
    expect(T_ASSERTIONS['T-004'](facts).pass).toBe(true)
    const red = T_ASSERTIONS['T-004']({ ...facts, declarations: [{ file: 'x.ts', line: 1, property: 'color', value: '#fff' }], summary: { ...facts.summary, token: 2, literal: 1 } })
    expect(red.pass).toBe(false)
    expect(red.message).toContain('--dsw-alias-*')
  })
})

describe('票 04 · 报告与硬约定', () => {
  it('报告里四条判据的命中位置可点回源码：T-001 15 / T-002 12 / T-003 9 / T-004 8（去重后）', () => {
    const report = buildReport({ criteria: CRITERIA, faces: FACES, verdicts: JUDGED.verdicts, generatedAt: 'now' })
    const countOf = (criterionId) => report.findings.filter((finding) => finding.criterionId === criterionId).length
    expect(countOf('T-001')).toBe(15)
    expect(countOf('T-002')).toBe(12)
    expect(countOf('T-003')).toBe(9)
    expect(countOf('T-004')).toBe(8)
    for (const finding of report.findings) {
      expect(finding.line).toBeGreaterThan(0)
      expect(finding.detail.length).toBeGreaterThan(0)
      expect(() => sourceLine(finding.file, finding.line)).not.toThrow()
    }
  })

  it('三条新谓词是纯函数：同一份 facts 两跑同结果，且不读文件、不读时钟', () => {
    for (const criterionId of ['T-002', 'T-003', 'T-004']) {
      const facts = factsOf(criterionId, 'panel:overview')
      const first = T_ASSERTIONS[criterionId](facts)
      const second = T_ASSERTIONS[criterionId](structuredClone(facts))
      expect(second).toEqual(first)
      expect(typeof first.pass).toBe('boolean')
    }
    const source = readFileSync(join(REPO_ROOT, 'scripts/ux/assertions/t.mjs'), 'utf8')
    expect(source).not.toMatch(/from 'node:fs'/)
    expect(source).not.toMatch(/Date\.now\(/)
  })

  it('采集器不做判定：probes/t.mjs 里没有 pass / fail 字样，也不读子进程', () => {
    const source = readFileSync(join(REPO_ROOT, 'scripts/ux/probes/t.mjs'), 'utf8')
    expect(source).not.toMatch(/\b(?:pass|fail)\b/i)
    expect(source).not.toMatch(/from 'node:(?:fs|child_process)'/)
  })

  it('证据形状统一：每条命中都带 file / line / detail（报告不用猜位置）', () => {
    for (const criterionId of ['T-002', 'T-003', 'T-004']) {
      for (const item of evidenceOf(criterionId)) {
        expect(item.status).toBe('observed')
        for (const hit of item.evidence) {
          expect(hit.file).toMatch(/^packages\/xuanshu-client\/src\//)
          expect(hit.line).toBeGreaterThan(0)
          expect(hit.detail.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('分母不缩水：族 T 四条 × 25 个界面面 = 100 份静态证据，红绿都有、没有「未采到」', () => {
    const tEvidence = COLLECTED.evidence.filter((item) => item.criterionId.startsWith('T-'))
    const tVerdicts = JUDGED.verdicts.filter((verdict) => verdict.criterionId.startsWith('T-'))
    expect(tEvidence).toHaveLength(4 * FACES.length)
    expect(tVerdicts).toHaveLength(4 * FACES.length)
    for (const verdict of tVerdicts) expect(['pass', 'fail']).toContain(verdict.status)
    expect(JUDGED.counts['collection-failed']).toBe(0)
    expect(tVerdicts.filter((verdict) => verdict.status === 'fail')).toHaveLength(42)
    expect(tVerdicts.filter((verdict) => verdict.status === 'pass')).toHaveLength(58)
  })
})
