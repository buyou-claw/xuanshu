/**
 * 票 13 · 黄历信封 → 日课内容（契约 §2）
 *
 * 信封 fixture 是**真机捕获**（`tests/rikke/fixtures/envelopes/`，见同目录 PROVENANCE.md），
 * 不是手写的形状 —— 所以这几条断言钉的是「上游真给了什么」。
 *
 * 抓的真实缺陷/风险：
 *   ① **宜忌不在结构化字段里**：真机把「宜/忌」渲染进 `data.snapshot_text` 的 `[今日宜忌]` 段。
 *      想当然去找 `data.yi` / `data.ji` 的实现在真机上一个字都读不到（而单测如果对着自己编的
 *      形状写，会一路绿到用户面前）。
 *   ② **流日不许自己算干支**：日柱只能取自 `[起盘信息]` 的 `干支：…年 …月 **壬戌日**`。
 *      契约 §2 明写「流日与日主的关系由 horosa 黄历给出，**玄枢不自算干支**」。
 *      `liuri` 的形如 `壬戌日 · 土`，其中 `土` 是**日支的五行**（契约 §1 的样例 `甲子日 · 水` 同理：
 *      子=水，不是纳音「海中金」）—— 这条用「把干支行换成甲子日」的方式钉住。
 *   ③ **失败信封也是真样本**：`hour` 传成字符串时上游回 `tool.invalid_payload`（`huangli-invalid-payload.json`），
 *      `readHuangliEnvelope` 必须把它读成可读失败，而不是假装读到了一张空盘。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { branchElement, parseHuangliSections, readHuangliEnvelope } from '../../packages/xuanshu-host/lib/rikke/content.mjs'

const ENVELOPES = join(import.meta.dirname, 'fixtures', 'envelopes')
const fixture = (name) => JSON.parse(readFileSync(join(ENVELOPES, `${name}.json`), 'utf8'))

const OK = fixture('huangli-ok')
const BAD = fixture('huangli-invalid-payload')

describe('票13 · 黄历分段解析（真机 snapshot_text）', () => {
  it('按 `[段名]` 切段，段名与上游一致', () => {
    const sections = parseHuangliSections(OK.data.snapshot_text)
    expect(Object.keys(sections)).toContain('起盘信息')
    expect(Object.keys(sections)).toContain('今日宜忌')
    expect(sections['今日宜忌']).toContain('宜：')
  })

  it('成功信封 → ok + version/tool + 三键内容（宜/忌/流日）', () => {
    const parsed = readHuangliEnvelope(OK)
    expect(parsed.ok).toBe(true)
    expect(parsed.tool).toBe('huangli')
    expect(parsed.version).toBe('0.40.1')
    expect(parsed.content.yi).toBe('祭祀、祈福、求嗣、开光、出行、解除、上梁、入宅、移徙、安床、安门、纳财、纳畜、造畜稠')
    expect(parsed.content.ji).toBe('伐木、行丧、破土、嫁娶、安葬、开渠')
    expect(parsed.content.liuri).toBe('壬戌日 · 土')
    // 三键与票 07 的 XsRikkeCard ready 结构逐字对齐（yi/ji/liuri 全是 string）。
    expect(Object.keys(parsed.content).sort()).toEqual(['ji', 'liuri', 'yi'])
    for (const value of Object.values(parsed.content)) expect(typeof value).toBe('string')
  })

  it('流日取自信封干支行（玄枢不自算干支）：换成甲子日 → 甲子日 · 水（契约 §1 的样例形状）', () => {
    const rewritten = structuredClone(OK)
    rewritten.data.snapshot_text = rewritten.data.snapshot_text.replace('壬戌日', '甲子日')
    const parsed = readHuangliEnvelope(rewritten)
    expect(parsed.content.liuri).toBe('甲子日 · 水')
  })

  it('地支五行表按三合局给（子水/午火/卯木/酉金/辰土）', () => {
    expect(branchElement('子')).toBe('水')
    expect(branchElement('亥')).toBe('水')
    expect(branchElement('午')).toBe('火')
    expect(branchElement('卯')).toBe('木')
    expect(branchElement('酉')).toBe('金')
    expect(branchElement('戌')).toBe('土')
    expect(branchElement('未')).toBe('土')
    expect(branchElement('甲')).toBe(null) // 天干不进这张表
  })
})

describe('票13 · 黄历失败路径（真机失败信封）', () => {
  it('ok:false 的真实信封 → ok:false + 可读 reason（带上游 code 与原文），content 为空', () => {
    const parsed = readHuangliEnvelope(BAD)
    expect(BAD.ok).toBe(false)
    expect(parsed.ok).toBe(false)
    expect(parsed.content).toEqual({ yi: '', ji: '', liuri: '' })
    expect(parsed.code).toBe('tool.invalid_payload')
    expect(parsed.reason).toContain('hour')
  })

  it('成功信封但缺 `[今日宜忌]` 段 → ok:false（读不出宜忌就不算产出日课）', () => {
    const broken = structuredClone(OK)
    broken.data.snapshot_text = '[起盘信息]\n干支：丙午年 戊戌月 壬戌日\n'
    const parsed = readHuangliEnvelope(broken)
    expect(parsed.ok).toBe(false)
    expect(parsed.reason).toContain('今日宜忌')
  })

  it('连 snapshot_text 都没有（形状不符）→ ok:false，不抛', () => {
    for (const broken of [{ ok: true, tool: 'huangli', data: {} }, null, 'x', 42]) {
      const parsed = readHuangliEnvelope(broken)
      expect(parsed.ok, JSON.stringify(broken)).toBe(false)
      expect(typeof parsed.reason).toBe('string')
    }
  })
})
