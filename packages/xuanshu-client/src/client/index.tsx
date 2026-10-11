/**
 * xuanshu-client — 浏览器半边入口（`dsh.client.platform = "web"`）。
 *
 * 本模块被打成单文件 CJS，套上 `window.__ModuleLoader__.load({ id, factory })`
 * 信封后提交为 `lib/client.js`；factory 的返回对象就是 cordis 插件定义
 * （evidence：`@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/client.js:13-21`，
 * 以及真 prior art `@deepseek-ai/dsh-client-ui-schedule/lib/client.js` 的
 * `exports.apply = apply; exports.inject = inject;`）。
 *
 * 本票范围：**只注册空壳** —— `main` keyed 槽 key `overview` +
 * `sidebar.panellist` list 槽行 id `overview`（两处字符串同源，见 `./panel.js`）。
 * 四卡内容属票 06；不注册进 `root` 槽（会遮住整个框架）。
 */
import type { Context } from '@deepseek-ai/cordis';

import { OverviewIcon } from './OverviewIcon.js';
import { OverviewPanel } from './OverviewPanel.js';
import { PANEL_ID, PANEL_LABEL, PANEL_ORDER } from './panel.js';

/**
 * cordis **服务**注入名（不是包名！）。
 *
 * 与 `package.json` 的 `dsh.client.inject`（按包名的模块图依赖边）是**两个不同的轴**：
 *   - 本导出 = cordis 服务名，fiber 等待这些服务就绪后才 apply；
 *   - `dsh.client.inject` = 模块图边 + 入口合成顺序（`dsh-package-manifest/lib/types/types.d.ts:79-80`）。
 *
 * 只要 `slots`：`SlotRegistry` 由 ui-renderer 提供
 * （`…/dsh-client-ui-renderer/lib/types/client/index.d.ts:25-30`
 * 声明 `Context.slots`）。槽位**声明**的先后由 `ctx.slots.inject` 的语义兜住
 * （`…/dsh-client-ui-renderer/lib/types/client/registry.d.ts:96-111`：
 * 声明已存在就立即跑回调，否则挂在声明提交后再跑），所以无需在此等待 layout/sidebar。
 * 先例：`@deepseek-ai/dsh-client-ui-skill-explorer/lib/client.js:1457`、`…/ui-schedule/lib/client.js:6685-6686`。
 */
export const inject = ['slots'];

/**
 * 挂载玄枢的槽位贡献。
 *
 * 两个 `ctx.slots.inject(key, cb)` 都返回幂等 disposer，而该 controller
 * 属于**调用方 fiber**（`registry.d.ts:100-104`），插件卸载时自动回收，
 * 因此这里不额外包一层 `ctx.effect`。
 *
 * @param ctx - 客户端 cordis 根上下文（需已提供 `slots` 服务）。
 */
export function apply(ctx: Context): void {
  // 主面板：keyed 槽按 key 分派；key 必须与侧栏行 id 相同。
  // 依据：`…/dsh-client-ui-layout/lib/types/client/index.d.ts:49-56`（main 是 keyed/root）。
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID }, OverviewPanel),
  );

  // 侧栏全局面板行：list 槽，`id` 即上面的 key，`label` 走 resolveSlotLabel。
  // 依据：`…/dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:46-50, 100-108`；
  //       `…/ui-sidebar/lib/client.js:454-461, 478-481`（id → label → selectPanel(id)）。
  // 先例：`…/ui-schedule/lib/client.js:6804-6810`。
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: PANEL_LABEL },
      OverviewIcon,
    ),
  );
}
