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
 *   - T-001 匹配 hex（`#rgb` / `#rrggbb` / `#rrggbbaa`）与 `rgb()` / `rgba()` / `hsl()` / `hsla()`。
 *
 * 族 T 的第二批（票 04 / #51）三条判据的采集口径：
 *   - T-002「注入点」：找 `document.createElement('style')`——一个注入点一行，符号取**最近的
 *     外层函数名**（`install*Style` / `installPuPanel` 这类），共享度 = 有多少个界面面的 `sources`
 *     列了同一份文件。`facts.repo.points` 是**跨面去重后的全量清单**（按共享度降序），
 *     采集器不排「违规榜」，只保证同一批输入两跑同序（报告才能 diff）。
 *   - T-003「断点」：找 `@media` 里的 `min-width` / `max-width` 特征值，字面 px 就是字面 px，
 *     不管它是不是恰好等于 token 的值——媒体查询吃不了 `var()` 这件事是**实现约束**，不是豁免。
 *     `prefers-reduced-motion` 这类没有宽度特征的媒体查询不在这里计数（它不是断点）。
 *   - T-004「颜色声明」：正则解析 CSS-in-JS 的声明文本（`color` / `background` / `border*` /
 *     `box-shadow`），值里出现 `var(--` 记 token；否则是允许的关键字（transparent / inherit /
 *     none / currentColor）记 keyword；都不是记 literal。`border: 0` / `border-bottom: 0`
 *     这类只有宽度、没有颜色成分的声明记 non-color——它不主张颜色，不该被颜色判据点名。
 *     同一份 facts 里带 `--dsw-alias-*` 的消费点清单（票 04 要「全仓仅 N 处」这个事实有数据支撑）。
 *
 * 仅使用 Node 内置模块。ESM。
 */

/** 字面色值的形态：hex 或颜色函数。`\b` 收尾避免把 `#333abc` 截成 `#333`。 */
const LITERAL_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g

/** 整行注释：这些行里的色值不算「样式里写了字面色值」（但换成行尾注释就会算）。 */
const WHOLE_LINE_COMMENT = /^\s*(?:\/\/|\/\*|\*)/

/** 一个 `<style>` 注入点：`document.createElement('style')`（单双引号都算）。 */
const STYLE_CREATE = /document\.createElement\(\s*['"]style['"]\s*\)/

/** 媒体查询起点；宽度特征从 `(min-width: …)` / `(max-width: …)` 里取（本仓样式都是单行字符串，够用）。 */
const MEDIA_AT = /@media\b/
const MEDIA_WIDTH = /\(\s*(min|max)-width\s*:\s*([^()]*?)\s*\)/g

/** 颜色声明：`color` / `background(-color)` / `border` / `border-<side>` / `border-color` / `box-shadow`。 */
const DECLARATION = /\b(background(?:-color)?|color|border(?:-(?:top|right|bottom|left))?(?:-color)?|box-shadow)\s*:\s*([^;}]+)/g

/** 边框声明里**不是颜色**的成分：宽度与样式。剥掉它们，剩下的是什么就是什么。 */
const BORDER_WIDTH = /^(?:\d*\.?\d+(?:px|rem|em|%|vh|vw)?|0)$/
const BORDER_STYLE = /^(?:solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|none)$/

/** 允许的关键字（与 `rules/T.json` 的 T-004 判据同一份口径）。 */
const ALLOWED_KEYWORDS = new Set(['transparent', 'inherit', 'none', 'currentcolor'])

/** `--dsw-alias-*` 的消费点（`var(--dsw-alias-…)`）。 */
const ALIAS_CONSUME = /var\(\s*(--dsw-alias-[a-z0-9-]+)/g

/** 断点语义权威（机读取值从 token 字典读；名字写在这里是为了报告能点名）。 */
const BREAKPOINT_TOKEN = '--xs-size-breakpoint-wide'
const TOKEN_DICTIONARY = 'docs/design/ui-v1/assets/tokens/xs-tokens.json'

/** 行号从 1 开始（与报告里的 `file:line` 一致）。 */
function lineNumber(index) {
  return index + 1
}

/** 最近的函数/常量名：注入点得说清「是谁在注入」，否则报告只能指到一行。 */
function symbolAt(lines, index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const line = lines[cursor]
    const declared = line.match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/)
    if (declared !== null) return declared[1]
    const assigned = line.match(/(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/)
    if (assigned !== null) return assigned[1]
  }
  return '(module)'
}

/** 有多少个界面面把同一份文件列进了 `sources`（= 这个注入点被多少个面共享）。 */
function sharedFacesOf(faces, file) {
  return (faces ?? [])
    .filter((candidate) => Array.isArray(candidate.sources) && candidate.sources.includes(file))
    .map((candidate) => candidate.id)
}

/**
 * 扫一批文件里的 `<style>` 注入点（按 file:line 去重）。
 * @returns {{file: string, line: number, symbol: string, sharedBy: number, faces: string[]}[]}
 */
function injectionPointsOf({ files, read, faces }) {
  const points = []
  const seen = new Set()
  for (const file of files) {
    const source = read(file)
    for (let index = 0; index < source.lines.length; index += 1) {
      const line = source.lines[index]
      if (WHOLE_LINE_COMMENT.test(line)) continue
      if (!STYLE_CREATE.test(line)) continue
      const key = `${file}\u0000${index}`
      if (seen.has(key)) continue
      seen.add(key)
      const shared = sharedFacesOf(faces, file)
      points.push({ file, line: lineNumber(index), symbol: symbolAt(source.lines, index), sharedBy: shared.length, faces: shared })
    }
  }
  return points
}

/** 注入点的稳定顺序：共享度降序 → 文件 → 行（同一批输入两跑同序）。 */
function byRepetition(left, right) {
  return right.sharedBy - left.sharedBy || left.file.localeCompare(right.file) || left.line - right.line
}

/** 全部界面面登记过的源文件（去重后排序：事实的枚举顺序不该取决于 manifest 的排列）。 */
function allSourceFiles(faces) {
  return [...new Set((faces ?? []).flatMap((candidate) => (Array.isArray(candidate.sources) ? candidate.sources : [])))].sort()
}

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

/**
 * T-002：这个界面面的源文件里有没有自己注入的 `<style>`。
 *
 * `facts.injections` 只列**本面**的注入点（判定按面算）；`facts.repo` 是为了让报告与验收能
 * 「按重复度排出全部注入点」——它是跨面去重后的全量清单，不是另一个分母。
 *
 * @param {{face: {id: string, sources: string[]}, read: Function, faces?: {id: string, sources?: string[]}[]}} ctx
 */
export function probeStyleInjectionPoints({ face, read, faces }) {
  const allFaces = faces ?? []
  const own = injectionPointsOf({ files: face.sources, read, faces: allFaces })
  const points = injectionPointsOf({ files: allSourceFiles(allFaces), read, faces: allFaces }).sort(byRepetition)
  return {
    facts: {
      injections: [...own].sort(byRepetition),
      repo: { faces: allFaces.length, total: points.length, files: new Set(points.map((point) => point.file)).size, points },
      scannedFiles: face.sources.length,
    },
    evidence: own.map((point) => ({
      file: point.file,
      line: point.line,
      detail: `样式注入点 ${point.symbol}（${point.sharedBy} 个界面面共享这份文件）`,
    })),
  }
}

/** 读 token 字典里断点的机读取值（读不到就给 null，事实里如实写，不编一个数字）。 */
function breakpointTokenOf(read) {
  try {
    const dictionary = JSON.parse(read(TOKEN_DICTIONARY).text)
    const entry = dictionary?.tokens?.[BREAKPOINT_TOKEN]
    return { name: BREAKPOINT_TOKEN, value: typeof entry?.light === 'string' ? entry.light : null }
  } catch {
    return null
  }
}

/**
 * 扫一批文件里带宽度特征的 `@media`（`min-width` / `max-width`）。
 * @returns {{file: string, line: number, feature: string, value: string}[]}
 */
function breakpointsOf({ files, read }) {
  const breakpoints = []
  for (const file of files) {
    const source = read(file)
    for (let index = 0; index < source.lines.length; index += 1) {
      const line = source.lines[index]
      if (WHOLE_LINE_COMMENT.test(line)) continue
      if (!MEDIA_AT.test(line)) continue
      for (const match of line.matchAll(MEDIA_WIDTH)) {
        breakpoints.push({ file, line: lineNumber(index), feature: `${match[1]}-width`, value: match[2].trim() })
      }
    }
  }
  return breakpoints
}

/**
 * T-003：这个界面面的样式里有没有把断点写成字面 px。
 *
 * 媒体查询吃不了 `var()`，所以「恰好等于 token 值」不构成豁免——判据问的是
 * 「断点有没有一个语义权威」，字面 `1100px` 和字面 `700px` 都是各写各的。
 *
 * @param {{face: {id: string, sources: string[]}, read: Function, faces?: object[]}} ctx
 */
export function probeLiteralBreakpoint({ face, read, faces }) {
  const allFaces = faces ?? []
  const own = breakpointsOf({ files: face.sources, read })
  const all = breakpointsOf({ files: allSourceFiles(allFaces), read })
  const byValue = [...new Set(all.map((breakpoint) => breakpoint.value))].sort().map((value) => ({
    value,
    count: all.filter((breakpoint) => breakpoint.value === value).length,
  }))
  return {
    facts: {
      token: breakpointTokenOf(read),
      breakpoints: own,
      repo: { total: all.length, byValue, files: new Set(all.map((breakpoint) => breakpoint.file)).size },
      scannedFiles: face.sources.length,
    },
    evidence: own.map((breakpoint) => ({
      file: breakpoint.file,
      line: breakpoint.line,
      detail: `断点写字面值 ${breakpoint.value}（${breakpoint.feature}）`,
    })),
  }
}

/** `border*` 声明里剥掉宽度与样式后剩下的部分（空 = 这条声明不主张颜色）。 */
function borderColorPart(value) {
  return value
    .split(/\s+/)
    .filter((part) => part !== '' && !BORDER_WIDTH.test(part) && !BORDER_STYLE.test(part))
    .join(' ')
    .trim()
}

/** 一条颜色声明的归类：token / keyword / literal / non-color。 */
function declarationKind(property, value) {
  const trimmed = value.trim()
  if (trimmed.includes('var(--')) return 'token'
  const isBorderShorthand = property.startsWith('border') && property !== 'border-color' && !/^border-(?:top|right|bottom|left)-color$/.test(property)
  if (isBorderShorthand) {
    const rest = borderColorPart(trimmed)
    if (rest === '') return 'non-color'
    return ALLOWED_KEYWORDS.has(rest.toLowerCase()) ? 'keyword' : 'literal'
  }
  return ALLOWED_KEYWORDS.has(trimmed.toLowerCase()) ? 'keyword' : 'literal'
}

/**
 * 扫一批文件的颜色声明。
 * @returns {{file: string, line: number, property: string, value: string, kind: string}[]}
 */
function declarationsOf({ files, read }) {
  const declarations = []
  for (const file of files) {
    const source = read(file)
    for (let index = 0; index < source.lines.length; index += 1) {
      const line = source.lines[index]
      if (WHOLE_LINE_COMMENT.test(line)) continue
      for (const match of line.matchAll(DECLARATION)) {
        declarations.push({ file, line: lineNumber(index), property: match[1], value: match[2].trim(), kind: declarationKind(match[1], match[2]) })
      }
    }
  }
  return declarations
}

/** `--dsw-alias-*` 的消费点清单（票 04 要点名的「全仓仅 N 处」靠这份事实支撑）。 */
function aliasConsumptionOf({ files, read }) {
  const sites = []
  const unreadable = []
  for (const file of files) {
    let source
    try {
      source = read(file)
    } catch {
      // 读不到的文件如实记下来：这份清单只服务「全仓几处」这个事实，不该让本面的证据跟着炸掉。
      unreadable.push(file)
      continue
    }
    for (let index = 0; index < source.lines.length; index += 1) {
      const line = source.lines[index]
      if (WHOLE_LINE_COMMENT.test(line)) continue
      for (const match of line.matchAll(ALIAS_CONSUME)) sites.push({ file, line: lineNumber(index), name: match[1] })
    }
  }
  const filesWithSites = [...new Set(sites.map((site) => site.file))].sort()
  const tokens = [...new Set(sites.map((site) => site.name))].sort().map((name) => ({
    name,
    sites: sites.filter((site) => site.name === name).length,
  }))
  return {
    sites: sites.length,
    byFile: filesWithSites.map((file) => ({ file, sites: sites.filter((site) => site.file === file).length })),
    tokens,
    unreadable,
  }
}

/**
 * T-004：这个界面面的颜色声明有没有一律从 token 取。
 *
 * `facts.declarations` 只列**本面**没从 token 取的声明（判定按面算）；
 * `facts.alias` 是跨面的 `--dsw-alias-*` 消费事实（报告要点名它，不让那句话没有数据支撑）。
 *
 * @param {{face: {id: string, sources: string[]}, read: Function, faces?: object[]}} ctx
 */
export function probeColorTokenOnly({ face, read, faces }) {
  const allFaces = faces ?? []
  const own = declarationsOf({ files: face.sources, read })
  const summary = { total: own.length, token: 0, keyword: 0, literal: 0, nonColor: 0 }
  for (const declaration of own) {
    if (declaration.kind === 'token') summary.token += 1
    else if (declaration.kind === 'keyword') summary.keyword += 1
    else if (declaration.kind === 'literal') summary.literal += 1
    else summary.nonColor += 1
  }
  const allFiles = allSourceFiles(allFaces)
  const all = declarationsOf({ files: allFiles, read })
  const literals = own.filter((declaration) => declaration.kind === 'literal')
  return {
    facts: {
      declarations: literals,
      summary,
      repo: { declarations: all.length, literal: all.filter((declaration) => declaration.kind === 'literal').length },
      alias: aliasConsumptionOf({ files: allFiles, read }),
      scannedFiles: face.sources.length,
    },
    evidence: literals.map((declaration) => ({
      file: declaration.file,
      line: declaration.line,
      detail: `颜色声明没从 token 取：${declaration.property}: ${declaration.value}`,
    })),
  }
}

/** 族 T 的检查器表：键 = 判据 id（与 `rules/T.json` 一一对应，缺一条采集器会直接报错）。 */
export const T_PROBES = {
  'T-001': probeNoLiteralColor,
  'T-002': probeStyleInjectionPoints,
  'T-003': probeLiteralBreakpoint,
  'T-004': probeColorTokenOnly,
}
