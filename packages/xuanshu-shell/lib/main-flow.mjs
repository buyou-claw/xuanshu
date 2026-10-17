/**
 * packages/xuanshu-shell/lib/main-flow.mjs — 壳入口里**会做判断**的那几块（纯函数，无 electron）。
 *
 * 为什么单独有这一个文件（复核 S3）：`main.mjs` 的文件头从前写着「只有接线、几乎没有逻辑、
 * 且都被测试覆盖」，但它实际承担了三块判断 —— 参数解析、状态页 / 首页之间的 phase 改写、
 * 参数错误后的 `exit(1)`。而 `main.mjs` 自己无法在 CI 里 import（它顶层就要 electron），
 * 所以那三块判断一条测试都没有；早期退出还会继续初始化（IIFE 兜底返回后，单实例与 bootstrap
 * 照跑）。现在判断都在这里，`main.mjs` 只剩「把这些函数接到适配器上」。
 *
 * 边界：
 *   - 本文件**不** import electron、不读 `process.env`、不读盘（env 由调用方给）；
 *   - 判据只回答「该做什么」，不替调用方做（错误框 / exit / 启动由 `startShell()` 的注入面执行，
 *     于是「退出之后不启动」这件事本身也能被断言）。
 */

import { DEFAULT_PROFILE, DEFAULT_WEB_PORT } from './contract.mjs'

/** 状态页覆盖的「窗口层失败」文案（看护状态本身不被篡改）。 */
export const WINDOW_FAILURE_PHASE = 'failed'

/**
 * 解析壳自己的命令行开关（开发期用；产品形态靠环境变量与默认 home）。
 *
 * @param {string[]} argv `process.argv.slice(2)`
 * @returns {{home?: string, profile?: string, port?: number}}
 */
export function parseShellArgs(argv) {
  const list = Array.isArray(argv) ? argv : []
  const options = { home: undefined, profile: undefined, port: undefined }
  for (let index = 0; index < list.length; index += 1) {
    const arg = list[index]
    if (arg === '--home') options.home = list[++index]
    else if (arg === '--profile') options.profile = list[++index]
    else if (arg === '--port') {
      const port = Number(list[++index])
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--port 需要 1..65535 的整数（拿到 ${list[index]}）`)
      options.port = port
    } else if (arg === '--') {
      continue
    } else if (arg.startsWith('-')) {
      throw new Error(`未知的壳参数：${arg}`)
    }
  }
  return options
}

/**
 * 启动计划：参数合法 → `{ok:true, options, profile, webPort}`；不合法 → `{ok:false, message}`。
 *
 * **这是「要不要启动」的唯一判断**：`ok:false` 的调用方只做错误框 + exit(1)，
 * 不再注册单实例、不再 `bootstrap()`（复核 S3 的 IIFE 继续初始化就是漏了这一步）。
 *
 * @param {string[]} argv
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ok: true, options: object, profile: string, webPort: number} | {ok: false, message: string}}
 */
export function planStartup(argv, env = {}) {
  let options
  try {
    options = parseShellArgs(argv)
  } catch (error) {
    return { ok: false, message: String(error?.message ?? error) }
  }
  const fromEnv = typeof env?.XUANSHU_PROFILE === 'string' && env.XUANSHU_PROFILE !== '' ? env.XUANSHU_PROFILE : undefined
  return {
    ok: true,
    options,
    profile: options.profile ?? fromEnv ?? DEFAULT_PROFILE,
    webPort: options.port ?? DEFAULT_WEB_PORT,
  }
}

/**
 * 早期退出的唯一入口（**不启动**就是这里返回 `started:false`）。
 *
 * @param {{plan: object, showErrorBox: Function, exit: Function, start: Function}} options
 * @returns {{started: boolean}}
 */
export function startShell({ plan, showErrorBox, exit, start }) {
  if (plan?.ok !== true) {
    showErrorBox?.('玄枢启动失败', String(plan?.message ?? '未知的启动参数错误'))
    exit?.(1)
    return { started: false }
  }
  start?.(plan)
  return { started: true }
}

/**
 * 壳的运行时状态 → 状态页视图模型的输入（`view()` 的全部判断）。
 *
 * 页面加载失败是**窗口这一层**的失败：看护状态不被篡改（子进程可能好好的），
 * 但状态页必须显示「窗口加载失败」而不是「服务已就绪」。
 *
 * @param {{supervisor: object, autostart: object, notification: object, windowError?: string}} state
 */
export function shellStatusViewInput({ supervisor, autostart, notification, windowError } = {}) {
  return {
    supervisorState: windowError === undefined ? supervisor : { phase: WINDOW_FAILURE_PHASE, detail: windowError },
    autostart,
    notification,
  }
}

/**
 * 收到看护状态后该做什么：加载 URL / 留在状态页 / 什么都不变。
 *
 * `keep` 是「同一个 URL 不重复加载」——重拉成功但地址没变时不该把用户正在看的页面刷掉。
 *
 * @param {{supervisor?: object, lastLoadedUrl?: string}} input
 * @returns {{kind: 'load', url: string} | {kind: 'keep', url: string} | {kind: 'status'}}
 */
export function nextSupervisorLoad({ supervisor, lastLoadedUrl } = {}) {
  const url = supervisor?.phase === 'ready' && typeof supervisor.url === 'string' ? supervisor.url : ''
  if (url === '') return { kind: 'status' }
  return lastLoadedUrl === url ? { kind: 'keep', url } : { kind: 'load', url }
}

/* ───────────────────── 点通知 → overview（P2 复核 #24） ───────────────────── */

/**
 * 通知点击后前端要落的 hash（**不带** `#`；与客户端 `overview-hash.ts` 同一个值）。
 *
 * 两侧对拍：`tests/shell/contract-parity.test.mjs` 直接 import 本常量与客户端那份并断言相等 +
 * 握手闭环（R8 / #39）——改任一侧的值会让那组用例红。
 *
 * 为什么用 hash：前端**没有路由**（契约 §7），但票面验收要求「点通知停在 overview」。
 * hash 是最小的一条通道：不引路由库、不动 `loadURL` 的地址、客户端只需监听 load + hashchange。
 */
export const OVERVIEW_HASH = 'xuanshu-overview'

/**
 * 把玄枢首页地址变成「带 overview hash」的地址；非 http(s)（状态页的 data: URL）→ undefined。
 *
 * 已有 hash 就替换（`#old` → `#xuanshu-overview`），保留 query 与路径。
 *
 * @param {unknown} url
 * @returns {string|undefined}
 */
export function overviewUrlWithHash(url) {
  if (typeof url !== 'string' || url.trim() === '') return undefined
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  parsed.hash = OVERVIEW_HASH
  return parsed.toString()
}

/**
 * 「点通知」的壳侧动作：**先唤出窗口，再把页面带到 overview**。
 *
 * `target` 目前只有 `overview` 有真实落点；`consult` 没有深链（契约 §2 的 `target` 是建议），
 * 所以它也落到 overview（= 玄枢首页）—— 这是**明说的 best-effort**，不是假装点了哪条进哪页。
 * 判断与适配器调用分开，测试能用两个假件断言「两个动作都真的发生了」（复核 P2）。
 *
 * @param {{showWindow: Function, navigateToOverview: Function}} actions
 * @returns {(payload?: object) => void}
 */
export function createNotificationClickHandler({ showWindow, navigateToOverview }) {
  return () => {
    showWindow?.()
    navigateToOverview?.()
  }
}
