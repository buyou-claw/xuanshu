/**
 * tests/setup/lib/zip.mjs — 造**真的是 zip** 的小归档。
 *
 * 为什么不用空文件冒充归档：契约 §3.2 的缓存命中判据里有「大小等于 pin」，而 §4.2 把归档原样交给
 * 上游 `install --archive`。空文件虽然也能过 SHA256 自洽，却会让「归档类型/字节数」这类断言彻底失去
 * 意义，而且一旦实现里出现 `archiveType` 相关的读取（zip 头 `PK\x03\x04`），fixture 会先炸成假红。
 *
 * 实现方式：**stored（不压缩）**的 zip，自己写 local file header + 中央目录。约 60 行，零依赖，
 * 产出的是真能被 `unzip`/`Expand-Archive` 打开的字节流。
 */

import { Buffer } from 'node:buffer'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** MS-DOS 时间戳（zip 要求）；固定值 → 同样的输入产出逐字节一致的归档。 */
const DOS_TIME = 0x6000 // 12:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1 // 2026-01-01

/**
 * 造一个 stored zip。
 * @param {Array<{name: string, data: Buffer | string}>} entries
 * @returns {Buffer}
 */
export function makeZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // flags: UTF-8 名字
    local.writeUInt16LE(0, 8) // method: stored
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + data.length
  }

  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralBuf, end])
}
