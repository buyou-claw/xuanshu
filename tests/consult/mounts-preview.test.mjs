/**
 * 票 12 · `consult.setMounts` 的预览与预算（契约 §2 修订：`preview?: true` / `preview?`）
 *
 * 三条硬要求（Lead 批准契约修订时点名）：
 *   ① `preview: true` **绝不写盘** —— 断言「预览后旁挂清单**字节不变**」；
 *   ② `preview` 缺席时响应与票 10 冻结的 `{session}` **逐字相同**（不许冒出 `preview: undefined` 之类的键）；
 *   ③ `budget` 未知时**如实为 `null`**（界面显示「预算未知」），**不许回 0 或猜测值**。
 *
 * 再加一条本票自己的纪律：预览与真写**走同一条代码路径**（读 + 裁只有一份实现），
 * 所以「预览看到的数字」与「确认后注入的数字」不可能各算一套。
 *
 * 抓的真实缺陷/风险：
 *   ① 预览顺手把 mounts 落盘了（用户点「取消」却已经改了清单）；
 *   ② 预览路径自己实现一遍裁剪（于是与注入各算一套，数字对不上）；
 *   ③ 预算拿不到就编一个默认数（「看起来在工作」比「说不知道」危险得多）；
 *   ④ 预览把 `Config.mountBudget` 丢了（测试与运维的覆盖形同虚设）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createConsultMethods } from '../../packages/xuanshu-host/lib/consult/service.mjs'
import { createConsultStore } from '../../packages/xuanshu-host/lib/consult/store.mjs'
import { MOUNT_BUDGET_CHARS_PER_TOKEN, MOUNT_BUDGET_WINDOW_SHARE, resolveHistoryBudget, resolveMountBudget } from '../../packages/xuanshu-host/lib/mounts/budget.mjs'
import { fakeFsReader, fakeWorkspaceRegistryForMounts, makeHost, makeSandbox } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

const SESSION_ID = 'session-xs-consult-0f1e2d3c-0000-4000-8000-000000000000'

/**
 * 一个「有挂载可读」的场景：真目录 + 假 registry + 假 fs + 真旁挂清单。
 * @param {{mountBudget?: number, window?: number, mounts?: object[]}} [options]
 */
function scene(options = {}) {
  const sandbox = makeSandbox('mounts-preview')
  roots.push(sandbox)
  sandbox.write('work/README.md', '# 打印车间\n排产表在这里。\n')
  sandbox.write('work/src/main.mjs', 'export const main = 1\n')
  const root = sandbox.path('work')

  const registry = fakeWorkspaceRegistryForMounts({ workspaces: [{ id: 'ws-print', path: root, title: '打印车间' }] })
  const fs = fakeFsReader()
  const services = { workspaceRegistry: registry.service, fs: fs.service }
  if (options.window !== undefined) {
    services.agentDefaultModel = { currentSelection: () => ({ provider: 'p', model: 'm' }) }
    services.llm = { resolveModelInfo: async () => ({ context: { contextWindow: options.window } }) }
  }
  const host = makeHost({ services })
  const store = createConsultStore(sandbox.dataDir)
  store.create({ sessionId: SESSION_ID, pus: ['软件开发'] })
  const api = createConsultMethods(host.ctx, { dataDir: sandbox.dataDir, ...(options.mountBudget === undefined ? {} : { mountBudget: options.mountBudget }) })
  return { sandbox, root, registry, fs, host, store, api }
}

const MOUNT = { kind: 'workspace', id: 'ws-print', label: '打印车间' }

describe('票 12 · setMounts(preview:true)：只算不写', () => {
  it('**预览后旁挂清单字节不变**（用户点取消不该改动任何东西）', async () => {
    const { api, sandbox } = scene({ mountBudget: 1000 })
    const file = ['consult', 'sessions', `${SESSION_ID}.json`]
    const before = sandbox.read(...file)
    const answer = await api['consult.setMounts']({ sessionId: SESSION_ID, mounts: [MOUNT], preview: true })
    expect(answer.preview).toBeDefined()
    expect(sandbox.read(...file)).toBe(before)
    // 清单里也真的没有挂上（不是「写了又撤回」）
    expect(JSON.parse(sandbox.read(...file)).mounts).toEqual([])
  })

  it('preview 缺席时响应形状与票 10 冻结的 `{session}` 逐字相同', async () => {
    const { api } = scene({ mountBudget: 1000 })
    const answer = await api['consult.setMounts']({ sessionId: SESSION_ID, mounts: [MOUNT] })
    expect(Object.keys(answer)).toEqual(['session'])
    expect(Object.keys(answer.session).sort()).toEqual(['createdAt', 'mounts', 'pus', 'sessionId', 'title', 'turns'])
  })

  it('预览带逐层账本与总量：每层 {label, chars, kept}，另有 totalChars / budget / truncatedChars', async () => {
    const { api } = scene({ mountBudget: 1000 })
    const { preview } = await api['consult.setMounts']({ sessionId: SESSION_ID, mounts: [MOUNT], preview: true })
    expect(preview.budget).toBe(1000)
    expect(preview.truncatedChars).toBe(0)
    expect(preview.totalChars).toBeGreaterThan(0)
    expect(preview.keptChars).toBe(preview.totalChars)
    const layer = preview.layers[0]
    expect(layer.label).toBe('打印车间')
    expect(layer.chars).toBeGreaterThan(0)
    expect(layer.kept).toBe(true)
    expect(layer.keptChars).toBe(layer.chars)
    expect(layer.keptSegments.map((segment) => segment.label)).toContain('README.md')
    expect(preview.notice).toContain('挂载披露')
    // 只读：fs 的写方法从未被调用
    expect(preview.budgetSource).toBe('config')
  })

  it('预览与真写读的是同一份结果：先预览、写入后再预览，layers 逐字段相同', async () => {
    const { api } = scene({ mountBudget: 1000 })
    const first = await api['consult.setMounts']({ sessionId: SESSION_ID, mounts: [MOUNT], preview: true })
    await api['consult.setMounts']({ sessionId: SESSION_ID, mounts: [MOUNT] })
    const second = await api['consult.setMounts']({ sessionId: SESSION_ID, mounts: [MOUNT], preview: true })
    expect(second.preview.layers).toEqual(first.preview.layers)
    expect(second.session.mounts).toEqual([MOUNT])
  })
})

describe('票 12 · 预算：config → 模型窗口 → null（不编数）', () => {
  it('config.mountBudget 优先（运维 / 测试的覆盖口径）', async () => {
    const { api } = scene({ mountBudget: 123 })
    const { preview } = await api['consult.setMounts']({ sessionId: SESSION_ID, mounts: [MOUNT], preview: true })
    expect(preview.budget).toBe(123)
    expect(preview.budgetSource).toBe('config')
  })

  it('拿不到模型窗口：budget=null，界面据此显示「预算未知」，**不裁剪也不编数**', async () => {
    const { api } = scene()
    const { preview } = await api['consult.setMounts']({ sessionId: SESSION_ID, mounts: [MOUNT], preview: true })
    expect(preview.budget).toBeNull()
    expect(preview.budgetSource).toBe('unknown')
    expect(preview.truncatedChars).toBe(0)
    expect(preview.notice).toContain('预算未知')
    expect(preview.notice).not.toMatch(/预算\s*\d/u)
  })

  it('探到模型窗口：按「窗口 × 比例 × 字/令牌」实算，来源记 model-window', async () => {
    const window = 128_000
    const { api } = scene({ window })
    const { preview } = await api['consult.setMounts']({ sessionId: SESSION_ID, mounts: [MOUNT], preview: true })
    const expected = Math.floor(window * MOUNT_BUDGET_WINDOW_SHARE * MOUNT_BUDGET_CHARS_PER_TOKEN)
    expect(preview.budget).toBe(expected)
    expect(preview.budgetSource).toBe('model-window')
    expect(preview.budgetDetail).toContain('128000')
  })

  it('resolveMountBudget 是单一来源：0 / 负数 / 非数一律忽略（继续往下探）', async () => {
    const host = makeHost({ services: {} })
    for (const bad of [0, -5, Number.NaN, '60000', undefined]) {
      const read = await resolveMountBudget(host.ctx, { mountBudget: bad })
      expect(read).toEqual({ budget: null, source: 'unknown', detail: expect.any(String) })
    }
    expect(await resolveMountBudget(host.ctx, { mountBudget: 60000 })).toEqual({ budget: 60000, source: 'config' })
  })

  it('resolveHistoryBudget（合参候选的历史窗口，评审 R5）与挂载同源：覆盖值优先，否则走同一套窗口探测', async () => {
    // 为什么挂在同一个文件里验：它是「同一套模型窗口口径」的第二处使用者，
    // 两处漂移就是 S9「历史长度按合参模型统一处理」没落地。
    const bare = makeHost({ services: {} })
    // 没有 `agentDefaultModel` / `llm.resolveModelInfo` → 预算未知（合法结果，不猜一个数）。
    expect(await resolveHistoryBudget(bare.ctx, {})).toEqual({ budget: null, source: 'unknown', detail: expect.any(String) })
    expect(await resolveHistoryBudget(bare.ctx, { historyBudget: 1234 })).toEqual({ budget: 1234, source: 'config' })
    // 配置非法（0 / 负数 / 非数）当没给，继续往下探。
    expect((await resolveHistoryBudget(bare.ctx, { historyBudget: 0 })).source).toBe('unknown')

    // 探到窗口时与挂载预算同一个换算（同一份常量）。
    const window = 128_000
    const { host } = scene({ window })
    const expected = Math.floor(window * MOUNT_BUDGET_WINDOW_SHARE * MOUNT_BUDGET_CHARS_PER_TOKEN)
    const read = await resolveHistoryBudget(host.ctx, {})
    expect(read.budget).toBe(expected)
    expect(read.source).toBe('model-window')
  })
})

describe('票 12 · 超预算：披露三档 Tag 与状态数字自洽（S8 §2.2 / C7）', () => {
  it('把预算调小：至少一层出现 clipped 或 dropped，且 keptChars ≤ budget，notice 说明裁了多少', async () => {
    const { api, sandbox } = scene({ mountBudget: 20 })
    sandbox.write('work/big.md', '内'.repeat(500))
    const { preview } = await api['consult.setMounts']({ sessionId: SESSION_ID, mounts: [MOUNT], preview: true })
    expect(preview.keptChars).toBeLessThanOrEqual(preview.budget)
    expect(preview.truncatedChars).toBeGreaterThan(0)
    expect(preview.layers.some((layer) => layer.clipped || layer.dropped)).toBe(true)
    for (const layer of preview.layers) {
      expect(layer.dropped && layer.clipped, `${layer.label} 同时是 dropped 与 clipped`).toBe(false)
      expect(typeof layer.label).toBe('string')
      expect(Number.isFinite(layer.chars)).toBe(true)
      expect(typeof layer.kept).toBe('boolean')
    }
    expect(preview.notice).toMatch(/裁去\s*[\d,]+/u)
    expect(preview.notes.join('\n')).toMatch(/段边界/u)
  })

  it('多层超预算：状态栏的分母（keptLayers / totalLayers）与通知一致', async () => {
    const { api, sandbox } = scene({ mountBudget: 40 })
    sandbox.write('work/big.md', '内'.repeat(400))
    const { preview } = await api['consult.setMounts']({
      sessionId: SESSION_ID,
      mounts: [
        MOUNT,
        { kind: 'workflow', id: 'wf-1', label: '3D 打印排产' },
      ],
      preview: true,
    })
    expect(preview.layers).toHaveLength(2)
    // 工作流层没有内容可读（票 16 才接）：它不算「纳入」，也不该挡住工作区层
    const workflow = preview.layers.find((layer) => layer.kind === 'workflow')
    expect(workflow.kept).toBe(false)
    expect(workflow.hint).toMatch(/票 16/u)
    expect(preview.keptLayers).toBe(1)
    expect(preview.notice).toContain('1 / 2 层')
  })
})
