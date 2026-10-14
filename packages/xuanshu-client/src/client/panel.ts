/**
 * 玄枢客户端插件的共享常量与逐字文案。
 *
 * `PANEL_ID` 是全票唯一的耦合点：`main` keyed 槽的 `key` 与
 * `sidebar.panellist` list 槽的 `id` **必须是同一个字符串** —— 这是
 * 「侧栏行 ↔ 主面板」配对的唯一依据。
 *
 * 依据（本机 0.2.0-rc.2 实装，只读核对）：
 *   - `@deepseek-ai/dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:100-108`
 *     `SidebarPanelMetadata { id: MainPanelId; order: number; label: string }`
 *     注释「List id and matching main panel key」。
 *   - `@deepseek-ai/dsh-client-ui-sidebar/lib/client.js:454-461`
 *     侧栏把 `entriesOfSlot("sidebar.panellist")` 的 `options.id` 直接当作
 *     面板 id 收集成 `{id, order, label}`；`:478-481` 的 `selectPanel(id)`
 *     最终走 `ctx.layout.selectPanel(id)`。
 *   - 真 prior art：`@deepseek-ai/dsh-client-ui-schedule/lib/client.js:6793-6810`
 *     用同一个 `PANEL_ID` 常量注册 main 与 sidebar 两处。
 */

/**
 * 面板 key == 侧栏行 id。
 * 值固定为 `overview`（票 01 契约 §0 / §4；票 07 · 首页替换在此落四卡）。
 */
export const PANEL_ID = 'overview';

/**
 * 侧栏行顺序（`list` 槽 `order`，升序，tie 保注册序）。
 * 依据：`@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:564-569`
 * （`order?: number`）与 `…/ui-sidebar/lib/client.js:461`（`sort` 升序）。
 *
 * 取 20：DSH 原样行 `plugins` 0 / `schedules` 10 在其前（属原样行），
 * 而 `overview` 是**玄枢自有行中的第一行**（S15:312 / 待实测登记处 V11）。
 */
export const PANEL_ORDER = 20;

/**
 * 侧栏行的显示文案。
 *
 * 用**纯字符串**（`SlotLabel = string | (() => string)`，
 * `@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:555`），
 * 不注册 locale 字典：少接一个服务就少一条会挂的注入边。
 * 侧栏按 `resolveSlotLabel(options.label) ?? id` 取值（`…/ui-sidebar/lib/client.js:459`）。
 * 文案「总览」与 S15 §2 的六行表一致（`S15-管理入口与骨架落位.md:40,50,74`）。
 */
export const PANEL_LABEL = '总览';

/** 面板页头标题（S1 §2.1 线框图「家 - 自我总览」）。 */
export const PANEL_TITLE = '自我总览';
/** 面板页头的「家」分区标记（D1 定案，S15 §2）。 */
export const PANEL_HOME = '家';
/** 页眉右上角常驻只读路径展示（S1 §9 C11）。 */
export const PANEL_LOCAL_NOTE = '数据都在本地 ~/.dsh/xuanshu/';

/** 卡头文案（S1 §3.1）。 */
export const CARD_TITLE = {
  mingpan: '命盘 / 八字',
  rike: '日课',
  digao: '底稿',
  quicklinks: '快捷入口',
} as const;

/** 只读 / 纯派生两类徽标（逐字固定，跨屏一致；S1 §9 C1/C2、assets/skins/badge-readonly.md）。 */
export const BADGE_READONLY = '只读 · 由出生信息与底座生成';
export const BADGE_DERIVED = '纯派生 · 不可手改';

/** 快捷入口三格文案（S1 §3.1④；底座未立时问事格副标题换提示句）。 */
export const QUICKLINK = {
  consult: { title: '问事', subtitle: '书房' },
  conversation: { title: '工作区', subtitle: '车间' },
  workflow: { title: '工作流', subtitle: '流水线' },
} as const;

/** 底座未立时问事格副标题（asset.S4-10 第四条定稿）。 */
export const QUICKLINK_CONSULT_UNREADY = '底座未立 · 会先引导你填出生信息';

/** 快捷入口卡的边界说明行（S1 §9 C6②：常驻，不得做成 hover 才出现）。 */
export const QUICKLINKS_BOUNDARY =
  '谱 / 藏 / 定时任务是管理入口，在侧栏「库」与设置里，不在本卡。';

/**
 * 冷启动空态文案（asset.S4-10 定稿表：实现票直接取用，不另造措辞）。
 * 依据：`docs/design/ui-v1/assets/copy/s4-cold-start-empty-copy.md`。
 */
export const EMPTY_COPY = {
  mingpan: {
    why: '底座还没立起来',
    sub: '填一次出生信息，命盘就点亮了。（预计 1 分钟；之后不再重复录入）',
  },
  rike: {
    why: '今天还没有生成日课。日课默认每天 07:30 生成。',
    sub: '（底座未立时生成会失败）',
  },
  digaoUnready: {
    why: '底座未立，还没有可提炼的来源。',
    sub: '这里不会先有内容：提炼源是 0。',
  },
  digaoNeverRefreshed: {
    why: '底稿还没生成过。',
    sub: '刷新一次就会按三路来源拼出骨架。',
  },
} as const;

/**
 * 卡级 error 态文案（S1 §6 error 行逐字；四卡共用 cards-error 插画）。
 * 07 无取数链路 → error 态不可达，仅结构（票 08 / 13 接上取数后由它们触发）。
 */
export const ERROR_COPY = {
  mingpan: '命盘快照读不出来（文件缺失或格式不符）。',
  rike: '日课生成失败：底座未就绪 / 推运调用失败。',
  digao: '底稿读不出来。',
} as const;

/** 按钮文案（S1 §2 线框与 §3.1 散文；ASCII 箭头与线框一致）。 */
export const ACTION_COPY = {
  startOnboarding: '开始填写出生信息 ->',
  openDetail: '看详情 ->',
  generate: '立即生成',
  watchFull: '看完整日课 ->',
  changeTime: '改时间 ->',
  openDigao: '打开底稿 ->',
  refresh: '刷新',
  retry: '重试',
  sourcePu: '谱',
  sourceWorkspace: '工作区',
  sourceWorkflow: '工作流',
  adjustSource: '要改就改源头：',
} as const;

/**
 * fail-soft 置灰理由（S1 §6 ④ error 行 + 四方「目标未装配」的显式说明）。
 * 这些 target / 动作的装配责任票号写进理由里：谁装配了谁就把回调/面板键接上，
 * 置灰不需要改结构（S1 §6④「fail-soft 置灰 + Tooltip 说明原因」）。
 */
export const DISABLED_REASON = {
  consult: '问事面板还没装配（属票 10 · 问事闭环）',
  workflow: '工作流面板还没装配（属票 16 · 工作流创建向导）',
  pus: '谱面板还没装配（属票 09 · 谱管理）',
  digao: '底稿面板还没装配（属票 13 · 底稿与日课）',
  onboarding: '八字冷启动向导还没装配（属票 08）',
  generate: '日课生成还没接上（属票 13 · 底稿与日课）',
  refreshDigao: '底稿刷新还没接上（属票 13 · 底稿与日课）',
  openDetail: '命盘详情还没装配（属票 08）',
  retry: '取数重试还没接上（属票 08 / 13）',
} as const;

/** 卡级三态 + ready（S1 §6：每卡各自三态，D2 卡级骨架、无整页 loading）。 */
export type CardState = 'empty' | 'loading' | 'error' | 'ready';

/** 面板导航目标（= `main` keyed 槽的 key；`conversation` 特殊：回 DSH 原面板）。 */
export type PanelNavTarget =
  | 'consult'
  | 'pus'
  | 'digao'
  | 'workflow'
  | 'schedules'
  | 'conversation';

/** 四卡的 DOM 名（`data-xuanshu-card`；素材命名法见 assets README §2）。 */
export type CardName = 'mingpan' | 'rike' | 'digao' | 'quicklinks';
