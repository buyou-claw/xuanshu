/**
 * tests/consult/lib/sandbox.mjs — 票 10 断言台的**外界替身**：一次性 dataDir + 假 agents / 假 sessionQuery。
 *
 * 硬约束（契约 §6 与票 08 断言台同款纪律）：
 *   - **零网络、零真实会话、零真实 LLM**：`consult.*` 只被允许通过
 *     `ctx.agents.create/get/resume` 碰会话、通过 `ctx.sessionQuery.readSession` 读正文，
 *     所以断言台给的就是**普通对象**替身，一次真实 turn 都不跑；
 *   - **零自造形状**：底座谱用票 08 的**真** `bazi.cast` + 票 06 已捕获的真实信封
 *     （`tests/horosa/fixtures/envelopes/**`）现出一次盘；可选谱用票 09 的**真**
 *     `createPuRepository().confirm()` 落盘 —— 不手搓 manifest.md / summary.md，
 *     免得「测试绿了，真实现读不出来」；
 *   - **假 agent 的 `whenIdle()` 直接抛**：票 10 若拿 `whenIdle()` 当「一轮结束」用，
 *     这里立刻红（证据 `dsh-agent/lib/types/runtime-types.d.ts:164`：`whenIdle()` 不标识某条消息的结束）；
 *   - 临时产物落 `tests/consult/.tmp/**`（`.gitignore` 覆盖 `tests/**​/.tmp/`），绝不碰真实 `~/.dsh`。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createBaziMethods } from '../../../packages/xuanshu-host/lib/bazi/service.mjs'
import { createPuRepository } from '../../../packages/xuanshu-host/lib/pu/repository.mjs'
import { fakeHorosa } from '../../bazi/lib/sandbox.mjs'
import { pruneStaleDirs } from '../../lib/sandbox-prune.mjs'

/** 假 `xuanshuHorosa`（票 08 断言台的那一个，**同源码**）：回放真实信封、形状照真实现。 */
export { fakeHorosa }

const HERE = dirname(fileURLToPath(import.meta.url))

/** 断言台自己的临时区（`tests/consult/.tmp`，gitignore 覆盖）。 */
export const TMP_ROOT = join(HERE, '..', '.tmp')
/** 票 06 已捕获的真实信封（唯一信封来源，复用票 08 的假 horosa 回放它）。 */
export const ENVELOPES_DIR = join(HERE, '..', '..', 'horosa', 'fixtures', 'envelopes')
/** 仓库根（用来把绝对路径断言写成与实现同源的形状）。 */
export const REPO_ROOT = join(HERE, '..', '..', '..')

/**
 * 清理上一次运行留下的旧沙箱（超过 `SANDBOX_STALE_MS`）。
 *
 * 实现收在 `tests/lib/sandbox-prune.mjs`（**单一来源**）：这段逻辑曾经在 6 个域的沙箱里各抄一份，
 * 然后漂移了 —— bazi / consult 两处把比较写反（删的是**刚建**的沙箱、旧件永不清，并发跑还会互删现场）。
 * 共享文件头部记了这件事的来龙去脉与判据。
 */
function pruneStale() {
  return pruneStaleDirs(TMP_ROOT)
}

/** 一个一次性 dataDir（被测实现只允许在这里写盘）。 */
export function makeSandbox(label) {
  mkdirSync(TMP_ROOT, { recursive: true })
  pruneStale()
  const root = mkdtempSync(join(TMP_ROOT, `${label}-`))
  const dataDir = join(root, 'xuanshu')
  mkdirSync(dataDir, { recursive: true })
  return {
    root,
    dataDir,
    /** 仓内相对路径 → 沙箱内绝对路径。 */
    path: (...parts) => join(dataDir, ...parts),
    read(...parts) {
      return readFileSync(join(dataDir, ...parts), 'utf8')
    },
    write(rel, text) {
      const target = join(dataDir, rel)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, text, 'utf8')
    },
    exists(...parts) {
      return existsSync(join(dataDir, ...parts))
    },
    json(...parts) {
      return JSON.parse(readFileSync(join(dataDir, ...parts), 'utf8'))
    },
    /** 递归列出沙箱里所有文件（相对 dataDir 的 posix 路径，字典序）——「落了哪些盘」的判据。 */
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
      if (existsSync(dataDir)) walk(dataDir, '')
      return out.sort()
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** 读一份真实信封 fixture（票 06 的捕获裁剪件）。 */
export function envelope(name) {
  return JSON.parse(readFileSync(join(ENVELOPES_DIR, `${name}.json`), 'utf8'))
}

/** 契约 §1 的样例出生信息（上海 1990-06-01 04:00，与票 08 断言台同一份）。 */
export const BIRTH = { date: '1990-06-01', time: '04:00', zone: 'Asia/Shanghai', lat: 31.2304, lon: 121.4737, place: '上海' }

/**
 * 用票 08 的**真** `bazi.cast` 出一张盘：底座谱（`pus/_base/**`）与快照都落进沙箱。
 * 这是「底座谱」在断言台里唯一的来源 —— 票 10 只消费 `bazi.basePu`，绝不自己造一份。
 * @returns 真机四柱（`bazi-ok-default` 那份）
 */
export async function seedBasePu(sandbox, ctx) {
  const api = createBaziMethods(ctx, { dataDir: sandbox.dataDir })
  const result = await api['bazi.cast']({ birth: BIRTH, confirmed: true })
  if (result.phase !== 'ok') throw new Error(`断言台自己起盘失败：${JSON.stringify(result)}`)
  return result.snapshot.pillars
}

/**
 * 用票 09 的**真** repository 落一个可选谱（`pus/<slug>/{manifest,summary,content}.md`）。
 * @returns 落盘后的谱对象
 */
export function seedPu(sandbox, { name, level = 'optional', description, summary, body }) {
  const repository = createPuRepository(sandbox.dataDir)
  return repository.confirm({
    name,
    level,
    description,
    summary,
    body: body ?? `# ${name}（概览）\n${description}\n\n## 正文\n这里是《${name}》的正文，只有 AI 按需读文件时才该看到。\n`,
  }, true)
}

/**
 * 造一个宿主 ctx。
 *
 * `ctx.get(name, false)` 是**唯一**的取服务方式（与 `lib/bazi/service.mjs` 的软取同款）；
 * 每次取用都记进 `lookups`，于是「有没有碰 `ctx.sessions` / `workspaceRegistry`」有客观判据。
 *
 * @param {{services?: object, wired?: boolean}} [options]
 *        `wired:true` 时 `ctx.inject()` 会回调一个带 `connection.rpc.handle` / `skills` / `webServer`
 *        的 ctx（总装配用例走这条路，服务级用例不需要）。
 */
export function makeHost({ services = {}, wired = false } = {}) {
  const lookups = []
  const listeners = []
  const cleanups = []
  const routes = []
  const provided = new Map()
  const base = {
    get(name) {
      lookups.push(name)
      return services[name]
    },
    on(event, listener) {
      listeners.push({ event, listener })
      return () => {
        const index = listeners.findIndex((entry) => entry.listener === listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
    effect(callback) {
      cleanups.push(callback())
      return () => {}
    },
    provide(name, value) {
      provided.set(name, value)
      return () => {}
    },
    logger() {
      return { info() {}, warn() {}, error() {} }
    },
    commands: { register: () => () => {} },
  }
  const ctx = { ...base }
  if (wired) {
    ctx.inject = (names, callback) => {
      callback({
        ...base,
        skills: { register: () => () => {} },
        connection: {
          rpc: {
            handle(path, handler) {
              routes.push({ path, handler })
              return () => {}
            },
          },
        },
        webServer: { register: () => () => {} },
      })
      return () => {}
    }
  }
  /** 触发一个宿主事件（只打本替身记下的监听器）。 */
  const emit = (event, ...args) => {
    for (const entry of [...listeners]) if (entry.event === event) entry.listener(...args)
  }
  /** 当前还挂着的监听器数（「轮结束就退订」这类断言的判据）。 */
  const listenerCount = (event) => listeners.filter((entry) => entry.event === event).length
  return { ctx, lookups, listeners, emit, listenerCount, routes, provided, cleanups, services }
}

/** 假 agent，按调用顺序记 inject / followup（顺序本身也是被验的东西）。 */
function fakeAgent(sessionId) {
  const calls = []
  return {
    id: sessionId,
    session: { id: sessionId },
    calls,
    inject(message) {
      calls.push({ kind: 'inject', message })
    },
    followup(message) {
      calls.push({ kind: 'followup', message })
    },
    /**
     * 票 10 不许拿它当「一轮结束」。真实现里它不标识某条消息的结束
     * （`dsh-agent/lib/types/runtime-types.d.ts:164`），这里干脆让它抛，
     * 免得实现里出现「调了它但测试还是绿」的假绿。
     */
    whenIdle() {
      throw new Error('票 10 不许用 whenIdle() 判定一轮结束：它不标识某条消息的结束（runtime-types.d.ts:164）。')
    },
  }
}

/**
 * 假 `ctx.agents`：记录 create/get/resume，并按 id 交出可观察的假 agent。
 *
 * `create` / `resume` 会像**真工厂**那样先 `await setup(agentCtx, agent)` 再发布
 * （`dsh-agent/lib/types/index.d.ts:85-103`：setup 在 session/agent 发布之前跑完）——
 * 票 10 的 preset 就是在这一步挂进 agent scope 的，所以替身必须走同一条路。
 */
export function fakeAgents() {
  const created = []
  const resumed = []
  const disposed = []
  const setups = []
  const live = new Map()
  const make = (sessionId) => {
    const agent = fakeAgent(sessionId)
    live.set(sessionId, agent)
    return agent
  }
  const runSetup = async (options, agent) => {
    if (typeof options.setup !== 'function') return
    const agentCtx = { kind: 'agent-ctx', sessionId: agent.id }
    setups.push({ sessionId: agent.id, agentCtx })
    await options.setup(agentCtx, agent)
  }
  return {
    created,
    resumed,
    disposed,
    setups,
    live,
    service: {
      async create(options) {
        created.push(options)
        const agent = make(options.sessionId)
        await runSetup(options, agent)
        return {
          agent,
          async dispose() {
            disposed.push(options.sessionId)
            live.delete(options.sessionId)
          },
        }
      },
      get(id) {
        return live.get(id)
      },
      async resume(options) {
        resumed.push(options)
        const agent = make(options.resumeSessionId)
        await runSetup(options, agent)
        return {
          agent,
          async dispose() {
            disposed.push(options.resumeSessionId)
            live.delete(options.resumeSessionId)
          },
        }
      },
    },
  }
}

/** 假 `ctx.sessionQuery`：只实现 `readSession`，没登记的会话按上游错误码抛。 */
export function fakeSessionQuery(eventsBySession = {}, headersBySession = {}) {
  const calls = []
  const events = { ...eventsBySession }
  const headers = { ...headersBySession }
  return {
    calls,
    /** 会话 id → 事件流（用例里随时登记，模拟「这个会话的日志里有这些事件」）。 */
    events,
    /** 会话 id → header 覆盖（如 `{agentPreset:'minimal'}`，resume 时认回 preset 要用）。 */
    headers,
    service: {
      async readSession(sessionId) {
        calls.push(sessionId)
        if (!Object.hasOwn(events, sessionId) && !Object.hasOwn(headers, sessionId)) {
          const error = new Error(`session "${sessionId}" not found`)
          error.code = 'SESSION_QUERY_SESSION_NOT_FOUND'
          throw error
        }
        return { session: { id: sessionId, version: 4, ...(headers[sessionId] ?? {}) }, inheritedEventCount: 0, events: events[sessionId] ?? [] }
      },
    },
  }
}

/**
 * 假 `ctx.agentPresets`（`dsh-agent-preset-registry`）：`resolve()` 不带参数即取 registry 默认。
 * `mounted` 记下「哪个 agent scope 挂了哪个 preset」—— 票 10 的「工具表非空」就靠这一条。
 */
export function fakeAgentPresets({ default: defaultId = 'standard' } = {}) {
  const resolved = []
  const mounted = []
  return {
    resolved,
    mounted,
    service: {
      async resolve(id) {
        resolved.push(id)
        return { id: id ?? defaultId }
      },
      async mount(agentCtx, id) {
        mounted.push({ agentCtx, id })
        return { id }
      },
    },
  }
}

/** 假 `ctx.agentDefaultModel`：`currentSelection()` 就是 controller 建会话时用的那一份。 */
export function fakeAgentDefaultModel(selection = { provider: 'deepseek', model: 'deepseek-chat' }) {
  return { service: { currentSelection: () => ({ ...selection }) } }
}

/**
 * 假 `ctx.sessions`（宿主 SessionStore）：**任何**调用都记账并抛。
 *
 * 它存在的意义：票 10 的会话必须走 `ctx.agents.create`（接 agent、挂 preset），
 * 用 `ctx.sessions.create` 造出来的只是日志对象 —— 会话跑不起来，却**不报错**。
 */
export function fakeSessionStore() {
  const calls = []
  const trap = (name) => (...args) => {
    calls.push({ name, args })
    throw new Error(`票 10 不许用 ctx.sessions.${name}：它只造日志对象、不接 agent、不挂 preset（dsh-api-session-controller/lib/index.js:449-458）。`)
  }
  return {
    calls,
    service: { create: trap('create'), prepare: trap('prepare'), enter: trap('enter'), fork: trap('fork'), list: trap('list') },
  }
}

/**
 * 假 `ctx.workspaceRegistry`：**任何**调用都记账。
 * 「问事与工作区并列、不属于任何工作区」这条产品约束的机器判据就是「一次都没被调」。
 */
export function fakeWorkspaceRegistry() {
  const calls = []
  const trap = (name) => (...args) => {
    calls.push({ name, args })
    throw new Error(`票 10 不许把问事会话挂进 workspace（ADR-0009 第 3 条）：${name}`)
  }
  return { calls, service: { create: trap('create'), attachSession: trap('attachSession'), list: trap('list') } }
}

/**
 * 假 `ctx.workspaceRegistry`（**票 12 专用**）：`list/get/resolveByPath` 给真数据，写操作照旧抛。
 *
 * 为什么另开一个而不改 `fakeWorkspaceRegistry()`：那一个是票 10 的判据 ——
 * 「问事会话不挂进任何工作区」的机器判据就是「一次都没被调」。票 12 允许**读**工作区
 * （挂载要拿 path 去读内容），但**仍然不许**把会话挂进去 —— 所以这个替身把「读」放开、
 * 把「写」继续钉死，而老判据一个字都不动（新票不许把老票的判据弄松）。
 *
 * @param {{workspaces?: readonly object[]}} [options] 假工作区清单（形状照 `dsh-workspace` 的 `Workspace`）。
 * @returns `{ calls, workspaces, service }`；`calls` 记录每一次真实调用（含 `get`）。
 */
export function fakeWorkspaceRegistryForMounts({ workspaces = [] } = {}) {
  const calls = []
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  const trap = (name) => (...args) => {
    calls.push({ name, args })
    throw new Error(`票 12 只许**读**工作区：挂载 ≠ 归属（ADR-0009 第 3 条），不许调 ${name}`)
  }
  return {
    calls,
    workspaces,
    service: {
      list: () => {
        calls.push({ name: 'list' })
        return workspaces.map((workspace) => ({ ...workspace }))
      },
      get: (id) => {
        calls.push({ name: 'get', args: [id] })
        return byId.get(id)
      },
      resolveByPath: (path) => {
        calls.push({ name: 'resolveByPath', args: [path] })
        return workspaces.find((workspace) => workspace.path === path)
      },
      create: trap('create'),
      attachSession: trap('attachSession'),
      detachSession: trap('detachSession'),
    },
  }
}

/**
 * 假 `ctx.fs`（**票 12 专用**）：读走**真** `node:fs`，写与编辑一律抛。
 *
 * 形状照 `@deepseek-ai/dsh-fs/lib/types/types.d.ts` 逐字段抄（本机只读核对）：
 *   `FsTarget = { targetKey, displayPath }`、
 *   `FsInfo = { version, type: 'file'|'directory'|'other', size? }`、
 *   `FsDirEntry = { name, type, target, version?, size? }`。
 * 读真文件系统而不是手搓 fixture，是为了让「读出来的内容」本身就是被判的东西；
 * 写方法做成抛，是因为 E.4 明说沙箱只在写路径设围栏 —— 票 12 **一次写都不该做**。
 *
 * @returns `{ calls, service }`；`calls` 记录每一次调用（含写方法的尝试）。
 */
export function fakeFsReader() {
  const calls = []
  const trap = (name) => (...args) => {
    calls.push({ name, args })
    throw new Error(`票 12 只读挂载内容：不许调 ctx.fs.${name}（E.4：沙箱只在写路径设围栏）`)
  }
  const target = (path) => ({ targetKey: `k:${path}`, displayPath: path })
  return {
    calls,
    service: {
      async resolve(path) {
        calls.push({ name: 'resolve', args: [path] })
        return target(path)
      },
      async stat(t) {
        calls.push({ name: 'stat', args: [t.displayPath] })
        try {
          const info = statSync(t.displayPath)
          return { version: 'v1', type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', size: info.size }
        } catch {
          return undefined
        }
      },
      async listDir(t) {
        calls.push({ name: 'listDir', args: [t.displayPath] })
        return readdirSync(t.displayPath, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
          target: target(join(t.displayPath, entry.name)),
          version: 'v1',
        }))
      },
      async readText(t) {
        calls.push({ name: 'readText', args: [t.displayPath] })
        return readFileSync(t.displayPath, 'utf8')
      },
      writeText: trap('writeText'),
      editText: trap('editText'),
    },
  }
}

/** 造一条 `user/message` 会话事件（形状照 `dsh-session` 的 SessionEvent）。 */
export function userEvent(seq, message, time) {
  return { type: 'user/message', seq, time, data: message }
}

/** 造一条 `assistant/message` 会话事件。 */
export function assistantEvent(seq, text, time) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: { turn: 1, step: 1, message: { id: `m${seq}`, role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text }] }, stream: [] },
  }
}
