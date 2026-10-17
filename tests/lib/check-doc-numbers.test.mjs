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
 * （§11 的 `[inventory] 用例 900 条`、§16.6 的 `[inventory] 用例 1811 条`、README `## 历史` 的旧数字），
 * 它们**不许**被当成漂移。真仓库 §11/§12/§13/§16.6 里就有同类旧数字（见 `docs/development-status.md`）。
 * 反过来，当前块**必须**是 §16.7 与 §16.8：它们缺失或数字被改坏都要红/没法验，不能静默绿。
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
 * 按标题找一节的行区间（0-based，含标题行、不含下一个同级或更高级标题；`occurrence` 选第几个命中）。
 * 用于「只改 §16.8 那一块」的定向注入 —— 与门自己的 `findSection` 是两套独立实现。
 */
function sectionRange(text, headingNeedle, occurrence = 0) {
  const lines = text.split('\n')
  const starts = []
  lines.forEach((line, index) => {
    if (line.includes(headingNeedle)) starts.push(index)
  })
  expect(starts.length, `夹具里找不到「${headingNeedle}」`).toBeGreaterThan(occurrence)
  const start = starts[occurrence]
  const level = (lines[start].match(/^#+/u)?.[0].length) ?? 1
  let end = lines.length
  // 代码围栏里的 `# 注释行` 不是标题（§16.3/§16.8 的代码块第一行就是 `# pnpm …`）。
  let inFence = false
  for (let cursor = start + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor]
    if (/^\s*```/u.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const heading = line.match(/^(#+)\s/u)
    if (heading !== null && heading[1].length <= level) {
      end = cursor
      break
    }
  }
  return { lines, start, end }
}

/** 某一节里第一个含 needle 的行号（1-based，与脚本打印的「文件:行」同口径）。 */
function lineInSection(text, headingNeedle, needle) {
  const { lines, start, end } = sectionRange(text, headingNeedle)
  let index = -1
  for (let cursor = start; cursor < end; cursor += 1) {
    if (lines[cursor].includes(needle)) {
      index = cursor
      break
    }
  }
  expect(index, `「${headingNeedle}」里找不到「${needle}」`).toBeGreaterThanOrEqual(0)
  return index + 1
}

/** 改某一节里的第一处 needle（注入漂移用；改不到就当场炸夹具）。 */
function editInSection(text, headingNeedle, needle, edit) {
  const { lines, start, end } = sectionRange(text, headingNeedle)
  let index = -1
  for (let cursor = start; cursor < end; cursor += 1) {
    if (lines[cursor].includes(needle)) {
      index = cursor
      break
    }
  }
  expect(index, `「${headingNeedle}」里找不到「${needle}」`).toBeGreaterThanOrEqual(0)
  lines[index] = edit(lines[index])
  return lines.join('\n')
}

/**
 * 造一个合成仓库：真源 + 产物 + README 当前状态段 + development-status 的 §16.3 / §16.7 / §16.8 当前块。
 * 历史章节里故意放**旧数字**（§11、§16.6、README `## 历史`）——门必须只核当前块。
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
    '#### 16.6 t33 修复轮（历史：数字属于那一轮，门不许核）',
    '',
    '```',
    '[inventory] 用例 1811 条（基线 1811）/ 文件 164 个 / 失败 2 条（已知红 2 条） / 跳过 10 条 / vitest exit 1',
    '[S3] PASS 客户端产物 522070B；物化/注册/槽位自检全过',
    '# tsc --noEmit exit 0；build-client --check in sync（522070B）',
    '```',
    '',
    '#### 16.7 环境加固轮（当前验证块）',
    '',
    `**验证**：\`pnpm verify:all\` exit 0；\`[doc-numbers] OK：${total} 条用例 / ${fileCount} 个文件 / ${bytes} B\`。`,
    '',
    '#### 16.8 main 全量复核与打磨（当前验证块）',
    '',
    '**最终验证（抄工具输出）**：',
    '',
    '```',
    '# pnpm verify:all → exit 0（类型 + 产物同步 + 清单门 + 文档数字门）',
    `[inventory] 用例 ${total} 条（基线 ${total}）/ 文件 ${fileCount} 个 / 失败 0 条（已知红 0 条） / 文件级失败 0 个 / 跳过 0 条 / vitest exit 0`,
    `[doc-numbers] OK：${total} 条用例 / ${fileCount} 个文件 / ${bytes} B`,
    '',
    '# pnpm verify:assembly → exit 0',
    `[S3] PASS 客户端产物 ${bytes}B；物化/注册/槽位自检全过`,
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

  it('多处漂移（README 文件数 / §16.3 产物字节 / §16.3 清单基线对 / §16.7 文档数字门行）→ 全部列出', () => {
    const repo = makeRepo({ total: 7, fileCount: 3, bytes: 1234 })
    let readme = editLine(repo.readme, '文件 /', (line) => line.replace('3 文件', '4 文件'))
    // 第二处 `客户端产物`（第一处在 §11 历史块里，不算漂移）。
    let status = editLine(repo.status, '客户端产物', (line) => line.replace('1234B', '1235B'), 1)
    status = editLine(status, '清单基线已按最终用例数', (line) => line.replace('（7 / 3）', '（7 / 4）'))
    // §16.7 当前块的 `[doc-numbers] OK` 行（三个数字都要核）。
    status = editLine(status, '[doc-numbers] OK', (line) => line.replace('1234 B', '1235 B'))
    repo.write('README.md', readme)
    repo.write('docs/development-status.md', status)

    const result = run(['--root', repo.root])
    expect(result.status).toBe(1)
    expect(result.output).toContain(`README.md:${lineOf(readme, '文件 /')}`)
    expect(result.output).toContain(`docs/development-status.md:${lineOf(status, '客户端产物', 1)}`)
    expect(result.output).toContain(`docs/development-status.md:${lineOf(status, '清单基线已按最终用例数')}`)
    expect(result.output).toContain(`docs/development-status.md:${lineOf(status, '[doc-numbers] OK')}`)
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

/* ───────── 3b. 当前块 = §16.7（历史 §16.6 让位，三个数字都核） ───────── */

describe('E3 · 当前块 = §16.7：历史 §16.6 不核、当前 §16.7 三个数字都核', () => {
  // 与真实台账同一个规模：1835 条用例 / 167 文件 / 522070 B。
  const REAL = { total: 1835, fileCount: 167, bytes: 522070 }

  it('§16.7 当前块与工具源一致 → exit 0（1835 / 167 / 522070）', () => {
    const repo = makeRepo(REAL)
    const result = run(['--root', repo.root])
    expect(result.stderr, result.output).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('1835 条用例')
    expect(result.stdout).toContain('167 个文件')
    expect(result.stdout).toContain('522070 B')
  })

  it('§16.7 的 1835 / 167 / 522070 任一改坏 → exit 1，点名文件:行、期望、实际', () => {
    const cases = [
      { label: '用例数', from: '1835 条用例', to: '1836 条用例', finding: '用例数', expected: 1835, actual: 1836 },
      { label: '文件数', from: '167 个文件', to: '168 个文件', finding: '文件数', expected: 167, actual: 168 },
      { label: '客户端字节', from: '522070 B', to: '522071 B', finding: '客户端产物字节', expected: 522070, actual: 522071 },
    ]
    for (const item of cases) {
      const repo = makeRepo(REAL)
      const broken = editLine(repo.status, '[doc-numbers] OK', (line) => line.replace(item.from, item.to))
      expect(broken, `夹具里没改到 §16.7 的${item.label}`).not.toBe(repo.status)
      repo.write('docs/development-status.md', broken)
      const result = run(['--root', repo.root])
      const at = lineOf(broken, '[doc-numbers] OK')
      expect(result.status, `${item.label} 改坏应 exit 1：${result.output}`).toBe(1)
      expect(result.output).toContain(`docs/development-status.md:${at}`)
      expect(result.output).toContain(`${item.finding}不一致`)
      expect(result.output).toContain(`期望 ${item.expected}`)
      expect(result.output).toContain(`实际 ${item.actual}`)
      expect(result.output).toMatch(/原文[:：]/u)
    }
  })

  it('历史 §16.6 的旧数字（1811 / 164 / 522070B）不误报 → exit 0', () => {
    const repo = makeRepo(REAL)
    const result = run(['--root', repo.root])
    expect(result.status, result.output).toBe(0)
    expect(result.output).not.toContain('1811')
    expect(result.output).not.toContain('164')
    expect(result.output).not.toContain('不一致')
  })
})

/* ───────── 3c. 当前块 = §16.8（main 全量复核的最终验证块也进数字门） ───────── */

describe('E3 · 当前块 = §16.8：main 全量复核的最终验证块（inventory / S3 字节 / doc-numbers 都核）', () => {
  // 与真实台账同一个规模：1876 条用例 / 168 文件 / 522735 B。
  const REAL = { total: 1876, fileCount: 168, bytes: 522735 }
  const HEADING = '#### 16.8'

  it('§16.8 当前块与工具源一致 → exit 0（1876 / 168 / 522735）', () => {
    const repo = makeRepo(REAL)
    const result = run(['--root', repo.root])
    expect(result.stderr, result.output).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('1876 条用例')
    expect(result.stdout).toContain('168 个文件')
    expect(result.stdout).toContain('522735 B')
  })

  it('§16.8 的 inventory / S3 字节 / doc-numbers 任一改坏 → exit 1，点名行、期望、实际', () => {
    const cases = [
      {
        label: '§16.8 inventory 用例数',
        needle: `用例 ${REAL.total} 条（基线`,
        from: `${REAL.total} 条（基线`,
        to: `${REAL.total + 1} 条（基线`,
        expectNeedle: `${REAL.total + 1} 条（基线`,
        finding: '用例数',
        expected: REAL.total,
        actual: REAL.total + 1,
      },
      {
        label: '§16.8 S3 产物字节',
        needle: `客户端产物 ${REAL.bytes}B`,
        from: `${REAL.bytes}B`,
        to: `${REAL.bytes + 1}B`,
        expectNeedle: `客户端产物 ${REAL.bytes + 1}B`,
        finding: '客户端产物字节',
        expected: REAL.bytes,
        actual: REAL.bytes + 1,
      },
      {
        label: '§16.8 doc-numbers 用例数',
        needle: '[doc-numbers] OK',
        from: `${REAL.total} 条用例`,
        to: `${REAL.total + 1} 条用例`,
        expectNeedle: '[doc-numbers] OK',
        finding: '用例数',
        expected: REAL.total,
        actual: REAL.total + 1,
      },
    ]
    for (const item of cases) {
      const repo = makeRepo(REAL)
      const broken = editInSection(repo.status, HEADING, item.needle, (line) => line.replace(item.from, item.to))
      expect(broken, `夹具里没改到「${item.label}」`).not.toBe(repo.status)
      repo.write('docs/development-status.md', broken)
      const result = run(['--root', repo.root])
      const at = lineInSection(broken, HEADING, item.expectNeedle)
      expect(result.status, `${item.label} 改坏应 exit 1：${result.output}`).toBe(1)
      expect(result.output).toContain(`docs/development-status.md:${at}`)
      expect(result.output).toContain(`${item.finding}不一致`)
      expect(result.output).toContain(`期望 ${item.expected}`)
      expect(result.output).toContain(`实际 ${item.actual}`)
      expect(result.output).toMatch(/原文[:：]/u)
    }
  })

  it('缺 §16.8 当前验证块 → exit 2，点名 16.8（当前块缺失 = 没法验，不静默绿）', () => {
    const repo = makeRepo(REAL)
    const { lines, start, end } = sectionRange(repo.status, HEADING)
    const stripped = [...lines.slice(0, start), ...lines.slice(end)].join('\n')
    const result = run(['--root', repo.root])
    expect(result.status, result.output).toBe(0) // 先确认夹具原样是绿的
    repo.write('docs/development-status.md', stripped)
    const missing = run(['--root', repo.root])
    expect(missing.status).toBe(2)
    expect(missing.output).toContain('16.8')
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

  it('§16.7 当前验证块缺失 → exit 2，点名 16.7（不是静默放过）', () => {
    const repo = makeRepo()
    const stripped = repo.status.split('\n').filter((line) => !line.includes('16.7')).join('\n')
    repo.write('docs/development-status.md', stripped)
    const result = run(['--root', repo.root])
    expect(result.status).toBe(2)
    expect(result.output).toContain('16.7')
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
