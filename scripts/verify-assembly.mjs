#!/usr/bin/env node
/**
 * verify-assembly.mjs — 玄枢（XuanShu）票 01 的「装配契约测试台」。
 *
 * 只断言外部可观察物（契约 `.scratch/assembly-foundation/notes/lead-contract.md` 第 5 节的五个 seam），
 * 不 import 玄枢内部模块、不依赖 LLM、不联网、不开端口：
 *
 *   S1  `dsh --dump-config-schema` → `x-cordis.complete === true`、exit 0、两行 status ≠ error、无 error 级 diagnostics
 *   S2  进程内官方 API（loadProfile/createRuntimeResolution/readProfilePatches/boot）→ 两行 `fiber.state === 2`
 *       （「在树里」不算装配成功：缺包的行也在树里，只是没激活）、`pluginPackages.packageOf()` 解析到已装包
 *   S3  `xuanshu-client/lib/client.js` → 存在/非空/以 `window.__ModuleLoader__.load(` 开头/恰好一次 load()；
 *       物化 factory 后返回对象上 `apply` 是函数、`inject` 是数组、槽位 key 与行 id 配对；不含 react 实现代码
 *   S4  `dsh --dump-config` → 漂移基线（96 条 DSH 行 id→name）逐条命中，且 stderr 无
 *       `patch: entry "<id>" not found`（注意：未匹配的补丁行只是 warning，exit 仍是 0，不能拿退出码当漂移信号）
 *   S5  真 CLI 启动一次（`--help` = boot + dispose + exit 0）→ `$DSH_HOME/xuanshu/assembly-report.json`
 *       本次新写出且 `ok === true`
 *
 * 用法：
 *   node scripts/verify-assembly.mjs [--json] [--dsh-home <dir>] [--profile <name>] [--profile-dir <dir>]
 *                                    [--dsh-bin <path>] [--baseline <file>] [--only s1,s4]
 *                                    [--write-baseline] [--allow-real-home] [-h]
 * 退出码：0 = 选中的 seam 全过；1 = 有失败（含 profile 未安装、CLI 找不到）。
 *
 * 隔离：CLI 调用与 boot 一律带 `DSH_HOME=<--dsh-home>`（默认 `<repo>/.dsh-home`）；等于用户真实
 * `~/.dsh` 时直接拒绝（除非 `--allow-real-home`）。只读扫描 `~/.dsh/profiles/<name>/node_modules`
 * 只为找一个版本对得上的 DSH CLI。`<profile>/cordis.yml` 是 DSH 每次启动都会重写的运行期产物，
 * 脚本在 S2/S5 前后快照/还原，并在它被写成非空 entry list 时判失败。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_BASELINE = join(REPO_ROOT, 'tests', 'assembly', 'baseline', 'patch-rows.json')
const BOOT_PROBE = join(REPO_ROOT, 'tests', 'assembly', 'lib', 'boot-inprocess.mjs')
const BOOT_MARKER = '##XUANSHU-BOOT-RESULT##'
const OWN_ROW_IDS = ['xuanshu-host', 'xuanshu-client']
const REPORT_SCHEMA = 'xuanshu/assembly-report@1'
/** 基线里标为 critical 的行：票 01 的启动路径直接依赖它们（只影响报错排序与摘要，不是另一套判据）。 */
const CRITICAL_ROW_IDS = [
  'agent-loop', 'llm', 'mcp-resources', 'session-persistence-jsonl', 'tools',
  'headless-startup', 'headless-runner',
]
/** S3 的 react/react-dom「实现代码」标记：打包器把 react 内联进来时必然出现其中若干。 */
const REACT_IMPL_MARKERS = [
  '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED',
  'Minified React error',
  'Invalid hook call',
  'react-dom.development.js',
]
/** 基线外部依赖（契约第 4 节）：这些请求串不需要声明 external 就能 require。 */
const BASELINE_EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
]

function printHelp() {
  const text = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const block = text.slice(text.indexOf('/**') + 3, text.indexOf('*/'))
  process.stdout.write(block.split('\n').map((line) => line.replace(/^ \* ?/, '')).join('\n').trim() + '\n')
}

// ─────────────────────────────── 参数与路径 ───────────────────────────────

function parseArgs(argv) {
  const opts = {
    dshHome: process.env.XUANSHU_DSH_HOME ?? join(REPO_ROOT, '.dsh-home'),
    profile: 'xuanshu',
    profileDir: undefined,
    dshBin: process.env.DSH_BIN,
    baseline: DEFAULT_BASELINE,
    json: false,
    writeBaseline: false,
    only: undefined,
    timeoutMs: 180_000,
    allowRealHome: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dsh-home') opts.dshHome = argv[++i]
    else if (arg === '--profile') opts.profile = argv[++i]
    else if (arg === '--profile-dir') opts.profileDir = argv[++i]
    else if (arg === '--dsh-bin') opts.dshBin = argv[++i]
    else if (arg === '--baseline') opts.baseline = argv[++i]
    else if (arg === '--timeout-ms') opts.timeoutMs = Number(argv[++i])
    else if (arg === '--only') opts.only = argv[++i].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    else if (arg === '--json') opts.json = true
    else if (arg === '--write-baseline') opts.writeBaseline = true
    else if (arg === '--allow-real-home') opts.allowRealHome = true
    else if (arg === '-h' || arg === '--help') { printHelp(); process.exit(0) }
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (opts.profile === '.' || opts.profile === '..' || /[\\/]/.test(opts.profile)) throw new Error(`invalid profile name: ${opts.profile}`)
  opts.dshHome = resolve(opts.dshHome)
  opts.baseline = resolve(opts.baseline)
  opts.profileDir = resolve(opts.profileDir ?? join(opts.dshHome, 'profiles', opts.profile))
  // `--profile-dir` 只接受 DSH 自己的布局（CLI 只能从 $DSH_HOME/profiles/<name> 启动 profile）。
  if (basename(dirname(opts.profileDir)) !== 'profiles') {
    throw new Error(`--profile-dir must be <DSH_HOME>/profiles/<name> (got ${opts.profileDir})`)
  }
  if (basename(opts.profileDir) !== opts.profile) {
    throw new Error(`--profile-dir basename must equal --profile (${opts.profile}); got ${basename(opts.profileDir)}`)
  }
  opts.dshHome = dirname(dirname(opts.profileDir))
  return opts
}

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

/** 隔离卫生：真实 DSH home 一律不碰。 */
function assertIsolatedHome(opts) {
  const real = join(homedir(), '.dsh')
  if (samePath(opts.dshHome, real) && !opts.allowRealHome) {
    throw new Error(
      `refusing to run against the user's real DSH home (${real}).\n`
      + '  Use an isolated home, e.g. --dsh-home <repo>/.dsh-home\n'
      + '  (add --allow-real-home only if you really mean it)',
    )
  }
}

/** 读一个包的 package.json；不存在就返回 undefined。 */
function readPackageManifest(packageDir) {
  try {
    return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
}

// ─────────────────────────────── CLI 定位 ───────────────────────────────

/** 把用户给的 `--dsh-bin` 归一成 `<...>/@deepseek-ai/dsh/lib/bin.js`。 */
function normalizeExplicitBin(value) {
  const candidates = []
  const push = (p) => candidates.push(p)
  if (/bin\.js$/i.test(value)) push(resolve(value))
  push(join(resolve(value), 'lib', 'bin.js'))                                  // 包目录
  push(join(resolve(value), '@deepseek-ai', 'dsh', 'lib', 'bin.js'))           // node_modules 根
  push(join(dirname(resolve(value)), '@deepseek-ai', 'dsh', 'lib', 'bin.js'))  // shim 所在目录
  push(join(dirname(resolve(value)), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  return candidates.find((candidate) => existsSync(candidate))
}

/**
 * 找 DSH CLI：优先 profile 自己装的，其次隔离 home / 真实 home 里的其它 profile（只读扫描，
 * 用户的 `~/.dsh/profiles/desktop` 就是本机那个 0.2.0-rc.2 载体），最后 PATH 上的 `dsh`。
 * 版本以 profile 装着的 `@deepseek-ai/dsh-base` 为准——版本对不上的 CLI 会把别人的树装出来。
 */
function resolveCli(opts) {
  const wanted = readPackageManifest(join(opts.profileDir, 'node_modules', '@deepseek-ai', 'dsh-base'))?.version
    ?? readPackageManifest(join(opts.profileDir, 'node_modules', '@deepseek-ai', 'dsh-headless'))?.version
  const found = []
  const seen = new Set()
  const consider = (packageDir, source) => {
    if (packageDir === undefined || !existsSync(join(packageDir, 'package.json'))) return
    let key
    try { key = realpathSync(packageDir).toLowerCase() } catch { key = resolve(packageDir).toLowerCase() }
    if (seen.has(key)) return
    seen.add(key)
    const manifest = readPackageManifest(packageDir)
    const binJs = join(packageDir, 'lib', 'bin.js')
    if (manifest === undefined || !existsSync(binJs)) return
    found.push({ packageDir, binJs, version: manifest.version, source })
  }

  if (opts.dshBin) {
    const binJs = normalizeExplicitBin(opts.dshBin)
    if (binJs === undefined) throw new Error(`--dsh-bin did not resolve to a DSH CLI: ${opts.dshBin}`)
    consider(dirname(dirname(binJs)), 'explicit (--dsh-bin/DSH_BIN)')
  }
  consider(join(opts.profileDir, 'node_modules', '@deepseek-ai', 'dsh'), 'profile node_modules')
  for (const home of [opts.dshHome, join(homedir(), '.dsh')]) {
    const profilesDir = join(home, 'profiles')
    if (!existsSync(profilesDir)) continue
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      consider(join(profilesDir, entry.name, 'node_modules', '@deepseek-ai', 'dsh'), `sibling profile ${entry.name} (${home})`)
    }
  }
  for (const dir of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue
    consider(join(dir, '@deepseek-ai', 'dsh'), 'PATH')
    consider(join(dir, 'node_modules', '@deepseek-ai', 'dsh'), 'PATH')
  }

  if (found.length === 0) {
    throw new Error('cannot locate a DSH CLI; pass --dsh-bin <path to @deepseek-ai/dsh/lib/bin.js>')
  }
  const ranked = [...found].sort((a, b) => {
    const exact = (c) => (c.version === wanted ? 0 : 1)
    if (exact(a) !== exact(b)) return exact(a) - exact(b)
    return String(b.version).localeCompare(String(a.version))
  })
  const chosen = ranked[0]
  const moduleRoot = (() => {
    let dir = dirname(chosen.binJs)
    for (let i = 0; i < 12 && dir !== dirname(dir); i += 1) {
      if (basename(dir) === 'node_modules') return dir
      dir = dirname(dir)
    }
    return undefined
  })()
  return {
    ...chosen,
    moduleRoot,
    wantedVersion: wanted,
    versionMatches: wanted === undefined || chosen.version === wanted,
    rejects: ranked.slice(1).map((c) => `${c.version} (${c.source})`),
  }
}

// ─────────────────────────────── 解析器 ───────────────────────────────

/**
 * 解析 `--dump-config` 的 YAML（DSH 自己的 entry-list 方言，行式即可）：
 * 顶层 `- id:` 一行 = 一行 entry，缩进行是它的字段，`# == <层>[, patched by <层>]` 是层注释。
 * 只取装配契约需要的字段（id / name / disabled / 层），不做通用 YAML。
 */
export function parseEntryListYaml(text) {
  const rows = []
  const layers = []
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)
  let layer
  let patchedBy
  let row
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const header = /^#\s*==\s*(.+?)\s*$/.exec(line)
    if (header !== null) {
      const patched = /^(.*?),\s*patched by\s*(.+)$/.exec(header[1])
      layer = (patched?.[1] ?? header[1]).trim()
      patchedBy = patched?.[2]?.trim()
      layers.push({ layer, patchedBy, line: index + 1 })
      row = undefined
      continue
    }
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const topLevel = /^- (.*)$/.exec(line)
    if (topLevel !== null) {
      row = { id: undefined, name: undefined, layer, patchedBy, disabled: undefined, line: index + 1 }
      const inline = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(topLevel[1])
      if (inline !== null) assignRowField(row, inline[1], inline[2])
      rows.push(row)
      continue
    }
    if (row === undefined) continue
    const field = /^\s{2}([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (field !== null) assignRowField(row, field[1], field[2])
    else if (/^ {4}/.test(line)) continue
    else row = undefined // 缩进回到顶层以下：这一行的字段区结束
  }
  return { rows, layers }
}

function assignRowField(row, key, rawValue) {
  const value = rawValue.trim()
  if (key === 'id') row.id = value
  else if (key === 'name') row.name = value.replace(/^['"]|['"]$/g, '')
  else if (key === 'disabled') row.disabled = value === 'true' ? true : value === 'false' ? false : `<expr:${value}>`
}

/**
 * 从真实安装的 bundle 补丁（`dsh.bundle.patch` 指向的 YAML）里提取它**插入**的行。
 * 只认 `insert:` 下的条目：顶层 `- id:` 是「改已有的行」（没有 name），不是插入。
 * 行式扫描 + 缩进栈，够用且不引依赖（补丁方言只有 mapping / list / `!!js` 标量）。
 */
export function extractInsertedRows(patchText, layer) {
  const rows = []
  const stack = []
  let current
  const lines = String(patchText).replace(/^\uFEFF/, '').split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const body = line.trim()
    if (body === '' || body.startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) stack.pop()
    const parentKey = stack[stack.length - 1]?.key
    const item = /^-\s*(.*)$/.exec(body)
    if (item !== null) {
      const inline = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(item[1])
      current = parentKey === 'insert' && inline !== null ? { id: undefined, name: undefined, line: index + 1 } : undefined
      if (current !== undefined) {
        rows.push(current)
        assignRowField(current, inline[1], inline[2])
      }
      stack.push({ indent, key: inline?.[1] })
      continue
    }
    const mapping = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(body)
    if (mapping === null) continue
    if (current !== undefined) assignRowField(current, mapping[1], mapping[2])
    stack.push({ indent, key: mapping[1] })
  }
  return rows
    .filter((row) => typeof row.id === 'string' && row.id !== '')
    .map((row) => ({ id: row.id, name: row.name, layer }))
}

// ─────────────────────────────── CLI 调用 ───────────────────────────────

function runCli(cli, opts, args, timeoutMs) {
  const started = Date.now()
  const result = spawnSync(process.execPath, [cli.binJs, '--profile', opts.profile, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, DSH_HOME: opts.dshHome, DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ms: Date.now() - started,
    args,
  }
}

// ─────────────────────────── root cordis.yml 兜底 ───────────────────────────

/**
 * DSH 每次启动都重写 `<profile>/cordis.yml`（`prepareProfile`）。它是 gitignore 的运行期产物，
 * 但测试台不该把它变成「跑完测试就脏一个文件」，所以快照/还原；同时如果它被写成了非空
 * entry list，说明补丁栈被写回了根配置（会让下一次启动重复 insert），判失败。
 */
function snapshotRootConfig(opts) {
  const file = join(opts.profileDir, 'cordis.yml')
  return { file, existed: existsSync(file), content: existsSync(file) ? readFileSync(file) : undefined }
}

function isRootConfigEmpty(file) {
  if (!existsSync(file)) return { empty: false, reason: 'missing' }
  const body = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
    .join('\n')
    .trim()
  return { empty: body === '[]', reason: body === '[]' ? 'empty list' : `non-empty root config: ${JSON.stringify(body.slice(0, 120))}` }
}

function restoreRootConfig(snapshot) {
  try {
    if (!snapshot.existed) rmSync(snapshot.file, { force: true })
    else if (!readFileSync(snapshot.file).equals(snapshot.content)) writeFileSync(snapshot.file, snapshot.content)
  } catch { /* 运行期产物，恢复失败不影响判据 */ }
}

// ─────────────────────────────── S1 ───────────────────────────────

function checkS1(cli, opts) {
  const run = runCli(cli, opts, ['--dump-config-schema'], opts.timeoutMs)
  const check = { id: 'S1', name: '装配树（--dump-config-schema）', ok: false, detail: '', evidence: {} }
  if (run.error !== undefined || run.signal !== null) {
    check.detail = `CLI 未能跑完：status=${run.status} signal=${run.signal} error=${run.error}`
    return { check, run }
  }
  let document
  try {
    document = JSON.parse(run.stdout)
  } catch (error) {
    check.detail = `stdout 不是单份 JSON：${error.message}（stderr: ${run.stderr.trim().slice(0, 300)}）`
    return { check, run }
  }
  const payload = document['x-cordis']
  if (payload === undefined) {
    check.detail = `JSON 里没有 x-cordis 键（顶层键：${Object.keys(document).join(', ')}）`
    return { check, run }
  }
  const entries = Array.isArray(payload.entries) ? payload.entries : []
  const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : []
  const errorDiagnostics = diagnostics.filter((d) => /error/i.test(String(d?.severity ?? d?.level ?? d?.type ?? d?.status ?? '')))
  const errorEntries = entries.filter((entry) => entry?.status === 'error')
  const own = entries.filter((entry) => OWN_ROW_IDS.includes(entry?.id))
  const missingOwn = OWN_ROW_IDS.filter((id) => !entries.some((entry) => entry?.id === id))
  const failed = []
  if (run.status !== 0) failed.push(`exit ${run.status}`)
  if (payload.complete !== true) failed.push(`x-cordis.complete=${JSON.stringify(payload.complete)}`)
  if (missingOwn.length > 0) failed.push(`装配树里没有行：${missingOwn.join(', ')}`)
  if (errorEntries.length > 0) failed.push(`error 行：${errorEntries.map((entry) => `${entry.id}(${entry.path})`).join(', ')}`)
  if (errorDiagnostics.length > 0) failed.push(`error 级 diagnostics：${JSON.stringify(errorDiagnostics).slice(0, 300)}`)
  check.evidence = {
    exitCode: run.status,
    complete: payload.complete,
    entries: entries.length,
    diagnostics,
    ownRows: own.map((entry) => ({ id: entry.id, name: entry.name, status: entry.status, path: entry.path })),
    profile: payload.profile,
    ms: run.ms,
  }
  check.ok = failed.length === 0
  check.detail = check.ok
    ? `complete=true，${entries.length} 行，diagnostics=${diagnostics.length}；${own.map((e) => `${e.id}=${e.status}`).join(' ')}`
    : failed.join('；')
  return { check, run, payload }
}

// ─────────────────────────────── S4 ───────────────────────────────

export function buildBaseline({ profileDir, dshHome, dshVersion }) {
  const manifest = readPackageManifest(profileDir)
  if (manifest === undefined) throw new Error(`cannot read profile manifest at ${join(profileDir, 'package.json')}`)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const sources = []
  const rows = []
  for (const name of bundles) {
    if (!String(name).startsWith('@deepseek-ai/')) continue // 我们自己的行由 S1 直接断言
    const packageDir = join(profileDir, 'node_modules', name)
    const packageManifest = readPackageManifest(packageDir)
    if (packageManifest === undefined) throw new Error(`bundle ${name} is declared but not installed under ${packageDir}`)
    const patchRel = packageManifest.dsh?.bundle?.patch
    if (typeof patchRel !== 'string') {
      sources.push({ layer: name, version: packageManifest.version, patch: null, rows: 0 })
      continue
    }
    const patchFile = join(packageDir, patchRel)
    const inserted = extractInsertedRows(readFileSync(patchFile, 'utf8'), name)
    for (const row of inserted) rows.push({ ...row, order: rows.length })
    sources.push({
      layer: name,
      version: packageManifest.version,
      patch: relative(profileDir, patchFile).split(sep).join('/'),
      rows: inserted.length,
    })
  }
  const critical = rows.filter((row) => CRITICAL_ROW_IDS.includes(row.id)).map((row) => row.id)
  let profileRel = relative(REPO_ROOT, profileDir).split(sep).join('/')
  if (profileRel.startsWith('..')) profileRel = profileDir
  return {
    schema: 'xuanshu/patch-row-baseline@1',
    generatedAt: new Date().toISOString(),
    generatedBy: 'node scripts/verify-assembly.mjs --write-baseline',
    dshVersion,
    profile: manifest.name,
    profileDir: profileRel,
    criticalRowIds: critical,
    note: '由真实安装的 DSH bundle 补丁（package.json 的 dsh.bundle.patch）提取；不要手改，改请重跑 --write-baseline。',
    sources,
    rows,
  }
}

function describeBaselineDiff(before, after) {
  const index = (baseline) => new Map((baseline?.rows ?? []).map((row) => [row.id, row]))
  const a = index(before)
  const b = index(after)
  const added = [...b.keys()].filter((id) => !a.has(id))
  const removed = [...a.keys()].filter((id) => !b.has(id))
  const changed = [...b.keys()].filter((id) => a.has(id) && (a.get(id).name !== b.get(id).name || a.get(id).layer !== b.get(id).layer))
  return { added, removed, changed }
}

function checkS4(cli, opts, baseline, payload) {
  const check = { id: 'S4', name: '漂移基线（--dump-config）', ok: false, detail: '', evidence: {} }
  const run = runCli(cli, opts, ['--dump-config'], opts.timeoutMs)
  const tree = parseEntryListYaml(run.stdout)
  const byId = new Map()
  for (const row of tree.rows) if (row.id !== undefined && !byId.has(row.id)) byId.set(row.id, row)

  const drifts = []
  for (const expected of baseline?.rows ?? []) {
    const actual = byId.get(expected.id)
    if (actual === undefined) drifts.push({ id: expected.id, kind: 'missing', expected: `${expected.name} (${expected.layer})`, actual: '—' })
    else if (expected.name !== undefined && actual.name !== expected.name) {
      drifts.push({ id: expected.id, kind: 'name-changed', expected: `${expected.name} (${expected.layer})`, actual: `${actual.name} (${actual.layer})` })
    }
  }
  const stderrMisses = [...run.stderr.matchAll(/patch: entry "([^"]+)" not found/g)].map((m) => m[1])
  const criticalDrifts = drifts.filter((drift) => (baseline?.criticalRowIds ?? []).includes(drift.id))
  const failed = []
  if (run.error !== undefined || run.signal !== null) failed.push(`CLI 未能跑完：status=${run.status} signal=${run.signal} error=${run.error}`)
  if (run.status !== 0) failed.push(`exit ${run.status}`)
  if (baseline === undefined) failed.push('基线文件不存在（先跑 --write-baseline）')
  if (drifts.length > 0) failed.push(`${drifts.length} 条基线行漂移`)
  if (stderrMisses.length > 0) failed.push(`stderr 报了未匹配的补丁行：${stderrMisses.join(', ')}`)

  check.evidence = {
    exitCode: run.status,
    treeRows: tree.rows.length,
    treeIds: byId.size,
    layers: tree.layers.map((layer) => (layer.patchedBy === undefined ? layer.layer : `${layer.layer} ← patched by ${layer.patchedBy}`)),
    baselineRows: baseline?.rows?.length ?? 0,
    drifts,
    criticalDrifts,
    stderrPatchMisses: stderrMisses,
    ownRows: tree.rows.filter((row) => OWN_ROW_IDS.includes(row.id)).map((row) => ({ id: row.id, name: row.name, layer: row.layer, line: row.line })),
    ms: run.ms,
  }
  check.ok = failed.length === 0
  check.detail = check.ok
    ? `基线 ${baseline.rows.length} 行全部命中（${(baseline.sources ?? []).map((s) => `${s.layer}@${s.version}×${s.rows}`).join(', ')}）；树 ${byId.size} 行`
    : `${failed.join('；')}${drifts.length > 0 ? `\n${formatDrifts(drifts, baseline?.criticalRowIds ?? [])}` : ''}`
  return check
}

export function formatDrifts(drifts, criticalIds) {
  const ordered = [...drifts].sort((a, b) => Number(criticalIds.includes(b.id)) - Number(criticalIds.includes(a.id)))
  return ordered
    .map((drift) => `      - ${criticalIds.includes(drift.id) ? '[critical] ' : ''}${drift.id}: ${drift.kind}；期望 ${drift.expected}，实际 ${drift.actual}`)
    .join('\n')
}

// ─────────────────────────────── S3 ───────────────────────────────

/**
 * S3 ④：把产物丢进假 `window.__ModuleLoader__` 里执行、物化 factory —— 唯一能抓住「信封坏了」
 * 的断言（文本 grep 已经不成立：产物用 esbuild 的 `__export` + `module.exports = __toCommonJS(...)`
 * 形导出，字面量 `exports.apply` 不存在）。运行时不做转译，所以这就是 loader 真实会走的路径。
 */
export function materializeClientBundle(text) {
  const loaded = []
  const sandbox = { window: { __ModuleLoader__: { load: (spec) => { loaded.push(spec) } } } }
  vm.runInNewContext(text, sandbox, { timeout: 10_000 })
  if (loaded.length !== 1) throw new Error(`应恰好调用一次 window.__ModuleLoader__.load()，实际 ${loaded.length} 次`)
  const spec = loaded[0]
  const requested = []
  const fakeRequire = (specifier) => {
    requested.push(specifier)
    if (specifier === 'react/jsx-runtime' || specifier === 'react/jsx-dev-runtime') {
      return { jsx: () => null, jsxs: () => null, Fragment: {} }
    }
    if (specifier === 'react') return { createElement: () => null, Fragment: {}, useMemo: (fn) => fn(), useRef: () => ({ current: undefined }), useEffect: () => {} }
    throw new Error(`未预期的 require(${JSON.stringify(specifier)})：基线外部依赖之外要写进 dsh.client.external`)
  }
  const moduleExports = spec.factory(fakeRequire)
  return { id: spec.id, exports: moduleExports, requested }
}

/** 记录调用、对未知成员宽容的假 ctx（只用来验证槽位注册行为，不 mock 业务）。 */
function recordingContext(registrations) {
  const target = {
    slots: {
      inject: (key, callback) => { registrations.push({ kind: 'inject', name: key }); callback() },
      register: (spec, component) => { registrations.push({ kind: 'register', name: spec?.name, spec, component }) },
    },
    effect: (callback) => { const disposer = callback(); return typeof disposer === 'function' ? disposer : () => {} },
  }
  return new Proxy(target, {
    get: (obj, prop) => {
      if (prop in obj) return obj[prop]
      if (prop === 'then') return undefined
      return () => undefined
    },
  })
}

function checkS3(opts, notes) {
  const check = { id: 'S3', name: '客户端预编译产物（静态契约）', ok: false, detail: '', evidence: {} }
  const packageDir = join(opts.profileDir, 'node_modules', 'xuanshu-client')
  const manifest = readPackageManifest(packageDir)
  const failed = []
  if (manifest === undefined) {
    check.detail = `装上没看到 xuanshu-client：${packageDir}`
    return check
  }
  const clientRel = manifest.exports?.['./client']?.default ?? manifest.exports?.['./client']
  const clientFile = typeof clientRel === 'string' ? join(packageDir, clientRel) : undefined
  const platform = manifest.dsh?.client?.platform
  const declaredExternal = manifest.dsh?.client?.external ?? []
  const repoPackageDir = join(REPO_ROOT, 'packages', 'xuanshu-client')
  const repoClientFile = typeof clientRel === 'string' ? join(repoPackageDir, clientRel) : undefined
  let text
  let bytes
  let exportNames = []
  let registrations = []
  let requested = []
  if (clientFile === undefined || !existsSync(clientFile)) {
    failed.push(`exports["./client"].default 没指向一个存在的文件：${JSON.stringify(manifest.exports?.['./client'])}`)
  } else {
    text = readFileSync(clientFile, 'utf8')
    bytes = statSync(clientFile).size
    if (bytes === 0) failed.push(`${clientRel} 是空文件`)
    if (!/^\s*window\.__ModuleLoader__\.load\(/.test(text)) failed.push(`${clientRel} 不是以 window.__ModuleLoader__.load( 开头（运行时是经典脚本，不做转译）`)
    if ((text.match(/window\.__ModuleLoader__\.load\(/g) ?? []).length !== 1) failed.push(`${clientRel} 里的 load() 调用不是恰好一次`)

    // ④ 行为：物化 factory，断言返回对象真的带着 apply / inject
    try {
      const materialized = materializeClientBundle(text)
      requested = materialized.requested
      if (materialized.id !== 'xuanshu-client') failed.push(`load({id}) = ${JSON.stringify(materialized.id)}，应为 "xuanshu-client"`)
      if (typeof materialized.exports?.apply !== 'function') failed.push(`物化后模块的 apply 不是函数（${typeof materialized.exports?.apply}）`)
      if (!Array.isArray(materialized.exports?.inject)) failed.push(`物化后模块的 inject 不是数组（${JSON.stringify(materialized.exports?.inject)}）`)
      exportNames = Object.keys(materialized.exports ?? {}).sort()
      if (typeof materialized.exports?.apply === 'function') {
        materialized.exports.apply(recordingContext(registrations))
      }
    } catch (error) {
      failed.push(`物化产物失败：${error?.message ?? error}`)
    }

    const slots = registrations.filter((entry) => entry.kind === 'register')
    const mainPanel = slots.find((entry) => entry.name === 'main')
    const sidebarRow = slots.find((entry) => entry.name === 'sidebar.panellist')
    if (mainPanel === undefined) failed.push('apply 没有把面板注册进 "main" 槽')
    if (sidebarRow === undefined) failed.push('apply 没有把行注册进 "sidebar.panellist" 槽')
    if (mainPanel !== undefined && sidebarRow !== undefined
      && String(mainPanel.spec?.key) !== String(sidebarRow.spec?.id)) {
      failed.push(`面板 key（${JSON.stringify(mainPanel.spec?.key)}）与侧栏行 id（${JSON.stringify(sidebarRow.spec?.id)}）不一致：它们是行与面板配对的唯一依据`)
    }

    const specifiers = [...new Set(requested)]
    const undeclared = specifiers.filter((spec) => !BASELINE_EXTERNALS.includes(spec) && !declaredExternal.includes(spec))
    if (undeclared.length > 0) failed.push(`产物 require 了未声明的依赖：${undeclared.join(', ')}（超基线依赖必须写进 dsh.client.external）`)
    const inlined = REACT_IMPL_MARKERS.filter((marker) => text.includes(marker))
    if (inlined.length > 0) failed.push(`${clientRel} 像是把 react/react-dom 的实现打进来了（命中：${inlined.join(', ')}）`)
  }
  if (platform !== 'web') failed.push(`dsh.client.platform=${JSON.stringify(platform)}，应为 "web"`)

  // 装配里装的是不是仓库当前那份产物：拷贝式安装（hoisted nodeLinker）会让它悄悄变陈旧，
  // 那时 S3/S5 验的就不是仓库里提交的东西了。
  let staleFiles = []
  if (repoClientFile !== undefined && clientFile !== undefined && existsSync(repoClientFile) && existsSync(clientFile)) {
    staleFiles = [relative(packageDir, clientFile), 'package.json']
      .filter((rel) => {
        const a = join(packageDir, rel)
        const b = join(repoPackageDir, rel)
        return existsSync(a) && existsSync(b) && !readFileSync(a).equals(readFileSync(b))
      })
  }
  if (staleFiles.length > 0) {
    failed.push(`profile 里装的 xuanshu-client 与仓库 packages/xuanshu-client 不一致（${staleFiles.join(', ')}）；先重新安装：node scripts/install-profile.mjs --home "${opts.dshHome}"`)
  }

  const repoPackage = readPackageManifest(repoPackageDir)
  let realDir = packageDir
  try { realDir = realpathSync(packageDir) } catch { /* 保留 profile 视图 */ }
  check.evidence = {
    packageDir,
    realDir,
    linkedIntoRepo: realDir.startsWith(join(REPO_ROOT, 'packages') + sep),
    clientFile: clientFile === undefined ? undefined : relative(REPO_ROOT, clientFile).split(sep).join('/'),
    bytes,
    platform,
    exportNames,
    requireSpecifiers: [...new Set(requested)],
    slotRegistrations: registrations.filter((entry) => entry.kind === 'register').map((entry) => ({ name: entry.name, spec: entry.spec })),
    declaredExternal,
    inSyncWithRepo: staleFiles.length === 0,
    version: manifest.version,
    repoVersion: repoPackage?.version,
    inject: manifest.dsh?.client?.inject,
  }
  check.ok = failed.length === 0
  check.detail = check.ok
    ? `${check.evidence.clientFile} ${bytes}B；物化 ok（apply+inject，槽位 main/overview + sidebar.panellist/overview）；platform=web；require=${check.evidence.requireSpecifiers.join(',')}`
    : failed.join('；')
  return check
}

// ─────────────────────────────── S2 ───────────────────────────────

function checkS2(cli, opts) {
  const check = { id: 'S2', name: '进程内挂载（官方 loadProfile/boot）', ok: false, detail: '', evidence: {} }
  const started = Date.now()
  const result = spawnSync(process.execPath, [
    BOOT_PROBE,
    '--dsh-home', opts.dshHome,
    '--profile', opts.profile,
    '--cli-bin', cli.binJs,
  ], {
    cwd: REPO_ROOT,
    env: { ...process.env, DSH_HOME: opts.dshHome, DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: opts.timeoutMs,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const marker = (result.stdout ?? '').split(/\r?\n/).find((line) => line.startsWith(BOOT_MARKER))
  if (marker === undefined) {
    check.detail = `进程内探针没有给出结果（status=${result.status} signal=${result.signal} error=${result.error?.message}）\n      stderr: ${(result.stderr ?? '').trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 400)}`
    return check
  }
  const probe = JSON.parse(marker.slice(BOOT_MARKER.length))
  const rowsById = new Map((probe.rows ?? []).filter((row) => row.id !== undefined).map((row) => [row.id, row]))
  const failed = []
  if (probe.error !== undefined) failed.push(`probe 报错：${String(probe.error).split('\n')[0]}`)
  if (probe.ok !== true) failed.push(`probe ok=false（fatal: ${(probe.fatal ?? []).length}）`)
  const states = {}
  for (const id of OWN_ROW_IDS) {
    const row = rowsById.get(id)
    states[id] = row === undefined ? 'missing' : row.state
    if (row === undefined) failed.push(`装配树里没有行 ${id}`)
    else if (row.state !== 2) failed.push(`行 ${id} 的 fiber.state=${JSON.stringify(row.state)}（2 = 已激活；「在树里」不算装配成功）`)
  }
  const packages = probe.packages ?? {}
  const packageEvidence = {}
  for (const name of OWN_ROW_IDS) {
    const found = packages[name]
    if (found == null) {
      failed.push(`pluginPackages.packageOf('${name}') 没解析到目录`)
      packageEvidence[name] = null
      continue
    }
    let real = found.dir
    try { real = realpathSync(found.dir) } catch { /* keep */ }
    const installedManifest = readPackageManifest(found.dir)
    const repoManifest = readPackageManifest(join(REPO_ROOT, 'packages', name))
    const linkedIntoRepo = real.startsWith(join(REPO_ROOT, 'packages') + sep)
    packageEvidence[name] = {
      version: found.version, dir: found.dir, realDir: real, linkedIntoRepo,
      manifestName: installedManifest?.name, repoVersion: repoManifest?.version,
    }
    if (installedManifest?.name !== name) failed.push(`packageOf('${name}') 解析到的目录不是 ${name}（name=${JSON.stringify(installedManifest?.name)}）`)
    if (repoManifest !== undefined && found.version !== repoManifest.version) {
      failed.push(`packageOf('${name}') 版本 ${found.version} ≠ 仓库 packages/${name} 的 ${repoManifest.version}（装的是旧拷贝？）`)
    }
  }
  if (Array.isArray(probe.fatal) && probe.fatal.length > 0) {
    failed.push(`探针进程里有未处理错误：${probe.fatal.map((f) => `${f.label}: ${String(f.message).split('\n')[0]}`).join('；')}`)
  }
  check.evidence = {
    rows: probe.rowCount,
    states,
    packages: packageEvidence,
    profileDir: probe.profile?.dir,
    bundles: probe.profile?.bundles,
    apiRoot: probe.apiRoot,
    installAnchor: probe.installAnchor,
    notes: probe.notes,
    ms: Date.now() - started,
  }
  check.ok = failed.length === 0
  check.detail = check.ok
    ? `${probe.rowCount} 行挂载；${OWN_ROW_IDS.map((id) => `${id}.state=2`).join(' ')}；packageOf 解析到已装包目录（v${packageEvidence['xuanshu-host']?.version}）`
    : failed.join('；')
  return check
}

// ─────────────────────────────── S5 ───────────────────────────────

function checkS5(cli, opts) {
  const check = { id: 'S5', name: '真 CLI 启动 + 装配报告', ok: false, detail: '', evidence: {} }
  const reportFile = join(opts.dshHome, 'xuanshu', 'assembly-report.json')
  if (!samePath(dirname(dirname(reportFile)), opts.dshHome)) throw new Error(`refusing to touch ${reportFile}`)
  const snapshot = snapshotRootConfig(opts)
  if (existsSync(reportFile)) rmSync(reportFile)
  let run
  try {
    // `--help` 走的是官方 CLI 的正常启动路径：prepareProfile → 挂载整棵树 → app 打印帮助并 exit 0
    // （实测 3.1s，exit 0）。它不提交 task，所以不调 LLM、不联网。
    run = runCli(cli, opts, ['--help'], opts.timeoutMs)
  } finally {
    restoreRootConfig(snapshot)
  }
  const rootState = isRootConfigEmpty(snapshot.file)
  const failed = []
  if (run.error !== undefined || run.signal !== null) failed.push(`CLI 未能跑完：status=${run.status} signal=${run.signal} error=${run.error}`)
  if (run.status !== 0) failed.push(`exit ${run.status}（期望 0；stderr: ${run.stderr.trim().split(/\r?\n/).slice(-2).join(' | ').slice(0, 300)}）`)
  if (!existsSync(reportFile)) {
    failed.push(`本次运行没有写出 ${relative(REPO_ROOT, reportFile).split(sep).join('/')}（插件没 apply？）`)
    check.evidence = { exitCode: run.status, reportFile, ms: run.ms, stderrTail: run.stderr.trim().slice(-400) }
    check.detail = failed.join('；')
    return check
  }
  const report = JSON.parse(readFileSync(reportFile, 'utf8'))
  if (report.schema !== REPORT_SCHEMA) failed.push(`报告 schema=${JSON.stringify(report.schema)}，应为 ${REPORT_SCHEMA}`)
  if (report.ok !== true) failed.push(`报告 ok=${JSON.stringify(report.ok)}（= profileContext 可得 ∧ 两包都解析到 ∧ 两行 id 都在树里）`)
  for (const name of OWN_ROW_IDS) {
    if (report.plugins?.[name] === undefined) failed.push(`报告 plugins 缺 ${name} 键`)
    if (!Array.isArray(report.patchRowIds) || !report.patchRowIds.includes(name)) failed.push(`报告 patchRowIds 缺 ${name}`)
  }
  if (report.dsh?.version !== undefined && cli.wantedVersion !== undefined && report.dsh.version !== cli.wantedVersion) {
    failed.push(`报告 dsh.version=${report.dsh.version} ≠ profile 装的 ${cli.wantedVersion}`)
  }
  if (!rootState.empty) failed.push(`profile 根配置被写成了非空 entry list（${rootState.reason}）`)
  check.evidence = {
    exitCode: run.status,
    reportFile: relative(REPO_ROOT, reportFile).split(sep).join('/'),
    schema: report.schema,
    ok: report.ok,
    generatedAt: report.generatedAt,
    plugins: Object.keys(report.plugins ?? {}),
    patchRowIds: Array.isArray(report.patchRowIds) ? report.patchRowIds.length : undefined,
    dsh: report.dsh,
    profile: report.profile,
    ms: run.ms,
  }
  check.ok = failed.length === 0
  check.detail = check.ok
    ? `report 新写出 ok=true，plugins=${Object.keys(report.plugins).join('+')}，patchRowIds=${report.patchRowIds.length} 含两行`
    : failed.join('；')
  return check
}

// ─────────────────────────────── 主流程 ───────────────────────────────

function consoleReport(result, opts) {
  const lines = []
  lines.push(`玄枢装配契约测试台  profile=${opts.profile}`)
  lines.push(`  DSH_HOME   ${opts.dshHome}`)
  lines.push(`  profileDir ${opts.profileDir}${existsSync(opts.profileDir) ? '' : '  ← 不存在'}`)
  if (result.cli !== undefined) {
    lines.push(`  DSH CLI    ${result.cli.binJs}  (v${result.cli.version}${result.cli.versionMatches ? '' : ` ≠ profile 的 ${result.cli.wantedVersion}`})`)
  }
  lines.push('')
  for (const check of Object.values(result.checks)) {
    lines.push(`[${check.id}] ${check.name}  ${check.ok ? 'PASS' : 'FAIL'}  ${check.detail}`)
    if (check.evidence?.ms !== undefined) lines.push(`      ${check.evidence.ms}ms`)
  }
  lines.push('')
  lines.push(result.ok ? `结果：${Object.keys(result.checks).length}/${Object.keys(result.checks).length} 通过，exit 0` : `结果：失败，exit 1`)
  if (result.baseline !== undefined) {
    lines.push(`基线：${relative(REPO_ROOT, opts.baseline).split(sep).join('/')}（${result.baseline.rows} 行，${(result.baseline.sources ?? []).map((s) => s.layer).join(', ')}）`)
  }
  if (result.error !== undefined) lines.push(`错误：${result.error}`)
  for (const note of result.notes ?? []) lines.push(`note: ${note}`)
  return lines.join('\n')
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const started = Date.now()
  const result = { ok: false, profile: opts.profile, dshHome: opts.dshHome, profileDir: opts.profileDir, checks: {}, notes: [] }
  const selected = (id) => opts.only === undefined || opts.only.includes(id)

  try {
    assertIsolatedHome(opts)
    if (!existsSync(join(opts.profileDir, 'package.json'))) {
      throw new Error(
        `profile "${opts.profile}" is not installed at ${opts.profileDir}\n`
        + `  install it first:  node scripts/install-profile.mjs --home "${opts.dshHome}"`,
      )
    }
    if (!existsSync(join(opts.profileDir, 'node_modules'))) {
      throw new Error(`profile ${opts.profileDir} has no node_modules; run pnpm install in it (node scripts/install-profile.mjs --home "${opts.dshHome}")`)
    }
    const cli = resolveCli(opts)
    result.cli = {
      binJs: cli.binJs, version: cli.version, wantedVersion: cli.wantedVersion,
      versionMatches: cli.versionMatches, source: cli.source, moduleRoot: cli.moduleRoot,
    }
    if (!cli.versionMatches) {
      result.notes.push(`CLI 版本 ${cli.version} 与 profile 装的 ${cli.wantedVersion} 不一致（用 --dsh-bin 指定正确的 CLI）`)
    }
    if (cli.moduleRoot === undefined || !existsSync(join(cli.moduleRoot, '@deepseek-ai', 'cordis'))) {
      result.notes.push(`CLI 那棵树里没有 @deepseek-ai/cordis（${cli.moduleRoot}）：S2 的进程内挂载需要它`)
    }

    // 基线（S4 用；--write-baseline 只重生成、不判分）
    const baselineExists = existsSync(opts.baseline)
    const baselineBefore = baselineExists ? JSON.parse(readFileSync(opts.baseline, 'utf8')) : undefined
    const baseline = baselineExists ? baselineBefore : undefined
    result.baseline = baseline === undefined
      ? { path: opts.baseline, rows: 0, exists: false }
      : { path: opts.baseline, rows: baseline.rows?.length ?? 0, sources: baseline.sources, dshVersion: baseline.dshVersion, exists: true }

    if (opts.writeBaseline) {
      const generated = buildBaseline({ profileDir: opts.profileDir, dshHome: opts.dshHome, dshVersion: cli.wantedVersion ?? cli.version })
      mkdirSync(dirname(opts.baseline), { recursive: true })
      writeFileSync(opts.baseline, `${JSON.stringify(generated, undefined, 2)}\n`)
      const diff = describeBaselineDiff(baselineBefore, generated)
      const summary = {
        ok: true, wrote: relative(REPO_ROOT, opts.baseline).split(sep).join('/'),
        rows: generated.rows.length, sources: generated.sources, diff,
      }
      process.stdout.write(opts.json
        ? `${JSON.stringify(summary, undefined, 2)}\n`
        : `[write-baseline] ${summary.wrote}\n  行数 ${summary.rows}；来源 ${generated.sources.map((s) => `${s.layer}@${s.version}×${s.rows}`).join(', ')}\n`
          + `  与旧基线差异：+${diff.added.length} -${diff.removed.length} ~${diff.changed.length}`
          + `${diff.added.length + diff.removed.length + diff.changed.length > 0 ? `\n    新增 ${diff.added.slice(0, 10).join(', ')}\n    移除 ${diff.removed.slice(0, 10).join(', ')}\n    改名/换层 ${diff.changed.slice(0, 10).join(', ')}` : ''}\n`)
      process.exit(0)
    }

    if (selected('s1')) result.checks.s1 = checkS1(cli, opts).check
    if (selected('s4')) result.checks.s4 = checkS4(cli, opts, baseline, undefined)
    if (selected('s3')) result.checks.s3 = checkS3(opts, result.notes)
    if (selected('s2')) result.checks.s2 = checkS2(cli, opts)
    if (selected('s5')) result.checks.s5 = checkS5(cli, opts)

    result.ok = Object.values(result.checks).every((check) => check.ok)
  } catch (error) {
    result.error = error?.message ?? String(error)
    result.ok = false
  }
  result.durationMs = Date.now() - started

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
  } else {
    process.stdout.write(`${consoleReport(result, opts)}\n`)
    if (result.error !== undefined) process.stdout.write(`\n${result.error}\n`)
  }
  process.exit(result.ok ? 0 : 1)
}

/** 只有作为 CLI 直接跑时才执行；被测试 import 时只导出解析器与生成器。 */
const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (invokedDirectly) main()
