/**
 * packages/xuanshu-host/lib/horosa/constants.mjs
 *
 * 宿主侧 horosa 接缝库的**定值唯一来源**（票 06）。冻结导出名与取值出处：
 * `.scratch/assembly-foundation/notes/horosa-integration-contract.md` §3.1（一个字都不许改）。
 *
 * 为什么宿主侧自带一份（而不是 import 仓库的 `scripts/isolation/defaults.mjs`）：
 * 宿主插件是从 `<profile>/node_modules/xuanshu-host` 加载的**分发物**，运行环境里没有仓库目录
 * （copy 模式 / 别人的机器上根本没有 `scripts/`）。两侧的漂移由票 06 测试钉住：
 *   - P2「定值单源」：`profile/cordis.patch.yml` 的 URL、`scripts/isolation/defaults.mjs`、
 *     本文件的 `HOROSA_DEFAULT_PORT` / `HOROSA_MCP_PATH` 三处一致；
 *   - P1「四态 parity」：宿主侧 `checkHorosaEndpoint` 与票 04 的 `checkHorosaPort` 逐字同 verdict。
 * **全仓只有这三处能出现端口字面量与路径字面量**，别处一律 import 本文件。
 *
 * 本文件是纯数据：不 import 任何东西、不读环境变量、不碰文件系统。
 */

/** MCP serverName（`profile/cordis.patch.yml` 的 `config.serverName`；工具名前缀 `mcp__horosa__*` 的唯一来源）。 */
export const HOROSA_SERVER_NAME = 'horosa'

/** horosa MCP 的默认端口（与 `scripts/isolation/defaults.mjs::DEFAULT_HOROSA_PORT` 同值，见文件头 P2）。 */
export const HOROSA_DEFAULT_PORT = 8765

/** streamable-http 端点路径（与 `scripts/isolation/defaults.mjs::HOROSA_MCP_PATH` 同值）。 */
export const HOROSA_MCP_PATH = '/mcp'

/** 默认绑定 / 探测地址：只走回环（契约 §2.3：非回环不暴露）。 */
export const HOROSA_DEFAULT_HOST = '127.0.0.1'

/** 八字出生盘的 MCP 工具名（`captures/horosa-cli/tool-list.json` 的 `bazi_birth.mcp_name`）。 */
export const HOROSA_BAZI_TOOL = 'horosa_cn_bazi_birth'

/** 信封 `tool` 字段（**实测是 CLI 名**，不是 MCP 名；契约 §0.1）。 */
export const HOROSA_BAZI_ENVELOPE_TOOL = 'bazi_birth'

/** 澄清闸的拦截码（实测：HTTP 200 + `isError:false`，但信封 `ok:false` + 该 code；契约 §0.2）。 */
export const HOROSA_GATE_CODE = 'agent_guidance.required'

/**
 * `timeAlg` 三档（实测对照见契约 §0.1 的表）。
 * `TRUE_SOLAR(0)` 是本方默认档，**实现上省略该键**（S3 §D4：不写默认值，让引擎缺省决定）。
 */
export const HOROSA_TIME_ALG = { TRUE_SOLAR: 0, CLOCK: 1, MEAN_SOLAR: 3 }

/** 状态文件 schema（契约 §3 R7）。 */
export const HOROSA_STATUS_SCHEMA = 'xuanshu/horosa-status@1'

/** 信封必带顶层键（契约 §4.2 的 `'invalid'` 判据；**只看键存在**，`error:null` 也算存在）。 */
export const HOROSA_ENVELOPE_REQUIRED_KEYS = ['ok', 'tool', 'version', 'data', 'summary', 'warnings', 'error']

/* ------------------------------------------------------------------ *
 * 以下为宿主侧的**附加定值**（契约未点名，但多处复用；不改变上面任何一条的语义）
 * ------------------------------------------------------------------ */

/** 状态文件的合法 phase 词表（契约 §3 R7）。 */
export const HOROSA_PHASES = ['idle', 'ensuring', 'starting', 'ready', 'blocked', 'foreign', 'stopped']

/** 端口四态词表（与票 04 `checkHorosaPort` 逐字一致，P1 会逐字比 verdict）。 */
export const HOROSA_VERDICTS = ['free', 'horosa-ready', 'occupied-foreign', 'probe-failed']

/** 数据目录下的文件名。 */
export const HOROSA_STATUS_FILENAME = 'horosa-status.json'
export const HOROSA_SERVE_LOG_FILENAME = 'serve.log'

/** `pnpm setup:xuanshu`：所有「环境没装好」的 hint 都指向它（票 05 的一键安装入口）。 */
export const HOROSA_SETUP_COMMAND = 'pnpm setup:xuanshu'

/** 票 05 的装配报告 schema（`resolveHorosaPlan` 从中取 pin 版本与 wheel 路径）。 */
export const HOROSA_SETUP_REPORT_SCHEMA = 'xuanshu/setup-report@1'

/**
 * v1 **永不透传**的旋钮（S3 §D4 / 契约 §4.1 的「其余 10 键」）。
 *
 * 出处：`captures/horosa-cli/tool-list.json` 里 `bazi_birth` 的
 * `input_contract.technical.accepted_fields` 减去 v1 真正透传的 5 个必填 + `gender` + `timeAlg`
 * + 3 个确认字段。S3 §D4 用中文列了其中十个（长生 / 神煞查法 / 晚子时四态 / 命宫起法 /
 * 月律分野 / 南半球月令 / 起运精度 / 藏干版本 / 生肖归属 / 断命流派 + 显示区），本表按
 * **上游字段名**逐条落定（超集，覆盖 S3 那份中文清单）：一律省略 = 由引擎缺省决定，
 * 界面不出现（不给点了没反应的开关）。调用方若显式传了其中某个键，会被丢进 `omitted`。
 */
export const HOROSA_BAZI_OMITTED_KEYS = [
  'ad',
  'after23NewDay',
  'ageStyle',
  'byLon',
  'cangVersion',
  'cnUnifiedZone',
  'dayunPrecision',
  'fenyeVersion',
  'godKeyPos',
  'gpsLat',
  'gpsLon',
  'lateZiHourUseNextDay',
  'minggongMethod',
  'period',
  'phaseType',
  'response_view',
  'school',
  'southMonth',
  'zodiacBoundary',
]
