/**
 * `tests/ux/authority.test.mjs` —— 写入面可机检（spec 003 §修复通道 19 · ADR-0015 第 6 条 · 票 10 / #57）。
 *
 * 钉住五条不变量：
 *   1. 判据生效区（`criteria.json` / `rules/**` / `freeze.json`）的改动**必须与冻结签字同现**；
 *      只改 criteria 不签字 → 红，并提示「要么改回去，要么重新签字」；
 *   2. 签字必须**算得通**：提交快照上的 `version` 与整份 criteria.json 的哈希都要过
 *      `scripts/ux/freeze.mjs` 的 `guardCriteria`（不是只看有没有 freeze.json 这个文件）；
 *   3. `rules/**` 改了却没重投影 `criteria.json` → 红（判据变更是一整套）；
 *   4. 基线目录（`ux-reports/<…>/baseline(s)/`）不许进历史，`ux-reports/` 必须仍被
 *      `.gitignore` 覆盖——否则「刷基线」就成了自证及格通道；
 *   5. 提案区（`criteria/proposals/**`）是 AI 的合法写入面，不在生效区里。
 *
 * 全部在临时 git 仓库里造提交（夹具自带一份**真的签过字**的判据集），不依赖主仓历史。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkAuthority, describeViolation } from '../../scripts/check-ux-authority.mjs'
import { CRITERIA_SCHEMA, serialize, versionOfBody } from '../../scripts/ux/project.mjs'
import { writeFreeze } from '../../scripts/ux/freeze.mjs'
import {
  EFFECTIVE_CRITERIA,
  EFFECTIVE_FREEZE,
  EFFECTIVE_RULES_DIR,
  isBaselinePath,
  isEffectiveCriteriaPath,
  isProposalPath,
} from '../../scripts/ux/repair-channel.mjs'
import { createTempRepo } from './lib/temp-git.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-ux-authority.mjs')
const FROZEN_AT = '2026-10-30T00:00:00.000Z'
const CLIENT_FILE = 'packages/xuanshu-client/src/client/a.ts'
const PROPOSAL_FILE = 'docs/design/ui-v1/criteria/proposals/T-999.json'
const BASELINE_FILE = 'ux-reports/baselines/shot.png'

const made = []
afterEach(() => {
  while (made.length > 0) made.pop().remove()
})

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8' })
}

/**
 * 造一份判据集投影产物（形状与 `scripts/ux/project.mjs` 一致：version 由判据体算出）。
 * 这里不跑真的投影器：写入面检查只关心「这份快照的签字算不算得通」，与锚点无关。
 */
function criteriaDocument(ids = ['T-001']) {
  const body = { schema: CRITERIA_SCHEMA, label: 'ux-v1', families: [], criteria: ids.map((id) => ({ id })) }
  return { ...body, version: versionOfBody(body), ruleFiles: [] }
}

/** 造一个「已签字 + 已忽略报告目录」的临时仓库，并提交初始状态。 */
function fixture() {
  const repo = createTempRepo()
  made.push(repo)
  repo.write('.gitignore', 'node_modules/\nux-reports/\n')
  repo.write(`${EFFECTIVE_RULES_DIR}T.json`, `${JSON.stringify({ family: 'T', title: '临时族' }, null, 2)}\n`)
  repo.write(EFFECTIVE_CRITERIA, serialize(criteriaDocument()))
  writeFreeze({ repoRoot: repo.root, frozenAt: FROZEN_AT, approvedBy: 'human', note: 'fixture：首次签字' })
  repo.write(CLIENT_FILE, 'export const a = 1\n')
  const base = repo.commitAll('init：已签字的判据集 + 忽略报告目录')
  return { repo, base }
}

/** 从一组违规里取指定 kind 的那条（有则返回，没有返回 undefined）。 */
function violationOf(result, kind) {
  return result.violations.find((violation) => violation.kind === kind)
}

describe('票 10 · 写入面：客户端改动随便改（判据生效区才是禁区）', () => {
  it('只改客户端源码 → 0 违规、CLI 退出码 0', () => {
    const { repo, base } = fixture()
    repo.write(CLIENT_FILE, 'export const a = 2\n')
    repo.commitAll('fix：把 a 改成 2')

    const result = checkAuthority({ repoRoot: repo.root, since: base })
    expect(result.violations).toEqual([])
    expect(result.effectiveCommits).toEqual([])

    const cli = runCli(['--repo', repo.root, '--since', base])
    expect(cli.status).toBe(0)
    expect(cli.stdout).toContain('✅ 通过')
  })

  it('提案区可以写（AI 的合法写入面），不算生效区改动', () => {
    const { repo, base } = fixture()
    repo.write(PROPOSAL_FILE, `${JSON.stringify({ status: 'proposed', criterion: { id: 'T-999' } }, null, 2)}\n`)
    repo.commitAll('提案：新增一条判据')

    expect(checkAuthority({ repoRoot: repo.root, since: base }).violations).toEqual([])
  })
})

describe('票 10 · 写入面：改了生效区就必须带签字（红）', () => {
  it('只改 criteria.json、不同现 freeze.json → 红，并给出「要么改回去，要么重新签字」', () => {
    const { repo, base } = fixture()
    repo.write(EFFECTIVE_CRITERIA, serialize(criteriaDocument(['T-001', 'T-002'])))
    repo.commitAll('顺手改一下判据')

    const result = checkAuthority({ repoRoot: repo.root, since: base })
    const missing = violationOf(result, 'missing-freeze')
    expect(missing).toBeDefined()
    expect(missing.paths).toContain(EFFECTIVE_CRITERIA)
    expect(missing.message).toContain('要么改回去，要么重新签字')
    expect(missing.message).toContain(EFFECTIVE_FREEZE)
    // 工作区也还是「改了没签」的状态：提交前就该看见自己越界了。
    expect(violationOf(result, 'worktree-drift')).toBeDefined()

    const cli = runCli(['--repo', repo.root, '--since', base])
    expect(cli.status).toBe(1)
    expect(cli.stderr).toContain('要么改回去，要么重新签字')
    expect(cli.stderr).toContain('写入面违规')
  })

  it('只改 rules/ 族文件 → 红（既没重投影，也没签字）', () => {
    const { repo, base } = fixture()
    repo.write(`${EFFECTIVE_RULES_DIR}T.json`, `${JSON.stringify({ family: 'T', title: '临时族（改）' }, null, 2)}\n`)
    repo.commitAll('改一条判据的措辞')

    const result = checkAuthority({ repoRoot: repo.root, since: base })
    const noProjection = violationOf(result, 'rules-without-projection')
    expect(noProjection).toBeDefined()
    expect(noProjection.message).toContain('重投影')
    expect(violationOf(result, 'missing-freeze')).toBeDefined()
  })

  it('签字写错（freeze.version 对不上重算值）→ 红，并抄出冻结守卫的诊断', () => {
    const { repo, base } = fixture()
    repo.write(EFFECTIVE_CRITERIA, serialize(criteriaDocument(['T-001', 'T-002'])))
    const freezePath = join(repo.root, ...EFFECTIVE_FREEZE.split('/'))
    const freeze = JSON.parse(readFileSync(freezePath, 'utf8'))
    freeze.version = 'f'.repeat(64)
    writeFileSync(freezePath, `${JSON.stringify(freeze, null, 2)}\n`, 'utf8')
    repo.commitAll('签字写错一个字')

    const result = checkAuthority({ repoRoot: repo.root, since: base })
    const drift = violationOf(result, 'signature-drift')
    expect(drift).toBeDefined()
    expect(drift.message).toContain('判据已变更，需人确认')
  })

  it('先改判据、下一个提交才签字：仍然红（签字必须与改动同现）', () => {
    const { repo, base } = fixture()
    repo.write(EFFECTIVE_CRITERIA, serialize(criteriaDocument(['T-001', 'T-002'])))
    repo.commitAll('先改判据')
    writeFreeze({ repoRoot: repo.root, frozenAt: '2026-10-30T01:00:00.000Z', approvedBy: 'human', note: '后签字' })
    repo.commitAll('再签字')

    const result = checkAuthority({ repoRoot: repo.root, since: base })
    // 第二个提交里的签字是对的（快照算得通），但第一个提交的改动没有同现签字。
    expect(violationOf(result, 'signature-drift')).toBeUndefined()
    expect(result.effectiveCommits).toHaveLength(2)
    expect(violationOf(result, 'missing-freeze')).toBeDefined()
  })
})

describe('票 10 · 写入面：人的正常签字路径（绿）', () => {
  it('改判据 + 重投影 + 重新签字在同一个提交里 → 0 违规', () => {
    const { repo, base } = fixture()
    repo.write(EFFECTIVE_CRITERIA, serialize(criteriaDocument(['T-001', 'T-002'])))
    writeFreeze({ repoRoot: repo.root, frozenAt: '2026-10-30T01:00:00.000Z', approvedBy: 'human', note: '重新签字' })
    repo.commitAll('判据集会签：新增 T-002 并重新冻结')

    const result = checkAuthority({ repoRoot: repo.root, since: base })
    expect(result.violations).toEqual([])
    expect(result.effectiveCommits).toHaveLength(1)
    expect(runCli(['--repo', repo.root, '--since', base]).status).toBe(0)
  })

  it('rules/ + criteria.json + freeze.json 一整套改动 → 0 违规', () => {
    const { repo, base } = fixture()
    repo.write(`${EFFECTIVE_RULES_DIR}T.json`, `${JSON.stringify({ family: 'T', title: '临时族 v2' }, null, 2)}\n`)
    // 真实的「重投影」由 project.mjs 完成；这里直接给出形状正确的投影产物。
    repo.write(EFFECTIVE_CRITERIA, serialize(criteriaDocument(['T-001', 'T-002'])))
    writeFreeze({ repoRoot: repo.root, frozenAt: '2026-10-30T01:00:00.000Z', approvedBy: 'human', note: '一整套' })
    repo.commitAll('判据一整套变更：族文件 → 投影 → 签字')

    expect(checkAuthority({ repoRoot: repo.root, since: base }).violations).toEqual([])
  })
})

describe('票 10 · 写入面：基线不进历史', () => {
  it('提交里出现基线文件 → 红（并且被跟踪状态也要报出来）', () => {
    const { repo, base } = fixture()
    repo.write(BASELINE_FILE, 'not-really-a-png\n')
    repo.stage('ux-reports', { force: true }) // 基线在 .gitignore 里，只有 --force 才加得进来
    repo.commit('把基线也提交了')

    const result = checkAuthority({ repoRoot: repo.root, since: base })
    expect(violationOf(result, 'baseline-commit')).toBeDefined()
    expect(violationOf(result, 'baseline-tracked')).toBeDefined()
    expect(violationOf(result, 'baseline-commit').message).toContain(BASELINE_FILE)
    expect(runCli(['--repo', repo.root, '--since', base]).status).toBe(1)
  })

  it('.gitignore 不再覆盖 ux-reports/ → 红（基线一能进历史，刷基线就自证及格了）', () => {
    const { repo, base } = fixture()
    repo.write('.gitignore', 'node_modules/\n')
    repo.commitAll('撤掉报告目录的忽略')

    const result = checkAuthority({ repoRoot: repo.root, since: base })
    const open = violationOf(result, 'gitignore-open')
    expect(open).toBeDefined()
    expect(open.message).toContain('ux-reports/')
  })
})

describe('票 10 · 写入面：词表与命令面', () => {
  it('生效区 / 基线 / 提案区的路径谓词口径一致', () => {
    expect(isEffectiveCriteriaPath(EFFECTIVE_CRITERIA)).toBe(true)
    expect(isEffectiveCriteriaPath(EFFECTIVE_FREEZE)).toBe(true)
    expect(isEffectiveCriteriaPath(`${EFFECTIVE_RULES_DIR}T.json`)).toBe(true)
    expect(isEffectiveCriteriaPath(PROPOSAL_FILE)).toBe(false)

    expect(isProposalPath(PROPOSAL_FILE)).toBe(true)
    expect(isProposalPath(EFFECTIVE_CRITERIA)).toBe(false)

    expect(isBaselinePath('ux-reports/baselines/shot.png')).toBe(true)
    expect(isBaselinePath('ux-reports/2026-10-30T00-00-00-000Z/baseline/shot.png')).toBe(true)
    expect(isBaselinePath('ux-reports/latest.json')).toBe(false)
  })

  it('违规行点名提交（短 sha + 主题），不是只报文件', () => {
    const { repo, base } = fixture()
    repo.write(EFFECTIVE_CRITERIA, serialize(criteriaDocument(['T-001', 'T-002'])))
    const sha = repo.commitAll('顺手改一下判据')
    const result = checkAuthority({ repoRoot: repo.root, since: base })
    const line = describeViolation(violationOf(result, 'missing-freeze'))
    expect(line).toContain(sha.slice(0, 7))
    expect(line).toContain('顺手改一下判据')
  })

  it('--repo 指向不是 git 仓库的目录 → 退出码 2（工具没跑成，不是判据红）', () => {
    const plain = mkdtempSync(join(tmpdir(), 'ux-authority-norepo-'))
    try {
      const result = runCli(['--repo', plain, '--since', 'HEAD~1'])
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('检查没跑成')
      expect(existsSync(join(plain, '.git'))).toBe(false)
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })

  it('--help 立出写入面口径与退出码', () => {
    const help = runCli(['--help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('判据生效区')
    expect(help.stdout).toContain('baseline')
    expect(help.stdout).toContain('0 = 写入面干净')
  })
})
