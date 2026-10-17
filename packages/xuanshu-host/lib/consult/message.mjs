/**
 * packages/xuanshu-host/lib/consult/message.mjs — 注入消息的载体与来源标记（ADR-0009 第 5 条，契约 §3）。
 *
 * **为什么用自定义 `MessageSourceMap` kind**：这是 DSH 显式 merge-extensible 的合并点
 * （`dsh-llm/lib/types/message.d.ts:95-108`：each producer declares its own `kind`），
 * 持久化侧只要求 kind 是「非空字符串且 ≠ `'plugin'`」，未知 kind 原样保留
 * （`dsh-session-format-v3-to-v4/lib/index.js:123-137`）；轨迹 UI 把 `kind !== 'user'` 的
 * user/message 渲染成一条「注入」行，标签就是 kind 本身（`dsh-client-ui-trajectory/lib/client.js:563-588`）。
 * 声明形状（TS 侧）逐字如此，本仓是 `.mjs`，所以写成注释而不是 `declare module`：
 *
 *   declare module '@deepseek-ai/dsh-llm' {
 *     interface MessageSourceMap { 'xuanshu-consult': { kind: 'xuanshu-consult' } }
 *   }
 *
 * **为什么要「官方构造函数 + 本地兜底」两条路**：真机上本插件装在
 * `<profile>/node_modules/xuanshu-host`，`@deepseek-ai/dsh-llm/message` 从那里一路向上就能解析到；
 * 而断言台跑在**仓库检出**里（没有 profile 那棵树），静态 import 会让整个 `consult.*` 在测试里
 * 直接 import 失败。于是：能解析到官方 `createUserMessage` 就用它；解析不到就用下面这份
 * **逐字照抄**的本地实现（`createMessage()`：`deepFreeze(structuredClone({...input, id: uuid}))`，
 * 证据 `dsh-llm/lib/index.js:29-42,59-64`）。两条路产出的消息形状完全一致 —— 有断言台对照用例钉住。
 */
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 注入消息的来源 kind（ADR-0009 的定值；改了等于改了轨迹里的标签与持久化数据）。 */
export const CONSULT_MESSAGE_SOURCE_KIND = 'xuanshu-consult'

/** 本模块文件 → 包根（`<pkg>/lib/consult/message.mjs` → `<pkg>`）。 */
const PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/** 深冻结（官方 `deepFreeze` 的等价物：消息一旦发布就不该被就地改）。 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

/** 本地兜底：形状与语义逐字照抄官方 `createUserMessage()`。 */
export function createFallbackUserMessage(input) {
  return deepFreeze(structuredClone({ ...input, role: 'user', id: randomUUID() }))
}

/**
 * 从一个安装锚点解析 `@deepseek-ai/dsh-llm/message`。
 * @param {string[]} searchDirs 候选锚点（各自当 package.json 所在目录用）
 * @returns {string|null} 模块文件的 file:// URL；都解析不到 → null
 */
export function resolveMessageModuleHref(searchDirs) {
  for (const dir of searchDirs) {
    if (typeof dir !== 'string' || dir === '') continue
    try {
      const require = createRequire(join(dir, 'package.json'))
      return pathToFileURL(require.resolve('@deepseek-ai/dsh-llm/message')).href
    } catch {
      /* 换下一个锚点：任何一个装得上都行 */
    }
  }
  return null
}

/**
 * 取 `createUserMessage` 工厂：优先官方实现，解析不到就用本地等价物。
 * @param {string[]} [searchDirs] 额外锚点（profile 目录等）；包根与 cwd 永远会试
 * @returns {Promise<Function>}
 */
export async function loadCreateUserMessage(searchDirs = []) {
  const href = resolveMessageModuleHref([...searchDirs, PACKAGE_ROOT, process.cwd()])
  if (href !== null) {
    try {
      const module = await import(href)
      if (typeof module.createUserMessage === 'function') return module.createUserMessage
    } catch {
      /* 解析到却 import 不动（版本/布局变了）：退回本地等价物，消息形状不变 */
    }
  }
  return createFallbackUserMessage
}

/**
 * 注入消息（首轮上下文）：`source.kind = xuanshu-consult`。
 * 轨迹里它会显示成一条「注入」行而不是用户消息 —— 这正是我们要的（用户没说过这段）。
 */
export async function createConsultContextMessage(text, { searchDirs = [] } = {}) {
  const createUserMessage = await loadCreateUserMessage(searchDirs)
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: CONSULT_MESSAGE_SOURCE_KIND } })
}

/** 用户的问题：普通用户消息（`kind: 'user'`），好让它与注入行在轨迹里分得开。 */
export async function createConsultQuestionMessage(text, { searchDirs = [] } = {}) {
  const createUserMessage = await loadCreateUserMessage(searchDirs)
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** 票 11 采用稿的来源 kind：轨迹里显示成一条「注入」行，标签就是它。 */
export const BESTOF_ADOPTED_SOURCE_KIND = 'xuanshu-bestof-adopted'

/**
 * 票 11：**被人采用的那一份**合参稿。
 *
 * 为什么是「用户消息 + 自定义 source kind」而不是别的载体：会话日志只接受**已登记**的事件
 * 类型（`user/message` 是其一），而 `source` 是 DSH 显式 merge-extensible 的合并点 ——
 * 于是这一份既能落进历史（后续轮次看得见），又不会被当成用户本人的原话
 * （轨迹里渲染成「注入」行）。**落选候选永远不走这条路**（旁挂 `bestof` 记录是候选的唯一权威）。
 *
 * 内容前面那一行是**说明**，不是伪装：告诉模型这一段是谁放进来的。
 */
export async function createBestofAdoptedMessage(text, { searchDirs = [], merged = false } = {}) {
  const createUserMessage = await loadCreateUserMessage(searchDirs)
  const label = merged ? '【已采用的多 AI 合参稿（合并稿）】' : '【已采用的多 AI 合参稿】'
  return createUserMessage({
    content: [{ type: 'text', text: `${label}\n${text}` }],
    source: { kind: BESTOF_ADOPTED_SOURCE_KIND },
  })
}
