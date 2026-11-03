#!/usr/bin/env node
/**
 * `scripts/experience/scenarios/consult.mjs` —— **问事场景**（Spec 04 · 票 #77 起）。
 *
 * 一条场景 = 一串人真的会做的动作 + 它结束时能说清的那件事。本文件只负责两半：
 *   1. **走真实入口**（`run`）：点侧栏、填输入框、点按钮、等终态，全部用真实控件；
 *   2. **把观测翻译成覆盖表的一行**（`decideConsultOutcome`，纯函数）。
 *
 * 为什么判定要单独提成纯函数：终点归类最容易变成「看心情」。未配模型时到底算通过还是缺陷，
 * 取决于「产品是不是禁止提交、禁止时说没说清、点了以后有没有可读提示、有没有一直转圈」——
 * 这四件事都能从 DOM 观测出来，也就都能在**零浏览器**的用例里被钉死（`tests/experience/run-cli.test.mjs`）。
 * 现场那半边只负责把观测记准，不做裁决。
 *
 * 三条禁止（ADR-0017 第 3 条，本文件的重写理由就在这里）：
 *   - 不用强制点击。既有的 `scripts/ux/collect/browser-scripts.mjs::openPanel/DismissBlockingModals`
 *     为了给静态巡检取证允许强制点击，那是另一种用途；**实操评估要证明的是「真实操作可达」**，
 *     绕开控件就绕开了真实用户会遇到的阻断。所以这里用真实点击 + 次数记录 + 可读失败重写一遍。
 *   - 不用内部 RPC 代替表单提交。宿主 RPC（`/api/…` 那一路）只可用于**只读观察**，
 *     本文件一次都不发请求：判「有没有发出去」靠界面上的 `data-xuanshu-error` 与等待态。
 *   - 不改业务数据。问事是否真的开出去由产品决定；这里只点人点得到的按钮。
 *
 * 仅使用 Node 内置模块（浏览器对象由 runner 注入）。ESM。
 */

/** 首跑模态的关闭按钮候选（按出现顺序试）。它们是「必要首跑操作」的一部分，不是绕过。 */
const FIRST_RUN_LABELS = ['继续', '稍后配置', '知道了', '关闭', '跳过', '好的']

/** 问事面板与它内部的锚点（`01-recon.md` §3 的既有锚，不另造选择器）。 */
const CONSULT = '[data-xuanshu-panel="consult"]'
const ASK_BLOCK = '[data-xuanshu-block="ask"]'
const QUESTION_FIELD = 'textarea[data-xuanshu-field="consult-question"]'
const START_ACTION = '[data-xuanshu-action="start-consult"]'
const SETTINGS_ACTION = '[data-xuanshu-action="open-ai-settings"]'

/** 这一轮问的问题（E01 不需要成功，只需要一个真实输入）。 */
const QUESTION = '这次想问：这周适合先把哪件小事收尾？'

/** 等终态的预算：AI 终态按计划 §9.3 给 120s；E01 走的是「发不出去」这一支，25s 足够看出有没有转圈。 */
const TERMINAL_BUDGET_MS = 25_000
/** 一般操作的等待上限（计划 §9.3：一般操作最多 15s）。 */
const ACTION_TIMEOUT_MS = 15_000

/**
 * 把页面上「现在是什么状态」读成一份纯数据快照。
 *
 * 只读 DOM，点不动任何东西 —— 这样「判定」与「操作」不会互相污染：
 * 读一次快照就能判「有没有错误条 / 有没有在转圈 / 面板还在不在」。
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<object>}
 */
export async function readConsultState(page) {
  return page.evaluate((selectors) => {
    const { consult, ask, field, start, settings } = selectors
    const panel = document.querySelector(consult)
    const askBlock = panel === null ? null : panel.querySelector(ask)
    const startButtons = [...(askBlock === null ? [] : askBlock.querySelectorAll(start))].map((button) => ({
      label: (button.textContent ?? '').replace(/\s+/gu, ' ').trim(),
      disabled: button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true',
      visible: button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0,
    }))
    /**
     * 错误块：问事侧只有两个（建会话失败 / 打开会话失败）。
     * 用 `data-xuanshu-error` 而不是文案匹配：文案里常嵌着宿主的原始错误，靠匹配会误判。
     *
     * `inViewport` 是**这一次**的现场事实（`getBoundingClientRect` 相对视口）：实测撞到过
     * 「提示渲染在面板顶部，而页面停在底部的说事区」——DOM 里有提示，人却看不见。
     * 这既是证据（EXP 待裁定），也是 `pass` 与「假成功」的分界：得记下来才能分清。
     */
    const errorBlocks = [...(panel === null ? [] : panel.querySelectorAll('[data-xuanshu-error]'))].map((node) => {
      const rect = node.getBoundingClientRect()
      return {
        kind: node.getAttribute('data-xuanshu-error') ?? '',
        text: (node.innerText ?? '').replace(/\s+/gu, ' ').trim().slice(0, 300),
        inViewport: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight,
      }
    })
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((node) => (node.innerText ?? '').replace(/\s+/gu, ' ').trim().slice(0, 300)).filter((text) => text !== '')
    const notes = [...(panel === null ? [] : panel.querySelectorAll('[data-xuanshu-note]'))]
      .map((node) => (node.innerText ?? '').replace(/\s+/gu, ' ').trim())
      .filter((text) => text !== '')
    const settingsButtons = [...document.querySelectorAll(settings)].map((button) => ({
      label: (button.textContent ?? '').replace(/\s+/gu, ' ').trim(),
      disabled: button.hasAttribute('disabled'),
      visible: button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0,
    }))
    const aiPath = document.querySelector('[data-xuanshu-ai-path]')
    const textarea = panel === null ? null : panel.querySelector(field)
    const loading = document.querySelector('[data-xuanshu-state="loading"]')
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      .filter((node) => node.getBoundingClientRect().width > 0)
      .map((node) => (node.innerText ?? '').replace(/\s+/gu, ' ').trim().slice(0, 200))
    return {
      consultPresent: panel !== null,
      startButtons,
      textarea: textarea === null ? null : { disabled: textarea.hasAttribute('disabled'), value: textarea.value ?? '' },
      errorBlocks,
      alerts,
      notes,
      aiPathText: aiPath === null ? '' : (aiPath.innerText ?? '').replace(/\s+/gu, ' ').trim(),
      settingsButtons,
      loadingVisible: loading !== null,
      dialogs,
      bodyExcerpt: (document.body.innerText ?? '').replace(/\s+/gu, ' ').trim().slice(0, 600),
    }
  }, { consult: CONSULT, ask: ASK_BLOCK, field: QUESTION_FIELD, start: START_ACTION, settings: SETTINGS_ACTION })
}

/** 屏上有没有可见遮罩（首跑模态那一层）。判定口径与既有采集器一致：要面积、不要被样式藏起来。 */
function hasVisibleMask(page) {
  return page.evaluate(() => {
    for (const element of document.querySelectorAll('[class*="mask"], [aria-hidden="true"][class*="_mask"]')) {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
      return true
    }
    return false
  })
}

/**
 * 关掉首跑模态（**真实点击**，不强制）。
 *
 * 为什么不强制：模态挡住侧栏时，「点不动」本身就是一条要记的事实；
 * 强制点击会把「被挡住」变成「点成功了」，从而把真实阻断藏起来。
 *
 * @returns {Promise<{labels: string[], blocked: boolean}>} `blocked` = 遮罩还在但认不出关闭按钮
 */
export async function dismissFirstRun(ctx) {
  const labels = []
  let blocked = false
  for (let round = 0; round < 6; round += 1) {
    if (!(await hasVisibleMask(ctx.page))) break
    let clicked = null
    for (const label of FIRST_RUN_LABELS) {
      const button = ctx.page.getByRole('button', { name: label, exact: true }).first()
      if ((await button.count()) === 0) continue
      if (!(await button.isVisible().catch(() => false))) continue
      if (!(await button.isEnabled().catch(() => false))) continue
      clicked = label
      break
    }
    if (clicked === null) {
      blocked = true
      break
    }
    ctx.log(`关首跑模态：点「${clicked}」`)
    await ctx.page.getByRole('button', { name: clicked, exact: true }).first().click({ timeout: 8_000 })
    labels.push(clicked)
    await ctx.settle(1_200)
  }
  return { labels, blocked }
}

/** 侧栏的某一行（真实入口：玄枢主面板靠侧栏行切换）。 */
export function sidebarRow(page, name) {
  return page.getByRole('button', { name, exact: true }).first()
}

/**
 * 打开问事面板。失败就再来一次（首跑模态偶发只关掉一层），**每次都记尝试次数**——
 * 一次点不动和三次点不动是两件事：前者是「这次环境不顺」，后者是「入口真的打不开」。
 */
export async function openConsult(ctx) {
  let attempts = 0
  for (attempts = 1; attempts <= 3; attempts += 1) {
    const row = sidebarRow(ctx.page, '问事')
    if ((await row.count()) === 0) {
      ctx.log('正在等：侧栏出现「问事」行（客户端插件异步挂载）')
      await ctx.settle(1_500)
      continue
    }
    ctx.log(`正在等：点侧栏「问事」（第 ${attempts} 次）`)
    try {
      await row.click({ timeout: ACTION_TIMEOUT_MS })
    } catch (error) {
      // 点不动就是「被挡住了」，照实记；下一次先关模态再试。
      ctx.note(`第 ${attempts} 次点「问事」没点成：${oneLine(error?.message ?? error)}`)
      await dismissFirstRun(ctx)
      await ctx.settle(800)
      continue
    }
    const visible = await ctx.page.locator(CONSULT).first().isVisible().catch(() => false)
    if (visible) return { opened: true, attempts }
    ctx.log('正在等：问事面板出现')
    await ctx.settle(1_200)
    const late = await ctx.page.locator(CONSULT).first().isVisible().catch(() => false)
    if (late) return { opened: true, attempts }
    await dismissFirstRun(ctx)
  }
  return { opened: false, attempts: 3 }
}

/**
 * 等问事这一支的终态：可读错误条 / 切进了会话 / 一直转圈到超时。
 *
 * 每一次状态变化都往 `log` 里说一句「正在等什么」（票面标准 7）：长任务看起来像卡死，
 * 十有八九是脚本在闷头等。超时**不是失败之外的别的东西**，它就是「超时未完成」这一种终态。
 *
 * @returns {Promise<{kind: 'error'|'session'|'timeout'|'nothing', text: string, stillBusy: boolean, busyAt: string}>}
 */
async function waitConsultTerminal(ctx) {
  const deadline = Date.now() + TERMINAL_BUDGET_MS
  let lastState = 'starting'
  let sawBusy = false
  let busyAt = 'none'
  let lastBeat = Date.now()
  while (Date.now() < deadline) {
    const state = await readConsultState(ctx.page)
    const busy = state.loadingVisible || state.startButtons.some((button) => button.disabled && /中/u.test(button.label))
    if (busy && !sawBusy) {
      sawBusy = true
      busyAt = state.loadingVisible ? 'status' : 'button'
      ctx.log('正在等：产品的运行态（已出现等待反馈）')
    }
    if (state.errorBlocks.length > 0) {
      return {
        kind: 'error',
        text: state.errorBlocks.map((block) => block.text).join(' / '),
        stillBusy: busy,
        busyAt,
        // 「提示在人眼前吗」要**在滚动之前**读出：滚过去之后再说「看得见」就是自己造的事实。
        inViewport: state.errorBlocks.some((block) => block.inViewport),
      }
    }
    if (!state.consultPresent) {
      // 面板没了 = 产品把我们切进了会话。屏上有没有提示，是判定「假成功」的关键。
      await ctx.settle(600)
      const after = await ctx.page.evaluate(() => ({
        alerts: [...document.querySelectorAll('[role="alert"]')]
          .map((node) => (node.innerText ?? '').replace(/\s+/gu, ' ').trim())
          .filter((text) => text !== ''),
        body: (document.body.innerText ?? '').replace(/\s+/gu, ' ').trim().slice(0, 400),
      }))
      const text = [...state.alerts, ...after.alerts].filter((line) => line !== '').join(' / ')
      return { kind: 'session', text: text === '' ? '' : text, stillBusy: false, busyAt }
    }
    if (state.startButtons.length === 0) {
      // 主按钮消失但面板还在：没有可等的终态，别再空转。
      return { kind: 'nothing', text: state.bodyExcerpt.slice(0, 120), stillBusy: busy, busyAt }
    }
    const now = Date.now()
    if (now - lastBeat > 5_000) {
      lastBeat = now
      const left = Math.max(0, Math.round((deadline - now) / 1000))
      ctx.log(`正在等：错误提示条或会话切换（还剩 ${left}s）`)
      lastState = busy ? 'busy' : 'idle'
    }
    await ctx.settle(500)
  }
  ctx.log(`超时未完成：${TERMINAL_BUDGET_MS / 1000}s 内没等到终态（最后一次状态：${lastState}）`)
  return { kind: 'timeout', text: '', stillBusy: sawBusy, busyAt }
}

/**
 * 核查「配置入口是否可达」——E01 观测里的第二问。
 *
 * 两条真实入口都试：门禁行里那句「去『设置 → 模型』」（有 handler 才是按钮）与侧栏「设置」。
 * 不点强制、不猜 URL：找得到就点，点完把**实际到达了什么**记下来（面板 / 弹层 / 文字）。
 */
async function probeConfigEntry(ctx) {
  const before = await readConsultState(ctx.page)
  const gateButton = before.settingsButtons.find((button) => button.visible && !button.disabled)
  const via = gateButton === undefined ? 'sidebar-settings' : 'open-ai-settings'
  ctx.log(`正在等：配置入口（${via === 'open-ai-settings' ? '门禁行里的「去设置」' : '侧栏「设置」'}）`)

  let clicked = false
  if (via === 'open-ai-settings') {
    try {
      await ctx.page.locator(SETTINGS_ACTION).first().click({ timeout: ACTION_TIMEOUT_MS })
      clicked = true
    } catch (error) {
      ctx.note(`门禁里的「去设置」点不动：${oneLine(error?.message ?? error)}`)
    }
  }
  if (!clicked) {
    const row = sidebarRow(ctx.page, '设置')
    if ((await row.count()) > 0 && (await row.isEnabled().catch(() => false))) {
      try {
        await row.click({ timeout: ACTION_TIMEOUT_MS })
        clicked = true
      } catch (error) {
        ctx.note(`侧栏「设置」点不动：${oneLine(error?.message ?? error)}`)
      }
    }
  }
  await ctx.settle(1_200)
  // 这一张拍的是「点开配置入口之后立刻看到的界面」——必须**在进「模型」页之前**拍，
  // 否则它和 05 是同一屏，读者就看不出「设置」与「模型」是两级。
  await ctx.shot('04-config-entry.png')
  const after = await ctx.page.evaluate(() => {
    const settingsPanel = document.querySelector('[data-xuanshu-panel="settings"]')
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      .filter((node) => node.getBoundingClientRect().width > 0)
      .map((node) => (node.innerText ?? '').replace(/\s+/gu, ' ').trim().slice(0, 160))
    return {
      settingsPanel: settingsPanel !== null,
      dialogs,
      mentionsModel: /模型/u.test((document.body.innerText ?? '').slice(0, 4_000)),
      excerpt: (document.body.innerText ?? '').replace(/\s+/gu, ' ').trim().slice(0, 300),
    }
  })
  const reached = after.settingsPanel || after.dialogs.length > 0
  return {
    via,
    clicked,
    reached,
    mentionsModel: after.mentionsModel,
    pathText: before.aiPathText,
    dialogs: after.dialogs,
    excerpt: after.excerpt,
    modelPage: await openModelPage(ctx, reached),
  }
}

/**
 * 进设置里的「模型」页 —— 这就是产品让人去配 provider / 默认模型的那一扇门。
 *
 * 只做**只读观察**：点进去、看一眼有没有 provider / 密钥 / 默认模型的字样，然后停手。
 * 为什么不填任何东西：E01 是「未配置模型」的状态用例，配上去就变成另一条用例了（E02/E03 才需要）。
 *
 * @returns {Promise<{reached: boolean, excerpt: string, hasProviderText: boolean}>}
 */
async function openModelPage(ctx, settingsReached) {
  if (!settingsReached) return { reached: false, excerpt: '', hasProviderText: false }
  const dialog = ctx.page.locator('[role="dialog"]').last()
  const entry = dialog.getByText('模型', { exact: true }).first()
  if ((await entry.count()) === 0 || !(await entry.isVisible().catch(() => false))) {
    return { reached: false, excerpt: '', hasProviderText: false }
  }
  ctx.log('正在等：设置里的「模型」页')
  try {
    await entry.click({ timeout: ACTION_TIMEOUT_MS })
  } catch (error) {
    ctx.note(`设置里的「模型」页点不动：${oneLine(error?.message ?? error)}`)
    return { reached: false, excerpt: '', hasProviderText: false }
  }
  await ctx.settle(1_200)
  await ctx.shot('05-model-settings.png')
  const view = await ctx.page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((node) => node.getBoundingClientRect().width > 0)
    const text = dialogs.map((node) => node.innerText ?? '').join(' ').replace(/\s+/gu, ' ').trim()
    return {
      excerpt: text.slice(0, 240),
      hasProviderText: /provider|providerId|API|密钥|默认模型/u.test(text),
    }
  })
  return { reached: true, excerpt: view.excerpt, hasProviderText: view.hasProviderText }
}

/** 把终态（错误块 / 禁用说明）滚进视野：证据要能看见它，而不是落在折线以上/以下。 */
async function scrollTerminalIntoView(ctx) {
  const candidates = [`${CONSULT} [data-xuanshu-error]`, `${CONSULT} [data-xuanshu-note]`]
  for (const selector of candidates) {
    const target = ctx.page.locator(selector).first()
    if ((await target.count()) === 0) continue
    try {
      await target.scrollIntoViewIfNeeded({ timeout: 5_000 })
      await ctx.settle(400)
      return true
    } catch {
      /* 滚不动就不滚：截图仍然记录当前画面，别让它变成场景失败 */
    }
  }
  return false
}

/** 把一段文案压成一行（步骤行只给一行，细节留给截图）。 */
function oneLine(text, limit = 200) {
  return stableText(text, limit)
}

/**
 * 去掉**易变**的值，只留可读骨架。
 *
 * 为什么需要它：产品在提示里带了一次性 id（「会话已建好（#consult-fac3a6de）」），
 * 每次执行都不同。证据要能「改前 / 改后逐项比」——id 一进报告，两份 steps.jsonl 就永远对不上，
 * 而它对读者没有信息量。同一条理由已经用在 `sanitizeUrl`（把凭据换成占位符）上：
 * 保留形状、去掉不该进报告的那部分。
 *
 * @param {string} text
 * @param {number} [limit]
 * @returns {string}
 */
export function stableText(text, limit = 500) {
  return String(text ?? '')
    .replace(/consult-[0-9a-z]{4,}/giu, 'consult-<id>')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, limit)
}

/**
 * **E01 的终点归类**（纯函数，零浏览器）。
 *
 * 口径来自计划 §9.4 与票 #77：
 *   - 走通 / 产品禁止提交但解释清楚 → `pass`（这就是把 E01 验完了）；
 *   - 界面自己给出了可读提示、没有继续转圈 → `pass`（无假成功、无永久转圈）；
 *   - 永久转圈 / 超时未完成 / 点了没反应 / 未配模型还能开 → `fail`（都是实测缺陷，带证据）；
 *   - 连问事面板都进不去 → `blocked`（环境缺前置，不记成产品缺陷）。
 *
 * 断言面是**返回值**：`status` 一定在覆盖词表里，且 `pass`/`fail` 带 `evidence`、`blocked` 带 `reason`。
 *
 * @param {object} observations `run()` 记下的观测
 * @returns {{status: 'pass'|'fail'|'blocked', evidence?: string, reason?: string, summary: string, observed: object}}
 */
export function decideConsultOutcome(observations = {}) {
  const panel = observations.panel ?? { opened: false, attempts: 0 }
  const submit = observations.submit ?? { found: false, disabled: false, label: '', explanation: '' }
  const attempt = observations.attempt ?? { clicked: false, clickedAt: 'none' }
  const terminal = observations.terminal ?? { kind: 'nothing', text: '' }
  const spinner = observations.spinner ?? { stillBusy: false, at: 'none' }
  const configEntry = observations.configEntry ?? { visible: false, enabled: false, label: '', pathText: '' }

  /** 证据串只写**文件名与步骤**：换台机器也能照着找回同一张图。 */
  const evidenceOf = (extra) => `01-entry.png / 02-attempt.png / 03-terminal.png / 04-config-entry.png${extra === undefined ? '' : `；${extra}`}`
  const observed = {
    clicked: attempt.clicked === true,
    clickedAt: attempt.clickedAt ?? 'none',
    terminal: terminal.kind,
    stillBusy: spinner.stillBusy === true,
    configEntryReachable: configEntry.visible === true || configEntry.reached === true,
    configEntryPath: configEntry.pathText ?? '',
  }

  if (panel.opened !== true) {
    return {
      status: 'blocked',
      reason: `问事面板没打开（试了 ${panel.attempts ?? 0} 次：首跑模态或侧栏不可点）——环境缺前置，不记成产品缺陷`,
      summary: '面板不可达',
      observed,
    }
  }

  if (submit.found !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf('开问事入口不在屏上'),
      summary: '问事面板里找不到「开一次问事」按钮',
      observed,
    }
  }

  // ① 产品本就不允许提交：不点，只验「禁用 + 解释是否清楚」（票面标准 4）。
  if (submit.disabled === true) {
    const explanation = String(submit.explanation ?? '').trim()
    if (explanation === '') {
      return {
        status: 'fail',
        evidence: evidenceOf('按钮禁用但屏上没有任何解释'),
        summary: '提交按钮禁用，但界面没有说明缺什么、下一步去哪',
        observed,
      }
    }
    return {
      status: 'pass',
      evidence: evidenceOf(`禁用并解释：「${oneLine(explanation, 80)}」`),
      summary: `产品禁止提交且解释清楚（未强行点击）：${oneLine(explanation, 60)}；配置入口${observed.configEntryReachable ? '可达' : '不可达'}`,
      observed,
    }
  }

  // ② 能点：点一次，看产品给的是可读提示、还是假成功 / 永久转圈。
  if (attempt.clicked !== true) {
    return {
      status: 'blocked',
      reason: '按钮可见且未禁用，但这一轮点不动它（被遮挡或超时）——先记环境，不记成产品缺陷',
      summary: '按钮点不动',
      observed,
    }
  }

  if (terminal.kind === 'timeout') {
    return {
      status: 'fail',
      evidence: evidenceOf(`${TERMINAL_BUDGET_MS / 1000}s 内没有终态；仍停在等待态=${spinner.stillBusy === true}`),
      summary: '超时未完成：点了之后一直没有可读提示或终态，留下了当时画面',
      observed,
    }
  }
  if (spinner.stillBusy === true) {
    return {
      status: 'fail',
      evidence: evidenceOf(`等待态还在（${spinner.at ?? 'button'}）`),
      summary: '界面还在转圈（永久等待态），没有可用的终态',
      observed,
    }
  }
  if (terminal.kind === 'error') {
    // E01 的第一问问的是「提示是否说明缺什么」——这句提示有没有点到配置原因、有没有落在人眼前，
    // 都是**记录事实**，不改变「产品给了可读终态」这个结论。所以它们进摘要与证据，不进状态。
    const namedCause = observations.prompt?.mentionsConfigCause === true
    const inViewport = observations.prompt?.inViewport
    const visibility = inViewport === false ? '（提示渲染在可视区之外，人得先往上滚才看得到）' : ''
    return {
      status: 'pass',
      evidence: evidenceOf(`可读提示：「${oneLine(terminal.text, 80)}」${visibility}`),
      summary: `产品给出了可读提示、没有假成功也没有永久转圈：${oneLine(terminal.text, 80)}${visibility}`
        + `；提示${namedCause ? '点到了' : '**没有**点到'}「缺模型 / 配置」这一类原因`,
      observed: { ...observed, promptMentionsConfigCause: namedCause, promptInViewport: inViewport ?? null },
    }
  }
  if (terminal.kind === 'session') {
    const hint = String(terminal.text ?? '').trim()
    if (hint !== '') {
      return {
        status: 'pass',
        evidence: evidenceOf(`切进会话并给出提示：「${oneLine(hint, 80)}」`),
        summary: `未配模型时切进会话，但屏上有提示：${oneLine(hint, 80)}`,
        observed,
      }
    }
    return {
      status: 'fail',
      evidence: evidenceOf('切进会话后屏上没有任何提示'),
      summary: '未配模型时仍切进了会话，且屏上没有任何提示（疑似假成功）',
      observed,
    }
  }
  return {
    status: 'fail',
    evidence: evidenceOf('点完界面没有反应'),
    summary: '点了「开一次问事」之后没有反应（没有提示、没有等待态、没有切换）',
    observed,
  }
}

// ── 场景定义 ────────────────────────────────────────────────────────────────

/**
 * 问事场景表。后续票在同一目录**追加**场景，不动 `run.mjs` 的 CLI 形状。
 *
 * 场景契约（`run.mjs` 只认这三样）：
 *   - `id` / `caseId` / `title`：覆盖表那一行的身份；
 *   - `shots`：本场景会落的截图文件名（只写文件名，不带目录）；
 *   - `run(ctx)`：走真实入口，返回 `{status, observations}`，其中 `status` 由本文件提到。
 */
export const CONSULT_SCENARIOS = {
  'consult-no-model': {
    id: 'consult-no-model',
    caseId: 'E01',
    title: '未配模型时的首次问事',
    shots: ['00-first-run.png', '01-entry.png', '02-attempt.png', '03-terminal.png', '03-terminal-scrolled.png', '03-terminal-full.png', '04-config-entry.png', '05-model-settings.png'],
    /**
     * 空 home（未配模型）→ 完成必要首跑操作 → 打开问事 → 尝试开始一次问事。
     *
     * 这里的每一处**都不强制点击**：点不动就记「点不动」，那是发现，不是要绕过的障碍。
     */
    async run(ctx) {
      // ① 进页面：DSH 的客户端插件是异步挂载的，等 DOM 稳定比等某个具体选择器稳。
      ctx.log('正在等：页面首屏（客户端插件异步挂载）')
      await ctx.page.goto(ctx.env.url, { waitUntil: 'domcontentloaded' })
      await ctx.settle(3_500)

      // ② 必要首跑操作：先把「第一次打开长什么样」留证（模态是体验的一部分，不是障碍），再关掉它。
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

      // ③ 打开问事（真实侧栏入口）。
      const entry = await openConsult(ctx)
      const opened = entry.opened
      ctx.step({
        action: '点侧栏「问事」打开问事面板',
        target: CONSULT,
        outcome: opened ? `面板出现（第 ${entry.attempts} 次点开）` : `面板没打开（试了 ${entry.attempts} 次）`,
      })
      await ctx.settle(1_200)

      const state = await readConsultState(ctx.page)
      await ctx.shot('01-entry.png')
      ctx.step({
        action: '记录问事面板此刻给出的东西',
        target: 'panel:consult',
        outcome: state.consultPresent
          ? `主按钮 ${state.startButtons.length} 个（${state.startButtons.map((button) => (button.disabled ? '禁用' : '可用')).join('/') || '无'}）；`
            + `页内说明 ${state.notes.length} 条；门禁路径文本「${state.aiPathText === '' ? '无' : oneLine(state.aiPathText, 40)}」`
          : '面板不在屏上',
        shot: '01-entry.png',
      })

      // ④ 填入一个真实问题（用真实输入框，不调接口）。
      let typed = false
      const questionBox = ctx.page.locator(`${CONSULT} ${QUESTION_FIELD}`).first()
      if ((await questionBox.count()) > 0 && (await questionBox.isVisible().catch(() => false)) && (await questionBox.isEditable().catch(() => false))) {
        try {
          await questionBox.fill(QUESTION, { timeout: ACTION_TIMEOUT_MS })
          typed = true
        } catch (error) {
          ctx.note(`问题输入框填不进去：${oneLine(error?.message ?? error)}`)
        }
      }
      ctx.step({
        action: '在问事输入框里填入问题',
        target: QUESTION_FIELD,
        outcome: typed ? `已填入「${QUESTION}」（尚未提交）` : '输入框不可用（找不到 / 不可编辑）',
        shot: '02-attempt.png',
      })
      await ctx.shot('02-attempt.png')

      // ⑤ 尝试开始：先读按钮状态。**禁用就不点**（票面标准 4）。
      const before = await readConsultState(ctx.page)
      const startButton = before.startButtons[0]
      const explanationSource = [
        ...before.notes,
        ...before.errorBlocks.map((block) => block.text),
        ...before.alerts,
        before.aiPathText,
      ].filter((text) => text !== '').join(' ')

      let clicked = false
      let clickedAt = 'none'
      if (startButton === undefined) {
        clickedAt = 'missing'
      } else if (startButton.disabled) {
        clickedAt = 'disabled'
        ctx.log('产品禁止提交（按钮禁用）：按票面口径不强行点击，只验禁用与解释')
      } else {
        clickedAt = 'enabled'
        ctx.log('正在等：点「开一次问事」之后产品的反馈')
        try {
          await ctx.page.locator(`${CONSULT} ${START_ACTION}`).first().click({ timeout: ACTION_TIMEOUT_MS })
          clicked = true
        } catch (error) {
          ctx.note(`「开一次问事」点不动：${oneLine(error?.message ?? error)}`)
        }
      }

      // ⑥ 终态：错误条 / 切进会话 / 一直转圈到超时。
      let terminal = { kind: 'nothing', text: '', stillBusy: false, busyAt: 'none' }
      if (clicked) terminal = await waitConsultTerminal(ctx)
      else if (clickedAt === 'disabled') {
        // 禁用态本身就是终态：没有「再等等」这回事。
        const after = await readConsultState(ctx.page)
        const explanation = [
          ...after.notes,
          ...after.errorBlocks.map((block) => block.text),
          ...after.alerts,
          after.aiPathText,
        ].filter((text) => text !== '').join(' ')
        terminal = { kind: 'disabled', text: explanation, stillBusy: after.loadingVisible, busyAt: after.loadingVisible ? 'status' : 'none' }
      }
      const terminalText = stableText(terminal.text)
      // 先截**人当时看到的那一屏**（不滚动），再把提示滚进视野另截一张——
      // 「提示在不在人眼前」是这次实测里真实存在的一个问题，只有两张图放一起才说得清。
      await ctx.shot('03-terminal.png')
      const afterAttempt = await readConsultState(ctx.page)
      ctx.step({
        action: '记录尝试开始问事之后的终态',
        target: `${CONSULT} ${START_ACTION}`,
        outcome: clickedAt === 'disabled'
          ? `按钮禁用，未点击；界面说明：${oneLine(terminalText, 120) || '（没有任何说明）'}`
          : clickedAt === 'missing'
            ? '面板里没有「开一次问事」按钮'
            : `已点击一次；终态=${terminal.kind}${terminalText === '' ? '' : `；提示：${oneLine(terminalText, 120)}`}`
              + `${terminal.inViewport === false ? '；提示渲染在可视区之外（要先滚上去才看得到）' : ''}`,
        shot: '03-terminal.png',
        ...(terminal.kind === 'timeout' ? { note: '超时未完成：已保留当时画面（03-terminal.png 与全页图）' } : {}),
      })
      // 「点完之后输入还在不在」是第一次用的人最实际的损失点：会话没开成，问题也没了。
      const questionAfter = afterAttempt.textarea === null ? null : afterAttempt.textarea.value
      if (clicked && typed && questionAfter === '') {
        ctx.note('点了「开一次问事」之后输入框被清空，而会话并没有打开（这一次问事的问题需要重打一遍）')
      }
      ctx.step({
        action: '记录点击之后输入框里还剩什么',
        target: QUESTION_FIELD,
        outcome: questionAfter === null
          ? '输入框不在屏上'
          : questionAfter === ''
            ? '输入框已被清空'
            : `输入框里仍是「${oneLine(questionAfter, 60)}」`,
      })
      const scrolled = await scrollTerminalIntoView(ctx)
      await ctx.shot('03-terminal-scrolled.png')
      ctx.step({
        action: '把终态提示滚进视野另存一张',
        target: `${CONSULT} [data-xuanshu-error]`,
        outcome: scrolled
          ? `已滚动，提示此刻在可视区（滚动前在可视区=${terminal.inViewport ?? '未知'}）`
          : '没有可滚的提示块（终态不是错误块）',
        shot: '03-terminal-scrolled.png',
      })
      await ctx.shot('03-terminal-full.png', { fullPage: true })
      ctx.step({
        action: '另存一张全页图作为上下文',
        target: 'page',
        outcome: '全页图已落盘（面板是整页滚动的，全页图与视口图可能同形，如实保留）',
        shot: '03-terminal-full.png',
      })

      // ⑦ 配置入口可达性（E01 的第二问）：能点到「设置 → 模型」才算可达。
      const configEntry = await probeConfigEntry(ctx)
      ctx.step({
        action: '核查配置入口是否可达',
        target: configEntry.via === 'open-ai-settings' ? SETTINGS_ACTION : 'sidebar:设置',
        outcome: configEntry.clicked
          ? `${configEntry.via === 'open-ai-settings' ? '门禁行里的「去设置」' : '侧栏「设置」'}点得动；`
            + `${configEntry.reached ? '到达设置界面' : '没有看出到达设置界面'}；`
            + `${configEntry.modelPage.reached ? '进了「模型」页' : '没进到「模型」页'}；`
            + `${configEntry.modelPage.hasProviderText ? '页上有 provider / 密钥 / 默认模型字样' : '页上没读到 provider 相关字样'}`
          : `${configEntry.via === 'open-ai-settings' ? '门禁里的「去设置」' : '侧栏「设置」'}不可点`,
        shot: '04-config-entry.png',
      })

      if (configEntry.modelPage.reached) {
        ctx.step({
          action: '进设置里的「模型」页（只读观察，不填任何值）',
          target: 'settings 导航「模型」',
          outcome: `页上有 provider / 密钥 / 默认模型字样=${configEntry.modelPage.hasProviderText}；摘录：${oneLine(configEntry.modelPage.excerpt, 80)}`,
          shot: '05-model-settings.png',
        })
      }

      const explanation = stableText(explanationSource, 300)
      const submitDisabled = startButton?.disabled === true
      const observations = {
        panel: { opened, attempts: entry.attempts },
        submit: {
          found: startButton !== undefined,
          disabled: submitDisabled,
          label: startButton?.label ?? '',
          // 只有**禁用**时那句解释才是判定依据；能点时把整屏说明搬进报告只会把证据淹掉。
          explanation: submitDisabled ? explanation : '',
          notesCount: before.notes.length,
        },
        configEntry: {
          visible: before.settingsButtons.some((button) => button.visible) || configEntry.reached,
          enabled: before.settingsButtons.some((button) => button.visible && !button.disabled),
          label: before.settingsButtons.map((button) => button.label).join(' / '),
          pathText: before.aiPathText,
          reached: configEntry.reached,
          via: configEntry.via,
          clicked: configEntry.clicked,
          modelPageReached: configEntry.modelPage.reached,
          modelPageHasProviderText: configEntry.modelPage.hasProviderText,
        },
        attempt: { clicked, clickedAt },
        terminal: { kind: terminal.kind, text: terminalText, inViewport: terminal.inViewport ?? null },
        spinner: { stillBusy: terminal.stillBusy === true, at: terminal.busyAt ?? 'none' },
        // 「提示有没有说清缺什么」是 E01 的第一问：这里把它变成一个可复核的字段，
        // 而不是让读者自己对着一句提示猜。
        prompt: {
          mentionsConfigCause: /模型|provider|API|密钥|设置/u.test(terminalText),
          inViewport: terminal.inViewport ?? null,
          length: terminalText.length,
        },
        question: { asked: QUESTION, leftAfterAttempt: questionAfter ?? '' },
      }

      return { status: decideConsultOutcome(observations), observations }
    },
  },
}
