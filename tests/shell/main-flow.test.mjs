/**
 * S3（复核 2026-10-17）· 壳入口里**真正的判断**必须有测试。
 *
 * 复核发现 `main.mjs` 的文件头声称「只有接线、几乎没有逻辑、都被测试覆盖」，而它实际包含三块
 * 没被测过的判断：
 *   - 导出的 `parseShellArgs`（参数解析）；
 *   - 状态页 / 首页之间的 phase 改写（`view()`）；
 *   - 参数错误时 `adapter.app.exit(1)` 之后**仍然继续初始化**（IIFE 返回兜底值，后面的
 *     `bootstrapSingleInstance` / `bootstrap()` 照跑）—— 早期退出没有真的停住。
 *
 * 现在这三块都在 `main-flow.mjs`（纯模块），`main.mjs` 只把适配器接进来。本文件钉住的是判据：
 *   - 参数解析的每一个分支（含非法端口 / 未知开关 / `--` 透传）；
 *   - **早期退出路径真的不启动任何东西**（`start` 零调用、`exit(1)` 一次、错误框一次）；
 *   - phase / view 的改写与「什么时候该加载 URL」。
 */
import { describe, expect, it } from 'vitest'

import {
  OVERVIEW_HASH,
  createNotificationClickHandler,
  nextSupervisorLoad,
  overviewUrlWithHash,
  parseShellArgs,
  planStartup,
  shellStatusViewInput,
  startShell,
} from '../../packages/xuanshu-shell/lib/main-flow.mjs'

describe('S3 · 参数解析（原来在 main.mjs 里没有测试）', () => {
  it('空参数 → 三档全空（走环境变量与默认值）', () => {
    expect(parseShellArgs([])).toEqual({ home: undefined, profile: undefined, port: undefined })
  })

  it('--home / --profile / --port 逐项解析；--port 必须是 1..65535 的整数', () => {
    expect(parseShellArgs(['--home', 'D:\\h', '--profile', 'xuanshu-dev', '--port', '19399'])).toEqual({
      home: 'D:\\h',
      profile: 'xuanshu-dev',
      port: 19399,
    })
  })

  it('`--` 本身忽略（electron 会把分隔符原样带进来）', () => {
    expect(parseShellArgs(['--', '--home', 'D:\\h'])).toEqual({ home: 'D:\\h', profile: undefined, port: undefined })
  })

  it('非法端口（0 / 70000 / 非数字）→ 抛可读错误', () => {
    for (const value of ['0', '70000', 'abc', '19388.5']) {
      expect(() => parseShellArgs(['--port', value]), value).toThrow(/--port/)
    }
  })

  it('未知开关 → 抛可读错误（不静默忽略）', () => {
    expect(() => parseShellArgs(['--nope'])).toThrow(/未知的壳参数/u)
    expect(() => parseShellArgs(['-x'])).toThrow(/未知的壳参数/u)
  })
})

describe('S3 · 启动计划：参数错误是一条「不启动」的结果，不是一个继续跑的分支', () => {
  it('合法参数 → ok，profile / webPort 落定（--profile > 环境变量 > 默认）', () => {
    expect(planStartup(['--home', 'D:\\h', '--port', '19400'], { XUANSHU_PROFILE: 'from-env' })).toEqual({
      ok: true,
      options: { home: 'D:\\h', profile: undefined, port: 19400 },
      profile: 'from-env',
      webPort: 19400,
    })
    expect(planStartup([], {}).profile).toBe('xuanshu')
    expect(planStartup([], {}).webPort).toBe(19388)
  })

  it('非法参数 → {ok:false, message}（调用方据此错误框 + exit，而不是继续 bootstrap）', () => {
    const bad = planStartup(['--port', 'nope'], {})
    expect(bad.ok).toBe(false)
    expect(bad.message).toContain('--port')
    const unknown = planStartup(['--bogus'], {})
    expect(unknown.ok).toBe(false)
    expect(unknown.message).toContain('--bogus')
  })
})

describe('S3 · 早期退出路径：exit(1) 之后**没有**任何初始化', () => {
  it('参数非法 → 错误框一次、exit(1) 一次、start 零调用', () => {
    const calls = []
    const result = startShell({
      plan: { ok: false, message: '未知的壳参数：--bogus' },
      showErrorBox: (title, content) => calls.push(['error', title, content]),
      exit: (code) => calls.push(['exit', code]),
      start: (plan) => calls.push(['start', plan]),
    })
    expect(result).toEqual({ started: false })
    expect(calls).toEqual([
      ['error', '玄枢启动失败', '未知的壳参数：--bogus'],
      ['exit', 1],
    ])
    expect(calls.some((call) => call[0] === 'start')).toBe(false)
  })

  it('参数合法 → 不错误框、不 exit，start 收到计划', () => {
    const calls = []
    const plan = { ok: true, options: { home: 'D:\\h' }, profile: 'xuanshu', webPort: 19388 }
    const result = startShell({
      plan,
      showErrorBox: (title, content) => calls.push(['error', title, content]),
      exit: (code) => calls.push(['exit', code]),
      start: (value) => calls.push(['start', value]),
    })
    expect(result).toEqual({ started: true })
    expect(calls).toEqual([['start', plan]])
  })
})

describe('S3 · view / phase 改写：窗口层失败不改写看护状态', () => {
  const base = {
    supervisor: { phase: 'ready', url: 'http://127.0.0.1:19388' },
    autostart: { method: 'shortcut', enabled: true, label: '启动文件夹快捷方式' },
    notification: { supported: true },
  }

  it('没有 windowError → 原样交给状态页视图模型', () => {
    expect(shellStatusViewInput(base)).toEqual({
      supervisorState: base.supervisor,
      autostart: base.autostart,
      notification: base.notification,
    })
  })

  it('有 windowError → 只把窗口那一层标成 failed，看护状态不被篡改', () => {
    const input = shellStatusViewInput({ ...base, windowError: '加载玄枢首页失败：ECONNREFUSED' })
    expect(input.supervisorState).toEqual({ phase: 'failed', detail: '加载玄枢首页失败：ECONNREFUSED' })
    expect(input.autostart).toBe(base.autostart)
    expect(input.notification).toBe(base.notification)
    // 原对象不被就地改写（纯函数）。
    expect(base.supervisor.phase).toBe('ready')
  })
})

describe('S3 · 什么时候加载 URL / 什么时候留在状态页', () => {
  it('phase=ready 且 URL 变了 → load；同一个 URL → keep（不重复加载）', () => {
    const supervisor = { phase: 'ready', url: 'http://127.0.0.1:19388' }
    expect(nextSupervisorLoad({ supervisor, lastLoadedUrl: undefined })).toEqual({
      kind: 'load',
      url: 'http://127.0.0.1:19388',
    })
    expect(nextSupervisorLoad({ supervisor, lastLoadedUrl: 'http://127.0.0.1:19388' })).toEqual({
      kind: 'keep',
      url: 'http://127.0.0.1:19388',
    })
  })

  it('没就绪 / ready 但没有 URL → status（不加载猜的地址）', () => {
    for (const supervisor of [
      { phase: 'starting' },
      { phase: 'restarting', attempt: 2 },
      { phase: 'failed', detail: '认证失败' },
      { phase: 'ready' },
      { phase: 'ready', url: '' },
      undefined,
    ]) {
      expect(nextSupervisorLoad({ supervisor, lastLoadedUrl: 'http://127.0.0.1:19388' }), JSON.stringify(supervisor))
        .toEqual({ kind: 'status' })
    }
  })
})

describe('P2（复核 #24）· 点通知：唤出窗口 + 把页面带到 overview', () => {
  it('overviewUrlWithHash：http(s) 地址追加 hash（已有 hash 就替换）；data: / 空值不深链', () => {
    expect(OVERVIEW_HASH).toBe('xuanshu-overview')
    expect(overviewUrlWithHash('http://127.0.0.1:19388')).toBe('http://127.0.0.1:19388/#xuanshu-overview')
    expect(overviewUrlWithHash('http://127.0.0.1:19388/?x=1#old')).toBe('http://127.0.0.1:19388/?x=1#xuanshu-overview')
    expect(overviewUrlWithHash('data:text/html,<p>状态页</p>')).toBeUndefined()
    expect(overviewUrlWithHash('')).toBeUndefined()
    expect(overviewUrlWithHash(undefined)).toBeUndefined()
  })

  it('点击处理器先唤出窗口再导航（两个动作都真的被调；target=consult 也落到 overview —— 无深链，文档写明）', () => {
    for (const target of ['overview', 'consult']) {
      const calls = []
      const handler = createNotificationClickHandler({
        showWindow: () => calls.push('show'),
        navigateToOverview: () => calls.push('overview'),
      })
      handler({ target })
      expect(calls, target).toEqual(['show', 'overview'])
    }
  })
})
