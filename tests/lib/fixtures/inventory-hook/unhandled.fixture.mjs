/**
 * tests/lib/fixtures/inventory-hook/unhandled.fixture.mjs —— 清单门 N1 的第三种真实形状夹具：
 * **断言全绿**，只有一个定时器抛出未处理错误。
 *
 * 这种形状的恶劣之处：vitest 的 JSON 报告里 `success` 仍是 `true`、0 条失败、没有文件级失败 ——
 * 只剩 reporter 文本里的 `⎯⎯ Unhandled Errors ⎯⎯` 段与退出码 1。所以门的判据必须**独立**收它，
 * 而且不能做成「没有任何失败时才看它」（仓库常态有已知红在跑，那样等于没看）。
 */
import { expect, it } from 'vitest'

it('passing assertion plus unhandled', async () => {
  // 抛在断言之外的宏任务里：vitest 把它记成 unhandled error，而不是这条用例的失败。
  setTimeout(() => {
    throw new Error('FIXTURE: NEW_UNHANDLED_ERROR（清单门 N1 的第三种形状）')
  }, 1)
  expect(true).toBe(true)
})
