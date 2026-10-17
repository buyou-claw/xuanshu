/**
 * #24 · 宿主侧通知发送（冻结契约 §3）——**假壳端点是真 `node:http` 端口**。
 *
 * 这一组钉三件事：
 *   1. `resolveNotifyTarget({ env })` 是**纯函数**：env 缺席 = 没有壳；状态文件缺失 / 形状不对 /
 *      非回环 URL / 空 token 都必须**判非法**（不许拿一个猜的地址去 POST）；
 *   2. `postNotify(payload, { timeoutMs })` **永不抛**：200 delivered / 200 delivered=false /
 *      400 / 401 / 连接拒绝 / 超时 / 非 JSON —— 全部折算成带可读 reason 的 `{ok:false}` 或
 *      `{ok:true, delivered:false, reason}`；
 *   3. 载荷字段集合与取值域**逐字**等于契约 §2 的 JSON（两侧夹测的公共断言）。
 *
 * 环境纪律：只打 `127.0.0.1` 上自己起的端口；不读 `.dsh-home`；不动 shell 包（#23 并行）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { postNotify, NOTIFY_SCHEMA } from '../../packages/xuanshu-host/lib/notify/send.mjs'
import { resolveNotifyTarget } from '../../packages/xuanshu-host/lib/notify/target.mjs'
import {
  FAKE_TOKEN, makeScratch, notifyStatePath, startFakeShell, writeNotifyStateFile,
} from './lib/sandbox.mjs'

const scratch = []
const shells = []
afterEach(async () => {
  scratch.splice(0).forEach((item) => item.cleanup())
  await Promise.all(shells.splice(0).map((shell) => shell.close()))
})

/** 造一份现场：一次性 dataDir + 可选假壳端点 + 指向它的 env。 */
async function scene({ shell = true, state = 'valid' } = {}) {
  const box = makeScratch('notify-send')
  scratch.push(box)
  let fake = null
  if (shell) {
    fake = await startFakeShell()
    shells.push(fake)
  }
  let env = {}
  if (state === 'valid' && fake !== null) {
    writeNotifyStateFile(box.dataDir, { url: fake.url, token: fake.token })
    env = { XUANSHU_SHELL_NOTIFY_STATE: notifyStatePath(box.dataDir) }
  } else if (state === 'missing') {
    env = { XUANSHU_SHELL_NOTIFY_STATE: notifyStatePath(box.dataDir) }
  } else if (state === 'invalid') {
    box.write('runtime/shell-notify.json', '{"schema":"xuanshu/shell-notify@0"}\n')
    env = { XUANSHU_SHELL_NOTIFY_STATE: notifyStatePath(box.dataDir) }
  }
  return { box, shell: fake, env }
}

/** 契约 §2 的请求体（宿主发的就是它）。 */
function payload(over = {}) {
  return {
    schema: NOTIFY_SCHEMA,
    id: 'notify-00000000-0000-4000-8000-000000000000',
    kind: 'rikke',
    title: '今日日课已生成',
    body: '',
    silent: false,
    target: 'overview',
    createdAt: '2026-10-17T00:00:00.000Z',
    ...over,
  }
}

/* ───────────────────────── 1. resolveNotifyTarget（纯函数） ───────────────────────── */

describe('#24 · resolveNotifyTarget：拿不到就如实说没有壳', () => {
  it('env 里没有状态文件路径 → no-shell（浏览器模式，不是故障）', () => {
    expect(resolveNotifyTarget({ env: {} })).toMatchObject({ ok: false, reason: 'no-shell' })
    expect(resolveNotifyTarget({})).toMatchObject({ ok: false, reason: 'no-shell' })
  })

  it('env 指了路径但文件不存在 → state-missing（壳没起来）', () => {
    const box = makeScratch('notify-target')
    scratch.push(box)
    const result = resolveNotifyTarget({ env: { XUANSHU_SHELL_NOTIFY_STATE: notifyStatePath(box.dataDir) } })
    expect(result).toMatchObject({ ok: false, reason: 'state-missing' })
    expect(String(result.detail)).toMatch(/shell-notify\.json/u)
  })

  it('状态文件合法 → 回 {ok:true, url, token}（URL 去掉尾部斜杠）', async () => {
    const target = await scene()
    expect(resolveNotifyTarget({ env: target.env })).toEqual({
      ok: true,
      url: target.shell.url,
      token: FAKE_TOKEN,
    })
  })

  it('schema 不认识 / 不是 JSON / token 为空 / URL 非回环 / 没有端口 → state-invalid（绝不拿去连）', async () => {
    const box = makeScratch('notify-target')
    scratch.push(box)
    const file = notifyStatePath(box.dataDir)
    const cases = [
      '{"schema":"xuanshu/shell-notify@0","url":"http://127.0.0.1:1234","token":"t"}',
      'not json at all',
      JSON.stringify({ schema: 'xuanshu/shell-notify@1', url: 'http://127.0.0.1:1234', token: '' }),
      JSON.stringify({ schema: 'xuanshu/shell-notify@1', url: 'http://example.com:1234', token: 't' }),
      JSON.stringify({ schema: 'xuanshu/shell-notify@1', url: 'https://127.0.0.1:1234', token: 't' }),
      JSON.stringify({ schema: 'xuanshu/shell-notify@1', url: 'http://127.0.0.1', token: 't' }),
      JSON.stringify({ schema: 'xuanshu/shell-notify@1', url: 'http://192.168.1.10:1234', token: 't' }),
    ]
    for (const text of cases) {
      box.write('runtime/shell-notify.json', text)
      expect(resolveNotifyTarget({ env: { XUANSHU_SHELL_NOTIFY_STATE: file } }), text).toMatchObject({
        ok: false,
        reason: 'state-invalid',
      })
    }
  })

  it('env 路径是空串 → 按「没有壳」处理（不是去读当前目录）', () => {
    expect(resolveNotifyTarget({ env: { XUANSHU_SHELL_NOTIFY_STATE: '   ' } })).toMatchObject({ ok: false, reason: 'no-shell' })
  })
})

/* ───────────────────────── 2. postNotify：契约形状（两侧夹测的公共断言） ───────────────────────── */

describe('#24 · postNotify：载荷逐字等于契约 §2', () => {
  it('POST {url}/v1/notify + Bearer token + content-type json；成功 → {ok:true, delivered:true}', async () => {
    const target = await scene()
    const result = await postNotify(payload(), { env: target.env })
    expect(result).toEqual({ ok: true, delivered: true })

    expect(target.shell.requests).toHaveLength(1)
    const [request] = target.shell.requests
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/v1/notify')
    expect(request.headers['content-type']).toBe('application/json')
    expect(request.headers.authorization).toBe(`Bearer ${FAKE_TOKEN}`)
    // 夹具就是契约 §2 的 JSON：字段集合与取值域逐字一致（多余字段不报错，至少这些必须在）。
    expect(request.json).toMatchObject({
      schema: 'xuanshu/notify@1',
      id: expect.any(String),
      kind: 'rikke',
      title: '今日日课已生成',
      body: '',
      silent: false,
      target: 'overview',
      createdAt: expect.any(String),
    })
    expect(request.json.id.length).toBeGreaterThan(0)
  })

  it('200 但 delivered:false → 如实带回壳给的理由（不伪装成推过了）', async () => {
    const box = makeScratch('notify-send')
    scratch.push(box)
    const fake = await startFakeShell((_request, respond) => {
      respond(200, { ok: true, delivered: false, reason: 'permission-denied', detail: '系统通知被关' })
    })
    shells.push(fake)
    writeNotifyStateFile(box.dataDir, { url: fake.url, token: fake.token })
    const result = await postNotify(payload(), { env: { XUANSHU_SHELL_NOTIFY_STATE: notifyStatePath(box.dataDir) } })
    expect(result).toEqual({ ok: true, delivered: false, reason: 'permission-denied' })
  })

  it('400 invalid-payload / 401 unauthorized → {ok:false, reason 可读}', async () => {
    const box = makeScratch('notify-send')
    scratch.push(box)
    let status = 400
    const fake = await startFakeShell((_request, respond) => {
      respond(status, status === 400
        ? { ok: false, error: { code: 'invalid-payload', message: 'title too long' } }
        : { ok: false, error: { code: 'unauthorized' } })
    })
    shells.push(fake)
    writeNotifyStateFile(box.dataDir, { url: fake.url, token: fake.token })
    const env = { XUANSHU_SHELL_NOTIFY_STATE: notifyStatePath(box.dataDir) }

    const bad = await postNotify(payload(), { env })
    expect(bad.ok).toBe(false)
    expect(bad.reason).toMatch(/400/u)
    expect(bad.reason).toMatch(/invalid-payload/u)

    status = 401
    const unauthorized = await postNotify(payload(), { env })
    expect(unauthorized.ok).toBe(false)
    expect(unauthorized.reason).toMatch(/401/u)
  })

  it('200 但不是 JSON → {ok:false}，不抛', async () => {
    const box = makeScratch('notify-send')
    scratch.push(box)
    const fake = await startFakeShell((_request, respond) => respond(200, 'ok'))
    shells.push(fake)
    writeNotifyStateFile(box.dataDir, { url: fake.url, token: fake.token })
    const result = await postNotify(payload(), { env: { XUANSHU_SHELL_NOTIFY_STATE: notifyStatePath(box.dataDir) } })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/JSON/u)
  })
})

/* ───────────────────────── 3. 失败路径：永不抛、可读 reason ───────────────────────── */

describe('#24 · postNotify：连接拒绝 / 超时 / 没有壳 —— 全部永不抛', () => {
  it('连接拒绝（端口关了）→ {ok:false, reason 可读}', async () => {
    const box = makeScratch('notify-send')
    scratch.push(box)
    const fake = await startFakeShell()
    const url = fake.url
    await fake.close() // 端点已关闭，但状态文件还指着它（壳退出后可留着，契约 §1）
    writeNotifyStateFile(box.dataDir, { url, token: FAKE_TOKEN })
    const result = await postNotify(payload(), { env: { XUANSHU_SHELL_NOTIFY_STATE: notifyStatePath(box.dataDir) } })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/连不上|连接/u)
  })

  it('壳不回话 → 超时（timeoutMs 可注入）→ {ok:false, reason 含超时}，且不会挂住测试', async () => {
    const box = makeScratch('notify-send')
    scratch.push(box)
    const fake = await startFakeShell(() => {
      /* 故意不回：让客户端等到超时 */
    })
    shells.push(fake)
    writeNotifyStateFile(box.dataDir, { url: fake.url, token: fake.token })
    const startedAt = Date.now()
    const result = await postNotify(payload(), {
      env: { XUANSHU_SHELL_NOTIFY_STATE: notifyStatePath(box.dataDir) },
      timeoutMs: 150,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/超时/u)
    expect(Date.now() - startedAt).toBeLessThan(2000)
  })

  it('没有壳（env 缺席）→ {ok:false, reason: no-shell}，一个请求都不发', async () => {
    const target = await scene()
    const result = await postNotify(payload(), { env: {} })
    expect(result).toEqual({ ok: false, reason: 'no-shell' })
    expect(target.shell.requests).toEqual([])
  })

  it('载荷不合契约（kind 不认识 / title 为空 / schema 不对）→ 本地拒发，不连壳', async () => {
    const target = await scene()
    for (const bad of [
      payload({ kind: 'unknown' }),
      payload({ title: '' }),
      payload({ schema: 'xuanshu/notify@0' }),
      payload({ target: 'somewhere' }),
      payload({ title: 'x'.repeat(121) }),
    ]) {
      const result = await postNotify(bad, { env: target.env })
      expect(result.ok).toBe(false)
      expect(result.reason).toMatch(/载荷|invalid/u)
    }
    expect(target.shell.requests).toEqual([])
  })
})
