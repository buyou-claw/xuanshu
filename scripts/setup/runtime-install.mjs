/**
 * scripts/setup/runtime-install.mjs — 装 runtime + 同版本硬门（票 05 契约 §4.2/§4.3）。
 *
 * 三件事，顺序不能变：
 *   1. **先 doctor**：已装同版本且没给 `--force` → 直接跳过安装（幂等，票面第 5 条）；
 *   2. **装 = 上游自己的 `install --archive <本地已校验归档>`**。不自己解压、不自己摆布局：
 *      布局（`<root>/current/...`）、pidlock、previous 备份这些语义都在上游，抄一份必漂。
 *      `--archive` **永远只收本地已校验绝对路径**（契约 §3.6：给 URL 会绕开我们的 SHA256 门）；
 *   3. **装后再 doctor**，断言版本 == pin 版本 —— 这是「禁止新树混旧 runtime」的硬门（ADR-0004）。
 *
 * ⚠️ 版本门的判据（Lead 真机实测，见 `captures/setup-e2e-groundtruth.md` §3）：
 *   `doctor.installed === true && doctor.runtime_payload_version === <pin.version>`
 *   **绝不能**拿 `doctor.ok` 当判据 —— 装好了但本地服务没起时 `ok` 就是 `false`（`issues:["services:not_running"]`）。
 *
 * ⚠️ 版本字段的读序（A3）：只认契约 §4.3 指定的 `runtime_payload_version`（等价 `freshness.installed_version`），
 * 两者都缺 → **视为取不到版本**（不通过，exit 4，detail 说明字段缺失）。`manifest_version` 只允许出现在
 * evidence 里给人对账，**不许**参与判定：它和载荷版本可以不一致（`manifest_version=0.40.1` +
 * `runtime_payload_version=0.40.0` 就是「新清单蒙着旧载荷」），拿它判门 = 门假过。
 *
 * 大输出（doctor 的纯 JSON）落 `<dsh-home>/xuanshu/logs/`，报告里给路径（契约 §7：证据只放小体积字段）。
 *
 * 仅使用 Node 内置模块。ESM。
 */

import { basename } from 'node:path'

import { EXIT, SetupError } from './exit.mjs'
import { DEFAULT_TIMEOUT_MS, runCommand, tailLines, uvxBin } from './proc.mjs'
import { writeLogFile } from './report.mjs'

/** 安装超时：真机实测 719MB zip 解包 33.3 秒；给 30 分钟是给慢盘/杀软留余量，不是给网络。 */
export const INSTALL_TIMEOUT_MS = 30 * 60_000

/**
 * doctor JSON 的版本读取顺序（**第一个命中即用**；A3 冻结这两条）。
 *
 * 为什么只有这两条：
 *   - `runtime_payload_version` 是契约 §4.3 写死的门字段（真机实测）；
 *   - `freshness.installed_version` 是它的等价物（真机实测两者同为 0.40.1），载荷版本缺失时的第二来源；
 *   - `manifest_version` / `runtime.version` / 顶层 `version` **一律不读**：它们描述的是清单或另一层树，
 *     读它们会让「新清单 + 旧载荷」这种最该拦住的组合静默过门（A3 的原始缺陷）。
 */
const VERSION_READERS = [
  ['runtime_payload_version', (doctor) => doctor?.runtime_payload_version],
  ['freshness.installed_version', (doctor) => doctor?.freshness?.installed_version],
]

/** 已装判定：`installed`（真机）或 `runtime.installed`（替身）任一为 true。 */
export function doctorIsInstalled(doctor) {
  return doctor?.installed === true || doctor?.runtime?.installed === true
}

/**
 * 从 doctor JSON 里读 runtime 版本，并说明命中的是哪个键（报告 evidence 带上它，便于对账）。
 * 读不到 → `{ version: null, key: null }`：调用方**不许**拿别的键兜底（见 VERSION_READERS）。
 */
export function readDoctorVersion(doctor) {
  for (const [key, read] of VERSION_READERS) {
    const value = read(doctor)
    if (typeof value === 'string' && value.trim() !== '') return { version: value.trim(), key }
  }
  return { version: null, key: null }
}

/** 「取不到版本」的统一措辞（A3：不通过，exit 4，且必须点名缺的是哪个字段）。 */
const MISSING_VERSION_DETAIL =
  'doctor 输出里既没有 runtime_payload_version 也没有 freshness.installed_version —— 版本取不到，'
  + '按同版本硬门的口径判**不通过**（拿 manifest_version 兜底会让「新清单混旧载荷」静默过门）'

/**
 * 从 CLI 的 stdout 里解析 JSON（doctor / install / runtime status 都是「stdout 纯 JSON」）。
 * 解析不出来返回 `{ json: undefined, error }` —— 由调用方决定是硬失败还是只记 note。
 */
export function parseJsonOutput(stdout) {
  const text = String(stdout ?? '').trim()
  if (text === '') return { json: undefined, error: 'stdout 为空' }
  try {
    return { json: JSON.parse(text), error: null }
  } catch (error) {
    return { json: undefined, error: `stdout 不是合法 JSON：${error.message}` }
  }
}

/**
 * 跑一条 `uvx --from <wheel> horosa-skill <args…>`。
 *
 * env 传 `HOROSA_RUNTIME_ROOT` / `HOROSA_SKILL_DATA_DIR`（契约 §4.2 的两个环境变量），
 * 它们是上游 `Settings.from_env()` 认的那两个名字 —— runtime 落到哪、数据写哪，全由它们定。
 */
export async function runHorosa(args, { wheelPath, env, log, timeoutMs = DEFAULT_TIMEOUT_MS, label = 'horosa' } = {}) {
  const bin = uvxBin(env)
  const argv = ['--from', wheelPath, 'horosa-skill', ...args]
  return runCommand(bin, argv, { env, timeoutMs, log, label })
}

/** 跑 doctor 并解析（纯 JSON 在 stdout，`--explain` 的解释才走 stderr，我们不带它）。 */
export async function runDoctor({ wheelPath, env, log, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const result = await runHorosa(['doctor'], { wheelPath, env, log, timeoutMs, label: 'doctor' })
  const { json, error } = parseJsonOutput(result.stdout)
  return { ...result, doctor: json, parseError: error }
}

/**
 * 装 runtime（含幂等短路与装后版本硬门）。
 *
 * @param {string} [logsDir] 大输出落点（`<dsh-home>/xuanshu/logs/`，契约 §7）；不传则不落盘
 * @returns {Promise<{ action: 'installed'|'already-installed', version: string, versionKey: string,
 *                     doctorBefore: object|null, doctorAfter: object|null, install: object|null,
 *                     logs: { doctorBefore: string|null, doctorAfter: string|null, install: string|null } }>}
 * @throws {SetupError} code = EXIT.install
 */
export async function setupRuntime({
  wheelPath, archivePath, pinVersion, runtimeRoot, dataDir, force = false, env, log, logsDir,
  installTimeoutMs = INSTALL_TIMEOUT_MS, doctorTimeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const childEnv = { ...env, HOROSA_RUNTIME_ROOT: runtimeRoot, HOROSA_SKILL_DATA_DIR: dataDir }
  const logs = { doctorBefore: null, doctorAfter: null, install: null }

  log(`[setup] runtime：doctor 检查已装状态（root=${runtimeRoot}）`)
  const before = await runDoctor({ wheelPath, env: childEnv, log, timeoutMs: doctorTimeoutMs })
  logs.doctorBefore = writeLogFile(logsDir, 'doctor-before.json', before.stdout)
  if (before.parseError !== null) {
    log(`[setup] runtime：doctor 输出解析失败（${before.parseError}，exit=${before.status}），按「未装」继续 —— 安装步骤会给出真正的错误`)
  } else {
    const { version, key } = readDoctorVersion(before.doctor)
    if (doctorIsInstalled(before.doctor) && version !== null && version === pinVersion && !force) {
      log(`[setup] runtime：已装同版本 v${version}（doctor.${key}），跳过安装（幂等；要重装加 --force）`)
      return {
        action: 'already-installed',
        version,
        versionKey: key,
        doctorBefore: summarizeDoctor(before.doctor),
        doctorAfter: null,
        install: null,
        logs,
      }
    }
    log(`[setup] runtime：当前 installed=${doctorIsInstalled(before.doctor)} version=${version ?? 'null'}（key=${key ?? '-'}）→ 需要安装`)
  }

  log(`[setup] runtime：install --archive ${basename(archivePath)}${force ? ' --force' : ''}`)
  const installRun = await runHorosa(
    ['install', '--archive', archivePath, ...(force ? ['--force'] : [])],
    { wheelPath, env: childEnv, log, timeoutMs: installTimeoutMs, label: 'install' },
  )
  if (installRun.error !== null || installRun.timedOut || installRun.status !== 0) {
    throw new SetupError(
      `horosa-skill install --archive 失败（exit=${installRun.status}${installRun.timedOut ? '，超时' : ''}${installRun.error ? `，${installRun.error}` : ''}）`,
      {
        code: EXIT.install,
        evidence: {
          exitCode: installRun.status,
          timedOut: installRun.timedOut,
          error: installRun.error,
          archive: archivePath,
          runtimeRoot,
          dataDir,
          stderrTail: tailLines(installRun.stderr, 8),
        },
        hint: [
          `# 归档：${archivePath}`,
          `# 目标根：${runtimeRoot}（Windows 上必须纯 ASCII）  数据目录：${dataDir}`,
          `# 复现原命令：HOROSA_RUNTIME_ROOT="${runtimeRoot}" HOROSA_SKILL_DATA_DIR="${dataDir}" \\`,
          `#   ${uvxBin(childEnv)} --from "${wheelPath}" horosa-skill install --archive "${archivePath}"${force ? ' --force' : ''}`,
        ].join('\n'),
      },
    )
  }
  const installJson = parseJsonOutput(installRun.stdout).json
  logs.install = writeLogFile(logsDir, 'install.json', installRun.stdout)
  log(`[setup] runtime：install 完成（exit 0，${installRun.durationMs}ms）`)

  const after = await runDoctor({ wheelPath, env: childEnv, log, timeoutMs: doctorTimeoutMs })
  logs.doctorAfter = writeLogFile(logsDir, 'doctor-after.json', after.stdout)
  if (after.parseError !== null) {
    throw new SetupError(`装完 runtime 后 doctor 的 stdout 不是 JSON：${after.parseError}`, {
      code: EXIT.install,
      evidence: {
        exitCode: after.status,
        stdoutHead: after.stdout.slice(0, 400),
        stderrTail: tailLines(after.stderr, 6),
        logFile: logs.doctorAfter,
      },
      hint: '# doctor 的 stdout 必须是纯 JSON（--explain 的解释走 stderr）；请检查 uvx/wheel 是否指错。',
    })
  }

  const { version, key } = readDoctorVersion(after.doctor)
  // A3：先判「版本取不到」（字段缺失）—— 这一格**不许**拿 manifest_version/顶层 version 兜底。
  if (version === null) {
    throw new SetupError(
      `runtime 版本硬门未通过：${MISSING_VERSION_DETAIL}。installed=${doctorIsInstalled(after.doctor)}、pin 要求 v${pinVersion}。`,
      {
        code: EXIT.install,
        evidence: {
          expected: pinVersion,
          expectedField: VERSION_READERS.map(([name]) => name),
          actual: null,
          versionKey: null,
          doctor: summarizeDoctor(after.doctor),
          logFile: logs.doctorAfter,
        },
        hint: [
          `# 1) 看 doctor 完整输出（原文已落盘）: ${logs.doctorAfter ?? `${uvxBin(childEnv)} --from "${wheelPath}" horosa-skill doctor`}`,
          '# 2) 上游 doctor 只有在「真的装上了」时才会写 runtime_payload_version；缺字段多半是装到了别的根/别的树。',
          `# 3) 确认根：--runtime-root "${runtimeRoot}"（Windows 上必须纯 ASCII）`,
        ].join('\n'),
      },
    )
  }
  if (!doctorIsInstalled(after.doctor) || version !== pinVersion) {
    throw new SetupError(
      `runtime 版本硬门未通过：装完 doctor 报 installed=${doctorIsInstalled(after.doctor)}、版本 ${version ?? 'null'}`
      + `（doctor.${key ?? '-'}），而 pin 要求 v${pinVersion}。禁止新树混旧 runtime。`,
      {
        code: EXIT.install,
        evidence: {
          expected: pinVersion,
          actual: version,
          versionKey: key,
          doctor: summarizeDoctor(after.doctor),
          logFile: logs.doctorAfter,
        },
        hint: [
          `# 1) 先看 doctor 完整输出: ${uvxBin(childEnv)} --from "${wheelPath}" horosa-skill doctor`,
          `# 2) 常见原因：目标根里还有旧树 → 加 --force 重装: node scripts/setup.mjs --force`,
          `# 3) 或旧树在别的根（HOROSA_RUNTIME_ROOT 不对）: 两份 runtime 会互相打架，先确认 --runtime-root`,
        ].join('\n'),
      },
    )
  }

  log(`[setup] runtime：版本门通过 v${version}（doctor.${key}）`)
  return {
    action: 'installed',
    version,
    versionKey: key,
    doctorBefore: before.doctor === undefined ? null : summarizeDoctor(before.doctor),
    doctorAfter: summarizeDoctor(after.doctor),
    install: installJson === undefined ? { exitCode: installRun.status, durationMs: installRun.durationMs } : summarizeInstall(installJson, installRun.durationMs),
    logs,
  }
}

/** doctor 的关键字段（报告 evidence：小体积、够对账）。 */
export function summarizeDoctor(doctor) {
  if (doctor === undefined || doctor === null) return null
  const summary = {}
  for (const key of ['ok', 'installed', 'status', 'manifest_version', 'runtime_payload_version', 'runtime_root', 'current_dir', 'platform']) {
    if (doctor[key] !== undefined) summary[key] = doctor[key]
  }
  if (Array.isArray(doctor.issues)) summary.issues = doctor.issues.slice(0, 6)
  if (Array.isArray(doctor.endpoints)) {
    summary.endpoints = doctor.endpoints.slice(0, 3).map((item) => ({ label: item?.label, reachable: item?.reachable }))
  }
  const freshness = doctor.freshness
  if (freshness !== undefined && freshness !== null) {
    summary.freshness = { installed_version: freshness.installed_version, latest_version: freshness.latest_version }
  }
  return summary
}

/** install 输出里的关键字段（真机实测含内嵌 manifest）。 */
function summarizeInstall(json, durationMs) {
  const summary = { durationMs }
  for (const key of ['ok', 'installed', 'changed', 'version', 'runtime_payload_version', 'runtime_root', 'current_dir', 'skipped_download']) {
    if (json?.[key] !== undefined) summary[key] = json[key]
  }
  const manifest = json?.manifest
  if (manifest !== undefined && manifest !== null) {
    summary.manifest = {
      version: manifest.version,
      runtime_payload_version: manifest.runtime_payload_version,
      runtime_layout_version: manifest.runtime_layout_version,
      export_registry_version: manifest.export_registry_version,
      platform: manifest.platform,
    }
  }
  return summary
}
