/**
 * tests/rikke/lib/sandbox.mjs — 日课断言台的外界替身。
 *
 * 共用件直接复用 `tests/digao/lib/sandbox.mjs`（沙箱、假 ctx、假 schedule/agents/llm、假 horosa），
 * 这里只补日课特有的两样：**真机黄历信封 fixture** 与**底座快照**（日课要读它拿时区）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildSnapshot, writeSnapshot } from '../../../packages/xuanshu-host/lib/bazi/snapshot.mjs'

export * from '../../digao/lib/sandbox.mjs'

/** 日课信封 fixture（真机捕获的裁剪件；见同目录 PROVENANCE.md）。 */
export const RIKKE_ENVELOPES = join(import.meta.dirname, '..', 'fixtures', 'envelopes')

/** 读一份黄历信封 fixture。 */
export function huangliFixture(name) {
  return JSON.parse(readFileSync(join(RIKKE_ENVELOPES, `${name}.json`), 'utf8'))
}

/** 契约 §1 的样例出生信息（上海，zone 用 IANA 名 —— 日课的「今天是哪一天」按它算）。 */
export const BIRTH = {
  date: '1990-06-01',
  time: '04:00',
  zone: 'Asia/Shanghai',
  lat: 31.2304,
  lon: 121.4737,
  place: '上海',
  timeAlg: 0,
}

/** 落一份**真的**底座快照（走票 08 的组装函数，不手搓 JSON —— 形状漂了这里就会红）。 */
export function writeBaseSnapshot(dataDir, birth = BIRTH, generatedAt = '2026-06-01T00:00:00.000Z') {
  return writeSnapshot(dataDir, buildSnapshot({
    birth,
    pillars: { year: '己巳', month: '丙子', day: '丙寅', hour: '甲午' },
    horosa: { version: '0.40.1', tool: 'bazi_birth' },
    generatedAt,
  }))
}
