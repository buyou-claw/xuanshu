/**
 * packages/xuanshu-host/lib/horosa/plan.mjs
 *
 * 起 serve **之前**的两道环境门（票 06 契约 §3.1 冻结签名 + §3.2 R2）：
 *   readSetupReport({ setupReportFile })  -> { ok, report, detail }
 *   resolveHorosaPlan({ paths, config, env, platform, report })
 *     -> { ok, code, wheel, version, uvxBin, host, port, runtimeRoot, dataDir, source, detail, hint }
 *   ensureRuntime({ runtimeRoot, expectedVersion })
 *     -> { ok, installed, version, expectedVersion, code, manifestFile, detail, hint }
 *
 * 为什么有这两道门：
 *   ① **版本只有一个来源**：票 05 的报告 `<dshHome>/xuanshu/setup-report.json`
 *      （schema `xuanshu/setup-report@1`，setup-contract §7）里的 `pin.version` / `pin.wheel.path`。
 *      读不到就**不猜**（不拿兜底字面量放行）——「新宿主混旧 runtime」是最该拦住的组合。
 *   ② **runtime 同版本硬门**：`<runtimeRoot>/current/runtime-manifest.json` 的
 *      `runtime_payload_version`（回退 `version`，真机 key 实测见契约 §0.3）必须等于 pin 版本；
 *      未装 / 版本不符 → 不起 serve，状态文件给 `code` + 指向 `pnpm setup:xuanshu` 的 `hint`。
 *
 * 读 setup 报告时**不**强制 schema 逐字相等：只有 `pin.version` 是门（缺它就是
 * `setup-report-missing`）；schema 不匹配时在 detail 里点名，但不阻断 —— 门要做在版本上。
 *
 * 绝不抛：一切失败折算成 `{ ok:false, code, detail, hint }`。
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  HOROSA_DEFAULT_HOST,
  HOROSA_DEFAULT_PORT,
  HOROSA_SETUP_COMMAND,
  HOROSA_SETUP_REPORT_SCHEMA,
} from './constants.mjs'
import { loopbackHost, resolveHorosaPaths } from './paths.mjs'

/** runtime 清单的相对落点（上游 `horosa-skill install` 写的那份）。 */
const RUNTIME_MANIFEST_RELATIVE = join('current', 'runtime-manifest.json')

/** 「去装环境」的统一建议（所有环境门失败都指到它，且 hint 必须含 `setup` —— 票 06 测试 P6 的判据）。 */
const SETUP_HINT = `先跑 \`${HOROSA_SETUP_COMMAND}\`（取件 + 装 runtime + 装配 profile），跑完再启动 DSH。`

/** 非空字符串规范化。 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 读环境变量（只认非空串）。 */
function envText(env, key) {
  return env && typeof env === 'object' ? text(env[key]) : ''
}

/** 读一个 JSON 对象；读不到 / 不是对象都返回 undefined（调用方按「读不到」处置）。 */
function readJsonObject(file) {
  if (!file) return undefined
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * 读票 05 的装配报告（**唯一**的 pin 版本来源）。
 * @param {object} [options]
 * @param {string} [options.setupReportFile] 报告路径（缺省由 `resolveHorosaPaths` 给出）
 * @returns {{ ok: boolean, report: object|null, detail: string }}
 */
export function readSetupReport({ setupReportFile } = {}) {
  const file = text(setupReportFile)
  if (file === '') {
    return { ok: false, report: null, detail: '没有给出 setup 报告路径（`<dshHome>/xuanshu/setup-report.json`）：读不到 pin 版本。' }
  }
  const report = readJsonObject(file)
  if (!report) {
    return { ok: false, report: null, detail: `setup 报告读不到或不是 JSON 对象：${file}（先跑 \`${HOROSA_SETUP_COMMAND}\`）。` }
  }
  const version = text(report?.pin?.version)
  if (version === '') {
    return { ok: false, report, detail: `setup 报告里没有 \`pin.version\`：${file}（版本只有这一个来源，不猜）。` }
  }
  const schema = text(report.schema)
  const schemaNote =
    schema !== '' && schema !== HOROSA_SETUP_REPORT_SCHEMA
      ? `（注意：报告 schema=${schema}，期望 ${HOROSA_SETUP_REPORT_SCHEMA}；只按 pin.version 取版本）`
      : ''
  return { ok: true, report, detail: `setup 报告可用（pin.version=${version}${schemaNote}）：${file}` }
}

/**
 * 端口取值（**数字与字符串都认**）：`config.port` > `$XUANSHU_HOROSA_PORT` > `HOROSA_DEFAULT_PORT`。
 *
 * 为什么不能用 `text()` 取：YAML 里 `port: 18765` 的自然类型是**数字**，而 `text()` 只认字符串 ——
 * 「取数字」和「取字符串」混在一个 helper 里，就会把数字判成「没设」，静默回落到缺省端口
 * （用户把 config.port 与补丁行 URL 都改成 18765，宿主却把 serve 起在缺省端口上：工具全不见、日志里什么都没有）。
 */
function pickPort(cfg, env) {
  const fromConfig = cfg.port
  if (fromConfig !== undefined && fromConfig !== null && String(fromConfig).trim() !== '') return fromConfig
  const fromEnv = envText(env, 'XUANSHU_HOROSA_PORT')
  return fromEnv === '' ? HOROSA_DEFAULT_PORT : fromEnv
}

/**
 * 解析「怎么起 serve」的完整计划：版本 / wheel / uvx / 回环 host / 端口 / runtime 根 / 数据目录。
 *
 * 门序（任一不过即 ok:false，且**绝不**产生 spawn 副作用）：
 *   ① 回环门（R6）→ `non-loopback-host`
 *   ② 端口合法性 → `invalid-port`
 *   ③ setup 报告（pin 版本 + wheel 路径）→ `setup-report-missing`
 *   ④ wheel 落在盘上 → `wheel-missing`
 *
 * @param {object} [options]
 * @param {object} [options.paths]     `resolveHorosaPaths` 的结果（不给就自己解析）
 * @param {object} [options.config]    补丁行 config（认 `host` / `port` / `wheel` / `uvxBin` / `dataDir` / `runtimeRoot`）
 * @param {object} [options.env]       `process.env` 的形状（测试注入点）
 * @param {string} [options.platform]  `process.platform` 的形状（测试注入点）
 * @param {object} [options.report]    直接给的 setup 报告（给了就不读盘；测试便利）
 */
export function resolveHorosaPlan({ paths, config = {}, env = process.env, platform = process.platform, report } = {}) {
  const base = paths && typeof paths === 'object' ? paths : resolveHorosaPaths({ config, env, platform })
  const cfg = config && typeof config === 'object' ? config : {}

  // 端口先算出来（数字/字符串都认）：`fail()` 与门 ② 共用同一个值，两处口径不许再分叉。
  const rawPort = pickPort(cfg, env)
  const port = Number(rawPort)
  const portValid = Number.isInteger(port) && port >= 1 && port <= 65535

  /** 统一的失败形状：code 是机器判据，detail 说明白，hint 一定指到可执行动作。 */
  const fail = (code, detail, hint, extra = {}) => ({
    ok: false,
    code,
    wheel: null,
    version: null,
    uvxBin: null,
    host: HOROSA_DEFAULT_HOST,
    port: portValid ? port : HOROSA_DEFAULT_PORT,
    runtimeRoot: base.runtimeRoot,
    dataDir: base.dataDir,
    source: null,
    detail,
    hint: hint ?? SETUP_HINT,
    ...extra,
  })

  /* ---------- 门 ①：回环（R6；spawn 的 --host 恒为 127.0.0.1） ---------- */
  const configuredHost = text(cfg.host) || HOROSA_DEFAULT_HOST
  const loop = loopbackHost(configuredHost)
  if (loop === null) {
    return fail(
      'non-loopback-host',
      `配置的 host=${configuredHost} 不是回环字面量：拒绝起 serve（契约 §2.3「非回环不暴露」；` +
        '这一行的 URL 与 spawn 的 --host 都钉在 127.0.0.1）。',
      '把补丁行 config.host 改回 127.0.0.1（或 localhost）；非回环暴露是安全边界，不做开关。',
    )
  }
  const hostNote = loop === HOROSA_DEFAULT_HOST ? '' : `（配置 host=${loop}，spawn 仍按契约 R6 用 ${HOROSA_DEFAULT_HOST}）`

  /* ---------- 门 ②：端口 ---------- */
  if (!portValid) {
    return fail(
      'invalid-port',
      `端口非法（${JSON.stringify(rawPort)}）：MCP 端点只能在 1..65535 上。`,
      '给 config.port 一个 1..65535 的整数；同时把 profile 补丁行的 URL 端口改成同一个值。',
    )
  }

  /* ---------- 门 ③：setup 报告 → pin 版本 ---------- */
  // `report` 参数两种形状都认：**原始报告**（有 `pin`）与 `readSetupReport()` 的**返回对象**
  // （`{ok, report, detail}`）—— 调用方（测试/CLI）两种都给得出来，不逼它拆包。
  let read
  if (report && typeof report === 'object' && !Array.isArray(report)) {
    const candidate = report.report && typeof report.report === 'object' && !Array.isArray(report.report) ? report.report : report
    const version = text(candidate?.pin?.version)
    read =
      version !== ''
        ? { ok: true, report: candidate, detail: 'setup 报告由调用方直接给出。' }
        : { ok: false, report: candidate, detail: '直接给出的 setup 报告里没有 `pin.version`：版本只有这一个来源，不猜。' }
  } else {
    read = readSetupReport({ setupReportFile: base.setupReportFile })
  }
  if (!read.ok) {
    return fail('setup-report-missing', read.detail, SETUP_HINT)
  }
  const version = text(read.report?.pin?.version)

  /* ---------- 门 ④：wheel（config ?? env ?? 报告里的路径 ?? 缓存目录拼名） ---------- */
  const fromConfig = text(cfg.wheel)
  const fromEnv = envText(env, 'XUANSHU_HOROSA_WHEEL')
  const fromReport = text(read.report?.pin?.wheel?.path)
  const wheelName = text(read.report?.pin?.wheel?.name)
  const fromCache = wheelName !== '' ? join(base.cacheDir, wheelName) : ''
  const wheel = fromConfig || fromEnv || fromReport || fromCache
  const source = fromConfig ? 'config-wheel' : fromEnv ? 'XUANSHU_HOROSA_WHEEL' : fromReport ? 'setup-report' : fromCache ? 'cache-dir' : null
  if (wheel === '') {
    return fail(
      'wheel-missing',
      `setup 报告里没有 wheel 路径/文件名，也没有 config.wheel / $XUANSHU_HOROSA_WHEEL：\`uvx --from <wheel>\` 拼不出命令。`,
      SETUP_HINT + '（离线场景用 config.wheel / `XUANSHU_HOROSA_WHEEL` 指向已校验的本地 wheel 也行。）',
    )
  }
  // wheel 在不在盘上**只记事实、不当门**：路径合法性不是这一层的职责（取件与 SHA256 在票 05 的 setup 里），
  // 而「文件暂时不在」不该让整个计划变成 no-go —— 真正的失败会在 spawn 那一刻连同日志一起暴露。
  let wheelExists = false
  try {
    wheelExists = existsSync(wheel) && statSync(wheel).isFile()
  } catch {
    wheelExists = false
  }

  /* ---------- 计划成形 ---------- */
  const uvxBin = text(cfg.uvxBin) || envText(env, 'XUANSHU_UVX_BIN') || (platform === 'win32' ? 'uvx.exe' : 'uvx')
  return {
    ok: true,
    code: null,
    wheel,
    version,
    uvxBin,
    // R6：spawn 的 --host 恒为 127.0.0.1；配置里的回环别名只用于过门，不写进命令行。
    host: HOROSA_DEFAULT_HOST,
    port,
    runtimeRoot: base.runtimeRoot,
    dataDir: base.dataDir,
    source,
    wheelExists,
    detail: `计划：v${version}，wheel=${wheel}（来源 ${source}${wheelExists ? '' : '，**当前不在盘上**（不影响计划，spawn 时会失败并落日志）'}），uvx=${uvxBin}，端点 http://${HOROSA_DEFAULT_HOST}:${port}，runtime=${base.runtimeRoot}，data=${base.dataDir}${hostNote}`,
    hint: null,
  }
}

/**
 * runtime 同版本门（R2）：读 `<runtimeRoot>/current/runtime-manifest.json`。
 *
 * 版本读序 `runtime_payload_version` → `version`（契约 §3.2 R2 点名的两个键）。
 * **不**读 `manifest_version` / `derived_from` 一类的元数据键：那描述的是清单本身，
 * 拿它兜底会让「新清单 + 旧载荷」静默过门（与票 05 A3 同一裁决）。
 *
 * @param {object} [options]
 * @param {string} [options.runtimeRoot]      runtime 根（缺省 `C:\horosa`）
 * @param {string} [options.expectedVersion]  pin 版本（来自 `resolveHorosaPlan`）
 * @returns {{ ok:boolean, installed:boolean, version:string|null, expectedVersion:string|null, code:string|null, manifestFile:string|null, detail:string, hint:string|null }}
 */
export function ensureRuntime({ runtimeRoot, expectedVersion } = {}) {
  const root = text(runtimeRoot)
  const expected = text(expectedVersion) || null
  const manifestFile = root === '' ? null : join(root, RUNTIME_MANIFEST_RELATIVE)

  if (expected === null) {
    return {
      ok: false,
      installed: false,
      version: null,
      expectedVersion: null,
      code: 'setup-report-missing',
      manifestFile,
      detail: '没有期望版本（pin 读不到）：同版本门无从判定，按不通过处理。',
      hint: SETUP_HINT,
    }
  }

  const manifest = readJsonObject(manifestFile)
  if (!manifest) {
    return {
      ok: false,
      installed: false,
      version: null,
      expectedVersion: expected,
      code: 'runtime-not-installed',
      manifestFile,
      detail: `runtime 清单读不到或不是 JSON 对象：${manifestFile ?? '(runtimeRoot 为空)'}（未安装）。`,
      hint: SETUP_HINT,
    }
  }

  const version = text(manifest.runtime_payload_version) || text(manifest.version) || null
  if (version === null) {
    return {
      ok: false,
      installed: true,
      version: null,
      expectedVersion: expected,
      code: 'runtime-version-mismatch',
      manifestFile,
      detail: `runtime 清单里既没有 runtime_payload_version 也没有 version：${manifestFile}（版本读不到 = 门不过）。`,
      hint: SETUP_HINT + ` 或强制重装同版本：\`${HOROSA_SETUP_COMMAND} -- --force\`。`,
    }
  }
  if (version !== expected) {
    return {
      ok: false,
      installed: true,
      version,
      expectedVersion: expected,
      code: 'runtime-version-mismatch',
      manifestFile,
      detail: `runtime 版本不符：装了 ${version}，期望 ${expected}（清单 ${manifestFile}）——「新宿主混旧 runtime」正是这道门要拦的组合。`,
      hint: SETUP_HINT + ` 或强制重装同版本：\`${HOROSA_SETUP_COMMAND} -- --force\`。`,
    }
  }
  return {
    ok: true,
    installed: true,
    version,
    expectedVersion: expected,
    code: null,
    manifestFile,
    detail: `runtime 已装且同版本（${version}）：${manifestFile}`,
    hint: null,
  }
}
