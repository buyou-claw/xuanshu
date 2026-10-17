/**
 * tests/isolation/home.test.mjs — 票 22（GitHub #22 / Spec 002 票 01）：**玄枢自己的 home**。
 *
 * 断言面（全部**不需要 profile**，所以任何机器上都真跑，不会因为「干净 CI 没装 profile」被 skip 掉）：
 *   ① 产品默认 = `<homedir>/.xuanshu`，开发默认 = `<repo>/.dsh-home`（ADR-0014）；
 *   ② **玄枢 home 永不等于/落在用户真实 `~/.dsh` 里** —— 这是本票的验收刀口，
 *      同时也是 `pnpm verify:isolation` 里 `home-isolated` 那条 check 的同一份判据；
 *   ③ 覆盖链：`--home` ＞ `XUANSHU_DSH_HOME` ＞ 环境里的 `$DSH_HOME`（仅当不指向真实 home，R16）＞ 默认；
 *   ④ 用法失败：解析结果指向真实 `~/.dsh` 时**报用法错**（exit 1），不是静默通过；
 *   ⑤ 验收台的 `home-isolated` evidence 必须带上「默认 home 也不是真实 home」这条事实。
 *
 * 反向对照（「会红的对照」）在 ③ 那个 describe 里：判据本身逐条钉着「真实 home / 它的子路径 → true」，
 * 并且默认值是从代码里**现算**的 —— 谁把默认值改回 `~/.dsh`，那些断言立刻红。
 *
 * 环境纪律：本文件一律显式传 `env: {}`（或只传构造出来的 env），**不读 `process.env`**：
 * 开发机的环境里天然带着 `DSH_HOME=~/.dsh`（本仓就是在 DSH 里被开发的），继承它测到的就不是默认值。
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import { DEV_HOME_DIR_NAME, PRODUCT_HOME_DIR_NAME } from '../../scripts/isolation/defaults.mjs'
import {
  HOME_SOURCES, defaultHome, pointsAtRealDshHome, realDshHome, resolveHomeMode, resolveHomeWithSource, samePath,
} from '../../scripts/isolation/resolve.mjs'
import { runStartup } from '../../scripts/isolation/startup.mjs'
import { apply as applyHost } from '../../packages/xuanshu-host/lib/index.js'
import { childEnv } from '../setup/lib/env.mjs'
import { REPO_ROOT, runVerifier } from './lib/verifier.mjs'

const REAL = realDshHome()
const PRODUCT = join(homedir(), PRODUCT_HOME_DIR_NAME)
const DEV = join(REPO_ROOT, DEV_HOME_DIR_NAME)
const INSTALL_PROFILE = join(REPO_ROOT, 'scripts', 'install-profile.mjs')

/** 一个临时「用户家目录」：`USERPROFILE`/`HOME` 一起改，实现有 bug 也污染不到真的家目录。 */
function makeFakeHome(tag) {
  const dir = join(REPO_ROOT, 'tests', 'isolation', '.tmp', `${tag}-${process.pid}-${Date.now().toString(36)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 仓库**外**的临时目录：用来问「这条命令在产品机上（不在仓库里）会装到哪」。 */
function makeOutsideDir(tag) {
  return mkdtempSync(join(tmpdir(), `xuanshu-${tag}-`))
}

/** 先摘联接、再删目录（`rmSync` 确认过不跟随 junction，但少一次「跟随」的机会总是好的）。 */
function removeFakeHome(dir, profile = 'xuanshu') {
  try {
    rmSync(join(dir, PRODUCT_HOME_DIR_NAME, 'profiles', profile), { force: true })
  } catch {
    /* 联接可能不在 */
  }
  try {
    rmSync(join(dir, 'custom-home', 'profiles', profile), { force: true })
  } catch {
    /* 联接可能不在 */
  }
  rmSync(dir, { recursive: true, force: true })
}

function runInstallProfile(args, env, cwd = REPO_ROOT) {
  const run = spawnSync(process.execPath, [INSTALL_PROFILE, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    env,
  })
  return {
    status: run.status,
    stdout: run.stdout ?? '',
    stderr: run.stderr ?? '',
    raw: () => `exit=${run.status}\n--- stdout ---\n${(run.stdout ?? '').slice(0, 2000)}\n--- stderr ---\n${(run.stderr ?? '').slice(0, 2000)}`,
  }
}


describe('票 22 · 玄枢 home 解析：产品 / 开发两档默认，且永不指向 ~/.dsh', () => {
  it('产品默认 = <homedir>/.xuanshu，开发默认 = <repo>/.dsh-home（来源要能说清是哪一档）', () => {
    const product = resolveHomeWithSource({ env: {}, mode: 'product', repoRoot: REPO_ROOT })
    expect(product.home).toBe(PRODUCT)
    expect(product.source).toBe(HOME_SOURCES.defaultProduct)
    expect(product.mode).toBe('product')
    expect(pointsAtRealDshHome(product.home)).toBe(false)

    const dev = resolveHomeWithSource({ env: {}, mode: 'dev', repoRoot: REPO_ROOT })
    expect(dev.home).toBe(DEV)
    expect(dev.source).toBe(HOME_SOURCES.defaultDev)
    expect(dev.mode).toBe('dev')
    expect(pointsAtRealDshHome(dev.home)).toBe(false)
  })

  it('默认值不是恒真：判据对 ~/.dsh 及其子路径必须为假，对两档默认必须为真', () => {
    // 判据这一侧（刀口的「会红」一半）：真实 home 与它的子路径都必须被认出来。
    expect(pointsAtRealDshHome(REAL)).toBe(true)
    expect(pointsAtRealDshHome(join(REAL, 'xuanshu'))).toBe(true)
    expect(pointsAtRealDshHome(join(REAL, 'profiles', 'xuanshu'))).toBe(true)
    // 空值不算安全（没有 home 时不能「因为不是 ~/.dsh 所以通过」）。
    expect(pointsAtRealDshHome('')).toBe(false)
    expect(pointsAtRealDshHome(undefined)).toBe(false)
    // 判据另一侧（刀口的「默认值」一半）：两档默认都从代码里现算 —— 改回 ~/.dsh 这条就红。
    expect(pointsAtRealDshHome(defaultHome({ mode: 'product' }).home)).toBe(false)
    expect(pointsAtRealDshHome(defaultHome({ mode: 'dev', repoRoot: REPO_ROOT }).home)).toBe(false)
  })

  it('不传 mode：仓库检出里判 dev（开发期语义不变），找不到仓库判 product（产品机）', () => {
    // 给了 repoRoot = 调用方已经证明「这是仓库检出」。
    expect(resolveHomeMode({ repoRoot: REPO_ROOT }).mode).toBe('dev')
    // 找不到仓库根（产品机）→ product，而不是抛，也不是落回 ~/.dsh。
    const noRepo = () => {
      throw new Error('cannot find the XuanShu repo root above C:\\Program Files\\XuanShu')
    }
    const detected = resolveHomeMode({ locateRepoRoot: noRepo })
    expect(detected.mode).toBe('product')
    expect(detected.source).toContain('no repo')
    // 显式 mode 优先于探测；非法 mode 是用法错（不许静默落回某个默认）。
    expect(resolveHomeMode({ mode: 'product', repoRoot: REPO_ROOT }).mode).toBe('product')
    expect(resolveHomeMode({ mode: 'dev' }).mode).toBe('dev')
    expect(() => resolveHomeMode({ mode: 'staging' })).toThrow(/home mode/)
  })

  it('覆盖链：--home ＞ XUANSHU_DSH_HOME ＞ $DSH_HOME ＞ 默认；产品默认同样可被覆盖', () => {
    const explicitHome = join(REPO_ROOT, 'tests', 'isolation', '.tmp', 'explicit-home')
    const envHome = join(REPO_ROOT, 'tests', 'isolation', '.tmp', 'env-home')
    const dshEnvHome = join(REPO_ROOT, 'tests', 'isolation', '.tmp', 'dshenv-home')

    const explicit = resolveHomeWithSource({
      home: explicitHome,
      env: { XUANSHU_DSH_HOME: envHome, DSH_HOME: dshEnvHome },
      mode: 'product',
      repoRoot: REPO_ROOT,
    })
    expect(samePath(explicit.home, explicitHome)).toBe(true)
    expect(explicit.source).toBe(HOME_SOURCES.explicit)

    const fromEnv = resolveHomeWithSource({ env: { XUANSHU_DSH_HOME: envHome, DSH_HOME: dshEnvHome }, mode: 'product', repoRoot: REPO_ROOT })
    expect(samePath(fromEnv.home, envHome)).toBe(true)
    expect(fromEnv.source).toBe(HOME_SOURCES.env)

    // 环境里的 $DSH_HOME：不指向真实 home 时被采纳（这是 DSH 自己的变量，壳会用它起子进程）。
    const fromDshEnv = resolveHomeWithSource({ env: { DSH_HOME: dshEnvHome }, mode: 'product', repoRoot: REPO_ROOT })
    expect(samePath(fromDshEnv.home, dshEnvHome)).toBe(true)
    expect(fromDshEnv.source).toBe(HOME_SOURCES.dshEnv)

    // 换一套 home = 换一套数据：派生路径必须跟着变（这里只看 home 本身，派生路径的用例在验收台）。
    expect(samePath(fromEnv.home, fromDshEnv.home)).toBe(false)
  })

  it('环境里带着 DSH_HOME=~/.dsh 时忽略并记账（R16）；默认 home 仍是玄枢自己的', () => {
    const result = resolveHomeWithSource({ env: { DSH_HOME: REAL }, mode: 'product', repoRoot: REPO_ROOT })
    expect(result.ignored).toHaveLength(1)
    expect(result.ignored[0]).toMatch(/指向用户真实 DSH home，已忽略/)
    expect(result.source).toBe(HOME_SOURCES.defaultProduct)
    expect(result.home).toBe(PRODUCT)
    expect(pointsAtRealDshHome(result.home)).toBe(false)
  })
})

describe('票 22 · 用法失败：解析到真实 ~/.dsh 时必须报错，不许静默通过', () => {
  it('XUANSHU_DSH_HOME=~/.dsh → 启动器以用法错（exit 1）拒绝，home 门 FAIL', async () => {
    const report = await runStartup({ mode: 'doctor', env: { XUANSHU_DSH_HOME: REAL }, repoRoot: REPO_ROOT })
    expect(report.exitCode).toBe(1)
    expect(report.checks.home.ok).toBe(false)
    expect(report.checks.home.detail).toContain('拒绝')
    // 被拒的时候 root 不该被「当成实例算一遍」：没有 instance 才不会有后续写盘。
    expect(report.instance).toBeUndefined()
  })

  it('默认解析出的 home 也过同一道判据（不是只有 --home 那条路才拒）', () => {
    // 与验收台/启动器同源：两档默认都必须过 pointsAtRealDshHome。
    for (const mode of ['dev', 'product']) {
      const { home, source } = resolveHomeWithSource({ env: {}, mode, repoRoot: REPO_ROOT })
      expect(pointsAtRealDshHome(home), `${source} 解析到了真实 home：${home}`).toBe(false)
    }
  })
})

describe('票 22 · 验收台 home-isolated 带上「玄枢 home 永不等于 ~/.dsh」', () => {  it('evidence 里有 homeSource / defaultHome / defaultHomeIsNotReal，且默认 home 真不是真实 home', () => {
    const tmp = join(REPO_ROOT, 'tests', 'isolation', '.tmp', `home-assert-${process.pid}-${Date.now().toString(36)}`)
    mkdirSync(tmp, { recursive: true })
    try {
      const result = runVerifier(['--json', '--only', 'home-isolated', '--home', tmp])
      expect(result.json, `验收台没有输出 JSON：\n${result.raw()}`).toBeDefined()
      const entry = result.json.checks['home-isolated']
      expect(entry, result.raw()).toBeDefined()
      expect(entry.ok, `home-isolated 没通过：${entry.detail}`).toBe(true)
      const evidence = entry.evidence
      // 来源可追溯：这次是显式 --home。
      expect(evidence.homeSource).toBe(HOME_SOURCES.explicit)
      // 「默认 home 也不是真实 home」这条事实必须出现在机器可读的 evidence 里。
      expect(evidence.defaultHome, 'evidence 没给默认 home').toBeTruthy()
      expect(evidence.defaultHomeIsNotReal, `默认 home ${evidence.defaultHome} 被判成真实 home`).toBe(true)
      // 两档默认都要在这条断言里：验收台跑在仓库里，只看当前生效的 dev 档会永远看不到产品档的回归。
      expect(evidence.defaultHomes, 'evidence 没给两档默认 home').toBeTruthy()
      expect(pointsAtRealDshHome(evidence.defaultHomes.product), `产品档默认 ${evidence.defaultHomes.product} 是真实 home`).toBe(false)
      expect(pointsAtRealDshHome(evidence.defaultHomes.dev), `开发档默认 ${evidence.defaultHomes.dev} 是真实 home`).toBe(false)
      expect(samePath(evidence.defaultHomes.product, PRODUCT)).toBe(true)
      expect(evidence.realHome).toBe(REAL)
      expect(pointsAtRealDshHome(evidence.defaultHome)).toBe(false)
      // 全部 check 只有 home-isolated：它绿 ⇒ 验收台绿（exit 0），证明这条断言是可跑的判据。
      expect(result.json.ok, result.raw()).toBe(true)
      expect(result.status, result.raw()).toBe(0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }, 180_000)
})

describe('票 22 · install-profile 的默认 home（≠ 真实 ~/.dsh，且认 XUANSHU_DSH_HOME）', () => {
  it('在产品机的语境里（cwd 不在仓库里）不给 --home：装到 `~/.xuanshu`，`~/.dsh` 一个字节都不写', () => {
    const fakeHome = makeOutsideDir('install-home')
    try {
      // 干净环境：MANAGED_ENV 里的变量（DSH_HOME / XUANSHU_DSH_HOME …）先删再设。
      const env = childEnv({ USERPROFILE: fakeHome, HOME: fakeHome })
      const run = runInstallProfile(['--skip-install'], env, fakeHome)
      expect(run.status, run.raw()).toBe(0)
      expect(existsSync(join(fakeHome, PRODUCT_HOME_DIR_NAME, 'profiles', 'xuanshu', 'package.json')), run.raw()).toBe(true)
      // 这才是本票要消灭的那件事：过去默认是 `process.env.DSH_HOME || ~/.dsh`。
      expect(existsSync(join(fakeHome, '.dsh')), 'install-profile 把真实 ~/.dsh 建出来了').toBe(false)
      expect(run.stdout, '输出里应能看到 home 的来源').toContain(PRODUCT_HOME_DIR_NAME)
    } finally {
      removeFakeHome(fakeHome)
    }
  }, 180_000)

  it('在仓库检出里（cwd = 仓库）不给 --home：仍装到开发档 `<repo>/.dsh-home`（开发期语义不变）', () => {
    // 不真的写仓库里的 `.dsh-home`：只要 home 解析对，装到哪就已经定了 —— 这里用 XUANSHU_DSH_HOME 把
    // 写入点搬到临时目录，同时断言「仓库里跑」这一档仍是 dev（否则下面这条就测的是 product 档）。
    const fakeHome = makeOutsideDir('install-dev')
    const scratch = join(fakeHome, 'dev-scratch')
    try {
      const resolved = resolveHomeWithSource({ env: childEnv({ USERPROFILE: fakeHome, HOME: fakeHome }), repoRoot: REPO_ROOT })
      expect(resolved.mode).toBe('dev')
      expect(resolved.home).toBe(DEV)
      // 真的跑一次：显式把 home 指到临时目录（同一份解析链，只是最后一级换掉），只验证装配能落地。
      const run = runInstallProfile(['--skip-install'], childEnv({
        USERPROFILE: fakeHome, HOME: fakeHome, XUANSHU_DSH_HOME: scratch,
      }), REPO_ROOT)
      expect(run.status, run.raw()).toBe(0)
      expect(existsSync(join(scratch, 'profiles', 'xuanshu', 'package.json'))).toBe(true)
    } finally {
      removeFakeHome(fakeHome)
    }
  }, 180_000)

  it('XUANSHU_DSH_HOME 覆盖默认 home（壳 / 测试靠它换家）', () => {
    const fakeHome = makeOutsideDir('install-env')
    const custom = join(fakeHome, 'custom-home')
    try {
      const run = runInstallProfile(['--skip-install'], childEnv({
        USERPROFILE: fakeHome, HOME: fakeHome, XUANSHU_DSH_HOME: custom,
      }), fakeHome)
      expect(run.status, run.raw()).toBe(0)
      expect(existsSync(join(custom, 'profiles', 'xuanshu', 'package.json')), run.raw()).toBe(true)
      expect(existsSync(join(fakeHome, PRODUCT_HOME_DIR_NAME)), '覆盖没生效：默认 home 也被建了出来').toBe(false)
    } finally {
      removeFakeHome(fakeHome)
    }
  }, 180_000)
})

/* ───────────────────────── 宿主插件（packages/xuanshu-host） ───────────────────────── */

/**
 * 宿主插件读的是**进程环境**（`homedir()` / `process.env.DSH_HOME`），没有注入点。
 * 所以这里临时改 `process.env` 再还原：`USERPROFILE`/`HOME` 是 `homedir()` 的来源，
 * 改它就能把「真实 home」搬进沙箱 —— 实现有 bug 也污染不到真的家目录。
 */
const HOST_MANAGED_ENV = [
  'USERPROFILE', 'HOME', 'DSH_HOME', 'XUANSHU_DSH_HOME', 'XUANSHU_HOROSA_AUTOSTART',
  'XUANSHU_SETUP_REPORT', 'HOROSA_SKILL_DATA_DIR', 'XUANSHU_HOROSA_DATA_DIR', 'XUANSHU_HOROSA_PORT',
]

function withProcessEnv(overrides, body) {
  const saved = new Map(HOST_MANAGED_ENV.map((key) => [key, process.env[key]]))
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    return body()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/** 宿主 ctx 替身：只实现 `apply()` 会碰的那几样能力（与 tests/bazi/wiring 同款）。 */
function makeHostCtx({ services = {}, warns = [] } = {}) {
  return {
    get(name) {
      return services[name]
    },
    logger() {
      return {
        info() {},
        warn(...args) {
          warns.push(args.map((arg) => String(arg)).join(' '))
        },
        error() {},
      }
    },
    effect(callback) {
      try {
        const dispose = callback()
        return () => {
          try {
            dispose?.()
          } catch {
            /* 清理失败不影响断言 */
          }
        }
      } catch {
        return () => {}
      }
    },
    provide() {
      return () => {}
    },
    commands: { register: () => () => {} },
    inject() {
      // 「依赖还没就绪」：不回调（本用例不关心定时任务，也不想引入异步噪声）。
      return () => {}
    },
  }
}

describe('票 22 · 宿主插件：解析到真实 ~/.dsh 就拒绝写，兜底永不指向它', () => {
  it('profileContext.home = 真实 ~/.dsh → 一个字节都不写（报告 / 数据目录 / horosa 状态全部不落）', () => {
    const fakeHome = makeOutsideDir('host-refuse')
    const realHome = join(fakeHome, '.dsh')
    const profileDir = join(realHome, 'profiles', 'xuanshu')
    mkdirSync(profileDir, { recursive: true })
    const warns = []
    try {
      withProcessEnv({ USERPROFILE: fakeHome, HOME: fakeHome, DSH_HOME: undefined, XUANSHU_DSH_HOME: undefined, XUANSHU_HOROSA_AUTOSTART: '0' }, () => {
        expect(realDshHome()).toBe(realHome)
        // 现场快照：被拒 = 一个条目都不许多出来（`profiles/` 是测试自己摆的现场）。
        const before = readdirSync(realHome)
        applyHost(makeHostCtx({
          services: { profileContext: { name: 'xuanshu', dir: profileDir, home: realHome } }, warns,
        }), { autoStart: false })
        // 宿主插件过去会在这里写出 `<realHome>/xuanshu/assembly-report.json`。
        expect(readdirSync(realHome), '宿主往真实 ~/.dsh 里写了东西（应当拒绝并只记一条 warn）').toEqual(before)
        expect(warns.join('\n'), '拒绝了却没有说清原因').toContain('拒绝')
        expect(warns.join('\n')).toContain('.xuanshu')
      })
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })

  it('没有 profileContext / DSH_HOME → 兜底到 ~/.xuanshu，报告也落在那儿，~/.dsh 根本不存在', () => {
    const fakeHome = makeOutsideDir('host-fallback')
    try {
      withProcessEnv({ USERPROFILE: fakeHome, HOME: fakeHome, DSH_HOME: undefined, XUANSHU_DSH_HOME: undefined, XUANSHU_HOROSA_AUTOSTART: '0' }, () => {
        applyHost(makeHostCtx(), { autoStart: false })
        const reportFile = join(fakeHome, PRODUCT_HOME_DIR_NAME, 'xuanshu', 'assembly-report.json')
        expect(existsSync(reportFile), `兜底 home 下没有装配报告：${reportFile}`).toBe(true)
        const report = JSON.parse(readFileSync(reportFile, 'utf8'))
        expect(samePath(report.profile.dshHome, join(fakeHome, PRODUCT_HOME_DIR_NAME))).toBe(true)
        expect(report.notes.join('\n'), '报告没说清 home 是哪来的').toMatch(/home：.*来源/)
        expect(existsSync(join(fakeHome, '.dsh')), '兜底又落回了 ~/.dsh').toBe(false)
      })
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })

  it('进程内装配（显式 dataDir）时：环境里的 DSH_HOME=~/.dsh 不会让它罢工，落点就是那个 dataDir', () => {
    // 这一条钉的是**判据的方向**：拒绝的依据是「写到哪里」，不是「home 变量长什么样」。
    // `tests/*/wiring.test.mjs` 就是这种形态（真 `apply()` + 假 ctx + 显式 dataDir）；
    // 若按 home 变量拒绝，那些用例会在 DSH 会话里（环境天然带 DSH_HOME=~/.dsh）整组红。
    const fakeHome = makeOutsideDir('host-inprocess')
    const dataDir = join(fakeHome, 'explicit-data-dir')
    const warns = []
    try {
      withProcessEnv({
        USERPROFILE: fakeHome, HOME: fakeHome, DSH_HOME: join(fakeHome, '.dsh'),
        XUANSHU_DSH_HOME: undefined, XUANSHU_HOROSA_AUTOSTART: '0',
      }, () => {
        applyHost(makeHostCtx({ warns }), { dataDir, autoStart: false })
        expect(existsSync(join(dataDir, 'assembly-report.json')), `显式 dataDir 下没写出报告（warns: ${warns.join(' / ')}）`).toBe(true)
        expect(existsSync(join(fakeHome, '.dsh')), '往真实 ~/.dsh 写了东西').toBe(false)
        expect(warns.join('\n')).not.toContain('拒绝把玄枢的数据写进')
      })
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })
})
