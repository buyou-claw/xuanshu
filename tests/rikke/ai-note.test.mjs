/**
 * #24 · 日课两段式：**确定性骨架**（黄历三键，永远有）+ **AI 段**「今天注意什么」（可关、失败只给骨架）。
 *
 * 契约（`.scratch/notes/spec002/contract-shell-notify.md` §3 的上游：
 * `docs/specs/002-reside-and-use.md:126`）把两端分开：骨架由宿主按本地黄历确定性算出，
 * AI 段只是**旁挂的一段文本**。所以本文件钉死三件事：
 *
 *   1. **三态诚实**：`ai:{mode:'ok',text}` / `{mode:'off'}` / `{mode:'failed',reason}` ——
 *      关闭 ≠ 失败 ≠ 成功，三者在产物与 `rikke.status` 里都分得开；
 *   2. **AI 绝不阻断骨架**：`ctx.llm` 缺席 / 流报错 / 空文本 / 开关关掉 —— 产物照写，
 *      `content.{yi,ji,liuri}` 三键照旧（这就是 `delivery.mjs` 的「模型不可得也照样出产物」）；
 *   3. **AI 段用的是真素材**：底座谱 + 底稿「最近」+ 当日三键（不是让模型凭空推运）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { AI_NOTE_SYSTEM, aiNotePrompt, composeAiNote } from '../../packages/xuanshu-host/lib/rikke/ai-note.mjs'
import { generateRikke } from '../../packages/xuanshu-host/lib/rikke/generate.mjs'
import { writeRikkeSettings } from '../../packages/xuanshu-host/lib/rikke/settings.mjs'
import { readRikke } from '../../packages/xuanshu-host/lib/rikke/store.mjs'
import { createPuRepository } from '../../packages/xuanshu-host/lib/pu/repository.mjs'
import { buildDigaoMeta, renderDigaoMarkdown } from '../../packages/xuanshu-host/lib/digao/skeleton.mjs'
import {
  BIRTH, fakeHorosa, fakeLlm, huangliFixture, makeCtx, makeSandbox, writeBaseSnapshot,
} from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 固定「现在」：2026-10-15 11:00 Asia/Shanghai（= 03:00Z）——与既有日课测试同一口径。 */
const NOW = () => new Date('2026-10-15T03:00:00.000Z')
const TODAY = '2026-10-15'
const TZ = 'Asia/Shanghai'
const BASE_SUMMARY = '擅长 Rust；做过十年工具链。'
const DIGAO_GENERATED_AT = '2026-10-15T03:00:00.000Z'
const RECENT_TEXT = '最近在准备周五交付：完成账户迁移，并安排一次验收。'
const PAST_TEXT = '过去完成了一个老项目，这件事不属于今天安排。'
const DIGEST_TEXT = '综合摘要可能同时带最近与曾经，不能当成最近素材。'
const AI_TEXT = '今天安排别太满：先把要交付的那件事收口，再处理走动类的事。'

/**
 * 一个完整的生成现场：底座快照 + 真机的黄历信封 + 底座谱 + 真实两段底稿（+ 可选假 LLM）。
 * @param {{llm?: object|null, withBase?: boolean, withDigao?: boolean, recentText?: string}} [parts]
 */
function scene(parts = {}) {
  const sandbox = makeSandbox('rikke-ai')
  roots.push(sandbox)
  writeBaseSnapshot(sandbox.dataDir, BIRTH)
  if (parts.withBase !== false) {
    createPuRepository(sandbox.dataDir).writeBase({}, { summary: BASE_SUMMARY })
  }
  if (parts.withDigao !== false) {
    const segments = [
      { source: 'workspace', name: '本周交付', text: parts.recentText ?? RECENT_TEXT },
      { source: 'shiji', name: '历史项目', text: PAST_TEXT, firstSeenAt: '2026-01-01', lastActiveAt: '2026-01-02' },
    ]
    const input = { segments, generatedAt: DIGAO_GENERATED_AT, digest: 'llm', digestText: DIGEST_TEXT }
    sandbox.write('digao.json', `${JSON.stringify(buildDigaoMeta(input), null, 2)}\n`)
    sandbox.write('digao.md', renderDigaoMarkdown(input))
  }
  const services = { xuanshuHorosa: fakeHorosa(huangliFixture('huangli-ok')).service }
  if (parts.llm !== null) services.llm = parts.llm ?? fakeLlm({ text: AI_TEXT })
  const ctx = makeCtx({ services })
  return { sandbox, ctx, llm: services.llm, horosa: services.xuanshuHorosa }
}

/** 跑一次生成链（定时那份，manual:false）。 */
function generate(target, over = {}) {
  return generateRikke({
    ctx: target.ctx, dataDir: target.sandbox.dataDir, date: TODAY, zone: TZ, manual: false, at: NOW(), ...over,
  })
}

/* ───────────────────────── 1. composeAiNote（三态） ───────────────────────── */

describe('#24 · AI 段三态：关 / 成功 / 失败（失败也给可读理由）', () => {
  it('开关关掉 → {mode:off}，一次 LLM 都不调', async () => {
    const target = scene()
    const ai = await composeAiNote({
      ctx: target.ctx, dataDir: target.sandbox.dataDir, date: TODAY,
      content: { yi: '祭祀、出行', ji: '动土', liuri: '甲戌日 · 土' }, enabled: false,
    })
    expect(ai).toEqual({ mode: 'off' })
    expect(target.llm.calls).toEqual([])
  })

  it('ctx.llm 缺席 → {mode:failed, reason}（可读，且不抛）', async () => {
    const target = scene({ llm: null })
    const ai = await composeAiNote({
      ctx: target.ctx, dataDir: target.sandbox.dataDir, date: TODAY,
      content: { yi: '祭祀、出行', ji: '动土', liuri: '甲戌日 · 土' },
    })
    expect(ai.mode).toBe('failed')
    expect(ai.reason).toMatch(/ctx\.llm/u)
  })

  it('流报错 → {mode:failed, reason 含 LLM}；空文本同样算失败（不编一段空话）', async () => {
    const failing = scene({ llm: fakeLlm({ fail: true }) })
    const failed = await composeAiNote({
      ctx: failing.ctx, dataDir: failing.sandbox.dataDir, date: TODAY,
      content: { yi: '祭祀、出行', ji: '动土', liuri: '甲戌日 · 土' },
    })
    expect(failed.mode).toBe('failed')
    expect(failed.reason).toMatch(/LLM/u)

    const empty = scene({ llm: fakeLlm({ text: '' }) })
    const emptyResult = await composeAiNote({
      ctx: empty.ctx, dataDir: empty.sandbox.dataDir, date: TODAY,
      content: { yi: '祭祀、出行', ji: '动土', liuri: '甲戌日 · 土' },
    })
    expect(emptyResult.mode).toBe('failed')
    expect(emptyResult.reason).toMatch(/空文本/u)
  })

  it('成功 → {mode:ok, text}，且模型拿到的是真素材（底座谱 + 底稿最近 + 当日三键）', async () => {
    const target = scene()
    const content = { yi: '祭祀、出行', ji: '动土', liuri: '甲戌日 · 土' }
    const ai = await composeAiNote({ ctx: target.ctx, dataDir: target.sandbox.dataDir, date: TODAY, content })
    expect(ai).toEqual({ mode: 'ok', text: AI_TEXT })

    const stream = target.llm.calls.find((call) => call.method === 'stream')
    expect(stream.options.system).toBe(AI_NOTE_SYSTEM)
    const prompt = stream.options.messages[0].content[0].text
    expect(prompt).toContain(TODAY)
    expect(prompt).toContain('祭祀、出行')
    expect(prompt).toContain('动土')
    expect(prompt).toContain('甲戌日 · 土')
    expect(prompt).toContain(BASE_SUMMARY) // 底座谱
    expect(prompt).toContain(DIGAO_GENERATED_AT)
    expect(prompt).toContain(RECENT_TEXT) // 要有正在做什么；只有生成时间/段数不算素材。
    expect(prompt).not.toContain(PAST_TEXT)
    expect(prompt).not.toContain(DIGEST_TEXT)
  })

  it('底稿最近正文有界，截断有信号且不带曾经那段', async () => {
    const target = scene({ recentText: '当前工作'.repeat(1000) + '超出预算的末尾标记' })
    await composeAiNote({
      ctx: target.ctx, dataDir: target.sandbox.dataDir, date: TODAY,
      content: { yi: '祭祀', ji: '动土', liuri: '甲戌日' },
    })
    const prompt = target.llm.calls.find((call) => call.method === 'stream').options.messages[0].content[0].text
    expect(prompt).toContain('当前工作')
    expect(prompt).toContain('…')
    expect(prompt).not.toContain('超出预算的末尾标记')
    expect(prompt).not.toContain(PAST_TEXT)
    expect(prompt.length).toBeLessThan(3000)
  })

  it('只有元数据或旧版正文时说明最近正文不可得，不用历史内容顶替', async () => {
    const target = scene()
    target.sandbox.write('digao.md', `# 底稿\n\n## 曾经做过什么\n${PAST_TEXT}\n`)
    const ai = await composeAiNote({
      ctx: target.ctx, dataDir: target.sandbox.dataDir, date: TODAY,
      content: { yi: '祭祀', ji: '动土', liuri: '甲戌日' },
    })
    expect(ai.mode).toBe('ok')
    const prompt = target.llm.calls.find((call) => call.method === 'stream').options.messages[0].content[0].text
    expect(prompt).toContain('最近正文不可得')
    expect(prompt).not.toContain(PAST_TEXT)
  })

  it('素材缺失（没有底座谱 / 没有底稿）也照样能跑：如实写「还没有」，不编', () => {
    const prompt = aiNotePrompt({
      date: TODAY,
      content: { yi: '祭祀', ji: '动土', liuri: '甲戌日' },
      base: null,
      recent: null,
    })
    expect(prompt).toContain('还没有底座谱')
    expect(prompt).toContain('还没有底稿')
  })
})

/* ───────────────────────── 2. 产物：骨架永远有，ai 是加性字段 ───────────────────────── */

describe('#24 · 产物两段式：骨架永远落盘，ai 只是旁挂', () => {
  it('AI 成功 → 产物带 {mode:ok,text}，三键照旧', async () => {
    const target = scene()
    const generated = await generate(target)
    expect(generated.ok).toBe(true)
    const record = target.sandbox.readJson('rikke', `${TODAY}.json`)
    expect(Object.keys(record.content).sort()).toEqual(['ji', 'liuri', 'yi'])
    expect(record.ai).toEqual({ mode: 'ok', text: AI_TEXT })
    expect(record.manual).toBe(false)
    // 生成结果也带回 ai（人点那条路要用它决定面板显示哪一支）。
    expect(generated.ai).toEqual({ mode: 'ok', text: AI_TEXT })
  })

  it('设置里关掉 AI 段 → 产物写 {mode:off}，三键照旧落盘（关 ≠ 失败 ≠ 成功）', async () => {
    const target = scene()
    writeRikkeSettings(target.sandbox.dataDir, { aiEnabled: false })
    const generated = await generate(target)
    expect(generated.ok).toBe(true)
    const record = target.sandbox.readJson('rikke', `${TODAY}.json`)
    expect(Object.keys(record.content).sort()).toEqual(['ji', 'liuri', 'yi'])
    expect(record.ai).toEqual({ mode: 'off' })
    expect(target.llm.calls).toEqual([])
  })

  it('LLM 失败 / provider 缺席 → 产物照样落盘（三键在），ai 标 failed + 可读 reason', async () => {
    for (const llm of [null, fakeLlm({ fail: true })]) {
      const target = scene({ llm })
      const generated = await generate(target)
      expect(generated.ok).toBe(true)
      const record = target.sandbox.readJson('rikke', `${TODAY}.json`)
      expect(Object.keys(record.content).sort()).toEqual(['ji', 'liuri', 'yi'])
      expect(record.ai.mode).toBe('failed')
      expect(record.ai.reason.length).toBeGreaterThan(0)
      // 读面仍然 ready：ai 是加性字段，绝不能让既有判据变红。
      expect(readRikke(target.sandbox.dataDir, TODAY).state).toBe('ready')
    }
  })

  it('旧产物（没有 ai 键）/ ai 是坏形状 → readRikke 仍 ready（完整度判据只认三键）', () => {
    const target = scene()
    const legacy = {
      schema: 'xuanshu/rikke@1',
      date: TODAY,
      generatedAt: DIGAO_GENERATED_AT,
      zone: TZ,
      content: { yi: '祭祀', ji: '动土', liuri: '甲戌日' },
      huangli: { ok: true, version: '0.40.1', tool: 'horosa_cn_huangli' },
      manual: false,
    }
    target.sandbox.write(`rikke/${TODAY}.json`, `${JSON.stringify(legacy)}\n`)
    expect(readRikke(target.sandbox.dataDir, TODAY).state).toBe('ready')

    target.sandbox.write(`rikke/${TODAY}.json`, `${JSON.stringify({ ...legacy, ai: 'nope' })}\n`)
    expect(readRikke(target.sandbox.dataDir, TODAY).state).toBe('ready')
  })
})
