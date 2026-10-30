#!/usr/bin/env node
/**
 * `scripts/ux/probes/x.mjs` —— 判据族 `X`（文案一致性）的**证据采集**。
 *
 * 两条口径（`X-001` 的两个子句各对应一条）：
 *   1. **同一状态用同一套说法**：比对面里出现的文案与族字典
 *      （`CANONICAL_WORDING` 允许 / `BANNED_WORDING` 禁止）——「暂无」与「还没有」并存
 *      「加载中」与「正在读」并存，就是两种说法；
 *   2. **错误行必须有可执行的下一步**：错误行 ±6 行内要有一个动作词（重试 / 换个 / 请在…）。
 *      只写「失败了」不给下一步，等于把闸门藏起来。
 *
 * 判据是「所有界面面同一套」，但判定按面发生：字典是**全局唯一**的那一份，
 * 所以「每个面都对齐同一份字典」在效果上等价于「全仓同一套说法」；报告里点名的是
 * 「这个面用了哪个不在字典里的说法」，人一眼能改。
 *
 * 本文件**只收证据、不判对错**。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { CANONICAL_WORDING, STATES, STATE_LABEL } from '../state-vocabulary.mjs'
import { scanFace } from './state-scan.mjs'

/** 每条证据最多取几条（一个面里刷出 20 条同款也只报前 2 条）。 */
const EVIDENCE_PER_KIND = 2

/** 把某个状态允许的说法写成一句人话（报告里要能照抄去改）。 */
function canonicalText(state) {
  const patterns = CANONICAL_WORDING[state] ?? []
  return patterns.map((pattern) => pattern.source.replace(/\(\?:[^)]*\)/g, '…').replace(/[\\^$]/g, '')).join(' / ')
}

/**
 * X-001：文案一致性。
 *
 * @param {{face: {id: string, label: string, sources: string[]}, read: Function}} ctx
 * @returns {{facts: object, evidence: {file: string, line: number, detail: string}[]}}
 */
export function probeWordingConsistency({ face, read }) {
  const scan = scanFace(face, read)

  const violations = []
  for (const state of STATES) {
    for (const hit of scan.wording[state].banned.samples) {
      violations.push({ state, ...hit })
    }
  }

  const perState = {}
  let wordingCount = 0
  for (const state of STATES) {
    const canonical = scan.wording[state].canonical
    wordingCount += canonical.count
    perState[state] = {
      canonicalCount: canonical.count,
      bannedCount: scan.wording[state].banned.count,
      samples: canonical.samples.slice(0, EVIDENCE_PER_KIND),
    }
  }

  // 错误行在场吗：有错误分支或失败说法就算（只有 {error} 变量直出、没有一句中文的，
  // 这里仍算「有错误行」——「可读」由 S-003 判，这里只判「有没有下一步」）。
  const errorPresent = scan.states.error.branch.count > 0 || scan.states.error.hint.count > 0

  const facts = {
    faceLabel: face.label,
    sourceFiles: scan.sourceFiles,
    scannedFiles: scan.scannedFiles,
    wordingCount,
    perState,
    violations,
    errorPresent,
    errorActionable: { count: scan.errorActionable.count, samples: scan.errorActionable.samples },
    anchor: scan.anchor,
  }

  if (violations.length > 0) {
    return {
      facts,
      evidence: violations.slice(0, EVIDENCE_PER_KIND).map((violation) => ({
        file: violation.file,
        line: violation.line,
        detail: `${STATE_LABEL[violation.state]}用了「${violation.token}」，族字典只允许「${canonicalText(violation.state)}」：${violation.text}`,
      })),
    }
  }

  if (errorPresent && scan.errorActionable.count === 0) {
    return {
      facts,
      evidence: [
        {
          file: scan.anchor.file,
          line: scan.anchor.line,
          detail: `${face.label}（${face.id}）的错误行没有可执行的下一步（没有重试 / 换个 / 请在…）`,
        },
      ],
    }
  }

  if (wordingCount === 0) {
    return {
      facts,
      evidence: [
        {
          file: scan.anchor.file,
          line: scan.anchor.line,
          detail: `${face.label}（${face.id}）里没有任何状态文案，无法证明「同一套说法」（与 S 族同因）`,
        },
      ],
    }
  }

  const evidence = []
  for (const state of STATES) {
    for (const hit of perState[state].samples) {
      evidence.push({ file: hit.file, line: hit.line, detail: `${STATE_LABEL[state]}说法：${hit.token}` })
    }
  }
  if (errorPresent) {
    for (const hit of scan.errorActionable.samples.slice(0, 1)) {
      evidence.push({ file: hit.file, line: hit.line, detail: `错误行的下一步：${hit.text}` })
    }
  }
  return { facts, evidence }
}

/** 族 X 的检查器表：键 = 判据 id（与 `rules/X.json` 一一对应）。 */
export const X_PROBES = {
  'X-001': probeWordingConsistency,
}
