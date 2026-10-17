/**
 * packages/xuanshu-host/lib/wansheng/store.mjs — 晚省产物 `<dataDir>/wansheng/<YYYY-MM-DD>.json`（#25 契约 §1）。
 *
 * 「今天/某天有没有晚省」**只看这个文件**（与 `rikke/store.mjs` 同一条纪律：schedule 的
 * `lastDelivery` 只记「进过 inbox」，没有当日打卡语义）。
 *
 * 两件必须做对的小事，照抄日课产物的既有做法：
 *   - **日期当路径用**：先过 `^\d{4}-\d{2}-\d{2}$`（`../` 一进来就是路径穿越）；
 *   - **原子写**（共用 `../atomic.mjs` 的 tmp + rename）：半份 JSON 会被读面当成 error，
 *     用户看到的是「产物消失」而不是「写失败」。
 *
 * 读面纪律（契约 §1「拿不到就省略键，不写 0/false 冒充已知」）：
 *   - schema 不认识 / JSON 坏了 / 不是对象 → `state:'error'` 并给可读理由；
 *   - `facts` 必须是对象（可以是空对象：所有来源都拿不到时，晚省仍是一份诚实的空账）；
 *   - 加性字段（`missed` / `notes`）坏形状不冒充：`missed` 只认 `true`。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { writeAtomic } from '../atomic.mjs'

/** 晚省产物的 schema（契约 §1 定值）。 */
export const WANSHENG_SCHEMA = 'xuanshu/wansheng@1'

/** 晚省目录名（`<dataDir>/wansheng/`）。 */
export const WANSHENG_DIR = 'wansheng'

/** `YYYY-MM-DD` 判定（也是路径安全门）。 */
export function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
}

/** `<dataDir>/wansheng/<date>.json`；日期非法 → 抛。 */
export function wanshengFile(dataDir, date) {
  if (!isDate(date)) throw new Error(`晚省文件日期非法：${JSON.stringify(date)}（要 YYYY-MM-DD）`)
  return join(dataDir, WANSHENG_DIR, `${date}.json`)
}

/**
 * 读一天的晚省产物。
 * @param {string} dataDir
 * @param {string} date
 * @returns {{state: 'empty'|'ready'|'error', record: object|null, reason: string|null}}
 */
export function readWansheng(dataDir, date) {
  let file
  try {
    file = wanshengFile(dataDir, date)
  } catch (error) {
    return { state: 'error', record: null, reason: String(error?.message ?? error) }
  }
  if (!existsSync(file)) return { state: 'empty', record: null, reason: null }
  let record
  try {
    record = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return { state: 'error', record: null, reason: `晚省产物不是合法 JSON（${file}）：${String(error?.message ?? error)}` }
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { state: 'error', record: null, reason: `晚省产物不是对象（${file}）` }
  }
  if (record.schema !== WANSHENG_SCHEMA) {
    return {
      state: 'error',
      record: null,
      reason: `晚省产物 schema 不认识（${file}）：拿到 ${JSON.stringify(record.schema)}，只认 ${WANSHENG_SCHEMA}`,
    }
  }
  if (record.date !== date) {
    return { state: 'error', record: null, reason: `晚省产物的 date 与文件名不符（${file}）：拿到 ${JSON.stringify(record.date)}` }
  }
  if (record.facts === null || typeof record.facts !== 'object' || Array.isArray(record.facts)) {
    return { state: 'error', record: null, reason: `晚省产物缺 facts 对象（${file}）：事实就是这份产物的全部内容，缺了不可读。` }
  }
  return { state: 'ready', record, reason: null }
}

/** 原子写一份晚省产物；返回落盘路径。 */
export function writeWansheng(dataDir, record) {
  const target = wanshengFile(dataDir, record?.date)
  return writeAtomic(target, `${JSON.stringify(record, null, 2)}\n`)
}

/**
 * 组一份晚省产物（唯一形状）。
 * @param {{date: string, zone: string, at: Date, facts: object, notes?: string[], missed?: boolean}} input
 * @returns {object}
 */
export function buildWanshengRecord({ date, zone, at, facts, notes = [], missed = false }) {
  return {
    schema: WANSHENG_SCHEMA,
    date,
    generatedAt: (at instanceof Date ? at : new Date(at)).toISOString(),
    zone,
    missed: missed === true,
    facts,
    notes: Array.isArray(notes) ? notes : [],
  }
}
