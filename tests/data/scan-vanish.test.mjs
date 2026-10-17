/**
 * 复核 A2 · 备份把「扫描窗口内消失的文件」判成读失败 → 整单拒绝。
 *
 * 真实触发面：`dataDir/pus/**` 正在被原子替换（写盘先写临时文件再 rename），或另一进程删掉了
 * 目录；`walkFiles` 先 `readdirSync` 看到名字、随后 `lstatSync` 时已经不在（ENOENT）。
 * 这不是「读不动」——它是**并发/原子替换的正常形状**，不应该让整次备份失败；
 * 但也不能假装备份全了：要逐条记进 `manifest.skipped`（带原因），用户能对账。
 *
 * 边界（同一文件里成对钉住，防「一律忽略错误」的过度修复）：
 *   - 文件 lstat → ENOENT（depth>0）：skipped，备份成功；
 *   - 目录 readdir → ENOENT（访问中消失）：skipped，备份成功；
 *   - 权限 / IO 错误（EACCES）：仍然致命（`source-unreadable`），绝不静默跳过。
 */
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { lstatSync, readdirSync } from 'node:fs'
import { createDataMethods } from '../../packages/xuanshu-host/lib/data/service.mjs'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, lstatSync: vi.fn(actual.lstatSync), readdirSync: vi.fn(actual.readdirSync) }
})

let actual
let root
let home
let dataDir
let target

beforeEach(async () => {
  actual = await vi.importActual('node:fs')
  vi.mocked(lstatSync).mockImplementation(actual.lstatSync)
  vi.mocked(readdirSync).mockImplementation(actual.readdirSync)
  root = await mkdtemp(join(tmpdir(), 'xs-data-scan-vanish-'))
  home = join(root, 'home')
  dataDir = join(home, 'xuanshu')
  target = join(root, 'target')
  await mkdir(join(dataDir, 'pus', 'sub'), { recursive: true })
  await mkdir(join(home, 'sessions'), { recursive: true })
  await mkdir(target)
  await writeFile(join(dataDir, 'pus', 'keep.md'), 'kept')
  await writeFile(join(dataDir, 'pus', 'vanished.md'), 'gone before copy')
  await writeFile(join(dataDir, 'pus', 'sub', 'inner.md'), 'inner')
})

afterEach(async () => {
  vi.mocked(lstatSync).mockReset()
  vi.mocked(readdirSync).mockReset()
  await rm(root, { recursive: true, force: true })
})

/** 让某一次 `lstatSync(path)` 抛指定错误，其余照真。 */
function failLstat(path, error) {
  vi.mocked(lstatSync).mockImplementation((candidate, ...rest) => {
    if (resolve(String(candidate)) === resolve(path)) throw error
    return actual.lstatSync(candidate, ...rest)
  })
}

/** 让某一次 `readdirSync(path)` 抛指定错误，其余照真。 */
function failReaddir(path, error) {
  vi.mocked(readdirSync).mockImplementation((candidate, ...rest) => {
    if (resolve(String(candidate)) === resolve(path)) throw error
    return actual.readdirSync(candidate, ...rest)
  })
}

it('lstat 时已消失（ENOENT）：备份成功，逐条记 skipped + 原因（不整单拒绝）', async () => {
  const vanished = join(dataDir, 'pus', 'vanished.md')
  failLstat(vanished, Object.assign(new Error('fixture: vanished'), { code: 'ENOENT' }))
  const methods = createDataMethods({}, { home, dataDir })

  const result = await methods['data.backup']({ targetDir: target, confirmed: true })
  expect(result.ok, `扫描窗口内消失的文件不该让备份失败：${JSON.stringify(result.error)}`).toBe(true)
  const paths = result.manifest.items.map((item) => item.path)
  expect(paths).toContain('xuanshu/pus/keep.md')
  expect(paths).not.toContain('xuanshu/pus/vanished.md')
  const skipped = result.manifest.skipped.find((entry) => entry.path === 'xuanshu/pus/vanished.md')
  expect(skipped, '消失的文件必须逐条记进 skipped（用户才能对账）').toBeTruthy()
  expect(skipped.reason).toMatch(/消失|扫描/u)

  // 概览那边同理：瞬时消失不是「读失败」，不该报「统计不完整」。
  const overview = await methods['data.overview']()
  expect(overview.notes.join('\n')).not.toContain('vanished')
})

it('readdir 时目录已消失（ENOENT）：备份成功并得到 skipped（不报 source-unreadable）', async () => {
  const vanishedDir = join(dataDir, 'pus', 'sub')
  failReaddir(vanishedDir, Object.assign(new Error('fixture: directory vanished'), { code: 'ENOENT' }))
  const methods = createDataMethods({}, { home, dataDir })

  const result = await methods['data.backup']({ targetDir: target, confirmed: true })
  expect(result.ok, `目录在访问中消失不该让备份失败：${JSON.stringify(result.error)}`).toBe(true)
  const skipped = result.manifest.skipped.find((entry) => entry.path === 'xuanshu/pus/sub')
  expect(skipped, '消失的目录必须记进 skipped').toBeTruthy()
  expect(skipped.reason).toMatch(/消失|扫描/u)
})

it('EACCES 仍然致命：不许把读不动也当成「并发消失」静默跳过', async () => {
  const denied = join(dataDir, 'pus', 'keep.md')
  failLstat(denied, Object.assign(new Error('fixture: read denied'), { code: 'EACCES' }))
  const methods = createDataMethods({}, { home, dataDir })

  const result = await methods['data.backup']({ targetDir: target, confirmed: true })
  expect(result.ok).toBe(false)
  expect(result.error.code).toBe('source-unreadable')
  expect(result.error.message).toContain(denied)
  expect(await readdir(target), '失败时不许留半份备份').toEqual([])
})
