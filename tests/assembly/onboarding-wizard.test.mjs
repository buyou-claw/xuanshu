/**
 * 票 08 · 冷启动向导与命盘详情的组件级断言（S3 / S2 屏稿；冻结契约 §6）。
 *
 * 这一层断言的是**界面上能看见的事实**（票面验收里最容易被"结构对但文案没了"糊过去的部分）：
 *   - 双通道：离线小库即时列、无匹配给「无匹配城市，可改用手输经纬度」、手输经纬**经度在前**；
 *   - 时区：自动结果来自注入的 `bazi.timezone` 回答（客户端自己不算），手动覆盖后 `[自动]` 才可用；
 *   - 缺经纬度：`[确认并出盘]` 置灰 + 理由可见（缺什么 + 因果 + 两个修复入口），**不移除节点**；
 *   - 澄清闸：底座回问**原文**展示（`gate.promptToUser`），不转述、不吞掉；
 *   - 命盘详情：只读态**零输入控件**，唯一写操作是带二次确认的「重新录制出生信息」。
 *
 * 环境：`renderToStaticMarkup`（不做 DOM 事件；Node 里没有 jsdom）。
 * 因此本文件只驱动**受控组件**（所有状态由 props 给），交互链路由纯模型
 * （`onboarding-model.test.mjs`）与防抖调度（`onboarding-cities.test.mjs`）各自负责。
 * 真浏览器里的点击链路**没有**被本文件覆盖——这一点在交付报告里如实标注。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SMALL_CITIES } from '../../packages/xuanshu-client/src/client/cities.ts'
import { defaultDraft, placeLabel } from '../../packages/xuanshu-client/src/client/onboarding-model.ts'
import {
  XsConfirmStep,
  XsPlaceStep,
  XsStepBar,
  XsTimeStep,
  XsZoneStep,
} from '../../packages/xuanshu-client/src/client/onboarding-steps.tsx'
import { OnboardingPanel } from '../../packages/xuanshu-client/src/client/onboarding.tsx'
import { MingpanPanel } from '../../packages/xuanshu-client/src/client/MingpanPanel.tsx'

const render = (element) => renderToStaticMarkup(element)

/** 按标记切出承载它的那个标签（用来断言 `disabled` 在不在**这个**控件上）。 */
function tagOf(html, marker) {
  const start = html.indexOf(marker)
  expect(start, `没有找到 ${marker}`).toBeGreaterThanOrEqual(0)
  const open = html.lastIndexOf('<', start)
  const close = html.indexOf('>', start)
  return html.slice(open, close + 1)
}

/** 按标记切出该**元素内的文本**（用于「这块说明写了什么」类断言）。 */
function textOf(html, marker) {
  const start = html.indexOf(marker)
  expect(start, `没有找到 ${marker}`).toBeGreaterThanOrEqual(0)
  const open = html.indexOf('>', start)
  const close = html.indexOf('</', open)
  return html.slice(open + 1, close === -1 ? undefined : close)
}

/** 城市通道的受控状态（形状 = `cities.ts` 的 `CityQueryState`）。 */
const cityState = (over = {}) => ({
  query: '',
  items: SMALL_CITIES.slice(0, 20),
  pending: false,
  fullFailed: false,
  ...over,
})

/**
 * 一个坐标齐备、时区已定的草稿。
 * 坐标取**屏稿例子**（南京 118.7969 / 32.0603 → `118e47 / 32n03`，S3 §2.2③ 与 S2 §2.1② 同款）。
 */
const draft = (over = {}) => ({
  ...defaultDraft(),
  date: '1990-06-01',
  time: '04:00',
  place: '南京',
  lon: 118.7969,
  lat: 32.0603,
  zone: 'Asia/Shanghai',
  ...over,
})

/* ───────────────────────── 第 1 步：日期与钟表时间 ───────────────────────── */

describe('票 08 · 第 1 步：日期 + 钟表时间（S3 §2.1 / §3.1）', () => {
  it('日期 / 时刻两个字段 +「当地时间」小字（防歧义的关键文案）', () => {
    const html = render(h(XsTimeStep, { draft: draft(), onChange: () => {}, onNudge: () => {} }))
    expect(html).toContain('data-xs-step="1"')
    expect(html).toContain('data-xuanshu-field="birth-date"')
    expect(html).toContain('data-xuanshu-field="birth-time"')
    expect(html).toContain('当地时间')
    expect(html).toContain('value="1990-06-01"')
    expect(html).toContain('value="04:00"')
  })

  it('内联微调条常驻：五档粒度含「四分钟」（1° 经度时差，不许改写成加减分秒）+ [此刻]', () => {
    const html = render(h(XsTimeStep, { draft: draft(), onChange: () => {}, onNudge: () => {} }))
    expect(html).toContain('data-xuanshu-nudge="grains"')
    for (const label of ['年', '月', '天', '小时', '四分钟']) {
      expect(html, `微调粒度缺 ${label}`).toContain(`>${label}<`)
    }
    expect(html).toContain('data-xuanshu-action="nudge-now"')
    expect(html).toContain('data-xuanshu-action="nudge-apply"')
    expect(html).toContain('data-xuanshu-action="nudge-minus"')
    expect(html).toContain('data-xuanshu-action="nudge-plus"')
  })

  it('未开始态给空值占位提示（不写死一个假日期）', () => {
    const html = render(h(XsTimeStep, { draft: defaultDraft(), onChange: () => {}, onNudge: () => {} }))
    expect(html).toContain('先填出生信息')
  })
})

/* ───────────────────────── 第 2 步：出生地双通道 ───────────────────────── */

describe('票 08 · 第 2 步：双通道出生地（S3 §2.2 / §3.2）', () => {
  it('通道 A：无关键词只列离线小库（断网可用），选中即带出经纬度', () => {
    const html = render(
      h(XsPlaceStep, {
        draft: defaultDraft(),
        query: '',
        results: cityState(),
        onQuery: () => {},
        onPick: () => {},
        onManual: () => {},
      }),
    )
    expect(html).toContain('data-xs-step="2"')
    expect(html).toContain('data-xuanshu-field="city-search"')
    expect(html).toContain('北京')
    expect(html).toContain('data-xuanshu-action="pick-city"')
    expect(html).toContain('出生地（必填：缺经纬度不能出盘）')
  })

  it('通道 A：无匹配给「无匹配城市，可改用手输经纬度」（不引导去地图）', () => {
    const html = render(
      h(XsPlaceStep, {
        draft: defaultDraft(),
        query: 'zzzz',
        results: cityState({ query: 'zzzz', items: [] }),
        onQuery: () => {},
        onPick: () => {},
        onManual: () => {},
      }),
    )
    const noMatch = textOf(html, 'data-xuanshu-note="city-no-match"')
    expect(noMatch).toContain('无匹配城市，可改用手输经纬度')
    expect(noMatch, '无匹配的引导不许再指向地图').not.toContain('地图')
  })

  it('大库失败是**静默**的：小库结果照常列，界面上一个错字都没有', () => {
    const html = render(
      h(XsPlaceStep, {
        draft: defaultDraft(),
        query: 'shang',
        results: cityState({ query: 'shang', items: [SMALL_CITIES[1]], pending: false, fullFailed: true }),
        onQuery: () => {},
        onPick: () => {},
        onManual: () => {},
      }),
    )
    expect(html).toContain('上海')
    expect(html).not.toMatch(/失败|错误|error|不可用/)
  })

  it('通道 B：手输经纬**经度在前**，非法值只给提示、不回填', () => {
    const html = render(
      h(XsPlaceStep, {
        draft: defaultDraft(),
        query: '',
        results: cityState(),
        manualHint: '经纬度不合法，已忽略（经度在前，例如 118.78 / 32.06）',
        onQuery: () => {},
        onPick: () => {},
        onManual: () => {},
      }),
    )
    expect(html).toContain('data-xuanshu-field="manual-lon"')
    expect(html).toContain('data-xuanshu-field="manual-lat"')
    // 经度框在纬度框之前，两个标签也各自写明经 / 纬（只靠框的先后是猜，靠标签才是读）。
    expect(html.indexOf('data-xuanshu-field="manual-lon"')).toBeLessThan(
      html.indexOf('data-xuanshu-field="manual-lat"'),
    )
    expect(html.indexOf('经度（-180 ~ 180）')).toBeLessThan(html.indexOf('纬度（-90 ~ 90）'))
    expect(html).toContain('data-xuanshu-action="apply-manual"')
    expect(html).toContain('经纬度不合法，已忽略（经度在前，例如 118.78 / 32.06）')
  })

  it('地名与坐标同框可见；手输无名显示「未命名地点」，旧地名不残留（防脏状态 H1）', () => {
    const picked = render(
      h(XsPlaceStep, {
        draft: draft(),
        query: '',
        results: cityState(),
        onQuery: () => {},
        onPick: () => {},
        onManual: () => {},
      }),
    )
    expect(picked).toContain('data-xuanshu-place="南京"')
    expect(picked).toContain('118e47 / 32n03')

    const manual = render(
      h(XsPlaceStep, {
        draft: draft({ place: '' }),
        query: '',
        // 结果列表留空：这样「上海」只可能来自草稿里的旧地名，能真正验出「不留旧地名」。
        results: cityState({ query: '', items: [] }),
        onQuery: () => {},
        onPick: () => {},
        onManual: () => {},
      }),
    )
    expect(manual).toContain(`data-xuanshu-place="${placeLabel(defaultDraft())}"`)
    expect(manual, '旧地名不许残留').not.toContain('南京')
  })

  it('「地图选点」明说玄枢 v1 不做（索引 D2：无联网依赖）', () => {
    const html = render(
      h(XsPlaceStep, {
        draft: defaultDraft(),
        query: '',
        results: cityState(),
        onQuery: () => {},
        onPick: () => {},
        onManual: () => {},
      }),
    )
    expect(html).toContain('地图选点：玄枢 v1 不做（无联网依赖）')
  })
})

/* ───────────────────────── 第 3 步：时区 ───────────────────────── */

describe('票 08 · 第 3 步：时区自动推导 + 手动覆盖（S3 §2.3 / §3.3）', () => {
  it('自动结果显示 IANA 名 + 偏移 + 夏令时标记，并写明依据是经纬度 + 出生日期', () => {
    const html = render(
      h(XsZoneStep, {
        draft: draft(),
        zone: { zone: 'Asia/Shanghai', offsetMinutes: 540, dst: true },
        onZone: () => {},
        onAuto: () => {},
      }),
    )
    expect(html).toContain('data-xs-step="3"')
    expect(html).toContain('data-xuanshu-zone="auto"')
    expect(html).toContain('Asia/Shanghai')
    expect(html).toContain('+09:00')
    expect(html).toContain('夏令时：有')
    expect(html).toContain('经纬度 + 出生日期')
  })

  it('推导失败（zone=null）落回手改，并说明必须手改才能出盘', () => {
    const html = render(
      h(XsZoneStep, {
        draft: draft({ zone: '' }),
        zone: { zone: null, offsetMinutes: null, dst: null },
        onZone: () => {},
        onAuto: () => {},
      }),
    )
    expect(html).toContain('data-xuanshu-zone="manual"')
    expect(html).toContain('data-xuanshu-zone="unresolved"')
    expect(html).toContain('手动指定')
    expect(html).toContain('data-xuanshu-field="zone-override"')
  })

  it('手动覆盖 28 档；`[自动]` 只在已手改时可用（未手改时没有可清除的东西）', () => {
    const manual = render(
      h(XsZoneStep, {
        draft: draft({ zone: '+06:00', zoneManual: true }),
        zone: { zone: 'Asia/Shanghai', offsetMinutes: 480, dst: false },
        onZone: () => {},
        onAuto: () => {},
      }),
    )
    expect(manual).toContain('data-xuanshu-zone="manual"')
    expect(tagOf(manual, 'data-xuanshu-action="zone-auto"')).not.toContain('disabled')

    const auto = render(
      h(XsZoneStep, {
        draft: draft(),
        zone: { zone: 'Asia/Shanghai', offsetMinutes: 480, dst: false },
        onZone: () => {},
        onAuto: () => {},
      }),
    )
    expect(tagOf(auto, 'data-xuanshu-action="zone-auto"')).toContain('disabled')
  })

  it('口径声明常驻：时区只负责「钟表时间 → UTC」，真太阳时换算在引擎里', () => {
    const html = render(
      h(XsZoneStep, {
        draft: draft(),
        zone: { zone: 'Asia/Shanghai', offsetMinutes: 480, dst: false },
        onZone: () => {},
        onAuto: () => {},
      }),
    )
    expect(html).toContain('时区只负责')
    expect(html).toContain('真太阳时换算在引擎里，录入层不换算')
  })

  it('重算中给「重算中」而不是整屏 loading（S3 §6 loading 行）', () => {
    const html = render(
      h(XsZoneStep, {
        draft: draft(),
        zone: { zone: 'Asia/Shanghai', offsetMinutes: 480, dst: false },
        pending: true,
        onZone: () => {},
        onAuto: () => {},
      }),
    )
    expect(html).toContain('重算中')
  })
})

/* ───────────────────────── 第 5 步：确认与出盘 ───────────────────────── */

describe('票 08 · 第 5 步：确认表 + 澄清闸 + 出盘按钮（S3 §2.5 / §2.6 / §2.7）', () => {
  const confirmProps = (over = {}) => ({
    draft: draft({ verified: true }),
    gate: undefined,
    busy: false,
    onEdit: () => {},
    onToggleNote: () => {},
    onToggleVerified: () => {},
    onCast: () => {},
    onAnswerGate: () => {},
    ...over,
  })

  it('确认表五行（时间 / 出生地 / 时区 / 时间算法 / 性别）逐行可回跳修改', () => {
    const html = render(h(XsConfirmStep, confirmProps()))
    expect(html).toContain('data-xs-step="5"')
    for (const row of ['time', 'place', 'zone', 'timeAlg', 'gender']) {
      expect(html, `确认表缺 ${row} 行`).toContain(`data-xuanshu-confirm="${row}"`)
    }
    expect(html).toContain('1990-06-01 04:00 当地时间')
    expect(html).toContain('118e47 / 32n03')
    expect(html).toContain('Asia/Shanghai')
    expect(html).toContain('真太阳时（经度 + 均时差）')
    expect(html).toContain('未知（按男排）')
    expect(html.match(/data-xuanshu-action="edit-step-/g)?.length).toBe(5)
  })

  it('核对勾选是出盘解锁条件；不确定项写进 clarification_notes', () => {
    const html = render(h(XsConfirmStep, confirmProps()))
    expect(tagOf(html, 'data-xuanshu-field="verified"')).toContain('checked')
    expect(html).toContain('以上信息我已核对')
    expect(html).toContain('data-xuanshu-field="note-minute"')
    expect(html).toContain('data-xuanshu-field="note-place"')
    expect(html).toContain('clarification_notes')

    const unchecked = render(h(XsConfirmStep, confirmProps({ draft: draft({ verified: false }) })))
    expect(tagOf(unchecked, 'data-xuanshu-action="cast"')).toContain('disabled')
    expect(unchecked).toContain('请先勾选「以上信息我已核对」')
  })

  it('**缺经纬度：出盘按钮置灰且理由可见**（缺什么 + 因果 + 两个修复入口，不给旁路按钮）', () => {
    const html = render(
      h(XsConfirmStep, confirmProps({ draft: draft({ verified: true, lon: undefined, lat: undefined }) })),
    )
    const cast = tagOf(html, 'data-xuanshu-action="cast"')
    expect(cast, '按钮节点必须在（禁用而不是移除）').toContain('data-xuanshu-action="cast"')
    expect(cast).toContain('disabled')
    expect(html).toContain('缺：经度 / 纬度')
    expect(html).toContain('悄悄退回钟表口径')
    expect(html).toContain('data-xuanshu-action="goto-place"')
    expect(html).toContain('data-xuanshu-action="goto-manual"')
    expect(html, '缺经纬度时不许出现任何旁路出盘按钮').not.toContain('继续出盘')
    // 状态位（右下角）在点之前就能看见。
    expect(html).toContain('data-xuanshu-status="blocked"')
    expect(html).toContain('缺经纬度（禁用）')
  })

  it('坐标齐备 + 已勾核对 → 按钮可用，状态位显示可出盘', () => {
    const html = render(h(XsConfirmStep, confirmProps()))
    expect(tagOf(html, 'data-xuanshu-action="cast"')).not.toContain('disabled')
    expect(html).toContain('data-xuanshu-status="ready"')
    expect(html).toContain('可出盘')
  })

  it('出盘进行中单飞：按钮转进行中、表单只读（不整屏转圈）', () => {
    const html = render(h(XsConfirmStep, confirmProps({ busy: true })))
    expect(tagOf(html, 'data-xuanshu-action="cast"')).toContain('disabled')
    expect(html).toContain('出盘中…')
    expect(html).toContain('data-xuanshu-busy="cast"')
  })

  it('澄清闸拦截：`gate.promptToUser` **原文**展示 + questions 逐条 + 就地重出盘', () => {
    const promptToUser = '出生时间是 04:00 整，还是只知道「凌晨 4 点前后」？'
    const html = render(
      h(XsConfirmStep, {
        ...confirmProps(),
        gate: { promptToUser, questions: ['出生时间是否精确到分钟？'] },
      }),
    )
    expect(html).toContain('data-xuanshu-gate="prompt"')
    expect(html, '回问必须原文展示').toContain(promptToUser)
    expect(html).toContain('出生时间是否精确到分钟？')
    expect(html).toContain('底座需要你确认')
    expect(html).toContain('data-xuanshu-action="answer-gate"')
    expect(html).toContain('data-xuanshu-field="gate-answer"')
  })
})

/* ───────────────────────── 向导根（第 1 步默认态） ───────────────────────── */

describe('票 08 · 向导根（main key onboarding）', () => {
  const deps = () => ({
    api: {
      status: async () => ({ state: 'empty' }),
      snapshot: async () => ({ snapshot: null }),
      basePu: async () => ({ pu: null }),
      cities: async () => ({ items: [], source: 'none' }),
      timezone: async () => ({ zone: 'Asia/Shanghai', offsetMinutes: 480, dst: false }),
      cast: async () => ({ phase: 'error', message: '不该在静态渲染里出盘' }),
    },
    controller: { getRevision: () => 0, subscribe: () => () => {}, invalidate: () => {}, requestRerecord: () => {}, consumePrefill: () => undefined },
    navigate: () => {},
  })

  it('默认落在第 1 步：步骤条 1/6、标题、取消向导（无副作用退出）都在', () => {
    const html = render(h(OnboardingPanel, { ...deps() }))
    expect(html).toContain('data-xuanshu-panel="onboarding"')
    // #29：冷启动多了一步「接上 AI」（八字 → 接上 AI → 就绪），所以是 1/6。
    expect(html).toContain('第 1 / 6 步')
    expect(html).toContain('出生日期与钟表时间')
    expect(html).toContain('data-xuanshu-action="cancel"')
    expect(html).toContain('data-xuanshu-action="next"')
  })

  it('步骤条六格 + 当前步高亮（不需要会话绑定：main key ≠ conversation，F1）', () => {
    const html = render(h(XsStepBar, { step: 3 }))
    expect(html.match(/data-xuanshu-step="\d"/g)?.length).toBe(6)
    expect(tagOf(html, 'data-xuanshu-step="3"')).toContain('data-xs-current="true"')
  })

  it('#29：最后一步是「接上 AI」，与「八字五步」在同一根步骤条上（不新增面板）', () => {
    const html = render(h(XsStepBar, { step: 6 }))
    expect(html).toContain('第 6 / 6 步')
    expect(tagOf(html, 'data-xuanshu-step="6"')).toContain('data-xs-current="true"')
    expect(html).toContain('接 AI')
  })

  it('预填重录：第 1 步直接带出旧值（S2 §5.4「五步全部预填现值」）', () => {
    const html = render(
      h(OnboardingPanel, { ...deps(), preloadedDraft: draft({ date: '1985-03-02', time: '17:45' }) }),
    )
    expect(html).toContain('value="1985-03-02"')
    expect(html).toContain('value="17:45"')
  })
})

/* ───────────────────────── S2 · 命盘详情（只读） ───────────────────────── */

describe('票 08 · 命盘详情（main key mingpan，只读）', () => {
  const snapshot = {
    schema: 'xuanshu/bazi-snapshot@1',
    generatedAt: '2026-10-15T00:00:00.000Z',
    birth: { date: '1990-06-01', time: '04:00', zone: 'Asia/Shanghai', lat: 31.2304, lon: 121.4737, place: '上海', timeAlg: 0 },
    pillars: { year: '己巳', month: '丙子', day: '丙寅', hour: '甲午' },
    basis: { trueSolar: '04:12', clock: '04:00', offsetMinutes: 540, dst: true },
    horosa: { version: '0.40.1', tool: 'bazi_birth' },
  }
  const deps = (over = {}) => ({
    api: {
      status: async () => ({ state: 'empty' }),
      snapshot: async () => ({ snapshot }),
      basePu: async () => ({ pu: null }),
      cities: async () => ({ items: [], source: 'none' }),
      timezone: async () => ({ zone: null, offsetMinutes: null, dst: null }),
      cast: async () => ({ phase: 'error', message: '不该在静态渲染里出盘' }),
    },
    controller: { getRevision: () => 0, subscribe: () => () => {}, invalidate: () => {}, requestRerecord: () => {}, consumePrefill: () => undefined },
    navigate: () => {},
    ...over,
  })

  it('ready：出生摘要 + 四柱 + 口径行 + 快照来源，且**零输入控件**', () => {
    const html = render(h(MingpanPanel, { ...deps(), preloadedSnapshot: snapshot }))
    expect(html).toContain('data-xuanshu-panel="mingpan"')
    expect(html).toContain('只读 · 由出生信息与底座生成')
    expect(html).toContain('1990-06-01 04:00 当地时间')
    expect(html).toContain('上海')
    // 契约 §1 的例子快照：上海 31.2304 / 121.4737 → `121e28 / 31n13`（floor + 两位）。
    expect(html).toContain('121e28 / 31n13')
    expect(html).toContain('+09:00')
    for (const [key, value] of [['year', '己巳'], ['month', '丙子'], ['day', '丙寅'], ['hour', '甲午']]) {
      expect(html).toContain(`data-xuanshu-pillar="${key}"`)
      expect(html).toContain(value)
    }
    expect(html).toContain('真太阳时 04:12')
    expect(html).toContain('钟表时 04:00')
    expect(html).toContain('时间算法 = 真太阳时（经度 + 均时差）')
    expect(html).toContain('性别 = 未知（按男排）')
    expect(html).toContain('其余旋钮 = 引擎缺省（本盘未改）')
    expect(html).toContain('horosa 0.40.1')
    // C1：抽屉/面板里没有任何输入控件。
    expect(html).not.toMatch(/<input|<select|<textarea/)
    expect(html).not.toContain('contenteditable')
  })

  it('ready：唯一写操作是「重新录制出生信息」，且点击必过二次确认（不就地编辑）', () => {
    const html = render(h(MingpanPanel, { ...deps(), preloadedSnapshot: snapshot }))
    expect(html).toContain('data-xuanshu-action="rerecord"')
    // 二次确认文案写明「原子替换底座谱 + 底稿需手动刷新」（S2 §5.4 逐字）。
    expect(html).toContain('将重新录制出生信息并重新出盘')
    expect(html).toContain('原子替换')
    expect(html).toContain('底稿会在下次刷新时随之更新，需要你手动点刷新')
    expect(html).not.toContain('保存')
  })

  it('empty（并发被打开）：空态可执行，不写「暂无数据」', () => {
    const html = render(
      h(MingpanPanel, { ...deps({ api: { ...deps().api, snapshot: async () => ({ snapshot: null }) } }), preloadedSnapshot: null }),
    )
    expect(html).toContain('还没有命盘：出生信息还没录')
    expect(html).toContain('data-xuanshu-action="start-onboarding"')
    expect(html).not.toContain('暂无数据')
    expect(html).not.toMatch(/<input|<select|<textarea/)
  })

  it('error（快照读不出来）：给 [重试] 与 [去重新录制出生信息]，仍不改写任何东西', () => {
    const html = render(
      h(MingpanPanel, {
        ...deps(),
        preloadedError: '命盘快照读不出来（文件缺失或格式不符）。',
      }),
    )
    expect(html).toContain('命盘快照读不出来（文件缺失或格式不符）。')
    expect(html).toContain('data-xuanshu-action="retry"')
    expect(html).toContain('data-xuanshu-action="rerecord"')
    expect(html).not.toMatch(/<input|<select|<textarea/)
  })

  it('部分字段读不出来：不整屏失败，缺项按「—」占位并给一行说明（S2 §6）', () => {
    const partial = { ...snapshot, pillars: undefined }
    const html = render(h(MingpanPanel, { ...deps(), preloadedSnapshot: partial }))
    expect(html).toContain('部分要点读不出来（pillars）')
    expect(html).toContain('—')
  })

  it('口径行不出现任何可编辑档位 / 流派 / 显示开关（索引 D4：不呈现的键一次说清）', () => {
    const html = render(h(MingpanPanel, { ...deps(), preloadedSnapshot: snapshot }))
    for (const forbidden of ['长生', '神煞查法', '晚子时', '命宫起法', '月律分野', '断命流派', '显示区']) {
      expect(html, `口径行不该出现可改档位：${forbidden}`).not.toContain(forbidden)
    }
  })
})
