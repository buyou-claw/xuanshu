/**
 * #23 · 子进程入口 / 参数 / 环境（冻结契约 §0）。
 *
 * 契约 §0 逐字：
 *   - 命令：`node <profile 里的 dsh/bin.js> --profile xuanshu --port 19388 --no-open`
 *   - 入口解析顺序：`XUANSHU_DSH_BIN` > `<home>/profiles/xuanshu/node_modules/@deepseek-ai/dsh/lib/bin.js` > PATH `dsh`
 *   - 子进程 env 至少包含：`DSH_HOME=<home>`、`XUANSHU_DSH_HOME=<home>`、
 *     `XUANSHU_SHELL_NOTIFY_STATE=<home>/xuanshu/runtime/shell-notify.json`、`XUANSHU_SHELL_PID=<壳 pid>`，其余继承
 *
 * 这些是「壳与 DSH 之间唯一容易悄悄错」的地方：端口写错会撞 desktop 的 19387，env 少一个
 * `DSH_HOME` 会让子进程去读真实 `~/.dsh`（隔离直接破功）。所以全部逐字断言，不 mock 掉参数拼装。
 */
import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'

import { DEFAULT_PROFILE, DEFAULT_WEB_PORT } from '../../packages/xuanshu-shell/lib/contract.mjs'
import {
  buildChildEnv,
  buildDshInvocation,
  findExecutableOnPath,
  resolveDshEntry,
} from '../../packages/xuanshu-shell/lib/dsh-entry.mjs'

const HOME = resolve('C:/fake-home/.xuanshu')

/** 一个只认识给定路径的 existsSync。 */
function fakeExists(paths) {
  const set = new Set(paths.map((path) => resolve(path).toLowerCase()))
  return (candidate) => set.has(resolve(String(candidate)).toLowerCase())
}

const PROFILE_BIN = join(HOME, 'profiles', 'xuanshu', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

describe('#23 · resolveDshEntry：入口解析顺序（env > profile > PATH）', () => {
  it('XUANSHU_DSH_BIN 最高优先（即使 profile 里也有）', () => {
    const explicit = resolve('C:/tools/dsh/lib/bin.js')
    const entry = resolveDshEntry({
      home: HOME,
      env: { XUANSHU_DSH_BIN: explicit },
      fsExists: fakeExists([PROFILE_BIN, explicit]),
      pathLookup: () => 'C:/should-not-be-used/dsh.cmd',
    })
    expect(entry).toMatchObject({ ok: true, source: 'env', binJs: explicit })
  })

  it('XUANSHU_DSH_BIN 指了但文件不存在 → 如实报错，**不静默退回**别的入口', () => {
    const entry = resolveDshEntry({
      home: HOME,
      env: { XUANSHU_DSH_BIN: 'C:/nope/bin.js' },
      fsExists: fakeExists([PROFILE_BIN]),
      pathLookup: () => 'C:/dsh.cmd',
    })
    expect(entry.ok).toBe(false)
    expect(entry.reason).toBe('env-missing')
    expect(entry.detail).toMatch(/XUANSHU_DSH_BIN/u)
  })

  it('其次用 profile 树里的 dsh（完全按契约拼路径）', () => {
    const entry = resolveDshEntry({
      home: HOME,
      env: {},
      fsExists: fakeExists([PROFILE_BIN]),
      pathLookup: () => 'C:/dsh.cmd',
    })
    expect(entry).toMatchObject({ ok: true, source: 'profile', binJs: PROFILE_BIN })
  })

  it('都没有时退回 PATH 的 dsh（并明确来源）', () => {
    const shim = 'C:/Users/me/AppData/Roaming/npm/dsh.cmd'
    const entry = resolveDshEntry({
      home: HOME,
      env: {},
      fsExists: fakeExists([]),
      pathLookup: () => shim,
    })
    expect(entry).toMatchObject({ ok: true, source: 'path', executable: shim })
    expect(entry.binJs).toBeUndefined()
  })

  it('三处都没有 → not-found（壳如实显示服务未就绪，不猜）', () => {
    const entry = resolveDshEntry({ home: HOME, env: {}, fsExists: fakeExists([]), pathLookup: () => undefined })
    expect(entry).toMatchObject({ ok: false, reason: 'not-found' })
    expect(entry.detail).toMatch(/dsh/u)
  })
})

describe('#23 · buildDshInvocation：命令与参数逐字照契约 §0', () => {
  const base = { profile: DEFAULT_PROFILE, port: DEFAULT_WEB_PORT }

  it('node 形态：node <bin.js> --profile xuanshu --port 19388 --no-open', () => {
    const invocation = buildDshInvocation({
      entry: { ok: true, source: 'profile', binJs: PROFILE_BIN },
      ...base,
      nodeBin: 'node',
    })
    expect(invocation.command).toBe('node')
    expect(invocation.args).toEqual([
      PROFILE_BIN, '--profile', 'xuanshu', '--port', '19388', '--no-open',
    ])
    expect(invocation.display).toContain('--no-open')
  })

  it('XUANSHU_NODE_BIN 覆盖 node 可执行文件（壳自己不把 Electron 当 node）', () => {
    const invocation = buildDshInvocation({
      entry: { ok: true, source: 'profile', binJs: PROFILE_BIN },
      ...base,
      nodeBin: 'C:/nodejs/node.exe',
    })
    expect(invocation.command).toBe('C:/nodejs/node.exe')
  })

  it('默认端口常量 = 19388（契约 §0；19387 是 desktop 的，永不使用）', () => {
    expect(DEFAULT_WEB_PORT).toBe(19388)
    const invocation = buildDshInvocation({
      entry: { ok: true, source: 'profile', binJs: PROFILE_BIN },
      ...base,
      nodeBin: 'node',
    })
    expect(invocation.args[invocation.args.indexOf('--port') + 1]).toBe('19388')
  })

  it('PATH 上的 .cmd shim（Windows）→ 经 cmd.exe /d /s /c 调起，不假装能直接 spawn', () => {
    const shim = 'C:/Users/me/AppData/Roaming/npm/dsh.cmd'
    const invocation = buildDshInvocation({
      entry: { ok: true, source: 'path', executable: shim },
      ...base,
      platform: 'win32',
      comspec: 'C:/Windows/System32/cmd.exe',
    })
    expect(invocation.command).toBe('C:/Windows/System32/cmd.exe')
    expect(invocation.windowsVerbatimArguments).toBe(true)
    expect(invocation.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(invocation.args[3]).toBe(`""${shim}" --profile xuanshu --port 19388 --no-open"`)
  })

  it('PATH 上的可执行文件（非 Windows / .exe / 无扩展名）→ 直接 spawn', () => {
    for (const [platform, executable] of [
      ['linux', '/usr/local/bin/dsh'],
      ['win32', 'C:/tools/dsh.exe'],
    ]) {
      const invocation = buildDshInvocation({
        entry: { ok: true, source: 'path', executable },
        ...base,
        platform,
      })
      expect(invocation.command, platform).toBe(executable)
      expect(invocation.args, platform).toEqual(['--profile', 'xuanshu', '--port', '19388', '--no-open'])
    }
  })

  it('非法端口 / 空 profile 直接抛（不把坏参数交给子进程）', () => {
    const entry = { ok: true, source: 'profile', binJs: PROFILE_BIN }
    expect(() => buildDshInvocation({ entry, profile: DEFAULT_PROFILE, port: 0, nodeBin: 'node' })).toThrow(/port/u)
    expect(() => buildDshInvocation({ entry, profile: '', port: 19388, nodeBin: 'node' })).toThrow(/profile/u)
    expect(() => buildDshInvocation({ entry: { ok: false, reason: 'not-found' }, ...base, nodeBin: 'node' })).toThrow(/not-found/u)
  })
})

describe('#23 · buildChildEnv：契约 §0 的四个变量，其余继承', () => {
  it('写全 4 个变量并覆盖继承来的同名值', () => {
    const env = buildChildEnv({
      home: HOME,
      shellPid: 4242,
      baseEnv: {
        PATH: 'C:/Windows',
        DSH_HOME: 'C:/Users/me/.dsh',
        XUANSHU_DSH_HOME: 'C:/wrong',
        KEEP_ME: 'yes',
      },
    })
    expect(env).toMatchObject({
      DSH_HOME: HOME,
      XUANSHU_DSH_HOME: HOME,
      XUANSHU_SHELL_NOTIFY_STATE: join(HOME, 'xuanshu', 'runtime', 'shell-notify.json'),
      XUANSHU_SHELL_PID: '4242',
      PATH: 'C:/Windows',
      KEEP_ME: 'yes',
    })
    // 不许顺手塞一堆壳自己的变量：只加契约点名的四个。
    const added = Object.keys(env).filter((key) => !['PATH', 'DSH_HOME', 'XUANSHU_DSH_HOME', 'KEEP_ME'].includes(key))
    expect(added.sort()).toEqual(['XUANSHU_SHELL_NOTIFY_STATE', 'XUANSHU_SHELL_PID'])
  })

  it('绝不把 DSH_HOME 留成真实 ~/.dsh（调用方传错 home 时也由这里兜住覆盖）', () => {
    const env = buildChildEnv({ home: HOME, shellPid: 1, baseEnv: { DSH_HOME: 'C:/Users/me/.dsh' } })
    expect(env.DSH_HOME).toBe(HOME)
    expect(env.DSH_HOME).not.toMatch(/\.dsh$/u)
  })

  it('home 为空 → 抛（宁可不启动，也不给子进程一个空 home）', () => {
    expect(() => buildChildEnv({ home: '', shellPid: 1, baseEnv: {} })).toThrow(/home/u)
  })
})

describe('#23 · findExecutableOnPath：只认真实可执行文件', () => {
  it('Windows：按 PATHEXT 顺序找 dsh.cmd / dsh.exe / dsh', () => {
    const env = { PATH: 'C:/a;C:/b', PATHEXT: '.COM;.EXE;.BAT;.CMD' }
    const lookup = findExecutableOnPath('dsh', {
      env,
      platform: 'win32',
      fsExists: fakeExists(['C:/b/dsh.cmd']),
    })
    expect(lookup).toBe(join('C:/b', 'dsh.cmd'))
  })

  it('POSIX：直接找无扩展名的 dsh；空 PATH 项跳过', () => {
    const lookup = findExecutableOnPath('dsh', {
      env: { PATH: '::/opt/bin' },
      platform: 'linux',
      fsExists: fakeExists(['/opt/bin/dsh']),
    })
    // 断言的是「拼出来的落点」，不写死分隔符（同一份代码在 CI 的 Linux 上跑时 join 是 '/'）。
    expect(lookup).toBe(join('/opt/bin', 'dsh'))
  })

  it('找不到 → undefined', () => {
    expect(findExecutableOnPath('dsh', { env: { PATH: 'C:/a' }, platform: 'win32', fsExists: () => false })).toBeUndefined()
  })
})
