/**
 * 票 30（#30）· 「我的数据」的体积口径（宿主 `data.overview`）。
 *
 * 冻结契约：`.scratch/notes/spec002/contract-data-backup.md` §1（8 组、`xuanshu/data@1`）。
 * 断言只打在**宿主公开方法**（`data.overview`）上 —— 不 import 内部的扫描函数，
 * 这样「哪一组算哪几个路径」「怎么递归」都可以重写而不会让这些用例变成实现耦合。
 *
 * 环境：临时 home + 临时 dataDir，小文件；不联网、不装 profile、不碰真实 home。
 * 独立事实来源：字节数与文件数由用例自己 `writeFile` 的字面量算出，`total` 由前一行的分组值相加。
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDataMethods } from '../../packages/xuanshu-host/lib/data/service.mjs'

/** 写一个小文件；返回实际的 UTF-8 字节数（用例自己的独立账本）。 */
async function writeFileOf(dir, name, text) {
  const file = join(dir, name)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, text, 'utf8')
  return Buffer.byteLength(text, 'utf8')
}

/** 建一个只服务 `data.*` 的 ctx 桩：任何服务都取不到（方法组不得依赖宿主服务）。 */
function noServices() {
  return {
    get() {
      throw new Error('data.* 不该依赖任何宿主 service')
    },
  }
}

describe('票 30 · data.overview 的 8 组体积（契约 §1）', () => {
  let root
  let home
  let dataDir
  let expected
  let overview

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'xs-data-overview-'))
    home = join(root, 'home')
    dataDir = join(home, 'xuanshu')
    await mkdir(dataDir, { recursive: true })

    // 谱：两层目录 + 两个文件（递归）
    const puBase = join(dataDir, 'pus', '_base')
    const puFile = join(dataDir, 'pus', 'me', 'content.md')
    const puBytes = await writeFileOf(puBase, 'bazi.md', '八字快照正文')
    await writeFileOf(puFile, 'content.md', '我的谱内容')
    const puBytes2 = await writeFileOf(join(dataDir, 'pus'), 'single.md', '单文件变体')
    expected = {
      pu: { bytes: puBytes + puBytes2 + Buffer.byteLength('我的谱内容', 'utf8'), files: 3 },
    }

    // 藏：登记表（只存指针）
    const cangBytes = await writeFileOf(join(dataDir, 'cang'), 'registry.jsonl', '{"id":"a"}\n')
    expected.cang = { bytes: cangBytes, files: 1 }

    // 底稿：两个文件
    const digaoMd = await writeFileOf(dataDir, 'digao.md', '# 底稿')
    const digaoJson = await writeFileOf(dataDir, 'digao.json', '{"segments":0}')
    expected.digao = { bytes: digaoMd + digaoJson, files: 2 }

    // 事记：单文件
    expected.shiji = { bytes: await writeFileOf(dataDir, 'shiji.jsonl', '{"event":1}\n'), files: 1 }

    // 问事与会话 = <home>/sessions（不在 dataDir 里）
    const s1 = await writeFileOf(join(home, 'sessions', '--proj--', 's1'), 'session.v4.jsonl', '{"t":1}\n')
    const s2 = await writeFileOf(join(home, 'sessions', '--proj--', 's1'), 'session.v4.jsonl.zstd', 'zzzz')
    expected.consult = { bytes: s1 + s2, files: 2 }

    // 存储
    expected.storages = { bytes: await writeFileOf(join(home, 'storages'), 'schedule.json', '[]'), files: 1 }

    // skills
    const skill = await writeFileOf(join(home, 'skills', 'write'), 'SKILL.md', '---\nname: write\n---')
    expected.skills = { bytes: skill, files: 1 }

    // 其它 = dataDir 下未被前几组覆盖的条目（rikke / assembly-report.json）
    const rikke = await writeFileOf(join(dataDir, 'rikke'), '2026-10-17.json', '{"a":1}')
    const report = await writeFileOf(dataDir, 'assembly-report.json', '{"ok":true}')
    expected.other = { bytes: rikke + report, files: 2 }

    // 凭据：绝不进任何组（它既不计体积也不进备份）
    await writeFileOf(home, '.credentials.yaml', 'deepseek: sk-should-never-be-counted')

    // 缺失组（没有建档的组）按 0 / 0 —— 这里先删掉 skills 之外的场景由下一条用例覆盖。

    const methods = createDataMethods(noServices(), { home, dataDir })
    overview = await methods['data.overview']()
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('schema / home / dataDir 原样回传（home 与数据目录是两件事，不混用）', () => {
    expect(overview.schema).toBe('xuanshu/data@1')
    expect(overview.home).toBe(home)
    expect(overview.dataDir).toBe(dataDir)
  })

  it('分类固定为 8 组、顺序即展示顺序', () => {
    expect(overview.groups.map((group) => group.id)).toEqual([
      'pu',
      'cang',
      'digao',
      'shiji',
      'consult',
      'storages',
      'skills',
      'other',
    ])
    expect(overview.groups.map((group) => group.label)).toEqual([
      '谱',
      '藏',
      '底稿',
      '事记',
      '问事与会话',
      '存储',
      'skills',
      '其它',
    ])
  })

  it('每组的 bytes / files 是递归真实值（文字量由用例自己算）', () => {
    const byId = Object.fromEntries(overview.groups.map((group) => [group.id, group]))
    for (const [id, want] of Object.entries(expected)) {
      expect({ bytes: byId[id].bytes, files: byId[id].files }, `${id} 的统计`).toEqual(want)
    }
  })

  it('group.path 是指向真实位置的绝对路径（事记/底稿是文件，路径里写清是哪几个）', () => {
    const byId = Object.fromEntries(overview.groups.map((group) => [group.id, group]))
    expect(byId.pu.path).toBe(join(dataDir, 'pus'))
    expect(byId.cang.path).toBe(join(dataDir, 'cang'))
    expect(byId.digao.path).toBe(`${join(dataDir, 'digao.md')} + ${join(dataDir, 'digao.json')}`)
    expect(byId.shiji.path).toBe(join(dataDir, 'shiji.jsonl'))
    expect(byId.consult.path).toBe(join(home, 'sessions'))
    expect(byId.storages.path).toBe(join(home, 'storages'))
    expect(byId.skills.path).toBe(join(home, 'skills'))
    expect(byId.other.path).toBe(dataDir)
  })

  it('total = 8 组之和（不重复计、不遗漏）', () => {
    const sum = overview.groups.reduce(
      (acc, group) => ({ bytes: acc.bytes + group.bytes, files: acc.files + group.files }),
      { bytes: 0, files: 0 },
    )
    expect(overview.total).toEqual(sum)
  })

  it('凭据不计入任何组，且逐条列在 excluded 里并写明原因', () => {
    const credentials = join(home, '.credentials.yaml')
    expect(overview.groups.some((group) => group.path === credentials)).toBe(false)
    expect(JSON.stringify(overview.groups)).not.toContain('sk-should-never-be-counted')
    const entry = overview.excluded.find((item) => item.path === credentials)
    expect(entry, '.credentials.yaml 必须在 excluded 里').toBeTruthy()
    expect(typeof entry.reason).toBe('string')
    expect(entry.reason.length).toBeGreaterThan(0)
    // 每条排除项都要有人话原因（不是空串/占位）。
    for (const item of overview.excluded) expect(item.reason.trim().length).toBeGreaterThan(0)
  })

  it('notes 是字符串数组（正常场景可以是空的，但形状不能变）', () => {
    expect(Array.isArray(overview.notes)).toBe(true)
    for (const note of overview.notes) expect(typeof note).toBe('string')
  })
})

describe('票 30 · data.overview 的缺失组与「不跟随联接外逃」', () => {
  let root

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'xs-data-overview-escape-'))
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('缺失的组 = 0 / 0，不抛错', async () => {
    const home = join(root, 'empty-home')
    const dataDir = join(home, 'xuanshu')
    await mkdir(dataDir, { recursive: true })
    const overview = await createDataMethods(noServices(), { home, dataDir })['data.overview']()
    for (const group of overview.groups) expect({ id: group.id, bytes: group.bytes, files: group.files }).toEqual({ id: group.id, bytes: 0, files: 0 })
    expect(overview.total).toEqual({ bytes: 0, files: 0 })
  })

  it('符号链接 / 目录联接指向 home 之外时：不统计、不抛，并在 notes 里说明跳过了几个', async () => {
    const home = join(root, 'linked-home')
    const dataDir = join(home, 'xuanshu')
    const outside = join(root, 'outside')
    await mkdir(join(home, 'skills'), { recursive: true })
    await mkdir(join(dataDir, 'pus'), { recursive: true })
    await writeFile(join(home, 'skills', 'real.md'), 'real', 'utf8')
    const secretBytes = await writeFileOf(outside, 'huge.bin', 'x'.repeat(4096))

    // 两条联接：一条在 dataDir/pus 里（计划外目录），一条在 skills 里（组内目录）。
    let linked = 0
    for (const [target, link] of [
      [outside, join(dataDir, 'pus', 'outside-link')],
      [outside, join(home, 'skills', 'outside-link')],
    ]) {
      try {
        await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
        linked += 1
      } catch {
        // 某些受限环境建不了联接：断言仍然成立（没统计到外逃文件），只是少了这条对照。
      }
    }

    const overview = await createDataMethods(noServices(), { home, dataDir })['data.overview']()
    const byId = Object.fromEntries(overview.groups.map((group) => [group.id, group]))
    expect(byId.pu.bytes).toBe(0)
    expect(byId.skills.files).toBe(1)
    expect(byId.skills.bytes).toBe(Buffer.byteLength('real', 'utf8'))
    expect(byId.other.bytes).toBe(0)
    expect(overview.total.bytes).toBe(byId.skills.bytes)
    expect(overview.total.bytes).not.toBeGreaterThanOrEqual(secretBytes)
    if (linked > 0) expect(overview.notes.join('\n')).toMatch(/链接|联接/)
  })

  it('dataDir 被覆盖成 home 本身时：other 不重复计入其它组，也不计凭据', async () => {
    const home = join(root, 'flat-home')
    await mkdir(home, { recursive: true })
    // 在 home 根下直接铺所有组（模拟 config.dataDir = home 的嵌入方）。
    await writeFileOf(join(home, 'pus'), 'a.md', '谱') // 1 个文件 3 字节
    await writeFileOf(join(home, 'sessions', 's1'), 'session.v4.jsonl', '{"s":1}') // 7 字节
    await writeFileOf(join(home, 'storages'), 'schedule.json', '[]') // 2 字节
    await writeFileOf(join(home, 'skills', 'sk'), 'SKILL.md', 'sk') // 2 字节
    await writeFileOf(home, '.credentials.yaml', 'key: sk-nope')
    await writeFileOf(home, 'assembly-report.json', '{}') // 2 字节 → 只该落进 other

    const overview = await createDataMethods(noServices(), { home, dataDir: home })['data.overview']()
    const byId = Object.fromEntries(overview.groups.map((group) => [group.id, group]))
    expect(byId.pu).toMatchObject({ bytes: 3, files: 1 })
    expect(byId.consult).toMatchObject({ bytes: 7, files: 1 })
    expect(byId.storages).toMatchObject({ bytes: 2, files: 1 })
    expect(byId.skills).toMatchObject({ bytes: 2, files: 1 })
    // other 只算「dataDir 下未被前几组覆盖」的条目：assembly-report.json（凭据绝不算）。
    expect(byId.other).toMatchObject({ bytes: 2, files: 1 })
    expect(JSON.stringify(overview.groups)).not.toContain('sk-nope')
  })
})

describe('票 30 · 装配边界：data.* 不自己重算 home', () => {
  it('缺 home/dataDir 时抛出可读错误（绝不退回 ~/.dsh，也不自己猜一个）', async () => {
    const methods = createDataMethods({}, {})
    await expect(methods['data.overview']()).rejects.toThrow(/home\/dataDir/)
    await expect(methods['data.backup']({ targetDir: tmpdir(), confirmed: true })).rejects.toThrow(/home\/dataDir/)
  })
})

describe('票 30 · 大小上限（契约 §1「统计要有上限，失败时 notes 说明，不抛」）', () => {
  let root
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'xs-data-overview-cap-'))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('文件数超上限时截断统计并在 notes 里说明（不抛）', async () => {
    const home = join(root, 'cap-home')
    const dataDir = join(home, 'xuanshu')
    const pus = join(dataDir, 'pus')
    await mkdir(pus, { recursive: true })
    for (let index = 0; index < 12; index += 1) await writeFile(join(pus, `p${index}.md`), 'x', 'utf8')
    const methods = createDataMethods(noServices(), { home, dataDir, limits: { files: 5 } })
    const overview = await methods['data.overview']()
    const pu = overview.groups.find((group) => group.id === 'pu')
    expect(pu.files).toBeLessThanOrEqual(5)
    expect(overview.notes.join('\n')).toMatch(/上限|截断|跳过/)
  })
})
