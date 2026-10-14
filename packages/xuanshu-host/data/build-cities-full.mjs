#!/usr/bin/env node
/**
 * build-cities-full.mjs — 生成 `<包>/data/cities-full.json`（票 08 契约 §5 的城市**大库**）。
 *
 * 大库是宿主侧懒加载件：客户端小库（`packages/xuanshu-client/src/client/cities.ts`，约 100 条）
 * 解决「打开向导就能搜」，大库解决「我的出生地不在那 100 条里」。所以大库的两条硬指标是
 * **覆盖率**（中文行政区划要全）与**体积**（提交物 ≤ 1.5 MB，契约 §5 写死）——
 * 上游原始库 3.89 MB / 49 981 条，整份搬进来是 4.76 MB，直接超标三倍。
 *
 * 裁剪规则（确定性，只看源字段，不看时间/随机）：
 *   源里其实是**两套库拼在一起**（这一点决定了规则怎么定）：
 *     ① 中文行政区划库：`r` 是中文行政区名（中华人民共和国/广东省/东莞市…），
 *        `n` 是中文名、`p` 是空格分隔拼音、`e` 恒为空的行政区划数据；
 *     ② 世界城市库：`r` 是 ISO 国家码（CN/US/JP…），`n` 多为英文名，只有**全局前 ~400 条**
 *        （纽约/洛杉矶/东京/巴黎…按城市规模降序）带中文名与拼音。
 *   规则：
 *     A. **全收 ①**（中文行政区划，3 606 条）：这是中文用户出生地搜索的主力，一条都不裁；
 *     B. **全收 ②里有中文名的条目**（396 条）：世界主要城市，中文名 + 拼音可搜；
 *     C. ②里其余（英文名、`p` 为空）：**每个 ISO 国家码保留源序前 PER_REGION 条**。
 *        依据是源的排序：同国内按城市规模降序（已逐国核对：US 前八 = 纽约/洛杉矶/布鲁克林/
 *        芝加哥/皇后区/休斯敦/菲尼克斯/费城；JP 前八 = 东京/横滨/大阪/名古屋/札幌/福冈/川崎/神户；
 *        CN 前八 = 上海/北京/深圳/广州/成都/天津/武汉/东莞），所以「前 N 条」= 该国最主要的 N 个城市。
 *        PER_REGION 是**拍死的常量**（不是「算到塞满为止」）：规则可复现、产物可 diff，
 *        体积由下面的断言兜底 —— 超标就构建失败，而不是悄悄多塞几座城。
 *
 * 字段映射（契约 §2 的 `City`）：`{n,e,r,p,y,x}` → `{ name, region, en?, pinyin, lat, lon }`。
 *   - `en` 空串 → **省略该键**（`City.en` 本来就是可选）；
 *   - `pinyin` 空串**保留空串**（不从英文名编一个拼音出来：`City.pinyin` 是必填文本，
 *     但搜索是 name/en/pinyin 三字段并查的，英文城市的英文名走的正是 `name`/`en` 两路）；
 *   - `lat`/`lon` 直接取 `y`/`x`，**不改精度**（源已 ≤5 位小数，约 1 m 级，足够 tz-lookup
 *     与真太阳时的经度校正）。
 *
 * 用法：
 *   node packages/xuanshu-host/data/build-cities-full.mjs            # 生成（覆盖写入）
 *   node packages/xuanshu-host/data/build-cities-full.mjs --check    # 只比对：产物与重建是否逐字节一致
 *   node packages/xuanshu-host/data/build-cities-full.mjs --source <path>
 *
 * 来源与许可见同目录 `README.md`（上游 astrostudyui 为 AGPL-3.0-only，与玄枢同许可）。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUTPUT = join(HERE, 'cities-full.json')

/** 每个 ISO 国家码保留的英文条目数（规则 C；常量 = 可复现，见文件头）。 */
const PER_REGION = 16
/** 提交体积上限（契约 §5：≤ 1.5 MB）。1.5 × 1024 × 1024 —— 按二进制 MB 判，比按十进制更严。 */
const MAX_BYTES = 1.5 * 1024 * 1024

/** 含汉字判定（源里「有中文名」= 名字或行政区名里有 CJK 表意文字）。 */
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** 上游 `citiesFull.json` 在克隆树里的相对位置（克隆目录名带 commit 短哈希，故按前缀找）。 */
const UPSTREAM_REL = 'horosa-web-app-windows/local/workspace'
const UPSTREAM_TAIL = 'astrostudyui/src/data/citiesFull.json'

/**
 * 找仓内 `.upstream/` 下的源库：从本文件所在目录**逐级向上**找第一个带 `.upstream/` 的祖先。
 *
 * 为什么不写死相对层数：本文件在两种布局下都要能跑 —— 主检出（`<repo>/packages/xuanshu-host/data`）
 * 与 git worktree（`<repo>/.scratch/worktrees/<name>/packages/xuanshu-host/data`）。向上找 `.upstream/`
 * 两种布局都对，而且 worktree 里跑也命中主检出的那一份（`.upstream/` 不入库，只在盘上有一份）。
 * @returns 源库绝对路径；找不到返回 null（调用方报错并提示 `--source`）
 */
function findBundledSource() {
  let dir = HERE
  for (;;) {
    const workspace = join(dir, '.upstream', UPSTREAM_REL)
    if (existsSync(workspace)) {
      const clones = readdirSync(workspace, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('Horosa-Web-'))
        .map((entry) => entry.name)
        .sort()
      for (const clone of clones) {
        const candidate = join(workspace, clone, UPSTREAM_TAIL)
        if (existsSync(candidate)) return candidate
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** 源库的解析顺序：`$XUANSHU_UPSTREAM_CITIES` → 仓内 `.upstream/` 自动定位。 */
function defaultSource() {
  const fromEnv = String(process.env.XUANSHU_UPSTREAM_CITIES ?? '').trim()
  return fromEnv !== '' ? resolve(fromEnv) : findBundledSource()
}

function parseArgs(argv) {
  const opts = { source: defaultSource(), check: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--source') opts.source = resolve(argv[++i] ?? '')
    else if (arg === '--check') opts.check = true
    else if (arg === '-h' || arg === '--help') {
      process.stdout.write(`${readFileSync(fileURLToPath(import.meta.url), 'utf8').slice(3, readFileSync(fileURLToPath(import.meta.url), 'utf8').indexOf('*/'))}\n`)
      process.exit(0)
    } else throw new Error(`unknown argument: ${arg}`)
  }
  if (!opts.source) throw new Error('--source needs a path')
  return opts
}

/** 一行 `City`（键序固定：name/region/en/pinyin/lat/lon —— 产物可 diff）。 */
function toCity(row) {
  const city = { name: String(row.n ?? '').trim(), region: String(row.r ?? '').trim() }
  const en = String(row.e ?? '').trim()
  if (en !== '') city.en = en
  city.pinyin = String(row.p ?? '').trim()
  city.lat = row.y
  city.lon = row.x
  return city
}

/** 裁剪 + 转换（纯函数：同一份源永远得到同一份结果）。 */
export function buildCitiesFull(rows) {
  if (!Array.isArray(rows)) throw new Error('源不是数组：期望上游 citiesFull.json 的条目数组')
  const kept = []
  const perRegion = new Map()
  const stats = { chineseRegion: 0, chineseName: 0, topPerRegion: 0 }
  for (const row of rows) {
    const region = String(row?.r ?? '')
    if (HAN.test(region)) {
      kept.push(row) // A：中文行政区划库全收
      stats.chineseRegion += 1
      continue
    }
    if (HAN.test(String(row?.n ?? ''))) {
      kept.push(row) // B：世界主要城市（源里的前 ~400 条带中文名）
      stats.chineseName += 1
      continue
    }
    const used = perRegion.get(region) ?? 0
    if (used < PER_REGION) {
      kept.push(row) // C：每国前 PER_REGION 条
      perRegion.set(region, used + 1)
      stats.topPerRegion += 1
    }
  }
  return { cities: kept.map(toCity), stats }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.source === null || opts.source === undefined || opts.source === '') {
    throw new Error('找不到上游 citiesFull.json：给 `--source <path>`，或设 `$XUANSHU_UPSTREAM_CITIES`。')
  }
  if (!existsSync(opts.source)) {
    throw new Error(`源库不在盘上：${opts.source}\n（.upstream/ 不入库；换机器时用 --source 指一份上游 citiesFull.json）`)
  }
  const { cities, stats } = buildCitiesFull(JSON.parse(readFileSync(opts.source, 'utf8')))
  const text = `${JSON.stringify(cities)}\n`
  const bytes = Buffer.byteLength(text)

  if (bytes > MAX_BYTES) {
    throw new Error(`大库超标：${bytes} 字节 > ${MAX_BYTES}（契约 §5 上限 1.5 MB）。往下调 PER_REGION（现 ${PER_REGION}）再生成。`)
  }

  if (opts.check) {
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : null
    const same = current === text
    process.stdout.write(
      `${same ? '✓' : '✗'} ${OUTPUT}\n  重建 ${cities.length} 条 / ${bytes} 字节，产物 ${current === null ? '缺失' : `${Buffer.byteLength(current)} 字节`}${same ? '（逐字节一致）' : '（**不一致**，重跑不带 --check 重写）'}\n`,
    )
    process.exit(same ? 0 : 1)
  }

  mkdirSync(HERE, { recursive: true })
  writeFileSync(OUTPUT, text)
  process.stdout.write(
    `✓ ${OUTPUT}\n  ${cities.length} 条 / ${bytes} 字节（上限 ${MAX_BYTES}，占 ${(bytes / MAX_BYTES * 100).toFixed(1)}%）\n`
    + `  中文行政区划 ${stats.chineseRegion} + 世界带中文名 ${stats.chineseName} + 每国前 ${PER_REGION} 条 ${stats.topPerRegion}\n`,
  )
}

// 直接跑才执行（被 import 时只导出纯函数给断言台用）。
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main()
