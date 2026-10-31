/**
 * 同源 fetch 数据面的**测试夹具**（继承红修复，2026-10-31）。
 *
 * 为什么要有这个文件：`8fdaa4b` 把客户端数据面从 `ctx.connection.rpc.call` 换成了同源
 * fetch（`packages/xuanshu-client/src/client/rpc.ts`：`POST /api/xuanshu`，体
 * `{method, payload}`，回 `{ok:true,value}` / `{ok:false,error:{code,message,details}}`），
 * 但 `tests/assembly/**` 里的 API 用例还在给 `ctx.connection.rpc.call` 打桩。生产代码
 * 已经不读那个桩了，于是真 `fetch('/api/xuanshu')` 在 Node 里直接
 * `TypeError: Failed to parse URL` —— 这就是那 43 条「继承红」。
 *
 * 这里只换**传输层的桩**：把 `globalThis.fetch` 临时接管成一个会记录调用、并按 handler
 * 返回**真 `Response`**（不是假对象：`rpc.ts` 会读 `response.ok` / `response.json()`）的
 * 实现。断言语义一个字都不动——验的还是同一个方法名 / 同一份载荷 / 同一条失败路径。
 *
 * 记录项形状**故意对齐旧断言**：
 *
 * ```js
 * { channel: '/xuanshu', endpoint: method, payload, signal, url, method: 'POST' }
 * ```
 *
 * `channel` 是旧的**通道名**（`/api` 前缀剥掉后的 `RPC_PATH`），于是
 * `expect(calls[0]).toMatchObject({ channel: '/xuanshu', endpoint: 'routes.list', payload: {} })`
 * 这种断言可以原样保留；`url` 记的是真实路径 `/api/xuanshu`，需要断言 HTTP 形状的用例改看它。
 *
 * 用法：
 *
 * ```js
 * import { afterEach } from 'vitest'
 * import { installRpcFetch, restoreRpcFetch } from './lib/rpc-fetch.mjs'
 *
 * afterEach(restoreRpcFetch)            // 漏还原会污染后面的文件（fetch 是进程级全局）
 *
 * const rpc = installRpcFetch({ value: { ok: true } })   // → {ok:true, value:{ok:true}}
 * const rpc = installRpcFetch({ error: { message: '底座没起来' } })  // → {ok:false, error}
 * const rpc = installRpcFetch((call) => (call.endpoint === 'a.b' ? { value: 1 } : { value: 2 }))
 * const rpc = installRpcFetch(() => new Response('boom', { status: 500 }))  // 传输层失败
 *
 * rpc.calls      // 记录项数组
 * rpc.setHandler // 同一个 it 里换行为（装配期取数 + 装配期失败的用例需要）
 * rpc.restore    // 立刻还原（一般交给 afterEach）
 * ```
 *
 * 三条不变量（夹具自己把关，出问题就大声红，不静默放水）：
 *   1. 只接管 `RPC_PATH`（`/api/xuanshu`，含绝对 URL 形式）——别的 URL 直接抛，避免把
 *      「某处偷偷发了个别的请求」遮掉；
 *   2. 只接受 `POST`——这个 exact Fetch 路由只注册了 POST；
 *   3. 请求体必须是合法 JSON 且带 `method` 字符串——否则抛。
 */

/**
 * 真·数据面路径。**不 import 产品源码**：夹具要独立声明这一条事实，产品改了路径就该红，
 * 而不是跟着一起改（跟着改就等于没断言）。
 */
const RPC_PATH = '/api/xuanshu'

/** 旧断言里的通道名。由 `RPC_PATH` 剥掉 `/api` 前缀派生，不另写字面量。 */
const RPC_CHANNEL = RPC_PATH.slice('/api'.length)

/** 当前还活着的接管（LIFO：`restore()` 各自还原自己捕获的前一个 fetch）。 */
const active = []

/**
 * 把一次 fetch 调用解析成记录项。
 * @param {unknown} input 第一个实参（字符串 / URL / Request）
 * @param {RequestInit} init 第二个实参
 */
function describeCall(input, init) {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : String(input?.url ?? input)

  const path = pathOf(url)
  if (path !== RPC_PATH) {
    throw new Error(
      `rpc-fetch 夹具只接管 ${RPC_PATH}，收到 ${JSON.stringify(url)}。`
        + '若这是产品真的发了别的请求，请在这条用例里自己装更细的桩；不要放宽夹具。',
    )
  }

  const method = init?.method ?? (typeof input?.method === 'string' ? input.method : 'GET')
  if (method !== 'POST') throw new Error(`rpc-fetch 夹具只接受 POST，收到 ${method}（${url}）`)

  const raw = init?.body
  if (typeof raw !== 'string') {
    throw new Error(`rpc-fetch 夹具需要字符串请求体，收到 ${typeof raw}（${url}）`)
  }
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    throw new Error(`rpc-fetch 夹具解析不了请求体（${url}）：${raw.slice(0, 120)}`)
  }
  if (typeof body?.method !== 'string') {
    throw new Error(`rpc-fetch 夹具要求请求体带 method 字符串（${url}），收到 ${raw.slice(0, 120)}`)
  }

  return {
    /** 旧通道名（`/xuanshu`）：对齐 8fdaa4b 之前的断言。 */
    channel: RPC_CHANNEL,
    /** 方法名（如 `routes.list`）。 */
    endpoint: body.method,
    /** 载荷：`rpc.ts` 的缺省值是 `{}`，所以「请求体里没有 payload 键」也记 `{}`。 */
    payload: body.payload === undefined ? {} : body.payload,
    /** 取消信号（调用方没传就是 `undefined`，与旧桩一致）。 */
    signal: init?.signal,
    /** 真实请求路径（`/api/xuanshu`）：断 HTTP 形状的用例看这个。 */
    url,
    /** 真实 HTTP 方法（恒为 POST）。 */
    method,
    /** 原样的请求头（`rpc.ts` 会带 `content-type: application/json`）。 */
    headers: init?.headers,
    /** 原始 init（需要看更细的传输细节时用）。 */
    init,
  }
}

/** 取 URL 的路径部分：`/api/xuanshu`、`http://127.0.0.1/api/xuanshu` 都归一。 */
function pathOf(url) {
  const queryless = url.split(/[?#]/u)[0]
  try {
    return new URL(queryless, 'http://127.0.0.1').pathname
  } catch {
    return queryless
  }
}

/**
 * 把 handler 的返回值归一成一封信封。
 *
 * 支持的写法（按优先级）：
 *   - 函数 `(call) => …`：逐次求值（可 async）；
 *   - 真 `Response`：原样返回（验 `response.ok` 为假的那条路：`status: 500`）；
 *   - 已成形信封 `{ ok: boolean, value?, error? }`：原样（注意 `value` 里也可能有 `ok:false`，
 *     那是**方法级**失败，不能被当成传输层失败——所以先认外层的 `ok`）；
 *   - `{ error: {…} }` → `{ok:false, error}`；
 *   - `{ value }` → `{ok:true, value}`；
 *   - 其它对象/标量 → `{ok:true, value: 它}`。
 */
function normalizeEnvelope(produced) {
  if (produced instanceof Response) return produced
  if (produced === undefined) return { ok: true, value: {} }
  if (typeof produced !== 'object' || produced === null) return { ok: true, value: produced }
  if (typeof produced.ok === 'boolean') return produced
  if ('error' in produced) return { ok: false, error: produced.error }
  if ('value' in produced) return { ok: true, value: produced.value }
  return { ok: true, value: produced }
}

/**
 * 装上 fetch 夹具。
 *
 * @param handler handler 三种写法见文件头；缺省返回 `{ok:true, value:{}}`。
 * @returns {{ calls: object[], setHandler: (handler: unknown) => void, restore: () => void }}
 */
export function installRpcFetch(handler = {}) {
  const calls = []
  let current = handler
  const previous = globalThis.fetch

  const stub = async (input, init) => {
    const call = describeCall(input, init)
    calls.push(call)

    const produced = typeof current === 'function' ? await current(call) : current
    const envelope = normalizeEnvelope(produced)
    if (envelope instanceof Response) return envelope

    return new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  globalThis.fetch = stub

  const entry = {
    calls,
    setHandler(next) {
      current = next
    },
    restore() {
      const index = active.lastIndexOf(entry)
      if (index === -1) return
      active.splice(index, 1)
      // LIFO：只有「自己仍是栈顶」时才把 fetch 还回去，避免把内层夹具一起拆掉。
      if (index === active.length) globalThis.fetch = previous
    },
  }
  active.push(entry)
  return entry
}

/** 还原所有还活着的接管（每个文件 `afterEach(restoreRpcFetch)` 一次即可）。 */
export function restoreRpcFetch() {
  while (active.length > 0) active[active.length - 1].restore()
}

export { RPC_CHANNEL, RPC_PATH }
