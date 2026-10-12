/**
 * P10 · **真实 e2e**（默认 skip；`XUANSHU_E2E=1` 才跑）
 *
 * 为什么默认 skip：这条用例会用**真实 uvx + 真实 `C:\horosa` runtime + 真实 8765**，跑分钟级，
 * 而且依赖本机装好的东西。把它塞进默认路径会让「全绿」变成「看机器」；
 * 但它是**唯一**能证明「profile 静态行 → 装配树里真有 `mcp__horosa__*` 工具」的用例（票面第 1、3、4 条），
 * 所以它必须存在、必须有，而且跑的时候一步都不许省。
 *
 * 步骤（缺任一步的机器上：**报错并给出可执行处置**，不静默跳过 —— 静默跳过就是假绿）：
 *   1. **新鲜度门**：`packages/xuanshu-host/lib/**` ↔ `profile/node_modules/xuanshu-host/lib/**` 逐字节比。
 *      背景（Lead 2026-10-13 实测）：profile 里那份是 pnpm 物化的**真拷贝**，不是 symlink ——
 *      改完仓库代码不重跑 `node scripts/install-profile.mjs --home <repo>/.dsh-home`，boot 加载的就是旧代码。
 *      （这条门在 2026-10-13 真抓到过一次：T1 改完 `plan/service.mjs` 后第一次跑 P10 就是它红的。）
 *   2. **前置件**：wheel / `C:\horosa` / T2 的 CLI / boot 探针 / DSH CLI / `.dsh-home` profile。
 *   3a. **复用分支**：8765 上先放一份**别人的** horosa（用假 MCP 服务器占位）→ `startHorosaServe`
 *      必须复用（`started:false`）且**不 spawn**，并且那份别人的必须还活着。
 *   3b. **自起分支**：把占位收掉 → 8765 空出来 → `startHorosaServe` 起真实 serve（记 `state.owned`）。
 *   4. **`bazi-contract.mjs`**：直打 127.0.0.1:8765/mcp 的四组断言，exit 0 + `report.ok`。
 *   5. **进程内 boot**：`tests/assembly/lib/boot-inprocess.mjs` 装配整棵树，`result.tools` 里必须有
 *      `mcp__horosa__` 前缀的工具。**MCP 客户端的注册是异步的**（那一行只给
 *      `failOnStartupError:false` + reconnect 自愈），所以这里**有界轮询**：boot 探针重跑到工具出现为止
 *      （上限 4 次），不做固定 sleep。
 *   7. **层归属与市场 storage（真凭实据）**：真 CLI `--dump-config` 里 `mcp-horosa` 必须出现在
 *      `# == <profile>/cordis.patch.yml` 那一段之后；`--dump-config-schema` 里该行
 *      `status !== 'error'` 且 `x-cordis.complete === true`；真实 `$DSH_HOME` 的
 *      `storages/mcp_connector.json` 里**没有** horosa 记录。
 *   6. **收尾**：`state.owned` 时停掉自己起的 serve 并断言 8765 回到 `free`；
 *      **不拥有**时（复用分支）断言它**仍在答**（`horosa-ready`）—— 「绝不停别人的」与
 *      「收尾后必须 free」这两条只有在 owned 时才同时成立。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { checkHorosaEndpoint } from '../../packages/xuanshu-host/lib/horosa/guard.mjs'
import { startHorosaServe, stopHorosaServe } from '../../packages/xuanshu-host/lib/horosa/serve.mjs'
import { BAZI_CONTRACT_CLI, BOOT_INPROCESS, DSH_CLI_BIN, PIN_FILE, PROFILE_HOST_LIB, REAL_RUNTIME_ROOT, REPO_DSH_HOME, HOST_LIB, REPO_ROOT } from './lib/paths.mjs'
import { makeSandbox, waitFor } from './lib/sandbox.mjs'
import { childEnv } from './lib/env.mjs'
import { startFakeMcp } from './lib/servers.mjs'

const E2E = process.env.XUANSHU_E2E === '1'
const BOOT_MARKER = '##XUANSHU-BOOT-RESULT##'
const MCP_PORT = 8765
/** boot 重跑上限：MCP 客户端注册是异步的，轮询到工具出现为止（不做固定 sleep）。 */
const BOOT_ATTEMPTS = 4

/** 递归列出目录下的文件（相对路径）。 */
function listTree(dir, base = dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listTree(full, base))
    else out.push(full.slice(base.length + 1).split('\\').join('/'))
  }
  return out.sort()
}

function runNode(args, { env = {}, timeoutMs = 120_000, cwd } = {}) {
  const run = spawnSync(process.execPath, args, { cwd, env: childEnv(env), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })
  return {
    status: run.status,
    signal: run.signal,
    stdout: run.stdout ?? '',
    stderr: run.stderr ?? '',
    error: run.error?.message,
    raw() {
      return [`$ node ${args.join(' ')}`, `exit=${run.status}${run.signal ? ` signal=${run.signal}` : ''}${run.error ? ` error=${run.error.message}` : ''}`, '--- stdout ---', (run.stdout ?? '').slice(0, 4000), '--- stderr ---', (run.stderr ?? '').slice(0, 4000)].join('\n')
    },
  }
}

/** 跑真 CLI（`--dump-config` / `--dump-config-schema`），环境与 `scripts/verify-assembly.mjs` 同口径。 */
function runCli(args, { timeoutMs = 180_000 } = {}) {
  return runNode([DSH_CLI_BIN, '--profile', 'xuanshu', ...args], {
    cwd: REPO_ROOT,
    timeoutMs,
    env: { DSH_HOME: REPO_DSH_HOME, DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
  })
}

/** 从 boot 的 stdout 里抠出 `##XUANSHU-BOOT-RESULT## {json}`。 */
function parseBootResult(stdout) {
  const line = stdout.split(/\r?\n/).find((entry) => entry.includes(BOOT_MARKER))
  if (!line) return undefined
  return JSON.parse(line.slice(line.indexOf(BOOT_MARKER) + BOOT_MARKER.length).trim())
}

describe.skipIf(!E2E)('P10 · 真实端到端（8765 + 真实 uvx + 真机 runtime）', () => {
  const state = { owned: false, pid: null, port: MCP_PORT, sandbox: undefined, reuse: undefined, attempts: 0 }

  beforeAll(async () => {
    state.sandbox = makeSandbox('p10-e2e')
  }, 30_000)

  afterAll(async () => {
    if (state.reuse) await state.reuse.stop()
    if (state.owned && state.pid) {
      await stopHorosaServe({ pid: state.pid, timeoutMs: 20_000, sync: true })
    }
  }, 60_000)

  it('① 新鲜度门：仓库 lib 与 profile 物化拷贝逐字节一致（否则先跑 install-profile）', () => {
    expect(existsSync(HOST_LIB), `${HOST_LIB} 不存在`).toBe(true)
    expect(existsSync(PROFILE_HOST_LIB), `${PROFILE_HOST_LIB} 不存在（profile 没装？）`).toBe(true)
    const fix = `node scripts/install-profile.mjs --home <repo>/.dsh-home`
    const repoFiles = listTree(HOST_LIB).filter((file) => !file.endsWith('.map'))
    const drift = []
    for (const file of repoFiles) {
      const copy = join(PROFILE_HOST_LIB, file)
      if (!existsSync(copy)) continue // 仓库新增、profile 侧还没有的文件：本门不管（跑 install-profile 会补上）
      const repoBytes = readFileSync(join(HOST_LIB, file))
      const copyBytes = readFileSync(copy)
      if (!repoBytes.equals(copyBytes)) {
        const repoStat = statSync(join(HOST_LIB, file))
        const copyStat = statSync(copy)
        drift.push(`${file}（repo ${repoStat.size}B mtime=${repoStat.mtime.toISOString()} ≠ copy ${copyStat.size}B mtime=${copyStat.mtime.toISOString()}）`)
      }
    }
    for (const file of listTree(PROFILE_HOST_LIB)) {
      if (!file.endsWith('.map') && !existsSync(join(HOST_LIB, file))) drift.push(`${file}（profile 侧有、仓库侧没有 → 陈旧拷贝）`)
    }
    expect(drift, `profile 里那份是 pnpm 物化的**真拷贝**，不是 symlink：改完仓库代码必须重跑\n  ${fix}\n\n漂了的文件：\n${drift.join('\n')}`).toEqual([])
  }, 60_000)

  it('② wheel / runtime / CLI 前置件都在（缺件给可执行处置，不静默跳过）', () => {
    const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8'))
    const cacheDir = join(process.env.LOCALAPPDATA ?? homedir(), 'xuanshu', 'cache')
    const wheel = join(cacheDir, pin.wheel.name)
    expect(existsSync(wheel), `wheel 不在：${wheel}\n  处置：node scripts/setup.mjs（票 05 一键安装）`).toBe(true)
    expect(existsSync(join(REAL_RUNTIME_ROOT, 'current', 'runtime-manifest.json')), `runtime 没装：${REAL_RUNTIME_ROOT}\n  处置：node scripts/setup.mjs`).toBe(true)
    expect(existsSync(BAZI_CONTRACT_CLI), `${BAZI_CONTRACT_CLI} 还没落地（T2 的交付物）`).toBe(true)
    expect(existsSync(BOOT_INPROCESS), `${BOOT_INPROCESS} 不存在`).toBe(true)
    expect(existsSync(DSH_CLI_BIN), `${DSH_CLI_BIN} 不存在 —— 先在 profile 里 pnpm install`).toBe(true)
    expect(existsSync(join(REPO_DSH_HOME, 'profiles', 'xuanshu', 'package.json')), `${REPO_DSH_HOME}/profiles/xuanshu 没装\n  处置：node scripts/install-profile.mjs --home ${REPO_DSH_HOME}`).toBe(true)
    state.wheel = wheel
  }, 60_000)

  it('③a 复用分支：8765 上已有 horosa（假 MCP 占位）→ 复用、不 spawn、也不停别人的', async () => {
    const before = await checkHorosaEndpoint({ host: '127.0.0.1', port: MCP_PORT, path: '/mcp', timeoutMs: 3000 })
    expect(['free', 'horosa-ready'], `8765 上是 ${before.verdict}：先腾出端口再跑 e2e（绝不杀别人的进程）`).toContain(before.verdict)
    if (before.verdict === 'horosa-ready') {
      // 真机本来就有一份别人的 horosa：那就**只验复用**，别去动它（state.owned 保持 false）。
      state.reuse = undefined
      const reused = await startHorosaServe({
        wheel: state.wheel, uvxBin: 'uvx', runtimeRoot: REAL_RUNTIME_ROOT, dataDir: state.sandbox.dataDir,
        host: '127.0.0.1', port: MCP_PORT, logFile: state.sandbox.serveLog, timeoutMs: 30_000,
      })
      expect(reused.ok, JSON.stringify(reused)).toBe(true)
      expect(reused.started).toBe(false)
      expect(reused.verdict).toBe('horosa-ready')
      return
    }
    // 端口空闲：用**测试自己起的**假 MCP 占位，走一遍完整的「别人的 horosa」分支。
    const reuse = await startFakeMcp({ mode: 'mcp', port: MCP_PORT })
    state.reuse = reuse
    const callsBefore = state.sandbox.uvxCalls().length
    const reused = await startHorosaServe({
      wheel: state.wheel, uvxBin: 'uvx', runtimeRoot: REAL_RUNTIME_ROOT, dataDir: state.sandbox.dataDir,
      host: '127.0.0.1', port: MCP_PORT, logFile: state.sandbox.serveLog, timeoutMs: 30_000,
    })
    expect(reused.ok, JSON.stringify(reused)).toBe(true)
    expect(reused.started).toBe(false)
    expect(reused.pid ?? null).toBe(null)
    expect(reused.verdict).toBe('horosa-ready')
    expect(state.sandbox.uvxCalls().length, '复用分支却 spawn 了 uvx').toBe(callsBefore)
    expect(reuse.alive(), '复用分支把别人的 server 杀了？').toBe(true)
  }, 120_000)

  it('③b 自起分支：8765 空出来 → 起真实 serve（真实 uvx + C:\\horosa）', async () => {
    if (!state.reuse) {
      // 复用分支证明「别人的 horosa 在答」：这时候不该再去起第二份（那就是抢端口）。
      return
    }
    await state.reuse.stop()
    state.reuse = undefined
    await waitFor(async () => {
      const probe = await checkHorosaEndpoint({ host: '127.0.0.1', port: MCP_PORT, path: '/mcp', timeoutMs: 2000 })
      return probe.verdict === 'free'
    }, { timeoutMs: 15_000, describe: '占位服务器释放 8765' })

    const started = await startHorosaServe({
      wheel: state.wheel,
      uvxBin: 'uvx',
      runtimeRoot: REAL_RUNTIME_ROOT,
      dataDir: state.sandbox.dataDir,
      host: '127.0.0.1',
      port: MCP_PORT,
      logFile: state.sandbox.serveLog,
      timeoutMs: 120_000,
    })
    expect(started.ok, `真实 serve 起不来：${JSON.stringify(started)}\n日志尾巴：${existsSync(state.sandbox.serveLog) ? readFileSync(state.sandbox.serveLog, 'utf8').slice(-2000) : '(无日志)'}`).toBe(true)
    expect(started.started).toBe(true)
    expect(started.pid).toBeGreaterThan(0)
    state.owned = true
    state.pid = started.pid
    const after = await checkHorosaEndpoint({ host: '127.0.0.1', port: MCP_PORT, path: '/mcp', timeoutMs: 5000 })
    expect(after.verdict).toBe('horosa-ready')
  }, 180_000)

  it('④ bazi-contract.mjs 四组断言全绿（exit 0 + report.ok + 20 条 checks）', () => {
    const out = join(state.sandbox.work, 'bazi-contract-evidence.json')
    const run = runNode([BAZI_CONTRACT_CLI, '--json', '--out', out], { timeoutMs: 180_000 })
    expect(run.status, `bazi-contract 退出码 ${run.status}（1=断言失败 / 3=环境门）\n${run.raw()}`).toBe(0)
    const report = JSON.parse(run.stdout)
    expect(report.ok).toBe(true)
    expect(report.exitCode).toBe(0)
    expect(report.assertionFailures ?? []).toEqual([])
    expect(report.environment?.failures ?? []).toEqual([])
    // 按语义断言 20 条全绿（不认具体 id —— T2 改过 g4 的 id 名）。
    expect(Array.isArray(report.checks)).toBe(true)
    expect(report.checks.length, `checks 条数变了：${report.checks.length}`).toBe(20)
    expect(report.checks.filter((check) => check.ok !== true).map((check) => `${check.id}: ${check.detail}`)).toEqual([])
    expect(existsSync(out), '--out 的原始证据没落盘').toBe(true)
    // 三档 timeAlg 的实测值（§4.1 的机器判据）：判在 CLI 里，这里只抄一眼便于红的时候看现场。
    const cases = report.cases ?? {}
    expect(cases.default?.classify?.timeAlg).toBe(0)
    expect(cases.clock?.classify?.timeAlg).toBe(1)
    expect(cases.meansolar?.classify?.timeAlg).toBe(3)
    expect(cases.gate?.classify?.phase).toBe('gate')
    expect(cases.confirmed?.classify?.phase).toBe('ok')
    // 单源口径：缺省档**没有把 timeAlg 发出去**（省略，不是显式 0）。
    expect(cases.default?.payload?.sentTimeAlg).toBe('omitted')
    state.contract = {
      ok: report.ok,
      exitCode: report.exitCode,
      checks: report.checks.length,
      cases: Object.fromEntries(Object.entries(cases).map(([name, entry]) => [name, {
        phase: entry?.classify?.phase,
        timeAlg: entry?.classify?.timeAlg,
        timeAlgSource: entry?.classify?.timeAlgSource,
        sentTimeAlg: entry?.payload?.sentTimeAlg,
        envelopeChars: entry?.envelopeChars,
        truncated: entry?.truncated,
      }])),
    }
  }, 240_000)

  it('⑤ 进程内 boot：有界轮询到装配树里出现 mcp__horosa__* 工具（异步注册）', () => {
    // 为什么是「重跑到出现为止」而不是「跑一次就断言」：那一行只给了 `failOnStartupError:false` +
    // reconnect（`initialDelayMs:1000`），MCP 客户端与 8765 建连是**异步**的，
    // boot 探针在读完工具表后就 dispose 了 —— 只跑一次等于赌它在那几百毫秒里连上了（会变成 flake）。
    let result
    let run
    for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt += 1) {
      state.attempts = attempt
      run = runNode([BOOT_INPROCESS, '--dsh-home', REPO_DSH_HOME, '--profile', 'xuanshu', '--cli-bin', DSH_CLI_BIN], {
        // 插件别自己再起一份 serve（两份抢 8765）——这一份由本用例托管。
        env: { XUANSHU_HOROSA_AUTOSTART: '0' },
        timeoutMs: 180_000,
      })
      expect(run.status, `boot 探针退出码 ${run.status}（第 ${attempt} 次）\n${run.raw()}`).toBe(0)
      result = parseBootResult(run.stdout)
      expect(result, `${BOOT_MARKER} 那行没找到（第 ${attempt} 次）\n${run.raw()}`).toBeTruthy()
      if ((result.tools ?? []).some((name) => name.startsWith('mcp__horosa__'))) break
    }
    const horosaTools = (result.tools ?? []).filter((name) => name.startsWith('mcp__horosa__'))
    expect(
      horosaTools.length,
      `${BOOT_ATTEMPTS} 次 boot 都没等到 mcp__horosa__*（tools 共 ${result.tools?.length} 个）；最后一次：\n${run.raw()}`,
    ).toBeGreaterThan(0)
    // 票面第 1 条的判据：随装配即注册（不是「用户手动连一下」）。
    expect(horosaTools.some((name) => name.includes('bazi'))).toBe(true)

    state.boot = { toolCount: result.toolCount, horosaTools, attempts: state.attempts, fatal: result.fatal }
  }, 300_000)

  it('⑦ 层归属与市场 storage：真 CLI 的 --dump-config / --dump-config-schema / 真 home', () => {
    // ① 行必须出现在 **profile 补丁层**（版本库是唯一来源）—— 这是「市场删不掉」的机制判据。
    const dump = runCli(['--dump-config'])
    expect(dump.status, `--dump-config 退出码 ${dump.status}\n${dump.raw()}`).toBe(0)
    const lines = dump.stdout.split(/\r?\n/)
    const layerIndex = lines.findIndex((line) => line.startsWith('# == ') && line.includes('cordis.patch.yml'))
    expect(layerIndex, '--dump-config 里没有 profile 补丁层的层注释（# == <profile>/cordis.patch.yml）').toBeGreaterThan(-1)
    const rowIndex = lines.findIndex((line, index) => index > layerIndex && /^\s*-\s*id:\s*mcp-horosa\s*$/.test(line))
    expect(rowIndex, `mcp-horosa 行不在 profile 补丁层之后（层注释在第 ${layerIndex + 1} 行）`).toBeGreaterThan(layerIndex)
    const nextLayerIndex = lines.findIndex((line, index) => index > rowIndex && line.startsWith('# == '))
    const rowBlock = lines.slice(rowIndex, nextLayerIndex === -1 ? undefined : nextLayerIndex).join('\n')
    expect(rowBlock).toContain("name: '@deepseek-ai/dsh-mcp-client'")
    expect(rowBlock).toContain('serverName: horosa')
    expect(rowBlock).toContain('url: http://127.0.0.1:8765/mcp')

    // ② 包真的能被解析（`status !== 'error'` + 整棵树 complete）。
    const schema = runCli(['--dump-config-schema'])
    expect(schema.status, `--dump-config-schema 退出码 ${schema.status}\n${schema.raw()}`).toBe(0)
    const doc = JSON.parse(schema.stdout)
    expect(doc['x-cordis']?.complete, 'x-cordis.complete 不是 true（树没配全）').toBe(true)
    const entry = (doc['x-cordis']?.entries ?? []).find((item) => item.id === 'mcp-horosa')
    expect(entry, 'schema 里没有 mcp-horosa 行').toBeTruthy()
    expect(entry.status, `mcp-horosa 行的 status=${entry.status}`).not.toBe('error')
    expect(entry.name).toBe('@deepseek-ai/dsh-mcp-client')

    // ③ 市场 storage：真实（隔离）home 里没有 horosa 记录 —— 我们从不像市场那样写它。
    const marketFile = join(REPO_DSH_HOME, 'storages', 'mcp_connector.json')
    if (existsSync(marketFile)) {
      expect(readFileSync(marketFile, 'utf8'), '市场 storage 里出现了 horosa 记录').not.toMatch(/horosa/i)
    }
    state.layer = {
      layerLine: layerIndex + 1,
      rowLine: rowIndex + 1,
      schemaStatus: entry.status,
      complete: doc['x-cordis'].complete,
      marketFile: marketFile,
      marketFileExists: existsSync(marketFile),
    }

    writeFileSync(join(state.sandbox.work, 'p10-summary.json'), `${JSON.stringify({
      schema: 'xuanshu/horosa-e2e-summary@1',
      generatedAt: new Date().toISOString(),
      mcpPort: MCP_PORT,
      serve: { owned: state.owned, pid: state.pid, wheel: state.wheel, runtimeRoot: REAL_RUNTIME_ROOT, dataDir: state.sandbox.dataDir },
      contract: state.contract ?? null,
      boot: state.boot ?? null,
      layer: state.layer,
    }, undefined, 2)}\n`)
  }, 300_000)

  it('⑥ 收尾：owned → 停掉并回到 free；复用态 → 别人的仍在答（绝不停别人的）', async () => {
    if (state.owned && state.pid) {
      const stopped = await stopHorosaServe({ pid: state.pid, timeoutMs: 20_000, sync: true })
      expect(stopped.ok, `停自己起的 serve 失败：${JSON.stringify(stopped)}`).toBe(true)
      state.owned = false
      const after = await checkHorosaEndpoint({ host: '127.0.0.1', port: MCP_PORT, path: '/mcp', timeoutMs: 5000 })
      expect(after.verdict, `e2e 跑完 8765 上还有东西：${after.detail}`).toBe('free')
      return
    }
    // 复用分支：收掉**测试自己起的**占位（真机上那份别人的则必须保持原样）。
    if (state.reuse) {
      expect(state.reuse.alive(), '复用分支把别人的占位服务器收了？').toBe(true)
      await state.reuse.stop()
      state.reuse = undefined
      return
    }
    const after = await checkHorosaEndpoint({ host: '127.0.0.1', port: MCP_PORT, path: '/mcp', timeoutMs: 5000 })
    expect(after.verdict, `复用分支收尾后 8765 上应当仍有别人的 horosa（实际 ${after.verdict}）`).toBe('horosa-ready')
  }, 60_000)
})
