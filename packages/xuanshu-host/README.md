# xuanshu-host — 玄枢主机插件（Node 侧）

玄枢（XuanShu）= **DSH profile `xuanshu` + 主机插件 `xuanshu-host` + 客户端插件 `xuanshu-client` + 内置 skills + setup 脚本**，纯装配、零 DSH 源码改动（ADR-0001）。本包是其中的**主机半边**。

## 它在装配里的位置

```
profile/xuanshu (dsh.profile.bundles)
  ├─ @deepseek-ai/dsh-base        ┐
  ├─ @deepseek-ai/dsh-headless    │ 各 bundle 的 cordis.patch.yml 依序叠加
  ├─ xuanshu-host     ← 本包 ─────┤ 本包的 dsh.bundle.patch 插入一行插件：
  └─ xuanshu-client               ┘   { id: xuanshu-host, name: xuanshu-host }
```

- `dsh.bundle.patch` → `cordis.patch.yml`：本包的 bundle 补丁，`insert` 一行 `id/name` 均为 `xuanshu-host` 的插件行（契约 §0/§3）。
- `lib/index.js`：那一行的实现，cordis 插件（`name` / `inject` / `apply`）。`inject` 刻意为空数组——不依赖任何宿主 service，所有 service 都用非严格 `ctx.get(name, false)` 软取，拿不到就降级并在报告 `notes` 里说明。
- 本包**不带** `dsh.client` 声明：浏览器半边属于 `xuanshu-client`。

## 运行时产物

`apply(ctx)` 只做纯本地文件操作 + 本地进程托管（**不调 LLM、不联网**；唯一开端口的地方是 horosa serve，且只绑回环 `127.0.0.1`，见下节。只 import `node:fs`/`node:module`/`node:os`/`node:path`/`node:url` 与本包自己的 `./horosa/service.mjs`）：

1. 建目录 `$DSH_HOME/xuanshu/`（`$DSH_HOME` 缺省 `~/.dsh`；契约 §0 数据目录）；
2. 写出 `$DSH_HOME/xuanshu/assembly-report.json`（schema `xuanshu/assembly-report@1`）——票 01 唯一的运行时可观察证据（seam S2）。写法是同目录临时文件 + `rename` 覆盖，保证读到的一定是完整 JSON；
3. 注册斜杠命令 `/xuanshu-report`：就地重探并重写报告后回报一行摘要（不依赖 LLM 的宿主侧可观察物，契约 §3 第 3 条）。`commands` service 不在场时静默跳过；
4. **票 06**：调 `installHorosa(ctx, config)` 装配 horosa 底座（服务 `xuanshuHorosa` + 命令 `/xuanshu-horosa` + 延后自启的本地 serve），见下节。

### 报告字段

| 字段 | 来源 |
|---|---|
| `schema` | 定值 `xuanshu/assembly-report@1` |
| `generatedAt` | 本次写出时刻（ISO 8601） |
| `ok` | 三项必查全过才 `true`：`profileContext` 可得 ∧ 两个插件包都在 profile 安装点解析到 ∧ 两行 id 都在本进程树中 |
| `profile.name` / `.dir` / `.dshHome` | `ctx.get('profileContext')`（`name`/`dir`/`home`）；不可得时按 `$DSH_HOME` 与契约 §0 推导并记 `notes` |
| `dsh.version` | 运行时解析 `@deepseek-ai/dsh`（退回 `dsh-headless`/`dsh-base`）的 `package.json.version`；都解析不到则留空串 |
| `runtime.node` / `.platform` | `process.version` / `process.platform` |
| `plugins['xuanshu-host']` / `['xuanshu-client']` | **运行时探测**：本包读模块旁的 `package.json`，对端包从 profile 安装点解析 `<包名>/package.json`；解析不到就**不留该键**并记 `notes`（不硬编码版本/路径） |
| `patchRowIds` | `[...ctx.get('loader').entries()]` 取每行 `Entry.options.id`，去重排序 = 本进程可见的补丁行 |
| `notes` | 降级与失败原因的自由文本（不伪造数据的地方都会在这里说清楚） |

`patchRowIds` 取 `Entry.options.id`（补丁行自身 id，与 `dsh --profile xuanshu --dump-config` 打印的 id 同形态），而不是 `Entry.id`——后者在 include 子树里是路径形态（`include:xuanshu-host`）。该数组是**忠实枚举**，会包含 app-boot 合成的根 include 行（`include`）与 group 行；要「只含补丁层行」的消费方自行过滤。

## horosa 底座（票 06）

玄学底座 horosa（上游 skill `0.40.1`）由**本插件托管生命周期**：profile 补丁里那一行静态
`mcp-horosa`（`transport: streamable-http`、`serverName: horosa`、回环 `http://127.0.0.1:8765/mcp`）
只管把工具名 `mcp__horosa__*` 挂进装配树；**进程**由这里的 `installHorosa` 负责起、复用、停。

```
packages/xuanshu-host/lib/horosa/
  constants.mjs  定值唯一来源（端口/路径/工具名/状态 schema；宿主侧不 import 仓库 scripts，见 ADR-0008）
  paths.mjs      resolveHorosaPaths（dshHome/dataDir/runtimeRoot/cacheDir/serve.log/状态文件/setup 报告）+ loopbackHost
  plan.mjs       readSetupReport / resolveHorosaPlan（pin 版本 + wheel + uvx）/ ensureRuntime（runtime 同版本门）
  guard.mjs      MCP 客户端（initialize/tools/list/tools/call，SSE 拿到应答即早停）+ 端口四态守卫
  serve.mjs      startHorosaServe / stopHorosaServe / ownsServe（只停自己起的；日志落 fd）
  bazi.mjs       buildBaziPayload / classifyBaziEnvelope（两个纯函数）
  service.mjs    createHorosaRuntime（状态机）+ installHorosa（装配入口，永不抛）
```

**装配 → 就绪的六步**：解析路径/配置 → plan（pin 版本取 `$DSH_HOME/xuanshu/setup-report.json`）→
`ensureRuntime`（读 `<runtimeRoot>/current/runtime-manifest.json` 的 `runtime_payload_version`，版本不符**不起 serve**）→
端口四态裁决 → `startHorosaServe`（`uvx --from <wheel> horosa-skill serve --host 127.0.0.1 --port <port>`，日志直接落
`<dataDir>/serve.log` 的 fd）→ 就绪判据 = **MCP 握手**（`initialize` 200 且带回响应头 `mcp-session-id`）。
`dispose` 时默认收掉**自己起的**那份（`keepServeOnDispose: true` 可留）。

**端口四态**（与票 04 的 `checkHorosaPort` 逐字同词表，两侧由 parity 测试钉住）。
`startHorosaServe().verdict` = **进门那一刻**的四态裁决（成功新起 → `'free'`，起完之后的状态在
`evidence.verdict='horosa-ready'`；复用 → `'horosa-ready'`；拒绝 → `'occupied-foreign'`/`'probe-failed'`/`'non-loopback-host'`）：

| verdict | 处置 |
|---|---|
| `free` | 没人 LISTEN：起 serve |
| `horosa-ready` | 已有 horosa MCP 在答：**复用**，不新起第二个实例 |
| `occupied-foreign` | 拿到了 HTTP 响应但不像 MCP：**拒绝启动**（绝不 kill 别人的进程） |
| `probe-failed` | 无法判定（慢应答 / 探针自身出错）：**fail-closed 拒绝启动**——「无法判定 ≠ 被占」 |

**非回环不暴露**：`config.host` 不是 `127.0.0.1`/`localhost`/`::1` → `code: 'non-loopback-host'` 拒绝起；
spawn 的 `--host` 恒为 `127.0.0.1`。`:9999`/`:8899` 是用户桌面版星阙的端口，永不触碰。

**服务 `xuanshuHorosa`**（`ctx.provide` 不可得就跳过）：`status()` / `ensure()` / `start()` / `stop()` /
`waitReady(timeoutMs)` / `baziBirth(input)` / `snapshot()`。**命令 `/xuanshu-horosa`**（`ctx.effect` 包裹注册）：
`status`（默认）/ `start` / `stop` / `bazi date=1990-01-01 time=12:00 zone=+08:00 lat=31n14 lon=121e29 [gender=1] [timeAlg=1|3]`。

**状态文件** `<dataDir>/horosa-status.json`（schema `xuanshu/horosa-status@1`，原子写，每次状态变化都重写）：
`{ schema, generatedAt, ok, phase(idle|ensuring|starting|ready|blocked|foreign|stopped), code, detail, hint,
runtime{root,installed,version,expectedVersion}, serve{started,pid,reused,cleanedUp,logFile,readyMs},
endpoint{host,port,url,verdict,sessionId,toolCount},
plan{version,wheel,wheelExists,uvxBin,host,port,source,runtimePayloadVersion},
bazi?{lastPhase,lastTool,lastVersion,pillars} }`。
`plan` 是 additive 顶层块（首次 `ensure()`/`start()` 之后才有值，排障第一眼看它）：
**`plan.wheelExists === false` = wheel 不在盘上** —— 它不是门（测试注入点会给还没落盘的路径），但会让 spawn 失败；
此时 `hint` 与 `detail` 都指向 `pnpm setup:xuanshu`（重新取件 + SHA256 校验），或改用 `config.wheel` / `$XUANSHU_HOROSA_WHEEL`。

**`ok` 的语义**（别读错）：`ok` = 「**这一步没有失败**」，**不是**「serve 正在跑」。
`phase:'stopped'`（正常收工，`detail` 写明已停）/ `idle`（已装配、等自启）/ `ready` 都 `ok:true`；
只有 `blocked`（环境门没过 / spawn 失败 / 超时 / `probe-failed`）、`foreign`（端口被非 horosa 占）
以及带 `code` 的失败（如 `stop()` 被拒 `not-ours`）是 `ok:false`。
**判「底座在不在跑」看 `phase === 'ready'` 与 `serve.started`/`serve.pid`，不看 `ok`。**

**`serve.cleanedUp`**（失败路径的收尾契约）：`true` = 没有「自己起过、还没收掉」的进程
（含「压根没起来」）；`false` = 起 serve 失败后**清理没成功**，`serve.pid` 指向一个仍活着的自己人。
`stop()` / `dispose()` 收尾取 **`serve.pid` ∪ `serve.mjs` 登记表里未收掉的 pid** 的并集，
所以即使状态记漏也会被收掉；没收干净的 pid 会留在状态里、下次 `start`/`stop` 再试（R5：只停自己起的）。

数据目录缺省 `$DSH_HOME/xuanshu/horosa/`。

**config 键**（补丁行的 config，全部可选、全部有缺省；本次 `cordis.patch.yml` 不带 config，缺省即生产形态）：
`enabled(true)` / `autoStart(true)` / `startDelayMs(2000)` / `startupWaitMs(60000)` /
`keepServeOnDispose(false)` / `host('127.0.0.1')` / `runtimeRoot` / `dataDir` / `wheel` / `uvxBin` / `port`。
端口解析链（R10）：**`config.port`（数字或数字字符串都认）> `$XUANSHU_HOROSA_PORT` > `HOROSA_DEFAULT_PORT`**；
`port` 刻意**不进缺省值**，否则会遮住 env 注入点（断言台正是用 env 顶端口起用例的）。
改端口时记得同步改 profile 补丁里那一行的 URL 端口（两处必须一致）。

**出盘口径**（`baziBirth`）：`buildBaziPayload` 只透传出生五字段 +（可选）`timeAlg`，并注入确认闸
（`agent_confirmed_settings: true` + `clarification_notes`）；`timeAlg` 缺省或 `0` → **键省略**（引擎缺省 = 真太阳时），
`1`/`3` 透传，缺经纬度**拒绝出盘**（防静默退化成钟表口径）。`classifyBaziEnvelope` 把信封分成
`ok` / `gate`（`agent_guidance.required`，原文带出 `promptToUser`）/ `error` / `invalid` 四相；
`baziBirth().pillars` 是 4 槽数组 `[年,月,日,时]`（时柱来自上游 `fourColumns.time`）。

**测试注入口**（缺省一律 = 真实路径）：`XUANSHU_UVX_BIN` / `XUANSHU_HOROSA_WHEEL` / `XUANSHU_SETUP_REPORT` /
`XUANSHU_HOROSA_DATA_DIR` / `XUANSHU_HOROSA_AUTOSTART=0` / `HOROSA_RUNTIME_ROOT`。

排障手册见 [`docs/runbook/horosa.md`](../../docs/runbook/horosa.md)；为什么宿主侧自带一份接缝库、以及
「两份四态实现」这笔债，见 [`docs/adr/0008-horosa-static-mount-host-managed-lifecycle.md`](../../docs/adr/0008-horosa-static-mount-host-managed-lifecycle.md)。

## 问事容器（票 10）

问事（consult）与工作区**并列、不属于任何工作区**：会话由 `lib/consult/**` 自己建、自己记账，
DSH 原有的工作区 / `conversation` 面板一字不动。

```
packages/xuanshu-host/lib/consult/
  store.mjs     旁挂清单：<dataDir>/consult/sessions/<sessionId>.json（schema xuanshu/consult@1）+ id 前缀与 slug 归一
  agent.mjs     把会话接上 agent：缺省 preset 组合（mount）+ 模型选择；能力门（缺服务就拒绝发问）
  context.mjs   注入正文的装配（纯函数：底座谱 → 底稿 → 勾选谱 → 挂载；每段带【来源：…】）
  inject.mjs    上下文读取 + 装配的**单一来源**：发问边界与 bestof.run 都从这里取
                （buildInjection 材料 / buildHistory 会话文本历史 —— 后者给合参候选，评审 R5）
  boundary.mjs  **统一发问边界**（ADR-0012）：`ctx.on('agent/pre-step', …)`，每轮第一步把材料并进模型输入
  message.mjs   注入消息载体：source.kind = 'xuanshu-consult'（自定义 MessageSourceMap 合并点）
  turn.mjs      waitForTurnEnd：等一轮结束看 turn/end，不是 whenIdle()
  turns.mjs     轮次账核对：按**会话日志**把 turns / 标题补齐（原生 composer 说的那一句也算）
  history.mjs   会话事件流 → ConsultMessage（只读投影；isSessionNotFound 认上游错误码）
                + buildCandidateHistory（候选的历史窗口：整条裁、只带采用稿、裁剪事实写进文本）
  bestof*.mjs   多 AI 合参（票 11）：run / state / adopt / cancel + 落 <sessionId>.bestof.json
  service.mjs   六个方法：create / send / list / read / rename / defaults（+ setMounts，票 12）
```

**分类载体**（ADR-0009，契约 §1；rc.2 的会话 `meta` 是闭集 7 字段且逐字段挑，额外键**静默丢弃**）：

| 载体 | 定值 | 为什么 |
|---|---|---|
| `sessionId` | `session-xs-consult-<uuid>` | `SessionId` 只是未校验的 branded string，自铸前缀零成本可筛 |
| `cwd` | `<dataDir>/consult`（**全部问事会话共用**） | `cwd` 是唯一受支持的会话过滤（`filterSessions([{kind:'cwd',…}])`）；**刻意不挂 workspace**（那会破坏「与工作区并列」） |
| 旁挂清单 | `<dataDir>/consult/sessions/<sessionId>.json` | 「问过哪些事、这次勾了哪些谱」的权威；列表只读它，不扫会话日志 |
| 注入消息来源 | `source.kind = 'xuanshu-consult'` | 官方允许的 `MessageSourceMap` 合并点。**现在这份材料不写进会话日志**（每轮现算并进模型输入，见 ADR-0012），这个 kind 只标「这条消息是我们加的」 |

**六个方法**（`/xuanshu` 通道，契约 §2 冻结）：

| method | 做什么 |
|---|---|
| `consult.defaults` | `{required:[底座谱,底稿], optional:[可勾选谱]}`；底座走票 08 `bazi.basePu`，底稿探测 `<dataDir>/digao.md`（**不存在就 `present:false`，不造空底稿**），可选谱来自票 09 `pu.list()`（读不出来的谱不进列表） |
| `consult.create` | 铸 id → `mkdir -p <dataDir>/consult` → **`ctx.agents.create(...)`**（组合口径见下）→ 写旁挂清单；**不注入任何东西**（材料由发问边界在每一轮第一步现算，见下）；清单写失败就把刚建的会话 `dispose` 掉（不留「跑得起来但列表里看不见」的会话） |
| `consult.send` | 先过**能力门**（preset / 模型服务缺一个就拒绝，不给假 `accepted`）→ 把轮次账与会话日志核对一次 → `agent.followup(问题)`，**受理即回 `{accepted:true}`**（不等答完）；同会话发问串行（并发两问不许丢 `turns` 更新）；进程重启后会 `agents.resume(...)` 接回来（preset 取会话 header 里存的那个） |
| `consult.list` | 读旁挂目录，`createdAt` 倒序（坏文件跳过，不拖垮整张列表） |
| `consult.read` | 旁挂清单给标题/勾选谱，正文走 **`ctx.sessionQuery.readSession(id)`**（本机是 `session.v4.jsonl.zstd`，**不自己解压**）；刚建好还没落盘的会话 → `messages: []` |
| `consult.rename` | 改名落到旁挂清单（列表与阅读器都读它） |

**会话怎么接上 agent（`agent.mjs`；这条不落对，票 10 第 3 条验收不成立）**：不能只写
`ctx.agents.create({sessionId, meta:{cwd}})` —— 两条实证据：① `dsh-agent-loop/lib/index.js:1185`
在第一轮请求前对缺 provider/model 的 agent 直接抛（裸 create 既没有 `agentOptions`，也没有
`agent/request` waterfall 的来源）；② `standard` preset 声明的工具行（`tool-pwsh`/`tool-fs`/`tool-skill`…）
只在 preset **挂载出来的 scope** 里激活。所以照第一方先例（`dsh-webhook/lib/index.js:154-174`、
`dsh-api-session-controller/lib/index.js:358-371,449-458`）落：`agentPresets.resolve()`（缺省 = registry 的
`default`，web 层 `standard`）→ `meta.agentPreset`（**真语义**；ADR-0009 禁的是拿它当自由标签，
不写它 resume 认不回 preset）→ `agentOptions = ctx.agentDefaultModel.currentSelection()` →
`setup` 里 `agentPresets.mount(agentCtx, id)`。resume 时 preset 优先取会话 header 里存的那个，
名册里没有了才退回缺省。

**能力门（发问前）**：`agentPresets` / `agentDefaultModel` 任缺 → 那种会话**跑不了一轮**，
所以 `consult.send` 当场可读地失败（说清缺哪个服务 + 指一条修复路径），**不许**回一个
`accepted:true` 然后什么都不发生。与票 08「缺经纬度禁止出盘」「确认闸拦下不落盘」同一条纪律。

**材料怎么进模型：`agent/pre-step` 边界（ADR-0012；复核 R2/R3/R4 改定，别再退回「排队 + 一次性」）**：

旧口径是「`consult.create` 灌首轮上下文、`consult.setMounts` 补变更段、`consult.send` 兜底，`agent.inject()`
排进 inbox」。复核实测它**会丢**：`inject()` 只是排进 inbox（还不是 `user/message`），正常 `handle.dispose()`
会追加 `outcome:"canceled"` 把待消费消息撤掉；而原生 composer 那一问又不经过 `consult.send`。
现在只有一条通道 —— `boundary.mjs` 注册 `ctx.on('agent/pre-step', handler, { prepend: true })`
（随包先例 `dsh-time-context/lib/index.js:242-246`；loop 在这一步 `.claim()` 后调同一个 waterfall，
`dsh-agent-loop/lib/index.js:906-918`）：

**交付的落点是会话日志**：loop 会把这一步的消息原样 append 成 `user/message`（`:1061`，首次尝试时）
—— 一次交付即**永久在场**（重启 / dispose / 原生 composer 都读同一份日志），所以**不该每轮重发**。
边界每一问只判断「缺什么」：

| 判据 | 定值 | 为什么 |
|---|---|---|
| 哪一步 | `step === 1` | 一轮只在第一步判断；后面几步是同一轮的工具循环 |
| 有没有用户输入 | `messages.length > 0` 才补 | 收尾步骤塞进一条消息会打破 loop 的 `turnEnds && nextStep.length === 0` 判据 ⇒ **凭空多一次模型调用** |
| 材料 | 日志里已有带 `【来源：底座谱】` 的 `xuanshu-consult` 消息 → 跳过；否则**发一次**（连同当时的挂载全量） | 材料进日志就永久在场；每轮重发只会把同一份大文本反复写进 JSONL |
| 挂载（新增 / 上次没读出来 / 重挂） | 这一层**本次交付凭据**不在日志里 → 补投 | 凭据 = 承载本次交付的那条会话消息 id（条目的 `receipt`；老条目退回 `【来源：挂载 <head>】` 标记）。某一层暂时读不出来时它不记账 ⇒ 下一问自动重试（R4）；改过挂载马上生效（R3）；同一层**重新挂载**时旧标记不能冒充本次回执（复核 32216d9 的 R5） |
| 挂载（撤下） | 账里有、当前清单里没有、且撤下声明**还没在日志里确认** → 说一句「已撤下、不再适用」，条目留着 | 旧正文还在历史里，不声明就会被当成现况；声明落日志**之前**保留重试依据，撤下失败（模型准备阶段抛错）下一问重发（R5）。确认后才清条目 |
| 失败 | 只记日志，原样交出这一步的输入 | 辅助材料不许弄挂别人的一轮问答 |

**合参的候选流**（票 11）不走会话历史，所以 `bestof.run` 自己带两段（都用 `inject.mjs` 的同一份装配）：
**材料**（`buildInjection()`：底座谱 + 底稿 + 勾选谱 + 挂载）与**会话文本历史**
（`buildHistory()` → `buildCandidateHistory()`：窗口复用模型窗口探测，按整条从最新往回裁，
只带被采用的合参稿 —— 复核 R5；**每一轮各带自己那一份**：否决只抹掉**该轮**的采用稿，改了主意
（同轮否决后重新采用）以该轮最后一个决定为准，别轮的照旧算数 —— 复核 32216d9 的 R2/R3）。判官与合并槽**都不带**（H4：判官只看问题与候选）。
候选流不落会话日志，所以它**不去动**「挂载已交付」那本账（那是边界的事）。


**`turns` 是「核对过的」轮数**：它由 `lib/consult/turns.mjs` 在**玄枢接手这个会话的那一刻**与会话日志核对
（`consult.send` / `sediment.draft`）—— 日志里 `source.kind='user'` 的 `user/message` 都算一轮，
包括用户从原生 composer 直接说的那些。边界：一次**纯原生**的会话在玄枢下一次接手之前，旁挂清单里的
`turns` 仍是 0（刻意不用常驻 `session/event` 监听器：那会让每次问事漏一个监听器）。

**内容口径**：底座谱与勾选谱只给 **manifest 概览 + summary + 文件路径**（正文由 AI 用工具按需读，
票面第 3 条「AI 自己完成加载谱资料」）；底稿给**全文**（它本身就是精简汇总这一层）；
底座与底稿是恒定在场项，**不进** `pus`。

**等一轮结束**：`consult.send` 用 `waitForTurnEnd()`（订阅 `session/event` 的 `turn/end`）做**后台记账**
（旁挂清单的 `lastTurnAt`），**不阻塞** RPC；验收禁止用 `whenIdle()` —— 官方注解明说它不标识某条消息的
结束（`dsh-agent/lib/types/runtime-types.d.ts:164`）。

**已知的口径决定（不是缺陷）**：

- **`consult.send` 不传 `requestId`**：契约里有这个可选键（与 DSH `SessionPromptRequest` 同形），
  宿主侧没有「回显 requestId」的落点（响应固定 `{accepted:true}`），接收即忽略；
  客户端要防乐观回显错配，请在客户端侧配对。**未确认**：是否有客户端流程依赖宿主回显。
- **`lastTurnAt` 是「记到的上一轮结束时间」**：同会话两问挨得极近时只有一个 `turn/end` 订阅能命中，
  这个字段可能停在上一轮（它不是轮次账本，轮数看 `turns`）。
- **底稿全文没有长度上限**：契约字面是「全文」，而底稿由票 13 以「精简汇总」口径生成；
  若票 13 的产物可能很大，需要 Lead 裁决是否给注入加长度上限与截断说明。
- **`pus` 只做形状校验**（规范 slug、去重、拒 `_base`），**不**校验谱当前是否存在：
  勾了之后谱被删，注入时那一段会写「读不出来：…」而不是让整个开会话失败（历史要留得住）。
- **读不出来的谱不进 `consult.defaults.optional`**：勾一个坏谱只会注入一段「读不出来」，
  用户修它的地方在 S5 谱管理。
- **模型只按创建/接回那一刻的默认选择**：玄枢没有装 `installModelSelection`（那是 DSH
  session-controller 的会话内换模型面）；会话内换模型的完整语义由 DSH 自己的面板负责。
  **未确认**：consult 会话在 conversation 面板里换模型是否能生效（需要在真机上试一次）。

## 沉淀闭环（票 15）

一次问事结束后，把成果收成「更新到谱」的草稿 —— 但**写入必须由人点**。这是「AI 会动你的东西」
这条产品线上唯一由人端着的闸门（S10 §9 C4 / 铁律 2、5）。

```
packages/xuanshu-host/lib/sediment/
  store.mjs     草稿暂存：<dataDir>/sediment/<draftId>.json（schema xuanshu/sediment@1）+ 形状归一与路径穿越面
  plan.mjs      纯决策：目标谱推断 / 提示装配 / 模型回答解析（无 IO、无 LLM，可单测）
  message.mjs   指令消息载体：source.kind = 'xuanshu-sediment'（与票 10 同一套构造函数与兜底）
  agent.mjs     把**这一场问事会话**接回来（不另开会话；resume 走票 10 的 resumeConsultAgent）
  skill.mjs     内置 skill `xuanshu:sediment`（ctx.skills.register，正文在 sediment.md）
  sediment.md   skill 正文（模型照它吐 JSON；解析侧按同一份校验）
  service.mjs   三个方法：draft / commit / discard
```

**三个方法**（`/xuanshu` 通道，契约 §3 冻结）：

| method | 做什么 |
|---|---|
| `sediment.draft` | 只对**问事会话**成立（`session-xs-consult-` 前缀 + 旁挂清单存在 + `turns ≥ 1`）→ 过能力门（同 `consult.send`）→ 目标谱在生成前定下来（`targetSlug` > 这场问事勾过的第一本现存谱 > 谱列表第一本）→ 把 skill 正文 + 目标谱**当前正文**塞进提示 → 在**这场会话**里 `followup` 并等 `turn/end` → 从会话日志取最后一条助手消息 → 校验成 `{description, body, summary}` → 暂存草稿。**一步都不碰谱** |
| `sediment.commit` | **第一行**检查 `confirmed === true`（不是 truthy）→ 读草稿（不存在 = 可读错误，零写入）→ 读目标谱当前态（拿 `name`/`level`：写回是**更新**）→ **`pu.update`**（票 09 的 staging + rename，本模块没有第二份写盘逻辑）→ 删草稿（同一次沉淀不会被应用第二遍） |
| `sediment.discard` | 删这一份草稿（只删草稿文件；会话与谱不受影响）。草稿不在就说清楚，不静默成功 |

**人工确认闸门**（本票唯一不可让的东西）：

- `confirmed !== true` 一律拒收，**在任何读盘/写盘之前**；负路径断言的是**字节级快照**
  （`tests/sediment/commit.test.mjs`：未确认时谱文件与草稿文件逐字节未变）。
- 界面上不存在 AI 自动写入的入口：客户端 `confirmed` 在数据面里写死为字面量 `true`，
  只有确认弹窗的 `[确认更新]` 会走到 `commit()`（结构断言见
  `tests/assembly/sediment-model.test.mjs` 的「AI 不静默写谱」一组）。
- 写回**只走** `pu.update`；因此「谱怎么原子替换、怎么保留原 `source`、失败怎么回滚」
  仍然只有一个实现（票 09）。

**草稿暂存**：`<dataDir>/sediment/<draftId>.json`，schema `xuanshu/sediment@1`
（`{schema, draftId, sessionId, createdAt, target:{slug,name}, draft:{description,body,summary}}`）。
草稿区**不在 `pus/` 下** —— 草稿落盘不等于「已写入」，所以它不构成对谱的任何改动。

**内置 skill**：`xuanshu:sediment`（注册名 kebab-case；正文标题仍是人读的 `# xuanshu:sediment`，
与票 09 的 `xuanshu-create-pu` 同法）。注册成功与否的判据只能是「`register` 没抛」——
web profile 关掉了宿主层 `skill-filesystem`，`ctx.skills.list()` 不传 `scope` 只看得到 global 层。

**与设计稿的一处偏离（如实登记；Lead 2026-10-15 裁定：可接受）**：S10 §9 C10 设想「草稿落盘由 AI 用工具发起，
因此在会话里出一张 DSH 审批卡」。本实现把草稿写盘放在**宿主**（`sediment.draft` 落 `<dataDir>/sediment/`），
因此**不产生审批卡**。可接受的理由是**保护强度没有降低，只是换了一道更贴形状的闸**：草稿落在
`<dataDir>/sediment/`、**不进任何谱**，所以它根本不是对用户数据的写操作；真正的写操作是 `sediment.commit`，
它前面站着**人点确认**这道闸（`confirmed === true`，第一行拒收）。而人点的谱写入本来就不经 AI 工具
（同一节也这么写）。设计稿里 `~/.dsh/xuanshu/sediment/<会话id>.md` 的文件名是暂定值（实现落在
`<dataDir>/sediment/<draftId>.json`，schema `xuanshu/sediment@1`）。

**S10 §1 ⑤「只导出，不写谱」：现状即满足（Lead 2026-10-15 裁定，不动）**。票 15 的验收把「导出汇总」
映射成「内置 skill 生成草稿」，而 `sediment.draft` **一步不碰谱**（断言钉着「只暂存不改谱：旧文件逐字节相同」）
—— 这就是「只导出，不写谱」。把汇总**导成文件给人拿走**（`exports/`）属于**新功能**：不在本票三条验收里，
且要先改冻结接口面（契约 §3 只冻结三个方法），所以**不补 `sediment.export`**，留作可选后续。

**已知口径（不是缺陷；均经 Lead 2026-10-15 裁定）**：

- **写回不改谱的 `source`**：`pu.update` 的语义是「保留原 `source`」（票 09 的实现），
  所以沉淀不会把它改成谱规范里那个 `sediment` 值 —— **保持**。「这本谱是怎么来的」与
  「它最后一次被什么改过」是两件事，后者靠 `updated_at`；沉淀不该把一本谱的出身改掉。
  （本票不改 `lib/pu/**`，只读 import。）
- **草稿在提交成功后删除**：它已经进了谱，留着只会让同一次沉淀被应用第二遍。
- **目标谱在生成之后被改名/删除** → `sediment.commit` 读不到（按 slug），可读失败且**不新建**谱。
- **提示里带目标谱的当前正文**：草稿是「既有正文之上的更新」（S10 §2 B② 的 diff 预览建立在这个前提上）；
  代价是这一轮的提示会带上那份正文的长度。
- **S10 §2 B⑤ 的持久备份目录（`.bak/`）不做**（Lead 2026-10-15 裁定）：票 09 的写路径已经做了
  「先 rename 到 `.old-<uuid>`、成功后再删」的原子替换与失败回滚，只是**不留常驻备份**；
  玄枢的数据契约是「一个本地目录可整体拷走」，往里塞隐形备份目录反而破坏那条。
  设计稿里那一行本来就标着「(需确认) 目录名由实现票定」。若要常驻备份，属新票。

## 用法与自检

```powershell
# 导入自检（DoD）：导出 apply 函数
node --input-type=module -e "const m = await import('file:///E:/ai_project/XuanShu/packages/xuanshu-host/lib/index.js'); console.log(typeof m.apply, m.name)"
```

真正「装进树里、状态激活、报告写出」的验证由票 01 的**装配契约测试台**负责（`tests/assembly/`，
S1–S5），不放在本包内。本包**不带**自己的验证脚本：一次性的手写探针属于侦察草稿
（`.scratch/**`，gitignore），不进提交物。
