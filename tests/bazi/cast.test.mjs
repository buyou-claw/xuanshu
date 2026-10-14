/**
 * 票 08 · `bazi.cast` 出盘编排（契约 §1/§2/§3）
 *
 * 断言只打**外部可观察**的三样东西：方法的返回值、沙箱里真落了哪些文件、发给 horosa 的 payload。
 * 假 `xuanshuHorosa` 回放的是票 06 在真机上捕获的信封（`tests/horosa/fixtures/envelopes/**`），
 * 所以「信封 → 快照/底座谱」这条链路上没有任何自造形状。
 *
 * 抓的真实缺陷/风险：
 *   ① **缺经纬度不许出盘，且一个字节都不许落**（spec:70、契约 §2）：真机缺经度会**静默**按钟表口径算，
 *      用户永远不知道自己少了一道校正。所以判据不只是 `phase='invalid'`，还有「horosa 一次都没被调」
 *      与「沙箱里文件数为 0」——这两条能挡住「先落个空快照再报错」这类半成品。
 *   ② **AI 不许静默出盘**（`confirmed !== true` → invalid）：这是向导「确认并出盘」那一下的机器抓手。
 *   ③ **`timeAlg` 缺省省略**（不是写 0）：写 0 与省略在今天的真机上同果，但上游一旦改缺省，
 *      显式 0 就把老代码钉在旧口径上。
 *   ④ **澄清闸拦截期间不落盘**（S3 §2.7）：闸是「就地回问」，不是错误；但没出盘就是没出盘 ——
 *      `bazi.status` 必须仍是 `empty`，界面上不许出现半张盘。
 *   ⑤ **落盘顺序**：底座谱先、快照后。快照是命盘卡的开关，先写快照再写谱失败 = 「有盘无谱」的半成品
 *      （S3 §352(e) 明令不点亮命盘卡）。
 */
import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'

import { createBaziMethods } from '../../packages/xuanshu-host/lib/bazi/service.mjs'
import { createPuRepository } from '../../packages/xuanshu-host/lib/pu/repository.mjs'
import { envelope, fakeHorosa, makeCtx, makeSandbox, missingHorosa } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 契约 §1 的样例出生信息（上海 1990-06-01 04:00，真机 fixture 同一份坐标）。 */
const BIRTH = { date: '1990-06-01', time: '04:00', zone: 'Asia/Shanghai', lat: 31.2304, lon: 121.4737, place: '上海' }
/** 真机四柱（`bazi-ok-*.json` 三份一致）。 */
const PILLARS = { year: '己巳', month: '丙子', day: '丙寅', hour: '甲午' }
/** 澄清闸的 `data` 在真机捕获里是 `{}`（PROVENANCE 已复核）。 */
const GATE_PROMPT = envelope('bazi-gate').error.details.agent_recovery.prompt_to_user

/** 起一套方法 + 沙箱 + 假 horosa。 */
function scene({ envelopeName = 'bazi-ok-default', horosa = 'fake' } = {}) {
  const sandbox = makeSandbox('cast')
  roots.push(sandbox)
  const fake = fakeHorosa(envelope(envelopeName))
  const ctx = makeCtx(horosa === 'fake' ? { xuanshuHorosa: fake.service } : {})
  const api = createBaziMethods(ctx, { dataDir: sandbox.dataDir })
  return { sandbox, fake, api }
}

describe('bazi.cast · 拒绝路径：一个字节都不落盘、一次都不调 horosa（契约 §2）', () => {
  const REJECTS = [
    ['confirmed 缺省', { birth: BIRTH }, /确认/u],
    ['confirmed=false', { birth: BIRTH, confirmed: false }, /确认/u],
    ['缺 lat', { birth: { ...BIRTH, lat: undefined }, confirmed: true }, /纬度|lat/u],
    ['缺 lon', { birth: { ...BIRTH, lon: undefined }, confirmed: true }, /经度|lon/u],
    ['lat 非有限数', { birth: { ...BIRTH, lat: 'x' }, confirmed: true }, /纬度|lat/u],
    ['lon 非有限数', { birth: { ...BIRTH, lon: NaN }, confirmed: true }, /经度|lon/u],
    ['lat 越界', { birth: { ...BIRTH, lat: 91 }, confirmed: true }, /纬度|lat/u],
    ['lon 越界', { birth: { ...BIRTH, lon: 181 }, confirmed: true }, /经度|lon/u],
    ['缺 date', { birth: { ...BIRTH, date: '' }, confirmed: true }, /date/u],
    ['缺 time', { birth: { ...BIRTH, time: '' }, confirmed: true }, /time/u],
    ['缺 zone', { birth: { ...BIRTH, zone: '' }, confirmed: true }, /zone/u],
    ['birth 整个缺失', { confirmed: true }, /出生|birth/u],
  ]
  for (const [label, request, pattern] of REJECTS) {
    it(`${label} → phase invalid + 不落盘 + 不调 horosa`, async () => {
      const { sandbox, fake, api } = scene()
      const result = await api['bazi.cast'](request)
      expect(result.phase, JSON.stringify(result)).toBe('invalid')
      expect(result.message).toMatch(pattern)
      expect(result.snapshot ?? null).toBe(null)
      expect(fake.calls, `${label} 竟然调了 horosa`).toEqual([])
      expect(sandbox.files(), `${label} 落了盘（spec:70 的静默退化就是这样漏出去的）`).toEqual([])
    })
  }
})

describe('bazi.cast · 出盘成功（真实信封 bazi-ok-default）', () => {
  it('phase ok；payload 缺省省略 timeAlg、带确认闸；快照与底座谱三件都落盘', async () => {
    const { sandbox, fake, api } = scene()
    const result = await api['bazi.cast']({ birth: BIRTH, confirmed: true, notes: '只知道大概：凌晨四点左右' })

    expect(result.phase, JSON.stringify(result)).toBe('ok')
    expect(typeof result.message).toBe('string')

    // ① 只走 xuanshuHorosa.baziBirth()，且 payload 口径与契约 §3 逐条对得上。
    expect(fake.calls).toHaveLength(1)
    const payload = fake.calls[0]
    expect(Object.prototype.hasOwnProperty.call(payload, 'timeAlg')).toBe(false) // 缺省省略
    expect(payload.agent_confirmed_settings).toBe(true)
    expect(payload.clarification_notes).toBe('只知道大概：凌晨四点左右')
    expect(payload.date).toBe('1990-06-01')
    expect(payload.zone).toBe('Asia/Shanghai')
    expect(payload.lat).toBe('31.2304')
    expect(payload.lon).toBe('121.4737')

    // ② 快照：schema / 出生信息 / 四柱 / 口径 / horosa 来源。
    expect(sandbox.exists('bazi', 'snapshot.json')).toBe(true)
    const snapshot = JSON.parse(sandbox.read('bazi', 'snapshot.json'))
    expect(snapshot.schema).toBe('xuanshu/bazi-snapshot@1')
    expect(typeof snapshot.generatedAt).toBe('string')
    expect(snapshot.birth).toEqual({ date: '1990-06-01', time: '04:00', zone: 'Asia/Shanghai', lat: 31.2304, lon: 121.4737, place: '上海', timeAlg: 0 })
    expect(snapshot.pillars).toEqual(PILLARS)
    expect(snapshot.horosa).toEqual({ version: '0.40.1', tool: 'bazi_birth' })
    // 口径：clock 来自请求；offset/dst 由 Intl 算出（1990-06-01 上海 = +09:00 夏令时）。
    expect(snapshot.basis.clock).toBe('04:00')
    expect(snapshot.basis.offsetMinutes).toBe(540)
    expect(snapshot.basis.dst).toBe(true)
    // baseline.trueSolar **只能**来自信封；票 06 的冻结接缝不回传 data.snapshot_text，
    // 所以按契约 §1「拿不到就省略该键」——绝不自己拿经度算一个假值。
    expect(Object.prototype.hasOwnProperty.call(snapshot.basis, 'trueSolar')).toBe(false)

    // ③ 底座谱：`_base` 三件（契约 §1）。
    expect(sandbox.files()).toEqual([
      'bazi/snapshot.json',
      'pus/_base/bazi.md',
      'pus/_base/manifest.md',
      'pus/_base/summary.md',
    ])
    const manifest = sandbox.read('pus', '_base', 'manifest.md')
    expect(manifest).toMatch(/spec: pu\/1/)
    expect(manifest).toMatch(/^name: "底座"$/m)
    expect(manifest).toMatch(/^level: base$/m)
    expect(manifest).toMatch(/^source: manual$/m)
    expect(manifest).toMatch(/^updated_at: "/m)
    expect(manifest).toMatch(/^# .+（概览）/m)
    const baziSection = sandbox.read('pus', '_base', 'bazi.md')
    for (const pillar of Object.values(PILLARS)) expect(baziSection).toContain(pillar)
    expect(baziSection).toContain('Asia/Shanghai')
    expect(baziSection).toContain('31.2304')
    expect(sandbox.read('pus', '_base', 'summary.md').trim().length).toBeGreaterThan(0)

    // ④ 出盘结果里带快照（界面据它点亮命盘卡，不必再读一次盘）。
    expect(result.snapshot.schema).toBe('xuanshu/bazi-snapshot@1')
    expect(result.snapshot.pillars).toEqual(PILLARS)
    expect(result.gate ?? null).toBe(null)
  })

  it('timeAlg=3 透传到 payload 与快照（口径是用户的，不是我们替他挑的）', async () => {
    const { sandbox, fake, api } = scene({ envelopeName: 'bazi-ok-meansolar' })
    const result = await api['bazi.cast']({ birth: { ...BIRTH, timeAlg: 3 }, confirmed: true })
    expect(result.phase).toBe('ok')
    expect(fake.calls[0].timeAlg).toBe(3)
    expect(JSON.parse(sandbox.read('bazi', 'snapshot.json')).birth.timeAlg).toBe(3)
  })

  it('重新出盘是**原子替换**：底座谱被新结果换掉，不留旧文件（S2 §127）', async () => {
    const { sandbox, api } = scene()
    await api['bazi.cast']({ birth: BIRTH, confirmed: true })
    const first = JSON.parse(sandbox.read('bazi', 'snapshot.json'))
    const second = await api['bazi.cast']({ birth: { ...BIRTH, time: '05:00', place: '上海（改）' }, confirmed: true })
    expect(second.phase).toBe('ok')
    const replaced = JSON.parse(sandbox.read('bazi', 'snapshot.json'))
    expect(replaced.birth.time).toBe('05:00')
    expect(replaced.birth.place).toBe('上海（改）')
    expect(sandbox.files()).toEqual(['bazi/snapshot.json', 'pus/_base/bazi.md', 'pus/_base/manifest.md', 'pus/_base/summary.md'])
    expect(sandbox.read('pus', '_base', 'bazi.md')).toContain('05:00')
    expect(typeof first.generatedAt).toBe('string')
  })
})

describe('bazi.cast · 澄清闸拦截（契约 §2：promptToUser 必须是信封原文）', () => {
  it('phase gate + gate.promptToUser 逐字等于信封 agent_recovery.prompt_to_user + 不落盘', async () => {
    const { sandbox, fake, api } = scene({ envelopeName: 'bazi-gate' })
    const result = await api['bazi.cast']({ birth: BIRTH, confirmed: true })

    expect(result.phase).toBe('gate')
    expect(result.snapshot ?? null).toBe(null)
    expect(result.gate.promptToUser).toBe(GATE_PROMPT) // 原文，不许转述、不许自己编问题
    expect(result.gate.promptToUser).toContain('调用 `bazi_birth` 前需要先确认这些会影响结果的设置')
    expect(Array.isArray(result.gate.questions)).toBe(true)
    expect(result.gate.questions).toHaveLength(4)
    for (const question of result.gate.questions) expect(typeof question).toBe('string')
    expect(result.message).toMatch(/澄清闸|确认/u)

    // 闸期间不落谱、不点亮命盘卡（S3 §2.7）。
    expect(fake.calls).toHaveLength(1) // 闸是「问上去了」，不是没调
    expect(sandbox.files()).toEqual([])
    expect((await api['bazi.status']({})).state).toBe('empty')
  })
})

describe('bazi.cast · 失败路径（契约 §2/§3）', () => {
  it('信封 ok:false（非闸）→ phase error，带上游原文；不落盘', async () => {
    const { sandbox, api } = scene({ envelopeName: 'bazi-error' })
    const result = await api['bazi.cast']({ birth: BIRTH, confirmed: true })
    expect(result.phase).toBe('error')
    expect(result.message).toMatch(/invalid_payload|出盘失败/u)
    expect(sandbox.files()).toEqual([])
    expect((await api['bazi.status']({})).state).toBe('empty')
  })

  it('horosa 服务不可得 → phase error，message 指向 pnpm setup:xuanshu；不落盘', async () => {
    const { sandbox, api } = scene({ horosa: 'missing' })
    const result = await api['bazi.cast']({ birth: BIRTH, confirmed: true })
    expect(result.phase).toBe('error')
    expect(result.message).toMatch(/setup:xuanshu/u)
    expect(sandbox.files()).toEqual([])
    expect(missingHorosa().service).toBeUndefined()
  })
})

describe('bazi.status / bazi.snapshot / bazi.basePu（契约 §2）', () => {
  it('未出盘：status=empty、snapshot=null、basePu=null', async () => {
    const { api } = scene()
    expect(await api['bazi.status']({})).toEqual({ state: 'empty' })
    expect(await api['bazi.snapshot']({})).toEqual({ snapshot: null })
    expect(await api['bazi.basePu']({})).toEqual({ pu: null })
  })

  it('出盘后：status=ready + 快照；**再调一次 status 不重新出盘**（horosa 仍只被调过一次）', async () => {
    const { sandbox, fake, api } = scene()
    await api['bazi.cast']({ birth: BIRTH, confirmed: true })

    const first = await api['bazi.status']({})
    expect(first.state).toBe('ready')
    expect(first.snapshot.pillars).toEqual(PILLARS)

    const before = sandbox.read('bazi', 'snapshot.json')
    const second = await api['bazi.status']({})
    expect(second.state).toBe('ready')
    expect(second.snapshot).toEqual(first.snapshot)
    expect(sandbox.read('bazi', 'snapshot.json')).toBe(before) // 字节级：status 是只读的
    expect(fake.calls).toHaveLength(1) // 没有第二次出盘

    expect((await api['bazi.snapshot']({})).snapshot).toEqual(first.snapshot)
  })

  it('快照文件坏了 → status=error + reason（不是假装 ready，也不是假装没出过盘）', async () => {
    const { sandbox, api } = scene()
    await api['bazi.cast']({ birth: BIRTH, confirmed: true })
    const fs = await import('node:fs')
    fs.writeFileSync(sandbox.path('bazi', 'snapshot.json'), '{ 坏掉的 JSON')
    const status = await api['bazi.status']({})
    expect(status.state).toBe('error')
    expect(typeof status.reason).toBe('string')
    expect(status.snapshot ?? null).toBe(null)
    expect((await api['bazi.snapshot']({})).snapshot).toBe(null)
  })

  it('快照 schema 不认识也算 error（改了 schema 的老文件不许被当成新快照读进来）', async () => {
    const { sandbox, api } = scene()
    await api['bazi.cast']({ birth: BIRTH, confirmed: true })
    const fs = await import('node:fs')
    const snapshot = JSON.parse(sandbox.read('bazi', 'snapshot.json'))
    snapshot.schema = 'xuanshu/bazi-snapshot@0'
    fs.writeFileSync(sandbox.path('bazi', 'snapshot.json'), JSON.stringify(snapshot))
    const status = await api['bazi.status']({})
    expect(status.state).toBe('error')
    expect(status.reason).toMatch(/schema/u)
  })

  it('bazi.basePu 读回底座谱：name/level/source 与 bazi.md 原文（票 10「默认在场」靠它）', async () => {
    const { api } = scene()
    await api['bazi.cast']({ birth: BIRTH, confirmed: true })
    const { pu } = await api['bazi.basePu']({})
    expect(pu).not.toBe(null)
    expect(pu.slug).toBe('_base')
    expect(pu.name).toBe('底座')
    expect(pu.level).toBe('base')
    expect(pu.source).toBe('manual')
    expect(pu.contents['bazi.md']).toContain(PILLARS.day)
    expect(pu.summary.trim().length).toBeGreaterThan(0)
  })

  it('底座谱不混进用户谱面：pu.list() 不列它、pu.read(\'_base\') 仍抛（契约 §7 用户 slug 语义不许动）', async () => {
    const { sandbox, api } = scene()
    await api['bazi.cast']({ birth: BIRTH, confirmed: true })
    const repository = createPuRepository(sandbox.dataDir)
    expect(repository.list()).toEqual([])
    expect(repository.baseSources()).toEqual([])
    expect(() => repository.read('_base')).toThrow(/路径无效/u)
    // 底座仍在盘上（只是不走用户谱那条路）。
    expect(existsSync(sandbox.path('pus', '_base', 'bazi.md'))).toBe(true)
  })
})
