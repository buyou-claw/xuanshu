/**
 * 判据投影器（spec 003 · 票 02 / #49）。
 *
 * 只测外部行为：给定 rules/ 原文，投影出什么、什么时候报错。不测「投影器内部怎么遍历目录」。
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CRITERIA_FILE,
  CriteriaError,
  projectCriteria,
  readNormalizedText,
  reversionFromText,
  versionOfBody,
} from '../../scripts/ux/project.mjs'
import { faceManifest } from '../assembly/lib/panel-surface.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const FACES = faceManifest()

/** 造一个最小仓库：一份真的设计稿锚 + 一份族文件。 */
function fixtureRepo(rules, { designText = '### 0.4 禁则（写稿人自查）\n1. 本文件**不出现**色值。\n' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ux-project-'))
  mkdirSync(join(root, 'docs/design/ui-v1/shared'), { recursive: true })
  writeFileSync(join(root, 'docs/design/ui-v1/shared/设计token字典.md'), designText)
  mkdirSync(join(root, 'docs/design/ui-v1/criteria/rules'), { recursive: true })
  for (const [name, content] of Object.entries(rules)) {
    writeFileSync(join(root, 'docs/design/ui-v1/criteria/rules', name), `${JSON.stringify(content, null, 2)}\n`)
  }
  return root
}

const SOURCE = { file: 'docs/design/ui-v1/shared/设计token字典.md', anchor: '### 0.4 禁则（写稿人自查）' }

const ONE_RULE = {
  family: 'T',
  title: 'token 消费',
  source: SOURCE,
  rules: [
    {
      id: 'T-001',
      statement: '样式里不出现字面色值',
      check: 'static',
      evidence: 'file-line',
      severity: 'blocker',
      appliesTo: { kind: 'all' },
      source: SOURCE,
    },
  ],
}

describe('票 02 · 证据 → 判定 → 报告 → 命令（投影器半边）', () => {
  it('判据集 v1 从设计稿升格出来：每条判据五列齐全（票 02 只有 T-001，票 07 加 D-001，票 04 补齐 T-002..T-004）', () => {
    const { document } = projectCriteria({ repoRoot: REPO_ROOT, faces: FACES })
    const ids = document.criteria.map((criterion) => criterion.id)
    expect(ids).toContain('T-001')
    // 票 04 把族 T 补到四条（别的票往别的族加，别在这里钉全量顺序）
    expect(ids.filter((id) => id.startsWith('T-'))).toEqual(['T-001', 'T-002', 'T-003', 'T-004'])
    const [criterion] = document.criteria
    expect(criterion.id).toBe('T-001')
    // 五列各就位（id / 判据 / 检查方式 / 证据 / 严重级）
    expect(criterion.statement.length).toBeGreaterThan(0)
    expect(criterion.check).toBe('static')
    expect(criterion.evidence).toBe('file-line')
    expect(criterion.severity).toBe('blocker')
    // 出处锚：判据不是自封的，它指回设计稿的一句原文
    expect(criterion.source.file).toBe('docs/design/ui-v1/shared/设计token字典.md')
    expect(criterion.source.anchor.length).toBeGreaterThan(0)
  })

  it('投影幂等：同一输入两跑字节一致（冻结值靠这条才有意义）', () => {
    const first = projectCriteria({ repoRoot: REPO_ROOT, faces: FACES })
    const second = projectCriteria({ repoRoot: REPO_ROOT, faces: FACES })
    expect(second.text).toBe(first.text)
    expect(second.version).toBe(first.version)
  })

  it('版本号可由文件自证：拿 criteria.json 的其余字段重算，等于它自己写的 version', () => {
    const text = readNormalizedText(join(REPO_ROOT, CRITERIA_FILE))
    const { document, version } = reversionFromText(text)
    expect(version).toBe(document.version)
    expect(version).toBe(versionOfBody(document))
    expect(version).toMatch(/^[0-9a-f]{64}$/)
  })

  it('`human-only` 没写「机器判不了的原因」→ 投影直接报错（不允许静默降级）', () => {
    const root = fixtureRepo({
      'T.json': {
        ...ONE_RULE,
        rules: [{ ...ONE_RULE.rules[0], check: 'human-only' }],
      },
    })
    expect(() => projectCriteria({ repoRoot: root, faces: FACES })).toThrow(CriteriaError)
    expect(() => projectCriteria({ repoRoot: root, faces: FACES })).toThrow(/humanReason/)
  })

  it('`human-only` 写了理由 → 通过，并把理由带进判据集', () => {
    const root = fixtureRepo({
      'T.json': {
        ...ONE_RULE,
        rules: [{ ...ONE_RULE.rules[0], check: 'human-only', humanReason: '「安静」是审美判断，机器给不出可复现的阈值' }],
      },
    })
    const { document } = projectCriteria({ repoRoot: root, faces: FACES })
    expect(document.criteria[0].humanReason).toContain('审美判断')
  })

  it('出处锚在设计稿里找不到 → 报错（判据不许自造规则）', () => {
    const root = fixtureRepo({
      'T.json': { ...ONE_RULE, rules: [{ ...ONE_RULE.rules[0], source: { ...SOURCE, anchor: '### 0.4 一条设计稿里没有的禁则' } }] },
    })
    expect(() => projectCriteria({ repoRoot: root, faces: FACES })).toThrow(/source\.anchor/)
  })

  it('五列缺一列 → 报错', () => {
    const root = fixtureRepo({ 'T.json': { ...ONE_RULE, rules: [{ ...ONE_RULE.rules[0], severity: undefined }] } })
    expect(() => projectCriteria({ repoRoot: root, faces: FACES })).toThrow(/severity/)
  })

  it('id 前缀与族文件不一致 → 报错（id 稳定且永不复用）', () => {
    const root = fixtureRepo({ 'T.json': { ...ONE_RULE, rules: [{ ...ONE_RULE.rules[0], id: 'S-001' }] } })
    expect(() => projectCriteria({ repoRoot: root, faces: FACES })).toThrow(/前缀/)
  })

  it('appliesTo.ids 里的界面面必须真的存在（分母不许写一个不存在的面）', () => {
    const root = fixtureRepo({
      'T.json': { ...ONE_RULE, rules: [{ ...ONE_RULE.rules[0], appliesTo: { kind: 'ids', ids: ['panel:不存在'] } }] },
    })
    expect(() => projectCriteria({ repoRoot: root, faces: FACES })).toThrow(/不是已知界面面/)
  })

  it('下架用墓碑而不是删条目（否则历史兑现率不可比）', () => {
    const root = fixtureRepo({ 'T.json': { ...ONE_RULE, rules: [{ ...ONE_RULE.rules[0], tombstone: true }] } })
    const { document } = projectCriteria({ repoRoot: root, faces: FACES })
    expect(document.criteria[0].tombstone).toBe(true)
  })
})

describe('票 02 · 投影产物与作者面不许漂', () => {
  it('rules/ 是作者面，criteria.json 是它的投影：两处必须一致', () => {
    const projected = projectCriteria({ repoRoot: REPO_ROOT, faces: FACES })
    const committed = readNormalizedText(join(REPO_ROOT, CRITERIA_FILE))
    expect(committed, 'criteria.json 过期了：跑 node scripts/ux/project.mjs --write').toBe(projected.text)
  })

  it('投影产物里没有「本机绝对路径」这种东西（否则换台机器版本号就变）', () => {
    const text = readFileSync(join(REPO_ROOT, CRITERIA_FILE), 'utf8')
    expect(text).not.toContain(REPO_ROOT.replaceAll('\\', '/'))
    expect(text).not.toContain(REPO_ROOT)
  })
})
