#!/usr/bin/env node
/**
 * `scripts/ux/collect/browser-nav.mjs` —— 判据族 `N` 的**浏览器采样**（spec 003 §12；#60）。
 *
 * 三条判据要的事实都只有真浏览器给得出来，所以采样只做三件事、一件都不判：
 *   1. `census()`：把当前页面上**所有能点且点得通的入口**收一遍（谁 → 哪个面 → 哪个原语），
 *      每采一次就记一份**快照**（同一时刻的那一组门），另外再累加成一棵跨采样的「入口 → 面」表。
 *      N-001 的原料是**快照**，不是累加表 —— 理由见 `entriesInWorstSnapshot()`；
 *   2. `landing()`：此刻**站在哪个界面面**上（`data-xuanshu-panel` / `role="dialog"` 认）；
 *      剧本关掉抽屉 / 退回子页之后调它，就是 N-002 的「落点」；
 *   3. `keyboard()` / `esc()`：在本面里 Tab 走一遍、按 Esc 关抽屉，记下每一步的焦点与描边（N-003 的原料）。
 *
 * 三条纪律：
 *   - **不判对错**：这里没有 `pass` / `fail` 字样，只有事实；「算不算过」在 `assertions/n.mjs`。
 *   - **原语收不全就说收不全**：命令原语今天在隔离实例里渲染不出来（`Ctrl+K` 不弹面板），
 *     采到的 `coverage.primitives` 里就不会有 `command` —— 报告据此说「未观测」，不装作看过。
 *   - **置灰的入口不算入口**：`disabled` / `aria-disabled` 一律不收（点击不会发生，就不能当门）。
 *
 * 页面里的采样函数是**自包含**的（`page.evaluate` 只序列化函数源码，拿不到模块作用域），
 * 所以它们把口径当参数收（`serializeActions()`），而不是直接读 `nav-vocabulary.mjs`。
 *
 * 仅使用 Node 内置模块 + Playwright 的 Page。ESM。
 */
import { ENTRY_PRIMITIVES, NAV_ACTIONS, serializeActions } from '../nav-vocabulary.mjs'

// ─────────────────────────────────────────────────────────────────────────────
// 页面内采样（自包含：不引用模块作用域的任何名字）
// ─────────────────────────────────────────────────────────────────────────────

/** 页面上此刻可见、可点的入口 → `{face, label, primitive, panel, via}[]`。 */
function pageCensus(spec) {
  const norm = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }
  const primitiveOf = (el) => {
    let node = el
    while (node !== null && node !== document.body) {
      const cls = typeof node.className === 'string' ? node.className : ''
      if (node.tagName === 'NAV' && /panelList/.test(cls)) return 'sidebar-row'
      if (node.getAttribute('role') === 'dialog') return 'drawer'
      if (/composer|dock/i.test(cls)) return 'composer-dock'
      if (/command|palette/i.test(cls)) return 'command'
      node = node.parentElement
    }
    return 'panel'
  }
  const panelKeyOf = () => {
    const roots = [...document.querySelectorAll('[data-xuanshu-panel]')].filter(
      (el) => visible(el) && (el.tagName === 'MAIN' || el.tagName === 'SECTION' || el.classList.contains('xs-overview')),
    )
    const root = roots[0]
    return root === undefined ? 'conversation' : root.getAttribute('data-xuanshu-panel')
  }
  const panel = panelKeyOf()
  const out = []
  for (const el of document.querySelectorAll('button,[role="button"],a[href]')) {
    if (!visible(el)) continue
    if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') continue
    const label = norm(el.getAttribute('aria-label') ?? el.innerText ?? el.textContent ?? '').replace(/\s+/g, ' ')
    let face = null
    let via = null
    const navTarget = el.getAttribute('data-xuanshu-nav')
    if (navTarget !== null && Object.prototype.hasOwnProperty.call(spec.navTargets, navTarget)) {
      face = spec.navTargets[navTarget]
      via = 'data-xuanshu-nav'
    } else if (label !== '') {
      for (const action of spec.actions) {
        if (new RegExp(action.source, action.flags).test(label)) {
          face = action.face
          via = 'label'
          break
        }
      }
    }
    if (face === null) continue
    out.push({ face, label: label.slice(0, 40), primitive: primitiveOf(el), panel, via })
  }
  return out
}

/** 此刻站在哪个界面面（抽屉优先：它盖在面板之上）。 */
function pageLanding(spec) {
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible)
  for (const dialog of dialogs) {
    const titleId = dialog.getAttribute('aria-labelledby')
    if (titleId !== null && Object.prototype.hasOwnProperty.call(spec.drawerFaces, titleId)) return spec.drawerFaces[titleId]
    const marker = dialog.getAttribute('data-xuanshu-drawer')
    if (marker !== null) return `dialog:${marker}`
    return 'dialog:unknown'
  }
  const roots = [...document.querySelectorAll('[data-xuanshu-panel]')].filter(
    (el) => visible(el) && (el.tagName === 'MAIN' || el.tagName === 'SECTION' || el.classList.contains('xs-overview')),
  )
  const root = roots[0]
  if (root === undefined) return 'panel:conversation'
  return `panel:${root.getAttribute('data-xuanshu-panel')}`
}

/** 有没有可见的 `role="dialog"`（Esc 关抽屉前后的同一个问题）。 */
function pageHasDialog() {
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }
  return [...document.querySelectorAll('[role="dialog"]')].some(visible)
}

/** 把焦点放到本面的第一个控件上（之后按 Tab 才是键盘模态，`:focus-visible` 才会成立）。 */
function pageFocusFirst(selector) {
  const root = document.querySelector(selector)
  if (root === null) return { found: false, controls: 0 }
  const controls = [
    ...root.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]'),
  ].filter((el) => {
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  })
  if (controls.length === 0) return { found: true, controls: 0 }
  controls[0].focus()
  return { found: true, controls: controls.length }
}

/** 此刻的焦点在哪、还在本面里吗、描边看得见吗。 */
function pageActive(selector) {
  const norm = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')
  const el = document.activeElement
  const root = selector === null || selector === undefined ? null : document.querySelector(selector)
  if (el === null || el === document.body || el === document.documentElement) {
    return { tag: 'body', label: '', inFace: false, focusVisible: false, outline: 'none', visibleFocus: false }
  }
  const style = getComputedStyle(el)
  const width = Number.parseFloat(style.outlineWidth === '' ? '0' : style.outlineWidth)
  const outlineVisible = style.outlineStyle !== 'none' && Number.isFinite(width) && width > 0
  const shadowVisible = style.boxShadow !== '' && style.boxShadow !== 'none'
  return {
    tag: el.tagName.toLowerCase(),
    label: norm(el.getAttribute('aria-label') ?? el.innerText ?? el.textContent ?? '').slice(0, 40),
    inFace: root !== null && root !== undefined && root.contains(el),
    focusVisible: el.matches(':focus-visible'),
    outline: `${style.outlineStyle} ${style.outlineWidth}`.trim(),
    visibleFocus: outlineVisible || shadowVisible,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Node 侧：采样器 + 证据原料
// ─────────────────────────────────────────────────────────────────────────────

/** 一次采集的入口表 / 关闭事件 / 键盘走查都落在这里（跨剧本累加：同一次运行 = 同一次观察）。 */
export function createNavStore() {
  return {
    /** 跨采样累加的入口（同一扇门采两遍只算一条）：给「这面一共出现过哪些门」用。 */
    entries: new Map(),
    /** 逐次采样的**快照**（每次 `census()` 一组）：给「同一时刻有几扇门」用（N-001）。 */
    snapshots: [],
    closes: [],
    keyboards: new Map(),
    samples: 0,
    panels: new Set(),
    primitives: new Set(),
  }
}

/** 采样覆盖面的自述（报告要能说「命令原语没观测到」）。 */
export function coverageOf(store) {
  if (store === null || store === undefined) return { samples: 0, panels: [], primitives: [] }
  return {
    samples: store.samples,
    panels: [...store.panels].sort(),
    primitives: ENTRY_PRIMITIVES.filter((primitive) => store.primitives.has(primitive)),
  }
}

/**
 * 造剧本用的 `nav` 帮手。
 *
 * @param {{page: import('playwright').Page, store: ReturnType<typeof createNavStore>, settle: (page: object, ms?: number) => Promise<void>}} input
 */
export function createNav({ page, store, settle }) {
  const spec = serializeActions()

  /** 收一遍入口（记一份快照 + 累加进 store；返回这一次的原始条目，剧本可据它写 step）。 */
  const census = async (tag) => {
    const entries = await page.evaluate(pageCensus, spec)
    store.samples += 1
    // 快照是 N-001 的原料：判据原文「同一动作名出现在两个及以上入口即红」说的是**同一时刻**。
    // 跨采样并集会把「空态一扇门 / 有藏态一扇门」这种**互斥**的两扇并成一条重复入口，
    // 于是要么误报红（逼人把两扇门起同一个名字来骗过判据），要么判据从此没有牙。
    store.snapshots.push(entries.map((entry) => ({ ...entry })))
    for (const entry of entries) {
      const key = `${entry.face}\u0000${entry.primitive}\u0000${entry.label}`
      if (!store.entries.has(key)) store.entries.set(key, { ...entry, firstSeenAt: tag })
      store.panels.add(entry.panel)
      store.primitives.add(entry.primitive)
    }
    return entries
  }

  /** 此刻站在哪个界面面。 */
  const landing = () => page.evaluate(pageLanding, spec)

  /** 记一次「关掉 X 之后落在哪」。剧本自己负责真的去关，这里只记事实。 */
  const recordClose = (event) => {
    store.closes.push(event)
    return event
  }

  /**
   * 在本面里 Tab 走一遍：先聚焦本面第一个控件，再按 `tabs` 次 Tab，逐步记焦点与描边。
   *
   * `expect` 是「本面的主操作」的可访问名（可给多个候选）：这条剧本要证明的那一步必须**Tab 得到**，
   * 否则「键盘能走完一条任务」就是空话。它只记录「有没有停到」，判不判得过在 assertions。
   *
   * @param {string} faceId 界面面 id
   * @param {{root: string, tabs?: number, expect?: string[]}} options `root` 是本面的 CSS 选择器
   */
  const keyboard = async (faceId, { root, tabs = 8, expect = [] } = {}) => {
    const focus = await page.evaluate(pageFocusFirst, root)
    const stops = []
    if (focus.controls > 0) {
      for (let index = 0; index < tabs; index += 1) {
        await page.keyboard.press('Tab')
        stops.push(await page.evaluate(pageActive, root))
      }
    }
    const inFace = stops.filter((stop) => stop.inFace === true)
    const reached = expect.filter((wanted) => inFace.some((stop) => stop.label.includes(wanted)))
    const walk = {
      face: faceId,
      root: root ?? null,
      found: focus.found,
      controls: focus.controls,
      expect: [...expect],
      reached,
      stops,
    }
    store.keyboards.set(faceId, walk)
    return walk
  }

  /** 抽屉开着吗？按一次 Esc 之后还开着吗？ */
  const esc = async () => {
    const before = await page.evaluate(pageHasDialog)
    if (!before) return { applicable: false, closed: null }
    await page.keyboard.press('Escape')
    await settle(page, 400)
    const after = await page.evaluate(pageHasDialog)
    return { applicable: true, closed: !after }
  }

  return { census, landing, recordClose, keyboard, esc }
}

/** 入口的固定排序（按原语顺序、再按文案；同一批事实必须给同一份字节）。 */
function sortedEntries(entries) {
  const order = (primitive) => {
    const index = ENTRY_PRIMITIVES.indexOf(primitive)
    return index === -1 ? ENTRY_PRIMITIVES.length : index
  }
  return [...entries]
    .sort((left, right) => order(left.primitive) - order(right.primitive) || left.label.localeCompare(right.label, 'zh-CN'))
    .map((entry) => ({ primitive: entry.primitive, label: entry.label, panel: entry.panel, via: entry.via }))
}

/** 跨采样累加表 → 按原语顺序、再按文案排好的数组。 */
export function entriesFor(store, face) {
  if (store === null || store === undefined) return []
  return sortedEntries([...store.entries.values()].filter((entry) => entry.face === face))
}

/**
 * **某一面最糟的那一次采样**：所有快照里「同一动作的入口数」最多的那一份（并列取靠前的）。
 *
 * 为什么是快照而不是并集：判据 N-001 说的是「同一动作名出现在两个及以上入口」——
 * 那只能是**同一时刻**的两扇门。互斥的两个状态各有一扇同名/异名的门，并集会把它们算成
 * 「重复入口」，于是修法退化成「把两个门改成同一个名字让并集去重」：门没少，判据没了牙。
 *
 * @param {ReturnType<typeof createNavStore>} store
 * @param {string} face 界面面 id
 * @returns {{primitive: string, label: string, panel: string, via: string}[]} 那一份快照里这一面的门
 */
export function entriesInWorstSnapshot(store, face) {
  return worstSnapshotOf(store, face).entries
}

/**
 * 最糟快照 + 它是第几次采样（报告要能说「判的是哪一次」，否则红没法复现）。
 * @returns {{index: number, entries: object[], samples: number}}
 */
function worstSnapshotOf(store, face) {
  const snapshots = Array.isArray(store?.snapshots) ? store.snapshots : []
  let worst = { index: -1, entries: [] }
  snapshots.forEach((snapshot, index) => {
    const doors = sortedEntries(snapshot.filter((entry) => entry.face === face))
    // 严格大于：并列时留**靠前**的那一份（先看到的那次，报告里先说）。
    if (doors.length > worst.entries.length) worst = { index, entries: doors }
  })
  return { ...worst, samples: snapshots.length }
}

/**
 * 一条 N 判据 × 一个界面面 → 证据的 `facts` 形状（没有这一面的观察就返回 `null` = 未采到）。
 *
 * 三种形状各自只在**真采到过**的时候才给：没采到的面判成 `not-collected`，绝不给空 facts
 * （空 facts 会被谓词判成「没问题」，那正是本 spec 最想封死的那条路）。
 *
 * @param {string} criterionId
 * @param {string} face
 * @param {ReturnType<typeof createNavStore>} store
 * @returns {object | null}
 */
export function navFactsFor(criterionId, face, store) {
  if (store === null || store === undefined) return null
  if (criterionId === 'N-001') {
    // 快照口径：判「同一时刻有几扇门」，不判「这个面一共出现过哪些门」（见 `entriesInWorstSnapshot`）。
    const worst = worstSnapshotOf(store, face)
    if (worst.entries.length === 0) return null
    const action = NAV_ACTIONS.find((candidate) => candidate.face === face)
    return {
      face,
      action: action === undefined ? null : { id: action.id, label: action.label },
      entries: worst.entries,
      // 「判的是哪一次」是证据的一部分：并列取靠前，报告里要能对上步骤记录。
      snapshot: { index: worst.index, doors: worst.entries.length, samples: worst.samples },
      coverage: coverageOf(store),
    }
  }
  if (criterionId === 'N-002') {
    const events = store.closes.filter((event) => event.opened === face)
    if (events.length === 0) return null
    return { face, events: events.map((event) => ({ ...event })) }
  }
  if (criterionId === 'N-003') {
    const walk = store.keyboards.get(face)
    if (walk === undefined) return null
    return { ...walk, coverage: coverageOf(store) }
  }
  return null
}
