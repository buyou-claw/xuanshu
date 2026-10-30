#!/usr/bin/env node
/**
 * `scripts/ux/probes/t.mjs` —— 判据族 T（token 消费）的**证据采集**。
 *
 * 这里只收证据，不判对错：判「算不算过」的地方只有 `scripts/ux/judge.mjs` 与
 * `scripts/ux/assertions/t.mjs`。采到 9 处还是 11 处，是事实；它意味着通过还是失败，是判定。
 *
 * 采集口径（写清，免得下次有人以为这是漏采）：
 *   - 只扫**这个界面面自己的源文件**（`faceManifest()` 里登记的 `sources`），不扫全仓；
 *   - 跳过整行注释（`//` / `*` / `/*` 起始），但**不跳过行尾注释**——注释里留一个色值
 *     一样会被复制出去，宁可让人来关掉它；
 *   - 匹配 hex（`#rgb` / `#rrggbb` / `#rrggbbaa`）与 `rgb()` / `rgba()` / `hsl()` / `hsla()`。
 *
 * 仅使用 Node 内置模块。ESM。
 */

/** 字面色值的形态：hex 或颜色函数。`\b` 收尾避免把 `#333abc` 截成 `#333`。 */
const LITERAL_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g

/** 整行注释：这些行里的色值不算「样式里写了字面色值」（但换成行尾注释就会算）。 */
const WHOLE_LINE_COMMENT = /^\s*(?:\/\/|\/\*|\*)/

/**
 * T-001：界面源码的样式里出现了字面色值。
 * @param {{face: {id: string, sources: string[]}, read: (path: string) => {lines: string[]}}} ctx
 * @returns {{facts: {occurrences: {file: string, line: number, literal: string}[], scannedFiles: number}, evidence: {file: string, line: number, detail: string}[]}}
 */
export function probeNoLiteralColor({ face, read }) {
  const occurrences = []
  let scannedFiles = 0
  for (const source of face.sources) {
    const file = read(source)
    scannedFiles += 1
    for (let index = 0; index < file.lines.length; index += 1) {
      const line = file.lines[index]
      if (WHOLE_LINE_COMMENT.test(line)) continue
      for (const match of line.matchAll(LITERAL_COLOR)) {
        occurrences.push({ file: source, line: index + 1, literal: match[0] })
      }
    }
  }
  return {
    facts: { occurrences, scannedFiles },
    evidence: occurrences.map((occurrence) => ({
      file: occurrence.file,
      line: occurrence.line,
      detail: `字面色值 ${occurrence.literal}`,
    })),
  }
}

/** 族 T 的检查器表：键 = 判据 id（与 `rules/T.json` 一一对应，缺一条采集器会直接报错）。 */
export const T_PROBES = {
  'T-001': probeNoLiteralColor,
}
