#!/usr/bin/env node
/**
 * `scripts/ux/probes/index.mjs` —— 静态采集器的检查器注册表。
 *
 * 一条机器判据（`check: static`）必须有同 id 的检查器。缺了不是「跳过」，是**报错**：
 * spec 003 的硬门槛是「要么有检查器，要么显式 human-only 并写明为什么机器判不了」，
 * 没有第三条路。所以这里是一张**断言式**的表，不是尽力而为的表。
 *
 * 新增一族 = 加一个 `<族>.mjs` + 在这里加一行。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { T_PROBES } from './t.mjs'

/** 全部静态检查器（键 = 判据 id）。 */
export const STATIC_PROBES = {
  ...T_PROBES,
}

/**
 * 取出某条判据的检查器；缺了抛可读错误（不静默跳过）。
 * @param {{id: string, check: string}} criterion
 * @returns {(ctx: object) => object}
 * @throws {Error} 机器判据没有检查器
 */
export function probeFor(criterion) {
  const probe = STATIC_PROBES[criterion.id]
  if (typeof probe !== 'function') {
    throw new Error(
      `判据 ${criterion.id}（check=${criterion.check}）没有检查器：要么在 scripts/ux/probes/ 里补一条，`
        + '要么把它改成 human-only 并写清「机器判不了的原因」（spec 003 §判据硬门槛 8）',
    )
  }
  return probe
}
