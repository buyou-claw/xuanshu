/**
 * 票 16 · 工作流会话（`workflow.create` / `workflow.list`，契约 §4）
 *
 * 断言只打外部可观察行为：RPC 返回值、沙箱里落了哪些文件、发给 agent 的 `followup` 消息。
 *
 * 抓的真实缺陷/风险：
 *   ① **回一个「创建成功」但会话开不了口**：没有 `agentPresets` / `agentDefaultModel` 时 DSH 会在
 *      第一轮请求前抛 `has no provider/model`（`dsh-agent-loop/lib/index.js:1185`）。所以能力门必须在
 *      **建会话之前**——这条用「缺依赖时 `agentPresets.create` 一次都没被调」钉住。
 *   ② **种子里没有 `/writing-skills`**：验收第 1 条就是「seed 自动调 `/writing-skills`」，
 *      判据是**真发出去的那条消息的文本**，不是代码里有个常量。
 *   ③ **清单先落、会话后建**：反过来的失败是「门厅列表里有一条，点开打不开」。
 *   ④ **工作流不是谱**：`workflow.list` 不读 `pus/**`（这条由「dataDir 下只有 workflow/ 一个目录」钉住）。
 *   ⑤ **会话 id 形状**（ADR-0009）：`session-xs-workflow-<uuid>`、cwd 是专用目录、**不 attach 到 workspace**。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createWorkflowMethods, resolveDshHome, seedText } from '../../packages/xuanshu-host/lib/workflow/service.mjs'
import { WORKFLOW_SCHEMA, isWorkflowSessionId } from '../../packages/xuanshu-host/lib/workflow/store.mjs'
import { fakeAgents, fakeDefaultModel, fakePresets, makeCtx, makeSandbox, messageText } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

function scene({ presets = true, model = true, agentsFail = false } = {}) {
  const sandbox = makeSandbox('workflow')
  roots.push(sandbox)
  const agents = fakeAgents({ fail: agentsFail })
  const services = { agents }
  if (presets) services.agentPresets = fakePresets()
  if (model) services.agentDefaultModel = fakeDefaultModel()
  const ctx = makeCtx(services)
  const methods = createWorkflowMethods(ctx, { dataDir: sandbox.dataDir, dshHome: sandbox.dshHome })
  return { sandbox, ctx, methods, agents, services }
}

describe('票16 · workflow.create（契约 §4）', () => {
  it('建会话成功：回 {sessionId, cwd}；id 是玄枢自铸前缀；cwd 是专用目录且已建出来', async () => {
    const { sandbox, methods, agents } = scene()
    const result = await methods['workflow.create']({ seed: '每周整理行业动态' })

    expect(isWorkflowSessionId(result.sessionId)).toBe(true)
    expect(result.cwd).toBe(sandbox.path('dsh-home', 'xuanshu', 'workflow'))
    expect(sandbox.exists(result.cwd)).toBe(true)
    expect(agents.calls).toHaveLength(1)
    expect(agents.calls[0].sessionId).toBe(result.sessionId)
    expect(agents.calls[0].meta.cwd).toBe(result.cwd)
    // preset 与模型：与票 10 同一套（preset 挂载 + agentOptions）。
    expect(agents.calls[0].meta.agentPreset).toBe('standard')
    expect(agents.calls[0].agentOptions).toEqual({ provider: 'fake-provider', model: 'fake-model' })
    expect(typeof agents.calls[0].setup).toBe('function')
    // 不 attach 到 workspace（ADR-0009 第 3 条）。
    expect(agents.calls[0].meta.workspaceId).toBeUndefined()
  })

  it('种子**真的发出去了**：followup 的消息文本首行就是 /writing-skills', async () => {
    const { methods, agents } = scene()
    await methods['workflow.create']({ seed: '每周整理行业动态' })

    expect(agents.messages).toHaveLength(1)
    const text = messageText(agents.messages[0].message)
    expect(text.split('\n')[0]).toBe('/writing-skills')
    expect(text).toContain('每周整理行业动态')
    // 普通用户消息（source.kind='user'）—— 种子里的话用户没说，但它确实是本轮的输入。
    expect(agents.messages[0].message.source.kind).toBe('user')
    expect(agents.messages[0].message.role).toBe('user')
  })

  it('没写 seed 也让会话开得起来，但种子明写「先问清要求」（不替用户编）', async () => {
    const { methods, agents } = scene()
    await methods['workflow.create']({})
    const text = messageText(agents.messages[0].message)
    expect(text.split('\n')[0]).toBe('/writing-skills')
    expect(text).toMatch(/先问清/u)
    expect(seedText('')).toContain('先问清')
  })

  it('清单先有会话才有：落盘的是本会话的旁挂清单（schema + 名字取自 seed）', async () => {
    const { sandbox, methods } = scene()
    const { sessionId } = await methods['workflow.create']({ seed: '报价单生成' })
    const record = JSON.parse(sandbox.read(sandbox.path('dsh-home', 'xuanshu', 'workflow', `${sessionId}.json`)))
    expect(record.schema).toBe(WORKFLOW_SCHEMA)
    expect(record.sessionId).toBe(sessionId)
    expect(record.name).toBe('报价单生成')
    expect(record.exportedAt).toBeUndefined()
  })

  it('能力门：缺 agentPresets 或 agentDefaultModel → 抛可读错误，且**一次都没建会话**', async () => {
    for (const parts of [{ presets: false }, { model: false }]) {
      const { methods, agents } = scene(parts)
      await expect(methods['workflow.create']({ seed: 'x' })).rejects.toThrow(/agentPresets|agentDefaultModel/u)
      expect(agents.calls).toEqual([])
    }
  })

  it('建会话失败 → 抛可读错误，且**不留**一份没有会话的清单（门厅不出现点不开的条目）', async () => {
    const { sandbox, methods } = scene({ agentsFail: true })
    await expect(methods['workflow.create']({ seed: 'x' })).rejects.toThrow(/建工作流会话失败/u)
    expect(sandbox.files().filter((file) => file.includes('/workflow/'))).toEqual([])
  })

  it('workflow.list：空 → 空列表；建过之后一条，字段是 {id,name,sessionId}（没导出就没有 exportedAt 键）', async () => {
    const { methods } = scene()
    expect(await methods['workflow.list']({})).toEqual({ items: [] })
    const { sessionId } = await methods['workflow.create']({ seed: '报价单生成' })
    const listed = await methods['workflow.list']({})
    expect(listed.items).toHaveLength(1)
    expect(listed.items[0]).toEqual({ id: sessionId, name: '报价单生成', sessionId })
    expect(Object.prototype.hasOwnProperty.call(listed.items[0], 'exportedAt')).toBe(false)
  })

  it('工作流不是谱：dataDir 下只有 workflow/（不碰 pus/，也不产生任何谱条目）', async () => {
    const { sandbox, methods } = scene()
    await methods['workflow.create']({ seed: 'x' })
    const dirs = sandbox.files().map((file) => file.split('/').slice(0, 4).join('/'))
    expect(dirs.some((entry) => entry.includes('/pus'))).toBe(false)
    expect(sandbox.exists(sandbox.path('dsh-home', 'xuanshu', 'pus'))).toBe(false)
  })
})

describe('票16 · 数据目录与 skill 根的同源口径', () => {
  it('resolveDshHome：显式 dshHome 优先；dataDir 是 <dshHome>/xuanshu 时取其父目录', () => {
    expect(resolveDshHome(makeCtx({}), { dshHome: 'C:\\h' }, 'C:\\other\\xuanshu')).toBe('C:\\h')
    expect(resolveDshHome(makeCtx({}), {}, 'C:\\h\\xuanshu')).toBe('C:\\h')
    expect(resolveDshHome(makeCtx({ profileContext: { home: 'C:\\p' } }), {}, 'C:\\h\\xuanshu')).toBe('C:\\p')
  })
})
