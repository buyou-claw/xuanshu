/**
 * 票 10 · 注入消息的载体（契约 §3，ADR-0009 第 5 条）
 *
 * 消息的两个身份在这里钉住：
 *   - **来源 kind = `xuanshu-consult`**（自定义 `MessageSourceMap` 合并点；轨迹里显示成「注入」行）；
 *   - **形状 = 官方 `createUserMessage()` 的产物**（`{id, role, content, source}`、深冻结）。
 *
 * 为什么要跟官方实现对照：真机用官方 `createUserMessage`，断言台跑在没有 DSH 树的检出里、
 * 走的是本地等价物。两条路必须产出同一种东西 —— 这条对照用例就是「不许漂移」的抓手
 * （profile 没装时整组跳过，不做假绿）。
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  CONSULT_MESSAGE_SOURCE_KIND,
  createConsultContextMessage,
  createConsultQuestionMessage,
  createFallbackUserMessage,
  loadCreateUserMessage,
  resolveMessageModuleHref,
} from '../../packages/xuanshu-host/lib/consult/message.mjs'

/** 与 `tests/assembly/xuanshu-rpc.test.mjs` 同款：向上找装好的 profile（找不到就跳过对照）。 */
function findProfile() {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'profile', 'node_modules', '@deepseek-ai', 'dsh-llm', 'package.json'))) return join(dir, 'profile')
    dir = dirname(dir)
  }
  return undefined
}
const PROFILE = findProfile()

describe('本地等价物（断言台没有 DSH 树时走的路）', () => {
  it('形状与官方 createUserMessage 一致：{id, role, content, source} 且深冻结', () => {
    const message = createFallbackUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: CONSULT_MESSAGE_SOURCE_KIND } })
    expect(Object.keys(message).sort()).toEqual(['content', 'id', 'role', 'source'])
    expect(message.role).toBe('user')
    expect(typeof message.id).toBe('string')
    expect(message.id).not.toBe('')
    expect(message.content).toEqual([{ type: 'text', text: 'hi' }])
    expect(message.source).toEqual({ kind: 'xuanshu-consult' })
    // 官方 createMessage() 会 deepFreeze(structuredClone(...))：发布出去的消息不该还能被就地改。
    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(message.content)).toBe(true)
    expect(Object.isFrozen(message.content[0])).toBe(true)
    expect(Object.isFrozen(message.source)).toBe(true)
  })

  it('两个构造器各带各的来源 kind：注入 = xuanshu-consult，问题是 user', async () => {
    const injection = await createConsultContextMessage('【来源：底座谱】…', { searchDirs: [join(tmpdir(), 'no-dsh-tree-here')] })
    const question = await createConsultQuestionMessage('帮我看时机', { searchDirs: [join(tmpdir(), 'no-dsh-tree-here')] })
    expect(injection.source.kind).toBe(CONSULT_MESSAGE_SOURCE_KIND)
    expect(question.source.kind).toBe('user')
    expect(injection.content).toEqual([{ type: 'text', text: '【来源：底座谱】…' }])
  })

  it('解析不到任何锚点 → href 为 null（调方据此回落到本地等价物）', () => {
    expect(resolveMessageModuleHref([join(tmpdir(), 'no-such-anchor')])).toBe(null)
  })
})

describe.skipIf(PROFILE === undefined)('真机路径：用官方 @deepseek-ai/dsh-llm/message 的 createUserMessage', () => {
  it('从 profile 安装点解析到官方模块，并原样采用它的实现', async () => {
    expect(resolveMessageModuleHref([PROFILE])).toMatch(/message\.js$/u)
    const require = createRequire(join(PROFILE, 'package.json'))
    const official = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm/message')).href)
    const factory = await loadCreateUserMessage([PROFILE])
    // 同一条路：不是「长得像」，就是官方那个函数。
    expect(factory).toBe(official.createUserMessage)

    const message = await createConsultContextMessage('【来源：底稿】…', { searchDirs: [PROFILE] })
    expect(Object.keys(message).sort()).toEqual(['content', 'id', 'role', 'source'])
    expect(message.source.kind).toBe(CONSULT_MESSAGE_SOURCE_KIND)
    expect(Object.isFrozen(message)).toBe(true)
  })
})
