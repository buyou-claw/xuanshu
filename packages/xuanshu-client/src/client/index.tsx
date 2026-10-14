/**
 * xuanshu-client — 浏览器半边入口（`dsh.client.platform = "web"`）。
 *
 * 本模块被打成单文件 CJS，套上 `window.__ModuleLoader__.load({ id, factory })`
 * 信封后提交为 `lib/client.js`；factory 的返回对象就是 cordis 插件定义
 * （evidence：`@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/client.js:13-21`，
 * 以及真 prior art `@deepseek-ai/dsh-client-ui-schedule/lib/client.js` 的
 * `exports.apply = apply; exports.inject = inject;`）。
 *
 * 票 07 范围（首页替换 = 自我总览四卡）：
 *   1. `main` keyed 槽 key `overview` → `OverviewPanel`（四卡：命盘/日课/底稿/快捷入口）；
 *   2. `sidebar.panellist` list 槽行 `overview`（order 20，玄枢自有行第一行）→ `OverviewIcon`；
 *   3. **默认面板**：main 注册成功后 `ctx.layout.selectPanel('overview')`
 *      （`main` 槽的渲染键缺省回落 `conversation`，见
 *      `dsh-client-ui-layout/lib/client.js:118`：`activePanelId ?? "conversation"`）；
 *   4. token 覆盖层：`ctx.theme.overrideTokens('xuanshu-ui-v1', …)`（票 03 取值）；
 *   5. 样式随 JS 走：模块加载时注入一个 `<style>`（官方 ui-layout 同法）。
 *
 * 不注册进 `root` 槽（那是 single 槽，会单独占满整页）、不声明 `children`
 * （槽位声明排他，`main.conversation` 已由 ui-conversation 声明）、
 * 不加 priority（`overview` 是新 cell，纯加性、不遮蔽任何既有占用者）。
 */
import type { Context } from '@deepseek-ai/cordis';

import type { OverviewInjected } from './cards.js';
import { OverviewIcon } from './OverviewIcon.js';
import { OverviewPanel } from './OverviewPanel.js';
import { PANEL_ID, PANEL_LABEL, PANEL_ORDER } from './panel.js';
import type { PanelNavTarget } from './panel.js';
import { installOverviewStyle } from './style.js';
import { THEME_SOURCE, THEME_TOKENS } from './tokens.js';
import { EMPTY_MAIN_PANELS, createMainPanelsWatch } from './watch.js';
import type { MainPanelsWatch } from './watch.js';

/**
 * cordis **服务**注入名（不是包名！）。
 *
 * 与 `package.json` 的 `dsh.client.inject`（按包名的模块图边）是**两个不同的轴**：
 *   - 本导出 = cordis 服务名，fiber 等待这些服务就绪后才 apply；
 *   - `dsh.client.inject` = 模块图边 + 入口合成顺序（`dsh-package-manifest/lib/types/types.d.ts:79-80`）。
 *
 * 三个服务与提供者：
 *   - `slots`：ui-renderer（`dsh-client-ui-renderer/lib/types/client/registry.d.ts:46`）；
 *   - `layout`：ui-layout 的 `ctx.reflect.provide('layout', …)`
 *     （`dsh-client-ui-layout/lib/client.js:600`）——默认面板切换要用；
 *   - `theme`：ui-theme 的 `ctx.provide('theme', …)`
 *     （`dsh-client-ui-theme/lib/client.js:1582`）——token 覆盖层要用。
 *
 * 槽位**声明**的先后由 `ctx.slots.inject` 的语义兜住
 * （`registry.d.ts:96-111`：声明已存在就立即跑回调，否则挂在声明提交后再跑），
 * 所以无需在此等待 sidebar。
 */
export const inject = ['slots', 'layout', 'theme'];

/**
 * 挂载玄枢的槽位贡献。
 *
 * 两个 `ctx.slots.inject(key, cb)` 都返回幂等 disposer，而该 controller
 * 属于**调用方 fiber**（`registry.d.ts:100-104`），插件卸载时自动回收，
 * 因此这里不额外包一层 `ctx.effect`（token 覆盖层与 watch 除外——它们各自带 disposer）。
 *
 * @param ctx - 客户端 cordis 根上下文（需已提供 `slots` / `layout` / `theme`）。
 */
export function apply(ctx: Context): void {
  // 样式随 JS 走：经典脚本不过 CSS 管线，模块加载时挂一个 style 标签（幂等）。
  installOverviewStyle();

  // ① token 覆盖层（票 03 取值）：同 source 重复调用整层替换，disposer 挂 fiber。
  ctx.effect(
    () => ctx.theme.overrideTokens(THEME_SOURCE, THEME_TOKENS),
    'xuanshu-client: theme token overrides',
  );

  // ② main 面板键快照：四卡的 fail-soft 置灰要看「目标 main key 是否已注册」。
  let mainPanels: MainPanelsWatch = EMPTY_MAIN_PANELS;
  ctx.effect(() => {
    const handle = createMainPanelsWatch(ctx.slots);
    mainPanels = handle.watch;
    return () => {
      handle.dispose();
      mainPanels = EMPTY_MAIN_PANELS;
    };
  }, 'xuanshu-client: main panel watch');

  /**
   * 面板导航（注入给四卡）。
   * `conversation` 是 DSH 原面板：按 V94（`dsh-client-ui-layout/.../service.d.ts`）
   * `selectPanel(null)` 的语义是「显示当前会话」，即回工作区/会话那一屏。
   */
  const navigate = (target: PanelNavTarget): void => {
    if (target === 'conversation') {
      ctx.layout.selectPanel(null);
      return;
    }
    // 双保险：渲染层已按快照置灰，这里再挡一次未注册 key（selectPanel 对未注册 key 会 throw）。
    if (!mainPanels.getSnapshot().includes(target)) return;
    ctx.layout.selectPanel(target);
  };

  const injected = (): OverviewInjected => ({ navigate, mainPanels });

  // ③ 主面板：keyed 槽按 key 分派；key 必须与侧栏行 id 相同。
  // 依据：`…/dsh-client-ui-layout/lib/types/client/index.d.ts:49-56`（main 是 keyed/root）。
  ctx.slots.inject('main', () => {
    const dispose = ctx.slots.register(
      { name: 'main', key: PANEL_ID, inject: injected },
      OverviewPanel,
    );
    // ④ 默认面板：注册**成功之后**才切（selectPanel 对未注册 key 会 throw，
    //    见 `dsh-client-ui-layout/lib/client.js:462-466`）。
    ctx.layout.selectPanel(PANEL_ID);
    return dispose;
  });

  // ⑤ 侧栏全局面板行：list 槽，`id` 即上面的 key，`label` 走 resolveSlotLabel。
  // 依据：`…/ui-sidebar/lib/types/client/contract/slots.d.ts:46-50, 100-108`；
  //       `…/ui-sidebar/lib/client.js:454-461, 478-481`（id → label → selectPanel(id)）。
  // 先例：`…/ui-sidebar/lib/client.js` 与 `…/ui-schedule/lib/client.js:6804-6810`。
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: PANEL_LABEL },
      OverviewIcon,
    ),
  );
}
