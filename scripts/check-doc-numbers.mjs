#!/usr/bin/env node
/**
 * `scripts/check-doc-numbers.mjs` —— **文档数字门：手抄的数字一漂就红**（票 E3 / #43）。
 *
 * 为什么需要它：本仓有两次「数字只从工具输出里抄」的成文纪律，然后照样漂
 * （`docs/development-status.md` §16.4「数字只从工具输出里抄」：992 vs 1020；之后又漂过 1811/164 → 1814/165）。
 * 纪律挡不住手抄，机器判据才挡得住：这里的每条断言都**先把真值从工具源读出来**再比对文档。
 *
 * 真值（唯一来源，脚本里不抄任何数字）：
 *   - `tests/test-inventory.json` 的 `total` 与 `files` 键数（`pnpm test:inventory --update` 写的基线）；
 *   - `packages/xuanshu-client/lib/client.js` 的实际字节数（`statSync().size`，即 `build-client --check` 比的那份产物）。
 *
 * 核对什么（**只核当前验证块**，历史章节里的旧数字不判漂移）：
 *   - `README.md` 的 `## 状态` 段：`pnpm test:inventory` 行（用例数 / 文件数）与 `build-client --check` 行（产物字节）；
 *   - `docs/development-status.md` 的 `#### 16.3` / `#### 16.7` / `#### 16.8` 三个当前验证块：
 *     §16.3 核 `[inventory]` 行（用例数 / 文件数）、`[S3] PASS 客户端产物 NB` 行，
 *     以及「清单基线已按最终用例数 `--update`（N / M）」那一行；
 *     §16.7 与 §16.8 都核 `[doc-numbers] OK：N 条用例 / M 个文件 / K B` 一行（三个数字都核）；
 *     §16.8 另外核 `[inventory]` 行与 `[S3]` 产物字节行（main 全量复核块的最终验证）。
 *     （§16.6 是历史轮：数字属于那一轮，**不核**——门只认当前块，见 tests/lib/check-doc-numbers.test.mjs。）
 *
 * 退出码（「没验」与「验了但红了」分开，与 `scripts/check-test-inventory.mjs` 同一口径）：
 *   0 = 当前验证块与工具源一致；
 *   1 = 漂移：逐条打印「文件:行、期望、实际、原文片段」；
 *   2 = 没法验：真源 / 文档 / 当前验证块缺失、读不出来、数字认不出来（不猜、不静默放过）。
 *
 * 用法：
 *   node scripts/check-doc-numbers.mjs                          # 用仓库默认路径
 *   node scripts/check-doc-numbers.mjs --root <dir>             # 换仓库根（判据用例用合成目录）
 *   node scripts/check-doc-numbers.mjs --inventory <file> --artifact <file>
 *   node scripts/check-doc-numbers.mjs --readme <file> --status <file>
 *
 * 只读：不修改任何文档或产物；不联网；不跑测试套件（毫秒级）。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = resolve(HERE, '..')

/** 「没法验」专用错误：与「漂移」分开（exit 2 vs exit 1）。 */
class CannotVerify extends Error {}

const USAGE = `用法：node scripts/check-doc-numbers.mjs [--root <dir>] [--inventory <file>] [--artifact <file>] [--readme <file>] [--status <file>]
  --root       仓库根（默认 = 脚本所在仓库）
  --inventory  用例清单真源（默认 tests/test-inventory.json，相对 --root）
  --artifact   客户端产物（默认 packages/xuanshu-client/lib/client.js，相对 --root）
  --readme     要核对的 README（默认 README.md，相对 --root）
  --status     要核对的开发台账（默认 docs/development-status.md，相对 --root）
退出码：0 = 一致；1 = 漂移（逐条列出）；2 = 没法验（真源/文档/当前验证块缺失或读不出来）。`

/** 解析命令行；未知参数 / 缺值一律「没法验」。 */
function parseArgs(argv) {
  const options = {
    root: DEFAULT_ROOT,
    inventory: 'tests/test-inventory.json',
    artifact: 'packages/xuanshu-client/lib/client.js',
    readme: 'README.md',
    status: 'docs/development-status.md',
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const take = () => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new CannotVerify(`${arg} 缺一个值\n${USAGE}`)
      index += 1
      return value
    }
    switch (arg) {
      case '--root': options.root = take(); break
      case '--inventory': options.inventory = take(); break
      case '--artifact': options.artifact = take(); break
      case '--readme': options.readme = take(); break
      case '--status': options.status = take(); break
      case '--help':
      case '-h': options.help = true; break
      default: throw new CannotVerify(`未知参数 ${arg}\n${USAGE}`)
    }
  }
  options.root = resolve(options.root)
  const underRoot = (value) => (isAbsolute(value) ? value : resolve(options.root, value))
  options.inventory = underRoot(options.inventory)
  options.artifact = underRoot(options.artifact)
  options.readme = underRoot(options.readme)
  options.status = underRoot(options.status)
  return options
}

/** 打印用路径：在仓库根内就给相对路径（`README.md`），根外给绝对路径。 */
function displayPath(file, root) {
  const rel = relative(root, file)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return file
  return rel.split(sep).join('/')
}

/** 原文片段：截出匹配点附近一小段（够认出是哪一行，又不至于把整行长文本糊上来）。 */
function snippetAround(line, index, radius = 24) {
  const start = Math.max(0, index - radius)
  const end = Math.min(line.length, index + radius)
  return `${start > 0 ? '…' : ''}${line.slice(start, end).trim()}${end < line.length ? '…' : ''}`
}

/* ───────────────────────── 真值：只从工具源读 ───────────────────────── */

/**
 * 读工具源真值。缺一不可：inventory 的 total/files 与产物的实际字节。
 * @returns {{total: number, fileCount: number, artifactBytes: number}}
 */
function readTruth(options) {
  const inventoryName = displayPath(options.inventory, options.root)
  if (!existsSync(options.inventory)) {
    throw new CannotVerify(`真源缺失：${inventoryName} 不存在（数字必须从工具源来，先跑 pnpm test:inventory）`)
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(options.inventory, 'utf8'))
  } catch (error) {
    throw new CannotVerify(`真源读不出来：${inventoryName} 不是可解析的 JSON（${error.message}）`)
  }
  const { total, files } = parsed ?? {}
  if (!Number.isInteger(total) || total < 0) {
    throw new CannotVerify(`真源形状不对：${inventoryName} 的 total 不是非负整数`)
  }
  if (files === null || typeof files !== 'object' || Array.isArray(files)) {
    throw new CannotVerify(`真源形状不对：${inventoryName} 的 files 不是对象`)
  }
  const artifactName = displayPath(options.artifact, options.root)
  if (!existsSync(options.artifact)) {
    throw new CannotVerify(`真源缺失：客户端产物 ${artifactName} 不存在（先跑 node scripts/build-client.mjs）`)
  }
  return { total, fileCount: Object.keys(files).length, artifactBytes: statSync(options.artifact).size }
}

/* ───────────────────────── 规则：每种文档各一套 ───────────────────────── */

/**
 * 一条规则 = 「这一行是数字声明」+「从这一行抽哪几个数、期望多少」。
 * `kind` 用于「当前块里必须有 inventory 行与产物字节行」的覆盖检查；`optional` 表示有则核、无则跳过。
 */
const INVENTORY_IN_BRACKETS = {
  kind: 'inventory',
  // 只认「[inventory] 用例 N 条…」这种**声明行**；`[inventory] 通过：…` 是结论行，不含数字。
  when: (line) => /^\s*\[inventory\]\s*用例/u.test(line),
  extract: (line, truth) => [
    { name: '用例数', expected: truth.total, match: line.match(/用例\s*(\d+)\s*条/u) },
    { name: '文件数', expected: truth.fileCount, match: line.match(/文件\s*(\d+)\s*个/u) },
  ],
}

/** §16.3 的散文行：「清单基线已按最终用例数 `--update`（1835 / 167）」。 */
const BASELINE_PAIR = {
  kind: 'inventory',
  optional: true,
  when: (line) => line.includes('清单基线') && line.includes('--update'),
  extract: (line, truth) => {
    const match = line.match(/[（(]\s*(\d+)\s*\/\s*(\d+)\s*[）)]/u)
    return [
      { name: '用例数', expected: truth.total, match: match === null ? null : [match[0], match[1]] },
      { name: '文件数', expected: truth.fileCount, match: match === null ? null : [match[0], match[2]] },
    ]
  },
}

/** `[S3] PASS 客户端产物 522070B`（verify:assembly 输出的那一行）。 */
const ARTIFACT_S3_LINE = {
  kind: 'artifact',
  when: (line) => line.includes('客户端产物'),
  extract: (line, truth) => [
    { name: '客户端产物字节', expected: truth.artifactBytes, match: line.match(/客户端产物\s*(\d+)\s*B/u) },
  ],
}

/** `build-client --check in sync（522070B）`（README 的 `## 状态` 段）。 */
const ARTIFACT_IN_SYNC_LINE = {
  kind: 'artifact',
  when: (line) => line.includes('build-client --check') && line.includes('in sync'),
  extract: (line, truth) => [
    { name: '客户端产物字节', expected: truth.artifactBytes, match: line.match(/in sync\s*[（(]\s*(\d+)\s*B/u) },
  ],
}

/** README 的 `pnpm test:inventory` 行：`→ **1835 条用例 / 167 文件 / …**`。 */
const README_INVENTORY_LINE = {
  kind: 'inventory',
  when: (line) => line.includes('pnpm test:inventory'),
  extract: (line, truth) => [
    { name: '用例数', expected: truth.total, match: line.match(/(\d+)\s*条用例/u) },
    { name: '文件数', expected: truth.fileCount, match: line.match(/(\d+)\s*文件/u) },
  ],
}

/**
 * §16.7 / §16.8 共用的当前块行：`[doc-numbers] OK：1835 条用例 / 167 个文件 / 522070 B`（verify:all 末步的 summary）。
 * 一行里三个数字，拆成两条规则共享同一个 `when`：`kind` 决定「当前块必须出现哪类数字」的覆盖检查。
 */
const whenDocNumbersOk = (line) => line.includes('[doc-numbers] OK')

const DOC_NUMBERS_OK_COUNTS = {
  kind: 'inventory',
  when: whenDocNumbersOk,
  extract: (line, truth) => [
    { name: '用例数', expected: truth.total, match: line.match(/\[doc-numbers\]\s*OK[：:]\s*(\d+)\s*条用例/u) },
    { name: '文件数', expected: truth.fileCount, match: line.match(/\/\s*(\d+)\s*个文件/u) },
  ],
}

const DOC_NUMBERS_OK_ARTIFACT = {
  kind: 'artifact',
  when: whenDocNumbersOk,
  extract: (line, truth) => [
    { name: '客户端产物字节', expected: truth.artifactBytes, match: line.match(/\/\s*(\d+)\s*B(?![A-Za-z])/u) },
  ],
}

/**
 * 文档规格：一个文件 → 若干「当前验证块」（按标题定位）。
 * `required` = 这一段里必须出现的数字种类（缺了就是「没法验」，不静默放过）。
 */
const DOC_SPECS = [
  {
    option: 'readme',
    sections: [
      { id: '「## 状态」段', pattern: /^##\s+状态\s*$/u, rules: [README_INVENTORY_LINE, ARTIFACT_IN_SYNC_LINE], required: ['inventory', 'artifact'] },
    ],
  },
  {
    option: 'status',
    sections: [
      { id: '「#### 16.3」当前验证块', pattern: /^#{1,6}\s*16\.3\b/u, rules: [INVENTORY_IN_BRACKETS, ARTIFACT_S3_LINE, BASELINE_PAIR], required: ['inventory', 'artifact'] },
      { id: '「#### 16.7」当前验证块', pattern: /^#{1,6}\s*16\.7\b/u, rules: [DOC_NUMBERS_OK_COUNTS, DOC_NUMBERS_OK_ARTIFACT], required: ['inventory', 'artifact'] },
      { id: '「#### 16.8」当前验证块', pattern: /^#{1,6}\s*16\.8\b/u, rules: [INVENTORY_IN_BRACKETS, ARTIFACT_S3_LINE, DOC_NUMBERS_OK_COUNTS, DOC_NUMBERS_OK_ARTIFACT], required: ['inventory', 'artifact'] },
    ],
  },
]

/* ───────────────────────── 扫描 ───────────────────────── */

/**
 * 代码围栏掩码：``` 之内的 `# 注释行` 不是 Markdown 标题。
 *
 * 实测踩到：§16.3 的代码块里第一行是 `# pnpm test:inventory…`，按「以 # 开头就是标题」找段尾，
 * 会当场把段结束在自己脚下（span 只剩 3 行）——判据就会漏掉整块。围栏必须参与标题识别。
 * @returns {boolean[]} 每一行是否位于代码围栏内（围栏行本身也算）
 */
function fenceMask(lines) {
  const mask = new Array(lines.length).fill(false)
  let inFence = false
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*```/u.test(lines[index])) {
      mask[index] = true
      inFence = !inFence
      continue
    }
    mask[index] = inFence
  }
  return mask
}

/** 按标题找段：返回 [start, end)（0-based，行号 = index + 1）；标题后遇到同级或更高级标题即结束。 */
function findSection(lines, pattern) {
  const fenced = fenceMask(lines)
  const start = lines.findIndex((line, index) => !fenced[index] && pattern.test(line))
  if (start === -1) return null
  const level = (lines[start].match(/^(#+)/u)?.[1].length) ?? 1
  let end = lines.length
  for (let cursor = start + 1; cursor < lines.length; cursor += 1) {
    if (fenced[cursor]) continue
    const heading = lines[cursor].match(/^(#+)\s/u)
    if (heading !== null && heading[1].length <= level) {
      end = cursor
      break
    }
  }
  return { start, end }
}

/**
 * 核一份文档的全部当前验证块。
 * @returns {{checks: number, findings: object[]}} `checks` = 实际核对到的数字处数
 */
function checkDoc({ option, text, truth, root, file }) {
  const name = displayPath(file, root)
  const lines = text.split(/\r?\n/u)
  const findings = []
  let checks = 0
  for (const section of DOC_SPECS.find((spec) => spec.option === option).sections) {
    const span = findSection(lines, section.pattern)
    if (span === null) {
      throw new CannotVerify(`当前验证块缺失：${name} 里找不到${section.id}（门不能静默放过）`)
    }
    const seenKinds = new Set()
    for (let index = span.start; index < span.end; index += 1) {
      const line = lines[index]
      for (const rule of section.rules) {
        if (!rule.when(line)) continue
        if (!rule.optional) seenKinds.add(rule.kind)
        for (const part of rule.extract(line, truth)) {
          if (part.match === null || part.match === undefined) {
            throw new CannotVerify(
              `${name}:${index + 1}: 当前验证块里认不出「${part.name}」的数字（原文：${snippetAround(line, 0, 48)}）`
              + '——改了写法就同步改门，别让它静默放过',
            )
          }
          checks += 1
          const actual = Number(part.match[1])
          if (actual !== part.expected) {
            const at = typeof part.match.index === 'number' ? part.match.index : line.indexOf(part.match[0])
            findings.push({
              file: name,
              line: index + 1,
              name: part.name,
              expected: part.expected,
              actual,
              snippet: snippetAround(line, at),
            })
          }
        }
      }
    }
    for (const kind of section.required) {
      if (seenKinds.has(kind)) continue
      throw new CannotVerify(
        `当前验证块缺失：${name} 的${section.id}里没有${kind === 'inventory' ? ' inventory 用例数/文件数行' : ' 客户端产物字节行'}`
        + '（门不能静默放过：写了当前块就该有这些数字）',
      )
    }
  }
  return { checks, findings }
}

/* ───────────────────────── 入口 ───────────────────────── */

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return 0
  }

  const truth = readTruth(options)

  const documents = []
  for (const spec of DOC_SPECS) {
    const file = options[spec.option]
    const name = displayPath(file, options.root)
    if (!existsSync(file)) throw new CannotVerify(`文档缺失：${name} 不存在`)
    documents.push({ option: spec.option, file, text: readFileSync(file, 'utf8') })
  }

  let checks = 0
  const findings = []
  for (const document of documents) {
    const result = checkDoc({ ...document, truth, root: options.root })
    checks += result.checks
    findings.push(...result.findings)
  }

  if (findings.length > 0) {
    console.error(`[doc-numbers] 文档数字漂移 ${findings.length} 处（真值来自工具源，不是猜的）：`)
    for (const finding of findings) {
      console.error(
        `  ✗ ${finding.file}:${finding.line}: ${finding.name}不一致：期望 ${finding.expected}，实际 ${finding.actual}（原文：${finding.snippet}）`,
      )
    }
    console.error(
      `[doc-numbers] 真值：${truth.total} 条用例 / ${truth.fileCount} 个文件 / ${truth.artifactBytes} B。`
      + '改文档数字，别放宽脚本；真值变了先刷 inventory / 重建产物。',
    )
    return 1
  }

  console.log(
    `[doc-numbers] OK：${truth.total} 条用例 / ${truth.fileCount} 个文件 / ${truth.artifactBytes} B`
    + ` 与工具源一致（核对 ${documents.length} 份文档的当前验证块，共 ${checks} 处数字）。`,
  )
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  if (error instanceof CannotVerify) {
    console.error(`[doc-numbers] ${error.message}`)
    process.exitCode = 2
  } else {
    console.error(`[doc-numbers] 未预期的错误：${error?.stack ?? error}`)
    process.exitCode = 2
  }
}
