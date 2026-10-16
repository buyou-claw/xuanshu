/**
 * tests/lib/fixtures/inventory-hook/vitest.config.mjs —— 只收本目录两个夹具文件的 vitest 配置。
 *
 * 清单门 N1 的回归用例用它跑一次**真实** vitest：判据本身可以拿合成报告测，但「vitest 报出来的形状」
 * 必须由真 vitest 说了算（评审两轮的发现都是「对报告形状的假设错了」）。
 * 路径相对 `root`（= 调用时的工作目录 = 仓库根）写。
 */
export default {
  test: {
    include: [
      'tests/lib/fixtures/inventory-hook/hook-failure.mjs',
      'tests/lib/fixtures/inventory-hook/mixed.fixture.mjs',
      'tests/lib/fixtures/inventory-hook/unhandled.fixture.mjs',
    ],
    exclude: [],
    fileParallelism: false,
  },
}
