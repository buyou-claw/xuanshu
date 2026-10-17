/**
 * #23 · home 解析：壳的本地副本 == #22 的共享解析器（冻结契约 §0）。
 *
 * 契约原话：「壳解析 home 必须与 #22 的共享解析器**同一套规则**……不许再抄一份隐式默认」。
 * 壳不能反向依赖 `scripts/`（装好的应用里没有它），所以这里是 parity-tested local copy：
 * 对每一组 env / 参数，把 `scripts/isolation/resolve.mjs::resolveHomeWithSource` 的**真结果**
 * 拿来逐字比。优先级、真实 `~/.dsh` 的软忽略、dev/product 两档默认都在这里被钉住。
 *
 * 环境纪律：`realHome` 由测试注入（一个虚构目录），绝不读机器真实的 `~/.dsh`。
 */
import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'

import { pointsAtRealDshHome, resolveHomeWithSource } from '../../scripts/isolation/resolve.mjs'
import {
  DEV_HOME_DIR_NAME,
  HOME_MODES,
  PRODUCT_HOME_DIR_NAME,
} from '../../packages/xuanshu-shell/lib/contract.mjs'
import { isRealDshHome, resolveShellHome, shellPaths } from '../../packages/xuanshu-shell/lib/home.mjs'

/** 虚构的真实 DSH home（只用于「拒绝/忽略它」的判断，绝不读内容）。 */
const REAL_HOME = resolve('C:/fake-user/.dsh')
const REPO_ROOT = resolve('C:/fake-repo')
const HOMEDIR = resolve('C:/fake-user')

/** 两边各跑一次，返回可比较的 `{home, source, mode, ignored}`。 */
function compareShellVsShared(options) {
  const shared = resolveHomeWithSource(options)
  const shell = resolveShellHome(options)
  return {
    shared: { home: shared.home, source: shared.source, mode: shared.mode, ignored: shared.ignored },
    shell: { home: shell.home, source: shell.source, mode: shell.mode, ignored: shell.ignored },
  }
}

describe('#23 · home 解析：与 scripts/isolation/resolve.mjs 逐字同判', () => {
  it('显式 home 最高优先（source = --home）', () => {
    const { shared, shell } = compareShellVsShared({
      home: join(REPO_ROOT, 'explicit-home'),
      env: { XUANSHU_DSH_HOME: join(REPO_ROOT, 'env-home'), DSH_HOME: join(REPO_ROOT, 'dsh-env') },
      repoRoot: REPO_ROOT,
      realHome: REAL_HOME,
    })
    expect(shell).toEqual(shared)
    expect(shell.home).toBe(resolve(join(REPO_ROOT, 'explicit-home')))
    expect(shell.source).toBe('--home')
  })

  it('XUANSHU_DSH_HOME 次之；DSH_HOME 不抢占', () => {
    const { shared, shell } = compareShellVsShared({
      env: { XUANSHU_DSH_HOME: join(REPO_ROOT, 'env-home'), DSH_HOME: join(REPO_ROOT, 'dsh-env') },
      repoRoot: REPO_ROOT,
      realHome: REAL_HOME,
    })
    expect(shell).toEqual(shared)
    expect(shell.home).toBe(resolve(join(REPO_ROOT, 'env-home')))
    expect(shell.source).toBe('XUANSHU_DSH_HOME')
  })

  it('DSH_HOME 指向非真实 home 时采纳', () => {
    const { shared, shell } = compareShellVsShared({
      env: { DSH_HOME: join(REPO_ROOT, 'dsh-env') },
      repoRoot: REPO_ROOT,
      realHome: REAL_HOME,
    })
    expect(shell).toEqual(shared)
    expect(shell.home).toBe(resolve(join(REPO_ROOT, 'dsh-env')))
    expect(shell.source).toBe('DSH_HOME')
  })

  it('DSH_HOME 指向真实 ~/.dsh 时**忽略并记 notes**（软处理，不是硬拒绝）', () => {
    for (const candidate of [REAL_HOME, join(REAL_HOME, 'profiles', 'xuanshu')]) {
      const { shared, shell } = compareShellVsShared({
        env: { DSH_HOME: candidate },
        repoRoot: REPO_ROOT,
        realHome: REAL_HOME,
      })
      expect(shell, candidate).toEqual(shared)
      expect(shell.home).toBe(resolve(join(REPO_ROOT, DEV_HOME_DIR_NAME)))
      expect(shell.ignored).toHaveLength(1)
      expect(shell.ignored[0]).toMatch(/真实 DSH home/u)
    }
  })

  it('空白环境变量当「未设」（不把 "" 当路径）', () => {
    const { shared, shell } = compareShellVsShared({
      env: { XUANSHU_DSH_HOME: '   ', DSH_HOME: '' },
      repoRoot: REPO_ROOT,
      realHome: REAL_HOME,
    })
    expect(shell).toEqual(shared)
    expect(shell.home).toBe(resolve(join(REPO_ROOT, DEV_HOME_DIR_NAME)))
  })

  it('无 env 时：有仓库检出 → dev 档 <repo>/.dsh-home', () => {
    const { shared, shell } = compareShellVsShared({ env: {}, repoRoot: REPO_ROOT, realHome: REAL_HOME })
    expect(shell).toEqual(shared)
    expect(shell.mode).toBe('dev')
    expect(shell.home).toBe(resolve(join(REPO_ROOT, DEV_HOME_DIR_NAME)))
  })

  it('无 env 且找不到仓库 → product 档 ~/.xuanshu（与共享解析器同判）', () => {
    const options = {
      env: {},
      realHome: REAL_HOME,
      locateRepoRoot: () => {
        throw new Error('no pnpm-workspace.yaml')
      },
    }
    const shared = resolveHomeWithSource(options)
    const shell = resolveShellHome(options)
    expect({ home: shell.home, source: shell.source }).toEqual({ home: shared.home, source: shared.source })
    expect(shell.mode).toBe('product')
    // 不断言具体家目录（测试机各有各的 homedir），只断言它落在 product 档且不是真实 ~/.dsh。
    expect(shell.home.endsWith(PRODUCT_HOME_DIR_NAME)).toBe(true)
    expect(isRealDshHome(shell.home, { realHome: REAL_HOME })).toBe(false)
  })

  it('显式 mode=product / 陌生 mode 两边同判（陌生 mode 抛）', () => {
    const product = compareShellVsShared({
      env: {}, repoRoot: REPO_ROOT, realHome: REAL_HOME, mode: 'product',
    })
    expect(product.shell).toEqual(product.shared)
    expect(product.shell.mode).toBe('product')
    expect(product.shell.home.endsWith(PRODUCT_HOME_DIR_NAME)).toBe(true)
    expect(product.shell.home.startsWith(HOMEDIR)).toBe(false) // 真实 homedir 由 os.homedir() 决定

    expect(() => resolveShellHome({ env: {}, repoRoot: REPO_ROOT, realHome: REAL_HOME, mode: 'staging' }))
      .toThrow(new RegExp(HOME_MODES.join('|'), 'u'))
  })
})

describe('#23 · 真实 home 判定与派生路径', () => {
  it('isRealDshHome 与共享解析器 pointsAtRealDshHome 同判', () => {
    const cases = [
      REAL_HOME,
      join(REAL_HOME, 'profiles'),
      join(REAL_HOME, '..', '.dsh'),
      REPO_ROOT,
      join(REPO_ROOT, '.dsh'),
      '',
      undefined,
    ]
    for (const home of cases) {
      expect(isRealDshHome(home, { realHome: REAL_HOME }), String(home))
        .toBe(pointsAtRealDshHome(home, { realHome: REAL_HOME }))
      // 语义自证：不是「指向真实 home 的东西」都必须是 false，且不得把空值当真实 home。
      expect(isRealDshHome(home, { realHome: REAL_HOME }), String(home)).toBe(isExpectedReal(home))
    }
  })

  it('派生路径全部落在 home 下，形状照契约 §0/§1/§5', () => {
    const home = resolve('C:/fake-repo/.dsh-home')
    const paths = shellPaths(home)
    expect(paths.dataDir).toBe(join(home, 'xuanshu'))
    expect(paths.runtimeDir).toBe(join(home, 'xuanshu', 'runtime'))
    expect(paths.notifyStateFile).toBe(join(home, 'xuanshu', 'runtime', 'shell-notify.json'))
    // P1（复核 #23）：壳把自己的实际生效状态写在同一个 runtime 目录的兄弟文件里。
    expect(paths.statusFile).toBe(join(home, 'xuanshu', 'runtime', 'shell-status.json'))
    expect(paths.settingsFile).toBe(join(home, 'xuanshu', 'shell-settings.json'))
    expect(paths.profileDir).toBe(join(home, 'profiles', 'xuanshu'))
    for (const key of ['dataDir', 'runtimeDir', 'notifyStateFile', 'statusFile', 'settingsFile', 'profileDir']) {
      expect(paths[key].startsWith(resolve(home)), key).toBe(true)
    }
  })
})

/** 与 `resolve.mjs::pointsAtRealDshHome` 的语义同一份（测试里独立写一遍，避免用被测函数当判据）。 */
function isExpectedReal(home) {
  if (typeof home !== 'string' || home === '') return false
  const a = resolve(home).toLowerCase()
  const b = REAL_HOME.toLowerCase()
  return a === b || a.startsWith(`${b}\\`) || a.startsWith(`${b}/`)
}
