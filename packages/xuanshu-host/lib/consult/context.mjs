/**
 * packages/xuanshu-host/lib/consult/context.mjs — 首轮上下文注入的正文装配（契约 §3）。
 *
 * **只给索引与入口，不灌正文**（票面第 3 条「AI 自己完成加载谱资料」）：
 *   1. 底座谱：票 08 `bazi.basePu` 的 manifest 概览 + summary；
 *   2. 底稿：`<dataDir>/digao.md` 全文 —— 它本身就是「精简汇总」这一层，所以给全文；
 *      不存在就写明「底稿未生成」，**绝不凭空造一份空底稿**；
 *   3. 勾选谱：每谱 manifest 概览 + summary + **文件路径**，正文由 AI 用工具按需读。
 *
 * 每段前一行【来源：…】标记（票面第 2 条要能一眼看出哪段来自哪）。标记是逐字断言的对象，
 * 改文案等于改契约面，别顺手改字。
 *
 * 本模块是**纯函数**：读文件（`bazi.basePu` / `pu.read` / `digao.md`）都在 service 层做，
 * 这里只负责把已经读到的料装成文本 —— 于是「非勾选谱不出现在注入文本里」这类判据可以逐字验。
 */

import { join } from 'node:path'

/** 段标记（契约 §3 定值）。 */
export const SOURCE_MARK_BASE_PU = '【来源：底座谱】'
export const SOURCE_MARK_DIGAO = '【来源：底稿】'

/** 临时挂载的段标记（票 12）：`【来源：挂载 工作区「打印车间」】`。 */
export function sourceMarkMount(label) {
  return `【来源：挂载 ${label}】`
}

/** 挂载披露块的标记（S8 §5 步骤 7：注入内容里必须能看到「砍了多少、为什么砍」）。 */
export const SOURCE_MARK_MOUNT_DISCLOSURE = '【来源：临时挂载·披露】'

/** 挂载**变更**段的标记（票 12：首轮之后挂上/换掉的挂载，在下一问之前补一段）。 */
export const SOURCE_MARK_MOUNT_UPDATE = '【来源：临时挂载·变更】'

/** 勾选谱的段标记：`【来源：谱 <name>】`。 */
export function sourceMarkPu(name) {
  return `【来源：谱 ${name}】`
}

/**
 * 一份谱（底座谱或用户谱）的文件路径清单。
 *
 * 单文件谱（`pus/<slug>.md`）只有一条路径；多文件谱给 manifest / summary / 各分节 ——
 * 「按需深入」要靠这些真实路径，AI 才有地方读（而不是我们替它把正文读出来）。
 */
export function puFilePaths(dataDir, slug, pu) {
  const base = join(dataDir, 'pus', slug)
  if (pu?.singleFile === true) return [`${base}.md`]
  const files = [join(base, 'manifest.md'), join(base, 'summary.md')]
  for (const name of Object.keys(pu?.contents ?? {})) files.push(join(base, name))
  return files
}

/** 概览行：谱没写概览时不要留一个空标签（说清「没有」）。 */
function overviewLine(description) {
  const text = typeof description === 'string' ? description.trim() : ''
  return text === '' ? '概览：（这份谱没有写概览）' : `概览：${text}`
}

/** 摘要行同款处理。 */
function summaryLine(summary) {
  const text = typeof summary === 'string' ? summary.trim() : ''
  return text === '' ? '摘要：（这份谱没有写 summary）' : `摘要：${text}`
}

/**
 * 装配首轮注入的正文（纯函数）。
 *
 * `mounts`（票 12）是 `buildMountPreview()` 的产物：**已经在读 + 裁之后**，这里只负责装文本。
 * `mounts` 缺省 / 没有层时**一个字符都不加** —— 没有挂载的会话，注入文本与票 10 逐字节相同。
 *
 * @param {{dataDir: string, basePu: object|null, digao: string|null,
 *          selected?: Array<{slug: string, pu?: object, error?: string}>, mounts?: object}} input
 * @returns {string}
 */
export function buildConsultContext({ dataDir, basePu, digao, selected = [], mounts }) {
  const blocks = [
    [
      '【玄枢·问事上下文】',
      '这是本次问事开始时自动注入的**谱资料概览**（谱的加载协议：manifest 概览 + summary 优先）。',
      '下面只给概览、摘要与文件路径 —— 正文请按需用文件工具自己读，不要凭概览推断正文。',
      '底座谱与底稿恒定在场、不可关；' + (selected.length === 0 ? '本次没有勾选可选谱（只带底座与底稿）。' : `本次勾选的可选谱 ${selected.length} 个。`),
    ].join('\n'),
  ]

  // ① 底座谱（票 08 的产物；它是每场问事的前提，不是这次的选择）。
  if (basePu === null || basePu === undefined) {
    blocks.push([
      SOURCE_MARK_BASE_PU,
      '底座未立：还没有出过盘（先在八字冷启动向导里填出生信息并出盘）；本次问事没有底座谱可带。',
      `预期位置：${join(dataDir, 'pus', '_base', 'manifest.md')}`,
    ].join('\n'))
  } else {
    blocks.push([
      SOURCE_MARK_BASE_PU,
      `名称：${basePu.name ?? '底座'}`,
      overviewLine(basePu.description),
      summaryLine(basePu.summary),
      `文件：${puFilePaths(dataDir, basePu.slug ?? '_base', basePu).join('、')}`,
    ].join('\n'))
  }

  // ② 底稿（全文；它是「精简汇总」这一层本身）。
  const digaoFile = join(dataDir, 'digao.md')
  if (typeof digao === 'string') {
    blocks.push([SOURCE_MARK_DIGAO, `文件：${digaoFile}`, '', digao.trimEnd()].join('\n'))
  } else {
    blocks.push([
      SOURCE_MARK_DIGAO,
      `底稿未生成：${digaoFile} 不存在（它由日课定时刷新，票 13）。本次问事没有底稿可带，也不要自己创建它。`,
    ].join('\n'))
  }

  // ③ 勾选谱（**只列勾选的**；正文不进来，给路径让 AI 自己读）。
  for (const item of selected) {
    if (item.error !== undefined) {
      // 勾选时它在、现在读不到了：说清楚，而不是静默地少一段（用户会以为勾选没生效）。
      blocks.push([
        sourceMarkPu(item.slug),
        `读不出来：${item.error}（勾选时它在，现在读不到了；先按没有这个谱来问。）`,
        `预期位置：${join(dataDir, 'pus', item.slug)}`,
      ].join('\n'))
      continue
    }
    const pu = item.pu ?? {}
    blocks.push([
      sourceMarkPu(pu.name ?? item.slug),
      `级别：${pu.level ?? 'unknown'}`,
      overviewLine(pu.description),
      summaryLine(pu.summary),
      `文件：${puFilePaths(dataDir, item.slug, pu).join('、')}`,
    ].join('\n'))
  }

  // ④ 临时挂载（票 12）：**只在真有挂载时**才追加 —— 没有挂载的会话输出与票 10 逐字节相同。
  for (const block of buildMountBlocks(mounts)) blocks.push(block)

  return `${blocks.join('\n\n')}\n`
}

/**
 * 挂载**变更**段的装配（票 12；评审发现的那一处「静默失效」）。
 *
 * 为什么要有这一段：挂载内容只在**首轮上下文**里进会话，而挂载清单是随时可改的
 * （S8 抽屉 `consult.setMounts`）。首轮之后再挂一个工作区，模型**看不见它** ——
 * 抽屉上字数状态一切正常，问出来的答案却与那个工作区无关：界面上工作、模型侧不工作。
 * 于是「当前挂载」与「已经注入过的挂载」不一致时，在**下一问之前**补这一段。
 *
 * 移除也要说：以前注入的挂载正文已经进了历史，不声明一句「不再适用」，
 * 模型会继续拿它当现况（越来越旧的上下文比没有上下文更难查）。
 *
 * @param {{mounts?: object}} input `mounts` 是 `buildMountPreview()` 的产物（**读 + 裁之后**）；
 *        空 / 没有层 → 输出「已全部移除」那一句。
 * @returns {string}
 */
export function buildMountUpdateContext({ mounts } = {}) {
  const blocks = buildMountBlocks(mounts)
  if (blocks.length === 0) {
    return [
      SOURCE_MARK_MOUNT_UPDATE,
      '这一场问事的临时挂载**已全部移除**：此前注入的挂载内容不再适用于后面的问题，不要再用它。',
    ].join('\n') + '\n'
  }
  return [
    SOURCE_MARK_MOUNT_UPDATE,
    '这一场问事的临时挂载变了：以**下面这一份**为当前挂载（此前注入的挂载内容已被它取代）。',
    '',
    blocks.join('\n\n'),
  ].join('\n') + '\n'
}

/**
 * 挂载段的文本装配（票 12；S8 §2.1④ / §5 步骤 7）。
 *
 * 两块：
 *   1. **披露块**：这次挂了几层、共多少字、预算多少、纳入几层、裁了多少、为什么 ——
 *      「砍了多少、为什么砍」必须在文本里能读到，不能只留在界面上；
 *   2. **逐层正文**：只装**纳入了的段**；被裁掉的段按设计稿补一行「此处裁去 N 字」，
 *      整层丢弃的层只出现在披露块里（**不静默截断、也不静默消失**）。
 *
 * @param {object|undefined} mounts - `buildMountPreview()` 的结果。
 * @returns {string[]} 块（每块之间空一行）。
 */
function buildMountBlocks(mounts) {
  const layers = Array.isArray(mounts?.layers) ? mounts.layers : []
  if (layers.length === 0) return []
  const out = []

  const lines = [
    SOURCE_MARK_MOUNT_DISCLOSURE,
    mounts.notice,
    ...(Array.isArray(mounts.notes) ? mounts.notes.map((note) => `· ${note}`) : []),
  ]
  for (const layer of layers) {
    const kept = layer.kept ? `已纳入 ${layer.keptChars} / ${layer.chars} 字` : '未纳入本次上下文'
    lines.push(`· ${layer.head ?? layer.label}：${kept}${layer.clipped ? '（已按段边界裁剪）' : ''}${layer.reason === undefined ? '' : ` —— ${layer.reason}`}`)
  }
  out.push(lines.join('\n'))

  for (const layer of layers) {
    if (!layer.kept) continue
    const parts = [sourceMarkMount(layer.head ?? layer.label)]
    if (typeof layer.hint === 'string' && layer.hint !== '') parts.push(layer.hint)
    for (const segment of layer.segments ?? []) {
      parts.push(`── ${segment.label} ──`, String(segment.text).trimEnd())
    }
    const cut = (layer.droppedSegments ?? []).filter((item) => item.reason === '超预算未纳入')
    const cutChars = cut.reduce((sum, item) => sum + (Number.isFinite(item.chars) ? item.chars : 0), 0)
    if (cutChars > 0) parts.push(`（此处裁去 ${cutChars} 字：${cut.map((item) => item.label).join('、')}）`)
    out.push(parts.join('\n'))
  }
  return out
}
