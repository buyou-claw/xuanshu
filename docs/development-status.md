# 开发进度（Spec 001 装配基座 / Spec 002 住进去）

核对日期：2026-10-15（Spec 001）/ 2026-10-17（Spec 002，见 §16）。集成分支：Spec 001 = `codex/spec-001-integration`（**已推 origin**）；Spec 002 = `feat/spec-002-integration`（票 #22–#31，见 §16）。

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

> **§11 里已被 §12 换掉的机制**（复核实测它们仍有洞）：③ 的「确认那一刻注入 + `mountsInjected` 幂等」、
> ④ 的「候选只带上下文快照」、⑤ 的「首轮上下文在 create 那一刻灌」、以及下面两条 code-review 处置
> （`mountsInjected` 只在 `delivered` 时写、注入判据改成「灌过没有」）。上下文与挂载现在只有一条通道：
> `boundary.mjs` → `agent/pre-step`（ADR-0012）。这一段保留原文是为了看清「当时为什么那么改」。

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

**一处刻意的边界（§11 当时的口径；已由 §12 的 R5 修掉）**：合参候选当时拿到的是这场问事的**上下文快照**
（底座谱 / 底稿 / 勾选谱 / 挂载），**不含**会话历史与采用稿。本轮复核判定这违反 ADR-0010 第 5 条与 S9
的历史窗口要求 —— 现在候选另外带一段**窗口裁剪后的会话文本历史**（含被采用的合参稿，见 §12）。

**另外修掉的一处（本轮一并做，2026-10-15 晚）**：`docs/tickets/` 里 9 份票面（07–11、13–16）曾是乱码 ——
`1876303`（「票 07–16 状态与追踪器对齐」）那一笔把**没改动的行**写成了双层编码（读错编码再写回，而且**有损**：
丢掉的字符在文件里留下一个替换字符 + 一个 `?` 的洞），而**它新写的 Status 行是干净 UTF-8**。修法不需要猜：正文取 `1876303^` 的原样、
Status 行取坏文件里那一行，逐字未动；写盘前核两条 —— ① 当前正文是损坏前正文的**子序列**（⇒ 那一笔没加过内容）、
② 丢掉的字符数能被洞数解释（⇒ 那一笔也没删过内容），两条都过才写。修完 `git diff` 只显示「乱码行 → 干净行」
（Status 行本来就干净，diff 里根本没动），全仓双层编码扫描从 **9 份降到 0 份**。
**这条的教训**：这类损坏是**逐行**的 —— 用某种编辑器/脚本改中文文件时，读错编码会把「没碰的行」写坏，
而「新写的行」是好的。只扫「文件里有没有乱码字符」还不够，得看**同一份文件里一半干净一半乱**这种形状
（本次是靠逐行比对才发现那一笔其实只改了 Status 一行）。

### 12. 复核轮：`a2ceaf3` 的 5 条发现（2026-10-15 深夜，全修）

复核报告入库在 `docs/reviews/spec001-a2ceaf3-review.md`（结论：本轮不通过，5 条本轮发现）。
它写的每一处都是真的，逐条处置如下；**机制换了的那些，§11 里对应的说法以本节为准**。

| # | 复核实测的发现 | 处置 |
|---|---|---|
| R1 | **清单门仍会漏掉 hook / suite 失败**：`beforeAll` 抛错时真实 vitest 报的是「文件 `status:'failed'` + 用例全 `skipped` + `numFailedTests 0`」，而判据只看 `assertion.status === 'failed'` ⇒ 报告新鲜、条数不减，门照样通过 | `collectReport` 多收一类 `suiteFailures`（文件级失败且**没有**任何用例级失败，附报告里那句 message），`violationsFor` 把它当违规；再加一条「`success=false` 却一条失败都核不出来」（未处理错误）的判据。回归用例 4 条：合成报告 2 条 + **真 vitest 跑一次那个 beforeAll 抛错的夹具**（`tests/lib/fixtures/inventory-hook/`，故意不叫 `.test.mjs`）+ 一条「文件里已有用例级失败就不重复报」。复核自己的探针复跑：`vitestExit 1 / reportSuccess false / failures [] / suiteFailures 1` → **violations 1 条**（修复前 0 条） |
| R2 | **空白会话恢复后仍漏上下文**：旧实现的「在场」靠 `inject()` 排进 inbox，而正常 `dispose()` 会追加 `outcome:"canceled"` 把待消费消息撤掉；原生 composer 又不经过 `consult.send` ⇒ 「空白开会话 → 关应用 → 恢复后原生问第一句」一个字都不剩 | 上下文改走 **`agent/pre-step` 边界**（`lib/consult/boundary.mjs`）：每一轮的**第一步**判断「缺什么」再补。交付的落点是**会话日志**（loop 在 `dsh-agent-loop/lib/index.js:1061` 把这一步的消息 append 成 `user/message`）⇒ 一次交付即永久在场（重启 / dispose / 原生 composer 都读同一份日志）。实装依据：`:906-918` 的 pre-step waterfall；随包先例 `dsh-time-context/lib/index.js:242-246`。ADR-0012 记了决定与代价 |
| R3 | **重启后先确认挂载、再从原生会话续问 → 挂载不生效**：`syncMountsIntoSession()` 找不到活 agent 就返回 false | 同一条边界按**变化**补挂载：`consult.setMounts` 只落清单（不再需要「那一刻有活 agent」），下一问第一步发现「这一层还没进过日志」就补投它 |
| R4 | **部分挂载读取失败被整体记为已交付**：`.some(layer.kept)` 因 A 成功而 true ⇒ `mountsInjected = [A,B]`，B 恢复后永不重读 | `mountsInjected` 改成**逐层**只记「内容真的纳入」（`layer.kept === true`）：读不出来的层留在外面 ⇒ 下一问自动重试。用例直接复刻 A 可读 / B 缺失 → 补上文件 → 下一问带上 B 的正文 |
| R5 | **合参候选仍无文本历史与采用稿**：候选只有「材料 + 当前问题」，用户说「沿用刚才采用的方案」时候选取不到上一轮 | `bestof.run` 给候选加**会话文本历史**（`history.mjs` 的 `buildCandidateHistory` + `projectConsultMessages`）：窗口复用模型窗口探测（新 `resolveHistoryBudget`，S9「历史长度按合参模型统一处理」），按**整条**消息从最新往回裁并把裁剪事实写进文本；只带**被采用的**合参稿（`xuanshu-bestof-adopted`，ADR-0010 第 5 条），注入过的材料不进历史。判官与合并槽继续不带（H4 原样） |

**这轮换掉的机制（别按旧文档找）**：`consult.create` / `consult.send` / `consult.setMounts` **都不再注入**；
`lib/consult/inject.mjs` 的 `buildMountChange`、`context.mjs` 的 `buildMountUpdateContext`、
`service.mjs` 的 `injectFirstRound` / `syncMountsIntoSession` 全部删除；
`store.mjs` 的 `mountsInjected` / `mountsKey` **按新的判据重写**（逐层「内容已交付」，见 R4）。
上下文与挂载现在只有一条通道：`boundary.mjs` → `agent/pre-step`。

**实装探针（钉版 rc.2，打桩 LLM、跑真的一轮）**：`.scratch/review-a2-boundary-probe.mjs`
用真 `Context` + `SessionStore` + `AgentRegistry` + `AgentLoop` + 真 `SystemPrompt` 建会话，按生产方式注册边界，
再让**真的一轮**跑起来（`ctx.provide('llm', {stream, prepareCall})` 打桩，不联网、不调模型）。
输出留档 `.scratch/review-a2-boundary-probe-output.jsonl`：

```
{"stage":"first-turn","firstTurnEnded":true,"eventTypes":["agent/inbox/spliced","turn/start","agent/inbox/spliced","step/start","system/message","user/message","user/message","request/header","request/context","assistant/message","step/end","turn/end"],"derivedMessages":["system/system-prompt","user/xuanshu-consult","user/user","assistant/model"],"turnEnd":"[{\"turn\":1,\"reason\":{\"kind\":\"completed\"}}]","injectedMessages":1,"hasBaseOrMissingBase":true,"hasDigao":true,"hasPu":true,"hasMount":false}
{"stage":"second-turn-no-change","secondTurnEnded":true,"injectedMessages":1}
{"stage":"mount-added","mountTurnEnded":true,"injectedMessages":2,"lastHasMountContent":true,"lastHasDisclosure":true,"lastHasMaterial":false}
{"stage":"mount-removed","removeTurnEnded":true,"injectedMessages":3,"lastHasRetraction":true,"lastNamesIt":true}
{"stage":"after-restart-replay","replayTurnEnded":true,"injectedMessages":3,"materialStillPresent":true,"noNewInjection":true}
```

四行合起来说明四件事：① 材料**真的落进了日志**（`derivedMessages` 里那条 `user/xuanshu-consult`）且模型看得到；
② 材料**不重复发**（第二轮仍是 1 条）；③ 加挂载 → 补投它的正文与披露（2 条）；撤下 → 说一句「不再适用」（3 条）；
④ 换一台引擎重放日志（= 重启）再问，材料还在、且**不再多发**（R2 的机器证据）。


**复核自己那两个探针在本轮之后不再是判据**（如实交代）：`.scratch/review-a2-mount-probe.mjs` 读的是
旧字段（已随机制删除）、`.scratch/review-a2-spec-inbox-probe.mjs` 打的是 inbox 排队（已不用于投递）——
它们复跑会报错。同一批场景改由上面这条实装探针与断言台 `tests/consult/boundary.test.mjs` 覆盖
（R2 的恢复、R3 的重启 + 挂载、R4 的部分层失败 → 恢复各一条）。R1 那个探针
（`.scratch/review-a2-standards/probe-hook.mjs`）**原样复跑即可**，已复跑（见上表）。

**这一轮由两轴 code-review 抓出并当场修掉的三处**（都记在这儿，免得下一轮再犯）：

| 复核发现 | 处置 |
|---|---|
| **「不写会话日志」是错的**（规格轴 blocking）：`agent/pre-step` 返回的消息会被 loop **原样 append** 成 `user/message`（`:1061`），所以「每轮现算、不进日志」既不是事实、也会让 `hasLoggedContext` 这条门自我否掉 —— 第一轮之后它匹配到自己注入的那条，从此**整条会话不再补任何东西**（挂载也跟着死） | 交付模型改成「**落点是日志，只补缺的**」：材料按日志判据补一次、挂载按 `mountsInjected`（逐层）的变化补；缓存只记**肯定**的结论（`false` 不缓存，否则每轮重发一份材料）。探针改成跑真的一轮，直接观察 `deriveMessages()` |
| **老会话 + 挂载 = 旧病复发**（标准轴 HARD 2）：材料已在日志的会话整条跳过 ⇒ 「挂了却看不见」在旧会话上原地复活 | 材料与挂载**分开判**（材料缺席才发全量；否则只走挂载增量），补一条「老会话 + 挂了东西 → 只补挂载段」的用例 |
| 契约与实现不一致的三处小账：`inventory-gate.test.mjs` 头注释说「零 vitest」（新用例真跑 vitest）、`send.test.mjs` 留着一个没人用的 import、`inject.mjs` 导出了没人用的 `softGet` | 三条都按实际改（注释说清哪一条例外；删死 import 与死导出）。另补两条覆盖：**撤下挂载**的纯文本口径（R3/R4 之后曾被删掉且没补回）、`resolveHistoryBudget` 的同源口径 |


**这轮的边界与代价（如实登记）**：

- 材料是**会话开始时的那一份**：底稿在会话中途刷新（票 13 的定时任务）不会自动重发 —— 材料里给的是
  **文件路径**，要看最新版让模型自己去读；要一份新快照就开新会话。
- 每一问的第一步都要读一次旁挂清单（一个小 JSON），有挂载变化时再按预算读一次挂载内容；
  读取量由既有预算（`mounts/budget.mjs`）封顶。
- `mountsInjected` 是我们记的账，而「交付」发生在 loop 的 append 里：两者之间有极窄的窗口
  （写账 → 落日志）。进程恰好死在这中间时那一层会被当成「已交付」；再改一次挂载就会重新交付。
- 合参候选的历史窗口按**字**裁、按整条丢；预算未知（拿不到模型窗口）时**不裁**并如实写一句 ——
  与挂载预算同一套「不编数字」的口径。
- 复核报告里另有 **4 条上一轮就登记过的问题** —— 本轮把其中两条**顺手修了**（见下），
  另两条（日课生成链、工作流挂载占位）见各自小节。

**顺手修掉的两条上一轮遗留**（都不属于 R1–R5，但复核点名列在同一张表里）：

| 遗留项 | 处置与证据 |
|---|---|
| Standards 3/4：copy 安装漏运行时依赖 + 丢锁文件（`scripts/install-profile.mjs:159/166`） | copy 模式不再把自有包写成 `link:<仓库绝对路径>`，而是**物化进目标** `<target>/packages/<name>` + `file:./packages/<name>`；`pnpm-lock.yaml` 一并复制并只改写自有包路径。依据：`link:` 只建联接、**不装**被链接包自己的依赖（离网探针：目标里 `xs-fixture-runtime` 解析 `UNRESOLVED (MODULE_NOT_FOUND)`，仓库挪走后连插件文件都找不到），`file:` 则装齐且插件能加载。文件头本来就写着「copy（--copy，真分发包语义）」——自足是原文口径，不是这次新加的。回归：`tests/setup/install-profile-copy.test.mjs` 8 条（零 pnpm/零网络），同一份用例 **修复前 `8 tests \| 7 failed` → 修复后 `8 passed`**；pnpm 层证据在 `.scratch/install-fix/`（真 profile 离网 copy 装 526 包、`--frozen-lockfile` exit 0、锁文件 sha 不变）。断言台不跑真 pnpm 这条边界写进了 `tests/setup/README.md` |
| Spec 1：日课定时任务未接可执行生成链（`rikke/daily-tasks.mjs:142` 裸建 agent） | ① 142 行的裸建换成 `consult/agent.mjs` 的 `createConsultAgent` / `consultAgentCapability`（preset + 默认模型 + setup；缺服务或抛错时仍退回裸建并把理由进 `notes`）；② 生成链抽成**唯一一份** `lib/rikke/generate.mjs`（`generateRikke()`），`rikke.generate`（`manual:true`）与定时到点（`lib/rikke/delivery.mjs` 在 `agent/pre-step` 上跑，`manual:false`）走同一段代码；③ `RIKKE_PROMPT` 改成与事实一致（产物已由宿主生成）。回归：`tests/rikke/daily-chain.test.mjs` 9 条，**修复前 `9 failed`（`expected undefined to be 'standard'`、`agent/pre-step 上没有钩子`）→ 修复后 `9 passed`**；`tests/rikke` + `tests/digao` = `10 passed / 70 passed`。探针（真 Context + AgentLoop + 打桩 LLM）：`artifactExists:true, manual:false, horosaCalls:1`，普通一轮后仍 `horosaCallsAfter:1` |
| Spec 1 续：底稿 03:30 **同样**没有确定性链（只把 `DIGAO_PROMPT` 投进会话，而 `digao.json` 的 meta / 骨架渲染 / `condenseWithLlm` 只有宿主做得对） | 见「底稿到点」一段（同一轮收尾修） |

**底稿到点（Spec 1 的另一半）**：`digao.refresh` 的那条链同样抽成唯一一份（`lib/digao/generate.mjs`），
`delivery.mjs` 加认 `session-xs-digao-` + `source.kind === 'schedule'` + 第一步，跑同一条链、不依赖模型、永不抛；
`digao/service.mjs → rikke/daily-tasks.mjs` 的 import 环在这一步解开（共享常量挪到中立模块，环的解法写在文件头）。
回归与探针输出见 `tests/digao/*` 与 `.scratch/rikke-chain/`（Lead 已独立复跑 `tests/rikke` / `tests/digao`）。

**一条仍未修、且需要先做设计决定的**（复核报告里的 Spec 5）：**工作流挂载仍是占位**。
`mounts/content.mjs` 对 `kind:'workflow'` 返回带 `hint` 的空层，真话是「工作流内容的数据源属票 16，还没接上」——
而 `lib/workflow/store.mjs` 的工作流清单里**只有** `{schema, id, sessionId, name, createdAt, exportedAt?}`：
没有任何可注入的正文（没有 summary / 描述 / skill 路径字段）。要接上有两条候选路：
① 读该工作流**导出的 skill**（`<dshHome>/skills/<kebab>/SKILL.md`，但 kebab 名映射与「导出过没有」都没冻结）；
② 在工作流清单里加一个可注入字段（要动票 16 的 schema `xuanshu/workflow@1`）。
两条都要先落一个设计决定（客户端还缺「工作流选择」入口，需要 `workflow.list` 接到挂载抽屉）。
**本轮不编一个数据源**：编出来的内容会让「挂载了却没有任何工作流内容」这个真问题变成看不见的假问题。

### 13. 复核轮：`48e0e0a` 的 4 条发现（2026-10-16，全修）

复核报告入库在 `docs/reviews/spec001-48e0e0a-review.md`（结论：本轮不通过；Standards 2 条 + Spec 2 条）。
四条都是真的，逐条处置如下（每条的**复核探针复跑**结果也一并记上）。

| # | 复核实测的发现 | 处置 |
|---|---|---|
| N1 | **清单门仍漏两类**：① 同文件里「一条已知红断言 + 另一个 describe 的 hook 抛错」—— 旧判据要求「没有任何失败断言」才记文件级失败，于是这一类整个漏掉；② **未处理错误**：断言全绿、`success` 仍是 `true`、0 条失败 —— JSON 报告里根本没有它 | ① `suiteFailures` 的判据改成「文件 `failed` 且（没有失败断言 **或** 有用例没跑起来）」；② 门改成**两路 reporter**（`json` 写报告 + `default` 写 stdout 并被抓下来回放）：未处理错误只出现在 reporter 文本的 `⎯⎯ Unhandled Errors ⎯⎯` 段与 `Errors N error` 汇总行里，`detectUnhandledErrors()` 认出它 → `current.unhandledErrors` **独立占一条判据**（已知红不能替它背书）；退出码仍保留为「一条失败都核不出来」时的兜底。回归：合成 4 条 + **真 vitest 跑三个夹具**（`tests/lib/fixtures/inventory-hook/`：纯 hook / 已知红并存 / 未处理错误） |
| N2 | **`--force` 清骨架时沿 `packages` 根联接删除真实文件**：`readdirSync` 跟随联接 ⇒「里面全是自有包名」这条守卫在**联接目标**上成立 ⇒ 递归删掉真实内容，安装器还 exit 0 | `removeOwnPackagesDir` 与 `removeTreeNoFollow` 都**先 lstat 根**：根是联接就只拆联接本身（一个字节都不跟着走）。回归：`tests/setup/install-profile-copy.test.mjs` 第 ⑨ 条（联接目标里的哨兵必须活着） |
| N3 | **挂载交付账在实际落日志前就前移**：`prepareRequest` 失败（`INVALID_CONFIG` / `UNKNOWN_MODEL` 是常态路径）时消息没 append，账却已写 ⇒ 那一层**永远**不再补 | 判断改以**日志**为准：边界扫日志收集 `【来源：挂载 …】` 标记，账（`mountsInjected`，条目带 `head`）只提供「这一层对应的标记是什么」；标记不在日志 ⇒ 下一问重投。顺带修掉连带病症：工作流挂载（`kept:false` 但有 hint）现在**单独成块**并带标记，不再「永远不算交付、每问重投同一段披露」；两层 `head` 撞车（两个工作区 id 指向同一路径、同名）时预览层给 head 补上层的 id，否则第二层会被当成「已交付」永不投递 |
| N4 | **改选 / 否决后的旧采用稿仍进候选历史**：日志是追加式的，两份采用稿都在里面；旧投影只看 `source.kind` | 新增**跨轮** `draftLedger`（采纳与否决各追加一条、都带 `runId`；新 run 的记录**继承**上一份的账本），`currentAdoptedMessageIds()` 取「最后一条其所属轮次**没有被否决**的 adopted」；`projectConsultMessages(snapshot, { keepAdoptedIds })` 按 messageId 过滤；判不出来时 `null` = **不过滤**。**否决按轮生效**（本轮否决只抹本轮的采用稿 —— 复核实测指出原实现会连带抹掉上一轮已采用、仍在日志里的那份）；另加两道闸：对**被取代的旧轮**迟到拍板直接拒绝（否则旧记录会把新一轮连账本一起盖掉） |

**复核自己的探针复跑（全部转绿）**：

```
# N1（.scratch/review-48-standards/probe-inventory.mjs + .scratch/review-48-fix/probe-unhandled-exitcode.mjs）
mixed:      suiteFailures 1（"…另有 1 条用例没跑起来"）  violations 1  known 仍豁免那条已知红
unhandled:  JSON 报告里看不出来（success=true、0 失败）→ 门靠 reporter 文本里的 Unhandled Errors 段
            独立报出来（已知红并存时也报）；退出码路径作为兜底另有取证
# N2（同目录 probe-install-junction.mjs）
before=true → after=true（修复前 after=false）；exit 0、目标照常换成源 profile 联接
# N3/N4（.scratch/review-48-spec/probe.mjs，真 Context + AgentLoop + 打桩 LLM）
prepare-failure:   markedDelivered 有值、mountInLog=false（账仍在 append 之前写，如实保留）
model-recovered:   mountInLog=true、injectedMessages=2（**下一问重投** —— 修复前恒为 false）
reselected-history: obsoleteChoiceInHistory=false、currentChoiceInHistory=true
rejected-history:   两稿都 false
```

**仍然留着的边界（如实登记）**：账依旧在 append 之前写 —— 「这一问失败、账已写」的中间态在同一问内可见
（探针第一行就是它），由**下一问自愈**，不是永久丢失；账单判据要**扫一遍会话日志**（每一问的第一步，
只取我们那两类消息的正文），这是「与日志对账」的价格；未处理错误的识别认的是 **reporter 的打印文本**
（`Unhandled Errors` / `Errors N error`）—— 那是上游格式，所以只在钉版（ADR-0004）上成立，
`tests/lib/inventory-gate.test.mjs` 有一条真 vitest 夹具钉着它，换版本时要跟着复核；清单门判据 4 会把
**刻意跳过**（`it.skipIf`）也算进「没跑起来的用例」，所以「同一文件既有已知红断言、又有刻意跳过」会误红 ——
遇上了把两者拆开，别放宽判据（漏报 hook 错误比误红一次贵得多，理由写在 `scripts/lib/inventory-gate.mjs`
的判据注释里）。

**工作流挂载**：N3 的连带修复治好了它的两个可见病症（hint 单独成块 + 不再每问重投），
但「没有可注入的数据源」这条仍在（见上一节）。

## 验证边界

### 14. 复核轮：`32216d9` 的 5 条发现（2026-10-16，全修）

本节及其「追加复核」保留当轮证据；清单门错误采集、挂载失败恢复与合参并发的现行实现以 §15 为准。

复核报告入库在 `docs/reviews/spec001-32216d9-review.md`（结论：本轮不通过；Standards 1 条 P1 + Spec 4 条 P2）。
它写的每一处都是真的，逐条处置如下；**§13 里与本节冲突的说法以本节为准**。

| # | 复核实测的发现 | 处置 |
|---|---|---|
| R1 | **清单门仍会假绿**：`afterAll` 在断言全部跑完之后抛错 ⇒ 文件里有失败断言（已知红）、跳过 0 条 ⇒ 旧判据「没有失败断言 **或** 有 skipped」两条都不成立，`suiteFailures` 为空而退出码兜底又被已有失败断言挡住 | `collectReport` 的判据加第三类证据：**文件 `failed` 且文件级 `result.message` 非空** ⇒ 进 `suiteFailures`。依据是实测的报告形状：`afterAll` 抛错时 `message='NEW_AFTER_ALL_ERROR'`（`.scratch/review-322-standards/after-all-report.json`），而**纯断言失败时它是空串**（同目录 `mixed-report.json`、本仓 `assembly-contract.test.mjs` 的真实报告）。回归：新增真 vitest 夹具 `tests/lib/fixtures/inventory-hook/after-all.fixture.mjs`（一条已知红 + `afterAll` 抛错）+ 2 条合成报告用例（含「空串 / 字段缺失不误报」），真 vitest 那条用例从两夹具扩到三夹具（**收紧**，不是放宽） |
| R2 | **整场会话最多留一稿**：`currentAdoptedMessageIds()` 从账本末尾找到**第一条** adopted 就返回单个 id ⇒ 两个独立合参轮次各自采用一份时，候选历史只带得回最后那一份 | 判据改成**按 `runId` 分组、每组只看最后一个决定**，各轮有效采用的**并集**就是当前采用稿集合（S9:77「采用稿是这一轮在会话流里的正式输出」） |
| R3 | **同轮否决后重新采用仍被排除**：`rejectedRuns` 把「曾经出现过 rejected 的 run」永久排除，没看该轮之后的新采用决定 | 同一处改写顺带修掉：「曾经被否决」≠「这轮不作数」，只按**每组最后一条**决定判（S9:169 / ADR-0010:18「只放 adoptedId 指向的那一份」）。同轮 `c1 → reject → c2` 现在返回 c2 |
| R4 | **旧记录未迁移**：上一版 `xuanshu/bestof@1` 只有 `deliveries / adoptedId / rejected`，启动新 run 时被 `draftLedger: []` 覆盖 ⇒ 旧轮采用关系丢失，第二个新 run 起过滤返回 `null`、旧采用稿重新混入候选 | 新增 `migrateLegacyDecisions(record)` + 哨兵 `BESTOF_LEGACY_RUN_ID='legacy'`，在 `bestof.run` **覆盖写之前**把可判定的旧决策合成一条归属「旧轮」的条目（adopted 条目带旧投递的 `messageId`；判不出采用时落 `rejected` 哨兵 —— 见下面「追加复核」的 SP-2）。幂等性靠结构保证：账本**非空**时原样返回（引用），重复迁移不会多条目。**能保住的只有「可判定为 adopted」这一支**：`adoptedId` 有投递凭据那种记录，迁移后旧采用稿仍算当前；被否决 / 投递凭据找不到的旧记录只剩「这一轮不作数」，覆盖写之后无法复原（老 fallback 只在**账本长度为零**时生效） |
| R5 | **挂载撤下与重新挂上的失败恢复仍漏投**：① 撤下项在撤下声明落日志**之前**就被从账里删掉 ⇒ `prepareCall` 失败后没有重试依据；② 重挂后「已交付」仍按 `【来源：挂载 <head>】` 标记判，而标记只由 `head` 决定 ⇒ 第一次挂载留下的旧标记冒充本次回执，新版工作区内容永不补投 | 交付账条目加**本次交付回执**：`receipt` / `withdrawal` = **承载这一轮交付 / 撤下声明的那条会话消息 id**（边界用 `createConsultContextMessage()` 的 `message.id` 盖章，`scanLog()` 顺带收集日志里注入消息的 id）。判据：有条目带 `receipt` ⇒ 只看该 id 在不在日志（**旧标记不算数**）；**老条目**（无 `receipt`）退回标记对账（升级不许每问重投）。撤下声明在日志确认**之前条目留着**并每问重发，确认后才清；撤下声明发过之后又挂回来 = 新一次交付（补投当前内容）。**没有可见文案改动**：`context.mjs` / `message.mjs` 零改动，仍只用 `【来源：挂载 …】` / `【来源：临时挂载·撤下】`（`receipt` 不写进消息 `source` 元数据，只用消息 id 对账） |

**R2–R4 的一处语义后果（消费方要跟着看）**：当前采用稿从「全场一份」变成「**各轮各一份**」——
`currentAdoptedMessageIds()` 返回的是集合。`history.mjs` 的候选历史投影按 messageId 过滤，语义正好；
而 **S7 回看按「一条采用稿」呈现**的展示口径（`bestof-store.mjs` 文件头与 ADR-0010 第 4 条那句
「一层会话只留最后一次合参」）指的是**旁挂记录**的覆盖写，不是候选历史的携带范围 —— 旁挂记录仍一份，
改的是「哪些已采用消息算当前」。客户端展示未改（本轮的验证边界见下）。

**同一轮里附带修掉的一处基线竞态（R2–R4 排查时实测到，如实登记）**：
上一轮 `bestof.run` 的 `execute` 还在后台跑时，它收尾 / 流式回填会把**陈旧记录**写回盘，
盖掉新一轮的 `runId` 与采用稿账本，随后 `bestof.adopt` 的取代判据误报「已经被更新的一轮取代」
（`tests/consult/bestof-adopt.test.mjs:141` 那条用例因此**在基线就偶发红**）。
修法：`createBestOfMethods` 内加 `currentRun = Map<sessionId, runId>`，`persist()` 在「我不是当前轮」时不写；
`bestof.run` 在**首次落盘成功之后**才认下自己是当前轮。
判据是**逻辑先后**，不是「此刻盘上是谁」（判盘面会和后台写抢同一瞬间）。
**它超出 R2–R4 的字面范围，单独记在这里，便于下一轮复核单独处置**；它自己在独立复核里又被追出两条
（见下面「追加复核」的 ST-1/SP-1），修法与测据一并记在那里。

## 追加复核：独立复核者对本轮修复的第二轮审查（2026-10-16 深夜，全修）

上面五条修完之后，另起一个独立复核上下文（只读、复跑三个探针 + 全量清单门 + 自写对抗探针）审了工作区 diff。
它确认**五个原始反例全部真的关掉了**（复跑数字与本节各表逐字一致），但追出五条**未闭合路径**与五处
「实现 ↔ 文档」不一致。逐条处置如下（这才是本节的最终形态；上面 R4 行与 ADR-0012 的措辞都已按这里的结论改过）。

| # | 独立复核的发现 | 处置 |
|---|---|---|
| SP-1 | **`persist()` 静默丢弃整次写，调用方却拿到「成功」**（Standards P1，本轮新引入）：被取代那一轮的写被整次丢掉（连 `bestof.adopt` 的落盘也丢）——API 报「已采用」、采用稿也真进了会话日志，但盘上逐字节未变；下一轮读盘时账本里没有这条 adopted，候选历史会把刚投的那份当非当前过滤掉。触发面 =「盘面 ≠ 内存当前轮」（新一轮首次落盘失败 / 两个宿主实例共用 dataDir） | 三条一起改：① `persist()` **返回这次到底写了没有**；② `bestof.run` 改成**落盘成功之后**才 `currentRun.set`（那一次抛错时旧轮仍是当前轮，盘面与「当前轮」不会分叉）；③ `bestof.adopt` / `bestof.cancel` 增加**内存判据的取代闸**（`hasNewerRun()`，与原有「读盘面判取代」配对），并在 `adopt` 里**投递之前**判 `persist()` 的返回值 —— 不落盘就抛可读错误，绝不静默报成功。回归：`bestof-adopt.test.mjs` 新增一条（旧轮的 adopt / cancel 都拒绝、盘面仍是新一轮、当前轮的拍板照常成功） |
| SP-2 | **R4 只闭合了「可判定为 adopted」的旧记录**（Spec P2）：上一版「先采用 c1、再否决」是合法记录（`adoptedId=null; rejected=true` 且不清 `deliveries`），迁移返回**空账本** ⇒ 覆盖写后消费方退回「不过滤」⇒ **第二个新 run 起旧稿重新混入**（与 R4 同形，形状换成 rejected） | `migrateLegacyDecisions` 在「本轮被否决」与「`adoptedId` 找不到投递」两种形状上落 `{kind:'rejected', runId:'legacy'}` 哨兵（**不是**空账本）：语义与迁移前一致（该轮不作数），不会翻转成「不过滤」。回归：`bestof-store.test.mjs` 哨兵形状 + `bestof-history.test.mjs` 一条端到端（老记录 `rejected:true` + 日志里有旧稿 ⇒ 两个新 run 的候选 prompt 都不含旧稿） |
| SP-3 | **无 `runId` 的条目被折成同一轮**（Spec P2）：注释写「不让它们互相顶掉」，代码是 `Map.set` ⇒ 后一条顶掉前一条，**静默丢一份采用稿**（正是 R2 要修的方向） | 无 `runId` 的条目**各自成轮**（`\0keyless-<n>`），注释与代码对齐。回归：两条无 `runId` 的 adopted ⇒ 两份都算数；无 `runId` 的 adopted + rejected ⇒ 只抹自己那一条 |
| SP-4 | **`draftLedger: []` 被当成「已经迁移过」**（Spec P3）：该形状在现版本内可产生（`adopt` 先落盘、`deliverAdopted` 随后抛错），空数组会让那次采用在覆盖写后彻底丢失 | 「已经迁移过」的判据改成**账本非空**（`length > 0`）；空数组继续走老字段合成。回归：`{draftLedger: [], adoptedId:'c2', deliveries:[…]}` 迁出 adopted 条目 |
| SP-5 | `deliveryConfirmed` 有条目带 `receipt` 时**只看消息 id**、不退回标记（Spec P3，只有代码阅读证据）：若「id 缺失而标记正文仍在」，多投之外还可能把「已撤下」条目当「没交付过」直接清掉 | **无法在钉版 rc.2 造出该状态**（复核者查了 `dsh-session` 实装：`snapshotEvents()` 返回全量 `this.log`，全仓只有 `push`、没有截断；`scanLog` 对同一事件同时取 id 与正文，要缺就一起缺）。本轮**不改判据**，把这条作为「钉版约束」登记：换 DSH 版本时要连同 `detectUnhandledErrors` / 清单门第三类证据一起复核 |
| ST-1 | 清单门第三类证据（文件级 `message` 非空）的**误红代价只写在台账里、没写在判据旁边**（Standards P3） | 把代价写进 `scripts/lib/inventory-gate.mjs` 判据 4 的注释：① `it.skipIf` 会误红；② 认的是上游 reporter 形状、只在钉版成立，换版本要复核；并写明「已知红文件将来带上非空 message 会从放过变违规」是**刻意的失败方向** |

**独立复核者的复跑数字（本节据此确认，不采信实现者的转述）**：全量清单门 exit 0
（`1134 条（基线 1134）/ 104 文件 / 失败 2 条（已知红 2 条）/ 文件级失败 0 个 / 跳过 10 条` —— 该数字是**追加复核那一刻**的快照；
复核之后 Lead 又按它的 SP 条目补了 5 条用例，最终计数见下面「本节改动的用例账」）；
三个探针的 after-all / 四个 stage / 两组 mounts 字段与本节各表逐字一致；`git show HEAD:tests/test-inventory.json`
对账 = boundary 21→25、bestof-store **6→14**、bestof-history 10→11、inventory-gate 20→22（+15，`knownRed` 未改）；
`.scratch/test-inventory-report.json` 里唯一 `status:'failed'` 的文件 `assembly-contract.test.mjs` 的**文件级 message 是空串**
⇒ 第三类证据今天不误红。它另外用四个对抗夹具证明「断言失败 + 未处理错误」**不会**让文件级 message 变非空
（即新判据不会被那一类误触发）。

**独立复核者无法验证的边界（照录，别当成已验）**：真实模型的端到端与 S7 回看渲染（R2–R4 把「当前采用稿」
从 1 份改成 N 份，**客户端展示是必须补的验收项**，不是注脚）；「干净无 profile」的全仓矩阵；`verify:assembly`
（S1/S2–S5 未独立复核）；`currentRun` 在多宿主实例下的行为（进程内 Map，两个实例互不知情）；旧客户端对
旁挂清单新字段（`receipt` / `withdrawal`）严格 schema 校验的可能性。

**复核自己的三个探针在修复后原样复跑（全部转绿）**：

```
# ① .scratch/review-322-standards/probe.mjs（清单门）
after-all:  suiteFailures 1（message="NEW_AFTER_ALL_ERROR"、skippedAssertions 0）
            → violations 1（文件级失败）· 那条已知红照旧豁免   （修复前 violations=[]）
mixed / unhandled 两行与改前一致（未回归）
# ② .scratch/review-322-spec/probe.mjs（采用稿历史）
readopt-after-reject:  adoptedId=c2 / delivery.ok=true / candidateHasReadopted=true
two-adopted-runs:      promptHasFirstRun=true / promptHasSecondRun=true（修复前 false/true）
legacy-upgrade:        firstHasObsolete=false / firstHasCurrent=true
                       secondHasObsolete=false / secondHasCurrent=true（修复前 true/true）
two-clean-adopted-runs: 两轮都在
# ③ .scratch/review-322-mounts-probe.mjs（真 rc.2 Loop + 真 consult.setMounts）
withdrawal-failure:  originalAddRecovered=true / withdrawalInLog=true（修复前 false）
                     账在撤下失败时保留：{..., withdrawal:"<msgId>"}
remount-failure:     originalAddRecovered=true / withdrawalInLog=true /
                     updatedRemountInLog=true（修复前 false）
```

**一条操作陷阱（本轮实测踩到，代价是三名实现者的探针结论一度无效）**：
`install-profile.mjs` 把自有插件包**逐文件拷进** `$DSH_HOME/profiles/<name>/node_modules/`，
而 `.dsh-home/profiles/xuanshu/node_modules/xuanshu-host` 是一个指向**仓库 `profile/`** 的目录联接，
`profile/` 里那份是**拷贝**。于是**改完 `packages/xuanshu-host/lib/**` 必须先跑
`node scripts/install-profile.mjs --home .dsh-home`**，否则所有「真 Loop 探针」跑的还是旧副本
（症状极其安静：探针照常输出、数字却是修复前的）。本轮实测：同步前 `profile` 与 `packages` 的
`inject.mjs` / `bestof-store.mjs` 哈希不同（`install-profile` 报「同步了 5 个文件」），
同步后三个探针的结论才可信。**这与 §「三条会让『没验』伪装成『验过』的操作陷阱」第 1 条（merge 之后必须重跑安装器）
是同一类，但触发条件更宽：不只是 merge，任何改自有包源码之后都要重跑。**

**CI 转绿的收尾（`b6265a0` 之后的同一轮，2026-10-17）**：把 tip 推到 origin 后 CI `verify` 红，
但它红的三条与 F1–F4 都无关 —— 全是「开发机装了 profile / 装了 uvx，CI 上没装」的环境依赖。
清单门抓到的正是它自己设计要抓的形状（用例从 1147 静默掉到 1132）：

| 症状 | 根因 | 处置 |
|---|---|---|
| `p2-single-source` / `p5-static-mount` **收集到 0 条**（`Cannot find module 'yaml'`），15 条用例从总数里消失 | `tests/horosa/lib/yaml.mjs` 只从 `profile/package.json` 解析 `yaml`，而那棵树要跑过 `setup` 才有 | `yaml` 进仓库根 `devDependencies`（`^2.9.1`）；`lib/yaml.mjs` 改成**先试仓库根再兜底 profile**；`p2` 加一条守卫（根 package.json 必须声明 `yaml`） |
| `tests/cang/service.test.mjs` 红 | 原生适配器只从 `profile/package.json` 解析 `@deepseek-ai/dsh-native-command` | 同款：进根 `devDependencies`（钉版 `0.2.0-rc.2`）；`nativeAnchors()` 先试仓库根；新增一条「profile 指向不存在目录也能打开」的用例 + 一条依赖声明守卫 |
| `report-and-gates` 的「取件失败」断言 exit 2 却拿到 exit 3 | 那条用例 `env: {}` ⇒ **继承开发机 PATH**；本机有 uvx 才走到取件步，干净 CI 上更早的 `uvx 环境门` 先失败。**非 hermetic 的断言** | 用契约 §10 的注入口 `XUANSHU_UVX_BIN: FAKE_UVX` 让 gate 确定性通过（假 uvx `--version` 回 `uv 0.12.10`）；断言点因此与机器装没装 uv 无关 |

净增 **3 条**守卫用例（`cang` +2 / `p2` +1），基线 1147 → **1150**，`knownRed` 未改。
本地复验：`pnpm verify:all` exit 0（1150 / 104 文件 / 2 条已知红 / 0 文件级失败）；
`pnpm verify:assembly` S2–S5 PASS、S1 FAIL（既有 rc.2 carrier 问题）。**CI 转绿由下一次运行确认。**

**本节改动的用例账**（`tests/test-inventory.json` 已按下面刷新；**这里的数字以追加复核后的工作区为准**）：

```
[inventory] 用例 1150 条（基线 1150）/ 文件 104 个 / 失败 2 条（已知红 2 条） / 文件级失败 0 个 / 跳过 10 条 / vitest exit 1
[inventory] 通过：没有用例消失、没有已知红之外的失败、没有文件级失败。
```

1119 → 1150（**+31 条**，全为回归覆盖，无删除，`knownRed` 未改）：`tests/consult/boundary.test.mjs` 21 → 25（+4）、
`tests/consult/bestof-store.test.mjs` 6 → 17（+11）、`tests/consult/bestof-history.test.mjs` 10 → 12（+2）、
`tests/consult/bestof-adopt.test.mjs` 20 → 21（+1）、`tests/lib/inventory-gate.test.mjs` 20 → 22（+2）、
`tests/cang/service.test.mjs` 1 → 3（+2，CI 解析根守卫）、`tests/horosa/p2-single-source.test.mjs` 9 → 10（+1，`yaml` 根依赖守卫）、
`tests/consult/history.test.mjs` 21 → 21（0）；
新增夹具 `tests/lib/fixtures/inventory-hook/after-all.fixture.mjs` 不计入（刻意不叫 `.test.mjs`，只由夹具 config 收）。
2 条已知红仍是 S1 装配树与连带的 CLI 全绿断言（理由见下）。

**本节修复后的边界与代价（如实登记）**：

- R1 的第三类证据依赖**上游 reporter 形状**（`afterAll` 时文件级 `message` 非空）：与
  `detectUnhandledErrors()` 一样只在钉版（ADR-0004）上成立，`tests/lib/inventory-gate.test.mjs` 的真 vitest 用例钉着它 ——
  **换 vitest 版本时这两条判据要一起复核**。另一面：若某个**已登记已知红**的文件将来带上非空文件级 `message`
  （上游改了报告形状），它会从「放过」变成「文件级失败」违规 —— 这是**刻意的**方向（宁可让人去看一眼，
  也不许把 hook 错误当已知红放过去），真遇上就按注释里的两条路处置（拆文件 / 先修掉已知红），别放宽判据。
- R5 的凭据是**会话消息 id**：追加复核查过钉版实装（`dsh-session` 的 `snapshotEvents()` 返回全量 `this.log`，
  全仓只有 `push`、没有截断）——**正常路径上日志不压缩**，所以「凭据凭空消失」不是本钉版的现实代价。
  真要出现「id 缺失而正文标记仍在」（当前造不出），方向是**多投**（`deliveryConfirmed` 只看 id 在不在），
  对「已撤下」条目也会因为 `retracted()` 为假而**保留条目并重发撤下声明**；`withdrawal` 若从未成功落盘，
  条目同样留着重试（复核 32216d9 追加复核的 SP-5 已按此口径核对，未改判据）。
  挂载期间工作区内容变化仍**不**重投（只在「重挂」时补投当前内容），这是票 12 / ADR-0012 的既有口径。
- R2–R4 的迁移只恢复「上一版记录自己那一轮」的采用关系（旧记录没有 `runId`，跨轮信息本来就不可复原）；
  可判定的旧决策有两种落法：`adoptedId` 能找到投递凭据 ⇒ 合成 adopted 条目；被否决或找不到凭据 ⇒
  合成 `rejected` 哨兵（该轮不作数）。哨兵 `'legacy'` 是常量，不在 `newRunId()` 的 `bestof-<uuid>` 形态里，
  不会与真轮次撞名。
- 本轮**未**做客户端 / UI 端到端验收（探针是打桩 LLM 的 Loop 级与断言台）。**R2–R4 把「当前采用稿」从 1 份
  改成 N 份，所以 S7 回看逐条渲染多份采用稿是必须补的验收项，不是注脚**（客户端展示未改、未验）。
  `currentRun` 守卫是**进程内** Map：两个宿主实例共用同一个 `dataDir` 时互不知情（与基线同类，未构造该现场）。
  本轮也未重跑「干净无 profile」的全仓矩阵（上一轮的数字见 §13）。

### 15. 复核轮：`4b3c2a3` 的 F1–F4（2026-10-17，全修）

原报告：`docs/reviews/spec001-4b3c2a3-review.md`。四条原始反例均先跑红，再补实现与回归用例；
独立 Standards / Spec 复核各 0 条新发现。

| # | 修复与现行判据 | 验证 |
|---|---|---|
| F1 | 生产清单 runner 同时采集 JSON 断言报告和自有 Vitest reporter 的结构化错误报告；后者通过 `module.errors()` / `allSuites().errors()` 独立采 hook / suite 错误及未处理错误，消息为空也计错。报告缺失、过期或文件覆盖不全一律拒绝。生产判定不再依赖文件级 `message` 非空或终端文本；旧 JSON 形状兼容仅用于直接调用 `collectReport` 的历史测试 | 空消息 `afterAll` + 已知失败确实违规；已知失败 + 主动跳过正常豁免。真实夹具及报告缺失 / 过期 / 不完整回归均通过 |
| F2 | 重挂投递未确认时，交付账额外保留一份平面的 `previousDelivery`，保存此前已交付且尚未撤回的凭据；新版确认后清快照、撤下确认后清条目。重挂读取失败也保留旧条目 | 真 rc.2 Loop 重跑「挂载成功 → 撤下失败 → 重挂失败 → 再撤下」：撤下声明进入日志，最终账清空；边界回归另覆盖重挂读取失败 |
| F3 | 新 `bestof.run` 的首次 `store.write` 直接写盘，成功后才发布内存记录与 `currentRun`；旧轮后台回填继续走守卫 | 第二轮受理后、候选首块前，盘上已是第二轮，新 API 实例按该 `runId` 冷读成功 |
| F4 | 同一会话的受理、采用 / 合并（含投递和最终记账）、停止按调用顺序排队，前一个失败也释放队列；候选生成仍在后台，不同会话互不阻塞。采用投递后的持久化返回值也必须检查 | c2 冷恢复等待时启动新轮，新轮在采用完成后继承 c2 账；候选包含 c2、不含旧 c1。独立探针补验 merge 排队、异会话完成、失败释放及旧 cancel 不覆盖新轮 |

证据保留在 `.scratch/review-4b-standards/`、`.scratch/review-4b-spec-mount-data-MXJq4N/`、
`.scratch/fix-f-persist-data-7NRMXP/`、`.scratch/review-f-spec-queue-data-qTs8Fo/`。
四个相关测试文件合计 **88 passed**；独立 Standards 另跑清单门文件 **26 passed**。
用例增量为 inventory-gate +4 / boundary +2 / bestof-adopt +1 / bestof-history +1，未修改 `knownRed`。
宿主副本已用 `node scripts/install-profile.mjs --home .dsh-home --skip-install` 同步。

代价与边界：同会话的慢采用 / 合并会让后续状态操作等待；队列属于单个 `createBestOfMethods` 实例，
没有提供跨进程锁。`previousDelivery` 最多一份、不会递归增长。未做真实模型或 UI 端到端验收，
未重跑干净无 profile 全仓矩阵；S7 多采用稿回看验收仍待补。升级 Vitest 时须复核 reporter API 与真实错误夹具。

完整装配五条 seam 的当前结果：S2（进程内启动）、S3（客户端产物）、S4（上游行基线）、S5（真实 CLI 报告）通过；
**S1 schema 导出失败**。

失败来自钉版 `@deepseek-ai/dsh-app-boot@0.2.0-rc.2`：它的 schema 导出器只接受 native group/include carrier，
而同版本官方 web bundle 自带的 `@deepseek-ai/dsh-agent-preset` 是另一种 carrier，报
`unrecognized Loader tree carrier`。真实 web 与宿主启动正常。测试保留失败，无上游源码改动、无放宽断言。

当前全仓基线（`pnpm verify:all` 中的清单门，2026-10-17 F1–F4 修复 + CI 转绿收尾之后，整体 exit 0）：

```
[inventory] 用例 1150 条（基线 1150）/ 文件 104 个 / 失败 2 条（已知红 2 条） / 文件级失败 0 个 / 跳过 10 条 / vitest exit 1
[inventory] 通过：没有用例消失、没有已知红之外的失败、没有文件级失败。
```

2 条失败 = **S1 装配树** 与由它连带的 **CLI 退出码为 0**（就是基线 `knownRed` 里那两条，理由见上）。
跳过的 10 条 = `tests/horosa/p0-fixtures` 2 条（`.scratch` 里的 `gt06-*` 原始捕获仍缺）+ `tests/horosa/p10-e2e` 8 条
（真机前置件不在）。**同一条命令在「没有 profile」的干净环境里也必须给出同样的条数并判过**
（2026-10-17 实测：`XUANSHU_DSH_HOME` 指向空目录时 1150 条 / 0 失败 / 51 跳过 / exit 0；
CI 上 profile 本来就不存在，见 §14 的「CI 转绿的收尾」—— 那三条环境依赖就是在这条判据上暴露的）
—— 这就是 §11 ② 的机器判据；

「干净环境」用 `XUANSHU_DSH_HOME` 指向一个空目录来模拟（CI 上那个目录本来就不存在）。
**基线之外的红色一律是本轮引入的回归。**
（历史：票 08 后 448 passed；票 10/13 后 684；票 11/12/15/16 后 992；code-review 修复后 1020；
清理轮 +3 条用例，并把两处「证据没了」从「静默跳过 / 不收集」顶成红；评审修复轮 +24 条用例、新增
`tests/lib/inventory-gate.test.mjs` 一个文件，并把 5 个测试文件的条数与环境解耦；复核修复轮 **+40 条用例**
（1057 → 1097）：新增 `tests/consult/boundary.test.mjs` 18 条、`tests/lib/fixtures/inventory-hook/`（真 vitest 夹具）、
`tests/setup/install-profile-copy.test.mjs` 8 条、`tests/rikke/daily-chain.test.mjs` 9 条、`tests/digao/daily-chain.test.mjs` 6 条，
以及 history +5 / inventory-gate +4 / bestof-run +1 / mounts-preview +1；同时据实删掉 12 条「验旧注入机制」的用例
（`send` 6 条 / `mounts-inject` 6 条），其覆盖搬到边界用例 —— 所以 `--update` 时那两处「用例变少」
是**有意的**，理由写在提交信息与本节。二次复核修复轮 + 追加复核修复 **+20 条用例**（1119 → 1139，见 §14 的用例账：
boundary +4 / bestof-store +11 / bestof-history +2 / bestof-adopt +1 / inventory-gate +2，另有 1 个真 vitest 夹具文件不计入）；
F1–F4 修复轮 **+8 条**（1139 → 1147，见 §15）；**CI 转绿收尾 +3 条**（1147 → 1150，见 §14 的「CI 转绿的收尾」：
cang +2 解析根守卫 / p2 +1 根依赖守卫）。文件数与 `knownRed` 全程不变。）

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
   **触发条件比「merge」更宽（复核 32216d9 修复轮实测踩到）**：自有插件包是**逐文件拷进** profile 的
   （`profile/node_modules/<name>` 不是联接，`.dsh-home/profiles/xuanshu/node_modules/<name>` 才是联接），
   所以**任何改完 `packages/xuanshu-host/lib/**` 或 `packages/xuanshu-client/**` 之后**都要重跑安装器 ——
   否则所有「真 Loop 探针」跑的还是旧副本，而症状极其安静：探针照常输出、数字却是修复前的
   （本轮三名实现者的探针结论因此一度无效，同步时报「同步了 5 个文件」）。
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

### 16. Spec 002「住进去」：10 张票全部实现（2026-10-17）

规格 `docs/specs/002-reside-and-use.md`，父 issue [#21](https://github.com/buyou-claw/xuanshu/issues/21)，
集成分支 **`feat/spec-002-integration`**（从 `main` 09951eb 起，10 张票各自 worktree/分支 → Lead 合并），
草稿 PR [#32](https://github.com/buyou-claw/xuanshu/pull/32) 承载（Closes #21 + #22–#31）。
形态决策：ADR-0013（事记 = 底稿第四来源）、ADR-0014（玄枢自己的桌面壳与 home，与 DSH 桌面版零交集）。

实现完成后按 `code-review` 技能跑了两轴（**Standards** / **Spec**，各自独立上下文、不合并排序），
共 12 条发现（3 硬违规 + 4 判断项 + 5 规格项），全部在 **t32 复核修复轮**落成代码与用例：
宿主 home/dataDir 收成**一份实现**（`lib/home.mjs`，含 real-`~/.dsh` 拒绝与扫描根）、壳的入口判断抽到
有测试的 `main-flow.mjs`、`runTouchChain` 去重、`routes.list` 把未知默认路由改成 `null`、
`设置 → 事记`（恢复墓碑 / 排除目录）与 `设置` 里的关窗行为/开机自启（显示**实际生效方式**）、
点通知落 overview 的 `#xuanshu-overview` 通道、`rikke.status` 未读只数日课。修复后用例 1676 → 1761。

#### 16.1 票 → issue → 交付面

| 票 | issue | 交付面（宿主 / 客户端 / 其他） |
|---|---|---|
| 01 独立 home 与隔离体检 | #22 | 解析唯一来源 `scripts/isolation/resolve.mjs`（产品 `~/.xuanshu` / 开发 `<repo>/.dsh-home`，`XUANSHU_DSH_HOME` 覆盖）；宿主新增 `lib/home.mjs` 收口 7 处 `~/.dsh` 兜底并**拒绝**写真实 home；`verify:isolation` 的 `home-isolated` 加「两档默认 home 都不是 `~/.dsh`」；新 runbook `docs/runbook/home.md` |
| 02 桌面壳 | #23 | 新包 `packages/xuanshu-shell`（窗口 / 托盘 / 关窗隐藏 / 真退 / 单实例 / 子进程看护与重启 / 自启 / 通知端点 / 看门狗），14 个纯模块 + 唯一 `electron-adapter.mjs`；`docs/runbook/shell.md` |
| 03 早间触达 | #24 | 日课 AI 段三态（`ai:{mode:'ok'\|'off'\|'failed'}`，确定性三键永不受影响）；`lib/notify/**` 回环通知 + `traffic.jsonl` 触达账；`rikke.status` 加性 `ai/unread/notify`；卡/面板两段式 + 设置两项开关 |
| 04 晚间触达 | #25 | 晚省 `<dataDir>/wansheng/<date>.json`（**零模型调用**的确定性事实）+ 第三条 daily 21:30；补课（产物缺失 + 账缺失、回看 ≤7 天、启动与到点结算、`missed:true`、**不补推送**）；**修 `delivery.mjs` 用投递时刻算日期的 bug**（改取 `occurrence_at`，迟到 >30min 标补）；时刻可调（`rikkeTime`/`wanshengTime`）；晚省卡/面板（order 110）+ 投递历史 |
| 05 事记账本 | #26 | `lib/shiji/**`：`shiji.jsonl`（`xuanshu/shiji@1`，一项目一条 / 依据指纹才重算摘要 / 源头消失冻结 / 删除墓碑永不再生）；扫描挂进 `refreshDigao()` 同一条管线；`shiji.*` 独立方法组（含 `fromSession` 人工确认） |
| 06 底稿两段 | #27 | 底稿两段「最近在做什么 / 曾经做过什么」+ 四路来源标记（谱/工作区/工作流/事记）；`digao.read/status` 加性 `shiji.entries`（供删除动作）；客户端两段渲染 + 事记删除 + 会话内「存成今天的事记」 |
| 07 多家合参 | #28 | 只读 `routes.list`（providers→models→keyConfigured，`'unknown'` 不冒充 false）；`bestof.run` 入参 `routes:[{provider,model}]`（2–4、`provider::model` 去重）+ `confirm:true`；`bestof.estimate`（金额恒 `'unknown'`）；异源判官（无则 `same-source` 如实降级）；有界并发 + 每路 AbortSignal/超时；单路失败不拖累 |
| 08 接上 AI | #29 | 冷启动第 6 步「接上 AI」+ 问事入口只读门禁（三态：已接上 / 未接上带原因与去向 / 未知）；配置后 5s 轮询自动解除、无需重启；**零 provider 配置写入** |
| 09 我的数据 | #30 | `data.overview()`（8 品类体积，`.credentials.yaml` 永不计入）；`data.backup()`（用户自选目录 + 每文件 sha256 清单，含会话/不含密钥）；设置 →「我的数据」页（`settings.section`，order 25）；runbook 备份/恢复/密钥迁移 |
| 10 两处遗留缺陷 | #31 | 问事回看按轮标出**当前采用稿**（`consult.read` 加性 `drafts`，否决轮不当当前）；工作流挂载注入已导出的 `SKILL.md` 正文（未导出如实说明；预算/披露/交付账零改动） |

#### 16.2 冻结契约（跨票并行前先落，`.scratch/notes/spec002/`，未入库）

`contract-shell-notify.md`（壳↔宿主唯一 IPC：回环 JSON + 运行时状态文件 + 共享设置文件 + 触达账）、
`contract-shiji-digao.md`（事记 schema / 扫描范围 / 摘要成本 / 底稿两段）、
`contract-wansheng-missed.md`（晚省事实 / 补课判据 / occurrence 日期）、
`contract-data-backup.md`（8 品类 / 清单 / 排除项）。四份契约都是「先定形状 → 两半边各自实现 → 契约夹测」。

**复核修复轮（t32，2026-10-17）之后新增/收紧的形状**（都写进了代码注释与用例；外部读者按此对账）：

- 新增 `<home>/xuanshu/runtime/shell-status.json`，schema `xuanshu/shell-status@1`：
  `{schema,pid,updatedAt,autostart:{enabled,method:'login-item'|'shortcut'|'unsupported'},closeBehavior}`，
  与 `shell-notify.json` 同级；`pid` 必须与 `XUANSHU_SHELL_PID` 对上（对不上 = 旧壳残留，宿主不用），干净退出删文件。
- **`shell.settings.get()` 改成 `{settings, effective?}`**（之前是平铺三键，属于不兼容改形；`effective` 缺席 =
  壳没在跑或状态读不到）；`shell.settings.set()` → `{settings}`。
- `routes.list`：默认路由未知时 `isDefault = null`（之前写成 `false`，把「不知道」冒充成「不是」）；providers 与 models 两处都改。
- `rikke.status` 的 `unread` / `notify` **只数 `kind==='rikke'`** 的账行（晚省不再蹭日课未读）；打开日课面板只标日课账已读。
- 客户端新增 `#xuanshu-overview` hash 通道（壳点通知后 `show()` + 让页面回 overview；前端无路由，这是它能做到的上限）。
- 宿主 home/dataDir 解析**只剩一份实现**（`lib/home.mjs`）：`bazi/service.mjs` 只是同一函数对象的再导出；
  `cang/service.mjs` 的 dataDir 走 `resolveDataDir()`，`horosa/{service,paths}.mjs` 的 home 走
  `resolveHostHome()` 与 `pointsAtRealDshHome`（复核 C2 之前这两处各有一份无门的解析）。真实 `~/.dsh` 的拒绝
  在同一道门上：horosa 把原因写进 `paths.note`（进 `installHorosa` 的装配 notes 与 `snapshot().paths`），
  cang 由同一判据改判玄枢自己的 home（该组没有装配报告通道，是如实的**行为**结果，不带 note 字段）；
  事记/工作流的 skill 扫描根也走 `resolveSearchHome()`，`DSH_HOME=~/.dsh` 时**拒绝**取真实 home 并记 note。
  生产落**点**门（`lib/index.js` 的 `planWriteTarget`）语义未改。

#### 16.3 验证（数字全部抄工具输出）

```
# pnpm test:inventory（profile 已装；main 全量复核打磨后，见 §16.8）
[inventory] 用例 2278 条（基线 2278）/ 文件 201 个 / 失败 2 条（已知红 2 条） / 文件级失败 0 个 / 跳过 10 条 / vitest exit 1
[inventory] 通过：没有用例消失、没有已知红之外的失败、没有文件级失败。

# pnpm verify:isolation
结果：8/8 通过，exit 0（6503ms）
启动器[home] PASS  隔离 home <repo>/.dsh-home（来源 --home）；真实 home ~/.dsh 不会被碰
…（home 两档默认都不是真实 home；换 home 后两条派生路径两两不同）

# pnpm verify:assembly
[S2] PASS 192 行挂载；xuanshu-host/client state=2
[S3] PASS 客户端产物 557338B；物化/注册/槽位自检全过
[S4] PASS 基线 185 行全部命中
[S5] PASS report 新写出 ok=true，patchRowIds=192 含两行
[S1] FAIL（钉版上游 schema 导出器缺陷，与 Spec 001 同一已知红）
结果：失败，exit 1（仅因 S1 及其连带的那条已知红）
```

2 条已知红仍是 `assembly-contract` 的 S1 与连带「CLI 退出码为 0」，`knownRed` 未改。
`pnpm verify:all`（tsc + `build-client --check` + 清单门 + 文档数字门）exit 0；清单基线已按最终用例数 `--update`（2278 / 201）。

#### 16.4 本轮新踩到/修掉的操作陷阱（记下来）

1. **`dsh --profile xuanshu --help` 这条无 LLM 检查路径会在树 mount 完之前请求退出**：玄枢插件行排在树
   最后，于是 `apply()` 可能在 dispose 已开始之后才跑（实测 root `fiber.state=UNLOADING=5`，
   `profileContext` 已随树拆除）。表现：S5 与隔离台 headless 探针从绿变红，**`report.ok=false` 但两包/两行都在**。
   处置：`lib/index.js` 的 `buildReport` 增加关闭现场判据（`isShuttingDown`，root fiber ≥ UNLOADING）：
   关闭期间如实写 `profile.teardown=true` 并把 home 来源退回 `DSH_HOME`，`ok` 仍要求两包解析 + 两行在树里；
   **非关闭现场缺 `profileContext` 仍然判失败**（不收宽）。判据的会红对照在
   `tests/assembly/assembly-report-teardown.test.mjs`（恒 false / 恒 true 各打红一条）。这是被
   `#25` 的导入图变重后暴露出来的 race（**导入顺序/图深度会决定它落在关闭前还是关闭后**）。
2. **隔离台的临时 home 在红的时候不会被清**：先红一次、再修好后重跑，会因上一次的
   `tests/isolation/.tmp/dual-*` 残留而红在「现场回收干净」。处置：重跑前 `cmd /c rmdir /s /q tests\isolation\.tmp`
   （**不要**用 `Remove-Item -Recurse`，本机有 pnpm junction）。
3. **electron 二进制下载**：本机 `pnpm install` 在 postinstall 取 125MB 二进制时 `ECONNRESET`；
   用 `ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install` 完成安装（模块层测试全绿），
   真窗口/托盘/toast/自启**未真机验收**，手测清单在 `docs/runbook/shell.md`。
4. **`profileContext` / settings 槽位这类「看起来在场」的东西要真机核**：`settings.section` 在钉版 rc.2
   是**实装在**（`dsh-client-ui-settings/lib/types/client/contract/slots.d.ts:73`，declarer
   `dsh-client-ui-settings-general`），本轮「我的数据」据此落成设置页而不是新面板。
5. **改完自有包必须重跑 `node scripts/install-profile.mjs --home .dsh-home`**（旧陷阱，本轮又踩）：
   S3 会红在「profile 里装的 client 与仓库不一致」；同步后恢复。
6. **`tests/setup/setup-cli.test.mjs` 的「连跑两次全绿」在满载时偶发红**：本轮两次全量 `verify:all` 里
   有一次红在这一条（第一次真下载 + 第二次零下载 + 新报告），单跑该文件 14/14 绿、复跑全量也绿。
   判为环境/时序抖动（它真起本地 HTTP fixture 并真跑两遍 setup），**不是**本轮改动引入（本轮只动了
   setup 的 home 默认与文档串）；遇上了先单跑该文件再判，别放宽清单门。同族：`tests/setup/selfcheck-branches.test.mjs`
   的「两处都有信封」用例在 2026-10-17 环境加固轮的全量 `verify:all` 里红过一次（单跑 3/3 绿、复跑全量绿）——
   同一类本地 HTTP fixture 时序抖动，处置同上。
7. **`git worktree remove` 会跟穿 `node_modules` junction，清空主仓依赖**（2026-10-17 t33 实测事故）：
   实现者为了在 worktree 里能 build/跑测试，会 `mklink /J node_modules <主仓>/node_modules`（也可能在
   `packages/*/node_modules`）。`scripts/cleanup-worktrees.mjs` 先跑 `git worktree remove` —— git for Windows
   递归删除时**跟穿 junction**，把主仓根 `node_modules` 清空（`vitest`/`tsc` 起不来；`.dsh-home` 里 profile
   的 `node_modules` 也空了）。**恢复**：`ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile --offline`
   （pnpm store 还在，169 包 3.7s）→ `node scripts/install-profile.mjs --home .dsh-home`；恢复后 `verify:all` 复绿。
   **处置**：新增 `scripts/lib/cleanup-junctions.mjs`，清理脚本在 `git worktree remove` **之前**先摘掉 worktree
   内所有 junction/symlink（只删链接本身，绝不进目标）；判据台 `tests/lib/cleanup-junctions.test.mjs`（3 条，
   含「目标哨兵文件必须活着」），并做了一次端到端实测（worktree + junction → 清理 → 哨兵仍在、worktree 已删）。
   **教训**：「`rmdir /s` 不跟随 reparse point」只保护最后那一步，**先删目录的是 git**；有 junction 的工作树，
   必须先把链接摘掉再交给任何递归删除。

#### 16.5 已知边界（如实登记）

- **桌面壳只到模块层**：窗口 / 托盘 / 关窗隐藏 / 自启 / Windows toast / 点击唤出 / 硬杀看门狗的回收率
  全部**未在真 Electron 窗口上验收**（二进制没装上）；`tests/shell` 134 条是纯模块 + 假适配层证据。
  真机手测清单 10 步在 `docs/runbook/shell.md`。
- **真多家 provider 未跑真机**：本机没有第二家 key，`routes.list` / 异源判官 / 并发超时的证据是
  打桩 `ctx.llm` + 真 `installRpc`；真机 `listProviders/settings.describe/credentials.describe` 形状待核。
- **真浏览器点击链 / 真 LLM 端到端**：客户端只有 `renderToStaticMarkup` 与纯函数断言（无 jsdom）；
  日课 AI 段、事记摘要、晚省都只用 fake LLM 验过「调没调、三态对不对」。
- **补课的时间语义**：`occurrence_at` 的正文形状按钉版实装（`reminders_json`）解析，真机正文未逐字抓；
  `ctx.schedule` 停机后只补「最近一次」occurrence 的事实仍成立 —— 玄枢用「产物 + 自己的账」补齐中间日期。
- **事记日期**：投影缓存缺席时回落到日志；缓存落后会让 `lastActiveAt` 偏旧（已如实写进代码注释）。
- **事记的「会话摘要」没有现成 API**（#38 复核 A1）：钉版只有 `session/title`、`titleInput`（首问聚合，
  是 projection **state** 而非 wire row，`cachedSnapshot()` 取不到）与日志正文，**没有**任何会话摘要读面。
  摘要素材因此由我们自己合成：`shiji/scan.mjs` 的 `questionsOf()` 从日志投影里取人问过的句子
  （复用 `consult/history.mjs`），`summaryPrompt()` 把它作为「会话内容」与标题、文档一起交给 LLM。
  三条边界如实登记：① 有界是刻意的——每场至多 3 句、每句至多 200 字、每条事记至多带 3 场（按最后活跃倒序），
  素材不够多时**不补、不编**；② 会话正文读不出来（`ctx.sessionQuery` 缺席 / 日志读不动）或会话里没有人问的
  文本时，素材降级为**标题 + 文档**，并在扫描 `notes` 里写明原因；③ 助手回话不进素材（只取人问的句子），
  避免把会话里的代码 / 执行复盘带进摘要——「不读代码正文」的口径仍然成立。
- **壳的 `DSH_HOME` 义务**：任何起 `dsh` 子进程的入口都必须同时传 `DSH_HOME` 与 `XUANSHU_DSH_HOME`
  （DSH 本体只认前者）；壳与启动器都已这么传，runbook 写明。
- **`install-profile --home ~/.dsh` 仍是显式逃生舱**（等价 setup 的 `--install`）：显式要求才写真实 home；
  默认路径已不会再落到 `~/.dsh`。
- **#29「一键指路 设置 → 模型」只到「逐字路径 + 有真 handler 才渲染按钮」**：钉版 rc.2 没有公开的
  `openSettings` API（`openSection` 只在 `settings.onboarding` owner props 内，空会话会弹窗且完成态是内存态）。
  让它变成真一键需要在 `settings.onboarding` 注册一个 step（新增 cell + 空会话弹窗，属产品取舍），本轮不做；
  界面不造死按钮，写清路径。
- **#22 装配报告的 `profile.teardown` 是一处刻意的窄放宽**：只在「root fiber 已 UNLOADING/DISPOSED」的关闭现场
  才允许 `profileContext` 缺失并仍判 `ok`（证据见 §16.4 第 1 条）；非关闭现场缺 `profileContext` 仍然判失败，
  `tests/assembly/assembly-report-teardown.test.mjs` 两个方向都钉着。
- **设置页的「点击链」没有 jsdom 证据**：本仓无 jsdom，设置页只用 `renderToStaticMarkup` + 纯函数/数据面断言；
  壳的真窗口行为（状态文件写入、`fs.watch` 回流、隐藏窗口点通知后回 overview）只有 runbook 手测清单。
- **硬杀壳会留下过期 `shell-status.json`**：宿主按 `pid` 不匹配拒用（有测试），但 pid 复用在理论上可能误认。
- **票 01「setup 默认档 + 干净临时 home 一条命令 → `dsh --profile xuanshu --help` 可启动」没有端到端证据（R9 / #41 如实登记，状态 = 未验证）**：
  来源是第二轮规格轴审查 A2（`docs/reviews/spec002-ae78c53-spec.md:44-49`）。缺口有两半：
  ① **setup 的默认档没有用例** —— `tests/setup/**` 的 `runSetup()` 一律显式给 `--dsh-home <sandbox>`
  （`tests/setup/setup-cli.test.mjs:51-53` 的 `baseArgs()`），默认档（dev `<repo>/.dsh-home` / product `~/.xuanshu`）
  只靠它委托的 `resolveHomeWithSource()` 被 isolation 用例间接覆盖，`resolveSetupPaths` 零测试调用点
  （`scripts/setup/paths.mjs:136` / `scripts/setup.mjs:98`）；
  ② **「setup 装完 → 直接 `dsh --help`」这条链没真跑过** —— setup 断言台用
  `XUANSHU_INSTALL_PROFILE_BIN` / `XUANSHU_VERIFY_ASSEMBLY_BIN` 两个替身把 profile 装配与 DSH 启动整段跳过
  （`tests/setup/setup-cli.test.mjs:10-11,61-62`），所以 10 条 e2e 面证明的是「编排对」，不是「装完能起」。
  **为什么本轮不补**：真跑这条链需要 `install-profile` 的 `pnpm install` 装出 `@deepseek-ai/dsh`
  （干净检出 / 本 worktree 的 `profile/node_modules` 不存在；主检出那份是**机器私有安装**，测试不得依赖），
  而 R9 复核修复轮的硬约束是「不跑 pnpm install / install-profile、不联网」；默认档又会指向仓库 `.dsh-home`
  或产品 `~/.xuanshu`，用例真走默认档就必须碰这些真实目录（违反「测试不依赖机器私有文件」）。**不造半条假链。**
  **已有的替代证据（不等于本条）**：启动器路径的真启动是 `--mode headless` 真 boot + exit 0
  （`tests/isolation/dual-instance.test.mjs:69-81`，每档一个隔离 home），**不是** `--help`、也不是 setup 装出来的 profile。
  **要关掉它**：一台允许 `pnpm install` 且能联网的 CI 机（`windows-latest`）跑
  `node scripts/setup.mjs --json`（默认档 + 干净临时用户）→ 再 spawn
  `<home>/profiles/xuanshu/node_modules/@deepseek-ai/dsh/lib/bin.js --profile xuanshu --help` 断言 exit 0；
  或加一个测试专用注入口（预置已完成装配的 profile 树）再补这条链。

#### 16.6 第二轮两轴审查（`ae78c53`）与 t33 修复轮（2026-10-17）

**审查**：固定点 `main` `09951eb`，审查对象 `ae78c53`；两个独立上下文（Standards / Spec，不合并排序），
报告入库 `docs/reviews/spec002-ae78c53-standards.md` / `-spec.md`。共 15 条发现
（Standards 9 = 1 硬违规 + 5 判断项 + 3 气味；Spec 6 = 3 缺失 + 3 做错）。

**票据与工作方式**：拆成 9 张票 **#33–#41（R1–R9）**，7 张并行、2 张按依赖（R7←R2、R9←R4）；
每票独立 worktree + 分支 + TDD（先红后绿留证据），完成后由合并者串行 `--no-ff` 并回
`feat/spec-002-integration`（9 个合并提交，最终 tip `f7caa9a`）。

| 发现（轴） | 票 | 落地 |
|---|---|---|
| C1 事记「已删除」筛 `frozenAt`（Spec·高） | #33 | 客户端按 `excludedAt` 判墓碑、删除日期取墓碑时间（缺失「日期未知」）、冻结不进列表；夹具同时含墓碑/冻结（旧实现必红） |
| H1 触达账读失败报 `unread:0`（Standards·硬） | #34 | `readTraffic` 三态 `missing/unreadable/ok`；`traffic.status` 读失败省略 `unread`；界面「未读数未知」；EISDIR 注入用例 |
| J2 6 处用户可见 `~/.dsh` 旧路径（Standards·P1） | #35 | 文案收口到 `home-paths`、由宿主 `data.overview` 注入；源码扫描用例禁 `~/.dsh`（注释白名单） |
| C2 「home 只剩一份实现」只做一半（Spec·中） | #36 | cang→`resolveDataDir`、horosa→`resolveHostHome` + `pointsAtRealDshHome` 拒绝并回 note；`home-single-source` 覆盖全部服务组；§16.2 与代码一致 |
| C3 判官失败记 `mode:'tool'`（Spec·低-中） | #37 | 两条失败路径改 `failed` 并带原因；`tool`/`same-source` 不变；用例断言 `mode` |
| A1 事记摘要缺「会话内容」（Spec·中） | #38 | `sessionTexts`（只取人问句，有界 3 场×3 句×200 字）+ prompt 带上；读不到如实降级；§16.5 登记 |
| A3 权限缺失只显示英文串（Spec·低） | #40 | 写账前 token→人话 + 加性 `reasonCode` 贯通 status/账/界面；其他 reason 逐字保留 |
| J1/J3 契约副本与 `OVERVIEW_HASH` 各一份（Standards·P2） | #39 | 两侧 import 直接对拍（改任一侧即红）+ 握手闭环；壳契约副本登记为 §0 显式例外 |
| J4/J5/A2 runbook 绝对路径、入口格式、setup 默认档证据（Standards·P3 + Spec·低） | #41 | runbook 改 `<repo>` 占位 + `rmdir` 写法；入口断行；setup 默认档**如实登记**为未验证（理由与关闭方式进 §16.5） |

**修复后的第二轮 code-review**（固定点 `ae78c53`、对象 `397b4f0`）：Standards **通过**（3 判断项），
Spec **不通过**（R3·AC1「按实际 home 渲染」只有组件层绿，装配点不传值）。同一轮 `ce64a13` 一次修掉 5 项：
F1 生产接线（apply 期读一次 `data.overview` 注入 5 处路径；`overview-contract` 把占位当产品文案的断言一并纠正）、
F2 host/client 失败文案表对拍 + 删两个零消费者导出、F3 恒真夹具补 `frozenAt`（证红后还原）、
F4 其余 runbook 去绝对路径、F5 `--update` 写基线按 key 排序；合并为 `f7caa9a`。

**验证（数字抄工具输出，最终 tip `7e63e30`（t33 收尾提交，数字在那一笔刷新））**

```
# pnpm test:inventory
[inventory] 用例 1811 条（基线 1811）/ 文件 164 个 / 失败 2 条（已知红 2 条） / 文件级失败 0 个 / 跳过 10 条 / vitest exit 1
[inventory] 通过：没有用例消失、没有已知红之外的失败、没有文件级失败。

# pnpm verify:isolation → 8/8 通过，exit 0
# pnpm verify:assembly → S2/S3/S4/S5 PASS；S1 FAIL（钉版上游缺陷，Spec 001 起既有已知红）
# tsc --noEmit exit 0；build-client --check in sync（522070B）
```

**这一轮的教训**

1. **「按实际 X 渲染」必须在装配点验**：R3 两次出现同一形状——组件层直传 props 的绿与
   「把占位当产品文案」的断言都不算数；AC 写「渲染」就要在 apply/装配面断言一次。
2. **测试替身与实现同错会第二次发生**：R1 的旧夹具把冻结当墓碑（与 C1 同形），
   修复必须先改夹具证红，再改实现。
3. **复制表与死导出要每轮复核**：R7 的人话表两端各一份 + 两个零消费者导出；
   现在有逐键/正则/样例对拍，且新增复制必须登记例外。
4. **`--update` 的键序噪声**：基线文件按 vitest 报告序写会产生纯搬移 diff；已在写出处按 key 排序。

**遗留边界（如实）**：setup 默认档端到端仍无证据（§16.5 登记，关闭方式写在那里）；`cang` 的拒绝是
静默改判（无装配 notes 通道，§16.2 已登记）；R7 人话表仍两份（有对拍，跨包无共享运行时模块）；
`apply` 期多一次只读 `data.overview`（含体积统计；失败降级为占位，代价写在代码注释里）。

**同日清理事故与护栏（详见 §16.4 第 7 条）**：收 worktree 时 `git worktree remove` 跟穿实现者的
`node_modules` junction，清空了主仓依赖；用 pnpm store 离线恢复（169 包）+ 重装 profile 后 `verify:all` 复绿。
已新增 `scripts/lib/cleanup-junctions.mjs`（删 worktree 前先摘链接）与 3 条判据用例，并做了一次端到端实测；
最终用例数因此从 1811/164 变为 **1814/165**。

#### 16.7 环境加固轮（E1–E3，2026-10-17 晚）

来源：t33 之后的 `/retro`——把「实施者每次现场发明」的操作规则与「手抄必然漂」的数字搬成机器可用的形态。
三张票：**E1 #42**、**E3 #43**、**E2 #44**（阻塞于 E1），全部并入 `feat/spec-002-integration`（最终 tip `6d76394`，含两轴复核修复）。

| 票 | 交付 |
|---|---|
| E1 | `scripts/worktree-create.mjs`：一条命令建工作树 + 分支 + 根/包级 `node_modules` 链接（**只链不复制**、不装包），`--base/--branch/--repo/--dry-run`，已存在/非法名可读拒绝；7 条临时 git 仓库端到端用例（含「摘链接删树后目标哨兵仍在」）。清理仍只走 `pnpm cleanup:worktrees`（§16.4 第 7 条的护栏） |
| E3 | `scripts/check-doc-numbers.mjs`：真值 = 清单基线 total/files + 客户端产物 `statSync` 字节；只核对 README 与 §16.3/§16.7/§16.8 的**当前**验证块（历史旧数字不误报）；漂移 exit 1 逐条点名「文件:行 期望/实际」，不可验证 exit 2；接线 `verify:all` 末步 + CI「doc numbers gate」；20 条判据（一致/单点/多处/真源缺/块缺/历史不误报/注入面） |
| E2 | `docs/agents/parallel-work.md`（38 行：起工作树、junction 跟穿禁令、基线/产物归属、`client.js` 冲突重建、合并顺序）+ `docs/agents/review-checklist.md`（27 行：装配面断言 / 夹具正确域字段 / 跨包重复表与死导出 / 数字来源，各带本轮实例指针）+ `AGENTS.md` 两处**按分支触发**指针（起 worktree 前 / 跑 code-review 前） |

**验证（数字抄工具输出；本行随当前验证块刷新，原轮次基线见下一行）**：`pnpm verify:all` exit 0（类型 + 产物同步 + 清单门 + 文档数字门）；
`[doc-numbers] OK：2278 条用例 / 201 个文件 / 557338 B`；E1 真实仓 `--dry-run` 识别根 + 3 个包级链接、零落盘。
E1/E3 与两轴复核修复新增 25 条用例后基线 `--update` 为 **1839 条 / 167 文件**，文档数字由新门核对。

**这一轮的教训**：把「每次都要记得做」的事拆成两种处置——能机械判定的（数字漂移、链接安全）做成门；
只能靠判断的（装配面证据、夹具域字段、重复表对拍）写成 reviewer 的按需清单，并用指针挂到 `AGENTS.md`，
不占实施者的上下文。

#### 16.8 main 全量复核与打磨（2026-10-17）

Spec 002 已随 PR #32 并入 `main`（`7b829d2`）。本轮按用户确认的全量范围，
以合并前的 `09951eb` 为固定点，分别运行 Standards / Spec 两个独立复核上下文，
修复位于 `codex/spec002-review-polish` 工作区。完整原始发现、触发条件与回归证据见
[`docs/reviews/spec002-7b829d2-review.md`](reviews/spec002-7b829d2-review.md)。

**Standards：2 项，均已修复。** 事记只把 ENOENT 当空账，其余读取失败阻止重写；
晚省改读真实 `sessionListMetadata.lastPromptAt`，修正与实现同错的 header 夹具，并提供日志回落。

**Spec：7 项，均已修复。** 事记扫描串行、提交前合并最新人工删除/恢复/保存；
备份遇到上限或源读取失败明确拒绝；判官全程限时并继承取消，迟到结果不回填；
日课读底稿「最近」正文；晚省补工作流活动及卡/面板显示；备份排除 runtime 凭据与
Windows 大小写凭据变体；目标位置按真实路径拒绝进入 home 或外置 dataDir。
追加复核发现的坏工作流清单误报零条也已收口：事实统计使用严格读面，原宽松列表的默认行为保持兼容。

**最终验证（抄工具输出）**：

```
# pnpm verify:all → exit 0（类型 + 产物同步 + 清单门 + 文档数字门）
[inventory] 用例 2278 条（基线 2278）/ 文件 201 个 / 失败 2 条（已知红 2 条） / 文件级失败 0 个 / 跳过 10 条 / vitest exit 1
[inventory] 通过：没有用例消失、没有已知红之外的失败、没有文件级失败。
[doc-numbers] OK：2278 条用例 / 201 个文件 / 557338 B

# pnpm verify:isolation
结果：8/8 通过，exit 0（6503ms）

# pnpm verify:assembly → exit 1，仅 S1 既有上游缺陷
[S2] PASS 192 行挂载；xuanshu-host.state=2 xuanshu-client.state=2
[S3] PASS 客户端产物 557338B；物化/注册/槽位自检全过
[S4] PASS 基线 185 行全部命中
[S5] PASS report 新写出 ok=true，patchRowIds=192 含两行
[S1] FAIL unrecognized Loader tree carrier（同 §16.3）
```

`tests/test-inventory.json` 由清单工具 `--update` 刷新；knownRed 未增改。
客户端已从源码重建，宿主/客户端运行副本已用 `install-profile --home .dsh-home --skip-install` 同步。
原始事记并发、判官超时、真实投影与 Windows 凭据反例均复跑过修复后的结果；未联网、未调用真实 LLM。

**边界**：事记队列/提交前合并属于同一宿主进程，没有跨进程文件锁；
备份达到规模上限现在明确失败，需检查目录规模；投影缺席时按需读相关会话日志。
真实 Electron 窗口/托盘/toast/自启、真实多家 provider、浏览器点击链与 setup 默认档端到端的
验收边界沿用 §16.5，本轮的模块/装配验证不能代替这些真机验收。

#### 16.9 真机 web boot 修掉客户端两处「一抛就整块不渲染」（2026-10-18）

**现象**：真机打开玄枢（浏览器形态）只显示 `HARNESS / Failed to load plugins / xuanshu-client /
web boot: 1 entry did not activate / xuanshu-client: failed`。10 个面板一个都不出现。
DSH 的 boot 只报 fiber 状态，**真实异常被吞掉**（`packages/client/web/src/boot-client.ts:66` 只拼状态名）。

**取证方法（可复用）**：本机解压出来的 Chromium（electron 33/38、playwright 自带 headless shell）
都起不来（后者报 `ICU: U_INVALID_FORMAT_ERROR`，且它自己的 `icudtl.dat` 头部是全 0），
改用**系统已装的 Edge**（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）+
全局 playwright（`%APPDATA%\npm\node_modules\playwright`）打开页面、收 `console`/`pageerror`；
再给 `apply()` 临时加一层 `try/catch` 打出真实栈（定位完立即撤掉，不在产物里留诊断代码）。

**两个根因（都不是环境问题，重启机器不会好）**

1. **客户端 ctx 的未声明服务属性访问会抛**：`ctx.uiWorkspace` / `ctx.workspaces` /
   `ctx.sessions` / `ctx.commandUi` 这些服务没写进插件的 `inject` 数组时，客户端 cordis 的属性代理
   **直接抛** `Error: cannot get property "uiWorkspace" without inject`；`as SomeShape` 这类类型断言
   **运行期什么也不做**。四处命中：`index.tsx`（uiWorkspace、sessions）、`bestof.tsx`（commandUi）、
   `mounts-api.ts`（workspaces）、`PuPanel.tsx`（渲染期读 `ctx.uiWorkspace`）。
   修法：新增 `src/client/ctx-service.ts::readService()`，可缺席服务一律走 `ctx.get(name)`
   （缺席返回 `undefined`，正是各调用点「拿不到就如实降级」要的东西）；`PuPanel` 改成注入
   `openSession` 回调，组件不再碰 ctx。
2. **`hashchange` 挂在 `location` 上**：浏览器里 `location` 不是 EventTarget，
   `location.addEventListener is not a function` —— 又是一抛就整块死。
   修法：`overview-hash.ts` 的 `listenOn` 单独给，装到 `window`，`location` 只用来读/清 hash。

**为什么以前没发现**：客户端只有 `renderToStaticMarkup` 与纯函数断言（本仓无 jsdom），
`verify:assembly` 的 S3 是产物物化 + 槽位自检（静态），真机 web 页面从没打开过 ——
§16.5 早就把「真浏览器点击链」登记为未验证边界，这次是它第一次真的被打开。

**验证（数字抄工具输出）**

```
# 真机（Edge + playwright 探针，2026-10-18 11:43）
body: 10 个面板全部渲染（总览/问事/谱/藏/底稿/工作流/填八字/命盘/日课/晚省）+「家 · 自我总览」
console: 无 boot 失败、无 pageerror
# node ./node_modules/vitest/vitest.mjs run tests/assembly tests/shell
Tests  2 failed | 771 passed (773)   # 仅 S1 及其连带（既有已知红）
# tsc --noEmit exit 0；build-client --check in sync 523964 B；check-doc-numbers OK
```

**测试侧的配套**：`tests/assembly/bestof-registry.test.mjs` 的两个假 ctx 补了 `get(name)`
（模拟真 cordis：「可选服务走 `ctx.get`」是 API 事实，不是实现细节），夹具与实现不再两边同错。

**仍然未验的**：真实 Electron 窗口那条线（本机 Chromium 运行时起不来，§16.5 边界不变）。

#### 16.10 数据面整条不通：宿主 RPC 通道注册必抛 + 客户端传输走错路径（2026-10-18 下午）

§16.9 修完两处后**界面出来了，但每张卡都是失败态**（真机截图：命盘「快照读不出来」、
日课「底座未就绪 / 推送调用失败 —— transport failure for /xuanshu/rikke.status: HTTP 405」）。

**取证**：`dsh web` 的 stderr 里有一行谁都没看的
`dsh: warning: 1 entry did not activate / xuanshu-host (xuanshu-host): failed to import`；
给 `installRpc` 临时加日志后拿到真实栈：
`Error: cannot get property "webServer" without inject`，位置在
`dsh-client-connection/lib/index.js:656` 的 `owner.webServer.register(route)`。

**两处根因（都是「照着一半 API 写」）**

1. **`connection.rpc.handle(name, handler)` 在 rc.2 里没法用**：它在 `register()` 内部读
   `owner.webServer`，而 owner 是 connection service 自己的 ctx（没有 inject `webServer`），
   必然抛。我们的 `apply()` 里这一句抛在 `ctx.inject(['connection','webServer'])` 的回调里，
   fiber 直接 failed —— 整条数据面（bazi / consult / rikke / digao / data / shiji / workflow / bestof）
   一条 RPC 都没注册。**rc.2 给扩展的正确入口是 `/api` 前缀路由上的 exact Fetch 路由**：
   `connection.fetch.register({ path: '/api/<name>', methods, requestBody, fetch })`
   （先例 `dsh-api-session-controller` 的 `/api/file`），鉴权由 `/api` 统一施加。
   修法：`packages/xuanshu-host/lib/rpc.mjs` 改成挂 `/api/xuanshu`，信封自持
   `{method,payload}` → `{ok,value}` / `{ok:false,error}`；派发抽成 `createRpcDispatch()`。
2. **客户端传输指向了不存在的路径**：`rpcCall` 走 `ctx.connection.rpc.call('/xuanshu', method)`
   → 浏览器 POST `/xuanshu/<method>`；而宿主只把 `/api` 挂成前缀路由，别的路径都是 SPA 兜底
   → **HTTP 405**。修法：`packages/xuanshu-client/src/client/rpc.ts` 直接 `fetch('/api/xuanshu')`
   （同源带会话 cookie），信封与宿主对齐。

**真机验证（Edge + playwright 探针）**

```
启动日志：无 "did not activate"（此前 xuanshu-host 每次都没起来）
概览页：数据都在本地 E:\ai_project\XuanShu\.dsh-home\xuanshu\   ← 真 home（占位符问题同时消失）
命盘：底座还没立起来（如实态）
日课：今天还没有生成日课。日课默认每天 07:30 生成（底座未立时生成会失败）
底稿：底座未立，还没有可提炼的来源
console：无 405、无 pageerror
```

**代价（如实登记）**：客户端传输换成 `fetch` 之后，`tests/assembly/**` 里 **13 个文件、27 条**
把 `ctx.connection.rpc.call` 当替身的用例需要迁移到新传输（它们断言的是「方法名 + 载荷」，
语义不变，只换夹具形状）；连同 S1 的 2 条既有红，`tests/assembly` 当前是红的。
迁移未在本轮完成 —— 这是下一轮的第一件事，不要把它读成「功能坏了」。

#### 16.11 宿主侧 `ctx?.<service>` 同一类必崩：日课 AI 段「cannot get property "llm" without inject」

**现象**（真机，底座立起来之后）：命盘四柱正常、日课确定性段（宜/忌/流日）正常，
只有 AI 段写 `AI 建议生成失败：AI 段跑的时候抛了异常（已兜住）：cannot get property "llm" without inject`。

**根因**：与 §16.9 同一个机理（cordis 的 ctx 属性代理对**未 inject 的服务**直接抛），
但这次在**宿主**侧，而且是 `ctx?.llm` 这种写法 —— `?.` 只挡 ctx 为 null，**挡不住代理抛**。
命中的 6 处：`digao/llm.mjs`、`rikke/ai-note.mjs`（两处 LLM）、`digao/sources.mjs`（两处 workspaceRegistry）、
`digao/tasks.mjs`（`?? ctx?.schedule` 兜底）、`rikke/daily-tasks.mjs`（`?? ctx?.agents` 兜底）。
后两处的形状尤其隐蔽：`softGet(...) ?? ctx?.x` —— 软取拿不到时才走兜底，兜底那一刻才抛。

**修法**：新增 `packages/xuanshu-host/lib/soft-service.mjs::getService(ctx, name)`（唯一软取入口，
从不抛），把上述 6 处全换成它；不再新增第 26 份 `softGet` 复制。

**真机验证（`rikke.generate` 走真宿主 + 真 DeepSeek）**

```
ai: { mode: 'ok', text: '今天把范围收小，只推进已经定下的小事…流日为乙丑土日，节奏放慢些…' }
产物 <dataDir>/rikke/2026-10-18.json 的 ai.mode = 'ok'
```

**同一条修法顺带修好的**：底稿的 LLM 摘要、事记摘要、合参/问事的 LLM 调用路径（同一个 `getService(ctx,'llm')` 口径）。

---

## 17. Spec 003 体验质量线（判据 / 巡检 / 兑现率）

> 时间：2026-10-31｜工单：#48–#60（13 张）｜ADR：[`adr/0015-ux-quality-line-machine-criteria.md`](adr/0015-ux-quality-line-machine-criteria.md)
> 真值入口：`pnpm verify:ux`（只报告、不挡门）；判据集在 `docs/design/ui-v1/criteria/`

### 17.1 建成了什么

| 模块 | 位置 | 一句话 |
|---|---|---|
| 界面面清单 | `tests/assembly/lib/panel-surface.mjs::faceManifest()` | 分母的唯一来源（注册面派生，不另抄） |
| 判据投影器 | `scripts/ux/project.mjs` | `rules/*.json` → `criteria.json`（字节确定，`version` = sha256） |
| 冻结守卫 | `scripts/ux/freeze.mjs` | 判据被改一个字节 → 拒绝运行、退出码 3、不出报告 |
| 静态采集器 | `scripts/ux/collect/static.mjs` + `probes/*` | 读源码收事实，不判定 |
| 浏览器采集器 | `scripts/ux/collect/browser.mjs` + `browser-scripts.mjs` | 起隔离实例跑任务剧本，只收证据 |
| 判定引擎 | `scripts/ux/judge.mjs` + `assertions/*` | **唯一判定点**，纯函数 |
| 报告器 | `scripts/ux/report.mjs` + `diff.mjs` | 兑现率 / 三分类 diff / 缺态清单 / 人读 + 机读 |
| 修复护栏 | `scripts/check-ux-fix-notes.mjs` / `check-ux-authority.mjs` / `ux/regreen.mjs` | 修复说明、写入面、转绿断言 |

### 17.2 界面面真值：**25**，不是 30

spec 003 与票 01 写的「10 面板 + 18 寄生 = 30 面」是把 `4+2+2+3+1+3=15` 估成了 18。真实注册面
（`expectedCells()` + `BESTOF_COMMAND_NAMES`）是：**10 个面板 + 12 个寄生位（4 抽屉 / 2 设置区块 /
2 设置项 / 3 输入框 dock / 1 回合尾）+ 3 个命令 = 25 面**。分母按真值算；`faceManifest()` 对
「新增了注册面却没登记 label/sources」直接抛错，所以覆盖面不会因为没人记得而静默缩水。

### 17.3 判据集 v1（17 条 / 7 族）

`T-001..004`（token 消费，static）· `D-001..002`（点击目标 ≥44×44 / 一屏至多一个主操作，browser）·
`C-001..003`（正文 ≥16 / 行高 ≥1.5 / 对比度 AA，browser）· `S-001..003`（空/载/错，static）·
`N-001..003`（入口唯一 / 返回落点 / 键盘可达，browser）· `X-001`（文案一致性，static）·
`L-001`（层级与排版，**human-only**，写明「机器判不了的原因」）。
阈值与出处：`rules/*.json` 每条都带 `source.anchor`，投影器校验锚必须真的存在于设计稿（或 spec 003 §视觉档位）。

### 17.4 这一轮的数字（抄工具输出）

```
# node scripts/verify-ux.mjs（静态半边）
兑现率：174/376 = 46.3% · 判据集 ux-v1 · 25 个界面面 × 17 条判据
判定：pass 174 / fail 26 / human-only 22 / not-collected 176

# node scripts/verify-ux.mjs --browser（再起隔离实例跑三条剧本）
兑现率：195/376 = 51.9%
判定：pass 195 / fail 42 / human-only 22 / not-collected 139
视觉档实测：最小点击目标 70×21（panel:overview）· 最低对比度 3.42:1 · 同屏主操作最多 2 个
```

- 族 T 四条**全绿**（票 11 清偿）：字面色值 15 → 0、注入点 12 → 1（`styles.ts` 单一消费层）、
  字面断点 9 → 0（`breakpoints.ts`）、非 token 颜色声明 8 → 0。
- 静态半边的 26 条红全在族 S/X（缺空态/加载态/错误态、文案不统一）：**实测结论，不是回归**。
- `--browser` 多出的 16 条红来自族 D/C/N（视觉档与导航），只覆盖剧本走到的面；其余是 `not-collected`
  （未采到 ≠ 通过）。导航族实测：`N-001` 5 面红（`pus` 3 个入口 / `onboarding` 2 / `workflow` 2 /
  藏抽屉 2 / 挂载抽屉 2），`N-002` 观测 2 面全绿，`N-003` 观测 3 面全绿。

**视觉档实测（真 Edge，剧本 1 只走到 overview + pus 两个面）**：最小点击目标 **70×21**、最低对比度
**3.42:1**、同屏主操作最多 **2 个**。`C-002`（行高 ≥1.5）是唯一**两面全红**的：玄枢这些面板都没设
`line-height`（computed = `normal` ≈ 1.2），设计稿 type-scale 写的 body 行高 1.6 没落地 —— 真缺陷，
修法是在 `styles.ts` 统一给正文行高（下一张修复票）。

**一处需要人裁决的自相矛盾**：`assets/tokens/type-scale.md` 的 body 是 14px、caption 12px，而 spec 003 §21
要求正文 ≥16px。`C-001` 的红有一半来自这条冲突。本 spec 不动设计稿取值（Out of Scope），所以按现状
如实判红；要么改 type-scale（新 ADR），要么改 spec 的留白档阈值 —— 两条都不该由巡检自己决定。
这也是 `rules/D.json` / `C.json` 的 `source.file` 指向 spec 003 而不是 ui-v1 的原因（**唯一一处**被允许的
出处例外，等上面那条裁决完再回改设计稿）。

**已知的口径代价（下一张票该改）**：`S-001..003` / `X-001` 的 `appliesTo` 是 `all`，命令面（`/多模型` 等
3 个）也在里面 —— 命令没有 DOM，三态只能由它打开的浮层承载，于是产生 9 条**不可直接行动**的红。
本 spec 选择照判（不开天窗），代价是 26 条红里占 9 条。正确的做法是把 S/X 的 scope 改成 `rendered`
（与 D/C/N 一致），并同步 `family-s` 的断言。

**巡检顺手抓到的两个真问题**（未做成判据，写进报告 notes）：
1. **挂载账本抽屉点了不开** —— 门厅挂载区与 `shell.overlay` 浮层各持一个 controller
   （`index.tsx` 造一个给区、`installMounts` 内部又造一个给浮层），所以 N 族在挂载抽屉记「未采到」。
2. **藏库卡片的次级入口在闭合的 `<details>` 里**：宽屏下 summary 被藏、内容不在 Tab 序与可访问树，
   指针也常打不中（boundingBox 0×0）—— 两次运行尺寸不稳定，所以没写成 N-003 判据（会变成抖动的红）。

### 17.5 继承红与顺带修好

- **修好**：`tests/assembly/**` 里 39 条 + `tests/cang/panel` 1 条 API 用例仍按旧传输层
  （`ctx.connection.rpc.call`）打桩 —— 上一提交把数据面改成同源 `fetch('/api/xuanshu')` 后它们全红。
  新增 `tests/assembly/lib/rpc-fetch.mjs` 统一打桩，断言口径零放宽，40 条转绿。
- **修好**：`tests/digao/service.test.mjs`「事记按 lastActiveAt 倒序」是一条**时间债** ——
  用例把 2026-10-18 当「更晚」，但第二次刷新走没有 `now` 接缝的 RPC，等于用墙上时钟写 `lastActiveAt`；
  2026-10-18 之后必然翻序（今天 10-31 稳定复现）。修法：第二次也注入同一个扫描时刻，断言口径未放宽。
- **仍红（与本 spec 无关，已登记）**：`tests/assembly/assembly-contract.test.mjs` 的 S1/CLI 两条
  （上游 DSH 缺陷，`knownRed`）。

### 17.6 这一轮新踩到的坑（记下来）

1. **`profile/cordis.patch.yml` 会被 DSH 改写**：首跑关掉「预览版说明」时 DSH 往这个**入库件**里追加
   `welcomeNoticeVersion`。浏览器采集器现在启动前快照、`stop()` 原样写回；手工探针留下的那次改动已 `git checkout` 还原。
2. **worktree 里跑不了浏览器半边**：`worktree-create` 只链 `packages/*/node_modules`，临时 home 的
   `profiles/xuanshu` 是 link 到**worktree 的** `profile/`（那份没有 node_modules）。实现者票请只在主仓跑 `--browser`。
3. **媒体查询吃不了 `var()`**：所以断点只能走 JS 常量 + 模板插值；T-003 的采集口径因此把
   `${BREAKPOINT_*_PX}px` 判为「来自 token」，不判字面 —— 否则把值搬进常量也照样红，等于逼人留字面值。
4. **清理带 junction 的临时 home**：先 `cmd /c rmdir <link>` 摘链接，再递归删目录。直接递归删会跟穿到仓库 `profile/`。

### 17.7 签字与两处口径定稿（2026-10-31）

1. **判据集 v1 的签字人改为 `buyou`**。此前 `freeze.json` 的 `approvedBy` 是集成期间临时写的
   `integration-owner`——那是机器身份，按 ADR-0015 第 7 条签字点①本该是人。重签只改
   `frozenAt` / `approvedBy` / `note` 三个字段，`version` 仍是 `14f8e05d83ff…`，17 条 / 7 族一字未动。

2. **`type-scale.md` 的 14px 与 spec §21 的「正文 ≥16px」冲突，裁决为：16px 是目标，14px 是现状**。
   设计稿不改表（表里是当前实现的取值），差额登记为待清偿债；清偿时整条阶梯一起重排
   （body 16 / secondary 14 / tertiary 13 / caption 12，层级靠字重与间距分），并同改那张表。
   在此之前 C-001 照现状判红——**不许靠调低阈值把红变成绿**。裁决原文追加在
   `docs/design/ui-v1/assets/tokens/type-scale.md` §5。

3. **已知缺陷（登记待办，本轮未修）**：两个修复护栏的缺省基准是 `feat/spec-003-integration`
   （`scripts/ux/repair-channel.mjs:30`），在这个分支上跑等于自己比自己 → `commits=0`、真空绿。
   换成真实范围立刻是红的：

   ```powershell
   node scripts/check-ux-authority.mjs --since main    # 40 个提交 / 19 个动生效区 → ✗ 9 条
   node scripts/check-ux-fix-notes.mjs --since main    # 40 个提交 / 跳 16 个合并 → ✗ 1 条
   ```

   9 条里 8 条是「票在自己的 worktree 里改 `rules/`、集成时统一签字」的正常中间态，第 9 条是
   `a4a4772` 合并时签字哈希对不上（`636f87fd…` → `0795319…`）；`fix-notes` 那 1 条是 spec 002
   继承来的 `8fdaa4b`（改了 11 个客户端文件、没有 `UX-FIX` 行）。
   正解是缺省基准按「当前分支是否集成分支」动态解析到 `main`，并把上述历史中间态写成**带理由的
   显式豁免清单**（逐条打出来，不静默忽略）；豁免条目指向的 sha 在范围里找不到时也要报——否则
   清单会退化成永久黑名单。下一张票做。

### 17.8 三件遗留的处置（2026-10-31 晚）

§17.7 记的三件事全部落地，另一件只做了一半，如实记在这里。

**① S/X 的适用范围收到 `rendered`**（`rules/S.json`、`rules/X.json`）。命令面（多模型 / 合参 / bestof）
没有 DOM，在它上面要求「三空态 + 文案一致」只会产出 12 条不可行动的红。分母 376 → 364。
`appliesTo=all` 的相关用例改成断言「命令面**不**出现在判定里」，并补一条反向保证
（面板面仍照判）—— 否则「谁都不判」也能让那条测试绿。

**② 护栏基准改按分支解析**（新 `scripts/ux/guard-base.mjs`）：集成分支 → 主干；票分支 → 集成分支；
主干 → 主干（范围为空是正确答案）。`DEFAULT_BASE_REF` 从 `repair-channel.mjs` 删除，理由留在原处。
配套新 `scripts/ux/waivers.mjs` + `docs/design/ui-v1/guardrail-waivers.json`：历史中间态逐条写理由放行、
逐条打印，**对不上任何违规的条目算过期（按红处理）**，避免清单长成黑名单。
实测：主干上跑 → 基准主干、0 提交、工作区仍检查；票分支上跑 → 基准集成分支。
合并之后那 10 条历史红不再被计入（它们随 merge commit 进了主干），所以清单当前为空。

**③ 字号与可点目标**（做了一部分）：

- `styles.ts` 加基础段（跨全部面板）：`line-height: 1.6`；可点目标 `min-height/min-width: 44px`。
  效果：**D-001 从 4 面红 → 全绿**，最小点击目标 70×21 → 74×44。
- `type-scale.md` §2 阶梯重排（title 18 / heading 16 / body 16 / secondary 14 / tertiary 13 / caption 12）；
  `style.ts` 正文 fallback 提到 16、次要提到 14；`mounts` 说明行 12px → 16px。
- **判据侧同步收紧**：C-001 只判正文，`role=meta`（tag / badge / 状态行 / 路径 / 计数）不参与
  16px 下限 —— 否则唯一「通过」方式是把整屏调成同号，层级会塌（L-001 要防的正是这个）。
  采集器加了 `role` 字段（类名先判、标签兜底）。
- **已钉下限（票 #63 / UX-01）**：宿主在容器上覆盖了 `--dsh-content-font-size`（实测 14px），
  `var(…, 16px)` 的 fallback 不生效。改法是把下限钉在**面板根**上——
  `font-size: max(16px, var(--dsh-content-font-size, 16px))`（`style.ts` 的 `.xs-overview`、
  `consult.tsx` 的 `.xs-consult`），继承链上的正文都吃这条；写死 rem 的 `h3`/`h4`/字段标签/
  `__round-head` 各钉一次，`mounts` 的说明行也改成同一条 `max()`。元信息仍自带 12–14px。
  **浏览器侧复测未做**（worktree 起不来，§17.6 第 2 条）：C-001 是否转绿以主仓 `--browser` 为准。
  **不许靠调低阈值转绿。**

**本轮实测（抄工具输出）**

```
静态       ：174/364 = 47.8%   pass 174 · fail 14 · human-only 22 · not-collected 176
加 --browser：204/364 = 56.0%   pass 204 · fail 21 · human-only 22 · not-collected 139
视觉档     ：最小点击目标 74×44（此前 70×21）· 最低对比度 3.42:1 · 同屏主操作最多 2 个
剩余红     ：S-001 5 · S-003 3 · X-001 5 · S-002 1 · C-001 2 · C-003 1 · D-002 1 · N-001 3
```

**这轮新踩到的坑**

1. **宿主 token 会盖掉 fallback**：`--dsh-content-font-size` 在某个容器上有值（14px），
   所以 `var(…, 16px)` 不会退回 16 —— 要设下限只能用 `max()`，或直接写字号。
2. **`roleOf` 的顺序会静默吃掉类名判定**：先按标签判 `p → body` 会让 `p.xs-overview__localnote`
   永远进不了 meta 分支。**类名先于标签**才对。
3. **首跑模态会让整轮浏览器采集退化**：点「创建新谱」时被 `aria-hidden` 遮罩拦住，
   整套剧本记 `collection-failed`（176 条全「未采到」）。遮罩判断要按「有面积 + 没被样式藏起来」，
   且每次要点的东西之前都兜一次底 —— modal 是异步挂上来的。
4. **CI 上 mtime 抖动会判「产物落后」**：全新检出时全部文件在同一秒内写完，`src` 的某个文件
   比 `lib/client.js` 晚 1–3 毫秒，巡检在干净工作区上拒绝采集。已加 1 秒容差（权威判据仍是
   `build-client --check` 的逐字节比较）。




