/**
 * packages/xuanshu-host/lib/sediment/message.mjs — 沉淀指令消息的来源标记（ADR-0009 第 5 条）。
 *
 * 沉淀的驱动消息是**玄枢注入的指令**（「把这次问事汇成草稿」），不是用户说的话：
 * 轨迹里必须一眼看得出「这句不是我说的」。载体就是官方显式 merge-extensible 的合并点
 * `MessageSourceMap` —— 每个生产者在自己的模块里声明自己的 kind
 * （`dsh-llm/lib/types/message.d.ts:95-108`，与票 10 的 `xuanshu-consult` 同一套做法）：
 *
 *   declare module '@deepseek-ai/dsh-llm' {
 *     interface MessageSourceMap { 'xuanshu-sediment': { kind: 'xuanshu-sediment' } }
 *   }
 *
 * 构造函数与兜底实现**复用票 10 的 `loadCreateUserMessage()`**（同一个「官方优先、本地照抄兜底」
 * 解析器）：消息形状只有一处实现，两个 kind 只是 `source` 不同。
 */
import { loadCreateUserMessage } from '../consult/message.mjs'

/** 沉淀指令消息的来源 kind（改了等于改了轨迹里的标签与持久化数据）。 */
export const SEDIMENT_MESSAGE_SOURCE_KIND = 'xuanshu-sediment'

/**
 * 造一条沉淀指令消息：`source.kind = 'xuanshu-sediment'`。
 * @param {string} text 提示正文（skill 正文 + 目标谱现状 + 输出要求）
 * @param {{searchDirs?: string[]}} [options] 解析官方 `@deepseek-ai/dsh-llm/message` 的候选锚点
 */
export async function createSedimentPromptMessage(text, { searchDirs = [] } = {}) {
  const createUserMessage = await loadCreateUserMessage(searchDirs)
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: SEDIMENT_MESSAGE_SOURCE_KIND } })
}
