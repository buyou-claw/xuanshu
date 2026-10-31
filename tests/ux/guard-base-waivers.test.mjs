/**
 * `tests/ux/guard-base-waivers.test.mjs` —— 护栏基准与历史豁免清单（spec 003 §修复通道 · 2026-10-31 补丁）。
 *
 * 这两个模块存在的理由都是「一条实测出来的洞」：
 *   - 基准写死集成分支 → 在集成分支自己身上跑，范围是空集，护栏真空通过；
 *   - 历史中间态没有出口 → 要么重写已推送的历史，要么静默关掉护栏。
 * 所以用例要能证明的不是「函数返回什么」，而是「洞真的堵上了、且没把别的地方堵死」。
 */
import { describe, expect, it } from 'vitest'

import { INTEGRATION_BRANCH, TRUNK_BRANCH, resolveBaseRef } from '../../scripts/ux/guard-base.mjs'
import {
  WAIVER_FILE,
  WAIVER_SCHEMA,
  WaiverError,
  applyWaivers,
  readWaivers,
} from '../../scripts/ux/waivers.mjs'
import { createTempRepo } from './lib/temp-git.mjs'

/** 造一个主干 + 集成分支 + 一条票分支的仓库。 */
function repoWithBranches() {
  const repo = createTempRepo()
  repo.write('README.md', '# x\n')
  repo.commitAll('init')
  repo.git(['branch', '-M', TRUNK_BRANCH])
  repo.git(['branch', INTEGRATION_BRANCH])
  repo.git(['checkout', '-q', '-b', 'feature/one'])
  return repo
}

describe('guard-base · 基准按当前分支解析（写死任何一侧都会出事）', () => {
  it('在主干上：基准就是主干（范围为空是正确答案，不是漏看）', () => {
    const repo = repoWithBranches()
    try {
      repo.git(['checkout', '-q', TRUNK_BRANCH])
      const base = resolveBaseRef({ repoRoot: repo.root })
      expect(base.ref).toBe(TRUNK_BRANCH)
      expect(base.branch).toBe(TRUNK_BRANCH)
      expect(base.reason).toContain('基准就是它自己')
    } finally {
      repo.remove()
    }
  })

  it('在集成分支上：基准落到主干（否则 `集成分支..HEAD` = 0 个提交，真空通过）', () => {
    const repo = repoWithBranches()
    try {
      repo.git(['checkout', '-q', INTEGRATION_BRANCH])
      const base = resolveBaseRef({ repoRoot: repo.root })
      expect(base.ref).toBe(TRUNK_BRANCH)
      expect(base.reason).toContain('拿自己比自己')
    } finally {
      repo.remove()
    }
  })

  it('在票分支上：基准是集成分支（只看本票引入的改动）', () => {
    const repo = repoWithBranches()
    try {
      const base = resolveBaseRef({ repoRoot: repo.root })
      expect(base.ref).toBe(INTEGRATION_BRANCH)
      expect(base.branch).toBe('feature/one')
    } finally {
      repo.remove()
    }
  })

  it('没有集成分支时退回主干（不是报错）', () => {
    const repo = createTempRepo()
    try {
      repo.write('README.md', '# x\n')
      repo.commitAll('init')
      repo.git(['branch', '-M', TRUNK_BRANCH])
      repo.git(['checkout', '-q', '-b', 'feature/two'])
      expect(resolveBaseRef({ repoRoot: repo.root }).ref).toBe(TRUNK_BRANCH)
    } finally {
      repo.remove()
    }
  })

  it('显式 --since 优先于一切推断', () => {
    const repo = repoWithBranches()
    try {
      const base = resolveBaseRef({ repoRoot: repo.root, explicit: 'HEAD~0' })
      expect(base.ref).toBe('HEAD~0')
      expect(base.reason).toContain('显式')
    } finally {
      repo.remove()
    }
  })
})

describe('waivers · 清单本身要能被证伪', () => {
  function writeWaivers(repo, body) {
    repo.write(WAIVER_FILE, typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`)
    return repo.root
  }

  it('没有清单 = 没有豁免（正常状态，不是错）', () => {
    const repo = createTempRepo()
    try {
      expect(readWaivers({ repoRoot: repo.root })).toEqual([])
    } finally {
      repo.remove()
    }
  })

  it('合法清单读得出来，短 sha 与理由都保留', () => {
    const repo = createTempRepo()
    try {
      const root = writeWaivers(repo, {
        schema: WAIVER_SCHEMA,
        waivers: [{ guard: 'authority', sha: 'afab832', kind: 'missing-freeze', reason: '集成中间态', recordedBy: 'buyou' }],
      })
      const [waiver] = readWaivers({ repoRoot: root })
      expect(waiver.sha).toBe('afab832')
      expect(waiver.kind).toBe('missing-freeze')
      expect(waiver.reason).toBe('集成中间态')
    } finally {
      repo.remove()
    }
  })

  it('坏 JSON / 错 schema / 空理由 / 非法 guard 都直接报错（不许静默当没写）', () => {
    const cases = [
      '{ 不是 json',
      { schema: 'wrong@1', waivers: [] },
      { schema: WAIVER_SCHEMA, waivers: [{ guard: 'authority', sha: 'afab832', reason: '   ' }] },
      { schema: WAIVER_SCHEMA, waivers: [{ guard: 'no-such-guard', sha: 'afab832', reason: 'x' }] },
      { schema: WAIVER_SCHEMA, waivers: [{ guard: 'authority', sha: 'XYZ', reason: 'x' }] },
    ]
    for (const body of cases) {
      const repo = createTempRepo()
      try {
        writeWaivers(repo, body)
        expect(() => readWaivers({ repoRoot: repo.root }), JSON.stringify(body)).toThrow(WaiverError)
      } finally {
        repo.remove()
      }
    }
  })
})

describe('waivers · 放行要留痕，过期的要报出来', () => {
  const waivers = [
    { guard: 'authority', sha: 'afab832', kind: 'missing-freeze', reason: '集成中间态', recordedAt: null, recordedBy: null },
    { guard: 'fix-notes', sha: '8fdaa4b', kind: null, reason: 'spec 002 继承红', recordedAt: null, recordedBy: null },
  ]

  it('短 sha 前缀 + kind 精确匹配才放行，其余留着', () => {
    const violations = [
      { kind: 'missing-freeze', sha: 'afab83209a787292f17176130921d9af28e3223f' },
      { kind: 'signature-drift', sha: 'afab83209a787292f17176130921d9af28e3223f' },
      { kind: 'missing-freeze', sha: 'deadbee' },
    ]
    const applied = applyWaivers({ violations, waivers, guard: 'authority' })
    expect(applied.kept).toHaveLength(2)
    expect(applied.kept.map((violation) => violation.sha.slice(0, 7))).toEqual(['afab832', 'deadbee'])
    expect(applied.waived).toHaveLength(1)
    expect(applied.waived[0].count).toBe(1)
  })

  it('kind 缺省 = 该提交的所有同类违规都放行（并按条数记账）', () => {
    const violations = [
      { kind: 'missing-note', sha: '8fdaa4b3dfb5526e6adbaa5111812b0f9d470fba' },
      { kind: 'malformed-note', sha: '8fdaa4b3dfb5526e6adbaa5111812b0f9d470fba' },
    ]
    const applied = applyWaivers({ violations, waivers, guard: 'fix-notes' })
    expect(applied.kept).toEqual([])
    expect(applied.waived[0].count).toBe(2)
  })

  it('别的护栏的清单不越界（authority 的条目不放行 fix-notes 的违规）', () => {
    const violations = [{ kind: 'missing-freeze', sha: 'afab83209a787292f17176130921d9af28e3223f' }]
    const applied = applyWaivers({ violations, waivers, guard: 'fix-notes' })
    expect(applied.kept).toHaveLength(1)
    expect(applied.waived).toEqual([])
  })

  it('工作区违规（没有 sha）不参与豁免 —— 它们现在就该修，不该被历史理由盖住', () => {
    const violations = [{ kind: 'worktree-drift' }]
    const applied = applyWaivers({ violations, waivers, guard: 'authority' })
    expect(applied.kept).toHaveLength(1)
    expect(applied.waived).toEqual([])
  })

  it('对不上任何违规的条目算过期（否则清单会长成没人看的黑名单）', () => {
    const applied = applyWaivers({ violations: [], waivers, guard: 'authority' })
    expect(applied.stale).toHaveLength(1)
    expect(applied.stale[0].sha).toBe('afab832')
  })
})
