/**
 * 票 11 · 合参状态机（S9 §5/§6；契约 §1）。
 *
 * 断言只打**外部可观察**的东西：控制器快照的阶段性、它发给数据面的请求、以及三动作的朝向。
 * 这几条正是票面验收里「点得动」的部分：
 *   - `[开始合参]` 是**唯一**发起请求的入口（拉动即用；`ask` 只进费用确认框）；
 *   - 跑完只是 `ready`：**没有任何自动采用**（C9）；
 *   - 「停止全部」优先真停；调不到 `bestof.cancel` 时**如实说**后台仍会跑完（Lead 钉过的产品承诺）；
 *   - 没有价表 → 「费用未知」，不许显示 `$0.0000`。
 */
import { describe, expect, it } from 'vitest'

import {
  bestofPhase,
  canAdopt,
  canMerge,
  candidateStatusLabel,
  costLabel,
  createBestofController,
  fallbackNotice,
  judgeUnavailable,
  parseBestofCommand,
  rankTag,
  rankedCandidates,
} from '../../packages/xuanshu-client/src/client/bestof-model.ts'

const SESSION = 'session-xs-consult-9f8e7d6c-0000-4000-8000-000000000000'

/** 一份 view 的样例（形状照宿主 `view()` 的响应）。 */
function view(over = {}) {
  return {
    runId: 'bestof-1',
    sessionId: SESSION,
    question: '这次转岗该不该去',
    candidates: [
      { id: 'c1', angle: 'classic', angleName: '经典派', provider: 'deepseek', model: 'deepseek-chat', status: 'done', text: '第一份正文。', elapsedMs: 1200 },
      { id: 'c2', angle: 'cautious', angleName: '审慎派', provider: 'deepseek', model: 'deepseek-chat', status: 'done', text: '第二份正文。', elapsedMs: 1500 },
    ],
    judge: { mode: 'tool', adoptedId: 'c1', ranking: ['c1', 'c2'], reasons: { c1: '依据足' } },
    adoptedId: null,
    rejected: false,
    finished: true,
    ...over,
  }
}

/** 记录型假数据面。 */
function fakeApi(handlers = {}) {
  const calls = []
  return {
    calls,
    api: {
      async run(payload) {
        calls.push(['run', payload])
        return handlers.run ? handlers.run(payload) : view({ finished: false, judge: { mode: 'pending', adoptedId: null, ranking: [] } })
      },
      async state(payload) {
        calls.push(['state', payload])
        return handlers.state ? handlers.state(payload) : view()
      },
      async adopt(payload) {
        calls.push(['adopt', payload])
        if (handlers.adopt) return handlers.adopt(payload)
        const next = { ...view(), adoptedId: payload.decision === 'reject' ? null : (payload.adoptedId ?? 'merged'), rejected: payload.decision === 'reject' }
        return { bestOf: next }
      },
      async cancel(payload) {
        calls.push(['cancel', payload])
        if (handlers.cancel) return handlers.cancel(payload)
        return { bestOf: { ...view(), judge: { mode: 'skipped', skipped: true, adoptedId: null, ranking: [], error: '已停止' } } }
      },
    },
  }
}

/** 等控制器轮询到稳定（或超时）。 */
async function settle(controller, predicate, { timeout = 500 } = {}) {
  const started = Date.now()
  while (!predicate(controller.snapshot())) {
    if (Date.now() - started > timeout) break
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  return controller.snapshot()
}

describe('外部可观察的行为：三动作都要人点（C9）', () => {
  it('ask 只进费用确认框，一个请求都不发；confirm 才调 bestof.run', async () => {
    const { api, calls } = fakeApi()
    const controller = createBestofController({ api, pollMs: 1 })
    controller.setEnabled(true)

    controller.ask({ question: '这次转岗该不该去', sessionId: SESSION })
    expect(controller.snapshot().phase).toBe('confirm')
    expect(calls).toEqual([])

    await controller.confirm()
    expect(calls[0][0]).toBe('run')
    expect(calls[0][1]).toEqual({ sessionId: SESSION, question: '这次转岗该不该去', angles: ['classic', 'cautious'] })
  })

  it('跑完只剩 ready：adoptedId 仍是 null（判官不会自动采用）', async () => {
    const { api } = fakeApi()
    const controller = createBestofController({ api, pollMs: 1 })
    controller.setEnabled(true)
    controller.ask({ question: '问一句', sessionId: SESSION })
    await controller.confirm()
    const state = await settle(controller, (snapshot) => snapshot.phase === 'ready')

    expect(state.phase).toBe('ready')
    expect(state.view.adoptedId).toBeNull()
    expect(state.view.rejected).toBe(false)
    expect(canAdopt(state.view)).toBe(true)
    expect(canMerge(state.view)).toBe(true)
  })

  it('采用 / 合并 / 否决各自发出正确的请求，并进入对应阶段', async () => {
    const run = async (decision) => {
      const { api, calls } = fakeApi()
      const controller = createBestofController({ api, pollMs: 1 })
      controller.setEnabled(true)
      controller.ask({ question: '问一句', sessionId: SESSION })
      await controller.confirm()
      await settle(controller, (snapshot) => snapshot.phase === 'ready')
      if (decision === 'adopt') await controller.adopt('c2')
      if (decision === 'merge') await controller.merge()
      if (decision === 'reject') await controller.reject()
      return { state: controller.snapshot(), last: calls.at(-1) }
    }

    const adopted = await run('adopt')
    expect(adopted.last).toEqual(['adopt', { runId: 'bestof-1', decision: 'adopt', adoptedId: 'c2' }])
    expect(adopted.state.phase).toBe('adopted')
    expect(adopted.state.view.adoptedId).toBe('c2')

    const merged = await run('merge')
    expect(merged.last).toEqual(['adopt', { runId: 'bestof-1', decision: 'merge' }])
    expect(merged.state.phase).toBe('adopted')
    expect(merged.state.view.adoptedId).toBe('merged')

    const rejected = await run('reject')
    expect(rejected.last).toEqual(['adopt', { runId: 'bestof-1', decision: 'reject' }])
    expect(rejected.state.phase).toBe('rejected')
    expect(rejected.state.view.adoptedId).toBeNull()
  })

  it('设置关着时触发：进 disabled 并说明去哪打开，不发任何请求', async () => {
    const { api, calls } = fakeApi()
    const controller = createBestofController({ api, pollMs: 1 })
    controller.ask({ question: '问一句', sessionId: SESSION })

    expect(controller.snapshot().phase).toBe('disabled')
    expect(controller.snapshot().notice).toMatch(/设置/u)
    expect(calls).toEqual([])
  })

  it('空问题：停在费用确认框并给「写上要合参的问题」，不发送', async () => {
    const { api, calls } = fakeApi()
    const controller = createBestofController({ api, pollMs: 1 })
    controller.setEnabled(true)
    controller.ask({ question: '   ', sessionId: SESSION })
    await controller.confirm()

    expect(controller.snapshot().phase).toBe('confirm')
    expect(controller.snapshot().error).toMatch(/写上要合参的问题/u)
    expect(calls).toEqual([])
  })

  it('宿主能力门失败：错误原文原样进 error 阶段（不假装开始）', async () => {
    const { api } = fakeApi({ run: async () => { throw new Error('这次合参发不出去。宿主缺少 llm：…') } })
    const controller = createBestofController({ api, pollMs: 1 })
    controller.setEnabled(true)
    controller.ask({ question: '问一句', sessionId: SESSION })
    await controller.confirm()
    expect(controller.snapshot().phase).toBe('error')
    expect(controller.snapshot().error).toMatch(/缺少 llm/u)
  })
})

describe('停止全部：优先真停，停不下来就如实说', () => {
  it('调得到 bestof.cancel → 走真实停止，阶段变已停止', async () => {
    const { api, calls } = fakeApi()
    const controller = createBestofController({ api, pollMs: 1 })
    controller.setEnabled(true)
    controller.ask({ question: '问一句', sessionId: SESSION })
    await controller.confirm()
    await settle(controller, (snapshot) => snapshot.phase === 'ready')

    await controller.stop()
    expect(calls.at(-1)[0]).toBe('cancel')
    expect(controller.snapshot().phase).toBe('stopped')
    expect(controller.snapshot().notice).toBeUndefined()
  })

  it('宿主没有这个方法（未知玄枢操作）→ 本地停止 + 明写「后台仍会跑完」', async () => {
    const { api } = fakeApi({ cancel: async () => { throw new Error('未知玄枢操作：bestof.cancel') } })
    const controller = createBestofController({ api, pollMs: 1 })
    controller.setEnabled(true)
    controller.ask({ question: '问一句', sessionId: SESSION })
    await controller.confirm()
    await settle(controller, (snapshot) => snapshot.phase === 'ready')

    await controller.stop()
    const state = controller.snapshot()
    expect(state.phase).toBe('stopped')
    expect(state.notice).toMatch(/后台仍会跑完/u)
    expect(fallbackNotice(state.view)).toMatch(/已停止/u)
  })
})

describe('文案口径：费用、排序 Tag、回落解释', () => {
  it('没有 costUsd → 「费用未知」；有就显示四位小数，部分未知要标出来', () => {
    expect(costLabel(view())).toBe('费用未知')
    expect(costLabel(view({ costUsd: 0, costUsdComplete: true }))).toBe('$0.0000')
    expect(costLabel(view({ costUsd: 0.0043, costUsdComplete: true }))).toBe('$0.0043')
    expect(costLabel(view({ costUsd: 0.0043, costUsdComplete: false }))).toBe('$0.0043（部分未知）')
  })

  it('判官给了有效排序 → 「排序 N」；回落 → 「完成顺序 N」', () => {
    const good = view()
    expect(rankTag(good, 'c2')).toBe('排序 2')
    expect(judgeUnavailable(good)).toBe(false)
    expect(fallbackNotice(good)).toBeUndefined()

    const fallback = view({ judge: { mode: 'tool', adoptedId: 'c2', ranking: ['c2', 'c1'], error: '模型没有调用 submit_judgement…' } })
    expect(judgeUnavailable(fallback)).toBe(true)
    expect(rankTag(fallback, 'c2')).toBe('完成顺序第 1')
    expect(fallbackNotice(fallback)).toMatch(/暂按先完成的一份排前/u)
    expect(fallbackNotice(fallback)).toMatch(/采用与否仍然由你点/u)
  })

  it('展示顺序按判官排序，没排到的跟在后面', () => {
    expect(rankedCandidates(view()).map((candidate) => candidate.id)).toEqual(['c1', 'c2'])
    expect(rankedCandidates(view({ judge: { mode: 'tool', adoptedId: 'c2', ranking: ['c2', 'c1'] } })).map((candidate) => candidate.id)).toEqual(['c2', 'c1'])
  })

  it('候选状态位：生成中 / 失败原因 / 字数（已停止要标出来）', () => {
    expect(candidateStatusLabel({ status: 'running', text: '' })).toBe('生成中…')
    expect(candidateStatusLabel({ status: 'error', text: '', error: 'RATE_LIMIT' })).toBe('失败：RATE_LIMIT')
    expect(candidateStatusLabel({ status: 'done', text: '一二三', elapsedMs: 1200 })).toBe('3 字 · 1.2s')
    expect(candidateStatusLabel({ status: 'stopped', text: '一二三' })).toBe('已停止 · 3 字')
  })

  it('阶段推导：跑完但被人停下是 stopped；只跑了一半是 running', () => {
    expect(bestofPhase(undefined)).toBe('idle')
    expect(bestofPhase(view({ finished: false }))).toBe('running')
    expect(bestofPhase(view(), { skippedByUser: true })).toBe('stopped')
    expect(bestofPhase(view({ rejected: true, adoptedId: null }))).toBe('rejected')
    expect(bestofPhase(view({ adoptedId: 'c1' }))).toBe('adopted')
  })

  it('parseBestofCommand 与控制器共用一个名字表', () => {
    expect(parseBestofCommand('/合参 问题').matched).toBe(true)
    expect(parseBestofCommand('/多模型 问题').matched).toBe(true)
  })
})
