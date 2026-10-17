/**
 * tests/horosa/lib/paths.mjs — 断言台用到的**全部**路径，一处定义。
 *
 * 只有常量，不 import 任何东西、不读环境、不碰文件系统（照 `tests/setup/lib/paths.mjs` 的做法）。
 * 散落在各用例里就会出现「测试自己的 fixture 路径」冒充「被测产物路径」的假绿。
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 仓库根（本文件在 <repo>/tests/horosa/lib/ 下）。 */
export const REPO_ROOT = resolve(HERE, '..', '..', '..')

/* ---------------- 被测物 ---------------- */

/** 宿主侧接缝库（票 06 T1 的写作用域，C 只读）。 */
export const HOST_PACKAGE = join(REPO_ROOT, 'packages', 'xuanshu-host')
export const HOST_LIB = join(HOST_PACKAGE, 'lib')
export const HOST_HOROSA = join(HOST_LIB, 'horosa')

/** profile 分发面（票 06 T2/D 的写作用域，C 只读）。 */
export const PROFILE_DIR = join(REPO_ROOT, 'profile')
export const PROFILE_PATCH = join(PROFILE_DIR, 'cordis.patch.yml')
export const PROFILE_PACKAGE_JSON = join(PROFILE_DIR, 'package.json')
export const PROFILE_HOST_COPY = join(PROFILE_DIR, 'node_modules', 'xuanshu-host')
export const PROFILE_HOST_LIB = join(PROFILE_HOST_COPY, 'lib')

/** 票 04 的定值来源与四态守卫（parity 的另一半，冻结只读）。 */
export const ISOLATION_DEFAULTS = join(REPO_ROOT, 'scripts', 'isolation', 'defaults.mjs')
export const ISOLATION_GUARD = join(REPO_ROOT, 'scripts', 'isolation', 'horosa-guard.mjs')

/** 票 06 T2 的上游 seam 契约 CLI（P10 用）。 */
export const BAZI_CONTRACT_CLI = join(REPO_ROOT, 'scripts', 'horosa', 'bazi-contract.mjs')

/** 票 05 的 pin（版本/工件的唯一来源，只读）。 */
export const PIN_FILE = join(REPO_ROOT, 'scripts', 'setup', 'horosa-pin.json')

/** 票 01 的进程内 boot（P10 用；Lead 已给它加了 tools/toolCount 字段）。 */
export const BOOT_INPROCESS = join(REPO_ROOT, 'tests', 'assembly', 'lib', 'boot-inprocess.mjs')

/** profile 装好后 CLI 的真入口（P10 的 DSH CLI）。 */
export const DSH_CLI_BIN = join(REPO_ROOT, 'profile', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/** 真实隔离 home（`node scripts/install-profile.mjs --home <repo>/.dsh-home` 的产物）。 */
export const REPO_DSH_HOME = join(REPO_ROOT, '.dsh-home')

/** 真机 e2e 的两个事实（只在 XUANSHU_E2E=1 时读；见 p10）。 */
export const REAL_RUNTIME_ROOT = 'C:\\horosa'

/* ---------------- 断言台自己的东西 ---------------- */

export const TESTS_DIR = join(REPO_ROOT, 'tests', 'horosa')
export const FIXTURES_DIR = join(TESTS_DIR, 'fixtures')
export const ENVELOPES_DIR = join(FIXTURES_DIR, 'envelopes')
export const FAKE_BIN_DIR = join(FIXTURES_DIR, 'bin')

/** 假 uvx：`.mjs` 由 node 直跑（票 05 的约定），`.cmd` 是 Windows 的另一种路径形态。 */
export const FAKE_UVX_MJS = join(FAKE_BIN_DIR, 'uvx.mjs')
export const FAKE_UVX_CMD = join(FAKE_BIN_DIR, 'uvx.cmd')

/** 独立的假 MCP 服务器（P1/P7 的「第三方占用」与「已是 horosa」两态）。 */
export const FAKE_MCP_SERVER = join(FAKE_BIN_DIR, 'fake-mcp-server.mjs')

/** 假 setup 报告 / 假 runtime 清单（**模板**，占位符由 lib/sandbox.mjs 的 `fill()` 填）。 */
export const SETUP_REPORT_TEMPLATE = join(FIXTURES_DIR, 'setup-report.json')
export const RUNTIME_MANIFEST_TEMPLATE = join(FIXTURES_DIR, 'runtime-manifest.json')

/** 运行期沙箱（`.gitignore` 已覆盖 `tests/**​/.tmp/`）。 */
export const TMP_ROOT = join(TESTS_DIR, '.tmp')

/** 捕获目录（`.scratch/` 不入库：别的机器上不存在，相关用例自动跳过）。 */
export const CAPTURES_DIR = join(REPO_ROOT, '.scratch', 'assembly-foundation', 'captures')
