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

import { DATA_DIR_PLACEHOLDER, dataDirPath, withTrailingSeparator } from './home-paths.js';

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

/**
 * 票 08 的两个新 main key：`onboarding`（S3 冷启动向导）/ `mingpan`（S2 命盘详情）。
 *
 * 为什么各带一条侧栏行（而不是像屏稿原本设想的那样藏在 `overview` 的子状态里）：
 *   契约 §6 冻结了「新 main key + 各带一条 `sidebar.panellist` 行」，理由是 DSH 的
 *   keyed `main` 槽按 key 分派、`sidebar.panellist` 只认 `{id, order, label}`（D7 无分组字段）。
 *   **F1 的后果要知道**：这两个 key ≠ `conversation`，所以面板内没有会话绑定、
 *   `conversation.*` 子槽不渲染、右侧栏命令不可用（`DSH槽位映射.md` §0 F1）——
 *   向导与详情都不需要会话座位，这是刻意的选择。
 */
export const ONBOARDING_ID = 'onboarding';
export const MINGPAN_ID = 'mingpan';

/** 侧栏行文案（D1 分区靠 order + 措辞表达，不承诺分组容器）。 */
export const ONBOARDING_LABEL = '填八字';
export const MINGPAN_LABEL = '命盘';

/**
 * 这两个 key 的侧栏 order。
 *
 * 取 80 / 90：S15 §2 的六行表把 *问事 30 / 谱 40 / 藏 50 / 底稿 60 / 工作流 70*
 * 都**预约**给了后续票（`S15-管理入口与骨架落位.md:178,233`），插进 30 或 60 会与未来票撞位；
 * 80 / 90 是 70 之后的两个空档，既保持「10 一档」的既有约定，又不动任何既有值
 * （契约 §7：既有 key 的语义与 `PANEL_ORDER` 既有值都不许改）。
 *
 * 语义上也没问题：向导与详情是**流程入口**（进一次做完就走），排在管理入口之后，
 * 与「总览 20 是玄枢自有行中的第一行」的口径不冲突。
 */
export const ONBOARDING_ORDER = 80;
export const MINGPAN_ORDER = 90;

/**
 * 票 10 的 main key：`consult`（问事门厅，S6）。
 *
 * 与 S1 的四卡**不是**同一层东西：四卡里那格「问事」是快捷入口（跳转），
 * 这里是被跳到的面板本体。侧栏 order 取 **30** —— 这正是 S15 §2 六行表里
 * 预约给「问事（书房）」的那一档（`S15-管理入口与骨架落位.md:178,233`：
 * `overview` 20 / `consult` 30 / `pus` 40 / `cang` 50 / `digao` 60 / `workflow` 70），
 * 所以票 08 当初把 80/90 留给向导与详情是正确的：30 空着就是等这一票。
 *
 * label 用「问事」（不是分区名「书房」）：D7 说明 `sidebar.panellist` 只读
 * `{id, order, label}`、没有分组字段，分区语义只能落在措辞上。
 */
export const CONSULT_ID = 'consult';
export const CONSULT_LABEL = '问事';
export const CONSULT_ORDER = 30;

/** 面板页头标题（S1 §2.1 线框图「家 - 自我总览」）。 */
export const PANEL_TITLE = '自我总览';
/** 面板页头的「家」分区标记（D1 定案，S15 §2）。 */
export const PANEL_HOME = '家';
/**
 * 页眉右上角常驻只读路径展示（S1 §9 C11）。
 *
 * `dataDir` 由宿主回传（`data.overview.dataDir`，产品档 `~/.xuanshu/xuanshu` /
 * 开发档 `<repo>/.dsh-home/xuanshu`）；拿不到时给中性占位「玄枢数据目录」——
 * 不写死任何一档的路径，也不落回 DSH 桌面版的 home（ADR-0014）。
 * @param dataDir - 宿主回传的数据目录；缺席时显示中性占位。
 */
export function panelLocalNote(dataDir?: string): string {
  return typeof dataDir === 'string' && dataDir.trim() !== ''
    ? `数据都在本地 ${withTrailingSeparator(dataDirPath(dataDir))}`
    : `数据都在本地（${withTrailingSeparator(DATA_DIR_PLACEHOLDER)}）`;
}

/** 卡头文案（S1 §3.1；#25 加第 5 张「晚省」）。 */
export const CARD_TITLE = {
  mingpan: '命盘 / 八字',
  rike: '日课',
  digao: '底稿',
  quicklinks: '快捷入口',
  wansheng: '晚省',
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

/**
 * 底座未立时问事格副标题（asset.S4-10 第四条定稿）。
 *
 * 2026-11-01 改：原文「会先引导你填出生信息」是一句**假承诺** —— 点进问事直接到门厅，
 * 门厅里没有任何「填出生信息」的引导；而且门厅自己写的是
 * 「谱都非必填；你可以先空手问一句」（`consult-model.ts` 的 `noneOptionalPu`）。
 * 两句话对同一个用户说相反的下一步，用户只能猜。
 *
 * 这里改成真实会发生的事：空手也能问。至于「没有底座时答案缺什么」，
 * 归门厅自己说（它已经在说上下文含什么），不在这一行里重复。
 */
export const QUICKLINK_CONSULT_UNREADY = '底座未立 · 也能空手先问一句';

/**
 * 快捷入口卡的边界说明行（S1 §9 C6②：常驻，不得做成 hover 才出现）。
 *
 * 2026-11-01 改：原文写「在侧栏「库」与设置里」，但侧栏**没有「库」这个分区** ——
 * 实现是十行平铺（总览 / 问事 / 谱 / 藏 / 底稿 / 工作流 / 填八字 / 命盘 / 日课 / 晚省），
 * `谱` 与 `藏` 各自注册成独立的行（order 40 / 50），没有任何分组容器。
 * 用户按这句话去找「库」会找不到；「定时任务」在侧栏的实名也是「自动化任务」。
 * 这里改成点名实际存在的行 —— 导航名必须指的是点得到的东西。
 */
export const QUICKLINKS_BOUNDARY =
  '谱 / 藏 / 自动化任务是管理入口：都在侧栏，不在这张卡里。';

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
  // #25：晚省空态（它只摆事实；没生成时给两个出口：[立即生成] 与 [改时间]）。
  wansheng: {
    why: '今天还没有晚省。晚省默认每天 21:30 生成。',
    sub: '（它只摆事实、不替你下结论；点开进问事）',
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
  wansheng: '晚省读不出来（产物缺失或格式不符）。',
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
  // #25：晚省的四个出口。
  watchWansheng: '看完整晚省 ->',
  goConsult: '去问事 ->',
  generateWansheng: '立即生成',
  history: '投递历史',
} as const;

/**
 * fail-soft 置灰理由（S1 §6 ④ error 行 + 四方「目标未装配」的显式说明）。
 * 这些 target / 动作的装配责任票号写进理由里：谁装配了谁就把回调/面板键接上，
 * 置灰不需要改结构（S1 §6④「fail-soft 置灰 + Tooltip 说明原因」）。
 */
export const DISABLED_REASON = {
  consult: '问事面板还没装配（属票 10 · 问事闭环）',
  // #29：AI 没接上时问事入口保持禁用。路径逐字与 `ai-model.ts` 的 AI_SETTINGS_PATH 一致
  // （界面上的可见原因由快捷入口卡的 `XsAiGate` 给，这里只做 title）。
  //
  // 2026-11-01 改：原来这里也写「配置 provider 与默认模型」，与 XsAiGate 里那句说的是两回事
  // （一个是缺 key、一个是缺 provider 选择），并排出现会让人以为要做两件事。
  // 具体缺什么由 XsAiGate 逐字说；这里只给去处。
  consultAi: '问事还开不了：先接上 AI（去「设置 → 模型」）。',
  workflow: '工作流面板还没装配（属票 16 · 工作流创建向导）',
  pus: '谱面板还没装配（属票 09 · 谱管理）',
  digao: '底稿面板还没装配（属票 13 · 底稿与日课）',
  rikke: '日课面板还没装配（属票 13 · 底稿与日课）',
  onboarding: '八字冷启动向导还没装配（属票 08）',
  generate: '日课生成还没接上（属票 13 · 底稿与日课）',
  refreshDigao: '底稿刷新还没接上（属票 13 · 底稿与日课）',
  openDetail: '命盘详情还没装配（属票 08）',
  retry: '取数重试还没接上（属票 08 / 13）',
  wansheng: '晚省面板还没装配（属票 04 · 晚间触达）',
  generateWansheng: '晚省生成还没接上（属票 04 · 晚间触达）',
} as const;

/** 卡级三态 + ready（S1 §6：每卡各自三态，D2 卡级骨架、无整页 loading）。 */
export type CardState = 'empty' | 'loading' | 'error' | 'ready';

/**
 * 计划时刻的显示口径：`03:30:00` → `03:30`。
 *
 * `ctx.schedule` 的 `time` 是 `HH:mm:ss.SSS`（契约 §1 的 daily 播种），而 `<input type="time">`
 * 与界面文案都只到分钟 —— 两处（底稿的「下次刷新」与日课的「计划时刻」）用同一个口径，
 * 免得一个显示秒、一个不显示。
 */
export function clockOf(time: string | undefined): string {
  if (time === undefined) return '';
  const parts = time.split(':');
  if (parts.length < 2) return time;
  return `${parts[0]}:${parts[1]}`;
}

/**
 * 把 ISO 时刻转成本地可读的 `11-01 10:57`。
 *
 * 2026-11-01 加：界面上原本直接把契约里的 ISO 串原样贴出来 ——
 * `上次刷新 2026-11-01T02:57:20.080Z`、`生成于 2026-11-01T04:07:36.225Z`。
 * 那是 UTC 原串，用户得自己 +8 才是本机时间；而同一个面板里「下次刷新」显示的却是本地 `03:30`，
 * 两种口径并排放着（底稿那一屏就是这样）。
 *
 * 认不出就原样返回 —— 宁可在极少数异常值上难看，也不编一个时间。
 * 不是今年才带上年份：`2025-12-31 23:59` 比 `12-31 23:59` 清楚。
 */
export function momentOf(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const two = (value: number): string => String(value).padStart(2, '0');
  const day = `${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  const clock = `${two(at.getHours())}:${two(at.getMinutes())}`;
  return at.getFullYear() === new Date().getFullYear() ? `${day} ${clock}` : `${at.getFullYear()}-${day} ${clock}`;
}

/**
 * 票 13 的两个新 main key：`digao`（S13 底稿只读面板）/ `rikke`（S14 看完整日课）。
 *
 * 两个 key 都**不是** `conversation`：面板内没有会话座位（`DSH槽位映射.md` F1），
 * 底稿与日课都不需要会话绑定。
 */
export const DIGAO_ID = 'digao';
export const RIKKE_ID = 'rikke';
/** #25：晚省面板（main key `wansheng`，order 110 —— 100 已被日课占用）。 */
export const WANSHENG_ID = 'wansheng';

/** 侧栏行文案（D7 措辞：不加「库 ·」前缀；日课是面板名本身）。 */
export const DIGAO_LABEL = '底稿';
export const RIKKE_LABEL = '日课';
export const WANSHENG_LABEL = '晚省';

/**
 * 两条侧栏行的 order。
 *
 * `digao` = 60 是 S13 §8 与 S15 六行表**已预约**的落位（库 · 谱 40 / 藏 50 / 底稿 60）。
 * `rikke` 在 S15 的六行表里**没有座位**（S14 §8 原本的口径是「日课不新增侧栏行」），
 * 但票 13 的冻结契约 §3 定死「新 main key 各带一条 `sidebar.panellist` 行（id 与 key 同字符串）」
 * ——行与面板配对是 DSH 侧栏的唯一依据，所以这里必须有一行。
 * 取 100：20/30/40/50/60/70 已由六行表预约、80/90 由票 08 的向导与详情占用，
 * 100 是唯一既不撞位、又保持「10 一档」的位置（也如实反映它是**后来追加**的一行）。
 */
export const DIGAO_ORDER = 60;
export const RIKKE_ORDER = 100;
/** #25：晚省的侧栏行 order（100 已被日课占用；110 是下一个既不撞位、又保持「10 一档」的空档）。 */
export const WANSHENG_ORDER = 110;

/**
 * 面板导航目标（= `main` keyed 槽的 key；`conversation` 特殊：回 DSH 原面板）。
 * 票 08 起多了 `onboarding`（冷启动向导）与 `mingpan`（命盘详情）两个玄枢自有 key；
 * 票 13 多了 `rikke`（日课：看完整日课）。
 *
 * **`overview` 也在表里**：向导与命盘详情都有「回总览」的动作，而 `PANEL_ID` 就是它 ——
 * 联合里漏掉它会让「回总览」在类型层不过（票 08 的三个调用点就这么漏了，
 * 直到票 13 跑 `tsc --noEmit` 才暴露）。导航目标 = 可被 `navigate()` 指向的 key，
 * **包含自家总览**，不是「除总览以外的去处」。
 */
export type PanelNavTarget =
  | 'overview'
  | 'consult'
  | 'pus'
  | 'digao'
  | 'rikke'
  | 'wansheng'
  | 'workflow'
  | 'schedules'
  | 'onboarding'
  | 'mingpan'
  | 'conversation';

/** 卡的 DOM 名（`data-xuanshu-card`；素材命名法见 assets README §2）。#25 加第 5 张「晚省」。 */
export type CardName = 'mingpan' | 'rike' | 'digao' | 'quicklinks' | 'wansheng';
