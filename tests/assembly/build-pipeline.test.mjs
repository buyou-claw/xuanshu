/**
 * 构建管线的自证（不需要装 profile、不跑 DSH、不联网）：
 * `scripts/build-client.mjs --check` = 「提交的 `lib/client.js` 与 `src/**` 同步」的唯一机器判据。
 *
 * 为什么这条断言必须存在：`pnpm test` 不跑构建，而 S3 只比对「profile 里装的」与「仓库里的」
 * 两份产物 —— 两份都陈旧时 S3 是绿的。少了这条，改了 `src/**` 忘记 `pnpm build:client`
 * 会一路绿到 review。
 *
 * 负例（漂移）的核对不进测试：它会临时改动产物、依赖平台的行尾与编码，容易变成 flaky。
 * 手工核对两条路径的方法：
 *   # 漂移：产物与 src 不同步
 *   Add-Content packages/xuanshu-client/lib/client.js '// drift'
 *   node scripts/build-client.mjs --check      # 期望 exit 1 + 「产物与源码不同步」+「首个不同行：第 N 行」
 *   git checkout -- packages/xuanshu-client/lib/client.js
 *   # 构建失败不写盘：`--check` 的「跳过（--check）」与产物 mtime 不变由下面第 1 条断言守住；
 *   # 写盘只发生在**全部自检通过之后**（见 scripts/build-client.mjs 的 main 与文件头「写盘时序」）。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const BUILDER = join(REPO_ROOT, 'scripts', 'build-client.mjs')
const ARTIFACT = join(REPO_ROOT, 'packages', 'xuanshu-client', 'lib', 'client.js')
const TMP = join(HERE, '.tmp-build-pipeline')

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

/** 跑构建管线（直跑，不走 pnpm：与 vitest 的 cwd 无关）。 */
function runBuilder(script, cwd, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message,
  }
}

describe('build-client（预编译产物管线）', () => {
  it('--check：提交的 lib/client.js 与 src/** 同步（exit 0，打印 in sync，且不写盘）', () => {
    const before = statSync(ARTIFACT).mtimeMs
    const run = runBuilder(BUILDER, REPO_ROOT, ['--check'])
    expect(run.error ?? null, JSON.stringify(run)).toBeNull()
    expect(run.stderr, '自检或比对失败：先跑 pnpm build:client').toBe('')
    expect(run.stdout).toContain('in sync')
    expect(run.stdout).toContain('跳过（--check）')
    expect(run.status, `--check 期望 exit 0，实际 ${run.status}；stderr：${run.stderr}`).toBe(0)
    expect(statSync(ARTIFACT).mtimeMs, '--check 不该写盘').toBe(before)
  })

  it('--check 抓得住漂移：产物被改动后 exit 1 + 报「产物与源码不同步」（且不写盘）', () => {
    // 对照组：把本包（源码 + 清单 + 符号链接的 node_modules）复制到临时目录，只改产物。
    // 关键在 cpSync 而不是 readFileSync+writeFileSync —— 前者由内核拷字节，
    // 不会把本进程读到的（可能陈旧的）内容带进去。
    const scratch = join(TMP, 'drifted')
    const pkgDir = join(scratch, 'packages', 'xuanshu-client')
    mkdirSync(join(scratch, 'packages'), { recursive: true })
    cpSync(join(REPO_ROOT, 'packages', 'xuanshu-client'), pkgDir, {
      recursive: true,
      // node_modules 是 pnpm 的符号链接丛林：只带 esbuild 一条解析路径，不要整棵树
      filter: (src) => !src.includes('node_modules') || /node_modules[\\/](\.pnpm|esbuild)$/.test(src),
    })
    // 票 07 起客户端源码**直接引用** docs 下的 token 取值（assets README §4 的「接线」，
    // 不复制第二份）：这个脚手架模拟的是「仓库根」，所以必须把那条相对路径也摆出来，
    // 否则构建会先死在解析失败上、测不到「产物与源码不同步」这条断言。
    const tokensDir = join(scratch, 'docs', 'design', 'ui-v1', 'assets', 'tokens')
    mkdirSync(tokensDir, { recursive: true })
    cpSync(
      join(REPO_ROOT, 'docs', 'design', 'ui-v1', 'assets', 'tokens', 'xs-tokens.json'),
      join(tokensDir, 'xs-tokens.json'),
    )
    const artifact = join(pkgDir, 'lib', 'client.js')
    writeFileSync(artifact, '// drift\n', { flag: 'a' })
    const before = statSync(artifact).size

    // 让构建脚本把这棵脚手架当成仓库：脚本内路径全部从 REPO_ROOT 推导，
    // 只改它的定义即可（改了别处就让断言先说清楚，不要静默放过）。
    const builderText = readFileSync(BUILDER, 'utf8')
    const patched = builderText.replace(
      'const REPO_ROOT = dirname(SCRIPT_DIR);',
      `const REPO_ROOT = ${JSON.stringify(scratch)};`,
    )
    expect(patched, 'build-client.mjs 的 REPO_ROOT 定义变了，请同步本测试').not.toBe(builderText)
    const probe = join(scratch, 'build-client.check.mjs')
    writeFileSync(probe, patched)

    const run = runBuilder(probe, REPO_ROOT, ['--check'])
    expect(run.status, `期望 exit 1（stdout=${run.stdout} stderr=${run.stderr}）`).toBe(1)
    expect(run.stderr).toContain('产物与源码不同步')
    expect(run.stderr).toContain('首个不同行')
    expect(statSync(artifact).size, '--check 不该写盘').toBe(before)
    expect(readFileSync(artifact, 'utf8').endsWith('// drift\n')).toBe(true)
  })

  it('产物是提交物（不是构建缓存）：非空、以信封开头、恰好一次 load()', () => {
    // `--check` 读的就是这个文件；它必须真在仓库里（随包提交）。
    expect(existsSync(ARTIFACT)).toBe(true)
    const text = readFileSync(ARTIFACT, 'utf8')
    expect(text.length).toBeGreaterThan(0)
    expect(text.startsWith('window.__ModuleLoader__.load(')).toBe(true)
    expect((text.match(/window\.__ModuleLoader__\.load\(/g) ?? []).length).toBe(1)
  })
})
