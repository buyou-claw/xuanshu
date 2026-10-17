/**
 * tests/setup/args-exit.test.mjs — 退出码常量 + 参数面（验收台的「冻死面」部分）。
 *
 * 判据来源：契约 §8（退出码表，冻结）+ §2（参数表）+ §10 第 7 条（每一码至少一个用例）。
 *
 * 这里放的是**不需要 pin / 不需要 fixture** 的那一半：
 *   - `EXIT` 常量逐键相等（§8 的六个数就是接口；调用方据此决定「改用法 / 修环境 / 腾端口」）；
 *   - `scripts/setup.mjs` 的用法面：`--help` 必须真的打印参数、未知参数必须 exit 1 并点名它；
 *   - `parseArgs` 存在且可调用（默认值/语义的断言留在 E2E：那里断言的是**外部可观察物**）。
 * 各退出码的**行为**用例在 `setup-cli.test.mjs`（需要 fixture 与本地计数 server）。
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { EXIT } from '../../scripts/setup/exit.mjs'
import { parseArgs } from '../../scripts/setup/args.mjs'
import { SETUP_CLI } from './lib/paths.mjs'
import { runSetup } from './lib/setup-run.mjs'

describe('票 05 · 退出码常量（契约 §8 冻结）', () => {
  it('EXIT 就是冻结的六个数（多一个键 / 少一个键 / 改一个数都是破坏接口）', () => {
    expect(EXIT).toEqual({ ok: 0, usage: 1, fetch: 2, environment: 3, install: 4, selfcheck: 5 })
  })

  it('每个码都互不相同（防「两个门写同一个数」这种静默合并）', () => {
    const values = Object.values(EXIT)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('票 05 · 参数面（scripts/setup.mjs 的 CLI 表面）', () => {
  it('入口存在且是可跑的文件（契约 §2：`node scripts/setup.mjs`）', () => {
    expect(existsSync(SETUP_CLI), `缺少 ${SETUP_CLI}`).toBe(true)
  })

  it('parseArgs 存在且可调用：合法 argv 解析出对象、不抛', () => {
    expect(typeof parseArgs).toBe('function')
    const parsed = parseArgs([])
    expect(parsed).toBeTypeOf('object')
    expect(parsed).not.toBeNull()
  })

  it('--help：exit 0，且真的列出参数（`--install` 这种安全关键开关必须可被发现）', () => {
    const result = runSetup(['--help'], { timeoutMs: 30_000 })
    expect(result.status, result.raw()).toBe(0)
    expect(result.stdout.trim(), '--help 什么都没打印').not.toBe('')
    const flags = result.stdout.match(/--[a-z][a-z0-9-]*/g) ?? []
    expect(new Set(flags).size, `--help 里只有 ${new Set(flags).size} 个参数：${[...new Set(flags)].join(' ')}`).toBeGreaterThanOrEqual(5)
    expect(flags, '--help 没提 --install：用户发现不了「写真实 ~/.dsh」的那把钥匙').toContain('--install')
  })

  it('未知参数 → exit 1（用法错），且点名那个参数（绝不静默忽略）', () => {
    const result = runSetup(['--definitely-not-a-flag'], { timeoutMs: 30_000 })
    expect(result.status, result.raw()).toBe(1)
    expect(`${result.stdout}\n${result.stderr}`).toContain('--definitely-not-a-flag')
  })

  it('参数缺值 → exit 1（用法错），且报的是「缺值」而不是别的什么崩了', () => {
    const result = runSetup(['--wheel'], { timeoutMs: 30_000 })
    expect(result.status, result.raw()).toBe(1)
    // 防假绿：入口不存在时 node 也会 exit 1。必须是**用法错**，且点名那个参数。
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('MODULE_NOT_FOUND')
    expect(`${result.stdout}\n${result.stderr}`).toContain('--wheel')
  })
})
