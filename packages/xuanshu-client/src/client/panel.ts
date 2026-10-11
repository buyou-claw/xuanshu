/**
 * 玄枢客户端插件的共享常量。
 *
 * `PANEL_ID` 是本票唯一的耦合点：`main` keyed 槽的 `key` 与
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
 *     最终走 `ctx.layout.selectPanel(id)`（`…/layout/…/service.d.ts:32`）。
 *   - 真 prior art：`@deepseek-ai/dsh-client-ui-schedule/lib/client.js:6793-6810`
 *     用同一个 `PANEL_ID` 常量注册 main 与 sidebar 两处。
 */

/**
 * 面板 key == 侧栏行 id。
 * 值固定为 `overview`（票 01 契约 §0 / §4：`main` keyed 槽 key `overview`
 * + `sidebar.panellist` 行 id `overview`）。四卡内容属票 06。
 */
export const PANEL_ID = 'overview';

/**
 * 侧栏行顺序（`list` 槽 `order`，升序，tie 保注册序）。
 * 依据：`@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:564-569`
 * （`order?: number`）与 `…/ui-sidebar/lib/client.js:461`（`sort` 升序）。
 * 取 20：排在官方 `plugins`/`schedules`（order 10）之后，不抢首行；
 * 「设为默认面板」是票 06 的事，本票只做可被选中的一行。
 */
export const PANEL_ORDER = 20;

/** 占位文案（票 01 只做空壳；真实四卡文案属票 06）。 */
export const PANEL_TITLE = '玄枢';
export const PANEL_SUBTITLE = '自我总览';
export const PANEL_PLACEHOLDER =
  '玄枢首屏空壳：四张卡（命盘 / 日课 / 底稿 / 快捷入口）将在票 06 填入。';

/**
 * 侧栏行的显示文案。
 *
 * 用**纯字符串**（`SlotLabel = string | (() => string)`，
 * `@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:555`），
 * 不注册 locale 字典。理由：本票是无 i18n 的单中文占位壳，
 * 而 `ctx.locale` 的可用写法只有 `register(ns, locale, dict)` /
 * `bind(ns)`（`@deepseek-ai/dsh-client-ui-locale/lib/types/client/index.d.ts:199-226`），
 * 并不存在 `t(ns, key)`；少接一个服务就少一条会挂的注入边。
 * 侧栏按 `resolveSlotLabel(options.label) ?? id` 取值
 * （`…/ui-sidebar/lib/client.js:459`），字符串是完全合法的输入。
 */
export const PANEL_LABEL = '总览';
