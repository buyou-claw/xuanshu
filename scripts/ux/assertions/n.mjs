#!/usr/bin/env node
/**
 * `scripts/ux/assertions/n.mjs` —— 判据族 `N`（导航：入口唯一 / 返回落点 / 键盘可达）的**判定**。
 *
 * 形状：`(facts) => { pass, message }`。**不读文件、不碰环境**：同一份 facts 必须给同一个答案。
 *
 * 三条判据的原料全部来自**真浏览器**（`collect/browser-nav.mjs`）：入口表、关闭后的落点、
 * Tab 走查的每一步焦点与描边。所以这里一个源码事实都不读 —— issue #60 明写「不靠读源码推断」。
 *
 * message 的硬要求（#60 验收最后一条）：每条红都要指得到「**哪个界面面 + 哪个入口 + 期望落点**」。
 * 所以三条的 message 都以「面 + 具体东西 + 期望」的句式写，不写「不符合规范」这种没法修的话。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { NAV_KIND_LABEL, faceLabelOf, primitiveLabelOf } from '../nav-vocabulary.mjs'

/** 一条入口的人话写法：`侧栏行「谱」`。 */
function entryText(entry) {
  return `${primitiveLabelOf(entry.primitive)}「${entry.label}」`
}

/** 面的短名（`panel:pus` → `panel:pus 谱管理`）。 */
function faceText(face, faces) {
  const label = faceLabelOf(face, faces)
  return label === face ? face : `${face} ${label}`
}

export const N_ASSERTIONS = {
  /**
   * N-001：同一个动作在**同一时刻**只有一个入口。
   *
   * 红的口径：某一次采样里，这个面被 ≥2 个入口指着（跨原语、或同一原语里两处都算 ——
   * 「同一动作出现在多个入口」的字面含义）。message 逐个点名，让修的人知道该删哪一个。
   *
   * `facts.entries` 必须来自采集器的**快照**口径（`browser-nav.mjs` 的 `entriesInWorstSnapshot`）：
   * 互斥的两个状态各一扇门不是重复入口，把它们并成一份再判红，只会逼人用「两个门起同一个名字」
   * 去骗过判据 —— 门没少，判据反而没了牙。
   *
   * @param {{face: string, action: {id: string, label: string} | null, entries: {primitive: string, label: string, panel: string}[], snapshot?: {index: number, doors: number, samples: number}, coverage?: object}} facts
   */
  'N-001': (facts) => {
    const entries = Array.isArray(facts?.entries) ? facts.entries : []
    const face = facts?.face ?? '(未知面)'
    const actionLabel = facts?.action?.label ?? faceLabelOf(face)
    const snapshot = facts?.snapshot
    // 「判的是哪一次采样」：只在真采过多次时说出来（一次采样没有比较的意义）。
    const when = typeof snapshot?.samples === 'number' && snapshot.samples > 1
      ? `（第 ${snapshot.index + 1} 次采样：${snapshot.samples} 次里入口最多的那一次）`
      : ''
    if (entries.length === 0) {
      // 一个入口都没采到：这不是「唯一」，是没采到（采集器本该在不产证据时留空）。
      return { pass: false, message: `${faceText(face)}：没有采到任何入口，证据不足以判「入口唯一」` }
    }
    const primitives = [...new Set(entries.map((entry) => entry.primitive))]
    const where = entries.map((entry) => `${entryText(entry)}（在 ${entry.panel}）`).join('、')
    if (entries.length === 1) {
      return { pass: true, message: `动作「${actionLabel}」只有一个入口：${entryText(entries[0])}${when}` }
    }
    const crossPrimitive = primitives.length > 1
    return {
      pass: false,
      message: `动作「${actionLabel}」→ ${faceText(face)} 同一次采样里有 ${entries.length} 个入口${when}`
        + `（${crossPrimitive ? `跨 ${primitives.length} 种原语（${primitives.map(primitiveLabelOf).join(' / ')}）` : '同一个原语里就有多处'}）：`
        + `${where}；期望只留一个`,
    }
  },

  /**
   * N-002：关闭抽屉 / 面板后回到来处（落回首页即红）。
   *
   * `events[].from` = 打开时站的面，`opened` = 被关掉的那个面，`landed` = 关掉之后站的面。
   * 判据只看一件事：`landed === from`。落回 `panel:overview` 单独点名（那正是 #60 说的那条）。
   *
   * @param {{face: string, events: {from: string, opened: string, closedBy: string, landed: string}[]}} facts
   */
  'N-002': (facts) => {
    const events = Array.isArray(facts?.events) ? facts.events : []
    const face = facts?.face ?? '(未知面)'
    if (events.length === 0) {
      return { pass: false, message: `${faceText(face)}：没有观测到关闭事件，证据不足以判「回到来处」` }
    }
    const wrong = events.filter((event) => event.landed !== event.from)
    if (wrong.length === 0) {
      const event = events[0]
      return {
        pass: true,
        message: `${events.length} 次关闭都回到来处（${event.closedBy} 关掉 ${faceText(event.opened)} → 落在 ${event.from}）`,
      }
    }
    const detail = wrong
      .map((event) => {
        const landed = faceText(event.landed, [])
        const hint = event.landed === 'panel:overview' ? '——落回首页了' : ''
        return `用 ${event.closedBy} 关掉 ${faceText(event.opened)} 后落在 ${landed}，期望回到 ${faceText(event.from)}${hint}`
      })
      .join('；')
    return { pass: false, message: `${wrong.length}/${events.length} 次关闭没回到来处：${detail}` }
  },

  /**
   * N-003：键盘能走完一条任务。
   *
   * 三件事一起判（缺一件都不是「键盘走得完」）：
   *   1. **Tab 顺序可达**：本面里至少有 `min(控件数, 2)` 个骤停点落在本面内，且剧本点名的**主操作**
   *      （`expect`）必须真的被 Tab 到 —— 主操作 Tab 不到，「走完一条任务」就不成立；
   *   2. **焦点可见**：每个本面内的骤停点都有可见描边（`:focus-visible` 且 outline / box-shadow 不是 none）；
   *   3. **Esc 能关抽屉**：面本身是抽屉时，按一次 Esc 必须把它关掉。
   *
   * @param {{face: string, controls: number, expect?: string[], reached?: string[], stops: {tag: string, label: string, inFace: boolean, focusVisible: boolean, outline: string, visibleFocus: boolean}[], esc?: {applicable: boolean, closed: boolean | null}}} facts
   */
  'N-003': (facts) => {
    const face = facts?.face ?? '(未知面)'
    const stops = Array.isArray(facts?.stops) ? facts.stops : []
    const inFace = stops.filter((stop) => stop.inFace === true)
    const problems = []

    const controls = Number.isInteger(facts?.controls) ? facts.controls : 0
    const expected = Math.min(controls, 2)
    if (controls === 0) {
      problems.push('本面一个可聚焦控件都没有（键盘无从下手）')
    } else if (inFace.length < expected) {
      problems.push(`Tab 在本面只停 ${inFace.length} 个控件（期望至少 ${expected} 个：键盘走不完一条任务）`)
    }

    const wanted = Array.isArray(facts?.expect) ? facts.expect : []
    const reached = Array.isArray(facts?.reached) ? facts.reached : []
    const missed = wanted.filter((label) => !reached.includes(label))
    if (missed.length > 0) {
      problems.push(`主操作 Tab 不到：${missed.map((label) => `「${label}」`).join('、')}（按 ${stops.length} 次 Tab 都没停到它）`)
    }

    const dim = inFace.filter((stop) => stop.visibleFocus !== true || stop.focusVisible !== true)
    if (dim.length > 0) {
      const names = dim.slice(0, 4).map((stop) => `「${stop.label === '' ? stop.tag : stop.label}」outline ${stop.outline}`).join('、')
      problems.push(`焦点看不见：${names}`)
    }

    const esc = facts?.esc
    if (esc !== undefined && esc !== null && esc.applicable === true && esc.closed !== true) {
      problems.push(`Esc 关不掉这个抽屉（按了 Esc 它还在；${faceText(face)}）`)
    }

    if (problems.length === 0) {
      const taskNote = wanted.length > 0 ? `主操作「${wanted.join('/')}」Tab 得到` : 'Tab 走得完'
      const escNote = esc?.applicable === true ? '；Esc 关得掉抽屉' : ''
      return { pass: true, message: `${taskNote}（${inFace.length} 个骤停点都有可见描边）${escNote}` }
    }
    return { pass: false, message: `${NAV_KIND_LABEL['N-003']}·${faceText(face)}：${problems.join('；')}` }
  },
}
