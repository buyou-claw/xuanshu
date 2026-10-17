/**
 * scripts/setup/exit.mjs — 票 05 setup 的退出码表与错误类型。
 *
 * 契约出处：`.scratch/assembly-foundation/notes/setup-contract.md` §8（冻结）。这张表是**对外接口**：
 * runbook、CI、`tests/setup/**` 都拿它判分，所以键名与数值都不许就地魔改。
 *
 * 与票 04 的 `scripts/isolation/defaults.mjs` EXIT（ok/usage/environment/isolation）**不是**同一张表：
 * 那张表描述「隔离启动器」的三种处置（改用法 / 修环境 / 腾端口），这张多了「取件失败」「安装失败」
 * 「自检失败」三码 —— 它们的处置完全不同（换镜像 or 离线件 / 修安装 / 看自检证据）。
 *
 * 本文件是纯数据 + 一个错误类：不读环境变量、不碰文件系统。
 */

/**
 * 冻结的退出码。
 *   ok          0  全部步骤 + 三条自检通过
 *   usage       1  参数非法、未预期异常
 *   fetch       2  取件/校验失败（缺件、下载失败、SHA256 不匹配、pin 无当前平台）
 *   environment 3  环境门拒绝（uv 缺失、win32 非 ASCII runtime 根、真实 ~/.dsh 未显式 --install、8765 occupied-foreign）
 *   install     4  安装失败（install --archive 非 0、runtime 版本 ≠ pin、install-profile/pnpm 失败）
 *   selfcheck   5  自检失败（C1/C2/C3 任一 false）
 */
export const EXIT = Object.freeze({
  ok: 0,
  usage: 1,
  fetch: 2,
  environment: 3,
  install: 4,
  selfcheck: 5,
})

/** 人读标签（报告 notes 与人类摘要里用它，而不是裸数字）。 */
export const EXIT_LABELS = Object.freeze({
  0: '成功',
  1: '用法/未知错误',
  2: '取件/校验失败',
  3: '环境门拒绝',
  4: '安装失败',
  5: '自检失败',
})

/** 退出码 → 人读标签；未知码不抛，返回「未知(N)」方便报告原样记下。 */
export function exitLabel(code) {
  return EXIT_LABELS[code] ?? `未知(${code})`
}

/**
 * setup 的**唯一**错误形态：带退出码 + 证据 + 处置建议。
 *
 * 为什么不让模块各自 `process.exit`：退出码必须与报告**同源**（报告落盘、退出码返回，两处说的是同一件事）。
 * 抛错 → 顶层翻译成 `report.exitCode` + 一行人读摘要，是唯一能保证两者不漂移的形状。
 */
export class SetupError extends Error {
  constructor(message, { code = EXIT.usage, evidence, hint, notes } = {}) {
    super(message)
    this.name = 'SetupError'
    this.code = code
    if (evidence !== undefined) this.evidence = evidence
    if (hint !== undefined) this.hint = hint
    if (notes !== undefined) this.notes = notes
  }
}
