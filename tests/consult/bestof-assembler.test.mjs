/**
 * 票 11 · 采集器与官方 `BlockAssembler` 的对照（`.scratch/notes/dsh-api-facts.md` E.3）。
 *
 * 为什么值得单独一条：`collectStream()` 是**自己写的**（断言台跑在仓库检出里、profile 那棵树不可解析，
 * 静态 import `@deepseek-ai/dsh-llm/assembler` 会让整组用例 import 失败 —— 与票 10 `message.mjs`
 * 的取舍同款）。自己写的东西最容易「打桩绿、真机红」，所以这里在 profile 装好时把**同一串 chunk**
 * 同时喂给官方 `BlockAssembler` 与我们的采集器，钉住三件事：文本、usage、终止原因。
 *
 * profile 没装时整组跳过（不做假绿）。
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import { collectStream } from '../../packages/xuanshu-host/lib/consult/bestof-run.mjs'
import { planChunks, STUB_USAGE } from './lib/bestof-llm.mjs'

/** 向上找装好的 profile（与 consult 的 message.test.mjs 同款）。 */
function findProfile() {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'profile', 'node_modules', '@deepseek-ai', 'dsh-llm', 'package.json'))) return join(dir, 'profile')
    dir = dirname(dir)
  }
  return undefined
}
const PROFILE = findProfile()

const PLANS = [
  { text: '一段带换行的\n正文。', usage: STUB_USAGE },
  { text: '只有工具调用。', tool: { id: 'call-9', name: 'submit_judgement', arguments: '{"judgement":{"best":"c1","ranking":["c1"]}}' } },
  { text: '', finish: { kind: 'error', failure: { code: 'RATE_LIMIT' } } },
]

describe.skipIf(PROFILE === undefined)('票 11 · 自己收的 chunk 与官方 BlockAssembler 一致', () => {
  it('文本 / usage / 终止原因三项逐份对齐', async () => {
    const require = createRequire(join(PROFILE, 'package.json'))
    // `BlockAssembler` 在包根导出（`dsh-llm/lib/index.js:2390` 的导出表；包 exports 里没有
    // `./assembler` 这个子路径 —— E.3 骨架里的写法在本版本解析不了）。
    const { BlockAssembler } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)

    for (const plan of PLANS) {
      const chunks = planChunks(plan)
      const ours = await collectStream((async function* () { for (const chunk of chunks) yield chunk })())

      const asm = new BlockAssembler()
      for (const chunk of chunks) asm.push(chunk)
      const officialText = asm
        .blocks()
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')

      expect(ours.text, `文本对不上：${JSON.stringify(plan)}`).toBe(officialText.trim())
      expect(ours.usage, `usage 对不上：${JSON.stringify(plan)}`).toEqual(asm.usage)
      expect(ours.finish.kind, `终止原因对不上：${JSON.stringify(plan)}`).toBe(asm.finish.kind)
    }
  })

  it('工具调用的 arguments 是**未解析的原始 JSON 字符串**（ADR-0010 的判据基础）', async () => {
    const chunks = planChunks(PLANS[1])
    const ours = await collectStream((async function* () { for (const chunk of chunks) yield chunk })())
    expect(ours.toolCalls).toHaveLength(1)
    expect(ours.toolCalls[0].name).toBe('submit_judgement')
    expect(typeof ours.toolCalls[0].arguments).toBe('string')
    expect(JSON.parse(ours.toolCalls[0].arguments)).toEqual({ judgement: { best: 'c1', ranking: ['c1'] } })
  })
})
