/**
 * #23 · 运行时状态文件：壳写、宿主读（冻结契约 §1）。
 *
 * 契约 §1 的形状（逐字）：
 *   `{schema:'xuanshu/shell-notify@1', url:'http://127.0.0.1:<port>', token:'<64 hex>',
 *     pid, startedAt, capabilities:{notification, clickToWindow}}`
 *
 * 三件必须成立的事：
 *   1. **落盘的文件就是宿主能读的那份** —— 这里直接 import 宿主的 `resolveNotifyTarget` 读回来对拍，
 *      而不是「壳自己写、壳自己读」自证；
 *   2. 原子写（同目录 tmp + rename），不留半份 JSON；`mode: 0o600` 尽力而为；
 *   3. 坏文件（被手改 / 半写 / URL 被换成外网）**读面判非法**，绝不拿去连。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { resolveNotifyTarget } from '../../packages/xuanshu-host/lib/notify/target.mjs'
import {
  buildNotifyState,
  isLoopbackUrl,
  readNotifyState,
  removeNotifyState,
  writeNotifyStateFile,
} from '../../packages/xuanshu-shell/lib/notify-state.mjs'
import { FAKE_TOKEN, makeScratch, notifyStatePath } from './lib/sandbox.mjs'

const scratch = []
const originalUmask = process.umask()
afterEach(() => {
  scratch.splice(0).forEach((box) => box.cleanup())
  process.umask(originalUmask)
})

function scene() {
  const box = makeScratch('shell-state')
  scratch.push(box)
  return box
}

const CAPS = { notification: true, clickToWindow: true }

describe('#23 · 状态文件：形状照契约 §1，宿主能原样读回', () => {
  it('写出的 JSON 键与值逐字对（schema 在最前、capabilities 原样）', () => {
    const box = scene()
    const file = notifyStatePath(box.dataDir)
    const written = writeNotifyStateFile(file, buildNotifyState({
      url: 'http://127.0.0.1:49831',
      token: FAKE_TOKEN,
      pid: 12345,
      startedAt: '2026-10-17T00:00:00.000Z',
      capabilities: CAPS,
    }))
    expect(written.state).toEqual({
      schema: 'xuanshu/shell-notify@1',
      url: 'http://127.0.0.1:49831',
      token: FAKE_TOKEN,
      pid: 12345,
      startedAt: '2026-10-17T00:00:00.000Z',
      capabilities: { notification: true, clickToWindow: true },
    })
    const raw = JSON.parse(box.read('runtime', 'shell-notify.json'))
    expect(Object.keys(raw)).toEqual(['schema', 'url', 'token', 'pid', 'startedAt', 'capabilities'])
    // 契约 §1 的 token 形状：64 hex。
    expect(raw.token).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('壳写 → **宿主的** resolveNotifyTarget 读回 {ok:true, url, token}', () => {
    const box = scene()
    const file = notifyStatePath(box.dataDir)
    writeNotifyStateFile(file, buildNotifyState({
      url: 'http://127.0.0.1:49831', token: FAKE_TOKEN, pid: 4242, capabilities: CAPS,
    }))
    const target = resolveNotifyTarget({ env: { XUANSHU_SHELL_NOTIFY_STATE: file } })
    expect(target).toEqual({ ok: true, url: 'http://127.0.0.1:49831', token: FAKE_TOKEN })
  })

  it('原子写：目录自动建、不残留 .tmp；POSIX 上 mode 是 0600（Windows 只要求不崩）', () => {
    const box = scene()
    const file = join(box.dataDir, 'runtime', 'deep', 'shell-notify.json')
    writeNotifyStateFile(file, buildNotifyState({
      url: 'http://127.0.0.1:49831', token: FAKE_TOKEN, pid: 1, capabilities: CAPS,
    }))
    const leftovers = readdirSync(join(box.dataDir, 'runtime', 'deep')).filter((name) => name.endsWith('.tmp'))
    expect(leftovers).toEqual([])
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600)
    } else {
      // Windows 的 chmod 只是只读位；这里只钉「写入没因为 chmod 失败而抛」。
      expect(() => chmodSync(file, 0o600)).not.toThrow()
    }
  })

  it('重写会覆盖成新状态（端口变了 / token 轮换）', () => {
    const box = scene()
    const file = notifyStatePath(box.dataDir)
    writeNotifyStateFile(file, buildNotifyState({
      url: 'http://127.0.0.1:1111', token: 'a'.repeat(64), pid: 1, capabilities: CAPS,
    }))
    writeNotifyStateFile(file, buildNotifyState({
      url: 'http://127.0.0.1:2222', token: 'b'.repeat(64), pid: 2, capabilities: CAPS,
    }))
    expect(readNotifyState(file)).toMatchObject({ ok: true, state: { url: 'http://127.0.0.1:2222', pid: 2 } })
  })
})

describe('#23 · 读面：坏文件判非法（绝不拿去连）', () => {
  it('文件不存在 → missing', () => {
    const box = scene()
    expect(readNotifyState(notifyStatePath(box.dataDir))).toMatchObject({ ok: false, reason: 'missing' })
  })

  it('半份 JSON / 非对象 / schema 不对 / 非回环 / 空 token → 各自可读的理由', () => {
    const cases = [
      ['{"schema":"xuanshu/shell-notify@1","url":', 'invalid-json'],
      ['[]', 'invalid-json'],
      ['null', 'invalid-json'],
      [JSON.stringify({ schema: 'xuanshu/shell-notify@0', url: 'http://127.0.0.1:1', token: 't' }), 'schema-mismatch'],
      [JSON.stringify({ schema: 'xuanshu/shell-notify@1', url: 'http://example.com:1', token: 't' }), 'not-loopback'],
      [JSON.stringify({ schema: 'xuanshu/shell-notify@1', url: 'https://127.0.0.1:1', token: 't' }), 'not-loopback'],
      [JSON.stringify({ schema: 'xuanshu/shell-notify@1', url: 'http://127.0.0.1:1', token: '' }), 'token-empty'],
      [JSON.stringify({ schema: 'xuanshu/shell-notify@1', url: 'http://192.168.1.2:1', token: 't' }), 'not-loopback'],
    ]
    for (const [text, reason] of cases) {
      const box = scene()
      box.write('runtime/shell-notify.json', text)
      const result = readNotifyState(notifyStatePath(box.dataDir))
      expect(result.ok, text).toBe(false)
      expect(result.reason, text).toBe(reason)
    }
  })

  it('isLoopbackUrl：只有 127.0.0.1 / localhost + 端口 + http 算回环', () => {
    for (const url of [
      'http://127.0.0.1:1',
      'http://localhost:65535',
      'http://127.0.0.1:49831/',
    ]) {
      expect(isLoopbackUrl(url), url).toBe(true)
    }
    for (const url of [
      'http://127.0.0.1',
      'https://127.0.0.1:1',
      'http://example.com:1',
      'http://192.168.1.2:1',
      'http://127.0.0.1:1/v1/notify',
      'ftp://127.0.0.1:1',
      '',
      null,
      undefined,
    ]) {
      expect(isLoopbackUrl(url), String(url)).toBe(false)
    }
  })

  it('removeNotifyState：干净退出后删掉（缺失时不抛）', () => {
    const box = scene()
    const file = notifyStatePath(box.dataDir)
    writeNotifyStateFile(file, buildNotifyState({
      url: 'http://127.0.0.1:1', token: FAKE_TOKEN, pid: 1, capabilities: CAPS,
    }))
    expect(removeNotifyState(file)).toBe(true)
    expect(readNotifyState(file).reason).toBe('missing')
    expect(removeNotifyState(file)).toBe(false)
  })

  it('buildNotifyState 拒绝坏 URL / 空 token / 坏 pid（写出去就是给宿主下毒）', () => {
    expect(() => buildNotifyState({ url: 'http://example.com:1', token: FAKE_TOKEN, pid: 1 })).toThrow(/回环/u)
    expect(() => buildNotifyState({ url: 'http://127.0.0.1:1', token: '', pid: 1 })).toThrow(/token/u)
    expect(() => buildNotifyState({ url: 'http://127.0.0.1:1', token: FAKE_TOKEN, pid: 0 })).toThrow(/pid/u)
  })
})
