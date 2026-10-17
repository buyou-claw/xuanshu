/**
 * packages/xuanshu-host/lib/workflow/service.mjs — 票 16 的 `workflow.*` RPC 方法组（契约 §4）。
 *
 * | method | request | response |
 * |---|---|---|
 * | `workflow.create` | `{ seed? }` | `{ sessionId, cwd }` —— 新会话，**seed 自动调 `/writing-skills`** |
 * | `workflow.list` | `{}` | `{ items: [{ id, name, sessionId, exportedAt? }] }` |
 * | `workflow.exportSkill` | `{ sessionId, name, description, content }` | `{ path, name }` |
 *
 * **会话怎么建**（Lead 的硬要求）：照票 10 的既有做法，**不另写一套** —— 直接复用
 * `lib/consult/agent.mjs` 的 `createConsultAgent` / `consultAgentCapability`：
 *   - 没有 `agentPresets` 就没有工具（preset 行只在挂载出来的 scope 里激活）；
 *   - 没有 `agentDefaultModel` 就在第一轮请求前抛 `has no provider/model`（`dsh-agent-loop/lib/index.js:1185`）。
 *   所以 `workflow.create` **发问前**先过能力门：缺了就当场给可读理由，而不是回一个「创建成功」
 *   然后用户对着一个开不了口的会话发呆（与票 08「缺经纬度禁止出盘」同一条纪律）。
 *
 * **人判定跑通**（C8）：宿主侧**没有**任何「跑通 / 没跑通」的判定逻辑与字段 —— 导出是人的动作，
 * `workflow.exportSkill` 只负责「把已经决定要导出的东西写对」。会话里的判定条是客户端的事
 * （S12 ④），宿主不参与。
 *
 * **工作流不是谱**（CONTEXT.md）：本模块不读不写 `pus/**`，`workflow.list` 也不受谱目录影响。
 */

import { mkdirSync, rmSync } from 'node:fs'

import { resolveDataDir } from '../home.mjs'
import { consultAgentCapability, createConsultAgent } from '../consult/agent.mjs'
import { loadCreateUserMessage } from '../consult/message.mjs'
import { resolveSearchHome } from '../home.mjs'
import { exportSkillFile, skillDir, verifySkillRegistered } from './skill-export.mjs'
import {
  WORKFLOW_SCHEMA, isWorkflowSessionId, listWorkflows, nameFromSeed, newWorkflowSessionId,
  readWorkflow, toWorkflowItem, workflowCwd, writeWorkflow,
} from './store.mjs'

/** 种子要自动调起的命令（S12 §8：命令名不带前导斜杠注册，会话里用 `/writing-skills` 说起它）。 */
export const WRITING_SKILLS_COMMAND = '/writing-skills'

/** 请求对象兜底。 */
function requestOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/** 非空字符串规范化。 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 非严格读 cordis service。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/**
 * DSH home（skill 扫描根 `<dshHome>/skills` 的父目录）。
 *
 * **薄包装**：顺序（`config.dshHome` → `profileContext.home` → `dataDir` 父目录 → `$DSH_HOME` → 兜底）
 * 与「真实 `~/.dsh` 一律拒绝」的门都在 `home.mjs::resolveSearchHome()` 里 —— 复核 S1 之后本模块
 * 不再自己写一份顺序（从前它和 `shiji/scan.mjs` 各有一份，且后者没有那道门）。
 *
 * @param {object} ctx
 * @param {{dshHome?: string}} [config]
 * @param {string} [dataDir]
 * @param {{env?: Record<string, string|undefined>, homedirPath?: string}} [options] 纯函数接缝
 */
export function resolveDshHome(ctx, config, dataDir, options = {}) {
  return resolveSearchHome({
    ctx,
    dataDir,
    explicit: typeof config?.dshHome === 'string' ? config.dshHome : undefined,
    env: options.env ?? process.env,
    ...(options.homedirPath === undefined ? {} : { homedirPath: options.homedirPath }),
  }).home
}

/**
 * 种子的正文：**第一行就是命令**，让首轮直接进入 `/writing-skills` 的语境；
 * 后面才是用户写的要求（没写就明写「先问清」—— 种子不该替用户编要求）。
 */
export function seedText(seed) {
  const written = text(seed)
  const ask = written === ''
    ? '（用户还没写要求：先问清「这件反复要办的事是什么、输入是什么、期望产出是什么」，再动手。）'
    : written
  return `${WRITING_SKILLS_COMMAND}\n\n用户想要固化成一个可复用工作流的事情：\n${ask}`
}

/** 消息工厂的解析锚点（profile 目录优先；`loadCreateUserMessage` 自己还会试包根与 cwd）。 */
function messageSearchDirs(ctx, dshHome) {
  return [softGet(ctx, 'profileContext')?.dir, dshHome].filter((value) => typeof value === 'string' && value !== '')
}

/**
 * 建 `workflow.*` 方法组（契约 §4 的三个方法）。
 * @param {object} ctx cordis 宿主上下文
 * @param {{dataDir?: string, dshHome?: string, skillScope?: string}} [config]
 */
export function createWorkflowMethods(ctx, config = {}) {
  const dataDir = resolveDataDir(ctx, config)
  const dshHome = resolveDshHome(ctx, config, dataDir)
  /** 本进程建过的工作流会话句柄（seed 用；进程重启后靠门厅的 `[打开会话]` 走 DSH 原生会话）。 */
  const handles = new Map()

  return {
    /**
     * 创建工作流：新会话（带 DSH 全套 coding 工具）+ 种子自动调 `/writing-skills`。
     * @returns {Promise<{sessionId: string, cwd: string}>}
     */
    'workflow.create': async (request) => {
      const source = requestOf(request)

      // 能力门：缺 preset / 模型就当场说不行（理由见文件头）。
      const capability = consultAgentCapability(ctx)
      if (!capability.ok) {
        throw new Error(
          `宿主缺少 ${capability.missing.join('、')} 服务：工作流会话的工具（agent preset）与模型（provider/model）都来自它们，缺了就跑不了一轮。`
          + '修复路径：确认 profile 装配里这两行在（web 层由 @deepseek-ai/dsh-web-app 的 preset 名册提供 default: standard），'
          + '用 `dsh --profile xuanshu --dump-config` 或 /xuanshu-report 核对装配报告。',
        )
      }

      const sessionId = newWorkflowSessionId()
      const cwd = workflowCwd(dataDir)
      const createdAt = new Date().toISOString()
      const record = {
        schema: WORKFLOW_SCHEMA,
        id: sessionId,
        name: nameFromSeed(source.seed),
        sessionId,
        cwd,
        seed: text(source.seed),
        createdAt,
      }

      // 先建会话、再落清单：清单是「这个会话确实建起来了」的凭据，反过来会产生「列表里有、点开打不开」。
      mkdirSync(cwd, { recursive: true })
      let handle
      try {
        handle = await createConsultAgent(ctx, { sessionId, cwd })
      } catch (error) {
        throw new Error(`建工作流会话失败：${String(error?.message ?? error)}`)
      }
      handles.set(sessionId, handle)
      writeWorkflow(dataDir, record)

      // 种子：一条**普通用户消息**（`source.kind='user'`），首行是 `/writing-skills`。
      // 走 `followup()` 而不是 `inject()` —— 种子的目的就是**开一个 turn**（`inject` 不唤醒）。
      const agent = handle?.agent
      if (typeof agent?.followup !== 'function') {
        throw new Error('会话建起来了，但拿不到它的 agent（不能发种子消息）：请把这条会话当普通会话用，或重试创建。')
      }
      try {
        const createUserMessage = await loadCreateUserMessage(messageSearchDirs(ctx, dshHome))
        agent.followup(createUserMessage({ content: [{ type: 'text', text: seedText(source.seed) }], source: { kind: 'user' } }))
      } catch (error) {
        throw new Error(`种子消息没发出去（会话已建好，可手动在会话里调 ${WRITING_SKILLS_COMMAND}）：${String(error?.message ?? error)}`)
      }

      return { sessionId, cwd }
    },

    /** 门厅列表：进行中 + 已导出（导出过的条目多一个 `exportedAt`）。 */
    'workflow.list': async () => ({ items: listWorkflows(dataDir).map(toWorkflowItem) }),

    /**
     * 导出 skill（**人的动作**：界面上的判定条由人点，宿主只负责写对）。
     * 失败一律抛可读错误：同名冲突、名字不合规、正文为空、写完读回不一致都不许报成功。
     * @returns {Promise<{path: string, name: string}>}
     */
    'workflow.exportSkill': async (request) => {
      const source = requestOf(request)
      const sessionId = text(source.sessionId)
      if (!isWorkflowSessionId(sessionId)) throw new Error(`sessionId 不是玄枢的工作流会话（要 ${'session-xs-workflow-<uuid>'}）：${JSON.stringify(source.sessionId)}`)
      const record = readWorkflow(dataDir, sessionId)
      if (record === null) throw new Error('这个会话不在工作流清单里：导出要有一个可追溯的会话（先创建工作流）。')

      const description = text(source.description)
      const content = text(source.content)
      if (description === '') throw new Error('导出 skill 需要 description（DSH 把它当必填，缺了会整个忽略这个 skill）。')
      if (content === '') throw new Error('导出 skill 需要正文（把会话里跑通的那套步骤写进去）。')

      const result = exportSkillFile({ dshHome, name: source.name, description, content })

      // 写完立刻读回验证（第 ① 步在 exportSkillFile 里做了磁盘重解析；这里是第 ② 步：注册表）。
      // `await` 不能少：`ctx.skills.list()` 是 `Promise<SkillSummary[]>`（真机取证改出来的缺陷）。
      const registry = await verifySkillRegistered(ctx, { name: result.name, description, scope: config.skillScope })
      if (registry.conflict) {
        // 名字被别人占了：**回滚刚写的那一份**，别在别人的 skill 上盖一层同名目录。
        try {
          rmSync(skillDir(dshHome, result.name), { recursive: true, force: true })
        } catch {
          /* 回滚失败不掩盖真正的原因 */
        }
        throw new Error(registry.reason)
      }

      writeWorkflow(dataDir, {
        ...record,
        name: result.name,
        skillName: result.name,
        skillPath: result.path,
        exportedAt: new Date().toISOString(),
      })
      return { path: result.path, name: result.name }
    },
  }
}
