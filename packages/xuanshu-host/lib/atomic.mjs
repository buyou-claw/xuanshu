/**
 * packages/xuanshu-host/lib/atomic.mjs — 原子写一个小文本文件（同目录 tmp + rename）。
 *
 * 本仓库已有两处同款实现（`rikke/store.mjs` / `digao/store.mjs`）。#24 又要写三份新文件
 * （`rikke-settings.json` / `shell-settings.json` / `traffic.jsonl` 的标已读重写），再各抄一份就是
 * 第五、第六份 —— 本仓库为「同一判据抄六份然后漂移」付过代价（见 `tests/lib/sandbox-prune.mjs`
 * 的头部）。新代码一律走这里；老的两处暂不动（改动面越大，回归越难界定，登记在交付报告里）。
 *
 * 语义与老实现一致：先写临时文件（`wx`：不覆盖已存在的 tmp），再 rename 覆盖目标；失败清掉 tmp，
 * 绝不留下半份 JSON（半份会被读面当成 error，用户看到的是「产物消失」）。
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * @param {string} file 目标文件
 * @param {string} text 完整正文
 * @returns {string} `file`（方便链式返回落点）
 */
export function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' })
  try {
    renameSync(tmp, file)
  } catch (error) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* 临时文件清不掉不掩盖原错误 */
    }
    throw error
  }
  return file
}
