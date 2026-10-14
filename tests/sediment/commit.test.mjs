/**
 * 票 15 · `sediment.commit` —— **人工确认闸门**与写回（契约 §3；S10 §9 C4）。
 *
 * 这张票是「AI 会动你的东西」这条产品线上唯一由人端着的闸门，所以断言的重心是**负路径**：
 * `confirmed !== true` 时**磁盘上一个字节都不许变**（谱文件、草稿文件都不动），
 * 而正路径必须真的落到目标谱文件上、并让 `updated_at` 与正文都变（可回看）。
 *
 * 抓的真实缺陷/风险：
 *   ① **把确认当装饰**：`confirmed` 只用来打日志、写盘照走 —— 症状是「用户没点，谱被改了」。
 *      判据只能是字节级快照比对（文件列表不变挡不住同名文件被改写）。
 *   ② **在 `lib/sediment/` 里另写一份写盘逻辑**：票面禁令。这里通过「写回后目标谱仍是票 09
 *      `createPuRepository().read()` 读得出来的谱、且 `source` 语义由那一层决定」来钉住
 *      「只走 `pu.update` 那条路」——测试只用票 09 的读面验证结果，不碰 sediment 的内部函数。
 *   ③ **写错目标**：`draft.target.slug` 指哪个谱就写哪个；不许顺手改谱名 / 新建谱 / 写到别处。
 *   ④ **提交成功后草稿还留着**：同一次沉淀会被应用第二遍；提交成功的草稿必须消失。
 */
import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { createPuRepository } from '../../packages/xuanshu-host/lib/pu/repository.mjs'
import { createSedimentMethods } from '../../packages/xuanshu-host/lib/sediment/service.mjs'
import { createSedimentStore } from '../../packages/xuanshu-host/lib/sediment/store.mjs'
import { makeHost, makeSandbox, seedConsult, seedPu } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 模型产出的那份草稿（期望值来自规格：skill 要求 description / body / summary 三字段）。 */
const DRAFT = {
  description: '近一年事业判断的沉淀：以稳为主，4—6 月有一次岗位变动窗口。',
  body: '# 概览\n近一年事业判断的沉淀。\n\n## 近一年判断\n今年以稳为主；4—6 月有一次岗位变动，适合先谈条件再定去留。\n',
  summary: '事业：稳为主，4—6 月有岗位变动窗口。',
}

/** 起一套方法 + 沙箱 + 一个已落盘的目标谱 + 一份已暂存的草稿。 */
function scene({ draft = DRAFT } = {}) {
  const sandbox = makeSandbox('commit')
  roots.push(sandbox)
  const pu = seedPu(sandbox, { name: '事业与行业', description: '事业与行业的总览。' })
  const consult = seedConsult(sandbox, { pus: [pu.slug] })
  const store = createSedimentStore(sandbox.dataDir)
  const record = store.create({ sessionId: consult.sessionId, target: { slug: pu.slug, name: pu.name }, draft })
  const host = makeHost()
  const api = createSedimentMethods(host.ctx, { dataDir: sandbox.dataDir })
  return { sandbox, pu, consult, store, record, host, api, repository: createPuRepository(sandbox.dataDir) }
}

describe('票 15 · sediment.commit：confirmed !== true 一律拒收，磁盘零改动', () => {
  const cases = [
    ['confirmed 缺省', {}],
    ['confirmed=false', { confirmed: false }],
    ['confirmed="true"（字符串不是 true）', { confirmed: 'true' }],
    ['confirmed=1', { confirmed: 1 }],
  ]

  for (const [label, payload] of cases) {
    it(`${label}：抛可读错误，且谱文件与草稿**逐字节未变**`, async () => {
      const { sandbox, record, api } = scene()
      const before = sandbox.snapshot()
      expect(Object.keys(before).length, '前置：沙箱里本来就有谱与草稿').toBeGreaterThan(2)

      await expect(api['sediment.commit']({ draftId: record.draftId, ...payload })).rejects.toThrow(/人工确认|确认/u)

      expect(sandbox.snapshot(), '未确认却动了盘：这是本票最严重的失败').toEqual(before)
    })
  }

  it('未确认时草稿原样留着（逐字节）：只有确认过，草稿才会被消费掉', async () => {
    const { sandbox, record, api } = scene()
    const draftFile = `sediment/${record.draftId}.json`
    const before = sandbox.snapshot()[draftFile]
    expect(before, '前置：草稿已经暂存').toBeTruthy()

    await expect(api['sediment.commit']({ draftId: record.draftId })).rejects.toThrow()

    expect(sandbox.exists('sediment', `${record.draftId}.json`)).toBe(true)
    expect(sandbox.snapshot()[draftFile]).toBe(before)
  })

  it('草稿不存在：抛可读错误，且什么都没写', async () => {
    const { sandbox, api } = scene()
    const before = sandbox.snapshot()
    await expect(api['sediment.commit']({ draftId: 'nope', confirmed: true })).rejects.toThrow(/草稿/u)
    expect(sandbox.snapshot()).toEqual(before)
  })
})

describe('票 15 · sediment.commit：确认之后写到目标谱（复用票 09 的 staging + rename）', () => {
  it('写回落盘：返回 { pu }，目标谱正文 = 草稿正文，updated_at 变新', async () => {
    const { sandbox, pu, record, api, repository } = scene()
    const before = repository.read(pu.slug)

    const answer = await api['sediment.commit']({ draftId: record.draftId, confirmed: true })

    expect(Object.keys(answer)).toEqual(['pu'])
    expect(answer.pu.slug).toBe(pu.slug)
    expect(answer.pu.body).toContain('4—6 月有一次岗位变动')
    expect(answer.pu.updatedAt).not.toBe(before.updatedAt)

    // 「可回看」的机器判据：票 09 的读面（不是 sediment 自己的读法）读回来的就是新正文。
    const after = repository.read(pu.slug)
    expect(after.body).toContain('4—6 月有一次岗位变动')
    expect(after.updatedAt).toBe(answer.pu.updatedAt)
    expect(sandbox.read('pus', pu.slug, 'content.md')).toContain('4—6 月有一次岗位变动')
    expect(sandbox.read('pus', pu.slug, 'summary.md')).toBe(DRAFT.summary)
  })

  it('只写目标谱：不新建谱、不改谱名、不碰别的谱', async () => {
    const { sandbox, pu, record, api } = scene()
    const other = seedPu(sandbox, { name: '紫微笔记', description: '另一本谱的总览。' })
    const otherBefore = sandbox.snapshot()[`pus/${other.slug}/content.md`]

    const answer = await api['sediment.commit']({ draftId: record.draftId, confirmed: true })

    expect(answer.pu.name).toBe(pu.name)
    expect(answer.pu.slug).toBe(pu.slug)
    // 谱目录数量不变（没有顺手新建一份）。
    expect(sandbox.files().filter((file) => file.startsWith('pus/') && file.endsWith('manifest.md'))).toHaveLength(2)
    expect(sandbox.snapshot()[`pus/${other.slug}/content.md`]).toBe(otherBefore)
  })

  it('提交成功后草稿消失（同一次沉淀不会被应用第二遍）', async () => {
    const { sandbox, record, api } = scene()
    await api['sediment.commit']({ draftId: record.draftId, confirmed: true })
    expect(sandbox.exists('sediment', `${record.draftId}.json`)).toBe(false)
    await expect(api['sediment.commit']({ draftId: record.draftId, confirmed: true })).rejects.toThrow(/草稿/u)
  })

  it('请求里带了 draft 覆盖：以人改过的那份为准（契约 §3 的 `draft?`）', async () => {
    const { sandbox, pu, record, api, repository } = scene()
    const edited = { ...DRAFT, body: '# 概览\n人改过的正文。\n', summary: '人改过的 summary。' }
    await api['sediment.commit']({ draftId: record.draftId, confirmed: true, draft: edited })
    const after = repository.read(pu.slug)
    expect(after.body).toContain('人改过的正文。')
    expect(after.summary).toBe('人改过的 summary。')
    expect(sandbox.read('pus', pu.slug, 'summary.md')).toBe('人改过的 summary。')
  })

  it('目标谱在草稿生成之后被删掉：可读失败，且不新建一份（写回不是「新建」）', async () => {
    const { sandbox, pu, record, api } = scene()
    // 删掉目标谱的目录（模拟人在 S5 里删了它）。
    rmSync(sandbox.path('pus', pu.slug), { recursive: true, force: true })

    await expect(api['sediment.commit']({ draftId: record.draftId, confirmed: true })).rejects.toThrow()
    expect(sandbox.exists('pus', pu.slug)).toBe(false)
  })
})
