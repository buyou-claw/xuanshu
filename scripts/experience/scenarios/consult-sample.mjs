#!/usr/bin/env node
/**
 * `scripts/experience/scenarios/consult-sample.mjs` —— **首条样板路径**（Spec 04 · 票 #78）。
 *
 * 两条场景，同一条真实任务的两个半程：
 *   - `consult-normal`（E03）：配模型 → 建谱 → 勾选 → 输入问题 → 提交 → 记录请求开始 / 首个反馈 / 终态；
 *   - `consult-history`（E06）：正常完成之后离开，从真实历史入口找回同一条记录，确认输入与产物仍在、
 *     追问入口是否进入同一会话、返回落点是否回到来处。
 *
 * 为什么两条场景要拆开跑、共用同一个 `--home`：E06 要验的是「离开之后再回来」。
 * 如果两条都在一个进程里连着走，「离开」就只是切了个面板，跨进程的持久化与真实历史入口都没被压到
 * （票 #80 还要在同一口径上验重启）。所以 E03 与 E06 各自起停实例、共用 home；E06 的输入是 E03 留下的
 * 真实记录，不是夹具里编出来的。
 *
 * 三条硬边界（ADR-0017 第 3 条，本文件一次都不许破）：
 *   1. **不用强制点击**：点不动就记「点不动」，那是发现；强制点击（`force`）会把真实阻断藏起来。
 *   2. **不用内部 RPC 代替表单**：模型配置、建谱、勾选、提交、历史回看全部走真实控件；
 *      本文件不 import `rpc`、不发 `fetch`，只读 DOM。
 *   3. **不模拟 AI 成功**：AI 产物只能从产品自己的界面（历史回看 / DSH 会话面板）读出来；
 *      读不到就记「没有真实产物」，不许拿夹具文本冒充。
 *
 * 模型密钥只从环境变量 `DeepSeekApi` 读，只交给密码输入框；本文件不打印、不写盘、不进步骤行。
 *
 * 仅使用 Node 内置模块（浏览器对象由 runner 注入）。ESM。
 */
import {
  dismissFirstRun,
  openConsult,
  readConsultState,
  sidebarRow,
  stableText,
} from './consult.mjs'

/** 虚构材料（计划 §9.2 第 3 条）：不涉及真实个人数据。 */
export const FIXTURE = Object.freeze({
  identity: '体验用户-01',
  birth: '1990-06-15 12:00 上海',
  puName: '体验-木工',
  material: '我周末学习木工，希望安排练习时间',
  question: '这周我只有两小时，怎样安排木工练习？',
})

const CONSULT = '[data-xuanshu-panel="consult"]'
const PUS = '[data-xuanshu-panel="pus"]'
const SETTINGS_DIALOG = '[role="dialog"]'
const START_ACTION = '[data-xuanshu-action="start-consult"]'
const HISTORY_TOGGLE = '[data-xuanshu-action="toggle-history"]'
const CONTINUE_ACTION = '[data-xuanshu-action="continue-consult"]'

/** 一般操作上限（计划 §9.3：15s）。 */
const ACTION_TIMEOUT_MS = 15_000
/** AI 终态预算（计划 §9.3：120s）。 */
const AI_BUDGET_MS = 120_000
/** 提交后的首个反馈轮询间隔：要抓住「开问事中…」那一瞬，也要尽早看见错误。 */
const FEEDBACK_POLL_MS = 100
/** 首个反馈的观察窗口：超过它还没有任何变化，就记「点了没反应」的候选。 */
const FEEDBACK_WINDOW_MS = 15_000

/** 把一段文案压成一行（步骤行只给一行；细节留给截图与 findings）。 */
function oneLine(text, limit = 200) {
  return stableText(text, limit)
}

/** 侧栏某个面板的真实入口（与 E01 同一条路径；不猜 URL、不调 layout API）。 */
async function openPanel(ctx, label) {
  const row = sidebarRow(ctx.page, label)
  if ((await row.count()) === 0) {
    ctx.log(`正在等：侧栏出现「${label}」行（客户端插件异步挂载）`)
    await ctx.settle(1_500)
  }
  await row.click({ timeout: ACTION_TIMEOUT_MS })
  await ctx.settle(1_200)
}

/** 读设置弹层里「模型」页的文本（只读；不判断它一定是什么形状）。 */
async function readSettingsDialog(page) {
  return page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((node) => node.getBoundingClientRect().width > 0)
    const text = dialogs.map((node) => node.innerText ?? '').join(' ').replace(/\s+/gu, ' ').trim()
    const keyInputs = dialogs.flatMap((node) => [...node.querySelectorAll('input[aria-label="API 密钥"]')])
      .filter((node) => node.getBoundingClientRect().width > 0)
      .map((node) => ({ disabled: node.hasAttribute('disabled'), type: node.getAttribute('type') ?? '' }))
    return {
      present: dialogs.length > 0,
      excerpt: text.slice(0, 500),
      keyInputs,
      mentionsConfigured: /API 密钥已配置/u.test(text),
      mentionsSaved: /已保存/u.test(text),
    }
  })
}

/**
 * 通过真实设置入口配模型（侧栏「设置」→「模型」）。
 *
 * 为什么必须先做这一步：E03 的建谱与问事都要真实 AI；没有可用的 provider，后面全是环境问题，
 * 不是产品问题。已经配过（同一个 home 复跑）就只做只读确认，不重复写。
 *
 * @returns {Promise<{ok: boolean, alreadyConfigured: boolean, saved: boolean, reason?: string, excerpt: string}>}
 */
async function configureModel(ctx) {
  ctx.log('正在等：侧栏「设置」→「模型」页')
  await openPanel(ctx, '设置')
  const dialog = ctx.page.locator(SETTINGS_DIALOG).last()
  if ((await dialog.count()) === 0) {
    return { ok: false, alreadyConfigured: false, saved: false, reason: '设置弹层没有出现', excerpt: '' }
  }
  const modelEntry = dialog.getByText('模型', { exact: true }).first()
  if ((await modelEntry.count()) === 0 || !(await modelEntry.isVisible().catch(() => false))) {
    return { ok: false, alreadyConfigured: false, saved: false, reason: '设置里找不到「模型」页入口', excerpt: oneLine(await dialog.innerText().catch(() => '')) }
  }
  await modelEntry.click({ timeout: ACTION_TIMEOUT_MS })
  await ctx.settle(1_200)
  const before = await readSettingsDialog(ctx.page)
  await ctx.shot('01-model-settings.png')

  if (before.keyInputs.length === 0) {
    // 没有密钥输入框 = 这一家已经配好；只读确认，不点「编辑」制造一次无意义的写入。
    await ctx.step({
      action: '通过真实设置入口确认模型已配置',
      target: '设置 → 模型',
      outcome: before.mentionsConfigured ? 'DeepSeek 的 API 密钥已配置（复用同一个 home）' : `模型页已打开（未看到密钥输入框）；摘录：${oneLine(before.excerpt, 80)}`,
      shot: '01-model-settings.png',
    })
    await closeSettings(ctx, dialog)
    return { ok: true, alreadyConfigured: true, saved: false, excerpt: before.excerpt }
  }

  const key = process.env.DeepSeekApi
  if (typeof key !== 'string' || key.trim() === '') {
    return {
      ok: false,
      alreadyConfigured: false,
      saved: false,
      reason: '环境变量 DeepSeekApi 未设置：模型配置是这条路径的真实前置，缺它记阻塞',
      excerpt: before.excerpt,
    }
  }
  const keyInput = dialog.locator('input[aria-label="API 密钥"]').first()
  await keyInput.fill(key, { timeout: ACTION_TIMEOUT_MS })
  // 密钥只进密码框：这一步不截图（截图会留下「输入过什么」的时序线索，而报告不需要它）。
  const save = dialog.locator('button', { hasText: /^保存$/u }).first()
  if ((await save.count()) === 0) {
    return { ok: false, alreadyConfigured: false, saved: false, reason: '模型页没有「保存」按钮', excerpt: before.excerpt }
  }
  await save.click({ timeout: ACTION_TIMEOUT_MS })
  let after = before
  const deadline = Date.now() + ACTION_TIMEOUT_MS
  while (Date.now() < deadline) {
    await ctx.settle(300)
    after = await readSettingsDialog(ctx.page)
    if (after.mentionsSaved || after.mentionsConfigured) break
  }
  await ctx.shot('02-model-saved.png')
  const saved = after.mentionsSaved || after.mentionsConfigured
  await ctx.step({
    action: '通过真实设置入口配置 DeepSeek 的 API 密钥',
    target: '设置 → 模型 → API 密钥 → 保存',
    outcome: saved ? '已保存（页上出现「已保存 / API 密钥已配置」）' : `保存后没有读到成功文案；摘录：${oneLine(after.excerpt, 80)}`,
    shot: '02-model-saved.png',
  })
  await closeSettings(ctx, dialog)
  return {
    ok: saved,
    alreadyConfigured: false,
    saved,
    ...(saved ? {} : { reason: '保存 API 密钥后页面没有给出成功状态' }),
    excerpt: after.excerpt,
  }
}

/** 关掉设置弹层（真实按钮；关不掉就记下来，不硬按 Esc 猜）。 */
async function closeSettings(ctx, dialog) {
  const close = dialog.locator('button', { hasText: /^关闭$/u }).first()
  if ((await close.count()) === 0) return false
  try {
    await close.click({ timeout: 8_000 })
    await ctx.settle(600)
    return true
  } catch {
    return false
  }
}

/** 谱面板里是否已经有同名谱（同一个 home 复跑时不重复建，也不把「已存在」当成失败）。 */
async function hasSamplePu(page) {
  return page.evaluate(({ panel, name }) => {
    const root = document.querySelector(panel)
    if (root === null) return false
    return [...root.querySelectorAll('article')].some((node) => (node.innerText ?? '').includes(name))
  }, { panel: PUS, name: FIXTURE.puName })
}

/** 等谱面板的列表加载完（`正在读取谱…` 消失或出现行）。 */
async function waitPuList(ctx) {
  const deadline = Date.now() + ACTION_TIMEOUT_MS
  while (Date.now() < deadline) {
    const text = await ctx.page.locator(PUS).innerText().catch(() => '')
    if (!text.includes('正在读取谱')) return text
    await ctx.settle(300)
  }
  return ctx.page.locator(PUS).innerText().catch(() => '')
}

/**
 * 通过界面准备测试谱（资料 → 谱名 → AI 转换 → 预览 → 确认落盘）。
 *
 * 为什么建谱也要走 AI：产品只提供这一条建谱路径（`pu.generate` 之后才有预览与「确认落盘」），
 * 没有「手写落盘」的入口；绕过它就等于绕过了用户真实会遇到的等待与失败。
 *
 * @returns {Promise<{ok: boolean, created: boolean, reused: boolean, reason?: string, excerpt: string}>}
 */
async function ensureSamplePu(ctx) {
  ctx.log('正在等：侧栏「谱」→ 谱列表')
  await openPanel(ctx, '谱')
  let listText = await waitPuList(ctx)
  if (await hasSamplePu(ctx.page)) {
    await ctx.shot('03-pu-existing.png')
    await ctx.step({
      action: '确认测试谱已存在（同一个 home 复用）',
      target: PUS,
      outcome: `谱列表里已有「${FIXTURE.puName}」；不重复创建`,
      shot: '03-pu-existing.png',
    })
    return { ok: true, created: false, reused: true, excerpt: oneLine(listText, 120) }
  }

  const createButton = ctx.page.getByRole('button', { name: '＋ 创建新谱', exact: true }).first()
  if ((await createButton.count()) === 0) {
    return { ok: false, created: false, reused: false, reason: '谱面板里找不到「＋ 创建新谱」', excerpt: oneLine(listText, 120) }
  }
  await createButton.click({ timeout: ACTION_TIMEOUT_MS })
  await ctx.settle(600)

  const materialBox = ctx.page.locator(`${PUS} textarea`).first()
  if ((await materialBox.count()) === 0) {
    return { ok: false, created: false, reused: false, reason: '建谱第一步没有资料输入框', excerpt: '' }
  }
  await materialBox.fill(FIXTURE.material, { timeout: ACTION_TIMEOUT_MS })
  await ctx.page.getByRole('button', { name: '下一步', exact: true }).first().click({ timeout: ACTION_TIMEOUT_MS })
  await ctx.settle(500)

  const nameInput = ctx.page.locator(`${PUS} label`).filter({ hasText: '谱名' }).locator('input').first()
  if ((await nameInput.count()) === 0) {
    return { ok: false, created: false, reused: false, reason: '建谱第二步没有谱名输入框', excerpt: '' }
  }
  await nameInput.fill(FIXTURE.puName, { timeout: ACTION_TIMEOUT_MS })
  const level = ctx.page.locator(`${PUS} select`).first()
  if ((await level.count()) > 0) {
    const value = await level.inputValue().catch(() => '')
    // 计划 §9.2 的「可选输入级 optional」：谱在问事里是可勾选的可选源，不是底座。
    if (value !== 'optional') await level.selectOption('optional', { timeout: ACTION_TIMEOUT_MS })
  }
  await ctx.shot('04-pu-filled.png')
  await ctx.step({
    action: '通过界面填写建谱资料与谱名',
    target: `${PUS} 建谱向导`,
    outcome: `资料「${FIXTURE.material}」；谱名「${FIXTURE.puName}」；级别 optional`,
    shot: '04-pu-filled.png',
  })

  const generate = ctx.page.getByRole('button', { name: '开始转换', exact: true }).first()
  if ((await generate.count()) === 0) {
    return { ok: false, created: false, reused: false, reason: '建谱第二步没有「开始转换」按钮', excerpt: '' }
  }
  ctx.log('正在等：AI 转换（建谱预览；最多 120s）')
  await generate.click({ timeout: ACTION_TIMEOUT_MS })
  const deadline = Date.now() + AI_BUDGET_MS
  let previewReady = false
  let failure = ''
  while (Date.now() < deadline) {
    await ctx.settle(1_000)
    const panelText = await ctx.page.locator(PUS).innerText().catch(() => '')
    if (panelText.includes('确认落盘')) { previewReady = true; break }
    const alert = await ctx.page.locator(`${PUS} [role="alert"]`).innerText().catch(() => '')
    if (alert.trim() !== '') { failure = oneLine(alert); break }
  }
  await ctx.shot('05-pu-preview.png')
  if (!previewReady) {
    await ctx.step({
      action: '等待建谱预览（AI 转换）',
      target: `${PUS} 建谱向导`,
      outcome: failure === '' ? '超时未完成：120s 内没有出现预览' : `转换失败：${failure}`,
      shot: '05-pu-preview.png',
    })
    return { ok: false, created: false, reused: false, reason: failure === '' ? '建谱预览超时未完成（AI 服务没有在 120s 内返回）' : `建谱 AI 转换失败：${failure}`, excerpt: '' }
  }
  await ctx.step({
    action: '等待建谱预览（AI 转换）',
    target: `${PUS} 建谱向导`,
    outcome: 'AI 转换完成，出现「确认落盘」预览',
    shot: '05-pu-preview.png',
  })

  const confirm = ctx.page.getByRole('button', { name: '确认落盘', exact: true }).first()
  await confirm.click({ timeout: ACTION_TIMEOUT_MS })
  const savedDeadline = Date.now() + ACTION_TIMEOUT_MS
  let saved = false
  while (Date.now() < savedDeadline) {
    await ctx.settle(300)
    const panelText = await ctx.page.locator(PUS).innerText().catch(() => '')
    if (panelText.includes('已落盘')) { saved = true; break }
  }
  await ctx.shot('06-pu-saved.png')
  if (!saved) {
    return { ok: false, created: false, reused: false, reason: '点「确认落盘」之后没有出现「已落盘」', excerpt: '' }
  }
  await ctx.step({
    action: '确认落盘（人点，不是脚本补数据）',
    target: `${PUS} 建谱向导`,
    outcome: '页面显示「已落盘：manifest.md + content.md + summary.md」',
    shot: '06-pu-saved.png',
  })
  const back = ctx.page.getByRole('button', { name: '回谱列表', exact: true }).first()
  if ((await back.count()) > 0) {
    await back.click({ timeout: 8_000 })
    await ctx.settle(1_200)
  }
  listText = await waitPuList(ctx)
  return { ok: true, created: true, reused: false, excerpt: oneLine(listText, 120) }
}

/** 在问事门厅勾选测试谱（真实 checkbox + 真实 label 文本）。 */
async function selectFixturePu(ctx) {
  ctx.log('正在等：问事面板的谱勾选区')
  const deadline = Date.now() + ACTION_TIMEOUT_MS
  let label = null
  while (Date.now() < deadline) {
    const candidate = ctx.page.locator(`${CONSULT} label`).filter({ hasText: FIXTURE.puName }).first()
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) { label = candidate; break }
    await ctx.settle(300)
  }
  if (label === null) return { found: false, checked: false, summary: '', selection: '' }
  const checkbox = label.locator('input[type="checkbox"]').first()
  if ((await checkbox.count()) === 0) return { found: true, checked: false, summary: '', selection: '' }
  if (!(await checkbox.isChecked().catch(() => false))) {
    await checkbox.check({ timeout: ACTION_TIMEOUT_MS })
    await ctx.settle(500)
  }
  const summary = await ctx.page.locator(`${CONSULT} [data-xuanshu-note="context-summary"]`).innerText().catch(() => '')
  const selection = await ctx.page.locator(`${CONSULT} [data-xuanshu-note="ask-selection"]`).innerText().catch(() => '')
  return {
    found: true,
    checked: await checkbox.isChecked().catch(() => false),
    summary: oneLine(summary, 120),
    selection: oneLine(selection, 120),
  }
}

/**
 * 提交问事并记录三个时刻：请求开始、首个反馈、终态。
 *
 * 「首个反馈」只认**屏上真的出现过**的东西：等待态（按钮变「开问事中…」/禁用）或错误条。
 * 如果点击后到错误出现之间什么都没看到，那也是一条事实（没有等待反馈），照实记，不替产品补一个。
 */
async function submitAndObserve(ctx) {
  const start = ctx.page.locator(`${CONSULT} ${START_ACTION}`).first()
  const before = await readConsultState(ctx.page)
  if ((await start.count()) === 0) {
    return { clicked: false, requestStarted: false, feedback: { kind: 'missing', text: '' }, terminal: { kind: 'nothing', text: '', inViewport: null } }
  }
  const disabled = before.startButtons[0]?.disabled === true
  if (disabled) {
    return { clicked: false, requestStarted: false, feedback: { kind: 'disabled', text: '' }, terminal: { kind: 'disabled', text: '', inViewport: null } }
  }

  ctx.log('正在等：点「＋ 开一次问事」之后产品的首个反馈')
  await start.click({ timeout: ACTION_TIMEOUT_MS })
  const clickedAt = Date.now()
  let feedback = { kind: 'none', text: '' }
  let terminal = { kind: 'none', text: '', inViewport: null }
  let sawBusy = false
  let busyText = ''

  // ① 首个反馈：等待态优先；错误条也是反馈（它就是产品给出的第一句话）。
  while (Date.now() - clickedAt < FEEDBACK_WINDOW_MS) {
    const state = await readConsultState(ctx.page)
    const button = state.startButtons[0]
    if (button !== undefined && (button.disabled || /开问事中/u.test(button.label))) {
      sawBusy = true
      busyText = button.label
      feedback = { kind: 'busy', text: button.label }
      await ctx.shot('07-busy.png')
      ctx.step({
        action: '记录请求开始后的首个反馈（等待态）',
        target: `${CONSULT} ${START_ACTION}`,
        outcome: `按钮进入「${button.label}」；请求已开始`,
        shot: '07-busy.png',
      })
      break
    }
    if (state.errorBlocks.length > 0) {
      feedback = { kind: 'error', text: oneLine(state.errorBlocks.map((block) => block.text).join(' / ')) }
      break
    }
    if (!state.consultPresent) {
      feedback = { kind: 'session', text: '' }
      break
    }
    await ctx.settle(FEEDBACK_POLL_MS)
  }
  if (!sawBusy && feedback.kind === 'none') {
    ctx.log('点击后 15s 内没有看到等待态或错误：记「点了没反应」的候选')
  }
  if (!sawBusy && feedback.kind === 'error') {
    ctx.log('点击后没有可观察的等待态，直接出现错误提示（如实记录）')
  }
  if (feedback.kind === 'none') {
    await ctx.shot('07-no-feedback.png')
    ctx.step({
      action: '记录请求开始后的首个反馈',
      target: `${CONSULT} ${START_ACTION}`,
      outcome: '点击后 15s 内屏上没有等待态、没有错误、也没有切走（点了没反应）',
      shot: '07-no-feedback.png',
    })
  }

  // ② 终态：可读错误 / 切进会话 / 120s 超时未完成。
  const terminalDeadline = clickedAt + AI_BUDGET_MS
  let lastState = 'starting'
  while (Date.now() < terminalDeadline) {
    const state = await readConsultState(ctx.page)
    if (state.errorBlocks.length > 0) {
      // 原始文本要留着抽会话短 id（`text` 会被 stableText 把 id 换成占位符，不能拿来定位）。
      const rawText = state.errorBlocks.map((block) => block.text).join(' / ')
      terminal = {
        kind: 'error',
        text: oneLine(rawText),
        rawText,
        inViewport: state.errorBlocks.some((block) => block.inViewport),
      }
      break
    }
    if (!state.consultPresent) {
      terminal = { kind: 'session', text: '', inViewport: null }
      break
    }
    lastState = state.loadingVisible || state.startButtons.some((button) => button.disabled) ? 'busy' : 'idle'
    if (Date.now() - clickedAt > 5_000 && Math.round((Date.now() - clickedAt) / 5_000) % 2 === 0) {
      ctx.log(`正在等：问事终态（${lastState}；已 ${Math.round((Date.now() - clickedAt) / 1000)}s / 120s）`)
    }
    await ctx.settle(500)
  }
  if (terminal.kind === 'none') {
    terminal = { kind: 'timeout', text: '', inViewport: null }
    ctx.log('超时未完成：120s 内没有终态（已保留当时画面）')
  }
  await ctx.shot('08-terminal.png')
  const after = await readConsultState(ctx.page)
  ctx.step({
    action: '记录提交问事的终态',
    target: `${CONSULT} ${START_ACTION}`,
    outcome: terminal.kind === 'error'
      ? `可读错误：${terminal.text}${terminal.inViewport === false ? '（提示渲染在可视区之外）' : ''}`
      : terminal.kind === 'session'
        ? '问事面板消失：产品切进了会话'
        : terminal.kind === 'timeout'
          ? '超时未完成：120s 内没有终态'
          : `没有终态（${lastState}）`,
    shot: '08-terminal.png',
    ...(terminal.kind === 'timeout' ? { note: '超时未完成：已保留当时画面（08-terminal.png）' } : {}),
  })
  await ctx.shot('08-terminal-full.png', { fullPage: true })
  // 「提示在不在人眼前」是这次实测里真实存在的一个问题：错误块渲染在面板顶部，
  // 而人停在底部的说事区。先拍不滚动的画面，再滚过去拍一张——两张放一起才说得清。
  if (terminal.kind === 'error') {
    let scrolled = false
    try {
      await ctx.page.locator(`${CONSULT} [data-xuanshu-error]`).first().scrollIntoViewIfNeeded({ timeout: 5_000 })
      await ctx.settle(400)
      scrolled = true
    } catch {
      /* 滚不动就保留当前画面，别让证据步骤变成场景失败 */
    }
    await ctx.shot('08b-terminal-scrolled.png')
    ctx.step({
      action: '把终态提示滚进视野另存一张',
      target: `${CONSULT} [data-xuanshu-error]`,
      outcome: scrolled
        ? `已滚动；滚动前提示在可视区=${terminal.inViewport}`
        : '提示块滚不动（截图仍是滚动前的画面）',
      shot: '08b-terminal-scrolled.png',
    })
  }
  return {
    clicked: true,
    requestStarted: true,
    feedback,
    terminal,
    sawBusy,
    busyText,
    // 刚建好的那条会话的短 id（只用于在历史列表里定位**这一条**，不写进步骤行）。
    sessionShortId: (() => {
      if (terminal.kind !== 'error') return ''
      const raw = /#?consult-[0-9a-z]+/iu.exec(String(terminal.rawText ?? ''))?.[0] ?? ''
      if (raw === '') return ''
      return raw.startsWith('#') ? raw : `#${raw}`
    })(),
    questionLeft: after.textarea === null ? null : after.textarea.value,
  }
}

/**
 * 从产品自己的历史回看里读回一条记录（E03 用它证明「AI 产物真的存在」，E06 用它证明「同一条记录找得回」）。
 *
 * 为什么不去读会话文件：那会绕过产品入口，把「记录在磁盘上」冒充成「用户找得回」。
 * 这里只点「历史回看」、点行、读阅读器里的消息。
 */
async function openHistoryReader(ctx, { query = '', shortId = '', timeoutMs = AI_BUDGET_MS } = {}) {
  const toggle = ctx.page.locator(`${CONSULT} ${HISTORY_TOGGLE}`).first()
  if ((await toggle.count()) === 0) return { opened: false, reason: '问事面板里没有「历史回看」入口' }
  await toggle.click({ timeout: ACTION_TIMEOUT_MS })
  await ctx.settle(1_200)

  if (query !== '') {
    const search = ctx.page.locator(`${CONSULT} [data-xuanshu-field="history-search"]`).first()
    if ((await search.count()) > 0) {
      await search.fill(query, { timeout: ACTION_TIMEOUT_MS })
      await ctx.settle(800)
    }
  }

  const rows = ctx.page.locator(`${CONSULT} [data-xuanshu-row]`)
  let rowCount = await rows.count()
  let searchMatched = rowCount > 0
  if (rowCount === 0 && query !== '') {
    // 搜索没命中不代表记录不在：清掉筛选再取第一条，并把「搜索没命中」记下来。
    const search = ctx.page.locator(`${CONSULT} [data-xuanshu-field="history-search"]`).first()
    if ((await search.count()) > 0) await search.fill('', { timeout: ACTION_TIMEOUT_MS })
    await ctx.settle(800)
    rowCount = await rows.count()
  }
  if (rowCount === 0) {
    return { opened: true, rowCount: 0, searchMatched, reason: '历史回看里一条记录都没有' }
  }

  // 指定了 shortId 就必须点**那一条**：刚建好的会话与旧记录标题相同，
  // 「点第一条」会把旧记录冒充成这一轮的结果（实测撞到过）。
  let row = rows.first()
  let rowFound = true
  let searchClearedForShortId = false
  const findRowByShortId = async () => {
    const total = await rows.count()
    for (let index = 0; index < total; index += 1) {
      const candidate = rows.nth(index)
      const id = (await candidate.locator('.xs-consult__shortid').first().innerText().catch(() => '')).trim()
      if (id === shortId) return candidate
    }
    return null
  }
  if (shortId !== '') {
    rowFound = false
    const matched = await findRowByShortId()
    if (matched !== null) {
      row = matched
      rowFound = true
    } else if (query !== '') {
      // 刚建好的会话在客户端清单里标题还是「未命名问事」（`consult.send` 之后没有回填），
      // 按问题搜索会把它筛掉。清空搜索再找一次：这不是「记录不在」，是「搜索看不到它」。
      const search = ctx.page.locator(`${CONSULT} [data-xuanshu-field="history-search"]`).first()
      if ((await search.count()) > 0) {
        await search.fill('', { timeout: ACTION_TIMEOUT_MS })
        await ctx.settle(800)
        searchClearedForShortId = true
        rowCount = await rows.count()
        const retried = await findRowByShortId()
        if (retried !== null) {
          row = retried
          rowFound = true
        }
      }
    }
  }
  // 历史行与阅读器的短 id / 标题都是普通 class（不是 data 属性）：选择器必须跟真实 DOM 对齐，
  // 不能因为「最近一次会话卡」有 `data-xuanshu-short-id` 就假设历史行也有。
  const rowShortId = (await row.locator('.xs-consult__shortid').first().innerText().catch(() => '')).trim()
  const rowText = oneLine(await row.innerText().catch(() => ''), 160)
  await ctx.shot('09-history-list.png')
  if (!rowFound) {
    // 不点任何一行：点旧记录会把「同一条」验成假的。把「刚建好的那条不在列表里」当事实带出去。
    return {
      opened: true,
      rowCount,
      searchMatched,
      rowFound: false,
      rowShortId: '',
      reason: `历史列表里没有刚建好的会话 ${shortId}（列表只有旧记录；这是本轮实测到的列表刷新问题）`,
    }
  }
  await row.click({ timeout: ACTION_TIMEOUT_MS })
  await ctx.settle(1_000)

  const deadline = Date.now() + timeoutMs
  let messages = []
  let readerShortId = ''
  let readerTitle = ''
  let lastRefresh = Date.now()
  while (Date.now() < deadline) {
    readerShortId = (await ctx.page.locator(`${CONSULT} [data-xuanshu-view="reader"] .xs-consult__shortid`).first().innerText().catch(() => '')).trim()
    readerTitle = (await ctx.page.locator(`${CONSULT} [data-xuanshu-view="reader"] .xs-consult__row-title`).first().innerText().catch(() => '')).trim()
    messages = await ctx.page.evaluate((panel) => {
      const root = document.querySelector(panel)
      if (root === null) return []
      return [...root.querySelectorAll('[data-xuanshu-message]')].map((node) => ({
        role: node.getAttribute('data-xuanshu-message') ?? '',
        source: node.querySelector('[data-xuanshu-source]')?.getAttribute('data-xuanshu-source') ?? '',
        text: (node.querySelector('.xs-consult__text')?.innerText ?? '').replace(/\s+/gu, ' ').trim(),
      }))
    }, CONSULT)
    const hasAssistant = messages.some((message) => message.role === 'assistant' && message.text.length > 40)
    if (hasAssistant && messages.some((message) => message.text.includes(FIXTURE.question))) break
    // 阅读器是**打开那一刻**的快照：AI 还在跑时先打开，它不会自己长出助手消息。
    // 真实用户会退出再点一次；这里照做（不是刷新 DOM，是重新走一遍列表 → 阅读器），
    // 既等到产物，也顺带验了「列表 → 阅读器」这条往返。
    if (Date.now() - lastRefresh > 10_000) {
      const back = ctx.page.locator(`${CONSULT} [data-xuanshu-action="back-list"]`).first()
      if ((await back.count()) > 0) {
        await back.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {})
        await ctx.settle(600)
        const again = ctx.page.locator(`${CONSULT} [data-xuanshu-row]`).first()
        if ((await again.count()) > 0) {
          await again.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {})
          await ctx.settle(800)
        }
      }
      lastRefresh = Date.now()
    }
    await ctx.settle(2_000)
  }
  await ctx.shot('10-history-reader.png', { fullPage: true })
  const injected = messages.find((message) => message.source === 'xuanshu-consult')
  const answer = [...messages].reverse().find((message) => message.role === 'assistant' && message.text.length > 40)
  return {
    opened: true,
    rowCount,
    searchMatched,
    searchClearedForShortId,
    rowShortId,
    rowText,
    readerShortId,
    readerTitle,
    sameShortId: rowShortId !== '' && rowShortId === readerShortId,
    questionPresent: messages.some((message) => message.text.includes(FIXTURE.question)),
    answerPresent: answer !== undefined,
    answerExcerpt: oneLine(answer?.text ?? '', 120),
    selectionPresent: injected !== undefined && injected.text.includes(`【来源：谱 ${FIXTURE.puName}】`),
    injectedExcerpt: oneLine(injected?.text ?? '', 160),
    messageCount: messages.length,
    messages,
  }
}

/**
 * 从侧栏「工作区」打开同一条会话（产品错误文案自己指的恢复路径）。
 *
 * 这条路径存在与否，是判定「DSH 会话面板不可达」是环境问题还是产品问题的关键：
 * 面板在侧栏里能展开、能点开会话，说明插件与面板都在；不可用的是产品**自动切过去**的那一步。
 */
async function openWorkspaceSession(ctx) {
  const group = ctx.page.locator('[role="treeitem"]').filter({ hasText: '未分组' }).first()
  if ((await group.count()) === 0) return { reachable: false, reason: '侧栏没有「工作区 / 未分组」树' }
  await group.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {})
  await ctx.settle(1_500)
  const items = ctx.page.locator('[role="treeitem"]').filter({ hasText: '已完成' })
  const count = await items.count()
  if (count === 0) return { reachable: false, reason: '工作区里没有「已完成」的会话行' }
  const item = items.first()
  const label = oneLine(await item.innerText().catch(() => ''), 80)
  await item.click({ timeout: ACTION_TIMEOUT_MS })
  await ctx.settle(3_000)
  const body = oneLine(await ctx.page.locator('body').innerText().catch(() => ''), 1_200)
  await ctx.shot('11-workspace-session.png')
  return {
    reachable: true,
    label,
    showsQuestion: body.includes(FIXTURE.question),
    showsAnswer: /已完成|木工|练习/u.test(body) && body.length > 400,
    bodyExcerpt: body,
  }
}

/**
 * E03 的终点归类（纯函数，零浏览器）。
 *
 * 口径来自票 #78 的验收标准：
 *   - 面板 / 模型 / 建谱这些**前置**缺了 → `blocked`（环境问题不记成产品缺陷）；
 *   - 选择或输入没被带入 → `fail`（这是 E03 要验的核心之一）；
 *   - 终态超时、没有真实 AI 产物 → `fail`；
 *   - 终态是可读错误、且产品没有自动切进会话 → `fail`（错误本身就是产品缺陷的证据），
 *     但摘要要如实写清「AI 产物在历史回看 / 工作区里看得见」——那是另一条事实，不能拿来抵消失败；
 *   - 终态切进会话且看得到 AI 产物 → `pass`。
 *
 * @param {object} observations
 * @returns {{status: 'pass'|'fail'|'blocked', evidence?: string, reason?: string, summary: string, observed: object}}
 */
export function decideNormalOutcome(observations = {}) {
  const panel = observations.panel ?? { opened: false }
  const model = observations.model ?? { ok: false, reason: '没有尝试配置模型' }
  const pu = observations.pu ?? { ok: false, reason: '没有尝试准备谱' }
  const selection = observations.selection ?? { checked: false }
  const question = observations.question ?? { filled: false }
  const submit = observations.submit ?? { clicked: false }
  const product = observations.product ?? { visible: false }
  const terminal = submit.terminal ?? { kind: 'none', text: '' }
  const feedback = submit.feedback ?? { kind: 'none', text: '' }

  /**
   * 证据串只列**这一步真的落过**的截图（文件名 + 步骤）：指向不存在的图，读者会以为有证据。
   * 顺序按「从入口到终态」排，报告里能照着走一遍。
   */
  const evidenceOf = (extra) => {
    const shots = ['01-model-settings.png']
    if (model.saved === true) shots.push('02-model-saved.png')
    if (pu.created === true) shots.push('04-pu-filled.png', '05-pu-preview.png', '06-pu-saved.png')
    else if (pu.reused === true) shots.push('03-pu-existing.png')
    if (selection.found === true) shots.push('04b-consult-selected.png')
    if (question.filled === true) shots.push('05b-consult-question.png')
    if (submit.requestStarted === true) {
      shots.push(feedback.kind === 'busy' ? '07-busy.png' : '07-no-feedback.png')
      shots.push('08-terminal.png')
      if (terminal.kind === 'error') shots.push('08b-terminal-scrolled.png')
    }
    if (product.visible === true) {
      shots.push(product.source === 'workspace' ? '11-workspace-session.png' : '10-history-reader.png')
    } else if (observations.workspace?.reachable === true) {
      shots.push('11-workspace-session.png')
    }
    shots.push(extra)
    return shots.filter((item) => typeof item === 'string' && item !== '').join(' / ')
  }

  const observed = {
    modelConfigured: model.ok === true,
    modelAlreadyConfigured: model.alreadyConfigured === true,
    puReady: pu.ok === true,
    puCreated: pu.created === true,
    puReused: pu.reused === true,
    selectionChecked: selection.checked === true,
    selectionCarried: selection.carried === true,
    questionFilled: question.filled === true,
    questionCarried: question.carried === true,
    requestStarted: submit.requestStarted === true,
    firstFeedback: feedback.kind,
    terminal: terminal.kind,
    terminalInViewport: terminal.inViewport ?? null,
    autoNavigation: terminal.kind === 'session',
    productVisible: product.visible === true,
    productSource: product.source ?? 'none',
    workspaceReachable: observations.workspace?.reachable === true,
  }

  if (panel.opened !== true) {
    return {
      status: 'blocked',
      reason: `问事面板没打开（试了 ${panel.attempts ?? 0} 次）——环境缺前置，不记成产品缺陷`,
      summary: '问事面板不可达',
      observed,
    }
  }
  if (model.ok !== true) {
    return {
      status: 'blocked',
      reason: `模型前置没配好：${model.reason ?? '未知原因'}（这是环境/服务问题，不是 E03 的产品结论）`,
      summary: '模型未配置',
      observed,
    }
  }
  if (pu.ok !== true) {
    // 建谱的 AI 转换失败属于服务/环境；建谱界面缺控件属于产品。理由里已经写清是哪一种。
    const service = /AI|超时|服务|转换失败/u.test(String(pu.reason ?? ''))
    return {
      status: service ? 'blocked' : 'fail',
      ...(service
        ? { reason: `建谱前置没走完：${pu.reason}` }
        : { evidence: evidenceOf(`建谱界面问题：${pu.reason}`) }),
      summary: `建谱没走完：${pu.reason}`,
      observed,
    }
  }
  if (selection.found !== true || selection.checked !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf(`问事勾选区里没有可勾的「${FIXTURE.puName}」或勾不上`),
      summary: '测试谱没有出现在勾选区 / 勾不上',
      observed,
    }
  }
  if (selection.carried !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf(`勾选后摘要没有带入「${FIXTURE.puName}」`),
      summary: '勾选没有被带入本次问事的上下文摘要',
      observed,
    }
  }
  if (question.filled !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf('问题输入框不可用'),
      summary: '问题填不进去',
      observed,
    }
  }
  if (submit.requestStarted !== true) {
    return {
      status: 'blocked',
      reason: '「开一次问事」按钮不可点（禁用 / 找不到）——先记环境，不记成产品缺陷',
      summary: '提交按钮不可点',
      observed,
    }
  }
  if (terminal.kind === 'timeout') {
    return {
      status: 'fail',
      evidence: evidenceOf('120s 内没有终态（超时未完成，已保留当时画面）'),
      summary: '超时未完成：提交后 120s 内没有可读终态',
      observed,
    }
  }
  if (terminal.kind === 'error') {
    return {
      status: 'fail',
      evidence: evidenceOf(`终态是可读错误：「${oneLine(terminal.text, 100)}」；自动切进会话=${terminal.kind === 'session'}`),
      summary: `终态是可读错误而不是 AI 结果：${oneLine(terminal.text, 80)}`
        + `；AI 产物${product.visible ? `在${product.source === 'workspace' ? '侧栏工作区' : '历史回看'}里看得见` : '没有看到'}`
        + `${question.carried ? '；原始问题已进会话' : '；原始问题没有进会话'}`,
      observed,
    }
  }
  if (terminal.kind === 'session') {
    if (product.visible !== true) {
      return {
        status: 'fail',
        evidence: evidenceOf('切进会话后没有读到真实 AI 产物'),
        summary: '切进了会话，但没有真实 AI 产物可见',
        observed,
      }
    }
    return {
      status: 'pass',
      evidence: evidenceOf(`切进会话且 AI 产物可见（${product.source ?? '会话'}）`),
      summary: '请求开始、首个反馈、终态齐全；终态切进会话且有真实 AI 产物',
      observed,
    }
  }
  return {
    status: 'fail',
    evidence: evidenceOf('提交后没有终态'),
    summary: '提交后没有终态（没有错误、没有切换、没有产物）',
    observed,
  }
}

/**
 * E06 的终点归类（纯函数，零浏览器）。
 *
 * 口径来自票 #78 的验收标准：同一条记录、原始输入与产物仍在、追问进入同一会话、返回落点合理。
 * 任何一条不成立都是 `fail`；没有记录可找是 `blocked`（E03 没跑或没留下记录）。
 *
 * @param {object} observations
 * @returns {{status: 'pass'|'fail'|'blocked', evidence?: string, reason?: string, summary: string, observed: object}}
 */
export function decideHistoryOutcome(observations = {}) {
  const panel = observations.panel ?? { opened: false }
  const history = observations.history ?? { opened: false, rowCount: 0 }
  const record = observations.record ?? {}
  const continueEntry = observations.continueEntry ?? { clicked: false }
  const landing = observations.landing ?? {}
  const stillThere = observations.stillThere ?? false

  /** 只列真的落过的截图（理由同 E03：指向不存在的图等于伪造证据）。 */
  const evidenceOf = (extra) => {
    const shots = ['09-history-list.png', '10-history-reader.png']
    if (continueEntry.clicked === true) shots.push('12-continue.png')
    if (continueEntry.sameSession !== true && continueEntry.clicked === true) shots.push('12b-continue-error.png')
    if (landing.afterReturn !== undefined && landing.afterReturn !== 'unknown') shots.push('13-return.png')
    if (stillThere === true) shots.push('14-history-again.png')
    shots.push(extra)
    return shots.filter((item) => typeof item === 'string' && item !== '').join(' / ')
  }

  const observed = {
    sameRecord: record.sameShortId === true,
    questionPresent: record.questionPresent === true,
    answerPresent: record.answerPresent === true,
    selectionPresent: record.selectionPresent === true,
    continueSameSession: continueEntry.sameSession === true,
    continueError: continueEntry.errorText ?? '',
    landingAfterReturn: landing.afterReturn ?? 'unknown',
    landingReasonable: landing.reasonable === true,
    stillThereAfterLeave: stillThere === true,
  }

  if (panel.opened !== true) {
    return {
      status: 'blocked',
      reason: '问事面板没打开——环境缺前置，不记成产品缺陷',
      summary: '问事面板不可达',
      observed,
    }
  }
  if (history.opened !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf('问事面板里没有「历史回看」入口'),
      summary: '历史入口不存在',
      observed,
    }
  }
  if ((history.rowCount ?? 0) === 0) {
    return {
      status: 'blocked',
      reason: '历史回看里没有可找回的记录：先跑 consult-normal 留下一条正常完成的问事',
      summary: '没有可找回的记录',
      observed,
    }
  }
  if (record.sameShortId !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf(`点开的记录短 id 与列表行不一致（行=${record.rowShortId ?? ''}，阅读器=${record.readerShortId ?? ''}）`),
      summary: '从历史入口点开的不是列表里那条记录',
      observed,
    }
  }
  if (record.questionPresent !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf('阅读器里找不到原始问题'),
      summary: '原始输入没有保留在记录里',
      observed,
    }
  }
  if (record.answerPresent !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf('阅读器里没有 AI 产物（助手消息）'),
      summary: '原始产物没有保留在记录里',
      observed,
    }
  }
  if (continueEntry.clicked !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf('阅读器里没有「继续这次问事」入口'),
      summary: '找不到追问入口',
      observed,
    }
  }
  if (continueEntry.sameSession !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf(`「继续这次问事」没有进入同一会话：${oneLine(continueEntry.errorText ?? '没有可读原因', 100)}`),
      summary: `追问入口失败：${oneLine(continueEntry.errorText ?? '没有可读原因', 80)}`,
      observed,
    }
  }
  if (landing.reasonable !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf(`离开再回来落到 ${landing.afterReturn ?? '未知'}（应回到问事，而不是总览首页）`),
      summary: `返回落点不合理：${landing.afterReturn ?? '未知'}`,
      observed,
    }
  }
  if (stillThere !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf('离开再回来后历史里找不到同一条记录'),
      summary: '离开再回来后记录不见了',
      observed,
    }
  }
  return {
    status: 'pass',
    evidence: evidenceOf('同一条记录、原始输入与产物都在、追问进入同一会话、返回回到问事'),
    summary: '历史找回与继续都走通',
    observed,
  }
}

/** 读问事面板当前是门厅还是历史子页（返回落点的判据）。 */
async function readConsultView(ctx) {
  return ctx.page.evaluate((panel) => {
    const root = document.querySelector(panel)
    if (root === null) return { present: false, view: 'absent' }
    if (root.querySelector('[data-xuanshu-view="reader"]') !== null) return { present: true, view: 'reader' }
    if (root.querySelector('[data-xuanshu-view="history-list"]') !== null) return { present: true, view: 'history-list' }
    return { present: true, view: 'lobby' }
  }, CONSULT)
}

// ── 场景定义 ────────────────────────────────────────────────────────────────

/**
 * 首条样板路径的两条场景。`index.mjs` 只加一行 spread；`run.mjs` 的 CLI 形状一个字都不动。
 */
export const SAMPLE_SCENARIOS = {
  'consult-normal': {
    id: 'consult-normal',
    caseId: 'E03',
    title: '配模型 → 建谱 → 勾选 → 问事 → 终态（首条样板路径的前半程）',
    shots: [
      '00-first-run.png', '01-model-settings.png', '02-model-saved.png',
      '03-pu-existing.png', '04-pu-filled.png', '05-pu-preview.png', '06-pu-saved.png',
      '04b-consult-selected.png', '05b-consult-question.png',
      '07-busy.png', '07-no-feedback.png', '08-terminal.png', '08-terminal-full.png', '08b-terminal-scrolled.png',
      '09-history-list.png', '10-history-reader.png', '11-workspace-session.png',
    ],
    /**
     * 走真实入口：配模型 → 建谱 → 勾选 → 提交；记录三个时刻，并确认 AI 产物真的存在。
     */
    async run(ctx) {
      ctx.log('正在等：页面首屏（客户端插件异步挂载）')
      await ctx.page.goto(ctx.env.url, { waitUntil: 'domcontentloaded' })
      await ctx.settle(4_000)
      await ctx.shot('00-first-run.png')
      const firstRun = await dismissFirstRun(ctx)
      ctx.step({
        action: '完成必要首跑操作（关闭首跑模态）',
        target: 'first-run-modals',
        outcome: firstRun.labels.length === 0
          ? '首屏没有出现首跑模态'
          : `关掉 ${firstRun.labels.length} 层：${firstRun.labels.join(' → ')}${firstRun.blocked ? '（遮罩还在，但认不出关闭按钮）' : ''}`,
        shot: '00-first-run.png',
      })
      ctx.note(`虚构材料：身份「${FIXTURE.identity}」，出生 ${FIXTURE.birth}；谱名「${FIXTURE.puName}」；资料「${FIXTURE.material}」；问题「${FIXTURE.question}」。本轮建谱与问事都不需要底座八字，未走「填八字」向导。`)

      const model = await configureModel(ctx)
      if (!model.ok) {
        return {
          status: decideNormalOutcome({ panel: { opened: true }, model, pu: { ok: false }, selection: {}, question: {}, submit: {}, product: {} }),
          observations: { model: { ok: false, reason: model.reason }, headline: '模型前置未就绪' },
        }
      }

      const pu = await ensureSamplePu(ctx)
      if (!pu.ok) {
        return {
          status: decideNormalOutcome({ panel: { opened: true }, model, pu, selection: {}, question: {}, submit: {}, product: {} }),
          observations: { model: { ok: true }, pu: { ok: false, reason: pu.reason }, headline: '建谱前置未走完' },
        }
      }

      const entry = await openConsult(ctx)
      const panel = { opened: entry.opened, attempts: entry.attempts }
      ctx.step({
        action: '点侧栏「问事」打开问事面板',
        target: CONSULT,
        outcome: entry.opened ? `面板出现（第 ${entry.attempts} 次点开）` : `面板没打开（试了 ${entry.attempts} 次）`,
      })
      if (!entry.opened) {
        return {
          status: decideNormalOutcome({ panel, model, pu, selection: {}, question: {}, submit: {}, product: {} }),
          observations: { model: { ok: true }, pu: { ok: true }, headline: '问事面板不可达' },
        }
      }

      const selection = await selectFixturePu(ctx)
      await ctx.shot('04b-consult-selected.png')
      ctx.step({
        action: '在问事门厅勾选测试谱',
        target: `${CONSULT} 谱勾选区`,
        outcome: selection.found
          ? `勾选「${FIXTURE.puName}」=${selection.checked}；摘要「${selection.summary}」；${selection.selection}`
          : `勾选区里没有「${FIXTURE.puName}」`,
        shot: '04b-consult-selected.png',
      })

      const questionBox = ctx.page.locator(`${CONSULT} textarea[data-xuanshu-field="consult-question"]`).first()
      let filled = false
      if ((await questionBox.count()) > 0 && (await questionBox.isEditable().catch(() => false))) {
        await questionBox.fill(FIXTURE.question, { timeout: ACTION_TIMEOUT_MS })
        filled = (await questionBox.inputValue().catch(() => '')) === FIXTURE.question
      }
      await ctx.shot('05b-consult-question.png')
      ctx.step({
        action: '在问事输入框里填入问题',
        target: 'textarea[data-xuanshu-field="consult-question"]',
        outcome: filled ? `已填入「${FIXTURE.question}」（尚未提交）` : '输入框不可用或填入后读不回原值',
        shot: '05b-consult-question.png',
      })

      const submit = await submitAndObserve(ctx)
      let product = { visible: false, source: 'none', excerpt: '' }
      let workspace = { reachable: false }
      let record = { questionPresent: false, selectionPresent: false, answerPresent: false }
      if (submit.terminal.kind === 'error') {
        // 终态是错误：产品自己的下一步是「去历史回看 / 侧栏工作区打开」。两条真实入口都试，
        // 目的是分清「AI 没产出」与「产物在、只是自动切过去那一步坏了」。
        ctx.log('正在等：历史回看里的 AI 产物（最多 120s）')
        const history = await openHistoryReader(ctx, { query: FIXTURE.question, shortId: submit.sessionShortId })
        const historyRowFound = history.rowFound !== false
        record = historyRowFound
          ? {
              questionPresent: history.questionPresent === true,
              selectionPresent: history.selectionPresent === true,
              answerPresent: history.answerPresent === true,
            }
          : { questionPresent: false, selectionPresent: false, answerPresent: false }
        if (historyRowFound && history.opened && history.answerPresent) {
          product = { visible: true, source: 'history-reader', excerpt: history.answerExcerpt }
          ctx.step({
            action: '从历史回看确认 AI 产物存在',
            target: `${CONSULT} 历史回看 → 阅读器`,
            outcome: `阅读器里有助手消息；原始问题在记录里=${history.questionPresent}；勾选谱仍在=${history.selectionPresent}`
              + `${history.searchClearedForShortId ? '；按问题搜索时没找到刚建好的那条（标题仍是「未命名问事」），清空搜索后才找到' : ''}`,
            shot: '10-history-reader.png',
          })
        } else if (historyRowFound) {
          ctx.step({
            action: '从历史回看确认 AI 产物存在',
            target: `${CONSULT} 历史回看 → 阅读器`,
            outcome: history.opened ? '历史回看里没有读到助手消息' : `历史回看打不开：${history.reason ?? '未知'}`,
            shot: '10-history-reader.png',
          })
        } else {
          // 刚建好的那条不在历史列表里：**不点旧记录冒充**，照实记下来。
          ctx.step({
            action: '从历史回看确认刚建好的那条记录',
            target: `${CONSULT} 历史回看`,
            outcome: `列表 ${history.rowCount} 条，但没有刚建好的 ${submit.sessionShortId}；${history.reason ?? ''}`,
            shot: '09-history-list.png',
          })
        }
        // 产品错误文案指的恢复路径：侧栏工作区。**无论历史回看有没有读到产物都要试一次**——
        // 「面板在、只是产品没自动切过去」与「面板根本不存在」是两种结论，只有点过才分得清。
        ctx.log('正在等：侧栏工作区里的会话（产品错误文案指的恢复路径）')
        workspace = await openWorkspaceSession(ctx)
        if (!product.visible && workspace.reachable && workspace.showsQuestion) {
          product = { visible: workspace.showsAnswer, source: 'workspace', excerpt: workspace.bodyExcerpt.slice(0, 120) }
        }
        ctx.step({
          action: '从侧栏工作区打开同一条会话',
          target: 'sidebar 工作区 → 未分组',
          outcome: workspace.reachable
            ? `工作区会话可点开；屏上有原始问题=${workspace.showsQuestion}；有 AI 回复=${workspace.showsAnswer}`
            : `工作区打不开：${workspace.reason ?? '未知'}`,
          shot: '11-workspace-session.png',
        })
        // 回到问事，给收尾一个确定的落点（不是必须，但让下一步的观察不被工作区占着）。
        const back = sidebarRow(ctx.page, '问事')
        if ((await back.count()) > 0) { await back.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {}); await ctx.settle(800) }
      } else if (submit.terminal.kind === 'session') {
        // 自动切进了会话：在 DSH 会话面板里等真实 AI 回复。
        ctx.log('正在等：会话面板里的 AI 回复（最多 120s）')
        const deadline = Date.now() + AI_BUDGET_MS
        let body = ''
        while (Date.now() < deadline) {
          body = await ctx.page.locator('body').innerText().catch(() => '')
          if (body.includes(FIXTURE.question) && /已完成|木工/u.test(body) && body.length > 400) break
          await ctx.settle(2_000)
        }
        await ctx.shot('11-workspace-session.png')
        product = {
          visible: body.includes(FIXTURE.question) && body.length > 400,
          source: 'conversation',
          excerpt: oneLine(body, 120),
        }
        ctx.step({
          action: '在切进的会话里确认 AI 产物',
          target: 'DSH 会话面板',
          outcome: product.visible ? '会话里有原始问题与 AI 回复' : '会话里没有读到 AI 回复（超时未完成）',
          shot: '11-workspace-session.png',
        })
      }

      // 判定用的完整观测（含一次性的 submit / workspace body）；报告只取下面 report 的子集。
      const observations = {
        panel,
        model: { ok: true, alreadyConfigured: model.alreadyConfigured, saved: model.saved },
        pu: { ok: true, created: pu.created, reused: pu.reused },
        selection: {
          ...selection,
          carried: selection.checked === true && (
            selection.summary.includes('1 个谱')
            || selection.selection.includes('已勾 1 个可选谱')
            || record.selectionPresent === true
            || String(workspace.bodyExcerpt ?? '').includes(FIXTURE.puName)
          ),
        },
        question: {
          filled,
          carried: submit.terminal.kind === 'error'
            ? (record.questionPresent === true || workspace.showsQuestion === true)
            : product.visible === true,
        },
        submit,
        product,
        workspace,
      }

      // 「输入被带入」的最终判据在历史回看 / 工作区里：原始问题必须真的进了会话记录。
      if (submit.terminal.kind === 'error') {
        ctx.step({
          action: '确认选择与输入被带进会话记录',
          target: `${CONSULT} 历史回看 → 阅读器`,
          outcome: record.answerPresent
            ? `原始问题在记录里=${record.questionPresent}；勾选谱仍在=${record.selectionPresent}`
            : `历史回看里读不到这条记录；改从工作区会话确认：原始问题在=${workspace.showsQuestion === true}；勾选谱出现在回复里=${String(workspace.bodyExcerpt ?? '').includes(FIXTURE.puName)}`,
          shot: '10-history-reader.png',
        })
      }

      // 给 runner 的观测只留**报告读者需要**的字段：完整的 submit / workspace body 是判定输入，
      // 不是报告正文（AI 长文与一次性 id 进 findings 只会把证据淹掉）。判定仍用上面的完整 observations。
      const report = {
        panel,
        model: { ok: true, alreadyConfigured: model.alreadyConfigured, saved: model.saved },
        pu: { ok: true, created: pu.created, reused: pu.reused },
        selection: { found: selection.found, checked: selection.checked, carried: observations.selection.carried },
        question: { filled, carried: observations.question.carried },
        submit: {
          clicked: submit.clicked,
          requestStarted: submit.requestStarted,
          firstFeedback: submit.feedback.kind,
          terminal: submit.terminal.kind,
          terminalInViewport: submit.terminal.inViewport ?? null,
        },
        product: { visible: product.visible, source: product.source },
        workspace: { reachable: workspace.reachable === true, showsQuestion: workspace.showsQuestion === true, showsAnswer: workspace.showsAnswer === true },
        headline: `模型=${model.alreadyConfigured ? '复用' : '已配'}；谱=${pu.created ? '新建' : '复用'}；`
          + `首个反馈=${submit.feedback.kind}；终态=${submit.terminal.kind}；`
          + `产物=${product.visible ? product.source : '未看到'}`,
      }
      return { status: decideNormalOutcome(observations), observations: report }
    },
  },

  'consult-history': {
    id: 'consult-history',
    caseId: 'E06',
    title: '离开 → 从真实历史入口找回同一条 → 追问入口与返回落点',
    shots: [
      '00-first-run.png', '09-history-list.png', '10-history-reader.png',
      '12-continue.png', '12b-continue-error.png', '13-return.png', '14-history-again.png',
    ],
    /**
     * 不重跑 E03：E06 的输入是同一个 home 里 E03 留下的真实记录（跨进程持久化）。
     * 没有记录就记 blocked——那是「E03 还没跑」，不是产品缺陷。
     */
    async run(ctx) {
      ctx.log('正在等：页面首屏（客户端插件异步挂载）')
      await ctx.page.goto(ctx.env.url, { waitUntil: 'domcontentloaded' })
      await ctx.settle(4_000)
      await ctx.shot('00-first-run.png')
      const firstRun = await dismissFirstRun(ctx)
      ctx.step({
        action: '完成必要首跑操作（关闭首跑模态）',
        target: 'first-run-modals',
        outcome: firstRun.labels.length === 0 ? '首屏没有出现首跑模态' : `关掉 ${firstRun.labels.length} 层：${firstRun.labels.join(' → ')}`,
        shot: '00-first-run.png',
      })

      const entry = await openConsult(ctx)
      const panel = { opened: entry.opened, attempts: entry.attempts }
      if (!entry.opened) {
        return {
          status: decideHistoryOutcome({ panel, history: { opened: false, rowCount: 0 } }),
          observations: { headline: '问事面板不可达' },
        }
      }
      ctx.step({
        action: '点侧栏「问事」打开问事面板',
        target: CONSULT,
        outcome: `面板出现（第 ${entry.attempts} 次点开）`,
      })

      // 第一次找回：从真实历史入口点开同一条记录（这一步同时证明跨进程持久化）。
      ctx.log('正在等：历史回看列表（E03 留下的记录）')
      const history = await openHistoryReader(ctx, { query: FIXTURE.question })
      if (!history.opened || history.rowCount === 0) {
        return {
          status: decideHistoryOutcome({ panel, history }),
          observations: { headline: history.reason ?? '历史回看为空' },
        }
      }
      ctx.step({
        action: '从历史回看找回 E03 留下的记录',
        target: `${CONSULT} 历史回看`,
        outcome: oneLine(`列表 ${history.rowCount} 条；搜索命中=${history.searchMatched}；点开短 id=${history.rowShortId}；`
          + `阅读器短 id=${history.readerShortId}；同一条=${history.sameShortId}；原始问题在=${history.questionPresent}；`
          + `AI 产物在=${history.answerPresent}；勾选谱仍在=${history.selectionPresent}`),
        shot: '10-history-reader.png',
      })

      // 追问入口：产品自己的「继续这次问事」。
      const continueButton = ctx.page.locator(`${CONSULT} ${CONTINUE_ACTION}`).first()
      let continueEntry = { clicked: false, sameSession: false, errorText: '' }
      if ((await continueButton.count()) > 0) {
        ctx.log('正在等：点「继续这次问事」之后产品给什么')
        await continueButton.click({ timeout: ACTION_TIMEOUT_MS })
        await ctx.settle(2_500)
        const state = await readConsultState(ctx.page)
        const openError = state.errorBlocks.find((block) => block.kind === 'open-session')
        const stillReader = (await readConsultView(ctx)).view === 'reader'
        if (openError !== undefined) {
          continueEntry = { clicked: true, sameSession: false, errorText: oneLine(openError.text) }
        } else if (!stillReader && !state.consultPresent) {
          // 切走了 = 进入了会话；再用会话里有没有原始问题确认是不是同一条。
          const body = await ctx.page.locator('body').innerText().catch(() => '')
          continueEntry = { clicked: true, sameSession: body.includes(FIXTURE.question), errorText: '' }
        } else {
          continueEntry = { clicked: true, sameSession: false, errorText: '点了之后仍停在阅读器，没有进入会话' }
        }
        await ctx.shot('12-continue.png')
        if (continueEntry.sameSession !== true) {
          // 错误条渲染在面板顶部；阅读器可能停在下面。滚过去再拍一张，证据里要看得见那句原因。
          try {
            await ctx.page.locator(`${CONSULT} [data-xuanshu-error="open-session"]`).first().scrollIntoViewIfNeeded({ timeout: 5_000 })
            await ctx.settle(400)
          } catch { /* 滚不动就保留当前画面 */ }
          await ctx.shot('12b-continue-error.png')
        }
      }
      ctx.step({
        action: '点「继续这次问事」（追问入口）',
        target: `${CONSULT} ${CONTINUE_ACTION}`,
        outcome: continueEntry.clicked
          ? continueEntry.sameSession
            ? '进入了同一会话（会话里有原始问题）'
            : `没有进入同一会话：${continueEntry.errorText}`
          : '阅读器里没有「继续这次问事」入口',
        shot: '12-continue.png',
      })

      // 返回落点：列表 → 门厅 → 切去总览 → 回问事。
      let landing = { afterReturn: 'unknown', reasonable: false, backToList: false, backToLobby: false }
      const backList = ctx.page.locator(`${CONSULT} [data-xuanshu-action="back-list"]`).first()
      if ((await backList.count()) > 0) {
        await backList.click({ timeout: ACTION_TIMEOUT_MS })
        await ctx.settle(800)
        landing.backToList = (await readConsultView(ctx)).view === 'history-list'
      }
      const backLobby = ctx.page.locator(`${CONSULT} [data-xuanshu-action="back-lobby"]`).first()
      if ((await backLobby.count()) > 0) {
        await backLobby.click({ timeout: ACTION_TIMEOUT_MS })
        await ctx.settle(800)
        landing.backToLobby = (await readConsultView(ctx)).view === 'lobby'
      }
      ctx.log('正在等：从总览再回问事（返回落点）')
      await openPanel(ctx, '总览')
      await openPanel(ctx, '问事')
      const afterReturn = await readConsultView(ctx)
      landing.afterReturn = afterReturn.present ? afterReturn.view : 'overview-or-absent'
      landing.reasonable = afterReturn.present && afterReturn.view === 'lobby'
      await ctx.shot('13-return.png')
      ctx.step({
        action: '离开问事再从侧栏回来，记录落点',
        target: 'sidebar 总览 → 问事',
        outcome: `阅读器 → 列表=${landing.backToList}；列表 → 门厅=${landing.backToLobby}；从总览回问事落在 ${landing.afterReturn}`
          + `${landing.reasonable ? '（回到问事，不是被丢回总览首页）' : '（没有回到问事的门厅）'}`,
        shot: '13-return.png',
      })

      // 离开之后再次找回：确认记录还在、还是同一条。
      ctx.log('正在等：再次打开历史回看，确认同一条记录还在')
      const again = await openHistoryReader(ctx, { query: FIXTURE.question, timeoutMs: ACTION_TIMEOUT_MS })
      const stillThere = again.opened === true && again.rowCount > 0 && again.rowShortId === history.rowShortId
      await ctx.shot('14-history-again.png')
      ctx.step({
        action: '离开后再打开历史回看，确认同一条记录还在',
        target: `${CONSULT} 历史回看`,
        outcome: oneLine(stillThere
          ? `仍是同一条（短 id=${again.rowShortId}）`
          : `没有找回同一条（列表 ${again.rowCount ?? 0} 条，短 id=${again.rowShortId ?? '无'}）`),
        shot: '14-history-again.png',
      })

      const observations = {
        panel,
        history: { opened: true, rowCount: history.rowCount, searchMatched: history.searchMatched },
        record: {
          rowShortId: history.rowShortId,
          readerShortId: history.readerShortId,
          sameShortId: history.sameShortId,
          questionPresent: history.questionPresent,
          answerPresent: history.answerPresent,
          selectionPresent: history.selectionPresent,
          answerExcerpt: history.answerExcerpt,
        },
        continueEntry,
        landing,
        stillThere,
      }
      // 报告只取摘要字段：一次性短 id 与 AI 长文留在截图里，不进 findings。
      const report = {
        panel,
        history: { opened: true, rowCount: history.rowCount, searchMatched: history.searchMatched },
        record: {
          sameShortId: history.sameShortId,
          questionPresent: history.questionPresent,
          answerPresent: history.answerPresent,
          selectionPresent: history.selectionPresent,
        },
        continueEntry: { clicked: continueEntry.clicked, sameSession: continueEntry.sameSession, errorText: continueEntry.errorText },
        landing,
        stillThere,
        headline: `同一条=${history.sameShortId}；原始输入在=${history.questionPresent}；产物在=${history.answerPresent}；`
          + `追问进入同一会话=${continueEntry.sameSession}；返回落点=${landing.afterReturn}；离开后仍在=${stillThere}`,
      }
      return { status: decideHistoryOutcome(observations), observations: report }
    },
  },
}
