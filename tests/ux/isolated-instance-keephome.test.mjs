/**
 * tests/ux/isolated-instance-keephome.test.mjs —— 票 #76「预改造：隔离启动支持保留 home」。
 *
 * 要守的事（ADR-0017 第 4 条 / 第 10 条，`01-recon.md` §2 三个坑）：
 *   - 既有巡检（`keepHome` 关闭）的行为、输出、退出码**一个字节都不许变**；
 *   - 打开时进程停止但 home 与其中的数据留着给下一轮复用；
 *   - 打开时**不许丢**「还原共享 profile 的临时改写」这项防护（`profile/cordis.yml` 与入库件 `cordis.patch.yml`）；
 *   - 打开时**不许**递归删 home；但「先摘 junction」这条不跟穿护栏**两种模式都保留**
 *     （本仓 2026-10-17 踩过跟穿事故，见 docs/agents/parallel-work.md §2）。
 *
 * 测试口径（照 `tests/ux/family-dc.test.mjs`「录制夹具走同一条判定路径」的范式）：
 *   结构与清理语义**全部在真临时目录 + 真 junction 上判**，不起 DSH 实例（真起一次 ~20s，
 *   且浏览器侧端到端只留 1 条）。`startIsolatedInstance` 里剩下的只有「把选项与 home 传给执行器」
 *   这一层，由本文件末尾那 1 条真起实例的端到端覆盖：它按 `hasInstanceDeps`（缺 `profile/node_modules`
 *   这个 gitignore 前置时跳过并写明原因）走既有诚实口径 —— 没验到 ≠ 通过。
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  captureSharedProfile,
  planInstanceTeardown,
  runInstanceTeardown,
  startIsolatedInstance,
} from '../../scripts/ux/collect/browser.mjs'
import { removeLinks } from '../../scripts/lib/cleanup-junctions.mjs'

describe('票 #76 · 清理决策：keepHome 默认关闭', () => {
  it('不传任何选项 → 与改动前等价：还原 profile、摘 junction、递归删 home', () => {
    expect(planInstanceTeardown()).toEqual({
      keepHome: false,
      restoreProfile: true,
      unlinkProfileJunctions: true,
      removeHome: true,
    })
  })

  it('显式 keepHome: false（既有巡检传法）→ 决策与默认完全一致', () => {
    expect(planInstanceTeardown({ keepHome: false })).toEqual(planInstanceTeardown())
  })

  it('打开保留开关 → 只关掉「递归删 home」这一项，两项护栏仍然执行', () => {
    expect(planInstanceTeardown({ keepHome: true })).toEqual({
      keepHome: true,
      restoreProfile: true,
      unlinkProfileJunctions: true,
      removeHome: false,
    })
  })
})

/** 造一份「真起过实例之后」的现场：home 里 profiles/xuanshu 是指向共享 profile 的链接。 */
function makeScene() {
  const root = mkdtempSync(join(tmpdir(), 'ux-keephome-'))
  const repoRoot = join(root, 'repo')
  const sharedProfile = join(repoRoot, 'profile')
  const home = join(root, 'home')
  mkdirSync(join(sharedProfile, 'node_modules'), { recursive: true })
  mkdirSync(join(home, 'profiles'), { recursive: true })
  // 共享 profile 里那两个会被首跑改写的文件（`01-recon.md` §2 坑 2）
  const patchBefore = 'welcomeNoticeVersion: 1\n'
  const rootBefore = '# root config\n'
  writeFileSync(join(sharedProfile, 'cordis.patch.yml'), patchBefore, 'utf8')
  writeFileSync(join(sharedProfile, 'cordis.yml'), rootBefore, 'utf8')
  // link 模式的产物：home 里的 profile 位置是一个指向仓库 profile/ 的链接
  makeLink(sharedProfile, join(home, 'profiles', 'xuanshu'))
  // 真启动一轮会留下的数据（要跨轮复用的就是这些）
  mkdirSync(join(home, 'sessions', 'session-xs-consult'), { recursive: true })
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(join(home, 'storages', 'workspace.json'), '{}\n', 'utf8')
  // profile 里正常该有的东西：哨兵，用来证明「摘链接没跟穿」
  writeFileSync(join(sharedProfile, 'package.json'), '{"name":"xuanshu-profile"}\n', 'utf8')
  return {
    root, repoRoot, home, sharedProfile, patchBefore, rootBefore,
    dispose: () => { removeLinks(root); rmSync(root, { recursive: true, force: true }) },
  }
}

/** Windows 用 junction（跟穿风险的来源），其它平台用目录符号链接走同一条判定路径。 */
function makeLink(target, link) {
  if (process.platform === 'win32') {
    const result = spawnSync('cmd', ['/c', 'mklink', '/J', link, target], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`mklink /J 失败：${result.stdout}${result.stderr}`)
    return
  }
  symlinkSync(target, link, 'dir')
}

/** 模拟首跑改写共享 profile（实测：关掉欢迎说明会往入库件 `cordis.patch.yml` 追加一行）。 */
function mutateSharedProfile(scene) {
  writeFileSync(join(scene.sharedProfile, 'cordis.patch.yml'), `${scene.patchBefore}welcomeNoticeVersion: 2\n`, 'utf8')
  writeFileSync(join(scene.sharedProfile, 'cordis.yml'), `${scene.rootBefore}# rewritten by first run\n`, 'utf8')
}

describe('票 #76 · 标准 1：默认模式（keepHome 关闭）与改动前逐字节等价', () => {
  it('stop 语义执行后：home 目录不存在，且 profile 文件被还原', () => {
    const scene = makeScene()
    try {
      const snapshot = captureSharedProfile({ repoRoot: scene.repoRoot }) // 启动前快照
      mutateSharedProfile(scene)                                         // 首跑把入库件改了
      const result = runInstanceTeardown({ home: scene.home, restoreProfile: snapshot.restore })

      // 与改动前等价的两条硬断言（票面点名的「等价」定义）
      expect(existsSync(scene.home)).toBe(false)
      expect(readFileSync(join(scene.sharedProfile, 'cordis.patch.yml'), 'utf8')).toBe(scene.patchBefore)
      expect(readFileSync(join(scene.sharedProfile, 'cordis.yml'), 'utf8')).toBe(scene.rootBefore)
      // 决策就是今天的那一套（没人传选项时不该出现任何新行为）
      expect(result).toMatchObject({ keepHome: false, restoreProfile: true, unlinkProfileJunctions: true, removeHome: true })
      // 删之前链接确实被摘掉了（顺序与改动前一致：`rmdir <link>` 先于递归删除）
      expect(result.unlinked).toEqual([join(scene.home, 'profiles', 'xuanshu')])
    } finally {
      scene.dispose()
    }
  })

  it('还原防护只认那两类文件，不碰 profile 里其它真件', () => {
    const scene = makeScene()
    try {
      const sentinel = join(scene.sharedProfile, 'cordis.patch.yml.bak')
      writeFileSync(sentinel, 'mine\n', 'utf8')
      // 启动前不存在的那个文件，首跑新建了 → 还原应当删掉它（今天的行为）
      rmSync(join(scene.sharedProfile, 'cordis.yml'))
      const snapshot = captureSharedProfile({ repoRoot: scene.repoRoot })
      writeFileSync(join(scene.sharedProfile, 'cordis.yml'), '# generated by first run\n', 'utf8')

      snapshot.restore()

      expect(existsSync(join(scene.sharedProfile, 'cordis.yml'))).toBe(false)
      expect(readFileSync(sentinel, 'utf8')).toBe('mine\n')
    } finally {
      scene.dispose()
    }
  })
})

describe('票 #76 · 标准 2/3/4：keepHome 打开（评估跨轮复用同一个 home）', () => {
  it('home 与其中的会话 / 存储位仍在，下一轮可直接复用', () => {
    const scene = makeScene()
    try {
      const snapshot = captureSharedProfile({ repoRoot: scene.repoRoot })
      mutateSharedProfile(scene)

      runInstanceTeardown({ home: scene.home, keepHome: true, restoreProfile: snapshot.restore })

      expect(existsSync(scene.home)).toBe(true)
      expect(existsSync(join(scene.home, 'sessions', 'session-xs-consult'))).toBe(true)
      expect(existsSync(join(scene.home, 'storages', 'workspace.json'))).toBe(true)
      // home 里的 `profiles/` 位置还在：里面那个指向仓库 profile/ 的**链接**被摘掉了（不跟穿护栏），
      // 下一轮启动由 install-profile 幂等重建 —— 数据本体（sessions / storages）才是复用要保的东西。
      expect(existsSync(join(scene.home, 'profiles'))).toBe(true)
      expect(existsSync(join(scene.home, 'profiles', 'xuanshu'))).toBe(false)
      // 目标哨兵活着：摘链接只删链接本身，绝不跟穿进仓库 profile
      expect(existsSync(join(scene.sharedProfile, 'package.json'))).toBe(true)
    } finally {
      scene.dispose()
    }
  })

  it('仍然执行「还原共享 profile 的临时改写」—— 保留 home 不是留脏仓库的理由', () => {
    const scene = makeScene()
    try {
      const snapshot = captureSharedProfile({ repoRoot: scene.repoRoot })
      mutateSharedProfile(scene)
      expect(readFileSync(join(scene.sharedProfile, 'cordis.patch.yml'), 'utf8')).not.toBe(scene.patchBefore)

      const result = runInstanceTeardown({ home: scene.home, keepHome: true, restoreProfile: snapshot.restore })

      expect(result.restoreProfile).toBe(true)
      expect(readFileSync(join(scene.sharedProfile, 'cordis.patch.yml'), 'utf8')).toBe(scene.patchBefore)
      expect(readFileSync(join(scene.sharedProfile, 'cordis.yml'), 'utf8')).toBe(scene.rootBefore)
    } finally {
      scene.dispose()
    }
  })

  it('一次递归删除都不发，但摘 junction 这条不跟穿护栏仍然执行', () => {
    const scene = makeScene()
    try {
      const snapshot = captureSharedProfile({ repoRoot: scene.repoRoot })
      const calls = []
      const result = runInstanceTeardown({
        home: scene.home,
        keepHome: true,
        restoreProfile: () => { calls.push('restore'); snapshot.restore() },
        ops: {
          removeHome: () => { calls.push('removeHome') },
          unlinkJunction: (link) => { calls.push(`unlink:${link}`); removeOneLink(link) },
        },
      })

      expect(result.removeHome).toBe(false)
      expect(result.unlinkProfileJunctions).toBe(true)
      // 关键：`rmSync(home, {recursive:true})` 那条路径一次都没被调用
      expect(calls.filter((call) => call === 'removeHome')).toEqual([])
      // 而还原与摘链接都照常发生（顺序与默认模式一致：先还原、再摘链接）
      expect(calls).toEqual(['restore', `unlink:${join(scene.home, 'profiles', 'xuanshu')}`])
    } finally {
      scene.dispose()
    }
  })

  it('真目录上复查：打开时链接被摘掉、home 本体没被删（不是靠注入替身自证）', () => {
    const scene = makeScene()
    try {
      const snapshot = captureSharedProfile({ repoRoot: scene.repoRoot })
      const result = runInstanceTeardown({ home: scene.home, keepHome: true, restoreProfile: snapshot.restore })

      expect(result.unlinked).toEqual([join(scene.home, 'profiles', 'xuanshu')])
      expect(existsSync(join(scene.home, 'profiles', 'xuanshu'))).toBe(false) // 链接本身没了
      expect(existsSync(scene.home)).toBe(true)                              // home 还在
      expect(existsSync(join(scene.sharedProfile, 'node_modules'))).toBe(true)
    } finally {
      scene.dispose()
    }
  })

  it('默认模式把同一条递归删除路径走完（对照组，证明那个槽位不是永远不被调用）', () => {
    const scene = makeScene()
    try {
      const snapshot = captureSharedProfile({ repoRoot: scene.repoRoot })
      const calls = []
      runInstanceTeardown({
        home: scene.home,
        restoreProfile: () => { calls.push('restore'); snapshot.restore() },
        ops: { removeHome: () => { calls.push('removeHome') }, unlinkJunction: () => { calls.push('unlink') } },
      })
      expect(calls).toEqual(['restore', 'unlink', 'removeHome'])
    } finally {
      scene.dispose()
    }
  })
})

/** 摘掉一个链接本身（测试里替代真删，语义与 `cleanup-junctions` 的 defaultRemove 一致）。 */
function removeOneLink(link) {
  if (process.platform === 'win32') {
    spawnSync('cmd', ['/c', 'rmdir', link], { encoding: 'utf8' })
    return
  }
  rmSync(link, { force: true })
}

const REPO_ROOT = join(import.meta.dirname, '..', '..')
/**
 * 真起实例的前置是「仓库 profile 里装好了 DSH CLI」（`profile/node_modules` 是 gitignore 的本地前置），
 * 不是 playwright —— 这一条不起浏览器，只起 node 进程。缺前置就跳过并写明原因（照
 * `browser-collector.test.mjs` 的诚实口径：没验到 ≠ 通过）。
 */
const hasInstanceDeps = existsSync(
  join(REPO_ROOT, 'profile', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
)

describe('票 #76 · 唯一条真起实例的端到端：keepHome 接线 + 第二轮复用同一 home', () => {
  it.skipIf(!hasInstanceDeps)(
    'keepHome: true → stop 后 home 与现场仍在、共享 profile 未被污染 → 同一 home 能再起一轮',
    async () => {
      const first = await startIsolatedInstance({ repoRoot: REPO_ROOT, keepHome: true, log: () => {} })
      expect(first.keepHome).toBe(true)
      const home = first.home
      try {
        const kept = await first.stop()
        expect(kept).toMatchObject({ keepHome: true, restoreProfile: true, unlinkProfileJunctions: true, removeHome: false })
        expect(existsSync(home)).toBe(true)
        // 真跑一轮 DSH 之后 home 里确实有下一轮要复用的现场（这几个目录由实例自己写）
        expect(existsSync(join(home, 'profiles'))).toBe(true)
        expect(existsSync(join(home, 'sessions'))).toBe(true)
        expect(existsSync(join(home, 'storages'))).toBe(true)
        // home 里的 profile 链接已被摘掉（不跟穿护栏在真模式下也执行）
        expect(existsSync(join(home, 'profiles', 'xuanshu'))).toBe(false)
        // 仓库的共享 profile 没留下任何改写（这条防护与模式无关）
        const dirty = spawnSync('git', ['status', '--porcelain', '--', 'profile'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim()
        expect(dirty).toBe('')

        // 第二轮：把上一轮的 home 原样传回去，装配必须幂等（链接被摘过 → install-profile 重建）
        const second = await startIsolatedInstance({ repoRoot: REPO_ROOT, keepHome: true, home, log: () => {} })
        expect(second.home).toBe(home)
        expect(second.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=/)
        await second.stop()

        // 人显式清理一轮（票面标准 4 的后半句：清理由人发起），然后把**同一个路径**再传一次 ——
        // 目录已不存在也必须起得来（票 #77 的 runner 用固定的 `.experience-home/`，不是临时目录）。
        removeLinks(home)
        rmSync(home, { recursive: true, force: true })
        const third = await startIsolatedInstance({ repoRoot: REPO_ROOT, keepHome: true, home, log: () => {} })
        expect(third.home).toBe(home)
        expect(third.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=/)
        await third.stop()
        expect(existsSync(home)).toBe(true)
      } finally {
        // 测试自己负责回收这个 home：先摘链接，再删目录（绝不跟穿）
        removeLinks(home)
        rmSync(home, { recursive: true, force: true })
        expect(existsSync(home)).toBe(false)
      }

      // 同一个用例里再走一遍**默认模式**（不传任何新参数）：那条路径就是既有巡检走的，
      // stop() 之后 home 必须消失 —— 这里证明的是接线，不是只有被抽出来的执行器。
      const plain = await startIsolatedInstance({ repoRoot: REPO_ROOT, log: () => {} })
      expect(plain.keepHome).toBe(false)
      const plainHome = plain.home
      const plainResult = await plain.stop()
      expect(plainResult).toMatchObject({ keepHome: false, removeHome: true })
      expect(existsSync(plainHome)).toBe(false)
    },
    180_000,
  )
})
