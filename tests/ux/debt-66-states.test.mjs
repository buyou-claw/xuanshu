/**
 * 票 66（UX-04）· 三处缺态补齐 —— 「空 / 载 / 错」各自在**真界面面**上转绿。
 *
 * 这张票只做记账式补齐：三个互不干扰的源文件各缺一态。
 * 用例钉两件事，缺一不可：
 *   1. **行为**：把那个状态渲染出来，人眼能看到一句中文说明（不是空表格、不是变量原样输出）；
 *   2. **巡检**：`S-00x` 在 `verify-ux` 的同一条采集 + 判定链路上真的转绿
 *      （不自己另写一套正则 —— 那就成了「另一个口径」）。
 *
 * 文案口径的唯一权威是 `scripts/ux/state-vocabulary.mjs`（族 `X`），这里只钉本票写下的原句。
 */
import { join } from 'node:path'

import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { XsDataSection } from '../../packages/xuanshu-client/src/client/data.tsx'
import { TouchSettingsHost } from '../../packages/xuanshu-client/src/client/notify.tsx'
import { MingpanPanel } from '../../packages/xuanshu-client/src/client/MingpanPanel.tsx'
import { ASSERTIONS } from '../../scripts/ux/assertions/index.mjs'
import { createSourceCache } from '../../scripts/ux/collect/source-cache.mjs'
import { probeFor } from '../../scripts/ux/probes/index.mjs'
import { faceManifest } from '../assembly/lib/panel-surface.mjs'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const FACES = faceManifest()
const READ = createSourceCache({ repoRoot: REPO_ROOT }).read
const render = (element) => renderToStaticMarkup(element)

/**
 * 走巡检自己的那条链路：采集 → 判定。
 * @param {string} criterionId `S-001` / `S-002` / `S-003`
 * @param {string} faceId 界面面 id（`slot:<槽>\u0000<id>` 或 `panel:<key>`）
 */
function audit(criterionId, faceId) {
  const face = FACES.find((candidate) => candidate.id === faceId)
  expect(face, `界面面 ${faceId} 不在 panel-surface 里`).toBeTruthy()
  const { facts } = probeFor({ id: criterionId, check: 'static' })({ face, read: READ })
  return ASSERTIONS[criterionId](facts)
}

/** 一份「有数据」的 overview 夹具（数值写死，独立于宿主实现）。 */
const OVERVIEW = {
  schema: 'xuanshu/data@1',
  home: 'C:\\Users\\me\\.xuanshu',
  dataDir: 'C:\\Users\\me\\.xuanshu\\xuanshu',
  groups: [
    { id: 'pu', label: '谱', path: 'C:\\Users\\me\\.xuanshu\\xuanshu\\pus', bytes: 2048, files: 3 },
  ],
  total: { bytes: 2048, files: 3 },
  excluded: [],
  notes: [],
}

describe('UX-04① · 设置·我的数据（slot:settings.section#xuanshu.data）补空态', () => {
  it('S-001：一个分类都没有时，给一句「为什么空」+ 下一步，而不是一张空表格', () => {
    const html = render(h(XsDataSection, {
      state: {
        overview: { ...OVERVIEW, groups: [], total: { bytes: 0, files: 0 } },
        busy: false,
      },
      actions: { onBackup: () => {} },
    }))
    // 仓库口径：空态一律「还没有…」，「暂无 / 空的 / 无记录」是同义替换（族字典 X-001 禁止）。
    expect(html).toContain('还没有')
    expect(html).not.toContain('暂无')
    // 空表格不该再渲染：没有分类就没有 <table>。
    expect(html).not.toContain('xs-data__groups')
    // 状态标记落在这句说明上（巡检按它认「源码里确实写了这个状态」）。
    expect(html).toContain('data-xs-state="empty"')
  })

  it('S-001 在巡检链路上转绿（数据面没有变回「只有分支、没有人话」）', () => {
    const verdict = audit('S-001', 'slot:settings.section#xuanshu.data')
    expect(verdict.pass, verdict.message).toBe(true)
  })
})

/** 永不落地的 Promise：SSR 下 effect 不跑，用来说明「首读还没回来」。 */
const never = () => new Promise(() => {})

describe('UX-04② · 设置·触达开关（slot:settings.general.item#xuanshu.touch）补加载态', () => {
  it('S-002：读开关当前值的时候行上说一句「正在读…」，而不是整行什么都不显示', () => {
    const html = render(h(TouchSettingsHost, {
      rikke: { getSettings: never, setSettings: never },
      notify: { getSettings: never, getShellSettings: never, setSettings: never, setShellSettings: never },
    }))
    expect(html).toContain('正在读')
    // 族字典把「加载中 / 读取中 / 请稍候」列为同义替换（X-001 禁止）。
    expect(html).not.toContain('加载中')
    expect(html).not.toContain('读取中')
    expect(html).toContain('data-xs-state="loading"')
  })

  it('S-002 在巡检链路上转绿', () => {
    const verdict = audit('S-002', 'slot:settings.general.item#xuanshu.touch')
    expect(verdict.pass, verdict.message).toBe(true)
  })
})

/** 命盘屏的控制器桩：SSR 只用到订阅面与两个动作（不起浏览器）。 */
const controller = {
  subscribe: () => () => {},
  getRevision: () => 0,
  invalidate: () => {},
  requestRerecord: () => {},
}

describe('UX-04③ · 命盘卡详情（panel:mingpan）补错误态', () => {
  it('S-003：排盘失败时先给一句中文说明，再给下一步（重试 / 去补出生信息），不是变量原样输出', () => {
    const html = render(h(MingpanPanel, {
      api: { snapshot: never },
      controller,
      navigate: () => {},
      preloadedError: '命盘快照读不出来（文件缺失或格式不符）。',
    }))
    // 一句人话里带「失败」（族字典允许的说法），且不用「出错 / 错误 / 异常」这类泛化词。
    expect(html).toContain('失败')
    expect(html).not.toContain('出错')
    expect(html).not.toContain('异常')
    expect(html).not.toContain('>错误<')
    // 下一步必须就在错误块里：重试 + 去补出生信息。
    expect(html).toContain('data-xuanshu-action="retry"')
    expect(html).toContain('data-xuanshu-action="start-onboarding"')
    // 技术原因（宿主给的原句）不能丢：诊断信息照旧看得见。
    expect(html).toContain('命盘快照读不出来（文件缺失或格式不符）。')
    expect(html).toContain('data-xuanshu-view="error"')
  })

  it('S-003 在巡检链路上转绿', () => {
    const verdict = audit('S-003', 'panel:mingpan')
    expect(verdict.pass, verdict.message).toBe(true)
  })
})
