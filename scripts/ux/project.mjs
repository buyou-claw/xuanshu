#!/usr/bin/env node
/**
 * `scripts/ux/project.mjs` —— **判据投影器**（spec 003 · 模块 1）。
 *
 * 它只做一件事：把 `docs/design/ui-v1/criteria/rules/<族>.json`（人写的五列原文）读成一份
 * **确定性的**机读判据集，算出它的 `version`（sha256）。判定逻辑一个字都不在这里——
 * 「这条算不算过」只在 `scripts/ux/judge.mjs`。
 *
 * 为什么必须确定性（同一输入两跑字节相同）：
 *   冻结值是判据集的 sha256。只要投影有一点不确定性（键序、时间、路径），冻结就永远对不上，
 *   而一个「永远对不上」的冻结守卫会被绕过 —— 那等于没有守卫。
 *
 * 硬门槛（投影期直接报错，不允许静默降级）：
 *   1. 五列缺一列 → 报错；
 *   2. `human-only` 没写「机器判不了的原因」→ 报错（spec 003 §8）；
 *   3. 判据的 `source.anchor` 在设计稿里找不到 → 报错（判据不许自造规则）。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 投影产物的 schema 名；改结构必须同时改它（报告器按它判断自己读得懂哪版）。 */
export const CRITERIA_SCHEMA = 'xuanshu/ux-criteria@1'

/** 判据集所在目录（设计稿的机读投影，ADR-0015 第 1 条）。 */
export const CRITERIA_DIR = 'docs/design/ui-v1/criteria'
export const CRITERIA_RULES_DIR = `${CRITERIA_DIR}/rules`
export const CRITERIA_FILE = `${CRITERIA_DIR}/criteria.json`

/** 族的固定顺序（不是字典序：报告按这个顺序分组，改顺序等于改报告结构）。 */
export const FAMILY_ORDER = ['T', 'S', 'L', 'D', 'C', 'N', 'X']

/** 检查方式的闭集。`human-only` 必须带理由，其余两种必须有检查器。 */
export const CHECKS = ['static', 'browser', 'human-only']

/** 严重级闭集（只影响排序，不影响通过与否）。 */
export const SEVERITIES = ['blocker', 'major', 'minor']

/** 证据形态闭集：报告里每条红要指得回这里。 */
export const EVIDENCE_KINDS = ['file-line', 'computed-style', 'screenshot', 'transcript']

/** 投影期的可读失败（调用方按它退 2，不当成断言红）。 */
export class CriteriaError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CriteriaError'
  }
}

/** 读文本并归一到 LF（CRLF 会让锚点比较在 Windows 上假红）。 */
export function readNormalizedText(absolutePath) {
  return readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n')
}

/** 确定性序列化：2 空格缩进、LF 结尾。对象键序由构造处决定，这里不排序。 */
export function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** sha256（utf8）。 */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * 判据集版本 = 「除 version 之外的全部内容」的 sha256。
 *
 * 为什么不把 `version` 本身算进去：文件里写着 version，哈希不能包含要算的东西。
 * 于是 version 可以由文件**自证**：任何人拿 criteria.json 的其余字段重算一遍就能核对，
 * 不需要相信投影器（冻结守卫就是靠这条做校验的）。
 *
 * @param {{schema: string, label: string, families: unknown[], criteria: unknown[]}} body
 * @returns {string} 64 位小写 hex
 */
export function versionOfBody(body) {
  return sha256(
    serialize({
      schema: body.schema,
      label: body.label,
      families: body.families,
      criteria: body.criteria,
    }),
  )
}

/** 把锚点切成可用于 needle 查找的片段（原文里换行/空格的排版差异不该让锚失效）。 */
function anchorProbe(anchor) {
  return anchor.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim()
}

/** 设计稿里找锚：先按原文找，再按「去标记 + 空白归一」找（两种都找不到才算失败）。 */
export function anchorExistsIn(text, anchor) {
  const normalized = text.replace(/\r\n/g, '\n')
  if (normalized.includes(anchor)) return true
  const flattened = normalized.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ')
  return flattened.includes(anchorProbe(anchor))
}

function requireString(value, what) {
  if (typeof value !== 'string' || value.trim() === '') throw new CriteriaError(`${what} 必须是非空字符串`)
  return value
}

/**
 * 校验并归一一条判据。
 * @returns 归一后的判据对象（键序固定：id / family / statement / check / evidence / severity / appliesTo / source / humanReason / tombstone）
 */
function normalizeRule(rule, { familyFile, family, repoRoot, faceIds }) {
  const where = `${familyFile} · ${rule?.id ?? '(无 id)'}`
  const id = requireString(rule?.id, `${where}: id`)
  if (!/^[A-Z]-\d{3}$/.test(id)) throw new CriteriaError(`${where}: id 必须是「族前缀-三位数字」（如 T-004）`)
  if (!id.startsWith(`${family}-`)) throw new CriteriaError(`${where}: id 前缀与所在文件族不一致（文件是 ${family}）`)

  const statement = requireString(rule?.statement, `${where}: statement（判据）`)
  const check = requireString(rule?.check, `${where}: check（检查方式）`)
  if (!CHECKS.includes(check)) throw new CriteriaError(`${where}: check 只能是 ${CHECKS.join(' / ')}，收到「${check}」`)
  const evidence = requireString(rule?.evidence, `${where}: evidence（证据形态）`)
  if (!EVIDENCE_KINDS.includes(evidence)) {
    throw new CriteriaError(`${where}: evidence 只能是 ${EVIDENCE_KINDS.join(' / ')}，收到「${evidence}」`)
  }
  const severity = requireString(rule?.severity, `${where}: severity（严重级）`)
  if (!SEVERITIES.includes(severity)) throw new CriteriaError(`${where}: severity 只能是 ${SEVERITIES.join(' / ')}`)

  // 硬门槛：human-only 必须写「为什么机器判不了」。
  const humanReason = rule?.humanReason
  if (check === 'human-only') {
    if (typeof humanReason !== 'string' || humanReason.trim() === '') {
      throw new CriteriaError(
        `${where}: check=human-only 必须在 humanReason 写清「机器判不了的原因」（spec 003 §判据硬门槛 8；不允许把没人验伪装成人来验）`,
      )
    }
  } else if (humanReason !== undefined && humanReason !== null) {
    throw new CriteriaError(`${where}: 只有 human-only 才写 humanReason（否则等于给机器判据留退路）`)
  }

  const appliesTo = rule?.appliesTo ?? { kind: 'all' }
  if (appliesTo === null || typeof appliesTo !== 'object') throw new CriteriaError(`${where}: appliesTo 必须是对象`)
  if (!['all', 'panel', 'parasitic', 'ids'].includes(appliesTo.kind)) {
    throw new CriteriaError(`${where}: appliesTo.kind 只能是 all / panel / parasitic / ids`)
  }
  if (appliesTo.kind === 'ids') {
    if (!Array.isArray(appliesTo.ids) || appliesTo.ids.length === 0) {
      throw new CriteriaError(`${where}: appliesTo.kind=ids 必须给非空 ids`)
    }
    for (const faceId of appliesTo.ids) {
      if (!faceIds.has(faceId)) throw new CriteriaError(`${where}: appliesTo.ids 里的「${faceId}」不是已知界面面`)
    }
  }

  const source = rule?.source
  if (source === null || typeof source !== 'object') throw new CriteriaError(`${where}: source 必须给 {file, anchor}`)
  const sourceFile = requireString(source.file, `${where}: source.file`)
  const sourceAnchor = requireString(source.anchor, `${where}: source.anchor`)
  const absolute = join(repoRoot, sourceFile)
  if (!existsSync(absolute)) throw new CriteriaError(`${where}: source.file 不存在：${sourceFile}`)
  if (!anchorExistsIn(readNormalizedText(absolute), sourceAnchor)) {
    throw new CriteriaError(`${where}: source.anchor 在 ${sourceFile} 里找不到——判据不许自造规则，先回改设计稿`)
  }

  const tombstone = rule?.tombstone === true
  return {
    id,
    family,
    statement,
    check,
    evidence,
    severity,
    appliesTo:
      appliesTo.kind === 'ids'
        ? { kind: 'ids', ids: [...appliesTo.ids].sort() }
        : { kind: appliesTo.kind },
    source: { file: sourceFile, anchor: sourceAnchor },
    humanReason: check === 'human-only' ? humanReason : null,
    tombstone,
  }
}

/** 读一个族文件（族文件本身也要有 source 锚，否则「族」是自封的）。 */
function readFamilyFile(absoluteFile, relativeFile, { repoRoot, faceIds, seenIds }) {
  let parsed
  try {
    parsed = JSON.parse(readNormalizedText(absoluteFile))
  } catch (error) {
    throw new CriteriaError(`${relativeFile}: 不是合法 JSON（${error?.message ?? error}）`)
  }
  const family = requireString(parsed?.family, `${relativeFile}: family`)
  if (!FAMILY_ORDER.includes(family)) throw new CriteriaError(`${relativeFile}: 未知族「${family}」（族顺序见 FAMILY_ORDER）`)
  const title = requireString(parsed?.title, `${relativeFile}: title`)
  const familySource = parsed?.source
  if (familySource === null || typeof familySource !== 'object') {
    throw new CriteriaError(`${relativeFile}: source 必须给 {file, anchor}`)
  }
  const anchor = requireString(familySource.anchor, `${relativeFile}: source.anchor`)
  const file = requireString(familySource.file, `${relativeFile}: source.file`)
  if (!anchorExistsIn(readNormalizedText(join(repoRoot, file)), anchor)) {
    throw new CriteriaError(`${relativeFile}: 族的 source.anchor 在 ${file} 里找不到`)
  }
  if (!Array.isArray(parsed?.rules) || parsed.rules.length === 0) {
    throw new CriteriaError(`${relativeFile}: rules 必须是非空数组`)
  }
  const rules = parsed.rules.map((rule) => {
    const normalized = normalizeRule(rule, { familyFile: relativeFile, family, repoRoot, faceIds })
    if (seenIds.has(normalized.id)) throw new CriteriaError(`${relativeFile}: 判据 id 重复：${normalized.id}（id 稳定且永不复用）`)
    seenIds.add(normalized.id)
    return normalized
  })
  return {
    family: { id: family, title, source: { file, anchor }, ruleCount: rules.length },
    rules,
  }
}

/**
 * 投影判据集。
 *
 * @param {{repoRoot: string, faces: {id: string}[]}} input - `faces` 只用来校验 `appliesTo.ids`（界面面清单是唯一分母来源）。
 * @returns {{document: object, text: string, version: string}} 文档（含 version）、它的确定性文本、版本号
 * @throws {CriteriaError} 五列缺失 / human-only 无理由 / 锚点找不到 / id 重复
 */
export function projectCriteria({ repoRoot, faces }) {
  const rulesDir = join(repoRoot, CRITERIA_RULES_DIR)
  if (!existsSync(rulesDir)) throw new CriteriaError(`${CRITERIA_RULES_DIR} 不存在：判据原文是作者面，不能缺席`)

  const faceIds = new Set(faces.map((face) => face.id))
  const files = readdirSync(rulesDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
  if (files.length === 0) throw new CriteriaError(`${CRITERIA_RULES_DIR} 里没有任何族文件`)

  const seenIds = new Set()
  const families = []
  const criteria = []
  const ruleFiles = []
  const byFamily = new Map()
  for (const name of files) {
    const relativeFile = `${CRITERIA_RULES_DIR}/${name}`
    const read = readFamilyFile(join(rulesDir, name), relativeFile, { repoRoot, faceIds, seenIds })
    if (byFamily.has(read.family.id)) throw new CriteriaError(`族「${read.family.id}」有两个文件（一个族只能有一个作者面）`)
    byFamily.set(read.family.id, read)
    ruleFiles.push({ file: relativeFile, sha256: sha256(readNormalizedText(join(rulesDir, name))) })
  }

  // 族顺序固定：报告分组、判据排序都吃它，不按文件名排。
  for (const family of FAMILY_ORDER) {
    const read = byFamily.get(family)
    if (read === undefined) continue
    families.push(read.family)
    criteria.push(...read.rules)
  }

  const body = { schema: CRITERIA_SCHEMA, label: 'ux-v1', families, criteria }
  const version = versionOfBody(body)
  const document = { ...body, version, ruleFiles }
  return { document, text: serialize(document), version }
}

/**
 * 从已落盘的 `criteria.json` 重算版本（冻结守卫用它——**不相信文件里写的 version**）。
 * @param {string} text - criteria.json 的原文
 * @returns {{document: object, version: string}}
 */
export function reversionFromText(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new CriteriaError(`criteria.json 不是合法 JSON（${error?.message ?? error}）`)
  }
  if (parsed?.schema !== CRITERIA_SCHEMA) {
    throw new CriteriaError(`criteria.json 的 schema 是「${parsed?.schema}」，本工具只认「${CRITERIA_SCHEMA}」`)
  }
  return { document: parsed, version: versionOfBody(parsed) }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI：`node scripts/ux/project.mjs [--write] [--check] [--repo <dir>]`
//
// 投影产物（`criteria.json`）只由这条命令写：巡检器只**读**它，所以「顺手把判据重投影一下」
// 不会藏在一次体检里发生。这一步是人的动作（重新投影 → 重新冻结 → 签字，见 criteria/README.md §4）。
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { writeFileSync } = await import('node:fs')
  const { dirname, resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { faceManifest } = await import('../../tests/assembly/lib/panel-surface.mjs')
  const argv = process.argv.slice(2)
  const write = argv.includes('--write')
  const check = argv.includes('--check')
  const repoFlag = argv.indexOf('--repo')
  const repoRoot = repoFlag === -1 ? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..') : resolve(argv[repoFlag + 1])
  try {
    const { document, text, version } = projectCriteria({ repoRoot, faces: faceManifest() })
    const absolute = resolve(repoRoot, CRITERIA_FILE)
    if (write) {
      writeFileSync(absolute, text)
      console.log(`[ux:project] 已写 ${CRITERIA_FILE}（version ${version}）`)
      return 0
    }
    const existing = existsSync(absolute) ? readNormalizedText(absolute) : null
    if (check) {
      if (existing !== text) {
        console.error(`[ux:project] ${CRITERIA_FILE} 与 rules/ 不一致：跑 node scripts/ux/project.mjs --write`)
        return 1
      }
      console.log(`[ux:project] 一致（version ${version}）`)
      return 0
    }
    console.log(`[ux:project] 投影完成：${document.criteria.length} 条判据 / version ${version}`)
    console.log('[ux:project] 只投影不落盘；要落盘加 --write')
    return 0
  } catch (error) {
    if (error instanceof CriteriaError) {
      console.error(`[ux:project] 投影失败：${error.message}`)
      return 2
    }
    throw error
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}
