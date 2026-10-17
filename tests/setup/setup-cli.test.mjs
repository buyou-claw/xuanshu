/**
 * tests/setup/setup-cli.test.mjs — 十条断言面的**端到端**部分（第 1–7、9 条）。
 *
 * 断言面 = **外部可观察物**（契约 §10）：进程退出码 / 报告 JSON / 缓存目录的字节 / 是否发起过请求。
 * 不 import 实现内部模块做白盒断言 —— 编排错了就是错了，怎么写的与断言台无关。
 *
 * 全部替身与隔离手段：
 *   - `XUANSHU_SETUP_PIN` → **测试自己的 pin**（fixture 归档的 sha256/size），形状逐字段照契约 §3.1；
 *   - `XUANSHU_UVX_BIN` → `fixtures/bin/uvx.mjs`（回放真机形状的 doctor/install/runtime/serve）；
 *   - `XUANSHU_INSTALL_PROFILE_BIN` / `XUANSHU_VERIFY_ASSEMBLY_BIN` → 两个替身（零 pnpm、零 DSH 启动）；
 *   - 本地计数 server（独立进程）是**唯一**的「网络」，用来断言「零请求」与「Range 续传」；
 *   - 临时 dsh-home / cache / runtime-root 全在 `tests/setup/.tmp/**`（gitignore）。
 *
 * 绝不发生的事：不碰真实 `~/.dsh` 或 `C:\horosa`、不读 719MB 的真实 runtime 归档、不发真实外网请求。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  FAKE_UVX, REAL_HOME, STUB_INSTALL_PROFILE, STUB_VERIFY_ASSEMBLY,
} from './lib/paths.mjs'
import { PLATFORM_KEY, PIN_VERSION, writeFixtureArtifacts, writeMismatchedArtifact, writeTestPin } from './lib/fixtures.mjs'
import { listFiles, makeSandbox } from './lib/sandbox.mjs'
import { sha256File } from './lib/sha.mjs'
import { findFreePort, readCalls, readReport, runSetup, startReleaseServer } from './lib/setup-run.mjs'

const GANZI_RE = /^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]$/
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 每个用例一个沙箱（`.tmp/<label>-XXXX`，跑完保留现场；上一批由 lib/sandbox.mjs 自动清理）。 */
function sandboxFor(label) {
  return makeSandbox(label)
}

/**
 * `--json` 的 stdout 必须是**恰好一份** JSON 文档（契约 §2：「stdout 只输出报告 JSON」）。
 * 进度行、`[setup] …` 日志、第二份报告都会在这里当场抓住。
 */
function expectSingleJsonDoc(result) {
  expect(result.json, `--json 下 stdout 不是一份可解析的 JSON：\n${result.raw()}`).toBeDefined()
  const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim() !== '')
  expect(lines[0].trim(), `stdout 第一行不是 JSON 开头：${lines[0]?.slice(0, 120)}`).toBe('{')
  expect(lines[lines.length - 1].trim(), `stdout 最后一行不是 JSON 结尾：${lines[lines.length - 1]?.slice(0, 120)}`).toBe('}')
  // 拼接两份报告时，第二份会以「顶格的 {」开头；缩进 2 的嵌套键都带前导空格，所以只数顶格根行。
  const roots = lines.filter((line) => /^[[{]/.test(line))
  expect(roots.length, `stdout 里有 ${roots.length} 个顶格 JSON 根行：${roots.slice(0, 4).join(' | ')}`).toBe(1)
}

/** 公共参数：三个目录 + `--json`。 */
function baseArgs(sandbox) {
  return ['--cache', sandbox.cache, '--dsh-home', sandbox.home, '--runtime-root', sandbox.runtimeRoot, '--json']
}

/** 公共环境：五个注入口 + stub 记账（受管变量先删再设，见 lib/env.mjs）。 */
function baseEnv(sandbox, extra = {}) {
  return {
    XUANSHU_SETUP_PIN: join(sandbox.work, 'pin.json'),
    XUANSHU_UVX_BIN: FAKE_UVX,
    XUANSHU_FAKE_UVX_STATE: sandbox.state,
    XUANSHU_INSTALL_PROFILE_BIN: STUB_INSTALL_PROFILE,
    XUANSHU_VERIFY_ASSEMBLY_BIN: STUB_VERIFY_ASSEMBLY,
    XUANSHU_STUB_LOG: sandbox.state,
    XUANSHU_SKIP_PREFLIGHT: '1',
    ...extra,
  }
}

/** 把 fixture 归档当下载源：路由按 URL 里的资产名匹配（pin 的 releaseBase 指向本 server）。 */
function downloadRoutes(artifacts, extra = {}) {
  return {
    [artifacts.wheel.name]: { file: artifacts.wheel.path, range: true },
    [artifacts.runtime.name]: { file: artifacts.runtime.path, range: true },
    ...extra,
  }
}

/** 测试 pin：releaseBase → 本地 server，wheel/runtime → fixture。 */
function testPin(sandbox, server, artifacts, extra = {}) {
  return writeTestPin({
    path: join(sandbox.work, 'pin.json'),
    releaseBase: server.releaseBase,
    wheel: artifacts.wheel,
    runtime: { platform: PLATFORM_KEY, ...artifacts.runtime },
    ...extra,
  })
}

/** 起 server → 跑用例 → 关 server（用例里抛错也要关）。 */
async function withServer(sandbox, routes, fn) {
  const server = await startReleaseServer({ state: sandbox.state, routes })
  try {
    return await fn(server)
  } finally {
    server.stop()
  }
}

/**
 * 造一个**内容更大**的 wheel fixture（续传用例要「半个文件」有意义）。
 *
 * ⚠️ 必须写到**另一个目录**：`writeFixtureArtifacts` 用的是同名文件，同目录下后来者会把它覆盖掉
 * （曾经这样踩过 —— pin 里写着 2MB，server 却只发了 411B，症状是「续传永远差 2MB」）。
 */
function bigWheelFixture(sandbox, megabytes = 2) {
  const dir = join(sandbox.work, 'artifacts-big')
  mkdirSync(dir, { recursive: true })
  const name = `horosa_skill-${PIN_VERSION}-py3-none-any.whl`
  const file = join(dir, name)
  const chunk = Buffer.from('XUANSHU-RANGE-FIXTURE-0123456789abcdef\n', 'utf8')
  const count = Math.ceil((megabytes * 1024 * 1024) / chunk.length)
  const bytes = Buffer.concat(Array.from({ length: count }, () => chunk))
  writeFileSync(file, bytes)
  return { name, path: file, sha256: sha256File(file), size: bytes.length }
}

describe('票 05 · 第 2/1 条：离线取件与 SHA256 门', () => {
  it('第 2 条：`--wheel` + `--runtime` 走本地件 → 全程零 HTTP、exit 0、动作标 offline', async () => {
    const sandbox = sandboxFor('offline')
    const artifacts = writeFixtureArtifacts(sandbox)
    await withServer(sandbox, { default: { status: 404 } }, async (server) => {
      testPin(sandbox, server, artifacts)
      const result = runSetup(
        [...baseArgs(sandbox), '--wheel', artifacts.wheel.path, '--runtime', artifacts.runtime.path, '--no-selfcheck'],
        { env: baseEnv(sandbox) },
      )
      expect(result.status, result.raw()).toBe(0)
      expectSingleJsonDoc(result)
      // 计数器是**独立进程**：spawnSync 阻塞不了它。0 = 实现真的一个请求都没发。
      expect(await server.count(), `离线路径竟然发了 ${(await server.requests()).length} 次请求：${JSON.stringify(await server.requests())}`).toBe(0)
      const { report } = readReport(sandbox.home)
      expect(report, '没写报告').toBeDefined()
      expect(report.pin.wheel.action).toBe('offline')
      expect(report.pin.runtime.action).toBe('offline')
      expect(report.pin.wheel.path).toBe(artifacts.wheel.path)
      expect(report.pin.runtime.path).toBe(artifacts.runtime.path)
    })
  })

  it('第 1 条：本地 wheel 的 SHA256 与 pin 不符 → exit 2、runtime 根零新文件、缓存零残留', async () => {
    const sandbox = sandboxFor('mismatch')
    const artifacts = writeFixtureArtifacts(sandbox)
    const tampered = writeMismatchedArtifact(sandbox, { name: artifacts.wheel.name, tag: 'wheel' })
    await withServer(sandbox, downloadRoutes(artifacts), async (server) => {
      const pin = testPin(sandbox, server, artifacts)
      const result = runSetup(
        [...baseArgs(sandbox), '--wheel', tampered.path, '--runtime', artifacts.runtime.path, '--no-selfcheck'],
        { env: baseEnv(sandbox) },
      )
      expect(result.status, result.raw()).toBe(2)
      // 「一个字节都不装」：runtime 根下没有任何东西
      expect(listFiles(sandbox.runtimeRoot), 'runtime 根下出现了文件（说了「不装」却写了盘）').toEqual([])
      // 缓存里不许留下最终件或 `.part`
      expect(existsSync(join(sandbox.cache, artifacts.wheel.name))).toBe(false)
      expect(listFiles(sandbox.cache).filter((file) => file.endsWith('.part'))).toEqual([])
      // 也没走到 install
      expect(readCalls(sandbox.state).filter((call) => call.kind === 'install')).toEqual([])
      // 错误信息必须能诊断：期望 vs 实际 + pin 版本（契约 §3.5）
      const output = `${result.stdout}\n${result.stderr}`
      expect(output).toContain(pin.wheel.sha256)
      expect(output).toContain(tampered.sha256)
      expect(output).toContain(PIN_VERSION)
    })
  })
})

describe('票 05 · 第 3 条：断点续传（Range）', () => {
  it('先断连留下 .part → 重跑带 `Range: bytes=<已下>-` 续上、最终 SHA256 正确、无 .part 残留', async () => {
    const sandbox = sandboxFor('resume')
    const wheel = bigWheelFixture(sandbox, 2)
    const artifacts = writeFixtureArtifacts(sandbox) // 只借它的 runtime；wheel 用上面那份大的
    const half = Math.floor(wheel.size / 2)
    const routes = downloadRoutes(
      { ...artifacts, wheel },
      { [wheel.name]: { file: wheel.path, range: true, breakAfterBytes: half, breakTimes: 1 } },
    )
    await withServer(sandbox, routes, async (server) => {
      testPin(sandbox, server, { wheel, runtime: artifacts.runtime })

      // 第一次：只下一次就放弃（--retries 1），服务端在半个文件处断连。
      // 故意**不传** `--wheel`：让 wheel 走 pin 的 URL → 本地计数 server（这才是「下载中断」）。
      const first = runSetup(
        [...baseArgs(sandbox), '--runtime', artifacts.runtime.path, '--no-selfcheck', '--retries', '1'],
        { env: baseEnv(sandbox) },
      )
      expect(first.status, first.raw()).toBe(2)
      const partPath = join(sandbox.cache, `${wheel.name}.part`)
      expect(existsSync(partPath), '.part 没留下：中断的下载无法续传（契约 §3.2）').toBe(true)
      const partialSize = statSync(partPath).size
      expect(partialSize).toBeGreaterThan(0)
      expect(partialSize).toBeLessThan(wheel.size)
      // 服务端确实「先给半个后断连」：拿响应侧台账判，不信请求行（请求行在响应前就落盘了）
      const outcomes = await server.responses()
      expect(outcomes.some((outcome) => outcome.kind === 'break' && outcome.sent < wheel.size), `服务端没真的断连：${JSON.stringify(outcomes)}`).toBe(true)

      // 第二次：同样的 cache，走 Range 续传。
      await server.reset()
      const second = runSetup(
        [...baseArgs(sandbox), '--runtime', artifacts.runtime.path, '--no-selfcheck'],
        { env: baseEnv(sandbox) },
      )
      expect(second.status, second.raw()).toBe(0)

      const requests = await server.requests()
      const wheelRequests = requests.filter((request) => request.url.includes(wheel.name))
      expect(wheelRequests.length, '第二次压根没请求 wheel（那就不是续传）').toBeGreaterThan(0)
      const ranged = wheelRequests.find((request) => typeof request.range === 'string')
      expect(ranged, `重跑没有带 Range 头，请求是：${JSON.stringify(wheelRequests)}`).toBeDefined()
      expect(ranged.range).toBe(`bytes=${partialSize}-`)

      // 落盘字节正确、`.part` 已原子改名、sidecar 写了 pin 的 sha256
      const finalPath = join(sandbox.cache, wheel.name)
      expect(existsSync(finalPath)).toBe(true)
      expect(sha256File(finalPath)).toBe(wheel.sha256)
      expect(statSync(finalPath).size).toBe(wheel.size)
      expect(listFiles(sandbox.cache).filter((file) => file.endsWith('.part'))).toEqual([])
      expect(readFileSync(join(sandbox.cache, `${wheel.name}.sha256`), 'utf8').trim()).toContain(wheel.sha256)
      expect(readReport(sandbox.home).report.pin.wheel.action).toBe('downloaded')
    })
  })
})

describe('票 05 · 第 4/5 条：环境门（win32 ASCII 根、真实 ~/.dsh）', () => {
  it.runIf(process.platform === 'win32')(
    '第 4 条：非 ASCII runtime 根 → exit 3，且发生在**下载之前**（零请求）',
    async () => {
      const sandbox = sandboxFor('ascii-gate')
      const artifacts = writeFixtureArtifacts(sandbox)
      await withServer(sandbox, downloadRoutes(artifacts), async (server) => {
        testPin(sandbox, server, artifacts)
        // 故意**不给** --wheel/--runtime：门要是没挡住，实现就会去下载（计数立刻 >0）。
        const nonAsciiRoot = join(sandbox.root, '运行时', 'horosa')
        const result = runSetup([...baseArgs(sandbox), '--runtime-root', nonAsciiRoot, '--no-selfcheck'], { env: baseEnv(sandbox) })
        expect(result.status, result.raw()).toBe(3)
        expect(await server.count(), '环境门在下载之后才挡（顺序错了）').toBe(0)
        expect(existsSync(nonAsciiRoot), '非 ASCII runtime 根被创建了：门在写盘之后才挡').toBe(false)
        expect(`${result.stdout}\n${result.stderr}`).toContain('HOROSA_RUNTIME_ROOT')
      })
    },
  )

  it('第 5 条：`--dsh-home` 指向真实 `~/.dsh` 且没给 `--install` → exit 3，一个文件都不写', async () => {
    const sandbox = sandboxFor('real-home')
    const artifacts = writeFixtureArtifacts(sandbox)
    // 让**子进程的** home 变成沙箱里的假 home：这样「真实 ~/.dsh」= 那个假 home，
    // 断言「拒绝」时即便实现有 bug 也污染不到用户的真目录（比直接指真目录安全一个量级）。
    const pretendHome = join(sandbox.root, 'pretend-home')
    const pretendDsh = join(pretendHome, '.dsh')
    mkdirSync(pretendDsh, { recursive: true })

    // 同时给真实 ~/.dsh 拍一张**只读**快照（顶层 + profiles 一层 + xuanshu 一层 + 报告 mtime），事后必须逐项不变。
    // 为什么连 `<real>/xuanshu` 也要拍：修 bug 前的那版实现会在**拒绝路径**上把报告写进这个目录
    // （`<real>/xuanshu/setup-report.json`）—— 顶层的 `xuanshu` 一次出现之后，光看顶层就再也发现不了新增了。
    const realBefore = {
      top: listDir(REAL_HOME),
      profiles: listDir(join(REAL_HOME, 'profiles')),
      xuanshu: listDir(join(REAL_HOME, 'xuanshu')),
      report: mtimeOf(join(REAL_HOME, 'xuanshu', 'setup-report.json')),
    }

    await withServer(sandbox, downloadRoutes(artifacts), async (server) => {
      testPin(sandbox, server, artifacts)
      const result = runSetup(
        ['--cache', sandbox.cache, '--dsh-home', pretendDsh, '--runtime-root', sandbox.runtimeRoot, '--json', '--no-selfcheck'],
        { env: baseEnv(sandbox, { USERPROFILE: pretendHome, HOME: pretendHome }) },
      )
      expect(result.status, result.raw()).toBe(3)
      expect(listFiles(pretendDsh), '拒绝路径竟然写了盘').toEqual([])
      expect(existsSync(join(pretendDsh, 'xuanshu', 'setup-report.json'))).toBe(false)
      expect(await server.count(), '拒绝路径竟然发了请求').toBe(0)
    })

    expect(listDir(REAL_HOME)).toEqual(realBefore.top)
    expect(listDir(join(REAL_HOME, 'profiles'))).toEqual(realBefore.profiles)
    expect(listDir(join(REAL_HOME, 'xuanshu'))).toEqual(realBefore.xuanshu)
    expect(mtimeOf(join(REAL_HOME, 'xuanshu', 'setup-report.json'))).toBe(realBefore.report)
  })
})

describe('票 05 · 第 6/9 条：全绿 + 幂等 + 报告 schema', () => {
  it('连跑两次全绿：第一次真下载、第二次零下载 + already-installed + 新报告', async () => {
    const sandbox = sandboxFor('green')
    const artifacts = writeFixtureArtifacts(sandbox)
    const port = await findFreePort()
    await withServer(sandbox, downloadRoutes(artifacts), async (server) => {
      testPin(sandbox, server, artifacts)
      const args = [...baseArgs(sandbox), '--selfcheck-timeout', '30000']
      const env = baseEnv(sandbox, { XUANSHU_HOROSA_PORT: String(port) })

      const first = runSetup(args, { env, timeoutMs: 180_000 })
      expect(first.status, first.raw()).toBe(0)
      expectSingleJsonDoc(first)
      expect(await server.count(), '第一次竟然没下载（那就测不出「第二次零下载」）').toBeGreaterThan(0)

      const report1 = readReport(sandbox.home).report
      expect(report1, '第一次没写报告').toBeDefined()
      expect(report1.pin.wheel.action).toBe('downloaded')
      expect(report1.runtime.action).toBe('installed')
      expect(report1.exitCode).toBe(0)

      // ── 第 9 条：报告 schema（在第一次的报告上断言）
      expect(report1.schema).toBe('xuanshu/setup-report@1')
      expect(report1.ok).toBe(true)
      expect(report1.checks.map((check) => check.id)).toEqual(['assembly', 'horosa8765', 'bazi'])
      for (const check of report1.checks) {
        expect(check.ok, `${check.id} 没绿：${check.detail}`).toBe(true)
        expect(typeof check.detail).toBe('string')
      }
      expect(report1.pin.version).toBe(PIN_VERSION)
      expect(report1.pin.wheel).toMatchObject({ name: artifacts.wheel.name, sha256: artifacts.wheel.sha256 })
      expect(report1.pin.runtime).toMatchObject({ platform: PLATFORM_KEY, sha256: artifacts.runtime.sha256 })
      // A10：本机平台键在 pin 里直接命中 → 回退字段必须是 null（**存在**且为 null，不是缺键）。
      expect(report1.pin.runtime.platformFallback).toBe(null)
      expect(report1.runtime).toMatchObject({ root: sandbox.runtimeRoot, action: 'installed', version: PIN_VERSION })
      expect(report1.runtime.dataDir).toBe(join(sandbox.home, 'xuanshu', 'horosa'))
      // A11：C1 的原始 JSON 与 doctor 的原始 JSON 都落 `<dsh-home>/xuanshu/logs/`，报告里给路径，且文件真的在。
      expect(existsSync(report1.checks[0].evidence.logFile), `C1 的 logs 路径不指向真文件：${report1.checks[0].evidence.logFile}`).toBe(true)
      expect(report1.checks[0].evidence.logFile).toContain(join('xuanshu', 'logs'))
      const logs = report1.runtime.evidence.logs
      expect(logs, 'runtime evidence 里没有 logs 段').toBeTypeOf('object')
      for (const key of ['doctorBefore', 'doctorAfter', 'install']) {
        expect(logs[key], `logs.${key} 没给路径`).toBeTruthy()
        expect(existsSync(logs[key]), `logs.${key} 指向的文件不在：${logs[key]}`).toBe(true)
      }
      expect(JSON.parse(readFileSync(logs.doctorAfter, 'utf8')).runtime_payload_version).toBe(PIN_VERSION)
      expect(report1.profile).toMatchObject({ name: 'xuanshu', home: sandbox.home, mode: 'link' })
      expect(Date.parse(report1.generatedAt)).not.toBeNaN()
      expect(Array.isArray(report1.notes)).toBe(true)

      // ── 第 6 条：第二次
      await sleep(1100) // generatedAt 是毫秒 ISO 串：留出一格，确保「更新」是可判的
      const countAfterFirst = await server.count()
      const second = runSetup(args, { env, timeoutMs: 180_000 })
      expect(second.status, second.raw()).toBe(0)
      expect(await server.count(), '第二次又下载了（缓存命中失效）').toBe(countAfterFirst)

      const report2 = readReport(sandbox.home).report
      expect(report2.runtime.action, '第二次没标 already-installed').toBe('already-installed')
      expect(Date.parse(report2.generatedAt)).toBeGreaterThan(Date.parse(report1.generatedAt))
      expect(report2.schema).toBe('xuanshu/setup-report@1')
      expect(report2.ok).toBe(true)
      expect(report2.checks.map((check) => check.id)).toEqual(['assembly', 'horosa8765', 'bazi'])

      // install 只跑过一次；profile 装配跑过两次（幂等重跑）
      const calls = readCalls(sandbox.state)
      expect(calls.filter((call) => call.kind === 'install')).toHaveLength(1)
      expect(readCalls(sandbox.state, 'install-profile.jsonl')).toHaveLength(2)
    })
  }, 240_000)

  it('第 9 条（§7 样例三块）：horosa8765 带 verdict、bazi 带 tool/version/pillars', async () => {
    const sandbox = sandboxFor('report-evidence')
    const artifacts = writeFixtureArtifacts(sandbox)
    const port = await findFreePort()
    await withServer(sandbox, downloadRoutes(artifacts), async (server) => {
      testPin(sandbox, server, artifacts)
      const result = runSetup(
        [...baseArgs(sandbox), '--selfcheck-timeout', '30000'],
        { env: baseEnv(sandbox, { XUANSHU_HOROSA_PORT: String(port) }), timeoutMs: 180_000 },
      )
      expect(result.status, result.raw()).toBe(0)
      const { report } = readReport(sandbox.home)
      const [assembly, horosa, bazi] = report.checks
      expect(assembly.evidence, 'assembly 的 evidence 不是对象').toBeTypeOf('object')
      expect(horosa.verdict).toBe('horosa-ready')
      expect(bazi.evidence.tool).toBe('horosa_cn_bazi_birth')
      expect(bazi.evidence.version).toBe(PIN_VERSION)
      expect(bazi.evidence.pillars).toHaveLength(4)
      for (const pillar of bazi.evidence.pillars) expect(pillar).toMatch(GANZI_RE)
    })
  }, 240_000)
})

describe('票 05 · 第 7 条：退出码表（2/3/4/5 各至少一例）', () => {
  it('exit 2：pin 里没有当前平台 → exit 2 并列出 pin 支持的平台', async () => {
    const sandbox = sandboxFor('exit2')
    const artifacts = writeFixtureArtifacts(sandbox)
    await withServer(sandbox, downloadRoutes(artifacts), async (server) => {
      const other = PLATFORM_KEY === 'darwin-arm64' ? 'win32-x64' : 'darwin-arm64'
      testPin(sandbox, server, artifacts, { platforms: [other] })
      const result = runSetup([...baseArgs(sandbox), '--wheel', artifacts.wheel.path, '--no-selfcheck'], { env: baseEnv(sandbox) })
      expect(result.status, result.raw()).toBe(2)
      expect(`${result.stdout}\n${result.stderr}`).toContain(other)
    })
  })

  it('exit 3：真实 ~/.dsh 未显式 --install（与第 5 条同一道门，这里只钉退出码本身）', async () => {
    const sandbox = sandboxFor('exit3')
    const artifacts = writeFixtureArtifacts(sandbox)
    const pretendHome = join(sandbox.root, 'pretend-home')
    const pretendDsh = join(pretendHome, '.dsh')
    mkdirSync(pretendDsh, { recursive: true })
    // 必须有**合法**的 pin：否则先炸的是「pin 读不到」（exit 2），测不到这道门。
    await withServer(sandbox, downloadRoutes(artifacts), async (server) => {
      testPin(sandbox, server, artifacts)
      const result = runSetup(
        ['--cache', sandbox.cache, '--dsh-home', pretendDsh, '--runtime-root', sandbox.runtimeRoot, '--json', '--no-selfcheck'],
        { env: baseEnv(sandbox, { USERPROFILE: pretendHome, HOME: pretendHome }) },
      )
      expect(result.status, result.raw()).toBe(3)
    })
  })

  it('exit 4：`install --archive` 非 0 → exit 4', async () => {
    const sandbox = sandboxFor('exit4-install')
    const artifacts = writeFixtureArtifacts(sandbox)
    await withServer(sandbox, downloadRoutes(artifacts), async (server) => {
      testPin(sandbox, server, artifacts)
      const result = runSetup(
        [...baseArgs(sandbox), '--wheel', artifacts.wheel.path, '--runtime', artifacts.runtime.path, '--no-selfcheck'],
        { env: baseEnv(sandbox, { XUANSHU_FAKE_UVX_MODE: 'fail-install' }) },
      )
      expect(result.status, result.raw()).toBe(4)
      // 安装失败的原文要进证据（契约 §4.2）
      expect(`${result.stdout}\n${result.stderr}`).toContain('runtime.install_failed')
    })
  })

  it('exit 4：装完 doctor 的版本 ≠ pin 版本（同版本硬门，禁止新树混旧 runtime）', async () => {
    const sandbox = sandboxFor('exit4-version')
    const artifacts = writeFixtureArtifacts(sandbox)
    await withServer(sandbox, downloadRoutes(artifacts), async (server) => {
      testPin(sandbox, server, artifacts)
      const result = runSetup(
        [...baseArgs(sandbox), '--wheel', artifacts.wheel.path, '--runtime', artifacts.runtime.path, '--no-selfcheck'],
        { env: baseEnv(sandbox, { XUANSHU_FAKE_UVX_MODE: 'wrong-version' }) },
      )
      expect(result.status, result.raw()).toBe(4)
      const output = `${result.stdout}\n${result.stderr}`
      expect(output).toContain('0.39.9') // doctor 报的那个版本
      expect(output.toLowerCase()).toContain('force') // 处置提示：install --force（契约 §4.3）
    })
  })

  /**
   * A3：版本门的**唯一**取值来源是 `runtime_payload_version`（等价 `freshness.installed_version`）。
   * 这两条用例把「拿别的键兜底」当场抓出来：
   *   ① `manifest-only`：doctor 只说清单版本（= pin），载荷版本字段缺席 —— 旧实现会读 manifest_version
   *      判「已装同版本」→ 跳过安装 → exit 0（假绿）；现在必须 exit 4 且点名缺的两个字段；
   *   ② `manifest-lies`：清单版本 = pin，载荷版本 = 0.39.9 —— 「新清单蒙着旧载荷」，必须 exit 4。
   */
  it('exit 4：doctor 只给 manifest_version（载荷版本字段缺席）→ 取不到版本 → exit 4', async () => {
    const sandbox = sandboxFor('exit4-manifest-only')
    const artifacts = writeFixtureArtifacts(sandbox)
    await withServer(sandbox, downloadRoutes(artifacts), async (server) => {
      testPin(sandbox, server, artifacts)
      const result = runSetup(
        [...baseArgs(sandbox), '--wheel', artifacts.wheel.path, '--runtime', artifacts.runtime.path, '--no-selfcheck'],
        { env: baseEnv(sandbox, { XUANSHU_FAKE_UVX_MODE: 'manifest-only' }) },
      )
      expect(result.status, result.raw()).toBe(4)
      const output = `${result.stdout}\n${result.stderr}`
      expect(output).toContain('runtime_payload_version')
      expect(output).toContain('freshness.installed_version')
    })
  })

  it('exit 4：manifest_version 等于 pin 但 runtime_payload_version 是 0.39.9 → exit 4', async () => {
    const sandbox = sandboxFor('exit4-manifest-lies')
    const artifacts = writeFixtureArtifacts(sandbox)
    await withServer(sandbox, downloadRoutes(artifacts), async (server) => {
      testPin(sandbox, server, artifacts)
      const result = runSetup(
        [...baseArgs(sandbox), '--wheel', artifacts.wheel.path, '--runtime', artifacts.runtime.path, '--no-selfcheck'],
        { env: baseEnv(sandbox, { XUANSHU_FAKE_UVX_MODE: 'manifest-lies' }) },
      )
      expect(result.status, result.raw()).toBe(4)
      const output = `${result.stdout}\n${result.stderr}`
      expect(output).toContain('0.39.9')
      expect(output).toContain(PIN_VERSION)
    })
  })

  it('exit 5：C1（装配可启动）失败 → exit 5，报告里 assembly 是红的', async () => {
    const sandbox = sandboxFor('exit5')
    const artifacts = writeFixtureArtifacts(sandbox)
    const port = await findFreePort()
    await withServer(sandbox, downloadRoutes(artifacts), async (server) => {
      testPin(sandbox, server, artifacts)
      const result = runSetup(
        [...baseArgs(sandbox), '--selfcheck-timeout', '30000'],
        {
          env: baseEnv(sandbox, { XUANSHU_HOROSA_PORT: String(port), XUANSHU_STUB_MODE: 'fail-verify' }),
          timeoutMs: 180_000,
        },
      )
      expect(result.status, result.raw()).toBe(5)
      expect(result.json, `--json 下 stdout 不是报告 JSON：\n${result.raw()}`).toBeDefined()
      expect(result.json.exitCode).toBe(5)
      expect(result.json.ok).toBe(false)
      expect(result.json.checks[0].id).toBe('assembly')
      expect(result.json.checks[0].ok).toBe(false)
    })
  }, 240_000)
})

/** 文件的 mtime（毫秒）；不存在 → null。用于「真实 home 一个字节都没变」的只读快照。 */
function mtimeOf(path) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

/** 目录项名（排序）；目录不存在 → []（干净机器上没有 `<real>/xuanshu` 是正常的）。 */
function listDir(path) {
  try {
    return readdirSync(path).sort()
  } catch {
    return []
  }
}
