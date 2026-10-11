/**
 * 测试台自己的单测（不需要装 profile、不跑 DSH、不联网）：解析器与产物物化器是整个契约测试台的
 * 地基，它们错了会以「假绿」的形式骗过 S1/S4/S3——所以先用真实抓取的 fixture 把它们钉住。
 *
 * fixture 都是**真实产物**的摘录（不是手编的样例）：
 *   fixtures/dump-excerpt.yml                ← `dsh --profile xuanshu --dump-config` 的真实输出摘录
 *   fixtures/dsh-headless.cordis.patch.yml   ← 真实安装的 @deepseek-ai/dsh-headless bundle 补丁
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  buildBaseline, extractInsertedRows, materializeClientBundle, parseEntryListYaml,
} from '../../scripts/verify-assembly.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures')
const TMP = join(HERE, '.tmp')
const read = (name) => readFileSync(join(FIXTURES, name), 'utf8')

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('parseEntryListYaml（--dump-config 的 YAML）', () => {
  const tree = parseEntryListYaml(read('dump-excerpt.yml'))
  const byId = new Map(tree.rows.map((row) => [row.id, row]))

  it('层注释与 patched by 都能认出来', () => {
    expect(tree.layers.map((layer) => layer.layer)).toContain('@deepseek-ai/dsh-base')
    expect(tree.layers.map((layer) => layer.layer)).toContain('@deepseek-ai/dsh-headless')
    expect(tree.layers.some((layer) => layer.layer === '@deepseek-ai/dsh-base' && layer.patchedBy === '@deepseek-ai/dsh-headless')).toBe(true)
  })

  it('行 id / name / 层归属正确', () => {
    expect(byId.get('timer').name).toBe('@deepseek-ai/cordis-plugin-timer')
    expect(byId.get('timer').layer).toBe('@deepseek-ai/dsh-base')
    expect(byId.get('hmr').patchedBy).toBe('@deepseek-ai/dsh-headless')
    expect(byId.get('headless-runner').name).toBe('@deepseek-ai/dsh-headless')
    expect(byId.get('xuanshu-host').layer).toBe('xuanshu-host')
    expect(byId.get('xuanshu-client').name).toBe('xuanshu-client')
  })

  it('!!js 表达式与布尔 disabled 不会被误读', () => {
    expect(byId.get('tool-plugin-manager').disabled).toBe(true)
    expect(byId.get('plugin-manager').disabled).toMatch(/^<expr:/)
    expect(byId.get('timer').disabled).toBeUndefined()
  })

  it('config 里的嵌套列表不会被当成新行', () => {
    // 真实 dump 里 config.thresholds 是缩进列表；headless-runner 的 inject 也是
    expect(byId.get('headless-startup')).toBeDefined()
    expect(byId.has('headlessStartup')).toBe(false)
    expect(tree.rows.every((row) => typeof row.id === 'string' && row.id !== '')).toBe(true)
  })

  it('空输入与 BOM/CRLF 不炸', () => {
    expect(parseEntryListYaml('').rows).toEqual([])
    const crlf = `\uFEFF# == L\r\n- id: a\r\n  name: 'a'\r\n`
    expect(parseEntryListYaml(crlf).rows).toEqual([{ id: 'a', name: 'a', layer: 'L', patchedBy: undefined, disabled: undefined, line: 2 }])
  })
})

describe('extractInsertedRows（bundle 补丁的 YAML）', () => {
  const patch = read('dsh-headless.cordis.patch.yml')
  const rows = extractInsertedRows(patch, '@deepseek-ai/dsh-headless')

  it('只取 insert 下的行，不把「改已有行」的 patch 条目算进来', () => {
    expect(rows.map((row) => row.id)).toEqual(['headless-startup', 'headless-runner'])
    // 这三个 id 在补丁里是顶层 `- id:`（patch 目标），不是插入行
    expect(rows.map((row) => row.id)).not.toContain('system-prompt')
    expect(rows.map((row) => row.id)).not.toContain('tools')
    expect(rows.map((row) => row.id)).not.toContain('hmr')
  })

  it('名字与来源层带上', () => {
    expect(rows[0]).toEqual({ id: 'headless-startup', name: '@deepseek-ai/dsh-headless/startup', layer: '@deepseek-ai/dsh-headless' })
  })

  it('多级缩进 / 同一 insert 块里混 config / patch 与 insert 交替', () => {
    const synthetic = [
      '- id: existing-row',            // patch 目标：不算行
      '  config:',
      '    a: 1',
      '- insert:',                     // 插入块
      '    - id: one',
      "      name: 'pkg-one'",
      '      config:',
      '        deep:',
      '          - a',
      '          - b',
      '    - id: two',                 // 同块第二行
      '      name: pkg-two',
      '- id: another-patch',           // 又一条 patch 目标
      '  disabled: true',
      '- insert:',
      '    - id: three',
      "      name: 'pkg-three'",
    ].join('\n')
    expect(extractInsertedRows(synthetic, 'L')).toEqual([
      { id: 'one', name: 'pkg-one', layer: 'L' },
      { id: 'two', name: 'pkg-two', layer: 'L' },
      { id: 'three', name: 'pkg-three', layer: 'L' },
    ])
  })
})

describe('materializeClientBundle（S3 的行为断言）', () => {
  it('物化一个信封良好的产物：id 与 apply/inject 都拿得到', () => {
    const bundle = [
      'window.__ModuleLoader__.load({',
      '  id: "xuanshu-client",',
      '  factory: (require) => {',
      '    const jsxRuntime = require("react/jsx-runtime");',
      '    const module = { exports: {} };',
      '    const inject = ["slots"];',
      '    const apply = (ctx) => { ctx.slots.inject("main", () => {}); };',
      '    module.exports.apply = apply;',
      '    module.exports.inject = inject;',
      '    return module.exports;',
      '  }',
      '});',
    ].join('\n')
    const result = materializeClientBundle(bundle)
    expect(result.id).toBe('xuanshu-client')
    expect(typeof result.exports.apply).toBe('function')
    expect(Array.isArray(result.exports.inject)).toBe(true)
    expect(result.requested).toEqual(['react/jsx-runtime'])
  })

  it('信封坏了要抛（load 次数不对 / 未声明依赖）', () => {
    expect(() => materializeClientBundle('window.__ModuleLoader__.load({ id: "a", factory: () => ({}) });\nwindow.__ModuleLoader__.load({ id: "b", factory: () => ({}) });'))
      .toThrow(/恰好调用一次/)
    expect(() => materializeClientBundle('window.__ModuleLoader__.load({ id: "xuanshu-client", factory: (r) => { r("lodash"); return {}; } });'))
      .toThrow(/未预期的 require\("lodash"\)/)
  })
})

describe('buildBaseline（漂移基线生成）', () => {
  const profileDir = join(TMP, 'profiles', 'fake')

  it('从已安装的 bundle 补丁里提取 id→name→层，并跳过非 DSH 的 bundle', () => {
    mkdirSync(join(profileDir, 'node_modules', '@deepseek-ai', 'fake-bundle'), { recursive: true })
    mkdirSync(join(profileDir, 'node_modules', 'xuanshu-host'), { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-fake',
      dsh: { profile: { bundles: ['@deepseek-ai/fake-bundle', 'xuanshu-host'] } },
    }))
    writeFileSync(join(profileDir, 'node_modules', '@deepseek-ai', 'fake-bundle', 'package.json'), JSON.stringify({
      name: '@deepseek-ai/fake-bundle', version: '9.9.9', dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(profileDir, 'node_modules', '@deepseek-ai', 'fake-bundle', 'cordis.patch.yml'), [
      '- id: patched-row',
      '  config:',
      '    x: 1',
      '- insert:',
      '    - id: row-a',
      '      name: pkg-a',
      '    - id: row-b',
      "      name: 'pkg-b'",
    ].join('\n'))
    writeFileSync(join(profileDir, 'node_modules', 'xuanshu-host', 'package.json'), JSON.stringify({ name: 'xuanshu-host', version: '0.1.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))

    const baseline = buildBaseline({ profileDir, dshHome: join(TMP, 'home'), dshVersion: '9.9.9' })
    expect(baseline.rows.map((row) => row.id)).toEqual(['row-a', 'row-b'])
    expect(baseline.sources).toEqual([
      { layer: '@deepseek-ai/fake-bundle', version: '9.9.9', patch: 'node_modules/@deepseek-ai/fake-bundle/cordis.patch.yml', rows: 2 },
    ])
    expect(baseline.profile).toBe('dsh-profile-fake')
    expect(baseline.schema).toBe('xuanshu/patch-row-baseline@1')
  })

  it('bundle 声明了却没装 → 明确报错，不静默少行', () => {
    const broken = join(TMP, 'broken')
    mkdirSync(broken, { recursive: true })
    writeFileSync(join(broken, 'package.json'), JSON.stringify({ name: 'dsh-profile-broken', dsh: { profile: { bundles: ['@deepseek-ai/not-installed'] } } }))
    expect(() => buildBaseline({ profileDir: broken, dshHome: TMP, dshVersion: 'x' }))
      .toThrow(/not installed/)
  })
})

describe('真实产物 fixtures 的自检', () => {
  it('fixtures 是从真实输出摘下来的（有层注释、有我们两行）', () => {
    const text = read('dump-excerpt.yml')
    expect(text).toContain('# == xuanshu-host')
    expect(text).toContain('# == xuanshu-client')
    expect(resolve(FIXTURES).startsWith(resolve(HERE))).toBe(true)
    expect(read('dsh-headless.cordis.patch.yml')).toContain('- insert:')
  })
})
