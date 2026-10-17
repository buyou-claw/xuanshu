/**
 * tests/setup/mirror.test.mjs — **第 10 条**：镜像重写是纯函数（纯单测，零网络）。
 *
 * 判据来源：契约 §3.4 + §10 第 10 条：`mirrorCandidates(url, prefixes)` 的顺序 = **各 prefix 变体在前、
 * 原 URL 最后**；非 github URL 原样返回；空 prefix 列表只返回原 URL。语义**照抄上游**
 * `.upstream/horosa-skill/horosa-skill/src/horosa_skill/runtime/mirrors.py`。
 *
 * 为什么这条必须钉死顺序：这份候选表将来会同时喂给 horosa 自己的 installer（同一个
 * `HOROSA_RUNTIME_MIRROR`、同一套语义）。顺序一乱，「我们 SHA256 门验的 A / 上游装的 B」就会分叉；
 * 而「原 URL 最后」正是「镜像全挂时还能回落到权威地址」的那条底线。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GITHUB_ORIGIN, MIRROR_ENV, mirrorCandidates, parseMirrorPrefixes, preferredMirrorUrl } from '../../scripts/setup/mirror.mjs'

const ASSET = `${GITHUB_ORIGIN}/Horace-Maxwell/horosa-skill/releases/download/v0.40.1/horosa-runtime-win32-x64-v0.40.1.zip`
const SUFFIX = '/Horace-Maxwell/horosa-skill/releases/download/v0.40.1/horosa-runtime-win32-x64-v0.40.1.zip'

// 缺省前缀来自环境变量（上游 `mirrors=None` 的行为）。测试进程里先摘掉它，
// 让「空列表」这条断言测的是参数本身，而不是开发机上碰巧设过的环境变量。
const savedMirror = process.env[MIRROR_ENV]
beforeAll(() => { delete process.env[MIRROR_ENV] })
afterAll(() => {
  if (savedMirror === undefined) delete process.env[MIRROR_ENV]
  else process.env[MIRROR_ENV] = savedMirror
})

describe('票 05 · 镜像重写纯函数（mirrorCandidates）', () => {
  it('一个 prefix：变体在前、原 URL 最后', () => {
    expect(mirrorCandidates(ASSET, ['https://gh-proxy.com'])).toEqual([
      `https://gh-proxy.com${SUFFIX}`,
      ASSET,
    ])
  })

  it('多个 prefix：保持给出顺序，原 URL 仍在最后（不重排、不去尾）', () => {
    const prefixes = ['https://gh-proxy.com', 'https://ghfast.top', 'https://ghproxy.net']
    expect(mirrorCandidates(ASSET, prefixes)).toEqual([
      `https://gh-proxy.com${SUFFIX}`,
      `https://ghfast.top${SUFFIX}`,
      `https://ghproxy.net${SUFFIX}`,
      ASSET,
    ])
  })

  it('原 URL 永远排最后（把原 URL 也当 prefix 给进去，也不能插到前面）', () => {
    const candidates = mirrorCandidates(ASSET, ['https://gh-proxy.com', GITHUB_ORIGIN])
    expect(candidates[candidates.length - 1]).toBe(ASSET)
    expect(candidates[0]).toBe(`https://gh-proxy.com${SUFFIX}`)
  })

  it('空列表 / 未给前缀 → 只回原 URL', () => {
    expect(mirrorCandidates(ASSET, [])).toEqual([ASSET])
    expect(mirrorCandidates(ASSET, undefined)).toEqual([ASSET])
    expect(mirrorCandidates(ASSET, '')).toEqual([ASSET])
    expect(mirrorCandidates(ASSET, ' , , ')).toEqual([ASSET])
  })

  it('非 github URL 原样返回（自己的代理、file://、本地测试 server）', () => {
    for (const url of [
      'https://example.com/x.zip',
      'http://127.0.0.1:18080/horosa/horosa_skill-0.40.1-py3-none-any.whl',
      'file:///C:/tmp/x.zip',
      'https://github.com.evil.example.com/o/r/x.zip', // 前缀相同但**域名不同**：绝不能重写
      'https://github.com', // 光有 origin、没有 `/<path>`
    ]) {
      expect(mirrorCandidates(url, ['https://gh-proxy.com']), url).toEqual([url])
    }
  })

  it('同一种值不许有两种行为：数组形态与逗号串形态结果**逐元素相等**（含尾斜杠）', () => {
    // 上游只在「字符串 → 前缀数组」这一步做 rstrip("/")；本仓的 `--mirror` 是逗号串、而调用方拿到的
    // 是已解析的数组，两条路必须产出同一份候选表 —— 否则 `--mirror https://gh-proxy.com/` 与
    // `['https://gh-proxy.com/']` 会分叉成 `//owner/...`（一个静默 404 的坏候选）。
    const fromString = mirrorCandidates(ASSET, 'https://gh-proxy.com/')
    const fromArray = mirrorCandidates(ASSET, ['https://gh-proxy.com/'])
    expect(fromArray).toEqual(fromString)
    expect(fromArray[0]).toBe(`https://gh-proxy.com${SUFFIX}`)
    expect(fromArray).not.toContain(`https://gh-proxy.com//Horace-Maxwell/horosa-skill/releases/download/v0.40.1/horosa-runtime-win32-x64-v0.40.1.zip`)
  })

  it('逗号分隔串（CLI `--mirror a,b` 的形态）与数组等价，空段丢弃', () => {
    expect(mirrorCandidates(ASSET, 'https://gh-proxy.com, https://ghfast.top/')).toEqual([
      `https://gh-proxy.com${SUFFIX}`,
      `https://ghfast.top${SUFFIX}`,
      ASSET,
    ])
    expect(parseMirrorPrefixes('a, ,b/,')).toEqual(['a', 'b'])
  })

  it('缺省从 HOROSA_RUNTIME_MIRROR 读（与上游同一个变量名、同一套语义）', () => {
    process.env[MIRROR_ENV] = 'https://ghfast.top'
    try {
      expect(mirrorCandidates(ASSET)).toEqual([`https://ghfast.top${SUFFIX}`, ASSET])
    } finally {
      delete process.env[MIRROR_ENV]
    }
  })

  it('preferredMirrorUrl：有镜像就用第一个镜像，没有就用原 URL', () => {
    expect(preferredMirrorUrl(ASSET, ['https://gh-proxy.com'])).toBe(`https://gh-proxy.com${SUFFIX}`)
    expect(preferredMirrorUrl(ASSET, [])).toBe(ASSET)
  })

  it('GITHUB_ORIGIN 就是上游写死的那个 origin', () => {
    expect(GITHUB_ORIGIN).toBe('https://github.com')
  })
})
