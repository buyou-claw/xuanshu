/** 备份遇到不可读源必须失败；概览可以部分统计，但必须说明未知项。 */
import { lstatSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDataMethods } from '../../packages/xuanshu-host/lib/data/service.mjs'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, lstatSync: vi.fn(actual.lstatSync), readdirSync: vi.fn(actual.readdirSync) }
})

let root
let home
let dataDir
let target
beforeEach(async () => {
  const actual = await vi.importActual('node:fs')
  vi.mocked(lstatSync).mockImplementation(actual.lstatSync)
  vi.mocked(readdirSync).mockImplementation(actual.readdirSync)
  root = await mkdtemp(join(tmpdir(), 'xs-data-read-failure-'))
  home = join(root, 'home')
  dataDir = join(home, 'xuanshu')
  target = join(root, 'target')
  await mkdir(join(dataDir, 'pus'), { recursive: true })
  await mkdir(join(home, 'sessions'), { recursive: true })
  await mkdir(target)
  await writeFile(join(dataDir, 'pus', 'keep.md'), 'must be backed up')
})
afterEach(async () => {
  vi.mocked(lstatSync).mockReset()
  vi.mocked(readdirSync).mockReset()
  await rm(root, { recursive: true, force: true })
})

it.each(['lstat', 'readdir', 'other-roots'])('%s 读源失败：不产生声称完整的备份，概览说明部分统计', async (operation) => {
  const actual = await vi.importActual('node:fs')
  const unreadable = operation === 'lstat' ? join(dataDir, 'pus')
    : operation === 'readdir' ? join(home, 'sessions') : dataDir
  const error = Object.assign(new Error('fixture: read denied'), { code: 'EACCES' })
  const mocked = operation === 'lstat' ? lstatSync : readdirSync
  const original = operation === 'lstat' ? actual.lstatSync : actual.readdirSync
  vi.mocked(mocked).mockImplementation((path, ...args) => {
    if (resolve(String(path)) === resolve(unreadable)) throw error
    return original(path, ...args)
  })
  const methods = createDataMethods({}, { home, dataDir })
  const result = await methods['data.backup']({ targetDir: target, confirmed: true })
  expect(result.ok).toBe(false)
  expect(result.error.code).toBe('source-unreadable')
  expect(result.error.message).toContain(unreadable)
  expect(await readdir(target)).toEqual([])
  const overview = await methods['data.overview']()
  expect(overview.notes.join('\n')).toContain(unreadable)
  expect(overview.notes.join('\n')).toMatch(/不完整|至少|未知/)
})
