#!/usr/bin/env node
/**
 * `scripts/ux/assertions/index.mjs` —— 判定谓词注册表（键 = 判据 id）。
 *
 * 一条机器判据一个纯谓词。新增一族 = 加一个 `<族>.mjs` + 在下面加一行。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { D_ASSERTIONS } from './d.mjs'
import { T_ASSERTIONS } from './t.mjs'

/** 全部判定谓词（键 = 判据 id）。 */
export const ASSERTIONS = {
  ...T_ASSERTIONS,
  ...D_ASSERTIONS,
}
