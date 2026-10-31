/**
 * 判据族 `N`（导航：入口唯一 / 返回落点 / 键盘可达）—— 票 08b / #60。
 *
 * 这份用例守四件事（brief 里点名的那四条最容易做歪的地方）：
 *   1. **口径**：N 族只有三条、全 `check: browser`、`appliesTo: rendered`（命令面没有 DOM，不进分母）；
 *   2. **判红**：三条各自都能红，且 message 指得到「哪个界面面 + 哪个入口 + 期望落点」；
 *   3. **不靠读源码**：判定只用浏览器给的事实；没采到 = `not-collected`，绝不给空 facts 判过；
 *   4. **报告单列一栏**：`## 附：导航族 N（…）` 一节在 `## 5. human-only` 之后，不与视觉档混排。
 *
 * 夹具用的是**录制的浏览器证据**（与采集器同一种形状）：浏览器端到端只留 1 条，在别处。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ASSERTIONS } from '../../scripts/ux/assertions/index.mjs'
import { N_ASSERTIONS } from '../../scripts/ux/assertions/n.mjs'
import { run as judgeRun } from '../../scripts/ux/judge.mjs'
import { CRITERIA_FILE, projectCriteria } from '../../scripts/ux/project.mjs'
import { buildReport, navFamilyOf, renderMarkdown } from '../../scripts/ux/report.mjs'
import { NAV_CRITERIA, ENTRY_PRIMITIVES } from '../../scripts/ux/nav-vocabulary.mjs'
import { faceManifest } from '../assembly/lib/panel-surface.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const FACES = faceManifest()
const CRITERIA = projectCriteria({ repoRoot: REPO_ROOT, faces: FACES }).document
const N_IDS = NAV_CRITERIA

/** 一条入口事实（与 `browser-nav.mjs` 的 `entriesFor()` 同形状）。 */
const entry = (primitive, label, panel = 'overview') => ({ primitive, label, panel, via: 'label' })

describe('票 08b · N 族已登记（加判据 = 改四处，缺一处就报错）', () => {
  it('三条判据都投影进了判据集：check=browser / severity=major / appliesTo=rendered', () => {
    const byId = new Map(CRITERIA.criteria.map((criterion) => [criterion.id, criterion]))
    for (const id of N_IDS) {
      const criterion = byId.get(id)
      expect(criterion, `${id} 没进判据集`).toBeTruthy()
      expect(criterion.family).toBe('N')
      expect(criterion.check).toBe('browser')
      expect(criterion.severity).toBe('major')
      expect(criterion.appliesTo).toEqual({ kind: 'rendered' })
      expect(criterion.evidence).toBe('computed-style')
      expect(typeof ASSERTIONS[id]).toBe('function')
    }
  })

  it('判据原文在 rules/N.json（不是手改 criteria.json）', () => {
    const rules = JSON.parse(readFileSync(join(REPO_ROOT, 'docs/design/ui-v1/criteria/rules/N.json'), 'utf8'))
    expect(rules.family).toBe('N')
    expect(rules.rules.map((rule) => rule.id)).toEqual(N_IDS)
    // 每条都要指得回设计稿（锚不是自造的）。
    for (const rule of rules.rules) expect(rule.source.anchor.length).toBeGreaterThan(6)
  })

  it('判据集投影产物与 rules/ 一致（手改一个字节会让巡检拒绝跑）', () => {
    expect(readFileSync(join(REPO_ROOT, CRITERIA_FILE), 'utf8').replace(/\r\n/g, '\n')).toBe(
      projectCriteria({ repoRoot: REPO_ROOT, faces: FACES }).text,
    )
  })

  it('分母只有渲染面：命令面（没有 DOM）不在 N 族里', () => {
    const rendered = FACES.filter((face) => face.slot !== null)
    expect(rendered).toHaveLength(22)
    const verdicts = judgeRun({ criteria: CRITERIA, evidence: [], faces: FACES }).verdicts.filter((verdict) => N_IDS.includes(verdict.criterionId))
    expect(verdicts).toHaveLength(3 * rendered.length)
    expect(verdicts.some((verdict) => verdict.face.startsWith('command:'))).toBe(false)
  })

  it('没有证据 = 「未采到」，不是通过（三条都不给空 facts 的机会）', () => {
    const { verdicts, counts } = judgeRun({ criteria: CRITERIA, evidence: [], faces: FACES })
    const navVerdicts = verdicts.filter((verdict) => N_IDS.includes(verdict.criterionId))
    expect(navVerdicts.every((verdict) => verdict.status === 'not-collected')).toBe(true)
    expect(counts.pass).toBe(0)
  })
})

describe('票 08b · N-001：同一个动作只有一个入口', () => {
  it('一个入口 → 绿，message 点名那个入口', () => {
    const judged = N_ASSERTIONS['N-001']({ face: 'panel:cang', action: { id: 'cang', label: '藏库' }, entries: [entry('sidebar-row', '藏')] })
    expect(judged.pass).toBe(true)
    expect(judged.message).toContain('侧栏行「藏」')
  })

  it('跨原语的第二入口 → 红，并按「侧栏行 / 面板」逐条列出', () => {
    const judged = N_ASSERTIONS['N-001']({
      face: 'panel:pus',
      action: { id: 'pus', label: '谱管理' },
      entries: [entry('sidebar-row', '谱'), entry('panel', '管理谱 ▸ S5', 'consult'), entry('panel', '查看谱', 'cang')],
    })
    expect(judged.pass).toBe(false)
    expect(judged.message).toContain('3 个入口')
    expect(judged.message).toContain('侧栏行「谱」')
    expect(judged.message).toContain('面板「管理谱 ▸ S5」')
    expect(judged.message).toContain('面板「查看谱」')
    expect(judged.message).toContain('跨 2 种原语')
    expect(judged.message).toContain('panel:pus')
  })

  it('同一个原语里出现两处 → 也红（「同一动作多个入口」的字面含义）', () => {
    const judged = N_ASSERTIONS['N-001']({
      face: 'slot:shell.overlay#xuanshu-cang-drawer',
      action: { id: 'cang-drawer', label: '藏登记抽屉' },
      entries: [entry('panel', '登记藏', 'cang'), entry('panel', '登记第一个藏', 'cang')],
    })
    expect(judged.pass).toBe(false)
    expect(judged.message).toContain('同一个原语里就有多处')
  })

  it('一个入口都没采到 → 红（证据不足不能判过）', () => {
    const judged = N_ASSERTIONS['N-001']({ face: 'panel:pus', action: null, entries: [] })
    expect(judged.pass).toBe(false)
    expect(judged.message).toContain('没有采到任何入口')
  })

  it('判定是纯函数：同一份 facts 两跑同答案（深拷贝也不变）', () => {
    const facts = { face: 'panel:pus', action: { id: 'pus', label: '谱管理' }, entries: [entry('sidebar-row', '谱'), entry('panel', '查看谱', 'cang')] }
    expect(N_ASSERTIONS['N-001'](facts)).toEqual(N_ASSERTIONS['N-001'](structuredClone(facts)))
  })
})

describe('票 08b · N-002：关闭抽屉 / 面板后回到来处', () => {
  it('落回打开它的那个面 → 绿', () => {
    const judged = N_ASSERTIONS['N-002']({
      face: 'slot:shell.overlay#xuanshu-cang-drawer',
      events: [{ from: 'panel:cang', opened: 'slot:shell.overlay#xuanshu-cang-drawer', closedBy: 'Escape', landed: 'panel:cang' }],
    })
    expect(judged.pass).toBe(true)
    expect(judged.message).toContain('回到来处')
  })

  it('落回首页 → 红，并单独点出「落回首页了」', () => {
    const judged = N_ASSERTIONS['N-002']({
      face: 'slot:shell.overlay#xuanshu-cang-drawer',
      events: [{ from: 'panel:cang', opened: 'slot:shell.overlay#xuanshu-cang-drawer', closedBy: '「取消」', landed: 'panel:overview' }],
    })
    expect(judged.pass).toBe(false)
    expect(judged.message).toContain('落回首页了')
    expect(judged.message).toContain('期望回到 panel:cang')
  })

  it('落在第三个面（既不是来处也不是首页）→ 也红', () => {
    const judged = N_ASSERTIONS['N-002']({
      face: 'panel:consult',
      events: [{ from: 'panel:consult', opened: 'panel:consult', closedBy: '「← 回到当前会话」', landed: 'panel:pus' }],
    })
    expect(judged.pass).toBe(false)
    expect(judged.message).toContain('期望回到 panel:consult')
  })

  it('多次关闭里有一次错 → 红，且说清是几次里的几次', () => {
    const judged = N_ASSERTIONS['N-002']({
      face: 'slot:shell.overlay#xuanshu-cang-drawer',
      events: [
        { from: 'panel:cang', opened: 'slot:shell.overlay#xuanshu-cang-drawer', closedBy: '「登记」提交成功', landed: 'panel:cang' },
        { from: 'panel:cang', opened: 'slot:shell.overlay#xuanshu-cang-drawer', closedBy: 'Escape', landed: 'panel:overview' },
      ],
    })
    expect(judged.pass).toBe(false)
    expect(judged.message).toContain('1/2')
  })

  it('没有观测到关闭事件 → 红（证据不足不能判过）', () => {
    const judged = N_ASSERTIONS['N-002']({ face: 'panel:cang', events: [] })
    expect(judged.pass).toBe(false)
    expect(judged.message).toContain('没有观测到关闭事件')
  })
})

describe('票 08b · N-003：键盘能走完一条任务', () => {
  /** 造一串 Tab 骤停点（默认都在本面里、都有可见描边）。 */
  function stops(labels, overrides = {}) {
    return labels.map((label, index) => ({
      tag: 'button',
      label,
      inFace: true,
      focusVisible: true,
      outline: 'auto 2px',
      visibleFocus: true,
      ...(overrides[index] ?? {}),
    }))
  }

  it('Tab 到主操作 + 描边可见 + Esc 关得掉 → 绿', () => {
    const judged = N_ASSERTIONS['N-003']({
      face: 'panel:cang',
      controls: 6,
      expect: ['登记藏'],
      reached: ['登记藏'],
      stops: stops(['查看谱', '登记藏', '搜藏名 / 签']),
      esc: { applicable: false, closed: null },
    })
    expect(judged.pass).toBe(true)
    expect(judged.message).toContain('登记藏')
  })

  it('主操作 Tab 不到 → 红（「走完一条任务」不成立）', () => {
    const judged = N_ASSERTIONS['N-003']({
      face: 'panel:cang',
      controls: 6,
      expect: ['登记藏'],
      reached: [],
      stops: stops(['查看谱', '搜藏名 / 签']),
    })
    expect(judged.pass).toBe(false)
    expect(judged.message).toContain('主操作 Tab 不到')
    expect(judged.message).toContain('登记藏')
  })

  it('Esc 关不掉抽屉 → 红，并点名那个抽屉面', () => {
    const judged = N_ASSERTIONS['N-003']({
      face: 'slot:shell.overlay#xuanshu-mounts-drawer',
      controls: 5,
      expect: ['关闭'],
      reached: ['关闭'],
      stops: stops(['关闭', '确认挂载到本轮']),
      esc: { applicable: true, closed: false },
    })
    expect(judged.pass).toBe(false)
    expect(judged.message).toContain('Esc 关不掉这个抽屉')
    expect(judged.message).toContain('slot:shell.overlay#xuanshu-mounts-drawer')
  })

  it('焦点看不见（没有描边 / 不是 :focus-visible）→ 红，并给 outline 原值', () => {
    const judged = N_ASSERTIONS['N-003']({
      face: 'panel:consult',
      controls: 4,
      expect: [],
      reached: [],
      stops: stops(['历史回看', '管理谱 ▸ S5'], { 1: { visibleFocus: false, focusVisible: false, outline: 'none 0px' } }),
    })
    expect(judged.pass).toBe(false)
    expect(judged.message).toContain('焦点看不见')
    expect(judged.message).toContain('outline none 0px')
  })

  it('Tab 一个控件都停不到 → 红（键盘无从下手）', () => {
    const judged = N_ASSERTIONS['N-003']({ face: 'panel:pus', controls: 0, expect: [], reached: [], stops: [] })
    expect(judged.pass).toBe(false)
    expect(judged.message).toContain('一个可聚焦控件都没有')
  })

  it('「本面之外」的骤停点不算本面的键盘可达性', () => {
    const judged = N_ASSERTIONS['N-003']({
      face: 'panel:consult',
      controls: 1,
      expect: ['开一次问事'],
      reached: ['开一次问事'],
      stops: [...stops(['开一次问事']), { tag: 'body', label: '', inFace: false, focusVisible: false, outline: 'none 3px', visibleFocus: false }],
    })
    expect(judged.pass).toBe(true)
  })
})

describe('票 08b · 报告把导航族单列一栏（不与视觉档混排）', () => {
  /** 造几条 verdicts：两条 N 红 + 一条 N 绿 + 一条 S 红（用来证明两族不混排）。 */
  function fixtureVerdicts() {
    return [
      { criterionId: 'N-001', family: 'N', face: 'panel:pus', severity: 'major', statement: '入口唯一', status: 'fail', message: '有 3 个入口：侧栏行「谱」…', evidence: [] },
      { criterionId: 'N-001', family: 'N', face: 'panel:cang', severity: 'major', statement: '入口唯一', status: 'pass', message: '只有一个入口', evidence: [] },
      { criterionId: 'N-003', family: 'N', face: 'slot:shell.overlay#xuanshu-mounts-drawer', severity: 'major', statement: '键盘可达', status: 'fail', message: 'Esc 关不掉这个抽屉', evidence: [] },
      { criterionId: 'N-002', family: 'N', face: 'panel:consult', severity: 'major', statement: '返回落点', status: 'not-collected', message: '未采到', evidence: [] },
      { criterionId: 'S-001', family: 'S', face: 'panel:pus', severity: 'major', statement: '空态', status: 'fail', message: '缺空态', evidence: [] },
    ]
  }

  it('navFamilyOf：按面聚红、按判据计数，未采到单独计', () => {
    const nav = navFamilyOf(fixtureVerdicts(), FACES)
    expect(nav.faces.map((row) => row.face)).toEqual(['panel:pus', 'slot:shell.overlay#xuanshu-mounts-drawer'])
    expect(nav.totals).toEqual({ faces: 2, unique: 1, return: 0, keyboard: 1, applicable: 4, observed: 3, notCollected: 1 })
    expect(nav.faces[0].label).toBe('谱管理')
    expect(nav.faces[1].issues[0].kind).toBe('键盘可达')
  })

  it('人读报告：导航族有自己的一节，且在「## 5. human-only」之后（顺序不变式）', () => {
    const verdicts = fixtureVerdicts()
    const report = buildReport({ criteria: CRITERIA, faces: FACES, verdicts, generatedAt: 'now' })
    const markdown = renderMarkdown(report)
    const heading = '## 附：导航族 N（入口唯一 / 返回落点 / 键盘可达）'
    expect(markdown).toContain(heading)
    expect(markdown.indexOf(heading)).toBeGreaterThan(markdown.indexOf('## 5. human-only'))
    // 三条主线的小标题仍在原位（顺序不变式不许被这一节打乱）
    const order = ['## 1. 回退', '## 2. blocker', '## 3. 新增', '## 4. 已修', '## 5. human-only'].map((item) => markdown.indexOf(item))
    expect(order).toEqual([...order].sort((left, right) => left - right))
  })

  it('导航族的红逐条可读：面 + 小标题 + message + 未采到计数', () => {
    const report = buildReport({ criteria: CRITERIA, faces: FACES, verdicts: fixtureVerdicts(), generatedAt: 'now' })
    const markdown = renderMarkdown(report)
    expect(markdown).toContain('合计 **2 个界面面**有 N 族红')
    expect(markdown).toContain('入口不唯一 1 面')
    expect(markdown).toContain('键盘可达 1 面')
    expect(markdown).toContain('`panel:pus` 谱管理 · 入口唯一（N-001）')
    expect(markdown).toContain('`slot:shell.overlay#xuanshu-mounts-drawer` 挂载账本抽屉 · 键盘可达（N-003）')
    expect(markdown).toContain('另有 1 条未采到')
  })

  it('机读报告也有同一份 navFamily（一处计算、两处引用）', () => {
    const report = buildReport({ criteria: CRITERIA, faces: FACES, verdicts: fixtureVerdicts(), generatedAt: 'now' })
    expect(report.navFamily).toEqual(navFamilyOf(fixtureVerdicts(), FACES))
    expect(report.groups.blockers.some((verdict) => verdict.criterionId.startsWith('N-'))).toBe(false) // major ≠ blocker
  })

  it('N 族没有红时如实写「无」，不假装有一节内容', () => {
    const report = buildReport({
      criteria: CRITERIA,
      faces: FACES,
      verdicts: [{ criterionId: 'N-001', family: 'N', face: 'panel:pus', severity: 'major', statement: '入口唯一', status: 'pass', message: '只有一个入口', evidence: [] }],
      generatedAt: 'now',
    })
    const markdown = renderMarkdown(report)
    const section = markdown.slice(markdown.indexOf('## 附：导航族 N'))
    expect(section).toContain('- 无。')
  })
})

describe('票 08b · 判定只吃浏览器事实（不读源码推断）', () => {
  it('assertions/n.mjs 不读文件、不碰 fs / child_process / 时钟', () => {
    const source = readFileSync(join(REPO_ROOT, 'scripts/ux/assertions/n.mjs'), 'utf8')
    expect(source).not.toMatch(/node:fs|node:child_process|readFileSync|Date\.now|new Date\(/)
    expect(source).not.toContain('packages/xuanshu-client')
  })

  it('三条谓词都返回 {pass: boolean, message: string}', () => {
    for (const id of N_IDS) {
      const judged = N_ASSERTIONS[id]({})
      expect(typeof judged.pass).toBe('boolean')
      expect(typeof judged.message).toBe('string')
      expect(judged.message.length).toBeGreaterThan(0)
    }
  })

  it('入口原语的闭集与报告口径一致（报告里列的就是这五种）', () => {
    expect(ENTRY_PRIMITIVES).toEqual(['sidebar-row', 'panel', 'drawer', 'composer-dock', 'command'])
  })
})
