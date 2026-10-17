/**
 * S1 / S2 / S5（复核 2026-10-17）· 宿主侧 home / 数据目录 / skill 扫描根的**唯一实现**。
 *
 * 复核发现的两处硬违规：
 *   - `shiji/scan.mjs::resolveShijiDshHome()` 是第 5 份 home 解析，且绕过 ADR-0014 的「真实 ~/.dsh」门；
 *   - `bazi/service.mjs::resolveDataDir()` 独立重算 home（没有 realDsh 门），10 个服务组 import 它。
 *
 * 本文件钉住的判据（都指向**同一个实现**与**同一条门**，不指向某段代码的形状）：
 *   ① `lib/home.mjs` 是唯一实现：`bazi/service.mjs` 再导出的那个函数**就是** `home.mjs` 里那一个
 *      （同一函数对象 —— 再抄一份实现必然不是同一个引用）；
 *   ② `resolveDataDir` 用 `resolveHostHome` 的判据：`DSH_HOME=~/.dsh`（或其子目录）**绝不**变成数据目录，
 *      而是退回玄枢自己的 home；
 *   ③ `resolveSearchHome`（skill 扫描根）优先序：显式 → profileContext.home → dataDir 父目录（目录名 xuanshu）
 *      → DSH_HOME → 玄枢兜底；**任何一档解析到真实 ~/.dsh 都改判兜底并带回原因**；
 *   ④ `workflow/service.mjs::resolveDshHome` 与 `shiji/scan.mjs::resolveShijiDshHome` 都是它的**薄包装**
 *      （同一份顺序，行为逐条对拍）；
 *   ⑤ `collectShijiEvidence` 把「真实 home 已改判」写进 notes —— 用户要能看到为什么路径不是他给的那个。
 *   ⑥ **全部服务组**（复核 C2 补）：`cang` 的 dataDir、`horosa` 的 paths 与 service 两处 home
 *      也走这同一份实现与同一道 `pointsAtRealDshHome` 门；horosa 把拒绝原因带进 `note` / 装配 notes。
 *
 * 环境纪律：一律显式传 `env` / `homedirPath`（纯函数），**不读 process.env**、不碰真 home。
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

import { resolveDataDir as baziResolveDataDir } from '../../packages/xuanshu-host/lib/bazi/service.mjs'
import { createCangMethods } from '../../packages/xuanshu-host/lib/cang/service.mjs'
import {
  dataDirFor,
  fallbackXuanshuHome,
  resolveDataDir,
  resolveHostHome,
  resolveSearchHome,
} from '../../packages/xuanshu-host/lib/home.mjs'
import { resolveHorosaPaths } from '../../packages/xuanshu-host/lib/horosa/paths.mjs'
import { createHorosaRuntime, installHorosa } from '../../packages/xuanshu-host/lib/horosa/service.mjs'
import { resolveShijiDshHome } from '../../packages/xuanshu-host/lib/shiji/scan.mjs'
import { collectShijiEvidence } from '../../packages/xuanshu-host/lib/shiji/scan.mjs'
import { resolveDshHome } from '../../packages/xuanshu-host/lib/workflow/service.mjs'

/** 一台**假**机器的家目录（绝对路径，跨盘符都由 join 产出）。 */
const USER_HOME = join(tmpdir(), 'xs-home-fixture', 'user')
/** 这台假机器上用户真实的 DSH 桌面版 home。 */
const REAL_DSH = join(USER_HOME, '.dsh')
/** 玄枢自己的产品 home。 */
const PRODUCT_HOME = join(USER_HOME, '.xuanshu')

/** 裸 ctx（`ctx.get` 拿不到任何服务）。 */
const bareCtx = { get: () => undefined }
/** 有 profileContext 的 ctx。 */
const profileCtx = (home) => ({ get: (name) => (name === 'profileContext' ? { home } : undefined) })

/** `home` 是否等于或在 `parent` 里（跨平台判据，与 `pointsAtRealDshHome` 同口径）。 */
function isUnder(home, parent) {
  const normalized = home.replace(/\\/gu, '/').replace(/\/+$/u, '')
  const base = parent.replace(/\\/gu, '/').replace(/\/+$/u, '')
  return normalized === base || normalized.startsWith(`${base}/`)
}

describe('S1/S2 · 唯一实现：bazi 再导出的 resolveDataDir 就是 home.mjs 那一个', () => {
  it('两个模块导出的是同一个函数对象（再抄一份实现必然不是同一引用）', () => {
    expect(baziResolveDataDir).toBe(resolveDataDir)
  })

  it('数据目录的 join 口径也只有一份（dataDirFor）：显式覆盖优先，否则 <home>/xuanshu', () => {
    expect(dataDirFor(join('D:', 'h'), {})).toBe(join('D:', 'h', 'xuanshu'))
    expect(dataDirFor(join('D:', 'h'), { dataDir: join('D:', 'x') })).toBe(join('D:', 'x'))
  })
})

describe('S2 · resolveDataDir：<home>/xuanshu，且真实 ~/.dsh 绝不变成数据目录', () => {
  const options = { env: {}, homedirPath: USER_HOME }

  it('显式 config.dataDir 优先（测试 / 嵌入方的注入口不被改写）', () => {
    expect(resolveDataDir(bareCtx, { dataDir: join('D:', 'x') }, options)).toBe(join('D:', 'x'))
  })

  it('profileContext.home → <home>/xuanshu', () => {
    expect(resolveDataDir(profileCtx(join('D:', 'p')), {}, { env: {}, homedirPath: USER_HOME }))
      .toBe(join('D:', 'p', 'xuanshu'))
  })

  it('没有 profileContext 时用 DSH_HOME（正常 home）', () => {
    expect(resolveDataDir(bareCtx, {}, { env: { DSH_HOME: join('D:', 'dsh') }, homedirPath: USER_HOME }))
      .toBe(join('D:', 'dsh', 'xuanshu'))
  })

  it('DSH_HOME=<真实 ~/.dsh> 时不静默变成数据目录：退回玄枢自己的 home（含子目录）', () => {
    for (const home of [REAL_DSH, join(REAL_DSH, 'profiles', 'xuanshu'), REAL_DSH.toUpperCase()]) {
      const dataDir = resolveDataDir(bareCtx, {}, { env: { DSH_HOME: home }, homedirPath: USER_HOME })
      expect(isUnder(dataDir, REAL_DSH), home).toBe(false)
      expect(dataDir, home).toBe(join(PRODUCT_HOME, 'xuanshu'))
    }
  })

  it('profileContext.home 落在真实 ~/.dsh 里时同样改判兜底（防御纵深）', () => {
    expect(resolveDataDir(profileCtx(REAL_DSH), {}, { env: {}, homedirPath: USER_HOME }))
      .toBe(join(PRODUCT_HOME, 'xuanshu'))
  })

  it('兜底链：XUANSHU_DSH_HOME ＞ ~/.xuanshu', () => {
    expect(resolveDataDir(bareCtx, {}, { env: { XUANSHU_DSH_HOME: join('D:', 'own') }, homedirPath: USER_HOME }))
      .toBe(join('D:', 'own', 'xuanshu'))
    expect(resolveDataDir(bareCtx, {}, { env: {}, homedirPath: USER_HOME })).toBe(join(PRODUCT_HOME, 'xuanshu'))
  })
})

describe('S1 · resolveSearchHome：skill 扫描根的唯一顺序 + 真实 home 门', () => {
  it('显式 > profileContext.home > dataDir 父目录（目录名 xuanshu）> DSH_HOME > 兜底', () => {
    const explicit = join('D:', 'explicit')
    expect(resolveSearchHome({ ctx: profileCtx(join('D:', 'p')), dataDir: join('D:', 'h', 'xuanshu'), explicit, env: {}, homedirPath: USER_HOME }).home)
      .toBe(explicit)
    expect(resolveSearchHome({ ctx: profileCtx(join('D:', 'p')), dataDir: join('D:', 'h', 'xuanshu'), env: {}, homedirPath: USER_HOME }).home)
      .toBe(join('D:', 'p'))
    expect(resolveSearchHome({ ctx: bareCtx, dataDir: join('D:', 'h', 'xuanshu'), env: { DSH_HOME: join('D:', 'env') }, homedirPath: USER_HOME }).home)
      .toBe(join('D:', 'h'))
    // 目录名对不上时不瞎猜父目录，继续看环境变量。
    expect(resolveSearchHome({ ctx: bareCtx, dataDir: join('D:', 'weird'), env: { DSH_HOME: join('D:', 'env') }, homedirPath: USER_HOME }).home)
      .toBe(join('D:', 'env'))
    expect(resolveSearchHome({ ctx: bareCtx, env: { XUANSHU_DSH_HOME: join('D:', 'own') }, homedirPath: USER_HOME }).home)
      .toBe(join('D:', 'own'))
    expect(resolveSearchHome({ ctx: bareCtx, env: {}, homedirPath: USER_HOME }).home).toBe(PRODUCT_HOME)
  })

  it('来源随每一档如实回传（报告/notes 要能说清这个路径是谁定的）', () => {
    expect(resolveSearchHome({ ctx: profileCtx(join('D:', 'p')), env: {}, homedirPath: USER_HOME }).source)
      .toBe('profileContext.home')
    expect(resolveSearchHome({ ctx: bareCtx, dataDir: join('D:', 'h', 'xuanshu'), env: {}, homedirPath: USER_HOME }).source)
      .toBe('dataDir parent')
    expect(resolveSearchHome({ ctx: bareCtx, env: { DSH_HOME: join('D:', 'env') }, homedirPath: USER_HOME }).source)
      .toBe('DSH_HOME')
  })

  it('DSH_HOME=<真实 ~/.dsh>：扫描根不是它、不是它的子目录，且带回一条原因', () => {
    for (const home of [REAL_DSH, join(REAL_DSH, 'skills')]) {
      const resolved = resolveSearchHome({ ctx: bareCtx, env: { DSH_HOME: home }, homedirPath: USER_HOME })
      expect(isUnder(resolved.home, REAL_DSH), home).toBe(false)
      expect(resolved.home, home).toBe(PRODUCT_HOME)
      expect(resolved.realDsh, home).toBe(true)
      expect(typeof resolved.note, home).toBe('string')
      expect(resolved.note, home).toContain('.dsh')
      expect(resolved.note, home).toContain('玄枢')
    }
  })

  it('显式 / profileContext 落在真实 ~/.dsh 里时同样改判兜底并说明', () => {
    const explicit = resolveSearchHome({ ctx: bareCtx, explicit: join(REAL_DSH, 'skills'), env: {}, homedirPath: USER_HOME })
    expect(explicit.home).toBe(PRODUCT_HOME)
    expect(explicit.realDsh).toBe(true)
    expect(typeof explicit.note).toBe('string')
    const fromProfile = resolveSearchHome({ ctx: profileCtx(REAL_DSH), env: {}, homedirPath: USER_HOME })
    expect(fromProfile.home).toBe(PRODUCT_HOME)
    expect(fromProfile.realDsh).toBe(true)
  })

  it('正常 home 时没有 realDsh / note（不无病呻吟）', () => {
    const resolved = resolveSearchHome({ ctx: profileCtx(join('D:', 'p')), env: {}, homedirPath: USER_HOME })
    expect(resolved.realDsh).toBe(false)
    expect(resolved.note).toBeUndefined()
  })
})

describe('S1 · 两个薄包装与唯一实现逐条对拍', () => {
  const options = { env: {}, homedirPath: USER_HOME }
  const fixtures = [
    { ctx: profileCtx(join('D:', 'p')), dataDir: join('D:', 'h', 'xuanshu') },
    { ctx: bareCtx, dataDir: join('D:', 'h', 'xuanshu') },
    { ctx: bareCtx, dataDir: join('D:', 'other') },
    { ctx: bareCtx, dataDir: undefined },
  ]

  it('workflow.resolveDshHome === resolveSearchHome（同一顺序，含真实 home 门）', () => {
    for (const fixture of fixtures) {
      const expected = resolveSearchHome({ ...fixture, env: {}, homedirPath: USER_HOME }).home
      expect(resolveDshHome(fixture.ctx, {}, fixture.dataDir, options)).toBe(expected)
    }
    const real = resolveSearchHome({ ctx: bareCtx, env: { DSH_HOME: REAL_DSH }, homedirPath: USER_HOME })
    expect(resolveDshHome(bareCtx, {}, undefined, { env: { DSH_HOME: REAL_DSH }, homedirPath: USER_HOME }))
      .toBe(real.home)
    expect(real.home).toBe(PRODUCT_HOME)
  })

  it('显式 dshHome 参数与 config.dshHome 等价', () => {
    expect(resolveDshHome(bareCtx, { dshHome: join('D:', 'cfg') }, join('D:', 'h', 'xuanshu'), options))
      .toBe(resolveShijiDshHome(bareCtx, join('D:', 'h', 'xuanshu'), join('D:', 'cfg'), options))
  })

  it('shiji.resolveShijiDshHome === resolveSearchHome（真实 home 门同样生效）', () => {
    for (const fixture of fixtures) {
      const expected = resolveSearchHome({ ...fixture, env: {}, homedirPath: USER_HOME }).home
      expect(resolveShijiDshHome(fixture.ctx, fixture.dataDir, undefined, options)).toBe(expected)
    }
    expect(resolveShijiDshHome(bareCtx, undefined, undefined, { env: { DSH_HOME: REAL_DSH }, homedirPath: USER_HOME }))
      .toBe(PRODUCT_HOME)
  })

  it('collectShijiEvidence 把「真实 home 已改判」写进 notes（用户看得到原因）', async () => {
    const result = await collectShijiEvidence({
      ctx: bareCtx,
      dataDir: join(tmpdir(), 'xs-home-fixture', 'nothing-here', 'data'),
      env: { DSH_HOME: REAL_DSH },
      homedirPath: USER_HOME,
    })
    const notes = result.notes.join('\n')
    expect(notes).toContain('.dsh')
    expect(notes).toContain('玄枢')
    // 扫描根绝不能是真实 home：工作流那一路上报的理由里不应出现真实 home 下的 skills 路径。
    expect(notes).not.toContain(join(REAL_DSH, 'skills', 'x'))
  })

  it('兜底 home 与 resolveHostHome 的兜底同源（不各写一份）', () => {
    const fallback = fallbackXuanshuHome({ env: {}, homedirPath: USER_HOME }).home
    expect(fallback).toBe(PRODUCT_HOME)
    expect(resolveHostHome({ env: {}, homedirPath: USER_HOME }).home).toBe(fallback)
  })
})

/* ──────────────────────────────────────────────────────────────────────────── *
 * 复核 C2（PR #32 二轮）：`cang` 与 `horosa` 从前各有一份自己的 home / dataDir 解析，
 * **都不经** `pointsAtRealDshHome`。下面三组用例把「全部服务组同一实现 + 同一道门」钉死：
 *   - cang：`dataDir` 与 `resolveDataDir` 是**同一个结果**（直接对拍），真实 home 下不落登记表；
 *   - horosa/paths：显式 / env 两条入口都在 path 层改判，并把原因写进 `note`；
 *   - horosa/service：runtime 与 install 两处解析同源，原因进 `snapshot().paths` / 装配 `notes`。
 * 全部用**假机器的家目录**（tmp 下的绝对路径）与显式接缝，绝不读写真 home。
 * ──────────────────────────────────────────────────────────────────────────── */

/** 造一台假机器（真实 fs 沙箱；调用方负责删 `root`）。 */
async function fakeMachine() {
  const root = await mkdtemp(join(tmpdir(), 'xs-home-single-source-'))
  const userHome = join(root, 'user')
  await mkdir(userHome, { recursive: true })
  return { root, userHome, realDsh: join(userHome, '.dsh'), productHome: join(userHome, '.xuanshu') }
}

describe('S1 · cang：dataDir 也走 home.mjs 的唯一入口（真实 ~/.dsh 被拒）', () => {
  it('profileContext.home 落在真实 ~/.dsh：登记表落到玄枢自己的 home，绝不写真实 home', async () => {
    const machine = await fakeMachine()
    try {
      const ctx = { get: (name) => (name === 'profileContext' ? { home: machine.realDsh } : undefined) }
      const options = { env: {}, homedirPath: machine.userHome }

      // 判据不是「cang 内部怎么写」，而是「它用的就是 resolveDataDir 算出来的那一份」。
      const expected = resolveDataDir(ctx, {}, options)
      expect(isUnder(expected, machine.realDsh)).toBe(false)
      expect(expected).toBe(join(machine.productHome, 'xuanshu'))

      const methods = createCangMethods(ctx, {}, options)
      const target = join(machine.root, 'note.txt')
      await writeFile(target, 'never-read')
      await methods['cang.register']({ path: target, name: '藏一件', tags: [] })

      expect(existsSync(join(expected, 'cang', 'registry.jsonl')), 'cang 的 dataDir 必须与 resolveDataDir 同一份').toBe(true)
      expect(existsSync(join(machine.realDsh, 'xuanshu', 'cang', 'registry.jsonl')), '真实 ~/.dsh 下不许出现藏登记表').toBe(false)
    } finally {
      await rm(machine.root, { recursive: true, force: true })
    }
  })
})

describe('S1 · horosa paths：home 收口到 home.mjs（真实 ~/.dsh 被拒并带 note）', () => {
  it('显式 dshHome 指向真实 ~/.dsh：改判玄枢兜底，派生路径跟着走，note 说明原因', () => {
    const resolved = resolveHorosaPaths({ dshHome: REAL_DSH, config: {}, env: {}, homedirPath: USER_HOME })
    expect(isUnder(resolved.dshHome, REAL_DSH)).toBe(false)
    expect(resolved.dshHome).toBe(PRODUCT_HOME)
    expect(resolved.dataDir).toBe(join(PRODUCT_HOME, 'xuanshu', 'horosa'))
    expect(resolved.setupReportFile).toBe(join(PRODUCT_HOME, 'xuanshu', 'setup-report.json'))
    expect(typeof resolved.note).toBe('string')
    expect(resolved.note).toContain('.dsh')
    expect(resolved.note).toContain('玄枢')
  })

  it('不给 dshHome 时经 home.mjs 解析：DSH_HOME=<真实 ~/.dsh>（含子目录）同样改判', () => {
    for (const home of [REAL_DSH, join(REAL_DSH, 'profiles', 'xuanshu')]) {
      const resolved = resolveHorosaPaths({ config: {}, env: { DSH_HOME: home }, homedirPath: USER_HOME })
      expect(isUnder(resolved.dshHome, REAL_DSH), home).toBe(false)
      expect(resolved.dshHome, home).toBe(PRODUCT_HOME)
      expect(typeof resolved.note, home).toBe('string')
    }
  })

  it('正常 dshHome / DSH_HOME 原样采用，且没有 note（不无病呻吟）', () => {
    const explicit = resolveHorosaPaths({ dshHome: join('D:', 'dsh'), config: {}, env: {}, homedirPath: USER_HOME })
    expect(explicit.dshHome).toBe(join('D:', 'dsh'))
    expect(explicit.note).toBeUndefined()
    const fromEnv = resolveHorosaPaths({ config: {}, env: { DSH_HOME: join('D:', 'dsh') }, homedirPath: USER_HOME })
    expect(fromEnv.dshHome).toBe(join('D:', 'dsh'))
    expect(fromEnv.note).toBeUndefined()
  })
})

describe('S1 · horosa service：runtime 与 install 的解析同源，原因可观察', () => {
  it('createHorosaRuntime：profileContext.home 在真实 ~/.dsh 时改判，snapshot().paths 带 note', () => {
    const runtime = createHorosaRuntime({
      ctx: profileCtx(REAL_DSH),
      config: { autoStart: false },
      env: {},
      homedirPath: USER_HOME,
    })
    const snapshot = runtime.snapshot()
    expect(isUnder(snapshot.paths.dshHome, REAL_DSH)).toBe(false)
    expect(snapshot.paths.dshHome).toBe(PRODUCT_HOME)
    expect(snapshot.paths.note).toContain('玄枢')
  })

  it('installHorosa：拒绝原因进装配 notes，状态文件不在真实 ~/.dsh 下', async () => {
    const machine = await fakeMachine()
    try {
      const result = installHorosa(
        profileCtx(machine.realDsh),
        { autoStart: false },
        { env: {}, homedirPath: machine.userHome },
      )
      expect(result.ok).toBe(true)
      expect(isUnder(result.paths.dshHome, machine.realDsh)).toBe(false)
      expect(result.paths.dshHome).toBe(machine.productHome)
      const notes = result.notes.join('\n')
      expect(notes).toContain('.dsh')
      expect(notes).toContain('玄枢')
      expect(existsSync(join(machine.realDsh, 'xuanshu', 'horosa', 'horosa-status.json')), '真实 ~/.dsh 下不许落状态文件').toBe(false)
      expect(existsSync(join(machine.productHome, 'xuanshu', 'horosa', 'horosa-status.json'))).toBe(true)
    } finally {
      await rm(machine.root, { recursive: true, force: true })
    }
  })
})
