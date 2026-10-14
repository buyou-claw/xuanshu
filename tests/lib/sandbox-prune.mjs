/**
 * tests/lib/sandbox-prune.mjs — 断言台临时沙箱的清理判据（**单一来源**）。
 *
 * 为什么要有这个文件：同一段 `pruneStale()` 曾经在 6 个 `tests/<域>/lib/sandbox.mjs` 里各抄一份，
 * 然后漂移了 —— 其中两处把比较写反：
 *
 *   if (now - mtime < STALE_MS) rmSync(...)   // 注释说「超过这个岁数就删」，代码删的却是**刚建**的
 *
 * 后果不是「清理没生效」这么轻：**刚建的沙箱当场被另一个 worker 删掉**（并发跑时互删现场），
 * 而真正过旧的沙箱永远留着。这条正对着本仓的教训：**判据必须能证否** ——
 * 一段「删过旧的」的代码如果从没在旧件上跑过，它写反了也没人知道。
 *
 * 语义（唯一一份）：
 *   - 只看**目录**（文件不动）；
 *   - `now - mtime >= staleMs` → 删（过旧）；小于 → 留（当次运行的现场保留，便于复盘）；
 *   - 单个目录删不动（Windows 偶发 EBUSY）跳过，不中断整轮清理。
 *
 * @param {string} root 临时区根（各域自己的 `tests/<域>/.tmp`）
 * @param {{staleMs?: number, now?: number}} [options] `now` 只为断言台留（造「很旧」的沙箱）
 * @returns {string[]} 真删掉的目录绝对路径（断言可直接打它，不必再去看文件系统）
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 沙箱的「岁数上限」：6 小时。超过它 = 上一次运行留下的现场。 */
export const SANDBOX_STALE_MS = 6 * 60 * 60 * 1000

export function pruneStaleDirs(root, { staleMs = SANDBOX_STALE_MS, now = Date.now() } = {}) {
  if (!existsSync(root)) return []
  const removed = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = join(root, entry.name)
    try {
      if (now - statSync(full).mtimeMs < staleMs) continue
      rmSync(full, { recursive: true, force: true })
      removed.push(full)
    } catch {
      /* Windows 上偶发 EBUSY：临时区是 gitignore 的，留着无害，下一轮再清 */
    }
  }
  return removed
}
