/**
 * 玄枢 · 快速启动入口（`pnpm serve:xuanshu`）
 *
 * 一条命令把实例拉起来、把**带 token 的 URL** 打在屏幕上（默认顺手打开浏览器），Ctrl+C 停。
 * 它不是又一个启动器实现：起停一律走 `scripts/ux/collect/browser.mjs` 的 `startIsolatedInstance`
 * （link 模式 profile + 隔离 home + 停后还原共享 profile），这里只负责**选 home / 把话说人话 / 打开浏览器**。
 *
 * 为什么不复用 `scripts/isolation/startup.mjs --mode web`：那条要求 home 里已经装好完整 profile
 * （`profiles/xuanshu/node_modules`），而实操评估用的 home 每轮结束会把那个联接拆掉 —— 于是「刚跑完评估
 * 想自己上手看一眼」这个最常见的场景反而起不来。这里每次都用 `install-profile --skip-install` 重新接一遍，
 * 对「已存在的链接」是幂等的。
 *
 * 隔离硬规矩（与 `startup.mjs` 同一条）：解析出来的 home 等于或位于用户真实 `~/.dsh` 下 → 直接拒绝。
 * 玄枢从不在真实 DSH home 上起实例，这条不提供 `--force` 之类旁路。
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { startIsolatedInstance } from '../ux/collect/browser.mjs'

const ROUND_01 = join('.experience-home', 'round-01')
const DEV_HOME = '.dsh-home'
const SERVE_HOME = join('.experience-home', 'serve')

/** 真实 DSH home —— 只用于「拒绝」，永远不写。 */
export function realDshHome() {
  return join(homedir(), '.dsh')
}

/**
 * 如果 `repoRoot` 是 `<主检出>/.scratch/worktrees/<名字>` 这样的工作树，返回主检出根；否则 `undefined`。
 *
 * 为什么需要：评估 home（`.experience-home/round-01`，13 条记录 + 已配模型）在主检出里，
 * 而新改动在 worktree 里 —— 人在 worktree 里跑入口时，得能**直接复用主检出那份 home**，
 * 否则会拿到一个空 home（没模型、没记录），第一次上手就撞「未配模型」那条路。
 */
export function mainCheckoutRoot(repoRoot) {
  const marker = `${sep}.scratch${sep}worktrees${sep}`
  const at = repoRoot.indexOf(marker)
  return at === -1 ? undefined : repoRoot.slice(0, at)
}

/**
 * 候选 home 的展开（纯函数）：本检出 → 主检出（若不是同一个）→ 最后一条「新建」。
 * 顺序即优先级：先看有没有那份带记录的评估 home，再看开发 home，最后才新建。
 *
 * @param {{repoRoot: string, mainRoot?: string}} input
 * @returns {{home: string, source: string, relative: string}[]}
 */
export function homeCandidates({ repoRoot, mainRoot }) {
  const roots = [{ root: repoRoot, tag: '' }]
  if (mainRoot !== undefined && resolve(mainRoot) !== resolve(repoRoot)) {
    roots.push({ root: resolve(mainRoot), tag: '（主检出）' })
  }
  const out = []
  for (const relative of [ROUND_01, DEV_HOME]) {
    for (const { root, tag } of roots) {
      out.push({
        home: resolve(root, relative),
        source: `${relative === ROUND_01 ? 'default（评估 home，有历史记录）' : 'default（开发 home）'}${tag}`,
        relative,
      })
    }
  }
  out.push({ home: resolve(repoRoot, SERVE_HOME), source: 'default（新建的 serve home）', relative: SERVE_HOME })
  return out
}

/**
 * 解析这次要用哪个 home。**纯函数**（`exists` 可注入），优先级因此能被单测钉住。
 *
 * 优先级：`--home` ＞ `$XUANSHU_DSH_HOME` ＞ 候选里第一个**已存在**的 ＞ 最后一条（新建）。
 * 结果等于或位于真实 `~/.dsh` 下 → 抛错（隔离硬规矩）。
 *
 * @param {{repoRoot: string, mainRoot?: string, explicit?: string, env?: Record<string, string | undefined>, exists?: (p: string) => boolean, realHome?: string}} input
 * @returns {{home: string, source: string}}
 */
export function resolveServeHome({ repoRoot, mainRoot, explicit, env = {}, exists = existsSync, realHome = realDshHome() }) {
  let home
  let source
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    home = resolve(explicit)
    source = '--home'
  } else if (typeof env.XUANSHU_DSH_HOME === 'string' && env.XUANSHU_DSH_HOME.trim() !== '') {
    home = resolve(env.XUANSHU_DSH_HOME)
    source = '$XUANSHU_DSH_HOME'
  } else {
    const candidates = homeCandidates({ repoRoot, mainRoot })
    const hit = candidates.find((candidate) => exists(candidate.home))
    const picked = hit ?? candidates[candidates.length - 1]
    home = picked.home
    source = picked.source
  }
  const real = resolve(realHome)
  if (home === real || home.startsWith(`${real}${sep}`)) {
    throw new Error(`拒绝在用户真实的 DSH home 上起实例：${home}（来源 ${source}）。用 --home 指到玄枢自己的目录。`)
  }
  return { home, source }
}

/** 屏幕上看得到的三行（纯函数，便于断言文案本身）。 */
export function serveBanner({ home, url }) {
  return [
    `玄枢已起来（home = ${home}）`,
    `打开：${url}`,
    '停：Ctrl+C（实例停掉，home 与记录保留）',
  ]
}

/**
 * 这个 home 有没有配过模型（`<home>/.credentials.yaml`）。
 * 没有的话，人一进去就是「未配模型」现场（EXP-001/EXP-003 那条路）—— 起实例前先提醒一句，
 * 比让人对着报错猜要省事。
 */
export function credentialsHint({ home, exists = existsSync }) {
  return exists(join(home, '.credentials.yaml'))
    ? undefined
    : `${home} 里没有 .credentials.yaml：这个实例没配模型，问事会走到「未配模型」那条路（可换 --home 指到有凭据的 home）。`
}

/**
 * `--list`：把候选 home 连同「有几条问事记录」列出来，标出这次会选哪个。
 * 数字取自 `<home>/xuanshu/consult/sessions/*.json`（与 `consult.list` 同一份权威）。
 */
export function listCandidateHomes({ repoRoot, mainRoot, exists = existsSync, count } = {}) {
  const counter = count ?? ((home) => {
    const dir = join(home, 'xuanshu', 'consult', 'sessions')
    if (!existsSync(dir)) return 0
    try {
      return readdirSync(dir).filter((name) => name.endsWith('.json')).length
    } catch {
      return 0
    }
  })
  return homeCandidates({ repoRoot, mainRoot }).map((candidate) => {
    const present = exists(candidate.home)
    return { ...candidate, present, consultRecords: present ? counter(candidate.home) : 0 }
  })
}

/** 极简 URL 打开（Windows / macOS / Linux 各一条）。打开失败不抛：那不该拦住起实例。 */
export function openUrl(url) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.unref()
    return true
  } catch {
    return false
  }
}

const USAGE = `玄枢 · 快速启动（pnpm serve:xuanshu）

用法：
  node scripts/experience/serve.mjs [options]

  --home <dir>   用哪个隔离 home（默认：有记录的评估 home → 开发 home → 新建）
  --list         列出候选 home 与各自的问事记录数，不启动
  --no-open      不自动打开浏览器
  --help         这份说明

环境变量：XUANSHU_DSH_HOME（等价于 --home，优先级低于它）
在 worktree 里跑也会看到主检出的 home（.scratch/worktrees/<名字> 会自动回溯）。

规矩：解析出的 home 等于或位于真实 ~/.dsh 下会被拒绝（玄枢不在真实 DSH home 上起实例）。
`

/**
 * 起实例并返回句柄（`stop()` 会停进程并保留 home）。
 * @param {{repoRoot: string, home: string, log?: (t: string) => void}} input
 */
export async function startServe({ repoRoot, home, log = () => {} }) {
  return startIsolatedInstance({ repoRoot, log, keepHome: true, home })
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  const mainRoot = mainCheckoutRoot(repoRoot)
  const argv = process.argv.slice(2)
  const explicit = argv.includes('--home') ? argv[argv.indexOf('--home') + 1] : undefined
  const noOpen = argv.includes('--no-open')

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
  } else if (argv.includes('--list')) {
    const chosen = (() => {
      try {
        return resolveServeHome({ repoRoot, mainRoot, explicit, env: process.env })
      } catch {
        return undefined
      }
    })()
    for (const row of listCandidateHomes({ repoRoot, mainRoot })) {
      const mark = chosen !== undefined && chosen.home === row.home ? ' ← 这次会用它' : ''
      const state = row.present ? `有 ${String(row.consultRecords)} 条问事记录` : '还没建'
      process.stdout.write(`${row.home}\n  ${row.source}：${state}${mark}\n`)
    }
  } else {
    let resolved
    try {
      resolved = resolveServeHome({ repoRoot, mainRoot, explicit, env: process.env })
    } catch (error) {
      process.stderr.write(`${String(error?.message ?? error)}\n`)
      process.exit(2)
    }
    const hint = credentialsHint({ home: resolved.home })
    process.stderr.write(`[serve] 起实例：home=${resolved.home}（来源：${resolved.source}）\n`)
    if (hint !== undefined) process.stderr.write(`[serve] 注意：${hint}\n`)

    startServe({ repoRoot, home: resolved.home, log: (line) => { process.stderr.write(`[serve] ${line}\n`) } })
      .then((instance) => {
        process.stdout.write(`${serveBanner({ home: instance.home, url: instance.url }).join('\n')}\n\n`)
        process.stdout.write(`  （端口 ${String(instance.port)} 是本次自动挑的，重启会变）\n`)
        if (!noOpen) openUrl(instance.url)
        let stopping = false
        const stop = (signal) => {
          if (stopping) return
          stopping = true
          process.stderr.write(`\n[serve] 收到 ${signal}，正在停实例…\n`)
          void instance.stop().then(() => {
            process.stderr.write('[serve] 已停（home 与记录保留）\n')
            process.exit(0)
          })
        }
        process.on('SIGINT', () => { stop('SIGINT') })
        process.on('SIGTERM', () => { stop('SIGTERM') })
      })
      .catch((error) => {
        process.stderr.write(`起实例失败：${String(error?.message ?? error)}\n`)
        process.exit(1)
      })
  }
}
