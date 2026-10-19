/**
 * 票 30（#30）· `data.*` 的**装配接线**：`apply()` 真的把两个方法挂进 `/xuanshu` 通道。
 *
 * 为什么单独一条：`tests/data/*.test.mjs` 直接 import `createDataMethods`，它们证明方法本身对，
 * 但证明不了「宿主把它们接上了」。接线漏掉时的形状是**静默的**：界面点开数据页只会报
 * 「未知玄枢操作」——这条用例把它变成一条会红的断言。
 *
 * 形态照 `tests/isolation/home.test.mjs` 的宿主 ctx 替身：真 `apply()` + 假 ctx + 显式 dataDir，
 * 不启动 horosa（`autoStart:false`）、不装 profile、不联网。
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { apply as applyHost } from '../../packages/xuanshu-host/lib/index.js'

/**
 * 宿主的 ctx 替身：只实现 `apply()` 会碰的那几样；把 RPC 路由抓下来。
 * @param {{home: string}} profileContext - 假的 profileContext（只给 home）。
 */
function makeRpcHost(profileContext) {
  const routes = new Map()
  const warns = []
  const connected = {
    connection: {
      rpc: {
        handle(channel, handler) {
          routes.set(channel, handler)
          return () => {}
        },
      },
    },
    effect(callback) {
      callback()
      return () => {}
    },
  }
  const ctx = {
    get(name) {
      if (name === 'profileContext') return profileContext
      return undefined
    },
    logger() {
      return { info() {}, warn(...args) { warns.push(args.map((arg) => String(arg)).join(' ')) }, error() {} }
    },
    effect(callback) {
      callback()
      return () => {}
    },
    provide() {
      return () => {}
    },
    commands: { register: () => () => {} },
    // 只有 RPC 那条注入要回调；`schedule` 等「依赖未就绪」的一律不回调（避免异步噪声）。
    inject(names, callback) {
      if (Array.isArray(names) && names.includes('connection')) callback(connected)
      return () => {}
    },
  }
  return { ctx, routes, warns }
}

/** 一个永不中止的 AbortSignal 替身（`installRpc` 会问 `signal.aborted` / `throwIfAborted`）。 */
const signal = { aborted: false, throwIfAborted() {} }

describe('票 30 · data.overview / data.backup 经 apply() 挂进 /xuanshu', () => {
  let root
  let home
  let dataDir
  let routes
  let warns

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'xs-data-wiring-'))
    home = join(root, 'home')
    dataDir = join(home, 'xuanshu')
    await mkdir(join(dataDir, 'pus'), { recursive: true })
    await writeFile(join(dataDir, 'pus', 'me.md'), '谱的正文', 'utf8')
    const host = makeRpcHost({ name: 'xuanshu', home })
    routes = host.routes
    warns = host.warns
    applyHost(host.ctx, { dataDir, autoStart: false })
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('apply 后 /xuanshu 通道上有 data.overview，返回 8 组体积', async () => {
    const handler = routes.get('/api/xuanshu')
    expect(handler, `没有注册 /xuanshu 通道（warns: ${warns.join(' / ')}）`).toBeTypeOf('function')
    const answer = await handler('data.overview', {}, signal)
    expect(answer.ok, JSON.stringify(answer.error ?? {})).toBe(true)
    expect(answer.value.schema).toBe('xuanshu/data@1')
    expect(answer.value.groups).toHaveLength(8)
    expect(answer.value.dataDir).toBe(dataDir)
    expect(answer.value.home).toBe(home)
    expect(answer.value.groups.find((group) => group.id === 'pu')).toMatchObject({ bytes: Buffer.byteLength('谱的正文', 'utf8'), files: 1 })
  })

  it('data.backup 也在同一通道上：拒收目标在 home 内的请求（可读原因，不 500）', async () => {
    const handler = routes.get('/api/xuanshu')
    const answer = await handler('data.backup', { targetDir: home, confirmed: true }, signal)
    expect(answer.ok).toBe(true) // RPC 层成功：业务失败在 value 里（{ok:false,error}）
    expect(answer.value.ok).toBe(false)
    expect(answer.value.error.code).toBe('target-inside-home')
    expect(answer.value.error.message).toMatch(/home/)
  })
})
