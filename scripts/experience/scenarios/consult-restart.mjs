#!/usr/bin/env node
/**
 * `scripts/experience/scenarios/consult-restart.mjs` —— **重启后找回**（Spec 04 · 票 #80 / E07）。
 *
 * 验的是一件和「异常态」完全不同的能力：**跨进程持久化**。
 *   记录一轮问事 → 停掉实例（保留 home）→ 起同一个 home 的新实例 → 从真实历史入口把这条记录找回来，
 *   比对内容是否一致、追问入口给什么。认证必须**重新握手**（新 token → 新 cookie），
 *   不能靠「关掉浏览器再打开」冒充重启。
 *
 * 两条边界必须写清（否则会把「没保证的事」误判成缺陷）：
 *   1. **已落盘会话**：重启后必须找得回、内容一致、可继续（本场景的判定对象）；
 *   2. **未提交草稿**：只存在内存里，重启后**不保证**保留（ADR-0017 第 9 条 / 设计权威 §13）。
 *      草稿丢了**不是缺陷**——`describeDraftBoundary` 把这句话变成结构，判定不使用它。
 *
 * 三条硬边界（ADR-0017 第 3 条，本文件一次都不许破）：
 *   1. **不用强制点击**：点不动就记「点不动」，那是发现；强制点击会把真实阻断藏起来。
 *   2. **不用内部 RPC / fetch 代替界面**：填问题、提交、历史回看、追问全部走真实控件；本文件只读 DOM。
 *   3. **不手工按端口杀进程**：停实例只能走 runner 的实例生命周期（`ctx.restartInstance()` /
 *      `ctx.stopInstance()`）；本文件不 import 子进程模块、不按端口找进程。
 *
 * 产物：
 *   - 截图（`RESTART_SHOTS`）：重启前后各一组，文件名写死在本文件里；
 *   - `restart-boots.json`（`RESTART_BOOTS_FILE`）：两次实例的 port / 起止时间 / 时长 / 是否同 home，
 *     由 `restartBootDocument()` 生成，经 runner 的 `files` 通道落在场景子目录里。
 *
 * 仅使用 Node 内置能力（浏览器对象由 runner 注入）。ESM。
 */
import { FIXTURE } from './consult-sample.mjs'
import { dismissFirstRun, openConsult, readConsultState, sidebarRow, stableText } from './consult.mjs'

/** 场景的固定证据文件名（写死：报告与复测脚本按名字取，不许各写各的）。 */
export const RESTART_BOOTS_FILE = 'restart-boots.json'

/** 本轮重启场景问的问题：与 E03/E06 用的那句不同，人看证据时能分清是哪一轮。 */
export const RESTART_QUESTION = '这周六上午只有两小时，木工练习先做哪三步？'

/** 未提交草稿：只用于验证「不保证保留」这条边界，**不提交**。 */
export const RESTART_DRAFT = '这是一段未提交的草稿：重启后它不保证还在。'

/** 重启前后两轮取证的截图名（写死在本文件里；`decideRestartOutcome` 只引用真的落过的那些）。 */
export const RESTART_SHOTS = Object.freeze({
  boot1FirstRun: '00-boot1-first-run.png',
  boot1HistoryBefore: '01-boot1-history-before.png',
  boot1Question: '02-boot1-question.png',
  boot1Terminal: '03-boot1-terminal.png',
  boot1HistoryAfter: '04-boot1-history-after.png',
  boot1Reader: '05-boot1-reader.png',
  boot1Draft: '06-boot1-draft.png',
  boot2FirstPaint: '07-boot2-first-paint.png',
  boot2History: '08-boot2-history-list.png',
  boot2Reader: '09-boot2-reader.png',
  boot2Draft: '10-boot2-draft.png',
  boot2Continue: '11-boot2-continue.png',
  boot2ContinueError: '11b-boot2-continue-error.png',
  boot2Final: '12-boot2-final.png',
})

const CONSULT = '[data-xuanshu-panel="consult"]'
const HISTORY_VIEW = '[data-xuanshu-view="history-list"]'
const READER_VIEW = '[data-xuanshu-view="reader"]'
const QUESTION_FIELD = 'textarea[data-xuanshu-field="consult-question"]'
const START_ACTION = '[data-xuanshu-action="start-consult"]'
const TOGGLE_HISTORY = '[data-xuanshu-action="toggle-history"]'
const BACK_LOBBY = '[data-xuanshu-action="back-lobby"]'
const BACK_LIST = '[data-xuanshu-action="back-list"]'
const CONTINUE_ACTION = '[data-xuanshu-action="continue-consult"]'
const OPEN_SESSION_ERROR = '[data-xuanshu-error="open-session"]'

/** 一般操作上限（计划 §9.3：15s）。 */
const ACTION_TIMEOUT_MS = 15_000
/** AI 终态预算（计划 §9.3：120s）。 */
const AI_BUDGET_MS = 120_000
/** 记录内容稳定的判定：连续两次读取逐条一致才算「写完」，避免把流式中间态当成终态。 */
const STABLE_READS_NEEDED = 2
/** 两次读取之间的间隔：AI 流式输出时给模型一点时间，别把中间态读成终态。 */
const STABLE_INTERVAL_MS = 2_000

/** 把一段文案压成一行（步骤行只给一行；细节留给截图与 findings）。 */
function oneLine(text, limit = 200) {
  return stableText(text, limit)
}

// ── 纯函数（零浏览器）：把「证据」与「判定」变成可测的结构 ────────────────────────

/**
 * 认证重新握手的证据结构（票 #80 AC2）。
 *
 * 为什么只留 cookie **个数**、连名字都不留：个数能说明「新 origin 拿到了会话 cookie」；
 * 名字是每台机器/每次握手都不同的认证标识（`dsh-auth-…`），对读者没有信息量，却属于
 * 「不该进报告」的那类材料。值更不进来——报告与截图会被分享（与 `sanitizeUrl` 同一个理由）。
 *
 * @param {{port?: number, urlAfterLoad?: string, cookieCount?: number, cookieNames?: string[], appLoaded?: boolean}} input
 * @returns {{port: number|null, tokenInUrl: boolean, cookieCount: number, appLoaded: boolean, succeeded: boolean}}
 */
export function describeHandshake({ port, urlAfterLoad = '', cookieCount, cookieNames, appLoaded = false } = {}) {
  const count = Number.isInteger(cookieCount) && cookieCount >= 0
    ? cookieCount
    : (Array.isArray(cookieNames) ? cookieNames.filter((name) => typeof name === 'string' && name.trim() !== '').length : 0)
  return {
    port: Number.isInteger(port) ? port : null,
    tokenInUrl: /(?:[?&#])token=/u.test(String(urlAfterLoad)),
    cookieCount: count,
    appLoaded: appLoaded === true,
    succeeded: count > 0 && appLoaded === true,
  }
}

/**
 * 「已落盘会话 vs 未提交草稿」的保留承诺（票 #80 AC4）。
 *
 * 设计权威只保证**已落盘会话**；未提交草稿在内存里，进程一停就没了。所以：
 *   - `promise` 恒为 `not-guaranteed`；
 *   - `isDefect` 恒为 `false`——草稿丢了不是缺陷，草稿意外还在也不是违约（多留不是承诺）。
 *
 * @param {{typedBeforeRestart?: boolean, retainedAfterRestart?: boolean|null}} input
 * @returns {{typedBeforeRestart: boolean, retainedAfterRestart: boolean, promise: 'not-guaranteed', isDefect: false}}
 */
export function describeDraftBoundary({ typedBeforeRestart = false, retainedAfterRestart = null } = {}) {
  return {
    typedBeforeRestart: typedBeforeRestart === true,
    retainedAfterRestart: retainedAfterRestart === true,
    promise: 'not-guaranteed',
    isDefect: false,
  }
}

/** 一条消息归一成可比较的骨架（阅读器渲染的换行/多空格不算内容变化）。 */
function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages.map((message) => ({
    role: String(message?.role ?? ''),
    source: String(message?.source ?? ''),
    text: String(message?.text ?? '').replace(/\s+/gu, ' ').trim(),
  }))
}

/**
 * 比对重启前后的同一条记录（票 #80 AC3）。
 *
 * 口径是**逐条消息**（角色 / 来源 / 文本）与条数都一致；只看「有没有字」会把少一条、
 * 换了角色、文本被截断都放过。消息顺序也参与比较：阅读器的顺序就是人看到的顺序。
 *
 * @param {{messages?: object[]}} first 重启前
 * @param {{messages?: object[]}} second 重启后
 * @returns {{messageCount: number, secondMessageCount: number, sameCount: boolean, sameMessages: boolean, equal: boolean}}
 */
export function compareRecordContent(first, second) {
  const left = normalizeMessages(first?.messages)
  const right = normalizeMessages(second?.messages)
  const sameCount = left.length === right.length
  const sameMessages = sameCount && left.every((message, index) => (
    message.role === right[index].role
    && message.source === right[index].source
    && message.text === right[index].text
  ))
  return {
    messageCount: left.length,
    secondMessageCount: right.length,
    sameCount,
    sameMessages,
    equal: sameCount && sameMessages,
  }
}

/**
 * `restart-boots.json` 的形状（票 #80 AC5/AC6）。
 *
 * 它回答的是：「这两次实例是不是同一个 home、是不是先停后起、每次活了多久、端口关没关」。
 * 有它 + 起止两份环境快照，才能说「这是新进程」，而不是「关了个浏览器又打开」。
 *
 * @param {{home?: string, boots?: object[], previousPortClosed?: boolean|null}} input
 * @returns {object}
 */
export function restartBootDocument({ home = '', boots = [], previousPortClosed = null } = {}) {
  const rows = (Array.isArray(boots) ? boots : []).map((boot) => ({
    boot: Number.isInteger(boot?.boot) ? boot.boot : null,
    port: Number.isInteger(boot?.port) ? boot.port : null,
    home: typeof boot?.home === 'string' ? boot.home : home,
    keepHome: boot?.keepHome === true,
    startedAt: typeof boot?.startedAt === 'string' ? boot.startedAt : null,
    stoppedAt: typeof boot?.stoppedAt === 'string' ? boot.stoppedAt : null,
    durationMs: Number.isFinite(boot?.durationMs) ? boot.durationMs : null,
    portClosed: boot?.portClosed === null || boot?.portClosed === undefined ? null : boot.portClosed === true,
  }))
  const homes = rows.map((row) => row.home)
  const ports = rows.map((row) => row.port)
  return {
    schema: 'xuanshu/experience-restart-boots@1',
    home: home === '' ? (rows[0]?.home ?? '') : home,
    bootCount: rows.length,
    restarted: rows.length >= 2,
    sameHome: rows.length >= 2 && homes.every((value) => value === homes[0]),
    distinctPorts: rows.length >= 2 && new Set(ports).size === ports.length,
    previousPortClosed: previousPortClosed === true,
    boots: rows,
  }
}

/**
 * E07 的终点归类（纯函数，零浏览器）。
 *
 * 口径来自票 #80：
 *   - 环境 / 编排缺前置（面板打不开、两次实例没起来、不是同一个 home、旧端口没关、认证没握手、
 *     第一段没留下可读记录）→ `blocked`：这些不是 E07 要判的产品缺陷；
 *   - 重启后找不到、不是同一条、内容不一致、没有追问入口、追问进不去同一会话 → `fail`（带证据）；
 *   - 全部成立 → `pass`。
 *
 * **草稿不参与判定**：`draft` 只进摘要与观测（`describeDraftBoundary` 已把「不算缺陷」写死）。
 *
 * @param {object} observations
 * @returns {{status: 'pass'|'fail'|'blocked', evidence?: string, reason?: string, summary: string, observed: object}}
 */
export function decideRestartOutcome(observations = {}) {
  const panel = observations.panel ?? { opened: false, attempts: 0 }
  const boot = observations.boot ?? {}
  const handshake = observations.handshake ?? { succeeded: false }
  const recorded = observations.recorded ?? { created: false, readable: false }
  const recovered = observations.recovered ?? { found: false }
  const continueEntry = observations.continueEntry ?? { clicked: false, sameSession: false, errorText: '' }
  const draft = observations.draft ?? describeDraftBoundary({})

  /** 只列**真的落过**的截图与证据文件：指向不存在的图，读者会以为有证据。 */
  const evidenceOf = (extra) => {
    const shots = []
    if (panel.opened === true) shots.push(RESTART_SHOTS.boot1FirstRun)
    if (recorded.foundInHistory === true) shots.push(RESTART_SHOTS.boot1HistoryBefore)
    if (recorded.questionPresent === true) shots.push(RESTART_SHOTS.boot1Question)
    if (recorded.terminal !== undefined && recorded.terminal !== 'none') shots.push(RESTART_SHOTS.boot1Terminal)
    if (recorded.created === true) shots.push(RESTART_SHOTS.boot1HistoryAfter, RESTART_SHOTS.boot1Reader)
    if (draft.typedBeforeRestart === true) shots.push(RESTART_SHOTS.boot1Draft)
    if (boot.secondStarted === true) shots.push(RESTART_SHOTS.boot2FirstPaint, RESTART_SHOTS.boot2History)
    if (recovered.found === true) shots.push(RESTART_SHOTS.boot2Reader)
    if (draft.typedBeforeRestart === true) shots.push(RESTART_SHOTS.boot2Draft)
    if (continueEntry.clicked === true) {
      shots.push(RESTART_SHOTS.boot2Continue)
      if (continueEntry.sameSession !== true) shots.push(RESTART_SHOTS.boot2ContinueError)
    }
    if (boot.finalStopped === true) shots.push(RESTART_SHOTS.boot2Final)
    shots.push(RESTART_BOOTS_FILE)
    if (typeof extra === 'string' && extra !== '') shots.push(extra)
    // 两种保留承诺写进**每一条**证据串（不只是通过的路径）：覆盖表的读者要能分清
    // 「已落盘会话找回了」与「未提交草稿没保留（不算缺陷）」，后者不能借失败路径溜走。
    shots.push(draft.typedBeforeRestart === true
      ? `保留承诺：已落盘会话须找回；未提交草稿重启后保留=${draft.retainedAfterRestart === true}（不保证，不算缺陷）`
      : '保留承诺：已落盘会话须找回；未提交草稿不保证保留（本轮未填入草稿，不参与判定）')
    return shots.join(' / ')
  }

  const observed = {
    boots: Number.isInteger(boot.bootCount) ? boot.bootCount : null,
    sameHome: boot.sameHome === true,
    previousPortClosed: boot.previousPortClosed === true,
    handshakeSucceeded: handshake.succeeded === true,
    cookieCount: Number.isInteger(handshake.cookieCount) ? handshake.cookieCount : 0,
    recorded: recorded.created === true,
    recordedReadable: recorded.readable === true,
    recordedAnswerPresent: recorded.answerPresent === true,
    recovered: recovered.found === true,
    sameRecord: recovered.sameShortId === true,
    contentEqual: recovered.contentEqual === true,
    continueSameSession: continueEntry.sameSession === true,
    draftRetainedAfterRestart: draft.retainedAfterRestart === true,
    draftPromise: draft.promise ?? 'not-guaranteed',
  }

  if (panel.opened !== true) {
    return {
      status: 'blocked',
      reason: `问事面板没打开（试了 ${panel.attempts ?? 0} 次）——环境缺前置，不记成产品缺陷`,
      summary: '问事面板不可达',
      observed,
    }
  }
  if (recorded.created !== true) {
    return {
      status: 'blocked',
      reason: '第一段没有产生可找回的记录（开会话 / 发问事没走完）：没有可验的跨进程持久化对象',
      summary: '第一段没有留下记录',
      observed,
    }
  }
  if (recorded.readable !== true) {
    return {
      status: 'blocked',
      reason: '第一段的记录没能从历史入口读出来：无法建立重启前后的内容对照基线',
      summary: '重启前的基线读不出来',
      observed,
    }
  }
  if (recorded.answerPresent !== true) {
    return {
      status: 'blocked',
      reason: '第一段的 AI 产物没有在 120s 内出现（服务/模型没返回完整一轮）：没有可对照的完整内容，先记环境',
      summary: 'AI 产物超时未完成',
      observed,
    }
  }
  if (boot.firstStarted !== true || boot.secondStarted !== true) {
    return {
      status: 'blocked',
      reason: `第二次实例没起来（boots=${observed.boots ?? 0}）——重启编排没完成，不是 E07 的产品结论`,
      summary: '新实例没起来',
      observed,
    }
  }
  if (boot.sameHome !== true) {
    return {
      status: 'blocked',
      reason: '两次实例不是同一个 home：那是两次不同现场，证不了跨进程持久化',
      summary: '两次不是同一个 home',
      observed,
    }
  }
  if (boot.previousPortClosed !== true) {
    return {
      status: 'blocked',
      reason: '第一个实例的端口没有确认关闭：证据看不出「先停后起」，不能拿它冒充新进程',
      summary: '旧端口没有确认关闭',
      observed,
    }
  }
  if (handshake.succeeded !== true) {
    return {
      status: 'blocked',
      reason: `新实例认证没有重新握手成功（新 origin 的 cookie=${observed.cookieCount} 个、页面已加载=${handshake.appLoaded === true}）`,
      summary: '认证没有重新握手',
      observed,
    }
  }
  if (recovered.found !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf(`重启后历史里找不到同一条记录（短 id=${recorded.shortId ?? '未知'}）`),
      summary: '重启后历史里找不到那条记录',
      observed,
    }
  }
  if (recovered.sameShortId !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf('点开的记录短 id 与重启前不是同一条'),
      summary: '找回的不是同一条记录',
      observed,
    }
  }
  if (recovered.contentEqual !== true) {
    return {
      status: 'fail',
      evidence: evidenceOf(`重启前后消息条数/内容不一致（前 ${recorded.messageCount ?? '?'} 条 / 后 ${recovered.messageCount ?? '?'} 条）`),
      summary: '同一条记录但内容不一致',
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
      evidence: evidenceOf(`「继续这次问事」没有进入同一会话：${oneLine(continueEntry.errorText ?? '没有可读原因', 120)}`),
      summary: `追问入口失败：${oneLine(continueEntry.errorText ?? '没有可读原因', 80)}`,
      observed,
    }
  }
  const draftLine = draft.retainedAfterRestart === true
    ? '未提交草稿意外仍在（不保证保留，多留不算缺陷）'
    : '未提交草稿重启后不在（本来就不保证，不算缺陷）'
  return {
    status: 'pass',
    evidence: evidenceOf(`同一条记录、内容逐条一致、追问进入同一会话；${draftLine}`),
    summary: `重启后找回同一条记录且内容一致、可继续；${draftLine}`,
    observed,
  }
}

// ── 浏览器侧：读 DOM（只读，不做判定） ──────────────────────────────────────────

/** 读历史列表的每一行（完整 sessionId + 短 id + 标题）。 */
function readHistoryRows(page) {
  return page.evaluate((panel) => {
    const root = document.querySelector(panel)
    if (root === null) return []
    return [...root.querySelectorAll('[data-xuanshu-row]')].map((row) => ({
      sessionId: row.getAttribute('data-xuanshu-row') ?? '',
      shortId: (row.querySelector('.xs-consult__shortid')?.textContent ?? '').trim(),
      title: (row.querySelector('.xs-consult__row-title')?.textContent ?? '').replace(/\s+/gu, ' ').trim(),
      visible: row.getBoundingClientRect().width > 0,
    })).filter((row) => row.sessionId !== '')
  }, CONSULT)
}

/** 读阅读器当前快照（消息 / 短 id / 错误条）。 */
function readReader(page) {
  return page.evaluate((panel) => {
    const root = document.querySelector(panel)
    const reader = root === null ? null : root.querySelector('[data-xuanshu-view="reader"]')
    if (reader === null) return { present: false, shortId: '', title: '', messages: [], error: '' }
    return {
      present: true,
      shortId: (reader.querySelector('.xs-consult__shortid')?.textContent ?? '').trim(),
      title: (reader.querySelector('.xs-consult__row-title')?.textContent ?? '').trim(),
      messages: [...reader.querySelectorAll('[data-xuanshu-message]')].map((node) => ({
        role: node.getAttribute('data-xuanshu-message') ?? '',
        source: node.querySelector('[data-xuanshu-source]')?.getAttribute('data-xuanshu-source') ?? '',
        text: (node.querySelector('.xs-consult__text')?.innerText ?? '').replace(/\s+/gu, ' ').trim(),
      })),
      error: (reader.querySelector('[data-xuanshu-error]')?.innerText ?? '').replace(/\s+/gu, ' ').trim(),
    }
  }, CONSULT)
}

/** 把阅读器快照归一成判定用的字段（消息原文只留在本地，不进报告）。 */
function summarizeRecord(reader) {
  const messages = Array.isArray(reader?.messages) ? reader.messages : []
  return {
    readerShortId: reader?.shortId ?? '',
    messages,
    error: reader?.error ?? '',
    questionPresent: messages.some((message) => message.text.includes(RESTART_QUESTION)),
    answerPresent: messages.some((message) => message.role === 'assistant' && message.text.length > 40),
    selectionPresent: messages.some((message) => message.source === 'xuanshu-consult' && message.text.includes(`【来源：谱 ${FIXTURE.puName}】`)),
  }
}

/** 从错误文本里抽短 id（`会话已建好（#consult-xxxxxxxx），但…`）；抽不到就空串。 */
function shortIdFromError(text) {
  const match = /#?consult-[0-9a-z]+/iu.exec(String(text ?? ''))
  if (match === null) return ''
  const raw = match[0]
  return raw.startsWith('#') ? raw : `#${raw}`
}

/** 读问事门厅的输入框当前值（读不到 = null：读不到不是「空」）。 */
async function readQuestionValue(ctx) {
  const box = ctx.page.locator(`${CONSULT} ${QUESTION_FIELD}`).first()
  if ((await box.count()) === 0) return null
  return box.inputValue().catch(() => null)
}

/** 打开问事面板并回到门厅（真实控件；reader / history 都先退回去）。 */
async function openConsultLobby(ctx) {
  ctx.log('正在等：问事面板（侧栏真实入口）')
  const entry = await openConsult(ctx)
  if (!entry.opened) return { opened: false, attempts: entry.attempts }
  if ((await ctx.page.locator(READER_VIEW).count()) > 0) {
    const back = ctx.page.locator(`${CONSULT} ${BACK_LIST}`).first()
    if ((await back.count()) > 0) {
      await back.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {})
      await ctx.settle(600)
    }
  }
  if ((await ctx.page.locator(HISTORY_VIEW).count()) > 0) {
    const back = ctx.page.locator(`${CONSULT} ${BACK_LOBBY}`).first()
    if ((await back.count()) > 0) {
      await back.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {})
      await ctx.settle(600)
    } else {
      const toggle = ctx.page.locator(`${CONSULT} ${TOGGLE_HISTORY}`).first()
      if ((await toggle.count()) > 0) {
        await toggle.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {})
        await ctx.settle(600)
      }
    }
  }
  return { opened: true, attempts: entry.attempts }
}

/** 打开历史列表（真实「历史回看」入口），返回行数据。 */
async function openHistory(ctx, { shot } = {}) {
  if ((await ctx.page.locator(READER_VIEW).count()) > 0) {
    const back = ctx.page.locator(`${CONSULT} ${BACK_LIST}`).first()
    if ((await back.count()) > 0) {
      await back.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {})
      await ctx.settle(600)
    }
  }
  if ((await ctx.page.locator(HISTORY_VIEW).count()) === 0) {
    const toggle = ctx.page.locator(`${CONSULT} ${TOGGLE_HISTORY}`).first()
    if ((await toggle.count()) === 0) return { opened: false, rows: [], reason: '问事面板里没有「历史回看」入口' }
    await toggle.click({ timeout: ACTION_TIMEOUT_MS })
    await ctx.settle(800)
  }
  const deadline = Date.now() + ACTION_TIMEOUT_MS
  while (Date.now() < deadline) {
    const loading = await ctx.page.locator(`${CONSULT} [data-xuanshu-state="loading"]`).count()
    if ((await ctx.page.locator(HISTORY_VIEW).count()) > 0 && loading === 0) break
    await ctx.settle(300)
  }
  const rows = await readHistoryRows(ctx.page)
  if (shot !== undefined) await ctx.shot(shot)
  return { opened: (await ctx.page.locator(HISTORY_VIEW).count()) > 0, rows }
}

/**
 * 从历史列表点开**指定的一条**（按完整 sessionId 匹配，不点第一条旧记录冒充）。
 *
 * 关键时序：`[data-xuanshu-view="reader"]` 容器**先**出现，`consult.read` 的回包**后**到。
 * 只等容器就立刻读 DOM，会把「还在加载」读成「没有消息」——第一轮真跑就撞到过：
 * 重启后阅读器明明有内容，脚本却读成 0 条，差点把内容一致判成 false。
 * 所以这里等的是「加载态消失 + 有消息或错误」，不是「容器出现」。
 */
async function openRecordOnce(ctx, sessionId) {
  const history = await openHistory(ctx)
  if (!history.opened) return { opened: false, found: false, reason: history.reason ?? '历史列表打不开', rows: [] }
  const row = history.rows.find((candidate) => candidate.sessionId === sessionId)
  if (row === undefined) return { opened: true, found: false, rows: history.rows }
  const target = ctx.page.locator(`${CONSULT} [data-xuanshu-row="${sessionId}"]`).first()
  await target.click({ timeout: ACTION_TIMEOUT_MS })
  const deadline = Date.now() + ACTION_TIMEOUT_MS
  let reader = { present: false, shortId: '', title: '', messages: [], error: '' }
  while (Date.now() < deadline) {
    reader = await readReader(ctx.page)
    if (reader.present === true) {
      const loading = await ctx.page.locator(`${CONSULT} ${READER_VIEW} [data-xuanshu-state="loading"]`).count()
      if (reader.messages.length > 0 || reader.error !== '' || loading === 0) break
    }
    await ctx.settle(200)
  }
  return { opened: true, found: true, row, reader }
}

/**
 * 反复「列表 → 阅读器」直到内容稳定（连续 `STABLE_READS_NEEDED` 次逐条一致），或者超时。
 *
 * 为什么不能读一次就信：阅读器是**打开那一刻的快照**，AI 还在跑时它不会自己长出助手消息；
 * 而流式输出的中间态又会让两次读取不一致。判「内容一致」前必须确认它已经写完。
 */
async function waitForStableRecord(ctx, { sessionId, shot, budgetMs = AI_BUDGET_MS }) {
  const deadline = Date.now() + budgetMs
  let last = null
  let lastRow = null
  let stableCount = 0
  let stable = false
  while (Date.now() < deadline) {
    const attempt = await openRecordOnce(ctx, sessionId)
    if (attempt.found !== true) {
      await ctx.settle(STABLE_INTERVAL_MS)
      continue
    }
    lastRow = attempt.row
    const state = summarizeRecord(attempt.reader)
    state.sameShortId = attempt.row.shortId === attempt.reader.shortId
    if (state.questionPresent && state.answerPresent && last !== null && compareRecordContent(last, state).equal) {
      stableCount += 1
      if (stableCount >= STABLE_READS_NEEDED) {
        stable = true
        last = state
        break
      }
    } else {
      stableCount = 0
    }
    last = state
    await ctx.settle(STABLE_INTERVAL_MS)
  }
  if (last === null) {
    const attempt = await openRecordOnce(ctx, sessionId)
    if (attempt.found === true) {
      lastRow = attempt.row
      last = summarizeRecord(attempt.reader)
      last.sameShortId = attempt.row.shortId === attempt.reader.shortId
    } else {
      last = summarizeRecord(null)
      last.sameShortId = false
    }
  }
  await ctx.shot(shot)
  return {
    ...last,
    found: lastRow !== null,
    rowShortId: lastRow?.shortId ?? '',
    stable,
    timedOut: !stable,
  }
}

/** 读某个 origin 的 cookie 个数（**只回个数**：名字与值都不进证据）。 */
async function readCookieCount(context, port) {
  try {
    const cookies = await context.cookies(`http://127.0.0.1:${port}`)
    return cookies.length
  } catch {
    return 0
  }
}

/** 等问事终态：可读错误 / 切进会话 / 超时未完成。 */
async function waitTerminal(ctx) {
  const deadline = Date.now() + AI_BUDGET_MS
  let lastBeat = Date.now()
  while (Date.now() < deadline) {
    const state = await readConsultState(ctx.page)
    if (state.errorBlocks.length > 0) {
      return {
        kind: 'error',
        text: state.errorBlocks.map((block) => block.text).join(' / '),
        inViewport: state.errorBlocks.some((block) => block.inViewport),
      }
    }
    if (!state.consultPresent) return { kind: 'session', text: '', inViewport: null }
    if (Date.now() - lastBeat > 5_000) {
      lastBeat = Date.now()
      ctx.log(`正在等：问事终态（还剩 ${Math.max(0, Math.round((deadline - Date.now()) / 1000))}s）`)
    }
    await ctx.settle(500)
  }
  ctx.log('超时未完成：120s 内没有问事终态（已保留当时画面）')
  return { kind: 'timeout', text: '', inViewport: null }
}

/** 在问事门厅勾选测试谱（真实 checkbox；勾不上就如实记，不硬来）。 */
async function selectFixturePu(ctx) {
  const deadline = Date.now() + ACTION_TIMEOUT_MS
  let label = null
  while (Date.now() < deadline) {
    const candidate = ctx.page.locator(`${CONSULT} label`).filter({ hasText: FIXTURE.puName }).first()
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      label = candidate
      break
    }
    await ctx.settle(300)
  }
  if (label === null) return { found: false, checked: false }
  const checkbox = label.locator('input[type="checkbox"]').first()
  if ((await checkbox.count()) === 0) return { found: true, checked: false }
  if (!(await checkbox.isChecked().catch(() => false))) {
    await checkbox.check({ timeout: ACTION_TIMEOUT_MS })
    await ctx.settle(500)
  }
  return { found: true, checked: await checkbox.isChecked().catch(() => false) }
}

// ── 场景定义 ────────────────────────────────────────────────────────────────

/** 把观测裁成报告读者需要的字段（消息原文与一次性 id 不进 findings）。 */
function reportOf(observations) {
  return {
    panel: observations.panel ?? { opened: false, attempts: 0 },
    boot: observations.boot ?? {},
    handshake: observations.handshake ?? {},
    recorded: observations.recorded ?? {},
    recovered: observations.recovered ?? {},
    continueEntry: observations.continueEntry ?? {},
    draft: observations.draft ?? describeDraftBoundary({}),
    headline: observations.headline ?? '',
  }
}

/**
 * 收尾：停掉最后一个实例（保留 home）→ 汇总两次 boot → 判定 → 交回场景结果。
 *
 * 停实例放在场景里而不是只靠 runner 的 finally：`restart-boots.json` 要写第二次 boot 的
 * 停止时间与时长；先停再写，这份记录才是真的（不是「预计它会被停」）。
 */
async function finish(ctx, observations) {
  const stopped = await ctx.stopInstance()
  const previousPortClosed = observations.previousPortClosed ?? null
  const bootDocument = restartBootDocument({
    home: ctx.boots[0]?.home ?? '',
    boots: ctx.boots,
    previousPortClosed,
  })
  const current = ctx.boots.at(-1)
  const boot = {
    bootCount: ctx.boots.length,
    firstStarted: ctx.boots.length >= 1,
    secondStarted: ctx.boots.length >= 2,
    firstStopped: ctx.boots.length >= 1 && ctx.boots[0].stoppedAt !== null,
    sameHome: bootDocument.sameHome,
    previousPortClosed: bootDocument.previousPortClosed,
    distinctPorts: bootDocument.distinctPorts,
    finalStopped: current !== undefined && current.stoppedAt !== null && current.portClosed === true,
  }
  const full = { ...observations, boot: { ...(observations.boot ?? {}), ...boot } }
  if (typeof full.headline === 'string' && full.headline !== '') {
    full.headline += `；同 home=${boot.sameHome}；先停后起=${boot.firstStopped === true && boot.secondStarted === true}`
  }
  const decision = decideRestartOutcome(full)
  ctx.step({
    action: '停掉最后一个实例（保留 home）',
    target: 'instance',
    outcome: current === undefined
      ? '没有可停的实例'
      : `boot ${current.boot} port=${current.port} 已关=${stopped.portClosed === true}；home 保留=${current.keepHome === true}`,
  })
  return {
    status: decision,
    observations: reportOf(full),
    files: { [RESTART_BOOTS_FILE]: bootDocument },
  }
}

export const RESTART_SCENARIOS = {
  'consult-restart': {
    id: 'consult-restart',
    caseId: 'E07',
    title: '重启后找回：记录一轮问事 → 停实例保 home → 起同一 home 的新实例 → 历史找回并继续',
    shots: Object.values(RESTART_SHOTS),
    /**
     * 一轮问事的完整跨进程往返。
     *
     * 为什么在同一场景里做两次起停：票 #80 验的是「进程没了再回来」。拆成两条场景虽然也能跑，
     * 但「重启前的基线」与「重启后的对照」会隔一次执行，中间无法证明停的是同一条记录所在的 home。
     * 编排仍走 runner 的实例生命周期（`ctx.restartInstance()`），本文件不碰进程表。
     */
    async run(ctx) {
      const observations = {
        panel: { opened: false, attempts: 0 },
        previousPortClosed: null,
      }

      // ① 第一次 boot：进页面、关首跑模态、打开问事。
      ctx.log('正在等：页面首屏（第一次 boot）')
      await ctx.page.goto(ctx.env.url, { waitUntil: 'domcontentloaded' })
      await ctx.settle(4_000)
      await ctx.shot(RESTART_SHOTS.boot1FirstRun)
      const firstRun = await dismissFirstRun(ctx)
      ctx.step({
        action: '第一次 boot：完成必要首跑操作（关闭首跑模态）',
        target: 'first-run-modals',
        outcome: firstRun.labels.length === 0
          ? '首屏没有出现首跑模态'
          : `关掉 ${firstRun.labels.length} 层：${firstRun.labels.join(' → ')}${firstRun.blocked ? '（遮罩还在，但认不出关闭按钮）' : ''}`,
        shot: RESTART_SHOTS.boot1FirstRun,
      })
      const lobby = await openConsultLobby(ctx)
      observations.panel = { opened: lobby.opened, attempts: lobby.attempts }
      ctx.step({
        action: '第一次 boot：点侧栏「问事」打开问事面板',
        target: CONSULT,
        outcome: lobby.opened ? `面板出现（第 ${lobby.attempts} 次点开）` : `面板没打开（试了 ${lobby.attempts} 次）`,
      })
      if (!lobby.opened) return finish(ctx, observations)

      // ② 重启前的历史基线：新记录 = 这一次之后的列表差集（不点旧记录冒充本轮结果）。
      ctx.log('正在等：第一次 boot 的历史列表（重启前基线）')
      const before = await openHistory(ctx, { shot: RESTART_SHOTS.boot1HistoryBefore })
      const beforeIds = new Set(before.rows.map((row) => row.sessionId))
      ctx.step({
        action: '第一次 boot：记录重启前的历史基线',
        target: `${CONSULT} 历史回看`,
        outcome: before.opened
          ? `历史列表 ${before.rows.length} 条；短 id：${before.rows.slice(0, 3).map((row) => row.shortId).join(' / ') || '无'}`
          : `历史回看打不开：${before.reason ?? '未知'}`,
        shot: RESTART_SHOTS.boot1HistoryBefore,
      })
      if (!before.opened) {
        observations.recorded = { created: false, readable: false, foundInHistory: false, shortId: '', questionPresent: false, answerPresent: false, terminal: 'none' }
        return finish(ctx, observations)
      }
      await openConsultLobby(ctx)

      // ③ 用真实控件记录一轮问事（勾谱 → 填问题 → 提交 → 终态）。
      const selection = await selectFixturePu(ctx)
      ctx.note(`虚构材料：谱「${FIXTURE.puName}」；本轮问题「${RESTART_QUESTION}」；未提交草稿「${RESTART_DRAFT}」（只用于验证不保证保留）。`)
      ctx.step({
        action: '第一次 boot：在问事门厅勾选测试谱',
        target: `${CONSULT} 谱勾选区`,
        outcome: selection.found
          ? `勾选「${FIXTURE.puName}」=${selection.checked}`
          : `勾选区里没有「${FIXTURE.puName}」（不阻断这一轮，但如实记）`,
      })

      const box = ctx.page.locator(`${CONSULT} ${QUESTION_FIELD}`).first()
      let filled = false
      if ((await box.count()) > 0 && (await box.isEditable().catch(() => false))) {
        await box.fill(RESTART_QUESTION, { timeout: ACTION_TIMEOUT_MS })
        filled = (await box.inputValue().catch(() => '')) === RESTART_QUESTION
      }
      await ctx.shot(RESTART_SHOTS.boot1Question)
      ctx.step({
        action: '第一次 boot：在问事输入框里填入本轮问题',
        target: QUESTION_FIELD,
        outcome: filled ? `已填入「${RESTART_QUESTION}」（尚未提交）` : '输入框不可用或填入后读不回原值',
        shot: RESTART_SHOTS.boot1Question,
      })

      let clicked = false
      let terminal = { kind: 'none', text: '', inViewport: null }
      if (filled) {
        const state = await readConsultState(ctx.page)
        const startButton = state.startButtons[0]
        if (startButton !== undefined && startButton.disabled !== true) {
          ctx.log('正在等：点「＋ 开一次问事」之后的终态（最多 120s）')
          await ctx.page.locator(`${CONSULT} ${START_ACTION}`).first().click({ timeout: ACTION_TIMEOUT_MS })
          clicked = true
          terminal = await waitTerminal(ctx)
        } else {
          ctx.note('「开一次问事」按钮禁用或不存在：按产品真实规则不强行点击')
        }
      }
      await ctx.shot(RESTART_SHOTS.boot1Terminal)
      ctx.step({
        action: '第一次 boot：提交这一轮问事并记录终态',
        target: `${CONSULT} ${START_ACTION}`,
        outcome: clicked
          ? `已点击一次；终态=${terminal.kind}${terminal.text === '' ? '' : `；提示：${oneLine(terminal.text, 120)}`}`
            + `${terminal.inViewport === false ? '；提示渲染在可视区之外' : ''}`
          : '没有提交（输入框不可用或按钮禁用）',
        shot: RESTART_SHOTS.boot1Terminal,
        ...(terminal.kind === 'timeout' ? { note: '超时未完成：已保留当时画面（03-boot1-terminal.png）' } : {}),
      })
      const errorShortId = shortIdFromError(terminal.text)

      // ④ 找到刚建好的那一条：新行差集优先，错误文案里的短 id 兜底。
      ctx.log('正在等：第一次 boot 的历史列表（找出刚建好的那一条）')
      const after = await openHistory(ctx, { shot: RESTART_SHOTS.boot1HistoryAfter })
      const newRows = after.rows.filter((row) => !beforeIds.has(row.sessionId))
      let sessionId = null
      if (newRows.length === 1) {
        sessionId = newRows[0].sessionId
      } else if (errorShortId !== '') {
        sessionId = after.rows.find((row) => row.shortId === errorShortId)?.sessionId ?? null
      } else if (newRows.length > 1) {
        // 同时多出几条：逐条打开，按「阅读器里有本轮问题」认出这一条（真实入口，不猜）。
        for (const candidate of newRows) {
          const attempt = await openRecordOnce(ctx, candidate.sessionId)
          if (attempt.found && summarizeRecord(attempt.reader).questionPresent) {
            sessionId = candidate.sessionId
            break
          }
        }
      }
      const recordedRow = sessionId === null ? null : after.rows.find((row) => row.sessionId === sessionId)
      observations.recorded = {
        created: sessionId !== null,
        readable: false,
        foundInHistory: newRows.length > 0 || (recordedRow !== undefined && recordedRow !== null),
        shortId: recordedRow === undefined || recordedRow === null ? '' : oneLine(recordedRow.shortId, 24),
        questionPresent: false,
        answerPresent: false,
        terminal: clicked ? terminal.kind : 'none',
      }
      ctx.step({
        action: '第一次 boot：从历史入口找到刚建好的那一条',
        target: `${CONSULT} 历史回看`,
        outcome: sessionId === null
          ? `没找到新记录（列表 ${after.rows.length} 条，新增 ${newRows.length} 条，错误短 id=${errorShortId === '' ? '无' : oneLine(errorShortId, 24)}）`
          : `列表 ${after.rows.length} 条，新增 ${newRows.length} 条；本轮记录短 id=${oneLine(recordedRow?.shortId ?? '', 24)}${newRows.length === 1 ? '（差集唯一）' : ''}`,
        shot: RESTART_SHOTS.boot1HistoryAfter,
      })
      if (sessionId === null) return finish(ctx, observations)

      // ⑤ 读回这一条的内容（等它写完），作为重启前的对照基线。
      ctx.log('正在等：本轮记录的 AI 产物落定（最多 120s）')
      const recorded = await waitForStableRecord(ctx, { sessionId, shot: RESTART_SHOTS.boot1Reader, budgetMs: AI_BUDGET_MS })
      observations.recorded = {
        ...observations.recorded,
        readable: recorded.questionPresent && recorded.messages.length > 0,
        questionPresent: recorded.questionPresent,
        answerPresent: recorded.answerPresent,
        selectionPresent: recorded.selectionPresent,
        sameShortId: recorded.sameShortId === true,
        stable: recorded.stable === true,
        messageCount: recorded.messages.length,
      }
      ctx.step({
        action: '第一次 boot：读回这条记录的内容（重启前基线）',
        target: `${CONSULT} 历史回看 → 阅读器`,
        outcome: recorded.found
          ? `消息 ${recorded.messages.length} 条；原始问题在=${recorded.questionPresent}；AI 产物在=${recorded.answerPresent}；`
            + `勾选谱仍在=${recorded.selectionPresent}；内容稳定=${recorded.stable}`
          : '阅读器没能打开这条记录',
        shot: RESTART_SHOTS.boot1Reader,
      })

      // ⑥ 未提交草稿：填进输入框但**不提交**（重启后丢失是预期，不算缺陷）。
      ctx.log('正在等：填一段未提交草稿（不提交）')
      await openConsultLobby(ctx)
      let draftTyped = false
      if ((await ctx.page.locator(`${CONSULT} ${QUESTION_FIELD}`).count()) > 0) {
        await ctx.page.locator(`${CONSULT} ${QUESTION_FIELD}`).first().fill(RESTART_DRAFT, { timeout: ACTION_TIMEOUT_MS }).catch(() => {})
        draftTyped = (await readQuestionValue(ctx)) === RESTART_DRAFT
      }
      await ctx.shot(RESTART_SHOTS.boot1Draft)
      ctx.step({
        action: '第一次 boot：填入一段未提交草稿（不提交）',
        target: QUESTION_FIELD,
        outcome: draftTyped ? `输入框里有一段未提交草稿（${RESTART_DRAFT}），进程即将停止` : '草稿没能填进输入框（如实记，不硬来）',
        shot: RESTART_SHOTS.boot1Draft,
      })

      // ⑦ 重启：停旧进程保 home → 起同一个 home 的新实例（认证重新握手）。
      ctx.log('正在等：停掉第一个实例（保留 home）并起同一个 home 的新实例')
      const bootBefore = ctx.boots[0]
      const second = await ctx.restartInstance()
      observations.previousPortClosed = second.previousPortClosed === true
      const bootDocumentAfterRestart = restartBootDocument({
        home: ctx.boots[0]?.home ?? '',
        boots: ctx.boots,
        previousPortClosed: second.previousPortClosed === true,
      })
      ctx.step({
        action: '停掉第一个实例（保留 home），起同一个 home 的新实例',
        target: 'instance',
        outcome: `boot1 port=${bootBefore?.port ?? '无'} 已关=${second.previousPortClosed === true}；`
          + `boot2 port=${second.port}；同一 home=${bootDocumentAfterRestart.sameHome}；旧 home 保留=${bootBefore?.keepHome === true}`,
      })
      ctx.env.url = second.url
      ctx.env.port = second.port

      ctx.log('正在等：新实例首屏（新 token → 新 cookie）')
      await ctx.page.goto(second.url, { waitUntil: 'domcontentloaded' })
      await ctx.settle(4_000)
      await ctx.shot(RESTART_SHOTS.boot2FirstPaint)
      const appLoaded = (await ctx.page.locator('[data-xuanshu-panel]').count()) > 0
      const cookieCount = await readCookieCount(ctx.context, second.port)
      const handshake = describeHandshake({
        port: second.port,
        urlAfterLoad: ctx.page.url(),
        cookieCount,
        appLoaded,
      })
      ctx.step({
        action: '新实例：认证重新握手（新 token → 新 cookie）',
        target: 'instance',
        outcome: handshake.succeeded
          ? `新 origin cookie=${handshake.cookieCount} 个；URL 里 token 已消费=${!handshake.tokenInUrl}；页面已加载=${handshake.appLoaded}`
          : `握手未成功：cookie=${handshake.cookieCount} 个；URL 里 token 已消费=${!handshake.tokenInUrl}；页面已加载=${handshake.appLoaded}`,
        shot: RESTART_SHOTS.boot2FirstPaint,
      })
      observations.handshake = handshake
      const secondFirstRun = await dismissFirstRun(ctx)
      if (secondFirstRun.labels.length > 0) {
        ctx.note(`新实例首跑模态：${secondFirstRun.labels.join(' → ')}（同一个 home 仍可能出现的首跑操作，已照实记）`)
      }

      // ⑧ 未提交草稿：重启后读一次（只记录，不参与判定）。
      const lobby2 = await openConsultLobby(ctx)
      if (!lobby2.opened) {
        observations.recovered = { found: false, sameShortId: false, contentEqual: false, questionPresent: false, answerPresent: false, selectionPresent: false }
        return finish(ctx, observations)
      }
      const draftAfter = await readQuestionValue(ctx)
      await ctx.shot(RESTART_SHOTS.boot2Draft)
      const draft = describeDraftBoundary({ typedBeforeRestart: draftTyped, retainedAfterRestart: draftAfter !== null && draftAfter !== '' })
      observations.draft = draft
      ctx.step({
        action: '新实例：读未提交草稿（不保证保留）',
        target: QUESTION_FIELD,
        outcome: draftAfter === null
          ? '输入框不在屏上（读不到草稿）'
          : draftAfter === ''
            ? '输入框为空：未提交草稿没有保留（只保证已落盘会话，不算缺陷）'
            : `输入框里仍有内容（${oneLine(draftAfter, 60)}）：草稿意外保留（不保证，但也不构成缺陷）`,
        shot: RESTART_SHOTS.boot2Draft,
      })
      ctx.note('保留承诺：已落盘会话重启后必须找回；未提交草稿（只在内存里）不保证保留。草稿缺失不记缺陷（ADR-0017 第 9 条 / 设计权威 §13）。')

      // ⑨ 重启后从真实历史入口找回同一条记录。
      ctx.log('正在等：新实例的历史列表（找回同一条记录）')
      const history2 = await openHistory(ctx, { shot: RESTART_SHOTS.boot2History })
      const foundRow = history2.rows.find((row) => row.sessionId === sessionId) ?? null
      ctx.step({
        action: '新实例：从历史入口找回重启前那一条',
        target: `${CONSULT} 历史回看`,
        outcome: foundRow === null
          ? `历史列表 ${history2.rows.length} 条，没有重启前那条（短 id=${observations.recorded.shortId || '未知'}）`
          : `历史列表 ${history2.rows.length} 条；找到同一条（短 id=${oneLine(foundRow.shortId, 24)}）`,
        shot: RESTART_SHOTS.boot2History,
      })
      if (foundRow === null) {
        observations.recovered = { found: false, sameShortId: false, contentEqual: false, questionPresent: false, answerPresent: false, selectionPresent: false }
        return finish(ctx, observations)
      }

      ctx.log('正在等：重启后的记录内容（与重启前逐条比对）')
      const recovered = await waitForStableRecord(ctx, { sessionId, shot: RESTART_SHOTS.boot2Reader, budgetMs: 45_000 })
      const content = compareRecordContent({ messages: recorded.messages }, { messages: recovered.messages })
      observations.recovered = {
        found: recovered.found === true,
        sameShortId: recovered.sameShortId === true,
        contentEqual: content.equal === true,
        questionPresent: recovered.questionPresent,
        answerPresent: recovered.answerPresent,
        selectionPresent: recovered.selectionPresent,
        messageCount: content.secondMessageCount,
        readError: recovered.error,
      }
      ctx.step({
        action: '新实例：比对重启前后同一条记录的内容',
        target: `${CONSULT} 历史回看 → 阅读器`,
        outcome: `前 ${content.messageCount} 条 / 后 ${content.secondMessageCount} 条；逐条一致=${content.equal}；`
          + `原始问题在=${recovered.questionPresent}；AI 产物在=${recovered.answerPresent}；勾选谱仍在=${recovered.selectionPresent}`
          + `${recovered.error === '' ? '' : `；阅读器错误：${oneLine(recovered.error, 120)}`}`,
        shot: RESTART_SHOTS.boot2Reader,
      })

      // ⑩ 追问入口：产品给什么就记什么（进不去同一会话也是事实，不伪造成功）。
      const continueButton = ctx.page.locator(`${CONSULT} ${CONTINUE_ACTION}`).first()
      let continueEntry = { clicked: false, sameSession: false, errorText: '' }
      if ((await continueButton.count()) > 0) {
        ctx.log('正在等：点「继续这次问事」之后产品给什么（重启后）')
        await continueButton.click({ timeout: ACTION_TIMEOUT_MS })
        await ctx.settle(2_500)
        const state = await readConsultState(ctx.page)
        const openError = state.errorBlocks.find((block) => block.kind === 'open-session')
        const stillReader = (await ctx.page.locator(READER_VIEW).count()) > 0
        if (openError !== undefined) {
          continueEntry = { clicked: true, sameSession: false, errorText: oneLine(openError.text) }
        } else if (!state.consultPresent && !stillReader) {
          const body = await ctx.page.locator('body').innerText().catch(() => '')
          continueEntry = { clicked: true, sameSession: body.includes(RESTART_QUESTION), errorText: '' }
        } else {
          continueEntry = { clicked: true, sameSession: false, errorText: '点了之后仍停在阅读器，没有进入会话' }
        }
        await ctx.shot(RESTART_SHOTS.boot2Continue)
        if (continueEntry.sameSession !== true) {
          try {
            await ctx.page.locator(`${CONSULT} ${OPEN_SESSION_ERROR}`).first().scrollIntoViewIfNeeded({ timeout: 5_000 })
            await ctx.settle(400)
          } catch { /* 滚不动就保留当前画面 */ }
          await ctx.shot(RESTART_SHOTS.boot2ContinueError)
        }
      }
      observations.continueEntry = continueEntry
      ctx.step({
        action: '新实例：点「继续这次问事」（追问入口）',
        target: `${CONSULT} ${CONTINUE_ACTION}`,
        outcome: continueEntry.clicked
          ? continueEntry.sameSession
            ? '进入了同一会话（会话里有本轮原始问题）'
            : `没有进入同一会话：${continueEntry.errorText}`
          : '阅读器里没有「继续这次问事」入口',
        shot: RESTART_SHOTS.boot2Continue,
      })
      if (continueEntry.clicked && !continueEntry.sameSession) {
        // 如实写进 findings：重启后的追问入口仍报同一个产品错误（与 E03/E06 同一现象）。
        // 跨进程找回与内容一致是另一条事实，不因这条失败被抹掉，也不拿它抵消失败。
        ctx.note(`重启后的追问入口没有进入同一会话：「${continueEntry.errorText}」。`
          + '跨进程找回与内容一致已在同一轮验到；这一条按产品错误记 fail，不冒充通过。')
      }

      await ctx.shot(RESTART_SHOTS.boot2Final)

      // ⑪ 收尾：停实例（保 home）、汇总两次 boot、判定。
      const recordedShortId = observations.recorded.shortId || '未知'
      const bootCount = ctx.boots.length
      observations.headline = `boots=${bootCount}；握手=${handshake.succeeded}（cookie ${handshake.cookieCount} 个）；记录=${recordedShortId}；`
        + `找回同一条=${observations.recovered.sameShortId}；内容一致=${observations.recovered.contentEqual}；`
        + `追问进入同一会话=${continueEntry.sameSession}；草稿保留=${draft.retainedAfterRestart}（不保证，不算缺陷）`
      return finish(ctx, observations)
    },
  },
}
