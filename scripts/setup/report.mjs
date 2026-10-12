/**
 * scripts/setup/report.mjs — 报告的形状与落盘（票 05 契约 §7）。
 *
 * 报告是**唯一机器可读产物**：`<dsh-home>/xuanshu/setup-report.json`，schema `xuanshu/setup-report@1`。
 * 退出码与它同源（`report.exitCode`），所以不许出现「报告说成功、退出码非 0」这种两处各说一套的形状。
 *
 * 两条硬约束：
 *   1. `checks[].id` 恰为 `assembly` / `horosa8765` / `bazi`，顺序即打印顺序；
 *   2. 证据只放**小体积**关键字段（单项 ≤ 2KB，超了截断并标 `truncated`）——大输出落
 *      `<dsh-home>/xuanshu/logs/`，报告里只记路径。
 *
 * 仅使用 Node 内置模块。ESM。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { exitLabel } from './exit.mjs'

/** 报告 schema（冻结）。 */
export const REPORT_SCHEMA = 'xuanshu/setup-report@1'

/** 三条自检的 id 与顺序（冻结：顺序即打印顺序）。 */
export const CHECK_IDS = Object.freeze(['assembly', 'horosa8765', 'bazi'])

/** 单条 evidence 的字节上限（契约 §7）。 */
export const EVIDENCE_LIMIT_BYTES = 2048

/** 三条自检的固定骨架（顺序从这里来，调用方只填结果）。 */
export const CHECK_TITLES = Object.freeze({
  assembly: 'DSH 装配可启动',
  horosa8765: 'horosa 8765 健康（MCP initialize + tools/list）',
  bazi: '八字工具可用（tools/list 含 horosa_cn_bazi_birth + tools/call envelope）',
})

/** 建一份骨架报告；随后各步往里填。 */
export function newReport({ pin, paths, now = new Date() } = {}) {
  return {
    schema: REPORT_SCHEMA,
    generatedAt: now.toISOString(),
    ok: false,
    pin: {
      version: pin?.version ?? null,
      wheel: { name: pin?.wheel?.name ?? null, sha256: pin?.wheel?.sha256 ?? null, path: null, action: null },
      runtime: {
        platform: pin?.runtime?.platform ?? null,
        sha256: pin?.runtime?.sha256 ?? null,
        path: null,
        action: null,
      },
    },
    runtime: {
      root: paths?.runtimeRoot ?? null,
      dataDir: paths?.dataDir ?? null,
      action: 'skipped',
      version: pin?.version ?? null,
    },
    profile: {
      name: paths?.profile ?? null,
      home: paths?.home ?? null,
      mode: paths?.profileMode ?? 'link',
      action: 'skipped',
    },
    checks: [],
    exitCode: 0,
    notes: [],
  }
}

/** 把证据折成「小体积关键字段」：超限截断并标记，绝不把大输出塞进报告。 */
export function clipEvidence(value, limit = EVIDENCE_LIMIT_BYTES) {
  if (value === undefined) return undefined
  let text
  try {
    text = JSON.stringify(value)
  } catch {
    return { truncated: true, note: 'evidence 不是可序列化的对象' }
  }
  if (text === undefined) return undefined
  if (Buffer.byteLength(text, 'utf8') <= limit) return value

  if (typeof value === 'string') {
    const clipped = value.slice(0, Math.max(0, limit - 40))
    return `${clipped}\n…（截断：原文 ${Buffer.byteLength(value, 'utf8')} 字节，上限 ${limit}）`
  }
  if (value !== null && typeof value === 'object') {
    const kept = {}
    for (const [key, item] of Object.entries(value)) {
      kept[key] = typeof item === 'string' ? item.slice(0, 200) : item
      if (Buffer.byteLength(JSON.stringify(kept), 'utf8') > limit - 60) break
    }
    kept.truncated = true
    kept.note = `原始 evidence ${Buffer.byteLength(text, 'utf8')} 字节，超出 ${limit} 上限，已裁剪`
    return kept
  }
  const clipped = text.slice(0, Math.max(0, limit - 40))
  return `${clipped}…（截断）`
}

/** 写报告（原子性够用即可：临时文件 + rename 会在 Windows 上多一层坑，这里直接覆盖写）。 */
export function writeReport(reportFile, report) {
  mkdirSync(dirname(reportFile), { recursive: true })
  const body = `${JSON.stringify(report, undefined, 2)}\n`
  writeFileSync(reportFile, body, 'utf8')
  return reportFile
}

/** 人类可读摘要（stdout 走这份；`--json` 时 stdout 只有 JSON）。 */
export function formatReport(report) {
  const lines = []
  const dash = (value) => (value === null || value === undefined || value === '' ? '-' : value)
  lines.push(`玄枢 setup  report=${REPORT_SCHEMA}`)
  lines.push(`  DSH home    ${dash(report.profile?.home)}`)
  lines.push(`  profile     ${dash(report.profile?.name)} (${dash(report.profile?.mode)}) → ${dash(report.profile?.action)}`)
  lines.push(`  horosa      pin v${dash(report.pin?.version)}`)
  lines.push(`  wheel       ${dash(report.pin?.wheel?.action)}  ${dash(report.pin?.wheel?.path)}`)
  lines.push(`  runtime     ${dash(report.pin?.runtime?.action)}  platform=${dash(report.pin?.runtime?.platform)}  ${dash(report.pin?.runtime?.path)}`)
  lines.push(`  runtime 落点 ${dash(report.runtime?.root)}  → ${dash(report.runtime?.action)} v${dash(report.runtime?.version)}`)
  lines.push('')
  if (report.checks.length === 0) lines.push('  自检：未运行')
  for (const check of report.checks) {
    lines.push(`[${check.id}] ${CHECK_TITLES[check.id] ?? check.detail ?? ''}`)
    lines.push(`      ${check.ok ? 'PASS' : 'FAIL'}  ${check.detail ?? ''}${check.durationMs !== undefined ? `  (${check.durationMs}ms)` : ''}`)
  }
  if (report.error !== undefined) lines.push(`\n错误：${report.error}`)
  if (report.hint !== undefined) lines.push(report.hint)
  for (const note of report.notes ?? []) lines.push(`note: ${note}`)
  lines.push('')
  lines.push(`退出码 ${report.exitCode}（${exitLabel(report.exitCode)}）`)
  return lines.join('\n')
}
