/**
 * packages/xuanshu-host/lib/sediment/plan.mjs — 沉淀的**纯决策**部分（无 IO、无 LLM，可单测）。
 *
 * 三件事各自独立、都能在没有宿主的情况下断言：
 *   1. `resolveTarget()`：这次沉淀写哪本谱（契约 §3 的 `targetSlug?` 与「目标谱在哪定」）；
 *   2. `buildSedimentPrompt()`：交给模型的提示（skill 正文 + 目标谱现状 + 输出要求）；
 *   3. `parseDraftAnswer()`：模型回的那段文本 → 可提交的草稿（代码围栏容忍 + 形状校验）。
 *
 * **为什么把这三件从 service 里拆出来**：它们是「沉淀到底写了什么、写到哪」的全部判断，
 * 而 service 那一层是「接会话、等轮次、落盘」。拆开之后，负路径（模型乱答 / 谱不存在）
 * 不需要跑任何一轮对话就能钉住。
 */
import { projectConsultMessages } from '../consult/history.mjs'

import { normalizeDraftDraft } from './store.mjs'

/** 目标谱没有被指定、且这场问事也没勾过谱时，最后一步落到谱列表的第一本可选谱。 */
export function resolveTarget({ requestedSlug, consultPus = [], available = [] } = {}) {
  const bySlug = new Map()
  for (const pu of available) {
    if (pu !== null && typeof pu === 'object' && typeof pu.slug === 'string' && pu.slug !== '' && pu.error === undefined) {
      bySlug.set(pu.slug, pu)
    }
  }

  if (requestedSlug !== undefined && requestedSlug !== null) {
    if (typeof requestedSlug !== 'string' || requestedSlug.trim() === '') {
      throw new Error('目标谱 slug 必须是文本（targetSlug）。')
    }
    const slug = requestedSlug.trim()
    const found = bySlug.get(slug)
    if (found === undefined) {
      throw new Error(`目标谱不存在：${JSON.stringify(slug)}（可选的是：${[...bySlug.keys()].join('、') || '（一本都没有）'}）。写回是「更新既有的谱」，不会顺手新建一本。`)
    }
    return { slug: found.slug, name: typeof found.name === 'string' && found.name !== '' ? found.name : found.slug }
  }

  for (const slug of consultPus) {
    const found = bySlug.get(slug)
    // 勾过但已经读不出来的谱直接跳过：把草稿指向一本读不出来的谱，等于把失败推迟到确认那一步。
    if (found !== undefined) return { slug: found.slug, name: typeof found.name === 'string' && found.name !== '' ? found.name : found.slug }
  }

  const first = [...bySlug.values()][0]
  if (first === undefined) {
    throw new Error('还没有可写入的谱：沉淀的目标只能是谱（工作区 / 工作流不是谱），请先去 S5 谱管理建一本。')
  }
  return { slug: first.slug, name: typeof first.name === 'string' && first.name !== '' ? first.name : first.slug }
}

/**
 * 组这条「把问事收成草稿」的提示。
 *
 * 为什么把目标谱的**当前正文**也塞进去：草稿是「在既有正文之上的更新」而不是另起一本
 * （S10 §2 B② 的 diff 预览就建立在这个前提上：未变的分节原样保留）。
 * 不把现状交给模型，它就只能凭会话里的印象重写一遍，diff 会变成「整本重写」，人也就没法看清改了什么。
 */
export function buildSedimentPrompt({ skill, target, current }) {
  const description = typeof current?.description === 'string' ? current.description : ''
  const body = typeof current?.body === 'string' ? current.body : ''
  const summary = typeof current?.summary === 'string' ? current.summary : ''
  return [
    String(skill ?? '').trim(),
    '',
    '—— 本次沉淀的落点（由宿主给出，不要自己去找）——',
    `目标谱：${JSON.stringify({ slug: target.slug, name: target.name })}`,
    `这本谱当前的概览：${description === '' ? '（空）' : description}`,
    '这本谱当前的正文（**起点**；这次问事没改变的分节请原样保留）：',
    '````markdown',
    body,
    '````',
    `这本谱当前的 summary：${summary === '' ? '（空）' : summary}`,
    '',
    '—— 输出要求 ——',
    '只输出一个 JSON 对象，字段 `description` / `body` / `summary`；不要代码围栏、不要任何解释文字。',
    '不要调用任何工具去写谱或改动文件：写入只发生在人于界面上点过「确认更新」之后。',
  ].join('\n')
}

/**
 * 模型回的那段文本 → 可提交的草稿。
 *
 * 容忍一层代码围栏（真机上模型经常自带 ```json），其余一律按 skill 的约定严格校验：
 * 不是 JSON、正文没有一级「概览」节、summary 是空的 —— 全部当场拒收。
 * **为什么要在这里拒**：草稿一旦存下，人看到的就是「准备就绪、可以确认」；等到确认那一步
 * 才发现模型没给 summary，那次点击就白费了（而闸门的价值正是「点下去就有结果」）。
 */
export function parseDraftAnswer(text) {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (raw === '') throw new Error('模型没有给出任何内容：这一轮没有可沉淀的汇总，请重试。')
  const unfenced = raw.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
  let parsed
  try {
    parsed = JSON.parse(unfenced)
  } catch {
    throw new Error('模型没有按 skill 要求输出 JSON 对象（description / body / summary）：这一轮的结果不能当草稿，请重试。')
  }
  const draft = normalizeDraftDraft(parsed)
  if (draft.summary.trim() === '') {
    throw new Error('模型没有给出 summary（精简事实汇总）：草稿缺了它就不能提交，请重试。')
  }
  return draft
}

/**
 * 从会话事件流里取**最后一条助手消息的文本**（就是这一轮的回答）。
 *
 * 直接复用票 10 的正文投影（`projectConsultMessages`）：正文的权威是会话日志，
 * 投影规则只有那一处实现 —— 沉淀不该有自己的一套「怎么读会话」。
 * @param {{events?: object[]}} snapshot `ctx.sessionQuery.readSession()` 的返回
 * @returns {string|null} 没有助手文本 → null（调用方报「模型没给出内容」）
 */
export function lastAssistantText(snapshot) {
  const messages = projectConsultMessages(snapshot)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant' && typeof messages[index].text === 'string') return messages[index].text
  }
  return null
}
