/**
 * tests/lib/fixtures/inventory-hook/mixed.fixture.mjs —— 清单门 N1 的第二种真实形状夹具：
 * **同一个文件里**一条已知红断言 + 另一个 describe 的 `beforeAll` 抛错。
 *
 * 复核 48e0e0a 的 N1 实测：这种「混合」报告里文件是 failed、有一条失败断言（会被已知红豁免）、
 * **还有一条 skipped**（hook 吃掉的）——只把「没有任何失败断言的失败文件」记账，这一类就漏了。
 * 判据（suiteFailures）必须把「失败文件里有没跑起来的用例」也当成文件级失败。
 */
import { beforeAll, describe, expect, it } from 'vitest'

describe('known red suite', () => {
  it('known red', () => {
    expect(1).toBe(2)
  })
})

describe('new broken setup', () => {
  beforeAll(() => {
    throw new Error('FIXTURE: new beforeAll 抛错（N1 的混合形状）')
  })

  it('must actually run', () => {
    expect(true).toBe(true)
  })
})
