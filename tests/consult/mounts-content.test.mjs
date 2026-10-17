/**
 * 票 12 · 挂载内容读取（`ctx.fs`，S8 §2.1④；事实笔记 E.4）
 *
 * 读的是**真**目录（临时沙箱里现造的文件），`ctx.fs` 用形状照官方 `types.d.ts` 的替身，
 * 写方法一被调用就抛 —— 「一次写都不做」是这一组的硬判据。
 *
 * 抓的真实缺陷/风险：
 *   ① **读了不该读的**：二进制 / 媒体 / 锁文件 / `.git` 进上下文只会挤掉真正有用的内容，
 *      而且体积常常最大 —— 它们必须出现在「裁掉」那一列里（带人话理由），而不是悄悄消失。
 *   ② **读的顺序不稳定**：`listDir` 的返回顺序不保证，直接用它会让同一目录两次读出来不一样，
 *      披露与注入就都不可复现 → 一律按名字排序。
 *   ③ **工作流挂载编内容**：工作流的数据源属票 16（未确认），此时**如实说「还没接上」**，
 *      不许造一层看起来有内容的假层。
 *   ④ **路径不存在就整体报错**：一层读不出来不该把其它层拖下水 —— 记在该层的 `error` 上。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { readDirectoryLayers, readMountLayer } from '../../packages/xuanshu-host/lib/mounts/content.mjs'
import { fakeFsReader, fakeWorkspaceRegistryForMounts, makeHost, makeSandbox } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 一个真工作区目录：文本 / 二进制 / 锁文件 / 隐藏目录 / 子目录 都有。 */
function workspaceDir(label = 'ws') {
  const sandbox = makeSandbox(label)
  roots.push(sandbox)
  const root = sandbox.path('work')
  sandbox.write('work/README.md', '# 打印车间\n排产表在这里。\n')
  sandbox.write('work/a-notes.md', '甲的笔记\n')
  sandbox.write('work/src/main.mjs', 'export const main = 1\n')
  sandbox.write('work/logo.png', 'PNGDATA')
  sandbox.write('work/pnpm-lock.yaml', 'lockfileVersion: 9\n')
  sandbox.write('work/.env', 'SECRET=1\n')
  sandbox.write('work/.git/config', '[core]\n')
  return { sandbox, root }
}

/** 造一个「registry 给出该工作区路径」的宿主 ctx。 */
function hostFor(workspaces) {
  const registry = fakeWorkspaceRegistryForMounts({ workspaces })
  const fs = fakeFsReader()
  const host = makeHost({ services: { workspaceRegistry: registry.service, fs: fs.service } })
  return { host, registry, fs }
}

describe('票 12 · readDirectoryLayers：确定性、只读、不读噪音', () => {
  it('按名字排序读文本文件成段；二进制 / 锁文件 / 隐藏目录进「裁掉」并带理由', async () => {
    const { sandbox, root } = workspaceDir('content')
    const fs = fakeFsReader()
    const read = await readDirectoryLayers(fs.service, root)

    // 顺序稳定（listDir 的顺序不可信 → 实现必须自己排序）
    expect(read.segments.map((segment) => segment.label)).toEqual(['README.md', 'a-notes.md', 'src/main.mjs'])
    expect(read.segments[0].text).toContain('打印车间')
    expect(read.segments[0].chars).toBe([...read.segments[0].text].length)
    const droppedLabels = read.dropped.map((item) => item.label)
    expect(droppedLabels).toContain('logo.png')
    expect(droppedLabels).toContain('pnpm-lock.yaml')
    expect(droppedLabels).toContain('.env')
    expect(droppedLabels).toContain('.git')
    for (const item of read.dropped) expect(item.reason, `${item.label} 缺理由`).toBeTruthy()
    expect(read.error).toBeUndefined()
    // 两次读逐字节一样（可复现）
    const again = await readDirectoryLayers(fakeFsReader().service, root)
    expect(again.segments).toEqual(read.segments)
    expect(sandbox.exists('work/README.md')).toBe(true)
  })

  it('**一次写都不做**：fs 的 writeText / editText 从未被调用（E.4 的读放行、写围栏）', async () => {
    const { root } = workspaceDir('content-nw')
    const fs = fakeFsReader()
    await readDirectoryLayers(fs.service, root)
    expect(fs.calls.map((call) => call.name)).not.toContain('writeText')
    expect(fs.calls.map((call) => call.name)).not.toContain('editText')
  })

  it('路径不存在 / 不是目录：给该层的 error，不抛（一层坏不拖累别的层）', async () => {
    const { sandbox, root } = workspaceDir('content-bad')
    const fs = fakeFsReader()
    const missing = await readDirectoryLayers(fs.service, sandbox.path('nope'))
    expect(missing.error).toMatch(/不存在/u)
    expect(missing.segments).toEqual([])
    const file = await readDirectoryLayers(fs.service, sandbox.path('work/README.md'))
    expect(file.error).toMatch(/不是目录/u)
    expect(root).toBeTruthy()
  })

  it('单文件超限：整文件不读，理由里带真实字数与体积（不静默截断）', async () => {
    const { sandbox, root } = workspaceDir('content-big')
    sandbox.write('work/huge.md', 'x'.repeat(500))
    const read = await readDirectoryLayers(fakeFsReader().service, root, { maxFileChars: 300 })
    expect(read.segments.map((segment) => segment.label)).not.toContain('huge.md')
    const item = read.dropped.find((row) => row.label === 'huge.md')
    expect(item.reason).toMatch(/单文件超限/u)
    expect(item.reason).toContain('500')
  })

  it('条目上限：超出的部分进「裁掉」并写明上限（一次最多读 N 个文件）', async () => {
    const { sandbox, root } = workspaceDir('content-cap')
    for (let index = 0; index < 5; index += 1) sandbox.write(`work/n${String(index)}.md`, `第 ${String(index)} 份\n`)
    const read = await readDirectoryLayers(fakeFsReader().service, root, { maxFiles: 3 })
    expect(read.segments).toHaveLength(3)
    expect(read.dropped.some((item) => /目录条目超限/u.test(item.reason))).toBe(true)
  })
})

describe('票 12 · readMountLayer：工作区真读、工作流如实说「还没接上」', () => {
  it('工作区层：head 带路径，段与裁掉两列都在', async () => {
    const { root } = workspaceDir('layer')
    const { host } = hostFor([{ id: 'ws-print', path: root, title: '打印车间' }])
    const layer = await readMountLayer(host.ctx, { kind: 'workspace', id: 'ws-print', label: '打印车间' })
    expect(layer.id).toBe('workspace:ws-print')
    expect(layer.head).toContain('打印车间')
    expect(layer.head).toContain(root)
    expect(layer.segments.map((segment) => segment.label)).toContain('README.md')
    expect(layer.dropped.map((item) => item.label)).toContain('logo.png')
    expect(layer.error).toBeUndefined()
  })

  it('工作区不在 registry 里：给该层的 error（可读），不抛', async () => {
    const { host } = hostFor([])
    const layer = await readMountLayer(host.ctx, { kind: 'workspace', id: 'ws-ghost', label: '幽灵' })
    expect(layer.error).toMatch(/不在 DSH 的工作区清单/u)
    expect(layer.segments).toEqual([])
  })

  it('工作流层：不编内容，给 hint 说明数据源属票 16；也不去读文件系统', async () => {
    const { host, fs } = hostFor([])
    const layer = await readMountLayer(host.ctx, { kind: 'workflow', id: 'wf-1', label: '3D 打印排产' })
    expect(layer.kind).toBe('workflow')
    expect(layer.segments).toEqual([])
    expect(layer.hint).toMatch(/票 16/u)
    expect(fs.calls).toEqual([])
  })

  it('ctx.fs 不可得：该层 error（挂载清单本身仍然保存），不抛', async () => {
    const host = makeHost({ services: {} })
    const layer = await readMountLayer(host.ctx, { kind: 'workspace', id: 'ws-1', label: '无 fs' })
    expect(layer.error).toMatch(/ctx\.fs/u)
  })
})
