/**
 * tests/notify/lib/sandbox.mjs — 触达环断言台的外界替身（#24）。
 *
 * 硬约束（冻结契约 §6）：
 *   - **零真实网络**：假壳端点是**真 `node:http`**，但只绑 `127.0.0.1` 的 OS 分配端口（`port:0`），
 *     自己起、自己收，绝不碰外网、不碰真壳包（#23 由另一位实现者并行做）；
 *   - **零真实 home**：状态文件 / 账本 / 设置都落在 `tests/notify/.tmp/**`（`.gitignore` 覆盖
 *     `tests/**​/.tmp/`），env 由断言台注入，不读 `process.env` 的机器现场。
 *
 * 两个替身：
 *   - `makeScratch()`：一次性 dataDir（形状同 `tests/digao/lib/sandbox.mjs` 的沙箱）；
 *   - `startFakeShell({ respond })`：真端口 + 记请求的假壳端点（`/v1/notify` 的收端）。
 */
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { pruneStaleDirs } from '../../lib/sandbox-prune.mjs'

const TMP_ROOT = join(import.meta.dirname, '..', '.tmp')

/** 假壳端点的 token（64 hex 的字面量，形状照契约 §1）。 */
export const FAKE_TOKEN = 'f'.repeat(64)

/** 壳写、宿主读的运行时状态文件路径（契约 §1：`<home>/xuanshu/runtime/shell-notify.json`）。 */
export function notifyStatePath(dataDir) {
  return join(dataDir, 'runtime', 'shell-notify.json')
}

/** 写一份**合法**的运行时状态文件（形状逐字照契约 §1）。 */
export function writeNotifyStateFile(dataDir, { url, token = FAKE_TOKEN, pid = 12345, schema = 'xuanshu/shell-notify@1' } = {}) {
  const file = notifyStatePath(dataDir)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({
    schema,
    url,
    token,
    pid,
    startedAt: '2026-10-17T00:00:00.000Z',
    capabilities: { notification: true, clickToWindow: true },
  }, null, 2)}\n`, 'utf8')
  return file
}

/** 一个一次性 dataDir。 */
export function makeScratch(label = 'notify') {
  mkdirSync(TMP_ROOT, { recursive: true })
  pruneStaleDirs(TMP_ROOT)
  const root = mkdtempSync(join(TMP_ROOT, `${label}-`))
  const dataDir = join(root, 'xuanshu')
  mkdirSync(dataDir, { recursive: true })
  return {
    root,
    dataDir,
    path: (...parts) => join(dataDir, ...parts),
    read(...parts) {
      return readFileSync(join(dataDir, ...parts), 'utf8')
    },
    readJson(...parts) {
      return JSON.parse(readFileSync(join(dataDir, ...parts), 'utf8'))
    },
    write(rel, text) {
      const file = join(dataDir, rel)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text)
      return file
    },
    exists(...parts) {
      try {
        readFileSync(join(dataDir, ...parts))
        return true
      } catch {
        return false
      }
    },
    files() {
      const out = []
      const walk = (dir, prefix) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name)
          const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
          if (entry.isDirectory()) walk(full, rel)
          else out.push(rel)
        }
      }
      walk(dataDir, '')
      return out.sort()
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/**
 * 起一个假壳端点（真 `node:http`，只绑回环）。
 *
 * @param {(request: {method: string, url: string, headers: object, body: string, json: object|null}, respond: Function) => void} [handle]
 *        收到一条 POST 后怎么回；缺省 = 契约 §2 的成功响应 `{ok:true, delivered:true}`。
 * @returns {Promise<{url: string, port: number, token: string, requests: object[], close: () => Promise<void>}>}
 */
export async function startFakeShell(handle) {
  const requests = []
  const respond = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
  const server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      let json = null
      try {
        json = JSON.parse(body)
      } catch {
        json = null
      }
      const record = { method: req.method, url: req.url, headers: req.headers, body, json }
      requests.push(record)
      const handler = handle ?? ((_request, done) => done(200, { ok: true, delivered: true }))
      handler(record, (status, payload) => respond(res, status, payload))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    token: FAKE_TOKEN,
    requests,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.()
      server.close(() => resolve())
    }),
  }
}
