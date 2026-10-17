/**
 * tests/shiji/lib/sandbox.mjs —— 票 05（#26）事记账本的断言台。
 *
 * 硬约束：
 *   - **零网络、零真实模型、零真实 .dsh-home**：`ctx` 是普通对象，工作区 / 会话 / LLM 全是记调用的替身；
 *     项目文档写在**一次性沙箱**里，绝不读真实仓库或 `~/.dsh`；
 *   - 临时产物落 `tests/shiji/.tmp/**`（`.gitignore` 已覆盖 `tests/**​/.tmp/`）；
 *   - 判定只看外部可观察物：方法返回值、`shiji.jsonl` 的逐行形状、`llm.stream` 收到了什么。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pruneStaleDirs } from '../../lib/sandbox-prune.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 断言台自己的临时区。 */
export const TMP_ROOT = join(HERE, '..', '.tmp')

/** 一次性 dataDir（与被测实现同一种布局：`<root>/xuanshu`）。 */
export function makeSandbox(label) {
  mkdirSync(TMP_ROOT, { recursive: true })
  pruneStaleDirs(TMP_ROOT)
  const root = mkdtempSync(join(TMP_ROOT, `${label}-`))
  const dataDir = join(root, 'xuanshu')
  mkdirSync(dataDir, { recursive: true })
  return {
    root,
    dataDir,
    /** `<dataDir>/...`。 */
    path: (...parts) => join(dataDir, ...parts),
    /** `<root>/...`（项目目录、dshHome 放这里）。 */
    rootPath: (...parts) => join(root, ...parts),
    read(...parts) {
      return readFileSync(join(dataDir, ...parts), 'utf8')
    },
    write(rel, text) {
      const file = join(dataDir, rel)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text)
      return file
    },
    /** 往沙箱根（不是 dataDir）写一个文件，用来造「项目目录」。 */
    writeRoot(rel, text) {
      const file = join(root, rel)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text, 'utf8')
      return file
    },
    exists(...parts) {
      return existsSync(join(dataDir, ...parts))
    },
    /** 递归列出 dataDir 里的文件（相对 dataDir 的 posix 路径，字典序）。 */
    files() {
      const out = []
      const walk = (dir, prefix) => {
        for (const dirent of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, dirent.name)
          const rel = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`
          if (dirent.isDirectory()) walk(full, rel)
          else out.push(rel)
        }
      }
      if (existsSync(dataDir)) walk(dataDir, '')
      return out.sort()
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/**
 * 造一个项目目录（工作区 `path` 指向它），并写进说明文档。
 * @param {{docs?: Record<string, string>}} [parts] 相对路径 → 正文
 * @returns 绝对路径
 */
export function seedProject(sandbox, name, { docs = {} } = {}) {
  const root = sandbox.rootPath('projects', name)
  mkdirSync(root, { recursive: true })
  for (const [rel, text] of Object.entries(docs)) {
    const file = join(root, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text, 'utf8')
  }
  return root
}

/**
 * 假 `ctx.workspaceRegistry`：只读面给真数据，写操作抛（事记从不写工作区）。
 * 每个工作区对象带 `status()`（形状照 `dsh-workspace` 的 `Workspace.status()`）。
 * @param {object[]} workspaces 形状照 `dsh-workspace` 的 `Workspace`
 * @param {{missing?: string[]}} [options] `status()` 报 `missing-dir` 的工作区 id
 */
export function fakeWorkspaceRegistry(workspaces, { missing = [] } = {}) {
  const calls = []
  const missingSet = new Set(missing)
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  const withStatus = (workspace) => ({
    ...workspace,
    async status() {
      calls.push({ name: 'status', args: [workspace.id] })
      return missingSet.has(workspace.id) ? 'missing-dir' : 'ok'
    },
  })
  return {
    calls,
    service: {
      list() {
        calls.push({ name: 'list' })
        return workspaces.map(withStatus)
      },
      get(id) {
        calls.push({ name: 'get', args: [id] })
        const workspace = byId.get(id)
        return workspace === undefined ? undefined : withStatus(workspace)
      },
      create() {
        throw new Error('事记只读工作区：不许 create')
      },
      attachSession() {
        throw new Error('事记只读工作区：不许 attachSession')
      },
      delete() {
        throw new Error('事记只读工作区：不许 delete')
      },
    },
  }
}

/**
 * 假 `ctx.sessionQuery`：
 *   - `listSessions()` 给出 header（`{id, createdAt, cwd}`）；
 *   - `readSession(id)` 回放登记的事件；
 *   - `readTitle(id)` / `readTitleSnapshots(ids)` 给标题快照。
 * 没登记的会话 `readSession` 按上游错误码抛。
 * @param {{headers?: Record<string, object>, events?: Record<string, object[]>, titles?: Record<string, string>}} parts
 */
export function fakeSessionQuery({ headers = {}, events = {}, titles = {} } = {}) {
  const calls = []
  const service = {
    async listSessions() {
      calls.push({ method: 'listSessions' })
      return Object.entries(headers).map(([id, header]) => ({ header: { id, version: 4, ...header }, live: false, persisted: true }))
    },
    async readSession(sessionId) {
      calls.push({ method: 'readSession', sessionId })
      if (!Object.hasOwn(headers, sessionId) && !Object.hasOwn(events, sessionId)) {
        const error = new Error(`session "${sessionId}" not found`)
        error.code = 'SESSION_QUERY_SESSION_NOT_FOUND'
        throw error
      }
      return {
        session: { id: sessionId, version: 4, ...(headers[sessionId] ?? {}) },
        inheritedEventCount: 0,
        events: events[sessionId] ?? [],
      }
    },
    async readTitle(sessionId) {
      calls.push({ method: 'readTitle', sessionId })
      if (!Object.hasOwn(titles, sessionId)) return undefined
      return { title: titles[sessionId], messageSeqs: [1], source: { kind: 'user' }, eventSeq: 2, updatedAt: 0 }
    },
    async readTitleSnapshots(sessionIds) {
      calls.push({ method: 'readTitleSnapshots', sessionIds: [...sessionIds] })
      return sessionIds.map((sessionId) => Object.hasOwn(titles, sessionId)
        ? { status: 'fulfilled', session: { id: sessionId }, title: titles[sessionId] }
        : { status: 'rejected', session: { id: sessionId }, reason: 'no title' })
    },
  }
  return { calls, service }
}

/**
 * 假 `ctx.sessionProjectionCache`：`cachedSnapshot(header)` 给 title + `sessionListMetadata.lastPromptAt`。
 * @param {Record<string, {title?: string, lastPromptAt?: number|null}>} bySessionId
 */
export function fakeProjectionCache(bySessionId = {}) {
  const calls = []
  return {
    calls,
    service: {
      cachedSnapshot(header, keys) {
        calls.push({ method: 'cachedSnapshot', sessionId: header?.id, keys })
        const value = bySessionId[header?.id]
        if (value === undefined) return undefined
        return {
          values: {
            ...(value.title === undefined ? {} : { title: value.title }),
            ...(value.lastPromptAt === undefined ? {} : { sessionListMetadata: { blank: false, lastPromptAt: value.lastPromptAt } }),
          },
          asOfSeq: 1,
        }
      },
    },
  }
}

/**
 * 记调用的 `ctx.llm` 替身（与票 13 的 `fakeLlm` 同形状；事记要「按 system 提示识别调用」）。
 * @param {{text?: string, fail?: boolean}} [options]
 */
export function fakeLlm({ text = '在做玄枢：把住进去的底稿与事记接上。', fail = false } = {}) {
  const calls = []
  return {
    calls,
    listProviders() {
      calls.push({ method: 'listProviders' })
      return [{ id: 'fake-provider' }]
    },
    async listModels(provider) {
      calls.push({ method: 'listModels', provider })
      return [{ id: 'fake-model' }]
    },
    stream(options) {
      calls.push({ method: 'stream', options })
      const chunks = fail
        ? [{ type: 'error', error: 'provider down' }]
        : text.split('').map((char) => ({ type: 'text-delta', index: 0, text: char })).concat([{ type: 'finish' }])
      return (async function* generate() {
        for (const chunk of chunks) yield chunk
      })()
    },
  }
}

/** 造一个宿主 ctx（`ctx.get()` 是唯一取服务方式，与仓库惯例同款）。 */
export function makeCtx({ services = {} } = {}) {
  const ctx = {
    get(name) {
      return services[name]
    },
  }
  for (const [name, value] of Object.entries(services)) if (value !== undefined) ctx[name] = value
  return ctx
}

/** 读 `shiji.jsonl`（一行一个 JSON；空行跳过）——「一条一行」的机器判据。 */
export function readJsonl(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

/** 一条 `user/message` 事件（只有 `source.kind==='user'` 才算人说的）。 */
export function userEvent(seq, text, time = 1_790_000_000_000) {
  return { type: 'user/message', seq, time, data: { id: `m${seq}`, source: { kind: 'user' }, content: [{ type: 'text', text }] } }
}

/** 一条 `assistant/message` 事件。 */
export function assistantEvent(seq, text, time = 1_790_000_000_000) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: { turn: 1, step: 1, message: { id: `a${seq}`, role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text }] } },
  }
}
