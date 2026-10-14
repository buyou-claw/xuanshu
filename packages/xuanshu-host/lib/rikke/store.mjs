/**
 * packages/xuanshu-host/lib/rikke/store.mjs — 日课产物 `<dataDir>/rikke/<YYYY-MM-DD>.json`（票 13 契约 §2）。
 *
 * 「今天是否已生成」**靠这个文件**：`ctx.schedule` 只记 `lastDelivery`/`deliveryHistory`，
 * **没有**「当日打卡」语义（契约 §2 原文 + 事实笔记 §2.4）。所以日课卡的 ready 态 = 这个文件在。
 *
 * 两个必须做对的小地方：
 *   - **日期要当路径用**：文件名来自调用方给的 `date`，必须先过 `^\d{4}-\d{2}-\d{2}$`
 *     （`../` 这种东西一旦进来就是路径穿越）；
 *   - **原子写**：与票 08 的快照同一套（同目录临时文件 + rename），半份 JSON 会让界面
 *     读成 error 而用户以为「今天已经做过了」。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { parseFixedOffsetZone } from '../bazi/timezone.mjs'

/** 日课产物的 schema（契约 §2 定值）。 */
export const RIKKE_SCHEMA = 'xuanshu/rikke@1'

/** 日课目录名（`<dataDir>/rikke/`）。 */
export const RIKKE_DIR = 'rikke'

/** `YYYY-MM-DD` 判定（也是路径安全门）。 */
export function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** `<dataDir>/rikke/<date>.json`；日期非法 → 抛（调用方给的日期本来就该先校验）。 */
export function rikkeFile(dataDir, date) {
  if (!isDate(date)) throw new Error(`日课文件日期非法：${JSON.stringify(date)}（要 YYYY-MM-DD）`)
  return join(dataDir, RIKKE_DIR, `${date}.json`)
}

/**
 * 读一天的日课产物。
 * @returns {{state: 'empty'|'ready'|'error', record: object|null, reason: string|null}}
 */
export function readRikke(dataDir, date) {
  let file
  try {
    file = rikkeFile(dataDir, date)
  } catch (error) {
    return { state: 'error', record: null, reason: String(error?.message ?? error) }
  }
  if (!existsSync(file)) return { state: 'empty', record: null, reason: null }
  let record
  try {
    record = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return { state: 'error', record: null, reason: `日课产物不是合法 JSON（${file}）：${String(error?.message ?? error)}` }
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { state: 'error', record: null, reason: `日课产物不是对象（${file}）` }
  }
  if (record.schema !== RIKKE_SCHEMA) {
    return { state: 'error', record: null, reason: `日课产物 schema 不认识（${file}）：拿到 ${JSON.stringify(record.schema)}，只认 ${RIKKE_SCHEMA}` }
  }
  const content = record.content
  const complete = content && typeof content === 'object' && ['yi', 'ji', 'liuri'].every((key) => typeof content[key] === 'string')
  if (!complete) {
    return { state: 'error', record: null, reason: `日课产物缺 content.{yi,ji,liuri}（${file}）：三键与票 07 的卡逐字对齐，缺一不可。` }
  }
  return { state: 'ready', record, reason: null }
}

/** 原子写一份日课产物；返回落盘路径。 */
export function writeRikke(dataDir, record) {
  const target = rikkeFile(dataDir, record?.date)
  mkdirSync(join(dataDir, RIKKE_DIR), { recursive: true })
  const tmp = `${target}.${process.pid}.${Date.now().toString(36)}.tmp`
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
  return target
}

/**
 * 某个时区（IANA 名**或**固定偏移串，如底座里存的 `+08:00`）里「今天是哪一天」（`Intl`，不联网）。
 * 固定偏移没有 DST 可言，直接按分钟挪；时区名认不出 → 退回 UTC 口径的日期（**不猜**用户的本地时区：
 * 那是宿主的事，而这里拿到的 zone 来自底座快照，正常一定是合法的 IANA 名或固定偏移）。
 */
export function dateInZone(zone, now = new Date()) {
  const fixed = parseFixedOffsetZone(zone)
  if (fixed !== null) return new Date(now.getTime() + fixed * 60_000).toISOString().slice(0, 10)
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
    const get = (type) => parts.find((part) => part.type === type)?.value ?? ''
    const year = get('year')
    const month = get('month')
    const day = get('day')
    if (year !== '' && month !== '' && day !== '') return `${year}-${month}-${day}`
  } catch {
    /* 时区名不合法：落到 UTC */
  }
  return now.toISOString().slice(0, 10)
}

/** 某个时区里的当前小时（0..23，整数；黄历的 `hour` 参数要的就是它）。认不出 → UTC 小时。 */
export function hourInZone(zone, now = new Date()) {
  const fixed = parseFixedOffsetZone(zone)
  if (fixed !== null) return new Date(now.getTime() + fixed * 60_000).getUTCHours()
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', hour12: false }).formatToParts(now)
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '')
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) return hour === 24 ? 0 : hour
  } catch {
    /* 时区名不合法：落到 UTC */
  }
  return now.getUTCHours()
}
