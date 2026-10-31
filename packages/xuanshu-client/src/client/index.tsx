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
 *
 * 票 15 追加（沉淀闭环）：三处**会话内**贡献 —— `conversation.composer.dock`（`[导出汇总]` 入口）、
 * `conversation.chat.turnTail`（草稿卡）、`shell.overlay`（结果通知）。三者共用一份
 * `createSedimentApi` + `createSedimentController`；写谱只在确认弹窗的 `[确认更新]` 之后发生。
 */
import type { Context } from '@deepseek-ai/cordis';
import { createElement as h } from 'react';

import { createBaziApi } from './bazi-api.js';
import { readService } from './ctx-service.js';
import { createBaziUiController } from './bazi-controller.js';
import { createAiApi } from './ai-api.js';
import { createAiReadinessController } from './ai-model.js';
import { createBestofApi } from './bestof-api.js';
import { createBestofController } from './bestof-model.js';
import { installBestOf } from './bestof.js';
import { installCangClient } from './cang.js';
import type { OverviewInjected } from './cards.js';
import { createConsultApi } from './consult-api.js';
import { installConsult } from './consult.js';
import { createDataApi } from './data-api.js';
import { installDataSettings } from './data.js';
import { createDigaoApi } from './digao-api.js';
import { createDigaoUiController } from './digao-controller.js';
import { installDigao } from './digao.js';
import { createHomePathsWatch, primeHomePaths } from './home-paths.js';
import { installMingpan } from './MingpanPanel.js';
import { createMountsApi, createWorkspaceCatalog } from './mounts-api.js';
import { createMountsController, installMounts, MountsSectionFor } from './mounts.js';
import { installOnboarding } from './onboarding.js';
import { installOverviewHashBridge } from './overview-hash.js';
import { OverviewIcon } from './OverviewIcon.js';
import { OverviewPanel } from './OverviewPanel.js';
import { PANEL_ID, PANEL_LABEL, PANEL_ORDER } from './panel.js';
import type { PanelNavTarget } from './panel.js';
import { installPuPanel } from './PuPanel.js';
import { createRikkeApi } from './rikke-api.js';
import { createRikkeUiController } from './rikke-controller.js';
import { installRikke } from './rikke.js';
import { createWanshengApi } from './wansheng-api.js';
import { createWanshengUiController } from './wansheng-controller.js';
import { installWansheng } from './wansheng.js';
import { createNotifyApi } from './notify-api.js';
import { installTouchSettings } from './notify.js';
import { createWorkflowApi } from './workflow/workflow-api.js';
import { installWorkflowPanel } from './workflow/WorkflowPanel.js';
import type { RpcContext } from './rpc.js';
import { createSedimentApi } from './sediment-api.js';
import { createSedimentController } from './sediment-model.js';
import { installSediment } from './sediment-views.js';
import { createShijiApi } from './shiji-api.js';
import { installShiji, installShijiSettings } from './shiji-views.js';
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

  // #29「接上 AI」：**一份**只读控制器，概览（问事入口门禁）与向导第 6 步共用。
  // 它只调 `routes.list`（票 28 那份只读清单）：配好后自己停轮询；窗口聚焦 / 手动重试可再问一次。
  //
  // `onOpenAiSettings` 今天**刻意不给**：DSH 0.2.0-rc.2 没有公开的「打开设置」客户端 API
  // （`openSection` 只经 `settings.onboarding` 的 owner props 下发，`settings.launcher` 是 single 槽
  // 且已被占用；见票 28 侦察 §5.3）。给不出就不渲染按钮，界面显示逐字路径「设置 → 模型」——
  // 绝不做一个点了没反应的按钮（那正是本票要修的 bug）。将来宿主给了公开入口，这里换一行即可。
  const aiReadiness = createAiReadinessController({ api: createAiApi(rpc) });
  const baziDeps = { api: bazi, controller: baziController, navigate, aiStatus: aiReadiness };

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
  const uiWorkspace = readService<{ openSession?(sessionId: string): void }>(rpc, 'uiWorkspace');
  const sessionCatalog = readService<{ refresh?: () => Promise<void> }>(rpc, 'sessions');
  const openSessionFn = uiWorkspace?.openSession;
  const openSession =
    typeof openSessionFn === 'function'
      ? (sessionId: string): void => {
          openSessionFn(sessionId);
        }
      : undefined;
  const refreshSessions =
    typeof sessionCatalog?.refresh === 'function'
      ? async (): Promise<void> => {
          await sessionCatalog.refresh?.();
        }
      : undefined;

  // 票 12：临时挂载。数据面走宿主唯一新增的方法 `consult.setMounts`（含 `preview:true` 的只算不写）；
  // 工作区清单走 DSH **客户端**服务 `ctx.workspaces.list`（只读投影，不新建 / 不改名 / 不删除）。
  const mountsApi = createMountsApi(rpc);
  const workspaceCatalog = createWorkspaceCatalog(ctx);
  const mountsController = createMountsController({
    api: mountsApi,
    workspaces: () => workspaceCatalog.list(),
    workspaceAvailable: workspaceCatalog.available,
  });

  // 票 13：日课与底稿的数据面 + 各自的「人点才跑」控制器（概览的两张卡与两块面板共用同一份；
  // 生成 / 刷新只由按钮的 onClick 触发，apply 期一个请求都不发）。
  const rikke = createRikkeApi(rpc);
  const rikkeController = createRikkeUiController(rikke);
  // #25：晚省的卡与面板共用一份数据面与控制器（生成只由按钮触发；apply 期不发请求）。
  const wansheng = createWanshengApi(rpc);
  const wanshengController = createWanshengUiController(wansheng);
  // #24：触达数据面（账本读面 / 标已读 / 通知摘要开关）。造它不发请求；
  // 只有「打开日课面板」与「人点设置开关」两条人点路径会用到它。
  const notify = createNotifyApi(rpc);
  const digao = createDigaoApi(rpc);
  const digaoController = createDigaoUiController(digao);
  // 票 27（#27）：事记数据面（底稿面板的 [删除] + 会话里的「存成今天的事记」共用一份）。
  // 造它不发请求：两个写动作都只由人点触发，`confirmed: true` 写死在 `shiji-api.ts` 里。
  const shiji = createShijiApi(rpc);

  // 票 16：工作流门厅的数据面（创建 / 列表 / 导出三件事都**只由人点**触发，apply 期不发请求）。
  const workflow = createWorkflowApi(rpc);

  // 票 15：沉淀闭环的数据面 + 跨槽共享控制器（入口条与草稿卡是两棵独立的 React 树）。
  // 这一层也是「人点才跑」的结构保证：造控制器不发任何请求，写谱只在 `commit()` 里发生，
  // 而它只由确认弹窗的 `[确认更新]` 调用（`confirmed` 由数据面写死为 true）。
  const sediment = createSedimentApi(rpc);
  const sedimentController = createSedimentController(sediment);

  // 票 11：多 AI 合参的数据面 + 控制器（浮层与设置行共用一份；`apply` 期一个请求都不发，
  // 「开始合参」是人点出来的唯一入口）。
  const bestof = createBestofApi(rpc);
  const bestofController = createBestofController({ api: bestof });

  // 票 30（#30）：设置 → 我的数据。数据面只做两件事（读体积 / 一键备份），apply 期不发请求；
  // 选目录复用藏库的 `cang.pickDirectory`（同一台机器上唯一一条原生目录选择器路径）。
  const data = createDataApi(rpc);

  // R3（#35）· AC1：用户可见文案里的 home / dataDir **必须**来自宿主回传值。
  // 宿主已把两个真值放在 `data.overview`（唯一一个同时回传 home 与 dataDir 的方法，见
  // `packages/xuanshu-host/lib/data/service.mjs`），所以装配期读**一次**、写进这份订阅式注入面：
  //   - 五个文案点（总览页眉 / 问事历史 / 命盘重录确认 / 沉淀草稿落点 / 沉淀写路径）共用同一份；
  //   - 读不到（RPC 拒绝 / 没连接 / 形状不对）时是一份空快照 → 渲染层回中性占位，绝不猜路径；
  //   - `void`：它不参与 apply 的同步语义，失败也不会把装配拖挂（`resolveHomePathsFromApi` 自己吞错）。
  // 唯一代价：装配后会多一次只读的 `data.overview`（体积统计），换来的是六处文案里的真路径。
  const homePaths = createHomePathsWatch();
  void primeHomePaths(homePaths, data);

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
    // #25：晚省（第 5 张卡）。
    wansheng,
    wanshengController,
    // #29：问事入口的门禁读这一份只读状态（与向导第 6 步同一个控制器）。
    aiStatus: aiReadiness,
    // R3：宿主回传的 home / dataDir（概览页眉「数据都在本地 …」用它，不是占位）。
    homePaths,
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
    // ④b（P2 复核 #24）：点通知 → 壳把 hash 改成 `#xuanshu-overview`；这里在加载与 hashchange
    //    两处认它 → 切回 overview 并清 hash。没有 window 的环境（断言台 / SSR）安全返回 undefined。
    const disposeHash = installOverviewHashBridge(ctx);
    return () => {
      disposeHash?.();
      dispose();
    };
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
  // R3：命盘详情的「重录确认」也显示底座谱路径 —— 与概览同一份注入面（不另读一次）。
  installMingpan(rpc, { ...baziDeps, homePaths });
  // ⑦ 票 10：问事门厅（`consult`，order 30 = S15 给「书房」预约的那一档）。
  //    票 12 的挂载区作为**插槽**进这门厅（S8 §1：门厅的挂载入口开同一个抽屉），
  //    所以门厅那边一行注册都不用改（`mountSlot` 缺席时退回票 10 的占位说明）。
  installConsult(rpc, {
    api: consultApi,
    navigate,
    openSession,
    refreshSessions,
    // R3：历史页错误行那句「数据在本地 <home>/sessions/」读同一份注入面。
    homePaths,
    mountSlot: (session) => h(MountsSectionFor, { controller: mountsController, session }),
  });
  // ⑨ 票 12：挂载账本抽屉（S8）——`shell.overlay` 上的**一个** cell（没有面板、没有侧栏行）。
  //    紧跟在 `installConsult` 之后：它是问事面的伴生抽屉，注册序与 `panel-surface.mjs` 的
  //    `EXTRA_REGISTRATIONS`（after: 'consult'）一致。
  installMounts(rpc, { api: mountsApi, workspaces: () => workspaceCatalog.list(), workspaceAvailable: workspaceCatalog.available });

  // ⑧ 票 13：底稿只读面板（`digao`）与日课面板（`rikke`），各带一条侧栏行。
  // #27：底稿面板多了「曾经做过什么」的事记 [删除]（走 `shiji.remove`，删的是账本那一条），
  // 所以面板也要事记数据面。
  installDigao(rpc, { api: digao, shiji, navigate });
  installRikke(rpc, { api: rikke, navigate, notify });
  // #24：设置里的一行两项开关（AI 建议段 / 通知摘要）。纯加性，不新增面板、不新增侧栏行。
  installTouchSettings(rpc, { rikke, notify });

  // ⑨ 票 16：工作流门厅（`workflow`，order 70）—— 创建工作流 → 会话；导出 skill 的落点表单在这里。
  installWorkflowPanel(rpc, { api: workflow, navigate });

  // ⑩ 票 15：沉淀三处贡献（`conversation.composer.dock` 入口 / `conversation.chat.turnTail` 草稿卡 /
  // `shell.overlay` 通知）。**不新增 main key、不新增侧栏行** —— 沉淀是会话内区块，
  // 只在 DSH 原生 `conversation` 面板在屏时渲染（S10 §1 D5 / F1）。放在最后，纯加性。
  installSediment(rpc, { api: sediment, controller: sedimentController, navigate, homePaths });

  // ⑪ 票 11：多 AI 合参（`shell.overlay` 浮层 + `settings.general.item` 开关行 + `/多模型` 命令
  //    与别名 `/合参` · `bestof` + 会话 composer 旁的触发按钮）。四条注册都是纯加性；
  //    浮层无内容时 `return null`（click-through）。
  //    命令面能给当前 sessionId；**按钮给不了**，所以由回调退到「最近一次问事会话」
  //    （`consult.list` 按 createdAt 倒序，门厅里显示的就是它）。
  //    **注册序**：`panel-surface.mjs` 的 `EXTRA_REGISTRATIONS` 里 sediment 与 bestof 都挂在
  //    `workflow` 那一对之后，靠**数组顺序**分先后 —— 这里谁在后，那边谁就在后。
  installBestOf(ctx, {
    api: bestof,
    controller: bestofController,
    resolveSessionId: async () => {
      try {
        const { items } = await consultApi.list();
        return items[0]?.sessionId;
      } catch {
        return undefined;
      }
    },
  });

  // ⑫ 票 30：设置 → 「我的数据」分区（`settings.section`，纯加性：不新增 main key / 侧栏行）。
  //    体积在分区挂载后读一次；备份只在人点 `[一键备份]` 之后发生。
  //    注册序排在 bestof 之后、票 27 之前 —— `panel-surface.mjs` 的 `EXTRA_REGISTRATIONS` 靠数组顺序分先后。
  installDataSettings(rpc, { api: data });

  // ⑫b（P4 复核 #26）：设置 → 「事记」分区（墓碑恢复 + 可排除目录）。
  //     底稿面板那句「可以在设置里恢复」现在有真实落点；仍是 `settings.section` 的纯加性注册。
  installShijiSettings(rpc, { api: shiji });

  // ⑬ 票 27（#27）：会话内「存成今天的事记」——`conversation.composer.dock` 上的**一个** cell。
  //    只在问事会话里渲染（判据是自铸 id 前缀）；点了并确认之后才调 `shiji.fromSession`。
  //    注册序：`panel-surface.mjs` 的 `EXTRA_REGISTRATIONS` 里它排在 sediment / bestof / 数据 之后
  //    （都挂在 `workflow` 那一对之后，靠数组顺序分先后 —— 这里谁在后，那边谁就在后）。
  installShiji(rpc, { api: shiji, navigate });

  // ⑬ 票 04（#25）：晚省面板（main key `wansheng`，order 110）—— 当天事实 + [立即生成] + 投递历史。
  //    **最后 install**：`tests/assembly/lib/panel-surface.mjs` 的 `PANEL_KEYS` 末尾就是它，
  //    注册序 = 本文件 install 序（顺序不符会被 `expectedRegisterNames()` 抓到）。
  installWansheng(rpc, { api: wansheng, navigate, notify });
}
