/**
 * 快速启动入口（`pnpm serve:xuanshu` / `scripts/experience/serve.mjs`）的**纯函数**断言。
 *
 * 这一层只钉三件事，它们是「一条命令就能上手」的全部风险点：
 *   ① **选哪个 home**：`--home` ＞ `$XUANSHU_DSH_HOME` ＞ 有记录的评估 home（含主检出那份）＞ 开发 home ＞ 新建；
 *   ② **不许碰真实 DSH home**：解析结果等于或位于 `~/.dsh` 下必须当场拒绝（与 `startup.mjs` 同一条规矩）；
 *   ③ **没配模型要提前说**：`<home>/.credentials.yaml` 不在就先提醒，别让人对着报错猜。
 *
 * 真起实例那一段**不在这里跑**（它会 spawn DSH、开端口）：由 `tests/experience/run-e2e.test.mjs`
 * 与手工验证覆盖；本文件末尾只用 `--help` / `--list` 证明 CLI 能跑起来。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  credentialsHint,
  homeCandidates,
  listCandidateHomes,
  mainCheckoutRoot,
  resolveServeHome,
  serveBanner,
} from '../../scripts/experience/serve.mjs'

const SCRIPT = fileURLToPath(new URL('../../scripts/experience/serve.mjs', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const REAL = resolve('C:/Users/nobody/.dsh')

const made = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function repoFixture() {
  const root = mkdtempSync(join(tmpdir(), 'serve-test-'))
  made.push(root)
  return root
}

describe('mainCheckoutRoot · 从 worktree 跑时回溯主检出', () => {
  it('`<主检出>/.scratch/worktrees/<名字>` → 主检出根', () => {
    const root = resolve('E:/proj/XuanShu')
    expect(mainCheckoutRoot(join(root, '.scratch', 'worktrees', 'spec-004-integration'))).toBe(root)
  })

  it('主检出自己（不在 .scratch 下）→ undefined', () => {
    expect(mainCheckoutRoot(resolve('E:/proj/XuanShu'))).toBeUndefined()
  })
})

describe('homeCandidates · 顺序即优先级', () => {
  it('worktree 里跑：本捡出的评估 home 先排，其后是主检出的那份', () => {
    const repoRoot = resolve('E:/proj/XuanShu/.scratch/worktrees/wt')
    const rows = homeCandidates({ repoRoot, mainRoot: resolve('E:/proj/XuanShu') })
    expect(rows[0].home).toBe(resolve(repoRoot, '.experience-home', 'round-01'))
    expect(rows[1].home).toBe(resolve('E:/proj/XuanShu', '.experience-home', 'round-01'))
    expect(rows[1].source).toContain('主检出')
    expect(rows.at(-1).home).toBe(resolve(repoRoot, '.experience-home', 'serve'))
  })

  it('同一个根时不重复列（主检出自己跑）', () => {
    const repoRoot = resolve('E:/proj/XuanShu')
    const rows = homeCandidates({ repoRoot, mainRoot: repoRoot })
    const homes = rows.map((row) => row.home)
    expect(new Set(homes).size).toBe(homes.length)
  })
})

describe('resolveServeHome · 优先级（--home ＞ 环境变量 ＞ 候选）', () => {
  it('`--home` 压过环境变量，且被解析成绝对路径', () => {
    const repoRoot = repoFixture()
    const picked = resolveServeHome({ repoRoot, explicit: 'D:/xuanshu-home', env: { XUANSHU_DSH_HOME: 'E:/from-env' }, realHome: REAL })
    expect(picked.source).toBe('--home')
    expect(picked.home).toBe(resolve('D:/xuanshu-home'))
  })

  it('没有 `--home` 时用 `$XUANSHU_DSH_HOME`', () => {
    const repoRoot = repoFixture()
    const picked = resolveServeHome({ repoRoot, env: { XUANSHU_DSH_HOME: 'E:/from-env' }, realHome: REAL })
    expect(picked.source).toBe('$XUANSHU_DSH_HOME')
    expect(picked.home).toBe(resolve('E:/from-env'))
  })

  it('都没有时：**优先有记录的评估 home**（第一次上手就能看到历史列表）', () => {
    const repoRoot = repoFixture()
    mkdirSync(join(repoRoot, '.experience-home', 'round-01'), { recursive: true })
    mkdirSync(join(repoRoot, '.dsh-home'), { recursive: true })
    const picked = resolveServeHome({ repoRoot, env: {}, realHome: REAL })
    expect(picked.home).toBe(resolve(repoRoot, '.experience-home', 'round-01'))
  })

  it('本检出没有、**主检出有**时：用主检出那份（worktree 里也能看到 13 条记录）', () => {
    const repoRoot = repoFixture()
    const mainRoot = repoFixture()
    mkdirSync(join(mainRoot, '.experience-home', 'round-01'), { recursive: true })
    const picked = resolveServeHome({ repoRoot, mainRoot, env: {}, realHome: REAL })
    expect(picked.home).toBe(resolve(mainRoot, '.experience-home', 'round-01'))
    expect(picked.source).toContain('主检出')
  })

  it('评估 home 不在时退到开发 home', () => {
    const repoRoot = repoFixture()
    mkdirSync(join(repoRoot, '.dsh-home'), { recursive: true })
    const picked = resolveServeHome({ repoRoot, env: {}, realHome: REAL })
    expect(picked.home).toBe(resolve(repoRoot, '.dsh-home'))
  })

  it('两个都没有时退到最后一条候选（目录由启动时建出来）', () => {
    const repoRoot = repoFixture()
    const picked = resolveServeHome({ repoRoot, env: {}, realHome: REAL })
    expect(picked.home).toBe(resolve(repoRoot, '.experience-home', 'serve'))
    expect(picked.source).toContain('新建')
  })
})

describe('resolveServeHome · 隔离硬规矩', () => {
  it('指向真实 `~/.dsh` 本身：拒绝', () => {
    const repoRoot = repoFixture()
    expect(() => resolveServeHome({ repoRoot, explicit: 'C:/Users/nobody/.dsh', env: {}, realHome: REAL })).toThrow(/真实的 DSH home/u)
  })

  it('位于真实 home **之下**：一样拒绝（子目录不算「换个地方」）', () => {
    const repoRoot = repoFixture()
    expect(() => resolveServeHome({ repoRoot, explicit: 'C:/Users/nobody/.dsh/serve', env: {}, realHome: REAL })).toThrow(/真实的 DSH home/u)
  })

  it('名字相近但不是它（`.dsh-home`）：放行', () => {
    const repoRoot = repoFixture()
    const picked = resolveServeHome({ repoRoot, explicit: 'C:/Users/nobody/.dsh-home', env: {}, realHome: REAL })
    expect(picked.home).toBe(resolve('C:/Users/nobody/.dsh-home'))
  })
})

describe('serveBanner / credentialsHint · 屏幕上必须看见的事', () => {
  it('banner：home、带 token 的 URL、怎么停', () => {
    const lines = serveBanner({ home: 'E:/xhome', url: 'http://127.0.0.1:19388/?token=abc' })
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('E:/xhome')
    expect(lines[1]).toContain('http://127.0.0.1:19388/?token=abc')
    expect(lines[2]).toContain('Ctrl+C')
  })

  it('没有凭据：提前说明会走到「未配模型」那条路', () => {
    const home = 'E:/xhome'
    expect(credentialsHint({ home, exists: () => true })).toBeUndefined()
    expect(credentialsHint({ home, exists: () => false })).toContain('没配模型')
  })
})

describe('listCandidateHomes · --list 的数字来自旁挂目录', () => {
  it('存在的标 present，记录数照 `<home>/xuanshu/consult/sessions/*.json` 数', () => {
    const repoRoot = repoFixture()
    const home = join(repoRoot, '.experience-home', 'round-01')
    mkdirSync(join(home, 'xuanshu', 'consult', 'sessions'), { recursive: true })
    writeFileSync(join(home, 'xuanshu', 'consult', 'sessions', 'session-xs-consult-a.json'), '{}', 'utf8')
    writeFileSync(join(home, 'xuanshu', 'consult', 'sessions', 'session-xs-consult-b.json'), '{}', 'utf8')

    const rows = listCandidateHomes({ repoRoot })
    const first = rows[0]
    expect(first.present).toBe(true)
    expect(first.consultRecords).toBe(2)
    expect(rows.slice(1).every((row) => row.present === false && row.consultRecords === 0)).toBe(true)
  })
})

describe('CLI · 不启动也能用的两条路', () => {
  it('`--help`：退出码 0，说明里有用法与隔离规矩', () => {
    const out = execFileSync(process.execPath, [SCRIPT, '--help'], { cwd: REPO_ROOT, encoding: 'utf8' })
    expect(out).toContain('pnpm serve:xuanshu')
    expect(out).toContain('--home')
    expect(out).toContain('真实 ~/.dsh')
  })

  it('`--list`：列出候选 home，一个实例都不起', () => {
    const out = execFileSync(process.execPath, [SCRIPT, '--list'], { cwd: REPO_ROOT, encoding: 'utf8' })
    expect(out).toContain(resolve(REPO_ROOT, '.experience-home', 'round-01'))
    expect(out).toContain(resolve(REPO_ROOT, '.dsh-home'))
    expect(out).toMatch(/还没建|条问事记录/u)
  })
})
