/**
 * tests/digao/lib/sandbox.mjs — 票 13 断言台的外界替身（底稿与日课共用）。
 *
 * 硬约束：
 *   - **零网络、零真实 horosa、零真实定时**：`ctx` 是一个普通对象，`ctx.schedule` / `ctx.llm` /
 *     `ctx.agents` 都是**记调用**的替身，断言打在「调了什么」与「落了哪些文件」上；
 *   - 临时产物落 `tests/digao/.tmp/**`（`.gitignore` 已覆盖 `tests/**​/.tmp/`），绝不碰真实 `~/.dsh`。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pruneStaleDirs } from '../../lib/sandbox-prune.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 断言台自己的临时区。 */
export const TMP_ROOT = join(HERE, '..', '.tmp')
/** 票 06 已捕获的真实信封（票 13 的信封 fixture 也放这里，见 fixtures/envelopes/PROVENANCE.md）。 */
export const ENVELOPES_DIR = join(HERE, '..', '..', 'horosa', 'fixtures', 'envelopes')

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

/** 一个一次性 dataDir。 */
export function makeSandbox(label) {
  mkdirSync(TMP_ROOT, { recursive: true })
  pruneStale()
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
      return existsSync(join(dataDir, ...parts))
    },
    /** 递归列出沙箱里的文件（相对 dataDir 的 posix 路径，字典序）——「落了哪些盘」的判据。 */
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

/** 读一份真实信封 fixture。 */
export function envelope(name) {
  return JSON.parse(readFileSync(join(ENVELOPES_DIR, `${name}.json`), 'utf8'))
}

/**
 * 假 `xuanshuHorosa` 服务（票 13 只用 `callTool`，见票 08 契约的 `baziBirth` 同族形状）。
 *
 * 回放**真机捕获**的信封：`callTool` 的 `ok` 语义 = 「调用走到了信封」，
 * 业务成败看信封自己的 `ok`（与真服务逐字同义）。
 * @param {object} fixture 信封（真机捕获）
 */
export function fakeHorosa(fixture) {
  const calls = []
  const service = {
    async callTool(name, args, options) {
      calls.push({ name, args, options })
      return { ok: true, envelope: fixture, tool: name, code: null, detail: `tools/call ${name} 拿到信封`, from: 'content.text', evidence: {} }
    },
  }
  return { service, calls }
}

/** horosa 服务没起来 / 没有 callTool 这条缝（旧面或假服务不完整）时的现场。 */
export function horosaWithoutCallTool() {
  return { service: { baziBirth: async () => ({ phase: 'ok' }) }, calls: [] }
}

/**
 * 造一个宿主 ctx 替身。
 * @param {{services?: object, schedule?: object, llm?: object, agents?: object, workspaceRegistry?: object}} parts
 */
export function makeCtx(parts = {}) {
  const services = { ...(parts.services ?? {}) }
  const calls = { agents: [], schedule: [], llm: [] }

  if (parts.agents !== undefined) services.agents = parts.agents
  if (parts.schedule !== undefined) services.schedule = parts.schedule
  if (parts.llm !== undefined) services.llm = parts.llm
  if (parts.workspaceRegistry !== undefined) services.workspaceRegistry = parts.workspaceRegistry

  const ctx = {
    calls,
    get(name) {
      return services[name]
    },
  }
  for (const [name, value] of Object.entries(services)) if (value !== undefined) ctx[name] = value
  return ctx
}

/**
 * 记调用的 `ctx.schedule` 替身（形状照 `dsh-schedule` 的 ScheduleService 面）。
 * @param {{catalog?: object[]}} [options] 预置的已有任务（验幂等：不该再 create）
 */
export function fakeSchedule({ catalog = [] } = {}) {
  const tasks = [...catalog]
  const calls = []
  let seq = 0
  return {
    tasks,
    calls,
    async create(sessionId, request) {
      calls.push({ method: 'create', sessionId, request })
      seq += 1
      const record = {
        id: `sched-${seq}`,
        kind: 'daily',
        title: request.title,
        prompt: request.prompt,
        time: `${request.daily.time.length === 5 ? `${request.daily.time}:00` : request.daily.time}.000`,
        timeZone: request.daily.time_zone,
        scheduledAt: '2026-10-16T07:30:00.000Z',
        sessionId,
        status: 'active',
      }
      tasks.push(record)
      return record
    },
    async catalog() {
      calls.push({ method: 'catalog' })
      return tasks.map((task) => ({ ...task }))
    },
    async list(request) {
      calls.push({ method: 'list', request })
      return tasks.filter((task) => task.sessionId === request.sessionId).map((task) => ({ ...task }))
    },
    async update(request) {
      calls.push({ method: 'update', request })
      const index = tasks.findIndex((task) => task.id === request.id && task.sessionId === request.sessionId)
      if (index < 0) return { id: request.id, updated: false, code: 'schedule_not_found' }
      if (request.expected?.scheduledAt !== tasks[index].scheduledAt) return { id: request.id, updated: false, code: 'schedule_conflict' }
      tasks[index] = { ...tasks[index], ...(request.change?.daily ? { time: `${request.change.daily.time}:00.000`, timeZone: request.change.daily.time_zone } : {}) }
      return { id: request.id, updated: true, record: { ...tasks[index] } }
    },
  }
}

/** 记调用的 `ctx.agents` 替身（只用到 create）。 */
export function fakeAgents() {
  const calls = []
  return {
    calls,
    async create(options) {
      calls.push(options)
      return { sessionId: options.sessionId, id: options.sessionId }
    },
  }
}

/** 记调用的 `ctx.llm` 替身（形状照 `dsh-llm` 的 LlmRuntime：listProviders / listModels / stream）。 */export function fakeLlm({ text = '这是模型压出来的一段精简汇总。', fail = false } = {}) {
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

/**
 * 等一个条件成立（轮询），超时抛错（错误信息里带现场）。
 *
 * 为什么断言台需要它：两条 daily 定时任务的注册是**异步**的（`ctx.inject(['schedule'], …)` 的
 * 回调里跑 `agents.create` + `schedule.create`，两件都是 Promise 面），装配返回时它们可能还在飞。
 * 定时路径上用轮询而不是「睡固定毫秒」，是为了不把测试钉在机器的快慢上。
 */
export async function waitFor(condition, { timeoutMs = 3000, intervalMs = 5, describe = '条件' } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await condition()
    if (value) return value
    if (Date.now() >= deadline) throw new Error(`等${describe}超时（${timeoutMs}ms）`)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
