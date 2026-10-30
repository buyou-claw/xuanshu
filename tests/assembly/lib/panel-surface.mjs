/**
 * 装配注册面的**单一事实来源**（Lead 2026-10-15 收口）。
 *
 * 为什么要有这个文件：票 07 / 08 / 10 / 13 各加了自己的面板，于是
 * `overview-contract.test.mjs` 与 `onboarding-contract.test.mjs` 里那几张
 * 「穷举注册面快照」被**每张票各改一遍**——两张票并行时必然在同一处冲突，
 * 而顺序还取决于 `index.tsx` 的 install 调用次序。这就是典型的「会一直收税的结构」。
 *
 * 现在只有**这里**一处需要为「新增一个面板」而更新：
 *   - `PANEL_KEYS`：按 `index.tsx` 里 `install*` 的**真实调用顺序**列（`overview` 由本文件内联注册，恒第一）；
 *   - 其余导出全部由它派生，测试只做断言、不再手写清单。
 *
 * 维护规则：新面板 = 在 `PANEL_KEYS` 末尾加一个 key（并在 `index.tsx` 末尾加一行 install）。
 * 若某个 install 会额外注册非 main/sidebar 的槽（如藏的 `shell.overlay` 浮层），
 * 在 `EXTRA_REGISTRATIONS` 里注明它**挂在哪个 key 的那一对之后**。
 */

/** 玄枢面板的 main key，**顺序 = `index.tsx` 里 install 的调用顺序**（`overview` 恒第一）。 */
export const PANEL_KEYS = ['overview', 'pus', 'cang', 'onboarding', 'mingpan', 'consult', 'digao', 'rikke', 'workflow', 'wansheng']

/**
 * 不是「main + sidebar 一对」的额外注册。
 * `after` = 挂在哪一对之后；`names` = 它会产生的 `registers.map(r => r.name)` 项。
 */
export const EXTRA_REGISTRATIONS = [
  { after: 'cang', names: ['shell.overlay'], cells: ['shell.overlay\u0000xuanshu-cang-drawer'] },
  // 票 12：挂载账本抽屉（S8）——挂在 `consult` 那一对之后（票 12 的 install 排在票 10 之后）。
  { after: 'consult', names: ['shell.overlay'], cells: ['shell.overlay\u0000xuanshu-mounts-drawer'] },
  {
    // #24（早间触达）：设置里的一行两项开关（AI 建议段 / 通知摘要），**不新增 main key / 侧栏行**。
    // `after: 'rikke'`：`installTouchSettings` 紧跟 `installRikke`（读同一个「今天要不要 AI 段」的产物），
    // 而票 16 的 workflow 那一对插在它之后 —— 顺序不符会被 `expectedRegisterNames()` 抓到。
    after: 'rikke',
    names: ['settings.general.item'],
    cells: ['settings.general.item\u0000xuanshu.touch'],
  },
  {
    // 票 15（沉淀闭环）：**会话内区块**，不新增 main key / 侧栏行（S10 §1 D5 / F1）。
    // 入口在收尾条、草稿卡在 `turnTail`、通知落框架浮层 —— 三处都是加性 cell。
    // `after: 'workflow'`（不是 `rikke`）：`installSediment` 排在最后，而票 16 的 workflow 那一对
    // 插在 rikke 之后 —— 顺序不符会被 `expectedRegisterNames()` 抓到。
    after: 'workflow',
    names: ['conversation.composer.dock', 'conversation.chat.turnTail', 'shell.overlay'],
    cells: [
      'conversation.composer.dock\u0000xuanshu.sediment-entry',
      'conversation.chat.turnTail\u0000xuanshu.sediment-draft',
      'shell.overlay\u0000xuanshu.sediment-notice',
    ],
  },
  {
    // 票 11（多 AI 合参）：同样挂在 `workflow` 那一对之后，**排在票 15 之后**
    // （`installBestOf` 是 `index.tsx` 里最后一个 install）——靠本数组顺序分先后。
    // 三者都不是 main/sidebar 面板；`/多模型` 命令走 `commandUi`，不是槽位，故不在本表。
    after: 'workflow',
    names: ['shell.overlay', 'settings.general.item', 'conversation.composer.dock'],
    cells: [
      'shell.overlay\u0000xuanshu-bestof-overlay',
      'settings.general.item\u0000xuanshu.bestof',
      'conversation.composer.dock\u0000xuanshu-bestof-trigger',
    ],
  },
  {
    // 票 30（#30）：设置 → 「我的数据」分区（`settings.section`，**不新增 main key / 侧栏行**）。
    // `after: 'workflow'`：`installDataSettings` 排在票 11 之后、票 27 之前；
    // 本数组顺序 = 注册序，顺序不符会被 `expectedRegisterNames()` 抓到。
    after: 'workflow',
    names: ['settings.section'],
    cells: ['settings.section\u0000xuanshu.data'],
  },
  {
    // P4（复核 #26）：设置 → 「事记」分区（墓碑恢复 + 可排除目录），同样是 `settings.section`
    // 的纯加性 cell；`installShijiSettings` 紧跟在 `installDataSettings` 之后。
    after: 'workflow',
    names: ['settings.section'],
    cells: ['settings.section\u0000xuanshu.shiji'],
  },
  {
    // 票 27（#27）：会话内「存成今天的事记」——**一个** composer 入口条，不新增 main key / 侧栏行。
    // 与 sediment / bestof 一样挂在 `workflow` 那一对之后，排在它们之后（`installShiji` 是最后一个 install）。
    after: 'workflow',
    names: ['conversation.composer.dock'],
    cells: ['conversation.composer.dock\u0000xuanshu.shiji-entry'],
  },
]

/** 每个 key 产生的一对注册名（main 面板 + 侧栏行）。 */
export function expectedRegisterNames() {
  const names = []
  for (const key of PANEL_KEYS) {
    names.push('main', 'sidebar.panellist')
    for (const extra of EXTRA_REGISTRATIONS.filter((entry) => entry.after === key)) names.push(...extra.names)
  }
  return names
}

/** 全部注册落成的 cell（`main\0<key>` / `sidebar.panellist\0<id>` / 额外项），字典序排序。 */
export function expectedCells() {
  const cells = [
    ...PANEL_KEYS.map((key) => `main\u0000${key}`),
    ...PANEL_KEYS.map((key) => `sidebar.panellist\u0000${key}`),
    ...EXTRA_REGISTRATIONS.flatMap((entry) => entry.cells),
  ]
  return cells.sort()
}

/** DSH 本机已占用的 main key / 侧栏 id（遮蔽判据）：玄枢一个都不许撞。 */
export const DSH_MAIN_KEYS = ['conversation', 'plugins', 'schedules']
export const DSH_SIDEBAR_IDS = ['plugins', 'schedules']

// ─────────────────────────────────────────────────────────────────────────────
// 界面面（face）清单 —— 体验质量线（spec 003）的**唯一分母来源**
//
// 「界面面」= 一个能被看见、能被巡检的渲染位置。它不是「屏」（一屏可能由多个面拼成），
// 也不是「组件」（一个面可能由多个组件实现）。巡检的报告分母 = 面数 × 判据适用数，
// 所以面数一旦有第二份抄本，数字就再也没法比。这里**不另列清单**：
//   - 面板面由 `PANEL_KEYS` 派生（一对注册 = main + sidebar.panellist）；
//   - 寄生面由 `EXTRA_REGISTRATIONS[].cells` 派生（长在 DSH 原生界面里的渲染位）；
//   - 命令面由 `COMMAND_FACES` 给（命令不是槽位，注册面里查不到，只能单列）。
// 下面两张表只补两件注册面里查不到的东西：人读名 `label` 与源文件 `sources`。
// **维护规则**：新增一个注册 cell 而这里没登记 → `faceManifest()` 直接抛（契约测试与巡检
// 分母同时红），所以「新增界面面时清单自动跟上」不靠人记得。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 面板两侧渲染位置的两件补充信息：`label`（报告里给人看的名）与 `sources`（静态采集的光标范围）。
 * 键 = `PANEL_KEYS` 里的 main key。**加面板必须同时在这里加一行**。
 *
 * `sources` 用仓库相对 posix 路径；只列「这个面的渲染与样式代码」，不列数据面 / 控制器
 * （那些不是界面）。多列文件不会让判据变宽或变窄：判据只问该面内的问题。
 */
export const PANEL_FACE_META = {
  overview: {
    label: '自我总览',
    sources: [
      'packages/xuanshu-client/src/client/OverviewPanel.tsx',
      'packages/xuanshu-client/src/client/OverviewIcon.tsx',
      'packages/xuanshu-client/src/client/cards.tsx',
      'packages/xuanshu-client/src/client/style.ts',
    ],
  },
  pus: { label: '谱管理', sources: ['packages/xuanshu-client/src/client/PuPanel.tsx'] },
  cang: {
    label: '藏库',
    sources: ['packages/xuanshu-client/src/client/CangPanel.tsx', 'packages/xuanshu-client/src/client/cang-style.ts'],
  },
  onboarding: {
    label: '八字冷启动向导',
    sources: ['packages/xuanshu-client/src/client/onboarding.tsx', 'packages/xuanshu-client/src/client/onboarding-steps.tsx'],
  },
  mingpan: { label: '命盘卡详情', sources: ['packages/xuanshu-client/src/client/MingpanPanel.tsx'] },
  consult: {
    label: '问事门厅',
    sources: ['packages/xuanshu-client/src/client/consult.tsx', 'packages/xuanshu-client/src/client/consult-views.tsx'],
  },
  digao: { label: '底稿面板', sources: ['packages/xuanshu-client/src/client/digao.tsx', 'packages/xuanshu-client/src/client/digao-style.ts'] },
  rikke: { label: '日课面板', sources: ['packages/xuanshu-client/src/client/rikke.tsx', 'packages/xuanshu-client/src/client/rikke-style.ts'] },
  workflow: { label: '工作流门厅', sources: ['packages/xuanshu-client/src/client/workflow/WorkflowPanel.tsx'] },
  wansheng: { label: '晚省面板', sources: ['packages/xuanshu-client/src/client/wansheng.tsx'] },
}

/**
 * 寄生面的补充信息。键 = `EXTRA_REGISTRATIONS[].cells` 的 `slot\u0000id`。
 * 类别由槽名推出（见 `faceCategoryOfSlot`），这里不再写一遍。
 */
export const PARASITIC_FACE_META = {
  'shell.overlay\u0000xuanshu-cang-drawer': {
    label: '藏库抽屉',
    sources: ['packages/xuanshu-client/src/client/CangDrawer.tsx', 'packages/xuanshu-client/src/client/cang-style.ts'],
  },
  'shell.overlay\u0000xuanshu-mounts-drawer': {
    label: '挂载账本抽屉',
    sources: ['packages/xuanshu-client/src/client/mounts.tsx', 'packages/xuanshu-client/src/client/mounts-views.tsx'],
  },
  'settings.general.item\u0000xuanshu.touch': {
    label: '设置·触达开关',
    sources: ['packages/xuanshu-client/src/client/notify.tsx'],
  },
  'conversation.composer.dock\u0000xuanshu.sediment-entry': {
    label: '输入框·沉淀入口',
    sources: ['packages/xuanshu-client/src/client/sediment-views.tsx'],
  },
  'conversation.chat.turnTail\u0000xuanshu.sediment-draft': {
    label: '回合尾·沉淀草稿',
    sources: ['packages/xuanshu-client/src/client/sediment-views.tsx'],
  },
  'shell.overlay\u0000xuanshu.sediment-notice': {
    label: '浮层·沉淀通知',
    sources: ['packages/xuanshu-client/src/client/sediment-views.tsx'],
  },
  'shell.overlay\u0000xuanshu-bestof-overlay': {
    label: '浮层·多 AI 合参',
    sources: ['packages/xuanshu-client/src/client/bestof.tsx', 'packages/xuanshu-client/src/client/bestof-views.tsx', 'packages/xuanshu-client/src/client/bestof-style.ts'],
  },
  'settings.general.item\u0000xuanshu.bestof': {
    label: '设置·合参开关',
    sources: ['packages/xuanshu-client/src/client/bestof.tsx', 'packages/xuanshu-client/src/client/bestof-views.tsx'],
  },
  'conversation.composer.dock\u0000xuanshu-bestof-trigger': {
    label: '输入框·合参触发',
    sources: ['packages/xuanshu-client/src/client/bestof.tsx', 'packages/xuanshu-client/src/client/bestof-views.tsx'],
  },
  'settings.section\u0000xuanshu.data': {
    label: '设置·我的数据',
    sources: ['packages/xuanshu-client/src/client/data.tsx', 'packages/xuanshu-client/src/client/data-style.ts'],
  },
  'settings.section\u0000xuanshu.shiji': {
    label: '设置·事记',
    sources: ['packages/xuanshu-client/src/client/shiji-views.tsx'],
  },
  'conversation.composer.dock\u0000xuanshu.shiji-entry': {
    label: '输入框·存成事记',
    sources: ['packages/xuanshu-client/src/client/shiji-views.tsx'],
  },
}

/**
 * 命令面：**不是槽位**，注册面（`expectedCells()`）里查不到，所以只能单列。
 * 名字必须与 `bestof.tsx` 的 `BESTOF_COMMAND_NAMES` 一致（契约测试两边对拍）。
 */
export const COMMAND_FACES = [
  { name: '多模型', label: '命令·多 AI 合参', sources: ['packages/xuanshu-client/src/client/bestof.tsx'] },
  { name: '合参', label: '命令·合参别名', sources: ['packages/xuanshu-client/src/client/bestof.tsx'] },
  { name: 'bestof', label: '命令·bestof 别名', sources: ['packages/xuanshu-client/src/client/bestof.tsx'] },
]

/** 槽名 → 面类别。寄生位只有这五类（加上面板与命令共七类）。 */
export function faceCategoryOfSlot(slot) {
  switch (slot) {
    case 'shell.overlay':
      return 'drawer'
    case 'settings.section':
      return 'settings-section'
    case 'settings.general.item':
      return 'settings-item'
    case 'conversation.composer.dock':
      return 'composer-dock'
    case 'conversation.chat.turnTail':
      return 'turn-tail'
    default:
      throw new Error(`panel-surface: 未登记的寄生槽「${slot}」——先给它归类，再加界面面（否则报告分母会静默漏掉它）`)
  }
}

/** 稳定的界面面 id：`panel:<key>` / `slot:<slot>#<cellId>` / `command:<name>`。 */
export function faceIdOfCell(cell) {
  const [slot, id] = cell.split('\u0000')
  return slot === 'main' ? `panel:${id}` : `slot:${slot}#${id}`
}

/**
 * 30 个界面面的真实清单（**由注册面派生，不另抄**）。
 *
 * 实测口径（2026-10-30）：10 个面板 + 12 个寄生位 + 3 个命令 = **25 个面**。
 * spec 003 正文与票 01 里的「18 个寄生 / 30 面」是把 4+2+2+3+1+3=15 这份枚举估成了 18；
 * 分母按**真实注册面**算（多一个面少一个面都由这里决定），差异已记进
 * `docs/development-status.md` §17，不靠改文档把数字凑上。
 *
 * @returns {{id: string, kind: 'panel'|'parasitic'|'command', category: string, slot: string|null, cell: string|null, label: string, sources: string[]}[]}
 *   顺序 = 注册序（面板及其后的寄生位交错），命令面排最后。
 * @throws 当某个真实注册 cell / key 没有补充信息时（新增面没登记 = 立刻红，不静默缩水）。
 */
export function faceManifest() {
  const faces = []
  for (const key of PANEL_KEYS) {
    const meta = PANEL_FACE_META[key]
    if (meta === undefined) throw new Error(`panel-surface: 面板「${key}」没有登记 label / sources（补 PANEL_FACE_META）`)
    faces.push({
      id: `panel:${key}`,
      kind: 'panel',
      category: 'panel',
      slot: 'main',
      cell: `main\u0000${key}`,
      label: meta.label,
      sources: [...meta.sources],
    })
  }
  for (const extra of EXTRA_REGISTRATIONS) {
    for (const cell of extra.cells) {
      const meta = PARASITIC_FACE_META[cell]
      if (meta === undefined) throw new Error(`panel-surface: 寄生位「${cell}」没有登记 label / sources（补 PARASITIC_FACE_META）`)
      const [slot] = cell.split('\u0000')
      faces.push({
        id: faceIdOfCell(cell),
        kind: 'parasitic',
        category: faceCategoryOfSlot(slot),
        slot,
        cell,
        label: meta.label,
        sources: [...meta.sources],
      })
    }
  }
  for (const command of COMMAND_FACES) {
    faces.push({
      id: `command:${command.name}`,
      kind: 'command',
      category: 'command',
      slot: null,
      cell: null,
      label: command.label,
      sources: [...command.sources],
    })
  }
  const ids = new Set(faces.map((face) => face.id))
  if (ids.size !== faces.length) throw new Error('panel-surface: 界面面 id 有重复（id 必须稳定且唯一）')
  return faces
}
