#!/usr/bin/env node
/**
 * `scripts/ux/nav-vocabulary.mjs` —— 判据族 `N`（导航）的**口径常量**（spec 003 §导航与跳转；#60）。
 *
 * 为什么单独一层（与 `state-vocabulary.mjs` 同一个理由）：判据里出现的「动作 / 入口原语 / 抽屉面」
 * 都是**一套名字**。采集器按它认入口，判定谓词按它说人话，报告按它分栏 —— 三处各写一份，
 * 「同一个动作」就会变成三个意思，报告里的红也就没法核对。
 *
 * 本文件**不读文件、不判对错**，只有常量与两个纯函数（`faceOfLabel` / `serializeActions`）。
 * 「算不算过」只在 `scripts/ux/assertions/n.mjs`。
 *
 * ── 口径（先写在这里，免得下次有人以为这是漏采）──────────────────────────────
 *
 * **入口**（entry）= 界面上一个**能点、且点了会去某个界面面**的控件。玄枢有四套入口原语
 * （spec 003 §Solution 第 3 段 / §Further Notes「导航族的已知空白」）：
 *
 *   | 原语 | 长什么样 |
 *   |---|---|
 *   | `sidebar-row` | DSH 侧栏里那一行（`sidebar.panellist` 注册出来的） |
 *   | `panel` | 面板内部的按钮 / 文字链（例如问事门厅的「管理谱 ▸ S5」） |
 *   | `drawer` | 抽屉里的入口（`shell.overlay` 里 `role="dialog"` 的那一层） |
 *   | `composer-dock` | 输入框旁的那一条（`conversation.composer.dock`） |
 *   | `command` | 命令面板 / 命令名（`/多模型`） |
 *
 * **入口的认定**有两条线索，缺一不可地都要收（只有其中一条会漏采）：
 *   1. **结构线索**：控件带 `data-xuanshu-nav="<面板 key>"`（`cards.tsx` 的 `NavLink` / 快捷入口
 *      三格都是这么写的）—— 它逐字说出目标是哪个面板，不需要猜文案；
 *   2. **文案线索**：控件的可访问名**等于**动作名（`NAV_ACTIONS[].pattern` 逐个显式列出）。
 *      为什么不用「包含」：总览的四卡把标题与副标题拼在同一个按钮里（「问事 底座未立 · 会先引导
 *      你填出生信息」），包含匹配会把**被置灰的**那一格算成问事的第二个入口 —— 而置灰的入口本来就
 *      不是入口（`disabled` 一律不收，见 `browser-nav.mjs`）。
 *
 * **不判的**：
 *   - 命令原语今天在隔离实例里**根本渲染不出来**（`Ctrl+K` 不弹命令面板，见 2026-10-31 实测），
 *     所以命令入口这一路是「未观测」，不是「唯一」；
 *   - 侧栏顶部 DSH 自己的行（插件 / 自动化任务 / 新建会话）不是玄枢的入口，一条都不收。
 *
 * 仅使用 Node 内置模块。ESM。
 */

/** 本族的三条判据 id（报告分栏按它归组；顺序 = 报告顺序）。 */
export const NAV_CRITERIA = ['N-001', 'N-002', 'N-003']

/** 判据 id → 一句话短名（报告的小标题用它，不另造词）。 */
export const NAV_KIND_LABEL = {
  'N-001': '入口唯一',
  'N-002': '返回落点',
  'N-003': '键盘可达',
}

/** 入口原语的固定顺序（报告里按这个顺序列，不按 DOM 顺序 —— 否则两份报告不可比）。 */
export const ENTRY_PRIMITIVES = ['sidebar-row', 'panel', 'drawer', 'composer-dock', 'command']

/** 原语的中文名（说人话的那一份）。 */
export const ENTRY_PRIMITIVE_LABEL = {
  'sidebar-row': '侧栏行',
  panel: '面板',
  drawer: '抽屉',
  'composer-dock': '输入框 dock',
  command: '命令',
}

/**
 * 动作表：**一个动作**（`id`）→ 它该去的界面面（`face`）+ 界面上怎么认它（`pattern`）。
 *
 * 加一行 = 承认「这个动作只该有一个入口」。`face` 必须是 `panel-surface.mjs` 里的真界面面 id
 * （`panel:<key>` / `slot:<槽>\u0000<id>` 的 `slot:` 形式见下），否则那条判据永远没有分母。
 *
 * `pattern` 的写法：一律**整串锚定**（`^…$`），不做包含匹配 —— 理由见文件头「入口的认定」。
 */
export const NAV_ACTIONS = [
  {
    id: 'overview',
    face: 'panel:overview',
    label: '总览',
    pattern: /^(?:总览|← 总览|回总览|回总览 ▸|← 回总览)$/,
  },
  {
    id: 'consult',
    face: 'panel:consult',
    label: '问事',
    pattern: /^(?:问事|去问事)(?: ▸)?$/,
  },
  {
    id: 'pus',
    face: 'panel:pus',
    label: '谱管理',
    pattern: /^(?:谱|管理谱|查看谱|去谱管理)(?: ▸(?: S\d+)?)?$/,
  },
  {
    id: 'cang',
    face: 'panel:cang',
    label: '藏库',
    pattern: /^(?:藏|去藏库|打开藏库)$/,
  },
  {
    id: 'digao',
    face: 'panel:digao',
    label: '底稿',
    pattern: /^(?:底稿|打开底稿|看底稿)(?: ->| ▸)?$/,
  },
  {
    id: 'rikke',
    face: 'panel:rikke',
    label: '日课',
    pattern: /^(?:日课|看完整日课|打开日课)(?: ->| ▸)?$/,
  },
  {
    id: 'workflow',
    face: 'panel:workflow',
    label: '工作流',
    pattern: /^(?:工作流|去工作流)(?: ->| ▸)?$/,
  },
  {
    id: 'wansheng',
    face: 'panel:wansheng',
    label: '晚省',
    pattern: /^(?:晚省|看完整晚省)(?: ->| ▸)?$/,
  },
  {
    id: 'onboarding',
    face: 'panel:onboarding',
    label: '八字冷启动向导',
    pattern: /^(?:填八字|开始填写出生信息 ->)$/,
  },
  {
    id: 'mingpan',
    face: 'panel:mingpan',
    label: '命盘详情',
    pattern: /^(?:命盘|看详情 ->)$/,
  },
  {
    // 抽屉是「床」不是「门」：它没有侧栏行，只能从藏库面板里的按钮打开。
    id: 'cang-drawer',
    face: 'slot:shell.overlay#xuanshu-cang-drawer',
    label: '藏登记抽屉',
    pattern: /^(?:登记藏|登记第一个藏|编辑登记|重新定位)$/,
  },
  {
    id: 'mounts-drawer',
    face: 'slot:shell.overlay#xuanshu-mounts-drawer',
    label: '挂载账本抽屉',
    pattern: /^(?:临时挂载…|临时挂载|挂载 \d+ 字 \/ 预算 .+)$/,
  },
]

/**
 * `data-xuanshu-nav="<target>"` → 界面面。**只收真界面面**：`conversation` 是 DSH 原面板、
 * 不在 25 个界面面里（`panel-surface.mjs` 的分母不含它），所以它不映射、不参与入口唯一性判定
 * —— 判一条没有分母的动作唯一性，只会给报告加一行没人能修的噪音。
 */
export const NAV_TARGET_FACE = {
  overview: 'panel:overview',
  consult: 'panel:consult',
  pus: 'panel:pus',
  cang: 'panel:cang',
  digao: 'panel:digao',
  rikke: 'panel:rikke',
  wansheng: 'panel:wansheng',
  workflow: 'panel:workflow',
  onboarding: 'panel:onboarding',
  mingpan: 'panel:mingpan',
}

/**
 * 抽屉面：`role="dialog"` 的那一层怎么认回界面面 id。
 * 键 = 抽屉根上 `aria-labelledby` 指的标题元素 id（那是抽屉自己声明的同一个事实）；
 * 值 = `panel-surface.mjs` 里的寄生面 id。
 */
export const DRAWER_FACES = {
  'xs-cang-drawer-title': 'slot:shell.overlay#xuanshu-cang-drawer',
  'xs-mounts-title': 'slot:shell.overlay#xuanshu-mounts-drawer',
}

/** 「DSH 会话面板」不是界面面，但 N-002 要说清「落到哪去了」，所以给它一个可读名。 */
export const NON_FACE_LABEL = {
  'panel:conversation': 'DSH 会话面板（工作区）',
  unknown: '认不出来的位置',
}

/** 界面面的中文名（报告与 message 用；未知时退回 id）。 */
export function faceLabelOf(face, faces = []) {
  const found = faces.find((candidate) => candidate.id === face)
  if (found !== undefined && typeof found.label === 'string' && found.label !== '') return found.label
  return NON_FACE_LABEL[face] ?? face
}

/** 入口原语的中文名（未知原语原样显示 —— 不装作认识它）。 */
export function primitiveLabelOf(primitive) {
  return ENTRY_PRIMITIVE_LABEL[primitive] ?? primitive
}

/**
 * 文案 → 动作（只认整串锚定，见文件头）。
 * @param {string} label 控件的可访问名（已归一空白）
 * @returns {{id: string, face: string, label: string} | undefined}
 */
export function actionOfLabel(label) {
  const text = String(label ?? '').trim().replace(/\s+/g, ' ')
  for (const action of NAV_ACTIONS) {
    if (action.pattern.test(text)) return action
  }
  return undefined
}

/**
 * 动作表 → 页面里能用的形状（`page.evaluate` 只吃可序列化的东西，正则要拆成 source/flags）。
 * @returns {{actions: {id: string, face: string, source: string, flags: string}[], navTargets: Record<string,string>, drawerFaces: Record<string,string>}}
 */
export function serializeActions() {
  return {
    actions: NAV_ACTIONS.map((action) => ({ id: action.id, face: action.face, source: action.pattern.source, flags: action.pattern.flags })),
    navTargets: { ...NAV_TARGET_FACE },
    drawerFaces: { ...DRAWER_FACES },
  }
}
