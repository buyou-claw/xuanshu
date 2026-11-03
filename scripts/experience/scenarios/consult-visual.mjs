#!/usr/bin/env node
/**
 * `scripts/experience/scenarios/consult-visual.mjs` —— **视觉复核 E09**（Spec 04 · 票 #81）。
 *
 * E09 要回答的问题不是「界面好不好看」，而是：**在三种采样条件下，界面的精细度还能不能被逐项比**。
 * 所以本文件只做两件事：
 *
 *   1. **取真实内容**：从问事面板「历史回看」的阅读器里读 E03/E06 留下的**真问题与真 AI 回复**
 *      （不是夹具文本，也不借内部 API —— 读的是屏上的 DOM 文本）；
 *   2. **把屏上的测量值翻成发现**：字号 / 行高 / 点击目标 / 主操作 / 溢出与截断 / 滚动 / 弹层，
 *      每一条都必须带「哪张图的哪个位置 + 依据哪条设计稿或判据」。
 *
 * 三条不许越过的线：
 *   - **采样条件不是设计断点**：1280×900 浅 / 1024×768 / 1280×900 深只是三种**观测条件**；
 *     宽窄分界全稿只有 README §3.1 那一个（≥1100 宽 / <1100 窄），本文件不新增第四个断点。
 *   - **AI 只做测量与取证**：机器可判的只有判据给了阈值的那些（D-001 / D-002 / C-001 / C-002 / C-003）。
 *     指不出判据或设计依据的，一律标「待人工判断」或「判据缺口」，**不许写成已确认的体验债**。
 *   - **不改任何冻结判据 / 阈值 / 签字文件**：本文件只**引用** `docs/design/ui-v1/criteria/` 里的 id 与
 *     `README.md` §11.1 / `type-scale.md` §2 的取值。
 *
 * 仅使用 Node 内置模块（浏览器对象由 runner 注入）。ESM。
 */
import { dismissFirstRun, openConsult, sidebarRow } from './consult.mjs'

/** 问事面板与它内部的锚点（`01-recon.md` §3 的既有锚，不另造选择器）。 */
const CONSULT = '[data-xuanshu-panel="consult"]'
const HISTORY_TOGGLE = '[data-xuanshu-action="toggle-history"]'
const BACK_LIST = '[data-xuanshu-action="back-list"]'
const BACK_LOBBY = '[data-xuanshu-action="back-lobby"]'
const CONTINUE_ACTION = '[data-xuanshu-action="continue-consult"]'
const OPEN_MOUNTS = '[data-xuanshu-action="open-mounts"]'
const CLOSE_MOUNTS = '[data-xuanshu-action="close-mounts"]'
const MOUNTS_DRAWER = '[data-xuanshu-drawer="mounts"]'

/** 一般操作上限（计划 §9.3：15s）。 */
const ACTION_TIMEOUT_MS = 15_000
/** 等列表 / 阅读器出现的上限（本地会话清单要读盘）。 */
const LIST_BUDGET_MS = 20_000
/** 等错误态出现的观察窗口：点了「继续这次问事」之后产品给什么。 */
const FEEDBACK_WINDOW_MS = 12_000

/** 发现只能落到这三种裁定去向（「未裁定」不许冒充「已确认的体验债」）。 */
export const DISPOSITIONS = Object.freeze(['measured-violation', '待人工判断', '判据缺口'])

/** 依据只能是这三类来源。 */
export const BASES = Object.freeze({
  criterion: '判据（docs/design/ui-v1/criteria/criteria.json）',
  design: '设计稿章节 / token',
  gap: '判据缺口：设计稿与 criteria 都没有可复现的阈值',
})

/**
 * 三种**采样条件**（票面逐字：1280×900 浅 / 1024×768 / 1280×900 深）。
 *
 * `kind: 'sample'` 是给读者的护栏：这不是设计断点，改它不改变任何布局规格；
 * 1024 只是**撞上**了 README §3.1 的窄屏分界，所以三种条件里才看得见两种布局。
 */
export const SAMPLING_CONDITIONS = Object.freeze([
  Object.freeze({ id: 'w1280x900-light', label: '1280×900 浅色（默认）', width: 1280, height: 900, colorScheme: 'light', kind: 'sample' }),
  Object.freeze({ id: 'w1024x768-light', label: '1024×768 浅色（窗口缩小）', width: 1024, height: 768, colorScheme: 'light', kind: 'sample' }),
  Object.freeze({ id: 'w1280x900-dark', label: '1280×900 深色（主题）', width: 1280, height: 900, colorScheme: 'dark', kind: 'sample' }),
])

/** 每种条件要拍的面（`error` / `overlay` 是「取得到就拍」的面，取不到要写清为什么）。 */
export const SURFACES = Object.freeze(['lobby', 'history', 'reader', 'reader-bottom', 'error', 'overlay'])

/** 判定「三组采样齐了没有」时按这几个面算；`error` 只在真的出现时才算（不给它编一个）。 */
export const REQUIRED_SURFACES = Object.freeze(['lobby', 'history', 'reader', 'reader-bottom', 'overlay'])

/** 机器可读清单的固定文件名（与截图同目录）。 */
export const ARTIFACT_NAME = 'visual-samples.json'

/** 清单的 schema 标签（下一轮按它对齐）。 */
export const SAMPLES_SCHEMA = 'xuanshu/experience-visual-samples@1'

/** `type-scale.md` §2 的 6 档字号（README §11.1「层级只允许既有 6 档字号」的机读投影）。 */
const TIER_SIZES = Object.freeze([12, 13, 14, 16, 18, 20])
/** rem 取整会让 18px 的档位量成 18.4px：给 0.6px 的容差，别把取整当成新档位。 */
const TIER_TOLERANCE = 0.6

/**
 * 宽屏下限（px）：**引用** README §3.1 的既有分界（宽 ≥1100 / 窄 <1100），不是本票新增的断点。
 * 它只用来判断「这一张图是不是窄屏形态」，不改变任何布局规格。
 */
export const WIDE_MIN_WIDTH_PX = 1100

/** 判据阈值（只引用，不改）：README §11.1。 */
const BODY_MIN_FONT_PX = 16
const BODY_MIN_LINE_RATIO = 1.5
const CLICK_TARGET_MIN_PX = 44
const LARGE_TEXT_PX = 24
const LARGE_TEXT_SMALL_PX = 18.66
const LARGE_TEXT_MIN_WEIGHT = 700
const CONTRAST_BODY = 4.5
const CONTRAST_LARGE = 3

/** 每个面最多记多少条文字：证据要能读，不负责搬整屏。 */
const MAX_TEXT_RECORDS = 60

/**
 * 「同一条横条里的孩子」判据（px）：竖直中心差 ≤ 它算同一行。
 * 一行控件高 44px，换行后两行中心差 ≈ 44–56px，所以 12px 两边都留得住。
 */
const ROW_CLUSTER_TOLERANCE_PX = 12

/** 设计稿的间距阶梯（px）：`type-scale.md` §2 注 + `设计token字典.md` §5 的口径。 */
const SPACING_LADDER_PX = Object.freeze([4, 8, 12, 16, 20, 24])

/**
 * 截图文件名：`e09-<第几种条件>-<条件 id>-<面>.png`。
 * 条件 id 进文件名是**可比较性**的要求：换台机器重跑，同名文件一定还是同一种条件。
 */
export function shotName(index, condition, surface) {
  return `e09-${index}-${condition.id}-${surface}.png`
}

/** 把一段文案压成一行短摘要（区域标注与观测行都用它）。 */
function brief(text, limit = 28) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit)
}

/** 绝对路径会把本机目录带进清单：清单里一律换成占位符（截图里有什么是截图的事）。 */
function redactPaths(text) {
  return String(text ?? '').replace(/[A-Za-z]:\\[^\s、，。；）)]*/gu, '[路径]')
}

/** 像素值统一保留 1 位小数（18.4 与 18.40 在「逐项比」时是两种噪声）。 */
function px(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.round(value * 10) / 10
}

/** 一条发现的统一形状：**必须**有截图区域、观测事实、裁定去向与依据。 */
function finding({ shot, area, observed, disposition, basis }) {
  return {
    shot,
    area: `截图 ${shot} · ${area}`,
    observed,
    disposition,
    basis,
  }
}

/**
 * 「弹层点了没出现」这一条发现（由场景在真点过之后补进来）。
 *
 * 为什么它的去向是「待人工判断」而不是违例：设计稿（S6 §5 步骤 7、S8 §1）写了这个入口要开抽屉，
 * 但「没开」既可能是接线没上（本构建 `shell.overlay` 的限制），也可能是缺陷 —— 机器分不清这两种，
 * 按票 #81 的边界留给人在看过截图之后裁定。
 */
export function overlayMissingFinding({ shot, reason }) {
  return finding({
    shot,
    area: '门厅 ③ 临时挂载区（点「临时挂载…」之后的整屏）',
    observed: `弹层入口点了没有出现抽屉：${reason}；`
      + '同帧里 [data-xuanshu-drawer] / [data-xuanshu-overlay] / [role="dialog"] 都是 0 个',
    disposition: '待人工判断',
    basis: { kind: 'design', ref: 'S6 §5 步骤 7 / S8 §1', text: '设计稿规定「临时挂载 ▸ S8」点开抽屉；实测没有打开 —— 是接线缺口还是缺陷，需人裁定' },
  })
}

/**
 * 把一份页面快照翻成发现 + 实测值（纯函数，零浏览器）。
 *
 * @param {object} snapshot `readSurface()` 的返回值
 * @param {{shot?: string, extraFindings?: object[]}} [options] `extraFindings` 供场景补入现场观测（如弹层没开）
 * @returns {{surface: string, shot: string, findings: object[], metrics: object}}
 */
export function analyseSurface(snapshot = {}, options = {}) {
  const shot = options.shot ?? ''
  const surface = snapshot.surface ?? 'unknown'
  const texts = (snapshot.texts ?? []).filter((text) => text.visible !== false)
  const buttons = (snapshot.buttons ?? []).filter((button) => button.visible !== false)
  const overlays = (snapshot.overlays ?? []).filter((overlay) => overlay.visible !== false)
  const findings = []

  const bodyTexts = texts.filter((text) => text.role === 'body')
  const headingTexts = texts.filter((text) => text.role === 'heading')
  const tierCounts = new Map()
  for (const text of texts) {
    const key = `${text.role}|${px(text.fontSize)}|${text.fontWeight}`
    tierCounts.set(key, (tierCounts.get(key) ?? 0) + 1)
  }
  const tiers = [...tierCounts.entries()]
    .map(([key, count]) => {
      const [role, size, weight] = key.split('|')
      return { role, fontSize: Number(size), fontWeight: Number(weight), count }
    })
    .sort((left, right) => right.fontSize - left.fontSize || String(left.role).localeCompare(String(right.role)))

  // ① 正文下限与行高（C-001 / C-002）：判据给了阈值，机器可判。
  const smallBody = bodyTexts.filter((text) => typeof text.fontSize === 'number' && text.fontSize < BODY_MIN_FONT_PX)
  if (smallBody.length > 0) {
    findings.push(finding({
      shot,
      area: `${surface} 正文（${smallBody.length} 处，第一处「${brief(smallBody[0].excerpt)}」）`,
      observed: `正文计算字号最小 ${px(Math.min(...smallBody.map((text) => text.fontSize)))}px（${smallBody
        .slice(0, 3)
        .map((text) => `${text.tag ?? ''}${text.cls === '' ? '' : `.${text.cls}`}「${brief(text.excerpt, 16)}」=${px(text.fontSize)}px`)
        .join('、')}${smallBody.length > 3 ? ` 等 ${smallBody.length} 处` : ''}）`,
      disposition: 'measured-violation',
      basis: { kind: 'criterion', ref: 'C-001', text: 'README §11.1「正文 ≥16px」；元信息不参与这条' },
    }))
  }
  const looseBody = bodyTexts.filter((text) => text.ratio === null || typeof text.ratio !== 'number' || text.ratio < BODY_MIN_LINE_RATIO)
  if (looseBody.length > 0) {
    const first = looseBody[0]
    findings.push(finding({
      shot,
      area: `${surface} 正文行高（${looseBody.length} 处，第一处「${brief(first.excerpt)}」）`,
      observed: first.ratio === null
        ? `行高是 line-height: normal（量不出比值），按低于 ${BODY_MIN_LINE_RATIO} 算；字号 ${px(first.fontSize)}px`
        : `行高比最小 ${px(Math.min(...looseBody.map((text) => text.ratio)))}（「${brief(first.excerpt, 16)}」= ${px(first.lineHeightPx)}px / ${px(first.fontSize)}px）`,
      disposition: 'measured-violation',
      basis: { kind: 'criterion', ref: 'C-002', text: 'README §11.1「行高 ≥1.5」；normal 没有给比值，按低于下限算' },
    }))
  }

  // ② 字号档位（README §11.1「层级只允许既有 6 档字号」）：criteria 里没有对应规则 → 判据缺口。
  const offTier = headingTexts.filter((text) => typeof text.fontSize === 'number'
    && !TIER_SIZES.some((tier) => Math.abs(tier - text.fontSize) <= TIER_TOLERANCE))
  if (offTier.length > 0) {
    const sizes = [...new Set(offTier.map((text) => `${px(text.fontSize)}px`))]
    findings.push(finding({
      shot,
      area: `${surface} 标题「${brief(offTier[0].excerpt)}」`,
      observed: `标题字号 ${sizes.join(' / ')} 不在 6 档（${TIER_SIZES.join(' / ')}px）内；`
        + '同一屏的字重与字号见清单的 tiers',
      disposition: '判据缺口',
      basis: { kind: 'design', ref: '11.1', text: 'README §11.1「层级只允许既有 6 档字号」；criteria 里没有对应规则（L-001 是 human-only，只管「一眼能不能分」）' },
    }))
  }

  // ③ 层级辨识（L-001 是 human-only）：机器只把量到的档位摊开，判读留给人。
  if (tiers.length > 0) {
    findings.push(finding({
      shot,
      area: `${surface} 整屏文字层级（标题 / 正文 / 元信息）`,
      observed: `实测档位：${tiers.slice(0, 6).map((tier) => `${tier.role} ${tier.fontSize}px/${tier.fontWeight}（${tier.count} 处）`).join('；')}`,
      disposition: '待人工判断',
      basis: { kind: 'criterion', ref: 'L-001', text: 'L-001 是 human-only：机器量得出字号 / 字重，量不出「这屏读起来有没有层次」（criteria/README §3 第 2 条）' },
    }))
  }

  // ④ 对比度（C-003）：只在能把有效背景解析出来时才判，解析不出就记 null 不算。
  const lowContrast = texts.filter((text) => typeof text.contrast === 'number'
    && text.contrast < (isLargeText(text) ? CONTRAST_LARGE : CONTRAST_BODY))
  if (lowContrast.length > 0) {
    const first = lowContrast[0]
    findings.push(finding({
      shot,
      area: `${surface} 文字对比度（${lowContrast.length} 处，第一处「${brief(first.excerpt)}」）`,
      observed: `对比度最低 ${px(Math.min(...lowContrast.map((text) => text.contrast)))}:1（「${brief(first.excerpt, 16)}」= ${px(first.fontSize)}px/${first.fontWeight}）`,
      disposition: 'measured-violation',
      basis: { kind: 'criterion', ref: 'C-003', text: 'README §11.1 WCAG AA：正文 ≥4.5:1，大字 ≥3:1' },
    }))
  }

  // ⑤ 点击目标（D-001）：置灰的控件不是「可点目标」，不计；量到的照样记进 metrics。
  const clickable = buttons.filter((button) => button.disabled !== true)
  const narrow = clickable.filter((button) => button.rect.width < CLICK_TARGET_MIN_PX || button.rect.height < CLICK_TARGET_MIN_PX)
  if (narrow.length > 0) {
    findings.push(finding({
      shot,
      area: `${surface} 控件行（第一处「${brief(narrow[0].label, 16)}」@ y≈${narrow[0].rect.y}）`,
      observed: `可点目标小于 44×44 的有 ${narrow.length} 个：${narrow
        .slice(0, 4)
        .map((button) => `「${brief(button.label, 12)}」${button.rect.width}×${button.rect.height}`)
        .join('、')}${narrow.length > 4 ? ` 等 ${narrow.length} 个` : ''}`,
      disposition: 'measured-violation',
      basis: { kind: 'criterion', ref: 'D-001', text: 'README §11.1「点击目标 ≥44×44 CSS px」' },
    }))
  }

  // ⑥ 主操作 ≤1（D-002）：同一时刻可见的主按钮；置灰的不算。
  const primaryVisible = buttons.filter((button) => button.primary === true && button.disabled !== true)
  if (primaryVisible.length > 1) {
    findings.push(finding({
      shot,
      area: `${surface} 主操作行`,
      observed: `同一屏可见主操作 ${primaryVisible.length} 个：${primaryVisible.map((button) => `「${brief(button.label, 12)}」`).join('、')}`,
      disposition: 'measured-violation',
      basis: { kind: 'criterion', ref: 'D-002', text: 'README §11.1「单屏主操作 ≤1」' },
    }))
  }

  // ⑦ 长文本挤压与截断：没有任何判据规定换行 / 截断口径 → 只记事实 + 判据缺口。
  for (const text of texts) {
    if (!(text.scrollWidth > text.clientWidth + 1)) continue
    const kind = text.textOverflow === 'ellipsis'
      ? '文字被省略号截断'
      : (text.overflowX === 'hidden' || text.overflowX === 'clip')
        ? '文字被裁掉（看不见省略号，也没有换行）'
        : '文字溢出容器（内容宽于容器，会压到相邻内容）'
    findings.push(finding({
      shot,
      area: `${surface} 文字块「${brief(text.excerpt)}」（y≈${text.rect.y}）`,
      observed: `${kind}：内容宽 ${text.scrollWidth}px > 容器 ${text.clientWidth}px；white-space=${text.whiteSpace ?? 'normal'}；`
        + `overflow-x=${text.overflowX ?? 'visible'}；text-overflow=${text.textOverflow ?? 'clip'}`,
      disposition: '判据缺口',
      basis: { kind: 'gap', ref: 'gap:text-overflow', text: 'criteria 没有长文本换行 / 截断口径；S7 §2.2 只画「AI：…（正文）」，未规定超宽怎么断' },
    }))
  }
  const panelScroll = snapshot.panelScroll ?? {}
  if (typeof panelScroll.scrollWidth === 'number' && panelScroll.scrollWidth > panelScroll.clientWidth + 1) {
    findings.push(finding({
      shot,
      area: `${surface} 面板主体（问事面板内容列）`,
      observed: `面板横向溢出：内容宽 ${panelScroll.scrollWidth}px > 可视宽 ${panelScroll.clientWidth}px`,
      disposition: '判据缺口',
      basis: { kind: 'gap', ref: 'gap:panel-overflow', text: 'criteria 没有面板横向溢出口径；README §3.1 只定宽 / 窄两态' },
    }))
  }
  const docScroll = snapshot.docScroll ?? {}
  if (typeof docScroll.scrollWidth === 'number' && docScroll.scrollWidth > docScroll.innerWidth + 1) {
    findings.push(finding({
      shot,
      area: `${surface} 整页`,
      observed: `整页横向滚动：文档宽 ${docScroll.scrollWidth}px > 视口宽 ${docScroll.innerWidth}px`,
      disposition: '判据缺口',
      basis: { kind: 'gap', ref: 'gap:page-overflow', text: 'criteria 没有整页横向溢出口径' },
    }))
  }

  // ⑧ 滚动：**只在刻意滚到底的那一面**判「头部还看不看得见」（S7 §2.2 的线框把头部画在最上面，没写吸顶）。
  //    别的面偶尔也会被框架动作滚动一点（把控件带进视野），那不算「滚到底」，别借它造发现。
  //    有工具条就量工具条（← 列表 / 只读标记 / 继续这次问事），没有就退回面板头。
  const bar = snapshot.toolbar?.present === true ? snapshot.toolbar : (snapshot.header ?? {})
  const toolbarFullyOut = bar.present === true && typeof bar.top === 'number'
    && bar.top + (bar.height ?? 0) <= 0
  if (surface === 'reader-bottom' && toolbarFullyOut) {
    findings.push(finding({
      shot,
      area: `${surface} 顶部工具条（← 列表 / 继续这次问事 / 只读标记）`,
      observed: `滚到底后工具条整条离开视口：top=${bar.top}px（高 ${bar.height}px；`
        + `scrollTop=${snapshot.panelScroll?.scrollTop ?? '?'} / 可滚 ${snapshot.panelScroll?.scrollHeight ?? '?'}px）`,
      disposition: '待人工判断',
      basis: { kind: 'design', ref: 'S7 §2.2', text: '线框把头部行画在阅读器最上面，但没规定它是否吸顶；这是取舍不是阈值' },
    }))
  }

  // ⑨ 弹层：D8 只规定「照上游 Modal 的焦点 / 遮罩 / Esc」，没有视口内边距口径 → 判据缺口。
  for (const overlay of overlays) {
    if (overlay.withinViewport === false) {
      findings.push(finding({
        shot,
        area: `${surface} 弹层「${brief(overlay.label, 16)}」（${overlay.rect.width}×${overlay.rect.height}）`,
        observed: `弹层超出视口：rect=${overlay.rect.x},${overlay.rect.y} ${overlay.rect.width}×${overlay.rect.height}；视口 ${snapshot.viewport?.width}×${snapshot.viewport?.height}`,
        disposition: '判据缺口',
        basis: { kind: 'gap', ref: 'README §6.4 D8', text: 'D8 只规定自研浮层照上游 Modal 的焦点 / 遮罩 / Esc，没有「弹层必须完整落在视口内」的阈值' },
      }))
    }
    if (overlay.maskPresent === false) {
      findings.push(finding({
        shot,
        area: `${surface} 弹层「${brief(overlay.label, 16)}」背后`,
        observed: '弹层背后没有可见遮罩（浮层与页面同层，视觉上分不开）',
        disposition: '判据缺口',
        basis: { kind: 'gap', ref: 'token --xs-surface-overlay-mask', text: 'token 有遮罩取值，但 criteria 没有「弹层必须有遮罩」的机器判据' },
      }))
    }
  }

  // ⑩ 窄屏工具条：S7 §2.4 画的是「工具条收起成 [搜索] + 行菜单」，实测若只是换行 → 记事实。
  const viewportWidth = snapshot.viewport?.width ?? null
  const toolbarBar = snapshot.toolbar?.present === true ? snapshot.toolbar : null
  if (typeof viewportWidth === 'number' && viewportWidth < WIDE_MIN_WIDTH_PX
    && toolbarBar !== null && typeof toolbarBar.rows === 'number' && toolbarBar.rows > 1) {
    findings.push(finding({
      shot,
      area: `${surface} 顶部工具条（${toolbarBar.rows} 行，高 ${toolbarBar.height}px）`,
      observed: `窄屏（${viewportWidth}px < ${WIDE_MIN_WIDTH_PX}px）下工具条折成 ${toolbarBar.rows} 行，`
        + '没有收成 [搜索] + 行菜单的窄屏形态',
      disposition: '待人工判断',
      basis: { kind: 'design', ref: 'S7 §2.4', text: '设计稿窄屏（<1100）要求「工具条收成 [搜索] 与行菜单」；实测是同一套控件折行 —— 是否算偏离由人裁定' },
    }))
  }

  // ⑪ 间距：设计稿只给了阶梯（4 / 8 / 12 / 16 / 20 / 24），没给「哪两块之间多远」的判据 ——
  //    量出实测间隙，落在阶梯外的只记事实，挤不挤由人裁。
  const spacing = snapshot.spacing ?? {}
  const gaps = Array.isArray(spacing.blockGaps) ? spacing.blockGaps : []
  // 间隙已取整：0.5px 的容差只吸收取整误差，13px 这种「差一像素」的间隙照样算阶梯外。
  // 0px 不是一次间距取值（两块本来就贴着），不进判断；负值（重叠）要留，那是真的挤压。
  const meaningfulGaps = gaps.filter((gap) => gap !== 0)
  const offLadderGaps = meaningfulGaps.filter((gap) => !SPACING_LADDER_PX.some((step) => Math.abs(step - gap) <= 0.5))
  if (offLadderGaps.length > 0) {
    findings.push(finding({
      shot,
      area: `${surface} 面板内相邻区块之间（${gaps.length} 处间隙）`,
      observed: `不在间距阶梯（${SPACING_LADDER_PX.join(' / ')}）上的间隙：${offLadderGaps.slice(0, 6).join(' / ')}px`
        + `${offLadderGaps.length > 6 ? ` 等 ${offLadderGaps.length} 处` : ''}；面板内边距 ${spacing.panelPaddingTop ?? '?'}px`,
      disposition: '待人工判断',
      basis: { kind: 'design', ref: 'token --xs-space-*', text: '间距阶梯 4 / 8 / 12 / 16 / 20 / 24（`type-scale.md` §2 注 + `设计token字典.md` §5）；criteria 没有间距判据' },
    }))
  }

  // 现场观测（如「弹层点了没出现」）在 metrics 之前并进来：计数要与发现条数一致。
  findings.push(...(options.extraFindings ?? []))

  const metrics = {
    surface,
    viewport: snapshot.viewport ?? null,
    bodyFontSizeMin: bodyTexts.length === 0 ? null : px(Math.min(...bodyTexts.map((text) => text.fontSize))),
    bodyLineHeightRatioMin: bodyTexts.length === 0 ? null : px(Math.min(...bodyTexts.filter((text) => typeof text.ratio === 'number').map((text) => text.ratio)) ?? null),
    tiers,
    clickTargetMin: clickable.length === 0 ? null : {
      width: Math.min(...clickable.map((button) => button.rect.width)),
      height: Math.min(...clickable.map((button) => button.rect.height)),
    },
    buttonCount: buttons.length,
    primaryVisible: primaryVisible.length,
    overflowCount: texts.filter((text) => text.scrollWidth > text.clientWidth + 1).length,
    contrastMin: texts.filter((text) => typeof text.contrast === 'number').length === 0
      ? null
      : px(Math.min(...texts.filter((text) => typeof text.contrast === 'number').map((text) => text.contrast))),
    panel: snapshot.panelScroll ?? null,
    spacing: {
      panelPaddingTop: spacing.panelPaddingTop ?? null,
      blockGaps: gaps,
      offLadder: offLadderGaps,
    },
    toolbarTop: typeof bar.top === 'number' ? bar.top : null,
    toolbarRows: typeof bar.rows === 'number' ? bar.rows : null,
    headerTop: typeof snapshot.header?.top === 'number' ? snapshot.header.top : null,
    longestTextLength: texts.length === 0 ? null : Math.max(...texts.map((text) => (typeof text.textLength === 'number' ? text.textLength : 0))),
    overlayCount: overlays.length,
    textCount: texts.length,
    findings: {
      violations: findings.filter((item) => item.disposition === 'measured-violation').length,
      humanJudgement: findings.filter((item) => item.disposition === '待人工判断').length,
      gaps: findings.filter((item) => item.disposition === '判据缺口').length,
    },
  }
  return { surface, shot, findings, metrics }
}

/** WCAG 大字闭集（README §11.1）：≥24px，或 ≥18.66px 且字重 ≥700。 */
function isLargeText(text) {
  if (typeof text.fontSize !== 'number') return false
  return text.fontSize >= LARGE_TEXT_PX
    || (text.fontSize >= LARGE_TEXT_SMALL_PX && Number(text.fontWeight) >= LARGE_TEXT_MIN_WEIGHT)
}

/**
 * 汇总一份条件样本（一个采样条件下的所有面）→ 清单里的一条。
 *
 * @param {{condition: object, files: object, surfaces: Record<string, {findings: object[], metrics: object}>, notes?: string[]}} sample
 * @param {number} index 第几种条件（1 起）
 */
function conditionRecord(sample, index) {
  const surfaces = sample.surfaces ?? {}
  const measured = {}
  const findings = []
  for (const [surface, analysis] of Object.entries(surfaces)) {
    measured[surface] = analysis.metrics
    for (const item of analysis.findings ?? []) findings.push({ surface, ...item })
  }
  return {
    id: sample.condition.id,
    index,
    label: sample.condition.label,
    kind: 'sample',
    viewport: { width: sample.condition.width, height: sample.condition.height },
    colorScheme: sample.condition.colorScheme,
    files: sample.files ?? {},
    // 两个「取得到就记」的面：没取到时这里是 false，清单读者不会把缺图当成通过。
    reached: sample.reached ?? null,
    measured,
    findings,
    notes: sample.notes ?? [],
  }
}

/**
 * 造机器可读的采样清单（纯函数；`generatedAt` 由调用方给，保证同一份测量两跑字节相同）。
 *
 * @param {{generatedAt: string, conditions: {condition: object, files: object, surfaces: object, notes?: string[]}[], source?: object, content?: object}} input
 * @returns {object}
 */
export function buildVisualSamples(input = {}) {
  const conditions = (input.conditions ?? []).map((sample, index) => conditionRecord(sample, index + 1))
  const findings = conditions.flatMap((condition) => condition.findings)
  return {
    schema: SAMPLES_SCHEMA,
    caseId: 'E09',
    scenario: 'consult-visual',
    generatedAt: input.generatedAt ?? '',
    sampling: {
      note: '三种条件只是采样条件，不新增设计断点：宽窄分界全稿只有 README §3.1 那一个（≥1100 宽 / <1100 窄）',
      conditions: conditions.map((condition) => ({
        id: condition.id,
        viewport: condition.viewport,
        colorScheme: condition.colorScheme,
        kind: condition.kind,
      })),
    },
    content: input.content ?? null,
    conditions,
    totals: {
      conditions: conditions.length,
      screenshots: conditions.reduce((sum, condition) => sum + Object.keys(condition.files).length, 0),
      findings: findings.length,
      violations: findings.filter((item) => item.disposition === 'measured-violation').length,
      humanJudgement: findings.filter((item) => item.disposition === '待人工判断').length,
      gaps: findings.filter((item) => item.disposition === '判据缺口').length,
    },
    source: input.source ?? null,
  }
}

/** 清单落盘文本：2 空格缩进 + 结尾换行（与证据包其它 JSON 同形；UTF-8 无 BOM 由写入方保证）。 */
export function serialiseVisualSamples(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/** 发现是否「立得住」：区域、观测、裁定去向与依据一样都不能缺。 */
function findingIsWellFormed(item) {
  return typeof item?.area === 'string' && item.area.trim() !== ''
    && typeof item.observed === 'string' && item.observed.trim() !== ''
    && DISPOSITIONS.includes(item.disposition)
    && typeof item.basis?.kind === 'string' && Object.keys(BASES).includes(item.basis.kind)
    && typeof item.basis?.ref === 'string' && item.basis.ref.trim() !== ''
}

/**
 * E09 的终点归类（纯函数，零浏览器）。
 *
 * 口径（票 #81）：
 *   - 面板 / 真实记录缺了 → `blocked`：这是环境或前置，不记成产品缺陷；
 *   - 少一组采样 → `fail`：三组样本是这票的交付物，缺一组就没有「可比」这回事；
 *   - 有发现指不出依据 / 没标裁定去向 → `fail`：证据不成立，不许算完；
 *   - 三组齐全、每条发现都落到了判据 / 设计稿 / 「待人工判断」或「判据缺口」→ `pass`。
 *
 * `pass` 在这里的意思是**取证完成**，不是「界面没问题」：判据违例的条数写在摘要里，
 * 裁定（是不是体验债、要不要修）留给人 —— 那正是 ADR-0017 第 7 条的分工。
 *
 * @param {object} observations
 * @returns {{status: 'pass'|'fail'|'blocked', evidence?: string, reason?: string, summary: string, observed: object}}
 */
export function decideVisualOutcome(observations = {}) {
  const panel = observations.panel ?? { opened: false }
  const record = observations.record ?? { opened: false }
  const samples = Array.isArray(observations.conditions) ? observations.conditions : []
  const findings = samples.flatMap((sample) => Object.values(sample.surfaces ?? {}).flatMap((analysis) => analysis.findings ?? []))
  const overlayNotes = samples.map((sample) => sample.notes ?? []).flat()

  const observed = {
    panelOpened: panel.opened === true,
    recordOpened: record.opened === true,
    conditions: samples.map((sample) => sample.condition.id),
    screenshots: samples.reduce((sum, sample) => sum + Object.keys(sample.files ?? {}).length, 0),
    findings: findings.length,
    violations: findings.filter((item) => item.disposition === 'measured-violation').length,
    humanJudgement: findings.filter((item) => item.disposition === '待人工判断').length,
    gaps: findings.filter((item) => item.disposition === '判据缺口').length,
  }

  if (panel.opened !== true) {
    return {
      status: 'blocked',
      reason: `问事面板没打开（试了 ${panel.attempts ?? 0} 次）——环境缺前置，不记成产品缺陷`,
      summary: '问事面板不可达',
      observed,
    }
  }
  if (record.opened !== true) {
    return {
      status: 'blocked',
      reason: `历史回看里没有可读的真实问事记录${record.reason === undefined ? '' : `（${record.reason}）`}：先跑 consult-normal 留下一条正常完成的问事`,
      summary: '没有可用的真实内容',
      observed,
    }
  }

  const missing = SAMPLING_CONDITIONS
    .map((condition) => condition.id)
    .filter((id) => !samples.some((sample) => sample.condition.id === id))
  const missingSurfaces = samples.flatMap((sample) => {
    const files = Object.keys(sample.files ?? {})
    const lost = REQUIRED_SURFACES.filter((surface) => !files.includes(surface) && !(sample.notes ?? []).some((note) => note.includes(surface)))
    return lost.length === 0 ? [] : [`${sample.condition.id}: ${lost.join(' / ')}`]
  })
  if (missing.length > 0 || missingSurfaces.length > 0) {
    return {
      status: 'fail',
      evidence: [
        missing.length > 0 ? `缺少采样条件：${missing.join(' / ')}` : '',
        missingSurfaces.length > 0 ? `缺少截图面：${missingSurfaces.join('；')}` : '',
        `已取到 ${observed.screenshots} 张`,
      ].filter((item) => item !== '').join('；'),
      summary: `采样没取齐（缺 ${missing.length + missingSurfaces.length} 处）`,
      observed,
    }
  }

  const malformed = findings.filter((item) => !findingIsWellFormed(item))
  if (malformed.length > 0) {
    return {
      status: 'fail',
      evidence: `有 ${malformed.length} 条发现指不出依据或没写裁定去向：${malformed
        .slice(0, 3)
        .map((item) => `「${brief(item.observed ?? '', 16) || '（空）'}」`)
        .join('、')}`,
      summary: '发现有缺口：依据或裁定去向缺失',
      observed,
    }
  }

  const ids = samples.map((sample) => sample.condition.id)
  return {
    status: 'pass',
    evidence: `三组采样齐全：${ids.join(' / ')}；每张图都在 ${shotName(1, SAMPLING_CONDITIONS[0], 'lobby')} 的同名规则下`
      + `（e09-<条件序号>-<条件 id>-<面>.png），清单见 ${ARTIFACT_NAME}`,
    summary: `取证完成（${observed.screenshots} 张截图 / ${observed.findings} 条发现：`
      + `判据违例 ${observed.violations} · 待人工判断 ${observed.humanJudgement} · 判据缺口 ${observed.gaps}）`,
    observed,
  }
}

// ── 浏览器侧：读屏、拍照 ───────────────────────────────────────────────────

/**
 * 读一份「这一屏现在长什么样」的快照（只读 DOM，不动任何东西）。
 *
 * 为什么要在页面里算：字号 / 行高 / 溢出 / 对比度都是**计算样式**，Node 侧看不到；
 * 而 `getBoundingClientRect` 给的是这一刻相对视口的位置，正好能说「截图里第几个东西」。
 *
 * @param {import('playwright').Page} page
 * @param {{surface: string}} options
 */
export async function readSurface(page, { surface }) {
  return page.evaluate(({ panelSelector, surface, maxTexts, rowTolerance }) => {
    const round = (value) => Math.round(value * 10) / 10
    const int = (value) => Math.round(value)
    const rectOf = (node) => {
      const rect = node.getBoundingClientRect()
      return { x: int(rect.x), y: int(rect.y), width: int(rect.width), height: int(rect.height) }
    }
    const isVisible = (node) => {
      const rect = node.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false
      const style = getComputedStyle(node)
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0
    }

    /** 颜色解析：只认 rgb()/rgba()；解析不出来就记 null（不拿猜的值去判 C-003）。 */
    const parseColor = (value) => {
      const match = /rgba?\(([^)]+)\)/u.exec(String(value ?? ''))
      if (match === null) return null
      const parts = match[1].split(/[,/]/u).map((part) => part.trim())
      const channel = (text) => {
        if (text.endsWith('%')) return (Number.parseFloat(text) / 100) * 255
        return Number.parseFloat(text)
      }
      const [r, g, b] = [channel(parts[0] ?? '0'), channel(parts[1] ?? '0'), channel(parts[2] ?? '0')]
      const alpha = parts[3] === undefined ? 1 : (parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]))
      if ([r, g, b, alpha].some((value2) => !Number.isFinite(value2))) return null
      return { r, g, b, a: alpha }
    }
    const over = (top, bottom) => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1,
    })
    const luminance = ({ r, g, b }) => {
      const channel = (value) => {
        const scaled = value / 255
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
    const contrastOf = (foreground, background) => {
      const [light, dark] = [luminance(foreground), luminance(background)].sort((left, right) => right - left)
      return round((light + 0.05) / (dark + 0.05))
    }
    /** 有效背景：向上找第一个不透明层，再把中间那些半透明层依次叠上去。 */
    const effectiveBackground = (node) => {
      const layers = []
      let cursor = node
      let base = null
      while (cursor !== null && cursor !== document.documentElement.parentElement) {
        const color = parseColor(getComputedStyle(cursor).backgroundColor)
        if (color !== null && color.a > 0) {
          if (color.a >= 1) { base = color; break }
          layers.push(color)
        }
        cursor = cursor.parentElement
      }
      if (base === null) base = { r: 255, g: 255, b: 255, a: 1 }
      return layers.reverse().reduce((background, layer) => over(layer, background), base)
    }

    const roleSelectors = [
      { role: 'meta', selector: '.xs-consult__note, .xs-consult__badge, .xs-consult__shortid, .xs-consult__role, .xs-consult__empty-why + p, small' },
      // 控件标签：C-001 / C-002 不管控件标签，但它们决定「一眼能不能分出层级」，所以要量、要进 tiers。
      { role: 'control', selector: '.xs-consult__row-title' },
      { role: 'heading', selector: 'h1, h2, h3, h4, .xs-consult__round-head, .xs-consult__empty-why, .xs-consult__nudge-title' },
      { role: 'body', selector: '.xs-consult__text, .xs-consult__summary, .xs-consult__paths, .xs-consult__paths li, p, li, dd, td' },
    ]
    const roleOf = (node) => {
      for (const entry of roleSelectors) if (node.matches(entry.selector)) return entry.role
      return ''
    }

    const panel = document.querySelector(panelSelector)
    const root = panel === null ? document.body : panel
    const overlays = [...document.querySelectorAll('[role="dialog"], [data-xuanshu-overlay], [data-xuanshu-drawer]')]
      .filter((node) => isVisible(node) && (node.getAttribute('role') === 'dialog' || node.hasAttribute('data-xuanshu-overlay') || node.hasAttribute('data-xuanshu-drawer')))
    // 抽屉与它的遮罩可能各是一个元素：只留最外层那个（否则同一个弹层会被数两次）。
    const outerOverlays = overlays.filter((node) => !overlays.some((other) => other !== node && other.contains(node)))

    const roots = [root, ...outerOverlays]
    const textRecords = []
    const seen = new Set()
    for (const scanRoot of roots) {
      for (const node of scanRoot.querySelectorAll('*')) {
        const role = roleOf(node)
        if (role === '') continue
        if (seen.has(node)) continue
        // 只量「真的有字的最内层」：容器不算，否则同一句话会被量两次。
        if ([...node.querySelectorAll('*')].some((child) => roleOf(child) !== '')) continue
        const text = (node.innerText ?? node.textContent ?? '').replace(/\s+/gu, ' ').trim()
        if (text === '') continue
        seen.add(node)
        const style = getComputedStyle(node)
        const fontSize = Number.parseFloat(style.fontSize)
        const lineHeight = style.lineHeight === 'normal' ? null : Number.parseFloat(style.lineHeight)
        const foreground = parseColor(style.color)
        const background = effectiveBackground(node)
        const contrast = foreground === null ? null : contrastOf(foreground.a >= 1 ? foreground : over(foreground, background), background)
        textRecords.push({
          role,
          tag: node.tagName.toLowerCase(),
          cls: typeof node.className === 'string' ? node.className : '',
          excerpt: text.slice(0, 90),
          fontSize: Number.isFinite(fontSize) ? round(fontSize) : null,
          fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
          lineHeightPx: Number.isFinite(lineHeight) ? round(lineHeight) : null,
          ratio: Number.isFinite(lineHeight) && Number.isFinite(fontSize) && fontSize > 0 ? round(lineHeight / fontSize) : null,
          rect: rectOf(node),
          scrollWidth: int(node.scrollWidth),
          clientWidth: int(node.clientWidth),
          overflowX: style.overflowX,
          whiteSpace: style.whiteSpace,
          textOverflow: style.textOverflow,
          contrast,
          // 长文本的「有多长」也要能逐项比：只记长度，不把正文搬进清单。
          textLength: text.length,
          visible: true,
        })
        if (textRecords.length >= maxTexts) break
      }
      if (textRecords.length >= maxTexts) break
    }

    const buttonNodes = new Set()
    for (const scanRoot of roots) for (const node of scanRoot.querySelectorAll('button')) buttonNodes.add(node)
    const buttons = [...buttonNodes].map((node) => ({
      label: (node.innerText ?? node.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 40),
      cls: typeof node.className === 'string' ? node.className : '',
      primary: node.classList.contains('xs-btn--primary'),
      disabled: node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true',
      visible: isVisible(node),
      rect: rectOf(node),
    }))

    const overlayRecords = outerOverlays.map((node) => {
      const rect = node.getBoundingClientRect()
      const withinViewport = rect.left >= -1 && rect.top >= -1 && rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1
      const titleNode = node.querySelector('h1, h2, h3, h4, [id]')
      const background = parseColor(getComputedStyle(node).backgroundColor)
      return {
        kind: node.hasAttribute('data-xuanshu-drawer') ? 'drawer' : 'overlay',
        label: (titleNode?.innerText ?? node.getAttribute('aria-label') ?? '').replace(/\s+/gu, ' ').trim().slice(0, 40),
        role: node.getAttribute('role') ?? '',
        rect: rectOf(node),
        // 遮罩：这一层自己有半透明底色，或者它内部有覆盖视口的半透明层。
        maskPresent: (background !== null && background.a > 0.05)
          || [...node.querySelectorAll('*')].some((child) => {
            const childRect = child.getBoundingClientRect()
            const childBackground = parseColor(getComputedStyle(child).backgroundColor)
            return childBackground !== null && childBackground.a > 0.05
              && childRect.width >= window.innerWidth * 0.9 && childRect.height >= window.innerHeight * 0.9
          }),
        withinViewport,
        visible: true,
      }
    })

    const panelRect = panel === null ? null : rectOf(panel)
    /**
     * 一条「横条」量成 `{present, top, height, rows}`。
     *
     * `rows` 用**孩子元素的竖直中心**聚类：`align-items:center` 下同一行的中心几乎相等，
     * 换行后两行中心差 ≈ 一行高（44–56px）。用 top 分桶会把「同一行里高矮不同的控件」误判成两行
     * （实测撞到过：1024 的历史工具条只有一行，却被算成两行）。
     */
    const measureBar = (node) => {
      if (node === null) return { present: false }
      const rect = node.getBoundingClientRect()
      const centers = [...node.children]
        .map((child) => child.getBoundingClientRect())
        .filter((childRect) => childRect.width > 0 && childRect.height > 0)
        .map((childRect) => childRect.top + childRect.height / 2)
        .sort((left, right) => left - right)
      let rows = 0
      let previous = null
      for (const center of centers) {
        if (previous === null || Math.abs(center - previous) > rowTolerance) rows += 1
        previous = center
      }
      return { present: true, top: int(rect.top), height: int(rect.height), rows: Math.max(rows, 1) }
    }
    // 头（问事 + 历史回看）与工具条（← 列表 / 搜索 / 只读标记 / 继续这次问事）是两个元素，别混为一谈。
    const toolbarNode = root.querySelector('.xs-consult__toolbar')
    const headerNode = root.querySelector('.xs-consult__head')

    /**
     * 间距：面板里相邻两块的**竖向间隙**（下一块的 top − 上一块的 bottom）。
     *
     * 为什么要量这个：设计稿只给了阶梯（4 / 8 / 12 / 16 / 20 / 24，见 `type-scale.md` §2 注与
     * `设计token字典.md` §5），没有「第几块离第几块多远」的判据；量出来才能说
     * 「这一屏的间距是不是都在阶梯上」，而不是凭感觉说挤或松。
     */
    const blockNodes = panel === null ? [] : [...panel.children]
      .filter((child) => {
        const rect = child.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && getComputedStyle(child).position !== 'fixed'
      })
    const spacingGaps = []
    for (let index = 1; index < blockNodes.length; index += 1) {
      const previous = blockNodes[index - 1].getBoundingClientRect()
      const current = blockNodes[index].getBoundingClientRect()
      spacingGaps.push(int(current.top - previous.bottom))
    }
    const panelStyle = panel === null ? null : getComputedStyle(panel)
    const spacing = {
      panelPaddingTop: panelStyle === null ? null : int(Number.parseFloat(panelStyle.paddingTop) || 0),
      panelPaddingBottom: panelStyle === null ? null : int(Number.parseFloat(panelStyle.paddingBottom) || 0),
      blockGaps: spacingGaps,
    }

    return {
      surface,
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      colorScheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      panelPresent: panel !== null,
      panelRect,
      panelScroll: panel === null ? null : {
        scrollTop: int(panel.scrollTop),
        scrollHeight: int(panel.scrollHeight),
        clientHeight: int(panel.clientHeight),
        scrollWidth: int(panel.scrollWidth),
        clientWidth: int(panel.clientWidth),
      },
      docScroll: { scrollWidth: int(document.documentElement.scrollWidth), innerWidth: window.innerWidth },
      toolbar: measureBar(toolbarNode),
      header: measureBar(headerNode),
      spacing,
      texts: textRecords,
      buttons,
      overlays: overlayRecords,
    }
  }, {
    panelSelector: CONSULT,
    surface,
    maxTexts: MAX_TEXT_RECORDS,
    rowTolerance: ROW_CLUSTER_TOLERANCE_PX,
  })
}

/** 用真实窗口尺寸与主题切换采样条件（这是「采样」，不是改布局规格）。 */
async function applyCondition(ctx, condition) {
  await ctx.page.setViewportSize({ width: condition.width, height: condition.height })
  await ctx.page.emulateMedia({ colorScheme: condition.colorScheme })
  await ctx.settle(600)
}

/** 当前在问事的哪个子页（门厅 / 列表 / 阅读器）。 */
async function currentView(ctx) {
  return ctx.page.evaluate((panelSelector) => {
    const root = document.querySelector(panelSelector)
    if (root === null) return 'absent'
    if (root.querySelector('[data-xuanshu-view="reader"]') !== null) return 'reader'
    if (root.querySelector('[data-xuanshu-view="history-list"]') !== null) return 'history-list'
    return 'lobby'
  }, CONSULT)
}

/** 回到门厅（用产品自己的返回按钮；点到为止，点不动就记下来）。 */
async function ensureLobby(ctx) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const view = await currentView(ctx)
    if (view === 'lobby') return true
    if (view === 'absent') {
      const row = sidebarRow(ctx.page, '问事')
      if ((await row.count()) > 0) await row.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {})
      await ctx.settle(800)
      continue
    }
    const back = ctx.page.locator(`${CONSULT} ${view === 'reader' ? BACK_LIST : BACK_LOBBY}`).first()
    if ((await back.count()) === 0) return false
    await back.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {})
    await ctx.settle(600)
  }
  return (await currentView(ctx)) === 'lobby'
}

/** 打开历史回看列表（真实入口），等列表真的出现行。 */
async function openHistoryList(ctx) {
  const toggle = ctx.page.locator(`${CONSULT} ${HISTORY_TOGGLE}`).first()
  if ((await toggle.count()) === 0) return { opened: false, rows: 0, reason: '问事面板里没有「历史回看」入口' }
  await toggle.click({ timeout: ACTION_TIMEOUT_MS })
  const deadline = Date.now() + LIST_BUDGET_MS
  let rows = 0
  while (Date.now() < deadline) {
    rows = await ctx.page.locator(`${CONSULT} [data-xuanshu-row]`).count()
    if (rows > 0) break
    await ctx.settle(400)
  }
  await ctx.settle(600)
  return { opened: true, rows }
}

/** 从列表点开第一条真实记录，等阅读器渲染出消息。 */
async function openFirstRecord(ctx) {
  const rows = ctx.page.locator(`${CONSULT} [data-xuanshu-row]`)
  if ((await rows.count()) === 0) return { opened: false, reason: '历史回看里一条记录都没有' }
  const row = rows.first()
  const shortId = (await row.locator('.xs-consult__shortid').first().innerText().catch(() => '')).trim()
  const title = (await row.locator('.xs-consult__row-title').first().innerText().catch(() => '')).trim()
  await row.click({ timeout: ACTION_TIMEOUT_MS })
  const deadline = Date.now() + LIST_BUDGET_MS
  let messageCount = 0
  while (Date.now() < deadline) {
    messageCount = await ctx.page.locator(`${CONSULT} [data-xuanshu-message]`).count()
    if ((await currentView(ctx)) === 'reader' && messageCount > 0) break
    await ctx.settle(400)
  }
  await ctx.settle(800)
  const messages = await ctx.page.evaluate((panelSelector) => [...document.querySelectorAll(`${panelSelector} [data-xuanshu-message]`)].map((node) => ({
    role: node.getAttribute('data-xuanshu-message') ?? '',
    text: (node.querySelector('.xs-consult__text')?.innerText ?? '').replace(/\s+/gu, ' ').trim(),
  })), CONSULT)
  const assistant = [...messages].reverse().find((message) => message.role === 'assistant' && message.text.length > 40)
  return {
    opened: (await currentView(ctx)) === 'reader' && messages.length > 0,
    shortId,
    title,
    messageCount: messages.length,
    questionCount: messages.filter((message) => message.role === 'user').length,
    answerExcerpt: redactPaths(brief(assistant?.text ?? '', 60)),
    answerPresent: assistant !== undefined,
  }
}

/** 拍一张 + 读一份快照 + 翻成发现（这一步就是「一条证据」）。 */
async function capture(ctx, condition, index, surface) {
  const shot = shotName(index, condition, surface)
  await ctx.shot(shot)
  const snapshot = await readSurface(ctx.page, { surface })
  return { shot, snapshot, analysis: analyseSurface(snapshot, { shot }) }
}

/** 面板当前滚到哪（只读；用来确认「滚到底是真滚到底」，而不是滚了四下就算数）。 */
async function panelScrollTop(ctx) {
  return ctx.page.evaluate((selector) => {
    const node = document.querySelector(selector)
    return node === null ? null : Math.round(node.scrollTop)
  }, CONSULT)
}

/**
 * 真滚（鼠标滚轮 = 人的手势；不是改 DOM 的 scrollTop）。
 *
 * 一直滚到**位置不再变化**为止：窗口缩小后一屏能滚多少不一样，固定滚四下会在 1024 下停在半路，
 * 于是三组条件拍到的「第二屏」不是同一个位置，逐项比就没有意义。
 *
 * @param {number} direction 1 = 向下，-1 = 向上
 */
async function scrollPanel(ctx, direction) {
  const box = await ctx.page.locator(CONSULT).first().boundingBox().catch(() => null)
  if (box === null) return false
  const point = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 300) }
  await ctx.page.mouse.move(point.x, point.y)
  for (let step = 0; step < 12; step += 1) {
    const before = await panelScrollTop(ctx)
    await ctx.page.mouse.wheel(0, direction * 1_200)
    await ctx.settle(220)
    const after = await panelScrollTop(ctx)
    if (after === before) break
  }
  await ctx.settle(300)
  return true
}

/**
 * 试一次「继续这次问事」，看产品给不给可读错误（S7 §6 的 error 态是真实存在的一种状态）。
 * 不给（直接切进会话）也是事实：那就把面板找回来，照实记「本轮没有可读错误态」。
 */
async function captureErrorState(ctx, condition, index) {
  const button = ctx.page.locator(`${CONSULT} ${CONTINUE_ACTION}`).first()
  if ((await button.count()) === 0) return { reached: false, reason: '阅读器里没有「继续这次问事」入口' }
  await button.click({ timeout: ACTION_TIMEOUT_MS })
  const deadline = Date.now() + FEEDBACK_WINDOW_MS
  let errorText = ''
  while (Date.now() < deadline) {
    const state = await ctx.page.evaluate((panelSelector) => {
      const root = document.querySelector(panelSelector)
      return {
        present: root !== null,
        errors: root === null ? [] : [...root.querySelectorAll('[data-xuanshu-error]')].map((node) => (node.innerText ?? '').replace(/\s+/gu, ' ').trim()),
      }
    }, CONSULT)
    if (state.errors.length > 0) { errorText = state.errors.join(' / '); break }
    if (!state.present) break
    await ctx.settle(400)
  }
  if (errorText === '') {
    const view = await currentView(ctx)
    await ensureLobby(ctx)
    return { reached: false, reason: view === 'absent' ? '点「继续这次问事」后切进了会话，本轮没有可读错误态' : '点了「继续这次问事」后没有出现错误态' }
  }
  const captured = await capture(ctx, condition, index, 'error')
  await ensureLobby(ctx)
  return { reached: true, errorText: redactPaths(brief(errorText, 120)), ...captured }
}

/**
 * 打开门厅的「临时挂载…」抽屉（真实入口）并拍它；再验 Esc 关不关得掉（D8）。
 *
 * **无论开没开都要拍一张**：E09 要的是「弹层这一项看到了什么」。
 * 「点了没出现」是观测结果，不是可以跳过的分支——跳过就等于把这一项从报告里抹掉。
 */
async function captureOverlay(ctx, condition, index) {
  await ensureLobby(ctx)
  await scrollPanel(ctx, -1)
  const open = ctx.page.locator(`${CONSULT} ${OPEN_MOUNTS}`).first()
  let reason = ''
  if ((await open.count()) === 0) {
    reason = '门厅没有「临时挂载…」入口'
  } else if (await open.isDisabled().catch(() => false)) {
    reason = '「临时挂载…」是禁用态（没有可挂的会话 / 账本没接上）'
  } else {
    try {
      await open.click({ timeout: ACTION_TIMEOUT_MS })
    } catch {
      reason = '点「临时挂载…」没点成（被遮住或控件不可点）'
    }
    if (reason === '') {
      const deadline = Date.now() + ACTION_TIMEOUT_MS
      let visible = false
      while (Date.now() < deadline) {
        visible = await ctx.page.locator(MOUNTS_DRAWER).first().isVisible().catch(() => false)
        if (visible) break
        await ctx.settle(300)
      }
      if (!visible) reason = '点了「临时挂载…」但没有出现抽屉（15s 内）'
    }
  }

  const reached = reason === ''
  if (reached) await ctx.settle(500)
  // 取景对准「点的那一块」：窄屏下挂载区在折叠线以下，点它会顺手把面板滚一段；
  // 三组条件如果不把镜头对准同一块，弹层这一项的图就没法互相比。
  const mountsSection = ctx.page.locator(`${CONSULT} [data-xuanshu-section="mounts"], ${CONSULT} [data-xuanshu-block="mounts"]`).first()
  if ((await mountsSection.count()) > 0) await mountsSection.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {})
  await ctx.settle(300)
  const shot = shotName(index, condition, 'overlay')
  await ctx.shot(shot)
  const snapshot = await readSurface(ctx.page, { surface: 'overlay' })
  const analysis = analyseSurface(snapshot, {
    shot,
    ...(reached ? {} : { extraFindings: [overlayMissingFinding({ shot, reason })] }),
  })
  if (!reached) return { reached, reason, closedBy: 'n/a', shot, analysis }

  // D8：Esc 要能关掉浮层。关不掉就再点一次真实关闭按钮（不按 Esc 硬猜）。
  await ctx.page.keyboard.press('Escape')
  await ctx.settle(500)
  let closedBy = 'esc'
  if (await ctx.page.locator(MOUNTS_DRAWER).first().isVisible().catch(() => false)) {
    const close = ctx.page.locator(CLOSE_MOUNTS).first()
    closedBy = 'close-button'
    if ((await close.count()) > 0) {
      await close.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {})
      await ctx.settle(500)
    }
    if (await ctx.page.locator(MOUNTS_DRAWER).first().isVisible().catch(() => false)) closedBy = 'still-open'
  }
  return { reached, reason: '', closedBy, shot, analysis }
}

// ── 场景定义 ────────────────────────────────────────────────────────────────

/** 场景要产出的全部文件名（三种条件 × 六个面）。`shots` 是给人看的清单，不是断言。 */
const ALL_SHOTS = SAMPLING_CONDITIONS.flatMap((condition, index) => SURFACES.map((surface) => shotName(index + 1, condition, surface)))

/**
 * E09 一条场景：真实内容 × 三种采样条件。
 */
export const CONSULT_VISUAL_SCENARIOS = {
  'consult-visual': {
    id: 'consult-visual',
    caseId: 'E09',
    title: '视觉复核：真实问事内容 × 三种采样条件（1280×900 浅 / 1024×768 / 1280×900 深）',
    shots: ALL_SHOTS,
    /**
     * 顺序：真实内容 → 三种条件各拍六个面 → 落机器可读清单。
     * 内容只打开一次（换条件不换记录），这样三组图**数据条件相同**，差异只来自窗口与主题。
     */
    async run(ctx) {
      ctx.log('正在等：页面首屏（客户端插件异步挂载）')
      await ctx.page.goto(ctx.env.url, { waitUntil: 'domcontentloaded' })
      await ctx.settle(4_000)
      const firstRun = await dismissFirstRun(ctx)
      ctx.step({
        action: '完成必要首跑操作（关闭首跑模态）',
        target: 'first-run-modals',
        outcome: firstRun.labels.length === 0 ? '首屏没有出现首跑模态' : `关掉 ${firstRun.labels.length} 层：${firstRun.labels.join(' → ')}`,
      })
      await ctx.note('三种采样条件由本场景自己切换（窗口尺寸 + 主题）：它们是采样条件，不新增设计断点；'
        + 'environment.json 里的 1280×900 / light 是 runner 起浏览器时的默认值，实际条件以 visual-samples.json 的 viewport 为准。')

      const entry = await openConsult(ctx)
      const panel = { opened: entry.opened, attempts: entry.attempts }
      ctx.step({
        action: '点侧栏「问事」打开问事面板',
        target: CONSULT,
        outcome: entry.opened ? `面板出现（第 ${entry.attempts} 次点开）` : `面板没打开（试了 ${entry.attempts} 次）`,
      })
      if (!entry.opened) {
        return { status: decideVisualOutcome({ panel, record: { opened: false }, conditions: [] }), observations: { headline: '问事面板不可达' } }
      }

      ctx.log('正在等：历史回看里的真实记录（E03/E06 留下的内容）')
      const list = await openHistoryList(ctx)
      const record = list.opened && list.rows > 0 ? await openFirstRecord(ctx) : { opened: false, reason: list.reason ?? '历史回看为空' }
      ctx.step({
        action: '从历史回看打开一条真实问事记录（真实内容，不是夹具）',
        target: `${CONSULT} 历史回看 → 阅读器`,
        outcome: record.opened
          ? `短 id=${record.shortId}；标题「${brief(record.title, 20)}」；消息 ${record.messageCount} 条；AI 回复在=${record.answerPresent}`
          : `没有打开：${record.reason ?? '未知'}`,
        ...(record.opened ? { shot: shotName(1, SAMPLING_CONDITIONS[0], 'reader') } : {}),
      })
      if (!record.opened) {
        return {
          status: decideVisualOutcome({ panel, record, conditions: [] }),
          observations: { headline: '没有可用的真实内容（先跑 consult-normal）' },
        }
      }

      const samples = []
      for (const [index, condition] of SAMPLING_CONDITIONS.entries()) {
        const ordinal = index + 1
        const files = {}
        const surfaces = {}
        const notes = []
        ctx.log(`正在等：采样条件 ${ordinal}/${SAMPLING_CONDITIONS.length}（${condition.label}）`)

        await applyCondition(ctx, condition)
        await ensureLobby(ctx)

        /**
         * 每个面开拍前都先把面板滚回顶部：上一面留下的滚动位置会把「第二张图」拍成半截屏，
         * 三组条件就没法逐项比（实测撞到过：深色门厅是从 scrollTop=462 拍的）。
         * `reader-bottom` 例外——它要的就是滚到底之后的画面。
         */
        const shoot = async (surface, { resetScroll = true } = {}) => {
          if (resetScroll) await scrollPanel(ctx, -1)
          const captured = await capture(ctx, condition, ordinal, surface)
          files[surface] = captured.shot
          surfaces[surface] = captured.analysis
          ctx.step({
            action: `采样 ${condition.label} · ${surface}`,
            target: CONSULT,
            outcome: `${captured.snapshot.viewport.width}×${captured.snapshot.viewport.height} / ${captured.snapshot.colorScheme}；`
              + `发现 ${captured.analysis.findings.length} 条（违例 ${captured.analysis.metrics.findings.violations} · `
              + `待人工判断 ${captured.analysis.metrics.findings.humanJudgement} · 缺口 ${captured.analysis.metrics.findings.gaps}）`,
            shot: captured.shot,
          })
          return captured
        }

        await ensureLobby(ctx)
        await shoot('lobby')

        const listOpened = await openHistoryList(ctx)
        if (listOpened.opened) await shoot('history')
        else notes.push(`history: 历史回看没打开（${listOpened.reason ?? '未知'}）`)

        const readerOpened = await openFirstRecord(ctx)
        if (readerOpened.opened) await shoot('reader')
        else notes.push('reader: 阅读器没打开')

        if (readerOpened.opened) {
          await scrollPanel(ctx, 1) /* 向下滚到底：拍长文本的第二屏（不回到顶部） */
          await shoot('reader-bottom', { resetScroll: false })
        }

        await scrollPanel(ctx, -1)
        const error = await captureErrorState(ctx, condition, ordinal)
        if (error.reached) {
          files.error = error.shot
          surfaces.error = error.analysis
          ctx.step({
            action: `采样 ${condition.label} · error（点「继续这次问事」后产品给的可读错误）`,
            target: `${CONSULT} [data-xuanshu-error]`,
            outcome: `错误文案：${error.errorText}`,
            shot: error.shot,
          })
        } else {
          notes.push(`error: ${error.reason}`)
          ctx.step({
            action: `采样 ${condition.label} · error（没有可读错误态）`,
            target: `${CONSULT} ${CONTINUE_ACTION}`,
            outcome: error.reason,
          })
        }

        await ensureLobby(ctx)
        // 弹层：点了之后无论开没开都要拍一张——「点了没出现」本身就是这一项的观测结果。
        const overlay = await captureOverlay(ctx, condition, ordinal)
        files.overlay = overlay.shot
        surfaces.overlay = overlay.analysis
        notes.push(overlay.reached ? `overlay: 抽屉出现（Esc=${overlay.closedBy === 'esc'}）` : `overlay: ${overlay.reason}`)
        ctx.step({
          action: `采样 ${condition.label} · overlay（门厅「临时挂载…」抽屉）`,
          target: OPEN_MOUNTS,
          outcome: overlay.reached
            ? `抽屉出现（宽 ${overlay.analysis.metrics.overlayCount} 个浮层；Esc 关掉=${overlay.closedBy === 'esc'}，实际：${overlay.closedBy}）`
            : `${overlay.reason}（已保留点击后的画面）`,
          shot: overlay.shot,
        })
        await ensureLobby(ctx)

        samples.push({
          condition,
          files,
          surfaces,
          notes,
          reached: {
            error: error.reached === true,
            errorText: error.reached === true ? error.errorText : '',
            overlay: overlay.reached === true,
            overlayClosedBy: overlay.closedBy,
          },
        })
      }

      const manifest = buildVisualSamples({
        generatedAt: new Date().toISOString(),
        conditions: samples,
        content: {
          source: 'history-reader',
          shortId: record.shortId,
          title: record.title,
          messageCount: record.messageCount,
          answerPresent: record.answerPresent,
          note: '三组图共用同一条真实记录：差异只来自窗口尺寸与主题',
        },
        source: { url: 'sanitised', home: ctx.env.home },
      })
      // 落盘走 runner 的 `files` 通道（票 #80 加的）：场景只交出「文件名 + JSON 值」，
      // 写到哪、怎么格式化由证据包决定（`writeEvidencePack` 会把它们列进 files 清单里）。
      const written = { bytes: Buffer.byteLength(serialiseVisualSamples(manifest), 'utf8') }
      ctx.step({
        action: '落机器可读的采样清单（下一轮逐项比）',
        target: ARTIFACT_NAME,
        outcome: `${manifest.totals.conditions} 组条件 / ${manifest.totals.screenshots} 张截图 / ${manifest.totals.findings} 条发现`
          + `（违例 ${manifest.totals.violations} · 待人工判断 ${manifest.totals.humanJudgement} · 缺口 ${manifest.totals.gaps}）；`
          + `${written.bytes} 字节`,
      })

      const decision = decideVisualOutcome({ panel, record, conditions: samples })
      const allFindings = samples.flatMap((sample) => Object.values(sample.surfaces).flatMap((analysis) => analysis.findings))
      return {
        status: decision,
        observations: {
          panel: { opened: panel.opened, attempts: panel.attempts },
          record: { opened: record.opened, messageCount: record.messageCount, answerPresent: record.answerPresent },
          sampling: manifest.conditions.map((condition) => ({
            id: condition.id,
            viewport: `${condition.viewport.width}×${condition.viewport.height}`,
            colorScheme: condition.colorScheme,
            shots: Object.keys(condition.files).length,
          })),
          findings: {
            violations: allFindings.filter((item) => item.disposition === 'measured-violation').length,
            humanJudgement: allFindings.filter((item) => item.disposition === '待人工判断').length,
            gaps: allFindings.filter((item) => item.disposition === '判据缺口').length,
          },
          headline: `样本=${manifest.conditions.length} 组 / ${manifest.totals.screenshots} 张；`
            + `违例=${allFindings.filter((item) => item.disposition === 'measured-violation').length}；`
            + `待人工判断=${allFindings.filter((item) => item.disposition === '待人工判断').length}；`
            + `缺口=${allFindings.filter((item) => item.disposition === '判据缺口').length}`,
        },
        // 机器可读的采样清单：交出「文件名 → JSON 值」，由 runner 的 files 通道落在截图旁边。
        files: { [ARTIFACT_NAME]: manifest },
      }
    },
  },
}
