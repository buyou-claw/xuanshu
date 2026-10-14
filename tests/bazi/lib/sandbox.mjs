/**
 * tests/bazi/lib/sandbox.mjs — 票 08 断言台的**外界替身**：一次性 dataDir + 假 `xuanshuHorosa` 服务。
 *
 * 硬约束（票 08 契约 §3）：
 *   - **零网络、零真实 horosa**：`bazi.cast` 只被允许走 `ctx.get('xuanshuHorosa')` 的 `baziBirth()`，
 *     所以断言台给的就是一个**普通对象**，它按票 06 已捕获的真实信封（`tests/horosa/fixtures/envelopes/**`）
 *     回放 —— 不 import `lib/horosa/service.mjs`、不起 serve、不开端口；
 *   - 分类走**真实现**（`classifyBaziEnvelope`）：假服务的返回形状照 `baziBirth()`
 *     （`{...classified, pillars: 4 槽数组, fourColumns, payload}`），而不是自己编一个形状对不上的替身；
 *   - 临时产物落 `tests/bazi/.tmp/**`（`.gitignore` 已覆盖 `tests/**​/.tmp/`），绝不碰真实 `~/.dsh`。
 */
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { classifyBaziEnvelope } from '../../../packages/xuanshu-host/lib/horosa/bazi.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 断言台自己的临时区（`tests/bazi/.tmp`，gitignore 覆盖）。 */
export const TMP_ROOT = join(HERE, '..', '.tmp')
/** 票 06 已捕获的真实信封（**唯一**的信封来源，票 08 不新造 fixture）。 */
export const ENVELOPES_DIR = join(HERE, '..', '..', 'horosa', 'fixtures', 'envelopes')
/** 被测包（大库默认位置在其 `data/` 下）。 */
export const HOST_PACKAGE = join(HERE, '..', '..', '..', 'packages', 'xuanshu-host')

/** 上一次运行留下的沙箱超过这个岁数就删（当次运行的现场保留，便于复盘）。 */
const STALE_MS = 6 * 60 * 60 * 1000

function pruneStale() {
  if (!existsSync(TMP_ROOT)) return
  const now = Date.now()
  for (const entry of readdirSync(TMP_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      if (now - statSync(join(TMP_ROOT, entry.name)).mtimeMs < STALE_MS) rmSync(join(TMP_ROOT, entry.name), { recursive: true, force: true })
    } catch {
      /* Windows 上偶发 EBUSY：临时区是 gitignore 的，留着无害 */
    }
  }
}

/** 一个一次性 dataDir（被测实现只允许在这里写盘）。 */
export function makeSandbox(label) {
  mkdirSync(TMP_ROOT, { recursive: true })
  pruneStale()
  const root = mkdtempSync(join(TMP_ROOT, `${label}-`))
  const dataDir = join(root, 'xuanshu')
  mkdirSync(dataDir, { recursive: true })
  return {
    root,
    dataDir,
    /** 仓内相对路径 → 沙箱内绝对路径。 */
    path: (...parts) => join(dataDir, ...parts),
    read(...parts) {
      return readFileSync(join(dataDir, ...parts), 'utf8')
    },
    exists(...parts) {
      return existsSync(join(dataDir, ...parts))
    },
    /** 递归列出沙箱里所有文件（相对 dataDir 的 posix 路径，字典序）——「一个字节都没落盘」的判据。 */
    files() {
      const out = []
      const walk = (dir, prefix) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name)
          const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
          if (entry.isDirectory()) walk(full, rel)
          else out.push(rel)
        }
      }
      if (existsSync(dataDir)) walk(dataDir, '')
      return out.sort()
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** 读一份真实信封 fixture（票 06 的捕获裁剪件）。 */
export function envelope(name) {
  return JSON.parse(readFileSync(join(ENVELOPES_DIR, `${name}.json`), 'utf8'))
}

/**
 * 假 `xuanshuHorosa` 服务：只实现票 08 会用到的 `baziBirth()`，按给定信封回放。
 *
 * 返回形状**照抄** `createHorosaRuntime().baziBirth()`（票 06 service.mjs）：
 * `pillars` 是 4 槽数组 `[年,月,日,时]`、`fourColumns` 是 `{year,month,day,hour}` 对象、`payload` 回显入参。
 * 这个替身存在的意义：`bazi.cast` 的每一条断言都打在「宿主真的按票 06 的口径去调了什么」上。
 *
 * @param {object} envelope 真实信封
 * @returns {{service: object, calls: object[], phases: string[]}}
 */
export function fakeHorosa(envelope) {
  const calls = []
  const phases = []
  const service = {
    async baziBirth(input) {
      calls.push(input)
      const classified = classifyBaziEnvelope(envelope)
      phases.push(classified.phase)
      const fourColumns = classified.pillars
      return {
        ...classified,
        pillars: fourColumns ? [fourColumns.year, fourColumns.month, fourColumns.day, fourColumns.hour] : null,
        fourColumns,
        payload: input,
      }
    },
  }
  return { service, calls, phases }
}

/** horosa 不可得的现场（未装配 / 未 `pnpm setup:xuanshu`）。 */
export function missingHorosa() {
  return { service: undefined, calls: [] }
}

/**
 * 造一个宿主 ctx：`ctx.get(name, false)` 是**唯一**的取服务方式（票 06 的非严格软取同款）。
 * `ctx[name]`（cordis 的属性形态）也一并给，免得实现只认一种形状时测试假绿。
 */
export function makeCtx(services = {}) {
  const ctx = {
    get(name) {
      return services[name]
    },
  }
  for (const [name, value] of Object.entries(services)) if (value !== undefined) ctx[name] = value
  return ctx
}
