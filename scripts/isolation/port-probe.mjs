/**
 * scripts/isolation/port-probe.mjs
 *
 * 票 04「开发期双实例隔离」的两道门 —— 第一道：底层探针。
 *
 * 判据/签名出处：`.scratch/assembly-foundation/notes/isolation-contract.md` §4.2（冻结接口）
 *   isPortBusy(port, host = '127.0.0.1', timeoutMs = 1000) -> Promise<boolean>
 *   httpGet(port, path, { host = '127.0.0.1', timeoutMs = 1500 })
 *     -> Promise<{ reachable, status?, contentType?, headers?, body?, error? }>
 *
 * 状态机（本文件只负责「事实采集」，不负责裁决；裁决在 horosa-guard.mjs）：
 *   TCP 层     connect 成功            -> busy = true
 *              connect ECONNREFUSED    -> busy = false（端口空着）
 *              connect 超时/其它错误    -> busy = false（本层无法判定，由 httpGet 的返回补足）
 *   HTTP 层    拿到响应头              -> reachable:true + status/headers/body 前若干字节
 *             连接被拒（ECONNREFUSED）  -> reachable:false, error:'ECONNREFUSED'
 *             连上但没响应头（超时）    -> reachable:false, connected:true, timedOut:true
 *             DNS/权限等其它错误        -> reachable:false, error:<code>
 *
 * 三条设计约束（为什么这么写）：
 * 1) 只用 `node:net` / `node:http`，**不用 fetch/undici**：fetch 的超时（AbortSignal）与 socket
 *    超时是两套语义，失败时只给 `TypeError: fetch failed` + cause，形状不稳定；而这道门必须
 *    产出确定的三态判断（free / 被占 / 探针坏了），错误码必须是可分类的原始 errno。
 * 2) **不抛异常**：一切失败折算成返回值。doctor 模式要的是 fail-fast 报告，不是栈回溯；
 *    探针抛异常会让「端口被占」与「脚本自身坏了」两条完全不同的处置路径混在一起。
 * 3) **有界时间 + 显式销毁 socket**：每个探针都自带定时器，settle 时 `destroy()` socket/request。
 *    否则 keep-alive 或半开连接会留下悬挂句柄，vitest 跑完不退出（比断言失败更难查）。
 *
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

import net from 'node:net'
import http from 'node:http'

/** body 只取前若干字节：MCP 响应可能很大，守卫只需看到 JSON-RPC 形状。 */
const BODY_HEAD_LIMIT = 2048
/** 契约 §4.2 默认 host：只探本机回环，绝不碰外部地址。 */
const DEFAULT_HOST = '127.0.0.1'

/** 把任意异常折算成可分类的字符串（优先 errno code，其次 message）。 */
function errCode(err) {
  if (err === null || err === undefined) return 'unknown error'
  if (typeof err === 'string') return err
  return err.code || err.message || String(err)
}

/** Node 的 header 值可能是 string | string[] | undefined；统一成 Record<string,string> 且键小写。 */
function flattenHeaders(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue
    out[String(key).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * isPortBusy：纯函数式的「有人在这台机器的这个端口上 LISTEN 吗」
 * ------------------------------------------------------------------ */
function isPortBusyInner(port, host, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    let socket = null
    let timer = null

    const settle = (busy) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      // 为什么手动 destroy：connect 失败/超时后的 socket 仍可能持有 fd 直到 GC；
      // 探针在测试里会被调用几十次，攒下来的句柄会让进程不退出。
      try {
        socket?.destroy()
      } catch {
        /* 销毁失败不影响判定结果 */
      }
      resolve(busy)
    }

    try {
      socket = net.connect({ port, host })
    } catch {
      // 端口号非法（RangeError）一类的同步错误：本层无法判定「忙」。
      settle(false)
      return
    }

    // 超时按「不忙」处理：TCP 握手没能在预算内完成，说明没有可用的 LISTEN 者应答。
    // 「有人 LISTEN 但不讲 HTTP」不在这里判 —— 那是 httpGet 的超时路径的事实（connected:true）。
    timer = setTimeout(() => settle(false), Math.max(1, timeoutMs))
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
    socket.once('timeout', () => settle(false))
  })
}

/**
 * 纯函数：true = 该端口本机回环上有人 LISTEN。
 * 任何异常（含非法参数）都折算成 false，绝不抛出。
 */
export async function isPortBusy(port, host = DEFAULT_HOST, timeoutMs = 1000) {
  try {
    return await isPortBusyInner(port, host, timeoutMs)
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * httpGet：一次 GET，产出足够裁决的证据（status / headers / body 头）
 * ------------------------------------------------------------------ */
function httpGetInner(port, path, host, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    let settled = false
    let req = null
    let res = null
    let timer = null
    let connected = false
    let truncated = false
    let bytes = 0
    const chunks = []

    const bodySoFar = () => (chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined)

    const settle = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      // 双保险：response 与 request 都显式销毁，避免半开/流式响应留下悬挂句柄。
      try {
        res?.destroy()
      } catch {
        /* ignore */
      }
      try {
        req?.destroy()
      } catch {
        /* ignore */
      }
      resolve({ ...result, elapsedMs: Date.now() - startedAt })
    }

    const withResponse = (extra) => ({
      reachable: true,
      connected: true,
      status: res?.statusCode,
      contentType: res?.headers?.['content-type'],
      headers: flattenHeaders(res?.headers),
      body: bodySoFar(),
      truncated,
      ...extra,
    })

    timer = setTimeout(() => {
      if (res) {
        // 已经拿到响应头：端点确实在答（streamable-http 的 SSE 会一直挂着不结束），
        // 此时超时只意味着 body 被截断，不能算探针失败。
        settle(withResponse({ timedOut: true }))
      } else {
        // 一个字节的响应头都没收到：这是「连上了但不讲 HTTP」的重要事实，交给守卫裁决。
        settle({ reachable: false, connected, timedOut: true, error: 'ETIMEDOUT' })
      }
    }, Math.max(1, timeoutMs))

    try {
      req = http.request(
        {
          host,
          port,
          path,
          method: 'GET',
          // agent:false —— 每次请求一个一次性 agent，不复用 keep-alive 连接池，
          // 避免探针给进程留下一池子存活 socket。
          agent: false,
          headers: {
            // 声明两种 MCP 传输的 Accept：端点据此返回 JSON 或 SSE；缺了可能被 406。
            accept: 'application/json, text/event-stream',
            'user-agent': 'xuanshu-isolation-probe/1',
          },
        },
        (response) => {
          res = response
          response.on('data', (chunk) => {
            if (bytes >= BODY_HEAD_LIMIT) {
              truncated = true
              return // 继续读但不再累积：丢给流自己结束，或等定时器收口。
            }
            chunks.push(chunk)
            bytes += chunk.length
          })
          response.on('end', () => settle(withResponse({})))
          response.on('aborted', () => settle(withResponse({ error: 'ECONNRESET' })))
          response.on('error', (err) => settle(withResponse({ error: errCode(err) })))
        },
      )
    } catch (err) {
      settle({ reachable: false, connected: false, error: errCode(err) })
      return
    }

    // 记录 TCP 是否真的连上了：裸 TCP 服务（accept 但不应答）连得上，
    // 而 ECONNREFUSED / 防火墙丢包连不上 —— 守卫靠这个区分「被占」和「unknown」。
    req.on('socket', (socket) => {
      socket.once('connect', () => {
        connected = true
      })
    })
    req.on('error', (err) => settle({ reachable: false, connected, error: errCode(err) }))
    req.end()
  })
}

/**
 * 对 127.0.0.1:<port> 发一次 HTTP GET；连接被拒 -> { reachable:false }。
 * 任何异常都折算成返回值，绝不抛出。
 */
export async function httpGet(port, path, { host = DEFAULT_HOST, timeoutMs = 1500 } = {}) {
  try {
    return await httpGetInner(port, path, host, timeoutMs)
  } catch (err) {
    return { reachable: false, connected: false, error: errCode(err) }
  }
}
