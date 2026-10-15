# Spec 001 开发进度

核对日期：2026-10-15。集成分支：`codex/spec-001-integration`（**已推 origin**）。

GitHub issue/PR 的 open 状态不等于未实现，反之亦然：票 01–06 的代码在本地提交并由 stacked PR 承载（#2/#3/#4/#6/#7/#9 已**全部关闭且未合并**，其改动**全部已包含在集成分支**里、由 PR #20 覆盖取代）；票 07–16 已实现，其 issue 已在 GitHub 上关闭（#11–#19；票 04/06/07 的 #5/#8/#10 于 2026-10-15 晚补关闭，见 §10）。

## 票 → issue 对照

| 票 | issue | 状态 |
|---|---|---|
| 01 空壳立起 | —（PR #2） | 完成 |
| 02 UI 设计稿 | —（PR #3） | 完成 |
| 03 UI 素材资产 | —（PR #4） | 完成 |
| 04 双实例隔离 | #5（PR #6） | 完成 |
| 05 setup 一键安装 | —（PR #7） | 完成 |
| 06 horosa 集成 + 八字出盘 | #8（PR #9） | 完成 |
| 07 首页替换 = 自我总览四卡 | #10 | 完成 |
| 08 八字冷启动向导 + 底座谱 + 命盘卡点亮 | #11 | 完成（宿主半 + 客户端半） |
| 09 谱管理（创建/查看/编辑/级别） | #12 | 完成，总装配接线已收口 |
| 10 问事闭环 | #13 | 完成 |
| 11 多 AI 合参（Best-of-N） | #14 | 完成 |
| 12 临时挂载（预算裁剪披露） | #15 | 完成 |
| 13 底稿 + 日课（定时任务） | #16 | 完成 |
| 14 藏库（指针 + 签 + 跳转） | #17 | 完成，总装配接线已收口 |
| 15 沉淀闭环（导出汇总 → 确认写谱） | #18 | 完成 |
| 16 工作流创建向导 | #19 | 完成 |

## 本轮（2026-10-15）

### 1. 总装配接线（票 09 / 票 14 的收口）

票 09 与票 14 的实现与断言台此前都已落地，但**没有任何地方把它们接进装配树**：
宿主 `apply()` 没调 `installRpc`，客户端 `apply()` 没调 `installPuPanel` / `installCangClient`。
即「谱面板」「藏抽屉」在真实装配里并不存在。现已接上：

- 宿主 `packages/xuanshu-host/lib/index.js`：`apply()` 组合 `installPuSkill` + `installRpc(pu.* / cang.*)`；
  数据目录与装配报告**共用** `resolveDataDir`（避免「报告写 A、数据落 B」的错位）。
- 客户端 `packages/xuanshu-client/src/client/index.tsx`：`apply()` 调 `installPuPanel` + `installCangClient`；
  cordis `inject` 增 `connection`（证据 `dsh-client-connection/lib/client.js:1477` 的 `ctx.provide("connection", handle)`）；
  `dsh.client.inject` 同步增 `@deepseek-ai/dsh-client-connection`。
- `installPuPanel` 补非 DOM 守卫（产物物化与 SSR 断言跑在 Node 里，原写法会抛）；
  `ctx.uiWorkspace` 改软取（服务缺席时按钮不渲染，而不是点了才炸）。
- `tests/assembly/overview-contract.test.mjs` 的「只注册两个 cell」升级为「玄枢全部注册都是加性的」全量断言。

### 2. 修掉票 07 埋下的回归

票 07 在 `profile/cordis.patch.yml` 前面加了 headless/web 三条 `disabled` 顶条目，
`tests/horosa/p2-single-source.test.mjs` 里「insert 行在第 0 个条目」的假设随之失效（5 条断言连带红）。
改为与 P5 同款的 `flatMap(entry.insert)` 全量取行，并补「`mcp-horosa` 只声明一次」的断言。

### 3. 侦察发现两处 spec 级偏差（已裁定并落 ADR）

对钉版 `0.2.0-rc.2` 做了一轮只读考古（笔记：`.scratch/notes/dsh-api-facts.md`，带 file:line 证据），
发现 spec 的两条实现决策在该版本上**做不到**，而且是静默做不到：

| spec 原文 | rc.2 的真实情况 | 处置 |
|---|---|---|
| 问事容器 `ctx.sessions.create`（`meta.xuanshu={kind,pus,mounts}`） | `meta` 是闭集 7 字段且实现**逐字段挑**（`dsh-session/lib/index.js:1699-1709`）→ 额外键**静默丢弃、不报错、读不回**；`SessionResultFilter` 也不支持任何 header 扩展字段过滤 | **ADR-0009**：自铸 sessionId 前缀 `session-xs-<kind>-<uuid>` + 专用 cwd（不是 workspace）+ 旁挂 JSON 清单；消息级标记走 `MessageSourceMap` 合并点。**禁止**新增会话事件 `type`（`append()` 写不了 `ignorable`，会让会话打不开） |
| 合参 judge 槽 `json_schema strict` | `GenerateOptions` 无 `response_format`/`json_schema`，全 282 包 grep 零命中，README 明文只支持 `temperature`/`maxTokens`/`stop` | **ADR-0010**：judge 走「工具调用参数 JSON + 校验」，失败回落完成顺序第一份；`message.candidates` 同样不存在 → `bestOf` 记录落旁挂文件 |

这两条偏差已回改 `docs/specs/001-assembly-foundation.md`（不改 spec 只改代码，下一个照 spec 实现的人会再踩一次）。
另确认：票 13 的 `ctx.schedule` 需要 profile 的 bundles 补 `@deepseek-ai/dsh-experimental-schedule-bundle`
（该 bundle 只有三行 `time-context` / `schedule` / `ui-schedule`；base/web/headless 三份 shipped patch 里全无这三个 id）；
S4 漂移基线只检查**基线里有的行**是否存在，新增 bundle 带来的新行不会被判失败。

### 4. 票 08 落地（宿主半 + 客户端半）

两个实现者各在自己的 worktree / 分支上并行，按 `.scratch/notes/t08-contract.md` 冻结的接口面工作，
完成后合并进集成分支（`c1ba8d4` / `4cd5eb7`）。

- **宿主半**：`lib/bazi/{constants,timezone,cities,snapshot,base-pu,cast,service}.mjs` 六个 `bazi.*` 方法；
  城市大库 6792 条 / 664 KB（从上游 `citiesFull.json` 裁剪，生成脚本 + 来源留档）；
  `pu/repository.mjs` 新增底座保留路径 `readBase`/`writeBase`（用户 slug 语义一字未动）；
  `tz-lookup`（**CC0-1.0**）作为运行时依赖。`tests/bazi` 67 条，零网络零真实 horosa。
- **客户端半**：`onboarding.tsx` / `onboarding-steps.tsx` / `MingpanPanel.tsx` / `cities.ts` / `bazi-api.ts` /
  `bazi-controller.ts` 等；概览四卡改**数据驱动**（命盘卡按 `bazi.status` 给四态 + 快照）；
  `tests/assembly/onboarding-*.test.mjs` 67 条。

**Lead 补的两处（跨票/冻结面，属集成分支）**：

1. **真太阳时口径行**：票 06 的接缝只回传分类结果，`basis.trueSolar` 一直缺席。该版本信封**没有**结构化的
   真太阳时字段 —— 看起来像的 `data.bazi.directTime` 的时间部分**随 `timeAlg` 变**（实测 0 档 `12:02:34` /
   1 档 `12:00:00` / 3 档 `12:05:56`），拿它当真太阳时会在 2/3 的口径选择下报出一个**不是**真太阳时的值。
   真太阳时只在口径文本的 `真太阳时：<时间戳>` 行里，且三档恒为同一值。故新增
   `extractTrueSolarTime`（锚定该行，读不出返回 `null`）并串到 `buildBasis`/`buildSnapshot`/`cast`/底座谱。
   **绝不拿经度自己算**（「录入层不换算」是 spec 明文）。反证与三条负路径已进 `tests/horosa/p4`。
2. **`xuanshuHorosa.callTool(name, args, options)`**：票 06 的服务面只有 `baziBirth` 一个业务方法，
   而票 13 的日课要 `horosa_cn_huangli` —— 缺这一口，日课就只能去走「自己起 serve / 直连 8765」
   那条被明令禁止的第二通道。新方法语义与 `baziBirth` 同族（取端点 → `mcpCallTool` → 原样回信封，
   **不替你起 serve**），`ok` = 「调用走到了信封」而非「业务成功」。

### 5. 票 10 / 票 13 落地（各分两半并行）

四张票（含 08）都按「先冻结跨半契约 → 两半各在自己的 worktree/分支实现 → 合并」的方式推进。
契约：`.scratch/notes/t08-contract.md`、`t10-contract.md`、`t13-contract.md`；后四票：`t11-16-contracts.md`。

**票 10（问事闭环）**：宿主 `lib/consult/**` 六个 RPC + 旁挂清单 `xuanshu/consult@1` + 首轮上下文注入 +
`turn/end` 记账；客户端门厅（`consult` main key，侧栏 order 30）+ 历史回看子页。两个落地前逮住的坑：
① 裸 `ctx.agents.create` 的会话**跑不起来**（缺 provider/model，且工具来自 preset 挂载的 scope）；
② `openSession(宿主建的 id)` 会**同步抛** `unknown session` → 唯一打开路径写成 `await ctx.sessions.refresh()` → `openSession(id)`。
两坑的 file:line 证据进了契约与 ADR-0009 体系。

**票 13（底稿 + 日课）**：`lib/digao/**`（纯派生 + 确定性骨架 + 来源标记 + LLM 降级如实标注，**没有** write/update）、
`lib/rikke/**`（`horosa_cn_huangli` → `{yi,ji,liuri}`）、两条 daily（日课 07:30 / 底稿 03:30）。
`ctx.schedule` 的提供者不在 shipped 组合里 → 在本包 `cordis.patch.yml` 插 `time-context`/`schedule`/`ui-schedule` 三行
（id 与 shipped bundle 逐字一致；S4 基线 185 行仍全命中，树 188→191）。**真机 `dsh web` 实测**：
`storages/schedule.json` 里恰好 2 条 daily、再启一次仍是 2 条（幂等）。另一处真机发现：
`apply` 里直接 `ctx.get('schedule')` 是 `undefined`（三行挂在本行之后）→ 改 `ctx.inject(['schedule'], …)`。

### 6. 收掉一处结构债：注册面清单收成单一事实来源

票 07/08/10/13 各加了自己的面板，于是**四张契约测试**各写了一份「穷举注册面快照」，而顺序还取决于
`index.tsx` 的 install 调用次序 —— 两张票并行时必然在同一处冲突（本轮合并就在 4 个文件上冲突）。
现收成 **`tests/assembly/lib/panel-surface.mjs`**：`PANEL_KEYS`（顺序 = install 真实次序）+ 派生的
`expectedRegisterNames()` / `expectedCells()`，四张测试都从它取。**以后新增面板只改这一处。**
构建输出可逐项复核注册顺序（`node scripts/build-client.mjs` 会打印副作用序列）。

### 7. 票 11 / 12 / 15 / 16 落地（一人一票，四个分支并行）

四票都汇流在 `consult` 这一带（会话 / 侧栏 / 对话槽），所以**契约先冻结接口面**（`.scratch/notes/t11-16-contracts.md`），
再由四人在各自 worktree 实现、由 Lead 统一合并。

| 票 | 新增宿主面 | 新增客户端面 |
|---|---|---|
| 11 多 AI 合参 | `lib/consult/bestof{,-store,-run}.mjs`（`run/state/adopt` + `cancel`） | `bestof-*`（`/多模型` 命令 + 浮层 + 设置行 + composer 触发按钮） |
| 12 临时挂载 | `lib/mounts/**` + `consult.setMounts`（含 `preview`） | `mounts-*`（S8 抽屉 + 门厅挂载区） |
| 15 沉淀闭环 | `lib/sediment/**` + 内置 skill `xuanshu:sediment` | `sediment-*`（入口条 + 草稿卡 + 通知） |
| 16 工作流向导 | `lib/workflow/**`（`create/list/exportSkill`） | `workflow/*`（门厅 + 导出表单） |

**两处新增的 additive 接口面**（都经 Lead 批准）：`bestof.cancel`（S9 明写「停止全部」，没有取消面的停止按钮比没有按钮更坏）、
`bestof.adopt` 的 `delivery` 回执（投递失败不上抛，但如实回报，冷读说同一句话）。

**三处「静默失效」被逐个堵掉**：`preview` 面是契约缺口（装不下预览 → 加可选字段而不是加方法名，校验/读取/裁剪仍走同一条路径）；
预算 M 拿不到就不编（rc.2 没有上下文窗口元数据 → 界面显「预算未知」）；`rikke.status` / `digao.status` 缺字段就省略键。

**真机取证抓到的一个真缺陷（票 16）**：`ctx.skills.list()` 返回 Promise，第一版**同步**取数组 →
`Array.isArray(Promise)` 恒 false → 每次都走「注册表没看到」，而**沙箱里的假 service 也是同步的，两边一起错、测试全绿**。
「沙箱里全绿不算数」在这张票上被证明了一次。真机另证：宿主层 `list()` **看不到**刚写进 `$DSH_HOME/skills` 的 skill
（`skill-filesystem` 宿主行没有 fiber），所以导出成功的判据是**磁盘重解析**，注册表那一步如实说「没核对上」。

### 8. 收掉第二类结构债：共享槽的「全局计数」断言

票 11/15 合并后暴露：`bestof-registry` 断言 `conversation.composer.dock` 只有自己一格、`mounts-contract` 断言全局
`shell.overlay` 恰 2 个 —— 两者都是**共享槽**，后加的票会无端打红。已改成「**我的那一格在 + 相对位置正确 + 我自己只出现一次**」，
断言语义未变松。与 §6 的穷举快照是同一类问题：把「我的那一格在」写成了「只有我的那一格」。

### 9. code-review 结果（两轴并行，固定点 `main`）

按项目技能 `code-review` 跑了两轴（各一个独立上下文）：**标准轴**（成文标准 + 12 项气味基线）与**规格轴**
（Spec 001 + 16 张票面 + 设计稿；ADR-0009/0010 已裁定的偏离不算缺陷）。**两轴独立报告，不合并排序。**

**标准轴的重要发现（已修 / 已登记）**

| 发现 | 处置 |
|---|---|
| `tests/{bazi,consult,sediment}/lib/sandbox.mjs` 的 `pruneStale()` 判据**写反**（注释说删过旧的、代码用 `<` 删**新建**的），且五份复制已漂移 | **已修**：共享实现 `tests/lib/sandbox-prune.mjs`，七处都调它；先留红证据（2 处红）→ 修后 10 passed。**merge 集成 tip 后又抓到第三处**（票 15 带进来的 sediment）——判据能证否，漂移就藏不住 |
| `bestof-run.mjs` 在「既没调工具、正文也无 JSON」时报 `judge.mode='tool'`（**记录在说一件没发生的事**） | **已修**：改报 `'failed'`（客户端类型本来就有这一档）。**关键：那条断言原来钉的正是错值** |
| `ADF-0009` 笔误、「项目」当工作区同义词用 | **已修** |
| 7 个 cang 文件零中文注释、断言 DSH 行为处无 file:line 出处 | **部分修**（2/7）；其余在下一轮，找不到出处的如实写「未确认」 |
| `softGet` 同形 17 份（其一漏了 `typeof ctx?.get` 守卫）、MCP 握手判据三份、`verify-isolation.mjs` 的 `main()` 649 行 | **登记为技术债**（未修）：有「唯一来源」惯例可循，但不在本轮预算内 |
| ADR-0001/0003/0009/0010 实装侧核查 | **通过**（藏只读注册表本身、会话只用 `cwd`+`agentPreset`、judge 走单字段工具） |

**规格轴的重要发现（已处置）**

| 发现 | 处置 |
|---|---|
| Spec §86 要求 `dsh.profile.bundles` 含 schedule bundle；实际走的是本包补丁行，且**没有 ADR** | **已补 ADR-0011**（含「依赖未显式声明、靠传递依赖」这条最脆一环与「GUI 再 set_bundle 会重复行」的后续处置） |
| 票 16 的 S12「会话内向导条 + 人判定条」定在 `conversation.input.dock`，实现在门厅 —— **台账完全没登记这条** | **已登记**：见 `待实测登记处.md` V106 与本表下方「已知偏离」 |
| `cang.capabilities` / `cang.pickDirectory` + 新依赖 `@deepseek-ai/dsh-native-command`（规格只写「系统默认程序打开」） | **登记为已批准的范围外补充**：钉版 rc.2 的 `dsh-host-open-in-app` 只接受目录，故复用同版 `dsh-native-command`；能力协商是「无桌面宿主下按钮置灰」的前提 |
| **会话 id 判据双份且不等价**（服务端严格正则 / 客户端只判前缀），两份测试谁也不校验谁 | **在下一轮修**：收紧到同一套规则 + parity 用例（边界样例两边结论逐例相同）+ 一条会红的对照 |
| `bestof-run.test.mjs` 的 `elapsedMs >= 0` 是**恒真断言** | **在下一轮修** |
| `rikke/store.mjs:115` 的 `hour === 24` 在 `hour <= 23` 下永不可达（死分支） | **在下一轮修** |
| ADR-0009/0010 禁令核查（`meta` 额外键 / 自定义会话事件 type / `json_schema`） | **通过**：packages 下无违规，`json_schema` 只出现在注释里 |
| 台账数字可复核性 | **属实**（评审独立实测：assembly 401 passed/2 failed = 登记的 S1 及其连带；consult+sediment 222 passed） |

**已知偏离（规格轴第二条的口径，补齐登记）**

- 票 16 的**会话内向导条 / 人判定条**未做（S12 D5 的 `conversation.input.dock`）：导出表单与「跑没跑通由你判定」
  的规则文案落在**门厅面板**里 —— **功能在、位置不贴设计稿**。槽位面没有证据，先侦察再动。
- 票 12 的**第二个挂载入口**（S8 §1 的 conversation 面板输入区上沿按钮）同样未做。
  两条都在 `待实测登记处.md` **V106**。

### 10. 清理轮：找回票 13 客户端半的最后一棒（2026-10-15 晚）

**发现的一处真丢活**：票 13 客户端半有**两笔从未并回集成分支**的提交 —— `1818ec7`（卡级 `[重试]`
必须先 `clearOutcome()` 清掉上一次人点结果、再重读宿主事实，否则点了界面不动）+ `279c876`（补记
「面板直调 api 而不经控制器」的理由）。合并方向走了一半：02:56 集成分支并入该分支时拿到的是
`b1f6c98`，之后客户端又把集成分支并回来（`4f636de` 02:57）、再提交一笔（`279c876` 03:02）——
**最后一棒没回来**。

判据（能证否）：`git log -S'clearOutcome' --oneline HEAD` 在合并前输出 **NONE** —— 这段代码在集成分支
历史里从来没出现过；`git cherry -v HEAD feat/13-digao-rikke-client` 也把它标 `+`。

处置：并回（`8a2165c`）。冲突六处，四张契约测试与 `index.tsx` **取集成分支侧** —— 注册面清单已收口到
`tests/assembly/lib/panel-surface.mjs`（§6），分支侧那份是收口前的手写穷举数组；`lib/client.js` 按合并后
源码重建（386169 → 386627 B）。**产物一变，`install-profile` 必须重跑，否则 S3 红**（同 §「操作陷阱」1）。

**其它清理**

- `main` 的 `README.md` **add/add**：集成分支那份已是超集（同样开头与文档索引 + runbook 行，另加仓库结构 /
  命令 / 安装 / horosa 底座四节），取集成分支侧；main 那份的「状态」还写着「代码尚未开工」。README 的
  「状态」一节随后按最终数字重写。
- 13 个实现者 worktree 全部 deregister 并删除（t08 里未提交的 `birth*` 草稿先 `git stash` 存档，没丢）。
- `.scratch/assembly-foundation/captures/` 里的**两份 pin 离线副本**（`horosa-SHA256SUMS.txt` /
  `horosa-runtime-manifest.json`）缺失 → `tests/setup/pin.test.mjs` **收集期 ENOENT**：整个文件 9 条用例
  从总数里消失（1030 → 1021），而摘要只会显示「passed 变少」，不会在失败名单里出现这 9 条。已按
  `horosa-pin.json` 的 release URL 经镜像取回**真件**（wheel `feb377…9f83`、win32-x64 `2b3cce…86d7`、
  size 718649254，与 pin 逐值一致），9 条恢复。
- 同目录的 **raw 捕获 `gt06-*.json`（2026-10-13 真机探针产物）仍缺** → `tests/horosa/p0-fixtures` 两条由
  「skip」变「红」。**证据缺失时它们故意红**（`it.skipIf(!HAS_CAPTURES)` 只在整目录缺失时让位），如实、不是回归；
  要补齐得重跑一次真机捕获（探针脚本 `gt06-probe.mjs` 本身也在该目录，随目录一起丢了）。

**这一轮的教训**：**测试总数也会说谎**。文件级收集失败在摘要里是「少了几条 passed」，而
`skipIf(证据存在)` 会把「证据没了」渲染成「跳过」——两种都不会红在自己的名字上。见下节陷阱 3。

**这一轮的改进（把上面三件事变成机器判据）**

| 改了什么 | 为什么 |
|---|---|
| `scripts/check-test-inventory.mjs` + `tests/test-inventory.json` + `pnpm test:inventory` | 「用例还在不在、数对不对」的机器判据：文件收集到 0 条 / 用例数比基线少 / 已知红之外的失败，各自红。基线 1033 条 · 98 文件，已知红只有 S1 两条（逐条写理由） |
| `tests/setup/pin.test.mjs`：副本读取改哨兵 + **顶层门** | 顶层 `readFileSync` 一抛就是**整个文件收集失败**（静默消失）；现在缺证据 = 那一条红 + 那一组跳过（`describe.skipIf`），**总数不变**。红绿实测：隐藏副本 → `1 failed | 53 passed | 8 skipped (62)`（同一文件 10 条照旧被收集），失败标题就是「两份离线证据副本都在」并给出取回方法 |
| `tests/horosa/p0-fixtures.test.mjs`：守卫改**按文件**，并摘掉一条永不执行的跳过 | `existsSync(CAPTURES_DIR)` 是目录级开关却管着 4 个具体文件 —— 补回两份 pin 副本就把「跳过」变成假红（本轮实测）。`PROVENANCE.md` 那条读的是**仓库里**的文件，却挂在 `.scratch` 上 ⇒ 在没有 .scratch 的机器上从未执行 |
| `.github/workflows/verify.yml`（仓库第一道 CI）+ `pnpm verify:all` | 此前没有 workflow / hook / lint 配置：tsc、产物同步、用例清单门全靠人记得跑 |
| `scripts/cleanup-worktrees.mjs` + `pnpm cleanup:worktrees` | 收 worktree 的**证明链**：分支 tip 必须是 HEAD 祖先（否则只报告不删）→ 脏工作区先 stash → `git worktree remove` → Windows 用 `cmd /c rmdir /s /q`（不跟随 junction） |

**环境事实（省下下一次的摸索）**：`github.com:443` 会间歇性 reset（本轮 `git push` 重试到第 4 次才成功，`ls-remote` 也时通时断），而 **GitHub MCP 走另一条路、一直可用** —— push/fetch 用重试循环更省事。仓库根依赖硬链自 `E:\.pnpm-store\v11`。`captures/` 里那两份 pin 副本是**公开 release 资产**（可按 pin 的 `evidence` URL 取回并逐值核对），`gt06-*` 那份真机捕获取不回来、只能重跑探针。

### 11. 评审修复轮：两个探针提出的 5 条（2026-10-15 晚）

评审基线 `main...d1ce6b3`，证据只在 `.scratch/`（未入库）：`.scratch/review-spec001-probe.mjs`（4 条）、
`.scratch/review-inventory-stale-probe.mjs`（1 条）。**5 条都修了，并且都落成了正式用例**（探针仍然是探针，
回归判据在 `tests/` 里）。

| # | 探针实测的发现 | 处置 |
|---|---|---|
| ① | **清单门假绿**：故障注入把 `spawnSync` 换成「exit 73、不写报告」，报告路径上留着上一轮的旧报告 → 门读到旧报告，判「用例都在、都通过」，exit 0 | `scripts/lib/inventory-gate.mjs`（把「读报告」拆成可单测的一半）：跑之前**先删旧报告** → 子进程起不来 / 没写出报告 / 报告比这一轮启动还旧 / 报告不是合法 JSON，四种都 exit 2 并明说「不许拿旧报告顶上」。`tests/lib/inventory-gate.test.mjs` 11 条（含故障注入复现）。**退出码非 0 不再是失败信号**（已知红在跑，vitest 自己就 exit 1）——判据是报告新鲜度 |
| ② | **清单门假红**：未装 profile 时 `assembly-contract` 只收集 1 条（基线 8 条）⇒ 干净 CI 必红。同一类还有 `tests/isolation/{dual-instance,port-guard,resolve}`（8/13/16 → 1/1/7）与 `tests/rikke/schedule-bundle`（装了 1 条、没装 2 条）——探针只测到第一处，全量模拟跑才把后面四处照出来 | 五处统一成「**用例条数与环境解耦**」（`assembly-contract` + 隔离三件 + `schedule-bundle`；共享门在 `tests/isolation/lib/verifier.mjs`）：`it.skipIf` / `describe.skipIf`（照样收集、只标跳过），`XUANSHU_REQUIRE_ASSEMBLY=1` 仍硬失败（`assembly-contract` 8 条逐条红；隔离三件 = 同一批用例照收 + 另加一条点名原因的失败 ⇒ 那 3 个文件在强制模式下条数比基线多 1，清单门只拦「变少」，红得清楚）。实测（下表）：装了与没装，逐文件条数完全相同 |
| ③ | **迟到挂载静默失效**：`create → send(首问) → setMounts → send(第二问)`，第二问看不到新挂载（`secondQuestionHadUpdatedMount=false`）；抽屉字数一切正常，模型侧什么都没有 | 挂载变更**在确认那一刻**注入（`consult.setMounts` → `syncMountsIntoSession`，`inject()` 不唤醒），`consult.send` 兜底（会话不在本进程活着时补在问题之前）；「已经交给模型的那一份」记旁挂清单 `mountsInjected` ⇒ 幂等（同一份不重复灌）、移除也声明「已全部移除」 |
| ④ | **合参候选看不到这场问事的上下文**：候选只拿到一句裸问题（`candidatesHadPu/Digao=false`）⇒ 问「结合我的信息」时答不出 | `bestof.run` 用**与首轮注入同一份装配**（新模块 `lib/consult/inject.mjs`）把上下文并进候选的用户消息；**判官与合并槽不带**（H4 的断言原样保留） |
| ⑤ | **原生 composer 的首问没有上下文**：`consult.create` 之后门厅就 `openSession`，用户直接在原生输入框说第一句 → `contextInjections=0`、`turns` 仍为 0 | 首轮上下文**提前到 `consult.create`**（与 `send` 里 `inject→followup` 同一机制，只是把时刻提前）；`consult.send` 只在「create 没灌成 / 会话是别的进程建的」时补，且补前先核**会话日志**（`source.kind='xuanshu-consult'`）以免重复灌；`turns` / 标题与会话日志核对一次（原生那一句也算一轮 —— 票 15 的 `sediment.draft` 读 `turns ≥ 1`） |

**没动的三处口径**（不是遗漏）：判官与合并槽不带上下文（H4）；`consult.send`「受理即回」；
ADR-0009 的三条禁令（不碰 `meta` / 不新增会话事件 `type` / 不拿 `agentPreset` 当标签）。

**验收数字**（都抄工具输出）：

```
# 本机（profile 已装）
[inventory] 用例 1057 条（基线 1057）/ 文件 99 个 / 失败 2 条（已知红 2 条） / 跳过 10 条 / vitest exit 1
[inventory] 通过：没有用例消失、没有已知红之外的失败。
# 同一份代码、干净环境（XUANSHU_DSH_HOME 指向空目录 ⇒ 没有 profile）
[inventory] 用例 1057 条（基线 1057）/ 文件 99 个 / 失败 0 条（已知红 0 条） / 跳过 51 条 / vitest exit 0
[inventory] 通过：没有用例消失、没有已知红之外的失败。
```

两行的**条数逐文件相同**（8/13/16 的隔离三件、`assembly-contract` 的 8 条、`schedule-bundle` 的 1 条，
在两种环境里各自相等）——这就是 ② 的机器判据，也是 §10 那条教训（「测试总数也会说谎」）的正面用法。
干净环境多出来的 41 条跳过 = 未装 profile 的那些组（8 + 8 + 13 + 11 + 1）。
两条证据留档：`.scratch/postfix2-local-gate.txt` / `.scratch/postfix2-clean-ci-gate.txt`
（报告本体 `.scratch/postfix2-*-report.json`）。

**探针 ① 之外的一条边界（别误读）**：`review-spec001-probe.mjs` 最后那行读的是
`.scratch/spec001-review-no-profile.json` —— 评审当时那份**冻结**的运行输出（而且只是 `tests/assembly`
的子集）。它是**改动前**的现场，修复后重跑探针仍会打印 `actual:1 … inventoryWouldReject:true`；
② 的判据是全量干净环境跑（上面那两行），不是那一行。

探针复跑（修复后）：`late-mount` 的 `injectionsAfter 1→2`、`secondQuestionHadUpdatedMount false→true`；
`bestof-context` 的 `candidatesHadDigao/candidatesHadPu` 双双 `false→true`；
`blank-consult-native-composer` 的 `contextInjections 0→1`（`turns` 仍是 0：那一问不经过玄枢，
要等玄枢下一次接手这个会话时按日志补账 —— 见 `lib/consult/turns.mjs`）；
`review-inventory-stale-probe` 现在 **exit 2** 并打印「测试进程起不来 … 不许拿旧报告顶上」（修复前 exit 0 + 「门 returned success」）。

**两轴 code-review 自查后又改的五处**（都在同一轮里，都是「报告里说的」与「代码真做的」对不上的地方）：

| 审查发现 | 处置 |
|---|---|
| **兜底注入被 `turns` 挡掉**：核对把 `turns` 抬到 1 之后，`knownInSession` 那道门的 `turns === 0` 条件不再成立 —— 「create 首灌失败 + 原生 composer 说过话」这一场会**永远没有上下文** | 注入判据改成只看「**灌过没有**」（本进程 / 会话日志 / 已问过一轮），不再看 `turns`；并补一条把两个条件叠在一起的用例（`send.test.mjs`） |
| `inspectSessionLog` 把「会话还没落盘」与「读不动」当成同一件事 | 用 `isSessionNotFound()` 分开：还没落盘 → `{questions:[],hasContext:false}`；读不动 → `null`（不编数）。判据与投影一起收进 `lib/consult/turns.mjs`（`history.mjs` 的取文本逻辑也复用它，不再各写一份） |
| **`mountsInjected` 在内容没读出来时也写**（披露块进了、正文没进）⇒ 那一份挂载再也不会重试 | 只有**内容真的纳入**（`delivered`）才记；读不出来 / 全被裁掉时留着，**下一问再试** —— 补了一条「fs 不在 → fs 回来 → 补上」的用例。代价说清楚：内容一直读不出来的环境里，每一问都会重试（多一段「读不出来」的披露），这是「宁可多说一次，也不许一直没有」的选择（真机上 `ctx.fs` 在场的常态路径只注入一次） |
| **`sediment.draft` 只看旁挂清单的 `turns`**：一场只从原生 composer 问过的问事会被「还没问过」拒掉 | `sediment.draft` 也先按会话日志核对一次（复用 `reconcileTurns`）；补一条用例（旁挂说 0 轮、日志里两问 → 正常出草稿，并把账补成 2） |
| 清单门其余三处小账：`known` 拼成 `file::title` 再 `split` （标题里带 `::` 会被截断）、mtime 判据在粗粒度文件系统上会假红、`now` 注入点没人用 | `known` 改返回对象；判据留 2 秒宽容并补一条「同秒写入不算旧件」的用例；`now` 真的被那条「旧件」用例用上了 |

**一处刻意的边界（不是缺陷）**：合参候选拿到的是这场问事的**上下文快照**（底座谱 / 底稿 / 勾选谱 / 挂载），
**不含**会话历史与采用稿 —— 候选流本来就是不带历史的独立流；采用稿由 `bestof.adopt` 投进**会话**，
所以下一场问事（`consult.send`）看得见，而下一轮合参的候选看不见。要改这条得先冻结一个新的接口面。

**另外修掉的一处（本轮一并做，2026-10-15 晚）**：`docs/tickets/` 里 9 份票面（07–11、13–16）曾是乱码 ——
`1876303`（「票 07–16 状态与追踪器对齐」）那一笔把**没改动的行**写成了双层编码（读错编码再写回，而且**有损**：
丢掉的字符在文件里留下一个替换字符 + 一个 `?` 的洞），而**它新写的 Status 行是干净 UTF-8**。修法不需要猜：正文取 `1876303^` 的原样、
Status 行取坏文件里那一行，逐字未动；写盘前核两条 —— ① 当前正文是损坏前正文的**子序列**（⇒ 那一笔没加过内容）、
② 丢掉的字符数能被洞数解释（⇒ 那一笔也没删过内容），两条都过才写。修完 `git diff` 只显示「乱码行 → 干净行」
（Status 行本来就干净，diff 里根本没动），全仓双层编码扫描从 **9 份降到 0 份**。
**这条的教训**：这类损坏是**逐行**的 —— 用某种编辑器/脚本改中文文件时，读错编码会把「没碰的行」写坏，
而「新写的行」是好的。只扫「文件里有没有乱码字符」还不够，得看**同一份文件里一半干净一半乱**这种形状
（本次是靠逐行比对才发现那一笔其实只改了 Status 一行）。

## 验证边界

完整装配五条 seam 的当前结果：S2（进程内启动）、S3（客户端产物）、S4（上游行基线）、S5（真实 CLI 报告）通过；
**S1 schema 导出失败**。

失败来自钉版 `@deepseek-ai/dsh-app-boot@0.2.0-rc.2`：它的 schema 导出器只接受 native group/include carrier，
而同版本官方 web bundle 自带的 `@deepseek-ai/dsh-agent-preset` 是另一种 carrier，报
`unrecognized Loader tree carrier`。真实 web 与宿主启动正常。测试保留失败，无上游源码改动、无放宽断言。

当前全仓基线（`node scripts/check-test-inventory.mjs`，2026-10-15 晚评审修复轮之后）：

```
[inventory] 用例 1057 条（基线 1057）/ 文件 99 个 / 失败 2 条（已知红 2 条） / 跳过 10 条 / vitest exit 1
[inventory] 通过：没有用例消失、没有已知红之外的失败。
```

2 条失败 = **S1 装配树** 与由它连带的 **CLI 退出码为 0**（就是基线 `knownRed` 里那两条，理由见上）。
跳过的 10 条 = `tests/horosa/p0-fixtures` 2 条（`.scratch` 里的 `gt06-*` 原始捕获仍缺）+ `tests/horosa/p10-e2e` 8 条
（真机前置件不在）。**同一条命令在「没有 profile」的干净环境里也必须给出同样的条数并判过**
（评审修复轮实测：1057 / 99 文件 / 0 失败 / 51 跳过）—— 这就是 §11 ② 的机器判据；
「干净环境」用 `XUANSHU_DSH_HOME` 指向一个空目录来模拟（CI 上那个目录本来就不存在）。
**基线之外的红色一律是本轮引入的回归。**
（历史：票 08 后 448 passed；票 10/13 后 684；票 11/12/15/16 后 992；code-review 修复后 1020；
清理轮 +3 条用例，并把两处「证据没了」从「静默跳过 / 不收集」顶成红；评审修复轮 +24 条用例、新增
`tests/lib/inventory-gate.test.mjs` 一个文件，并把 5 个测试文件的条数与环境解耦。）
同一时刻的装配五 seam：**S2 / S3 / S4（185 行基线全命中）/ S5 PASS，S1 FAIL**；`tsc --noEmit` exit 0；
`build-client --check` in sync（386627 B）。

**S5 的面依赖（已修）**：票 07 在 profile 补丁层加了三行 `disabled` 开关后，web 面（`XUANSHU_SURFACE` 未设）
由 `web-startup` 拥有 cmdlineArgs，它把 `--help` 当自己的用法打印后**在挂载插件树之前就 exit 0** ——
于是 apply 根本没跑、报告写不出来，S5 判红。同一 profile 同一命令只差这一个环境变量：未设 → FAIL；
headless → PASS（189 行）。这条 seam 要验的是「真 CLI 启动 → 插件 apply → 报告写出」，所以
`checkS5` 的探针**显式取 headless 面**（`runCli` 增 `extraEnv` 形参），web 面的启动本身由
`tests/isolation` 的 web 冒烟覆盖。**这是修探针口径，不是放宽断言。**

**首次冷启动的 serve 会慢到分钟级**（uv 首次要装 46 个包）：那段时间里 `baziBirth` / `callTool`
会拿到 `ECONNREFUSED`（`code:'mcp-call-failed'`）。宿主侧**刻意不在业务方法里自旋等 serve**
（避免与 autostart 抢着起、也避免把服务的生命周期职责漏进业务层）——失败如实回报，由界面给可读理由。
热启动实测 ≈ 22s（票 06 数据），属正常路径。

本机 `pnpm` 可用（清理轮实测 11.21.0；`scripts/install-profile.mjs` 内部调的那份是 11.28.5），
`pnpm install --frozen-lockfile` 在仓库根可直接跑（依赖硬链自 `E:\.pnpm-store\v11`）。
构建 / vitest / tsc 仍可直接用现有 Node 执行（如 `node ./node_modules/vitest/vitest.mjs run`）。
未修改机器全局配置。

### 三条会让"没验"伪装成"验过"的操作陷阱（实测踩到，记下来）

1. **merge 集成 tip 之后必须重跑 `node scripts/install-profile.mjs --home .dsh-home`。**
   否则 S3 会红：profile 里装的 `lib/client.js` 与仓库不一致（merge 带进来的客户端源文件不会自动同步）。
   **本条每张票都会踩一次**，实现者两轮各踩了一次。
2. **改中文源码文件不要走 PowerShell 的 `Get-Content -Raw | Set-Content -Encoding utf8` 往返** ——
   中文注释会变乱码，进而让 vitest 报 **`no tests`**。危险的不是乱码本身，而是它的**失败形态**：
   一个「测试根本没跑」被读成「测试通过」或「实现被改坏」。**用 `read`/`edit`/`write` 工具改文件。**
   同一类问题的另一面：`--reporter=basic` 在 vitest 4 不支持（要用 `dot`）、`fileParallelism: false` 是刻意设的。
   （本轮又踩到同类一次：`Get-Content -Raw | ConvertFrom-Json` 读中文 `package.json` 直接把 JSON 读成乱码报错 ——
   读取中文文件一律用 `read` 工具。**代价最大的一次是 `1876303`**：那一笔把 `docs/tickets/` 里 9 份票面
   （07–11、13–16）**没改动的行**写成了双层编码（新写的 Status 行反而是好的）—— 已按「正文取 `1876303^`、
   Status 取坏文件里那一行」逐字修回，全仓扫描 9 → 0；取证与两条核对口径见 §11 末。）
3. **别用 PowerShell 的 `Remove-Item -Recurse` 删 worktree / 依赖目录** —— 它会**跟随 pnpm 的 junction**，
   删掉的可能是仓库根 `node_modules` 里的真件。实测（清理轮）：删完 `.scratch/worktrees/*` 之后，仓库根
   `node_modules/.pnpm` 只剩 72 个目录，`@esbuild/win32-x64`、`@jridgewell/sourcemap-codec` 消失
   → `vitest` 起动即 `ERR_MODULE_NOT_FOUND`、`build-pipeline` 两条红；而**删之前一分钟**同一条
   `build-client --check` 还是 exit 0（时间线就是判据）。修法：`pnpm install`（含 `--force`）会认为
   「已经最新」而不肯重链（虚拟 store 的 `lock.yaml` 仍在），必须
   `Rename-Item node_modules <bak>` → `pnpm install --frozen-lockfile` → `cmd /c rmdir /s /q <bak>`。
   **删目录一律用 `cmd /c rmdir /s /q`**（`rmdir /s` 不跟随 reparse point）。
   同族的一条：**测试总数也会说谎** —— `tests/setup/pin.test.mjs` 因证据副本缺失在**收集期** ENOENT，
   整个文件 9 条用例从总数里消失（1030 → 1021），摘要里只是「passed 变少」；而 `skipIf(证据存在)`
   把「证据没了」渲染成「跳过」。**看到总数变了先数一数，不要只看红绿。**

## 工作方式

- 每个实现者在自己的 git worktree（`.scratch/worktrees/<ticket>`）与自己的分支上工作，
  完成前把集成分支 tip 并进自己的分支，再由 Lead 合并回集成分支。
- 跨半/跨票的接口面**先冻结成契约文档**（如 `.scratch/notes/t08-contract.md`）再并行实现，
  避免两条分支在集成时对不上。
- 每完成一个阶段：推分支 + 开票面 PR + 在对应 issue 留证据，做法照票 01–07 的历史形态。
- **收尾两条命令**：`pnpm verify:all`（类型 + 产物同步 + 用例清单门）、`pnpm cleanup:worktrees`（先证明分支已并入，再存档，再删）。
- **数字只从工具输出里抄**：用例计数抄 `pnpm test:inventory` 那一行，五 seam 抄 `pnpm verify:assembly` 的输出。README、台账、PR body 三处手抄过一次（992 vs 1020）——手抄的必然漂。
- **合并方向的最后一棒**：分支并进集成分支之后，如果那条分支又提交、又并回一次集成分支，就必须**再并一次回去** —— 票 13 客户端两笔就是这么丢的（`cleanup:worktrees` 的「必须是 HEAD 祖先」正是拦这个的）。
