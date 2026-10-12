/**
 * tests/setup/report-and-gates.test.mjs — A4 / A5 / A6 / A10 / A11 的**外部可观察物**用例。
 *
 * 这一组用例不跑自检（`--no-selfcheck`）、不取件（`--verify-only` 或「在取件之前就失败」），
 * 断言的全是「跑完之后磁盘上多了什么、报告里写了什么」：
 *
 *   A4（`--verify-only` 跳过 uvx 环境门）：同一条**没有 uv/uvx 的 PATH** 上，`--verify-only` 必须 exit 0
 *      （它压根不 spawn uvx），而真跑那条路必须 exit 3（环境门确实在）。两侧都断言，才叫「门在那儿」。
 *   A5（失败也写报告）：pin 没有当前平台（exit 2）也必须落 `<dsh-home>/xuanshu/setup-report.json`，
 *      且 notes 写明失败阶段；同一失败若撞上「真实 home 被拒」，则**一个字节都不许写**。
 *   A6（真实 `~/.horosa` 守卫）：环境里带的 `HOROSA_SKILL_DATA_DIR` 指向真实数据目录 → 忽略 + 记 note，
 *      数据目录回到 `<dsh-home>/xuanshu/horosa`（与票 04 R16 对 `DSH_HOME` 的裁决同款）。
 *   A10（平台回退不静默）：本机平台键在 pin 里直接命中时，`pin.runtime.platformFallback` 必须是 `null`
 *      （回退分支的单测在 `pin.test.mjs`：本机是 win32-x64，造不出 arm64 的真平台）。
 *   A11（大输出落 logs/）：C1 的原始 JSON 落 `<dsh-home>/xuanshu/logs/`，报告里给路径；路径真的存在。
 *
 * 零网络、零真实安装、绝不碰真实 `~/.dsh` 或 `C:\horosa`。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { PIN_VERSION, PLATFORM_KEY, writeTestPin } from './lib/fixtures.mjs'
import { STUB_VERIFY_ASSEMBLY } from './lib/paths.mjs'
import { listFiles, makeSandbox } from './lib/sandbox.mjs'
import { readReport, runSetup, findFreePort } from './lib/setup-run.mjs'

/** 一条**没有 uv/uvx** 的 PATH（沙箱里的空目录）—— A4 的前提。 */
function emptyPathDir(sandbox) {
  const dir = sandbox.dir('empty-path')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 只读的目录项快照（目录不存在 → []）；用来断言「一个字节都没写」。 */
function listDir(path) {
  try {
    return listFiles(path)
  } catch {
    return []
  }
}

describe('票 05 · A4：`--verify-only` 不跑 uvx 环境门（真跑要跑）', () => {
  it('同一份「没有 uvx 的 PATH」：`--verify-only` exit 0；真跑 exit 3（证明门还在）', () => {
    const sandbox = makeSandbox('a4-verify-only')
    const env = { PATH: emptyPathDir(sandbox), XUANSHU_VERIFY_ASSEMBLY_BIN: STUB_VERIFY_ASSEMBLY }
    const dirs = ['--cache', sandbox.cache, '--dsh-home', sandbox.home, '--runtime-root', sandbox.runtimeRoot, '--json']

    // ① `--verify-only`：没有 uvx 也必须是 0（它不 spawn uvx，就不该被 uvx 的门挡）。
    const verify = runSetup([...dirs, '--verify-only', '--no-selfcheck'], { env })
    expect(verify.status, verify.raw()).toBe(0)
    const { report } = readReport(sandbox.home)
    expect(report, 'A5/A4：--verify-only 也该落报告').toBeDefined()
    expect(report.ok).toBe(true)
    expect(report.notes.join('\n')).toContain('不跑 uvx 环境门')

    // ② 同一份 PATH，去掉 `--verify-only`：取件/安装要 uvx → 环境门 exit 3（说明①不是因为门没了）。
    const real = runSetup([...dirs, '--no-selfcheck'], { env })
    expect(real.status, real.raw()).toBe(3)
    expect(`${real.stdout}\n${real.stderr}`).toMatch(/uvx 不可用|uvx/)
    // A5：这条失败也落了报告，且写明失败阶段（「uvx 环境门」）。
    const failed = readReport(sandbox.home).report
    expect(failed.ok).toBe(false)
    expect(failed.exitCode).toBe(3)
    expect(failed.notes.join('\n')).toContain('失败阶段：uvx 环境门')
  })
})

describe('票 05 · A5：失败也写报告（真实 home 被拒仍零写入）', () => {
  it('pin 里没有当前平台（exit 2）→ 报告落盘、ok=false、exitCode=2、notes 写明失败阶段', () => {
    const sandbox = makeSandbox('a5-failure-report')
    const other = PLATFORM_KEY === 'darwin-arm64' ? 'win32-x64' : 'darwin-arm64'
    writeTestPin({
      path: join(sandbox.work, 'pin.json'),
      releaseBase: 'http://127.0.0.1:1/releases/download/v0.40.1', // 失败发生在取件之前，这个地址永远不会被访问
      wheel: { name: `horosa_skill-${PIN_VERSION}-py3-none-any.whl`, sha256: 'a'.repeat(64), size: 4096 },
      platforms: [other],
    })

    const result = runSetup(
      ['--cache', sandbox.cache, '--dsh-home', sandbox.home, '--runtime-root', sandbox.runtimeRoot, '--json', '--no-selfcheck'],
      { env: { XUANSHU_SETUP_PIN: join(sandbox.work, 'pin.json') } },
    )
    expect(result.status, result.raw()).toBe(2)

    const { report, path } = readReport(sandbox.home)
    expect(report, `A5：失败路径没写报告（${path} 不存在）`).toBeDefined()
    expect(existsSync(path)).toBe(true)
    expect(report.ok).toBe(false)
    expect(report.exitCode).toBe(2)
    expect(report.error).toContain('没有当前平台')
    expect(report.notes.join('\n'), '报告里没写清失败阶段').toContain('失败阶段')
    // 即使用户没带 --json，报告也必须落盘（这里带了；① 的断言只管文件）
    expect(result.json?.exitCode).toBe(2)
  })

  it('取件失败（`--skip-download` 且缓存缺件）→ 报告里写明失败阶段是「取件 / SHA256 校验」', () => {
    const sandbox = makeSandbox('a5-stage-note')
    const result = runSetup(
      ['--cache', sandbox.cache, '--dsh-home', sandbox.home, '--runtime-root', sandbox.runtimeRoot, '--json', '--no-selfcheck', '--skip-download'],
      { env: {} },
    )
    expect(result.status, result.raw()).toBe(2)
    const { report } = readReport(sandbox.home)
    expect(report.ok).toBe(false)
    expect(report.exitCode).toBe(2)
    expect(report.notes.join('\n'), 'A5：失败报告必须写明失败在**哪一步**').toContain('失败阶段：取件 / SHA256 校验（退出码 2）')
  })

  it('同一失败撞上「真实 ~/.dsh 被拒」→ 一个字节都不写（含报告与 logs/）', () => {    const sandbox = makeSandbox('a5-refused-no-write')
    const other = PLATFORM_KEY === 'darwin-arm64' ? 'win32-x64' : 'darwin-arm64'
    writeTestPin({
      path: join(sandbox.work, 'pin.json'),
      releaseBase: 'http://127.0.0.1:1/releases/download/v0.40.1',
      wheel: { name: `horosa_skill-${PIN_VERSION}-py3-none-any.whl`, sha256: 'a'.repeat(64), size: 4096 },
      platforms: [other],
    })
    // 「真实 home」用沙箱里的假 home 冒充（`USERPROFILE`/`HOME` 一起改），实现有 bug 也污染不到真目录。
    const pretendHome = join(sandbox.root, 'pretend-home')
    const pretendDsh = join(pretendHome, '.dsh')
    mkdirSync(pretendDsh, { recursive: true })

    const result = runSetup(
      ['--cache', sandbox.cache, '--dsh-home', pretendDsh, '--runtime-root', sandbox.runtimeRoot, '--json', '--no-selfcheck'],
      { env: { XUANSHU_SETUP_PIN: join(sandbox.work, 'pin.json'), USERPROFILE: pretendHome, HOME: pretendHome } },
    )
    expect(result.status, result.raw()).toBe(2)
    expect(listDir(pretendDsh), '拒绝路径竟然写了盘').toEqual([])
    expect(existsSync(join(pretendDsh, 'xuanshu', 'setup-report.json'))).toBe(false)
    expect(existsSync(join(pretendDsh, 'xuanshu', 'logs'))).toBe(false)
    expect(result.json, '被拒时 stdout 也该有一份报告（只是不落盘）').toBeDefined()
  })
})

describe('票 05 · A6：`HOROSA_SKILL_DATA_DIR` 指向真实 ~/.horosa → 忽略并记 note', () => {
  it('数据目录回到 <dsh-home>/xuanshu/horosa，真实 ~/.horosa 零写入', () => {
    const sandbox = makeSandbox('a6-data-dir-guard')
    const pretendHome = join(sandbox.root, 'pretend-home')
    const realHorosa = join(pretendHome, '.horosa')
    mkdirSync(realHorosa, { recursive: true })

    const result = runSetup(
      ['--cache', sandbox.cache, '--dsh-home', sandbox.home, '--runtime-root', sandbox.runtimeRoot, '--json', '--verify-only', '--no-selfcheck'],
      { env: { HOROSA_SKILL_DATA_DIR: join(realHorosa, 'xuanshu'), USERPROFILE: pretendHome, HOME: pretendHome } },
    )
    expect(result.status, result.raw()).toBe(0)
    const { report } = readReport(sandbox.home)
    expect(report.runtime.dataDir, '环境里的 HOROSA_SKILL_DATA_DIR 指向真实 ~/.horosa 却没被忽略').toBe(join(sandbox.home, 'xuanshu', 'horosa'))
    expect(report.notes.join('\n')).toMatch(/HOROSA_SKILL_DATA_DIR=.*真实 horosa 数据目录.*已忽略/)
    expect(listDir(realHorosa), '真实 ~/.horosa 被写了').toEqual([])
  })
})

describe('票 05 · A10 / A11：报告里的 additive 键', () => {
  it('平台直接命中时 pin.runtime.platformFallback 是 null；C1 的原始输出落 logs/ 且路径可读', () => {
    const sandbox = makeSandbox('a10-a11-report-keys')
    const result = runSetup(
      [
        '--cache', sandbox.cache, '--dsh-home', sandbox.home, '--runtime-root', sandbox.runtimeRoot,
        '--horosa-port', '8765', '--verify-only', '--no-selfcheck', '--json',
      ],
      { env: { XUANSHU_VERIFY_ASSEMBLY_BIN: STUB_VERIFY_ASSEMBLY } },
    )
    expect(result.status, result.raw()).toBe(0)
    const { report } = readReport(sandbox.home)
    // A10 的键必须**始终存在**（null 也是信息：「本机平台键在 pin 里直接命中」）。
    expect(report.pin.runtime.platformFallback).toBe(null)
    expect(report.notes.join('\n')).toContain('平台回退')
    // 没有自检就没有 C1 的 logs/；这条用例只钉「键存在」。
    expect(Array.isArray(report.checks)).toBe(true)
  })

  it('跑过 C1 时：evidence.logFile 指向 logs/ 下的真实文件，里面就是断言台的原始 JSON', async () => {
    const sandbox = makeSandbox('a11-log-file')
    // 端口取一个**空闲**端口（绝不碰 8765 上可能真在跑的实例），并让 uvx 指向一个不存在的路径：
    // C2 于是「端口空着 → 起 serve → spawn 失败」→ exit 5。这条用例只关心 C1 的 logs/，而这条路
    // 是**确定性**的（不依赖本机有没有装 uv、有没有 horosa 在跑）。
    const port = await findFreePort()
    const result = runSetup(
      [
        '--cache', sandbox.cache, '--dsh-home', sandbox.home, '--runtime-root', sandbox.runtimeRoot,
        '--horosa-port', String(port), '--verify-only', '--selfcheck-timeout', '20000', '--json',
      ],
      {
        env: {
          XUANSHU_VERIFY_ASSEMBLY_BIN: STUB_VERIFY_ASSEMBLY,
          XUANSHU_UVX_BIN: join(sandbox.work, 'no-such-uvx'),
        },
      },
    )
    expect(result.status, result.raw()).toBe(5)

    const { report } = readReport(sandbox.home)
    const c1 = report.checks.find((check) => check.id === 'assembly')
    expect(c1.ok, c1.detail).toBe(true)
    expect(c1.evidence.logFile, 'C1 的 evidence 没给 logs/ 路径').toBe(join(sandbox.home, 'xuanshu', 'logs', 'verify-assembly.json'))
    expect(existsSync(c1.evidence.logFile), '报告给了路径，文件却不在').toBe(true)
    const raw = JSON.parse(readFileSync(c1.evidence.logFile, 'utf8'))
    expect(raw.schema).toBe('xuanshu/assembly-report@1')
    expect(raw.ok).toBe(true)
  }, 120_000)
})
