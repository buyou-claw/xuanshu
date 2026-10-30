#!/usr/bin/env node
/**
 * `scripts/ux/probes/s.mjs` —— 判据族 `S`（状态齐全：空 / 载 / 错）的**证据采集**。
 *
 * 三条判据共用同一份扫描（`scanFace`），只是各取一个状态：
 *   `S-001` → empty · `S-002` → loading · `S-003` → error
 *
 * 采集口径（完整版在 `state-vocabulary.mjs` 文件头，这里只重复三条最容易做歪的）：
 *   1. **注释不算**：先把注释剥掉再看，JSDoc 里写「三态齐全」不产生证据；
 *   2. **同一个源文件里**既要有分支、又要有可见说明（一句话 / 骨架屏），
 *      分支在 A 文件、话在 B 文件按缺席判 —— 那说明这个面的状态是拼出来的；
 *   3. **未采到 ≠ 通过**：源文件读不到时采集器抛错，`collect/static.mjs` 会把这条记成
 *      `collection-failed`，判定器不会把它算成通过。
 *
 * 本文件**只收证据、不判对错**：`facts` 给事实（命中了什么、缺的是什么），
 * 「算不算过」只发生在 `scripts/ux/assertions/s.mjs`。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { STATE_LABEL } from '../state-vocabulary.mjs'
import { scanFace, stateForCriterion } from './state-scan.mjs'

/** 每条证据最多取几条（报告读得下即可；事实里的计数是完整的）。 */
const EVIDENCE_PER_KIND = 2

/** 缺席时那句人话：缺的是哪一半，说清楚（别只说「不达标」）。 */
function missingReason(entry) {
  if (entry.branch.count === 0) return '源文件的代码里没有该状态的分支（没有条件、没有状态标记属性）'
  if (entry.visual.count === 0) return '有分支，但没有任何可见说明（没有一句中文提示，加载态也没有骨架屏）'
  return '分支与说明不在同一个源文件里（分支在一个文件、话在另一个文件，渲染到人眼前时没人担保）'
}

/**
 * 一个状态的采集函数（S-001 / S-002 / S-003 共用）。
 *
 * @param {{face: {id: string, label: string, sources: string[]}, read: Function}} ctx
 * @param {string} criterionId 判据 id（决定采哪一态）
 * @returns {{facts: object, evidence: {file: string, line: number, detail: string}[]}}
 */
function probeState(ctx, criterionId) {
  const { face, read } = ctx
  const state = stateForCriterion(criterionId)
  const label = STATE_LABEL[state]
  const scan = scanFace(face, read)
  const entry = scan.states[state]
  const present = entry.filesWithBoth.length > 0

  const facts = {
    state,
    label,
    present,
    faceLabel: face.label,
    sourceFiles: scan.sourceFiles,
    scannedFiles: scan.scannedFiles,
    branch: { count: entry.branch.count, samples: entry.branch.samples },
    visual: { count: entry.visual.count, samples: entry.visual.samples },
    filesWithBoth: entry.filesWithBoth,
    missing: present ? [] : [entry.branch.count === 0 ? 'branch' : entry.visual.count === 0 ? 'visual' : 'same-file'],
    anchor: scan.anchor,
  }

  if (present) {
    return {
      facts,
      evidence: [
        ...entry.branch.samples.slice(0, EVIDENCE_PER_KIND).map((hit) => ({
          file: hit.file,
          line: hit.line,
          detail: `${label}分支：${hit.text}`,
        })),
        ...entry.visual.samples.slice(0, EVIDENCE_PER_KIND).map((hit) => ({
          file: hit.file,
          line: hit.line,
          detail: `${label}说明：${hit.text}`,
        })),
      ],
    }
  }

  // 缺席也要指得回「哪个组件」：落在这个面的组件入口行上（不是文件第 1 行那种糊弄）。
  return {
    facts,
    evidence: [
      {
        file: scan.anchor.file,
        line: scan.anchor.line,
        detail: `${face.label}（${face.id}）缺${label}：${missingReason(entry)}`,
      },
    ],
  }
}

/** 族 S 的检查器表：键 = 判据 id（与 `rules/S.json` 一一对应，缺一条采集器会直接报错）。 */
export const S_PROBES = {
  'S-001': (ctx) => probeState(ctx, 'S-001'),
  'S-002': (ctx) => probeState(ctx, 'S-002'),
  'S-003': (ctx) => probeState(ctx, 'S-003'),
}
