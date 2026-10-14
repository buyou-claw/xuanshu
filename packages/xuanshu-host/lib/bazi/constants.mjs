/**
 * packages/xuanshu-host/lib/bazi/constants.mjs — 票 08 的定值单源。
 *
 * 只放**被两处以上引用**或**契约 §1/§2 写死的字面量**；散在各文件里改一处漏一处，
 * 就会出现「快照 schema 写 A、读的地方认 B」这类只在真机上暴露的错位。
 */

/** 八字快照的 schema 标识（契约 §1 定值）。 */
export const BAZI_SNAPSHOT_SCHEMA = 'xuanshu/bazi-snapshot@1'

/** 快照文件相对 `<dataDir>` 的路径（契约 §1）。 */
export const BAZI_SNAPSHOT_REL = 'bazi/snapshot.json'

/** 可选大库的**用户覆盖位**（契约 §1：`<dataDir>/geo/cities-full.json`，缺失不算失败）。 */
export const CITIES_OVERRIDE_REL = 'geo/cities-full.json'

/** 底座谱的保留目录名（契约 §7：用户谱名仍拒绝 `_base`，底座只走保留路径）。 */
export const BASE_PU_SLUG = '_base'

/** 底座谱的谱名（契约 §1：`name=底座, level=base, source=manual`）。 */
export const BASE_PU_NAME = '底座'

/** 底座谱的八字分节文件名（契约 §1）。 */
export const BASE_PU_BAZI_FILE = 'bazi.md'

/** `bazi.cities` 的缺省 / 上限条数（宿主侧只做粗筛，界面自己排序与滚动）。 */
export const CITY_LIMIT_DEFAULT = 20
export const CITY_LIMIT_MAX = 50

/** `bazi.cities` 的两种来源标记（契约 §2）。 */
export const CITY_SOURCE_FULL = 'full'
export const CITY_SOURCE_NONE = 'none'

/** `bazi.timezone` 的「什么都没算出来」形状（契约 §4：界面据此落回手改时区）。 */
export const UNKNOWN_TIMEZONE = Object.freeze({ zone: null, offsetMinutes: null, dst: null })

/**
 * `timeAlg` 三档的人读标签（底座谱的口径行用它）。
 * 出处：上游 `horosa_skill/time_basis.py` 的 `TIME_ALG_LABEL`（逐字移植自星阙
 * `astrostudyui/src/utils/timeBasisLine.js`），见 `docs/research/true-solar-time.md` §1.4。
 * `2`（春分定卯时）上游自身未实现，所以不在这里给标签。
 */
export const TIME_ALG_LABELS = Object.freeze({
  0: '真太阳时（经度 + 均时差校正）',
  1: '直接时间（钟表时，不做校正）',
  3: '平太阳时（仅经度校正，无均时差）',
})
