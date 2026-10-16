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
 * 这一层会话**当前**还算数的采用稿消息 id 集合（复核 48e0e0a 的 N4）。
 *
 * 为什么不能只看消息的 `source.kind`：会话日志是**追加式**的，而采用可以**改选**、整轮也可以**否决** ——
 * 先采用 c1、再改选 c2 时两条采用消息都留在日志里；否决之后那一条也不会消失。
 * S9:174（「系统只取 adoptedId 对应的内容」「否决轮次不带任何候选正文」）与 ADR-0010 第 5 条
 * 要的是**当前**那一份，所以必须拿旁挂决策来判。
 *
 * 判据优先用账本 `draftLedger`（跨轮继承：一层会话只留最后一份合参记录，覆盖写）：
 * 从末尾往前找**第一条「其所属轮次没有被否决」的 adopted 条目** —— 采纳与否决都带 `runId`，
 * 所以「否决了这一轮」只抹掉**这一轮**的采用稿（复核 48e0e0a 规格轴指的正是这里：上一轮已采用、
 * 仍在日志里的那一份不该因为这一轮被否决而消失）。账本在、但一条都算不上 → 空集。
 * 没有账本的（老记录 / 还没人拍板）退回当次决策：`rejected` ⇒ 空集；否则取 `deliveries` 里
 * 最后一条 `candidateId === adoptedId` 的 `messageId`。
 *
 * @returns {Set<string>|null} `null` = **判不出来，别过滤**（宁可多带一段历史，也不许误删真采用稿）
 */
export function currentAdoptedMessageIds(record) {
  if (record === null || record === undefined) return null
  const ledger = Array.isArray(record.draftLedger) ? record.draftLedger : []
  const rejectedRuns = new Set(ledger.filter((entry) => entry?.kind === 'rejected').map((entry) => entry.runId))
  for (let index = ledger.length - 1; index >= 0; index -= 1) {
    const entry = ledger[index]
    if (entry?.kind !== 'adopted') continue
    if (typeof entry.messageId !== 'string' || entry.messageId === '') continue
    // 否决是**按轮**的：本轮被否决 ⇒ 本轮那些采用稿都不算；别的轮的照旧算。
    if (entry.runId !== undefined && rejectedRuns.has(entry.runId)) continue
    return new Set([entry.messageId])
  }
  if (ledger.length > 0) return new Set()
  if (record.rejected === true) return new Set()
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
