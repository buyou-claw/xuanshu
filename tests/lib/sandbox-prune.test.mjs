/**
 * tests/lib/sandbox-prune.test.mjs — 清理判据的**证否用例**（票 16 修复轮 · 任务 A）
 *
 * 为什么这条用例长这样：`pruneStale()` 在 6 个 `tests/<域>/lib/sandbox.mjs` 里各有一份，
 * 其中两处把比较写反了（`now - mtime < STALE_MS`），于是**刚建的沙箱被删、过旧的永远留着**。
 * 一个「清理函数」如果只在新建的沙箱上跑过，它写反了也不会有人发现 —— 所以这里**同时**造
 * 「很旧」与「刚建」两个现场，并断言方向正确：**旧的没了、新的还在**。
 *
 * 探针只走**公开入口 `makeSandbox()`**（它在内部调 `pruneStale()`），不去够私有函数：
 *   - 临时的根目录也由它推出来（`dirname(sandbox.root)`）—— 各域怎么摆 `.tmp` 是各自的事，
 *     这里不该再抄一遍它们的路径常量（`horosa`/`setup` 就没导出 `TMP_ROOT`，第一版这么抄过，红了）。
 * 修之前这条用例在 **bazi / consult** 两处是红的（旧的活着、新建的被删），修完转绿。
 *
 * 环境：真文件系统（`utimesSync` 把 mtime 挪到 7 小时前造「旧件」），零网络、零 LLM。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { makeSandbox as baziSandbox } from './../bazi/lib/sandbox.mjs'
import { makeSandbox as consultSandbox } from './../consult/lib/sandbox.mjs'
import { makeSandbox as digaoSandbox } from './../digao/lib/sandbox.mjs'
import { makeSandbox as horosaSandbox } from './../horosa/lib/sandbox.mjs'
import { makeSandbox as setupSandbox } from './../setup/lib/sandbox.mjs'
import { makeSandbox as sedimentSandbox } from './../sediment/lib/sandbox.mjs'
import { makeSandbox as workflowSandbox } from './../workflow/lib/sandbox.mjs'
import { SANDBOX_STALE_MS, pruneStaleDirs } from './sandbox-prune.mjs'

/** 六个域的公开入口（少一个都说明共享实现没接全）。 */
const SITES = [
  { suite: 'bazi', make: baziSandbox },
  { suite: 'consult', make: consultSandbox },
  { suite: 'digao', make: digaoSandbox },
  { suite: 'horosa', make: horosaSandbox },
  { suite: 'setup', make: setupSandbox },
  { suite: 'sediment', make: sedimentSandbox },
  { suite: 'workflow', make: workflowSandbox },
]

/** 本轮用例自己造出来的现场，收尾一律删掉（无论红了绿了）。 */
const litter = []
afterEach(() => {
  for (const path of litter.splice(0)) rmSync(path, { recursive: true, force: true })
})

/** 各域 `makeSandbox()` 的返回值形状不一（有的带 cleanup）：清理时统一兜住。 */
function dispose(sandbox) {
  try {
    sandbox?.cleanup?.()
    if (typeof sandbox?.root === 'string') litter.push(sandbox.root)
  } catch {
    /* 清理失败不掩盖断言 */
  }
}

/** 在某个域的临时区里造两个现场：一个「7 小时前」的旧件、一个刚建的新件。 */
function plant(label, tmp) {
  mkdirSync(tmp, { recursive: true })
  const old = join(tmp, `probe-old-${label}`)
  const fresh = join(tmp, `probe-fresh-${label}`)
  mkdirSync(old, { recursive: true })
  mkdirSync(fresh, { recursive: true })
  writeFileSync(join(old, 'marker.txt'), 'old')
  writeFileSync(join(fresh, 'marker.txt'), 'fresh')
  const sevenHoursAgo = new Date(Date.now() - SANDBOX_STALE_MS - 60 * 60 * 1000)
  utimesSync(old, sevenHoursAgo, sevenHoursAgo)
  litter.push(old, fresh)
  return { old, fresh }
}

describe('任务A · 各域的 makeSandbox 触发清理时：旧件删掉、新件留下（证否用例）', () => {
  it.each(SITES)('$suite：旧沙箱没了、刚建的还在', ({ suite, make }) => {
    // ① 先用公开入口开一个沙箱 —— 它的父目录就是该域的临时区（不抄路径常量）。
    const probe = make(`prune-probe-${suite}`)
    const tmp = dirname(probe.root)
    expect(tmp.replace(/\\/g, '/')).toMatch(new RegExp(`/tests/${suite}/\\.tmp$`))
    dispose(probe)

    // ② 造现场：一个 7 小时前的旧件 + 一个刚建的新件。
    const { old, fresh } = plant(suite, tmp)

    // ③ 再开一个沙箱 —— 这一次 makeSandbox 开头的 pruneStale() 就是被测行为。
    const trigger = make(`prune-trigger-${suite}`)
    dispose(trigger)

    // 方向一：**过旧的**必须被清掉（比较写反成 `<` 时，这里红：旧件永远活着）
    expect(existsSync(old), `过旧的沙箱该被删掉（${old}）`).toBe(false)
    // 方向二：**刚建的**必须留着（比较写反成 `<` 时，这里也红：新建的当场被删 = 并发时互删现场）
    expect(existsSync(fresh), `刚建的沙箱必须留着（${fresh}）`).toBe(true)
  })
})

describe('任务A · 共享实现本身（单一来源）', () => {
  /** 一个一次性的临时区（不碰各域真实的 .tmp）。 */
  function scratchRoot(label) {
    const root = mkdtempSync(join(tmpdir(), `sandbox-prune-${label}-`))
    litter.push(root)
    return root
  }

  it('返回真删掉的那几个；不碰文件；年轻的不动', () => {
    const root = scratchRoot('impl')
    mkdirSync(join(root, 'a-file.txt'), { recursive: true })
    const { old, fresh } = plant('impl', root)
    const removed = pruneStaleDirs(root)
    expect(removed).toEqual([old])
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(join(root, 'a-file.txt'))).toBe(true)
  })

  it('根目录不存在 → 不抛、返回空（各域第一次跑测试时就会走到这条）', () => {
    expect(pruneStaleDirs(join(tmpdir(), 'sandbox-prune-does-not-exist-xyz'))).toEqual([])
  })

  it('`now` 可注入：把「现在」挪到 7 小时后再看，刚建的也算过旧（方向一致，可证否）', () => {
    const root = scratchRoot('clock')
    const { fresh } = plant('clock', root)
    const removed = pruneStaleDirs(root, { now: Date.now() + SANDBOX_STALE_MS + 60 * 60 * 1000 })
    expect(removed).toContain(fresh)
    expect(existsSync(fresh)).toBe(false)
  })
})
