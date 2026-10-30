#!/usr/bin/env node
/**
 * `scripts/ux/probes/state-scan.mjs` —— 判据族 `S` / `X` 共用的**静态扫描**（只收证据，不判对错）。
 *
 * 口径的完整说明在 `scripts/ux/state-vocabulary.mjs` 的文件头；这里只负责把它执行出来：
 *
 *   - 只扫 `face.sources`（这个界面面自己的源文件），不扫全仓；
 *   - 先剥注释（`codeLinesOf`），所以「JSDoc 里写了三态齐全」不算有态；
 *   - 一个状态算「在场」的条件 = **同一个源文件里**既有分支证据、又有一句人话说明
 *     （分支在 A、话在 B 不算：那说明这个面是拼出来的，渲染到人眼前时没人敢担保）；
 *   - 每份证据都带 `file:line`，报告里能直接粘进编辑器核回源码。
 *
 * **本文件不许出现 pass / fail**：判定只在 `scripts/ux/assertions/` 与 `judge.mjs`。
 *
 * 已知的采集粒度（写在报告里让人自证，别当成没采）：
 *   - 共用同一份源文件的界面面（`sediment-views.tsx` 被 3 个面共用、`bestof*.tsx` 被 4 个面共用）
 *     会拿到**同一份**状态证据。要按组件切分需要 AST，本票不做；这条写进 `facts.sourceFiles`，
 *     报告里能一眼看出「这几个面是同一份文件判出来的」。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import {
  ACTIONABLE_STEP,
  ACTIONABLE_WINDOW,
  BANNED_WORDING,
  CANONICAL_WORDING,
  CONTROL_OPERATOR,
  CRITERION_STATE,
  EMPTINESS_TEST,
  LOADING_VISUAL,
  MARKER_STATE,
  STATE_ALIASES,
  STATE_HINT,
  STATE_MARKER_ATTRIBUTE,
  STATES,
  aliasPattern,
  codeLinesOf,
} from '../state-vocabulary.mjs'

/** 每类证据最多留几条（计数另给，报告不该被一屏正则命中刷爆）。 */
const MAX_SAMPLES = 6

/** 一行代码压到 120 字（报告里读得下，也足够认出是哪句）。 */
function clip(code, limit = 120) {
  return code.length <= limit ? code : `${code.slice(0, limit)}…`
}

/** 这个状态在本行有**分支证据**吗：标识符出现在条件里，或显式状态标记属性点名了它。 */
function isStateBranch(code, state) {
  for (const alias of STATE_ALIASES[state]) {
    // 标识符必须用在条件/守卫里：`{loading && …}` / `kind === 'error' ? …` / `if (error)`。
    // 只是取值（`error={state.error}`、`failed: '失败'`）不算分支。
    if (aliasPattern(alias).test(code) && CONTROL_OPERATOR.test(code)) return true
  }
  // 判空分支不需要叫 `empty`：`!entries.length && …`、`list.length === 0 ? …` 都是空态分支。
  if (state === 'empty' && EMPTINESS_TEST.test(code)) return true
  for (const match of code.matchAll(STATE_MARKER_ATTRIBUTE)) {
    const name = match[1]
    const value = match[2]
    if (value === state || value.endsWith(`-${state}`)) return true
    // `city-pending` / `mounts-loading`：标记值说的是「进行中」，归加载态。
    if (state === 'loading' && value.endsWith('-pending')) return true
    // 不叫状态名、但确实在说这个状态的标记值（白名单见 state-vocabulary 的 MARKER_STATE）。
    if ((MARKER_STATE[state] ?? []).includes(value)) return true
    // 属性名自己就在说状态：`data-xuanshu-empty="tombstones"`、`data-xuanshu-history-empty="true"`
    // （值是个业务名，状态写在属性名里 —— 这种写法在事记 / 触达两屏里都在用）。
    if (name === state || name.endsWith(`-${state}`) || name.includes(`-${state}-`)) return true
  }
  return false
}

/** 采样：只留前 `MAX_SAMPLES` 条，但 `count` 如实记。 */
function sampled(hits) {
  return {
    count: hits.length,
    samples: hits.slice(0, MAX_SAMPLES),
    files: [...new Set(hits.map((hit) => hit.file))],
  }
}

/**
 * 扫一个界面面：三态的分支 / 人话 / 文案。
 *
 * @param {{id: string, sources: string[]}} face
 * @param {(path: string) => {path: string, text: string, lines: string[]}} read 只读文件缓存（`collect/source-cache.mjs`）
 * @returns {{
 *   faceId: string,
 *   sourceFiles: string[],
 *   scannedFiles: number,
 *   anchor: {file: string, line: number},
 *   states: Record<string, {
 *     branch: {count: number, samples: object[], files: string[]},
 *     hint: {count: number, samples: object[], files: string[]},
 *     visual: {count: number, samples: object[], files: string[]},
 *     filesWithBoth: string[],
 *   }>,
 *   wording: Record<string, {
 *     canonical: {count: number, samples: object[], files: string[]},
 *     banned: {count: number, samples: object[], files: string[]},
 *   }>,
 *   errorActionable: {count: number, samples: object[], files: string[]},
 * }}
 */
export function scanFace(face, read) {
  const files = face.sources.map((path) => ({ path, code: codeLinesOf(read(path)) }))
  const states = {}
  const wording = {}
  /** 全量命中（采样只用于 facts；判「邻近动作」必须用全量，否则会把排在第 7 条之后的错误行判没）。 */
  const allHits = {}

  for (const state of STATES) {
    const branchHits = []
    const hintHits = []
    const skeletonHits = []
    const canonicalHits = []
    const bannedHits = []

    for (const file of files) {
      for (const { line, code } of file.code) {
        if (isStateBranch(code, state)) branchHits.push({ file: file.path, line, text: clip(code) })
        if (STATE_HINT[state].test(code)) hintHits.push({ file: file.path, line, text: clip(code) })
        // 加载态允许「不说话」：骨架屏是视觉证据（D2），不是文字证据。
        if (state === 'loading' && LOADING_VISUAL.test(code)) skeletonHits.push({ file: file.path, line, text: clip(code) })
        for (const pattern of CANONICAL_WORDING[state]) {
          const match = code.match(pattern)
          if (match !== null) canonicalHits.push({ file: file.path, line, text: clip(code), token: match[0] })
        }
        for (const word of BANNED_WORDING[state]) {
          if (code.includes(word)) bannedHits.push({ file: file.path, line, text: clip(code), token: word })
        }
      }
    }

    const visualHits = hintHits.concat(skeletonHits)
    const branchFiles = new Set(branchHits.map((hit) => hit.file))
    const visualFiles = new Set(visualHits.map((hit) => hit.file))
    const filesWithBoth = [...branchFiles].filter((file) => visualFiles.has(file))

    states[state] = {
      branch: sampled(branchHits),
      hint: sampled(hintHits),
      visual: sampled(visualHits),
      filesWithBoth,
    }
    wording[state] = { canonical: sampled(canonicalHits), banned: sampled(bannedHits) }
    allHits[state] = { branchHits, hintHits, skeletonHits }
  }

  // 「错误行旁边有没有可执行下一步」：只看离**任何一条**错误行 ±ACTIONABLE_WINDOW 行以内的动作词，
  // 远了就说明那是别处的按钮，不是这条错误的出路。锚点用**全量**命中，不用采样
  // （采样只前 6 条：`wansheng.tsx` 的错误行排到第 7 位之后，拿采样当锚点会把出路判没）。
  const errorLines = [...allHits.error.branchHits, ...allHits.error.hintHits]
  const actionableHits = []
  for (const file of files) {
    for (const { line, code } of file.code) {
      if (!ACTIONABLE_STEP.test(code)) continue
      const near = errorLines.some((anchor) => anchor.file === file.path && Math.abs(anchor.line - line) <= ACTIONABLE_WINDOW)
      if (near) actionableHits.push({ file: file.path, line, text: clip(code) })
    }
  }

  // 「这个面的组件入口行」：缺席的证据要落在这里，人才能一键跳到组件定义。
  let anchor = { file: face.sources[0] ?? '(没有登记源文件)', line: 1 }
  const exported = /^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|interface)\s+[A-Za-z_$]/
  for (const file of files) {
    const hit = file.code.find(({ code }) => exported.test(code))
    if (hit !== undefined) {
      anchor = { file: file.path, line: hit.line }
      break
    }
  }

  return {
    faceId: face.id,
    sourceFiles: [...face.sources],
    scannedFiles: files.length,
    anchor,
    states,
    wording,
    errorActionable: sampled(actionableHits),
  }
}

/**
 * 判据 id → 该判据要的那个状态（`S-001` → `empty`）。
 * 不是本族的 id 直接报错：这条采集器只服务 S / X，混进来等于分母算错。
 * @param {string} criterionId
 * @returns {string}
 */
export function stateForCriterion(criterionId) {
  const state = CRITERION_STATE[criterionId]
  if (state === undefined) throw new Error(`state-scan: 判据「${criterionId}」不属于三态族 S（S-001..003）`)
  return state
}
