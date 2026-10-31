/**
 * `scripts/ux/waivers.mjs` —— **护栏的历史豁免清单**（spec 003 §修复通道 · 票 10 的补丁）。
 *
 * 为什么需要清单：护栏按提交逐条判，而「票在自己的 worktree 里改 `rules/`、集成时统一签字」
 * 是这套并行模型里**正常**的中间态 —— 历史被压平之后，那些提交单独看就是「改了判据没签字」。
 * 把它们改掉要重写已推送的历史；把它们静默跳过又等于关掉护栏。
 *
 * 所以留一份**逐条带理由**的清单：放行的每一条都会在输出里原样打印出来，读的人看得见
 * 「放过了什么、为什么」。清单里对不上任何违规的条目算**过期**，按红处理 —— 否则它会慢慢
 * 长成一份没人再看的黑名单。
 *
 * 文件放在 `docs/design/ui-v1/guardrail-waivers.json`：不在 `criteria/` 生效区内
 * （`criteria.json` / `rules/**` / `freeze.json`），所以改清单不需要重新冻结签字。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 清单落点（仓库相对路径）。 */
export const WAIVER_FILE = 'docs/design/ui-v1/guardrail-waivers.json'

/** 清单的 schema 标记。改形状时一起改。 */
export const WAIVER_SCHEMA = 'xuanshu/ux-guardrail-waivers@1'

/** 已知的护栏名（写错名字的豁免永远不会生效，所以在这里封死）。 */
export const GUARD_NAMES = ['authority', 'fix-notes']

/** 清单本身坏了（不是「没有豁免」）。 */
export class WaiverError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WaiverError'
  }
}

/**
 * 读清单。文件不存在 → 空清单（一开始没有豁免是正常状态，不是错）。
 *
 * @param {{repoRoot: string}} input
 * @returns {{guard: string, sha: string, kind: string|null, reason: string, recordedAt: string|null, recordedBy: string|null}[]}
 */
export function readWaivers({ repoRoot }) {
  const path = join(repoRoot, WAIVER_FILE)
  if (!existsSync(path)) return []
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new WaiverError(`${WAIVER_FILE} 不是合法 JSON：${error.message}`)
  }
  if (parsed?.schema !== WAIVER_SCHEMA) {
    throw new WaiverError(`${WAIVER_FILE} 的 schema 应为 ${WAIVER_SCHEMA}，实际是 ${String(parsed?.schema)}`)
  }
  const list = Array.isArray(parsed.waivers) ? parsed.waivers : null
  if (list === null) throw new WaiverError(`${WAIVER_FILE} 缺 waivers 数组`)

  return list.map((entry, index) => {
    const where = `${WAIVER_FILE} 第 ${index + 1} 条`
    if (typeof entry?.guard !== 'string' || !GUARD_NAMES.includes(entry.guard)) {
      throw new WaiverError(`${where}：guard 必须是 ${GUARD_NAMES.join(' / ')}`)
    }
    if (typeof entry?.sha !== 'string' || !/^[0-9a-f]{7,40}$/u.test(entry.sha)) {
      throw new WaiverError(`${where}：sha 要是 7–40 位小写十六进制`)
    }
    if (typeof entry?.reason !== 'string' || entry.reason.trim() === '') {
      throw new WaiverError(`${where}：reason 必填（没有理由的豁免就是黑名单）`)
    }
    return {
      guard: entry.guard,
      sha: entry.sha,
      kind: typeof entry.kind === 'string' && entry.kind !== '' ? entry.kind : null,
      reason: entry.reason.trim(),
      recordedAt: typeof entry.recordedAt === 'string' ? entry.recordedAt : null,
      recordedBy: typeof entry.recordedBy === 'string' ? entry.recordedBy : null,
    }
  })
}

/**
 * 把清单应用到一批违规上。
 *
 * 匹配口径：`guard` 必须相同、`sha` 前缀匹配（清单里通常写 7 位短 sha）、
 * `kind` 给了就必须相同（不给则该提交的所有同类违规都放行）。
 *
 * @param {{violations: {kind: string, sha?: string}[], waivers: ReturnType<typeof readWaivers>, guard: string}} input
 * @returns {{kept: object[], waived: {waiver: object, count: number}[], stale: object[]}}
 */
export function applyWaivers({ violations, waivers, guard }) {
  const mine = waivers.filter((waiver) => waiver.guard === guard)
  const kept = []
  const hits = new Map(mine.map((waiver) => [waiver, 0]))

  for (const violation of violations) {
    const match = mine.find((waiver) => (
      typeof violation.sha === 'string'
      && violation.sha.startsWith(waiver.sha)
      && (waiver.kind === null || waiver.kind === violation.kind)
    ))
    if (match === undefined) kept.push(violation)
    else hits.set(match, (hits.get(match) ?? 0) + 1)
  }

  const waived = []
  const stale = []
  for (const [waiver, count] of hits) {
    if (count === 0) stale.push(waiver)
    else waived.push({ waiver, count })
  }
  return { kept, waived, stale }
}

/**
 * 一条豁免的人读一行（放行的与过期的都要能看见）。
 * @param {{waiver: object, count: number}} hit
 */
export function describeWaiver({ waiver, count }) {
  const who = waiver.recordedBy === null ? '' : `（${waiver.recordedBy}）`
  return `  ⚠ 豁免 ${waiver.sha}${waiver.kind === null ? '' : ` · ${waiver.kind}`} ×${count}${who}：${waiver.reason}`
}

/**
 * 一条过期豁免的人读一行。
 * @param {object} waiver
 */
export function describeStaleWaiver(waiver) {
  return `  ✗ 过期豁免 ${waiver.sha}${waiver.kind === null ? '' : ` · ${waiver.kind}`}：`
    + `这一条在当前范围里对不上任何违规 —— 从 ${WAIVER_FILE} 里删掉它`
}
