/**
 * packages/xuanshu-host/lib/rikke/content.mjs — 黄历信封 → 日课三键（票 13 契约 §2）。
 *
 * 真机形状（2026-10-15 捕获，见 `tests/rikke/fixtures/envelopes/PROVENANCE.md`）：
 * `data.snapshot_text` 是一份按 `[段名]` 分节的**渲染文本**，宜忌、干支都在里面，**没有**
 * 对应的结构化字段（`technique_card.settings` 对黄历是空的）。所以这里做两件事：
 *
 *   1. 按 `[段名]` 切段（只按行首方括号切，段内换行保留）；
 *   2. 从 `[今日宜忌]` 取 `宜：…` / `忌：…`，从 `[起盘信息]` 的 `干支：…年 …月 <日柱>日` 取日柱。
 *
 * **玄枢不自算干支**（契约 §2 原文）：日柱是**读**出来的。唯一自己算的是「日支 → 五行」——
 * 那是一张十二项的死表（三合局），而且契约 §1 的样例 `甲子日 · 水` 就是这张表的读法
 * （子=水；不是纳音「海中金」）。这张表放在这里、被测试钉住，是为了不改上游一个字就能显示完整。
 *
 * 读不出宜忌 → `ok:false`：一张没有宜忌的「日课」等于没做，不能装作成功。
 */

/** 十二地支 → 五行（三合局：申酉金 / 寅卯木 / 子亥水 / 巳午火 / 辰戌丑未土）。 */
const BRANCH_ELEMENTS = Object.freeze({
  子: '水', 亥: '水',
  寅: '木', 卯: '木',
  巳: '火', 午: '火',
  申: '金', 酉: '金',
  辰: '土', 戌: '土', 丑: '土', 未: '土',
})

/** 地支五行；不是地支（含天干、空串）→ null。 */
export function branchElement(branch) {
  return BRANCH_ELEMENTS[String(branch ?? '').trim()] ?? null
}

/** 空内容（失败时的形状：三键都在、都是空串 —— 与票 07 的卡的 `?? '—'` 兜底对得上）。 */
export const EMPTY_CONTENT = Object.freeze({ yi: '', ji: '', liuri: '' })

/**
 * `[段名]` 切段 → `{ 段名: 该段正文 }`（正文不含段名行，首尾空白去掉）。
 * 段名重复时后者覆盖前者（真机上不会有重复段）。
 * @returns {Record<string, string>}
 */
export function parseHuangliSections(snapshotText) {
  const text = typeof snapshotText === 'string' ? snapshotText : ''
  const out = {}
  let current = null
  let buffer = []
  const flush = () => {
    if (current !== null) out[current] = buffer.join('\n').trim()
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\[([^\]]+)\]\s*$/.exec(line.trim())
    if (match) {
      flush()
      current = match[1].trim()
      buffer = []
      continue
    }
    if (current !== null) buffer.push(line)
  }
  flush()
  return out
}

/** 取 `键：值` 形式的第一行（真机的段内就是这种行）。 */
function fieldOf(section, label) {
  if (typeof section !== 'string') return null
  for (const line of section.split(/\r?\n/)) {
    const match = new RegExp(`^\\s*${label}\\s*[：:]\\s*(.+?)\\s*$`).exec(line)
    if (match) return match[1].trim()
  }
  return null
}

/**
 * 干支行 `丙午年 戊戌月 壬戌日` → 日柱 `壬戌`（第三段；段序是真机形状，不是猜的）。
 * @returns {string|null} 两字干支，读不出 → null
 */
export function dayPillarOfGanzhiLine(line) {
  const text = String(line ?? '').trim()
  const pillars = text.split(/\s+/).filter((token) => token !== '')
  const day = pillars.find((token) => token.endsWith('日'))
  if (day === undefined) return null
  const stemBranch = day.slice(0, -1).trim()
  return /^[\u4e00-\u9fff]{2}$/.test(stemBranch) ? stemBranch : null
}

/**
 * 信封 → `{ ok, code, reason, tool, version, content }`。
 *
 * 判据（`ok` 的语义 = **能产出日课三键**）：
 *   - 信封不是对象 / 缺 `data.snapshot_text` → `ok:false`（形状不符）；
 *   - `envelope.ok !== true` → `ok:false`，`reason` 带上游 `error.code` 与 `error.message` 原文；
 *   - 读不出 `[今日宜忌]` → `ok:false`（没有宜忌的日课等于没做）。
 * **绝不抛**：任何异常都折算成 `ok:false` + `reason`。
 *
 * @param {object} envelope `tools/call` 拿到的信封
 */
export function readHuangliEnvelope(envelope) {
  const base = { ok: false, code: null, reason: '', tool: null, version: null, content: { ...EMPTY_CONTENT }, sections: {} }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ...base, reason: `不是信封：拿到 ${Array.isArray(envelope) ? '数组' : typeof envelope}` }
  }
  const tool = typeof envelope.tool === 'string' ? envelope.tool : null
  const version = typeof envelope.version === 'string' ? envelope.version : null

  if (envelope.ok !== true) {
    const error = envelope.error && typeof envelope.error === 'object' ? envelope.error : {}
    const code = typeof error.code === 'string' ? error.code : typeof envelope.code === 'string' ? envelope.code : null
    const message = typeof error.message === 'string' ? error.message : typeof envelope.message === 'string' ? envelope.message : null
    const errors = Array.isArray(error?.details?.validation_errors) ? error.details.validation_errors : []
    const fields = errors.map((entry) => (Array.isArray(entry?.loc) ? entry.loc.join('.') : '')).filter((value) => value !== '')
    return {
      ...base,
      tool,
      version,
      code,
      reason: `黄历调用失败（${code ?? '未知 code'}）：${message ?? '上游没给 message'}`
        + `${fields.length > 0 ? `（字段：${fields.join('、')}）` : ''}`,
    }
  }

  const snapshotText = envelope?.data?.snapshot_text
  if (typeof snapshotText !== 'string' || snapshotText.trim() === '') {
    return { ...base, tool, version, reason: '信封 ok 但没有 data.snapshot_text：黄历的宜忌就在这份渲染文本里，读不到就不算产出。' }
  }

  const sections = parseHuangliSections(snapshotText)
  const yiJi = sections['今日宜忌'] ?? ''
  const yi = fieldOf(yiJi, '宜')
  const ji = fieldOf(yiJi, '忌')
  if (yi === null && ji === null) {
    return { ...base, tool, version, sections, reason: '黄历信封里没有 `[今日宜忌]` 段（或段内没有「宜：/忌：」行）：没有宜忌的日课等于没做。' }
  }

  const ganzhi = fieldOf(sections['起盘信息'], '干支')
  const dayPillar = dayPillarOfGanzhiLine(ganzhi)
  const element = dayPillar === null ? null : branchElement(dayPillar.slice(-1))
  // 流日：日柱 + 日支五行；连干支行都读不到就退回干支行原文（宁可少一点信息，也不编一个日柱）。
  const liuri = dayPillar !== null
    ? `${dayPillar}日${element === null ? '' : ` · ${element}`}`
    : (ganzhi ?? '')

  return {
    ok: true,
    code: null,
    reason: '',
    tool,
    version,
    sections,
    content: { yi: yi ?? '', ji: ji ?? '', liuri },
  }
}
