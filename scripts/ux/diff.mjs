/**
 * `scripts/ux/diff.mjs` —— **两次巡检的差异分类**（spec 003 · 票 05 / #52）。
 *
 * 纯函数：**不读文件、不读时钟、不写任何东西**（`tests/ux/report-diff.test.mjs` 会读源码检查）。
 * 读「上一次报告」只发生在 `report.mjs` 的 `readPreviousReport()` —— 本模块只吃两个 verdict 数组。
 *
 * ## 分类口径
 *
 * 一条 verdict 的「身份」= (判据 id, 界面面)。身份不变、证据变了 = 同一条债务，不算新增。
 *
 * | 情形 | 桶 | 含义 |
 * |---|---|---|
 * | 上次没有、这次有 | `added` | 覆盖面增加（新判据 / 新界面面 / 新出现的债） |
 * | 上次红、这次绿 | `fixed` | **只有这一条算「修好」** |
 * | 上次绿、这次红 | `regressions` | 回退：改一处坏三处 |
 * | 上次有、这次没有 | `disappeared` | 判据或界面面被删了：**不许静默消失** |
 * | 两次都红 | `stillFailing` | 一直红：不算新增，也不算回退 |
 * | 其它状态迁移 | `transitions` | 未采到 → 绿（采集器补上了）/ 红 → 未采到（债逃走）… |
 * | 两次同状态（非红） | `unchanged` | 只报条数：没变化就不占版面 |
 *
 * 「红 / 绿」的口径只在这里定义（`isRed()` / `isGreen()`），别处不许各自解释状态字符串：
 *   - **绿 = `pass`**；
 *   - **红 = `fail`**；
 *   - `not-collected` / `collection-failed` / `human-only` = **灰**（没验成 / 机器判不了）。
 *
 * 所以 **「未采到 → 绿」绝不进 `fixed`**：那是采集器补上了，界面一个像素都没变好。
 * 同理 **「采集失败 → 绿」也不进 `fixed`**：体检坏了修好体检，不等于界面修好。
 *
 * 完备性：上一次与这一次的**每一个身份**都会恰好落进一个桶（或计进 `unchanged`），
 * `added + fixed + regressions + disappeared + stillFailing + transitions + unchanged`
 * = 两份 verdict 的身份并集大小。用例钉住了这条不变式——「少了谁」不能靠肉眼发现。
 *
 * 不 import 任何模块（Node 内置也不用）：纯到可以当数据转换贴进任何地方。
 */

/** 差异结果的形状版本。改桶名/语义要升版本。 */
export const DIFF_SCHEMA = 'xuanshu/ux-diff@1'

/** 判定状态的枚举（`judge.mjs` 产出的那五种）。 */
export const STATUS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  NOT_COLLECTED: 'not-collected',
  COLLECTION_FAILED: 'collection-failed',
  HUMAN_ONLY: 'human-only',
})

/** 差异分类的可读失败（装配错误：喂进来的不是两份 verdict）。 */
export class DiffError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DiffError'
  }
}

/** 绿 = 通过。只有这一个状态算绿。 */
export function isGreen(verdict) {
  return verdict?.status === STATUS.PASS
}

/** 红 = 判定失败。采集失败是「体检坏了」，不是红。 */
export function isRed(verdict) {
  return verdict?.status === STATUS.FAIL
}

/** verdict 的稳定身份：同一 (判据, 面) 就是同一条债务（证据变了但债务没变）。 */
export function verdictKey(verdict) {
  const criterionId = verdict?.criterionId
  const face = verdict?.face
  if (typeof criterionId !== 'string' || criterionId === '' || typeof face !== 'string' || face === '') {
    throw new DiffError(`verdict 缺身份（criterionId / face）：${JSON.stringify(verdict ?? null)}`)
  }
  return `${criterionId}\u0000${face}`
}

/** 人读的身份（报告里点名用；键里的 \u0000 不该漏到 Markdown 里）。 */
export function describeVerdict(verdict) {
  return `${verdict?.criterionId} ${verdict?.face}`
}

function shortVersion(version) {
  return typeof version === 'string' ? version.slice(0, 12) : String(version)
}

/**
 * 两次报告的判据集版本能不能比。
 * 版本不同 = 考卷换了，分母口径跟着变，硬算一个差值就是在骗人。
 *
 * @param {unknown} previousVersion
 * @param {unknown} currentVersion
 * @returns {{comparable: boolean, reason: string}}
 */
export function compareCriteria(previousVersion, currentVersion) {
  if (typeof currentVersion !== 'string' || currentVersion === '') {
    return { comparable: false, reason: '这次巡检没有判据集版本号：口径不明 = 不可比' }
  }
  if (typeof previousVersion !== 'string' || previousVersion === '') {
    return { comparable: false, reason: '上一次报告没有判据集版本号：口径不明 = 不可比' }
  }
  if (previousVersion !== currentVersion) {
    return {
      comparable: false,
      reason: `判据集版本不同（上次 ${shortVersion(previousVersion)}，这次 ${shortVersion(currentVersion)}）：考卷换了，分母口径跟着变，数字不可比`,
    }
  }
  return { comparable: true, reason: '' }
}

/** 按身份建索引；重复身份直接拒绝（同一 (判据, 面) 只能有一条 verdict）。 */
function indexVerdicts(verdicts, label) {
  if (!Array.isArray(verdicts)) {
    throw new DiffError(`${label} 不是数组（拿到 ${typeof verdicts}）：diff 只吃 verdict[]`)
  }
  const indexed = new Map()
  for (const verdict of verdicts) {
    const key = verdictKey(verdict)
    if (indexed.has(key)) {
      throw new DiffError(`${label} 里有重复身份：${describeVerdict(verdict)}（同一 (判据, 面) 只能有一条 verdict）`)
    }
    indexed.set(key, verdict)
  }
  return indexed
}

/** 桶内排序固定：先界面面、再判据 id —— 同一批输入永远给出同一份顺序。 */
function sortVerdicts(verdicts) {
  return [...verdicts].sort(
    (left, right) => left.face.localeCompare(right.face) || left.criterionId.localeCompare(right.criterionId),
  )
}

/**
 * 「状态变了但既不是修好也不是回退」的那条迁移，给人一句人话（报告里照抄）。
 * @param {string} from
 * @param {string} to
 */
export function transitionReason(from, to) {
  if (to === STATUS.PASS) {
    return '上次不是红（没验成），这次绿了：采集器/口径补上了，界面没变好——不计为已修'
  }
  if (from === STATUS.FAIL) {
    return '上次红、这次没验成：债从量尺下逃走了，不是修好'
  }
  if (from === STATUS.PASS) {
    return '上次绿、这次没验成：不是回退，但这一轮没有结论'
  }
  if (to === STATUS.FAIL) {
    return '上次没验成、这次验出红：这条红可能一直都在，只是上次没量到'
  }
  return '采集状态变了，判定没变'
}

/** 空分类：不可比时也把每个桶都摆出来（形状固定，读者不用判空）。 */
function emptyClassification() {
  return {
    added: [],
    fixed: [],
    regressions: [],
    disappeared: [],
    stillFailing: [],
    transitions: [],
    unchanged: 0,
  }
}

/**
 * 三分类 + 两种「数量对不上」的完整分类。**调用方必须先确认两次报告的判据集版本相同**
 * （用 `compareCriteria()` / `buildDiff()`），否则这里的差值没有意义。
 *
 * @param {object[]} previousVerdicts - 上一次报告的 verdict[]
 * @param {object[]} currentVerdicts - 这一次巡检的 verdict[]
 * @returns {{
 *   added: object[], fixed: object[], regressions: object[], disappeared: object[],
 *   stillFailing: object[], transitions: {verdict: object, from: string, to: string, why: string}[],
 *   unchanged: number,
 * }}
 * @throws {DiffError} 入参不是 verdict[] / 有重复身份
 */
export function diffVerdicts(previousVerdicts, currentVerdicts) {
  const previous = indexVerdicts(previousVerdicts, '上一次的 verdict')
  const current = indexVerdicts(currentVerdicts, '这次的 verdict')

  const buckets = emptyClassification()

  for (const [key, after] of current) {
    const before = previous.get(key)
    if (before === undefined) {
      buckets.added.push(after)
      continue
    }
    const from = before.status
    const to = after.status
    if (from === to) {
      // 一直红要单独说出来（不然读者会把它当成「新增」）；其它同状态只计数，不占版面。
      if (to === STATUS.FAIL) buckets.stillFailing.push(after)
      else buckets.unchanged += 1
      continue
    }
    if (from === STATUS.FAIL && to === STATUS.PASS) {
      buckets.fixed.push(after) // 唯一的「修好」
      continue
    }
    if (from === STATUS.PASS && to === STATUS.FAIL) {
      buckets.regressions.push(after) // 唯一的「回退」
      continue
    }
    buckets.transitions.push({ verdict: after, from, to, why: transitionReason(from, to) })
  }

  for (const [key, before] of previous) {
    if (!current.has(key)) buckets.disappeared.push(before)
  }

  return {
    added: sortVerdicts(buckets.added),
    fixed: sortVerdicts(buckets.fixed),
    regressions: sortVerdicts(buckets.regressions),
    disappeared: sortVerdicts(buckets.disappeared),
    stillFailing: sortVerdicts(buckets.stillFailing),
    transitions: buckets.transitions.sort(
      (left, right) =>
        left.verdict.face.localeCompare(right.verdict.face)
        || left.verdict.criterionId.localeCompare(right.verdict.criterionId),
    ),
    unchanged: buckets.unchanged,
  }
}

/**
 * 把「上一次报告 + 这次的判据集版本 + 这次的 verdict」收成报告里的 `diff` 对象。
 *
 * 不可比时**一个桶都不填**（空数组 + 0）：宁可承认量不了，也不给一个看起来像结论的数字。
 *
 * @param {{
 *   previous?: {criteria?: {version?: string}, verdicts?: object[]} | null,
 *   criteriaVersion: string,
 *   verdicts: object[],
 * }} input
 * @returns {{
 *   comparable: boolean, reason: string,
 *   added: object[], fixed: object[], regressions: object[], disappeared: object[],
 *   stillFailing: object[], transitions: object[], unchanged: number,
 * }}
 */
export function buildDiff({ previous = null, criteriaVersion, verdicts }) {
  if (previous === null || previous === undefined) {
    return {
      ...emptyClassification(),
      comparable: false,
      reason: '这是第一次巡检，没有上一次报告可比',
    }
  }
  const comparable = compareCriteria(previous.criteria?.version, criteriaVersion)
  if (!comparable.comparable) {
    return { ...emptyClassification(), comparable: false, reason: comparable.reason }
  }
  if (!Array.isArray(previous.verdicts)) {
    throw new DiffError('上一次报告没有 verdicts 数组：这不是一份可比的报告（换掉最新的 ux-reports/latest.json 再跑）')
  }
  return { comparable: true, reason: '', ...diffVerdicts(previous.verdicts, verdicts ?? []) }
}

/**
 * 差异的条数摘要（报告首行的「较上次：回退 0 · 新增 3 …」用）。
 * @param {{added: object[], fixed: object[], regressions: object[], disappeared: object[], stillFailing: object[], transitions: object[]}} diff
 */
export function diffCounts(diff) {
  return {
    added: diff.added.length,
    fixed: diff.fixed.length,
    regressions: diff.regressions.length,
    disappeared: diff.disappeared.length,
    stillFailing: diff.stillFailing.length,
    transitions: diff.transitions.length,
    unchanged: diff.unchanged ?? 0,
  }
}
