/**
 * scripts/setup/args.mjs — 票 05 setup 的**唯一**参数解析（契约 §2 参数表）。
 *
 * 规矩：
 *   - 表里列出的每个参数都收，表里没有的一律 exit 1（宁可用法错，不要「静默忽略一个你以为生效了的开关」）；
 *   - 数值参数在这里就折成数（`--retries abc` 是用法错，不许变成 NaN 一路漂到下载循环里）；
 *   - 只做解析与合法性，**不碰文件系统、不发请求** —— 这样 `--dry-run` 与单测都能只调它。
 *   - `--help` 打印的就是 `scripts/setup.mjs` 的文件头注释块（与 `install-profile.mjs` 同款）。
 *
 * 缺省值一律写在这里（而不是散在各模块）：runbook、测试、报告都对着同一份缺省说话。
 *
 * 仅使用 Node 内置模块。ESM。
 */

import { readFileSync } from 'node:fs'

import { EXIT, SetupError } from './exit.mjs'

/** 缺省值：契约 §2 参数表的「缺省」列，逐条对齐。 */
export const DEFAULTS = Object.freeze({
  profile: 'xuanshu',
  profileMode: 'link',
  retries: 3,
  selfcheckTimeoutMs: 600_000,
})

/** `--profile-mode` 的合法值（透传给 `install-profile.mjs`）。 */
export const PROFILE_MODES = ['link', 'copy']

/** 每个带值参数的名字 → opts 键（解析器与错误信息共用一份，免得两处对不上）。 */
const VALUE_OPTIONS = {
  '--wheel': 'wheel',
  '--runtime': 'runtime',
  '--mirror': 'mirror',
  '--retries': 'retries',
  '--cache': 'cache',
  '--runtime-root': 'runtimeRoot',
  '--dsh-home': 'dshHome',
  '--profile': 'profile',
  '--profile-mode': 'profileMode',
  '--selfcheck-timeout': 'selfcheckTimeoutMs',
  '--horosa-port': 'horosaPort',
}

/** 布尔开关 → opts 键。 */
const FLAG_OPTIONS = {
  '--recheck': 'recheck',
  '--install': 'install',
  '--force': 'force',
  '--skip-download': 'skipDownload',
  '--verify-only': 'verifyOnly',
  '--no-selfcheck': 'noSelfcheck',
  '--keep-serve': 'keepServe',
  '--dry-run': 'dryRun',
  '--json': 'json',
}

/** 「这个开关要不要值」——缺值时报错比默默吞掉下一个参数好。 */
export function optionTakesValue(arg) {
  return Object.hasOwn(VALUE_OPTIONS, arg)
}/**
 * 解析 argv。
 *
 * @param {string[]} argv
 * @returns {ReturnType<typeof defaults>} 归一化后的 opts（含 `help`）
 * @throws {SetupError} code = EXIT.usage
 */
export function parseArgs(argv = []) {
  const opts = defaults()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '-h' || arg === '--help') {
      opts.help = true
      continue
    }
    if (Object.hasOwn(FLAG_OPTIONS, arg)) {
      opts[FLAG_OPTIONS[arg]] = true
      continue
    }
    if (Object.hasOwn(VALUE_OPTIONS, arg)) {
      const raw = argv[index + 1]
      // 下一个参数是 `--xxx` 一律当「缺值」：那样报错最准；也让 `--profile --json` 不再把 `--json` 吃成 profile 名。
      if (raw === undefined || raw.startsWith('--')) {
        throw new SetupError(`${arg} 需要一个值`, { code: EXIT.usage, hint: usageHint() })
      }
      opts[VALUE_OPTIONS[arg]] = raw
      index += 1
      continue
    }
    throw new SetupError(`未知参数：${arg}`, { code: EXIT.usage, hint: usageHint() })
  }
  return normalize(opts)
}

/** 缺省 opts（未解析任何 argv）。 */
export function defaults() {
  return {
    help: false,
    json: false,
    dryRun: false,
    recheck: false,
    install: false,
    force: false,
    skipDownload: false,
    verifyOnly: false,
    noSelfcheck: false,
    keepServe: false,
    wheel: undefined,
    runtime: undefined,
    mirror: undefined,
    retries: DEFAULTS.retries,
    cache: undefined,
    runtimeRoot: undefined,
    dshHome: undefined,
    profile: DEFAULTS.profile,
    profileMode: DEFAULTS.profileMode,
    selfcheckTimeoutMs: DEFAULTS.selfcheckTimeoutMs,
    horosaPort: undefined,
  }
}

/** 类型/枚举/范围校验。故意不在这里查路径存在性（那是环境门的事，退出码不同）。 */
function normalize(opts) {
  opts.retries = positiveInt(opts.retries, '--retries', { min: 1, max: 20 })
  opts.selfcheckTimeoutMs = positiveInt(opts.selfcheckTimeoutMs, '--selfcheck-timeout', { min: 1000, max: 3_600_000 })
  if (opts.horosaPort !== undefined) opts.horosaPort = positiveInt(opts.horosaPort, '--horosa-port', { min: 1, max: 65535 })
  if (opts.profileMode !== undefined && !PROFILE_MODES.includes(opts.profileMode)) {
    throw new SetupError(`--profile-mode 只接受 ${PROFILE_MODES.join(' | ')}，收到 ${JSON.stringify(opts.profileMode)}`, {
      code: EXIT.usage,
    })
  }
  for (const key of ['wheel', 'runtime', 'cache', 'runtimeRoot', 'dshHome', 'profile']) {
    if (opts[key] === '') throw new SetupError(`--${camelToKebab(key)} 不能是空串`, { code: EXIT.usage })
  }
  for (const key of ['wheel', 'runtime', 'mirror', 'cache', 'runtimeRoot', 'dshHome', 'profile']) {
    if (opts[key] !== undefined) opts[key] = String(opts[key])
  }
  return opts
}

function positiveInt(raw, label, { min, max }) {
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new SetupError(`${label} 需要 ${min}..${max} 的整数，收到 ${JSON.stringify(raw)}`, { code: EXIT.usage })
  }
  return value
}

const camelToKebab = (key) => key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)

/** 用人话给一条「怎么用」的提示（错误信息里附它，比让人翻文档强）。 */
export function usageHint() {
  return '# 用法: node scripts/setup.mjs [选项…]    # 全部选项见 node scripts/setup.mjs --help'
}

/**
 * 打印 `entry` 文件头部的注释块（与 `install-profile.mjs --help` 同一手法：
 * 文档就在代码顶上，不可能与实现漂移两处）。
 */
export function readHelpBlock(entry) {
  const text = readFileSync(entry, 'utf8')
  const start = text.indexOf('/**')
  const end = text.indexOf('*/')
  if (start < 0 || end < 0) return '（找不到文件头注释块）'
  return text
    .slice(start + 3, end)
    .split('\n')
    .map((line) => line.replace(/^ \* ?/, '').replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
}
