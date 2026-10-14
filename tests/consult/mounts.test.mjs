/**
 * 票 12 · `consult.setMounts`（契约 §2；ADR-0009 第 3/4 条）
 *
 * 这一组只钉**写路径**：挂载清单落进票 10 那份旁挂清单的 `mounts` 字段（**不另开权威**），
 * 与 `pus` **并列、互不混淆**；工作区 / 工作流**不是谱**，绝不进 `pus`。
 *
 * 抓的真实缺陷/风险：
 *   ① **另开一份挂载权威**（第二个 json / 塞进别的文件）：列表与注入会各读一处，早晚对不上；
 *      契约 §2 明令载体是 `xuanshu/consult@1` 的 `mounts` 字段。
 *   ② **写 mounts 时顺手改了 pus**：`pus` 是这次问事勾了哪些谱，挂载与它是两件事（C6）。
 *   ③ **把工作区/工作流塞进谱列表**（或反之）：CONTEXT.md 的术语约束，跨屏对照 S5/S6。
 *   ④ **把会话 attach 进 workspace**：挂载 ≠ 归属（ADR-0009 第 3 条）——问事会话仍然
 *      与工作区并列、不属于任何工作区；假 registry 的写方法一被调用就抛。
 *   ⑤ **形状不校验**：一个 `kind:'project'` 或空 id 的挂载项会在注入时变成一段读不出来的内容，
 *      必须在**确认这一刻**可读地拒绝（此时用户还在抽屉里，能改）。
 *   ⑥ **不存在的会话也被写出一份清单**：那会凭空造出一条「问过的事」。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { createConsultStore, normalizeMounts } from '../../packages/xuanshu-host/lib/consult/store.mjs'
import { fakeHorosa, fakeWorkspaceRegistryForMounts, makeHost, makeSandbox, seedPu } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 两个真工作区（形状照 `dsh-workspace` 的 `Workspace`，只取本票用得到的字段）。 */
const WORKSPACES = [
  { id: 'ws-print', path: 'E:\\work\\print-shop', title: '打印车间', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z', sessionIds: [] },
  { id: 'ws-xuanshu', path: 'E:\\ai_project\\XuanShu', title: '玄枢开发', createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z', sessionIds: [] },
]

/**
 * 起一套方法 + 沙箱 + 一个有会话的旁挂清单。
 * 清单用**真** `createConsultStore()` 落（不是手搓 JSON），这样「读回来的形状」本身就是被判的东西。
 */
function scene({ mounts = [], pus = ['软件开发'], workspaces = WORKSPACES } = {}) {
  const sandbox = makeSandbox('mounts')
  roots.push(sandbox)
  const registry = fakeWorkspaceRegistryForMounts({ workspaces })
  const host = makeHost({ services: { workspaceRegistry: registry.service, xuanshuHorosa: fakeHorosa({}).service } })
  const store = createConsultStore(sandbox.dataDir)
  const sessionId = 'session-xs-consult-0f1e2d3c-0000-4000-8000-000000000000'
  store.create({ sessionId, pus })
  if (mounts.length > 0) store.update(sessionId, { mounts })
  const api = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
  return { sandbox, registry, host, api, store, sessionId }
}

describe('票 12 · normalizeMounts：形状与去重（契约 §2 的 MountRef）', () => {
  it('只收 {kind,id,label} 三项，两个 kind 之外一律拒（可读错误）', () => {
    expect(normalizeMounts([{ kind: 'workspace', id: 'ws-print', label: '打印车间' }])).toEqual([
      { kind: 'workspace', id: 'ws-print', label: '打印车间' },
    ])
    expect(normalizeMounts([{ kind: 'workflow', id: 'wf-1', label: '3D 打印排产' }])).toEqual([
      { kind: 'workflow', id: 'wf-1', label: '3D 打印排产' },
    ])
    expect(() => normalizeMounts([{ kind: 'project', id: 'x', label: 'x' }])).toThrow(/kind/u)
    expect(() => normalizeMounts([{ kind: 'workspace', id: '   ', label: 'x' }])).toThrow(/id/u)
    expect(() => normalizeMounts([{ kind: 'workspace', id: 'x', label: 42 }])).toThrow(/label/u)
    expect(() => normalizeMounts('nope')).toThrow(/数组/u)
  })

  it('同 kind+id 去重且保序；label 空串回落到 id（不写一个看得见但读不出的空标签）', () => {
    expect(
      normalizeMounts([
        { kind: 'workspace', id: 'ws-print', label: '打印车间' },
        { kind: 'workspace', id: 'ws-print', label: '重复项' },
        { kind: 'workflow', id: 'ws-print', label: '同名不同类：这是两回事' },
        { kind: 'workflow', id: 'wf-1', label: '' },
      ]),
    ).toEqual([
      { kind: 'workspace', id: 'ws-print', label: '打印车间' },
      { kind: 'workflow', id: 'ws-print', label: '同名不同类：这是两回事' },
      { kind: 'workflow', id: 'wf-1', label: 'wf-1' },
    ])
  })

  it('空数组合法（= 清空挂载），undefined = 不改（由调用方区分）', () => {
    expect(normalizeMounts([])).toEqual([])
    expect(normalizeMounts(undefined)).toEqual([])
  })
})

describe('票 12 · consult.setMounts：写进旁挂清单，与 pus 并列', () => {
  it('落盘后可读回：mounts 三项形状齐全，pus 一字不动（互不混淆）', async () => {
    const { api, store, sessionId } = scene()
    const answer = await api['consult.setMounts']({
      sessionId,
      mounts: [{ kind: 'workspace', id: 'ws-print', label: '打印车间' }],
    })

    expect(answer.session.sessionId).toBe(sessionId)
    expect(answer.session.mounts).toEqual([{ kind: 'workspace', id: 'ws-print', label: '打印车间' }])
    // pus 是「这次勾了哪些谱」，挂载是另一件事 —— 两边都不许被对方改写。
    expect(answer.session.pus).toEqual(['软件开发'])
    const manifest = store.read(sessionId)
    expect(manifest.mounts).toEqual([{ kind: 'workspace', id: 'ws-print', label: '打印车间' }])
    expect(manifest.pus).toEqual(['软件开发'])
    // 载体就是那**一份**旁挂清单：没有第二份挂载权威。
    expect(manifest.schema).toBe('xuanshu/consult@1')
  })

  it('工作区 / 工作流**不进谱列表**：mounts 里出现它们，pus 仍是原样（术语约束）', async () => {
    const { api, store, sessionId } = scene({ pus: ['紫微笔记'] })
    const answer = await api['consult.setMounts']({
      sessionId,
      mounts: [
        { kind: 'workspace', id: 'ws-print', label: '打印车间' },
        { kind: 'workflow', id: 'wf-1', label: '3D 打印排产' },
      ],
    })
    expect(answer.session.pus).toEqual(['紫微笔记'])
    expect(store.read(sessionId).pus).toEqual(['紫微笔记'])
  })

  it('空数组 = 清空挂载（合法操作，不是错误）', async () => {
    const { api, sessionId, store } = scene({ mounts: [{ kind: 'workspace', id: 'ws-print', label: '打印车间' }] })
    const answer = await api['consult.setMounts']({ sessionId, mounts: [] })
    expect(answer.session.mounts).toEqual([])
    expect(store.read(sessionId).mounts).toEqual([])
  })

  it('不存在的会话：可读错误，且**不凭空造一份清单**', async () => {
    const { api, sandbox } = scene()
    await expect(
      api['consult.setMounts']({ sessionId: 'session-xs-consult-does-not-exist', mounts: [] }),
    ).rejects.toThrow(/不存在/u)
    expect(sandbox.files().filter((rel) => rel.includes('does-not-exist'))).toEqual([])
  })

  it('非问事会话 id：拒绝（分类判据，不许打到工作区会话上）', async () => {
    const { api } = scene()
    await expect(api['consult.setMounts']({ sessionId: 'session-abc', mounts: [] })).rejects.toThrow(/问事会话/u)
  })

  it('形状不合规的挂载项：在**确认这一刻**可读地拒绝，且清单一个字节都不变', async () => {
    const { api, sessionId, sandbox } = scene()
    const before = sandbox.read('consult', 'sessions', `${sessionId}.json`)
    await expect(
      api['consult.setMounts']({ sessionId, mounts: [{ kind: 'project', id: 'x', label: 'x' }] }),
    ).rejects.toThrow(/kind/u)
    expect(sandbox.read('consult', 'sessions', `${sessionId}.json`)).toBe(before)
  })
})

describe('票 12 · 挂载 ≠ 归属（ADR-0009 第 3 条）', () => {
  it('工作区只被**读**（get），attachSession / create 一次都不许调', async () => {
    const { api, registry, sessionId } = scene()
    await api['consult.setMounts']({ sessionId, mounts: [{ kind: 'workspace', id: 'ws-print', label: '打印车间' }] })
    const names = registry.calls.map((call) => call.name)
    expect(names).toContain('get')
    expect(names, '挂载不许把会话挂进工作区').not.toContain('attachSession')
    expect(names).not.toContain('create')
    // 会话的 cwd 仍是共用的问事目录，不是那个 workspace 的 path。
    const { store } = scene()
    expect(typeof store.root).toBe('string')
  })

  it('工作区 id 不在 DSH 清单里：可读拒绝，且不写盘（挂载一个不存在的东西没有意义）', async () => {
    const { api, sessionId, sandbox } = scene()
    const before = sandbox.read('consult', 'sessions', `${sessionId}.json`)
    await expect(
      api['consult.setMounts']({ sessionId, mounts: [{ kind: 'workspace', id: 'ws-nope', label: '幽灵工作区' }] }),
    ).rejects.toThrow(/工作区/u)
    expect(sandbox.read('consult', 'sessions', `${sessionId}.json`)).toBe(before)
  })

  it('registry 服务不可得时不做存在性校验（fail-open），但形状校验照旧', async () => {
    const sandbox = makeSandbox('mounts-noregistry')
    roots.push(sandbox)
    const host = makeHost({ services: {} })
    const store = createConsultStore(sandbox.dataDir)
    const sessionId = 'session-xs-consult-0f1e2d3c-0000-4000-8000-000000000001'
    store.create({ sessionId, pus: [] })
    seedPu(sandbox, { name: '随便一个谱', description: '占位。', summary: '占位。' })
    const api = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
    const answer = await api['consult.setMounts']({ sessionId, mounts: [{ kind: 'workspace', id: 'ws-any', label: '任意工作区' }] })
    expect(answer.session.mounts).toHaveLength(1)
  })
})
