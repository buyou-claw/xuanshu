/**
 * tests/workflow/lib/sandbox.mjs — 票 16 断言台的外界替身（零网络、零真实 LLM、零真实 skill 注册表）。
 *
 * 三样替身，每样对着一处「真机上会咬人」的地方：
 *   - `fakeAgentFactory`：`ctx.agents.create` 的句柄形状（`{ agent: { followup } }`）——种子发没发出去看它；
 *   - `fakeSkills`：`ctx.skills.list({scope})` 的注册表面（含「同名被别人占了」的现场）；
 *   - `fakePresets` / `fakeDefaultModel`：能力门的两条依赖（缺任一条就建不出能跑的会话）。
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const TMP_ROOT = join(HERE, '..', '.tmp')

const STALE_MS = 6 * 60 * 60 * 1000

function pruneStale() {
  if (!existsSync(TMP_ROOT)) return
  const now = Date.now()
  for (const entry of readdirSync(TMP_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      if (now - statSync(join(TMP_ROOT, entry.name)).mtimeMs > STALE_MS) rmSync(join(TMP_ROOT, entry.name), { recursive: true, force: true })
    } catch {
      /* Windows 上偶发 EBUSY：临时区是 gitignore 的，留着无害 */
    }
  }
}

/** 一个一次性 dshHome（`<dshHome>/xuanshu` 是 dataDir，`<dshHome>/skills` 是 skill 扫描根）。 */
export function makeSandbox(label) {
  mkdirSync(TMP_ROOT, { recursive: true })
  pruneStale()
  const root = mkdtempSync(join(TMP_ROOT, `${label}-`))
  const dshHome = join(root, 'dsh-home')
  const dataDir = join(dshHome, 'xuanshu')
  mkdirSync(dataDir, { recursive: true })
  return {
    root,
    dshHome,
    dataDir,
    path: (...parts) => join(root, ...parts),
    read(file) {
      return readFileSync(file, 'utf8')
    },
    exists(file) {
      return existsSync(file)
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
      if (existsSync(root)) walk(root, '')
      return out.sort()
    },
    write(file, value) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, value)
      return file
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** 假 `ctx.agents`：记 create 入参，给一个可 `followup` 的句柄。 */
export function fakeAgents({ fail = false } = {}) {
  const calls = []
  const messages = []
  return {
    calls,
    messages,
    async create(options) {
      calls.push(options)
      if (fail) throw new Error('fixture: agents.create 失败')
      return {
        sessionId: options.sessionId,
        agent: {
          followup(message) {
            messages.push({ sessionId: options.sessionId, message })
          },
        },
      }
    },
  }
}

/** 假 `ctx.agentPresets`（能力门的一半）。 */
export function fakePresets({ id = 'standard' } = {}) {
  const mounted = []
  return {
    mounted,
    async resolve(requested) {
      return { id: requested ?? id }
    },
    async mount(agentCtx, presetId) {
      mounted.push(presetId)
    },
  }
}

/** 假 `ctx.agentDefaultModel`（能力门的另一半）。 */
export function fakeDefaultModel({ provider = 'fake-provider', model = 'fake-model' } = {}) {
  return { currentSelection: () => (provider === null ? undefined : { provider, model }) }
}

/** 假 `ctx.skills`：注册表面（`list(options)` / `get(name, options)`）。 */
export function fakeSkills(entries = []) {
  const calls = []
  return {
    calls,
    entries,
    list(options = {}) {
      calls.push({ method: 'list', options })
      return entries
    },
    get(name, options = {}) {
      calls.push({ method: 'get', name, options })
      return entries.find((entry) => entry.name === name)
    },
  }
}

/** 造宿主 ctx：`ctx.get(name, false)` 是唯一取服务的方式（cordis 非严格软取同款）。 */
export function makeCtx(services = {}) {
  const ctx = {
    get(name) {
      return services[name]
    },
  }
  for (const [name, value] of Object.entries(services)) if (value !== undefined) ctx[name] = value
  return ctx
}

/** 消息形状断言辅助：取出 followup 消息里的文本。 */
export function messageText(message) {
  return (message?.content ?? []).filter((block) => block?.type === 'text').map((block) => block.text).join('\n')
}
