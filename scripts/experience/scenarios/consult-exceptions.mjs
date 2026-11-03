#!/usr/bin/env node
/**
 * `scripts/experience/scenarios/consult-exceptions.mjs` —— **异常与中断**四条场景（Spec 04 · 票 #79）。
 *
 * 正常路径走通之后，人会真的遇到的四种状态：
 *   - `consult-empty`（E02）：问题留空尝试提交 → 按产品真实规则被拦住、提示位置明确、不创建无意义会话；
 *   - `consult-repeat`（E04）：对可用提交按钮快速连点两次 → 不出现非预期的重复会话 / 重复提交，运行状态明确；
 *   - `consult-return`（E05）：输入未提交内容 → 切到总览 → 回问事；对照已提交会话重复往返；
 *   - `consult-stop`（E08）：响应进行中使用当前界面的停止入口 → 终止反馈明确、之后仍可操作。
 *
 * 三条硬边界（ADR-0017 第 3 条，本文件一次都不许破）：
 *   1. **不用强制点击**：点不动就记「点不动」，那是发现；`force` 会把真实阻断藏起来；
 *   2. **不用内部 RPC 代替表单**：提交、切面板、停止全部走真实控件；本文件只读 DOM 与**只读**数据面
 *      （`<home>/xuanshu/consult/sessions/*.json` 的文件数 / 回合数，用来核对「有没有真的多建一条」）；
 *   3. **不模拟 AI 成功、不伪造停止成功**：停止入口不存在或没抓到生成窗口，照实记，
 *      落 `fail` / `not-collected` / `blocked` 而不是替产品补一个「已停止」。
 *
 * 「切走再回来」的判定依据是设计权威 `docs/design/ui-v1/README.md` **§13.1**（ADR-0017 第 9 条）：
 *   - 同面板内切走再回来：**保留**草稿正文、已勾选的谱、挂载选择、当前会话的阅读位置；
 *   - 跨会话切换：**不保留**上一会话的草稿与谱选择（防串味）；
 *   - 重启 / 换实例：只保证已落盘的会话（未提交草稿不保证，那是 E07 的边界，不是本票的缺陷）。
 * 判定里逐条引用条款号；「草稿丢了」因此是**已确认的违反 §13.1**，不是「待人工判断」。
 *
 * 仅使用 Node 内置模块（浏览器对象由 runner 注入）。ESM。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  dismissFirstRun,
  openConsult,
  readConsultState,
  sidebarRow,
  stableText,
} from './consult.mjs'
import { FIXTURE } from './consult-sample.mjs'

/** 问事面板与内部的既有锚点（`01-recon.md` §3；不另造选择器）。 */
const CONSULT = '[data-xuanshu-panel="consult"]'
const ASK_BLOCK = '[data-xuanshu-block="ask"]'
const QUESTION_FIELD = 'textarea[data-xuanshu-field="consult-question"]'
const START_ACTION = '[data-xuanshu-action="start-consult"]'
const HISTORY_TOGGLE = '[data-xuanshu-action="toggle-history"]'
const BACK_LOBBY = '[data-xuanshu-action="back-lobby"]'
const BACK_LIST = '[data-xuanshu-action="back-list"]'
const ROW = '[data-xuanshu-row]'

/** 一般操作上限（计划 §9.3：15s）。 */
const ACTION_TIMEOUT_MS = 15_000

/** 本场景组的虚构材料（与 E03 的谱一致；不涉及真实个人数据）。 */
export const EXCEPTION_FIXTURE = Object.freeze({
  /** 未提交草稿：带一个只属于它的标记，判定时只认这一串。 */
  draft: '未提交草稿·先理一理榫卯的顺序（这一段不该被提交）',
  /** E04 的提交问题：与 E03 的问题不同，便于在历史里辨认这一轮。 */
  repeatQuestion: '快速连点测试：这周木工练习先练哪一个动作？',
  /** E08 的问题：要求一段较长回答，给「停止入口」一个真实存在的生成窗口（不是伪造长响应）。 */
  stopQuestion: '请分五条说明这周如何安排木工练习，每条两句话，尽量写详细一些，我需要一段完整的回答。',
})

/** 会话面板里「停止生成」的真实入口（DSH 原生 composer；`input.stop` 文案）。 */
const STOP_LABEL = '停止生成'
/** 发送按钮的 aria-label（用来判断「停止之后仍可操作」）。 */
const SEND_LABEL = '发送消息'

/** 把一段文案压成一行（步骤行只给一行；细节留给截图与 findings）。 */
function oneLine(text, limit = 200) {
  return stableText(text, limit)
}

// ── 数据面（只读）────────────────────────────────────────────────────────────
//
// 为什么允许读旁挂清单：票面要求「不创建无意义会话」「不出现非预期重复会话」必须以
// **历史条数与 `xuanshu/consult/sessions` 文件数前后对比**来判。界面上的列表可能因为
// 客户端内存状态而说得不完整，旁挂目录是列表的权威（ADR-0009 §4）。这里只读，不写、不删。

/** 旁挂清单目录（与宿主 `consultSessionsDir(dataDir)` 同一路径形状）。 */
export function consultSessionsDir(homeAbsolute) {
  return join(homeAbsolute, 'xuanshu', 'consult', 'sessions')
}

/** 列旁挂清单文件名（`*.json`，排序后返回；目录不存在 = 空）。 */
export function listConsultSessionFiles(homeAbsolute) {
  const dir = consultSessionsDir(homeAbsolute)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
}

/** 读一份旁挂清单（读不出来就返回 null：坏文件不该让场景中断）。 */
export function readConsultSessionFile(homeAbsolute, name) {
  try {
    return JSON.parse(readFileSync(join(consultSessionsDir(homeAbsolute), name), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 一次创建前后的数据面对照。
 * @param {string} homeAbsolute 体验 home 的绝对路径（runner 的 `ctx.env.homeAbs`）
 * @param {string[]} before 创建前的文件名
 * @returns {{newFiles: string[], newTurns: number[], newPus: string[][]}}
 */
export function diffConsultSessions(homeAbsolute, before) {
  const after = listConsultSessionFiles(homeAbsolute)
  const known = new Set(before)
  const newFiles = after.filter((name) => !known.has(name))
  const manifests = newFiles.map((name) => readConsultSessionFile(homeAbsolute, name))
  return {
    newFiles,
    newTurns: manifests.map((manifest) => (typeof manifest?.turns === 'number' ? manifest.turns : -1)),
    newPus: manifests.map((manifest) => (Array.isArray(manifest?.pus) ? manifest.pus : [])),
  }
}

// ── 浏览器侧只读探针 ─────────────────────────────────────────────────────────

/** 侧栏某个面板的真实入口（与 E01/E03 同一条路径；不猜 URL、不调 layout API）。 */
async function openPanel(ctx, label) {
  const row = sidebarRow(ctx.page, label)
  if ((await row.count()) === 0) {
    ctx.log(`正在等：侧栏出现「${label}」行（客户端插件异步挂载）`)
    await ctx.settle(1_500)
  }
  await row.click({ timeout: ACTION_TIMEOUT_MS })
  await ctx.settle(1_200)
}

/** 问事面板当前是门厅 / 历史列表 / 阅读器（§13.1「阅读位置」的判定前提）。 */
async function readConsultView(ctx) {
  return ctx.page.evaluate((panel) => {
    const root = document.querySelector(panel)
    if (root === null) return { present: false, view: 'absent' }
    if (root.querySelector('[data-xuanshu-view="reader"]') !== null) return { present: true, view: 'reader' }
    if (root.querySelector('[data-xuanshu-view="history-list"]') !== null) return { present: true, view: 'history-list' }
    return { present: true, view: 'lobby' }
  }, CONSULT)
}

/**
 * 读问事面板的可滚动容器与当前阅读位置。
 *
 * `08-recon` 实测过：`.xs-consult` 自己是 `overflow:auto;height:100%` 的滚动容器；
 * 这里不写死「一定就是它」——按 DOM 顺序找第一个真的能滚的元素，找不到就退回面板根。
 */
async function readReadingPosition(ctx) {
  return ctx.page.evaluate((panel) => {
    const root = document.querySelector(panel)
    if (root === null) return { present: false, top: 0, max: 0, tag: '', className: '' }
    const elements = [root, ...root.querySelectorAll('*')]
    let scrollable = null
    for (const element of elements) {
      const max = element.scrollHeight - element.clientHeight
      if (max > 40) { scrollable = element; break }
    }
    const target = scrollable ?? root
    return {
      present: true,
      top: Math.round(target.scrollTop),
      max: Math.max(0, Math.round(target.scrollHeight - target.clientHeight)),
      tag: target.tagName,
      className: String(target.className ?? '').slice(0, 60),
    }
  }, CONSULT)
}

/** 把问事面板的可滚动容器滚到某个位置（真实滚动，不伪造阅读位置）。 */
async function scrollReadingPosition(ctx, top) {
  return ctx.page.evaluate(({ panel, top: value }) => {
    const root = document.querySelector(panel)
    if (root === null) return false
    const elements = [root, ...root.querySelectorAll('*')]
    let scrollable = null
    for (const element of elements) {
      if (element.scrollHeight - element.clientHeight > 40) { scrollable = element; break }
    }
    const target = scrollable ?? root
    target.scrollTop = value
    return true
  }, { panel: CONSULT, top })
}

/** 读历史列表的条数（进入历史子页 → 数行 → 回门厅；列表只读，不刷新业务数据）。 */
async function readHistoryRowCount(ctx) {
  const view = await readConsultView(ctx)
  if (view.view === 'reader') {
    const back = ctx.page.locator(`${CONSULT} ${BACK_LIST}`).first()
    if ((await back.count()) > 0) { await back.click({ timeout: ACTION_TIMEOUT_MS }); await ctx.settle(800) }
  }
  const now = await readConsultView(ctx)
  if (now.view !== 'history-list') {
    const toggle = ctx.page.locator(`${CONSULT} ${HISTORY_TOGGLE}`).first()
    if ((await toggle.count()) === 0) return { ok: false, count: 0 }
    await toggle.click({ timeout: ACTION_TIMEOUT_MS })
    await ctx.settle(1_200)
  }
  const count = await ctx.page.locator(`${CONSULT} ${ROW}`).count()
  const backLobby = ctx.page.locator(`${CONSULT} ${BACK_LOBBY}`).first()
  if ((await backLobby.count()) > 0) {
    await backLobby.click({ timeout: ACTION_TIMEOUT_MS })
    await ctx.settle(800)
  }
  return { ok: true, count }
}

/** 从阅读器回到门厅（历史列表 → 门厅；已经在门厅就是空操作）。 */
async function ensureLobby(ctx) {
  const view = await readConsultView(ctx)
  if (view.view === 'reader') {
    const back = ctx.page.locator(`${CONSULT} ${BACK_LIST}`).first()
    if ((await back.count()) > 0) { await back.click({ timeout: ACTION_TIMEOUT_MS }); await ctx.settle(800) }
  }
  const now = await readConsultView(ctx)
  if (now.view === 'history-list') {
    const back = ctx.page.locator(`${CONSULT} ${BACK_LOBBY}`).first()
    if ((await back.count()) > 0) { await back.click({ timeout: ACTION_TIMEOUT_MS }); await ctx.settle(800) }
  }
}

/** 阅读器里的消息（只读 DOM；正文权威在会话日志，这里只取产品渲染出来的那部分）。 */
async function readReaderMessages(ctx) {
  return ctx.page.evaluate((panel) => {
    const root = document.querySelector(panel)
    if (root === null) return []
    return [...root.querySelectorAll('[data-xuanshu-view="reader"] [data-xuanshu-message]')].map((node) => ({
      role: node.getAttribute('data-xuanshu-message') ?? '',
      text: (node.querySelector('.xs-consult__text')?.innerText ?? '').replace(/\s+/gu, ' ').trim(),
      source: node.querySelector('[data-xuanshu-source]')?.getAttribute('data-xuanshu-source') ?? '',
    }))
  }, CONSULT)
}

/**
 * 打开历史列表里的第 `index` 条记录，读回它的短 id 与消息。
 *
 * 为什么不读会话文件：那会把「记录在磁盘上」冒充成「用户找得回」；这里只点真实行、读真实阅读器。
 */
async function openHistoryRecord(ctx, index) {
  const view = await readConsultView(ctx)
  if (view.view === 'reader') {
    const back = ctx.page.locator(`${CONSULT} ${BACK_LIST}`).first()
    if ((await back.count()) > 0) { await back.click({ timeout: ACTION_TIMEOUT_MS }); await ctx.settle(800) }
  }
  const now = await readConsultView(ctx)
  if (now.view !== 'history-list') {
    const toggle = ctx.page.locator(`${CONSULT} ${HISTORY_TOGGLE}`).first()
    if ((await toggle.count()) === 0) return { opened: false, reason: '问事面板里没有「历史回看」入口' }
    await toggle.click({ timeout: ACTION_TIMEOUT_MS })
    await ctx.settle(1_200)
  }
  const rows = ctx.page.locator(`${CONSULT} ${ROW}`)
  const rowCount = await rows.count()
  if (index >= rowCount) return { opened: false, rowCount, reason: `历史列表只有 ${rowCount} 条` }
  const row = rows.nth(index)
  const rowShortId = (await row.locator('.xs-consult__shortid').first().innerText().catch(() => '')).trim()
  const rowText = oneLine(await row.innerText().catch(() => ''), 160)
  await row.click({ timeout: ACTION_TIMEOUT_MS })
  const deadline = Date.now() + ACTION_TIMEOUT_MS
  let viewNow = await readConsultView(ctx)
  while (viewNow.view !== 'reader' && Date.now() < deadline) {
    await ctx.settle(300)
    viewNow = await readConsultView(ctx)
  }
  await ctx.settle(800)
  const readerShortId = (await ctx.page.locator(`${CONSULT} [data-xuanshu-view="reader"] .xs-consult__shortid`).first().innerText().catch(() => '')).trim()
  const readerTitle = (await ctx.page.locator(`${CONSULT} [data-xuanshu-view="reader"] .xs-consult__row-title`).first().innerText().catch(() => '')).trim()
  // 阅读器的消息是点开之后异步读回来的：没等它长出来就取，会把「还没读完」当成「没有原始输入」。
  let messages = []
  const messageDeadline = Date.now() + 10_000
  while (Date.now() < messageDeadline) {
    messages = await readReaderMessages(ctx)
    if (messages.length > 0) break
    const errorBlock = await ctx.page.locator(`${CONSULT} [data-xuanshu-view="reader"] [data-xuanshu-error]`).count().catch(() => 0)
    if (errorBlock > 0) break
    await ctx.settle(300)
  }
  // 只认**人打进去的那句**：首轮注入消息 / 运行期提醒也是 `role=user`，但它们带来源标记
  // （`xuanshu-consult` / `agent-instructions` / `runtime-context` …），各会话几乎相同——
  // 拿它们做「串味」对比会得出假结论。真实用户消息的来源标记是 `user`（实测）。
  const plainUser = messages.filter((message) => message.role === 'user'
    && (message.source === '' || message.source === 'user')
    && message.text !== '')
  return {
    opened: viewNow.view === 'reader',
    rowCount,
    rowShortId,
    rowText,
    readerShortId,
    readerTitle,
    sameShortId: rowShortId !== '' && rowShortId === readerShortId,
    messages,
    firstUserText: plainUser[0]?.text ?? '',
    firstAssistantText: messages.find((message) => message.role === 'assistant' && message.text !== '')?.text ?? '',
  }
}

/** 找「停止」类入口（真实 aria-label / 文案；不猜图标，不点强制）。 */
async function findStopEntries(ctx) {
  return ctx.page.evaluate(({ stopLabel }) => {
    const nodes = [...document.querySelectorAll('button, [role="button"]')]
    const visible = (node) => {
      const rect = node.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    return nodes
      .filter((node) => {
        const label = `${node.getAttribute('aria-label') ?? ''} ${node.textContent ?? ''}`
        return label.includes(stopLabel) && visible(node)
      })
      .map((node) => ({
        text: (node.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 60),
        ariaLabel: node.getAttribute('aria-label') ?? '',
        disabled: node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true',
      }))
  }, { stopLabel: STOP_LABEL })
}

/**
 * 读会话面板（DSH 原生 `conversation`）里与「停止 / 继续操作」有关的现场事实。
 * 只读：按钮在不在、可不可点，输入区还能不能用。
 */
async function readConversationState(ctx) {
  return ctx.page.evaluate(({ stopLabel, sendLabel }) => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    const stop = [...document.querySelectorAll('button, [role="button"]')]
      .find((node) => `${node.getAttribute('aria-label') ?? ''} ${node.textContent ?? ''}`.includes(stopLabel) && visible(node))
    const send = [...document.querySelectorAll('button, [role="button"]')]
      .find((node) => `${node.getAttribute('aria-label') ?? ''} ${node.textContent ?? ''}`.includes(sendLabel) && visible(node))
    const composers = [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(visible)
    const body = (document.body.innerText ?? '').replace(/\s+/gu, ' ').trim()
    return {
      stopVisible: stop !== undefined,
      stopDisabled: stop === undefined ? null : stop.hasAttribute('disabled') || stop.getAttribute('aria-disabled') === 'true',
      sendVisible: send !== undefined,
      composerCount: composers.length,
      composerEditable: composers.some((node) => node.tagName === 'TEXTAREA'
        ? !node.hasAttribute('disabled') && !node.hasAttribute('readonly')
        : node.getAttribute('contenteditable') === 'true'),
      bodyExcerpt: body.slice(0, 1_200),
      mentionsStopped: /已停止|已中断/u.test(body),
      mentionsQuestion: body.includes('这周如何安排木工练习'),
    }
  }, { stopLabel: STOP_LABEL, sendLabel: SEND_LABEL })
}

/** 打开侧栏「工作区 / 未分组」并列出会话行（不点任何会话；调用方决定点哪一条）。 */
async function listWorkspaceSessions(ctx) {
  const group = ctx.page.locator('[role="treeitem"]').filter({ hasText: '未分组' }).first()
  if ((await group.count()) === 0) return { reached: false, reason: '侧栏没有「工作区 / 未分组」树', candidates: [] }
  await group.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {})
  await ctx.settle(1_500)
  const rows = ctx.page.locator('[role="treeitem"]')
  const total = await rows.count()
  const candidates = []
  for (let index = 0; index < total; index += 1) {
    const text = oneLine(await rows.nth(index).innerText().catch(() => ''), 120)
    if (text === '' || text.includes('未分组')) continue
    candidates.push({ index, text })
  }
  return { reached: true, candidates }
}

/** 点开一条侧栏会话行，等会话面板的 composer 出现。 */
async function openWorkspaceSessionRow(ctx, index) {
  const row = ctx.page.locator('[role="treeitem"]').nth(index)
  const label = oneLine(await row.innerText().catch(() => ''), 80)
  await row.click({ timeout: ACTION_TIMEOUT_MS })
  await ctx.settle(1_500)
  // 行文本里带「刚刚 / N 分钟」这类相对时间与截断标题：只把**可复核的判定**带出去，
  // 原文不进步骤行（证据要能两跑逐项比，相对时间一进来就永远对不上）。
  return { opened: true, label, mentionsQuestion: label.includes('这周如何安排木工练习'), mentionsRunning: label.includes('进行中') }
}

// ── 判定（纯函数，零浏览器）─────────────────────────────────────────────────

/**
 * **E02 空问题提交**的终点归类（票 #79 第 1 条验收标准）。
 *
 * 口径：
 *   - 面板进不去（前置缺）→ `blocked`；
 *   - 产品把按钮禁用且解释清楚 → `pass`（这就是「按产品真实规则被拦住」）；
 *   - 点下去之后**真的多出一条会话** → `fail`（票面明写「不创建无意义会话」，
 *     统计用旁挂文件数与历史条数两个外部可观察物，不靠界面自述）；
 *   - 没建会话、且给出可读提示 → `pass`；没建会话也没有任何反馈 → `fail`。
 *
 * @param {object} observations
 * @returns {{status: 'pass'|'fail'|'blocked', evidence?: string, reason?: string, summary: string, observed: object}}
 */
export function decideEmptySubmitOutcome(observations = {}) {
  const panel = observations.panel ?? { opened: false }
  const submit = observations.submit ?? { found: false, disabled: false, clicked: false }
  const data = observations.data ?? { sessionsBefore: 0, sessionsAfter: 0, historyBefore: 0, historyAfter: 0 }
  const terminal = observations.terminal ?? { kind: 'nothing', text: '', inViewport: null }
  const evidenceOf = (extra) => {
    const shots = ['01-consult-before.png']
    if (submit.clicked === true) shots.push('02-empty-submit.png')
    if (terminal.kind === 'error') shots.push('02b-empty-submit-scrolled.png')
    if (submit.clicked === true) shots.push('03-history-after.png')
    shots.push(extra)
    return shots.filter((item) => typeof item === 'string' && item !== '').join(' / ')
  }
  const sessionDelta = (data.sessionsAfter ?? 0) - (data.sessionsBefore ?? 0)
  const historyDelta = (data.historyAfter ?? 0) - (data.historyBefore ?? 0)
  const observed = {
    questionEmpty: observations.question?.empty === true,
    submitFound: submit.found === true,
    submitDisabled: submit.disabled === true,
    clicked: submit.clicked === true,
    newSessions: sessionDelta,
    historyDelta,
    terminal: terminal.kind,
    terminalInViewport: terminal.inViewport ?? null,
  }

  if (panel.opened !== true) {
    return { status: 'blocked', reason: '问事面板没打开——环境缺前置，不记成产品缺陷', summary: '问事面板不可达', observed }
  }
  if (submit.found !== true) {
    return { status: 'fail', evidence: evidenceOf('问事面板里找不到「开一次问事」按钮'), summary: '提交按钮不存在', observed }
  }
  if (submit.disabled === true && submit.clicked !== true) {
    const explanation = String(submit.explanation ?? '').trim()
    if (explanation === '') {
      return { status: 'fail', evidence: evidenceOf('按钮禁用但屏上没有任何解释'), summary: '空提交被禁用，但界面没有说明为什么', observed }
    }
    return {
      status: 'pass',
      evidence: evidenceOf(`按钮禁用并解释：「${oneLine(explanation, 80)}」`),
      summary: `产品禁止空提交且解释清楚（未强行点击）：${oneLine(explanation, 60)}`,
      observed,
    }
  }
  if (submit.clicked !== true) {
    return { status: 'blocked', reason: '按钮可见且未禁用，但这一轮点不动它（被遮挡或超时）——先记环境', summary: '按钮点不动', observed }
  }
  if (sessionDelta > 0 || historyDelta > 0) {
    return {
      status: 'fail',
      evidence: evidenceOf(
        `空问题提交后新建了 ${Math.max(sessionDelta, historyDelta)} 条会话`
        + `（旁挂清单 ${data.sessionsBefore}→${data.sessionsAfter}；历史条数 ${data.historyBefore}→${data.historyAfter}）`
        + `；提示「${oneLine(terminal.text, 100) || '无'}」；提示在可视区=${terminal.inViewport ?? '未知'}`,
      ),
      summary: `空问题提交没有被拦住：创建了一条无意义会话（旁挂 +${sessionDelta} / 历史 +${historyDelta}）`
        + `；S6 §5 标题写「可先空手开一个会话」，与票面「不创建无意义会话」冲突，需人裁定`,
      observed,
    }
  }
  if (terminal.kind === 'error') {
    const visibility = terminal.inViewport === false ? '（提示渲染在可视区之外）' : ''
    return {
      status: 'pass',
      evidence: evidenceOf(`可读提示：「${oneLine(terminal.text, 100)}」${visibility}`),
      summary: `空提交被拦住且给出可读提示，没有新建会话${visibility}`,
      observed,
    }
  }
  return {
    status: 'fail',
    evidence: evidenceOf('空提交之后既没有新建会话，也没有任何提示'),
    summary: '空提交点了没反应：没有提示、没有新建会话（无法判断是被拦住还是无响应）',
    observed,
  }
}

/**
 * **E04 快速连点两次**的终点归类（票 #79 第 2 条验收标准）。
 *
 * 口径：
 *   - 面板 / 按钮不可用 → `blocked`；
 *   - 连点后**多出 ≥2 条会话**（或同一条会话 `turns > 1`）→ `fail`（非预期重复会话 / 重复提交）；
 *   - 多出 1 条且点击后有可观察的运行状态 → `pass`；
 *   - 多出 1 条但界面没有任何运行状态 → `fail`（「界面运行状态明确」不成立）；
 *   - 一条都没建、且给出可读错误 → `blocked`（服务/环境问题，不是连点的产品结论）。
 *
 * @param {object} observations
 * @returns {{status: 'pass'|'fail'|'blocked', evidence?: string, reason?: string, summary: string, observed: object}}
 */
export function decideRepeatOutcome(observations = {}) {
  const panel = observations.panel ?? { opened: false }
  const submit = observations.submit ?? {}
  const data = observations.data ?? {}
  const terminal = observations.terminal ?? { kind: 'nothing', text: '', inViewport: null }
  const evidenceOf = (extra) => {
    const shots = ['01-consult-before.png']
    if (submit.clicked === true) shots.push('02-double-click-busy.png')
    shots.push('03-history-after.png')
    shots.push(extra)
    return shots.filter((item) => typeof item === 'string' && item !== '').join(' / ')
  }
  const sessionDelta = (data.sessionsAfter ?? 0) - (data.sessionsBefore ?? 0)
  const historyDelta = (data.historyAfter ?? 0) - (data.historyBefore ?? 0)
  const duplicateTurns = (data.newTurns ?? []).filter((turns) => turns > 1)
  const observed = {
    busySeen: submit.busySeen === true,
    busyLabel: submit.busyLabel ?? '',
    newSessions: sessionDelta,
    historyDelta,
    newTurns: data.newTurns ?? [],
    terminal: terminal.kind,
  }

  if (panel.opened !== true) {
    return { status: 'blocked', reason: '问事面板没打开——环境缺前置，不记成产品缺陷', summary: '问事面板不可达', observed }
  }
  if (submit.found !== true) {
    return { status: 'fail', evidence: evidenceOf('问事面板里找不到「开一次问事」按钮'), summary: '提交按钮不存在', observed }
  }
  if (submit.disabledBefore === true) {
    return { status: 'blocked', reason: '提交按钮在连点之前就是禁用的（没有可连点的对象）', summary: '按钮不可点', observed }
  }
  if (submit.clicked !== true) {
    return { status: 'blocked', reason: `快速连点没有落到真实控件上：${oneLine(submit.errorText ?? '点击超时', 120)}`, summary: '连点没有发生', observed }
  }
  if (sessionDelta >= 2 || historyDelta >= 2 || duplicateTurns.length > 0) {
    return {
      status: 'fail',
      evidence: evidenceOf(
        `快速连点两次后出现 ${Math.max(sessionDelta, historyDelta)} 条新会话`
        + `（旁挂清单 ${data.sessionsBefore}→${data.sessionsAfter}；历史条数 ${data.historyBefore}→${data.historyAfter}）`
        + `${duplicateTurns.length > 0 ? `；其中 ${duplicateTurns.length} 条会话的 turns>1（重复提交）` : ''}`,
      ),
      summary: `快速连点两次产生了非预期的重复会话（+${sessionDelta}）`,
      observed,
    }
  }
  if (sessionDelta === 0 && historyDelta === 0) {
    if (terminal.kind === 'error' && String(terminal.text ?? '').trim() !== '') {
      return {
        status: 'blocked',
        reason: `连点之后开会话失败（服务/环境）：${oneLine(terminal.text, 160)}`,
        summary: '连点没有建出会话，但失败原因是服务/环境',
        observed,
      }
    }
    return {
      status: 'fail',
      evidence: evidenceOf('连点之后既没有新建会话，也没有任何可读反馈'),
      summary: '连点后没有反应：既没有会话也没有提示',
      observed,
    }
  }
  const stateClear = submit.busySeen === true || (terminal.kind === 'error' && String(terminal.text ?? '').trim() !== '')
  if (!stateClear) {
    return {
      status: 'fail',
      evidence: evidenceOf('连点后没有可观察的运行状态（按钮没有进入「开问事中…」/禁用）'),
      summary: '只建了一条会话，但界面没有明确的运行状态',
      observed,
    }
  }
  return {
    status: 'pass',
    evidence: evidenceOf(
      `只新建 1 条会话（旁挂 ${data.sessionsBefore}→${data.sessionsAfter}；历史 ${data.historyBefore}→${data.historyAfter}）；`
      + `运行态=${submit.busyLabel || '已观察到'}`,
    ),
    summary: `快速连点两次没有产生重复会话（+${sessionDelta}），运行状态可见：${oneLine(submit.busyLabel || '开问事中…', 40)}`,
    observed,
  }
}

/**
 * **E05 切走再回来**的终点归类（票 #79 第 3 条 + 设计 §13.1）。
 *
 * 逐条对 §13.1 的三行：
 *   - 同面板内切走再回来：草稿正文、已勾选的谱、当前会话的阅读位置必须保留；
 *   - 跨会话切换：上一会话的输入不得静默带进新会话（串味即缺陷）；
 *   - 重启后：只保证已落盘会话（本场景不验重启，不拿它抵消失败）。
 *
 * @param {object} observations
 * @returns {{status: 'pass'|'fail'|'blocked'|'not-collected', evidence?: string, reason?: string, summary: string, observed: object}}
 */
export function decideReturnOutcome(observations = {}) {
  const panel = observations.panel ?? { opened: false }
  const prereq = observations.prereq ?? { ok: false, reason: '没有检查前置' }
  const samePanel = observations.samePanel ?? {}
  const reading = observations.reading ?? {}
  const cross = observations.cross ?? {}
  const evidenceOf = (extra) => {
    const shots = ['01-draft-before-leave.png', '02-overview.png', '03-draft-after-return.png']
    if (reading.openRecorded === true) shots.push('04-reader-before-leave.png', '05-reader-after-return.png')
    if ((cross.sampled ?? 0) > 0) shots.push('06-cross-session.png')
    shots.push(extra)
    return shots.filter((item) => typeof item === 'string' && item !== '').join(' / ')
  }
  const observed = {
    draftKept: samePanel.draftKept === true,
    selectionKept: samePanel.selectionKept === true,
    readingViewKept: reading.viewKept === true,
    readingPositionKept: reading.positionKept === true,
    crossComparable: cross.comparable === true,
    crossContaminated: cross.contaminated === true,
    crossIdentityMismatch: cross.identityMismatch === true,
  }

  if (panel.opened !== true) {
    return { status: 'blocked', reason: '问事面板没打开——环境缺前置，不记成产品缺陷', summary: '问事面板不可达', observed }
  }
  if (prereq.ok !== true) {
    return { status: 'blocked', reason: `前置没就绪：${prereq.reason ?? '未知'}（这是环境问题，不是 E05 的产品结论）`, summary: '前置没就绪', observed }
  }
  // §13.1 第 1 行：同面板内切走再回来，草稿正文 / 已勾选的谱 / 当前会话的阅读位置必须保留。
  // 一次列全「丢了哪些」而不是只报第一项：同一次切走可能同时丢掉三样，只报一样会让人以为补一项就够。
  const lost = []
  if (samePanel.draftKept !== true) lost.push('草稿正文')
  if (samePanel.selectionKept !== true) lost.push('已勾选的谱')
  if (reading.openRecorded === true && (reading.viewKept !== true || reading.positionKept !== true)) lost.push('当前会话的阅读位置')
  if (lost.length > 0) {
    const positionNote = reading.openRecorded === true
      ? `；阅读位置 ${reading.topBefore ?? 0} → ${reading.topAfter ?? 0}（回来落在 ${reading.viewAfter ?? '未知'}）`
      : ''
    return {
      status: 'fail',
      evidence: evidenceOf(`切到自我总览再回问事：${lost.join('、')}没有保留——违反 §13.1 第 1 行${positionNote}`),
      summary: `同面板内切走再回来：${lost.join('、')}没有保留（违反 §13.1 第 1 行：这三样都应保留）`,
      observed,
    }
  }
  // 阅读位置这一条没有可打开的记录可测：不把「没采到」记成「通过」，也不记成产品缺陷。
  if (reading.openRecorded !== true) {
    return {
      status: 'not-collected',
      reason: '没有可打开的历史记录，§13.1 的「当前会话阅读位置」这一条本轮未采到（草稿与勾选已按上面的结论）',
      summary: '草稿/勾选这一半已采；阅读位置因没有历史记录而未采到',
      observed,
    }
  }
  // §13.1 第 2 行：跨会话切换不得串味。
  if (cross.identityMismatch === true) {
    return {
      status: 'fail',
      evidence: evidenceOf('阅读器显示的短 id 与点开的历史行不一致（点 A 看到 B）——§13.1 第 2 行的串味风险'),
      summary: '历史 A→B 切换时，阅读器显示的不是所点的那条记录',
      observed,
    }
  }
  if (cross.contaminated === true) {
    return {
      status: 'fail',
      evidence: evidenceOf('会话 A 的原始输入出现在会话 B 的阅读器里——违反 §13.1 第 2 行（跨会话切换不保留、防串味）'),
      summary: '跨会话切换出现串味：A 的输入出现在 B 里（违反 §13.1 第 2 行）',
      observed,
    }
  }
  if (cross.comparable !== true) {
    return {
      status: 'not-collected',
      reason: cross.reason ?? '可对比的两条历史记录不足（跨会话串味这一条本轮未采到）',
      summary: '同面板内切走再回来按 §13.1 保留；跨会话串味未采到（可比记录不足）',
      observed,
    }
  }
  return {
    status: 'pass',
    evidence: evidenceOf('草稿、勾选、阅读位置都保留（§13.1 第 1 行）；历史 A→B 无串味（§13.1 第 2 行）'),
    summary: '同面板内切走再回来保留草稿 / 勾选 / 阅读位置（§13.1 第 1 行）；跨会话切换无串味（§13.1 第 2 行）',
    observed,
  }
}

/**
 * **E08 响应中停止**的终点归类（票 #79 第 4 条验收标准 + S6 §6 `running` 行）。
 *
 * 规格依据：`docs/design/ui-v1/screens/S6-问事面板.md` §6 `running` 行
 * 「流式输出 + `[停止]`；工具调用块实时出现；**可中断**：`[停止]` 只断开本次生成，
 * 会话记录保留已生成部分并标「已中断」」。
 *
 * 口径：
 *   - 会话面板不可达 → `blocked`（停止入口在会话面板里，问事面板本身没有，见 S6 §6）；
 *   - 抓到生成中窗口但**没有停止入口** → `fail`（规格要求有 `[停止]`）；
 *   - 入口有、点了但没有任何终止反馈 → `fail`；
 *   - 停止之后输入区不可用 → `fail`；
 *   - 入口出现、点了、有终止反馈、之后仍可操作 → `pass`；
 *   - 没抓到生成窗口（响应已结束）→ `not-collected`（不伪造停止成功）。
 *
 * @param {object} observations
 * @returns {{status: 'pass'|'fail'|'blocked'|'not-collected', evidence?: string, reason?: string, summary: string, observed: object}}
 */
export function decideStopOutcome(observations = {}) {
  const panel = observations.panel ?? { opened: false }
  const submit = observations.submit ?? { clicked: false }
  const conversation = observations.conversation ?? { reached: false }
  const stop = observations.stop ?? { consultEntry: false, seen: false, clicked: false }
  const after = observations.after ?? { feedback: false, operable: false }
  const evidenceOf = (extra) => {
    const shots = []
    if (submit.clicked === true) shots.push('02-busy.png')
    if (conversation.reached === true) shots.push('03-workspace-session.png')
    if (stop.seen === true) shots.push('04-stop-entry.png')
    if (stop.clicked === true) shots.push('05-after-stop.png')
    shots.push(extra)
    return shots.filter((item) => typeof item === 'string' && item !== '').join(' / ') || '（本轮没有可用截图）'
  }
  const observed = {
    consultStopEntry: stop.consultEntry === true,
    conversationReached: conversation.reached === true,
    stopSeen: stop.seen === true,
    stopClicked: stop.clicked === true,
    terminationFeedback: after.feedback === true,
    stillOperable: after.operable === true,
    completedBeforeCheck: conversation.completedBeforeCheck === true,
  }

  if (panel.opened !== true) {
    return { status: 'blocked', reason: '问事面板没打开——环境缺前置，不记成产品缺陷', summary: '问事面板不可达', observed }
  }
  if (submit.clicked !== true) {
    return { status: 'blocked', reason: '没有把问事发出去（提交按钮不可点），无法进入运行中状态', summary: '没有进入响应进行中', observed }
  }
  if (conversation.reached !== true) {
    return {
      status: 'blocked',
      reason: `会话面板不可达（${oneLine(conversation.reason ?? '未知原因', 120)}）——停止入口按 S6 §6 画在会话面板里，本轮够不到`,
      summary: '会话面板不可达，停止入口无法验证',
      observed,
    }
  }
  if (stop.seen !== true) {
    if (conversation.completedBeforeCheck === true) {
      return {
        status: 'not-collected',
        reason: '响应在打开会话面板前就已结束（没抓到生成中窗口）；本轮不伪造停止成功，停止入口留待下一次采样',
        summary: '没抓到生成中窗口：响应已结束，停止入口未验证',
        observed,
      }
    }
    return {
      status: 'fail',
      evidence: evidenceOf('会话面板里响应仍在进行，但没有可用的「停止生成」入口'),
      summary: '响应进行中没有停止入口（S6 §6 `running` 行要求 `[停止]`）',
      observed,
    }
  }
  if (stop.clicked !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf('「停止生成」入口可见，但这一轮点不动它'),
      summary: '停止入口可见但点不动',
      observed,
    }
  }
  if (after.feedback !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf('点了「停止生成」之后，屏上没有出现任何终止反馈（未见「已停止 / 已中断」）'),
      summary: '停止之后没有终止反馈',
      observed,
    }
  }
  if (after.operable !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf('停止之后输入区不可用（找不到可编辑的 composer / 发送入口）'),
      summary: '停止之后不能再操作',
      observed,
    }
  }
  return {
    status: 'pass',
    evidence: evidenceOf('停止入口可见、点得动，出现终止反馈，之后输入区仍可操作（S6 §6 `running` 行）'),
    summary: '响应进行中能停止：终止反馈明确，之后仍可操作',
    observed,
  }
}

// ── 场景定义 ────────────────────────────────────────────────────────────────

/** 读一次问事面板的门厅状态（含按钮、输入框、错误块）。 */
async function readLobby(ctx) {
  const state = await readConsultState(ctx.page)
  const view = await readConsultView(ctx)
  const startButton = state.startButtons[0]
  return { state, view, startButton }
}

/** 轮询「按钮进入运行态」——要抓住「开问事中…」那一瞬，也要尽早看见错误。 */
async function waitForBusy(ctx, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await readConsultState(ctx.page)
    const button = state.startButtons[0]
    if (button !== undefined && (button.disabled || /开问事中/u.test(button.label))) {
      return { seen: true, label: button.label, disabled: button.disabled }
    }
    await ctx.settle(40)
  }
  return { seen: false, label: '', disabled: false }
}

/** 等「开问事」的本地编排落定：会话数变化、create 错误、或 open-session 错误出现。 */
async function waitForCreateSettled(ctx, homeBefore, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await readConsultState(ctx.page)
    const changed = listConsultSessionFiles(ctx.env.homeAbs).length !== homeBefore
    const createError = state.errorBlocks.find((block) => block.kind === 'create')
    const openError = state.errorBlocks.find((block) => block.kind === 'open-session')
    const busy = state.startButtons.some((button) => button.disabled || /开问事中/u.test(button.label))
    if (createError !== undefined || openError !== undefined) return { settled: true, state }
    if (changed && !busy) return { settled: true, state }
    await ctx.settle(200)
  }
  return { settled: false, state: await readConsultState(ctx.page) }
}

/** 把错误块/提示滚进视野另存一张（「提示位置明确」这条要有第二张图）。 */
async function screenshotScrolled(ctx, name) {
  let scrolled = false
  for (const selector of [`${CONSULT} [data-xuanshu-error]`, `${CONSULT} [data-xuanshu-note]`]) {
    const target = ctx.page.locator(selector).first()
    if ((await target.count()) === 0) continue
    try {
      await target.scrollIntoViewIfNeeded({ timeout: 5_000 })
      await ctx.settle(400)
      scrolled = true
      break
    } catch {
      /* 滚不动就保留当前画面 */
    }
  }
  await ctx.shot(name)
  return scrolled
}

/** 打开问事（真实侧栏入口）并确认面板出现。 */
async function enterConsult(ctx) {
  ctx.log('正在等：点侧栏「问事」打开问事面板')
  const entry = await openConsult(ctx)
  await ctx.settle(1_000)
  return entry
}

export const EXCEPTION_SCENARIOS = {
  'consult-empty': {
    id: 'consult-empty',
    caseId: 'E02',
    title: '空问题提交：按产品真实规则被拦住、提示位置明确、不创建无意义会话',
    shots: [
      '00-first-run.png', '01-consult-before.png', '02-empty-submit.png',
      '02b-empty-submit-scrolled.png', '03-history-after.png',
    ],
    /**
     * 问题留空 → 点「＋ 开一次问事」。
     *
     * 为什么不先填一段再清空：**空提交就是空输入**。这里只把输入框清空、点真实按钮，
     * 然后看两件外部可观察物：旁挂清单文件数、历史列表条数。
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

      const entry = await enterConsult(ctx)
      const panel = { opened: entry.opened, attempts: entry.attempts }
      ctx.step({
        action: '点侧栏「问事」打开问事面板',
        target: CONSULT,
        outcome: entry.opened ? `面板出现（第 ${entry.attempts} 次点开）` : `面板没打开（试了 ${entry.attempts} 次）`,
      })
      if (!entry.opened) {
        return {
          status: decideEmptySubmitOutcome({ panel }),
          observations: { headline: '问事面板不可达' },
        }
      }

      // 空输入：把输入框清空（不清也行，但「留空」要能被证据复核）。
      const textarea = ctx.page.locator(`${CONSULT} ${QUESTION_FIELD}`).first()
      const textareaUsable = (await textarea.count()) > 0 && (await textarea.isEditable().catch(() => false))
      if (textareaUsable) await textarea.fill('', { timeout: ACTION_TIMEOUT_MS })
      const questionNow = textareaUsable ? await textarea.inputValue().catch(() => '') : null

      const before = await readLobby(ctx)
      const sessionsBeforeFiles = listConsultSessionFiles(ctx.env.homeAbs)
      const sessionsBefore = sessionsBeforeFiles.length
      const historyBefore = await readHistoryRowCount(ctx)
      await ctx.shot('01-consult-before.png')
      ctx.step({
        action: '把问题留空并记录提交前的数据面',
        target: QUESTION_FIELD,
        outcome: `输入框${questionNow === '' ? '为空' : `里还有「${oneLine(questionNow ?? '', 40)}」`}；`
          + `旁挂清单 ${sessionsBefore} 条；历史列表 ${historyBefore.count} 条；`
          + `主按钮「${before.startButton?.label ?? '无'}」（禁用=${before.startButton?.disabled === true}）`,
        shot: '01-consult-before.png',
      })

      let clicked = false
      let errorText = ''
      const disabled = before.startButton?.disabled === true
      if (before.startButton !== undefined && !disabled) {
        ctx.log('正在等：空问题点「＋ 开一次问事」之后产品给什么')
        try {
          await ctx.page.locator(`${CONSULT} ${START_ACTION}`).first().click({ timeout: ACTION_TIMEOUT_MS })
          clicked = true
        } catch (error) {
          errorText = oneLine(error?.message ?? error)
          ctx.note(`空提交点不动：${errorText}`)
        }
      }
      const busy = clicked ? await waitForBusy(ctx) : { seen: false, label: '' }
      const settled = clicked ? await waitForCreateSettled(ctx, sessionsBefore) : { settled: false, state: await readConsultState(ctx.page) }
      await ctx.settle(800)
      await ctx.shot('02-empty-submit.png')
      const terminalState = settled.state
      const terminalBlocks = terminalState.errorBlocks
      const terminalText = oneLine(terminalBlocks.map((block) => block.text).join(' / '))
      const terminalInViewport = terminalBlocks.length === 0 ? null : terminalBlocks.some((block) => block.inViewport)
      const scrolled = terminalBlocks.length > 0 ? await screenshotScrolled(ctx, '02b-empty-submit-scrolled.png') : false

      const sessionsAfter = listConsultSessionFiles(ctx.env.homeAbs).length
      const historyAfter = await readHistoryRowCount(ctx)
      await ctx.shot('03-history-after.png')

      ctx.step({
        action: '记录空提交之后的终态与数据面',
        target: `${CONSULT} ${START_ACTION}`,
        outcome: oneLine(
          (clicked ? `已点一次（运行态=${busy.seen ? busy.label : '未捕获'}）；` : `未点击${errorText === '' ? '' : `（${errorText}）`}；`)
          + `旁挂清单 ${sessionsBefore}→${sessionsAfter}；历史列表 ${historyBefore.count}→${historyAfter.count}；`
          + `${terminalBlocks.length === 0 ? '屏上没有错误提示' : `提示「${terminalText.slice(0, 120)}」；提示在可视区=${terminalInViewport}`}`
          + `${scrolled ? '（已滚动另存一张）' : ''}`,
        ),
        shot: '02-empty-submit.png',
        ...(sessionsAfter > sessionsBefore ? { note: '空问题提交之后旁挂清单多了一条：这是一条无意义会话（票面要求不创建）' } : {}),
      })

      const observations = {
        panel,
        question: { empty: questionNow === '', textareaUsable },
        submit: {
          found: before.startButton !== undefined,
          disabled,
          clicked,
          busySeen: busy.seen,
          busyLabel: busy.label,
          label: before.startButton?.label ?? '',
          explanation: [
            ...before.state.notes,
            ...before.state.errorBlocks.map((block) => block.text),
            ...before.state.alerts,
            before.state.aiPathText,
          ].filter((text) => text !== '').join(' / '),
          errorText,
        },
        data: {
          sessionsBefore,
          sessionsAfter,
          historyBefore: historyBefore.count,
          historyAfter: historyAfter.count,
        },
        terminal: { kind: terminalBlocks.length > 0 ? 'error' : 'nothing', text: terminalText, inViewport: terminalInViewport },
        questionLeft: terminalState.textarea === null ? null : terminalState.textarea.value,
      }
      return {
        status: decideEmptySubmitOutcome(observations),
        observations: {
          ...observations,
          data: { sessionsBefore, sessionsAfter, historyBefore: historyBefore.count, historyAfter: historyAfter.count },
          headline: `空提交：点击=${clicked}；旁挂 ${sessionsBefore}→${sessionsAfter}；历史 ${historyBefore.count}→${historyAfter.count}；`
            + `提示=${terminalBlocks.length > 0 ? '有' : '无'}；输入框剩余=${terminalState.textarea === null ? '无输入框' : terminalState.textarea.value === '' ? '空' : '仍有内容'}`,
        },
      }
    },
  },

  'consult-repeat': {
    id: 'consult-repeat',
    caseId: 'E04',
    title: '快速连点两次：不出现非预期重复会话 / 重复提交，界面运行状态明确',
    shots: ['00-first-run.png', '01-consult-before.png', '02-double-click-busy.png', '03-history-after.png', '04-terminal.png'],
    /**
     * 对可用的提交按钮**快速连点两次**（`dblclick`，不加 `force`）。
     *
     * 拦重复的第一道是按钮在点击后进入「开问事中…」并禁用；如果状态更新慢于第二次点击，
     * 就会出现两条会话。用旁挂清单文件数与历史条数核实，不靠界面自述。
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

      const entry = await enterConsult(ctx)
      const panel = { opened: entry.opened, attempts: entry.attempts }
      if (!entry.opened) {
        return { status: decideRepeatOutcome({ panel }), observations: { headline: '问事面板不可达' } }
      }
      ctx.step({
        action: '点侧栏「问事」打开问事面板',
        target: CONSULT,
        outcome: `面板出现（第 ${entry.attempts} 次点开）`,
      })

      // 勾上测试谱：让这一问真的会发出去（不然会被无源引导拦下，测不到「连点」）。
      const label = ctx.page.locator(`${CONSULT} label`).filter({ hasText: FIXTURE.puName }).first()
      let checked = false
      if ((await label.count()) > 0) {
        const checkbox = label.locator('input[type="checkbox"]').first()
        if ((await checkbox.count()) > 0) {
          if (!(await checkbox.isChecked().catch(() => false))) await checkbox.check({ timeout: ACTION_TIMEOUT_MS })
          checked = await checkbox.isChecked().catch(() => false)
        }
      }
      const textarea = ctx.page.locator(`${CONSULT} ${QUESTION_FIELD}`).first()
      const textareaUsable = (await textarea.count()) > 0 && (await textarea.isEditable().catch(() => false))
      if (textareaUsable) await textarea.fill(EXCEPTION_FIXTURE.repeatQuestion, { timeout: ACTION_TIMEOUT_MS })

      const before = await readLobby(ctx)
      const sessionsBeforeFiles = listConsultSessionFiles(ctx.env.homeAbs)
      const sessionsBefore = sessionsBeforeFiles.length
      const historyBefore = await readHistoryRowCount(ctx)
      await ctx.shot('01-consult-before.png')
      ctx.step({
        action: '填入问题、勾选测试谱并记录提交前数据面',
        target: `${CONSULT} ${ASK_BLOCK}`,
        outcome: `勾选「${FIXTURE.puName}」=${checked}；问题已填入=${textareaUsable}；`
          + `旁挂清单 ${sessionsBefore} 条；历史列表 ${historyBefore.count} 条；按钮「${before.startButton?.label ?? '无'}」（禁用=${before.startButton?.disabled === true}）`,
        shot: '01-consult-before.png',
      })

      let clicked = false
      let clickError = ''
      if (before.startButton !== undefined && before.startButton.disabled !== true) {
        ctx.log('正在等：对「＋ 开一次问事」快速连点两次（dblclick，不强制）')
        try {
          await ctx.page.locator(`${CONSULT} ${START_ACTION}`).first().dblclick({ timeout: ACTION_TIMEOUT_MS })
          clicked = true
        } catch (error) {
          clickError = oneLine(error?.message ?? error)
          ctx.note(`快速连点没有完整落到控件上：${clickError}`)
          // 第一次点击可能已经生效（第二次点在被禁用后的按钮上）：以数据面为准，不把「点过」记成「没点」。
          await ctx.settle(800)
          if (listConsultSessionFiles(ctx.env.homeAbs).length !== sessionsBefore) clicked = true
        }
      }
      const busy = clicked ? await waitForBusy(ctx) : { seen: false, label: '' }
      await ctx.shot('02-double-click-busy.png')
      const settled = clicked ? await waitForCreateSettled(ctx, sessionsBefore) : { settled: false, state: await readConsultState(ctx.page) }
      await ctx.settle(800)
      const terminalState = await readConsultState(ctx.page)
      const terminalText = oneLine(terminalState.errorBlocks.map((block) => block.text).join(' / '))
      const terminalInViewport = terminalState.errorBlocks.length === 0 ? null : terminalState.errorBlocks.some((block) => block.inViewport)
      await ctx.shot('04-terminal.png')

      const sessionsAfter = listConsultSessionFiles(ctx.env.homeAbs).length
      const diff = diffConsultSessions(ctx.env.homeAbs, sessionsBeforeFiles)
      const historyAfter = await readHistoryRowCount(ctx)
      await ctx.shot('03-history-after.png')
      ctx.step({
        action: '记录快速连点之后的数据面与运行状态',
        target: `${CONSULT} ${START_ACTION}`,
        outcome: oneLine(
          `${clicked ? '已快速连点两次' : `连点失败${clickError === '' ? '' : `（${clickError}）`}`}；`
          + `运行态=${busy.seen ? busy.label : '未捕获'}；旁挂清单 ${sessionsBefore}→${sessionsAfter}；`
          + `新会话 turns=${diff.newTurns.join(',') || '无'}；历史列表 ${historyBefore.count}→${historyAfter.count}；`
          + `提示「${terminalText || '无'}」；提示在可视区=${terminalInViewport ?? '未知'}`,
        ),
        shot: '03-history-after.png',
        ...(sessionsAfter - sessionsBefore >= 2 ? { note: '快速连点产生了多条会话：重复提交（票面要求不出现非预期重复会话）' } : {}),
      })

      const observations = {
        panel,
        submit: {
          found: before.startButton !== undefined,
          disabledBefore: before.startButton?.disabled === true,
          clicked,
          busySeen: busy.seen,
          busyLabel: busy.label,
          errorText: clickError,
        },
        data: {
          sessionsBefore,
          sessionsAfter,
          newTurns: diff.newTurns,
          historyBefore: historyBefore.count,
          historyAfter: historyAfter.count,
        },
        terminal: { kind: terminalState.errorBlocks.length > 0 ? 'error' : 'nothing', text: terminalText, inViewport: terminalInViewport },
        settled: settled.settled,
      }
      return {
        status: decideRepeatOutcome(observations),
        observations: {
          ...observations,
          headline: `连点：运行态=${busy.seen ? busy.label : '未捕获'}；新会话=${sessionsAfter - sessionsBefore}；`
            + `历史 ${historyBefore.count}→${historyAfter.count}；提示=${terminalText === '' ? '无' : '有'}`,
        },
      }
    },
  },

  'consult-return': {
    id: 'consult-return',
    caseId: 'E05',
    title: '切走再回来：草稿 / 已勾选谱 / 阅读位置按 §13.1 保留；跨会话不串味',
    shots: [
      '00-first-run.png', '01-draft-before-leave.png', '02-overview.png', '03-draft-after-return.png',
      '04-reader-before-leave.png', '05-reader-after-return.png', '06-cross-session.png',
    ],
    /**
     * 两段观察，都按 `docs/design/ui-v1/README.md` §13.1：
     *   A. 草稿正文 + 已勾选的谱：切到自我总览，再回问事；
     *   B. 当前会话的阅读位置：历史 → 阅读器 → 滚动 → 切走 → 回来；
     *   C. 跨会话：历史 A→B 两条记录，核对短 id 与正文不串。
     *
     * 不用「已提交会话」冒充草稿：本场景的草稿**没有提交**，会话 A/B 是同一 home 里已有的真实记录。
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

      const entry = await enterConsult(ctx)
      const panel = { opened: entry.opened, attempts: entry.attempts }
      if (!entry.opened) {
        return { status: decideReturnOutcome({ panel }), observations: { headline: '问事面板不可达' } }
      }
      ctx.step({
        action: '点侧栏「问事」打开问事面板',
        target: CONSULT,
        outcome: `面板出现（第 ${entry.attempts} 次点开）`,
      })

      // 前置：勾选区里有测试谱、输入框可用。缺了就 blocked（不是 E05 的产品结论）。
      const label = ctx.page.locator(`${CONSULT} label`).filter({ hasText: FIXTURE.puName }).first()
      const textarea = ctx.page.locator(`${CONSULT} ${QUESTION_FIELD}`).first()
      const prereq = { ok: false, reason: '' }
      let checkbox = null
      if ((await label.count()) === 0) prereq.reason = `问事勾选区里没有「${FIXTURE.puName}」`
      else if ((await textarea.count()) === 0 || !(await textarea.isEditable().catch(() => false))) prereq.reason = '问事输入框不可用'
      else {
        checkbox = label.locator('input[type="checkbox"]').first()
        if ((await checkbox.count()) === 0) prereq.reason = '测试谱那一行没有 checkbox'
        else prereq.ok = true
      }
      if (!prereq.ok) {
        return {
          status: decideReturnOutcome({ panel, prereq }),
          observations: { headline: `前置没就绪：${prereq.reason}` },
        }
      }

      // ── A. 草稿 + 已勾选的谱 ──────────────────────────────────────────────
      if (!(await checkbox.isChecked().catch(() => false))) await checkbox.check({ timeout: ACTION_TIMEOUT_MS })
      await textarea.fill(EXCEPTION_FIXTURE.draft, { timeout: ACTION_TIMEOUT_MS })
      const draftBefore = await textarea.inputValue().catch(() => '')
      const selectionBefore = await checkbox.isChecked().catch(() => false)
      await ctx.shot('01-draft-before-leave.png')
      ctx.step({
        action: '填入未提交草稿并勾选测试谱（不提交）',
        target: `${CONSULT} ${ASK_BLOCK}`,
        outcome: `草稿「${oneLine(draftBefore, 60)}」；勾选「${FIXTURE.puName}」=${selectionBefore}（未提交）`,
        shot: '01-draft-before-leave.png',
      })

      ctx.log('正在等：切到「总览」再回「问事」')
      await openPanel(ctx, '总览')
      await ctx.shot('02-overview.png')
      ctx.step({ action: '切到自我总览（真实侧栏行）', target: 'sidebar 总览', outcome: '已切到总览', shot: '02-overview.png' })
      await openPanel(ctx, '问事')
      await ctx.settle(1_000)
      const stateAfterReturn = await readConsultState(ctx.page)
      const draftAfter = stateAfterReturn.textarea === null ? null : stateAfterReturn.textarea.value
      const labelAfter = ctx.page.locator(`${CONSULT} label`).filter({ hasText: FIXTURE.puName }).first()
      const checkboxAfter = labelAfter.locator('input[type="checkbox"]').first()
      const selectionAfter = (await checkboxAfter.count()) > 0 ? await checkboxAfter.isChecked().catch(() => false) : false
      await ctx.shot('03-draft-after-return.png')
      ctx.step({
        action: '从总览回到问事，读草稿与勾选',
        target: `${CONSULT} ${ASK_BLOCK}`,
        outcome: `草稿${draftAfter === draftBefore ? '仍在' : draftAfter === '' ? '丢失（输入框为空）' : '被改动'}；`
          + `勾选「${FIXTURE.puName}」=${selectionAfter}（离开前=${selectionBefore}）`,
        shot: '03-draft-after-return.png',
      })

      // ── B. 阅读位置 ──────────────────────────────────────────────────────
      ctx.log('正在等：历史回看里的阅读器（取一条真实记录）')
      const record = await openHistoryRecord(ctx, 0)
      let reading = { openRecorded: false, viewAfter: 'unknown', topBefore: 0, topAfter: 0, viewKept: false, positionKept: false, scrollable: false }
      if (record.opened) {
        const positionBefore = await readReadingPosition(ctx)
        if (positionBefore.max > 80) await scrollReadingPosition(ctx, Math.min(positionBefore.max - 20, 320))
        const scrolled = await readReadingPosition(ctx)
        await ctx.shot('04-reader-before-leave.png')
        ctx.step({
          action: '在历史阅读器里停在一个阅读位置',
          target: `${CONSULT} [data-xuanshu-view="reader"]`,
          outcome: oneLine(`记录 ${record.rowShortId}（阅读器 ${record.readerShortId}）；可滚动范围 ${scrolled.max}px，停在 ${scrolled.top}px`),
          shot: '04-reader-before-leave.png',
        })
        ctx.log('正在等：从阅读器切到总览再回问事')
        await openPanel(ctx, '总览')
        await openPanel(ctx, '问事')
        await ctx.settle(1_000)
        const viewAfter = await readConsultView(ctx)
        const positionAfter = await readReadingPosition(ctx)
        reading = {
          openRecorded: true,
          viewBefore: 'reader',
          viewAfter: viewAfter.view,
          scrollable: scrolled.max > 80,
          topBefore: scrolled.top,
          topAfter: positionAfter.top,
          viewKept: viewAfter.view === 'reader',
          // 内容不够长（不可滚）时，「阅读位置」就是阅读器本身：viewKept 即为保留。
          positionKept: viewAfter.view === 'reader'
            && (scrolled.max <= 80 || Math.abs(positionAfter.top - scrolled.top) <= Math.max(8, Math.round(scrolled.top * 0.2))),
        }
        await ctx.shot('05-reader-after-return.png')
        ctx.step({
          action: '回到问事，读阅读位置是否保留',
          target: `${CONSULT} [data-xuanshu-view="reader"]`,
          outcome: `回来落在 ${viewAfter.view}；滚动位置 ${scrolled.top}→${positionAfter.top}（max ${positionAfter.max}）`,
          shot: '05-reader-after-return.png',
        })
      } else {
        ctx.step({
          action: '打开历史阅读器',
          target: `${CONSULT} ${HISTORY_TOGGLE}`,
          outcome: `没能打开：${record.reason ?? '未知'}`,
          shot: '05-reader-after-return.png',
        })
      }

      // ── C. 跨会话：历史 A→B，核对短 id 与正文不串 ────────────────────────
      await ensureLobby(ctx)
      const sampleCount = Math.min(4, (await readHistoryRowCount(ctx)).count)
      const sampled = []
      for (let index = 0; index < sampleCount; index += 1) {
        const candidate = await openHistoryRecord(ctx, index)
        if (!candidate.opened) continue
        sampled.push({
          index,
          rowShortId: candidate.rowShortId,
          readerShortId: candidate.readerShortId,
          sameShortId: candidate.sameShortId,
          firstUserText: candidate.firstUserText,
          messageCount: candidate.messages.length,
          texts: candidate.messages.map((message) => message.text),
        })
        const back = ctx.page.locator(`${CONSULT} ${BACK_LIST}`).first()
        if ((await back.count()) > 0) { await back.click({ timeout: ACTION_TIMEOUT_MS }); await ctx.settle(600) }
      }
      await ctx.shot('06-cross-session.png')
      const identityMismatch = sampled.some((item) => item.sameShortId !== true)
      let pair = null
      for (let i = 0; i < sampled.length && pair === null; i += 1) {
        for (let j = i + 1; j < sampled.length; j += 1) {
          const left = sampled[i]
          const right = sampled[j]
          if (left.firstUserText === '' || right.firstUserText === '') continue
          if (left.firstUserText === right.firstUserText) continue
          pair = { left, right }
          break
        }
      }
      const cross = {
        sampled: sampled.length,
        identityMismatch,
        comparable: pair !== null,
        reason: pair === null ? `历史记录里找不到两条原始问题不同的记录（采样 ${sampled.length} 条），跨会话串味无法用正文区分` : '',
        contaminated: pair === null ? false : pair.right.texts.includes(pair.left.firstUserText),
      }
      ctx.step({
        action: '历史 A→B 往返，核对短 id 与正文是否串味',
        target: `${CONSULT} 历史回看 → 阅读器`,
        outcome: oneLine(
          `采样 ${sampled.length} 条：${sampled.map((item) => `${item.rowShortId}(${item.messageCount} 条消息 / 原话「${oneLine(item.firstUserText, 18) || '无'}」)`).join('；')}；`
          + `短 id 全部一致=${!identityMismatch}；`
          + (pair === null
            ? `可比记录不足：${cross.reason}`
            : `A=${pair.left.rowShortId}、B=${pair.right.rowShortId}；A 的输入出现在 B=${cross.contaminated}`),
          500,
        ),
        shot: '06-cross-session.png',
      })
      await ensureLobby(ctx)

      const observations = {
        panel,
        prereq,
        samePanel: {
          draftBefore,
          draftAfter,
          draftKept: draftAfter === draftBefore && draftBefore !== '',
          selectionBefore,
          selectionAfter,
          selectionKept: selectionAfter === selectionBefore && selectionBefore === true,
        },
        reading,
        cross,
      }
      return {
        status: decideReturnOutcome(observations),
        observations: {
          ...observations,
          cross: { ...cross, pair: cross.pair },
          headline: `草稿保留=${observations.samePanel.draftKept}；勾选保留=${observations.samePanel.selectionKept}；`
            + `阅读位置保留=${reading.viewKept && reading.positionKept}；跨会话可比=${cross.comparable}；串味=${cross.contaminated}`,
        },
      }
    },
  },

  'consult-stop': {
    id: 'consult-stop',
    caseId: 'E08',
    title: '响应进行中使用当前界面的停止入口：终止反馈明确、之后仍可操作',
    shots: [
      '00-first-run.png', '01-consult-before.png', '02-busy.png', '03-workspace-session.png',
      '04-stop-entry.png', '05-after-stop.png', '06-after-stop-operable.png',
    ],
    /**
     * 发一条**真实**、需要较长回答的问题（不是伪造长响应），然后尽快打开会话面板找 `[停止生成]`。
     *
     * 两条必须说清的事实：
     *   1. 问事面板自己**没有**停止入口（S6 §6 把 `[停止]` 画在会话面板里）；所以「当前界面的停止入口」
     *      只能在 DSH 会话面板里找；
     *   2. 找不到 / 没抓到生成窗口时，记 `fail` / `not-collected` / `blocked`，**不伪造停止成功**。
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

      const entry = await enterConsult(ctx)
      const panel = { opened: entry.opened, attempts: entry.attempts }
      if (!entry.opened) {
        return { status: decideStopOutcome({ panel }), observations: { headline: '问事面板不可达' } }
      }
      ctx.step({ action: '点侧栏「问事」打开问事面板', target: CONSULT, outcome: `面板出现（第 ${entry.attempts} 次点开）` })

      const label = ctx.page.locator(`${CONSULT} label`).filter({ hasText: FIXTURE.puName }).first()
      let checked = false
      if ((await label.count()) > 0) {
        const checkbox = label.locator('input[type="checkbox"]').first()
        if ((await checkbox.count()) > 0) {
          if (!(await checkbox.isChecked().catch(() => false))) await checkbox.check({ timeout: ACTION_TIMEOUT_MS })
          checked = await checkbox.isChecked().catch(() => false)
        }
      }
      const textarea = ctx.page.locator(`${CONSULT} ${QUESTION_FIELD}`).first()
      const textareaUsable = (await textarea.count()) > 0 && (await textarea.isEditable().catch(() => false))
      if (textareaUsable) await textarea.fill(EXCEPTION_FIXTURE.stopQuestion, { timeout: ACTION_TIMEOUT_MS })

      // 先记录「问事面板里有没有停止入口」——S6 §6 说它在会话面板里，这里照实记。
      const consultStopEntries = await findStopEntries(ctx)
      const before = await readLobby(ctx)
      await ctx.shot('01-consult-before.png')
      ctx.step({
        action: '填入需要较长回答的真实问题，并检查问事面板的停止入口',
        target: `${CONSULT} ${ASK_BLOCK}`,
        outcome: `勾选「${FIXTURE.puName}」=${checked}；问题已填入=${textareaUsable}；`
          + `问事面板里的停止类入口=${consultStopEntries.length} 个（S6 §6 把 [停止] 画在会话面板）`,
        shot: '01-consult-before.png',
      })

      let clicked = false
      if (before.startButton !== undefined && before.startButton.disabled !== true) {
        ctx.log('正在等：发起一次真实响应（随后去会话面板找停止入口）')
        try {
          await ctx.page.locator(`${CONSULT} ${START_ACTION}`).first().click({ timeout: ACTION_TIMEOUT_MS })
          clicked = true
        } catch (error) {
          ctx.note(`问事提交点不动：${oneLine(error?.message ?? error)}`)
        }
      }
      const busy = clicked ? await waitForBusy(ctx) : { seen: false, label: '' }
      await ctx.shot('02-busy.png')
      ctx.step({
        action: '发起问事并记录运行态',
        target: `${CONSULT} ${START_ACTION}`,
        outcome: clicked ? `已发出；运行态=${busy.seen ? busy.label : '未捕获'}` : '没有发出去（按钮不可点）',
        shot: '02-busy.png',
      })

      // 会话面板：从侧栏工作区打开**这一条**（不是随便一条旧记录）。
      ctx.log('正在等：侧栏工作区里的会话面板')
      const workspace = await listWorkspaceSessions(ctx)
      let conversation = { reached: false, reason: workspace.reason ?? '', completedBeforeCheck: false, panelBody: '' }
      let stop = { consultEntry: consultStopEntries.length > 0, seen: false, clicked: false }
      let after = { feedback: false, operable: false, bodyAfter: '' }
      let conversationState = null
      let openedRunning = false

      if (workspace.reached) {
        let fallback = null
        for (const candidate of workspace.candidates.slice(0, 3)) {
          const opened = await openWorkspaceSessionRow(ctx, candidate.index)
          openedRunning = opened.mentionsRunning
          await ctx.settle(1_500)
          const state = await readConversationState(ctx)
          conversationState = state
          // 面板算「到达」：有 composer，或至少有对话正文；只有侧栏标题不算。
          const panelReached = state.composerCount > 0 || state.bodyExcerpt.length > 0
          if (!panelReached) continue
          if (fallback === null) fallback = { state, mentionsRunning: opened.mentionsRunning }
          // 只认「正文里真的有本轮问题」的那条会话：侧面工作区里旧记录很多，开错一条会把停止验成假的。
          if (!state.mentionsQuestion && !state.stopVisible) continue
          conversation = { reached: true, reason: '', completedBeforeCheck: false, panelBody: state.bodyExcerpt }
          if (state.stopVisible) break
        }
        if (!conversation.reached && fallback !== null) {
          // 面板确实打开了，但正文里找不到本轮问题：照实登记，不把它冒充成「这一条」。
          conversation = {
            reached: true,
            reason: '打开的是会话面板，但正文里找不到本轮的原始问题（可能开成了别的会话）',
            completedBeforeCheck: false,
            panelBody: fallback.state.bodyExcerpt,
          }
          conversationState = fallback.state
          openedRunning = fallback.mentionsRunning
        }
      }
      await ctx.shot('03-workspace-session.png')
      ctx.step({
        action: '从侧栏工作区打开刚发起的会话',
        target: 'sidebar 工作区 → 未分组',
        outcome: conversation.reached
          ? `会话面板到达（行里有本轮问题=${conversationState?.mentionsQuestion === true}；行显示进行中=${openedRunning}）；`
            + `composer=${conversationState?.composerCount ?? 0} 个；停止入口此刻=${conversationState?.stopVisible === true}`
          : `会话面板不可达：${conversation.reason || '工作区里没有可打开的会话行'}`,
        shot: '03-workspace-session.png',
      })

      if (conversation.reached) {
        // 抓生成中的窗口：最多 60s；停止入口消失且 composer 可用 = 响应已结束。
        ctx.log('正在等：会话面板里的「停止生成」入口（最多 60s）')
        const deadline = Date.now() + 60_000
        let stoppedReady = conversationState?.stopVisible === true
        let missingRounds = 0
        while (!stoppedReady && Date.now() < deadline) {
          const state = await readConversationState(ctx)
          conversationState = state
          if (state.stopVisible) { stoppedReady = true; break }
          if (state.composerCount > 0 && state.mentionsQuestion) missingRounds += 1
          else missingRounds = 0
          // 连续 4s 都没有停止入口、但会话正文已经就位 = 响应已结束（不是入口缺失的现场）。
          if (missingRounds >= 8) {
            conversation.completedBeforeCheck = true
            break
          }
          await ctx.settle(500)
        }
        stop.seen = conversationState?.stopVisible === true
        await ctx.shot('04-stop-entry.png')
        ctx.step({
          action: '记录生成中的停止入口',
          target: `[aria-label="${STOP_LABEL}"]`,
          outcome: stop.seen
            ? `「${STOP_LABEL}」可见（禁用=${conversationState?.stopDisabled === true}）`
            : conversation.completedBeforeCheck
              ? '没有停止入口，且响应在检查期间已结束（没抓到生成中窗口）'
              : '没有停止入口（响应仍在进行）',
          shot: '04-stop-entry.png',
        })

        if (stop.seen) {
          const stopButton = ctx.page.getByRole('button', { name: STOP_LABEL, exact: true }).first()
          if ((await stopButton.count()) > 0 && (await stopButton.isEnabled().catch(() => false))) {
            ctx.log('正在等：点「停止生成」之后产品的终止反馈')
            try {
              await stopButton.click({ timeout: ACTION_TIMEOUT_MS })
              stop.clicked = true
            } catch (error) {
              ctx.note(`「${STOP_LABEL}」点不动：${oneLine(error?.message ?? error)}`)
            }
          }
          await ctx.settle(500)
          // 终止反馈：停止入口消失 + 屏上出现「已停止 / 已中断」。
          const feedbackDeadline = Date.now() + 20_000
          let terminalState = await readConversationState(ctx)
          while (Date.now() < feedbackDeadline) {
            terminalState = await readConversationState(ctx)
            const stopGone = terminalState.stopVisible !== true
            if (stopGone && terminalState.mentionsStopped) break
            await ctx.settle(500)
          }
          const finalState = terminalState
          after = {
            feedback: finalState.mentionsStopped === true,
            operable: finalState.composerCount > 0 && finalState.composerEditable === true,
            bodyAfter: finalState.bodyExcerpt,
            stopGone: finalState.stopVisible !== true,
          }
          await ctx.shot('05-after-stop.png')
          ctx.step({
            action: '点「停止生成」并记录终止反馈与后续可操作性',
            target: `[aria-label="${STOP_LABEL}"]`,
            outcome: oneLine(
              `已点击=${stop.clicked}；停止入口消失=${finalState.stopVisible !== true}；`
              + `屏上出现「已停止 / 已中断」=${finalState.mentionsStopped}；输入区可编辑=${finalState.composerCount > 0 && finalState.composerEditable}；`
              + `发送入口可见=${finalState.sendVisible}`,
            ),
            shot: '05-after-stop.png',
            ...(finalState.mentionsStopped !== true ? { note: '点了停止但没有读到终止反馈（不伪造已停止）' } : {}),
          })
          // 「之后仍可继续操作」：在输入区里打一段字（不发送），确认还能编辑；再清空。
          if (finalState.composerCount > 0 && finalState.composerEditable === true) {
            const composer = ctx.page.locator('textarea:visible, [contenteditable="true"]:visible').first()
            try {
              await composer.click({ timeout: 5_000 })
              await composer.type('停止后仍可输入', { timeout: 5_000 })
              await ctx.settle(300)
              const typed = await readConversationState(ctx)
              after.operable = typed.composerCount > 0
              await composer.fill('').catch(() => {})
            } catch (error) {
              ctx.note(`停止后输入区操作失败：${oneLine(error?.message ?? error)}`)
              after.operable = false
            }
          }
          await ctx.shot('06-after-stop-operable.png')
        }
      }

      const observations = {
        panel,
        submit: { clicked, busySeen: busy.seen, busyLabel: busy.label },
        conversation,
        stop,
        after,
        conversationBody: conversationState?.bodyExcerpt ?? '',
      }
      return {
        status: decideStopOutcome(observations),
        observations: {
          panel,
          submit: { clicked, busySeen: busy.seen, busyLabel: busy.label },
          conversation: { reached: conversation.reached, completedBeforeCheck: conversation.completedBeforeCheck },
          stop: { consultEntry: stop.consultEntry, seen: stop.seen, clicked: stop.clicked },
          after: { feedback: after.feedback, operable: after.operable },
          headline: `会话面板=${conversation.reached ? '到达' : '未到达'}；停止入口=${stop.seen ? '可见' : '未见'}；`
            + `已点击=${stop.clicked}；终止反馈=${after.feedback}；之后可操作=${after.operable}`,
        },
      }
    },
  },
}
