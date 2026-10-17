/**
 * 票 13 · 底稿 RPC 与落盘（契约 §1；票 27 / #27 扩两段与事记读面，契约 §3）
 *
 * 断言只打三样外部可观察的东西：方法返回值、沙箱里真落了哪些文件、文件内容里的段序与来源标记。
 *
 * 抓的真实缺陷/风险：
 *   ① **没有 write/update**（契约 §1）：底稿是派生物。所以这条用例不是「write 会报错」，
 *      而是**方法根本不存在** —— 凭据是 `Object.keys(methods)` 的全量比对。
 *   ② **整文件原子重写**：刷新两次之后沙箱里**只**该有两个文件（没有 `.tmp` 残留）。
 *   ③ **底座谱必须在场**（契约 §1：「base 级谱 **加**票 08 的 `bazi.basePu`」）：
 *      只扫 `pu.list({level:'base'})` 会漏掉 `pus/_base/`（list 按设计不列 `_` 前缀）。
 *   ④ **降级可观察**（契约 §4）：没有 `ctx.llm` → `digest:'skeleton'`；LLM 报错也必须是
 *      `'skeleton'` + 正文头部「未提炼」，而不是把骨架说成提炼稿。
 *   ⑤ #27：两段（最近 / 曾经）、事记是第四路来源、`digao.read|status` 带**加性**事记读面
 *      （UI 的删除动作要 id），且删除之后下一次刷新不再出现（墓碑）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { refreshDigao } from '../../packages/xuanshu-host/lib/digao/generate.mjs'
import { createDigaoMethods, readDigaoMeta } from '../../packages/xuanshu-host/lib/digao/service.mjs'
import { DIGEST_SYSTEM } from '../../packages/xuanshu-host/lib/digao/llm.mjs'
import { createPuRepository } from '../../packages/xuanshu-host/lib/pu/repository.mjs'
import { recordSessionShiji } from '../../packages/xuanshu-host/lib/shiji/ledger.mjs'
import { createShijiMethods } from '../../packages/xuanshu-host/lib/shiji/service.mjs'
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
    // 票 05 起 `refreshDigao()` 会先扫事记（会读工作区的说明文档）：这里指到一次性沙箱，
    // 免得测试去读真实仓库的文档（断言与底稿无关，只是保持 hermetic）。
    list: () => [{ id: 'w1', path: sandbox.root, title: 'XuanShu', sessionIds: ['a', 'b', 'c'] }],
  }
  const ctx = makeCtx({ workspaceRegistry, llm })
  return {
    sandbox,
    ctx,
    repository,
    methods: createDigaoMethods(ctx, { dataDir: sandbox.dataDir }),
    shiji: createShijiMethods(ctx, { dataDir: sandbox.dataDir }),
  }
}

describe('票13 · 底稿三方法（契约 §1）', () => {
  it('未刷新：status = {exists:false, meta:null}；read 给空正文', async () => {
    const { methods } = scene()
    expect(await methods['digao.status']({})).toEqual({ exists: false, meta: null })
    expect(await methods['digao.read']({})).toEqual({ markdown: '', meta: null })
  })

  it('还没有事记账本时，status/read **省略** shiji 键（拿不到就省略，不写 null）', async () => {
    const { methods } = scene()
    expect('shiji' in (await methods['digao.status']({}))).toBe(false)
    expect('shiji' in (await methods['digao.read']({}))).toBe(false)
  })

  it('**没有** write / update / delete 这类方法（派生物不可手改靠方法不存在约束）', () => {
    const { methods } = scene()
    expect(Object.keys(methods).sort()).toEqual(['digao.read', 'digao.refresh', 'digao.status'])
    for (const key of Object.keys(methods)) expect(key).toMatch(/^digao\.(status|read|refresh)$/u)
  })

  it('refresh：底座谱 + 用户 base 级谱 + 工作区三路进「最近」，事记进「曾经」', async () => {
    const { sandbox, methods } = scene()
    const { meta } = await methods['digao.refresh']({})

    expect(meta.schema).toBe('xuanshu/digao@1')
    expect(meta.segments).toBe(4) // 最近 3 段 + 曾经 1 条（工作区那条事记）
    expect(meta.sources).toBe(3) // 谱 + 工作区 + 事记；工作流本票留空
    expect(meta.bySource).toEqual({ pu: 2, workspace: 1, shiji: 1 })
    expect(meta.digest).toBe('skeleton')
    expect(meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
    expect(meta.sections).toEqual({ recent: 3, past: 1 })

    const markdown = sandbox.read('digao.md')
    // 两段章序即契约：最近 → 曾经。
    expect(markdown.indexOf('## 最近在做什么')).toBeGreaterThan(-1)
    expect(markdown.indexOf('## 最近在做什么')).toBeLessThan(markdown.indexOf('## 曾经做过什么'))
    // 底座谱在场（漏掉 _base 的实现在这条上会红）。
    expect(markdown).toContain('【来源：谱 底座】')
    expect(markdown).toContain('底座：四柱 己巳 丙子 丙寅 甲午。')
    expect(markdown).toContain('【来源：谱 软件开发】')
    expect(markdown).toContain('【来源：工作区 XuanShu】')
    // 空的那一路点名写空态（工作流这一路本票不生产）。
    expect(markdown).toContain('（尚无来源：工作流）')
    // 四条来源标记（四路）里的第四路：事记（日期区间 + 依据 + 摘要）。
    expect(markdown).toMatch(/【来源：事记 XuanShu】\d{4}-\d{2}-\d{2}～\d{4}-\d{2}-\d{2} · 依据：会话 0 场 · 文档 0 份/u)

    // 落盘物只有底稿两份（原子重写不留 .tmp 残留）；`pus/**` 是本用例的输入现场，不算底稿产物。
    expect(sandbox.files().filter((file) => file.startsWith('digao.'))).toEqual(['digao.json', 'digao.md'])
    expect(sandbox.files().filter((file) => file.endsWith('.tmp'))).toEqual([])
    expect(sandbox.readJson('digao.json')).toEqual(meta)
    expect(readDigaoMeta(sandbox.dataDir)).toEqual(meta)
  })

  it('refresh 之后：status 给 exists + meta + 事记读面，read 给同一份正文', async () => {
    const { sandbox, methods } = scene()
    const { meta } = await methods['digao.refresh']({})
    const status = await methods['digao.status']({})
    expect(status.exists).toBe(true)
    expect(status.meta).toEqual(meta)
    // 加性读面：UI 的 [删除] 要 id；形状是契约里那六个键（不多给内部字段）。
    expect(status.shiji.entries).toHaveLength(1)
    expect(Object.keys(status.shiji.entries[0]).sort()).toEqual(
      ['basis', 'firstSeenAt', 'id', 'lastActiveAt', 'name', 'summary'],
    )
    expect(status.shiji.entries[0]).toMatchObject({
      id: expect.stringMatching(/^shiji-[0-9a-f]{16}$/u),
      name: 'XuanShu',
      basis: { sessions: 0, docs: 0 },
    })
    const read = await methods['digao.read']({})
    expect(read.meta).toEqual(meta)
    expect(read.markdown).toBe(sandbox.read('digao.md'))
    expect(read.markdown).toContain('# 底稿')
    expect(read.markdown).toContain('不可手改')
    // read 与 status 的读面同源（同一个 listShiji）。
    expect(read.shiji).toEqual(status.shiji)
  })

  it('事记的删除动作之后：读面里立刻没有它，下一次刷新也不会再出现（墓碑）', async () => {
    const { sandbox, methods, shiji } = scene()
    await methods['digao.refresh']({})
    const before = await methods['digao.read']({})
    const entry = before.shiji.entries[0]

    const removed = await shiji['shiji.remove']({ id: entry.id, confirmed: true })
    expect(removed.ok).toBe(true)

    // 删完立刻重读：账本读面已经没有它（界面据此让条目消失），正文要等下一次刷新。
    const afterRemove = await methods['digao.read']({})
    expect(afterRemove.shiji.entries).toEqual([])
    expect(afterRemove.markdown).toContain('【来源：事记 XuanShu】')

    // 下一次刷新：墓碑判据生效 —— 同一个源头还在，但它不会重新长回来。
    await methods['digao.refresh']({})
    const refreshed = sandbox.read('digao.md')
    expect(refreshed).not.toContain('【来源：事记')
    expect(refreshed).toContain('（还没有事记：底稿刷新时会自动扫描工作区与工作流。）')
    expect((await methods['digao.read']({})).shiji.entries).toEqual([])
    // 账本文件里条目还在（只是墓碑）—— 恢复走显式 RPC，不是靠删文件。
    expect(sandbox.read('shiji.jsonl')).toContain('"excludedAt"')
  })

  it('事记按 lastActiveAt 倒序进「曾经」（含手工「存成今天的事记」那条）', async () => {
    const { sandbox, ctx, methods } = scene()
    // ① 先扫一次：工作区那条的 lastActiveAt = 注入的扫描时刻。
    await refreshDigao({ ctx, dataDir: sandbox.dataDir, now: new Date('2026-10-15T00:00:00.000Z') })
    // ② 人确认存下的一条（更晚）。
    recordSessionShiji(sandbox.dataDir, {
      sessionId: 'session-xs-consult-abc',
      name: '今天的问事',
      summary: '把底稿改成两段这件事聊清楚了。',
      now: new Date('2026-10-18T00:00:00.000Z'),
    })
    await methods['digao.refresh']({})

    const markdown = sandbox.read('digao.md')
    const past = markdown.slice(markdown.indexOf('## 曾经做过什么'))
    expect(past).toContain('【来源：事记 今天的问事】2026-10-18～2026-10-18')
    expect(past).toContain('【来源：事记 XuanShu】')
    expect(past.indexOf('今天的问事')).toBeLessThan(past.indexOf('【来源：事记 XuanShu】'))
    // 头部口径：四路里有内容的三路（谱 / 工作区 / 事记）。
    expect(markdown).toContain('- 段：5 ｜ 来源：3 路（谱 2 / 工作区 1 / 事记 2）')
  })

  it('再刷新一次是**整文件重写**，且不留下临时文件', async () => {
    const { sandbox, methods } = scene()
    await methods['digao.refresh']({})
    const first = sandbox.read('digao.md')
    const { meta } = await methods['digao.refresh']({})
    expect(sandbox.files().filter((file) => file.startsWith('digao.'))).toEqual(['digao.json', 'digao.md'])
    expect(sandbox.files().filter((file) => file.endsWith('.tmp'))).toEqual([])
    expect(meta.segments).toBe(4)
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
    expect(markdown.indexOf('## 摘要')).toBeLessThan(markdown.indexOf('## 最近在做什么'))

    // 票 05（#26）起同一条刷新里还会跑事记摘要（`ctx.llm.stream` 也会被调用一次），所以这里
    // **按 system 提示挑底稿压缩那一次** —— 不是放宽断言，是把两种调用分开认。
    const stream = llm.calls.find((call) => call.method === 'stream' && call.options?.system === DIGEST_SYSTEM)
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

  it('元数据 schema 不认识 → status 的 meta 为 null（旧格式不许被当成新底稿；事记读面不受影响）', async () => {
    const { sandbox, methods } = scene()
    await methods['digao.refresh']({})
    sandbox.write('digao.json', JSON.stringify({ schema: 'xuanshu/digao@0', segments: 1 }))
    const status = await methods['digao.status']({})
    expect(status.exists).toBe(true)
    expect(status.meta).toBeNull()
    // 事记是独立账本：底稿元数据读不出来，不影响删除动作要用的那一份读面。
    expect(status.shiji.entries).toHaveLength(1)
  })
})
