/**
 * 会话 id 判据的 **parity 用例**（票 17 · 任务 B）
 *
 * 为什么要有这条：同一个判据有两份实现，分属两个独立产物 ——
 *   - 宿主：`packages/xuanshu-host/lib/consult/store.mjs` 的 `isConsultSessionId`（严格正则）；
 *   - 客户端：`packages/xuanshu-client/src/client/sediment-model.ts` 的 `isConsultSessionId`。
 * 曾经客户端只判 `startsWith` 前缀，于是「客户端亮起沉淀按钮、服务端拒绝」的 id 可以存在
 * （`session-xs-consult-a b`、`…-ab/cd`、`…-咨询`…）。两份实现互不校验，就等于**没有判据** ——
 * 与本轮 task-16 的 pruneStale 是同一条教训。
 *
 * 这里不去强行共享代码（两个包各自打包、各自发布），而是**用同一组边界样例互锁**：
 * 逐例断言两边结论相同。另有一条**会红的对照**：把一边换回「只判前缀」的旧实现，
 * parity 必须**报出分歧** —— 否则这条 parity 用例本身也是恒真的。
 */
import { describe, expect, it } from 'vitest'

import { isConsultSessionId as hostAccepts } from '../../packages/xuanshu-host/lib/consult/store.mjs'
import {
  CONSULT_SESSION_PREFIX, isConsultSessionId as clientAccepts,
} from '../../packages/xuanshu-client/src/client/sediment-model.ts'

/** 边界样例：合法的、只差一点的、以及各种「看着像但不是」的。 */
const SAMPLES = [
  // 合法
  'session-xs-consult-1a2b3c',
  'session-xs-consult-ABC.def_ghi-123',
  'session-xs-consult-a',
  `session-xs-consult-${'x'.repeat(400)}`,
  // 只有前缀 / 前缀后为空
  CONSULT_SESSION_PREFIX,
  'session-xs-consult',
  'session-xs-',
  // 别的前缀（工作流 / 别的票）
  'session-xs-workflow-1a2b3c',
  'session-xs-digao-1a2b3c',
  'session-1a2b3c',
  // 字符集外
  'session-xs-consult-a b',
  'session-xs-consult-ab/cd',
  'session-xs-consult-ab%20',
  'session-xs-consult-咨询',
  'session-xs-consult-a\nb',
  'session-xs-consult-a\tb',
  'session-xs-consult-a+b',
  'session-xs-consult-a:b',
  // 非字符串
  undefined,
  null,
  123,
  {},
  ['session-xs-consult-1a2b3c'],
]

/** 逐例对两边的结论，返回分歧清单（空 = 完全一致）。 */
function disagreements(predicateA, predicateB) {
  return SAMPLES.map((sample) => ({ sample, a: predicateA(sample), b: predicateB(sample) }))
    .filter((row) => row.a !== row.b)
}

describe('任务B · 问事会话 id 判据：宿主与客户端逐例一致（parity）', () => {
  it('同一组边界样例，两边结论逐例相同', () => {
    expect(disagreements(hostAccepts, clientAccepts)).toEqual([])
  })

  it('样例里既有被接受的也有被拒绝的（不是一组恒真的样例）', () => {
    const accepted = SAMPLES.filter((sample) => hostAccepts(sample))
    const rejected = SAMPLES.filter((sample) => !hostAccepts(sample))
    expect(accepted.length).toBeGreaterThan(0)
    expect(rejected.length).toBeGreaterThan(0)
  })

  it('**会红的对照**：把客户端换回「只判前缀」的旧实现 → parity 必须报出分歧', () => {
    // 这就是修复前的客户端判据（只判前缀、不判字符集）。
    const oldClientRule = (value) => typeof value === 'string'
      && value.startsWith(CONSULT_SESSION_PREFIX)
      && value.length > CONSULT_SESSION_PREFIX.length
    const found = disagreements(hostAccepts, oldClientRule)
    expect(found.length, '旧实现与宿主的分歧必须能被这条用例抓出来（否则这条用例是恒真的）').toBeGreaterThan(0)
    // 分歧的正是那些「看着像、其实服务端会拒」的 id。
    expect(found.map((row) => row.sample)).toContain('session-xs-consult-a b')
    expect(found.map((row) => row.sample)).toContain('session-xs-consult-咨询')
    expect(found.every((row) => row.a === false && row.b === true)).toBe(true)
  })
})
