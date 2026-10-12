#!/usr/bin/env node
/**
 * tests/horosa/fixtures/envelopes/regen.mjs — 从**真实捕获**里重生成信封 fixture。
 *
 * 为什么有这个脚本：`tests/horosa/fixtures/envelopes/*.json` 不是手写的「看着像」的信封，
 * 而是 Lead 2026-10-13 真机探针（`.scratch/assembly-foundation/captures/gt06-probe.mjs`）抓下来的
 * 真实响应的**裁剪版**。裁剪规则写在这里，谁都能重跑一遍核对（`p0-fixtures.test.mjs` 就是这么做的：
 * 它逐条把 fixture 的字段路径回对到捕获文件上，fixture 被人手改过就红）。
 *
 *   node tests/horosa/fixtures/envelopes/regen.mjs            # 写回 fixture
 *   node tests/horosa/fixtures/envelopes/regen.mjs --check    # 只比对，不改文件（exit 1 = 漂了）
 *
 * 输入（缺任一 → 不生成，fixture 保持原样）：
 *   gt06-envelope-default.json / gt06-envelope-clock.json / gt06-envelope-meansolar.json
 *   gt06-gate-raw.json
 *
 * 裁剪原则：**只删字段、不改值**。保留的是判据要用到的真实字段路径：
 *   data.technique_card.settings.timeAlg.value （§0.1 的 timeAlg 唯一判据）
 *   data.bazi.fourColumns.{year,month,day,**time**}.ganzi （四柱；真机**没有** `hour` 键，时柱叫 `time`）
 *   error.details.ask_if_missing / error.details.agent_recovery.prompt_to_user （澄清闸）
 *   data.snapshot_text （口径行原文，人读判据）
 * 删掉的是大而无当的：`data.bazi` 里 674KB 的神煞/纳音/大运（判据用不到）、`export_snapshot.export_text`。
 *
 * 两个**派生** fixture（不是原样裁剪，见 PROVENANCE.md 的「派生」一列）：
 *   bazi-ok-default-no-settings-timealg.json —— 抹掉 settings.timeAlg，验 §4.2 的**回退**判据
 *   bazi-error.json —— 由成功信封改写 ok/error 的最小改动版，验 §4.2 的 error 分支
 *     （真实捕获里没有这个分支：探针没造过 error；这是**合成**的，PROVENANCE 里标明白）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..')
const CAPTURES = join(REPO_ROOT, '.scratch', 'assembly-foundation', 'captures')

/** 四柱在真机里的**键名**：年 / 月 / 日 / **时（`time`，不是 `hour`）**。
 *
 * ⚠️ 这是本票的一处**契约与真机不符**（T3 2026-10-13 从捕获文件核对出来，已回报 Lead/T1）：
 * 契约 §0.1 与 §5 P4 写的是 `data.bazi.fourColumns.{year,month,day,hour}.ganzi`，
 * 但真机上 `fourColumns` 的键是 `year/month/day/time/tai/ming/shen/...`（17 个）——
 * **没有 `hour`**；时柱在 `fourColumns.time`（`zhu:'时'`，`ganzi:'甲午'`）。
 * fixture 按真机保留 `time`（fixture 不许为了迁就实现而改真形状）；`classifyBaziEnvelope`
 * 对外仍用 `pillars.hour` 这个槽位名（契约 §4.2），中间的映射是**实现必须做**的一步。
 */
const FOUR_COLUMN_PILLAR_KEYS = ['year', 'month', 'day', 'time']

/** 四柱里保留的子字段：判据只要 `ganzi`；其余是「这条 fixture 长在真结构里」的形状证据。 */
const FOUR_COLUMN_KEYS = ['ganzi', 'ganZhi', 'zhu']

function pickFourColumns(fourColumns = {}) {
  const out = {}
  for (const pillar of FOUR_COLUMN_PILLAR_KEYS) {
    const source = fourColumns[pillar]
    if (!source || typeof source !== 'object') continue
    const kept = {}
    for (const key of FOUR_COLUMN_KEYS) if (key in source) kept[key] = source[key]
    // 干支的字还各自挂在 stem.cell / branch.cell 上：留着，四柱才像真的四柱。
    for (const side of ['stem', 'branch']) {
      if (source[side] && typeof source[side] === 'object' && 'cell' in source[side]) {
        kept[side] = { cell: source[side].cell, element: source[side].element }
      }
    }
    out[pillar] = kept
  }
  return out
}

function trimExportSnapshot(exportSnapshot = {}) {
  const kept = {}
  // 只留小键（大字符串 export_text / sections 全文一律不留：判据用不到）。
  for (const key of ['technique', 'settings_used', 'bundle_version', 'format_source', 'provenance']) {
    if (key in exportSnapshot) kept[key] = exportSnapshot[key]
  }
  return kept
}

/**
 * 成功信封的裁剪：结构（含顶层四键 null）逐键保留，只把巨型子树换成语义相同的骨架。
 *
 * **非 ok 的信封整份原样返回**（gate / error）：它们本来就小（gate 全文 <18KB），
 * 而且 `data` 的形状是判据的一部分（gate 的 `data` 就是 `{}`，`input_normalized` 也是 `{}`）。
 * 早期版本把成功骨架套在 gate 信封上，产出了 `{bazi:{fourColumns:{}}}` 这种**真机没有的形状**——
 * Lead 用原始捕获复核抓到了，这里按「只在 ok 上裁剪」修掉（fixture 不许比真机多一个键）。
 */
export function trimEnvelope(envelope) {
  if (envelope?.ok !== true) return envelope
  const data = envelope.data ?? {}
  const bazi = data.bazi ?? {}
  return {
    ok: envelope.ok,
    tool: envelope.tool,
    version: envelope.version,
    input_normalized: envelope.input_normalized,
    data: {
      bazi: {
        gender: bazi.gender,
        local: bazi.local,
        fourColumns: pickFourColumns(bazi.fourColumns),
        directTime: bazi.directTime,
        source: bazi.source,
      },
      gender: data.gender,
      local: data.local,
      compute_sources: data.compute_sources,
      // 口径行的原文在这儿（「时间算法：真太阳时」），三档对照的人读判据，整段留着（5.6KB）。
      snapshot_text: data.snapshot_text,
      export_snapshot: trimExportSnapshot(data.export_snapshot),
      // technique_card 整块留着（1.4KB）：settings.timeAlg.value 是 §0.1 的**唯一判据**。
      technique_card: data.technique_card,
    },
    summary: envelope.summary,
    warnings: envelope.warnings,
    memory_ref: envelope.memory_ref
      ? {
          run_id: envelope.memory_ref.run_id,
          tool_name: envelope.memory_ref.tool_name,
          trace_id: envelope.memory_ref.trace_id,
          group_id: envelope.memory_ref.group_id,
        }
      : envelope.memory_ref,
    trace_id: envelope.trace_id,
    group_id: envelope.group_id,
    error: envelope.error,
    code: envelope.code,
    message: envelope.message,
    details: envelope.details,
  }
}

/** 成功信封 → 最小改动的 error 信封（合成；真实捕获里没有 error 分支）。 */
function deriveErrorEnvelope(ok) {
  const envelope = structuredClone(ok)
  envelope.ok = false
  envelope.data = {}
  envelope.error = { code: 'invalid_payload', message: "field 'date' is required", details: { field: 'date' } }
  envelope.code = 'invalid_payload'
  envelope.message = "field 'date' is required"
  envelope.details = { field: 'date' }
  envelope.memory_ref = null
  envelope.trace_id = null
  envelope.group_id = null
  return envelope
}

/** 成功信封 → 抹掉 technique_card.settings.timeAlg（派生；验回退判据）。 */
function deriveNoSettingsTimeAlg(ok) {
  const envelope = structuredClone(ok)
  delete envelope.data.technique_card.settings.timeAlg
  return envelope
}

/** 读出 SSE/JSON-RPC 里的信封：真机是 `data: {"jsonrpc"...,"result":{"content":[{"type":"text","text":"<信封 JSON>"}]}}`。 */
function envelopeFromGateCapture(raw) {
  const dataLine = String(raw.text ?? '')
    .split(/\r?\n/)
    .find((line) => line.startsWith('data: '))
  if (!dataLine) throw new Error('gt06-gate-raw.json: 没找到 SSE 的 data: 行')
  const rpc = JSON.parse(dataLine.slice('data: '.length))
  const text = rpc?.result?.content?.[0]?.text
  if (typeof text !== 'string') throw new Error('gt06-gate-raw.json: result.content[0].text 不是字符串')
  return JSON.parse(text)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** 生成「文件名 → 内容对象」的全集（不落盘）。缺捕获文件时抛，调用方决定怎么办。 */
export function buildFixtures() {
  const sources = {
    default: join(CAPTURES, 'gt06-envelope-default.json'),
    clock: join(CAPTURES, 'gt06-envelope-clock.json'),
    meanSolar: join(CAPTURES, 'gt06-envelope-meansolar.json'),
    gate: join(CAPTURES, 'gt06-gate-raw.json'),
  }
  const missing = Object.values(sources).filter((path) => !existsSync(path))
  if (missing.length > 0) throw new Error(`缺捕获文件，无法重生成 fixture：\n${missing.join('\n')}`)

  const okDefault = trimEnvelope(readJson(sources.default))
  const okClock = trimEnvelope(readJson(sources.clock))
  const okMeanSolar = trimEnvelope(readJson(sources.meanSolar))
  const gate = trimEnvelope(envelopeFromGateCapture(readJson(sources.gate)))

  return {
    'bazi-ok-default.json': okDefault,
    'bazi-ok-clock.json': okClock,
    'bazi-ok-meansolar.json': okMeanSolar,
    'bazi-gate.json': gate,
    'bazi-ok-default-no-settings-timealg.json': deriveNoSettingsTimeAlg(okDefault),
    'bazi-error.json': deriveErrorEnvelope(okDefault),
  }
}

function main(argv) {
  const check = argv.includes('--check')
  let fixtures
  try {
    fixtures = buildFixtures()
  } catch (error) {
    console.error(`[regen] ${error.message}`)
    console.error('[regen] 捕获目录是 .scratch/（不入库）：在没跑过票 06 探针的机器上，这里**不生成**。')
    console.error('[regen] 现有 fixture 保持原样即可跑测试（p0-fixtures.test.mjs 的「对回捕获」用例会自动跳过）。')
    return check ? 0 : 1
  }
  mkdirSync(HERE, { recursive: true })
  let drifted = 0
  for (const [name, content] of Object.entries(fixtures)) {
    const text = `${JSON.stringify(content, undefined, 2)}\n`
    const path = join(HERE, name)
    if (check) {
      const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined
      if (current !== text) {
        console.error(`[regen] 漂了：${name}`)
        drifted += 1
      }
    } else {
      writeFileSync(path, text)
      console.log(`[regen] 写了 ${name}（${text.length} 字节）`)
    }
  }
  if (check && drifted > 0) {
    console.error(`[regen] ${drifted} 个 fixture 与捕获不一致（跑 node tests/horosa/fixtures/envelopes/regen.mjs 重生成）`)
    return 1
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
