/**
 * tests/experience/probe-env.test.mjs —— 票据 #74「体验执行环境就绪探测」的判据台。
 *
 * 这条命令要回答的问题只有一个：**这台机器现在能不能跑实操评估**。
 * 它存在的理由是 ADR-0017 / 计划 §9.2 第 2 条的教训：**环境缺失会被误记成产品缺陷**。
 * 所以探测必须比被它探测的东西更诚实——
 *
 * 1. **「解析到句柄」≠「真的启动成功」**（验收标准 2）。`require()` 得到 playwright 只说明
 *    模块在磁盘上；Edge 能不能被拉起来是另一件事。两者是**两个字段**，谁也不许冒充谁——
 *    用前者报「环境就绪」是最坏的一种假绿：后面每一条发现都会因此归属错误。
 * 2. **不可用要分得开原因**（验收标准 3）：缺模块 / 缺浏览器 / 启动被拒是三件事，
 *    退出码与 `reason` 都要能区分，下一步动作才给得出来。
 * 3. **不可用路径用注入替身**（验收标准 5）：不依赖本机装了什么，CI 上也能把三条红路径钉住。
 *    可用路径在本机有 Edge 时真跑，没有时诚实 skip 并写明原因——照
 *    `tests/ux/browser-collector.test.mjs` 的口径：「没采到」不是「通过」。
 * 4. **快照可逐项比较**：同一输入两跑字节相同；时间戳默认不出现（一进报告，前后两份就对不上）。
 * 5. **不泄漏绝对路径与凭据**（验收标准 4）：playwright 的报错里常年带 `C:\Users\...`，
 *    启动器的 token 也可能混进来；快照是**入库口径的机器事实**，那些一个字节都不许进。
 *
 * 断言面 = 外部可观察物：`probeEnvironment()` 返回的快照结构 / 退出码 / CLI 的进程退出码与落盘产物。
 * 不测「内部怎么 require」这类实现细节。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  EXIT,
  REASONS,
  defaultLaunchHeadless,
  defaultReadEdge,
  defaultResolvePlaywright,
  probeEnvironment,
  redact,
} from '../../scripts/experience/probe-env.mjs'
import { sanitizeUrl } from '../../scripts/experience/evidence.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO_ROOT, 'scripts', 'experience', 'probe-env.mjs')

/**
 * 覆盖环境变量后交给子进程。**必须先按大小写不敏感删掉同名键**：
 * Windows 的环境变量名不分大小写，而 `{...process.env, 'ProgramFiles(x86)': dir}` 只在
 * 键名逐字相同时才覆盖——父进程里躺着的是 `programfiles(x86)` 之类的变体时，环境块会
 * 同时有两份，子进程读到的是**真目录**，用例就从「钉住了替身」悄悄变成「读了本机」。
 * 实测踩过：假版号目录建好了，快照里仍是本机 156.x。
 */
function childEnv(overrides) {
  const env = { ...process.env }
  for (const key of Object.keys(overrides)) {
    for (const existing of Object.keys(env)) {
      if (existing.toLowerCase() === key.toLowerCase()) delete env[existing]
    }
  }
  return { ...env, ...overrides }
}

/** 解析到句柄、但启动被拒的替身：正是「前者不许冒充后者」的那一组输入。 */
const FAKES = {
  resolvedButLaunchRejected: {
    resolvePlaywright: () => ({ handle: {}, version: '1.58.2', source: 'npm-global' }),
    readEdge: () => ({ found: true, version: '156.0.4314.58', source: 'ProgramFiles(x86)' }),
    launchHeadless: async () => {
      throw new Error('browserType.launch: 无法启动进程（替身：Edge 拒绝启动）')
    },
  },
}

describe('票据 #74 · 默认适配器（真解析 / 真版本 / 真启动）', () => {
  const playwright = defaultResolvePlaywright()
  const edge = defaultReadEdge()
  const hasEdge = playwright.handle !== null && edge.found

  it('解析只认宿主环境提供的全局 playwright：仓库不装它（加了依赖这条就红）', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
    for (const field of ['dependencies', 'devDependencies']) {
      expect(Object.keys(pkg[field] ?? {})).not.toContain('playwright')
    }
    // 探到的来源必须是**标签**，不是本机绝对路径（验收标准 4：不泄漏仓库外路径）。
    expect(playwright.handle === null || typeof playwright.source === 'string').toBe(true)
    if (playwright.handle !== null) {
      expect(playwright.source).not.toMatch(/[A-Za-z]:[\\/]/u)
      // 版本要真读到，不是「反正能用就写个 unknown」。
      expect(playwright.version).toMatch(/^\d+\.\d+\.\d+/u)
    }
  })

  it('Edge 版本从安装目录的版号目录读出来（不启动 Edge 二进制、不碰真实 profile）', () => {
    // 两种机器上都断言到东西：找到 → 版号形状 + 来源是标签；没找到 → found=false 且没有假版号。
    if (edge.found) {
      expect(edge.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/u)
      expect(edge.source).not.toMatch(/[A-Za-z]:[\\/]/u)
    } else {
      expect(edge.version).toBeNull()
      expect(edge.source).toBeNull()
    }
    // 读版号靠的是目录名，不是执行 msedge.exe —— 探测不许启动被测产品之外的东西去「问」版本。
    const source = readFileSync(SCRIPT, 'utf8')
    expect(source).not.toMatch(/spawnSync\([^)]*msedge/u)
  })

  it.skipIf(!hasEdge)(
    '真的启动一次 channel msedge 无头实例：开一个页面再关闭，launched 来自实测而非解析成功',
    async () => {
      const { snapshot, exitCode } = await probeEnvironment({
        resolvePlaywright: defaultResolvePlaywright,
        readEdge: defaultReadEdge,
        launchHeadless: defaultLaunchHeadless,
      })
      expect(snapshot.playwright.resolved).toBe(true)
      expect(snapshot.launch.launched, snapshot.launch.detail ?? '').toBe(true)
      expect(exitCode).toBe(EXIT.ready)
      expect(snapshot.ready).toBe(true)
      expect(snapshot.reason).toBe(REASONS.ready)
      // 真浏览器自己报的版本要与「从安装目录读到的版本」对上：
      // 两个独立来源一致，才证明版本字段不是编出来的（不一致 = Edge 装了两份或读错了目录）。
      expect(snapshot.launch.browserVersion).toBe(snapshot.edge.version)
    },
    120_000,
  )

  it('默认适配器的结论与本机状态自洽：ready 只能由三判断项同时成立推出', async () => {
    // 这条在两种机器上都有意义：齐了 → 断言「不该报缺件」；没齐 → 断言「必须报缺件」。
    const { snapshot, exitCode } = await probeEnvironment({
      resolvePlaywright: defaultResolvePlaywright,
      readEdge: defaultReadEdge,
      // 故意「试了就失败」：真启动由上面那条负责，这条只钉解析层与缺件层的诚实性。
      launchHeadless: async () => {
        throw new Error('本用例不启动浏览器')
      },
    })
    // 核心不变式：ready 只能由三个判断项**同时**成立推出（谁也不许冒充谁）。
    expect(snapshot.ready).toBe(snapshot.playwright.resolved && snapshot.edge.found && snapshot.launch.launched)
    expect(snapshot.launch.launched).toBe(false)
    if (!snapshot.playwright.resolved) {
      expect(snapshot.reason).toBe(REASONS.noPlaywright)
      expect(exitCode).toBe(EXIT.missing)
    } else if (!snapshot.edge.found) {
      expect(snapshot.reason).toBe(REASONS.noEdge)
      expect(exitCode).toBe(EXIT.missing)
    } else {
      // 两样都在，只是这条试了没起 → 那是「启动被拒」，与「缺件」不同的退出码。
      expect(snapshot.reason).toBe(REASONS.launchRejected)
      expect(exitCode).toBe(EXIT.launchRejected)
    }
  })

  it('没给启动器 → reason=not-attempted（4），与「试了但被拒」（3）分得开', async () => {
    const { snapshot, exitCode } = await probeEnvironment({
      resolvePlaywright: () => ({ handle: {}, version: '1.58.2', source: 'npm-global' }),
      readEdge: () => ({ found: true, version: '156.0.4314.58', source: 'ProgramFiles(x86)' }),
    })
    expect(exitCode).toBe(EXIT.notAttempted)
    expect(snapshot.reason).toBe(REASONS.notAttempted)
    expect(snapshot.launch.launched).toBe(false)
    // 「没验」不许带失败细节：一旦有 detail，读的人就以为起过一次并且失败了。
    expect(snapshot.launch.detail).toBeNull()
    expect(snapshot.launch.next).toContain('没试')
  })
  it('启动超时算「启动被拒」而不是缺件（替身：永远不 resolve 的 launch，短时限）', async () => {
    const hanging = {
      chromium: {
        launch: async () => {
          // 故意「起得来但永远开不出页面」：真实机器上这就是 Edge 卡住的样子。
          await new Promise(() => {})
        },
      },
    }
    const error = await defaultLaunchHeadless(hanging, { timeoutMs: 200 }).then(
      () => null,
      (caught) => caught,
    )
    expect(error).toBeInstanceOf(Error)
    // 消息要说得出「是超时」并带预算：否则它与「Edge 拒绝启动」在快照里长得一模一样，
    // 而两者的下一步完全不同（等久了 vs 去修 Edge）。
    expect(error.message).toContain('启动无头实例超时')
    expect(error.message).toContain('200ms')
  })

  it('真启动用的 handle 只被要求三件事：launch(msedge/headless) → newPage → close（替身按合同验）', async () => {
    const calls = []
    const fakeHandle = {
      chromium: {
        launch: async (options) => {
          calls.push(['launch', JSON.stringify(options)])
          return {
            version: () => '999.0.0.1',
            newPage: async () => {
              calls.push(['newPage'])
              return { close: async () => calls.push(['page.close']) }
            },
            close: async () => calls.push(['browser.close']),
          }
        },
      },
    }
    expect(await defaultLaunchHeadless(fakeHandle)).toBe('999.0.0.1')
    // 无头 + 系统 Edge channel：这两条一丢，探测就变成「下载 Chromium」或「开有头窗口」。
    expect(calls[0]).toEqual(['launch', '{"channel":"msedge","headless":true}'])
    expect(calls.map(([name]) => name)).toEqual(['launch', 'newPage', 'page.close', 'browser.close'])
  })
  it('多个版号目录时取**数值最大**的那个，不是字典序最后（9.x 不许压过 150.x）', () => {
    // Edge 升级时 `Application/` 旁边会同时躺着新旧两个版号目录。字典序里 "9" > "1"，
    // 所以朴素的 sort().at(-1) 会把老版号报成本机版本——版本号一错，整轮评估的可比性就没了。
    // 期望值故意用 `150.0.0.1`（本机真版号是 156.x）：环境变量没生效、读到真目录时这条照样红，
    // 而不是拿本机版号把用例蒙过去（真机器只有一个版号目录，字典序在那儿根本分不出对错）。
    const dir = mkdtempSync(join(tmpdir(), 'probe-edge-'))
    try {
      mkdirSync(join(dir, 'Microsoft', 'Edge', 'Application', '150.0.0.1'), { recursive: true })
      mkdirSync(join(dir, 'Microsoft', 'Edge', 'Application', '9.0.0.1'), { recursive: true })
      writeFileSync(join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '', 'utf8')
      const result = spawnSync(process.execPath, [SCRIPT, '--json', '--no-launch'], {
        encoding: 'utf8',
        cwd: REPO_ROOT,
        env: childEnv({ 'ProgramFiles(x86)': dir, PROGRAMFILES: dir, LOCALAPPDATA: dir }),
      })
      expect(result.status, result.stderr).toBe(EXIT.notAttempted)
      const snapshot = JSON.parse(result.stdout)
      expect(snapshot.edge.source).toBe('ProgramFiles(x86)')
      expect(snapshot.edge.version).toBe('150.0.0.1')
      // 反证：读到的是假目录而不是本机真版号（否则这条用例什么都没钉住）。
      expect(snapshot.edge.version).not.toBe(defaultReadEdge().version)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('票据 #74 · CLI：一条命令给出可机读快照与分得开的退出码', () => {
  /** 跑真进程。`env` 用来造出「机器上没装 playwright」这一支——不靠替身也能钉住 CLI 的不可用路径。 */
  function runCli(args, { env = {}, cwd = REPO_ROOT } = {}) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd, env: childEnv(env) })
  }

  /**
   * 造一台「没装 playwright」的机器：把两个全局候选目录指到空临时目录。
   * 裸 `playwright` 那一路仍按 node_modules 链找（本仓不装它，前面那条用例正钉着这件事），
   * 所以三条候选全落空 —— CLI 的不可用路径因此**不靠替身**也能钉住。
   */
  function withoutPlaywrightEnv() {
    const empty = mkdtempSync(join(tmpdir(), 'probe-empty-'))
    return { env: { APPDATA: empty, LOCALAPPDATA: empty }, empty }
  }

  /** 非就绪但有意义的退出码：缺件(2) / 启动被拒(3) / 本轮没验启动(4)。 */
  const NOT_READY = [EXIT.missing, EXIT.launchRejected, EXIT.notAttempted]

  it('--help 写死退出码口径（0/2/3/4/5 各有含义），并明确不下载 Chromium', () => {
    const result = runCli(['--help'])
    expect(result.status, result.stderr).toBe(0)
    for (const code of ['0 =', '2 =', '3 =', '4 =', '5 =']) expect(result.stdout).toContain(code)
    expect(result.stdout).toContain('不下载 Chromium')
    expect(result.stdout).toContain('--json')
    expect(result.stdout).toContain('--out')
    // 「没验」与「验了但红」必须在口径里就是两句话——这是本命令最容易说谎的地方。
    expect(result.stdout).toContain('与「环境不可用」是两件事')
  })

  it('未知参数 → 退出码 5（探测自身没跑成 ≠ 环境不可用），且不落任何文件', () => {
    const result = runCli(['--nope'])
    expect(result.status).toBe(EXIT.probeFailed)
    expect(`${result.stdout}\n${result.stderr}`).toContain('未知参数')
    expect(result.stdout).not.toMatch(/^\s*\{/u) // 没跑出快照，就别硬挤一份出来
  })

  it('这台机器没装 playwright 时（改环境目录，不用替身）→ 退出码 2 + reason=no-playwright', () => {
    const { env, empty } = withoutPlaywrightEnv()
    try {
      const result = runCli(['--json'], { env })
      expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(EXIT.missing)
      const snapshot = JSON.parse(result.stdout)
      expect(snapshot.playwright.resolved).toBe(false)
      expect(snapshot.launch.launched).toBe(false)
      expect(snapshot.reason).toBe(REASONS.noPlaywright)
      expect(snapshot.ready).toBe(false)
      // 不可用必须当场给出下一步，而不是只说「不行」。
      expect(snapshot.playwright.next).toContain('不下载 Chromium')
      expect(snapshot.exitCode).toBe(EXIT.missing)
      // 而且这一步**没去启动浏览器**：缺模块时启动成功与否都无从谈起。
      expect(snapshot.launch.detail).toBeNull()
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('--no-launch 只解析不启动：报「本轮没验」（4），不许冒充「启动被拒」（3）', () => {
    const result = runCli(['--json', '--no-launch'])
    const snapshot = JSON.parse(result.stdout)
    expect(snapshot.launch.launched).toBe(false)
    expect(snapshot.ready).toBe(false) // 解析成功也不许报就绪
    expect(snapshot.launch.detail).toBeNull() // 没试就没有「失败细节」，那字段一填就是谎
    // 本机齐不齐决定它是 4 还是 2：缺件仍然优先（缺件时连解析都没过）。
    expect([EXIT.missing, EXIT.notAttempted]).toContain(result.status)
    if (result.status === EXIT.notAttempted) {
      expect(snapshot.reason).toBe(REASONS.notAttempted)
      expect(snapshot.launch.next).toContain('不得据此认为')
      // 人读口径同样不许把「没验」说成「不可用」——那是同一个谎的另一面。
      // 只看结论那一行：`next` 里那句「不得据此认为 Edge 可用或不可用」本来就该出现。
      const conclusion = runCli(['--no-launch']).stdout.split('\n')[0]
      expect(conclusion).toContain('未验证启动')
      expect(conclusion).not.toContain('不可用')
    }
  })

  it('--json 从仓库根一条命令可跑，且换工作目录也不影响（不依赖「我在哪个目录」）', () => {
    // 这批结构用例统一带 --no-launch：真启动那一次由上面那条端到端负责，
    // 这里每条都去 spawn 一次 Edge 只会把用例跑到分钟级（实测 8 条 ≈ 60s）。
    const atRoot = runCli(['--json', '--no-launch'])
    expect(NOT_READY).toContain(atRoot.status)
    const snapshot = JSON.parse(atRoot.stdout)
    // 必备字段一个都不能少：缺一个就没法机读。
    expect(Object.keys(snapshot).sort()).toEqual(
      ['edge', 'exitCode', 'launch', 'playwright', 'reason', 'ready', 'schema'].sort(),
    )
    const elsewhere = runCli(['--json', '--no-launch'], { cwd: tmpdir() })
    expect(JSON.parse(elsewhere.stdout)).toEqual(snapshot)
  })

  it('--out 落盘快照：文件内容与 stdout 一致，两跑字节相同（可逐项比较）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-out-'))
    try {
      const first = join(dir, 'environment-first.json')
      const second = join(dir, 'environment-second.json')
      expect(NOT_READY).toContain(runCli(['--no-launch', '--out', first]).status)
      expect(NOT_READY).toContain(runCli(['--no-launch', '--out', second]).status)
      const a = readFileSync(first, 'utf8')
      const b = readFileSync(second, 'utf8')
      expect(a).toBe(b)
      expect(JSON.parse(a)).toEqual(JSON.parse(runCli(['--json', '--no-launch']).stdout))
      // 落盘件里不许有仓库外的绝对路径（快照要进证据包，包要能分享）。
      expect(a).not.toMatch(/[A-Za-z]:[\\/]{1,2}(?:Users|Program Files)/u)
      // 默认无时钟。
      expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/u)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('--with-timestamp 才加时钟字段，其余结构一字不变', () => {
    const plain = JSON.parse(runCli(['--json', '--no-launch']).stdout)
    const timed = JSON.parse(runCli(['--json', '--no-launch', '--with-timestamp']).stdout)
    expect(plain.generatedAt).toBeUndefined()
    expect(typeof timed.generatedAt).toBe('string')
    const { generatedAt, ...rest } = timed
    expect(rest).toEqual(plain)
  })

  it('--out 落到仓库外也不报错，但打印只给文件名（stdout 不泄漏本机绝对路径）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-print-'))
    try {
      const result = runCli(['--no-launch', '--out', join(dir, 'environment.json')])
      expect(NOT_READY).toContain(result.status)
      expect(result.stdout).not.toContain(dir)
      expect(result.stdout).toContain('environment.json')
      expect(readFileSync(join(dir, 'environment.json'), 'utf8')).toContain('"schema": 1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('不带 --no-launch 的一条命令真跑完：ready 与退出码一致，输出只有一行结论', () => {
    const result = runCli([])
    expect([EXIT.ready, EXIT.missing, EXIT.launchRejected]).toContain(result.status)
    expect(result.stdout).toContain('[probe-env]')
    // 人读口径不许泄漏本机绝对路径。
    expect(result.stdout).not.toMatch(/[A-Za-z]:[\\/]{1,2}(?:Users|Program Files)/u)
    if (result.status === EXIT.ready) expect(result.stdout).toContain('就绪')
    else expect(result.stdout).toContain('不可用')
  })
})

describe('票据 #74 · 三类不可用原因分得开（全部用注入替身，不依赖本机安装）', () => {
  it('没探到 playwright 模块 → reason=no-playwright，退出码 2，且不去启动浏览器', async () => {
    let launched = false
    const { snapshot, exitCode } = await probeEnvironment({
      resolvePlaywright: () => ({ handle: null, version: null, source: null }),
      readEdge: () => ({ found: true, version: '156.0.4314.58', source: 'ProgramFiles(x86)' }),
      launchHeadless: async () => {
        launched = true
        return '156.0.4314.58'
      },
    })
    expect(snapshot.playwright.resolved).toBe(false)
    expect(snapshot.launch.launched).toBe(false)
    expect(snapshot.reason).toBe(REASONS.noPlaywright)
    expect(exitCode).toBe(EXIT.missing)
    // 缺模块时压根不该走到启动那步（否则错误原因会被启动失败盖掉）。
    expect(launched).toBe(false)
    // 下一步要能直接照着做，且明确不下载 Chromium。
    expect(snapshot.playwright.next).toContain('不下载 Chromium')
  })

  it('探到模块但没有系统 Edge → reason=no-edge，退出码 2，与「缺模块」分得开', async () => {
    let launched = false
    const { snapshot, exitCode } = await probeEnvironment({
      resolvePlaywright: () => ({ handle: {}, version: '1.58.2', source: 'npm-global' }),
      readEdge: () => ({ found: false, version: null, source: null }),
      launchHeadless: async () => {
        launched = true
        return null
      },
    })
    expect(snapshot.playwright.resolved).toBe(true)
    expect(snapshot.edge.found).toBe(false)
    expect(snapshot.reason).toBe(REASONS.noEdge)
    expect(exitCode).toBe(EXIT.missing)
    expect(launched).toBe(false)
    expect(snapshot.edge.next).toContain('Edge')
    // 两类缺件是两种处置，快照必须把差异写明白，不能都糊成「环境不可用」。
    expect(snapshot.edge.next).not.toBe(snapshot.playwright.next)
  })

  it('缺模块与缺浏览器共用退出码 2，但 reason 不同（原因靠字段区分，不靠码细分）', async () => {
    const noModule = await probeEnvironment({
      resolvePlaywright: () => ({ handle: null }),
      readEdge: () => ({ found: true, version: '156.0.4314.58' }),
      launchHeadless: async () => null,
    })
    const noBrowser = await probeEnvironment({
      resolvePlaywright: () => ({ handle: {} }),
      readEdge: () => ({ found: false }),
      launchHeadless: async () => null,
    })
    expect(noModule.exitCode).toBe(EXIT.missing)
    expect(noBrowser.exitCode).toBe(EXIT.missing)
    expect(noModule.snapshot.reason).toBe(REASONS.noPlaywright)
    expect(noBrowser.snapshot.reason).toBe(REASONS.noEdge)
  })
})

describe('票据 #74 · 快照可逐项比较，且不泄漏仓库外路径与凭据', () => {
  /** 一份「全都好」的替身：确定性与时钟这两条要靠它钉。 */
  const allGood = {
    resolvePlaywright: () => ({ handle: {}, version: '1.58.2', source: 'npm-global' }),
    readEdge: () => ({ found: true, version: '156.0.4314.58', source: 'ProgramFiles(x86)' }),
    launchHeadless: async () => '156.0.4314.58',
  }

  it('同一输入两跑 → 序列化后字节相同（前后两份报告能逐项比）', async () => {
    const first = await probeEnvironment(allGood)
    const second = await probeEnvironment(allGood)
    expect(JSON.stringify(first.snapshot)).toBe(JSON.stringify(second.snapshot))
    expect(first.exitCode).toBe(second.exitCode)
    expect(first.snapshot.ready).toBe(true)
    expect(first.snapshot.exitCode).toBe(EXIT.ready)
  })

  it('时间戳默认不出现，且能显式打开（可关掉是硬要求，不是靠人记得删）', async () => {
    const quiet = await probeEnvironment(allGood)
    expect(JSON.stringify(quiet.snapshot)).not.toMatch(/\d{4}-\d{2}-\d{2}T/u)
    expect(quiet.snapshot.generatedAt).toBeUndefined()
    const noisy = await probeEnvironment({ ...allGood, now: () => '2026-11-02T00:00:00.000Z' })
    expect(noisy.snapshot.generatedAt).toBe('2026-11-02T00:00:00.000Z')
    // 打开时钟只多这一个字段，其余结构一字不变：两跑仍能逐项比。
    const { generatedAt, ...rest } = noisy.snapshot
    expect(JSON.stringify(rest)).toBe(JSON.stringify(quiet.snapshot))
  })

  it('启动报错里的绝对路径与 token 不进快照（只留原因类别 + 脱敏后的单行细节）', async () => {
    const { snapshot } = await probeEnvironment({
      ...allGood,
      launchHeadless: async () => {
        throw new Error(
          'browserType.launch: Failed to launch msedge because it is not installed correctly. ' +
            'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chrome.exe ' +
            'http://127.0.0.1:19488/?token=SECRET_VALUE_GOES_HERE',
        )
      },
    })
    const text = JSON.stringify(snapshot)
    const detail = snapshot.launch.detail
    expect(snapshot.launch.launched).toBe(false)
    expect(snapshot.launch.reason).toBe(REASONS.launchRejected)
    // 凭据与仓库外绝对路径一个字节都不许留（对**原始值**断言，不经 JSON 转义混淆）。
    for (const haystack of [text, detail]) {
      expect(haystack).not.toContain('SECRET_VALUE_GOES_HERE')
      expect(haystack).not.toMatch(/[A-Za-z]:[\\/]{1,2}(?:Users|Program Files|ms-playwright)/u)
    }
    // 只替换敏感片段、不做整体截断：参数名留着是证据，值必须变成占位符。
    expect(detail).toContain('?token=<redacted>')
    // 但仍要说得清「为什么被拒」——脱敏不能把信息全脱没。
    expect(detail).toContain('Failed to launch')
    expect(detail).toContain('not installed correctly')
  })

  it('凭据参数表只有一份真源：redact 与 sanitizeUrl 对同一批 URL 给出同一个结果（改任一侧即红）', () => {
    // 两处各写一份词表时实测已经分化：`#token=` 在 `redact` 里原样留下，在 `sanitizeUrl` 里被脱。
    // 这条跨文件对拍钉住「同一份参数表、同一个函数」：改任一侧的名单或起始符，这里立刻红。
    const urls = [
      'http://127.0.0.1:19488/?token=ABC123',
      'http://127.0.0.1:19488/?a=1&token=ABC123',
      'http://127.0.0.1:19488/#token=ABC123',
      'http://127.0.0.1:19488/#/consult?token=ABC123',
      'http://127.0.0.1:19488/?TOKEN=ABC123',
      'http://127.0.0.1:19488/?Access_Token=ABC123',
      'http://127.0.0.1:19488/?a=1&code=ABC123&password=P4ss',
    ]
    for (const url of urls) {
      const expected = sanitizeUrl(url)
      expect(redact(url), url).toBe(expected)
      expect(expected, url).toContain('<redacted>')
      expect(expected, url).not.toContain('ABC123')
    }
    // 对拍只能证明「两边一致」，证明不了「两边都漏了同一处」——起始位置逐条再钉一遍。
    expect(redact('http://h/?token=ABC123')).toBe('http://h/?token=<redacted>')
    expect(redact('http://h/?a=1&token=ABC123')).toBe('http://h/?a=1&token=<redacted>')
    expect(redact('http://h/#token=ABC123')).toBe('http://h/#token=<redacted>')
    expect(redact('http://h/#/consult?token=ABC123')).toBe('http://h/#/consult?token=<redacted>')
    // 参数名大小写不敏感，但输出保留原大小写：值必须脱掉。
    expect(redact('http://h/?TOKEN=ABC123')).toBe('http://h/?TOKEN=<redacted>')
    expect(redact('http://h/?Access_Token=ABC123')).toBe('http://h/?Access_Token=<redacted>')
  })
})

describe('票据 #74 · 「解析到句柄」与「真的启动成功」是两个独立判断项', () => {
  it('解析成功但启动被拒 → resolved=true 且 launched=false，两个字段各自为真', async () => {
    const { snapshot, exitCode } = await probeEnvironment(FAKES.resolvedButLaunchRejected)
    expect(snapshot.playwright.resolved).toBe(true)
    expect(snapshot.launch.launched).toBe(false)
    // 反证式断言：不许用「解析成功」把整体报成就绪。
    expect(snapshot.ready).toBe(false)
    expect(exitCode).toBe(EXIT.launchRejected)
    expect(snapshot.reason).toBe(REASONS.launchRejected)
  })

  it('启动失败要带原因类别与可读细节，且写明下一步不许是「下载 Chromium」', async () => {
    const { snapshot } = await probeEnvironment(FAKES.resolvedButLaunchRejected)
    expect(snapshot.launch.reason).toBe(REASONS.launchRejected)
    expect(snapshot.launch.detail).toContain('无法启动进程')
    // 计划 §9.2 第 2 条：Edge channel 起不来时记录准确报错再修浏览器环境，不默认下载 Chromium。
    expect(snapshot.launch.next).toContain('不下载 Chromium')
  })
})
