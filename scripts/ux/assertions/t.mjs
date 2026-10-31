#!/usr/bin/env node
/**
 * `scripts/ux/assertions/t.mjs` —— 判据族 T 的**判定**（「算不算过」只在这里与 judge 里出现）。
 *
 * 形状：`(facts) => { pass, message }`。**不读文件、不碰环境**：给它同一份 facts，它必须给同一个答案，
 * 否则兑现率不可复现。
 *
 * 三条第二批判据（票 04 / #51）都按**面**判：facts 里是「这个界面面自己的命中」，
 * 跨面聚合（全部注入点 / `--dsw-alias-*` 消费点）只用来把话说得有数据、可核，不参与通过与否——
 * 否则一个面的红会按另一个面的证据来算，分母就糊了。
 *
 * 仅使用 Node 内置模块。ESM。
 */

/** 把命中的位置压成一行可读摘要（超过 6 处就收尾，避免报告被一行刷爆）。 */
function summarize(occurrences, limit = 6) {
  const shown = occurrences.slice(0, limit).map((occurrence) => `${occurrence.file}:${occurrence.line}（${occurrence.literal}）`)
  const rest = occurrences.length - shown.length
  return rest > 0 ? `${shown.join('、')} 等 ${occurrences.length} 处` : shown.join('、')
}

/** 把任意命中压成 `file:line（说明）` 的摘要（三条第二批判据共用）。 */
function summarizeHits(hits, describe, limit = 5) {
  const shown = hits.slice(0, limit).map((hit) => `${hit.file}:${hit.line}（${describe(hit)}）`)
  const rest = hits.length - shown.length
  return rest > 0 ? `${shown.join('、')} 等 ${hits.length} 处` : shown.join('、')
}

/** 断点的语义权威写进每一句话里（读不到 token 字典时如实说，不编一个值）。 */
function breakpointAuthority(token) {
  if (token === null || token === undefined || typeof token.value !== 'string') {
    return '断点语义权威 `--xs-size-breakpoint-wide` 没读到（token 字典缺失，先修字典）'
  }
  return `断点语义权威 \`${token.name}\` = ${token.value}`
}

/** `--dsw-alias-*` 消费事实的一句话（T-004 的 message 要点名它，且每个数字都由 facts 支撑）。 */
function aliasSummary(alias) {
  const sites = alias?.sites ?? 0
  const byFile = (alias?.byFile ?? []).map((entry) => `${entry.file.split('/').pop()} ${entry.sites}`).join(' / ')
  const tokens = (alias?.tokens ?? []).length
  const files = (alias?.byFile ?? []).length
  const where = byFile === '' ? '' : `：${byFile}`
  const unreadable = (alias?.unreadable ?? []).length
  const caveat = unreadable === 0 ? '' : `（另有 ${unreadable} 个源文件没读到，这个数偏低）`
  // spec §Further Notes 写的「全仓仅 4 处」按同一个口径（`var(--dsw-alias-…` 的出现次数）数不出来；
  // 报告把这句放在 message 里，是因为「token 消费不足」这条结论必须有可核的数字撑着。
  return `全仓 \`--dsw-alias-*\` 消费 ${sites} 处 / ${files} 个文件 / ${tokens} 个 token${where}（spec 记的「4 处」是旧数字）${caveat}`
}

export const T_ASSERTIONS = {
  /**
   * T-001：样式里不许出现字面色值。
   * @param {{occurrences: {file: string, line: number, literal: string}[], scannedFiles: number}} facts
   */
  'T-001': (facts) => {
    const occurrences = facts?.occurrences ?? []
    if (occurrences.length === 0) return { pass: true, message: '没有字面色值' }
    return {
      pass: false,
      message: `命中 ${occurrences.length} 处字面色值：${summarize(occurrences)}`,
    }
  },

  /**
   * T-002：这个界面面不许自己注入 `<style>`（样式注入点要收敛在单一消费层）。
   * @param {{injections: {file: string, line: number, symbol: string, sharedBy: number}[], repo: {total: number, points: {file: string, line: number, symbol: string, sharedBy: number}[]}}} facts
   */
  'T-002': (facts) => {
    const own = facts?.injections ?? []
    const repo = facts?.repo ?? { total: 0, points: [] }
    const worst = repo.points ?? []
    const heaviest = worst.length > 0 ? `最重的是 ${worst[0].file}:${worst[0].line}（${worst[0].sharedBy} 个面共享）` : '没有任何注入点'
    if (own.length === 0) {
      return { pass: true, message: `本面源文件没有 <style> 注入点（跨面共 ${repo.total} 个，${heaviest}）` }
    }
    return {
      pass: false,
      message: `命中 ${own.length} 个样式注入点：${summarizeHits(own, (hit) => `${hit.symbol}，${hit.sharedBy} 面共享`)}；跨面共 ${repo.total} 个注入点，${heaviest}`,
    }
  },

  /**
   * T-003：断点不许写字面值。
   * @param {{token: {name: string, value: string|null}|null, breakpoints: {file: string, line: number, feature: string, value: string}[], repo: {total: number, byValue: {value: string, count: number}[]}}} facts
   */
  'T-003': (facts) => {
    const own = facts?.breakpoints ?? []
    const authority = breakpointAuthority(facts?.token)
    if (own.length === 0) return { pass: true, message: `没有字面断点（${authority}）` }
    const tokenValue = facts?.token?.value
    const unknown = [...new Set(own.map((breakpoint) => breakpoint.value))].filter((value) => value !== tokenValue)
    const extra = unknown.length === 0 ? '' : `；${unknown.join(' / ')} 在 token 字典里没有对应断点`
    return {
      pass: false,
      message: `命中 ${own.length} 处字面断点：${summarizeHits(own, (hit) => hit.feature === 'min-width' ? `min-width: ${hit.value}` : `max-width: ${hit.value}`)}；${authority}${extra}`,
    }
  },

  /**
   * T-004：颜色声明一律从 token 取。
   * @param {{declarations: {file: string, line: number, property: string, value: string}[], summary: {total: number, token: number, keyword: number, literal: number, nonColor: number}, alias: {sites: number, byFile: {file: string, sites: number}[], tokens: {name: string, sites: number}[], unreadable: string[]}}} facts
   */
  'T-004': (facts) => {
    const own = facts?.declarations ?? []
    const summary = facts?.summary ?? { total: 0, token: 0, keyword: 0, literal: 0, nonColor: 0 }
    const ledger = `本面 ${summary.total} 处颜色声明：${summary.token} 走 token、${summary.keyword} 合法关键字、${summary.literal} 字面值、${summary.nonColor} 不主张颜色`
    if (own.length === 0) return { pass: true, message: ledger }
    return {
      pass: false,
      message: `命中 ${own.length} 处颜色声明没从 token 取：${summarizeHits(own, (hit) => `${hit.property}: ${hit.value}`)}；${ledger}；${aliasSummary(facts?.alias)}`,
    }
  },
}
