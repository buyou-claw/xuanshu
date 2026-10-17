/**
 * packages/xuanshu-host/lib/digao/store.mjs —— 底稿的**文件契约**（读 / 原子写），票 13 契约 §1。
 *
 * 文件契约：
 *   `<dataDir>/digao.md`    正文（人可读；UI 只读展示）
 *   `<dataDir>/digao.json`  元数据，schema `xuanshu/digao@1`
 *
 * **为什么从这里拆出来**（task-3 的解环笔记）：`digao/service.mjs` 原先自己拿着这几个函数，而
 * `digao/generate.mjs`（生成链，被 `rikke/delivery.mjs` 在到点时调用）也要写这两个文件 ——
 * 若它 import `digao/service.mjs`，模块图就会出现
 * `digao/service → rikke/daily-tasks → rikke/delivery → digao/generate → digao/service` 这个环。
 * 把「文件怎么读怎么写」放在这个**叶子**模块（只 import node 内置 + `skeleton.mjs` 的常量），
 * 环就断在这里。方向是单向的：`service → store`、`generate → store`，store 谁都不 import（业务侧）。
 *
 * **原子写**：同目录临时文件 + rename（与票 08 的快照、日课的 `rikke/store.mjs` 同一套写法）——
 * 刷新到一半断电不会留下半份底稿，而「半份 json」会被 `digao.status` 读成 meta:null，
 * 用户看到的是「底稿消失」而不是「刷新失败」。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { DIGAO_SCHEMA } from './skeleton.mjs'

/** 正文与元数据的文件名（契约 §1 定值）。 */
export const DIGAO_MD = 'digao.md'
export const DIGAO_JSON = 'digao.json'

/** `<dataDir>/digao.md`。 */
export function digaoMarkdownFile(dataDir) {
  return join(dataDir, DIGAO_MD)
}

/** `<dataDir>/digao.json`。 */
export function digaoMetaFile(dataDir) {
  return join(dataDir, DIGAO_JSON)
}

/**
 * 读元数据：**schema 不认识就当没有**（契约 §1 的 schema 是迁移锚点，旧版本的元数据不许被当成新底稿）。
 * @returns {object|null}
 */
export function readDigaoMeta(dataDir) {
  try {
    const parsed = JSON.parse(readFileSync(digaoMetaFile(dataDir), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed.schema === DIGAO_SCHEMA ? parsed : null
  } catch {
    return null
  }
}

/** 读正文（读不出来给空串，不给半截）。 */
export function readDigaoMarkdown(dataDir) {
  try {
    return readFileSync(digaoMarkdownFile(dataDir), 'utf8')
  } catch {
    return ''
  }
}

/** 原子写一个文件（同目录临时文件 + rename；失败清掉临时文件，绝不留下半份）。 */
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

/** 底稿在不在（`digao.status` 用它给 exists；只判正文那一份）。 */
export function digaoExists(dataDir) {
  return existsSync(digaoMarkdownFile(dataDir))
}
