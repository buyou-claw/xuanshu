/**
 * packages/xuanshu-host/lib/digao/service.mjs — 底稿的三个 RPC（票 13 契约 §1）。
 *
 * 文件契约（实际读写收在 `store.mjs`）：
 *   `<dataDir>/digao.md`    正文（人可读；UI 只读展示）
 *   `<dataDir>/digao.json`  元数据，schema `xuanshu/digao@1`
 *
 * 三条硬约束：
 *   1. **纯派生、不可手改**：没有 `digao.write` / `digao.update` / `digao.delete` ——
 *      要改就改源头（谱 / 工作区 / 工作流）。这条不是靠文档约束，是靠**方法不存在**约束；
 *   2. **整文件原子重写**：临时文件 + rename（见 `store.mjs`），
 *      刷新到一半断电不会留下一份半新半旧的底稿；
 *   3. **降级如实标注**：LLM 不可用/失败 → `digest:'skeleton'` 并在正文头部写明「未提炼」（契约 §4）。
 *
 * **这一层只有 RPC**（task-3 拆过）：生成链在 `generate.mjs`（`refreshDigao()`，03:30 到点那条也走它）、
 * 文件读写与原子写在 `store.mjs`、两条 daily 任务的身份与 schedule 读面在 `tasks.mjs`（中立叶子）。
 * 拆的理由是解 import 环 —— 完整的解法与不变量写在 `tasks.mjs` 的文件头，结论一句：
 * **`generate.mjs` 不许 import 本文件，本文件也不许 import `rikke/**`**
 * （`DIGAO_TASK_TITLE` / `findDailyTask` / `scheduleSummary` 现在来自 `./tasks.mjs`）。
 */

import { resolveDataDir } from '../bazi/service.mjs'
import { refreshDigao } from './generate.mjs'
import { digaoExists, readDigaoMarkdown, readDigaoMeta } from './store.mjs'
import { DIGAO_TASK_TITLE, findDailyTask, scheduleSummary } from './tasks.mjs'

// 兼容面：这些名字原来定义在本文件里，引用点（测试、外部读面）不用跟着搬。
// 单一来源仍在各自模块（`store.mjs` / `generate.mjs`）—— 这里是同一份绑定的再导出，不是副本。
export {
  DIGAO_JSON, DIGAO_MD, digaoMarkdownFile, digaoMetaFile, readDigaoMarkdown, readDigaoMeta, writeAtomic,
} from './store.mjs'
export { refreshDigao } from './generate.mjs'

/**
 * 建 `digao.*` 方法组（契约 §1 的三个方法；**刻意没有** write/update）。
 * @param {object} ctx cordis 宿主上下文
 * @param {{dataDir?: string}} [config]
 */
export function createDigaoMethods(ctx, config = {}) {
  const dataDir = resolveDataDir(ctx, config)

  /**
   * 底稿那条 daily 任务的摘要（契约修订 2026-10-15：`digao.status` 与 `digao.read` 各多一个可选
   * `schedule`，界面用它显示「下次刷新」）。**拿不到就省略该键** —— 不写 null、不写空串。
   */
  async function scheduleField() {
    return scheduleSummary(await findDailyTask(ctx, DIGAO_TASK_TITLE))
  }

  return {
    /** 底稿在不在 + 元数据（票 07 的底稿卡用它给 state 与 summary）。 */
    'digao.status': async () => {
      const out = { exists: digaoExists(dataDir), meta: readDigaoMeta(dataDir) }
      const schedule = await scheduleField()
      if (schedule !== null) out.schedule = schedule
      return out
    },

    /** 只读全文（只读面板用）。 */
    'digao.read': async () => {
      const out = { markdown: readDigaoMarkdown(dataDir), meta: readDigaoMeta(dataDir) }
      const schedule = await scheduleField()
      if (schedule !== null) out.schedule = schedule
      return out
    },

    /** 人点 [立即刷新] 走它（写操作：整文件原子重写）。与 03:30 定时到点**同一条链**。 */
    'digao.refresh': async () => {
      const { meta } = await refreshDigao({ ctx, dataDir })
      return { meta }
    },
  }
}
