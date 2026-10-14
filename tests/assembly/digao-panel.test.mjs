/**
 * 票 13 · 底稿半边（客户端）的契约与界面断言。
 *
 * 对应票面验收里属于**客户端半**的那几条：
 *   1. 契约 §2 的三个 `digao.*` 方法名**逐字一致**，且**没有**写方法（`digao.write` /
 *      `digao.update` 这类一律不存在——底稿不可手改，要改就改源头）；
 *   2. 契约 §1 的 markdown 形态能被解析成**三路来源分组**（章序固定：谱 → 工作区 → 工作流；
 *      每段首行标记 `【来源：…】`；某一路没内容时该组留在屏上、段数为 0，正文里的「尚无来源」原样可见）；
 *   3. 「纯派生 · 不可手改」徽标**逐字**、面板里**零编辑控件**（无 input / textarea / select /
 *      contenteditable），三个源头跳转齐备（谱 → S5 / 工作区 → DSH / 工作流 → S12）；
 *   4. `installDigao` 在**无 `document` 的 Node** 下安全返回：样式注入被守卫挡掉、注册面照做。
 *
 * 环境：`renderToStaticMarkup`（无 jsdom），因此本文件只断静态界面事实与纯函数；
 * 真浏览器里的点击链路**没有**被本文件覆盖——交付报告里如实标注。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DIGAO_ENDPOINTS, createDigaoApi } from '../../packages/xuanshu-client/src/client/digao-api.ts'
import { parseDigaoMarkdown } from '../../packages/xuanshu-client/src/client/digao-model.ts'

const render = (element) => renderToStaticMarkup(element)

/** 契约 §1 的正文形态（三路 + 工作流留空路），逐字取自冻结契约的骨架规则。 */
const DIGAO_MARKDOWN = [
  '# 底稿',
  '',
  '## 来源：谱',
  '【来源：谱 事业与行业】事业与行业 ▸ 近一年判断',
  '今年以稳为主；4—6 月有一次岗位变动，适合先谈条件再定去留。',
  '源自：pus/事业与行业/内容.md',
  '',
  '【来源：谱 技能与工具】技能与工具 ▸ 常用链',
  '常用链：node / pnpm / vitest。',
  '源自：pus/技能与工具/内容.md',
  '',
  '## 来源：工作区',
  '【来源：工作区 xuanshu（本项目）】xuanshu（本项目） · 扫描于 2026-10-11 07:30',
  '玄枢装配仓库：一个 profile + 两个插件包。',
  '源自：workspace/xuanshu',
  '',
  '## 来源：工作流',
  '尚无来源',
  '',
].join('\n')

/* ───────────────────────── 1. 三个 RPC 方法名（契约 §2） ───────────────────────── */

describe('票 13 · 底稿数据面的方法名逐字对齐契约 §2', () => {
  it('三个方法名是契约表格那一列的原文', () => {
    expect(DIGAO_ENDPOINTS).toEqual({
      status: 'digao.status',
      read: 'digao.read',
      refresh: 'digao.refresh',
    })
  })

  it('没有写方法：不可手改（要改就改源头，契约 §1）', () => {
    const methods = Object.values(DIGAO_ENDPOINTS)
    expect(methods).not.toContain('digao.write')
    expect(methods).not.toContain('digao.update')
    expect(methods.some((method) => /write|update|save|edit/i.test(method)), '底稿数据面不得出现写方法').toBe(false)
  })

  it('三个方法都走 /xuanshu 通道，请求体为空对象（缺省原样透传）', async () => {
    const calls = []
    const ctx = {
      connection: {
        rpc: {
          async call(...args) {
            calls.push(args)
            return { ok: true, value: { exists: false, meta: null } }
          },
        },
      },
    }
    const api = createDigaoApi(ctx)
    await api.status()
    await api.read()
    await api.refresh()
    expect(calls.map((call) => [call[0], call[1]])).toEqual([
      ['/xuanshu', 'digao.status'],
      ['/xuanshu', 'digao.read'],
      ['/xuanshu', 'digao.refresh'],
    ])
  })

  it('RPC 失败时抛出（由调用方决定降级：面板 error 态）', async () => {
    const ctx = { connection: { rpc: { async call() { return { ok: false, error: { message: '底稿读不出来' } } } } } }
    await expect(createDigaoApi(ctx).read()).rejects.toThrow('底稿读不出来')
  })
})

/* ───────────────────────── 2. 来源分组解析（契约 §1 的确定性规则） ───────────────────────── */

describe('票 13 · 底稿 markdown 的来源分组解析', () => {
  const groups = parseDigaoMarkdown(DIGAO_MARKDOWN)

  it('三路分组按章序固定：谱 → 工作区 → 工作流', () => {
    expect(groups.map((group) => group.name)).toEqual(['谱', '工作区', '工作流'])
    expect(groups.map((group) => group.kind)).toEqual(['pu', 'workspace', 'workflow'])
  })

  it('每段首行标记解析出「行内来源标签 + 名称」，正文与「源自：」分列', () => {
    const pu = groups[0]
    expect(pu.segments).toHaveLength(2)
    expect(pu.segments[0].label).toBe('谱')
    expect(pu.segments[0].name).toBe('事业与行业')
    expect(pu.segments[0].body).toContain('今年以稳为主；4—6 月有一次岗位变动')
    expect(pu.segments[0].origin).toBe('pus/事业与行业/内容.md')
    // 「源自：」那一行不再混在正文里（界面上单列一行）。
    expect(pu.segments[0].body).not.toContain('源自：')
    expect(pu.segments[1].name).toBe('技能与工具')
    expect(pu.segments[1].origin).toBe('pus/技能与工具/内容.md')
  })

  it('工作区段带行内标签与「源自：」，段数与来源都在', () => {
    const workspace = groups[1]
    expect(workspace.segments).toHaveLength(1)
    expect(workspace.segments[0].label).toBe('工作区')
    expect(workspace.segments[0].name).toBe('xuanshu（本项目）')
    expect(workspace.segments[0].origin).toBe('workspace/xuanshu')
  })

  it('某一路没内容时组仍在、段数为 0，正文里的「尚无来源」原样保留', () => {
    const workflow = groups[2]
    expect(workflow.segments).toHaveLength(0)
    expect(workflow.note).toBe('尚无来源')
  })

  it('CRLF 与空行不影响解析（文件在 Windows 上被编辑过也一样）', () => {
    const crlf = parseDigaoMarkdown(DIGAO_MARKDOWN.replace(/\n/g, '\r\n'))
    expect(crlf.map((group) => group.segments.length)).toEqual([2, 1, 0])
    expect(crlf[0].segments[0].origin).toBe('pus/事业与行业/内容.md')
  })

  it('形态不符（没有来源章节）时返回空数组：界面据此给「按原文展示」的兜底，不假装解析成功', () => {
    expect(parseDigaoMarkdown('随手写的一点东西，没有来源章节。')).toEqual([])
    expect(parseDigaoMarkdown('')).toEqual([])
  })

  it('未知章节名保留为 other 组（不吞掉文件里出现过的东西）', () => {
    const groups2 = parseDigaoMarkdown('## 来源：藏\n【来源：藏 某条】\n正文\n')
    expect(groups2.map((group) => [group.kind, group.name])).toEqual([['other', '藏']])
    expect(groups2[0].segments[0].label).toBe('藏')
  })
})
