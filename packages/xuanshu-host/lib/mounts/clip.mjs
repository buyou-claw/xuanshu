/**
 * packages/xuanshu-host/lib/mounts/clip.mjs — **确定性**分层预算裁剪（票 12；S8 §2.2/§2.3/§5 步骤 3）。
 *
 * 为什么必须是纯函数且无 LLM：验收第 2 条要「逐层可断言」。这里不吃时间、不吃随机数、
 * 不吃服务 —— 同一份输入两次调用**逐字段相同**，所以「预览看到的」与「确认后注入的」
 * 是同一份结果，披露里的数字不可能与注入的实际内容打架。
 *
 * 四步（照 S8 §9 复用表的 fairShare 机制，按玄枢自己的层重排）：
 *   1. 每层先按**段边界**装到「公平水位」`floor(budget / 有内容的层数)`（段 = 一个文件，
 *      于是**永远不切半句话**）；
 *   2. 余量按**层序轮转**一段一段发下去，直到发不动为止（保序 → 可复现）；
 *   3. 一段都没装上的层 = **整层丢弃**（`kept:false`，理由写「超预算未纳入」）——
 *      设计稿 S8 §2.2 的「整层丢弃；不会静默截断」；
 *   4. `dropped` 与 `clipped` **互斥**（C7①）：丢了就不叫裁，裁了就不是丢。
 *
 * 预算未知（`budget === null`）时**不裁剪**（没有可依据的数），并在 `notes` 里说清为什么 ——
 * 界面同时显示「预算未知」，不假装有预算（S8 §6 error③、C7⑤）。
 *
 * 披露（`notice`）是给**注入**用的那一段：它要能回答「砍了多少、为什么砍」，
 * 所以既有总数也有层数与理由；S8 §5 步骤 7 要求注入内容里能看到它。
 */

/** 一个层至少要能装下一段，才谈得上「公平水位」；否则水位本身就没意义。 */
const MIN_FAIR_SHARE = 0

/** 数字加千分位（披露文案用；`8420` → `8,420`）。 */
function group(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
}

/**
 * 分层裁剪。
 *
 * @param {readonly object[]} layers - `content.mjs` 读出来的层（含 `segments` / `dropped` / `error` / `hint`）。
 * @param {number|null} budget - 预算（字）；`null` = 未知 → 不裁剪。
 * @returns {{
 *   layers: Array<{id, kind, label, head, chars, keptChars, kept, clipped, dropped, reason?, error?, hint?,
 *                  keptSegments: Array, droppedSegments: Array, keptCount: number, droppedCount: number}>,
 *   totalChars: number, keptChars: number, budget: number|null, truncatedChars: number,
 *   keptLayers: number, totalLayers: number, notice: string, notes: string[],
 * }}
 */
export function clipMountLayers(layers, budget) {
  const list = Array.isArray(layers) ? layers : []
  const totalChars = list.reduce((sum, layer) => sum + sumChars(layer.segments), 0)
  // 只有「有内容可裁」的层参与公平水位：读不出来的层不占别人的份额。
  const contentLayers = list.filter((layer) => sumChars(layer.segments) > 0)
  const notes = []

  /** 每层的装配状态（浅拷贝，绝不改输入）。 */
  const state = list.map((layer) => ({
    layer,
    taken: [], // 已装上的段（按原顺序）
    left: [...(layer.segments ?? [])], // 还没装的段
  }))

  const noClipping = budget === null || !Number.isFinite(budget) || budget <= 0 || totalChars <= budget
  if (noClipping) {
    for (const row of state) row.taken = [...row.left]
    if (budget === null || !Number.isFinite(budget)) {
      notes.push('预算未知：本次不做裁剪，全部纳入（界面显示「预算未知」，不编一个数）。')
    } else if (budget <= 0) {
      notes.push(`预算为 ${String(budget)}：不裁剪（预算必须为正数才有意义）。`)
    } else {
      notes.push(`本次装配 ${group(totalChars)} 字，未超预算 ${group(budget)} 字：全部纳入，没有任何裁剪。`)
    }
  } else {
    const fair = Math.max(MIN_FAIR_SHARE, Math.floor(budget / Math.max(1, contentLayers.length)))
    // 第 1 步：按段边界装到公平水位。
    for (const row of state) {
      let kept = 0
      while (row.left.length > 0) {
        const next = row.left[0]
        if (kept + next.chars > fair) break
        row.taken.push(row.left.shift())
        kept += next.chars
      }
    }
    // 第 2 步：余量按层序轮转发（一段一段），发不动就停。
    let remaining = budget - state.reduce((sum, row) => sum + sumChars(row.taken), 0)
    let progressed = true
    while (progressed && remaining > 0) {
      progressed = false
      for (const row of state) {
        if (row.left.length === 0) continue
        const next = row.left[0]
        if (next.chars > remaining) continue
        row.taken.push(row.left.shift())
        remaining -= next.chars
        progressed = true
      }
    }
    notes.push(`本次装配 ${group(totalChars)} 字 > 预算 ${group(budget)} 字：按**段边界**公平裁剪（水位 ${group(fair)} 字／层），没有切半句话。`)
  }

  const out = state.map((row) => {
    const segmentsAll = row.layer.segments ?? []
    const raw = sumChars(segmentsAll)
    const keptChars = sumChars(row.taken)
    const keptIds = new Set(row.taken.map((segment) => segment.id))
    const unkept = segmentsAll.filter((segment) => !keptIds.has(segment.id))
    const droppedByBudget = unkept.map((segment) => ({
      label: segment.label,
      chars: segment.chars,
      reason: '超预算未纳入',
    }))
    const policyDropped = (row.layer.dropped ?? []).map((item) => ({ label: item.label, chars: item.chars ?? 0, reason: item.reason }))
    const broken = row.layer.error !== undefined || raw === 0
    // `dropped`（整层丢弃）与 `clipped`（裁剪过）互斥：C7① 三档 Tag 不能同时亮两枚。
    const droppedLayer = !broken && keptChars === 0 && policyDropped.length + droppedByBudget.length > 0
    const clipped = !broken && !droppedLayer && keptChars > 0 && keptChars < raw
    const reason = row.layer.error !== undefined
      ? row.layer.error
      : droppedLayer
        ? '超预算未纳入 · 本次不会进入上下文'
        : undefined
    return {
      id: row.layer.id,
      kind: row.layer.kind,
      label: row.layer.label,
      head: row.layer.head,
      chars: raw,
      keptChars,
      kept: keptChars > 0,
      clipped,
      dropped: droppedLayer,
      ...(reason === undefined ? {} : { reason }),
      ...(row.layer.error === undefined ? {} : { error: row.layer.error }),
      ...(row.layer.hint === undefined ? {} : { hint: row.layer.hint }),
      keptSegments: row.taken.map((segment) => ({ label: segment.label, chars: segment.chars })),
      droppedSegments: [...droppedByBudget, ...policyDropped],
      keptCount: row.taken.length,
      droppedCount: unkept.length + policyDropped.length,
      /** 注入时逐段用它（`clip` 之后只剩该进上下文的内容）。 */
      segments: row.taken,
    }
  })

  const keptChars = out.reduce((sum, layer) => sum + layer.keptChars, 0)
  const keptLayers = out.filter((layer) => layer.kept).length
  const totalLayers = out.filter((layer) => layer.error === undefined && (layer.chars > 0 || (layer.droppedSegments ?? []).length > 0)).length
  const truncatedChars = Math.max(0, totalChars - keptChars)
  const droppedLayers = out.filter((layer) => layer.dropped)
  if (droppedLayers.length > 0) {
    notes.push(`整层丢弃 ${String(droppedLayers.length)} 层（不会静默截断）：${droppedLayers.map((layer) => layer.label).join('、')} —— 缩小挂载范围可以换回它们。`)
  }
  if (truncatedChars > 0) {
    notes.push(`共裁去 ${group(truncatedChars)} 字：其中 ${group(keptChars)} 字进入本轮上下文。`)
  }

  const notice = buildNotice({ out, budget, totalChars, keptChars, truncatedChars, keptLayers })
  return { layers: out, totalChars, keptChars, budget: budget ?? null, truncatedChars, keptLayers, totalLayers, notice, notes }
}

/** 每层段字数合计。 */
function sumChars(segments) {
  return (segments ?? []).reduce((sum, segment) => sum + (Number.isFinite(segment.chars) ? segment.chars : 0), 0)
}

/**
 * 注入时随内容一起给出的披露句（S8 §5 步骤 7：注入内容里注明裁剪）。
 * 没有裁剪时也要给一句 —— 「这次没砍」同样是披露。
 */
function buildNotice({ out, budget, totalChars, keptChars, truncatedChars, keptLayers }) {
  if (budget === null) {
    return `【挂载披露】本次挂载 ${String(out.length)} 层、共 ${group(totalChars)} 字；预算未知（拿不到模型窗口），未做裁剪：全部纳入。`
  }
  const head = `【挂载披露】本次挂载 ${String(out.length)} 层、共 ${group(totalChars)} 字；预算 ${group(budget)} 字，纳入 ${String(keptLayers)} / ${String(out.length)} 层、${group(keptChars)} 字`
  if (truncatedChars === 0) return `${head}：未超预算，没有裁剪。`
  return `${head}；裁去 ${group(truncatedChars)} 字（按段边界裁剪，未切半句话；被整层丢弃的层不会进入上下文）。`
}
