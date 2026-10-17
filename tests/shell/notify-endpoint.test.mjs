/**
 * #23 · 通知端点：壳侧收端（冻结契约 §2）。
 *
 * 这一组**真起一个 `node:http` 服务器**（只绑 127.0.0.1 的 OS 分配端口），用真 HTTP 请求收发 ——
 * 契约 §6 要求「真起回环端点收发」，不允许 mock 掉 http。展示层是注入的假适配器，
 * 所以测试里没有真实 Electron 窗口、没有真实系统通知。
 *
 * 钉住的东西（逐条对着契约 §2）：
 *   - `POST /v1/notify` + `authorization: Bearer <token>` + `content-type: application/json`；
 *   - 200 `{ok:true,delivered:true}`；200 `{ok:true,delivered:false,reason}`（unsupported /
 *     permission-denied / failed，即使没弹出来也是 HTTP 200）；
 *   - 非法载荷 400 `{ok:false,error:{code:'invalid-payload'}}`；token 不对 401 `{code:'unauthorized'}`；
 *     其它路径 404；
 *   - 点击 → 壳唤出窗口（注入的 `onNotificationClick`），`target` 只是建议、做深链时如实说明；
 *   - `delivered` 语义 = 「构造并 show() 没抛」，不是「用户看到了」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from 'node:http'

import { createNotifyServer } from '../../packages/xuanshu-shell/lib/notify-server.mjs'
import { FAKE_TOKEN, notifyPayload } from './lib/sandbox.mjs'

const servers = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

/** 起一台壳的通知端点（假展示适配器）。 */
async function scene({ handle } = {}) {
  const showNotification = vi.fn(handle ?? (() => ({ shown: true })))
  const onNotificationClick = vi.fn()
  const server = createNotifyServer({
    token: FAKE_TOKEN,
    showNotification,
    onNotificationClick,
    capabilities: { notification: true, clickToWindow: true },
  })
  servers.push(server)
  const { url, port } = await server.listen()
  return { server, showNotification, onNotificationClick, url, port }
}

/** 发一条真 HTTP 请求；返回 `{status, headers, json}`。 */
function send(url, { method = 'POST', token = FAKE_TOKEN, body, path = '/v1/notify', rawBody } = {}) {
  return new Promise((resolve, reject) => {
    const payload = rawBody ?? JSON.stringify(body ?? {})
    const req = request(`${url}${path}`, {
      method,
      agent: false,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
    }, (res) => {
      const chunks = []
      res.setEncoding('utf8')
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = chunks.join('')
        let json = null
        try {
          json = JSON.parse(text)
        } catch {
          json = null
        }
        resolve({ status: res.statusCode, headers: res.headers, json, text })
      })
    })
    req.on('error', reject)
    req.end(payload)
  })
}

describe('#23 · 端点成功面：200 + 交付语义如实', () => {
  it('合法载荷 → 200 {ok:true,delivered:true}，展示适配器拿到**归一后**的载荷', async () => {
    const { server, showNotification, url } = await scene()
    const response = await send(url, { body: notifyPayload() })
    expect(response.status).toBe(200)
    expect(response.json).toEqual({ ok: true, delivered: true })

    expect(showNotification).toHaveBeenCalledTimes(1)
    const [payload] = showNotification.mock.calls[0]
    expect(payload).toEqual({
      schema: 'xuanshu/notify@1',
      id: 'notify-00000000-0000-4000-8000-000000000000',
      kind: 'rikke',
      title: '今日日课已生成',
      body: '',
      silent: false,
      target: 'overview',
      createdAt: '2026-10-17T00:00:00.000Z',
    })
    // 端点只绑回环（契约 §2 最后一条）。
    expect(server.address).toMatchObject({ address: '127.0.0.1' })
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)
  })

  it('多余字段忽略、不报错（契约 §2）', async () => {
    const { showNotification, url } = await scene()
    const response = await send(url, { body: notifyPayload({ extra: { nested: true }, body: '一句短话' }) })
    expect(response.status).toBe(200)
    expect(showNotification.mock.calls[0][0].body).toBe('一句短话')
    expect(showNotification.mock.calls[0][0].extra).toBeUndefined()
  })

  it('晚省：kind=wansheng / target=consult 同样接收', async () => {
    const { showNotification, url } = await scene()
    const response = await send(url, {
      body: notifyPayload({ kind: 'wansheng', target: 'consult', title: '今天要不要过一遍' }),
    })
    expect(response.status).toBe(200)
    expect(showNotification.mock.calls[0][0]).toMatchObject({ kind: 'wansheng', target: 'consult' })
  })
})

describe('#23 · 端点拒绝面：400 / 401 / 404 / 405', () => {
  it('token 不对 / 缺失 → 401 unauthorized，展示适配器一次都不调', async () => {
    const { showNotification, url } = await scene()
    for (const token of ['b'.repeat(64), null]) {
      const response = await send(url, { body: notifyPayload(), token })
      expect(response.status, String(token)).toBe(401)
      expect(response.json).toEqual({ ok: false, error: { code: 'unauthorized' } })
    }
    expect(showNotification).not.toHaveBeenCalled()
  })

  it('非法载荷矩阵 → 400 invalid-payload（带可读 message），不调展示适配器', async () => {
    const { showNotification, url } = await scene()
    const cases = [
      notifyPayload({ schema: 'xuanshu/notify@0' }),
      notifyPayload({ id: '' }),
      notifyPayload({ kind: 'unknown' }),
      notifyPayload({ title: '' }),
      notifyPayload({ title: 'x'.repeat(121) }),
      notifyPayload({ body: 'y'.repeat(201) }),
      notifyPayload({ silent: 'no' }),
      notifyPayload({ target: 'somewhere' }),
      notifyPayload({ createdAt: 'yesterday' }),
      {},
    ]
    for (const body of cases) {
      const response = await send(url, { body })
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(response.json.ok, JSON.stringify(body)).toBe(false)
      expect(response.json.error.code).toBe('invalid-payload')
      expect(typeof response.json.error.message).toBe('string')
      expect(response.json.error.message.length).toBeGreaterThan(0)
    }
    expect(showNotification).not.toHaveBeenCalled()
  })

  it('body 不是 JSON / 空 body → 400 invalid-payload', async () => {
    const { url } = await scene()
    for (const rawBody of ['not json', '']) {
      const response = await send(url, { rawBody })
      expect(response.status, rawBody).toBe(400)
      expect(response.json.error.code).toBe('invalid-payload')
    }
  })

  it('其它路径 → 404；GET /v1/notify → 405（契约只规定 404，405 是壳的显式补充）', async () => {
    const { showNotification, url } = await scene()
    for (const path of ['/', '/v1/notify/extra', '/v1/other']) {
      const response = await send(url, { body: notifyPayload(), path })
      expect(response.status, path).toBe(404)
    }
    const wrongMethod = await send(url, { body: notifyPayload(), method: 'GET' })
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.json.error.code).toBe('method-not-allowed')
    expect(showNotification).not.toHaveBeenCalled()
  })

  it('超大 body → 400 invalid-payload（不让一条通知撑爆壳）', async () => {
    const { showNotification, url } = await scene()
    const response = await send(url, { body: notifyPayload({ body: 'x'.repeat(200 * 1024) }) })
    expect(response.status).toBe(400)
    expect(response.json.error.code).toBe('invalid-payload')
    expect(showNotification).not.toHaveBeenCalled()
  })
})

describe('#23 · 交付失败也如实说（HTTP 仍 200）', () => {
  it('平台不支持 → delivered:false reason:unsupported', async () => {
    const { url } = await scene({ handle: () => ({ shown: false, reason: 'unsupported' }) })
    const response = await send(url, { body: notifyPayload() })
    expect(response.status).toBe(200)
    expect(response.json).toEqual({ ok: true, delivered: false, reason: 'unsupported' })
  })

  it('权限被关 → delivered:false reason:permission-denied（带 detail 时原样带回）', async () => {
    const { url } = await scene({ handle: () => ({ shown: false, reason: 'permission-denied', detail: '系统通知已关闭' }) })
    const response = await send(url, { body: notifyPayload() })
    expect(response.json).toMatchObject({ ok: true, delivered: false, reason: 'permission-denied' })
    expect(response.json.detail).toMatch(/系统通知/u)
  })

  it('展示时抛异常 / 未知 reason → delivered:false reason:failed（绝不 500、绝不假装成功）', async () => {
    const throwing = await scene({
      handle: () => {
        throw new Error('boom')
      },
    })
    const first = await send(throwing.url, { body: notifyPayload() })
    expect(first.status).toBe(200)
    expect(first.json).toMatchObject({ ok: true, delivered: false, reason: 'failed' })
    expect(first.json.detail).toMatch(/boom/u)

    const weird = await scene({ handle: () => ({ shown: false, reason: 'moon-phase' }) })
    const second = await send(weird.url, { body: notifyPayload() })
    expect(second.json).toMatchObject({ ok: true, delivered: false, reason: 'failed' })
  })

  it('不存在的壳端点端口上没有任何提示 —— 服务关闭后连接被拒（close 真的关了）', async () => {
    const { server, url } = await scene()
    await server.close()
    await expect(send(url, { body: notifyPayload() })).rejects.toThrow(/ECONNREFUSED|socket hang up|connect/iu)
  })
})

describe('#23 · 点击：只唤出窗口，不假装深链', () => {
  it('用户点通知 → onNotificationClick(归一后的载荷)；target 原样带给调用方自己决定', async () => {
    let listener = null
    const { onNotificationClick, url } = await scene({
      handle: (_payload, { onClick }) => {
        listener = onClick
        return { shown: true }
      },
    })
    const payload = notifyPayload({ kind: 'wansheng', target: 'consult' })
    await send(url, { body: payload })
    expect(typeof listener).toBe('function')

    listener()
    expect(onNotificationClick).toHaveBeenCalledTimes(1)
    expect(onNotificationClick.mock.calls[0][0]).toMatchObject({ kind: 'wansheng', target: 'consult' })
  })

  it('点击回调抛异常不把端点带下来（响应早已发出；后续通知照收）', async () => {
    const onNotificationClick = vi.fn(() => {
      throw new Error('window is gone')
    })
    const showNotification = vi.fn((_payload, { onClick }) => {
      queueMicrotask(() => onClick())
      return { shown: true }
    })
    const server = createNotifyServer({ token: FAKE_TOKEN, showNotification, onNotificationClick })
    servers.push(server)
    const { url } = await server.listen()

    expect((await send(url, { body: notifyPayload() })).status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onNotificationClick).toHaveBeenCalledTimes(1)

    // 端点还活着。
    expect((await send(url, { body: notifyPayload({ id: 'notify-2' }) })).status).toBe(200)
  })
})
