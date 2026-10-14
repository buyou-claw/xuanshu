/**
 * packages/xuanshu-host/lib/digao/skeleton.mjs — 底稿的**确定性骨架与来源标记**（票 13 契约 §1）。
 *
 * 底稿是**纯派生**物：`<dataDir>/digao.md`（人读）+ `<dataDir>/digao.json`（元数据）。
 * 这一层只做规则活儿，**不碰 LLM、不读盘、不看时钟**（时间由调用方给）：
 *
 *   - 章序固定 `## 来源：谱` → `## 来源：工作区` → `## 来源：工作流`（票面「哪段来自谱/工作区/工作流」）；
 *   - 每段首行标记 `【来源：<章名> <name>】`，正文紧随其后；
 *   - `digest` 是**整份文件的生成模式**（Lead 2026-10-15 裁决）：
 *     `'llm'` = 顶部多一节 `## 摘要`（LLM 只压这一段，骨架与标记不经过 LLM）；
 *     `'skeleton'` = 没有摘要节，且正文头部**如实标注「未提炼」** —— 契约 §4 明令：降级必须可观察，
 *     不许把规则骨架说成提炼稿。
 *
 * 为什么骨架必须确定性：底稿每天被定时刷新覆盖。骨架若是随机的（时间戳混进正文、来源顺序跟着
 * 输入走），用户每次打开都会看到「不一样的我」，而底稿恰恰是「关于我」的那一页。
 */

/** 底稿元数据的 schema（契约 §1 定值）。 */
export const DIGAO_SCHEMA = 'xuanshu/digao@1'

/**
 * 三个来源章（**顺序即契约**，见契约 §1）。
 * `source` 是机器键（`bySource` 用它），`title` 是章名与人读标记里的那两个字。
 */
export const SOURCE_CHAPTERS = Object.freeze([
  Object.freeze({ source: 'pu', title: '谱' }),
  Object.freeze({ source: 'workspace', title: '工作区' }),
  Object.freeze({ source: 'workflow', title: '工作流' }),
])

/** 空来源章里写的话（不是留白：留白会让人以为「渲染坏了」）。 */
const NO_SOURCE_NOTE = '（尚无来源）'

/** 非空字符串规范化。 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 只认数组（调用方给了别的形状就当「这一路没有来源」，不抛）。 */
function asArray(value) {
  return Array.isArray(value) ? value : []
}

/** 来源键 → 章名（未知来源键原样用，不静默吞掉）。 */
export function chapterTitle(source) {
  return SOURCE_CHAPTERS.find((chapter) => chapter.source === source)?.title ?? String(source)
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

/** 各来源的段数（键序按契约章序；**0 段的来源不占一行**——`sources` 数的是「有贡献的几路」）。 */
export function countBySource(segments) {
  const counts = {}
  for (const segment of asArray(segments)) {
    counts[segment.source] = (counts[segment.source] ?? 0) + 1
  }
  return counts
}

/**
 * 底稿元数据（`digao.json` 的形状，契约 §1）。
 * @param {{segments: object[], digest: 'llm'|'skeleton', generatedAt: string}} input
 */
export function buildDigaoMeta({ segments, digest, generatedAt }) {
  const list = asArray(segments)
  const bySource = countBySource(list)
  return {
    schema: DIGAO_SCHEMA,
    generatedAt,
    segments: list.length,
    sources: Object.keys(bySource).length,
    bySource,
    digest,
  }
}

/** `bySource` 的人读一行（`谱 2 / 工作区 1`；空时写「无」）。 */
function bySourceLine(bySource) {
  const parts = SOURCE_CHAPTERS.filter((chapter) => (bySource[chapter.source] ?? 0) > 0)
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

  for (const chapter of SOURCE_CHAPTERS) {
    lines.push(`## 来源：${chapter.title}`, '')
    const chapterSegments = list.filter((segment) => segment.source === chapter.source)
    if (chapterSegments.length === 0) {
      lines.push(NO_SOURCE_NOTE, '')
      continue
    }
    for (const segment of chapterSegments) {
      lines.push(segmentMarker(segment), segment.text, '')
    }
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}
