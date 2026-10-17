/**
 * packages/xuanshu-host/lib/consult/bestof-store.mjs — 合参记录的旁挂存储（契约 §1，ADR-0010 第 4 条）。
 *
 * 为什么落旁挂文件而不是消息字段：rc.2 **没有** `message.candidates` 字段
 * （ADR-0009 第 7 条 / ADR-0010 第 4 条），而且会话事件 `type` 是闭集、未知事件会让会话打不开。
 * 所以 `bestOf{adoptedId,ranking,judge,costUsd}` 落
 * `<dataDir>/consult/<sessionId>.bestof.json`（schema `xuanshu/bestof@1`）——
 * 与票 10 的旁挂清单同目录、同「一会话一文件 + 原子替换」的写法。
 *
 * 一层会话只保留**最后一次**合参：覆盖写。为什么不做历史队列：S7 回看按「一条采用稿」呈现，
 * 旧轮次的候选正文没有第二个消费方；真需要历史时再按 `runId` 迁移（schema 版本号就是锚点）。
 * 覆盖写**只带账本**：`draftLedger` 里按 `runId` 记着各轮的采用 / 否决，所以「哪几份还算当前采用稿」
 * 跨轮说得清（R2/R3）；上一版没有账本的记录在第一次覆盖前由 `migrateLegacyDecisions` 补一条
 * 「旧轮」条目（R4），迁移幂等。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { consultRoot, isConsultSessionId } from './store.mjs'

/** 记录 schema（契约 §1 冻结；换结构时它就是迁移锚点）。 */
export const BESTOF_SCHEMA = 'xuanshu/bestof@1'

/** 一条记录的旁挂文件路径。 */
export function bestofRecordPath(dataDir, sessionId) {
  return join(consultRoot(dataDir), `${sessionId}.bestof.json`)
}

/** 铸一个 runId（`[A-Za-z0-9-]`，进响应、进文件名索引）。 */
export function newRunId() {
  return `bestof-${randomUUID()}`
}

/** 认不认得出是我们写的记录（schema 认不出就当读不出来，不按今天的字段硬解释）。 */
function normalize(raw, sessionId) {
  if (!raw || typeof raw !== 'object' || raw.schema !== BESTOF_SCHEMA) return null
  if (raw.sessionId !== sessionId || typeof raw.runId !== 'string' || raw.runId === '') return null
  return raw
}

/**
 * 「旧轮」在账本里的稳定哨兵 `runId`（复核 32216d9 的 R4）。
 *
 * 上一版 `xuanshu/bestof@1` 只有 `deliveries / adoptedId / rejected`，没有 `draftLedger` ——
 * 那一轮的采用关系没有 `runId` 可记。迁移时给它一个**常量**（不是随机值）：升级后的每个新轮
 * 都要把它原样继承下去，随机值会让「同一份旧决策」看起来像好几轮。取值不在 `newRunId()` 的
 * `bestof-<uuid>` 形态里，不会与真轮次撞名。
 */
export const BESTOF_LEGACY_RUN_ID = 'legacy'

/**
 * 把一份记录里**可判定的旧决策**折进账本（复核 32216d9 的 R4）：账本已在就用它，否则从
 * 上一版字段（`deliveries` / `adoptedId` / `rejected`）合成一条归属「旧轮」的 adopted 条目。
 *
 * 为什么要在**覆盖写之前**做：一层会话只留最后一份记录（`bestof.run` 覆盖写），没有账本的
 * 上一版记录一旦被新记录盖掉，旧轮的采用关系就再也说不清了 —— 于是新轮次的候选历史里
 * 「旧采用稿」重新混进来（R4 的第二个新轮次）。
 *
 * **幂等**：账本已经是数组就**原样返回**，不再对照 `deliveries` 追加 —— 所以同一个旧记录
 * 连续迁移两次、或一份已经带上哨兵条目的记录再迁移，都不会多出条目。
 *
 * 判不出采用的旧决策分两种，处置**不同**（复核 32216d9 追加复核的 SP-2）：
 *   - `rejected === true` ⇒ 合成一条 `{kind:'rejected', runId: 哨兵}`。这一轮**明确没有**采用稿，
 *     「有账本 + 该轮最后决定是否决」⇒ 空集；不合成的话账本会空 ⇒ 覆盖写之后消费方退回「不过滤」，
 *     下一轮就把这一轮曾采用过、如今已被否决的旧稿重新混进候选历史（与 R4 同形，形状换成 rejected）；
 *   - `adoptedId` 有值但在 `deliveries` 里找不到对应投递 ⇒ 也合成 `rejected` 哨兵（**不是**空账本）：
 *     那一份到底算不算当前稿判不出来，但空账本会让语义**翻转**成「不过滤」（迁移前是过滤掉），
 *     两边都会漏。选「按否决处理」保持与迁移前一致：旧记录里没有可核对的投递凭据时，宁可这一轮不带稿。
 *
 * @param {object|undefined|null} record 上一份记录（`store.read()` 的原样产物）
 * @returns {Array<object>} 迁移后的账本（总是数组；调用方直接拿去写进新记录）
 */
export function migrateLegacyDecisions(record) {
  if (record === null || record === undefined || typeof record !== 'object') return []
  // 账本**存在且非空**才算「已经迁移过」：空数组是「这一版写过账但还没人拍板」的形状，
  // 而它同样会把可判定的老字段（下一版的 `adoptedId`）甩掉 —— 空账本继续走老字段合成（SP-4）。
  if (Array.isArray(record.draftLedger) && record.draftLedger.length > 0) return record.draftLedger
  /** 旧轮的一条结论（归属哨兵轮）：判不出采用时落否决，语义与迁移前一致。 */
  const legacyRejected = () => [{ kind: 'rejected', runId: BESTOF_LEGACY_RUN_ID, at: new Date().toISOString() }]
  // 「这一轮被否决」是可判定的旧决策：落一条哨兵，让消费方认出「这一轮不作数」，旧采用稿不外泄。
  if (record.rejected === true) return legacyRejected()
  const adoptedId = record.adoptedId
  if (typeof adoptedId !== 'string' || adoptedId === '') return []
  const deliveries = Array.isArray(record.deliveries) ? record.deliveries : []
  const last = [...deliveries].reverse().find((entry) => entry?.candidateId === adoptedId)
  if (typeof last?.messageId !== 'string' || last.messageId === '') return legacyRejected()
  return [{ kind: 'adopted', messageId: last.messageId, candidateId: adoptedId, runId: BESTOF_LEGACY_RUN_ID, at: last.at }]
}

/**
 * 这一层会话**当前**还算数的采用稿消息 id 集合（复核 48e0e0a 的 N4；跨轮语义按 32216d9 的 R2/R3 改写）。
 *
 * 为什么不能只看消息的 `source.kind`：会话日志是**追加式**的，而采用可以**改选**、整轮也可以**否决** ——
 * 先采用 c1、再改选 c2 时两条采用消息都留在日志里；否决之后那一条也不会消失。
 * S9:174（「系统只取 adoptedId 对应的内容」「否决轮次不带任何候选正文」）与 ADR-0010 第 5 条
 * 要的是**当前**那一份，所以必须拿旁挂决策来判。
 *
 * 判据优先用账本 `draftLedger`（跨轮继承：一层会话只留最后一份合参记录，覆盖写）：
 * **按 `runId` 分组，每组只看最后一个决定**（R3：同轮 c1 → reject → c2 该返回 c2；
 * 「曾经被否决」不等于「这轮不作数」）—— 末条是 adopted ⇒ 记该轮采用的 `messageId`；末条是 rejected
 * ⇒ 该轮不作数。各轮的结论**并集**就是当前采用稿集合（R2：两轮各采用一份 ⇒ 两份都算数，
 * 而不是只留最后那一份）。S9:77 与 S9:174 要的都是「每轮 adoptedId 那一份」。
 *
 * 账本非空但一条 adopted 都算不出来 ⇒ **空集**（真的一条有效采用都没有，该过滤）。
 * 账本缺失或**长度为零**（老记录 / 还没人拍板）⇒ 退回当次决策（老语义，不丢）：
 * `rejected === true` ⇒ 空集；否则取 `deliveries` 里最后一条 `candidateId === adoptedId` 的
 * `messageId`；`adoptedId` 为空（还没拍板）或找不到对应投递 ⇒ `null`。
 * **注意**：这条 fallback 只对「长度为零的账本」成立 —— 账本非空时不回退老字段。
 *
 * @returns {Set<string>|null} `null` = **判不出来，别过滤**（宁可多带一段历史，也不许误删真采用稿）
 */
export function currentAdoptedMessageIds(record) {
  if (record === null || record === undefined) return null
  const ledger = Array.isArray(record.draftLedger) ? record.draftLedger : []
  if (ledger.length > 0) {
    /** @type {Map<string, {kind: string, messageId?: string}>} 每轮**最后**一个决定。 */
    const lastDecisionOfRun = new Map()
    let keyless = 0
    for (const entry of ledger) {
      if (entry === null || typeof entry !== 'object') continue
      if (entry.kind !== 'adopted' && entry.kind !== 'rejected') continue
      // 没有 runId 的条目（外来 / 手工记录；本仓写账一律带 `record.runId`）**各自成轮**：
      // 一律并进同一组会让后一条把前一条顶掉，等于静默丢一份采用稿 —— 正是 R2 要修的方向（SP-3）。
      const key = typeof entry.runId === 'string' && entry.runId !== '' ? entry.runId : `\u0000keyless-${keyless++}`
      lastDecisionOfRun.set(key, entry)
    }
    const kept = new Set()
    for (const entry of lastDecisionOfRun.values()) {
      if (entry.kind !== 'adopted') continue
      if (typeof entry.messageId !== 'string' || entry.messageId === '') continue
      kept.add(entry.messageId)
    }
    return kept
  }
  // 账本**长度为零**才走老记录的当次决策 —— 非空账本不回退老字段（有账本说明这一版写过账，
  // 此时再信互相矛盾的老字段只会把已改选 / 已否决的那份放回来）。
  if (record.rejected === true) return new Set()
  // 还没拍板（`adoptedId` 空）：判不出来 → 不过滤。空账本 + 老字段的形态也落在这里。
  if (typeof record.adoptedId !== 'string' || record.adoptedId === '') return null
  // 老记录退回 `deliveries`：它只装**这一份记录（= 一轮）**的投递，所以 `candidateId`（`c1` / `c2`）
  // 在这一份记录里没有歧义 —— 跨轮要靠账本（账本按 messageId 记，不靠 candidateId）。
  const deliveries = Array.isArray(record.deliveries) ? record.deliveries : []
  const last = [...deliveries].reverse().find((entry) => entry?.candidateId === record.adoptedId)
  return typeof last?.messageId === 'string' && last.messageId !== '' ? new Set([last.messageId]) : null
}

export function createBestofStore(dataDir) {
  const dir = consultRoot(dataDir)
  const fileOf = (sessionId) => bestofRecordPath(dataDir, sessionId)

  /** 读一个会话的最后一次合参记录；没有 / 读不出来 / schema 不符 → null。 */
  function read(sessionId) {
    if (!isConsultSessionId(sessionId)) return null
    let text
    try {
      text = readFileSync(fileOf(sessionId), 'utf8')
    } catch {
      return null
    }
    try {
      return normalize(JSON.parse(text), sessionId)
    } catch {
      return null
    }
  }

  /** 原子写（同目录临时文件 + rename）：半个 JSON 的记录比没有记录更坏。 */
  function write(record) {
    mkdirSync(dir, { recursive: true })
    const target = fileOf(record.sessionId)
    const tmp = join(dir, `.${record.sessionId}.bestof.${process.pid}.${randomUUID()}.tmp`)
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    try {
      renameSync(tmp, target)
    } catch (error) {
      try {
        rmSync(tmp, { force: true })
      } catch {
        /* 临时文件清不掉不掩盖原错误 */
      }
      throw error
    }
    return record
  }

  /**
   * 按 runId 找记录：进程活着时由调用方的内存表兜住，这里负责**进程重启之后**的冷查
   * （`bestof.state` 的回看语义：刷新页面还能把上一轮读回来）。
   */
  function findByRunId(runId) {
    if (typeof runId !== 'string' || runId === '' || !existsSync(dir)) return null
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.bestof.json')) continue
      const sessionId = entry.name.slice(0, -'.bestof.json'.length)
      const record = read(sessionId)
      if (record !== null && record.runId === runId) return record
    }
    return null
  }

  return { root: dir, fileOf, read, write, findByRunId }
}
