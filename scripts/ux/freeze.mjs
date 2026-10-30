#!/usr/bin/env node
/**
 * `scripts/ux/freeze.mjs` —— **判据冻结守卫**（spec 003 模块 2 · ADR-0015 第 6 条 · 票 03 / #50）。
 *
 * 它把「AI 不能改考卷」从纪律变成技术事实：
 *   - 冻结值 `docs/design/ui-v1/criteria/freeze.json` 记的不只是判据集的 `version`，
 *     还有**整份 criteria.json 的字节哈希**——`version` 只盖判据体（schema/label/families/criteria），
 *     盖不住 `ruleFiles`（族文件的 sha256）；只盖半份等于给人留一条「改族文件清单」的缝。
 *   - 守卫**不相信**文件里写的 `version`：拿 `reversionFromText()` 按全文重算，再做三方比对
 *     （重算值 / 文件自证值 / 冻结值）。信文件里那个字段，等于让改考卷的人自己报分数。
 *   - 不一致时**说清是哪一侧变了**（考卷侧 / 冻结值侧 / 冻结值缺失 / 冻结值坏了），
 *     因为「拒绝运行」只有在能指出下一步动作时才是可修复的；笼统报错会被人直接绕过。
 *
 * 为什么签字只有 `writeFreeze` 一条路：冻结值是撤销「AI 自证及格」的唯一凭证，
 * 它一旦能由自动化通道（巡检 / 修复循环）写，封印就等于不存在。所以 `--write` 是人的一击。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  CRITERIA_FILE,
  CriteriaError,
  readNormalizedText,
  reversionFromText,
  serialize,
  sha256,
} from './project.mjs'

/** 冻结值文件的 schema 名；改结构必须同时改它（读的一侧靠它判断自己读不读得懂）。 */
export const FREEZE_SCHEMA = 'xuanshu/ux-criteria-freeze@1'

/** 冻结值落点（与 `criteria.json` 同目录：冻结值和被冻结的东西待在一起，才好一眼对照）。 */
export const FREEZE_FILE = 'docs/design/ui-v1/criteria/freeze.json'

/** 拒绝里必须出现的那句话（spec 003 §判据 6 / #50 验收第 3 条：提示要说清「需人确认」）。 */
export const FROZEN_HINT = '判据已变更，需人确认'

/** 人跑的两条修复命令：拒绝提示里必须给得出（否则读提示的人只能猜）。 */
const PROJECT_WRITE = 'node scripts/ux/project.mjs --write'
const FREEZE_WRITE = 'node scripts/ux/freeze.mjs --write'

/**
 * 冻结失败的四类侧（报告/测试按它区分，不用去啃中文串）：
 *   - `missing-freeze`  冻结值不存在；
 *   - `freeze-malformed` 冻结值本身坏了（schema / 哈希 / 时刻不合规）；
 *   - `criteria-self`   criteria.json 自证失败（有人手改了投影产物，或调用方递了假 document）；
 *   - `drift-criteria`  判据集那一侧变了（重投影过，但没重新签字；或只动了 version 之外的字节）；
 *   - `drift-freeze`    冻结值那一侧被改（判据文件没动，只有 freeze.json 的 version 变了）；
 *   - `stale-version`   `writeFreeze` 被塞了一个与重算值不符的 version。
 */
export class CriteriaFrozenError extends Error {
  /**
   * @param {{side: string, message: string, criteriaVersion?: string|null, frozenVersion?: string|null}} input
   */
  constructor({ side, message, criteriaVersion = null, frozenVersion = null }) {
    super(message)
    this.name = 'CriteriaFrozenError'
    this.side = side
    this.criteriaVersion = criteriaVersion
    this.frozenVersion = frozenVersion
  }
}

/** CRLF 会让同一份判据集在两个平台算出两个哈希（Windows 上必踩），所以比字节前先归一。 */
function normalizeText(text) {
  return text.replace(/\r\n/g, '\n')
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/**
 * 读冻结值。
 *
 * @param {{repoRoot: string}} input
 * @returns {{schema: string, version: string, criteria: {file: string, sha256: string, criteriaCount: number, familyCount: number}, frozenAt: string, approvedBy: string, note: string|null}}
 * @throws {CriteriaFrozenError} 缺失 / 格式不合规
 */
export function readFreeze({ repoRoot }) {
  const absolute = join(repoRoot, FREEZE_FILE)
  if (!existsSync(absolute)) {
    throw new CriteriaFrozenError({
      side: 'missing-freeze',
      message:
        `${FROZEN_HINT}：冻结值不存在（${FREEZE_FILE}）——没有冻结值，巡检无法证明判据没被改过。` +
        `由人跑 ${FREEZE_WRITE} 签字一次（ADR-0015 第 7 条：签字点只有判据冻结与改动 PR 两处）。`,
    })
  }

  let parsed
  try {
    parsed = JSON.parse(readNormalizedText(absolute))
  } catch (error) {
    throw new CriteriaFrozenError({
      side: 'freeze-malformed',
      message: `${FROZEN_HINT}：冻结值 ${FREEZE_FILE} 不是合法 JSON（${error?.message ?? error}）。它只由 ${FREEZE_WRITE} 写，不要手改。`,
    })
  }

  const problems = []
  if (parsed?.schema !== FREEZE_SCHEMA) problems.push(`schema 应为「${FREEZE_SCHEMA}」，收到「${parsed?.schema}」`)
  if (!isSha256(parsed?.version)) problems.push('version 必须是 64 位小写 hex（判据集自己算出来的那个）')
  if (!isSha256(parsed?.criteria?.sha256)) problems.push('criteria.sha256 必须是 64 位小写 hex（覆盖 criteria.json 全文）')
  if (typeof parsed?.criteria?.file !== 'string' || parsed.criteria.file === '') problems.push('criteria.file 必须是相对路径')
  if (typeof parsed?.frozenAt !== 'string' || Number.isNaN(Date.parse(parsed.frozenAt))) {
    problems.push('frozenAt 必须是 ISO 时刻')
  }
  if (typeof parsed?.approvedBy !== 'string' || parsed.approvedBy === '') problems.push('approvedBy 必须写清是谁签的字')
  if (parsed?.note !== null && parsed?.note !== undefined && typeof parsed?.note !== 'string') {
    problems.push('note 只能是字符串或 null')
  }
  if (problems.length > 0) {
    throw new CriteriaFrozenError({
      side: 'freeze-malformed',
      criteriaVersion: isSha256(parsed?.version) ? parsed.version : null,
      message:
        `${FROZEN_HINT}：冻结值 ${FREEZE_FILE} 格式不对——${problems.join('；')}。` +
        `它只由 ${FREEZE_WRITE} 写，不要手改。`,
    })
  }

  return {
    schema: parsed.schema,
    version: parsed.version,
    criteria: {
      file: parsed.criteria.file,
      sha256: parsed.criteria.sha256,
      criteriaCount: parsed.criteria.criteriaCount,
      familyCount: parsed.criteria.familyCount,
    },
    frozenAt: parsed.frozenAt,
    approvedBy: parsed.approvedBy,
    note: parsed.note ?? null,
  }
}

/**
 * 巡检启动的第一件事：校验判据集哈希。
 *
 * 三方比对的顺序刻意是「自证 → 冻结」：先问「这份 criteria.json 是不是它自己宣称的那份」，
 * 再问「它是不是被冻结的那份」。反过来的话，手改投影产物会被报成「判据集变了」，
 * 看提示的人会去重签而不是去找谁动了投影产物——诊断方向就错了。
 *
 * @param {{repoRoot: string, criteriaText: string, document?: object}} input
 *   `document` 是可选的调用方已解析对象；它**不构成可信输入**（守卫照样重算并比它声明的 version）。
 * @returns {{version: string, criteria: {sha256: string, criteriaCount: number}, frozen: {version: string, frozenAt: string, approvedBy: string, note: string|null}}}
 * @throws {CriteriaFrozenError} 自证失败 / 冻结值缺失 / 冻结值坏了 / 判据集或冻结值被改
 */
export function guardCriteria({ repoRoot, criteriaText, document }) {
  if (typeof criteriaText !== 'string' || criteriaText.trim() === '') {
    throw new CriteriaFrozenError({
      side: 'criteria-self',
      message: `${FROZEN_HINT}：守卫没有拿到 criteria.json 的全文，无从重算版本（先跑 ${PROJECT_WRITE}）。`,
    })
  }

  const text = normalizeText(criteriaText)
  const { document: parsed, version: recomputed } = reversionFromText(text)
  const declaredDoc = document ?? parsed
  const declared = typeof declaredDoc?.version === 'string' ? declaredDoc.version : null

  if (declared !== recomputed) {
    throw new CriteriaFrozenError({
      side: 'criteria-self',
      criteriaVersion: recomputed,
      frozenVersion: declared,
      message:
        `${FROZEN_HINT}：criteria.json 自证失败——文件里写的 version 是 ${declared ?? '(缺)'}，按全文重算是 ${recomputed}。` +
        `它只由 ${PROJECT_WRITE} 生成，手改一个字节就会对不上；判据的变更权在人（ADR-0015 第 6 条），` +
        '自动化通道的写入面只有 docs/design/ui-v1/criteria/proposals/。',
    })
  }

  const freeze = readFreeze({ repoRoot })
  const actualSha = sha256(text)

  if (freeze.version !== recomputed) {
    // 分清「考卷变了」还是「冻结值被改」：冻结值里记着判据集全文的字节哈希，
    // 它和眼前的文件对得上，说明判据文件没动 —— 那就只有冻结值那一侧被动过。
    if (freeze.criteria.sha256 === actualSha) {
      throw new CriteriaFrozenError({
        side: 'drift-freeze',
        criteriaVersion: recomputed,
        frozenVersion: freeze.version,
        message:
          `${FROZEN_HINT}：冻结值那一侧被改了——${FREEZE_FILE} 里的 version 是 ${freeze.version}，` +
          `与判据集自己算出的 ${recomputed} 不符；而它记的判据集字节哈希与 criteria.json 全文一致，说明判据文件本身没动。` +
          `重新签字要由人跑 ${FREEZE_WRITE}（冻结值不在自动化通道的写入面内）。`,
      })
    }
    throw new CriteriaFrozenError({
      side: 'drift-criteria',
      criteriaVersion: recomputed,
      frozenVersion: freeze.version,
      message:
        `${FROZEN_HINT}：判据集那一侧变了——冻结值是 ${freeze.version}（${freeze.frozenAt} 冻结），现在按全文重算得到 ${recomputed}。` +
        '新判据只能先落 docs/design/ui-v1/criteria/proposals/，由人批准后搬进 rules/，' +
        `再依次跑 ${PROJECT_WRITE} 与 ${FREEZE_WRITE} 重新签字。`,
    })
  }

  if (freeze.criteria.sha256 !== actualSha) {
    // version 只盖判据体（schema/label/families/criteria）；冻结值要覆盖判据集**全文**，
    // 否则改 `ruleFiles` 这类 version 之外的字节就能悄悄换掉「判据集由哪些族文件组成」。
    throw new CriteriaFrozenError({
      side: 'drift-criteria',
      criteriaVersion: recomputed,
      frozenVersion: freeze.version,
      message:
        `${FROZEN_HINT}：判据集那一侧变了——version 自证仍然成立（${recomputed}），` +
        `但整份 criteria.json 的字节哈希与冻结值记的不一样（冻结值覆盖判据集全文，不只覆盖判据体）。` +
        `重投影后必须重新签字：${PROJECT_WRITE} → ${FREEZE_WRITE}。`,
    })
  }

  return {
    version: recomputed,
    criteria: { sha256: actualSha, criteriaCount: parsed.criteria.length },
    frozen: {
      version: freeze.version,
      frozenAt: freeze.frozenAt,
      approvedBy: freeze.approvedBy,
      note: freeze.note,
    },
  }
}

/**
 * 写冻结值 —— **人的签字那一击**（CLI 的 `--write`）。
 *
 * 冻结值一律从 criteria.json 现算：调用方就算递了 `version`，也只当「断言」用
 * （对不上就拒绝写），不当作落盘内容。理由同上——冻结值不能凭谁的口气写。
 *
 * @param {{repoRoot: string, version?: string, frozenAt?: string, note?: string|null, approvedBy?: string}} input
 * @returns {{file: string, version: string, freeze: object}}
 * @throws {CriteriaError} criteria.json 不存在（先投影）
 * @throws {CriteriaFrozenError} 传入的 version 与重算不一致（stale-version）
 */
export function writeFreeze({ repoRoot, version, frozenAt, note = null, approvedBy = 'human' }) {
  const absolute = join(repoRoot, CRITERIA_FILE)
  if (!existsSync(absolute)) {
    throw new CriteriaError(
      `判据投影产物不存在：${CRITERIA_FILE}。先跑 ${PROJECT_WRITE}，再冻结（没有投影产物就没有可冻结的东西）。`,
    )
  }

  const text = readNormalizedText(absolute)
  const { document: parsed, version: recomputed } = reversionFromText(text)
  if (version !== undefined && version !== null && version !== recomputed) {
    throw new CriteriaFrozenError({
      side: 'stale-version',
      criteriaVersion: recomputed,
      frozenVersion: String(version),
      message:
        `${FROZEN_HINT}：要冻结的 version 是 ${version}，但按 criteria.json 全文重算得到 ${recomputed}。` +
        `冻结值必须是判据集自己算出来的那个——先 ${PROJECT_WRITE} 重投影，再重跑 ${FREEZE_WRITE}。`,
    })
  }

  const freeze = {
    schema: FREEZE_SCHEMA,
    version: recomputed,
    criteria: {
      file: CRITERIA_FILE,
      sha256: sha256(text),
      criteriaCount: parsed.criteria.length,
      familyCount: parsed.families.length,
    },
    frozenAt: frozenAt ?? new Date().toISOString(),
    approvedBy,
    note: note ?? null,
  }
  writeFileSync(join(repoRoot, FREEZE_FILE), serialize(freeze))
  return { file: FREEZE_FILE, version: recomputed, freeze }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI：`node scripts/ux/freeze.mjs --check | --write [--note "…"] [--repo <dir>]`
//
// 退出码：0 = 一致（或刚写完）；3 = 判据被改 / 冻结值缺失或不完整，需人确认；2 = 用法或材料问题。
// 3 是刻意与 2 分开的：2 是「工具没跑成」，3 是「考卷被动过」——值班的人看到 3 才知道要去问人。
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { dirname, resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const argv = process.argv.slice(2)
  const repoFlag = argv.indexOf('--repo')
  const repoRoot =
    repoFlag === -1 ? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..') : resolve(argv[repoFlag + 1])

  const readFlagValue = (name) => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('用法：node scripts/ux/freeze.mjs <--check | --write> [--note "…"] [--approved-by human] [--repo <dir>]')
    console.log('  --check   校验冻结值（巡检启动先跑它；不一致 → 退出码 3）')
    console.log('  --write   写冻结值：人的签字那一击（AI 的写入面只有 proposals/）')
    return 0
  }

  const wantWrite = argv.includes('--write')
  const wantCheck = argv.includes('--check')
  if (wantWrite === wantCheck) {
    console.error('[ux:freeze] 要么 --check 要么 --write（一次只做一件事）')
    return 2
  }

  try {
    if (wantWrite) {
      const written = writeFreeze({
        repoRoot,
        frozenAt: undefined,
        note: readFlagValue('--note') ?? null,
        approvedBy: readFlagValue('--approved-by') ?? 'human',
      })
      console.log(`[ux:freeze] 已冻结：${written.file}`)
      console.log(
        `[ux:freeze] 判据集 version ${written.version}（${written.freeze.criteria.criteriaCount} 条判据 / ${written.freeze.criteria.familyCount} 个族）`,
      )
      console.log(`[ux:freeze] 冻结时刻 ${written.freeze.frozenAt} · 签字人 ${written.freeze.approvedBy}`)
      console.log('[ux:freeze] 这一击是人的动作；自动化通道写完 proposals/ 就该停手（ADR-0015 第 6、7 条）')
      return 0
    }

    const absolute = resolve(repoRoot, CRITERIA_FILE)
    if (!existsSync(absolute)) {
      console.error(`[ux:freeze] 判据投影产物不存在：${CRITERIA_FILE}。先跑 ${PROJECT_WRITE}。`)
      return 2
    }
    const guard = guardCriteria({ repoRoot, criteriaText: readNormalizedText(absolute) })
    console.log(
      `[ux:freeze] 冻结值一致：判据集 ${guard.version.slice(0, 12)}（冻结于 ${guard.frozen.frozenAt}，签字人 ${guard.frozen.approvedBy}）`,
    )
    return 0
  } catch (error) {
    if (error instanceof CriteriaFrozenError) {
      console.error(`[ux:freeze] ${error.message}`)
      return 3
    }
    if (error instanceof CriteriaError) {
      console.error(`[ux:freeze] ${error.message}`)
      return 2
    }
    throw error
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}
