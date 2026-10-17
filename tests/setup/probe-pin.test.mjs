/**
 * tests/setup/probe-pin.test.mjs — A9：C3 的期望版本**只有** pin 一个来源，读不到就不猜。
 *
 * 原始缺陷：`scripts/horosa/probe.mjs` 里有一份 `FALLBACK_VERSION` 字面量（第二份钉版值，而 `pin.mjs`
 * 明令「代码里不许再出现」）。pin 读不到时它会静默退化成一份陈旧版本 —— 探针看着一切正常，
 * 断言的却是去年那个版本；这类缺陷**只有把 pin 拿掉才看得见**。
 *
 * 怎么在没有网络、也不动仓内 pin 的前提下造出「pin 读不到」：probe 的 pin 路径是
 * `new URL('../setup/horosa-pin.json', import.meta.url)` —— 相对**它自己那份文件**。所以把
 * `scripts/horosa/**` 与 `scripts/isolation/**` 抄进沙箱、把 `scripts/setup/` 建成**空目录**，
 * 再让一个子进程 import 那份副本：它眼里的 pin 就是「不存在」。
 *
 * 断言面仍然只有外部可观察物：子进程打印的 `checkBaziTool()` 返回值（契约 §9 的冻结接口）。
 * 特别地：**不许**退化成一个「连接失败」的结论 —— 那正是旧实现的形状（拿旧版本继续往下跑）。
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import { childEnv } from './lib/env.mjs'
import { REPO_ROOT } from './lib/paths.mjs'
import { makeSandbox } from './lib/sandbox.mjs'

/** 抄 `scripts/{horosa,isolation}` 进沙箱，并建一个**没有 pin** 的 `scripts/setup`。 */
function copyTreeWithoutPin(sandbox) {
  const root = sandbox.dir('no-pin-tree')
  mkdirSync(join(root, 'scripts', 'setup'), { recursive: true })
  for (const dir of ['horosa', 'isolation']) {
    const from = join(REPO_ROOT, 'scripts', dir)
    const to = join(root, 'scripts', dir)
    mkdirSync(to, { recursive: true })
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.isFile()) copyFileSync(join(from, entry.name), join(to, entry.name))
    }
  }
  return root
}

describe('票 05 · A9：探针的期望版本只有 pin 一个来源', () => {
  it('pin 读不到 → checkBaziTool 返回 ok:false（不猜版本、不发任何请求）', () => {
    const sandbox = makeSandbox('probe-pin-missing')
    const tree = copyTreeWithoutPin(sandbox)
    expect(existsSync(join(tree, 'scripts', 'setup', 'horosa-pin.json')), '副本里不该有 pin').toBe(false)

    const probeUrl = pathToFileURL(join(tree, 'scripts', 'horosa', 'probe.mjs')).href
    const runner = join(sandbox.root, 'run-check-bazi.mjs')
    writeFileSync(runner, [
      `const probe = await import(${JSON.stringify(probeUrl)})`,
      "const result = await probe.checkBaziTool({ port: 1, timeoutMs: 2000 })",
      "process.stdout.write(`${JSON.stringify(result)}\\n`)",
      '',
    ].join('\n'))

    const run = spawnSync(process.execPath, [runner], { encoding: 'utf8', env: childEnv(), timeout: 60_000 })
    expect(run.status, `子进程没跑成：${run.stderr}`).toBe(0)
    const result = JSON.parse(run.stdout)

    expect(result.ok, 'pin 读不到却放行了 —— 那就是「拿旧版本凑绿」的形状').toBe(false)
    expect(result.expectedVersion, '期望版本应当取不到（null），而不是某个字面量').toBe(null)
    expect(result.checks.pin, 'CHECKS 里要能看出是「前置：pin」这一格').toBe(false)
    expect(result.detail).toMatch(/钉版/)
    expect(result.detail).toMatch(/读不到|不可读/)
    // 旧实现会拿 FALLBACK_VERSION 继续跑，于是结论变成「连接不上 127.0.0.1:1」——这里必须不是那种形状。
    expect(result.detail, `结论退化成了连接错误：${result.detail}`).not.toMatch(/ECONNREFUSED|tools\/list 失败/)
  })
})
