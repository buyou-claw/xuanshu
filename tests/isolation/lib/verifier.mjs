/**
 * tests/isolation/lib/verifier.mjs — 隔离验收测试的公共夹具。
 *
 * 为什么单独一个模块（而不是在三个测试文件里各写一遍）：
 *   1) **环境门只有一份**：profile 没装时必须「显式 skip + 打印修复命令」，设
 *      `XUANSHU_REQUIRE_ASSEMBLY=1` 时变硬失败。三份拷贝＝三种漂移可能，而这一门最容易
 *      悄悄退化成「没装 = 全绿」。写法照抄 `tests/assembly/assembly-contract.test.mjs`。
 *   2) **同源原则**：测试只 spawn `scripts/verify-isolation.mjs --json`，再断言它给出的 checks。
 *      断言逻辑（四态判据、退出码映射、路径包含关系）全部在验收台里，测试不重新实现一份。
 *   3) 对照组服务端/空闲端口这类**夹具**放这里：测试负责「造出现场」，验收台负责「下判断」。
 *
 * 只用 Node 内置模块 + vitest 的断言 API（非测试文件也能 import 'vitest'）。
 */

import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const VERIFIER = join(REPO_ROOT, 'scripts', 'verify-isolation.mjs')
export const DSH_HOME = resolve(process.env.XUANSHU_DSH_HOME ?? join(REPO_ROOT, '.dsh-home'))
export const PROFILE = process.env.XUANSHU_PROFILE ?? 'xuanshu'
export const PROFILE_DIR = join(DSH_HOME, 'profiles', PROFILE)
export const REAL_HOME = join(homedir(), '.dsh')
export const TMP_ROOT = join(REPO_ROOT, 'tests', 'isolation', '.tmp')
export const INSTALL_HINT = `node scripts/install-profile.mjs --home "${DSH_HOME}"`
export const REQUIRE_INSTALL = process.env.XUANSHU_REQUIRE_ASSEMBLY === '1'
export const INSTALLED = existsSync(join(PROFILE_DIR, 'package.json')) && existsSync(join(PROFILE_DIR, 'node_modules'))

/** 单个测试文件的验收台预算：双实例两次 headless ≈ 6s，给足余量。 */
export const VERIFIER_TIMEOUT_MS = 600_000

/**
 * 跑一次验收台。**必须** `encoding: 'utf8'`：用 PowerShell 的 `>` 重定向会写成 UTF-16LE，
 * `JSON.parse` 直接崩（这条踩过一次，别再踩）。
 */
export function runVerifier(args, { timeoutMs = VERIFIER_TIMEOUT_MS, env } = {}) {
  const run = spawnSync(process.execPath, [VERIFIER, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: env === undefined ? process.env : { ...process.env, ...env },
  })
  let json
  try {
    json = JSON.parse(run.stdout)
  } catch {
    json = undefined
  }
  return {
    status: run.status,
    signal: run.signal,
    json,
    stdout: run.stdout ?? '',
    stderr: run.stderr ?? '',
    error: run.error?.message,
    raw: () => `exit=${run.status}\n--- stdout ---\n${(run.stdout ?? '').slice(0, 4000)}\n--- stderr ---\n${(run.stderr ?? '').slice(0, 2000)}`,
  }
}

/**
 * 环境门：profile 已装 → 真跑真断言；未装 → **同一批用例照收、逐条 skip** 并打印原因与修复命令；
 * `XUANSHU_REQUIRE_ASSEMBLY=1` → 把「没装」变成硬失败（交付/CI 用这个）。
 *
 * **为什么用例条数不许随环境变**（本轮评审发现，别再改回「未装时只注册一条占位」）：
 * 未装时只注册 1 条，`scripts/check-test-inventory.mjs` 就会判「用例变少」——
 * 干净 CI（没有 profile）上必红，而红的原因与本仓无关。改用 `describe.skipIf`：里面的用例
 * **照样被收集**、只是标成跳过，于是「装了」与「没装」收集到的条数一致
 * （实测：`describe.skipIf(true)` 里的用例仍被收集、状态 skipped）。
 * 未装但要求硬失败时不跳过 —— 那一组真跑并红在明处（CI / 交付前验收用这个）。
 */
export function withProfileGate(title, body) {
  if (!INSTALLED && REQUIRE_INSTALL) {
    // 硬失败模式（交付 / 交付前验收）：同一批用例照收（跳过），**另加一条点名原因的失败**。
    // 为什么另加而不让这一组真跑：真跑会逐个 spawn 验收台、报一堆次级错误，红的地方反而不清楚；
    // 而「条数」这边只多不少（清单门只拦「变少」），红得清楚又不破坏「总数不随环境缩水」。
    console.warn(
      `\n⚠️  ${title}：profile "${PROFILE}" 未安装，而 XUANSHU_REQUIRE_ASSEMBLY=1 —— 这一组按硬失败处理。\n`
      + `   先安装：${INSTALL_HINT}\n`,
    )
    describe.skipIf(true)(title, () => body({ installed: false }))
    describe(`${title}（强制模式）`, () => {
      it('profile 必须已安装（XUANSHU_REQUIRE_ASSEMBLY=1）', () => {
        expect.fail(`profile "${PROFILE}" 未安装在 ${PROFILE_DIR}；先跑：${INSTALL_HINT}`)
      })
    })
    return
  }
  if (!INSTALLED) {
    // 绝不静默：把「为什么整组没跑」写进测试输出。
    console.warn(
      `\n⚠️  ${title} SKIPPED：profile "${PROFILE}" 未安装在 ${PROFILE_DIR}\n`
      + `   先安装：${INSTALL_HINT}\n`
      + '   交付/CI 校验请设 XUANSHU_REQUIRE_ASSEMBLY=1，让「没装」变成硬失败。\n',
    )
  }
  describe.skipIf(!INSTALLED)(title, () => body({ installed: INSTALLED }))
}

/* ───────────────────── 对照组服务端（一律 listen(0) 拿空闲端口） ───────────────────── */

const FIXTURE_SERVER = join(dirname(fileURLToPath(import.meta.url)), 'fixture-server.mjs')

/**
 * 起一个对照组服务端 —— **必须是独立进程**。
 *
 * 原因：验收台是用 `spawnSync` 跑的（硬要求：抓输出必须 utf8，别用 PowerShell 重定向），
 * 而 `spawnSync` 会阻塞父进程的事件循环。对照组要是长在测试进程里，探测那一刻它不会被调度，
 * 于是「有 HTTP 响应」的对照组全部退化成一件事：TCP 连得上（内核 backlog 就 ACK 了）、HTTP 无响应
 * → 一律判 occupied-foreign。测试会「看起来通过」，而 horosa-ready 从没被真验过（假绿）。
 *
 * 返回 `{ kind, port, pid, stop() }`；测完必须 `stop()`。
 */
export async function startFixture(kind, { timeoutMs = 10_000 } = {}) {
  const child = spawn(process.execPath, [FIXTURE_SERVER, '--kind', kind], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const port = await new Promise((resolvePromise, reject) => {
    let buffer = ''
    let stderr = ''
    const timer = setTimeout(() => reject(new Error(`对照组 ${kind} 没在 ${timeoutMs}ms 内报出端口`)), timeoutMs)
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      clearTimeout(timer)
      try {
        resolvePromise(JSON.parse(buffer.slice(0, newline)).port)
      } catch (error) {
        reject(new Error(`对照组 ${kind} 报了看不懂的一行：${buffer.slice(0, newline)}（${error.message}）`))
      }
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`对照组 ${kind} 提前退出了（exit ${code}）\n${stderr.slice(0, 500)}`))
    })
  })
  return {
    kind,
    port,
    pid: child.pid,
    stop: () => {
      try {
        child.kill()
      } catch {
        /* 已经退出了 */
      }
    },
  }
}

/** 停掉所有对照组；测试的 afterAll 里调一次。 */
export function stopFixtures(fixtures) {
  for (const fixture of fixtures) fixture?.stop?.()
}

/** 拿一个「刚被释放、此刻应该空闲」的端口（起 server → 读端口 → 关掉）。 */
export async function reserveFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = http.createServer((_req, res) => res.end(''))
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePromise(port))
    })
  })
}

/* ───────────────────── 断言辅助（只读验收台的输出，不重判） ───────────────────── */

/** 取某个 check 并断言它存在且通过；失败时把验收台的原始输出贴出来。 */
export function expectCheckPass(result, id) {
  expect(result.json, `验收台没有输出可解析的 JSON：\n${result.raw()}`).toBeDefined()
  const entry = result.json.checks?.[id]
  expect(entry, `验收台没跑 [${id}]；输出：\n${result.raw()}`).toBeDefined()
  expect(entry.skipped ?? false, `[${id}] 被 skip 了（= 没测，不是绿）：${entry.detail}`).toBe(false)
  expect(entry.ok, `[${id}] ${entry.detail}`).toBe(true)
  return entry
}
