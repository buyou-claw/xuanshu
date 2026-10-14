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
export const PANEL_KEYS = ['overview', 'pus', 'cang', 'onboarding', 'mingpan', 'consult', 'digao', 'rikke']

/**
 * 不是「main + sidebar 一对」的额外注册。
 * `after` = 挂在哪一对之后；`names` = 它会产生的 `registers.map(r => r.name)` 项。
 */
export const EXTRA_REGISTRATIONS = [
  { after: 'cang', names: ['shell.overlay'], cells: ['shell.overlay\u0000xuanshu-cang-drawer'] },
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
