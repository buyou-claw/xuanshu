/**
 * 票 30（#30）· 「我的数据」设置页（客户端半边）。
 *
 * 对应票面验收里属于客户端的那几条：
 *   - 分类体积可读（8 组 + 总计 + 排除项原因）；
 *   - 一键备份落用户自选目录：复用 `cang.pickDirectory`（系统目录选择器），不新造第二条原生路径；
 *   - 备份过程不阻塞界面（busy 态 + 阶段文案）、失败给可读原因（不抛到界面）；
 *   - 页面写明：备份**含**会话记录、**不含** `.credentials.yaml` 与任何密钥引用、原因与迁移方法；
 *   - 恢复口径逐项说明，且明确「不提供自动覆盖式恢复」。
 *
 * 环境：`renderToStaticMarkup`（无 jsdom）。真浏览器里的点击链路**没有**被本文件覆盖
 * （交付报告里如实标注）；这里断言的是渲染结果与注册面。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DATA_ENDPOINTS,
  createDataApi,
} from '../../packages/xuanshu-client/src/client/data-api.ts'
import {
  DATA_SECTION_ID,
  DATA_SECTION_LABEL,
  DATA_SECTION_ORDER,
  XsDataSection,
  formatBytes,
  installDataSettings,
} from '../../packages/xuanshu-client/src/client/data.tsx'
import { installRpcFetch, restoreRpcFetch } from './lib/rpc-fetch.mjs'

// 数据面是同源 fetch（`POST /api/xuanshu`），桩装在 fetch 上；漏还原会污染后面的文件。
afterEach(restoreRpcFetch)

const render = (element) => renderToStaticMarkup(element)

/** 一份「有数据」的 overview 夹具：数值由本文件写死（独立于宿主实现）。 */
const OVERVIEW = {
  schema: 'xuanshu/data@1',
  home: 'C:\\Users\\me\\.xuanshu',
  dataDir: 'C:\\Users\\me\\.xuanshu\\xuanshu',
  groups: [
    { id: 'pu', label: '谱', path: 'C:\\Users\\me\\.xuanshu\\xuanshu\\pus', bytes: 2048, files: 3 },
    { id: 'cang', label: '藏', path: 'C:\\Users\\me\\.xuanshu\\xuanshu\\cang', bytes: 12, files: 1 },
    { id: 'digao', label: '底稿', path: 'C:\\Users\\me\\.xuanshu\\xuanshu\\digao.md + digao.json', bytes: 0, files: 2 },
    { id: 'shiji', label: '事记', path: 'C:\\Users\\me\\.xuanshu\\xuanshu\\shiji.jsonl', bytes: 0, files: 0 },
    { id: 'consult', label: '问事与会话', path: 'C:\\Users\\me\\.xuanshu\\sessions', bytes: 1536, files: 2 },
    { id: 'storages', label: '存储', path: 'C:\\Users\\me\\.xuanshu\\storages', bytes: 0, files: 0 },
    { id: 'skills', label: 'skills', path: 'C:\\Users\\me\\.xuanshu\\skills', bytes: 64, files: 1 },
    { id: 'other', label: '其它', path: 'C:\\Users\\me\\.xuanshu\\xuanshu', bytes: 1024, files: 1 },
  ],
  total: { bytes: 4684, files: 10 },
  excluded: [
    {
      path: 'C:\\Users\\me\\.xuanshu\\.credentials.yaml',
      reason: '凭据与密钥引用：既不计体积，也不进备份（密钥留在本机凭据库）',
    },
  ],
  notes: [],
}

/** 假数据面：记录调用（不 mock 业务）。 */
function fakeApi(over = {}) {
  const calls = []
  return {
    calls,
    api: {
      async overview() {
        calls.push(['data.overview'])
        return OVERVIEW
      },
      async backup(payload) {
        calls.push(['data.backup', payload])
        return { ok: true, backupDir: 'D:\\backup\\xuanshu-backup-20261017-130607', manifestPath: 'D:\\backup\\xuanshu-backup-20261017-130607\\manifest.json', manifest: { schema: 'xuanshu/backup@1', files: 1, totalBytes: 1, items: [] } }
      },
      async pickDirectory() {
        calls.push(['cang.pickDirectory'])
        return { path: 'D:\\backup' }
      },
      ...over,
    },
  }
}

/* ───────────────────────── 1. RPC 方法名与请求形状 ───────────────────────── */

describe('票 30 · 数据页的 RPC 方法名逐字对齐宿主', () => {
  it('三个端点是契约里的原文（选目录复用藏库的 cang.pickDirectory）', () => {
    expect(DATA_ENDPOINTS).toEqual({
      overview: 'data.overview',
      backup: 'data.backup',
      pickDirectory: 'cang.pickDirectory',
    })
  })

  it('overview 走 /xuanshu 通道；backup 透传 {targetDir, confirmed:true}', async () => {
    const { calls } = installRpcFetch({ value: { ok: true } })
    const api = createDataApi({})
    await api.overview()
    await api.backup({ targetDir: 'D:\\backup', confirmed: true })
    await api.pickDirectory()
    expect(calls.map((call) => [call.channel, call.endpoint])).toEqual([
      ['/xuanshu', 'data.overview'],
      ['/xuanshu', 'data.backup'],
      ['/xuanshu', 'cang.pickDirectory'],
    ])
    expect(calls[0].payload).toEqual({})
    expect(calls[1].payload).toEqual({ targetDir: 'D:\\backup', confirmed: true })
    expect(calls[2].payload).toEqual({})
  })

  it('RPC 层失败时抛出（页面据此显示可读错误）', async () => {
    installRpcFetch({ error: { message: '通道不可用' } })
    await expect(createDataApi({}).overview()).rejects.toThrow('通道不可用')
  })
})

/* ───────────────────────── 2. 体积格式化 ───────────────────────── */

describe('票 30 · 体积格式化（给人类读的字节）', () => {
  it('0 / B / KB / MB / GB 各档的字面值', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })
})

/* ───────────────────────── 3. 页面渲染 ───────────────────────── */

describe('票 30 · 数据页渲染：路径 / 8 组体积 / 总计 / 排除原因', () => {
  const html = render(h(XsDataSection, { state: { overview: OVERVIEW, busy: false }, actions: { onBackup: () => {} } }))

  it('home 与数据目录分开显示（沿用 #22 的口径，不把 home 叫成数据目录）', () => {
    expect(html).toContain('data-xuanshu-data-path="home"')
    expect(html).toContain('C:\\Users\\me\\.xuanshu')
    expect(html).toContain('数据目录')
    expect(html).toContain('C:\\Users\\me\\.xuanshu\\xuanshu')
  })

  it('8 组按契约顺序出现，各带体积与文件数', () => {
    const order = OVERVIEW.groups.map((group) => html.indexOf(`data-xuanshu-data-group="${group.id}"`))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toContain('谱')
    expect(html).toContain('2.0 KB')
    expect(html).toContain('3 个文件')
    expect(html).toContain('问事与会话')
    expect(html).toContain('1.5 KB')
  })

  it('总计可读', () => {
    expect(html).toContain('总计')
    expect(html).toContain('4.6 KB')
    expect(html).toContain('10 个文件')
  })

  it('排除项逐条带原因（凭据那条必须在）', () => {
    expect(html).toContain('data-xuanshu-data-excluded')
    expect(html).toContain('.credentials.yaml')
    expect(html).toContain('凭据与密钥引用')
  })

  it('一键备份按钮存在且空闲态可用', () => {
    expect(html).toContain('data-xuanshu-action="backup"')
    expect(html).toContain('一键备份')
    expect(html).not.toContain('disabled')
  })
})

describe('票 30 · 数据页的边界文案：含会话、不含密钥、原因与迁移方法', () => {
  const html = render(h(XsDataSection, { state: { overview: OVERVIEW, busy: false }, actions: { onBackup: () => {} } }))

  it('明文写清备份包含会话记录', () => {
    expect(html).toContain('备份包含')
    expect(html).toContain('会话记录')
  })

  it('明文写清不包含 .credentials.yaml 与任何密钥引用', () => {
    expect(html).toContain('不包含')
    expect(html).toContain('.credentials.yaml')
    expect(html).toContain('密钥引用')
  })

  it('写明原因（密钥留在本机凭据库）与迁移方法（设置 → 模型）', () => {
    expect(html).toContain('密钥不该离开本机凭据库')
    expect(html).toContain('设置 → 模型')
    expect(html).toContain('重新填')
  })

  it('恢复口径逐项说明，并明确不提供自动覆盖式恢复', () => {
    expect(html).toContain('data-xuanshu-data-restore')
    expect(html).toContain('不提供自动恢复')
    expect(html).toContain('放回')
    // 逐项 ≥ 3 条（关实例 / 放回对应位置 / 重填密钥）。
    expect((html.match(/<li/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})

describe('票 30 · busy / 成功 / 失败三态（不阻塞界面、失败可读）', () => {
  it('busy：按钮禁用并显示阶段文案', () => {
    const html = render(
      h(XsDataSection, {
        state: { overview: OVERVIEW, busy: true, stage: '正在复制文件并计算 sha256…' },
        actions: { onBackup: () => {} },
      }),
    )
    expect(html).toContain('disabled')
    expect(html).toContain('正在复制文件并计算 sha256…')
    expect(html).toContain('data-xuanshu-data-stage')
  })

  it('成功：显示备份目录、清单路径与「可逐项对账」', () => {
    const html = render(
      h(XsDataSection, {
        state: {
          overview: OVERVIEW,
          busy: false,
          result: {
            ok: true,
            backupDir: 'D:\\backup\\xuanshu-backup-20261017-130607',
            manifestPath: 'D:\\backup\\xuanshu-backup-20261017-130607\\manifest.json',
          },
        },
        actions: { onBackup: () => {} },
      }),
    )
    expect(html).toContain('data-xuanshu-data-result')
    expect(html).toContain('D:\\backup\\xuanshu-backup-20261017-130607')
    expect(html).toContain('manifest.json')
    expect(html).toContain('sha256')
    expect(html).toContain('逐项对账')
  })

  it('失败：可读原因可见（role=alert），不静默', () => {
    const html = render(
      h(XsDataSection, {
        state: { overview: OVERVIEW, busy: false, error: '备份没有完成：备份目录不能放在玄枢 home 里。' },
        actions: { onBackup: () => {} },
      }),
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('备份没有完成')
    expect(html).toContain('不能放在玄枢 home 里')
  })

  it('overview 还没读到时显示加载态，且不显示猜的数值', () => {
    const html = render(h(XsDataSection, { state: { overview: undefined, busy: false }, actions: { onBackup: () => {} } }))
    expect(html).toContain('data-xs-state="loading"')
    expect(html).not.toContain('总计')
  })
})

/* ───────────────────────── 4. 槽位注册 ───────────────────────── */

describe('票 30 · 设置槽位注册（纯加性：只有 settings.section，不新增面板）', () => {
  it('注册一行设置分区：id/order/label 固定，且不声明 priority / children', () => {
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
    const { api } = fakeApi()
    installDataSettings(ctx, { api })
    expect(injected).toEqual(['settings.section'])
    expect(registered).toHaveLength(1)
    expect(registered[0].options).toMatchObject({
      name: 'settings.section',
      id: DATA_SECTION_ID,
      order: DATA_SECTION_ORDER,
      label: DATA_SECTION_LABEL,
    })
    expect(registered[0].options.priority).toBeUndefined()
    expect(registered[0].options.children).toBeUndefined()
    expect(typeof registered[0].component).toBe('function')
  })

  it('分区身份固定：id 带 xuanshu 前缀、标签是「我的数据」、order 排在既有分区之后', () => {
    expect(DATA_SECTION_ID).toBe('xuanshu.data')
    expect(DATA_SECTION_LABEL).toBe('我的数据')
    // 既有：account -10 / general 0 / models 10 / plugins 15 / agent-presets 20（本机 0.2.0-rc.2 实装）。
    expect(DATA_SECTION_ORDER).toBeGreaterThan(20)
  })
})
