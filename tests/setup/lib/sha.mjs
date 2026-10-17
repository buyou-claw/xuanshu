/**
 * tests/setup/lib/sha.mjs — SHA256 / 字节小工具。
 *
 * 断言台要用它做两件**互相独立**的事：
 *   ① 造 fixture 归档时算它的 sha256，写进「测试自己的 pin」；
 *   ② 校验下载/落盘后的字节（第 1、3、6 条）。
 * 两件事都必须走同一支实现，否则「期望值」与「实际值」可能用了两种口径（比如一个有 BOM 一个没有）。
 *
 * 只使用 node 内置模块。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/** 一段字节的 sha256（小写 hex）。 */
export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 一个文件的 sha256（小写 hex）。文件不存在时抛错，不返回空串——静默返回空串会让校验类断言变成假绿。 */
export function sha256File(path) {
  return sha256Bytes(readFileSync(path))
}
