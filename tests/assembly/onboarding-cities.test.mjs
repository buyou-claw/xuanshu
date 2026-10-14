/**
 * 票 08 · 离线城市小库契约（S3 §2.2 通道 A / §3.2①，冻结契约 §5）。
 *
 * 对应验收：
 *   - 断网可搜出结果（本文件**不起服务、不发请求**，全部是纯函数与假计时器）；
 *   - 小库即时、有输入后 180ms 防抖才问大库、无关键词只列小库、大库失败**静默**；
 *   - 无匹配文案 = 「无匹配城市，可改用手输经纬度」（上游原话是引导去地图，玄枢没有地图）。
 *
 * 为什么这一层能直接断言：
 *   小库与防抖控制器都是**纯逻辑**（`cities.ts` 不 import React、不碰 document），
 *   在 Node 里跑的就是浏览器里跑的那份源码（vitest 的 vite 原生 esbuild 变换）。
 *   组件的「无匹配文案」渲染断言在 `onboarding-wizard.test.mjs` 里，本文件只管数据与调度。
 *
 * 证据（本机只读核对）：
 *   - 源数据 `.upstream/horosa-web-app-windows/…/astrostudyui/src/data/cities.json`（96 条，
 *     字段 name/en/region/lat/lng/p）。
 *   - 上游调度：`…/components/amap/GeoCoordSelector.js:41-47`（`cityKeyword` 即时值 /
 *     `cityQuery` 防抖值 / `fullCities` 懒加载失败为 null）；`:304-325`（小库即时 + 大库懒加载）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CITY_DEBOUNCE_MS,
  CITY_RESULT_LIMIT,
  SMALL_CITIES,
  createCityQuery,
  searchCities,
} from '../../packages/xuanshu-client/src/client/cities.ts'

/** 大库里的条目（形状 = 契约 §2 的 `City`）：小库里没有，用来区分两条通道。 */
const BIG_ONLY = {
  name: '商丘',
  region: '中国·河南',
  en: 'Shangqiu',
  pinyin: 'shang qiu',
  lat: 34.4146,
  lon: 115.656,
}

/** 第二个大库条目（前缀 `bei`，用来验证「换查询后新那一代的回包被采纳」）。 */
const BIG_BEI = {
  name: '北海',
  region: '中国·广西',
  en: 'Beihai',
  pinyin: 'bei hai',
  lat: 21.4811,
  lon: 109.1202,
}

afterEach(() => {
  vi.useRealTimers()
})

describe('票 08 · 离线城市小库（cities.ts）', () => {
  it('随 bundle 自带约 100 条常用城市，字段形状与来源一致', () => {
    expect(SMALL_CITIES.length).toBeGreaterThanOrEqual(90)
    expect(SMALL_CITIES.length).toBeLessThanOrEqual(110)
    for (const city of SMALL_CITIES) {
      expect(typeof city.name, `${JSON.stringify(city)} 缺 name`).toBe('string')
      expect(typeof city.region).toBe('string')
      expect(typeof city.pinyin).toBe('string')
      expect(Number.isFinite(city.lat), `${city.name} 的 lat 不是有限数`).toBe(true)
      expect(Number.isFinite(city.lon), `${city.name} 的 lon 不是有限数`).toBe(true)
      // 简体名：不得出现繁体字形（上游源数据是简体，逐条转写时抄错会在这里被抓）。
      expect(city.name).not.toMatch(
        /[臺灣門廣東陽貴寧烏魯齊長濱慶濟島廈薩錫爾達馬內買倫漢羅蘇維約磯舊華圖頓溫聖熱盧諾奧開畢]/,
      )
    }
    // 常用城市抽查（含南北半球，保证 `formatCoords` 的 n/s、e/w 两侧都有样本）。
    for (const name of ['北京', '上海', '广州', '南京', '乌鲁木齐', '纽约', '悉尼']) {
      expect(SMALL_CITIES.map((city) => city.name)).toContain(name)
    }
    // 经度在前、纬度在后是**契约字段语义**：纬度不可能超出 ±90，这里只查样本的绝对值区间。
    expect(SMALL_CITIES.find((city) => city.name === '上海')).toMatchObject({ lat: 31.2304, lon: 121.4737 })
  })

  it('无关键词只列小库：即使大库已经回来了也不带进来', () => {
    const items = searchCities('', [BIG_ONLY])
    expect(items.length).toBe(CITY_RESULT_LIMIT)
    expect(items.map((city) => city.name)).not.toContain('商丘')
    expect(items[0].name).toBe('北京')
  })

  it('中文 / 全拼 / 首字母 / 英文四种查法都能命中', () => {
    const first = (query, extra = []) => searchCities(query, extra)[0]?.name
    expect(first('南京')).toBe('南京')
    expect(first('nanjing')).toBe('南京')
    expect(first('nan jing')).toBe('南京')
    expect(first('nj')).toBe('南京')
    expect(first('BeiJing')).toBe('北京')
    expect(first('tokyo')).toBe('东京')
    expect(first('dong jing')).toBe('东京')
  })

  it('大库条目参与搜索，同名按小库优先去重（两条通道合并后不重复列）', () => {
    expect(searchCities('shangqiu', [BIG_ONLY]).map((city) => city.name)).toEqual(['商丘'])
    const merged = searchCities('shang', [BIG_ONLY, { ...BIG_ONLY, name: '上海', region: '大库·重复' }])
    expect(merged.filter((city) => city.name === '上海')).toHaveLength(1)
    expect(merged.find((city) => city.name === '上海').region).toBe('中国')
  })

  it('无匹配返回空数组（界面据此给「无匹配城市，可改用手输经纬度」）', () => {
    expect(searchCities('这城市不存在')).toEqual([])
    expect(searchCities('zzzz')).toEqual([])
  })

  it('180ms 是冻结值（改它 = 改契约 §5，必须回 Lead）', () => {
    expect(CITY_DEBOUNCE_MS).toBe(180)
  })
})

describe('票 08 · 城市搜索的两条通道（即时小库 + 防抖大库）', () => {
  /** 可手动落定的假大库；`calls` 记录每次查询（含 AbortSignal）。 */
  function fakeFullLibrary() {
    const calls = []
    const loadFull = (query, signal) => {
      calls.push({ query, signal })
      return new Promise(() => {})
    }
    return { calls, loadFull }
  }

  it('输入即时回显小库结果，180ms 之后才问大库；无关键词永远不问', async () => {
    vi.useFakeTimers()
    const { calls, loadFull } = fakeFullLibrary()
    const controller = createCityQuery({ loadFull })

    controller.setQuery('shang')
    // 即时（防抖前）：小库结果已经在了，界面不会空着等。
    expect(controller.getSnapshot().items.map((city) => city.name)).toContain('上海')
    expect(controller.getSnapshot().pending).toBe(true)
    expect(calls).toHaveLength(0)

    vi.advanceTimersByTime(CITY_DEBOUNCE_MS - 1)
    expect(calls, '179ms 时不该问大库').toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(calls).toHaveLength(1)
    expect(calls[0].query).toBe('shang')

    controller.setQuery('')
    vi.advanceTimersByTime(CITY_DEBOUNCE_MS * 3)
    expect(controller.getSnapshot().items.length).toBe(CITY_RESULT_LIMIT)
    expect(calls, '无关键词只列小库：不产生任何大库请求').toHaveLength(1)
  })

  it('大库回来就合并进结果；失败则**静默**只用小库（state.fullFailed 只给守卫看，不渲染）', async () => {
    vi.useFakeTimers()
    const outcome = { resolve: null, reject: null }
    const controller = createCityQuery({
      loadFull: () =>
        new Promise((resolve, reject) => {
          outcome.resolve = resolve
          outcome.reject = reject
        }),
    })

    controller.setQuery('shang')
    const smallOnly = controller.getSnapshot().items.map((city) => city.name)
    vi.advanceTimersByTime(CITY_DEBOUNCE_MS)
    outcome.resolve([BIG_ONLY])
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot().items.map((city) => city.name)).toContain('商丘')
    expect(controller.getSnapshot().fullFailed).toBe(false)
    expect(controller.getSnapshot().pending).toBe(false)

    controller.setQuery('bei')
    vi.advanceTimersByTime(CITY_DEBOUNCE_MS)
    outcome.reject(new Error('大库文件缺失'))
    await vi.advanceTimersByTimeAsync(0)
    const after = controller.getSnapshot()
    expect(after.fullFailed, '大库失败要被记下来（界面据此保持沉默，不弹错）').toBe(true)
    expect(after.items.map((city) => city.name)).toContain('北京')
    expect(after.pending).toBe(false)
    // 小库结果没被失败清空（这是「静默回落」的可观测判据）。
    expect(smallOnly.length).toBeGreaterThan(0)
  })

  it('连续输入只发一次（最新那个查询），过期回包不覆盖新结果', async () => {
    vi.useFakeTimers()
    const calls = []
    const pending = []
    const controller = createCityQuery({
      loadFull: (query, signal) => {
        calls.push({ query, signal })
        return new Promise((resolve) => pending.push({ query, resolve }))
      },
    })

    controller.setQuery('sh')
    vi.advanceTimersByTime(100)
    controller.setQuery('shang')
    vi.advanceTimersByTime(CITY_DEBOUNCE_MS)
    expect(calls.map((call) => call.query), '第一次查询被后来的输入取代，不该发出').toEqual(['shang'])
    expect(calls[0].signal?.aborted, '`shang` 正是在飞的那一个，还没被取代').toBe(false)

    // 还在飞的时候换主意：上一个请求要被中止，且它**随后**回来的结果必须被丢弃。
    controller.setQuery('bei')
    vi.advanceTimersByTime(CITY_DEBOUNCE_MS)
    expect(calls.map((call) => call.query)).toEqual(['shang', 'bei'])
    expect(calls[0].signal.aborted, '换查询时上一个在飞的请求要被中止').toBe(true)
    pending[0].resolve([{ ...BIG_ONLY, name: '过期回包' }])
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot().items.map((city) => city.name)).not.toContain('过期回包')

    // 当前这一代的回包正常采纳（而它必须**按当前查询**过滤：'北海' 匹配 bei，'商丘' 不匹配）。
    pending[1].resolve([BIG_ONLY, BIG_BEI])
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot().items.map((city) => city.name)).toContain('北海')
    expect(controller.getSnapshot().items.map((city) => city.name)).not.toContain('商丘')
    expect(controller.getSnapshot().query).toBe('bei')

    controller.dispose()
  })

  it('订阅只在实际变化时通知（useSyncExternalStore 的快照必须稳定）', () => {
    vi.useFakeTimers()
    const controller = createCityQuery({ loadFull: () => Promise.resolve([]) })
    const seen = []
    const unsubscribe = controller.subscribe(() => seen.push(controller.getSnapshot().query))
    const before = controller.getSnapshot()

    controller.setQuery('')
    controller.setQuery('')
    expect(controller.getSnapshot(), '同一个查询重复设置不该换快照引用').toBe(before)
    expect(seen).toHaveLength(0)

    controller.setQuery('bei')
    expect(seen).toEqual(['bei'])
    unsubscribe()
    controller.dispose()
  })
})
