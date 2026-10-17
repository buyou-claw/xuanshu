/**
 * R3 · #35 界面数据路径文案与玄枢 home 一致。
 *
 * 标准（为什么是「错话」而不是风格问题）：
 *   - ADR-0014（`docs/adr/0014-own-desktop-shell-and-home.md:13`）：玄枢**不读写** `~/.dsh` ——
 *     那是 DSH 桌面版的 home；两实例各有自己的 home。
 *   - 冻结契约 §0 / 规格 §我的数据：产品档 home `~/.xuanshu`、开发档 `<repo>/.dsh-home`，
 *     数据目录固定 `<home>/xuanshu`（`packages/xuanshu-host/lib/home.mjs` 的唯一实现）。
 *
 * 所以：文案里的路径只能来自**宿主回传的真实值**（`data.overview` 的 `home` / `dataDir`，
 * 或 `cang.list` 的 `registryPath`）；拿不到时给中性占位（「玄枢数据目录」/「玄枢 home」），
 * **不写死任何一档、也不落回 `~/.dsh`**。
 *
 * 本文件三组判据（对应 #35 的验收）：
 *   ① 源码扫描：`packages/xuanshu-client/src/**` 除注释外不得出现 `~/.dsh`（JSX 文本/字符串都算）；
 *   ② 代表性渲染：注入宿主回传的产品 / 开发两档路径 → 文案随之变化；
 *   ③ 无宿主数据 → 中性占位（不猜路径）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CangPanel } from '../../packages/xuanshu-client/src/client/CangPanel.tsx'
import { XsConsultHistoryList } from '../../packages/xuanshu-client/src/client/consult-views.tsx'
import {
  DATA_DIR_PLACEHOLDER,
  HOME_PLACEHOLDER,
  createHomePathsWatch,
  resolveHomePathsFromApi,
} from '../../packages/xuanshu-client/src/client/home-paths.ts'
import { OverviewPanel } from '../../packages/xuanshu-client/src/client/OverviewPanel.tsx'
import { puPaths } from '../../packages/xuanshu-client/src/client/sediment-model.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const CLIENT_SRC = join(REPO_ROOT, 'packages', 'xuanshu-client', 'src')

/** DSH 桌面版的 home：玄枢文案里**不该再出现**的旧路径。 */
const OLD_HOME = '~/.dsh'

/**
 * 宿主 `data.overview` 回传的两档真实值（Windows 原生分隔符，原样进文案，不再加工）。
 * 产品档 `~/.xuanshu` / 开发档 `<repo>/.dsh-home`，数据目录都是 `<home>/xuanshu`。
 */
const PRODUCT_HOME = 'C:\\Users\\me\\.xuanshu'
const PRODUCT_DATA_DIR = `${PRODUCT_HOME}\\xuanshu`
const DEV_HOME = 'E:\\ai_project\\XuanShu\\.dsh-home'
const DEV_DATA_DIR = `${DEV_HOME}\\xuanshu`

/* ───────────────────────── ① 源码扫描（注释白名单） ───────────────────────── */

/** 递归收集客户端源码（`.ts` / `.tsx`）。 */
function sourceFiles(dir = CLIENT_SRC, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 剥掉注释（保留行号：注释字符换成空格）。照 `tests/horosa/p2-single-source.test.mjs` 的既有做法。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix + ' '.repeat(match.length - prefix.length))
}

/** 在一段（已剥注释的）源码里找旧路径；返回行号与那行原文，便于报错时直接定位。 */
function findOldHome(text) {
  const hits = []
  stripComments(text).split(/\r?\n/).forEach((line, index) => {
    if (line.includes(OLD_HOME)) hits.push({ line: index + 1, text: line.trim() })
  })
  return hits
}

describe('R3 · 客户端源码除注释外不得出现 DSH 桌面版的 home（~/.dsh）', () => {
  it('扫描器本身有效：注释里的允许，字符串 / JSX 文本里的命中（否则上面那条只是「什么都没扫到」的假绿）', () => {
    const probe = [
      `// 注释里写 ${OLD_HOME} 是说明「为什么不能再出现」，不算命中`,
      `const copy = '数据都在本地 ${OLD_HOME}/xuanshu/';`,
      `<p>数据在本地：${OLD_HOME}/sessions/（只读展示）</p>`,
    ].join('\n')
    expect(findOldHome(probe).map((hit) => hit.line)).toEqual([2, 3])
  })

  it('客户端 src 全量扫描：没有一处把旧路径写进用户可见文案', () => {
    const files = sourceFiles()
    expect(files.length, '一个客户端源码文件都没扫到？扫描根写错了').toBeGreaterThan(50)
    const offenders = files.flatMap((file) => {
      const hits = findOldHome(readFileSync(file, 'utf8'))
      return hits.map((hit) => `${relative(REPO_ROOT, file).split(sep).join('/')}:${hit.line}: ${hit.text}`)
    })
    expect(
      offenders,
      `客户端源码里还有旧路径（应改为宿主回传的 home/dataDir 或中性占位「玄枢数据目录」）：\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})

/* ───────────────────────── 渲染工具（无 JSX：测试文件是 .mjs） ───────────────────────── */

/** 稳定 watch（满足 `useSyncExternalStore` 的 `Object.is` 比较要求）。 */
function watchOf(keys) {
  const snapshot = [...keys].sort()
  return { subscribe: () => () => {}, getSnapshot: () => snapshot }
}

/** 总览面板的注入面（不接业务数据面：SSR 不跑 effect，卡片停在空态即可）。 */
function overviewProps(extra = {}) {
  return {
    navigate: () => {},
    mainPanels: watchOf(['conversation', 'overview', 'plugins', 'schedules']),
    today: '2026-10-17',
    ...extra,
  }
}

/** 抠出页眉那行本地数据注记（`data-xuanshu-note="local-data"` 的段落）。 */
function localNoteOf(html) {
  const start = html.indexOf('data-xuanshu-note="local-data"')
  expect(start, '页眉没有本地数据注记').toBeGreaterThanOrEqual(0)
  return html.slice(start, html.indexOf('</p>', start))
}

/** 历史列表的 props。 */
function historyProps(over = {}) {
  return {
    items: [],
    loading: false,
    error: '会话清单读不到',
    query: '',
    range: 'all',
    now: new Date('2026-10-17T09:00:00+08:00'),
    onQuery: () => {},
    onRange: () => {},
    onOpen: () => {},
    onBack: () => {},
    onStart: () => {},
    onManagePu: () => {},
    onRetry: () => {},
    ...over,
  }
}

/** 藏库面板的最小注入面（`initialData` 缺席 = 还没取到宿主数据）。 */
const cangController = { snapshot: () => ({ revision: 0, draft: undefined }), subscribe: () => () => {}, edit: () => {} }

/* ───────────────────────── ② 代表性渲染：产品 / 开发两档 ───────────────────────── */

describe('R3 · 页眉「数据都在本地」按宿主回传的 dataDir 渲染（产品 / 开发两档）', () => {
  it('产品档：显示 ~/.xuanshu/xuanshu（不再是 DSH 桌面版的 ~/.dsh/xuanshu）', () => {
    const html = renderToStaticMarkup(h(OverviewPanel, overviewProps({ dataDir: PRODUCT_DATA_DIR })))
    const note = localNoteOf(html)
    expect(note).toContain(`数据都在本地 ${PRODUCT_DATA_DIR}\\`)
    expect(note).not.toContain(OLD_HOME)
  })

  it('开发档：显示 <repo>/.dsh-home/xuanshu（同一段文案，换宿主回传值就换）', () => {
    const html = renderToStaticMarkup(h(OverviewPanel, overviewProps({ dataDir: DEV_DATA_DIR })))
    const note = localNoteOf(html)
    expect(note).toContain(`数据都在本地 ${DEV_DATA_DIR}\\`)
    expect(note).not.toContain(OLD_HOME)
  })
})

describe('R3 · 门厅历史错误行的会话路径按宿主回传的 home 渲染', () => {
  it('产品档 / 开发档各一次：<home>/sessions/', () => {
    const product = renderToStaticMarkup(h(XsConsultHistoryList, historyProps({ home: PRODUCT_HOME })))
    expect(product).toContain(`数据在本地：${PRODUCT_HOME}\\sessions\\（只读展示）`)
    const dev = renderToStaticMarkup(h(XsConsultHistoryList, historyProps({ home: DEV_HOME })))
    expect(dev).toContain(`数据在本地：${DEV_HOME}\\sessions\\（只读展示）`)
    expect(product).not.toContain(OLD_HOME)
    expect(dev).not.toContain(OLD_HOME)
  })
})

describe('R3 · 藏库页脚：宿主回传 registryPath 就用它（不自己猜路径）', () => {
  it('有宿主数据：显示宿主给的绝对注册表路径', () => {
    const registryPath = `${PRODUCT_DATA_DIR}\\cang\\registry.jsonl`
    const html = renderToStaticMarkup(
      h(CangPanel, { api: {}, controller: cangController, initialData: { registryPath, entries: [] }, navigatePus: () => {} }),
    )
    expect(html).toContain(registryPath)
    expect(html).not.toContain(OLD_HOME)
  })
})

describe('R3 · 沉淀写入路径：注入 dataDir 后跟着变', () => {
  it('同一份 pus/<slug>/ 文件清单，产品档与默认占位两种情况', () => {
    expect(puPaths('事业与行业', PRODUCT_DATA_DIR)).toEqual({
      content: `${PRODUCT_DATA_DIR}\\pus\\事业与行业\\content.md`,
      summary: `${PRODUCT_DATA_DIR}\\pus\\事业与行业\\summary.md`,
      manifest: `${PRODUCT_DATA_DIR}\\pus\\事业与行业\\manifest.md`,
    })
    expect(puPaths('事业与行业', DEV_DATA_DIR).content).toBe(`${DEV_DATA_DIR}\\pus\\事业与行业\\content.md`)
  })
})

/* ───────────────────────── ③ 无宿主数据：中性占位，不猜 ───────────────────────── */

describe('R3 · 宿主没回传路径时显示中性占位（不写死、不猜）', () => {
  it('页眉本地注记：中性占位「玄枢数据目录」，不出现任何一档的具体目录名', () => {
    const html = renderToStaticMarkup(h(OverviewPanel, overviewProps()))
    const note = localNoteOf(html)
    expect(note).toContain('玄枢数据目录')
    expect(note).not.toContain(OLD_HOME)
    // 也不许「猜」成某一档：产品档 / 开发档的具体目录名都不该凭空出现。
    expect(note).not.toContain('.xuanshu')
    expect(note).not.toContain('.dsh-home')
  })

  it('门厅历史错误行：中性占位「玄枢 home/sessions/」', () => {
    const html = renderToStaticMarkup(h(XsConsultHistoryList, historyProps()))
    expect(html).toContain('数据在本地：玄枢 home/sessions/（只读展示）')
    expect(html).not.toContain(OLD_HOME)
  })

  it('藏库页脚缺 registryPath：中性占位「玄枢数据目录/cang/registry.jsonl」', () => {
    const html = renderToStaticMarkup(h(CangPanel, { api: {}, controller: cangController, navigatePus: () => {} }))
    expect(html).toContain('玄枢数据目录/cang/registry.jsonl')
    expect(html).not.toContain(OLD_HOME)
  })

  it('沉淀写入路径缺 dataDir：中性占位「玄枢数据目录/pus/<slug>/…」', () => {
    expect(puPaths('事业与行业')).toEqual({
      content: '玄枢数据目录/pus/事业与行业/content.md',
      summary: '玄枢数据目录/pus/事业与行业/summary.md',
      manifest: '玄枢数据目录/pus/事业与行业/manifest.md',
    })
  })
})

/* ───────────────────────── ④ 装配期取一次：resolveHomePathsFromApi / watch ───────────────────────── */

/**
 * 假的数据面：只为 `resolveHomePathsFromApi` 提供 `overview()`。
 * 这是**接线**的单测（不是组件 props 直传）：装配点拿到宿主回传值之后再注入。
 */
function fakeDataApi(answer) {
  const calls = []
  return {
    calls,
    overview: async (signal) => {
      calls.push({ signal })
      return typeof answer === 'function' ? answer() : answer
    },
  }
}

/** 一条宿主 `data.overview` 的回答（只列本组要用的字段，其余形状无关）。 */
const overviewAnswer = (home, dataDir) => ({
  schema: 'xuanshu/data@1',
  home,
  dataDir,
  groups: [],
  total: { bytes: 0, files: 0 },
  excluded: [],
  notes: [],
})

describe('R3 · 装配期只读一次 data.overview：home / dataDir 原样进注入面', () => {
  it('产品档 / 开发档各一次：宿主给什么就注入什么，不吃占位', async () => {
    for (const [home, dataDir] of [
      [PRODUCT_HOME, PRODUCT_DATA_DIR],
      [DEV_HOME, DEV_DATA_DIR],
    ]) {
      const api = fakeDataApi(overviewAnswer(home, dataDir))
      await expect(resolveHomePathsFromApi(api)).resolves.toEqual({ home, dataDir })
      expect(api.calls).toHaveLength(1)
    }
  })

  it('空白 / 非字符串 / 缺席：一律按「没拿到」处理（不猜路径、不把空白当值）', async () => {
    const blanks = [
      { home: '   ', dataDir: '' },
      { home: undefined, dataDir: 42 },
      { home: null, dataDir: [] },
      {},
    ]
    for (const answer of blanks) {
      await expect(resolveHomePathsFromApi(fakeDataApi(answer))).resolves.toEqual({})
    }
  })

  it('取数失败（reject 或同步抛）：装配层拿到空值、绝不把异常丢上去', async () => {
    await expect(
      resolveHomePathsFromApi(fakeDataApi(() => {
        throw new Error('连接没起来')
      })),
    ).resolves.toEqual({})
    await expect(
      resolveHomePathsFromApi({
        overview: async () => {
          throw new Error('宿主拒绝了 data.overview')
        },
      }),
    ).resolves.toEqual({})
    // 假 ctx 没有 connection 时的真实形状：同步 TypeError
    await expect(
      resolveHomePathsFromApi({
        overview: () => {
          throw new TypeError("Cannot read properties of undefined (reading 'rpc')")
        },
      }),
    ).resolves.toEqual({})
  })

  it('空值 → 渲染层仍是中性占位（占位常量就是那一句话，不是猜出来的目录）', () => {
    expect(DATA_DIR_PLACEHOLDER).toBe('玄枢数据目录')
    expect(HOME_PLACEHOLDER).toBe('玄枢 home')
  })
})

describe('R3 · home/dataDir 的注入面是订阅式的（拿到值的那一刻，同一棵树就能重渲染）', () => {
  it('初始为空快照；set 之后快照换引用并通知订阅者', () => {
    const watch = createHomePathsWatch()
    const initial = watch.getSnapshot()
    expect(initial).toEqual({})
    // 同一引用（useSyncExternalStore 的 Object.is 要求）
    expect(watch.getSnapshot()).toBe(initial)

    const seen = []
    const unsubscribe = watch.subscribe(() => {
      seen.push(watch.getSnapshot())
    })
    watch.set({ home: DEV_HOME, dataDir: DEV_DATA_DIR })
    expect(seen).toEqual([{ home: DEV_HOME, dataDir: DEV_DATA_DIR }])
    // 快照换引用但内容不变：订阅者仍被通知（值真的到了，不能静默）
    watch.set({ home: DEV_HOME, dataDir: DEV_DATA_DIR })
    expect(seen).toHaveLength(2)
    expect(watch.getSnapshot()).not.toBe(seen[0])

    unsubscribe()
    watch.set({})
    expect(seen).toHaveLength(2)
  })
})
