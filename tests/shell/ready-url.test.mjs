/**
 * #23 · 认证 URL 的解析（冻结契约 §0 最后一条）。
 *
 * 契约原话：「取不到 URL 时壳必须如实显示『服务未就绪』，不许加载一个猜的地址」。
 * 所以这里钉两件事：
 *   1. 只认 `dsh web: <http URL>` **整行**（rc.2 `dsh-web-app/lib/index.js:203` 打印的那一行）；
 *      别的行（`dsh web: opening the default browser…`、缩进日志、空行）一律不认；
 *   2. stdout 是**流**：一行可能被拆进两个 chunk。必须按 `\n` 缓冲，不能对每个 chunk 直接跑正则。
 *
 * 已核对的真实格式（`.dsh-home/.../@deepseek-ai/dsh-web-app/lib/index.js:203`）：
 *   `console.log(\`dsh web: ${authenticatedUrl}${lanUrl === void 0 ? "" : \` (LAN: ${lanUrl})\`}\`)`
 * 即带 LAN 时同一行尾巴上还有一段 ` (LAN: http://…)`。契约给的正则只覆盖无 LAN 的形态；
 * 壳额外容忍这段尾巴（那一行里的主 URL 是 DSH 自己打的，仍然不是壳猜的），并在测试里各钉一条。
 */
import { describe, expect, it } from 'vitest'

import { createLineScanner, parseReadyUrlLine } from '../../packages/xuanshu-shell/lib/ready-url.mjs'

describe('#23 · parseReadyUrlLine：只认 DSH 亲口打的那一行', () => {
  it('标准形态：`dsh web: http://127.0.0.1:19388/?token=…` → 取出完整 URL', () => {
    const url = 'http://127.0.0.1:19388/?token=abcdef0123456789'
    expect(parseReadyUrlLine(`dsh web: ${url}`)).toBe(url)
  })

  it('容忍行尾 `\\r`（Windows 换行）与两端空白', () => {
    expect(parseReadyUrlLine('dsh web: http://127.0.0.1:19388/?token=abc\r')).toBe('http://127.0.0.1:19388/?token=abc')
    expect(parseReadyUrlLine('  dsh web: http://127.0.0.1:19388/?token=abc  ')).toBe('http://127.0.0.1:19388/?token=abc')
  })

  it('rc.2 带 LAN 尾巴的形态：取行内主 URL（不猜）', () => {
    expect(parseReadyUrlLine('dsh web: http://127.0.0.1:19388/?token=abc (LAN: http://192.168.1.10:19388/?token=abc)'))
      .toBe('http://127.0.0.1:19388/?token=abc')
  })

  it('不是认证 URL 的行一律 null（绝不猜地址）', () => {
    const lines = [
      '',
      '   ',
      'dsh web: opening the default browser; pass --no-open to disable',
      'dsh web: ',
      'dsh web: not-a-url',
      'dsh web: http://',
      'dsh web: https://127.0.0.1:19388/',
      'web-app: could not open the default browser because nope',
      'prefix dsh web: http://127.0.0.1:19388/',
      'dsh web: http://127.0.0.1:19388/ extra-junk',
      'dsh web: ftp://127.0.0.1:19388/',
    ]
    for (const line of lines) expect(parseReadyUrlLine(line), line).toBe(null)
    expect(parseReadyUrlLine(undefined)).toBe(null)
    expect(parseReadyUrlLine(null)).toBe(null)
  })
})

describe('#23 · createLineScanner：stdout 是流，按行缓冲', () => {
  it('一次 chunk 里多行 → 逐行交出；不完整行留到下一次', () => {
    const scanner = createLineScanner()
    expect(scanner.push('first line\nsecond ')).toEqual(['first line'])
    expect(scanner.push('line\nthird')).toEqual(['second line'])
    expect(scanner.push(' line\n')).toEqual(['third line'])
    expect(scanner.flush()).toEqual([])
  })

  it('一行被拆成多个 chunk（URL 恰好断开）→ 拼回来后才交出', () => {
    const scanner = createLineScanner()
    const line = 'dsh web: http://127.0.0.1:19388/?token=abcdef'
    expect(scanner.push(line.slice(0, 12))).toEqual([])
    expect(scanner.push(line.slice(12, 30))).toEqual([])
    expect(scanner.push(`${line.slice(30)}\n`)).toEqual([line])
    expect(parseReadyUrlLine(scanner.push(line.slice(0, 8))[0] ?? '')).toBe(null)
  })

  it('末尾没有换行时 flush 交出残行（进程被 kill 前的最后一行也不丢）', () => {
    const scanner = createLineScanner()
    scanner.push('dsh web: http://127.0.0.1:19388/?token=abc')
    expect(scanner.flush()).toEqual(['dsh web: http://127.0.0.1:19388/?token=abc'])
    expect(scanner.flush()).toEqual([])
  })

  it('空 chunk / 连续换行不产生伪行；超长行有上限、不无限吃内存', () => {
    const scanner = createLineScanner({ maxLineLength: 32 })
    expect(scanner.push('')).toEqual([])
    expect(scanner.push('\n\n')).toEqual(['', ''])
    scanner.push('x'.repeat(200))
    scanner.push('y'.repeat(200))
    const rest = scanner.push('\n')
    expect(rest).toHaveLength(1)
    expect(rest[0].length).toBeLessThanOrEqual(32)
  })
})
