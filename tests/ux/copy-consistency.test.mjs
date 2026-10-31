/**
 * 票 19 / #67（UX-05）· 同一状态一套说法：五个面的 X-001 收口。
 *
 * 这一票修的是**已经在报告里红着的五个面**，所以用例直接对着真仓跑，不摆夹具：
 *   - `panel:rikke` / `panel:wansheng`：加载态说了「读取中」，族字典只允许「正在…」「…中」；
 *   - `panel:workflow` / `slot:settings.section#xuanshu.shiji` /
 *     `slot:conversation.composer.dock#xuanshu.shiji-entry`：错误行只说「失败了」，没有下一步。
 *
 * 四条用例各自钉一件事：
 *   1. **判据层**：五面 X-001 由 `collectStatic` + `judge` 真跑一遍，逐面 pass（不靠改断言凑绿）；
 *   2. **文案层**：四个源文件的**代码行**（注释已剥）里没有任何禁用词，且新说法原样在位；
 *   3. **下一步**：三个错误面在「错误行 ±6 行」内真的有一个动作词（重试 / 重新 / 换个 / 请在…）；
 *   4. **一处文案两处绿**：事记的两个面共用同一份源文件 —— 谁把它拆成两份各写一套，这条先红。
 *
 * 口径只有一份：词表从 `scripts/ux/state-vocabulary.mjs` import，本文件不复制、不改写它。
 */
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ASSERTIONS } from '../../scripts/ux/assertions/index.mjs'
import { collectStatic } from '../../scripts/ux/collect/static.mjs'
import { createSourceCache } from '../../scripts/ux/collect/source-cache.mjs'
import { run as judgeRun } from '../../scripts/ux/judge.mjs'
import { probeFor } from '../../scripts/ux/probes/index.mjs'
import { scanFace } from '../../scripts/ux/probes/state-scan.mjs'
import { projectCriteria } from '../../scripts/ux/project.mjs'
import { BANNED_WORDING, STATES, codeLinesOf } from '../../scripts/ux/state-vocabulary.mjs'
import { faceManifest } from '../assembly/lib/panel-surface.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const FACES = faceManifest()
const CRITERIA = projectCriteria({ repoRoot: REPO_ROOT, faces: FACES }).document

/** 本票碰的四个源文件（事记只有一份，同时喂两个面）。 */
const TOUCHED_FILES = [
  'packages/xuanshu-client/src/client/rikke.tsx',
  'packages/xuanshu-client/src/client/wansheng.tsx',
  'packages/xuanshu-client/src/client/workflow/WorkflowPanel.tsx',
  'packages/xuanshu-client/src/client/shiji-views.tsx',
]

/** 验收点名的五个面。 */
const TARGET_FACES = [
  'panel:rikke',
  'panel:wansheng',
  'panel:workflow',
  'slot:settings.section#xuanshu.shiji',
  'slot:conversation.composer.dock#xuanshu.shiji-entry',
]

/** 三个「有错误行」的面：错误行旁边必须有出路。 */
const ERROR_FACES = [
  'panel:workflow',
  'slot:settings.section#xuanshu.shiji',
  'slot:conversation.composer.dock#xuanshu.shiji-entry',
]

/** 真跑一次全仓静态半边，返回 `criterionId × face` 的 verdict 表。 */
function audit() {
  const collected = collectStatic({ repoRoot: REPO_ROOT, criteria: CRITERIA, faces: FACES })
  const judged = judgeRun({ criteria: CRITERIA, evidence: collected.evidence, faces: FACES })
  const byKey = new Map()
  for (const verdict of judged.verdicts) byKey.set(`${verdict.criterionId}@${verdict.face}`, verdict)
  return byKey
}

/** 一个界面面的源码扫描结果（X 族的证据口径）。 */
function scanOf(faceId) {
  const face = FACES.find((candidate) => candidate.id === faceId)
  expect(face, `面清单里没有 ${faceId}`).toBeTruthy()
  const cache = createSourceCache({ repoRoot: REPO_ROOT })
  return { face, scan: probeFor({ id: 'X-001', check: 'static' })({ face, read: cache.read, repoRoot: REPO_ROOT, faces: FACES }) }
}

describe('票 19 · X-001 在五个面上转绿', () => {
  const verdicts = audit()

  for (const faceId of TARGET_FACES) {
    it(`${faceId}：说法一致 + 错误行有下一步`, () => {
      const verdict = verdicts.get(`X-001@${faceId}`)
      expect(verdict, `X-001 没有判到 ${faceId}`).toBeTruthy()
      // 红的理由原样带出来（报告里的那句），省得改的人再去翻 ux-reports。
      expect(verdict.status, verdict.message).toBe('pass')
      // 通过时的证据是「用到的那套说法」；不许还挂着一条「说法不一致 / 没有下一步」。
      expect(verdict.message).toContain('说法一致')
      expect(verdict.evidence.every((item) => !item.detail.includes('没有可执行的下一步'))).toBe(true)
    })
  }
})

describe('票 19 · 四个源文件的代码行里不许有禁用词', () => {
  it('注释剥掉之后，代码行里一个禁用词都不剩（词表唯一来源是 state-vocabulary.mjs）', () => {
    const hits = []
    for (const path of TOUCHED_FILES) {
      const file = createSourceCache({ repoRoot: REPO_ROOT }).read(path)
      for (const { line, code } of codeLinesOf(file)) {
        for (const state of STATES) {
          for (const word of BANNED_WORDING[state]) {
            if (code.includes(word)) hits.push(`${path}:${line} ${word}`)
          }
        }
      }
    }
    expect(hits).toEqual([])
  })

  it('加载态改成「正在读…」：日课说日课、晚省说晚省（不是换个同义词糊过去）', () => {
    const cache = createSourceCache({ repoRoot: REPO_ROOT })
    const rikke = cache.read('packages/xuanshu-client/src/client/rikke.tsx').text
    const wansheng = cache.read('packages/xuanshu-client/src/client/wansheng.tsx').text
    expect(rikke).toContain('正在读日课…')
    expect(wansheng).toContain('正在读晚省…')
  })
})

describe('票 19 · 错误行必须有可执行的下一步', () => {
  for (const faceId of ERROR_FACES) {
    it(`${faceId}：错误在场，且 ±6 行内有动作词`, () => {
      const { scan } = scanOf(faceId)
      expect(scan.facts.errorPresent, `${faceId} 没有错误行，用例的前提不成立`).toBe(true)
      expect(
        scan.facts.errorActionable.count,
        `${faceId} 的错误行旁边没有出路（重试 / 重新 / 换个 / 请在…）`,
      ).toBeGreaterThan(0)
    })
  }
})

describe('票 19 · 事记一处文案两处绿', () => {
  it('两个面登记的是同一份源文件（拆成两份各写一套 = 这条先红）', () => {
    const settings = FACES.find((face) => face.id === 'slot:settings.section#xuanshu.shiji')
    const entry = FACES.find((face) => face.id === 'slot:conversation.composer.dock#xuanshu.shiji-entry')
    expect(settings.sources).toEqual(['packages/xuanshu-client/src/client/shiji-views.tsx'])
    expect(entry.sources).toEqual(settings.sources)
  })

  it('两个面的错误行各自有出路（同一份文件里两处，不是只补一处）', () => {
    const cache = createSourceCache({ repoRoot: REPO_ROOT })
    const face = FACES.find((candidate) => candidate.id === 'slot:settings.section#xuanshu.shiji')
    const scan = scanFace(face, cache.read)
    // 入口条（`没有存成…`）与设置分区（`读不到事记设置…` 等）是两行两条出路：
    // 判据只要求「至少一处在场」，只补一处也能骗绿 —— 这条钉住两处都点得到。
    const lines = [...new Set(scan.errorActionable.samples.map((hit) => `${hit.file}:${hit.line}`))]
    expect(lines.length).toBeGreaterThanOrEqual(2)
  })
})

describe('票 19 · 判定谓词没有被放宽', () => {
  it('X-001 仍然把禁用词与「错误行没下一步」判红（改文案不许顺手动判据）', () => {
    expect(ASSERTIONS['X-001']({
      wordingCount: 1,
      violations: [{ state: 'loading', token: '读取中', file: 'a.tsx', line: 1 }],
      errorPresent: false,
      errorActionable: { count: 0 },
      perState: {},
    }).pass).toBe(false)
    expect(ASSERTIONS['X-001']({
      wordingCount: 2,
      violations: [],
      errorPresent: true,
      errorActionable: { count: 0 },
      perState: {},
    }).pass).toBe(false)
  })
})
