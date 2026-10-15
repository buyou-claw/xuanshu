/**
 * packages/xuanshu-host/lib/consult/inject.mjs — 问事上下文的**读取 + 装配**（单一来源）。
 *
 * 为什么单独一个模块：同一场问事的上下文现在有三个消费方，而它们必须看到**同一份**东西 ——
 *   - `consult.create`：会话建好就灌首轮上下文（见 `service.mjs` 的说明）；
 *   - `consult.send`：挂载变更后补一段增量（票 12）；
 *   - `bestof.run`：N 路候选流的用户消息（票 11）。
 *
 * 各写一份「读底座谱 / 读底稿 / 读勾选谱 / 读挂载」必然漂移，而漂移的症状是安静的那种：
 * 评审实测 —— 合参的候选只拿到一句裸问题，底座谱与底稿一个字符都没带进去，
 * 于是「结合我的信息建议怎么做？」这个问题在合参里**答不出来**（问事里却答得出来）。
 *
 * 读面一条都不新开（与票 10 的纪律一致）：
 *   - 底座谱只走票 08 的 `bazi.basePu`；
 *   - 可选谱只走票 09 的 `pu.read`；
 *   - 底稿就是 `<dataDir>/digao.md` 这个文件（票 13 生产、本模块只探测与注入）；
 *   - 挂载只走票 12 的 `buildMountPreview`（读 + 裁 + 披露的同一条路径）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createBaziMethods, resolveDataDir } from '../bazi/service.mjs'
import { resolveHistoryBudget } from '../mounts/budget.mjs'
import { buildMountPreview } from '../mounts/preview.mjs'
import { createPuMethods } from '../pu/service.mjs'
import { buildConsultContext, buildMountDeltaContext } from './context.mjs'
import { buildCandidateHistory, isSessionNotFound, projectConsultMessages } from './history.mjs'

/** 底稿文件名（契约 §2/§3：`<dataDir>/digao.md`，由票 13 生产，本模块只探测与注入）。 */
export const DIGAO_FILENAME = 'digao.md'

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）。本模块自用。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/**
 * 解析官方 `@deepseek-ai/dsh-llm/message` 的锚点顺序：profile 目录优先（真机就在这里）。
 *
 * 两处都要用它（`consult.*` 的消息工厂、`agent/pre-step` 边界补进来的上下文），
 * 所以收在这里一份 —— 各写一份必然漂移。
 */
export function messageSearchDirs(ctx) {
  const profile = softGet(ctx, 'profileContext')
  return [typeof profile?.dir === 'string' ? profile.dir : null, process.cwd()].filter((dir) => typeof dir === 'string' && dir !== '')
}

/** 底稿路径。 */
export function digaoPath(dataDir) {
  return join(dataDir, DIGAO_FILENAME)
}

/**
 * 读底稿：不存在 → null（**不造空底稿**：`present:false` 才是诚实的答案）。
 * 读不出来（权限/目录）也当没生成 —— 探测面不该因为一个文件读不动就整体报错。
 */
export function readDigao(dataDir) {
  const file = digaoPath(dataDir)
  try {
    if (!existsSync(file)) return null
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * 建一个「这场问事的上下文」装配器（同一份实现给 consult / bestof / 发问边界用）。
 *
 * @param {object} ctx cordis 宿主上下文
 * @param {{dataDir?: string, mountBudget?: number}} [config]
 * @returns {{dataDir: string, buildInjection: (manifest: object) => Promise<string>}}
 */
export function createContextAssembly(ctx, config = {}) {
  const dataDir = resolveDataDir(ctx, config)
  const basePu = async () => createBaziMethods(ctx, { dataDir })['bazi.basePu']()
  const readPu = async (slug) => createPuMethods(ctx, { dataDir })['pu.read']({ slug })

  /** 读材料（底座谱 / 底稿 / 勾选谱）——两个入口共用，免得各读一份。 */
  async function readMaterial(manifest) {
    const read = await basePu()
    const selected = []
    for (const slug of manifest.pus ?? []) {
      try {
        selected.push({ slug, pu: await readPu(slug) })
      } catch (error) {
        // 勾选时在、现在读不到：把原因带进注入文本，而不是静默少一段（见 context.mjs）。
        selected.push({ slug, error: String(error?.message ?? error) })
      }
    }
    return { basePu: read?.pu ?? null, digao: readDigao(dataDir), selected }
  }

  /** 挂载预览 → 「内容真的进了这段文本」的那些层对应的挂载（`kept` 才算交付；R4）。 */
  function deliveredFromPreview(preview, candidates) {
    const kept = new Set((preview?.layers ?? []).filter((layer) => layer.kept === true).map((layer) => layer.id))
    return candidates.filter((mount) => kept.has(`${mount.kind}:${mount.id}`))
  }

  /**
   * **首次**注入：底座谱 → 底稿 → 勾选谱 →（有挂载时）全量挂载段。
   *
   * 为什么是「首次」而不是「每一轮」：`agent/pre-step` 返回的消息会被 loop **原样追加进会话日志**
   * （`dsh-agent-loop/lib/index.js:1061` 在首次尝试时 `append("user/message", …)`）—— 也就是
   * 「模型可见 ⟺ 已落日志」这条不变量的具体形态。所以交付一次就**永久在场**（重启、dispose、
   * 原生 composer 都一样，因为读的是日志），每轮再发一遍只会把同一份大文本重复写进 JSONL。
   * 每一轮要看的是**变化**：那一半在 `buildMountDelta` 里。
   *
   * 边界如实登记：底稿在会话中途刷新（票 13 的定时任务）不会自动重发 —— 材料里给的是**文件路径**，
   * 模型要看最新版自己去读那个文件；要一份新快照就开新会话。
   *
   * @returns {Promise<{text: string, mountsInjected: Array<object>|null}>}
   *          `mountsInjected` 非 null 时 = 这段文本之后「内容已经交给模型」的完整挂载清单（待落盘）。
   */
  async function buildInjection(manifest) {
    const material = await readMaterial(manifest)
    const mounts = (manifest.mounts ?? []).length > 0
      ? await buildMountPreview(ctx, config, manifest.mounts)
      : undefined
    const text = buildConsultContext({ dataDir, ...material, mounts })
    const delivered = mounts === undefined ? null : deliveredFromPreview(mounts, manifest.mounts ?? [])
    return { text, mountsInjected: delivered }
  }

  /**
   * **增量**注入：只补「模型还没见过内容」的层，以及「已经撤下」的层。
   *
   * 判据是旁挂清单的 `mountsInjected`（**逐层**记的「内容已经交给模型」）：
   *   - `pending` = 当前挂载里不在 `mountsInjected` 的（新增，或上次内容没读出来 ⇒ 这一问重试，R4）；
   *   - `removed` = `mountsInjected` 里有、当前清单里没有的（撤下 ⇒ 说一句「不再适用」）。
   *
   * 两者都空 → 返回空文本（这一问不必注入任何东西）。
   *
   * @returns {Promise<{text: string, mountsInjected: Array<object>|null}>}
   */
  async function buildMountDelta(manifest) {
    const current = Array.isArray(manifest.mounts) ? manifest.mounts : []
    const delivered = Array.isArray(manifest.mountsInjected) ? manifest.mountsInjected : []
    const keyOf = (mount) => `${mount?.kind ?? ''}:${mount?.id ?? ''}`
    const currentKeys = new Set(current.map(keyOf))
    const deliveredKeys = new Set(delivered.map(keyOf))
    const pending = current.filter((mount) => !deliveredKeys.has(keyOf(mount)))
    const removed = delivered.filter((mount) => !currentKeys.has(keyOf(mount)))
    if (pending.length === 0 && removed.length === 0) return { text: '', mountsInjected: null }

    const preview = pending.length > 0 ? await buildMountPreview(ctx, config, pending) : undefined
    const text = buildMountDeltaContext({ preview, removed })
    // 交付账：撤下的划掉，读到了内容的补上（没读到的**留在外面** —— 下一问再试）。
    const stillDelivered = delivered.filter((mount) => currentKeys.has(keyOf(mount)))
    return { text, mountsInjected: [...stillDelivered, ...deliveredFromPreview(preview, pending)] }
  }

  /**
   * 这场问事的**文本历史**（给合参候选；S9：窗口按合参模型统一裁 —— 评审 R5）。
   *
   * 返回的是**一段文本**（不是对象）：调用方（`bestof.run`）把它与材料、问题拼成同一条候选消息。
   * 裁剪了几条、按多少字裁 —— 那几句话写在文本里（`buildCandidateHistory`），
   * 模型看得到，回看也看得到：不留「悄悄少了几条」的形状。
   *
   * 三条边界：
   *   - 读不到会话日志（`sessionQuery` 不在场 / 读不动）→ `null`：候选按「没有历史」跑，
   *     **不编一段假的**；
   *   - 会话还没落盘（`SESSION_QUERY_SESSION_NOT_FOUND`）→ 那是「确实还没有历史」，不是错误；
   *   - 算出来是空串（还没有任何消息）→ 也返回 `null`：调用方据此连标题都不加。
   *
   * @returns {Promise<string|null>}
   */
  async function buildHistory(sessionId) {
    const sessionQuery = softGet(ctx, 'sessionQuery')
    if (typeof sessionQuery?.readSession !== 'function') return null
    let snapshot
    try {
      snapshot = await sessionQuery.readSession(sessionId)
    } catch (error) {
      if (!isSessionNotFound(error)) return null
      snapshot = { events: [] }
    }
    const resolved = await resolveHistoryBudget(ctx, config)
    const built = buildCandidateHistory({ messages: projectConsultMessages(snapshot), budget: resolved.budget })
    return built.text === '' ? null : built.text
  }

  return { dataDir, buildInjection, buildMountDelta, buildHistory }
}
