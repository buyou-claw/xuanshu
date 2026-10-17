#!/usr/bin/env node
/**
 * tests/setup/fixtures/stubs/verify-assembly.mjs — `scripts/verify-assembly.mjs` 的**替身**（C1）。
 *
 * 契约 §5 的 C1 判据 = `node scripts/verify-assembly.mjs --json --dsh-home <home> --profile <name>`
 * 退出 0 且 stdout JSON 的 `ok === true`。真实现会去起 DSH CLI、加载整棵 profile 树（分钟级，还会写
 * `<home>/xuanshu/assembly-report.json`），对「setup 编排是否正确」这件事是噪声 —— 它自己的契约在
 * `tests/assembly/**` 里另有断言台。
 *
 * 所以这里只回放 C1 的**输出形状**，并可被 `XUANSHU_STUB_MODE=fail-verify` 翻成失败态，
 * 用来确定性地制造 exit 5（第 7 条）。
 *
 * 环境变量：
 *   XUANSHU_STUB_LOG   记账目录（缺省不记账）
 *   XUANSHU_STUB_MODE  'fail-verify' → exit 1（stdout 仍是 JSON，`ok:false`）
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const opt = (name) => {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}

const logDir = process.env.XUANSHU_STUB_LOG
if (logDir) {
  mkdirSync(logDir, { recursive: true })
  appendFileSync(join(logDir, 'verify-assembly.jsonl'), `${JSON.stringify({ ts: Date.now(), argv, cwd: process.cwd() })}\n`)
}

const home = opt('--dsh-home') ?? process.env.DSH_HOME ?? null
const profile = opt('--profile') ?? 'xuanshu'
const failed = process.env.XUANSHU_STUB_MODE === 'fail-verify'

const report = {
  schema: 'xuanshu/assembly-report@1',
  ok: !failed,
  exitCode: failed ? 1 : 0,
  checks: {
    s1: { ok: !failed, detail: 'stub verify-assembly' },
    s2: { ok: !failed, detail: 'stub verify-assembly' },
    s3: { ok: !failed, detail: 'stub verify-assembly' },
    s4: { ok: !failed, detail: 'stub verify-assembly' },
    s5: { ok: !failed, detail: 'stub verify-assembly' },
  },
  env: { home, profile, stub: true },
  detail: failed ? 'stub verify-assembly: forced failure (XUANSHU_STUB_MODE=fail-verify)' : 'stub verify-assembly: ok',
}

process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
process.exit(failed ? 1 : 0)
