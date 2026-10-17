/**
 * packages/xuanshu-host/lib/digao/skeleton.mjs — 底稿的**确定性骨架与来源标记**
 * （票 13 契约 §1；票 27 / #27 扩成两段，契约 §3）。
 *
 * 底稿是**纯派生**物：`<dataDir>/digao.md`（人读）+ `<dataDir>/digao.json`（元数据）。
 * 这一层只做规则活儿，**不碰 LLM、不读盘、不看时钟**（时间由调用方给）：
 *
 *   - 两段固定章序：`## 最近在做什么`（谱 → 工作区 → 工作流三路）→ `## 曾经做过什么`（事记）；
 *   - 每段首行标记 `【来源：<路> <name>】`；事记另在标记行上写日期区间与依据计数；
 *   - `digest` 是**整份文件的生成模式**（Lead 2026-10-15 裁决）：
 *     `'llm'` = 顶部多一节 `## 摘要`（LLM 只压这一段，骨架与标记不经过 LLM）；
 *     `'skeleton'` = 没有摘要节，且正文头部**如实标注「未提炼」** —— 契约 §4 明令：降级必须可观察，
 *     不许把规则骨架说成提炼稿。
 *
 * 为什么骨架必须确定性：底稿每天被定时刷新覆盖。骨架若是随机的（时间戳混进正文、来源顺序跟着
 * 输入走），用户每次打开都会看到「不一样的我」，而底稿恰恰是「关于我」的那一页。
 *
 * #27 为什么把三章改成两段：底稿要回答两件事 ——「最近在做什么」（现状）与「曾经做过什么」
 * （事记投影）。三章是**同一份现状**按来源切片，读起来仍是三条并列的目录；两段才是那两个问题。
 * 来源标记一个都没少（四路），只是从「章」移到了「段」里。
 */

/** 底稿元数据的 schema（契约 §1 定值；**不随 #27 升级** —— 升了会让旧文件被读成「底稿消失」）。 */
export const DIGAO_SCHEMA = 'xuanshu/digao@1'

/**
 * 「最近」里的三路来源（**顺序即契约**，见契约 §1/§3）。
 * `source` 是机器键（`bySource` 用它），`title` 是章名与人读标记里的那两个字。
 */
export const SOURCE_CHAPTERS = Object.freeze([
  Object.freeze({ source: 'pu', title: '谱' }),
  Object.freeze({ source: 'workspace', title: '工作区' }),
  Object.freeze({ source: 'workflow', title: '工作流' }),
])

/** 第四路（事记）：它**不在**「最近」里，而是「曾经」那一段的唯一来源（契约 §3）。 */
export const SHIJI_CHAPTER = Object.freeze({ source: 'shiji', title: '事记' })

/** 四路来源的固定词表（`bySource` 的行序、头部那一行人读都按它）。 */
export const ALL_CHAPTERS = Object.freeze([...SOURCE_CHAPTERS, SHIJI_CHAPTER])

/** 两段的章名（**顺序即契约**）。 */
export const DIGAO_SECTIONS = Object.freeze([
  Object.freeze({ key: 'recent', title: '最近在做什么' }),
  Object.freeze({ key: 'past', title: '曾经做过什么' }),
])

/** 空来源章里写的话（不是留白：留白会让人以为「渲染坏了」）。 */
function noSourceNote(title) {
  return `（尚无来源：${title}）`
}

/** 事记为空时「曾经」写的话（契约 §3 定值：要说清它从哪来、什么时候会有）。 */
export const NO_SHIJI_NOTE = '（还没有事记：底稿刷新时会自动扫描工作区与工作流。）'

/** 非空字符串规范化。 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 只认数组（调用方给了别的形状就当「这一路没有来源」，不抛）。 */
function asArray(value) {
  return Array.isArray(value) ? value : []
}

/** 依据计数：非负整数，缺省 0。 */
function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0
}

/** 来源键 → 章名（未知来源键原样用，不静默吞掉）。 */
export function chapterTitle(source) {
  return ALL_CHAPTERS.find((chapter) => chapter.source === source)?.title ?? String(source)
}

/**
 * ISO 时间戳 → 日期段（`2026-10-17T08:19:11.000Z` → `2026-10-17`）。
 *
 * 为什么切 ISO 字符串而不按本机时区格式化：底稿是确定性产物 —— 同一份账本在任意时区的机器上
 * 必须排出同一个日期（契约 §3 只要求「日期」，没要求本地日历日）。拿不到日期就原样写回去，
 * 不编一个「今天」。
 */
export function isoDate(value) {
  const raw = text(value)
  const matched = /^(\d{4}-\d{2}-\d{2})/u.exec(raw)
  return matched === null ? raw : matched[1]
}

/** 一段的来源标记行（契约 §1 的 `【来源：…】`）。 */
export function segmentMarker(segment) {
  return `【来源：${chapterTitle(segment?.source)} ${text(segment?.name)}】`
}

/**
 * 把「三个来源」摊平成段列表（按固定章序；**不改输入对象**）。
 * @param {{pus?: object[], workspaces?: object[], workflows?: object[]}} sources 每项 `{name, text}`
 * @returns {{source: string, name: string, text: string}[]}
 */
export function buildSegments(sources = {}) {
  const out = []
  for (const chapter of SOURCE_CHAPTERS) {
    for (const item of asArray(sources?.[chapter.source])) {
      const name = text(item?.name) || chapter.title
      out.push({ source: chapter.source, name, text: text(item?.text) })
    }
  }
  return out
}

/**
 * 事记条目 → 「曾经」那一段的段（契约 §3；**渲染器不重排**，顺序照调用方给）。
 *
 * 条目形状来自 `shiji.list()` / `lib/shiji/ledger.mjs` 的 `listShiji()`（已按 `lastActiveAt` 倒序、
 * 已滤掉墓碑）。这里只搬运渲染需要的字段，不重新判断「该不该出现」——那是账本的职责，
 * 底稿只是它的投影（ADR-0013：一份数据、一个权威）。
 *
 * @param {object[]} entries 事记条目
 * @returns {object[]} `{source:'shiji', id, name, text, firstSeenAt, lastActiveAt, basis}`
 */
export function buildPastSegments(entries) {
  return asArray(entries).map((entry) => ({
    source: SHIJI_CHAPTER.source,
    id: text(entry?.id),
    name: text(entry?.name) || SHIJI_CHAPTER.title,
    text: text(entry?.summary),
    firstSeenAt: text(entry?.firstSeenAt),
    lastActiveAt: text(entry?.lastActiveAt),
    basis: { sessions: count(entry?.basis?.sessions), docs: count(entry?.basis?.docs) },
  }))
}

/** 事记段标记行那一行的后半截：`<日期>～<日期> · 依据：会话 N 场 · 文档 M 份`。 */
export function shijiRecordLine(segment) {
  const since = isoDate(segment?.firstSeenAt) || '日期不明'
  const until = isoDate(segment?.lastActiveAt) || '日期不明'
  const sessions = count(segment?.basis?.sessions)
  const docs = count(segment?.basis?.docs)
  return `${since}～${until} · 依据：会话 ${sessions} 场 · 文档 ${docs} 份`
}

/** 各来源的段数（键序按契约章序；**0 段的来源不占一行**——`sources` 数的是「有贡献的几路」）。 */
export function countBySource(segments) {
  const counts = {}
  for (const segment of asArray(segments)) {
    counts[segment.source] = (counts[segment.source] ?? 0) + 1
  }
  return counts
}

/**
 * 底稿元数据（`digao.json` 的形状，契约 §1 + §3 的加性字段）。
 *
 * @param {{segments: object[], digest: 'llm'|'skeleton', generatedAt: string}} input
 */
export function buildDigaoMeta({ segments, digest, generatedAt }) {
  const list = asArray(segments)
  const bySource = countBySource(list)
  const recent = list.filter((segment) => segment?.source !== SHIJI_CHAPTER.source).length
  return {
    schema: DIGAO_SCHEMA,
    generatedAt,
    segments: list.length,
    sources: Object.keys(bySource).length,
    bySource,
    digest,
    // 加性（契约 §3）：两段各有多少段 —— 客户端据此识别「这份 md 是两段结构」。
    sections: { recent, past: list.length - recent },
  }
}

/** `bySource` 的人读一行（`谱 2 / 工作区 1 / 事记 2`；空时写「无」）。 */
function bySourceLine(bySource) {
  const parts = ALL_CHAPTERS.filter((chapter) => (bySource[chapter.source] ?? 0) > 0)
    .map((chapter) => `${chapter.title} ${bySource[chapter.source]}`)
  return parts.length === 0 ? '无' : parts.join(' / ')
}

/**
 * 渲染整份底稿正文（纯函数）。
 * @param {{segments: object[], digest: 'llm'|'skeleton', digestText?: string, generatedAt: string}} input
 * @returns {string} markdown 全文（以换行结尾）
 */
export function renderDigaoMarkdown({ segments, digest, digestText, generatedAt }) {
  const list = asArray(segments)
  const meta = buildDigaoMeta({ segments: list, digest, generatedAt })
  const distillLine = digest === 'llm'
    ? '已提炼：LLM 把多段压成一段精简汇总（digest=llm）'
    : '未提炼：LLM 不可用或失败，本份为规则骨架（digest=skeleton）'
  const recent = list.filter((segment) => segment?.source !== SHIJI_CHAPTER.source)
  const past = list.filter((segment) => segment?.source === SHIJI_CHAPTER.source)

  const lines = [
    '# 底稿',
    '',
    '> 纯派生 · 不可手改：本文件由玄枢从源头派生，要改就改源头（谱 / 工作区 / 工作流）。',
    '',
    `- 生成时间：${generatedAt}`,
    `- 段：${meta.segments} ｜ 来源：${meta.sources} 路（${bySourceLine(meta.bySource)}）`,
    `- ${distillLine}`,
    '',
  ]

  // 摘要节只在真提炼过时出现（契约 §4：降级不许假装）。
  const digest_ = text(digestText)
  if (digest === 'llm' && digest_ !== '') {
    lines.push('## 摘要', '', digest_, '')
  }

  // ① 最近在做什么：三路来源**按固定章序**，空路写可读的空态（哪一路这轮没内容，一眼看得出）。
  lines.push(`## ${DIGAO_SECTIONS[0].title}`, '')
  for (const chapter of SOURCE_CHAPTERS) {
    const chapterSegments = recent.filter((segment) => segment.source === chapter.source)
    if (chapterSegments.length === 0) {
      // 空路也点名（契约 §3 的「空章照旧写『（尚无来源）』」）：三路都不点名就分不清是谁空着。
      lines.push(noSourceNote(chapter.title), '')
      continue
    }
    for (const segment of chapterSegments) {
      lines.push(segmentMarker(segment), segment.text, '')
    }
  }

  // ② 曾经做过什么：事记的投影（已按 lastActiveAt 倒序；渲染器不重排）。
  lines.push(`## ${DIGAO_SECTIONS[1].title}`, '')
  if (past.length === 0) {
    lines.push(NO_SHIJI_NOTE, '')
  } else {
    for (const segment of past) {
      lines.push(`${segmentMarker(segment)}${shijiRecordLine(segment)}`, segment.text, '')
    }
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}
