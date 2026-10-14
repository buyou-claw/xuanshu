# Spec 001 开发进度

核对日期：2026-10-15。集成分支：`codex/spec-001-integration`（**已推 origin**）。

GitHub issue/PR 的 open 状态不等于未实现，反之亦然：票 01–06 的代码在本地提交并由 stacked PR 承载（#2/#3/#4/#6/#7/#9 仍 open，其改动**全部已包含在集成分支**里）；票 07–16 已实现并**已在 GitHub 上关闭**（#10–#19）。

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

## 验证边界

完整装配五条 seam 的当前结果：S2（进程内启动）、S3（客户端产物）、S4（上游行基线）、S5（真实 CLI 报告）通过；
**S1 schema 导出失败**。

失败来自钉版 `@deepseek-ai/dsh-app-boot@0.2.0-rc.2`：它的 schema 导出器只接受 native group/include carrier，
而同版本官方 web bundle 自带的 `@deepseek-ai/dsh-agent-preset` 是另一种 carrier，报
`unrecognized Loader tree carrier`。真实 web 与宿主启动正常。测试保留失败，无上游源码改动、无放宽断言。

当前全仓基线（`node ./node_modules/vitest/vitest.mjs run`）：

```
Test Files  1 failed | 93 passed | 1 skipped (95)
Tests       2 failed | 992 passed | 8 skipped (1002)
```

那 2 条失败即上述 S1（`S1 装配树` 与由它连带的 `CLI 退出码为 0`）。**基线之外的红色一律是本轮引入的回归。**
（历史：票 08 后 448 passed；票 10/13 后 684；票 11/12/15/16 后 992。）

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

本机 PATH 中的 `pnpm` shim 指向已不存在的 executable。所有构建 / vitest / tsc 通过现有 Node 直接执行；
需要 pnpm 时照 `scripts/install-profile.mjs` 内部的调用方式走。未修改机器全局配置。

### 两条会让"没验"伪装成"验过"的操作陷阱（实测踩到，记下来）

1. **merge 集成 tip 之后必须重跑 `node scripts/install-profile.mjs --home .dsh-home`。**
   否则 S3 会红：profile 里装的 `lib/client.js` 与仓库不一致（merge 带进来的客户端源文件不会自动同步）。
   **本条每张票都会踩一次**，实现者两轮各踩了一次。
2. **改中文源码文件不要走 PowerShell 的 `Get-Content -Raw | Set-Content -Encoding utf8` 往返** ——
   中文注释会变乱码，进而让 vitest 报 **`no tests`**。危险的不是乱码本身，而是它的**失败形态**：
   一个「测试根本没跑」被读成「测试通过」或「实现被改坏」。**用 `read`/`edit`/`write` 工具改文件。**
   同一类问题的另一面：`--reporter=basic` 在 vitest 4 不支持（要用 `dot`）、`fileParallelism: false` 是刻意设的。

## 工作方式

- 每个实现者在自己的 git worktree（`.scratch/worktrees/<ticket>`）与自己的分支上工作，
  完成前把集成分支 tip 并进自己的分支，再由 Lead 合并回集成分支。
- 跨半/跨票的接口面**先冻结成契约文档**（如 `.scratch/notes/t08-contract.md`）再并行实现，
  避免两条分支在集成时对不上。
- 每完成一个阶段：推分支 + 开票面 PR + 在对应 issue 留证据，做法照票 01–07 的历史形态。
