/**
 * packages/xuanshu-host/lib/notify/contract.mjs — **冻结契约的字面量**（#23 / #24 / #25 共用）。
 *
 * 为什么单独一个叶子模块：这些字符串是**两侧夹测的公共断言**（`.scratch/notes/spec002/
 * contract-shell-notify.md` §1–§5）。以前本仓库吃过「同一份判据在六个沙箱里各抄一份，最后两处写反」
 * 的亏；schema 与取值域散落在 4 个文件里迟早同样漂移。形状只有一份，改这里等于改契约。
 */

/** 壳写、宿主读的运行时状态文件（契约 §1）。 */
export const SHELL_NOTIFY_SCHEMA = 'xuanshu/shell-notify@1'

/** 宿主 → 壳的通知载荷（契约 §2）。 */
export const NOTIFY_SCHEMA = 'xuanshu/notify@1'

/** 触达账的一行（契约 §4）。 */
export const TRAFFIC_SCHEMA = 'xuanshu/traffic@1'

/** 壳与宿主共享的设置文件（契约 §5）。 */
export const SHELL_SETTINGS_SCHEMA = 'xuanshu/shell-settings@1'

/**
 * 壳的**实际生效状态**文件（P1 复核 #23 的加性扩展；与设置文件是两件事：
 * `shell-settings.json` 是「想要什么」，这份是「这台机器上实际成了什么」）。
 */
export const SHELL_STATUS_SCHEMA = 'xuanshu/shell-status@1'

/** 开机自启的实际生效方式（壳写、宿主读的封闭取值域）。 */
export const AUTOSTART_METHODS = Object.freeze(['login-item', 'shortcut', 'unsupported'])

/** 壳的实际生效状态文件名（`<dataDir>/runtime/shell-status.json`；与 `shell-notify.json` 同目录）。 */
export const SHELL_STATUS_FILE = 'shell-status.json'

/** 壳注入子进程的壳 pid 变量（契约 §0；与壳侧 `contract.mjs::SHELL_PID_ENV` 同名）。 */
export const SHELL_PID_ENV = 'XUANSHU_SHELL_PID'

/** 通知的 kind 取值域（契约 §2；#25 用 `wansheng`）。 */
export const NOTIFY_KINDS = Object.freeze(['rikke', 'wansheng'])

/** 通知点击后停哪一屏（契约 §2；`target` 是**建议**，做不到深链时壳只唤出窗口）。 */
export const NOTIFY_TARGETS = Object.freeze(['overview', 'consult'])

/** 投递结果的三态（契约 §4：`failed` 必须带可读 reason，`skipped` 是明确的「不推」）。 */
export const NOTIFY_STATUSES = Object.freeze(['delivered', 'failed', 'skipped'])
