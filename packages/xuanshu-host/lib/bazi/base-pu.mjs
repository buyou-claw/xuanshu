/**
 * packages/xuanshu-host/lib/bazi/base-pu.mjs — 底座谱（`pus/_base/`）的渲染与落盘（票 08 契约 §1）。
 *
 * 底座谱不是「用户建的谱」：它是**出盘的产物**，`level: base`、`source: manual`、名字固定「底座」，
 * 走的也必须是 `lib/pu/repository.mjs` 新增的保留路径（`readBase` / `writeBase`）——
 * 用户 slug 那条路仍然拒绝 `_base`、`list()` 仍然不列它（契约 §7）。
 *
 * 三件套（契约 §1）：
 *   `manifest.md`  谱规范 v1 的 frontmatter + 概览节
 *   `bazi.md`      八字分节：四柱 + 本次口径 + 快照来源（S3 §341 要求「口径行含 timeAlg 实际档位、
 *                  经纬度、时区」；S2 的只读详情读的就是它）
 *   `summary.md`   一行摘要（谱的加载协议是「manifest 概览 + summary 优先」）
 *
 * 为什么口径行要在谱里写一遍（快照 `snapshot.json` 里也有）：**谱是给人读的、快照是给界面读的**；
 * 谱可以整体拷走、脱离玄枢也能看懂这是谁的盘、用什么口径出的。
 */

import { createPuRepository } from '../pu/repository.mjs'
import { BASE_PU_BAZI_FILE, BASE_PU_NAME, TIME_ALG_LABELS } from './constants.mjs'

/** 分钟 → `+09:00` / `-04:00`（口径行用）；不是整数分钟 → null（不编）。 */
export function formatOffset(offsetMinutes) {
  if (!Number.isInteger(offsetMinutes)) return null
  const sign = offsetMinutes < 0 ? '-' : '+'
  const total = Math.abs(offsetMinutes)
  const hours = String(Math.floor(total / 60)).padStart(2, '0')
  const minutes = String(total % 60).padStart(2, '0')
  return `${sign}${hours}:${minutes}`
}

/** `timeAlg` → 人读标签；认不出的档原样写数字（不张冠李戴）。 */
function timeAlgLabel(timeAlg) {
  return TIME_ALG_LABELS[timeAlg] ?? `档位 ${JSON.stringify(timeAlg)}（不在 0/1/3 里）`
}

/** 出生地的坐标行：有地名就带上，没有就只给坐标。 */
function placeLine(birth) {
  const coords = `${birth.lat}, ${birth.lon}`
  return typeof birth.place === 'string' && birth.place !== '' ? `${birth.place}（${coords}）` : coords
}

/**
 * `bazi.md` 正文（纯函数）。
 * @param {{birth: object, pillars: object, basis: object, horosa: {version: string|null, tool: string|null}, generatedAt: string}} input
 */
export function renderBaziSection({ birth, pillars, basis, horosa, generatedAt }) {
  const offset = formatOffset(basis.offsetMinutes)
  const offsetLine = offset === null
    ? '未知（时区是固定偏移或无法解析）'
    : basis.dst === true ? `${offset}（夏令时）` : basis.dst === false ? `${offset}（标准时）` : offset
  return [
    '# 八字（出生盘）',
    '',
    '## 四柱',
    '',
    '| 柱 | 年 | 月 | 日 | 时 |',
    '|---|---|---|---|---|',
    `| 干支 | ${pillars.year} | ${pillars.month} | ${pillars.day} | ${pillars.hour} |`,
    '',
    '## 本次口径',
    '',
    `- 出生日期：${birth.date}`,
    `- 钟表时间：${basis.clock}（时区 ${birth.zone}）`,
    `- 出生地：${placeLine(birth)}`,
    `- 时间算法：${timeAlgLabel(birth.timeAlg)}（timeAlg=${birth.timeAlg}，换算由星阙引擎内部完成）`,
    `- 时区偏移：${offsetLine}`,
    '',
    '## 快照来源',
    '',
    `- 工具：${horosa.tool ?? '未知'} @ ${horosa.version ?? '未知版本'}`,
    `- 生成时间：${generatedAt}`,
    '- 机器可读快照：`bazi/snapshot.json`（schema `xuanshu/bazi-snapshot@1`）',
    '',
  ].join('\n')
}

/** `summary.md` 正文（纯函数；一行说清「这是谁的盘、什么口径」）。 */
export function renderBaseSummary({ birth, pillars, basis, horosa, generatedAt }) {
  return `${BASE_PU_NAME}：${birth.date} ${basis.clock} ${birth.zone}（${placeLine(birth)}），`
    + `四柱 ${pillars.year} ${pillars.month} ${pillars.day} ${pillars.hour}；`
    + `时间算法 ${timeAlgLabel(birth.timeAlg)}（timeAlg=${birth.timeAlg}）；`
    + `来源 ${horosa.tool ?? '未知'}@${horosa.version ?? '未知'}；生成于 ${generatedAt}。\n`
}

/**
 * 落底座谱（原子替换，见 `repository.writeBase`）。
 * @returns 与 `readBase()` 同形的谱对象
 */
export function writeBasePu(dataDir, input) {
  const repository = createPuRepository(dataDir)
  return repository.writeBase(
    { [BASE_PU_BAZI_FILE]: renderBaziSection(input) },
    { description: renderBaseDescription(input), summary: renderBaseSummary(input) },
  )
}

/** 概览节正文（写进 `manifest.md` 的 `# 底座（概览）` 之下）。 */
export function renderBaseDescription({ birth, pillars }) {
  return `出生信息与八字底盘：${birth.date} ${birth.time} ${birth.zone}，四柱 ${pillars.year} ${pillars.month} ${pillars.day} ${pillars.hour}。`
    + '由八字冷启动向导出盘后落盘；重新录制出生信息会原子替换本谱，底稿在下次刷新时随之更新。'
}

/**
 * 读底座谱。**读不出来返回 null**（不抛）：`bazi.basePu` 是只读探测面，
 * 坏掉的底座谱不该让 RPC 回一个 500 —— 界面要的是「有 / 没有」，
 * 「有但坏了」由 `bazi.status`（快照）那一侧报 error。
 */
export function readBasePu(dataDir) {
  try {
    return createPuRepository(dataDir).readBase()
  } catch {
    return null
  }
}
