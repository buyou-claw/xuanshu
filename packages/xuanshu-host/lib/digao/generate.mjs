/**
 * packages/xuanshu-host/lib/digao/generate.mjs —— 底稿的**可执行生成链**（全仓唯一一份）。
 *
 * 为什么把这段从 `service.mjs` 里抽出来：它有两个调用方，而两者必须产出**同一份**产物 ——
 *   1. `digao.refresh`：人点 [立即刷新]（RPC 那条）；
 *   2. 定时任务到点：`rikke/delivery.mjs` 在 `agent/pre-step` 上跑（03:30 那条）。
 *
 * 定时那条原来只把 `DIGAO_PROMPT` 投进会话、**没有任何执行者**：`digao.json` 的 meta
 * （`segments`/`sources`/`bySource`/`digest`）、确定性骨架与 `【来源：…】` 标记、`condenseWithLlm`
 * 的摘要，全是宿主才做得对的事 —— 模型写不出来，产物一个字都不落，而 schedule 那边照样把这次
 * 投递记成「已送达」。分工见契约 §1：**骨架与来源标记 = 确定性函数，LLM 只压一段**。
 *
 * **不许 import `rikke/**`，也不许 import `digao/service.mjs`**（task-3 的解环笔记写在
 * `tasks.mjs` 的文件头）：这两条边任一成立，模块图就会成环
 * （`digao/service → rikke/daily-tasks → rikke/delivery → digao/generate → …`）。
 * 本模块只依赖 `digao/*` 的叶子：`sources` / `llm` / `skeleton` / `store`。
 *
 * 失败口径：**写盘失败照抛**（给调用方）：RPC 那条把它折成 `{ok:false,error}`（写操作不许静默），
 * 到点那条只记日志、不动那一轮。LLM 那一步**从不抛**（`condenseWithLlm` 自己回落 `{ok:false}`），
 * 失败时 `digest:'skeleton'` 并在正文头部如实写「未提炼」（契约 §4）。
 *
 * 写盘顺序：**先正文后元数据**。`digao.json` 是「这份 md 已经完整写好」的凭据（`digao.status` 用它
 * 报 meta），反过来写会留下一份「有元数据、没正文」的底稿。
 *
 * 票 05（#26）追加：**事记扫描挂在这里**（`scanAndUpdateShiji()`，契约 §1 的唯一挂点）。
 * 顺序是「先写 `shiji.jsonl`，再写 digao 两件」——事记是底稿「曾经做过什么」的前提（#27 才渲染），
 * 且定时 03:30 与手动刷新因此共用**同一次**扫描（不各扫一遍）。本票**不改**底稿的渲染输出。
 * 注意：`shiji/ledger.mjs` 是叶子（不 import `digao/service.mjs`、不 import `rikke/**`），
 * 所以这条依赖不会成环。
 */

import { scanAndUpdateShiji } from '../shiji/ledger.mjs'
import { condenseWithLlm } from './llm.mjs'
import { buildDigaoMeta, buildSegments, renderDigaoMarkdown } from './skeleton.mjs'
import { collectSources } from './sources.mjs'
import { digaoMarkdownFile, digaoMetaFile, writeAtomic } from './store.mjs'

/**
 * 刷新底稿（人点 [立即刷新] 与 03:30 定时到点走**同一条路**）。
 *
 * @param {{ctx?: object, dataDir: string, now?: Date}} input
 * @returns {Promise<{meta: object, notes: string[]}>}
 */
export async function refreshDigao({ ctx, dataDir, now = new Date() } = {}) {
  // ① 事记扫描：写 `<dataDir>/shiji.jsonl`（**先于**底稿两件；#27 的「曾经做过什么」读它）。
  //    失败照抛（与写盘同口径）：定时那条折成日志、RPC 那条折成 {ok:false,error}，不静默。
  const shiji = await scanAndUpdateShiji({ ctx, dataDir, now })

  const sources = collectSources({ ctx, dataDir })
  const segments = buildSegments({ pu: sources.pu, workspace: sources.workspace, workflow: sources.workflow })

  // LLM 只做「压成一段」这一步（契约 §1）：失败不阻断刷新，只把 digest 标成 skeleton。
  const condensed = await condenseWithLlm(ctx, { segments })
  const digest = condensed.ok ? 'llm' : 'skeleton'
  const generatedAt = now.toISOString()

  const meta = buildDigaoMeta({ segments, digest, generatedAt })
  const markdown = renderDigaoMarkdown({ segments, digest, digestText: condensed.ok ? condensed.text : undefined, generatedAt })

  writeAtomic(digaoMarkdownFile(dataDir), markdown)
  writeAtomic(digaoMetaFile(dataDir), `${JSON.stringify(meta, null, 2)}\n`)

  const notes = [...sources.notes, ...shiji.notes]
  if (!condensed.ok) notes.push(`LLM 未提炼（digest=skeleton）：${condensed.reason}`)
  return { meta, notes }
}
