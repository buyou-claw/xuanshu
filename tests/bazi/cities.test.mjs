/**
 * 票 08 · `bazi.cities`（契约 §2 方法面 / §5 城市库）
 *
 * 抓的真实缺陷/风险：
 *   ① **大库缺失不许报错**（契约 §2 写死）：大库是「寄宿在宿主插件的懒加载件」，
 *      没装/被删/JSON 坏了都不该让向导停摆 —— 客户端静默回落自带小库，回的是
 *      `{items: [], source: 'none'}` 而不是异常（异常会变成界面上一句「出错了」）。
 *   ② **`City` 不许自带 tz**（契约 §2）：上游两份数据都带时区字段，一旦顺手透传，
 *      城市库里就多出第二份时区数据 —— 与 `bazi.timezone`（Intl）漂移是迟早的事。
 *   ③ **中文 + 拼音 + 英文三路都要能搜**（契约 §5：`p` = 空格分隔拼音 → 可搜全拼与首字母）：
 *      出生地输入框里用户会打「上海」「shanghai」「sh」三种形态，
 *      只按 name 匹配等于让一半用户搜不到自己的城市。
 *   ④ **用户覆盖位优先**：`<dataDir>/geo/cities-full.json` 存在时用它（契约 §1），
 *      否则「我放了一份自己的城市表」这件事会被静默忽略。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createBaziMethods } from '../../packages/xuanshu-host/lib/bazi/service.mjs'
import { HOST_PACKAGE, makeSandbox, makeCtx } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 起一套 `bazi.*` 方法；`bundledDir` 缺省 = 随包分发的大库（`packages/xuanshu-host/data`）。 */
function methods(config = {}) {
  const sandbox = config.sandbox ?? makeSandbox('cities')
  roots.push(sandbox)
  return createBaziMethods(makeCtx({}), { dataDir: sandbox.dataDir, ...config })
}

/** 空目录 = 「大库不在盘上」的现场。 */
function emptyBundledDir(sandbox) {
  const dir = join(sandbox.root, 'bundled-empty')
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('bazi.cities · 大库缺失（契约 §2：不报错，界面静默回落小库）', () => {
  it('大库不在盘上 → { items: [], source: \'none\' }，不是异常', async () => {
    const sandbox = makeSandbox('cities-missing')
    const api = methods({ sandbox, bundledDir: emptyBundledDir(sandbox) })
    const result = await api['bazi.cities']({ query: '上海' })
    expect(result).toEqual({ items: [], source: 'none' })
  })

  it('大库 JSON 坏了 → 同样 source:none（坏文件不许把向导打挂）', async () => {
    const sandbox = makeSandbox('cities-broken')
    const bundledDir = join(sandbox.root, 'bundled-broken')
    mkdirSync(bundledDir, { recursive: true })
    writeFileSync(join(bundledDir, 'cities-full.json'), '{ 这不是 JSON')
    const api = methods({ sandbox, bundledDir })
    expect(await api['bazi.cities']({ query: '上海' })).toEqual({ items: [], source: 'none' })
  })

  it('大库不是数组（形状不符）→ 同样 source:none', async () => {
    const sandbox = makeSandbox('cities-shape')
    const bundledDir = join(sandbox.root, 'bundled-shape')
    mkdirSync(bundledDir, { recursive: true })
    writeFileSync(join(bundledDir, 'cities-full.json'), '{"cities":[]}')
    const api = methods({ sandbox, bundledDir })
    expect(await api['bazi.cities']({ query: '上海' })).toEqual({ items: [], source: 'none' })
  })
})

describe('bazi.cities · 随包分发的大库（真数据）', () => {
  it('搜「上海」命中上海市，且 City 形状逐键合规、**不含 tz**', async () => {
    const result = await methods()['bazi.cities']({ query: '上海' })
    expect(result.source).toBe('full')
    expect(result.items.length).toBeGreaterThan(0)
    const shanghai = result.items[0]
    expect(shanghai.name).toBe('上海市')
    expect(shanghai.region).toBe('中华人民共和国')
    expect(typeof shanghai.lat).toBe('number')
    expect(typeof shanghai.lon).toBe('number')
    expect(typeof shanghai.pinyin).toBe('string')

    for (const city of result.items) {
      expect(Object.keys(city).filter((key) => !['name', 'region', 'en', 'pinyin', 'lat', 'lon'].includes(key))).toEqual([])
      for (const key of ['name', 'region', 'pinyin']) expect(typeof city[key], `${city.name} 缺 ${key}`).toBe('string')
      expect(Number.isFinite(city.lat) && Number.isFinite(city.lon), `${city.name} 经纬度不是有限数`).toBe(true)
    }
  })

  it('拼音全拼（shanghai）与首字母（bj）都能搜到', async () => {
    const pinyin = await methods()['bazi.cities']({ query: 'shanghai' })
    expect(pinyin.items.map((city) => city.name)).toContain('Shanghai')

    const initials = await methods()['bazi.cities']({ query: 'bj' })
    expect(initials.items.map((city) => city.name)).toContain('北京市')
  })

  it('英文名（New York）能搜到中文城市「纽约」，中文名（伦敦）也能搜到', async () => {
    const english = await methods()['bazi.cities']({ query: 'New York' })
    expect(english.items.map((city) => city.name)).toContain('纽约')

    const chinese = await methods()['bazi.cities']({ query: '伦敦' })
    expect(chinese.items[0].name).toBe('伦敦')
    expect(chinese.items[0].en).toBe('London')
  })

  it('无关键词 → 按库序给前 limit 条（不是空列表：界面「先列小库」时大库也可能被问）', async () => {
    const result = await methods()['bazi.cities']({})
    expect(result.source).toBe('full')
    expect(result.items).toHaveLength(20)
  })

  it('limit 夹取：只在 1..50 内，非法值回落缺省 20', async () => {
    expect((await methods()['bazi.cities']({ query: 'a', limit: 3 })).items).toHaveLength(3)
    expect((await methods()['bazi.cities']({ query: '区', limit: 999 })).items).toHaveLength(50)
    expect((await methods()['bazi.cities']({ query: '区', limit: 'x' })).items).toHaveLength(20)
    expect((await methods()['bazi.cities']({ query: '区', limit: 0 })).items).toHaveLength(20)
  })

  it('搜不到就是空列表（不报错、不硬塞一条最像的）', async () => {
    const result = await methods()['bazi.cities']({ query: 'zzzz-不存在的城市-qqqq' })
    expect(result).toEqual({ items: [], source: 'full' })
  })
})

describe('bazi.cities · 用户覆盖位（契约 §1）', () => {
  it('<dataDir>/geo/cities-full.json 存在时优先用它，而不是随包那份', async () => {
    const sandbox = makeSandbox('cities-override')
    mkdirSync(join(sandbox.dataDir, 'geo'), { recursive: true })
    writeFileSync(sandbox.path('geo', 'cities-full.json'), JSON.stringify([
      { name: '我的出生地', region: 'CN', pinyin: 'wo de chu sheng di', lat: 12.34, lon: 56.78 },
    ]))
    const api = methods({ sandbox })
    const hit = await api['bazi.cities']({ query: '出生地' })
    expect(hit).toEqual({ items: [{ name: '我的出生地', region: 'CN', pinyin: 'wo de chu sheng di', lat: 12.34, lon: 56.78 }], source: 'full' })
    // 覆盖位生效 = 随包那份不再参与（否则「上海」还会命中）
    expect((await api['bazi.cities']({ query: '上海' })).items).toEqual([])
  })

  it('随包大库确实在包里（改了数据/漏提交文件时这条会红）', () => {
    expect(HOST_PACKAGE).toContain('xuanshu-host')
    const sandbox = makeSandbox('cities-bundled-exists')
    const api = methods({ sandbox })
    return expect(api['bazi.cities']({ query: '北京市' })).resolves.toMatchObject({ source: 'full' })
  })
})
