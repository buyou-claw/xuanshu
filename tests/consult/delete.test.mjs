/**
 * `consult.delete` · 回收一次问事（2026-11-03 加的可回收性）
 *
 * 这条方法只做一件事：**把玄枢自己的旁挂索引删掉**，让「问事历史」里不再有一条删不掉的记录。
 * 边界同样重要，所以测试分两组：
 *   - 该删的：文件下线、列表随之少一条、别的会话一个字节都不动；
 *   - 不该做的：不存在要报错（不静默成功）、id 形状不对要报错、**不越界删 DSH 的会话记录**
 *     （上游 rc.2 没有给第三方删会话的接口；响应里 `sessionStorageKept: true` 就是这条边界）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { consultManifestPath, isConsultSessionId } from '../../packages/xuanshu-host/lib/consult/store.mjs'
import {
  fakeAgentDefaultModel,
  fakeAgentPresets,
  fakeAgents,
  fakeSessionStore,
  fakeWorkspaceRegistry,
  makeHost,
  makeSandbox,
} from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

function scene() {
  const sandbox = makeSandbox('delete')
  roots.push(sandbox)
  const host = makeHost({
    services: {
      agents: fakeAgents().service,
      sessions: fakeSessionStore().service,
      workspaceRegistry: fakeWorkspaceRegistry().service,
      agentPresets: fakeAgentPresets().service,
      agentDefaultModel: fakeAgentDefaultModel().service,
    },
  })
  const api = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir })
  return { sandbox, api }
}

describe('consult.delete · 删旁挂索引（回收），不越界删上游会话', () => {
  it('删掉一条：文件下线、consult.list 少一条，另一条原样还在', async () => {
    const { sandbox, api } = scene()
    const a = (await api['consult.create']({})).session
    const b = (await api['consult.create']({})).session
    expect((await api['consult.list']()).items).toHaveLength(2)

    const otherBefore = readFileSync(consultManifestPath(sandbox.dataDir, b.sessionId), 'utf8')

    const answer = await api['consult.delete']({ sessionId: a.sessionId })

    expect(answer).toEqual({ deleted: true, sessionId: a.sessionId, sessionStorageKept: true })
    expect(existsSync(consultManifestPath(sandbox.dataDir, a.sessionId))).toBe(false)
    const rest = (await api['consult.list']()).items
    expect(rest.map((item) => item.sessionId)).toEqual([b.sessionId])
    // 别人的记录一个字节都不许动。
    expect(readFileSync(consultManifestPath(sandbox.dataDir, b.sessionId), 'utf8')).toBe(otherBefore)
  })

  it('把删掉的那条再读一次：consult.read 报「不存在」，而不是给出半份数据', async () => {
    const { api } = scene()
    const { session } = await api['consult.create']({})
    await api['consult.delete']({ sessionId: session.sessionId })

    await expect(api['consult.read']({ sessionId: session.sessionId })).rejects.toThrow(/不存在/u)
  })

  it('删不存在的会话：报错点名 id，不当成功（界面才不会把「本来就没有」显示成「删掉了」）', async () => {
    const { api } = scene()
    const missing = 'session-xs-consult-00000000-0000-4000-8000-000000000000'
    await expect(api['consult.delete']({ sessionId: missing })).rejects.toThrow(new RegExp(missing, 'u'))
  })

  it('重复删同一条：第二次也报错（幂等在**界面**上成立，不在 RPC 上假装成功）', async () => {
    const { api } = scene()
    const { session } = await api['consult.create']({})
    await api['consult.delete']({ sessionId: session.sessionId })
    await expect(api['consult.delete']({ sessionId: session.sessionId })).rejects.toThrow(/不存在/u)
  })

  it('id 形状不对：拒绝，且**别人的记录一个字节都不动**', async () => {
    const { sandbox, api } = scene()
    const { session } = await api['consult.create']({})
    const keep = consultManifestPath(sandbox.dataDir, session.sessionId)
    const before = readFileSync(keep, 'utf8')

    for (const bad of ['', 'not-a-consult-id', 'session-xs-consult-../../etc/passwd']) {
      await expect(api['consult.delete']({ sessionId: bad })).rejects.toThrow()
      expect(isConsultSessionId(bad)).toBe(false)
    }
    expect(readFileSync(keep, 'utf8')).toBe(before)
  })

  it('请求体缺失 / 不是对象：报错，不把 undefined 当成合法输入', async () => {
    const { api } = scene()
    await expect(api['consult.delete'](undefined)).rejects.toThrow()
    await expect(api['consult.delete']('nope')).rejects.toThrow()
    await expect(api['consult.delete']({})).rejects.toThrow()
  })

  it('旁挂文件坏了也照样能删掉（坏文件正是最想清走的那一条）', async () => {
    const { sandbox, api } = scene()
    const { session } = await api['consult.create']({})
    const file = consultManifestPath(sandbox.dataDir, session.sessionId)
    writeFileSync(file, '{ this is not json', 'utf8')
    // 坏文件进不了 list，但它仍在盘上；delete 按 id 删文件，不依赖能不能解析。
    const answer = await api['consult.delete']({ sessionId: session.sessionId })
    expect(answer.deleted).toBe(true)
    expect(existsSync(file)).toBe(false)
  })

  it('不越界删 DSH 的会话记录：同目录之外的 `sessions/**` 原样还在', async () => {
    const { sandbox, api } = scene()
    const { session } = await api['consult.create']({})
    // 造一份「DSH 的会话记录」旁证（真机上是 $DSH_HOME/sessions/**，玄枢不拥有它）。
    const dshFile = join(sandbox.dataDir, 'sessions', 'session-xs-consult-x.jsonl')
    mkdirSync(join(sandbox.dataDir, 'sessions'), { recursive: true })
    writeFileSync(dshFile, '{"role":"user"}\n', 'utf8')

    await api['consult.delete']({ sessionId: session.sessionId })

    expect(existsSync(consultManifestPath(sandbox.dataDir, session.sessionId))).toBe(false)
    expect(existsSync(dshFile)).toBe(true)
    expect(readFileSync(dshFile, 'utf8')).toBe('{"role":"user"}\n')
  })
})
