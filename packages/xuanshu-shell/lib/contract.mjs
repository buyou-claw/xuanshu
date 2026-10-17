/**
 * packages/xuanshu-shell/lib/contract.mjs — 壳侧**契约常量的本地副本**（冻结契约 §0/§1/§2/§5）。
 *
 * 为什么是副本而不是 import 宿主：壳要能被单独装进 Electron 应用（`packages/xuanshu-shell` 是
 * 一个可独立 `electron .` 启动的包），不能反向依赖仓库里的 `packages/xuanshu-host/**` 或
 * `scripts/isolation/**` —— 那两个位置在装好的应用里不存在。但**值**必须与真源逐字一致：
 * `tests/shell/contract-parity.test.mjs` 把宿主侧与隔离启动器的模块 import 进来直接对拍。
 *
 * 真源（改值前先看这三处，并同时改本文件与对拍测试）：
 *   - `.scratch/notes/spec002/contract-shell-notify.md` §0/§1/§2/§5
 *   - `packages/xuanshu-host/lib/notify/{contract,settings}.mjs`
 *   - `scripts/isolation/defaults.mjs`
 */

/** 壳写、宿主读的运行时状态文件 schema（契约 §1）。 */
export const SHELL_NOTIFY_SCHEMA = 'xuanshu/shell-notify@1'

/** 宿主 → 壳的通知载荷 schema（契约 §2）。 */
export const NOTIFY_SCHEMA = 'xuanshu/notify@1'

/** 壳与宿主共享的设置文件 schema（契约 §5）。 */
export const SHELL_SETTINGS_SCHEMA = 'xuanshu/shell-settings@1'

/**
 * 壳的**实际生效状态**文件 schema（P1 复核 #23 的加性扩展；与 `shell-settings.json` 是两件事：
 * 那份是「想要什么」，这份是「这台机器上实际成了什么」）。
 */
export const SHELL_STATUS_SCHEMA = 'xuanshu/shell-status@1'

/** 开机自启的实际生效方式（壳写、宿主读；值域封闭）。 */
export const AUTOSTART_METHODS = Object.freeze(['login-item', 'shortcut', 'unsupported'])

/** 通知 kind 的封闭取值域（契约 §2）。 */
export const NOTIFY_KINDS = Object.freeze(['rikke', 'wansheng'])

/** 通知点击后的建议落点（契约 §2：`target` 是建议，壳只唤出窗口）。 */
export const NOTIFY_TARGETS = Object.freeze(['overview', 'consult'])

/** 关窗行为（契约 §5：`hide` 默认 / `quit`）。 */
export const CLOSE_BEHAVIORS = Object.freeze(['hide', 'quit'])

/** 缺文件 / 缺键时的默认值（契约 §5）。 */
export const DEFAULT_SHELL_SETTINGS = Object.freeze({
  closeBehavior: 'hide',
  autostart: false,
  notifySummary: false,
})

/** 设置文件名（`<dataDir>/shell-settings.json`，契约 §5）。 */
export const SHELL_SETTINGS_FILE = 'shell-settings.json'

/** 运行时状态文件名（`<dataDir>/runtime/shell-notify.json`，契约 §1）。 */
export const SHELL_NOTIFY_STATE_FILE = 'shell-notify.json'

/** 壳的实际生效状态文件名（`<dataDir>/runtime/shell-status.json`，P1 加性；与上面同目录）。 */
export const SHELL_STATUS_FILE = 'shell-status.json'

/** 运行时目录名（`<dataDir>/runtime`，契约 §1）。 */
export const RUNTIME_DIR_NAME = 'runtime'

/** 玄枢 web 端口（`scripts/isolation/defaults.mjs::DEFAULT_WEB_PORT`，契约 §0）。 */
export const DEFAULT_WEB_PORT = 19388

/** DSH 桌面版端口：只用于文档对照，**永不使用**（契约 §0）。 */
export const DESKTOP_WEB_PORT = 19387

/** 玄枢自己的 profile 名（`scripts/isolation/defaults.mjs::DEFAULT_PROFILE`）。 */
export const DEFAULT_PROFILE = 'xuanshu'

/** 玄枢数据目录名：`<home>/xuanshu/`（`scripts/isolation/defaults.mjs::DATA_DIR_NAME`）。 */
export const DATA_DIR_NAME = 'xuanshu'

/** DSH CLI 包名（`scripts/isolation/defaults.mjs::DSH_PACKAGE`）。 */
export const DSH_PACKAGE = '@deepseek-ai/dsh'

/** `DSH_HOME` 环境变量名（`scripts/isolation/defaults.mjs::DSH_HOME_ENV`）。 */
export const DSH_HOME_ENV = 'DSH_HOME'

/** home 的合法档位（`scripts/isolation/defaults.mjs::HOME_MODES`）。 */
export const HOME_MODES = Object.freeze(['dev', 'product'])

/** 开发档 / 产品档的目录名（契约 §0：`<repo>/.dsh-home` / `~/.xuanshu`）。 */
export const DEV_HOME_DIR_NAME = '.dsh-home'
export const PRODUCT_HOME_DIR_NAME = '.xuanshu'

/**
 * 壳侧自有的环境变量名（契约 §0 定值）。
 * `home` / `webPort` 沿用隔离启动器的变量名，不另立一套。
 */
export const ENV = Object.freeze({
  home: 'XUANSHU_DSH_HOME',
  profile: 'XUANSHU_PROFILE',
  webPort: 'XUANSHU_WEB_PORT',
  dshBin: 'XUANSHU_DSH_BIN',
  nodeBin: 'XUANSHU_NODE_BIN',
})

/** 壳注入子进程的通知端点状态文件路径变量（契约 §0；与宿主 `target.mjs` 同名）。 */
export const NOTIFY_STATE_ENV = 'XUANSHU_SHELL_NOTIFY_STATE'

/** 壳注入子进程的壳 pid 变量（契约 §0）。 */
export const SHELL_PID_ENV = 'XUANSHU_SHELL_PID'

/** 通知端点路径（契约 §2）。 */
export const NOTIFY_PATH = '/v1/notify'

/** 通知端点只监听回环（契约 §2）。 */
export const NOTIFY_HOST = '127.0.0.1'

/** title / body 的字符上限（契约 §2 定值）。 */
export const TITLE_LIMIT = 120
export const BODY_LIMIT = 200
