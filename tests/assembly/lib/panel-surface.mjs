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
