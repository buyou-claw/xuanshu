#!/usr/bin/env node
/**
 * `scripts/ux/collect/browser-scripts.mjs` —— **任务剧本**（spec 003 §12）。
 *
 * 剧本以「任务」为单位横穿多个界面面，不按屏截图：一条剧本 = 一串人真的会做的动作 + 期望命中的判据 id。
 * 首版三条（建谱 / 问事 / 藏库）由票 07 与票 08 分批落地：剧本 1 在票 07，剧本 2 / 3 在票 08（#55）。
 *
 * 剧本的 run() 只**做事与记账**：`step()` 记动作、`measure(face)` 量该界面面此刻的可点目标、
 * `nav.*` 记导航族要的入口 / 落点 / 键盘事实。判定不在这里（那在 judge + assertions）。
 *
 * 三条剧本各自可单独跑（`scriptIds: ['register-cang']`），也能串起来跑（按给定顺序、同一个页面）。
 * 剧本 2 / 3 还支持**失败态变体**：`scriptIds: ['register-cang:missing-file']`（见每条剧本的 `scenarios`）。
 * 失败态不是异常路径，是**合法终点**：剧本照实记下它，并在步骤里写明「这一跑是故意触发失败态」。
 *
 * 已实测的事实（2026-10-31，系统 Edge + 全局 playwright）：
 *   - 首跑会连续出现**两层模态**：DSH「预览版说明」→「添加一个 API Key」；两层都关掉之后侧栏才可点；
 *   - 侧栏行是 36px 高、`xs-btn` 主按钮 32px 高 —— 都小于留白档要求的 44×44；
 *   - 「建一个谱」的五步向导在**没有模型**的干净 home 上会在第 ③ 步（AI 转换）失败。
 *     剧本因此把「预览」与「错误」都当成**合法终点**并如实记下是哪一个：失败态也是证据，不是例外；
 *   - 问事在干净 home 上**没有可选谱、没有可用会话、没有模型**：`consult.create` 建得出会话，
 *     但 `consult.send` 会被宿主的能力门拦下（「这次问事发不出去」）—— 剧本把「发不出去」当成
 *     合法终点；它同时就是「无会话可用」那条失败态的真身（`no-session` 变体只负责把它**说成**
 *     故意的，并先确认列表真的是空的）；
 *   - 藏库的登记抽屉按 Esc 关（`CangDrawer` 自己处理），关掉后焦点还给「登记藏」；
 *   - 藏库的注册表是 `<home>/xuanshu/cang/registry.jsonl`：**坏一行就整表读不出来**
 *     （宿主的 `registry.mjs` 明写「绝不静默跳过」），所以「加载失败」用临时 home 里写一行坏 JSON
 *     来真触发，而不是假装；
 *   - 挂载账本抽屉（票 12）**没有 Esc 处理、也没有焦点圈**：剧本照实记，红就红在那里。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 首跑模态的关闭按钮（按出现顺序试；找不到就说明这一层关不掉）。 */
const MODAL_DISMISS_LABELS = ['继续', '稍后配置', '知道了', '关闭', '跳过', '好的']

/** 模态关掉之后再等一会儿（DSH 客户端插件是异步挂载的）。 */
async function dismissBlockingModals({ page, settle, step }) {
  let dismissed = 0
  const seen = []
  for (let round = 0; round < 6; round += 1) {
    const maskCount = await page.evaluate(
      () => [...document.querySelectorAll('[class*="mask"]')].filter((element) => element.getBoundingClientRect().width > 0).length,
    )
    if (maskCount === 0) break
    let clicked = null
    for (const label of MODAL_DISMISS_LABELS) {
      const button = page.getByRole('button', { name: label, exact: true })
      if ((await button.count()) > 0) {
        clicked = label
        break
      }
    }
    if (clicked === null) break
    seen.push(clicked)
    await page.getByRole('button', { name: clicked, exact: true }).first().click({ force: true })
    dismissed += 1
    await settle(page, 1200)
  }
  step('dismiss-first-run-modals', { dismissed, labels: seen })
  return dismissed
}

/** 当前主面板的文字（剧本用它判「走到哪一步了」）。 */
function mainText(page) {
  return page.evaluate(() => (document.querySelector('main') ?? document.body).innerText)
}

/** 等一个终态：生成预览（成功路径）或错误态（干净 home 上最可能的结果）。
 *
 * 不能拿「生成预览」这种字去判：它出现在步骤条文案里（① 给资料 → … → ④ 生成预览），
 * 一定先命中，于是每次都会假装成功。这里只看**只在该步才存在的按钮**与状态行。 */
async function waitForTerminal({ page, timeoutMs = 20_000 }) {
  const deadline = Date.now() + timeoutMs
  let text = ''
  while (Date.now() < deadline) {
    text = await mainText(page)
    const confirm = page.getByRole('button', { name: '确认落盘', exact: true })
    const backToList = page.getByRole('button', { name: '回谱列表', exact: true })
    if ((await confirm.count()) > 0) return { outcome: 'preview', text }
    if ((await backToList.count()) > 0) return { outcome: 'written', text }
    const status = await page.evaluate(() => document.querySelector('[role="status"]')?.innerText ?? '')
    // 「中断」是状态行里的按钮字样（中断 / 中断汇总提炼），不能当失败信号 —— 实测被它误判过一次。
    if (/失败|错误|异常|无法|没有可用|未配置|转换已中断/.test(status)) return { outcome: 'error', text: `${text}\n[status] ${status}` }
    await page.waitForTimeout(700)
  }
  return { outcome: 'timeout', text }
}

/**
 * 问事的终态：开进会话（切到 DSH 会话面板）／可读错误条／超时。
 *
 * 三路都**只认只在该状态才存在的 DOM**：`data-xuanshu-error` 的两个错误块、
 * 问事面板是否还在屏上 —— 不靠文案包含匹配（「发不出去」那句里还嵌着宿主的原始错误）。
 */
async function waitConsultTerminal({ page, timeoutMs = 25_000 }) {
  const deadline = Date.now() + timeoutMs
  let text = ''
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const block = (kind) => document.querySelector(`[data-xuanshu-error="${kind}"]`)?.innerText ?? ''
      return {
        consult: document.querySelector('[data-xuanshu-panel="consult"]') !== null,
        create: block('create'),
        openSession: block('open-session'),
        body: document.body.innerText,
      }
    })
    if (state.create !== '') return { outcome: 'error', kind: 'create', text: state.create }
    if (state.openSession !== '') return { outcome: 'error', kind: 'open-session', text: state.openSession }
    if (!state.consult) return { outcome: 'session', kind: 'navigated', text: state.body.slice(0, 200) }
    text = state.body
    await page.waitForTimeout(600)
  }
  return { outcome: 'timeout', kind: 'timeout', text }
}

/** 把一段文案压成一行（步骤记录只给一行，细节留给证据）。 */
function oneLine(text, limit = 240) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

/** 等某个选择器的文字满足条件（超时返回最后读到的文字，不抛）。 */
async function waitForText(page, selector, test, { timeoutMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let text = ''
  while (Date.now() < deadline) {
    text = await page.evaluate((css) => document.querySelector(css)?.innerText ?? '', selector)
    if (test(text)) return text
    await page.waitForTimeout(400)
  }
  return text
}

/** 有没有可见的 `role="dialog"`。 */
function hasDialog(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    return [...document.querySelectorAll('[role="dialog"]')].some(visible)
  })
}

/** 等抽屉出现（点开抽屉之后 RPC / 渲染都可能有延迟；超时返回 false，不抛）。 */
async function waitForDialog(page, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await hasDialog(page)) return true
    await page.waitForTimeout(300)
  }
  return false
}

/**
 * 从侧栏打开一个面板，**失败就再来一次**（首跑模态偶发只关掉一层：侧栏点了没反应）。
 *
 * 为什么不让剧本自己硬点一次就算了：实测在干净 home 上「预览说明」与「API Key」两层模态
 * 有时隔一拍才出现，第二层会盖住侧栏 —— 一次点击就静默落空，然后整条剧本在下一步超时，
 * 报告里看起来像「面板坏了」。重试 + 记录尝试次数，把「这次环境不顺」与「界面真的打不开」分开。
 *
 * @returns {Promise<{visible: boolean, attempts: number}>}
 */
async function openPanel({ page, settle, step, label, selector }) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const row = page.getByRole('button', { name: label, exact: true }).first()
    if ((await row.count()) > 0) await row.click({ force: true })
    await page.locator(selector).first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {})
    if ((await page.locator(selector).count()) > 0) return { visible: true, attempts: attempt }
    await dismissBlockingModals({ page, settle, step })
    await settle(page, 800)
  }
  return { visible: false, attempts: 3 }
}

/** 问事面板的选择器（剧本 2 反复用）。 */
const CONSULT = '[data-xuanshu-panel="consult"]'
/** 藏库面板的选择器（剧本 3 反复用）。 */
const CANG = '[data-xuanshu-panel="cang"]'
/** 藏库登记抽屉（`shell.overlay` 里标题 id 是它的那一个）。 */
const CANG_DRAWER = '[role="dialog"][aria-labelledby="xs-cang-drawer-title"]'
/** 挂载账本抽屉（票 12）。 */
const MOUNTS_DRAWER = '[role="dialog"][aria-labelledby="xs-mounts-title"]'

/** 藏库抽屉的界面面 id（与 `panel-surface.mjs` 的寄生面 id 逐字一致）。 */
const FACE_CANG_DRAWER = 'slot:shell.overlay#xuanshu-cang-drawer'
/** 挂载抽屉的界面面 id。 */
const FACE_MOUNTS_DRAWER = 'slot:shell.overlay#xuanshu-mounts-drawer'

export const SCRIPTS = {
  'create-pu': {
    id: 'create-pu',
    title: '建一个谱',
    /** 这条剧本会走到的界面面（证据按面归档；没走到的不算采到）。 */
    faces: ['panel:overview', 'panel:pus'],
    /** 它期望提供证据的判据 id（票 09 起 `measure()` 一次量齐点击目标、主操作与正文计算样式）。 */
    criteria: ['D-001', 'D-002', 'C-001', 'C-002', 'C-003'],
    /** 失败态变体：剧本 1 的失败是「没有模型」，不是参数造出来的，所以不留开关。 */
    scenarios: ['clean'],
    async run({ page, settle, step, measure }) {
      await dismissBlockingModals({ page, settle, step })

      // ① 首屏（自我总览）：量一遍可点目标 —— 这是「第一次用的人」看到的第一个面。
      await measure('panel:overview')
      step('measure-overview', {})

      // ② 进「谱」：侧栏行是 aria-label=谱 的按钮。
      const nav = page.getByRole('button', { name: '谱', exact: true }).first()
      await nav.click({ force: true })
      await settle(page, 1200)
      await measure('panel:pus')
      step('open-pu-panel', { visible: /谱管理/.test(await mainText(page)) })

      // ③ 创建向导：① 给资料 → ② 定义谱名 → ③ AI 转换中
      await page.getByRole('button', { name: /创建新谱/ }).first().click()
      await settle(page)
      const material = page.getByPlaceholder('把你知道的先写进来')
      await material.fill('我三十岁开始学木工，做榫卯，习惯周末去旧货市场找老料。')
      step('fill-material', {})
      await page.getByRole('button', { name: '下一步', exact: true }).first().click()
      await settle(page)

      const nameField = page.getByLabel('谱名')
      await nameField.fill('木工')
      step('fill-pu-name', {})
      await measure('panel:pus')
      await page.getByRole('button', { name: '开始转换', exact: true }).first().click()
      step('start-convert', {})

      // ④ 终态：成功（预览）或错误，两者都记，不假装成功。
      const terminal = await waitForTerminal({ page })
      step('terminal', { outcome: terminal.outcome, excerpt: terminal.text.slice(0, 240).replace(/\s+/g, ' ') })
      return { outcome: terminal.outcome }
    },
  },

  'ask-consult': {
    id: 'ask-consult',
    title: '问事：进问事 → 选谱（或空手）→ 发一次 → 看到结果或失败态',
    faces: ['panel:consult'],
    criteria: ['D-001', 'N-001', 'N-002', 'N-003'],
    /**
     * `clean` = 正常走一遍（干净 home 上可能以失败态收尾，照实记）；
     * `no-session` = **故意**触发「无会话」失败态：干净 home 上一个问事会话都没有、也没有模型，
     * 这一跑要证明界面在这种条件下给的是**可读失败**，而不是一个假装在跑的转圈。
     */
    scenarios: ['clean', 'no-session'],
    async run({ page, settle, step, measure, nav, scenario = 'clean' }) {
      await dismissBlockingModals({ page, settle, step })

      // ⓪ 起点的入口表：总览上的快捷入口三格只在首屏可见，所以先收一遍再离开。
      const startEntries = await nav.census('overview')
      step('census-overview', { entries: startEntries.length })

      /**
       * 「历史子页 → 退回门厅」这一趟，两条路径都要走（N-002 的事件 + 「无会话」的判定依据）。
       * 提成局部函数是为了**一跑只走一次**：同一件事记两遍，N-002 会把它算成两次关闭。
       */
      let historyChecked = false
      const historyRoundTrip = async () => {
        const from = await nav.landing()
        await page.locator(`${CONSULT} [data-xuanshu-action="toggle-history"]`).first().click()
        await settle(page, 900)
        const state = await page.evaluate(() => {
          const subView = document.querySelector('[data-xuanshu-view="history-list"]') !== null
          const empty = document.querySelector('[data-xuanshu-state="empty"]')
          return {
            subView,
            emptyText: empty === null ? '' : empty.innerText.replace(/\s+/g, ' ').trim().slice(0, 80),
          }
        })
        await page.locator(`${CONSULT} [data-xuanshu-action="back-lobby"]`).first().click()
        await settle(page, 900)
        const landed = await nav.landing()
        nav.recordClose({ from, opened: from, closedBy: '「← 回到当前会话」（历史子页）', landed, subView: state.subView })
        historyChecked = true
        return { from, landed, ...state }
      }

      // ① 进「问事」：侧栏行是 aria-label=问事 的按钮。
      const entry = await openPanel({ page, settle, step, label: '问事', selector: CONSULT })
      await settle(page, 1200)
      const opened = await nav.landing()
      await measure('panel:consult')
      await nav.census('consult')
      step('open-consult', { landed: opened, visible: entry.visible, attempts: entry.attempts })
      if (!entry.visible) {
        // 三次都没打开 = 这一面没走到。**不往下硬点**：那只会把「面板打不开」变成一条 30s 的超时，
        // 报告里再变成「采集失败」，把真因埋掉。
        step('abort', { reason: '问事面板没打开（首跑模态或侧栏不可点）' })
        return { outcome: 'panel-unreachable' }
      }

      // ② 键盘走一遍本面（N-003 的原料）：Tab 顺序、焦点描边。
      const walk = await nav.keyboard('panel:consult', { root: CONSULT, tabs: 10, expect: ['开一次问事'] })
      step('keyboard-consult', {
        controls: walk.controls,
        stopsInFace: walk.stops.filter((stop) => stop.inFace).length,
        dimStops: walk.stops.filter((stop) => stop.inFace && !stop.visibleFocus).length,
        reached: walk.reached,
      })

      // ②b 「无会话」失败态的**前置条件**：历史子页真的空着（那条空态说的是「还没有问事记录」）。
      //     这不是「跑着看会不会撞上」：干净 home 天生没有会话，这一步把它记成事实。
      if (scenario === 'no-session') {
        const circle = await historyRoundTrip()
        step('failure-scenario', {
          scenario,
          deliberate: true,
          sessionsEmpty: circle.emptyText !== '',
          emptyText: circle.emptyText,
          why: '干净 home 上一个问事会话都没有（历史子页是空态）：这一跑是故意从「无会话」出发，'
            + '要证明界面在没有任何会话时给的是可读的下场（建不出 / 发不出 / 打不开都算），不是假装在跑',
        })
      }

      // ③ 选谱：有可选谱就勾第一个；干净 home 上一个都没有 —— 剧本允许空手问一句。
      const boxes = page.locator(`${CONSULT} [data-xuanshu-group] input[type="checkbox"]`)
      const boxCount = await boxes.count()
      let picked = 0
      if (boxCount > 0) {
        await boxes.first().check({ force: true })
        picked = 1
        await settle(page, 600)
      }
      step('pick-pu', {
        picked,
        available: boxCount,
        note: boxCount === 0 ? '干净 home 上没有可选谱：按剧本允许的做法空手问一句（底座 / 底稿恒在场）' : '',
      })

      // ④ 发一次：填问题 → 点主按钮。
      const question = '这次想问：这周适合先把哪件小事收尾？'
      const questionBox = page.locator(`${CONSULT} textarea[data-xuanshu-field="consult-question"]`)
      await questionBox.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {})
      step('ask-box', { visible: (await questionBox.count()) > 0 && (await questionBox.first().isVisible()) })
      await questionBox.first().fill(question)
      await page.locator(`${CONSULT} [data-xuanshu-action="start-consult"]`).first().click()
      step('send-question', { picked, question })

      // ⑤ 终态：开进会话 / 可读错误条 / 超时。三者都照实记，不假装成功。
      const terminal = await waitConsultTerminal({ page })
      step('terminal', {
        outcome: terminal.outcome,
        kind: terminal.kind,
        excerpt: oneLine(terminal.text),
        // 「故意触发的失败态」到底触发了没有：没触发也是事实，写出来，不补一句「已覆盖」。
        failureTriggered: terminal.outcome === 'error',
        ...(scenario === 'no-session' && terminal.outcome !== 'error'
          ? { note: '这一跑界面没有失败（会话建好并切走了）：无会话失败态没有触发 —— 照实记，不补绿' }
          : {}),
      })
      await nav.census('after-ask')

      const stillConsult = (await nav.landing()) === 'panel:consult'

      // ⑥ N-002：从历史子页退回门厅 —— 关掉之后必须回到来处（问事），不是首页。
      //     `no-session` 那一跑在 ②b 已经走过一趟，这里不重复（同一件事记两遍会被算成两次关闭）。
      if (stillConsult && !historyChecked) {
        const circle = await historyRoundTrip()
        step('close-history', { from: circle.from, landed: circle.landed, subView: circle.subView })
      }

      // ⑦ 挂载账本抽屉（票 12）：有会话才开得出来。开得出来就顺手量一件 N-002 / N-003 的事；
      //    开不出来就如实记「入口置灰 / 点了没开 = 这一面未采到」，不是通过。
      if (stillConsult) {
        const from = await nav.landing()
        // 两个入口都在门厅的挂载区里：标题旁的「临时挂载…」与状态栏的「挂载 N 字 / 预算 M 字」。
        // 谁启用了就点谁（没有会话时两个都置灰 —— 那不是失败，是没有可挂的账本）。
        const candidates = [
          `${CONSULT} [data-xuanshu-action="open-mounts"]`,
          `${CONSULT} [data-xuanshu-mount-status="1"]`,
        ]
        let entry = null
        for (const selector of candidates) {
          const candidate = page.locator(selector).first()
          if ((await candidate.count()) > 0 && (await candidate.isEnabled())) {
            entry = candidate
            break
          }
        }
        if (entry !== null) {
          await entry.click({ force: true })
          const drawerOpen = await waitForDialog(page)
          const drawerFace = await nav.landing()
          const drawerWalk = drawerOpen
            ? await nav.keyboard(FACE_MOUNTS_DRAWER, { root: '.xs-mounts__drawer', tabs: 10, expect: ['关闭'] })
            : { controls: 0, stops: [] }
          const esc = await nav.esc()
          if (drawerOpen && !esc.closed) {
            // Esc 关不掉也得把抽屉收起来，否则后面的剧本都被它挡着（这一条会进 N-003 的证据）。
            const closeButton = page.locator(`${MOUNTS_DRAWER} [data-xuanshu-action="close-mounts"]`)
            if ((await closeButton.count()) > 0) await closeButton.first().click({ force: true })
            await settle(page, 900)
          }
          const landed = await nav.landing()
          if (drawerOpen) {
            // 只有在**真的开出来过**时才记关闭事件：没开的抽屉没有「落点」可言，记了就是把没发生的事
            // 写成证据（N-002 会拿它判「回到来处」，那是假证据）。
            nav.recordClose({
              from,
              opened: drawerFace === from ? FACE_MOUNTS_DRAWER : drawerFace,
              closedBy: esc.closed ? 'Escape' : '「关闭」按钮',
              landed,
              esc,
            })
          }
          step('mounts-drawer', {
            opened: drawerOpen,
            face: drawerFace,
            closedByEsc: esc.closed,
            controls: drawerWalk.controls,
            landed,
          })
        } else {
          step('mounts-drawer', { opened: false, note: '挂载入口置灰（没有会话可挂）：这一面未采到，不是通过' })
        }
      }

      return { outcome: terminal.outcome }
    },
  },

  'register-cang': {
    id: 'register-cang',
    title: '藏库：登记一个本地文件 → 在列表看到它 → 打开 / 跳转',
    faces: ['panel:cang', FACE_CANG_DRAWER],
    criteria: ['D-001', 'N-001', 'N-002', 'N-003'],
    /**
     * `normal` = 造一个真文件、真的登记进去、在列表看到它、再打开它；
     * `missing-file` = **故意**登记一个不存在的路径（失败态：指针失效）；
     * `load-failed` = **故意**把注册表写成坏 JSON（失败态：注册表读不出来）。
     */
    scenarios: ['normal', 'missing-file', 'load-failed'],
    async run({ page, settle, step, measure, nav, env, scenario = 'normal' }) {
      const dataDir = join(env.home, 'xuanshu')
      const registryFile = join(dataDir, 'cang', 'registry.jsonl')
      const sampleFile = join(env.home, 'ux-cang-sample.txt')
      const missingFile = join(env.home, 'ux-cang-不存在.txt')

      await dismissBlockingModals({ page, settle, step })

      if (scenario === 'load-failed') {
        // 真造一个「读不出来」的注册表：宿主的 registry 读到坏行会抛错并报行号，绝不静默跳过。
        mkdirSync(dirname(registryFile), { recursive: true })
        writeFileSync(registryFile, '{"op":"register" 这一行故意写坏}\n', 'utf8')
        step('failure-scenario', {
          scenario,
          deliberate: true,
          why: `这一跑是故意触发「加载失败」失败态：把 ${registryFile} 写成一行坏 JSON，让 cang.list 真的读不出来`,
        })
      }
      if (scenario === 'missing-file') {
        step('failure-scenario', {
          scenario,
          deliberate: true,
          why: `这一跑是故意触发「文件不存在」失败态：登记一个不存在的路径 ${missingFile}`,
        })
      }
      if (scenario === 'normal') {
        // 先在临时 home 里造一个**真文件**（藏只登记指针，所以文件必须真的在）。
        writeFileSync(sampleFile, '玄枢体验质量线的巡检样本：只被登记指针，不被读取。\n', 'utf8')
        step('make-sample-file', { file: sampleFile })
      }

      // ① 进「藏」：侧栏行是 aria-label=藏 的按钮。
      await nav.census('before-cang')
      const entry = await openPanel({ page, settle, step, label: '藏', selector: CANG })
      await settle(page, 1200)
      const opened = await nav.landing()
      await measure('panel:cang')
      await nav.census('cang')
      step('open-cang', { landed: opened, visible: entry.visible, attempts: entry.attempts })
      if (!entry.visible) {
        step('abort', { reason: '藏库面板没打开（首跑模态或侧栏不可点）' })
        return { outcome: 'panel-unreachable' }
      }

      // ②b 加载失败态：注册表坏掉时，面板必须给可读错误 + 重试。
      //     （这一支放在键盘走查之前是有意的：读不出来时「登记藏」按设计就是禁用的，
      //      不能再拿它当 N-003 的主操作去判 —— 那会把一个正确的禁用判成红。）
      const canRegister = scenario !== 'load-failed'
      const walk = await nav.keyboard('panel:cang', {
        root: CANG,
        tabs: 10,
        expect: canRegister ? ['登记藏'] : [],
      })
      step('keyboard-cang', {
        controls: walk.controls,
        stopsInFace: walk.stops.filter((stop) => stop.inFace).length,
        dimStops: walk.stops.filter((stop) => stop.inFace && !stop.visibleFocus).length,
        reached: walk.reached,
      })

      // ②c 加载失败态：注册表坏掉时，面板必须给可读错误 + 重试。
      if (scenario === 'load-failed') {
        const alertText = await waitForText(page, `${CANG} [role="alert"]`, (text) => text.trim() !== '')
        const reload = await page.getByRole('button', { name: '重试', exact: true }).count()
        step('load-failed', { alert: oneLine(alertText), readFailed: /读不出来|失败/.test(alertText), retry: reload > 0 })
        return { outcome: /读不出来|失败/.test(alertText) ? 'load-failed' : 'error-state-missing' }
      }

      // ③ 打开登记抽屉：量一遍入口与键盘（抽屉自己的 Tab 圈与 Esc）。
      await page.getByRole('button', { name: '登记藏', exact: true }).first().click({ force: true })
      await settle(page, 1000)
      const drawerFace = await nav.landing()
      await nav.census('cang-drawer')
      step('open-cang-drawer', { landed: drawerFace, dialog: await hasDialog(page) })

      const pathInput = page.locator(`${CANG_DRAWER} input`).first()
      const target = scenario === 'missing-file' ? missingFile : sampleFile
      await pathInput.fill(target)
      const status = await waitForText(
        page,
        `${CANG_DRAWER} [role="status"]`,
        (text) => !/正在校验|请选择或粘贴/.test(text) && text.trim() !== '',
      )
      step('validate-pointer', { path: target, status: oneLine(status) })

      // 键盘走一遍**在路径填好之后**：提交按钮要等指针有效才可用（`disabled={!pointer?.valid}`），
      // 空表时它根本不在 Tab 序里 —— 那时候去问「Tab 到得到登记吗」是在考一个不存在的控件。
      const drawerWalk = await nav.keyboard(FACE_CANG_DRAWER, { root: CANG_DRAWER, tabs: 12, expect: ['登记'] })
      step('keyboard-cang-drawer', {
        controls: drawerWalk.controls,
        stopsInFace: drawerWalk.stops.filter((stop) => stop.inFace).length,
        dimStops: drawerWalk.stops.filter((stop) => stop.inFace && !stop.visibleFocus).length,
        reached: drawerWalk.reached,
      })

      if (scenario === 'missing-file') {
        const submit = page.locator(`${CANG_DRAWER} button[type="submit"]`)
        const submitEnabled = (await submit.count()) > 0 ? await submit.first().isEnabled() : false
        step('pointer-invalid', { status: oneLine(status), submitEnabled, submitBlocked: submitEnabled === false })
        // 「取消」用元素自己的 click：Esc 之后 / 遮罩动过之后，坐标点击可能落到别的元素上，
        // 那会把「关闭」记成一次**没发生过**的导航（实测踩过一次：落到 panel:overview）。
        const cancel = page.locator(`${CANG_DRAWER} button`).filter({ hasText: '取消' }).first()
        if ((await cancel.count()) > 0) await cancel.evaluate((el) => el.click())
        await settle(page, 800)
        const landed = await nav.landing()
        nav.recordClose({ from: 'panel:cang', opened: FACE_CANG_DRAWER, closedBy: '「取消」', landed })
        step('close-cang-drawer', { closedBy: '取消', landed })
        return { outcome: submitEnabled === false && /指针失效|ENOENT/.test(status) ? 'missing-file' : 'failure-not-triggered' }
      }

      // ④ 真的登记：提交之后抽屉自己关，列表里出现这张卡。
      await page.locator(`${CANG_DRAWER} button[type="submit"]`).first().click()
      await settle(page, 1500)
      const closedAfterSubmit = !(await hasDialog(page))
      const landedAfterSubmit = await nav.landing()
      nav.recordClose({ from: 'panel:cang', opened: FACE_CANG_DRAWER, closedBy: '「登记」提交成功', landed: landedAfterSubmit })
      const card = page.locator(`${CANG} [data-cang-id]`).first()
      const listed = (await card.count()) > 0
      const cardText = listed ? oneLine(await card.innerText()) : ''
      await nav.census('cang-registered')
      step('registered', { closedAfterSubmit, landed: landedAfterSubmit, listed, card: cardText.slice(0, 120) })

      // ⑤ 打开 / 跳转：卡片上的「更多操作 → 编辑登记」会再开同一个抽屉（跳转，不是复制内容）。
      let reopened = false
      let landedAfterReopen = ''
      if (listed) {
        // 宽屏下 `.xs-cang__more>summary` 是 `display:none`（cang-style 的 ≥1100px 断点直接把三个
        // 次级入口摊开），所以「更多操作」只在窄屏需要点；点不到不算错，接着找按钮就行。
        const more = card.locator('summary').filter({ hasText: '更多操作' }).first()
        if ((await more.count()) > 0 && (await more.isVisible())) await more.click({ force: true })
        // 次级入口在**闭合的 `<details>` 里**：宽屏 CSS 把 `summary` 藏起来、把 div 摊开显示，
        // 但 Chromium 的可访问树仍把闭合 details 的内容当隐藏 —— 所以按文本找按钮，不按 role 找。
        const edit = card.locator('button').filter({ hasText: /编辑登记|重新定位/ }).first()
        if ((await edit.count()) > 0) {
          // 这一格的 `boundingBox` 是 0×0（闭合 details 的内容不进渲染树），普通 click 打不中它；
          // 用元素自己的 `click()` 派发同一个事件。**顺带记下这件事**：它同时说明这个入口
          // 指针也点不到、键盘也 Tab 不到 —— 那是报告里给人看的事实，不冒充「跳转可用」。
          const box = await edit.boundingBox()
          await edit.evaluate((el) => el.click())
          await settle(page, 1000)
          reopened = await hasDialog(page)
          landedAfterReopen = await nav.landing()
          // Esc 只在**焦点在抽屉里**时才该生效（`CangDrawer` 的 onKeyDown 挂在抽屉根上）。
          // 先确认焦点进去了再按，否则按下的是一次没被任何人听见的 Esc —— 那不是界面缺陷。
          const focusInside = await page.evaluate(
            (selector) => document.querySelector(selector)?.contains(document.activeElement) === true,
            CANG_DRAWER,
          )
          const esc = reopened ? await nav.esc() : { applicable: false, closed: null }
          if (reopened && !esc.closed) {
            const cancel = page.locator(`${CANG_DRAWER} button`).filter({ hasText: '取消' }).first()
            if ((await cancel.count()) > 0) await cancel.evaluate((el) => el.click())
            await settle(page, 800)
          }
          const landed = await nav.landing()
          nav.recordClose({
            from: 'panel:cang',
            opened: FACE_CANG_DRAWER,
            closedBy: esc.closed ? 'Escape' : '「取消」',
            landed,
            esc,
          })
          step('reopen-entry', { reopened, face: landedAfterReopen, focusInside, closedByEsc: esc.closed, landed, hitArea: box })
        }
      }

      return { outcome: listed && reopened ? 'registered' : 'registered-without-entry' }
    },
  },
}

/**
 * 剧本 id → `{id, scenario}`。`'register-cang:missing-file'` 这种写法让**失败态**能单独跑，
 * 而不用给采集器加第二个参数面（`scriptIds` 已经够表达这件事）。
 *
 * @param {string} raw
 * @returns {{id: string, scenario: string | undefined}}
 */
export function parseScriptId(raw) {
  const text = String(raw ?? '').trim()
  const index = text.indexOf(':')
  if (index === -1) return { id: text, scenario: undefined }
  return { id: text.slice(0, index), scenario: text.slice(index + 1) || undefined }
}

/** 列出全部剧本 id（错误信息与文档用）。 */
export function scriptIds() {
  return Object.keys(SCRIPTS)
}

/**
 * `scriptIds` → `{script, scenario}[]`（**唯一的解析入口**：采集器与用例读同一份口径）。
 *
 * 未知剧本 / 未知变体都抛可读错误：一条「名字打错」的采集命令如果静默跳过，
 * 报告就会少一整族证据而没人发现（那正是「未采到 ≠ 通过」要防的事）。
 *
 * @param {string[]} [ids] 缺省 = 全部剧本
 * @returns {{script: object, scenario: string}[]}
 */
export function resolveScripts(ids = scriptIds()) {
  return ids.map((raw) => {
    const { id, scenario } = parseScriptId(raw)
    const script = SCRIPTS[id]
    if (script === undefined) throw new Error(`没有这条剧本：${id}（现有：${scriptIds().join(' / ')}）`)
    const scenarios = script.scenarios ?? ['clean']
    if (scenario !== undefined && !scenarios.includes(scenario)) {
      throw new Error(`剧本 ${id} 没有这个变体：${scenario}（现有：${scenarios.join(' / ')}）`)
    }
    return { script, scenario: scenario ?? scenarios[0] }
  })
}
