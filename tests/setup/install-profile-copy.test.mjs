/**
 * tests/setup/install-profile-copy.test.mjs — copy 模式的**回归用例**。
 *
 * 为什么必须存在（复核报告 `docs/reviews/spec001-a2ceaf3-review.md` 的 Standards 3 / Standards 4）：
 *   - Standards 3：copy 模式把自有插件依赖改写成 `link:<仓库绝对路径>`，于是 pnpm **只建联接、不装**
 *     被链接包自己的 dependencies —— 目标 profile 的 node_modules 里没有 `tz-lookup`，
 *     `xuanshu-host` 一 import 就是 ERR_MODULE_NOT_FOUND；而且包仍然靠仓库绝对路径活着，
 *     ADR-0008 的 copy 场景（运行环境里没有仓库）根本不成立。
 *   - Standards 4：复制列表里没有 `pnpm-lock.yaml`，`--skip-install` 装配出来的 profile
 *     连一个锁文件都没有，`pnpm install --frozen-lockfile` 无从校验。
 *
 * 修复后的契约（本文件钉的就是这四条）：
 *   ① 自有插件包**内容进目标**（`<target>/packages/<name>`），说明符是 `file:./packages/<name>`；
 *   ② 包自己的运行时依赖随之可装：`file:` 语义会把它当依赖图的一部分（`link:` 不会，实测见下）；
 *   ③ `pnpm-lock.yaml` 复制过去，且自有包路径被改写成目标内相对路径、其余字节一个不动；
 *   ④ 语义上不该进清单的东西（peer / optional）不被塞进 profile 的 dependencies：
 *      peer 由 `autoInstallPeers: false` 明确不装（上游官方 profile 同款口径）。
 *
 * 为什么这样测（零 pnpm / 零网络 / 跑真代码）：
 *   - 真脚本从**自己的位置**推 REPO_ROOT（`dirname(script)/..`），所以把
 *     `<repo>/scripts/install-profile.mjs` **原样复制**进临时 fixture 仓库，它就会拿 fixture 的
 *     `profile/` 与 `packages/` 干活 —— 跑的是真代码，不碰真仓库、不碰真 DSH_HOME；
 *   - 加 `--skip-install` 关掉 pnpm：断言台的口径是「零网络、零真实安装」，pnpm 会不会碰 registry
 *     不由我们控制。所以这里断言的是**机制**（物化 + 说明符 + 锁文件改写），
 *     pnpm 层的行为（依赖真装进 node_modules、`--frozen-lockfile` 真的通过）由
 *     `.scratch/install-fix/probe2-copy.mjs` 的离网探针取证（任务报告里有原文输出）；
 *   - 被测脚本可用契约 §10 的注入口 `XUANSHU_INSTALL_PROFILE_BIN` 换（默认=仓库里的真实现）：
 *     指向修复前的存档即可复现「修复前红」，见 `tests/setup/README.md`。
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { childEnv } from './lib/env.mjs'
import { makeSandbox } from './lib/sandbox.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const REAL_SCRIPT = join(REPO_ROOT, 'scripts', 'install-profile.mjs')

/** 被测脚本：默认仓库里的真实现；`XUANSHU_INSTALL_PROFILE_BIN` 是契约 §10 既有的注入口。 */
const SCRIPT_UNDER_TEST = process.env.XUANSHU_INSTALL_PROFILE_BIN?.trim()
  ? resolve(process.env.XUANSHU_INSTALL_PROFILE_BIN.trim())
  : REAL_SCRIPT

/**
 * fixture 的 `profile/pnpm-lock.yaml`。
 *
 * 这是 pnpm（11.28.5，`nodeLinker: hoisted` + `autoInstallPeers: false`）为**同一套 fixture 依赖图**
 * 生成的真输出，逐字抄来当一个冻结样本：自有插件包在 `importers` / `packages` / `snapshots` 三节里
 * 各留下 `../packages/<name>` 形式的路径，正好覆盖改写要处理的三种形态（specifier / version /
 * resolution.directory + 键）。抄真输出而不是手编，是为了让「改哪些行」这件事有真实依据。
 */
const FIXTURE_LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      xuanshu-client:
        specifier: file:../packages/xuanshu-client
        version: file:../packages/xuanshu-client
      xuanshu-host:
        specifier: file:../packages/xuanshu-host
        version: file:../packages/xuanshu-host

packages:

  xs-fixture-optional@file:../packages/xuanshu-host/vendor/xs-fixture-optional:
    resolution: {directory: ../packages/xuanshu-host/vendor/xs-fixture-optional, type: directory}

  xs-fixture-runtime@file:../packages/xuanshu-host/vendor/xs-fixture-runtime:
    resolution: {directory: ../packages/xuanshu-host/vendor/xs-fixture-runtime, type: directory}

  xuanshu-client@file:../packages/xuanshu-client:
    resolution: {directory: ../packages/xuanshu-client, type: directory}

  xuanshu-host@file:../packages/xuanshu-host:
    resolution: {directory: ../packages/xuanshu-host, type: directory}
    peerDependencies:
      xs-fixture-peer-absent: '*'

snapshots:

  xs-fixture-optional@file:../packages/xuanshu-host/vendor/xs-fixture-optional:
    optional: true

  xs-fixture-runtime@file:../packages/xuanshu-host/vendor/xs-fixture-runtime: {}

  xuanshu-client@file:../packages/xuanshu-client: {}

  xuanshu-host@file:../packages/xuanshu-host:
    dependencies:
      xs-fixture-runtime: file:../packages/xuanshu-host/vendor/xs-fixture-runtime
    optionalDependencies:
      xs-fixture-optional: file:../packages/xuanshu-host/vendor/xs-fixture-optional
`

const JSON_TEXT = (obj) => `${JSON.stringify(obj, undefined, 2)}\n`

/** 往 fixture 仓库里写一个文件（父目录自动建）。 */
function write(repo, rel, content) {
  mkdirSync(dirname(join(repo, rel)), { recursive: true })
  writeFileSync(join(repo, rel), content)
}

/**
 * 造一个临时 fixture 仓库：`profile/` + `packages/` + 被测脚本的副本。
 *
 * 自有插件包的形状照着真仓库来（host 有运行时依赖/optional/peer）；运行时依赖为了离线放在**包内**
 * 的 `vendor/` 目录（真仓库里这个位置是 registry 依赖 `tz-lookup`，机制同一条：
 * 依赖图里的依赖必须能被装进目标 node_modules）。
 *
 * @param {object} sandbox makeSandbox 的返回值
 * @param {{ lockfile?: string }} [options] `lockfile: null` → 不放锁文件
 * @returns {{ repo: string, profile: string, home: string }}
 */
function makeFixtureRepo(sandbox, options = {}) {
  const repo = sandbox.dir(`repo-${Math.random().toString(36).slice(2, 8)}`)
  const profile = join(repo, 'profile')

  write(repo, 'profile/package.json', JSON_TEXT({
    name: 'dsh-profile-xuanshu',
    private: true,
    dependencies: {
      'xuanshu-host': 'file:../packages/xuanshu-host',
      'xuanshu-client': 'file:../packages/xuanshu-client',
    },
    dsh: { profile: { bundles: ['xuanshu-host', 'xuanshu-client'] } },
  }))
  write(repo, 'profile/cordis.patch.yml', '# fixture\n')
  write(repo, 'profile/pnpm-workspace.yaml', 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  const lockfile = options.lockfile === undefined ? FIXTURE_LOCKFILE : options.lockfile
  if (lockfile !== null) write(repo, 'profile/pnpm-lock.yaml', lockfile)

  write(repo, 'packages/xuanshu-host/package.json', JSON_TEXT({
    name: 'xuanshu-host',
    version: '0.1.0',
    private: true,
    type: 'module',
    main: 'index.js',
    dependencies: { 'xs-fixture-runtime': 'file:./vendor/xs-fixture-runtime' },
    optionalDependencies: { 'xs-fixture-optional': 'file:./vendor/xs-fixture-optional' },
    peerDependencies: { 'xs-fixture-peer-absent': '*' },
  }))
  write(repo, 'packages/xuanshu-host/index.js', 'import { marker } from "xs-fixture-runtime"\nexport default marker\n')
  write(repo, 'packages/xuanshu-host/lib/note.md', 'runtime dep must travel with the package\n')
  write(repo, 'packages/xuanshu-host/vendor/xs-fixture-runtime/package.json', JSON_TEXT({ name: 'xs-fixture-runtime', version: '1.0.0', main: 'index.js' }))
  write(repo, 'packages/xuanshu-host/vendor/xs-fixture-runtime/index.js', 'export const marker = "fixture-runtime-loaded"\n')
  write(repo, 'packages/xuanshu-host/vendor/xs-fixture-optional/package.json', JSON_TEXT({ name: 'xs-fixture-optional', version: '1.0.0', main: 'index.js' }))
  write(repo, 'packages/xuanshu-host/vendor/xs-fixture-optional/index.js', 'export default "optional"\n')
  // 依赖树不是分发物：物化时必须跳过包自己的 node_modules（这里放个哨兵文件来证明）。
  write(repo, 'packages/xuanshu-host/node_modules/from-repo.txt', 'must not be copied\n')

  write(repo, 'packages/xuanshu-client/package.json', JSON_TEXT({ name: 'xuanshu-client', version: '0.1.0', private: true, type: 'module', main: 'index.js' }))
  write(repo, 'packages/xuanshu-client/index.js', 'export default "client"\n')

  mkdirSync(join(repo, 'scripts'), { recursive: true })
  cpSync(SCRIPT_UNDER_TEST, join(repo, 'scripts', 'install-profile.mjs'))

  return { repo, profile, home: sandbox.dir(`home-${Math.random().toString(36).slice(2, 8)}`) }
}

/** 跑 fixture 仓库里的那份被测脚本。 */
function runInstaller(repo, args) {
  const run = spawnSync(process.execPath, [join(repo, 'scripts', 'install-profile.mjs'), ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: childEnv({ XUANSHU_INSTALL_PROFILE_BIN: SCRIPT_UNDER_TEST }),
  })
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' }
}

/** 逐行 diff（本用例的改写都在行内，不增删行）。 */
function changedLines(before, after) {
  const a = before.split('\n')
  const b = after.split('\n')
  const changed = []
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) changed.push({ before: a[i], after: b[i] })
  }
  return changed
}

const sandbox = makeSandbox('install-profile-copy')

describe('install-profile · copy 模式：包进目标、锁文件可校验', () => {
  it('① 自有插件包被物化进目标（不再是 link: 到仓库），依赖树不带过去', () => {
    const { repo, home } = makeFixtureRepo(sandbox)
    const target = join(home, 'profiles', 'xuanshu')
    const run = runInstaller(repo, ['--home', home, '--copy', '--skip-install'])
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)

    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    expect(manifest.dependencies['xuanshu-host']).toBe('file:./packages/xuanshu-host')
    expect(manifest.dependencies['xuanshu-client']).toBe('file:./packages/xuanshu-client')
    // link: 的两种坏形态：绝对仓库路径 / link: 说明符，一个都不许有
    expect(JSON.stringify(manifest.dependencies)).not.toContain('link:')
    expect(JSON.stringify(manifest.dependencies)).not.toContain(REPO_ROOT)

    for (const [rel, sourceRel] of [
      ['packages/xuanshu-host/package.json', 'packages/xuanshu-host/package.json'],
      ['packages/xuanshu-host/index.js', 'packages/xuanshu-host/index.js'],
      ['packages/xuanshu-host/lib/note.md', 'packages/xuanshu-host/lib/note.md'],
      // 运行时依赖得跟着包一起进目标，`file:` 语义才有东西可装
      ['packages/xuanshu-host/vendor/xs-fixture-runtime/package.json', 'packages/xuanshu-host/vendor/xs-fixture-runtime/package.json'],
      ['packages/xuanshu-client/package.json', 'packages/xuanshu-client/package.json'],
    ]) {
      expect(existsSync(join(target, rel)), `${rel} 应当被复制进目标`).toBe(true)
      expect(readFileSync(join(target, rel)).equals(readFileSync(join(repo, sourceRel))), `${rel} 应与源逐字节一致`).toBe(true)
    }
    expect(existsSync(join(target, 'packages/xuanshu-host/node_modules')), '包自己的 node_modules 不是分发物').toBe(false)
  })

  it('② 锁文件一并复制，自有包路径改写成目标内相对路径，其余行一个不动', () => {
    const { repo, home } = makeFixtureRepo(sandbox)
    const target = join(home, 'profiles', 'xuanshu')
    expect(runInstaller(repo, ['--home', home, '--copy', '--skip-install']).status).toBe(0)

    const copied = readFileSync(join(target, 'pnpm-lock.yaml'), 'utf8')
    // 三种形态：importers 的 specifier / version、packages|snapshots 的键、resolution.directory
    expect(copied).toContain('specifier: file:./packages/xuanshu-host')
    expect(copied).toContain('version: file:packages/xuanshu-host')
    expect(copied).toContain('xuanshu-host@file:packages/xuanshu-host:')
    expect(copied).toContain('resolution: {directory: packages/xuanshu-host, type: directory}')
    // 包内的依赖（vendor/ 下的那几个）也要跟着改写，否则目标里解析不到
    expect(copied).toContain('resolution: {directory: packages/xuanshu-host/vendor/xs-fixture-runtime, type: directory}')
    expect(copied).not.toContain('../packages/')

    // 「只改自有包路径、其余字节不动」：改动行数 == 源里含自有包路径的行数，且每行都点到 packages/xuanshu-*
    const source = FIXTURE_LOCKFILE
    const ownLines = source.split('\n').filter((line) => line.includes('../packages/xuanshu-')).length
    const changed = changedLines(source, copied)
    expect(ownLines).toBeGreaterThan(0)
    expect(changed).toHaveLength(ownLines)
    for (const { after } of changed) expect(after).toContain('packages/xuanshu-')
  })

  it('③ 原有的复制意图不回归：patch / workspace 复制，cordis.yml 刻意不复制', () => {
    const { repo, home } = makeFixtureRepo(sandbox)
    const target = join(home, 'profiles', 'xuanshu')
    expect(runInstaller(repo, ['--home', home, '--copy', '--skip-install']).status).toBe(0)
    expect(readFileSync(join(target, 'cordis.patch.yml')).equals(readFileSync(join(repo, 'profile/cordis.patch.yml')))).toBe(true)
    expect(readFileSync(join(target, 'pnpm-workspace.yaml')).equals(readFileSync(join(repo, 'profile/pnpm-workspace.yaml')))).toBe(true)
    expect(existsSync(join(target, 'cordis.yml')), 'cordis.yml 是 DSH 运行期产物，带了会撞 duplicate-insert').toBe(false)
  })

  it('④ peer / optional 的口径：不往目标清单塞自有包的这两种依赖', () => {
    const { repo, home } = makeFixtureRepo(sandbox)
    const target = join(home, 'profiles', 'xuanshu')
    expect(runInstaller(repo, ['--home', home, '--copy', '--skip-install']).status).toBe(0)

    const source = JSON.parse(readFileSync(join(repo, 'profile/package.json'), 'utf8'))
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    // 改名后的清单：键集与源一致（只换了自有包的说明符），peer/optional 不搬进来
    expect(Object.keys(manifest.dependencies).sort()).toEqual(Object.keys(source.dependencies).sort())
    expect(JSON.stringify(manifest.dependencies)).not.toContain('xs-fixture-peer-absent')
    expect(JSON.stringify(manifest.dependencies)).not.toContain('xs-fixture-optional')
    // 而它们留在**包自己的** package.json 里（随包进目标，由 pnpm 按 file: 语义处置）
    const hostPkg = JSON.parse(readFileSync(join(target, 'packages/xuanshu-host/package.json'), 'utf8'))
    expect(hostPkg.dependencies['xs-fixture-runtime']).toBe('file:./vendor/xs-fixture-runtime')
    expect(hostPkg.optionalDependencies['xs-fixture-optional']).toBe('file:./vendor/xs-fixture-optional')
    expect(hostPkg.peerDependencies['xs-fixture-peer-absent']).toBe('*')
  })

  it('⑤ copy 可重入：第二次 --copy 不会被自己产出的 packages/ 当外来条目拒绝', () => {
    const { repo, home } = makeFixtureRepo(sandbox)
    const target = join(home, 'profiles', 'xuanshu')
    const first = runInstaller(repo, ['--home', home, '--copy', '--skip-install'])
    expect(first.status).toBe(0)
    expect(readdirSync(target)).toContain('packages')

    const second = runInstaller(repo, ['--home', home, '--copy', '--skip-install'])
    expect(second.status).toBe(0)
    expect(second.stderr).toBe('')
    expect(second.stdout).not.toContain('foreign entries')
    expect(readFileSync(join(target, 'packages/xuanshu-host/index.js'), 'utf8')).toContain('xs-fixture-runtime')
  })

  it('⑥ --force：带 packages/ 的旧 profile 骨架能被清掉（link 模式接管）', () => {
    const { repo, home } = makeFixtureRepo(sandbox)
    const target = join(home, 'profiles', 'xuanshu')
    // 模拟「copy --skip-install 留下的骨架」：dsh-profile-* 名字、没有 node_modules、带 packages/
    write(target, 'package.json', JSON_TEXT({ name: 'dsh-profile-xuanshu', private: true }))
    write(target, 'packages/xuanshu-host/stale.txt', 'old copy-mode artifact\n')

    const run = runInstaller(repo, ['--home', home, '--force', '--skip-install'])
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(lstatSync(target).isSymbolicLink(), 'link 模式应当把它换成指向 fixture profile 的联接').toBe(true)
    expect(realpathSync(target).toLowerCase()).toBe(realpathSync(join(repo, 'profile')).toLowerCase())
  })

  it('⑦ 锁文件里有目标内解析不到的 type:directory 时提前报错（不留给 pnpm 抛 ENOENT）', () => {
    const ghost = `${FIXTURE_LOCKFILE}\n  xuanshu-ghost@file:../packages/xuanshu-ghost:\n    resolution: {directory: ../packages/xuanshu-ghost, type: directory}\n`
    const { repo, home } = makeFixtureRepo(sandbox, { lockfile: ghost })
    const run = runInstaller(repo, ['--home', home, '--copy', '--skip-install'])
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('type:directory 路径在目标里不存在')
    expect(run.stderr).toContain('xuanshu-ghost')
  })

  it('⑧ 源 profile 没有锁文件时如实说明，而不是悄悄少一件', () => {
    const { repo, home } = makeFixtureRepo(sandbox, { lockfile: null })
    const run = runInstaller(repo, ['--home', home, '--copy', '--skip-install'])
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('源 profile 没有 pnpm-lock.yaml')
    expect(existsSync(join(home, 'profiles', 'xuanshu', 'pnpm-lock.yaml'))).toBe(false)
  })

  it('⑨ N2：`--force` 清骨架时，`packages` 本身是联接 → 只拆联接，联接目标里的真实文件一个不动', () => {
    // 复核 48e0e0a 的 N2 实测（`.scratch/review-48-standards/probe-install-junction.mjs`）：
    // `readdirSync` 跟随联接 ⇒「里面全是自有包名」这条守卫在**联接目标**上成立 ⇒ 递归删掉真实文件，
    // 安装器还 exit 0（哨兵 before=true → after=false）。根路径必须**先 lstat**。
    const { repo, home } = makeFixtureRepo(sandbox)
    const target = join(home, 'profiles', 'xuanshu')
    const outside = sandbox.dir('outside-original-packages')
    const sentinel = join(outside, 'xuanshu-host', 'valuable-source.txt')
    write(outside, 'xuanshu-host/valuable-source.txt', 'must survive any operation on a junction\n')
    write(outside, 'xuanshu-client/index.js', 'export default "outside"\n')

    // 可丢弃骨架：dsh-profile-* 名字 + 没有 node_modules + `packages` 是指向外面真实目录的联接
    write(target, 'package.json', JSON_TEXT({ name: 'dsh-profile-xuanshu', private: true }))
    symlinkSync(outside, join(target, 'packages'), process.platform === 'win32' ? 'junction' : 'dir')

    const run = runInstaller(repo, ['--home', home, '--force', '--skip-install'])
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(existsSync(sentinel), '联接目标里的真实文件被跟随删除了（N2 复发）').toBe(true)
    expect(readFileSync(sentinel, 'utf8')).toContain('must survive')
    expect(existsSync(join(outside, 'xuanshu-client/index.js'))).toBe(true)
    // 骨架本身照常被换成源 profile 联接（联接只是被拆掉，安装继续）
    expect(lstatSync(target).isSymbolicLink()).toBe(true)
    expect(realpathSync(target).toLowerCase()).toBe(realpathSync(join(repo, 'profile')).toLowerCase())
  })
})
