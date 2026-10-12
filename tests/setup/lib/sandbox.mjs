/**
 * tests/setup/lib/sandbox.mjs — 每个用例一个**一次性沙箱目录**。
 *
 * 硬约束（票 05 任务书「环境事实」）：
 *   - 绝不允许触碰真实 `C:\Users\Administrator\.dsh` 或 `C:\horosa`；
 *   - 绝不允许读那份 719MB 的真实 runtime 归档；
 *   - 临时产物一律落在 `tests/setup/.tmp/**`（.gitignore 已覆盖 `tests/**​/.tmp/`）。
 *
 * 每个用例拿一个自己的沙箱（cache / dsh-home / runtime-root / state / work 五件套全在里面），
 * 这样「第二次跑零下载」「runtime 根下没有新文件」「真 home 零写入」这类断言不会被别的用例的残留污染。
 *
 * 沙箱跑完**保留现场**（红了要能复盘；绿了也便宜），但每次开跑先清掉**上一批**（> 6 小时）的，
 * 免得 `.tmp/` 无限长大。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { TMP_ROOT } from './paths.mjs'

/** 上一次运行留下的沙箱超过这个岁数就删（当次运行的现场一律保留）。 */
const STALE_MS = 6 * 60 * 60 * 1000

function pruneStale() {
  if (!existsSync(TMP_ROOT)) return
  const now = Date.now()
  for (const entry of readdirSync(TMP_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = join(TMP_ROOT, entry.name)
    try {
      if (now - statSync(full).mtimeMs < STALE_MS) continue
      rmSync(full, { recursive: true, force: true })
    } catch {
      /* Windows 上偶发 EBUSY：临时区是 gitignore 的，留着无害 */
    }
  }
}

/**
 * 造一个沙箱并返回它的标准路径。
 * @param {string} label 用例名（只用于肉眼分辨 `.tmp/` 下的目录）
 */
export function makeSandbox(label) {
  mkdirSync(TMP_ROOT, { recursive: true })
  pruneStale()
  const root = mkdtempSync(join(TMP_ROOT, `${label}-`))
  const sandbox = {
    root,
    cache: join(root, 'cache'),
    home: join(root, 'dsh-home'),
    runtimeRoot: join(root, 'runtime-root'),
    state: join(root, 'state'),
    work: join(root, 'work'),
    dir: (name) => join(root, name),
  }
  for (const dir of [sandbox.cache, sandbox.home, sandbox.runtimeRoot, sandbox.state, sandbox.work]) {
    mkdirSync(dir, { recursive: true })
  }
  return sandbox
}

/** 递归列出目录下所有**文件**（相对路径，posix 分隔符），目录不存在 → 空数组。 */
export function listFiles(dir, { base = dir } = {}) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full, { base }))
    else out.push(full.slice(base.length + 1).split('\\').join('/'))
  }
  return out.sort()
}
