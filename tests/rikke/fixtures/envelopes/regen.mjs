#!/usr/bin/env node
/**
 * tests/rikke/fixtures/envelopes/regen.mjs — 黄历信封 fixture 的**生成器**（别手改那些 JSON）。
 *
 * 本目录的 `*.json` 是 **Lead 记的探针在真机上抓下来的响应**的裁剪版，不是手写的信封：
 *   `node .scratch/assembly-foundation/captures/gt13-huangli-probe.mjs`（探针，不入库）
 *   → 原始捕获（`.scratch/assembly-foundation/captures/gt13-huangli-*-raw.json`）
 *   → 本脚本裁剪 → `tests/rikke/fixtures/envelopes/*.json`（入库）
 *
 * 裁剪规则：**只删字段、不改值**（票 06 信封 fixture 的同一套规矩）：
 *   - 顶层键全留（信封形状的判据就在这一层）；
 *   - `data` 只留 `date` / `snapshot_text` / `technique_card`，删掉 `export_snapshot`
 *     （4.8KB 的重复渲染，断言用不到）；
 *   - 其余一字不动 —— 尤其 `snapshot_text` 必须逐字保留：rikke 的宜忌/流日就是从这里读的。
 *
 * 用法：
 *   node tests/rikke/fixtures/envelopes/regen.mjs            # 写回
 *   node tests/rikke/fixtures/envelopes/regen.mjs --check    # 只比对（捕获不在盘上时跳过）
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 仓根（本文件在 <repo>/tests/rikke/fixtures/envelopes/ 下）。 */
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..')
/** 原始捕获目录（`.scratch/` 不入库：别的机器上不存在时本脚本直接跳过）。 */
const CAPTURES = join(REPO_ROOT, '.scratch', 'assembly-foundation', 'captures')

/** 原始捕获 → 入库 fixture。 */
const CASES = [
  { output: 'huangli-ok.json', raw: 'gt13-huangli-hour-raw.json', note: '传 date + hour（整数）的成功信封' },
  { output: 'huangli-invalid-payload.json', raw: 'gt13-huangli-bad-hour-raw.json', note: 'hour 传成字符串时的**真实失败信封**（tool.invalid_payload）' },
]

/** 裁剪：只删字段、不改值。 */
export function trim(envelope) {
  const clone = structuredClone(envelope)
  if (clone?.data && typeof clone.data === 'object') {
    clone.data = {
      date: clone.data.date,
      snapshot_text: clone.data.snapshot_text,
      technique_card: clone.data.technique_card,
    }
  }
  return clone
}

function main() {
  const check = process.argv.includes('--check')
  if (!existsSync(CAPTURES)) {
    process.stdout.write(`[regen] 捕获目录不在盘上（${CAPTURES}）：跳过（fixture 本身照常用）。\n`)
    return
  }
  let mismatch = 0
  for (const item of CASES) {
    const rawFile = join(CAPTURES, item.raw)
    if (!existsSync(rawFile)) {
      process.stdout.write(`[regen] 缺原始捕获 ${item.raw}：跳过这一条。\n`)
      continue
    }
    const text = `${JSON.stringify(trim(JSON.parse(readFileSync(rawFile, 'utf8'))), undefined, 2)}\n`
    const outFile = join(HERE, item.output)
    if (check) {
      const current = existsSync(outFile) ? readFileSync(outFile, 'utf8') : null
      const same = current === text
      if (!same) mismatch += 1
      process.stdout.write(`${same ? '✓' : '✗'} ${item.output}（${item.note}）\n`)
      continue
    }
    writeFileSync(outFile, text)
    process.stdout.write(`✓ 写入 ${item.output}（${Buffer.byteLength(text)} 字节）—— ${item.note}\n`)
  }
  if (check && mismatch > 0) {
    process.stdout.write(`[regen] ${mismatch} 份 fixture 与原始捕获不一致：重跑不带 --check 重写。\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main()
