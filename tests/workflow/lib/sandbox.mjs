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
import { pruneStaleDirs } from '../../lib/sandbox-prune.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const TMP_ROOT = join(HERE, '..', '.tmp')

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

/**
 * 假 `ctx.skills`：注册表面（`list(options)` / `get(name, options)`）。
 *
 * **两个方法都是 async**，与真机一致：`SkillRegistry.list(options?) => Promise<SkillSummary[]>`、
 * `get(name, options?) => Promise<SkillDefinition|undefined>`（`dsh-skill/lib/types/index.d.ts`）。
 * 第一版这里写成同步的，于是「没 await」这个真缺陷在断言台里永远看不见 —— 真机跑一次才现形。
 */
export function fakeSkills(entries = []) {
  const calls = []
  return {
    calls,
    entries,
    async list(options = {}) {
      calls.push({ method: 'list', options })
      return entries
    },
    async get(name, options = {}) {
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
