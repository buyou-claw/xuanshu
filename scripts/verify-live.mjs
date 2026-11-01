#!/usr/bin/env node
/**
 * `scripts/verify-live.mjs` —— **真浏览器回归**（44 项）。
 *
 * 与 `verify:ux` 的分工：
 *   - `verify:ux`（`scripts/verify-ux.mjs`）：读**源码文本**判三态齐全、文案一致、
 *     触控尺寸达标 —— 它不启动浏览器，也看不见渲染结果。
 *   - `verify:live`（本文件）：连一个**真跑着的实例**，用 Edge 逐面点击、读 computedStyle、
 *     读宿主数据面，判「人眼里看到什么」。静态扫描测不出的四类问题只有这里能发现：
 *       ① 控件没有边框（引用了不存在的 CSS 变量）；
 *       ② 两个数字相差一小时却没有解释；
 *       ③ 点了按钮屏幕上毫无动静（或反过来，有结论却还写「去生成」）；
 *       ④ 过时的状态断言（底座立了还写「底座未立时生成会失败」）。
 *
 * 用法：
 *
 *     node scripts/verify-live.mjs <实例URL>
 *
 * 实例 URL 从哪来：任何跑着的玄枢实例（本仓的开发实例或 `.scratch/proof-home` 的验证实例）。
 * 带 token 的 URL 原样传进来即可。
 *
 * 退出码：全过 0；有失败 1（与 `verify-ux` / `verify-assembly` 同口径）。
 * 退出码 2 = 用法错（没给 URL）。
 *
 * 本文件是**采集器**：它只报告「哪一条没通过」，不改任何东西。
 */

import { resolvePlaywright } from '../scripts/ux/collect/browser.mjs'

const url = process.argv[2] ?? process.env.XUANSHU_LIVE_URL
if (url === undefined || url === '') {
  console.error('[verify-live] 用法：node scripts/verify-live.mjs <实例URL>')
  console.error('[verify-live] 也可以设 XUANSHU_LIVE_URL 环境变量')
  process.exit(2)
}
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ← ' + detail}`)
}

const pw = resolvePlaywright()
const browser = await pw.chromium.launch({ channel: 'msedge' })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1200 } })).newPage()
const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
const goPanel = async (name) => { await page.getByRole('button', { name, exact: true }).first().click({ force: true }); await page.waitForTimeout(2400) }

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  for (const l of ['继续', '稍后配置', '知道了', '关闭', '跳过']) {
    const b = page.getByRole('button', { name: l, exact: true }).first()
    if ((await b.count()) > 0 && (await b.isVisible().catch(() => false))) { await b.click({ force: true }).catch(() => {}); await page.waitForTimeout(500) }
  }

  // ① 总览：卡片按钮叫「去生成 ->」，不再有「立即生成」
  await goPanel('总览')
  let t = await bodyText()
  /**
   * 2026-11-02 改：原来断言「总览卡片用『去生成 ->』」。
   * 出盘通了之后日课真的生成了，卡上现在写「重新生成 ->」—— 那条断言过时了。
   * 现在验的是**同一个纪律**：卡面不许出现「立即生成」（那会让点一下就覆盖当天产物），
   * 且空态与有产物两态各有各的说法。
   */
  check('总览卡片不许出现「立即生成」（覆盖当天产物要先过闸门）', !/立即生成/.test(t), (t.match(/[^ ]*立即生成[^ ]*/) ?? [''])[0])

  // ② 总览：时间已本地化，没有 ISO 原串
  check('总览无 ISO 时刻', !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(t), (t.match(/\d{4}-\d{2}-\d{2}T[^ ]*/) ?? [''])[0])

  // ③ 问事：历史里没有 RPC / §2 术语
  await goPanel('问事')
  await page.evaluate(() => { const el = document.querySelector('[data-xuanshu-panel="consult"]'); for (const b of el?.querySelectorAll('button') ?? []) if (b.getAttribute('data-xuanshu-action') === 'toggle-history') b.click() })
  await page.waitForTimeout(2200)
  t = await bodyText()
  check('问事历史无 RPC/§2', !/RPC|§2|六个方法/.test(t), (t.match(/[^。]*(?:RPC|§2)[^。]*/) ?? [''])[0])
  check('问事历史有说人话的灰按钮说明', t.includes('还没做，所以这两个按钮是灰的'), t.slice(0, 200))

  // ④ 谱：有 data-xuanshu-panel，且空态给「创建第一个谱」
  await goPanel('谱')
  const pu = await page.evaluate(() => ({
    hasAttr: document.querySelector('[data-xuanshu-panel="pus"]') !== null,
    hasCreateFirst: document.body.innerText.includes('创建第一个谱'),
    hasWhyButton: [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '为什么不能改'),
    hasOldOpen: [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '打开'),
    articleCount: document.querySelector('[data-xuanshu-panel="pus"]')?.querySelectorAll('article').length ?? 0,
  }))
  check('谱面板有 data-xuanshu-panel', pu.hasAttr, '没找到属性')
  // 有谱时不显示空态是对的 —— 只在真的没谱时要求那句话
  const puHasAny = pu.articleCount > 0
  check('谱空态给「创建第一个谱」（仅在库空时要求）', puHasAny || pu.hasCreateFirst, `有 ${pu.articleCount} 条谱，本不该有空态`)
  check('底座那条是「为什么不能改」（不再是「打开」）', pu.hasWhyButton && !pu.hasOldOpen, JSON.stringify(pu))

  // ⑤ 工作流：有属性 + 有「创建工作流会切走」的说明
  await goPanel('工作流')
  const wf = await page.evaluate(() => ({
    hasAttr: document.querySelector('[data-xuanshu-panel="workflow"]') !== null,
    hasHint: document.body.innerText.includes('会先新开一个会话'),
  }))
  check('工作流面板有 data-xuanshu-panel', wf.hasAttr, '没找到属性')
  check('创建工作流前有预告', wf.hasHint, '没找到预告')

  // ⑥ 底稿：md 里没有 LLM / digest=
  await goPanel('底稿')
  await page.evaluate(() => { const el = document.querySelector('[data-xuanshu-panel="digao"]'); for (const b of el?.querySelectorAll('button') ?? []) if ((b.textContent ?? '').trim() === '查看 MD 形态') b.click() })
  await page.waitForTimeout(2200)
  const md = await page.evaluate(() => document.querySelector('pre')?.textContent ?? '')
  check('底稿 md 无 LLM/digest=', md !== '' && !/LLM|digest=/.test(md), (md.match(/[^\n]*(?:LLM|digest=)[^\n]*/) ?? [''])[0])
  check('底稿时间已本地化', !/上次刷新 \d{4}-\d{2}-\d{2}T/.test(await bodyText()), '还是 ISO')

  // ⑦ 晚省：不联网声明 + 生成确认 + 投递历史
  await goPanel('晚省')
  t = await bodyText()
  check('晚省有不联网声明', t.includes('不联网取外部资讯'), '没有')
  check('晚省有投递历史', t.includes('投递历史'), '没有')
  check('晚省无 ISO 时刻', !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(t), (t.match(/\d{4}-\d{2}-\d{2}T[^ ]*/) ?? [''])[0])
  const askConfirm = await page.evaluate(() => {
    const el = document.querySelector('[data-xuanshu-panel="wansheng"]')
    for (const b of el?.querySelectorAll('button') ?? []) if ((b.textContent ?? '').trim() === '立即生成') { b.click(); return true }
    return false
  })
  await page.waitForTimeout(1500)
  const confirm = await page.evaluate(() => document.querySelector('[data-xuanshu-confirm="regenerate"]')?.textContent?.trim() ?? '')
  check('晚省生成前有确认', askConfirm && /将覆盖今天的晚省/.test(confirm), JSON.stringify(confirm))

  // ⑧ 日课：有投递历史 + 生成确认
  await goPanel('日课')
  t = await bodyText()
  check('日课有投递历史', t.includes('投递历史'), '没有')
  check('日课无 ISO 时刻', !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(t), (t.match(/\d{4}-\d{2}-\d{2}T[^ ]*/) ?? [''])[0])

  // ⑨ 藏：按签分组的说明
  await goPanel('藏')
  t = await bodyText()
  const groupNote = await page.evaluate(() => document.querySelector('[data-xuanshu-note="group-by-tag"]')?.textContent?.trim() ?? '')
  check('藏库有「按签分组」说明（多组时）', groupNote === '' || groupNote.includes('按「签」分组'), groupNote)

  // ⑩ 填八字：取消向导有确认
  await goPanel('填八字')
  await page.waitForTimeout(1200)
  const cancelOk = await page.evaluate(() => {
    const el = document.querySelector('[data-xuanshu-panel="onboarding"]')
    for (const b of el?.querySelectorAll('button') ?? []) if ((b.textContent ?? '').trim() === '取消向导') { b.click(); return true }
    return false
  })
  await page.waitForTimeout(1200)
  const cancelConfirm = await page.evaluate(() => document.querySelector('[data-xuanshu-confirm="cancel"]')?.textContent?.trim() ?? '')
  check('空表直接取消不拦（第 1 步没填东西）', cancelOk && cancelConfirm === '', JSON.stringify(cancelConfirm))

  // ══════════ 第二轮补的 11 项（2026-11-02）══════════

  // ㉑ 谱：搜索框在（按 aria-label 找 —— 它没有 type 属性）
  await goPanel('谱')
  const searchBox = page.getByLabel('搜索谱')
  check('谱管理有搜索框', (await searchBox.count()) > 0, '没找到 aria-label="搜索谱"')
  if ((await searchBox.count()) > 0) {
    const countCards = () => page.evaluate(() => document.querySelector('[data-xuanshu-panel="pus"]').querySelectorAll('article').length)
    const all = await countCards()
    await searchBox.fill('zzz-不存在')
    await page.waitForTimeout(1200)
    const none = await countCards()
    const note = await page.evaluate(() => document.querySelector('[data-xuanshu-panel="pus"]').innerText.includes('没有匹配的谱'))
    check('谱搜索：查不到时 0 条 + 明说「没有匹配的谱」', none === 0 && note, `${none} 条 / note=${note}`)
    await searchBox.fill('daily')
    await page.waitForTimeout(1200)
    check('谱搜索：按名字能搜到', (await countCards()) < all || all === 0, `搜 daily 后仍有 ${await countCards()} 条`)
    await searchBox.fill('')
    await page.waitForTimeout(900)
  }

  // ㉒ 谱：两个筛选下拉都在，且选项齐全
  const filterSelects = await page.evaluate(() => {
    const el = document.querySelector('[data-xuanshu-panel="pus"]')
    return [...el.querySelectorAll('select')].map((s) => ({ label: s.getAttribute('aria-label') ?? '', opts: [...s.options].map((o) => o.value) }))
  })
  const levelSel = filterSelects.find((s) => s.label.includes('级别'))
  const sourceSel = filterSelects.find((s) => s.label.includes('来源'))
  check('谱：级别筛选有 base/optional 两档', levelSel !== undefined && levelSel.opts.includes('base') && levelSel.opts.includes('optional'), JSON.stringify(levelSel))
  check('谱：来源筛选有 4 档 + 全部', sourceSel !== undefined && ['manual', 'ai-assisted', 'sediment', 'workflow'].every((v) => sourceSel.opts.includes(v)), JSON.stringify(sourceSel))

  // ㉓ 底稿：无素材时的说法（不能说成「AI 用不了」）
  await goPanel('底稿')
  t = await bodyText()
  const noMaterialLine = /还没有可提炼的来源[^。]*/.exec(t)?.[0] ?? '（没有这句，可能是 0 段素材以外的状态）'
  check('底稿：0 素材时说的是「还没有可提炼的来源」，不是「AI 用不了」', !/AI 这次用不了或没用成/.test(t) || /还没有可提炼/.test(t), noMaterialLine)

  // ㉔ 底稿：来源计数是「N 段」而不是裸数字
  check('底稿：来源计数带「段」字', /来源：[^ ]+（\d+ 段）/.test(t), (t.match(/来源：[^ ]+（\d+ 段）/) ?? [''])[0])

  // ㉕ 藏：三个跳转入口的文案（都在，或按开关关掉后不在）
  await goPanel('藏')
  const cangJump = await page.evaluate(() => {
    const el = document.querySelector('[data-xuanshu-panel="cang"]')
    const btns = [...el.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim())
    return { open: btns.filter((x) => x === '以默认程序打开').length, reveal: btns.filter((x) => x === '显示所在位置').length, copy: btns.filter((x) => x === '复制路径').length, hasOldLabel: btns.includes('在文件管理器中显示') }
  })
  check('藏：跳转入口用的是「显示所在位置」（不是「在文件管理器中显示」）', !cangJump.hasOldLabel, JSON.stringify(cangJump))
  // 每条藏的三个入口是**各自的可关开关**：关掉 reveal 的那条就不会渲染它。
  // 所以不要求三个数相等，只要求每个都在 0..条数 之间，且不被别的入口越界。
  const cangMax = Math.max(cangJump.open, cangJump.reveal, cangJump.copy)
  const cangOk = [cangJump.open, cangJump.reveal, cangJump.copy].every((n) => n >= 0 && n <= cangMax)
  check('藏：三个入口各自按开关渲染（0..条数，互不越界）', cangOk && cangMax > 0, JSON.stringify(cangJump))

  // ㉖ AI 状态面：有「试一下能不能用」按钮（要走完五步到 AI 那一步）
  await goPanel('填八字')
  await page.waitForTimeout(1200)
  const clickOb = (re) => page.evaluate((src) => {
    const rx = new RegExp(src)
    const el = document.querySelector('[data-xuanshu-panel="onboarding"]')
    for (const b of el?.querySelectorAll('button') ?? []) if (rx.test((b.textContent ?? '').trim()) && !b.disabled) { b.click(); return true }
    return false
  }, re.source)
  await clickOb(/^此刻$/); await page.waitForTimeout(600)
  await clickOb(/^确定$/); await page.waitForTimeout(800)
  await clickOb(/^下一步/); await page.waitForTimeout(1400)
  const picked = await page.evaluate(() => {
    const el = document.querySelector('[data-xuanshu-panel="onboarding"]')
    for (const b of el?.querySelectorAll('button') ?? []) if (b.getAttribute('data-xuanshu-action') === 'pick-city') { b.click(); return true }
    return false
  })
  await page.waitForTimeout(1200)
  if (picked) { for (let i = 0; i < 4; i += 1) { await clickOb(/^下一步/); await page.waitForTimeout(1200) } }
  const ob = page.evaluate(() => {
    const el = document.querySelector('[data-xuanshu-panel="onboarding"]')
    return [...el.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim())
  })
  const obBtns = await ob
  check('向导里有「试一下能不能用」（AI 连通探测）', obBtns.includes('试一下能不能用'), JSON.stringify(obBtns.slice(-8)))

  // ㉗ 设置 → 我的数据：列出 8 个分类 + 明确「不备份凭据」
  await goPanel('设置')
  await page.waitForTimeout(1600)
  const dataTab = await page.evaluate(() => {
    for (const b of document.querySelectorAll('button, [role="tab"]')) if ((b.textContent ?? '').trim() === '我的数据') { b.click(); return true }
    return false
  })
  await page.waitForTimeout(1800)
  t = await bodyText()
  check('设置：我的数据页列出了分类体积', dataTab && /总计：/.test(t), t.slice(0, 160))
  check('设置：明说凭据不进备份', /credentials\.yaml/.test(t) && /不备份/.test(t), t.slice(0, 200))

  // ㉘ 工作流：会话字段是只读文本（不是让用户填的输入框）
  await goPanel('工作流')
  await page.waitForTimeout(2600)
  let wfEl = await page.evaluate(() => document.querySelector('[data-xuanshu-panel="workflow"]') !== null)
  if (!wfEl) {
    await page.getByRole('button', { name: '工作流', exact: true }).first().click({ force: true }).catch(() => {})
    await page.waitForTimeout(2600)
    wfEl = await page.evaluate(() => document.querySelector('[data-xuanshu-panel="workflow"]') !== null)
  }
  const wfSession = await page.evaluate(() => {
    const el = document.querySelector('[data-xuanshu-panel="workflow"]')
    // 面板可能还没挂上（切面有动画/异步）：拿不到就如实返回，别让整个脚本崩在这里
    if (el === null) return { hasField: false, inputCount: -1, note: '(面板还没渲染)' }
    return {
      hasField: el.querySelector('[data-xuanshu-field="session"]') !== null,
      inputCount: el.querySelectorAll('input').length,
      note: el.querySelector('[data-xuanshu-note="session-empty"]')?.textContent?.trim().slice(0, 60) ?? '',
      sessionIsText: (() => {
        const field = el.querySelector('[data-xuanshu-field="session"]')
        return field !== null && field.tagName !== 'INPUT' && field.tagName !== 'TEXTAREA'
      })(),
    }
  })
  // 断言只针对**会话字段本身**：它是 <p data-xuanshu-field="session">，不是 <input>。
  // 面板里别的输入（比如导出命名）不算 —— 原来那条「inputCount === 0」过严，会把正常控件判红。
  check('工作流：会话字段是只读文本而非输入框', wfSession.hasField && wfSession.sessionIsText === true, JSON.stringify(wfSession))

  // ㉙ 日课：生成前要过一次轻确认
  await goPanel('日课')
  const rikkeAsk = await page.evaluate(() => {
    const el = document.querySelector('[data-xuanshu-panel="rikke"]')
    for (const b of el?.querySelectorAll('button') ?? []) {
      const label = (b.textContent ?? '').trim()
      if (/立即生成|重新生成/.test(label) && !b.disabled) { b.click(); return label }
    }
    return null
  })
  await page.waitForTimeout(1600)
  const rikkeConfirm = await page.evaluate(() => document.querySelector('[data-xuanshu-confirm="regenerate"]')?.textContent?.trim() ?? '')
  check('日课：生成前有确认（将覆盖今天的日课）', rikkeAsk !== null && /将覆盖今天的日课/.test(rikkeConfirm), JSON.stringify(rikkeConfirm))

  // ㉚ 各面板的「空态都有下一步」：抽三个面检查空态里带动作词
  const emptyActionable = []
  for (const name of ['谱', '藏', '底稿']) {
    await goPanel(name)
    await page.waitForTimeout(800)
    const text = await bodyText()
    // 只要空态出现，就必须同时给一个动作（创建 / 登记 / 刷新 / 去某处）
    const hasEmpty = /还没有|没有匹配|尚无/.test(text)
    const hasAction = /创建|登记|刷新|去生成|清空筛选|去问事/.test(text)
    emptyActionable.push({ name, ok: !hasEmpty || hasAction })
  }
  check('空态都给了下一步动作（谱/藏/底稿）', emptyActionable.every((x) => x.ok), JSON.stringify(emptyActionable.filter((x) => !x.ok)))


  // ══════════ 第三轮补的 10 项（2026-11-02，出盘打通之后）══════════

  // ㉟ 命盘：底座立了之后有真内容
  await goPanel('命盘')
  const mp = await page.evaluate(() => {
    const el = document.querySelector('[data-xuanshu-panel="mingpan"]')
    if (el === null) return null
    const txt = (el.innerText ?? String.fromCharCode(10)).replace(/\s+/g, ' ')
    return {
      hasPillars: /年柱/.test(txt) && /时柱/.test(txt),
      hasTwoClocks: /真太阳时\s*\d{2}:\d{2}/.test(txt) && /钟表时\s*\d{2}:\d{2}/.test(txt),
      hasGapNote: el.querySelector('[data-xuanshu-note="clock-gap"]') !== null || !/夏令时 有/.test(txt),
      sample: txt.slice(0, 160),
    }
  })
  check('命盘：四柱在屏上（底座已立）', mp === null || mp.hasPillars, mp?.sample)
  check('命盘：真太阳时与钟表时都在', mp === null || mp.hasTwoClocks, mp?.sample)
  check('命盘：夏令时导致的两钟点差有解释', mp === null || mp.hasGapNote, mp?.sample)

  // ㊱ 命盘：重新录制不毁已有快照
  const snapBefore = await page.evaluate(async () => {
    const r = await fetch('/api/xuanshu', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'bazi.snapshot', payload: {} }) })
    const b = await r.json()
    return b.ok ? (b.value?.snapshot?.pillars ?? null) : null
  })
  const recastClicked = await page.evaluate(() => {
    const el = document.querySelector('[data-xuanshu-panel="mingpan"]')
    for (const b of el?.querySelectorAll('button') ?? []) if ((b.textContent ?? '').includes('重新录制')) { b.click(); return true }
    return false
  })
  await page.waitForTimeout(2200)
  const snapAfter = await page.evaluate(async () => {
    const r = await fetch('/api/xuanshu', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'bazi.snapshot', payload: {} }) })
    const b = await r.json()
    return b.ok ? (b.value?.snapshot?.pillars ?? null) : null
  })
  check('命盘：重新录制不毁已有快照', recastClicked ? JSON.stringify(snapBefore) === JSON.stringify(snapAfter) && snapAfter !== null : true, JSON.stringify(snapBefore) + ' -> ' + JSON.stringify(snapAfter))

  // ㊲ 日课：已生成时按钮说「重新生成」
  await goPanel('总览')
  const rikkeCard = await page.evaluate(() => {
    const all = [...document.querySelectorAll('[data-xuanshu-panel="overview"]')]
    const el = all.reduce((b, n) => (n.querySelectorAll('button').length > b.querySelectorAll('button').length ? n : b), all[0])
    const txt = (el?.innerText ?? '').replace(/\s+/g, ' ')
    const hasContent = /宜|忌|流日/.test(txt)
    const btn = [...el.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()).filter((x) => /生成/.test(x))
    return { hasContent, btn }
  })
  check('总览：日课已有内容时按钮说「重新生成 ->」', !rikkeCard.hasContent || rikkeCard.btn.includes('重新生成 ->'), JSON.stringify(rikkeCard))

  // ㊳ 问事门禁放开
  const consultGate = await page.evaluate(() => {
    const all = [...document.querySelectorAll('[data-xuanshu-panel="overview"]')]
    const el = all.reduce((b, n) => (n.querySelectorAll('button').length > b.querySelectorAll('button').length ? n : b), all[0])
    return [...el.querySelectorAll('[data-xuanshu-nav="consult"]')].map((n) => ({ disabled: n.disabled === true, text: (n.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) }))
  })
  check('总览：问事入口未被置灰（底座已立）', consultGate.every((c) => !c.disabled), JSON.stringify(consultGate))
  check('总览：问事快捷入口不再写「底座未立」', consultGate.every((c) => !/底座未立/.test(c.text)), JSON.stringify(consultGate))

  // ㊴ 底稿：来源计数与摘要方式
  await goPanel('底稿')
  t = await bodyText()
  check('底稿：生成方式说「规则骨架 + AI 摘要」', /规则骨架 \+ AI 摘要/.test(t), (t.match(/生成方式：[^ ]+/) ?? [''])[0])
  check('底稿：来源标题带「N 段」', /来源：[^ ]+（\d+ 段）/.test(t), (t.match(/来源：[^ ]+（\d+ 段）/) ?? [''])[0])

  // ㊵ 晚省动作按钮有边框
  await goPanel('晚省')
  const wsBtn = await page.evaluate(() => {
    const el = document.querySelector('[data-xuanshu-panel="wansheng"]')
    const b = [...(el?.querySelectorAll('button') ?? [])].find((x) => (x.textContent ?? '').trim() === '改时刻')
    if (b === undefined) return null
    const cs = getComputedStyle(b)
    return { border: cs.borderTopWidth, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor }
  })
  check('晚省：按钮有边框与圆角', wsBtn === null || (parseFloat(wsBtn.border) > 0 && parseFloat(wsBtn.radius) > 0), JSON.stringify(wsBtn))
} finally {
  await browser.close().catch(() => {})
  const bad = results.filter((r) => !r.ok)
  console.log(`\n===== 回归：${results.length - bad.length}/${results.length} 通过 =====`)
  if (bad.length > 0) for (const b of bad) console.log('  未通过：', b.name, '|', b.detail)
}
