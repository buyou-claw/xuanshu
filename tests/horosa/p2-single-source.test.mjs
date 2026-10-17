/**
 * P2 · **定值单源**：`8765` 与 `/mcp` 在**生产代码路径**里只有两个权威定义，且三方逐字一致。
 *
 * 判据（Lead 2026-10-13 复审裁决的口径）：**「生产代码路径的定义处唯一」**，不是「全仓无第二份 8765」。
 *   · 扫描范围 = `packages/xuanshu-host/lib/**`、`scripts/*.mjs`、`scripts/{isolation,horosa,setup}/**`
 *     （生产代码）；
 *   · **排除注释**（`//`、`/* *\/`）：注释里写「默认 8765」是**文档**，不是第二份定义；
 *   · 端口只认**独立数字字面量**：`log('8765 被占用')` 是提示语、`'horosa8765'` 是 check id，都不算；
 *   · 路径只认**恰好是 `/mcp` 的字符串字面量**：`'--path /mcp'` 这种长串不算；
 *   · 白名单 = 两处权威（`scripts/isolation/defaults.mjs`、`packages/xuanshu-host/lib/horosa/constants.mjs`）
 *     **加**一处冻结例外（`scripts/isolation/horosa-guard.mjs` 自带的 `DEFAULT_PATH = '/mcp'`，票 04 冻结、
 *     契约 §1 不许改；权威来源仍是 defaults.mjs，漂移由 P1 parity 钉住）。见 ALLOWED。
 *   · **测试 / fixtures / 文档不在范围内**：它们本来就该写字面量做对照（P5 的 YAML 行、P0 的 fixture、
 *     本文件的用例）。把它们算进来只会逼人把文档和断言写得更差。
 *
 * 抓的真实缺陷/风险：三个值散开一次就会漂 —— 现象是「DSH 的 mcp-horosa 行指着 8765，宿主却把 serve
 * 起在别的端口」，表现成「工具全不见，日志里什么都没有」。而且 YAML **没法 import**，
 * 所以「三方一致」这件事**只能由测试钉住**（契约 §2.4）。
 *
 * 三方 = ① `profile/cordis.patch.yml` 的 `url`（真 YAML 解析，不用正则）
 *        ② `scripts/isolation/defaults.mjs`（票 04 的定值模块）
 *        ③ `packages/xuanshu-host/lib/horosa/constants.mjs`（本票的定值模块）
 *
 * 零网络、零子进程；只读文件（唯一的写是 `.tmp/` 下的扫描器自证探针，跑完删）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

import { HOROSA_DEFAULT_HOST, HOROSA_DEFAULT_PORT, HOROSA_MCP_PATH, HOROSA_SERVER_NAME } from '../../packages/xuanshu-host/lib/horosa/constants.mjs'
import { DEFAULT_HOROSA_PORT, HOROSA_MCP_PATH as ISOLATION_MCP_PATH } from '../../scripts/isolation/defaults.mjs'
import { REPO_ROOT } from './lib/paths.mjs'
import { parseYaml } from './lib/yaml.mjs'

/** 算生产代码的层（`scripts/` 下只认这三个子目录 + 顶层脚本）。 */
const PRODUCTION_SUBDIRS = ['isolation', 'horosa', 'setup']

/**
 * 允许出现定值字面量的文件（相对仓库根，posix 分隔符）—— **只有两处权威定义**。
 *
 * 2026-10-13 复审后本表从三条缩到两条：`scripts/isolation/horosa-guard.mjs` 曾经自带
 * `const DEFAULT_PATH = '/mcp'`（票 04 的历史遗留：当年只把 `8765` 换成常量，`/mcp` 漏了），
 * 现已改为 `import { HOROSA_MCP_PATH } from './defaults.mjs'`（Lead 改，`tests/isolation` 36 用例全绿）。
 * 谁再往生产代码里写第三份，这条用例就会红。
 */
const ALLOWED = [
  { file: 'scripts/isolation/defaults.mjs', why: '票 04 的定值来源（DEFAULT_HOROSA_PORT / HOROSA_MCP_PATH）' },
  { file: 'packages/xuanshu-host/lib/horosa/constants.mjs', why: '本票的定值来源（HOROSA_DEFAULT_PORT / HOROSA_MCP_PATH）' },
]

/** 递归收集 .mjs/.cjs/.js 文件。 */
function collect(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      collect(full, out)
    } else if (/\.(mjs|cjs|js)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** 生产代码 = 宿主 harness（递归）+ scripts 顶层脚本 + scripts/{isolation,horosa,setup}（递归）。 */
function productionFiles() {
  const out = collect(join(REPO_ROOT, 'packages', 'xuanshu-host', 'lib'))
  const scripts = join(REPO_ROOT, 'scripts')
  if (existsSync(scripts)) {
    for (const entry of readdirSync(scripts, { withFileTypes: true })) {
      const full = join(scripts, entry.name)
      if (entry.isDirectory()) {
        if (PRODUCTION_SUBDIRS.includes(entry.name)) collect(full, out)
      } else if (/\.(mjs|cjs|js)$/.test(entry.name)) {
        out.push(full)
      }
    }
  }
  return [...new Set(out)].sort()
}

/** 剥掉注释（保留行号：注释字符换成空格）。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix + ' '.repeat(match.length - prefix.length))
}

/**
 * 命中位置是否落在**字符串字面量**里（近似但够用的词法判断：数一数本行到该位置为止的未配对引号）。
 * 目的：`log('8765 被占用')` 是提示语，不是定义；`const p = 8765` 才是定义。
 */
function insideString(line, index) {
  let quote
  for (let i = 0; i < index; i += 1) {
    const ch = line[i]
    if (ch === '\\') { i += 1; continue }
    if (quote === undefined && (ch === "'" || ch === '"' || ch === '`')) quote = ch
    else if (quote !== undefined && ch === quote) quote = undefined
  }
  return quote !== undefined
}

/** 扫描：端口（独立数字、不在字符串里）与路径（恰好是 `/mcp` 的字符串字面量）。 */
function scanLiterals(files) {
  const hits = []
  for (const file of files) {
    const relativePath = relative(REPO_ROOT, file).split('\\').join('/')
    const lines = stripComments(readFileSync(file, 'utf8')).split(/\r?\n/)
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/(?<![\w$.])8765(?![\w$])/g)) {
        if (!insideString(line, match.index)) hits.push({ kind: 'port', file: relativePath, line: index + 1, text: line.trim() })
      }
      if (/['"]\/mcp['"]/.test(line)) hits.push({ kind: 'path', file: relativePath, line: index + 1, text: line.trim() })
    })
  }
  return hits
}

describe('P2 · 定值单源（生产代码的定义处唯一 + 8765 / /mcp 三方一致）', () => {
  const patch = parseYaml(readFileSync(join(REPO_ROOT, 'profile', 'cordis.patch.yml'), 'utf8'))
  // 顶层条目**不止** `insert` 一种（票 07 在补丁层加了 headless/web 三行 `disabled` 顶条目），
  // 所以「mcp-horosa 行在第 0 个条目里」是错的假设：必须遍历所有条目的 `insert` 列表去取。
  // 与 P5 同款写法（`tests/horosa/p5-static-mount.test.mjs` 的 `rows`）。
  const rows = (patch ?? []).flatMap((entry) => entry?.insert ?? [])
  const horosaRows = rows.filter((entry) => entry?.id === 'mcp-horosa')
  const row = horosaRows[0]

  it('profile/cordis.patch.yml 解析出来就是那个 insert 行（YAML 真解析，不是正则）', () => {
    expect(Array.isArray(patch), 'profile 补丁的顶层必须是数组').toBe(true)
    expect(row, 'profile 补丁里找不到 id=mcp-horosa 的 insert 行').toBeTruthy()
    expect(
      horosaRows,
      'mcp-horosa 只能声明一次（重复声明同一个 id 会让 Loader 启动失败）',
    ).toHaveLength(1)
    expect(
      patch.some((entry) => Array.isArray(entry?.insert)),
      '补丁层里至少要有条目带 insert 数组',
    ).toBe(true)
  })

  it('三方端口逐字相等：YAML url ↔ defaults.mjs ↔ constants.mjs', () => {
    const url = new URL(row.config.url)
    expect(Number(url.port)).toBe(DEFAULT_HOROSA_PORT)
    expect(Number(url.port)).toBe(HOROSA_DEFAULT_PORT)
    expect(url.hostname).toBe(HOROSA_DEFAULT_HOST)
    expect(HOROSA_DEFAULT_PORT).toBe(8765)
  })

  it('三方路径逐字相等：YAML url ↔ defaults.mjs ↔ constants.mjs', () => {
    expect(new URL(row.config.url).pathname).toBe(ISOLATION_MCP_PATH)
    expect(new URL(row.config.url).pathname).toBe(HOROSA_MCP_PATH)
    expect(HOROSA_MCP_PATH).toBe('/mcp')
  })

  it('URL 只能是回环（非回环不暴露：投影成回环字面量，不许出现 0.0.0.0/局域网 IP）', () => {
    const url = new URL(row.config.url)
    expect(url.protocol).toBe('http:')
    expect(['127.0.0.1', '::1', 'localhost']).toContain(url.hostname)
    expect(String(row.config.url)).toBe(`http://${HOROSA_DEFAULT_HOST}:${HOROSA_DEFAULT_PORT}${HOROSA_MCP_PATH}`)
  })

  it('serverName 是工具名前缀的唯一来源（= constants 的 HOROSA_SERVER_NAME）', () => {
    expect(row.config.serverName).toBe('horosa')
    expect(row.config.serverName).toBe(HOROSA_SERVER_NAME)
  })

  it('生产代码里只有白名单文件出现定值字面量（注释/提示语/check id 都不算）', () => {
    const files = productionFiles()
    expect(files.length, '一个生产文件都没扫到？扫描根写错了').toBeGreaterThan(20)
    const allowed = new Set(ALLOWED.map((entry) => entry.file))
    const offenders = scanLiterals(files).filter((hit) => !allowed.has(hit.file))
    const rendered = offenders.map((hit) => `${hit.kind === 'port' ? '8765 ' : '/mcp '} ${hit.file}:${hit.line}: ${hit.text}`)
    expect(
      rendered,
      `生产代码里出现了第二份定值（必须 import DEFAULT_HOROSA_PORT / HOROSA_MCP_PATH / HOROSA_DEFAULT_PORT）：\n${rendered.join('\n')}`,
    ).toEqual([])
  })

  it('白名单文件**确实定义了**这两个定值（否则上一条只是「什么都没扫到」的假绿）', () => {
    for (const entry of ALLOWED) {
      const file = join(REPO_ROOT, ...entry.file.split('/'))
      expect(existsSync(file), `白名单文件不存在：${entry.file}`).toBe(true)
      const hits = scanLiterals([file])
      expect(hits.some((hit) => hit.kind === 'path'), `${entry.file} 里没有 /mcp 定义（白名单过时了？）`).toBe(true)
      expect(hits.some((hit) => hit.kind === 'port'), `${entry.file} 里没有 8765 定义（白名单过时了？）`).toBe(true)
    }
  })

  it('扫描器本身有效：注释与提示语里的 8765 不算命中，代码里的数字才算', () => {
    const tmp = join(REPO_ROOT, 'tests', 'horosa', '.tmp')
    const probeFile = join(tmp, 'scan-probe-fixture.mjs')
    mkdirSync(tmp, { recursive: true })
    writeFileSync(probeFile, [
      '// 默认 8765（这是注释，不算定义）',
      "const message = '8765 被非 horosa 的进程占用'",
      "const id = 'horosa8765'",
      'export const PORT = 8765',
      "export const PATH = '/mcp'",
    ].join('\n'))
    try {
      const hits = scanLiterals([probeFile])
      const ports = hits.filter((hit) => hit.kind === 'port')
      expect(ports, `注释/字符串里的 8765 被误判：${JSON.stringify(hits)}`).toHaveLength(1)
      expect(ports[0].line).toBe(4)
      expect(hits.filter((hit) => hit.kind === 'path')).toHaveLength(1)
    } finally {
      rmSync(probeFile, { force: true })
    }
  })

  it('测试/fixtures/文档**不在**范围内（它们本来就该写字面量做对照）', () => {
    // 反证：fixture 里就有定值字面量（假 MCP 服务器的 `/mcp` 路由），而它不该被判红 ——
    // 这条断言把「范围是生产代码」这件事显式化，省得将来有人把范围放大到 tests/**。
    const fixture = join(REPO_ROOT, 'tests', 'horosa', 'fixtures', 'bin', 'fake-mcp-server.mjs')
    expect(scanLiterals([fixture]).length, 'fixture 里连一个定值字面量都没有？那这条反证没意义').toBeGreaterThan(0)
  })

  it('`yaml` 是仓库根的显式依赖（干净 CI 才能解析；丢掉它 = 这个文件整个收集失败）', () => {
    // 这一条钉的是**复核 CI 实测踩到的形状**：`lib/yaml.mjs` 曾经只从 `profile/package.json`
    // 解析 `yaml`，而那棵树要跑过 `setup` 才有 ⇒ 干净环境（CI 只跑 `pnpm install --frozen-lockfile`）
    // 里 `Cannot find module 'yaml'`，**本文件与 p5 整个收集到 0 条用例**（15 条从总数里静默消失，
    // 清单门报「收集失败」）。修法有两半：`lib/yaml.mjs` 先从仓库根解析，且 `yaml` 必须真的在根
    // `devDependencies` 里。这条断言钉住后一半 —— 谁把它删了，红在这条用例上，而不是红在一个
    // 「Cannot find module」的收集错误里（后者在断言台里连用例名都看不到）。
    const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
    const declared = { ...rootPkg.dependencies, ...rootPkg.devDependencies }
    expect(
      declared.yaml,
      '`yaml` 不在仓库根 dependencies/devDependencies 里：CI 没装 profile，p2 / p5 会整个收集失败',
    ).toBeTruthy()
  })
})
