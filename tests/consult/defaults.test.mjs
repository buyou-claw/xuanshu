/**
 * 票 10 · `consult.defaults`（契约 §2/§3）
 *
 * 这一组是「勾选谱区」的数据源：**底座与底稿恒在场、不可关**，其余谱按需勾选。
 * 断言只打方法返回值与沙箱里真落了什么盘 —— 底座谱由票 08 的**真** `bazi.cast` 现出，
 * 可选谱由票 09 的**真** `createPuRepository().confirm()` 现落，没有一份手搓 fixture。
 *
 * 抓的真实缺陷/风险：
 *   ① **底座/底稿被当成可勾选项**（列进 `optional` 或压根不出现）：前者让界面出现两个能被取消的
 *      恒定项，后者让界面没有锁定行可渲染 —— 两种都违背 C5「默认在场 · 不可关」。
 *   ② **不存在底稿时凭空造一个空底稿**：`present:true` 却没有任何内容，界面会显示「底稿在场」，
 *      而注入出来是空的 —— 用户对「底稿到底有没有」的认知从此不可信（契约 §2 明令：票 13 才生产它）。
 *   ③ **可勾选列表里冒出底座谱**：`_base` 是保留目录（票 09 的 `list()` 本来就不含它），
 *      一旦出现就会被勾上、被注入一份「底座」的可选谱副本。
 *   ④ **把读不出来的谱当正常谱列出去**：勾一个坏谱只会注入一段「读不出来」，用户修它的地方在 S5。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { envelope, fakeHorosa, makeHost, makeSandbox, seedBasePu, seedPu } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 起一套方法 + 沙箱；底座谱与底稿按参数准备。 */
async function scene({ basePu = true, digao = true, pus = [] } = {}) {
  const sandbox = makeSandbox('defaults')
  roots.push(sandbox)
  const fake = fakeHorosa(envelope('bazi-ok-default'))
  const host = makeHost({ services: { xuanshuHorosa: fake.service } })
  if (basePu) await seedBasePu(sandbox, host.ctx)
  for (const pu of pus) seedPu(sandbox, pu)
  if (digao) sandbox.write('digao.md', '# 底稿\n这是底稿正文（票 13 的产物，本票只探测）。\n')
  const api = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
  return { sandbox, host, api }
}

describe('consult.defaults · 恒定在场项（契约 §2/§3）', () => {
  it('底座谱与底稿都在场：present=true、名字是「底座」「底稿」、没有 reason', async () => {
    const { api } = await scene()
    const { required } = await api['consult.defaults']({})

    expect(required.map((item) => item.kind)).toEqual(['base-pu', 'digao'])
    for (const item of required) {
      expect(Object.keys(item).sort(), `${item.kind} 的形状被改了`).toEqual(['kind', 'name', 'present'])
      expect(item.present, `${item.kind} 应该在场：${JSON.stringify(item)}`).toBe(true)
    }
    // 底座谱的名字来自票 08 落的那份谱本身（不是这里另起一个名字）。
    expect(required[0].name).toBe('底座')
    expect(required[1].name).toBe('底稿')
  })

  it('没起过盘：底座 present=false，reason 指向「去填出生信息」', async () => {
    const { api, sandbox } = await scene({ basePu: false })
    const { required } = await api['consult.defaults']({})
    const base = required.find((item) => item.kind === 'base-pu')
    expect(base.present).toBe(false)
    expect(base.reason).toMatch(/出生信息/u)
    // 探测不等于生产：不许顺手造一份空底座谱。
    expect(sandbox.exists('pus', '_base', 'manifest.md')).toBe(false)
  })

  it('底稿不存在：present=false，reason 指向「还没生成」，且**不造空底稿**（票 13 才生产它）', async () => {
    const { api, sandbox } = await scene({ digao: false })
    const { required } = await api['consult.defaults']({})
    const digao = required.find((item) => item.kind === 'digao')
    expect(digao.present).toBe(false)
    expect(digao.reason).toMatch(/底稿/u)
    expect(sandbox.exists('digao.md')).toBe(false)
  })
})

describe('consult.defaults · 可勾选谱（契约 §2：pu.list() 排除底座）', () => {
  it('列出用户建的谱：slug/name/level/summary 四项，底座谱（_base）不在其中', async () => {
    const { api } = await scene({
      pus: [
        { name: '紫微笔记', level: 'optional', description: '紫微斗数的读书笔记。', summary: '紫微：十四主星与四化的笔记。' },
        { name: '软件开发', level: 'base', description: '手上的软件项目与排期。', summary: '软件开发：项目、排期与复盘。' },
      ],
    })
    const { optional } = await api['consult.defaults']({})

    expect(optional.map((item) => item.slug).sort()).toEqual(['紫微笔记', '软件开发'])
    for (const item of optional) {
      expect(Object.keys(item).sort(), `${item.slug} 的形状被改了`).toEqual(['level', 'name', 'slug', 'summary'])
    }
    expect(optional.find((item) => item.slug === '紫微笔记')).toEqual({
      slug: '紫微笔记',
      name: '紫微笔记',
      level: 'optional',
      summary: '紫微：十四主星与四化的笔记。',
    })
    // 行内 base / optional 是「默认勾不勾」的依据，不能被抹平成一种。
    expect(optional.find((item) => item.slug === '软件开发').level).toBe('base')

    // 底座谱是恒定在场项，绝不是「可勾选项」。
    expect(optional.some((item) => item.slug === '_base')).toBe(false)
  })

  it('读不出来的谱不进可勾选列表（它在 pu.list() 里带 error，该去 S5 修）', async () => {
    const { api, sandbox } = await scene({ pus: [{ name: '好谱', description: '读得出来。', summary: '好谱摘要。' }] })
    // 手工造一个坏谱目录：manifest 缺 frontmatter —— 这是**故意坏掉的输入**，不是形状 fixture。
    sandbox.write('pus/坏谱/manifest.md', '这不是 frontmatter\n')
    const { optional } = await api['consult.defaults']({})
    expect(optional.map((item) => item.slug)).toEqual(['好谱'])
  })

  it('一个谱都没有：optional 是空数组（空手也能问一句）', async () => {
    const { api } = await scene()
    const { optional } = await api['consult.defaults']({})
    expect(optional).toEqual([])
  })
})
