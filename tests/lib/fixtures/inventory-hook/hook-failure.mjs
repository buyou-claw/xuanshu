/**
 * tests/lib/fixtures/inventory-hook/hook-failure.mjs —— 清单门 R1 的**真实报告形状**夹具。
 *
 * 刻意不叫 `.test.mjs`：它**一定会红**（`beforeAll` 抛错），而仓库自己的 vitest include 会收
 * tests 目录下所有 `.test.mjs` —— 那样它就混进正常套件里了。
 *
 * 它要复现的形状（评审 R1 的真实反例）：`beforeAll` 抛错时，vitest 的报告是
 *   - 文件 `status: 'failed'`、`numFailedTestSuites ≥ 1`、`success: false`；
 *   - 里面的用例**照样被收集**，但状态是 `skipped`、`numFailedTests: 0`。
 * 只看 `assertion.status === 'failed'` 的判据会**完全漏掉**这一类（报告新鲜、条数不减）。
 */
import { beforeAll, describe, expect, it } from 'vitest'

describe('suite with a broken setup', () => {
  beforeAll(() => {
    throw new Error('FIXTURE: beforeAll 抛错（清单门 R1 的真实形状）')
  })

  it('collected assertion remains present', () => {
    expect(true).toBe(true)
  })
})
