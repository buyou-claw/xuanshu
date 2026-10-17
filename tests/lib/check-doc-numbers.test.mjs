/**
 * tests/lib/check-doc-numbers.test.mjs —— **文档数字门自己的判据**（票 E3 / #43）。
 *
 * 被测：`scripts/check-doc-numbers.mjs`（CLI：`--root` / `--inventory` / `--artifact` /
 * `--readme` / `--status`，exit 0 = 一致，exit 1 = 漂移，exit 2 = 没法验）。
 *
 * 为什么是合成目录而不是真仓库：真仓库当前数字是绿的，**绿不能证明抓得住红**。
 * 这里每一处漂移都是当场注入的（改一个字、删一个文件），判据必须点出
 * 「文件:行 + 期望 + 实际 + 原文」，并且**多处漂移要全部列出**（不能报一条就停）。
 *
 * 另一半同样重要：**只认当前验证块**。合成文档里塞了历史章节 / 历史状态行
 * （§11 的 `[inventory] 用例 900 条`、README `## 历史` 的旧数字），它们**不许**被当成漂移。
 * 真仓库 §11/§12/§13 里就有同类旧数字（见 `docs/development-status.md`）。
 *
 * 环境：真文件系统（临时目录）、零网络、秒级；每个用例都是 spawn 真脚本，不 import 内部函数。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, '../../scripts/check-doc-numbers.mjs')

const litter = []
afterEach(() => {
  for (const path of litter.splice(0)) rmSync(path, { recursive: true, force: true })
})

/** 跑一次门；返回 {status, stdout, stderr, output}。 */
function run(args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  return { status: result.status, stdout, stderr, output: `${stdout}${stderr}` }
}

/** 按 needle 找 1-based 行号（测试独立算行号，不抄被测实现的写法）。 */
function lineOf(text, needle, occurrence = 0) {
  const hits = []
  text.split(/\r?\n/u).forEach((line, index) => {
    if (line.includes(needle)) hits.push(index + 1)
  })
  expect(hits.length, `夹具里找不到「${needle}」`).toBeGreaterThan(occurrence)
  return hits[occurrence]
}

/** 改第一个含 needle 的行（注入漂移用；改不到就当场炸夹具）。 */
function editLine(text, needle, edit, occurrence = 0) {
  const lines = text.split('\n')
  const hits = []
  lines.forEach((line, index) => {
    if (line.includes(needle)) hits.push(index)
  })
  expect(hits.length, `夹具里找不到「${needle}」`).toBeGreaterThan(occurrence)
  lines[hits[occurrence]] = edit(lines[hits[occurrence]])
  return lines.join('\n')
}

/**
 * 造一个合成仓库：真源 + 产物 + README 当前状态段 + development-status 的 §16.3 / §16.6 当前块。
 * 历史章节里故意放**旧数字**（§11、README `## 历史`）——门必须只核当前块。
 */
function makeRepo({ total = 7, fileCount = 3, bytes = 1234 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'doc-numbers-'))
  litter.push(root)
  const write = (rel, text) => {
    const file = join(root, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
    return file
  }

  const inventory = { total, files: {} }
  for (let index = 0; index < fileCount; index += 1) inventory.files[`tests/f${index}.test.mjs`] = index === 0 ? 5 : 1
  const inventoryText = `${JSON.stringify(inventory, null, 2)}\n`
  write('tests/test-inventory.json', inventoryText)
  write('packages/xuanshu-client/lib/client.js', 'x'.repeat(bytes))

  const readme = [
    '# XuanShu（合成夹具）',
    '',
    '## 历史',
    '',
    '- 旧验证（历史，不许被当成漂移）：`pnpm test:inventory` → **900 条用例 / 80 文件**；`build-client --check` in sync（999 B）。',
    '',
    '## 状态',
    '',
    `- 验证（数字抄工具输出）：\`pnpm test:inventory\` → **${total} 条用例 / ${fileCount} 文件 / 失败 0 条**；\`build-client --check\` in sync（${bytes} B）。`,
    '',
    '## 许可',
    '',
    'AGPL-3.0-only。',
    '',
  ].join('\n')
  write('README.md', readme)

  const status = [
    '# 开发进度（合成夹具）',
    '',
    '### 11. 历史章节（旧数字，不许被当成漂移）',
    '',
    '```',
    '[inventory] 用例 900 条（基线 900）/ 文件 80 个 / 失败 0 条 / 跳过 0 条',
    '[S3] PASS 客户端产物 999B；物化/注册/槽位自检全过',
    '```',
    '',
    '### 16. Spec 002（合成夹具）',
    '',
    '#### 16.3 验证（数字全部抄工具输出）',
    '',
    '```',
    '# pnpm test:inventory（合成夹具）',
    `[inventory] 用例 ${total} 条（基线 ${total}）/ 文件 ${fileCount} 个 / 失败 2 条（已知红 2 条） / 文件级失败 0 个 / 跳过 10 条 / vitest exit 1`,
    `[S3] PASS 客户端产物 ${bytes}B；物化/注册/槽位自检全过`,
    '```',
    '',
    `\`pnpm verify:all\` exit 0；清单基线已按最终用例数 \`--update\`（${total} / ${fileCount}）。`,
    '',
    '#### 16.4 陷阱（历史正文，不许被当成漂移）',
    '',
    '```',
    '[inventory] 用例 900 条（基线 900）/ 文件 80 个',
    '```',
    '',
    '#### 16.6 第二轮两轴审查与修复轮（合成夹具）',
    '',
    '```',
    `[inventory] 用例 ${total} 条（基线 ${total}）/ 文件 ${fileCount} 个 / 失败 2 条（已知红 2 条） / 跳过 10 条 / vitest exit 1`,
    `# tsc --noEmit exit 0；build-client --check in sync（${bytes}B）`,
    '```',
    '',
  ].join('\n')
  write('docs/development-status.md', status)

  return {
    root,
    readme,
    status,
    /** 覆盖一份文档（返回新内容，便于链式改多处）。 */
    write,
    inventoryPath: join(root, 'tests/test-inventory.json'),
    artifactPath: join(root, 'packages/xuanshu-client/lib/client.js'),
  }
}

/* ───────────────────────── 1. 一致 → exit 0 ───────────────────────── */

describe('E3 · 一致：当前验证块的数字与工具源相同', () => {
  it('合成仓库一致 → exit 0，打印一行 summary（真值来自 inventory / 产物）', () => {
    const repo = makeRepo({ total: 7, fileCount: 3, bytes: 1234 })
    const result = run(['--root', repo.root])
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[doc-numbers] OK')
    // summary 里要带真值（一行、可抄进 PR）。
    expect(result.stdout).toContain('7 条用例')
    expect(result.stdout).toContain('3 个文件')
    expect(result.stdout).toContain('1234 B')
    expect(result.stdout).not.toContain('不一致')
  })
})

/* ───────────────────────── 2. 漂移 → exit 1 ───────────────────────── */

describe('E3 · 漂移：文档数字与工具源不一致', () => {
  it('把 README 的用例数改错 → exit 1，点名「文件:行、期望、实际、原文片段」', () => {
    const repo = makeRepo({ total: 7, fileCount: 3, bytes: 1234 })
    const wrong = editLine(repo.readme, '验证（数字抄工具输出）', (line) => line.replace('7 条用例', '8 条用例'))
    repo.write('README.md', wrong)
    const result = run(['--root', repo.root])
    expect(result.status).toBe(1)
    expect(result.output).toContain(`README.md:${lineOf(wrong, '8 条用例')}`)
    expect(result.output).toContain('用例数')
    expect(result.output).toContain('期望 7')
    expect(result.output).toContain('实际 8')
    expect(result.output).toMatch(/原文[:：]/u)
    expect(result.output).toContain('8 条用例')
  })

  it('多处漂移（README 文件数 / §16.3 产物字节 / §16.3 清单基线对 / §16.6 用例数）→ 全部列出', () => {
    const repo = makeRepo({ total: 7, fileCount: 3, bytes: 1234 })
    let readme = editLine(repo.readme, '文件 /', (line) => line.replace('3 文件', '4 文件'))
    // 第二处 `客户端产物`（第一处在 §11 历史块里，不算漂移）。
    let status = editLine(repo.status, '客户端产物', (line) => line.replace('1234B', '1235B'), 1)
    status = editLine(status, '清单基线已按最终用例数', (line) => line.replace('（7 / 3）', '（7 / 4）'))
    // §16.6 的 inventory 行（第二处 `[inventory]`，第一处是 §16.3）
    status = editLine(status, '（基线 7）', (line) => line.replace('用例 7 条', '用例 9 条'), 1)
    repo.write('README.md', readme)
    repo.write('docs/development-status.md', status)

    const result = run(['--root', repo.root])
    expect(result.status).toBe(1)
    expect(result.output).toContain(`README.md:${lineOf(readme, '文件 /')}`)
    expect(result.output).toContain(`docs/development-status.md:${lineOf(status, '客户端产物', 1)}`)
    expect(result.output).toContain(`docs/development-status.md:${lineOf(status, '清单基线已按最终用例数')}`)
    expect(result.output).toContain(`docs/development-status.md:${lineOf(status, '（基线 7）', 1)}`)
    // 四条各自点名，不许报一条就停。
    expect(result.output.match(/不一致/gu) ?? []).toHaveLength(4)
  })

  it('真源变了（产物字节变大）→ 文档没跟上就是 drift：期望 = 新真值，实际 = 文档里的旧值', () => {
    const repo = makeRepo({ total: 7, fileCount: 3, bytes: 1234 })
    writeFileSync(repo.artifactPath, 'y'.repeat(2222))
    const result = run(['--root', repo.root])
    expect(result.status).toBe(1)
    expect(result.output).toContain('期望 2222')
    expect(result.output).toContain('实际 1234')
  })
})

/* ───────────────────────── 3. 只认当前验证块（历史数字不判漂移） ───────────────────────── */

describe('E3 · 只核当前验证块：历史数字不算漂移', () => {
  it('README ## 历史 / development-status §11、§16.4 里的旧数字不影响 → exit 0', () => {
    const repo = makeRepo({ total: 7, fileCount: 3, bytes: 1234 })
    const result = run(['--root', repo.root])
    expect(result.status).toBe(0)
    expect(result.output).not.toContain('900')
    expect(result.output).not.toContain('999')
    expect(result.output).not.toContain('不一致')
  })
})

/* ───────────────────────── 4. 没法验 → exit 2（与「验了但红了」分开） ───────────────────────── */

describe('E3 · 真源缺失 / 当前块缺失 → 可读失败（exit 2）', () => {
  it('inventory 真源缺失 → exit 2，点名文件与原因', () => {
    const repo = makeRepo()
    rmSync(repo.inventoryPath)
    const result = run(['--root', repo.root])
    expect(result.status).toBe(2)
    expect(result.output).toContain('test-inventory.json')
  })

  it('inventory 真源坏 JSON → exit 2，说得出「读不出来」', () => {
    const repo = makeRepo()
    writeFileSync(repo.inventoryPath, '{ not json')
    const result = run(['--root', repo.root])
    expect(result.status).toBe(2)
    expect(result.output).toMatch(/读不出来|解析|JSON/u)
    expect(result.output).toContain('test-inventory.json')
  })

  it('客户端产物缺失 → exit 2，点名产物路径', () => {
    const repo = makeRepo()
    rmSync(repo.artifactPath)
    const result = run(['--root', repo.root])
    expect(result.status).toBe(2)
    expect(result.output).toContain('client.js')
  })

  it('§16.6 当前验证块缺失 → exit 2，点名 16.6（不是静默放过）', () => {
    const repo = makeRepo()
    const stripped = repo.status.split('\n').filter((line) => !line.includes('16.6')).join('\n')
    repo.write('docs/development-status.md', stripped)
    const result = run(['--root', repo.root])
    expect(result.status).toBe(2)
    expect(result.output).toContain('16.6')
  })

  it('README 没有「## 状态」段 → exit 2，点名 README 与「状态」', () => {
    const repo = makeRepo()
    const stripped = repo.readme.split('\n').filter((line) => !line.includes('## 状态')).join('\n')
    repo.write('README.md', stripped)
    const result = run(['--root', repo.root])
    expect(result.status).toBe(2)
    expect(result.output).toContain('README.md')
    expect(result.output).toContain('状态')
  })

  it('§16.3 当前块里认不出数字（行还在、数字没了）→ exit 2，不猜', () => {
    const repo = makeRepo()
    // 第二处 `客户端产物`（第一处在 §11 历史块里）：把 §16.3 的 S3 行改成没有字节数。
    const broken = editLine(repo.status, '客户端产物', (line) => line.replace('客户端产物 1234B', '客户端产物（没写字节）'), 1)
    repo.write('docs/development-status.md', broken)
    const result = run(['--root', repo.root])
    expect(result.status).toBe(2)
    expect(result.output).toContain('客户端产物')
  })
})

/* ───────────────────────── 5. 注入面（合成目录不靠真实漂移） ───────────────────────── */

describe('E3 · 注入面：--inventory / --artifact / --readme / --status', () => {
  it('真源与文档全改到自定义相对路径 → 仍能核对（一致 exit 0）', () => {
    // 真源与文档都用同一组自定义数字（11 / 4 / 4321），只是换路径 —— 证明注入面不靠真实漂移。
    const repo = makeRepo({ total: 11, fileCount: 4, bytes: 4321 })
    mkdirSync(join(repo.root, 'data'), { recursive: true })
    mkdirSync(join(repo.root, 'out'), { recursive: true })
    mkdirSync(join(repo.root, 'spec'), { recursive: true })
    writeFileSync(join(repo.root, 'data/inv.json'), `${JSON.stringify({ total: 11, files: { 'a': 1, 'b': 1, 'c': 1, 'd': 8 } })}\n`)
    writeFileSync(join(repo.root, 'out/client.js'), 'z'.repeat(4321))
    writeFileSync(join(repo.root, 'spec/README.md'), repo.readme)
    writeFileSync(join(repo.root, 'spec/progress.md'), repo.status)

    const result = run([
      '--root', repo.root,
      '--inventory', 'data/inv.json',
      '--artifact', 'out/client.js',
      '--readme', 'spec/README.md',
      '--status', 'spec/progress.md',
    ])
    expect(result.status, result.output).toBe(0)
    expect(result.stdout).toContain('11 条用例')
    expect(result.stdout).toContain('4 个文件')
    expect(result.stdout).toContain('4321 B')
  })

  it('未知参数 → exit 2（不静默忽略）', () => {
    const repo = makeRepo()
    const result = run(['--root', repo.root, '--nope'])
    expect(result.status).toBe(2)
    expect(result.output).toContain('--nope')
  })
})

/* ───────────────────────── 6. 真仓库初始绿（不靠漂移） ───────────────────────── */

describe('E3 · 当前仓库初始即绿', () => {
  it('真仓库（默认参数）exit 0，summary 的字节数 = 磁盘上 client.js 的 statSync 字节', () => {
    const REPO_ROOT = resolve(import.meta.dirname, '../..')
    const result = run([])
    expect(result.stderr, result.output).toBe('')
    expect(result.status).toBe(0)
    const bytes = statSync(join(REPO_ROOT, 'packages/xuanshu-client/lib/client.js')).size
    expect(result.stdout).toContain(`${bytes} B`)
  })
})
