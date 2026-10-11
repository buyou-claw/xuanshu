/**
 * scripts/isolation/defaults.mjs — 票 04 隔离启动器的**唯一常量来源**。
 *
 * 为什么单独一个文件：这些定值同时被 `startup.mjs`（启动器）、`scripts/verify-isolation.mjs`
 * （队友 C 的断言台）和 `tests/isolation/**` 读取。散落在各处必然漂移，而「端口 / 退出码 /
 * schema 名」一漂移，测试就会变成互相骗过的假绿。契约出处：
 * `.scratch/assembly-foundation/notes/isolation-contract.md` §2（定值）、§4.1（冻结接口）。
 *
 * 本文件是纯数据：不 import 任何东西、不读环境变量、不碰文件系统。
 */

/** CLI 自己用的 DSH home 环境变量名（`@deepseek-ai/dsh-home-paths` 认的就是它）。 */
export const DSH_HOME_ENV = 'DSH_HOME'

/** profile 名：desktop 是 Electron 独占的，CLI 硬拒绝，所以被测实例另起一个。 */
export const DEFAULT_PROFILE = 'xuanshu'

/** xuanshu 的 web 端口（desktop 占 19387，见 DESKTOP_WEB_PORT）。 */
export const DEFAULT_WEB_PORT = 19388

/** horosa 的 MCP 端口与端点路径（票 05/06 会真的监听它，本票只做单占用守卫）。 */
export const DEFAULT_HOROSA_PORT = 8765
export const HOROSA_MCP_PATH = '/mcp'

/** **只用于文档与报告对照**，不参与任何判断：判断只认「xuanshu 端口有没有被占」。 */
export const DESKTOP_WEB_PORT = 19387

/**
 * 本票自己引入的覆盖变量（前缀 XUANSHU_ 是为了不和 DSH 自身的 env 撞车）。
 * 优先级见 resolve.mjs：显式 CLI 参数 > 这些变量 > 定值。
 */
export const ENV = {
  webPort: 'XUANSHU_WEB_PORT',
  horosaPort: 'XUANSHU_HOROSA_PORT',
  home: 'XUANSHU_DSH_HOME',
  profile: 'XUANSHU_PROFILE',
  cliBin: 'XUANSHU_CLI_BIN',
}

/**
 * 退出码（契约 §2）。之所以不只分「成功/失败」：调用方（runbook、CI、队友 C 的断言台）
 * 需要据此决定是「改用法」「修环境」还是「腾端口」，三种处置完全不同。
 */
export const EXIT = { ok: 0, usage: 1, environment: 2, isolation: 3 }

/** 本票的报告 schema（与票 01 的 `xuanshu/assembly-report@1` 是两个不同的东西）。 */
export const ISOLATION_REPORT_SCHEMA = 'xuanshu/isolation-report@1'

/** 票 01 的装配报告 schema：headless 模式断言它「本次新写出」，所以要认得出它。 */
export const ASSEMBLY_REPORT_SCHEMA = 'xuanshu/assembly-report@1'

/** 启动器模式的定值集合（parseArgs 用它做校验，避免手写字符串漏一个）。 */
export const MODES = ['doctor', 'web', 'headless', 'env']
export const DEFAULT_MODE = 'doctor'

/** spawn 与等待的默认上限：真 CLI 冷启动实测约 3~15s，180s 足够宽又不至于挂死 CI。 */
export const DEFAULT_TIMEOUT_MS = 180_000

/**
 * 报告的 checks 键（顺序即打印顺序）：契约 §4.5 冻结了这六个，不多不少。
 * 前三个是**环境门**（失败 → exit 2），后三个是**隔离门**（失败 → exit 3）。
 */
export const CHECK_IDS = ['home', 'cli', 'profile', 'webPort', 'horosaGuard', 'stateIsolated']

/** 隔离门 vs 环境门的划分：exitCode 由它推导（见 startup.mjs 的 pickExitCode）。 */
export const ENVIRONMENT_CHECK_IDS = ['home', 'cli', 'profile']
export const ISOLATION_CHECK_IDS = ['webPort', 'horosaGuard', 'stateIsolated']

/** 「一切归你」的数据目录名：`$DSH_HOME/xuanshu/`（本票不改它，只保证它落在隔离 home 下）。 */
export const DATA_DIR_NAME = 'xuanshu'

/** CLI 包名与「版本锚」包名：CLI 必须和 profile 树里的 dsh-base 同版本，否则会去解析别人的树。 */
export const DSH_PACKAGE = '@deepseek-ai/dsh'
export const DSH_BASE_PACKAGE = '@deepseek-ai/dsh-base'

/** 所有探针只探本机回环，绝不碰外部地址。 */
export const PROBE_HOST = '127.0.0.1'
