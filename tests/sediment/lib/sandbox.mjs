/**
 * tests/sediment/lib/sandbox.mjs — 票 15 断言台的**外界替身**：一次性 dataDir + 假 agents / 假 sessionQuery。
 *
 * 硬约束（与票 10 断言台同款纪律）：
 *   - **零网络、零真实会话、零真实 LLM**：`sediment.*` 只被允许通过 `ctx.agents` 碰会话、
 *     通过 `ctx.sessionQuery.readSession` 读正文、通过 `ctx.on('session/event')` 等 `turn/end`，
 *     所以断言台给的就是普通对象替身，一次真实 turn 都不跑；
 *   - **零自造形状**：目标谱用票 09 的**真** `createPuRepository().confirm()` 落盘，
 *     问事旁挂清单用票 10 的**真** `createConsultStore()` 落盘 ——
 *     不手搓 manifest.md / summary.md / 旁挂 JSON，免得「测试绿了，真实现读不出来」；
 *   - **假 agent 的 `whenIdle()` 直接抛**：票 15 若拿 `whenIdle()` 当「一轮结束」用，这里立刻红
 *     （证据 `dsh-agent/lib/types/runtime-types.d.ts:164`：`whenIdle()` 不标识某条消息的结束）；
 *   - 临时产物落 `tests/sediment/.tmp/**`（`.gitignore` 覆盖 `tests/***​/.tmp/`），绝不碰真实 `~/.dsh`。
 *
 * 与本文件配套的**驱动方式**：`turnScript()` 让用例自己安排「followup 之后发生什么」——
 * 发一条 `turn/end` 事件、塞一条 `assistant/message` 到会话日志。真机上的这两件事由 DSH 的
 * agent loop 与持久化层做，断言台只重放它们对 `sediment.*` 可见的那一面。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createConsultStore, newConsultSessionId } from '../../../packages/xuanshu-host/lib/consult/store.mjs'
import { createPuRepository } from '../../../packages/xuanshu-host/lib/pu/repository.mjs'
import { pruneStaleDirs } from '../../lib/sandbox-prune.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 断言台自己的临时区（`tests/sediment/.tmp`，gitignore 覆盖）。 */
export const TMP_ROOT = join(HERE, '..', '.tmp')

/**
 * 清理上一次运行留下的旧沙箱（超过 `SANDBOX_STALE_MS`）。
 *
 * 实现收在 `tests/lib/sandbox-prune.mjs`（**单一来源**）：这段逻辑曾经在 7 个域的沙箱里各抄一份，
 * 然后漂移了 —— bazi / consult / sediment 三处把比较写反（删的是**刚建**的沙箱、旧件永不清，
 * 并发跑还会互删现场）。共享文件头部记了来龙去脉与判据。
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
    /**
     * 「磁盘上的每个字节」快照：路径 → 内容（文本按 UTF-8 读）。
     *
     * 负路径的判据是**一个字节都不许变**，所以断言比对的是这份快照，而不是「文件列表没变」——
     * 后者挡不住「同名文件被改写」这种最像成功的失败。
     */
    snapshot() {
      const out = {}
      for (const rel of this.files()) out[rel] = readFileSync(join(dataDir, ...rel.split('/')), 'utf8')
      return out
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/**
 * 造一个宿主 ctx。
 *
 * `ctx.get(name, false)` 是**唯一**的取服务方式（与 `lib/bazi/service.mjs` 的软取同款）；
 * 每次取用都记进 `lookups`，于是「有没有碰 `ctx.sessions` / `workspaceRegistry`」有客观判据。
 *
 * @param {{services?: object, wired?: boolean}} [options]
 *        `wired:true` 时 `ctx.inject()` 会回调一个带 `connection.rpc.handle` / `skills` /
 *        `webServer` 的 scoped ctx —— 总装配用例（真 `apply()`）走这条路，服务级用例不需要。
 */
export function makeHost({ services = {}, wired = false } = {}) {
  const lookups = []
  const listeners = []
  const provided = new Map()
  const skills = []
  const routes = []
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
      callback()
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
        skills: {
          register(skill) {
            skills.push({ names: [...names], skill })
            return () => {}
          },
        },
        connection: {
          rpc: {
            handle(path, handler) {
              routes.push({ path, handler })
              return () => {}
            },
          },
        },
        webServer: { register: () => () => {} },
        storageDomain: { open: () => ({}) },
      })
      return () => {}
    }
  }
  /** 触发一个宿主事件（只打本替身记下的监听器）。 */
  const emit = (event, ...args) => {
    for (const entry of [...listeners]) if (entry.event === event) entry.listener(...args)
  }
  /** 当前还挂着的监听器数（「等到了就退订」这类断言的判据）。 */
  const listenerCount = (event) => listeners.filter((entry) => entry.event === event).length
  return { ctx, lookups, listeners, emit, listenerCount, provided, services, skills, routes }
}

/** 假 agent：按调用顺序记 inject / followup（顺序本身也是被验的东西）。 */
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
    /** 票 15 不许拿它当「一轮结束」（`dsh-agent/lib/types/runtime-types.d.ts:164`）。 */
    whenIdle() {
      throw new Error('票 15 不许用 whenIdle() 判定一轮结束：它不标识某条消息的结束（runtime-types.d.ts:164）。')
    },
  }
}

/**
 * 假 `ctx.agents`：记录 create/get/resume，并按 id 交出可观察的假 agent。
 *
 * `followup()` 之外还提供 `onFollowup(cb)`：用例据它安排「这一轮之后会发生什么」
 * （发 `turn/end`、把答案写进会话日志）。真机上那是 agent loop 的事，这里只重放它的可观察面。
 */
export function fakeAgents() {
  const created = []
  const resumed = []
  const disposed = []
  const followups = []
  const callbacks = []
  const live = new Map()
  const make = (sessionId) => {
    const agent = fakeAgent(sessionId)
    const original = agent.followup.bind(agent)
    agent.followup = (message) => {
      original(message)
      followups.push({ sessionId, message })
      for (const callback of [...callbacks]) callback({ sessionId, message })
    }
    live.set(sessionId, agent)
    return agent
  }
  return {
    created,
    resumed,
    disposed,
    followups,
    live,
    /** 注册「followup 之后跑什么」；返回注销函数。 */
    onFollowup(callback) {
      callbacks.push(callback)
      return () => {
        const index = callbacks.indexOf(callback)
        if (index >= 0) callbacks.splice(index, 1)
      }
    },
    service: {
      async create(options) {
        created.push(options)
        return { agent: make(options.sessionId), async dispose() { disposed.push(options.sessionId) } }
      },
      get(id) {
        return live.get(id)
      },
      async resume(options) {
        resumed.push(options)
        return { agent: make(options.resumeSessionId), async dispose() { disposed.push(options.resumeSessionId) } }
      },
    },
  }
}

/** 假 `ctx.sessionQuery`：只实现 `readSession`，没登记的会话按上游错误码抛。 */
export function fakeSessionQuery(eventsBySession = {}) {
  const calls = []
  const events = { ...eventsBySession }
  return {
    calls,
    events,
    service: {
      async readSession(sessionId) {
        calls.push(sessionId)
        if (!Object.hasOwn(events, sessionId)) {
          const error = new Error(`session "${sessionId}" not found`)
          error.code = 'SESSION_QUERY_SESSION_NOT_FOUND'
          throw error
        }
        return { session: { id: sessionId, version: 4 }, inheritedEventCount: 0, events: events[sessionId] }
      },
    },
  }
}

/**
 * 造一条 `user/message` 会话事件（形状照 `dsh-session` 的 SessionEvent）。
 * @param {number} seq 事件序号
 * @param {{text?: string, source?: object}} [options] 文本与来源标记
 */
export function userEvent(seq, { text = '问一句', source = { kind: 'user' } } = {}, time = 0) {
  return { type: 'user/message', seq, time, data: { id: `u${seq}`, role: 'user', content: [{ type: 'text', text }], source } }
}

/** 造一条 `assistant/message` 会话事件（`source.kind='model'`，形状照真日志）。 */
export function assistantEvent(seq, text, time = 0) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn: 1,
      step: 1,
      message: { id: `m${seq}`, role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text }] },
      stream: [],
    },
  }
}

/** 造一条 `turn/end` 事件（`waitForTurnEnd` 的判据）。 */
export function turnEndEvent(seq, turn = 1, time = 0) {
  return { type: 'turn/end', seq, time, data: { turn, reason: { kind: 'completed' } } }
}

/** 假 `ctx.agentPresets` / `ctx.agentDefaultModel`：生产形态的两个服务（缺一个就开不了口）。 */
export function fakeAgentPresets({ default: defaultId = 'standard' } = {}) {
  const mounted = []
  return {
    mounted,
    service: {
      async resolve(id) {
        return { id: id ?? defaultId }
      },
      async mount(agentCtx, id) {
        mounted.push({ agentCtx, id })
        return { id }
      },
    },
  }
}

export function fakeAgentDefaultModel(selection = { provider: 'deepseek', model: 'deepseek-chat' }) {
  return { service: { currentSelection: () => ({ ...selection }) } }
}

/**
 * 用票 09 的**真** repository 落一个可选谱（`pus/<slug>/{manifest,summary,content}.md`）。
 * @returns 落盘后的谱对象
 */
export function seedPu(sandbox, { name, level = 'optional', description, summary, body }) {
  return createPuRepository(sandbox.dataDir).confirm(
    {
      name,
      level,
      description,
      summary,
      body: body ?? `# ${name}（概览）\n${description}\n\n## 正文\n这里是《${name}》的旧正文。\n`,
    },
    true,
  )
}

/**
 * 用票 10 的**真**旁挂清单仓落一个问事会话（`consult/sessions/<id>.json`）。
 * @param {{pus?: string[], turns?: number, title?: string}} [options]
 * @returns 旁挂清单（含自铸的 `session-xs-consult-…` id）
 */
export function seedConsult(sandbox, { pus = [], turns = 1, title } = {}) {
  const store = createConsultStore(sandbox.dataDir)
  const sessionId = newConsultSessionId()
  store.create({ sessionId, pus })
  if (turns !== 0) store.update(sessionId, { turns })
  if (typeof title === 'string') store.update(sessionId, { title })
  return store.read(sessionId)
}

/**
 * 一份合法的 AI 草稿回答（模型按 skill 要求吐的 JSON 文本）。
 * 期望值来自**规格**（skill 正文要求的四个字段），不是从实现里复算出来的。
 */
export function draftAnswer(overrides = {}) {
  const payload = {
    description: '近一年事业判断的沉淀：以稳为主，4—6 月有一次岗位变动窗口。',
    body: '# 概览\n近一年事业判断的沉淀。\n\n## 近一年判断\n今年以稳为主；4—6 月有一次岗位变动，适合先谈条件再定去留。\n',
    summary: '事业：稳为主，4—6 月有岗位变动窗口。',
    ...overrides,
  }
  return JSON.stringify(payload)
}

/** 模型把 JSON 包在代码围栏里（真机上很常见，解析必须容忍）。 */
export function fencedDraftAnswer(overrides = {}) {
  return '```json\n' + draftAnswer(overrides) + '\n```'
}
