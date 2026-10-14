/**
 * 票 13 · 底稿 RPC 与落盘（契约 §1）
 *
 * 断言只打三样外部可观察的东西：方法返回值、沙箱里真落了哪些文件、文件内容里的章序与来源标记。
 *
 * 抓的真实缺陷/风险：
 *   ① **没有 write/update**（契约 §1）：底稿是派生物。所以这条用例不是「write 会报错」，
 *      而是**方法根本不存在** —— 凭据是 `Object.keys(methods)` 的全量比对。
 *   ② **整文件原子重写**：刷新两次之后沙箱里**只**该有两个文件（没有 `.tmp` 残留）。
 *   ③ **底座谱必须在场**（契约 §1：「base 级谱 **加**票 08 的 `bazi.basePu`」）：
 *      只扫 `pu.list({level:'base'})` 会漏掉 `pus/_base/`（list 按设计不列 `_` 前缀）。
 *   ④ **降级可观察**（契约 §4）：没有 `ctx.llm` → `digest:'skeleton'`；LLM 报错也必须是
 *      `'skeleton'` + 正文头部「未提炼」，而不是把骨架说成提炼稿。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createDigaoMethods, readDigaoMeta } from '../../packages/xuanshu-host/lib/digao/service.mjs'
import { createPuRepository } from '../../packages/xuanshu-host/lib/pu/repository.mjs'
import { fakeLlm, makeCtx, makeSandbox } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 造一个「有底座谱 + 一份 base 级用户谱 + 一个工作区」的现场。 */
function scene({ llm } = {}) {
  const sandbox = makeSandbox('digao')
  roots.push(sandbox)
  const repository = createPuRepository(sandbox.dataDir)
  repository.writeBase(
    { 'bazi.md': '# 八字（出生盘）\n\n## 四柱\n\n| 柱 | 年 |\n|---|---|\n| 干支 | 己巳 |\n' },
    { description: '底座：出生信息与八字底盘。', summary: '底座：四柱 己巳 丙子 丙寅 甲午。' },
  )
  repository.confirm({
    name: '软件开发',
    level: 'base',
    description: '我的开发背景',
    body: '# 概览\n十年工具链经验。',
    summary: '擅长 Rust；做过十年工具链。',
  }, true)
  const workspaceRegistry = {
    list: () => [{ id: 'w1', path: 'E:\\ai_project\\XuanShu', title: 'XuanShu', sessionIds: ['a', 'b', 'c'] }],
  }
  const ctx = makeCtx({ workspaceRegistry, llm })
  return { sandbox, repository, methods: createDigaoMethods(ctx, { dataDir: sandbox.dataDir }) }
}

describe('票13 · 底稿三方法（契约 §1）', () => {
  it('未刷新：status = {exists:false, meta:null}；read 给空正文', async () => {
    const { methods } = scene()
    expect(await methods['digao.status']({})).toEqual({ exists: false, meta: null })
    expect(await methods['digao.read']({})).toEqual({ markdown: '', meta: null })
  })

  it('**没有** write / update / delete 这类方法（派生物不可手改靠方法不存在约束）', () => {
    const { methods } = scene()
    expect(Object.keys(methods).sort()).toEqual(['digao.read', 'digao.refresh', 'digao.status'])
    for (const key of Object.keys(methods)) expect(key).toMatch(/^digao\.(status|read|refresh)$/u)
  })

  it('refresh：底座谱 + 用户 base 级谱 + 工作区三路都进底稿，章序与来源标记合规', async () => {
    const { sandbox, methods } = scene()
    const { meta } = await methods['digao.refresh']({})

    expect(meta.schema).toBe('xuanshu/digao@1')
    expect(meta.segments).toBe(3)
    expect(meta.sources).toBe(2) // 谱 + 工作区；工作流本票留空
    expect(meta.bySource).toEqual({ pu: 2, workspace: 1 })
    expect(meta.digest).toBe('skeleton')
    expect(meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u)

    const markdown = sandbox.read('digao.md')
    expect(markdown.indexOf('## 来源：谱')).toBeLessThan(markdown.indexOf('## 来源：工作区'))
    expect(markdown.indexOf('## 来源：工作区')).toBeLessThan(markdown.indexOf('## 来源：工作流'))
    // 底座谱在场（漏掉 _base 的实现在这条上会红）。
    expect(markdown).toContain('【来源：谱 底座】')
    expect(markdown).toContain('底座：四柱 己巳 丙子 丙寅 甲午。')
    expect(markdown).toContain('【来源：谱 软件开发】')
    expect(markdown).toContain('【来源：工作区 XuanShu】')
    expect(markdown).toContain('尚无来源')

    // 落盘物只有底稿两份（原子重写不留 .tmp 残留）；`pus/**` 是本用例的输入现场，不算底稿产物。
    expect(sandbox.files().filter((file) => file.startsWith('digao.'))).toEqual(['digao.json', 'digao.md'])
    expect(sandbox.files().filter((file) => file.endsWith('.tmp'))).toEqual([])
    expect(sandbox.readJson('digao.json')).toEqual(meta)
    expect(readDigaoMeta(sandbox.dataDir)).toEqual(meta)
  })

  it('refresh 之后：status 给 exists + meta，read 给同一份正文', async () => {
    const { sandbox, methods } = scene()
    const { meta } = await methods['digao.refresh']({})
    expect(await methods['digao.status']({})).toEqual({ exists: true, meta })
    const read = await methods['digao.read']({})
    expect(read.meta).toEqual(meta)
    expect(read.markdown).toBe(sandbox.read('digao.md'))
    expect(read.markdown).toContain('# 底稿')
    expect(read.markdown).toContain('不可手改')
  })

  it('再刷新一次是**整文件重写**，且不留下临时文件', async () => {
    const { sandbox, methods } = scene()
    await methods['digao.refresh']({})
    const first = sandbox.read('digao.md')
    const { meta } = await methods['digao.refresh']({})
    expect(sandbox.files().filter((file) => file.startsWith('digao.'))).toEqual(['digao.json', 'digao.md'])
    expect(sandbox.files().filter((file) => file.endsWith('.tmp'))).toEqual([])
    expect(meta.segments).toBe(3)
    // 段数与内容仍可复现（除 generatedAt）。
    const strip = (text) => text.replace(/^- 生成时间：.*$/mu, '')
    expect(strip(sandbox.read('digao.md'))).toBe(strip(first))
  })
})

describe('票13 · 底稿的 LLM 降级（契约 §1/§4）', () => {
  it('没有 ctx.llm → digest=skeleton，正文头部如实写「未提炼」', async () => {
    const { sandbox, methods } = scene()
    const { meta } = await methods['digao.refresh']({})
    expect(meta.digest).toBe('skeleton')
    const markdown = sandbox.read('digao.md')
    expect(markdown).toContain('未提炼')
    expect(markdown).not.toContain('## 摘要')
  })

  it('有可用的 ctx.llm → digest=llm + 顶部 `## 摘要` 节，且 LLM 只被喂了段素材', async () => {
    const llm = fakeLlm({ text: '一句话：写工具链的开发者，八字丙寅日主。' })
    const { sandbox, methods } = scene({ llm })
    const { meta } = await methods['digao.refresh']({})

    expect(meta.digest).toBe('llm')
    const markdown = sandbox.read('digao.md')
    expect(markdown).toContain('## 摘要')
    expect(markdown).toContain('一句话：写工具链的开发者，八字丙寅日主。')
    expect(markdown).not.toContain('未提炼')
    expect(markdown.indexOf('## 摘要')).toBeLessThan(markdown.indexOf('## 来源：谱'))

    const stream = llm.calls.find((call) => call.method === 'stream')
    expect(stream).toBeDefined()
    expect(stream.options.provider).toBe('fake-provider')
    expect(stream.options.model).toBe('fake-model')
    const prompt = stream.options.messages[0].content[0].text
    expect(stream.options.messages[0].role).toBe('user')
    expect(prompt).toContain('【来源：pu 底座】')
    expect(prompt).toContain('擅长 Rust；做过十年工具链。')
  })

  it('LLM 出错 → 回落 skeleton（降级可观察，刷新照常成功）', async () => {
    const llm = fakeLlm({ fail: true })
    const { sandbox, methods } = scene({ llm })
    const { meta } = await methods['digao.refresh']({})
    expect(meta.digest).toBe('skeleton')
    const markdown = sandbox.read('digao.md')
    expect(markdown).toContain('未提炼')
    expect(markdown).not.toContain('## 摘要')
    expect(sandbox.files().filter((file) => file.startsWith('digao.'))).toEqual(['digao.json', 'digao.md'])
  })

  it('元数据 schema 不认识 → status 的 meta 为 null（旧格式不许被当成新底稿）', async () => {
    const { sandbox, methods } = scene()
    await methods['digao.refresh']({})
    sandbox.write('digao.json', JSON.stringify({ schema: 'xuanshu/digao@0', segments: 1 }))
    expect(await methods['digao.status']({})).toEqual({ exists: true, meta: null })
  })
})
