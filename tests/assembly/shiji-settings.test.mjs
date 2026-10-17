/**
 * P4（复核 #26）· 事记的「恢复」与「可排除目录」终于有了设置面。
 *
 * 复核发现底稿面板写着「可以在设置里恢复」（`digao.tsx:409,470`），但设置里根本没有入口：
 * `shiji.restore` / `shiji.settings.get` / `shiji.settings.set` 只到 RPC 面。票面验收要求
 * 「删掉的能恢复、可排除目录能改」落到界面上，而不是让人去敲 RPC。
 *
 * 这组测试钉住客户端半边：
 *   1. 数据面：`shiji.restore({id})` 的 `confirmed:true` 由数据面写死（人确认闸门没有第二个入参）；
 *      `shiji.settings.get/set` 的请求形状逐字对齐宿主；
 *   2. 设置视图：**真实墓碑**（`excludedAt` 非空 —— 人点删除写的就是这个字段）逐条列出 + [恢复]，
 *      删除日期取 `excludedAt`；**仅冻结**（源头消失、`frozenAt` 非空但 `excludedAt` 为 null）的
 *      条目不进这个列表、不冒充「已删除」（C1：冻结与删除不是一件事）；
 *      排除目录逐条列出 + [移除]；输入框 + [添加]；空态如实说「没有被删除的事记」；
 *   3. 槽位：`settings.section` 的一个新分区（id `xuanshu.shiji`，order 排在「我的数据」之后），
 *      **不新增 main key / 侧栏行**。
 *
 * 环境：`renderToStaticMarkup`（无 jsdom）。真浏览器里的点击链路（恢复 → 重读 → 列表变短）
 * **没有**被本文件覆盖 —— 交付报告里如实标注。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SHIJI_ENDPOINTS, createShijiApi } from '../../packages/xuanshu-client/src/client/shiji-api.ts'
import {
  SHIJI_SETTINGS_ID,
  SHIJI_SETTINGS_LABEL,
  SHIJI_SETTINGS_ORDER,
  XsShijiSettingsSection,
  installShijiSettings,
} from '../../packages/xuanshu-client/src/client/shiji-views.tsx'

const render = (element) => renderToStaticMarkup(element)

/**
 * 一条**真实墓碑**：人点了删除，账本只写 `excludedAt`（`packages/xuanshu-host/lib/shiji/ledger.mjs:90-95`）。
 * 源头还在，所以 `frozenAt` 为 null —— 这正是最常见、此前在设置里看不到的那条路径。
 */
const TOMBSTONE = {
  id: 'shiji-aaaaaaaaaaaaaaaa',
  source: 'workspace',
  refId: 'ws-1',
  name: '旧的周报项目',
  summary: '曾经做过周报自动化。',
  firstSeenAt: '2026-09-01T00:00:00.000Z',
  lastActiveAt: '2026-10-01T00:00:00.000Z',
  basis: { sessions: 3, docs: 1 },
  frozenAt: null,
  excludedAt: '2026-10-12T08:00:00.000Z',
}

/**
 * 一条**仅冻结**的事记：源头消失、`frozenAt` 非空，但人**没有删过**它（`excludedAt` 为 null，
 * `ledger.mjs:233-239`）。它不该出现在「已删除（可恢复）」里。
 */
const FROZEN = {
  id: 'shiji-bbbbbbbbbbbbbbbb',
  source: 'workspace',
  refId: 'ws-gone',
  name: '被移走的项目',
  summary: '项目目录已经不在了。',
  firstSeenAt: '2026-08-01T00:00:00.000Z',
  lastActiveAt: '2026-09-20T00:00:00.000Z',
  basis: { sessions: 1, docs: 0 },
  frozenAt: '2026-10-16T00:00:00.000Z',
  excludedAt: null,
}

/** 设置页拿到的就是 `shiji.list({includeDeleted:true})` 的原样条目：墓碑与冻结都在里面。 */
const STATE = {
  entries: [TOMBSTONE, FROZEN],
  excludedDirs: ['node_modules', 'dist'],
  draftDir: 'build',
  busy: false,
}

const ACTIONS = {
  onDraftDirChange: () => {},
  onAddExcludedDir: () => {},
  onRemoveExcludedDir: () => {},
  onRestore: () => {},
}

describe('P4 · 数据面：restore 与 settings 的请求形状', () => {
  it('端点逐字对齐宿主（restore / settings.get / settings.set 都在）', () => {
    expect(SHIJI_ENDPOINTS).toEqual({
      list: 'shiji.list',
      remove: 'shiji.remove',
      restore: 'shiji.restore',
      fromSession: 'shiji.fromSession',
      settingsGet: 'shiji.settings.get',
      settingsSet: 'shiji.settings.set',
    })
  })

  it('restore 的 confirmed:true 写死在数据面里（界面没有第二个入参）；settings.set 透传 excludedDirs', async () => {
    const calls = []
    const api = createShijiApi({
      connection: {
        rpc: {
          async call(channel, method, payload) {
            calls.push([channel, method, payload])
            return { ok: true, value: { ok: true, excludedDirs: payload?.excludedDirs ?? [] } }
          },
        },
      },
    })
    await api.restore({ id: TOMBSTONE.id })
    await api.getSettings()
    await api.setSettings({ excludedDirs: ['node_modules'] })
    expect(calls.map((call) => [call[0], call[1]])).toEqual([
      ['/xuanshu', 'shiji.restore'],
      ['/xuanshu', 'shiji.settings.get'],
      ['/xuanshu', 'shiji.settings.set'],
    ])
    expect(calls[0][2]).toEqual({ id: TOMBSTONE.id, confirmed: true })
    expect(calls[1][2]).toEqual({})
    expect(calls[2][2]).toEqual({ excludedDirs: ['node_modules'] })
  })

  it('settings.set 的 ok:false 折成可读 Error（写操作不许静默）', async () => {
    const api = createShijiApi({
      connection: {
        rpc: {
          async call() {
            return { ok: true, value: { ok: false, error: { code: 'invalid-settings', message: '排除目录必须是相对项目根的路径' } } }
          },
        },
      },
    })
    await expect(api.setSettings({ excludedDirs: ['/abs'] })).rejects.toThrow('相对项目根')
  })
})

describe('P4 · 设置视图：真实墓碑可恢复、冻结的不冒充、排除目录可增删', () => {
  const html = render(h(XsShijiSettingsSection, { state: STATE, actions: ACTIONS }))

  it('真实墓碑（excludedAt 非空）逐条列出：名字 + 删除日期 + [恢复]（带 id）', () => {
    expect(html).toContain('data-xuanshu-section="shiji"')
    expect(html).toContain('旧的周报项目')
    expect(html).toContain('data-xuanshu-shiji="shiji-aaaaaaaaaaaaaaaa"')
    expect(html).toContain('data-xuanshu-action="restore-shiji"')
    expect(html).toContain('恢复')
    // 删除日期取删除动作的时间（excludedAt），可读、不是 ISO 原样。
    expect(html).toContain('2026-10-12')
    // 那条仅冻结的条目没有删除时间：它的 frozenAt 不许被当成「删除于」显示。
    expect(html).not.toContain('2026-10-16')
  })

  it('仅冻结（frozenAt 非空、excludedAt 为 null）的条目不进列表，也不显示「删除于」', () => {
    const frozenOnly = render(h(XsShijiSettingsSection, {
      state: { ...STATE, entries: [FROZEN] },
      actions: ACTIONS,
    }))
    expect(frozenOnly).not.toContain('被移走的项目')
    expect(frozenOnly).not.toContain('data-xuanshu-shiji="shiji-bbbbbbbbbbbbbbbb"')
    expect(frozenOnly).not.toContain('删除于')
    // 一条真的没删过：空态如实说。
    expect(frozenOnly).toContain('没有被删除的事记')
  })

  it('删除日期缺失时显示「日期未知」，仍不拿冻结时间顶替', () => {
    // 判据是「excludedAt 非空」；这个值不可读时只如实说不知道，绝不回落到 frozenAt。
    // （当前宿主把空/非法时间归一成 null，这里是防御分支：换宿主 / 旧数据也守住口径。）
    const noDate = render(h(XsShijiSettingsSection, {
      state: { ...STATE, entries: [{ ...TOMBSTONE, excludedAt: '' }] },
      actions: ACTIONS,
    }))
    expect(noDate).toContain('日期未知')
    expect(noDate).not.toContain('2026-10-16')
  })

  it('恢复后的条目（excludedAt 回到 null）不再算墓碑，回到普通事记', () => {
    const restored = render(h(XsShijiSettingsSection, {
      state: { ...STATE, entries: [{ ...TOMBSTONE, excludedAt: null }] },
      actions: ACTIONS,
    }))
    expect(restored).not.toContain('旧的周报项目')
    expect(restored).not.toContain('data-xuanshu-shiji="shiji-aaaaaaaaaaaaaaaa"')
    expect(restored).toContain('没有被删除的事记')
  })

  it('排除目录逐条列出 + [移除]；输入框 + [添加]', () => {
    expect(html).toContain('data-xuanshu-excluded-dir="node_modules"')
    expect(html).toContain('data-xuanshu-excluded-dir="dist"')
    expect(html).toContain('data-xuanshu-action="remove-excluded-dir"')
    expect(html).toContain('data-xuanshu-field="excluded-dir"')
    expect(html).toContain('data-xuanshu-action="add-excluded-dir"')
    expect(html).toContain('添加')
  })

  it('空态如实说「没有被删除的事记」（不空着让人猜）', () => {
    const empty = render(h(XsShijiSettingsSection, {
      state: { entries: [], excludedDirs: [], draftDir: '', busy: false },
      actions: ACTIONS,
    }))
    expect(empty).toContain('没有被删除的事记')
    expect(empty).toContain('没有排除目录')
  })

  it('busy / 失败/成功说明都可见（写操作不许静默）', () => {
    const busy = render(h(XsShijiSettingsSection, {
      state: { ...STATE, busy: true },
      actions: ACTIONS,
    }))
    expect(busy).toContain('恢复中…')
    const failed = render(h(XsShijiSettingsSection, {
      state: { ...STATE, error: '排除目录不能为空。' },
      actions: ACTIONS,
    }))
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('排除目录不能为空')
    const noted = render(h(XsShijiSettingsSection, {
      state: { ...STATE, note: '已恢复事记「旧的周报项目」。' },
      actions: ACTIONS,
    }))
    expect(noted).toContain('已恢复事记')
  })
})

describe('P4 · 槽位：settings.section 的新分区（纯加性）', () => {
  it('注册 settings.section 一行：id / label / order 固定，不声明 priority / children', () => {
    const injected = []
    const registered = []
    const ctx = {
      slots: {
        inject(name, callback) {
          injected.push(name)
          callback()
          return () => {}
        },
        register(options, component) {
          registered.push({ options, component })
          return () => {}
        },
      },
    }
    installShijiSettings(ctx, { api: createShijiApi({}) })
    expect(injected).toEqual(['settings.section'])
    expect(registered).toHaveLength(1)
    expect(registered[0].options).toMatchObject({
      name: 'settings.section',
      id: SHIJI_SETTINGS_ID,
      order: SHIJI_SETTINGS_ORDER,
      label: SHIJI_SETTINGS_LABEL,
    })
    expect(registered[0].options.priority).toBeUndefined()
    expect(registered[0].options.children).toBeUndefined()
    expect(typeof registered[0].component).toBe('function')
  })

  it('分区身份：id 带 xuanshu 前缀、标签「事记」、order 排在「我的数据」（25）之后', () => {
    expect(SHIJI_SETTINGS_ID).toBe('xuanshu.shiji')
    expect(SHIJI_SETTINGS_LABEL).toBe('事记')
    expect(SHIJI_SETTINGS_ORDER).toBeGreaterThan(25)
  })
})
