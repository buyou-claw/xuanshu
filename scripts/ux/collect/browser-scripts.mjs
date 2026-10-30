#!/usr/bin/env node
/**
 * `scripts/ux/collect/browser-scripts.mjs` —— **任务剧本**（spec 003 §12）。
 *
 * 剧本以「任务」为单位横穿多个界面面，不按屏截图：一条剧本 = 一串人真的会做的动作 + 期望命中的判据 id。
 * 首版三条（建谱 / 问事 / 藏库）由票 07 与票 08 分批落地；这里先放剧本 1。
 *
 * 剧本的 run() 只**做事与记账**：`step()` 记动作、`measure(face)` 量该界面面此刻的可点目标。
 * 判定不在这里（那在 judge + assertions）。
 *
 * 已实测的事实（2026-10-31，系统 Edge + 全局 playwright）：
 *   - 首跑会连续出现**两层模态**：DSH「预览版说明」→「添加一个 API Key」；两层都关掉之后侧栏才可点；
 *   - 侧栏行是 36px 高、`xs-btn` 主按钮 32px 高 —— 都小于留白档要求的 44×44；
 *   - 「建一个谱」的五步向导在**没有模型**的干净 home 上会在第 ③ 步（AI 转换）失败。
 *     剧本因此把「预览」与「错误」都当成**合法终点**并如实记下是哪一个：失败态也是证据，不是例外。
 */

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

export const SCRIPTS = {
  'create-pu': {
    id: 'create-pu',
    title: '建一个谱',
    /** 这条剧本会走到的界面面（证据按面归档；没走到的不算采到）。 */
    faces: ['panel:overview', 'panel:pus'],
    /** 它期望提供证据的判据 id（票 09 起 `measure()` 一次量齐点击目标、主操作与正文计算样式）。 */
    criteria: ['D-001', 'D-002', 'C-001', 'C-002', 'C-003'],
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
}
