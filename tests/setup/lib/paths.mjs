/**
 * tests/setup/lib/paths.mjs — 断言台用到的**全部**路径，一处定义。
 *
 * 为什么单独一个文件：`tests/setup/**` 里每个用例都要引用「被测 CLI / pin 文件 / 离线证据副本 /
 * 临时目录」四个根。散落在各文件里，改一个目录名就要全局 grep，而且很容易写出
 * 「测试自己的 fixture 路径」冒充「被测产物路径」的假绿。
 *
 * 只有常量，不 import 任何东西、不读环境、不碰文件系统。
 */
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 仓库根（本文件在 <repo>/tests/setup/lib/ 下）。 */
export const REPO_ROOT = resolve(HERE, '..', '..', '..')

/** 被测实现的两个冻结路径（契约 §1 / §2 / §3.1）。 */
export const SETUP_CLI = join(REPO_ROOT, 'scripts', 'setup.mjs')
export const SETUP_DIR = join(REPO_ROOT, 'scripts', 'setup')
export const PIN_FILE = join(SETUP_DIR, 'horosa-pin.json')

/** 离线证据副本（不许联网取，只许读这一个副本）——契约 §0 / §3.1。 */
export const CAPTURES_DIR = join(REPO_ROOT, '.scratch', 'assembly-foundation', 'captures')
export const SHA256SUMS_TXT = join(CAPTURES_DIR, 'horosa-SHA256SUMS.txt')
export const RUNTIME_MANIFEST_JSON = join(CAPTURES_DIR, 'horosa-runtime-manifest.json')

/** 本票自己的临时区（.gitignore 已覆盖 `tests/**​/.tmp/`）。 */
export const TMP_ROOT = join(REPO_ROOT, 'tests', 'setup', '.tmp')

/** 本地计数 server（唯一允许的「网络」）。 */
export const RELEASE_SERVER = join(REPO_ROOT, 'tests', 'setup', 'lib', 'release-server.mjs')

/** 假 uvx 与替身脚本。 */
export const FIXTURE_BIN_DIR = join(REPO_ROOT, 'tests', 'setup', 'fixtures', 'bin')
export const FAKE_UVX = join(FIXTURE_BIN_DIR, 'uvx.mjs')
export const STUBS_DIR = join(REPO_ROOT, 'tests', 'setup', 'fixtures', 'stubs')
export const STUB_INSTALL_PROFILE = join(STUBS_DIR, 'install-profile.mjs')
export const STUB_VERIFY_ASSEMBLY = join(STUBS_DIR, 'verify-assembly.mjs')

/** 本机真实 DSH home —— **只读**：任何用例都不许往里写一个字节。 */
export const REAL_HOME = join(homedir(), '.dsh')
