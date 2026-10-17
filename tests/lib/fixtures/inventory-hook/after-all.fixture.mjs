/**
 * tests/lib/fixtures/inventory-hook/after-all.fixture.mjs —— 清单门 R1 的**第三种真实报告形状**夹具：
 * 一条**已知红**断言 + `afterAll` 抛错。
 *
 * 复核 32216d9 的 R1 实测：`afterAll` 在断言**全部执行完**之后才抛错，所以
 *   - 文件 `status: 'failed'`（`success: false`、`numFailedTestSuites: 1`）；
 *   - 里面的用例**跑过了**、状态是 `failed`（已知红）、**没有 skipped**（`numPendingTests: 0`）；
 *   - 当时 JSON 中的 hook 证据是文件级 `result.message`，正好等于下面那次抛错的文本。
 * 于是「没有失败断言 **或** 有 skipped 用例」的旧判据两条都不成立 —— 这个文件整个漏报，
 * 现在生产门通过专用 reporter 独立收 hook 错误；空消息反例另由 inventory-errors 夹具覆盖。
 *
 * 刻意不叫 `.test.mjs`：它**一定会红**，而仓库自己的 vitest include 会收 tests 下的 `.test.mjs`。
 */
import { afterAll, expect, it } from 'vitest'

afterAll(() => {
  // 消息保持与复核证据（.scratch/review-322-standards/after-all-report.json）逐字一致：
  // 保留具名 hook 错误，与 inventory-errors 的空消息 hook 一起验证独立错误通道。
  throw new Error('NEW_AFTER_ALL_ERROR')
})

it('known red', () => {
  expect(1).toBe(2)
})
