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
 * **总装配**（票 09 谱 / 票 14 藏 / 票 08 八字）：本入口是唯一一处「组装」的地方，
 * 两个面板各自的 `installPuPanel` / `installCangClient` 与票 08 的
 * `installOnboarding` / `installMingpan` 在此被调用——它们各自的实现与断言台早已落地，
 * 缺的只是这一步。宿主侧对应的一半在 `packages/xuanshu-host/lib/index.js` 的
 * `installRpc`（同一通道 `/xuanshu`，方法名 `pu.*` / `cang.*` / `bazi.*`）。
 *
 * 不注册进 `root` 槽（那是 single 槽，会单独占满整页）、不声明 `children`
 * （槽位声明排他，`main.conversation` 已由 ui-conversation 声明）、
 * 不加 priority（`overview` / `pus` / `cang` / `onboarding` / `mingpan` 都是新 cell，
 * 纯加性、不遮蔽任何既有占用者）。
 */
import type { Context } from '@deepseek-ai/cordis';

import { createBaziApi } from './bazi-api.js';
import { createBaziUiController } from './bazi-controller.js';
import { createBestofApi } from './bestof-api.js';
import { createBestofController } from './bestof-model.js';
import { installBestOf } from './bestof.js';
import { installCangClient } from './cang.js';
import type { OverviewInjected } from './cards.js';
import { createConsultApi } from './consult-api.js';
import { installConsult } from './consult.js';
import { createDigaoApi } from './digao-api.js';
import { createDigaoUiController } from './digao-controller.js';
import { installDigao } from './digao.js';
import { installMingpan } from './MingpanPanel.js';
import { installOnboarding } from './onboarding.js';
import { OverviewIcon } from './OverviewIcon.js';
import { OverviewPanel } from './OverviewPanel.js';
import { PANEL_ID, PANEL_LABEL, PANEL_ORDER } from './panel.js';
import type { PanelNavTarget } from './panel.js';
import { installPuPanel } from './PuPanel.js';
import { createRikkeApi } from './rikke-api.js';
import { createRikkeUiController } from './rikke-controller.js';
import { installRikke } from './rikke.js';
import type { RpcContext } from './rpc.js';
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
 *     （`dsh-client-ui-theme/lib/client.js:1582`）——token 覆盖层要用；
 *   - `connection`：dsh-client-connection 的 `ctx.provide("connection", handle)`
 *     （`dsh-client-connection/lib/client.js:1477`）——谱 / 藏面板的 RPC 要用。
 *     它进 inject 而不是在调用处软取，是因为「没有连接的谱 / 藏面板」不显示任何真东西，
 *     等它就绪再注册比注册一个永久报错的空壳更诚实（与票 07 四卡的 fail-soft 是两回事：
 *     那是**卡级**降级，这里是**面板级**前置）。
 *
 * 槽位**声明**的先后由 `ctx.slots.inject` 的语义兜住
 * （`registry.d.ts:96-111`：声明已存在就立即跑回调，否则挂在声明提交后再跑），
 * 所以无需在此等待 sidebar。
 */
export const inject = ['slots', 'layout', 'theme', 'connection'];

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

  // 票 08：命盘数据面与跨面板控制器（概览 / 向导 / 详情三块共用同一份，
  // 出盘成功后的「重取快照」与重录预填都靠它广播）。
  const rpc = ctx as Context & RpcContext;
  const bazi = createBaziApi(rpc);
  const baziController = createBaziUiController();
  const baziDeps = { api: bazi, controller: baziController, navigate };

  // 票 10：问事门厅的数据面 + 「进入正式对话」的导航面。
  // `openSession` 只**导航**（`dsh-api-facts.md` §6.2：它不创建）；拿不到 `uiWorkspace` 时给
  // `undefined`，门厅照实说明并给可读失败（fail-soft，不假装切过去了）。
  //
  // **先刷目录、再导航**：`openSession(id)` 内部直接 `retain(id)` 且没有 try/catch
  // （`dsh-client-ui-workspace/lib/client.js:821-823,973`），而 `retain` 对不在客户端会话目录里的
  // id 同步抛 `unknown session`（`dsh-api-session-controller/.../sessions/manager.js:63-71`）；
  // 宿主建的会话只靠 `api-session/added` 推送进目录，推送与 RPC 回包的到达顺序**未被证明有序**。
  // `ISessions.refresh()` 幂等、单飞，拉一次 `session.list`（含未落盘的活会话）。
  // 客户端 `ctx.sessions` 是 `ISessions`，与宿主 `SessionStore` **同名不同物**（facts §6.3）——
  // 类型桩里还没有这一面，故在此就地收窄一个最小形状（不动 `types/shims.d.ts`，那是作用域外）。
  const consultApi = createConsultApi(rpc);
  const uiWorkspace = ctx.uiWorkspace;
  const sessionCatalog = (ctx as unknown as { sessions?: { refresh?: () => Promise<void> } }).sessions;
  const openSession =
    typeof uiWorkspace?.openSession === 'function'
      ? (sessionId: string): void => {
          uiWorkspace.openSession(sessionId);
        }
      : undefined;
  const refreshSessions =
    typeof sessionCatalog?.refresh === 'function'
      ? async (): Promise<void> => {
          await sessionCatalog.refresh?.();
        }
      : undefined;

  // 票 13：日课与底稿的数据面 + 各自的「人点才跑」控制器（概览的两张卡与两块面板共用同一份；
  // 生成 / 刷新只由按钮的 onClick 触发，apply 期一个请求都不发）。
  const rikke = createRikkeApi(rpc);
  const rikkeController = createRikkeUiController(rikke);
  const digao = createDigaoApi(rpc);
  const digaoController = createDigaoUiController(digao);

  // 票 11：多 AI 合参的数据面 + 控制器（浮层与设置行共用一份；`apply` 期一个请求都不发，
  // 「开始合参」是人点出来的唯一入口）。
  const bestof = createBestofApi(rpc);
  const bestofController = createBestofController({ api: bestof });

  const injected = (): OverviewInjected => ({
    navigate,
    mainPanels,
    // 票 08：冷启动向导与命盘详情都是**已装配**的面板（本文件下面就注册它们），
    // 所以这两个回调从此不再是「未接线」——命盘卡的两个出口因此可用。
    onStartOnboarding: () => { navigate('onboarding'); },
    onOpenDetail: () => { navigate('mingpan'); },
    // 卡级重试：让控制器代次 +1，概览的 `useBaziStatus` 据此重取快照（不重新出盘）。
    onRetry: () => { baziController.invalidate(); },
    bazi,
    baziController,
    // 票 13：三份数据面与两个控制器都从注入面进概览；`onGenerate` / `onRefresh`
    // **不在这里给**——概览面板自己用控制器造（保证「人点才跑」只有一条路径）。
    rikke,
    rikkeController,
    digao,
    digaoController,
  });

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

  // ⑥ 总装配：谱（票 09）与藏（票 14）各自的面板 / 侧栏行 / 浮层；
  // ⑦ 票 08：八字冷启动向导（`onboarding`）与命盘详情（`mingpan`）；
  // ⑧ 票 10：问事门厅（`consult`）。
  // 全部都是**纯加性**注册（新 key / 新 id），各自带自己的样式与 RPC 客户端；
  // 放在 overview 之后，保证「第一个 main 注册仍是 overview」与默认面板语义不变。
  // 顺序有意义：`verify-assembly` / `overview-contract` 都按注册序断言
  // `overview` 在最前、且 `selectPanel` 只在 overview 注册后发生一次。
  installPuPanel(rpc);
  installCangClient(rpc);
  installOnboarding(rpc, baziDeps);
  installMingpan(rpc, baziDeps);
  // ⑦ 票 10：问事门厅（`consult`，order 30 = S15 给「书房」预约的那一档）。
  installConsult(rpc, { api: consultApi, navigate, openSession, refreshSessions });

  // ⑧ 票 13：底稿只读面板（`digao`）与日课面板（`rikke`），各带一条侧栏行。
  installDigao(rpc, { api: digao, navigate });
  installRikke(rpc, { api: rikke, navigate });

  // ⑨ 票 11：多 AI 合参（`shell.overlay` 浮层 + `settings.general.item` 开关行 + `/多模型` 命令
  //    与别名 `/合参` · `bestof`）。三条注册都是纯加性；浮层无内容时 `return null`（click-through）。
  installBestOf(ctx, { api: bestof, controller: bestofController });
}
