/**
 * 票 UX-06 / #68 · 两个抽屉补三态（藏库抽屉的空态 + 两个抽屉的错误态）。
 *
 * 这份用例守的是**真仓实测**，不是夹具：判据族 S / X 的采集口径（`state-vocabulary.mjs`
 * 文件头）写死了一条 —— 「同一个源文件里既有该状态的分支、又有一句人话」才算有这个态。
 * 于是这条票的验收可以逐字落成断言：
 *
 *   1. S-001 在 `slot:shell.overlay#xuanshu-cang-drawer` 上在场（空态：分支 + 「还没有…」）；
 *   2. S-003 在同一个面上在场（错误态：分支 + 「读不到 / 失败」+ 可执行的下一步）；
 *   3. S-003 在 `slot:shell.overlay#xuanshu-mounts-drawer` 上在场（同上）；
 *   4. 三处文案都只说词表允许的那一套（X-001 的 `CANONICAL_WORDING` / `BANNED_WORDING`）。
 *
 * 为什么钉在采集器 + 判定器这道缝上：`verify:ux` 跑的就是这两步（`collectStatic` → `judge`），
 * 在它上面断言等于「巡检会绿」，而不是「我觉得文案挺好」。
 *
 * 反面：`{error}` 原样吐出来 = 有分支没说法 —— 那正是这张票要修的，所以第 2/3 条还断言
 * 「错误行 ±6 行内有动作词」，否则随便补一句「失败了」就能让它绿。
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ASSERTIONS } from '../../scripts/ux/assertions/index.mjs'
import { createSourceCache } from '../../scripts/ux/collect/source-cache.mjs'
import { probeFor } from '../../scripts/ux/probes/index.mjs'
import { faceManifest } from '../assembly/lib/panel-surface.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const FACES = faceManifest()
const READ = createSourceCache({ repoRoot: REPO_ROOT }).read

const CANG_DRAWER = 'slot:shell.overlay#xuanshu-cang-drawer'
const MOUNTS_DRAWER = 'slot:shell.overlay#xuanshu-mounts-drawer'
const CANG_DRAWER_FILE = 'packages/xuanshu-client/src/client/CangDrawer.tsx'
const MOUNTS_VIEWS_FILE = 'packages/xuanshu-client/src/client/mounts-views.tsx'

/** 取一个界面面（清单里没有就直接失败 —— 面被改名比断言悄悄失效好）。 */
function faceOf(faceId) {
  const face = FACES.find((row) => row.id === faceId)
  if (face === undefined) throw new Error(`面清单里没有 ${faceId}`)
  return face
}

/** 跑一条静态判据的采集器（与 `verify:ux` 同一个入口）。 */
function probe(criterionId, faceId) {
  return probeFor({ id: criterionId, check: 'static' })({ face: faceOf(faceId), read: READ })
}

describe('票 68 · 藏库抽屉缺空态（S-001）', () => {
  it('同一个源文件里既有空态分支、也有一句「还没有…」—— 判绿且证据落在 CangDrawer.tsx', () => {
    const { facts, evidence } = probe('S-001', CANG_DRAWER)
    const verdict = ASSERTIONS['S-001'](facts)

    expect(verdict.pass, verdict.message).toBe(true)
    expect(facts.filesWithBoth).toEqual([CANG_DRAWER_FILE])
    expect(facts.visual.count).toBeGreaterThan(0)

    // 说法要落在词表的「还没有…」上：空态不许用「暂无 / 空的 / 无记录」那套同义替换。
    const emptyLines = evidence.filter((item) => item.detail.includes('空态说明'))
    expect(emptyLines.length).toBeGreaterThan(0)
    for (const item of emptyLines) expect(item.detail).toContain('还没有')
  })
})

describe('票 68 · 藏库抽屉缺错误态（S-003 + X-001 的下一步）', () => {
  it('同一个源文件里既有错误分支、也有一句「读不到 / 失败」，且旁边有可执行的下一步', () => {
    const { facts, evidence } = probe('S-003', CANG_DRAWER)
    const verdict = ASSERTIONS['S-003'](facts)

    expect(verdict.pass, verdict.message).toBe(true)
    expect(facts.filesWithBoth).toEqual([CANG_DRAWER_FILE])

    // 说人话：不是把 `error` 变量原样吐出来就算数。
    const errorLines = evidence.filter((item) => item.detail.includes('错误态说明'))
    expect(errorLines.length).toBeGreaterThan(0)
    for (const item of errorLines) expect(item.detail).toMatch(/读不到|打不开|失败|不可用/u)

    // 下一步与文案口径（X-001 的两条子句）：错误行 ±6 行内要有动作词，说法要在词表里。
    const wording = probe('X-001', CANG_DRAWER).facts
    expect(wording.violations).toEqual([])
    expect(wording.perState.error.canonicalCount).toBeGreaterThan(0)
    expect(wording.errorActionable.count, '错误行旁边没有下一步（重试 / 换个 / 请检查…）').toBeGreaterThan(0)
  })
})

describe('票 68 · 挂载账本抽屉缺错误态（S-003 + X-001 的下一步）', () => {
  it('同一个源文件里既有错误分支、也有一句「读不到 / 失败」，且旁边有可执行的下一步', () => {
    const { facts, evidence } = probe('S-003', MOUNTS_DRAWER)
    const verdict = ASSERTIONS['S-003'](facts)

    expect(verdict.pass, verdict.message).toBe(true)
    // 抽屉本体在 `mounts-views.tsx`（视图只渲染 props）：说法必须和分支落在同一个文件里。
    expect(facts.filesWithBoth).toContain(MOUNTS_VIEWS_FILE)

    const errorLines = evidence.filter((item) => item.detail.includes('错误态说明'))
    expect(errorLines.length).toBeGreaterThan(0)
    for (const item of errorLines) expect(item.detail).toMatch(/读不到|打不开|失败|不可用/u)

    const wording = probe('X-001', MOUNTS_DRAWER).facts
    expect(wording.violations).toEqual([])
    expect(wording.perState.error.canonicalCount).toBeGreaterThan(0)
    expect(wording.errorActionable.count, '错误行旁边没有下一步（重试 / 换个 / 请检查…）').toBeGreaterThan(0)
  })
})
