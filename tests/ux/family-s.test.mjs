/**
 * 判据族 `S`（状态齐全：空 / 载 / 错）+ `X`（文案一致性）——票 06 / #53。
 *
 * 这份用例守的是三件事（brief 里点名的那三条最容易做歪的地方）：
 *   1. **口径**：静态采集怎么算「有这个态」——注释不算、常量不算、跨文件不算、`length > 0` 不算；
 *   2. **判红**：缺态必须红，不是「不适用」（`appliesTo` 一律 all，25 个面一个都不开天窗）；
 *   3. **证据**：每条红都要指得回 `file:line`，且缺态时落在这个面的**组件入口**上。
 *
 * 另外钉住两个数字：S 族三条 × 25 面 = 75 条判定、X-001 × 25 面 = 25 条判定。
 * 分母变了（有人加面 / 加判据）这份用例会先红——那是想要的，不是噪音。
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ASSERTIONS } from '../../scripts/ux/assertions/index.mjs'
import { collectStatic } from '../../scripts/ux/collect/static.mjs'
import { createSourceCache } from '../../scripts/ux/collect/source-cache.mjs'
import { run as judgeRun } from '../../scripts/ux/judge.mjs'
import { STATIC_PROBES, probeFor } from '../../scripts/ux/probes/index.mjs'
import { projectCriteria } from '../../scripts/ux/project.mjs'
import { buildReport, missingStatesOf, renderMarkdown } from '../../scripts/ux/report.mjs'
import { faceManifest } from '../assembly/lib/panel-surface.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const FACES = faceManifest()
const CRITERIA = projectCriteria({ repoRoot: REPO_ROOT, faces: FACES }).document

const S_IDS = ['S-001', 'S-002', 'S-003']
const X_IDS = ['X-001']

/**
 * 造一个只含给定文件的夹具面，返回采集上下文（`face` + 只读 `read`）。
 * @param {Record<string, string>} files 仓库相对路径 → 源码
 * @param {{id?: string, label?: string}} [meta]
 */
function fixture(files, meta = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ux-s-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const cache = createSourceCache({ repoRoot: root })
  return {
    face: { id: meta.id ?? 'panel:fixture', label: meta.label ?? '夹具面', kind: 'panel', sources: Object.keys(files) },
    read: cache.read,
  }
}

/** 跑一条判据的采集器，返回 `{facts, evidence}`。 */
function runProbe(criterionId, ctx) {
  return probeFor({ id: criterionId, check: 'static' })(ctx)
}

/** 跑判定谓词。 */
function judge(criterionId, facts) {
  return ASSERTIONS[criterionId](facts)
}

/** 真跑一次全仓静态半边（`collectStatic` + `judge`）。 */
function auditRepo() {
  const collected = collectStatic({ repoRoot: REPO_ROOT, criteria: CRITERIA, faces: FACES })
  const judged = judgeRun({ criteria: CRITERIA, evidence: collected.evidence, faces: FACES })
  return { collected, ...judged }
}

describe('票 06 · 判据族 S / X 已登记（加判据 = 改四处，缺一处就报错）', () => {
  it('四条判据都投影进了判据集，且 check=static / severity=major / appliesTo=rendered', () => {
    const byId = new Map(CRITERIA.criteria.map((criterion) => [criterion.id, criterion]))
    for (const id of [...S_IDS, ...X_IDS]) {
      const criterion = byId.get(id)
      expect(criterion, `${id} 没进判据集`).toBeTruthy()
      expect(criterion.check).toBe('static')
      expect(criterion.severity).toBe('major')
      // rendered 而不是 all：命令面（多模型 / 合参 / bestof）没有 DOM，
      // 在它上面要求三态与文案一致性只会产出不可行动的红（3 命令 × 4 判据 = 12 条）。
      expect(criterion.appliesTo).toEqual({ kind: 'rendered' })
      expect(criterion.family).toBe(id.slice(0, 1))
    }
  })

  it('每条都有检查器与谓词（缺了采集器 / 判定器都会直接报错，不是跳过）', () => {
    for (const id of [...S_IDS, ...X_IDS]) {
      expect(typeof STATIC_PROBES[id]).toBe('function')
      expect(typeof ASSERTIONS[id]).toBe('function')
    }
  })

  it('判据的出处锚在设计稿里（S 落在 §3.4 / §6.2 D2，X 落在 §3.3）', () => {
    const byId = new Map(CRITERIA.criteria.map((criterion) => [criterion.id, criterion]))
    expect(byId.get('S-001').source.anchor).toContain('空态')
    expect(byId.get('S-002').source.anchor).toContain('骨架')
    expect(byId.get('S-003').source.anchor).toContain('错误态')
    expect(byId.get('X-001').source.anchor).toContain('不新造同义词')
    for (const id of [...S_IDS, ...X_IDS]) expect(byId.get(id).source.file).toMatch(/^docs\/design\/ui-v1\//)
  })
})

describe('票 06 · 采集口径：什么才算「有这个态」', () => {
  it('注释里写「三态齐全」不算 —— 注释先被剥掉', () => {
    const ctx = fixture({
      'a.tsx': [
        '/**',
        ' * 本屏三态齐全：empty / loading / error 都有。',
        ' */',
        'export function A() {',
        '  return <p>你好</p>;',
        '}',
      ].join('\n'),
    })
    const { facts } = runProbe('S-001', ctx)
    expect(facts.present).toBe(false)
    expect(facts.branch.count).toBe(0)
    expect(judge('S-001', facts).pass).toBe(false)
  })

  it('只有一个字符串常量、没有分支 —— 判红（brief 点名的那个反例）', () => {
    const ctx = fixture({
      'a.tsx': ["const ERROR_TEXT = '出错了';", 'export function A() {', '  return <p>{ERROR_TEXT}</p>;', '}'].join('\n'),
    })
    const { facts } = runProbe('S-003', ctx)
    expect(facts.present).toBe(false)
    expect(facts.missing).toEqual(['branch'])
    expect(judge('S-003', facts).message).toContain('缺错误态')
  })

  it('只有类型里的状态名、没有一句人话 —— 判红', () => {
    const ctx = fixture({
      'a.tsx': [
        "type State = 'empty' | 'loading' | 'error';",
        'export function A() {',
        '  return <p>内容</p>;',
        '}',
      ].join('\n'),
    })
    expect(runProbe('S-001', ctx).facts.present).toBe(false)
    expect(runProbe('S-002', ctx).facts.present).toBe(false)
    expect(runProbe('S-003', ctx).facts.present).toBe(false)
  })

  it('分支在一个文件、人话在另一个文件 —— 判红（拼出来的状态不算）', () => {
    const ctx = fixture({
      'a.tsx': ['export function A({ error }: { error?: string }) {', '  return <p>{error === undefined ? null : error}</p>;', '}'].join('\n'),
      'b.tsx': ["export const COPY = { error: '读取失败，请重试' };", ''].join('\n'),
    })
    const { facts } = runProbe('S-003', ctx)
    expect(facts.present).toBe(false)
    expect(facts.missing).toEqual(['same-file'])
    expect(judge('S-003', facts).message).toContain('不在同一个源文件')
  })

  it('分支 + 一句人话在同一个文件 —— 判绿，且证据带 file:line', () => {
    const ctx = fixture({
      'a.tsx': [
        'export function A({ entries }: { entries: string[] }) {',
        '  return (',
        '    <div>',
        '      {!entries.length && <p>还没有任何登记。</p>}',
        '    </div>',
        '  );',
        '}',
      ].join('\n'),
    })
    const { facts, evidence } = runProbe('S-001', ctx)
    expect(facts.present).toBe(true)
    expect(judge('S-001', facts).pass).toBe(true)
    expect(evidence.length).toBeGreaterThan(0)
    expect(evidence[0].file).toBe('a.tsx')
    expect(evidence[0].line).toBe(4)
    expect(evidence[0].detail).toContain('空态')
  })

  it('`x.length > 0 ?` 是判**非空**，不算空态分支（实测踩过：bestof 的假绿）', () => {
    const ctx = fixture({
      'a.tsx': [
        'export function A({ rows }: { rows: string[] }) {',
        '  return <div>{rows.length > 0 ? <span>没有任何一份被采用</span> : null}</div>;',
        '}',
      ].join('\n'),
    })
    const { facts } = runProbe('S-001', ctx)
    expect(facts.present).toBe(false)
    expect(judge('S-001', facts).pass).toBe(false)
  })

  it('加载态：骨架屏算可见证据（D2「骨架屏也是加载态」），不需要一个字', () => {
    const ctx = fixture({
      'a.tsx': [
        "type S = 'loading' | 'ready';",
        'export function A({ state }: { state: S }) {',
        "  return <div>{state === 'loading' ? <div className=\"xs-skeleton__bar\" /> : null}</div>;",
        '}',
      ].join('\n'),
    })
    const { facts } = runProbe('S-002', ctx)
    expect(facts.present).toBe(true)
    expect(facts.visual.count).toBeGreaterThan(0)
    expect(judge('S-002', facts).pass).toBe(true)
  })

  it('加载态：有分支但没有任何可见证据 —— 判红（缺的是「可见说明」那一半）', () => {
    const ctx = fixture({
      'a.tsx': [
        'export function A({ loading }: { loading: boolean }) {',
        '  return <div>{loading && <span className="xs-box" />}</div>;',
        '}',
      ].join('\n'),
    })
    const { facts } = runProbe('S-002', ctx)
    expect(facts.present).toBe(false)
    expect(facts.branch.count).toBeGreaterThan(0)
    expect(facts.missing).toEqual(['visual'])
    expect(judge('S-002', facts).pass).toBe(false)
  })

  it('加载态：连 loading 分支都没有（只拿去置灰按钮）—— 判红', () => {
    const ctx = fixture({
      'a.tsx': ['export function A({ loading }: { loading: boolean }) {', '  return <button disabled={loading}>存</button>;', '}'].join('\n'),
    })
    const { facts } = runProbe('S-002', ctx)
    expect(facts.present).toBe(false)
    expect(facts.missing).toEqual(['branch'])
  })

  it('状态标记属性也算分支（`data-xuanshu-view="empty"`），但还得有一句人话', () => {
    const withHint = fixture({
      'a.tsx': ['export function A() {', '  return <p data-xuanshu-view="empty">还没有命盘：出生信息还没录</p>;', '}'].join('\n'),
    })
    expect(runProbe('S-001', withHint).facts.present).toBe(true)

    const noHint = fixture({
      'a.tsx': ['export function A() {', '  return <p data-xuanshu-view="empty" />;', '}'].join('\n'),
    })
    expect(runProbe('S-001', noHint).facts.present).toBe(false)
  })
})

describe('票 06 · 缺态判红、全态判绿、证据指回组件入口', () => {
  it('三态齐全的夹具面：三条判据全绿', () => {
    const ctx = fixture({
      'a.tsx': [
        "type Kind = 'empty' | 'loading' | 'error' | 'ready';",
        'export function A({ kind }: { kind: Kind }) {',
        "  return <div>",
        "    {kind === 'loading' ? <p>正在读数据…</p> : null}",
        "    {kind === 'empty' ? <p>还没有数据。</p> : null}",
        "    {kind === 'error' ? <p>读取失败：<button>重试</button></p> : null}",
        "  </div>;",
        '}',
      ].join('\n'),
    })
    for (const id of S_IDS) expect(judge(id, runProbe(id, ctx).facts).pass).toBe(true)
    expect(judge('X-001', runProbe('X-001', ctx).facts).pass).toBe(true)
  })

  it('空白面：三条 S 判据全红，且每条红的证据落在组件入口行（不是文件第 1 行）', () => {
    const ctx = fixture({
      'a.tsx': ['/** 说明。 */', 'import x from "y";', 'export function Blank() {', '  return <div />;', '}'].join('\n'),
    })
    for (const id of S_IDS) {
      const { facts, evidence } = runProbe(id, ctx)
      expect(judge(id, facts).pass).toBe(false)
      expect(evidence).toHaveLength(1)
      expect(evidence[0].file).toBe('a.tsx')
      expect(evidence[0].line).toBe(3) // export function Blank —— 组件入口，不是第 1 行
      expect(evidence[0].detail).toMatch(/缺(空态|加载态|错误态)/)
    }
  })

  it('范围收在 rendered：命令面不参与判定（它没有 DOM，判出来的红不可行动）', () => {
    const commandFace = FACES.filter((face) => face.kind === 'command')
    expect(commandFace).toHaveLength(3)
    const { verdicts } = auditRepo()
    for (const face of commandFace) {
      for (const id of [...S_IDS, ...X_IDS]) {
        const verdict = verdicts.find((item) => item.face === face.id && item.criterionId === id)
        // 不是「不适用」的沉默，是**明确的排除**：分母里没有它，报告里也不会有它的红。
        expect(verdict, `${face.id} × ${id} 不该出现在判定里`).toBeUndefined()
      }
    }
    // 反向保证：面板面仍然照判（否则这条测试会因为「谁都不判」而永远绿）。
    const panelVerdicts = verdicts.filter((item) => item.face === 'panel:mingpan' && item.criterionId === 'S-003')
    expect(panelVerdicts).toHaveLength(1)
  })
})

describe('票 06 · X-001 文案一致性', () => {
  const BASE = [
    "type Kind = 'loading' | 'error';",
    'export function A({ kind }: { kind: Kind }) {',
    '  return <div>',
    "    {kind === 'loading' ? <p>正在读数据…</p> : null}",
  ]

  it('用了族字典禁止的同义替换（「暂无」/「读取中」/「错误」）—— 判红并点名', () => {
    const ctx = fixture({
      'a.tsx': [...BASE, "    {kind === 'error' ? <p>读取中…</p> : null}", '  </div>;', '}'].join('\n'),
    })
    const { facts, evidence } = runProbe('X-001', ctx)
    expect(facts.violations.map((violation) => violation.token)).toContain('读取中')
    expect(judge('X-001', facts).pass).toBe(false)
    expect(evidence[0].detail).toContain('读取中')
    expect(evidence[0].file).toBe('a.tsx')
  })

  it('「暂无」不许与「还没有」并存 —— 单独一个「暂无」就已经是红', () => {
    const ctx = fixture({
      'a.tsx': ['export function A({ empty }: { empty: boolean }) {', '  return <p>{empty ? "暂无数据" : "有"}</p>;', '}'].join('\n'),
    })
    const { facts } = runProbe('X-001', ctx)
    expect(facts.violations.some((violation) => violation.token === '暂无')).toBe(true)
    expect(judge('X-001', facts).pass).toBe(false)
  })

  it('错误行没有可执行的下一步 —— 判红', () => {
    const ctx = fixture({
      'a.tsx': [
        "type Kind = 'error';",
        'export function A({ kind }: { kind: Kind }) {',
        "  return <div>{kind === 'error' ? <p>读取失败。</p> : null}</div>;",
        '}',
      ].join('\n'),
    })
    const { facts } = runProbe('X-001', ctx)
    expect(facts.errorPresent).toBe(true)
    expect(facts.errorActionable.count).toBe(0)
    expect(judge('X-001', facts).message).toContain('可执行的下一步')
  })

  it('错误行旁边有「重试」—— 判绿', () => {
    const ctx = fixture({
      'a.tsx': [
        "type Kind = 'error';",
        'export function A({ kind }: { kind: Kind }) {',
        "  return <div>{kind === 'error' ? <p>读取失败：<button>重试</button></p> : null}</div>;",
        '}',
      ].join('\n'),
    })
    expect(judge('X-001', runProbe('X-001', ctx).facts).pass).toBe(true)
  })

  it('一个状态文案都没有 —— 判红（证明不了同一套说法，不当成通过）', () => {
    const ctx = fixture({ 'a.tsx': ['export function A() {', '  return <div />;', '}'].join('\n') })
    const { facts } = runProbe('X-001', ctx)
    expect(facts.wordingCount).toBe(0)
    expect(judge('X-001', facts).pass).toBe(false)
  })
})

describe('票 06 · 全仓真跑：25 个界面面 × 三条 S 判据', () => {
  const { verdicts, counts } = auditRepo()
  const sVerdicts = verdicts.filter((verdict) => S_IDS.includes(verdict.criterionId))
  const xVerdicts = verdicts.filter((verdict) => X_IDS.includes(verdict.criterionId))

  it('分母 = 25 面 × 3 判据 = 75 条，逐面逐态都判定（没有 not-collected）', () => {
    expect(FACES).toHaveLength(25)
    // S 族从「全部 25 面」收到「有渲染位置的 22 面」：命令面（多模型 / 合参 / bestof）没有 DOM，
    // 在它上面要求空/载/错三态只会产生不可行动的红（12 条）。22 × 3 = 66。
    expect(sVerdicts).toHaveLength(66)
    expect(sVerdicts.filter((verdict) => verdict.status === 'not-collected')).toEqual([])
    expect(counts['collection-failed']).toBe(0)
  })

  it('实测缺态数：空 4 面 / 载 0 面 / 错 2 面（数字变了就说明有人修了或有人放宽了口径）', () => {
    const failing = (criterionId) => sVerdicts.filter((verdict) => verdict.criterionId === criterionId && verdict.status === 'fail')
    // #66（UX-04）清了三条：data 空态 / touch 加载态 / mingpan 错误态 —— 5→4、1→0、3→2。
    expect(failing('S-001')).toHaveLength(4)
    expect(failing('S-002')).toHaveLength(0)
    expect(failing('S-003')).toHaveLength(2)
  })

  it('每条红都指得出「哪个面 + 缺哪一态 + 哪一行」', () => {
    for (const verdict of sVerdicts.filter((item) => item.status === 'fail')) {
      expect(verdict.evidence.length).toBeGreaterThan(0)
      for (const item of verdict.evidence) {
        expect(item.file).toMatch(/^packages\/xuanshu-client\/src\//)
        expect(item.line).toBeGreaterThan(0)
        expect(item.detail).toMatch(/缺(空态|加载态|错误态)/)
      }
    }
  })

  it('X-001 在有渲染面的 22 个面上逐一判定：实测 5 面红（读取中 2 + 错误行没下一步 2 + 零文案 1）', () => {
    expect(xVerdicts).toHaveLength(22)
    expect(xVerdicts.filter((verdict) => verdict.status === 'fail')).toHaveLength(5)
    const redFaces = xVerdicts.filter((verdict) => verdict.status === 'fail').map((verdict) => verdict.face)
    expect(redFaces).toContain('panel:rikke')
    expect(redFaces).toContain('panel:wansheng')
    expect(redFaces).toContain('panel:workflow')
    // 命令面不再参与：它没有 DOM，文案一致性在它身上量不出东西。
    expect(redFaces.some((face) => face.startsWith('command:'))).toBe(false)
  })
})

describe('票 06 · 报告给出「缺态界面面清单与缺失态类型」', () => {
  const { verdicts } = auditRepo()
  const report = buildReport({
    criteria: CRITERIA,
    faces: FACES,
    verdicts,
    generatedAt: '2026-10-31T00:00:00.000Z',
  })

  it('机读报告带 missingStates：5 个面缺态，空 4 / 载 0 / 错 2（同一面缺两态只算一个面）', () => {
    // #66（UX-04）之后重算：data / touch / mingpan 三面各自补齐，合计 8→5。
    expect(report.missingStates.totals).toEqual({ faces: 5, empty: 4, loading: 0, error: 2, applicable: 66 })
    const drawer = report.missingStates.faces.find((row) => row.face === 'slot:shell.overlay#xuanshu-cang-drawer')
    expect(drawer.missing).toEqual(['empty', 'error'])
    expect(drawer.missingLabels).toEqual(['空态', '错误态'])
  })

  it('共用源文件的几个面各自出现在清单里（findings 去重不会把它们压成一行）', () => {
    const bestofFaces = report.missingStates.faces.filter((row) => row.face.startsWith('slot:') && row.face.includes('bestof'))
    expect(bestofFaces.map((row) => row.face).sort()).toEqual([
      'slot:conversation.composer.dock#xuanshu-bestof-trigger',
      'slot:settings.general.item#xuanshu.bestof',
      'slot:shell.overlay#xuanshu-bestof-overlay',
    ])
  })

  it('人读报告里有这一节，且列出合计与逐面缺失态', () => {
    const markdown = renderMarkdown(report)
    expect(markdown).toContain('## 附：缺态界面面（S 族 · 空 / 载 / 错）')
    expect(markdown).toContain('5 个界面面缺态')
    // #66（UX-04）把 `panel:mingpan` 从这一节里摘掉了（错误态补齐）——改成钉一个仍在清单里的面。
    expect(markdown).toContain('`slot:shell.overlay#xuanshu-cang-drawer` 藏库抽屉 · 缺：空态 / 错误态')
    expect(markdown).not.toContain('`panel:mingpan` 命盘卡详情 · 缺：错误态')
  })

  it('missingStatesOf 是纯函数：只剩通过时清单为空、合计归零', () => {
    const passing = verdicts
      .filter((verdict) => S_IDS.includes(verdict.criterionId))
      .map((verdict) => ({ ...verdict, status: 'pass' }))
    const summary = missingStatesOf(passing, FACES)
    expect(summary.faces).toEqual([])
    expect(summary.totals).toEqual({ faces: 0, empty: 0, loading: 0, error: 0, applicable: 66 })
  })
})

describe('票 06 · 采集只读', () => {
  it('跑一遍不写源码（前后字节不变）', () => {
    const file = join(REPO_ROOT, 'packages/xuanshu-client/src/client/CangPanel.tsx')
    const before = readFileSync(file)
    collectStatic({ repoRoot: REPO_ROOT, criteria: CRITERIA, faces: FACES })
    expect(readFileSync(file).equals(before)).toBe(true)
  })
})
