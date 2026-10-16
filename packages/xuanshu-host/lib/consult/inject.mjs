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
import { createBestofStore, currentAdoptedMessageIds } from './bestof-store.mjs'
import { buildConsultContext, buildMountDeltaContext, sourceMarkMount } from './context.mjs'
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
 * 一条挂载 / 交付账条目在旁挂清单里的键。
 *
 * 导出给边界用（`boundary.mjs` 盖章时要知道「这次这条消息承载了哪几层」）——两处各抄一遍
 * `kind:id` 的拼法必然漂移。
 */
export function mountLedgerKey(entry) {
  return `${entry?.kind ?? ''}:${entry?.id ?? ''}`
}

/**
 * 建一个「这场问事的上下文」装配器（同一份实现给 consult / bestof / 发问边界用）。
 *
 * @param {object} ctx cordis 宿主上下文
 * @param {{dataDir?: string, mountBudget?: number}} [config]
 * @returns {{dataDir: string, buildInjection: Function, buildMountDelta: Function, buildHistory: Function}}
 */
export function createContextAssembly(ctx, config = {}) {
  const dataDir = resolveDataDir(ctx, config)
  const basePu = async () => createBaziMethods(ctx, { dataDir })['bazi.basePu']()
  const readPu = async (slug) => createPuMethods(ctx, { dataDir })['pu.read']({ slug })
  /** 合参旁挂记录（候选历史要靠它判「哪一份采用稿还算数」；复核 N4）。 */
  const bestofStore = createBestofStore(dataDir)

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

  /**
   * 挂载预览 → 「内容真的进了这段文本」的那些层的交付账条目（+ 需要**本次回执**的层）。
   *
   * 条目里带 `head`：它是注入文本里那段 `【来源：挂载 <head>】` 标记的主体，
   * 也是**老条目**（没有 `receipt`）与日志对账的唯一凭据（复核 48e0e0a 的 N3：账不能自己说了算）。
   *
   * 「交付」的两种：`kept`（内容纳入了）与**有 hint 的空层**（工作流：按设计没有内容，
   * 但那一句「还没接上」确实并进了模型输入）。读不出来的层（`error`）**不算** —— 下一问再试（R4）。
   *
   * **为什么还要 `receiptKeys`（复核 32216d9 的 R5）**：`【来源：挂载 <head>】` 只由 head 决定，
   * 所以同一层**重新挂载**时，日志里第一次挂载留下的旧标记会冒充本次投递的回执 ——
   * 新版工作区内容于是永不补投。判据：这次要投的那条标记**已经在日志里**（同一 head 早先交付过、
   * 或另一个同 head 的层交付过）⇒ 旧标记不能自证，这一层要一条**本次交付回执**（承载它的消息 id，
   * 由边界盖章）。标记还没在日志里的（首次交付、上次没落日志的重试）不需要回执：标记本身就是凭据。
   *
   * @param {object|undefined} preview `buildMountPreview()` 的产物
   * @param {readonly object[]} candidates 这次要投的层（`pending`）
   * @param {{loggedMarkers?: Set<string>}} [options] 会话日志里出现过的挂载标记
   * @returns {{entries: Array<object>, receiptKeys: string[]}}
   */
  function deliveredFromPreview(preview, candidates, { loggedMarkers = new Set() } = {}) {
    const deliveredLayers = (preview?.layers ?? []).filter((layer) => layer.kept === true
      || (typeof layer.hint === 'string' && layer.hint !== '' && layer.error === undefined))
    const entries = []
    const receiptKeys = []
    for (const mount of candidates) {
      const layer = deliveredLayers.find((entry) => entry.id === `${mount.kind}:${mount.id}`)
      if (layer === undefined) continue
      const head = typeof layer.head === 'string' && layer.head !== '' ? layer.head : undefined
      const entry = {
        kind: mount.kind,
        id: mount.id,
        label: mount.label,
        ...(head === undefined ? {} : { head }),
      }
      // 给不出标记（老形态 / 空 head）或标记已经在日志里：旧凭据不算数，这次交付要新回执。
      if (head === undefined || loggedMarkers.has(sourceMarkMount(head))) receiptKeys.push(mountLedgerKey(entry))
      entries.push(entry)
    }
    return { entries, receiptKeys }
  }

  /** 一条交付账条目在注入文本里的标记（没有 head 的老条目给不出标记 → 只能当「没交付」重投一次）。 */
  function markerOf(entry) {
    return typeof entry?.head === 'string' && entry.head !== '' ? sourceMarkMount(entry.head) : null
  }

  /**
   * 「这一层的**本次交付**真的落进日志了吗」。
   *
   * - 条目带 `receipt`（本次交付那条消息的 id）⇒ **只看日志里有没有这条消息**：同一层的旧标记
   *   不再能冒充本次回执（R5 的重挂反例）；
   * - 老条目（没有 `receipt`）⇒ 按现状：`【来源：挂载 <head>】` 标记在日志里就算交付过
   *   （向后兼容，不许因此让每问重投）。
   */
  function deliveryConfirmed(entry, { loggedMarkers, loggedReceipts }) {
    if (typeof entry?.receipt === 'string' && entry.receipt !== '') return loggedReceipts.has(entry.receipt)
    const marker = markerOf(entry)
    return marker !== null && loggedMarkers.has(marker)
  }

  /** 「这一层的撤下声明真的落进日志了吗」——靠撤下那条消息的 id（`withdrawal`）与日志对账。 */
  function withdrawalConfirmed(entry, { loggedReceipts }) {
    return typeof entry?.withdrawal === 'string' && entry.withdrawal !== '' && loggedReceipts.has(entry.withdrawal)
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
   * @param {object} manifest 旁挂清单
   * @param {{loggedMarkers?: Set<string>}} [options] 会话日志里出现过的挂载标记
   * @returns {Promise<{text: string, mountsInjected: Array<object>|null, receiptKeys: string[]}>}
   *          `mountsInjected` 非 null 时 = 这段文本之后「内容已经交给模型」的完整挂载清单（待落盘）；
   *          `receiptKeys` = 其中需要**本次交付回执**的层（旧标记不能自证的那些，见 `deliveredFromPreview`）。
   */
  async function buildInjection(manifest, { loggedMarkers = new Set() } = {}) {
    const material = await readMaterial(manifest)
    const mounts = (manifest.mounts ?? []).length > 0
      ? await buildMountPreview(ctx, config, manifest.mounts)
      : undefined
    const text = buildConsultContext({ dataDir, ...material, mounts })
    if (mounts === undefined) return { text, mountsInjected: null, receiptKeys: [] }
    const delivered = deliveredFromPreview(mounts, manifest.mounts ?? [], { loggedMarkers })
    return { text, mountsInjected: delivered.entries, receiptKeys: delivered.receiptKeys }
  }

  /**
   * **增量**注入：只补「本次交付凭据不在日志里」的层，以及「已经撤下」的层。
   *
   * 判据是**日志**（`loggedMarkers` / `loggedReceipts`：边界从会话日志里扫出来的
   * `【来源：挂载 …】` 标记集合与 `xuanshu-consult` 消息 id 集合），旁挂清单的 `mountsInjected`
   * 提供「每一层对应的凭据是什么」：
   *   - `pending` = 当前挂载里**本次交付凭据不在日志**的（新增；上次没读出来 ⇒ 重试，R4；
   *     上次的注入在模型准备阶段就失败了、消息根本没落日志，N3；或者——R5——
   *     这一层撤下已确认之后又挂回来，旧一轮的正文标记不能当本次回执，得补投**新版内容**）；
   *   - `removed` = 账里有、当前清单里没有、**且正文确实交付过、撤下声明还没在日志里确认**的
   *     （真有正文在历史里才需要说一句「不再适用」；从没落过日志的不用声明）。
   *     撤下确认前**条目留着**（撤下失败要能在下一问重发）；确认之后才清掉。
   *
   * 为什么不只看账：账是我们自己写的，而「交付」发生在 loop 的 append 里。中间任何一处失败
   * （`prepareRequest` 抛错就是常态路径之一）都会让账走在事实前面 —— 于是那一层**永远**不再重投。
   * 把日志当权威之后，这一类不一致下一问就自愈。
   *
   * `loggedMarkers` / `loggedReceipts` 缺省为空集合：调用方拿不到日志（替身 / 冷会话）时，
   * 账里的层会被当成「还没落日志」重投一次 —— 宁可多投一次，也不许漏。
   *
   * @param {object} manifest 旁挂清单
   * @param {{loggedMarkers?: Set<string>, loggedReceipts?: Set<string>}} [options]
   *        会话日志里出现过的挂载标记 / 注入消息 id
   * @returns {Promise<{text: string, mountsInjected: Array<object>|null,
   *          receiptKeys: string[], withdrawalKeys: string[]}>}
   *          `mountsInjected` 非 null 时 = 这段文本之后该落盘的完整交付账；
   *          `receiptKeys` / `withdrawalKeys` = 本段文本承载的「交付」/「撤下声明」——边界据此盖章
   *          （凭据 = 承载它的那条消息 id）。没有任何变化时 `mountsInjected === null`（不必写盘）。
   */
  async function buildMountDelta(manifest, { loggedMarkers = new Set(), loggedReceipts = new Set() } = {}) {
    const current = Array.isArray(manifest.mounts) ? manifest.mounts : []
    const ledger = Array.isArray(manifest.mountsInjected) ? manifest.mountsInjected : []
    const currentKeys = new Set(current.map(mountLedgerKey))
    const entryOf = (mount) => ledger.find((entry) => mountLedgerKey(entry) === mountLedgerKey(mount))
    const confirmed = (entry) => deliveryConfirmed(entry, { loggedMarkers, loggedReceipts })
    const retracted = (entry) => withdrawalConfirmed(entry, { loggedReceipts })
    const withdrawalPending = (entry) => typeof entry?.withdrawal === 'string' && entry.withdrawal !== ''

    // 当前挂载：本次交付凭据不在日志里（新增 / 没落日志），或者**撤下声明已经发过**
    // （不管落没落日志：撤回过的正文不再算现况，重挂就得重新投一次）⇒ 要补投。
    const pending = current.filter((mount) => {
      const entry = entryOf(mount)
      return entry === undefined || !confirmed(entry) || withdrawalPending(entry)
    })

    // 当前清单之外的条目：撤下已确认 ⇒ 清掉；正文从没交付过 ⇒ 没东西可撤，也清掉；
    // 交付过但撤下声明还没确认 ⇒ **留着**，这一问再说一次（撤下失败下一问重发的依据）。
    const removed = []
    let changed = false
    for (const entry of ledger) {
      if (currentKeys.has(mountLedgerKey(entry))) continue
      if (retracted(entry) || !confirmed(entry)) {
        changed = true
        continue
      }
      removed.push(entry)
    }

    const preview = pending.length > 0 ? await buildMountPreview(ctx, config, pending) : undefined
    const delivered = preview === undefined ? { entries: [], receiptKeys: [] } : deliveredFromPreview(preview, pending, { loggedMarkers })
    const text = buildMountDeltaContext({ preview, removed })

    // 已交付且**没有撤下纪录**的层：账原样留着（老条目没有新字段也照旧 —— 标记在日志里就算交付过）。
    const stillDelivered = []
    for (const mount of current) {
      const entry = entryOf(mount)
      if (entry === undefined || !confirmed(entry) || withdrawalPending(entry)) continue
      stillDelivered.push(entry)
    }

    // 没有可投的层、也没有撤下声明，但**确认状态变了**（撤下已在日志里确认 ⇒ 条目清掉）：
    // 也要把更新后的账交回调用方落盘（文本可以是空串，边界不再注入一个字）。
    if (!changed && delivered.entries.length === 0 && removed.length === 0) {
      return { text: '', mountsInjected: null, receiptKeys: [], withdrawalKeys: [] }
    }
    return {
      text,
      mountsInjected: [...stillDelivered, ...delivered.entries, ...removed],
      receiptKeys: delivered.receiptKeys,
      withdrawalKeys: removed.map(mountLedgerKey),
    }
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
    // 采用稿的**当前性**由旁挂决策判（复核 N4）：日志是追加式的，改选 / 否决都不会删掉旧消息。
    // 判不出来（老记录）时 `currentAdoptedMessageIds` 给 `null` = 不过滤。
    const keepAdoptedIds = currentAdoptedMessageIds(bestofStore.read(sessionId))
    const built = buildCandidateHistory({ messages: projectConsultMessages(snapshot, { keepAdoptedIds }), budget: resolved.budget })
    return built.text === '' ? null : built.text
  }

  return { dataDir, buildInjection, buildMountDelta, buildHistory }
}
