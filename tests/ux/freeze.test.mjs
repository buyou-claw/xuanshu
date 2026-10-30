/**
 * 判据冻结与提案区（spec 003 · 票 03 / #50）。
 *
 * 钉住四件事：
 *   1. 冻结值覆盖判据集**全文**（不只是 version 字段）；
 *   2. 守卫不信文件里写的 `version`，重算后与冻结值三方比对，并指出**是哪一侧变了**；
 *   3. 巡检在采集之前拒绝运行、退出码 3、一个报告文件都不建；
 *   4. 提案区与生效区物理分开：往 proposals/ 里写东西不改变生效判据。
 *
 * 夹具是本测试自己造的临时仓库（拷设计稿锚 + 一个族文件），**不依赖本仓真实的判据集**——
 * 真实判据集会被别的票改动，用例跟着红就测不出这条守卫的行为。
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CriteriaFrozenError,
  FREEZE_FILE,
  FREEZE_SCHEMA,
  guardCriteria,
  readFreeze,
  writeFreeze,
} from '../../scripts/ux/freeze.mjs'
import { CRITERIA_FILE, projectCriteria, reversionFromText, sha256 } from '../../scripts/ux/project.mjs'
import { runVerifyUx, VerifyUxError } from '../../scripts/verify-ux.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const FACES = [{ id: 'panel:overview', kind: 'panel', label: '自我总览', sources: [] }]
const FROZEN_AT = '2026-10-30T00:00:00.000Z'

/** 拒绝提示里必须给得出的两条修复命令（守卫的提示要能直接抄走）。 */
const NODE_PROJECT_WRITE = 'node scripts/ux/project.mjs --write'
const NODE_FREEZE_WRITE = 'node scripts/ux/freeze.mjs --write'

/** 造一份「设计稿锚 + rules + criteria.json」都齐的最小仓库。 */
function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'ux-freeze-'))
  mkdirSync(join(root, 'docs/design/ui-v1/shared'), { recursive: true })
  copyFileSync(
    join(REPO_ROOT, 'docs/design/ui-v1/shared/设计token字典.md'),
    join(root, 'docs/design/ui-v1/shared/设计token字典.md'),
  )
  mkdirSync(join(root, 'docs/design/ui-v1/criteria/rules'), { recursive: true })
  copyFileSync(join(REPO_ROOT, 'docs/design/ui-v1/criteria/rules/T.json'), join(root, 'docs/design/ui-v1/criteria/rules/T.json'))
  const projected = projectCriteria({ repoRoot: root, faces: FACES })
  writeFileSync(join(root, CRITERIA_FILE), projected.text)
  return { root, projected }
}

/** 造一份并**已冻结**的仓库（未改动的基准）。 */
function frozenRepo() {
  const fixture = tempRepo()
  writeFreeze({ repoRoot: fixture.root, frozenAt: FROZEN_AT, note: '首次冻结', approvedBy: 'human' })
  return fixture
}

function criteriaPath(root) {
  return join(root, CRITERIA_FILE)
}

function freezePath(root) {
  return join(root, FREEZE_FILE)
}

/** 改 criteria.json 里一个字节（模拟「AI 顺手调低了考卷」）。 */
function tamperByte(root) {
  const text = readFileSync(criteriaPath(root), 'utf8')
  writeFileSync(criteriaPath(root), text.replace('不出现字面色值', '不出现字面色值。'))
}

function expectFrozenError(fn) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(CriteriaFrozenError)
    expect(error.message).toContain('判据已变更，需人确认')
    return error
  }
  throw new Error('期望抛 CriteriaFrozenError，实际没抛')
}

describe('票 03 · 冻结值（读写）', () => {
  it('写入的冻结值覆盖判据集全文：version + 整份文件的 sha256 + 条数，且读得回', () => {
    const { root, projected } = tempRepo()
    const written = writeFreeze({ repoRoot: root, frozenAt: FROZEN_AT, note: '首次冻结', approvedBy: 'human' })
    expect(written.version).toBe(projected.version.toLowerCase())

    const file = JSON.parse(readFileSync(freezePath(root), 'utf8'))
    expect(file.schema).toBe(FREEZE_SCHEMA)
    expect(file.version).toBe(projected.version)
    // 全文覆盖：整份 criteria.json 的字节哈希也进冻结值（version 只盖判据体，盖不住 ruleFiles）
    expect(file.criteria.sha256).toBe(sha256(readFileSync(criteriaPath(root), 'utf8')))
    expect(file.criteria.criteriaCount).toBe(projected.document.criteria.length)
    expect(file.frozenAt).toBe(FROZEN_AT)
    expect(file.approvedBy).toBe('human')
    expect(file.note).toBe('首次冻结')

    expect(readFreeze({ repoRoot: root })).toEqual(file)
  })

  it('不给 version 也冻结得了（人只按一次回车，不该被迫背哈希）', () => {
    const { root, projected } = tempRepo()
    const written = writeFreeze({ repoRoot: root, frozenAt: FROZEN_AT })
    expect(written.version).toBe(projected.version)
  })

  it('传入的 version 与重算不一致 → 拒绝冻结，且不落盘（冻结值不许凭调用方口径写）', () => {
    const { root } = tempRepo()
    const error = expectFrozenError(() => writeFreeze({ repoRoot: root, version: 'f'.repeat(64), frozenAt: FROZEN_AT }))
    expect(error.side).toBe('stale-version')
    expect(existsSync(freezePath(root))).toBe(false)
  })

  it('冻结值缺失 → 拒绝，并说清是「冻结值那一侧」缺失', () => {
    const { root } = tempRepo()
    const error = expectFrozenError(() => readFreeze({ repoRoot: root }))
    expect(error.side).toBe('missing-freeze')
    expect(error.message).toContain('freeze.json')
    expect(error.message).toContain(NODE_FREEZE_WRITE)
  })

  it('冻结值坏了（schema 不对 / version 不是 64 位 hex）→ 拒绝，报「冻结值格式」而不是笼统错', () => {
    const { root } = frozenRepo()
    writeFileSync(freezePath(root), JSON.stringify({ schema: 'nope/1', version: 'short' }, null, 2))
    const error = expectFrozenError(() => readFreeze({ repoRoot: root }))
    expect(error.side).toBe('freeze-malformed')
    expect(error.message).toContain('freeze.json')
  })
})

describe('票 03 · 守卫：重算版本后三方比对，指出是哪一侧变了', () => {
  it('未改：通过，并回带冻结时刻与签字人（报告要能引用）', () => {
    const { root, projected } = frozenRepo()
    const passed = guardCriteria({ repoRoot: root, criteriaText: readFileSync(criteriaPath(root), 'utf8') })
    expect(passed.version).toBe(projected.version)
    expect(passed.frozen.frozenAt).toBe(FROZEN_AT)
    expect(passed.frozen.approvedBy).toBe('human')
  })

  it('改一个字节（没重投影）→ 拒绝，报「criteria.json 自证失败」并给出两侧版本', () => {
    const { root, projected } = frozenRepo()
    tamperByte(root)
    const text = readFileSync(criteriaPath(root), 'utf8')
    const error = expectFrozenError(() => guardCriteria({ repoRoot: root, criteriaText: text }))

    expect(error.side).toBe('criteria-self')
    expect(error.message).toContain('自证失败')
    expect(error.message).toContain(projected.version) // 文件里自己写的那个
    expect(error.message).toContain(reversionFromText(text).version) // 按全文重算的那个
    expect(error.message).toContain(NODE_PROJECT_WRITE)
    expect(error.criteriaVersion).toBe(reversionFromText(text).version)
    expect(error.frozenVersion).toBe(projected.version)
  })

  it('改了判据又重投影（自证过了，但没重新冻结）→ 拒绝，指出「判据集那一侧变了」', () => {
    const { root, projected } = frozenRepo()
    // 判据集变了：往 rules 里加一条，再按正常通道重投影（version 自证是通的）
    const rulesPath = join(root, 'docs/design/ui-v1/criteria/rules/T.json')
    const rules = JSON.parse(readFileSync(rulesPath, 'utf8'))
    rules.rules.push({ ...rules.rules[0], id: 'T-002', statement: '新增一条判据（模拟判据集变更）' })
    writeFileSync(rulesPath, `${JSON.stringify(rules, null, 2)}\n`)
    const reprojected = projectCriteria({ repoRoot: root, faces: FACES })
    writeFileSync(criteriaPath(root), reprojected.text)
    expect(reprojected.version).not.toBe(projected.version)

    const error = expectFrozenError(() =>
      guardCriteria({ repoRoot: root, criteriaText: readFileSync(criteriaPath(root), 'utf8') }),
    )
    expect(error.side).toBe('drift-criteria')
    expect(error.message).toContain('判据集') // 「判据集那一侧变了」
    expect(error.message).toContain(projected.version)
    expect(error.message).toContain(reprojected.version)
    expect(error.message).toContain('proposals/')
    expect(error.message).toContain(NODE_FREEZE_WRITE)
  })

  it('判据文件没动、只改了 freeze.json 的 version → 拒绝，指出「冻结值那一侧」被改', () => {
    const { root, projected } = frozenRepo()
    const file = JSON.parse(readFileSync(freezePath(root), 'utf8'))
    file.version = 'a'.repeat(64)
    writeFileSync(freezePath(root), `${JSON.stringify(file, null, 2)}\n`)

    const error = expectFrozenError(() =>
      guardCriteria({ repoRoot: root, criteriaText: readFileSync(criteriaPath(root), 'utf8') }),
    )
    expect(error.side).toBe('drift-freeze')
    expect(error.message).toContain('冻结值那一侧')
    expect(error.frozenVersion).toBe('a'.repeat(64))
    expect(error.criteriaVersion).toBe(projected.version)
  })

  it('只动 version 之外的字节（ruleFiles）→ 仍拒绝：冻结值覆盖判据集全文，不只覆盖判据体', () => {
    const { root } = frozenRepo()
    const text = readFileSync(criteriaPath(root), 'utf8')
    const parsed = JSON.parse(text)
    parsed.ruleFiles[0].sha256 = 'b'.repeat(64) // 判据体没变，version 自证仍然成立
    writeFileSync(criteriaPath(root), `${JSON.stringify(parsed, null, 2)}\n`)
    expect(reversionFromText(readFileSync(criteriaPath(root), 'utf8')).version).toBe(parsed.version)

    const error = expectFrozenError(() =>
      guardCriteria({ repoRoot: root, criteriaText: readFileSync(criteriaPath(root), 'utf8') }),
    )
    expect(error.side).toBe('drift-criteria')
    expect(error.message).toContain('全文')
  })

  it('不信调用方递来的 document：document 声明的 version 与全文重算不一致 → 拒绝', () => {
    const { root, projected } = frozenRepo()
    const text = readFileSync(criteriaPath(root), 'utf8')
    const lying = { ...reversionFromText(text).document, version: 'c'.repeat(64) }
    const error = expectFrozenError(() => guardCriteria({ repoRoot: root, criteriaText: text, document: lying }))
    expect(error.side).toBe('criteria-self')
    expect(error.criteriaVersion).toBe(projected.version)
  })
})

describe('票 03 · 巡检启动先校验：失败即拒绝、非零退出、不出报告', () => {
  it('冻结值对不上 → 采集之前就拒绝，且一个报告文件都不建（连目录都不新建）', () => {
    const { root } = frozenRepo()
    tamperByte(root)
    const outDir = join(root, 'reports-should-not-exist')
    let thrown
    try {
      runVerifyUx({ repoRoot: root, faces: FACES, outDir, generatedAt: FROZEN_AT })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(VerifyUxError)
    expect(thrown.exitCode).toBe(3) // 0 = 跑完；2 = 体检自己没跑成；3 = 判据被改，需人确认
    expect(thrown.message).toContain('判据已变更，需人确认')
    expect(existsSync(outDir)).toBe(false)
    expect(existsSync(join(root, 'ux-reports'))).toBe(false)
  })

  it('冻结值缺失 → 同样拒绝（不拿一份没冻过的考卷判分）', () => {
    const { root } = tempRepo()
    const thrown = (() => {
      try {
        runVerifyUx({ repoRoot: root, faces: FACES, write: false, generatedAt: FROZEN_AT })
      } catch (error) {
        return error
      }
      return null
    })()
    expect(thrown).toBeInstanceOf(VerifyUxError)
    expect(thrown.exitCode).toBe(3)
    expect(thrown.message).toContain('判据已变更，需人确认')
  })

  it('冻结值对得上 → 跑得通，并把「冻结值已校验」如实写进报告', () => {
    const { root } = frozenRepo()
    const { report, exitCode } = runVerifyUx({ repoRoot: root, faces: FACES, write: false, generatedAt: FROZEN_AT })
    expect(exitCode).toBe(0)
    expect(report.collection.notes.join('\n')).toContain('冻结值')
  })
})

describe('票 03 · 命令面：verify-ux 退出码 3 / freeze.mjs --write|--check', () => {
  function runNode(script, args, cwd = REPO_ROOT) {
    return spawnSync(process.execPath, [join(REPO_ROOT, script), ...args], { cwd, encoding: 'utf8' })
  }

  it('verify-ux 遇到冻结值对不上 → 退出码 3（不是 0 也不是 2），并在 stderr 说清是哪一侧', () => {
    const { root } = frozenRepo()
    tamperByte(root)
    const result = runNode('scripts/verify-ux.mjs', ['--repo', root])
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('判据已变更，需人确认')
    expect(result.stderr).toContain('自证失败')
    expect(existsSync(join(root, 'ux-reports'))).toBe(false)
  })

  it('freeze.mjs --check 一致 → 0；改一个字节 → 3', () => {
    const { root, projected } = frozenRepo()
    const ok = runNode('scripts/ux/freeze.mjs', ['--check', '--repo', root])
    expect(ok.status).toBe(0)
    expect(ok.stdout).toContain(projected.version.slice(0, 12))

    tamperByte(root)
    const bad = runNode('scripts/ux/freeze.mjs', ['--check', '--repo', root])
    expect(bad.status).toBe(3)
    expect(bad.stderr).toContain('判据已变更，需人确认')
  })

  it('freeze.mjs --write 是人的签字那一击：写出冻结值（带 note），随后 --check 通过', () => {
    const { root } = tempRepo()
    const written = runNode('scripts/ux/freeze.mjs', ['--write', '--repo', root, '--note', '票 03 首次冻结'])
    expect(written.status).toBe(0)
    expect(written.stdout).toContain(projectedVersionOf(root).slice(0, 12))
    expect(JSON.parse(readFileSync(freezePath(root), 'utf8')).note).toBe('票 03 首次冻结')

    expect(runNode('scripts/ux/freeze.mjs', ['--check', '--repo', root]).status).toBe(0)
  })

  it('verify-ux --help 立「签字只有两处」的口径（日常巡检零签字）', () => {
    const help = runNode('scripts/verify-ux.mjs', ['--help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('签字只有两处')
    expect(help.stdout).toContain('freeze.mjs --write')
  })
})

describe('票 03 · 提案区与生效区物理分开', () => {
  function writeProposal(root, name, body) {
    const dir = join(root, 'docs/design/ui-v1/criteria/proposals')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), `${JSON.stringify(body, null, 2)}\n`)
  }

  const PROPOSAL = {
    status: 'proposed',
    proposedBy: 'ai',
    proposedAt: '2026-10-30',
    reason: '模拟 AI 提的新判据',
    criterion: {
      id: 'T-999',
      statement: '面板标题必须使用 token 字号档',
      check: 'static',
      evidence: 'file-line',
      severity: 'minor',
      appliesTo: { kind: 'all' },
      source: { file: 'docs/design/ui-v1/shared/设计token字典.md', anchor: '### 0.4 禁则' },
    },
  }

  it('新增提案不改变生效判据：version 不变、冻结守卫照样通过、兑现率不动', () => {
    const { root, projected } = frozenRepo()
    const before = runVerifyUx({ repoRoot: root, faces: FACES, write: false, generatedAt: FROZEN_AT })
    writeProposal(root, 'T-999-panel-title-token.json', PROPOSAL)

    expect(projectCriteria({ repoRoot: root, faces: FACES }).version).toBe(projected.version)
    expect(guardCriteria({ repoRoot: root, criteriaText: readFileSync(criteriaPath(root), 'utf8') }).version).toBe(
      projected.version,
    )
    const after = runVerifyUx({ repoRoot: root, faces: FACES, write: false, generatedAt: FROZEN_AT })
    expect(after.report.rate).toEqual(before.report.rate)
    // 提案也不进投影产物：生效判据里没有它
    expect(reversionFromText(readFileSync(criteriaPath(root), 'utf8')).document.criteria).toHaveLength(1)
  })

  it('提案区是真实存在的目录 + README 写明批准链路（人搬进 rules/ → 重投影 → 重新冻结）', () => {
    const proposalsDir = join(REPO_ROOT, 'docs/design/ui-v1/criteria/proposals')
    expect(existsSync(proposalsDir)).toBe(true)
    const readme = readFileSync(join(proposalsDir, 'README.md'), 'utf8')
    expect(readme).toContain('proposals/')
    expect(readme).toContain('rules/')
    expect(readme).toContain('project.mjs --write')
    expect(readme).toContain('freeze.mjs --write')
    expect(readme).toMatch(/AI/)
    // 提案区里只有提案，没有判据生效所需的族文件（生效区不在这里）
    expect(existsSync(join(proposalsDir, 'T.json'))).toBe(false)
  })

  it('巡检只读判据：跑一轮不动 criteria.json 与 freeze.json 的字节', () => {
    const { root } = frozenRepo()
    const before = sha256(readFileSync(criteriaPath(root), 'utf8'))
    const freezeBefore = sha256(readFileSync(freezePath(root), 'utf8'))
    runVerifyUx({ repoRoot: root, faces: FACES, write: false, generatedAt: FROZEN_AT })
    expect(sha256(readFileSync(criteriaPath(root), 'utf8'))).toBe(before)
    expect(sha256(readFileSync(freezePath(root), 'utf8'))).toBe(freezeBefore)
  })
})

describe('票 03 · 仓库自身的冻结值', () => {
  it('提交进仓库的 freeze.json 与 criteria.json 对得上（防止提交一个已经漂了的冻结值）', () => {
    const text = readFileSync(join(REPO_ROOT, CRITERIA_FILE), 'utf8')
    const guard = guardCriteria({ repoRoot: REPO_ROOT, criteriaText: text })
    expect(guard.version).toBe(reversionFromText(text).version)
    expect(readFreeze({ repoRoot: REPO_ROOT }).version).toBe(guard.version)
  })
})

/** 读一份已落盘 criteria.json 的重算版本（CLI 断言用）。 */
function projectedVersionOf(root) {
  return reversionFromText(readFileSync(criteriaPath(root), 'utf8')).version
}
