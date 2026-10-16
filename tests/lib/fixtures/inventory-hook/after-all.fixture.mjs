/**
 * tests/lib/fixtures/inventory-hook/after-all.fixture.mjs —— 清单门 R1 的**第三种真实报告形状**夹具：
 * 一条**已知红**断言 + `afterAll` 抛错。
 *
 * 复核 32216d9 的 R1 实测：`afterAll` 在断言**全部执行完**之后才抛错，所以
 *   - 文件 `status: 'failed'`（`success: false`、`numFailedTestSuites: 1`）；
 *   - 里面的用例**跑过了**、状态是 `failed`（已知红）、**没有 skipped**（`numPendingTests: 0`）；
 *   - 唯一的 hook 证据是文件级 `result.message`，实测正好等于那次抛错的文本（下面那个错误消息）。
 * 于是「没有失败断言 **或** 有 skipped 用例」的旧判据两条都不成立 —— 这个文件整个漏报，
 * 而纯断言失败的文件级 `message` 是**空串**（同目录的 `mixed-report.json` 实测），两形状可区分。
 *
 * 刻意不叫 `.test.mjs`：它**一定会红**，而仓库自己的 vitest include 会收 tests 下的 `.test.mjs`。
 */
import { afterAll, expect, it } from 'vitest'

afterAll(() => {
  // 消息保持与复核证据（.scratch/review-322-standards/after-all-report.json）逐字一致：
  // 门只看「非空」，但用例把 `message === 'NEW_AFTER_ALL_ERROR'` 这一形状钉死。
  throw new Error('NEW_AFTER_ALL_ERROR')
})

it('known red', () => {
  expect(1).toBe(2)
})
