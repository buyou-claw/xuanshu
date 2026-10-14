/**
 * packages/xuanshu-host/lib/bazi/snapshot.mjs — 八字快照的读写（票 08 契约 §1）。
 *
 * 落点：`<dataDir>/bazi/snapshot.json`，schema `xuanshu/bazi-snapshot@1`。
 *
 * 三个设计点：
 *   1. **写是原子的**（同目录临时文件 + rename）：快照是命盘卡的开关，半写进去的 JSON
 *      会让界面读到 `state:'error'` 而用户以为「我填过了」；
 *   2. **读分三态**（`empty` / `ready` / `error`）：契约 §2 的 `bazi.status` 是三态，
 *      「文件不在」与「文件在但读不出来」必须分开 —— S1 §128 明文：文件缺失 → 空态；
 *      文件存在但解析失败 → 错误态。合成一个 null 就没法在界面上分别处置；
 *   3. **快照必须能点亮命盘卡**才算 ready：schema 对 + `birth` 是对象 + 四柱四键齐。
 *      四柱不全的旧文件按 error 处置，而不是给出一张空盘（半个盘比没有盘更危险）。
 *
 * `basis.trueSolar`：契约 §1 要求它**只能**来自 horosa 信封里的真太阳时。
 * 该版本信封没有结构化字段，`extractTrueSolarTime`（票 06 的接缝库）从 `data.snapshot_text`
 * 的口径行里取出 `真太阳时：<时间戳>`；**取不到就省略该键**，绝不拿经度自己算一个假值
 * （录入层不换算 —— 那是上游引擎的职责，spec §Implementation Decisions 明文）。
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { BAZI_SNAPSHOT_REL, BAZI_SNAPSHOT_SCHEMA } from './constants.mjs'
import { zoneIsDst, zoneOffsetMinutes } from './timezone.mjs'

/** 快照文件绝对路径。 */
export function snapshotFile(dataDir) {
  return join(dataDir, BAZI_SNAPSHOT_REL)
}

/** `'HH:mm:ss'` / `'HH:mm'` → `'HH:mm'`；认不出的原样返回（口径行宁可不美化，也不改写用户输入）。 */
export function hhmm(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? '').trim())
  if (!match) return String(value ?? '').trim()
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

/**
 * 口径块 `basis`（契约 §1）。
 *
 * `clock` = 用户填的**钟表时间**（录入层的唯一时间事实）；`offsetMinutes` / `dst` 由 `Intl`
 * 按出生地时区 + 出生日期算出（历史 DST 才算得对：上海 1990-06-01 = +09:00）。
 * 时区是固定偏移串（`'+08:00'`）时 `dst` 为 null —— 归一后的偏移里没有 DST 可言，不假装知道。
 *
 * `trueSolar` 只在**信封里读得出**时出现（见文件头）；`'HH:mm:ss'` 归一成 `'HH:mm'`，
 * 与命盘卡口径行的另一行 `clock` 同粒度。
 *
 * @param {object} birth - 出生信息（`{date,time,zone,…}`）。
 * @param {{date: string, time: string}|null} [trueSolarTime] - `extractTrueSolarTime` 的结果。
 */
export function buildBasis(birth, trueSolarTime = null) {
  const basis = {
    clock: hhmm(birth.time),
    offsetMinutes: zoneOffsetMinutes(birth.zone, birth.date, birth.time),
    dst: zoneIsDst(birth.zone, birth.date),
  }
  const solar = typeof trueSolarTime?.time === 'string' ? hhmm(trueSolarTime.time) : ''
  if (solar !== '') basis.trueSolar = solar
  return basis
}

/**
 * 组装快照（纯函数，可复现：`generatedAt` 由调用方给，便于断言与重放）。
 * @param {{birth: object, pillars: object, trueSolarTime?: object|null, horosa: {version: string|null, tool: string|null}, generatedAt?: string}} input
 */
export function buildSnapshot({ birth, pillars, trueSolarTime = null, horosa, generatedAt = new Date().toISOString() }) {
  const snapshot = {
    schema: BAZI_SNAPSHOT_SCHEMA,
    generatedAt,
    birth: { ...birth },
    pillars: { year: pillars.year, month: pillars.month, day: pillars.day, hour: pillars.hour },
    basis: buildBasis(birth, trueSolarTime),
    horosa: { version: horosa?.version ?? null, tool: horosa?.tool ?? null },
  }
  // `birth.place` 没给就**省略该键**（不写空串：空地方名比没有地方名更容易被界面当成「填过了」）。
  if (typeof snapshot.birth.place !== 'string' || snapshot.birth.place === '') delete snapshot.birth.place
  return snapshot
}

/** 原子写快照（临时文件 `wx` + rename；失败时清掉临时文件，绝不留下半份）。 */
export function writeSnapshot(dataDir, snapshot) {
  const target = snapshotFile(dataDir)
  mkdirSync(dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.${Date.now().toString(36)}.tmp`
  writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
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
 * 读快照（契约 §2 的三态）。
 * @returns {{state: 'empty'|'ready'|'error', snapshot: object|null, reason: string|null}}
 */
export function readSnapshot(dataDir) {
  const file = snapshotFile(dataDir)
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'empty', snapshot: null, reason: null }
    return { state: 'error', snapshot: null, reason: `快照读不出来（${file}）：${String(error?.message ?? error)}` }
  }

  let snapshot
  try {
    snapshot = JSON.parse(raw)
  } catch (error) {
    return { state: 'error', snapshot: null, reason: `快照不是合法 JSON（${file}）：${String(error?.message ?? error)}` }
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { state: 'error', snapshot: null, reason: `快照不是对象（${file}）：${Array.isArray(snapshot) ? '数组' : typeof snapshot}` }
  }
  if (snapshot.schema !== BAZI_SNAPSHOT_SCHEMA) {
    return { state: 'error', snapshot: null, reason: `快照 schema 不认识（${file}）：拿到 ${JSON.stringify(snapshot.schema)}，只认 ${BAZI_SNAPSHOT_SCHEMA}。` }
  }
  if (!snapshot.birth || typeof snapshot.birth !== 'object' || Array.isArray(snapshot.birth)) {
    return { state: 'error', snapshot: null, reason: `快照缺出生信息块（${file}）：命盘卡读不出「我是谁」。` }
  }
  const pillars = snapshot.pillars
  const complete = pillars && typeof pillars === 'object' && ['year', 'month', 'day', 'hour'].every((slot) => typeof pillars[slot] === 'string' && pillars[slot] !== '')
  if (!complete) {
    return { state: 'error', snapshot: null, reason: `快照四柱不全（${file}）：四柱读不出来就不该点亮命盘卡。` }
  }
  return { state: 'ready', snapshot, reason: null }
}
