# DSH 槽位映射（票 02 · shared）

> **这是什么**：DSH `dsh-v0.2.0-rc.2` **本机实装**的槽位 / 宿主 API / 前端原语总表，供 S1–S15 各屏第 8 节 `DSH 槽位实现映射` 引用，供实现票（07–16）按槽位落位。
> **这不是什么**：不是视觉规格（色值 / 字号 / 间距见 [`设计token字典.md`](设计token字典.md) 与票 03）；不含代码（不产出 tsx / css）。
> **证据约定**：证据根一律写 `<包名>/<包内路径>:<行号>`，包名相对本机 DSH 实装的 `node_modules/@deepseek-ai/`（安装点见 [`../README.md`](../README.md) §9；仓库根**不装** `@deepseek-ai/*`）。本文件**不写绝对路径**。
> **纪律**：读不到、拿不准的一律标 **「未确认」**；下游实现票按本表落位，编造会造成返工。
> 复核时间：2026-10-11 ｜ 状态：draft（票 02 交付物）

---

## 0. 四条先读的结论（会改变其他屏的写法）

| # | 结论 | 证据 |
|---|---|---|
| **F1** | **`main` keyed 槽的 key ≠ `conversation` 时，那个面板没有任何会话绑定**；`conversation.*` 全部子槽（composer / composer.dock / input.dock / chat.turnTail / view / header…）都只在该子树渲染，非 conversation 面板下**不出现**；`ctx.sidebarRight.mounted` 同时为 `undefined`，右侧栏所有命令「无事可做并大声失败」 | 声明与 keyDomain：`dsh-client-ui-layout/lib/types/client/index.d.ts:49-56`、`dsh-cordis-client-runner/lib/client.js:3906`；`conversation.*` 声明归属：`.../client.js:2751`（dock）、`:3051`（input.dock）、`:2612`（turnTail）、`:3946`（main.conversation）；`ctx.sidebarRight.mounted` 语义：`dsh-client-ui-sidebar-right/lib/types/client/service.d.ts:139-148`、`:212-221` |
| **F2** | **DSH 没有抽屉（drawer）原语**。框架级浮层只有 `shell.overlay`（list/root，**层本身 click-through**，条目需自己恢复 pointer-events）；primitives 里只有**居中对话框** `Modal`。「抽屉」外壳必须自研（`Xs…Drawer`） | `dsh-cordis-client-runner/lib/client.js:4816-4870`（shell.overlay）；`dsh-client-ui-primitives/lib/types/index.d.ts:38`、`.../Modal.d.ts:22-42` |
| **F3** | **`sidebar.panellist` 没有分组 / 分节字段**：侧栏把每个 list 条目读成 `{id, order, label}` 后按 `order` 升序排成一列按钮，没有 group/divider 概念。README §6 的 D1「侧栏分区（家/书房/库/流水线）」在 rc.2 里**只能表现为多行 + label 措辞**，不能表现为视觉分区 | `dsh-client-ui-sidebar/lib/client.js:453-461`；契约 `dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:100-108`（`SidebarPanelMetadata { id; order; label }`，**无 group**） |
| **F4** | **`@deepseek-ai/dsh-client-ui-primitives` 与任何其他 Harness Client 包都不得 `require`**。上游对插件作者的明文规则：不要 require，改为**照抄 markup + CSS + 行为**到自己的插件里，类名改成自己的前缀，**只保留 `--dsw-alias-*` token 引用**（「Tokens then remain the only shared styling dependency」）。理由：会无预警变更、纯 JS 插件无类型检查、组件抛异常会把整个槽位条目变空白。**⇒ 本文件 §5 的原语清单是「形状参照」，不是「可 import 的依赖清单」。** | `dsh-agent-preset/skills/cordis-plugin-development/references/practices.md:35`；同文件 `:34`（样式只走 `--dsw-alias-*`，字面颜色仅限插画，管理列表**参照 Plugin Manager 页**）、`:12`（**先选渲染面再写视图**）、`:33`（不要 iframe 托管页面）、`:36`（不要在自己组件外写 DOM、不要 append 到 `document.body`） |

---

## 1. 注册形状速查

### 1.1 客户端插件最小形状

```text
factory 返回对象 = cordis 插件定义 { apply(ctx), inject? }
apply(ctx) 内：ctx.slots.inject(<槽名>, () => ctx.slots.register(<选项>, <组件>))
```

- `inject` 是 **cordis 服务名**数组（`['slots']`），与 `package.json` 的 `dsh.client.inject`（按包名的**模块图边**）是两个不同的轴 —— 本仓已落地先例：`packages/xuanshu-client/src/client/index.tsx:34`、`packages/xuanshu-client/README.md:150-163`。
- `ctx.slots.inject(key, cb)`：槽声明**已存在**则立即同步跑回调，否则挂在声明提交后再跑；返回幂等 disposer，controller 属于**调用方 fiber**（卸载自动回收）。
  证据：`dsh-client-ui-renderer/lib/types/client/registry.d.ts:96-111`。
- `ctx.slots.register(options, Component)`：**原型方法**（不是实例箭头），cordis service 代理据此把 `this.ctx` 绑到**调用方 fiber**，因此注册随插件卸载析构。证据：`dsh-client-ui-renderer/lib/types/client/registry.d.ts:76-85`。

### 1.2 `main`（kind `keyed` / scope `root`）

```yaml
name: main
key: <面板 key，开放字符串>
priority: <可选，见 1.4>
children: { <子槽名>: { kind, scope } }   # 可选；声明即独占渲染权
locale / store / inject: <可选>
```

| 事实 | 证据 |
|---|---|
| `kind: 'keyed'`、`scope: 'root'` | `dsh-client-ui-layout/lib/types/client/index.d.ts:53-56` |
| key 域开放：`open: any string the owner dispatches (no compile-time key set), already taken: conversation` | `dsh-cordis-client-runner/lib/client.js:3906` |
| 注册选项只有 `key`（required，string）+ 通用优先级 | `dsh-cordis-client-runner/lib/client.js:3889-3894` |
| 已装机占用者：`conversation`（ui-conversation）、`plugins`（ui-plugin-manager，`.../client.js:3656`）、`schedules`（ui-schedule，`.../client.js:6683`） | `dsh-cordis-client-runner/lib/client.js:3910-3914` |
| main 面板收到的标准座位：`usePanelInfo / useSessions / useSessionStatus / useSessionRetainInfo / useWorkspaces / useResource`（**只有 root 座位；无 `useSession` / `sessionId` / `useConversation`**） | `dsh-cordis-client-runner/lib/client.js:3897-3905`；会话座位归属 `dsh-client-ui-session/lib/types/client/index.d.ts:67-92` |
| keyed 的遮蔽单位是 **cell = key**：`keyed — one cell per key` | `dsh-client-ui-slots/lib/types/index.d.ts:822-834` |

### 1.3 `sidebar.panellist`（kind `list` / scope `root`）

```yaml
name: sidebar.panellist
id: <必须与 main 的 key 同字符串>
order: <可选，升序，tie 保注册序>
label: <可选，string | () => string>
```

| 事实 | 证据 |
|---|---|
| **id/key 配对规则**：`Each list id addresses the matching main panel` | `dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:42-50` |
| 元数据形状 `SidebarPanelMetadata { id: MainPanelId; order: number; label: string }`（**注释原文 "List id and matching main panel key"**） | `dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:100-108` |
| 侧栏实现：`entriesOfSlot('sidebar.panellist').map(({options}) => ({id: options.id, order: options.order ?? 0, label: resolveSlotLabel(options.label) ?? id})).sort(升序)`，随后 `selectPanel(id)` → `ctx.layout.selectPanel(id)` | `dsh-client-ui-sidebar/lib/client.js:454-461`、`:478-481`；`dsh-client-ui-layout/lib/types/client/service.d.ts:27-32` |
| 图标座位 props：`{ size: number; active: boolean }` | `dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:93-99` |
| **list 是加性的**：新 id 加在既有条目旁边，复用已装 id 才进那个 cell 并替换它 | `dsh-cordis-client-runner/lib/client.js:5072-5078`、`:5107-5108`（occupants 仅 plugins / schedules） |
| 已装占用者与 order：`plugins` order 0、`schedules` order 10 | `dsh-client-ui-plugin-manager/lib/client.js:3769-3775`；`dsh-client-ui-schedule/lib/client.js:6804-6810` |
| **无分组字段**（见 F3） | `dsh-client-ui-sidebar/lib/client.js:453-461` |

### 1.4 遮蔽（shadowing）与加性规则

| kind | cell 粒度 | 规则 | 证据 |
|---|---|---|---|
| `single` | 槽本身一个 cell | 同 cell 不同 priority 共存，**数值小者渲染**；**同 priority 二次注册直接 throw**（默认 priority 0，即无 priority 的第二个注册必炸） | `dsh-client-ui-slots/lib/types/index.d.ts:577-583`、`:764-778` |
| `keyed` | 每个 `key` 一个 cell | 同上 | 同上；`:822-834` |
| `list` | 每个 `id` 一个 cell | 同上；**不同 id 是加性的**（不遮蔽，都渲染） | 同上 |
| `chain` | 无遮蔽 | 按 `priority` 升序跑 `select(owner)`，第一个非 null 者当选；全 null 落 owner fallback | `dsh-client-ui-slots/lib/types/index.d.ts:246-257`、`:570-576` |

装载期 fail-loud 四连（注册进**未声明**的槽 throw；声明**已声明**的子槽 throw；同一 cell 同 priority throw；keyed 缺 `key` / list 缺 `id` / chain 缺 `select` throw）：`dsh-client-ui-slots/lib/types/index.d.ts:757-791`。

### 1.5 槽的种类与作用域

- `SlotKind = 'single' | 'list' | 'keyed' | 'chain'`；`SlotScope = 'root' | 'session-maybe' | 'session'`。证据：`dsh-client-ui-slots/lib/types/index.d.ts:82-85`。
- 框架座位按 scope 发放：`root` → 全局座位；`session` → 全局 + `SessionStandardProps`；`session-maybe` → 全局 + 可缺席的会话座位。证据：`dsh-client-ui-slots/lib/types/index.d.ts:216-222`、`:426-432`。
- 全部槽由注册**声明**产生，唯一 a-priori 槽是框架播种的 `root`。证据：`dsh-client-ui-slots/lib/types/index.d.ts:697-701`；`dsh-cordis-client-runner/lib/client.js:4300-4302`。

### 1.6 同一插件里注册多个 `main` key —— **机制成立，实装无先例 → 标「未确认」**

- **已证实**：`main` 是 keyed 槽，cell 按 `key` 分；每个 `ctx.slots.register` 调用**独立**，一次 `ctx.slots.inject('main', function*(){ yield register(A); yield register(B); … })` 可以连续注册多个条目 —— 官方 ui-conversation 在**同一个 inject 回调**里连续 `yield` 了 7 次 `register`（1 个 main + 6 个子槽）。证据：`dsh-client-ui-conversation/lib/client.js:18433-18446`。
- **未确认**：rc.2 实装里**没有任何一个包在同一插件内注册两个不同的 `main` key**（全库 `name: "main"` 仅 3 处，见 §1.2 占用者表）。因此「玄枢一个插件里注册 `overview` / `consult` / `pus` / `cang` / `workflow` / `digao` 六个 key」是**机制推断，无同插件先例**。
- **实现票的降险做法**（不改机制、只是组织方式）：每个 key 用**独立的 `ctx.slots.inject('main', …)` 调用**，互不共享 cell；若想让每个面板能声明自己的私有子槽，**必须**在该面板自己的 `register` 里带 `children`（声明即独占，见 §1.4）。

---

## 2. 槽位总表（`root` 级，玄枢可能用到的）

> 「风险」列取自实装目录里同类槽的 `replaceRisk`；`occupants` 为**已装机占用者**，空 = 该槽当前无占用者（**非 single 槽的 `occupants` 只列已装条目，加性槽可继续加**）。

| 槽名 | kind | scope | 用途（原文摘要） | 已装占用者 | 风险 | 证据（`dsh-cordis-client-runner/lib/client.js`） |
|---|---|---|---|---|---|---|
| `root` | single | root | 框架播种的渲染树根洞（**独占即整页替换**） | ui-layout `AppFrame` | shadows-shipped-ui | `:4300-4326` |
| `main` | keyed | root | 按侧栏条目 id 选中的中央面板 | `conversation` / `plugins` / `schedules` | shadows-shipped-ui | `:3883-3918` |
| `sidebar` | single | root | 整个左列（**注册即整列替换**） | ui-sidebar `SidebarRoot` | shadows-shipped-ui | `:4905-4931` |
| `sidebar.panellist` | list | root | 全局面板图标行 | plugins / schedules | none | `:5067-5111` |
| `sidebar.brand.mark` | single | root | 展开态品牌标 / 折叠态轨道标志 | （见 `dsh-client-ui-sidebar/.../slots.d.ts:23-41`） | — | §3.1 |
| `sidebar.brand.name` | single | root | 品牌名文本 | 同上 | — | §3.1 |
| `sidebar.footer.action` | list | root | 设置旁的可选页脚动作 | — | none | `:5021-5066` |
| `sidebar.settings` | single | root | 侧栏底部设置座位 | ui-settings | shadows-shipped-ui | `:5728-5754` |
| `rightbar` | single | root | 右列（一条中间列让出的轨道，或什么都没有） | ui-sidebar-right `RightbarRoot` | shadows-shipped-ui | `:4238-4263` |
| `rightbar.session` | single | **session** | 右列渲染的会话内容 | ui-sidebar-right `RightbarSeat` | shadows-shipped-ui | `:4265-4298` |
| `shell.overlay` | **list** | root | **框架级浮层**（在所有列之上、滚动容器之外；层本身 click-through） | 10 条（toast / dialog / 引导…） | **none** | `:4816-4871` |
| `shell.leading` | single | root | 框架左上角窗口镶边座位（**仅在侧栏整列隐藏时挂载**） | ui-sidebar `HeaderLeadingControls` | shadows-shipped-ui | `:4789-4814` |
| `shell.quota-notice` | chain | root | 框架级配额提示链 | ui-chat（owner fallback） | none | `:4873-4904` |
| `settings.section` | **list** | root | 每个条目 = 一个设置页（`id` 驱动 `only` 过滤，`order` 决定导航位置） | agent-presets / account / general / models / plugins | **none** | `:4710-4760` |
| `settings.general.item` | list | root | 「通用」设置分区内的一行 | ui-theme（外观 / 字号） | none | `:4400-4458` |
| `settings.trigger` / `.launcher` / `.header` / `.close` / `.action` / `.onboarding` / `.plugins.tab` | single/list | root | 设置外壳的其余座位 | 见 `dsh-client-ui-settings/lib/types/client/contract/slots.d.ts:14-125` | — | — |

### 2.1 `shell.overlay` 注册形状（抽屉 / 浮层的唯一框架级落点）

```yaml
name: shell.overlay
id: <自己的 id；新 id 加在既有条目旁，复用已装 id 才替换>
order: <可选，升序>
label: <可选>
```

证据：`dsh-cordis-client-runner/lib/client.js:4821-4840`、`:4856-4869`；声明注释（click-through / 加性）见 `dsh-client-ui-layout/lib/types/client/index.d.ts:75-88`。

---

## 3. conversation 子树槽位总表（`main` key = `conversation` 时才渲染）

> 全部声明归属：`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:119-279`（`SlotMap`）、`:280-327`（`SlotFactoryMap`）；实装目录条目见 `dsh-cordis-client-runner/lib/client.js` 对应行号。
> **作用域列**是硬信息：`session` = 必须有当前会话；`session-maybe` = 无会话也可渲染；`root` = 与会话无关。

| 槽名 | kind | scope | 用途 | 已装占用者 | 风险 | 目录证据 |
|---|---|---|---|---|---|---|
| `main.conversation` | single | session-maybe | 会话外壳（conversation main 面板的直属子槽，**声明归 ui-conversation，且它由 `main` 的 conversation 条目声明**） | ConversationRoot | shadows-shipped-ui | `:3920-3950` |
| `conversation.header` | single | session-maybe | 常驻导航头（无会话时也在） | ConversationHeader | shadows-shipped-ui | `:2758-2790` |
| `conversation.header.leading` | single | **root** | 会话标题前的全局导航（无会话可用） | — | none | `:2791-2817` |
| `conversation.session` | single | session | 严格按会话的会话正文 | ConversationSession | shadows-shipped-ui | `:3426-3460` |
| `conversation.session.header` | single | session | 标题 / 动作 / 视图导航 | ConversationSessionHeader | shadows-shipped-ui | `:3461-3495` |
| `conversation.session.header.actions` | **list** | session | 标题旁动作（升序） | — | none | `:3496-3554` |
| `conversation.session.header.utilities` | **list** | session | 右对齐工具（升序） | — | none | `:3625-3682` |
| `conversation.session.header.corner` | single | session | 头部最右角（有内容才占位） | — | none | `:3555-3589` |
| `conversation.view` | list | session | 注册的 Conversation 目标视图（一次渲染一个） | chat / trajectory 等 | — | `:3722-3775` |
| `conversation.composer` | **chain** | session | 选择器路由的 composer 顶替（审批卡就走这里） | ui-approval 等 | — | `:2623-2670` |
| `conversation.composer.bar` | single | session-maybe | 常驻 composer 本体（含无会话惰性态） | ui-conversation `InputBar` | shadows-shipped-ui | `:2671-2703` |
| **`conversation.composer.dock`** | **list** | session | **composer 卡片下方的环境条目** | ui-chat `StatsPills` | **none** | `:2704-2756` |
| **`conversation.input.dock`** | **list** | session | **composer 卡片上方的全宽条目** | QueueDock / TodoDock / GoalDock | **none** | `:3004-3060` |
| `conversation.input.overlay` | list | session | 常驻 composer 卡片内的浮动条目 | — | none | `:3151-3208` |
| `conversation.input.left` / `.right` | list | session | 工具行左 / 右紧凑控件 | — | none | `:3062-3115`、`:3279-3332` |
| `conversation.input.activity` | single | session | 模型选择器之后的紧凑活动（可横跨工具行） | — | none | `:2932-2966` |
| `conversation.input.attachments` | single | session-maybe | 草稿附件轨 + 拖放目标 | ui-attachment 等 | — | `:2967-3003` |
| `conversation.input.plan` / `.permission` / `.model` | single | session | 工具行里的计划 / 权限 / 模型控件 | ui-plan / ui-permission / ui-model-selection | — | `:3244-3278`、`:3209-3243`、`:3116-3150` |
| `conversation.hero.brand.mark` | single | **root** | 空白会话 hero 的品牌标 | **（空）** | **none** | `:2851-2876` |
| `conversation.hero.workspace` | single | root | 空白会话 hero 的工作区选择器 | ui-workspace `WorkspacePicker` | shadows-shipped-ui | `:2878-2903` |
| `conversation.hero.workspace.directoryFlow` | single | root | 目录选择交互洞 | 两个 directory-picker | shadows-shipped-ui | `:2905-2930` |
| `conversation.hero.agentPreset` | single | session-maybe | 新会话的 agent preset 控件 | ui-agent-preset | shadows-shipped-ui | `:2818-2849` |
| `conversation.chat.node` | keyed | session | 最终 Chat 节点渲染器（按 `ChatNodeKind` 分派） | ui-chat 全套 | — | `:2498-2564` |
| `conversation.chat.commandview` | keyed | session | 命令行的按名渲染器 | — | none | `:2454-2497` |
| **`conversation.chat.turnTail`** | **list** | session | **已完成轮次动作行之前的特性贡献** | deliverables / plan / schedule | **none** | `:2565-2621` |
| `conversation.chat.assistant-actions` | list | session | 已定稿助手消息的动作 | — | none | `:2400-2453` |
| `conversation.message.images` | single | session | 连续消息图片组的渲染器 | ui-attachment | — | `:3333-3371` |
| `conversation.approval.detail` | single | session | 审批请求关联的 Tool call 详情（**可选**） | — | — | `dsh-client-ui-approval/lib/types/client/contract/slots.d.ts:17-24`、`:108-112` |
| `conversation.plan-review.actions` | list | session | 计划评审的动作 | — | — | `dsh-client-ui-user-questions/lib/types/client/contract/slots.d.ts:14-24` |
| `conversation.trajectory.images` | single | session | 轨迹视图图片 | — | — | `dsh-cordis-client-runner/lib/client.js:3683-3721` |

**复用工厂**：`conversation.content`（`SlotFactoryMap`，scope `session-maybe`）是「可被宿主复用的会话内容」，它的子槽白名单 = `conversation.session / conversation.composer / conversation.composer.bar / conversation.input.dock / conversation.hero.brand.mark / conversation.hero.workspace / conversation.hero.agentPreset`。证据：`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:280-327`；实装注册 `.../lib/client.js:18150-18208`。

### 3.1 侧栏品牌槽（`sidebar.brand.*`）

| 槽名 | kind | scope | 用途 | 证据 |
|---|---|---|---|---|
| `sidebar.brand.mark` | single | root | 展开态品牌标 + 折叠态轨道标志（**部署方可只换标不换控件**） | `dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:23-32` |
| `sidebar.brand.name` | single | root | 展开态品牌名文本（外壳提供通用文本 fallback） | `dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:33-41` |
| `sidebar.toggle.badge` | single | root | 折叠态展开按钮内的非交互通知标 | `dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:16-22` |

---

## 4. 右列与设置内页（S7 / S14 / S15 相关）

### 4.1 右列 = 根 `rightbar` + `ctx.sidebarRight` 的 tab 域（**不是** conversation 子槽）

DSH **没有** conversation 作用域的「右栏子槽」；右列是一个**独立的会话作用域 dock 系统**，通过 `ctx.sidebarRight.openTab(kind, {params})` 打开，body 注册进 `sidebar.right.pane.tab`（keyed，**按 tab type 的 `id` 分派**）。

| 项 | 事实 | 证据 |
|---|---|---|
| 座席槽 | `rightbar`（single/root，被 `RightbarRoot` 占）、`rightbar.session`（single/**session**，被 `RightbarSeat` 占） | `dsh-cordis-client-runner/lib/client.js:4238-4263`、`:4265-4298` |
| tab 类型注册 | `SidebarRightTabRegistry.register(SidebarRightTabDefinition)`，`id` 全局唯一，`kind` 可被 `extension` 带覆盖 `builtin`；`priority ∈ 'extension'(默认) | 'builtin' | 'fallback'` | `dsh-client-ui-sidebar-right/lib/types/client/tab-registry.d.ts:74-120`、`:141-164` |
| body / title 注册 | `sidebar.right.pane.tab`、`sidebar.right.pane.tab.title`（都 keyed/session，key = 定义的 `id`） | `dsh-client-ui-sidebar-right/lib/types/client/contract/slots.d.ts:46-72` |
| 打开页 | `ctx.sidebarRight.openTab(kind, { params?, paneId?, preferNewPane?, replaceTab?, revealIfOpened? })`；未注册的 kind **throw**；打开的**同一步**会展开右列 | `dsh-client-ui-sidebar-right/lib/types/client/service.d.ts:131-134`、`:162-168` |
| **限制** | 「公开面上的每个命令都作用于 `mounted` 那个会话；**没有在屏会话**（全局面板占据中列、或没选会话）时**无事可做并大声失败**」 | `dsh-client-ui-sidebar-right/lib/types/client/service.d.ts:1-23`、`:139-148` |

### 4.2 设置内页（S14 / S15）

| 槽名 | kind | scope | 用途 | 证据 |
|---|---|---|---|---|
| `settings.section` | list | root | 一个条目 = 一个设置页；选项 `id`（section key，驱动 `only` 过滤）+ `order`（导航位置）+ `label`；owner 只收到 `{ close }` | `dsh-cordis-client-runner/lib/client.js:4710-4760`；声明 `dsh-client-ui-settings/lib/types/client/contract/slots.d.ts:73-85` |
| `settings.general.item` | list | root | 「通用」分区内一行（ui-theme 的外观 / 字号行就是它） | `dsh-cordis-client-runner/lib/client.js:4400-4458` |
| `settings.plugins.tab` / `.onboarding` / `.action` / `.close` / `.trigger` / `.launcher` / `.header` | list / single | root | 设置外壳其余座位 | `dsh-client-ui-settings/lib/types/client/contract/slots.d.ts:14-125` |

---

## 5. 前端原语的**形状参照**清单（`@deepseek-ai/dsh-client-ui-primitives`）

> ⚠️ **先说结论（F4）**：**不要 `require` 这个包**，也不要 require 任何其他 Harness Client 包。上游规则：照抄 markup + CSS + 行为到自己插件里，类名改成自己的前缀，**只保留 `--dsw-alias-*` token 引用**；「复制哪些控件、保留哪些行为（Modal 焦点与 Escape、`role="switch"` + `aria-checked`、Tooltip 定位）」是该规则明确点名的。证据：`dsh-agent-preset/skills/cordis-plugin-development/references/practices.md:35`。
> **因此本节的作用是**：告诉写稿人与实现票「DSH 已经有一种长这样的控件，玄枢自研时应照它的**形状与行为**对齐」，**不是**「import 这些组件」。
> **样式参照**：管理列表（谱 / 藏 / 底稿 / 定时任务）**照 DSH 的 Plugin Manager 页**（同类型管理列表的官方参照）；token 只取 `--dsw-alias-*`，字面颜色仅限插画。证据：`practices.md:34`。

**基线外部依赖的澄清**：该包确实是 shell 预置 module table 的种子词（技术上 `require` 不会 miss module table，证据 `packages/xuanshu-client/README.md:122-134`）；F4 是**上游的插件作者规则**，不是运行时硬阻断。二者并存 —— 本仓遵守 F4。

### 5.1 已确认导出（真名 + 导出位置；供**照抄形状**时定位）

| 原语 | 是什么（要点） | 证据 |
|---|---|---|
| `Button` | `variant: 'primary'｜'ghost'｜'outline'｜'toolbar'`，`size: 'md'(H36)｜'sm'(H28)`，`icon?` | `dsh-client-ui-primitives/lib/types/index.d.ts:11-12`；`.../lib/types/Button.d.ts:2-18` |
| `Pill` | 胶囊 chip；`active` + `onClick` 时可交互（渲成 button），否则静态 span | `.../lib/types/index.d.ts:13`；`.../lib/types/Pill.d.ts:8-12` |
| `SegmentedTabs` | 受控等宽分段标签（滑动指示条 + 方向键/Home/End） | `.../lib/types/index.d.ts:14-15` |
| `SegmentedControl` | 2+ 等宽分段 + 滑动指示块（互斥模式切换，tablist 语义） | `.../lib/types/index.d.ts:20-21` |
| `Tag` | **只读**徽章；`tone: 'outline'(默认)｜'solid'｜'neutral'｜'quiet'｜'success'｜'info'｜'warning'｜'danger'` | `.../lib/types/index.d.ts:16-17`；`.../lib/types/Tag.d.ts:2-31` |
| `Checkbox` | 带 label 的原生复选框（受控 / 键盘 / 禁用） | `.../lib/types/index.d.ts:22` |
| `Switch` | 双态开关，`label` 必填 | `.../lib/types/index.d.ts:19` |
| `Input` | 单行文本输入（搜索框 / 行内表单） | `.../lib/types/index.d.ts:23` |
| `Menu`, `MenuItemButton`, `MenuSurface`, `MenuGroup`, `observeStickyMenuGroups` | 下拉菜单 / 菜单材质层 / 吸顶分组 | `.../lib/types/index.d.ts:24-28` |
| `Modal` | **居中**、body-portal 的对话框；`open/onClose/title/closeLabel/description/children/footer/contentClassName/headless/backdropBlur`；支持 `data-modal-autofocus` | `.../lib/types/index.d.ts:38`；`.../lib/types/Modal.d.ts:1-42` |
| **`RiskConfirmation`** | **以显式复选框把关的敏感操作确认** | `.../lib/types/index.d.ts:39-40` |
| `DisclosureRow` | **24px 紧凑折叠行**（`open/expandable/onToggle/running/collapsedContent/children`，memo + 浅比较） | `.../lib/types/index.d.ts:7-8`；`.../lib/types/DisclosureRow.d.ts:2-35` |
| `TextShimmer` | 一行文字扫光动画（运行态提示） | `.../lib/types/index.d.ts:9-10`；`.../lib/types/TextShimmer.d.ts:4-21` |
| `StateDot` | 状态点：`done / warning / error / idle / ongoing`（`appearance="step"` 变体） | `.../lib/types/index.d.ts:5-6` |
| `ConnectionIndicator` | 断线 / 重试 / 已恢复的行内连接控件 | `.../lib/types/index.d.ts:41-42` |
| `Tooltip` | 锚定在克隆子元素上的悬停 / 聚焦提示 | `.../lib/types/index.d.ts:54-55` |
| `HoverCard` | 指针可停留的悬停预览（可带复制按钮） | `.../lib/types/index.d.ts:33` |
| `Toast` | 顶部居中瞬时横幅 | `.../lib/types/index.d.ts:57` |
| `PathLabel` | 单行文件路径（目录弱化 / 文件名主色 / 溢出渐隐） | `.../lib/types/index.d.ts:18` |
| `ShortcutKeys` | 快捷键字形（默认为无方块的按键文字） | `.../lib/types/index.d.ts:34` |
| **`DiffBlock`** + `diffTotals` + `DEFAULT_DIFF_MAX_LINES` | 按行比较新旧内容（含增删行 + 3 行上下文 + `⋯` 折叠 + 统计） | `.../lib/types/index.d.ts:78-79` |
| `ReadBlock` / `TerminalBlock` / `SearchBlock` / `WebBlock` | 与工具结果意图对应的输出卡（各带复制 / 溢出 / 折叠几何） | `.../lib/types/index.d.ts:74-83` |
| `JsonTree` / `JsonBlock` | 只读 JSON 查看 | `.../lib/types/index.d.ts:66`、`:86` |
| `CodeBlock` / `MarkdownText` / `MarkdownDelegateProvider` / `extractMarkdownPlainText` | GFM+TeX 渲染 / 代码块 / owner 委托的链接与文件打开 | `.../lib/types/index.d.ts:84-92` |
| `ImageLightbox` / `ImagePreview` | 图片放大浮层与预览 | `.../lib/types/index.d.ts:96-97`；`.../lib/types/ImagePreview.d.ts` |
| `SettingsForm`, `SettingsValueField`, `SettingsSecretField`, `SettingsFormModel`, `settingsTextField`, `settingsNumberField` | 设置页套件 | `.../lib/types/index.d.ts:60-65` |
| `FileTypeIcon`, `classifyFileType`, `fileExtension` | 28px 文件 / 文件夹图形与分类 | `.../lib/types/index.d.ts:51-52` |
| `FishLogo`, `BrandWordmark`, `PermissionIcon*`, `ReferenceIcon*`, `LinkIcon*`, `PluginArtwork*`, `GuideArtwork*` | 品牌 / 权限 / 引用 / 链接 / 插件插画字形 | `.../lib/types/index.d.ts:43-50`、`:94-95` |
| `icons/*` | 图标集合（`export * from './icons/index.tsx'`） | `.../lib/types/index.d.ts:93` |
| 钩子 / 工具 | `useAnchoredPosition`, `useAnchoredMaxHeight`, `useDismissOnOutsidePointer`, `useModalLayer`, `closeTopModal`, `isBehindModal`, `modalSelector`, `focusWithoutRing`, `observeComposition`, `pointerModality`, `writeClipboard`, `fileSizeText`, `relativeTime`, `rankByName`, `isDarwinDesktop`, `projectUserText`, `languageForPath`, `useCodeHighlighter` | `.../lib/types/index.d.ts:29-37`、`:53-73` |

### 5.2 **不存在**的原语（**不要在本稿里当作可用原语点名**）

对全库 `*.d.ts` 检索 `EmptyState|Skeleton|ScrollArea|EmptyPlaceholder` → **零命中**；对 primitives 导出 barrel 逐条核对，**没有**下列组件：

| 期望的组件 | 事实 | 结论 |
|---|---|---|
| 空态组件 `EmptyState` | primitives 无此导出；primitives README 明确「需求确实特殊时，在自己的包里写自己的组件没有问题」 | **自研**（`XsEmptyState`） |
| 骨架屏 `Skeleton` | 无 | **自研**（README §6 D2 的「卡级骨架」只能自研） |
| 滚动区 `ScrollArea` | 无 | **自研**（或原生 `overflow`） |
| 卡片外壳 `Card` | **无**；primitives README 明写「**`DisclosureRow` 与卡片** … 把名称叠在描述之上的卡片是另一种布局，**属于功能包**——ui-settings-plugins 的 `PluginCard` 是先例」 | **自研**（`XsCard` / `XsPanelCard`） |
| 列表 `List` | 无 | **自研** |
| 折叠组件 `FoldToggle` | **是包内组件，未导出**（README 原文：「它是包内组件，未导出；输出卡片用它做头尾折叠」） | 用 `DisclosureRow` 的**形状**或**自研** |

证据：primitives 导出 barrel 全文 `dsh-client-ui-primitives/lib/types/index.d.ts:1-98`；对照说明 `dsh-client-ui-primitives/README.zh.md:76-83`、`:83`。
（`EmptyState|Skeleton|ScrollArea|EmptyPlaceholder` 检索为「无命中」，属**否定证据**：rc.2 的 `@deepseek-ai/**/*.d.ts` 里不存在这些标识符。）

> **给写稿人的一句话**：§5.1 里的名字可以写进组件树的「(需确认)」位，但写的是**形状来源**（例：「确认弹窗（照 `Modal` 形状自研）」），**不是**「用 `Modal` 组件」。两种写法的实现工作量差一倍。

### 5.3 主题 token 体系（票 03 的落点）

- primitives 的样式**只经 `--dsw-*` token**（包描述原文 "Cordis-free React primitives styled only through `--dsw-*` tokens"）：`dsh-client-ui-primitives/lib/types/index.d.ts:1-2`。
- 两层模型：**尺度层** `--dsw-static-*`（如 `--dsw-static-neutral-bluish-400`）/ **语义别名层** `--dsw-alias-*`。证据：`dsh-client-ui-theme/lib/client.js:1148`（static 尺度表）、`:1234-1333`（alias 目录）。
- **第三方可注册 token 覆盖层**：`ctx.theme.register(ThemeDefinition)`（`{ id, colorScheme, tokens }`）与 `ctx.theme.overrideTokens(source, tokens)`（按 source 叠加，`{ light, dark }` **两个模式都必填**，重复调用同一 source 则整层替换）。证据：`dsh-client-ui-theme/lib/types/client/index.d.ts:27-53`、`:153-178`。
- 已确认的 alias 目录（`exportInspectTokens` 的静态表，逐条 `requiresLightAndDark: true`）：`--dsw-alias-bg-base`、`-bg-layer-1`、`-bg-layer-2`、`-bg-overlay`、`-border-l1`、`-border-l2`、`-brand-primary`、`-label-primary`、`-label-secondary`、`-state-error-primary`、`-state-idle-primary`、`-state-success-primary`、`-state-warn-primary`、`--dsw-specific-sidebar-fill`。证据：`dsh-client-ui-theme/lib/client.js:1234-1333`。
- 另在样式串中出现（**已读到，非穷举**）：`--dsw-alias-border-l4`、`--dsw-alias-label-tertiary`、`--dsw-alias-label-caption`、`--dsw-alias-interactive-bg-hover`、`--dsw-alias-bg-module-platform`、`--dsw-radius-xs|md|xl`、`--dsw-elevation-stroke|panel|prominent|soft`、`--dsw-focus-ring-color`、`--dsw-focus-ring-width`、`--dsh-content-font-size`、`--dsh-content-font-size-secondary`。证据：`dsh-client-ui-theme/lib/client.js:26`、`:1013`、`:1148`、`:1163`；README 说明 `dsh-client-ui-theme/README.zh.md:76-88`。
- **未确认**：primitives 各组件内部**完整**消费的 token 名单（未逐文件读 `lib/*.module.css` 全文）。票 03 需要完整清单时，应走 `ctx.theme.exportInspectTokens()`（`dsh-client-ui-theme/lib/types/client/index.d.ts:132-136`）或补读 CSS。

---

## 6. 宿主 / 客户端 API 表（给实现票）

### 6.1 会话

| API | 形状 | 证据 |
|---|---|---|
| `ctx.sessions.create(id?, options?)` （**宿主侧**） | `options = { seed?, inheritedEventCount?, meta? }`；`meta = { cwd?, parentSession?, createdAt?, isSeeded?, origin?, delegationDepth?, agentPreset? }`；id 缺省铸 `session-<n>`；`meta.cwd` 必须**绝对路径**否则 throw | `dsh-session/lib/types/index.d.ts:334-370`；`dsh-session/lib/types/types.d.ts:101-123` |
| `SessionHeader`（不可变存储元数据，`meta` 折叠产物） | `{ version(=4), id, createdAt, cwd?, parentSession?, isSeeded, origin?, delegationDepth?, agentPreset? }` | `dsh-session/lib/types/types.d.ts:54-95` |
| **客户端** SessionManager `.create()` | `create(opts?: { workspaceId?; cwd?; sessionId? }): Promise<SessionId>` —— 先发布目录行再 resolve | `dsh-api-session-controller/lib/types/client/sessions/service.d.ts:172-183` |
| 客户端 `.fork()` | `fork({ sessionId, atSeq?, increaseTitle?, onCreated? }): Promise<SessionId>` | `dsh-api-session-controller/lib/types/client/sessions/service.d.ts:184-202` |
| `ctx.sessions.scope(id)`（客户端） | `scope(id: SessionId): AgentContext \| undefined` —— **借一个已 retain 的 Agent 作用域上下文** | `dsh-api-session-controller/lib/types/client/sessions/service.d.ts:203-208` |
| `ctx.uiWorkspace.startSession(workspaceId?)` | 开新会话（DSH 侧栏「New Session」与 schedule 面板都用它） | `dsh-client-ui-workspace/lib/types/client/navigation.d.ts:44`、`:130`；用法先例 `dsh-client-ui-schedule/lib/client.js:6799-6801` |
| 会话作用域座位（`session` / `session-maybe`） | `sessionId`、`useSession`、`useProjection`（`ui-session` 合并）；`useConversation`/`useInput`/`inputActions`（`ui-conversation` 合并）；`useChat`（`ui-chat` 合并） | `dsh-client-ui-session/lib/types/client/index.d.ts:77-92`；`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:332-347`；`dsh-client-ui-chat/lib/types/client/contract/slots.d.ts:220-228` |
| `ctx.conversation`（`IConversation`） | `send(text)` / `cancel()` / `loadOlder()` / `updateQueue(itemId, action)` / `input` / `blocks`。**作用域寻址**：方法读 `this.ctx` 的 session tag；**根上下文调用会大声失败** | `dsh-client-ui-conversation/lib/types/client/service.d.ts:26-57`、`:169-173` |
| 待处理交互（审批 / 提问） | `registerPendingInteraction<T>(precedence)` → publisher；`SessionPendingInteractionMap` 由 approval / user-questions 各自合并 | `dsh-client-ui-session/lib/types/client/index.d.ts:13-27`、`:66`、`:170` |

### 6.2 `ctx.schedule`（S14）

| 项 | 事实 | 证据 |
|---|---|---|
| 服务 | `ctx.schedule: ScheduleService`（Host 全局持久化提醒，绑定原始会话投递） | `dsh-schedule/lib/types/index.d.ts:12-17` |
| 方法 | `create(sessionId, request, signal?)` / `list({sessionId})` / `catalog()` / `history(request)` / `delete({sessionId,id},signal?)` / `update(request,signal?)` | `dsh-schedule/lib/types/index.d.ts:56-111` |
| 创建请求 | `ScheduleCreateRequest { prompt: string; title: string; after_seconds?; at?; every_seconds?; daily?; weekly?; cron? }` —— **`title` 必填**（≤120 字，非空），缺 / 空 / 超长 → `invalid_prompt` | `dsh-schedule/lib/types/types.d.ts:305-323`；`dsh-schedule/lib/types/index.d.ts:56-68` |
| 规则种类 | `after` / `at` / `every` / **`daily`（显式 IANA 时区的每日墙钟）** / `weekly`（ISO 星期集合 + IANA 时区） / `cron`（五段 Vixie 表达式 + 显式 IANA 时区） | `dsh-schedule/lib/types/types.d.ts:14-99`、`:335-350` |
| 客户端面 | typert 远程 `schedule/catalog|list|create…` + `dsh-client-ui-schedule`；UI 面板 key = **`schedules`**，侧栏行 order 10 | `dsh-schedule/lib/typert.remote-client.d.ts:17-21`；`dsh-client-ui-schedule/lib/client.js:6683`、`:6793-6810` |
| **可用性前置** | **`schedule` 不在 `dsh-base`**：只由可选 bundle `@deepseek-ai/dsh-experimental-schedule-bundle` 声明。玄枢 profile 不加它 ⇒ `ctx.get('schedule') === undefined` 且 **boot 不报错** | `.scratch/assembly-foundation/notes/boot-contract.md` §5.1、§(d) 第 7 条；`dsh-base/cordis.patch.yml` 无 schedule 行 |

### 6.3 `ctx.commands`

| 项 | 事实 | 证据 |
|---|---|---|
| 服务 | `ctx.commands: CommandRuntime` | `dsh-commands/lib/types/index.d.ts:63-67` |
| 注册 | `register(definition): () => void`（返回**精确的**注销 disposer） | `dsh-commands/lib/types/index.d.ts:94` |
| 定义 | `CommandDefinition { definitionId?; name（小写、无前导斜杠）; description; input?; recordInput?; handler(invocation) }` | `dsh-commands/lib/types/index.d.ts:37-55` |
| 调用 | `CommandInvocation { commandId, agent, rawInput, attachments, signal }` | `dsh-commands/lib/types/index.d.ts:18-36` |
| 作用域 | 平上下文注册 = 全局；经 agent 上下文的 command-injected 子上下文注册 = **对该 agent 遮蔽全局** | `dsh-commands/lib/types/index.d.ts:76-79` |
| 先例 | 本仓已有 `/xuanshu-report`（`packages/xuanshu-host/README.md:25`）；DSH 侧栏 `selectPanel` 对 `plugins`/`schedules` 有埋点分支（说明这两个是内置面板 id） | `dsh-client-ui-sidebar/lib/client.js:478-481` |

### 6.4 `ctx.tools`

| 项 | 事实 | 证据 |
|---|---|---|
| 服务 | `ctx.tools: ToolRuntime`（`Service`） | `dsh-tools/lib/types/index.d.ts:33`、`:527` |
| 注册 / 隔离 | `register(definition): () => void` / `restrict(filter): () => void` / `guard(guard): () => void` | `dsh-tools/lib/types/index.d.ts:636`、`:644`、`:655` |
| 读取 | `get(name, scope?)` / `schemas(scope?): ToolSchema[]` | `dsh-tools/lib/types/index.d.ts:690`、`:711` |

### 6.5 `ctx.llm`（多 adapter）

| 项 | 事实 | 证据 |
|---|---|---|
| 服务 | `ctx.llm`：**adapter registry + streaming model-call API** | `dsh-llm/lib/types/index.d.ts:2`、`:233-237` |
| 注册 | `registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle`；任一 provider 已有 adapter → `LlmError` `DUPLICATE_ADAPTER`（**全有或全无**） | `dsh-llm/lib/types/index.d.ts:125-128`、`:246-253` |
| 句柄 | 返回 disposer + **同一 adapter 实例的原子路由替换** | `dsh-llm/lib/types/index.d.ts:190-200` |
| 多 provider 并行 | 官方双适配器：`dsh-llm-deepseek-*`（deepseek-official 系）+ `dsh-llm-pi-ai`（**多 provider 孪生，休眠挂载**：无 profiles 时零路由，settings 里给 `llm-pi-ai:` 段后这些路由 live 注册） | `docs/research/dsh-recon.md` §8；`dsh-base/cordis.patch.yml:120-128`（**由侦察报告转引，本次未复核 patch 行号** → 标「未确认」） |
| 默认模型 | `agent-default-model` 行 `provider: deepseek-official, model: deepseek-flash` | `dsh-base/cordis.patch.yml:80-86`（同上，转引未复核 → 标「未确认」） |
| **对 S9 的含义** | 「多 AI 合参」在**客户端**不能自己挑 provider 发请求；合法路径是**把同一个 prompt 经不同 provider/model 路由各发一次**（宿主侧 agent 配置 / preset），或让宿主工具代发。**未确认**：客户端是否有「指定一次调用的 provider/model」的公开面。 | 见 §8「未确认清单」 |

### 6.6 审批（`ui-approval`）—— 玄枢**不自建**

| 项 | 事实 | 证据 |
|---|---|---|
| 呈现方式 | 审批是 **composer 顶替**：`ApprovalPanel` 注册进 **`conversation.composer`（chain，session）**，`matched` 拿到 `PendingApproval` | `dsh-client-ui-approval/lib/types/client/contract/slots.d.ts:108-111`；`.../client/ApprovalPanel.d.ts:1-8` |
| 决策面 | `ApprovalDecision = 'allowed-once' \| 'rejected'`（**没有「总是允许」**） | `dsh-client-ui-approval/lib/types/client/contract/slots.d.ts:47-48` |
| 关联详情（可选） | `conversation.approval.detail`（single/session），owner 收到 `{ callId }` | `dsh-client-ui-approval/lib/types/client/contract/slots.d.ts:17-30` |
| 悬而未决的交互来源 | 经 `SessionPendingInteractionMap.approval` 合并进 `ctx.uiSession` 的 pending-interaction 通道 | `dsh-client-ui-approval/lib/types/client/contract/slots.d.ts:6-11`；`dsh-client-ui-session/lib/types/client/index.d.ts:13-27` |
| **对 S9/S10/S14 的含义（C10）** | 玄枢**不要**自建审批弹窗、不要提供「总是允许」的私有开关；写操作落进 DSH 审批天然出现「本轮 composer 被审批卡接管」。**注意 F1**：只有 `conversation` 面板在屏时审批卡才可见 —— 若写操作从 `consult` / `pus` 等自有面板发起，用户会**看不到**审批卡（面板不是 conversation）。这是必须在设计里交代的界面事实。 | 上述证据 + §0 F1 |

---

### 6.7 `ctx.uiConversation` —— 会话内**业务节点**（S9 / S10 的正确落法）

上游明文：**新增一行 Chat 内容的做法是**「用 `ctx.uiConversation.events.register()` 注册一个 event definition，再在 `conversation.chat.node` 槽里用该 definition 的 `kind`（即渲染键）注册它的 view；分页、轮次/步骤定位、增量组装由 Conversation 层拥有」。证据：`dsh-agent-preset/skills/cordis-plugin-development/references/practices.md:37`。

| 项 | 事实 | 证据 |
|---|---|---|
| 服务 | `ctx.uiConversation: UiConversation`（`Service`），持有三个注册表：`events` / `views` / `groups` | `dsh-client-ui-conversation/lib/types/client/index.d.ts:36`；`dsh-client-ui-conversation/lib/types/client/conversation/assembly.d.ts:36-45` |
| 事件注册 | `ctx.uiConversation.events.register(definition: ConversationNodeDefinition): () => void`（幂等 disposer）；另有 `registerFallback` | `dsh-client-ui-conversation/lib/types/client/conversation/event-registry.d.ts:4-23` |
| 定义形状 | `ConversationNodeDefinition<State> { kind: string; target?: string; match(event): ConversationMatchResult \| null; start(context, match, reader): State; update(context, match): State; publication?(match); buildLocationData?(…); buildViewNode?(context): ConversationViewNode \| null }` | `dsh-client-ui-conversation/lib/types/client/contract/conversation.d.ts:164-215` |
| 视图注册 | view 进 **`conversation.chat.node`**（keyed/session，key = definition 的 `kind`）：`{ name: 'conversation.chat.node', key: <kind> }` | `dsh-client-ui-chat/lib/types/client/contract/slots.d.ts:229-246`；实装目录 `dsh-cordis-client-runner/lib/client.js:2498-2564` |
| 先例 | `dsh-client-ui-schedule` 就是**同时**走这条路与 turnTail 路：`ctx.uiConversation.events.register(scheduleTurnDefinition)` + `conversation.chat.turnTail` 行 | `dsh-client-ui-schedule/lib/client.js:6811-6824` |

**⇒ S9 / S10 的「会话内区块」两条正统路径**：
1. **业务节点**（内容属于会话历史、需要回放/分页/定位）：`events.register()` + `conversation.chat.node` 的 key；
2. **区块**（内容只是当前态、不需要进会话历史）：`conversation.input.dock` / `conversation.composer.dock` / `conversation.chat.turnTail` 三个 list 槽之一。

选哪条要看「这块内容该不该进会话日志」—— **需要回放的走 1，纯当前态的走 2**（这条判断标准直接来自 `practices.md:7`「会话日志是唯一真相源」与 `:26-27`「用 sessionProjections 而不是订阅 session/event 自己扫」）。

---

## 7. 逐屏落位表（S1–S15）

> 「main key」列 = 该屏建议占用（或复用的）`main` keyed 槽的 key。**票 07–16 若发现不可行，回改本稿而非就地偏离**（README §6）。
> 「主挂载槽」= 组件实际 `ctx.slots.register` 进去的槽名。
> 玄枢尚未定名的 key（`pus` / `cang` / `consult` / `workflow` / `digao`）在本表里是**建议名**，由对应实现票与本稿同步后定稿。

| 屏 | 层级 | main key | 主挂载槽 | 次要挂载槽 | 关键宿主/客户端 API | 备选与风险 |
|---|---|---|---|---|---|---|
| **S1** 自我总览（四卡首屏） | main 面板 | `overview`（已定，`packages/xuanshu-client/src/client/panel.ts:21`） | `main`（keyed/root）key=`overview` | `sidebar.panellist` id=`overview` order=20（已实现）；`conversation.hero.brand.mark`（**空槽，replaceRisk none**）可作品牌标 | `ctx.layout.selectPanel('overview')`（设为默认面板属票 07） | **风险 1**：`main` 是 root scope，无 `useSession`/`useConversation`，四卡只能走全局座位（`useSessions`/`useSessionStatus`）。**风险 2**：无 Skeleton 原语 ⇒ D2 的卡级骨架必须自研 |
| **S1.1** 四卡内部结构 | 面板内区块 | 同 S1 | 同 S1（面板内自研布局） | — | — | 无独立槽；卡片外壳自研（primitives 无 `Card`） |
| **S2** 命盘卡详情（**抽屉**） | 抽屉（overlay） | 不占用 main key（浮在 S1 上） | `shell.overlay`（list/root，additive，**replaceRisk none**） | — | — | **风险（F2）**：DSH 无抽屉原语 ⇒ `XsPuCardDrawer` 自研；`shell.overlay` 层 click-through，抽屉本体需自行恢复 pointer-events。备选：照 `Modal` 的**形状与行为**自研居中对话框（含焦点与 Escape —— 这是 F4 点名必须保留的行为）。**注意**：不得 `require` primitives，只能照抄形状（F4） |
| **S3** 八字冷启动向导（5 步） | 会话内 hero + 面板 | 不新开 key（走 `conversation`） | **`conversation.input.dock`**（list/session，additive，**replaceRisk none**） | 若要品牌感：`conversation.hero.brand.mark`（空槽） | `ctx.sessions.create()`（客户端）或 `ctx.uiWorkspace.startSession()` | **风险 1**：`conversation.hero.workspace` / `agentPreset` 是 **single 且已被占用**（ui-workspace / ui-agent-preset），抢槽必须显式更低 priority（同 priority 直接 throw）。**风险 2**：`conversation.input.dock` 是 session 作用域 ⇒ **必须先有会话**；向导的「首次冷启动」若发生在无会话状态，只能落在 `conversation.hero.brand.mark`（root）或改从 S1 面板发起。**风险 3（F4）**：不能 require 任何 Harness Client 包，向导的分段控件、输入、进度都要自研 |
| **S4** 自我总览 · 首次空态 | 面板状态 | `overview` | 同 S1 | — | — | 空态组件自研（DSH 无 `EmptyState`）；「下一步按钮」照 DSH 主按钮的**形状与行为**自研（F4：不 import） |
| **S5** 谱管理 | main 面板 | **`pus`（建议名，票 09 定）** | `main` key=`pus` | `sidebar.panellist` id=`pus`（D1「库」） | 本地文件（`~/.dsh/xuanshu/`）为主 | **风险（F3）**：D1 的「库」分区只能表现为一条侧栏行，没有视觉分节；若要「谱/藏/底稿」三条行同属一区，只能靠 label 措辞 + 相邻 order。创建谱向导子页**没有**框架级子页槽 ⇒ 面板内自研视图切换（分段标签的形状照 DSH 的分段控件；F4：不 import） |
| **S6** 问事面板（勾选谱 + 会话） | main 面板 | **`consult`（建议名，票 10 定）** | `main` key=`consult` | `sidebar.panellist` id=`consult`（D1「书房」） | 客户端 `ctx.sessions.create({workspaceId?, cwd?})`；**发送**见右栏风险 | **HARD RISK（F1）**：`main.key !== 'conversation'` ⇒ 该面板**没有会话绑定**、`conversation.*` 子槽**不渲染**、`ctx.sidebarRight.mounted === undefined`。后果三条：①**不能**把发送区挂在 `conversation.composer` / `conversation.input.dock`，问事的输入区必须自研；②`ctx.conversation.send()` 在**根上下文会大声失败**（作用域寻址），可行路径是 `ctx.layout.selectPanel(null)` 先回到 conversation 面板再发，或 `ctx.sessions.scope(id)` 借 Agent 作用域后调用（**未确认**：`scope()` 在客户端根上下文的前置条件）；③从问事面板发起的写操作，其**审批卡不可见**（C10） |
| **S7** 问事历史回看（子页） | 面板内子页 | `consult`（同 S6，不新开 key） | 面板内视图切换 | 备选：`sidebar.right.pane.tab`（keyed/**session**）经 `ctx.sidebarRight.openTab(kind,{params})` 开成右列页 | 会话 = 本地 JSONL（`~/.dsh/sessions/<项目>/<会话id>/*.jsonl[.zstd]`） | **风险**：右列页需要「在屏会话」；在 `consult` 面板下 `mounted === undefined` ⇒ `openTab` **大声失败**。结论：S7 走**面板内子页**，不走右列 |
| **S8** 临时挂载账本（**抽屉**） | 抽屉（overlay） | 不占用 main key | `shell.overlay`（list/root） | 若要「发送前预览」联动，见 S9/S10 的会话内槽 | — | **风险（F2）**同 S2；另：抽屉**不能**依赖会话作用域座位（`shell.overlay` 是 root scope）⇒ 账本数据要么放全局 store，要么自行经 `sessionId` 传参 |
| **S9** 多 AI 合参（Best-of-N） | 会话内区块 | 不新开 key（走 `conversation`） | **`conversation.input.dock`**（list/session，全宽、加性、risk none） | **正统路径**：若候选卡需要进会话历史/回放，走 `ctx.uiConversation.events.register()` + **`conversation.chat.node`** 的 key（见 §6.7）；非历史态再用 `conversation.chat.turnTail`（list/session）或 `conversation.composer.dock`（list/session） | 宿主侧多 provider 路由（`ctx.llm.registerAdapter` 是**宿主**面）；客户端**未确认**有「指定单次调用的 provider」的公开面 | **风险 1（F1）**：这些槽都在 conversation 子树 ⇒ 用户切到 `consult`/`pus` 面板时合参候选卡**不可见**。若要求常驻，只能 `shell.overlay` + 自研浮层（root scope，无会话座位）。**风险 2（F4）**：候选卡外壳、采用/合并/否决按钮行、排序理由折叠都要**自研**（无 Card / 无 EmptyState / 不能 require primitives） |
| **S10** 沉淀确认 | 会话内区块 | 不新开 key（走 `conversation`） | **`conversation.chat.turnTail`**（list/session，语义正是「已完成轮次后的特性贡献」，已装先例 deliverables / plan / schedule） | 若沉淀记录需要回放：`ctx.uiConversation.events.register()` + `conversation.chat.node`（§6.7）；`conversation.composer.dock` | 写盘：`~/.dsh/xuanshu/pus/**`；确认走 DSH 审批（C10） | **形状参照（F4，照抄不 import）**：确认闸门照 `RiskConfirmation`（显式复选框把关）；弹窗外壳与焦点/Escape 行为照 `Modal`；diff 预览照 `DiffBlock`（含 `⋯` 折叠与统计）。**风险（F1）**：同 S9 —— 非 conversation 面板下不可见；**从问事面板沉淀时要显式回到 conversation 面板**，否则 C4 的确认弹窗与审批卡都无处呈现 |
| **S11** 藏库 | main 面板 | **`cang`（建议名，票 14 定）** | `main` key=`cang` | `sidebar.panellist` id=`cang`（D1「库」） | 本地指针表 | **风险**：C3「藏永不进 AI」在界面上是**负面事实**（不做 AI 动作），DSH 侧无对应机制，纯自研；顶部常驻声明行自研徽章（形状照 DSH 的只读 Tag，配色走 `--xs-constraint-noai-*`；F4：不 import） |
| **S12** 工作流创建向导 | 会话 + 面板 | **`workflow`（建议名，票 16 定）** | `main` key=`workflow`（面板部分） | `conversation.input.dock`（会话部分）；默认调 `/writing-skills` 经 `ctx.commands` | `ctx.commands.register({ name, description, handler })`（斜杠命令）；skill 走 DSH skill 体系 | **风险**：跨「面板 + 会话」两处 ⇒ 两处都要各自注册，且会话那半受 F1 约束（只有 conversation 面板在屏时可见） |
| **S13** 底稿面板（只读视图） | main 面板 | **`digao`（建议名，票 13 定）** | `main` key=`digao` | `sidebar.panellist` id=`digao`（D1「库」） | 纯派生文件读取 | **风险（F3）**：与 S5/S11 同属「库」，但侧栏无分组 ⇒ 三行并列（order 相邻 + label 措辞）。只读标记自研徽章（形状照 DSH 的只读 Tag，配色走 `--xs-constraint-derived-*`；F4：不 import） |
| **S14** 日课卡详情 + 定时任务管理 | 面板 / **设置内页** | 日课卡详情建议复用/扩展 `overview`（日课卡）或新 key `rikke`；**定时任务建议复用 DSH 既有 `schedules`** | `settings.section`（list/root，**additive，replaceRisk none**）id=`xs-schedules` | `settings.general.item`（list/root） | `ctx.schedule.create(sessionId, {title, prompt, daily\|weekly\|cron\|at\|after_seconds\|every_seconds})` / `list` / `catalog` / `history` / `delete` / `update` | **冲突（需 lead 裁）**：README §6 D1 说「定时任务放设置菜单」，但 **DSH 已自带 `schedules` main 面板 + `sidebar.panellist` 行（order 10）**。二者并存会让用户看到两个定时任务入口。三条路：①复用 DSH 的 `schedules` 面板、D1 改为「不新增入口」；②玄枢的 `settings.section` 页只做**日课**语义、把系统定时任务留给 DSH 面板；③自建 `xs-schedules` 并接受重复。**另**：`ctx.schedule` 只由可选 bundle 声明，未装则整个 S14 的「定时」半边不可用（且 boot 不报错） |
| **S15** 管理入口落位（骨架级） | 骨架级 | 不新开 key | `sidebar.panellist`（list/root，additive） | `sidebar.brand.mark` / `sidebar.brand.name`（品牌）；`settings.section`（系统项） | `ctx.get('profileContext')` 取 profile 目录；数据目录 `~/.dsh/xuanshu/`（C11） | **风险（F3）**：D1 的四个分区在 `sidebar.panellist` 里没有分组字段，只能「按 order 分组 + label 措辞」，或改注册进 `sidebar.workspaces`（那是工作区浏览区，**语义不符**）。**风险 2**：`sidebar` 是 single 槽且被 ui-sidebar 独占 ⇒ **整列替换**会连带销毁它声明的全部子槽（brand/panellist/workspaces/settings/footer），**不要走这条路** |

---

## 8. 待验证 / 风险登记

### 8.1 标为「未确认」的关键条目（下游不要当既成事实用）

| # | 未确认项 | 为什么没确认 | 建议的验证方式 |
|---|---|---|---|
| U1 | **同一插件注册多个 `main` key** | rc.2 全库无同插件多 main key 先例（只有 3 个包各占 1 个 key）；机制上 cell 按 key 分、每次 `register` 独立 ⇒ 推断成立 | 票 07/10 落地前，先用一个最小客户端插件同时注册 2 个 key，在 `dsh web` 里点侧栏两行验证 |
| U2 | **`ctx.sessions.scope(sessionId)` 在客户端根上下文可用**（能否据此在非 conversation 面板里调用 `ctx.conversation.send`） | 只读到签名与「借已 retain 的 Agent 作用域」的描述，未读到 retain 前置条件与根上下文行为 | 票 10 先写一次性探针；退路是 `ctx.layout.selectPanel(null)` 回到 conversation 面板再发 |
| U3 | **客户端是否有「指定单次调用的 provider/model」公开面**（S9 多 AI 合参的核心） | 只读到宿主侧 `ctx.llm.registerAdapter`；客户端「模型选择」UI 包存在（`dsh-client-ui-model-selection`）但未读其契约 | 票 11 读 `dsh-client-ui-model-selection` / `dsh-client-ui-settings-models` 契约，或改由宿主工具代发多次调用 |
| U4 | `dsh-llm-pi-ai` 的「休眠挂载 + settings provider profiles 决定路由」细节 | 转引自 `docs/research/dsh-recon.md` §8，**本次未复核** `dsh-base/cordis.patch.yml` 行号 | 读 `dsh-base/cordis.patch.yml` 与 `dsh-llm-pi-ai/lib/types/catalog.d.ts` |
| U5 | primitives 各组件**完整消费**的 `--dsw-*` token 名单 | 未逐文件读 `dsh-client-ui-primitives/lib/*.module.css` 全文 | 走 `ctx.theme.exportInspectTokens()`，或补读 CSS；属票 03 的输入 |
| U6 | `conversation.hero.brand.mark` 在**展开态**侧栏/非 macOS 平台的可见性 | 目录显示 `occupants: []`、`replaceRisk: none`，但「空槽」≠「一定可见」（hero 只在空白会话态渲染） | 票 07 实测 |
| U7 | `shell.overlay` 上自研抽屉的**层级 / z-index / 焦点陷阱**能否满足「抽屉」要求 | 目录只说明层本身 click-through，没有抽屉语义、没有焦点管理承诺（`useModalLayer` 是给 `Modal` 用的） | 票 07/08 在真浏览器实测 |

> **已结案（曾是本表的最高优先问题）**：`@deepseek-ai/dsh-client-ui-primitives` 能否 import —— **不能**。上游明文禁止 require 任何 Harness Client 包，要求照抄 markup + CSS + 行为、类名改自己前缀、只保留 `--dsw-alias-*` token 引用。见 §0 F4 与 §5 抬头。该结论影响**全部 15 屏**的组件树写法（把「用 X 原语」改为「照 X 形状自研」）。

### 8.2 与侦察报告 / 前人笔记不一致的地方

| 出处 | 原文说 | 我读到的 | 处理 |
|---|---|---|---|
| `docs/research/dsh-recon.md` §2.3 | 会话区子槽见 `dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:120-229` | 同一文件，`SlotMap` 合并区间实为 **`:119-279`**，`SlotFactoryMap`（`conversation.content`）在 **`:280-327`**；槽名清单相同，**只是行号区间偏窄**（漏了 `conversation.input.model` 之后的条目与工厂） | 以本表的槽名清单为准；报告行号不视为错误，只补全 |
| `docs/research/dsh-recon.md` §2.3 / §3.2 | 遮蔽规则「数值小者渲染；同 priority 第二个注册会 throw」，**未区分 list 是加性的** | 一致，且明确：**`list` 槽每个 `id` 一个 cell，不同 id 是加性的**（不遮蔽、都渲染）；`sidebar.panellist` 的 `replaceRisk` 是 `none` | 补充：「加性」是 **list 的 cell 语义**，不是「所有 list 槽都加性」（同 id 仍遮蔽 + 同 priority 仍 throw） |
| `docs/research/dsh-recon.md` §3.1 | 暗示 `conversation.hero.brand.mark` 是「品牌标志」子槽（可被替换） | 目录证据：该槽 `occupants: []`、`replaceRisk: none` —— 它是**空槽**（加性座位），不是「已被官方占用、需要遮蔽」的槽 | 以目录为准 |
| `docs/research/dsh-recon.md` §7 末段 + `packages/xuanshu-client/README.md:122-134` | primitives 是「基线（免声明）」外部依赖（技术事实成立） | **技术事实成立，但上游另有插件作者规则**：不得 require 任何 Harness Client 包，应照抄形状自研（`practices.md:35`）。两者不矛盾：种子词决定「require 不会失败」，实践规则决定「不该 require」 | **本仓遵守实践规则**：§5 降级为「形状参照」；实现票不得 import primitives |
| `.scratch/assembly-foundation/notes/client-plugin-contract.md` §(e) 第 7 条 | 「`references/practices.md:35` 禁止 import `@deepseek-ai/dsh-client-ui-primitives`」并称此点为「已知陷阱」 | **已复核为真**，且是**明文规则**而非陷阱（原文含「Write your own controls and match the host instead … keep only `--dsw-alias-*` token references」） | 升级为 §0 F4（三条先读结论之一）；`practices.md` 同文件另有 `:12`（先选渲染面）、`:33`（不要 iframe）、`:34`（管理列表参照 Plugin Manager）、`:36`（不要写 DOM 到组件外）、`:37`（Chat 行的正统注册法）五条对玄枢直接适用，已分别并入 §5 / §6.7 / §7 |

### 8.3 对实现票的硬提醒

1. **不要注册进 `root`**（会独占领整页，ui-layout 声明的五个子槽全部消失）：`dsh-client-ui-renderer/lib/types/client/registry.d.ts:18-31`（渲染器文档）+ `dsh-client-ui-layout/lib/types/client/index.d.ts:33-48`。
2. **不要注册进 `sidebar`**（同理，整列替换）：`dsh-client-ui-layout/lib/types/client/index.d.ts:34-48`。
3. **不要复用 `conversation` 这个 main key**：`dsh-cordis-client-runner/lib/client.js:3906` 明示它已被占用；本仓 README 也已声明「问事是另开 `consult` key」（`packages/xuanshu-client/README.md:178-181`）。
4. **不要声明已被别人声明的子槽**（声明即独占，二次声明直接 throw）：`dsh-client-ui-slots/lib/types/index.d.ts:757-766`。
5. **`main.key` 与 `sidebar.panellist.id` 必须同字符串**：唯一配对依据，`dsh-client-ui-sidebar/lib/client.js:454-461`。
6. **无 priority 的重复注册会炸**：同 cell 同 priority（默认 0）的第二个注册直接 throw；要共存/顶替必须显式给不同 priority：`dsh-client-ui-slots/lib/types/index.d.ts:769-778`。
7. **不要 import 任何 Harness Client 包**（含 primitives、ui-slots 之外的运行时值）：照抄形状 + CSS + 行为，类名改自己前缀，**只保留 `--dsw-alias-*` token 引用**。证据：`dsh-agent-preset/skills/cordis-plugin-development/references/practices.md:35`、`:34`。
8. **不要在自己组件外写 DOM、不要 append 到 `document.body`**（第三方插件用 MutationObserver 往侧栏塞入口的做法是**反例**，不要学）：`practices.md:36`。
9. **不要用 iframe 托管页面**（拿不到主题 token / light-dark / locale）：`practices.md:33`。
10. **先选渲染面，再写视图**：`practices.md:12`（Principle 6）—— 这条是本表 F1 的上游依据，S6 的问事面板**必须在写线框之前**先确定它落在 `main` 面板还是 conversation 子槽，因为在错误的面上做样式**无法事后救回一致性**。

---

## 附录 A：本表用到的实装文件索引（相对 `node_modules/@deepseek-ai/`）

| 主题 | 文件 |
|---|---|
| 槽核心（kind / scope / 遮蔽 / 注册/注入签名） | `dsh-client-ui-slots/lib/types/index.d.ts`、`dsh-client-ui-renderer/lib/types/client/registry.d.ts` |
| **全库槽目录（机器可读，最省事的复核入口）** | `dsh-cordis-client-runner/lib/client.js:2365-6076`（每个槽一条，字段 `key/kind/scope/doc/registerOptions/ownerProps/standardProps/keyDomain/declaredBy/occupants/replaceRisk/example/source`） |
| 骨架五槽（sidebar/main/rightbar/shell.overlay/shell.leading） | `dsh-client-ui-layout/lib/types/client/index.d.ts:33-107` |
| main 面板选择服务 | `dsh-client-ui-layout/lib/types/client/service.d.ts:14-50` |
| 侧栏槽与面板元数据 | `dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts`；`dsh-client-ui-sidebar/lib/client.js:452-486` |
| 会话子树全部槽 | `dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts`；`dsh-client-ui-conversation/lib/client.js:18143-18458` |
| 右列 / tab 域 | `dsh-client-ui-sidebar-right/lib/types/client/{contract/slots,service,tab-registry}.d.ts` |
| 设置内页 | `dsh-client-ui-settings/lib/types/client/contract/slots.d.ts` |
| 审批（C10） | `dsh-client-ui-approval/lib/types/client/contract/slots.d.ts` |
| 前端原语 | `dsh-client-ui-primitives/lib/types/index.d.ts` + `dsh-client-ui-primitives/README.zh.md` |
| 主题 token | `dsh-client-ui-theme/lib/types/client/index.d.ts`；`dsh-client-ui-theme/lib/client.js:1148-1163, 1234-1333` |
| 会话（宿主 + 客户端） | `dsh-session/lib/types/{index,types}.d.ts`；`dsh-api-session-controller/lib/types/client/sessions/service.d.ts` |
| schedule | `dsh-schedule/lib/types/{index,types}.d.ts` |
| commands | `dsh-commands/lib/types/index.d.ts` |
| tools | `dsh-tools/lib/types/index.d.ts` |
| llm | `dsh-llm/lib/types/index.d.ts` |
