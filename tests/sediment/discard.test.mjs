/**
 * 票 15 · `sediment.discard`（契约 §3）：`{ draftId }` → `{ ok: true }`。
 *
 * 「丢弃」是 S10 §3 ⑥ 的**正当路径**，不是错误态：它只删草稿文件，会话与谱都不受影响。
 * 这里钉两件事：
 *   ① 删的是**这一份**草稿（别的草稿、谱文件一个都不动）；
 *   ② 草稿不在时**说清楚**（不做静默成功）——「你以为丢掉的那份早就不在了」要被看见。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createSedimentMethods } from '../../packages/xuanshu-host/lib/sediment/service.mjs'
import { createSedimentStore } from '../../packages/xuanshu-host/lib/sediment/store.mjs'
import { makeHost, makeSandbox, seedConsult, seedPu } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

const DRAFT = {
  description: '沉淀的概览。',
  body: '# 概览\n沉淀的概览。\n',
  summary: '一句话。',
}

function scene() {
  const sandbox = makeSandbox('discard')
  roots.push(sandbox)
  const pu = seedPu(sandbox, { name: '事业与行业', description: '事业与行业的总览。' })
  const consult = seedConsult(sandbox, { pus: [pu.slug] })
  const store = createSedimentStore(sandbox.dataDir)
  const first = store.create({ sessionId: consult.sessionId, target: { slug: pu.slug, name: pu.name }, draft: DRAFT })
  const second = store.create({ sessionId: consult.sessionId, target: { slug: pu.slug, name: pu.name }, draft: DRAFT })
  const host = makeHost()
  const api = createSedimentMethods(host.ctx, { dataDir: sandbox.dataDir })
  return { sandbox, pu, consult, store, first, second, api }
}

describe('票 15 · sediment.discard：丢弃是正当路径，只动这一份草稿', () => {
  it('删掉指定的草稿，返回 { ok: true }；别的草稿与谱文件原样', async () => {
    const { sandbox, pu, first, second, api } = scene()
    const puBefore = sandbox.snapshot()[`pus/${pu.slug}/content.md`]

    expect(await api['sediment.discard']({ draftId: first.draftId })).toEqual({ ok: true })

    expect(sandbox.exists('sediment', `${first.draftId}.json`)).toBe(false)
    expect(sandbox.exists('sediment', `${second.draftId}.json`)).toBe(true)
    expect(sandbox.snapshot()[`pus/${pu.slug}/content.md`]).toBe(puBefore)
  })

  it('草稿不存在 / id 形状不对：抛可读错误，不静默成功，也不误删别的文件', async () => {
    const { sandbox, second, api } = scene()
    const before = sandbox.snapshot()
    await expect(api['sediment.discard']({ draftId: 'nope' })).rejects.toThrow(/草稿/u)
    await expect(api['sediment.discard']({})).rejects.toThrow(/草稿/u)
    await expect(api['sediment.discard']({ draftId: '../../outside' })).rejects.toThrow(/草稿/u)
    expect(sandbox.snapshot()).toEqual(before)
    expect(sandbox.exists('sediment', `${second.draftId}.json`)).toBe(true)
  })
})
