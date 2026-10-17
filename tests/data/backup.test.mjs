/**
 * 票 30（#30）· 一键备份（宿主 `data.backup`）。
 *
 * 冻结契约：`.scratch/notes/spec002/contract-data-backup.md` §2。
 * 断言只打在**宿主公开方法**上；清单里每个文件的 sha256 由用例自己用 `node:crypto` 重新算
 * （独立事实来源，不用被测实现的摘要函数），源文件与**复制后**的文件各算一次 —— 这就是
 * 「可逐项对账」的字面意思。
 *
 * 环境：临时 home + 临时目标目录，小文件；不联网、不装 profile、不碰真实 home。
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDataMethods } from '../../packages/xuanshu-host/lib/data/service.mjs'

/** 独立摘要：用例自己算，不 import 被测实现的任何 hash 辅助。 */
async function sha256Of(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

/** 写文件（自动建父目录），返回字节数。 */
async function writeFileOf(dir, name, text) {
  const file = join(dir, name)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, text, 'utf8')
  return Buffer.byteLength(text, 'utf8')
}

/** 清单里的 POSIX 相对路径 → 本机绝对路径。 */
const at = (base, posixPath) => join(base, ...posixPath.split('/'))

/** 递归列出一个目录下所有文件的相对 POSIX 路径（用来断言「备份里到底有什么」）。 */
async function listFiles(dir, prefix = '') {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...await listFiles(join(dir, entry.name), rel))
    else out.push(rel)
  }
  return out.sort()
}

describe('票 30 · 一键备份：目录、清单与逐文件 sha256 对账（契约 §2）', () => {
  let root
  let home
  let dataDir
  let target
  let result
  let sourceSizes

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'xs-data-backup-'))
    home = join(root, 'home')
    dataDir = join(home, 'xuanshu')
    target = join(root, 'backup-target')
    await mkdir(target, { recursive: true })

    sourceSizes = {}
    sourceSizes['xuanshu/pus/_base/bazi.md'] = await writeFileOf(join(dataDir, 'pus', '_base'), 'bazi.md', '四柱：甲子 乙丑 丙寅 丁卯')
    sourceSizes['xuanshu/cang/registry.jsonl'] = await writeFileOf(join(dataDir, 'cang'), 'registry.jsonl', '{"id":"a","path":"C:/x"}\n')
    sourceSizes['xuanshu/digao.md'] = await writeFileOf(dataDir, 'digao.md', '# 底稿\n')
    sourceSizes['xuanshu/digao.json'] = await writeFileOf(dataDir, 'digao.json', '{"segments":0}\n')
    sourceSizes['xuanshu/shiji.jsonl'] = await writeFileOf(dataDir, 'shiji.jsonl', '{"event":"born"}\n')
    sourceSizes['xuanshu/rikke/2026-10-17.json'] = await writeFileOf(join(dataDir, 'rikke'), '2026-10-17.json', '{"yi":[]}')
    sourceSizes['sessions/--proj--/s1/session.v4.jsonl'] = await writeFileOf(
      join(home, 'sessions', '--proj--', 's1'),
      'session.v4.jsonl',
      '{"turn":1}\n{"turn":2}\n',
    )
    sourceSizes['storages/schedule.json'] = await writeFileOf(join(home, 'storages'), 'schedule.json', '[]')
    sourceSizes['skills/write/SKILL.md'] = await writeFileOf(join(home, 'skills', 'write'), 'SKILL.md', '---\nname: write\n---\n')

    // 以下是「必须排除 / 跳过」的东西：
    await writeFileOf(home, '.credentials.yaml', 'deepseek-official:\n  apiKey: sk-live-should-never-be-copied\n')
    await writeFileOf(home, 'cordis.yml', 'plugins: []\n')
    await writeFileOf(home, '.anonymous-user-id', 'machine-id-123\n')
    await writeFileOf(join(dataDir, 'logs'), 'serve.log', 'log line 1\n')
    await writeFileOf(join(home, 'storages'), 'scratch.tmp', 'half-written')
    await writeFileOf(join(home, 'profiles', 'xuanshu'), 'package.json', '{"name":"xuanshu"}')
    await writeFileOf(join(dataDir, 'runtime'), 'shell-notify.json', '{"token":"notification-token-must-stay-local"}')

    const methods = createDataMethods({}, {
      home,
      dataDir,
      clock: () => new Date('2026-10-17T05:06:07Z'),
    })
    result = await methods['data.backup']({ targetDir: target, confirmed: true })
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('成功返回 { ok:true, backupDir, manifest }，目录落在用户自选的 targetDir 下', () => {
    expect(result.ok, JSON.stringify(result.error ?? {})).toBe(true)
    expect(result.backupDir.startsWith(`${target}`)).toBe(true)
    expect(result.backupDir.slice(target.length)).toMatch(/^[\\/]xuanshu-backup-\d{8}-\d{6}(-\d+)?$/)
    expect(existsSync(result.backupDir)).toBe(true)
    expect(result.manifest.schema).toBe('xuanshu/backup@1')
    expect(result.manifest.createdAt).toBe('2026-10-17T05:06:07.000Z')
    expect(result.manifest.home).toBe(home)
    expect(result.manifest.dataDir).toBe(dataDir)
  })

  it('清单每一项的 sha256 + size 与源文件一致（独立重算）', async () => {
    const items = result.manifest.items
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item.path, '清单路径必须是 POSIX 风格（便于逐项对账）').not.toContain('\\')
      const source = at(home, item.path)
      expect(await sha256Of(source), `${item.path} 的源文件摘要`).toBe(item.sha256)
      expect((await stat(source)).size, `${item.path} 的源文件大小`).toBe(item.size)
      const copied = at(result.backupDir, item.path)
      expect(await sha256Of(copied), `${item.path} 的复制后摘要`).toBe(item.sha256)
      expect((await stat(copied)).size).toBe(item.size)
    }
    expect(result.manifest.files).toBe(items.length)
    expect(result.manifest.totalBytes).toBe(items.reduce((sum, item) => sum + item.size, 0))
    expect(result.manifest.totalBytes).toBe(Object.values(sourceSizes).reduce((sum, size) => sum + size, 0))
  })

  it('备份包含业务数据 + 会话 + storages + skills（8 组的实际文件）', () => {
    const paths = new Set(result.manifest.items.map((item) => item.path))
    for (const expected of Object.keys(sourceSizes)) expect(paths, `缺少 ${expected}`).toContain(expected)
  })

  it('备份不含 .credentials.yaml 与任何密钥引用（文件不存在、清单里也没有）', async () => {
    const files = await listFiles(result.backupDir)
    expect(files.some((file) => file.endsWith('.credentials.yaml'))).toBe(false)
    expect(files.some((file) => file.includes('profiles/'))).toBe(false)
    const raw = await readFile(join(result.backupDir, 'manifest.json'), 'utf8')
    expect(raw).not.toContain('sk-live-should-never-be-copied')
    expect(JSON.stringify(result.manifest.items)).not.toContain('.credentials.yaml')
    // 但清单的 excluded 必须**说明**它被排除了（原因要能给人看）。
    const entry = result.manifest.excluded.find((item) => item.path === '.credentials.yaml')
    expect(entry).toBeTruthy()
    expect(entry.reason.length).toBeGreaterThan(0)
  })

  it('日志与 *.tmp 跳过，并在清单 skipped 里各记一条原因', () => {
    const skippedPaths = result.manifest.skipped.map((entry) => entry.path)
    // `logs/**` 按整棵子树记一条（目录本身就是跳过单元），也接受逐文件形态。
    expect(skippedPaths.some((path) => path === 'xuanshu/logs' || path.includes('logs/'))).toBe(true)
    expect(skippedPaths.some((path) => path.endsWith('scratch.tmp'))).toBe(true)
    expect(skippedPaths).toContain('cordis.yml')
    for (const entry of result.manifest.skipped) expect(entry.reason.trim().length).toBeGreaterThan(0)
    const files = result.manifest.items.map((item) => item.path)
    expect(files.some((path) => path.includes('logs/'))).toBe(false)
    expect(files.some((path) => path.endsWith('.tmp'))).toBe(false)
  })

  it('manifest.json 真的落在备份目录里，且与返回的 manifest 一致', async () => {
    const onDisk = JSON.parse(await readFile(join(result.backupDir, 'manifest.json'), 'utf8'))
    expect(onDisk).toEqual(result.manifest)
  })

  it('运行时通知凭据不随备份迁移，并说明排除原因', async () => {
    expect(result.manifest.items.some((item) => item.path.startsWith('xuanshu/runtime/'))).toBe(false)
    expect(result.manifest.excluded).toContainEqual(expect.objectContaining({ path: 'xuanshu/runtime' }))
    for (const file of await listFiles(result.backupDir)) {
      expect(await readFile(at(result.backupDir, file), 'utf8')).not.toContain('notification-token-must-stay-local')
    }
  })

  it('清单路径形如 contract 的例子（相对 home 的 POSIX 路径）', () => {
    expect(result.manifest.items.map((item) => item.path)).toEqual(
      expect.arrayContaining(['xuanshu/pus/_base/bazi.md', 'sessions/--proj--/s1/session.v4.jsonl']),
    )
  })
})

describe('票 30 · 备份的拒收条件（可读原因，不抛异常）', () => {
  let root
  let home
  let dataDir
  let target
  let methods

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'xs-data-backup-refuse-'))
    home = join(root, 'home')
    dataDir = join(home, 'xuanshu')
    target = join(root, 'target')
    await mkdir(join(dataDir, 'pus'), { recursive: true })
    await mkdir(target, { recursive: true })
    await writeFile(join(dataDir, 'pus', 'a.md'), 'x', 'utf8')
    methods = createDataMethods({}, { home, dataDir, clock: () => new Date('2026-10-17T05:06:07Z') })
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('confirmed !== true 一律拒收（no-confirm）', async () => {
    for (const payload of [{ targetDir: target }, { targetDir: target, confirmed: false }, { targetDir: target, confirmed: 'true' }]) {
      const refused = await methods['data.backup'](payload)
      expect(refused.ok).toBe(false)
      expect(refused.error.code).toBe('not-confirmed')
      expect(refused.error.message.length).toBeGreaterThan(4)
    }
    expect(existsSync(join(target, 'xuanshu-backup-20261017-130607'))).toBe(false)
  })

  it('目标等于 / 落在 home 之内 → 拒收（防递归）', async () => {
    const inside = join(home, 'backups')
    await mkdir(inside, { recursive: true })
    for (const targetDir of [home, inside]) {
      const refused = await methods['data.backup']({ targetDir, confirmed: true })
      expect(refused.ok).toBe(false)
      expect(refused.error.code).toBe('target-inside-home')
      expect(refused.error.message).toMatch(/home/)
    }
  })

  it('非绝对路径 / 不存在 / 不是目录 → invalid-target', async () => {
    const fileTarget = join(root, 'not-a-dir.txt')
    await writeFile(fileTarget, 'x', 'utf8')
    for (const targetDir of ['relative/backups', join(root, 'missing-dir'), fileTarget, '', undefined]) {
      const refused = await methods['data.backup']({ targetDir, confirmed: true })
      expect(refused.ok).toBe(false)
      expect(refused.error.code).toBe('invalid-target')
      expect(refused.error.message.length).toBeGreaterThan(4)
    }
  })

  it('目标通过目录联接指向 home 内时也拒收，且不落备份目录', async () => {
    const inside = join(home, 'aliased-backups')
    const alias = join(root, 'backup-alias')
    await mkdir(inside)
    await symlink(inside, alias, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      const refused = await methods['data.backup']({ targetDir: alias, confirmed: true })
      expect(refused.ok).toBe(false)
      expect(refused.error.code).toBe('target-inside-home')
      expect(await readdir(inside)).toEqual([])
    } finally {
      await unlink(alias)
    }
  })

  it('dataDir 覆盖到 home 外时，目标仍不可放进业务数据目录', async () => {
    const externalData = join(root, 'external-data')
    const inside = join(externalData, 'backups')
    await mkdir(inside, { recursive: true })
    const external = createDataMethods({}, { home, dataDir: externalData })
    const refused = await external['data.backup']({ targetDir: inside, confirmed: true })
    expect(refused.ok).toBe(false)
    expect(refused.error.code).toBe('target-inside-data')
    expect(await readdir(inside)).toEqual([])
  })

  it('失败是返回值而不是异常（界面拿到的是可读原因）', async () => {
    const promise = methods['data.backup']({ targetDir: join(root, 'missing'), confirmed: true })
    expect(typeof promise.then).toBe('function')
    const refused = await promise
    expect(refused.ok).toBe(false)
    expect(typeof refused.error.message).toBe('string')
  })
})

describe('备份完整性：遍历达到上限不能把残缺副本报成成功', () => {
  let root
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'xs-data-backup-cap-'))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('dataDir=home 时，凭据库与运行时目录按平台文件名语义排除（Windows 含大写变体）', async () => {
    const home = join(root, 'case-home')
    const target = join(root, 'case-target')
    const platformName = (name) => process.platform === 'win32' ? name.toUpperCase() : name
    await mkdir(join(home, platformName('runtime')), { recursive: true })
    await mkdir(target)
    await writeFile(join(home, platformName('.credentials.yaml')), 'case-sensitive-secret')
    await writeFile(join(home, platformName('runtime'), 'shell-notify.json'), '{"token":"runtime-secret"}')
    await writeFile(join(home, 'keep.md'), 'business data')
    const methods = createDataMethods({}, { home, dataDir: home })
    const overview = await methods['data.overview']()
    expect(overview.total.files).toBe(1)
    const result = await methods['data.backup']({ targetDir: target, confirmed: true })
    expect(result.ok).toBe(true)
    expect(result.manifest.items.map((item) => item.path)).toEqual(['keep.md'])
    for (const file of await listFiles(result.backupDir)) {
      const content = await readFile(at(result.backupDir, file), 'utf8')
      expect(content).not.toContain('case-sensitive-secret')
      expect(content).not.toContain('runtime-secret')
    }
  })

  it.each([
    ['文件数', { files: 1 }],
    ['目录深度', { depth: 0 }],
  ])('%s达到上限：返回可读失败，目标目录无残缺备份', async (_name, limits) => {
    const home = join(root, _name, 'home')
    const dataDir = join(home, 'xuanshu')
    const target = join(root, _name, 'target')
    await mkdir(join(dataDir, 'pus'), { recursive: true })
    await mkdir(target)
    await writeFile(join(dataDir, 'pus', 'a.md'), 'a')
    await writeFile(join(dataDir, 'pus', 'b.md'), 'b')
    const methods = createDataMethods({}, { home, dataDir, limits })
    const refused = await methods['data.backup']({ targetDir: target, confirmed: true })
    expect(refused.ok).toBe(false)
    expect(refused.error.code).toBe('source-limit')
    expect(refused.error.message).toMatch(/上限/)
    expect(await readdir(target)).toEqual([])
  })
})

describe('票 30 · 同一秒两次备份：两个目录，绝不覆盖', () => {
  let root

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'xs-data-backup-collide-'))
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('固定时钟连跑两次 → 目录名加后缀，两次的清单都在', async () => {
    const home = join(root, 'home')
    const dataDir = join(home, 'xuanshu')
    const target = join(root, 'target')
    await mkdir(join(dataDir, 'pus'), { recursive: true })
    await mkdir(target, { recursive: true })
    await writeFile(join(dataDir, 'pus', 'a.md'), 'first', 'utf8')
    const methods = createDataMethods({}, { home, dataDir, clock: () => new Date('2026-10-17T05:06:07Z') })

    const first = await methods['data.backup']({ targetDir: target, confirmed: true })
    // 第二次前改内容：如果实现覆盖了第一次，第一次的清单就会跟着变。
    await writeFile(join(dataDir, 'pus', 'a.md'), 'second!', 'utf8')
    const second = await methods['data.backup']({ targetDir: target, confirmed: true })

    expect(first.ok && second.ok).toBe(true)
    expect(second.backupDir).not.toBe(first.backupDir)
    expect(second.backupDir).toMatch(/-2$/)
    expect(existsSync(join(first.backupDir, 'manifest.json'))).toBe(true)
    expect(existsSync(join(second.backupDir, 'manifest.json'))).toBe(true)
    // 第一次的清单没有被第二次改写（内容摘要不同 ⇒ 两个独立备份）。
    const firstItem = first.manifest.items.find((item) => item.path === 'xuanshu/pus/a.md')
    const secondItem = second.manifest.items.find((item) => item.path === 'xuanshu/pus/a.md')
    expect(firstItem.size).toBe(5) // 'first'
    expect(secondItem.size).toBe(7) // 'second!'
  })
})
