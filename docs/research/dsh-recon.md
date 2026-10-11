# DSH（DeepSeek Harness）技术侦察报告

> 侦察对象：`C:\Users\Administrator\.dsh\profiles\desktop\`（DSH "desktop" profile 目录，即本次侦察的 checkout）。
> 方式：全程只读（read/glob/grep + 只读 PowerShell 目录列举），未修改任何文件，未运行构建/安装。
> 路径约定：本报告中 `node_modules/...` 均相对于上述 checkout 根目录。
> 侦察时间：2026-10（会话快照）。全部结论均附 `file:line` 证据。

---

## 0. 侦察对象的重要事实（先读）

**这个 checkout 不是源码 monorepo，而是一个已装配好的 DSH profile 目录**（`package.json` 名为 `dsh-profile-desktop`，无 version 字段）。DSH 本体以 npm 发布包形式安装在 `node_modules/@deepseek-ai/dsh-*`（约 290 个包）。官方源码仓库地址见各包 manifest：`git+https://github.com/deepseek-ai/deepseek-harness.git`（例如 `node_modules/@deepseek-ai/dsh/package.json:8-12` 标注该包对应仓库内 `apps/cli`）。

这本身就是玄枢想要的分发形态的**活样例**：一个 profile 目录 = `package.json`（声明 bundles）+ `cordis.yml` + `cordis.patch.yml` + `pnpm-workspace.yaml` + `pnpm-lock.yaml` + `node_modules`，其中混装官方包与第三方插件包（dsh-mcp-connector、dshmarket、@xmanrui/dsh-im、@linxin666/dsh-client-ui-skill-explorer、本地 `dsh-infinite-gen-4`）。

---

## 1. 版本

| 项 | 值 | 证据 |
|---|---|---|
| DSH 全系官方包版本 | **0.2.0-rc.2** | `node_modules/@deepseek-ai/dsh/package.json:4`；profile 根 `package.json:5-34` 中全部 `@deepseek-ai/dsh-*` 依赖同为 `0.2.0-rc.2` |
| 官方仓库 | github.com/deepseek-ai/deepseek-harness | `node_modules/@deepseek-ai/dsh/package.json:8-12` |
| 核心插件框架 cordis | `~4.0.4`（@deepseek-ai/cordis，Koishi cordis 的定制 fork） | `node_modules/@deepseek-ai/dsh/package.json:31` |
| 第三方插件 | dsh-mcp-connector **0.2.68**、dshmarket **1.66.9**、@xmanrui/dsh-im **4.36.1**、@linxin666/dsh-client-ui-skill-explorer **0.4.2** | profile 根 `package.json:36-40` 及各包 `package.json` |
| 前端工具链 | vite ^6、react ^18.2、typescript ^6、@vitejs/plugin-react ^4、vitest ^4 | `node_modules/@deepseek-ai/dsh-web-frontend/package.json:25-39` |

其它版本标记：会话格式有独立版本目录 `dsh-session-format` / `dsh-session-format-v0-to-v4`；`package.json.dsh.manifestVersion: 1`（`node_modules/@deepseek-ai/dsh-package-manifest/lib/types/types.d.ts:29-30`）。

---

## 2. 插件 / 扩展机制

### 2.1 插件模型 = cordis + 补丁层（patch layers）

- 运行时树是一张 cordis 插件表（root config 为空列表 `[]`），由**多层 patch 依序叠加**而成：各 bundle 的 `cordis.patch.yml`（按 `package.json.dsh.profile.bundles` 顺序）→ profile 自己的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml`（机器级）→ `--patch` 覆盖层 → 遥测开关。
  证据：`node_modules/@deepseek-ai/dsh/lib/profile-boot-BZ2ZjNWi.js:74-78`、`193-215`；profile 根 `cordis.yml:1-4`（文件本身就是注释说明补丁组成方式）。
- 每行是一个插件实例：`id`（目标标识）、`name`（npm 包名）、`config`（schemastery/zod 校验）、`disabled`（支持 `!!js` 表达式）、`insert`（批量插入）。补丁按 id 整行覆盖，后写胜出。
  证据：`node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:1-14`（注释明言 "the last write winning per row"）。
- 发现/加载：profile 启动时 `loadProfile` 解析 profile 目录，`createRuntimeResolution` 建模块解析，`PluginPackages` 把补丁行里的包名挂进 cordis loader。**插件的"发现"= 它作为一行出现在补丁里 + 它安装在 profile 的 node_modules 中**。
  证据：`profile-boot-BZ2ZjNWi.js:205-215`、`271-276`；`node_modules/@deepseek-ai/dsh-base/cordis.patch.yml` 全文。

### 2.2 包清单格式（manifest）

`package.json` 的 `dsh` 字段（`node_modules/@deepseek-ai/dsh-package-manifest/lib/types/types.d.ts`）：

- `dsh.manifestVersion: 1`（:29-30）
- `dsh.bundle.patch: string | string[]` —— bundle 的补丁文件路径（相对包根）（:66-69）
- `dsh.profile.bundles: string[]` —— profile 声明 bundle 组合（:71-74）
- `dsh.client: { platform: 'web'; inject?: string[]; immediately?: boolean; external?: string[] }` —— 客户端（浏览器）插件声明（:76-89）
- 另有 `engines.dsh` 兼容范围（:55-64）、`icon`（:14-15）。

第三方插件实样：`@linxin666/dsh-client-ui-skill-explorer/package.json` 的 `dsh` 字段（bundle.patch + client.inject/platform）。

### 2.3 插件能注册什么（注册面清单）

| 注册面 | 机制 | 证据 |
|---|---|---|
| **侧边栏入口 + 顶层页面/路由** | 布局声明 `sidebar`（单槽，被 ui-sidebar 占用）与 `main`（**keyed 槽**："Central panel selected by sidebar entry id"）；`sidebar.panellist`（list 槽）每行 id 对应一个 main 面板 key | `node_modules/@deepseek-ai/dsh-client-ui-layout/lib/types/client/index.d.ts:44-56`；`dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:43-50` |
| 会话区/面板内部位置 | 数十个具名槽（header、composer、hero、右栏等），见 `dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:120-229` | 同左 |
| 悬浮层/窗口装饰 | `shell.overlay`（list）、`shell.leading`（single） | `dsh-client-ui-layout/.../index.d.ts:85-106` |
| **斜杠/命令** | `ctx.commands.register({ name, handler, ... })`，命令按 agent 作用域列出/执行，经 typert 远程面暴露给 Web | `node_modules/@deepseek-ai/dsh-commands/lib/types/index.d.ts:64-65`、`:94`、`lib/typert.remote-client.d.ts:15-16` |
| **Skill** | `dsh-skill`："Agent skill provider registry"；第三方 skill-explorer 显示来源分为 bundled/project/user/custom/runtime | `dsh-skill/package.json` description；skill-explorer `package.json` description |
| **MCP 连接器/工具** | `dsh-mcp-client` 桥接插件：每个实例连一个 MCP server，工具注册到 `ctx.tools`，公开名 `mcp__<serverName>__<rawName>`（见第 6 节） | `node_modules/@deepseek-ai/dsh-mcp-client/lib/types/index.d.ts:1-13` |
| 主机工具 | `ctx.tools` 注册（所有 tool-* 包） | `node_modules/@deepseek-ai/dsh-tools` 等 |
| 服务/类型化扩展 | cordis `ctx.provide/ctx.get/ctx.inject`；typert 注册表做跨进程类型化 RPC（`ctx.typert.lookups.register`），api-controller、schedule、commands、llm 均经 typert 暴露给客户端 | `dsh-session/lib/types/index.js:770-780`；各包 `typert.host.d.ts` / `typert.remote-client.d.ts` |
| 前端 UI 槽（通用） | Slot 注册表：`SlotMap` 经 TS declaration merging 扩展；槽种 `single/list/keyed/chain`，作用域 `root/session-maybe/session`；同格可注册多个条目按 priority 遮蔽（数值小者渲染；同 priority 第二个注册会 throw） | `node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:16-18`、`82-85`、`757-776` |

### 2.4 结论：插件能否新增顶层入口与自己的页面？

**能。** 机制为"双注册"：

1. 向 `main`（keyed 槽）注册一个自己的 key + 组件（该 key 获得独立面板，`conversation` 是保留 key 且获得会话绑定，其它 key 无会话绑定）；
2. 向 `sidebar.panellist`（list 槽）注册同 id 行（图标 + 标签），侧边栏自动按 id 选中对应 main 面板。
   `MainPanelId` 是开放的 branded string（`dsh-client-ui-layout/lib/types/client/service.d.ts:15`）。清单即插件包 + `dsh.client` 声明 + bundle patch 行，无需改 DSH 源码。

---

## 3. 首页 / 落地屏

### 3.1 实现在哪

- Web 应用 shell 库为 `@deepseek-ai/dsh-client-web`（构建期依赖，未随 profile 安装；`dsh-web-frontend/package.json:49`）。
- 布局包 `dsh-client-ui-layout` 的 `AppFrame` 组件注册进 **内置 `root` 槽**（"the runtime's built-in 'root' slot... declares the five child slots"），从而获得 `sidebar/main/rightbar/shell.overlay/shell.leading` 五子槽的独占声明权：`node_modules/@deepseek-ai/dsh-client-ui-layout/lib/types/client/index.d.ts:1-9`、`33-107`。
- `main` 的 `conversation` key 由会话包注册：`dsh-client-ui-conversation/lib/types/client/skeleton/ConversationPanel.d.ts:8`（`ConversationPanel` 注册进 `main` 并声明 `main.conversation`）。
- **首页/落地屏 = 空白会话的 Hero**（`EmptyHero`/`HeroShell`，居中标题 + 品牌 + 工作区选择 + 输入区）：`dsh-client-ui-conversation/lib/types/client/skeleton/EmptyHero.d.ts:31-44`；标题文案 `hero.headline` 等见 `dsh-client-ui-conversation/lib/types/client/locales.d.ts:71-73`。
- Hero 可扩展子槽：`conversation.hero.workspace`（工作区选择器）、`conversation.hero.brand.mark`（品牌标志）、`conversation.hero.agentPreset`：`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:195-212`。

### 3.2 固定路由还是槽位？如何替换？

**槽位，不是固定路由。** `root` 是唯一 a-priori 槽（由框架在构造时播种），其余全部由注册声明（`dsh-client-ui-slots/lib/types/index.d.ts:697-701`）。替换首页有三条不 fork 的路径：

1. **顶替主面板**：向 `main` 的 `conversation` key 用更低 priority 再注册一个条目（keyed 槽遮蔽规则，`dsh-client-ui-slots/lib/types/index.d.ts:769-775`）——整页替换；或注册全新 main key + 侧边栏行并把它设为默认面板（第 2.4 节）。
2. **替换会话体**：向 `conversation.session` 或 `main.conversation`（single 槽）以更低 priority 注册——替换正文但保留外壳；空白态即首页。
3. **整列导航替换**：`sidebar` 槽被 ui-sidebar 占用，"registering here replaces the navigation column outright"（`dsh-client-ui-layout/.../index.d.ts:35-48`）——可重做整个左栏。
4. 仅品牌定制：Hero 与侧边栏的品牌槽（`conversation.hero.brand.mark`、`sidebar.brand.mark`/`sidebar.brand.name`，`dsh-client-ui-sidebar/.../slots.d.ts:24-41`）——部署方可直接换标。

注意：single/keyed 槽"同 priority 双注册即报错"，顶替必须显式用不同 priority；list 槽（如 `sidebar.panellist`）则是**加性**的。无需配置槽即可换首页，也无需改源码——纯插件装配即可。

---

## 4. 会话（工作区 → 项目 → 会话）

### 4.1 模型

- 会话 = **事件溯源（event-sourced）存储**（`dsh-session` 包描述 "Event-sourced session store"）。核心服务 `ctx.sessions`（SessionStore），`create(id?, { seed, meta })` 创建并进入存储；`meta.cwd` 写入不可变 `SessionHeader`（id/version/createdAt 由 store 填充）；id 缺省铸造为 `session-<n>`；支持 `seed` 事件回放/fork 与 `prepare/enter/announce` 三阶段事务（供 agent-loop 使用）。
  证据：`node_modules/@deepseek-ai/dsh-session/lib/types/index.js:770-881`（尤 :783-834）。
- 工作区：`dsh-workspace` = "Workspace entity registry (ctx.workspaceRegistry): durable workspace records with validated session attachment over the domain data form"——工作区是 storage-domain 中的持久记录，持有 sessionIds 列表；会话通过 header 的 cwd 与工作区关联（"rememberSessionPath" 把 canonical cwd 登记进投影索引）。
  证据：`dsh-workspace/package.json` description；`dsh-workspace/lib/types/entity.d.ts:26-52`。
- 关系归纳：**工作区（Workspace，持久记录 + session 列表）→ 项目（cwd 目录，物理分组键）→ 会话（Session，事件日志）**。

### 4.2 存储位置与格式

- 根目录：`~/.dsh/sessions`（或 `$DSH_HOME/sessions`；`DSH_HOME` 可覆盖，默认 `~/.dsh`）。配置来源是 dsh-base 补丁行 `session-persistence-jsonl` 的 `root: !!js dshHomePath('sessions')`：`node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:130-133`；路径助手：`node_modules/@deepseek-ai/dsh-home-paths/lib/index.js:10-15`、`49-51`、`73-76`。
- 目录布局：`root/<项目目录名>/<session-id>/`，项目目录名由 cwd 派生（无 cwd 用 `_no-cwd`）：`dsh-session-persistence-jsonl/lib/index.js:867-932`。
- 文件格式：**JSONL 事件日志**，每会话一个目录下的不可变 generation 文件，`.jsonl` 或 `.jsonl.zstd`（默认 zstd 压缩；第一帧仅 header 行，可独立解码）：`dsh-session-persistence-jsonl/lib/index.js:740-748`、`2274`、`2285`、`2292-2295`。惰性物化：创建后首次 append/flush 才落盘（:2366-2371）。
- 其它：全文本搜索可选用 node:sqlite（Web 默认 `:memory:` + `openAt: never`）：`dsh-base/cordis.patch.yml:149-153`；图片等附件存独立后端（content-addressed，:135-139）。

### 4.3 程序化创建 API

- 主机侧：`ctx.sessions.create(id?, { seed, meta })`（插件内可用），见 4.1。
- Web/客户端侧：`dsh-api-session-controller` 提供 SessionManager（`client/sessions/manager.d.ts`、`session.d.ts`），经 API 网关的 `/api/remote.mux` 复用流与主机通信（`dsh-api-gateway/lib/index.js:12`；`lib/client.js:106`），属 RPC 而非开放 REST。

---

## 5. schedule（定时/调度）

- 主机级服务 `ctx.schedule`（ScheduleService）：**host 全局的持久化提醒任务**，绑定"原始会话"投递（"Host-wide durable reminders with shared management and original-Session delivery"，`dsh-schedule/package.json` description）。API：`create(sessionId, request)` / `list` / `catalog` / `history` / `delete` / `update`；任务类型：`after / at / every / daily / weekly / cron`。
  证据：`node_modules/@deepseek-ai/dsh-schedule/lib/types/index.d.ts:12-68`、`39-133`；类型 `lib/types/types.d.ts:9-93`。
- 持久化：经 storage-domain 表 + 事件折叠（`schedule/change` 事件进会话日志）：`dsh-schedule/lib/types/storage.d.ts:32-40`、`types.d.ts:299-302`。
- 插件注册定时任务的两条路径：
  1. **产品级**：调用 `ctx.schedule.create(sessionId, {...})`（如 `@after 30m` 风格提醒），或经 `registerScheduleTools` 给 agent 装上四个调度工具（`dsh-schedule/lib/types/tools.d.ts:8-14`）；
  2. **机制级**：通用定时器 `@deepseek-ai/cordis-plugin-timer`（base 补丁恒开：`dsh-base/cordis.patch.yml:24-25`），提供 cordis 的 `ctx.setInterval/setTimeout` 语义。
- 客户端面：typert 远程操作 `schedule/catalog|list|create...`（`dsh-schedule/lib/typert.remote-client.d.ts:17-21`）+ `dsh-client-ui-schedule` UI；`dsh-experimental-schedule-bundle` 是可选 bundle（`node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:552-557` OPTIONAL_BUNDLES）。

---

## 6. MCP 连接器

### 6.1 内核桥接（官方）

`@deepseek-ai/dsh-mcp-client`：namespace 插件，**一个实例 = 一个 MCP server**（stdio 子进程 或 streamable-http），工具注册到 `ctx.tools`，公开名 `mcp__<serverName>__<rawName>`；"load multiple instances in cordis.yml for multiple servers"。
证据：`node_modules/@deepseek-ai/dsh-mcp-client/lib/types/index.d.ts:1-13`、`26-76`。

### 6.2 连接器市场（第三方 dsh-mcp-connector 0.2.68，本 profile 已装）

- 连接配置存 **DSH storage-domain**（表：connections / grants / catalog / snapshots / governance / connection_scopes / tool_catalog）：`node_modules/dsh-mcp-connector/lib/stores.js:17-25`；物理后端为 storage-json，根 `~/.dsh/storages`（`dsh-base/cordis.patch.yml:168-171`）。凭据（API key/OAuth grant）仅存本机 domain，作用域文档只存连接 key + workspaceId + revision。
- **作用域**：`global`（当前 profile 内所有 Workspace 可见）与 `project`（绑定稳定 workspaceId，经 `tools.restrict()`/`tools.guard()` 隔离）：`node_modules/dsh-mcp-connector/docs/CONNECTION-SCOPES.md`（第 1、3 节）。
- **目录/预置机制**：目录 = 内置目录（包内 `catalog/catalog.json`）+ 远程 registry（默认 jsDelivr 上的社区 registry）+ **`config.connectors` 注入** + 本地上下架覆盖，优先级"本地覆盖 > config.connectors > 远程 registry > 内置"：`node_modules/dsh-mcp-connector/lib/catalog.js:1-4`；插件的 bundle patch 即注入点（`dsh-mcp-connector/cordis.patch.yml:1-9`，含 `catalogUrl` 配置）。连接器描述格式见 `registry/schema/connector.schema.json` 与 `registry/connectors/*.json`（auth/servers/prompts，禁止含密钥，`registry/README.md`）。
- **治理**：Connection/Server/Tool 三层 allow/deny（`docs/TOOL-GOVERNANCE.md`；对应本会话工具 `mcp_connector_policy`）。

### 6.3 "默认自带、不可删除"的 MCP 连接 —— 可行，两条路

1. **推荐（纯配置、零代码）**：在 profile 的 `cordis.patch.yml` 中直接插入 `@deepseek-ai/dsh-mcp-client` 行（含 serverName/command 或 url）。该连接成为运行时树的一部分，随 profile 启动即连、即注册工具；它**不在**连接器市场的 storage-domain 记录里，市场 UI 的"断开/删除"根本碰不到它（市场对 stdio 主机注册的工具仅显示为 `managed` 状态，见 `dsh-mcp-connector/lib/index.js:3021-3077`、`2412-2427`）。
2. 市场侧兜底：用 `config.connectors` 注入目录项 + governance 层 deny 删除，或用 `mcp_connector_publish` 控制目录可见性。

---

## 7. Web 前端栈

- 仓库内 `apps/web` = npm 包 **@deepseek-ai/dsh-web-frontend**（"Web application entry: vite build over the @deepseek-ai/dsh-client-web shell library; dist/ served by apps/cli's dsh web"）：`node_modules/@deepseek-ai/dsh-web-frontend/package.json:1-4`、`8-12`。
- 技术栈：**Vite ^6 + React ^18.2 + TypeScript ^6 + @vitejs/plugin-react ^4 + vitest ^4（+ playwright/http-server/fflate）**：`dsh-web-frontend/package.json:25-39`。构建产物 `dist/` 随包发布（:14-23）。
- 服务端：`dsh web`（apps/cli）经 `dsh-host-webserver`（HTTP，含认证 URL）+ `dsh-host-frontend-static` 提供静态资源；`dsh-web-app` 插件解析 dist 的 index.html 并挂载（`node_modules/@deepseek-ai/dsh-web-app/lib/index.js:107-115`、`172-177`）。shell 不是独立应用：只有 dsh 进程注入 `window.__DSH_BOOT__`（`dsh-web-app/lib/index.js:91-93`）。
- **shell 与插件/后端集成（关键机制 `dsh-client-modules`）**：
  - Node 侧扫描 loader 中声明 `dsh.client` 的包，按模块图排序合成 `window.__DSH_BOOT__` 入口图，向 webserver 注入注册门面/preload/bootstrap 脚本 + 组合脚本与 sourcemap，并提供 `ctx.clientModules` 服务（`node_modules/@deepseek-ai/dsh-client-modules/lib/types/index.d.ts:1-34`、`48-70`、`97-102`）。
  - 浏览器侧在 cordis 之前由 shell kernel 先建模块系统，客户端插件以 `ctx.modules` 注册，经 `ClientEntries.sync(graph)` 与主机图对账热更新（`dsh-client-modules/lib/types/client/index.d.ts:1-20`、`entries.d.ts:47-66`）。
  - 因此**第三方客户端插件在 npm 包里自带预编译客户端产物**（如 skill-explorer 的 `lib/client.js`、dsh-im 的 `src/`），安装后无需重建 shell 即可进入页面（开发期 HMR 才需要 `pnpm run dev:web` 重建，`dsh-web-app/lib/index.js:91-93`）。
- 浏览器 UI 组合：所有面板/侧栏/会话 UI 都是 `dsh-client-ui-*` 包经第 2.3 节的 SlotMap 注册而来（browser roster 见 `node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml:237-428` 的 `dsh.client` 行清单）。

---

## 8. LLM provider 配置

- 抽象服务 `ctx.llm`："adapter registry + streaming model-call API"；插件用 `ctx.llm.registerAdapter(providerRoutes[], adapter)` 注册 provider 路由（同 provider 重复注册即抛 `DUPLICATE_ADAPTER`）：`node_modules/@deepseek-ai/dsh-llm/lib/types/index.js:210-288`、`lib/index.js:1829-1858`。
- 默认模型：`agent-default-model` 行 `provider: deepseek-official, model: deepseek-flash`（`dsh-base/cordis.patch.yml:80-86`）。
- **多 provider/多模型并行：支持。** 官方双适配器：`dsh-llm-deepseek-*`（deepseek-official 系）+ `dsh-llm-pi-ai`（"multi-provider twin, mounted dormant：zero routes until a `llm-pi-ai:` settings section supplies provider profiles — then those routes register live, keys resolving per request through their apiKeyEnv references"）：`dsh-base/cordis.patch.yml:120-128`。即：设置文档中的 provider profiles 决定哪些路由生效，可同时多路。模型选择 UI：`dsh-client-ui-settings-models` / `dsh-client-ui-model-selection`。
- API key 存放：分层凭据源——环境变量 → 受管 `$DSH_HOME/.credentials.yaml` → 项目/用户 `.env` 兜底；Models 页只写受管文档，永不物化进进程环境（`dsh-base/cordis.patch.yml:105-110`；`dsh-credentials-local/lib/index.js:13-58`、`49`）。provider 通过 `apiKeyEnv` 引用凭据（`dsh-llm-pi-ai/lib/types/catalog.d.ts`）。
- 配置持久化：设置经 `config-editor/settings` 服务落进**当前 profile 的补丁层**（"Live Config forms persist through the active profile patch"，`dsh-base/cordis.patch.yml:94-99`）；旧 `settings.yaml` 已被迁移进 active profile（`dsh-settings/lib/index.js:343-348`）。

---

## 9. profile 机制

- 目录：`~/.dsh/profiles/<name>/`（`PROFILES_DIR`，`dsh-app-boot/lib/index.js:4137` 导出；`resolveProfileDir`）。自带模板：**acp / web / headless / sdk / sdk-minimal**（`dsh-app-boot/lib/index.js:529-535`）；无模板名时默认 `["@deepseek-ai/dsh-base"]`（:543）。本 checkout 就是 `profiles/desktop`。
- 结构（由 initProfile 生成 + 本目录实证）：
  - `package.json`：dependencies + `dsh.profile.bundles`（bundle 层清单，`desktop/package.json:42-57`）；
  - `cordis.yml`：空 root 配置（每次启动被重写，`profile-boot-BZ2ZjNWi.js:121-125`、`185-191`）；
  - `cordis.patch.yml`：用户补丁层；
  - `pnpm-workspace.yaml`（hoisted）+ `pnpm-lock.yaml` + `node_modules/`；
  - 启动：`loadProfile` → 补丁栈（bundles → profile patch → home patch → overlays）→ `PluginPackages` 按 profile 安装解析模块并挂载（`profile-boot-BZ2ZjNWi.js:185-296`）；`profileContext` 提供 name/dir/patchPath 等（:259-270）。
- **能否作为分发包？能。** profile 就是一个普通 pnpm workspace 目录：把 profile 目录放进 git 仓库、克隆到 `~/.dsh/profiles/<name>`、`pnpm install` 即可（没有任何代码禁止 profile 目录来自 git；bundle 依赖按版本或 `file:` 路径锁定，如 desktop 的 `dsh-infinite-gen-4: file:../../plugins/...`，`desktop/package.json:38`）。插件管理器的安装源支持 **registry / path / git / tarball**（`dsh-plugin-manager/lib/types/types.d.ts:136`），git 源带 GitHub 预检（`lib/types/github-connection.d.ts:12-20`）。分发的推荐形态 = **一个 profile 仓库（package.json + lockfile + cordis.patch.yml + 自有 bundle/插件包）**；玄枢的 "profile + 插件装配（不 fork）" 路线与官方机制完全吻合，desktop profile 本身就是官方 + 三方插件混装的实证。

---

## 10. 对玄枢架构的结论（含最关键 5 条）

1. **不 fork 完全成立**：DSH 的扩展面是"patch 补丁行 + cordis 插件包"，profile 的 `cordis.patch.yml` 与 `dsh.profile.bundles` 即可增删一切（第 2、9 节）。
2. **插件可新增顶层入口与自有页面**：`main`（keyed）+ `sidebar.panellist`（list）双注册即可；`MainPanelId` 开放（第 2.4 节）。
3. **首页可被插件替换，无需改源码**：Hero 是空白会话态；可通过 main key 遮蔽、`conversation.session`/`main.conversation` 顶替或整栏替换三条路径；品牌有专用槽（第 3 节）。
4. **"默认自带、不可删除"的 MCP 连接可行**：在 profile 补丁中静态挂 `dsh-mcp-client` 行（配置即代码，市场删除 UI 管不到）；市场侧另有 `config.connectors` 注入 + 三层治理（第 6.3 节）。
5. **profile 即分发包**：目录 + lockfile + 补丁即完整装配；git 仓库分发可行；`$DSH_HOME/cordis.patch.yml` 提供机器级覆盖层，适合"同一 profile、不同机器差异化"（第 9 节）。

其它要点：会话为事件溯源 JSONL（`~/.dsh/sessions/<项目>/<会话id>/*.jsonl[.zstd]`），主机侧 `ctx.sessions.create()` 可程序化建会话；schedule 经 `ctx.schedule.create(sessionId, ...)` 或 cordis 定时器注册；LLM 多 provider 由 adapter 注册 + settings provider-profiles 支持，密钥统一走 `~/.dsh/.credentials.yaml`；Web 栈 = Vite 6 + React 18 shell + `window.__DSH_BOOT__` 模块图，第三方客户端插件自带预编译产物、免重建。

### 风险/注意

- DSH 目前是 **0.2.0-rc.2**（rc 版），API 稳定性与向后兼容无承诺；补丁行 id/服务名属于内部接口。
- 遮蔽槽位需要显式 priority，同 priority 会 fail-loud；升级 DSH 版本时补丁行 id 可能漂移（`dsh-package-manifest` 的 `engines.dsh` 兼容范围声明可用于约束）。
- 客户端插件虽然免重建，但其客户端 bundle 是包作者预编译的，深度定制 Web UI 仍可能需要自己的构建管线。

---

## 附录：关键文件索引（相对 checkout 根）

| 主题 | 文件 |
|---|---|
| profile 装配 | `package.json`、`cordis.yml`、`pnpm-workspace.yaml`；`node_modules/@deepseek-ai/dsh/lib/profile-boot-BZ2ZjNWi.js` |
| 核心补丁层 | `node_modules/@deepseek-ai/dsh-base/cordis.patch.yml`（530 行，宿主树）、`node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml`（浏览器 roster） |
| 清单类型 | `node_modules/@deepseek-ai/dsh-package-manifest/lib/types/types.d.ts` |
| 插件管理 | `node_modules/@deepseek-ai/dsh-plugin-manifest/lib/types/*.d.ts`；`dsh-plugin-manager/lib/types/{types,install-spec,github-connection}.d.ts` |
| UI 槽核心 | `node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts` |
| 布局/顶层入口 | `node_modules/@deepseek-ai/dsh-client-ui-layout/lib/types/client/index.d.ts` |
| 侧边栏 | `node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts` |
| 首页 Hero | `node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/types/client/skeleton/EmptyHero.d.ts`、`contract/slots.d.ts:195-212` |
| 会话 | `node_modules/@deepseek-ai/dsh-session/lib/types/index.js:770-881`；`dsh-session-persistence-jsonl/lib/index.js:740-932,2274-2396` |
| 工作区 | `node_modules/@deepseek-ai/dsh-workspace/lib/types/entity.d.ts` |
| schedule | `node_modules/@deepseek-ai/dsh-schedule/lib/types/index.d.ts` |
| MCP | `node_modules/@deepseek-ai/dsh-mcp-client/lib/types/index.d.ts`；`node_modules/dsh-mcp-connector/{cordis.patch.yml,lib/catalog.js,lib/stores.js,docs/CONNECTION-SCOPES.md,registry/}` |
| LLM | `node_modules/@deepseek-ai/dsh-llm/lib/types/index.js:210-288`；`dsh-credentials-local/lib/index.js:13-58` |
| 前端 | `node_modules/@deepseek-ai/dsh-web-frontend/package.json`；`dsh-client-modules/lib/types/{index,client/index}.d.ts` |
| 路径 | `node_modules/@deepseek-ai/dsh-home-paths/lib/index.js:10-15,49-76` |
