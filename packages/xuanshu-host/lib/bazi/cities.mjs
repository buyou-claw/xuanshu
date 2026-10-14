/**
 * packages/xuanshu-host/lib/bazi/cities.mjs — 城市**大库**的懒加载与检索（票 08 契约 §2/§5）。
 *
 * 大库是「小库不够用时的那一层」：客户端自带小库（~100 条）解决首屏，大库（6 792 条）解决
 * 「我的出生地不在这 100 条里」。三条设计约束都来自契约：
 *   1. **懒加载**：首次 `bazi.cities` 才读盘 —— 装配期不读 700KB JSON，也不拖慢 DSH 启动；
 *   2. **任何失败都静默降级**成 `{items: [], source: 'none'}`：大库没装/被删/JSON 坏了，
 *      向导必须还能用（客户端回落到自带小库），所以这里**一次都不抛**；
 *   3. **查找顺序**：`<dataDir>/geo/cities-full.json`（用户自带覆盖）→ 随包分发的
 *      `<包>/data/cities-full.json`（生成方式与来源见 `data/README.md`）。
 *
 * 检索是「粗筛」而不是排序算法：中文名 / 英文名 / 拼音 / 拼音首字母 / 行政区名五路并查，
 * 命中越靠前（精确名 > 名前缀 > 拼音前缀 > 英文前缀 > 包含）排得越前，同档保持库序
 * （库序 = 城市规模序，见 `data/README.md` 的裁剪规则）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CITIES_OVERRIDE_REL, CITY_LIMIT_DEFAULT, CITY_LIMIT_MAX, CITY_SOURCE_FULL, CITY_SOURCE_NONE } from './constants.mjs'

/** 随包分发的大库位置（`<包>/data/cities-full.json`；`lib/bazi/` 往上两级是包根）。 */
export const BUNDLED_CITIES_DIR = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'data')

/** 检索用的归一：NFKC（全角/兼容字）+ 去首尾空白 + 小写。 */
function normalize(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase()
}

/** 空格分隔拼音 → 首字母串（`'shang hai shi'` → `'shs'`；单音节/空串各得其所）。 */
export function pinyinInitials(pinyin) {
  return normalize(pinyin)
    .split(/\s+/)
    .filter((syllable) => syllable !== '')
    .map((syllable) => syllable[0])
    .join('')
}

/**
 * 一条城市与关键词的匹配档位（越小越靠前）；不匹配 → null。
 * 档位顺序就是「用户更可能想要哪一条」：精确同名 > 名前缀 > 拼音/首字母前缀 > 英文/行政区前缀 > 任意包含。
 * @returns {number|null}
 */
function matchTier(city, query) {
  const name = normalize(city?.name)
  const english = normalize(city?.en)
  const pinyin = normalize(city?.pinyin)
  const region = normalize(city?.region)
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (query !== '' && (pinyin.startsWith(query) || pinyinInitials(city?.pinyin).startsWith(query))) return 2
  if (english.startsWith(query) || region.startsWith(query)) return 3
  if (name.includes(query) || pinyin.includes(query) || english.includes(query) || region.includes(query)) return 4
  return null
}

/** limit 归一：整数且 ≥1 才认，否则缺省；上限 `CITY_LIMIT_MAX`（50）。 */
function normalizeLimit(limit) {
  const numeric = typeof limit === 'number' ? limit : Number(String(limit ?? '').trim())
  if (!Number.isInteger(numeric) || numeric < 1) return CITY_LIMIT_DEFAULT
  return Math.min(numeric, CITY_LIMIT_MAX)
}

/**
 * 纯函数检索（可单测；不读盘、不缓存）。
 * @param {object[]} cities `City[]`
 * @param {string} [query] 关键词；空 = 按库序给前 limit 条
 * @param {number} [limit] 条数，缺省 20、上限 50
 * @returns {object[]}
 */
export function matchCities(cities, query, limit) {
  const top = normalizeLimit(limit)
  const keyword = normalize(query)
  if (keyword === '') return cities.slice(0, top)
  const ranked = []
  for (let index = 0; index < cities.length; index += 1) {
    const tier = matchTier(cities[index], keyword)
    if (tier !== null) ranked.push({ tier, index, city: cities[index] })
  }
  // 同档按库序（= 城市规模序）：稳定排序，结果可复现。
  ranked.sort((left, right) => left.tier - right.tier || left.index - right.index)
  return ranked.slice(0, top).map((entry) => entry.city)
}

/**
 * 建一个大库检索器（每个 `bazi.*` 方法组一份）。
 *
 * @param {{dataDir?: string, bundledDir?: string}} options `bundledDir` 只为断言台留（缺省 = 随包 data/）
 * @returns {{file: () => string|null, search: (query?: string, limit?: number) => {items: object[], source: string}}}
 */
export function createCityLibrary({ dataDir, bundledDir } = {}) {
  const bundled = typeof bundledDir === 'string' && bundledDir !== '' ? bundledDir : BUNDLED_CITIES_DIR
  const override = typeof dataDir === 'string' && dataDir !== '' ? join(dataDir, CITIES_OVERRIDE_REL) : null

  /** 已加载的库；`undefined` = 还没试过，`null` = 试过但不可用（不重复读盘）。 */
  let loaded
  let sourceFile = null

  function file() {
    if (loaded !== undefined) return sourceFile
    for (const candidate of [override, join(bundled, 'cities-full.json')]) {
      if (candidate === null || !existsSync(candidate)) continue
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8'))
        if (Array.isArray(parsed)) {
          loaded = parsed
          sourceFile = candidate
          return sourceFile
        }
      } catch {
        /* 坏文件 = 这一份不可用，继续看下一份（最终落到 source:'none'） */
      }
    }
    loaded = null
    return null
  }

  return {
    file,
    search(query, limit) {
      if (file() === null) return { items: [], source: CITY_SOURCE_NONE }
      return { items: matchCities(loaded, query, limit), source: CITY_SOURCE_FULL }
    },
  }
}
