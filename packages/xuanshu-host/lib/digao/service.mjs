/**
 * packages/xuanshu-host/lib/digao/service.mjs — 底稿的读写与三个 RPC（票 13 契约 §1）。
 *
 * 文件契约（契约 §1）：
 *   `<dataDir>/digao.md`    正文（人可读；UI 只读展示）
 *   `<dataDir>/digao.json`  元数据，schema `xuanshu/digao@1`
 *
 * 三条硬约束：
 *   1. **纯派生、不可手改**：没有 `digao.write` / `digao.update` / `digao.delete` ——
 *      要改就改源头（谱 / 工作区 / 工作流）。这条不是靠文档约束，是靠**方法不存在**约束；
 *   2. **整文件原子重写**：临时文件 + rename（同票 08 的快照同一套写法），
 *      刷新到一半断电不会留下一份半新半旧的底稿；
 *   3. **降级如实标注**：LLM 不可用/失败 → `digest:'skeleton'` 并在正文头部写明「未提炼」（契约 §4）。
 *
 * 写盘顺序：**先正文后元数据**。`digao.json` 是「这份 md 已经完整写好」的凭据（`digao.status` 用它
 * 报 summary），反过来写会留下一份「有元数据、没正文」的底稿。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolveDataDir } from '../bazi/service.mjs'
import { DIGAO_TASK_TITLE, findDailyTask, scheduleSummary } from '../rikke/daily-tasks.mjs'
import { condenseWithLlm } from './llm.mjs'
import { DIGAO_SCHEMA, buildDigaoMeta, buildSegments, renderDigaoMarkdown } from './skeleton.mjs'
import { collectSources } from './sources.mjs'

/** 正文与元数据的文件名（契约 §1 定值）。 */
export const DIGAO_MD = 'digao.md'
export const DIGAO_JSON = 'digao.json'

export function digaoMarkdownFile(dataDir) {
  return join(dataDir, DIGAO_MD)
}

export function digaoMetaFile(dataDir) {
  return join(dataDir, DIGAO_JSON)
}

/**
 * 读元数据：**schema 不认识就当没有**（契约 §1 的 schema 是迁移锚点，旧版本的元数据不许被当成新底稿）。
 * @returns {object|null}
 */
export function readDigaoMeta(dataDir) {
  try {
    const parsed = JSON.parse(readFileSync(digaoMetaFile(dataDir), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed.schema === DIGAO_SCHEMA ? parsed : null
  } catch {
    return null
  }
}

/** 读正文（读不出来给空串，不给半截）。 */
export function readDigaoMarkdown(dataDir) {
  try {
    return readFileSync(digaoMarkdownFile(dataDir), 'utf8')
  } catch {
    return ''
  }
}

/** 原子写（同目录临时文件 + rename；失败清掉临时文件，绝不留下半份）。 */
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' })
  try {
    renameSync(tmp, file)
  } catch (error) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* 临时文件清不掉不掩盖原错误 */
    }
    throw error
  }
  return file
}

/**
 * 刷新底稿（人点 [立即刷新] 与 daily 定时走同一条路）。
 *
 * @param {{ctx?: object, dataDir: string, now?: Date}} input
 * @returns {Promise<{meta: object, notes: string[]}>}
 */
export async function refreshDigao({ ctx, dataDir, now = new Date() } = {}) {
  const sources = collectSources({ ctx, dataDir })
  const segments = buildSegments({ pu: sources.pu, workspace: sources.workspace, workflow: sources.workflow })

  // LLM 只做「压成一段」这一步（契约 §1）：失败不阻断刷新，只把 digest 标成 skeleton。
  const condensed = await condenseWithLlm(ctx, { segments })
  const digest = condensed.ok ? 'llm' : 'skeleton'
  const generatedAt = now.toISOString()

  const meta = buildDigaoMeta({ segments, digest, generatedAt })
  const markdown = renderDigaoMarkdown({ segments, digest, digestText: condensed.ok ? condensed.text : undefined, generatedAt })

  mkdirSync(dataDir, { recursive: true })
  writeAtomic(digaoMarkdownFile(dataDir), markdown)
  writeAtomic(digaoMetaFile(dataDir), `${JSON.stringify(meta, null, 2)}\n`)

  const notes = [...sources.notes]
  if (!condensed.ok) notes.push(`LLM 未提炼（digest=skeleton）：${condensed.reason}`)
  return { meta, notes }
}

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
      const out = { exists: existsSync(digaoMarkdownFile(dataDir)), meta: readDigaoMeta(dataDir) }
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

    /** 人点 [立即刷新] 走它（写操作：整文件原子重写）。 */
    'digao.refresh': async () => {
      const { meta } = await refreshDigao({ ctx, dataDir })
      return { meta }
    },
  }
}
